import { useCallback, useEffect, useState } from "react";
import { api, type LlmTrace, type LlmTraceSummary, type TraceStats } from "../lib/api";

const KIND_OPTIONS = ["all", "chat", "extraction"] as const;

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex flex-col gap-0.5 rounded-lg px-4 py-2"
      style={{ background: "var(--panel2)", border: "1px solid var(--border)" }}
    >
      <span className="text-[11px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>
        {label}
      </span>
      <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>
        {value}
      </span>
    </div>
  );
}

function TraceRow({
  t,
  onExpand,
}: {
  t: LlmTraceSummary;
  onExpand: (id: string) => void;
}) {
  const ts = new Date(t.timestamp);
  const time = ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const date = ts.toLocaleDateString([], { month: "short", day: "numeric" });
  const tokens =
    t.input_tokens != null && t.output_tokens != null
      ? `${t.input_tokens} / ${t.output_tokens}`
      : "--";

  return (
    <tr
      className="cursor-pointer transition"
      style={{ borderBottom: "1px solid var(--border)" }}
      onClick={() => onExpand(t.id)}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <td className="px-3 py-2 text-xs" style={{ color: "var(--muted)" }}>
        {date} {time}
      </td>
      <td className="px-3 py-2">
        <span
          className="rounded px-1.5 py-0.5 text-[11px] font-medium"
          style={{
            background: t.kind === "chat" ? "rgba(91,140,255,0.15)" : "rgba(168,85,247,0.15)",
            color: t.kind === "chat" ? "var(--accent)" : "#a855f7",
          }}
        >
          {t.kind}
        </span>
      </td>
      <td className="px-3 py-2 text-xs" style={{ color: "var(--text)" }}>
        {t.provider}
      </td>
      <td className="max-w-[140px] truncate px-3 py-2 text-xs" style={{ color: "var(--text)" }}>
        {t.model}
      </td>
      <td className="px-3 py-2 text-right text-xs font-mono" style={{ color: "var(--text)" }}>
        {t.latency_ms.toLocaleString()} ms
      </td>
      <td className="px-3 py-2 text-right text-xs font-mono" style={{ color: "var(--muted)" }}>
        {tokens}
      </td>
      <td className="px-3 py-2 text-center">
        {t.error ? (
          <span style={{ color: "var(--danger, #ef4444)" }} title={t.error}>
            !
          </span>
        ) : (
          <span style={{ color: "var(--ok, #22c55e)" }}>ok</span>
        )}
      </td>
    </tr>
  );
}

