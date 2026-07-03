import { NextRequest, NextResponse } from 'next/server'
import { createPRD, loadPRD, listPRDs, createPlan, loadPlan, listPlans } from '@/lib/plan-prd'
import { getProjectWorkspacePath } from '@/lib/filesystem'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const { action, projectId, ...params } = body
  if (!projectId) return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
  try {
    const workspaceDir = getProjectWorkspacePath(projectId)
    switch (action) {
      case 'create-prd': { const prd = await createPRD(workspaceDir, params.idea, { title: params.title, targetUsers: params.targetUsers, acceptanceCriteria: params.acceptanceCriteria }); return NextResponse.json({ ok: true, prd }) }
      case 'load-prd': { const prd = await loadPRD(workspaceDir, params.prdId); return NextResponse.json({ ok: true, prd }) }
      case 'list-prds': { const prds = await listPRDs(workspaceDir); return NextResponse.json({ ok: true, prds }) }
      case 'create-plan': { const plan = await createPlan(workspaceDir, params.prdId, { architecture: params.architecture, filesToCreate: params.filesToCreate, filesToModify: params.filesToModify, testingStrategy: params.testingStrategy, validationCommands: params.validationCommands, risks: params.risks }); return NextResponse.json({ ok: true, plan }) }
      case 'load-plan': { const plan = await loadPlan(workspaceDir, params.planId); return NextResponse.json({ ok: true, plan }) }
      case 'list-plans': { const plans = await listPlans(workspaceDir); return NextResponse.json({ ok: true, plans }) }
      default: return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
