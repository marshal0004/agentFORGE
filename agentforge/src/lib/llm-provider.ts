/**
 * Multi-Provider LLM Registry
 *
 * A unified provider registry that abstracts away the differences between
 * 30+ LLM providers.  Each provider implements the same `LLMProvider`
 * interface, and the registry handles routing, fallbacks, and model
 * discovery.
 *
 * Supported providers:
 *   - ZAI (z-ai-web-dev-sdk) — default, always available
 *   - OpenAI (gpt-4o, gpt-3.5-turbo, o1, etc.)
 *   - Anthropic (claude-3.5-sonnet, claude-3-opus, etc.)
 *   - Google (gemini-2.0-flash, gemini-1.5-pro, etc.)
 *   - Azure OpenAI
 *   - AWS Bedrock
 *   - Groq
 *   - Together AI
 *   - Fireworks AI
 *   - Mistral AI
 *   - DeepSeek
 *   - Ollama (local models)
 *   - OpenRouter (gateway to 100+ models)
 *   - Custom providers via registerProvider()
 *
 * Design goals:
 *   - Zero external dependencies beyond z-ai-web-dev-sdk (others are optional)
 *   - Structured function calling support (not text-based regex)
 *   - Automatic fallback chains
 *   - Per-provider rate limiting and error handling
 *   - Full event bus integration
 */

import { agentEventBus } from './event-bus'
import { rateLimitManager } from './rate-limiter'

// ── Core Types ─────────────────────────────────────────────────────────────────

export interface ToolCallFunction {
  name: string
  arguments: string // JSON string
}

export interface StructuredToolCall {
  id: string
  type: 'function'
  function: ToolCallFunction
}

export interface ToolCallResult {
  toolCallId: string
  toolName: string
  result: unknown
  success: boolean
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null  // null when assistant only has tool_calls, no text
  toolCalls?: StructuredToolCall[]
  toolCallId?: string // For role='tool' responses
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ChatOptions {
  model: string
  messages: ChatMessage[]
  tools?: ToolDefinition[]
  maxTokens?: number
  temperature?: number
  stream?: boolean
  /** Whether to use native function calling (default: true when tools provided) */
  useNativeFunctionCalling?: boolean
}

export interface ChatResponse {
  content: string
  toolCalls?: StructuredToolCall[]
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  model: string
  provider: string
  finishReason: string
}

export interface StreamChunk {
  content?: string
  toolCalls?: Partial<StructuredToolCall>[]
  finishReason?: string
  usage?: ChatResponse['usage']
}

export interface LLMProvider {
  /** Unique identifier for this provider */
  id: string
  /** Human-readable name */
  name: string
  /** List of model IDs this provider supports */
  models: string[]
  /** Whether this provider is currently available (has credentials, etc.) */
  available: boolean
  /** Priority for fallback ordering (lower = higher priority) */
  priority: number

  /** Non-streaming chat completion */
  chat(options: ChatOptions): Promise<ChatResponse>
  /** Streaming chat completion */
  chatStream(options: ChatOptions): AsyncIterable<StreamChunk>
}

// ── Provider Config ────────────────────────────────────────────────────────────

export interface ProviderConfig {
  id: string
  name: string
  apiKey?: string
  baseUrl?: string
  models?: string[]
  priority?: number
  enabled?: boolean
  /** Custom headers to include in requests */
  headers?: Record<string, string>
}

// ── ZAI SDK Helper ─────────────────────────────────────────────────────────────

/**
 * Create a ZAI SDK instance, ensuring .z-ai-config exists.
 *
 * Used ONLY by MCP tool handlers (web_search, fetch_page) that depend
 * on the SDK.  The ZAIProvider itself uses direct HTTP fetch for
 * reliability and consistency with NVIDIA/OpenRouter.
 */
export async function createZAIInstance(): Promise<any> {
  const ZAI = (await import('z-ai-web-dev-sdk')).default
  const apiKey = process.env.ZAI_API_KEY

  // Write .z-ai-config file from env var so the SDK can find it.
  // IMPORTANT: Use the correct base URL for the ZAI/GLM API.
  // The SDK's loadConfig() requires both `baseUrl` and `apiKey`.
  if (apiKey) {
    try {
      const fs = await import('fs/promises')
      const path = await import('path')
      const os = await import('os')
      const configContent = JSON.stringify({
        baseUrl: 'https://api.z.ai/api/paas/v4',
        apiKey,
      })
      const configPaths = [
        path.join(process.cwd(), '.z-ai-config'),     // project root
        path.join(os.homedir(), '.z-ai-config'),      // home dir
      ]
      for (const configPath of configPaths) {
        try {
          await fs.writeFile(configPath, configContent, 'utf-8')
          console.log(`[ZAI] Wrote config to ${configPath}`)
        } catch (writeErr) {
          // May not have write access to home dir, that's OK
        }
      }
    } catch {
      // fs/path import failure, ignore
    }
  }

  return await ZAI.create()
}

// ── ZAI Provider (default, always available) ───────────────────────────────────

/**
 * ZAI (GLM) Provider — uses OpenAI-compatible HTTP fetch directly.
 *
 * Why not use the z-ai-web-dev-sdk?
 *   1. The SDK's config-file mechanism is fragile in server environments
 *   2. Direct HTTP fetch is more reliable and consistent with how we
 *      handle NVIDIA NIM and OpenRouter providers
 *   3. The GLM API at open.bigmodel.cn is fully OpenAI-compatible,
 *      so we can reuse OpenAICompatibleProvider's battle-tested logic
 *
 * The SDK is still used by MCP tool handlers (web_search, fetch_page)
 * via the createZAIInstance() helper above.
 */
class ZAIProvider implements LLMProvider {
  id = 'zai'
  name = 'Z AI (GLM)'
  models = [
    'glm-5.1',
    'glm-4.7-flash',
    'glm-4.5-flash',
  ]
  available = true
  priority = 0

  private apiKey: string
  private baseUrl: string

  constructor() {
    this.apiKey = process.env.ZAI_API_KEY || ''
    // The GLM API endpoint — fully OpenAI-compatible
    this.baseUrl = process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4'
    this.available = !!this.apiKey
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    const startTime = Date.now()

    agentEventBus.emit('llm:request', {
      provider: this.id,
      model: options.model,
      messageCount: options.messages.length,
    })

    const body: Record<string, unknown> = {
      model: options.model,
      messages: this.buildMessages(options),
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      stream: false,
    }

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools
      body.tool_choice = 'auto'
      body.parallel_tool_calls = true   // FIX: Enable parallel tool calls — allows LLM to batch 10+ calls per response
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      const err = `ZAI API error (${response.status}): ${errorText}`
      agentEventBus.emit('llm:error', { provider: this.id, model: options.model, error: err })
      throw new Error(err)
    }

    const data = await response.json()
    const choice = data.choices?.[0]

