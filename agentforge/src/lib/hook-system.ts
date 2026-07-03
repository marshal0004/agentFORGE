/**
 * Claude Code-Style Hook System — Production Implementation
 *
 * Mirrors Claude Code v2.1.161's hook lifecycle:
 *   PreToolUse  — fires BEFORE a tool executes; can BLOCK, MODIFY, or ALLOW
 *   PostToolUse — fires AFTER a tool executes; can return warnings to feed back
 *   Stop        — fires when the agent loop wants to stop; can block + re-feed
 *   PreCompact  — fires BEFORE context compaction; can pin messages to keep
 *   PostCompact — fires AFTER compaction; observability
 *   UserPromptSubmit — fires when user submits a prompt; can inject system messages
 */

import { agentEventBus } from './event-bus'
import { matchToolPattern } from './permissions'

// ── Hook Lifecycle Events ────────────────────────────────────────────────────

export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop'
  | 'PreCompact'
  | 'PostCompact'
  | 'UserPromptSubmit'
  | 'SessionStart'

export interface ToolCallContext {
  toolName: string
  toolInput: Record<string, unknown>
  toolCallId: string
  sessionId?: string
  projectId?: string
  iteration?: number
  [key: string]: unknown
}

export interface StopContext {
  sessionId?: string
  projectId?: string
  finalResponse?: string
  iterationsCompleted?: number
  filesWritten?: string[]
  commandsExecuted?: string[]
  transcriptPath?: string
  [key: string]: unknown
}

export interface CompactContext {
  sessionId?: string
  projectId?: string
  tokensBefore?: number
  maxTokens?: number
  messages?: Array<{ role: string; content: string }>
  pinnedMessageIndices?: number[]
  [key: string]: unknown
}

export interface UserPromptContext {
  sessionId?: string
  projectId?: string
  userPrompt: string
  [key: string]: unknown
}

export type AnyHookContext =
  | ToolCallContext
  | StopContext
  | CompactContext
  | UserPromptContext
  | Record<string, unknown>

// ── Hook Decisions ──────────────────────────────────────────────────────────

export interface HookDecision {
  decision: 'allow' | 'deny' | 'block'
  reason?: string
  modifiedInput?: Record<string, unknown>
  systemMessage?: string
  asyncRewake?: {
    summary: string
    promise: Promise<string>
  }
  pinMessageIndices?: number[]
}

export type HookHandler<C = AnyHookContext> = (
  context: C,
) => HookDecision | Promise<HookDecision | void> | void

export interface RegisteredHook {
  id: string
  event: HookEvent
  handler: HookHandler
  matcher?: string
  ifCondition?: string
  priority: number
  source: string
}

// ── Hook Registry ────────────────────────────────────────────────────────────

class HookRegistry {
  private hooks: Map<HookEvent, RegisteredHook[]> = new Map()
  private pendingAsyncRewakes: Array<{ summary: string; promise: Promise<string> }> = []
  private stats: Map<HookEvent, { fired: number; blocked: number; errors: number }> = new Map()

  constructor() {
    for (const evt of [
      'PreToolUse', 'PostToolUse', 'Stop', 'PreCompact',
      'PostCompact', 'UserPromptSubmit', 'SessionStart',
    ] as HookEvent[]) {
      this.hooks.set(evt, [])
      this.stats.set(evt, { fired: 0, blocked: 0, errors: 0 })
    }
  }

  register(hook: Omit<RegisteredHook, 'priority'> & { priority?: number }): () => void {
    const fullHook: RegisteredHook = { ...hook, priority: hook.priority ?? 100 }
    const list = this.hooks.get(hook.event) || []
    list.push(fullHook)
    list.sort((a, b) => a.priority - b.priority)
    this.hooks.set(hook.event, list)
    return () => {
      const current = this.hooks.get(hook.event) || []
      this.hooks.set(hook.event, current.filter((h) => h.id !== fullHook.id))
    }
  }

  onPreToolUse(
    id: string,
    handler: HookHandler<ToolCallContext>,
    options: { matcher?: string; ifCondition?: string; priority?: number; source?: string } = {},
  ): () => void {
    return this.register({
      id, event: 'PreToolUse', handler: handler as HookHandler,
      source: options.source || 'unknown', ...options,
    })
  }

  onPostToolUse(
    id: string,
    handler: HookHandler<ToolCallContext & { toolResult?: unknown; success?: boolean }>,
    options: { matcher?: string; ifCondition?: string; priority?: number; source?: string } = {},
  ): () => void {
    return this.register({
      id, event: 'PostToolUse', handler: handler as HookHandler,
      source: options.source || 'unknown', ...options,
    })
  }

