/**
 * Claude Code-Style Streaming Tool Executor — Production Implementation
 *
 * Mirrors Claude Code v2.1.154 "streaming tool execution is now always enabled"
 * and v2.1.161 "a failed Bash command no longer cancels other calls in the
 * same batch — each tool returns its own result independently."
 *
 * Two key innovations:
 * 1. STREAMING PRODUCER-CONSUMER — tool calls executed AS SOON AS parsed
 * 2. INDEPENDENT FAILURE ISOLATION — failures don't cancel siblings
 */

import { executeToolCall } from './mcp-tools'
import { hookSystem, type ToolCallContext } from './hook-system'
import { checkPermission } from './permissions'
import { agentEventBus } from './event-bus'

// ── Types ────────────────────────────────────────────────────────────────────

export interface StreamingToolCall {
  id: string
  toolName: string
  params: Record<string, unknown>
}

export interface StreamingToolResult {
  id: string
  toolName: string
  success: boolean
  result: unknown
  source?: string
  latencyMs: number
  blockedReason?: string
  permissionDecision?: 'allow' | 'ask' | 'deny'
}

export interface ExecutionOptions {
  sessionId?: string
  projectId?: string
  iteration?: number
  maxConcurrency?: number
  skipPermissions?: boolean
  skipHooks?: boolean
}

// ── Streaming Execution ────────────────────────────────────────────────────

export async function* streamToolExecution(
  calls: StreamingToolCall[],
  options: ExecutionOptions = {},
): AsyncGenerator<StreamingToolResult, void, void> {
  if (calls.length === 0) return
  const maxConcurrency = Math.max(1, options.maxConcurrency ?? 5)

  interface TrackedPromise {
    promise: Promise<StreamingToolResult>
    done: boolean
  }

  const tracked: TrackedPromise[] = calls.map((call) => {
    const state: TrackedPromise = { promise: null as unknown as Promise<StreamingToolResult>, done: false }
    state.promise = executeOneWithHooks(call, options).then((result) => {
      state.done = true
      return result
    })
    return state
  })

  let nextIdx = 0
  const inFlight = new Set<TrackedPromise>()

  while (nextIdx < tracked.length && inFlight.size < maxConcurrency) {
    inFlight.add(tracked[nextIdx++])
  }

  while (inFlight.size > 0) {
    await Promise.race([...inFlight].map((t) => t.promise))
    await new Promise((r) => setTimeout(r, 0))
    const completed: TrackedPromise[] = []
    for (const t of inFlight) {
      if (t.done) completed.push(t)
    }
    for (const t of completed) {
      inFlight.delete(t)
      yield await t.promise
      if (nextIdx < tracked.length) {
        inFlight.add(tracked[nextIdx++])
      }
    }
  }
}

