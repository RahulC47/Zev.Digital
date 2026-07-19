import React, { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'

const COLORS = ['#5b8cff', '#7c5cff', '#34d399', '#f59e0b', '#ff5b6e', '#22d3ee', '#e879f9']

function getCSSVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export default function GraphCanvas({ data, onNodeClick }) {
  const wrap = useRef(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [graphBg, setGraphBg] = useState('#0b0d13')
  const [labelColor, setLabelColor] = useState('#cdd3e0')
  const [linkColor, setLinkColor] = useState('rgba(150,160,190,0.35)')

  // Watch for theme changes via MutationObserver on data-theme attribute
  useEffect(() => {
    function updateColors() {
      setGraphBg(getCSSVar('--graph-bg') || '#0b0d13')
      setLabelColor(getCSSVar('--graph-label') || '#cdd3e0')
      setLinkColor(getCSSVar('--link-color') || 'rgba(150,160,190,0.35)')
    }
    updateColors()
    const obs = new MutationObserver(updateColors)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    if (!wrap.current) return
    const ro = new ResizeObserver(([e]) =>
      setSize({ w: e.contentRect.width, h: e.contentRect.height })
    )
    ro.observe(wrap.current)
    return () => ro.disconnect()
  }, [])

  const colorByType = useMemo(() => {
    const types = [...new Set((data.nodes || []).map((n) => n.type))]
    const map = {}
    types.forEach((t, i) => (map[t] = COLORS[i % COLORS.length]))
    return map
  }, [data])

  // ForceGraph mutates objects; clone so re-fetches don't accumulate state.
  const graph = useMemo(
    () => ({
      nodes: (data.nodes || []).map((n) => ({ ...n })),
      links: (data.links || []).map((l) => ({ ...l })),
    }),
    [data]
  )

  return (
    <div className="graphwrap" ref={wrap}>
      {graph.nodes.length === 0 ? (
        <div className="pad muted">No graph yet. Add text, files, or voice to build it.</div>
      ) : (
        <ForceGraph2D
          width={size.w}
          height={size.h}
          graphData={graph}
          backgroundColor={graphBg}
          nodeLabel={(n) => `${n.label}${n.summary ? ' — ' + n.summary : ''}`}
          linkLabel={(l) => l.fact || l.name}
          linkColor={() => linkColor}
          linkDirectionalArrowLength={3}
          linkDirectionalArrowRelPos={1}
          onNodeClick={onNodeClick}
          nodeCanvasObject={(node, ctx, scale) => {
            const r = 4
            ctx.fillStyle = colorByType[node.type] || '#5b8cff'
            ctx.beginPath()
            ctx.arc(node.x, node.y, r, 0, 2 * Math.PI)
            ctx.fill()
            const label = node.label || ''
            const fs = 12 / scale
            ctx.font = `${fs}px sans-serif`
            ctx.fillStyle = labelColor
            ctx.fillText(label, node.x + r + 1, node.y + fs / 3)
          }}
        />
      )}
    </div>
  )
}