  onStop(
    id: string,
    handler: HookHandler<StopContext>,
    options: { priority?: number; source?: string } = {},
  ): () => void {
    return this.register({
      id, event: 'Stop', handler: handler as HookHandler,
      source: options.source || 'unknown', ...options,
    })
  }

  onPreCompact(
    id: string,
    handler: HookHandler<CompactContext>,
    options: { priority?: number; source?: string } = {},
  ): () => void {
    return this.register({
      id, event: 'PreCompact', handler: handler as HookHandler,
      source: options.source || 'unknown', ...options,
    })
  }

  async firePreToolUse(context: ToolCallContext): Promise<HookDecision> {
    const stats = this.stats.get('PreToolUse')!
    const hooks = this.hooks.get('PreToolUse') || []
    const result: HookDecision = { decision: 'allow' }
    let currentInput = { ...context.toolInput }

    for (const hook of hooks) {
      if (!this.shouldFire(hook, context.toolName, currentInput)) continue
      stats.fired++
      try {
        const ctxWithInput = { ...context, toolInput: currentInput }
        const decision = await hook.handler(ctxWithInput)
        if (!decision) continue
        if (decision.modifiedInput) {
          currentInput = { ...currentInput, ...decision.modifiedInput }
          result.modifiedInput = currentInput
        }
        if (decision.systemMessage) {
          result.systemMessage = (result.systemMessage ? result.systemMessage + '\n\n' : '') + decision.systemMessage
        }
        if (decision.asyncRewake) {
          this.pendingAsyncRewakes.push(decision.asyncRewake)
        }
        if (decision.decision === 'deny') {
          stats.blocked++
          result.decision = 'deny'
          result.reason = decision.reason
          agentEventBus.emit('tool:blocked-hook', {
            toolName: context.toolName,
            reason: decision.reason || 'blocked by PreToolUse hook',
            hookId: hook.id,
            sessionId: context.sessionId,
          })
          break
        }
      } catch (err) {
        stats.errors++
        const errMsg = err instanceof Error ? err.message : String(err)
        console.error(`[HookSystem] PreToolUse hook '${hook.id}' threw:`, errMsg)
        agentEventBus.emit('agent:error', {
          sessionId: context.sessionId || 'unknown',
          error: `PreToolUse hook '${hook.id}' error: ${errMsg}`,
          phase: 'pre-tool-use',
        })
      }
    }
    return result
  }

  async firePostToolUse(
    context: ToolCallContext & { toolResult?: unknown; success?: boolean },
  ): Promise<HookDecision> {
    const stats = this.stats.get('PostToolUse')!
    const hooks = this.hooks.get('PostToolUse') || []
    const result: HookDecision = { decision: 'allow' }

    for (const hook of hooks) {
      if (!this.shouldFire(hook, context.toolName, context.toolInput)) continue
      stats.fired++
      try {
        const decision = await hook.handler(context)
        if (!decision) continue
        if (decision.systemMessage) {
          result.systemMessage = (result.systemMessage ? result.systemMessage + '\n\n' : '') + decision.systemMessage
        }
        if (decision.asyncRewake) {
          this.pendingAsyncRewakes.push(decision.asyncRewake)
        }
        if (decision.decision === 'deny') {
          stats.blocked++
          result.decision = 'deny'
          result.reason = decision.reason
        }
      } catch (err) {
        stats.errors++
        const errMsg = err instanceof Error ? err.message : String(err)
        console.error(`[HookSystem] PostToolUse hook '${hook.id}' threw:`, errMsg)
      }
    }
    return result
  }

  async fireStop(context: StopContext): Promise<HookDecision> {
    const stats = this.stats.get('Stop')!
    const hooks = this.hooks.get('Stop') || []
    const result: HookDecision = { decision: 'allow' }

    for (const hook of hooks) {
      stats.fired++
      try {
        const decision = await hook.handler(context)
        if (!decision) continue
        if (decision.asyncRewake) {
          this.pendingAsyncRewakes.push(decision.asyncRewake)
        }
        if (decision.decision === 'block') {
          stats.blocked++
          result.decision = 'block'
          result.reason = (result.reason ? result.reason + '\n\n' : '') + (decision.reason || '')
        }
      } catch (err) {
        stats.errors++
        const errMsg = err instanceof Error ? err.message : String(err)
        console.error(`[HookSystem] Stop hook '${hook.id}' threw:`, errMsg)
      }
    }
    return result
  }

