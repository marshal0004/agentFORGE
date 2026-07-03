'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  ShieldCheck,
  AlertTriangle,
  XCircle,
  Loader2,
  RefreshCw,
  Play,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Wrench,
  FileWarning,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────

interface ValidationError {
  file: string
  line?: number
  column?: number
  severity: 'error' | 'warning'
  message: string
  code?: string
  source?: string
}

interface CorrectionHistoryEntry {
  iteration: number
  errorsBefore: number
  errorsAfter: number
  fixesApplied: string[]
}

interface BlockedOperation {
  id: string
  timestamp: number
  filePath: string
  operation: string
  reason: string
}

interface CorrectionState {
  status: 'idle' | 'running' | 'pass' | 'fail'
  errors: ValidationError[]
  warnings: ValidationError[]
  lastResult: {
    validated: boolean
    iterations: number
    maxIterations: number
    fixedErrors: number
    remainingErrors: number
    correctionHistory: CorrectionHistoryEntry[]
  } | null
  stepToggles: Record<string, boolean>
  autoFixEnabled: boolean
  blockedOperations: BlockedOperation[]
}

// ── Component ──────────────────────────────────────────────────────────────────

export function CorrectionPanel() {
  const [state, setState] = useState<CorrectionState>({
    status: 'idle',
    errors: [],
    warnings: [],
    lastResult: null,
    stepToggles: { typescript: true, eslint: true, prettier: true },
    autoFixEnabled: true,
    blockedOperations: [],
  })
  const [loading, setLoading] = useState(true)
  const [expandedErrors, setExpandedErrors] = useState<Record<string, boolean>>({})
  const [projectPath, setProjectPath] = useState('.')

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/correction')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setState(data)
    } catch (err) {
      console.error('Failed to fetch correction status:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 8000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  const handleValidate = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, status: 'running' }))
      const res = await fetch('/api/correction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'validate',
          projectPath,
        }),
      })
      const data = await res.json()
      setState((prev) => ({
        ...prev,
        status: data.status,
        errors: data.errors || [],
        warnings: data.warnings || [],
      }))
    } catch (err) {
      console.error('Validation failed:', err)
      setState((prev) => ({ ...prev, status: 'fail' }))
    }
  }, [projectPath])

  const handleCorrect = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, status: 'running' }))
      const res = await fetch('/api/correction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'correct',
          projectPath,
        }),
      })
      const data = await res.json()
      setState((prev) => ({
        ...prev,
        status: data.status,
        errors: data.errors || [],
        warnings: data.warnings || [],
        lastResult: {
          validated: data.validated,
          iterations: data.iterations,
          maxIterations: data.maxIterations,
          fixedErrors: data.fixedErrors,
          remainingErrors: data.remainingErrors,
          correctionHistory: data.correctionHistory || [],
        },
      }))
    } catch (err) {
      console.error('Correction failed:', err)
      setState((prev) => ({ ...prev, status: 'fail' }))
    }
  }, [projectPath])

  const handleToggleStep = useCallback(async (stepName: string, enabled: boolean) => {
    try {
      await fetch('/api/correction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle-step', stepName, enabled }),
      })
      setState((prev) => ({
        ...prev,
        stepToggles: { ...prev.stepToggles, [stepName]: enabled },
      }))
    } catch (err) {
      console.error('Failed to toggle step:', err)
    }
  }, [])

  const handleToggleAutoFix = useCallback(async (enabled: boolean) => {
    try {
      await fetch('/api/correction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle-autofix', enabled }),
      })
      setState((prev) => ({ ...prev, autoFixEnabled: enabled }))
    } catch (err) {
      console.error('Failed to toggle auto-fix:', err)
    }
  }, [])

  const toggleExpand = useCallback((key: string) => {
    setExpandedErrors((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const statusConfig = {
    idle: { label: 'Idle', icon: ShieldCheck, color: 'text-zinc-400', bgColor: 'bg-zinc-500/10 border-zinc-500/20' },
    running: { label: 'Running', icon: Loader2, color: 'text-yellow-400', bgColor: 'bg-yellow-500/10 border-yellow-500/20' },
    pass: { label: 'Passed', icon: CheckCircle2, color: 'text-emerald-400', bgColor: 'bg-emerald-500/10 border-emerald-500/20' },
    fail: { label: 'Failed', icon: XCircle, color: 'text-red-400', bgColor: 'bg-red-500/10 border-red-500/20' },
  }

  const currentStatus = statusConfig[state.status]
  const StatusIcon = currentStatus.icon

  // Group errors by file
  const errorsByFile = state.errors.reduce<Record<string, ValidationError[]>>((acc, err) => {
    const key = err.file
    if (!acc[key]) acc[key] = []
    acc[key].push(err)
    return acc
  }, {})

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="flex items-center gap-2 text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading correction status...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500/10">
            <ShieldCheck className="h-4 w-4 text-orange-500" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Self-Correction</h2>
            <p className="text-xs text-muted-foreground">
              Validate &middot; Fix &middot; Re-validate
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={`gap-1.5 border text-xs ${currentStatus.bgColor} ${currentStatus.color}`}
          >
            {state.status === 'running' ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <StatusIcon className="h-3 w-3" />
            )}
            {currentStatus.label}
          </Badge>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-4">
          {/* Validation Status & Controls */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Wrench className="h-4 w-4 text-orange-500" />
                Controls
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleValidate}
                  disabled={state.status === 'running'}
                  className="gap-1.5"
                >
                  <Play className="h-3.5 w-3.5" />
                  Validate
                </Button>
                <Button
                  size="sm"
                  onClick={handleCorrect}
                  disabled={state.status === 'running' || !state.autoFixEnabled}
                  className="gap-1.5"
                >
                  {state.status === 'running' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Wrench className="h-3.5 w-3.5" />
                  )}
                  Auto-Correct
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={fetchStatus}
                  className="gap-1.5"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* Stats Row */}
              <div className="grid grid-cols-4 gap-2">
                <div className="rounded-md border p-2 text-center">
                  <div className="text-lg font-bold text-red-500">{state.errors.length}</div>
                  <div className="text-[10px] text-muted-foreground">Errors</div>
                </div>
                <div className="rounded-md border p-2 text-center">
                  <div className="text-lg font-bold text-yellow-500">{state.warnings.length}</div>
                  <div className="text-[10px] text-muted-foreground">Warnings</div>
                </div>
                <div className="rounded-md border p-2 text-center">
                  <div className="text-lg font-bold text-emerald-500">
                    {state.lastResult?.fixedErrors ?? 0}
                  </div>
                  <div className="text-[10px] text-muted-foreground">Fixed</div>
                </div>
                <div className="rounded-md border p-2 text-center">
                  <div className="text-lg font-bold">
                    {state.lastResult?.iterations ?? 0}
                  </div>
                  <div className="text-[10px] text-muted-foreground">Iterations</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Error List */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <FileWarning className="h-4 w-4 text-red-500" />
                Errors ({state.errors.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {state.errors.length === 0 ? (
                <div className="py-4 text-center">
                  <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500 mb-2" />
                  <p className="text-sm text-muted-foreground">
                    {state.status === 'pass' ? 'All validations passed!' : 'No errors found'}
                  </p>
                </div>
              ) : (
                <div className="max-h-64 space-y-1 overflow-y-auto">
                  {Object.entries(errorsByFile).map(([file, fileErrors]) => {
                    const isExpanded = expandedErrors[file] ?? true
                    return (
                      <div key={file} className="rounded-md border">
                        <button
                          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50"
                          onClick={() => toggleExpand(file)}
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                          )}
                          <span className="truncate text-xs font-mono">{file}</span>
                          <Badge variant="destructive" className="ml-auto shrink-0 text-[10px] px-1 py-0">
                            {fileErrors.length}
                          </Badge>
                        </button>
                        {isExpanded && (
                          <div className="border-t px-3 py-1">
                            {fileErrors.map((err, i) => (
                              <div
                                key={`${err.file}:${err.line}:${i}`}
                                className="flex items-start gap-2 py-1.5"
                              >
                                <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-red-500" />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1">
                                    {err.line && (
                                      <span className="text-[10px] text-muted-foreground">
                                        :{err.line}{err.column ? `:${err.column}` : ''}
                                      </span>
                                    )}
                                    {err.code && (
                                      <Badge variant="outline" className="text-[10px] px-1 py-0">
                                        {err.code}
                                      </Badge>
                                    )}
                                    {err.source && (
                                      <Badge variant="secondary" className="text-[10px] px-1 py-0">
                                        {err.source}
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="text-xs">{err.message}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Warnings */}
          {state.warnings.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  Warnings ({state.warnings.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-32 space-y-1 overflow-y-auto">
                  {state.warnings.map((warn, i) => (
                    <div key={`warn-${i}`} className="flex items-start gap-2 py-1">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-yellow-500" />
                      <span className="text-xs font-mono text-muted-foreground">
                        {warn.file}{warn.line ? `:${warn.line}` : ''}
                      </span>
                      <span className="text-xs truncate">{warn.message}</span>
                      {warn.source && (
                        <Badge variant="secondary" className="shrink-0 text-[10px] px-1 py-0">
                          {warn.source}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Correction Loop Status */}
          {state.lastResult && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <RefreshCw className="h-4 w-4 text-violet-500" />
                  Correction Loop
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span>Iteration</span>
                  <span className="font-medium">
                    {state.lastResult.iterations} / {state.lastResult.maxIterations}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span>Errors Fixed</span>
                  <span className="font-medium text-emerald-500">
                    {state.lastResult.fixedErrors}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span>Remaining</span>
                  <span className="font-medium text-red-500">
                    {state.lastResult.remainingErrors}
                  </span>
                </div>
                {state.lastResult.correctionHistory.length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-1">
                      {state.lastResult.correctionHistory.map((entry) => (
                        <div
                          key={entry.iteration}
                          className="flex items-center justify-between rounded-md border px-2 py-1.5 text-xs"
                        >
                          <span className="text-muted-foreground">
                            Iteration {entry.iteration}
                          </span>
                          <div className="flex items-center gap-2">
                            <span>
                              {entry.errorsBefore} → {entry.errorsAfter}
                            </span>
                            <Badge
                              variant={entry.errorsAfter < entry.errorsBefore ? 'default' : 'outline'}
                              className="text-[10px] px-1 py-0"
                            >
                              {entry.errorsAfter < entry.errorsBefore
                                ? `-${entry.errorsBefore - entry.errorsAfter}`
                                : 'no change'}
                            </Badge>
                          </div>
                          <div className="text-muted-foreground">
                            {entry.fixesApplied.length} fixes
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Toggles */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Auto-fix toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Auto-Fix</div>
                  <div className="text-xs text-muted-foreground">
                    Automatically fix errors after validation
                  </div>
                </div>
                <Switch
                  checked={state.autoFixEnabled}
                  onCheckedChange={handleToggleAutoFix}
                />
              </div>
              <Separator />
              {/* Validation step toggles */}
              <div className="space-y-2">
                <div className="text-sm font-medium">Validation Steps</div>
                {(['typescript', 'eslint', 'prettier'] as const).map((stepName) => (
                  <div key={stepName} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={stepName === 'typescript' ? 'default' : stepName === 'eslint' ? 'secondary' : 'outline'}
                        className="text-[10px] px-1.5 py-0.5 capitalize"
                      >
                        {stepName}
                      </Badge>
                    </div>
                    <Switch
                      checked={state.stepToggles[stepName] ?? true}
                      onCheckedChange={(checked) => handleToggleStep(stepName, checked)}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Blocked Operations */}
          {state.blockedOperations.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <XCircle className="h-4 w-4 text-red-500" />
                  Blocked Operations ({state.blockedOperations.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-32 space-y-1 overflow-y-auto">
                  {state.blockedOperations.slice(-10).map((op) => (
                    <div
                      key={op.id}
                      className="flex items-center justify-between rounded-md border px-2 py-1.5 text-xs"
                    >
                      <span className="font-mono truncate">{op.filePath}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="destructive" className="text-[10px] px-1 py-0">
                          {op.operation}
                        </Badge>
                        <span className="text-muted-foreground">{op.reason}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
