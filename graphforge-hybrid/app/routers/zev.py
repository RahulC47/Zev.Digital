"""Zev-specific sidecar endpoints.

These endpoints are called by the Rust/Tauri backend over localhost. They
always operate on a single hardcoded session ``ZEV_GROUP_ID`` so the Rust
side never needs to deal with GraphForge's multi-session model.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from .. import bitemporal as bt
from .. import jobs
from ..config import DEFAULT_MODELS, get_api_key, set_api_key
from ..graphiti_factory import configure, get_driver, get_engine, write_lock
from ..graphview import get_graph
from ..ingest import _add_episode
from ..parsers import chunk_text
from ..sessions import GraphSession, _fill_defaults, get_session, create_session

logger = logging.getLogger(__name__)

router = APIRouter()

ZEV_GROUP_ID = "zev-vault"


def _parse_collections(collections: str) -> list[str]:
    """Parse the comma-separated `collections` query param (empty = all)."""
    if not collections:
        return []
    return [c.strip() for c in collections.split(",") if c.strip()]


async def _episode_uuids_for_collections(gid: str, collection_ids: list[str]) -> Optional[set[str]]:
    """UUIDs of episodic nodes whose source_description carries any of the given
    collection tags. Returns None when no filter is requested (= include all)."""
    if not collection_ids:
        return None
    from ..graphview import _episodes
    eps = await _episodes(gid)
    wanted = set()
    for ep in eps:
        desc = getattr(ep, "source_description", "") or ""
        if any(f"[collection:{cid}]" in desc for cid in collection_ids):
            wanted.add(ep.uuid)
    return wanted


# ── helpers ───────────────────────────────────────────────────────────────────

def _ensure_session() -> GraphSession:
    """Get or create the single Zev vault session."""
    s = get_session(ZEV_GROUP_ID)
    if s is None:
        s = GraphSession(
            id=ZEV_GROUP_ID,
            name="Zev Vault",
            provider="local",
        )
        _fill_defaults(s)
        from sqlmodel import Session as DBSession
        from ..db import engine as db_engine
        with DBSession(db_engine) as db:
            db.add(s)
            db.commit()
            db.refresh(s)
    return s


# ── /api/configure ────────────────────────────────────────────────────────────

class ConfigureRequest(BaseModel):
    extraction_mode: str = "local"        # "local" | "cloud"
    cloud_provider: str = "byok"          # "ollama" | "byok"
    ollama_url: str = "http://localhost:11434/v1"
    byok_base_url: str = ""
    byok_api_key: str = ""
    byok_model: str = ""


@router.post("/configure")
async def configure_endpoint(req: ConfigureRequest):
    """Push Zev's Settings into the sidecar.  Maps Zev's chat-provider
    config to GraphForge's provider model."""
    s = _ensure_session()

    if req.extraction_mode == "local":
        provider = "local"
        llm_model = DEFAULT_MODELS["local"]["llm"]
    elif req.cloud_provider == "ollama":
        provider = "ollama"
        llm_model = req.byok_model or DEFAULT_MODELS["ollama"]["llm"]
        from ..config import settings as cfg
        cfg.ollama_base_url = req.ollama_url
    else:
        # BYOK — map base_url to a provider
        base = (req.byok_base_url or "").lower()
        if "deepseek" in base:
            provider = "deepseek"
            set_api_key("deepseek", req.byok_api_key)
            from ..config import settings as cfg
            cfg.deepseek_base_url = req.byok_base_url
        elif "openrouter" in base:
            provider = "openrouter"
            set_api_key("openrouter", req.byok_api_key)
            from ..config import settings as cfg
            cfg.openrouter_base_url = req.byok_base_url
        else:
            # Fallback: treat as OpenAI-compatible
            provider = "openrouter"
            set_api_key("openrouter", req.byok_api_key)
            from ..config import settings as cfg
            cfg.openrouter_base_url = req.byok_base_url
        llm_model = req.byok_model or DEFAULT_MODELS.get(provider, DEFAULT_MODELS["openai"])["llm"]

    # Update the session row
    from ..sessions import update_session
    update_session(ZEV_GROUP_ID, provider=provider, llm_model=llm_model)

    # Reconfigure the live engine
    s_updated = get_session(ZEV_GROUP_ID)
    if s_updated:
        engine = await get_engine()
        async with write_lock:
            configure(engine, s_updated)

    return {"ok": True, "provider": provider, "llm_model": llm_model}


