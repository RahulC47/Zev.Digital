import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export default function Briefings() {
  const [briefing, setBriefing] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchBriefing = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await invoke<string>("generate_daily_briefing");
      setBriefing(res);
    } catch (e: any) {
      setError(e.toString());
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = () => {
    if (!briefing) return;
    navigator.clipboard.writeText(briefing);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="flex h-full flex-col overflow-y-auto p-8"
      style={{ backgroundColor: "var(--bg)", color: "var(--text)" }}
    >
      <div className="mx-auto w-full max-w-3xl">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight" style={{ color: "var(--text)" }}>
              Daily Briefing
            </h1>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              A synthesized summary of your last 24 hours of captured context, meetings, and research.
            </p>
          </div>
          {briefing && !generating && (
            <div className="flex gap-2">
              <button
                onClick={handleCopy}
                className="rounded-lg border px-3 py-1.5 text-xs font-medium transition hover:opacity-80"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--panel)", color: "var(--text)" }}
              >
                {copied ? "Copied ✓" : "Copy Briefing"}
              </button>
              <button
                onClick={fetchBriefing}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90"
                style={{ backgroundColor: "var(--accent)" }}
              >
                Regenerate ↻
              </button>
            </div>
          )}
        </div>

        {/* Empty state / Prompt to generate */}
        {!briefing && !generating && (
          <div
            className="flex flex-col items-center justify-center rounded-2xl border p-12 text-center shadow-sm"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--panel)",
            }}
          >
            <div className="mb-4 text-4xl">📰</div>
            <h3 className="mb-2 text-lg font-semibold" style={{ color: "var(--text)" }}>
              Ready for your briefing?
            </h3>
            <p className="mb-6 max-w-md text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
              Zev will analyze everything captured in the last 24 hours, group it by app, and extract action items and insights.
            </p>
            <button
              onClick={fetchBriefing}
              className="rounded-lg px-6 py-2.5 text-sm font-semibold text-white shadow transition hover:opacity-90"
              style={{ backgroundColor: "var(--accent)" }}
            >
              Generate Today's Briefing
            </button>
          </div>
        )}

        {/* Generating state */}
        {generating && (
          <div
            className="flex flex-col items-center justify-center rounded-2xl border p-12 text-center shadow-sm"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--panel)" }}
          >
            <div
              className="mb-4 h-9 w-9 animate-spin rounded-full border-2 border-t-transparent"
              style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }}
            />
            <div className="text-base font-semibold" style={{ color: "var(--text)" }}>
              Synthesizing your daily briefing...
            </div>
            <div className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
              Analyzing captured windows, meetings, and notes from the last 24 hours.
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div
            className="rounded-xl border p-4 text-sm"
            style={{ borderColor: "rgba(239, 68, 68, 0.3)", backgroundColor: "rgba(239, 68, 68, 0.1)", color: "#ef4444" }}
          >
            <strong>Error generating briefing:</strong> {error}
          </div>
        )}

        {/* Result view */}
        {briefing && !generating && (
          <div
            className="rounded-2xl border p-8 shadow-sm"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--panel)",
              color: "var(--text)",
            }}
          >
            <div
              className="whitespace-pre-wrap text-sm leading-relaxed"
              style={{ color: "var(--text)", fontFamily: "inherit" }}
            >
              {briefing}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
