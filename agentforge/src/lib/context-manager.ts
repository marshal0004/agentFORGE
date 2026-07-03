/**
 * Context Window Manager — Chef-Inspired Production Edition
 *
 * Production-grade context window management that prevents LLM context overflow
 * through hysteresis-based compaction, LRU file injection, tool result
 * abbreviation, and prompt caching architecture.
 *
 * Features:
 *   1. Hysteresis Context Truncation — Truncate past the max limit down to a
 *      min limit to prevent cache thrashing. Subsequent messages won't
 *      immediately trigger another truncation that would invalidate prompt caches.
 *   2. LRU File Injection — Track which files the agent has touched, sort by
 *      recency (LRU), inject top N relevant files into context. Includes
 *      pre-warmed files (package.json, schema, App.tsx, etc.) that are always
 *      included. Excludes the currently open document.
 *   3. Tool Result Abbreviation — When collapsing old messages, abbreviate
 *      completed tool invocations to short one-liner summaries instead of full
 *      results. E.g., "The assistant edited /src/app.tsx successfully."
 *   4. Prompt Caching Architecture — Separate system prompt into two parts:
 *      Part 1: Static role prompt (always cached, rarely changes)
 *      Part 2: Dynamic context (guidelines, relevant files, varies per request)
 *      Support Anthropic cacheControl: { type: 'ephemeral' } markers and
 *      provider-specific cache markers.
 *   - Token estimation (conservative character-based + keyword-aware)
 *   - Auto-compaction when approaching context window limits
 *   - LLM-powered summarization of older messages
 *   - Priority-based message retention (system > recent > tool results > older)
 *   - Configurable per-model context windows
 *   - Full integration with the typed event bus
 */

import { agentEventBus } from './event-bus'
import { llmProviderRegistry } from './llm-provider'

// ── Extended Event Map (merged into AgentEventMap at bottom of file) ───────────
// We extend the event map here so the types live next to the code that uses them.
// These are also re-exported so event-bus.ts can import and merge them.

export interface ContextManagerEventMap {
  'context:compaction': { sessionId: string; messagesBefore: number; messagesAfter: number; tokensSaved: number }
  'context:summarize': { sessionId: string; originalLength: number; summaryLength: number }
  'context:overflow': { sessionId: string; tokenCount: number; maxTokens: number }
  'context:hysteresis-truncation': { sessionId: string; messagesBefore: number; messagesAfter: number; minTarget: number; maxTrigger: number }
  'context:lru-file-injected': { sessionId: string; filesInjected: number; totalTokensUsed: number }
  'context:tool-abbreviated': { sessionId: string; originalTokens: number; abbreviatedTokens: number; messagesAffected: number }
  'context:cache-breakpoint': { sessionId: string; part: 'static' | 'dynamic'; tokenCount: number; provider: string }
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ContextMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  metadata?: {
    tokenCount?: number
    priority?: number
    timestamp?: number
    summary?: boolean
    abbreviated?: boolean
    /** If this message was produced by tool abbreviation, the original tool name */
    toolName?: string
    /** If this message was produced by tool abbreviation, whether the tool succeeded */
    toolSuccess?: boolean
    /** Mark a message as a cache breakpoint for prompt caching */
    cacheBreakpoint?: boolean
    /** Provider-specific cache control markers */
    cacheControl?: CacheControlMarker
  }
}

export interface CompactionResult {
  messages: ContextMessage[]
  messagesBefore: number
  messagesAfter: number
  tokensBefore: number
  tokensAfter: number
  tokensSaved: number
  summarized: boolean
  /** Whether hysteresis truncation was applied */
  hysteresisApplied?: boolean
  /** Whether tool abbreviation was applied */
  toolAbbreviationApplied?: boolean
}

export interface ContextWindowConfig {
  /** Maximum tokens for the context window (0 = use model default) */
  maxTokens: number
  /** Token threshold to trigger compaction (0.0–1.0, default 0.80) */
  compactionThreshold: number
  /** Minimum messages to keep after compaction (default 6) */
  minRetainedMessages: number
  /** Whether to use LLM summarization (default true) */
  useSummarization: boolean
  /** Model to use for summarization (default: same as chat model) */
  summarizationModel?: string

  // ── Hysteresis settings ───────────────────────────────────────────────────

  /** Max collapsed messages size (in tokens) before triggering hysteresis truncation (default: computed from model) */
  maxCollapsedMessagesSize?: number
  /** Min collapsed messages size (in tokens) to truncate down to (default: 50% of max) */
  minCollapsedMessagesSize?: number
  /** Whether hysteresis truncation is enabled (default: true) */
  enableHysteresis?: boolean

  // ── LRU File Injection settings ───────────────────────────────────────────

  /** Maximum number of LRU files to inject into context (default: 5) */
  maxLRUFiles?: number
  /** Maximum token budget for injected file contents (default: 8000) */
  lruFileTokenBudget?: number
  /** Whether LRU file injection is enabled (default: true) */
  enableLRUFiles?: boolean

  // ── Tool Abbreviation settings ────────────────────────────────────────────

  /** Whether tool abbreviation is enabled during compaction (default: true) */
  enableToolAbbreviation?: boolean
  /** Maximum tokens for a tool result before it gets abbreviated (default: 500) */
  toolAbbreviationThreshold?: number

  // ── Prompt Caching settings ──────────────────────────────────────────────

  /** Prompt cache configuration */
  promptCacheConfig?: PromptCacheConfig
}

// ── Prompt Caching Architecture Types ──────────────────────────────────────────

/**
 * Cache control marker for provider-specific prompt caching.
 * Supports Anthropic's ephemeral cache and generic provider markers.
 */
export interface CacheControlMarker {
  type: 'ephemeral' | 'persistent' | 'none'
  /** Provider-specific TTL in seconds (for providers that support it) */
  ttlSeconds?: number
  /** Provider name this marker is intended for */
  provider?: string
}

/**
 * Configuration for the two-part prompt caching architecture.
 */
export interface PromptCacheConfig {
  /** Whether prompt caching is enabled (default: true) */
  enabled: boolean
  /** The static role prompt (Part 1) — rarely changes, always cached */
  staticPrompt: string
  /** Provider to target for cache markers (default: 'anthropic') */
  provider: string
  /** Whether to add cacheControl markers to messages (default: true) */
  addCacheMarkers: boolean
  /** Maximum tokens for the dynamic context section (Part 2) before trimming (default: 12000) */
  dynamicContextMaxTokens: number
}

/**
 * A constructed prompt with separate static and dynamic parts,
 * each with optional cache control markers.
 */
export interface CachedPrompt {
  /** Static role prompt — Part 1 (rarely changes, cacheable) */
  staticPart: ContextMessage
  /** Dynamic context — Part 2 (guidelines, files, varies per request) */
  dynamicPart: ContextMessage
  /** Combined message list ready for an LLM call */
  messages: ContextMessage[]
}

