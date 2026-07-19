from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse

from .. import sessions as repo
from ..export import export_cypher, export_json, export_markdown

router = APIRouter()


@router.get("/sessions/{session_id}/export")
async def export_session(session_id: str, format: str = "md"):
    s = repo.get_session(session_id)
    if s is None:
        raise HTTPException(404, "session not found")

    if format == "md":
        content = await export_markdown(session_id, s.name)
        media, ext = "text/markdown", "md"
    elif format == "json":
        content = await export_json(session_id)
        media, ext = "application/json", "json"
    elif format == "cypher":
        content = await export_cypher(session_id)
        media, ext = "text/plain", "cypher"
    else:
        raise HTTPException(400, "format must be one of: md, json, cypher")

    safe = "".join(c if c.isalnum() else "_" for c in s.name) or session_id
    return PlainTextResponse(
        content,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{safe}.{ext}"'},
    )
