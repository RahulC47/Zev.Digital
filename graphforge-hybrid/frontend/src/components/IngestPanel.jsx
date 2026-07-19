import React, { useRef, useState } from 'react'
import { api } from '../api.js'

export default function IngestPanel({ sessionId, onIngested }) {
  const [text, setText] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const [recording, setRecording] = useState(false)
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const fileInput = useRef(null)

  async function pollJob(jobId, label) {
    setBusy(true)
    for (;;) {
      const job = await api.job(jobId)
      if (job.status === 'done') {
        setStatus(`${label}: done${job.detail ? ' — ' + job.detail.slice(0, 80) : ''}`)
        break
      }
      if (job.status === 'error') {
        setStatus(`${label}: error — ${job.error}`)
        break
      }
      setStatus(`${label}: ${job.status} ${job.processed}/${job.total} ${job.detail || ''}`)
      await new Promise((r) => setTimeout(r, 1200))
    }
    setBusy(false)
    onIngested()
  }

  async function submitText() {
    if (!text.trim()) return
    try {
      const { job_id } = await api.addText(sessionId, { text, name: 'note' })
      setText('')
      pollJob(job_id, 'Text')
    } catch (e) { setStatus(String(e)) }
  }

  async function submitFiles(files) {
    if (!files || !files.length) return
    try {
      const { job_id } = await api.addFiles(sessionId, files)
      pollJob(job_id, 'Files')
    } catch (e) { setStatus(String(e)) }
  }

  async function toggleRecord() {
    if (recording) {
      recorderRef.current?.stop()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      chunksRef.current = []
      mr.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data)
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        try {
          const { job_id } = await api.addAudio(sessionId, blob)
          pollJob(job_id, 'Voice')
        } catch (e) { setStatus(String(e)) }
      }
      mr.start()
      recorderRef.current = mr
      setRecording(true)
      mr.addEventListener('stop', () => setRecording(false))
    } catch (e) {
      setStatus('Mic error: ' + e)
    }
  }

  return (
    <div className="toolbar">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <textarea
          placeholder="Type or paste text to add to the graph…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ flex: 1 }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button className="primary" onClick={submitText} disabled={busy || !text.trim()}>Add text</button>
          <button onClick={() => fileInput.current?.click()} disabled={busy}>Upload files</button>
          <button onClick={toggleRecord} disabled={busy} className={recording ? 'rec' : ''}>
            {recording ? '■ Stop' : '● Record'}
          </button>
        </div>
      </div>

      <div
        className={`dropzone ${drag ? 'drag' : ''}`}
        style={{ marginTop: 10 }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); submitFiles(e.dataTransfer.files) }}
        onClick={() => fileInput.current?.click()}
      >
        Drop files here (pdf, docx, md, txt, code…) or click to browse
      </div>
      <input
        ref={fileInput}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => submitFiles(e.target.files)}
      />
      <div className="statusline">{status}</div>
    </div>
  )
}
