/**
 * Self-Correction Loop — Automated validate → fix → re-validate cycle
 *
 * After an agent writes files, this module runs validation steps (typecheck,
 * lint, format) and feeds any errors back to the LLM for automatic fixing.
 * The cycle repeats until the project is clean or the maximum number of
 * iterations is exhausted.
 *
 * Design based on Chef's "typecheck → fix → redeploy" pattern, adapted for
 * agentForge's multi-step validation pipeline and event-driven architecture.
 *
 * Features:
 *   - Pluggable validation steps (TypeScript, ESLint, Prettier, custom)
 *   - Built-in error parsers for common tools
 *   - Iterative correction loop with configurable max iterations
 *   - Event bus integration for real-time observability
 *   - Error deduplication across iterations
 *   - LLM prompt formatting for efficient error feedback
 *   - Concurrency-safe execution with per-project locking
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { agentEventBus } from './event-bus'
import { ChatMessage, llmProviderRegistry } from './llm-provider'
import { fileProtectionManager } from './file-protection'
import { promises as fs } from 'fs'
import path from 'path'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ValidationStep {
  /** Human-readable name, e.g. "typescript", "eslint", "prettier" */
  name: string
  /** Shell command to run, e.g. "npx tsc --noEmit" */
  command: string
  /** Working directory for the command (typically the project root) */
  cwd: string
  /** Maximum time to wait for the command, in milliseconds */
  timeout: number
  /** Parse command output into structured validation errors */
  parseErrors: (stdout: string, stderr: string) => ValidationError[]
}

export interface ValidationError {
  /** File path relative to the project root */
  file: string
  /** Line number (1-based) */
  line?: number
  /** Column number (1-based) */
  column?: number
  /** Error severity */
  severity: 'error' | 'warning'
  /** Human-readable error message */
  message: string
  /** Optional error code (e.g. TS2322, no-unused-vars) */
  code?: string
  /** Name of the validation step that produced this error */
  source?: string
}

export interface CorrectionResult {
  /** Whether the project passed all validation steps */
  validated: boolean
  /** Errors remaining after all correction iterations */
  errors: ValidationError[]
  /** Warnings remaining after all correction iterations */
  warnings: ValidationError[]
  /** Number of correction iterations performed */
  iterations: number
  /** Maximum iterations allowed */
  maxIterations: number
  /** Total number of errors fixed across all iterations */
  fixedErrors: number
  /** Number of errors still remaining */
  remainingErrors: number
  /** History of each correction iteration */
  correctionHistory: Array<{
    iteration: number
    errorsBefore: number
    errorsAfter: number
    fixesApplied: string[]
  }>
}

export interface CorrectionConfig {
  /** Maximum correction iterations (default: 3) */
  maxIterations?: number
  /** Validation steps to run */
  steps?: ValidationStep[]
  /** LLM model to use for generating fixes (default: "glm-5.1") */
  model?: string
  /** System prompt prefix for the fix generation LLM call */
  systemPromptPrefix?: string
  /** Whether to skip file protection checks (default: false) */
  skipFileProtection?: boolean
}

// ── Built-in error parsers ─────────────────────────────────────────────────────

/**
 * Parse TypeScript compiler output (tsc --noEmit --pretty false).
 *
 * Format:
 *   src/file.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.
 *   src/file.ts(34,1): warning TS6133: 'x' is declared but never read.
 */
export function parseTypeScriptErrors(stdout: string, stderr: string): ValidationError[] {
  const errors: ValidationError[] = []
  const output = stdout + '\n' + stderr

  // TypeScript diagnostic regex: file(line,col): severity TScode: message
  const tscRegex = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/gm
  let match: RegExpExecArray | null

  while ((match = tscRegex.exec(output)) !== null) {
    errors.push({
      file: match[1],
      line: parseInt(match[2], 10),
      column: parseInt(match[3], 10),
      severity: match[4] as 'error' | 'warning',
      code: match[5],
      message: match[6].trim(),
      source: 'typescript',
    })
  }

  return errors
}

/**
 * Parse ESLint output in compact format (eslint --format compact).
 *
 * Format:
 *   /path/to/file.ts: line 5, col 10, Error - Unexpected any. (@typescript-eslint/no-explicit-any)
 *   /path/to/file.ts: line 12, col 1, Warning - 'x' is defined but never used. (no-unused-vars)
 */
