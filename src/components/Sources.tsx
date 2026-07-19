import { useEffect, useState } from "react";
import { useStore } from "../store/useStore";
import { api, type ChunkRow, type Source } from "../lib/api";
import { GraphView } from "./GraphView";
import { CollectionsBar } from "./CollectionsBar";

type Tab = "list" | "graph";

function SourceRow({
  s,
  selected,
  onToggle,
}: {
  s: Source;
  selected: boolean;
  onToggle: () => void;
}) {
  const deleteSource = useStore((st) => st.deleteSource);
  const collections = useStore((st) => st.collections);
  const moveSource = useStore((st) => st.moveSource);
  const refreshSources = useStore((st) => st.refreshSources);
  const updateSourceContent = useStore((st) => st.updateSourceContent);
  const renameSource = useStore((st) => st.renameSource);

  const [open, setOpen] = useState(false);
  const [chunks, setChunks] = useState<ChunkRow[] | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [fullText, setFullText] = useState<string | null>(null);
  const [fullLoading, setFullLoading] = useState(false);

  // Title rename state
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleText, setTitleText] = useState(s.window_title || "Untitled window");
  const [savingTitle, setSavingTitle] = useState(false);

  // Content edit state
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);

  const loadChunks = async () => setChunks(await api.listChunks(s.id));

  const toggleChunk = (rowid: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(rowid)) next.delete(rowid);
      else next.add(rowid);
      return next;
    });
  };

  const toggleFullText = async () => {
    if (fullText !== null) {
      setFullText(null);
      setEditing(false);
      return;
    }
    setFullLoading(true);
    try {
      const text = await api.readSourceText(s.id);
      setFullText(text);
      setEditText(text);
    } catch (e) {
      setFullText(`Couldn't load full text: ${e}`);
    } finally {
      setFullLoading(false);
    }
  };

  const startEdit = async () => {
    if (fullText === null) {
      setFullLoading(true);
      try {
        const text = await api.readSourceText(s.id);
        setFullText(text);
        setEditText(text);
      } catch (e) {
        setFullText(`Couldn't load full text: ${e}`);
        return;
      } finally {
        setFullLoading(false);
      }
    }
    setEditing(true);
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      await updateSourceContent(s.id, editText);
      setFullText(editText);
      setEditing(false);
    } catch (e) {
      alert(`Save failed: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    setEditText(fullText ?? "");
    setEditing(false);
  };

  const saveTitle = async (newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed || trimmed === s.window_title) {
      setIsEditingTitle(false);
      setTitleText(s.window_title || "Untitled window");
      return;
    }
    setSavingTitle(true);
    try {
      await renameSource(s.id, trimmed);
      setTitleText(trimmed);
    } catch (e) {
      alert(`Rename failed: ${e}`);
      setTitleText(s.window_title || "Untitled window");
    } finally {
      setSavingTitle(false);
      setIsEditingTitle(false);
    }
  };

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && chunks === null) await loadChunks();
  };

  const removeChunk = async (rowid: number) => {
    await api.deleteChunk(rowid);
    await loadChunks();
    await refreshSources();
  };

  return (
    <li
      className="rounded-lg"
      style={{ background: "var(--panel2)", border: "1px solid var(--border)" }}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          style={{ accentColor: "var(--accent)", cursor: "pointer", flexShrink: 0 }}
          title="Select for bulk action"
        />
        <button
          onClick={toggle}
          className="shrink-0 text-xs"
          style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", width: 14 }}
          title={open ? "Collapse" : "Show chunks"}
        >
          {open ? "▾" : "▸"}
        </button>
        <div className="min-w-0 flex-1">
          {isEditingTitle ? (
            <input
              autoFocus
              value={titleText}
              onChange={(e) => setTitleText(e.target.value)}
              onBlur={() => saveTitle(titleText)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveTitle(titleText);
                if (e.key === "Escape") {
                  setTitleText(s.window_title || "Untitled window");
                  setIsEditingTitle(false);
                }
              }}
              className="w-full rounded px-1 text-sm font-medium outline-none"
              style={{
                background: "var(--input-bg)",
                color: "var(--text)",
                border: "1px solid var(--accent)",
              }}
              disabled={savingTitle}
            />
          ) : (
            <div className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>
              {s.window_title || "Untitled window"}
            </div>
          )}
          <div className="truncate text-xs" style={{ color: "var(--muted)" }}>
            {s.app} · {new Date(s.captured_at).toLocaleString()} ·{" "}
            {s.char_count.toLocaleString()} chars · {s.chunk_count} chunks
          </div>
          {s.url && (
            <div className="truncate text-[11px]" style={{ color: "var(--accent)" }} title={s.url}>
              {s.url}
            </div>
          )}
        </div>
        {/* move to folder */}
        <select
          value={s.collection_id}
          onChange={(e) => moveSource(s.id, e.target.value)}
          title="Move to folder"
          className="shrink-0 rounded-md px-2 py-1 text-xs"
          style={{ background: "var(--input-bg)", color: "var(--text)", border: "1px solid var(--border)", cursor: "pointer" }}
        >
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            if (isEditingTitle) {
              saveTitle(titleText);
            } else {
              setTitleText(s.window_title || "Untitled window");
              setIsEditingTitle(true);
            }
          }}
          className="shrink-0 rounded-md px-2 py-1 text-xs"
          style={{
            color: isEditingTitle ? "var(--accent)" : "var(--muted)",
            background: "transparent",
            border: "1px solid var(--border)",
            cursor: "pointer",
          }}
          title="Rename window title"
        >
          {isEditingTitle ? "Save" : "Rename"}
        </button>
        <button
          onClick={startEdit}
          className="shrink-0 rounded-md px-2 py-1 text-xs"
          style={{
            color: editing ? "var(--accent)" : "var(--muted)",
            background: "transparent",
            border: "1px solid var(--border)",
            cursor: "pointer",
          }}
          title="Edit captured content"
        >
          Edit
        </button>
        <button
          onClick={toggleFullText}
          className="shrink-0 rounded-md px-2 py-1 text-xs"
          style={{
            color: fullText !== null && !editing ? "var(--accent)" : "var(--muted)",
            background: "transparent",
            border: "1px solid var(--border)",
            cursor: "pointer",
          }}
          title="Show everything captured from this source"
        >
          {fullLoading ? "…" : fullText !== null && !editing ? "Hide text" : "Full text"}
        </button>
        <button
          onClick={() => deleteSource(s.id)}
          className="shrink-0 rounded-md px-2 py-1 text-xs transition"
          style={{ color: "var(--muted)", background: "transparent", border: "none", cursor: "pointer" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--danger)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}
        >
          Delete
        </button>
      </div>

      {/* Edit mode */}
      {editing && fullText !== null && (
        <div className="px-4 pb-3" style={{ borderTop: "1px solid var(--border)" }}>
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="mt-2 w-full rounded-md p-3 text-xs outline-none"
            style={{
              background: "var(--bg)",
              color: "var(--text)",
              border: "1px solid var(--accent)",
              minHeight: 200,
              maxHeight: 500,
              resize: "vertical",
              fontFamily: "inherit",
            }}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={saveEdit}
              disabled={saving || editText === fullText}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-white"
              style={{
                background: saving || editText === fullText ? "var(--muted)" : "var(--accent)",
                border: "none",
                cursor: saving || editText === fullText ? "not-allowed" : "pointer",
              }}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button
              onClick={cancelEdit}
              className="rounded-md px-3 py-1.5 text-xs"
              style={{ color: "var(--muted)", background: "transparent", border: "1px solid var(--border)", cursor: "pointer" }}
            >
              Cancel
            </button>
            <span className="text-[10px]" style={{ color: "var(--muted)" }}>
              {editText.length.toLocaleString()} chars
              {editText !== fullText && " (modified)"}
            </span>
          </div>
        </div>
      )}

      {/* Full text view (read-only) */}
      {fullText !== null && !editing && (
        <div className="px-4 pb-3" style={{ borderTop: "1px solid var(--border)" }}>
          <pre
            className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded-md p-3 text-xs"
            style={{ background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)" }}
          >
            {fullText}
          </pre>
        </div>
      )}

      {open && (
        <div className="px-4 pb-3" style={{ borderTop: "1px solid var(--border)" }}>
          {chunks === null ? (
            <div className="py-2 text-xs" style={{ color: "var(--muted)" }}>Loading…</div>
          ) : chunks.length === 0 ? (
            <div className="py-2 text-xs" style={{ color: "var(--muted)" }}>No chunks left.</div>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {chunks.map((c) => (
                <li
                  key={c.rowid}
                  className="flex items-start gap-2 rounded-md px-2 py-1.5 text-xs"
                  style={{ background: "var(--bg)", color: "var(--muted)" }}
                >
                  <span
                    className="min-w-0 flex-1 whitespace-pre-wrap break-words"
                    onClick={() => toggleChunk(c.rowid)}
                    style={{ cursor: c.text.length > 280 ? "pointer" : "default" }}
                    title={
                      c.text.length > 280
                        ? expanded.has(c.rowid)
                          ? "Click to collapse"
                          : "Click to show the full chunk"
                        : undefined
                    }
                  >
                    {expanded.has(c.rowid) || c.text.length <= 280
                      ? c.text
                      : c.text.slice(0, 280) + "…"}
                  </span>
                  <button
                    onClick={() => removeChunk(c.rowid)}
                    title="Delete this chunk"
                    className="shrink-0"
                    style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer" }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "var(--danger)")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[10px]" style={{ color: "var(--muted)", opacity: 0.7 }}>
            Deleting a chunk removes it from keyword search. Graph facts are a
            separate store — delete the whole source or a graph node to remove those.
          </p>
        </div>
      )}
    </li>
  );
}

export function Sources() {
  const sources = useStore((s) => s.sources);
  const refreshSources = useStore((s) => s.refreshSources);
  const graphData = useStore((s) => s.graphData);
  const graphLoading = useStore((s) => s.graphLoading);
  const refreshGraph = useStore((s) => s.refreshGraph);
  const selected = useStore((s) => s.selectedCollections);
  const refreshCollections = useStore((s) => s.refreshCollections);
  const collections = useStore((s) => s.collections);
  const moveSource = useStore((s) => s.moveSource);

  const [tab, setTab] = useState<Tab>("list");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState("");
  const [bulkMoving, setBulkMoving] = useState(false);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const bulkMove = async () => {
    if (!bulkTarget || selectedIds.size === 0) return;
    setBulkMoving(true);
    try {
      for (const id of selectedIds) {
        await moveSource(id, bulkTarget);
      }
      clearSelection();
    } finally {
      setBulkMoving(false);
    }
  };

  // Client-side scope of the list by selected collections (empty = all).
  const shown =
    selected.length === 0
      ? sources
      : sources.filter((s) => selected.includes(s.collection_id));
  const totalChars = shown.reduce((a, s) => a + s.char_count, 0);

  useEffect(() => {
    refreshSources();
    refreshCollections();
  }, [refreshSources, refreshCollections]);

  useEffect(() => {
    if (tab === "graph") refreshGraph();
  }, [tab, refreshGraph, selected.join(","), sources.length]);


  const clearAll = async () => {
    if (!confirm("Delete the entire memory vault? This cannot be undone.")) return;
    await api.clearVault();
    await refreshSources();
  };

  const activeFolder = selected.length === 1
    ? collections.find((c) => c.id === selected[0])
    : null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-4 pb-3">
        <div className="mx-auto max-w-3xl">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <h2 className="text-lg font-medium" style={{ color: "var(--text)" }}>
                Memory vault
              </h2>
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                {shown.length} source{shown.length === 1 ? "" : "s"} ·{" "}
                {totalChars.toLocaleString()} characters
                {activeFolder
                  ? ` in ${activeFolder.name}`
                  : selected.length > 1
                  ? " (selected folders)"
                  : " on this device"}.
              </p>
            </div>
            {sources.length > 0 && tab === "list" && (
              <button
                onClick={clearAll}
                className="rounded-lg px-3 py-1.5 text-xs"
                style={{ color: "var(--danger)", border: "1px solid var(--border)", background: "transparent", cursor: "pointer" }}
              >
                Clear all
              </button>
            )}
          </div>

          {/* List / Graph toggle */}
          <div
            className="mb-3 inline-flex rounded-lg p-0.5"
            style={{ background: "var(--panel2)", border: "1px solid var(--border)" }}
          >
            {(["list", "graph"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="rounded-md px-4 py-1.5 text-xs font-medium transition"
                style={{
                  background: tab === t ? "var(--accent)" : "transparent",
                  color: tab === t ? "#fff" : "var(--muted)",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                {t === "list" ? "List" : "Graph"}
              </button>
            ))}
          </div>

          {/* Folders (collections) scoping + management + export */}
          <CollectionsBar />

          {/* Bulk-select action bar */}
          {selectedIds.size > 0 && (
            <div
              className="mt-2 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2"
              style={{ background: "rgba(91,140,255,0.10)", border: "1px solid var(--accent)" }}
            >
              <span className="text-xs font-medium" style={{ color: "var(--accent)" }}>
                {selectedIds.size} selected
              </span>
              <span className="text-xs" style={{ color: "var(--muted)" }}>Move to:</span>
              <select
                value={bulkTarget}
                onChange={(e) => setBulkTarget(e.target.value)}
                className="rounded-md px-2 py-1 text-xs"
                style={{ background: "var(--input-bg)", color: "var(--text)", border: "1px solid var(--border)", cursor: "pointer" }}
              >
                <option value="">Select folder…</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button
                onClick={bulkMove}
                disabled={!bulkTarget || bulkMoving}
                className="rounded-md px-3 py-1 text-xs font-medium text-white"
                style={{ background: !bulkTarget || bulkMoving ? "var(--muted)" : "var(--accent)", border: "none", cursor: !bulkTarget || bulkMoving ? "not-allowed" : "pointer" }}
              >
                {bulkMoving ? "Moving…" : "Move"}
              </button>
              <button
                onClick={clearSelection}
                className="ml-auto text-xs"
                style={{ color: "var(--muted)", background: "transparent", border: "none", cursor: "pointer" }}
              >
                Clear
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden">
        {tab === "list" ? (
          <div className="h-full overflow-y-auto px-5 pb-4">
            <div className="mx-auto max-w-3xl">
              {shown.length === 0 ? (
                <div
                  className="rounded-xl p-10 text-center text-sm"
                  style={{ color: "var(--muted)", border: "1px dashed var(--border)" }}
                >
                  {sources.length === 0
                    ? 'Nothing captured yet. Click "Capture current window" or drag and drop a file to add content to memory.'
                    : "No captures in the selected folder(s)."}
                </div>
              ) : (
                <ul className="space-y-2">
                  {shown.map((s) => (
                    <SourceRow
                      key={s.id}
                      s={s}
                      selected={selectedIds.has(s.id)}
                      onToggle={() => toggleSelect(s.id)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <div className="h-full w-full">
            {graphLoading && !graphData ? (
              <div className="flex h-full items-center justify-center text-sm" style={{ color: "var(--muted)" }}>
                Loading graph…
              </div>
            ) : graphData ? (
              <GraphView data={graphData} />
            ) : (
              <div className="flex h-full items-center justify-center text-sm" style={{ color: "var(--muted)" }}>
                Knowledge graph unavailable. Make sure the sidecar is running.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
