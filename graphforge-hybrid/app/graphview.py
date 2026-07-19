from __future__ import annotations

from graphiti_core.edges import EntityEdge
from graphiti_core.nodes import EntityNode, EpisodicNode

from .graphiti_factory import get_driver, write_lock


def _ts(v) -> str:
    return "" if v is None else str(v)


async def _entities(gid: str) -> list[EntityNode]:
    try:
        return await EntityNode.get_by_group_ids(get_driver(), [gid])
    except Exception:  # noqa: BLE001 - Graphiti raises when a group has no nodes yet
        return []


async def _edges(gid: str) -> list[EntityEdge]:
    try:
        return await EntityEdge.get_by_group_ids(get_driver(), [gid])
    except Exception:  # noqa: BLE001
        return []


async def _episodes(gid: str) -> list[EpisodicNode]:
    try:
        return await EpisodicNode.get_by_group_ids(get_driver(), [gid])
    except Exception:  # noqa: BLE001
        return []


async def get_graph(gid: str) -> dict:
    async with write_lock:
        nodes = await _entities(gid)
        edges = await _edges(gid)
    return {
        "nodes": [
            {
                "id": n.uuid,
                "label": n.name or n.uuid,
                "summary": getattr(n, "summary", "") or "",
                "type": (n.labels[0] if getattr(n, "labels", None) else "Entity"),
            }
            for n in nodes
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
            for e in edges
        ],
    }


async def get_full(gid: str) -> dict:
    """Nodes + edges + episodes with timestamps, for JSON/MD/Cypher export."""
    async with write_lock:
        nodes = await _entities(gid)
        edges = await _edges(gid)
        episodes = await _episodes(gid)
    return {
        "entities": [
            {"id": n.uuid, "label": n.name or n.uuid, "summary": getattr(n, "summary", "") or ""}
            for n in nodes
        ],
        "edges": [
            {
                "source": e.source_node_uuid,
                "target": e.target_node_uuid,
                "name": e.name or "",
                "fact": getattr(e, "fact", "") or "",
                "valid_at": _ts(getattr(e, "valid_at", None)),
                "invalid_at": _ts(getattr(e, "invalid_at", None)),
            }
            for e in edges
        ],
        "episodes": [
            {
                "id": ep.uuid,
                "name": ep.name or "",
                "source_description": getattr(ep, "source_description", "") or "",
                "created_at": _ts(getattr(ep, "created_at", None)),
            }
            for ep in episodes
        ],
    }


async def delete_group(gid: str) -> int:
    """Delete all entities, edges, and episodes for a group. Returns items removed."""
    async with write_lock:
        driver = get_driver()
        edges = await _edges(gid)
        nodes = await _entities(gid)
        episodes = await _episodes(gid)
        count = 0
        for e in edges:
            try:
                await e.delete(driver)
                count += 1
            except Exception:  # noqa: BLE001
                pass
        for n in nodes:
            try:
                await n.delete(driver)
                count += 1
            except Exception:  # noqa: BLE001
                pass
        for ep in episodes:
            try:
                await ep.delete(driver)
                count += 1
            except Exception:  # noqa: BLE001
                pass
        return count
