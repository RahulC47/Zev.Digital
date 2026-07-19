// Same-origin in the packaged app (UI served by the backend). In dev, point the
// vite server at the backend with VITE_API_BASE=http://localhost:8009.
const API = import.meta.env.VITE_API_BASE || '/api'

async function j(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error((await res.text()) || res.statusText)
  return res.status === 204 ? null : res.json()
}

export const api = {
  base: API,
  providers: () => j('GET', '/providers'),
  setKey: (provider, api_key) => j('POST', '/settings/keys', { provider, api_key }),
  testKey: (provider, api_key) => j('POST', '/settings/test', { provider, api_key }),

  listSessions: () => j('GET', '/sessions'),
  createSession: (payload) => j('POST', '/sessions', payload),
  updateSession: (id, payload) => j('PATCH', `/sessions/${id}`, payload),
  deleteSession: (id) => j('DELETE', `/sessions/${id}`),

  addText: (id, payload) => j('POST', `/sessions/${id}/text`, payload),
  job: (jobId) => j('GET', `/jobs/${jobId}`),
  graph: (id) => j('GET', `/sessions/${id}/graph`),
  search: (id, q, limit = 10) =>
    j('GET', `/sessions/${id}/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  exportUrl: (id, format) => `${API}/sessions/${id}/export?format=${format}`,

  // Manual node/edge CRUD
  createNode: (id, payload) => j('POST', `/sessions/${id}/nodes`, payload),
  updateNode: (id, nodeUuid, payload) => j('PATCH', `/sessions/${id}/nodes/${nodeUuid}`, payload),
  deleteNode: (id, nodeUuid) => j('DELETE', `/sessions/${id}/nodes/${nodeUuid}`),
  createEdge: (id, payload) => j('POST', `/sessions/${id}/edges`, payload),
  updateEdge: (id, edgeUuid, payload) => j('PATCH', `/sessions/${id}/edges/${edgeUuid}`, payload),
  deleteEdge: (id, edgeUuid) => j('DELETE', `/sessions/${id}/edges/${edgeUuid}`),

  async addFiles(id, fileList) {
    const fd = new FormData()
    for (const f of fileList) fd.append('files', f)
    const res = await fetch(`${API}/sessions/${id}/files`, { method: 'POST', body: fd })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

  async addAudio(id, blob) {
    const fd = new FormData()
    fd.append('file', blob, 'recording.webm')
    const res = await fetch(`${API}/sessions/${id}/audio`, { method: 'POST', body: fd })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

  // Bitemporal API
  btQuery: (id, validAsOf, knownAsOf) => {
    const params = new URLSearchParams()
    if (validAsOf)  params.set('valid_as_of',  validAsOf)
    if (knownAsOf)  params.set('known_as_of', knownAsOf)
    const qs = params.toString()
    return j('GET', `/sessions/${id}/bitemporal${qs ? '?' + qs : ''}`)
  },
  btStats:   (id) => j('GET', `/sessions/${id}/bitemporal/stats`),
  btHistory: (id, edgeUuid) => j('GET', `/sessions/${id}/bitemporal/history/${edgeUuid}`),
  btSync:    (id) => j('POST', `/sessions/${id}/bitemporal/sync`),
}