# ── /api/zev/ingest ───────────────────────────────────────────────────────────

class IngestRequest(BaseModel):
    text: str
    name: str = "captured window"
    source_id: str = ""                   # Zev source UUID for cross-referencing
    collection_id: str = "general"        # Zev collection this capture belongs to


async def _do_ingest(
    s: GraphSession, text: str, name: str, source_id: str, collection_id: str, job_id: str
):
    """Background ingest — chunks + entity extraction. Episodes are tagged with
    both the source and collection so the single merged brain graph can be
    filtered per collection later."""
    try:
        tags = []
        if source_id:
            tags.append(f"[source:{source_id}]")
        if collection_id:
            tags.append(f"[collection:{collection_id}]")
        src_desc = ("window capture " + " ".join(tags)).strip()
        chunks = chunk_text(text)
        jobs.update_job(job_id, total=max(len(chunks), 1), status="running")
        for i, chunk in enumerate(chunks):
            await _add_episode(s, f"{name} [{i+1}/{len(chunks)}]", chunk, src_desc)
            jobs.bump_job(job_id, detail=f"chunk {i+1}/{len(chunks)}")
        jobs.update_job(job_id, status="done", detail="complete")
        await bt.sync_group(get_driver(), s.id)
    except Exception as e:  # noqa: BLE001
        logger.exception("Ingest failed for source %s", source_id)
        jobs.update_job(job_id, status="error", error=str(e))


@router.post("/zev/ingest")
async def ingest(req: IngestRequest, bg: BackgroundTasks):
    s = _ensure_session()
    job_id = jobs.create_job(ZEV_GROUP_ID, "text")
    bg.add_task(_do_ingest, s, req.text, req.name, req.source_id, req.collection_id, job_id)
    return {"job_id": job_id}


# ── /api/zev/search ───────────────────────────────────────────────────────────

@router.get("/zev/search")
async def search(q: str, limit: int = 10, collections: str = ""):
    """Semantic graph search over the merged brain, optionally scoped to a set
    of collections (comma-separated ids; empty = whole brain)."""
    s = _ensure_session()
    engine = await get_engine()

    coll_ids = _parse_collections(collections)
    wanted_eps = await _episode_uuids_for_collections(ZEV_GROUP_ID, coll_ids)
    # Over-fetch when filtering so we still return ~limit after the filter.
    fetch_n = limit * 4 if wanted_eps is not None else limit

    async with write_lock:
        configure(engine, s)
        results = await engine.search(q, group_ids=[ZEV_GROUP_ID], num_results=fetch_n)

    # Drop facts that don't come from the requested collections.
    if wanted_eps is not None:
        results = [
            r
            for r in results
            if set(getattr(r, "episodes", []) or []) & wanted_eps
        ][:limit]

    # Enrich with entity names from source/target nodes when available
    out = []
    for r in results:
        entry = {
            "uuid": getattr(r, "uuid", None),
            "fact": getattr(r, "fact", ""),
            "name": getattr(r, "name", ""),
            "source_description": getattr(r, "source_description", ""),
            "valid_at": str(getattr(r, "valid_at", "") or ""),
            "entities": [],
        }
        # Try to get entity names from the edge's source/target
        src_uuid = getattr(r, "source_node_uuid", None)
        tgt_uuid = getattr(r, "target_node_uuid", None)
        driver = get_driver()
        for node_uuid in [src_uuid, tgt_uuid]:
            if node_uuid:
                try:
                    # Kuzu driver get_node_by_uuid
                    from graphiti_core.nodes import EntityNode
                    node = await driver.get_node_by_uuid(node_uuid)
                    if node and hasattr(node, "name"):
                        entry["entities"].append(node.name)
                except Exception:  # noqa: BLE001
                    pass
        out.append(entry)
    return {"results": out}


# ── /api/zev/source/{source_id} (delete) ─────────────────────────────────────

