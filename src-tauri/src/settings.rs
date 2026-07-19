//! User settings: chat provider and capture privacy controls.
//! Persisted as JSON in the app config dir.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ChatProvider {
    #[default]
    Ollama,
    Openrouter,
    Byok,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum GraphExtractionMode {
    #[default]
    Local,
    Cloud,
}

/// A named custom (OpenAI-compatible) API profile.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CustomApiProfile {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    // Chat
    /// Old settings.json used "provider"; the alias keeps it readable.
    #[serde(default, alias = "provider", alias = "chat_provider")]
    pub chat_provider: ChatProvider,

    #[serde(default = "d_ollama_url")]
    pub ollama_url: String,

    #[serde(default = "d_ollama_chat_model")]
    pub ollama_chat_model: String,

    #[serde(default = "d_byok_base_url")]
    pub byok_base_url: String,

    #[serde(default)]
    pub byok_api_key: String,

    #[serde(default = "d_byok_chat_model")]
    pub byok_chat_model: String,

    #[serde(default)]
    pub openrouter_api_key: String,

    #[serde(default = "d_openrouter_model")]
    pub openrouter_model: String,

    // Knowledge graph extraction
    #[serde(default)]
    pub graph_extraction_mode: GraphExtractionMode,

    // Capture
    #[serde(default)]
    pub capture_paused: bool,

    /// Seconds between foreground reads when the continuous-capture loop runs.
    #[serde(default = "d_capture_interval_secs")]
    pub capture_interval_secs: u64,

    /// Collection new captures are filed into (the "active" collection).
    #[serde(default = "d_active_collection")]
    pub active_collection_id: String,

    #[serde(default = "d_denylist")]
    pub denylist: Vec<String>,

    /// Never capture Incognito / InPrivate / Private Browsing windows.
    #[serde(default = "d_true")]
    pub skip_private_browsing: bool,

    // Langfuse observability (opt-in cloud export)
    #[serde(default)]
    pub langfuse_enabled: bool,

    #[serde(default)]
    pub langfuse_public_key: String,

    #[serde(default)]
    pub langfuse_secret_key: String,

    #[serde(default = "d_langfuse_host")]
    pub langfuse_host: String,

    /// Custom default system prompt for the general persona (empty = use built-in).
    #[serde(default)]
    pub default_system_prompt: String,

    /// Named custom OpenAI-compatible API profiles (BYOK multi-profile).
    #[serde(default)]
    pub custom_api_profiles: Vec<CustomApiProfile>,

    /// Index into custom_api_profiles that is currently active.
    #[serde(default)]
    pub active_custom_profile_idx: usize,
}

fn d_ollama_url() -> String { "http://localhost:11434".into() }
fn d_ollama_chat_model() -> String { "llama3.1:8b".into() }
fn d_byok_base_url() -> String { "https://api.openai.com/v1".into() }
fn d_byok_chat_model() -> String { "gpt-4o-mini".into() }
fn d_openrouter_model() -> String { "anthropic/claude-haiku-4.5".into() }

/// OpenRouter's fixed OpenAI-compatible base URL.
pub const OPENROUTER_BASE_URL: &str = "https://openrouter.ai/api/v1";
fn d_capture_interval_secs() -> u64 { 8 }
fn d_active_collection() -> String { "general".into() }
fn d_denylist() -> Vec<String> {
    vec!["1password".into(), "bitwarden".into(), "keepass".into()]
}
fn d_true() -> bool { true }
fn d_langfuse_host() -> String { "https://cloud.langfuse.com".into() }

impl Default for Settings {
    fn default() -> Self {
        Settings {
            chat_provider: ChatProvider::Ollama,
            ollama_url: d_ollama_url(),
            ollama_chat_model: d_ollama_chat_model(),
            byok_base_url: d_byok_base_url(),
            byok_api_key: String::new(),
            byok_chat_model: d_byok_chat_model(),
            openrouter_api_key: String::new(),
            openrouter_model: d_openrouter_model(),
            graph_extraction_mode: GraphExtractionMode::Local,
            capture_paused: false,
            capture_interval_secs: d_capture_interval_secs(),
            active_collection_id: d_active_collection(),
            denylist: d_denylist(),
            skip_private_browsing: true,
            langfuse_enabled: false,
            langfuse_public_key: String::new(),
            langfuse_secret_key: String::new(),
            langfuse_host: d_langfuse_host(),
            default_system_prompt: String::new(),
            custom_api_profiles: Vec::new(),
            active_custom_profile_idx: 0,
        }
    }
}

impl Settings {
    pub fn path(config_dir: &Path) -> PathBuf { config_dir.join("settings.json") }

    pub fn load(config_dir: &Path) -> Settings {
        std::fs::read_to_string(Self::path(config_dir))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, config_dir: &Path) -> anyhow::Result<()> {
        std::fs::create_dir_all(config_dir)?;
        std::fs::write(Self::path(config_dir), serde_json::to_string_pretty(self)?)?;
        Ok(())
    }
}