// ── LRU File Tracker Types ─────────────────────────────────────────────────────

export interface TrackedFile {
  /** Relative file path */
  path: string
  /** File content (may be truncated for large files) */
  content: string
  /** Last accessed timestamp (ms since epoch) */
  lastAccessed: number
  /** Access count */
  accessCount: number
  /** Estimated token count for the content */
  tokenCount: number
  /** Whether this is a pre-warmed file (always included) */
  preWarmed: boolean
  /** Language hint (e.g., 'typescript', 'json') */
  language: string
}

/**
 * LRU File Tracker — tracks which files the agent has touched, sorts by
 * recency, and injects top N relevant files into context.
 *
 * Pre-warmed files (package.json, schema.prisma, App.tsx, etc.) are always
 * included. The currently open document is excluded because it's already in
 * context.
 */
export class LRUFileTracker {
  private files = new Map<string, TrackedFile>()
  private maxFiles: number
  private maxTokenBudget: number
  private preWarmedPaths: Set<string>
  private currentOpenDocument: string | null = null

  /** Default pre-warmed file paths that are always included if they exist. */
  static readonly DEFAULT_PREWARMED_PATHS = [
    'package.json',
    'tsconfig.json',
    'prisma/schema.prisma',
    'src/app/layout.tsx',
    'src/app/page.tsx',
    'src/lib/db.ts',
    'src/app/api/route.ts',
    'next.config.ts',
    'next.config.js',
    'next.config.mjs',
  ]

  constructor(options?: {
    maxFiles?: number
    maxTokenBudget?: number
    preWarmedPaths?: string[]
  }) {
    this.maxFiles = options?.maxFiles ?? 5
    this.maxTokenBudget = options?.maxTokenBudget ?? 8000
    this.preWarmedPaths = new Set(
      options?.preWarmedPaths ?? LRUFileTracker.DEFAULT_PREWARMED_PATHS,
    )
  }

  /**
   * Touch a file — record that the agent has accessed or modified it.
   * Updates the recency and access count.
   */
  touch(filePath: string, content: string, language?: string): void {
    const normalizedPath = this.normalizePath(filePath)
    const existing = this.files.get(normalizedPath)
    const tokenCount = estimateTokens(content)

    if (existing) {
      existing.lastAccessed = Date.now()
      existing.accessCount++
      existing.content = content
      existing.tokenCount = tokenCount
      if (language) existing.language = language
    } else {
      this.files.set(normalizedPath, {
        path: normalizedPath,
        content,
        lastAccessed: Date.now(),
        accessCount: 1,
        tokenCount,
        preWarmed: this.preWarmedPaths.has(normalizedPath),
        language: language ?? this.inferLanguage(normalizedPath),
      })
    }

    // Evict least-recently-used non-prewarmed files if over capacity
    this.evictIfNeeded()
  }

  /**
   * Remove a file from tracking (e.g., when it's deleted).
   */
  forget(filePath: string): void {
    this.files.delete(this.normalizePath(filePath))
  }

  /**
   * Set the currently open document (will be excluded from injection).
   */
  setCurrentOpenDocument(filePath: string | null): void {
    this.currentOpenDocument = filePath ? this.normalizePath(filePath) : null
  }

  /**
   * Get the top N relevant files to inject into context.
   * Pre-warmed files are always included. The currently open document is excluded.
   * Files are sorted by: pre-warmed first, then by recency (LRU).
   */
  getRelevantFiles(maxFiles?: number, tokenBudget?: number): TrackedFile[] {
    const effectiveMax = maxFiles ?? this.maxFiles
    const effectiveBudget = tokenBudget ?? this.maxTokenBudget

    // Filter out the currently open document
    const candidates = Array.from(this.files.values()).filter(
      (f) => f.path !== this.currentOpenDocument,
    )

    // Sort: pre-warmed first, then by lastAccessed descending
    candidates.sort((a, b) => {
      if (a.preWarmed !== b.preWarmed) return a.preWarmed ? -1 : 1
      return b.lastAccessed - a.lastAccessed
    })

    // Select files within budget
    const selected: TrackedFile[] = []
    let tokensUsed = 0

    for (const file of candidates) {
      if (selected.length >= effectiveMax) break
      if (tokensUsed + file.tokenCount > effectiveBudget && !file.preWarmed) {
        // Skip non-prewarmed files that would exceed budget
        continue
      }
      // For pre-warmed files, include even if over budget (but truncate content)
      if (file.preWarmed && tokensUsed + file.tokenCount > effectiveBudget) {
        // Include a truncated version
        const truncatedContent = this.truncateContent(file.content, effectiveBudget - tokensUsed)
        selected.push({
          ...file,
          content: truncatedContent,
          tokenCount: estimateTokens(truncatedContent),
        })
        tokensUsed += estimateTokens(truncatedContent)
      } else {
        selected.push(file)
        tokensUsed += file.tokenCount
      }
    }

    return selected
  }

  /**
   * Format the relevant files as a context block for injection into the prompt.
   */
  formatFilesContext(files: TrackedFile[]): string {
    if (files.length === 0) return ''

    const sections = files.map((file) => {
      const header = file.preWarmed
        ? `### FILE: ${file.path} [pre-warmed]`
        : `### FILE: ${file.path}`
      return `${header}\n\`\`\`${file.language}\n${file.content}\n\`\`\``
    })

    return `\n\n--- RELEVANT FILES ---\n${sections.join('\n\n')}\n--- END RELEVANT FILES ---\n`
  }

  /**
   * Get the number of tracked files.
   */
  get size(): number {
    return this.files.size
  }

  /**
   * Clear all tracked files.
   */
  clear(): void {
    this.files.clear()
    this.currentOpenDocument = null
  }

  /**
   * Get all tracked files (for debugging / inspection).
   */
  getAllFiles(): TrackedFile[] {
    return Array.from(this.files.values())
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private normalizePath(filePath: string): string {
    // Normalize to forward slashes and remove leading ./
    return filePath.replace(/\\/g, '/').replace(/^\.\//, '')
  }

  private inferLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
    const languageMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      json: 'json',
      prisma: 'prisma',
      sql: 'sql',
      css: 'css',
      html: 'html',
      md: 'markdown',
      yml: 'yaml',
      yaml: 'yaml',
      py: 'python',
      rs: 'rust',
      go: 'go',
    }
    return languageMap[ext] ?? 'text'
  }

  private truncateContent(content: string, tokenBudget: number): string {
    const maxChars = Math.floor(tokenBudget * 3.5) // Rough char estimate from tokens
    if (content.length <= maxChars) return content
    return content.substring(0, maxChars) + '\n... [file truncated for context budget]'
  }

