/**
 * File Protection — Programmable guardrails that prevent the LLM from modifying critical files
 *
 * Based on Chef's EXCLUDED_FILE_PATHS pattern, extended into a full-featured
 * protection system with granular read/write controls, glob/regex pattern
 * matching, and event bus integration.
 *
 * Design goals:
 *   - Zero filesystem calls — all matching is string/regex based for speed
 *   - Glob-to-regex conversion for intuitive pattern syntax
 *   - Per-rule read/write permissions
 *   - Runtime rule management (add / remove / list)
 *   - Batch filtering of write operations
 *   - Event bus notifications for blocked operations
 *   - Override mechanism for explicit admin unlocks
 */

import { agentEventBus } from './event-bus'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface FileProtectionRule {
  /** File path pattern — glob syntax or RegExp. Globs: star.json, src/star-star/star.ts */
  pattern: string | RegExp
  /** Human-readable explanation of why this file is protected */
  reason: string
  /** Whether the agent is allowed to read this file (default: true) */
  allowRead: boolean
  /** Whether the agent is allowed to write this file (default: false) */
  allowWrite: boolean
}

export interface ProtectionCheckResult {
  /** Whether the operation is allowed */
  allowed: boolean
  /** If blocked, the reason why */
  reason?: string
  /** The specific rule that matched (if any) */
  matchedPattern?: string
}

export interface FilteredWriteOperations {
  /** Files that passed the protection check */
  allowed: Array<{ path: string; content: string }>
  /** Files that were blocked by protection rules */
  blocked: Array<{ path: string; reason: string }>
}

// ── Glob → Regex conversion ────────────────────────────────────────────────────

/**
 * Convert a glob pattern to a RegExp.
 *
 * Supports:
 *   - `*`       → any sequence of characters within a path segment
 *   - `**`      → any sequence of characters across path segments
 *   - `?`       → any single character
 *   - `{a,b}`   → alternation (a or b)
 *   - `[abc]`   → character class
 *   - `[!abc]`  → negated character class
 *   - `.ext`    → file extension match
 *
 * Patterns are matched against the relative file path (forward slashes).
 */
function globToRegex(glob: string): RegExp {
  let regexStr = ''
  let i = 0
  const len = glob.length

  while (i < len) {
    const char = glob[i]

    switch (char) {
      case '*': {
        // Check for double-star (globstar)
        if (i + 1 < len && glob[i + 1] === '*') {
          // ** matches any path segment(s) including separators
          // /**/ matches zero or more directories
          if (i + 2 < len && glob[i + 2] === '/') {
            regexStr += '(?:.*/)?'
            i += 3
          } else {
            regexStr += '.*'
            i += 2
          }
        } else {
          // Single * matches within a segment (no path separator)
          regexStr += '[^/]*'
          i++
        }
        break
      }

      case '?': {
        regexStr += '[^/]'
        i++
        break
      }

      case '[': {
        // Pass through character class, but handle negation
        let classStr = '['
        i++
        if (i < len && glob[i] === '!') {
          classStr += '^'
          i++
        }
        while (i < len && glob[i] !== ']') {
          const classChar = glob[i]
          // Escape regex-special chars inside character class
          if (classChar === '\\') {
            classStr += '\\\\'
          } else {
            classStr += classChar
          }
          i++
        }
        classStr += ']'
        regexStr += classStr
        if (i < len) i++ // skip closing ]
        break
      }

      case '{': {
        // Alternation: {a,b,c} → (?:a|b|c)
        let alternationStr = '(?:'
        i++
        let first = true
        while (i < len && glob[i] !== '}') {
          if (glob[i] === ',') {
            alternationStr += '|'
            i++
            first = false
          } else {
            alternationStr += escapeRegexChar(glob[i])
            i++
          }
        }
        alternationStr += ')'
        regexStr += alternationStr
        if (i < len) i++ // skip closing }
        break
      }

      case '.': {
        // Dot in glob is literal (unlike regex where . is wildcard)
        regexStr += '\\.'
        i++
        break
      }

      default: {
        regexStr += escapeRegexChar(char)
        i++
        break
      }
    }
  }

  // Anchor the pattern: match full path or trailing segment
  // If pattern starts with ** or *, it can match anywhere in the path
  // Otherwise, it must match from the beginning
  if (glob.startsWith('**') || glob.startsWith('*')) {
    return new RegExp(`^(?:.*\\/)?${regexStr}$`, 'i')
  }
  return new RegExp(`^${regexStr}$`, 'i')
}

