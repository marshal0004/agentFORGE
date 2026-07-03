/**
 * Subchat Manager — Branching Conversations
 *
 * Manages branching "subchats" that fork from a specific message index in a
 * parent chat.  This is analogous to git branches for conversations: a subchat
 * captures a tangent, deep-dive, or side quest that should be tracked
 * separately from the main conversation thread.
 *
 * Features:
 *   - Create subchats that branch from any message in the parent chat
 *   - Each subchat maintains its own independent message list
 *   - Subchats have a lifecycle: active → resolved | abandoned
 *   - Context injection: extract a compact summary of a subchat for
 *     re-injection into the parent chat (with optional token budget)
 *   - Only one active subchat per parent chat at a time (enforced)
 *   - Efficient lookups via nested Map structures
 *   - Full event bus integration
 *
 * Thread safety note: This implementation is designed for single-threaded
 * Node.js / Bun runtimes.  If used across Worker threads, external
 * synchronisation is required.
 */

import { agentEventBus } from './event-bus'

// ── Public Types ──────────────────────────────────────────────────────────────

export interface SubchatMessage {
  role: string
  content: string
  timestamp: number
}

export type SubchatStatus = 'active' | 'resolved' | 'abandoned'

export interface Subchat {
  /** Unique identifier for this subchat */
  id: string
  /** The main chat this subchat belongs to */
  parentChatId: string
  /** Message index in the parent chat where this subchat branched from */
  parentMessageIndex: number
  /** Messages within this subchat */
  messages: SubchatMessage[]
  /** Auto-generated or user-set title */
  title: string
  /** Current lifecycle status */
  status: SubchatStatus
  /** Unix timestamp (ms) when the subchat was created */
  createdAt: number
  /** Unix timestamp (ms) when the subchat was last updated */
  updatedAt: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Approximate characters per token for context estimation. */
const CHARS_PER_TOKEN = 4

/** Default maximum token budget for `getSubchatContext`. */
const DEFAULT_MAX_TOKENS = 4000

// ── Unique ID Generator ───────────────────────────────────────────────────────

let _idCounter = 0
function generateSubchatId(parentChatId: string): string {
  return `sc_${parentChatId}_${Date.now().toString(36)}_${(++_idCounter).toString(36)}`
}

// ── SubchatManager ────────────────────────────────────────────────────────────

export class SubchatManager {
  /** Primary index: subchatId → Subchat */
  private subchats = new Map<string, Subchat>()

  /** Secondary index: parentChatId → Set of subchatIds */
  private parentIndex = new Map<string, Set<string>>()

  /** Tertiary index: parentChatId → active subchatId (only one active per parent) */
  private activeSubchatIndex = new Map<string, string>()

  // ── Create ────────────────────────────────────────────────────────────────

