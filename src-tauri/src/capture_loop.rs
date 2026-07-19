//! Background continuous-capture loop — Littlebird-style.
//!
//! Runs on its own thread (UIAutomation/COM is thread-affine — `UIAutomation::new()`
//! initializes COM per-thread inside the capture provider). The loop separates a
//! **cheap foreground probe** (pure Win32, every second) from the **expensive
//! accessibility walk**, which only runs when the probe saw a window switch
//! (after a short settle delay) or the per-window capture interval elapsed.
//!
//! Captures are **session-coalesced**: while the user keeps working in the same
//! window/page, the loop updates one source in place instead of stacking
//! near-duplicate snapshots. Graphiti gets only the appended delta when the
//! change is a pure append (typing), so a growing document isn't re-extracted
//! from scratch every pass.

use crate::chunk;
use crate::commands::{self, AppState};
use crate::foreground;
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// Cheap foreground-probe cadence.
const POLL_MS: u64 = 1_000;
/// How often we re-check the `running` flag, so Stop is responsive.
const TICK_MS: u64 = 500;
/// Wait after a window switch before the full capture, so half-loaded pages
/// and mid-alt-tab states aren't snapshotted.
const SETTLE_MS: u64 = 1_500;
/// Re-captures of the same window within this span update the existing source
/// in place instead of creating a new one.
const SESSION_WINDOW: Duration = Duration::from_secs(15 * 60);
/// Session-map size guard.
const MAX_SESSIONS: usize = 64;
/// Minimum appended-delta size worth a Graphiti ingest of its own; smaller
/// appends ride along with a later pass.
const MIN_DELTA_CHARS: usize = 200;

fn hash_str(s: &str) -> u64 {
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}

/// Sleep up to `ms`, waking early (every TICK_MS) if `running` is cleared.
fn sleep_responsive(running: &Arc<AtomicBool>, ms: u64) {
    let ticks = ms / TICK_MS;
    for _ in 0..ticks.max(1) {
        if !running.load(Ordering::SeqCst) {
            return;
        }
        std::thread::sleep(Duration::from_millis(TICK_MS));
    }
}

/// Per-window-session bookkeeping for coalescing + delta ingest.
struct Session {
    source_id: String,
    last_hash: u64,
    last_persist: Instant,
    /// The full text last persisted — kept to detect pure appends.
    last_text: String,
    /// Byte cursor into `last_text` already sent to Graphiti.
    ingested_bytes: usize,
}

impl Session {
    /// Decide what to send to Graphiti for this update: a pure append sends
    /// only the new tail; an edit/replacement re-ingests everything.
    fn graphiti_delta<'a>(&mut self, new_text: &'a str) -> Option<&'a str> {
        let is_append = new_text.len() > self.ingested_bytes
            && new_text.is_char_boundary(self.ingested_bytes)
            && self.last_text.len() >= self.ingested_bytes
            && new_text.as_bytes()[..self.ingested_bytes]
                == self.last_text.as_bytes()[..self.ingested_bytes];
        if is_append {
            let tail = &new_text[self.ingested_bytes..];
            if tail.chars().count() < MIN_DELTA_CHARS {
                // Too small to be worth an extraction pass — keep the cursor
                // where it is so a later update carries this text along.
                return None;
            }
            self.ingested_bytes = new_text.len();
            Some(tail)
        } else {
            // Edited earlier content or different page in the same window:
            // re-ingest the whole text (the sidecar's entity fuzzy-dedup
            // absorbs the overlap) and reset the cursor.
            self.ingested_bytes = new_text.len();
            Some(new_text)
        }
    }
}

