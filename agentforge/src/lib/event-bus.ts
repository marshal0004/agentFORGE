/**
 * Typed Agent Event System
 *
 * A production-grade, strictly-typed event bus that powers the entire agent
 * lifecycle.  Every meaningful action — from tool execution to context
 * compaction — emits a typed event that extensions, loggers, and UI layers
 * can subscribe to.
 *
 * Design goals:
 *   - Zero-dependency (no external libs)
 *   - Strictly typed event names and payloads
 *   - Wildcard subscription for observability / logging
 *   - Async listener support with error isolation
 *   - Once / off / removeAll semantics
 *   - Event history replay for late subscribers
 */

// ── Event Map ──────────────────────────────────────────────────────────────────

export interface AgentEventMap {
  // Agent lifecycle
  'agent:start': { sessionId: string; projectId?: string; model: string }
  'agent:iteration': { sessionId: string; iteration: number; maxIterations: number }
  'agent:complete': { sessionId: string; iterations: number; totalTokens?: number }
  'agent:error': { sessionId: string; error: string; phase: string }

  // LLM
  'llm:request': { provider: string; model: string; messageCount: number }
  'llm:response': { provider: string; model: string; tokens?: number; latencyMs: number }
  'llm:stream-chunk': { provider: string; model: string; chunk: string }
  'llm:error': { provider: string; model: string; error: string }

  // Tool execution
  'tool:call': { toolName: string; params: Record<string, unknown>; source: string; parallel: boolean }
  'tool:result': { toolName: string; success: boolean; latencyMs: number; source: string }
  'tool:error': { toolName: string; error: string; source: string }
  // v1.2: emitted by tool-validator.ts when a destructive command or path-
  // traversal attempt is blocked before subprocess spawn.
  'tool:blocked': { toolName: string; toolCallId: string; reason: string }

  // Context management
  'context:compaction': { sessionId: string; messagesBefore: number; messagesAfter: number; tokensSaved: number }
  'context:summarize': { sessionId: string; originalLength: number; summaryLength: number }
  'context:overflow': { sessionId: string; tokenCount: number; maxTokens: number }

  // Context management — Chef-inspired extensions
  'context:hysteresis-truncation': { sessionId: string; messagesBefore: number; messagesAfter: number; minTarget: number; maxTrigger: number }
  'context:lru-file-injected': { sessionId: string; filesInjected: number; totalTokensUsed: number }
  'context:tool-abbreviated': { sessionId: string; originalTokens: number; abbreviatedTokens: number; messagesAffected: number }
  'context:cache-breakpoint': { sessionId: string; part: 'static' | 'dynamic'; tokenCount: number; provider: string }

  // Session branching
  'session:branch': { sessionId: string; branchId: string; parentId: string; fromIndex: number }
  'session:merge': { sessionId: string; sourceBranch: string; targetBranch: string }
  'session:checkpoint': { sessionId: string; checkpointId: string; messageCount: number }

  // Extension system
  'extension:loaded': { extensionId: string; version: string }
  'extension:hook-invoked': { extensionId: string; hook: string; latencyMs: number }
  'extension:error': { extensionId: string; hook: string; error: string }

  // Diff editing
  'diff:apply': { filePath: string; operations: number; success: boolean }
  'diff:conflict': { filePath: string; reason: string }

  // Provider
  'provider:switch': { from: string; to: string; model: string }
  'provider:fallback': { primary: string; fallback: string; reason: string }
  'provider:registered': { providerId: string; models: string[] }

  // Self-correction validation
  'validation:run': { projectPath: string; step: string; iteration: number }
  'validation:error': { projectPath: string; step: string; errors: number; warnings: number }
  'validation:pass': { projectPath: string; step: string }
  'correction:iteration': { projectPath: string; iteration: number; maxIterations: number; errorsBefore: number; errorsAfter: number }

  // File protection
  'file-protection:blocked': { filePath: string; reason: string; operation: 'read' | 'write' }

  // Provider rate limiting
  'provider:rate-limited': { providerId: string; reason: string; retryAfterMs: number }
  'provider:cooldown-expired': { providerId: string }
  'provider:retry': { providerId: string; model: string; attempt: number; maxRetries: number; delayMs: number }

