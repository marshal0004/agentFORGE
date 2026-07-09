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