export function parseESLintErrors(stdout: string, stderr: string): ValidationError[] {
  const errors: ValidationError[] = []
  const output = stdout + '\n' + stderr

  // ESLint compact format regex
  const eslintRegex = /^(.+?):\s+line\s+(\d+),\s+col\s+(\d+),\s+(Error|Warning)\s+-\s+(.+?)\.\s+\((.+)\)$/gm
  let match: RegExpExecArray | null

  while ((match = eslintRegex.exec(output)) !== null) {
    errors.push({
      file: match[1],
      line: parseInt(match[2], 10),
      column: parseInt(match[3], 10),
      severity: match[4].toLowerCase() as 'error' | 'warning',
      message: match[5].trim(),
      code: match[6].trim(),
      source: 'eslint',
    })
  }

  // Fallback: also try the default ESLint format
  //   5:10  error  Unexpected any  @typescript-eslint/no-explicit-any
  if (errors.length === 0) {
    const defaultRegex = /^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)\s{2,}(.+)$/gm
    let currentFile = ''
    const lines = output.split('\n')

    for (const line of lines) {
      // File path lines in default format: /path/to/file.ts
      if (line.trim().length > 0 && !line.startsWith(' ') && line.endsWith('.ts') || line.endsWith('.tsx') || line.endsWith('.js') || line.endsWith('.jsx')) {
        const trimmed = line.trim()
        if (!trimmed.includes('error') && !trimmed.includes('warning')) {
          currentFile = trimmed
        }
      }

      const defaultMatch = defaultRegex.exec(line)
      if (defaultMatch && currentFile) {
        errors.push({
          file: currentFile,
          line: parseInt(defaultMatch[1], 10),
          column: parseInt(defaultMatch[2], 10),
          severity: defaultMatch[3] as 'error' | 'warning',
          message: defaultMatch[4].trim(),
          code: defaultMatch[5].trim(),
          source: 'eslint',
        })
      }
      defaultRegex.lastIndex = 0
    }
  }

  return errors
}

/**
 * Parse Prettier check output.
 *
 * Prettier outputs file paths (one per line) when files need formatting.
 * There's no line/column info — just "this file is not formatted".
 */
export function parsePrettierErrors(stdout: string, stderr: string): ValidationError[] {
  const errors: ValidationError[] = []
  const output = stdout + '\n' + stderr

  // Prettier outputs file paths when they need formatting
  const lines = output.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    // Check if line looks like a file path (has extension and no error prefix)
    if (
      trimmed.length > 0 &&
      !trimmed.startsWith('[') &&
      !trimmed.startsWith('Checking') &&
      !trimmed.includes('error') &&
      /\.\w+$/.test(trimmed)
    ) {
      errors.push({
        file: trimmed,
        severity: 'warning',
        message: 'File does not match Prettier formatting rules',
        code: 'prettier/format',
        source: 'prettier',
      })
    }
  }

  return errors
}

// ── Built-in validation steps ──────────────────────────────────────────────────

/**
 * Create the default validation steps for a given project directory.
 * Only includes steps for tools that are likely available.
 */
export function createDefaultValidationSteps(projectPath: string): ValidationStep[] {
  return [
    {
      name: 'typescript',
      command: 'npx tsc --noEmit --pretty false',
      cwd: projectPath,
      timeout: 60_000,
      parseErrors: parseTypeScriptErrors,
    },
    {
      name: 'eslint',
      command: 'npx eslint . --format compact --no-error-on-unmatched-pattern 2>&1 || true',
      cwd: projectPath,
      timeout: 60_000,
      parseErrors: parseESLintErrors,
    },
    {
      name: 'prettier',
      command: 'npx prettier --check . 2>&1 || true',
      cwd: projectPath,
      timeout: 30_000,
      parseErrors: parsePrettierErrors,
    },
  ]
}

// ── Exec helper ────────────────────────────────────────────────────────────────

const execFileAsync = promisify(execFile)

interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
}

/**
 * Execute a shell command with timeout, returning structured output.
 */