    const result: ChatResponse = {
      content: choice?.message?.content || '',
      toolCalls: this.parseToolCalls(choice?.message?.tool_calls),
      model: data.model || options.model,
      provider: this.id,
      finishReason: choice?.finish_reason || 'stop',
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens || 0,
            completionTokens: data.usage.completion_tokens || 0,
            totalTokens: data.usage.total_tokens || 0,
          }
        : undefined,
    }

    console.log(
      `[${this.id}] chat() SUCCESS: model=${options.model}, tokens=${result.usage?.totalTokens ?? '?'}, ` +
      `contentLen=${result.content.length}, toolCalls=${result.toolCalls?.length ?? 0}, ` +
      `latency=${Date.now() - startTime}ms`,
    )

    agentEventBus.emit('llm:response', {
      provider: this.id,
      model: options.model,
      tokens: result.usage?.totalTokens,
      latencyMs: Date.now() - startTime,
    })

    return result
  }

  async *chatStream(options: ChatOptions): AsyncIterable<StreamChunk> {
    agentEventBus.emit('llm:request', {
      provider: this.id,
      model: options.model,
      messageCount: options.messages.length,
    })

    const body: Record<string, unknown> = {
      model: options.model,
      messages: this.buildMessages(options),
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      stream: true,
    }

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools
      body.tool_choice = 'auto'
      body.parallel_tool_calls = true   // FIX: Enable parallel tool calls — allows LLM to batch 10+ calls per response
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`ZAI stream error (${response.status}): ${errorText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No readable stream')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        const data = trimmed.slice(6)
        if (data === '[DONE]') return

        try {
          const parsed = JSON.parse(data)
          const choice = parsed.choices?.[0]
          if (!choice) continue

          const content = choice.delta?.content || ''
          const finishReason = choice.finish_reason

          if (content) {
            agentEventBus.emit('llm:stream-chunk', {
              provider: this.id,
              model: options.model,
              chunk: content,
            })
          }

          yield {
            content: content || undefined,
            toolCalls: this.parsePartialToolCalls(choice.delta?.tool_calls),
            finishReason: finishReason || undefined,
          }
        } catch {
          // Skip malformed JSON chunks
        }
      }
    }
  }

  private buildMessages(options: ChatOptions) {
    return options.messages.map((msg) => {
      const result: Record<string, unknown> = {
        role: msg.role,
        // CRITICAL FIX: OpenAI/NVIDIA API spec requires content to be null
        // (not "") when an assistant message has tool_calls and no text.
        // Sending content:"" causes "missing field tool_call_id" 400 errors
        // because the API interprets the message as a text-only assistant message
        // rather than a tool-calling assistant message.
        content: (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0 && !msg.content)
          ? null
          : msg.content,
      }
      if (msg.toolCalls) {
        result.tool_calls = msg.toolCalls
      }
      if (msg.toolCallId) {
        result.tool_call_id = msg.toolCallId
      }
      return result
    })
  }

  private parseToolCalls(toolCalls: unknown): StructuredToolCall[] | undefined {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) return undefined
    return toolCalls as StructuredToolCall[]
  }

  private parsePartialToolCalls(toolCalls: unknown): Partial<StructuredToolCall>[] | undefined {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) return undefined
    return toolCalls as Partial<StructuredToolCall>[]
  }
}

// ── OpenAI-Compatible Provider ─────────────────────────────────────────────────

class OpenAICompatibleProvider implements LLMProvider {
  id: string
  name: string
  models: string[]
  available: boolean
  priority: number
  private apiKey: string
  private baseUrl: string
  private customHeaders: Record<string, string>

  constructor(config: ProviderConfig) {
    this.id = config.id
    this.name = config.name
    this.models = config.models || []
    this.apiKey = config.apiKey || ''
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1'
    this.priority = config.priority ?? 10
    this.available = !!(config.apiKey && config.enabled !== false)
    this.customHeaders = config.headers || {}
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    const startTime = Date.now()

    agentEventBus.emit('llm:request', {
      provider: this.id,
      model: options.model,
      messageCount: options.messages.length,
    })

    const body: Record<string, unknown> = {
      model: options.model,
      messages: this.buildMessages(options),
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      stream: false,
    }

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools
      body.tool_choice = 'auto'
      body.parallel_tool_calls = true   // FIX: Enable parallel tool calls — allows LLM to batch 10+ calls per response
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        ...this.customHeaders,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      const err = `OpenAI-compatible API error (${response.status}): ${errorText}`
      agentEventBus.emit('llm:error', { provider: this.id, model: options.model, error: err })
      throw new Error(err)
    }

    const data = await response.json()
    const choice = data.choices?.[0]

    const result: ChatResponse = {
      content: choice?.message?.content || '',
      toolCalls: this.parseToolCalls(choice?.message?.tool_calls),
      model: data.model || options.model,
      provider: this.id,
      finishReason: choice?.finish_reason || 'stop',
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens || 0,
            completionTokens: data.usage.completion_tokens || 0,
            totalTokens: data.usage.total_tokens || 0,
          }
        : undefined,
    }

    console.log(
      `[${this.id}] chat() SUCCESS: model=${options.model}, tokens=${result.usage?.totalTokens ?? '?'}, ` +
      `contentLen=${result.content.length}, toolCalls=${result.toolCalls?.length ?? 0}, ` +
      `latency=${Date.now() - startTime}ms`,
    )

    agentEventBus.emit('llm:response', {
      provider: this.id,
      model: options.model,
      tokens: result.usage?.totalTokens,
      latencyMs: Date.now() - startTime,
    })

    return result
  }

  async *chatStream(options: ChatOptions): AsyncIterable<StreamChunk> {
    agentEventBus.emit('llm:request', {
      provider: this.id,
      model: options.model,
      messageCount: options.messages.length,
    })

    const body: Record<string, unknown> = {
      model: options.model,
      messages: this.buildMessages(options),
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      stream: true,
    }

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools
      body.tool_choice = 'auto'
      body.parallel_tool_calls = true   // FIX: Enable parallel tool calls — allows LLM to batch 10+ calls per response
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        ...this.customHeaders,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OpenAI-compatible stream error (${response.status}): ${errorText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No readable stream')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        const data = trimmed.slice(6)
        if (data === '[DONE]') return

        try {
          const parsed = JSON.parse(data)
          const choice = parsed.choices?.[0]
          if (!choice) continue

          const content = choice.delta?.content || ''
          const finishReason = choice.finish_reason

          if (content) {
            agentEventBus.emit('llm:stream-chunk', {
              provider: this.id,
              model: options.model,
              chunk: content,
            })
          }

          yield {
            content: content || undefined,
            toolCalls: this.parsePartialToolCalls(choice.delta?.tool_calls),
            finishReason: finishReason || undefined,
          }
        } catch {
          // Skip malformed JSON chunks
        }
      }
    }
  }

  private buildMessages(options: ChatOptions) {
    return options.messages.map((msg) => {
      const result: Record<string, unknown> = {
        role: msg.role,
        // CRITICAL FIX: OpenAI/NVIDIA API spec requires content to be null
        // (not "") when an assistant message has tool_calls and no text.
        content: (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0 && !msg.content)
          ? null
          : msg.content,
      }
      if (msg.toolCalls) {
        result.tool_calls = msg.toolCalls
      }
      if (msg.toolCallId) {
        result.tool_call_id = msg.toolCallId
      }
      return result
    })
  }

  private parseToolCalls(toolCalls: unknown): StructuredToolCall[] | undefined {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) return undefined
    return toolCalls as StructuredToolCall[]
  }

  private parsePartialToolCalls(toolCalls: unknown): Partial<StructuredToolCall>[] | undefined {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) return undefined
    return toolCalls as Partial<StructuredToolCall>[]
  }
}

// ── Ollama Provider (local models) ────────────────────────────────────────────

class OllamaProvider implements LLMProvider {
  id = 'ollama'
  name = 'Ollama (Local)'
  models: string[]
  available: boolean
  priority = 50 // Local models have lower priority by default

  private baseUrl: string

  constructor(baseUrl: string = 'http://localhost:11434') {
    this.baseUrl = baseUrl
    this.models = [] // Discovered dynamically
    this.available = true // Assume available, will fail gracefully
    this.discoverModels().catch(() => { this.available = false })
  }

  private async discoverModels(): Promise<void> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/tags`)
      if (resp.ok) {
        const data = await resp.json()
        this.models = (data.models || []).map((m: { name: string }) => m.name)
        agentEventBus.emit('provider:registered', { providerId: this.id, models: this.models })
      }
    } catch {
      this.available = false
    }
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    const startTime = Date.now()

    agentEventBus.emit('llm:request', {
      provider: this.id,
      model: options.model,
      messageCount: options.messages.length,
    })

    const body = {
      model: options.model,
      messages: options.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
      options: {
        num_predict: options.maxTokens,
        temperature: options.temperature,
      },
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`Ollama error (${response.status})`)
    }

    const data = await response.json()

    agentEventBus.emit('llm:response', {
      provider: this.id,
      model: options.model,
      tokens: data.eval_count,
      latencyMs: Date.now() - startTime,
    })

    return {
      content: data.message?.content || '',
      model: options.model,
      provider: this.id,
      finishReason: data.done ? 'stop' : 'length',
      usage: {
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
    }
  }

  async *chatStream(options: ChatOptions): AsyncIterable<StreamChunk> {
    const body = {
      model: options.model,
      messages: options.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`Ollama stream error (${response.status})`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No readable stream')

    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const text = decoder.decode(value, { stream: true })
      // Ollama sends one JSON object per line
      for (const line of text.split('\n')) {
        if (!line.trim()) continue
        try {
          const data = JSON.parse(line)
          if (data.message?.content) {
            yield { content: data.message.content, finishReason: data.done ? 'stop' : undefined }
          }
        } catch {
          // Skip malformed lines
        }
      }
    }
  }
}

