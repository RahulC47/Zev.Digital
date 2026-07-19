//! The memory vault: SQLite (sources + FTS5 chunks) plus a Markdown mirror.
//! Everything lives on-device; nothing is sent anywhere.
//!
//! Search uses SQLite FTS5 with BM25 ranking — zero extra dependencies, ships
//! inside the bundled SQLite, and works on any Windows machine.  Neural
//! embeddings are a planned Phase-1 enhancement (opt-in via Ollama).

use anyhow::Result;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

// ── public types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct SourceMeta {
    pub id: String,
    pub app: String,
    pub window_title: String,
    pub captured_at: String,
    pub chunk_count: i64,
    pub char_count: i64,
    /// Which collection this source belongs to (defaults to "general").
    #[serde(default)]
    pub collection_id: String,
    /// Page URL when the source was captured from a browser.
    #[serde(default)]
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub source_count: i64,
    #[serde(default)]
    pub instructions: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Expert {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub system_prompt: String,
    pub temperature: Option<f64>,
    pub model_override: Option<String>,
    pub collection_scope: Option<String>,
    pub is_builtin: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// Id of the always-present default collection.
pub const DEFAULT_COLLECTION_ID: &str = "general";

#[derive(Debug, Clone, Serialize)]
pub struct Retrieved {
    pub source_id: String,
    pub app: String,
    pub window_title: String,
    pub captured_at: String,
    pub snippet: String,
    /// BM25 score normalised to positive (higher = better match).
    pub score: f32,
    /// Page URL when the source was captured from a browser.
    #[serde(default)]
    pub url: Option<String>,
}

// ── schema ────────────────────────────────────────────────────────────────────

pub fn open(db_path: &Path) -> Result<Connection> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(db_path)?;
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS sources (
            id           TEXT PRIMARY KEY,
            app          TEXT NOT NULL,
            window_title TEXT NOT NULL,
            captured_at  TEXT NOT NULL,
            char_count   INTEGER NOT NULL,
            chunk_count  INTEGER NOT NULL,
            md_path      TEXT
        );

        -- Named collections: a scoping/organizing layer over the single merged
        -- "brain" graph. Captures are filed into a collection; views, queries,
        -- export, and agent context can be scoped to one/many collections.
        CREATE TABLE IF NOT EXISTS collections (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        -- Drop old embedding-based chunks table if it survives from a previous
        -- schema (safe: chunk data can be re-captured; sources are preserved).
        DROP TABLE IF EXISTS chunks;

        -- FTS5 virtual table for BM25 full-text search.
        -- source_id is UNINDEXED (stored but not part of the text index).
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
            source_id UNINDEXED,
            text,
            tokenize = "unicode61"
        );
        "#,
    )?;

    // Migration: add sources.collection_id to pre-existing databases. ALTER
    // fails if the column already exists — ignore that specific case.
    let _ = conn.execute(
        "ALTER TABLE sources ADD COLUMN collection_id TEXT NOT NULL DEFAULT 'general'",
        [],
    );
    // Migration: page URL for browser captures (same ignore-if-exists pattern).
    let _ = conn.execute("ALTER TABLE sources ADD COLUMN url TEXT", []);

    // LLM call traces for local observability.
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS llm_traces (
            id            TEXT PRIMARY KEY,
            timestamp     TEXT NOT NULL,
            kind          TEXT NOT NULL,
            provider      TEXT NOT NULL,
            model         TEXT NOT NULL,
            system_prompt TEXT NOT NULL,
            user_prompt   TEXT NOT NULL,
            response      TEXT NOT NULL,
            input_tokens  INTEGER,
            output_tokens INTEGER,
            latency_ms    INTEGER NOT NULL,
            error         TEXT
        );
        "#,
    )?;

    // Migration: collection instructions (same ignore-if-exists pattern).
    let _ = conn.execute(
        "ALTER TABLE collections ADD COLUMN instructions TEXT NOT NULL DEFAULT ''",
        [],
    );

    // Expert personas — custom system prompts, temperature, model overrides.
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS experts (
            id              TEXT PRIMARY KEY,
            name            TEXT NOT NULL,
            description     TEXT NOT NULL DEFAULT '',
            icon            TEXT NOT NULL DEFAULT '🤖',
            system_prompt   TEXT NOT NULL,
            temperature     REAL,
            model_override  TEXT,
            collection_scope TEXT,
            is_builtin      INTEGER NOT NULL DEFAULT 0,
            created_at      TEXT NOT NULL,
            updated_at      TEXT NOT NULL
        );
        "#,
    )?;

    // Ensure the default collection exists and any orphan sources point to it.
    conn.execute(
        "INSERT OR IGNORE INTO collections (id, name, created_at) VALUES (?1, 'General', ?2)",
        rusqlite::params![DEFAULT_COLLECTION_ID, chrono_now()],
    )?;
    conn.execute(
        "UPDATE sources SET collection_id = ?1 WHERE collection_id IS NULL OR collection_id = ''",
        rusqlite::params![DEFAULT_COLLECTION_ID],
    )?;

    // Seed built-in expert templates (INSERT OR IGNORE — user edits are preserved).
    seed_builtin_experts(&conn)?;

    Ok(conn)
}

