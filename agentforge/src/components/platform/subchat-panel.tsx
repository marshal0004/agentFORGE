'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  GitBranch,
  Plus,
  MessageSquare,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  Send,
  Clock,
  Bot,
  User,
  ChevronDown,
  ChevronRight,
  Trash2,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────

interface SubchatMessage {
  role: string
  content: string
  timestamp: number
}

type SubchatStatus = 'active' | 'resolved' | 'abandoned'

interface SubchatSummary {
  id: string
  parentChatId: string
  parentMessageIndex: number
  title: string
  status: SubchatStatus
  messageCount: number
  messages: SubchatMessage[]
  createdAt: number
  updatedAt: number
}

interface SubchatStats {
  totalSubchats: number
  activeSubchats: number
  resolvedSubchats: number
  abandonedSubchats: number
  totalMessages: number
  parentChats: number
}

// ── Status Config ──────────────────────────────────────────────────────────────

const statusConfig: Record<SubchatStatus, { label: string; color: string; bgColor: string; icon: typeof CheckCircle2 }> = {
  active: { label: 'Active', color: 'text-emerald-500', bgColor: 'bg-emerald-500/10 border-emerald-500/20', icon: Loader2 },
  resolved: { label: 'Resolved', color: 'text-blue-500', bgColor: 'bg-blue-500/10 border-blue-500/20', icon: CheckCircle2 },
  abandoned: { label: 'Abandoned', color: 'text-zinc-400', bgColor: 'bg-zinc-500/10 border-zinc-500/20', icon: XCircle },
}

// ── Component ──────────────────────────────────────────────────────────────────

interface SubchatPanelProps {
  /**
   * The parent chat ID to scope the sub-chat list to. When the user
   * navigates between projects, page.tsx passes the current project's
   * ID here so the panel shows only that project's sub-chats.
   * Defaults to 'main' when no project is active.
   */
  parentChatId?: string
}

