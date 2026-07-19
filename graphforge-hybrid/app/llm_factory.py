from __future__ import annotations

from graphiti_core.cross_encoder.client import CrossEncoderClient
from graphiti_core.embedder.client import EmbedderClient
from graphiti_core.embedder.openai import OpenAIEmbedder, OpenAIEmbedderConfig
from graphiti_core.llm_client.client import LLMClient
from graphiti_core.llm_client.config import LLMConfig

from .config import DEFAULT_MODELS, get_api_key, settings
from .sessions import GraphSession

Clients = tuple[LLMClient, EmbedderClient, CrossEncoderClient]


class ProviderConfigError(Exception):
    """Raised when a session's provider is missing a required key/config."""


def _openai_reranker(api_key: str, model: str, base_url: str | None = None):
    from graphiti_core.cross_encoder.openai_reranker_client import OpenAIRerankerClient

    return OpenAIRerankerClient(config=LLMConfig(api_key=api_key, model=model, base_url=base_url))


def _openai_clients(api_key: str, llm_model: str, embedder_model: str) -> Clients:
    from graphiti_core.llm_client.openai_client import OpenAIClient

    llm = OpenAIClient(config=LLMConfig(api_key=api_key, model=llm_model))
    emb = OpenAIEmbedder(config=OpenAIEmbedderConfig(api_key=api_key, embedding_model=embedder_model))
    rer = _openai_reranker(api_key, llm_model)
    return llm, emb, rer


def _gemini_clients(api_key: str, llm_model: str, embedder_model: str) -> Clients:
    from graphiti_core.cross_encoder.gemini_reranker_client import GeminiRerankerClient
    from graphiti_core.embedder.gemini import GeminiEmbedder, GeminiEmbedderConfig
    from graphiti_core.llm_client.gemini_client import GeminiClient

    llm = GeminiClient(config=LLMConfig(api_key=api_key, model=llm_model))
    emb = GeminiEmbedder(config=GeminiEmbedderConfig(api_key=api_key, embedding_model=embedder_model))
    rer = GeminiRerankerClient(config=LLMConfig(api_key=api_key, model=llm_model))
    return llm, emb, rer


def _openrouter_clients(api_key: str, llm_model: str) -> Clients:
    """OpenRouter: OpenAI-compatible chat completions + local embeddings (no /embeddings endpoint).
    Uses JsonObjectClient because many OpenRouter models don't support json_schema mode."""
    from .json_object_client import JsonObjectClient
    from .local_embedder import LocalEmbedder
    from .local_reranker import LocalReranker

    llm = JsonObjectClient(
        config=LLMConfig(api_key=api_key, model=llm_model, base_url=settings.openrouter_base_url)
    )
    return llm, LocalEmbedder(), LocalReranker()


def _deepseek_clients(api_key: str, llm_model: str) -> Clients:
    """DeepSeek: OpenAI-compatible chat completions + local embeddings.
    Uses JsonObjectClient because DeepSeek doesn't support json_schema response_format."""
    from .json_object_client import JsonObjectClient
    from .local_embedder import LocalEmbedder
    from .local_reranker import LocalReranker

    llm = JsonObjectClient(
        config=LLMConfig(api_key=api_key, model=llm_model, base_url=settings.deepseek_base_url)
    )
    return llm, LocalEmbedder(), LocalReranker()


def _ollama_clients(llm_model: str, embedder_model: str) -> Clients:
    from graphiti_core.llm_client.openai_generic_client import OpenAIGenericClient

    base_url = settings.ollama_base_url
    llm = OpenAIGenericClient(config=LLMConfig(api_key="ollama", model=llm_model, base_url=base_url))
    emb = OpenAIEmbedder(
        config=OpenAIEmbedderConfig(api_key="ollama", embedding_model=embedder_model, base_url=base_url)
    )
    rer = _openai_reranker("ollama", llm_model, base_url=base_url)
    return llm, emb, rer


def _embedder_and_reranker_fallback(
    provider: str, embedder_model: str, llm_model: str
) -> tuple[EmbedderClient, CrossEncoderClient]:
    """For providers without native embeddings/reranking (anthropic)."""
    if provider == "ollama":
        emb = OpenAIEmbedder(
            config=OpenAIEmbedderConfig(
                api_key="ollama", embedding_model=embedder_model, base_url=settings.ollama_base_url
            )
        )
        rer = _openai_reranker("ollama", llm_model, base_url=settings.ollama_base_url)
        return emb, rer
    key = get_api_key("openai")
    if not key:
        raise ProviderConfigError(
            "Anthropic has no embedding/reranking model. Set an OpenAI API key (used only for "
            "embeddings + reranking) or set the session's embedder provider to 'ollama'."
        )
    emb = OpenAIEmbedder(config=OpenAIEmbedderConfig(api_key=key, embedding_model=embedder_model))
    rer = _openai_reranker(key, "gpt-4.1-mini")
    return emb, rer


def build_clients(s: GraphSession) -> Clients:
    provider = s.provider
    defaults = DEFAULT_MODELS.get(provider, DEFAULT_MODELS["openai"])
    llm_model = s.llm_model or defaults["llm"]
    embedder_model = s.embedder_model or defaults["embedder"]

    if provider == "local":
        from .local_embedder import LocalEmbedder
        from .local_reranker import LocalReranker

        # No LLM needed — local_ingest bypasses add_episode entirely.
        # We still need a placeholder LLM so graphiti engine init doesn't crash.
        from graphiti_core.llm_client.config import LLMConfig
        from graphiti_core.llm_client.openai_client import OpenAIClient

        llm = OpenAIClient(config=LLMConfig(api_key="noop"))
        return llm, LocalEmbedder(), LocalReranker()

    if provider == "openrouter":
        key = get_api_key("openrouter")
        if not key:
            raise ProviderConfigError("No OpenRouter API key set. Get one at openrouter.ai and add it in Settings.")
        return _openrouter_clients(key, llm_model)

    if provider == "deepseek":
        key = get_api_key("deepseek")
        if not key:
            raise ProviderConfigError("No DeepSeek API key set. Get one at platform.deepseek.com and add it in Settings.")
        return _deepseek_clients(key, llm_model)

    if provider == "openai":
        key = get_api_key("openai")
        if not key:
            raise ProviderConfigError("No OpenAI API key set. Add one in Settings.")
        return _openai_clients(key, llm_model, embedder_model)

    if provider == "gemini":
        key = get_api_key("gemini")
        if not key:
            raise ProviderConfigError("No Gemini (Google) API key set. Add one in Settings.")
        return _gemini_clients(key, llm_model, embedder_model)

    if provider == "ollama":
        return _ollama_clients(llm_model, embedder_model)

    if provider == "anthropic":
        from graphiti_core.llm_client.anthropic_client import AnthropicClient

        key = get_api_key("anthropic")
        if not key:
            raise ProviderConfigError("No Anthropic API key set. Add one in Settings.")
        llm = AnthropicClient(config=LLMConfig(api_key=key, model=llm_model))
        emb, rer = _embedder_and_reranker_fallback(
            s.embedder_provider or "openai", embedder_model, llm_model
        )
        return llm, emb, rer

    raise ProviderConfigError(f"Unknown provider: {provider}")


def config_signature(s: GraphSession) -> str:
    """Identity of a session's provider config, used to invalidate cached clients."""
    key_present = bool(get_api_key(s.provider)) if s.provider not in ("ollama", "local") else True
    # openrouter uses local embeddings (384-dim) so treat embedding_dim like local
    return f"{s.provider}|{s.llm_model}|{s.embedder_model}|{s.embedder_provider}|{key_present}"
