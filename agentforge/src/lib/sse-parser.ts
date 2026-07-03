/**
 * SSE Parser — Frontend incremental SSE event parser
 *
 * Parses a raw text stream (from fetch response.body.getReader())
 * into structured SSE events. Handles:
 *
 * 1. New SSE format: `event: <type>\ndata: <json>\n\n`
 * 2. Legacy format: Raw text with inline markers (backward compat)
 *
 * Usage:
 *   const parser = new SSEParser()
 *   // On each chunk:
 *   const events = parser.parse(chunk)
 *   for (const event of events) {
 *     handleEvent(event)
 *   }
 */

import type { SSEEventType, SSEEventDataMap } from './sse-types'

// ── Parsed SSE Event ──────────────────────────────────────────────────────────

export interface ParsedSSEEvent {
  event: SSEEventType
  data: unknown
  /** If true, this was parsed from legacy format, not proper SSE */
  legacy?: boolean
}

// ── SSE Parser ────────────────────────────────────────────────────────────────

export class SSEParser {
  private buffer: string = ''
  private isSSE: boolean | null = null  // null = not yet detected

  /**
   * Parse a chunk of text from the stream.
   * Returns an array of parsed events.
   */
  parse(chunk: string): ParsedSSEEvent[] {
    this.buffer += chunk
    const events: ParsedSSEEvent[] = []

    // Auto-detect format on first chunk
    if (this.isSSE === null) {
      this.isSSE = this.detectFormat(this.buffer)
    }

    if (this.isSSE) {
      // Parse SSE format
      events.push(...this.parseSSE())
    } else {
      // Parse legacy format
      events.push(...this.parseLegacy())
    }

    return events
  }

  /**
   * Detect whether the stream is SSE or legacy format.
   * SSE streams always start with `event:` prefix.
   */
  private detectFormat(text: string): boolean {
    const trimmed = text.trimStart()
    return trimmed.startsWith('event:')
  }

  /**
   * Parse proper SSE format: `event: <type>\ndata: <json>\n\n`
   */
  private parseSSE(): ParsedSSEEvent[] {
    const events: ParsedSSEEvent[] = []

    while (true) {
      // Find the end of the next SSE message (double newline)
      const endIndex = this.buffer.indexOf('\n\n')
      if (endIndex === -1) break  // Incomplete message — wait for more data

      const message = this.buffer.substring(0, endIndex)
      this.buffer = this.buffer.substring(endIndex + 2)

      // Parse event type and data
      let eventType: string = 'message'
      let dataStr: string = ''

      for (const line of message.split('\n')) {
        if (line.startsWith('event:')) {
          eventType = line.substring(6).trim()
        } else if (line.startsWith('data:')) {
          dataStr = line.substring(5).trim()
        }
        // Ignore comments (lines starting with ':') and other fields
      }

      if (eventType && dataStr) {
        try {
          const data = JSON.parse(dataStr)
          events.push({
            event: eventType as SSEEventType,
            data,
            legacy: false,
          })
        } catch {
          // If JSON parsing fails, emit as content
          events.push({
            event: 'content',
            data: { text: dataStr, iteration: 0 },
            legacy: false,
          })
        }
      }
    }

    return events
  }

