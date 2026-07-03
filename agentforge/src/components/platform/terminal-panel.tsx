'use client'

import { useRef, useEffect, useState, useCallback } from 'react'
import { useAgentStore } from '../../../stores/agent-store'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Trash2, Terminal, Circle, Bot, Keyboard, Loader2 } from 'lucide-react'

// --- Color helpers for agent log lines ---
function getLineColor(line: string): string {
  const lower = line.toLowerCase()
  if (
    lower.includes('error') ||
    lower.includes('fail') ||
    lower.includes('fatal') ||
    lower.includes('exception')
  ) {
    return 'text-red-400'
  }
  if (
    lower.includes('success') ||
    lower.includes('complete') ||
    lower.includes('done') ||
    lower.includes('installed') ||
    lower.includes('connected')
  ) {
    return 'text-emerald-400'
  }
  if (
    lower.includes('warn') ||
    lower.includes('warning') ||
    lower.includes('deprecated')
  ) {
    return 'text-yellow-400'
  }
  if (
    lower.includes('info') ||
    lower.includes('note') ||
    lower.includes('starting')
  ) {
    return 'text-sky-400'
  }
  return 'text-zinc-400'
}

function getLinePrefix(line: string): string {
  const lower = line.toLowerCase()
  if (lower.includes('error') || lower.includes('fail') || lower.includes('fatal'))
    return '✖'
  if (lower.includes('success') || lower.includes('complete') || lower.includes('done'))
    return '✔'
  if (lower.includes('warn') || lower.includes('warning'))
    return '⚠'
  if (lower.includes('info') || lower.includes('note'))
    return 'ℹ'
  return '›'
}

// Issue 8 Fix: Detect if a terminal line is from the agent (vs manual)
function isAgentSourced(line: string): boolean {
  return line.includes('[AGENT]')
}

// --- Types for interactive terminal ---
interface TerminalEntry {
  id: string
  type: 'input' | 'stdout' | 'stderr' | 'system' | 'prompt'
  content: string
  timestamp: number
}