// ── Rate-Limit-Aware Fallback ──────────────────────────────────────────────────

/** Configuration for rate-limit-aware fallback behaviour */
export interface FallbackConfig {
  /** Maximum number of retry attempts across all providers (default: 3) */
  maxRetries: number
  /** Base delay in ms before the first retry (default: 1000), doubled each attempt */
  retryDelayMs: number
  /** HTTP status codes that indicate rate-limiting (default: [429, 529, 503]) */
  rateLimitStatusCodes: number[]
  /** Substring patterns in error messages that signal rate-limit / overload */
  fallbackOnErrors: string[]
}

const DEFAULT_FALLBACK_CONFIG: FallbackConfig = {
  maxRetries: 6,
  retryDelayMs: 1000,
  rateLimitStatusCodes: [429, 529, 503],
  fallbackOnErrors: [
    'rate_limit',
    'rate limit',
    'rate-limit',
    'overloaded',
    'overload',
    'too many requests',
    'capacity',
    'temporarily unavailable',
    'slow_down',
    'slow down',
  ],
}

/**
 * Tracks per-provider rate-limit cooldowns so that the registry can
 * temporarily deprioritise providers that have recently returned 429/529.
 */
export class RateLimitTracker {
  private providerCooldowns: Map<string, { until: number; reason: string }> = new Map()
  /**
   * Providers that have been permanently disabled (e.g., zero balance,
   * invalid API key, model not found). These will never be retried.
   */
  private permanentlyDisabled = new Set<string>()

  /** Mark a provider as permanently disabled for this session. */
  markPermanentlyDisabled(providerId: string): void {
    this.permanentlyDisabled.add(providerId)
  }

  /** Check if a provider is permanently disabled. */
  isPermanentlyDisabled(providerId: string): boolean {
    return this.permanentlyDisabled.has(providerId)
  }

  /** Mark a provider as rate-limited for the next `retryAfterMs` milliseconds. */
  markRateLimited(providerId: string, retryAfterMs: number, reason: string): void {
    const until = Date.now() + retryAfterMs
    const existing = this.providerCooldowns.get(providerId)
    // Only extend, never shorten an existing cooldown
    if (!existing || until > existing.until) {
      this.providerCooldowns.set(providerId, { until, reason })
      agentEventBus.emit('provider:rate-limited', {
        providerId,
        reason,
        retryAfterMs,
      })
    }
  }

  /**
   * Check whether a provider is currently rate-limited.
   * Returns `{ limited: true, … }` when the cooldown has not yet expired.
   */
  isRateLimited(providerId: string): { limited: boolean; reason?: string; retryAfterMs?: number } {
    this.clearExpired()
    const entry = this.providerCooldowns.get(providerId)
    if (!entry) return { limited: false }
    const remaining = entry.until - Date.now()
    if (remaining <= 0) {
      this.providerCooldowns.delete(providerId)
      return { limited: false }
    }
    return { limited: true, reason: entry.reason, retryAfterMs: remaining }
  }

  /**
   * Return the next available (non-rate-limited) provider from the
   * fallback chain, skipping any provider whose ID is in `exclude`.
   */
  getNextAvailableProvider(
    fallbackChain: string[],
    providers: Map<string, LLMProvider>,
    exclude: Set<string>,
  ): LLMProvider | undefined {
    this.clearExpired()
    for (const id of fallbackChain) {
      if (exclude.has(id)) continue
      if (this.permanentlyDisabled.has(id)) continue  // Skip permanently disabled
      const provider = providers.get(id)
      if (!provider?.available) continue
      if (this.isRateLimited(id).limited) continue
      return provider
    }
    // If all non-rate-limited providers are excluded, allow rate-limited ones
    // as a last resort (they might have cooled down by the time we actually call)
    for (const id of fallbackChain) {
      if (exclude.has(id)) continue
      if (this.permanentlyDisabled.has(id)) continue  // Still skip permanently disabled
      const provider = providers.get(id)
      if (provider?.available) return provider
    }
    return undefined
  }

  /** Remove all cooldown entries whose `until` timestamp has passed. */
  clearExpired(): void {
    const now = Date.now()
    for (const [id, entry] of this.providerCooldowns) {
      if (entry.until <= now) {
        this.providerCooldowns.delete(id)
        agentEventBus.emit('provider:cooldown-expired', { providerId: id })
      }
    }
  }

