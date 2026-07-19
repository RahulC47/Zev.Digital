import { useEffect } from "react";
import { useStore } from "../store/useStore";

/**
 * Start/Stop pill for the background continuous-capture loop.
 * Sits next to the manual CaptureButton in the header.
 */
export function CaptureToggle() {
  const running = useStore((s) => s.captureLoopRunning);
  const toggle = useStore((s) => s.toggleCaptureLoop);
  const refresh = useStore((s) => s.refreshCaptureLoopStatus);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <button
      onClick={toggle}
      title={
        running
          ? "Zev is capturing every window you switch to. Click to stop."
          : "Start capturing context automatically in the background."
      }
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition"
      style={{
        border: `1px solid ${running ? "var(--danger)" : "var(--border)"}`,
        background: running ? "rgba(255,91,110,0.1)" : "var(--panel2)",
        color: running ? "var(--danger)" : "var(--text)",
        cursor: "pointer",
      }}
    >
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{
          background: running ? "var(--danger)" : "var(--muted)",
          animation: running ? "zev-pulse 1.4s ease-in-out infinite" : "none",
        }}
      />
      {running ? "Stop auto-capture" : "Start auto-capture"}
    </button>
  );
}
