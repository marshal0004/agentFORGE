import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { llmProviderRegistry } from '@/lib/llm-provider'

export const dynamic = 'force-dynamic'
const ENV_FILE = path.join(process.cwd(), '.env.local')

export async function GET() {
  try {
    let content = ''
    try { content = await fs.readFile(ENV_FILE, 'utf-8') } catch {}
    const providers: any[] = []
    const re = /CUSTOM_PROVIDER_NAME_(\d+)=(.+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) {
      const idx = parseInt(m[1])
      const baseUrl = content.match(new RegExp(`CUSTOM_PROVIDER_BASE_URL_${idx}=(.+)`))
      const apiKey = content.match(new RegExp(`CUSTOM_PROVIDER_API_KEY_${idx}=(.+)`))
      const model = content.match(new RegExp(`CUSTOM_PROVIDER_MODEL_${idx}=(.+)`))
      providers.push({ index: idx, name: m[2].trim(), baseUrl: baseUrl ? baseUrl[1].trim() : '', model: model ? model[1].trim() : '', hasKey: !!apiKey })
    }
    providers.sort((a, b) => a.index - b.index)
    return NextResponse.json({ customProviders: providers, fallbackChain: llmProviderRegistry.getFallbackChain(), totalProviders: llmProviderRegistry.getFallbackChain().length })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
