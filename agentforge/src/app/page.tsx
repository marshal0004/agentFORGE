'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Code2,
  Terminal,
  Eye,
  Settings,
  MessageSquare,
  Wrench,
  Plug,
  FolderOpen,
  Zap,
  Brain,
  ShieldCheck,
  Shield,
  GitBranch,
  LayoutTemplate,
} from 'lucide-react'
import { useAgentStore, selectWorkspaceOpen } from '../../stores/agent-store'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

import { AgentChat } from '@/components/platform/agent-chat'
import { FileExplorer } from '@/components/platform/file-explorer'
import { CodeEditor } from '@/components/platform/code-editor'
import { TerminalPanel } from '@/components/platform/terminal-panel'
import { PreviewPanel } from '@/components/platform/preview-panel'
import { SkillRegistry } from '@/components/platform/skill-registry'
import { MCPRegistry } from '@/components/platform/mcp-registry'
import { ProjectManager } from '@/components/platform/project-manager'
// v1.2: Wire in the previously-orphaned panels. Each has a backing API route
// (/api/context, /api/correction, /api/protection, /api/subchats, /api/templates).
import { ContextPanel } from '@/components/platform/context-panel'
import { CorrectionPanel } from '@/components/platform/correction-panel'
import { FileProtectionPanel } from '@/components/platform/file-protection-panel'
import { SubchatPanel } from '@/components/platform/subchat-panel'
import { TemplateSelector } from '@/components/platform/template-selector'
import { AddProviderPanel } from '@/components/platform/add-provider-panel'
import { HeroPanel } from '@/components/platform/hero-panel'

function SettingsView() {
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
          <Settings className="h-8 w-8 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">Settings</h2>
          <p className="text-sm text-muted-foreground">
            Configure your AgentForge environment, API keys, and providers.
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4 text-left">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm">Theme</span>
              <span className="text-xs text-muted-foreground">System</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Default Model</span>
              <span className="text-xs text-muted-foreground">Auto</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Streaming</span>
              <span className="text-xs text-muted-foreground">Enabled</span>
            </div>
          </div>
        </div>

        {/* Add Custom Provider Panel */}
        <AddProviderPanel />
      </div>
    </div>
  )
}

// ── Thin Icon Rail (like Z.ai sidebar) ──────────────────────────────────────

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
  { id: 'templates', label: 'Templates', icon: LayoutTemplate },
  { id: 'context', label: 'Context', icon: Brain },
  { id: 'correction', label: 'Correction', icon: ShieldCheck },
  { id: 'protection', label: 'Protection', icon: Shield },
  { id: 'subchats', label: 'Subchats', icon: GitBranch },
  { id: 'settings', label: 'Settings', icon: Settings },
]

