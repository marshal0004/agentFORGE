/**
 * Per-Edit Typecheck Hook (ECC Pattern #5 — Layer A)
 * After every write_file on .ts/.tsx, runs tsc --noEmit, feeds filtered errors back.
 * Non-blocking — the write succeeded, but the LLM sees the typecheck feedback.
 */
import { exec } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import { promisify } from 'util'

const execAsync = promisify(exec)

export interface TypecheckError { file: string; line: number; column: number; code: string; message: string }
export interface TypecheckResult { filePath: string; hasErrors: boolean; errorCount: number; errors: TypecheckError[]; durationMs: number; rawOutput: string }

const TC_TIMEOUT = 30000
const TCABLE_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']

export function shouldTypecheck(filePath: string): boolean {
  return TCABLE_EXTS.includes(path.extname(filePath))
}

async function findTsConfigDir(startPath: string): Promise<string | null> {
  let current = path.dirname(startPath)
  const root = path.parse(current).root
  while (current !== root) {
    try { await fs.access(path.join(current, 'tsconfig.json')); return current } catch { current = path.dirname(current) }
  }
  return null
}

export async function typecheckAfterEdit(filePath: string): Promise<TypecheckResult> {
  const start = Date.now()
  if (!shouldTypecheck(filePath)) return { filePath, hasErrors: false, errorCount: 0, errors: [], durationMs: 0, rawOutput: '' }
  const tsconfigDir = await findTsConfigDir(filePath)
  if (!tsconfigDir) return { filePath, hasErrors: false, errorCount: 0, errors: [], durationMs: 0, rawOutput: 'No tsconfig.json found' }
  try {
    await execAsync('npx tsc --noEmit 2>&1', { cwd: tsconfigDir, timeout: TC_TIMEOUT, maxBuffer: 2 * 1024 * 1024 })
    return { filePath, hasErrors: false, errorCount: 0, errors: [], durationMs: Date.now() - start, rawOutput: '' }
  } catch (err) {
    const e = err as Error & { stdout?: string; stderr?: string; killed?: boolean }
    if (e.killed) return { filePath, hasErrors: false, errorCount: 0, errors: [], durationMs: Date.now() - start, rawOutput: `Timed out after ${TC_TIMEOUT}ms` }
    const output = [e.stdout, e.stderr].filter(Boolean).join('\n')
    const allErrors: TypecheckError[] = []
    const re = /^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)$/gm
    let m: RegExpExecArray | null
    while ((m = re.exec(output)) !== null) allErrors.push({ file: m[1]!, line: +m[2]!, column: +m[3]!, code: m[4]!, message: m[5]! })
    const rel = path.relative(tsconfigDir, filePath)
    const filtered = allErrors.filter(e => { const er = path.relative(tsconfigDir, e.file); return er === rel || e.file === filePath || e.file.endsWith(rel) })
    return { filePath, hasErrors: filtered.length > 0, errorCount: filtered.length, errors: filtered, durationMs: Date.now() - start, rawOutput: output }
  }
}

export function formatTypecheckWarning(result: TypecheckResult): string {
  if (!result.hasErrors) return ''
  return [`⚠️ TypeScript errors in ${path.basename(result.filePath)}:`, ...result.errors.map(e => `  L${e.line}:${e.column} [${e.code}] ${e.message}`), '', 'Fix these before writing the next file.'].join('\n')
}

export function formatForToolResult(result: TypecheckResult): string {
  return formatTypecheckWarning(result)
}
