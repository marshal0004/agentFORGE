'use client'

import { useCallback } from 'react'
import {
  Code2,
  Sparkles,
  Terminal,
  Eye,
  ArrowRight,
  Zap,
  Shield,
  GitBranch,
} from 'lucide-react'

/**
 * HeroPanel — Idle-state right-side panel.
 *
 * Shown when the IDE workspace is NOT active (no files written, no commands
 * run, no preview generated, agent not in a build phase). Renders a branded
 * hero with example prompts that, when clicked, fill the chat input via a
 * window event (`agentforge:fill-input`). The AgentChat component listens
 * for that event and populates its textarea.
 *
 * When the agent starts building, page.tsx swaps this panel out for the
 * ResizablePanelGroup that hosts FileExplorer / CodeEditor / TerminalPanel /
 * PreviewPanel — see `selectWorkspaceOpen` in stores/agent-store.ts.
 */

const EXAMPLE_PROMPTS = [
  {
    icon: '🎨',
    title: 'Task manager app',
    text: 'Build a task manager app with CRUD operations',
    hint: 'React + localStorage · 4-6 files',
  },
  {
    icon: '📊',
    title: 'Analytics dashboard',
    text: 'Create a dashboard with charts and analytics',
    hint: 'Charts, KPIs, dark mode · 5-7 files',
  },
  {
    icon: '📝',
    title: 'Blog with comments',
    text: 'Make a blog with comments and user profiles',
    hint: 'Posts, comments, auth mock · 6-8 files',
  },
]

const CAPABILITIES = [
  { icon: Code2, label: 'Live code editor', color: 'text-emerald-400' },
  { icon: Terminal, label: 'Real terminal', color: 'text-sky-400' },
  { icon: Eye, label: 'Instant preview', color: 'text-purple-400' },
  { icon: GitBranch, label: 'File explorer', color: 'text-amber-400' },
]

export function HeroPanel() {
  const handleSelectPrompt = useCallback((text: string) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('agentforge:fill-input', { detail: { text } }),
      )
    }
  }, [])

  return (
    <div className="agentforge-hero-enter flex h-full flex-col bg-gradient-to-br from-[#0c0c0f] via-[#0f0f11] to-[#0a0a0c]">
      {/* Top-left brand */}
      <div className="flex items-center gap-2.5 border-b border-zinc-800/40 px-5 py-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
        </div>
        <div className="flex flex-col">
          <span className="text-[11px] font-semibold text-zinc-200">
            Workspace
          </span>
          <span className="text-[10px] text-zinc-500">
            Idle · waiting for a build
          </span>
        </div>
      </div>

      {/* Hero content — centered */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-8">
        {/* Big animated logo */}
        <div className="relative mb-6">
          <div className="absolute inset-0 animate-pulse rounded-2xl bg-emerald-500/10 blur-xl" />
          <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
            <Zap className="h-10 w-10 text-emerald-400" />
          </div>
        </div>

        <h2 className="mb-2 text-center text-2xl font-semibold text-zinc-100">
          Build anything.{' '}
          <span className="bg-gradient-to-r from-emerald-400 to-sky-400 bg-clip-text text-transparent">
            Right in your browser.
          </span>
        </h2>
        <p className="mb-8 max-w-md text-center text-[13px] leading-relaxed text-zinc-500">
          Describe the app you want and AgentForge will spin up a live IDE —
          file explorer, code editor, terminal, and instant preview — the moment
          it starts writing code.
        </p>

        {/* Capability chips */}
        <div className="mb-8 flex flex-wrap items-center justify-center gap-2">
          {CAPABILITIES.map(({ icon: Icon, label, color }) => (
            <div
              key={label}
              className="flex items-center gap-1.5 rounded-full border border-zinc-800/60 bg-zinc-900/40 px-3 py-1.5"
            >
              <Icon className={`h-3 w-3 ${color}`} />
              <span className="text-[11px] font-medium text-zinc-400">
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* Example prompts */}
        <div className="grid w-full max-w-xl gap-2">
          <div className="mb-1 flex items-center gap-2">
            <div className="h-px flex-1 bg-zinc-800/60" />
            <span className="text-[10px] uppercase tracking-wider text-zinc-600">
              Try a starter
            </span>
            <div className="h-px flex-1 bg-zinc-800/60" />
          </div>
          {EXAMPLE_PROMPTS.map((p) => (
            <button
              key={p.text}
              onClick={() => handleSelectPrompt(p.text)}
              className="group flex items-center gap-3 rounded-xl border border-zinc-800/50 bg-zinc-900/30 px-4 py-3 text-left transition-all hover:border-emerald-500/30 hover:bg-zinc-900/60"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-800/60 text-base">
                {p.icon}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-semibold text-zinc-200">
                    {p.title}
                  </span>
                </div>
                <p className="truncate text-[10px] text-zinc-500">{p.hint}</p>
              </div>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-zinc-600 transition-all group-hover:translate-x-0.5 group-hover:text-emerald-400" />
            </button>
          ))}
        </div>

        {/* Footer reassurance */}
        <div className="mt-8 flex items-center gap-1.5 text-[10px] text-zinc-600">
          <Shield className="h-3 w-3" />
          <span>
            Workspace auto-opens only when the agent writes code or runs a
            command.
          </span>
        </div>
      </div>
    </div>
  )
}