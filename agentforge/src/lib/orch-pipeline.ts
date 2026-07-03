/**
 * ORCH Pipeline (ECC Pattern #10)
 * Size classifier (trivial/small/standard/large) + 2-gate model.
 */
import { agentEventBus } from './event-bus'

export type SizeTier = 'trivial' | 'small' | 'standard' | 'large'
export type PipelinePhase = 'intake' | 'research' | 'plan' | 'scaffold' | 'implement' | 'review' | 'commit'
export interface SizeClassification { tier: SizeTier; rationale: string; factors: { fileCount: number; hasNewDependencies: boolean; touchesSecurity: boolean; touchesAuth: boolean; touchesDatabase: boolean; designAmbiguity: 'low' | 'medium' | 'high'; estimatedLinesChanged: number }; requiredPhases: PipelinePhase[]; requiresGate1: boolean; requiresGate2: boolean }
export interface GateDecision { gate: 1 | 2; approved: boolean; feedback?: string; timestamp: number }
export interface ClassifyInput { fileCount: number; hasNewDependencies: boolean; filePaths?: string[]; fileDescriptions?: string[]; designAmbiguity?: 'low' | 'medium' | 'high'; estimatedLinesChanged?: number }

const SEC_TRIGGERS = [/auth|login|logout|session|password|token|jwt|cookie/i, /sql|query|database|prisma|drizzle|knex|sequelize/i, /crypto|encrypt|decrypt|hash|sign|verify/i, /secret|api[_-]?key|credential/i, /upload|download|file\s*system|fs\./i, /eval|exec|child[_-]?process|spawn/i, /cors|origin|header/i, /payment|stripe|billing|invoice/i]

export function detectSecurityTriggers(filePaths: string[], descriptions: string[] = []): { touchesSecurity: boolean; touchesAuth: boolean; touchesDatabase: boolean } {
  const all = [...filePaths, ...descriptions].join(' ')
  return { touchesSecurity: SEC_TRIGGERS.some(p => p.test(all)), touchesAuth: !!all.match(/auth|login|logout|session|password|token|jwt|cookie/i), touchesDatabase: !!all.match(/sql|query|database|prisma|drizzle|knex|sequelize|schema|migration/i) }
}

export function classifyTask(input: ClassifyInput): SizeClassification {
  const { fileCount, hasNewDependencies, filePaths = [], fileDescriptions = [], designAmbiguity = 'low', estimatedLinesChanged = 0 } = input
  const { touchesSecurity, touchesAuth, touchesDatabase } = detectSecurityTriggers(filePaths, fileDescriptions)
  const factors = { fileCount, hasNewDependencies, touchesSecurity, touchesAuth, touchesDatabase, designAmbiguity, estimatedLinesChanged }
  if (touchesSecurity || touchesAuth || touchesDatabase) return build('standard', 'Touches security-sensitive code', factors)
  if (fileCount > 10 || estimatedLinesChanged > 500) return build('large', `${fileCount} files, ${estimatedLinesChanged} lines`, factors)
  if (hasNewDependencies || fileCount >= 3) return build('standard', `${fileCount} files${hasNewDependencies ? ' + new deps' : ''}`, factors)
  if (fileCount === 1 && !hasNewDependencies && designAmbiguity === 'low') return build('trivial', 'Single file, no deps', factors)
  return build('small', `${fileCount} file(s)`, factors)
}

function build(tier: SizeTier, rationale: string, factors: SizeClassification['factors']): SizeClassification {
  const pm: Record<SizeTier, PipelinePhase[]> = { trivial: ['implement', 'review'], small: ['plan', 'implement', 'review'], standard: ['intake', 'research', 'plan', 'implement', 'review', 'commit'], large: ['intake', 'research', 'plan', 'scaffold', 'implement', 'review', 'commit'] }
  return { tier, rationale, factors, requiredPhases: pm[tier], requiresGate1: tier === 'standard' || tier === 'large', requiresGate2: tier === 'large' }
}

export function requestGate1Approval(c: SizeClassification, planSummary: string): { gate: 1; message: string; requiresApproval: boolean } {
  if (!c.requiresGate1) return { gate: 1, message: 'Gate 1 not required', requiresApproval: false }
  agentEventBus.emit('agent:iteration', { sessionId: 'orch-pipeline', iteration: 1, maxIterations: 1 })
  return { gate: 1, requiresApproval: true, message: `GATE 1 — Plan Approval Required (${c.tier})\n\n${planSummary}\n\nType "approve" to proceed.` }
}

export function requestGate2Approval(c: SizeClassification, diffSummary: string): { gate: 2; message: string; requiresApproval: boolean } {
  if (!c.requiresGate2) return { gate: 2, message: 'Gate 2 not required', requiresApproval: false }
  return { gate: 2, requiresApproval: true, message: `GATE 2 — Commit Approval Required (${c.tier})\n\n${diffSummary}\n\nType "approve" to commit.` }
}

export function recordGateDecision(gate: 1 | 2, approved: boolean, feedback?: string): GateDecision {
  agentEventBus.emit(approved ? 'validation:pass' : 'validation:error', { projectPath: 'orch-pipeline', step: `gate-${gate}`, errors: approved ? 0 : 1, warnings: 0 })
  return { gate, approved, feedback, timestamp: Date.now() }
}

export function getPipelineDescription(tier: SizeTier): string {
  const d: Record<SizeTier, string> = { trivial: 'Trivial: implement + review (no plan)', small: 'Small: plan + implement + review', standard: 'Standard: intake → research → plan → ★GATE 1 → implement → review → commit', large: 'Large: intake → research → plan → ★GATE 1 → scaffold → implement → review → ★GATE 2 → commit' }
  return d[tier]
}
