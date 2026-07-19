import { useMemo, useRef, useState, useEffect } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { api, type GraphData, type Answer } from "../lib/api";
import { useStore } from "../store/useStore";

type SelEdge = { id: string; name: string; fact: string } | null;
type RectSel = { x: number; y: number; w: number; h: number } | null;
type Modal = "addNode" | "addEdge" | null;

const COLORS = ["#5b8cff", "#7c5cff", "#34d399", "#f59e0b", "#ff5b6e", "#22d3ee", "#e879f9"];

const inputStyle: React.CSSProperties = {
  background: "var(--input-bg)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "6px 10px",
  fontSize: 13,
  outline: "none",
  width: "100%",
};

function getCSSVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

interface Props {
  data: GraphData;
}

export function GraphView({ data }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);
  const [size, setSize] = useState({ w: 700, h: 600 });
  const [graphBg, setGraphBg] = useState("var(--bg)");
  const [labelColor, setLabelColor] = useState("#cdd3e0");
  const [linkColor, setLinkColor] = useState("rgba(150,160,190,0.35)");

  // selection state
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [selEdge, setSelEdge] = useState<SelEdge>(null);
  const [rectSel, setRectSel] = useState<RectSel>(null);
  const [deleting, setDeleting] = useState(false);

  // subgraph filter: when set, only these node ids (+ connecting edges) are shown
  const [subgraphIds, setSubgraphIds] = useState<Set<string> | null>(null);

  // Querying Panel (Right side) state
  const [queryPanelOpen, setQueryPanelOpen] = useState(true);
  const [panelInput, setPanelInput] = useState("");
  const [panelAnswering, setPanelAnswering] = useState(false);
  const [panelAnswer, setPanelAnswer] = useState<Answer | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);

  // modal state for add node / add edge
  const [modal, setModal] = useState<Modal>(null);
  const [saving, setSaving] = useState(false);

  // add node form
  const [newNodeName, setNewNodeName] = useState("");
  const [newNodeType, setNewNodeType] = useState("Entity");
  const [newNodeSummary, setNewNodeSummary] = useState("");

  // add edge form
  const [edgeSourceId, setEdgeSourceId] = useState("");
  const [edgeTargetId, setEdgeTargetId] = useState("");
  const [edgeName, setEdgeName] = useState("");
  const [edgeFact, setEdgeFact] = useState("");

  // Shift+drag = rubber-band select
  const drag = useRef<{
    startX: number; startY: number;
    curX: number; curY: number;
    active: boolean;
  } | null>(null);

  const refreshGraph = useStore((s) => s.refreshGraph);
  const setGraphContext = useStore((s) => s.setGraphContext);
  const setView = useStore((s) => s.setView);
  const selectedCollections = useStore((s) => s.selectedCollections);
  const collections = useStore((s) => s.collections);

  // Theme colors
  useEffect(() => {
    function updateColors() {
      setGraphBg(getCSSVar("--bg") || "#0b0f17");
      setLabelColor(getCSSVar("--text") || "#cdd3e0");
      const theme = document.documentElement.dataset.theme;
      setLinkColor(theme === "light" ? "rgba(80,90,120,0.3)" : "rgba(150,160,190,0.35)");
    }
    updateColors();
    const obs = new MutationObserver(updateColors);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  // Responsive sizing for canvas container
  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) =>
      setSize({ w: e.contentRect.width, h: e.contentRect.height })
    );
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [queryPanelOpen]);

  // Color-code nodes by type
  const colorByType = useMemo(() => {
    const types = [...new Set((data.nodes || []).map((n) => n.node_type))];
    const map: Record<string, string> = {};
    types.forEach((t, i) => (map[t] = COLORS[i % COLORS.length]));
    return map;
  }, [data]);

  // Clone + filter for subgraph view
  const graph = useMemo(() => {
    const allNodes = (data.nodes || []).map((n) => ({ ...n }));
    const allLinks = (data.links || []).map((l) => ({ ...l }));
    if (!subgraphIds) return { nodes: allNodes, links: allLinks };
    const nodeSet = subgraphIds;
    return {
      nodes: allNodes.filter((n) => nodeSet.has(n.id)),
      links: allLinks.filter(
        (l) => nodeSet.has(l.source as string) && nodeSet.has(l.target as string),
      ),
    };
  }, [data, subgraphIds]);

  // Active collection label
  const activeFolderNames = useMemo(() => {
    if (selectedCollections.length === 0) return "All Folders";
    return collections
      .filter((c) => selectedCollections.includes(c.id))
      .map((c) => c.name)
      .join(", ");
  }, [selectedCollections, collections]);

  // ── helpers ──────────────────────────────────────────────────────────────────

  function nodesInRect(x1: number, y1: number, x2: number, y2: number): string[] {
    if (!fgRef.current) return [];
    const tl = fgRef.current.screen2GraphCoords(Math.min(x1, x2), Math.min(y1, y2));
    const br = fgRef.current.screen2GraphCoords(Math.max(x1, x2), Math.max(y1, y2));
    return graph.nodes
      .filter((n: any) =>
        n.x != null && n.y != null &&
        n.x >= tl.x && n.x <= br.x &&
        n.y >= tl.y && n.y <= br.y
      )
      .map((n: any) => n.id as string);
  }

  function nodeAtPos(sx: number, sy: number): boolean {
    if (!fgRef.current) return false;
    return graph.nodes.some((n: any) => {
      if (n.x == null || n.y == null) return false;
      const sc = fgRef.current.graph2ScreenCoords(n.x, n.y);
      const dx = sc.x - sx, dy = sc.y - sy;
      return dx * dx + dy * dy < 144;
    });
  }

  // ── Rubber-band mouse handlers ────────────────────────────────────────────

  function onMouseDown(e: React.MouseEvent) {
    const isShiftLeft = e.button === 0 && e.shiftKey;
    const isRightOnEmpty = e.button === 2;
    if (!isShiftLeft && !isRightOnEmpty) return;

    const r = wrap.current!.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;

    if (isRightOnEmpty && nodeAtPos(sx, sy)) return;

    drag.current = { startX: sx, startY: sy, curX: sx, curY: sy, active: false };
    e.preventDefault();
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!drag.current) return;
    const r = wrap.current!.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    const dx = cx - drag.current.startX, dy = cy - drag.current.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      drag.current.active = true;
      drag.current.curX = cx;
      drag.current.curY = cy;
      setRectSel({
        x: Math.min(drag.current.startX, cx),
        y: Math.min(drag.current.startY, cy),
        w: Math.abs(dx),
        h: Math.abs(dy),
      });
    }
  }

  function onMouseUp(_e: React.MouseEvent) {
    if (!drag.current) return;
    if (drag.current.active) {
      const ids = nodesInRect(
        drag.current.startX, drag.current.startY,
        drag.current.curX, drag.current.curY,
      );
      setSelectedNodeIds(new Set(ids));
    }
    setRectSel(null);
    drag.current = null;
  }

  function onMouseLeave() {
    setRectSel(null);
    drag.current = null;
  }

  // ── copy to chat ──────────────────────────────────────────────────────────

  function buildGraphContextText(): string {
    const targetNodes = selectedNodeIds.size > 0
      ? graph.nodes.filter((n: any) => selectedNodeIds.has(n.id))
      : graph.nodes;

    const lines = targetNodes.map((n: any) => {
      let line = `[Entity: ${n.label}] (${n.node_type || "Entity"})`;
      if (n.summary) line += ` - ${n.summary}`;
      return line;
    });

    const targetEdges = graph.links.filter((l: any) => {
      const srcId = typeof l.source === "object" ? l.source.id : l.source;
      const tgtId = typeof l.target === "object" ? l.target.id : l.target;
      return selectedNodeIds.size === 0 || (selectedNodeIds.has(srcId) && selectedNodeIds.has(tgtId));
    });

    if (targetEdges.length > 0) {
      lines.push("");
      lines.push("Relationships / Facts:");
      for (const e of targetEdges) {
        const src = graph.nodes.find((n: any) => n.id === (typeof e.source === "object" ? (e.source as any).id : e.source));
        const tgt = graph.nodes.find((n: any) => n.id === (typeof e.target === "object" ? (e.target as any).id : e.target));
        lines.push(`${src?.label ?? "?"} —[${(e as any).name || ""}]→ ${tgt?.label ?? "?"}: ${(e as any).fact || ""}`);
      }
    }
    return lines.join("\n");
  }

  function copyNodesToChatAndSwitch() {
    setGraphContext(buildGraphContextText());
    setView("chat");
  }

  function copyEdgeToChatAndSwitch(edge: NonNullable<SelEdge>) {
    const link = graph.links.find((l: any) => l.id === edge.id) as any;
    const src = link && graph.nodes.find((n: any) => n.id === (typeof link.source === "object" ? link.source.id : link.source));
    const tgt = link && graph.nodes.find((n: any) => n.id === (typeof link.target === "object" ? link.target.id : link.target));
    const text = `${src?.label ?? "?"} —[${edge.name}]→ ${tgt?.label ?? "?"}: ${edge.fact}`;
    setGraphContext(text);
    setView("chat");
  }

  // ── Query Panel execution ──────────────────────────────────────────────────

  async function handleGraphQuery(questionText: string) {
    const q = questionText.trim();
    if (!q || panelAnswering) return;

    setPanelAnswering(true);
    setPanelError(null);
    setPanelAnswer(null);

    try {
      const graphFacts = buildGraphContextText();
      const promptWithGraph = `Knowledge Graph Context:\n${graphFacts}\n\nQuestion: ${q}`;
      const answer = await api.ask(promptWithGraph, selectedCollections);
      setPanelAnswer(answer);
    } catch (e) {
      setPanelError(String(e));
    } finally {
      setPanelAnswering(false);
    }
  }

  // ── subgraph from selection ───────────────────────────────────────────────

  function focusSelection() {
    setSubgraphIds(new Set(selectedNodeIds));
    setSelectedNodeIds(new Set());
  }

  function clearSubgraph() {
    setSubgraphIds(null);
  }

  // ── add node / edge ──────────────────────────────────────────────────────

  async function submitAddNode() {
    if (!newNodeName.trim()) return;
    setSaving(true);
    try {
      await api.createGraphNode(newNodeName.trim(), newNodeType.trim() || "Entity", newNodeSummary.trim());
      setModal(null);
      setNewNodeName("");
      setNewNodeType("Entity");
      setNewNodeSummary("");
      await refreshGraph();
    } catch (e) {
      alert(`Failed to add node: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  function openAddEdge() {
    if (selectedNodeIds.size === 2) {
      const [a, b] = [...selectedNodeIds];
      setEdgeSourceId(a);
      setEdgeTargetId(b);
    } else {
      setEdgeSourceId("");
      setEdgeTargetId("");
    }
    setEdgeName("");
    setEdgeFact("");
    setModal("addEdge");
  }

  async function submitAddEdge() {
    if (!edgeSourceId || !edgeTargetId || !edgeName.trim()) return;
    setSaving(true);
    try {
      await api.createGraphEdge(edgeSourceId, edgeTargetId, edgeName.trim(), edgeFact.trim());
      setModal(null);
      await refreshGraph();
    } catch (e) {
      alert(`Failed to add relationship: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  // ── delete actions ────────────────────────────────────────────────────────

  async function deleteSelected() {
    const count = selectedNodeIds.size;
    if (!confirm(`Delete ${count} ${count === 1 ? "entity" : "entities"} from the knowledge graph?`)) return;
    setDeleting(true);
    try {
      for (const id of selectedNodeIds) await api.deleteGraphNode(id);
      setSelectedNodeIds(new Set());
      setSelEdge(null);
      await refreshGraph();
    } catch (e) {
      alert(`Delete failed: ${e}`);
    } finally {
      setDeleting(false);
    }
  }

  async function deleteEdge(id: string) {
    if (!confirm("Delete this relationship from the knowledge graph?")) return;
    setDeleting(true);
    try {
      await api.deleteGraphEdge(id);
      setSelEdge(null);
      await refreshGraph();
    } catch (e) {
      alert(`Delete failed: ${e}`);
    } finally {
      setDeleting(false);
    }
  }

  // Selected nodes list for right panel
  const selectedNodesList = useMemo(() => {
    return graph.nodes.filter((n: any) => selectedNodeIds.has(n.id));
  }, [graph.nodes, selectedNodeIds]);

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* ── Left: Interactive 2D Graph Canvas ────────────────────────────── */}
      <div
        ref={wrap}
        className="relative flex-1 h-full overflow-hidden"
        style={{ userSelect: "none" }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onContextMenu={(e) => e.preventDefault()}
      >
        {graph.nodes.length === 0 && !subgraphIds ? (
          <div
            className="flex h-full items-center justify-center text-sm"
            style={{ color: "var(--muted)" }}
          >
            <div className="text-center">
              <div style={{ fontSize: 40, marginBottom: 12 }}>🕸️</div>
              <div className="font-medium">No entities in {activeFolderNames}</div>
              <div className="mt-1 text-xs" style={{ color: "var(--muted)", opacity: 0.7 }}>
                Capture windows or upload files to extract knowledge graph entities.
              </div>
              <button
                onClick={() => setModal("addNode")}
                className="mt-3 rounded-lg px-4 py-2 text-xs font-medium text-white"
                style={{ background: "var(--accent)", border: "none", cursor: "pointer" }}
              >
                + Add entity
              </button>
            </div>
          </div>
        ) : (
          <>
            <ForceGraph2D
              ref={fgRef}
              width={size.w}
              height={size.h}
              graphData={graph}
              backgroundColor={graphBg}
              enablePanInteraction={true}
              enableNodeDrag={true}
              nodeLabel={(n: any) => `${n.label}${n.summary ? " — " + n.summary : ""}`}
              linkLabel={(l: any) => l.fact || l.name}
              linkColor={() => linkColor}
              linkDirectionalArrowLength={3}
              linkDirectionalArrowRelPos={1}
              onNodeClick={(node: any, event: MouseEvent) => {
                if (drag.current?.active) return;
                setSelectedNodeIds((prev) => {
                  const next = new Set(prev);
                  if (event.ctrlKey || event.metaKey) {
                    if (next.has(node.id)) next.delete(node.id);
                    else next.add(node.id);
                  } else {
                    if (next.size === 1 && next.has(node.id)) next.clear();
                    else { next.clear(); next.add(node.id); }
                  }
                  return next;
                });
              }}
              onNodeRightClick={(node: any, event: MouseEvent) => {
                event.preventDefault();
                setSelectedNodeIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(node.id)) next.delete(node.id);
                  else next.add(node.id);
                  return next;
                });
              }}
              onLinkClick={(link: any) => {
                setSelEdge({ id: link.id, name: link.name || "", fact: link.fact || "" });
              }}
              onBackgroundClick={() => {
                setSelectedNodeIds(new Set());
                setSelEdge(null);
              }}
              nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, scale: number) => {
                const isSelected = selectedNodeIds.has(node.id);
                const r = isSelected ? 5.5 : 4;
                const color = colorByType[node.node_type] || "#5b8cff";

                if (isSelected) {
                  ctx.strokeStyle = "var(--accent, #5b8cff)";
                  ctx.lineWidth = 2;
                  ctx.beginPath();
                  ctx.arc(node.x, node.y, r + 3, 0, 2 * Math.PI);
                  ctx.stroke();
                }

                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
                ctx.fill();

                const label = node.label || "";
                const fs = 12 / scale;
                ctx.font = `${isSelected ? "bold " : ""}${fs}px sans-serif`;
                ctx.fillStyle = labelColor;
                ctx.fillText(label, node.x + r + 1, node.y + fs / 3);
              }}
            />

            {/* Rubber-band rectangle */}
            {rectSel && (
              <div
                style={{
                  position: "absolute",
                  left: rectSel.x,
                  top: rectSel.y,
                  width: rectSel.w,
                  height: rectSel.h,
                  border: "1.5px dashed var(--accent)",
                  background: "rgba(91,140,255,0.08)",
                  borderRadius: 2,
                  pointerEvents: "none",
                }}
              />
            )}

            {/* Subgraph filter banner */}
            {subgraphIds && (
              <div
                className="absolute top-3 left-3 flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs shadow"
                style={{
                  background: "rgba(91,140,255,0.15)",
                  border: "1px solid var(--accent)",
                  color: "var(--accent)",
                }}
              >
                <span>Filtered subgraph: {subgraphIds.size} entities</span>
                <button
                  onClick={clearSubgraph}
                  className="rounded px-2 py-0.5 text-[11px]"
                  style={{ background: "transparent", border: "1px solid var(--accent)", color: "var(--accent)", cursor: "pointer" }}
                >
                  Show all
                </button>
              </div>
            )}

            {/* Top-right toolbar */}
            <div className="absolute top-3 right-3 flex items-center gap-2">
              <div
                className="rounded-lg px-2.5 py-1 text-xs"
                style={{ background: "var(--panel)", border: "1px solid var(--border)", color: "var(--muted)", pointerEvents: "none" }}
              >
                {graph.nodes.length} entities · {graph.links.length} facts
              </div>
              <button
                onClick={() => setModal("addNode")}
                className="rounded-lg px-2.5 py-1 text-xs"
                style={{ background: "var(--panel)", border: "1px solid var(--border)", color: "var(--accent)", cursor: "pointer" }}
              >
                + Entity
              </button>
              <button
                onClick={openAddEdge}
                className="rounded-lg px-2.5 py-1 text-xs"
                style={{ background: "var(--panel)", border: "1px solid var(--border)", color: "var(--accent)", cursor: "pointer" }}
              >
                + Link
              </button>
              <button
                onClick={() => setQueryPanelOpen((o) => !o)}
                className="rounded-lg px-2.5 py-1 text-xs font-medium transition"
                style={{
                  background: queryPanelOpen ? "var(--accent)" : "var(--panel)",
                  color: queryPanelOpen ? "#fff" : "var(--text)",
                  border: "1px solid var(--border)",
                  cursor: "pointer",
                }}
                title="Toggle Graph Querying Panel"
              >
                🔍 Query Tab {selectedNodeIds.size > 0 && `(${selectedNodeIds.size})`}
              </button>
            </div>

            {/* Bottom edge detail pill */}
            {selEdge && (
              <div
                className="absolute bottom-4 left-4 z-40 rounded-xl p-3 shadow-lg"
                style={{ background: "var(--panel)", border: "1px solid var(--border)", maxWidth: 450 }}
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                      Relationship / Fact
                    </div>
                    <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>{selEdge.name || "—"}</div>
                    {selEdge.fact && <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>{selEdge.fact}</div>}
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      onClick={() => copyEdgeToChatAndSwitch(selEdge)}
                      className="rounded-md px-2 py-1 text-xs"
                      style={{ color: "var(--accent)", border: "1px solid var(--border)", background: "transparent", cursor: "pointer" }}
                    >
                      Chat
                    </button>
                    <button
                      disabled={deleting}
                      onClick={() => deleteEdge(selEdge.id)}
                      className="rounded-md px-2 py-1 text-xs"
                      style={{ color: "var(--danger)", border: "1px solid var(--border)", background: "transparent", cursor: "pointer" }}
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setSelEdge(null)}
                      className="rounded-md px-2 py-1 text-xs"
                      style={{ color: "var(--muted)", border: "1px solid var(--border)", background: "transparent", cursor: "pointer" }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Right: Graph Querying & Explorer Side Panel ──────────────────── */}
      {queryPanelOpen && (
        <aside
          className="flex w-80 shrink-0 flex-col h-full overflow-y-auto p-4 space-y-4"
          style={{ background: "var(--panel)", borderLeft: "1px solid var(--border)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-2" style={{ borderBottom: "1px solid var(--border)" }}>
            <div>
              <h3 className="text-sm font-medium" style={{ color: "var(--text)" }}>
                Graph Query Tab
              </h3>
              <p className="text-[11px]" style={{ color: "var(--muted)" }}>
                Query entities &amp; facts directly
              </p>
            </div>
            <button
              onClick={() => setQueryPanelOpen(false)}
              className="text-xs"
              style={{ color: "var(--muted)", background: "transparent", border: "none", cursor: "pointer" }}
            >
              ✕
            </button>
          </div>

          {/* Scope Indicator */}
          <div
            className="rounded-lg p-2.5 text-xs space-y-1"
            style={{ background: "var(--panel2)", border: "1px solid var(--border)" }}
          >
            <div className="flex items-center justify-between text-[11px]" style={{ color: "var(--muted)" }}>
              <span>Folder scope:</span>
              <span className="font-medium" style={{ color: "var(--accent)" }}>{activeFolderNames}</span>
            </div>
            <div className="flex items-center justify-between text-[11px]" style={{ color: "var(--muted)" }}>
              <span>Selection:</span>
              <span className="font-medium" style={{ color: selectedNodeIds.size > 0 ? "var(--accent)" : "var(--text)" }}>
                {selectedNodeIds.size > 0 ? `${selectedNodeIds.size} entities selected` : "Entire graph"}
              </span>
            </div>
          </div>

          {/* Selected items list */}
          {selectedNodeIds.size > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium" style={{ color: "var(--text)" }}>
                  Selected Entities ({selectedNodeIds.size})
                </span>
                <div className="flex gap-1 text-[11px]">
                  <button
                    onClick={focusSelection}
                    className="rounded px-1.5 py-0.5"
                    style={{ color: "var(--ok)", background: "transparent", border: "1px solid var(--border)", cursor: "pointer" }}
                  >
                    Focus
                  </button>
                  <button
                    disabled={deleting}
                    onClick={deleteSelected}
                    className="rounded px-1.5 py-0.5"
                    style={{ color: "var(--danger)", background: "transparent", border: "1px solid var(--border)", cursor: "pointer" }}
                  >
                    {deleting ? "…" : "Delete"}
                  </button>
                  <button
                    onClick={() => setSelectedNodeIds(new Set())}
                    className="rounded px-1.5 py-0.5"
                    style={{ color: "var(--muted)", background: "transparent", border: "1px solid var(--border)", cursor: "pointer" }}
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                {selectedNodesList.map((n: any) => (
                  <div
                    key={n.id}
                    className="flex items-center justify-between rounded px-2 py-1 text-xs"
                    style={{ background: "var(--input-bg)", border: "1px solid var(--border)" }}
                  >
                    <span className="truncate font-medium" style={{ color: "var(--text)" }}>{n.label}</span>
                    <span className="shrink-0 text-[10px]" style={{ color: "var(--muted)" }}>{n.node_type}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-lg p-2.5 text-[11px] leading-relaxed" style={{ background: "var(--input-bg)", color: "var(--muted)", border: "1px dashed var(--border)" }}>
              Tip: Shift + Drag on canvas or click graph nodes to select specific graph parts to query!
            </div>
          )}

          {/* Direct Graph Query Box */}
          <div className="space-y-2">
            <label className="block text-xs font-medium" style={{ color: "var(--text)" }}>
              Ask question about {selectedNodeIds.size > 0 ? `${selectedNodeIds.size} selected entities` : "this graph"}:
            </label>
            <textarea
              rows={3}
              value={panelInput}
              onChange={(e) => setPanelInput(e.target.value)}
              placeholder={
                selectedNodeIds.size > 0
                  ? `e.g. What connects ${selectedNodesList.slice(0, 2).map((n: any) => n.label).join(" and ")}?`
                  : "e.g. Summarize the main entity relationships in this graph..."
              }
              className="w-full rounded-lg p-2.5 text-xs outline-none"
              style={{ background: "var(--input-bg)", color: "var(--text)", border: "1px solid var(--border)", resize: "vertical", fontFamily: "inherit" }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleGraphQuery(panelInput);
                }
              }}
            />

            {/* Quick Prompt Pills */}
            <div className="flex flex-wrap gap-1 text-[10px]">
              <button
                type="button"
                onClick={() => handleGraphQuery("Summarize key relationships and entities here.")}
                className="rounded px-2 py-1 transition"
                style={{ background: "var(--panel2)", color: "var(--muted)", border: "1px solid var(--border)", cursor: "pointer" }}
              >
                💡 Summarize
              </button>
              <button
                type="button"
                onClick={() => handleGraphQuery("What are the main insights and facts connecting these nodes?")}
                className="rounded px-2 py-1 transition"
                style={{ background: "var(--panel2)", color: "var(--muted)", border: "1px solid var(--border)", cursor: "pointer" }}
              >
                💡 Key Insights
              </button>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => handleGraphQuery(panelInput)}
                disabled={panelAnswering || !panelInput.trim()}
                className="flex-1 rounded-lg py-2 text-xs font-medium text-white transition disabled:opacity-50"
                style={{ background: "var(--accent)", border: "none", cursor: panelAnswering || !panelInput.trim() ? "not-allowed" : "pointer" }}
              >
                {panelAnswering ? "Querying Graph…" : "Query Graph"}
              </button>
              <button
                type="button"
                onClick={copyNodesToChatAndSwitch}
                className="rounded-lg px-2.5 py-2 text-xs"
                style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--muted)", cursor: "pointer" }}
                title="Transfer graph context to Chat view"
              >
                Export to Chat
              </button>
            </div>
          </div>

          {/* AI Response Output */}
          {panelAnswering && (
            <div className="rounded-lg p-3 text-xs" style={{ background: "var(--panel2)", color: "var(--muted)", border: "1px solid var(--border)" }}>
              Thinking and analyzing graph connections…
            </div>
          )}

          {panelError && (
            <div className="rounded-lg p-3 text-xs" style={{ background: "rgba(239,68,68,0.1)", color: "var(--danger)", border: "1px solid var(--danger)" }}>
              Query failed: {panelError}
            </div>
          )}

          {panelAnswer && (
            <div className="rounded-lg p-3 text-xs space-y-2" style={{ background: "var(--panel2)", border: "1px solid var(--border)" }}>
              <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--accent)" }}>
                Answer
              </div>
              <div className="whitespace-pre-wrap text-xs" style={{ color: "var(--text)" }}>
                {panelAnswer.text}
              </div>
              {panelAnswer.citations.length > 0 && (
                <div className="pt-2 text-[10px]" style={{ color: "var(--muted)", borderTop: "1px solid var(--border)" }}>
                  Sources: {panelAnswer.citations.map((c) => c.window_title || c.app).join(", ")}
                </div>
              )}
            </div>
          )}
        </aside>
      )}

      {/* ── Add Node Modal ─────────────────────────────────────────────── */}
      {modal === "addNode" && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
          onClick={() => setModal(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: 14,
              padding: 24,
              width: 360,
              maxWidth: "90%",
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 15, color: "var(--text)", marginBottom: 16 }}>
              Add entity
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>Name *</label>
                <input
                  autoFocus
                  style={inputStyle}
                  value={newNodeName}
                  onChange={(e) => setNewNodeName(e.target.value)}
                  placeholder="e.g. Acme Corp"
                  onKeyDown={(e) => { if (e.key === "Enter") submitAddNode(); }}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>Type</label>
                <input
                  style={inputStyle}
                  value={newNodeType}
                  onChange={(e) => setNewNodeType(e.target.value)}
                  placeholder="Entity"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>Summary</label>
                <input
                  style={inputStyle}
                  value={newNodeSummary}
                  onChange={(e) => setNewNodeSummary(e.target.value)}
                  placeholder="Optional description"
                  onKeyDown={(e) => { if (e.key === "Enter") submitAddNode(); }}
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setModal(null)}
                className="rounded-lg px-4 py-2 text-xs"
                style={{ color: "var(--muted)", border: "1px solid var(--border)", background: "transparent", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                onClick={submitAddNode}
                disabled={saving || !newNodeName.trim()}
                className="rounded-lg px-4 py-2 text-xs font-medium text-white"
                style={{
                  background: saving || !newNodeName.trim() ? "var(--muted)" : "var(--accent)",
                  border: "none",
                  cursor: saving || !newNodeName.trim() ? "not-allowed" : "pointer",
                }}
              >
                {saving ? "Adding…" : "Add entity"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Edge Modal ─────────────────────────────────────────────── */}
      {modal === "addEdge" && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
          onClick={() => setModal(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: 14,
              padding: 24,
              width: 400,
              maxWidth: "90%",
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 15, color: "var(--text)", marginBottom: 16 }}>
              Add relationship
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>From entity *</label>
                <select
                  style={{ ...inputStyle, cursor: "pointer" }}
                  value={edgeSourceId}
                  onChange={(e) => setEdgeSourceId(e.target.value)}
                >
                  <option value="">Select entity…</option>
                  {(data.nodes || []).map((n) => (
                    <option key={n.id} value={n.id}>{n.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>To entity *</label>
                <select
                  style={{ ...inputStyle, cursor: "pointer" }}
                  value={edgeTargetId}
                  onChange={(e) => setEdgeTargetId(e.target.value)}
                >
                  <option value="">Select entity…</option>
                  {(data.nodes || []).map((n) => (
                    <option key={n.id} value={n.id}>{n.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>Relationship name *</label>
                <input
                  style={inputStyle}
                  value={edgeName}
                  onChange={(e) => setEdgeName(e.target.value)}
                  placeholder="e.g. OWNS, WORKS_AT, LEADS"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>Fact / detail</label>
                <input
                  style={inputStyle}
                  value={edgeFact}
                  onChange={(e) => setEdgeFact(e.target.value)}
                  placeholder="Optional detail about this relationship"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setModal(null)}
                className="rounded-lg px-4 py-2 text-xs"
                style={{ color: "var(--muted)", border: "1px solid var(--border)", background: "transparent", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                onClick={submitAddEdge}
                disabled={saving || !edgeSourceId || !edgeTargetId || !edgeName.trim()}
                className="rounded-lg px-4 py-2 text-xs font-medium text-white"
                style={{
                  background: saving || !edgeSourceId || !edgeTargetId || !edgeName.trim() ? "var(--muted)" : "var(--accent)",
                  border: "none",
                  cursor: saving || !edgeSourceId || !edgeTargetId || !edgeName.trim() ? "not-allowed" : "pointer",
                }}
              >
                {saving ? "Adding…" : "Add relationship"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
