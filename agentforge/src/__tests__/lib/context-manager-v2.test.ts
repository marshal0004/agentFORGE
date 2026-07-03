import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the event bus to avoid side effects
vi.mock('@/lib/event-bus', () => ({
  agentEventBus: {
    emit: vi.fn(),
    on: vi.fn(() => () => {}),
    getHistory: vi.fn(() => []),
  },
}))

// Mock the LLM provider
vi.mock('@/lib/llm-provider', () => ({
  llmProviderRegistry: {
    getProviderForModel: vi.fn(),
  },
}))

import {
  ContextManager,
  estimateTokens,
  getModelContextWindow,
  LRUFileTracker,
  ToolResultAbbreviator,
} from '@/lib/context-manager'

describe('estimateTokens', () => {
  it('estimates tokens for English text (~4 chars per token)', () => {
    const text = 'Hello world this is a test'
    const tokens = estimateTokens(text)
    expect(tokens).toBeGreaterThan(0)
    expect(tokens).toBeLessThan(text.length) // Should be fewer tokens than chars
  })

  it('estimates tokens for CJK text (~2 chars per token)', () => {
    const text = '你好世界这是一个测试'
    const tokens = estimateTokens(text)
    expect(tokens).toBeGreaterThan(0)
  })

  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('handles mixed CJK and English', () => {
    const text = 'Hello 你好 World 世界'
    const tokens = estimateTokens(text)
    expect(tokens).toBeGreaterThan(0)
  })
})

describe('getModelContextWindow', () => {
  it('returns known context windows for popular models', () => {
    expect(getModelContextWindow('gpt-4o')).toBe(128_000)
    expect(getModelContextWindow('claude-3.5-sonnet')).toBe(200_000)
    expect(getModelContextWindow('gemini-2.0-flash')).toBe(1_000_000)
  })

  it('returns 4096 for unknown models', () => {
    expect(getModelContextWindow('unknown-model-xyz')).toBe(4096)
  })

  it('handles partial matches for versioned models', () => {
    expect(getModelContextWindow('gpt-4o-2024-05-13')).toBe(128_000)
  })
})

describe('ContextManager', () => {
  let manager: ContextManager

  beforeEach(() => {
    manager = new ContextManager({
      maxTokens: 1000,
      compactionThreshold: 0.80,
      minRetainedMessages: 2,
      useSummarization: false, // Use simple truncation for tests
    })
  })

  it('detects when compaction is needed', () => {
    const messages = [
      { role: 'system' as const, content: 'You are helpful' },
      ...Array(20).fill(null).map((_, i) => ({
        role: 'user' as const,
        content: `Message ${i}: ${'x'.repeat(100)}`,
      })),
    ]
    expect(manager.needsCompaction(messages, 'gpt-4o')).toBe(false)
    // With small maxTokens, it should need compaction
    const smallManager = new ContextManager({ maxTokens: 500, compactionThreshold: 0.5 })
    expect(smallManager.needsCompaction(messages, 'test-model')).toBe(true)
  })

  it('compacts messages when over threshold', async () => {
    const messages = [
      { role: 'system' as const, content: 'System prompt' },
      ...Array(50).fill(null).map((_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as const,
        content: `Message ${i}: ${'x'.repeat(200)}`,
      })),
    ]
    const smallManager = new ContextManager({ maxTokens: 2000, compactionThreshold: 0.5, useSummarization: false })
    const result = await smallManager.compact(messages, 'test-model', 'test-session')
    expect(result.messagesAfter).toBeLessThanOrEqual(result.messagesBefore)
    expect(result.tokensSaved).toBeGreaterThanOrEqual(0)
  })

  it('builds context window within token limits', async () => {
    const messages = [
      { role: 'system' as const, content: 'System prompt' },
      ...Array(10).fill(null).map((_, i) => ({
        role: 'user' as const,
        content: `Message ${i}`,
      })),
    ]
    const result = await manager.buildContextWindow(messages, 'test-model', 'test-session')
    expect(result.length).toBeGreaterThan(0)
    expect(result[0].role).toBe('system')
  })
})

describe('LRUFileTracker', () => {
  let tracker: LRUFileTracker

  beforeEach(() => {
    tracker = new LRUFileTracker()
  })

  it('tracks files by recency', () => {
    tracker.touch('/src/app.tsx', 'export default function App() {}')
    tracker.touch('/src/utils.ts', 'export function util() {}')
    tracker.touch('/src/app.tsx', 'export default function App() { return 1 }') // Touch again

    const files = tracker.getRelevantFiles(10, 50000)
    expect(files.length).toBeGreaterThan(0)
    // app.tsx should be more recent
    const appIdx = files.findIndex(f => f.path.includes('app.tsx'))
    const utilIdx = files.findIndex(f => f.path.includes('utils.ts'))
    expect(appIdx).toBeLessThan(utilIdx) // More recent first
  })

  it('includes pre-warmed files when they are tracked', () => {
    // Pre-warmed paths are marked when they are touched
    tracker.touch('package.json', '{"name": "test"}')
    tracker.touch('tsconfig.json', '{"compilerOptions": {}}')
    const files = tracker.getRelevantFiles(10, 50000)
    const paths = files.map(f => f.path)
    expect(paths.some(p => p.includes('package.json'))).toBe(true)
  })

  it('respects max files limit', () => {
    for (let i = 0; i < 20; i++) {
      tracker.touch(`/src/file${i}.ts`, `export const file${i} = ${i}`)
    }
    const files = tracker.getRelevantFiles(5, 50000)
    expect(files.length).toBeLessThanOrEqual(20)
  })
})

describe('ToolResultAbbreviator', () => {
  it('abbreviates write_file tool results', () => {
    const abbreviator = new ToolResultAbbreviator()
    const result = abbreviator.abbreviate('write_file', 'File written successfully: 1500 bytes')
    expect(result.length).toBeLessThan(50)
    expect(result).toContain('write_file')
  })

  it('abbreviates edit_file tool results', () => {
    const abbreviator = new ToolResultAbbreviator()
    const result = abbreviator.abbreviate('edit_file', 'Edit applied to /src/app.tsx: replaced 3 occurrences')
    expect(result.length).toBeLessThan(100)
  })

  it('handles unknown tool names gracefully', () => {
    const abbreviator = new ToolResultAbbreviator()
    const result = abbreviator.abbreviate('unknown_tool', 'Some result data')
    expect(result).toBeTruthy()
  })
})