/// The loop body. Returns when `running` is cleared.
pub fn run(app: AppHandle, running: Arc<AtomicBool>) {
    let mut sessions: HashMap<String, Session> = HashMap::new();
    let mut current_fg: Option<foreground::ForegroundInfo> = None;
    let mut fg_changed_at = Instant::now();
    let mut capture_pending = false;
    let mut last_full_capture: HashMap<isize, Instant> = HashMap::new();

    while running.load(Ordering::SeqCst) {
        let state = app.state::<AppState>();

        // Read the live interval + pause flag each cycle so Settings changes
        // take effect without restarting the loop.
        let (paused, interval) = {
            let s = state.settings.lock().unwrap();
            (s.capture_paused, Duration::from_secs(s.capture_interval_secs.max(2)))
        };

        if paused {
            sleep_responsive(&running, 2_000);
            continue;
        }

        // ── 1. Cheap probe: did the foreground window change? ──────────────
        let fg = match foreground::probe() {
            Some(fg) => fg,
            None => {
                sleep_responsive(&running, POLL_MS);
                continue;
            }
        };

        if current_fg.as_ref() != Some(&fg) {
            // Window switch (or title change). Schedule a capture after the
            // settle delay — never snapshot mid-switch.
            current_fg = Some(fg);
            fg_changed_at = Instant::now();
            capture_pending = true;
            sleep_responsive(&running, POLL_MS);
            continue;
        }

        // ── 2. Is a full (expensive) capture due? ───────────────────────────
        let settled = capture_pending
            && fg_changed_at.elapsed() >= Duration::from_millis(SETTLE_MS);
        let interval_due = last_full_capture
            .get(&fg.hwnd)
            .map_or(true, |t| t.elapsed() >= interval);

        if !(settled || (!capture_pending && interval_due)) {
            sleep_responsive(&running, POLL_MS);
            continue;
        }

        capture_pending = false;
        last_full_capture.insert(fg.hwnd, Instant::now());
        if last_full_capture.len() > 256 {
            last_full_capture.clear();
        }

        // ── 3. Full accessibility walk (denylist / self / private-browsing
        //       / inaccessible all surface as Err — skip quietly). ───────────
        let cap = match commands::read_foreground_hwnd(&state, fg.hwnd) {
            Ok(cap) => cap,
            Err(_) => {
                sleep_responsive(&running, POLL_MS);
                continue;
            }
        };

        let normalized = chunk::normalize(&cap.text);
        if normalized.trim().is_empty() {
            sleep_responsive(&running, POLL_MS);
            continue;
        }
        let h = hash_str(&normalized);
        // Key by URL when we have one (stable per page — immune to unread-count
        // title churn), else by window title.
        let key = format!(
            "{}|{}",
            cap.app,
            cap.url.as_deref().unwrap_or(&cap.window_title)
        );

        // ── 4. Persist: coalesce into the session's source, or create new. ──
        let result = match sessions.get_mut(&key) {
            Some(s) if s.last_hash == h => None, // unchanged content
            Some(s) if s.last_persist.elapsed() < SESSION_WINDOW => {
                let delta = s.graphiti_delta(&normalized);
                match commands::update_capture(
                    &state,
                    &s.source_id,
                    &cap.app,
                    &cap.window_title,
                    cap.url.as_deref(),
                    &normalized,
                    delta,
                ) {
                    Ok(r) => {
                        s.last_hash = h;
                        s.last_persist = Instant::now();
                        s.last_text = normalized;
                        Some(r)
                    }
                    Err(e) => {
                        log::warn!("Auto-capture update failed (non-fatal): {e}");
                        None
                    }
                }
            }
            _ => match commands::persist_normalized(
                &state,
                &cap.app,
                &cap.window_title,
                cap.url.as_deref(),
                &normalized,
            ) {
                Ok(r) => {
                    sessions.insert(
                        key,
                        Session {
                            source_id: r.source_id.clone(),
                            last_hash: h,
                            last_persist: Instant::now(),
                            ingested_bytes: normalized.len(),
                            last_text: normalized,
                        },
                    );
                    Some(r)
                }
                Err(e) => {
                    log::warn!("Auto-capture persist failed (non-fatal): {e}");
                    None
                }
            },
        };

        if let Some(r) = result {
            let _ = app.emit("capture", &r);
        }

        // Evict stale sessions instead of destructively clearing everything.
        if sessions.len() > MAX_SESSIONS {
            sessions.retain(|_, s| s.last_persist.elapsed() < SESSION_WINDOW);
        }

        sleep_responsive(&running, POLL_MS);
    }
}
