import { describe, it, expect, beforeEach } from 'vitest'
import { useAgentStore, parseFilesFromText, extractPreviewHtml } from '../../../stores/agent-store'
import type { ChatMessage, ProjectFile } from '../../../stores/agent-store'

describe('agent-store', () => {
  beforeEach(() => {
    // Reset the store before each test
    useAgentStore.getState().reset()
  })

  describe('initial state', () => {
    it('should have correct default values', () => {
      const state = useAgentStore.getState()
      expect(state.messages).toEqual([])
      expect(state.isStreaming).toBe(false)
      expect(state.currentProject).toBeNull()
      expect(state.currentProjectName).toBeNull()
      expect(state.projectFiles).toEqual([])
      expect(state.activeFile).toBeNull()
      expect(state.terminalOutput).toEqual([])
      expect(state.previewHtml).toBeNull()
      expect(state.agentStatus).toBe('idle')
    })
  })

  describe('addMessage', () => {
    it('should add a message to the store', () => {
      const msg: ChatMessage = {
        id: '1',
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
      }
      useAgentStore.getState().addMessage(msg)
      expect(useAgentStore.getState().messages).toHaveLength(1)
      expect(useAgentStore.getState().messages[0]).toEqual(msg)
    })

    it('should add multiple messages in order', () => {
      const msg1: ChatMessage = { id: '1', role: 'user', content: 'Hello', timestamp: 1 }
      const msg2: ChatMessage = { id: '2', role: 'assistant', content: 'Hi there', timestamp: 2 }
      useAgentStore.getState().addMessage(msg1)
      useAgentStore.getState().addMessage(msg2)
      expect(useAgentStore.getState().messages).toHaveLength(2)
      expect(useAgentStore.getState().messages[0].id).toBe('1')
      expect(useAgentStore.getState().messages[1].id).toBe('2')
    })
  })

  describe('updateLastMessage', () => {
    it('should append content to the last message', () => {
      const msg: ChatMessage = { id: '1', role: 'assistant', content: 'Hello', timestamp: Date.now() }
      useAgentStore.getState().addMessage(msg)
      useAgentStore.getState().updateLastMessage(' World')
      expect(useAgentStore.getState().messages[0].content).toBe('Hello World')
    })

    it('should do nothing when there are no messages', () => {
      useAgentStore.getState().updateLastMessage('test')
      expect(useAgentStore.getState().messages).toHaveLength(0)
    })

    it('should only update the last message, not earlier ones', () => {
      const msg1: ChatMessage = { id: '1', role: 'user', content: 'First', timestamp: 1 }
      const msg2: ChatMessage = { id: '2', role: 'assistant', content: 'Second', timestamp: 2 }
      useAgentStore.getState().addMessage(msg1)
      useAgentStore.getState().addMessage(msg2)
      useAgentStore.getState().updateLastMessage(' appended')
      expect(useAgentStore.getState().messages[0].content).toBe('First')
      expect(useAgentStore.getState().messages[1].content).toBe('Second appended')
    })
  })

  describe('setStreaming', () => {
    it('should toggle streaming state', () => {
      useAgentStore.getState().setStreaming(true)
      expect(useAgentStore.getState().isStreaming).toBe(true)
      useAgentStore.getState().setStreaming(false)
      expect(useAgentStore.getState().isStreaming).toBe(false)
    })
  })

  describe('setProject', () => {
    it('should set project ID and name', () => {
      useAgentStore.getState().setProject('proj-123', 'My Project')
      expect(useAgentStore.getState().currentProject).toBe('proj-123')
      expect(useAgentStore.getState().currentProjectName).toBe('My Project')
    })

    it('should set project ID without name (name defaults to null)', () => {
      useAgentStore.getState().setProject('proj-456')
      expect(useAgentStore.getState().currentProject).toBe('proj-456')
      expect(useAgentStore.getState().currentProjectName).toBeNull()
    })

    it('should clear project when set to null', () => {
      useAgentStore.getState().setProject('proj-123', 'Test')
      useAgentStore.getState().setProject(null)
      expect(useAgentStore.getState().currentProject).toBeNull()
      expect(useAgentStore.getState().currentProjectName).toBeNull()
    })
  })

  describe('setProjectFiles', () => {
    it('should replace all project files', () => {
      const files: ProjectFile[] = [
        { path: 'src/index.ts', content: 'hello', language: 'typescript' },
        { path: 'src/app.tsx', content: 'world', language: 'tsx' },
      ]
      useAgentStore.getState().setProjectFiles(files)
      expect(useAgentStore.getState().projectFiles).toEqual(files)
    })

    it('should clear project files with empty array', () => {
      const files: ProjectFile[] = [{ path: 'a.ts', content: 'x', language: 'typescript' }]
      useAgentStore.getState().setProjectFiles(files)
      useAgentStore.getState().setProjectFiles([])
      expect(useAgentStore.getState().projectFiles).toEqual([])
    })
  })

  describe('addProjectFile', () => {
    it('should add a new file', () => {
      const file: ProjectFile = { path: 'new.ts', content: 'new content', language: 'typescript' }
      useAgentStore.getState().addProjectFile(file)
      expect(useAgentStore.getState().projectFiles).toHaveLength(1)
      expect(useAgentStore.getState().projectFiles[0]).toEqual(file)
    })

    it('should update existing file with same path', () => {
      const file1: ProjectFile = { path: 'src/app.ts', content: 'v1', language: 'typescript' }
      const file2: ProjectFile = { path: 'src/app.ts', content: 'v2', language: 'typescript' }
      useAgentStore.getState().addProjectFile(file1)
      useAgentStore.getState().addProjectFile(file2)
      expect(useAgentStore.getState().projectFiles).toHaveLength(1)
      expect(useAgentStore.getState().projectFiles[0].content).toBe('v2')
    })

    it('should add multiple different files', () => {
      const file1: ProjectFile = { path: 'a.ts', content: 'a', language: 'typescript' }
      const file2: ProjectFile = { path: 'b.ts', content: 'b', language: 'typescript' }
      useAgentStore.getState().addProjectFile(file1)
      useAgentStore.getState().addProjectFile(file2)
      expect(useAgentStore.getState().projectFiles).toHaveLength(2)
    })
  })

  describe('updateProjectFile', () => {
    it('should update content of an existing file by path', () => {
      useAgentStore.getState().addProjectFile({ path: 'a.ts', content: 'old', language: 'typescript' })
      useAgentStore.getState().updateProjectFile('a.ts', 'new')
      expect(useAgentStore.getState().projectFiles[0].content).toBe('new')
    })

    it('should not modify other files', () => {
      useAgentStore.getState().addProjectFile({ path: 'a.ts', content: 'a', language: 'typescript' })
      useAgentStore.getState().addProjectFile({ path: 'b.ts', content: 'b', language: 'typescript' })
      useAgentStore.getState().updateProjectFile('a.ts', 'updated')
      expect(useAgentStore.getState().projectFiles[0].content).toBe('updated')
      expect(useAgentStore.getState().projectFiles[1].content).toBe('b')
    })

    it('should not add a file if path does not exist', () => {
      useAgentStore.getState().updateProjectFile('nonexistent.ts', 'content')
      expect(useAgentStore.getState().projectFiles).toHaveLength(0)
    })
  })

  describe('deleteProjectFile', () => {
    it('should remove a file by path', () => {
      useAgentStore.getState().addProjectFile({ path: 'a.ts', content: 'a', language: 'typescript' })
      useAgentStore.getState().addProjectFile({ path: 'b.ts', content: 'b', language: 'typescript' })
      useAgentStore.getState().deleteProjectFile('a.ts')
      expect(useAgentStore.getState().projectFiles).toHaveLength(1)
      expect(useAgentStore.getState().projectFiles[0].path).toBe('b.ts')
    })

    it('should clear activeFile if it was the deleted file', () => {
      useAgentStore.getState().addProjectFile({ path: 'a.ts', content: 'a', language: 'typescript' })
      useAgentStore.getState().setActiveFile('a.ts')
      useAgentStore.getState().deleteProjectFile('a.ts')
      expect(useAgentStore.getState().activeFile).toBeNull()
    })

    it('should not clear activeFile if a different file was deleted', () => {
      useAgentStore.getState().addProjectFile({ path: 'a.ts', content: 'a', language: 'typescript' })
      useAgentStore.getState().addProjectFile({ path: 'b.ts', content: 'b', language: 'typescript' })
      useAgentStore.getState().setActiveFile('a.ts')
      useAgentStore.getState().deleteProjectFile('b.ts')
      expect(useAgentStore.getState().activeFile).toBe('a.ts')
    })
  })

  describe('renameProjectFile', () => {
    it('should change path and update language', () => {
      useAgentStore.getState().addProjectFile({ path: 'a.ts', content: 'content', language: 'typescript' })
      useAgentStore.getState().renameProjectFile('a.ts', 'a.py')
      expect(useAgentStore.getState().projectFiles[0].path).toBe('a.py')
      expect(useAgentStore.getState().projectFiles[0].language).toBe('python')
    })

    it('should update activeFile if it was the renamed file', () => {
      useAgentStore.getState().addProjectFile({ path: 'a.ts', content: 'content', language: 'typescript' })
      useAgentStore.getState().setActiveFile('a.ts')
      useAgentStore.getState().renameProjectFile('a.ts', 'b.ts')
      expect(useAgentStore.getState().activeFile).toBe('b.ts')
    })

    it('should not change activeFile if it was a different file', () => {
      useAgentStore.getState().addProjectFile({ path: 'a.ts', content: 'a', language: 'typescript' })
      useAgentStore.getState().addProjectFile({ path: 'b.ts', content: 'b', language: 'typescript' })
      useAgentStore.getState().setActiveFile('a.ts')
      useAgentStore.getState().renameProjectFile('b.ts', 'c.ts')
      expect(useAgentStore.getState().activeFile).toBe('a.ts')
    })

    it('should preserve content during rename', () => {
      useAgentStore.getState().addProjectFile({ path: 'a.ts', content: 'my content', language: 'typescript' })
      useAgentStore.getState().renameProjectFile('a.ts', 'renamed.ts')
      expect(useAgentStore.getState().projectFiles[0].content).toBe('my content')
    })
  })

  describe('setActiveFile', () => {
    it('should set the active file path', () => {
      useAgentStore.getState().setActiveFile('src/app.tsx')
      expect(useAgentStore.getState().activeFile).toBe('src/app.tsx')
    })

    it('should clear active file with null', () => {
      useAgentStore.getState().setActiveFile('src/app.tsx')
      useAgentStore.getState().setActiveFile(null)
      expect(useAgentStore.getState().activeFile).toBeNull()
    })
  })

  describe('addTerminalLine', () => {
    it('should add a terminal line', () => {
      useAgentStore.getState().addTerminalLine('line 1')
      useAgentStore.getState().addTerminalLine('line 2')
      expect(useAgentStore.getState().terminalOutput).toEqual(['line 1', 'line 2'])
    })
  })

  describe('clearTerminal', () => {
    it('should clear all terminal lines', () => {
      useAgentStore.getState().addTerminalLine('line 1')
      useAgentStore.getState().addTerminalLine('line 2')
      useAgentStore.getState().clearTerminal()
      expect(useAgentStore.getState().terminalOutput).toEqual([])
    })
  })

  describe('setPreviewHtml', () => {
    it('should set preview HTML content', () => {
      useAgentStore.getState().setPreviewHtml('<h1>Hello</h1>')
      expect(useAgentStore.getState().previewHtml).toBe('<h1>Hello</h1>')
    })

    it('should clear preview HTML with null', () => {
      useAgentStore.getState().setPreviewHtml('<h1>Hello</h1>')
      useAgentStore.getState().setPreviewHtml(null)
      expect(useAgentStore.getState().previewHtml).toBeNull()
    })
  })

  describe('setAgentStatus', () => {
    it('should change agent status', () => {
      useAgentStore.getState().setAgentStatus('thinking')
      expect(useAgentStore.getState().agentStatus).toBe('thinking')
      useAgentStore.getState().setAgentStatus('coding')
      expect(useAgentStore.getState().agentStatus).toBe('coding')
      useAgentStore.getState().setAgentStatus('error')
      expect(useAgentStore.getState().agentStatus).toBe('error')
    })
  })

  describe('reset', () => {
    it('should reset all state to defaults', () => {
      const store = useAgentStore.getState()
      store.addMessage({ id: '1', role: 'user', content: 'test', timestamp: Date.now() })
      store.setStreaming(true)
      store.setProject('proj-1', 'Project')
      store.addProjectFile({ path: 'a.ts', content: 'a', language: 'typescript' })
      store.setActiveFile('a.ts')
      store.addTerminalLine('output')
      store.setPreviewHtml('<html></html>')
      store.setAgentStatus('coding')

      store.reset()

      const after = useAgentStore.getState()
      expect(after.messages).toEqual([])
      expect(after.isStreaming).toBe(false)
      expect(after.currentProject).toBe('proj-1') // reset doesn't clear project
      expect(after.currentProjectName).toBe('Project') // reset doesn't clear project name
      expect(after.projectFiles).toEqual([])
      expect(after.activeFile).toBeNull()
      expect(after.terminalOutput).toEqual([])
      expect(after.previewHtml).toBeNull()
      expect(after.agentStatus).toBe('idle')
    })
  })
})

