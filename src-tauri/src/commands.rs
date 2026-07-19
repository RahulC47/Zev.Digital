//! Tauri command surface — the IPC bridge between the React frontend and Rust.

use crate::capture::CaptureProvider;
use crate::chunk;
use crate::graphiti;
use crate::langfuse;
use crate::llm::{ChatResult, Health, Llm};
use crate::settings::Settings;
use crate::vault::{self, Expert, LlmTrace, Retrieved, SourceMeta};
use chrono::Utc;
use rusqlite::Connection;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State};

/// How many source snippets to feed the model as RAG context.
const TOP_K: usize = 5;

// ── app state ─────────────────────────────────────────────────────────────────

pub struct AppState {
    pub config_dir: PathBuf,
    pub vault_dir: PathBuf,
    pub db: Mutex<Connection>,
    pub settings: Mutex<Settings>,
    pub capture: Box<dyn CaptureProvider>,
    /// Port the Graphiti sidecar listens on.
    pub sidecar_port: u16,
    /// Set to true once the sidecar passes a health check.
    pub sidecar_ready: Mutex<bool>,
    /// True while the background continuous-capture loop is running.
    pub capture_running: Arc<AtomicBool>,
    /// Join handle for the capture loop thread (so Stop can join it).
    pub capture_thread: Mutex<Option<std::thread::JoinHandle<()>>>,
}

// ── response types ────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct CaptureResult {
    pub source_id: String,
    pub app: String,
    pub window_title: String,
    pub char_count: i64,
    pub chunk_count: i64,
    /// Page URL when captured from a browser.
    pub url: Option<String>,
    /// True when an existing source was updated in place (session coalescing)
    /// rather than a new source created.
    pub updated: bool,
}

#[derive(Clone, Serialize)]
pub struct Citation {
    pub source_id: String,
    pub app: String,
    pub window_title: String,
    pub captured_at: String,
    pub snippet: String,
    pub score: f32,
    pub url: Option<String>,
}

#[derive(Serialize)]
pub struct Answer {
    pub text: String,
    pub citations: Vec<Citation>,
}

#[derive(Serialize)]
pub struct CouncilResponse {
    pub expert_id: String,
    pub expert_name: String,
    pub expert_icon: String,
    pub answer: Answer,
}

#[derive(Serialize)]
pub struct GraphitiHealthResponse {
    pub ready: bool,
    pub message: String,
}

// ── helpers ───────────────────────────────────────────────────────────────────

fn estr<E: std::fmt::Display>(e: E) -> String { e.to_string() }