// --- Agent Mode Panel ---
function AgentModePanel() {
  const { terminalOutput, clearTerminal } = useAgentStore()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [terminalOutput])

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 font-mono text-xs">
        {terminalOutput.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Bot className="h-8 w-8 text-zinc-700" />
            <p className="text-zinc-600">Agent log messages will appear here</p>
            <p className="text-zinc-700 text-[10px]">
              Switch to Manual mode to run commands interactively
            </p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {terminalOutput.map((line, index) => {
              // Issue 8: Strip [AGENT] from display, it's used for source identification only
              const displayLine = line.replace('[AGENT] ', '')
              const isAgent = isAgentSourced(line)
              return (
                <div key={index} className={`flex gap-2 ${getLineColor(line)}`}>
                  <span className="shrink-0 opacity-50">
                    {isAgent ? '🤖' : getLinePrefix(line)}
                  </span>
                  <span className="whitespace-pre-wrap break-all">{displayLine}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// --- Manual Mode Panel ---
function ManualModePanel() {
  const { currentProject } = useAgentStore()
  const [entries, setEntries] = useState<TerminalEntry[]>([])
  const [inputValue, setInputValue] = useState('')
  const [commandHistory, setCommandHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [isExecuting, setIsExecuting] = useState(false)
  const [cwd, setCwd] = useState<string>('~')
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const addEntry = useCallback((type: TerminalEntry['type'], content: string) => {
    setEntries((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type,
        content,
        timestamp: Date.now(),
      },
    ])
  }, [])

  const handleClear = useCallback(() => {
    setEntries([])
  }, [])

  const executeCommand = useCallback(
    async (command: string) => {
      if (!command.trim()) return

      // Add the command to display
      addEntry('input', command)

      // Add to history
      setCommandHistory((prev) => {
        const newHistory = [...prev, command]
        // Keep last 100 commands
        if (newHistory.length > 100) newHistory.shift()
        return newHistory
      })
      setHistoryIndex(-1)

      setIsExecuting(true)

      try {
        const response = await fetch('/api/terminal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            command,
            projectId: currentProject || undefined,
            timeout: 30000,
          }),
        })

        const data = await response.json()

        if (data.cwd) {
          // Show just the last part of the cwd
          const parts = data.cwd.split('/')
          setCwd(parts.length > 2 ? `.../${parts.slice(-2).join('/')}` : data.cwd)
        }

        // Display stdout
        if (data.stdout) {
          const lines = data.stdout.split('\n')
          for (const line of lines) {
            if (line) addEntry('stdout', line)
          }
        }

        // Display stderr
        if (data.stderr) {
          const lines = data.stderr.split('\n')
          for (const line of lines) {
            if (line) addEntry('stderr', line)
          }
        }

        // Handle timed out commands
        if (data.timedOut) {
          addEntry('system', 'Command timed out after 30s')
        }

        // Show non-zero exit code
        if (data.exitCode && data.exitCode !== 0 && !data.stderr) {
          addEntry('system', `Process exited with code ${data.exitCode}`)
        }
      } catch (error) {
        addEntry('stderr', `Network error: ${(error as Error).message}`)
      } finally {
        setIsExecuting(false)
        // Re-focus input after command execution
        setTimeout(() => inputRef.current?.focus(), 50)
      }
    },
    [addEntry, currentProject]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        const command = inputValue
        setInputValue('')
        executeCommand(command)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (commandHistory.length === 0) return
        const newIndex =
          historyIndex === -1
            ? commandHistory.length - 1
            : Math.max(0, historyIndex - 1)
        setHistoryIndex(newIndex)
        setInputValue(commandHistory[newIndex])
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (historyIndex === -1) return
        const newIndex = historyIndex + 1
        if (newIndex >= commandHistory.length) {
          setHistoryIndex(-1)
          setInputValue('')
        } else {
          setHistoryIndex(newIndex)
          setInputValue(commandHistory[newIndex])
        }
      } else if (e.key === 'c' && e.ctrlKey) {
        // Ctrl+C - clear current input
        e.preventDefault()
        if (inputValue) {
          addEntry('system', '^C')
          setInputValue('')
        }
      } else if (e.key === 'l' && e.ctrlKey) {
        // Ctrl+L - clear terminal
        e.preventDefault()
        handleClear()
      }
    },
    [inputValue, commandHistory, historyIndex, executeCommand, addEntry, handleClear]
  )

  const getEntryColor = (type: TerminalEntry['type']): string => {
    switch (type) {
      case 'input':
        return 'text-emerald-400'
      case 'stdout':
        return 'text-zinc-200'
      case 'stderr':
        return 'text-red-400'
      case 'system':
        return 'text-yellow-400'
      case 'prompt':
        return 'text-sky-400'
      default:
        return 'text-zinc-400'
    }
  }

  const getEntryPrefix = (type: TerminalEntry['type']): string => {
    switch (type) {
      case 'input':
        return '$'
      case 'stdout':
        return ' '
      case 'stderr':
        return '✖'
      case 'system':
        return '⚠'
      case 'prompt':
        return '›'
      default:
        return '›'
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Terminal output area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-3 font-mono text-xs"
        onClick={() => inputRef.current?.focus()}
      >
        {entries.length === 0 && (
          <div className="mb-2 text-zinc-600">
            <div className="text-emerald-500">
              AgentForge Terminal v1.0
            </div>
            <div className="mt-1 text-zinc-600">
              Type commands below. Use ↑/↓ for history, Ctrl+C to cancel, Ctrl+L to clear.
            </div>
          </div>
        )}
        <div className="space-y-0.5">
          {entries.map((entry) => (
            <div key={entry.id} className={`flex gap-2 ${getEntryColor(entry.type)}`}>
              <span className="shrink-0 opacity-60 select-none">
                {getEntryPrefix(entry.type)}
              </span>
              <span className="whitespace-pre-wrap break-all">{entry.content}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Command input area */}
      <div className="border-t border-zinc-800 bg-zinc-950 px-3 py-2">
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="shrink-0 text-emerald-400 select-none">$</span>
          <span className="shrink-0 text-zinc-500 select-none">{cwd}</span>
          <div className="relative flex-1">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isExecuting}
              className="w-full bg-transparent text-zinc-200 outline-none placeholder:text-zinc-600 disabled:opacity-50"
              placeholder={isExecuting ? 'Executing...' : 'Type a command...'}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {isExecuting && (
            <Loader2 className="h-3 w-3 animate-spin text-emerald-400" />
          )}
        </div>
      </div>
    </div>
  )
}

// --- Main Terminal Panel ---
export function TerminalPanel() {
  const { terminalOutput, clearTerminal, isStreaming } = useAgentStore()
  const [activeTab, setActiveTab] = useState<string>('manual')
  const prevStreamingRef = useRef(false)

  // Issue 8 Fix: Auto-switch to agent tab when agent starts streaming.
  // All ref access happens INSIDE useEffect (never during render) to comply
  // with the react-hooks/refs rule. The ref tracks the previous streaming
  // state so we only switch tabs on the not-streaming → streaming edge,
  // not on every re-render while streaming remains true.
  useEffect(() => {
    if (isStreaming && !prevStreamingRef.current) {
      // Transition from not-streaming → streaming: auto-switch to agent tab
      prevStreamingRef.current = true
      setActiveTab('agent')
    }
    if (!isStreaming && prevStreamingRef.current) {
      // Transition from streaming → not-streaming
      prevStreamingRef.current = false
    }
  }, [isStreaming])

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="w-auto"
        >
          <TabsList className="h-7 bg-zinc-900 p-0.5">
            <TabsTrigger
              value="manual"
              className="h-6 gap-1 px-2 text-[11px] data-[state=active]:bg-zinc-700 data-[state=active]:text-zinc-100"
            >
              <Keyboard className="h-3 w-3" />
              Manual
            </TabsTrigger>
            <TabsTrigger
              value="agent"
              className="h-6 gap-1 px-2 text-[11px] data-[state=active]:bg-zinc-700 data-[state=active]:text-zinc-100"
            >
              <Bot className="h-3 w-3" />
              Agent
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          {activeTab === 'agent' && terminalOutput.length > 0 && (
            <div className="flex items-center gap-1">
              <Circle className="h-2 w-2 fill-emerald-400 text-emerald-400" />
              <span className="text-[10px] text-zinc-500">
                {terminalOutput.length} line{terminalOutput.length !== 1 ? 's' : ''}
              </span>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-zinc-500 hover:text-zinc-300"
            onClick={clearTerminal}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Terminal Content */}
      {activeTab === 'agent' ? <AgentModePanel /> : <ManualModePanel />}
    </div>
  )
}
