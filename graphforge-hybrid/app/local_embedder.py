"""Local embedding client using fastembed (ONNX, no PyTorch).

Wraps BAAI/bge-small-en-v1.5 (33 MB ONNX model, 384-dim vectors) behind
Graphiti's EmbedderClient interface so search, dedup, and manual node
creation all work without any cloud API key.
"""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Iterable
from typing import Any

from graphiti_core.embedder.client import EmbedderClient

logger = logging.getLogger(__name__)

# Lazy-loaded model (cached after first call)
_model = None
_MODEL_NAME = "BAAI/bge-small-en-v1.5"
EMBEDDING_DIM_LOCAL = 384


def _get_model():
    global _model
    if _model is None:
        from fastembed import TextEmbedding

        _model = TextEmbedding(_MODEL_NAME)
        logger.info("fastembed %s loaded (dim=%d)", _MODEL_NAME, EMBEDDING_DIM_LOCAL)
    return _model


def _embed_sync(texts: list[str]) -> list[list[float]]:
    """Run fastembed synchronously (it's CPU-bound ONNX inference)."""
    model = _get_model()
    # fastembed.embed() returns a generator of numpy arrays
    return [vec.tolist() for vec in model.embed(texts)]


class LocalEmbedder(EmbedderClient):
    """EmbedderClient backed by fastembed BAAI/bge-small-en-v1.5 (384-dim ONNX)."""

    async def create(
        self, input_data: str | list[str] | Iterable[int] | Iterable[Iterable[int]]
    ) -> list[float]:
        """Embed a single text (or the first element of a list) → 384-dim vector."""
        if isinstance(input_data, str):
            texts = [input_data]
        elif isinstance(input_data, list) and input_data and isinstance(input_data[0], str):
            texts = [input_data[0]]  # graphiti passes [text] and expects a single vector back
        else:
            # Fallback: stringify whatever we got
            texts = [str(input_data)]

        vecs = await asyncio.to_thread(_embed_sync, texts)
        return vecs[0]

    async def create_batch(self, input_data_list: list[str]) -> list[list[float]]:
        """Embed multiple texts at once → list of 384-dim vectors."""
        if not input_data_list:
            return []
        return await asyncio.to_thread(_embed_sync, input_data_list)
