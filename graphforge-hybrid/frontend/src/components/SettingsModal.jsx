import React, { useEffect, useState } from 'react'
import { api } from '../api.js'

export default function SettingsModal({ onClose }) {
  const [info, setInfo] = useState(null)
  const [provider, setProvider] = useState('openai')
  const [key, setKey] = useState('')
  const [status, setStatus] = useState('')
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    api.providers().then(setInfo).catch((e) => setStatus(String(e)))
  }, [])

  async function save() {
    setStatus('Saving…')
    try {
      await api.setKey(provider, key)
      const fresh = await api.providers()
      setInfo(fresh)
      setKey('')
      setStatus(`Saved key for ${provider}.`)
    } catch (e) {
      setStatus(String(e))
    }
  }

  async function test() {
    if (!key) return
    setTesting(true)
    setStatus('Testing key…')
    try {
      const r = await api.testKey(provider, key)
      setStatus(r.ok ? `✓ ${provider} key works!` : `✗ ${provider}: ${r.result}`)
    } catch (e) {
      setStatus(String(e))
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row spread">
          <h1>API Keys & Providers</h1>
          <button onClick={onClose}>✕</button>
        </div>
        <p className="muted">
          Keys are held in the backend memory only (never written to disk).
          Local and Ollama modes need no key.
        </p>

        <label>Provider</label>
        <select value={provider} onChange={(e) => setProvider(e.target.value)}>
          <option value="openrouter">OpenRouter (any model, local embeddings)</option>
          <option value="deepseek">DeepSeek (local embeddings)</option>
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic (needs OpenAI/Ollama for embeddings)</option>
          <option value="gemini">Google Gemini</option>
        </select>

        {provider === 'local' ? (
          <div className="statusline" style={{ marginTop: 12 }}>
            Local mode uses spaCy + fastembed — no API key required.
          </div>
        ) : (
          <>
            {provider === 'openrouter' && (
              <p className="muted" style={{ marginTop: 6, marginBottom: 4 }}>
                Get your key at{' '}
                <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">openrouter.ai/keys</a>.
                Embeddings use local fastembed (offline, no extra cost).
              </p>
            )}
            {provider === 'deepseek' && (
              <p className="muted" style={{ marginTop: 6, marginBottom: 4 }}>
                Get your key at{' '}
                <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">platform.deepseek.com</a>.
                Uses <code>deepseek-chat</code> by default. Embeddings use local fastembed (offline).
              </p>
            )}
            <label>API key</label>
            <input
              type="password"
              value={key}
              placeholder={
                provider === 'openrouter' ? 'sk-or-…' :
                provider === 'deepseek' ? 'sk-…' :
                'paste key…'
              }
              onChange={(e) => setKey(e.target.value)}
            />

            <div className="row" style={{ marginTop: 12, gap: 8 }}>
              <button onClick={test} disabled={!key || testing}>Test</button>
              <button className="primary" onClick={save} disabled={!key}>Save key</button>
            </div>
          </>
        )}

        <div className="statusline">{status}</div>

        {info && (
          <div style={{ marginTop: 10 }}>
            <h2>Keys set</h2>
            {Object.entries(info.keys).map(([p, set]) => (
              <span key={p} className={`badge ${set ? 'ok' : ''}`} style={{ marginRight: 6 }}>
                {p}: {set ? 'set' : 'none'}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
