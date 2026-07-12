import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export async function GET() {
  try {
    const result = await db.$queryRaw`SELECT name, description, files, enabled FROM UploadedSkill` as Array<{ name: string; description: string; files: string; enabled: number }>
    const skills = result.map(r => ({ name: r.name, description: r.description, fileCount: Object.keys(JSON.parse(r.files || '{}')).length, enabled: r.enabled === 1 }))
    return NextResponse.json({ skills })
  } catch { return NextResponse.json({ skills: [] }) }
}
export async function DELETE(request: NextRequest) {
  try {
    const { name } = await request.json()
    if (!name) return NextResponse.json({ ok: false, error: 'name required' }, { status: 400 })
    await db.$executeRaw`DELETE FROM UploadedSkill WHERE name = ${name}`
    return NextResponse.json({ ok: true })
  } catch { return NextResponse.json({ ok: false, error: 'Failed' }, { status: 500 }) }
}