/**
 * Escape a single character for use in a regex.
 */
function escapeRegexChar(char: string): string {
  const specialChars = new Set(['^', '$', '+', '(', ')', '|', '\\'])
  if (specialChars.has(char)) {
    return '\\' + char
  }
  return char
}

// ── Rule compilation ───────────────────────────────────────────────────────────

interface CompiledRule {
  original: FileProtectionRule
  regex: RegExp
  patternString: string
}

function compileRule(rule: FileProtectionRule): CompiledRule {
  if (rule.pattern instanceof RegExp) {
    return {
      original: rule,
      regex: rule.pattern,
      patternString: rule.pattern.source,
    }
  }

  return {
    original: rule,
    regex: globToRegex(rule.pattern),
    patternString: rule.pattern,
  }
}

// ── Path normalization ─────────────────────────────────────────────────────────

/**
 * Normalize a file path for consistent matching:
 *   - Convert backslashes to forward slashes
 *   - Remove leading ./
 *   - Collapse consecutive slashes
 *   - Trim whitespace
 */
function normalizePath(filePath: string): string {
  return filePath
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/')
    .trim()
}

// ── File Protection Manager ────────────────────────────────────────────────────

export class FileProtectionManager {
  private rules: CompiledRule[]
  /** Set of temporarily unlocked paths (override mechanism) */
  private unlockedPaths: Set<string>
  /** Whether protection is globally enabled */
  private enabled: boolean

  constructor(defaultRules?: FileProtectionRule[]) {
    this.rules = (defaultRules ?? []).map(compileRule)
    this.unlockedPaths = new Set()
    this.enabled = true
  }

  // ── Core checks ──────────────────────────────────────────────────────────

  /**
   * Check if a file can be written.
   * Returns an object with `allowed` flag and optional `reason` if blocked.
   *
   * Performance: O(n) where n = number of rules. All matching is regex-based,
   * no filesystem calls.
   */
  canWrite(filePath: string): ProtectionCheckResult {
    if (!this.enabled) {
      return { allowed: true }
    }

    const normalized = normalizePath(filePath)

    // Check override unlock
    if (this.unlockedPaths.has(normalized)) {
      return { allowed: true }
    }

    // Check rules in order — first matching rule wins
    for (const rule of this.rules) {
      if (rule.regex.test(normalized)) {
        if (rule.original.allowWrite) {
          return {
            allowed: true,
            matchedPattern: rule.patternString,
          }
        }

        // Emit blocked event
        agentEventBus.emit('file-protection:blocked', {
          filePath: normalized,
          reason: rule.original.reason,
          operation: 'write',
        })

        return {
          allowed: false,
          reason: `Protected: ${rule.original.reason}`,
          matchedPattern: rule.patternString,
        }
      }
    }

    // No matching rule → allow by default
    return { allowed: true }
  }

  /**
   * Check if a file can be read.
   * Returns an object with `allowed` flag and optional `reason` if blocked.
   */
  canRead(filePath: string): ProtectionCheckResult {
    if (!this.enabled) {
      return { allowed: true }
    }

    const normalized = normalizePath(filePath)

    // Check override unlock
    if (this.unlockedPaths.has(normalized)) {
      return { allowed: true }
    }

    // Check rules in order — first matching rule wins
    for (const rule of this.rules) {
      if (rule.regex.test(normalized)) {
        if (rule.original.allowRead) {
          return {
            allowed: true,
            matchedPattern: rule.patternString,
          }
        }

        // Emit blocked event
        agentEventBus.emit('file-protection:blocked', {
          filePath: normalized,
          reason: rule.original.reason,
          operation: 'read',
        })

        return {
          allowed: false,
          reason: `Protected: ${rule.original.reason}`,
          matchedPattern: rule.patternString,
        }
      }
    }

    // No matching rule → allow by default
    return { allowed: true }
  }

