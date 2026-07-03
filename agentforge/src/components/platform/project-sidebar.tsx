'use client'

import { useAgentStore } from '../../../stores/agent-store'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  MessageSquare,
  Wrench,
  Plug,
  FolderOpen,
  Settings,
  Zap,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'

interface ProjectSidebarProps {
  activeSection: string
  onNavigate: (section: string) => void
  collapsed?: boolean
  onToggleCollapse?: () => void
}

const statusDotColors: Record<string, string> = {
  idle: 'bg-zinc-400',
  thinking: 'bg-yellow-400',
  coding: 'bg-emerald-400',
  executing: 'bg-sky-400',
  previewing: 'bg-purple-400',
  error: 'bg-red-400',
}

const navItems = [
  { id: 'agent', label: 'Agent', icon: MessageSquare },
  { id: 'skills', label: 'Skills', icon: Wrench },
  { id: 'mcp', label: 'MCP', icon: Plug },
  { id: 'projects', label: 'Projects', icon: FolderOpen },
  { id: 'settings', label: 'Settings', icon: Settings },
]

export function ProjectSidebar({
  activeSection,
  onNavigate,
  collapsed = false,
  onToggleCollapse,
}: ProjectSidebarProps) {
  const { agentStatus, currentProject, currentProjectName } = useAgentStore()

  return (
    <div
      className={`flex h-full flex-col border-r bg-zinc-950 transition-all duration-300 ${
        collapsed ? 'w-14' : 'w-52'
      }`}
    >
      {/* Logo */}
      <div className="flex items-center gap-2 px-3 py-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
          <Zap className="h-4 w-4 text-emerald-500" />
        </div>
        {!collapsed && (
          <span className="text-sm font-bold tracking-tight text-zinc-100">
            AgentForge
          </span>
        )}
      </div>

      <Separator className="bg-zinc-800" />

      {/* Navigation */}
      <nav className="flex-1 px-2 py-2">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const isActive = activeSection === item.id
            const Icon = item.icon

            return (
              <li key={item.id}>
                <button
                  onClick={() => onNavigate(item.id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300'
                  }`}
                  title={collapsed ? item.label : undefined}
                >
                  <div className="relative">
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.id === 'agent' && (
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-zinc-950 ${
                          statusDotColors[agentStatus]
                        }`}
                      />
                    )}
                  </div>
                  {!collapsed && <span>{item.label}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      <Separator className="bg-zinc-800" />

      {/* Current Project */}
      {!collapsed && currentProject && (
        <div className="px-3 py-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">
            Current Project
          </p>
          <p className="mt-1 truncate text-xs font-medium text-zinc-300">
            {currentProjectName || currentProject}
          </p>
        </div>
      )}

      {/* Collapse Toggle */}
      {onToggleCollapse && (
        <div className="border-t border-zinc-800 p-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-full text-zinc-500 hover:text-zinc-300"
            onClick={onToggleCollapse}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
