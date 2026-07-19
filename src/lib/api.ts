// Typed wrappers around the Rust backend (Tauri commands).
// Keep these types in sync with the serde structs in src-tauri/src.
import { invoke } from "@tauri-apps/api/core";

export interface Source {
  id: string;
  app: string;
  window_title: string;
  captured_at: string;
  chunk_count: number;
  char_count: number;
  collection_id: string;
  /** Page URL when captured from a browser. */
  url?: string | null;
}

export interface Collection {
  id: string;
  name: string;
  created_at: string;
  source_count: number;
  instructions: string;
}

export interface ChunkRow {
  rowid: number;
  text: string;
}

export interface CaptureResult {
  source_id: string;
  app: string;
  window_title: string;
  char_count: number;
  chunk_count: number;
  url?: string | null;
  /** True when an existing source was updated in place (session coalescing). */
  updated: boolean;
}

export interface Citation {
  source_id: string;
  app: string;
  window_title: string;
  captured_at: string;
  snippet: string;
  score: number;
  url?: string | null;
}

export interface Answer {
  text: string;
  citations: Citation[];
}

export interface LlmHealth {
  ok: boolean;
  /** "ollama" | "byok" */
  provider: string;
  chat_model: string;
  message: string;
}

export interface GraphitiHealth {
  ready: boolean;
  message: string;
}

export interface GraphNode {
  id: string;
  label: string;
  summary: string;
  node_type: string;
}

