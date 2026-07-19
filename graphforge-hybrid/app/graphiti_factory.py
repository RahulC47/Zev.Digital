from __future__ import annotations

import asyncio
import logging
import os

from graphiti_core import Graphiti

from .config import settings
from .llm_factory import build_clients
from .sessions import GraphSession

logger = logging.getLogger(__name__)

# Kuzu is an embedded, single-writer DB. We use ONE shared driver + ONE Graphiti
# engine, swap its LLM clients per session, and serialize every graph operation
# through this lock (covers both reads and writes).
write_lock = asyncio.Lock()

_driver = None
_engine: Graphiti | None = None


def _repair_kuzu_if_needed(db_path: str) -> None:
    """Delete a corrupt WAL file so Kuzu can start fresh.

    Kuzu writes a write-ahead log (graph.kuzu.wal) next to the main DB file.
    If the app is force-killed (Task Manager, Ctrl+C during write), this WAL
    can be left in a corrupt state, making the DB un-openable with the opaque
    "RuntimeError: Caught an unknown exception!".

    Recovery strategy: delete the WAL.  Kuzu committed transactions are already
    flushed to the main file; the WAL only contains uncommitted work, so
    dropping it loses at most the last in-flight write — acceptable for a
    desktop app where the alternative is "can never start again".
    """
    wal = db_path + ".wal"
    if os.path.isfile(wal):
        try:
            # Try opening the DB first — if it works, the WAL is fine
            import kuzu
            test_db = kuzu.Database(db_path)
            del test_db
        except RuntimeError:
            logger.warning(
                "Kuzu WAL appears corrupt — deleting %s to recover.", wal
            )
            try:
                os.remove(wal)
            except OSError as e:
                logger.error("Could not delete WAL: %s", e)


def get_driver():
    global _driver
    if _driver is None:
        from graphiti_core.driver.kuzu_driver import KuzuDriver

        _repair_kuzu_if_needed(settings.kuzu_path)

        try:
            _driver = KuzuDriver(db=settings.kuzu_path)
        except RuntimeError as exc:
            # Last resort: nuke the entire DB and start fresh
            logger.error(
                "Kuzu DB still unrecoverable after WAL repair — "
                "deleting DB files for a clean start."
            )
            for f in [settings.kuzu_path, settings.kuzu_path + ".wal"]:
                try:
                    if os.path.isfile(f):
                        os.remove(f)
                except OSError:
                    pass
            _driver = KuzuDriver(db=settings.kuzu_path)

        # KuzuDriver (unlike Neo4j/FalkorDB) never sets `_database`, but the base
        # GraphDriver.with_database()/group routing used by add_episode reads it.
        # Kuzu ignores the value, so any non-empty string avoids the AttributeError.
        if getattr(_driver, "_database", None) is None:
            _driver._database = "kuzu"
    return _driver


def _dummy_clients():
    """Clients that construct without a real key (index build never calls them)."""
    from graphiti_core.cross_encoder.openai_reranker_client import OpenAIRerankerClient
    from graphiti_core.embedder.openai import OpenAIEmbedder, OpenAIEmbedderConfig
    from graphiti_core.llm_client.config import LLMConfig
    from graphiti_core.llm_client.openai_client import OpenAIClient

    return (
        OpenAIClient(config=LLMConfig(api_key="noop")),
        OpenAIEmbedder(config=OpenAIEmbedderConfig(api_key="noop")),
        OpenAIRerankerClient(config=LLMConfig(api_key="noop")),
    )


async def get_engine() -> Graphiti:
    global _engine
    if _engine is None:
        import graphiti_core.embedder.client as _emb_mod

        from .local_embedder import EMBEDDING_DIM_LOCAL

        # If the default provider is local, set EMBEDDING_DIM before building
        # indices so Kuzu vector columns get the right dimension (384 vs 1024).
        if settings.default_llm_provider in ("local", "openrouter", "deepseek"):
            _emb_mod.EMBEDDING_DIM = EMBEDDING_DIM_LOCAL

        llm, emb, rer = _dummy_clients()
        _engine = Graphiti(
            graph_driver=get_driver(), llm_client=llm, embedder=emb, cross_encoder=rer
        )
        await _engine.build_indices_and_constraints()

        # Kuzu driver's build_indices_and_constraints is a no-op — create FTS
        # indices ourselves so search works. Graphiti-core generates the queries
        # but never executes them for Kuzu.
        await _create_kuzu_fts_indices(get_driver())

    return _engine


async def _create_kuzu_fts_indices(driver) -> None:
    """Create Kuzu FTS indices that graphiti-core skips."""
    from graphiti_core.driver.driver import GraphProvider

    if getattr(driver, "provider", None) != GraphProvider.KUZU:
        return

    fts_queries = [
        "CALL CREATE_FTS_INDEX('Episodic', 'episode_content', ['content', 'source', 'source_description']);",
        "CALL CREATE_FTS_INDEX('Entity', 'node_name_and_summary', ['name', 'summary']);",
        "CALL CREATE_FTS_INDEX('Community', 'community_name', ['name']);",
        "CALL CREATE_FTS_INDEX('RelatesToNode_', 'edge_name_and_fact', ['name', 'fact']);",
    ]
    for q in fts_queries:
        try:
            await driver.execute_query(q)
        except Exception:  # noqa: BLE001 — index may already exist
            pass


def configure(engine: Graphiti, s: GraphSession) -> None:
    """Point the shared engine at this session's provider. Raises ProviderConfigError."""
    import graphiti_core.embedder.client as _emb_mod

    from .local_embedder import EMBEDDING_DIM_LOCAL

    llm, emb, rer = build_clients(s)
    engine.llm_client = llm
    engine.embedder = emb
    engine.cross_encoder = rer
    # Also update the bundled clients object used by search/add_episode internals
    if hasattr(engine, "clients"):
        engine.clients.llm_client = llm
        engine.clients.embedder = emb
        engine.clients.cross_encoder = rer

    # Monkey-patch the module-level EMBEDDING_DIM so Kuzu vector indices
    # use the correct dimension for this session's embedder.
    _emb_mod.EMBEDDING_DIM = s.embedding_dim or (
        EMBEDDING_DIM_LOCAL if s.provider in ("local", "openrouter", "deepseek") else 1024
    )


async def close_engine() -> None:
    global _engine, _driver
    if _engine is not None:
        await _engine.close()  # also closes the shared Kuzu driver
    _engine = None
    _driver = None
