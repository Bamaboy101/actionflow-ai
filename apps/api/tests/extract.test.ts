import { describe, it, expect } from 'vitest'
import { parseInput } from '../src/extract'

describe('deterministic extraction', () => {
  it('extracts an action with date and time', () => {
    const out = parseInput('Interview on Friday, November 20 at 2:00pm EST. Please bring ID.')
    expect(out.actions.length).toBeGreaterThan(0)
    expect(out.actions[0].timezone).toBe('EST')
    expect(out.summary).toContain('action item')
  })

  it('flags missing timezone as ambiguity', () => {
    const out = parseInput('Meeting on 11/25/2026 at 3pm. Please attend.')
    expect(out.actions.length).toBeGreaterThan(0)
    expect(out.actions[0].ambiguity).toContain('No timezone')
  })

  it('extracts parties', () => {
    const out = parseInput('Dentist appointment with Dr. Lee on Tuesday.')
    expect(out.parties).toContain('Dr. Lee')
  })

  it('extracts requirements', () => {
    const out = parseInput('Please bring a photo ID.')
    expect(out.requirements.length).toBeGreaterThan(0)
  })

  it('handles empty input gracefully', () => {
    const out = parseInput('Hello, how are you?')
    expect(out.actions.length).toBe(0)
  })
})

describe('time extraction precision', () => {
  it('does not mistake a day-of-month for an hour', () => {
    const out = parseInput('Please attend the review meeting on Friday, November 20 at 2:00pm EST. Bring a photo ID.')
    expect(out.actions.length).toBeGreaterThan(0)
    const span = out.actions[0].source_span
    expect(span).toContain('2:00pm')
    expect(span).not.toMatch(/November 20 20/)
    expect(out.actions[0].timezone).toBe('EST')
  })
})
