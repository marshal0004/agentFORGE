'use client'

import { useEffect, useCallback, useState } from 'react'
import { useSkillStore, type MCPServer, type MCPTool } from '../../../stores/skill-store'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Search,
  Cpu,
  Database,
  GitBranch,
  Server,
  Plug,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Circle,
  Loader2,
  Unplug,
  Link2,
  Wrench,
} from 'lucide-react'

const categoryIcons: Record<string, React.ElementType> = {
  core: Cpu,
  data: Database,
  development: GitBranch,
  infrastructure: Server,
  integrations: Plug,
  ai: Sparkles,
}

const categoryColors: Record<string, string> = {
  core: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  data: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  development: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  infrastructure: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  integrations: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  ai: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
}

const mcpCategories = [
  'all',
  'core',
  'data',
  'development',
  'infrastructure',
  'integrations',
  'ai',
]

interface MCPServerItemProps {
  server: MCPServer
  onConnect: (id: string) => void
  onDisconnect: (id: string) => void
  onToggle: (id: string) => void
}

function MCPServerItem({
  server,
  onConnect,
  onDisconnect,
  onToggle,
}: MCPServerItemProps) {
  const [expanded, setExpanded] = useState(false)
  const CategoryIcon = categoryIcons[server.category] || Cpu
  const categoryColor =
    categoryColors[server.category] || 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'

  // Parse tools if they're stored as a string
  const tools: MCPTool[] = (() => {
    if (Array.isArray(server.tools)) return server.tools
    if (typeof server.tools === 'string') {
      try {
        return JSON.parse(server.tools as string)
      } catch {
        return []
      }
    }
    return []
  })()

  // Parse args if stored as string
  const args: string[] = (() => {
    if (Array.isArray(server.args)) return server.args
    if (typeof server.args === 'string') {
      try {
        return JSON.parse(server.args as string)
      } catch {
        return []
      }
    }
    return []
  })()

  return (
    <div className="rounded-lg border border-border/50 bg-card/50 transition-all hover:border-border hover:bg-card">
      {/* Server Header */}
      <div className="flex items-start gap-3 p-4">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
            categoryColor.split(' ')[0]
          }`}
        >
          <CategoryIcon className={`h-5 w-5 ${categoryColor.split(' ')[1]}`} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{server.name}</h3>
            <Circle
              className={`h-2.5 w-2.5 shrink-0 ${
                server.connected
                  ? 'fill-emerald-400 text-emerald-400'
                  : 'fill-zinc-600 text-zinc-600'
              }`}
            />
            <Badge
              variant="outline"
              className={`shrink-0 text-[10px] ${categoryColor}`}
            >
              {server.category}
            </Badge>
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {server.description}
          </p>

          {/* Command & Args */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">
              {server.command} {args.join(' ')}
            </code>
            {tools.length > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Wrench className="h-3 w-3" />
                {tools.length} tool{tools.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {server.connected && (
            <div className="flex items-center gap-1.5">
              <Switch
                checked={server.enabled}
                onCheckedChange={() => onToggle(server.id)}
                className="scale-75"
              />
            </div>
          )}

          {server.connected ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
              onClick={() => onDisconnect(server.id)}
            >
              <Unplug className="h-3 w-3" />
              Disconnect
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => onConnect(server.id)}
              disabled={!server.enabled}
            >
              <Link2 className="h-3 w-3" />
              Connect
            </Button>
          )}
        </div>
      </div>

      {/* Expandable Tools Section */}
      {tools.length > 0 && (
        <div className="border-t border-border/30">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex w-full items-center gap-2 px-4 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <span>Available Tools ({tools.length})</span>
          </button>

          {expanded && (
            <div className="space-y-1 px-4 pb-3">
              {tools.map((tool, index) => (
                <div
                  key={index}
                  className="flex items-start gap-2 rounded-md bg-muted/30 px-3 py-2"
                >
                  <Wrench className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-xs font-medium">{tool.name}</p>
                    {tool.description && (
                      <p className="text-[10px] text-muted-foreground">
                        {tool.description}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function MCPRegistry() {
  const {
    mcpServers,
    isLoadingMCP,
    mcpSearchQuery,
    selectedMCPCategory,
    setMCPServers,
    connectMCP,
    disconnectMCP,
    toggleMCP,
    setLoadingMCP,
    setMCPSearchQuery,
    setSelectedMCPCategory,
    getFilteredMCPServers,
  } = useSkillStore()

  // Load MCP servers from API on mount
  useEffect(() => {
    const loadServers = async () => {
      setLoadingMCP(true)
      try {
        const response = await fetch('/api/mcp')
        if (response.ok) {
          const data = await response.json()
          const mappedServers: MCPServer[] = (data.servers || []).map(
            (s: Record<string, unknown>) => ({
              id: s.id as string,
              name: s.name as string,
              description: s.description as string,
              command: s.command as string,
              args: typeof s.args === 'string' ? JSON.parse(s.args as string || '[]') : (s.args as string[]) || [],
              env: typeof s.env === 'string' ? JSON.parse(s.env as string || '{}') : (s.env as Record<string, string>) || {},
              category: s.category as string,
              enabled: s.enabled as boolean,
              connected: s.connected as boolean,
              tools: typeof s.tools === 'string' ? JSON.parse(s.tools as string || '[]') : (s.tools as MCPTool[]) || [],
            })
          )
          setMCPServers(mappedServers)
        }
      } catch (error) {
        console.error('Failed to load MCP servers:', error)
      } finally {
        setLoadingMCP(false)
      }
    }
    loadServers()
  }, [setMCPServers, setLoadingMCP])

  const handleConnect = useCallback(
    async (id: string) => {
      try {
        const response = await fetch('/api/mcp', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, action: 'connect' }),
        })
        if (response.ok) {
          connectMCP(id)
        }
      } catch (error) {
        console.error('Failed to connect MCP server:', error)
      }
    },
    [connectMCP]
  )

  const handleDisconnect = useCallback(
    async (id: string) => {
      try {
        const response = await fetch('/api/mcp', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, action: 'disconnect' }),
        })
        if (response.ok) {
          disconnectMCP(id)
        }
      } catch (error) {
        console.error('Failed to disconnect MCP server:', error)
      }
    },
    [disconnectMCP]
  )

  const handleToggle = useCallback(
    async (id: string) => {
      try {
        const response = await fetch('/api/mcp', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, action: 'toggle' }),
        })
        if (response.ok) {
          toggleMCP(id)
        }
      } catch (error) {
        console.error('Failed to toggle MCP server:', error)
      }
    },
    [toggleMCP]
  )

  const filteredServers = getFilteredMCPServers()
  const connectedCount = mcpServers.filter((s) => s.connected).length

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">MCP Server Registry</h2>
            <p className="text-xs text-muted-foreground">
              {connectedCount} of {mcpServers.length} servers connected
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="relative mt-3">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search MCP servers..."
            value={mcpSearchQuery}
            onChange={(e) => setMCPSearchQuery(e.target.value)}
            className="h-8 pl-9 text-xs"
          />
        </div>

        {/* Category Tabs */}
        <div className="mt-3 flex gap-1 overflow-x-auto pb-1">
          {mcpCategories.map((category) => (
            <button
              key={category}
              onClick={() => setSelectedMCPCategory(category)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                selectedMCPCategory === category
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              }`}
            >
              {category !== 'all' &&
                (() => {
                  const Icon = categoryIcons[category]
                  return Icon ? <Icon className="h-3 w-3" /> : null
                })()}
              {category.charAt(0).toUpperCase() + category.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Server List */}
      <ScrollArea className="flex-1 p-4">
        {isLoadingMCP ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredServers.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
            <Search className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              No MCP servers found
            </p>
            <p className="text-xs text-muted-foreground/60">
              Try adjusting your search or filter
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredServers.map((server) => (
              <MCPServerItem
                key={server.id}
                server={server}
                onConnect={handleConnect}
                onDisconnect={handleDisconnect}
                onToggle={handleToggle}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
