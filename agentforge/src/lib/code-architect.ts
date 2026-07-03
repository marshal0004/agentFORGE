/**
 * Code Architect (ECC Pattern #9)
 * Types-first build sequence planner. Forces types → core → integration → UI → tests → docs.
 */
import { agentEventBus } from './event-bus'

export type BuildPhase = 'types' | 'core' | 'integration' | 'ui' | 'tests' | 'docs'
export interface ArchitectFile { path: string; purpose: string; phase: BuildPhase; priority: 'critical' | 'high' | 'medium' | 'low'; dependencies: string[] }
export interface ArchitecturePlan { featureName: string; designDecisions: Array<{ decision: string; rationale: string }>; filesToCreate: ArchitectFile[]; filesToModify: ArchitectFile[]; buildSequence: BuildPhase[]; dataFlow: string; estimatedComplexity: 'trivial' | 'small' | 'standard' | 'large'; createdAt: number }
export interface ArchitectConfig { featureDescription: string; existingFiles?: string[]; userRequirements?: string[]; constraints?: string[] }

export const CANONICAL_BUILD_SEQUENCE: BuildPhase[] = ['types', 'core', 'integration', 'ui', 'tests', 'docs']

export function classifyFile(filePath: string): BuildPhase {
  const l = filePath.toLowerCase()
  if (l.match(/\.test\.|\.spec\.|__tests__|\/tests?\//)) return 'tests'
  if (l.match(/\.e2e\.|\/e2e\//)) return 'tests'
  if (l.match(/\.md$|^docs?\//) || l.match(/readme|changelog|license/i)) return 'docs'
  if (l.match(/\/types?\//) || l.match(/\.(d\.ts|types?\.ts|interfaces?\.ts|schemas?\.ts)$/)) return 'types'
  if (l.match(/\/api\/|route\.|controller|service\/|repository\/|\/db\/|prisma\/|middleware/)) return 'integration'
  if (l.match(/webhook|callback|handler\//)) return 'integration'
  if (l.match(/\.(tsx|vue|svelte)$/) || l.match(/\/(components?|pages?|app|views?)\//)) return 'ui'
  if (l.match(/layout|page|component|widget|modal|dialog/i)) return 'ui'
  if (l.match(/\.ts$|\.js$|\.py$|\.go$|\.rs$/)) return 'core'
  return 'core'
}

export async function generateArchitecturePlan(config: ArchitectConfig): Promise<ArchitecturePlan> {
  const { featureDescription, existingFiles = [], constraints = [] } = config
  const complexity = classifyComplexity(featureDescription, existingFiles.length)
  const featureName = featureDescription.split(/\s+/).slice(0, 3).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
  const decisions = [{ decision: 'Define types before implementation', rationale: 'Types are imported by all other files — prevents import-not-found errors.' }]
  if (complexity === 'large') decisions.push({ decision: 'Modular architecture', rationale: 'Large features require modularity for maintainability.' })
  for (const c of constraints) decisions.push({ decision: `Constraint: ${c}`, rationale: 'User-specified constraint.' })
  const files = generateFiles(featureName, complexity, featureDescription.toLowerCase())
  agentEventBus.emit('agent:start', { sessionId: `architect-${Date.now()}`, projectId: featureDescription.substring(0, 50), model: 'code-architect' })
  return { featureName, designDecisions: decisions, filesToCreate: files, filesToModify: [], buildSequence: CANONICAL_BUILD_SEQUENCE, dataFlow: `1. Types → 2. Core → 3. Integration → 4. UI → 5. Tests`, estimatedComplexity: complexity, createdAt: Date.now() }
}

function classifyComplexity(desc: string, existing: number): ArchitecturePlan['estimatedComplexity'] {
  const l = desc.toLowerCase(); const wc = desc.split(/\s+/).length
  if (l.match(/auth|payment|realtime|websocket|multi-tenant|admin|dashboard|analytics/i) && wc > 20) return 'large'
  if (existing > 10) return 'large'
  const fc = (l.match(/(?:add|create|implement|build|support)\s/g) || []).length
  if (fc >= 3) return 'standard'
  if (fc >= 1) return 'small'
  return 'trivial'
}

function generateFiles(name: string, complexity: ArchitecturePlan['estimatedComplexity'], desc: string): ArchitectFile[] {
  const slug = name.toLowerCase().replace(/\s+/g, '-')
  const files: ArchitectFile[] = [{ path: `src/types/${slug}.ts`, purpose: `Type definitions for ${name}`, phase: 'types', priority: 'critical', dependencies: [] }]
  if (complexity !== 'trivial') files.push({ path: `src/lib/${slug}.ts`, purpose: `Core logic for ${name}`, phase: 'core', priority: 'high', dependencies: [`src/types/${slug}.ts`] })
  if (desc.match(/api|endpoint|route|backend/i) || complexity === 'large') files.push({ path: `src/app/api/${slug}/route.ts`, purpose: `API route for ${name}`, phase: 'integration', priority: 'high', dependencies: [`src/lib/${slug}.ts`] })
  if (desc.match(/ui|page|component|frontend|view|dashboard/i) || complexity !== 'trivial') files.push({ path: `src/app/${slug}/page.tsx`, purpose: `Page for ${name}`, phase: 'ui', priority: complexity === 'trivial' ? 'medium' : 'high', dependencies: [`src/types/${slug}.ts`] })
  if (complexity !== 'trivial') files.push({ path: `src/lib/__tests__/${slug}.test.ts`, purpose: `Unit tests for ${name}`, phase: 'tests', priority: 'medium', dependencies: [`src/lib/${slug}.ts`] })
  if (complexity === 'large') files.push({ path: `docs/${slug}.md`, purpose: `Docs for ${name}`, phase: 'docs', priority: 'low', dependencies: [] })
  return files
}

export function sortFilesByBuildPhase(files: ArchitectFile[]): ArchitectFile[] {
  const po: Record<BuildPhase, number> = { types: 0, core: 1, integration: 2, ui: 3, tests: 4, docs: 5 }
  const pr: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
  return [...files].sort((a, b) => po[a.phase] - po[b.phase] || pr[a.priority] - pr[b.priority])
}

export function validateBuildSequence(files: ArchitectFile[]): string[] {
  const violations: string[] = []; const built = new Set<BuildPhase>()
  for (const f of sortFilesByBuildPhase(files)) {
    for (const dep of f.dependencies) { const depFile = files.find(x => x.path === dep); if (depFile && !built.has(depFile.phase)) violations.push(`${f.path} depends on ${dep} (phase: ${depFile.phase}) but that phase hasn't been built yet`) }
    built.add(f.phase)
  }
  return violations
}
