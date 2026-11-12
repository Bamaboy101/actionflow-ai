import { useState } from 'react'

type Action = { id: string; title: string; due_utc: string | null; source_span: string | null; timezone: string | null; ambiguity: string | null; status: string }

const SAMPLES: { id: string; title: string; text: string }[] = [
  { id: 'sample-1', title: 'Interview invitation', text: 'You are invited to interview for the Product Engineer role on Friday, November 20 at 2:00pm EST. Please bring a photo ID.' },
  { id: 'sample-2', title: 'Library notice', text: 'Your book is due on 11/25/2026. Please return or renew it before the due date to avoid fines.' },
  { id: 'sample-3', title: 'Dentist reminder', text: 'Dentist appointment with Dr. Lee on Tuesday, December 2 at 10:30am. Please arrive 15 minutes early.' }
]

export default function App() {
  const [step, setStep] = useState<'input' | 'review' | 'export'>('input')
  const [selected, setSelected] = useState<{ id: string; title: string; text: string } | null>(null)
  const [inputText, setInputText] = useState('')
  const [consent, setConsent] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleExtract() {
    const text = (selected?.text || inputText).trim()
    if (!text) return setError('Enter text or pick a sample')
    if (!consent) return setError('Processing consent required')
    setLoading(true); setError(null)
    try {
      const extraction = deterministicExtract(text)
      setResult(extraction)
      setStep('review')
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }

  function deterministicExtract(text: string) {
    const actions: any[] = []
    const parties: string[] = []
    const requirements: string[] = []

    const withMatches = text.match(/with\s+([A-Z][a-zA-Z. ]+?)(?:\s+(?:on|at|in|for|to|and|the|a|an)|$)/gi)
    if (withMatches) {
      for (const m of withMatches) {
        const name = m.replace(/with\s+/i, '').replace(/\s+(on|at|in|for|to|and|the|a|an)$/i, '').trim()
        if (name && !parties.includes(name)) parties.push(name)
      }
    }

    let foundSpan = ''
    const dateRegex = /(?:on|at|in)\s+([A-Z][a-z]+day),\s*([A-Z][a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?/i
    const m = text.match(dateRegex)
    if (m) foundSpan = m[0]

    const timeM = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i)
    if (timeM) foundSpan = foundSpan ? foundSpan + ' ' + timeM[0] : timeM[0]

    const tzM = text.match(/\b(UTC|EST|EDT|PST|PDT|GMT|BST|IST|CET|CEST)\b/)
    const timezone = tzM ? tzM[0] : null
    const hasDateTime = !!foundSpan

    if (foundSpan) {
      actions.push({
        title: `Follow up on: ${foundSpan.slice(0, 60)}${foundSpan.length > 60 ? '…' : ''}`,
        due_utc: null,
        source_span: foundSpan,
        timezone,
        ambiguity: !timezone && hasDateTime ? 'No timezone specified; please confirm before exporting a calendar entry.' : null
      })
    }

    const reqMatches = text.match(/[^.!?]*(?:please|need|must|bring|attach|provide)[^.!?]*[.!?]?/gi)
    if (reqMatches) {
      for (const r of reqMatches) {
        const t = r.trim()
        if (t.length > 0 && !requirements.includes(t)) requirements.push(t)
      }
    }

    return {
      actions,
      parties,
      requirements,
      summary: actions.length
        ? `Identified ${actions.length} action item(s)${parties.length ? ` involving ${parties.join(', ')}` : ''}.`
        : 'No clear action items detected.'
    }
  }

  async function handleEdit(id: string, field: string, value: string) {
    setLoading(true)
    try {
      setResult({ ...result, actions: result.actions.map((a: any) => a.id === id ? { ...a, [field]: value } : a) })
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }

  async function handleApprove() {
    const ids = result.actions.map((a: any) => a.id)
    const approved = result.actions.map((a: any) => ({ ...a, approved: true, status: 'approved' }))
    setResult({ ...result, approved, actions: result.actions.map((a: any) => ({ ...a, approved: true, status: 'approved' })) })
    setStep('export')
  }

  async function handleExport(type: 'ics' | 'checklist') {
    const ids = result.approved.map((a: any) => a.id)
    const approvedActions = result.approved
    let content = '', filename = ''
    if (type === 'ics') {
      filename = 'actionflow.ics'
      content = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ActionFlow AI//Demo//EN',
        ...approvedActions.map((a: any) => [
          'BEGIN:VEVENT', `UID:${a.id}@actionflow.ai`, `DTSTAMP:${new Date().toISOString()}`, `SUMMARY:${a.title}`,
          a.due_utc ? `DTSTART:${a.due_utc.replace(/[-:]/g, '')}00Z` : '',
          `DESCRIPTION:Source: ${a.source_span || ''}\\nAmbiguity: ${a.ambiguity || 'none'}`,
          'END:VEVENT'
        ].filter(Boolean).join('\n')),
        'END:VCALENDAR'
      ].join('\n')
    } else {
      filename = 'actionflow.md'
      content = [
        '# ActionFlow AI — Approved Task Checklist (demo)',
        '',
        ...approvedActions.map(a => `- [ ] ${a.title}` + (a.due_utc ? ` (due ${a.due_utc})` : ''))
      ].join('\n')
    }
    const blob = new Blob([content], { type: type === 'ics' ? 'text/calendar' : 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
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
              <select onChange={e => setSelected(SAMPLES.find(s => s.id === e.target.value) || null)} style={{ width: '100%', marginBottom: 8 }}>
                <option value="">Choose a sample</option>
                {SAMPLES.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
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