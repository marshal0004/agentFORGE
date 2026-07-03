/**
 * PreToolUse Hook System (Borrowed from ECC Pattern)
 *
 * Intercepts tool calls BEFORE execution to:
 *   1. Validate parameters (prevent write_file with missing path)
 *   2. Enforce safety rules (prevent destructive operations)
 *   3. Inject defaults (auto-populate projectId)
 *   4. Log tool calls for audit trail
 *
 * If a hook returns { blocked: true }, the tool call is NOT executed
 * and the hook's error message is returned as the tool result instead.
 */

import { agentEventBus } from './event-bus'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ToolCallRequest {
  id: string
  toolName: string
  params: Record<string, unknown>
}

export interface HookResult {
  blocked: boolean
  error?: string
  modifiedParams?: Record<string, unknown>
  warning?: string
}

export type PreToolUseHook = (
  toolName: string,
  params: Record<string, unknown>,
) => HookResult | Promise<HookResult>

// ── Built-in Hooks ───────────────────────────────────────────────────────────

/**
 * Hook: Validate write_file parameters
 * Prevents: write_file with missing/empty path, missing content
 */
async function validateWriteFileParams(
  toolName: string,
  params: Record<string, unknown>,
): Promise<HookResult> {
  if (toolName !== 'write_file') return { blocked: false }

  const filePath = params.path as string | undefined
  const content = params.content as string | undefined

  if (!filePath || filePath.trim() === '' || filePath === 'unknown') {
    return {
      blocked: true,
      error: `write_file BLOCKED: Missing or invalid 'path' parameter. Got: "${filePath}". You MUST specify a valid file path like "src/components/Header.tsx".`,
    }
  }

  // Path traversal check
  if (filePath.includes('..') || filePath.startsWith('/')) {
    return {
      blocked: true,
      error: `write_file BLOCKED: Path "${filePath}" contains traversal or absolute path. Use relative paths only.`,
    }
  }

  if (content === undefined || content === null) {
    return {
      blocked: true,
      error: `write_file BLOCKED: Missing 'content' parameter for file "${filePath}". You MUST provide file content.`,
    }
  }

  // Warn if file content is suspiciously short (likely placeholder)
  if (typeof content === 'string' && content.trim().length < 10 && !filePath.endsWith('.gitkeep') && !filePath.endsWith('.env')) {
    return {
      blocked: false,
      warning: `write_file WARNING: File "${filePath}" has very short content (${content.length} chars). Make sure this is intentional, not a placeholder.`,
    }
  }

  return { blocked: false }
}

/**
 * Hook: Validate edit_file parameters
 * Prevents: edit_file with missing path or operations
 */
async function validateEditFileParams(
  toolName: string,
  params: Record<string, unknown>,
): Promise<HookResult> {
  if (toolName !== 'edit_file') return { blocked: false }

  const filePath = params.path as string | undefined
  const operations = params.operations as Array<Record<string, string>> | undefined

  if (!filePath || filePath.trim() === '') {
    return {
      blocked: true,
      error: `edit_file BLOCKED: Missing 'path' parameter. Specify which file to edit.`,
    }
  }

  if (!operations || !Array.isArray(operations) || operations.length === 0) {
    return {
      blocked: true,
      error: `edit_file BLOCKED: Missing or empty 'operations' array for "${filePath}". Provide at least one {search, replace} operation.`,
    }
  }

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i]
    if (!op.search || !op.replace) {
      return {
        blocked: true,
        error: `edit_file BLOCKED: Operation ${i} missing 'search' or 'replace' field. Each operation must have both.`,
      }
    }
  }

  return { blocked: false }
}

/**
 * Hook: Validate execute_code parameters
 * Prevents: destructive commands (rm -rf /, etc.)
 */
