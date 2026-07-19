import { useEffect, useState } from "react";
import { useStore } from "../store/useStore";
import { api, type ChatProvider, type GraphExtractionMode, type Settings as S } from "../lib/api";

const PROVIDERS: { id: ChatProvider; title: string; blurb: string }[] = [
  { id: "ollama", title: "Local (Ollama)", blurb: "Private, free, runs offline" },
  { id: "openrouter", title: "OpenRouter", blurb: "One key, hundreds of models" },
  { id: "byok", title: "Custom cloud", blurb: "Any OpenAI-compatible endpoint" },
];

const inputStyle: React.CSSProperties = {
  width: "100%",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--input-bg)",
  padding: "8px 12px",
  fontSize: 13,
  color: "var(--text)",
  outline: "none",
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>
        {label}
      </span>
      {children}
      {hint && (
        <span className="mt-1 block text-[11px]" style={{ color: "var(--muted)", opacity: 0.7 }}>
          {hint}
        </span>
      )}
    </label>
  );
}

function PasswordField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <Field label={label} hint={hint}>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          style={{ ...inputStyle, paddingRight: 60 }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px]"
          style={{ color: "var(--muted)", background: "transparent", border: "none", cursor: "pointer" }}
        >
          {show ? "hide" : "show"}
        </button>
      </div>
    </Field>
  );
}

