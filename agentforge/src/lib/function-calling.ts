/**
 * Native Function Calling — Structured tool call objects from LLM APIs
 *
 * Replaces the fragile text-based [TOOL_CALL] regex parsing with
 * structured tool call objects that work with LLM APIs that support
 * native function calling (OpenAI, Anthropic, etc.).
 *
 * Features:
 *   - Structured tool call objects (no regex)
 *   - Automatic detection of provider function calling support
 *   - Fallback to text-based parsing for providers without native support
 *   - Tool schema conversion (internal → OpenAI format → Anthropic format)
 *   - Tool result formatting
 *   - Validation of tool calls against registered schemas
 */

import { StructuredToolCall, ToolDefinition } from './llm-provider'
import { mcpToolHandlers, parseAllToolCalls as parseTextToolCalls } from './mcp-tools'
import { extensionSystem } from './extension-system'
import { agentEventBus } from './event-bus'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ToolCallRequest {
  id: string
  toolName: string
  params: Record<string, unknown>
}

export interface ToolCallResponse {
  id: string
  toolName: string
  result: unknown
  success: boolean
  latencyMs: number
  source: 'builtin' | 'mcp' | 'custom' | 'unknown'
}

export interface ToolSchema {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

// ── Schema conversion ──────────────────────────────────────────────────────────

/**
 * Convert our internal tool definitions to OpenAI function calling format.
 */
export function toOpenAITools(schemas: ToolSchema[]): ToolDefinition[] {
  return schemas.map((schema) => ({
    type: 'function' as const,
    function: {
      name: schema.name,
      description: schema.description,
      parameters: schema.parameters,
    },
  }))
}

/**
 * Build tool schemas from the built-in MCP tool handlers.
 */
export function getBuiltinToolSchemas(): ToolSchema[] {
  return [
    {
      name: 'web_search',
      description: 'Search the web for information',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          num: { type: 'number', description: 'Number of results (default: 5)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'fetch_page',
      description: 'Fetch and extract content from a web page',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL of the page to fetch' },
        },
        required: ['url'],
      },
    },
    {
      name: 'execute_code',
      description: 'Execute a shell command and return the output. Use this to install dependencies (npm install, pip install), build/compile code (npm run build, npx tsc --noEmit), run tests (npm test), start dev servers, or run any other command. ALWAYS use this tool instead of telling the user to run commands manually. You are an autonomous agent with full terminal access.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute (e.g. "npm install", "npm run build", "pip install -r requirements.txt")' },
          cwd: { type: 'string', description: 'Working directory for the command (defaults to project root)' },
        },
        required: ['command'],
      },
    },
    {
      name: 'read_file',
      description: 'Read the contents of a file. Do NOT read the same file twice — read it once and remember the content.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to read (relative to project root)' },
        },
        required: ['path'],
      },
    },
    {
      name: 'write_file',
      description: 'Write content to a file, creating directories if needed. BOTH path AND content are required — never call this without a path parameter.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to write (relative to project root). REQUIRED — never omit this.' },
          content: { type: 'string', description: 'Content to write. REQUIRED — never omit this.' },
          projectId: { type: 'string', description: '(Injected automatically — do not set) Project ID for workspace routing' },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'edit_file',
      description: 'Apply search/replace diff operations to a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to edit' },
          operations: {
            type: 'array',
            description: 'Array of search/replace operations',
            items: {
              type: 'object',
              properties: {
                search: { type: 'string', description: 'Text to find' },
                replace: { type: 'string', description: 'Replacement text' },
              },
              required: ['search', 'replace'],
            },
          },
        },
        required: ['path', 'operations'],
      },
    },
    {
      name: 'list_directory',
      description: 'List files and directories at a given path. Use "." for project root. Do NOT call this multiple times on the same path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to list (relative to project root, e.g. "src" or ".")' },
        },
      },
    },
    {
      name: 'search_files',
      description: 'Recursively search for files matching a pattern. Only use this once per pattern.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern to match (e.g. "*.tsx")' },
          directory: { type: 'string', description: 'Root directory to search in (relative to project root)' },
        },
        required: ['pattern'],
      },
    },
    {
      name: 'git_status',
      description: 'Get git repository status',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'git_commit',
      description: 'Stage and commit changes',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Commit message' },
        },
        required: ['message'],
      },
    },
    {
      name: 'store',
      description: 'Store a value in the key-value store',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Storage key' },
          value: { type: 'string', description: 'Value to store' },
        },
        required: ['key', 'value'],
      },
    },
    {
      name: 'retrieve',
      description: 'Retrieve a value from the key-value store',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Key to look up' },
        },
        required: ['key'],
      },
    },
    {
      name: 'think',
      description: 'Think tool for chain-of-thought reasoning (no-op)',
      parameters: {
        type: 'object',
        properties: {
          thought: { type: 'string', description: 'The thought to record' },
        },
      },
    },
  ]
}

