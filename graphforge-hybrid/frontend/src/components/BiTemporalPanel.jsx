/**
 * BiTemporalPanel — Time-travel query UI for the bitemporal knowledge graph layer.
 *
 * Two independent sliders control the two time axes:
 *   valid_as_of  — "what was true in the world at this moment?"
 *   known_as_of  — "using only information recorded before this moment?"
 *
 * Facts are colour-coded by their bitemporal quadrant:
 *   green  — CURRENT    (valid now AND believed now)
 *   yellow — HISTORICAL (was valid, period ended, still believed)
 *   orange — RETRACTED  (we no longer believe this version — correction was made)
 */
import React, { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'

const EPOCH_END = '9999-12-31T00:00:00+00:00'

/** ISO-8601 string → "YYYY-MM-DDTHH:MM" (datetime-local input format) */
function toLocal(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toISOString().slice(0, 16)
  } catch {
    return ''
  }
}

/** datetime-local string → UTC ISO-8601 */
function fromLocal(local) {
  if (!local) return null
  try {
    return new Date(local).toISOString()
  } catch {
    return null
  }
}

function nowLocal() {
  return toLocal(new Date().toISOString())
}

function isEpochEnd(iso) {
  return !iso || iso.startsWith('9999')
}

/** Decide colour badge for a fact */
function quadrant(row) {
  const now = new Date()
  const validTo    = isEpochEnd(row.valid_to)    ? null : new Date(row.valid_to)
  const invalidAt  = isEpochEnd(row.invalidated_at) ? null : new Date(row.invalidated_at)

  if (invalidAt && invalidAt <= now) return 'retracted'
  if (validTo   && validTo   <= now) return 'historical'
  return 'current'
}

const BADGE_STYLE = {
  current:    { background: '#22c55e22', color: '#22c55e', border: '1px solid #22c55e55' },
  historical: { background: '#eab30822', color: '#d97706', border: '1px solid #d9770655' },
  retracted:  { background: '#6b728022', color: '#9ca3af', border: '1px solid #6b728055' },
}

const LABEL = { current: 'current', historical: 'historical', retracted: 'retracted' }

function shortIso(iso) {
  if (!iso || isEpochEnd(iso)) return '∞'
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) }
  catch { return iso.slice(0, 16) }
}

