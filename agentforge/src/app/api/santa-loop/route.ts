import { NextRequest, NextResponse } from 'next/server'
import { runSantaLoop, DEFAULT_SANTA_CONFIG } from '@/lib/santa-loop'
import { getProjectWorkspacePath } from '@/lib/filesystem'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const { projectId, maxRounds, filesToReview } = body
  if (!projectId) return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
  try {
    const workspaceDir = getProjectWorkspacePath(projectId)
    const result = await runSantaLoop({ ...DEFAULT_SANTA_CONFIG, projectId, workspaceDir, maxRounds: maxRounds || DEFAULT_SANTA_CONFIG.maxRounds, filesToReview })
    return NextResponse.json({ ok: result.finalVerdict === 'NICE', result })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
