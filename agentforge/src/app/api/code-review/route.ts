import { NextRequest, NextResponse } from 'next/server'
import { reviewProject } from '@/lib/code-reviewer'
import { getProjectWorkspacePath } from '@/lib/filesystem'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const { projectId, filesToReview, minConfidence = 0.8, blockOnCritical = true } = body
  if (!projectId) return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
  try {
    const workspaceDir = getProjectWorkspacePath(projectId)
    const result = await reviewProject({ projectId, workspaceDir, filesToReview, minConfidence, blockOnCritical })
    return NextResponse.json({ ok: result.verdict !== 'BLOCK', result })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
