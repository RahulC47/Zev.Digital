import { useStore } from "../store/useStore";

export function HealthPill() {
  const health = useStore((s) => s.health);
  const graphiti = useStore((s) => s.graphitiHealth);
  const setView = useStore((s) => s.setView);

  const ok = health?.ok;

  return (
    <div className="flex flex-col gap-1.5">
      {/* LLM health */}
      <button
        onClick={() => setView("settings")}
        title={health?.message}
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs"
        style={{
          border: `1px solid ${ok ? "var(--ok)" : "#f59e0b"}`,
          background: ok ? "rgba(52,211,153,0.1)" : "rgba(245,158,11,0.1)",
          color: ok ? "var(--ok)" : "#f59e0b",
          cursor: "pointer",
        }}
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: ok ? "var(--ok)" : "#f59e0b" }}
        />
        <span className="min-w-0 flex-1 truncate">
          {health
            ? ok
              ? `${health.provider} · ${health.chat_model}`
              : "Model offline — click to fix"
            : "Checking model…"}
        </span>
      </button>

      {/* Knowledge graph health */}
      {graphiti && (
        <div
          className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-[11px]"
          style={{
            border: `1px solid ${graphiti.ready ? "var(--ok)" : "var(--border)"}`,
            background: graphiti.ready ? "rgba(52,211,153,0.05)" : "var(--panel2)",
            color: graphiti.ready ? "var(--ok)" : "var(--muted)",
          }}
        >
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: graphiti.ready ? "var(--ok)" : "var(--muted)" }}
          />
          <span className="truncate">{graphiti.message}</span>
        </div>
      )}
    </div>
  );
}
