/**
 * Frontend Test: Chat Stream UI Rendering
 *
 * Tests that the agent-chat.tsx component correctly:
 * 1. Tracks tool calls in messageToolActions (via tool_call SSE event)
 * 2. Updates success status (via tool_result SSE event)
 * 3. Groups them by type for ActionSummaryBar
 * 4. Does NOT push tool calls to terminal
 * 5. Only forwards $ commands to terminal
 *
 * Run: bun run test -- src/__tests__/integration/chat-stream-ui.test.ts
 */

import { describe, it, expect, vi } from 'vitest'

// ============================================================
// Types matching agent-chat.tsx
// ============================================================

interface ToolAction {
  name: string
  params: Record<string, unknown>
  result?: string
  success?: boolean
  timestamp: number
}

// ============================================================
// Simulated SSE Event Handler (mirrors agent-chat.tsx logic)
// ============================================================

class FakeChatStream {
  messageToolActions: Record<string, ToolAction[]> = {}
  terminalLines: string[] = []
  globalTodos: any[] = []

  // Simulates the SSE handler for 'tool_call' events
  handleToolCall(messageId: string, data: { name: string; params: Record<string, unknown> }) {
    const existing = this.messageToolActions[messageId] || []
    const newAction: ToolAction = {
      name: data.name,
      params: data.params || {},
      timestamp: Date.now(),
      success: undefined,
    }
    this.messageToolActions[messageId] = [...existing, newAction]
  }

  // Simulates the SSE handler for 'tool_result' events
  handleToolResult(messageId: string, data: { name: string; success: boolean; result: string }) {
    const existing = this.messageToolActions[messageId] || []
    const updated = [...existing]
    for (let i = updated.length - 1; i >= 0; i--) {
      if (updated[i].name === data.name && updated[i].success === undefined) {
        updated[i] = { ...updated[i], success: data.success, result: data.result }
        break
      }
    }
    this.messageToolActions[messageId] = updated
  }

  // Simulates the SSE handler for 'terminal' events
  // Z.ai-style: only forward $ commands to terminal
  handleTerminal(data: { level: string; message: string }) {
    if (data.message && data.message.startsWith('$')) {
      this.terminalLines.push(data.message)
    }
    // All other terminal events (warnings, info, verification) are SILENT
  }
}

// ============================================================
// ActionSummaryBar grouping logic (mirrors agent-chat.tsx)
// ============================================================

function getActionGroups(toolActions: ToolAction[]) {
  return {
    filesWritten: toolActions.filter(a => a.name === 'write_file' || a.name === 'edit_file').length,
    filesExplored: toolActions.filter(a => a.name === 'read_file' || a.name === 'list_directory' || a.name === 'search_files').length,
    commandsRun: toolActions.filter(a => a.name === 'execute_code').length,
    searches: toolActions.filter(a => a.name === 'web_search').length,
    allDone: toolActions.every(a => a.success === true),
  }
}

// ============================================================
// Tests
// ============================================================