async function executeOneWithHooks(
  call: StreamingToolCall,
  options: ExecutionOptions,
): Promise<StreamingToolResult> {
  const startTime = Date.now()
  const ctx: ToolCallContext = {
    toolName: call.toolName,
    toolInput: { ...call.params },
    toolCallId: call.id,
    sessionId: options.sessionId,
    projectId: options.projectId,
    iteration: options.iteration,
  }
  let permissionDecision: 'allow' | 'ask' | 'deny' | undefined

  // 1. PreToolUse hook
  if (!options.skipHooks) {
    try {
      const preDecision = await hookSystem.firePreToolUse(ctx)
      if (preDecision.decision === 'deny') {
        const blocked = preDecision.reason || 'blocked by PreToolUse hook'
        agentEventBus.emit('tool:blocked-hook', {
          toolName: call.toolName,
          reason: blocked,
          hookId: 'pre-tool-use',
          sessionId: options.sessionId,
        })
        return {
          id: call.id,
          toolName: call.toolName,
          success: false,
          result: { error: blocked, blocked: true },
          latencyMs: Date.now() - startTime,
          blockedReason: blocked,
        }
      }
      if (preDecision.modifiedInput) {
        call = { ...call, params: { ...call.params, ...preDecision.modifiedInput } }
        ctx.toolInput = { ...call.params }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`[ToolExecutor] PreToolUse hook error for ${call.toolName}:`, errMsg)
    }
  }

  // 2. Permission check
  if (!options.skipPermissions) {
    try {
      const perm = await checkPermission({
        toolName: call.toolName,
        toolInput: call.params,
      })
      if (perm.decision === 'deny') {
        const blocked = perm.reason || `denied by permission rule: ${perm.matchedPattern}`
        return {
          id: call.id,
          toolName: call.toolName,
          success: false,
          result: { error: blocked, blocked: true, permissionDenied: true },
          latencyMs: Date.now() - startTime,
          blockedReason: blocked,
          permissionDecision: 'deny',
        }
      }
      permissionDecision = perm.decision
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`[ToolExecutor] Permission check error for ${call.toolName}:`, errMsg)
    }
  }

  // 3. Actual tool dispatch
  let result: { success: boolean; result: unknown; source?: string }
  try {
    result = await executeToolCall(call.toolName, call.params)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    result = {
      success: false,
      result: { error: errMsg, crashed: true },
      source: 'tool-executor-catch',
    }
    agentEventBus.emit('tool:error', {
      toolName: call.toolName,
      error: errMsg,
      source: 'tool-executor',
    })
  }

  const latencyMs = Date.now() - startTime

  // 4. PostToolUse hook
  if (!options.skipHooks) {
    try {
      const postCtx = { ...ctx, toolResult: result.result, success: result.success }
      const postDecision = await hookSystem.firePostToolUse(postCtx)
      if (postDecision.systemMessage) {
        result = {
          ...result,
          result: {
            ...(result.result as object),
            _hookWarning: postDecision.systemMessage,
          },
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`[ToolExecutor] PostToolUse hook error for ${call.toolName}:`, errMsg)
    }
  }

  return {
    id: call.id,
    toolName: call.toolName,
    success: result.success,
    result: result.result,
    source: result.source,
    latencyMs,
    permissionDecision,
  }
}

// ── Non-streaming Variant ────────────────────────────────────────────────────

export async function executeWithFailureIsolation(
  calls: StreamingToolCall[],
  options: ExecutionOptions = {},
): Promise<StreamingToolResult[]> {
  const results: StreamingToolResult[] = []
  for await (const result of streamToolExecution(calls, options)) {
    results.push(result)
  }
  return results
}

export async function executeSerially(
  calls: StreamingToolCall[],
  options: ExecutionOptions = {},
): Promise<StreamingToolResult[]> {
  const results: StreamingToolResult[] = []
  for (const call of calls) {
    const result = await executeOneWithHooks(call, options)
    results.push(result)
  }
  return results
}

// ── Streaming from LLM Response ──────────────────────────────────────────────

export async function* streamToolExecutionFromLLM(
  llmStream: AsyncIterable<string>,
  options: ExecutionOptions & {
    parseToolCalls?: (text: string) => StreamingToolCall[]
  } = {},
): AsyncGenerator<
  | { type: 'text'; chunk: string }
  | { type: 'tool_result'; result: StreamingToolResult },
  void,
  void
> {
  const parseToolCalls = options.parseToolCalls || defaultToolCallParser
  let buffer = ''
  let lastParsedLength = 0
  const executedIds = new Set<string>()
  const pendingBatches: StreamingToolCall[][] = []

  for await (const chunk of llmStream) {
    buffer += chunk
    yield { type: 'text', chunk }
    if (buffer.length - lastParsedLength > 50) {
      lastParsedLength = buffer.length
      const calls = parseToolCalls(buffer)
      const newCalls = calls.filter((c) => !executedIds.has(c.id))
      if (newCalls.length > 0) {
        for (const c of newCalls) executedIds.add(c.id)
        pendingBatches.push(newCalls)
      }
    }
  }
  const finalCalls = parseToolCalls(buffer)
  const newFinal = finalCalls.filter((c) => !executedIds.has(c.id))
  if (newFinal.length > 0) {
    pendingBatches.push(newFinal)
  }
  for (const batch of pendingBatches) {
    for await (const result of streamToolExecution(batch, options)) {
      yield { type: 'tool_result', result }
    }
  }
}

function defaultToolCallParser(text: string): StreamingToolCall[] {
  const calls: StreamingToolCall[] = []
  const re = /\[TOOL_CALL\]\s+(\w+)\((\{[\s\S]*?\})\)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const toolName = match[1]
    try {
      const params = JSON.parse(match[2])
      const id = `tc_${calls.length}_${Date.now()}`
      calls.push({ id, toolName, params })
    } catch { /* Skip malformed */ }
  }
  return calls
}