/**
 * Gateguard Fact-Forcing Hook (ECC Pattern #7)
 * Before first Edit/Write per file, demands concrete facts (importers, exports, data usage).
 * DENY → FORCE → ALLOW. Investigation creates context that changes the output.
 */
import { promises as fs } from 'fs'
import path from 'path'
import { agentEventBus } from './event-bus'
import { listProjectFiles } from './filesystem'

export interface GateguardContext { projectId: string; workspaceDir: string; filePath: string; toolName: string; userInstruction?: string }
export interface GateguardFact { question: string; answer: string; verified: boolean }
export interface GateguardResult { decision: 'ALLOW' | 'DENY' | 'FORCE'; reason: string; facts: GateguardFact[]; forcedInvestigation: string | null }

const filesWrittenThisSession = new Set<string>()

export function resetGateguardSession(): void { filesWrittenThisSession.clear() }

async function findImporters(workspaceDir: string, targetFile: string): Promise<string[]> {
  const importers: string[] = []
  const basename = path.basename(targetFile, path.extname(targetFile))
  try {
    for (const file of await listProjectFiles(path.basename(workspaceDir))) {
      if (file === targetFile) continue
      if (!['.ts', '.tsx', '.js', '.jsx'].includes(path.extname(file))) continue
      try {
        const c = await fs.readFile(path.join(workspaceDir, file), 'utf-8')
        const pats = [new RegExp(`from\\s+['"][^'"]*${basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`), new RegExp(`require\\s*\\(\\s*['"][^'"]*${basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`)]
        if (pats.some(p => p.test(c))) importers.push(file)
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return importers
}

async function findExports(workspaceDir: string, filePath: string): Promise<string[]> {
  try {
    const c = await fs.readFile(path.join(workspaceDir, filePath), 'utf-8')
    const exports: string[] = []
    const re = /export\s+(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+(\w+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(c)) !== null) exports.push(m[1]!)
    if (/export\s+default\s/.test(c)) exports.push('default')
    const nr = /export\s*\{([^}]+)\}/g
    while ((m = nr.exec(c)) !== null) for (const n of m[1]!.split(',')) { const v = n.trim().split(/\s+as\s+/)[0]!.trim(); if (v) exports.push(v) }
    return [...new Set(exports)]
  } catch { return [] }
}

export async function evaluateGateguard(ctx: GateguardContext): Promise<GateguardResult> {
  const facts: GateguardFact[] = []
  const isFirst = !filesWrittenThisSession.has(ctx.filePath)
  const isWrite = ['write_file', 'edit_file', 'execute_code'].includes(ctx.toolName)
  if (!isWrite) return { decision: 'ALLOW', reason: 'Not a write operation', facts: [], forcedInvestigation: null }
  filesWrittenThisSession.add(ctx.filePath)
  if (!isFirst) return { decision: 'ALLOW', reason: 'Already written this session', facts: [], forcedInvestigation: null }

  const importers = await findImporters(ctx.workspaceDir, ctx.filePath)
  facts.push({ question: `Files that import ${ctx.filePath}`, answer: importers.length > 0 ? importers.join(', ') : 'No importers (new file)', verified: true })
  let exports: string[] = []
  try { await fs.access(path.join(ctx.workspaceDir, ctx.filePath)); exports = await findExports(ctx.workspaceDir, ctx.filePath) } catch { /* new file */ }
  facts.push({ question: 'Public functions/classes affected', answer: exports.length > 0 ? exports.join(', ') : 'New file', verified: true })
  facts.push({ question: 'User instruction', answer: ctx.userInstruction || '(none provided)', verified: !!ctx.userInstruction })

  agentEventBus.emit('tool:call', { toolName: ctx.toolName, params: { filePath: ctx.filePath }, source: 'gateguard', parallel: false })

  const needsForce = importers.length > 0 && !ctx.userInstruction
  if (needsForce) {
    const fi = `GATEGUARD INVESTIGATION:\n${facts.map(f => `  Q: ${f.question}\n  A: ${f.answer}`).join('\n')}\n\nReview these facts before proceeding. ${importers.length} importer(s) will be affected.`
    return { decision: 'FORCE', reason: 'File has downstream impact', facts, forcedInvestigation: fi }
  }
  return { decision: 'ALLOW', reason: 'Facts gathered, no force needed', facts, forcedInvestigation: null }
}

export function formatGateguardForToolResult(r: GateguardResult): string {
  if (r.decision === 'DENY') return `\n🚫 GATEGUARD DENIED: ${r.reason}\n`
  if (r.forcedInvestigation) return `\n📋 ${r.forcedInvestigation}\n`
  return ''
}