async function validateExecuteCodeParams(
  toolName: string,
  params: Record<string, unknown>,
): Promise<HookResult> {
  if (toolName !== 'execute_code') return { blocked: false }

  const command = params.command as string | undefined

  if (!command || command.trim() === '') {
    return {
      blocked: true,
      error: `execute_code BLOCKED: Missing or empty 'command' parameter.`,
    }
  }

  // Block truly destructive commands
  const destructivePatterns = [
    /rm\s+(-rf?|-fr?)\s+[\/~]/,        // rm -rf / or rm -rf ~
    /rm\s+(-rf?|-fr?)\s+\*/,            // rm -rf *
    /dd\s+if=.*of=\/dev\//,              // dd to device
    />\s*\/dev\/sda/,                     // write to disk device
    /mkfs\./,                             // format filesystem
    /:\(\)\{.*;\}\s*;\s*:/,              // fork bomb
  ]

  for (const pattern of destructivePatterns) {
    if (pattern.test(command)) {
      return {
        blocked: true,
        error: `execute_code BLOCKED: Destructive command detected: "${command.substring(0, 100)}". This command is not allowed for safety reasons.`,
      }
    }
  }

  return { blocked: false }
}

/**
 * Hook: Validate read_file parameters
 */
async function validateReadFileParams(
  toolName: string,
  params: Record<string, unknown>,
): Promise<HookResult> {
  if (toolName !== 'read_file') return { blocked: false }

  const filePath = params.path as string | undefined

  if (!filePath || filePath.trim() === '') {
    return {
      blocked: true,
      error: `read_file BLOCKED: Missing 'path' parameter. Specify which file to read.`,
    }
  }

  if (filePath.includes('..') || filePath.startsWith('/')) {
    return {
      blocked: true,
      error: `read_file BLOCKED: Path "${filePath}" contains traversal or absolute path. Use relative paths only.`,
    }
  }

  return { blocked: false }
}

/**
 * Hook: Validate search_files parameters
 */
async function validateSearchParams(
  toolName: string,
  params: Record<string, unknown>,
): Promise<HookResult> {
  if (toolName !== 'search_files') return { blocked: false }

  const query = params.query as string | undefined

  if (!query || query.trim() === '') {
    return {
      blocked: true,
      error: `search_files BLOCKED: Missing 'query' parameter. Provide a search term.`,
    }
  }

  return { blocked: false }
}

// ── Hook Registry ────────────────────────────────────────────────────────────

const registeredHooks: PreToolUseHook[] = [
  validateWriteFileParams,
  validateEditFileParams,
  validateExecuteCodeParams,
  validateReadFileParams,
  validateSearchParams,
]

/**
 * Register a custom PreToolUse hook.
 * Hooks are executed in registration order; the first blocking hook wins.
 */
export function registerPreToolUseHook(hook: PreToolUseHook): void {
  registeredHooks.push(hook)
}

/**
 * Execute all PreToolUse hooks for a tool call.
 *
 * Returns the first blocking result, or the accumulated warnings if all
 * hooks pass.  If a hook modifies params, the modified params are passed
 * to subsequent hooks.
 */
export async function executePreToolUseHooks(
  toolCall: ToolCallRequest,
): Promise<HookResult> {
  let currentParams = { ...toolCall.params }
  const warnings: string[] = []

  for (const hook of registeredHooks) {
    try {
      const result = await hook(toolCall.toolName, currentParams)

      if (result.blocked) {
        // Log the block event
        agentEventBus.emit('tool:blocked', {
          toolName: toolCall.toolName,
          toolCallId: toolCall.id,
          reason: result.error,
        })

        return result
      }

      if (result.modifiedParams) {
        currentParams = { ...currentParams, ...result.modifiedParams }
      }

      if (result.warning) {
        warnings.push(result.warning)
      }
    } catch (hookError) {
      // Hooks must never crash the agent loop — log and continue
      console.error(
        `[PreToolUse] Hook threw error for ${toolCall.toolName}:`,
        hookError,
      )
    }
  }

  return {
    blocked: false,
    modifiedParams: Object.keys(currentParams).length > 0 ? currentParams : undefined,
    warning: warnings.length > 0 ? warnings.join('\n') : undefined,
  }
}

/**
 * Batch-validate an array of tool calls.
 * Returns a map of toolCallId → HookResult for any blocked/modified calls.
 */
export async function validateToolCallsBatch(
  toolCalls: ToolCallRequest[],
): Promise<Map<string, HookResult>> {
  const results = new Map<string, HookResult>()

  await Promise.all(
    toolCalls.map(async (tc) => {
      const result = await executePreToolUseHooks(tc)
      if (result.blocked || result.modifiedParams || result.warning) {
        results.set(tc.id, result)
      }
    }),
  )

  return results
}
