from __future__ import annotations

import os

from sqlmodel import SQLModel, create_engine

from .config import settings

# --- sqlite session registry (embedded, no server) ---
os.makedirs(os.path.dirname(settings.sqlite_path), exist_ok=True)
engine = create_engine(
    f"sqlite:///{settings.sqlite_path}",
    connect_args={"check_same_thread": False},
)


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    # Migrate existing DBs: add embedding_dim column if missing
    import sqlite3

    conn = sqlite3.connect(settings.sqlite_path)
    try:
        cols = [row[1] for row in conn.execute("PRAGMA table_info(graphsession)").fetchall()]
        if "embedding_dim" not in cols:
            conn.execute("ALTER TABLE graphsession ADD COLUMN embedding_dim INTEGER DEFAULT 0")
            conn.commit()
    finally:
        conn.close()
