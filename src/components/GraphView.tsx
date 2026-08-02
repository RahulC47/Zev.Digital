import { useMemo, useRef, useState, useEffect, useCallback } from "react";
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

  // selection state
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [selEdge, setSelEdge] = useState<SelEdge>(null);
  const [rectSel, setRectSel] = useState<RectSel>(null);
  const [deleting, setDeleting] = useState(false);

  // subgraph filter
  const [subgraphIds, setSubgraphIds] = useState<Set<string> | null>(null);

  // hover
  const [hoveredNode, setHoveredNode] = useState<any>(null);

  // search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // highlighted type from legend click
  const [highlightedType, setHighlightedType] = useState<string | null>(null);

  // Querying Panel state
  const [queryPanelOpen, setQueryPanelOpen] = useState(true);
  const [panelInput, setPanelInput] = useState("");
  const [panelAnswering, setPanelAnswering] = useState(false);
  const [panelAnswer, setPanelAnswer] = useState<Answer | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);

  // modal state
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

  // Theme colors
  useEffect(() => {
    function updateColors() {
      setGraphBg(getCSSVar("--bg") || "#0b0f17");
      setLabelColor(getCSSVar("--text") || "#cdd3e0");
    }
    updateColors();
    const obs = new MutationObserver(updateColors);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  // Responsive sizing
  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) =>
      setSize({ w: e.contentRect.width, h: e.contentRect.height })
    );
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [queryPanelOpen]);

  // Close search dropdown on outside click
  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  // Color-code nodes by type
  const colorByType = useMemo(() => {
    const types = [...new Set((data.nodes || []).map((n) => n.node_type))];
    const map: Record<string, string> = {};
    types.forEach((t, i) => (map[t] = COLORS[i % COLORS.length]));
    return map;
  }, [data]);

  // Degree map for proportional sizing
  const degreeMap = useMemo(() => {
    const map: Record<string, number> = {};
    (data.nodes || []).forEach((n) => (map[n.id] = 0));
    (data.links || []).forEach((l) => {
      const src = typeof l.source === "object" ? (l.source as any).id : l.source;
      const tgt = typeof l.target === "object" ? (l.target as any).id : l.target;
      if (src) map[src] = (map[src] || 0) + 1;
      if (tgt) map[tgt] = (map[tgt] || 0) + 1;
    });
    return map;
  }, [data]);

  // Node radius based on degree
  const nodeRadius = useCallback((nodeId: string) => {
    const deg = degreeMap[nodeId] || 0;
    return 5 + Math.min(deg * 1.5, 12);
  }, [degreeMap]);

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

  // Search results
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return graph.nodes
      .filter((n: any) =>
        n.label?.toLowerCase().includes(q) ||
        n.node_type?.toLowerCase().includes(q) ||
        n.summary?.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [searchQuery, graph.nodes]);

  // Active nodes based on search / highlight
  const dimmedNodeIds = useMemo(() => {
    if (searchQuery.trim() && searchResults.length > 0) {
      const matchIds = new Set(searchResults.map((n: any) => n.id));
      return new Set(graph.nodes.filter((n: any) => !matchIds.has(n.id)).map((n: any) => n.id));
    }
    if (highlightedType) {
      return new Set(graph.nodes.filter((n: any) => n.node_type !== highlightedType).map((n: any) => n.id));
    }
    return new Set<string>();
  }, [searchQuery, searchResults, highlightedType, graph.nodes]);

  // Unique entity types in graph for legend
  const entityTypes = useMemo(() => {
    return [...new Set(graph.nodes.map((n: any) => n.node_type).filter(Boolean))];
  }, [graph.nodes]);

  const activeFolderNames = "Entire Brain";

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

  // ── Zoom to a specific node ───────────────────────────────────────────────
  function zoomToNode(node: any) {
    if (!fgRef.current || node.x == null) return;
    fgRef.current.centerAt(node.x, node.y, 800);
    fgRef.current.zoom(7, 800);
  }

  function selectAndZoomNode(node: any) {
    setSelectedNodeIds(new Set([node.id]));
    setSearchQuery("");
    setSearchDropdownOpen(false);
    setHighlightedType(null);
    // Slight delay to let graph stabilize
    setTimeout(() => zoomToNode(node), 100);
  }

  // ── Zoom controls ─────────────────────────────────────────────────────────
  function zoomIn() { if (fgRef.current) fgRef.current.zoom(fgRef.current.zoom() * 1.4, 300); }
  function zoomOut() { if (fgRef.current) fgRef.current.zoom(fgRef.current.zoom() / 1.4, 300); }
  function zoomFit() { if (fgRef.current) fgRef.current.zoomToFit(400, 40); }

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

  // ── Canvas render callbacks ───────────────────────────────────────────────

  const nodeCanvasObject = useCallback((node: any, ctx: CanvasRenderingContext2D, scale: number) => {
    if (node.x == null || node.y == null) return;
    const isSelected = selectedNodeIds.has(node.id);
    const isHovered = hoveredNode?.id === node.id;
    const isDimmed = dimmedNodeIds.has(node.id);
    const r = nodeRadius(node.id);
    const color = colorByType[node.node_type] || "#5b8cff";

    ctx.globalAlpha = isDimmed ? 0.15 : 1;

    // Glow effect for selected nodes
    if (isSelected) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 16;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 4, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Hover ring
    if (isHovered && !isSelected) {
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 3, 0, 2 * Math.PI);
      ctx.stroke();
    }

    // Node circle
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    ctx.fill();

    // Inner highlight (gives depth)
    const grad = ctx.createRadialGradient(node.x - r * 0.3, node.y - r * 0.3, r * 0.05, node.x, node.y, r);
    grad.addColorStop(0, "rgba(255,255,255,0.35)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    ctx.fill();

    // Label — always show when selected or hovered, otherwise scale-dependent
    const label = node.label || "";
    const showLabel = isSelected || isHovered || scale > 1.5;
    if (showLabel && label) {
      const safeScale = Math.max(scale, 0.001);
      const fs = Math.max(10, Math.min(14, 12 / safeScale));
      ctx.font = `${isSelected ? "600 " : ""}${fs}px -apple-system, system-ui, sans-serif`;
      ctx.fillStyle = labelColor;
      ctx.shadowColor = "rgba(0,0,0,0.8)";
      ctx.shadowBlur = 3;
      ctx.fillText(label, node.x + r + 2, node.y + fs / 3);
      ctx.shadowBlur = 0;
    }

    ctx.globalAlpha = 1;
  }, [selectedNodeIds, hoveredNode, dimmedNodeIds, nodeRadius, colorByType, labelColor]);

  const linkCanvasObject = useCallback((link: any, ctx: CanvasRenderingContext2D, scale: number) => {
    const src = link.source;
    const tgt = link.target;
    if (!src || !tgt || src.x == null || tgt.x == null) return;

    const theme = document.documentElement.dataset.theme;
    const lc = theme === "light" ? "rgba(80,90,120,0.25)" : "rgba(150,160,190,0.3)";
    const safeScale = Math.max(scale, 0.001);

    // Draw link line
    ctx.strokeStyle = lc;
    ctx.lineWidth = 1 / safeScale;
    ctx.beginPath();
    ctx.moveTo(src.x, src.y);
    ctx.lineTo(tgt.x, tgt.y);
    ctx.stroke();

    // Arrow
    const dx = tgt.x - src.x;
    const dy = tgt.y - src.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return;
    const ux = dx / dist, uy = dy / dist;
    const tgtR = nodeRadius(tgt.id || "");
    const arrowX = tgt.x - ux * (tgtR + 4 / safeScale);
    const arrowY = tgt.y - uy * (tgtR + 4 / safeScale);
    const arrowLen = 6 / safeScale;
    const arrowAngle = 0.45;
    ctx.fillStyle = lc;
    ctx.beginPath();
    ctx.moveTo(arrowX, arrowY);
    ctx.lineTo(
      arrowX - arrowLen * (ux * Math.cos(arrowAngle) - uy * Math.sin(arrowAngle)),
      arrowY - arrowLen * (uy * Math.cos(arrowAngle) + ux * Math.sin(arrowAngle))
    );
    ctx.lineTo(
      arrowX - arrowLen * (ux * Math.cos(arrowAngle) + uy * Math.sin(arrowAngle)),
      arrowY - arrowLen * (uy * Math.cos(arrowAngle) - ux * Math.sin(arrowAngle))
    );
    ctx.closePath();
    ctx.fill();

    // Edge label — show when zoomed in enough
    const name = link.name || "";
    if (name && scale > 1.2) {
      const midX = (src.x + tgt.x) / 2;
      const midY = (src.y + tgt.y) / 2;
      const fs = Math.max(7, 10 / safeScale);
      ctx.font = `${fs}px -apple-system, system-ui, sans-serif`;
      const textW = ctx.measureText(name).width;

      // Label background pill
      ctx.fillStyle = theme === "light" ? "rgba(241,245,249,0.9)" : "rgba(13,19,32,0.85)";
      ctx.beginPath();
      const pad = 2 / safeScale;
      const rx = midX - textW / 2 - pad;
      const ry = midY - fs / 2 - pad;
      const rw = textW + pad * 2;
      const rh = fs + pad * 2;
      const radVal = 3 / safeScale;
      if (typeof (ctx as any).roundRect === "function") {
        (ctx as any).roundRect(rx, ry, rw, rh, radVal);
      } else {
        ctx.rect(rx, ry, rw, rh);
      }
      ctx.fill();

      ctx.fillStyle = theme === "light" ? "rgba(100,116,139,0.9)" : "rgba(139,147,167,0.9)";
      ctx.textAlign = "center";
      ctx.fillText(name, midX, midY + fs * 0.35);
      ctx.textAlign = "left";
    }
  }, [nodeRadius]);

  // ── Hover tooltip ─────────────────────────────────────────────────────────
  // We render a DOM tooltip (not canvas) for crisp text and emoji
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  function onNodeHover(node: any, _prev: any) {
    setHoveredNode(node || null);
    if (!node) { setTooltipPos(null); return; }
    if (!fgRef.current || node.x == null) return;
    const sc = fgRef.current.graph2ScreenCoords(node.x, node.y);
    const wrapRect = wrap.current?.getBoundingClientRect();
    if (wrapRect) {
      setTooltipPos({ x: sc.x + 14, y: sc.y - 10 });
    }
  }

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
              nodeLabel={() => ""}
              linkLabel={() => ""}
              linkColor={() => "transparent"}
              linkDirectionalArrowLength={0}
              cooldownTime={1800}
              d3VelocityDecay={0.3}
              d3AlphaDecay={0.02}
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
              onNodeHover={onNodeHover}
              onLinkClick={(link: any) => {
                setSelEdge({ id: link.id, name: link.name || "", fact: link.fact || "" });
              }}
              onBackgroundClick={() => {
                setSelectedNodeIds(new Set());
                setSelEdge(null);
                setHighlightedType(null);
              }}
              nodeCanvasObject={nodeCanvasObject}
              nodeCanvasObjectMode={() => "replace"}
              linkCanvasObject={linkCanvasObject}
              linkCanvasObjectMode={() => "replace"}
            />

            {/* ── Entity Search Bar ──────────────────────────────────────── */}
            <div
              ref={searchRef}
              className="absolute"
              style={{ top: 12, left: 12, width: 240, zIndex: 30 }}
            >
              <div style={{ position: "relative" }}>
                <div
                  style={{
                    position: "absolute",
                    left: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--muted)",
                    fontSize: 13,
                    pointerEvents: "none",
                  }}
                >
                  🔍
                </div>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setSearchDropdownOpen(true);
                  }}
                  onFocus={() => setSearchDropdownOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") { setSearchQuery(""); setSearchDropdownOpen(false); setHighlightedType(null); }
                    if (e.key === "Enter" && searchResults.length > 0) selectAndZoomNode(searchResults[0]);
                  }}
                  placeholder="Find entity…"
                  style={{
                    width: "100%",
                    background: "var(--panel)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: "7px 10px 7px 32px",
                    fontSize: 12,
                    outline: "none",
                    boxShadow: "0 2px 12px rgba(0,0,0,0.25)",
                    backdropFilter: "blur(8px)",
                  }}
                />
                {searchQuery && (
                  <button
                    onClick={() => { setSearchQuery(""); setSearchDropdownOpen(false); }}
                    style={{
                      position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                      background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 13,
                    }}
                  >✕</button>
                )}
              </div>

              {/* Autocomplete Dropdown */}
              {searchDropdownOpen && searchResults.length > 0 && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    left: 0,
                    right: 0,
                    background: "var(--panel)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
                    overflow: "hidden",
                    zIndex: 50,
                  }}
                >
                  {searchResults.map((n: any, i: number) => (
                    <button
                      key={n.id}
                      onClick={() => selectAndZoomNode(n)}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 12px",
                        background: i === 0 ? "rgba(91,140,255,0.08)" : "transparent",
                        border: "none",
                        borderBottom: i < searchResults.length - 1 ? "1px solid var(--border)" : "none",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: colorByType[n.node_type] || "#5b8cff",
                          flexShrink: 0,
                        }}
                      />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {n.label}
                        </div>
                        {n.summary && (
                          <div style={{ fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {n.summary}
                          </div>
                        )}
                      </div>
                      <span
                        style={{
                          fontSize: 9,
                          padding: "2px 5px",
                          borderRadius: 4,
                          background: `${colorByType[n.node_type] || "#5b8cff"}22`,
                          color: colorByType[n.node_type] || "#5b8cff",
                          flexShrink: 0,
                          fontWeight: 600,
                          letterSpacing: "0.03em",
                        }}
                      >
                        {n.node_type}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

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
                className="absolute flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs shadow"
                style={{
                  top: 12,
                  left: "50%",
                  transform: "translateX(-50%)",
                  background: "rgba(91,140,255,0.15)",
                  border: "1px solid var(--accent)",
                  color: "var(--accent)",
                  zIndex: 20,
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
            <div className="absolute top-3 right-3 flex items-center gap-2" style={{ zIndex: 20 }}>
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
                🔍 Query {selectedNodeIds.size > 0 && `(${selectedNodeIds.size})`}
              </button>
            </div>

            {/* ── Type Legend (bottom-left) ──────────────────────────────── */}
            {entityTypes.length > 0 && (
              <div
                className="absolute flex flex-wrap items-center gap-1.5"
                style={{
                  bottom: selEdge ? 90 : 14,
                  left: 14,
                  maxWidth: "55%",
                  zIndex: 20,
                  background: "var(--panel)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "6px 10px",
                  boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
                }}
              >
                <span style={{ fontSize: 9, color: "var(--muted)", marginRight: 2, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>Types</span>
                {entityTypes.map((type) => (
                  <button
                    key={type}
                    onClick={() => setHighlightedType(highlightedType === type ? null : type)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      background: highlightedType === type ? `${colorByType[type]}22` : "transparent",
                      border: highlightedType === type ? `1px solid ${colorByType[type]}` : "1px solid transparent",
                      borderRadius: 6,
                      padding: "2px 6px",
                      cursor: "pointer",
                    }}
                    title={`Highlight all ${type} entities`}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: colorByType[type] || "#5b8cff", flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: highlightedType === type ? colorByType[type] : "var(--muted)", fontWeight: highlightedType === type ? 600 : 400 }}>{type}</span>
                  </button>
                ))}
              </div>
            )}

            {/* ── Zoom Controls (bottom-right) ───────────────────────────── */}
            <div
              className="absolute flex flex-col gap-1"
              style={{ bottom: 14, right: queryPanelOpen ? 14 : 14, zIndex: 20 }}
            >
              {[
                { label: "+", action: zoomIn, title: "Zoom in" },
                { label: "−", action: zoomOut, title: "Zoom out" },
                { label: "⊞", action: zoomFit, title: "Fit all nodes" },
              ].map(({ label, action, title }) => (
                <button
                  key={label}
                  onClick={action}
                  title={title}
                  style={{
                    width: 30,
                    height: 30,
                    background: "var(--panel)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--text)",
                    fontSize: 16,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* ── Hover Tooltip ─────────────────────────────────────────── */}
            {hoveredNode && tooltipPos && (
              <div
                style={{
                  position: "absolute",
                  left: Math.min(tooltipPos.x, size.w - 220),
                  top: Math.max(tooltipPos.y, 10),
                  background: "var(--panel)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "8px 12px",
                  boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
                  pointerEvents: "none",
                  zIndex: 40,
                  maxWidth: 210,
                  backdropFilter: "blur(8px)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: colorByType[hoveredNode.node_type] || "#5b8cff", flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{hoveredNode.label}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: hoveredNode.summary ? 6 : 0 }}>
                  <span style={{
                    fontSize: 9, padding: "1px 5px", borderRadius: 4,
                    background: `${colorByType[hoveredNode.node_type] || "#5b8cff"}22`,
                    color: colorByType[hoveredNode.node_type] || "#5b8cff",
                    fontWeight: 600, letterSpacing: "0.03em",
                  }}>
                    {hoveredNode.node_type}
                  </span>
                  <span style={{ fontSize: 9, color: "var(--muted)" }}>
                    {degreeMap[hoveredNode.id] || 0} connection{degreeMap[hoveredNode.id] !== 1 ? "s" : ""}
                  </span>
                </div>
                {hoveredNode.summary && (
                  <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.4 }}>
                    {hoveredNode.summary.slice(0, 120)}{hoveredNode.summary.length > 120 ? "…" : ""}
                  </div>
                )}
              </div>
            )}

            {/* Bottom edge detail pill */}
            {selEdge && (
              <div
                className="absolute bottom-4 z-40 rounded-xl p-3 shadow-lg"
                style={{ background: "var(--panel)", border: "1px solid var(--border)", maxWidth: 450, left: "50%", transform: "translateX(-50%)" }}
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
              <span>Graph scope:</span>
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
                    <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: colorByType[n.node_type] || "#5b8cff", flexShrink: 0 }} />
                      <span className="truncate font-medium" style={{ color: "var(--text)" }}>{n.label}</span>
                    </div>
                    <span className="shrink-0 text-[10px]" style={{ color: "var(--muted)" }}>{n.node_type}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={copyNodesToChatAndSwitch}
                className="w-full rounded-lg py-1.5 text-xs"
                style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--muted)", cursor: "pointer" }}
                title="Transfer graph context to Chat view"
              >
                Export to Chat
              </button>
            </div>
          ) : (
            <div className="rounded-lg p-2.5 text-[11px] leading-relaxed" style={{ background: "var(--input-bg)", color: "var(--muted)", border: "1px dashed var(--border)" }}>
              💡 Tip: Use the search bar to find entities. Shift + Drag or click nodes to select.
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
              {selectedNodeIds.size === 0 && (
                <button
                  type="button"
                  onClick={copyNodesToChatAndSwitch}
                  className="rounded-lg px-2.5 py-2 text-xs"
                  style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--muted)", cursor: "pointer" }}
                  title="Transfer graph context to Chat view"
                >
                  Export to Chat
                </button>
              )}
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
