import React, { useState } from 'react'
import { api } from '../api.js'

const NODE_TYPES = ['Entity', 'Person', 'Organization', 'Location', 'Date', 'Event', 'Product', 'Group']

export default function NodeEdgePanel({ sessionId, nodes, onChanged }) {
  const [mode, setMode] = useState('node') // 'node' | 'edge'
  const [status, setStatus] = useState('')

  // Node form
  const [nodeName, setNodeName] = useState('')
  const [nodeType, setNodeType] = useState('Entity')
  const [nodeSummary, setNodeSummary] = useState('')

  // Edge form
  const [edgeSrc, setEdgeSrc] = useState('')
  const [edgeTgt, setEdgeTgt] = useState('')
  const [edgeName, setEdgeName] = useState('')
  const [edgeFact, setEdgeFact] = useState('')

  async function createNode() {
    if (!nodeName.trim()) return
    setStatus('Creating node...')
    try {
      await api.createNode(sessionId, {
        name: nodeName.trim(),
        type: nodeType,
        summary: nodeSummary.trim(),
      })
      setNodeName('')
      setNodeSummary('')
      setStatus('Node created.')
      onChanged()
    } catch (e) {
      setStatus(String(e))
    }
  }

  async function createEdge() {
    if (!edgeSrc || !edgeTgt || !edgeName.trim()) return
    setStatus('Creating edge...')
    try {
      await api.createEdge(sessionId, {
        source_uuid: edgeSrc,
        target_uuid: edgeTgt,
        name: edgeName.trim(),
        fact: edgeFact.trim() || edgeName.trim(),
      })
      setEdgeName('')
      setEdgeFact('')
      setStatus('Edge created.')
      onChanged()
    } catch (e) {
      setStatus(String(e))
    }
  }

  async function deleteNode(uuid) {
    if (!confirm('Delete this node and its edges?')) return
    try {
      await api.deleteNode(sessionId, uuid)
      setStatus('Node deleted.')
      onChanged()
    } catch (e) {
      setStatus(String(e))
    }
  }

  return (
    <div className="card">
      <h2>Manual Editing</h2>
      <div className="row" style={{ gap: 6, marginBottom: 10 }}>
        <button className={mode === 'node' ? 'primary' : ''} onClick={() => setMode('node')}>
          + Node
        </button>
        <button className={mode === 'edge' ? 'primary' : ''} onClick={() => setMode('edge')}>
          + Edge
        </button>
      </div>

      {mode === 'node' && (
        <div>
          <input
            placeholder="Node name"
            value={nodeName}
            onChange={(e) => setNodeName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createNode()}
          />
          <label>Type</label>
          <select value={nodeType} onChange={(e) => setNodeType(e.target.value)}>
            {NODE_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <input
            placeholder="Summary (optional)"
            value={nodeSummary}
            onChange={(e) => setNodeSummary(e.target.value)}
          />
          <div style={{ marginTop: 8 }}>
            <button className="primary" onClick={createNode} disabled={!nodeName.trim()}>
              Create Node
            </button>
          </div>
        </div>
      )}

      {mode === 'edge' && (
        <div>
          <label>Source</label>
          <select value={edgeSrc} onChange={(e) => setEdgeSrc(e.target.value)}>
            <option value="">Select source node...</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>{n.label}</option>
            ))}
          </select>
          <label>Target</label>
          <select value={edgeTgt} onChange={(e) => setEdgeTgt(e.target.value)}>
            <option value="">Select target node...</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>{n.label}</option>
            ))}
          </select>
          <input
            placeholder="Relationship name (e.g. founded)"
            value={edgeName}
            onChange={(e) => setEdgeName(e.target.value)}
          />
          <input
            placeholder="Fact (optional, e.g. Alice founded Acme in 2020)"
            value={edgeFact}
            onChange={(e) => setEdgeFact(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createEdge()}
          />
          <div style={{ marginTop: 8 }}>
            <button
              className="primary"
              onClick={createEdge}
              disabled={!edgeSrc || !edgeTgt || !edgeName.trim()}
            >
              Create Edge
            </button>
          </div>
        </div>
      )}

      <div className="statusline">{status}</div>

      {nodes.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <h3>Nodes ({nodes.length})</h3>
          <div style={{ maxHeight: 200, overflow: 'auto' }}>
            {nodes.map((n) => (
              <div key={n.id} className="row spread" style={{ padding: '2px 0' }}>
                <span style={{ fontSize: 13 }}>
                  <span className="badge">{n.type}</span> {n.label}
                </span>
                <button
                  className="danger"
                  style={{ fontSize: 11, padding: '1px 5px' }}
                  onClick={() => deleteNode(n.id)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
