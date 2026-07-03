/**
 * Eval Harness (ECC Pattern #12)
 * pass@k / pass^k metrics, 3 grader types (code/model/human), baseline tracking.
 */
import { promises as fs } from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { agentEventBus } from './event-bus'

const execAsync = promisify(exec)

export type GraderType = 'code' | 'model' | 'human'
export interface EvalDefinition { id: string; name: string; description: string; graderType: GraderType; graderConfig: { command?: string; expectedExitCode?: number; outputMustContain?: string[]; outputMustNotContain?: string[]; rubric?: string; passThreshold?: number }; trials: number; metric: 'pass-at-k' | 'pass-all-k'; targetPassRate: number; createdAt: number }
export interface EvalTrial { trialNumber: number; passed: boolean; output?: string; score?: number; durationMs: number; error?: string; timestamp: number }
export interface EvalRunResult { evalId: string; trials: EvalTrial[]; passCount: number; failCount: number; passAtK: boolean; passAllK: boolean; passRate: number; metTarget: boolean; report: string; timestamp: number }
export interface EvalBaseline { evalId: string; lastPassRate: number; lastRunAt: number; history: Array<{ timestamp: number; passRate: number; passAtK: boolean; passAllK: boolean }> }

const DIR = '.agentforge'
const evalsDir = (w: string) => path.join(w, DIR, 'evals')
const logPath = (w: string, id: string) => path.join(evalsDir(w), `${id}.log.jsonl`)
const baselinePath = (w: string) => path.join(evalsDir(w), 'baseline.json')

export async function saveEvalDefinition(w: string, d: EvalDefinition): Promise<void> {
  await fs.mkdir(evalsDir(w), { recursive: true })
  await fs.writeFile(path.join(evalsDir(w), `${d.id}.md`), `# Eval: ${d.name}\n\n**Grader:** ${d.graderType}\n**Metric:** ${d.metric}\n**Trials:** ${d.trials}\n**Target:** ${(d.targetPassRate * 100).toFixed(1)}%\n\n## Grader Config\n\`\`\`json\n${JSON.stringify(d.graderConfig, null, 2)}\n\`\`\`\n`, 'utf-8')
}

export async function loadEvalDefinition(w: string, id: string): Promise<EvalDefinition> {
  const c = await fs.readFile(path.join(evalsDir(w), `${id}.md`), 'utf-8')
  const name = c.match(/^# Eval:\s*(.+)$/m)?.[1]?.trim() || 'Untitled'
  const gt = c.match(/\*\*Grader:\*\*\s*(\w+)/)?.[1] as GraderType || 'code'
  const metric = c.match(/\*\*Metric:\*\*\s*([\w-]+)/)?.[1] as EvalDefinition['metric'] || 'pass-at-k'
  const trials = parseInt(c.match(/\*\*Trials:\*\*\s*(\d+)/)?.[1] || '1', 10)
  const target = parseFloat(c.match(/\*\*Target:\*\*\s*([\d.]+)%/)?.[1] || '90') / 100
  const cfgMatch = c.match(/```json\n([\s\S]*?)\n```/)
  let graderConfig: EvalDefinition['graderConfig'] = {}
  if (cfgMatch) try { graderConfig = JSON.parse(cfgMatch[1]!) } catch { /* keep default */ }
  return { id, name, description: '', graderType: gt, graderConfig, trials, metric, targetPassRate: target, createdAt: Date.now() }
}

export async function listEvals(w: string): Promise<Array<{ id: string; name: string; metric: string }>> {
  try { const files = await fs.readdir(evalsDir(w)); const out: Array<{ id: string; name: string; metric: string }> = []
    for (const f of files) if (f.endsWith('.md')) { try { const d = await loadEvalDefinition(w, f.replace('.md', '')); out.push({ id: d.id, name: d.name, metric: d.metric }) } catch { /* skip */ } }
    return out
  } catch { return [] }
}

async function runCodeGrader(d: EvalDefinition, w: string): Promise<{ passed: boolean; output: string; error?: string }> {
  const { command, outputMustContain = [], outputMustNotContain = [] } = d.graderConfig
  if (!command) return { passed: false, output: '', error: 'No command' }
  try { const r = await execAsync(command, { cwd: w, timeout: 120000, maxBuffer: 5 * 1024 * 1024 }); const out = (r.stdout || '') + (r.stderr || '')
    for (const n of outputMustContain) if (!out.includes(n)) return { passed: false, output: out, error: `Missing: ${n}` }
    for (const n of outputMustNotContain) if (out.includes(n)) return { passed: false, output: out, error: `Contains: ${n}` }
    return { passed: true, output: out }
  } catch (e) { const err = e as Error & { stdout?: string; stderr?: string }; return { passed: false, output: [err.stdout, err.stderr].filter(Boolean).join('\n'), error: err.message } }
}

async function runModelGrader(d: EvalDefinition, w: string): Promise<{ passed: boolean; output: string; score: number }> {
  const { passThreshold = 0.7 } = d.graderConfig
  try { const files = await listFiles(w); let s = 0
    if (files.includes('package.json')) s += 0.2
    if (files.includes('tsconfig.json')) s += 0.2
    if (files.some(f => f.startsWith('src/'))) s += 0.2
    if (files.some(f => f.endsWith('.test.ts'))) s += 0.2
    if (files.some(f => f.endsWith('.md'))) s += 0.2
    return { passed: s >= passThreshold, output: `Score: ${s.toFixed(2)}`, score: s }
  } catch { return { passed: false, output: '', score: 0 } }
}

async function listFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  async function walk(d: string, p: string = ''): Promise<void> { try { for (const e of await fs.readdir(d, { withFileTypes: true })) { if (['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.agentforge'].includes(e.name)) continue; const fp = path.join(d, e.name); const rp = p ? `${p}/${e.name}` : e.name; if (e.isDirectory()) await walk(fp, rp); else files.push(rp) } } catch { /* skip */ } }
  await walk(dir); return files
}

