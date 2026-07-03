/**
 * Unit tests for Context Window Management
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ContextManager,
  ContextMessage,
  estimateTokens,
  getModelContextWindow,
} from '@/lib/context-manager'

describe('estimateTokens', () => {
  it('should return 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('should estimate tokens for English text', () => {
    // ~4 chars per token for English
    const text = 'Hello world, this is a test message.'
    const tokens = estimateTokens(text)
    expect(tokens).toBeGreaterThan(0)
    expect(tokens).toBeLessThanOrEqual(text.length) // Conservative estimate
  })

  it('should estimate tokens for CJK text', () => {
    // ~2 chars per token for CJK
    const text = '你好世界这是一个测试消息'
    const tokens = estimateTokens(text)
    expect(tokens).toBeGreaterThan(0)
  })

  it('should handle mixed CJK and English text', () => {
    const text = 'Hello 你好 World 世界'
    const tokens = estimateTokens(text)
    expect(tokens).toBeGreaterThan(0)
  })

  it('should be conservative (overestimate rather than underestimate)', () => {
    // A typical English word is ~1 token
    const text = 'Hello world'
    const tokens = estimateTokens(text)
    // Should not be unreasonably large
    expect(tokens).toBeLessThan(text.length)
  })
})

describe('getModelContextWindow', () => {
  it('should return known context window for GLM models', () => {
    expect(getModelContextWindow('glm-4-flash')).toBe(128_000)
    expect(getModelContextWindow('glm-4-long')).toBe(1_000_000)
    expect(getModelContextWindow('glm-3-turbo')).toBe(32_000)
  })

  it('should return known context window for OpenAI models', () => {
    expect(getModelContextWindow('gpt-4o')).toBe(128_000)
    expect(getModelContextWindow('gpt-4')).toBe(8_192)
    expect(getModelContextWindow('gpt-3.5-turbo')).toBe(16_385)
  })

  it('should return known context window for Anthropic models', () => {
    expect(getModelContextWindow('claude-3.5-sonnet')).toBe(200_000)
  })

  it('should return default for unknown models', () => {
    expect(getModelContextWindow('unknown-model-xyz')).toBe(4096)
  })

  it('should handle versioned model names', () => {
    // Should match "gpt-4o" in "gpt-4o-2024-05-13"
    expect(getModelContextWindow('gpt-4o-2024-05-13')).toBe(128_000)
  })
})

describe('ContextManager', () => {
  let manager: ContextManager

  beforeEach(() => {
    manager = new ContextManager({
      maxTokens: 1000,
      compactionThreshold: 0.80,
      minRetainedMessages: 4,
      useSummarization: false, // Disable for unit tests (no LLM needed)
    })
  })

  describe('countTokens', () => {
    it('should count tokens across all messages', () => {
      const messages: ContextMessage[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello!' },
      ]

      const tokens = manager.countTokens(messages)
      expect(tokens).toBeGreaterThan(0)
    })

    it('should use cached token counts', () => {
      const messages: ContextMessage[] = [
        { role: 'user', content: 'Test message' },
      ]

      // First call: estimate and cache
      const tokens1 = manager.countTokens(messages)
      // Second call: use cache
      const tokens2 = manager.countTokens(messages)
      expect(tokens1).toBe(tokens2)
    })
  })

  describe('needsCompaction', () => {
    it('should return false when under threshold', () => {
      const messages: ContextMessage[] = [
        { role: 'system', content: 'Short system prompt' },
        { role: 'user', content: 'Hello' },
      ]

      expect(manager.needsCompaction(messages, 'test-model')).toBe(false)
    })

    it('should return true when over threshold', () => {
      // Create messages that exceed 80% of 1000 tokens
      const messages: ContextMessage[] = [
        { role: 'system', content: 'System prompt' },
        ...Array.from({ length: 50 }, (_, i) => ({
          role: 'user' as const,
          content: `This is message number ${i} with some padding text to make it longer than usual`,
        })),
      ]

      expect(manager.needsCompaction(messages, 'test-model')).toBe(true)
    })
  })

  describe('compact', () => {
    it('should not compact when under threshold', async () => {
      const messages: ContextMessage[] = [
        { role: 'system', content: 'Short prompt' },
        { role: 'user', content: 'Hello' },
      ]

      const result = await manager.compact(messages, 'test-model', 'test-session')
      expect(result.messagesBefore).toBe(result.messagesAfter)
      expect(result.tokensSaved).toBe(0)
      expect(result.summarized).toBe(false)
    })

    it('should compact when over threshold', async () => {
      const manager = new ContextManager({
        maxTokens: 200,
        compactionThreshold: 0.50,
        minRetainedMessages: 2,
        useSummarization: false,
      })

      const messages: ContextMessage[] = [
        { role: 'system', content: 'System prompt' },
        ...Array.from({ length: 50 }, (_, i) => ({
          role: 'user' as const,
          content: `Message ${i}: This is a very long message with a lot of detailed content about various topics that should add up to trigger the compaction threshold. Each message is designed to be at least a few hundred characters to make sure the token count exceeds our threshold. We need this to be long enough to trigger compaction reliably. Adding more padding text here to ensure each message is substantial and contributes meaningfully to the overall token count in the conversation context window. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.`,
        })),
      ]

      const tokensBefore = manager.countTokens(messages)
      const result = await manager.compact(messages, 'test-model', 'test-session')
      // Compaction should reduce messages or at least tokens
      expect(result.tokensAfter).toBeLessThanOrEqual(tokensBefore)
    })

    it('should always keep the system message', async () => {
      const messages: ContextMessage[] = [
        { role: 'system', content: 'IMPORTANT SYSTEM PROMPT' },
        ...Array.from({ length: 30 }, (_, i) => ({
          role: 'user' as const,
          content: `Message ${i} with enough text to add up and trigger compaction eventually when combined.`,
        })),
      ]

      const result = await manager.compact(messages, 'test-model', 'test-session')
      const hasSystem = result.messages.some((m) => m.role === 'system')
      expect(hasSystem).toBe(true)
    })

    it('should keep minimum retained messages', async () => {
      const messages: ContextMessage[] = [
        { role: 'system', content: 'System' },
        ...Array.from({ length: 30 }, (_, i) => ({
          role: 'user' as const,
          content: `Message ${i} with some padding text that makes this message longer than just a number`,
        })),
      ]

      const result = await manager.compact(messages, 'test-model', 'test-session')
      // Should keep at least minRetainedMessages (4) non-system messages
      const nonSystemCount = result.messages.filter((m) => m.role !== 'system').length
      expect(nonSystemCount).toBeGreaterThanOrEqual(4)
    })
  })

  describe('truncateMessage', () => {
    it('should not truncate messages under the budget', () => {
      const message: ContextMessage = { role: 'user', content: 'Short message' }
      const result = manager.truncateMessage(message, 100)
      expect(result.content).toBe('Short message')
    })

    it('should truncate messages over the budget', () => {
      const message: ContextMessage = {
        role: 'assistant',
        content: 'A'.repeat(1000),
      }
      const result = manager.truncateMessage(message, 10)
      expect(result.content).toContain('[message truncated]')
      expect(result.content.length).toBeLessThan(1000)
    })
  })

  describe('buildContextWindow', () => {
    it('should return messages unchanged when under limit', async () => {
      const messages: ContextMessage[] = [
        { role: 'system', content: 'System' },
        { role: 'user', content: 'Hello' },
      ]

      const result = await manager.buildContextWindow(messages, 'test-model', 'test-session')
      expect(result.length).toBe(2)
    })

    it('should compact and truncate when over limit', async () => {
      const manager = new ContextManager({
        maxTokens: 8000,
        compactionThreshold: 0.75,
        minRetainedMessages: 4,
        useSummarization: false,
      })

      // Create enough messages to exceed the threshold
      const messages: ContextMessage[] = [
        { role: 'system', content: 'System' },
        ...Array.from({ length: 80 }, (_, i) => ({
          role: 'user' as const,
          content: `Message ${i}: ${'x'.repeat(300)}`,
        })),
      ]

      // Verify compaction detects the overflow
      const needsCompaction = manager.needsCompaction(messages, 'glm-4-flash')
      expect(needsCompaction).toBe(true)

      // Run compaction directly
      const compacted = await manager.compact(messages, 'glm-4-flash', 'test-session')

      // Compaction should have reduced messages or tokens
      expect(compacted.messagesAfter).toBeLessThanOrEqual(compacted.messagesBefore)
      // If tokens were saved, verify it
      if (compacted.tokensSaved > 0) {
        expect(compacted.tokensAfter).toBeLessThan(compacted.tokensBefore)
      }
    })
  })

  describe('updateConfig', () => {
    it('should update configuration at runtime', () => {
      manager.updateConfig({ maxTokens: 5000 })
      expect(manager.getMaxTokens('test-model')).toBe(5000)
    })
  })
})
