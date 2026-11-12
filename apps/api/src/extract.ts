/**
 * Deterministic extraction fallback (no LLM key configured).
 * Extracts dates, times, tasks, parties and requirements from plain text.
 * Never invents missing timezones; flags ambiguity for review.
 */

export interface ExtractedAction {
  title: string
  due_utc: string | null
  source_span: string
  timezone: string | null
  ambiguity: string | null
}

export interface ExtractionResult {
  actions: ExtractedAction[]
  parties: string[]
  requirements: string[]
  summary: string
}

const DATE_TOKENS = [
  /(?:on|at|in)\s+([A-Z][a-z]+day),\s*([A-Z][a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?/i,
  /([A-Z][a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?/i,
  /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i
]

const TIME_TOKENS = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i

export function extractDeterministic(text: string): ExtractionResult {
  const actions: ExtractedAction[] = []
  const parties: string[] = []
  const requirements: string[] = []

  // Parties: "with <Name>" — allow periods, stop before common non-name words
  const withMatches = text.match(/with\s+([A-Z][a-zA-Z. ]+?)(?:\s+(?:on|at|in|for|to|and|the|a|an)|$)/gi)
  if (withMatches) {
    for (const m of withMatches) {
      const name = m.replace(/with\s+/i, '').replace(/\s+(on|at|in|for|to|and|the|a|an)$/i, '').trim()
      if (name && !parties.includes(name)) parties.push(name)
    }
  }

  let foundSpan = ''
  for (const rx of DATE_TOKENS) {
    const m = text.match(rx)
    if (m) {
      foundSpan = m[0]
      break
    }
  }

  const timeM = text.match(TIME_TOKENS)
  if (timeM) {
    foundSpan = foundSpan ? foundSpan + ' ' + timeM[0] : timeM[0]
  }

  const tzM = text.match(/\b(UTC|EST|EDT|PST|PDT|GMT|BST|IST|CET|CEST)\b/)
  const timezone = tzM ? tzM[0] : null
  const hasDateTime = !!foundSpan

  if (foundSpan) {
    const title = `Follow up on: ${foundSpan.slice(0, 60)}${foundSpan.length > 60 ? '…' : ''}`
    actions.push({
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

  const summary = actions.length
    ? `Identified ${actions.length} action item(s)${parties.length ? ` involving ${parties.join(', ')}` : ''}.`
    : 'No clear action items detected.'

  return { actions, parties, requirements, summary }
}

export function parseInput(text: string): ExtractionResult {
  return extractDeterministic(text)
}