  // ── Batch operations ─────────────────────────────────────────────────────

  /**
   * Filter a batch of write operations — returns only the files that are
   * allowed, along with the list of blocked files and reasons.
   *
   * This is the primary method used by the self-correction loop and agent
   * file-writing pipeline.
   */
  filterWriteOperations(
    files: Array<{ path: string; content: string }>,
  ): FilteredWriteOperations {
    const allowed: Array<{ path: string; content: string }> = []
    const blocked: Array<{ path: string; reason: string }> = []

    for (const file of files) {
      const check = this.canWrite(file.path)
      if (check.allowed) {
        allowed.push(file)
      } else {
        blocked.push({
          path: file.path,
          reason: check.reason || 'Protected file',
        })
      }
    }

    return { allowed, blocked }
  }

  // ── Rule management ──────────────────────────────────────────────────────

  /**
   * Add a protection rule. Rules are checked in insertion order;
   * the first matching rule wins.
   */
  addRule(rule: FileProtectionRule): void {
    this.rules.push(compileRule(rule))
  }

  /**
   * Remove a protection rule by its pattern string.
   * For RegExp rules, uses the source string for comparison.
   * Returns true if a rule was removed.
   */
  removeRule(pattern: string): boolean {
    const patternStr = pattern
    const initialLength = this.rules.length
    this.rules = this.rules.filter((rule) => {
      // For string patterns, compare directly
      if (typeof rule.original.pattern === 'string') {
        return rule.original.pattern !== patternStr
      }
      // For RegExp patterns, compare source and flags
      return (
        rule.original.pattern.source !== patternStr ||
        rule.original.pattern.flags !== ''
      )
    })
    return this.rules.length < initialLength
  }

  /**
   * Get all current protection rules (as raw rule objects).
   */
  getRules(): FileProtectionRule[] {
    return this.rules.map((r) => r.original)
  }

  /**
   * Remove all protection rules.
   */
  clearRules(): void {
    this.rules = []
  }

  /**
   * Set the protection rules, replacing all existing rules.
   */
  setRules(rules: FileProtectionRule[]): void {
    this.rules = rules.map(compileRule)
  }

  // ── Override / unlock mechanism ──────────────────────────────────────────

  /**
   * Temporarily unlock a specific file path, allowing writes even if a
   * protection rule would otherwise block it. The unlock persists until
   * `relock` is called for that path.
   *
   * Use with caution — this is intended for admin overrides, not routine use.
   */
  unlock(filePath: string): void {
    this.unlockedPaths.add(normalizePath(filePath))
  }

  /**
   * Re-lock a previously unlocked file path.
   */
  relock(filePath: string): void {
    this.unlockedPaths.delete(normalizePath(filePath))
  }

  /**
   * Clear all temporary unlocks.
   */
  clearUnlocks(): void {
    this.unlockedPaths.clear()
  }

  /**
   * Check if a path is currently unlocked.
   */
  isUnlocked(filePath: string): boolean {
    return this.unlockedPaths.has(normalizePath(filePath))
  }

  // ── Global enable/disable ────────────────────────────────────────────────

  /**
   * Globally enable file protection (default state).
   */
  enable(): void {
    this.enabled = true
  }

  /**
   * Globally disable file protection.
   * USE WITH EXTREME CAUTION — this removes all guardrails.
   */
  disable(): void {
    this.enabled = false
  }

  /**
   * Check if file protection is globally enabled.
   */
  isEnabled(): boolean {
    return this.enabled
  }

  // ── Diagnostics ──────────────────────────────────────────────────────────

  /**
   * Check which rule (if any) matches a given file path.
   * Useful for debugging protection behavior.
   */
  getMatchingRule(filePath: string): FileProtectionRule | null {
    const normalized = normalizePath(filePath)
    for (const rule of this.rules) {
      if (rule.regex.test(normalized)) {
        return rule.original
      }
    }
    return null
  }

