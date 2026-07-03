/**
 * Claude Code-Style Permission System — Tool(param:value) Syntax
 *
 * Mirrors Claude Code v2.1.160's permission rules:
 *   Bash(git *)              — only git subcommands
 *   Bash(npm run dev *)      — only this specific npm script
 *   Read(~/.ssh/**)          — path-scoped read rules
 *   Edit(src/**)             — path-scoped edit rules
 *   Write(src/components/**) — path-scoped write rules
 *
 * Three permission levels (matches Claude Code):
 *   - allow: silently allowed (no prompt)
 *   - ask:   prompt the user
 *   - deny:  blocked silently
 *
 * Rules are loaded from .agentforge/permissions.json (project-scoped)
 * and ~/.agentforge/permissions.json (user-scoped).
 */

import fs from 'fs/promises'
import path from 'path'
import os from 'os'

// ── Types ────────────────────────────────────────────────────────────────────

export type PermissionDecision = 'allow' | 'ask' | 'deny'

export interface PermissionRule {
  pattern: string
  decision: PermissionDecision
  source: 'project' | 'user' | 'builtin' | 'runtime'
  reason?: string
}

export interface PermissionConfig {
  allow: PermissionRule[]
  ask: PermissionRule[]
  deny: PermissionRule[]
}

// ── Pattern Parsing ─────────────────────────────────────────────────────────

export interface ParsedPattern {
  tool: string
  param?: string
  value?: string
  raw: string
}

export function parsePattern(pattern: string): ParsedPattern {
  const trimmed = pattern.trim()
  const parenIdx = trimmed.indexOf('(')
  if (parenIdx === -1) {
    return { tool: trimmed, raw: pattern }
  }
  const tool = trimmed.slice(0, parenIdx).trim()
  const closeIdx = trimmed.lastIndexOf(')')
  const inner = trimmed.slice(parenIdx + 1, closeIdx === -1 ? undefined : closeIdx).trim()
  if (!inner) {
    return { tool, raw: pattern }
  }
  const knownParams = new Set(['command', 'path', 'file_path', 'content', 'pattern', 'query', 'url'])
  const colonIdx = inner.indexOf(':')
  if (colonIdx > 0) {
    const possibleParam = inner.slice(0, colonIdx).trim()
    if (knownParams.has(possibleParam)) {
      const value = inner.slice(colonIdx + 1).trim()
      return { tool, param: possibleParam, value: expandGlob(value), raw: pattern }
    }
  }
  const inferredParam = inferDefaultParam(tool)
  return { tool, param: inferredParam, value: expandGlob(inner), raw: pattern }
}

function inferDefaultParam(tool: string): string | undefined {
  const normalized = normalizeToolName(tool)
  switch (normalized) {
    case 'Bash':
    case 'execute_code':
      return 'command'
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'read_file':
    case 'write_file':
    case 'edit_file':
      return 'path'
    default:
      return undefined
  }
}

export function normalizeToolName(tool: string): string {
  const aliases: Record<string, string> = {
    Write: 'write_file',
    Read: 'read_file',
    Edit: 'edit_file',
    Bash: 'execute_code',
    Glob: 'list_directory',
    Grep: 'search_files',
    Think: 'think',
  }
  return aliases[tool] || tool
}

/**
 * Expand Claude Code glob syntax to regex-compatible pattern.
 *   "*"  → "[^/]*" (any chars except /)
 *   "**" → ".*" (any chars including /)
 *
 * IMPORTANT: The colon ":" is NOT expanded here. In Claude Code's syntax,
 * ":" is only a separator at the param:value boundary (e.g. Bash(command:git*)),
 * which is handled by parsePattern(). Inside the value, ":" is a literal char.
 */
function expandGlob(value: string): string {
  let out = ''
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch === '*') {
      if (value[i + 1] === '*') {
        out += '.*'
        i++
      } else {
        out += '[^/]*'
      }
    } else if ('\\^$.|?+()[]{}'.includes(ch)) {
      out += '\\' + ch
    } else {
      out += ch
    }
  }
  return out
}

// ── Matching ────────────────────────────────────────────────────────────────

export interface ToolCallInfo {
  toolName: string
  toolInput: Record<string, unknown>
}

