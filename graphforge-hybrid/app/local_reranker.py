"""Local cross-encoder/reranker using cosine similarity from the same fastembed model.

Avoids pulling in sentence-transformers (PyTorch). Instead, we embed the query
and each passage with the same BAAI/bge-small-en-v1.5 model and rank by cosine
similarity. Accuracy is lower than a true cross-encoder but sufficient for
local-mode search without any API key.
"""
from __future__ import annotations

import logging

from graphiti_core.cross_encoder.client import CrossEncoderClient

from .local_embedder import LocalEmbedder

logger = logging.getLogger(__name__)


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


class LocalReranker(CrossEncoderClient):
    """Rank passages by cosine similarity to the query using fastembed embeddings."""

    def __init__(self) -> None:
        self._embedder = LocalEmbedder()

    async def rank(self, query: str, passages: list[str]) -> list[tuple[str, float]]:
        if not passages:
            return []

        # Embed query + all passages in one batch for efficiency
        all_texts = [query] + passages
        all_vecs = await self._embedder.create_batch(all_texts)
        query_vec = all_vecs[0]

        scored: list[tuple[str, float]] = []
        for passage, vec in zip(passages, all_vecs[1:]):
            score = _cosine_similarity(query_vec, vec)
            scored.append((passage, score))

        # Sort descending by score
        scored.sort(key=lambda x: x[1], reverse=True)
        return scored
