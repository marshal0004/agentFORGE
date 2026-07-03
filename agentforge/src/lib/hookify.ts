/**
 * Claude Code-Style Hookify — User-Defined Rules via Markdown
 *
 * Mirrors Claude Code's hookify plugin: users create .agentforge/hookify.*.local.md
 * files with YAML frontmatter that define rules for blocking, warning, or
 * allowing tool calls.
 *
 * Example rule file (.agentforge/hookify.no-console-log.local.md):
 *   ---
 *   name: block-console-log
 *   enabled: true
 *   event: file
 *   pattern: console\.log\(
 *   action: warn
 *   ---
 *   ⚠️ console.log detected! Use proper logging instead.
 *
 * Example (.agentforge/hookify.require-tests-stop.local.md):
 *   ---
 *   name: require-tests-run
 *   enabled: true
 *   event: stop
 *   action: block
 *   conditions:
 *     - field: transcript
 *       operator: not_contains
 *       pattern: npm test|vitest|jest
 *   ---
 *   **Tests not detected in transcript!**
 *   Before stopping, run tests to verify your changes work correctly.
 *
 * Integration:
 *   - On startup, loadAllRules() scans .agentforge/ for hookify.*.local.md files
 *   - Each rule is registered as a hook in hook-system.ts:
 *       event: bash  → PreToolUse matcher "execute_code|Bash"
 *       event: file  → PreToolUse matcher "write_file|edit_file|Write|Edit"
 *       event: stop  → Stop hook
 *   - The hook's handler evaluates the rule's conditions and returns
 *     decision=deny (for action: block) or systemMessage (for action: warn)
 */

import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { hookSystem } from './hook-system'
import { agentEventBus } from './event-bus'

// ── Types ────────────────────────────────────────────────────────────────────

export type HookifyEvent = 'bash' | 'file' | 'stop' | 'all'

export type HookifyAction = 'block' | 'warn' | 'allow'

export type HookifyOperator =
  | 'regex_match'
  | 'contains'
  | 'not_contains'
  | 'equals'
  | 'starts_with'
  | 'ends_with'

export interface HookifyCondition {
  field: string // "command", "new_text", "old_text", "file_path", "content", "transcript", "reason"
  operator: HookifyOperator
  pattern: string
}

export interface HookifyRule {
  /** Unique rule name (from frontmatter) */
  name: string
  /** Whether the rule is enabled (from frontmatter) */
  enabled: boolean
  /** Which event this rule fires on (from frontmatter) */
  event: HookifyEvent
  /** Simple pattern (legacy) — converted to a single condition */
  pattern?: string
  /** Complex conditions (new style) */
  conditions: HookifyCondition[]
  /** What to do when the rule matches */
  action: HookifyAction
  /** Tool matcher override (rare) */
  toolMatcher?: string
  /** Message body (markdown after frontmatter) */
  message: string
  /** File path the rule was loaded from */
  sourceFile: string
}

// ── Frontmatter Parser ──────────────────────────────────────────────────────

/**
 * Parse YAML frontmatter and message body from a .local.md file.
 *
 * Format:
 *   ---
 *   key: value
 *   key: value
 *   ---
 *   Message body (markdown)
 *
 * Supports:
 *   - Simple key: value pairs
 *   - Inline lists (key: [a, b, c])
 *   - Block lists (- item)
 *   - Multi-key dict items in lists (- field: x, operator: y, pattern: z)
 *   - Quoted strings
 */
export function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>
  message: string
} {
  if (!content.startsWith('---')) {
    return { frontmatter: {}, message: content.trim() }
  }

  const parts = content.split(/^---\s*$/m)
  if (parts.length < 3) {
    return { frontmatter: {}, message: content.trim() }
  }

  const frontmatterText = parts[1]
  const message = parts.slice(2).join('---').trim()

  const frontmatter = parseSimpleYaml(frontmatterText)
  return { frontmatter, message }
}

/**
 * Tiny YAML parser that handles the subset used by hookify rules.
 * Not a full YAML parser — just enough for our frontmatter format.
 */
function parseSimpleYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const lines = text.split('\n')

  let currentKey: string | null = null
  let currentList: unknown[] = []
  let currentDict: Record<string, string> | null = null
  let inList = false

  const saveList = () => {
    if (currentKey && inList) {
      result[currentKey] = currentList
    }
    currentKey = null
    currentList = []
    currentDict = null
    inList = false
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const indent = line.length - line.trimStart().length

    // Top-level key
    if (indent === 0 && trimmed.includes(':') && !trimmed.startsWith('-')) {
      saveList()

      const colonIdx = trimmed.indexOf(':')
      const key = trimmed.slice(0, colonIdx).trim()
      const value = trimmed.slice(colonIdx + 1).trim()

      if (!value) {
        currentKey = key
        inList = true
        currentList = []
      } else {
        result[key] = parseScalar(value)
      }
      continue
    }

    // List item
    if (trimmed.startsWith('-') && inList) {
      // Save previous dict if any
      if (currentDict) {
        currentList.push(currentDict)
        currentDict = null
      }

      const itemText = trimmed.slice(1).trim()

      // Check for comma-separated dict: "- field: command, operator: regex_match"
      if (itemText.includes(':') && itemText.includes(',')) {
        const dict: Record<string, string> = {}
        for (const part of itemText.split(',')) {
          const colonIdx = part.indexOf(':')
          if (colonIdx > 0) {
            const k = part.slice(0, colonIdx).trim()
            const v = part.slice(colonIdx + 1).trim()
            dict[k] = parseScalar(v) as string
          }
        }
        currentList.push(dict)
      } else if (itemText.includes(':')) {
        // Multi-line dict item: "- field: command"
        const colonIdx = itemText.indexOf(':')
        const k = itemText.slice(0, colonIdx).trim()
        const v = itemText.slice(colonIdx + 1).trim()
        currentDict = { [k]: parseScalar(v) as string }
      } else {
        currentList.push(parseScalar(itemText))
      }
      continue
    }

    // Continuation of dict item (indented under a list item)
    if (indent > 2 && currentDict && trimmed.includes(':')) {
      const colonIdx = trimmed.indexOf(':')
      const k = trimmed.slice(0, colonIdx).trim()
      const v = trimmed.slice(colonIdx + 1).trim()
      currentDict[k] = parseScalar(v) as string
      continue
    }
  }

  // Save final list
  if (currentDict) {
    currentList.push(currentDict)
  }
  saveList()

  return result
}

/**
 * Parse a scalar value (string, bool, number).
 */
function parseScalar(value: string): string | boolean | number {
  const trimmed = value.trim().replace(/^["']|["']$/g, '')

  if (trimmed.toLowerCase() === 'true') return true
  if (trimmed.toLowerCase() === 'false') return false
  if (trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === '~') return ''

  // Try number
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed)
  }

  return trimmed
}

// ── Rule Construction ───────────────────────────────────────────────────────

/**
 * Build a HookifyRule from parsed frontmatter + message body.
 */
export function buildRule(
  frontmatter: Record<string, unknown>,
  message: string,
  sourceFile: string,
): HookifyRule | null {
  const name = String(frontmatter.name || 'unnamed')
  const enabled = frontmatter.enabled !== false
  const event = String(frontmatter.event || 'all') as HookifyEvent
  const action = String(frontmatter.action || 'warn') as HookifyAction
  const toolMatcher = frontmatter.tool_matcher
    ? String(frontmatter.tool_matcher)
    : undefined
  const simplePattern = frontmatter.pattern ? String(frontmatter.pattern) : undefined

  // Build conditions list
  const conditions: HookifyCondition[] = []
  const rawConditions = frontmatter.conditions

  if (Array.isArray(rawConditions)) {
    for (const c of rawConditions) {
      if (c && typeof c === 'object') {
        const cond = c as Record<string, string>
        conditions.push({
          field: String(cond.field || 'command'),
          operator: String(cond.operator || 'regex_match') as HookifyOperator,
          pattern: String(cond.pattern || ''),
        })
      }
    }
  }

  // Legacy: simple pattern → single condition
  if (simplePattern && conditions.length === 0) {
    let field = 'content'
    if (event === 'bash') field = 'command'
    else if (event === 'file') field = 'new_text'
    conditions.push({
      field,
      operator: 'regex_match',
      pattern: simplePattern,
    })
  }

  if (conditions.length === 0) {
    // A rule with no conditions can't match anything — skip
    return null
  }

  return {
    name,
    enabled,
    event,
    pattern: simplePattern,
    conditions,
    action,
    toolMatcher,
    message,
    sourceFile,
  }
}

