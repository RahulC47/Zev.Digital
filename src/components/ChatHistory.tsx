import { useState } from "react";
import { useStore } from "../store/useStore";

function relativeTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

/**
 * ChatGPT-style chat-history rail shown to the left of the chat thread.
 * Sessions persist on-device (localStorage); nothing leaves the machine.
 */
export function ChatHistory() {
  const sessions = useStore((s) => s.sessions);
  const activeId = useStore((s) => s.activeSessionId);
  const newChat = useStore((s) => s.newChat);
  const switchChat = useStore((s) => s.switchChat);
  const deleteChat = useStore((s) => s.deleteChat);
  const renameChat = useStore((s) => s.renameChat);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const ordered = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  const startRename = (id: string, title: string) => {
    setEditingId(id);
    setDraft(title);
  };
  const commitRename = (id: string) => {
    const t = draft.trim();
    if (t) renameChat(id, t);
    setEditingId(null);
  };

  return (
    <div
      className="flex h-full w-56 shrink-0 flex-col"
      style={{ borderRight: "1px solid var(--border)", background: "var(--panel)" }}
    >
      <div className="p-2.5">
        <button
          onClick={newChat}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition"
          style={{ border: "1px solid var(--border)", background: "var(--panel2)", color: "var(--text)", cursor: "pointer" }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
        >
          ＋ New chat
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {ordered.map((s) => {
          const active = s.id === activeId;
          return (
            <div
              key={s.id}
              onClick={() => switchChat(s.id)}
              className="group relative mb-1 flex cursor-pointer flex-col rounded-lg px-2.5 py-2 transition"
              style={{
                background: active ? "rgba(91,140,255,0.12)" : "transparent",
                border: `1px solid ${active ? "var(--accent)" : "transparent"}`,
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--hover)"; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
            >
              {editingId === s.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={() => commitRename(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(s.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="w-full rounded px-1 py-0.5 text-xs outline-none"
                  style={{ background: "var(--input-bg)", color: "var(--text)", border: "1px solid var(--accent)" }}
                />
              ) : (
                <span
                  className="truncate pr-8 text-xs font-medium"
                  style={{ color: active ? "var(--accent)" : "var(--text)" }}
                  title={s.title}
                >
                  {s.title}
                </span>
              )}
              <span className="mt-0.5 text-[10px]" style={{ color: "var(--muted)" }}>
                {relativeTime(s.updatedAt)}
              </span>

              {/* hover actions */}
              {editingId !== s.id && (
                <div
                  className="absolute right-1.5 top-1.5 flex gap-0.5 opacity-0 transition group-hover:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    title="Rename"
                    onClick={() => startRename(s.id, s.title)}
                    className="rounded px-1 text-[11px]"
                    style={{ background: "var(--panel)", border: "1px solid var(--border)", color: "var(--muted)", cursor: "pointer" }}
                  >
                    ✎
                  </button>
                  <button
                    title="Delete chat"
                    onClick={() => deleteChat(s.id)}
                    className="rounded px-1 text-[11px]"
                    style={{ background: "var(--panel)", border: "1px solid var(--border)", color: "var(--danger)", cursor: "pointer" }}
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
