import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useStore, type View } from "./store/useStore";
import { Chat } from "./components/Chat";
import { Experts } from "./components/Experts";
import { Sources } from "./components/Sources";
import { Settings } from "./components/Settings";
import { Traces } from "./components/Traces";
import { HealthPill } from "./components/HealthPill";
import { CaptureButton } from "./components/CaptureButton";
import { CaptureToggle } from "./components/CaptureToggle";
import { ThemeToggle } from "./components/ThemeToggle";
import type { CaptureResult } from "./lib/api";

import { ProviderSelector } from "./components/ProviderSelector";

const NAV: { id: View; label: string; icon: string }[] = [
  { id: "chat", label: "Ask", icon: "💬" },
  { id: "experts", label: "Experts", icon: "🧠" },
  { id: "sources", label: "Memory", icon: "🗄️" },
  { id: "traces", label: "Traces", icon: "📊" },
  { id: "settings", label: "Settings", icon: "⚙️" },
] as const;

function App() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const lastCapture = useStore((s) => s.lastCapture);
  const captureError = useStore((s) => s.captureError);
  const refreshSources = useStore((s) => s.refreshSources);
  const refreshHealth = useStore((s) => s.refreshHealth);
  const refreshGraphitiHealth = useStore((s) => s.refreshGraphitiHealth);
  const refreshCaptureLoopStatus = useStore((s) => s.refreshCaptureLoopStatus);
  const refreshExperts = useStore((s) => s.refreshExperts);
  const onAutoCapture = useStore((s) => s.onAutoCapture);
  const loadSettings = useStore((s) => s.loadSettings);
  const importFiles = useStore((s) => s.importFiles);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    refreshSources();
    refreshHealth();
    loadSettings();
    refreshCaptureLoopStatus();
    refreshExperts();
    // Check graphiti after a short delay (sidecar takes time to warm up).
    const timer = setTimeout(refreshGraphitiHealth, 5000);
    // Live updates from the background capture loop.
    const unlisten = listen<CaptureResult>("capture", (e) => {
      const r = e.payload;
      const verb = r.updated ? "Updated" : "Auto-captured";
      onAutoCapture(
        `${verb} ${r.char_count.toLocaleString()} chars from "${r.window_title}" (${r.app})`,
      );
    });
    // Drag-and-drop files anywhere on the window → import into the brain.
    const unlistenDrop = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "over") setDragOver(true);
      else if (e.payload.type === "leave") setDragOver(false);
      else if (e.payload.type === "drop") {
        setDragOver(false);
        if (e.payload.paths.length > 0) {
          setView("sources");
          importFiles(e.payload.paths);
        }
      }
    });
    return () => {
      clearTimeout(timer);
      unlisten.then((f) => f());
      unlistenDrop.then((f) => f());
    };
  }, [
    refreshSources,
    refreshHealth,
    refreshGraphitiHealth,
    refreshCaptureLoopStatus,
    refreshExperts,
    onAutoCapture,
    loadSettings,
    importFiles,
    setView,
  ]);

  return (
    <div className="relative flex h-full w-full overflow-hidden">
      {/* Drop overlay */}
      {dragOver && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center"
          style={{
            background: "rgba(91,140,255,0.12)",
            border: "2px dashed var(--accent)",
            pointerEvents: "none",
          }}
        >
          <div
            className="rounded-xl px-6 py-4 text-sm font-medium"
            style={{ background: "var(--panel)", border: "1px solid var(--accent)", color: "var(--accent)" }}
          >
            Drop files to add them to your brain
          </div>
        </div>
      )}
      {/* Sidebar */}
      <aside
        className="flex w-56 flex-col px-3 py-4"
        style={{ background: "var(--panel)", borderRight: "1px solid var(--border)" }}
      >
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg font-bold text-white shadow-sm"
            style={{
              background: "linear-gradient(135deg, var(--accent, #5b8cff), #3b82f6)",
              fontSize: 14,
            }}
          >
            Z
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold leading-none tracking-tight" style={{ color: "var(--text)" }}>
              Zev.Digital
            </div>
            <div className="mt-1 text-[10px]" style={{ color: "var(--muted)" }}>
              local · offline · yours
            </div>
          </div>
        </div>

        <nav className="flex flex-col gap-1">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setView(n.id)}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition"
              style={{
                background: view === n.id ? "var(--accent, #5b8cff)" : "transparent",
                color: view === n.id ? "#fff" : "var(--muted)",
                opacity: view === n.id ? 1 : 0.85,
              }}
              onMouseEnter={(e) => {
                if (view !== n.id) e.currentTarget.style.background = "var(--hover)";
              }}
              onMouseLeave={(e) => {
                if (view !== n.id) e.currentTarget.style.background = "transparent";
              }}
            >
              <span aria-hidden>{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-2.5">
          <ThemeToggle />
          <HealthPill />
          <ProviderSelector />
          <p className="px-1 text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
            Free &amp; open source. Everything stays on this device — bring your own
            LLM (local Ollama or a cloud key).
          </p>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header
          className="flex items-center gap-3 px-5 py-3"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <CaptureButton />
          <CaptureToggle />
          <div className="min-w-0 flex-1 truncate text-xs" style={{ color: "var(--muted)" }}>
            {captureError ? (
              <span style={{ color: "var(--danger)" }}>⚠ {captureError}</span>
            ) : (
              lastCapture
            )}
          </div>
        </header>

        <main className="flex-1 overflow-hidden">
          {view === "chat" && <Chat />}
          {view === "experts" && <Experts />}
          {view === "sources" && <Sources />}
          {view === "traces" && <Traces />}
          {view === "settings" && <Settings />}
        </main>
      </div>
    </div>
  );
}

export default App;
