//! OS-level capture: read the text the user is looking at, straight from the
//! operating system's accessibility tree — no app APIs, no screenshots.
//!
//! `CaptureProvider` abstracts the platform. Today the Windows provider uses the
//! mature `uiautomation` crate (UIAutomation API). macOS/Linux are stubbed; the
//! planned cross-platform swap-in is the `xa11y` crate (one API over
//! UIAutomation / AXUIElement / AT-SPI2). See the project plan.
//!
//! The walk is pruned for signal: chrome noise (scrollbars, menus, images),
//! password fields, and offscreen subtrees are skipped, and a wall-clock
//! deadline bounds worst-case captures. Browsers additionally get URL
//! extraction, a content-only Document walk, and a private-window skip.

use anyhow::Result;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Captured {
    pub app: String,
    pub window_title: String,
    pub text: String,
    /// Page URL when the source window is a browser (None elsewhere).
    pub url: Option<String>,
}

/// Capture behavior derived from user settings (built in the command layer so
/// this module stays settings-free).
#[derive(Debug, Clone)]
pub struct CaptureOpts {
    pub skip_private_browsing: bool,
}

impl Default for CaptureOpts {
    fn default() -> Self {
        Self { skip_private_browsing: true }
    }
}

pub trait CaptureProvider: Send + Sync {
    /// Read the current foreground window's accessible text (manual capture —
    /// climbs from the focused element).
    fn capture(&self, opts: &CaptureOpts) -> Result<Captured>;

    /// Read a specific top-level window by native handle (capture loop —
    /// guarantees we read exactly the window the foreground probe saw).
    fn capture_window(&self, _hwnd: isize, opts: &CaptureOpts) -> Result<Captured> {
        self.capture(opts)
    }
}

