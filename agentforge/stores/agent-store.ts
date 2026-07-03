import { create } from 'zustand'
import {
  getLanguageFromPath,
  parseCodeFilesWithLanguage,
  extractPreviewHtml as sharedExtractPreviewHtml,
} from '@/lib/code-parser'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  metadata?: {
    files?: Record<string, string>
    toolCalls?: Array<{ name: string; args: Record<string, unknown>; result?: string }>
    tokens?: number
    duration?: number
  }
}

export interface ProjectFile {
  path: string
  content: string
  language: string
}

export interface AgentState {
  messages: ChatMessage[]
  isStreaming: boolean
  currentProject: string | null
  currentProjectName: string | null
  projectFiles: ProjectFile[]
  activeFile: string | null
  terminalOutput: string[]
  previewHtml: string | null
  agentStatus: 'idle' | 'thinking' | 'coding' | 'executing' | 'previewing' | 'error' | 'cancelled'

  /** AbortController for cancelling in-flight agent requests */
  abortController: AbortController | null

  addMessage: (message: ChatMessage) => void
  updateLastMessage: (content: string) => void
  setStreaming: (streaming: boolean) => void
  setProject: (projectId: string | null, name?: string) => void
  setProjectFiles: (files: ProjectFile[]) => void
  addProjectFile: (file: ProjectFile) => void
  updateProjectFile: (path: string, content: string) => void
  deleteProjectFile: (path: string) => void
  renameProjectFile: (oldPath: string, newPath: string) => void
  setActiveFile: (path: string | null) => void
  addTerminalLine: (line: string) => void
  clearTerminal: () => void
  setPreviewHtml: (html: string | null) => void
  setAgentStatus: (status: AgentState['agentStatus']) => void

  /** Set the AbortController for the current in-flight request */
  setAbortController: (controller: AbortController | null) => void
  /** Cancel the current in-flight agent request */
  cancelAgent: () => void

  reset: () => void
}

export const useAgentStore = create<AgentState>((set, get) => ({
  messages: [],
  isStreaming: false,
  currentProject: null,
  currentProjectName: null,
  projectFiles: [],
  activeFile: null,
  terminalOutput: [],
  previewHtml: null,
  agentStatus: 'idle',
  abortController: null,

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  updateLastMessage: (content) =>
    set((state) => {
      const messages = [...state.messages]
      if (messages.length > 0) {
        const last = messages[messages.length - 1]
        messages[messages.length - 1] = { ...last, content: last.content + content }
      }
      return { messages }
    }),

  setStreaming: (streaming) => set({ isStreaming: streaming }),

  setProject: (projectId, name) =>
    set({
      currentProject: projectId,
      currentProjectName: name ?? null,
    }),

  setProjectFiles: (files) => set({ projectFiles: files }),

  addProjectFile: (file) =>
    set((state) => {
      const existing = state.projectFiles.findIndex((f) => f.path === file.path)
      if (existing >= 0) {
        const updated = [...state.projectFiles]
        updated[existing] = file
        return { projectFiles: updated }
      }
      return { projectFiles: [...state.projectFiles, file] }
    }),

  updateProjectFile: (path, content) =>
    set((state) => ({
      projectFiles: state.projectFiles.map((f) =>
        f.path === path ? { ...f, content } : f
      ),
    })),

  deleteProjectFile: (path) =>
    set((state) => {
      const newFiles = state.projectFiles.filter((f) => f.path !== path)
      const newActiveFile = state.activeFile === path ? null : state.activeFile
      return { projectFiles: newFiles, activeFile: newActiveFile }
    }),

  renameProjectFile: (oldPath, newPath) =>
    set((state) => ({
      projectFiles: state.projectFiles.map((f) =>
        f.path === oldPath
          ? { ...f, path: newPath, language: getLanguageFromPath(newPath) }
          : f
      ),
      activeFile: state.activeFile === oldPath ? newPath : state.activeFile,
    })),

  setActiveFile: (path) => set({ activeFile: path }),

  addTerminalLine: (line) =>
    set((state) => ({ terminalOutput: [...state.terminalOutput, line] })),

  clearTerminal: () => set({ terminalOutput: [] }),

  setPreviewHtml: (html) => set({ previewHtml: html }),

  setAgentStatus: (status) => set({ agentStatus: status }),

  // FIX: AbortController support for cancelling in-flight requests
  setAbortController: (controller) => set({ abortController: controller }),

  cancelAgent: () => {
    const { abortController } = get()
    if (abortController) {
      abortController.abort()
      console.log('[AgentStore] Agent execution cancelled by user')
    }
    set({
      isStreaming: false,
      agentStatus: 'cancelled',
      abortController: null,
    })
  },

  reset: () =>
    set({
      messages: [],
      isStreaming: false,
      projectFiles: [],
      activeFile: null,
      terminalOutput: [],
      previewHtml: null,
      agentStatus: 'idle',
      abortController: null,
    }),
}))

/**
 * Parse ### FILE: blocks from text and return ProjectFile[].
 * Delegates to the shared parseCodeFilesWithLanguage utility.
 */
export function parseFilesFromText(text: string): ProjectFile[] {
  return parseCodeFilesWithLanguage(text) as ProjectFile[]
}

/**
 * Extract __preview.html content from text.
 * Delegates to the shared extractPreviewHtml utility.
 */
export function extractPreviewHtml(text: string): string | null {
  return sharedExtractPreviewHtml(text)
}
