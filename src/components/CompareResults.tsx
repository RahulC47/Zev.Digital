import type { CompareResponse } from "../lib/api";

// ── inline styles ────────────────────────────────────────────────────────────

const PROVIDER_COLORS: Record<string, string> = {
  ollama: "#22c55e",
  openrouter: "#3b82f6",
  byok: "#f59e0b",
};

const styles = {
  grid: {
    display: "grid",
    gap: 14,
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 400px), 1fr))",
  } as React.CSSProperties,
  card: (loaded: boolean) =>
    ({
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 12,
      padding: 16,
      display: "flex",
      flexDirection: "column" as const,
      gap: 10,
      opacity: loaded ? 1 : 0.5,
      transform: loaded ? "translateY(0)" : "translateY(6px)",
      transition: "opacity 0.35s ease, transform 0.35s ease, box-shadow 0.2s ease",
      ...(loaded
        ? {}
        : {}),
    }) as React.CSSProperties,
  cardHover: {
    boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 4px 20px rgba(0,0,0,0.25)",
  } as React.CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  } as React.CSSProperties,
  label: {
    fontSize: 14,
    fontWeight: 600,
    color: "#e2e8f0",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  } as React.CSSProperties,
  badge: (provider: string) =>
    ({
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      fontSize: 11,
      fontWeight: 500,
      padding: "2px 8px",
      borderRadius: 999,
      color: PROVIDER_COLORS[provider] ?? "#94a3b8",
      background: `${PROVIDER_COLORS[provider] ?? "#6b7280"}18`,
      flexShrink: 0,
    }) as React.CSSProperties,
  dot: (color: string) =>
    ({
      display: "inline-block",
      width: 6,
      height: 6,
      borderRadius: "50%",
      background: color,
    }) as React.CSSProperties,
  body: {
    fontSize: 13,
    lineHeight: 1.65,
    color: "#cbd5e1",
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
    flex: 1,
    minHeight: 40,
  } as React.CSSProperties,
  errorBody: {
    fontSize: 13,
    lineHeight: 1.65,
    color: "#f87171",
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
    flex: 1,
    minHeight: 40,
  } as React.CSSProperties,
  footer: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 4,
  } as React.CSSProperties,
  latency: {
    fontSize: 11,
    color: "#64748b",
    fontVariantNumeric: "tabular-nums",
  } as React.CSSProperties,
  pulse: {
    fontSize: 13,
    color: "#94a3b8",
    animation: "zev-pulse 1.4s ease-in-out infinite",
  } as React.CSSProperties,
} as const;

interface Props {
  results: CompareResponse[];
  comparing: boolean;
  modelCount: number;
}

export default function CompareResults({ results, comparing, modelCount }: Props) {
  // Build a card list: realized results + placeholder cards for pending models
  const placeholderCount = comparing ? Math.max(0, modelCount - results.length) : 0;

  return (
    <div style={styles.grid}>
      {results.map((r, i) => (
        <div key={i} style={styles.card(true)}>
          <div style={styles.header}>
            <span style={styles.label}>{r.label || `${r.provider} · ${r.model}`}</span>
            <span style={styles.badge(r.provider)}>
              <span style={styles.dot(PROVIDER_COLORS[r.provider] ?? "#6b7280")} />
              {r.provider}
            </span>
          </div>
          <div style={r.error ? styles.errorBody : styles.body}>
            {r.error ? `❌ ${r.error}` : r.answer.text}
          </div>
          <div style={styles.footer}>
            <span style={styles.latency}>⏱ {(r.latency_ms / 1000).toFixed(1)}s</span>
            {r.answer.citations.length > 0 && (
              <span style={styles.latency}>
                📎 {r.answer.citations.length} citation{r.answer.citations.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
      ))}

      {Array.from({ length: placeholderCount }).map((_, i) => (
        <div key={`pending-${i}`} style={styles.card(false)}>
          <div style={styles.header}>
            <span style={styles.label}>—</span>
          </div>
          <div style={styles.body}>
            <span style={styles.pulse}>Thinking…</span>
          </div>
          <div style={styles.footer} />
        </div>
      ))}
    </div>
  );
}