  /**
   * Parse legacy format — raw text with inline markers.
   * Converts them to the same SSE event structure for unified handling.
   */
  private parseLegacy(): ParsedSSEEvent[] {
    const events: ParsedSSEEvent[] = []
    let remaining = this.buffer

    // ── Parse [TERMINAL] markers ──────────────────────────────────────────
    const terminalRegex = /\[TERMINAL\]\s+(\w+)\s+(.+)/g
    let match: RegExpExecArray | null
    while ((match = terminalRegex.exec(remaining)) !== null) {
      events.push({
        event: 'terminal',
        data: {
          level: match[1] as 'info' | 'success' | 'warn' | 'error',
          source: 'AGENT',
          message: match[2],
        },
        legacy: true,
      })
    }
    remaining = remaining.replace(/\[TERMINAL\]\s+\w+\s+.+/g, '')

    // ── Parse [THINKING], [CODING], etc. ─────────────────────────────────
    const statusMap: Record<string, string> = {
      '[THINKING]': 'thinking',
      '[CODING]': 'coding',
      '[EXECUTING]': 'executing',
      '[PREVIEWING]': 'previewing',
      '[ERROR]': 'error',
    }
    for (const [marker, status] of Object.entries(statusMap)) {
      if (remaining.includes(marker)) {
        events.push({ event: 'status', data: { status }, legacy: true })
        remaining = remaining.replace(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '')
      }
    }

    // ── Parse __FILE_WRITTEN__ markers ────────────────────────────────────
    const fileWrittenRegex = /__FILE_WRITTEN__(.+?)__END_FILE_WRITTEN__/g
    while ((match = fileWrittenRegex.exec(remaining)) !== null) {
      try {
        const fileData = JSON.parse(match[1])
        events.push({
          event: 'file_written',
          data: {
            path: String(fileData.path || ''),
            content: String(fileData.content || ''),
            language: String(fileData.language || 'text'),
            bytesWritten: Number(fileData.bytesWritten || 0),
          },
          legacy: true,
        })
      } catch { /* skip */ }
    }
    remaining = remaining.replace(/__FILE_WRITTEN__.+?__END_FILE_WRITTEN__/g, '')

    // ── Parse __PLAN_UPDATE__ markers ─────────────────────────────────────
    const planRegex = /__PLAN_UPDATE__(.+?)__END_PLAN_UPDATE__/g
    while ((match = planRegex.exec(remaining)) !== null) {
      try {
        const steps = JSON.parse(match[1])
        events.push({ event: 'plan_update', data: { steps }, legacy: true })
      } catch { /* skip */ }
    }
    remaining = remaining.replace(/__PLAN_UPDATE__.+?__END_PLAN_UPDATE__/g, '')

    // ── Parse __SWITCH_TAB__ markers ──────────────────────────────────────
    const switchTabRegex = /__SWITCH_TAB__:(\w+)/g
    while ((match = switchTabRegex.exec(remaining)) !== null) {
      events.push({
        event: 'switch_tab',
        data: { tab: match[1] as 'preview' | 'code' | 'files' },
        legacy: true,
      })
    }
    remaining = remaining.replace(/__SWITCH_TAB__:\w+/g, '')

    // ── Parse __METADATA__ markers ────────────────────────────────────────
    const metadataRegex = /__METADATA__(.+?)__END_METADATA__/g
    while ((match = metadataRegex.exec(remaining)) !== null) {
      try {
        const meta = JSON.parse(match[1])
        events.push({ event: 'metadata', data: meta, legacy: true })
      } catch { /* skip */ }
    }
    remaining = remaining.replace(/__METADATA__.+?__END_METADATA__/g, '')

    // ── Parse [TOOL_CALL] markers ─────────────────────────────────────────
    const toolCallRegex = /\[TOOL_CALL\]\s+(\w+)\((\{[\s\S]*?\})\)/g
    while ((match = toolCallRegex.exec(remaining)) !== null) {
      try {
        const toolName = match[1]
        const params = JSON.parse(match[2])
        events.push({
          event: 'tool_call',
          data: { id: `legacy_${Date.now()}`, name: toolName, params, iteration: 0 },
          legacy: true,
        })
      } catch { /* skip */ }
    }
    remaining = remaining.replace(/\[TOOL_CALL\]\s+\w+\(\{[\s\S]*?\}\)/g, '')

    // ── Parse [TOOL_RESULT] markers ───────────────────────────────────────
    const toolResultRegex = /\[TOOL_RESULT\]\s+(\w+)\n([\s\S]*?)(?=\[TOOL_|__|$)/g
    while ((match = toolResultRegex.exec(remaining)) !== null) {
      events.push({
        event: 'tool_result',
        data: {
          id: `legacy_${Date.now()}`,
          name: match[1],
          result: match[2],
          success: true,
        },
        legacy: true,
      })
    }

    // ── Parse think tool JSON ─────────────────────────────────────────────
    const thinkRegex = /\{"thought":\s*\{"thought":\s*"([\s\S]*?)"\}\s*,\s*"note":\s*"[^"]*"\}/g
    while ((match = thinkRegex.exec(remaining)) !== null) {
      events.push({
        event: 'reasoning',
        data: {
          thought: match[1].replace(/\\n/g, '\n'),
          planSteps: [],
          timestamp: Date.now(),
        },
        legacy: true,
      })
    }

    // ── Remaining text → content event ────────────────────────────────────
    const cleanText = remaining
      .replace(/\[TOOL_CALL\][\s\S]*?\}\)/g, '')
      .replace(/\[TOOL_RESULT\][\s\S]*?(?=\[|__|$)/g, '')
      .replace(/\{"thought":[\s\S]*?"note":[\s\S]*?\}/g, '')
      .trim()

    if (cleanText) {
      events.push({
        event: 'content',
        data: { text: cleanText, iteration: 0 },
        legacy: true,
      })
    }

    // Keep the buffer clear after processing legacy format
    this.buffer = ''

    return events
  }

  /**
   * Reset the parser state.
   */
  reset(): void {
    this.buffer = ''
    this.isSSE = null
  }
}