export function SubchatPanel({ parentChatId: propParentChatId }: SubchatPanelProps = {}) {
  const [subchats, setSubchats] = useState<SubchatSummary[]>([])
  const [stats, setStats] = useState<SubchatStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [parentChatId, setParentChatId] = useState(propParentChatId ?? 'main')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newFromIndex, setNewFromIndex] = useState('0')
  const [newTitle, setNewTitle] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [chatInput, setChatInput] = useState('')
  const [activeSubchatId, setActiveSubchatId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  // v1.2: Keep the local parentChatId in sync with the prop so navigating
  // between projects updates the sub-chat list automatically.
  useEffect(() => {
    if (propParentChatId && propParentChatId !== parentChatId) {
      setParentChatId(propParentChatId)
    }
  }, [propParentChatId, parentChatId])

  const fetchData = useCallback(async () => {
    try {
      // Fetch subchats for the parent chat
      const res = await fetch(`/api/subchats?parentChatId=${encodeURIComponent(parentChatId)}`)
      if (res.ok) {
        const data = await res.json()
        setSubchats(data.subchats || [])
        if (data.activeSubchat) {
          setActiveSubchatId(data.activeSubchat.id)
        } else {
          setActiveSubchatId(null)
        }
      }

      // Fetch global stats
      const statsRes = await fetch('/api/subchats')
      if (statsRes.ok) {
        const statsData = await statsRes.json()
        setStats(statsData.stats)
      }
    } catch (err) {
      console.error('Failed to fetch subchats:', err)
    } finally {
      setLoading(false)
    }
  }, [parentChatId])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 8000)
    return () => clearInterval(interval)
  }, [fetchData])

  const handleCreateSubchat = useCallback(async () => {
    if (!parentChatId) return

    setCreating(true)
    try {
      const res = await fetch('/api/subchats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          parentChatId,
          fromMessageIndex: parseInt(newFromIndex, 10) || 0,
          title: newTitle.trim() || undefined,
        }),
      })

      const data = await res.json()
      if (data.success) {
        setShowCreateForm(false)
        setNewTitle('')
        setNewFromIndex('0')
        setExpandedId(data.subchat.id)
        setActiveSubchatId(data.subchat.id)
        fetchData()
      } else {
        console.error('Failed to create subchat:', data.error)
      }
    } catch (err) {
      console.error('Failed to create subchat:', err)
    } finally {
      setCreating(false)
    }
  }, [parentChatId, newFromIndex, newTitle, fetchData])

  const handleSendMessage = useCallback(async (subchatId: string) => {
    if (!chatInput.trim()) return

    try {
      await fetch('/api/subchats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add-message',
          subchatId,
          role: 'user',
          content: chatInput.trim(),
        }),
      })
      setChatInput('')
      fetchData()
    } catch (err) {
      console.error('Failed to send message:', err)
    }
  }, [chatInput, fetchData])

  const handleResolve = useCallback(async (subchatId: string) => {
    try {
      await fetch('/api/subchats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve', subchatId }),
      })
      fetchData()
    } catch (err) {
      console.error('Failed to resolve subchat:', err)
    }
  }, [fetchData])

  const handleAbandon = useCallback(async (subchatId: string) => {
    try {
      await fetch('/api/subchats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'abandon', subchatId }),
      })
      fetchData()
    } catch (err) {
      console.error('Failed to abandon subchat:', err)
    }
  }, [fetchData])

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="flex items-center gap-2 text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading subchats...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10">
            <GitBranch className="h-4 w-4 text-purple-500" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Subchats</h2>
            <p className="text-xs text-muted-foreground">
              {stats
                ? `${stats.activeSubchats} active / ${stats.totalSubchats} total`
                : 'Branching conversations'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="gap-1"
          >
            <Plus className="h-3.5 w-3.5" />
            New Subchat
          </Button>
          <Button size="sm" variant="ghost" onClick={fetchData}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-4">
          {/* Stats */}
          {stats && (
            <div className="grid grid-cols-4 gap-2">
              <div className="rounded-md border p-2 text-center">
                <div className="text-lg font-bold text-emerald-500">{stats.activeSubchats}</div>
                <div className="text-[10px] text-muted-foreground">Active</div>
              </div>
              <div className="rounded-md border p-2 text-center">
                <div className="text-lg font-bold text-blue-500">{stats.resolvedSubchats}</div>
                <div className="text-[10px] text-muted-foreground">Resolved</div>
              </div>
              <div className="rounded-md border p-2 text-center">
                <div className="text-lg font-bold">{stats.abandonedSubchats}</div>
                <div className="text-[10px] text-muted-foreground">Abandoned</div>
              </div>
              <div className="rounded-md border p-2 text-center">
                <div className="text-lg font-bold">{stats.totalMessages}</div>
                <div className="text-[10px] text-muted-foreground">Messages</div>
              </div>
            </div>
          )}

          {/* Create Form */}
          {showCreateForm && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Plus className="h-4 w-4 text-emerald-500" />
                  Create Subchat
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Branch from message #</label>
                    <Input
                      type="number"
                      min="0"
                      value={newFromIndex}
                      onChange={(e) => setNewFromIndex(e.target.value)}
                      className="text-xs"
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Title (optional)</label>
                    <Input
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      className="text-xs"
                      placeholder="Auto-generated if empty"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={handleCreateSubchat}
                    disabled={creating}
                    className="gap-1"
                  >
                    {creating ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <GitBranch className="h-3 w-3" />
                    )}
                    {creating ? 'Creating...' : 'Create Branch'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowCreateForm(false)}>
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Active Subchat Banner */}
          {activeSubchatId && (
            <Card className="border-emerald-500/50 bg-emerald-500/5">
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 text-emerald-500 animate-spin" />
                  <div>
                    <span className="text-xs font-medium">Active subchat: </span>
                    <span className="text-xs font-mono">{activeSubchatId}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Subchat List */}
          {subchats.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <GitBranch className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  No subchats yet
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Create a branch to start a side conversation
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {subchats.map((subchat) => {
                const status = statusConfig[subchat.status]
                const StatusIcon = status.icon
                const isExpanded = expandedId === subchat.id
                const isActive = subchat.status === 'active'

                return (
                  <Card key={subchat.id} className={isActive ? 'border-emerald-500/30' : ''}>
                    {/* Subchat Header */}
                    <button
                      className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-muted/50"
                      onClick={() => setExpandedId(isExpanded ? null : subchat.id)}
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{subchat.title}</span>
                          <Badge
                            variant="outline"
                            className={`text-[10px] border ${status.bgColor} ${status.color} shrink-0`}
                          >
                            {subchat.status === 'active' ? (
                              <Loader2 className="h-2.5 w-2.5 animate-spin mr-0.5" />
                            ) : (
                              <StatusIcon className="h-2.5 w-2.5 mr-0.5" />
                            )}
                            {status.label}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-muted-foreground">
                            Branch from msg #{subchat.parentMessageIndex}
                          </span>
                          <span className="text-[10px] text-muted-foreground">&middot;</span>
                          <span className="text-[10px] text-muted-foreground">
                            {subchat.messageCount} messages
                          </span>
                          <span className="text-[10px] text-muted-foreground">&middot;</span>
                          <span className="text-[10px] text-muted-foreground">
                            {formatDate(subchat.createdAt)}
                          </span>
                        </div>
                      </div>
                    </button>

                    {/* Expanded View - Mini Chat */}
                    {isExpanded && (
                      <div className="border-t">
                        {/* Messages */}
                        <ScrollArea className="max-h-64">
                          <div className="p-3 space-y-2">
                            {subchat.messages.length === 0 ? (
                              <p className="text-center text-xs text-muted-foreground py-4">
                                No messages yet. Send a message below.
                              </p>
                            ) : (
                              subchat.messages.map((msg, i) => (
                                <div
                                  key={i}
                                  className={`flex gap-2 ${
                                    msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                                  }`}
                                >
                                  <div
                                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${
                                      msg.role === 'user'
                                        ? 'bg-primary text-primary-foreground'
                                        : 'bg-muted text-muted-foreground'
                                    }`}
                                  >
                                    {msg.role === 'user' ? (
                                      <User className="h-3 w-3" />
                                    ) : (
                                      <Bot className="h-3 w-3" />
                                    )}
                                  </div>
                                  <div
                                    className={`max-w-[80%] rounded-lg px-3 py-2 text-xs ${
                                      msg.role === 'user'
                                        ? 'bg-primary text-primary-foreground'
                                        : 'bg-muted'
                                    }`}
                                  >
                                    <p className="whitespace-pre-wrap">{msg.content}</p>
                                    <div className="mt-1 text-[10px] opacity-60">
                                      {formatTime(msg.timestamp)}
                                    </div>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </ScrollArea>

                        {/* Input (only for active subchats) */}
                        {isActive && (
                          <div className="border-t p-3">
                            <div className="flex items-center gap-2">
                              <Input
                                placeholder="Send a message..."
                                value={expandedId === subchat.id ? chatInput : ''}
                                onChange={(e) => setChatInput(e.target.value)}
                                className="text-xs"
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault()
                                    handleSendMessage(subchat.id)
                                  }
                                }}
                              />
                              <Button
                                size="icon"
                                className="h-8 w-8 shrink-0"
                                onClick={() => handleSendMessage(subchat.id)}
                                disabled={!chatInput.trim()}
                              >
                                <Send className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        )}

                        {/* Actions */}
                        <div className="border-t p-3 flex items-center gap-2">
                          {isActive && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleResolve(subchat.id)}
                                className="gap-1 text-xs"
                              >
                                <CheckCircle2 className="h-3 w-3 text-blue-500" />
                                Resolve
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleAbandon(subchat.id)}
                                className="gap-1 text-xs"
                              >
                                <XCircle className="h-3 w-3 text-muted-foreground" />
                                Abandon
                              </Button>
                            </>
                          )}
                          {subchat.status === 'resolved' && (
                            <Badge variant="secondary" className="text-xs gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              Resolved
                            </Badge>
                          )}
                          {subchat.status === 'abandoned' && (
                            <Badge variant="outline" className="text-xs gap-1">
                              <Trash2 className="h-3 w-3" />
                              Abandoned
                            </Badge>
                          )}
                          <div className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            Updated {formatTime(subchat.updatedAt)}
                          </div>
                        </div>
                      </div>
                    )}
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
