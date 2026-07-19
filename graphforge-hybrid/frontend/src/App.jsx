import React, { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import SessionList from './components/SessionList.jsx'
import SettingsModal from './components/SettingsModal.jsx'
import IngestPanel from './components/IngestPanel.jsx'
import GraphCanvas from './components/GraphCanvas.jsx'
import SidePanel from './components/SidePanel.jsx'
import NodeEdgePanel from './components/NodeEdgePanel.jsx'
import ThemeToggle from './components/ThemeToggle.jsx'

const MIN_SIDE = 180
const MAX_SIDE = 500

export default function App() {
  const [sessions, setSessions] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [graph, setGraph] = useState({ nodes: [], links: [] })
  const [showSettings, setShowSettings] = useState(false)
  const [error, setError] = useState('')

  // --- Theme ---
  const [theme, setTheme] = useState(() => localStorage.getItem('gf-theme') || 'dark')
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('gf-theme', theme)
  }, [theme])

  // --- Resizable sidebars ---
  const [leftWidth, setLeftWidth] = useState(() => {
    const v = parseInt(localStorage.getItem('gf-left-w'), 10)
    return v && v >= MIN_SIDE && v <= MAX_SIDE ? v : 260
  })
  const [rightWidth, setRightWidth] = useState(() => {
    const v = parseInt(localStorage.getItem('gf-right-w'), 10)
    return v && v >= MIN_SIDE && v <= MAX_SIDE ? v : 320
  })

  useEffect(() => { localStorage.setItem('gf-left-w', leftWidth) }, [leftWidth])
  useEffect(() => { localStorage.setItem('gf-right-w', rightWidth) }, [rightWidth])

  const dragging = useRef(null) // 'left' | 'right' | null
  const startX = useRef(0)
  const startW = useRef(0)

  const onMouseMove = useCallback((e) => {
    if (!dragging.current) return
    e.preventDefault()
    const delta = e.clientX - startX.current
    if (dragging.current === 'left') {
      setLeftWidth(Math.min(MAX_SIDE, Math.max(MIN_SIDE, startW.current + delta)))
    } else {
      setRightWidth(Math.min(MAX_SIDE, Math.max(MIN_SIDE, startW.current - delta)))
    }
  }, [])

  const onMouseUp = useCallback(() => {
    dragging.current = null
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  useEffect(() => {
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [onMouseMove, onMouseUp])

  function startDrag(side, e) {
    dragging.current = side
    startX.current = e.clientX
    startW.current = side === 'left' ? leftWidth : rightWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  // --- Data ---
  async function refreshSessions() {
    try {
      const list = await api.listSessions()
      setSessions(list)
      if (!activeId && list.length) setActiveId(list[0].id)
      setError('')
    } catch (e) {
      setError('Backend unreachable at ' + api.base + ' — is docker compose up? ' + e)
    }
  }

  async function refreshGraph(id = activeId) {
    if (!id) return
    try {
      setGraph(await api.graph(id))
    } catch (e) {
      setError(String(e))
    }
  }

  useEffect(() => { refreshSessions() }, [])
  useEffect(() => { if (activeId) refreshGraph(activeId) }, [activeId])

  const active = sessions.find((s) => s.id === activeId)

  return (
    <div
      className="app"
      style={{ gridTemplateColumns: `${leftWidth}px 5px 1fr 5px ${rightWidth}px` }}
    >
      {/* Left sidebar */}
      <div className="col">
        <div className="pad row spread" style={{ borderBottom: '1px solid var(--border)' }}>
          <h1>GraphForge</h1>
          <div className="row" style={{ gap: 6 }}>
            <ThemeToggle
              theme={theme}
              onToggle={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            />
            <button onClick={() => setShowSettings(true)}>⚙</button>
          </div>
        </div>
        <SessionList
          sessions={sessions}
          activeId={activeId}
          onSelect={setActiveId}
          onChanged={refreshSessions}
        />
      </div>

      {/* Left resizer */}
      <div
        className={`resizer${dragging.current === 'left' ? ' active' : ''}`}
        onMouseDown={(e) => startDrag('left', e)}
      />

      {/* Center */}
      <div className="col center">
        {error && <div className="pad" style={{ color: 'var(--danger)' }}>{error}</div>}
        {active ? (
          <>
            <IngestPanel sessionId={active.id} onIngested={() => refreshGraph(active.id)} />
            <GraphCanvas data={graph} />
          </>
        ) : (
          <div className="pad muted">Create or select a session to begin.</div>
        )}
      </div>

      {/* Right resizer */}
      <div
        className={`resizer${dragging.current === 'right' ? ' active' : ''}`}
        onMouseDown={(e) => startDrag('right', e)}
      />

      {/* Right sidebar */}
      <div className="col right">
        {active && (
          <>
            <NodeEdgePanel
              sessionId={active.id}
              nodes={graph.nodes}
              onChanged={() => refreshGraph(active.id)}
            />
            <SidePanel
              session={active}
              stats={{ nodes: graph.nodes.length, links: graph.links.length }}
              nodes={graph.nodes}
            />
          </>
        )}
      </div>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  )
}
