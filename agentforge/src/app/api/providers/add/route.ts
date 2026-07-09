import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'
const ENV_FILE = path.join(process.cwd(), '.env.local')

export async function POST(request: NextRequest) {
  try {
    const { name, baseUrl, apiKey, model } = await request.json()
    if (!name || !baseUrl || !apiKey || !model) {
      return NextResponse.json({ ok: false, error: 'name, baseUrl, apiKey, model are all required' }, { status: 400 })
    }
    let existing = ''
    try { existing = await fs.readFile(ENV_FILE, 'utf-8') } catch {}
    let maxIdx = 0
    let m: RegExpExecArray | null
    const re = /CUSTOM_PROVIDER_NAME_(\d+)/g
    while ((m = re.exec(existing)) !== null) { maxIdx = Math.max(maxIdx, parseInt(m[1])) }
    const idx = maxIdx + 1
    const block = `
# ── Custom Provider #${idx}: ${name} (added via UI) ──────────────────────
CUSTOM_PROVIDER_NAME_${idx}=${name}
CUSTOM_PROVIDER_BASE_URL_${idx}=${baseUrl}
CUSTOM_PROVIDER_API_KEY_${idx}=${apiKey}
CUSTOM_PROVIDER_MODEL_${idx}=${model}
`
    await fs.appendFile(ENV_FILE, block, 'utf-8')
    console.log(`[/api/providers/add] Added custom provider #${idx}: ${name}`)
    return NextResponse.json({ ok: true, providerId: `custom-${idx}`, message: `Added. Restart dev server to activate.` })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
