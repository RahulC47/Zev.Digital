from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import bitemporal as bt
from .db import init_db
from .graphiti_factory import close_engine, get_engine
from .routers import (
    bitemporal,
    export,
    graph,
    ingest,
    integrations,
    manual,
    search,
    sessions,
    zev,
)

WEB_DIR = os.path.join(os.path.dirname(__file__), "web")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    bt.init_schema()      # create bt_edges table if not present
    await get_engine()    # open graph DB + build indices
    yield
    await close_engine()


app = FastAPI(title="GraphForge", version="0.1.0", lifespan=lifespan)

# CORS only matters in dev (vite on :5174 calling /api). In the packaged app the
# UI is served same-origin so this is a no-op.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5174", "http://127.0.0.1:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API under /api so the static SPA can own the root path.
for r in (sessions, ingest, graph, search, export, manual, bitemporal, zev, integrations):
    app.include_router(r.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok"}


# Serve the built frontend (if present). Mounted last so /api wins.
if os.path.isdir(WEB_DIR):
    app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
