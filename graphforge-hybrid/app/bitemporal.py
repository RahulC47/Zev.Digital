"""
Bitemporal knowledge graph layer for GraphForge.

Adds a second time axis to every fact so the graph can be queried across
two independent time dimensions:

  valid time  (VT) — when the fact was TRUE in the real world
  transaction time (TT) — when the system RECORDED / BELIEVED the fact

Stored in the existing SQLite file (same DB as sessions). No new dependencies.

----------------------------------------------------------------------
The four bitemporal quadrants for any BT record:

  valid_to = ∞  AND  invalidated_at = ∞   →  CURRENT    (true now, believed now)
  valid_to < now AND  invalidated_at = ∞   →  HISTORICAL (was true, still believed)
  valid_to = ∞  AND  invalidated_at < now  →  RETRACTED  (thought true, belief withdrawn)
  valid_to < now AND  invalidated_at < now →  ARCHIVED   (past + belief withdrawn)
----------------------------------------------------------------------

Correction protocol (truly append-only):
  When graphiti updates an edge (marks it invalid_at), the BT layer:
    1. Sets old BT record's `invalidated_at` = now  (ONLY field ever mutated)
    2. Inserts new BT record with corrected `valid_to`, `prior_bt_uuid` = old, `recorded_at` = now
"""
from __future__ import annotations

import asyncio
import logging
import sqlite3
from datetime import datetime, timezone
from uuid import uuid4

logger = logging.getLogger(__name__)

# Sentinel value meaning "no end" / "infinity"
EPOCH_END = "9999-12-31T00:00:00+00:00"

# Serializes BT writes so concurrent ingest jobs don't race
_lock = asyncio.Lock()


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _db_path() -> str:
    from .config import settings
    return settings.sqlite_path


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path(), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _iso(v) -> str:
    """Normalise a datetime | str | None to an ISO-8601 string.
    Returns EPOCH_END for None / 'None' (meaning 'still valid / still believed').
    """
    if v is None:
        return EPOCH_END
    if isinstance(v, datetime):
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        return v.isoformat()
    s = str(v).strip()
    return s if s and s != "None" else EPOCH_END


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

