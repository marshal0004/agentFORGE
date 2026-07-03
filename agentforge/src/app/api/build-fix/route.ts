import { NextRequest, NextResponse } from 'next/server'
import { resolveBuildErrors, DEFAULT_BUILD_FIX_CONFIG, canRunBuildFix } from '@/lib/build-error-resolver'
import { getProjectWorkspacePath } from '@/lib/filesystem'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const { projectId } = body
  if (!projectId) return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
  try {
    const workspaceDir = getProjectWorkspacePath(projectId)
    if (!await canRunBuildFix(workspaceDir)) return NextResponse.json({ ok: false, error: 'No package.json' }, { status: 400 })
    const result = await resolveBuildErrors({ ...DEFAULT_BUILD_FIX_CONFIG, workspaceDir, projectId })
    return NextResponse.json({ ok: result.resolved, result })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
