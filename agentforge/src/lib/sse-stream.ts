/**
 * SSE Stream Writer — Backend helper for writing Z AI-style SSE events
 *
 * Usage in route.ts:
 *   const sse = new SSEStreamWriter(controller, encoder)
 *   sse.status('thinking')
 *   sse.content('Hello world')
 *   sse.toolCall('call_1', 'write_file', { path: 'index.html', content: '...' }, 1)
 *   sse.fileWritten('index.html', content, 'html', 5000)
 *   sse.done('complete', 5, 3)
 */

import { TextEncoder } from 'util'
import type {
  AgentStatus,
  PlanStep,
  SSEContentEvent,
  SSEDoneEvent,
  SSEErrorEvent,
  SSEFileWrittenEvent,
  SSEMetadataEvent,
  SSEPlanUpdateEvent,
  SSEReasoningEvent,
  SSEStatusEvent,
  SSESwitchTabEvent,
  SSETerminalEvent,
  SSETodoUpdateEvent,
  SSEToolCallEvent,
  SSEToolResultEvent,
  SSEValidationErrorEvent,
} from './sse-types'

export class SSEStreamWriter {
  private controller: ReadableStreamDefaultController
  private encoder: TextEncoder
  private iteration: number = 0

  constructor(controller: ReadableStreamDefaultController, encoder?: TextEncoder) {
    this.controller = controller
    this.encoder = encoder || new TextEncoder()
  }

  setIteration(n: number): void {
    this.iteration = n
  }

  /**
   * Write a raw SSE event to the stream.
   * Format: `event: <type>\ndata: <json>\n\n`
   */
  private write(eventType: string, data: unknown): void {
    const json = JSON.stringify(data)
    const message = `event: ${eventType}\ndata: ${json}\n\n`
    try {
      this.controller.enqueue(this.encoder.encode(message))
    } catch (e) {
      // Stream may be closed — ignore
    }
  }

  // ── Convenience Methods ────────────────────────────────────────────────────

  /** Agent status change (thinking, coding, executing, etc.) */
  status(status: AgentStatus, message?: string): void {
    const data: SSEStatusEvent = { status, message }
    this.write('status', data)
  }

  /** LLM text content chunk */
  content(text: string): void {
    const data: SSEContentEvent = { text, iteration: this.iteration }
    this.write('content', data)
  }

  /** Think/reasoning tool output */
  reasoning(thought: string, planSteps?: PlanStep[]): void {
    const data: SSEReasoningEvent = {
      thought,
      planSteps: planSteps || [],
      timestamp: Date.now(),
    }
    this.write('reasoning', data)
  }

  /** Plan step progress update */
  planUpdate(steps: PlanStep[]): void {
    const data: SSEPlanUpdateEvent = { steps }
    this.write('plan_update', data)
  }

  /** Todo list update (auto-generated from file writes when LLM skips think) */
  todoUpdate(todos: SSETodoUpdateEvent['todos']): void {
    const data: SSETodoUpdateEvent = { todos }
    this.write('todo_update', data)
  }

  /** Tool call started */
  toolCall(id: string, name: string, params: Record<string, unknown>): void {
    const data: SSEToolCallEvent = { id, name, params, iteration: this.iteration }
    this.write('tool_call', data)
  }

  /** Tool execution result */
  toolResult(id: string, name: string, result: unknown, success: boolean, duration?: number): void {
    const data: SSEToolResultEvent = { id, name, result, success, duration }
    this.write('tool_result', data)
  }

  /** File created/updated event */
  fileWritten(filePath: string, content: string, language: string, bytesWritten: number): void {
    const data: SSEFileWrittenEvent = {
      path: filePath,
      content,
      language,
      bytesWritten,
    }
    this.write('file_written', data)
  }

  /** Tab switch command */
  switchTab(tab: 'preview' | 'code' | 'files'): void {
    const data: SSESwitchTabEvent = { tab }
    this.write('switch_tab', data)
  }

  /** Terminal output line */
  terminal(level: 'info' | 'success' | 'warn' | 'error', message: string, source: 'AGENT' | 'SYSTEM' = 'AGENT'): void {
    const data: SSETerminalEvent = { level, source, message }
    this.write('terminal', data)
  }

  /** Validation error for a tool call */
  validationError(toolName: string, error: string): void {
    const data: SSEValidationErrorEvent = { toolName, error }
    this.write('validation_error', data)
  }

  /** Session metadata */
  metadata(meta: SSEMetadataEvent): void {
    this.write('metadata', meta)
  }

  /** Error event */
  error(message: string, code?: string, provider?: string): void {
    const data: SSEErrorEvent = { message, code, provider }
    this.write('error', data)
  }

  /** Stream complete */
  done(reason: 'complete' | 'error' | 'stopped' | 'rate_limited', totalIterations: number, filesWritten: number, tokensUsed?: number): void {
    const data: SSEDoneEvent = { reason, totalIterations, filesWritten, tokensUsed }
    this.write('done', data)
  }
}
