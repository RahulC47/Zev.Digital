import { useState } from "react";
import { api, type Expert } from "../lib/api";
import { useStore } from "../store/useStore";

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

interface Props {
  expert?: Expert;
  onClose: () => void;
  /** Override the default save behaviour (used for the Zev default persona). */
  onSave?: (payload: Expert) => Promise<void>;
}

export function ExpertEditor({ expert, onClose, onSave: onSaveOverride }: Props) {
  const collections = useStore((s) => s.collections);
  const refreshExperts = useStore((s) => s.refreshExperts);

  const [name, setName] = useState(expert?.name ?? "");
  const [icon, setIcon] = useState(expert?.icon ?? "🤖");
  const [description, setDescription] = useState(expert?.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(expert?.system_prompt ?? "");
  const [temperature, setTemperature] = useState<string>(
    expert?.temperature != null ? String(expert.temperature) : "",
  );
  const [modelOverride, setModelOverride] = useState(expert?.model_override ?? "");
  const [collectionScope, setCollectionScope] = useState(expert?.collection_scope ?? "");
  const [saving, setSaving] = useState(false);

  const isEdit = !!expert;
  const isBuiltin = expert?.is_builtin ?? false;

  const onSave = async () => {
    if (!name.trim() || !systemPrompt.trim()) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const payload: Expert = {
        id: expert?.id ?? `expert-${Date.now().toString(36)}`,
        name: name.trim(),
        description: description.trim(),
        icon: icon || "🤖",
        system_prompt: systemPrompt.trim(),
        temperature: temperature ? parseFloat(temperature) : null,
        model_override: modelOverride.trim() || null,
        collection_scope: collectionScope || null,
        is_builtin: isBuiltin,
        created_at: expert?.created_at ?? now,
        updated_at: now,
      };
      if (onSaveOverride) {
        await onSaveOverride(payload);
      } else if (isEdit) {
        await api.updateExpert(payload);
        await refreshExperts();
      } else {
        await api.createExpert(payload);
        await refreshExperts();
      }
      onClose();
    } catch (e) {
      alert(`Failed to save: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-lg overflow-y-auto rounded-xl p-5 shadow-xl"
        style={{ background: "var(--panel)", border: "1px solid var(--border)", maxHeight: "85vh" }}
      >
        <h3 className="mb-4 text-base font-medium" style={{ color: "var(--text)" }}>
          {isEdit ? "Edit Expert" : "Create Expert"}
        </h3>

        <div className="space-y-3">
          <div className="flex gap-3">
            <label className="block" style={{ width: 70 }}>
              <span className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>Icon</span>
              <input
                style={{ ...inputStyle, textAlign: "center", fontSize: 20 }}
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                maxLength={2}
              />
            </label>
            <label className="block flex-1">
              <span className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>Name</span>
              <input
                style={inputStyle}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Legal Advisor"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>Description</span>
            <input
              style={inputStyle}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description of what this expert does"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>System prompt</span>
            <textarea
              rows={6}
              style={{ ...inputStyle, resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="You are [Name], an expert in [domain]. ..."
            />
          </label>

          <div className="flex gap-3">
            <label className="block" style={{ width: 120 }}>
              <span className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>
                Temperature
              </span>
              <input
                type="number"
                step="0.1"
                min="0"
                max="2"
                style={{ ...inputStyle, width: 120 }}
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                placeholder="default"
              />
            </label>
            <label className="block flex-1">
              <span className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>
                Model override
              </span>
              <input
                style={inputStyle}
                value={modelOverride}
                onChange={(e) => setModelOverride(e.target.value)}
                placeholder="Leave empty for default"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>
              Scope to folder
            </span>
            <select
              style={{ ...inputStyle, cursor: "pointer" }}
              value={collectionScope}
              onChange={(e) => setCollectionScope(e.target.value)}
            >
              <option value="">All folders</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={onSave}
            disabled={saving || !name.trim() || !systemPrompt.trim()}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50"
            style={{ background: "var(--accent)", border: "none", cursor: "pointer" }}
          >
            {saving ? "Saving…" : isEdit ? "Update" : "Create"}
          </button>
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm"
            style={{ color: "var(--muted)", border: "1px solid var(--border)", background: "transparent", cursor: "pointer" }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
