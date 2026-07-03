/**
 * GAN Harness (ECC Pattern #3 — crown jewel)
 * Generator↔Evaluator loop with separate contexts, file-based feedback, plateau detection.
 */
import { promises as fs } from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { agentEventBus } from './event-bus'

const execAsync = promisify(exec)

export type EvalAxis = 'design' | 'originality' | 'craft' | 'functionality'
export const AXIS_WEIGHTS: Record<EvalAxis, number> = { design: 0.3, originality: 0.2, craft: 0.3, functionality: 0.2 }

export interface AxisScore { axis: EvalAxis; score: number; weight: number; feedback: string; evidence: string[] }
export interface GANEvaluation { iteration: number; axisScores: AxisScore[]; totalScore: number; verdict: 'pass' | 'fail' | 'plateau'; summary: string; strengths: string[]; weaknesses: string[]; suggestedFixes: string[]; timestamp: number }
export interface GANIteration { iterationNumber: number; evaluation: GANEvaluation; feedbackFilePath: string; durationMs: number }
export interface GANResult { iterations: GANIteration[]; finalScore: number; finalVerdict: 'pass' | 'fail' | 'plateau' | 'max-iterations'; totalDurationMs: number; report: string }
export interface GANConfig { workspaceDir: string; specPath: string; maxIterations: number; passThreshold: number; plateauWindow: number; minIterationsBeforePlateau: number; evalMode: 'playwright' | 'code-only' | 'screenshot'; devServerCommand?: string; devServerPort?: number; devServerTimeoutMs?: number }

export const DEFAULT_GAN_CONFIG: Omit<GANConfig, 'workspaceDir' | 'specPath'> = { maxIterations: 15, passThreshold: 7.0, plateauWindow: 2, minIterationsBeforePlateau: 3, evalMode: 'code-only', devServerTimeoutMs: 30000 }

function feedbackDir(w: string) { return path.join(w, 'gan-harness', 'feedback') }

async function writeFeedback(w: string, ev: GANEvaluation): Promise<string> {
  const d = feedbackDir(w); await fs.mkdir(d, { recursive: true })
  const f = path.join(d, `feedback-${String(ev.iteration).padStart(3, '0')}.md`)
  await fs.writeFile(f, `# GAN Evaluation — Iteration ${ev.iteration}\n\n**Score:** ${ev.totalScore.toFixed(2)}/10\n**Verdict:** ${ev.verdict}\n\n${ev.axisScores.map(a => `- **${a.axis}** (${a.score.toFixed(1)}/10): ${a.feedback}`).join('\n')}\n\n## Suggested Fixes\n${ev.suggestedFixes.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n`, 'utf-8')
  return f
}

async function readPrevFeedback(w: string, n: number): Promise<string> {
  try { const files = (await fs.readdir(feedbackDir(w))).filter(f => f.startsWith('feedback-')).sort().reverse().slice(0, n); const out: string[] = []
    for (const f of files) try { out.push(`--- ${f} ---\n${await fs.readFile(path.join(feedbackDir(w), f), 'utf-8')}`) } catch { /* skip */ }
    return out.join('\n\n')
  } catch { return '' }
}

async function listFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  async function walk(d: string, p: string = ''): Promise<void> {
    try { for (const e of await fs.readdir(d, { withFileTypes: true })) { if (['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.agentforge'].includes(e.name)) continue; const fp = path.join(d, e.name); const rp = p ? `${p}/${e.name}` : e.name; if (e.isDirectory()) await walk(fp, rp); else files.push(rp) } } catch { /* skip */ }
  }
  await walk(dir); return files
}

async function evalDesign(w: string): Promise<{ score: number; feedback: string; evidence: string[] }> {
  const ev: string[] = []; let s = 5
  try { const f = await listFiles(w)
    if (f.includes('package.json')) { s += 0.5; ev.push('Good: package.json') } else ev.push('Missing: package.json')
    if (f.includes('tsconfig.json')) { s += 0.5; ev.push('Good: tsconfig.json') }
    if (f.some(x => x.startsWith('src/'))) { s += 0.5; ev.push('Good: src/ dir') }
    if (f.some(x => x.endsWith('.css') || x.endsWith('.scss'))) { s += 0.5; ev.push('Good: CSS') } else { s -= 1; ev.push('Missing: CSS') }
  } catch { s = 0 }
  return { score: Math.max(0, Math.min(10, s)), feedback: `Design: ${s.toFixed(1)}/10`, evidence: ev }
}