async function execWithTimeout(
  command: string,
  cwd: string,
  timeout: number,
): Promise<ExecResult> {
  try {
    // Use shell: true to support commands with pipes, npx, etc.
    const { stdout, stderr } = await execFileAsync('sh', ['-c', command], {
      cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024, // 10 MB buffer
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    })

    return {
      stdout: stdout || '',
      stderr: stderr || '',
      exitCode: 0,
      timedOut: false,
    }
  } catch (err: unknown) {
    const execErr = err as Error & {
      stdout?: string
      stderr?: string
      code?: number
      killed?: boolean
      signal?: string
    }

    // Process exited with non-zero code — this is expected for lint/typecheck
    if (execErr.stdout !== undefined || execErr.stderr !== undefined) {
      return {
        stdout: execErr.stdout || '',
        stderr: execErr.stderr || '',
        exitCode: execErr.code ?? 1,
        timedOut: execErr.killed === true || execErr.signal === 'SIGTERM',
      }
    }

    // Command failed to start or timed out
    return {
      stdout: '',
      stderr: execErr.message || 'Unknown execution error',
      exitCode: execErr.code ?? -1,
      timedOut: execErr.killed === true,
    }
  }
}

// ── Error deduplication ────────────────────────────────────────────────────────

function errorKey(err: ValidationError): string {
  return `${err.file}:${err.line ?? 0}:${err.column ?? 0}:${err.code ?? ''}:${err.message}`
}

function deduplicateErrors(errors: ValidationError[]): ValidationError[] {
  const seen = new Set<string>()
  const result: ValidationError[] = []

  for (const err of errors) {
    const key = errorKey(err)
    if (!seen.has(key)) {
      seen.add(key)
      result.push(err)
    }
  }

  return result
}

/**
 * Classify errors into errors and warnings, sorted by file and line.
 */
function classifyErrors(allErrors: ValidationError[]): {
  errors: ValidationError[]
  warnings: ValidationError[]
} {
  const errors = deduplicateErrors(
    allErrors
      .filter((e) => e.severity === 'error')
      .sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0)),
  )
  const warnings = deduplicateErrors(
    allErrors
      .filter((e) => e.severity === 'warning')
      .sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0)),
  )

  return { errors, warnings }
}

// ── Self-Correction Loop ───────────────────────────────────────────────────────

export class SelfCorrectionLoop {
  private steps: ValidationStep[]
  private maxIterations: number
  private model: string
  private systemPromptPrefix: string
  private skipFileProtection: boolean
  // Per-project lock to prevent concurrent correction loops
  private activeProjects = new Set<string>()

