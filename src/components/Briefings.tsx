import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export default function Briefings() {
  const [briefing, setBriefing] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="flex h-full flex-col overflow-y-auto p-8 text-white">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="mb-2 text-3xl font-bold tracking-tight">Daily Briefing</h1>
        <p className="mb-8 text-sm" style={{ color: "var(--muted)" }}>
          A synthesized summary of your last 24 hours of captured context, meetings, and research.
        </p>

        {!briefing && !generating && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 p-12 text-center">
            <div className="mb-4 text-4xl">📰</div>
            <h3 className="mb-2 text-lg font-medium">Ready for your briefing?</h3>
            <p className="mb-6 text-sm opacity-70 max-w-md mx-auto">
              Zev will analyze everything captured in the last 24 hours, group it by app, and extract action items and insights.
            </p>
            <button
              onClick={fetchBriefing}
              className="rounded-lg bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Generate Today's Briefing
            </button>
          </div>
        )}

        {generating && (
          <div className="flex animate-pulse flex-col items-center justify-center rounded-xl border border-white/5 bg-white/5 p-12 text-center">
            <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-[var(--accent)]"></div>
            <div className="text-sm font-medium">Analyzing last 24 hours of context...</div>
            <div className="mt-2 text-xs opacity-50">This may take a minute depending on your model.</div>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-500/10 p-4 text-sm text-red-400 border border-red-500/20">
            {error}
          </div>
        )}

        {briefing && !generating && (
          <div className="prose prose-invert max-w-none rounded-xl border border-white/10 bg-[var(--panel2)] p-8">
            <div dangerouslySetInnerHTML={{ __html: briefing }} />
          </div>
        )}
      </div>
    </div>
  );
}