describe('parseFilesFromText', () => {
  it('should parse a single ### FILE: block', () => {
    const text = `### FILE: src/app.tsx
\`\`\`tsx
export default function App() { return <div>Hello</div> }
\`\`\``

    const files = parseFilesFromText(text)
    expect(files).toHaveLength(1)
    expect(files[0].path).toBe('src/app.tsx')
    expect(files[0].content).toContain('export default function App')
    expect(files[0].language).toBe('tsx')
  })

  it('should parse multiple ### FILE: blocks', () => {
    const text = `### FILE: src/index.ts
\`\`\`ts
console.log("hello")
\`\`\`

### FILE: src/styles.css
\`\`\`css
body { margin: 0; }
\`\`\``

    const files = parseFilesFromText(text)
    expect(files).toHaveLength(2)
    expect(files[0].path).toBe('src/index.ts')
    expect(files[0].language).toBe('typescript')
    expect(files[1].path).toBe('src/styles.css')
    expect(files[1].language).toBe('css')
  })

  it('should return empty array for text without file blocks', () => {
    const text = 'Just some regular text without any file blocks'
    const files = parseFilesFromText(text)
    expect(files).toEqual([])
  })

  it('should handle empty code blocks', () => {
    const text = `### FILE: empty.js
\`\`\`js
\`\`\``

    const files = parseFilesFromText(text)
    expect(files).toHaveLength(1)
    expect(files[0].content).toBe('')
  })

  it('should handle files with various extensions and detect language', () => {
    const text = `### FILE: prisma/schema.prisma
\`\`\`prisma
model User { id String @id }
\`\`\``

    const files = parseFilesFromText(text)
    expect(files[0].language).toBe('prisma')
  })

  it('should trim file path whitespace', () => {
    const text = `### FILE:  src/app.tsx 
\`\`\`tsx
code
\`\`\``

    const files = parseFilesFromText(text)
    expect(files[0].path).toBe('src/app.tsx')
  })

  it('should return text language for unknown extensions', () => {
    const text = `### FILE: README.xyz
\`\`\`
some text
\`\`\``

    const files = parseFilesFromText(text)
    expect(files[0].language).toBe('text')
  })

  it('should handle duplicate file paths (both are kept)', () => {
    const text = `### FILE: a.ts
\`\`\`ts
first
\`\`\`

### FILE: a.ts
\`\`\`ts
second
\`\`\``

    const files = parseFilesFromText(text)
    expect(files).toHaveLength(2)
  })
})

