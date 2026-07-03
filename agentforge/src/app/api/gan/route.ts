import { NextRequest, NextResponse } from 'next/server'
import { evaluateProject, DEFAULT_GAN_CONFIG, type GANConfig } from '@/lib/gan-harness'
import { getProjectWorkspacePath } from '@/lib/filesystem'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const { projectId, iteration = 1, maxIterations, passThreshold, evalMode } = body
  if (!projectId) return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
  try {
    const workspaceDir = getProjectWorkspacePath(projectId)
    const config: GANConfig = { ...DEFAULT_GAN_CONFIG, workspaceDir, specPath: body.specPath || '', maxIterations: maxIterations || DEFAULT_GAN_CONFIG.maxIterations, passThreshold: passThreshold || DEFAULT_GAN_CONFIG.passThreshold, evalMode: evalMode || DEFAULT_GAN_CONFIG.evalMode }
    const evaluation = await evaluateProject(config, iteration)
    return NextResponse.json({ ok: evaluation.verdict === 'pass', evaluation })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
