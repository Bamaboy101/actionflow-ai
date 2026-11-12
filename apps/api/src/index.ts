import express, { type Request, type Response, type NextFunction } from 'express'
import cors from 'cors'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { initDb, db, createInput, listActionsByInput, upsertAction, getAction, listExports, insertExport, type Action } from './store'
import { parseInput, type ExtractionResult } from './extract'
import { createAIProvider } from './ai/provider'

const app = express()
const PORT = Number(process.env.PORT) || 4002
const ai = createAIProvider()

app.use(cors())
app.use(express.json())

app.use((_req: Request, _res: Response, next: NextFunction) => {
  const start = Date.now()
  _res.on('finish', () => {
    console.log(`${_req.method} ${_req.originalUrl} ${_res.statusCode} ${Date.now() - start}ms`)
  })
  next()
})

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', ai_provider: ai.provider, ai_demo: ai.isDemo, utc: new Date().toISOString() })
})

const extractBody = z.object({
  source_text: z.string().min(1).max(10000),
  processing_consent: z.boolean().default(false),
  source_type: z.enum(['paste', 'upload']).default('paste')
})

app.post('/api/extract', (req: Request, res: Response) => {
  const parsed = extractBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid body', issues: parsed.error.flatten() })
  const { source_text, processing_consent, source_type } = parsed.data

  if (!processing_consent) {
    return res.status(400).json({ error: 'processing_consent must be true' })
  }

  const id = `req:${randomUUID()}`
  const input = { id, source_type, source_text, processing_consent: true, received_utc: new Date().toISOString() }
  createInput(db, input)

  const extraction: ExtractionResult = parseInput(source_text)

  const actions = extraction.actions.map((_a, i) => {
    const actionId = `act:${randomUUID()}`
    const action: Action = {
      id: actionId,
      input_id: id,
      title: _a.title,
      due_utc: _a.due_utc,
      source_span: _a.source_span,
      timezone: _a.timezone,
      ambiguity: _a.ambiguity,
      status: 'pending',
      reviewed_at_utc: null,
      edit_fields: null,
      approved: false
    }
    upsertAction(db, action)
    return action
  })

  res.json({ request_id: id, actions, parties: extraction.parties, requirements: extraction.requirements, summary: extraction.summary, ai_demo: true })
})

const validateBody = z.object({
  request_id: z.string().min(1),
  action_id: z.string().min(1),
  edits: z.object({ title: z.string().optional(), due_utc: z.string().optional().nullable(), timezone: z.string().optional().nullable(), ambiguity: z.string().optional().nullable() }).optional()
})

app.post('/api/validate', (req: Request, res: Response) => {
  const parsed = validateBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid body', issues: parsed.error.flatten() })
  const { request_id, action_id, edits } = parsed.data

  const action = getAction(db, action_id)
  if (!action || action.input_id !== request_id) return res.status(404).json({ error: 'action not found for request' })

  const now = new Date().toISOString()
  const updated: Action = {
    ...action,
    title: edits?.title ?? action.title,
    due_utc: edits?.due_utc !== undefined ? edits.due_utc : action.due_utc,
    timezone: edits?.timezone !== undefined ? edits.timezone : action.timezone,
    ambiguity: edits?.ambiguity !== undefined ? edits.ambiguity : action.ambiguity,
    status: 'reviewed',
    reviewed_at_utc: now,
    edit_fields: edits ? JSON.stringify(Object.keys(edits)) : action.edit_fields
  }
  upsertAction(db, updated)

  let clarification: string | null = null
  if (!updated.timezone && updated.due_utc) {
    clarification = 'Timezone not specified; confirm before export.'
  }

  res.json({ action: updated, clarification, ai_demo: true })
})

const approveBody = z.object({
  request_id: z.string().min(1),
  action_ids: z.array(z.string().min(1)).min(1)
})

app.post('/api/approve', (req: Request, res: Response) => {
  const parsed = approveBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid body', issues: parsed.error.flatten() })
  const { request_id, action_ids } = parsed.data

  const now = new Date().toISOString()
  const approved: Action[] = []
  for (const aid of action_ids) {
    const action = getAction(db, aid)
    if (!action || action.input_id !== request_id) continue
    if (action.status !== 'reviewed') continue
    const updated: Action = { ...action, approved: true, status: 'approved' }
    upsertAction(db, updated)
    approved.push(updated)
  }

  if (approved.length === 0) return res.status(400).json({ error: 'no reviewable actions to approve' })

  res.json({ request_id, approved, ai_demo: true })
})

const exportBody = z.object({
  request_id: z.string().min(1),
  action_ids: z.array(z.string().min(1)).min(1),
  output_type: z.enum(['ics', 'checklist'])
})

app.post('/api/export', (req: Request, res: Response) => {
  const parsed = exportBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid body', issues: parsed.error.flatten() })
  const { request_id, action_ids, output_type } = parsed.data

  const actions = action_ids.map(aid => getAction(db, aid)).filter((a): a is Action => !!a && a.approved && a.input_id === request_id)
  if (actions.length === 0) return res.status(400).json({ error: 'no approved actions to export' })

  const id = `exp:${randomUUID()}`
  const exportRow = { id, action_ids: JSON.stringify(action_ids), output_type, generated_at_utc: new Date().toISOString() }
  insertExport(db, exportRow)

  let content = ''
  let filename = ''
  if (output_type === 'ics') {
    filename = 'actionflow.ics'
    content = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//ActionFlow AI//Demo//EN',
      ...actions.map(a => [
        'BEGIN:VEVENT',
        `UID:${a.id}@actionflow.ai`,
        `DTSTAMP:${exportRow.generated_at_utc}`,
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
      ...actions.map(a => `- [ ] ${a.title}` + (a.due_utc ? ` (due ${a.due_utc})` : ''))
    ].join('\n')
  }

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.setHeader('Content-Type', output_type === 'ics' ? 'text/calendar' : 'text/markdown')
  res.send(content)
})

app.get('/api/samples', (_req: Request, res: Response) => {
  res.json([
    { id: 'sample-1', title: 'Interview invitation', text: 'You are invited to interview for the Product Engineer role on Friday, November 20 at 2:00pm EST. Please bring a photo ID.' },
    { id: 'sample-2', title: 'Library notice', text: 'Your book is due on 11/25/2026. Please return or renew it before the due date to avoid fines.' },
    { id: 'sample-3', title: 'Dentist reminder', text: 'Dentist appointment with Dr. Lee on Tuesday, December 2 at 10:30am. Please arrive 15 minutes early.' }
  ])
})

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'not found' })
})
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err)
  res.status(500).json({ error: 'internal server error' })
})

initDb()

app.listen(PORT, () => {
  console.log(`ActionFlow API listening on :${PORT} (ai=${ai.provider}, demo=${ai.isDemo})`)
})

export default app
