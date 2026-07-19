from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlmodel import Field, Session as DBSession, SQLModel, select

from .config import DEFAULT_MODELS, settings
from .db import engine


class GraphSession(SQLModel, table=True):
    """A session == one Graphiti graph (its id is used as the Graphiti group_id)."""

    id: str = Field(default_factory=lambda: uuid.uuid4().hex, primary_key=True)
    name: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    provider: str = Field(default="local")
    llm_model: str = ""
    embedder_model: str = ""
    # Only used when provider has no native embeddings (e.g. anthropic): openai | ollama
    embedder_provider: str = ""
    # Embedding vector dimension: 384 for local (bge-small), 1024 for cloud providers.
    # Set on creation; prevents provider switching on sessions that already have nodes.
    embedding_dim: int = Field(default=0)


def _fill_defaults(s: GraphSession) -> GraphSession:
    defaults = DEFAULT_MODELS.get(s.provider, DEFAULT_MODELS.get("openai", {}))
    if not s.llm_model:
        s.llm_model = defaults.get("llm", "")
    if not s.embedder_model:
        s.embedder_model = defaults.get("embedder", "")
    if s.provider == "anthropic" and not s.embedder_provider:
        s.embedder_provider = "openai"
    if s.embedding_dim == 0:
        # local and openrouter both use LocalEmbedder (384-dim fastembed)
        s.embedding_dim = 384 if s.provider in ("local", "openrouter", "deepseek") else 1024
    return s


def create_session(
    name: str,
    provider: str | None = None,
    llm_model: str = "",
    embedder_model: str = "",
    embedder_provider: str = "",
) -> GraphSession:
    s = GraphSession(
        name=name,
        provider=provider or settings.default_llm_provider,
        llm_model=llm_model,
        embedder_model=embedder_model,
        embedder_provider=embedder_provider,
    )
    _fill_defaults(s)
    with DBSession(engine) as db:
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def list_sessions() -> list[GraphSession]:
    with DBSession(engine) as db:
        return list(db.exec(select(GraphSession).order_by(GraphSession.created_at.desc())))


def get_session(session_id: str) -> GraphSession | None:
    with DBSession(engine) as db:
        return db.get(GraphSession, session_id)


def update_session(session_id: str, **fields) -> GraphSession | None:
    with DBSession(engine) as db:
        s = db.get(GraphSession, session_id)
        if s is None:
            return None
        for k, v in fields.items():
            if v is not None and hasattr(s, k):
                setattr(s, k, v)
        _fill_defaults(s)
        db.add(s)
        db.commit()
        db.refresh(s)
        return s


def delete_session_row(session_id: str) -> bool:
    with DBSession(engine) as db:
        s = db.get(GraphSession, session_id)
        if s is None:
            return False
        db.delete(s)
        db.commit()
        return True
