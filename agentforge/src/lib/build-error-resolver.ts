/**
 * Build Error Resolver (ECC Pattern #2)
 * 3-attempt cap per error, stop if more errors introduced, success metrics.
 */
import { exec } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import { promisify } from 'util'
import { agentEventBus } from './event-bus'
import { readProjectFile, writeProjectFile } from './filesystem'
import { parseBuildErrors } from './verification'

const execAsync = promisify(exec)

export interface BuildError { file: string; line?: number; column?: number; code?: string; message: string; raw: string }
export interface FixAttempt { attemptNumber: number; error: BuildError; fixDescription: string; filesModified: string[]; linesChanged: number; succeeded: boolean; newErrorsIntroduced: number }
export interface BuildFixResult { resolved: boolean; stopReason: 'all-fixed' | 'max-attempts' | 'more-errors-than-fixed' | 'architectural-scope' | 'no-errors'; attempts: FixAttempt[]; totalErrorsBefore: number; totalErrorsAfter: number; filesModified: string[]; report: string }
export interface BuildFixConfig { maxAttemptsPerError: number; maxTotalAttempts: number; buildCommand: string; typecheckCommand: string; buildTimeoutMs: number; workspaceDir: string; projectId: string }

export const DEFAULT_BUILD_FIX_CONFIG: Omit<BuildFixConfig, 'workspaceDir' | 'projectId'> = {
  maxAttemptsPerError: 3, maxTotalAttempts: 20, buildCommand: 'npm run build 2>&1', typecheckCommand: 'npx tsc --noEmit 2>&1', buildTimeoutMs: 120000,
}

async function runBuild(config: BuildFixConfig): Promise<{ success: boolean; output: string; errors: BuildError[] }> {
  try {
    const r = await execAsync(config.typecheckCommand, { cwd: config.workspaceDir, timeout: config.buildTimeoutMs, maxBuffer: 5 * 1024 * 1024 })
    return { success: true, output: (r.stdout || '') + (r.stderr || ''), errors: [] }
  } catch (err) {
    const e = err as Error & { stdout?: string; stderr?: string; killed?: boolean }
    if (e.killed) return { success: false, output: 'timeout', errors: [{ file: '', message: 'Build timed out', raw: 'timeout' }] }
    const output = [e.stdout, e.stderr].filter(Boolean).join('\n')
    return { success: false, output, errors: parseBuildErrors(output) }
  }
}

const fixStrategies: Array<{ desc: string; apply: (err: BuildError, pid: string) => Promise<{ applied: boolean; lines: number }> }> = [
  { desc: 'Add missing import', apply: async (err, pid) => {
    const m = err.message.match(/Cannot (?:find name|find module)\s+['"]?([^'"\s.]+)['"]?/)
    if (!m) return { applied: false, lines: 0 }
    try {
      const c = await readProjectFile(pid, err.file)
      if (c.includes(`import ${m[1]}`)) return { applied: false, lines: 0 }
      const lines = c.split('\n'); let idx = 0
      for (let i = 0; i < lines.length; i++) { if (lines[i].startsWith('import ')) idx = i + 1; else if (idx > 0) break }
      lines.splice(idx, 0, `import ${m[1]} from '${m[1]}'`)
      await writeProjectFile(pid, err.file, lines.join('\n'))
      return { applied: true, lines: 1 }
    } catch { return { applied: false, lines: 0 } }
  }},
  { desc: 'Add semicolon', apply: async (err, pid) => {
    if (!err.line || !err.message.match(/';' expected/)) return { applied: false, lines: 0 }
    try {
      const c = await readProjectFile(pid, err.file); const lines = c.split('\n'); const li = err.line - 1
      if (li < 0 || li >= lines.length) return { applied: false, lines: 0 }
      if (!lines[li].trimEnd().endsWith(';') && !lines[li].trimEnd().endsWith('{')) { lines[li] = lines[li].replace(/\s*$/, ';'); await writeProjectFile(pid, err.file, lines.join('\n')); return { applied: true, lines: 1 } }
      return { applied: false, lines: 0 }
    } catch { return { applied: false, lines: 0 } }
  }},
]

export async function resolveBuildErrors(config: BuildFixConfig, onProgress?: (a: FixAttempt) => void): Promise<BuildFixResult> {
  const attempts: FixAttempt[] = []; const modified = new Set<string>()
  const initial = await runBuild(config); const before = initial.errors.length
  if (before === 0) return { resolved: true, stopReason: 'no-errors', attempts: [], totalErrorsBefore: 0, totalErrorsAfter: 0, filesModified: [], report: '✅ No build errors.' }
  let current = initial.errors; let total = 0; const counts = new Map<string, number>()
  while (current.length > 0 && total < config.maxTotalAttempts) {
    const err = current[0]!; const key = `${err.file}:${err.line}:${err.code}`; const cnt = (counts.get(key) || 0) + 1; counts.set(key, cnt)
    if (cnt > config.maxAttemptsPerError) return { resolved: false, stopReason: 'max-attempts', attempts, totalErrorsBefore: before, totalErrorsAfter: current.length, filesModified: [...modified], report: `❌ Stopped: same error after ${config.maxAttemptsPerError} attempts.\n${err.raw}` }
    let applied = false; let desc = ''; let lines = 0
    for (const s of fixStrategies) { const r = await s.apply(err, config.projectId); if (r.applied) { applied = true; desc = s.desc; lines = r.lines; modified.add(err.file); break } }
    if (!applied) { const a: FixAttempt = { attemptNumber: total + 1, error: err, fixDescription: 'No automatic fix', filesModified: [], linesChanged: 0, succeeded: false, newErrorsIntroduced: 0 }; attempts.push(a); onProgress?.(a); return { resolved: false, stopReason: 'architectural-scope', attempts, totalErrorsBefore: before, totalErrorsAfter: current.length, filesModified: [...modified], report: `❌ Stopped: architectural scope.\n${err.raw}` } }
    const after = await runBuild(config); const newErrs = after.errors.filter(e => !current.some(c => c.file === e.file && c.line === e.line && c.code === e.code)).length
    const a: FixAttempt = { attemptNumber: total + 1, error: err, fixDescription: desc, filesModified: [err.file], linesChanged: lines, succeeded: after.errors.length < current.length, newErrorsIntroduced: newErrs }; attempts.push(a); onProgress?.(a)
    if (after.errors.length > current.length) return { resolved: false, stopReason: 'more-errors-than-fixed', attempts, totalErrorsBefore: before, totalErrorsAfter: after.errors.length, filesModified: [...modified], report: `❌ Stopped: more errors introduced.\nBefore: ${current.length}, After: ${after.errors.length}` }
    current = after.errors; total++
  }
  const resolved = current.length === 0
  return { resolved, stopReason: resolved ? 'all-fixed' : 'max-attempts', attempts, totalErrorsBefore: before, totalErrorsAfter: current.length, filesModified: [...modified], report: resolved ? `✅ Fixed ${before} error(s) in ${total} attempt(s).` : `❌ ${current.length} error(s) remaining after ${total} attempts.` }
}

export async function canRunBuildFix(workspaceDir: string): Promise<boolean> {
  try { await fs.access(path.join(workspaceDir, 'package.json')); return true } catch { return false }
}
