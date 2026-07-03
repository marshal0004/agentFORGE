/**
 * Unit tests for Native Function Calling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  parseStructuredToolCalls,
  parseFallbackToolCalls,
  detectToolCalls,
  validateToolCall,
  formatToolResult,
  getBuiltinToolSchemas,
  getAllToolSchemas,
  toOpenAITools,
  ToolCallRequest,
  ToolSchema,
  StructuredToolCall,
} from '@/lib/function-calling'

describe('parseStructuredToolCalls', () => {
  it('should parse structured tool calls from OpenAI format', () => {
    const toolCalls: StructuredToolCall[] = [
      {
        id: 'call_abc123',
        type: 'function',
        function: {
          name: 'read_file',
          arguments: '{"path": "/src/app.ts"}',
        },
      },
    ]

    const result = parseStructuredToolCalls(toolCalls)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('call_abc123')
    expect(result[0].toolName).toBe('read_file')
    expect(result[0].params).toEqual({ path: '/src/app.ts' })
  })

  it('should parse multiple tool calls', () => {
    const toolCalls: StructuredToolCall[] = [
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'read_file', arguments: '{"path": "/a.ts"}' },
      },
      {
        id: 'call_2',
        type: 'function',
        function: { name: 'write_file', arguments: '{"path": "/b.ts", "content": "hello"}' },
      },
    ]

    const result = parseStructuredToolCalls(toolCalls)
    expect(result).toHaveLength(2)
    expect(result[0].toolName).toBe('read_file')
    expect(result[1].toolName).toBe('write_file')
  })

  it('should handle invalid JSON arguments', () => {
    const toolCalls: StructuredToolCall[] = [
      {
        id: 'call_bad',
        type: 'function',
        function: { name: 'test_tool', arguments: 'not valid json' },
      },
    ]

    const result = parseStructuredToolCalls(toolCalls)
    expect(result).toHaveLength(1)
    expect(result[0].params).toEqual({ raw: 'not valid json' })
  })

  it('should return empty array for undefined tool calls', () => {
    expect(parseStructuredToolCalls(undefined)).toHaveLength(0)
    expect(parseStructuredToolCalls([])).toHaveLength(0)
  })
})

describe('parseFallbackToolCalls', () => {
  it('should parse [TOOL_CALL] text blocks', () => {
    const text = 'Some text [TOOL_CALL] read_file({"path": "/src/app.ts"}) more text'

    const result = parseFallbackToolCalls(text)
    expect(result).toHaveLength(1)
    expect(result[0].toolName).toBe('read_file')
    expect(result[0].params).toEqual({ path: '/src/app.ts' })
  })

  it('should parse multiple [TOOL_CALL] blocks', () => {
    const text = `
      [TOOL_CALL] read_file({"path": "/a.ts"})
      some response text
      [TOOL_CALL] write_file({"path": "/b.ts", "content": "hello"})
    `

    const result = parseFallbackToolCalls(text)
    expect(result).toHaveLength(2)
  })

  it('should return empty array for text without tool calls', () => {
    const result = parseFallbackToolCalls('No tool calls here')
    expect(result).toHaveLength(0)
  })
})

describe('detectToolCalls', () => {
  it('should prefer structured tool calls over text-based', () => {
    const response = {
      content: 'Some text [TOOL_CALL] read_file({"path": "/a.ts"})',
      toolCalls: [{
        id: 'call_1',
        type: 'function' as const,
        function: { name: 'write_file', arguments: '{"path": "/b.ts", "content": "hello"}' },
      }],
    }

    const result = detectToolCalls(response)
    expect(result).toHaveLength(1)
    expect(result[0].toolName).toBe('write_file') // Uses structured, not text
  })

  it('should fall back to text parsing when no structured calls', () => {
    const response = {
      content: '[TOOL_CALL] read_file({"path": "/a.ts"})',
    }

    const result = detectToolCalls(response)
    expect(result).toHaveLength(1)
    expect(result[0].toolName).toBe('read_file')
  })

  it('should return empty array when no tool calls found', () => {
    const response = {
      content: 'Just a regular response without any tool calls.',
    }

    const result = detectToolCalls(response)
    expect(result).toHaveLength(0)
  })
})

describe('validateToolCall', () => {
  const schemas: ToolSchema[] = [
    {
      name: 'read_file',
      description: 'Read a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
        },
        required: ['path'],
      },
    },
    {
      name: 'write_file',
      description: 'Write a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          content: { type: 'string', description: 'File content' },
        },
        required: ['path', 'content'],
      },
    },
  ]

  it('should validate a correct tool call', () => {
    const toolCall: ToolCallRequest = {
      id: 'tc_1',
      toolName: 'read_file',
      params: { path: '/src/app.ts' },
    }

    const result = validateToolCall(toolCall, schemas)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should reject unknown tools', () => {
    const toolCall: ToolCallRequest = {
      id: 'tc_1',
      toolName: 'unknown_tool',
      params: {},
    }

    const result = validateToolCall(toolCall, schemas)
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('Unknown tool')
  })

  it('should reject missing required parameters', () => {
    const toolCall: ToolCallRequest = {
      id: 'tc_1',
      toolName: 'read_file',
      params: {}, // Missing 'path'
    }

    const result = validateToolCall(toolCall, schemas)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Missing required parameter: path')
  })

  it('should validate with all required parameters present', () => {
    const toolCall: ToolCallRequest = {
      id: 'tc_1',
      toolName: 'write_file',
      params: { path: '/test.ts', content: 'hello' },
    }

    const result = validateToolCall(toolCall, schemas)
    expect(result.valid).toBe(true)
  })
})

describe('formatToolResult', () => {
  it('should format for native function calling', () => {
    const result = formatToolResult('call_1', 'read_file', { content: 'file contents' }, true)
    expect(result.role).toBe('tool')
    expect(result.toolCallId).toBe('call_1')
    expect(result.content).toContain('file contents')
  })

  it('should format for text-based calling', () => {
    const result = formatToolResult('call_1', 'read_file', { content: 'file contents' }, false)
    expect(result.role).toBe('user')
    expect(result.content).toContain('[TOOL_RESULT]')
    expect(result.content).toContain('read_file')
  })
})

describe('getBuiltinToolSchemas', () => {
  it('should return all built-in tool schemas', () => {
    const schemas = getBuiltinToolSchemas()
    expect(schemas.length).toBeGreaterThanOrEqual(13) // 12 original + edit_file

    const names = schemas.map((s) => s.name)
    expect(names).toContain('web_search')
    expect(names).toContain('read_file')
    expect(names).toContain('write_file')
    expect(names).toContain('edit_file')
    expect(names).toContain('execute_code')
    expect(names).toContain('think')
  })

  it('should include the edit_file schema', () => {
    const schemas = getBuiltinToolSchemas()
    const editTool = schemas.find((s) => s.name === 'edit_file')
    expect(editTool).toBeDefined()
    expect(editTool!.parameters.properties).toHaveProperty('path')
    expect(editTool!.parameters.properties).toHaveProperty('operations')
  })
})

describe('toOpenAITools', () => {
  it('should convert tool schemas to OpenAI format', () => {
    const schemas: ToolSchema[] = [
      {
        name: 'test_tool',
        description: 'A test tool',
        parameters: {
          type: 'object',
          properties: {
            input: { type: 'string', description: 'Test input' },
          },
        },
      },
    ]

    const result = toOpenAITools(schemas)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('function')
    expect(result[0].function.name).toBe('test_tool')
    expect(result[0].function.description).toBe('A test tool')
    expect(result[0].function.parameters).toEqual(schemas[0].parameters)
  })
})