  private evictIfNeeded(): void {
    // Only evict non-prewarmed files
    const nonPrewarmed = Array.from(this.files.entries())
      .filter(([, f]) => !f.preWarmed)
      .sort(([, a], [, b]) => a.lastAccessed - b.lastAccessed) // Oldest first

    while (nonPrewarmed.length > this.maxFiles) {
      const [pathToEvict] = nonPrewarmed.shift()!
      this.files.delete(pathToEvict)
    }
  }
}

// ── Tool Result Abbreviator ────────────────────────────────────────────────────

/**
 * Tool Result Abbreviator — collapses completed tool invocations into short
 * one-liner summaries instead of full results during compaction.
 *
 * E.g., "The assistant edited /src/app.tsx successfully." instead of the
 * full file content.
 */
export class ToolResultAbbreviator {
  private abbreviationThreshold: number
  private enabled: boolean

  /** Patterns for extracting structured information from tool results */
  private static readonly TOOL_PATTERNS: Array<{
    pattern: RegExp
    summarizer: (match: RegExpMatchArray) => string
  }> = [
    {
      // File write operations: write_file, edit_file
      pattern: /\[TOOL_CALL\]\s+write_file\(\{[^}]*path:\s*["']([^"']+)["']/,
      summarizer: (m) => `The assistant wrote to ${m[1]} successfully.`,
    },
    {
      pattern: /\[TOOL_CALL\]\s+edit_file\(\{[^}]*path:\s*["']([^"']+)["']/,
      summarizer: (m) => `The assistant edited ${m[1]} successfully.`,
    },
    {
      // File read operations
      pattern: /\[TOOL_CALL\]\s+read_file\(\{[^}]*path:\s*["']([^"']+)["']/,
      summarizer: (m) => `The assistant read ${m[1]}.`,
    },
    {
      // Terminal/shell commands
      pattern: /\[TOOL_CALL\]\s+(?:execute_command|terminal|bash|shell)\(\{[^}]*command:\s*["']([^"']+)["']/,
      summarizer: (m) => `The assistant ran: ${m[1].substring(0, 60)}${m[1].length > 60 ? '...' : ''}`,
    },
    {
      // Search operations
      pattern: /\[TOOL_CALL\]\s+(?:search|grep|find_files)\(\{[^}]*query:\s*["']([^"']+)["']/,
      summarizer: (m) => `The assistant searched for: ${m[1]}`,
    },
    {
      // Generic tool call pattern
      pattern: /\[TOOL_CALL\]\s+(\w+)\(/,
      summarizer: (m) => `The assistant used the ${m[1]} tool.`,
    },
  ]

  /** Patterns for detecting file paths in tool results */
  private static readonly FILE_PATH_PATTERN = /(?:^|\s|["'`])(\.?\/?(?:src|lib|app|components|pages|api|prisma|public|config)\/[^\s"'`<>)}\]]+)/g

  /** Patterns for detecting success/failure in tool results */
  private static readonly SUCCESS_PATTERNS = [
    /success(?:fully)?/i,
    /completed/i,
    /done/i,
    /created/i,
    /updated/i,
    /wrote/i,
    /saved/i,
    /no errors/i,
    /passed/i,
  ]

  private static readonly FAILURE_PATTERNS = [
    /error/i,
    /failed/i,
    /not found/i,
    /denied/i,
    /timeout/i,
    /exception/i,
  ]

  constructor(options?: {
    enabled?: boolean
    abbreviationThreshold?: number
  }) {
    this.enabled = options?.enabled ?? true
    this.abbreviationThreshold = options?.abbreviationThreshold ?? 500
  }

  /**
   * Abbreviate a tool result message if it exceeds the token threshold.
   * Returns the abbreviated message or the original if abbreviation is not needed.
   */
  abbreviate(message: ContextMessage): ContextMessage {
    if (!this.enabled) return message
    if (message.role !== 'tool' && message.role !== 'assistant') return message

    const tokenCount = message.metadata?.tokenCount ?? estimateTokens(message.content)
    if (tokenCount <= this.abbreviationThreshold) return message

    const summary = this.generateSummary(message)
    return {
      role: message.role,
      content: summary,
      metadata: {
        ...message.metadata,
        tokenCount: estimateTokens(summary),
        abbreviated: true,
      },
    }
  }

  /**
   * Abbreviate multiple tool result messages in a message list.
   * Only abbreviates messages that are old enough (not in the recent window).
   */
  abbreviateMessages(
    messages: ContextMessage[],
    recentWindow: number,
  ): { messages: ContextMessage[]; abbreviated: number; tokensSaved: number } {
    if (!this.enabled) {
      return { messages, abbreviated: 0, tokensSaved: 0 }
    }

    let abbreviated = 0
    let tokensSaved = 0
    const result = messages.map((msg, idx) => {
      // Don't abbreviate messages in the recent window
      if (idx >= messages.length - recentWindow) return msg
      // Don't abbreviate system messages
      if (msg.role === 'system') return msg
      // Don't abbreviate already-abbreviated messages
      if (msg.metadata?.abbreviated) return msg

      // Only abbreviate tool and assistant messages with tool results
      if (msg.role !== 'tool' && msg.role !== 'assistant') return msg

      const tokenCount = msg.metadata?.tokenCount ?? estimateTokens(msg.content)
      if (tokenCount <= this.abbreviationThreshold) return msg

      const originalTokens = tokenCount
      const abbreviatedMsg = this.abbreviate(msg)
      const newTokens = abbreviatedMsg.metadata?.tokenCount ?? estimateTokens(abbreviatedMsg.content)

      if (newTokens < originalTokens) {
        abbreviated++
        tokensSaved += originalTokens - newTokens
        return abbreviatedMsg
      }

      return msg
    })

    return { messages: result, abbreviated, tokensSaved }
  }

  /**
   * Generate a one-liner summary for a tool result message.
   */
  private generateSummary(message: ContextMessage): string {
    const content = message.content

    // Try structured tool pattern matching first
    for (const { pattern, summarizer } of ToolResultAbbreviator.TOOL_PATTERNS) {
      const match = content.match(pattern)
      if (match) {
        const baseSummary = summarizer(match)
        // Add success/failure indicator
        const outcome = this.detectOutcome(content)
        return outcome === 'failure'
          ? `${baseSummary} (failed)`
          : baseSummary
      }
    }

    // Fallback: extract file paths and generate summary
    const filePaths = this.extractFilePaths(content)
    if (filePaths.length > 0) {
      const outcome = this.detectOutcome(content)
      const pathList = filePaths.length <= 3
        ? filePaths.join(', ')
        : `${filePaths.slice(0, 3).join(', ')} and ${filePaths.length - 3} more`
      return outcome === 'failure'
        ? `Tool operation on ${pathList} failed.`
        : `Tool operation on ${pathList} completed successfully.`
    }

    // Last resort: truncate with outcome indicator
    const outcome = this.detectOutcome(content)
    const prefix = message.role === 'assistant' ? 'Assistant' : 'Tool result'
    const truncated = content.substring(0, 100)
    return outcome === 'failure'
      ? `${prefix}: ${truncated}... (failed)`
      : `${prefix}: ${truncated}... [abbreviated]`
  }

  /**
   * Detect whether a tool result indicates success or failure.
   */
  private detectOutcome(content: string): 'success' | 'failure' | 'unknown' {
    const lowerContent = content.toLowerCase()

    const failureCount = ToolResultAbbreviator.FAILURE_PATTERNS.reduce(
      (count, pattern) => count + (lowerContent.match(pattern)?.length ?? 0),
      0,
    )
    const successCount = ToolResultAbbreviator.SUCCESS_PATTERNS.reduce(
      (count, pattern) => count + (lowerContent.match(pattern)?.length ?? 0),
      0,
    )

    if (failureCount > successCount) return 'failure'
    if (successCount > 0) return 'success'
    return 'unknown'
  }

  /**
   * Extract file paths from tool result content.
   */
  private extractFilePaths(content: string): string[] {
    const paths: string[] = []
    const seen = new Set<string>()
    let match: RegExpExecArray | null

    const regex = new RegExp(ToolResultAbbreviator.FILE_PATH_PATTERN.source, 'g')
    while ((match = regex.exec(content)) !== null) {
      const p = match[1]
      if (!seen.has(p)) {
        seen.add(p)
        paths.push(p)
      }
    }

    return paths
  }

  /**
   * Update settings at runtime.
   */
  updateSettings(options: { enabled?: boolean; abbreviationThreshold?: number }): void {
    if (options.enabled !== undefined) this.enabled = options.enabled
    if (options.abbreviationThreshold !== undefined) this.abbreviationThreshold = options.abbreviationThreshold
  }
}

// ── Token estimation ───────────────────────────────────────────────────────────

/**
 * Conservative token estimator.
 *
 * Uses a heuristic of ~4 characters per token for English text and ~2 characters
 * per token for CJK text.  This is intentionally conservative (over-estimates)
 * to avoid context overflow.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0

  // Count CJK characters (they typically tokenize as 1-2 tokens each)
  const cjkChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f]/g) || []).length
  const nonCjkChars = text.length - cjkChars

  // CJK: ~2 chars per token; Latin: ~4 chars per token
  const cjkTokens = Math.ceil(cjkChars / 2)
  const latinTokens = Math.ceil(nonCjkChars / 4)

  return cjkTokens + latinTokens
}

// ── Model context windows ──────────────────────────────────────────────────────

/**
 * Known context window sizes for popular models.
 * Falls back to 4096 if the model is unknown.
 */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // GLM models
  'glm-5.1': 128_000,
  'glm-4.7-flash': 128_000,
  'glm-4.5-flash': 128_000,
  'glm-4-flash': 128_000,
  'glm-4-plus': 128_000,
  'glm-4-long': 1_000_000,
  'glm-4': 128_000,
  'glm-3-turbo': 32_000,

  // OpenAI
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4-turbo': 128_000,
  'gpt-4': 8_192,
  'gpt-4-32k': 32_768,
  'gpt-3.5-turbo': 16_385,
  'o1': 128_000,
  'o1-mini': 128_000,
  'o3-mini': 200_000,

  // Anthropic
  'claude-3.5-sonnet': 200_000,
  'claude-3-opus': 200_000,
  'claude-3-haiku': 200_000,
  'claude-3-sonnet': 200_000,

  // Google
  'gemini-2.0-flash': 1_000_000,
  'gemini-1.5-pro': 2_000_000,
  'gemini-1.5-flash': 1_000_000,

  // Meta
  'llama-3.1-405b': 128_000,
  'llama-3.1-70b': 128_000,
  'llama-3.1-8b': 128_000,

  // Mistral
  'mistral-large': 128_000,
  'mistral-medium': 32_000,
  'codestral': 32_000,

  // DeepSeek
  'deepseek-chat': 64_000,
  'deepseek-coder': 16_000,
  'deepseek-reasoner': 64_000,
}

/**
 * Get the context window size for a given model.
 */
export function getModelContextWindow(model: string): number {
  // Direct lookup
  if (MODEL_CONTEXT_WINDOWS[model]) return MODEL_CONTEXT_WINDOWS[model]

  // Partial match (handles versioned model names like "gpt-4o-2024-05-13")
  const lowerModel = model.toLowerCase()
  for (const [key, value] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (lowerModel.includes(key)) return value
  }

  // Default conservative fallback
  return 4096
}

// ── Prompt Cache Builder ───────────────────────────────────────────────────────

/**
 * Build a cached prompt with separate static and dynamic parts.
 *
 * Part 1 (static): The agent's role prompt — rarely changes, always cached.
 * Part 2 (dynamic): Guidelines, relevant files, project context — varies per request.
 *
 * Supports Anthropic's `cacheControl: { type: 'ephemeral' }` markers and
 * other provider-specific cache markers.
 */
export function buildCachedPrompt(options: {
  staticPrompt: string
  dynamicContext: string
  conversationMessages: ContextMessage[]
  cacheConfig: PromptCacheConfig
  sessionId: string
}): CachedPrompt {
  const { staticPrompt, dynamicContext, conversationMessages, cacheConfig, sessionId } = options

  // Part 1: Static role prompt with cache breakpoint
  const staticPart: ContextMessage = {
    role: 'system',
    content: staticPrompt,
    metadata: {
      tokenCount: estimateTokens(staticPrompt),
      cacheBreakpoint: cacheConfig.enabled && cacheConfig.addCacheMarkers,
      cacheControl: cacheConfig.enabled && cacheConfig.addCacheMarkers
        ? { type: 'ephemeral', provider: cacheConfig.provider }
        : undefined,
    },
  }

  // Part 2: Dynamic context with cache breakpoint
  const dynamicPart: ContextMessage = {
    role: 'system',
    content: dynamicContext,
    metadata: {
      tokenCount: estimateTokens(dynamicContext),
      cacheBreakpoint: cacheConfig.enabled && cacheConfig.addCacheMarkers,
      cacheControl: cacheConfig.enabled && cacheConfig.addCacheMarkers
        ? { type: 'ephemeral', provider: cacheConfig.provider }
        : undefined,
    },
  }

  // Combine into final message list
  const messages: ContextMessage[] = [
    staticPart,
    dynamicPart,
    ...conversationMessages,
  ]

  // Emit cache breakpoint events for observability
  if (cacheConfig.enabled) {
    agentEventBus.emit('context:cache-breakpoint', {
      sessionId,
      part: 'static',
      tokenCount: staticPart.metadata!.tokenCount!,
      provider: cacheConfig.provider,
    })
    agentEventBus.emit('context:cache-breakpoint', {
      sessionId,
      part: 'dynamic',
      tokenCount: dynamicPart.metadata!.tokenCount!,
      provider: cacheConfig.provider,
    })
  }

  return { staticPart, dynamicPart, messages }
}

/**
 * Apply provider-specific cache markers to a message list.
 * This mutates the metadata of messages that are designated as cache breakpoints.
 */
export function applyCacheMarkers(
  messages: ContextMessage[],
  provider: string,
): ContextMessage[] {
  return messages.map((msg) => {
    if (!msg.metadata?.cacheBreakpoint) return msg

    const cacheControl = getProviderCacheMarker(provider)
    return {
      ...msg,
      metadata: {
        ...msg.metadata,
        cacheControl,
      },
    }
  })
}

/**
 * Get the appropriate cache control marker for a given provider.
 */
export function getProviderCacheMarker(provider: string): CacheControlMarker {
  switch (provider.toLowerCase()) {
    case 'anthropic':
    case 'claude':
      return { type: 'ephemeral', provider: 'anthropic' }
    case 'openai':
      // OpenAI uses automatic caching — no explicit markers needed,
      // but we mark it for observability
      return { type: 'persistent', provider: 'openai' }
    case 'google':
    case 'gemini':
      // Google has context caching but different API
      return { type: 'persistent', provider: 'google' }
    default:
      // Generic provider — mark as ephemeral
      return { type: 'ephemeral', provider }
  }
}

/**
 * Convert cache control markers to Anthropic API format.
 * This is used when sending messages to the Anthropic API.
 */
export function toAnthropicCacheFormat(
  messages: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return messages.map((msg) => {
    const metadata = (msg as ContextMessage).metadata
    if (metadata?.cacheControl?.type === 'ephemeral') {
      return {
        ...msg,
        cache_control: { type: 'ephemeral' },
      }
    }
    return msg
  })
}

// ── ContextManager class ───────────────────────────────────────────────────────

const DEFAULT_CONFIG: ContextWindowConfig = {
  maxTokens: 0, // 0 = auto from model
  compactionThreshold: 0.80,
  minRetainedMessages: 6,
  useSummarization: true,
  enableHysteresis: true,
  maxCollapsedMessagesSize: undefined, // computed from model
  minCollapsedMessagesSize: undefined, // computed as 50% of max
  maxLRUFiles: 5,
  lruFileTokenBudget: 8000,
  enableLRUFiles: true,
  enableToolAbbreviation: true,
  toolAbbreviationThreshold: 500,
  promptCacheConfig: {
    enabled: true,
    staticPrompt: '',
    provider: 'anthropic',
    addCacheMarkers: true,
    dynamicContextMaxTokens: 12000,
  },
}

export class ContextManager {
  private config: ContextWindowConfig
  private summarizationInProgress = false
  private lruTracker: LRUFileTracker
  private abbreviator: ToolResultAbbreviator
  /**
   * v1.4 (Claude Code v2.1.168): Auto-compact circuit breaker.
   *
   * Tracks consecutive compaction attempts that resulted in immediate
   * re-overflow. If 3 consecutive compactions don't free up enough space,
   * we stop trying and surface an actionable error to the caller.
   */
  private compactionFailures = 0
  private lastCompactionAt = 0
  private static readonly COMPACTION_CIRCUIT_BREAKER_LIMIT = 3
  private static readonly COMPACTION_RAPID_REFILL_MS = 60_000 // 1 minute

  constructor(config: Partial<ContextWindowConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.lruTracker = new LRUFileTracker({
      maxFiles: this.config.maxLRUFiles ?? 5,
      maxTokenBudget: this.config.lruFileTokenBudget ?? 8000,
    })
    this.abbreviator = new ToolResultAbbreviator({
      enabled: this.config.enableToolAbbreviation ?? true,
      abbreviationThreshold: this.config.toolAbbreviationThreshold ?? 500,
    })
  }

  // ── Public API (backward compatible) ───────────────────────────────────────

  /**
   * Get the effective max tokens for the given model.
   */
  getMaxTokens(model: string): number {
    return this.config.maxTokens || getModelContextWindow(model)
  }

  /**
   * Check if the context window is approaching overflow and needs compaction.
   */
  needsCompaction(messages: ContextMessage[], model: string): boolean {
    const maxTokens = this.getMaxTokens(model)
    const currentTokens = this.countTokens(messages)
    const threshold = Math.floor(maxTokens * this.config.compactionThreshold)
    return currentTokens >= threshold
  }

  /**
   * Count the total tokens in a message list.
   */
  countTokens(messages: ContextMessage[]): number {
    return messages.reduce((sum, msg) => {
      if (msg.metadata?.tokenCount) return sum + msg.metadata.tokenCount
      const estimated = estimateTokens(msg.content)
      if (!msg.metadata) msg.metadata = {}
      msg.metadata.tokenCount = estimated
      return sum + estimated
    }, 0)
  }

  /**
   * Compact the message list if it exceeds the context window threshold.
   *
   * Strategy (Chef-inspired):
   *   1. Always keep the system message
   *   2. Keep the most recent N messages (minRetainedMessages)
   *   3. Apply hysteresis truncation: truncate PAST the max limit down to
   *      the min limit to prevent cache thrashing
   *   4. Abbreviate old tool results instead of keeping full content
   *   5. Summarize or truncate remaining older messages
   *   6. Emit events for observability
   */
  async compact(
    messages: ContextMessage[],
    model: string,
    sessionId: string,
  ): Promise<CompactionResult> {
    const maxTokens = this.getMaxTokens(model)
    const tokensBefore = this.countTokens(messages)

    if (tokensBefore < Math.floor(maxTokens * this.config.compactionThreshold)) {
      return {
        messages,
        messagesBefore: messages.length,
        messagesAfter: messages.length,
        tokensBefore,
        tokensAfter: tokensBefore,
        tokensSaved: 0,
        summarized: false,
        hysteresisApplied: false,
        toolAbbreviationApplied: false,
      }
    }

    // Separate system messages from the rest
    const systemMessages = messages.filter((m) => m.role === 'system')
    const nonSystemMessages = messages.filter((m) => m.role !== 'system')

    // ── Step 1: Apply tool result abbreviation to old messages ──────────

    const abbreviationResult = this.abbreviator.abbreviateMessages(
      nonSystemMessages,
      this.config.minRetainedMessages,
    )
    const abbreviatedMessages = abbreviationResult.messages

    if (abbreviationResult.abbreviated > 0) {
      agentEventBus.emit('context:tool-abbreviated', {
        sessionId,
        originalTokens: tokensBefore,
        abbreviatedTokens: this.countTokens(abbreviatedMessages) + this.countTokens(systemMessages),
        messagesAffected: abbreviationResult.abbreviated,
      })
    }

    // ── Step 2: Apply hysteresis truncation ──────────────────────────────

    const currentTokens = this.countTokens(abbreviatedMessages) + this.countTokens(systemMessages)
    const hysteresisResult = this.applyHysteresisTruncation(
      systemMessages,
      abbreviatedMessages,
      currentTokens,
      model,
      sessionId,
    )

    const {
      messages: hysteresisMessages,
      applied: hysteresisApplied,
    } = hysteresisResult

    // ── Step 3: Summarize or truncate remaining older messages ──────────

    const finalNonSystem = hysteresisMessages.filter((m) => m.role !== 'system')
    const finalSystem = hysteresisMessages.filter((m) => m.role === 'system')

    let compactedOlder: ContextMessage[]

    if (this.config.useSummarization && finalNonSystem.length > this.config.minRetainedMessages) {
      const retainedCount = Math.max(
        this.config.minRetainedMessages,
        Math.ceil(finalNonSystem.length * 0.3),
      )
      const olderMessages = finalNonSystem.slice(0, -retainedCount)
      const recentMessages = finalNonSystem.slice(-retainedCount)

      if (olderMessages.length > 0) {
        compactedOlder = [
          ...(await this.summarizeMessages(olderMessages, model, sessionId)),
          ...recentMessages,
        ]
      } else {
        compactedOlder = recentMessages
      }
    } else {
      // Simple truncation with hysteresis-aware sizing
      const retainedCount = Math.max(
        this.config.minRetainedMessages,
        Math.ceil(finalNonSystem.length * 0.3),
      )
      const olderMessages = finalNonSystem.slice(0, -retainedCount)
      const recentMessages = finalNonSystem.slice(-retainedCount)

      compactedOlder = [
        ...olderMessages.map((msg) => ({
          role: msg.role,
          content: msg.content.substring(0, 200) + (msg.content.length > 200 ? '... [truncated]' : ''),
          metadata: { ...msg.metadata, summary: true },
        })),
        ...recentMessages,
      ]
    }

    const result = [...finalSystem, ...compactedOlder]
    const tokensAfter = this.countTokens(result)

    agentEventBus.emit('context:compaction', {
      sessionId,
      messagesBefore: messages.length,
      messagesAfter: result.length,
      tokensSaved: tokensBefore - tokensAfter,
    })

    return {
      messages: result,
      messagesBefore: messages.length,
      messagesAfter: result.length,
      tokensBefore,
      tokensAfter,
      tokensSaved: tokensBefore - tokensAfter,
      summarized: this.config.useSummarization,
      hysteresisApplied,
      toolAbbreviationApplied: abbreviationResult.abbreviated > 0,
    }
  }

  /**
   * Build the final message list for an LLM call, respecting context limits.
   * This is the main entry point for the chat route.
   *
   * Now includes:
   *   - LRU file injection into the dynamic context
   *   - Prompt caching architecture (static + dynamic system prompt parts)
   *   - Hysteresis-aware compaction
   *   - Tool result abbreviation
   */
  async buildContextWindow(
    messages: ContextMessage[],
    model: string,
    sessionId: string,
  ): Promise<ContextMessage[]> {
    const maxTokens = this.getMaxTokens(model)
    let result = [...messages]

    // Check if compaction is needed
    if (this.needsCompaction(result, model)) {
      // v1.4 (Claude Code v2.1.168): Circuit breaker — if we just compacted
      // and immediately overflowed again, count it as a failure. After 3
      // consecutive failures, surface an actionable error instead of burning
      // more API calls on hopeless compaction.
      const now = Date.now()
      const rapidRefill =
        this.lastCompactionAt > 0 &&
        now - this.lastCompactionAt < ContextManager.COMPACTION_RAPID_REFILL_MS

      if (rapidRefill) {
        this.compactionFailures++
        agentEventBus.emit('context:compaction-rapid-refill', {
          sessionId,
          consecutiveFailures: this.compactionFailures,
          msSinceLastCompaction: now - this.lastCompactionAt,
        })
      } else {
        // Reset counter — enough time has passed that this isn't a tight loop
        this.compactionFailures = 0
      }

      if (this.compactionFailures >= ContextManager.COMPACTION_CIRCUIT_BREAKER_LIMIT) {
        // Circuit breaker tripped — abort with an actionable message
        const errorMsg =
          `Context window exhausted: compaction has been triggered ${this.compactionFailures} times in ` +
          `the last ${Math.round((now - this.lastCompactionAt) / 1000)}s without making progress. ` +
          `The conversation is too large for a single session. Start a new session or reduce the scope.`
        agentEventBus.emit('context:circuit-breaker-tripped', {
          sessionId,
          consecutiveFailures: this.compactionFailures,
          maxAttempts: ContextManager.COMPACTION_CIRCUIT_BREAKER_LIMIT,
        })
        // Throw an error so the chat route can handle it gracefully
        throw new ContextCompactionError(errorMsg, {
          sessionId,
          consecutiveFailures: this.compactionFailures,
        })
      }

      // Fire PreCompact hook (v1.4: allows hooks to pin specific messages)
      // We do this just before compact() so hooks can mark which messages
      // MUST survive compaction.
      try {
        const { hookSystem } = await import('./hook-system')
        const preCompactDecision = await hookSystem.firePreCompact({
          sessionId,
          tokensBefore: this.countTokens(result),
          maxTokens,
          messages: result.map((m) => ({ role: m.role, content: m.content })),
        })
        // If hooks pinned messages, mark them with metadata so compact()
        // preserves them (future enhancement — for now we just emit an event)
        if (preCompactDecision.pinMessageIndices && preCompactDecision.pinMessageIndices.length > 0) {
          agentEventBus.emit('context:messages-pinned', {
            sessionId,
            pinnedIndices: preCompactDecision.pinMessageIndices,
          })
          for (const idx of preCompactDecision.pinMessageIndices) {
            if (result[idx]) {
              result[idx] = {
                ...result[idx],
                metadata: { ...result[idx].metadata, pinned: true },
              }
            }
          }
        }
      } catch (err) {
        // Hook errors should never block compaction
        console.warn('[ContextManager] PreCompact hook error:', (err as Error).message)
      }

      const compaction = await this.compact(result, model, sessionId)
      result = compaction.messages
      this.lastCompactionAt = Date.now()

      // Fire PostCompact hook (observability)
      try {
        const { hookSystem } = await import('./hook-system')
        await hookSystem.firePostCompact({
          sessionId,
          tokensBefore: compaction.tokensBefore,
          tokensAfter: compaction.tokensAfter,
          messagesAfter: compaction.messagesAfter,
        })
      } catch (err) {
        console.warn('[ContextManager] PostCompact hook error:', (err as Error).message)
      }
    }

    // ── LRU File Injection ─────────────────────────────────────────────

    if (this.config.enableLRUFiles && this.lruTracker.size > 0) {
      const relevantFiles = this.lruTracker.getRelevantFiles(
        this.config.maxLRUFiles,
        this.config.lruFileTokenBudget,
      )

      if (relevantFiles.length > 0) {
        const filesContext = this.lruTracker.formatFilesContext(relevantFiles)
        const filesTokensUsed = estimateTokens(filesContext)

        // Inject as a system message before the conversation
        const existingSystemIdx = result.findIndex((m) => m.role === 'system')
        if (existingSystemIdx >= 0) {
          // Append to the last system message
          const lastSystemIdx = result.findLastIndex((m) => m.role === 'system')
          result[lastSystemIdx] = {
            ...result[lastSystemIdx],
            content: result[lastSystemIdx].content + filesContext,
            metadata: {
              ...result[lastSystemIdx].metadata,
              tokenCount: (result[lastSystemIdx].metadata?.tokenCount ?? 0) + filesTokensUsed,
            },
          }
        } else {
          // No system message exists — add one
          result.unshift({
            role: 'system',
            content: filesContext,
            metadata: { tokenCount: filesTokensUsed },
          })
        }

        agentEventBus.emit('context:lru-file-injected', {
          sessionId,
          filesInjected: relevantFiles.length,
          totalTokensUsed: filesTokensUsed,
        })
      }
    }

    // Final safety check: if still over limit, truncate the largest non-system message
    let totalTokens = this.countTokens(result)
    let safetyIterations = 0
    while (totalTokens > maxTokens && safetyIterations < 10) {
      safetyIterations++

      // Find the largest non-system message
      let largestIdx = -1
      let largestSize = 0
      for (let i = 0; i < result.length; i++) {
        if (result[i].role !== 'system') {
          const size = this.countTokens([result[i]])
          if (size > largestSize) {
            largestSize = size
            largestIdx = i
          }
        }
      }

      if (largestIdx === -1) break

      // Truncate it to half its size
      const budget = Math.floor(largestSize / 2)
      result[largestIdx] = this.truncateMessage(result[largestIdx], Math.max(budget, 100))
      totalTokens = this.countTokens(result)

      agentEventBus.emit('context:overflow', {
        sessionId,
        tokenCount: totalTokens,
        maxTokens,
      })
    }

    return result
  }

  /**
   * Build a cached prompt with separate static and dynamic parts.
   * This is the preferred entry point when using prompt caching.
   */
  buildCachedContextWindow(
    messages: ContextMessage[],
    model: string,
    sessionId: string,
    dynamicContext?: string,
  ): CachedPrompt {
    const cacheConfig = this.config.promptCacheConfig ?? DEFAULT_CONFIG.promptCacheConfig!

    // Build dynamic context with LRU files
    let dynamicContent = dynamicContext ?? ''

    if (this.config.enableLRUFiles && this.lruTracker.size > 0) {
      const relevantFiles = this.lruTracker.getRelevantFiles(
        this.config.maxLRUFiles,
        this.config.lruFileTokenBudget,
      )
      if (relevantFiles.length > 0) {
        dynamicContent += this.lruTracker.formatFilesContext(relevantFiles)

        agentEventBus.emit('context:lru-file-injected', {
          sessionId,
          filesInjected: relevantFiles.length,
          totalTokensUsed: estimateTokens(this.lruTracker.formatFilesContext(relevantFiles)),
        })
      }
    }

    // Trim dynamic context if it exceeds the token budget
    const dynamicTokens = estimateTokens(dynamicContent)
    if (dynamicTokens > cacheConfig.dynamicContextMaxTokens) {
      const maxChars = Math.floor(cacheConfig.dynamicContextMaxTokens * 3.5)
      dynamicContent = dynamicContent.substring(0, maxChars) + '\n... [dynamic context trimmed]'
    }

    const staticPrompt = cacheConfig.staticPrompt || 'You are a helpful AI assistant.'

    const cached = buildCachedPrompt({
      staticPrompt,
      dynamicContext: dynamicContent,
      conversationMessages: messages,
      cacheConfig,
      sessionId,
    })

    // Apply provider-specific cache markers
    if (cacheConfig.addCacheMarkers) {
      cached.messages = applyCacheMarkers(cached.messages, cacheConfig.provider)
    }

    return cached
  }

  // ── Hysteresis Context Truncation ─────────────────────────────────────────

  /**
   * Apply hysteresis truncation: when the collapsed message size exceeds
   * maxCollapsedMessagesSize, truncate down to minCollapsedMessagesSize
   * instead of just barely below the max. This prevents cache thrashing
   * where each subsequent message would re-trigger truncation.
   *
   * The idea is like a thermostat: you don't turn the heater on at 68° and
   * off at 69° — you turn it on at 66° and off at 70°. Similarly, we don't
   * truncate at max and stop at max-1; we truncate all the way down to min.
   */
  private applyHysteresisTruncation(
    systemMessages: ContextMessage[],
    nonSystemMessages: ContextMessage[],
    currentTotalTokens: number,
    model: string,
    sessionId: string,
  ): { messages: ContextMessage[]; applied: boolean } {
    if (!this.config.enableHysteresis) {
      return {
        messages: [...systemMessages, ...nonSystemMessages],
        applied: false,
      }
    }

    const maxTokens = this.getMaxTokens(model)
    const maxCollapsed = this.config.maxCollapsedMessagesSize ?? Math.floor(maxTokens * 0.6)
    const minCollapsed = this.config.minCollapsedMessagesSize ?? Math.floor(maxCollapsed * 0.5)

    // Calculate the token size of non-system messages
    const nonSystemTokens = this.countTokens(nonSystemMessages)

    // Only trigger hysteresis if we're above the max threshold
    if (nonSystemTokens < maxCollapsed) {
      return {
        messages: [...systemMessages, ...nonSystemMessages],
        applied: false,
      }
    }

    // We're above the max — truncate down to the min, not just below the max
    // This prevents the next message from immediately re-triggering truncation
    const messagesBefore = nonSystemMessages.length
    const truncated: ContextMessage[] = []
    let accumulatedTokens = 0

    // Work backwards from most recent messages to preserve recency
    for (let i = nonSystemMessages.length - 1; i >= 0; i--) {
      const msg = nonSystemMessages[i]
      const msgTokens = this.countTokens([msg])

      if (accumulatedTokens + msgTokens <= minCollapsed) {
        truncated.unshift(msg)
        accumulatedTokens += msgTokens
      } else if (truncated.length < this.config.minRetainedMessages) {
        // Always keep minimum retained messages
        truncated.unshift(msg)
        accumulatedTokens += msgTokens
      } else {
        // We've hit the min target — stop adding messages
        break
      }
    }

    agentEventBus.emit('context:hysteresis-truncation', {
      sessionId,
      messagesBefore,
      messagesAfter: truncated.length,
      minTarget: minCollapsed,
      maxTrigger: maxCollapsed,
    })

    return {
      messages: [...systemMessages, ...truncated],
      applied: true,
    }
  }

  // ── LRU File Management ─────────────────────────────────────────────────

  /**
   * Touch a file in the LRU tracker — record that the agent has accessed it.
   */
  touchFile(filePath: string, content: string, language?: string): void {
    this.lruTracker.touch(filePath, content, language)
  }

  /**
   * Set the currently open document (excluded from LRU injection).
   */
  setCurrentOpenDocument(filePath: string | null): void {
    this.lruTracker.setCurrentOpenDocument(filePath)
  }

  /**
   * Get the LRU file tracker instance.
   */
  getLRUTracker(): LRUFileTracker {
    return this.lruTracker
  }

  /**
   * Get the tool result abbreviator instance.
   */
  getAbbreviator(): ToolResultAbbreviator {
    return this.abbreviator
  }

  // ── Existing API (backward compatible) ─────────────────────────────────

  /**
   * Use LLM to summarize a set of older messages into a compact summary.
   */
  private async summarizeMessages(
    messages: ContextMessage[],
    model: string,
    sessionId: string,
  ): Promise<ContextMessage[]> {
    if (messages.length === 0) return []

    // Prevent concurrent summarizations
    if (this.summarizationInProgress) {
      return messages.map((msg) => ({
        role: msg.role,
        content: msg.content.substring(0, 150) + '... [summarization skipped]',
        metadata: { ...msg.metadata, summary: true },
      }))
    }

    this.summarizationInProgress = true

    try {
      const conversationText = messages
        .map((m) => `[${m.role}]: ${m.content}`)
        .join('\n\n')

      const originalLength = conversationText.length

      const summarizationModel = this.config.summarizationModel || model

      // Try to use the provider registry for summarization
      let summary: string
      try {
        const provider = llmProviderRegistry.getProviderForModel(summarizationModel)
        if (provider) {
          const response = await provider.chat({
            model: summarizationModel,
            messages: [
              {
                role: 'system',
                content: 'Summarize the following conversation history concisely, preserving key decisions, code changes, and tool results. Use bullet points. Do not lose any critical information.',
              },
              { role: 'user', content: conversationText },
            ],
            maxTokens: 1000,
            temperature: 0,
          })
          summary = response.content
        } else {
          summary = this.fallbackSummarize(messages)
        }
      } catch {
        summary = this.fallbackSummarize(messages)
      }

      agentEventBus.emit('context:summarize', {
        sessionId,
        originalLength,
        summaryLength: summary.length,
      })

      return [
        {
          role: 'system',
          content: `[Conversation Summary]\n${summary}`,
          metadata: {
            summary: true,
            tokenCount: estimateTokens(summary),
          },
        },
      ]
    } finally {
      this.summarizationInProgress = false
    }
  }

  /**
   * Fallback summarization when LLM is unavailable.
   * Extracts key information from messages using heuristics.
   */
  private fallbackSummarize(messages: ContextMessage[]): string {
    const lines: string[] = ['Previous conversation summary:']

    for (const msg of messages) {
      const preview = msg.content.substring(0, 100)
      if (msg.role === 'assistant') {
        // Extract file references
        const fileMatches = msg.content.match(/### FILE: (.+)/g)
        if (fileMatches && fileMatches.length > 0) {
          lines.push(`- Generated files: ${fileMatches.map((f) => f.replace('### FILE: ', '')).join(', ')}`)
        } else {
          lines.push(`- Assistant: ${preview}...`)
        }
      } else if (msg.role === 'tool') {
        lines.push(`- Tool result: ${preview}...`)
      } else if (msg.role === 'user') {
        lines.push(`- User asked: ${preview}...`)
      }
    }

    return lines.join('\n')
  }

  /**
   * Truncate a single message to fit within a token budget.
   */
  truncateMessage(message: ContextMessage, maxTokens: number): ContextMessage {
    const current = this.countTokens([message])
    if (current <= maxTokens) return message

    // Rough character count from token budget
    const maxChars = maxTokens * 3.5
    return {
      ...message,
      content: message.content.substring(0, Math.floor(maxChars)) + '\n... [message truncated]',
      metadata: {
        ...message.metadata,
        tokenCount: maxTokens,
      },
    }
  }

  /**
   * Update configuration at runtime.
   */
  updateConfig(updates: Partial<ContextWindowConfig>): void {
    this.config = { ...this.config, ...updates }

    // Propagate settings to sub-components
    if (updates.enableToolAbbreviation !== undefined || updates.toolAbbreviationThreshold !== undefined) {
      this.abbreviator.updateSettings({
        enabled: updates.enableToolAbbreviation,
        abbreviationThreshold: updates.toolAbbreviationThreshold,
      })
    }

    if (updates.maxLRUFiles !== undefined || updates.lruFileTokenBudget !== undefined) {
      // Re-create LRU tracker with new settings (preserving existing files)
      const existingFiles = this.lruTracker.getAllFiles()
      this.lruTracker = new LRUFileTracker({
        maxFiles: updates.maxLRUFiles ?? this.config.maxLRUFiles ?? 5,
        maxTokenBudget: updates.lruFileTokenBudget ?? this.config.lruFileTokenBudget ?? 8000,
      })
      // Restore existing files
      for (const file of existingFiles) {
        this.lruTracker.touch(file.path, file.content, file.language)
      }
    }
  }
}

// ── Extended AgentEventMap — augment the existing map with new context events ─
// These types extend the AgentEventMap from event-bus.ts.
// The actual merging is done by re-exporting and importing in event-bus.ts.

declare module './event-bus' {
  interface AgentEventMap {
    'context:hysteresis-truncation': { sessionId: string; messagesBefore: number; messagesAfter: number; minTarget: number; maxTrigger: number }
    'context:lru-file-injected': { sessionId: string; filesInjected: number; totalTokensUsed: number }
    'context:tool-abbreviated': { sessionId: string; originalTokens: number; abbreviatedTokens: number; messagesAffected: number }
    'context:cache-breakpoint': { sessionId: string; part: 'static' | 'dynamic'; tokenCount: number; provider: string }
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────

export const contextManager = new ContextManager()

// ── v1.4: Circuit Breaker Error ───────────────────────────────────────────────

/**
 * Thrown when the auto-compact circuit breaker trips.
 *
 * Mirrors Claude Code v2.1.168: "Fixed auto-compaction retrying indefinitely
 * after consecutive failures — a circuit breaker now stops after 3 attempts."
 *
 * The chat route catches this and surfaces an actionable error to the user
 * instead of burning API calls on hopeless compaction.
 */
export class ContextCompactionError extends Error {
  public readonly sessionId?: string
  public readonly consecutiveFailures: number

  constructor(
    message: string,
    details: { sessionId?: string; consecutiveFailures: number },
  ) {
    super(message)
    this.name = 'ContextCompactionError'
    this.sessionId = details.sessionId
    this.consecutiveFailures = details.consecutiveFailures
  }
}