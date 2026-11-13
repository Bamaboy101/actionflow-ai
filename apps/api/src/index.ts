import express from 'express'
import cors from 'cors'

const app = express()
app.use(cors())
app.use(express.json())

app.use((req, res, next) => {
  const start = Date.now()
  res.on('finish', () => {
    console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`)
  })
  next()
})

type Sample = { id: string; title: string; text: string }
type Action = { id: string; input_id: string; title: string; due_utc: string | null; source_span: string | null; timezone: string | null; ambiguity: string | null; status: string; reviewed_at_utc: string | null; edit_fields: string | null; approved: boolean }

const samples: Sample[] = [
  { id: 'sample-1', title: 'Interview invitation', text: 'You are invited to interview for the Product Engineer role on Friday, November 20 at 2:00pm EST. Please bring a photo ID.' },
  { id: 'sample-2', title: 'Library notice', text: 'Your book is due on 11/25/2026. Please return or renew it before the due date to avoid fines.' },
  { id: 'sample-3', title: 'Dentist reminder', text: 'Dentist appointment with Dr. Lee on Tuesday, December 2 at 10:30am. Please arrive 15 minutes early.' },
]

const actions: Action[] = []

function extractDeterministic(text: string): { actions: any[]; parties: string[]; requirements: string[]; summary: string } {
  const actItems: any[] = []
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
  for (const rx of [/(?:on|at|in)\s+([A-Z][a-z]+day),\s*([A-Z][a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?/i, /([A-Z][a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?/i, /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i]) {
    const m = text.match(rx)
    if (m) { foundSpan = m[0]; break }
  }

  const timeM = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i)
  if (timeM) foundSpan = foundSpan ? foundSpan + ' ' + timeM[0] : timeM[0]

  const tzM = text.match(/\b(UTC|EST|EDT|PST|PDT|GMT|BST|IST|CET|CEST)\b/)
  const timezone = tzM ? tzM[0] : null
  const hasDateTime = !!foundSpan

  if (foundSpan) {
    const title = `Follow up on: ${foundSpan.slice(0, 60)}${foundSpan.length > 60 ? '…' : ''}`
    actItems.push({
      title,
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

  const summary = actItems.length ? `Identified ${actItems.length} action item(s)${parties.length ? ` involving ${parties.join(', ')}` : ''}.` : 'No clear action items detected.'

  return { actions: actItems, parties, requirements, summary }
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', mode: 'demo', utc: new Date().toISOString() })
})

app.get('/api/samples', (_req, res) => {
  res.json(samples)
})

app.post('/api/extract', (req, res) => {
  const { source_text, processing_consent, source_type } = req.body
  if (!source_text) return res.status(400).json({ error: 'source_text required' })
  if (processing_consent !== true) return res.status(400).json({ error: 'processing_consent must be true' })

  const id = `req:${crypto.randomUUID()}`
  const extraction = extractDeterministic(source_text)

  const actItems = extraction.actions.map((_a: any) => {
    const actionId = `act:${crypto.randomUUID()}`
    const action: Action = {
      id: actionId,
      input_id: id,
      title: _a.title,
      due_utc: null,
      source_span: _a.source_span,
      timezone: _a.timezone,
      ambiguity: _a.ambiguity,
      status: 'pending',
      reviewed_at_utc: null,
      edit_fields: null,
      approved: false
    }
    actions.push(action)
    return action
  })

  res.json({ request_id: id, actions: actItems, parties: extraction.parties, requirements: extraction.requirements, summary: extraction.summary, ai_demo: true })
})

app.post('/api/validate', (req, res) => {
  const { request_id, action_id, edits } = req.body
  const action = actions.find(a => a.id === action_id)
  if (!action || action.input_id !== request_id) return res.status(404).json({ error: 'action not found for request' })

  const now = new Date().toISOString()
  const updated: any = {
    ...action,
    title: edits?.title ?? action.title,
    due_utc: edits?.due_utc !== undefined ? edits.due_utc : action.due_utc,
    timezone: edits?.timezone !== undefined ? edits.timezone : action.timezone,
    ambiguity: edits?.ambiguity !== undefined ? edits.ambiguity : action.ambiguity,
    status: 'reviewed',
    reviewed_at_utc: now,
    edit_fields: edits ? JSON.stringify(Object.keys(edits)) : action.edit_fields
  }

  const idx = actions.findIndex(a => a.id === action_id)
  actions[idx] = updated

  let clarification: string | null = null
  if (!updated.timezone && updated.due_utc) {
    clarification = 'Timezone not specified; confirm before export.'
  }

  res.json({ action: updated, clarification, ai_demo: true })
})

app.post('/api/approve', (req, res) => {
  const { request_id, action_ids } = req.body
  if (!Array.isArray(action_ids) || action_ids.length === 0) return res.status(400).json({ error: 'action_ids required' })

  const now = new Date().toISOString()
  const approved: any[] = []
  for (const aid of action_ids) {
    const action = actions.find(a => a.id === aid)
    if (!action || action.input_id !== request_id) continue
    if (action.status !== 'reviewed') continue
    const updated: any = { ...action, approved: true, status: 'approved' }
    const idx = actions.findIndex(a => a.id === aid)
    actions[idx] = updated
    approved.push(updated)
  }

  if (approved.length === 0) return res.status(400).json({ error: 'no reviewable actions to approve' })

  res.json({ request_id, approved, ai_demo: true })
})

app.post('/api/export', (req, res) => {
  const { request_id, action_ids, output_type } = req.body
  if (!Array.isArray(action_ids) || action_ids.length === 0) return res.status(400).json({ error: 'action_ids required' })

  const acts = action_ids.map(aid => actions.find(a => a.id === aid)).filter((a: any) => !!a && a.approved && a.input_id === request_id)
  if (acts.length === 0) return res.status(400).json({ error: 'no approved actions to export' })

  const id = `exp:${crypto.randomUUID()}`
  let content = ''
  let filename = ''

  if (output_type === 'ics') {
    filename = 'actionflow.ics'
    content = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//ActionFlow AI//Demo//EN',
      ...acts.map((a: any) => [
        'BEGIN:VEVENT',
        `UID:${a.id}@actionflow.ai`,
        `DTSTAMP:${new Date().toISOString()}`,
        `SUMMARY:${a.title}`,
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
      ...acts.map((a: any) => `- [ ] ${a.title}` + (a.due_utc ? ` (due ${a.due_utc})` : ''))
    ].join('\n')
  }

  res.set('Content-Disposition', `attachment; filename="${filename}"`)
  res.set('Content-Type', output_type === 'ics' ? 'text/calendar' : 'text/markdown')
  res.send(content)
})

app.listen(4003, () => {
  console.log('ActionFlow API listening on http://localhost:4003')
})

export default app
