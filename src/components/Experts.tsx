import { useState } from "react";
import { useStore } from "../store/useStore";
import { api, type Expert } from "../lib/api";
import { ExpertEditor } from "./ExpertEditor";

const ZEV_DEFAULT_ID = "zev-default";

/** Synthetic Expert representing the default Zev persona — not stored in DB. */
function makeDefaultExpert(systemPrompt: string): Expert {
  return {
    id: ZEV_DEFAULT_ID,
    name: "Zev (default)",
    description: "General-purpose assistant. Uses your captured context to answer questions.",
    icon: "🧠",
    system_prompt: systemPrompt,
    temperature: null,
    model_override: null,
    collection_scope: null,
    is_builtin: true,
    created_at: "",
    updated_at: "",
  };
}

export function Experts() {
  const experts = useStore((s) => s.experts);
  const refreshExperts = useStore((s) => s.refreshExperts);
  const setView = useStore((s) => s.setView);
  const setActiveExpert = useStore((s) => s.setActiveExpert);
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);

  const [editing, setEditing] = useState<Expert | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingDefault, setEditingDefault] = useState(false);

  const builtins = experts.filter((e) => e.is_builtin);
  const custom = experts.filter((e) => !e.is_builtin);

  const onSelect = (expert: Expert) => {
    setActiveExpert(expert.id);
    setView("chat");
  };

  const onSelectDefault = () => {
    setActiveExpert(null);
    setView("chat");
  };

  const onDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      await api.deleteExpert(id);
      await refreshExperts();
    } catch (e) {
      alert(`Failed: ${e}`);
    }
  };

  const onSaveDefault = async (payload: Expert) => {
    if (!settings) return;
    await saveSettings({ ...settings, default_system_prompt: payload.system_prompt });
    setEditingDefault(false);
  };

  const defaultExpert = makeDefaultExpert(settings?.default_system_prompt ?? "");

  return (
    <div className="h-full overflow-y-auto px-5 py-4">
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium" style={{ color: "var(--text)" }}>
              Expert Library
            </h2>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              Pick an expert persona or create your own. Each expert has a custom
              system prompt, tuned for specific tasks.
            </p>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="shrink-0 rounded-lg px-4 py-2 text-sm font-medium text-white"
            style={{ background: "var(--accent)", border: "none", cursor: "pointer" }}
          >
            + Create Expert
          </button>
        </div>

        {/* ── Default Zev persona card ─────────────────────────────── */}
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          Default
        </h3>
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <ExpertCard
            expert={defaultExpert}
            onSelect={onSelectDefault}
            onEdit={() => setEditingDefault(true)}
            isDefault
          />
        </div>

        {custom.length > 0 && (
          <>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              Your Experts
            </h3>
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {custom.map((e) => (
                <ExpertCard
                  key={e.id}
                  expert={e}
                  onSelect={() => onSelect(e)}
                  onEdit={() => setEditing(e)}
                  onDelete={() => onDelete(e.id, e.name)}
                />
              ))}
            </div>
          </>
        )}

        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          Built-in Experts
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {builtins.map((e) => (
            <ExpertCard
              key={e.id}
              expert={e}
              onSelect={() => onSelect(e)}
              onEdit={() => setEditing(e)}
            />
          ))}
        </div>
      </div>

      {/* Zev default editor */}
      {editingDefault && (
        <ExpertEditor
          expert={defaultExpert}
          onClose={() => setEditingDefault(false)}
          onSave={onSaveDefault}
        />
      )}

      {/* Regular expert create/edit */}
      {(creating || editing) && (
        <ExpertEditor
          expert={editing ?? undefined}
          onClose={() => { setEditing(null); setCreating(false); }}
        />
      )}
    </div>
  );
}

function ExpertCard({
  expert,
  onSelect,
  onEdit,
  onDelete,
  isDefault,
}: {
  expert: Expert;
  onSelect: () => void;
  onEdit: () => void;
  onDelete?: () => void;
  isDefault?: boolean;
}) {
  return (
    <div
      className="group relative flex cursor-pointer flex-col rounded-xl p-4 transition"
      style={{ background: "var(--panel2)", border: `1px solid ${isDefault ? "var(--accent)" : "var(--border)"}` }}
      onClick={onSelect}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = isDefault ? "var(--accent)" : "var(--border)")}
    >
      <div className="mb-2 text-2xl">{expert.icon}</div>
      <div className="mb-1 text-sm font-medium" style={{ color: "var(--text)" }}>
        {expert.name}
      </div>
      <div className="line-clamp-2 flex-1 text-xs" style={{ color: "var(--muted)" }}>
        {expert.description}
      </div>
      {isDefault && (
        <div className="mt-2 text-[10px]" style={{ color: "var(--accent)" }}>
          {expert.system_prompt
            ? "Custom persona active"
            : "Edit to customise the Zev persona"}
        </div>
      )}
      {!isDefault && (
        <div className="mt-2 flex items-center gap-1 text-[10px]" style={{ color: "var(--muted)" }}>
          {expert.temperature != null && <span>t={expert.temperature}</span>}
          {expert.model_override && <span>· {expert.model_override}</span>}
        </div>
      )}

      {/* Hover actions */}
      <div
        className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onEdit}
          title="Edit"
          className="rounded px-1.5 py-0.5 text-[11px]"
          style={{ background: "var(--panel)", border: "1px solid var(--border)", color: "var(--muted)", cursor: "pointer" }}
        >
          ✎
        </button>
        {onDelete && (
          <button
            onClick={onDelete}
            title="Delete"
            className="rounded px-1.5 py-0.5 text-[11px]"
            style={{ background: "var(--panel)", border: "1px solid var(--border)", color: "var(--danger)", cursor: "pointer" }}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