  /** Reset all rate-limit state (useful for testing). */
  reset(): void {
    this.providerCooldowns.clear()
  }

  /**
   * Clear a provider's cooldown when it succeeds after a previous error.
   * This ensures the provider is immediately available for the next request.
   */
  clearCooldown(providerId: string): void {
    this.providerCooldowns.delete(providerId)
  }

  /**
   * Re-enable a previously permanently disabled provider.
   * Useful when the user updates their API key or tops up their balance.
   */
  reenableProvider(providerId: string): void {
    this.permanentlyDisabled.delete(providerId)
    this.providerCooldowns.delete(providerId)
  }
}

/**
 * Parse retry_after value from an error message.
 * OpenRouter and other providers include this in the error JSON.
 */
function parseRetryAfter(error: unknown): number | undefined {
  const msg = error instanceof Error ? error.message : String(error ?? '')
  // Match "retry_after_seconds":6 or "retry_after_seconds_raw":5.499
  const match = msg.match(/retry_after_seconds[_""]*"\s*:\s*(\d+(?:\.\d+)?)/i)
    || msg.match(/retry.after[._""]*(\d+(?:\.\d+)?)/i)
    || msg.match(/Retry-After["']?\s*:\s*["']?(\d+)/i)
  if (match) {
    return Math.ceil(parseFloat(match[1]) * 1000) // Convert seconds to ms
  }
  // Check for header-style Retry-After in seconds
  const headerMatch = msg.match(/retry.after.*?(\d+)\s*s/i)
  if (headerMatch) {
    return parseInt(headerMatch[1], 10) * 1000
  }
  return undefined
}

/** Detect whether an error is a rate-limit / transient-overload error. */
function isRateLimitError(error: unknown, config: FallbackConfig): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '')
  const lowerMsg = msg.toLowerCase()

  // Check status-code patterns like "(429)" or "status 429"
  for (const code of config.rateLimitStatusCodes) {
    if (lowerMsg.includes(`(${code})`) || lowerMsg.includes(`status ${code}`) || lowerMsg.includes(`${code}`)) {
      return true
    }
  }

  // Check known error-message patterns
  for (const pattern of config.fallbackOnErrors) {
    if (lowerMsg.includes(pattern)) return true
  }

  return false
}

/**
 * Detect whether an error indicates PERMANENT unavailability
 * (not a temporary rate limit, but a permanent condition like zero balance).
 * These providers should be permanently skipped for the rest of the session.
 */
function isPermanentProviderError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '')
  const lowerMsg = msg.toLowerCase()

  // 429 rate limit errors are NEVER permanent — they are temporary.
  // Must check this FIRST to prevent accidentally disabling a provider
  // that just needs a cooldown period.
  if (lowerMsg.includes('429') || lowerMsg.includes('rate limit') || lowerMsg.includes('rate_limit') || lowerMsg.includes('too many requests') || lowerMsg.includes('频率限制')) {
    return false
  }

  // ZAI "余额不足" = insufficient balance (permanent until user tops up)
  if (lowerMsg.includes('余额不足') || lowerMsg.includes('insufficient balance')) return true
  // Invalid API key (permanent)
  if (lowerMsg.includes('invalid api key') || lowerMsg.includes('invalid_api_key')) return true
  // Account suspended / disabled
  if (lowerMsg.includes('account suspended') || lowerMsg.includes('account_disabled')) return true
  // Model not found (permanent)
  if (lowerMsg.includes('模型不存在') || lowerMsg.includes('model not found')) return true

  return false
}

/** Compute exponential-backoff delay with ±25 % jitter. */
function backoffWithJitter(attempt: number, baseDelayMs: number): number {
  const expDelay = baseDelayMs * Math.pow(2, attempt)
  const jitter = expDelay * 0.25 * (Math.random() * 2 - 1) // ±25 %
  return Math.max(100, Math.round(expDelay + jitter))
}

