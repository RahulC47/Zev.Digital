import { useStore } from "../store/useStore";
import type { ChatProvider, CustomApiProfile } from "../lib/api";

export function ProviderSelector() {
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);

  if (!settings) return null;

  const currentProvider = settings.chat_provider || "ollama";
  const profiles = settings.custom_api_profiles || [];
  const activeIdx = settings.active_custom_profile_idx ?? 0;

  const handleProviderChange = async (provider: ChatProvider) => {
    const updated = { ...settings, chat_provider: provider };
    await saveSettings(updated);
  };

  const handleProfileChange = async (idx: number) => {
    const profile = profiles[idx];
    if (!profile) return;
    const updated = {
      ...settings,
      active_custom_profile_idx: idx,
      byok_base_url: profile.base_url || settings.byok_base_url,
      byok_api_key: profile.api_key || settings.byok_api_key,
      byok_chat_model: profile.model || settings.byok_chat_model,
    };
    await saveSettings(updated);
  };

  let activeModel = "";
  if (currentProvider === "ollama") {
    activeModel = settings.ollama_chat_model || "llama3.1:8b";
  } else if (currentProvider === "openrouter") {
    activeModel = settings.openrouter_model || "anthropic/claude-haiku-4.5";
  } else {
    const currentProf: CustomApiProfile | undefined = profiles[activeIdx];
    activeModel = currentProf
      ? `${currentProf.name || "Custom"} (${currentProf.model || settings.byok_chat_model})`
      : settings.byok_chat_model || "gpt-4o-mini";
  }

  return (
    <div
      className="flex flex-col gap-1.5 rounded-lg p-2 text-xs"
      style={{
        background: "var(--panel2)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
          Provider
        </span>
      </div>

      <select
        value={currentProvider}
        onChange={(e) => handleProviderChange(e.target.value as ChatProvider)}
        className="w-full rounded-md px-2 py-1 text-xs outline-none"
        style={{
          background: "var(--input-bg)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          cursor: "pointer",
        }}
      >
        <option value="ollama">Local (Ollama)</option>
        <option value="openrouter">OpenRouter</option>
        <option value="byok">Custom API (BYOK)</option>
      </select>

      {currentProvider === "byok" && profiles.length > 0 && (
        <select
          value={activeIdx}
          onChange={(e) => handleProfileChange(Number(e.target.value))}
          className="w-full rounded-md px-2 py-1 text-xs outline-none"
          style={{
            background: "var(--input-bg)",
            color: "var(--text)",
            border: "1px solid var(--accent)",
            cursor: "pointer",
          }}
        >
          {profiles.map((p, i) => (
            <option key={i} value={i}>
              {p.name || `Profile ${i + 1}`} ({p.model || "default"})
            </option>
          ))}
        </select>
      )}

      <div className="truncate text-[10px]" style={{ color: "var(--muted)" }} title={`Active model: ${activeModel}`}>
        using: <span style={{ color: "var(--text)" }}>{activeModel}</span>
      </div>
    </div>
  );
}
