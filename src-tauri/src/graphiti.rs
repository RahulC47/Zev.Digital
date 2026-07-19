//! Graphiti sidecar — HTTP client for the Python knowledge-graph process.
//!
//! The sidecar is a PyInstaller-bundled FastAPI server that runs on localhost.
//! This module handles lifecycle (start / health-check / stop) and provides
//! typed request/response wrappers for every endpoint the Rust backend calls.

use crate::settings::{ChatProvider, GraphExtractionMode, Settings};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Default port the sidecar listens on (different from standalone GraphForge's 8765).
pub const DEFAULT_PORT: u16 = 8766;

fn base(port: u16) -> String {
    format!("http://127.0.0.1:{port}/api")
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_default()
}

// ── health ───────────────────────────────────────────────────────────────────

/// Returns true if the sidecar is running and responding.
pub async fn health_check(port: u16) -> bool {
    client()
        .get(format!("{}/health", base(port)))
        .timeout(Duration::from_secs(3))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

// ── configure ────────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct ConfigurePayload {
    extraction_mode: String,
    cloud_provider: String,
    ollama_url: String,
    byok_base_url: String,
    byok_api_key: String,
    byok_model: String,
}

pub async fn configure(port: u16, settings: &Settings) -> Result<()> {
    let mode = match settings.graph_extraction_mode {
        GraphExtractionMode::Local => "local",
        GraphExtractionMode::Cloud => "cloud",
    };
    // OpenRouter is sent as a BYOK endpoint with its fixed base URL — the
    // sidecar routes by URL substring ("openrouter" → its openrouter provider).
    let (cloud_provider, byok_base_url, byok_api_key, byok_model) = match settings.chat_provider {
        ChatProvider::Ollama => (
            "ollama",
            settings.byok_base_url.clone(),
            settings.byok_api_key.clone(),
            settings.byok_chat_model.clone(),
        ),
        ChatProvider::Openrouter => (
            "byok",
            crate::settings::OPENROUTER_BASE_URL.to_string(),
            settings.openrouter_api_key.clone(),
            settings.openrouter_model.clone(),
        ),
        ChatProvider::Byok => (
            "byok",
            settings.byok_base_url.clone(),
            settings.byok_api_key.clone(),
            settings.byok_chat_model.clone(),
        ),
    };
    let payload = ConfigurePayload {
        extraction_mode: mode.into(),
        cloud_provider: cloud_provider.into(),
        ollama_url: format!("{}/v1", settings.ollama_url),
        byok_base_url,
        byok_api_key,
        byok_model,
    };
    client()
        .post(format!("{}/configure", base(port)))
        .json(&payload)
        .send()
        .await?
        .error_for_status()?;
    Ok(())
}

// ── ingest ───────────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct IngestPayload {
    text: String,
    name: String,
    source_id: String,
    collection_id: String,
}

#[derive(Deserialize)]
pub struct IngestResponse {
    #[allow(dead_code)]
    pub job_id: String,
}

/// Send captured text to the sidecar for entity extraction. Fire-and-forget
/// from the caller's perspective — the Python side runs the heavy work in a
/// background task. The episode is tagged with source_id + collection_id.
pub async fn ingest(
    port: u16,
    text: &str,
    name: &str,
    source_id: &str,
    collection_id: &str,
) -> Result<IngestResponse> {
    let resp = client()
        .post(format!("{}/zev/ingest", base(port)))
        .json(&IngestPayload {
            text: text.to_string(),
            name: name.to_string(),
            source_id: source_id.to_string(),
            collection_id: collection_id.to_string(),
        })
        .send()
        .await?
        .error_for_status()?
        .json::<IngestResponse>()
        .await?;
    Ok(resp)
}

/// Join a collection-id list into the `collections` query param. Empty → "" (all).
fn collections_param(collections: &[String]) -> String {
    collections.join(",")
}

// ── search ───────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct GraphSearchResult {
    pub fact: String,
    pub name: String,
    pub source_description: String,
    pub valid_at: String,
    #[serde(default)]
    pub entities: Vec<String>,
}

#[derive(Deserialize)]
struct SearchResponse {
    results: Vec<GraphSearchResult>,
}

/// Semantic graph search, optionally scoped to a set of collections (empty = all).
/// Returns facts + entity names for the RAG prompt.
pub async fn search(
    port: u16,
    query: &str,
    limit: usize,
    collections: &[String],
) -> Result<Vec<GraphSearchResult>> {
    let resp = client()
        .get(format!("{}/zev/search", base(port)))
        .query(&[
            ("q", query),
            ("limit", &limit.to_string()),
            ("collections", &collections_param(collections)),
        ])
        .send()
        .await?
        .error_for_status()?
        .json::<SearchResponse>()
        .await?;
    Ok(resp.results)
}

