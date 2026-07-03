/**
 * SSE Event Types — Z AI-Style Structured Streaming
 *
 * Defines all SSE event types and their data shapes for the
 * AgentForge streaming protocol. Every SSE message follows:
 *
 *   event: <type>\ndata: <json>\n\n
 *
 * This replaces the old raw text markers:
 *   - [THINKING], [CODING], etc.    → event: status
 *   - Raw LLM text                  → event: content
 *   - {"thought":...}               → event: reasoning
 *   - __PLAN_UPDATE__...__END__     → event: plan_update
 *   - [TOOL_CALL] name({...})       → event: tool_call
 *   - [TOOL_RESULT] name\n{...}     → event: tool_result
 *   - __FILE_WRITTEN__...__END__    → event: file_written
 *   - __SWITCH_TAB__:preview        → event: switch_tab
 *   - [TERMINAL] level [AGENT] msg  → event: terminal
 *   - [ERROR] ...                   → event: error
 *   - __METADATA__...__END__        → event: metadata
 */

// ── Plan Step ─────────────────────────────────────────────────────────────────

export interface PlanStep {
  step: number
  text: string
  output: string
  test: string
  done: boolean
}

// ── Agent Status ──────────────────────────────────────────────────────────────

export type AgentStatus = 'idle' | 'thinking' | 'coding' | 'executing' | 'previewing' | 'error'

// ── SSE Event Data Shapes ─────────────────────────────────────────────────────

export interface SSEStatusEvent {
  status: AgentStatus
  message?: string
}

export interface SSEContentEvent {
  text: string
  iteration: number
}

export interface SSEReasoningEvent {
  thought: string
  planSteps: PlanStep[]
  timestamp: number
}

export interface SSEPlanUpdateEvent {
  steps: PlanStep[]
}

export interface SSETodoUpdateEvent {
  todos: Array<{
    text: string
    done: boolean
    filePath?: string
    priority?: string
  }>
}

export interface SSEToolCallEvent {
  id: string
  name: string
  params: Record<string, unknown>
  iteration: number
}

export interface SSEToolResultEvent {
  id: string
  name: string
  result: unknown
  success: boolean
  duration?: number
}

export interface SSEFileWrittenEvent {
  path: string
  content: string
  language: string
  bytesWritten: number
}

export interface SSESwitchTabEvent {
  tab: 'preview' | 'code' | 'files'
}

export interface SSETerminalEvent {
  level: 'info' | 'success' | 'warn' | 'error'
  source: 'AGENT' | 'SYSTEM'
  message: string
}

export interface SSEValidationErrorEvent {
  toolName: string
  error: string
}

export interface SSEMetadataEvent {
  type?: string
  files?: Record<string, string>
  fileCount?: number
  sessionId?: string
  model?: string
  provider?: string
  iteration?: number
  totalIterations?: number
  filesWritten?: number
  tokensUsed?: number
}

export interface SSEErrorEvent {
  message: string
  code?: string
  provider?: string
}

export interface SSEDoneEvent {
  reason: 'complete' | 'error' | 'stopped' | 'rate_limited'
  totalIterations: number
  filesWritten: number
  tokensUsed?: number
}

// ── Union Type ────────────────────────────────────────────────────────────────

export type SSEEventType =
  | 'status'
  | 'content'
  | 'reasoning'
  | 'plan_update'
  | 'todo_update'
  | 'tool_call'
  | 'tool_result'
  | 'file_written'
  | 'switch_tab'
  | 'terminal'
  | 'validation_error'
  | 'metadata'
  | 'error'
  | 'done'

export interface SSEEvent {
  event: SSEEventType
  data: unknown
}

// ── Event Data Map ────────────────────────────────────────────────────────────

export interface SSEEventDataMap {
  status: SSEStatusEvent
  content: SSEContentEvent
  reasoning: SSEReasoningEvent
  plan_update: SSEPlanUpdateEvent
  todo_update: SSETodoUpdateEvent
  tool_call: SSEToolCallEvent
  tool_result: SSEToolResultEvent
  file_written: SSEFileWrittenEvent
  switch_tab: SSESwitchTabEvent
  terminal: SSETerminalEvent
  validation_error: SSEValidationErrorEvent
  metadata: SSEMetadataEvent
  error: SSEErrorEvent
  done: SSEDoneEvent
}
