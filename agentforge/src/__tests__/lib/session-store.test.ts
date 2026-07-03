/**
 * Unit tests for Session Store (JSONL session tree with branching & merging)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SessionStore, SessionMessage, SessionBranch } from '@/lib/session-store'
import { promises as fs } from 'fs'
import path from 'path'

describe('SessionStore', () => {
  let store: SessionStore
  const testSessionsDir = path.resolve(process.cwd(), 'sessions')

  beforeEach(() => {
    store = new SessionStore()
  })

  afterEach(async () => {
    // Clean up test sessions
    try {
      await fs.rm(testSessionsDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('createSession', () => {
    it('should create a new session with a main branch', async () => {
      const metadata = await store.createSession({
        title: 'Test Session',
        model: 'glm-4-flash',
      })

      expect(metadata.id).toBeDefined()
      expect(metadata.title).toBe('Test Session')
      expect(metadata.model).toBe('glm-4-flash')
      expect(metadata.mainBranchId).toBeDefined()
      expect(metadata.activeBranchId).toBe(metadata.mainBranchId)
      expect(metadata.totalBranches).toBe(1)
      expect(metadata.totalMessages).toBe(0)
    })

    it('should create session with project ID', async () => {
      const metadata = await store.createSession({
        projectId: 'proj-123',
      })

      expect(metadata.projectId).toBe('proj-123')
    })
  })

  describe('loadSession', () => {
    it('should load a previously created session', async () => {
      const created = await store.createSession({ title: 'Load Test' })
      const loaded = await store.loadSession(created.id)

      expect(loaded.metadata.id).toBe(created.id)
      expect(loaded.metadata.title).toBe('Load Test')
    })

    it('should throw for non-existent sessions', async () => {
      await expect(store.loadSession('non-existent-id')).rejects.toThrow('Session not found')
    })

    it('should use cache on subsequent loads', async () => {
      const created = await store.createSession({ title: 'Cache Test' })

      // First load reads from disk
      const first = await store.loadSession(created.id)
      // Second load should use cache
      const second = await store.loadSession(created.id)

      expect(first.metadata.id).toBe(second.metadata.id)
    })
  })

  describe('appendMessage', () => {
    it('should append a message to the active branch', async () => {
      const session = await store.createSession({ title: 'Message Test' })

      const msg = await store.appendMessage(session.id, {
        role: 'user',
        content: 'Hello, world!',
      })

      expect(msg.id).toBeDefined()
      expect(msg.role).toBe('user')
      expect(msg.content).toBe('Hello, world!')
      expect(msg.branchId).toBe(session.activeBranchId)
      expect(msg.timestamp).toBeGreaterThan(0)
    })

    it('should append multiple messages in order', async () => {
      const session = await store.createSession()

      await store.appendMessage(session.id, { role: 'user', content: 'First' })
      await store.appendMessage(session.id, { role: 'assistant', content: 'Second' })

      const messages = await store.getMessages(session.id)
      expect(messages).toHaveLength(2)
      expect(messages[0].role).toBe('user')
      expect(messages[1].role).toBe('assistant')
      expect(messages[1].parentId).toBe(messages[0].id)
    })

    it('should update session metadata', async () => {
      const session = await store.createSession()

      await store.appendMessage(session.id, { role: 'user', content: 'Test' })

      const loaded = await store.loadSession(session.id)
      expect(loaded.metadata.totalMessages).toBe(1)
    })
  })

  describe('getMessages', () => {
    it('should return messages for the active branch', async () => {
      const session = await store.createSession()
      await store.appendMessage(session.id, { role: 'user', content: 'Msg 1' })
      await store.appendMessage(session.id, { role: 'assistant', content: 'Msg 2' })

      const messages = await store.getMessages(session.id)
      expect(messages).toHaveLength(2)
    })

    it('should return empty array for new sessions', async () => {
      const session = await store.createSession()
      const messages = await store.getMessages(session.id)
      expect(messages).toHaveLength(0)
    })
  })

  describe('createBranch', () => {
    it('should create a branch from a specific message', async () => {
      const session = await store.createSession()
      await store.appendMessage(session.id, { role: 'user', content: 'Message 1' })
      const msg2 = await store.appendMessage(session.id, { role: 'assistant', content: 'Message 2' })
      await store.appendMessage(session.id, { role: 'user', content: 'Message 3' })

      const branch = await store.createBranch(session.id, msg2.id, 'alternative')

      expect(branch.name).toBe('alternative')
      expect(branch.parentId).toBe(session.mainBranchId)
      expect(branch.parentMessageId).toBe(msg2.id)

      // Branch should have messages up to the fork point
      const branchMessages = await store.getMessages(session.id, branch.id)
      expect(branchMessages).toHaveLength(2) // Message 1 + Message 2
    })

    it('should switch active branch to the new branch', async () => {
      const session = await store.createSession()
      const msg = await store.appendMessage(session.id, { role: 'user', content: 'Start' })

      const branch = await store.createBranch(session.id, msg.id)

      const loaded = await store.loadSession(session.id)
      expect(loaded.metadata.activeBranchId).toBe(branch.id)
    })

    it('should allow independent message flow on the branch', async () => {
      const session = await store.createSession()
      const msg = await store.appendMessage(session.id, { role: 'user', content: 'Start' })

      const branch = await store.createBranch(session.id, msg.id, 'branch-1')

      // Add message on branch
      await store.appendMessage(session.id, { role: 'user', content: 'Branch message' }, branch.id)

      const branchMessages = await store.getMessages(session.id, branch.id)
      expect(branchMessages).toHaveLength(2)

      // Main branch should still have 1 message
      const mainMessages = await store.getMessages(session.id, session.mainBranchId)
      expect(mainMessages).toHaveLength(1)
    })
  })

  describe('switchBranch', () => {
    it('should switch the active branch', async () => {
      const session = await store.createSession()
      const msg = await store.appendMessage(session.id, { role: 'user', content: 'Start' })
      const branch = await store.createBranch(session.id, msg.id)

      // Switch back to main
      await store.switchBranch(session.id, session.mainBranchId)

      const loaded = await store.loadSession(session.id)
      expect(loaded.metadata.activeBranchId).toBe(session.mainBranchId)
    })

    it('should throw for unknown branches', async () => {
      const session = await store.createSession()
      await expect(store.switchBranch(session.id, 'nonexistent')).rejects.toThrow()
    })
  })

  describe('mergeBranch', () => {
    it('should merge a branch into the active branch', async () => {
      const session = await store.createSession()
      const msg = await store.appendMessage(session.id, { role: 'user', content: 'Start' })
      const branch = await store.createBranch(session.id, msg.id, 'feature')

      // Add messages on the branch
      await store.appendMessage(session.id, { role: 'user', content: 'Feature message 1' }, branch.id)
      await store.appendMessage(session.id, { role: 'assistant', content: 'Feature response' }, branch.id)

      // Switch to main and merge
      await store.switchBranch(session.id, session.mainBranchId)
      const result = await store.mergeBranch(session.id, branch.id)

      expect(result.mergedCount).toBe(2)
      expect(result.conflicts).toHaveLength(0)

      // Main branch should now have merged messages
      const mainMessages = await store.getMessages(session.id, session.mainBranchId)
      expect(mainMessages.length).toBe(3) // Start + 2 merged
    })
  })

  describe('checkpoints', () => {
    it('should create a checkpoint', async () => {
      const session = await store.createSession()
      await store.appendMessage(session.id, { role: 'user', content: 'Msg 1' })
      await store.appendMessage(session.id, { role: 'assistant', content: 'Msg 2' })

      const checkpoint = await store.createCheckpoint(session.id, 'before-experiment')

      expect(checkpoint.id).toBeDefined()
      expect(checkpoint.label).toBe('before-experiment')
      expect(checkpoint.messageCount).toBe(2)
    })

    it('should restore from a checkpoint', async () => {
      const session = await store.createSession()
      await store.appendMessage(session.id, { role: 'user', content: 'Msg 1' })
      await store.appendMessage(session.id, { role: 'assistant', content: 'Msg 2' })

      const checkpoint = await store.createCheckpoint(session.id, 'checkpoint-1')

      // Add more messages
      await store.appendMessage(session.id, { role: 'user', content: 'Msg 3' })
      await store.appendMessage(session.id, { role: 'assistant', content: 'Msg 4' })

      // Restore checkpoint
      const restoredBranch = await store.restoreCheckpoint(session.id, checkpoint.id)

      const restoredMessages = await store.getMessages(session.id, restoredBranch.id)
      expect(restoredMessages).toHaveLength(2) // Only messages at checkpoint time
    })

    it('should list checkpoints', async () => {
      const session = await store.createSession()
      await store.appendMessage(session.id, { role: 'user', content: 'Msg 1' })

      await store.createCheckpoint(session.id, 'cp-1')
      await store.createCheckpoint(session.id, 'cp-2')

      const checkpoints = await store.listCheckpoints(session.id)
      expect(checkpoints).toHaveLength(2)
    })
  })

  describe('export/import', () => {
    it('should export and import a session', async () => {
      const session = await store.createSession({ title: 'Export Test' })
      await store.appendMessage(session.id, { role: 'user', content: 'Hello' })
      await store.appendMessage(session.id, { role: 'assistant', content: 'World' })

      const exported = await store.exportSession(session.id)

      // Delete the original
      await store.deleteSession(session.id)
      store.invalidateCache(session.id)

      // Import it back
      const imported = await store.importSession(exported as Record<string, unknown>)

      expect(imported.id).toBe(session.id)
      expect(imported.title).toBe('Export Test')
      expect(imported.totalMessages).toBe(2)

      const messages = await store.getMessages(session.id)
      expect(messages).toHaveLength(2)
    })
  })

  describe('deleteSession', () => {
    it('should delete a session and its files', async () => {
      const session = await store.createSession({ title: 'Delete Me' })
      await store.appendMessage(session.id, { role: 'user', content: 'Data' })

      await store.deleteSession(session.id)

      await expect(store.loadSession(session.id)).rejects.toThrow('Session not found')
    })
  })
})
