import { createHash } from 'crypto'

export interface AIMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface AIResult {
  text: string
  provider: string
  model: string
  demo: boolean   // true when the response is a labeled demonstration, not a live model call
}

export interface ProviderConfig {
  provider: string
  nvidia: { apiKey?: string; baseUrl: string; model?: string; timeoutMs: number }
  openrouter: { apiKey?: string; baseUrl: string; model?: string; timeoutMs: number }
  maxTokens: number
  temperature: number
}

function env(name: string, fallback: string): string {
  const v = process.env[name]
  return v === undefined || v === '' ? fallback : v
}

function envNumber(name: string, fallback: number): number {
  const v = process.env[name]
  if (v === undefined || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function loadConfig(): ProviderConfig {
  return {
    provider: env('AI_PROVIDER', 'demo'),
    nvidia: {
      apiKey: process.env.NVIDIA_API_KEY || undefined,
      baseUrl: env('NVIDIA_BASE_URL', 'https://integrate.api.nvidia.com/v1'),
      model: process.env.NVIDIA_MODEL || undefined,
      timeoutMs: envNumber('NVIDIA_TIMEOUT_MS', 20000)
    },
    openrouter: {
      apiKey: process.env.OPENROUTER_API_KEY || undefined,
      baseUrl: env('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'),
      model: process.env.OPENROUTER_MODEL || undefined,
      timeoutMs: envNumber('OPENROUTER_TIMEOUT_MS', 20000)
    },
    maxTokens: envNumber('AI_MAX_TOKENS', 512),
    temperature: envNumber('AI_TEMPERATURE', 0.3)
  }
}

/** Never log keys or full prompts; only provider/model/demo status. */
function safeLog(provider: string, model: string, demo: boolean) {
  console.log(`[ai] provider=${provider} model=${model || '<unset>'} demo=${demo}`)
}

function sha(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 12)
}

/** NVIDIA chat/completions call. */
async function nvidiaChat(cfg: ProviderConfig, messages: AIMessage[]): Promise<AIResult> {
  if (!cfg.nvidia.apiKey) throw new Error('NVIDIA_API_KEY not set')
  if (!cfg.nvidia.model) throw new Error('NVIDIA_MODEL not set')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.nvidia.timeoutMs)

  const res = await fetch(`${cfg.nvidia.baseUrl}/chat/completions`, {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'Authorization': `Bearer ${cfg.nvidia.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: cfg.nvidia.model,
      messages,
      max_tokens: cfg.maxTokens,
      temperature: cfg.temperature
    })
  })

  clearTimeout(timer)

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`NVIDIA API ${res.status}: ${body.slice(0, 200)}`)
  }

  const json = await res.json()
  const text = json.choices?.[0]?.message?.content || ''
  safeLog('nvidia', cfg.nvidia.model, false)
  return { text, provider: 'nvidia', model: cfg.nvidia.model, demo: false }
}

/** OpenRouter chat/completions call. */
async function openrouterChat(cfg: ProviderConfig, messages: AIMessage[]): Promise<AIResult> {
  if (!cfg.openrouter.apiKey) throw new Error('OPENROUTER_API_KEY not set')
  if (!cfg.openrouter.model) throw new Error('OPENROUTER_MODEL not set')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.openrouter.timeoutMs)

  const res = await fetch(`${cfg.openrouter.baseUrl}/chat/completions`, {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'Authorization': `Bearer ${cfg.openrouter.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: cfg.openrouter.model,
      messages,
      max_tokens: cfg.maxTokens,
      temperature: cfg.temperature
    })
  })

  clearTimeout(timer)

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`OpenRouter API ${res.status}: ${body.slice(0, 200)}`)
  }

  const json = await res.json()
  const text = json.choices?.[0]?.message?.content || ''
  safeLog('openrouter', cfg.openrouter.model, false)
  return { text, provider: 'openrouter', model: cfg.openrouter.model, demo: false }
}

/** Clearly labeled demonstration response. No external call is made. */
function demoChat(_cfg: ProviderConfig, messages: AIMessage[]): AIResult {
  const last = messages[messages.length - 1]?.content || ''
  const text = `[DEMONSTRATION RESPONSE — not a live model call]\n\nInput hash: ${sha(last).slice(0, 8)}\nThis is a labeled demonstration reply. Configure AI_PROVIDER=nvidia or openrouter with valid credentials and a working model to enable live AI generation.\n\nSummary of input (first 120 chars): ${last.slice(0, 120)}`
  safeLog('demo', '<none>', true)
  return { text, provider: 'demo', model: '<none>', demo: true }
}

export class AIProvider {
  private cfg: ProviderConfig

  constructor(cfg?: Partial<ProviderConfig>) {
    this.cfg = cfg ? { ...loadConfig(), ...cfg } : loadConfig()
  }

  get provider(): string { return this.cfg.provider }
  get isDemo(): boolean { return this.cfg.provider === 'demo' }

  async chat(messages: AIMessage[]): Promise<AIResult> {
    const provider = this.cfg.provider

    if (provider === 'demo') return demoChat(this.cfg, messages)

    if (provider === 'nvidia') {
      try {
        return await nvidiaChat(this.cfg, messages)
      } catch (err) {
        // Fall back to clearly labeled demo when NVIDIA is unavailable/rate-limited
        console.warn(`[ai] NVIDIA call failed, falling back to demo: ${(err as Error).message}`)
        return demoChat(this.cfg, messages)
      }
    }

    if (provider === 'openrouter') {
      try {
        return await openrouterChat(this.cfg, messages)
      } catch (err) {
        console.warn(`[ai] OpenRouter call failed, falling back to demo: ${(err as Error).message}`)
        return demoChat(this.cfg, messages)
      }
    }

    throw new Error(`Unknown AI_PROVIDER: ${provider}`)
  }

  /** Convenience: single user message. */
  async say(content: string): Promise<AIResult> {
    return this.chat([{ role: 'user', content }])
  }
}

export function createAIProvider(): AIProvider {
  return new AIProvider()
}