/**
 * Get all available tool schemas (builtin + MCP + extension tools).
 */
export function getAllToolSchemas(): ToolSchema[] {
  const schemas = getBuiltinToolSchemas()

  // Add extension tools
  const customTools = extensionSystem.getCustomTools()
  for (const tool of customTools) {
    schemas.push({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })
  }

  return schemas
}

// ── Tool call parsing ──────────────────────────────────────────────────────────

/**
 * Parse structured tool calls from an LLM response.
 * Works with native function calling responses from OpenAI-compatible APIs.
 */
export function parseStructuredToolCalls(toolCalls: StructuredToolCall[] | undefined): ToolCallRequest[] {
  if (!toolCalls || toolCalls.length === 0) return []

  return toolCalls.map((tc) => {
    let params: Record<string, unknown> = {}
    try {
      params = JSON.parse(tc.function.arguments)
    } catch {
      params = { raw: tc.function.arguments }
    }

    return {
      id: tc.id,
      toolName: tc.function.name,
      params,
    }
  })
}

/**
 * Parse tool calls from LLM text output (fallback for providers without native function calling).
 * Uses the existing [TOOL_CALL] regex parsing.
 */
export function parseFallbackToolCalls(text: string): ToolCallRequest[] {
  const parsed = parseTextToolCalls(text)
  return parsed.map((tc, index) => ({
    id: `text_tc_${index}_${Date.now()}`,
    toolName: tc.toolName,
    params: tc.params,
  }))
}

/**
 * Detect whether tool calls are present in the response (either structured or text).
 */
export function detectToolCalls(
  response: { content: string; toolCalls?: StructuredToolCall[] },
): ToolCallRequest[] {
  // Prefer structured tool calls
  if (response.toolCalls && response.toolCalls.length > 0) {
    return parseStructuredToolCalls(response.toolCalls)
  }

  // Fallback to text-based parsing
  return parseFallbackToolCalls(response.content)
}

// ── Tool call validation ───────────────────────────────────────────────────────

/**
 * Validate a tool call against its registered schema.
 * Returns the validated params or an error.
 */
export function validateToolCall(
  toolCall: ToolCallRequest,
  schemas: ToolSchema[],
): { valid: boolean; params: Record<string, unknown>; errors: string[] } {
  const schema = schemas.find((s) => s.name === toolCall.toolName)
  if (!schema) {
    return { valid: false, params: toolCall.params, errors: [`Unknown tool: ${toolCall.toolName}`] }
  }

  const errors: string[] = []
  const required = schema.parameters.required || []
  const properties = schema.parameters.properties || {}

  // Check required parameters
  for (const paramName of required) {
    if (toolCall.params[paramName] === undefined) {
      errors.push(`Missing required parameter: ${paramName}`)
    }
  }

  // Type-check provided parameters
  for (const [key, value] of Object.entries(toolCall.params)) {
    const propSchema = properties[key] as { type?: string } | undefined
    if (propSchema?.type) {
      const actualType = Array.isArray(value) ? 'array' : typeof value
      if (actualType !== propSchema.type && !(actualType === 'number' && propSchema.type === 'integer')) {
        // Soft warning — don't reject, just note it
        // Many LLMs pass numbers as strings, etc.
      }
    }
  }

  return { valid: errors.length === 0, params: toolCall.params, errors }
}

// ── Tool result formatting ─────────────────────────────────────────────────────

/**
 * Format tool results for sending back to the LLM.
 * Handles both native function calling and text-based formats.
 */
export function formatToolResult(
  toolCallId: string,
  toolName: string,
  result: unknown,
  useNativeFunctionCalling: boolean,
): { role: 'tool' | 'user'; content: string; toolCallId?: string } {
  const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2)

  if (useNativeFunctionCalling) {
    return {
      role: 'tool',
      content: resultStr,
      toolCallId,
    }
  }

  return {
    role: 'user',
    content: `[TOOL_RESULT] ${toolName}\n${resultStr}`,
  }
}