function TraceDetail({
  trace,
  onClose,
}: {
  trace: LlmTrace;
  onClose: () => void;
}) {
  return (
    <div
      className="flex flex-col gap-4 overflow-auto rounded-xl p-5"
      style={{ background: "var(--panel2)", border: "1px solid var(--border)" }}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          Trace detail
        </h3>
        <button
          onClick={onClose}
          className="rounded px-2 py-1 text-xs"
          style={{ color: "var(--muted)" }}
        >
          Close
        </button>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs" style={{ color: "var(--muted)" }}>
        <span>Kind: <b style={{ color: "var(--text)" }}>{trace.kind}</b></span>
        <span>Provider: <b style={{ color: "var(--text)" }}>{trace.provider}</b></span>
        <span>Model: <b style={{ color: "var(--text)" }}>{trace.model}</b></span>
        <span>Latency: <b style={{ color: "var(--text)" }}>{trace.latency_ms.toLocaleString()} ms</b></span>
        <span>In tokens: <b style={{ color: "var(--text)" }}>{trace.input_tokens ?? "--"}</b></span>
        <span>Out tokens: <b style={{ color: "var(--text)" }}>{trace.output_tokens ?? "--"}</b></span>
        <span>Time: <b style={{ color: "var(--text)" }}>{new Date(trace.timestamp).toLocaleString()}</b></span>
        {trace.error && (
          <span>Error: <b style={{ color: "var(--danger, #ef4444)" }}>{trace.error}</b></span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-[11px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          System prompt
        </label>
        <pre
          className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg p-3 text-xs"
          style={{ background: "var(--panel)", color: "var(--text)", border: "1px solid var(--border)" }}
        >
          {trace.system_prompt}
        </pre>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-[11px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          User prompt
        </label>
        <pre
          className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg p-3 text-xs"
          style={{ background: "var(--panel)", color: "var(--text)", border: "1px solid var(--border)" }}
        >
          {trace.user_prompt}
        </pre>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-[11px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          Response
        </label>
        <pre
          className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg p-3 text-xs"
          style={{ background: "var(--panel)", color: "var(--text)", border: "1px solid var(--border)" }}
        >
          {trace.response || "(empty)"}
        </pre>
      </div>
    </div>
  );
}

export function Traces() {
  const [traces, setTraces] = useState<LlmTraceSummary[]>([]);
  const [stats, setStats] = useState<TraceStats | null>(null);
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<LlmTrace | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [t, s] = await Promise.all([
        api.listLlmTraces(200, 0, kindFilter === "all" ? undefined : kindFilter),
        api.llmTraceStats(),
      ]);
      setTraces(t);
      setStats(s);
    } finally {
      setLoading(false);
    }
  }, [kindFilter]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleExpand = async (id: string) => {
    const full = await api.getLlmTrace(id);
    if (full) setExpanded(full);
  };

  const handleClear = async () => {
    await api.clearLlmTraces();
    setTraces([]);
    setExpanded(null);
    const s = await api.llmTraceStats();
    setStats(s);
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold" style={{ color: "var(--text)" }}>
          LLM Traces
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            disabled={loading}
            className="rounded-lg px-3 py-1 text-xs font-medium transition"
            style={{ background: "var(--panel2)", color: "var(--text)", border: "1px solid var(--border)" }}
          >
            {loading ? "..." : "Refresh"}
          </button>
          {traces.length > 0 && (
            <button
              onClick={handleClear}
              className="rounded-lg px-3 py-1 text-xs font-medium transition"
              style={{ background: "rgba(239,68,68,0.1)", color: "var(--danger, #ef4444)", border: "1px solid var(--danger, #ef4444)" }}
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {stats && (
        <div className="flex flex-wrap gap-3">
          <StatCard label="Total calls" value={stats.total_calls.toLocaleString()} />
          <StatCard label="Errors" value={stats.total_errors.toLocaleString()} />
          <StatCard label="Avg latency" value={`${Math.round(stats.avg_latency_ms)} ms`} />
          <StatCard
            label="Tokens (in / out)"
            value={`${stats.total_input_tokens.toLocaleString()} / ${stats.total_output_tokens.toLocaleString()}`}
          />
        </div>
      )}

      <div className="flex gap-1">
        {KIND_OPTIONS.map((k) => (
          <button
            key={k}
            onClick={() => setKindFilter(k)}
            className="rounded-md px-3 py-1 text-xs font-medium transition"
            style={{
              background: kindFilter === k ? "var(--accent)" : "var(--panel2)",
              color: kindFilter === k ? "#fff" : "var(--muted)",
              border: `1px solid ${kindFilter === k ? "var(--accent)" : "var(--border)"}`,
            }}
          >
            {k}
          </button>
        ))}
      </div>

      {expanded && <TraceDetail trace={expanded} onClose={() => setExpanded(null)} />}

      {traces.length === 0 && !loading ? (
        <div
          className="flex flex-1 items-center justify-center text-sm"
          style={{ color: "var(--muted)" }}
        >
          No traces yet. Ask a question in Chat to generate your first trace.
        </div>
      ) : (
        <div className="overflow-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
          <table className="w-full text-left" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--panel2)", borderBottom: "1px solid var(--border)" }}>
                <th className="px-3 py-2 text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--muted)" }}>Time</th>
                <th className="px-3 py-2 text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--muted)" }}>Kind</th>
                <th className="px-3 py-2 text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--muted)" }}>Provider</th>
                <th className="px-3 py-2 text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--muted)" }}>Model</th>
                <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--muted)" }}>Latency</th>
                <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--muted)" }}>Tokens</th>
                <th className="px-3 py-2 text-center text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--muted)" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {traces.map((t) => (
                <TraceRow key={t.id} t={t} onExpand={handleExpand} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