export function matchToolPattern(pattern: string, call: ToolCallInfo): boolean {
  const parsed = parsePattern(pattern)
  const normalizedTool = normalizeToolName(parsed.tool)
  const normalizedCallTool = normalizeToolName(call.toolName)
  if (normalizedTool !== normalizedCallTool) return false
  if (!parsed.value) return true
  const paramToCheck = parsed.param || inferDefaultParam(parsed.tool)
  if (!paramToCheck) return false
  const actualValue = call.toolInput[paramToCheck]
  if (actualValue === undefined || actualValue === null) return false
  const actualStr = String(actualValue)
  let valueRegex = parsed.value
  if (paramToCheck === 'path' && parsed.value.includes('~')) {
    const home = os.homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    valueRegex = parsed.value.replace(/~/g, home)
  }
  try {
    const re = new RegExp(`^${valueRegex}`)
    return re.test(actualStr)
  } catch {
    return actualStr.includes(parsed.value)
  }
}

// ── Permission Manager ──────────────────────────────────────────────────────

class PermissionManager {
  private config: PermissionConfig = { allow: [], ask: [], deny: [] }
  private loaded = false

  async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    const projectPath = path.join(process.cwd(), '.agentforge', 'permissions.json')
    const userPath = path.join(os.homedir(), '.agentforge', 'permissions.json')
    await Promise.all([
      this.loadFile(projectPath, 'project'),
      this.loadFile(userPath, 'user'),
    ])
    this.config.deny.push(
      { pattern: 'Bash(rm -rf /*)', decision: 'deny', source: 'builtin', reason: 'Recursive force delete from root' },
      { pattern: 'Bash(sudo *)', decision: 'deny', source: 'builtin', reason: 'sudo not allowed in sandboxed execution' },
      { pattern: 'Bash(mkfs *)', decision: 'deny', source: 'builtin', reason: 'Filesystem formatting blocked' },
      { pattern: 'Read(~/.ssh/**)', decision: 'deny', source: 'builtin', reason: 'SSH private keys are off-limits' },
      { pattern: 'Read(~/.aws/**)', decision: 'deny', source: 'builtin', reason: 'AWS credentials are off-limits' },
    )
  }

  private async loadFile(filePath: string, source: 'project' | 'user'): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      const parsed = JSON.parse(content)
      if (Array.isArray(parsed.allow)) {
        for (const p of parsed.allow) {
          this.config.allow.push({ pattern: String(p), decision: 'allow', source })
        }
      }
      if (Array.isArray(parsed.ask)) {
        for (const p of parsed.ask) {
          this.config.ask.push({ pattern: String(p), decision: 'ask', source })
        }
      }
      if (Array.isArray(parsed.deny)) {
        for (const p of parsed.deny) {
          this.config.deny.push({ pattern: String(p), decision: 'deny', source })
        }
      }
    } catch (err: unknown) {
      const errCode = (err as { code?: string })?.code
      if (errCode !== 'ENOENT') {
        console.warn(`[Permissions] Failed to load ${filePath}:`, (err as Error).message)
      }
    }
  }

  addRuntimeRule(decision: PermissionDecision, pattern: string, reason?: string): void {
    this.config[decision].push({ pattern, decision, source: 'runtime', reason })
  }

  check(call: ToolCallInfo): { decision: PermissionDecision; reason?: string; matchedPattern?: string } {
    for (const rule of this.config.deny) {
      if (matchToolPattern(rule.pattern, call)) {
        return { decision: 'deny', reason: rule.reason, matchedPattern: rule.pattern }
      }
    }
    for (const rule of this.config.ask) {
      if (matchToolPattern(rule.pattern, call)) {
        return { decision: 'ask', reason: rule.reason, matchedPattern: rule.pattern }
      }
    }
    for (const rule of this.config.allow) {
      if (matchToolPattern(rule.pattern, call)) {
        return { decision: 'allow', reason: rule.reason, matchedPattern: rule.pattern }
      }
    }
    return { decision: 'allow' }
  }

  getConfig(): PermissionConfig {
    return this.config
  }

  clear(): void {
    this.config = { allow: [], ask: [], deny: [] }
    this.loaded = false
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

export const permissionManager = new PermissionManager()

export async function checkPermission(call: ToolCallInfo): Promise<{
  decision: PermissionDecision
  reason?: string
  matchedPattern?: string
}> {
  await permissionManager.load()
  return permissionManager.check(call)
}