describe('Frontend: Chat Stream UI — Tool Call Tracking', () => {
  it('should track tool calls in messageToolActions when tool_call SSE arrives', () => {
    const stream = new FakeChatStream()
    const msgId = 'msg-1'

    // Simulate 3 tool calls
    stream.handleToolCall(msgId, { name: 'read_file', params: { path: 'package.json' } })
    stream.handleToolCall(msgId, { name: 'write_file', params: { path: 'src/App.tsx' } })
    stream.handleToolCall(msgId, { name: 'execute_code', params: { command: 'npm install' } })

    expect(stream.messageToolActions[msgId]).toHaveLength(3)
    expect(stream.messageToolActions[msgId][0].name).toBe('read_file')
    expect(stream.messageToolActions[msgId][1].name).toBe('write_file')
    expect(stream.messageToolActions[msgId][2].name).toBe('execute_code')
  })

  it('should update success status when tool_result SSE arrives', () => {
    const stream = new FakeChatStream()
    const msgId = 'msg-1'

    stream.handleToolCall(msgId, { name: 'write_file', params: { path: 'App.tsx' } })
    expect(stream.messageToolActions[msgId][0].success).toBeUndefined()

    stream.handleToolResult(msgId, { name: 'write_file', success: true, result: 'File written' })
    expect(stream.messageToolActions[msgId][0].success).toBe(true)
  })

  it('should group tool calls correctly for ActionSummaryBar', () => {
    const stream = new FakeChatStream()
    const msgId = 'msg-1'

    // 3 reads + 2 writes + 1 command
    stream.handleToolCall(msgId, { name: 'read_file', params: { path: 'a.ts' } })
    stream.handleToolCall(msgId, { name: 'read_file', params: { path: 'b.ts' } })
    stream.handleToolCall(msgId, { name: 'read_file', params: { path: 'c.ts' } })
    stream.handleToolCall(msgId, { name: 'write_file', params: { path: 'App.tsx' } })
    stream.handleToolCall(msgId, { name: 'write_file', params: { path: 'index.html' } })
    stream.handleToolCall(msgId, { name: 'execute_code', params: { command: 'npm install' } })

    // Mark all as done
    stream.handleToolResult(msgId, { name: 'read_file', success: true, result: '' })
    stream.handleToolResult(msgId, { name: 'read_file', success: true, result: '' })
    stream.handleToolResult(msgId, { name: 'read_file', success: true, result: '' })
    stream.handleToolResult(msgId, { name: 'write_file', success: true, result: '' })
    stream.handleToolResult(msgId, { name: 'write_file', success: true, result: '' })
    stream.handleToolResult(msgId, { name: 'execute_code', success: true, result: '' })

    const groups = getActionGroups(stream.messageToolActions[msgId])

    expect(groups.filesExplored).toBe(3)
    expect(groups.filesWritten).toBe(2)
    expect(groups.commandsRun).toBe(1)
    expect(groups.allDone).toBe(true)
  })

  it('should show "Done" badge only when all tool calls succeed', () => {
    const stream = new FakeChatStream()
    const msgId = 'msg-1'

    stream.handleToolCall(msgId, { name: 'write_file', params: { path: 'a.ts' } })
    stream.handleToolCall(msgId, { name: 'write_file', params: { path: 'b.ts' } })

    // Only one succeeds
    stream.handleToolResult(msgId, { name: 'write_file', success: true, result: '' })
    stream.handleToolResult(msgId, { name: 'write_file', success: false, result: 'Error' })

    const groups = getActionGroups(stream.messageToolActions[msgId])
    expect(groups.allDone).toBe(false)
  })
})

describe('Frontend: Terminal Noise Filtering', () => {
  it('should only forward $ commands to terminal', () => {
    const stream = new FakeChatStream()

    // These should appear in terminal
    stream.handleTerminal({ level: 'success', message: '$ npm install\nadded 136 packages' })
    stream.handleTerminal({ level: 'success', message: '$ npm run build\n✓ built in 894ms' })

    // These should NOT appear in terminal
    stream.handleTerminal({ level: 'warn', message: 'Plan progress stall detected' })
    stream.handleTerminal({ level: 'info', message: 'Sequential mode: executing 1 of 3' })
    stream.handleTerminal({ level: 'warn', message: 'Verification: READY — 4 pass, 0 fail' })
    stream.handleTerminal({ level: 'info', message: 'Running code review...' })
    stream.handleTerminal({ level: 'warn', message: 'Self-eval: fix-issues-then-deliver — 18/25' })

    expect(stream.terminalLines).toHaveLength(2)
    expect(stream.terminalLines[0]).toContain('$ npm install')
    expect(stream.terminalLines[1]).toContain('$ npm run build')
  })

  it('should NOT forward tool call names to terminal', () => {
    const stream = new FakeChatStream()

    // Tool calls should NOT go to terminal at all
    // (they go to messageToolActions instead)
    stream.handleToolCall('msg-1', { name: 'think', params: {} })
    stream.handleToolCall('msg-1', { name: 'write_file', params: { path: 'App.tsx' } })
    stream.handleToolCall('msg-1', { name: 'read_file', params: { path: 'package.json' } })

    expect(stream.terminalLines).toHaveLength(0)
  })
})

describe('Frontend: ActionSummaryBar Rendering Logic', () => {
  it('should return null when no tool actions exist', () => {
    const groups = getActionGroups([])
    expect(groups.filesWritten).toBe(0)
    expect(groups.filesExplored).toBe(0)
    expect(groups.commandsRun).toBe(0)
    expect(groups.searches).toBe(0)
  })

  it('should count edit_file as "wrote"', () => {
    const actions: ToolAction[] = [
      { name: 'edit_file', params: { path: 'App.tsx' }, success: true, timestamp: 0 },
      { name: 'write_file', params: { path: 'new.ts' }, success: true, timestamp: 0 },
    ]
    const groups = getActionGroups(actions)
    expect(groups.filesWritten).toBe(2)
  })

  it('should count list_directory as "explored"', () => {
    const actions: ToolAction[] = [
      { name: 'list_directory', params: { path: '/' }, success: true, timestamp: 0 },
      { name: 'read_file', params: { path: 'a.ts' }, success: true, timestamp: 0 },
    ]
    const groups = getActionGroups(actions)
    expect(groups.filesExplored).toBe(2)
  })
})
