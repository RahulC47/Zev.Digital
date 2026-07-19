import React, { useState } from 'react'
import { api } from '../api.js'

const PROVIDERS = ['local', 'openrouter', 'deepseek', 'openai', 'anthropic', 'gemini', 'ollama']

export default function SessionList({ sessions, activeId, onSelect, onChanged }) {
  const [name, setName] = useState('')
  const [provider, setProvider] = useState('local')

  async function create() {
    if (!name.trim()) return
    const s = await api.createSession({ name: name.trim(), provider })
    setName('')
    await onChanged()
    onSelect(s.id)
  }

  async function remove(e, id) {
    e.stopPropagation()
    if (!confirm('Delete this session and its graph?')) return
    await api.deleteSession(id)
    await onChanged()
  }

  return (
    <div className="pad">
      <div className="card">
        <h2>New session</h2>
        <input
          placeholder="session name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
        />
        <label>Provider</label>
        <select value={provider} onChange={(e) => setProvider(e.target.value)}>
          {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <div style={{ marginTop: 10 }}>
          <button className="primary" onClick={create} disabled={!name.trim()}>Create</button>
        </div>
      </div>

      <h2>Sessions ({sessions.length})</h2>
      {sessions.map((s) => (
        <div
          key={s.id}
          className={`session ${s.id === activeId ? 'active' : ''}`}
          onClick={() => onSelect(s.id)}
        >
          <div className="row spread">
            <span className="name">{s.name}</span>
            <button className="danger" onClick={(e) => remove(e, s.id)}>✕</button>
          </div>
          <div className="meta">{s.provider} · {s.llm_model}</div>
        </div>
      ))}
    </div>
  )
}
