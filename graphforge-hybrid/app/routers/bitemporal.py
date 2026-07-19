"""Bitemporal query API endpoints."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from .. import bitemporal as bt
from .. import sessions as repo
from ..graphiti_factory import get_driver

router = APIRouter()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.get("/sessions/{session_id}/bitemporal")
async def query_bitemporal(
    session_id: str,
    valid_as_of: str | None = None,
    known_as_of: str | None = None,
):
    """Bitemporal fact query.

    Both params are ISO-8601 datetimes; omit either to default to now.

    Examples:
      GET /sessions/{id}/bitemporal
          → all facts currently true & currently believed  (default)

      GET /sessions/{id}/bitemporal?valid_as_of=2023-01-01T00:00:00Z
          → facts that were true on 2023-01-01, using today's knowledge

      GET /sessions/{id}/bitemporal?known_as_of=2024-06-01T00:00:00Z
          → what we BELIEVED was currently true as of 2024-06-01
          (time-travel: ignores corrections learned after that date)

      GET /sessions/{id}/bitemporal?valid_as_of=2022-01-01T00:00:00Z&known_as_of=2023-01-01T00:00:00Z
          → full time-travel: what did we know in Jan 2023 about Jan 2022?
    """
    if repo.get_session(session_id) is None:
        raise HTTPException(404, "session not found")
    now = _now_iso()
    return bt.query_bt(
        group_id=session_id,
        valid_as_of=valid_as_of or now,
        known_as_of=known_as_of or now,
    )


@router.get("/sessions/{session_id}/bitemporal/stats")
async def bitemporal_stats(session_id: str):
    """Counts per bitemporal quadrant: current / historical / retracted / total."""
    if repo.get_session(session_id) is None:
        raise HTTPException(404, "session not found")
    return bt.get_stats(session_id)


@router.get("/sessions/{session_id}/bitemporal/history/{edge_uuid}")
async def edge_history(session_id: str, edge_uuid: str):
    """Full correction chain for one graphiti EntityEdge, oldest-first.

    Follow prior_bt_uuid links to trace every version of the fact.
    """
    if repo.get_session(session_id) is None:
        raise HTTPException(404, "session not found")
    return bt.get_edge_history(edge_uuid)


@router.post("/sessions/{session_id}/bitemporal/sync")
async def manual_sync(session_id: str):
    """Manually trigger BT mirror for a session (sync normally runs after ingest)."""
    if repo.get_session(session_id) is None:
        raise HTTPException(404, "session not found")
    count = await bt.sync_group(get_driver(), session_id)
    return {"synced": count, "session_id": session_id}