export default function BiTemporalPanel({ sessionId, nodes = [] }) {
  const [open, setOpen] = useState(false)
  const [validAsOf, setValidAsOf]   = useState(nowLocal)
  const [knownAsOf, setKnownAsOf]   = useState(nowLocal)
  const [results, setResults]       = useState([])
  const [stats, setStats]           = useState(null)
  const [status, setStatus]         = useState('')
  const [historyEdge, setHistoryEdge] = useState(null)  // uuid being inspected
  const [history, setHistory]       = useState([])

  // Node UUID → name lookup
  const nodeMap = Object.fromEntries((nodes || []).map(n => [n.id, n.label || n.id]))

  const loadStats = useCallback(async () => {
    if (!sessionId) return
    try {
      const s = await api.btStats(sessionId)
      setStats(s)
    } catch { /* no-op */ }
  }, [sessionId])

  useEffect(() => {
    if (open) loadStats()
  }, [open, loadStats])

  async function runQuery() {
    setStatus('Querying…')
    setHistory([])
    setHistoryEdge(null)
    try {
      const rows = await api.btQuery(
        sessionId,
        fromLocal(validAsOf),
        fromLocal(knownAsOf),
      )
      setResults(rows)
      setStatus(rows.length ? '' : 'No facts match these time constraints.')
      await loadStats()
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    }
  }

  async function showHistory(edgeUuid) {
    if (historyEdge === edgeUuid) {
      setHistoryEdge(null)
      setHistory([])
      return
    }
    setHistoryEdge(edgeUuid)
    try {
      const h = await api.btHistory(sessionId, edgeUuid)
      setHistory(h)
    } catch (e) {
      setHistory([])
    }
  }

  async function syncNow() {
    setStatus('Syncing…')
    try {
      const r = await api.btSync(sessionId)
      setStatus(`Synced ${r.synced} record${r.synced !== 1 ? 's' : ''}`)
      await runQuery()
    } catch (e) {
      setStatus(`Sync error: ${e.message}`)
    }
  }

  if (!sessionId) return null

  return (
    <div className="card" style={{ marginTop: 12 }}>
      {/* Header */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <h2 style={{ margin: 0 }}>⏱ Time Travel</h2>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
          {stats
            ? `${stats.current} cur · ${stats.historical} hist · ${stats.retracted} ret`
            : open ? '' : 'click to open'}
          {' '}{open ? '▲' : '▼'}
        </span>
      </div>

      {open && (
        <div style={{ marginTop: 10 }}>
          {/* Valid time axis */}
          <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Valid as of <span style={{ color: 'var(--muted)', fontSize: 11 }}>(world time)</span></span>
            <button
              style={{ padding: '2px 7px', fontSize: 11, marginLeft: 6 }}
              onClick={() => setValidAsOf(nowLocal())}
            >now</button>
          </label>
          <input
            type="datetime-local"
            value={validAsOf}
            onChange={e => setValidAsOf(e.target.value)}
            style={{ marginBottom: 8 }}
          />

          {/* Transaction time axis */}
          <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Known as of <span style={{ color: 'var(--muted)', fontSize: 11 }}>(recorded time)</span></span>
            <button
              style={{ padding: '2px 7px', fontSize: 11, marginLeft: 6 }}
              onClick={() => setKnownAsOf(nowLocal())}
            >now</button>
          </label>
          <input
            type="datetime-local"
            value={knownAsOf}
            onChange={e => setKnownAsOf(e.target.value)}
            style={{ marginBottom: 10 }}
          />

          <div className="row" style={{ gap: 6, marginBottom: 6 }}>
            <button className="primary" onClick={runQuery} style={{ flex: 1 }}>Query</button>
            <button onClick={syncNow} title="Sync latest edges from graph DB into BT layer">↺ Sync</button>
          </div>

          <div className="statusline">{status}</div>

          {stats && (
            <div className="muted" style={{ marginBottom: 8, fontSize: 11 }}>
              <span style={{ color: '#22c55e' }}>● {stats.current} current</span>
              {'  '}
              <span style={{ color: '#d97706' }}>● {stats.historical} historical</span>
              {'  '}
              <span style={{ color: '#9ca3af' }}>● {stats.retracted} retracted</span>
            </div>
          )}

          {/* Results */}
          {results.map(row => {
            const q = quadrant(row)
            const src = nodeMap[row.source_node_uuid] || row.source_node_uuid?.slice(0, 8) || '?'
            const tgt = nodeMap[row.target_node_uuid] || row.target_node_uuid?.slice(0, 8) || '?'
            const isInspecting = historyEdge === row.entity_edge_uuid

            return (
              <div
                key={row.bt_uuid}
                className="fact"
                style={{ marginBottom: 6, borderColor: BADGE_STYLE[q].border.split(' ')[2] }}
              >
                {/* Fact header */}
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                  <span
                    style={{
                      fontSize: 10,
                      padding: '1px 6px',
                      borderRadius: 99,
                      ...BADGE_STYLE[q],
                    }}
                  >
                    {LABEL[q]}
                  </span>
                  <button
                    style={{ fontSize: 10, padding: '1px 6px' }}
                    onClick={() => showHistory(row.entity_edge_uuid)}
                    title="Show correction history for this fact"
                  >
                    {isInspecting ? 'hide history' : 'history'}
                  </button>
                </div>

                {/* Fact text */}
                <div style={{ fontWeight: 500, marginBottom: 3 }}>
                  {row.fact || `${src} → ${row.relation || '?'} → ${tgt}`}
                </div>

                {/* Temporal info */}
                <div className="muted" style={{ fontSize: 11 }}>
                  <span title="Valid time">🌍 {shortIso(row.valid_from)} → {shortIso(row.valid_to)}</span>
                  {'  '}
                  <span title="Transaction time">📝 recorded {shortIso(row.recorded_at)}</span>
                  {!isEpochEnd(row.invalidated_at) && (
                    <span title="This version was retracted"> · ⚠ retracted {shortIso(row.invalidated_at)}</span>
                  )}
                </div>

                {/* Correction history */}
                {isInspecting && history.length > 0 && (
                  <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                    <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>
                      Correction chain ({history.length} version{history.length !== 1 ? 's' : ''}):
                    </div>
                    {history.map((h, i) => (
                      <div
                        key={h.bt_uuid}
                        style={{
                          fontSize: 11,
                          padding: '4px 8px',
                          marginBottom: 3,
                          borderRadius: 6,
                          background: 'var(--panel2)',
                          opacity: isEpochEnd(h.invalidated_at) ? 1 : 0.55,
                        }}
                      >
                        <span className="muted">v{i + 1}</span>
                        {' '}valid {shortIso(h.valid_from)} → {shortIso(h.valid_to)}
                        {'  '}recorded {shortIso(h.recorded_at)}
                        {!isEpochEnd(h.invalidated_at) && (
                          <span style={{ color: '#d97706' }}> → superseded {shortIso(h.invalidated_at)}</span>
                        )}
                        {isEpochEnd(h.invalidated_at) && (
                          <span style={{ color: '#22c55e' }}> ✓ current version</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          {/* Legend */}
          {results.length > 0 && (
            <div className="muted" style={{ fontSize: 10, marginTop: 8, lineHeight: 1.6 }}>
              🌍 = valid time (when true in world) · 📝 = recorded time · ⚠ = belief retracted
            </div>
          )}
        </div>
      )}
    </div>
  )
}
