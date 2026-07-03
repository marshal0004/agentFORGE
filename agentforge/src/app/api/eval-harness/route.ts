import { NextRequest, NextResponse } from 'next/server'
import { runEval, saveEvalDefinition, loadEvalDefinition, listEvals, getBaseline, type EvalDefinition } from '@/lib/eval-harness'
import { getProjectWorkspacePath } from '@/lib/filesystem'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const { action, projectId, ...params } = body
  if (!projectId) return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
  try {
    const workspaceDir = getProjectWorkspacePath(projectId)
    switch (action) {
      case 'run': { if (!params.evalId) return NextResponse.json({ error: 'evalId required' }, { status: 400 }); const evalDef = await loadEvalDefinition(workspaceDir, params.evalId); const result = await runEval(workspaceDir, evalDef); return NextResponse.json({ ok: result.metTarget, result }) }
      case 'save': { const evalDef = params.evalDef as EvalDefinition; if (!evalDef?.id) return NextResponse.json({ error: 'evalDef with id required' }, { status: 400 }); await saveEvalDefinition(workspaceDir, evalDef); return NextResponse.json({ ok: true, evalId: evalDef.id }) }
      case 'list': { const evals = await listEvals(workspaceDir); return NextResponse.json({ ok: true, evals }) }
      case 'baseline': { if (!params.evalId) return NextResponse.json({ error: 'evalId required' }, { status: 400 }); const baseline = await getBaseline(workspaceDir, params.evalId); return NextResponse.json({ ok: true, baseline }) }
      default: return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