  /**
   * Test a file path against all rules and return detailed results.
   * Useful for debugging and admin UIs.
   */
  diagnose(filePath: string): {
    path: string
    normalized: string
    canRead: boolean
    canWrite: boolean
    matchingRule: FileProtectionRule | null
    isUnlocked: boolean
    protectionEnabled: boolean
  } {
    const normalized = normalizePath(filePath)
    return {
      path: filePath,
      normalized,
      canRead: this.canRead(filePath).allowed,
      canWrite: this.canWrite(filePath).allowed,
      matchingRule: this.getMatchingRule(filePath),
      isUnlocked: this.unlockedPaths.has(normalized),
      protectionEnabled: this.enabled,
    }
  }
}

// ── Default protected files ────────────────────────────────────────────────────

/**
 * Default protection rules for a typical Next.js project.
 * These prevent the LLM agent from modifying critical infrastructure files
 * that could break the build, corrupt dependencies, or leak secrets.
 */
export const DEFAULT_PROTECTED_FILES: FileProtectionRule[] = [
  {
    pattern: 'next.config.*',
    reason: 'Build configuration',
    allowRead: true,
    allowWrite: false,
  },
  {
    pattern: 'package.json',
    reason: 'Dependency manifest',
    allowRead: true,
    allowWrite: false,
  },
  {
    pattern: 'package-lock.json',
    reason: 'Lockfile',
    allowRead: true,
    allowWrite: false,
  },
  {
    pattern: 'bun.lock',
    reason: 'Lockfile',
    allowRead: true,
    allowWrite: false,
  },
  {
    pattern: 'yarn.lock',
    reason: 'Lockfile',
    allowRead: true,
    allowWrite: false,
  },
  {
    pattern: 'tsconfig.json',
    reason: 'TypeScript configuration',
    allowRead: true,
    allowWrite: false,
  },
  {
    pattern: 'tsconfig.*.json',
    reason: 'TypeScript project reference configuration',
    allowRead: true,
    allowWrite: false,
  },
  {
    pattern: 'prisma/schema.prisma',
    reason: 'Database schema',
    allowRead: true,
    allowWrite: false,
  },
  {
    pattern: '.env*',
    reason: 'Environment variables',
    allowRead: false,
    allowWrite: false,
  },
  {
    pattern: 'middleware.ts',
    reason: 'Middleware',
    allowRead: true,
    allowWrite: false,
  },
  {
    pattern: 'middleware.js',
    reason: 'Middleware',
    allowRead: true,
    allowWrite: false,
  },
  {
    pattern: 'tailwind.config.*',
    reason: 'Tailwind CSS configuration',
    allowRead: true,
    allowWrite: false,
  },
  {
    pattern: 'postcss.config.*',
    reason: 'PostCSS configuration',
    allowRead: true,
    allowWrite: false,
  },
  {
    pattern: '.eslintrc*',
    reason: 'ESLint configuration',
    allowRead: true,
    allowWrite: false,
  },
  {
    pattern: 'eslint.config.*',
    reason: 'ESLint flat configuration',
    allowRead: true,
    allowWrite: false,
  },
  {
    pattern: 'prettier.config.*',
    reason: 'Prettier configuration',
    allowRead: true,
    allowWrite: false,
  },
  {
    pattern: '.prettierrc*',
    reason: 'Prettier configuration',
    allowRead: true,
    allowWrite: false,
  },
  {
    pattern: '.gitignore',
    reason: 'Git ignore rules',
    allowRead: true,
    allowWrite: false,
  },
  {
    pattern: '.git/**',
    reason: 'Git directory',
    allowRead: false,
    allowWrite: false,
  },
  {
    pattern: 'Caddyfile',
    reason: 'Gateway configuration',
    allowRead: true,
    allowWrite: false,
  },
  {
    pattern: 'docker-compose.*',
    reason: 'Docker Compose configuration',
    allowRead: true,
    allowWrite: false,
  },
  {
    pattern: 'Dockerfile*',
    reason: 'Docker build configuration',
    allowRead: true,
    allowWrite: false,
  },
  {
    pattern: 'prisma/migrations/**',
    reason: 'Database migrations',
    allowRead: true,
    allowWrite: false,
  },
]

// ── Singleton ──────────────────────────────────────────────────────────────────

export const fileProtectionManager = new FileProtectionManager(DEFAULT_PROTECTED_FILES)