  // Message compression
  'message:compressed': { id: string; originalSize: number; compressedSize: number; ratio: number }
  'message:decompressed': { id: string; compressedSize: number; originalSize: number }
  'message:compression-skipped': { id: string; reason: string }

  // Subchat
  'subchat:created': { subchatId: string; parentChatId: string; fromMessageIndex: number; title: string }
  'subchat:message-added': { subchatId: string; role: string; contentLength: number }
  'subchat:resolved': { subchatId: string; parentChatId: string; messageCount: number }
  'subchat:abandoned': { subchatId: string; parentChatId: string; messageCount: number }

  // v1.4 — Claude Code-inspired events
  /** Emitted when a PreToolUse hook blocks a tool call */
  'tool:blocked-hook': { toolName: string; reason: string; hookId: string; sessionId?: string }
  /** Emitted when progressive disclosure escalates a skill from L1 → L2 */
  'skill:triggered': { skillName: string; phrase: string; messageRole: string }
  /** Emitted when hookify registers a user-defined rule from .local.md */
  'hookify:rule-registered': { name: string; event: string; action: string; sourceFile: string }
  /** Emitted when a persistent shell is spawned (Claude Code v2.1.165) */
  'terminal:shell-started': { shellId: string; cwd: string }
  /** Emitted when a persistent shell exits */
  'terminal:exit': { shellId: string; exitCode: number | null; signal?: string }
  /** Emitted when a persistent shell is killed (SIGTERM or SIGKILL) */
  'terminal:killed': { shellId: string; signal: 'SIGTERM' | 'SIGKILL'; reason: string }
  /** Emitted when auto-compact detects a rapid refill (circuit breaker counting) */
  'context:compaction-rapid-refill': { sessionId: string; consecutiveFailures: number; msSinceLastCompaction: number }
  /** Emitted when the auto-compact circuit breaker trips (3 rapid refills in a row) */
  'context:circuit-breaker-tripped': { sessionId: string; consecutiveFailures: number; maxAttempts: number }
  /** Emitted when a PreCompact hook pins messages to survive compaction */
  'context:messages-pinned': { sessionId: string; pinnedIndices: number[] }
}

export type AgentEventName = keyof AgentEventMap

// ── Listener types ─────────────────────────────────────────────────────────────

export type EventListener<T extends AgentEventName> = (
  payload: AgentEventMap[T],
  event: T,
  timestamp: number,
) => void | Promise<void>

export type WildcardListener = (
  event: AgentEventName,
  payload: AgentEventMap[AgentEventName],
  timestamp: number,
) => void | Promise<void>

// ── Event record for history ───────────────────────────────────────────────────

export interface EventRecord {
  event: AgentEventName
  payload: AgentEventMap[AgentEventName]
  timestamp: number
}

// ── EventBus ───────────────────────────────────────────────────────────────────

const DEFAULT_MAX_HISTORY = 1000

export class EventBus {
  private listeners = new Map<AgentEventName, Set<EventListener<AgentEventName>>>()
  private wildcardListeners = new Set<WildcardListener>()
  private history: EventRecord[] = []
  private maxHistory: number
  private erroredListeners = new WeakSet<EventListener<any>>()

  constructor(maxHistory: number = DEFAULT_MAX_HISTORY) {
    this.maxHistory = maxHistory
  }

  // ── Subscribe ──────────────────────────────────────────────────────────────

  /**
   * Subscribe to a specific typed event.  Returns an unsubscribe function.
   */
  on<T extends AgentEventName>(event: T, listener: EventListener<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    const set = this.listeners.get(event)!
    set.add(listener as EventListener<AgentEventName>)

    return () => {
      set.delete(listener as EventListener<AgentEventName>)
      if (set.size === 0) this.listeners.delete(event)
    }
  }

  /**
   * Subscribe to a specific event, but only fire once.
   */
  once<T extends AgentEventName>(event: T, listener: EventListener<T>): () => void {
    const wrapper: EventListener<T> = (payload, evt, ts) => {
      unsub()
      return listener(payload, evt, ts)
    }
    const unsub = this.on(event, wrapper)
    return unsub
  }

