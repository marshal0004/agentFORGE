/**
 * Agent Self-Evaluation (ECC Pattern #11)
 * 5-axis rubric (Accuracy/Completeness/Clarity/Actionability/Conciseness).
 * Deterministic heuristics — no LLM judge needed for first pass.
 */
import { agentEventBus } from './event-bus'

export type EvalAxis = 'accuracy' | 'completeness' | 'clarity' | 'actionability' | 'conciseness'
export interface AxisEvaluation { axis: EvalAxis; score: number; evidence: string[]; maxScore: number }
export interface SelfEvaluationResult { axes: AxisEvaluation[]; totalScore: number; maxTotalScore: number; percentage: number; verdict: 'deliver-as-is' | 'fix-issues-then-deliver' | 'redo-from-scratch'; criticalIssues: string[]; topImprovements: string[]; report: string; timestamp: number }
export interface EvaluationInput { agentResponse: string; filesWritten: string[]; buildSucceeded: boolean; testsPassed: boolean; typecheckPassed: boolean; lintPassed: boolean; coveragePercent?: number; workspaceDir?: string }

const POS = [/tests?\s*(?:passed|pass)/i, /exit code 0/, /lint\s*(?:clean|passed)/i, /type\s*check\s*(?:passed|succeeded)/i]
const NEG = [/should\s+work/i, /I\s+think/i, /untested|not\s+tested/i, /TODO|FIXME/i, /(?:you\s+may\s+need|you\s+should)\s+(?:run|install)/i]

export async function evaluateAgentOutput(input: EvaluationInput): Promise<SelfEvaluationResult> {
  const r = input.agentResponse
  const axes: AxisEvaluation[] = []
  // Accuracy
  let s = 3; const aEv: string[] = []
  if (input.buildSucceeded) { s += 1; aEv.push('Build succeeded') } else { s -= 1; aEv.push('Build failed') }
  if (input.testsPassed) { s += 1; aEv.push('Tests passed') } else { s -= 1; aEv.push('Tests failed') }
  for (const p of POS) if (p.test(r)) { s += 0.5; aEv.push('Positive signal') }
  for (const n of NEG) if (n.test(r)) { s -= 1; aEv.push('Hedge detected') }
  axes.push({ axis: 'accuracy', score: Math.max(1, Math.min(5, Math.round(s))), evidence: aEv, maxScore: 5 })
  // Completeness
  s = 3; const cEv: string[] = []
  if (input.filesWritten.length >= 5) { s += 1; cEv.push(`${input.filesWritten.length} files`) } else if (input.filesWritten.length >= 1) { s += 0.5; cEv.push(`${input.filesWritten.length} file(s)`) } else { s -= 1; cEv.push('No files') }
  if (input.coveragePercent !== undefined && input.coveragePercent >= 80) { s += 1; cEv.push(`${input.coveragePercent}% coverage`) }
  if (input.lintPassed) { s += 0.5; cEv.push('Lint passed') }
  axes.push({ axis: 'completeness', score: Math.max(1, Math.min(5, Math.round(s))), evidence: cEv, maxScore: 5 })
  // Clarity
  s = 3; const clEv: string[] = []
  const wc = r.split(/\s+/).length
  if (wc < 50) { s -= 1; clEv.push('Too short') } else if (wc > 2000) { s -= 0.5; clEv.push('Too long') } else { s += 0.5; clEv.push('Reasonable length') }
  if (r.match(/^#+\s/m)) { s += 0.5; clEv.push('Has headings') }
  if (r.match(/```/)) { s += 0.5; clEv.push('Has code blocks') }
  axes.push({ axis: 'clarity', score: Math.max(1, Math.min(5, Math.round(s))), evidence: clEv, maxScore: 5 })
  // Actionability
  s = 3; const acEv: string[] = []
  const fps = (r.match(/[\w./-]+\.(?:ts|tsx|js|jsx|py|json|md)/g) || []).length
  if (fps > 0) { s += 0.5; acEv.push(`${fps} file path(s)`) }
  const cms = (r.match(/(?:npm|npx|bun|git|node|python)\s+\w+/g) || []).length
  if (cms > 0) { s += 0.5; acEv.push(`${cms} command(s)`) }
  for (const n of NEG) if (n.test(r)) { s -= 0.5; acEv.push('Delegates to user') }
  axes.push({ axis: 'actionability', score: Math.max(1, Math.min(5, Math.round(s))), evidence: acEv, maxScore: 5 })
  // Conciseness
  s = 3; const coEv: string[] = []
  const wpf = input.filesWritten.length > 0 ? wc / input.filesWritten.length : wc
  if (wpf < 50) { s += 1; coEv.push('Concise') } else if (wpf < 150) { s += 0.5; coEv.push('Reasonable') } else if (wpf > 500) { s -= 1; coEv.push('Verbose') }
  axes.push({ axis: 'conciseness', score: Math.max(1, Math.min(5, Math.round(s))), evidence: coEv, maxScore: 5 })

  const total = axes.reduce((sum, a) => sum + a.score, 0)
  const max = axes.reduce((sum, a) => sum + a.maxScore, 0)
  const pct = (total / max) * 100
  const critical = axes.filter(a => a.score <= 2).map(a => `${a.axis}: ${a.evidence.join('; ')}`)
  let verdict: SelfEvaluationResult['verdict'] = 'redo-from-scratch'
  if (pct >= 80 && critical.length === 0) verdict = 'deliver-as-is'
  else if (pct >= 50) verdict = 'fix-issues-then-deliver'
  const improvements: string[] = []
  for (const a of [...axes].sort((x, y) => x.score - y.score)) if (a.score < 4) { const neg = a.evidence.filter(e => e.match(/failed|missing|poor|hedge|verbose/i)); if (neg.length > 0) improvements.push(`[${a.axis}] ${neg[0]}`) }
  if (verdict === 'deliver-as-is') agentEventBus.emit('validation:pass', { projectPath: input.workspaceDir || 'self-eval', step: 'agent-self-evaluation' })
  else agentEventBus.emit('validation:error', { projectPath: input.workspaceDir || 'self-eval', step: 'agent-self-evaluation', errors: critical.length, warnings: improvements.length })
  const report = buildReport(axes, total, max, pct, verdict, critical, improvements)
  return { axes, totalScore: total, maxTotalScore: max, percentage: pct, verdict, criticalIssues: critical, topImprovements: improvements.slice(0, 5), report, timestamp: Date.now() }
}

function buildReport(axes: AxisEvaluation[], total: number, max: number, pct: number, verdict: SelfEvaluationResult['verdict'], critical: string[], improvements: string[]): string {
  const L = ['═════════════ AGENT SELF-EVALUATION REPORT ═════════════', `Total Score: ${total}/${max} (${pct.toFixed(1)}%)`, `Verdict: ${verdict.toUpperCase().replace(/-/g, ' ')}`, '', '## Axis Scores']
  for (const a of axes) { const bar = '█'.repeat(a.score) + '░'.repeat(a.maxScore - a.score); L.push(`  ${a.axis.padEnd(15)} ${bar} ${a.score}/${a.maxScore}`); for (const e of a.evidence.slice(0, 3)) L.push(`    → ${e}`) }
  if (critical.length > 0) { L.push('', '## Critical Issues'); critical.forEach(c => L.push(`  ❌ ${c}`)) }
  if (improvements.length > 0) { L.push('', '## Top Improvements'); improvements.slice(0, 5).forEach((i, n) => L.push(`  ${n + 1}. ${i}`)) }
  L.push('═══════════════════════════════════════════════════════')
  return L.join('\n')
}
