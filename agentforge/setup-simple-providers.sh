#!/usr/bin/env bash
set -euo pipefail
G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; B='\033[0;34m'; N='\033[0m'
ok()   { echo -e "${G}✓${N} $*"; }
info() { echo -e "${B}→${N} $*"; }
warn() { echo -e "${Y}!${N} $*"; }
die()  { echo -e "${R}✗${N} $*"; exit 1; }

info "Checking directory..."
[[ -f "package.json" ]] || die "Not in agentforge/ directory. cd to agentforge/ first."
[[ -d "src/lib" ]] || die "No src/lib/ directory — wrong directory?"
ok "You're in the agentforge/ directory"

info "Step 1: Deleting old dynamic LLM system files..."
rm -rf src/lib/llm-providers/ src/app/api/llm/ src/__tests__/lib/llm-providers/
rm -f stores/llm-store.ts src/components/platform/model-status-pill.tsx .env.example
ok "Deleted old system files"

info "Step 2: Restoring agent chat route from git..."
git checkout -- src/app/api/agent/chat/route.ts 2>/dev/null && ok "Restored route.ts" || warn "route.ts not modified"

info "Step 3: Creating new files..."
mkdir -p src/app/api/providers/add src/app/api/providers/list

cat > src/app/api/providers/add/route.ts << 'ADD_EOF'
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
ADD_EOF
ok "Created add/route.ts"

cat > src/app/api/providers/list/route.ts << 'LIST_EOF'
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
LIST_EOF
ok "Created list/route.ts"

cat > src/components/platform/add-provider-panel.tsx << 'PANEL_EOF'
'use client'
import { useState, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Plus, Loader2, CheckCircle2, AlertCircle, Server } from 'lucide-react'
import { toast } from 'sonner'

interface CustomProvider { index: number; name: string; baseUrl: string; model: string; hasKey: boolean }