fn seed_builtin_experts(conn: &Connection) -> Result<()> {
    let now = chrono_now();
    let experts: &[(&str, &str, &str, &str)] = &[
        (
            "expert-legal",
            "Legal Advisor",
            "⚖️",
            "You are a Legal Advisor specialising in Indian business law. \
             Cover MCA compliance, contract review, IP basics, partnership/LLP structuring, \
             and MSME-relevant regulations. Cite specific sections of law when possible. \
             Clearly state when a matter needs a practicing lawyer.",
        ),
        (
            "expert-tax",
            "Tax & GST Expert",
            "🧾",
            "You are a Tax & GST Expert for Indian MSMEs. \
             Cover GST registration, filing, input tax credit, TDS, income tax for proprietors \
             and companies, ITR filing, and tax-saving strategies under the Indian tax code. \
             Use current financial year rules. Flag when a chartered accountant should be consulted.",
        ),
        (
            "expert-hr",
            "HR Consultant",
            "👥",
            "You are an HR Consultant for Indian small businesses. \
             Cover Indian labor law (Shops & Establishments, Factories Act), PF/ESI compliance, \
             hiring best practices, offer and appointment letters, leave policies, \
             and performance management. Give practical, MSME-scale advice.",
        ),
        (
            "expert-marketing",
            "Marketing Strategist",
            "📈",
            "You are a Marketing Strategist for Indian SMBs. \
             Cover digital marketing, SEO, Google Ads, social media strategy, \
             WhatsApp Business, local marketing, brand positioning, and content marketing. \
             Focus on cost-effective tactics suitable for small budgets.",
        ),
        (
            "expert-finance",
            "Finance Advisor",
            "💰",
            "You are a Finance Advisor for Indian MSMEs. \
             Cover cash flow management, working capital optimisation, MSME loan schemes \
             (Mudra, CGTMSE, Stand-Up India), bank relationships, financial ratios, \
             and basic bookkeeping best practices. Be practical and action-oriented.",
        ),
        (
            "expert-ops",
            "Operations Manager",
            "⚙️",
            "You are an Operations Manager for small manufacturing and service businesses. \
             Cover supply chain management, inventory control, lean operations, \
             quality management, vendor negotiation, and process improvement. \
             Give concrete, implementable suggestions.",
        ),
        (
            "expert-compliance",
            "Compliance Officer",
            "🛡️",
            "You are a Compliance Officer for Indian businesses. \
             Cover FSSAI, BIS, environmental compliance, factory licensing, \
             fire safety, trade licences, and industry-specific regulations. \
             Provide checklists and deadlines where applicable.",
        ),
        (
            "expert-writer",
            "Business Writer",
            "✍️",
            "You are a Business Writer producing professional English content. \
             Write and improve proposals, client emails, reports, SOPs, pitch decks, \
             and internal communications. Match the user's tone and formality level. \
             Be concise, clear, and persuasive.",
        ),
    ];

    let descriptions: &[&str] = &[
        "Indian business law, MCA compliance, contracts, IP",
        "GST, income tax, TDS, ITR filing for MSMEs",
        "Indian labor law, PF/ESI, hiring, policies",
        "Digital marketing, SEO, social media for Indian SMBs",
        "Cash flow, MSME loans, Mudra/CGTMSE schemes",
        "Supply chain, inventory, lean operations",
        "FSSAI, BIS, environmental, factory licensing",
        "Proposals, emails, reports, pitch decks",
    ];

    for (i, &(id, name, icon, prompt)) in experts.iter().enumerate() {
        conn.execute(
            "INSERT OR IGNORE INTO experts \
             (id, name, description, icon, system_prompt, is_builtin, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)",
            rusqlite::params![id, name, descriptions[i], icon, prompt, now],
        )?;
    }
    Ok(())
}

fn chrono_now() -> String {
    chrono::Utc::now().to_rfc3339()
}

// ── write ─────────────────────────────────────────────────────────────────────

pub fn insert_source(conn: &Connection, meta: &SourceMeta, md_path: Option<&str>) -> Result<()> {
    let collection = if meta.collection_id.is_empty() {
        DEFAULT_COLLECTION_ID
    } else {
        &meta.collection_id
    };
    conn.execute(
        "INSERT INTO sources (id, app, window_title, captured_at, char_count, chunk_count, md_path, collection_id, url)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            meta.id,
            meta.app,
            meta.window_title,
            meta.captured_at,
            meta.char_count,
            meta.chunk_count,
            md_path,
            collection,
            meta.url,
        ],
    )?;
    Ok(())
}

