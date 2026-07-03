/**
 * Unit tests for Parallel Tool Execution
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executeToolCallsParallel, ParallelToolCall } from '@/lib/mcp-tools'

// Mock the extension system to avoid circular dependencies
vi.mock('@/lib/extension-system', () => ({
  extensionSystem: {
    executeHooks: vi.fn().mockResolvedValue({}),
    isCustomTool: vi.fn().mockReturnValue(false),
    executeCustomTool: vi.fn(),
  },
}))

// Mock the event bus
vi.mock('@/lib/event-bus', () => ({
  agentEventBus: {
    emit: vi.fn(),
  },
}))

// Mock the MCP client
vi.mock('@/lib/mcp-client', () => ({
  mcpClient: {
    getAllTools: vi.fn().mockReturnValue([]),
    callTool: vi.fn(),
  },
  MCPToolSchema: {},
}))

// Mock the diff editor
vi.mock('@/lib/diff-editor', () => ({
  applyDiffToFile: vi.fn(),
  DiffOperation: {},
}))

// Mock the database
vi.mock('@/lib/db', () => ({
  db: {},
}))

describe('executeToolCallsParallel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return empty array for empty input', async () => {
    const result = await executeToolCallsParallel([])
    expect(result).toHaveLength(0)
  })

  it('should execute independent tool calls in parallel', async () => {
    // Use tools that exist in the mock registry
    const toolCalls: ParallelToolCall[] = [
      {
        id: 'tc_1',
        toolName: 'think',
        params: { thought: 'thinking about first thing' },
      },
      {
        id: 'tc_2',
        toolName: 'think',
        params: { thought: 'thinking about second thing' },
      },
    ]

    const results = await executeToolCallsParallel(toolCalls)

    expect(results).toHaveLength(2)
    expect(results[0].toolName).toBe('think')
    expect(results[1].toolName).toBe('think')
  })

  it('should handle tool execution errors gracefully', async () => {
    const toolCalls: ParallelToolCall[] = [
      {
        id: 'tc_err',
        toolName: 'nonexistent_tool_xyz',
        params: {},
      },
    ]

    const results = await executeToolCallsParallel(toolCalls)

    expect(results).toHaveLength(1)
    expect(results[0].success).toBe(false)
  })

  it('should include timing information in results', async () => {
    const toolCalls: ParallelToolCall[] = [
      {
        id: 'tc_timed',
        toolName: 'think',
        params: { thought: 'test' },
      },
    ]

    const results = await executeToolCallsParallel(toolCalls)

    expect(results[0].latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('should handle a mix of successful and failed tool calls', async () => {
    const toolCalls: ParallelToolCall[] = [
      {
        id: 'tc_ok',
        toolName: 'think',
        params: { thought: 'this works' },
      },
      {
        id: 'tc_fail',
        toolName: 'totally_fake_tool',
        params: {},
      },
    ]

    const results = await executeToolCallsParallel(toolCalls)

    expect(results).toHaveLength(2)
    const successResult = results.find((r) => r.toolName === 'think')
    const failResult = results.find((r) => r.toolName === 'totally_fake_tool')

    expect(successResult!.success).toBe(true)
    expect(failResult!.success).toBe(false)
  })
})
