from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .. import sessions as repo
from ..graphview import get_graph

router = APIRouter()


@router.get("/sessions/{session_id}/graph")
async def session_graph(session_id: str):
    if repo.get_session(session_id) is None:
        raise HTTPException(404, "session not found")
    return await get_graph(session_id)