@router.delete("/zev/source/{source_id}")
async def delete_source(source_id: str):
    """Remove episodes whose source_description contains the given source_id."""
    driver = get_driver()
    # Query episodic nodes matching this source
    try:
        query = (
            f"MATCH (e:Episodic) "
            f"WHERE e.group_id = '{ZEV_GROUP_ID}' "
            f"AND e.source_description CONTAINS '[source:{source_id}]' "
            f"DETACH DELETE e"
        )
        async with write_lock:
            await driver.execute_query(query)
    except Exception as e:  # noqa: BLE001
        logger.warning("Failed to delete episodes for source %s: %s", source_id, e)
    return {"ok": True}


# ── /api/zev/clear ────────────────────────────────────────────────────────────

@router.post("/zev/clear")
async def clear():
    """Purge all graph data for the Zev vault."""
    driver = get_driver()
    try:
        async with write_lock:
            # Delete all nodes and relationships for this group
            for label in ["Episodic", "Entity", "Community"]:
                try:
                    await driver.execute_query(
                        f"MATCH (n:{label}) WHERE n.group_id = '{ZEV_GROUP_ID}' DETACH DELETE n"
                    )
                except Exception:  # noqa: BLE001
                    pass
        # Clear bitemporal table too
        bt.delete_group(ZEV_GROUP_ID)
    except Exception as e:  # noqa: BLE001
        logger.warning("Failed to clear graph: %s", e)
    return {"ok": True}


# ── /api/zev/graph ───────────────────────────────────────────────────────────

def _ts(v) -> str:
    return "" if v is None else str(v)


async def _filtered_graph(gid: str, wanted_eps: Optional[set[str]]) -> dict:
    """Build {nodes, links}; when wanted_eps is set, keep only edges whose
    episodes intersect it and the entity nodes those edges touch."""
    if wanted_eps is None:
        return await get_graph(gid)  # whole brain (fast path)

    from ..graphview import _edges, _entities
    edges = await _edges(gid)
    nodes = await _entities(gid)

    kept_edges = [e for e in edges if set(getattr(e, "episodes", []) or []) & wanted_eps]
    keep_node_ids = set()
    for e in kept_edges:
        keep_node_ids.add(e.source_node_uuid)
        keep_node_ids.add(e.target_node_uuid)

    return {
        "nodes": [
            {
                "id": n.uuid,
                "label": n.name or n.uuid,
                "summary": getattr(n, "summary", "") or "",
                "type": (n.labels[0] if getattr(n, "labels", None) else "Entity"),
            }
            for n in nodes
            if n.uuid in keep_node_ids
        ],
        "links": [
            {
                "id": e.uuid,
                "source": e.source_node_uuid,
                "target": e.target_node_uuid,
                "name": e.name or "",
                "fact": getattr(e, "fact", "") or "",
                "valid_at": _ts(getattr(e, "valid_at", None)),
            }
            for e in kept_edges
        ],
    }


@router.get("/zev/graph")
async def zev_graph(collections: str = ""):
    """Return {nodes, links} for the brain graph, optionally scoped to collections."""
    _ensure_session()
    wanted_eps = await _episode_uuids_for_collections(
        ZEV_GROUP_ID, _parse_collections(collections)
    )
    return await _filtered_graph(ZEV_GROUP_ID, wanted_eps)


# ── /api/zev/export ──────────────────────────────────────────────────────────

