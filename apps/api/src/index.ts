import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono<{ Bindings: { DB: D1Database } }>()

app.use('*', cors())
app.use('*', async (c, next) => {
  const start = Date.now()
  await next()
  console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - start}ms`)
})

async function parseBody(c: any): Promise<any> {
  try {
    const body = await c.req.raw.json()
    if (typeof body === 'object' && body !== null && !Array.isArray(body)) return body
    return {}
  } catch (e) { return {} }
}

type Sample = { id: string; title: string; text: string }
type Action = { id: string; input_id: string; title: string; due_utc: string | null; source_span: string | null; timezone: string | null; ambiguity: string | null; status: string; reviewed_at_utc: string | null; edit_fields: string | null; approved: boolean }

const samples: Sample[] = [
  { id: 'sample-1', title: 'Interview invitation', text: 'You are invited to interview for the Product Engineer role on Friday, November 20 at 2:00pm EST. Please bring a photo ID.' },
  { id: 'sample-2', title: 'Library notice', text: 'Your book is due on 11/25/2026. Please return or renew it before the due date to avoid fines.' },
  { id: 'sample-3', title: 'Dentist reminder', text: 'Dentist appointment with Dr. Lee on Tuesday, December 2 at 10:30am. Please arrive 15 minutes early.' },
]

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

function extractTextFromPdf(buffer: ArrayBuffer): string {
  // Deterministic PDF text extraction without external dependencies
  // For demo: extract any readable text from PDF binary
  const uint8 = new Uint8Array(buffer)
  let text = ''
  let inStream = false
  let streamBuf = ''
  
  for (let i = 0; i < uint8.length; i++) {
    const ch = uint8[i]
    // Detect stream markers
    if (uint8[i] === 0x73 && uint8[i+1] === 0x74 && uint8[i+2] === 0x72 && uint8[i+3] === 0x65 && uint8[i+4] === 0x61 && uint8[i+5] === 0x6d) {
      inStream = true
      i += 6
      continue
    }
    if (inStream && uint8[i] === 0x65 && uint8[i+1] === 0x6e && uint8[i+2] === 0x64 && uint8[i+3] === 0x73 && uint8[i+4] === 0x74 && uint8[i+5] === 0x72 && uint8[i+6] === 0x65 && uint8[i+7] === 0x61 && uint8[i+8] === 0x6d) {
      inStream = false
      i += 9
      continue
    }
    if (inStream && ch >= 32 && ch < 127) {
      streamBuf += String.fromCharCode(ch)
    } else if (inStream && streamBuf.length > 0) {
      text += streamBuf + ' '
      streamBuf = ''
    }
  }
  
  // Fallback: extract any ASCII strings from the PDF
  if (!text.trim()) {
    let current = ''
    for (let i = 0; i < uint8.length; i++) {
      const ch = uint8[i]
      if (ch >= 32 && ch < 127) {
        current += String.fromCharCode(ch)
      } else {
        if (current.length > 3) text += current + ' '
        current = ''
      }
    }
    if (current.length > 3) text += current
  }
  
  return text.trim() || 'PDF text extraction demo: No extractable text found in this PDF. Please use paste text mode instead.'
}

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', mode: 'cloudflare', utc: new Date().toISOString() })
})

app.get('/api/samples', (c) => {
  return c.json(samples)
})

app.post('/api/extract', async (c) => {
  let source_text: string | undefined
  let processing_consent = false
  let source_type: string = 'paste'
  let uploaded_file: any = undefined

  const contentType = c.req.header('Content-Type') || ''

  if (contentType.includes('application/json')) {
    const body = await parseBody(c)
    source_text = body.source_text
    processing_consent = body.processing_consent === true
    source_type = body.source_type || 'paste'
    uploaded_file = undefined
  } else {
    // multipart/form-data for file upload
    const form = await c.req.parseBody()
    source_text = form.source_text as string | undefined
    processing_consent = form.processing_consent === 'true' || form.processing_consent === true
    source_type = (form.source_type as string) || 'paste'
    uploaded_file = form.file as any
  }

  let text_to_process = source_text || ''
  let file_name: string | null = null

  // Handle PDF file upload
  if (uploaded_file && typeof uploaded_file === 'object' && uploaded_file.arrayBuffer && typeof uploaded_file.arrayBuffer === 'function') {
    file_name = uploaded_file.name || 'uploaded.pdf'
    const arrayBuffer = await uploaded_file.arrayBuffer()
    const pdfText = extractTextFromPdf(arrayBuffer)
    text_to_process = pdfText
    if (!source_text) {
      text_to_process = pdfText
    } else {
      text_to_process = source_text + '\n\n[Extracted from ' + file_name + ']:\n' + pdfText
    }
  }

  if (!text_to_process || text_to_process.trim().length === 0) return c.status(400).json({ error: 'source_text or PDF file required' })
  if (!processing_consent) return c.status(400).json({ error: 'processing_consent must be true' })

  const id = `req:${crypto.randomUUID()}`
  const extraction = extractDeterministic(text_to_process)

  // Persist input
  try {
    if (c.env.DB) {
      await c.env.DB.prepare(
        `INSERT INTO inputs (id, source_type, source_text, processing_consent, received_utc) VALUES (?,?,?,?,?)`
      ).bind(id, source_type, text_to_process, processing_consent ? 1 : 0, new Date().toISOString())
    }
  } catch (e) { console.error("D1 error:", e) }

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
    try {
      if (c.env.DB) {
        c.env.DB.prepare(
          `INSERT INTO actions (id, input_id, title, due_utc, source_span, timezone, ambiguity, status, reviewed_at_utc, edit_fields, approved) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(actionId, id, action.title, action.due_utc, action.source_span, action.timezone, action.ambiguity, action.status, action.reviewed_at_utc, action.edit_fields, action.approved ? 1 : 0).run()
      }
    } catch (e) { console.error("D1 error:", e) }
    return action
  })

  return c.json({ request_id: id, actions: actItems, parties: extraction.parties, requirements: extraction.requirements, summary: extraction.summary, ai_demo: true, file_name })
})

