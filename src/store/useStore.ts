import { create } from "zustand";
import {
  api,
  type Answer,
  type Collection,
  type CouncilResponse,
  type Expert,
  type GraphData,
  type GraphitiHealth,
  type LlmHealth,
  type Settings,
  type Source,
} from "../lib/api";


export interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  answer?: Answer; // present on assistant turns (carries citations)
  pending?: boolean;
  error?: boolean;
}

/** One past/active conversation thread (ChatGPT-style history). */
export interface ChatSession {
  id: string;
  title: string;
  expertId: string | null;
  turns: ChatTurn[];
  updatedAt: number;
}

export type View = "chat" | "sources" | "settings" | "traces" | "experts";
export type Theme = "dark" | "light";
export type OrbState = "idle" | "thinking";

interface AppState {
  view: View;
  setView: (v: View) => void;

  // theme
  theme: Theme;
  toggleTheme: () => void;

  // capture
  capturing: boolean;
  lastCapture?: string;
  captureError?: string;
  capture: () => Promise<void>;

  // continuous capture loop
  captureLoopRunning: boolean;
  toggleCaptureLoop: () => Promise<void>;
  refreshCaptureLoopStatus: () => Promise<void>;
  onAutoCapture: (summary: string) => void;

  // experts
  experts: Expert[];
  activeExpertId: string | null;
  refreshExperts: () => Promise<void>;
  setActiveExpert: (id: string | null) => void;

  // chat sessions (history, like model providers)
  sessions: ChatSession[];
  activeSessionId: string;
  turns: ChatTurn[];
  asking: boolean;
  ask: (question: string) => Promise<void>;
  clearChat: () => void;
  newChat: () => void;
  switchChat: (id: string) => void;
  deleteChat: (id: string) => void;
  renameChat: (id: string, title: string) => void;
  pinnedSourceIds: string[];
  setPinnedSourceIds: (ids: string[]) => void;

  // council mode
  councilMode: boolean;
  toggleCouncilMode: () => void;
  councilExperts: string[];
  setCouncilExperts: (ids: string[]) => void;
  councilResults: CouncilResponse[] | null;
  askCouncil: (question: string) => Promise<void>;

  // orb
  orbState: OrbState;

  // sources
  sources: Source[];
  refreshSources: () => Promise<void>;
  deleteSource: (id: string) => Promise<void>;
  updateSourceContent: (sourceId: string, content: string) => Promise<void>;
  renameSource: (id: string, title: string) => Promise<void>;

  // file import (upload / drag-drop)
  importing: boolean;
  importFiles: (paths: string[]) => Promise<void>;

  // collections
  collections: Collection[];
  selectedCollections: string[];
  activeCollectionId: string;
  refreshCollections: () => Promise<void>;
  createCollection: (name: string) => Promise<void>;
  renameCollection: (id: string, name: string) => Promise<void>;
  deleteCollection: (id: string) => Promise<void>;
  setActiveCollection: (id: string) => Promise<void>;
  setSelectedCollections: (ids: string[]) => void;
  moveSource: (sourceId: string, collectionId: string) => Promise<void>;

  // graph view
  graphData?: GraphData;
  graphLoading: boolean;
  refreshGraph: () => Promise<void>;

  // graph → chat clipboard: serialized text copied from graph selection
  graphContext: string | null;
  setGraphContext: (text: string | null) => void;

  // health + settings
  health?: LlmHealth;
  graphitiHealth?: GraphitiHealth;
  refreshHealth: () => Promise<void>;
  refreshGraphitiHealth: () => Promise<void>;
  settings?: Settings;
  loadSettings: () => Promise<void>;
  saveSettings: (s: Settings) => Promise<void>;
}

const uid = () => Math.random().toString(36).slice(2);

// ── chat-session persistence (localStorage, on-device) ──────────────────────
const CHATS_KEY = "zev-chats";

const newSession = (expertId: string | null = null): ChatSession => ({
  id: uid(),
  title: "New chat",
  expertId,
  turns: [],
  updatedAt: Date.now(),
});

const deriveTitle = (q: string): string => {
  const t = q.trim().replace(/\s+/g, " ");
  return t.length > 40 ? t.slice(0, 40) + "…" : t || "New chat";
};

const persistSessions = (sessions: ChatSession[], activeSessionId: string) => {
  try {
    localStorage.setItem(CHATS_KEY, JSON.stringify({ sessions, activeSessionId }));
  } catch {
    /* storage full / unavailable — chats just won't survive restart */
  }
};