  /**
   * Subscribe to ALL events (wildcard). Useful for logging / observability.
   */
  onAny(listener: WildcardListener): () => void {
    this.wildcardListeners.add(listener)
    return () => {
      this.wildcardListeners.delete(listener)
    }
  }

  /**
   * Remove a specific listener.
   */
  off<T extends AgentEventName>(event: T, listener: EventListener<T>): void {
    this.listeners.get(event)?.delete(listener as EventListener<AgentEventName>)
  }

  /**
   * Remove all listeners for a specific event, or all events if none given.
   */
  removeAllListeners(event?: AgentEventName): void {
    if (event) {
      this.listeners.delete(event)
    } else {
      this.listeners.clear()
      this.wildcardListeners.clear()
    }
  }

  // ── Emit ───────────────────────────────────────────────────────────────────

  /**
   * Emit a typed event.  All listeners are invoked asynchronously and errors
   * are isolated — one failing listener will not prevent others from running.
   */
  async emit<T extends AgentEventName>(
    event: T,
    payload: AgentEventMap[T],
  ): Promise<void> {
    const timestamp = Date.now()

    // Record history
    this.history.push({ event, payload, timestamp } as EventRecord)
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-Math.floor(this.maxHistory / 2))
    }

    // Specific listeners
    const specific = this.listeners.get(event)
    const promises: Promise<void>[] = []

    if (specific) {
      for (const listener of specific) {
        promises.push(
          this.safeInvoke(listener, payload, event, timestamp),
        )
      }
    }

    // Wildcard listeners
    for (const wl of this.wildcardListeners) {
      promises.push(
        this.safeInvokeWildcard(wl, event, payload, timestamp),
      )
    }

    await Promise.allSettled(promises)
  }

  // ── History ────────────────────────────────────────────────────────────────

  /**
   * Get recent event history, optionally filtered by event name.
   */
  getHistory(event?: AgentEventName, limit?: number): EventRecord[] {
    let records = event
      ? this.history.filter((r) => r.event === event)
      : this.history
    if (limit) {
      records = records.slice(-limit)
    }
    return records
  }

  /**
   * Replay past events to a listener.  Useful for late subscribers that need
   * to catch up on state.
   */
  async replay<T extends AgentEventName>(
    event: T,
    listener: EventListener<T>,
    limit?: number,
  ): Promise<void> {
    const records = this.getHistory(event, limit)
    for (const record of records) {
      await listener(
        record.payload as AgentEventMap[T],
        event,
        record.timestamp,
      )
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async safeInvoke(
    listener: EventListener<AgentEventName>,
    payload: AgentEventMap[AgentEventName],
    event: AgentEventName,
    timestamp: number,
  ): Promise<void> {
    try {
      await listener(payload, event, timestamp)
    } catch (err) {
      // Isolate errors — track repeat offenders
      if (this.erroredListeners.has(listener)) {
        // Second failure → auto-remove to prevent log spam
        this.off(event, listener as any)
      } else {
        this.erroredListeners.add(listener)
        console.error(`[EventBus] Listener error on "${event}":`, err)
      }
    }
  }

  private async safeInvokeWildcard(
    listener: WildcardListener,
    event: AgentEventName,
    payload: AgentEventMap[AgentEventName],
    timestamp: number,
  ): Promise<void> {
    try {
      await listener(event, payload, timestamp)
    } catch (err) {
      console.error(`[EventBus] Wildcard listener error on "${event}":`, err)
    }
  }

  // ── Diagnostics ────────────────────────────────────────────────────────────

  /**
   * Get the count of listeners for a given event (or total).
   */
  listenerCount(event?: AgentEventName): number {
    if (event) {
      return (this.listeners.get(event)?.size ?? 0)
    }
    let total = this.wildcardListeners.size
    for (const set of this.listeners.values()) {
      total += set.size
    }
    return total
  }

  /**
   * Get all event names that have at least one listener.
   */
  eventNames(): AgentEventName[] {
    return Array.from(this.listeners.keys())
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────

export const agentEventBus = new EventBus()