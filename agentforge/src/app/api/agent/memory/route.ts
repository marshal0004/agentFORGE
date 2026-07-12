import { NextRequest, NextResponse } from 'next/server'
import { loadAgentMemory, saveAgentMemory } from '@/lib/coding-agent-prompt'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export async function GET() {
  try { const memory = await loadAgentMemory(); return NextResponse.json({ memory }) }
  catch { return NextResponse.json({ memory: '' }) }
}
export async function POST(request: NextRequest) {
  try {
    const { content } = await request.json()
    if (typeof content !== 'string') return NextResponse.json({ ok: false, error: 'content required' }, { status: 400 })
    await saveAgentMemory(content)
    return NextResponse.json({ ok: true })
  } catch { return NextResponse.json({ ok: false, error: 'Failed' }, { status: 500 }) }
}
