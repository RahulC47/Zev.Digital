from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import bitemporal as bt
from .. import sessions as repo
from ..config import DEFAULT_MODELS, get_api_key, keyring_status, set_api_key, settings
from ..graphview import delete_group

router = APIRouter()


async def _test_key(provider: str, key: str) -> str:
    """Do a cheap API round-trip to verify the key works. Returns 'ok' or an error string."""
    try:
        if provider == "openai":
            from openai import AsyncOpenAI
            c = AsyncOpenAI(api_key=key)
            await c.models.list()
        elif provider == "gemini":
            from google import genai
            c = genai.Client(api_key=key)
            # embed a tiny string — cheapest call, uses the default embedding model
            await c.aio.models.embed_content(
                model="gemini-embedding-001",
                contents=["ping"],
            )
        elif provider == "anthropic":
            from anthropic import AsyncAnthropic
            c = AsyncAnthropic(api_key=key)
            await c.models.list()
        elif provider == "openrouter":
            from openai import AsyncOpenAI
            c = AsyncOpenAI(api_key=key, base_url="https://openrouter.ai/api/v1")
            await c.models.list()
        elif provider == "deepseek":
            from openai import AsyncOpenAI
            c = AsyncOpenAI(api_key=key, base_url="https://api.deepseek.com/v1")
            await c.models.list()
        else:
            return "test not supported for this provider"
        return "ok"
    except Exception as exc:  # noqa: BLE001
        return str(exc)


class SessionCreate(BaseModel):
    name: str
    provider: str | None = None
    llm_model: str = ""
    embedder_model: str = ""
    embedder_provider: str = ""


class SessionUpdate(BaseModel):
    name: str | None = None
    provider: str | None = None
    llm_model: str | None = None
    embedder_model: str | None = None
    embedder_provider: str | None = None


class KeyUpdate(BaseModel):
    provider: str
    api_key: str


@router.get("/providers")
async def providers():
    return {
        "providers": DEFAULT_MODELS,
        "default": settings.default_llm_provider,
        "keys": keyring_status(),
    }


@router.post("/settings/keys")
async def set_key(body: KeyUpdate):
    set_api_key(body.provider, body.api_key)
    return {"provider": body.provider, "set": bool(get_api_key(body.provider))}


@router.post("/settings/test")
async def test_key(body: KeyUpdate):
    result = await _test_key(body.provider, body.api_key)
    return {"provider": body.provider, "result": result, "ok": result == "ok"}


@router.get("/settings/keys")
async def get_keys():
    return keyring_status()


@router.get("/sessions")
async def list_sessions():
    return repo.list_sessions()


@router.post("/sessions")
async def create_session(body: SessionCreate):
    return repo.create_session(
        name=body.name,
        provider=body.provider,
        llm_model=body.llm_model,
        embedder_model=body.embedder_model,
        embedder_provider=body.embedder_provider,
    )


@router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    s = repo.get_session(session_id)
    if s is None:
        raise HTTPException(404, "session not found")
    return s


@router.patch("/sessions/{session_id}")
async def update_session(session_id: str, body: SessionUpdate):
    s = repo.update_session(session_id, **body.model_dump(exclude_unset=True))
    if s is None:
        raise HTTPException(404, "session not found")
    return s


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    s = repo.get_session(session_id)
    if s is None:
        raise HTTPException(404, "session not found")
    deleted = await delete_group(session_id)
    bt.delete_group(session_id)
    repo.delete_session_row(session_id)
    return {"deleted_nodes": deleted}