/// Replace a source's content in place (session coalescing: the capture loop
/// keeps updating one source while the user works in the same window, instead
/// of stacking near-duplicate snapshots).
pub fn update_source_text(
    conn: &Connection,
    source_id: &str,
    captured_at: &str,
    char_count: i64,
    chunks: &[String],
) -> Result<()> {
    // unchecked_transaction is safe here: the Connection lives behind a Mutex,
    // so no other statement can interleave with this transaction.
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM chunks_fts WHERE source_id = ?1", [source_id])?;
    for c in chunks {
        tx.execute(
            "INSERT INTO chunks_fts (source_id, text) VALUES (?1, ?2)",
            rusqlite::params![source_id, c],
        )?;
    }
    // Refreshing captured_at keeps the active session at the top of the
    // sources list (ordered by captured_at DESC).
    tx.execute(
        "UPDATE sources SET captured_at = ?2, char_count = ?3, chunk_count = ?4 WHERE id = ?1",
        rusqlite::params![source_id, captured_at, char_count, chunks.len() as i64],
    )?;
    tx.commit()?;
    Ok(())
}

// ── collections ─────────────────────────────────────────────────────────────

pub fn list_collections(conn: &Connection) -> Result<Vec<Collection>> {
    let mut stmt = conn.prepare(
        "SELECT c.id, c.name, c.created_at, COUNT(s.id) AS n, c.instructions
         FROM collections c
         LEFT JOIN sources s ON s.collection_id = c.id
         GROUP BY c.id
         ORDER BY (c.id = 'general') DESC, c.name COLLATE NOCASE ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Collection {
            id: r.get(0)?,
            name: r.get(1)?,
            created_at: r.get(2)?,
            source_count: r.get(3)?,
            instructions: r.get::<_, String>(4).unwrap_or_default(),
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn create_collection(conn: &Connection, name: &str) -> Result<Collection> {
    let id = uuid::Uuid::new_v4().to_string();
    let created_at = chrono_now();
    conn.execute(
        "INSERT INTO collections (id, name, created_at, instructions) VALUES (?1, ?2, ?3, '')",
        rusqlite::params![id, name.trim(), created_at],
    )?;
    Ok(Collection {
        id,
        name: name.trim().to_string(),
        created_at,
        source_count: 0,
        instructions: String::new(),
    })
}

pub fn rename_collection(conn: &Connection, id: &str, name: &str) -> Result<()> {
    conn.execute(
        "UPDATE collections SET name = ?2 WHERE id = ?1",
        rusqlite::params![id, name.trim()],
    )?;
    Ok(())
}

/// Delete a collection. The default collection cannot be deleted; sources in the
/// deleted collection are reassigned to the default (data is never lost here).
/// Returns the source ids that were reassigned.
pub fn delete_collection(conn: &Connection, id: &str) -> Result<Vec<String>> {
    if id == DEFAULT_COLLECTION_ID {
        anyhow::bail!("The default collection can't be deleted.");
    }
    let mut stmt = conn.prepare("SELECT id FROM sources WHERE collection_id = ?1")?;
    let ids: Vec<String> = stmt
        .query_map(rusqlite::params![id], |r| r.get(0))?
        .filter_map(|r| r.ok())
        .collect();
    conn.execute(
        "UPDATE sources SET collection_id = ?2 WHERE collection_id = ?1",
        rusqlite::params![id, DEFAULT_COLLECTION_ID],
    )?;
    conn.execute("DELETE FROM collections WHERE id = ?1", rusqlite::params![id])?;
    Ok(ids)
}

pub fn set_source_collection(conn: &Connection, source_id: &str, collection_id: &str) -> Result<()> {
    conn.execute(
        "UPDATE sources SET collection_id = ?2 WHERE id = ?1",
        rusqlite::params![source_id, collection_id],
    )?;
    Ok(())
}

/// Rename a captured source (updates the display title shown in the UI).
pub fn rename_source(conn: &Connection, source_id: &str, window_title: &str) -> Result<()> {
    conn.execute(
        "UPDATE sources SET window_title = ?2 WHERE id = ?1",
        rusqlite::params![source_id, window_title.trim()],
    )?;
    Ok(())
}

/// All source ids in the given collections (used to scope graph/query/export).
pub fn source_ids_in_collections(conn: &Connection, collection_ids: &[String]) -> Result<Vec<String>> {
    if collection_ids.is_empty() {
        return Ok(vec![]);
    }
    let placeholders = collection_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!("SELECT id FROM sources WHERE collection_id IN ({placeholders})");
    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::ToSql> =
        collection_ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
    let ids = stmt
        .query_map(params.as_slice(), |r| r.get::<_, String>(0))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(ids)
}

/// Insert a chunk into the FTS index.  `idx` is informational (not stored).
pub fn insert_chunk(conn: &Connection, source_id: &str, _idx: usize, text: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO chunks_fts (source_id, text) VALUES (?1, ?2)",
        rusqlite::params![source_id, text],
    )?;
    Ok(())
}

// ── read ──────────────────────────────────────────────────────────────────────

pub fn list_sources(conn: &Connection) -> Result<Vec<SourceMeta>> {
    let mut stmt = conn.prepare(
        "SELECT id, app, window_title, captured_at, chunk_count, char_count, collection_id, url
         FROM sources ORDER BY captured_at DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(SourceMeta {
            id: r.get(0)?,
            app: r.get(1)?,
            window_title: r.get(2)?,
            captured_at: r.get(3)?,
            chunk_count: r.get(4)?,
            char_count: r.get(5)?,
            collection_id: r.get(6)?,
            url: r.get(7)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

// ── chunk-level read/delete (granular) ──────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct ChunkRow {
    /// FTS5 implicit rowid — stable handle for per-chunk delete.
    pub rowid: i64,
    pub text: String,
}

pub fn list_chunks(conn: &Connection, source_id: &str) -> Result<Vec<ChunkRow>> {
    let mut stmt = conn.prepare(
        "SELECT rowid, text FROM chunks_fts WHERE source_id = ?1 ORDER BY rowid",
    )?;
    let rows = stmt.query_map(rusqlite::params![source_id], |r| {
        Ok(ChunkRow { rowid: r.get(0)?, text: r.get(1)? })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Delete a single chunk by FTS rowid, then refresh the owning source's
/// chunk_count / char_count. Returns the source_id the chunk belonged to.
pub fn delete_chunk(conn: &Connection, rowid: i64) -> Result<Option<String>> {
    let source_id: Option<String> = conn
        .query_row(
            "SELECT source_id FROM chunks_fts WHERE rowid = ?1",
            rusqlite::params![rowid],
            |r| r.get(0),
        )
        .ok();
    conn.execute("DELETE FROM chunks_fts WHERE rowid = ?1", rusqlite::params![rowid])?;
    if let Some(sid) = &source_id {
        let (cnt, chars): (i64, i64) = conn
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM(LENGTH(text)), 0) FROM chunks_fts WHERE source_id = ?1",
                rusqlite::params![sid],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap_or((0, 0));
        conn.execute(
            "UPDATE sources SET chunk_count = ?2, char_count = ?3 WHERE id = ?1",
            rusqlite::params![sid, cnt, chars],
        )?;
    }
    Ok(source_id)
}

// ── search ────────────────────────────────────────────────────────────────────

/// BM25 full-text search over all captured chunks.
/// Returns up to `k` results, one snippet per source (best-scoring chunk wins).
pub fn search(conn: &Connection, query: &str, k: usize) -> Result<Vec<Retrieved>> {
    let fts_query = build_fts_query(query);
    if fts_query.is_empty() {
        return Ok(vec![]);
    }

    // Fetch top (k * 5) raw hits so after dedup-per-source we still have k.
    // bm25() returns negative values — ORDER ASC puts best matches first.
    let mut stmt = conn.prepare(
        "SELECT source_id, text, -bm25(chunks_fts) AS score
         FROM chunks_fts
         WHERE chunks_fts MATCH ?1
         ORDER BY bm25(chunks_fts)
         LIMIT ?2",
    )?;

    struct Hit {
        source_id: String,
        text: String,
        score: f32,
    }
    let hits: Vec<Hit> = stmt
        .query_map(rusqlite::params![fts_query, (k * 5) as i64], |r| {
            Ok(Hit {
                source_id: r.get(0)?,
                text: r.get(1)?,
                score: r.get::<_, f64>(2)? as f32,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    // Keep only the best chunk per source.
    let mut best: std::collections::HashMap<String, Hit> = std::collections::HashMap::new();
    for hit in hits {
        best.entry(hit.source_id.clone())
            .and_modify(|e| {
                if hit.score > e.score {
                    e.text = hit.text.clone();
                    e.score = hit.score;
                }
            })
            .or_insert(hit);
    }

    // Sort descending by score and take k.
    let mut ranked: Vec<Hit> = best.into_values().collect();
    ranked.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    ranked.truncate(k);

    // Enrich with source metadata.
    let mut out = Vec::with_capacity(ranked.len());
    for hit in ranked {
        let row = conn.query_row(
            "SELECT app, window_title, captured_at, url FROM sources WHERE id = ?1",
            rusqlite::params![hit.source_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                ))
            },
        );
        if let Ok((app, window_title, captured_at, url)) = row {
            out.push(Retrieved {
                source_id: hit.source_id,
                app,
                window_title,
                captured_at,
                snippet: hit.text,
                score: hit.score,
                url,
            });
        }
    }
    Ok(out)
}

/// Fallback context when BM25 finds no keyword match.
/// Returns the k most-recently-captured sources with a sample snippet each,
/// so meta-questions like "what did I last capture?" can still be answered.
pub fn recent_context(conn: &Connection, k: usize) -> Result<Vec<Retrieved>> {
    let mut stmt = conn.prepare(
        "SELECT id, app, window_title, captured_at, url
         FROM sources ORDER BY captured_at DESC LIMIT ?1",
    )?;
    let sources: Vec<(String, String, String, String, Option<String>)> = stmt
        .query_map(rusqlite::params![k as i64], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        })?
        .filter_map(|r| r.ok())
        .collect();

    let mut out = Vec::new();
    for (id, app, window_title, captured_at, url) in sources {
        // First stored chunk gives a representative preview of the content.
        let snippet: String = conn
            .query_row(
                "SELECT text FROM chunks_fts WHERE source_id = ?1 LIMIT 1",
                rusqlite::params![id],
                |r| r.get(0),
            )
            .unwrap_or_default();
        out.push(Retrieved {
            source_id: id,
            app,
            window_title,
            captured_at,
            snippet,
            score: 0.0, // sentinel: recency-based, not BM25
            url,
        });
    }
    Ok(out)
}

// ── delete ────────────────────────────────────────────────────────────────────

pub fn delete_source(conn: &Connection, id: &str) -> Result<Option<String>> {
    let md_path: Option<String> = conn
        .query_row("SELECT md_path FROM sources WHERE id = ?1", [id], |r| r.get(0))
        .ok()
        .flatten();
    conn.execute("DELETE FROM chunks_fts WHERE source_id = ?1", [id])?;
    conn.execute("DELETE FROM sources WHERE id = ?1", [id])?;
    Ok(md_path)
}

pub fn clear(conn: &Connection) -> Result<()> {
    conn.execute_batch("DELETE FROM chunks_fts; DELETE FROM sources;")?;
    Ok(())
}

// ── export ────────────────────────────────────────────────────────────────────

/// Export the FTS vault (sources + their chunks) as pretty JSON, optionally
/// scoped to a set of collections (empty = whole vault).
pub fn export_vault_json(conn: &Connection, collection_ids: &[String]) -> Result<String> {
    use std::collections::HashSet;
    let allowed: Option<HashSet<&String>> = if collection_ids.is_empty() {
        None
    } else {
        Some(collection_ids.iter().collect())
    };

    let collections = list_collections(conn)?;
    let name_by_id: std::collections::HashMap<String, String> =
        collections.into_iter().map(|c| (c.id, c.name)).collect();

    let sources = list_sources(conn)?;
    let mut out_sources = Vec::new();
    for s in sources {
        if let Some(set) = &allowed {
            if !set.contains(&s.collection_id) {
                continue;
            }
        }
        let chunks: Vec<String> = list_chunks(conn, &s.id)?.into_iter().map(|c| c.text).collect();
        out_sources.push(serde_json::json!({
            "id": s.id,
            "app": s.app,
            "window_title": s.window_title,
            "url": s.url,
            "captured_at": s.captured_at,
            "collection_id": s.collection_id,
            "collection_name": name_by_id.get(&s.collection_id).cloned().unwrap_or_default(),
            "char_count": s.char_count,
            "chunk_count": s.chunk_count,
            "chunks": chunks,
        }));
    }

    let doc = serde_json::json!({
        "exported_at": chrono_now(),
        "source_count": out_sources.len(),
        "sources": out_sources,
    });
    Ok(serde_json::to_string_pretty(&doc)?)
}

/// Export the vault as a single Markdown document — one section per source with
/// its full captured text (read from the per-source .md mirror file).
/// Optionally scoped to a set of collections (empty = whole vault).
pub fn export_vault_markdown(conn: &Connection, collection_ids: &[String]) -> Result<String> {
    use std::collections::HashSet;
    let allowed: Option<HashSet<&String>> = if collection_ids.is_empty() {
        None
    } else {
        Some(collection_ids.iter().collect())
    };

    let collections = list_collections(conn)?;
    let name_by_id: std::collections::HashMap<String, String> =
        collections.into_iter().map(|c| (c.id, c.name)).collect();

    let sources = list_sources(conn)?;
    let filtered: Vec<_> = sources
        .iter()
        .filter(|s| allowed.as_ref().map_or(true, |set| set.contains(&s.collection_id)))
        .collect();

    let mut out = String::new();
    out.push_str("# Zev Memory Vault\n\n");
    out.push_str(&format!("Exported: {}  \n", chrono_now()));
    out.push_str(&format!("{} sources\n\n---\n\n", filtered.len()));

    for s in &filtered {
        let coll_name = name_by_id.get(&s.collection_id).cloned().unwrap_or_default();
        out.push_str(&format!("## {}\n\n", s.window_title));
        out.push_str(&format!("| | |\n|---|---|\n"));
        out.push_str(&format!("| **App** | {} |\n", s.app));
        if let Some(u) = &s.url {
            out.push_str(&format!("| **URL** | {u} |\n"));
        }
        out.push_str(&format!("| **Captured** | {} |\n", s.captured_at));
        out.push_str(&format!("| **Collection** | {} |\n", coll_name));
        out.push_str(&format!("| **Size** | {} chars · {} chunks |\n\n", s.char_count, s.chunk_count));

        // Full text from the markdown mirror file; strip the YAML front matter.
        let md_path: Option<String> = conn
            .query_row(
                "SELECT md_path FROM sources WHERE id = ?1",
                rusqlite::params![s.id],
                |r| r.get(0),
            )
            .ok()
            .flatten();

        let full_text = md_path
            .and_then(|p| std::fs::read_to_string(p).ok())
            .map(|t| {
                if t.starts_with("---\n") {
                    if let Some(end) = t[4..].find("\n---\n") {
                        return t[4 + end + 5..].trim().to_string();
                    }
                }
                t.trim().to_string()
            });

        if let Some(text) = full_text {
            out.push_str(&text);
        } else {
            // Fallback: join the FTS chunks (full mirror unavailable).
            let chunks = list_chunks(conn, &s.id).unwrap_or_default();
            for c in chunks {
                out.push_str(&c.text);
                out.push('\n');
            }
        }
        out.push_str("\n\n---\n\n");
    }

    Ok(out)
}

// ── Markdown mirror ───────────────────────────────────────────────────────────

pub fn write_markdown(vault_dir: &Path, meta: &SourceMeta, full_text: &str) -> Result<PathBuf> {
    let md_dir = vault_dir.join("markdown");
    std::fs::create_dir_all(&md_dir)?;
    let path = md_dir.join(format!("{}.md", meta.id));
    let url_line = meta
        .url
        .as_deref()
        .map(|u| format!("url: {u}\n"))
        .unwrap_or_default();
    let body = format!(
        "---\napp: {}\nwindow: {}\n{}captured_at: {}\n---\n\n{}\n",
        meta.app, meta.window_title, url_line, meta.captured_at, full_text
    );
    std::fs::write(&path, body)?;
    Ok(path)
}

// ── helpers ───────────────────────────────────────────────────────────────────

/// Convert a user query into a safe FTS5 MATCH expression.
/// Splits into words, strips FTS5 special characters, joins with implicit AND.
fn build_fts_query(q: &str) -> String {
    q.split_whitespace()
        .map(|w| {
            w.chars()
                .filter(|c| c.is_alphanumeric() || matches!(c, '\'' | '-'))
                .collect::<String>()
        })
        .filter(|w| !w.is_empty() && w.len() >= 2)
        .collect::<Vec<_>>()
        .join(" ")
}

// ── LLM traces ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct LlmTrace {
    pub id: String,
    pub timestamp: String,
    pub kind: String,
    pub provider: String,
    pub model: String,
    pub system_prompt: String,
    pub user_prompt: String,
    pub response: String,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub latency_ms: i64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LlmTraceSummary {
    pub id: String,
    pub timestamp: String,
    pub kind: String,
    pub provider: String,
    pub model: String,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub latency_ms: i64,
    pub error: Option<String>,
}

pub fn insert_trace(conn: &Connection, trace: &LlmTrace) -> Result<()> {
    conn.execute(
        "INSERT INTO llm_traces (id, timestamp, kind, provider, model, system_prompt, user_prompt, response, input_tokens, output_tokens, latency_ms, error)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        rusqlite::params![
            trace.id,
            trace.timestamp,
            trace.kind,
            trace.provider,
            trace.model,
            trace.system_prompt,
            trace.user_prompt,
            trace.response,
            trace.input_tokens,
            trace.output_tokens,
            trace.latency_ms,
            trace.error,
        ],
    )?;
    Ok(())
}

pub fn list_traces(
    conn: &Connection,
    limit: usize,
    offset: usize,
    kind_filter: Option<&str>,
) -> Result<Vec<LlmTraceSummary>> {
    let (sql, params): (String, Vec<Box<dyn rusqlite::ToSql>>) = match kind_filter {
        Some(k) => (
            "SELECT id, timestamp, kind, provider, model, input_tokens, output_tokens, latency_ms, error
             FROM llm_traces WHERE kind = ?1 ORDER BY timestamp DESC LIMIT ?2 OFFSET ?3"
                .to_string(),
            vec![
                Box::new(k.to_string()) as Box<dyn rusqlite::ToSql>,
                Box::new(limit as i64),
                Box::new(offset as i64),
            ],
        ),
        None => (
            "SELECT id, timestamp, kind, provider, model, input_tokens, output_tokens, latency_ms, error
             FROM llm_traces ORDER BY timestamp DESC LIMIT ?1 OFFSET ?2"
                .to_string(),
            vec![
                Box::new(limit as i64) as Box<dyn rusqlite::ToSql>,
                Box::new(offset as i64),
            ],
        ),
    };
    let mut stmt = conn.prepare(&sql)?;
    let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let rows = stmt.query_map(param_refs.as_slice(), |r| {
        Ok(LlmTraceSummary {
            id: r.get(0)?,
            timestamp: r.get(1)?,
            kind: r.get(2)?,
            provider: r.get(3)?,
            model: r.get(4)?,
            input_tokens: r.get(5)?,
            output_tokens: r.get(6)?,
            latency_ms: r.get(7)?,
            error: r.get(8)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn get_trace(conn: &Connection, id: &str) -> Result<Option<LlmTrace>> {
    let result = conn.query_row(
        "SELECT id, timestamp, kind, provider, model, system_prompt, user_prompt, response, input_tokens, output_tokens, latency_ms, error
         FROM llm_traces WHERE id = ?1",
        [id],
        |r| {
            Ok(LlmTrace {
                id: r.get(0)?,
                timestamp: r.get(1)?,
                kind: r.get(2)?,
                provider: r.get(3)?,
                model: r.get(4)?,
                system_prompt: r.get(5)?,
                user_prompt: r.get(6)?,
                response: r.get(7)?,
                input_tokens: r.get(8)?,
                output_tokens: r.get(9)?,
                latency_ms: r.get(10)?,
                error: r.get(11)?,
            })
        },
    );
    match result {
        Ok(t) => Ok(Some(t)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn clear_traces(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM llm_traces", [])?;
    Ok(())
}

pub fn trace_stats(conn: &Connection) -> Result<TraceStats> {
    let total: i64 = conn.query_row("SELECT COUNT(*) FROM llm_traces", [], |r| r.get(0))?;
    let errors: i64 = conn.query_row(
        "SELECT COUNT(*) FROM llm_traces WHERE error IS NOT NULL",
        [],
        |r| r.get(0),
    )?;
    let avg_latency: f64 = conn
        .query_row(
            "SELECT COALESCE(AVG(latency_ms), 0) FROM llm_traces",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0.0);
    let total_input: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(input_tokens), 0) FROM llm_traces",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let total_output: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(output_tokens), 0) FROM llm_traces",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    Ok(TraceStats {
        total_calls: total,
        total_errors: errors,
        avg_latency_ms: avg_latency,
        total_input_tokens: total_input,
        total_output_tokens: total_output,
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct TraceStats {
    pub total_calls: i64,
    pub total_errors: i64,
    pub avg_latency_ms: f64,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
}

// ── experts ──────────────────────────────────────────────────────────────────

pub fn list_experts(conn: &Connection) -> Result<Vec<Expert>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, description, icon, system_prompt, temperature, \
         model_override, collection_scope, is_builtin, created_at, updated_at \
         FROM experts ORDER BY is_builtin DESC, name COLLATE NOCASE ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Expert {
            id: r.get(0)?,
            name: r.get(1)?,
            description: r.get(2)?,
            icon: r.get(3)?,
            system_prompt: r.get(4)?,
            temperature: r.get(5)?,
            model_override: r.get(6)?,
            collection_scope: r.get(7)?,
            is_builtin: r.get::<_, i32>(8)? != 0,
            created_at: r.get(9)?,
            updated_at: r.get(10)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn get_expert(conn: &Connection, id: &str) -> Result<Option<Expert>> {
    let result = conn.query_row(
        "SELECT id, name, description, icon, system_prompt, temperature, \
         model_override, collection_scope, is_builtin, created_at, updated_at \
         FROM experts WHERE id = ?1",
        [id],
        |r| {
            Ok(Expert {
                id: r.get(0)?,
                name: r.get(1)?,
                description: r.get(2)?,
                icon: r.get(3)?,
                system_prompt: r.get(4)?,
                temperature: r.get(5)?,
                model_override: r.get(6)?,
                collection_scope: r.get(7)?,
                is_builtin: r.get::<_, i32>(8)? != 0,
                created_at: r.get(9)?,
                updated_at: r.get(10)?,
            })
        },
    );
    match result {
        Ok(e) => Ok(Some(e)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn create_expert(conn: &Connection, expert: &Expert) -> Result<()> {
    conn.execute(
        "INSERT INTO experts \
         (id, name, description, icon, system_prompt, temperature, \
          model_override, collection_scope, is_builtin, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9, ?9)",
        rusqlite::params![
            expert.id,
            expert.name.trim(),
            expert.description,
            expert.icon,
            expert.system_prompt,
            expert.temperature,
            expert.model_override,
            expert.collection_scope,
            chrono_now(),
        ],
    )?;
    Ok(())
}

pub fn update_expert(conn: &Connection, expert: &Expert) -> Result<()> {
    conn.execute(
        "UPDATE experts SET name = ?2, description = ?3, icon = ?4, \
         system_prompt = ?5, temperature = ?6, model_override = ?7, \
         collection_scope = ?8, updated_at = ?9 WHERE id = ?1",
        rusqlite::params![
            expert.id,
            expert.name.trim(),
            expert.description,
            expert.icon,
            expert.system_prompt,
            expert.temperature,
            expert.model_override,
            expert.collection_scope,
            chrono_now(),
        ],
    )?;
    Ok(())
}

pub fn delete_expert(conn: &Connection, id: &str) -> Result<()> {
    let is_builtin: bool = conn
        .query_row(
            "SELECT is_builtin FROM experts WHERE id = ?1",
            [id],
            |r| r.get::<_, i32>(0).map(|v| v != 0),
        )
        .unwrap_or(false);
    if is_builtin {
        anyhow::bail!("Built-in experts cannot be deleted. You can edit them instead.");
    }
    conn.execute("DELETE FROM experts WHERE id = ?1", [id])?;
    Ok(())
}

// ── collection instructions ──────────────────────────────────────────────────

pub fn get_collection_instructions(conn: &Connection, id: &str) -> Result<String> {
    let result = conn.query_row(
        "SELECT instructions FROM collections WHERE id = ?1",
        [id],
        |r| r.get::<_, String>(0),
    );
    match result {
        Ok(s) => Ok(s),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(String::new()),
        Err(e) => Err(e.into()),
    }
}

pub fn set_collection_instructions(conn: &Connection, id: &str, instructions: &str) -> Result<()> {
    conn.execute(
        "UPDATE collections SET instructions = ?2 WHERE id = ?1",
        rusqlite::params![id, instructions],
    )?;
    Ok(())
}

// ── tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn mem_db() -> Connection {
        open(Path::new(":memory:")).unwrap()
    }

    fn src(id: &str) -> SourceMeta {
        SourceMeta {
            id: id.into(),
            app: "TestApp".into(),
            window_title: "Test Window".into(),
            captured_at: "2026-01-01T00:00:00Z".into(),
            chunk_count: 0,
            char_count: 0,
            collection_id: DEFAULT_COLLECTION_ID.into(),
            url: None,
        }
    }

    #[test]
    fn insert_and_search() {
        let conn = mem_db();
        insert_source(&conn, &src("s1"), None).unwrap();
        insert_chunk(&conn, "s1", 0, "quarterly revenue targets exceeded").unwrap();
        insert_chunk(&conn, "s1", 1, "onboarding checklist for new hires").unwrap();

        let res = search(&conn, "revenue targets", 5).unwrap();
        assert!(!res.is_empty());
        assert!(res[0].snippet.contains("revenue"));
    }

    #[test]
    fn dedup_returns_one_per_source() {
        let conn = mem_db();
        insert_source(&conn, &src("a"), None).unwrap();
        insert_chunk(&conn, "a", 0, "project budget approved").unwrap();
        insert_chunk(&conn, "a", 1, "project timeline revised").unwrap();

        let res = search(&conn, "project", 10).unwrap();
        assert_eq!(res.len(), 1, "should dedup to one snippet per source");
    }

    #[test]
    fn delete_removes_chunks() {
        let conn = mem_db();
        insert_source(&conn, &src("x"), None).unwrap();
        insert_chunk(&conn, "x", 0, "confidential salary data").unwrap();
        delete_source(&conn, "x").unwrap();

        let res = search(&conn, "salary", 5).unwrap();
        assert!(res.is_empty());
    }

    #[test]
    fn update_source_text_replaces_chunks() {
        let conn = mem_db();
        insert_source(&conn, &src("u"), None).unwrap();
        insert_chunk(&conn, "u", 0, "draft paragraph about kangaroos").unwrap();

        let new_chunks = vec!["final paragraph about wombats".to_string()];
        update_source_text(&conn, "u", "2026-01-02T00:00:00Z", 29, &new_chunks).unwrap();

        // Old content gone from search; new content found.
        assert!(search(&conn, "kangaroos", 5).unwrap().is_empty());
        assert!(!search(&conn, "wombats", 5).unwrap().is_empty());

        // Counts and timestamp refreshed on the source row.
        let s = list_sources(&conn)
            .unwrap()
            .into_iter()
            .find(|s| s.id == "u")
            .unwrap();
        assert_eq!(s.chunk_count, 1);
        assert_eq!(s.char_count, 29);
        assert_eq!(s.captured_at, "2026-01-02T00:00:00Z");
    }

    #[test]
    fn url_round_trips() {
        let conn = mem_db();
        let mut meta = src("w");
        meta.url = Some("https://example.com/page".into());
        insert_source(&conn, &meta, None).unwrap();
        let s = list_sources(&conn).unwrap().into_iter().find(|s| s.id == "w").unwrap();
        assert_eq!(s.url.as_deref(), Some("https://example.com/page"));
    }
}
