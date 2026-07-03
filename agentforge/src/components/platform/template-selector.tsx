'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  LayoutTemplate,
  FileCode,
  Lock,
  Eye,
  ArrowRight,
  RefreshCw,
  Loader2,
  CheckCircle2,
  FolderOpen,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────

interface TemplateSummary {
  id: string
  name: string
  category: string
  description: string
  fileCount: number
  lockedFiles: string[]
  prewarmedFiles: string[]
  dependencies: number
  hasSystemPrompt: boolean
}

interface TemplatesResponse {
  templates: TemplateSummary[]
  total: number
}

// ── Category colors ────────────────────────────────────────────────────────────

const categoryConfig: Record<string, { label: string; color: string; bgColor: string }> = {
  'web-app': { label: 'Web App', color: 'text-blue-500', bgColor: 'bg-blue-500/10' },
  'fullstack': { label: 'Fullstack', color: 'text-emerald-500', bgColor: 'bg-emerald-500/10' },
  'api': { label: 'API', color: 'text-orange-500', bgColor: 'bg-orange-500/10' },
  'static': { label: 'Static', color: 'text-violet-500', bgColor: 'bg-violet-500/10' },
  'cli': { label: 'CLI', color: 'text-pink-500', bgColor: 'bg-pink-500/10' },
}

// ── Template Icons ─────────────────────────────────────────────────────────────

const templateIcons: Record<string, string> = {
  'react-tailwind': '⚛️',
  'fullstack-nextjs': '▲',
  'api-express': '🚀',
}

// ── Component ──────────────────────────────────────────────────────────────────

export function TemplateSelector() {
  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [createResult, setCreateResult] = useState<{
    success: boolean
    filesWritten: number
    errors: string[]
  } | null>(null)

  const fetchTemplates = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/templates')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: TemplatesResponse = await res.json()
      setTemplates(data.templates)
    } catch (err) {
      console.error('Failed to fetch templates:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  const handleCreateProject = useCallback(async () => {
    if (!selectedId || !projectName.trim()) return

    setCreating(true)
    setCreateResult(null)

    try {
      const projectId = projectName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')

      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          templateId: selectedId,
          projectId,
          projectName: projectName.trim(),
        }),
      })

      const data = await res.json()
      setCreateResult({
        success: data.success,
        filesWritten: data.filesWritten ?? 0,
        errors: data.errors ?? [],
      })

      if (data.success) {
        setSelectedId(null)
        setProjectName('')
      }
    } catch (err) {
      setCreateResult({
        success: false,
        filesWritten: 0,
        errors: [err instanceof Error ? err.message : 'Failed to create project'],
      })
    } finally {
      setCreating(false)
    }
  }, [selectedId, projectName])

  const selectedTemplate = templates.find((t) => t.id === selectedId)

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="flex items-center gap-2 text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading templates...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/10">
            <LayoutTemplate className="h-4 w-4 text-sky-500" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Project Templates</h2>
            <p className="text-xs text-muted-foreground">
              {templates.length} templates available
            </p>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={fetchTemplates}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Template Grid */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((template) => {
              const category = categoryConfig[template.category] || categoryConfig['web-app']
              const isSelected = selectedId === template.id
              const icon = templateIcons[template.id] || '📦'

              return (
                <Card
                  key={template.id}
                  className={`cursor-pointer transition-all hover:shadow-md ${
                    isSelected
                      ? 'ring-2 ring-primary border-primary'
                      : 'hover:border-primary/50'
                  }`}
                  onClick={() => setSelectedId(isSelected ? null : template.id)}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{icon}</span>
                        <CardTitle className="text-sm">{template.name}</CardTitle>
                      </div>
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${category.color} ${category.bgColor} border-0`}
                      >
                        {category.label}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {template.description}
                    </p>

                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <FileCode className="h-3 w-3" />
                        {template.fileCount} files
                      </div>
                      <div className="flex items-center gap-1">
                        <Lock className="h-3 w-3" />
                        {template.lockedFiles.length} locked
                      </div>
                      <div className="flex items-center gap-1">
                        <Eye className="h-3 w-3" />
                        {template.prewarmedFiles.length} prewarmed
                      </div>
                    </div>

                    {isSelected && (
                      <div className="space-y-2 pt-2 border-t">
                        <div className="text-xs font-medium">Template Details</div>
                        <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                          <div className="rounded border px-2 py-1">
                            <span className="text-muted-foreground">Dependencies:</span>{' '}
                            <span className="font-medium">{template.dependencies}</span>
                          </div>
                          <div className="rounded border px-2 py-1">
                            <span className="text-muted-foreground">System Prompt:</span>{' '}
                            <span className="font-medium">
                              {template.hasSystemPrompt ? 'Yes' : 'No'}
                            </span>
                          </div>
                        </div>
                        {template.lockedFiles.length > 0 && (
                          <div className="space-y-1">
                            <div className="text-[10px] text-muted-foreground">Locked files:</div>
                            <div className="flex flex-wrap gap-1">
                              {template.lockedFiles.map((f) => (
                                <Badge key={f} variant="secondary" className="text-[10px] px-1 py-0">
                                  {f}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* Create Project Section */}
          {selectedTemplate && (
            <Card className="mt-6">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <FolderOpen className="h-4 w-4 text-emerald-500" />
                  Create Project from Template
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {templateIcons[selectedTemplate.id] || '📦'}
                    {selectedTemplate.name}
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Enter project name..."
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    className="text-sm max-w-xs"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateProject()
                    }}
                  />
                </div>
                <Button
                  onClick={handleCreateProject}
                  disabled={!projectName.trim() || creating}
                  className="gap-2"
                >
                  {creating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FolderOpen className="h-4 w-4" />
                  )}
                  {creating ? 'Creating...' : 'Create Project'}
                </Button>

                {/* Result */}
                {createResult && (
                  <div
                    className={`rounded-md border p-3 text-sm ${
                      createResult.success
                        ? 'border-emerald-500/50 bg-emerald-500/5'
                        : 'border-red-500/50 bg-red-500/5'
                    }`}
                  >
                    {createResult.success ? (
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        <span>
                          Project created! {createResult.filesWritten} files written.
                        </span>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-red-500">
                          <span className="font-medium">Failed to create project</span>
                        </div>
                        {createResult.errors.map((err, i) => (
                          <p key={i} className="text-xs text-red-400">{err}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
