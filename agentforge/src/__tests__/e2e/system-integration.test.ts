/**
 * E2E / System Integration Tests
 *
 * Tests the integrated behavior of all 8 new subsystems working together:
 *   1. Context Window Management
 *   2. Session Branching
 *   3. Extension System
 *   4. Multi-Provider LLM
 *   5. Native Function Calling
 *   6. Parallel Tool Execution
 *   7. Diff-Based File Editing
 *   8. Typed Agent Event System
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventBus } from '@/lib/event-bus'
import { ContextManager, estimateTokens } from '@/lib/context-manager'
import { ExtensionSystem, ExtensionManifest, CustomToolDefinition } from '@/lib/extension-system'
import { SessionStore } from '@/lib/session-store'
import { LLMProviderRegistry, LLMProvider, ChatResponse } from '@/lib/llm-provider'
import {
  applyDiffOperations,
  parseInlineDiffs,
  DiffOperation,
  clearBackups,
} from '@/lib/diff-editor'
import {
  parseStructuredToolCalls,
  detectToolCalls,
  validateToolCall,
  formatToolResult,
  ToolSchema,
  StructuredToolCall,
} from '@/lib/function-calling'
import { promises as fs } from 'fs'
import path from 'path'

// ── System Integration Test ────────────────────────────────────────────────────

describe('System Integration: All 8 Subsystems', () => {
  let eventBus: EventBus
  let contextManager: ContextManager
  let extSystem: ExtensionSystem
  let sessionStore: SessionStore
  let llmRegistry: LLMProviderRegistry

  beforeEach(() => {
    eventBus = new EventBus(500)
    contextManager = new ContextManager({
      maxTokens: 2000,
      compactionThreshold: 0.75,
      minRetainedMessages: 4,
      useSummarization: false,
    })
    extSystem = new ExtensionSystem()
    sessionStore = new SessionStore()
    llmRegistry = new LLMProviderRegistry()
    clearBackups()
  })

  afterEach(async () => {
    eventBus.removeAllListeners()
    const sessions = path.resolve(process.cwd(), 'sessions')
    try {
      await fs.rm(sessions, { recursive: true, force: true })
    } catch {
      // ignore
    }
    clearBackups()
  })

  describe('Full Agent Lifecycle Integration', () => {
    it('should walk through a complete agent lifecycle with all subsystems', async () => {
      // ── Step 1: Create a session ──────────────────────────────────────

      const session = await sessionStore.createSession({
        projectId: 'test-project',
        title: 'Integration Test Session',
        model: 'glm-4-flash',
      })

      expect(session.id).toBeDefined()
      expect(session.totalBranches).toBe(1)

      // ── Step 2: Set up event tracking ─────────────────────────────────

      const events: Array<{ event: string; payload: unknown }> = []
      eventBus.onAny((event, payload) => {
        events.push({ event, payload })
      })

      // ── Step 3: Register an extension with a custom tool ──────────────

      const customToolHandler = vi.fn().mockResolvedValue({
        result: 'Custom tool processed the data',
        tokens: 42,
      })

      const customTool: CustomToolDefinition = {
        name: 'analyze_code',
        description: 'Analyze code quality',
        parameters: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'Code to analyze' },
            language: { type: 'string', description: 'Programming language' },
          },
          required: ['code'],
        },
        handler: customToolHandler,
      }

      const extension: ExtensionManifest = {
        id: 'code-analyzer',
        name: 'Code Analyzer Extension',
        version: '1.0.0',
        hooks: {
          beforeToolCall: (ctx) => {
            // Add metadata before tool calls
            return { ...ctx, _hookedAt: Date.now() }
          },
          afterChat: (ctx) => {
            return { ...ctx, _chatCompleted: true }
          },
        },
        tools: [customTool],
        eventSubscriptions: [
          {
            event: 'tool:call',
            handler: (payload: unknown) => {
              // Extension reacts to tool call events
            },
          },
        ],
        priority: 10,
      }

      extSystem.registerExtension(extension)
      expect(extSystem.isExtensionEnabled('code-analyzer')).toBe(true)
      expect(extSystem.isCustomTool('analyze_code')).toBe(true)

      // ── Step 4: Simulate the agent chat lifecycle ─────────────────────

      // Emit agent:start
      await eventBus.emit('agent:start', {
        sessionId: session.id,
        projectId: 'test-project',
        model: 'glm-4-flash',
      })

      // Add user message to session
      await sessionStore.appendMessage(session.id, {
        role: 'user',
        content: 'Build me a simple React counter component',
      })

      // ── Step 5: Context window management ─────────────────────────────

      // Simulate building a large context
      const messages = [
        { role: 'system' as const, content: 'You are an expert React developer.' },
        { role: 'user' as const, content: 'Build me a simple React counter component' },
      ]

      // Add many messages to trigger compaction
      for (let i = 0; i < 50; i++) {
        messages.push({
          role: 'assistant' as const,
          content: `Previous response ${i}: Here is some code with detailed explanations about how React works and various patterns. This is intentionally long to simulate real agent responses that would fill up the context window. The counter component should use useState for state management and handle increment and decrement operations.`,
        })
        messages.push({
          role: 'user' as const,
          content: `Follow-up question ${i}: Can you explain more about hooks?`,
        })
      }

      // Build the context window (should trigger compaction)
      const managed = await contextManager.buildContextWindow(
        messages,
        'glm-4-flash',
        session.id,
      )

      // The managed context should be smaller than the original
      const originalTokens = contextManager.countTokens(messages)
      const managedTokens = contextManager.countTokens(managed)
      expect(managedTokens).toBeLessThanOrEqual(originalTokens)

      // ── Step 6: Function calling with structured tool calls ───────────

      // Simulate LLM returning structured tool calls
      const structuredCalls: StructuredToolCall[] = [
        {
          id: 'call_write_counter',
          type: 'function',
          function: {
            name: 'write_file',
            arguments: '{"path": "Counter.tsx", "content": "import React, { useState } from \'react\';\\nexport default function Counter() {\\n  const [count, setCount] = useState(0);\\n  return <div><p>{count}</p><button onClick={() => setCount(c => c + 1)}>+</button></div>;\\n}"}',
          },
        },
        {
          id: 'call_read_file',
          type: 'function',
          function: {
            name: 'read_file',
            arguments: '{"path": "package.json"}',
          },
        },
      ]

      // Parse structured calls
      const toolCallRequests = parseStructuredToolCalls(structuredCalls)
      expect(toolCallRequests).toHaveLength(2)
      expect(toolCallRequests[0].toolName).toBe('write_file')
      expect(toolCallRequests[1].toolName).toBe('read_file')

      // Validate tool calls
      const schemas: ToolSchema[] = [
        {
          name: 'write_file',
          description: 'Write a file',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Path' },
              content: { type: 'string', description: 'Content' },
            },
            required: ['path', 'content'],
          },
        },
        {
          name: 'read_file',
          description: 'Read a file',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Path' },
            },
            required: ['path'],
          },
        },
      ]

      const validation1 = validateToolCall(toolCallRequests[0], schemas)
      expect(validation1.valid).toBe(true)

      const validation2 = validateToolCall(toolCallRequests[1], schemas)
      expect(validation2.valid).toBe(true)

      // ── Step 7: Diff-based file editing ───────────────────────────────

      const existingCode = `import React, { useState } from 'react'

export default function Counter() {
  const [count, setCount] = useState(0)
  return (
    <div>
      <p>{count}</p>
      <button onClick={() => setCount(c => c + 1)}>+</button>
    </div>
  )
}`

      // Apply a diff to add a decrement button
      const operations: DiffOperation[] = [
        {
          search: '<button onClick={() => setCount(c => c + 1)}>+</button>',
          replace: '<button onClick={() => setCount(c => c + 1)}>+</button>\n      <button onClick={() => setCount(c => c - 1)}>-</button>',
        },
        {
          search: '<p>{count}</p>',
          replace: '<p data-testid="counter">{count}</p>',
        },
      ]

      const diffResult = applyDiffOperations(existingCode, operations, 'Counter.tsx')
      expect(diffResult.success).toBe(true)
      expect(diffResult.operationsApplied).toBe(2)
      expect(diffResult.content).toContain('c => c - 1')
      expect(diffResult.content).toContain('data-testid="counter"')

      // ── Step 8: Session branching ─────────────────────────────────────

      // Add the assistant response to the session
      await sessionStore.appendMessage(session.id, {
        role: 'assistant',
        content: 'Here is your counter component with diff edits applied.',
      })

      // Create a branch to try a different approach
      const messages2 = await sessionStore.getMessages(session.id)
      const lastMsg = messages2[messages2.length - 1]

      const branch = await sessionStore.createBranch(
        session.id,
        lastMsg.id,
        'useReducer-approach',
      )

      expect(branch.name).toBe('useReducer-approach')
      expect(branch.parentId).toBe(session.mainBranchId)

      // Add a different message on the branch
      await sessionStore.appendMessage(session.id, {
        role: 'assistant',
        content: 'Using useReducer instead...',
      }, branch.id)

      // ── Step 9: Session checkpointing ─────────────────────────────────

      const checkpoint = await sessionStore.createCheckpoint(
        session.id,
        'before-refactor',
      )

      expect(checkpoint.label).toBe('before-refactor')

      // ── Step 10: Extension lifecycle ──────────────────────────────────

      // Execute extension hooks
      const hookResult = await extSystem.executeHooks('beforeToolCall', {
        sessionId: session.id,
        toolName: 'write_file',
        toolParams: { path: 'Counter.tsx' },
      })

      expect(hookResult._hookedAt).toBeDefined()

      // Execute custom tool
      const customResult = await extSystem.executeCustomTool('analyze_code', {
        code: existingCode,
        language: 'typescript',
      })

      expect(customResult.success).toBe(true)
      expect(customToolHandler).toHaveBeenCalledWith({
        code: existingCode,
        language: 'typescript',
      })

      // ── Step 11: LLM Provider Registry ────────────────────────────────

      // Register a mock provider
      const mockProvider: LLMProvider = {
        id: 'mock',
        name: 'Mock Provider',
        models: ['mock-model'],
        available: true,
        priority: 1,
        chat: vi.fn().mockResolvedValue({
          content: 'Mock response',
          model: 'mock-model',
          provider: 'mock',
          finishReason: 'stop',
          toolCalls: structuredCalls,
        } as ChatResponse),
        chatStream: vi.fn(),
      }

      llmRegistry.registerProvider(mockProvider)
      expect(llmRegistry.getProvider('mock')).toBeDefined()

      const providerForModel = llmRegistry.getProviderForModel('mock-model')
      expect(providerForModel).toBeDefined()
      expect(providerForModel!.id).toBe('mock')

      // ── Step 12: Verify event bus captured the full lifecycle ─────────

      await eventBus.emit('agent:complete', {
        sessionId: session.id,
        iterations: 3,
      })

      // Check that our events were captured
      const agentStartEvents = events.filter((e) => e.event === 'agent:start')
      const agentCompleteEvents = events.filter((e) => e.event === 'agent:complete')

      expect(agentStartEvents.length).toBeGreaterThan(0)
      expect(agentCompleteEvents.length).toBeGreaterThan(0)

      // ── Step 13: Export session and verify full state ─────────────────

      const exported = await sessionStore.exportSession(session.id)
      expect(exported.metadata).toBeDefined()
      expect(exported.branches).toBeDefined()
      expect(exported.messages).toBeDefined()
      expect(exported.checkpoints).toBeDefined()

      // Verify we can import it back
      await sessionStore.deleteSession(session.id)
      sessionStore.invalidateCache(session.id)

      const imported = await sessionStore.importSession(
        exported as Record<string, unknown>,
      )

      expect(imported.id).toBe(session.id)
    })
  })

  describe('Context Window + Event Bus Integration', () => {
    it('should emit compaction events during context management', async () => {
      const compactionEvents: unknown[] = []
      eventBus.on('context:compaction', (payload) => {
        compactionEvents.push(payload)
      })

      // Create enough messages to trigger compaction
      const messages = [
        { role: 'system' as const, content: 'System prompt' },
        ...Array.from({ length: 80 }, (_, i) => ({
          role: (i % 2 === 0 ? 'user' : 'assistant') as const,
          content: `Message ${i} with enough text to consume tokens. Each message needs some substantial content to trigger the compaction threshold when we have many messages in the conversation history.`,
        })),
      ]

      await contextManager.buildContextWindow(messages, 'glm-4-flash', 'test-session')

      // Should have emitted at least one compaction event
      expect(compactionEvents.length).toBeGreaterThan(0)
    })
  })

  describe('Diff Editing + Event Bus Integration', () => {
    it('should emit diff events when applying operations', async () => {
      const diffEvents: unknown[] = []
      eventBus.on('diff:apply', (payload) => {
        diffEvents.push(payload)
      })

      const content = 'const x = 1\nconst y = 2\n'
      applyDiffOperations(content, [
        { search: 'const x = 1', replace: 'const x = 42' },
      ], 'test.ts')

      expect(diffEvents.length).toBeGreaterThan(0)
    })
  })

  describe('Extension System + Event Bus Integration', () => {
    it('should emit extension events when hooks are invoked', async () => {
      const extEvents: unknown[] = []
      eventBus.on('extension:hook-invoked', (payload) => {
        extEvents.push(payload)
      })

      // Register extension with a hook
      extSystem.registerExtension({
        id: 'event-test',
        name: 'Event Test',
        version: '1.0.0',
        hooks: {
          beforeChat: (ctx) => ctx,
        },
      })

      await extSystem.executeHooks('beforeChat', { model: 'test' })

      expect(extEvents.length).toBeGreaterThan(0)
      expect((extEvents[0] as any).extensionId).toBe('event-test')
      expect((extEvents[0] as any).hook).toBe('beforeChat')
    })
  })

  describe('Session Branching + Event Bus Integration', () => {
    it('should emit branch events', async () => {
      const branchEvents: unknown[] = []
      eventBus.on('session:branch', (payload) => {
        branchEvents.push(payload)
      })

      const session = await sessionStore.createSession({ title: 'Branch Event Test' })
      const msg = await sessionStore.appendMessage(session.id, {
        role: 'user',
        content: 'Start',
      })

      await sessionStore.createBranch(session.id, msg.id, 'test-branch')

      expect(branchEvents.length).toBeGreaterThan(0)
      expect((branchEvents[0] as any).branchId).toBeDefined()
    })
  })

  describe('Provider Registry + Event Bus Integration', () => {
    it('should emit provider events on registration', () => {
      const providerEvents: unknown[] = []
      eventBus.on('provider:registered', (payload) => {
        providerEvents.push(payload)
      })

      llmRegistry.registerOpenAICompatible({
        id: 'test-openai',
        name: 'Test OpenAI',
        apiKey: 'test-key',
        models: ['gpt-4o-test'],
      })

      expect(providerEvents.length).toBeGreaterThan(0)
    })
  })

  describe('Function Calling + Tool Validation Integration', () => {
    it('should detect and validate tool calls from both structured and text sources', () => {
      // Structured tool calls
      const structured = detectToolCalls({
        content: 'I will read a file.',
        toolCalls: [{
          id: 'call_1',
          type: 'function' as const,
          function: { name: 'read_file', arguments: '{"path": "/test.ts"}' },
        }],
      })
      expect(structured).toHaveLength(1)
      expect(structured[0].toolName).toBe('read_file')

      // Text-based tool calls
      const textBased = detectToolCalls({
        content: '[TOOL_CALL] read_file({"path": "/test.ts"})',
      })
      expect(textBased).toHaveLength(1)
      expect(textBased[0].toolName).toBe('read_file')

      // Format results for both modes
      const nativeResult = formatToolResult('call_1', 'read_file', { content: 'file content' }, true)
      expect(nativeResult.role).toBe('tool')
      expect(nativeResult.toolCallId).toBe('call_1')

      const textResult = formatToolResult('call_1', 'read_file', { content: 'file content' }, false)
      expect(textResult.role).toBe('user')
      expect(textResult.content).toContain('[TOOL_RESULT]')
    })
  })
})
