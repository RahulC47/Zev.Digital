"""Local ingestion pipeline — bypasses Graphiti's add_episode() entirely.

Uses spaCy for NER + relationship extraction, fastembed for embeddings,
and writes EntityNode / EntityEdge / EpisodicNode directly via .save(driver).
No LLM calls, no API keys, fully offline.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import uuid4

from graphiti_core.edges import EntityEdge
from graphiti_core.nodes import EntityNode, EpisodicNode, EpisodeType

import graphiti_core.embedder.client as _emb_mod

from . import bitemporal as bt
from .graphiti_factory import get_driver, write_lock
from .local_embedder import EMBEDDING_DIM_LOCAL, LocalEmbedder
from .local_nlp import deduplicate_entities, extract_entities, extract_relationships

logger = logging.getLogger(__name__)

_embedder = LocalEmbedder()


async def _get_existing_entity_names(group_id: str) -> list[str]:
    """Fetch names of all EntityNodes already in this session's graph."""
    driver = get_driver()
    try:
        nodes = await EntityNode.get_by_group_ids(driver, [group_id])
        return [n.name for n in nodes]
    except Exception:  # noqa: BLE001 — empty group raises
        return []


async def _find_or_create_entity(
    group_id: str,
    name: str,
    label: str,
    existing_map: dict[str, EntityNode],
) -> EntityNode:
    """Return an existing node if one matches by name, otherwise create + save a new one."""
    key = name.lower()
    if key in existing_map:
        return existing_map[key]

    node = EntityNode(
        uuid=str(uuid4()),
        name=name,
        group_id=group_id,
        labels=[label],
        summary=f"{label}: {name}",
        created_at=datetime.now(timezone.utc),
    )
    # Generate embedding and save
    await node.generate_name_embedding(_embedder)
    await node.save(get_driver())

    existing_map[key] = node
    logger.debug("Created entity node: %s (%s)", name, label)
    return node


async def local_add_episode(
    group_id: str,
    name: str,
    body: str,
    source_description: str,
) -> None:
    """Ingest one chunk of text using local NLP — no LLM needed.

    1. Extract entities via spaCy NER
    2. Deduplicate against existing session nodes
    3. Create EntityNode objects with fastembed name embeddings
    4. Extract relationships via dependency parsing
    5. Create EntityEdge objects with fastembed fact embeddings
    6. Create an EpisodicNode for the raw episode
    7. Save everything to Kuzu via .save(driver)
    """
    driver = get_driver()
    now = datetime.now(timezone.utc)

    # Set EMBEDDING_DIM for local model (384-dim bge-small)
    _emb_mod.EMBEDDING_DIM = EMBEDDING_DIM_LOCAL

    # Step 1: Extract entities from text
    raw_entities = extract_entities(body)
    if not raw_entities:
        logger.info("No entities found in chunk: %s", name)
        # Still create the episodic node for the raw text
        episode = EpisodicNode(
            uuid=str(uuid4()),
            name=name,
            group_id=group_id,
            source=EpisodeType.text,
            source_description=source_description,
            content=body,
            valid_at=now,
            entity_edges=[],
            created_at=now,
        )
        await episode.save(driver)
        return

    # Step 2: Deduplicate against existing nodes in this session
    existing_names = await _get_existing_entity_names(group_id)
    new_entities = deduplicate_entities(raw_entities, existing_names)

    # Build a lookup of existing nodes by lowercase name
    existing_map: dict[str, EntityNode] = {}
    try:
        existing_nodes = await EntityNode.get_by_group_ids(driver, [group_id])
        for n in existing_nodes:
            existing_map[n.name.lower()] = n
    except Exception:  # noqa: BLE001
        pass

    # Step 3: Create new EntityNodes (deduped ones are skipped)
    for ent in new_entities:
        await _find_or_create_entity(
            group_id, ent["name"], ent["label"], existing_map
        )

    # Step 4: Extract relationships
    # Use ALL entities (not just new ones) for relationship extraction
    all_entities = raw_entities  # relationships may connect old + new nodes
    rels = extract_relationships(body, all_entities)

    # Step 5: Create EntityEdges
    edge_uuids: list[str] = []
    for rel in rels:
        src_key = rel["source_name"].lower()
        tgt_key = rel["target_name"].lower()

        src_node = existing_map.get(src_key)
        tgt_node = existing_map.get(tgt_key)

        if src_node is None or tgt_node is None:
            logger.debug(
                "Skipping edge %s→%s: node not found",
                rel["source_name"], rel["target_name"],
            )
            continue

        edge = EntityEdge(
            uuid=str(uuid4()),
            group_id=group_id,
            source_node_uuid=src_node.uuid,
            target_node_uuid=tgt_node.uuid,
            name=rel["relation_name"],
            fact=rel["fact"],
            episodes=[],
            created_at=now,
        )
        await edge.generate_embedding(_embedder)
        await edge.save(driver)
        edge_uuids.append(edge.uuid)
        logger.debug(
            "Created edge: %s -[%s]-> %s",
            rel["source_name"], rel["relation_name"], rel["target_name"],
        )

    # Step 6: Create EpisodicNode
    episode = EpisodicNode(
        uuid=str(uuid4()),
        name=name,
        group_id=group_id,
        source=EpisodeType.text,
        source_description=source_description,
        content=body,
        valid_at=now,
        entity_edges=edge_uuids,
        created_at=now,
    )
    await episode.save(driver)
    logger.info(
        "Local ingest '%s': %d entities, %d edges",
        name, len(new_entities), len(edge_uuids),
    )
    await bt.sync_group(driver, group_id)
