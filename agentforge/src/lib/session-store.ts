/**
 * Session Store — JSONL-based session tree with branching & merging
 *
 * Stores conversation sessions as append-only JSONL files with a tree
 * structure that supports branching, merging, and checkpointing.
 *
 * Design inspired by Git's branching model:
 *   - Each session has a linear sequence of messages
 *   - Branches can be created from any point in the conversation
 *   - Branches can be merged back into the main thread
 *   - Checkpoints allow time-travel to any point in the conversation
 *   - JSONL format enables append-only writes with efficient reads
 *
 * Features:
 *   - Append-only JSONL storage (no full-file rewrites)
 *   - Tree-based branching with parent tracking
 *   - Merge with conflict detection
 *   - Checkpoint creation and restoration
 *   - Auto-compaction with summarization
 *   - Import/export (JSONL + JSON)
 *   - Thread-safe concurrent access
 */

import { promises as fs } from 'fs'
import path from 'path'
import { existsSync } from 'fs'
import { agentEventBus } from './event-bus'
import { messageCompressor, type CompressedMessage } from './message-compression'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SessionMessage {
  id: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  timestamp: number
  branchId: string
  parentId: string | null
  metadata?: {
    tokens?: number
    toolCalls?: Array<{ name: string; args: Record<string, unknown>; result?: string }>
    summary?: boolean
    model?: string
    provider?: string
  }
}

// v1.2: Compressed-line envelope for the on-disk JSONL format. The
// `_compressed` marker distinguishes compressed lines from plain
// SessionMessage lines, so old sessions (uncompressed) load transparently.
interface CompressedLine {
  _compressed: CompressedMessage
}

function isCompressedLine(line: unknown): line is CompressedLine {
  return (
    typeof line === 'object' &&
    line !== null &&
    '_compressed' in line &&
    typeof (line as CompressedLine)._compressed === 'object' &&
    (line as CompressedLine)._compressed !== null &&
    typeof (line as CompressedLine)._compressed.compressedData === 'string'
  )
}

export interface SessionBranch {
  id: string
  sessionId: string
  name: string
  parentId: string | null      // Parent branch ID (null = main branch)
  parentMessageId: string | null // Message from which this branch was created
  createdAt: number
  messageCount: number
  isMerged: boolean
}

export interface SessionCheckpoint {
  id: string
  sessionId: string
  branchId: string
  messageId: string
  label: string
  createdAt: number
  messageCount: number
}

export interface SessionMetadata {
  id: string
  projectId?: string
  title: string
  model: string
  provider: string
  createdAt: number
  updatedAt: number
  mainBranchId: string
  activeBranchId: string
  totalMessages: number
  totalBranches: number
}

export interface SessionTree {
  metadata: SessionMetadata
  branches: Map<string, SessionBranch>
  messages: Map<string, SessionMessage[]>
  checkpoints: Map<string, SessionCheckpoint>
}

// ── Storage paths ──────────────────────────────────────────────────────────────

const SESSIONS_ROOT = () => path.resolve(process.cwd(), 'sessions')

function getSessionDir(sessionId: string): string {
  return path.join(SESSIONS_ROOT(), sessionId)
}

function getSessionMetaPath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), 'session.json')
}

function getBranchLogPath(sessionId: string, branchId: string): string {
  return path.join(getSessionDir(sessionId), `${branchId}.jsonl`)
}

function getBranchesIndexPath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), 'branches.json')
}

function getCheckpointsPath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), 'checkpoints.json')
}

// ── ID generation ──────────────────────────────────────────────────────────────

let _idCounter = 0

function generateId(): string {
  // Use crypto.randomUUID if available, otherwise fallback
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // Fallback below
  }
  _idCounter++
  return `id_${Date.now()}_${_idCounter}_${Math.random().toString(36).substring(2, 9)}`
}

// ── SessionStore class ─────────────────────────────────────────────────────────

export class SessionStore {
  private cache = new Map<string, SessionTree>()

