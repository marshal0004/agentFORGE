'use client'

import { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { useAgentStore } from '../../../stores/agent-store'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  X,
  FileCode2,
  Code2,
  Copy,
  Check,
  Save,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'

function getFileName(path: string): string {
  return path.split('/').pop() || path
}

// Simple keyword-based syntax highlighting
function highlightCode(code: string, language: string): string {
  let escaped = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Comments
  escaped = escaped.replace(
    /(\/\/.*$)/gm,
    '<span style="color:#6a737d">$1</span>'
  )
  escaped = escaped.replace(
    /(\/\*[\s\S]*?\*\/)/g,
    '<span style="color:#6a737d">$1</span>'
  )
  escaped = escaped.replace(
    /(#.*$)/gm,
    '<span style="color:#6a737d">$1</span>'
  )

  // Strings
  escaped = escaped.replace(
    /(&quot;.*?&quot;|&#x27;.*?&#x27;|".*?"|'.*?')/g,
    '<span style="color:#a5d6ff">$1</span>'
  )

  // Keywords
  const keywords = [
    'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for',
    'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'this',
    'class', 'extends', 'import', 'export', 'default', 'from', 'async',
    'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof',
    'interface', 'type', 'enum', 'namespace', 'module', 'declare',
    'public', 'private', 'protected', 'readonly', 'abstract', 'static',
    'true', 'false', 'null', 'undefined', 'void', 'never',
  ]
  const kwRegex = new RegExp(`\\b(${keywords.join('|')})\\b`, 'g')
  escaped = escaped.replace(
    kwRegex,
    '<span style="color:#ff7b72">$1</span>'
  )

  // Numbers
  escaped = escaped.replace(
    /\b(\d+\.?\d*)\b/g,
    '<span style="color:#79c0ff">$1</span>'
  )

  // JSX/HTML tags
  escaped = escaped.replace(
    /(&lt;\/?)([\w.]+)/g,
    '$1<span style="color:#7ee787">$2</span>'
  )

  return escaped
}

export function CodeEditor() {
  const {
    projectFiles,
    activeFile,
    setActiveFile,
    currentProject,
    updateProjectFile,
    setPreviewHtml,
    addTerminalLine,
  } = useAgentStore()

  const [copiedPath, setCopiedPath] = useState<string | null>(null)
  const [editContent, setEditContent] = useState<string>('')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [cursorLine, setCursorLine] = useState(1)
  const [cursorCol, setCursorCol] = useState(1)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lineNumbersRef = useRef<HTMLDivElement>(null)
  const codeDisplayRef = useRef<HTMLPreElement>(null)

  // Track which files have unsaved changes by path
  const [unsavedFiles, setUnsavedFiles] = useState<Set<string>>(new Set())

  // Filter out __preview.html from tabs (it's shown in preview panel)
  const displayFiles = useMemo(
    () => projectFiles.filter(f => f.path !== '__preview.html'),
    [projectFiles]
  )

  const currentFile = useMemo(
    () => projectFiles.find((f) => f.path === activeFile),
    [projectFiles, activeFile]
  )

  // Track previous activeFile to reset editor state when user switches files.
  // Using the "adjust state during render" pattern instead of useEffect
  // to avoid cascading renders (react-hooks/set-state-in-effect rule).
  const [prevActiveFile, setPrevActiveFile] = useState(activeFile)
  if (activeFile !== prevActiveFile) {
    setPrevActiveFile(activeFile)
    if (currentFile) {
      setEditContent(currentFile.content)
      setHasUnsavedChanges(false)
      setCursorLine(1)
      setCursorCol(1)
    }
  }

  // When the store content updates externally (e.g., agent generates new content),
  // sync the edit content if the user hasn't made unsaved changes.
  // Same "adjust state during render" pattern to avoid setState in useEffect.
  const [prevStoreContent, setPrevStoreContent] = useState(currentFile?.content)
  if (currentFile && !hasUnsavedChanges && currentFile.content !== prevStoreContent) {
    setPrevStoreContent(currentFile.content)
    setEditContent(currentFile.content)
  }
  // Keep prevStoreContent in sync when content changes for any reason
  if (currentFile?.content !== prevStoreContent && hasUnsavedChanges) {
    setPrevStoreContent(currentFile.content)
  }

  const handleCopy = useCallback(async (content: string, path: string) => {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedPath(path)
      setTimeout(() => setCopiedPath(null), 2000)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = content
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopiedPath(path)
      setTimeout(() => setCopiedPath(null), 2000)
    }
  }, [])

  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value
    setEditContent(newContent)
    if (activeFile) {
      setHasUnsavedChanges(newContent !== (currentFile?.content ?? ''))
      if (newContent !== (currentFile?.content ?? '')) {
        setUnsavedFiles(prev => new Set(prev).add(activeFile))
      } else {
        setUnsavedFiles(prev => {
          const next = new Set(prev)
          next.delete(activeFile)
          return next
        })
      }
    }
  }, [activeFile, currentFile])

  const handleSave = useCallback(async () => {
    if (!activeFile || !currentFile || !hasUnsavedChanges) return

    setIsSaving(true)
    try {
      // Update local store
      updateProjectFile(activeFile, editContent)

      // If __preview.html, update preview
      if (activeFile === '__preview.html') {
        setPreviewHtml(editContent)
      }

      // Save to API if we have a project
      if (currentProject) {
        try {
          const res = await fetch('/api/files', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId: currentProject,
              filePath: activeFile,
              content: editContent,
            }),
          })
          if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            console.error('Failed to save file to API:', data.error)
            addTerminalLine(`error Failed to save ${activeFile}: ${data.error || 'Unknown error'}`)
          }
        } catch (err) {
          console.error('Failed to save file:', err)
        }
      }

      setHasUnsavedChanges(false)
      setUnsavedFiles(prev => {
        const next = new Set(prev)
        next.delete(activeFile)
        return next
      })
      toast.success(`Saved ${getFileName(activeFile)}`)
    } finally {
      setIsSaving(false)
    }
  }, [activeFile, currentFile, hasUnsavedChanges, editContent, currentProject, updateProjectFile, setPreviewHtml, addTerminalLine])

  // Ctrl+S / Cmd+S keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (hasUnsavedChanges) {
          handleSave()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [hasUnsavedChanges, handleSave])

  // Sync scroll between line numbers and textarea
  const handleScroll = useCallback(() => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop
    }
    if (textareaRef.current && codeDisplayRef.current) {
      codeDisplayRef.current.scrollTop = textareaRef.current.scrollTop
      codeDisplayRef.current.scrollLeft = textareaRef.current.scrollLeft
    }
  }, [])

  // Update cursor position
  const updateCursorPosition = useCallback(() => {
    if (textareaRef.current) {
      const textarea = textareaRef.current
      const text = textarea.value.substring(0, textarea.selectionStart)
      const lines = text.split('\n')
      setCursorLine(lines.length)
      setCursorCol(lines[lines.length - 1].length + 1)
    }
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Tab key support - insert 2 spaces
    if (e.key === 'Tab') {
      e.preventDefault()
      const textarea = e.currentTarget
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const newValue = editContent.substring(0, start) + '  ' + editContent.substring(end)
      setEditContent(newValue)
      if (activeFile) {
        setHasUnsavedChanges(true)
        setUnsavedFiles(prev => new Set(prev).add(activeFile))
      }
      // Set cursor position after tab
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2
      })
    }
  }, [editContent, activeFile])

  // Line numbers
  const lineCount = editContent ? editContent.split('\n').length : 1

  // Highlighted code for display (we show textarea on top with transparent text
  // and highlighted code underneath for a lightweight approach)
  const highlightedCode = useMemo(() => {
    if (!currentFile) return ''
    return highlightCode(editContent, currentFile.language)
  }, [editContent, currentFile])

  if (displayFiles.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-zinc-950 p-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-800">
          <Code2 className="h-8 w-8 text-zinc-500" />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-sm font-medium text-zinc-300">Code Editor</h3>
          <p className="text-xs text-zinc-500">
            Generated code files will appear here as the agent builds your app
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* File Tabs */}
      <div className="flex items-center border-b border-zinc-800 bg-zinc-900/50">
        <ScrollArea className="flex-1">
          <div className="flex items-center">
            {displayFiles.map((tab) => (
              <button
                key={tab.path}
                onClick={() => setActiveFile(tab.path)}
                className={`relative flex items-center gap-1.5 border-r border-zinc-800 px-3 py-2 text-xs transition-colors ${
                  tab.path === activeFile
                    ? 'bg-zinc-950 text-zinc-100'
                    : 'bg-transparent text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300'
                }`}
              >
                <FileCode2 className="h-3.5 w-3.5" />
                {getFileName(tab.path)}
                {unsavedFiles.has(tab.path) && (
                  <span className="ml-0.5 h-2 w-2 rounded-full bg-amber-400" />
                )}
              </button>
            ))}
          </div>
        </ScrollArea>
        <div className="flex items-center shrink-0">
          {activeFile && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-zinc-500 hover:text-zinc-300"
              onClick={() => setActiveFile(null)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* File Path Header */}
      {currentFile && (
        <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900/30 px-4 py-1.5">
          <FileCode2 className="h-3.5 w-3.5 text-zinc-500" />
          <span className="text-xs text-zinc-400">{currentFile.path}</span>
          <Badge
            variant="outline"
            className="ml-1 border-zinc-700 text-[10px] text-zinc-500"
          >
            {currentFile.language}
          </Badge>
          {hasUnsavedChanges && (
            <Badge
              variant="outline"
              className="border-amber-500/30 text-[10px] text-amber-400 bg-amber-500/10"
            >
              Modified
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-zinc-500 hover:text-zinc-300"
              onClick={() => handleCopy(editContent, currentFile.path)}
              title="Copy file content"
            >
              {copiedPath === currentFile.path ? (
                <Check className="h-3 w-3 text-emerald-400" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`h-6 w-6 ${
                hasUnsavedChanges
                  ? 'text-amber-400 hover:text-amber-300'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
              onClick={handleSave}
              disabled={!hasUnsavedChanges || isSaving}
              title="Save (Ctrl+S)"
            >
              {isSaving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Save className="h-3 w-3" />
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Code Editor Area */}
      <div className="relative flex-1 overflow-hidden">
        {currentFile ? (
          <div className="flex h-full">
            {/* Line Numbers */}
            <div
              ref={lineNumbersRef}
              className="shrink-0 select-none overflow-hidden border-r border-zinc-800/50 bg-zinc-900/20 py-4 pl-3 pr-2 text-right"
              style={{ width: '3.5rem' }}
            >
              {Array.from({ length: lineCount }, (_, i) => (
                <div
                  key={i + 1}
                  className="leading-[1.6] text-zinc-600"
                  style={{ fontSize: '0.8125rem' }}
                >
                  {i + 1}
                </div>
              ))}
            </div>

            {/* Editor Container */}
            <div className="relative flex-1 overflow-hidden">
              {/* Highlighted code layer (underneath) */}
              <pre
                ref={codeDisplayRef}
                className="pointer-events-none absolute inset-0 overflow-hidden p-4 font-mono"
                style={{
                  fontSize: '0.8125rem',
                  lineHeight: '1.6',
                  tabSize: 2,
                  whiteSpace: 'pre',
                  wordWrap: 'normal',
                }}
                aria-hidden="true"
              >
                <code
                  dangerouslySetInnerHTML={{ __html: highlightedCode + '\n' }}
                />
              </pre>

              {/* Textarea (on top, transparent text) */}
              <textarea
                ref={textareaRef}
                value={editContent}
                onChange={handleContentChange}
                onScroll={handleScroll}
                onKeyDown={handleKeyDown}
                onClick={updateCursorPosition}
                onKeyUp={updateCursorPosition}
                className="absolute inset-0 h-full w-full resize-none bg-transparent p-4 font-mono text-transparent caret-zinc-100 outline-none"
                style={{
                  fontSize: '0.8125rem',
                  lineHeight: '1.6',
                  tabSize: 2,
                  whiteSpace: 'pre',
                  wordWrap: 'normal',
                  overflow: 'auto',
                }}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
              />
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <p className="text-sm text-zinc-500">
              Select a file from the tabs above
            </p>
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div className="flex items-center justify-between border-t border-zinc-800 bg-zinc-900/30 px-3 py-1">
        <div className="flex items-center gap-3 text-[10px] text-zinc-500">
          {currentFile && (
            <>
              <span>Ln {cursorLine}, Col {cursorCol}</span>
              <span>UTF-8</span>
              <span>{currentFile.language}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3 text-[10px] text-zinc-500">
          {hasUnsavedChanges && (
            <span className="text-amber-400">Unsaved changes</span>
          )}
          <span>Spaces: 2</span>
        </div>
      </div>
    </div>
  )
}
