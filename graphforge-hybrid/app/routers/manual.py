"""Manual node/edge CRUD — Obsidian-style explicit linking.

Works with ANY provider (local or cloud). All operations acquire the
Kuzu write_lock and use the session's embedder for name/fact embeddings.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..graphiti_factory import configure, get_driver, get_engine, write_lock
from ..sessions import get_session

router = APIRouter(tags=["manual"])


# ── Request models ──────────────────────────────────────────────────
class NodeCreate(BaseModel):
    name: str
    type: str = "Entity"
    summary: str = ""


class NodeUpdate(BaseModel):
    name: str | None = None
    type: str | None = None
    summary: str | None = None


class EdgeCreate(BaseModel):
    source_uuid: str
    target_uuid: str
    name: str
    fact: str = ""


class EdgeUpdate(BaseModel):
    name: str | None = None
    fact: str | None = None


# ── Helpers ─────────────────────────────────────────────────────────
async def _get_session_or_404(session_id: str):
    s = get_session(session_id)
    if s is None:
        raise HTTPException(404, "Session not found")
    return s


async def _get_embedder(s):
    """Return the session's embedder (local or cloud)."""
    from ..llm_factory import build_clients

    _, emb, _ = build_clients(s)
    return emb


# ── Node endpoints ──────────────────────────────────────────────────
@router.post("/sessions/{session_id}/nodes")
async def create_node(session_id: str, body: NodeCreate):
    from graphiti_core.nodes import EntityNode

    s = await _get_session_or_404(session_id)
    embedder = await _get_embedder(s)

    # Patch EMBEDDING_DIM for this session
    engine = await get_engine()
    configure(engine, s)

    node = EntityNode(
        uuid=str(uuid4()),
        name=body.name,
        group_id=s.id,
        labels=[body.type] if body.type else [],
        summary=body.summary or f"{body.type}: {body.name}",
        created_at=datetime.now(timezone.utc),
    )
    await node.generate_name_embedding(embedder)

    async with write_lock:
        await node.save(get_driver())

    return {"uuid": node.uuid, "name": node.name, "type": body.type}


@router.patch("/sessions/{session_id}/nodes/{node_uuid}")
async def update_node(session_id: str, node_uuid: str, body: NodeUpdate):
    from graphiti_core.nodes import EntityNode

    s = await _get_session_or_404(session_id)

    driver = get_driver()
    try:
        nodes = await EntityNode.get_by_group_ids(driver, [s.id])
    except Exception:
        nodes = []

    node = next((n for n in nodes if n.uuid == node_uuid), None)
    if node is None:
        raise HTTPException(404, "Node not found")

    changed = False
    if body.name is not None and body.name != node.name:
        node.name = body.name
        changed = True
    if body.type is not None:
        node.labels = [body.type]
    if body.summary is not None:
        node.summary = body.summary

    if changed:
        engine = await get_engine()
        configure(engine, s)
        embedder = await _get_embedder(s)
        await node.generate_name_embedding(embedder)

    async with write_lock:
        await node.save(driver)

    return {"uuid": node.uuid, "name": node.name}


@router.delete("/sessions/{session_id}/nodes/{node_uuid}", status_code=204)
async def delete_node(session_id: str, node_uuid: str):
    from graphiti_core.nodes import EntityNode

    s = await _get_session_or_404(session_id)
    driver = get_driver()

    try:
        nodes = await EntityNode.get_by_group_ids(driver, [s.id])
    except Exception:
        nodes = []

    node = next((n for n in nodes if n.uuid == node_uuid), None)
    if node is None:
        raise HTTPException(404, "Node not found")

    async with write_lock:
        await node.delete(driver)


# ── Edge endpoints ──────────────────────────────────────────────────
@router.post("/sessions/{session_id}/edges")
async def create_edge(session_id: str, body: EdgeCreate):
    from graphiti_core.edges import EntityEdge

    s = await _get_session_or_404(session_id)
    embedder = await _get_embedder(s)

    engine = await get_engine()
    configure(engine, s)

    edge = EntityEdge(
        uuid=str(uuid4()),
        group_id=s.id,
        source_node_uuid=body.source_uuid,
        target_node_uuid=body.target_uuid,
        name=body.name,
        fact=body.fact or body.name,
        episodes=[],
        created_at=datetime.now(timezone.utc),
    )
    await edge.generate_embedding(embedder)

    async with write_lock:
        await edge.save(get_driver())

    return {
        "uuid": edge.uuid,
        "source_uuid": edge.source_node_uuid,
        "target_uuid": edge.target_node_uuid,
        "name": edge.name,
    }


@router.patch("/sessions/{session_id}/edges/{edge_uuid}")
async def update_edge(session_id: str, edge_uuid: str, body: EdgeUpdate):
    from graphiti_core.edges import EntityEdge

    s = await _get_session_or_404(session_id)
    driver = get_driver()

    try:
        edges = await EntityEdge.get_by_group_ids(driver, [s.id])
    except Exception:
        edges = []

    edge = next((e for e in edges if e.uuid == edge_uuid), None)
    if edge is None:
        raise HTTPException(404, "Edge not found")

    re_embed = False
    if body.name is not None:
        edge.name = body.name
    if body.fact is not None and body.fact != edge.fact:
        edge.fact = body.fact
        re_embed = True

    if re_embed:
        engine = await get_engine()
        configure(engine, s)
        embedder = await _get_embedder(s)
        await edge.generate_embedding(embedder)

    async with write_lock:
        await edge.save(driver)

    return {"uuid": edge.uuid, "name": edge.name}


@router.delete("/sessions/{session_id}/edges/{edge_uuid}", status_code=204)
async def delete_edge(session_id: str, edge_uuid: str):
    from graphiti_core.edges import EntityEdge

    s = await _get_session_or_404(session_id)
    driver = get_driver()

    try:
        edges = await EntityEdge.get_by_group_ids(driver, [s.id])
    except Exception:
        edges = []

    edge = next((e for e in edges if e.uuid == edge_uuid), None)
    if edge is None:
        raise HTTPException(404, "Edge not found")

    async with write_lock:
        await edge.delete(driver)