describe('extractPreviewHtml', () => {
  it('should extract __preview.html content', () => {
    const text = `### FILE: __preview.html
\`\`\`html
<html><body><h1>Preview</h1></body></html>
\`\`\``

    const html = extractPreviewHtml(text)
    // The regex may capture a trailing newline; use toContain for robustness
    expect(html).toContain('<html><body><h1>Preview</h1></body></html>')
  })

  it('should return null when no __preview.html block exists', () => {
    const text = `### FILE: src/app.tsx
\`\`\`tsx
code
\`\`\``

    const html = extractPreviewHtml(text)
    expect(html).toBeNull()
  })

  it('should return null for empty text', () => {
    expect(extractPreviewHtml('')).toBeNull()
  })

  it('should only match __preview.html, not other html files', () => {
    const text = `### FILE: index.html
\`\`\`html
<html></html>
\`\`\``

    const html = extractPreviewHtml(text)
    expect(html).toBeNull()
  })

  it('should extract multiline HTML content', () => {
    const text = `### FILE: __preview.html
\`\`\`html
<html>
  <body>
    <h1>Hello</h1>
  </body>
</html>
\`\`\``

    const html = extractPreviewHtml(text)
    expect(html).toContain('<html>')
    expect(html).toContain('</html>')
    expect(html).toContain('<h1>Hello</h1>')
  })
})
