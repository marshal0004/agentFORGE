/**
 * Plan-PRD-Pattern (ECC Pattern #8)
 * Markdown-staged planning files: PRD → Plan → Generate → PR.
 */
import { promises as fs } from 'fs'
import path from 'path'
import { agentEventBus } from './event-bus'

export interface PRD { id: string; title: string; problem: string; targetUsers: string[]; scope: { inScope: string[]; outOfScope: string[] }; acceptanceCriteria: string[]; createdAt: number; updatedAt: number }
export interface PlanFile { path: string; purpose: string; priority: 'critical' | 'high' | 'medium' | 'low'; buildOrder: number }
export interface Plan { id: string; prdId: string; title: string; architecture: string; filesToCreate: PlanFile[]; filesToModify: PlanFile[]; buildSequence: string[]; testingStrategy: string; validationCommands: string[]; risks: Array<{ description: string; mitigation: string }>; createdAt: number; updatedAt: number }

const DIR = '.agentforge'
const prdDir = (w: string) => path.join(w, DIR, 'prds')
const planDir = (w: string) => path.join(w, DIR, 'plans')
const prdPath = (w: string, id: string) => path.join(prdDir(w), `${id}.prd.md`)
const planPath = (w: string, id: string) => path.join(planDir(w), `${id}.plan.md`)

function genId(p: string): string { return `${p}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}` }

export async function createPRD(workspaceDir: string, idea: string, opts?: { title?: string; targetUsers?: string[]; acceptanceCriteria?: string[] }): Promise<PRD> {
  const id = genId('prd'); const now = Date.now()
  const prd: PRD = { id, title: opts?.title || idea.substring(0, 80), problem: idea, targetUsers: opts?.targetUsers || ['end-users'], scope: { inScope: ['Core functionality'], outOfScope: ['Phase 2+ features'] }, acceptanceCriteria: opts?.acceptanceCriteria || ['Build succeeds', 'Tests pass', 'Type check passes'], createdAt: now, updatedAt: now }
  await fs.mkdir(prdDir(workspaceDir), { recursive: true })
  await fs.writeFile(prdPath(workspaceDir, id), `# PRD: ${prd.title}\n\n**ID:** ${id}\n**Created:** ${new Date(now).toISOString()}\n\n## Problem\n${idea}\n\n## Target Users\n${prd.targetUsers.map(u => `- ${u}`).join('\n')}\n\n## Scope\n### In Scope\n${prd.scope.inScope.map(s => `- ${s}`).join('\n')}\n### Out of Scope\n${prd.scope.outOfScope.map(s => `- ${s}`).join('\n')}\n\n## Acceptance Criteria\n${prd.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n`, 'utf-8')
  agentEventBus.emit('agent:start', { sessionId: id, projectId: id, model: 'plan-prd' })
  return prd
}

export async function loadPRD(workspaceDir: string, id: string): Promise<PRD> {
  const c = await fs.readFile(prdPath(workspaceDir, id), 'utf-8')
  const title = c.match(/^# PRD:\s*(.+)$/m)?.[1]?.trim() || 'Untitled'
  const problem = c.match(/## Problem\n([\s\S]*?)(?=\n##\s)/)?.[1]?.trim() || ''
  return { id, title, problem, targetUsers: [], scope: { inScope: [], outOfScope: [] }, acceptanceCriteria: [], createdAt: Date.now(), updatedAt: Date.now() }
}

export async function listPRDs(workspaceDir: string): Promise<Array<{ id: string; title: string; createdAt: number }>> {
  try { const files = await fs.readdir(prdDir(workspaceDir)); const prds: Array<{ id: string; title: string; createdAt: number }> = []
    for (const f of files) if (f.endsWith('.prd.md')) { try { const p = await loadPRD(workspaceDir, f.replace('.prd.md', '')); prds.push({ id: p.id, title: p.title, createdAt: p.createdAt }) } catch { /* skip */ } }
    return prds.sort((a, b) => b.createdAt - a.createdAt)
  } catch { return [] }
}

export async function createPlan(workspaceDir: string, prdId: string, opts: { architecture: string; filesToCreate?: Array<{ path: string; purpose: string; priority?: PlanFile['priority'] }>; filesToModify?: Array<{ path: string; purpose: string; priority?: PlanFile['priority'] }>; testingStrategy?: string; validationCommands?: string[]; risks?: Array<{ description: string; mitigation: string }> }): Promise<Plan> {
  const id = genId('plan'); const now = Date.now()
  const buildSequence = ['types and interfaces', 'core logic', 'integration layer', 'UI components', 'tests', 'documentation']
  const filesToCreate: PlanFile[] = (opts.filesToCreate || []).map((f, i) => ({ path: f.path, purpose: f.purpose, priority: f.priority || 'medium', buildOrder: i + 1 }))
  const filesToModify: PlanFile[] = (opts.filesToModify || []).map((f, i) => ({ path: f.path, purpose: f.purpose, priority: f.priority || 'medium', buildOrder: i + 1 }))
  const plan: Plan = { id, prdId, title: `Plan for ${prdId}`, architecture: opts.architecture, filesToCreate, filesToModify, buildSequence, testingStrategy: opts.testingStrategy || 'Unit + integration tests, ≥80% coverage', validationCommands: opts.validationCommands || ['npx tsc --noEmit', 'npm test', 'npm run build'], risks: opts.risks || [], createdAt: now, updatedAt: now }
  await fs.mkdir(planDir(workspaceDir), { recursive: true })
  await fs.writeFile(planPath(workspaceDir, id), `# Plan: ${plan.title}\n\n**ID:** ${id}\n**PRD ID:** ${prdId}\n\n## Architecture\n${opts.architecture}\n\n## Files to Create\n${filesToCreate.map(f => `- ${f.path}: ${f.purpose}`).join('\n')}\n\n## Build Sequence\n${buildSequence.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n`, 'utf-8')
  return plan
}

export async function loadPlan(workspaceDir: string, id: string): Promise<Plan> {
  const c = await fs.readFile(planPath(workspaceDir, id), 'utf-8')
  const title = c.match(/^# Plan:\s*(.+)$/m)?.[1]?.trim() || 'Untitled'
  const prdId = c.match(/\*\*PRD ID:\*\*\s*(.+)/)?.[1]?.trim() || ''
  const arch = c.match(/## Architecture\n([\s\S]*?)(?=\n##\s)/)?.[1]?.trim() || ''
  return { id, prdId, title, architecture: arch, filesToCreate: [], filesToModify: [], buildSequence: ['types', 'core', 'integration', 'ui', 'tests', 'docs'], testingStrategy: '', validationCommands: [], risks: [], createdAt: Date.now(), updatedAt: Date.now() }
}

export async function listPlans(workspaceDir: string): Promise<Array<{ id: string; prdId: string; title: string; createdAt: number }>> {
  try { const files = await fs.readdir(planDir(workspaceDir)); const plans: Array<{ id: string; prdId: string; title: string; createdAt: number }> = []
    for (const f of files) if (f.endsWith('.plan.md')) { try { const p = await loadPlan(workspaceDir, f.replace('.plan.md', '')); plans.push({ id: p.id, prdId: p.prdId, title: p.title, createdAt: p.createdAt }) } catch { /* skip */ } }
    return plans.sort((a, b) => b.createdAt - a.createdAt)
  } catch { return [] }
}