export interface GraphLink {
  id: string;
  source: string;
  target: string;
  name: string;
  fact: string;
  valid_at: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export type ChatProvider = "ollama" | "openrouter" | "byok";
export type GraphExtractionMode = "local" | "cloud";

export interface Settings {
  chat_provider: ChatProvider;
  ollama_url: string;
  ollama_chat_model: string;
  byok_base_url: string;
  byok_api_key: string;
  byok_chat_model: string;
  openrouter_api_key: string;
  openrouter_model: string;
  graph_extraction_mode: GraphExtractionMode;
  capture_paused: boolean;
  capture_interval_secs: number;
  active_collection_id: string;
  denylist: string[];
  /** Never capture Incognito / InPrivate / Private Browsing windows. */
  skip_private_browsing: boolean;
  // Langfuse observability (opt-in)
  langfuse_enabled: boolean;
  langfuse_public_key: string;
  langfuse_secret_key: string;
  langfuse_host: string;
  default_system_prompt: string;
  // Custom API profiles (BYOK multi-profile)
  custom_api_profiles: CustomApiProfile[];
  active_custom_profile_idx: number;
}

/** A named custom (OpenAI-compatible) API profile */
export interface CustomApiProfile {
  name: string;
  base_url: string;
  api_key: string;
  model: string;
}


export interface CaptureLoopStatus {
  running: boolean;
}

export interface LlmTraceSummary {
  id: string;
  timestamp: string;
  kind: string;
  provider: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number;
  error: string | null;
}

export interface LlmTrace extends LlmTraceSummary {
  system_prompt: string;
  user_prompt: string;
  response: string;
}

export interface TraceStats {
  total_calls: number;
  total_errors: number;
  avg_latency_ms: number;
  total_input_tokens: number;
  total_output_tokens: number;
}

export interface Expert {
  id: string;
  name: string;
  description: string;
  icon: string;
  system_prompt: string;
  temperature: number | null;
  model_override: string | null;
  collection_scope: string | null;
  is_builtin: boolean;
  created_at: string;
  updated_at: string;
}

export interface CouncilResponse {
  expert_id: string;
  expert_name: string;
  expert_icon: string;
  answer: Answer;
}

export const api = {
  captureActiveWindow: () => invoke<CaptureResult>("capture_active_window"),
  ask: (question: string, collections?: string[], sourceIds?: string[], expertId?: string) =>
    invoke<Answer>("ask", {
      question,
      collections: collections ?? null,
      sourceIds: sourceIds && sourceIds.length > 0 ? sourceIds : null,
      expertId: expertId ?? null,
    }),
  listSources: () => invoke<Source[]>("list_sources"),
  deleteSource: (sourceId: string) =>
    invoke<void>("delete_source", { sourceId }),
  clearVault: () => invoke<void>("clear_vault"),
  llmHealth: () => invoke<LlmHealth>("llm_health"),
  graphitiHealth: () => invoke<GraphitiHealth>("graphiti_health"),
  getSettings: () => invoke<Settings>("get_settings"),
  setSettings: (settings: Settings) =>
    invoke<void>("set_settings", { settings }),
  getGraph: (collections?: string[]) =>
    invoke<GraphData>("get_graph", { collections: collections ?? null }),
  startCaptureLoop: () => invoke<CaptureLoopStatus>("start_capture_loop"),
  stopCaptureLoop: () => invoke<CaptureLoopStatus>("stop_capture_loop"),
  captureLoopStatus: () => invoke<CaptureLoopStatus>("capture_loop_status"),

  // collections
  listCollections: () => invoke<Collection[]>("list_collections"),
  createCollection: (name: string) =>
    invoke<Collection>("create_collection", { name }),
  renameCollection: (id: string, name: string) =>
    invoke<void>("rename_collection", { id, name }),
  deleteCollection: (id: string) => invoke<void>("delete_collection", { id }),
  setSourceCollection: (sourceId: string, collectionId: string) =>
    invoke<void>("set_source_collection", { sourceId, collectionId }),
  renameSource: (sourceId: string, windowTitle: string) =>
    invoke<void>("rename_source", { sourceId, windowTitle }),


  // granular delete
  listChunks: (sourceId: string) =>
    invoke<ChunkRow[]>("list_chunks", { sourceId }),
  deleteChunk: (rowid: number) => invoke<void>("delete_chunk", { rowid }),
  deleteGraphNode: (uuid: string) =>
    invoke<void>("delete_graph_node", { uuid }),
  deleteGraphEdge: (uuid: string) =>
    invoke<void>("delete_graph_edge", { uuid }),

  // export
  exportGraph: (format: "md" | "json" | "cypher", collections?: string[]) =>
    invoke<string>("export_graph", { format, collections: collections ?? null }),
  exportVaultJson: (collections?: string[]) =>
    invoke<string>("export_vault_json", { collections: collections ?? null }),
  exportVaultMarkdown: (collections?: string[]) =>
    invoke<string>("export_vault_markdown", { collections: collections ?? null }),
  saveTextFile: (path: string, content: string) =>
    invoke<void>("save_text_file", { path, content }),

  // file import — pdf/docx parsed by the local sidecar, text files read directly
  importFile: (path: string) => invoke<CaptureResult>("import_file", { path }),

  // full captured text of a source (its markdown mirror)
  readSourceText: (sourceId: string) =>
    invoke<string>("read_source_text", { sourceId }),

  // edit a source's content (re-chunks, updates FTS + graph)
  updateSourceContent: (sourceId: string, content: string) =>
    invoke<CaptureResult>("update_source_content", { sourceId, content }),

  // installed Ollama models, for the Settings model picker
  listOllamaModels: () => invoke<string[]>("list_ollama_models"),

  // save a chat Q&A pair into the memory vault so conversations are searchable
  saveChatMemory: (question: string, answer: string) =>
    invoke<CaptureResult>("save_chat_memory", { question, answer }),

  // manual graph node/edge creation
  createGraphNode: (name: string, nodeType: string, summary: string) =>
    invoke<{ uuid: string }>("create_graph_node", { name, nodeType, summary }),
  createGraphEdge: (sourceNodeUuid: string, targetNodeUuid: string, name: string, fact: string) =>
    invoke<{ uuid: string }>("create_graph_edge", { sourceNodeUuid, targetNodeUuid, name, fact }),

  // LLM traces
  listLlmTraces: (limit?: number, offset?: number, kind?: string) =>
    invoke<LlmTraceSummary[]>("list_llm_traces", {
      limit: limit ?? null,
      offset: offset ?? null,
      kind: kind ?? null,
    }),
  getLlmTrace: (id: string) =>
    invoke<LlmTrace | null>("get_llm_trace", { id }),
  clearLlmTraces: () => invoke<void>("clear_llm_traces"),
  llmTraceStats: () => invoke<TraceStats>("llm_trace_stats"),

  // experts
  listExperts: () => invoke<Expert[]>("list_experts"),
  getExpert: (id: string) => invoke<Expert | null>("get_expert", { id }),
  createExpert: (expert: Expert) => invoke<void>("create_expert", { expert }),
  updateExpert: (expert: Expert) => invoke<void>("update_expert", { expert }),
  deleteExpert: (id: string) => invoke<void>("delete_expert", { id }),

  // council
  askCouncil: (question: string, expertIds: string[], collections?: string[]) =>
    invoke<CouncilResponse[]>("ask_council", {
      question,
      expertIds,
      collections: collections ?? null,
    }),

  // collection instructions
  setCollectionInstructions: (id: string, instructions: string) =>
    invoke<void>("set_collection_instructions", { id, instructions }),
};
