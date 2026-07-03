import { NextRequest, NextResponse } from 'next/server'
import { runVerificationLoop } from '@/lib/verification'
import { getProjectWorkspacePath } from '@/lib/filesystem'

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
  return runVerify(projectId, [])
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const { projectId, plannedFiles = [] } = body
  if (!projectId) return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
  return runVerify(projectId, plannedFiles)
}

async function runVerify(projectId: string, plannedFiles: string[]) {
  try {
    const workspaceDir = getProjectWorkspacePath(projectId)
    const result = await runVerificationLoop(workspaceDir, plannedFiles)
    return NextResponse.json({ ok: result.overall === 'READY', result })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