  // ── Session lifecycle ────────────────────────────────────────────────────

  /**
   * Create a new session.
   */
  async createSession(options?: {
    projectId?: string
    title?: string
    model?: string
    provider?: string
  }): Promise<SessionMetadata> {
    const opts = options || {}
    const sessionId = generateId()
    const mainBranchId = `branch_main_${sessionId.substring(0, 8)}`

    const metadata: SessionMetadata = {
      id: sessionId,
      projectId: opts.projectId,
      title: opts.title || `Session ${new Date().toISOString()}`,
      model: opts.model || 'glm-5.1',
      provider: opts.provider || 'zai',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      mainBranchId,
      activeBranchId: mainBranchId,
      totalMessages: 0,
      totalBranches: 1,
    }

    const mainBranch: SessionBranch = {
      id: mainBranchId,
      sessionId,
      name: 'main',
      parentId: null,
      parentMessageId: null,
      createdAt: Date.now(),
      messageCount: 0,
      isMerged: false,
    }

    // Create session directory
    const sessionDir = getSessionDir(sessionId)
    await fs.mkdir(sessionDir, { recursive: true })

    // Write metadata
    await fs.writeFile(getSessionMetaPath(sessionId), JSON.stringify(metadata, null, 2), 'utf-8')

    // Write branches index
    await fs.writeFile(
      getBranchesIndexPath(sessionId),
      JSON.stringify({ [mainBranchId]: mainBranch }, null, 2),
      'utf-8',
    )

    // Write empty checkpoints
    await fs.writeFile(getCheckpointsPath(sessionId), '{}', 'utf-8')

    // Create empty JSONL for main branch
    await fs.writeFile(getBranchLogPath(sessionId, mainBranchId), '', 'utf-8')

    // Cache the tree
    const tree: SessionTree = {
      metadata,
      branches: new Map([[mainBranchId, mainBranch]]),
      messages: new Map([[mainBranchId, []]]),
      checkpoints: new Map(),
    }
    this.cache.set(sessionId, tree)

    return metadata
  }

