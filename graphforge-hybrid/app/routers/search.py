from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .. import sessions as repo
from ..graphiti_factory import configure, get_engine, write_lock
from ..llm_factory import ProviderConfigError

router = APIRouter()


@router.get("/sessions/{session_id}/search")
async def search(session_id: str, q: str, limit: int = 10):
    s = repo.get_session(session_id)
    if s is None:
        raise HTTPException(404, "session not found")
    engine = await get_engine()
    async with write_lock:
        try:
            configure(engine, s)
        except ProviderConfigError as e:
            raise HTTPException(400, str(e))
        results = await engine.search(q, group_ids=[session_id], num_results=limit)
    return [
        {
            "uuid": getattr(r, "uuid", None),
            "fact": getattr(r, "fact", ""),
            "name": getattr(r, "name", ""),
            "source_node_uuid": getattr(r, "source_node_uuid", None),
            "target_node_uuid": getattr(r, "target_node_uuid", None),
            "valid_at": str(getattr(r, "valid_at", "") or ""),
        }
        for r in results
    ]
