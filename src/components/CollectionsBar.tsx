import { useEffect, useRef, useState } from "react";
import { useStore } from "../store/useStore";
import { api, type Collection } from "../lib/api";
import { save } from "@tauri-apps/plugin-dialog";

type ExportKind = { label: string; fn: () => Promise<string>; ext: string };

/**
 * Folder management bar shown above the Memory tabs.
 * - Folder chips scope the view / query / export (none selected = All).
 * - The active folder (capture target) is marked and switchable.
 */
export function CollectionsBar() {
  const collections = useStore((s) => s.collections);
  const selected = useStore((s) => s.selectedCollections);
  const setSelected = useStore((s) => s.setSelectedCollections);
  const activeId = useStore((s) => s.activeCollectionId);
  const setActive = useStore((s) => s.setActiveCollection);
  const refreshCollections = useStore((s) => s.refreshCollections);
  const createCollection = useStore((s) => s.createCollection);
  const renameCollection = useStore((s) => s.renameCollection);
  const deleteCollection = useStore((s) => s.deleteCollection);

  const [exportOpen, setExportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [instrOpen, setInstrOpen] = useState<string | null>(null);
  const [instrDraft, setInstrDraft] = useState("");
  const [instrSaving, setInstrSaving] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const instrRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    refreshCollections();
  }, [refreshCollections]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
      if (instrRef.current && !instrRef.current.contains(e.target as Node)) {
        setInstrOpen(null);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const openInstructions = (c: Collection) => {
    setInstrOpen(c.id);
    setInstrDraft(c.instructions);
  };

  const saveInstructions = async () => {
    if (!instrOpen) return;
    setInstrSaving(true);
    try {
      await api.setCollectionInstructions(instrOpen, instrDraft);
      await refreshCollections();
      setInstrOpen(null);
    } catch (e) {
      alert(`Failed: ${e}`);
    } finally {
      setInstrSaving(false);
    }
  };

  const toggle = (id: string) => {
    setSelected(
      selected.includes(id) ? selected.filter((c) => c !== id) : [...selected, id],
    );
  };

  const onNew = async () => {
    const name = prompt("New folder name");
    if (name?.trim()) await createCollection(name.trim());
  };
  const onRename = async (id: string, current: string) => {
    const name = prompt("Rename folder", current);
    if (name?.trim()) await renameCollection(id, name.trim());
  };
  const onDelete = async (id: string, name: string) => {
    if (
      confirm(
        `Delete folder "${name}"? Its captures move to General (nothing is lost).`,
      )
    )
      await deleteCollection(id);
  };

  const runExport = async (kind: ExportKind) => {
    setExportOpen(false);
    setBusy(true);
    try {
      const content = await kind.fn();
      const path = await save({
        defaultPath: `zev-export.${kind.ext}`,
        filters: [{ name: kind.ext.toUpperCase(), extensions: [kind.ext] }],
      });
      if (path) await api.saveTextFile(path, content);
    } catch (e) {
      alert(`Export failed: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  const scope = selected.length ? selected : undefined;
  const exports: ExportKind[] = [
    { label: "Vault (Markdown)", fn: () => api.exportVaultMarkdown(scope), ext: "md" },
    { label: "Vault (JSON)", fn: () => api.exportVaultJson(scope), ext: "json" },
    { label: "Graph (Markdown)", fn: () => api.exportGraph("md", scope), ext: "md" },
    { label: "Graph (JSON)", fn: () => api.exportGraph("json", scope), ext: "json" },
    { label: "Graph (Cypher)", fn: () => api.exportGraph("cypher", scope), ext: "cypher" },
  ];

  const allActive = selected.length === 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* "All" chip */}
      <button
        onClick={() => setSelected([])}
        className="rounded-full px-3 py-1 text-xs font-medium transition"
        style={{
          border: `1px solid ${allActive ? "var(--accent)" : "var(--border)"}`,
          background: allActive ? "rgba(91,140,255,0.12)" : "var(--panel2)",
          color: allActive ? "var(--accent)" : "var(--muted)",
          cursor: "pointer",
        }}
      >
        All
      </button>

      {collections.map((c) => {
        const on = selected.includes(c.id);
        const isActive = c.id === activeId;
        return (
          <div
            key={c.id}
            className="group flex items-center gap-1 rounded-full pl-3 pr-1.5 py-1 text-xs transition"
            style={{
              border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
              background: on ? "rgba(91,140,255,0.12)" : "var(--panel2)",
              color: on ? "var(--accent)" : "var(--text)",
            }}
          >
            <button
              onClick={() => toggle(c.id)}
              title={isActive ? "Capture target folder" : "Click to scope view/query to this folder"}
              style={{ background: "transparent", border: "none", color: "inherit", cursor: "pointer" }}
            >
              {isActive && <span style={{ color: "var(--ok)" }}>● </span>}
              {c.name}
              <span style={{ color: "var(--muted)", marginLeft: 4 }}>{c.source_count}</span>
            </button>
            {c.instructions && (
              <span className="text-[9px]" style={{ color: "var(--ok)" }} title="Has project instructions">●</span>
            )}
            {/* per-chip actions */}
            <span className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
              <button
                title="Project instructions"
                onClick={() => openInstructions(c)}
                style={{ ...chipBtn, color: c.instructions ? "var(--ok)" : "var(--muted)" }}
              >
                📋
              </button>
              {!isActive && (
                <button
                  title="New captures go here"
                  onClick={() => setActive(c.id)}
                  style={chipBtn}
                >
                  ◎
                </button>
              )}
              <button title="Rename" onClick={() => onRename(c.id, c.name)} style={chipBtn}>
                ✎
              </button>
              {c.id !== "general" && (
                <button
                  title="Delete"
                  onClick={() => onDelete(c.id, c.name)}
                  style={{ ...chipBtn, color: "var(--danger)" }}
                >
                  ✕
                </button>
              )}
            </span>
          </div>
        );
      })}

      <button
        onClick={onNew}
        className="rounded-full px-3 py-1 text-xs"
        style={{ border: "1px dashed var(--border)", background: "transparent", color: "var(--muted)", cursor: "pointer" }}
      >
        + Folder
      </button>

      {/* Instructions popover */}
      {instrOpen && (
        <div
          ref={instrRef}
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setInstrOpen(null); }}
        >
          <div
            className="w-full max-w-md rounded-xl p-4 shadow-xl"
            style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
          >
            <h3 className="mb-1 text-sm font-medium" style={{ color: "var(--text)" }}>
              Project Instructions
            </h3>
            <p className="mb-3 text-[11px]" style={{ color: "var(--muted)" }}>
              These instructions are prepended to the system prompt when chatting
              within this folder — like project-scoped context.
            </p>
            <textarea
              rows={6}
              value={instrDraft}
              onChange={(e) => setInstrDraft(e.target.value)}
              placeholder="e.g. This project is about our Q4 marketing campaign. Focus on ROI metrics and India-market specifics."
              className="w-full rounded-lg p-3 text-xs outline-none"
              style={{
                background: "var(--input-bg)",
                border: "1px solid var(--border)",
                color: "var(--text)",
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={saveInstructions}
                disabled={instrSaving}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-white"
                style={{ background: "var(--accent)", border: "none", cursor: "pointer" }}
              >
                {instrSaving ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => setInstrOpen(null)}
                className="rounded-lg px-3 py-1.5 text-xs"
                style={{ color: "var(--muted)", border: "1px solid var(--border)", background: "transparent", cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export menu */}
      <div ref={menuRef} className="relative ml-auto">
        <button
          onClick={() => setExportOpen((o) => !o)}
          disabled={busy}
          className="rounded-lg px-3 py-1.5 text-xs"
          style={{ border: "1px solid var(--border)", background: "var(--panel2)", color: "var(--text)", cursor: "pointer" }}
        >
          {busy ? "Exporting…" : "Export ▾"}
        </button>
        {exportOpen && (
          <div
            className="absolute right-0 z-50 mt-1 w-44 overflow-hidden rounded-lg py-1 shadow-lg"
            style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
          >
            <div className="px-3 py-1 text-[10px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              {allActive ? "All folders" : `${selected.length} selected`}
            </div>
            {exports.map((k) => (
              <button
                key={k.label}
                onClick={() => runExport(k)}
                className="block w-full px-3 py-1.5 text-left text-xs transition"
                style={{ background: "transparent", border: "none", color: "var(--text)", cursor: "pointer" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                {k.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const chipBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--muted)",
  cursor: "pointer",
  fontSize: 11,
  padding: "0 3px",
  lineHeight: 1,
};