// ── Rule Loading ────────────────────────────────────────────────────────────

/**
 * Load all hookify rules from .agentforge/hookify.*.local.md files.
 *
 * Searches two locations:
 *   1. .agentforge/ in the current working directory (project-scoped)
 *   2. ~/.agentforge/ in the user's home directory (user-scoped)
 */
export async function loadAllRules(): Promise<HookifyRule[]> {
  const searchDirs = [
    path.join(process.cwd(), '.agentforge'),
    path.join(os.homedir(), '.agentforge'),
  ]

  const allRules: HookifyRule[] = []

  for (const dir of searchDirs) {
    try {
      const files = await fs.readdir(dir)
      const mdFiles = files.filter(
        (f) => f.startsWith('hookify.') && f.endsWith('.local.md'),
      )

      for (const file of mdFiles) {
        const filePath = path.join(dir, file)
        try {
          const rule = await loadRuleFile(filePath)
          if (rule && rule.enabled) {
            allRules.push(rule)
          }
        } catch (err) {
          console.warn(`[Hookify] Failed to load ${filePath}:`, (err as Error).message)
        }
      }
    } catch (err) {
      const errCode = (err as { code?: string }).code
      if (errCode !== 'ENOENT') {
        console.warn(`[Hookify] Failed to read ${dir}:`, (err as Error).message)
      }
    }
  }

  return allRules
}

/**
 * Load a single rule file.
 */
export async function loadRuleFile(filePath: string): Promise<HookifyRule | null> {
  const content = await fs.readFile(filePath, 'utf-8')
  const { frontmatter, message } = parseFrontmatter(content)

  if (Object.keys(frontmatter).length === 0) {
    return null
  }

  return buildRule(frontmatter, message, filePath)
}

// ── Rule Evaluation ─────────────────────────────────────────────────────────

/**
 * Evaluate a single rule against input data.
 *
 * @param rule The rule to evaluate
 * @param input The hook input (tool_name, tool_input, transcript, etc.)
 * @returns true if ALL conditions match
 */
export function evaluateRule(
  rule: HookifyRule,
  input: {
    toolName?: string
    toolInput?: Record<string, unknown>
    transcript?: string
    reason?: string
    userPrompt?: string
    [key: string]: unknown
  },
): boolean {
  // Check tool matcher if specified
  if (rule.toolMatcher && rule.toolMatcher !== '*') {
    const patterns = rule.toolMatcher.split('|').map((p) => p.trim())
    const toolName = input.toolName || ''
    if (!patterns.includes(toolName)) return false
  }

  // All conditions must match
  for (const cond of rule.conditions) {
    const fieldValue = extractField(cond.field, input)
    if (fieldValue === null) return false

    if (!checkCondition(cond.operator, cond.pattern, fieldValue)) {
      return false
    }
  }

  return true
}

/**
 * Extract a field value from the input data.
 */
function extractField(
  field: string,
  input: {
    toolName?: string
    toolInput?: Record<string, unknown>
    transcript?: string
    reason?: string
    userPrompt?: string
    [key: string]: unknown
  },
): string | null {
  // Direct tool_input fields
  if (input.toolInput && field in input.toolInput) {
    const value = input.toolInput[field]
    if (typeof value === 'string') return value
    return String(value ?? '')
  }

  // Special fields
  switch (field) {
    case 'transcript':
      return input.transcript || ''
    case 'reason':
      return input.reason || ''
    case 'user_prompt':
      return input.userPrompt || ''
    case 'command':
      // For Bash/execute_code
      if (input.toolInput?.command) return String(input.toolInput.command)
      return ''
    case 'content':
    case 'new_text':
    case 'new_string':
      if (input.toolInput?.content) return String(input.toolInput.content)
      if (input.toolInput?.new_string) return String(input.toolInput.new_string)
      return ''
    case 'old_text':
    case 'old_string':
      if (input.toolInput?.old_string) return String(input.toolInput.old_string)
      return ''
    case 'file_path':
    case 'path':
      if (input.toolInput?.path) return String(input.toolInput.path)
      if (input.toolInput?.file_path) return String(input.toolInput.file_path)
      return ''
    default:
      return null
  }
}