  async firePreCompact(context: CompactContext): Promise<HookDecision> {
    const stats = this.stats.get('PreCompact')!
    const hooks = this.hooks.get('PreCompact') || []
    const result: HookDecision = { decision: 'allow' }
    const pinned = new Set<number>()

    for (const hook of hooks) {
      stats.fired++
      try {
        const decision = await hook.handler(context)
        if (!decision) continue
        if (decision.pinMessageIndices) {
          for (const idx of decision.pinMessageIndices) pinned.add(idx)
        }
        if (decision.systemMessage) {
          result.systemMessage = (result.systemMessage ? result.systemMessage + '\n\n' : '') + decision.systemMessage
        }
      } catch (err) {
        stats.errors++
        const errMsg = err instanceof Error ? err.message : String(err)
        console.error(`[HookSystem] PreCompact hook '${hook.id}' threw:`, errMsg)
      }
    }
    if (pinned.size > 0) {
      result.pinMessageIndices = [...pinned].sort((a, b) => a - b)
    }
    return result
  }

  async firePostCompact(context: CompactContext & { tokensAfter?: number; messagesAfter?: number }): Promise<void> {
    const stats = this.stats.get('PostCompact')!
    const hooks = this.hooks.get('PostCompact') || []
    for (const hook of hooks) {
      stats.fired++
      try {
        await hook.handler(context)
      } catch (err) {
        stats.errors++
        const errMsg = err instanceof Error ? err.message : String(err)
        console.error(`[HookSystem] PostCompact hook '${hook.id}' threw:`, errMsg)
      }
    }
  }

  async fireUserPromptSubmit(context: UserPromptContext): Promise<HookDecision> {
    const stats = this.stats.get('UserPromptSubmit')!
    const hooks = this.hooks.get('UserPromptSubmit') || []
    const result: HookDecision = { decision: 'allow' }
    for (const hook of hooks) {
      stats.fired++
      try {
        const decision = await hook.handler(context)
        if (!decision) continue
        if (decision.systemMessage) {
          result.systemMessage = (result.systemMessage ? result.systemMessage + '\n\n' : '') + decision.systemMessage
        }
      } catch (err) {
        stats.errors++
        const errMsg = err instanceof Error ? err.message : String(err)
        console.error(`[HookSystem] UserPromptSubmit hook '${hook.id}' threw:`, errMsg)
      }
    }
    return result
  }

  async drainAsyncRewakes(timeoutMs = 0): Promise<string | null> {
    if (this.pendingAsyncRewakes.length === 0) return null
    const rewakes = this.pendingAsyncRewakes
    this.pendingAsyncRewakes = []
    if (timeoutMs <= 0) {
      const completed: string[] = []
      for (const r of rewakes) {
        const sentinel = Symbol()
        const settled = await Promise.race([r.promise.then(() => true), Promise.resolve(sentinel)])
        if (settled !== sentinel) {
          try {
            const finding = await r.promise
            completed.push(`[${r.summary}]\n${finding}`)
          } catch { /* ignore failed rewakes */ }
        } else {
          this.pendingAsyncRewakes.push(r)
        }
      }
      return completed.length > 0 ? completed.join('\n\n') : null
    }
    const completed: string[] = []
    for (const r of rewakes) {
      try {
        const finding = await Promise.race([
          r.promise,
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error('rewake-timeout')), timeoutMs),
          ),
        ])
        completed.push(`[${r.summary}]\n${finding}`)
      } catch { /* Timeout or failure — drop */ }
    }
    return completed.length > 0 ? completed.join('\n\n') : null
  }

  hasPendingRewakes(): boolean {
    return this.pendingAsyncRewakes.length > 0
  }

  private shouldFire(
    hook: RegisteredHook,
    toolName: string,
    toolInput: Record<string, unknown>,
  ): boolean {
    if (hook.matcher && hook.matcher !== '*') {
      const patterns = hook.matcher.split('|').map((p) => p.trim())
      const aliases = getToolAliases(toolName)
      const matched = patterns.some((p) => aliases.has(p) || p === toolName)
      if (!matched) return false
    }
    if (hook.ifCondition) {
      if (!matchToolPattern(hook.ifCondition, { toolName, toolInput })) {
        return false
      }
    }
    return true
  }

  getStats(): Record<HookEvent, { fired: number; blocked: number; errors: number }> {
    return Object.fromEntries(this.stats) as Record<
      HookEvent, { fired: number; blocked: number; errors: number }
    >
  }

  clear(): void {
    for (const evt of this.hooks.keys()) {
      this.hooks.set(evt, [])
      this.stats.set(evt, { fired: 0, blocked: 0, errors: 0 })
    }
    this.pendingAsyncRewakes = []
  }

  list(): Array<{ event: HookEvent; id: string; source: string; priority: number; matcher?: string; ifCondition?: string }> {
    const out: Array<{ event: HookEvent; id: string; source: string; priority: number; matcher?: string; ifCondition?: string }> = []
    for (const [evt, hooks] of this.hooks.entries()) {
      for (const h of hooks) {
        out.push({
          event: evt, id: h.id, source: h.source, priority: h.priority,
          matcher: h.matcher, ifCondition: h.ifCondition,
        })
      }
    }
    return out
  }
}