def init_schema() -> None:
    """Create the bt_edges table in the existing SQLite DB if it doesn't exist."""
    with _conn() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS bt_edges (
            bt_uuid          TEXT PRIMARY KEY,
            entity_edge_uuid TEXT NOT NULL,
            prior_bt_uuid    TEXT,
            source_node_uuid TEXT NOT NULL,
            target_node_uuid TEXT NOT NULL,
            relation         TEXT DEFAULT '',
            fact             TEXT DEFAULT '',
            group_id         TEXT NOT NULL,
            -- Valid time axis (when was the fact true in the world?)
            valid_from       TEXT NOT NULL,
            valid_to         TEXT NOT NULL DEFAULT '9999-12-31T00:00:00+00:00',
            -- Transaction time axis (when did WE record / believe this version?)
            recorded_at      TEXT NOT NULL,
            invalidated_at   TEXT NOT NULL DEFAULT '9999-12-31T00:00:00+00:00'
        );

        CREATE INDEX IF NOT EXISTS idx_bt_group
            ON bt_edges(group_id);

        CREATE INDEX IF NOT EXISTS idx_bt_edge_uuid
            ON bt_edges(entity_edge_uuid);

        CREATE INDEX IF NOT EXISTS idx_bt_times
            ON bt_edges(group_id, valid_from, valid_to, recorded_at, invalidated_at);
        """)
    logger.info("Bitemporal schema ready")


# ---------------------------------------------------------------------------
# Sync  (graphiti → BT table)
# ---------------------------------------------------------------------------

async def sync_group(driver, group_id: str) -> int:
    """Mirror graphiti's EntityEdges for a session into the BT table.

    Call this after any ingest operation completes.
    Returns the number of BT records written (new + corrections).
    """
    from graphiti_core.edges import EntityEdge  # lazy import

    async with _lock:
        try:
            edges = await EntityEdge.get_by_group_ids(driver, [group_id])
        except Exception:
            return 0

        if not edges:
            return 0

        written = 0
        now = _now_iso()

        with _conn() as conn:
            for edge in edges:
                edge_uuid = str(edge.uuid)

                # Current (non-invalidated) BT record for this graphiti edge
                row = conn.execute(
                    """SELECT bt_uuid, valid_to, source_node_uuid, target_node_uuid,
                              relation, fact, valid_from
                         FROM bt_edges
                        WHERE entity_edge_uuid = ?
                          AND invalidated_at = ?
                        ORDER BY recorded_at DESC
                        LIMIT 1""",
                    (edge_uuid, EPOCH_END),
                ).fetchone()

                valid_from = _iso(getattr(edge, "valid_at", None))
                valid_to   = _iso(getattr(edge, "invalid_at", None))
                fact       = str(getattr(edge, "fact", "") or "")
                relation   = str(edge.name or "")
                src        = str(edge.source_node_uuid)
                tgt        = str(edge.target_node_uuid)

                if row is None:
                    # Brand-new edge — create first BT record
                    conn.execute(
                        """INSERT INTO bt_edges
                               (bt_uuid, entity_edge_uuid, prior_bt_uuid,
                                source_node_uuid, target_node_uuid, relation, fact,
                                group_id, valid_from, valid_to, recorded_at, invalidated_at)
                           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (
                            str(uuid4()), edge_uuid, None,
                            src, tgt, relation, fact,
                            group_id, valid_from, valid_to, now, EPOCH_END,
                        ),
                    )
                    written += 1

                elif row["valid_to"] != valid_to:
                    # Graphiti changed this edge's expiry (fact was superseded).
                    # BT protocol: close old record, open new corrected version.
                    old_bt_uuid = row["bt_uuid"]

                    # Step 1 — the only allowed mutation: stamp invalidated_at
                    conn.execute(
                        "UPDATE bt_edges SET invalidated_at = ? WHERE bt_uuid = ?",
                        (now, old_bt_uuid),
                    )

                    # Step 2 — new corrected version points back to old
                    conn.execute(
                        """INSERT INTO bt_edges
                               (bt_uuid, entity_edge_uuid, prior_bt_uuid,
                                source_node_uuid, target_node_uuid, relation, fact,
                                group_id, valid_from, valid_to, recorded_at, invalidated_at)
                           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (
                            str(uuid4()), edge_uuid, old_bt_uuid,
                            row["source_node_uuid"], row["target_node_uuid"],
                            row["relation"], row["fact"],
                            group_id, row["valid_from"], valid_to, now, EPOCH_END,
                        ),
                    )
                    written += 1

            conn.commit()

        if written:
            logger.debug(
                "BT sync: %d records written for group %s", written, group_id
            )
        return written


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------

def query_bt(
    group_id: str,
    valid_as_of: str,
    known_as_of: str,
) -> list[dict]:
    """Core bitemporal query across both time axes.

    Returns facts that:
      - Were true in the world at `valid_as_of`  (valid time)
      - Were recorded/believed before `known_as_of`  (transaction time)
      - Had NOT been retracted before `known_as_of`

    Examples:
      Current view:         valid_as_of=now,  known_as_of=now
      Historical truth:     valid_as_of=2019, known_as_of=now
      Past belief:          valid_as_of=now,  known_as_of=last_week
      Full time-travel:     valid_as_of=2019, known_as_of=last_week
    """
    with _conn() as conn:
        rows = conn.execute(
            """SELECT * FROM bt_edges
                WHERE group_id      = ?
                  AND valid_from   <= ?
                  AND valid_to      > ?
                  AND recorded_at  <= ?
                  AND invalidated_at > ?
                ORDER BY valid_from ASC""",
            (group_id, valid_as_of, valid_as_of, known_as_of, known_as_of),
        ).fetchall()
    return [dict(r) for r in rows]


def get_edge_history(entity_edge_uuid: str) -> list[dict]:
    """Return every BT version of a single graphiti edge, oldest first.

    Lets you trace the full correction chain via prior_bt_uuid links.
    """
    with _conn() as conn:
        rows = conn.execute(
            """SELECT * FROM bt_edges
                WHERE entity_edge_uuid = ?
                ORDER BY recorded_at ASC""",
            (entity_edge_uuid,),
        ).fetchall()
    return [dict(r) for r in rows]


def get_stats(group_id: str) -> dict:
    """Count records in each bitemporal quadrant for a session."""
    now = _now_iso()
    with _conn() as conn:
        total = conn.execute(
            "SELECT COUNT(*) FROM bt_edges WHERE group_id = ?",
            (group_id,),
        ).fetchone()[0]

        # Currently valid AND currently believed
        current = conn.execute(
            """SELECT COUNT(*) FROM bt_edges
                WHERE group_id = ? AND valid_to > ? AND invalidated_at > ?""",
            (group_id, now, now),
        ).fetchone()[0]

        # Historically valid (expired) but still believed
        historical = conn.execute(
            """SELECT COUNT(*) FROM bt_edges
                WHERE group_id = ? AND valid_to <= ? AND invalidated_at > ?""",
            (group_id, now, now),
        ).fetchone()[0]

        # Retracted (belief withdrawn regardless of valid_to)
        retracted = conn.execute(
            """SELECT COUNT(*) FROM bt_edges
                WHERE group_id = ? AND invalidated_at <= ?""",
            (group_id, now),
        ).fetchone()[0]

    return {
        "total": total,
        "current": current,
        "historical": historical,
        "retracted": retracted,
    }


def delete_group(group_id: str) -> None:
    """Remove all BT records for a session (called on session delete)."""
    with _conn() as conn:
        conn.execute("DELETE FROM bt_edges WHERE group_id = ?", (group_id,))
        conn.commit()
    logger.info("BT records deleted for group %s", group_id)
