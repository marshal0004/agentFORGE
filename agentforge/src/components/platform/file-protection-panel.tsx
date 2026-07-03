'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Shield,
  Lock,
  Unlock,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  FileWarning,
  RefreshCw,
  Search,
  RotateCcw,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────

interface ProtectionRule {
  pattern: string
  reason: string
  allowRead: boolean
  allowWrite: boolean
}

interface BlockedOperation {
  id: string
  timestamp: number
  filePath: string
  operation: 'read' | 'write'
  reason: string
  matchedPattern?: string
}

interface ProtectionState {
  enabled: boolean
  rules: ProtectionRule[]
  totalRules: number
  blockedOperations: BlockedOperation[]
  defaultRulesCount: number
}

interface PathDiagnosis {
  path: string
  normalized: string
  canRead: boolean
  canWrite: boolean
  matchingRule: ProtectionRule | null
  isUnlocked: boolean
  protectionEnabled: boolean
}

// ── Component ──────────────────────────────────────────────────────────────────

export function FileProtectionPanel() {
  const [state, setState] = useState<ProtectionState>({
    enabled: true,
    rules: [],
    totalRules: 0,
    blockedOperations: [],
    defaultRulesCount: 0,
  })
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newPattern, setNewPattern] = useState('')
  const [newReason, setNewReason] = useState('')
  const [newAllowRead, setNewAllowRead] = useState(true)
  const [newAllowWrite, setNewAllowWrite] = useState(false)
  const [diagnosisPath, setDiagnosisPath] = useState('')
  const [diagnosis, setDiagnosis] = useState<PathDiagnosis | null>(null)

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/protection')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setState(data)
    } catch (err) {
      console.error('Failed to fetch protection state:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchState()
    const interval = setInterval(fetchState, 15000)
    return () => clearInterval(interval)
  }, [fetchState])

  const handleToggleProtection = useCallback(async (enabled: boolean) => {
    try {
      const res = await fetch('/api/protection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle-protection', enabled }),
      })
      const data = await res.json()
      if (data.success) {
        setState((prev) => ({ ...prev, enabled: data.enabled }))
      }
    } catch (err) {
      console.error('Failed to toggle protection:', err)
    }
  }, [])

  const handleAddRule = useCallback(async () => {
    if (!newPattern.trim() || !newReason.trim()) return

    try {
      const res = await fetch('/api/protection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add-rule',
          pattern: newPattern.trim(),
          reason: newReason.trim(),
          allowRead: newAllowRead,
          allowWrite: newAllowWrite,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setNewPattern('')
        setNewReason('')
        setNewAllowRead(true)
        setNewAllowWrite(false)
        setShowAddForm(false)
        fetchState()
      }
    } catch (err) {
      console.error('Failed to add rule:', err)
    }
  }, [newPattern, newReason, newAllowRead, newAllowWrite, fetchState])

  const handleRemoveRule = useCallback(async (pattern: string) => {
    try {
      await fetch('/api/protection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove-rule', pattern }),
      })
      fetchState()
    } catch (err) {
      console.error('Failed to remove rule:', err)
    }
  }, [fetchState])

  const handleResetDefaults = useCallback(async () => {
    try {
      await fetch('/api/protection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset-defaults' }),
      })
      fetchState()
    } catch (err) {
      console.error('Failed to reset defaults:', err)
    }
  }, [fetchState])

  const handleCheckPath = useCallback(async () => {
    if (!diagnosisPath.trim()) return

    try {
      const res = await fetch('/api/protection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check-path', filePath: diagnosisPath.trim() }),
      })
      const data = await res.json()
      setDiagnosis(data.diagnosis)
    } catch (err) {
      console.error('Failed to check path:', err)
    }
  }, [diagnosisPath])

  const handleUnlock = useCallback(async (filePath: string) => {
    try {
      await fetch('/api/protection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unlock', filePath }),
      })
      // Re-check path if it matches
      if (diagnosisPath === filePath) {
        handleCheckPath()
      }
    } catch (err) {
      console.error('Failed to unlock:', err)
    }
  }, [diagnosisPath, handleCheckPath])

  const handleRelock = useCallback(async (filePath: string) => {
    try {
      await fetch('/api/protection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'relock', filePath }),
      })
      if (diagnosisPath === filePath) {
        handleCheckPath()
      }
    } catch (err) {
      console.error('Failed to relock:', err)
    }
  }, [diagnosisPath, handleCheckPath])

  const handleClearLog = useCallback(async () => {
    try {
      await fetch('/api/protection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear-blocked-log' }),
      })
      setState((prev) => ({ ...prev, blockedOperations: [] }))
    } catch (err) {
      console.error('Failed to clear log:', err)
    }
  }, [])

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="flex items-center gap-2 text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading protection rules...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/10">
            <Shield className="h-4 w-4 text-rose-500" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">File Protection</h2>
            <p className="text-xs text-muted-foreground">
              {state.totalRules} rules &middot; {state.blockedOperations.length} blocked
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={state.enabled ? 'default' : 'outline'}
            className={`text-xs ${state.enabled ? 'bg-emerald-500' : ''}`}
          >
            {state.enabled ? 'Protected' : 'Disabled'}
          </Badge>
          <Button size="sm" variant="ghost" onClick={fetchState}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-4">
          {/* Global Toggle */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {state.enabled ? (
                    <Lock className="h-5 w-5 text-emerald-500" />
                  ) : (
                    <Unlock className="h-5 w-5 text-red-500" />
                  )}
                  <div>
                    <div className="text-sm font-medium">
                      File Protection {state.enabled ? 'Enabled' : 'Disabled'}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {state.enabled
                        ? 'Protected files cannot be modified by the agent'
                        : 'WARNING: All file modifications are allowed'}
                    </div>
                  </div>
                </div>
                <Switch
                  checked={state.enabled}
                  onCheckedChange={handleToggleProtection}
                />
              </div>
            </CardContent>
          </Card>

          {/* Protected Files List */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Lock className="h-4 w-4 text-rose-500" />
                  Protection Rules
                </CardTitle>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleResetDefaults}
                    className="gap-1 text-xs"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Reset
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowAddForm(!showAddForm)}
                    className="gap-1"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Rule
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Add Rule Form */}
              {showAddForm && (
                <div className="rounded-md border p-3 space-y-2">
                  <Input
                    placeholder="File pattern (e.g., *.config.ts, src/**/*.test.ts)"
                    value={newPattern}
                    onChange={(e) => setNewPattern(e.target.value)}
                    className="text-xs"
                  />
                  <Input
                    placeholder="Reason for protection"
                    value={newReason}
                    onChange={(e) => setNewReason(e.target.value)}
                    className="text-xs"
                  />
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={newAllowRead}
                        onCheckedChange={setNewAllowRead}
                        className="scale-75"
                      />
                      <span className="text-xs flex items-center gap-1">
                        <Eye className="h-3 w-3" /> Read
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={newAllowWrite}
                        onCheckedChange={setNewAllowWrite}
                        className="scale-75"
                      />
                      <span className="text-xs flex items-center gap-1">
                        <Eye className="h-3 w-3" /> Write
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={handleAddRule} className="gap-1">
                      <Plus className="h-3 w-3" />
                      Add
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowAddForm(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {/* Rules List */}
              <div className="max-h-96 space-y-1 overflow-y-auto">
                {state.rules.map((rule, i) => (
                  <div
                    key={`${rule.pattern}-${i}`}
                    className="flex items-center justify-between rounded-md border px-3 py-2 hover:bg-muted/50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-xs font-mono font-medium">
                          {rule.pattern}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground">
                          {rule.reason}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge
                        variant={rule.allowRead ? 'default' : 'destructive'}
                        className="text-[10px] px-1 py-0 gap-0.5"
                      >
                        {rule.allowRead ? <Eye className="h-2.5 w-2.5" /> : <EyeOff className="h-2.5 w-2.5" />}
                        R
                      </Badge>
                      <Badge
                        variant={rule.allowWrite ? 'default' : 'destructive'}
                        className="text-[10px] px-1 py-0 gap-0.5"
                      >
                        {rule.allowWrite ? <Eye className="h-2.5 w-2.5" /> : <EyeOff className="h-2.5 w-2.5" />}
                        W
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => handleRemoveRule(rule.pattern)}
                      >
                        <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Path Diagnosis */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Search className="h-4 w-4 text-blue-500" />
                Check Path
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Enter file path to check (e.g., package.json)"
                  value={diagnosisPath}
                  onChange={(e) => setDiagnosisPath(e.target.value)}
                  className="text-xs"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCheckPath()
                  }}
                />
                <Button size="sm" variant="outline" onClick={handleCheckPath} className="gap-1">
                  <Search className="h-3 w-3" />
                  Check
                </Button>
              </div>
              {diagnosis && (
                <div className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Path</span>
                    <span className="font-mono">{diagnosis.normalized}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Can Read</span>
                    <Badge
                      variant={diagnosis.canRead ? 'default' : 'destructive'}
                      className="text-[10px] px-1 py-0"
                    >
                      {diagnosis.canRead ? 'Yes' : 'No'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Can Write</span>
                    <Badge
                      variant={diagnosis.canWrite ? 'default' : 'destructive'}
                      className="text-[10px] px-1 py-0"
                    >
                      {diagnosis.canWrite ? 'Yes' : 'No'}
                    </Badge>
                  </div>
                  {diagnosis.matchingRule && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Matched Rule</span>
                      <span className="font-mono text-xs">{diagnosis.matchingRule.pattern}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Unlocked</span>
                    <Badge
                      variant={diagnosis.isUnlocked ? 'default' : 'outline'}
                      className="text-[10px] px-1 py-0"
                    >
                      {diagnosis.isUnlocked ? 'Yes' : 'No'}
                    </Badge>
                  </div>
                  <Separator />
                  <div className="flex items-center gap-2">
                    {diagnosis.isUnlocked ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRelock(diagnosisPath)}
                        className="gap-1 text-xs"
                      >
                        <Lock className="h-3 w-3" />
                        Re-lock
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleUnlock(diagnosisPath)}
                        className="gap-1 text-xs"
                      >
                        <Unlock className="h-3 w-3" />
                        Unlock
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Blocked Operations Log */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <FileWarning className="h-4 w-4 text-red-500" />
                  Blocked Operations ({state.blockedOperations.length})
                </CardTitle>
                {state.blockedOperations.length > 0 && (
                  <Button size="sm" variant="ghost" onClick={handleClearLog} className="text-xs">
                    Clear
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {state.blockedOperations.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  No blocked operations recorded
                </p>
              ) : (
                <div className="max-h-48 space-y-1 overflow-y-auto">
                  {state.blockedOperations.slice(-30).reverse().map((op) => (
                    <div
                      key={op.id}
                      className="flex items-center justify-between rounded-md border px-2 py-1.5 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge
                          variant={op.operation === 'write' ? 'destructive' : 'secondary'}
                          className="text-[10px] px-1 py-0 shrink-0"
                        >
                          {op.operation}
                        </Badge>
                        <span className="font-mono truncate">{op.filePath}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-muted-foreground truncate max-w-[120px]">
                          {op.reason}
                        </span>
                        <span className="text-muted-foreground">
                          {formatTime(op.timestamp)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </div>
  )
}