function getToolAliases(toolName: string): Set<string> {
  const aliases = new Set<string>([toolName])
  const aliasMap: Record<string, string[]> = {
    write_file: ['write_file', 'Write'],
    edit_file: ['edit_file', 'Edit'],
    read_file: ['read_file', 'Read'],
    list_directory: ['list_directory', 'Glob'],
    search_files: ['search_files', 'Grep'],
    execute_code: ['execute_code', 'Bash'],
    think: ['think', 'Think'],
  }
  for (const alias of aliasMap[toolName] || []) {
    aliases.add(alias)
  }
  return aliases
}

// ── Singleton ────────────────────────────────────────────────────────────────

export const hookSystem = new HookRegistry()

// ── Built-in Hooks (registered at module load) ──────────────────────────────

hookSystem.onPreToolUse(
  'builtin:destructive-command-blocker',
  (ctx) => {
    if (ctx.toolName !== 'execute_code' && ctx.toolName !== 'Bash') return
    const command = String(ctx.toolInput.command || '')
    if (!command) return
    const destructive: Array<{ pattern: RegExp; reason: string }> = [
      { pattern: /rm\s+(-rf?|-fr?)\s+[\/~]/, reason: 'rm -rf on root or home directory' },
      { pattern: /rm\s+(-rf?|-fr?)\s+\*/, reason: 'rm -rf * — wildcard recursive delete' },
      { pattern: /:\s*\(\s*\)\s*\{[\s\S]*?\}\s*;\s*:/, reason: 'fork bomb pattern' },
      { pattern: /mkfs\./, reason: 'filesystem format' },
      { pattern: /dd\s+if=.*of=\/dev\//, reason: 'dd to device file' },
      { pattern: /shutdown|reboot/, reason: 'system power control' },
      { pattern: /curl\s+.*\|\s*(ba)?sh/, reason: 'curl | shell — remote code execution' },
      { pattern: /wget\s+.*\|\s*(ba)?sh/, reason: 'wget | shell — remote code execution' },
    ]
    for (const { pattern, reason } of destructive) {
      if (pattern.test(command)) {
        return {
          decision: 'deny' as const,
          reason: `Blocked: ${reason}. Pattern matched: ${pattern.source}`,
        }
      }
    }
    return undefined
  },
  { matcher: 'execute_code|Bash', source: 'builtin', priority: 10 },
)

hookSystem.onPreToolUse(
  'builtin:path-traversal-blocker',
  (ctx) => {
    const path = String(ctx.toolInput.path || ctx.toolInput.file_path || '')
    if (!path) return
    if (path.startsWith('/') || path.includes('..')) {
      return {
        decision: 'deny' as const,
        reason: `Path "${path}" escapes the project workspace. Use a relative path like "src/components/Header.tsx".`,
      }
    }
    if (/(^|\/)\.ssh\/|(^|\/)\.env$|(^|\/)\.aws\/|(^|\/)\.git\/config$/.test(path)) {
      return {
        decision: 'deny' as const,
        reason: `Path "${path}" is in a sensitive directory (SSH keys, env, AWS credentials, git config).`,
      }
    }
    return undefined
  },
  { matcher: 'write_file|edit_file|read_file|Write|Edit|Read', source: 'builtin', priority: 11 },
)

hookSystem.onStop(
  'builtin:verification-gate',
  (ctx) => {
    const wrote = ctx.filesWritten || []
    const cmds = (ctx.commandsExecuted || []).join('\n')
    const wroteTypeScript = wrote.some((p) => p.endsWith('.ts') || p.endsWith('.tsx'))
    if (!wroteTypeScript) return undefined
    const ranTypecheck = /\btsc\b|typecheck|--noEmit/.test(cmds)
    const ranTests = /\b(npm|yarn|pnpm|bun)\s+(test|run test)|\bvitest\b|\bjest\b/.test(cmds)
    if (!ranTypecheck && !ranTests) {
      return {
        decision: 'block' as const,
        reason:
          'TypeScript files were written but no typecheck or test command was run. ' +
          'Run `npm run typecheck` and (if applicable) `npm test` before stopping, ' +
          'then report the results.',
      }
    }
    return undefined
  },
  { source: 'builtin', priority: 50 },
)