/** Sleep for a given number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Provider Registry ──────────────────────────────────────────────────────────

export class LLMProviderRegistry {
  private providers = new Map<string, LLMProvider>()
  private defaultProviderId = 'zai'
  private fallbackChain: string[] = []
  private rateLimitTracker = new RateLimitTracker()
  private fallbackConfig: FallbackConfig = { ...DEFAULT_FALLBACK_CONFIG }

  constructor() {
    // Register the default ZAI provider (always available)
    this.registerProvider(new ZAIProvider())
  }

  /**
   * Register a new provider.
   */
  registerProvider(provider: LLMProvider): void {
    this.providers.set(provider.id, provider)
    this.rebuildFallbackChain()

    agentEventBus.emit('provider:registered', {
      providerId: provider.id,
      models: provider.models,
    })
  }

  /**
   * Register an OpenAI-compatible provider from config.
   */
  registerOpenAICompatible(config: ProviderConfig): void {
    const provider = new OpenAICompatibleProvider(config)
    this.registerProvider(provider)
  }

  /**
   * Unregister a provider.
   */
  unregisterProvider(providerId: string): void {
    this.providers.delete(providerId)
    this.rebuildFallbackChain()
  }

  /**
   * Get a provider by ID.
   */
  getProvider(providerId: string): LLMProvider | undefined {
    return this.providers.get(providerId)
  }

  /**
   * Get the provider that supports a given model.
   * Searches all providers in priority order.
   */
  getProviderForModel(model: string): LLMProvider | undefined {
    // Check each provider's model list
    for (const provider of this.providers.values()) {
      if (provider.models.includes(model) && provider.available) {
        return provider
      }
    }

    // Partial match for versioned model names
    const lowerModel = model.toLowerCase()
    for (const provider of this.providers.values()) {
      if (!provider.available) continue
      for (const supportedModel of provider.models) {
        if (lowerModel.includes(supportedModel) || supportedModel.includes(lowerModel)) {
          return provider
        }
      }
    }

    // Default to the first available provider in fallback chain
    return this.getDefaultProvider()
  }

  /**
   * Get the current fallback chain (provider IDs in priority order).
   */
  getFallbackChain(): string[] {
    return [...this.fallbackChain]
  }

  /**
   * Get the default provider.
   */
  getDefaultProvider(): LLMProvider | undefined {
    const defaultProvider = this.providers.get(this.defaultProviderId)
    if (defaultProvider?.available) return defaultProvider

    // Fall back to first available
    for (const id of this.fallbackChain) {
      const provider = this.providers.get(id)
      if (provider?.available) return provider
    }

    return undefined
  }

  /**
   * Set the default provider.
   */
  setDefaultProvider(providerId: string): void {
    if (!this.providers.has(providerId)) {
      throw new Error(`Provider not found: ${providerId}`)
    }
    this.defaultProviderId = providerId
  }

  /**
   * Get the rate-limit tracker (for introspection / testing).
   */
  getRateLimitTracker(): RateLimitTracker {
    return this.rateLimitTracker
  }

  /**
   * v1.2: Expose the per-model rate-limit manager for debugging / API
   * introspection. The registry delegates per-model state to this manager
   * (provider-level state stays in `rateLimitTracker`).
   */
  getRateLimitManager() {
    return rateLimitManager
  }

  /**
   * Override the default fallback configuration.
   */
  setFallbackConfig(config: Partial<FallbackConfig>): void {
    this.fallbackConfig = { ...DEFAULT_FALLBACK_CONFIG, ...config }
  }

  /**
   * Execute a chat completion with rate-limit-aware automatic fallback.
   *
   * Behaviour:
   *   1. Detects rate-limit errors (429, 529, 503) and automatically falls back.
   *   2. Implements exponential backoff with jitter between retries.
   *   3. Tracks rate-limit windows per provider via RateLimitTracker.
   *   4. Temporarily deprioritises rate-limited providers.
   *   5. Emits proper events on every fallback / retry.
   */

  /**
   * Remap the requested model to the provider's own model if the requested
   * model is not supported by this provider.
   *
   * CRITICAL: ZAI-only models (glm-4.7-flash, glm-4.5-flash, glm-5.1, etc.)
   * are NEVER sent to non-ZAI providers. If the requested model is a ZAI model
   * and the provider is NOT ZAI, we always use the provider's own default model.
   * This prevents sending "glm-4.7-flash" to NVIDIA/OpenRouter/Ollama which
   * don't support those models.
   *
   * For non-ZAI models, if the provider doesn't support the requested model,
   * we fall back to the provider's first (primary) model.
   */
  private remapModelForProvider(provider: LLMProvider, requestedModel: string): string {
    // ZAI-only models — only ZAI provider can use these
    const ZAI_ONLY_MODELS = [
      'glm-4.7-flash', 'glm-4.5-flash', 'glm-5.1',
      'glm-4-flash-250414', 'glm-4-flashx-250414',
      'glm-4-plus-0111', 'glm-4-air-250414',
      'glm-4-flash', 'glm-4-flashx', 'glm-4-plus', 'glm-4', 'glm-3-turbo',
    ]

    // If provider IS ZAI, just check if model is in their list
    if (provider.id === 'zai') {
      if (provider.models.includes(requestedModel)) {
        return requestedModel
      }
      // ZAI doesn't have this exact model — use ZAI's first model
      const zaiModel = provider.models[0]
      console.log(`[LLM Registry] Model '${requestedModel}' not in ZAI model list, using '${zaiModel}' instead`)
      return zaiModel || requestedModel
    }

    // Provider is NOT ZAI — if the requested model is a ZAI-only model,
    // ALWAYS use the provider's own default model instead
    if (ZAI_ONLY_MODELS.some(m => requestedModel === m || requestedModel.startsWith('glm-'))) {
      const providerModel = provider.models[0]
      console.log(
        `[LLM Registry] Model '${requestedModel}' is ZAI-only, using provider '${provider.id}' default model '${providerModel}' instead`,
      )
      return providerModel || requestedModel
    }

    // Non-ZAI model requested on a non-ZAI provider — check if supported
    if (provider.models.includes(requestedModel)) {
      return requestedModel
    }

    // Fall back to provider's first model
    const remappedModel = provider.models[0]
    if (remappedModel) {
      console.log(
        `[LLM Registry] Model '${requestedModel}' not in ${provider.id}, using '${remappedModel}' instead`,
      )
    }
    return remappedModel || requestedModel
  }

  /**
   * UNLIMITED RETRY: This method NEVER gives up. It loops through all providers
   * (ZAI → NVIDIA → OpenRouter → Ollama) and when all fail in one round,
   * it waits for cooldowns to expire, clears them, and restarts from ZAI again.
   * The only way this returns is on SUCCESS. It will keep retrying forever.
   *
   * This ensures OpenForge never stops building due to temporary rate limits.
   * Permanent errors (zero balance, invalid key) disable the specific provider,
   * but the loop continues with remaining providers.
   */
  async chatWithFallback(options: ChatOptions): Promise<ChatResponse> {
    const config = this.fallbackConfig
    let roundNumber = 0
    const RETRY_DELAY_MS = 3000  // Wait 3s between full rounds
    const MAX_BACKOFF_MS = 30000 // Cap exponential backoff at 30s

    // INFINITE LOOP — we never give up, we just keep trying
    while (true) {
      roundNumber++
      this.rateLimitTracker.clearExpired()

      // Check if ALL providers are permanently disabled (no hope)
      const availableProviderIds = this.fallbackChain.filter(
        (id) => !this.rateLimitTracker.isPermanentlyDisabled(id) && this.providers.get(id)?.available,
      )

      if (availableProviderIds.length === 0) {
        // Even in this case, wait and try again — new providers might be registered
        // or the situation might be temporary
        console.warn(`[LLM Registry] All providers permanently disabled in round ${roundNumber}, waiting ${RETRY_DELAY_MS}ms...`)
        agentEventBus.emit('provider:retry', {
          providerId: 'all-disabled',
          model: options.model,
          attempt: roundNumber,
          maxRetries: Infinity,
          delayMs: RETRY_DELAY_MS,
        })
        await sleep(RETRY_DELAY_MS)
        continue
      }

      if (roundNumber > 1) {
        console.warn(`[LLM Registry] === RETRY ROUND ${roundNumber} === Restarting from ${availableProviderIds[0]}...`)
      }

      // Try each provider in priority order
      for (const providerId of availableProviderIds) {
        const provider = this.providers.get(providerId)
        if (!provider) continue

        // Skip if rate-limited
        const rateLimitStatus = this.rateLimitTracker.isRateLimited(providerId)
        if (rateLimitStatus.limited) {
          console.warn(`[LLM Registry] Provider '${providerId}' on cooldown for ${Math.ceil((rateLimitStatus.until! - Date.now()) / 1000)}s, skipping`)
          continue
        }

        // Auto-remap the model to the provider's own model if needed
        const providerOptions: ChatOptions = {
          ...options,
          model: this.remapModelForProvider(provider, options.model),
        }

        // v1.2: Per-model rate limiting — if this specific model on this
        // provider is in cooldown (e.g. it returned 429 recently), skip it
        // and try the next provider. The provider-level RateLimitTracker
        // above already handles provider-wide cooldowns; this adds a finer-
        // grained per-model layer so one model's 429 doesn't lock the
        // provider's other models.
        if (rateLimitManager.isRateLimited(provider.id, providerOptions.model)) {
          const remainingMs = rateLimitManager.getRateLimitRemaining(provider.id, providerOptions.model)
          console.warn(
            `[LLM Registry] Provider '${provider.id}' model '${providerOptions.model}' on per-model cooldown for ${Math.ceil(remainingMs / 1000)}s, skipping`,
          )
          agentEventBus.emit('provider:rate-limited', {
            providerId: provider.id,
            reason: `per-model cooldown for ${providerOptions.model}`,
            retryAfterMs: remainingMs,
          })
          continue
        }

        try {
          const result = await provider.chat(providerOptions)
          // SUCCESS: Clear any previous rate-limit cooldown for this provider
          this.rateLimitTracker.clearCooldown(provider.id)
          // v1.2: also reset per-model backoff
          rateLimitManager.recordSuccess(provider.id, providerOptions.model)
          if (roundNumber > 1) {
            console.log(`[LLM Registry] SUCCESS on round ${roundNumber} with provider '${provider.id}' model '${providerOptions.model}'`)
          }
          return result
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : 'Unknown error'
          console.error(`[LLM Registry] Provider '${provider.id}' FAILED:`, errMsg)

          // v1.2: Record per-model error state for declarative rule matching.
          // This applies exponential backoff or fixed cooldown based on the
          // ERROR_RULES table in rate-limiter.ts (22 rules: rate limit, quota
          // exceeded, invalid key, 429/401/403/503, etc.).
          const errorWithStatus = error as Error & { status?: number }
          const modelRateResult = rateLimitManager.recordError(provider.id, providerOptions.model, errorWithStatus)
          if (modelRateResult.cooldownMs > 0) {
            agentEventBus.emit('provider:rate-limited', {
              providerId: provider.id,
              reason: `model ${providerOptions.model}: ${modelRateResult.rule?.text || `status_${errorWithStatus.status}` || 'unknown error'}`,
              retryAfterMs: modelRateResult.cooldownMs,
            })
          }

          // Detect permanent errors (zero balance, invalid key, etc.)
          if (isPermanentProviderError(error)) {
            this.rateLimitTracker.markPermanentlyDisabled(provider.id)
            console.warn(`[LLM Registry] Provider '${provider.id}' PERMANENTLY DISABLED: ${errMsg}`)
            agentEventBus.emit('provider:fallback', {
              primary: provider.id,
              fallback: 'permanently-disabled',
              reason: errMsg,
            })
            continue
          }

          // Rate-limit error — mark cooldown and move to next provider
          if (isRateLimitError(error, config)) {
            const serverRetryAfter = parseRetryAfter(error)
            const cooldownMs = serverRetryAfter
              ? serverRetryAfter + 500
              : backoffWithJitter(1, config.retryDelayMs) * 2
            this.rateLimitTracker.markRateLimited(provider.id, cooldownMs, errMsg)

            agentEventBus.emit('provider:fallback', {
              primary: provider.id,
              fallback: 'rate-limited',
              reason: errMsg,
            })
          } else {
            // Non-rate-limit error — fall through to next provider immediately
            agentEventBus.emit('provider:fallback', {
              primary: provider.id,
              fallback: 'next-in-chain',
              reason: errMsg,
            })
          }
        }
      }

      // All providers in this round failed — wait before next round
      const delay = Math.min(RETRY_DELAY_MS * Math.pow(1.5, Math.min(roundNumber - 1, 5)), MAX_BACKOFF_MS)
      console.warn(`[LLM Registry] All providers failed in round ${roundNumber}, waiting ${Math.round(delay)}ms before round ${roundNumber + 1}...`)
      agentEventBus.emit('provider:retry', {
        providerId: 'round-restart',
        model: options.model,
        attempt: roundNumber,
        maxRetries: Infinity,
        delayMs: delay,
      })
      await sleep(delay)
    }
  }

  /**
   * UNLIMITED RETRY streaming version: Same as chatWithFallback but yields
   * stream chunks. When all providers fail in one round, waits for cooldowns
   * and restarts from ZAI. Never gives up.
   */
  async *chatStreamWithFallback(options: ChatOptions): AsyncIterable<StreamChunk> {
    const config = this.fallbackConfig
    let roundNumber = 0
    const RETRY_DELAY_MS = 3000
    const MAX_BACKOFF_MS = 30000

    // INFINITE LOOP — we never give up
    while (true) {
      roundNumber++
      this.rateLimitTracker.clearExpired()

      const availableProviderIds = this.fallbackChain.filter(
        (id) => !this.rateLimitTracker.isPermanentlyDisabled(id) && this.providers.get(id)?.available,
      )

      if (availableProviderIds.length === 0) {
        console.warn(`[LLM Registry] All providers disabled in stream round ${roundNumber}, waiting ${RETRY_DELAY_MS}ms...`)
        agentEventBus.emit('provider:retry', {
          providerId: 'all-disabled',
          model: options.model,
          attempt: roundNumber,
          maxRetries: Infinity,
          delayMs: RETRY_DELAY_MS,
        })
        await sleep(RETRY_DELAY_MS)
        continue
      }

      if (roundNumber > 1) {
        console.warn(`[LLM Registry] === STREAM RETRY ROUND ${roundNumber} === Restarting from ${availableProviderIds[0]}...`)
      }

      for (const providerId of availableProviderIds) {
        const provider = this.providers.get(providerId)
        if (!provider) continue

        const rateLimitStatus = this.rateLimitTracker.isRateLimited(providerId)
        if (rateLimitStatus.limited) {
          console.warn(`[LLM Registry] Provider '${providerId}' on cooldown (stream), skipping`)
          continue
        }

        const providerOptions: ChatOptions = {
          ...options,
          model: this.remapModelForProvider(provider, options.model),
        }

        // v1.2: Per-model rate limiting (same as chatWithFallback — see
        // comment above).
        if (rateLimitManager.isRateLimited(provider.id, providerOptions.model)) {
          const remainingMs = rateLimitManager.getRateLimitRemaining(provider.id, providerOptions.model)
          console.warn(
            `[LLM Registry] Provider '${provider.id}' model '${providerOptions.model}' on per-model cooldown (stream) for ${Math.ceil(remainingMs / 1000)}s, skipping`,
          )
          agentEventBus.emit('provider:rate-limited', {
            providerId: provider.id,
            reason: `per-model cooldown (stream) for ${providerOptions.model}`,
            retryAfterMs: remainingMs,
          })
          continue
        }

        try {
          this.rateLimitTracker.clearCooldown(provider.id)
          yield* provider.chatStream(providerOptions)
          // v1.2: also reset per-model backoff on successful stream
          rateLimitManager.recordSuccess(provider.id, providerOptions.model)
          return
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : 'Unknown error'
          console.error("[LLM Registry] Provider '" + provider.id + "' FAILED (stream):", errMsg)

          // v1.2: Record per-model error state (same as chatWithFallback).
          const errorWithStatus = error as Error & { status?: number }
          const modelRateResult = rateLimitManager.recordError(provider.id, providerOptions.model, errorWithStatus)
          if (modelRateResult.cooldownMs > 0) {
            agentEventBus.emit('provider:rate-limited', {
              providerId: provider.id,
              reason: `model ${providerOptions.model} (stream): ${modelRateResult.rule?.text || `status_${errorWithStatus.status}` || 'unknown error'}`,
              retryAfterMs: modelRateResult.cooldownMs,
            })
          }

          if (isPermanentProviderError(error)) {
            this.rateLimitTracker.markPermanentlyDisabled(provider.id)
            console.warn(`[LLM Registry] Provider '${provider.id}' PERMANENTLY DISABLED (stream): ${errMsg}`)
            agentEventBus.emit('provider:fallback', {
              primary: provider.id,
              fallback: 'permanently-disabled',
              reason: errMsg,
            })
            continue
          }

          if (isRateLimitError(error, config)) {
            const serverRetryAfter = parseRetryAfter(error)
            const cooldownMs = serverRetryAfter
              ? serverRetryAfter + 500
              : backoffWithJitter(1, config.retryDelayMs) * 2
            this.rateLimitTracker.markRateLimited(provider.id, cooldownMs, errMsg)

            agentEventBus.emit('provider:fallback', {
              primary: provider.id,
              fallback: 'rate-limited',
              reason: errMsg,
            })
          } else {
            agentEventBus.emit('provider:fallback', {
              primary: provider.id,
              fallback: 'next-in-chain',
              reason: errMsg,
            })
          }
        }
      }

      // All providers in this round failed — wait before next round
      const delay = Math.min(RETRY_DELAY_MS * Math.pow(1.5, Math.min(roundNumber - 1, 5)), MAX_BACKOFF_MS)
      console.warn(`[LLM Registry] All providers failed in stream round ${roundNumber}, waiting ${Math.round(delay)}ms before round ${roundNumber + 1}...`)
      agentEventBus.emit('provider:retry', {
        providerId: 'round-restart',
        model: options.model,
        attempt: roundNumber,
        maxRetries: Infinity,
        delayMs: delay,
      })
      await sleep(delay)
    }
  }

  /**
   * Get all registered providers.
   */
  getAllProviders(): LLMProvider[] {
    return Array.from(this.providers.values())
  }

  /**
   * Get all available models across all providers.
   */
  getAllModels(): Array<{ model: string; provider: string; available: boolean }> {
    const models: Array<{ model: string; provider: string; available: boolean }> = []
    for (const provider of this.providers.values()) {
      for (const model of provider.models) {
        models.push({ model, provider: provider.id, available: provider.available })
      }
    }
    return models
  }

  /**
   * Quick-register providers from environment variables.
   *
   * Fallback chain (priority order):
   *   0 – ZAI (default, always registered)
   *   1 – NVIDIA NIM #1   (NVIDIA_API_KEY_1  + NVIDIA_MODEL_1)
   *   2 – NVIDIA NIM #2   (NVIDIA_API_KEY_2  + NVIDIA_MODEL_2)
   *   3 – NVIDIA NIM #3   (NVIDIA_API_KEY_3  + NVIDIA_MODEL_3)
   *   4 – OpenRouter #1   (OPENROUTER_API_KEY_1 + OPENROUTER_MODEL_1)
   *   5 – OpenRouter #2   (OPENROUTER_API_KEY_2 + OPENROUTER_MODEL_2)
   *
   * Plus optional legacy providers when their single-key env vars are set.
   */
  registerFromEnvironment(): void {
    // Debug: log which env vars are detected
    console.log('[LLM Registry] registerFromEnvironment() called')
    console.log('[LLM Registry] ZAI_API_KEY:', process.env.ZAI_API_KEY ? 'SET' : 'NOT SET')
    console.log('[LLM Registry] NVIDIA_API_KEY_1:', process.env.NVIDIA_API_KEY_1 ? 'SET' : 'NOT SET')
    console.log('[LLM Registry] NVIDIA_MODEL_1:', process.env.NVIDIA_MODEL_1 || '(default)')
    console.log('[LLM Registry] NVIDIA_API_KEY_2:', process.env.NVIDIA_API_KEY_2 ? 'SET' : 'NOT SET')
    console.log('[LLM Registry] NVIDIA_MODEL_2:', process.env.NVIDIA_MODEL_2 || '(default)')
    console.log('[LLM Registry] NVIDIA_API_KEY_3:', process.env.NVIDIA_API_KEY_3 ? 'SET' : 'NOT SET')
    console.log('[LLM Registry] NVIDIA_MODEL_3:', process.env.NVIDIA_MODEL_3 || '(default)')
    console.log('[LLM Registry] OPENROUTER_API_KEY_1:', process.env.OPENROUTER_API_KEY_1 ? 'SET' : 'NOT SET')
    console.log('[LLM Registry] OPENROUTER_MODEL_1:', process.env.OPENROUTER_MODEL_1 || '(default)')
    console.log('[LLM Registry] OPENROUTER_API_KEY_2:', process.env.OPENROUTER_API_KEY_2 ? 'SET' : 'NOT SET')
    console.log('[LLM Registry] OPENROUTER_MODEL_2:', process.env.OPENROUTER_MODEL_2 || '(default)')

    // ── NVIDIA NIM Instance #1 (Priority 1) ────────────────────────────
    if (process.env.NVIDIA_API_KEY_1) {
      const model1 = process.env.NVIDIA_MODEL_1 || 'meta/llama-3.1-405b-instruct'
      this.registerOpenAICompatible({
        id: 'nvidia-1',
        name: `NVIDIA NIM #1 (${model1})`,
        apiKey: process.env.NVIDIA_API_KEY_1,
        baseUrl: process.env.NVIDIA_BASE_URL_1 || 'https://integrate.api.nvidia.com/v1',
        models: [model1],
        priority: 1,
      })
    }

    // ── NVIDIA NIM Instance #2 (Priority 2) ────────────────────────────
    if (process.env.NVIDIA_API_KEY_2) {
      const model2 = process.env.NVIDIA_MODEL_2 || 'nvidia/llama-3.1-nemotron-70b-instruct'
      this.registerOpenAICompatible({
        id: 'nvidia-2',
        name: `NVIDIA NIM #2 (${model2})`,
        apiKey: process.env.NVIDIA_API_KEY_2,
        baseUrl: process.env.NVIDIA_BASE_URL_2 || 'https://integrate.api.nvidia.com/v1',
        models: [model2],
        priority: 2,
      })
    }

    // ── NVIDIA NIM Instance #3 (Priority 3) ────────────────────────────
    if (process.env.NVIDIA_API_KEY_3) {
      const model3 = process.env.NVIDIA_MODEL_3 || 'deepseek-ai/deepseek-r1'
      this.registerOpenAICompatible({
        id: 'nvidia-3',
        name: `NVIDIA NIM #3 (${model3})`,
        apiKey: process.env.NVIDIA_API_KEY_3,
        baseUrl: process.env.NVIDIA_BASE_URL_3 || 'https://integrate.api.nvidia.com/v1',
        models: [model3],
        priority: 3,
      })
    }

    // ── OpenRouter Instance #1 (Priority 4) ────────────────────────────
    if (process.env.OPENROUTER_API_KEY_1) {
      const orModel1 = process.env.OPENROUTER_MODEL_1 || 'anthropic/claude-3.5-sonnet'
      this.registerOpenAICompatible({
        id: 'openrouter-1',
        name: `OpenRouter #1 (${orModel1})`,
        apiKey: process.env.OPENROUTER_API_KEY_1,
        baseUrl: 'https://openrouter.ai/api/v1',
        models: [orModel1],
        priority: 4,
        headers: {
          'HTTP-Referer': 'https://agentforge.dev',
          'X-Title': 'AgentForge',
        },
      })
    }

    // ── OpenRouter Instance #2 (Priority 5) ────────────────────────────
    if (process.env.OPENROUTER_API_KEY_2) {
      const orModel2 = process.env.OPENROUTER_MODEL_2 || 'openai/gpt-4o'
      this.registerOpenAICompatible({
        id: 'openrouter-2',
        name: `OpenRouter #2 (${orModel2})`,
        apiKey: process.env.OPENROUTER_API_KEY_2,
        baseUrl: 'https://openrouter.ai/api/v1',
        models: [orModel2],
        priority: 5,
        headers: {
          'HTTP-Referer': 'https://agentforge.dev',
          'X-Title': 'AgentForge',
        },
      })
    }

    // ── Legacy single-instance providers (kept for backward compat) ────

    // Legacy single NVIDIA key (maps to nvidia-1 if NVIDIA_API_KEY_1 not set)
    if (!process.env.NVIDIA_API_KEY_1 && process.env.NVIDIA_API_KEY) {
      this.registerOpenAICompatible({
        id: 'nvidia',
        name: 'NVIDIA NIM',
        apiKey: process.env.NVIDIA_API_KEY,
        baseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
        models: [
          'meta/llama-3.1-405b-instruct',
          'meta/llama-3.1-70b-instruct',
          'meta/llama-3.1-8b-instruct',
          'nvidia/llama-3.1-nemotron-70b-instruct',
          'deepseek-ai/deepseek-r1',
          'qwen/qwen2.5-72b-instruct',
        ],
        priority: 7,
      })
    }

    // Legacy single OpenRouter key (maps to openrouter-1 if OPENROUTER_API_KEY_1 not set)
    if (!process.env.OPENROUTER_API_KEY_1 && process.env.OPENROUTER_API_KEY) {
      this.registerOpenAICompatible({
        id: 'openrouter',
        name: 'OpenRouter',
        apiKey: process.env.OPENROUTER_API_KEY,
        baseUrl: 'https://openrouter.ai/api/v1',
        models: [
          'openai/gpt-4o', 'anthropic/claude-3.5-sonnet',
          'google/gemini-2.0-flash-exp', 'meta-llama/llama-3.1-405b-instruct',
        ],
        priority: 8,
        headers: {
          'HTTP-Referer': 'https://agentforge.dev',
          'X-Title': 'AgentForge',
        },
      })
    }

    // OpenAI
    if (process.env.OPENAI_API_KEY) {
      this.registerOpenAICompatible({
        id: 'openai',
        name: 'OpenAI',
        apiKey: process.env.OPENAI_API_KEY,
        baseUrl: 'https://api.openai.com/v1',
        models: [
          'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-4-32k',
          'gpt-3.5-turbo', 'o1', 'o1-mini', 'o3-mini',
        ],
        priority: 9,
      })
    }

    // Anthropic
    if (process.env.ANTHROPIC_API_KEY) {
      this.registerOpenAICompatible({
        id: 'anthropic',
        name: 'Anthropic',
        apiKey: process.env.ANTHROPIC_API_KEY,
        baseUrl: 'https://api.anthropic.com/v1',
        models: [
          'claude-3.5-sonnet-20241022', 'claude-3-opus-20240229',
          'claude-3-haiku-20240307', 'claude-3-sonnet-20240229',
        ],
        priority: 10,
        headers: {
          'anthropic-version': '2023-06-01',
        },
      })
    }

    // Google AI
    if (process.env.GOOGLE_AI_API_KEY) {
      this.registerOpenAICompatible({
        id: 'google',
        name: 'Google AI',
        apiKey: process.env.GOOGLE_AI_KEY,
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        models: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
        priority: 11,
      })
    }

    // Groq
    if (process.env.GROQ_API_KEY) {
      this.registerOpenAICompatible({
        id: 'groq',
        name: 'Groq',
        apiKey: process.env.GROQ_API_KEY,
        baseUrl: 'https://api.groq.com/openai/v1',
        models: ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
        priority: 12,
      })
    }

    // DeepSeek
    if (process.env.DEEPSEEK_API_KEY) {
      this.registerOpenAICompatible({
        id: 'deepseek',
        name: 'DeepSeek',
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseUrl: 'https://api.deepseek.com/v1',
        models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
        priority: 13,
      })
    }

    // Together AI
    if (process.env.TOGETHER_API_KEY) {
      this.registerOpenAICompatible({
        id: 'together',
        name: 'Together AI',
        apiKey: process.env.TOGETHER_API_KEY,
        baseUrl: 'https://api.together.xyz/v1',
        models: ['meta-llama/Llama-3-70b-chat-hf', 'mistralai/Mixtral-8x7B-Instruct-v0.1'],
        priority: 14,
      })
    }

    // Ollama (local)
    const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
    this.registerProvider(new OllamaProvider(ollamaUrl))

    // Azure OpenAI
    if (process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT) {
      const endpoint = process.env.AZURE_OPENAI_ENDPOINT
      const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4'
      this.registerOpenAICompatible({
        id: 'azure',
        name: 'Azure OpenAI',
        apiKey: process.env.AZURE_OPENAI_API_KEY,
        baseUrl: `${endpoint}/openai/deployments/${deployment}`,
        models: [deployment],
        priority: 15,
        headers: {
          'api-key': process.env.AZURE_OPENAI_API_KEY,
        },
      })
    }

    // ── Custom providers (added via UI at /api/providers/add) ──────────────
    let customPriority = 16
    for (let i = 1; i <= 50; i++) {
      const cpName = process.env[`CUSTOM_PROVIDER_NAME_${i}`]
      if (!cpName) continue
      const cpBaseUrl = process.env[`CUSTOM_PROVIDER_BASE_URL_${i}`]
      const cpApiKey = process.env[`CUSTOM_PROVIDER_API_KEY_${i}`]
      const cpModel = process.env[`CUSTOM_PROVIDER_MODEL_${i}`]
      if (!cpBaseUrl || !cpApiKey || !cpModel) { console.warn(`[LLM Registry] Custom #${i} incomplete — skipping`); continue }
      this.registerOpenAICompatible({ id: `custom-${i}`, name: `${cpName} (${cpModel})`, apiKey: cpApiKey, baseUrl: cpBaseUrl, models: [cpModel], priority: customPriority++ })
      console.log(`[LLM Registry] Custom #${i}: ${cpName} (${cpModel}) — priority ${customPriority - 1}`)
    }

    // Log the fallback chain for debugging
    console.log(
      `[LLM Registry] Fallback chain: ${this.fallbackChain.join(' → ')} `
      + `(${this.providers.size} providers registered)`,
    )
  }

  /**
   * Rebuild the fallback chain based on provider priority.
   */
  private rebuildFallbackChain(): void {
    const providers = Array.from(this.providers.values())
    providers.sort((a, b) => a.priority - b.priority)
    this.fallbackChain = providers.map((p) => p.id)
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────

export const llmProviderRegistry = new LLMProviderRegistry()

// Auto-register providers from environment on first import
if (typeof process !== 'undefined' && process.env) {
  try {
    llmProviderRegistry.registerFromEnvironment()
  } catch {
    // Ignore errors during auto-registration
  }
}
