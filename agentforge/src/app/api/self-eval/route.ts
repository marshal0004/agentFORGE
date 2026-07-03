import { NextRequest, NextResponse } from 'next/server'
import { evaluateAgentOutput, type EvaluationInput } from '@/lib/agent-self-evaluation'
import { getProjectWorkspacePath } from '@/lib/filesystem'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const { projectId, ...evalInput } = body
  if (!evalInput.agentResponse) return NextResponse.json({ error: 'agentResponse is required' }, { status: 400 })
  try {
    const workspaceDir = projectId ? getProjectWorkspacePath(projectId) : undefined
    const input: EvaluationInput = { ...evalInput, workspaceDir } as EvaluationInput
    const result = await evaluateAgentOutput(input)
    return NextResponse.json({ ok: result.verdict === 'deliver-as-is', result })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