/// The provider for the current platform.
pub fn provider() -> Box<dyn CaptureProvider> {
    #[cfg(windows)]
    {
        Box::new(windows_impl::WindowsProvider)
    }
    #[cfg(not(windows))]
    {
        Box::new(stub::StubProvider)
    }
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------
#[cfg(windows)]
mod windows_impl {
    use super::*;
    use std::time::{Duration, Instant};
    use uiautomation::patterns::{UITextPattern, UIValuePattern};
    use uiautomation::types::ControlType;
    use uiautomation::{UIAutomation, UIElement, UITreeWalker};

    /// Element budget per walk — once exhausted, the walk stops.
    const ELEMENT_BUDGET: usize = 4000;
    /// Wall-clock deadline per walk — deeply nested trees (Electron apps,
    /// heavy web pages) can be slow per element even within the budget.
    const WALK_DEADLINE: Duration = Duration::from_secs(3);
    /// Per-element / per-document text cap.
    const TEXT_CAP: usize = 20_000;
    /// Matcher timeout (ms). The crate default is 3s with retries, which
    /// would stall every capture of a window lacking a match — keep it low.
    const MATCH_TIMEOUT_MS: u64 = 250;

    /// Browser process stems (lowercase, no .exe).
    const BROWSERS: &[&str] = &[
        "chrome", "msedge", "firefox", "brave", "opera", "opera_gx", "vivaldi", "arc", "zen",
    ];
    /// Private-window title markers (Chromium, Edge, Firefox literal suffixes).
    const PRIVATE_MARKERS: &[&str] = &["Incognito", "InPrivate", "Private Browsing"];

    pub struct WindowsProvider;

    impl CaptureProvider for WindowsProvider {
        fn capture(&self, opts: &CaptureOpts) -> Result<Captured> {
            let automation = UIAutomation::new().map_err(map_err)?;
            let top = foreground_window(&automation).map_err(map_err)?;
            read_window(&automation, top, opts)
        }

        fn capture_window(&self, hwnd: isize, opts: &CaptureOpts) -> Result<Captured> {
            let automation = UIAutomation::new().map_err(map_err)?;
            let top = automation.element_from_handle(hwnd.into()).map_err(map_err)?;
            read_window(&automation, top, opts)
        }
    }

    fn map_err(e: uiautomation::Error) -> anyhow::Error {
        let msg = e.to_string().to_lowercase();
        if msg.contains("unspecified")
            || msg.contains("element not available")
            || msg.contains("invalid window handle")
        {
            anyhow::anyhow!(
                "No accessible window in focus — click the window you want \
                 to capture first, then press Capture."
            )
        } else {
            anyhow::anyhow!("Capture failed: {e}")
        }
    }

    /// Climb from the focused element to the top-level window (a direct child
    /// of the desktop) — the manual-capture path.
    fn foreground_window(automation: &UIAutomation) -> uiautomation::Result<UIElement> {
        let walker = automation.get_control_view_walker()?;
        let root = automation.get_root_element()?;
        let root_id = root.get_runtime_id().unwrap_or_default();

        let focused = automation.get_focused_element()?;
        let mut top = focused.clone();
        loop {
            let parent = match walker.get_parent(&top) {
                Ok(p) => p,
                Err(_) => break,
            };
            if parent.get_runtime_id().unwrap_or_default() == root_id {
                break;
            }
            top = parent;
        }
        Ok(top)
    }

    /// Shared read: title/pid/app first, then the pruned walk (browser-aware).
    fn read_window(
        automation: &UIAutomation,
        top: UIElement,
        opts: &CaptureOpts,
    ) -> Result<Captured> {
        let window_title = top.get_name().unwrap_or_default();
        let pid = top.get_process_id().map_err(map_err)?;

        if pid == std::process::id() {
            anyhow::bail!(
                "That would capture Zev itself. Switch to the window you want to capture first."
            );
        }
        let app = process_name(pid).unwrap_or_else(|| "Unknown app".to_string());
        let stem = app_stem(&app);
        let browser = BROWSERS.contains(&stem.as_str());

        if browser
            && opts.skip_private_browsing
            && PRIVATE_MARKERS.iter().any(|m| window_title.contains(m))
        {
            anyhow::bail!("Private browsing window — skipped.");
        }

        let walker = automation.get_control_view_walker().map_err(map_err)?;
        let mut text = String::new();
        let mut url: Option<String> = None;
        let mut budget = WalkBudget {
            elements: ELEMENT_BUDGET,
            deadline: Instant::now() + WALK_DEADLINE,
        };

        if browser {
            url = browser_url(automation, &top);
            // Prefer the page's Document subtree: skips bookmark bars, tab
            // strips and other browser chrome, and the Document usually
            // exposes the whole readable page via one TextPattern call.
            if let Some(doc) = document_element(automation, &top) {
                if !window_title.is_empty() {
                    text.push_str(&window_title);
                    text.push('\n');
                }
                if let Some(u) = &url {
                    text.push_str(u);
                    text.push('\n');
                }
                collect(&walker, &doc, &mut text, &mut budget);
            }
        }
        // Non-browser, or browser without an accessible Document (PDF viewer
        // plugins, chrome:// pages): walk the whole window.
        if text.trim().is_empty() {
            text.clear();
            collect(&walker, &top, &mut text, &mut budget);
        }

        Ok(Captured { app, window_title, text, url })
    }

    struct WalkBudget {
        elements: usize,
        deadline: Instant,
    }

    fn collect(walker: &UITreeWalker, el: &UIElement, out: &mut String, b: &mut WalkBudget) {
        if b.elements == 0 || Instant::now() >= b.deadline {
            return;
        }
        b.elements -= 1;

        // Prune pure-chrome subtrees: they carry no user content and burn
        // the element budget (scrollbars, menus, decorative images, …).
        if let Ok(ct) = el.get_control_type() {
            match ct {
                ControlType::ScrollBar
                | ControlType::TitleBar
                | ControlType::MenuBar
                | ControlType::Menu
                | ControlType::MenuItem
                | ControlType::Image
                | ControlType::ProgressBar
                | ControlType::Slider
                | ControlType::Spinner
                | ControlType::Separator
                | ControlType::ToolTip => return,
                _ => {}
            }
        }

        // Never read password fields — masked Edits expose their secret via
        // both ValuePattern and TextPattern, so this must come before any read.
        if el.is_password().unwrap_or(false) {
            return;
        }

        // Documents/editors (Windows 11 Notepad, Word, web documents) expose
        // their content via the Text pattern. The document range already
        // covers all descendants — including content scrolled offscreen — so
        // this runs BEFORE the offscreen prune, and skips the subtree when it
        // yields text (descending would duplicate every line).
        if let Ok(tp) = el.get_pattern::<UITextPattern>() {
            if let Ok(range) = tp.get_document_range() {
                if let Ok(txt) = range.get_text(TEXT_CAP as i32) {
                    let txt = txt.trim();
                    if !txt.is_empty() {
                        out.push_str(txt);
                        out.push('\n');
                        return;
                    }
                }
            }
        }

        // Prune offscreen subtrees: background tabs, collapsed panels and
        // virtualized-list remainders dominate noise and budget in big apps.
        if el.is_offscreen().unwrap_or(false) {
            return;
        }

        if let Ok(name) = el.get_name() {
            let name = name.trim();
            if !name.is_empty() {
                out.push_str(name);
                out.push('\n');
            }
        }
        // Editable/content controls expose their text via the Value pattern.
        if let Ok(vp) = el.get_pattern::<UIValuePattern>() {
            if let Ok(val) = vp.get_value() {
                let val = val.trim();
                if !val.is_empty() && val.len() < TEXT_CAP {
                    out.push_str(val);
                    out.push('\n');
                }
            }
        }

        if let Ok(child) = walker.get_first_child(el) {
            let mut cur = child;
            loop {
                collect(walker, &cur, out, b);
                if b.elements == 0 || Instant::now() >= b.deadline {
                    break;
                }
                match walker.get_next_sibling(&cur) {
                    Ok(next) => cur = next,
                    Err(_) => break,
                }
            }
        }
    }

    /// Find the page URL in a browser window: the address bar is an Edit
    /// control whose ValuePattern holds the (often scheme-less) URL.
    fn browser_url(automation: &UIAutomation, top: &UIElement) -> Option<String> {
        let edits = automation
            .create_matcher()
            .from(top.clone())
            .control_type(ControlType::Edit)
            .depth(8)
            .timeout(MATCH_TIMEOUT_MS)
            .find_all()
            .ok()?;
        for e in edits {
            if e.is_password().unwrap_or(false) {
                continue;
            }
            if let Ok(vp) = e.get_pattern::<UIValuePattern>() {
                if let Ok(v) = vp.get_value() {
                    let v = v.trim();
                    if looks_like_url(v) {
                        return Some(if v.contains("://") {
                            v.to_string()
                        } else {
                            // Chromium strips the scheme in the address bar.
                            format!("https://{v}")
                        });
                    }
                }
            }
        }
        None
    }

    fn looks_like_url(s: &str) -> bool {
        if s.is_empty() || s.len() > 2048 || s.chars().any(|c| c.is_whitespace()) {
            return false;
        }
        if s.contains("://") {
            return true;
        }
        // Scheme-less hostname shape: "docs.rs/path", "mail.google.com/mail".
        let host = s.split('/').next().unwrap_or("");
        host.contains('.')
            && !host.starts_with('.')
            && host
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == ':')
    }

    /// The browser's page content lives under a Document control.
    fn document_element(automation: &UIAutomation, top: &UIElement) -> Option<UIElement> {
        automation
            .create_matcher()
            .from(top.clone())
            .control_type(ControlType::Document)
            .depth(12)
            .timeout(MATCH_TIMEOUT_MS)
            .find_first()
            .ok()
    }

    /// Lowercased executable stem: "msedge.exe" → "msedge".
    fn app_stem(app: &str) -> String {
        let lower = app.to_lowercase();
        lower.strip_suffix(".exe").unwrap_or(&lower).to_string()
    }

    fn process_name(pid: u32) -> Option<String> {
        use sysinfo::{Pid, ProcessRefreshKind, System};
        if pid == 0 {
            return None;
        }
        // Refresh only this PID — refreshing all processes is far too
        // expensive to run on every capture.
        let mut sys = System::new();
        let pid = Pid::from_u32(pid);
        sys.refresh_process_specifics(pid, ProcessRefreshKind::new());
        sys.process(pid).map(|p| p.name().to_string())
    }
}

// ---------------------------------------------------------------------------
// macOS / Linux (stub until the xa11y provider lands)
// ---------------------------------------------------------------------------
#[cfg(not(windows))]
mod stub {
    use super::*;

    pub struct StubProvider;

    impl CaptureProvider for StubProvider {
        fn capture(&self, _opts: &CaptureOpts) -> Result<Captured> {
            anyhow::bail!(
                "OS-level capture isn't available on this platform yet. \
                 The cross-platform xa11y provider is planned (see project plan)."
            )
        }
    }
}