@router.get("/zev/export")
async def zev_export(format: str = "md", collections: str = ""):
    """Export the brain graph as md / json / cypher, scoped to collections.
    Reuses app/export.py for the unscoped case; filters by collection otherwise."""
    from fastapi.responses import PlainTextResponse
    from ..export import export_cypher, export_json, export_markdown

    _ensure_session()
    coll_ids = _parse_collections(collections)

    if not coll_ids:
        if format == "json":
            content, media = await export_json(ZEV_GROUP_ID), "application/json"
        elif format == "cypher":
            content, media = await export_cypher(ZEV_GROUP_ID), "text/plain"
        else:
            content, media = await export_markdown(ZEV_GROUP_ID, "Zev Vault"), "text/markdown"
        return PlainTextResponse(content, media_type=media)

    # Scoped export: build a filtered {nodes, links} then render it.
    wanted_eps = await _episode_uuids_for_collections(ZEV_GROUP_ID, coll_ids)
    g = await _filtered_graph(ZEV_GROUP_ID, wanted_eps)
    if format == "json":
        import json as _json
        return PlainTextResponse(
            _json.dumps(g, indent=2, default=str), media_type="application/json"
        )
    if format == "cypher":
        lines = ["// Zev collection export", ""]
        for n in g["nodes"]:
            lines.append(
                f"CREATE (:Entity {{uuid:'{n['id']}', name:'{n['label']}'}});"
            )
        for e in g["links"]:
            lines.append(
                f"MATCH (a:Entity {{uuid:'{e['source']}'}}), (b:Entity {{uuid:'{e['target']}'}}) "
                f"CREATE (a)-[:RELATES_TO {{name:'{e['name']}', fact:'{e['fact']}'}}]->(b);"
            )
        return PlainTextResponse("\n".join(lines), media_type="text/plain")
    # markdown
    lines = ["# Zev knowledge graph (selected collections)", ""]
    lines.append(f"## Entities ({len(g['nodes'])})")
    name_by_id = {n["id"]: n["label"] for n in g["nodes"]}
    for n in sorted(g["nodes"], key=lambda x: x["label"].lower()):
        lines.append(f"- **{n['label']}**" + (f" — {n['summary']}" if n.get("summary") else ""))
    lines.append("")
    lines.append(f"## Facts / Relationships ({len(g['links'])})")
    for e in g["links"]:
        src = name_by_id.get(e["source"], e["source"])
        tgt = name_by_id.get(e["target"], e["target"])
        fact = e.get("fact") or f"{src} {e.get('name','')} {tgt}"
        lines.append(f"- {fact}")
    return PlainTextResponse("\n".join(lines), media_type="text/markdown")


# ── /api/zev/node|edge (granular delete) ─────────────────────────────────────

@router.delete("/zev/node/{uuid}")
async def delete_node(uuid: str):
    """Delete a single entity node (and its incident edges) by uuid."""
    from graphiti_core.edges import EntityEdge
    from graphiti_core.nodes import EntityNode

    driver = get_driver()
    async with write_lock:
        # Remove incident edges first.
        try:
            edges = await EntityEdge.get_by_group_ids(driver, [ZEV_GROUP_ID])
            for e in edges:
                if e.source_node_uuid == uuid or e.target_node_uuid == uuid:
                    try:
                        await e.delete(driver)
                    except Exception:  # noqa: BLE001
                        pass
        except Exception:  # noqa: BLE001
            pass
        try:
            node = await EntityNode.get_by_uuid(driver, uuid)
            await node.delete(driver)
        except Exception as e:  # noqa: BLE001
            logger.warning("delete_node failed for %s: %s", uuid, e)
    return {"ok": True}


@router.delete("/zev/edge/{uuid}")
async def delete_edge(uuid: str):
    """Delete a single relationship edge by uuid."""
    from graphiti_core.edges import EntityEdge

    driver = get_driver()
    async with write_lock:
        try:
            edge = await EntityEdge.get_by_uuid(driver, uuid)
            await edge.delete(driver)
        except Exception as e:  # noqa: BLE001
            logger.warning("delete_edge failed for %s: %s", uuid, e)
    return {"ok": True}


# ── /api/zev/node (create) ───────────────────────────────────────────────────

class NodeCreateRequest(BaseModel):
    name: str
    node_type: str = "Entity"
    summary: str = ""


@router.post("/zev/node")
async def create_node_endpoint(body: NodeCreateRequest):
    """Manually add a node to the Zev knowledge graph."""
    from datetime import datetime, timezone
    from uuid import uuid4
    from graphiti_core.nodes import EntityNode
    from ..llm_factory import build_clients

    s = _ensure_session()
    engine = await get_engine()
    async with write_lock:
        configure(engine, s)

    _, emb, _ = build_clients(s)

    node = EntityNode(
        uuid=str(uuid4()),
        name=body.name,
        group_id=ZEV_GROUP_ID,
        labels=[body.node_type] if body.node_type else [],
        summary=body.summary or f"{body.node_type}: {body.name}",
        created_at=datetime.now(timezone.utc),
    )
    await node.generate_name_embedding(emb)
    async with write_lock:
        await node.save(get_driver())

    return {"uuid": node.uuid, "name": node.name, "type": body.node_type}


