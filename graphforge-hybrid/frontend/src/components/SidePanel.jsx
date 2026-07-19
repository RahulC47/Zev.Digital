import React, { useState } from 'react'
import { api } from '../api.js'
import BiTemporalPanel from './BiTemporalPanel.jsx'

const MIME = { md: 'text/markdown', json: 'application/json', cypher: 'text/plain' }
const EXT  = { md: 'md', json: 'json', cypher: 'cypher' }

async function downloadExport(sessionId, sessionName, format) {
  const url = api.exportUrl(sessionId, format)
  const res = await fetch(url)
  if (!res.ok) throw new Error(await res.text())
  const text = await res.text()

  const safe = (sessionName || sessionId).replace(/[^a-zA-Z0-9_-]/g, '_')
  const filename = `${safe}.${EXT[format]}`

  // --- Desktop (pywebview): use native Python Save dialog ---
  if (window.pywebview?.api?.save_file) {
    const result = await window.pywebview.api.save_file(filename, text)
    if (!result.ok) {
      if (result.reason === 'cancelled') return null   // user dismissed, not an error
      throw new Error(result.reason)
    }
    return result.path
  }

  // --- Browser / dev fallback: Blob URL download ---
  const blob = new Blob([text], { type: MIME[format] })
  const blobUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(blobUrl), 5000)
  return filename
}

export default function SidePanel({ session, stats, nodes = [] }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [status, setStatus] = useState('')
  const [exportStatus, setExportStatus] = useState('')

  async function runSearch() {
    if (!q.trim()) return
    setStatus('Searching…')
    try {
      const r = await api.search(session.id, q)
      setResults(r)
      setStatus(r.length ? '' : 'No results.')
    } catch (e) {
      setStatus(String(e))
    }
  }

  async function handleExport(format) {
    setExportStatus(`Exporting…`)
    try {
      const saved = await downloadExport(session.id, session.name, format)
      if (saved === null) {
        setExportStatus('') // cancelled
      } else {
        const display = typeof saved === 'string' && saved.includes('\\')
          ? saved.split('\\').pop()   // show just the filename from full path
          : saved
        setExportStatus(`✓ Saved: ${display}`)
      }
    } catch (e) {
      setExportStatus(`Export failed: ${e.message}`)
    }
  }

  const liveUrl = `${api.base}/sessions/${session.id}/search?q=YOUR+QUERY`
  const mcpHint = `graphiti search scoped to group_id="${session.id}"`

  return (
    <div className="pad">
      <div className="card">
        <h2>Graph</h2>
        <div className="muted">{stats.nodes} entities · {stats.links} facts</div>
      </div>

      <div className="card">
        <h2>Live context search</h2>
        <input
          placeholder="ask the graph…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runSearch()}
        />
        <div style={{ marginTop: 8 }}>
          <button className="primary" onClick={runSearch} disabled={!q.trim()}>Search</button>
        </div>
        <div className="statusline">{status}</div>
        {results.map((r) => (
          <div key={r.uuid} className="fact">
            {r.fact || r.name}
            {r.valid_at && r.valid_at !== 'None' && (
              <div className="muted">valid: {r.valid_at}</div>
            )}
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Export</h2>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          <button onClick={() => handleExport('md')}>Markdown</button>
          <button onClick={() => handleExport('json')}>JSON</button>
          <button onClick={() => handleExport('cypher')}>Cypher</button>
        </div>
        <div className="statusline">{exportStatus}</div>
        <label>Live retrieval API</label>
        <input readOnly value={liveUrl} onFocus={(e) => e.target.select()} />
        <label>MCP / programmatic</label>
        <div className="muted">{mcpHint}</div>
      </div>

      <BiTemporalPanel sessionId={session.id} nodes={nodes} />
    </div>
  )
}