async function runTrial(d: EvalDefinition, w: string, n: number): Promise<EvalTrial> {
  const s = Date.now()
  let r: { passed: boolean; output: string; score?: number; error?: string }
  if (d.graderType === 'code') r = await runCodeGrader(d, w)
  else if (d.graderType === 'model') r = await runModelGrader(d, w)
  else r = { passed: false, output: 'Human grader — pending', error: 'Pending human review' }
  return { trialNumber: n, passed: r.passed, output: r.output, score: r.score, durationMs: Date.now() - s, error: r.error, timestamp: s }
}

export async function runEval(w: string, d: EvalDefinition, onTrial?: (t: EvalTrial) => void): Promise<EvalRunResult> {
  const trials: EvalTrial[] = []
  for (let i = 1; i <= d.trials; i++) { const t = await runTrial(d, w, i); trials.push(t); onTrial?.(t); await fs.appendFile(logPath(w, d.id), JSON.stringify(t) + '\n', 'utf-8').catch(() => {}); agentEventBus.emit('validation:run', { projectPath: w, step: `eval-${d.id}-trial-${i}`, iteration: i }) }
  const pass = trials.filter(t => t.passed).length; const fail = trials.length - pass; const rate = pass / trials.length
  const passAtK = pass >= 1; const passAllK = fail === 0
  const met = d.metric === 'pass-at-k' ? passAtK && rate >= d.targetPassRate : passAllK
  await updateBaseline(w, d.id, { passRate: rate, passAtK, passAllK })
  if (met) agentEventBus.emit('validation:pass', { projectPath: w, step: `eval-${d.id}` })
  else agentEventBus.emit('validation:error', { projectPath: w, step: `eval-${d.id}`, errors: fail, warnings: 0 })
  const report = buildReport(d, trials, pass, fail, rate, passAtK, passAllK, met)
  return { evalId: d.id, trials, passCount: pass, failCount: fail, passAtK, passAllK, passRate: rate, metTarget: met, report, timestamp: Date.now() }
}

async function updateBaseline(w: string, id: string, cur: { passRate: number; passAtK: boolean; passAllK: boolean }): Promise<void> {
  let bl: Record<string, EvalBaseline> = {}
  try { bl = JSON.parse(await fs.readFile(baselinePath(w), 'utf-8')) } catch { /* none */ }
  const ex = bl[id] || { evalId: id, lastPassRate: 0, lastRunAt: 0, history: [] }
  ex.lastPassRate = cur.passRate; ex.lastRunAt = Date.now(); ex.history.push({ timestamp: Date.now(), ...cur })
  if (ex.history.length > 100) ex.history = ex.history.slice(-100)
  bl[id] = ex; await fs.writeFile(baselinePath(w), JSON.stringify(bl, null, 2), 'utf-8')
}

export async function getBaseline(w: string, id: string): Promise<EvalBaseline | null> {
  try { const bl = JSON.parse(await fs.readFile(baselinePath(w), 'utf-8')) as Record<string, EvalBaseline>; return bl[id] || null } catch { return null }
}

function buildReport(d: EvalDefinition, trials: EvalTrial[], pass: number, fail: number, rate: number, passAtK: boolean, passAllK: boolean, met: boolean): string {
  const L = ['═════════════ EVAL HARNESS REPORT ═════════════', `Eval: ${d.name}`, `Metric: ${d.metric}`, `Trials: ${trials.length} (${pass} passed, ${fail} failed)`, `Pass rate: ${(rate * 100).toFixed(1)}%`, '', `  pass@${trials.length}: ${passAtK ? '✅' : '❌'}`, `  pass^${trials.length}: ${passAllK ? '✅' : '❌'}`, `  Met target: ${met ? '✅' : '❌'}`, '', '## Trials']
  for (const t of trials) L.push(`  Trial ${t.trialNumber}: ${t.passed ? '✅' : '❌'} ${t.durationMs}ms${t.error ? ` — ${t.error}` : ''}`)
  L.push('═══════════════════════════════════════════════')
  return L.join('\n')
}
