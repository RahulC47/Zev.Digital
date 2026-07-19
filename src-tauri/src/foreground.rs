//! Cheap foreground-window probe — pure Win32, no COM/UIAutomation.
//!
//! The capture loop calls this every second to notice window switches and
//! title changes without paying for a full accessibility-tree walk. The
//! expensive UIA capture only runs when this probe says something changed
//! (or the per-window capture interval elapsed).

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForegroundInfo {
    /// Raw HWND, used later for `element_from_handle` so the full capture
    /// reads exactly the window the probe saw.
    pub hwnd: isize,
    pub pid: u32,
    pub title: String,
}

#[cfg(windows)]
pub fn probe() -> Option<ForegroundInfo> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    };

    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.is_invalid() {
        return None;
    }
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    // Skip invalid windows and Zev itself.
    if pid == 0 || pid == std::process::id() {
        return None;
    }
    let mut buf = [0u16; 512];
    let n = unsafe { GetWindowTextW(hwnd, &mut buf) } as usize;
    Some(ForegroundInfo {
        hwnd: hwnd.0 as isize,
        pid,
        title: String::from_utf16_lossy(&buf[..n.min(buf.len())]),
    })
}

#[cfg(not(windows))]
pub fn probe() -> Option<ForegroundInfo> {
    None
}
