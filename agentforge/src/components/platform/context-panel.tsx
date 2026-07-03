'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Brain,
  FileText,
  Trash2,
  TrendingDown,
  Zap,
  Database,
  Clock,
  RefreshCw,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────

interface LRUFileInfo {
  path: string
  lastAccessed: number
  accessCount: number
  tokenCount: number
  preWarmed: boolean
  language: string
}

interface CompactionRecord {
  id: string
  timestamp: number
  messagesBefore: number
  messagesAfter: number
  tokensSaved: number
  hysteresisApplied: boolean
  toolAbbreviationApplied: boolean
}

interface CacheRecord {
  timestamp: number
  part: 'static' | 'dynamic'
  hit: boolean
  tokenCount: number
  provider: string
}

interface AbbreviationStats {
  totalAbbreviated: number
  totalTokensSaved: number
  byTool: Record<string, { count: number; tokensSaved: number }>
}

interface ContextStats {
  sessionId: string
  model: string
  context: {
    currentTokens: number
    maxTokens: number
    usagePercent: number
    compactionThreshold: number
  }
  lruFiles: {
    tracked: LRUFileInfo[]
    relevant: Array<{ path: string; tokenCount: number; preWarmed: boolean }>
    totalFiles: number
    totalFileTokens: number
    relevantFileTokens: number
  }
  compactionHistory: CompactionRecord[]
  totalTokensSavedFromCompaction: number
  cache: {
    records: CacheRecord[]
    hits: number
    misses: number
    hitRate: number
  }
  abbreviation: AbbreviationStats
  config: {
    maxLRUFiles: number
    lruFileTokenBudget: number
    toolAbbreviationThreshold: number
    enableHysteresis: boolean
    enableToolAbbreviation: boolean
    enableLRUFiles: boolean
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export function ContextPanel() {
  const [stats, setStats] = useState<ContextStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/context')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setStats(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch context stats')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStats()
    const interval = setInterval(fetchStats, 10000) // Refresh every 10s
    return () => clearInterval(interval)
  }, [fetchStats])

  const handleRemoveFile = useCallback(async (filePath: string) => {
    try {
      await fetch('/api/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'forget', path: filePath }),
      })
      // Refresh stats
      fetchStats()
    } catch (err) {
      console.error('Failed to remove file from context:', err)
    }
  }, [fetchStats])

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const formatTokens = (tokens: number) => {
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`
    return tokens.toString()
  }

  if (loading && !stats) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="flex items-center gap-2 text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading context stats...</span>
        </div>
      </div>
    )
  }

  if (error && !stats) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button size="sm" variant="outline" onClick={fetchStats} className="mt-4">
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!stats) return null

  const usagePercent = stats.context.usagePercent
  const usageColor =
    usagePercent >= 90 ? 'text-red-500' :
    usagePercent >= 75 ? 'text-yellow-500' :
    'text-emerald-500'

  const progressColor =
    usagePercent >= 90 ? '[&>div]:bg-red-500' :
    usagePercent >= 75 ? '[&>div]:bg-yellow-500' :
    '[&>div]:bg-emerald-500'

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10">
            <Brain className="h-4 w-4 text-violet-500" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Context Manager</h2>
            <p className="text-xs text-muted-foreground">
              Model: {stats.model} &middot; Session: {stats.sessionId}
            </p>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={fetchStats} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-4">
          {/* Token Usage */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Zap className="h-4 w-4 text-violet-500" />
                Token Usage
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-2xl font-bold">
                  {formatTokens(stats.context.currentTokens)}
                  <span className="text-sm font-normal text-muted-foreground">
                    {' '}/ {formatTokens(stats.context.maxTokens)}
                  </span>
                </span>
                <span className={`text-lg font-semibold ${usageColor}`}>
                  {usagePercent}%
                </span>
              </div>
              <Progress value={usagePercent} className={`h-2 ${progressColor}`} />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Compaction threshold: {stats.context.compactionThreshold}%</span>
                <span>{formatTokens(stats.context.maxTokens - stats.context.currentTokens)} remaining</span>
              </div>
            </CardContent>
          </Card>

          {/* LRU File List */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <FileText className="h-4 w-4 text-blue-500" />
                  LRU Files ({stats.lruFiles.totalFiles})
                </CardTitle>
                <Badge variant="outline" className="text-xs">
                  {formatTokens(stats.lruFiles.totalFileTokens)} tokens
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {stats.lruFiles.tracked.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  No files tracked in context
                </p>
              ) : (
                <div className="max-h-48 space-y-1 overflow-y-auto">
                  {stats.lruFiles.tracked.map((file) => (
                    <div
                      key={file.path}
                      className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-muted/50"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {file.preWarmed && (
                          <Badge variant="secondary" className="shrink-0 text-[10px] px-1 py-0">
                            pre
                          </Badge>
                        )}
                        <span className="truncate text-xs font-mono">{file.path}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-muted-foreground">
                          {formatTokens(file.tokenCount)}t
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {file.accessCount}x
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatTime(file.lastAccessed)}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={() => handleRemoveFile(file.path)}
                        >
                          <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Compaction History */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <TrendingDown className="h-4 w-4 text-orange-500" />
                  Compaction History
                </CardTitle>
                <Badge variant="outline" className="text-xs">
                  {formatTokens(stats.totalTokensSavedFromCompaction)} tokens saved
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {stats.compactionHistory.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  No compactions recorded yet
                </p>
              ) : (
                <div className="max-h-40 space-y-2 overflow-y-auto">
                  {stats.compactionHistory.map((record) => (
                    <div
                      key={record.id}
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          {formatTime(record.timestamp)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs">
                          {record.messagesBefore} → {record.messagesAfter} msgs
                        </span>
                        <Badge variant="secondary" className="text-[10px] px-1 py-0">
                          -{formatTokens(record.tokensSaved)}t
                        </Badge>
                        {record.hysteresisApplied && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0">
                            hyst
                          </Badge>
                        )}
                        {record.toolAbbreviationApplied && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0">
                            abbrev
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Cache Status */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Database className="h-4 w-4 text-teal-500" />
                  Prompt Cache
                </CardTitle>
                <Badge
                  variant={stats.cache.hitRate > 50 ? 'default' : 'outline'}
                  className="text-xs"
                >
                  {stats.cache.hitRate}% hit rate
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md border p-2">
                  <div className="text-lg font-bold text-emerald-500">{stats.cache.hits}</div>
                  <div className="text-[10px] text-muted-foreground">Hits</div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-lg font-bold text-red-500">{stats.cache.misses}</div>
                  <div className="text-[10px] text-muted-foreground">Misses</div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-lg font-bold">{stats.cache.records.length}</div>
                  <div className="text-[10px] text-muted-foreground">Total</div>
                </div>
              </div>
              {stats.cache.records.length > 0 && (
                <div className="max-h-24 space-y-1 overflow-y-auto">
                  {stats.cache.records.slice(-5).map((record, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{record.part}</span>
                      <Badge
                        variant={record.hit ? 'default' : 'outline'}
                        className="text-[10px] px-1 py-0"
                      >
                        {record.hit ? 'hit' : 'miss'}
                      </Badge>
                      <span className="text-muted-foreground">
                        {formatTokens(record.tokenCount)}t
                      </span>
                      <span className="text-muted-foreground">{record.provider}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Tool Abbreviation Stats */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Zap className="h-4 w-4 text-amber-500" />
                  Tool Abbreviation
                </CardTitle>
                <Badge variant="outline" className="text-xs">
                  {formatTokens(stats.abbreviation.totalTokensSaved)} tokens saved
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {stats.abbreviation.totalAbbreviated === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  No tool abbreviations yet
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span>Total abbreviated</span>
                    <span className="font-medium">{stats.abbreviation.totalAbbreviated}</span>
                  </div>
                  <Separator />
                  {Object.entries(stats.abbreviation.byTool).map(([toolName, toolStats]) => (
                    <div key={toolName} className="flex items-center justify-between text-xs">
                      <span className="font-mono">{toolName}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-[10px] px-1 py-0">
                          {toolStats.count}x
                        </Badge>
                        <span className="text-muted-foreground">
                          -{formatTokens(toolStats.tokensSaved)}t
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Config Summary */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center justify-between rounded-md border px-2 py-1.5">
                  <span className="text-muted-foreground">Max LRU Files</span>
                  <span className="font-medium">{stats.config.maxLRUFiles}</span>
                </div>
                <div className="flex items-center justify-between rounded-md border px-2 py-1.5">
                  <span className="text-muted-foreground">LRU Budget</span>
                  <span className="font-medium">{formatTokens(stats.config.lruFileTokenBudget)}t</span>
                </div>
                <div className="flex items-center justify-between rounded-md border px-2 py-1.5">
                  <span className="text-muted-foreground">Abbrev. Threshold</span>
                  <span className="font-medium">{stats.config.toolAbbreviationThreshold}t</span>
                </div>
                <div className="flex items-center justify-between rounded-md border px-2 py-1.5">
                  <span className="text-muted-foreground">Hysteresis</span>
                  <Badge variant={stats.config.enableHysteresis ? 'default' : 'outline'} className="text-[10px] px-1 py-0">
                    {stats.config.enableHysteresis ? 'ON' : 'OFF'}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </div>
  )
}
