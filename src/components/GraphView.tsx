import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { api, type GraphData, type Answer } from "../lib/api";
import { useStore } from "../store/useStore";

type SelEdge = { id: string; name: string; fact: string } | null;
type RectSel = { x: number; y: number; w: number; h: number } | null;
type Modal = "addNode" | "addEdge" | null;
type PathResult = { nodeIds: Set<string>; linkIds: Set<string> } | null;

const COLORS = ["#5b8cff", "#7c5cff", "#34d399", "#f59e0b", "#ff5b6e", "#22d3ee", "#e879f9", "#fb923c", "#4ade80"];

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
  // ── Refs ──────────────────────────────────────────────────────────────────
  const wrap = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const lastClickRef = useRef<{ nodeId: string; time: number } | null>(null);
  const [size, setSize] = useState({ w: 700, h: 600 });
  const [labelColor, setLabelColor] = useState("#cdd3e0");

  // ── Selection & interaction state ─────────────────────────────────────────
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [selEdge, setSelEdge] = useState<SelEdge>(null);
  const [rectSel, setRectSel] = useState<RectSel>(null);
  const [deleting, setDeleting] = useState(false);

  // subgraph filter
  const [subgraphIds, setSubgraphIds] = useState<Set<string> | null>(null);

  // hover
  const [hoveredNode, setHoveredNode] = useState<any>(null);
  const [hoveredLink, setHoveredLink] = useState<any>(null);

  // search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // type highlight from legend click
  const [highlightedType, setHighlightedType] = useState<string | null>(null);

  // query panel
  const [queryPanelOpen, setQueryPanelOpen] = useState(true);
  const [panelInput, setPanelInput] = useState("");
  const [panelAnswering, setPanelAnswering] = useState(false);
  const [panelAnswer, setPanelAnswer] = useState<Answer | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);

  // modals
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

  // ── NEW state ─────────────────────────────────────────────────────────────
  const [detailNode, setDetailNode] = useState<any>(null);     // node detail drawer
  const [showAllLabels, setShowAllLabels] = useState(false);   // force-show all labels
  const [showMinimap, setShowMinimap] = useState(false);       // mini-map toggle
  const [showShortcuts, setShowShortcuts] = useState(false);   // shortcuts overlay
  const [statsExpanded, setStatsExpanded] = useState(false);   // stats bar expand
  const [highlightedPath, setHighlightedPath] = useState<PathResult>(null); // path highlight

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

  // ── Theme colors ──────────────────────────────────────────────────────────
  useEffect(() => {
    function updateColors() {
      setLabelColor(getCSSVar("--text") || "#cdd3e0");
    }
    updateColors();
    const obs = new MutationObserver(updateColors);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  // ── Responsive sizing ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) =>
      setSize({ w: e.contentRect.width, h: e.contentRect.height })
    );
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [queryPanelOpen, detailNode]);

  // ── Search dropdown outside-click close ───────────────────────────────────
  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node))
        setSearchDropdownOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  // ── Color-code nodes by type ───────────────────────────────────────────────
  const colorByType = useMemo(() => {
    const types = [...new Set((data.nodes || []).map((n) => n.node_type))];
    const map: Record<string, string> = {};
    types.forEach((t, i) => (map[t] = COLORS[i % COLORS.length]));
    return map;
  }, [data]);

  // ── Degree map for proportional sizing ────────────────────────────────────
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

  const nodeRadius = useCallback((nodeId: string) => {
    const deg = degreeMap[nodeId] || 0;
    return 6 + Math.min(deg * 1.5, 14);
  }, [degreeMap]);

  // ── Clone + filter for subgraph view ─────────────────────────────────────
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

  // ── Search results ────────────────────────────────────────────────────────
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

  // ── Dimmed node ids ────────────────────────────────────────────────────────
  const dimmedNodeIds = useMemo(() => {
    if (highlightedPath) {
      return new Set(graph.nodes.filter((n: any) => !highlightedPath.nodeIds.has(n.id)).map((n: any) => n.id));
    }
    if (searchQuery.trim() && searchResults.length > 0) {
      const matchIds = new Set(searchResults.map((n: any) => n.id));
      return new Set(graph.nodes.filter((n: any) => !matchIds.has(n.id)).map((n: any) => n.id));
    }
    if (highlightedType) {
      return new Set(graph.nodes.filter((n: any) => n.node_type !== highlightedType).map((n: any) => n.id));
    }
    return new Set<string>();
  }, [searchQuery, searchResults, highlightedType, highlightedPath, graph.nodes]);

  // ── Entity types for legend ───────────────────────────────────────────────
  const entityTypes = useMemo(() =>
    [...new Set(graph.nodes.map((n: any) => n.node_type).filter(Boolean))],
    [graph.nodes]
  );

  // ── Graph stats ───────────────────────────────────────────────────────────
  const graphStats = useMemo(() => {
    const typeCount: Record<string, number> = {};
    graph.nodes.forEach((n: any) => { typeCount[n.node_type] = (typeCount[n.node_type] || 0) + 1; });
    const sorted = Object.entries(degreeMap).sort((a, b) => b[1] - a[1]);
    const hubNode = sorted[0] ? graph.nodes.find((n: any) => n.id === sorted[0][0]) : null;
    const isolated = graph.nodes.filter((n: any) => (degreeMap[n.id] || 0) === 0).length;
    return { typeCount, hubNode, isolated, total: graph.nodes.length, edges: graph.links.length };
  }, [graph, degreeMap]);

  // ── Detail node connections ───────────────────────────────────────────────
  const detailNodeConnections = useMemo(() => {
    if (!detailNode) return [];
    return graph.links
      .map((l: any) => {
        const srcId = typeof l.source === "object" ? l.source.id : l.source;
        const tgtId = typeof l.target === "object" ? l.target.id : l.target;
        if (srcId === detailNode.id) {
          return { dir: "out" as const, node: graph.nodes.find((n: any) => n.id === tgtId), link: l };
        }
        if (tgtId === detailNode.id) {
          return { dir: "in" as const, node: graph.nodes.find((n: any) => n.id === srcId), link: l };
        }
        return null;
      })
      .filter(Boolean);
  }, [detailNode, graph]);

  const activeFolderNames = "Entire Brain";

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditable = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      // Focus search: "/" or Ctrl+F
      if (!isEditable && (e.key === "/" || (e.ctrlKey && e.key === "f"))) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      // Escape: clear panels in priority order
      if (e.key === "Escape") {
        if (showShortcuts) { setShowShortcuts(false); return; }
        if (detailNode) { setDetailNode(null); return; }
        if (searchQuery) { setSearchQuery(""); setSearchDropdownOpen(false); return; }
        setSelectedNodeIds(new Set());
        setSelEdge(null);
        setHighlightedType(null);
        setHighlightedPath(null);
        return;
      }
      // Delete selected nodes
      if (e.key === "Delete" && selectedNodeIds.size > 0 && !isEditable) {
        e.preventDefault();
        deleteSelected();
        return;
      }
      // Select all visible nodes
      if ((e.ctrlKey || e.metaKey) && e.key === "a" && !isEditable) {
        e.preventDefault();
        setSelectedNodeIds(new Set(graph.nodes.map((n: any) => n.id)));
        return;
      }
      // Fit to screen
      if (e.key === "f" && !isEditable && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (fgRef.current) fgRef.current.zoomToFit(400, 40);
        return;
      }
      // Zoom
      if ((e.key === "=" || e.key === "+") && !isEditable) { e.preventDefault(); if (fgRef.current) fgRef.current.zoom(fgRef.current.zoom() * 1.4, 300); }
      if (e.key === "-" && !isEditable) { e.preventDefault(); if (fgRef.current) fgRef.current.zoom(fgRef.current.zoom() / 1.4, 300); }
      // Shortcuts overlay
      if (e.key === "?" && !isEditable) setShowShortcuts((s) => !s);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedNodeIds, graph.nodes, detailNode, showShortcuts, searchQuery]);

  // ── Mini-map rAF draw loop ────────────────────────────────────────────────
  useEffect(() => {
    if (!showMinimap) return;
    let animId: number;

    const draw = () => {
      const canvas = minimapRef.current;
      const fg = fgRef.current;
      if (!canvas || !fg) { animId = requestAnimationFrame(draw); return; }
      const ctx = canvas.getContext("2d");
      if (!ctx) { animId = requestAnimationFrame(draw); return; }
      const W = canvas.width, H = canvas.height;
      const isDark = document.documentElement.dataset.theme !== "light";

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = isDark ? "rgba(9,13,22,0.92)" : "rgba(248,250,252,0.92)";
      ctx.fillRect(0, 0, W, H);

      const nodes = graph.nodes.filter((n: any) => n.x != null && n.y != null);
      if (nodes.length === 0) { animId = requestAnimationFrame(draw); return; }

      let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity;
      nodes.forEach((n: any) => { mnX = Math.min(mnX, n.x); mxX = Math.max(mxX, n.x); mnY = Math.min(mnY, n.y); mxY = Math.max(mxY, n.y); });
      const rng = Math.max(mxX - mnX, mxY - mnY, 1);
      const pad = 8;
      const sc = (Math.min(W, H) - 2 * pad) / rng;
      const ox = pad + (W - 2 * pad - (mxX - mnX) * sc) / 2 - mnX * sc;
      const oy = pad + (H - 2 * pad - (mxY - mnY) * sc) / 2 - mnY * sc;

      // edges
      ctx.strokeStyle = isDark ? "rgba(150,160,200,0.18)" : "rgba(80,90,120,0.12)";
      ctx.lineWidth = 0.5;
      graph.links.forEach((l: any) => {
        const s = typeof l.source === "object" ? l.source : nodes.find((n: any) => n.id === l.source);
        const t = typeof l.target === "object" ? l.target : nodes.find((n: any) => n.id === l.target);
        if (!s?.x || !t?.x) return;
        ctx.beginPath(); ctx.moveTo(s.x * sc + ox, s.y * sc + oy); ctx.lineTo(t.x * sc + ox, t.y * sc + oy); ctx.stroke();
      });

      // nodes
      nodes.forEach((n: any) => {
        const isPath = highlightedPath?.nodeIds.has(n.id);
        ctx.beginPath(); ctx.arc(n.x * sc + ox, n.y * sc + oy, isPath ? 3 : 2, 0, Math.PI * 2);
        ctx.fillStyle = isPath ? "#f59e0b" : (colorByType[n.node_type] || "#5b8cff");
        ctx.fill();
      });

      // viewport rect
      try {
        const tl = fg.screen2GraphCoords(0, 0);
        const br = fg.screen2GraphCoords(size.w, size.h);
        ctx.strokeStyle = "rgba(91,140,255,0.8)";
        ctx.lineWidth = 1;
        ctx.strokeRect(tl.x * sc + ox, tl.y * sc + oy, (br.x - tl.x) * sc, (br.y - tl.y) * sc);
      } catch { /* not ready yet */ }

      // border
      ctx.strokeStyle = isDark ? "rgba(91,140,255,0.25)" : "rgba(91,140,255,0.2)";
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, [showMinimap, graph, colorByType, size, highlightedPath]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  function nodesInRect(x1: number, y1: number, x2: number, y2: number): string[] {
    if (!fgRef.current) return [];
    const tl = fgRef.current.screen2GraphCoords(Math.min(x1, x2), Math.min(y1, y2));
    const br = fgRef.current.screen2GraphCoords(Math.max(x1, x2), Math.max(y1, y2));
    return graph.nodes
      .filter((n: any) => n.x != null && n.y != null && n.x >= tl.x && n.x <= br.x && n.y >= tl.y && n.y <= br.y)
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

  function zoomToNode(node: any) {
    if (!fgRef.current || node.x == null) return;
    fgRef.current.centerAt(node.x, node.y, 800);
    fgRef.current.zoom(7, 800);
  }

  function selectAndZoomNode(node: any) {
    setSelectedNodeIds(new Set([node.id]));
    setSearchQuery(""); setSearchDropdownOpen(false); setHighlightedType(null);
    setTimeout(() => zoomToNode(node), 100);
  }

  function zoomIn() { if (fgRef.current) fgRef.current.zoom(fgRef.current.zoom() * 1.4, 300); }
  function zoomOut() { if (fgRef.current) fgRef.current.zoom(fgRef.current.zoom() / 1.4, 300); }
  function zoomFit() { if (fgRef.current) fgRef.current.zoomToFit(400, 40); }

  // ── BFS path finder (client-side) ─────────────────────────────────────────
  function findPath(fromId: string, toId: string): PathResult {
    const adj = new Map<string, Array<{ nodeId: string; linkId: string }>>();
    graph.nodes.forEach((n: any) => adj.set(n.id, []));
    graph.links.forEach((l: any) => {
      const s = typeof l.source === "object" ? l.source.id : l.source;
      const t = typeof l.target === "object" ? l.target.id : l.target;
      adj.get(s)?.push({ nodeId: t, linkId: l.id });
      adj.get(t)?.push({ nodeId: s, linkId: l.id }); // undirected search
    });

    const visited = new Set<string>([fromId]);
    const parentMap = new Map<string, { parentId: string; linkId: string }>();
    const queue = [fromId];

    bfs: while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const { nodeId, linkId } of adj.get(curr) || []) {
        if (!visited.has(nodeId)) {
          visited.add(nodeId);
          parentMap.set(nodeId, { parentId: curr, linkId });
          if (nodeId === toId) break bfs;
          queue.push(nodeId);
        }
      }
    }

    if (!parentMap.has(toId)) return null;
    const nodeIds = new Set<string>();
    const linkIds = new Set<string>();
    let curr = toId;
    while (curr !== fromId) {
      nodeIds.add(curr);
      const p = parentMap.get(curr)!;
      linkIds.add(p.linkId);
      curr = p.parentId;
    }
    nodeIds.add(fromId);
    return { nodeIds, linkIds };
  }

  // ── Rubber-band select ────────────────────────────────────────────────────

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
      drag.current.active = true; drag.current.curX = cx; drag.current.curY = cy;
      setRectSel({ x: Math.min(drag.current.startX, cx), y: Math.min(drag.current.startY, cy), w: Math.abs(dx), h: Math.abs(dy) });
    }
  }

  function onMouseUp(_e: React.MouseEvent) {
    if (!drag.current) return;
    if (drag.current.active) setSelectedNodeIds(new Set(nodesInRect(drag.current.startX, drag.current.startY, drag.current.curX, drag.current.curY)));
    setRectSel(null); drag.current = null;
  }

  function onMouseLeave() { setRectSel(null); drag.current = null; }

  // ── Copy to chat ──────────────────────────────────────────────────────────

  function buildGraphContextText(): string {
    const targetNodes = selectedNodeIds.size > 0 ? graph.nodes.filter((n: any) => selectedNodeIds.has(n.id)) : graph.nodes;
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
      lines.push(""); lines.push("Relationships / Facts:");
      for (const e of targetEdges) {
        const src = graph.nodes.find((n: any) => n.id === (typeof e.source === "object" ? (e.source as any).id : e.source));
        const tgt = graph.nodes.find((n: any) => n.id === (typeof e.target === "object" ? (e.target as any).id : e.target));
        lines.push(`${src?.label ?? "?"} —[${(e as any).name || ""}]→ ${tgt?.label ?? "?"}: ${(e as any).fact || ""}`);
      }
    }
    return lines.join("\n");
  }

  function copyNodesToChatAndSwitch() { setGraphContext(buildGraphContextText()); setView("chat"); }

  function copyEdgeToChatAndSwitch(edge: NonNullable<SelEdge>) {
    const link = graph.links.find((l: any) => l.id === edge.id) as any;
    const src = link && graph.nodes.find((n: any) => n.id === (typeof link.source === "object" ? link.source.id : link.source));
    const tgt = link && graph.nodes.find((n: any) => n.id === (typeof link.target === "object" ? link.target.id : link.target));
    setGraphContext(`${src?.label ?? "?"} —[${edge.name}]→ ${tgt?.label ?? "?"}: ${edge.fact}`);
    setView("chat");
  }

  // ── Query panel execution ─────────────────────────────────────────────────

  async function handleGraphQuery(questionText: string) {
    const q = questionText.trim();
    if (!q || panelAnswering) return;
    setPanelAnswering(true); setPanelError(null); setPanelAnswer(null);
    try {
      const graphFacts = buildGraphContextText();
      const answer = await api.ask(`Knowledge Graph Context:\n${graphFacts}\n\nQuestion: ${q}`, selectedCollections);
      setPanelAnswer(answer);
    } catch (e) { setPanelError(String(e)); } finally { setPanelAnswering(false); }
  }

  function focusSelection() { setSubgraphIds(new Set(selectedNodeIds)); setSelectedNodeIds(new Set()); }
  function clearSubgraph() { setSubgraphIds(null); }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  async function submitAddNode() {
    if (!newNodeName.trim()) return;
    setSaving(true);
    try {
      await api.createGraphNode(newNodeName.trim(), newNodeType.trim() || "Entity", newNodeSummary.trim());
      setModal(null); setNewNodeName(""); setNewNodeType("Entity"); setNewNodeSummary("");
      await refreshGraph();
    } catch (e) { alert(`Failed to add node: ${e}`); } finally { setSaving(false); }
  }

  function openAddEdge() {
    if (selectedNodeIds.size === 2) {
      const [a, b] = [...selectedNodeIds]; setEdgeSourceId(a); setEdgeTargetId(b);
    } else { setEdgeSourceId(""); setEdgeTargetId(""); }
    setEdgeName(""); setEdgeFact(""); setModal("addEdge");
  }

  async function submitAddEdge() {
    if (!edgeSourceId || !edgeTargetId || !edgeName.trim()) return;
    setSaving(true);
    try { await api.createGraphEdge(edgeSourceId, edgeTargetId, edgeName.trim(), edgeFact.trim()); setModal(null); await refreshGraph(); }
    catch (e) { alert(`Failed to add relationship: ${e}`); } finally { setSaving(false); }
  }

  async function deleteSelected() {
    const count = selectedNodeIds.size;
    if (!confirm(`Delete ${count} ${count === 1 ? "entity" : "entities"} from the knowledge graph?`)) return;
    setDeleting(true);
    try { for (const id of selectedNodeIds) await api.deleteGraphNode(id); setSelectedNodeIds(new Set()); setSelEdge(null); await refreshGraph(); }
    catch (e) { alert(`Delete failed: ${e}`); } finally { setDeleting(false); }
  }

  async function deleteEdge(id: string) {
    if (!confirm("Delete this relationship from the knowledge graph?")) return;
    setDeleting(true);
    try { await api.deleteGraphEdge(id); setSelEdge(null); await refreshGraph(); }
    catch (e) { alert(`Delete failed: ${e}`); } finally { setDeleting(false); }
  }

  const selectedNodesList = useMemo(() =>
    graph.nodes.filter((n: any) => selectedNodeIds.has(n.id)),
    [graph.nodes, selectedNodeIds]
  );

  // ── Canvas render callbacks ───────────────────────────────────────────────

  const nodeCanvasObject = useCallback((node: any, ctx: CanvasRenderingContext2D, scale: number) => {
    if (node.x == null || node.y == null) return;
    const isSelected = selectedNodeIds.has(node.id);
    const isHovered = hoveredNode?.id === node.id;
    const isDimmed = dimmedNodeIds.has(node.id);
    const isPathNode = highlightedPath?.nodeIds.has(node.id);
    const isConnectedToHover = hoveredNode && !isHovered && (
      graph.links.some((l: any) => {
        const s = typeof l.source === "object" ? l.source.id : l.source;
        const t = typeof l.target === "object" ? l.target.id : l.target;
        return (s === hoveredNode.id && t === node.id) || (t === hoveredNode.id && s === node.id);
      })
    );
    const r = nodeRadius(node.id);
    const color = isPathNode ? "#f59e0b" : (colorByType[node.node_type] || "#5b8cff");

    ctx.globalAlpha = isDimmed ? 0.12 : 1;

    // ── Path node ring ──
    if (isPathNode && !isSelected) {
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(node.x, node.y, r + 4, 0, 2 * Math.PI); ctx.stroke();
    }

    // ── Selected: bright white ring ──
    if (isSelected) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(node.x, node.y, r + 3, 0, 2 * Math.PI); ctx.stroke();
    }

    // ── Hovered: colored ring ──
    if (isHovered && !isSelected) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(node.x, node.y, r + 3, 0, 2 * Math.PI); ctx.stroke();
    }

    // ── Connected-to-hover: subtle colored ring ──
    if (isConnectedToHover && !isSelected) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = isDimmed ? 0.12 : 0.5;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(node.x, node.y, r + 2.5, 0, 2 * Math.PI); ctx.stroke();
      ctx.globalAlpha = isDimmed ? 0.12 : 1;
    }

    // ── Node fill (solid clean circle) ──
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, 2 * Math.PI); ctx.fill();

    // ── Crisp border ring for bubble definition ──
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, 2 * Math.PI); ctx.stroke();

    // ── Inner specular highlight (bubble-like) ──
    const grad = ctx.createRadialGradient(node.x - r * 0.3, node.y - r * 0.35, r * 0.05, node.x, node.y, r);
    grad.addColorStop(0, "rgba(255,255,255,0.35)");
    grad.addColorStop(0.45, "rgba(255,255,255,0.08)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, 2 * Math.PI); ctx.fill();

    // ── Label ──
    const label = node.label || "";
    const showLabel = showAllLabels || isSelected || isHovered || isConnectedToHover || scale > 1.2;
    if (showLabel && label) {
      const safeScale = Math.max(scale, 0.001);
      const fs = Math.max(10, Math.min(13, 11 / safeScale));
      ctx.font = `${isSelected || isHovered ? "600 " : ""}${fs}px Inter, -apple-system, system-ui, sans-serif`;
      ctx.fillStyle = isHovered || isSelected ? "#ffffff" : "rgba(220,225,240,0.9)";
      ctx.shadowColor = "rgba(0,0,0,0.85)"; ctx.shadowBlur = 3;
      ctx.fillText(label, node.x + r + 3, node.y + fs / 3);
      ctx.shadowBlur = 0;
    }

    ctx.globalAlpha = 1;
  }, [selectedNodeIds, hoveredNode, dimmedNodeIds, nodeRadius, colorByType, labelColor, showAllLabels, highlightedPath, graph.links]);

  const linkCanvasObject = useCallback((link: any, ctx: CanvasRenderingContext2D, scale: number) => {
    const src = link.source;
    const tgt = link.target;
    if (!src || !tgt || src.x == null || tgt.x == null) return;

    const theme = document.documentElement.dataset.theme;
    const safeScale = Math.max(scale, 0.001);
    const isHov = hoveredLink && hoveredLink.id === link.id;
    const isPath = highlightedPath?.linkIds.has(link.id);
    const lc = isPath ? "#f59e0b"
      : isHov ? "rgba(91,140,255,0.8)"
      : theme === "light" ? "rgba(80,90,120,0.22)" : "rgba(150,160,190,0.25)";

    // Quadratic bezier curve (gentle arc)
    const dx = tgt.x - src.x;
    const dy = tgt.y - src.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const curvature = 0.08;
    const mx = (src.x + tgt.x) / 2 + (-dy / Math.max(dist, 1)) * dist * curvature;
    const my = (src.y + tgt.y) / 2 + (dx / Math.max(dist, 1)) * dist * curvature;

    ctx.strokeStyle = lc;
    ctx.lineWidth = isPath ? 2 / safeScale : isHov ? 1.2 / safeScale : 0.8 / safeScale;
    if (isPath) { ctx.shadowColor = "#f59e0b"; ctx.shadowBlur = 8; }
    ctx.beginPath(); ctx.moveTo(src.x, src.y); ctx.quadraticCurveTo(mx, my, tgt.x, tgt.y); ctx.stroke();
    ctx.shadowBlur = 0;

    // Arrow
    if (dist < 1) return;
    const atx = tgt.x - mx, aty = tgt.y - my;
    const atLen = Math.sqrt(atx * atx + aty * aty);
    const ux = atx / Math.max(atLen, 0.001), uy = aty / Math.max(atLen, 0.001);
    const tgtR = nodeRadius(tgt.id || "");
    const arrowX = tgt.x - ux * (tgtR + 4 / safeScale);
    const arrowY = tgt.y - uy * (tgtR + 4 / safeScale);
    const arrowLen = 6 / safeScale, arrowAngle = 0.45;
    ctx.fillStyle = lc;
    ctx.beginPath();
    ctx.moveTo(arrowX, arrowY);
    ctx.lineTo(arrowX - arrowLen * (ux * Math.cos(arrowAngle) - uy * Math.sin(arrowAngle)), arrowY - arrowLen * (uy * Math.cos(arrowAngle) + ux * Math.sin(arrowAngle)));
    ctx.lineTo(arrowX - arrowLen * (ux * Math.cos(arrowAngle) + uy * Math.sin(arrowAngle)), arrowY - arrowLen * (uy * Math.cos(arrowAngle) - ux * Math.sin(arrowAngle)));
    ctx.closePath(); ctx.fill();

    // Edge label (show at zoom > 1.2 or when hovered)
    const name = link.name || "";
    if (name && (scale > 1.2 || isHov)) {
      const midX = src.x * 0.25 + mx * 0.5 + tgt.x * 0.25;
      const midY = src.y * 0.25 + my * 0.5 + tgt.y * 0.25;
      const fs = Math.max(7, 10 / safeScale);
      ctx.font = `${fs}px -apple-system, system-ui, sans-serif`;
      const textW = ctx.measureText(name).width;
      ctx.fillStyle = theme === "light" ? "rgba(241,245,249,0.92)" : "rgba(13,19,32,0.88)";
      ctx.beginPath();
      const pad = 2 / safeScale, rw = textW + pad * 2, rh = fs + pad * 2;
      const rx = midX - textW / 2 - pad, ry = midY - fs / 2 - pad;
      const radVal = 3 / safeScale;
      if (typeof (ctx as any).roundRect === "function") { (ctx as any).roundRect(rx, ry, rw, rh, radVal); }
      else { ctx.rect(rx, ry, rw, rh); }
      ctx.fill();
      ctx.fillStyle = isPath ? "#f59e0b" : (theme === "light" ? "rgba(100,116,139,0.9)" : "rgba(139,147,167,0.9)");
      ctx.textAlign = "center"; ctx.fillText(name, midX, midY + fs * 0.35); ctx.textAlign = "left";
    }
  }, [nodeRadius, hoveredLink, highlightedPath]);

  // ── Hover tooltip ─────────────────────────────────────────────────────────
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  function onNodeHover(node: any, _prev: any) {
    setHoveredNode(node || null);
    if (!node) { setTooltipPos(null); return; }
    if (!fgRef.current || node.x == null) return;
    const sc = fgRef.current.graph2ScreenCoords(node.x, node.y);
    if (wrap.current?.getBoundingClientRect()) setTooltipPos({ x: sc.x + 14, y: sc.y - 10 });
  }

  // ── Mini-map click-to-pan ─────────────────────────────────────────────────
  function onMinimapClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = minimapRef.current;
    const fg = fgRef.current;
    if (!canvas || !fg) return;
    const rect = canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const cy = (e.clientY - rect.top) * (canvas.height / rect.height);
    const W = canvas.width, H = canvas.height;
    const nodes = graph.nodes.filter((n: any) => n.x != null && n.y != null);
    if (nodes.length === 0) return;
    let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity;
    nodes.forEach((n: any) => { mnX = Math.min(mnX, n.x); mxX = Math.max(mxX, n.x); mnY = Math.min(mnY, n.y); mxY = Math.max(mxY, n.y); });
    const rng = Math.max(mxX - mnX, mxY - mnY, 1);
    const pad = 8;
    const sc = (Math.min(W, H) - 2 * pad) / rng;
    const ox = pad + (W - 2 * pad - (mxX - mnX) * sc) / 2 - mnX * sc;
    const oy = pad + (H - 2 * pad - (mxY - mnY) * sc) / 2 - mnY * sc;
    fg.centerAt((cx - ox) / sc, (cy - oy) / sc, 400);
  }

  // ── JSX ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full w-full overflow-hidden">

      {/* ── Canvas area ───────────────────────────────────────────────────── */}
      <div
        ref={wrap}
        className="relative flex-1 h-full overflow-hidden"
        style={{ userSelect: "none", background: "#080b12" }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Obsidian-style radial gradient background */}
        <div style={{
          position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none",
          background: "radial-gradient(ellipse at 50% 50%, rgba(167,139,250,0.06) 0%, rgba(52,211,153,0.03) 30%, transparent 70%)",
        }} />
        {graph.nodes.length === 0 && !subgraphIds ? (
          <div className="flex h-full items-center justify-center text-sm" style={{ color: "var(--muted)" }}>
            <div className="text-center">
              <div style={{ fontSize: 40, marginBottom: 12 }}>🕸️</div>
              <div className="font-medium">No entities in {activeFolderNames}</div>
              <div className="mt-1 text-xs" style={{ color: "var(--muted)", opacity: 0.7 }}>
                Capture windows or upload files to build your knowledge graph.
              </div>
              <button onClick={() => setModal("addNode")} className="mt-3 rounded-lg px-4 py-2 text-xs font-medium text-white" style={{ background: "var(--accent)", border: "none", cursor: "pointer" }}>
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
              backgroundColor="rgba(0,0,0,0)"
              enablePanInteraction={true}
              enableNodeDrag={true}
              nodeLabel={() => ""}
              linkLabel={() => ""}
              linkColor={() => "transparent"}
              linkDirectionalArrowLength={0}
              cooldownTime={2200}
              d3VelocityDecay={0.35}
              d3AlphaDecay={0.015}
              onNodeClick={(node: any, event: MouseEvent) => {
                if (drag.current?.active) return;
                const now = Date.now();
                if (lastClickRef.current && lastClickRef.current.nodeId === node.id && now - lastClickRef.current.time < 350) {
                  setDetailNode(node);
                  setSelectedNodeIds(new Set([node.id]));
                  setTimeout(() => zoomToNode(node), 100);
                  lastClickRef.current = null;
                  return;
                }
                lastClickRef.current = { nodeId: node.id, time: now };

                setDetailNode(null);
                setSelectedNodeIds((prev) => {
                  const next = new Set(prev);
                  if (event.ctrlKey || event.metaKey) {
                    if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
                  } else {
                    if (next.size === 1 && next.has(node.id)) next.clear();
                    else { next.clear(); next.add(node.id); }
                  }
                  return next;
                });
              }}
              onNodeRightClick={(node: any, event: MouseEvent) => {
                event.preventDefault();
                setDetailNode(node);
                setSelectedNodeIds(new Set([node.id]));
              }}
              onNodeHover={onNodeHover}
              onLinkClick={(link: any) => setSelEdge({ id: link.id, name: link.name || "", fact: link.fact || "" })}
              onLinkHover={(link: any) => setHoveredLink(link || null)}
              onBackgroundClick={() => {
                setSelectedNodeIds(new Set()); setSelEdge(null);
                setHighlightedType(null); setDetailNode(null); setHighlightedPath(null);
              }}
              nodeCanvasObject={nodeCanvasObject}
              nodeCanvasObjectMode={() => "replace"}
              linkCanvasObject={linkCanvasObject}
              linkCanvasObjectMode={() => "replace"}
            />

            {/* Search bar */}
            <div ref={searchRef} className="absolute" style={{ top: 12, left: 12, width: 240, zIndex: 30 }}>
              <div style={{ position: "relative" }}>
                <div style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", fontSize: 13, pointerEvents: "none" }}>🔍</div>
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setSearchDropdownOpen(true); }}
                  onFocus={() => setSearchDropdownOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") { setSearchQuery(""); setSearchDropdownOpen(false); setHighlightedType(null); }
                    if (e.key === "Enter" && searchResults.length > 0) selectAndZoomNode(searchResults[0]);
                  }}
                  placeholder="Find entity…  ( / )"
                  style={{ width: "100%", background: "var(--panel)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 10, padding: "7px 10px 7px 32px", fontSize: 12, outline: "none", boxShadow: "0 2px 12px rgba(0,0,0,0.25)", backdropFilter: "blur(8px)" }}
                />
                {searchQuery && (
                  <button onClick={() => { setSearchQuery(""); setSearchDropdownOpen(false); }} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 13 }}>✕</button>
                )}
              </div>

              {searchDropdownOpen && searchResults.length > 0 && (
                <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.3)", overflow: "hidden", zIndex: 50 }}>
                  {searchResults.map((n: any, i: number) => (
                    <button key={n.id} onClick={() => selectAndZoomNode(n)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: i === 0 ? "rgba(91,140,255,0.08)" : "transparent", border: "none", borderBottom: i < searchResults.length - 1 ? "1px solid var(--border)" : "none", cursor: "pointer", textAlign: "left" }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: colorByType[n.node_type] || "#5b8cff", flexShrink: 0 }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.label}</div>
                        {n.summary && <div style={{ fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.summary}</div>}
                      </div>
                      <span style={{ fontSize: 9, padding: "2px 5px", borderRadius: 4, background: `${colorByType[n.node_type] || "#5b8cff"}22`, color: colorByType[n.node_type] || "#5b8cff", flexShrink: 0, fontWeight: 600, letterSpacing: "0.03em" }}>{n.node_type}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Rubber-band rect */}
            {rectSel && (
              <div style={{ position: "absolute", left: rectSel.x, top: rectSel.y, width: rectSel.w, height: rectSel.h, border: "1.5px dashed var(--accent)", background: "rgba(91,140,255,0.08)", borderRadius: 2, pointerEvents: "none" }} />
            )}

            {/* Subgraph banner */}
            {subgraphIds && (
              <div className="absolute flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs shadow" style={{ top: 12, left: "50%", transform: "translateX(-50%)", background: "rgba(91,140,255,0.15)", border: "1px solid var(--accent)", color: "var(--accent)", zIndex: 20 }}>
                <span>Subgraph: {subgraphIds.size} entities</span>
                <button onClick={clearSubgraph} style={{ background: "transparent", border: "1px solid var(--accent)", color: "var(--accent)", borderRadius: 4, padding: "1px 8px", cursor: "pointer", fontSize: 10 }}>Show all</button>
              </div>
            )}

            {/* ── Toolbar (top-right) ────────────────────────────────────────── */}
            <div className="absolute top-3 right-3 flex items-center gap-1.5" style={{ zIndex: 20 }}>

              {/* Stats pill (expandable) */}
              <div style={{ position: "relative" }}>
                <button onClick={() => setStatsExpanded((s) => !s)} className="rounded-lg px-2.5 py-1 text-xs" style={{ background: "var(--panel)", border: "1px solid var(--border)", color: "var(--muted)", cursor: "pointer" }}>
                  {graphStats.total} entities · {graphStats.edges} facts {statsExpanded ? "▲" : "▼"}
                </button>
                {statsExpanded && (
                  <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px", boxShadow: "0 8px 24px rgba(0,0,0,0.3)", zIndex: 60, minWidth: 210 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 10 }}>Graph Stats</div>
                    {graphStats.hubNode && (
                      <div style={{ fontSize: 12, color: "var(--text)", marginBottom: 6 }}>
                        🔗 Hub: <span style={{ fontWeight: 600 }}>{(graphStats.hubNode as any).label}</span>
                        <span style={{ color: "var(--muted)", marginLeft: 4 }}>({degreeMap[(graphStats.hubNode as any).id] || 0} links)</span>
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 10 }}>⚪ Isolated nodes: {graphStats.isolated}</div>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 8 }}>By Type</div>
                    {Object.entries(graphStats.typeCount).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                      <div key={type} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: colorByType[type], flexShrink: 0 }} />
                        <div style={{ flex: 1, background: "var(--input-bg)", borderRadius: 4, height: 5, overflow: "hidden" }}>
                          <div style={{ width: `${(count / Math.max(graphStats.total, 1)) * 100}%`, height: "100%", background: colorByType[type], borderRadius: 4 }} />
                        </div>
                        <span style={{ fontSize: 9, color: "var(--muted)", minWidth: 18, textAlign: "right" }}>{count}</span>
                        <span style={{ fontSize: 9, color: "var(--muted)", minWidth: 60 }}>{type}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Label toggle (𝐓 = show all labels) */}
              <button onClick={() => setShowAllLabels((v) => !v)} title={showAllLabels ? "Hide labels" : "Always show labels"} className="rounded-lg px-2.5 py-1 text-xs font-bold" style={{ background: showAllLabels ? "var(--accent)" : "var(--panel)", color: showAllLabels ? "#fff" : "var(--muted)", border: "1px solid var(--border)", cursor: "pointer" }}>
                𝐓
              </button>

              {/* Mini-map toggle */}
              <button onClick={() => setShowMinimap((v) => !v)} title={showMinimap ? "Hide mini-map" : "Show mini-map"} className="rounded-lg px-2.5 py-1 text-xs" style={{ background: showMinimap ? "var(--accent)" : "var(--panel)", color: showMinimap ? "#fff" : "var(--muted)", border: "1px solid var(--border)", cursor: "pointer" }}>
                ⊟
              </button>

              <button onClick={() => setModal("addNode")} className="rounded-lg px-2.5 py-1 text-xs" style={{ background: "var(--panel)", border: "1px solid var(--border)", color: "var(--accent)", cursor: "pointer" }}>+ Entity</button>
              <button onClick={openAddEdge} className="rounded-lg px-2.5 py-1 text-xs" style={{ background: "var(--panel)", border: "1px solid var(--border)", color: "var(--accent)", cursor: "pointer" }}>+ Link</button>

              <button onClick={() => setQueryPanelOpen((o) => !o)} className="rounded-lg px-2.5 py-1 text-xs font-medium" style={{ background: queryPanelOpen ? "var(--accent)" : "var(--panel)", color: queryPanelOpen ? "#fff" : "var(--text)", border: "1px solid var(--border)", cursor: "pointer" }} title="Toggle Query Panel">
                🔍 Query {selectedNodeIds.size > 0 && `(${selectedNodeIds.size})`}
              </button>

              {/* Keyboard shortcuts button */}
              <button onClick={() => setShowShortcuts((s) => !s)} title="Keyboard shortcuts (?)" className="rounded-lg px-2.5 py-1 text-xs" style={{ background: "var(--panel)", border: "1px solid var(--border)", color: "var(--muted)", cursor: "pointer" }}>
                ?
              </button>
            </div>

            {/* Type legend (bottom-left) */}
            {entityTypes.length > 0 && (
              <div className="absolute flex flex-wrap items-center gap-2" style={{ bottom: selEdge ? 90 : 14, left: 14, maxWidth: "60%", zIndex: 20, background: "rgba(8,11,18,0.85)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "8px 14px", boxShadow: "0 4px 16px rgba(0,0,0,0.3)" }}>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginRight: 4, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>Types</span>
                {entityTypes.map((type) => (
                  <button key={type} onClick={() => setHighlightedType(highlightedType === type ? null : type)} style={{ display: "flex", alignItems: "center", gap: 5, background: highlightedType === type ? `${colorByType[type]}22` : "transparent", border: highlightedType === type ? `1px solid ${colorByType[type]}` : "1px solid transparent", borderRadius: 8, padding: "3px 8px", cursor: "pointer" }} title={`Highlight ${type}`}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: colorByType[type] || "#5b8cff", flexShrink: 0, border: "1px solid rgba(255,255,255,0.15)" }} />
                    <span style={{ fontSize: 11, color: highlightedType === type ? colorByType[type] : "rgba(255,255,255,0.7)", fontWeight: highlightedType === type ? 600 : 400 }}>{type}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Zoom controls (bottom-right) */}
            <div className="absolute flex flex-col gap-1" style={{ bottom: 14, right: 14, zIndex: 20 }}>
              {[{ label: "+", action: zoomIn, title: "Zoom in  ( + )" }, { label: "−", action: zoomOut, title: "Zoom out  ( − )" }, { label: "⊞", action: zoomFit, title: "Fit all nodes  ( F )" }].map(({ label, action, title }) => (
                <button key={label} onClick={action} title={title} style={{ width: 30, height: 30, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.2)" }}>
                  {label}
                </button>
              ))}
            </div>

            {/* Mini-map canvas */}
            {showMinimap && (
              <canvas
                ref={minimapRef}
                width={160} height={120}
                onClick={onMinimapClick}
                style={{ position: "absolute", bottom: 118, right: 14, width: 160, height: 120, borderRadius: 10, border: "1px solid var(--border)", cursor: "crosshair", zIndex: 20, boxShadow: "0 2px 16px rgba(0,0,0,0.4)" }}
                title="Overview — click to navigate"
              />
            )}

            {/* Hover tooltip */}
            {hoveredNode && tooltipPos && (
              <div style={{ position: "absolute", left: Math.min(tooltipPos.x, size.w - 220), top: Math.max(tooltipPos.y, 10), background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px", boxShadow: "0 4px 20px rgba(0,0,0,0.3)", pointerEvents: "none", zIndex: 40, maxWidth: 210, backdropFilter: "blur(8px)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: colorByType[hoveredNode.node_type] || "#5b8cff", flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{hoveredNode.label}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: hoveredNode.summary ? 6 : 0 }}>
                  <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, background: `${colorByType[hoveredNode.node_type] || "#5b8cff"}22`, color: colorByType[hoveredNode.node_type] || "#5b8cff", fontWeight: 600, letterSpacing: "0.03em" }}>{hoveredNode.node_type}</span>
                  <span style={{ fontSize: 9, color: "var(--muted)" }}>{degreeMap[hoveredNode.id] || 0} connection{degreeMap[hoveredNode.id] !== 1 ? "s" : ""}</span>
                </div>
                {hoveredNode.summary && <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.4 }}>{hoveredNode.summary.slice(0, 120)}{hoveredNode.summary.length > 120 ? "…" : ""}</div>}
                <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 5, opacity: 0.55 }}>Double-click or right-click for details</div>
              </div>
            )}

            {/* Edge detail pill */}
            {selEdge && (
              <div className="absolute bottom-4 z-40 rounded-xl p-3 shadow-lg" style={{ background: "var(--panel)", border: "1px solid var(--border)", maxWidth: 450, left: "50%", transform: "translateX(-50%)" }}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Relationship / Fact</div>
                    <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>{selEdge.name || "—"}</div>
                    {selEdge.fact && <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>{selEdge.fact}</div>}
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button onClick={() => copyEdgeToChatAndSwitch(selEdge)} className="rounded-md px-2 py-1 text-xs" style={{ color: "var(--accent)", border: "1px solid var(--border)", background: "transparent", cursor: "pointer" }}>Chat</button>
                    <button disabled={deleting} onClick={() => deleteEdge(selEdge.id)} className="rounded-md px-2 py-1 text-xs" style={{ color: "var(--danger)", border: "1px solid var(--border)", background: "transparent", cursor: "pointer" }}>Delete</button>
                    <button onClick={() => setSelEdge(null)} className="rounded-md px-2 py-1 text-xs" style={{ color: "var(--muted)", border: "1px solid var(--border)", background: "transparent", cursor: "pointer" }}>✕</button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Keyboard Shortcuts overlay ──────────────────────────────── */}
            {showShortcuts && (
              <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 80 }} onClick={() => setShowShortcuts(false)}>
                <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 24px", maxWidth: 360, width: "90%", boxShadow: "0 16px 48px rgba(0,0,0,0.4)" }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)", marginBottom: 14 }}>⌨️ Keyboard Shortcuts</div>
                  {([
                    ["/  or  Ctrl+F", "Focus search bar"],
                    ["Esc", "Clear selection / close panels"],
                    ["Delete", "Delete selected entities"],
                    ["Ctrl + A", "Select all visible nodes"],
                    ["F", "Fit graph to screen"],
                    ["+  /  −", "Zoom in / out"],
                    ["Double-click node", "Open entity detail drawer"],
                    ["Right-click node", "Open entity detail drawer"],
                    ["Shift + Drag", "Rubber-band multi-select"],
                    ["?", "Toggle this shortcuts panel"],
                  ] as [string, string][]).map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 8, fontSize: 12 }}>
                      <span style={{ fontFamily: "monospace", background: "var(--input-bg)", border: "1px solid var(--border)", borderRadius: 5, padding: "2px 7px", color: "var(--accent)", flexShrink: 0, fontSize: 11 }}>{k}</span>
                      <span style={{ color: "var(--muted)", textAlign: "right", fontSize: 11 }}>{v}</span>
                    </div>
                  ))}
                  <button onClick={() => setShowShortcuts(false)} style={{ marginTop: 10, width: "100%", padding: "7px 0", background: "var(--input-bg)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--muted)", cursor: "pointer", fontSize: 12 }}>Close</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Node Detail Drawer ─────────────────────────────────────────────── */}
      {detailNode && (
        <aside className="flex w-72 shrink-0 flex-col h-full overflow-y-auto" style={{ background: "var(--panel)", borderLeft: "1px solid var(--border)" }}>
          {/* Header */}
          <div className="flex items-start justify-between p-4 pb-3" style={{ borderBottom: "1px solid var(--border)" }}>
            <div className="min-w-0 flex-1 pr-2">
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: colorByType[detailNode.node_type] || "#5b8cff", flexShrink: 0 }} />
                <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", wordBreak: "break-word" }}>{detailNode.label}</span>
              </div>
              <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 5, background: `${colorByType[detailNode.node_type] || "#5b8cff"}22`, color: colorByType[detailNode.node_type] || "#5b8cff", fontWeight: 700, letterSpacing: "0.03em" }}>{detailNode.node_type}</span>
              <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: 8 }}>{degreeMap[detailNode.id] || 0} connection{degreeMap[detailNode.id] !== 1 ? "s" : ""}</span>
            </div>
            <button onClick={() => setDetailNode(null)} style={{ color: "var(--muted)", background: "transparent", border: "none", cursor: "pointer", fontSize: 16, flexShrink: 0 }}>✕</button>
          </div>

          <div className="p-4 space-y-4 flex-1 overflow-y-auto">
            {/* Summary */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 6 }}>Summary</div>
              {detailNode.summary
                ? <div style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.65 }}>{detailNode.summary}</div>
                : <div style={{ fontSize: 12, color: "var(--muted)", fontStyle: "italic" }}>No summary available.</div>
              }
            </div>

            {/* Connections */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 8 }}>
                Connections ({detailNodeConnections.length})
              </div>
              {detailNodeConnections.length === 0 ? (
                <div style={{ fontSize: 11, color: "var(--muted)" }}>No connections.</div>
              ) : (
                <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
                  {detailNodeConnections.map((c: any, i: number) => (
                    <button
                      key={i}
                      onClick={() => { if (c.node) { selectAndZoomNode(c.node); setDetailNode(c.node); } }}
                      style={{ width: "100%", textAlign: "left", background: "var(--input-bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", cursor: "pointer" }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                        <span style={{ fontSize: 9, color: "var(--muted)", fontWeight: 700 }}>{c.dir === "out" ? "OUT →" : "← IN"}</span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: "var(--accent)" }}>{c.link?.name || "—"}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: colorByType[c.node?.node_type] || "#5b8cff", flexShrink: 0 }} />
                        <span style={{ fontSize: 11, color: "var(--text)", fontWeight: 500 }}>{c.node?.label ?? "?"}</span>
                        <span style={{ fontSize: 9, color: "var(--muted)", marginLeft: "auto", flexShrink: 0 }}>{c.node?.node_type}</span>
                      </div>
                      {c.link?.fact && <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.link.fact}</div>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Quick ask */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 6 }}>Quick Ask</div>
              <textarea
                rows={2}
                placeholder={`e.g. What is ${detailNode.label}'s role?`}
                style={{ width: "100%", background: "var(--input-bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 11, resize: "none", outline: "none", fontFamily: "inherit" }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    const q = (e.target as HTMLTextAreaElement).value.trim();
                    if (q) {
                      setGraphContext(`Entity: ${detailNode.label} (${detailNode.node_type})\n${detailNode.summary || ""}\n\nQuestion: ${q}`);
                      setView("chat");
                    }
                  }
                }}
              />
              <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 3 }}>Press Enter to open in Chat ↵</div>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={() => { setGraphContext(buildGraphContextText()); setView("chat"); }}
                className="flex-1 rounded-lg py-1.5 text-xs"
                style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--accent)", cursor: "pointer" }}
              >
                Export to Chat
              </button>
              <button
                disabled={deleting}
                onClick={async () => {
                  if (!confirm(`Delete "${detailNode.label}"?`)) return;
                  setDeleting(true);
                  try { await api.deleteGraphNode(detailNode.id); setDetailNode(null); setSelectedNodeIds(new Set()); await refreshGraph(); }
                  catch (e) { alert(`Delete failed: ${e}`); } finally { setDeleting(false); }
                }}
                className="rounded-lg px-3 py-1.5 text-xs"
                style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--danger)", cursor: "pointer" }}
              >
                {deleting ? "…" : "Delete"}
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* ── Query Panel ───────────────────────────────────────────────────── */}
      {queryPanelOpen && (
        <aside className="flex w-80 shrink-0 flex-col h-full overflow-y-auto p-4 space-y-4" style={{ background: "var(--panel)", borderLeft: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between pb-2" style={{ borderBottom: "1px solid var(--border)" }}>
            <div>
              <h3 className="text-sm font-medium" style={{ color: "var(--text)" }}>Graph Query</h3>
              <p className="text-[11px]" style={{ color: "var(--muted)" }}>Query entities & facts directly</p>
            </div>
            <button onClick={() => setQueryPanelOpen(false)} style={{ color: "var(--muted)", background: "transparent", border: "none", cursor: "pointer", fontSize: 14 }}>✕</button>
          </div>

          {/* Scope */}
          <div className="rounded-lg p-2.5 text-xs space-y-1" style={{ background: "var(--panel2)", border: "1px solid var(--border)" }}>
            <div className="flex items-center justify-between text-[11px]" style={{ color: "var(--muted)" }}>
              <span>Scope:</span>
              <span style={{ color: "var(--accent)", fontWeight: 600 }}>{activeFolderNames}</span>
            </div>
            <div className="flex items-center justify-between text-[11px]" style={{ color: "var(--muted)" }}>
              <span>Selection:</span>
              <span style={{ color: selectedNodeIds.size > 0 ? "var(--accent)" : "var(--text)", fontWeight: 600 }}>
                {selectedNodeIds.size > 0 ? `${selectedNodeIds.size} entities` : "Entire graph"}
              </span>
            </div>
          </div>

          {/* Selected entities */}
          {selectedNodeIds.size > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium" style={{ color: "var(--text)" }}>Selected ({selectedNodeIds.size})</span>
                <div className="flex gap-1 text-[11px]">
                  <button onClick={focusSelection} className="rounded px-1.5 py-0.5" style={{ color: "var(--ok)", background: "transparent", border: "1px solid var(--border)", cursor: "pointer" }}>Focus</button>
                  <button disabled={deleting} onClick={deleteSelected} className="rounded px-1.5 py-0.5" style={{ color: "var(--danger)", background: "transparent", border: "1px solid var(--border)", cursor: "pointer" }}>{deleting ? "…" : "Delete"}</button>
                  <button onClick={() => setSelectedNodeIds(new Set())} className="rounded px-1.5 py-0.5" style={{ color: "var(--muted)", background: "transparent", border: "1px solid var(--border)", cursor: "pointer" }}>Clear</button>
                </div>
              </div>

              <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                {selectedNodesList.map((n: any) => (
                  <div key={n.id} className="flex items-center justify-between rounded px-2 py-1 text-xs" style={{ background: "var(--input-bg)", border: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: colorByType[n.node_type] || "#5b8cff", flexShrink: 0 }} />
                      <span className="truncate font-medium" style={{ color: "var(--text)" }}>{n.label}</span>
                    </div>
                    <span className="shrink-0 text-[10px]" style={{ color: "var(--muted)" }}>{n.node_type}</span>
                  </div>
                ))}
              </div>

              {/* Path Finder — shown when exactly 2 nodes selected */}
              {selectedNodeIds.size === 2 && (() => {
                const [idA, idB] = [...selectedNodeIds];
                const nodeA = graph.nodes.find((n: any) => n.id === idA);
                const nodeB = graph.nodes.find((n: any) => n.id === idB);
                return (
                  <div className="rounded-lg p-2.5 space-y-2" style={{ background: "var(--panel2)", border: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--muted)" }}>🧭 Path Finder</div>
                    <div style={{ fontSize: 11, color: "var(--text)" }}>
                      <span style={{ fontWeight: 600 }}>{(nodeA as any)?.label}</span>
                      <span style={{ color: "var(--muted)" }}> → </span>
                      <span style={{ fontWeight: 600 }}>{(nodeB as any)?.label}</span>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => {
                          const path = findPath(idA, idB);
                          if (path) setHighlightedPath(path);
                          else alert("No path found between these two entities in the current graph.");
                        }}
                        className="flex-1 rounded py-1 text-[11px] font-medium text-white"
                        style={{ background: "var(--accent)", border: "none", cursor: "pointer" }}
                      >
                        Find Path
                      </button>
                      {highlightedPath && (
                        <button onClick={() => setHighlightedPath(null)} className="rounded px-2 py-1 text-[11px]" style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--muted)", cursor: "pointer" }}>Clear</button>
                      )}
                    </div>
                    {highlightedPath && (
                      <div style={{ fontSize: 10, color: "var(--ok)" }}>
                        ✓ Path: {highlightedPath.nodeIds.size} nodes · {highlightedPath.linkIds.size} hop{highlightedPath.linkIds.size !== 1 ? "s" : ""}
                      </div>
                    )}
                  </div>
                );
              })()}

              <button onClick={copyNodesToChatAndSwitch} className="w-full rounded-lg py-1.5 text-xs" style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--muted)", cursor: "pointer" }}>
                Export to Chat
              </button>
            </div>
          ) : (
            <div className="rounded-lg p-2.5 text-[11px] leading-relaxed" style={{ background: "var(--input-bg)", color: "var(--muted)", border: "1px dashed var(--border)" }}>
              💡 Press <kbd style={{ fontFamily: "monospace", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 3, padding: "0 4px", fontSize: 10 }}>/</kbd> to search. Click nodes to select, shift+drag to multi-select. Double-click for details.
            </div>
          )}

          {/* Graph query box */}
          <div className="space-y-2">
            <label className="block text-xs font-medium" style={{ color: "var(--text)" }}>
              Ask about {selectedNodeIds.size > 0 ? `${selectedNodeIds.size} selected entities` : "this graph"}:
            </label>
            <textarea
              rows={3}
              value={panelInput}
              onChange={(e) => setPanelInput(e.target.value)}
              placeholder={selectedNodeIds.size > 0 ? `e.g. What connects ${selectedNodesList.slice(0, 2).map((n: any) => n.label).join(" and ")}?` : "e.g. Summarize the main entity relationships…"}
              className="w-full rounded-lg p-2.5 text-xs outline-none"
              style={{ background: "var(--input-bg)", color: "var(--text)", border: "1px solid var(--border)", resize: "vertical", fontFamily: "inherit" }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleGraphQuery(panelInput); } }}
            />
            <div className="flex flex-wrap gap-1 text-[10px]">
              <button type="button" onClick={() => handleGraphQuery("Summarize key relationships and entities here.")} className="rounded px-2 py-1" style={{ background: "var(--panel2)", color: "var(--muted)", border: "1px solid var(--border)", cursor: "pointer" }}>💡 Summarize</button>
              <button type="button" onClick={() => handleGraphQuery("What are the main insights and facts connecting these nodes?")} className="rounded px-2 py-1" style={{ background: "var(--panel2)", color: "var(--muted)", border: "1px solid var(--border)", cursor: "pointer" }}>💡 Key Insights</button>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => handleGraphQuery(panelInput)} disabled={panelAnswering || !panelInput.trim()} className="flex-1 rounded-lg py-2 text-xs font-medium text-white disabled:opacity-50" style={{ background: "var(--accent)", border: "none", cursor: panelAnswering || !panelInput.trim() ? "not-allowed" : "pointer" }}>
                {panelAnswering ? "Querying Graph…" : "Query Graph"}
              </button>
              {selectedNodeIds.size === 0 && (
                <button type="button" onClick={copyNodesToChatAndSwitch} className="rounded-lg px-2.5 py-2 text-xs" style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--muted)", cursor: "pointer" }}>Export to Chat</button>
              )}
            </div>
          </div>

          {panelAnswering && <div className="rounded-lg p-3 text-xs" style={{ background: "var(--panel2)", color: "var(--muted)", border: "1px solid var(--border)" }}>Thinking and analyzing graph connections…</div>}
          {panelError && <div className="rounded-lg p-3 text-xs" style={{ background: "rgba(239,68,68,0.1)", color: "var(--danger)", border: "1px solid var(--danger)" }}>Query failed: {panelError}</div>}
          {panelAnswer && (
            <div className="rounded-lg p-3 text-xs space-y-2" style={{ background: "var(--panel2)", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--accent)" }}>Answer</div>
              <div className="whitespace-pre-wrap text-xs" style={{ color: "var(--text)" }}>{panelAnswer.text}</div>
              {panelAnswer.citations.length > 0 && (
                <div className="pt-2 text-[10px]" style={{ color: "var(--muted)", borderTop: "1px solid var(--border)" }}>
                  Sources: {panelAnswer.citations.map((c) => c.window_title || c.app).join(", ")}
                </div>
              )}
            </div>
          )}
        </aside>
      )}

      {/* ── Add Node Modal ─────────────────────────────────────────────────── */}
      {modal === "addNode" && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }} onClick={() => setModal(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, padding: 24, width: 360, maxWidth: "90%" }}>
            <div style={{ fontWeight: 600, fontSize: 15, color: "var(--text)", marginBottom: 16 }}>Add entity</div>
            <div className="space-y-3">
              <div><label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>Name *</label><input autoFocus style={inputStyle} value={newNodeName} onChange={(e) => setNewNodeName(e.target.value)} placeholder="e.g. Acme Corp" onKeyDown={(e) => { if (e.key === "Enter") submitAddNode(); }} /></div>
              <div><label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>Type</label><input style={inputStyle} value={newNodeType} onChange={(e) => setNewNodeType(e.target.value)} placeholder="Entity" /></div>
              <div><label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>Summary</label><input style={inputStyle} value={newNodeSummary} onChange={(e) => setNewNodeSummary(e.target.value)} placeholder="Optional description" onKeyDown={(e) => { if (e.key === "Enter") submitAddNode(); }} /></div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setModal(null)} className="rounded-lg px-4 py-2 text-xs" style={{ color: "var(--muted)", border: "1px solid var(--border)", background: "transparent", cursor: "pointer" }}>Cancel</button>
              <button onClick={submitAddNode} disabled={saving || !newNodeName.trim()} className="rounded-lg px-4 py-2 text-xs font-medium text-white" style={{ background: saving || !newNodeName.trim() ? "var(--muted)" : "var(--accent)", border: "none", cursor: saving || !newNodeName.trim() ? "not-allowed" : "pointer" }}>{saving ? "Adding…" : "Add entity"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Edge Modal ─────────────────────────────────────────────────── */}
      {modal === "addEdge" && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }} onClick={() => setModal(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, padding: 24, width: 400, maxWidth: "90%" }}>
            <div style={{ fontWeight: 600, fontSize: 15, color: "var(--text)", marginBottom: 16 }}>Add relationship</div>
            <div className="space-y-3">
              <div><label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>From entity *</label><select style={{ ...inputStyle, cursor: "pointer" }} value={edgeSourceId} onChange={(e) => setEdgeSourceId(e.target.value)}><option value="">Select entity…</option>{(data.nodes || []).map((n) => (<option key={n.id} value={n.id}>{n.label}</option>))}</select></div>
              <div><label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>To entity *</label><select style={{ ...inputStyle, cursor: "pointer" }} value={edgeTargetId} onChange={(e) => setEdgeTargetId(e.target.value)}><option value="">Select entity…</option>{(data.nodes || []).map((n) => (<option key={n.id} value={n.id}>{n.label}</option>))}</select></div>
              <div><label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>Relationship name *</label><input style={inputStyle} value={edgeName} onChange={(e) => setEdgeName(e.target.value)} placeholder="e.g. OWNS, WORKS_AT, LEADS" /></div>
              <div><label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>Fact / detail</label><input style={inputStyle} value={edgeFact} onChange={(e) => setEdgeFact(e.target.value)} placeholder="Optional detail about this relationship" /></div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setModal(null)} className="rounded-lg px-4 py-2 text-xs" style={{ color: "var(--muted)", border: "1px solid var(--border)", background: "transparent", cursor: "pointer" }}>Cancel</button>
              <button onClick={submitAddEdge} disabled={saving || !edgeSourceId || !edgeTargetId || !edgeName.trim()} className="rounded-lg px-4 py-2 text-xs font-medium text-white" style={{ background: saving || !edgeSourceId || !edgeTargetId || !edgeName.trim() ? "var(--muted)" : "var(--accent)", border: "none", cursor: saving || !edgeSourceId || !edgeTargetId || !edgeName.trim() ? "not-allowed" : "pointer" }}>{saving ? "Adding…" : "Add relationship"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
