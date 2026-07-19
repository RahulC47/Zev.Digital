"""Composio integration endpoints (Gmail / Calendar / Slack / Notion).

Called by the Rust/Tauri backend over localhost. Composio operations run in a
threadpool because the SDK is synchronous. OAuth itself happens in Composio's
own hosted browser flow — this sidecar only initiates connections and reports
status. Write actions go through `/execute`, which the UI reaches only after an
explicit user confirm.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from ..integrations import composio_client as cc

logger = logging.getLogger(__name__)

router = APIRouter()


class ConfigureKeyReq(BaseModel):
    api_key: str


class AppReq(BaseModel):
    app: str


class FetchReq(BaseModel):
    app: str
    limit: int = 10


class ExecuteReq(BaseModel):
    action: str
    params: dict = {}


@router.post("/zev/composio/configure")
async def composio_configure(req: ConfigureKeyReq):
    if not req.api_key.strip():
        raise HTTPException(400, "empty Composio API key")
    try:
        await run_in_threadpool(cc.configure, req.api_key.strip())
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"Composio configure failed: {e}")
    return {"ok": True}


@router.get("/zev/composio/status")
async def composio_status():
    if not cc.is_configured():
        return []
    try:
        return await run_in_threadpool(cc.connected_apps)
    except Exception as e:  # noqa: BLE001
        logger.warning("composio status failed: %s", e)
        return []


@router.post("/zev/composio/connect")
async def composio_connect(req: AppReq):
    try:
        return await run_in_threadpool(cc.initiate, req.app)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, str(e))


@router.get("/zev/composio/connection/{connection_id}")
async def composio_connection(connection_id: str):
    return {"status": await run_in_threadpool(cc.connection_status, connection_id)}


@router.post("/zev/composio/disconnect")
async def composio_disconnect(req: AppReq):
    ok = await run_in_threadpool(cc.disconnect, req.app)
    return {"ok": ok}


@router.post("/zev/composio/fetch")
async def composio_fetch(req: FetchReq):
    try:
        return await run_in_threadpool(cc.fetch, req.app, req.limit)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, str(e))


@router.get("/zev/composio/upcoming")
async def composio_upcoming():
    if not cc.is_configured():
        return []
    try:
        return await run_in_threadpool(cc.upcoming)
    except Exception as e:  # noqa: BLE001
        logger.warning("composio upcoming failed: %s", e)
        return []


@router.post("/zev/composio/execute")
async def composio_execute(req: ExecuteReq):
    try:
        return await run_in_threadpool(cc.execute, req.action, req.params)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, str(e))