const loadSessions = (): { sessions: ChatSession[]; activeSessionId: string } => {
  try {
    const raw = localStorage.getItem(CHATS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { sessions: ChatSession[]; activeSessionId: string };
      if (Array.isArray(parsed.sessions) && parsed.sessions.length > 0) {
        // Drop any half-finished assistant turn left over from a crash/reload.
        const sessions = parsed.sessions.map((s) => ({
          ...s,
          turns: (s.turns ?? []).filter((t) => !t.pending),
        }));
        const activeSessionId = sessions.some((s) => s.id === parsed.activeSessionId)
          ? parsed.activeSessionId
          : sessions[0].id;
        return { sessions, activeSessionId };
      }
    }
  } catch {
    /* ignore corrupt storage */
  }
  const fresh = newSession();
  return { sessions: [fresh], activeSessionId: fresh.id };
};

const initialChats = loadSessions();
const initialActive =
  initialChats.sessions.find((s) => s.id === initialChats.activeSessionId) ??
  initialChats.sessions[0];

export const useStore = create<AppState>((set, get) => ({
  view: "chat",
  setView: (v) => set({ view: v }),

  // ── theme ──────────────────────────────────────────────────────────────────
  theme: (() => {
    const saved = localStorage.getItem("zev-theme") as Theme | null;
    const t: Theme = saved === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = t;
    return t;
  })(),
  toggleTheme: () => {
    const next: Theme = get().theme === "dark" ? "light" : "dark";
    localStorage.setItem("zev-theme", next);
    document.documentElement.dataset.theme = next;
    set({ theme: next });
  },

  // ── capture ────────────────────────────────────────────────────────────────
  capturing: false,
  capture: async () => {
    set({ capturing: true, captureError: undefined });
    try {
      const r = await api.captureActiveWindow();
      set({
        lastCapture: `Captured ${r.char_count.toLocaleString()} chars from "${r.window_title}" (${r.app}) — ${r.chunk_count} chunks`,
      });
      await get().refreshSources();
    } catch (e) {
      const msg = String(e);
      set({ captureError: msg });
      setTimeout(() => {
        if (get().captureError === msg) set({ captureError: undefined });
      }, 8000);
    } finally {
      set({ capturing: false });
    }
  },

  // ── continuous capture loop ────────────────────────────────────────────────
  captureLoopRunning: false,
  toggleCaptureLoop: async () => {
    const running = get().captureLoopRunning;
    try {
      const status = running
        ? await api.stopCaptureLoop()
        : await api.startCaptureLoop();
      set({ captureLoopRunning: status.running });
    } catch (e) {
      set({ captureError: String(e) });
    }
  },
  refreshCaptureLoopStatus: async () => {
    try {
      const status = await api.captureLoopStatus();
      set({ captureLoopRunning: status.running });
    } catch {
      /* ignore */
    }
  },
  onAutoCapture: (summary) => {
    set({ lastCapture: summary });
    get().refreshSources();
  },

  // ── experts ──────────────────────────────────────────────────────────────────
  experts: [],
  activeExpertId: initialActive?.expertId ?? null,
  refreshExperts: async () => {
    try {
      set({ experts: await api.listExperts() });
    } catch { /* ignore */ }
  },
  // The active expert is a property of the current chat session, so switching
  // sessions restores its expert and switching experts is scoped to this chat.
  setActiveExpert: (id) => {
    set((s) => {
      const sessions = s.sessions.map((sess) =>
        sess.id === s.activeSessionId ? { ...sess, expertId: id } : sess,
      );
      persistSessions(sessions, s.activeSessionId);
      return { activeExpertId: id, sessions };
    });
  },

  // ── chat sessions (history) ─────────────────────────────────────────────────
  sessions: initialChats.sessions,
  activeSessionId: initialChats.activeSessionId,
  turns: initialActive?.turns ?? [],
  asking: false,
  pinnedSourceIds: [],
  setPinnedSourceIds: (ids) => set({ pinnedSourceIds: ids }),
  ask: async (question) => {
    if (!question.trim() || get().asking) return;
    const userTurn: ChatTurn = { id: uid(), role: "user", text: question };
    const pendingId = uid();
    const sessionId = get().activeSessionId;
    set((s) => {
      const sessions = s.sessions.map((sess) => {
        if (sess.id !== sessionId) return sess;
        const turns = [
          ...sess.turns,
          userTurn,
          { id: pendingId, role: "assistant" as const, text: "", pending: true },
        ];
        return {
          ...sess,
          turns,
          title: sess.turns.length === 0 ? deriveTitle(question) : sess.title,
          updatedAt: Date.now(),
        };
      });
      const active = sessions.find((x) => x.id === s.activeSessionId);
      return {
        asking: true,
        orbState: "thinking" as OrbState,
        turns: active?.turns ?? s.turns,
        sessions,
      };
    });
    try {
      const pinned = get().pinnedSourceIds;
      const expertId = get().activeExpertId;
      const answer = await api.ask(
        question,
        get().selectedCollections,
        pinned.length > 0 ? pinned : undefined,
        expertId ?? undefined,
      );
      set((s) => {
        const sessions = s.sessions.map((sess) =>
          sess.id === sessionId
            ? {
                ...sess,
                turns: sess.turns.map((t) =>
                  t.id === pendingId ? { ...t, text: answer.text, answer, pending: false } : t,
                ),
                updatedAt: Date.now(),
              }
            : sess,
        );
        const active = sessions.find((x) => x.id === s.activeSessionId);
        persistSessions(sessions, s.activeSessionId);
        return { turns: active?.turns ?? s.turns, sessions };
      });
      api.saveChatMemory(question, answer.text).catch(() => {});
      get().refreshSources();
    } catch (e) {
      set((s) => {
        const sessions = s.sessions.map((sess) =>
          sess.id === sessionId
            ? {
                ...sess,
                turns: sess.turns.map((t) =>
                  t.id === pendingId ? { ...t, text: String(e), pending: false, error: true } : t,
                ),
              }
            : sess,
        );
        const active = sessions.find((x) => x.id === s.activeSessionId);
        persistSessions(sessions, s.activeSessionId);
        return { turns: active?.turns ?? s.turns, sessions };
      });
    } finally {
      set({ asking: false, orbState: "idle" });
    }
  },
  clearChat: () => {
    set((s) => {
      const sessions = s.sessions.map((sess) =>
        sess.id === s.activeSessionId ? { ...sess, turns: [], title: "New chat" } : sess,
      );
      persistSessions(sessions, s.activeSessionId);
      return { turns: [], sessions };
    });
  },
  newChat: () => {
    set((s) => {
      const sess = newSession(s.activeExpertId);
      const sessions = [sess, ...s.sessions];
      persistSessions(sessions, sess.id);
      return { sessions, activeSessionId: sess.id, turns: [], councilResults: null };
    });
  },
  switchChat: (id) => {
    set((s) => {
      const sess = s.sessions.find((x) => x.id === id);
      if (!sess) return {};
      persistSessions(s.sessions, id);
      return {
        activeSessionId: id,
        turns: sess.turns,
        activeExpertId: sess.expertId,
        councilResults: null,
      };
    });
  },
  deleteChat: (id) => {
    set((s) => {
      let sessions = s.sessions.filter((x) => x.id !== id);
      if (sessions.length === 0) sessions = [newSession()];
      let { activeSessionId, turns, activeExpertId } = s;
      if (id === s.activeSessionId) {
        const next = sessions[0];
        activeSessionId = next.id;
        turns = next.turns;
        activeExpertId = next.expertId;
      }
      persistSessions(sessions, activeSessionId);
      return { sessions, activeSessionId, turns, activeExpertId };
    });
  },
  renameChat: (id, title) => {
    set((s) => {
      const sessions = s.sessions.map((x) => (x.id === id ? { ...x, title } : x));
      persistSessions(sessions, s.activeSessionId);
      return { sessions };
    });
  },

  // ── council mode ──────────────────────────────────────────────────────────
  councilMode: false,
  toggleCouncilMode: () => set((s) => ({ councilMode: !s.councilMode })),
  councilExperts: [],
  setCouncilExperts: (ids) => set({ councilExperts: ids }),
  councilResults: null,
  askCouncil: async (question) => {
    if (!question.trim() || get().asking) return;
    const expertIds = get().councilExperts;
    if (expertIds.length === 0) return;
    set({ asking: true, orbState: "thinking", councilResults: null });
    try {
      const results = await api.askCouncil(
        question,
        expertIds,
        get().selectedCollections,
      );
      set({ councilResults: results });
    } catch (e) {
      set({
        councilResults: [{
          expert_id: "error",
          expert_name: "Error",
          expert_icon: "❌",
          answer: { text: String(e), citations: [] },
        }],
      });
    } finally {
      set({ asking: false, orbState: "idle" });
    }
  },

  // ── orb ────────────────────────────────────────────────────────────────────
  orbState: "idle",

  sources: [],
  refreshSources: async () => {
    try {
      set({ sources: await api.listSources() });
    } catch {
      /* surfaced elsewhere */
    }
  },
  deleteSource: async (id) => {
    await api.deleteSource(id);
    await get().refreshSources();
  },
  updateSourceContent: async (sourceId, content) => {
    await api.updateSourceContent(sourceId, content);
    await get().refreshSources();
  },
  renameSource: async (id, title) => {
    await api.renameSource(id, title);
    await get().refreshSources();
  },

  // ── file import ────────────────────────────────────────────────────────────
  importing: false,
  importFiles: async (paths) => {
    if (paths.length === 0 || get().importing) return;
    set({ importing: true, captureError: undefined });
    let ok = 0;
    const errors: string[] = [];
    for (const path of paths) {
      const name = path.split(/[\\/]/).pop() || path;
      set({ lastCapture: `Importing "${name}"…` });
      try {
        const r = await api.importFile(path);
        ok += 1;
        set({
          lastCapture: `Imported "${r.window_title}" — ${r.char_count.toLocaleString()} chars, ${r.chunk_count} chunks`,
        });
      } catch (e) {
        errors.push(`${name}: ${e}`);
      }
    }
    await get().refreshSources();
    await get().refreshCollections();
    setTimeout(() => { get().refreshGraph(); }, 3000);
    if (errors.length > 0) {
      const msg = errors.join(" · ");
      set({ captureError: msg });
      setTimeout(() => {
        if (get().captureError === msg) set({ captureError: undefined });
      }, 10000);
    } else if (ok > 1) {
      set({ lastCapture: `Imported ${ok} files into Memory` });
    }
    set({ importing: false });
  },

  // ── collections ────────────────────────────────────────────────────────────
  collections: [],
  selectedCollections: [],
  activeCollectionId: "general",
  refreshCollections: async () => {
    try {
      set({ collections: await api.listCollections() });
    } catch {
      /* ignore */
    }
  },
  createCollection: async (name) => {
    await api.createCollection(name);
    await get().refreshCollections();
  },
  renameCollection: async (id, name) => {
    await api.renameCollection(id, name);
    await get().refreshCollections();
  },
  deleteCollection: async (id) => {
    await api.deleteCollection(id);
    const active = get().activeCollectionId === id ? "general" : get().activeCollectionId;
    if (active !== get().activeCollectionId) await get().setActiveCollection(active);
    set({ selectedCollections: get().selectedCollections.filter((c) => c !== id) });
    await get().refreshCollections();
    await get().refreshSources();
  },
  setActiveCollection: async (id) => {
    set({ activeCollectionId: id });
    const s = get().settings;
    if (s) await get().saveSettings({ ...s, active_collection_id: id });
  },
  setSelectedCollections: (ids) => set({ selectedCollections: ids }),
  moveSource: async (sourceId, collectionId) => {
    await api.setSourceCollection(sourceId, collectionId);
    await get().refreshSources();
    await get().refreshCollections();
  },

  // ── graph view ─────────────────────────────────────────────────────────────
  graphData: undefined,
  graphLoading: false,
  refreshGraph: async () => {
    set({ graphLoading: true });
    try {
      set({ graphData: await api.getGraph(get().selectedCollections) });
    } catch {
      set({ graphData: { nodes: [], links: [] } });
    } finally {
      set({ graphLoading: false });
    }
  },

  graphContext: null,
  setGraphContext: (text) => set({ graphContext: text }),

  refreshHealth: async () => {
    try {
      set({ health: await api.llmHealth() });
    } catch (e) {
      set({
        health: {
          ok: false,
          provider: "unknown",
          chat_model: "",
          message: String(e),
        },
      });
    }
  },

  refreshGraphitiHealth: async () => {
    try {
      set({ graphitiHealth: await api.graphitiHealth() });
    } catch {
      set({ graphitiHealth: { ready: false, message: "unavailable" } });
    }
  },

  loadSettings: async () => {
    const settings = await api.getSettings();
    set({ settings, activeCollectionId: settings.active_collection_id || "general" });
  },
  saveSettings: async (s) => {
    await api.setSettings(s);
    set({ settings: s });
    await get().refreshHealth();
  },
}));