  constructor(config?: CorrectionConfig) {
    this.maxIterations = config?.maxIterations ?? 3
    this.steps = config?.steps ?? []
    this.model = config?.model ?? 'glm-5.1'
    this.systemPromptPrefix = config?.systemPromptPrefix ?? ''
    this.skipFileProtection = config?.skipFileProtection ?? false
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Run all validation steps on a project directory and return the collected
   * errors. Does NOT attempt any corrections — just validates.
   */
  async validate(projectPath: string, iteration: number = 0): Promise<ValidationError[]> {
    const allErrors: ValidationError[] = []

    // Use default steps if none configured
    const steps = this.steps.length > 0
      ? this.steps
      : createDefaultValidationSteps(projectPath)

    for (const step of steps) {
      // Override cwd with projectPath if the step doesn't specify one
      const cwd = step.cwd || projectPath

      agentEventBus.emit('validation:run', {
        projectPath,
        step: step.name,
        iteration,
      })

      const result = await execWithTimeout(step.command, cwd, step.timeout)

      if (result.timedOut) {
        allErrors.push({
          file: '(timeout)',
          severity: 'error',
          message: `Validation step "${step.name}" timed out after ${step.timeout}ms`,
          source: step.name,
        })
        agentEventBus.emit('validation:error', {
          projectPath,
          step: step.name,
          errors: 1,
          warnings: 0,
        })
        continue
      }

      const stepErrors = step.parseErrors(result.stdout, result.stderr)
      for (const err of stepErrors) {
        err.source = step.name
        // Make file paths relative to projectPath if they are absolute
        if (path.isAbsolute(err.file) && err.file.startsWith(projectPath)) {
          err.file = path.relative(projectPath, err.file)
        }
      }

      allErrors.push(...stepErrors)

      const { errors, warnings } = classifyErrors(stepErrors)
      if (errors.length > 0 || warnings.length > 0) {
        agentEventBus.emit('validation:error', {
          projectPath,
          step: step.name,
          errors: errors.length,
          warnings: warnings.length,
        })
      } else {
        agentEventBus.emit('validation:pass', {
          projectPath,
          step: step.name,
        })
      }
    }

    return deduplicateErrors(allErrors)
  }

  /**
   * Run the full correction loop:
   *   1. Validate → get errors
   *   2. Feed errors to LLM → get fixes
   *   3. Apply fixes (respecting file protection)
   *   4. Re-validate
   *   5. Repeat until clean or max iterations reached
   */
  async correctUntilClean(
    projectPath: string,
    onIteration?: (result: CorrectionResult) => void,
  ): Promise<CorrectionResult> {
    // Prevent concurrent correction loops on the same project
    if (this.activeProjects.has(projectPath)) {
      throw new Error(
        `A correction loop is already running for project: ${projectPath}`,
      )
    }
    this.activeProjects.add(projectPath)

    try {
      return await this._correctUntilClean(projectPath, onIteration)
    } finally {
      this.activeProjects.delete(projectPath)
    }
  }

  /**
   * Format validation errors into a prompt for the LLM.
   * Produces a clear, structured prompt that the LLM can use to generate
   * targeted fixes.
   */
  formatErrorsForPrompt(errors: ValidationError[]): string {
    if (errors.length === 0) {
      return 'No validation errors found. The project is clean.'
    }

    const { errors: errs, warnings } = classifyErrors(errors)

    const parts: string[] = []

    if (errs.length > 0) {
      parts.push(`## Errors (${errs.length})\n`)
      const grouped = groupByFile(errs)
      for (const [file, fileErrors] of grouped) {
        parts.push(`### ${file}`)
        for (const err of fileErrors) {
          const location = err.line
            ? `:${err.line}${err.column ? `:${err.column}` : ''}`
            : ''
          const codeStr = err.code ? ` [${err.code}]` : ''
          parts.push(
            `- ${file}${location}${codeStr}: ${err.message}`,
          )
        }
        parts.push('')
      }
    }

    if (warnings.length > 0) {
      parts.push(`## Warnings (${warnings.length})\n`)
      const grouped = groupByFile(warnings)
      for (const [file, fileErrors] of grouped) {
        parts.push(`### ${file}`)
        for (const err of fileErrors) {
          const location = err.line
            ? `:${err.line}${err.column ? `:${err.column}` : ''}`
            : ''
          const codeStr = err.code ? ` [${err.code}]` : ''
          parts.push(
            `- ${file}${location}${codeStr}: ${err.message} (warning)`,
          )
        }
        parts.push('')
      }
    }

    return parts.join('\n')
  }

  // ── Private implementation ────────────────────────────────────────────────

  private async _correctUntilClean(
    projectPath: string,
    onIteration?: (result: CorrectionResult) => void,
  ): Promise<CorrectionResult> {
    const correctionHistory: CorrectionResult['correctionHistory'] = []
    let totalFixed = 0

    // Initial validation
    let allErrors = await this.validate(projectPath, 0)
    let { errors, warnings } = classifyErrors(allErrors)

    // If already clean, return immediately
    if (errors.length === 0) {
      const result: CorrectionResult = {
        validated: true,
        errors: [],
        warnings,
        iterations: 0,
        maxIterations: this.maxIterations,
        fixedErrors: 0,
        remainingErrors: 0,
        correctionHistory: [],
      }
      onIteration?.(result)
      return result
    }

    // Iterative correction loop
    for (let iteration = 1; iteration <= this.maxIterations; iteration++) {
      const errorsBefore = errors.length

      // Step 1: Generate fixes from LLM
      const fixPrompt = this.buildFixPrompt(projectPath, errors, iteration)
      const fixes = await this.generateFixes(projectPath, fixPrompt, errors)

      // Step 2: Apply fixes (respecting file protection)
      const appliedFixes = await this.applyFixes(projectPath, fixes)

      // Step 3: Re-validate
      allErrors = await this.validate(projectPath, iteration)
      ;({ errors, warnings } = classifyErrors(allErrors))

      const errorsAfter = errors.length
      const fixedInIteration = Math.max(0, errorsBefore - errorsAfter)
      totalFixed += fixedInIteration

      correctionHistory.push({
        iteration,
        errorsBefore,
        errorsAfter,
        fixesApplied: appliedFixes,
      })

      agentEventBus.emit('correction:iteration', {
        projectPath,
        iteration,
        maxIterations: this.maxIterations,
        errorsBefore,
        errorsAfter,
      })

      // Build partial result for callback
      const partialResult: CorrectionResult = {
        validated: errors.length === 0,
        errors,
        warnings,
        iterations: iteration,
        maxIterations: this.maxIterations,
        fixedErrors: totalFixed,
        remainingErrors: errors.length,
        correctionHistory,
      }

      onIteration?.(partialResult)

      // If clean, we're done
      if (errors.length === 0) {
        return partialResult
      }

      // If no progress was made, break early to avoid wasting LLM calls
      if (errorsAfter >= errorsBefore && iteration > 1) {
        break
      }
    }

    return {
      validated: errors.length === 0,
      errors,
      warnings,
      iterations: correctionHistory.length,
      maxIterations: this.maxIterations,
      fixedErrors: totalFixed,
      remainingErrors: errors.length,
      correctionHistory,
    }
  }

  /**
   * Build the system + user prompt pair for the LLM fix generation call.
   */
  private buildFixPrompt(
    projectPath: string,
    errors: ValidationError[],
    iteration: number,
  ): { system: string; user: string } {
    const systemPrompt = [
      this.systemPromptPrefix ||
      'You are an expert code fixer. Your job is to fix validation errors in a codebase.',
      '',
      'Rules:',
      '1. Analyze each error carefully before fixing.',
      '2. Make minimal, targeted fixes — do not rewrite entire files unless necessary.',
      '3. Preserve existing functionality — do not change code that is not related to the error.',
      '4. Output fixes as JSON array of file operations.',
      '5. Each fix must have: { "path": "relative/file/path", "content": "full file content" }',
      '6. Only include files that need to be changed.',
      '7. Do NOT modify configuration files (package.json, tsconfig.json, next.config.*, etc.).',
      '8. Do NOT modify .env files.',
      '',
      'Response format — output ONLY a JSON array:',
      '[',
      '  { "path": "src/components/Button.tsx", "content": "..." },',
      '  { "path": "src/utils/helpers.ts", "content": "..." }',
      ']',
    ].join('\n')

    const errorDescription = this.formatErrorsForPrompt(errors)

    const userPrompt = [
      `Project directory: ${projectPath}`,
      `Correction iteration: ${iteration} of ${this.maxIterations}`,
      '',
      'The following validation errors were found:',
      '',
      errorDescription,
      '',
      'Please fix these errors. Output a JSON array of file operations.',
    ].join('\n')

    return { system: systemPrompt, user: userPrompt }
  }

  /**
   * Call the LLM to generate fixes for the given errors.
   * Returns an array of file operations (path + content).
   */
  private async generateFixes(
    projectPath: string,
    prompt: { system: string; user: string },
    errors: ValidationError[],
  ): Promise<Array<{ path: string; content: string }>> {
    try {
      // Read relevant file contents to give the LLM context
      const fileContexts = await this.readFileContexts(projectPath, errors)

      const messages: ChatMessage[] = [
        { role: 'system', content: prompt.system },
        {
          role: 'user',
          content: [
            prompt.user,
            '',
            'Current file contents for reference:',
            '',
            ...fileContexts,
          ].join('\n'),
        },
      ]

      const provider = llmProviderRegistry.getProviderForModel(this.model)
      if (!provider) {
        console.error(
          `[SelfCorrection] No provider found for model: ${this.model}`,
        )
        return []
      }

      const response = await provider.chat({
        model: this.model,
        messages,
        maxTokens: 8192,
        temperature: 0.2, // Low temperature for precise fixes
      })

      // Parse the JSON response
      return this.parseFixResponse(response.content)
    } catch (err) {
      console.error(
        '[SelfCorrection] LLM fix generation failed:',
        err instanceof Error ? err.message : err,
      )
      return []
    }
  }

  /**
   * Read the content of files that have errors, to provide context to the LLM.
   */
  private async readFileContexts(
    projectPath: string,
    errors: ValidationError[],
  ): Promise<string[]> {
    const uniqueFiles = [...new Set(errors.map((e) => e.file))].filter(
      (f) => f && f !== '(timeout)' && !f.startsWith('('),
    )

    // Limit to 20 files to avoid token overflow
    const filesToRead = uniqueFiles.slice(0, 20)
    const contexts: string[] = []

    for (const file of filesToRead) {
      const absolutePath = path.isAbsolute(file)
        ? file
        : path.join(projectPath, file)

      try {
        const content = await fs.readFile(absolutePath, 'utf-8')
        // Truncate very long files
        const truncated =
          content.length > 8000
            ? content.substring(0, 8000) + '\n... (truncated)'
            : content
        contexts.push(`--- ${file} ---\n\`\`\`\n${truncated}\n\`\`\`\n`)
      } catch {
        // File might not exist or be unreadable — skip
      }
    }

    return contexts
  }

  /**
   * Parse the LLM response into file operations.
   * Handles various output formats (raw JSON, markdown code blocks, etc.).
   */
  private parseFixResponse(
    response: string,
  ): Array<{ path: string; content: string }> {
    // Try to extract JSON from markdown code blocks first
    const jsonBlockMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
    if (jsonBlockMatch) {
      try {
        const parsed = JSON.parse(jsonBlockMatch[1])
        if (Array.isArray(parsed)) {
          return this.validateFixOperations(parsed)
        }
      } catch {
        // Fall through to other parsing methods
      }
    }

    // Try to find a JSON array in the raw response
    const arrayStart = response.indexOf('[')
    const arrayEnd = response.lastIndexOf(']')

    if (arrayStart !== -1 && arrayEnd > arrayStart) {
      try {
        const jsonStr = response.substring(arrayStart, arrayEnd + 1)
        const parsed = JSON.parse(jsonStr)
        if (Array.isArray(parsed)) {
          return this.validateFixOperations(parsed)
        }
      } catch {
        // Fall through
      }
    }

    // Unable to parse any fixes
    return []
  }

  /**
   * Validate and sanitize fix operations from the LLM.
   */
  private validateFixOperations(
    operations: unknown[],
  ): Array<{ path: string; content: string }> {
    const valid: Array<{ path: string; content: string }> = []

    for (const op of operations) {
      if (
        typeof op === 'object' &&
        op !== null &&
        'path' in op &&
        'content' in op &&
        typeof (op as Record<string, unknown>).path === 'string' &&
        typeof (op as Record<string, unknown>).content === 'string'
      ) {
        const { path: filePath, content } = op as {
          path: string
          content: string
        }

        // Basic validation
        if (filePath.trim().length === 0) continue
        if (content.length === 0) continue

        // Path traversal check
        if (filePath.includes('..')) continue

        valid.push({ path: filePath, content })
      }
    }

    return valid
  }

  /**
   * Apply fixes to the project, respecting file protection rules.
   * Returns descriptions of fixes that were actually applied.
   */
  private async applyFixes(
    projectPath: string,
    fixes: Array<{ path: string; content: string }>,
  ): Promise<string[]> {
    if (fixes.length === 0) return []

    const applied: string[] = []

    // Filter through file protection
    let filesToWrite = fixes
    if (!this.skipFileProtection) {
      const { allowed, blocked } = fileProtectionManager.filterWriteOperations(fixes)
      filesToWrite = allowed

      for (const blockedFile of blocked) {
        console.warn(
          `[SelfCorrection] Blocked write to protected file: ${blockedFile.path} (${blockedFile.reason})`,
        )
      }
    }

    // Apply each fix
    for (const fix of filesToWrite) {
      const absolutePath = path.isAbsolute(fix.path)
        ? fix.path
        : path.join(projectPath, fix.path)

      try {
        // Ensure directory exists
        const dir = path.dirname(absolutePath)
        await fs.mkdir(dir, { recursive: true })

        // Write the file
        await fs.writeFile(absolutePath, fix.content, 'utf-8')
        applied.push(fix.path)
      } catch (err) {
        console.error(
          `[SelfCorrection] Failed to write fix to ${fix.path}:`,
          err instanceof Error ? err.message : err,
        )
      }
    }

    return applied
  }

  // ── Configuration ─────────────────────────────────────────────────────────

  /**
   * Add a validation step to the pipeline.
   */
  addStep(step: ValidationStep): void {
    this.steps.push(step)
  }

  /**
   * Remove a validation step by name.
   */
  removeStep(name: string): void {
    this.steps = this.steps.filter((s) => s.name !== name)
  }

  /**
   * Get the current validation steps.
   */
  getSteps(): ValidationStep[] {
    return [...this.steps]
  }

  /**
   * Set the maximum number of correction iterations.
   */
  setMaxIterations(max: number): void {
    this.maxIterations = Math.max(1, max)
  }

  /**
   * Set the LLM model to use for fix generation.
   */
  setModel(model: string): void {
    this.model = model
  }

  /**
   * Check if a correction loop is currently active for a project.
   */
  isActive(projectPath: string): boolean {
    return this.activeProjects.has(projectPath)
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function groupByFile(
  errors: ValidationError[],
): Map<string, ValidationError[]> {
  const map = new Map<string, ValidationError[]>()
  for (const err of errors) {
    const existing = map.get(err.file) || []
    existing.push(err)
    map.set(err.file, existing)
  }
  return map
}

// ── Singleton ──────────────────────────────────────────────────────────────────

export const selfCorrectionLoop = new SelfCorrectionLoop()