function IconRail({
  activeSection,
  onNavigate,
}: {
  activeSection: string
  onNavigate: (section: string) => void
}) {
  const { agentStatus } = useAgentStore()

  return (
    <div className="flex h-full w-12 flex-col items-center border-r border-zinc-800/60 bg-zinc-950 py-3">
      {/* Logo */}
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 mb-4">
        <Zap className="h-4 w-4 text-emerald-400" />
      </div>

      <Separator className="w-6 bg-zinc-800 mb-3" />

      {/* Nav Icons */}
      <nav className="flex flex-col items-center gap-1 flex-1">
        {navItems.map((item) => {
          const isActive = activeSection === item.id
          const Icon = item.icon
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                isActive
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300'
              }`}
              title={item.label}
            >
              <Icon className="h-4 w-4" />
              {item.id === 'agent' && (
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-zinc-950 ${
                    statusDotColors[agentStatus]
                  }`}
                />
              )}
            </button>
          )
        })}
      </nav>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [activeSection, setActiveSection] = useState('agent')
  const [rightPanelTab, setRightPanelTab] = useState('code')
  // v1.2: SubchatPanel needs the active project to scope its sub-chat list.
  const { currentProject } = useAgentStore()

  // ── Derived: should the IDE workspace be visible right now? ────────────────
  // `selectWorkspaceOpen` returns true if the user has manually pinned it open,
  // OR if there are any concrete signals of active work (files, terminal output,
  // preview, or agent in a build phase). See stores/agent-store.ts for the full
  // truth table.
  const workspaceOpen = useAgentStore(selectWorkspaceOpen)

  // The slide-in animation is applied via the `key` prop below. When
  // `workspaceOpen` flips false→true, React mounts a fresh <div> for the
  // workspace (key="workspace") — CSS animations declared on that element
  // play exactly once on mount, then settle into their final state via
  // `animation-fill-mode: both`. No setState-in-effect, no ref-during-render,
  // no manual lifecycle tracking needed.

  const handleNavigate = useCallback((section: string) => {
    setActiveSection(section)
  }, [])

  // Listen for navigation events from project manager
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (typeof detail === 'string') {
        setActiveSection(detail)
      }
    }
    window.addEventListener('navigate', handler)
    return () => window.removeEventListener('navigate', handler)
  }, [])

  // Listen for tab switch events from the backend
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.tab) {
        setRightPanelTab(detail.tab)
      }
    }
    window.addEventListener('agentforge:switch-tab', handler)
    return () => window.removeEventListener('agentforge:switch-tab', handler)
  }, [])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      {/* Thin Icon Rail */}
      <IconRail activeSection={activeSection} onNavigate={handleNavigate} />

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        {activeSection === 'agent' && (
          <ResizablePanelGroup direction="horizontal" className="h-full">
            {/* Left: Chat Panel
                - 50% when workspace is closed (focus mode)
                - 40% when workspace is open (room for IDE) */}
            <ResizablePanel defaultSize={workspaceOpen ? 40 : 50} minSize={28}>
              <AgentChat />
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Right: Either HeroPanel (idle) or IDE Workspace (active) */}
            <ResizablePanel defaultSize={workspaceOpen ? 60 : 50} minSize={35}>
              {workspaceOpen ? (
                <div
                  key="workspace"
                  // The slide-in animation class plays exactly once when this
                  // div is freshly mounted (which happens when `workspaceOpen`
                  // flips false→true, since React swaps the hero div out for
                  // this workspace div). `animation-fill-mode: both` keeps the
                  // final state after the animation completes, so re-renders
                  // while the workspace stays open don't replay the animation.
                  className="agentforge-workspace-enter h-full"
                >
                  <ResizablePanelGroup direction="horizontal" className="h-full">
                    {/* File Tree (left side of right panel) */}
                    <ResizablePanel defaultSize={22} minSize={14} maxSize={35}>
                      <div className="flex h-full flex-col border-r border-zinc-800/40 bg-zinc-950">
                        <FileExplorer />
                      </div>
                    </ResizablePanel>

                    <ResizableHandle className="w-px" />

                    {/* Code Editor + Terminal (right side of right panel) */}
                    <ResizablePanel defaultSize={78} minSize={40}>
                      <div className="flex h-full flex-col">
                        {/* Top: Tab bar for Code / Terminal / Preview */}
                        <Tabs
                          value={rightPanelTab}
                          onValueChange={setRightPanelTab}
                          className="flex h-full flex-col"
                        >
                          <TabsList className="mx-0 mt-0 flex w-auto items-center gap-0 bg-zinc-900/80 border-b border-zinc-800/40 rounded-none h-9 px-1">
                            <TabsTrigger
                              value="code"
                              className="gap-1.5 text-xs rounded-md px-3 data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100"
                            >
                              <Code2 className="h-3.5 w-3.5" />
                              Code
                            </TabsTrigger>
                            <TabsTrigger
                              value="terminal"
                              className="gap-1.5 text-xs rounded-md px-3 data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100"
                            >
                              <Terminal className="h-3.5 w-3.5" />
                              Terminal
                            </TabsTrigger>
                            <TabsTrigger
                              value="preview"
                              className="gap-1.5 text-xs rounded-md px-3 data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              Preview
                            </TabsTrigger>
                          </TabsList>
                          <TabsContent
                            value="code"
                            className="flex-1 overflow-hidden mt-0"
                          >
                            <CodeEditor />
                          </TabsContent>
                          <TabsContent
                            value="terminal"
                            className="flex-1 overflow-hidden mt-0"
                          >
                            <TerminalPanel />
                          </TabsContent>
                          <TabsContent
                            value="preview"
                            className="flex-1 overflow-hidden mt-0"
                          >
                            <PreviewPanel />
                          </TabsContent>
                        </Tabs>
                      </div>
                    </ResizablePanel>
                  </ResizablePanelGroup>
                </div>
              ) : (
                <div key="hero" className="agentforge-hero-enter h-full">
                  <HeroPanel />
                </div>
              )}
            </ResizablePanel>
          </ResizablePanelGroup>
        )}

        {activeSection === 'skills' && <SkillRegistry />}
        {activeSection === 'mcp' && <MCPRegistry />}
        {activeSection === 'projects' && <ProjectManager />}
        {activeSection === 'templates' && <TemplateSelector />}
        {activeSection === 'context' && <ContextPanel />}
        {activeSection === 'correction' && <CorrectionPanel />}
        {activeSection === 'protection' && <FileProtectionPanel />}
        {activeSection === 'subchats' && (
          <SubchatPanel parentChatId={currentProject ?? 'main'} />
        )}
        {activeSection === 'settings' && <SettingsView />}
      </div>
    </div>
  )
}