/**
 * Check a single condition against a field value.
 */
function checkCondition(operator: HookifyOperator, pattern: string, value: string): boolean {
  switch (operator) {
    case 'regex_match': {
      try {
        const re = new RegExp(pattern, 'i')
        return re.test(value)
      } catch {
        return false
      }
    }
    case 'contains':
      return value.includes(pattern)
    case 'not_contains':
      return !value.includes(pattern)
    case 'equals':
      return value === pattern
    case 'starts_with':
      return value.startsWith(pattern)
    case 'ends_with':
      return value.endsWith(pattern)
    default:
      return false
  }
}

// ── Hook Registration ───────────────────────────────────────────────────────

/**
 * Register all loaded hookify rules as hooks in the hook system.
 *
 * Each rule's `event` field determines which hook event it registers on:
 *   - bash → PreToolUse with matcher "execute_code|Bash"
 *   - file → PreToolUse with matcher "write_file|edit_file|Write|Edit"
 *   - stop → Stop hook
 *   - all  → All of the above
 *
 * Returns the number of rules registered.
 */
export async function registerHookifyRules(): Promise<number> {
  const rules = await loadAllRules()

  let registeredCount = 0
  for (const rule of rules) {
    if (!rule.enabled) continue

    // Cast the handler to the proper type — it accepts any ctx object and
    // accesses fields defensively via String() coercions.
    const handler = makeRuleHandler(rule) as (
      ctx: import('./hook-system').ToolCallContext,
    ) => Promise<import('./hook-system').HookDecision | void>

    if (rule.event === 'bash' || rule.event === 'all') {
      hookSystem.onPreToolUse(
        `hookify:${rule.name}:bash`,
        handler,
        { matcher: 'execute_code|Bash', source: 'hookify', priority: 30 },
      )
      registeredCount++
    }

    if (rule.event === 'file' || rule.event === 'all') {
      hookSystem.onPreToolUse(
        `hookify:${rule.name}:file`,
        handler,
        { matcher: 'write_file|edit_file|Write|Edit', source: 'hookify', priority: 31 },
      )
      registeredCount++
    }

    if (rule.event === 'stop' || rule.event === 'all') {
      const stopHandler = handler as unknown as (
        ctx: import('./hook-system').StopContext,
      ) => Promise<import('./hook-system').HookDecision | void>
      hookSystem.onStop(
        `hookify:${rule.name}:stop`,
        stopHandler,
        { source: 'hookify', priority: 40 },
      )
      registeredCount++
    }

    agentEventBus.emit('hookify:rule-registered', {
      name: rule.name,
      event: rule.event,
      action: rule.action,
      sourceFile: rule.sourceFile,
    })
  }

  if (registeredCount > 0) {
    console.log(`[Hookify] Registered ${registeredCount} hookify rule(s) from ${rules.length} file(s)`)
  }

  return registeredCount
}

/**
 * Build a hook handler that evaluates a single rule.
 */
function makeRuleHandler(
  rule: HookifyRule,
): (ctx: Record<string, unknown>) => Promise<import('./hook-system').HookDecision | void> {
  return async (ctx) => {
    // Build input for rule evaluation
    const input = {
      toolName: String(ctx.toolName || ''),
      toolInput: (ctx.toolInput as Record<string, unknown>) || {},
      transcript: String(ctx.transcriptPath || ctx.transcript || ''),
      reason: String(ctx.finalResponse || ctx.reason || ''),
      userPrompt: String(ctx.userPrompt || ''),
    }

    if (evaluateRule(rule, input)) {
      const message = rule.message || `Rule "${rule.name}" matched`
      if (rule.action === 'block') {
        return {
          decision: 'deny' as const,
          reason: `**[${rule.name}]**\n${message}`,
          systemMessage: `**[${rule.name}]**\n${message}`,
        }
      } else if (rule.action === 'warn') {
        return {
          decision: 'allow' as const,
          systemMessage: `**[${rule.name}]**\n${message}`,
        }
      }
      // action: allow → no-op
    }
    return undefined
  }
}