async function evalOriginality(w: string): Promise<{ score: number; feedback: string; evidence: string[] }> {
  const ev: string[] = []; let s = 5
  try { const f = await listFiles(w); const bp = ['package.json', 'tsconfig.json', 'next.config.js', 'README.md']; const u = f.filter(x => !bp.includes(x) && !x.includes('node_modules'))
    if (u.length === 0) { s = 2; ev.push('Poor: only boilerplate') } else { s += u.length * 0.3; ev.push(`Good: ${u.length} custom files`) }
  } catch { s = 0 }
  return { score: Math.max(0, Math.min(10, s)), feedback: `Originality: ${s.toFixed(1)}/10`, evidence: ev }
}

async function evalCraft(w: string): Promise<{ score: number; feedback: string; evidence: string[] }> {
  const ev: string[] = []; let s = 5
  try { const f = await listFiles(w); const ts = f.filter(x => x.endsWith('.ts') || x.endsWith('.tsx')); let tl = 0, eh = 0, any = 0, todo = 0
    for (const file of ts) { try { const c = await fs.readFile(path.join(w, file), 'utf-8'); tl += c.split('\n').length; if (c.match(/try\s*\{|catch\s*\(/)) eh++; any += (c.match(/:\s*any\b/g) || []).length; todo += (c.match(/\/\/\s*(?:TODO|FIXME)/gi) || []).length } catch { /* skip */ } }
    if (eh > 0) { s += 1; ev.push('Good: error handling') } else { ev.push('Missing: no error handling'); s -= 0.5 }
    if (any > 0) { s -= 0.5 * Math.min(any, 3); ev.push(`Poor: ${any} any types`) }
    if (todo > 0) { s -= 0.3 * Math.min(todo, 3); ev.push(`Poor: ${todo} TODOs`) }
    if (tl > 100) { s += 0.5; ev.push(`Good: ${tl} lines`) }
  } catch { s = 0 }
  return { score: Math.max(0, Math.min(10, s)), feedback: `Craft: ${s.toFixed(1)}/10`, evidence: ev }
}

async function evalFunctionality(w: string): Promise<{ score: number; feedback: string; evidence: string[] }> {
  const ev: string[] = []; let s = 3
  try { if (!await fs.access(path.join(w, 'package.json')).then(() => true).catch(() => false)) return { score: 0, feedback: 'No package.json', evidence: ['Missing: package.json'] }
    try { await execAsync('npx tsc --noEmit 2>&1', { cwd: w, timeout: 30000, maxBuffer: 1024 * 1024 }); s += 3; ev.push('Good: typecheck passes') } catch { s -= 1; ev.push('Poor: typecheck fails') }
    const f = await listFiles(w)
    if (f.some(x => x === 'src/app/page.tsx' || x === 'index.html' || x === '__preview.html')) { s += 2; ev.push('Good: entry point') } else ev.push('Missing: entry point')
    if (f.includes('__preview.html')) { s += 2; ev.push('Good: __preview.html') }
  } catch { s = 0 }
  return { score: Math.max(0, Math.min(10, s)), feedback: `Functionality: ${s.toFixed(1)}/10`, evidence: ev }
}

export async function evaluateProject(config: GANConfig, iteration: number): Promise<GANEvaluation> {
  const [d, o, c, fn] = await Promise.all([evalDesign(config.workspaceDir), evalOriginality(config.workspaceDir), evalCraft(config.workspaceDir), evalFunctionality(config.workspaceDir)])
  const axes: AxisScore[] = [
    { axis: 'design', score: d.score, weight: AXIS_WEIGHTS.design, feedback: d.feedback, evidence: d.evidence },
    { axis: 'originality', score: o.score, weight: AXIS_WEIGHTS.originality, feedback: o.feedback, evidence: o.evidence },
    { axis: 'craft', score: c.score, weight: AXIS_WEIGHTS.craft, feedback: c.feedback, evidence: c.evidence },
    { axis: 'functionality', score: fn.score, weight: AXIS_WEIGHTS.functionality, feedback: fn.feedback, evidence: fn.evidence },
  ]
  const total = axes.reduce((s, a) => s + a.score * a.weight, 0)
  const verdict: GANEvaluation['verdict'] = total >= config.passThreshold ? 'pass' : 'fail'
  const strengths = axes.flatMap(a => a.evidence.filter(e => e.startsWith('Good:')).map(e => `[${a.axis}] ${e}`))
  const weaknesses = axes.flatMap(a => a.evidence.filter(e => e.startsWith('Missing:') || e.startsWith('Poor:')).map(e => `[${a.axis}] ${e}`))
  const fixes = axes.filter(a => a.score < 7).flatMap(a => a.evidence.filter(e => e.startsWith('Missing:') || e.startsWith('Poor:')).slice(0, 2).map(e => `[${a.axis}] ${e}`))
  return { iteration, axisScores: axes, totalScore: total, verdict, summary: `Iteration ${iteration}: ${total.toFixed(2)}/10 (${verdict})`, strengths, weaknesses, suggestedFixes: fixes, timestamp: Date.now() }
}

function detectPlateau(iters: GANIteration[], config: GANConfig): boolean {
  if (iters.length < config.minIterationsBeforePlateau) return false
  const recent = iters.slice(-config.plateauWindow)
  if (recent.length < config.plateauWindow) return false
  return recent[recent.length - 1]!.evaluation.totalScore - recent[0]!.evaluation.totalScore < 0.1
}

export async function runGANLoop(config: GANConfig, generator: (i: number, feedback: string) => Promise<void>, onIter?: (i: GANIteration) => void): Promise<GANResult> {
  const start = Date.now(); const iters: GANIteration[] = []
  await fs.rm(feedbackDir(config.workspaceDir), { recursive: true, force: true }).catch(() => {})
  for (let i = 1; i <= config.maxIterations; i++) {
    const is = Date.now()
    const prev = await readPrevFeedback(config.workspaceDir, 2)
    await generator(i, prev)
    const ev = await evaluateProject(config, i)
    const ff = await writeFeedback(config.workspaceDir, ev)
    const it: GANIteration = { iterationNumber: i, evaluation: ev, feedbackFilePath: ff, durationMs: Date.now() - is }
    iters.push(it); onIter?.(it)
    agentEventBus.emit('validation:run', { projectPath: config.workspaceDir, step: `gan-iter-${i}`, iteration: i })
    if (ev.verdict === 'pass') { agentEventBus.emit('validation:pass', { projectPath: config.workspaceDir, step: 'gan-complete' }); return { iterations: iters, finalScore: ev.totalScore, finalVerdict: 'pass', totalDurationMs: Date.now() - start, report: buildReport(iters, 'pass') } }
    if (detectPlateau(iters, config)) return { iterations: iters, finalScore: ev.totalScore, finalVerdict: 'plateau', totalDurationMs: Date.now() - start, report: buildReport(iters, 'plateau') }
  }
  return { iterations: iters, finalScore: iters[iters.length - 1]!.evaluation.totalScore, finalVerdict: 'max-iterations', totalDurationMs: Date.now() - start, report: buildReport(iters, 'max-iterations') }
}

function buildReport(iters: GANIteration[], verdict: GANResult['finalVerdict']): string {
  const L = ['═════════════ GAN HARNESS REPORT ═════════════', `Iterations: ${iters.length}`, `Final verdict: ${verdict.toUpperCase()}`, '', '## Iteration History']
  for (const it of iters) { L.push(`  Iteration ${it.iterationNumber}: ${it.evaluation.totalScore.toFixed(2)}/10 (${it.evaluation.verdict})`); for (const a of it.evaluation.axisScores) L.push(`    ${a.axis.padEnd(15)} ${a.score.toFixed(1)}/10`) }
  L.push('═══════════════════════════════════════════════')
  return L.join('\n')
}