// ── graph view ──────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, Serialize)]
pub struct GraphNode {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default, rename = "type")]
    pub node_type: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct GraphLink {
    #[serde(default)]
    pub id: String,
    pub source: String,
    pub target: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub fact: String,
    #[serde(default)]
    pub valid_at: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct GraphData {
    pub nodes: Vec<GraphNode>,
    pub links: Vec<GraphLink>,
}

/// Fetch the entity/relationship graph, optionally scoped to collections (empty = all).
pub async fn get_graph(port: u16, collections: &[String]) -> Result<GraphData> {
    let resp = client()
        .get(format!("{}/zev/graph", base(port)))
        .query(&[("collections", collections_param(collections))])
        .send()
        .await?
        .error_for_status()?
        .json::<GraphData>()
        .await?;
    Ok(resp)
}

/// Export the graph as markdown / json / cypher, scoped to collections (empty = all).
pub async fn export(port: u16, format: &str, collections: &[String]) -> Result<String> {
    let text = client()
        .get(format!("{}/zev/export", base(port)))
        .query(&[("format", format), ("collections", &collections_param(collections))])
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    Ok(text)
}

pub async fn delete_node(port: u16, uuid: &str) -> Result<()> {
    client()
        .delete(format!("{}/zev/node/{uuid}", base(port)))
        .send()
        .await?;
    Ok(())
}

pub async fn delete_edge(port: u16, uuid: &str) -> Result<()> {
    client()
        .delete(format!("{}/zev/edge/{uuid}", base(port)))
        .send()
        .await?;
    Ok(())
}

// ── manual node/edge creation ────────────────────────────────────────────────

#[derive(Serialize)]
struct CreateNodePayload {
    name: String,
    node_type: String,
    summary: String,
}

#[derive(Deserialize)]
pub struct CreatedNode {
    pub uuid: String,
}

pub async fn create_node(
    port: u16,
    name: &str,
    node_type: &str,
    summary: &str,
) -> Result<CreatedNode> {
    let resp = client()
        .post(format!("{}/zev/node", base(port)))
        .json(&CreateNodePayload {
            name: name.to_string(),
            node_type: node_type.to_string(),
            summary: summary.to_string(),
        })
        .send()
        .await?
        .error_for_status()?
        .json::<CreatedNode>()
        .await?;
    Ok(resp)
}

#[derive(Serialize)]
struct CreateEdgePayload {
    source_node_uuid: String,
    target_node_uuid: String,
    name: String,
    fact: String,
}

#[derive(Deserialize)]
pub struct CreatedEdge {
    pub uuid: String,
}

pub async fn create_edge(
    port: u16,
    source_node_uuid: &str,
    target_node_uuid: &str,
    name: &str,
    fact: &str,
) -> Result<CreatedEdge> {
    let resp = client()
        .post(format!("{}/zev/edge", base(port)))
        .json(&CreateEdgePayload {
            source_node_uuid: source_node_uuid.to_string(),
            target_node_uuid: target_node_uuid.to_string(),
            name: name.to_string(),
            fact: fact.to_string(),
        })
        .send()
        .await?
        .error_for_status()?
        .json::<CreatedEdge>()
        .await?;
    Ok(resp)
}

// ── file text extraction ─────────────────────────────────────────────────────

#[derive(Deserialize)]
struct TextResponse {
    #[serde(default)]
    text: String,
    #[serde(default)]
    error: Option<String>,
}

/// Extract plain text from a file (pdf / docx / text) via the sidecar's local
/// parsers. Bytes stay on-device (localhost).
pub async fn extract_file(port: u16, data: Vec<u8>, filename: &str) -> Result<String> {
    let part = reqwest::multipart::Part::bytes(data)
        .file_name(filename.to_string())
        .mime_str("application/octet-stream")?;
    let form = reqwest::multipart::Form::new().part("file", part);

    let resp = client()
        .post(format!("{}/zev/extract", base(port)))
        // Large PDFs can take a while to parse.
        .timeout(Duration::from_secs(120))
        .multipart(form)
        .send()
        .await?
        .error_for_status()?
        .json::<TextResponse>()
        .await?;

    if let Some(err) = resp.error {
        if !err.is_empty() {
            anyhow::bail!("extraction error: {err}");
        }
    }
    Ok(resp.text)
}

// ── delete / clear ───────────────────────────────────────────────────────────

pub async fn delete_source(port: u16, source_id: &str) -> Result<()> {
    client()
        .delete(format!("{}/zev/source/{source_id}", base(port)))
        .send()
        .await?;
    Ok(())
}

pub async fn clear(port: u16) -> Result<()> {
    client()
        .post(format!("{}/zev/clear", base(port)))
        .send()
        .await?;
    Ok(())
}
