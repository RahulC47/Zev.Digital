import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useStore } from "../store/useStore";
import { type Citation } from "../lib/api";
import { Orb } from "./Orb";
import { ChatHistory } from "./ChatHistory";

function CitationCard({ c }: { c: Citation }) {
  return (
    <div
      className="rounded-lg p-2.5 text-xs"
      style={{ background: "var(--panel2)", border: "1px solid var(--border)" }}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="truncate font-medium" style={{ color: "var(--text)" }}>
          {c.app} — {c.window_title || "Untitled"}
        </span>
        <span className="shrink-0 text-[10px]" style={{ color: "var(--muted)" }}>
          {new Date(c.captured_at).toLocaleString()}
        </span>
      </div>
      {c.url && (
        <div className="mb-1 truncate text-[10px]" style={{ color: "var(--accent)" }}>
          {c.url}
        </div>
      )}
      <p className="line-clamp-3" style={{ color: "var(--muted)" }}>{c.snippet}</p>
    </div>
  );
}

export function Chat() {
  const turns = useStore((s) => s.turns);
  const asking = useStore((s) => s.asking);
  const ask = useStore((s) => s.ask);
  const clearChat = useStore((s) => s.clearChat);
  const sources = useStore((s) => s.sources);
  const collections = useStore((s) => s.collections);
  const selected = useStore((s) => s.selectedCollections);
  const setSelected = useStore((s) => s.setSelectedCollections);
  const orbState = useStore((s) => s.orbState);
  const pinnedSourceIds = useStore((s) => s.pinnedSourceIds);
  const setPinnedSourceIds = useStore((s) => s.setPinnedSourceIds);
  const importFiles = useStore((s) => s.importFiles);
  const importing = useStore((s) => s.importing);

  const graphContext = useStore((s) => s.graphContext);
  const setGraphContext = useStore((s) => s.setGraphContext);

  const [input, setInput] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFilter, setPickerFilter] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const scopeLabel =
    selected.length === 0
      ? "all folders"
      : collections
          .filter((c) => selected.includes(c.id))
          .map((c) => c.name)
          .join(", ") || `${selected.length} folders`;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    ask(input);
    setInput("");
  };

  const onUploadFile = async () => {
    const picked = await open({
      multiple: true,
      title: "Add files to brain",
      filters: [
        { name: "Documents", extensions: ["pdf", "docx", "txt", "md", "csv", "json", "html", "log"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    await importFiles(paths);
  };

  const togglePin = (id: string) => {
    setPinnedSourceIds(
      pinnedSourceIds.includes(id)
        ? pinnedSourceIds.filter((p) => p !== id)
        : [...pinnedSourceIds, id],
    );
  };

  const filteredSources = sources.filter((s) => {
    if (!pickerFilter) return true;
    const q = pickerFilter.toLowerCase();
    return (
      s.window_title.toLowerCase().includes(q) ||
      s.app.toLowerCase().includes(q)
    );
  });

  const empty = turns.length === 0;

  return (
    <div className="flex h-full">
      <ChatHistory />
      <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {empty ? (
          <div className="mx-auto mt-10 flex max-w-md flex-col items-center text-center">
            <Orb state={orbState} size="lg" />
            <h2 className="mt-4 mb-1 text-lg font-medium" style={{ color: "var(--text)" }}>
              Ask anything
            </h2>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              {sources.length === 0
                ? 'Open a document or app, click "Capture current window" above, then ask a question.'
                : `Memory has ${sources.length} source${sources.length === 1 ? "" : "s"}. Type a question below.`}
            </p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-4">
            <div className="flex justify-center">
              <Orb state={orbState} size="sm" hideLabel />
            </div>
            {turns.map((t) => (
              <div
                key={t.id}
                className={t.role === "user" ? "flex justify-end" : ""}
              >
                <div
                  className={
                    t.role === "user"
                      ? "max-w-[80%] rounded-2xl rounded-br-sm px-4 py-2 text-sm text-white"
                      : "w-full"
                  }
                  style={t.role === "user" ? { background: "var(--accent)" } : undefined}
                >
                  {t.role === "assistant" ? (
                    <div className="space-y-3">
                      <div
                        className="whitespace-pre-wrap text-sm"
                        style={{ color: t.error ? "var(--danger)" : "var(--text)" }}
                      >
                        {t.pending ? (
                          <span style={{ color: "var(--muted)" }}>Thinking…</span>
                        ) : (
                          t.text
                        )}
                      </div>
                      {t.answer && t.answer.citations.length > 0 && (
                        <div className="space-y-2">
                          <div
                            className="text-[11px] font-medium uppercase tracking-wide"
                            style={{ color: "var(--muted)" }}
                          >
                            Sources
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {t.answer.citations.map((c, i) => (
                              <CitationCard key={i} c={c} />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="whitespace-pre-wrap">{t.text}</span>
                  )}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <form
        onSubmit={submit}
        className="px-5 py-3"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        {/* ── Context / scope bar ──────────────────────────────────────── */}
        <div className="mx-auto mb-1.5 flex max-w-2xl flex-wrap items-center gap-1.5 text-[11px]" style={{ color: "var(--muted)" }}>
          {pinnedSourceIds.length === 0 ? (
            <>
              <span>Asking across:</span>
              <span style={{ color: "var(--accent)" }}>{scopeLabel}</span>
              {selected.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelected([])}
                  className="rounded px-1.5 py-0.5"
                  style={{ color: "var(--muted)", background: "transparent", border: "1px solid var(--border)", cursor: "pointer" }}
                >
                  reset to all
                </button>
              )}
            </>
          ) : (
            <>
              <span>Focused on:</span>
              {pinnedSourceIds.map((id) => {
                const s = sources.find((src) => src.id === id);
                if (!s) return null;
                return (
                  <span
                    key={id}
                    className="flex items-center gap-1 rounded-full px-2 py-0.5"
                    style={{ background: "rgba(91,140,255,0.15)", color: "var(--accent)", border: "1px solid var(--accent)" }}
                  >
                    <span className="max-w-[140px] truncate">{s.window_title || s.app}</span>
                    <button
                      type="button"
                      onClick={() => togglePin(id)}
                      style={{ background: "transparent", border: "none", cursor: "pointer", color: "inherit", lineHeight: 1, padding: 0 }}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
              <button
                type="button"
                onClick={() => setPinnedSourceIds([])}
                className="rounded px-1.5 py-0.5"
                style={{ color: "var(--muted)", background: "transparent", border: "1px solid var(--border)", cursor: "pointer" }}
              >
                clear all
              </button>
            </>
          )}

          {/* Source picker */}
          <div ref={pickerRef} className="relative ml-auto">
            <button
              type="button"
              onClick={() => { setPickerOpen((o) => !o); setPickerFilter(""); }}
              className="rounded px-2 py-0.5"
              style={{
                background: pinnedSourceIds.length > 0 ? "rgba(91,140,255,0.15)" : "transparent",
                border: `1px solid ${pinnedSourceIds.length > 0 ? "var(--accent)" : "var(--border)"}`,
                color: pinnedSourceIds.length > 0 ? "var(--accent)" : "var(--muted)",
                cursor: "pointer",
              }}
              title="Pin specific sources to focus this question"
            >
              📌 {pinnedSourceIds.length > 0 ? `${pinnedSourceIds.length} pinned` : "Pin sources"}
            </button>

            {pickerOpen && (
              <div
                className="absolute bottom-full right-0 z-50 mb-1 w-72 overflow-hidden rounded-lg shadow-lg"
                style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
              >
                <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                    Pin sources to focus Ask
                  </div>
                  <input
                    autoFocus
                    value={pickerFilter}
                    onChange={(e) => setPickerFilter(e.target.value)}
                    placeholder="Filter sources…"
                    className="w-full rounded-md px-2 py-1 text-xs outline-none"
                    style={{ background: "var(--input-bg)", color: "var(--text)", border: "1px solid var(--border)" }}
                  />
                </div>
                {sources.length === 0 ? (
                  <div className="px-3 py-3 text-xs" style={{ color: "var(--muted)" }}>
                    Nothing in memory yet. Capture a window or upload a file first.
                  </div>
                ) : (
                  <ul className="max-h-52 overflow-y-auto py-1">
                    {filteredSources.length === 0 ? (
                      <li className="px-3 py-2 text-xs" style={{ color: "var(--muted)" }}>No match.</li>
                    ) : (
                      filteredSources.map((s) => {
                        const pinned = pinnedSourceIds.includes(s.id);
                        return (
                          <li key={s.id}>
                            <label
                              className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs transition"
                              style={{ color: pinned ? "var(--accent)" : "var(--text)" }}
                              onMouseEnter={(e) => { if (!pinned) (e.currentTarget as HTMLElement).style.background = "var(--hover)"; }}
                              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                            >
                              <input
                                type="checkbox"
                                checked={pinned}
                                onChange={() => togglePin(s.id)}
                                style={{ accentColor: "var(--accent)", cursor: "pointer" }}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium">
                                  {s.window_title || "Untitled"}
                                </span>
                                <span className="truncate" style={{ color: "var(--muted)" }}>
                                  {s.app} · {s.char_count.toLocaleString()} chars
                                </span>
                              </span>
                            </label>
                          </li>
                        );
                      })
                    )}
                  </ul>
                )}
                {pinnedSourceIds.length > 0 && (
                  <div className="px-3 py-1.5" style={{ borderTop: "1px solid var(--border)" }}>
                    <button
                      type="button"
                      onClick={() => setPinnedSourceIds([])}
                      className="text-[11px]"
                      style={{ color: "var(--muted)", background: "transparent", border: "none", cursor: "pointer" }}
                    >
                      Clear selection ({pinnedSourceIds.length})
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Graph context banner — click to paste into input ────────── */}
        {graphContext && (
          <div
            className="mx-auto mb-1.5 flex max-w-2xl cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs transition"
            style={{
              background: "rgba(91,140,255,0.10)",
              border: "1px solid var(--accent)",
              color: "var(--accent)",
            }}
            onClick={() => {
              setInput((prev) => (prev ? prev + "\n" + graphContext : graphContext));
              setGraphContext(null);
            }}
            title="Click to paste into input"
          >
            <span className="min-w-0 flex-1 truncate">
              Graph context copied — click to paste
            </span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setGraphContext(null); }}
              style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--accent)", padding: 0, lineHeight: 1 }}
            >
              ✕
            </button>
          </div>
        )}

        {/* ── Input row ─────────────────────────────────────────────────── */}
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          {/* File upload */}
          <button
            type="button"
            onClick={onUploadFile}
            disabled={importing}
            title={importing ? "Importing…" : "Upload a file into your brain (PDF, Word, text…)"}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition"
            style={{
              background: "var(--input-bg)",
              border: "1px solid var(--border)",
              color: importing ? "var(--muted)" : "var(--text)",
              cursor: importing ? "wait" : "pointer",
              fontSize: 16,
            }}
          >
            {importing ? "…" : "📎"}
          </button>

          {turns.length > 0 && (
            <button
              type="button"
              onClick={clearChat}
              className="rounded-lg px-2 py-2 text-xs"
              style={{ color: "var(--muted)", background: "transparent", border: "none" }}
              title="Clear conversation"
            >
              Clear
            </button>
          )}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit(e as unknown as React.FormEvent);
              }
            }}
            placeholder={
              pinnedSourceIds.length > 0
                ? `Ask about ${pinnedSourceIds.length} selected source${pinnedSourceIds.length === 1 ? "" : "s"}…`
                : "Ask about your captured work…"
            }
            className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none"
            style={{
              background: "var(--input-bg)",
              color: "var(--text)",
              border: `1px solid ${pinnedSourceIds.length > 0 ? "var(--accent)" : "var(--border)"}`,
            }}
          />
          <button
            type="submit"
            disabled={asking || !input.trim()}
            className="rounded-xl px-4 py-2.5 text-sm font-medium text-white transition disabled:opacity-50"
            style={{
              background: "var(--accent)",
              border: "none",
            }}
          >
            {asking ? "…" : "Ask"}
          </button>
        </div>
      </form>
      </div>
    </div>
  );
}