export function Settings() {
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const health = useStore((s) => s.health);
  const refreshHealth = useStore((s) => s.refreshHealth);
  const [draft, setDraft] = useState<S | undefined>(settings);
  const [saved, setSaved] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<string[] | null>(null);
  const [modelsErr, setModelsErr] = useState<string | null>(null);
  const [denyInput, setDenyInput] = useState("");

  useEffect(() => setDraft(settings), [settings]);

  const loadModels = async () => {
    setModelsErr(null);
    try {
      setOllamaModels(await api.listOllamaModels());
    } catch (e) {
      setOllamaModels(null);
      setModelsErr(String(e));
    }
  };

  // Fetch the installed-model list whenever the Ollama provider is shown.
  const provider = draft?.chat_provider;
  useEffect(() => {
    if (provider === "ollama") loadModels();
  }, [provider]);

  if (!draft) {
    return (
      <div className="p-6 text-sm" style={{ color: "var(--muted)" }}>
        Loading settings…
      </div>
    );
  }

  const set = (patch: Partial<S>) => setDraft({ ...draft, ...patch });

  const save = async () => {
    await saveSettings(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="h-full overflow-y-auto px-5 py-4">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h2 className="text-lg font-medium" style={{ color: "var(--text)" }}>
            Settings
          </h2>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Choose where the AI chat runs. Search always uses on-device
            full-text search — no embedding model required.
          </p>
        </div>

        {/* Provider toggle */}
        <div className="flex gap-2">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => set({ chat_provider: p.id })}
              className="flex-1 rounded-lg px-4 py-3 text-left text-sm transition"
              style={{
                border: draft.chat_provider === p.id
                  ? "1.5px solid var(--accent)"
                  : "1px solid var(--border)",
                background: draft.chat_provider === p.id
                  ? "rgba(91,140,255,0.1)"
                  : "var(--panel2)",
                color: draft.chat_provider === p.id ? "var(--accent)" : "var(--text)",
                cursor: "pointer",
              }}
            >
              <div className="font-medium">{p.title}</div>
              <div className="text-[11px]" style={{ color: "var(--muted)" }}>
                {p.blurb}
              </div>
            </button>
          ))}
        </div>

        {draft.chat_provider === "ollama" ? (
          <div className="space-y-4">
            <Field label="Ollama URL" hint="Default Ollama listens on this address.">
              <input
                style={inputStyle}
                value={draft.ollama_url}
                onChange={(e) => set({ ollama_url: e.target.value })}
              />
            </Field>
            <Field
              label="Chat model"
              hint={
                modelsErr
                  ? `Couldn't list installed models (${modelsErr}) — type a model name.`
                  : ollamaModels && ollamaModels.length === 0
                  ? "No models installed yet — pull one first, then refresh."
                  : "Installed models, straight from your Ollama."
              }
            >
              <div className="flex gap-2">
                {ollamaModels && ollamaModels.length > 0 ? (
                  <select
                    style={{ ...inputStyle, cursor: "pointer" }}
                    value={draft.ollama_chat_model}
                    onChange={(e) => set({ ollama_chat_model: e.target.value })}
                  >
                    {!ollamaModels.includes(draft.ollama_chat_model) && (
                      <option value={draft.ollama_chat_model}>
                        {draft.ollama_chat_model} (not installed)
                      </option>
                    )}
                    {ollamaModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    style={inputStyle}
                    value={draft.ollama_chat_model}
                    onChange={(e) => set({ ollama_chat_model: e.target.value })}
                  />
                )}
                <button
                  type="button"
                  onClick={loadModels}
                  title="Refresh installed models"
                  className="shrink-0 rounded-lg px-3 text-sm"
                  style={{ border: "1px solid var(--border)", background: "var(--panel2)", color: "var(--text)", cursor: "pointer" }}
                >
                  ↻
                </button>
              </div>
            </Field>
            <div
              className="rounded-lg p-3 text-[11px]"
              style={{ background: "var(--panel2)", border: "1px solid var(--border)", color: "var(--muted)" }}
            >
              Don't have Ollama?{" "}
              <span style={{ color: "var(--text)" }}>
                Install from ollama.com, then:
              </span>
              <pre
                className="mt-1 overflow-x-auto rounded p-2"
                style={{ background: "var(--bg)", color: "var(--muted)" }}
              >
                ollama pull {draft.ollama_chat_model}
              </pre>
            </div>
          </div>
        ) : draft.chat_provider === "openrouter" ? (
          <div className="space-y-4">
            <PasswordField
              label="OpenRouter API key"
              hint="Stored locally on this device only. Get one at openrouter.ai/keys."
              value={draft.openrouter_api_key}
              onChange={(v) => set({ openrouter_api_key: v })}
            />
            <Field
              label="Model"
              hint="Any OpenRouter model id, e.g. anthropic/claude-haiku-4.5 · openai/gpt-4o-mini · meta-llama/llama-3.1-70b-instruct"
            >
              <input
                style={inputStyle}
                value={draft.openrouter_model}
                onChange={(e) => set({ openrouter_model: e.target.value })}
              />
            </Field>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Named Custom API Profiles */}
            <div
              className="rounded-lg p-3 text-xs"
              style={{ background: "var(--panel2)", border: "1px solid var(--border)" }}
            >
              <div className="mb-2 flex items-center justify-between font-medium" style={{ color: "var(--text)" }}>
                <span>Saved Custom Profiles (BYOK)</span>
                <button
                  type="button"
                  onClick={() => {
                    const profName = prompt("Profile name (e.g. DeepSeek, Groq, Together):");
                    if (!profName) return;
                    const newProf = {
                      name: profName,
                      base_url: draft.byok_base_url,
                      api_key: draft.byok_api_key,
                      model: draft.byok_chat_model,
                    };
                    const profiles = [...(draft.custom_api_profiles || []), newProf];
                    const idx = profiles.length - 1;
                    set({
                      custom_api_profiles: profiles,
                      active_custom_profile_idx: idx,
                    });
                  }}
                  className="rounded px-2 py-1 text-[11px] font-medium"
                  style={{
                    background: "var(--accent)",
                    color: "#fff",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  + Save current as profile
                </button>
              </div>

              {(draft.custom_api_profiles || []).length === 0 ? (
                <p className="text-[11px]" style={{ color: "var(--muted)" }}>
                  No saved profiles yet. Configure the endpoint below and click "Save current as profile".
                </p>
              ) : (
                <div className="space-y-1.5">
                  {(draft.custom_api_profiles || []).map((prof, i) => {
                    const isActive = draft.active_custom_profile_idx === i;
                    return (
                      <div
                        key={i}
                        className="flex items-center justify-between rounded px-2.5 py-1.5 transition"
                        style={{
                          background: isActive ? "rgba(91,140,255,0.12)" : "var(--bg)",
                          border: `1px solid ${isActive ? "var(--accent)" : "var(--border)"}`,
                        }}
                      >
                        <div className="min-w-0 flex-1">
                          <span className="font-medium" style={{ color: isActive ? "var(--accent)" : "var(--text)" }}>
                            {prof.name}
                          </span>
                          <span className="ml-2 text-[11px]" style={{ color: "var(--muted)" }}>
                            ({prof.model || "no model"})
                          </span>
                        </div>
                        <div className="flex gap-2 text-[11px]">
                          {!isActive && (
                            <button
                              type="button"
                              onClick={() => {
                                set({
                                  active_custom_profile_idx: i,
                                  byok_base_url: prof.base_url,
                                  byok_api_key: prof.api_key,
                                  byok_chat_model: prof.model,
                                });
                              }}
                              style={{ color: "var(--accent)", background: "transparent", border: "none", cursor: "pointer" }}
                            >
                              Use
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              const updated = (draft.custom_api_profiles || []).filter((_, idx) => idx !== i);
                              set({
                                custom_api_profiles: updated,
                                active_custom_profile_idx: Math.max(0, (draft.active_custom_profile_idx || 0) - 1),
                              });
                            }}
                            style={{ color: "var(--danger)", background: "transparent", border: "none", cursor: "pointer" }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <Field
              label="API base URL"
              hint="OpenAI-compatible endpoint. DeepSeek: https://api.deepseek.com/v1 · OpenRouter: https://openrouter.ai/api/v1"
            >
              <input
                style={inputStyle}
                value={draft.byok_base_url}
                onChange={(e) => set({ byok_base_url: e.target.value })}
              />
            </Field>
            <PasswordField
              label="API key"
              hint="Stored locally on this device only."
              value={draft.byok_api_key}
              onChange={(v) => set({ byok_api_key: v })}
            />
            <Field label="Chat model">
              <input
                style={inputStyle}
                value={draft.byok_chat_model}
                onChange={(e) => set({ byok_chat_model: e.target.value })}
              />
            </Field>
          </div>
        )}

        {/* Knowledge Graph Extraction Mode */}
        <div>
          <h3 className="mb-1 text-sm font-medium" style={{ color: "var(--text)" }}>
            Knowledge Graph Extraction
          </h3>
          <p className="mb-3 text-[11px]" style={{ color: "var(--muted)" }}>
            Controls how captured text is processed into the knowledge graph for
            richer, entity-aware search.
          </p>
          <div className="flex gap-2">
            {(["local", "cloud"] as GraphExtractionMode[]).map((m) => (
              <button
                key={m}
                onClick={() => set({ graph_extraction_mode: m })}
                className="flex-1 rounded-lg px-4 py-3 text-left text-sm transition"
                style={{
                  border: draft.graph_extraction_mode === m
                    ? "1.5px solid var(--accent)"
                    : "1px solid var(--border)",
                  background: draft.graph_extraction_mode === m
                    ? "rgba(91,140,255,0.1)"
                    : "var(--panel2)",
                  color: draft.graph_extraction_mode === m ? "var(--accent)" : "var(--text)",
                  cursor: "pointer",
                }}
              >
                <div className="font-medium">
                  {m === "local" ? "Local NLP" : "Cloud LLM"}
                </div>
                <div className="text-[11px]" style={{ color: "var(--muted)" }}>
                  {m === "local"
                    ? "spaCy + fastembed — private, no API key"
                    : "Uses your chat provider — richer extraction"}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Capture */}
        <div>
          <h3 className="mb-1 text-sm font-medium" style={{ color: "var(--text)" }}>
            Capture
          </h3>
          <p className="mb-3 text-[11px]" style={{ color: "var(--muted)" }}>
            The background loop notices window switches within a couple of
            seconds; this interval controls how often an unchanged window is
            re-read for new content.
          </p>

          <div className="space-y-4">
            <Field
              label="Re-capture interval (seconds)"
              hint="Minimum 2. Lower = fresher memory, slightly more CPU."
            >
              <input
                type="number"
                min={2}
                style={{ ...inputStyle, width: 120 }}
                value={draft.capture_interval_secs}
                onChange={(e) =>
                  set({ capture_interval_secs: Math.max(2, Number(e.target.value) || 2) })
                }
              />
            </Field>

            <div>
              <span className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>
                Do-not-capture list
              </span>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {draft.denylist.map((d) => (
                  <span
                    key={d}
                    className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs"
                    style={{ background: "var(--panel2)", border: "1px solid var(--border)", color: "var(--text)" }}
                  >
                    {d}
                    <button
                      type="button"
                      onClick={() => set({ denylist: draft.denylist.filter((x) => x !== d) })}
                      title={`Allow capturing ${d} again`}
                      style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--muted)", lineHeight: 1, padding: 0 }}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {draft.denylist.length === 0 && (
                  <span className="text-[11px]" style={{ color: "var(--muted)", opacity: 0.7 }}>
                    Empty — every app can be captured.
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  style={{ ...inputStyle, flex: 1 }}
                  placeholder="App name, e.g. whatsapp"
                  value={denyInput}
                  onChange={(e) => setDenyInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const v = denyInput.trim().toLowerCase();
                      if (v && !draft.denylist.includes(v)) {
                        set({ denylist: [...draft.denylist, v] });
                      }
                      setDenyInput("");
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    const v = denyInput.trim().toLowerCase();
                    if (v && !draft.denylist.includes(v)) {
                      set({ denylist: [...draft.denylist, v] });
                    }
                    setDenyInput("");
                  }}
                  className="rounded-lg px-3 py-1.5 text-xs"
                  style={{ color: "var(--text)", border: "1px solid var(--border)", background: "var(--panel2)", cursor: "pointer" }}
                >
                  Add
                </button>
              </div>
              <span className="mt-1 block text-[11px]" style={{ color: "var(--muted)", opacity: 0.7 }}>
                Matches the app's process name (substring, case-insensitive).
                Password managers are blocked by default.
              </span>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm" style={{ color: "var(--text)" }}>
              <input
                type="checkbox"
                checked={draft.skip_private_browsing}
                onChange={(e) => set({ skip_private_browsing: e.target.checked })}
                style={{ accentColor: "var(--accent)", cursor: "pointer" }}
              />
              Skip private browsing windows
              <span className="text-[11px]" style={{ color: "var(--muted)" }}>
                Incognito / InPrivate windows are never captured.
              </span>
            </label>
          </div>
        </div>

        {/* Langfuse Observability (opt-in) */}
        <div>
          <h3 className="mb-1 text-sm font-medium" style={{ color: "var(--text)" }}>
            Observability — Langfuse Export
          </h3>
          <p className="mb-3 text-[11px]" style={{ color: "var(--muted)" }}>
            Optionally export LLM traces to your Langfuse instance for
            advanced analytics. Off by default — traces stay on this device.
          </p>

          <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm" style={{ color: "var(--text)" }}>
            <input
              type="checkbox"
              checked={draft.langfuse_enabled}
              onChange={(e) => set({ langfuse_enabled: e.target.checked })}
              style={{ accentColor: "var(--accent)", cursor: "pointer" }}
            />
            Export traces to Langfuse Cloud
          </label>

          {draft.langfuse_enabled && (
            <>
              <div
                className="mb-3 rounded-lg p-3 text-[11px]"
                style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)", color: "#f59e0b" }}
              >
                ⚠ When enabled, LLM call traces (prompts, responses, token
                counts) will be sent to your Langfuse instance. This data
                leaves your device.
              </div>
              <div className="space-y-3">
                <Field label="Langfuse Host" hint="Default: https://cloud.langfuse.com">
                  <input
                    style={inputStyle}
                    value={draft.langfuse_host}
                    onChange={(e) => set({ langfuse_host: e.target.value })}
                  />
                </Field>
                <PasswordField
                  label="Public Key"
                  value={draft.langfuse_public_key}
                  onChange={(v) => set({ langfuse_public_key: v })}
                />
                <PasswordField
                  label="Secret Key"
                  value={draft.langfuse_secret_key}
                  onChange={(v) => set({ langfuse_secret_key: v })}
                />
              </div>
            </>
          )}
        </div>

        <div
          className="flex items-center gap-3 pt-4"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <button
            onClick={save}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white"
            style={{ background: "var(--accent)", border: "none", cursor: "pointer" }}
          >
            Save
          </button>
          <button
            onClick={refreshHealth}
            className="rounded-lg px-4 py-2 text-sm"
            style={{ color: "var(--text)", border: "1px solid var(--border)", background: "transparent", cursor: "pointer" }}
          >
            Test connection
          </button>
          {saved && <span className="text-xs" style={{ color: "var(--ok)" }}>Saved ✓</span>}
          {health && (
            <span
              className="text-xs"
              style={{ color: health.ok ? "var(--ok)" : "#f59e0b" }}
            >
              {health.message}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
