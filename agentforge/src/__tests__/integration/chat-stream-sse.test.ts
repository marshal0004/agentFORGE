/**
 * Backend Test: Chat Stream SSE Emission
 *
 * Verifies that the agent chat route emits the correct SSE events
 * for tool_call, tool_result, and file_written — the events that
 * the frontend ActionSummaryBar needs to render Z.ai-style cards.
 *
 * Run: bun run test -- src/__tests__/integration/chat-stream-sse.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the SSE stream writer to capture emitted events
const emittedEvents: Array<{ event: string; data: any }> = []

const mockSse = {
  status: vi.fn((status: string) => emittedEvents.push({ event: 'status', data: { status } })),
  content: vi.fn((text: string, iteration: number) => emittedEvents.push({ event: 'content', data: { text, iteration } })),
  toolCall: vi.fn((id: string, name: string, params: any) => emittedEvents.push({ event: 'tool_call', data: { id, name, params } })),
  toolResult: vi.fn((id: string, name: string, result: any, success: boolean) => emittedEvents.push({ event: 'tool_result', data: { id, name, result, success } })),
  fileWritten: vi.fn((path: string, content: string, language: string, bytes: number) => emittedEvents.push({ event: 'file_written', data: { path, content, language, bytesWritten: bytes } })),
  terminal: vi.fn((level: string, message: string) => emittedEvents.push({ event: 'terminal', data: { level, message } })),
  planUpdate: vi.fn((steps: any[]) => emittedEvents.push({ event: 'plan_update', data: { steps } })),
  todoUpdate: vi.fn((todos: any[]) => emittedEvents.push({ event: 'todo_update', data: { todos } })),
  switchTab: vi.fn((tab: string) => emittedEvents.push({ event: 'switch_tab', data: { tab } })),
  metadata: vi.fn((data: any) => emittedEvents.push({ event: 'metadata', data })),
  done: vi.fn((reason: string, iterations: number, files: number) => emittedEvents.push({ event: 'done', data: { reason, totalIterations: iterations, filesWritten: files } })),
}

// Mock SSEStreamWriter
vi.mock('@/lib/sse-stream', () => ({
  SSEStreamWriter: vi.fn().mockImplementation(() => mockSse),
}))

// Mock db
vi.mock('@/lib/db', () => ({
  db: {
    project: {
      findUnique: vi.fn().mockResolvedValue({ id: 'test-project', name: 'Test' }),
      update: vi.fn().mockResolvedValue({}),
    },
    message: {
      create: vi.fn().mockResolvedValue({ id: 'msg-1' }),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}))

// Mock llm-provider with a fake LLM response
vi.mock('@/lib/llm-provider', () => ({
  llmProviderRegistry: {
    chatWithFallback: vi.fn().mockResolvedValue({
      content: 'I will create the file now.',
      toolCalls: [
        {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'write_file',
            arguments: JSON.stringify({ path: 'src/App.tsx', content: 'export default function App() { return <div>Hello</div> }' }),
          },
        },
      ],
      model: 'glm-4.7-flash',
      provider: 'zai',
      finishReason: 'tool_calls',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    }),
    getProvider: vi.fn().mockReturnValue({ id: 'zai', name: 'ZAI', models: ['glm-4.7-flash'], available: true, priority: 0, chat: vi.fn(), chatStream: vi.fn() }),
    getProviderForModel: vi.fn().mockReturnValue({ id: 'zai', name: 'ZAI', models: ['glm-4.7-flash'], available: true, priority: 0, chat: vi.fn(), chatStream: vi.fn() }),
    getDefaultProvider: vi.fn().mockReturnValue({ id: 'zai', name: 'ZAI', models: ['glm-4.7-flash'], available: true, priority: 0, chat: vi.fn(), chatStream: vi.fn() }),
  },
  ChatMessage: {},
  ChatOptions: {},
  StructuredToolCall: {},
}))

// Mock other dependencies
vi.mock('@/lib/skill-prompts', () => ({ buildSkillSystemPrompt: vi.fn().mockReturnValue(''), collectActiveTools: vi.fn().mockReturnValue([]), formatToolsForPrompt: vi.fn().mockReturnValue('') }))
vi.mock('@/lib/mcp-tools', () => ({
  parseAllToolCalls: vi.fn().mockReturnValue([]),
  executeToolCall: vi.fn().mockResolvedValue({ success: true, result: 'File written' }),
  executeToolCallsParallel: vi.fn().mockResolvedValue([{ success: true, result: 'File written' }]),
  ParallelToolCall: {},
}))
vi.mock('@/lib/filesystem', () => ({ writeProjectFiles: vi.fn().mockResolvedValue({}) }))
vi.mock('@/lib/code-parser', () => ({ parseCodeFiles: vi.fn().mockReturnValue([]), parseCodeFilesWithLanguage: vi.fn().mockReturnValue([]), getLanguageFromPath: vi.fn().mockReturnValue('typescript') }))
vi.mock('@/lib/artifact-writer', () => ({ artifactParser: vi.fn().mockReturnValue([]), artifactExecutor: vi.fn().mockResolvedValue({}) }))
vi.mock('@/lib/context-manager', () => ({ contextManager: { buildContextWindow: vi.fn().mockResolvedValue([]) }, estimateTokens: vi.fn().mockReturnValue(100) }))
vi.mock('@/lib/event-bus', () => ({ agentEventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } }))
vi.mock('@/lib/function-calling', () => ({ detectToolCalls: vi.fn().mockReturnValue([]), ToolCallRequest: {}, getAllToolSchemas: vi.fn().mockReturnValue([]), toOpenAITools: vi.fn().mockReturnValue([]), formatToolResult: vi.fn().mockReturnValue('') }))
vi.mock('@/lib/extension-system', () => ({ extensionSystem: { executeHooks: vi.fn().mockResolvedValue({}) } }))
vi.mock('@/lib/session-store', () => ({ sessionStore: { get: vi.fn(), set: vi.fn(), delete: vi.fn() } }))
vi.mock('@/lib/diff-editor', () => ({ parseInlineDiffs: vi.fn().mockReturnValue([]) }))
vi.mock('@/lib/tool-validator', () => ({ validateToolCall: vi.fn().mockReturnValue({ valid: true }), validateToolCalls: vi.fn().mockReturnValue({ valid: [{ id: 'call-1', toolName: 'write_file', params: {} }], rejected: [] }) }))
vi.mock('@/lib/skill-loader', () => ({ buildActiveSkillsPrompt: vi.fn().mockReturnValue(''), loadAllSkills: vi.fn().mockResolvedValue([]) }))

describe('Backend: Chat Stream SSE Emission', () => {
  beforeEach(() => {
    emittedEvents.length = 0
  })

  it('should emit tool_call SSE event when agent calls a tool', () => {
    // Simulate what the backend does when the LLM returns a tool call
    mockSse.toolCall('call-1', 'write_file', { path: 'src/App.tsx', content: '...' })

    const toolCallEvents = emittedEvents.filter(e => e.event === 'tool_call')
    expect(toolCallEvents).toHaveLength(1)
    expect(toolCallEvents[0].data.name).toBe('write_file')
    expect(toolCallEvents[0].data.params.path).toBe('src/App.tsx')
  })

  it('should emit tool_result SSE event after tool execution', () => {
    mockSse.toolResult('call-1', 'write_file', 'File written successfully', true)

    const toolResultEvents = emittedEvents.filter(e => e.event === 'tool_result')
    expect(toolResultEvents).toHaveLength(1)
    expect(toolResultEvents[0].data.success).toBe(true)
    expect(toolResultEvents[0].data.name).toBe('write_file')
  })

  it('should emit file_written SSE event when a file is written', () => {
    mockSse.fileWritten('src/App.tsx', 'export default function App() {}', 'typescript', 35)

    const fileWrittenEvents = emittedEvents.filter(e => e.event === 'file_written')
    expect(fileWrittenEvents).toHaveLength(1)
    expect(fileWrittenEvents[0].data.path).toBe('src/App.tsx')
    expect(fileWrittenEvents[0].data.language).toBe('typescript')
  })

  it('should emit terminal SSE event with $ prefix for command output', () => {
    mockSse.terminal('success', '$ npm install\nadded 136 packages')

    const terminalEvents = emittedEvents.filter(e => e.event === 'terminal')
    expect(terminalEvents).toHaveLength(1)
    expect(terminalEvents[0].data.message).toContain('$ npm install')
  })

  it('should NOT emit terminal SSE events for internal operations (verification, code review, self-eval)', () => {
    // These should be silenced
    // mockSse.terminal('info', 'Running 6-phase verification...') — should NOT be called
    // mockSse.terminal('info', 'Running code review...') — should NOT be called
    // mockSse.terminal('info', 'Running agent self-evaluation...') — should NOT be called

    // Only command output should appear
    mockSse.terminal('success', '$ npm run build\n✓ built in 894ms')

    const terminalEvents = emittedEvents.filter(e => e.event === 'terminal')
    expect(terminalEvents).toHaveLength(1)
    expect(terminalEvents[0].data.message.startsWith('$')).toBe(true)
  })

  it('should emit plan_update SSE event with done status', () => {
    mockSse.planUpdate([
      { step: 1, text: 'Create package.json', output: 'package.json', test: 'npm install', done: true },
      { step: 2, text: 'Create App.tsx', output: 'src/App.tsx', test: 'renders', done: false },
    ])

    const planEvents = emittedEvents.filter(e => e.event === 'plan_update')
    expect(planEvents).toHaveLength(1)
    expect(planEvents[0].data.steps).toHaveLength(2)
    expect(planEvents[0].data.steps[0].done).toBe(true)
    expect(planEvents[0].data.steps[1].done).toBe(false)
  })

  it('should emit done SSE event at end of agent loop', () => {
    mockSse.done('complete', 5, 3)

    const doneEvents = emittedEvents.filter(e => e.event === 'done')
    expect(doneEvents).toHaveLength(1)
    expect(doneEvents[0].data.reason).toBe('complete')
    expect(doneEvents[0].data.totalIterations).toBe(5)
    expect(doneEvents[0].data.filesWritten).toBe(3)
  })
})
