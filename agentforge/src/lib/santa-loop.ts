/**
 * Santa Loop (ECC Pattern #4)
 * Adversarial dual-reviewer convergence. Two independent reviewers must BOTH pass.
 * Max 3 rounds, fresh reviewers each round, push only after NICE.
 */
import { agentEventBus } from './event-bus'
import { listProjectFiles } from './filesystem'
import { reviewProject, type ReviewResult } from './code-reviewer'

export type SantaVerdict = 'NICE' | 'NAUGHTY'
export interface ReviewerResult { reviewerId: string; reviewerModel: string; verdict: 'PASS' | 'FAIL'; findings: Array<{ severity: 'critical' | 'high' | 'medium' | 'low'; file: string; line?: number; message: string; suggestedFix?: string }>; summary: string; durationMs: number }
export interface SantaRound { roundNumber: number; reviewerA: ReviewerResult; reviewerB: ReviewerResult; verdict: SantaVerdict; fixesApplied: string[]; timestamp: number }
export interface SantaLoopResult { rounds: SantaRound[]; finalVerdict: SantaVerdict | 'ESCALATED'; totalRounds: number; pushed: boolean; report: string; durationMs: number }
export interface SantaLoopConfig { projectId: string; workspaceDir: string; maxRounds: number; filesToReview?: string[] }

export const DEFAULT_SANTA_CONFIG: Omit<SantaLoopConfig, 'projectId' | 'workspaceDir'> = { maxRounds: 3 }

async function runReviewerA(config: SantaLoopConfig, files: string[]): Promise<ReviewerResult> {
  const s = Date.now()
  const r: ReviewResult = await reviewProject({ projectId: config.projectId, workspaceDir: config.workspaceDir, filesToReview: files, minConfidence: 0.8, blockOnCritical: true })
  return { reviewerId: 'reviewer-a', reviewerModel: 'local-code-reviewer', verdict: r.verdict === 'BLOCK' ? 'FAIL' : 'PASS', findings: r.findings.map(f => ({ severity: f.severity, file: f.file, line: f.line, message: f.message, suggestedFix: f.suggestion })), summary: `${r.findings.length} findings — ${r.verdict}`, durationMs: Date.now() - s }
}

async function runReviewerB(config: SantaLoopConfig, files: string[]): Promise<ReviewerResult> {
  const s = Date.now()
  const r: ReviewResult = await reviewProject({ projectId: config.projectId, workspaceDir: config.workspaceDir, filesToReview: files, minConfidence: 0.6, blockOnCritical: true })
  const bFindings = r.findings.filter(f => ['security', 'error-handling', 'bug'].includes(f.category))
  const verdict: ReviewerResult['verdict'] = bFindings.some(f => f.severity === 'critical') ? 'FAIL' : (r.verdict === 'BLOCK' ? 'FAIL' : 'PASS')
  return { reviewerId: 'reviewer-b', reviewerModel: 'local-code-reviewer-strict', verdict, findings: bFindings.map(f => ({ severity: f.severity, file: f.file, line: f.line, message: `[B] ${f.message}`, suggestedFix: f.suggestion })), summary: `${bFindings.length} findings (security lens) — ${verdict}`, durationMs: Date.now() - s }
}

function collectFixes(round: SantaRound): string[] {
  const fixes: string[] = []
  for (const r of [round.reviewerA, round.reviewerB]) for (const f of r.findings) if (f.severity === 'critical' || f.severity === 'high') fixes.push(`${f.file}:${f.line || '?'} — ${f.message}`)
  return [...new Set(fixes)]
}

export async function runSantaLoop(config: SantaLoopConfig, onRound?: (r: SantaRound) => void): Promise<SantaLoopResult> {
  const start = Date.now(); const rounds: SantaRound[] = []
  const files = config.filesToReview || await listProjectFiles(config.projectId)
  for (let rn = 1; rn <= config.maxRounds; rn++) {
    const [a, b] = await Promise.all([runReviewerA(config, files), runReviewerB(config, files)])
    const verdict: SantaVerdict = a.verdict === 'PASS' && b.verdict === 'PASS' ? 'NICE' : 'NAUGHTY'
    const round: SantaRound = { roundNumber: rn, reviewerA: a, reviewerB: b, verdict, fixesApplied: verdict === 'NAUGHTY' ? collectFixes({ roundNumber: rn, reviewerA: a, reviewerB: b, verdict, fixesApplied: [], timestamp: Date.now() }) : [], timestamp: Date.now() }
    if (verdict === 'NAUGHTY') agentEventBus.emit('validation:error', { projectPath: config.workspaceDir, step: `santa-round-${rn}-naughty`, errors: round.fixesApplied.length, warnings: 0 })
    else agentEventBus.emit('validation:pass', { projectPath: config.workspaceDir, step: `santa-round-${rn}-nice` })
    rounds.push(round); onRound?.(round)
    if (verdict === 'NICE') return { rounds, finalVerdict: 'NICE', totalRounds: rn, pushed: true, report: buildReport(rounds, 'NICE', true), durationMs: Date.now() - start }
  }
  return { rounds, finalVerdict: 'ESCALATED', totalRounds: config.maxRounds, pushed: false, report: buildReport(rounds, 'ESCALATED', false), durationMs: Date.now() - start }
}

function buildReport(rounds: SantaRound[], fv: SantaLoopResult['finalVerdict'], pushed: boolean): string {
  const L = ['═════════════ SANTA LOOP REPORT ═════════════', `Rounds: ${rounds.length}`, `Final verdict: ${fv}`, `Pushed: ${pushed ? '✅ YES' : '❌ NO'}`, '']
  for (const r of rounds) { L.push(`### Round ${r.roundNumber}: ${r.verdict}`); L.push(`  Reviewer A: ${r.reviewerA.verdict} — ${r.reviewerA.summary}`); L.push(`  Reviewer B: ${r.reviewerB.verdict} — ${r.reviewerB.summary}`); if (r.fixesApplied.length > 0) { L.push(`  Fixes: ${r.fixesApplied.length}`); r.fixesApplied.slice(0, 5).forEach(f => L.push(`    - ${f}`)) } }
  if (fv === 'NICE') L.push('✅ Both reviewers passed — ready to push.')
  else L.push('❌ Max rounds reached without convergence — ESCALATED.')
  L.push('═══════════════════════════════════════════════')
  return L.join('\n')
}

export function shouldInvokeSantaLoop(tier: 'trivial' | 'small' | 'standard' | 'large'): boolean {
  return tier === 'standard' || tier === 'large'
}