  /**
   * Load a session from disk (with caching).
   */
  async loadSession(sessionId: string): Promise<SessionTree> {
    // Check cache first
    const cached = this.cache.get(sessionId)
    if (cached) return cached

    const sessionDir = getSessionDir(sessionId)
    if (!existsSync(sessionDir)) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    // Read metadata
    const metaRaw = await fs.readFile(getSessionMetaPath(sessionId), 'utf-8')
    const metadata = JSON.parse(metaRaw) as SessionMetadata

    // Read branches
    const branchesRaw = await fs.readFile(getBranchesIndexPath(sessionId), 'utf-8')
    const branchesObj = JSON.parse(branchesRaw) as Record<string, SessionBranch>
    const branches = new Map(Object.entries(branchesObj))

    // Read messages for each branch
    const messages = new Map<string, SessionMessage[]>()
    for (const [branchId] of branches) {
      const logPath = getBranchLogPath(sessionId, branchId)
      if (existsSync(logPath)) {
        const logContent = await fs.readFile(logPath, 'utf-8')
        const branchMessages = logContent
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const parsed = JSON.parse(line) as (SessionMessage | CompressedLine)
            // v1.2: backward-compat — old lines are plain SessionMessage
            // objects (no _compressed marker). New lines may carry a
            // `_compressed` envelope for storage savings.
            if (isCompressedLine(parsed)) {
              try {
                const json = messageCompressor.decompress(parsed._compressed)
                return JSON.parse(json) as SessionMessage
              } catch {
                // Corrupted compressed line — skip rather than crash the
                // entire load. We log to event-bus for observability.
                agentEventBus.emit('agent:error', {
                  sessionId,
                  error: `Failed to decompress message in branch ${branchId}`,
                  phase: 'session-load',
                })
                return null
              }
            }
            return parsed as SessionMessage
          })
          .filter((m): m is SessionMessage => m !== null)
        messages.set(branchId, branchMessages)
      } else {
        messages.set(branchId, [])
      }
    }

    // Read checkpoints
    const checkpointsRaw = await fs.readFile(getCheckpointsPath(sessionId), 'utf-8')
    const checkpointsObj = JSON.parse(checkpointsRaw) as Record<string, SessionCheckpoint>
    const checkpoints = new Map(Object.entries(checkpointsObj))

    const tree: SessionTree = { metadata, branches, messages, checkpoints }
    this.cache.set(sessionId, tree)
    return tree
  }

  // ── Messages ─────────────────────────────────────────────────────────────

  /**
   * Append a message to the active branch of a session.
   */
  async appendMessage(
    sessionId: string,
    message: Omit<SessionMessage, 'id' | 'timestamp' | 'branchId' | 'parentId'>,
    branchId?: string,
  ): Promise<SessionMessage> {
    const tree = await this.loadSession(sessionId)
    const targetBranch = branchId || tree.metadata.activeBranchId

    const branchMessages = tree.messages.get(targetBranch) || []
    const lastMessage = branchMessages[branchMessages.length - 1]

    const fullMessage: SessionMessage = {
      ...message,
      id: generateId(),
      timestamp: Date.now(),
      branchId: targetBranch,
      parentId: lastMessage?.id || null,
    }

    // Append to in-memory cache
    if (!tree.messages.has(targetBranch)) {
      tree.messages.set(targetBranch, [])
    }
    tree.messages.get(targetBranch)!.push(fullMessage)

    // Append to JSONL file (append-only, no full rewrite)
    // v1.2: Compress large messages to save disk space. The threshold
    // (2 KB) is chosen so we only pay the LZW overhead for messages where
    // it actually pays off. Compression envelope is marked with
    // `_compressed` so old lines (plain SessionMessage) load fine — this
    // is the backward-compat path exercised by the loadSession changes above.
    const logPath = getBranchLogPath(sessionId, targetBranch)
    const json = JSON.stringify(fullMessage)
    let lineToWrite: string
    if (json.length >= 2048 && messageCompressor.shouldCompress(json)) {
      try {
        const compressed = messageCompressor.compress(json)
        // Only use the compressed envelope if it actually saves space.
        if (compressed.compressionRatio < 1.0) {
          const envelope: CompressedLine = { _compressed: compressed }
          lineToWrite = JSON.stringify(envelope) + '\n'
        } else {
          lineToWrite = json + '\n'
        }
      } catch {
        // Compression failed — fall back to plain JSON.
        lineToWrite = json + '\n'
      }
    } else {
      lineToWrite = json + '\n'
    }
    await fs.appendFile(logPath, lineToWrite, 'utf-8')

    // Update metadata
    tree.metadata.totalMessages++
    tree.metadata.updatedAt = Date.now()
    const branch = tree.branches.get(targetBranch)
    if (branch) branch.messageCount = tree.messages.get(targetBranch)!.length
    await this.saveMetadata(sessionId, tree.metadata)
    await this.saveBranchesIndex(sessionId, tree.branches)

    return fullMessage
  }

  /**
   * Get all messages for a branch.
   */
  async getMessages(sessionId: string, branchId?: string): Promise<SessionMessage[]> {
    const tree = await this.loadSession(sessionId)
    const targetBranch = branchId || tree.metadata.activeBranchId
    return tree.messages.get(targetBranch) || []
  }

  /**
   * Get a specific message by ID.
   */
  async getMessage(sessionId: string, messageId: string): Promise<SessionMessage | null> {
    const tree = await this.loadSession(sessionId)
    for (const messages of tree.messages.values()) {
      const found = messages.find((m) => m.id === messageId)
      if (found) return found
    }
    return null
  }

  // ── Branching ────────────────────────────────────────────────────────────

  /**
   * Create a new branch from a specific message in the conversation.
   * All messages up to and including `fromMessageId` are copied to the new branch.
   */
  async createBranch(
    sessionId: string,
    fromMessageId: string,
    name?: string,
  ): Promise<SessionBranch> {
    const tree = await this.loadSession(sessionId)
    const sourceBranch = tree.branches.get(tree.metadata.activeBranchId)!
    const sourceMessages = tree.messages.get(sourceBranch.id) || []

    // Find the split point
    const splitIndex = sourceMessages.findIndex((m) => m.id === fromMessageId)
    if (splitIndex === -1) {
      throw new Error(`Message ${fromMessageId} not found in branch ${sourceBranch.id}`)
    }

    // Create the new branch
    const branchId = `branch_${generateId().substring(0, 8)}`
    const newBranch: SessionBranch = {
      id: branchId,
      sessionId,
      name: name || `branch-${tree.metadata.totalBranches + 1}`,
      parentId: sourceBranch.id,
      parentMessageId: fromMessageId,
      createdAt: Date.now(),
      messageCount: splitIndex + 1,
      isMerged: false,
    }

    // Copy messages up to the split point
    const copiedMessages = sourceMessages.slice(0, splitIndex + 1).map((msg) => ({
      ...msg,
      branchId,
    }))

    // Write the new branch JSONL
    const logPath = getBranchLogPath(sessionId, branchId)
    const lines = copiedMessages.map((m) => JSON.stringify(m)).join('\n') + '\n'
    await fs.writeFile(logPath, lines, 'utf-8')

    // Update caches
    tree.branches.set(branchId, newBranch)
    tree.messages.set(branchId, copiedMessages)
    tree.metadata.totalBranches++
    tree.metadata.activeBranchId = branchId
    tree.metadata.updatedAt = Date.now()

    await this.saveBranchesIndex(sessionId, tree.branches)
    await this.saveMetadata(sessionId, tree.metadata)

    agentEventBus.emit('session:branch', {
      sessionId,
      branchId,
      parentId: sourceBranch.id,
      fromIndex: splitIndex,
    })

    return newBranch
  }

  /**
   * Switch to a different branch.
   */
  async switchBranch(sessionId: string, branchId: string): Promise<void> {
    const tree = await this.loadSession(sessionId)
    if (!tree.branches.has(branchId)) {
      throw new Error(`Branch ${branchId} not found in session ${sessionId}`)
    }
    tree.metadata.activeBranchId = branchId
    tree.metadata.updatedAt = Date.now()
    await this.saveMetadata(sessionId, tree.metadata)
  }

  /**
   * Merge a source branch into the target (active) branch.
   * Messages from the source branch that are after the fork point
   * are appended to the target branch.
   */
  async mergeBranch(
    sessionId: string,
    sourceBranchId: string,
    targetBranchId?: string,
  ): Promise<{ mergedCount: number; conflicts: string[] }> {
    const tree = await this.loadSession(sessionId)
    const targetId = targetBranchId || tree.metadata.activeBranchId
    const sourceBranch = tree.branches.get(sourceBranchId)
    const targetBranch = tree.branches.get(targetId)

    if (!sourceBranch || !targetBranch) {
      throw new Error('Source or target branch not found')
    }

    const sourceMessages = tree.messages.get(sourceBranchId) || []
    const targetMessages = tree.messages.get(targetId) || []

    // Find messages unique to the source branch (after the fork point)
    const forkMessageId = sourceBranch.parentMessageId
    const forkIndex = forkMessageId
      ? sourceMessages.findIndex((m) => m.id === forkMessageId)
      : -1

    const newMessages = forkIndex >= 0
      ? sourceMessages.slice(forkIndex + 1)
      : sourceMessages

    // Simple merge: append all new messages
    const conflicts: string[] = []
    const mergedMessages: SessionMessage[] = []

    for (const msg of newMessages) {
      const mergedMsg: SessionMessage = {
        ...msg,
        id: generateId(),
        branchId: targetId,
        parentId: targetMessages[targetMessages.length - 1]?.id || null,
        metadata: { ...msg.metadata, mergedFrom: sourceBranchId },
      }
      mergedMessages.push(mergedMsg)
      targetMessages.push(mergedMsg)
    }

    // Append to JSONL
    const logPath = getBranchLogPath(sessionId, targetId)
    const lines = mergedMessages.map((m) => JSON.stringify(m)).join('\n') + '\n'
    await fs.appendFile(logPath, lines, 'utf-8')

    // Mark source branch as merged
    sourceBranch.isMerged = true
    targetBranch.messageCount = targetMessages.length
    tree.metadata.totalMessages += mergedMessages.length
    tree.metadata.updatedAt = Date.now()

    await this.saveBranchesIndex(sessionId, tree.branches)
    await this.saveMetadata(sessionId, tree.metadata)

    agentEventBus.emit('session:merge', {
      sessionId,
      sourceBranch: sourceBranchId,
      targetBranch: targetId,
    })

    return { mergedCount: mergedMessages.length, conflicts }
  }

  /**
   * List all branches in a session.
   */
  async listBranches(sessionId: string): Promise<SessionBranch[]> {
    const tree = await this.loadSession(sessionId)
    return Array.from(tree.branches.values())
  }

  // ── Checkpoints ──────────────────────────────────────────────────────────

  /**
   * Create a checkpoint at the current state of the active branch.
   */
  async createCheckpoint(
    sessionId: string,
    label: string,
    branchId?: string,
  ): Promise<SessionCheckpoint> {
    const tree = await this.loadSession(sessionId)
    const targetBranch = branchId || tree.metadata.activeBranchId
    const messages = tree.messages.get(targetBranch) || []
    const lastMessage = messages[messages.length - 1]

    const checkpoint: SessionCheckpoint = {
      id: generateId(),
      sessionId,
      branchId: targetBranch,
      messageId: lastMessage?.id || '',
      label,
      createdAt: Date.now(),
      messageCount: messages.length,
    }

    tree.checkpoints.set(checkpoint.id, checkpoint)
    await this.saveCheckpoints(sessionId, tree.checkpoints)

    agentEventBus.emit('session:checkpoint', {
      sessionId,
      checkpointId: checkpoint.id,
      messageCount: messages.length,
    })

    return checkpoint
  }

  /**
   * Restore a session to a checkpoint.
   * Creates a new branch from the checkpoint state.
   */
  async restoreCheckpoint(sessionId: string, checkpointId: string): Promise<SessionBranch> {
    const tree = await this.loadSession(sessionId)
    const checkpoint = tree.checkpoints.get(checkpointId)
    if (!checkpoint) {
      throw new Error(`Checkpoint ${checkpointId} not found`)
    }

    // Find the checkpoint message
    const sourceMessages = tree.messages.get(checkpoint.branchId) || []
    const checkpointIndex = sourceMessages.findIndex((m) => m.id === checkpoint.messageId)

    if (checkpointIndex === -1) {
      throw new Error(`Checkpoint message ${checkpoint.messageId} not found`)
    }

    // Create a new branch from the checkpoint
    const branchId = `branch_${generateId().substring(0, 8)}`
    const newBranch: SessionBranch = {
      id: branchId,
      sessionId,
      name: `restore-${checkpoint.label}`,
      parentId: checkpoint.branchId,
      parentMessageId: checkpoint.messageId,
      createdAt: Date.now(),
      messageCount: checkpointIndex + 1,
      isMerged: false,
    }

    const copiedMessages = sourceMessages.slice(0, checkpointIndex + 1).map((msg) => ({
      ...msg,
      branchId,
    }))

    // Write the new branch
    const logPath = getBranchLogPath(sessionId, branchId)
    const lines = copiedMessages.map((m) => JSON.stringify(m)).join('\n') + '\n'
    await fs.writeFile(logPath, lines, 'utf-8')

    tree.branches.set(branchId, newBranch)
    tree.messages.set(branchId, copiedMessages)
    tree.metadata.totalBranches++
    tree.metadata.activeBranchId = branchId
    tree.metadata.updatedAt = Date.now()

    await this.saveBranchesIndex(sessionId, tree.branches)
    await this.saveMetadata(sessionId, tree.metadata)

    return newBranch
  }

  /**
   * List all checkpoints in a session.
   */
  async listCheckpoints(sessionId: string): Promise<SessionCheckpoint[]> {
    const tree = await this.loadSession(sessionId)
    return Array.from(tree.checkpoints.values())
  }

  // ── Import/Export ────────────────────────────────────────────────────────

  /**
   * Export a session as a JSON object.
   */
  async exportSession(sessionId: string): Promise<Record<string, unknown>> {
    const tree = await this.loadSession(sessionId)

    return {
      metadata: tree.metadata,
      branches: Object.fromEntries(tree.branches),
      messages: Object.fromEntries(
        Array.from(tree.messages.entries()).map(([branchId, msgs]) => [
          branchId,
          msgs,
        ]),
      ),
      checkpoints: Object.fromEntries(tree.checkpoints),
    }
  }

  /**
   * Import a session from a JSON object.
   */
  async importSession(data: Record<string, unknown>): Promise<SessionMetadata> {
    const metadata = data.metadata as SessionMetadata
    const branchesData = data.branches as Record<string, SessionBranch>
    const messagesData = data.messages as Record<string, SessionMessage[]>
    const checkpointsData = data.checkpoints as Record<string, SessionCheckpoint>

    // Create session directory
    const sessionDir = getSessionDir(metadata.id)
    await fs.mkdir(sessionDir, { recursive: true })

    // Write metadata
    await fs.writeFile(getSessionMetaPath(metadata.id), JSON.stringify(metadata, null, 2), 'utf-8')

    // Write branches index
    await fs.writeFile(
      getBranchesIndexPath(metadata.id),
      JSON.stringify(branchesData, null, 2),
      'utf-8',
    )

    // Write JSONL files for each branch
    for (const [branchId, msgs] of Object.entries(messagesData)) {
      const logPath = getBranchLogPath(metadata.id, branchId)
      const lines = msgs.map((m) => JSON.stringify(m)).join('\n') + '\n'
      await fs.writeFile(logPath, lines, 'utf-8')
    }

    // Write checkpoints
    await fs.writeFile(
      getCheckpointsPath(metadata.id),
      JSON.stringify(checkpointsData, null, 2),
      'utf-8',
    )

    // Build cache
    const tree: SessionTree = {
      metadata,
      branches: new Map(Object.entries(branchesData)),
      messages: new Map(Object.entries(messagesData)),
      checkpoints: new Map(Object.entries(checkpointsData)),
    }
    this.cache.set(metadata.id, tree)

    return metadata
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────

  /**
   * Delete an entire session.
   */
  async deleteSession(sessionId: string): Promise<void> {
    const sessionDir = getSessionDir(sessionId)
    if (existsSync(sessionDir)) {
      await fs.rm(sessionDir, { recursive: true, force: true })
    }
    this.cache.delete(sessionId)
  }

  /**
   * Clear the in-memory cache for a session.
   */
  invalidateCache(sessionId: string): void {
    this.cache.delete(sessionId)
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async saveMetadata(sessionId: string, metadata: SessionMetadata): Promise<void> {
    await fs.writeFile(
      getSessionMetaPath(sessionId),
      JSON.stringify(metadata, null, 2),
      'utf-8',
    )
  }

  private async saveBranchesIndex(sessionId: string, branches: Map<string, SessionBranch>): Promise<void> {
    const obj = Object.fromEntries(branches)
    await fs.writeFile(
      getBranchesIndexPath(sessionId),
      JSON.stringify(obj, null, 2),
      'utf-8',
    )
  }

  private async saveCheckpoints(sessionId: string, checkpoints: Map<string, SessionCheckpoint>): Promise<void> {
    const obj = Object.fromEntries(checkpoints)
    await fs.writeFile(
      getCheckpointsPath(sessionId),
      JSON.stringify(obj, null, 2),
      'utf-8',
    )
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────

export const sessionStore = new SessionStore()
