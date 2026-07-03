/**
 * PreToolUse Validation — Issue 7 Fix + ECC Pattern Hardening
 *
 * Validates tool call parameters BEFORE execution. Rejects malformed calls
 * early so the LLM gets a clear error message instead of producing "unknown"
 * path results in the terminal log.
 *
 * Consolidated (v1.2): merged the unique safety checks from the now-deleted
 * `tool-hooks.ts` — path-traversal blocking for write_file / read_file /
 * edit_file, and destructive-command blocking for execute_code. This file
 * is now the SINGLE source of truth for pre-execution validation.
 */

import { agentEventBus } from './event-bus'

export interface ValidationResult {
  valid: boolean
  error?: string
  correctedParams?: Record<string, unknown>
  /** Non-blocking warning surfaced to the LLM in the tool result. */
  warning?: string
}

// ── Safety Patterns (ported from tool-hooks.ts) ─────────────────────────────

/**
 * File paths in tool calls MUST be relative to the project workspace root.
 * Absolute paths and `..` traversal escape the workspace sandbox.
 */
function isUnsafePath(filePath: string): boolean {
  return filePath.includes('..') || filePath.startsWith('/')
}

/**
 * Destructive command patterns that should NEVER run, even if requested.
 * These are the hard floor — `execute_code` allowlist checks happen in
 * the chat route's command sanitizer; this list catches the worst cases
 * before subprocess spawn.
 */
const DESTRUCTIVE_COMMAND_PATTERNS: RegExp[] = [
  /rm\s+(-rf?|-fr?)\s+[\/~]/, // rm -rf / or rm -rf ~
  /rm\s+(-rf?|-fr?)\s+\*/, // rm -rf *
  /dd\s+if=.*of=\/dev\//, // dd to device
  />\s*\/dev\/sda/, // write to disk device
  /mkfs\./, // format filesystem
  // Fork bomb — match the canonical :(){...};: form (the bomb defines a function
  // `:` that calls itself twice in a pipeline, then immediately invokes `:`).
  // We don't care what's inside the braces — the `}; :` terminator is the
  // distinctive signature.
  /:\s*\(\s*\)\s*\{[\s\S]*?\}\s*;\s*:/,
  /shutdown/,
  /reboot/,
]

function isDestructiveCommand(command: string): { blocked: boolean; reason?: string } {
  for (const pattern of DESTRUCTIVE_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      return {
        blocked: true,
        reason: `Destructive command pattern matched: ${pattern.source}`,
      }
    }
  }
  return { blocked: false }
}

// ── Public Validation API ───────────────────────────────────────────────────

/**
 * Validate a tool call's parameters before execution.
 *
 * Returns `{ valid: true }` if the call is safe to execute.
 * Returns `{ valid: false, error: "..." }` if the call should be rejected.
 * Returns `{ valid: true, correctedParams: {...} }` if minor corrections were applied.
 * Returns `{ valid: true, warning: "..." }` if the call is valid but suspicious.
 */
