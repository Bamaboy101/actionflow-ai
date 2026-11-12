import { useState, useEffect } from 'react'

const API = import.meta.env.VITE_API_BASE || ''

type Action = { id: string; title: string; due_utc: string | null; source_span: string | null; timezone: string | null; ambiguity: string | null; status: string }
type Sample = { id: string; title: string; text: string }

export default function App() {
  const [step, setStep] = useState<'input' | 'review' | 'export'>('input')
  const [samples, setSamples] = useState<Sample[]>([])
  const [selected, setSelected] = useState<Sample | null>(null)
  const [inputText, setInputText] = useState('')
  const [consent, setConsent] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function loadSamples() {
    try { setSamples(await (await fetch(`${API}/api/samples`)).json()) } catch {}
  }

  useEffect(() => { loadSamples() }, [])

  async function handleExtract() {
    const text = (selected?.text || inputText).trim()
    if (!text) return setError('Enter text or pick a sample')
    if (!consent) return setError('Processing consent required')
    setLoading(true); setError(null)
    try {
      const r = await fetch(`${API}/api/extract`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_text: text, processing_consent: true, source_type: 'paste' })
      })
      setResult(await r.json())
      setStep('review')
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }

  async function handleEdit(id: string, field: string, value: string) {
    setLoading(true)
    try {
      const r = await fetch(`${API}/api/validate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: result.request_id, action_id: id, edits: { [field]: value } })
      })
      const data = await r.json()
      setResult({ ...result, actions: result.actions.map((a: any) => a.id === id ? data.action : a) })
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }

  async function handleApprove() {
    const ids = result.actions.map((a: any) => a.id)
    const r = await fetch(`${API}/api/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: result.request_id, action_ids: ids })
    })
    setResult(await r.json())
    setStep('export')
  }

  async function handleExport(type: 'ics' | 'checklist') {
    const ids = result.approved.map((a: any) => a.id)
    const r = await fetch(`${API}/api/export`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: result.request_id, action_ids: ids, output_type: type })
    })
    const blob = await r.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = type === 'ics' ? 'actionflow.ics' : 'actionflow.md'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 900, margin: '0 auto', padding: 20 }}>
      <h1>ActionFlow AI <span style={{ color: '#666', fontSize: 0.6 }}>• demo</span></h1>
      <p style={{ color: '#555' }}>Paste or upload a notice, review proposed actions, approve, then export locally. Nothing is sent to third parties automatically.</p>
      {error && <span style={{ color: '#dc2626' }}>{error}</span>}

      {step === 'input' && (
        <section>
          <h2>1. Input</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Sample notices</label>
              <select onChange={e => setSelected(samples.find(s => s.id === e.target.value) || null)} style={{ width: '100%', marginBottom: 8 }}>
                <option value="">Choose a sample</option>
                {samples.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
              <textarea rows={6} value={inputText} onChange={e => setInputText(e.target.value)} style={{ width: '100%', fontFamily: 'monospace', fontSize: 0.9 }} placeholder="Paste a notice, invitation or reminder…"></textarea>
            </div>
            <div>
              <label style={{ display: 'flex', alignItems: 'start', gap: 8, marginBottom: 12 }}>
                <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
                I consent to processing this text locally (no external send)
              </label>
              <button onClick={handleExtract} disabled={loading || !consent || !(selected || inputText)} style={{ padding: '8px 14px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', width: '100%' }}>
                {loading ? 'Extracting…' : 'Extract actions'}
              </button>
              <p style={{ fontSize: 0.85, color: '#666' }}>Raw text is not persisted or logged by default.</p>
            </div>
          </div>
        </section>
      )}

      {step === 'review' && result && (
        <section>
          <h2>2. Review & approve</h2>
          <p style={{ color: '#555', marginBottom: 12 }}>{result.summary}</p>
          {result.parties.length && <p><b>Parties:</b> {result.parties.join(', ')}</p>}
          {result.requirements.length && <p><b>Requirements:</b> {result.requirements.join('; ')}</p>}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: 6 }}>Action</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: 6 }}>Source span</th>
                <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc', padding: 6 }}>Timezone</th>
                <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc', padding: 6 }}>Review</th>
              </tr>
            </thead>
            <tbody>
              {result.actions.map((a: any) => (
                <tr key={a.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 4, fontSize: 0.9 }}>{a.title}</td>
                  <td style={{ padding: 4, fontSize: 0.85, color: '#666' }}>{a.source_span || '—'}</td>
                  <td style={{ padding: 4, fontSize: 0.85, textAlign: 'right' }}>{a.timezone || '—'}</td>
                  <td style={{ padding: 4, fontSize: 0.85, textAlign: 'right' }}>
                    <input type="text" defaultValue={a.timezone || ''} onChange={e => handleEdit(a.id, 'timezone', e.target.value)} style={{ width: 70 }} placeholder="e.g. EST"/>
                    <button onClick={() => handleEdit(a.id, 'title', prompt('New title:', a.title) || a.title)} style={{ marginLeft: 6, padding: '2px 6px', fontSize: 0.8 }}>edit title</button>
                  </td>
                </tr>
              ))}
              {result.actions.some((a: any) => a.ambiguity) && (
                <tr><td colSpan="4" style={{ padding: 4, color: '#ca8a04', fontSize: 0.85 }}>
                  <b>Ambiguity:</b> Some items lack a timezone. Confirm before export — no dates are guessed.
                </td></tr>
              )}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button onClick={handleApprove} disabled={loading} style={{ padding: '8px 14px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
              {loading ? '…' : 'Approve selected actions'}
            </button>
            <button onClick={() => setStep('input')} style={{ padding: '8px 14px' }}>Back</button>
          </div>
        </section>
      )}

      {step === 'export' && result && (
        <section>
          <h2>3. Export</h2>
          <p>{result.approved.length} approved action(s) ready for local export.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => handleExport('ics')} style={{ padding: '8px 14px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Download .ics calendar</button>
            <button onClick={() => handleExport('checklist')} style={{ padding: '8px 14px' }}>Download checklist</button>
          </div>
          <p style={{ marginTop: 12, fontSize: 0.85, color: '#666' }}>Export is local only. No calendar or third-party service is contacted automatically.</p>
          <button onClick={() => setStep('input')} style={{ marginTop: 8, padding: '6px 10px' }}>Start over</button>
        </section>
      )}
    </div>
  )
}
