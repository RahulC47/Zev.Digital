import { useState } from "react";
import { useStore } from "../store/useStore";
import type { ChatProvider, ModelSpec } from "../lib/api";

// ── inline styles ────────────────────────────────────────────────────────────

const PROVIDER_COLORS: Record<string, string> = {
  ollama: "#22c55e",
  openrouter: "#3b82f6",
  byok: "#f59e0b",
};

const styles = {
  container: {
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  } as React.CSSProperties,
  chipRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap" as const,
    alignItems: "center",
    marginBottom: 8,
  } as React.CSSProperties,
  chip: (provider: string) =>
    ({
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "4px 10px",
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 500,
      color: "#e2e8f0",
      background: `${PROVIDER_COLORS[provider] ?? "#6b7280"}22`,
      border: `1px solid ${PROVIDER_COLORS[provider] ?? "#6b7280"}55`,
    }) as React.CSSProperties,
  chipX: {
    cursor: "pointer",
    marginLeft: 2,
    opacity: 0.6,
    fontSize: 14,
    lineHeight: 1,
  } as React.CSSProperties,
  addBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 500,
    color: "#94a3b8",
    background: "rgba(255,255,255,0.04)",
    border: "1px dashed rgba(255,255,255,0.15)",
    cursor: "pointer",
  } as React.CSSProperties,
  form: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    background: "rgba(0,0,0,0.2)",
    border: "1px solid rgba(255,255,255,0.06)",
  } as React.CSSProperties,
  input: {
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(0,0,0,0.3)",
    color: "#e2e8f0",
    fontSize: 13,
    outline: "none",
  } as React.CSSProperties,
  select: {
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(0,0,0,0.3)",
    color: "#e2e8f0",
    fontSize: 13,
    outline: "none",
  } as React.CSSProperties,
  formBtn: {
    alignSelf: "flex-start" as const,
    padding: "5px 14px",
    borderRadius: 6,
    border: "none",
    background: "#3b82f6",
    color: "#fff",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
  } as React.CSSProperties,
  note: {
    fontSize: 11,
    color: "#64748b",
    margin: 0,
  } as React.CSSProperties,
  dot: (color: string) =>
    ({
      display: "inline-block",
      width: 6,
      height: 6,
      borderRadius: "50%",
      background: color,
      flexShrink: 0,
    }) as React.CSSProperties,
} as const;

type FormProvider = "ollama" | "openrouter" | "byok";

export default function CompareModelPicker() {
  const compareModels = useStore((s) => s.compareModels);
  const addCompareModel = useStore((s) => s.addCompareModel);
  const removeCompareModel = useStore((s) => s.removeCompareModel);

  const [showForm, setShowForm] = useState(false);
  const [provider, setProvider] = useState<FormProvider>("ollama");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [label, setLabel] = useState("");

  const resetForm = () => {
    setModel("");
    setApiKey("");
    setBaseUrl("");
    setLabel("");
    setShowForm(false);
  };

  const handleAdd = () => {
    if (!model.trim()) return;
    const providerMap: Record<FormProvider, ChatProvider> = {
      ollama: "ollama",
      openrouter: "openrouter",
      byok: "byok",
    };
    const spec: ModelSpec = {
      provider: providerMap[provider],
      model: model.trim(),
      ...(provider !== "ollama" && apiKey ? { api_key: apiKey } : {}),
      ...(provider === "byok" && baseUrl ? { base_url: baseUrl } : {}),
      ...(provider === "ollama" && baseUrl ? { base_url: baseUrl } : {}),
      label: label.trim() || `${provider} · ${model.trim()}`,
    };
    addCompareModel(spec);
    resetForm();
  };

  return (
    <div style={styles.container}>
      <div style={styles.chipRow}>
        {compareModels.map((m, i) => (
          <span key={i} style={styles.chip(m.provider)}>
            <span style={styles.dot(PROVIDER_COLORS[m.provider] ?? "#6b7280")} />
            {m.label ?? `${m.provider} · ${m.model}`}
            <span style={styles.chipX} onClick={() => removeCompareModel(i)}>
              ×
            </span>
          </span>
        ))}
        <button style={styles.addBtn} onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ Add Model"}
        </button>
      </div>

      {showForm && (
        <div style={styles.form}>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as FormProvider)}
            style={styles.select}
          >
            <option value="ollama">Ollama</option>
            <option value="openrouter">OpenRouter</option>
            <option value="byok">Custom API (BYOK)</option>
          </select>

          <input
            style={styles.input}
            placeholder="Model name (e.g. llama3, gpt-4o)"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />

          {provider !== "ollama" && (
            <input
              style={styles.input}
              type="password"
              placeholder="API Key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          )}

          {(provider === "byok" || provider === "ollama") && (
            <input
              style={styles.input}
              placeholder={
                provider === "ollama"
                  ? "Base URL (default: http://localhost:11434)"
                  : "Base URL (OpenAI-compatible endpoint)"
              }
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          )}

          <input
            style={styles.input}
            placeholder="Label (optional)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />

          {provider === "openrouter" && (
            <p style={styles.note}>
              Browse available models at{" "}
              <a
                href="https://openrouter.ai/models"
                target="_blank"
                rel="noreferrer"
                style={{ color: "#3b82f6" }}
              >
                openrouter.ai/models
              </a>
            </p>
          )}

          <button style={styles.formBtn} onClick={handleAdd}>
            Add
          </button>
        </div>
      )}
    </div>
  );
}
