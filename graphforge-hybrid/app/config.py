from __future__ import annotations

import os

from pydantic_settings import BaseSettings, SettingsConfigDict

# All persistent data lives under %LOCALAPPDATA%\GraphForge (Windows) or ~/.graphforge.
_appbase = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
APP_DATA_DIR = os.path.join(_appbase, "GraphForgeHybrid")
os.makedirs(APP_DATA_DIR, exist_ok=True)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    default_llm_provider: str = "local"
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    google_api_key: str = ""
    openrouter_api_key: str = ""
    deepseek_api_key: str = ""
    ollama_base_url: str = "http://localhost:11434/v1"
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    deepseek_base_url: str = "https://api.deepseek.com/v1"

    # "small" is noticeably better than "base" on accents and proper nouns
    # (client names, app names) for ~+1s latency — worth it for voice queries.
    whisper_model: str = "small"

    # Embedded stores (no server, no Docker).
    sqlite_path: str = os.path.join(APP_DATA_DIR, "graphforge.db")
    kuzu_path: str = os.path.join(APP_DATA_DIR, "graph.kuzu")


settings = Settings()


DEFAULT_MODELS: dict[str, dict[str, str]] = {
    "local": {"llm": "spacy:en_core_web_sm", "embedder": "bge-small-en-v1.5"},
    "openrouter": {"llm": "anthropic/claude-3.5-haiku", "embedder": "bge-small-en-v1.5"},
    "deepseek": {"llm": "deepseek-chat", "embedder": "bge-small-en-v1.5"},
    "openai": {"llm": "gpt-4.1-mini", "embedder": "text-embedding-3-small"},
    "anthropic": {"llm": "claude-3-5-sonnet-latest", "embedder": "text-embedding-3-small"},
    "gemini": {"llm": "gemini-2.0-flash", "embedder": "gemini-embedding-001"},
    "ollama": {"llm": "llama3.1:8b", "embedder": "nomic-embed-text"},
}


_keyring: dict[str, str] = {
    "openai": settings.openai_api_key,
    "anthropic": settings.anthropic_api_key,
    "gemini": settings.google_api_key,
    "openrouter": settings.openrouter_api_key,
    "deepseek": settings.deepseek_api_key,
}


def get_api_key(provider: str) -> str:
    return _keyring.get(provider, "")


def set_api_key(provider: str, key: str) -> None:
    _keyring[provider] = key


def keyring_status() -> dict[str, bool]:
    return {p: bool(v) for p, v in _keyring.items()}
