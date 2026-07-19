//! Chat-only LLM access: local Ollama or a Bring-Your-Own-Key OpenAI-compatible
//! cloud endpoint.  Search/retrieval is done by SQLite FTS5 — no embedding needed.

use crate::settings::{ChatProvider, Settings};
use anyhow::{Context, Result};
use serde::Serialize;
use serde_json::json;

#[derive(Debug, Clone, Serialize)]
pub struct Health {
    pub ok: bool,
    /// "ollama" | "byok"
    pub provider: String,
    pub chat_model: String,
    pub message: String,
}

#[derive(Debug, Clone)]
pub struct ChatResult {
    pub text: String,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub provider: String,
    pub model: String,
}

enum Backend {
    Ollama { url: String },
    /// Any OpenAI-compatible cloud endpoint (OpenRouter or custom BYOK).
    /// `provider_name` keeps the health pill honest ("openrouter" vs "byok").
    Byok { base: String, key: String, provider_name: &'static str },
}

pub struct Llm {
    http: reqwest::Client,
    backend: Backend,
    chat_model: String,
}

impl Llm {
    pub fn from_settings(s: &Settings) -> Self {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .unwrap_or_default();
        match s.chat_provider {
            ChatProvider::Ollama => Llm {
                http,
                backend: Backend::Ollama {
                    url: s.ollama_url.trim_end_matches('/').to_string(),
                },
                chat_model: s.ollama_chat_model.clone(),
            },
            ChatProvider::Openrouter => Llm {
                http,
                backend: Backend::Byok {
                    base: crate::settings::OPENROUTER_BASE_URL.to_string(),
                    key: s.openrouter_api_key.clone(),
                    provider_name: "openrouter",
                },
                chat_model: s.openrouter_model.clone(),
            },
            ChatProvider::Byok => Llm {
                http,
                backend: Backend::Byok {
                    base: s.byok_base_url.trim_end_matches('/').to_string(),
                    key: s.byok_api_key.clone(),
                    provider_name: "byok",
                },
                chat_model: s.byok_chat_model.clone(),
            },
        }
    }

    pub fn with_model_override(mut self, model: &str) -> Self {
        if !model.is_empty() {
            self.chat_model = model.to_string();
        }
        self
    }

    pub async fn chat(&self, system: &str, user: &str, temperature: Option<f64>) -> Result<ChatResult> {
        match &self.backend {
            Backend::Ollama { url } => {
                let mut body = json!({
                    "model": self.chat_model,
                    "stream": false,
                    "messages": [
                        { "role": "system", "content": system },
                        { "role": "user",   "content": user   },
                    ],
                });
                if let Some(t) = temperature {
                    body["options"] = json!({ "temperature": t });
                }
                let v: serde_json::Value = self
                    .http
                    .post(format!("{url}/api/chat"))
                    .json(&body)
                    .send()
                    .await
                    .context("could not reach Ollama — is it running?")?
                    .error_for_status()?
                    .json()
                    .await?;
                let text = v.pointer("/message/content")
                    .and_then(|c| c.as_str())
                    .unwrap_or_default()
                    .to_string();
                let input_tokens = v.pointer("/prompt_eval_count").and_then(|n| n.as_i64());
                let output_tokens = v.pointer("/eval_count").and_then(|n| n.as_i64());
                Ok(ChatResult {
                    text,
                    input_tokens,
                    output_tokens,
                    provider: "ollama".into(),
                    model: self.chat_model.clone(),
                })
            }
            Backend::Byok { base, key, provider_name, .. } => {
                let mut body = json!({
                    "model": self.chat_model,
                    "messages": [
                        { "role": "system", "content": system },
                        { "role": "user",   "content": user   },
                    ],
                });
                if let Some(t) = temperature {
                    body["temperature"] = json!(t);
                }
                let v: serde_json::Value = self
                    .http
                    .post(format!("{base}/chat/completions"))
                    .bearer_auth(key)
                    .json(&body)
                    .send()
                    .await
                    .context("could not reach cloud endpoint")?
                    .error_for_status()?
                    .json()
                    .await?;
                let text = v.pointer("/choices/0/message/content")
                    .and_then(|c| c.as_str())
                    .unwrap_or_default()
                    .to_string();
                let input_tokens = v.pointer("/usage/prompt_tokens").and_then(|n| n.as_i64());
                let output_tokens = v.pointer("/usage/completion_tokens").and_then(|n| n.as_i64());
                Ok(ChatResult {
                    text,
                    input_tokens,
                    output_tokens,
                    provider: (*provider_name).into(),
                    model: self.chat_model.clone(),
                })
            }
        }
    }

    pub async fn health(&self) -> Health {
        match &self.backend {
            Backend::Ollama { url } => {
                match self.http.get(format!("{url}/api/tags")).send().await {
                    Ok(r) if r.status().is_success() => Health {
                        ok: true,
                        provider: "ollama".into(),
                        chat_model: self.chat_model.clone(),
                        message: "Connected to Ollama".into(),
                    },
                    Ok(r) => Health {
                        ok: false,
                        provider: "ollama".into(),
                        chat_model: self.chat_model.clone(),
                        message: format!("Ollama responded {}", r.status()),
                    },
                    Err(_) => Health {
                        ok: false,
                        provider: "ollama".into(),
                        chat_model: self.chat_model.clone(),
                        message: "Ollama not reachable — install it and run `ollama serve`".into(),
                    },
                }
            }
            Backend::Byok { key, provider_name, .. } => {
                if key.trim().is_empty() {
                    Health {
                        ok: false,
                        provider: (*provider_name).into(),
                        chat_model: self.chat_model.clone(),
                        message: "Add your API key in Settings".into(),
                    }
                } else {
                    Health {
                        ok: true,
                        provider: (*provider_name).into(),
                        chat_model: self.chat_model.clone(),
                        message: "API key set".into(),
                    }
                }
            }
        }
    }
}