  /**
   * Create a new subchat branching from a specific message index.
   *
   * @param parentChatId  The ID of the parent chat
   * @param fromMessageIndex  The message index in the parent where this
   *                          subchat branches from
   * @param title  Optional title; if omitted a default one is generated
   * @returns The newly created Subchat
   * @throws Error if the parent chat already has an active subchat
   */
  createSubchat(
    parentChatId: string,
    fromMessageIndex: number,
    title?: string,
  ): Subchat {
    // Enforce single-active-subchat constraint
    const activeId = this.activeSubchatIndex.get(parentChatId)
    if (activeId) {
      const activeSubchat = this.subchats.get(activeId)
      if (activeSubchat && activeSubchat.status === 'active') {
        throw new Error(
          `Parent chat "${parentChatId}" already has an active subchat "${activeId}". ` +
          `Resolve or abandon it before creating a new one.`,
        )
      }
    }

    const id = generateSubchatId(parentChatId)
    const now = Date.now()
    const subchat: Subchat = {
      id,
      parentChatId,
      parentMessageIndex: fromMessageIndex,
      messages: [],
      title: title ?? `Branch from message #${fromMessageIndex}`,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }

    // Store in primary index
    this.subchats.set(id, subchat)

    // Update secondary index
    if (!this.parentIndex.has(parentChatId)) {
      this.parentIndex.set(parentChatId, new Set())
    }
    this.parentIndex.get(parentChatId)!.add(id)

    // Update active index
    this.activeSubchatIndex.set(parentChatId, id)

    agentEventBus.emit('subchat:created', {
      subchatId: id,
      parentChatId,
      fromMessageIndex,
      title: subchat.title,
    })

    return subchat
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  /**
   * Get a subchat by its ID.
   */
  getSubchat(subchatId: string): Subchat | undefined {
    return this.subchats.get(subchatId)
  }

  /**
   * List all subchats for a given parent chat, ordered by creation time.
   */
  listSubchats(parentChatId: string): Subchat[] {
    const ids = this.parentIndex.get(parentChatId)
    if (!ids) return []

    const result: Subchat[] = []
    for (const id of ids) {
      const subchat = this.subchats.get(id)
      if (subchat) result.push(subchat)
    }

    // Sort by creation time ascending
    result.sort((a, b) => a.createdAt - b.createdAt)
    return result
  }

  /**
   * Get the currently active subchat for a parent chat.
   */
  getActiveSubchat(parentChatId: string): Subchat | undefined {
    const activeId = this.activeSubchatIndex.get(parentChatId)
    if (!activeId) return undefined
    const subchat = this.subchats.get(activeId)
    if (!subchat || subchat.status !== 'active') {
      // Stale index entry — clean up
      this.activeSubchatIndex.delete(parentChatId)
      return undefined
    }
    return subchat
  }

  // ── Update ────────────────────────────────────────────────────────────────

  /**
   * Add a message to a subchat.
   *
   * @throws Error if the subchat doesn't exist or is not active
   */
  addMessage(subchatId: string, role: string, content: string): void {
    const subchat = this.subchats.get(subchatId)
    if (!subchat) {
      throw new Error(`Subchat not found: ${subchatId}`)
    }
    if (subchat.status !== 'active') {
      throw new Error(
        `Cannot add message to subchat "${subchatId}" with status "${subchat.status}". ` +
        `Only active subchats can receive messages.`,
      )
    }

    const now = Date.now()
    subchat.messages.push({ role, content, timestamp: now })
    subchat.updatedAt = now

    agentEventBus.emit('subchat:message-added', {
      subchatId,
      role,
      contentLength: content.length,
    })
  }

  /**
   * Resolve a subchat — mark it as complete.
   *
   * Once resolved, no more messages can be added.  The parent chat's active
   * subchat slot is freed for a new subchat.
   */
  resolveSubchat(subchatId: string): void {
    const subchat = this.subchats.get(subchatId)
    if (!subchat) {
      throw new Error(`Subchat not found: ${subchatId}`)
    }
    if (subchat.status !== 'active') {
      return // Idempotent — already resolved / abandoned
    }

    subchat.status = 'resolved'
    subchat.updatedAt = Date.now()

    // Clear active index if this was the active subchat
    if (this.activeSubchatIndex.get(subchat.parentChatId) === subchatId) {
      this.activeSubchatIndex.delete(subchat.parentChatId)
    }

    agentEventBus.emit('subchat:resolved', {
      subchatId,
      parentChatId: subchat.parentChatId,
      messageCount: subchat.messages.length,
    })
  }

  /**
   * Abandon a subchat — mark it as discarded.
   *
   * Abandoned subchats are retained for audit / history purposes but cannot
   * receive new messages.
   */
  abandonSubchat(subchatId: string): void {
    const subchat = this.subchats.get(subchatId)
    if (!subchat) {
      throw new Error(`Subchat not found: ${subchatId}`)
    }
    if (subchat.status !== 'active') {
      return // Idempotent
    }

    subchat.status = 'abandoned'
    subchat.updatedAt = Date.now()

    // Clear active index if this was the active subchat
    if (this.activeSubchatIndex.get(subchat.parentChatId) === subchatId) {
      this.activeSubchatIndex.delete(subchat.parentChatId)
    }

    agentEventBus.emit('subchat:abandoned', {
      subchatId,
      parentChatId: subchat.parentChatId,
      messageCount: subchat.messages.length,
    })
  }

  // ── Context Extraction ────────────────────────────────────────────────────

  /**
   * Extract a compact text representation of a subchat's messages, suitable
   * for injecting as context into the parent chat or another LLM call.
   *
   * The output is a formatted string with role labels and message content,
   * trimmed to fit within an approximate token budget.  Older messages are
   * truncated first (FIFO eviction).
   *
   * @param subchatId  The subchat to extract context from
   * @param maxTokens  Approximate maximum number of tokens (default: 4000)
   * @returns A formatted string containing the subchat context, or empty
   *          string if the subchat doesn't exist or has no messages
   */
  getSubchatContext(subchatId: string, maxTokens: number = DEFAULT_MAX_TOKENS): string {
    const subchat = this.subchats.get(subchatId)
    if (!subchat || subchat.messages.length === 0) return ''

    const maxChars = maxTokens * CHARS_PER_TOKEN

    // Build lines from newest to oldest, then reverse for chronological order
    const lines: string[] = []
    let totalChars = 0

    for (let i = subchat.messages.length - 1; i >= 0; i--) {
      const msg = subchat.messages[i]!
      const line = `[${msg.role}]: ${msg.content}`
      if (totalChars + line.length + 1 > maxChars) {
        // This message would exceed budget — truncate from the beginning
        const remaining = maxChars - totalChars
        if (remaining > 50) {
          const truncated = line.slice(0, remaining - 1) + '…'
          lines.unshift(truncated)
        }
        break
      }
      lines.unshift(line)
      totalChars += line.length + 1
    }

    if (lines.length === 0) return ''

    const header = `--- Subchat: "${subchat.title}" (branched from message #${subchat.parentMessageIndex}, status: ${subchat.status}) ---`
    const footer = `--- End of subchat context (${subchat.messages.length} messages, ${lines.length} included) ---`

    return `${header}\n${lines.join('\n')}\n${footer}`
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Reset the manager state entirely.
   *
   * WARNING: This destroys all tracked subchats.  Use only for testing or
   * when you are certain no references remain.
   */
  reset(): void {
    this.subchats.clear()
    this.parentIndex.clear()
    this.activeSubchatIndex.clear()
    _idCounter = 0
  }

  // ── Diagnostics ───────────────────────────────────────────────────────────

  /**
   * Get the total number of tracked subchats.
   */
  get size(): number {
    return this.subchats.size
  }

  /**
   * Get the number of subchats for a given parent chat.
   */
  subchatCount(parentChatId: string): number {
    return this.parentIndex.get(parentChatId)?.size ?? 0
  }

  /**
   * Get aggregated stats across all subchats.
   */
  getStats(): {
    totalSubchats: number
    activeSubchats: number
    resolvedSubchats: number
    abandonedSubchats: number
    totalMessages: number
    parentChats: number
  } {
    let activeSubchats = 0
    let resolvedSubchats = 0
    let abandonedSubchats = 0
    let totalMessages = 0

    for (const subchat of this.subchats.values()) {
      switch (subchat.status) {
        case 'active':
          activeSubchats++
          break
        case 'resolved':
          resolvedSubchats++
          break
        case 'abandoned':
          abandonedSubchats++
          break
      }
      totalMessages += subchat.messages.length
    }

    return {
      totalSubchats: this.subchats.size,
      activeSubchats,
      resolvedSubchats,
      abandonedSubchats,
      totalMessages,
      parentChats: this.parentIndex.size,
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const subchatManager = new SubchatManager()