export function validateToolCall(
  toolName: string,
  params: Record<string, unknown>,
): ValidationResult {
  if (!toolName || typeof toolName !== 'string') {
    return { valid: false, error: 'Tool name is required and must be a string' }
  }

  switch (toolName) {
    case 'write_file': {
      const path = params.path
      const content = params.content

      // Path validation
      if (path === undefined || path === null) {
        return { valid: false, error: 'write_file requires a "path" parameter — it was missing from your tool call' }
      }
      if (typeof path !== 'string') {
        return { valid: false, error: `write_file "path" must be a string, got ${typeof path}` }
      }
      if (path.trim() === '' || path === 'unknown') {
        return { valid: false, error: `write_file "path" must not be empty or "unknown". Specify a real path like "src/components/Header.tsx".` }
      }

      // Path traversal check (ported from tool-hooks.ts)
      if (isUnsafePath(path)) {
        const msg = `write_file BLOCKED: Path "${path}" contains traversal or absolute path. Use relative paths only.`
        agentEventBus.emit('tool:blocked', {
          toolName,
          toolCallId: 'unknown',
          reason: msg,
        })
        return { valid: false, error: msg }
      }

      // Content validation
      if (content === undefined || content === null) {
        return { valid: false, error: `write_file requires a "content" parameter for file "${path}" — it was missing from your tool call` }
      }

      // Auto-fix: if content is not a string, stringify it
      if (typeof content !== 'string') {
        return {
          valid: true,
          correctedParams: { ...params, content: JSON.stringify(content, null, 2) },
        }
      }

      // Warning: suspiciously short content (likely placeholder)
      if (
        content.trim().length < 10 &&
        !path.endsWith('.gitkeep') &&
        !path.endsWith('.env')
      ) {
        return {
          valid: true,
          warning: `write_file WARNING: File "${path}" has very short content (${content.length} chars). Make sure this is intentional, not a placeholder.`,
        }
      }

      return { valid: true }
    }

    case 'read_file': {
      const path = params.path

      if (path === undefined || path === null) {
        return { valid: false, error: 'read_file requires a "path" parameter — it was missing from your tool call' }
      }
      if (typeof path !== 'string') {
        return { valid: false, error: `read_file "path" must be a string, got ${typeof path}` }
      }
      if (path.trim() === '') {
        return { valid: false, error: 'read_file "path" must not be empty' }
      }

      // Path traversal check (ported from tool-hooks.ts)
      if (isUnsafePath(path)) {
        const msg = `read_file BLOCKED: Path "${path}" contains traversal or absolute path. Use relative paths only.`
        agentEventBus.emit('tool:blocked', {
          toolName,
          toolCallId: 'unknown',
          reason: msg,
        })
        return { valid: false, error: msg }
      }

      return { valid: true }
    }

    case 'edit_file': {
      const path = params.path
      const operations = params.operations

      if (path === undefined || path === null) {
        return { valid: false, error: 'edit_file requires a "path" parameter — it was missing from your tool call' }
      }
      if (typeof path !== 'string') {
        return { valid: false, error: `edit_file "path" must be a string, got ${typeof path}` }
      }
      if (path.trim() === '') {
        return { valid: false, error: 'edit_file "path" must not be empty' }
      }
      // Path traversal check (ported from tool-hooks.ts)
      if (isUnsafePath(path)) {
        const msg = `edit_file BLOCKED: Path "${path}" contains traversal or absolute path. Use relative paths only.`
        agentEventBus.emit('tool:blocked', {
          toolName,
          toolCallId: 'unknown',
          reason: msg,
        })
        return { valid: false, error: msg }
      }
      if (!operations || !Array.isArray(operations) || operations.length === 0) {
        return { valid: false, error: `edit_file requires a non-empty "operations" array for file "${path}"` }
      }

      // Validate each operation has search and replace
      for (let i = 0; i < operations.length; i++) {
        const op = operations[i] as Record<string, unknown>
        if (!op.search || typeof op.search !== 'string') {
          return { valid: false, error: `edit_file operation[${i}] requires a "search" string for file "${path}"` }
        }
        if (op.replace === undefined || op.replace === null) {
          return { valid: false, error: `edit_file operation[${i}] requires a "replace" string for file "${path}"` }
        }
      }

      return { valid: true }
    }

    case 'execute_code': {
      const command = params.command

      if (command === undefined || command === null) {
        return { valid: false, error: 'execute_code requires a "command" parameter — it was missing from your tool call' }
      }
      if (typeof command !== 'string') {
        return { valid: false, error: `execute_code "command" must be a string, got ${typeof command}` }
      }
      if (command.trim() === '') {
        return { valid: false, error: 'execute_code "command" must not be empty' }
      }

      // Destructive command check (ported from tool-hooks.ts)
      const destructive = isDestructiveCommand(command)
      if (destructive.blocked) {
        const msg = `execute_code BLOCKED: Destructive command detected: "${command.substring(0, 100)}". ${destructive.reason}. This command is not allowed for safety reasons.`
        agentEventBus.emit('tool:blocked', {
          toolName,
          toolCallId: 'unknown',
          reason: msg,
        })
        return { valid: false, error: msg }
      }

      return { valid: true }
    }

    case 'list_directory': {
      // path is optional, defaults to '.'
      const path = params.path
      if (path !== undefined && typeof path !== 'string') {
        return { valid: false, error: `list_directory "path" must be a string, got ${typeof path}` }
      }
      if (typeof path === 'string' && path.trim() !== '' && isUnsafePath(path)) {
        const msg = `list_directory BLOCKED: Path "${path}" contains traversal or absolute path. Use relative paths only.`
        return { valid: false, error: msg }
      }
      return { valid: true }
    }

    case 'search_files': {
      const query = params.query || params.pattern
      if (query !== undefined && typeof query !== 'string') {
        return { valid: false, error: `search_files query must be a string, got ${typeof query}` }
      }
      if (typeof query === 'string' && query.trim() === '') {
        return { valid: false, error: 'search_files "query" must not be empty' }
      }
      return { valid: true }
    }

    case 'web_search': {
      const query = params.query

      if (query === undefined || query === null) {
        return { valid: false, error: 'web_search requires a "query" parameter — it was missing from your tool call' }
      }
      if (typeof query !== 'string') {
        return { valid: false, error: `web_search "query" must be a string, got ${typeof query}` }
      }
      if (query.trim() === '') {
        return { valid: false, error: 'web_search "query" must not be empty' }
      }

      return { valid: true }
    }

    case 'think': {
      const thought = params.thought

      if (thought === undefined || thought === null) {
        return { valid: false, error: 'think requires a "thought" parameter — it was missing from your tool call' }
      }
      if (typeof thought !== 'string') {
        return { valid: false, error: `think "thought" must be a string, got ${typeof thought}` }
      }

      return { valid: true }
    }

    case 'store': {
      const key = params.key
      if (!key || typeof key !== 'string') {
        return { valid: false, error: 'store requires a "key" string parameter' }
      }
      return { valid: true }
    }

    case 'retrieve': {
      const key = params.key
      if (!key || typeof key !== 'string') {
        return { valid: false, error: 'retrieve requires a "key" string parameter' }
      }
      return { valid: true }
    }

    default:
      // Unknown tools are allowed — they may be MCP tools
      return { valid: true }
  }
}

/**
 * Validate an array of tool calls in batch.
 * Returns the validated calls (with corrected params) and the rejected ones.
 */
export function validateToolCalls(
  calls: Array<{ id: string; toolName: string; params: Record<string, unknown> }>,
): {
  valid: Array<{ id: string; toolName: string; params: Record<string, unknown> }>
  rejected: Array<{ id: string; toolName: string; params: Record<string, unknown>; error: string }>
} {
  const valid: Array<{ id: string; toolName: string; params: Record<string, unknown> }> = []
  const rejected: Array<{ id: string; toolName: string; params: Record<string, unknown>; error: string }> = []

  for (const call of calls) {
    const result = validateToolCall(call.toolName, call.params)
    if (result.valid) {
      valid.push({
        id: call.id,
        toolName: call.toolName,
        params: result.correctedParams || call.params,
      })
    } else {
      rejected.push({
        id: call.id,
        toolName: call.toolName,
        params: call.params,
        error: result.error || 'Unknown validation error',
      })
    }
  }

  return { valid, rejected }
}
