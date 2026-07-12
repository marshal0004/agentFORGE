import { NextRequest, NextResponse } from 'next/server'
import { saveUploadedSkill } from '@/lib/coding-agent-prompt'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export async function POST(request: NextRequest) {
  try {
    const { name, description, files } = await request.json()
    if (!name || !files) return NextResponse.json({ ok: false, error: 'name and files required' }, { status: 400 })
    await saveUploadedSkill({ name: name.trim(), description: (description || '').trim(), files })
    return NextResponse.json({ ok: true, skillName: name, message: `Skill "${name}" uploaded and activated.` })
  } catch (err) { return NextResponse.json({ ok: false, error: String(err) }, { status: 500 }) }
}
