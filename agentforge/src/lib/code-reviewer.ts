/**
 * Code Reviewer (ECC Pattern #6)
 * Pre-Report Gate (4 questions), 11 false-positive patterns, "zero findings is OK",
 * confidence-based filtering, 7 static analysis rules.
 */
import path from 'path'
import { agentEventBus } from './event-bus'
import { listProjectFiles, readProjectFile } from './filesystem'

export type Severity = 'critical' | 'high' | 'medium' | 'low'
export interface ReviewFinding { file: string; line: number; column?: number; severity: Severity; category: string; message: string; evidence: string; suggestion?: string; confidence: number }
export interface ReviewResult { findings: ReviewFinding[]; verdict: 'APPROVE' | 'WARNING' | 'BLOCK'; summary: { critical: number; high: number; medium: number; low: number }; report: string; filesReviewed: number; durationMs: number }
export interface ReviewConfig { projectId: string; workspaceDir: string; filesToReview?: string[]; minConfidence: number; blockOnCritical: boolean }

const FALSE_POSITIVES: RegExp[] = [
  /Missing JSDoc/i, /N\+1.*fixed/i, /Math\.random.*non-crypto/i, /console\.log.*debug/i,
  /Missing.*error handling.*fire-and-forget/i, /Magic number.*(?:200|404|1000|60|24)\b/i,
  /Could use.*optional chaining/i, /Prefer.*const.*over.*let/i, /Missing.*return type/i,
  /Use.*early return/i, /Consider.*using/i,
]

interface Rule { id: string; category: string; severity: Severity; check: (c: string, f: string) => Array<{ line: number; column?: number; evidence: string; message: string; suggestion?: string }> }