export function AddProviderPanel() {
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoadingList, setIsLoadingList] = useState(true)
  const [customProviders, setCustomProviders] = useState<CustomProvider[]>([])
  const [fallbackChain, setFallbackChain] = useState<string[]>([])

  const fetchProviders = useCallback(async () => {
    setIsLoadingList(true)
    try {
      const res = await fetch('/api/providers/list')
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      setCustomProviders(data.customProviders || [])
      setFallbackChain(data.fallbackChain || [])
    } catch {} finally { setIsLoadingList(false) }
  }, [])

  useEffect(() => { fetchProviders() }, [fetchProviders])

  const handleSubmit = useCallback(async () => {
    if (!name.trim() || !baseUrl.trim() || !apiKey.trim() || !model.trim()) { toast.error('All fields required'); return }
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/providers/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim() }) })
      if (!res.ok) throw new Error('Failed')
      toast.success(`Added "${name}" to .env.local. Restart dev server to activate.`)
      setName(''); setBaseUrl(''); setApiKey(''); setModel('')
      await fetchProviders()
    } catch { toast.error('Failed to add provider') } finally { setIsSubmitting(false) }
  }, [name, baseUrl, apiKey, model, fetchProviders])

  return (
    <div className="space-y-6">
      <Card className="bg-zinc-900/50 border-zinc-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm"><Server className="h-4 w-4 text-emerald-400" />Current Fallback Chain</CardTitle>
          <CardDescription className="text-xs">New providers appended after ollama (priority 16+)</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingList ? <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-3 w-3 animate-spin" />Loading...</div> : (
            <div className="flex flex-wrap items-center gap-1">
              {fallbackChain.map((id, i) => (<div key={id} className="flex items-center gap-1"><span className={`text-[10px] px-2 py-0.5 rounded ${id.startsWith('custom-') ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-zinc-800 text-zinc-400'}`}>{id}</span>{i < fallbackChain.length - 1 && <span className="text-zinc-600 text-[10px]">→</span>}</div>))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card className="bg-zinc-900/50 border-zinc-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm"><Plus className="h-4 w-4 text-emerald-400" />Add Custom Provider</CardTitle>
          <CardDescription className="text-xs">Appends to .env.local. Restart dev server after adding.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-[11px] text-zinc-400">Provider Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Together AI" className="h-8 text-xs bg-zinc-950 border-zinc-800" /></div>
            <div className="space-y-1"><Label className="text-[11px] text-zinc-400">Model Name</Label><Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="meta-llama/Llama-3.3-70B-Instruct-Turbo" className="h-8 text-xs bg-zinc-950 border-zinc-800" /></div>
          </div>
          <div className="space-y-1"><Label className="text-[11px] text-zinc-400">Endpoint URL</Label><Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.together.xyz/v1" className="h-8 text-xs bg-zinc-950 border-zinc-800" /></div>
          <div className="space-y-1"><Label className="text-[11px] text-zinc-400">API Key</Label><Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." className="h-8 text-xs bg-zinc-950 border-zinc-800" /></div>
          <Button onClick={handleSubmit} disabled={isSubmitting || !name.trim() || !baseUrl.trim() || !apiKey.trim() || !model.trim()} className="w-full h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-500">{isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}Add Provider to .env.local</Button>
        </CardContent>
      </Card>
      {customProviders.length > 0 && (
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardHeader><CardTitle className="text-sm">Existing Custom Providers</CardTitle><CardDescription className="text-xs">{customProviders.length} provider(s) in .env.local</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {customProviders.map((p) => (<div key={p.index} className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-950/50 px-3 py-2"><div className="space-y-0.5"><div className="flex items-center gap-2"><span className="text-xs font-medium text-zinc-200">{p.name}</span><span className="text-[9px] px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-400">custom-{p.index}</span></div><div className="text-[10px] text-zinc-500">{p.model} · {p.baseUrl}</div></div><div>{p.hasKey ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <AlertCircle className="h-3.5 w-3.5 text-amber-400" />}</div></div>))}
            <p className="text-[10px] text-zinc-600 pt-1">To remove: delete its 4 lines from .env.local and restart.</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
PANEL_EOF
ok "Created add-provider-panel.tsx"

info "Step 4: Patching existing files..."
python3 << 'PYEOF'
import os

def patch(filepath):
    if not os.path.exists(filepath): print(f"  SKIP {filepath} (not found)"); return
    with open(filepath, 'r', encoding='utf-8') as f: content = f.read()
    orig = content
    changes = []

    if 'agent-chat.tsx' in filepath:
        imp = "import { ModelStatusPill } from '@/components/platform/model-status-pill'\n"
        if imp in content: content = content.replace(imp, ''); changes.append("removed ModelStatusPill import")
        jsx = "          {/* Dynamic LLM Model Status Pill\n              Shows the currently active model + dropdown for manual override.\n              Auto-updates when the build-loop-controller switches models. */}\n          <ModelStatusPill />\n\n"
        if jsx in content: content = content.replace(jsx, ''); changes.append("removed ModelStatusPill JSX")

    if 'llm-provider.ts' in filepath:
        if 'getFallbackChain' not in content:
            old = "  /**\n   * Get the default provider.\n   */\n  getDefaultProvider(): LLMProvider | undefined {"
            new = "  /**\n   * Get the current fallback chain (provider IDs in priority order).\n   */\n  getFallbackChain(): string[] {\n    return [...this.fallbackChain]\n  }\n\n  /**\n   * Get the default provider.\n   */\n  getDefaultProvider(): LLMProvider | undefined {"
            if old in content: content = content.replace(old, new); changes.append("added getFallbackChain()")
        if 'Custom providers (added via UI' not in content:
            old = "    // Log the fallback chain for debugging"
            new = """    // ── Custom providers (added via UI at /api/providers/add) ──────────────
    let customPriority = 16
    for (let i = 1; i <= 50; i++) {
      const cpName = process.env[`CUSTOM_PROVIDER_NAME_${i}`]
      if (!cpName) continue
      const cpBaseUrl = process.env[`CUSTOM_PROVIDER_BASE_URL_${i}`]
      const cpApiKey = process.env[`CUSTOM_PROVIDER_API_KEY_${i}`]
      const cpModel = process.env[`CUSTOM_PROVIDER_MODEL_${i}`]
      if (!cpBaseUrl || !cpApiKey || !cpModel) { console.warn(`[LLM Registry] Custom #${i} incomplete — skipping`); continue }
      this.registerOpenAICompatible({ id: `custom-${i}`, name: `${cpName} (${cpModel})`, apiKey: cpApiKey, baseUrl: cpBaseUrl, models: [cpModel], priority: customPriority++ })
      console.log(`[LLM Registry] Custom #${i}: ${cpName} (${cpModel}) — priority ${customPriority - 1}`)
    }

    // Log the fallback chain for debugging"""
            if old in content: content = content.replace(old, new); changes.append("added custom provider scanning")

    if 'app/page' in filepath and 'page.tsx' in filepath:
        if 'AddProviderPanel' not in content:
            old_imp = "import { TemplateSelector } from '@/components/platform/template-selector'"
            new_imp = "import { TemplateSelector } from '@/components/platform/template-selector'\nimport { AddProviderPanel } from '@/components/platform/add-provider-panel'"
            if old_imp in content: content = content.replace(old_imp, new_imp); changes.append("added import")
            old_sv = """function SettingsView() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md space-y-6 text-center">"""
            new_sv = """function SettingsView() {
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-6">"""
            if old_sv in content:
                content = content.replace(old_sv, new_sv)
                old_pref = "            Configure your AgentForge environment, API keys, and preferences."
                new_pref = "            Configure your AgentForge environment, API keys, and providers."
                content = content.replace(old_pref, new_pref)
                old_end = """          </div>
        </div>
      </div>
    </div>
  )
}"""
                new_end = """          </div>
        </div>

        {/* Add Custom Provider Panel */}
        <AddProviderPanel />
      </div>
    </div>
  )
}"""
                if old_end in content: content = content.replace(old_end, new_end, 1); changes.append("added AddProviderPanel to SettingsView")

    if content != orig:
        with open(filepath, 'w', encoding='utf-8') as f: f.write(content)
        print(f"  ✓ {filepath}: {', '.join(changes)}")
    else: print(f"  - {filepath}: no changes needed")

patch('src/components/platform/agent-chat.tsx')
patch('src/lib/llm-provider.ts')
patch('src/app/page.tsx')
PYEOF
ok "Patches applied"

info "Step 5: Verifying..."
for f in src/app/api/providers/add/route.ts src/app/api/providers/list/route.ts src/components/platform/add-provider-panel.tsx; do
  [[ -f "$f" ]] && ok "$f exists" || warn "$f MISSING"
done

info "Step 6: Typecheck..."
if command -v bun &> /dev/null; then
  ERRS=$(bun run typecheck 2>&1 | grep -E "providers/add|providers/list|add-provider-panel|page.tsx" | head -5 || true)
  [[ -z "$ERRS" ]] && ok "Typecheck passed" || warn "Errors: $ERRS"
fi

echo ""
echo -e "${G}═══════════════════════════════════════════════════${N}"
echo -e "${G}  ✅  DONE — Simple Provider System Installed${N}"
echo -e "${G}═══════════════════════════════════════════════════${N}"
echo ""
echo "  Next: rm -rf .next && bun run dev"
echo "  Then: open http://localhost:3000 → click gear icon (Settings)"
echo "  Fill the form → click Add → restart dev server"
echo ""
