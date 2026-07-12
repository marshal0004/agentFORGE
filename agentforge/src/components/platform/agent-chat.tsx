'use client'

import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { useAgentStore, parseFilesFromText, extractPreviewHtml, selectWorkspaceOpen, type ChatMessage } from '../../../stores/agent-store'
import { useSkillStore } from '../../../stores/skill-store'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { SSEParser } from '@/lib/sse-parser'
import type { SSEEventDataMap, AgentStatus } from '@/lib/sse-types'
import {
  Send,
  Bot,
  User,
  Loader2,
  Sparkles,
  FileCode2,
  FolderOpen,
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronRight,
  Wrench,
  Terminal,
  FilePen,
  Copy,
  Check,
  Eye,
  Zap,
  Brain,
  Code2,
  AlertCircle,
  Square,
  Download,
  X,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react'

// ── Status Config ──────────────────────────────────────────────────────────────

const statusConfig: Record<string, { label: string; color: string; dotColor: string; bgColor: string }> = {
  idle: { label: 'Ready', color: 'text-zinc-400', dotColor: 'bg-zinc-500', bgColor: 'bg-zinc-500/10' },
  thinking: { label: 'Thinking', color: 'text-amber-400', dotColor: 'bg-amber-400', bgColor: 'bg-amber-400/10' },
  coding: { label: 'Coding', color: 'text-emerald-400', dotColor: 'bg-emerald-400', bgColor: 'bg-emerald-400/10' },
  executing: { label: 'Executing', color: 'text-sky-400', dotColor: 'bg-sky-400', bgColor: 'bg-sky-400/10' },
  previewing: { label: 'Previewing', color: 'text-purple-400', dotColor: 'bg-purple-400', bgColor: 'bg-purple-400/10' },
  error: { label: 'Error', color: 'text-red-400', dotColor: 'bg-red-400', bgColor: 'bg-red-400/10' },
}

// ── Parsed Types ───────────────────────────────────────────────────────────────

interface ToolAction {
  name: string
  params: Record<string, unknown>
  result?: string
  success?: boolean
  timestamp: number
}

interface TodoItem {
  text: string
  done: boolean
  priority?: string
}

// ── Code Block Component ───────────────────────────────────────────────────────

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [code])

  return (
    <div className="group relative my-3 rounded-lg border border-zinc-700/50 overflow-hidden bg-[#1a1b26]">
      <div className="flex items-center justify-between border-b border-zinc-700/50 bg-zinc-800/80 px-3 py-1.5">
        <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">{language}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-zinc-300"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <SyntaxHighlighter
        language={language || 'text'}
        style={oneDark}
        customStyle={{
          margin: 0,
          padding: '12px 16px',
          background: 'transparent',
          fontSize: '12px',
          lineHeight: '1.6',
        }}
        showLineNumbers={code.split('\n').length > 3}
        lineNumberStyle={{ color: '#4a4a5a', fontSize: '10px', minWidth: '2.5em' }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}

// ── Inline Code Component ──────────────────────────────────────────────────────

function InlineCode({ children }: { children: string }) {
  return (
    <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] font-mono text-emerald-400 border border-zinc-700/50">
      {children}
    </code>
  )
}

// ── Tool Call Card ─────────────────────────────────────────────────────────────