app.post('/api/validate', async (c) => {
  const body = await parseBody(c) as { request_id: string; action_id: string; edits?: any }
  const { request_id, action_id, edits } = body

  let action: any = null
  try {
    if (c.env.DB) {
      action = await c.env.DB.prepare(`SELECT * FROM actions WHERE id=?`).bind(action_id).first() as any
    }
  } catch (e) { console.error("D1 error:", e) }
  if (!action || action.input_id !== request_id) return c.status(404).json({ error: 'action not found for request' })

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

  try {
    if (c.env.DB) {
      await c.env.DB.prepare(
        `UPDATE actions SET title=?, due_utc=?, timezone=?, ambiguity=?, status='reviewed', reviewed_at_utc=?, edit_fields=? WHERE id=?`
      ).bind(updated.title, updated.due_utc, updated.timezone, updated.ambiguity, updated.reviewed_at_utc, updated.edit_fields, action_id).run()
    }
  } catch (e) { console.error("D1 error:", e) }

  let clarification: string | null = null
  if (!updated.timezone && updated.due_utc) {
    clarification = 'Timezone not specified; confirm before export.'
  }

  return c.json({ action: updated, clarification, ai_demo: true })
})

app.post('/api/approve', async (c) => {
  const body = await parseBody(c) as { request_id: string; action_ids: string[] }
  const { request_id, action_ids } = body
  if (!Array.isArray(action_ids) || action_ids.length === 0) return c.status(400).json({ error: 'action_ids required' })

  const now = new Date().toISOString()
  const approved: any[] = []
  for (const aid of action_ids) {
    let action: any = null
    try {
      if (c.env.DB) {
        action = await c.env.DB.prepare(`SELECT * FROM actions WHERE id=?`).bind(aid).first() as any
      }
    } catch (e) { console.error("D1 error:", e) }
    if (!action || action.input_id !== request_id) continue
    if (action.status !== 'reviewed') continue
    const updated: any = { ...action, approved: true, status: 'approved' }
    try {
      if (c.env.DB) {
        await c.env.DB.prepare(`UPDATE actions SET approved=1, status='approved' WHERE id=?`).bind(aid).run()
      }
    } catch (e) { console.error("D1 error:", e) }
    approved.push(updated)
  }

  if (approved.length === 0) return c.status(400).json({ error: 'no reviewable actions to approve' })

  return c.json({ request_id, approved, ai_demo: true })
})

app.post('/api/export', async (c) => {
  const body = await parseBody(c) as { request_id: string; action_ids: string[]; output_type: 'ics' | 'checklist' }
  const { request_id, action_ids, output_type } = body
  if (!Array.isArray(action_ids) || action_ids.length === 0) return c.status(400).json({ error: 'action_ids required' })

  const acts: any[] = []
  for (const aid of action_ids) {
    let action: any = null
    try {
      if (c.env.DB) {
        action = await c.env.DB.prepare(`SELECT * FROM actions WHERE id=?`).bind(aid).first() as any
      }
    } catch (e) { console.error("D1 error:", e) }
    if (action && action.approved && action.input_id === request_id) acts.push(action)
  }
  if (acts.length === 0) return c.status(400).json({ error: 'no approved actions to export' })

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

  return new Response(content, {
    headers: {
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Type': output_type === 'ics' ? 'text/calendar' : 'text/markdown'
    }
  })
})

app.get('/api/actions/:request_id', async (c) => {
  const request_id = c.req.param('request_id')
  try {
    if (c.env.DB) {
      const result = await c.env.DB.prepare(`SELECT * FROM actions WHERE input_id=?`).bind(request_id).all()
      return c.json(result.results || [])
    }
  } catch (e) { console.error("D1 error:", e) }
  return c.json([])
})

app.onError((err, c) => {
  console.error(err)
  return c.status(500).json({ error: 'internal server error' })
})

app.notFound((c) => {
  return c.status(404).json({ error: 'not found' })
})

export default app