# ── /api/zev/edge (create) ──────────────────────────────────────────────────

class EdgeCreateRequest(BaseModel):
    source_node_uuid: str
    target_node_uuid: str
    name: str
    fact: str = ""


@router.post("/zev/edge")
async def create_edge_endpoint(body: EdgeCreateRequest):
    """Manually add an edge (relationship) to the Zev knowledge graph."""
    from datetime import datetime, timezone
    from uuid import uuid4
    from graphiti_core.edges import EntityEdge
    from ..llm_factory import build_clients

    s = _ensure_session()
    engine = await get_engine()
    async with write_lock:
        configure(engine, s)

    _, emb, _ = build_clients(s)

    edge = EntityEdge(
        uuid=str(uuid4()),
        group_id=ZEV_GROUP_ID,
        source_node_uuid=body.source_node_uuid,
        target_node_uuid=body.target_node_uuid,
        name=body.name,
        fact=body.fact or body.name,
        episodes=[],
        created_at=datetime.now(timezone.utc),
    )
    await edge.generate_embedding(emb)
    async with write_lock:
        await edge.save(get_driver())

    return {
        "uuid": edge.uuid,
        "source_uuid": edge.source_node_uuid,
        "target_uuid": edge.target_node_uuid,
        "name": edge.name,
    }


# ── /api/zev/stt (speech-to-text) ─────────────────────────────────────────────

@router.post("/zev/stt")
async def zev_stt(audio: UploadFile = File(...)):
    """Transcribe an uploaded audio clip to text using the local Whisper model.

    Reuses app/transcribe.py (faster-whisper, CPU/int8). Fully on-device — the
    audio never leaves the machine. Called by Rust, which proxies the bytes
    recorded in the Tauri webview.
    """
    from ..transcribe import transcribe

    data = await audio.read()
    if not data:
        logger.info("STT: empty audio upload")
        return {"text": ""}
    logger.info("STT: received %d bytes (%s)", len(data), audio.filename)
    try:
        text = await transcribe(data, audio.filename or "audio.webm")
        logger.info("STT: transcribed → %r (%d chars)", text[:80] if text else "", len(text))
        return {"text": text}
    except Exception as e:  # noqa: BLE001
        logger.warning("STT failed: %s", e)
        return {"text": "", "error": str(e)}


# ── /api/zev/tts (text-to-speech) ────────────────────────────────────────────

class TtsRequest(BaseModel):
    text: str


@router.post("/zev/tts")
async def zev_tts(req: TtsRequest):
    """Synthesize speech locally with Piper (neural TTS, fully on-device).

    Returns WAV bytes. 503 with a human-readable reason when Piper isn't
    installed or the voice can't be loaded — the app then falls back to the
    OS speechSynthesis voices.
    """
    from ..tts import synthesize

    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="empty text")
    try:
        wav = await synthesize(text)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:  # noqa: BLE001
        logger.warning("TTS failed: %s", e)
        raise HTTPException(status_code=503, detail=f"TTS failed: {e}")
    return Response(content=wav, media_type="audio/wav")


# ── /api/zev/extract (file → text) ───────────────────────────────────────────

@router.post("/zev/extract")
async def zev_extract(file: UploadFile = File(...)):
    """Extract plain text from an uploaded file (pdf / docx / any text format).

    Reuses app/parsers.py. Fully on-device — called by Rust, which then runs
    the extracted text through the normal capture pipeline (FTS + graph).
    """
    from ..parsers import extract_text

    data = await file.read()
    if not data:
        return {"text": ""}
    try:
        import asyncio
        text = await asyncio.to_thread(extract_text, file.filename or "file.txt", data)
        return {"text": text}
    except Exception as e:  # noqa: BLE001
        logger.warning("Extract failed for %s: %s", file.filename, e)
        return {"text": "", "error": str(e)}


# ── /api/zev/job/{job_id} ────────────────────────────────────────────────────

@router.get("/zev/job/{job_id}")
async def get_job(job_id: str):
    job = jobs.get_job(job_id)
    if job is None:
        return {"error": "job not found"}
    return job