function ToolCallCard({ action, index }: { action: ToolAction; index: number }) {
  const [expanded, setExpanded] = useState(false)

  const getToolIcon = (name: string) => {
    switch (name) {
      case 'think': return <Brain className="h-3.5 w-3.5 text-amber-400" />
      case 'write_file': return <FilePen className="h-3.5 w-3.5 text-emerald-400" />
      case 'edit_file': return <FileCode2 className="h-3.5 w-3.5 text-sky-400" />
      case 'read_file': return <Eye className="h-3.5 w-3.5 text-purple-400" />
      case 'execute_code': return <Terminal className="h-3.5 w-3.5 text-orange-400" />
      case 'web_search': return <Zap className="h-3.5 w-3.5 text-cyan-400" />
      default: return <Wrench className="h-3.5 w-3.5 text-zinc-400" />
    }
  }

  const getToolLabel = (name: string) => {
    switch (name) {
      case 'think': return 'Thinking'
      case 'write_file': return 'Write File'
      case 'edit_file': return 'Edit File'
      case 'read_file': return 'Read File'
      case 'execute_code': return 'Run Command'
      case 'web_search': return 'Web Search'
      default: return name
    }
  }

  const getDetailText = () => {
    if (action.name === 'write_file' || action.name === 'edit_file') {
      return String(action.params.path || '').split('/').pop() || ''
    }
    if (action.name === 'read_file') {
      return String(action.params.path || '').split('/').pop() || ''
    }
    if (action.name === 'execute_code') {
      const cmd = String(action.params.command || '')
      return cmd.length > 50 ? cmd.substring(0, 50) + '...' : cmd
    }
    if (action.name === 'web_search') {
      return String(action.params.query || '')
    }
    if (action.name === 'think') {
      const thought = String(action.params.thought || '')
      return thought.length > 80 ? thought.substring(0, 80) + '...' : thought
    }
    return ''
  }

  return (
    <div className="rounded-lg border border-zinc-700/40 bg-zinc-800/30 overflow-hidden transition-all hover:border-zinc-600/50">
      <button
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-zinc-800/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {action.success ? (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
        ) : action.success === false ? (
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
        ) : (
          <Loader2 className="h-3.5 w-3.5 shrink-0 text-zinc-500 animate-spin" />
        )}
        {getToolIcon(action.name)}
        <span className="text-[11px] font-medium text-zinc-300">{getToolLabel(action.name)}</span>
        {getDetailText() && (
          <span className="text-[10px] text-zinc-500 truncate flex-1">{getDetailText()}</span>
        )}
        <ChevronRight className={`h-3 w-3 shrink-0 text-zinc-600 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>
      {expanded && action.result && (
        <div className="border-t border-zinc-700/30 bg-zinc-900/50 px-3 py-2">
          <pre className="text-[10px] text-zinc-400 whitespace-pre-wrap break-all max-h-40 overflow-y-auto font-mono">
            {action.result.length > 500 ? action.result.substring(0, 500) + '...' : action.result}
          </pre>
        </div>
      )}
    </div>
  )
}

// ── Action Summary Bar ─────────────────────────────────────────────────────────

function ActionSummaryBar({ toolActions }: { toolActions: ToolAction[] }) {
  const [expanded, setExpanded] = useState(false)
  const filesWritten = toolActions.filter(a => a.name === 'write_file' || a.name === 'edit_file').length
  const filesExplored = toolActions.filter(a => a.name === 'read_file' || a.name === 'list_directory' || a.name === 'search_files').length
  const commandsRun = toolActions.filter(a => a.name === 'execute_code').length
  const searches = toolActions.filter(a => a.name === 'web_search').length
  if (filesWritten === 0 && filesExplored === 0 && commandsRun === 0 && searches === 0) return null
  const allDone = toolActions.every(a => a.success === true)
  return (
    <div className="my-2 space-y-1">
      <button onClick={() => setExpanded(!expanded)} className="flex w-full items-center gap-2 rounded-md border border-zinc-700/40 bg-zinc-800/30 px-3 py-1.5 text-left hover:bg-zinc-800/50 transition-colors">
        {expanded ? <ChevronDown className="h-3 w-3 shrink-0 text-zinc-500" /> : <ChevronRight className="h-3 w-3 shrink-0 text-zinc-500" />}
        <div className="flex flex-wrap items-center gap-1.5 flex-1">
          {filesWritten > 0 && (<div className="flex items-center gap-1 rounded bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-400"><FilePen className="h-2.5 w-2.5" /><span className="font-medium">{filesWritten} file{filesWritten !== 1 ? 's' : ''} written</span></div>)}
          {filesExplored > 0 && (<div className="flex items-center gap-1 rounded bg-sky-500/10 border border-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-400"><FolderOpen className="h-2.5 w-2.5" /><span className="font-medium">Explored {filesExplored}</span></div>)}
          {commandsRun > 0 && (<div className="flex items-center gap-1 rounded bg-orange-500/10 border border-orange-500/20 px-1.5 py-0.5 text-[10px] text-orange-400"><Terminal className="h-2.5 w-2.5" /><span className="font-medium">Ran {commandsRun} command{commandsRun !== 1 ? 's' : ''}</span></div>)}
          {searches > 0 && (<div className="flex items-center gap-1 rounded bg-cyan-500/10 border border-cyan-500/20 px-1.5 py-0.5 text-[10px] text-cyan-400"><Zap className="h-2.5 w-2.5" /><span className="font-medium">{searches} search{searches !== 1 ? 'es' : ''}</span></div>)}
        </div>
        {allDone && (<div className="flex items-center gap-1 text-[10px] text-zinc-500 shrink-0"><CheckCircle2 className="h-2.5 w-2.5 text-emerald-400" /><span>Done</span></div>)}
      </button>
      {expanded && (<div className="ml-4 space-y-1 border-l border-zinc-700/30 pl-3">{toolActions.map((action, i) => (<ToolCallCard key={i} action={action} index={i} />))}</div>)}
    </div>
  )
}

// ── Todos Panel ────────────────────────────────────────────────────────────────

function TodosPanel({ todos }: { todos: TodoItem[] }) {
  const [expanded, setExpanded] = useState(true)

  if (todos.length === 0) return null

  const doneCount = todos.filter(t => t.done).length

  return (
    <div className="rounded-lg border border-zinc-700/40 bg-zinc-800/30 overflow-hidden my-2">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 hover:bg-zinc-800/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="h-3 w-3 text-cyan-400" /> : <ChevronRight className="h-3 w-3 text-cyan-400" />}
        <span className="text-[11px] font-medium text-cyan-400">Plan</span>
        <div className="flex-1">
          <div className="h-1 rounded-full bg-zinc-700/50 overflow-hidden">
            <div
              className="h-full rounded-full bg-cyan-400/60 transition-all duration-500"
              style={{ width: `${todos.length > 0 ? (doneCount / todos.length) * 100 : 0}%` }}
            />
          </div>
        </div>
        <span className="text-[10px] text-zinc-500 tabular-nums">{doneCount}/{todos.length}</span>
      </button>
      {expanded && (
        <div className="border-t border-zinc-700/30 px-3 py-1.5 space-y-0.5">
          {todos.map((todo, i) => (
            <div key={i} className="flex items-center gap-2 py-0.5">
              {todo.done ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
              ) : (
                <Circle className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
              )}
              {todo.priority && (
                <span className="shrink-0 rounded bg-zinc-700/50 px-1 py-0.5 text-[9px] text-zinc-400 font-medium">
                  {todo.priority}
                </span>
              )}
              <span className={`text-[11px] leading-tight ${todo.done ? 'text-zinc-500 line-through' : 'text-zinc-400'}`}>
                {todo.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Thinking Section ───────────────────────────────────────────────────────────

function ThinkingSection({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)

  if (!content) return null

  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 overflow-hidden my-2">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 hover:bg-amber-500/10 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <Brain className="h-3.5 w-3.5 text-amber-400" />
        <span className="text-[11px] font-medium text-amber-400/80">Reasoning</span>
        <ChevronRight className={`h-3 w-3 text-amber-400/40 ml-auto transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>
      {expanded && (
        <div className="border-t border-amber-500/10 px-3 py-2">
          <div className="text-[11px] text-zinc-400 whitespace-pre-wrap leading-relaxed">
            {content}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Markdown Content Renderer ──────────────────────────────────────────────────

function MarkdownContent({ content }: { content: string }) {
  const components = useMemo(() => ({
    code({ className, children, ...props }: any) {
      const match = /language-(\w+)/.exec(className || '')
      const codeString = String(children).replace(/\n$/, '')

      if (match) {
        return <CodeBlock language={match[1]} code={codeString} />
      }

      return <InlineCode>{codeString}</InlineCode>
    },
    p({ children }: any) {
      return <p className="text-[13px] leading-relaxed text-zinc-300 mb-2 last:mb-0">{children}</p>
    },
    h1({ children }: any) {
      return <h1 className="text-lg font-bold text-zinc-100 mb-3 mt-4 first:mt-0">{children}</h1>
    },
    h2({ children }: any) {
      return <h2 className="text-base font-semibold text-zinc-100 mb-2 mt-3 first:mt-0">{children}</h2>
    },
    h3({ children }: any) {
      return <h3 className="text-sm font-semibold text-zinc-200 mb-1.5 mt-2 first:mt-0">{children}</h3>
    },
    ul({ children }: any) {
      return <ul className="text-[13px] text-zinc-300 space-y-1 mb-2 list-disc list-inside">{children}</ul>
    },
    ol({ children }: any) {
      return <ol className="text-[13px] text-zinc-300 space-y-1 mb-2 list-decimal list-inside">{children}</ol>
    },
    li({ children }: any) {
      return <li className="text-[13px] text-zinc-300 leading-relaxed">{children}</li>
    },
    blockquote({ children }: any) {
      return <blockquote className="border-l-2 border-zinc-600 pl-3 my-2 text-zinc-400 italic">{children}</blockquote>
    },
    a({ href, children }: any) {
      return <a href={href} className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2" target="_blank" rel="noopener noreferrer">{children}</a>
    },
    strong({ children }: any) {
      return <strong className="font-semibold text-zinc-100">{children}</strong>
    },
    em({ children }: any) {
      return <em className="text-zinc-400 italic">{children}</em>
    },
    hr() {
      return <hr className="border-zinc-700/50 my-3" />
    },
    table({ children }: any) {
      return <div className="overflow-x-auto my-2"><table className="w-full text-[12px]">{children}</table></div>
    },
    thead({ children }: any) {
      return <thead className="bg-zinc-800/50">{children}</thead>
    },
    th({ children }: any) {
      return <th className="px-2 py-1.5 text-left text-zinc-400 font-medium border border-zinc-700/30">{children}</th>
    },
    td({ children }: any) {
      return <td className="px-2 py-1.5 text-zinc-300 border border-zinc-700/30">{children}</td>
    },
  }), [])

  if (!content.trim()) return null

  return (
    <div className="prose-invert max-w-none">
      <ReactMarkdown components={components}>{content}</ReactMarkdown>
    </div>
  )
}

// ── Streaming Message Renderer ─────────────────────────────────────────────────

function StreamingContent({
  content,
  toolActions,
  todos,
}: {
  content: string
  toolActions: ToolAction[]
  todos: TodoItem[]
}) {
  // Extract thinking content
  // Z.ai-style: capture the thought content directly if it's in the text
  const thinkMatch = content.match(/\[TOOL_RESULT\]\s+think\s*\n([\s\S]*?)(?=\n\n\[TOOL_|\n\n\[ERROR\]|$)/)
    || content.match(/^(?!\[TOOL_|think\()(\S[\s\S]*?)(?=\n\n▾|\n\nExplored|\n\nWrote|\n\nRan|$)/m)
  const thinkingText = thinkMatch ? thinkMatch[1].trim() : ''

  // Strip tool call/result blocks and markers for the main text display
  // Z.ai-style: aggressively clean ALL raw tool syntax from chat
  const cleanContent = content
    .replace(/\[TOOL_CALL\]\s+\w+\(\{[\s\S]*?\}\)/g, '')
    .replace(/\[TOOL_RESULT\]\s+\w+\n[\s\S]*?(?=\n\n|\[TOOL_|$)/g, '')
    .replace(/\[THINKING\]/g, '')
    .replace(/\[CODING\]/g, '')
    .replace(/\[EXECUTING\]/g, '')
    .replace(/\[PREVIEWING\]/g, '')
    .replace(/\[ERROR\]/g, '')
    .replace(/__METADATA__[\s\S]*?__END_METADATA__/g, '')
    .replace(/\[TERMINAL\]\s+\w+\s+.+/g, '')
    // ── FIX: Strip raw think() calls that leak into chat ──
    .replace(/think\(\{"thought":\s*"?([\s\S]*?)"?\}\)<\/arg_value><\/tool_call>/g, '')
    .replace(/think\(\{[\s\S]*?\}\)<\/arg_value><\/tool_call>/g, '')
    .replace(/think\(\{"thought":\s*"([\s\S]*?)"\}\)/g, '')
    .replace(/think\(\{[\s\S]*?\}\)/g, '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
    .replace(/<arg_value>[\s\S]*?<\/arg_value>/g, '')
    .trim()

  // Separate code file blocks from the display content
  const displayContent = cleanContent
    .replace(/### FILE:.*?```[\w]*\n[\s\S]*?```/g, '')
    .trim()

  return (
    <div className="space-y-1">
      {/* Thinking section */}
      {thinkingText && <ThinkingSection content={thinkingText} />}

      {/* Action summary badges */}
      <ActionSummaryBar toolActions={toolActions} />

      {/* Main markdown content */}
      {displayContent && <MarkdownContent content={displayContent} />}

      {/* Todos panel */}
      <TodosPanel todos={todos} />

      {/* Z.ai-style: Tool calls are now INSIDE the ActionSummaryBar */}
    </div>
  )
}

// ── Message Bubble ─────────────────────────────────────────────────────────────

function MessageBubble({
  message,
  toolActions,
  todos,
}: {
  message: ChatMessage
  toolActions: ToolAction[]
  todos: TodoItem[]
}) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  if (isSystem) {
    return (
      <div className="flex justify-center py-1.5">
        <div className="rounded-full bg-zinc-800/60 border border-zinc-700/30 px-3.5 py-1 text-[10px] text-zinc-500">
          {message.content}
        </div>
      </div>
    )
  }

  if (isUser) {
    return (
      <div className="flex gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 border border-sky-500/20">
          <User className="h-3.5 w-3.5 text-sky-400" />
        </div>
        <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-sky-500/10 border border-sky-500/20 px-3.5 py-2.5">
          <p className="text-[13px] leading-relaxed text-zinc-200">{message.content}</p>
        </div>
      </div>
    )
  }

  // Assistant message
  return (
    <div className="flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20">
        <Bot className="h-3.5 w-3.5 text-emerald-400" />
      </div>
      <div className="max-w-[85%] min-w-0 flex-1">
        <StreamingContent
          content={message.content}
          toolActions={toolActions}
          todos={todos}
        />
      </div>
    </div>
  )
}

// ── Typing Indicator ───────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20">
        <Bot className="h-3.5 w-3.5 text-emerald-400" />
      </div>
      <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm bg-zinc-800/50 border border-zinc-700/30 px-4 py-3">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/60 animate-bounce [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/60 animate-bounce [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/60 animate-bounce [animation-delay:300ms]" />
      </div>
    </div>
  )
}

// ── Parse tool actions from accumulated content ────────────────────────────────

function parseToolActionsFromContent(content: string): ToolAction[] {
  const actions: ToolAction[] = []

  // Parse [TOOL_CALL] blocks
  const toolCallRegex = /\[TOOL_CALL\]\s+(\w+)\((\{[\s\S]*?\})\)/g
  let match: RegExpExecArray | null
  while ((match = toolCallRegex.exec(content)) !== null) {
    const name = match[1]
    let params: Record<string, unknown> = {}
    try {
      params = JSON.parse(match[2])
    } catch {
      params = { raw: match[2] }
    }
    actions.push({ name, params, timestamp: Date.now() })
  }

  // Parse [TOOL_RESULT] blocks and match them to tool calls
  const toolResultRegex = /\[TOOL_RESULT\]\s+(\w+)\n([\s\S]*?)(?=\n\n\[TOOL_|\n\n\[ERROR\]|$)/g
  let resultIdx = 0
  while ((match = toolResultRegex.exec(content)) !== null) {
    const name = match[1]
    const resultText = match[2].trim()
    const success = resultText.includes('"success": true') || resultText.includes('"success":true') || !resultText.includes('"success": false')

    if (resultIdx < actions.length) {
      actions[resultIdx].result = resultText.substring(0, 500)
      actions[resultIdx].success = success
    }
    resultIdx++
  }

  return actions
}

// ── Parse todos from content ───────────────────────────────────────────────────

function parseTodosFromContent(content: string): TodoItem[] {
  const todos: TodoItem[] = []
  const seen = new Set<string>()

  // Try to find think tool results with plan/todo items
  const thinkResultRegex = /\[TOOL_RESULT\]\s+think\s*\n([\s\S]*?)(?=\n\n\[TOOL_|\n\n\[ERROR\]|$)/g
  let thinkMatch: RegExpExecArray | null
  while ((thinkMatch = thinkResultRegex.exec(content)) !== null) {
    const thinkContent = thinkMatch[1]

    // Pattern 1: "Step N: [What] - Output: [path] - Test: [verify]"
    const stepRegex = /Step\s+\d+\s*:\s*(.+?)(?:\s*-\s*Output:.+?)?(?:\s*-\s*Test:.+?)?$/gm
    let stepMatch: RegExpExecArray | null
    while ((stepMatch = stepRegex.exec(thinkContent)) !== null) {
      const text = stepMatch[1].trim()
      if (text && text.length > 3 && text.length < 200 && !seen.has(text.toLowerCase())) {
        seen.add(text.toLowerCase())
        todos.push({ text, done: false })
      }
    }
    if (todos.length > 0) break

    // Pattern 2: Numbered list with arrow — "1. Create X → path/file"
    const arrowRegex = /\s*(\d+)[.)]\s+(.+?)\s*→\s*\S+/g
    while ((stepMatch = arrowRegex.exec(thinkContent)) !== null) {
      const text = stepMatch[2].trim()
      if (text && text.length > 3 && text.length < 200 && !seen.has(text.toLowerCase())) {
        seen.add(text.toLowerCase())
        todos.push({ text, done: false })
      }
    }
    if (todos.length > 0) break

    // Pattern 3: Simple numbered/bullet items — "1. X" or "- X"
    const itemRegex = /(?:^|\n)\s*(?:\d+\.|-)\s+(.+)/g
    let itemMatch: RegExpExecArray | null
    while ((itemMatch = itemRegex.exec(thinkContent)) !== null) {
      const text = itemMatch[1].trim()
      if (text.length > 5 && text.length < 200 && !seen.has(text.toLowerCase())) {
        seen.add(text.toLowerCase())
        todos.push({ text, done: false })
      }
    }
  }

  // Mark todos as done based on file write actions
  const writtenFiles = parseToolActionsFromContent(content)
    .filter(a => a.name === 'write_file' || a.name === 'edit_file')
    .map(a => String(a.params.path || '').split('/').pop() || '')

  for (const todo of todos) {
    const todoLower = todo.text.toLowerCase()
    for (const file of writtenFiles) {
      if (todoLower.includes(file.toLowerCase().replace(/\.\w+$/, ''))) {
        todo.done = true
        break
      }
    }
  }

  return todos.slice(0, 15) // Limit to 15 todos
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function AgentChat() {
  const {
    messages,
    isStreaming,
    agentStatus,
    currentProject,
    currentProjectName,
    workspacePinned,
    addMessage,
    updateLastMessage,
    setStreaming,
    setAgentStatus,
    setProject,
    addProjectFile,
    setProjectFiles,
    setActiveFile,
    addTerminalLine,
    setPreviewHtml,
    globalTodos,
    setWorkspacePinned,
    setGlobalTodos,
    clearGlobalTodos,
  } = useAgentStore()

  // Derived: is the IDE workspace currently visible? Drives the pin/unpin
  // button label and tooltip.
  const workspaceOpen = useAgentStore(selectWorkspaceOpen)

  const { skills } = useSkillStore()

  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // FIX: AbortController for stop/cancel button
  const abortControllerRef = useRef<AbortController | null>(null)

  // Track tool actions and todos per message
  const [messageToolActions, setMessageToolActions] = useState<Record<string, ToolAction[]>>({})
  const [messageTodos, setMessageTodos] = useState<Record<string, TodoItem[]>>({})

  const statusInfo = statusConfig[agentStatus] || statusConfig.idle

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isStreaming])

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
    }
  }, [input])

  // Listen for fill-input events from the HeroPanel example prompt buttons.
  // HeroPanel lives in page.tsx and doesn't have access to this component's
  // internal `input` state, so it dispatches a window event with the prompt
  // text and we populate the textarea here. We also focus the textarea so the
  // user can immediately press Enter to send.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.text && typeof detail.text === 'string') {
        setInput(detail.text)
        // Defer focus to next tick so the textarea has the new value
        requestAnimationFrame(() => {
          textareaRef.current?.focus()
          // Place cursor at end
          const len = detail.text.length
          textareaRef.current?.setSelectionRange(len, len)
        })
      }
    }
    window.addEventListener('agentforge:fill-input', handler)
    return () => window.removeEventListener('agentforge:fill-input', handler)
  }, [])

  // Create a real project via API before starting
  const handleNewProject = useCallback(async () => {
    const name = prompt('Enter project name:')
    if (!name) return
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: '', prompt: '' }),
      })
      if (res.ok) {
        const data = await res.json()
        setProject(data.project.id, data.project.name)
        // Z.ai-style: project creation is silent in terminal
      }
    } catch {
      setProject(name, name)
      // Z.ai-style: project creation is silent in terminal
    }
  }, [setProject, addTerminalLine])

  // Get active skills from the skill store
  const getActiveSkills = useCallback((): string[] => {
    return skills.filter(s => s.installed && s.enabled).map(s => s.name)
  }, [skills])

  // Real MCP tools available in the agent (these are the actual tools
  // registered in the backend, not fake DB entries)
  const REAL_MCP_TOOLS = ['write_file', 'read_file', 'web_search', 'fetch_page', 'execute_code', 'think']

  const handleSend = useCallback(async () => {
    if (!input.trim() || isStreaming) return

    // Issue 2 Fix: Clear global todos on NEW chat
    if (messages.length === 0) { clearGlobalTodos() }

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: Date.now(),
    }
    addMessage(userMessage)
    setStreaming(true)
    setAgentStatus('thinking')
    setInput('')

    // FIX: Create AbortController for the stop/cancel button
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    // Auto-create project if none exists
    // FIX: Treat the string "null", "undefined", or empty as no project.
    // Stale localStorage can persist these bogus values from earlier sessions,
    // causing projectId="null" to be sent to the backend (FK violations +
    // files landing in workspace/null/).
    let projectId = (currentProject
      && currentProject !== 'null'
      && currentProject !== 'undefined'
      && currentProject.trim() !== '')
      ? currentProject
      : null
    if (!projectId) {
      try {
        const projectName = input.trim().split(' ').slice(0, 4).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: projectName, description: `Auto-created for: ${input.trim()}`, prompt: input.trim() }),
        })
        if (res.ok) {
          const data = await res.json()
          projectId = data.project.id
          setProject(data.project.id, data.project.name)
        }
      } catch {
        // Continue without project
      }
    }

    const activeSkills = getActiveSkills()
    const activeMcpTools = REAL_MCP_TOOLS

    try {
      const allMessages = [...messages, userMessage]
      const response = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: allMessages.map((m) => ({ role: m.role, content: m.content })),
          projectId: projectId || undefined,
          skills: activeSkills,
          mcpTools: activeMcpTools,
        }),
        signal: abortController.signal,  // FIX: connect AbortController
      })

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('429 rate limit - AI service is temporarily busy')
        }
        throw new Error(`HTTP ${response.status}`)
      }

      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      }
      addMessage(assistantMessage)

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      const sseParser = new SSEParser()
      let accumulatedContent = ''
      let foundFiles = new Set<string>()
      let trackedFileCount = 0
      let activeTabFromBackend: string | null = null

      // ── SSE Event Handler ──────────────────────────────────────────────
      // Handles ALL events from both new SSE format and legacy format
      // (the SSEParser auto-detects and normalizes both)
      const handleSSEEvent = (event: { event: string; data: any; legacy?: boolean }) => {
        const { event: eventType, data } = event

        switch (eventType) {
          case 'status':
            setAgentStatus(data.status as AgentStatus)
            break

          case 'content':
            accumulatedContent += data.text
            updateLastMessage(data.text)
            break

          case 'reasoning':
            // Show reasoning in the terminal (collapsible in future)
            // Z.ai-style: reasoning shows in chat only, NOT in terminal
            break

          case 'plan_update':
            try {
              const planSteps = data.steps
              if (planSteps && planSteps.length > 0) {
                const planTodos = planSteps.map((step: any) => ({
                  text: step.text || `Step ${step.step}`,
                  done: step.done || false,
                  priority: step.step <= 2 ? 'high' : step.step <= 4 ? 'med' : 'low',
                }))
                setMessageTodos(prev => ({ ...prev, [assistantMessage.id]: planTodos }))
                setGlobalTodos(planTodos)
              }
            } catch (e) {
              console.warn('[Agent Chat] Failed to parse plan_update event:', e)
            }
            break

          case 'todo_update':
            try {
              const todos = data.todos
              if (todos && todos.length > 0) {
                // Only update if we don't have plan-based todos already
                // (plan-based todos are more structured and take priority)
                setMessageTodos(prev => {
                  const existing = prev[assistantMessage.id]
                  if (existing && existing.length > 0) {
                    // Merge: keep existing done-status, add new todos
                    const existingTexts = new Set(existing.map(t => t.text.toLowerCase()))
                    const merged = [...existing]
                    for (const t of todos as any[]) {
                      if (!existingTexts.has(t.text.toLowerCase())) {
                        merged.push({ text: t.text, done: t.done, priority: t.priority })
                      }
                    }
                    return { ...prev, [assistantMessage.id]: merged }
                  }
                  return { ...prev, [assistantMessage.id]: todos.map((t: any) => ({ text: t.text, done: t.done, priority: t.priority })) }
                })
                const currentGlobalTodos = useAgentStore.getState().globalTodos
                if (currentGlobalTodos.length > 0) {
                  const existingTexts = new Set(currentGlobalTodos.map(t => t.text.toLowerCase()))
                  const merged = [...currentGlobalTodos]
                  for (const t of todos as any[]) { if (!existingTexts.has(t.text.toLowerCase())) merged.push({ text: t.text, done: t.done, priority: t.priority, filePath: t.filePath }) }
                  setGlobalTodos(merged)
                } else { setGlobalTodos(todos.map((t: any) => ({ text: t.text, done: t.done, priority: t.priority, filePath: t.filePath }))) }
              }
            } catch (e) {
              console.warn('[Agent Chat] Failed to parse todo_update event:', e)
            }
            break

          case 'tool_call': {
            // Z.ai-style: Track tool calls for ActionSummaryBar rendering
            setMessageToolActions(prev => {
              const existing = prev[assistantMessage.id] || []
              const newAction = {
                name: data.name,
                params: data.params || {},
                timestamp: Date.now(),
                success: undefined as boolean | undefined,
              }
              return { ...prev, [assistantMessage.id]: [...existing, newAction] }
            })

            // Auto-switch to terminal tab only for execute_code
            if (data.name === 'execute_code' && typeof window !== 'undefined') {
              window.dispatchEvent(
                new CustomEvent('agentforge:switch-tab', { detail: { tab: 'terminal' } }),
              )
            }
            break
          }
            break

          case 'tool_result': {
            const resultStr = typeof data.result === 'string' ? data.result : JSON.stringify(data.result, null, 2).substring(0, 500)

            // Z.ai-style: Update the matching tool action with success/failure status
            setMessageToolActions(prev => {
              const existing = prev[assistantMessage.id] || []
              const updated = [...existing]
              for (let i = updated.length - 1; i >= 0; i--) {
                if (updated[i].name === data.name && updated[i].success === undefined) {
                  updated[i] = { ...updated[i], success: data.success, result: resultStr }
                  break
                }
              }
              return { ...prev, [assistantMessage.id]: updated }
            })
            break
          }

          case 'file_written':
            try {
              const filePath = String(data.path || '')
              const fileContent = String(data.content || '')
              const language = String(data.language || 'text')

              if (filePath && fileContent) {
                foundFiles.add(filePath)
                trackedFileCount++
                addProjectFile({ path: filePath, content: fileContent, language })

                if (filePath === '__preview.html') {
                  setPreviewHtml(fileContent)
                  // Preview file written → flip to Preview tab so user sees
                  // the rendered output immediately.
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(
                      new CustomEvent('agentforge:switch-tab', { detail: { tab: 'preview' } }),
                    )
                  }
                } else {
                  // Real source file written → make sure we're on the Code
                  // tab and select this file so the user sees live code
                  // creation as it streams in.
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(
                      new CustomEvent('agentforge:switch-tab', { detail: { tab: 'code' } }),
                    )
                  }
                  setActiveFile(filePath)
                }

                const currentState = useAgentStore.getState()
                if (!currentState.activeFile && filePath !== '__preview.html') {
                  setActiveFile(filePath)
                }

                // ── REAL-TIME TODO UPDATE: Mark matching todos as done ──
                // When a file is written, check existing todos and mark matching ones as done.
                const fileName = filePath.split('/').pop() || ''
                const fileNameNoExt = fileName.replace(/\.\w+$/, '')
                setMessageTodos(prev => {
                  const existing = prev[assistantMessage.id]
                  if (!existing || existing.length === 0) return prev
                  const updated = existing.map(todo => {
                    if (todo.done) return todo // Already done
                    const todoLower = todo.text.toLowerCase()
                    // Check if this file matches the todo text
                    if (
                      todoLower.includes(fileNameNoExt.toLowerCase()) ||
                      todoLower.includes(fileName.toLowerCase()) ||
                      todoLower.includes(filePath.toLowerCase())
                    ) {
                      return { ...todo, done: true }
                    }
                    return todo
                  })
                  // Only update if something changed
                  const anyChanged = updated.some((t, i) => t.done !== existing[i].done)
                  return anyChanged ? { ...prev, [assistantMessage.id]: updated } : prev
                })
              }
            } catch (e) {
              console.warn('[Agent Chat] Failed to process file_written event:', e)
            }
            break

          case 'switch_tab':
            activeTabFromBackend = data.tab
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('agentforge:switch-tab', { detail: { tab: data.tab } }))
            }
            break

          case 'terminal':
            // Z.ai-style: terminal is ONLY for command output
            if (data.message && data.message.startsWith('$')) {
              addTerminalLine(data.message)
            }
            break

          case 'validation_error':
            // Z.ai-style: validation errors show in CHAT
            break

          case 'metadata':
            // Process metadata (file count, session info)
            break

          case 'error':
            // Z.ai-style: errors show in CHAT
            break

          case 'done':
            // Stream complete
            break
        }
      }

      while (reader) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })

        // Parse chunk into structured SSE events
        const events = sseParser.parse(chunk)

        // Handle each event
        for (const event of events) {
          handleSSEEvent(event)
        }

        // For content events, also update tool actions
        if (accumulatedContent) {
          const toolActions = parseToolActionsFromContent(accumulatedContent)
          const todos = parseTodosFromContent(accumulatedContent)
          setMessageToolActions(prev => ({ ...prev, [assistantMessage.id]: toolActions }))
          // Only overwrite todos from content if we don't have plan-based todos
          if (!messageTodos[assistantMessage.id] || messageTodos[assistantMessage.id].length === 0) {
            setMessageTodos(prev => ({ ...prev, [assistantMessage.id]: todos }))
          }
        }
      }

      // Final parse: get any files that weren't caught by SSE events
      const allParsedFiles = parseFilesFromText(accumulatedContent)
      const currentFiles = useAgentStore.getState().projectFiles
      const newFilesToAdd: typeof currentFiles = []

      // Check if the response was a 429 error
      const is429Error = accumulatedContent.includes('429') || accumulatedContent.includes('Too many requests')
      if (is429Error && allParsedFiles.length === 0) {
        addMessage({
          id: (Date.now() + 2).toString(),
          role: 'system',
          content: 'AI service is temporarily busy. Please wait a moment and try again.',
          timestamp: Date.now(),
        })
        setAgentStatus('error')
        setStreaming(false)
        return
      }

      for (const parsedFile of allParsedFiles) {
        const exists = currentFiles.find(f => f.path === parsedFile.path)
        if (!exists) {
          newFilesToAdd.push(parsedFile)
          if (parsedFile.path === '__preview.html') {
            setPreviewHtml(parsedFile.content)
          }
        }
      }

      if (newFilesToAdd.length > 0) {
        setProjectFiles([...currentFiles, ...newFilesToAdd])
      }

      // Also parse files from write_file tool results (### FILE: blocks may not be present)
      const writeActions = parseToolActionsFromContent(accumulatedContent)
        .filter(a => a.name === 'write_file' && a.params.path && a.params.content)
      for (const action of writeActions) {
        const filePath = String(action.params.path)
        const fileContent = String(action.params.content)
        const exists = useAgentStore.getState().projectFiles.find(f => f.path === filePath)
        if (!exists && fileContent.length > 0) {
          const ext = filePath.split('.').pop()?.toLowerCase() || ''
          const langMap: Record<string, string> = {
            ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
            css: 'css', html: 'html', json: 'json', prisma: 'prisma',
            sql: 'sql', py: 'python', go: 'go', rs: 'rust',
          }
          addProjectFile({ path: filePath, content: fileContent, language: langMap[ext] || 'text' })
          if (filePath === '__preview.html') {
            setPreviewHtml(fileContent)
          }
          if (!useAgentStore.getState().activeFile) {
            setActiveFile(filePath)
          }
        }
      }

      // Try to extract preview HTML if not found yet
      const previewHtml = extractPreviewHtml(accumulatedContent)
      if (previewHtml) {
        setPreviewHtml(previewHtml)
      } else if (allParsedFiles.length > 0 && !allParsedFiles.find(f => f.path === '__preview.html')) {
        const pageFile = allParsedFiles.find(f =>
          f.path.includes('page.tsx') || f.path.includes('Page.tsx') || f.path.includes('App.tsx')
        )
        if (pageFile) {
          const htmlPreview = generateFallbackPreview(pageFile.content, input)
          addProjectFile({ path: '__preview.html', content: htmlPreview, language: 'html' })
          setPreviewHtml(htmlPreview)
        }
      }

      // Set active file to first non-preview file if none selected
      const state = useAgentStore.getState()
      if (!state.activeFile && state.projectFiles.length > 0) {
        const firstReal = state.projectFiles.find(f => f.path !== '__preview.html')
        if (firstReal) setActiveFile(firstReal.path)
      }

      // Issue 6 Fix: Use tracked file count from __FILE_WRITTEN__ events,
      // not from parseCodeFiles which only finds ### FILE: markdown blocks.
      const finalFileCount = trackedFileCount > 0
        ? trackedFileCount
        : allParsedFiles.filter(f => f.path !== '__preview.html').length
      // Z.ai-style: build complete shows in chat only
      setAgentStatus('idle')
    } catch (error: unknown) {
      const err = error as Error

      // FIX: Handle abort (user cancelled) gracefully
      if (err.name === 'AbortError') {
        addMessage({
          id: Date.now().toString(),
          role: 'system',
          content: 'Generation stopped by user.',
          timestamp: Date.now(),
        })
        // Z.ai-style: abort shows in CHAT
        setAgentStatus('idle')
      } else {
        setAgentStatus('error')
        const isRateLimit = err.message?.includes('429') || err.message?.includes('rate')
        const msg = isRateLimit
          ? 'AI service is temporarily busy. Please wait a moment and try again.'
          : `Error: ${err.message || 'Unknown error'}. Please try again.`
        addMessage({
          id: Date.now().toString(),
          role: 'system',
          content: msg,
          timestamp: Date.now(),
        })
        // Z.ai-style: errors show in CHAT
      }
    } finally {
      setStreaming(false)
      abortControllerRef.current = null  // FIX: Clean up abort controller
    }
  }, [input, isStreaming, messages, currentProject, getActiveSkills, addMessage, updateLastMessage, setStreaming, setAgentStatus, setProject, addProjectFile, setProjectFiles, setActiveFile, addTerminalLine, setPreviewHtml])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  const activeSkillsCount = skills.filter(s => s.installed && s.enabled).length
  const activeMcpCount = REAL_MCP_TOOLS.length

  // FIX: Stop/cancel handler
  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }, [])

  // FIX: Download handler for generated project files
  const handleDownload = useCallback(() => {
    const { projectFiles } = useAgentStore.getState()
    if (projectFiles.length === 0) return

    // Create a simple JSON export of all project files
    const exportData = projectFiles
      .filter(f => f.path !== '__preview.html')
      .map(f => ({ path: f.path, content: f.content }))

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `agentforge-project-${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [])

  return (
    <div className="flex h-full flex-col bg-[#0f0f11]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800/60 px-4 py-2 bg-[#0f0f11]">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-xs font-semibold text-zinc-200">
              {currentProjectName || 'Agent Chat'}
            </h2>
            <p className="text-[10px] text-zinc-500">
              {activeSkillsCount} skills &middot; {activeMcpCount} MCP tools
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 rounded-md border border-zinc-800/50 ${statusInfo.bgColor} px-2.5 py-1`}>
            <span className={`h-1.5 w-1.5 rounded-full ${statusInfo.dotColor} ${agentStatus !== 'idle' ? 'animate-pulse' : ''}`} />
            {(agentStatus !== 'idle' && agentStatus !== 'error') && (
              <Loader2 className="h-3 w-3 animate-spin text-zinc-500" />
            )}
            <span className={`text-[10px] font-medium ${statusInfo.color}`}>
              {statusInfo.label}
            </span>
          </div>

          {/* Pin / Unpin Workspace button
              - When workspace is OPEN: clicking unpins (forces closed) → icon = PanelRightClose
              - When workspace is CLOSED: clicking pins (forces open) → icon = PanelRightOpen
              - If user has manually pinned, a second click returns to auto mode (null)
                and we show the icon matching the *auto* state so it's not jarring.
              Visual states:
                - solid emerald border/bg = manually pinned (override active)
                - dim outline = auto mode */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              // Toggle logic:
              // 1. If user has an explicit pin AND it matches current visibility → clear to auto
              // 2. Otherwise → set pin to !workspaceOpen (force the opposite of current)
              if (workspacePinned !== null && workspacePinned === workspaceOpen) {
                setWorkspacePinned(null)
              } else {
                setWorkspacePinned(!workspaceOpen)
              }
            }}
            title={
              workspacePinned === null
                ? `Workspace: auto (currently ${workspaceOpen ? 'open' : 'closed'}) — click to ${workspaceOpen ? 'force close' : 'force open'}`
                : workspacePinned
                  ? 'Workspace: pinned open — click to return to auto'
                  : 'Workspace: pinned closed — click to return to auto'
            }
            className={`h-7 w-7 p-0 text-[11px] ${
              workspacePinned !== null
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300'
                : 'border-zinc-700/50 bg-zinc-900/50 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {workspaceOpen ? (
              <PanelRightClose className="h-3.5 w-3.5" />
            ) : (
              <PanelRightOpen className="h-3.5 w-3.5" />
            )}
          </Button>

          {/* FIX: Stop button when streaming */}
          {isStreaming && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleStop}
              className="h-7 gap-1 border-red-700/50 bg-red-900/30 text-red-400 hover:text-red-300 hover:bg-red-900/50 text-[11px]"
            >
              <Square className="h-3 w-3" />
              Stop
            </Button>
          )}
          {/* FIX: Download button when files exist */}
          {useAgentStore.getState().projectFiles.length > 0 && !isStreaming && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleDownload}
              className="h-7 gap-1 border-zinc-700/50 bg-zinc-900/50 text-zinc-400 hover:text-zinc-200 text-[11px]"
            >
              <Download className="h-3 w-3" />
              Download
            </Button>
          )}
          {!currentProject && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleNewProject}
              className="h-7 gap-1 border-zinc-700/50 bg-zinc-900/50 text-zinc-400 hover:text-zinc-200 text-[11px]"
            >
              New Project
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 scroll-smooth">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
              <Code2 className="h-7 w-7 text-emerald-400" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-base font-semibold text-zinc-200">
                {currentProjectName || 'Start a conversation'}
              </h3>
              <p className="max-w-xs text-[12px] text-zinc-500 leading-relaxed">
                Describe what you want to build. The IDE workspace on the right
                will auto-open the moment the agent starts writing code or
                running commands.
              </p>
            </div>
            <p className="text-[10px] text-zinc-600">
              💡 Try a starter prompt from the panel on the right →
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Z.ai-style: Todos render inline, NOT sticky/blocking */}
            {globalTodos && globalTodos.length > 0 && (
              <TodosPanel todos={globalTodos} />
            )}
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                toolActions={messageToolActions[message.id] || []}
                todos={messageTodos[message.id] || []}
              />
            ))}
            {isStreaming && messages[messages.length - 1]?.content === '' && (
              <TypingIndicator />
            )}
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="border-t border-zinc-800/60 p-3 bg-[#0f0f11]">
        <div className="relative flex items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe the app you want to build..."
            disabled={isStreaming}
            className="min-h-[40px] max-h-[160px] resize-none rounded-xl border-zinc-700/50 bg-zinc-900/50 text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-emerald-500/30 focus-visible:border-emerald-500/30 pr-4 text-[13px]"
            rows={1}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            size="icon"
            className="h-10 w-10 shrink-0 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40"
          >
            {isStreaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-zinc-600">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  )
}

// ── Fallback Preview Generator ─────────────────────────────────────────────────

function generateFallbackPreview(componentCode: string, prompt: string): string {
  const appName = prompt.split(' ').slice(0, 5).map(w =>
    w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ).join(' ')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${appName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #fafafa; min-height: 100vh; }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
    .header { display: flex; justify-content: space-between; align-items: center; padding: 1rem 0; border-bottom: 1px solid #262626; margin-bottom: 2rem; }
    .header h1 { font-size: 1.5rem; font-weight: 700; }
    .header .badge { background: #10b981; color: white; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; }
    .card { background: #171717; border: 1px solid #262626; border-radius: 0.75rem; padding: 1.5rem; margin-bottom: 1rem; }
    .card h3 { font-size: 1rem; font-weight: 600; margin-bottom: 0.5rem; }
    .card p { color: #a3a3a3; font-size: 0.875rem; line-height: 1.5; }
    .btn { background: #10b981; color: white; border: none; padding: 0.5rem 1rem; border-radius: 0.5rem; cursor: pointer; font-size: 0.875rem; font-weight: 500; }
    .btn:hover { background: #059669; }
    .btn-outline { background: transparent; border: 1px solid #262626; color: #a3a3a3; }
    .btn-outline:hover { background: #262626; color: #fafafa; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; }
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 2rem; }
    .stat { background: #171717; border: 1px solid #262626; border-radius: 0.75rem; padding: 1.25rem; text-align: center; }
    .stat .value { font-size: 1.75rem; font-weight: 700; color: #10b981; }
    .stat .label { font-size: 0.75rem; color: #737373; margin-top: 0.25rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${appName}</h1>
      <button class="btn">+ New</button>
    </div>
    <div class="stats">
      <div class="stat"><div class="value">12</div><div class="label">Total</div></div>
      <div class="stat"><div class="value">5</div><div class="label">Active</div></div>
      <div class="stat"><div class="value">7</div><div class="label">Done</div></div>
    </div>
    <div class="grid">
      <div class="card"><h3>Item 1</h3><p>Preview of your generated app.</p></div>
      <div class="card"><h3>Item 2</h3><p>Full code is in the editor.</p></div>
      <div class="card"><h3>Item 3</h3><p>Click files to view source.</p></div>
    </div>
  </div>
</body>
</html>`
}