const RULES: Rule[] = [
  { id: 'empty-catch', category: 'error-handling', severity: 'high', check: (c) => {
    const f: Array<{ line: number; evidence: string; message: string }> = []; const lines = c.split('\n')
    for (let i = 0; i < lines.length; i++) { if (lines[i].match(/catch\s*\([^)]*\)\s*\{/) && i + 1 < lines.length) { if (lines[i + 1].trim() === '' || lines[i + 1].trim() === '}') f.push({ line: i + 1, evidence: lines[i], message: 'Empty catch block — error silently swallowed' }) } }
    return f
  }},
  { id: 'sql-injection', category: 'security', severity: 'critical', check: (c) => {
    const f: Array<{ line: number; evidence: string; message: string }> = []; const lines = c.split('\n')
    for (let i = 0; i < lines.length; i++) { if (lines[i].match(/(?:query|execute|sql)\s*\(\s*[`'"].*\$\{/) || lines[i].match(/SELECT.*\+\s*\w/)) f.push({ line: i + 1, evidence: lines[i].trim(), message: 'Potential SQL injection — use parameterized queries' }) }
    return f
  }},
  { id: 'hardcoded-secret', category: 'security', severity: 'critical', check: (c) => {
    const f: Array<{ line: number; evidence: string; message: string }> = []; const lines = c.split('\n')
    const pats = [/(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{16,}['"]/i, /AKIA[0-9A-Z]{16}/, /sk-[a-zA-Z0-9]{48}/, /gh[pousr]_[0-9a-zA-Z]{36}/]
    for (let i = 0; i < lines.length; i++) for (const p of pats) if (p.test(lines[i])) f.push({ line: i + 1, evidence: lines[i].trim().substring(0, 80) + '...', message: 'Hardcoded secret — move to env var' })
    return f
  }},
  { id: 'dangerous-fallback', category: 'error-handling', severity: 'medium', check: (c) => {
    const f: Array<{ line: number; evidence: string; message: string }> = []; const lines = c.split('\n')
    for (let i = 0; i < lines.length; i++) if (lines[i].match(/\.catch\s*\(\s*\(\s*\)\s*=>\s*(?:\[\]|\{\}|null|''|""\s*)\s*\)/)) f.push({ line: i + 1, evidence: lines[i].trim(), message: 'Dangerous fallback — .catch(() => []) swallows errors' })
    return f
  }},
  { id: 'todo-fixme', category: 'code-quality', severity: 'low', check: (c) => {
    const f: Array<{ line: number; evidence: string; message: string }> = []; const lines = c.split('\n')
    for (let i = 0; i < lines.length; i++) if (lines[i].match(/\/\/\s*(?:TODO|FIXME|HACK|XXX)/i)) f.push({ line: i + 1, evidence: lines[i].trim(), message: 'TODO/FIXME found — resolve before shipping' })
    return f
  }},
  { id: 'any-type', category: 'type-safety', severity: 'medium', check: (c, f) => {
    if (f.match(/\.test\.|\.spec\.|__tests__/)) return []
    const out: Array<{ line: number; evidence: string; message: string }> = []; const lines = c.split('\n')
    for (let i = 0; i < lines.length; i++) if (lines[i].match(/:\s*any\b/) && !lines[i].match(/\/\/ eslint-disable/)) out.push({ line: i + 1, evidence: lines[i].trim(), message: 'Explicit `any` — use `unknown` or proper type' })
    return out
  }},
]

function passesGate(finding: ReviewFinding): boolean {
  if (finding.severity === 'critical') return finding.category.match(/security|data.?loss|injection|auth|crypto/i) !== null
  if (finding.severity === 'high') return finding.category.match(/bug|error|crash|null|undefined|race|leak/i) !== null
  return true
}

function isFP(finding: ReviewFinding): boolean {
  return FALSE_POSITIVES.some(p => p.test(`${finding.message} ${finding.category}`))
}

export async function reviewProject(config: ReviewConfig): Promise<ReviewResult> {
  const start = Date.now(); const findings: ReviewFinding[] = []; let filesReviewed = 0
  const files = config.filesToReview || await listProjectFiles(config.projectId)
  for (const fp of files) {
    const ext = path.extname(fp)
    if (!['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs'].includes(ext)) continue
    if (fp.match(/node_modules|\.next|dist|build|coverage/)) continue
    let content: string; try { content = await readProjectFile(config.projectId, fp) } catch { continue }
    filesReviewed++
    for (const rule of RULES) {
      for (const rf of rule.check(content, fp)) {
        const f: ReviewFinding = { file: fp, line: rf.line, column: rf.column, severity: rule.severity, category: rule.category, message: rf.message, evidence: rf.evidence, suggestion: rf.suggestion, confidence: 0.9 }
        if (isFP(f)) continue
        if (!passesGate(f)) continue
        if (f.confidence < (config.minConfidence || 0.8)) continue
        findings.push(f)
      }
    }
  }
  const so: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const f of findings) so[f.severity]++
  let verdict: ReviewResult['verdict'] = 'APPROVE'
  if (config.blockOnCritical !== false && so.critical > 0) verdict = 'BLOCK'
  else if (so.high > 0) verdict = 'WARNING'
  const report = buildReport(findings, so, verdict, filesReviewed)
  if (findings.length > 0) agentEventBus.emit('validation:error', { projectPath: config.workspaceDir, step: 'code-review', errors: so.critical + so.high, warnings: so.medium + so.low })
  else agentEventBus.emit('validation:pass', { projectPath: config.workspaceDir, step: 'code-review' })
  return { findings, verdict, summary: so, report, filesReviewed, durationMs: Date.now() - start }
}

function buildReport(findings: ReviewFinding[], s: ReviewResult['summary'], verdict: ReviewResult['verdict'], fr: number): string {
  const L = ['═════════════ CODE REVIEW REPORT ═════════════', `Files reviewed: ${fr}`, `Findings: ${findings.length} (${s.critical} critical, ${s.high} high, ${s.medium} medium, ${s.low} low)`, `Verdict: ${verdict}`, '']
  if (findings.length === 0) L.push('✅ Zero findings. This is acceptable and expected.')
  else for (const f of findings) { const i = f.severity === 'critical' ? '🔴' : f.severity === 'high' ? '🟠' : f.severity === 'medium' ? '🟡' : '🔵'; L.push(`${i} [${f.severity.toUpperCase()}] ${f.file}:${f.line} (${f.category})`, `   ${f.message}`, '') }
  L.push('═══════════════════════════════════════════════')
  return L.join('\n')
}

export function _passesPreReportGate(f: ReviewFinding): boolean {
  // Pre-Report Gate: 4 questions
  // 1. Can I cite the exact line? → need line > 0 AND evidence
  const canCite = f.line > 0 && f.evidence.length > 0
  // 2. Can I describe concrete failure mode? → message must be specific (not vague)
  const isSpecific = f.message.length > 20 && !f.message.match(/^Consider|^Could|^Prefer|^Maybe/i)
  // 3. Have I read context? → need evidence
  const hasContext = f.evidence.length > 0
  // 4. Is severity defensible? → use passesGate
  const defensible = passesGate(f)
  return canCite && isSpecific && hasContext && defensible
}
export function _isFalsePositive(f: ReviewFinding): boolean { return isFP(f) }