fn snapshot_settings(state: &State<AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

const ZEV_PROMPT_PREFIX: &str = "You are Contxt, a private assistant.";

/// Compose a system prompt: if an expert is selected its prompt replaces the
/// default preamble; the context-specific instructions (how to use RAG results)
/// and any project instructions are always appended. `default_prompt` overrides
/// the built-in preamble when the user has customised the default persona.
fn compose_system_prompt(
    context_instructions: &str,
    expert: Option<&Expert>,
    project_instructions: &str,
    default_prompt: &str,
) -> String {
    let base = if default_prompt.is_empty() { ZEV_PROMPT_PREFIX } else { default_prompt };
    let mut prompt = if let Some(exp) = expert {
        format!("{} {}", exp.system_prompt.trim(), context_instructions)
    } else {
        format!("{} {}", base, context_instructions)
    };
    if !project_instructions.is_empty() {
        prompt.push_str("\n\nProject context:\n");
        prompt.push_str(project_instructions);
    }
    prompt
}

fn is_sidecar_ready(state: &State<AppState>) -> bool {
    *state.sidecar_ready.lock().unwrap()
}

/// FTS5 search path + formatting — used as the fallback when the sidecar is
/// unavailable or returns empty results. Optionally scoped to a set of
/// collections (empty = search the whole vault).
fn fts5_search_context(
    state: &State<AppState>,
    question: &str,
    collections: &[String],
) -> Result<(Vec<Retrieved>, bool), String> {
    let conn = state.db.lock().unwrap();
    let allowed: Option<std::collections::HashSet<String>> = if collections.is_empty() {
        None
    } else {
        Some(
            vault::source_ids_in_collections(&conn, collections)
                .map_err(estr)?
                .into_iter()
                .collect(),
        )
    };

    let mut hits = vault::search(&conn, question, TOP_K * 3).map_err(estr)?;
    if let Some(set) = &allowed {
        hits.retain(|h| set.contains(&h.source_id));
    }
    hits.truncate(TOP_K);

    if hits.is_empty() {
        let mut recent = vault::recent_context(&conn, TOP_K * 3).map_err(estr)?;
        if let Some(set) = &allowed {
            recent.retain(|r| set.contains(&r.source_id));
        }
        recent.truncate(TOP_K);
        Ok((recent, true))
    } else {
        Ok((hits, false))
    }
}

// ── commands ──────────────────────────────────────────────────────────────────

fn capture_opts(state: &AppState) -> crate::capture::CaptureOpts {
    let s = state.settings.lock().unwrap();
    crate::capture::CaptureOpts { skip_private_browsing: s.skip_private_browsing }
}

fn check_denylist(state: &AppState, app: &str) -> Result<(), String> {
    let settings = state.settings.lock().unwrap();
    let app_lc = app.to_lowercase();
    let denylisted = settings
        .denylist
        .iter()
        .any(|d| !d.trim().is_empty() && app_lc.contains(&d.to_lowercase()));
    if denylisted {
        return Err(format!("\"{app}\" is on your do-not-capture list."));
    }
    Ok(())
}

/// Read the foreground window's text and apply the denylist.
/// Returns the raw captured data, or an Err for denylisted / self / inaccessible
/// windows. Used by the manual capture command.
pub(crate) fn read_foreground(state: &AppState) -> Result<crate::capture::Captured, String> {
    // Synchronous COM read; returns owned data. The provider already refuses
    // to capture Zev itself and maps UIAutomation errors to friendly messages.
    let cap = state.capture.capture(&capture_opts(state)).map_err(estr)?;
    check_denylist(state, &cap.app)?;
    Ok(cap)
}

/// Read a specific top-level window (by native handle) and apply the denylist.
/// Used by the background loop, which probes the foreground window cheaply
/// first and only then pays for the full accessibility walk.
pub(crate) fn read_foreground_hwnd(
    state: &AppState,
    hwnd: isize,
) -> Result<crate::capture::Captured, String> {
    let cap = state
        .capture
        .capture_window(hwnd, &capture_opts(state))
        .map_err(estr)?;
    check_denylist(state, &cap.app)?;
    Ok(cap)
}

/// Persist already-normalized capture text: source row + markdown mirror + FTS
/// chunks, then fire-and-forget the Graphiti ingest. Shared by both callers.
pub(crate) fn persist_normalized(
    state: &AppState,
    app: &str,
    window_title: &str,
    url: Option<&str>,
    normalized: &str,
) -> Result<CaptureResult, String> {
    if normalized.trim().is_empty() {
        return Err(
            "No readable text was exposed by that window's accessibility tree.".to_string(),
        );
    }
    let chunks = chunk::chunk(normalized, 800, 80);

    let collection_id = {
        let s = state.settings.lock().unwrap();
        if s.active_collection_id.trim().is_empty() {
            vault::DEFAULT_COLLECTION_ID.to_string()
        } else {
            s.active_collection_id.clone()
        }
    };

    let id = uuid::Uuid::new_v4().to_string();
    let meta = SourceMeta {
        id: id.clone(),
        app: app.to_string(),
        window_title: window_title.to_string(),
        captured_at: Utc::now().to_rfc3339(),
        chunk_count: chunks.len() as i64,
        char_count: normalized.chars().count() as i64,
        collection_id: collection_id.clone(),
        url: url.map(|u| u.to_string()),
    };

    let md_path = vault::write_markdown(&state.vault_dir, &meta, normalized)
        .map_err(estr)?
        .to_string_lossy()
        .to_string();

    {
        let conn = state.db.lock().unwrap();
        vault::insert_source(&conn, &meta, Some(&md_path)).map_err(estr)?;
        for (i, text) in chunks.iter().enumerate() {
            vault::insert_chunk(&conn, &id, i, text).map_err(estr)?;
        }
    }

    // Fire-and-forget: send to Graphiti sidecar for entity extraction. The
    // episode is tagged with both source_id and collection_id so the single
    // merged "brain" graph can be filtered per collection later.
    spawn_graphiti_ingest(state, normalized, app, window_title, url, &id, &collection_id);

    Ok(CaptureResult {
        source_id: id,
        app: app.to_string(),
        window_title: window_title.to_string(),
        char_count: meta.char_count,
        chunk_count: meta.chunk_count,
        url: meta.url,
        updated: false,
    })
}

/// Replace an existing source's content in place — the session-coalescing path:
/// while the user keeps working in the same window, the capture loop grows one
/// source instead of stacking near-duplicate snapshots.
pub(crate) fn update_capture(
    state: &AppState,
    source_id: &str,
    app: &str,
    window_title: &str,
    url: Option<&str>,
    normalized: &str,
    graphiti_text: Option<&str>,
) -> Result<CaptureResult, String> {
    if normalized.trim().is_empty() {
        return Err("Empty capture.".to_string());
    }
    let chunks = chunk::chunk(normalized, 800, 80);
    let captured_at = Utc::now().to_rfc3339();
    let char_count = normalized.chars().count() as i64;

    let collection_id = {
        let s = state.settings.lock().unwrap();
        if s.active_collection_id.trim().is_empty() {
            vault::DEFAULT_COLLECTION_ID.to_string()
        } else {
            s.active_collection_id.clone()
        }
    };

    {
        let conn = state.db.lock().unwrap();
        vault::update_source_text(&conn, source_id, &captured_at, char_count, &chunks)
            .map_err(estr)?;
    }

    // The markdown mirror path is derived from the source id, so writing with
    // the same id replaces the file in place.
    let meta = SourceMeta {
        id: source_id.to_string(),
        app: app.to_string(),
        window_title: window_title.to_string(),
        captured_at,
        chunk_count: chunks.len() as i64,
        char_count,
        collection_id: collection_id.clone(),
        url: url.map(|u| u.to_string()),
    };
    let _ = vault::write_markdown(&state.vault_dir, &meta, normalized);

    // Graphiti: the caller decides what (if anything) to ingest — usually just
    // the appended delta, to avoid re-extracting a growing document each pass.
    if let Some(delta) = graphiti_text {
        spawn_graphiti_ingest(state, delta, app, window_title, url, source_id, &collection_id);
    }

    Ok(CaptureResult {
        source_id: source_id.to_string(),
        app: app.to_string(),
        window_title: window_title.to_string(),
        char_count,
        chunk_count: meta.chunk_count,
        url: meta.url,
        updated: true,
    })
}

fn spawn_graphiti_ingest(
    state: &AppState,
    text: &str,
    app: &str,
    window_title: &str,
    url: Option<&str>,
    source_id: &str,
    collection_id: &str,
) {
    if !*state.sidecar_ready.lock().unwrap() {
        return;
    }
    if text.trim().is_empty() {
        return;
    }
    let port = state.sidecar_port;
    let graphiti_text = text.to_string();
    let graphiti_name = match url {
        Some(u) => format!("{app} — {window_title} ({u})"),
        None => format!("{app} — {window_title}"),
    };
    let source_id = source_id.to_string();
    let coll = collection_id.to_string();
    tauri::async_runtime::spawn(async move {
        if let Err(e) =
            graphiti::ingest(port, &graphiti_text, &graphiti_name, &source_id, &coll).await
        {
            log::warn!("Graphiti ingest failed (non-fatal): {e}");
        }
    });
}

/// One-shot capture: read foreground → normalize → persist. Used by the manual
/// command and (with dedup handled by the caller) the background loop.
pub fn perform_capture(state: &AppState) -> Result<CaptureResult, String> {
    let cap = read_foreground(state)?;
    let normalized = chunk::normalize(&cap.text);
    persist_normalized(state, &cap.app, &cap.window_title, cap.url.as_deref(), &normalized)
}

#[tauri::command]
pub async fn capture_active_window(state: State<'_, AppState>) -> Result<CaptureResult, String> {
    perform_capture(&state)
}

// ── file import ──────────────────────────────────────────────────────────────

/// Extensions we can decode as plain text without the sidecar.
fn is_plain_text_ext(ext: &str) -> bool {
    matches!(
        ext,
        "txt" | "md" | "markdown" | "csv" | "tsv" | "json" | "yaml" | "yml" | "toml" | "xml"
            | "html" | "htm" | "log" | "rs" | "py" | "js" | "ts" | "tsx" | "jsx" | "java" | "c"
            | "cpp" | "h" | "cs" | "go" | "rb" | "php" | "sql" | "sh" | "ps1" | "bat" | "ini"
    )
}

/// Import a file from disk into the brain: extract text (locally for plain
/// text, via the sidecar's parsers for pdf/docx), then run it through the
/// normal capture pipeline (FTS + markdown mirror + graph ingest).
#[tauri::command]
pub async fn import_file(state: State<'_, AppState>, path: String) -> Result<CaptureResult, String> {
    let p = PathBuf::from(&path);
    let filename = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    let ext = p
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let bytes = std::fs::read(&p).map_err(|e| format!("Couldn't read \"{filename}\": {e}"))?;
    if bytes.is_empty() {
        return Err(format!("\"{filename}\" is empty."));
    }
    if bytes.len() > 500 * 1024 * 1024 {
        return Err(format!("\"{filename}\" is over 500 MB — too large to import."));
    }

    let text = if is_plain_text_ext(&ext) {
        String::from_utf8_lossy(&bytes).to_string()
    } else {
        // pdf / docx / anything else → sidecar parsers (pypdf, python-docx).
        if !is_sidecar_ready(&state) {
            return Err(
                "File parsing isn't ready yet — the local brain is still warming up. Try again in a moment.".into(),
            );
        }
        graphiti::extract_file(state.sidecar_port, bytes, &filename)
            .await
            .map_err(estr)?
    };

    let normalized = chunk::normalize(&text);
    if normalized.trim().is_empty() {
        return Err(format!(
            "No text could be extracted from \"{filename}\" (scanned/image-only PDFs aren't supported yet)."
        ));
    }
    persist_normalized(&state, "File upload", &filename, None, &normalized)
}

/// Return the full captured text of a source (its markdown mirror file).
#[tauri::command]
pub fn read_source_text(state: State<AppState>, source_id: String) -> Result<String, String> {
    let md_path: Option<String> = {
        let conn = state.db.lock().unwrap();
        conn.query_row(
            "SELECT md_path FROM sources WHERE id = ?1",
            [&source_id],
            |r| r.get(0),
        )
        .map_err(|_| "Source not found.".to_string())?
    };
    let Some(md_path) = md_path else {
        return Err("This source has no saved full-text file.".into());
    };
    std::fs::read_to_string(&md_path).map_err(|e| format!("Couldn't read the full text: {e}"))
}

// ── continuous capture loop ─────────────────────────────────────────────────

#[derive(Serialize)]
pub struct CaptureLoopStatus {
    pub running: bool,
}

/// Start the background capture loop on a dedicated thread (idempotent).
#[tauri::command]
pub fn start_capture_loop(app: AppHandle, state: State<AppState>) -> Result<CaptureLoopStatus, String> {
    let mut handle_slot = state.capture_thread.lock().unwrap();
    if handle_slot.as_ref().map(|h| !h.is_finished()).unwrap_or(false) {
        return Ok(CaptureLoopStatus { running: true }); // already running
    }
    state.capture_running.store(true, Ordering::SeqCst);
    let running = state.capture_running.clone();
    let app_handle = app.clone();
    let handle = std::thread::spawn(move || {
        crate::capture_loop::run(app_handle, running);
    });
    *handle_slot = Some(handle);
    Ok(CaptureLoopStatus { running: true })
}

/// Stop the loop and join its thread (returns within one poll interval).
#[tauri::command]
pub fn stop_capture_loop(state: State<AppState>) -> Result<CaptureLoopStatus, String> {
    state.capture_running.store(false, Ordering::SeqCst);
    let handle = state.capture_thread.lock().unwrap().take();
    if let Some(h) = handle {
        let _ = h.join();
    }
    Ok(CaptureLoopStatus { running: false })
}

#[tauri::command]
pub fn capture_loop_status(state: State<AppState>) -> Result<CaptureLoopStatus, String> {
    Ok(CaptureLoopStatus {
        running: state.capture_running.load(Ordering::SeqCst),
    })
}

#[tauri::command]
pub async fn ask(
    state: State<'_, AppState>,
    question: String,
    collections: Option<Vec<String>>,
    source_ids: Option<Vec<String>>,
    expert_id: Option<String>,
) -> Result<Answer, String> {
    let settings = snapshot_settings(&state);
    let source_ids = source_ids.unwrap_or_default();

    // Load expert + resolve collection scope.
    let expert: Option<Expert> = expert_id.and_then(|eid| {
        let conn = state.db.lock().unwrap();
        vault::get_expert(&conn, &eid).ok().flatten()
    });
    let collections = if let Some(ref exp) = expert {
        if let Some(ref scope) = exp.collection_scope {
            vec![scope.clone()]
        } else {
            collections.unwrap_or_default()
        }
    } else {
        collections.unwrap_or_default()
    };

    // Load project instructions when a single collection is in scope.
    let project_instructions = if collections.len() == 1 {
        let conn = state.db.lock().unwrap();
        vault::get_collection_instructions(&conn, &collections[0]).unwrap_or_default()
    } else {
        String::new()
    };

    let temperature = expert.as_ref().and_then(|e| e.temperature);
    let llm = {
        let mut l = Llm::from_settings(&settings);
        if let Some(ref exp) = expert {
            if let Some(ref m) = exp.model_override {
                l = l.with_model_override(m);
            }
        }
        l
    };

    // ── Source-pinned: FTS5 scoped to specific sources chosen by the user ─
    if !source_ids.is_empty() {
        let pinned: std::collections::HashSet<String> = source_ids.into_iter().collect();
        let retrieved = {
            let conn = state.db.lock().unwrap();
            let mut hits = vault::search(&conn, &question, TOP_K * 3).map_err(estr)?;
            hits.retain(|h| pinned.contains(&h.source_id));
            if hits.is_empty() {
                let mut recent = vault::recent_context(&conn, TOP_K * 3).map_err(estr)?;
                recent.retain(|r| pinned.contains(&r.source_id));
                recent.truncate(TOP_K);
                recent
            } else {
                hits.truncate(TOP_K);
                hits
            }
        };
        if retrieved.is_empty() {
            return Ok(Answer {
                text: "No content found in the selected sources. Try uploading or capturing them first.".to_string(),
                citations: vec![],
            });
        }
        let context = retrieved
            .iter()
            .enumerate()
            .map(|(i, r)| {
                format!("[{}] {} — {} ({})\n{}", i + 1, r.app, r.window_title, r.captured_at, r.snippet)
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        let system = compose_system_prompt(
            "Answer ONLY using the captured context from the specific sources the user selected. \
             Cite the source name and time. If the answer is not in the context, say you don't have it in those sources.",
            expert.as_ref(),
            &project_instructions,
            &settings.default_system_prompt,
        );
        let user_prompt = format!("Captured context:\n{context}\n\nQuestion: {question}");
        let t0 = std::time::Instant::now();
        let result = llm.chat(&system, &user_prompt, temperature).await;
        let latency = t0.elapsed().as_millis() as i64;
        record_trace(&state, "chat", &system, &user_prompt, &result, latency);
        let cr = result.map_err(estr)?;
        let citations = retrieved
            .into_iter()
            .map(|r| Citation {
                source_id: r.source_id,
                app: r.app,
                window_title: r.window_title,
                captured_at: r.captured_at,
                snippet: truncate(&r.snippet, 240),
                score: r.score,
                url: r.url,
            })
            .collect();
        return Ok(Answer { text: cr.text, citations });
    }

    // ── Primary path: Graphiti semantic graph search ──────────────────────
    if is_sidecar_ready(&state) {
        if let Ok(results) =
            graphiti::search(state.sidecar_port, &question, TOP_K, &collections).await
        {
            if !results.is_empty() {
                let context = results
                    .iter()
                    .enumerate()
                    .map(|(i, r)| {
                        let ent = if r.entities.is_empty() {
                            String::new()
                        } else {
                            format!("\nEntities: {}", r.entities.join(", "))
                        };
                        format!(
                            "[{}] {} ({}){}\n{}",
                            i + 1,
                            r.name,
                            r.valid_at,
                            ent,
                            r.fact
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n\n");

                let system = compose_system_prompt(
                    "Answer using the knowledge graph facts and entities from the user's captured work. \
                     Cite specific facts. If the answer is not in the context, say you don't have it in memory. Be concise.",
                    expert.as_ref(),
                    &project_instructions,
                    &settings.default_system_prompt,
                );
                let user_prompt = format!("Knowledge graph context:\n{context}\n\nQuestion: {question}");

                let t0 = std::time::Instant::now();
                let result = llm.chat(&system, &user_prompt, temperature).await;
                let latency = t0.elapsed().as_millis() as i64;
                record_trace(&state, "chat", &system, &user_prompt, &result, latency);
                let cr = result.map_err(estr)?;

                let citations = results
                    .into_iter()
                    .map(|r| Citation {
                        source_id: String::new(),
                        app: String::new(),
                        window_title: r.name,
                        captured_at: r.valid_at,
                        snippet: truncate(&r.fact, 240),
                        score: 0.0,
                        url: None,
                    })
                    .collect();

                return Ok(Answer { text: cr.text, citations });
            }
        }
    }

    // ── Fallback: FTS5 BM25 search ──────────────────────────────────────
    let (retrieved, is_fallback) = fts5_search_context(&state, &question, &collections)?;

    if retrieved.is_empty() {
        return Ok(Answer {
            text: "Nothing has been captured yet. Open a document or app, click \
                   \"Capture current window\", then ask again."
                .to_string(),
            citations: vec![],
        });
    }

    let context = retrieved
        .iter()
        .enumerate()
        .map(|(i, r)| {
            format!(
                "[{}] {} — {} ({})\n{}",
                i + 1,
                r.app,
                r.window_title,
                r.captured_at,
                r.snippet
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    let ctx_instr = if is_fallback {
        "The user's question didn't match any specific captured text, so you are being shown the most \
         recently captured items. Use this context to answer questions about what has been captured \
         (app, window title, content preview). Be concise and helpful."
    } else {
        "Answer ONLY using the captured work context provided. If the answer is not in the context, \
         say you don't have it in memory. Be concise and specific."
    };
    let system = compose_system_prompt(ctx_instr, expert.as_ref(), &project_instructions, &settings.default_system_prompt);
    let user_prompt = format!("Captured context:\n{context}\n\nQuestion: {question}");

    let t0 = std::time::Instant::now();
    let result = llm.chat(&system, &user_prompt, temperature).await;
    let latency = t0.elapsed().as_millis() as i64;
    record_trace(&state, "chat", &system, &user_prompt, &result, latency);
    let cr = result.map_err(estr)?;

    let citations = retrieved
        .into_iter()
        .map(|r| Citation {
            source_id: r.source_id,
            app: r.app,
            window_title: r.window_title,
            captured_at: r.captured_at,
            snippet: truncate(&r.snippet, 240),
            score: r.score,
            url: r.url,
        })
        .collect();

    Ok(Answer { text: cr.text, citations })
}

#[tauri::command]
pub fn list_sources(state: State<AppState>) -> Result<Vec<SourceMeta>, String> {
    vault::list_sources(&state.db.lock().unwrap()).map_err(estr)
}

#[tauri::command]
pub async fn delete_source(state: State<'_, AppState>, source_id: String) -> Result<(), String> {
    let md_path = vault::delete_source(&state.db.lock().unwrap(), &source_id).map_err(estr)?;
    if let Some(p) = md_path {
        let _ = std::fs::remove_file(p);
    }
    // Fire-and-forget: remove from graph too
    if is_sidecar_ready(&state) {
        let port = state.sidecar_port;
        let sid = source_id.clone();
        tauri::async_runtime::spawn(async move {
            let _ = graphiti::delete_source(port, &sid).await;
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn clear_vault(state: State<'_, AppState>) -> Result<(), String> {
    vault::clear(&state.db.lock().unwrap()).map_err(estr)?;
    let _ = std::fs::remove_dir_all(state.vault_dir.join("markdown"));
    // Fire-and-forget: clear graph too
    if is_sidecar_ready(&state) {
        let port = state.sidecar_port;
        tauri::async_runtime::spawn(async move {
            let _ = graphiti::clear(port).await;
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn llm_health(state: State<'_, AppState>) -> Result<Health, String> {
    let settings = snapshot_settings(&state);
    Ok(Llm::from_settings(&settings).health().await)
}

/// List models installed in the local Ollama instance (GET /api/tags), so the
/// Settings UI can offer a picker instead of a free-text field.
#[tauri::command]
pub async fn list_ollama_models(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let url = {
        let s = state.settings.lock().unwrap();
        s.ollama_url.trim_end_matches('/').to_string()
    };
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(estr)?;
    let v: serde_json::Value = client
        .get(format!("{url}/api/tags"))
        .send()
        .await
        .map_err(|_| "Ollama not reachable — is it running?".to_string())?
        .error_for_status()
        .map_err(estr)?
        .json()
        .await
        .map_err(estr)?;
    let models = v
        .pointer("/models")
        .and_then(|m| m.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.pointer("/name").and_then(|n| n.as_str()))
                .map(String::from)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(models)
}

#[tauri::command]
pub async fn graphiti_health(state: State<'_, AppState>) -> Result<GraphitiHealthResponse, String> {
    let ready = is_sidecar_ready(&state);
    if ready {
        // Do a live check in case the sidecar crashed since startup.
        let live = graphiti::health_check(state.sidecar_port).await;
        if !live {
            *state.sidecar_ready.lock().unwrap() = false;
        }
        Ok(GraphitiHealthResponse {
            ready: live,
            message: if live {
                "Knowledge graph ready".into()
            } else {
                "Knowledge graph unavailable".into()
            },
        })
    } else {
        Ok(GraphitiHealthResponse {
            ready: false,
            message: "Knowledge graph warming up…".into(),
        })
    }
}

#[tauri::command]
pub async fn get_graph(
    state: State<'_, AppState>,
    collections: Option<Vec<String>>,
) -> Result<graphiti::GraphData, String> {
    if !is_sidecar_ready(&state) {
        return Ok(graphiti::GraphData {
            nodes: vec![],
            links: vec![],
        });
    }
    let collections = collections.unwrap_or_default();
    graphiti::get_graph(state.sidecar_port, &collections)
        .await
        .map_err(estr)
}

// ── collections ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_collections(state: State<AppState>) -> Result<Vec<vault::Collection>, String> {
    vault::list_collections(&state.db.lock().unwrap()).map_err(estr)
}

#[tauri::command]
pub fn create_collection(state: State<AppState>, name: String) -> Result<vault::Collection, String> {
    if name.trim().is_empty() {
        return Err("Collection name can't be empty.".into());
    }
    vault::create_collection(&state.db.lock().unwrap(), &name).map_err(estr)
}

#[tauri::command]
pub fn rename_collection(state: State<AppState>, id: String, name: String) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Collection name can't be empty.".into());
    }
    vault::rename_collection(&state.db.lock().unwrap(), &id, &name).map_err(estr)
}

#[tauri::command]
pub fn delete_collection(state: State<AppState>, id: String) -> Result<(), String> {
    vault::delete_collection(&state.db.lock().unwrap(), &id).map_err(estr)?;
    Ok(())
}

#[tauri::command]
pub fn set_source_collection(
    state: State<AppState>,
    source_id: String,
    collection_id: String,
) -> Result<(), String> {
    vault::set_source_collection(&state.db.lock().unwrap(), &source_id, &collection_id).map_err(estr)
}

#[tauri::command]
pub fn rename_source(
    state: State<AppState>,
    source_id: String,
    window_title: String,
) -> Result<(), String> {
    if window_title.trim().is_empty() {
        return Err("Title can't be empty.".into());
    }
    vault::rename_source(&state.db.lock().unwrap(), &source_id, &window_title).map_err(estr)
}

// ── granular delete: chunks + graph nodes/edges ─────────────────────────────

#[tauri::command]
pub fn list_chunks(state: State<AppState>, source_id: String) -> Result<Vec<vault::ChunkRow>, String> {
    vault::list_chunks(&state.db.lock().unwrap(), &source_id).map_err(estr)
}

#[tauri::command]
pub fn delete_chunk(state: State<AppState>, rowid: i64) -> Result<(), String> {
    vault::delete_chunk(&state.db.lock().unwrap(), rowid).map_err(estr)?;
    Ok(())
}

#[tauri::command]
pub async fn delete_graph_node(state: State<'_, AppState>, uuid: String) -> Result<(), String> {
    if is_sidecar_ready(&state) {
        graphiti::delete_node(state.sidecar_port, &uuid)
            .await
            .map_err(estr)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_graph_edge(state: State<'_, AppState>, uuid: String) -> Result<(), String> {
    if is_sidecar_ready(&state) {
        graphiti::delete_edge(state.sidecar_port, &uuid)
            .await
            .map_err(estr)?;
    }
    Ok(())
}

// ── manual graph node/edge creation ────────────────────────────────────────

#[derive(Serialize)]
pub struct CreatedNodeResult {
    pub uuid: String,
}

#[tauri::command]
pub async fn create_graph_node(
    state: State<'_, AppState>,
    name: String,
    node_type: String,
    summary: String,
) -> Result<CreatedNodeResult, String> {
    if !is_sidecar_ready(&state) {
        return Err("Knowledge graph sidecar is not ready yet.".into());
    }
    let created = graphiti::create_node(state.sidecar_port, &name, &node_type, &summary)
        .await
        .map_err(estr)?;
    Ok(CreatedNodeResult { uuid: created.uuid })
}

#[derive(Serialize)]
pub struct CreatedEdgeResult {
    pub uuid: String,
}

#[tauri::command]
pub async fn create_graph_edge(
    state: State<'_, AppState>,
    source_node_uuid: String,
    target_node_uuid: String,
    name: String,
    fact: String,
) -> Result<CreatedEdgeResult, String> {
    if !is_sidecar_ready(&state) {
        return Err("Knowledge graph sidecar is not ready yet.".into());
    }
    let created = graphiti::create_edge(
        state.sidecar_port,
        &source_node_uuid,
        &target_node_uuid,
        &name,
        &fact,
    )
    .await
    .map_err(estr)?;
    Ok(CreatedEdgeResult { uuid: created.uuid })
}

// ── chat as memory ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn save_chat_memory(
    state: State<'_, AppState>,
    question: String,
    answer: String,
) -> Result<CaptureResult, String> {
    let title = question.chars().take(80).collect::<String>();
    let content = format!("Q: {question}\n\nA: {answer}");
    let normalized = chunk::normalize(&content);
    persist_normalized(&state, "Zev Chat", &title, None, &normalized)
}

// ── export ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn export_graph(
    state: State<'_, AppState>,
    format: String,
    collections: Option<Vec<String>>,
) -> Result<String, String> {
    if !is_sidecar_ready(&state) {
        return Err("The knowledge graph isn't ready yet.".into());
    }
    let collections = collections.unwrap_or_default();
    graphiti::export(state.sidecar_port, &format, &collections)
        .await
        .map_err(estr)
}

#[tauri::command]
pub fn export_vault_json(
    state: State<AppState>,
    collections: Option<Vec<String>>,
) -> Result<String, String> {
    let conn = state.db.lock().unwrap();
    let collections = collections.unwrap_or_default();
    vault::export_vault_json(&conn, &collections).map_err(estr)
}

#[tauri::command]
pub fn export_vault_markdown(
    state: State<AppState>,
    collections: Option<Vec<String>>,
) -> Result<String, String> {
    let conn = state.db.lock().unwrap();
    let collections = collections.unwrap_or_default();
    vault::export_vault_markdown(&conn, &collections).map_err(estr)
}

/// Edit the content of an existing source: re-chunk, update FTS + markdown
/// mirror, and re-ingest into the knowledge graph. Returns the updated
/// CaptureResult so the frontend can refresh its view.
#[tauri::command]
pub async fn update_source_content(
    state: State<'_, AppState>,
    source_id: String,
    content: String,
) -> Result<CaptureResult, String> {
    let normalized = chunk::normalize(&content);
    if normalized.trim().is_empty() {
        return Err("Content can't be empty.".to_string());
    }

    let (app, window_title, url, _collection_id) = {
        let conn = state.db.lock().unwrap();
        conn.query_row(
            "SELECT app, window_title, url, collection_id FROM sources WHERE id = ?1",
            [&source_id],
            |r| Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, String>(3)?,
            )),
        ).map_err(|_| "Source not found.".to_string())?
    };

    update_capture(
        &state,
        &source_id,
        &app,
        &window_title,
        url.as_deref(),
        &normalized,
        Some(&normalized),
    )
}

/// Write `content` to a user-chosen path. The path comes from the dialog
/// plugin's Save dialog (user-initiated save of their own data).
#[tauri::command]
pub fn save_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(estr)
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<Settings, String> {
    Ok(state.settings.lock().unwrap().clone())
}

#[tauri::command]
pub async fn set_settings(state: State<'_, AppState>, settings: Settings) -> Result<(), String> {
    settings.save(&state.config_dir).map_err(estr)?;
    *state.settings.lock().unwrap() = settings.clone();
    // Push config to sidecar so it knows the extraction mode + provider.
    if is_sidecar_ready(&state) {
        let port = state.sidecar_port;
        tauri::async_runtime::spawn(async move {
            let _ = graphiti::configure(port, &settings).await;
        });
    }
    Ok(())
}

fn record_trace(state: &AppState, kind: &str, system: &str, user_prompt: &str, result: &Result<ChatResult, anyhow::Error>, latency_ms: i64) {
    let trace = match result {
        Ok(cr) => LlmTrace {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: Utc::now().to_rfc3339(),
            kind: kind.to_string(),
            provider: cr.provider.clone(),
            model: cr.model.clone(),
            system_prompt: system.to_string(),
            user_prompt: user_prompt.to_string(),
            response: cr.text.clone(),
            input_tokens: cr.input_tokens,
            output_tokens: cr.output_tokens,
            latency_ms,
            error: None,
        },
        Err(e) => LlmTrace {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: Utc::now().to_rfc3339(),
            kind: kind.to_string(),
            provider: String::new(),
            model: String::new(),
            system_prompt: system.to_string(),
            user_prompt: user_prompt.to_string(),
            response: String::new(),
            input_tokens: None,
            output_tokens: None,
            latency_ms,
            error: Some(e.to_string()),
        },
    };
    let conn = state.db.lock().unwrap();
    let _ = vault::insert_trace(&conn, &trace);

    // Langfuse export (fire-and-forget when enabled).
    let settings = state.settings.lock().unwrap().clone();
    if settings.langfuse_enabled && !settings.langfuse_public_key.is_empty() {
        let t = trace.clone();
        let host = settings.langfuse_host.clone();
        let pk = settings.langfuse_public_key.clone();
        let sk = settings.langfuse_secret_key.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = langfuse::export_trace(&host, &pk, &sk, &t).await {
                log::warn!("Langfuse export failed (non-fatal): {e}");
            }
        });
    }
}

// ── LLM traces ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_llm_traces(
    state: State<AppState>,
    limit: Option<usize>,
    offset: Option<usize>,
    kind: Option<String>,
) -> Result<Vec<vault::LlmTraceSummary>, String> {
    let conn = state.db.lock().unwrap();
    vault::list_traces(&conn, limit.unwrap_or(100), offset.unwrap_or(0), kind.as_deref())
        .map_err(estr)
}

#[tauri::command]
pub fn get_llm_trace(state: State<AppState>, id: String) -> Result<Option<vault::LlmTrace>, String> {
    let conn = state.db.lock().unwrap();
    vault::get_trace(&conn, &id).map_err(estr)
}

#[tauri::command]
pub fn clear_llm_traces(state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().unwrap();
    vault::clear_traces(&conn).map_err(estr)
}

#[tauri::command]
pub fn llm_trace_stats(state: State<AppState>) -> Result<vault::TraceStats, String> {
    let conn = state.db.lock().unwrap();
    vault::trace_stats(&conn).map_err(estr)
}

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n { return s.to_string(); }
    let mut out: String = s.chars().take(n).collect();
    out.push('…');
    out
}

// ── experts ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_experts(state: State<AppState>) -> Result<Vec<Expert>, String> {
    let conn = state.db.lock().unwrap();
    vault::list_experts(&conn).map_err(estr)
}

#[tauri::command]
pub fn get_expert(state: State<AppState>, id: String) -> Result<Option<Expert>, String> {
    let conn = state.db.lock().unwrap();
    vault::get_expert(&conn, &id).map_err(estr)
}

#[tauri::command]
pub fn create_expert(state: State<AppState>, expert: Expert) -> Result<(), String> {
    let conn = state.db.lock().unwrap();
    vault::create_expert(&conn, &expert).map_err(estr)
}

#[tauri::command]
pub fn update_expert(state: State<AppState>, expert: Expert) -> Result<(), String> {
    let conn = state.db.lock().unwrap();
    vault::update_expert(&conn, &expert).map_err(estr)
}

#[tauri::command]
pub fn delete_expert(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().unwrap();
    vault::delete_expert(&conn, &id).map_err(estr)
}

// ── collection instructions ──────────────────────────────────────────────────

#[tauri::command]
pub fn set_collection_instructions(
    state: State<AppState>,
    id: String,
    instructions: String,
) -> Result<(), String> {
    let conn = state.db.lock().unwrap();
    vault::set_collection_instructions(&conn, &id, &instructions).map_err(estr)
}

// ── council of experts ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn ask_council(
    state: State<'_, AppState>,
    question: String,
    expert_ids: Vec<String>,
    collections: Option<Vec<String>>,
) -> Result<Vec<CouncilResponse>, String> {
    let settings = snapshot_settings(&state);
    let collections = collections.unwrap_or_default();

    // Load all requested experts.
    let experts: Vec<Expert> = {
        let conn = state.db.lock().unwrap();
        expert_ids
            .iter()
            .filter_map(|eid| vault::get_expert(&conn, eid).ok().flatten())
            .collect()
    };
    if experts.is_empty() {
        return Err("No valid experts selected for council.".into());
    }

    // Retrieve context once (shared across all experts).
    let (context, citations, ctx_label) = if is_sidecar_ready(&state) {
        if let Ok(results) =
            graphiti::search(state.sidecar_port, &question, TOP_K, &collections).await
        {
            if !results.is_empty() {
                let ctx = results
                    .iter()
                    .enumerate()
                    .map(|(i, r)| {
                        let ent = if r.entities.is_empty() {
                            String::new()
                        } else {
                            format!("\nEntities: {}", r.entities.join(", "))
                        };
                        format!("[{}] {} ({}){}\n{}", i + 1, r.name, r.valid_at, ent, r.fact)
                    })
                    .collect::<Vec<_>>()
                    .join("\n\n");
                let cits: Vec<Citation> = results
                    .into_iter()
                    .map(|r| Citation {
                        source_id: String::new(),
                        app: String::new(),
                        window_title: r.name,
                        captured_at: r.valid_at,
                        snippet: truncate(&r.fact, 240),
                        score: 0.0,
                        url: None,
                    })
                    .collect();
                (ctx, cits, "Knowledge graph context")
            } else {
                council_fts5_context(&state, &question, &collections)?
            }
        } else {
            council_fts5_context(&state, &question, &collections)?
        }
    } else {
        council_fts5_context(&state, &question, &collections)?
    };

    if context.is_empty() {
        return Ok(vec![]);
    }

    let user_prompt = format!("{ctx_label}:\n{context}\n\nQuestion: {question}");
    let ctx_instr = "Answer using the provided context. Cite specific facts. \
                     If the answer is not in the context, say so. Be concise and specific.";

    // Run LLM calls — sequential for Ollama (single-concurrency), parallel for cloud.
    let is_local = settings.chat_provider == crate::settings::ChatProvider::Ollama;
    let mut responses = Vec::with_capacity(experts.len());

    for exp in &experts {
        let system = compose_system_prompt(ctx_instr, Some(exp), "", "");
        let llm = {
            let mut l = Llm::from_settings(&settings);
            if let Some(ref m) = exp.model_override {
                l = l.with_model_override(m);
            }
            l
        };
        let t0 = std::time::Instant::now();
        let result = llm.chat(&system, &user_prompt, exp.temperature).await;
        let latency = t0.elapsed().as_millis() as i64;
        record_trace(&state, "chat", &system, &user_prompt, &result, latency);

        let text = match result {
            Ok(cr) => cr.text,
            Err(e) => format!("Error: {e}"),
        };

        responses.push(CouncilResponse {
            expert_id: exp.id.clone(),
            expert_name: exp.name.clone(),
            expert_icon: exp.icon.clone(),
            answer: Answer {
                text,
                citations: citations.clone(),
            },
        });

        // For local models, we run sequentially (already the case in the loop).
        // For cloud, we could parallelize but keep it simple for now.
        let _ = is_local;
    }

    Ok(responses)
}

fn council_fts5_context(
    state: &State<AppState>,
    question: &str,
    collections: &[String],
) -> Result<(String, Vec<Citation>, &'static str), String> {
    let (retrieved, _) = fts5_search_context(state, question, collections)?;
    let ctx = retrieved
        .iter()
        .enumerate()
        .map(|(i, r)| {
            format!("[{}] {} — {} ({})\n{}", i + 1, r.app, r.window_title, r.captured_at, r.snippet)
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    let cits: Vec<Citation> = retrieved
        .into_iter()
        .map(|r| Citation {
            source_id: r.source_id,
            app: r.app,
            window_title: r.window_title,
            captured_at: r.captured_at,
            snippet: truncate(&r.snippet, 240),
            score: r.score,
            url: r.url,
        })
        .collect();
    Ok((ctx, cits, "Captured context"))
}
