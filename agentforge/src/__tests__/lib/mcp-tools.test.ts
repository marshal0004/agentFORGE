import { describe, it, expect, beforeEach } from 'vitest'
import {
  parseToolCall,
  executeToolCall,
  invokeStore,
  invokeRetrieve,
  invokeThink,
  invokeReadFile,
  invokeWriteFile,
  mcpToolHandlers,
} from '@/lib/mcp-tools'

describe('mcp-tools', () => {
  describe('parseToolCall', () => {
    it('should extract a valid tool call', () => {
      const text = '[TOOL_CALL] store({"key": "test", "value": "hello"})'
      const result = parseToolCall(text)
      expect(result).not.toBeNull()
      expect(result!.toolName).toBe('store')
      expect(result!.params).toEqual({ key: 'test', value: 'hello' })
    })

    it('should extract tool call with various parameter types', () => {
      const text = '[TOOL_CALL] read_file({"path": "/tmp/test.txt"})'
      const result = parseToolCall(text)
      expect(result).not.toBeNull()
      expect(result!.toolName).toBe('read_file')
      expect(result!.params).toEqual({ path: '/tmp/test.txt' })
    })

    it('should return null for non-matches', () => {
      expect(parseToolCall('just some text')).toBeNull()
      expect(parseToolCall('')).toBeNull()
      expect(parseToolCall('[TOOL] something')).toBeNull()
    })

    it('should handle malformed JSON in tool call', () => {
      const text = '[TOOL_CALL] store({invalid json})'
      const result = parseToolCall(text)
      expect(result).not.toBeNull()
      expect(result!.toolName).toBe('store')
      // When JSON parsing fails, it falls back to raw params (includes braces)
      expect(result!.params).toEqual({ raw: '{invalid json}' })
    })

    it('should handle tool calls with extra whitespace', () => {
      const text = '[TOOL_CALL]   think({"step": "analyze"})'
      const result = parseToolCall(text)
      expect(result).not.toBeNull()
      expect(result!.toolName).toBe('think')
    })

    it('should extract tool call from longer text', () => {
      const text = 'Let me analyze this. [TOOL_CALL] store({"key": "result", "value": 42}) Done!'
      const result = parseToolCall(text)
      expect(result).not.toBeNull()
      expect(result!.toolName).toBe('store')
    })
  })

  describe('executeToolCall', () => {
    it('should return error for unknown tools', async () => {
      const result = await executeToolCall('nonexistent_tool', {})
      expect(result.success).toBe(false)
      expect(result.result).toEqual({ error: 'Unknown tool: nonexistent_tool' })
    })

    it('should execute known tools', async () => {
      const result = await executeToolCall('think', { thought: 'test' })
      expect(result.success).toBe(true)
    })
  })

  describe('invokeStore and invokeRetrieve', () => {
    it('should store and retrieve a value', async () => {
      const storeResult = await invokeStore({ key: 'test-key', value: 'test-value' })
      expect(storeResult).toEqual({ success: true, key: 'test-key', stored: true })

      const retrieveResult = await invokeRetrieve({ key: 'test-key' })
      expect(retrieveResult).toEqual({ key: 'test-key', value: 'test-value', found: true })
    })

    it('should require key parameter for store', async () => {
      const result = await invokeStore({})
      expect(result).toEqual({ error: 'key parameter is required' })
    })

    it('should require key parameter for retrieve', async () => {
      const result = await invokeRetrieve({})
      expect(result).toEqual({ error: 'key parameter is required' })
    })

    it('should return error for missing key on retrieve', async () => {
      const result = await invokeRetrieve({ key: 'nonexistent-key' })
      expect(result).toEqual({ error: 'No value found for key: nonexistent-key', found: false })
    })

    it('should store and retrieve complex values', async () => {
      const complexValue = { name: 'test', items: [1, 2, 3], nested: { a: true } }
      await invokeStore({ key: 'complex', value: complexValue })
      const result = await invokeRetrieve({ key: 'complex' })
      expect(result.found).toBe(true)
      expect(result.value).toEqual(complexValue)
    })
  })

  describe('invokeThink', () => {
    it('should return the input thought', async () => {
      const result = await invokeThink({ thought: 'I need to analyze this' })
      expect(result.thought).toEqual({ thought: 'I need to analyze this' })
      expect(result.note).toContain('Think tool')
    })

    it('should return any input object', async () => {
      const result = await invokeThink({ step: 1, analysis: 'testing' })
      expect(result.thought).toEqual({ step: 1, analysis: 'testing' })
    })
  })

  describe('invokeReadFile - path traversal protection', () => {
    it('should reject paths with ..', async () => {
      const result = await invokeReadFile({ path: '/tmp/../etc/passwd' })
      expect(result).toEqual({ error: 'Path traversal is not allowed' })
    })

    it('should require path parameter', async () => {
      const result = await invokeReadFile({})
      expect(result).toEqual({ error: 'path parameter is required' })
    })
  })

  describe('invokeWriteFile - path traversal protection', () => {
    it('should reject paths with ..', async () => {
      const result = await invokeWriteFile({ path: '/tmp/../etc/hacked', content: 'bad' })
      expect(result).toEqual({ error: 'Path traversal is not allowed' })
    })

    it('should require path parameter', async () => {
      const result = await invokeWriteFile({})
      expect(result).toEqual({ error: 'path parameter is required' })
    })

    it('should require content parameter', async () => {
      const result = await invokeWriteFile({ path: '/tmp/test.txt' })
      expect(result).toEqual({ error: 'content parameter is required' })
    })
  })

  describe('mcpToolHandlers', () => {
    it('should contain all expected tool handlers', () => {
      expect(mcpToolHandlers.web_search).toBeDefined()
      expect(mcpToolHandlers.fetch_page).toBeDefined()
      expect(mcpToolHandlers.execute_code).toBeDefined()
      expect(mcpToolHandlers.read_file).toBeDefined()
      expect(mcpToolHandlers.write_file).toBeDefined()
      expect(mcpToolHandlers.list_directory).toBeDefined()
      expect(mcpToolHandlers.search_files).toBeDefined()
      expect(mcpToolHandlers.git_status).toBeDefined()
      expect(mcpToolHandlers.git_commit).toBeDefined()
      expect(mcpToolHandlers.store).toBeDefined()
      expect(mcpToolHandlers.retrieve).toBeDefined()
      expect(mcpToolHandlers.think).toBeDefined()
    })

    it('should have 12 tool handlers', () => {
      expect(Object.keys(mcpToolHandlers)).toHaveLength(12)
    })
  })
})
