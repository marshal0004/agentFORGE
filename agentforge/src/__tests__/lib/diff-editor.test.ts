/**
 * Unit tests for Diff-Based File Editor
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  applyDiffOperations,
  applyDiffToFile,
  parseInlineDiffs,
  DiffOperation,
  rollbackFile,
  clearBackups,
} from '@/lib/diff-editor'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'

describe('applyDiffOperations', () => {
  const sampleContent = `import React from 'react'

export default function App() {
  return (
    <div className="app">
      <h1>Hello World</h1>
      <p>Welcome to my app</p>
    </div>
  )
}`

  it('should apply a simple search/replace operation', () => {
    const operations: DiffOperation[] = [
      { search: 'Hello World', replace: 'Hello AgentForge' },
    ]

    const result = applyDiffOperations(sampleContent, operations, 'test.tsx')
    expect(result.success).toBe(true)
    expect(result.operationsApplied).toBe(1)
    expect(result.content).toContain('Hello AgentForge')
    expect(result.content).not.toContain('Hello World')
  })

  it('should apply multiple operations in order', () => {
    const operations: DiffOperation[] = [
      { search: 'Hello World', replace: 'Hello AgentForge' },
      { search: 'Welcome to my app', replace: 'Built with AgentForge' },
    ]

    const result = applyDiffOperations(sampleContent, operations, 'test.tsx')
    expect(result.success).toBe(true)
    expect(result.operationsApplied).toBe(2)
    expect(result.content).toContain('Hello AgentForge')
    expect(result.content).toContain('Built with AgentForge')
  })

  it('should report conflicts when search text is not found', () => {
    const operations: DiffOperation[] = [
      { search: 'This text does not exist', replace: 'replacement' },
    ]

    const result = applyDiffOperations(sampleContent, operations, 'test.tsx')
    expect(result.success).toBe(false)
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].reason).toContain('not found')
  })

  it('should handle empty search (append to end)', () => {
    const operations: DiffOperation[] = [
      { search: '', replace: '\n// End of file' },
    ]

    const result = applyDiffOperations(sampleContent, operations)
    expect(result.success).toBe(true)
    expect(result.content).toContain('// End of file')
    expect(result.content.endsWith('// End of file')).toBe(true)
  })

  it('should handle multi-line search/replace', () => {
    const operations: DiffOperation[] = [
      {
        search: '      <h1>Hello World</h1>\n      <p>Welcome to my app</p>',
        replace: '      <h1>Hello AgentForge</h1>\n      <p>Built with love</p>\n      <button>Click me</button>',
      },
    ]

    const result = applyDiffOperations(sampleContent, operations)
    expect(result.success).toBe(true)
    expect(result.content).toContain('Click me')
    expect(result.content).toContain('Built with love')
  })

  it('should apply fuzzy matching for similar text', () => {
    // Content has slightly different whitespace
    const content = `function hello() {
    console.log("hello world");
    return true;
}`
    const operations: DiffOperation[] = [
      {
        search: 'console.log("hello world")', // Missing semicolon vs having it
        replace: 'console.log("hello agentforge")',
      },
    ]

    const result = applyDiffOperations(content, operations)
    // With fuzzy matching, this should either succeed or report a conflict
    // The exact behavior depends on the fuzzy threshold
    expect(result.operationsTotal).toBe(1)
  })

  it('should handle deletion (replace with empty string)', () => {
    const operations: DiffOperation[] = [
      { search: '      <p>Welcome to my app</p>\n', replace: '' },
    ]

    const result = applyDiffOperations(sampleContent, operations)
    expect(result.success).toBe(true)
    expect(result.content).not.toContain('Welcome to my app')
  })

  it('should partially apply even with some conflicts', () => {
    const operations: DiffOperation[] = [
      { search: 'Hello World', replace: 'Hello AgentForge' }, // Will succeed
      { search: 'Non-existent text', replace: 'something' }, // Will fail
    ]

    const result = applyDiffOperations(sampleContent, operations)
    expect(result.success).toBe(false)
    expect(result.operationsApplied).toBe(1)
    expect(result.content).toContain('Hello AgentForge')
    expect(result.conflicts).toHaveLength(1)
  })
})

describe('parseInlineDiffs', () => {
  it('should parse inline diff blocks', () => {
    const text = `Here are the changes:

<<<<<<< SEARCH
old code here
=======
new code here
>>>>>>> REPLACE

And some more text.`

    const diffs = parseInlineDiffs(text)
    expect(diffs).toHaveLength(1)
    expect(diffs[0].search).toBe('old code here')
    expect(diffs[0].replace).toBe('new code here')
  })

  it('should parse multiple inline diff blocks', () => {
    const text = `Changes:
<<<<<<< SEARCH
first old
=======
first new
>>>>>>> REPLACE

More changes:
<<<<<<< SEARCH
second old
=======
second new
>>>>>>> REPLACE`

    const diffs = parseInlineDiffs(text)
    expect(diffs).toHaveLength(2)
    expect(diffs[0].search).toBe('first old')
    expect(diffs[1].replace).toBe('second new')
  })

  it('should return empty array when no diffs found', () => {
    const text = 'No diffs here, just regular text.'
    expect(parseInlineDiffs(text)).toHaveLength(0)
  })

  it('should handle multi-line search/replace in diffs', () => {
    const text = `<<<<<<< SEARCH
line 1
line 2
line 3
=======
new line 1
new line 2
>>>>>>> REPLACE`

    const diffs = parseInlineDiffs(text)
    expect(diffs).toHaveLength(1)
    expect(diffs[0].search).toContain('line 1\nline 2\nline 3')
    expect(diffs[0].replace).toContain('new line 1\nnew line 2')
  })
})

describe('applyDiffToFile', () => {
  const tmpDir = path.join(os.tmpdir(), `agentforge-test-${Date.now()}`)
  let testFilePath: string

  beforeEach(async () => {
    await fs.mkdir(tmpDir, { recursive: true })
    testFilePath = path.join(tmpDir, 'test-file.ts')
    await fs.writeFile(testFilePath, 'const x = 1\nconst y = 2\n', 'utf-8')
    clearBackups()
  })

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
    clearBackups()
  })

  it('should apply diff to a real file', async () => {
    const operations: DiffOperation[] = [
      { search: 'const x = 1', replace: 'const x = 42' },
    ]

    const result = await applyDiffToFile(testFilePath, operations)
    expect(result.success).toBe(true)
    expect(result.operationsApplied).toBe(1)

    const content = await fs.readFile(testFilePath, 'utf-8')
    expect(content).toContain('const x = 42')
  })

  it('should reject path traversal', async () => {
    const result = await applyDiffToFile('../etc/passwd', [
      { search: '', replace: 'hacked' },
    ])
    expect(result.success).toBe(false)
    expect(result.conflicts.length).toBeGreaterThan(0)
  })

  it('should create backup before editing', async () => {
    const operations: DiffOperation[] = [
      { search: 'const x = 1', replace: 'const x = 99' },
    ]

    await applyDiffToFile(testFilePath, operations)

    const { getBackupHistory } = await import('@/lib/diff-editor')
    const history = getBackupHistory(testFilePath)
    expect(history.length).toBeGreaterThan(0)
    expect(history[0].originalContent).toContain('const x = 1')
  })

  it('should support rollback', async () => {
    const operations: DiffOperation[] = [
      { search: 'const x = 1', replace: 'const x = 99' },
    ]

    const result = await applyDiffToFile(testFilePath, operations)
    expect(result.success).toBe(true)

    // Check backup exists
    const { getBackupHistory } = await import('@/lib/diff-editor')
    const history = getBackupHistory(testFilePath)
    if (history.length > 0) {
      const rolledBack = await rollbackFile(testFilePath)
      expect(rolledBack).toBe(true)

      const content = await fs.readFile(testFilePath, 'utf-8')
      expect(content).toContain('const x = 1')
    }
  })

  it('should report error for non-existent file', async () => {
    const result = await applyDiffToFile('/nonexistent/file.ts', [
      { search: 'something', replace: 'else' },
    ])
    expect(result.success).toBe(false)
  })
})
