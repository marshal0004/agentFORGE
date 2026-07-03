import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/event-bus', () => ({
  agentEventBus: { emit: vi.fn(), on: vi.fn(() => () => {}) },
}))

import { LLMProviderRegistry, RateLimitTracker } from '@/lib/llm-provider'

describe('RateLimitTracker', () => {
  let tracker: RateLimitTracker

  beforeEach(() => {
    tracker = new RateLimitTracker()
  })

  it('marks a provider as rate-limited', () => {
    tracker.markRateLimited('openai', 60000, '429 Too Many Requests')
    const result = tracker.isRateLimited('openai')
    expect(result.limited).toBe(true)
    expect(result.reason).toBe('429 Too Many Requests')
  })

  it('detects non-rate-limited providers', () => {
    const result = tracker.isRateLimited('openai')
    expect(result.limited).toBe(false)
  })

  it('clears expired cooldowns', () => {
    // Mark as rate limited for 1ms (will expire immediately)
    tracker.markRateLimited('openai', 1, 'test')
    // Wait a tiny bit
    setTimeout(() => {
      tracker.clearExpired()
      const result = tracker.isRateLimited('openai')
      expect(result.limited).toBe(false)
    }, 10)
  })

  it('extends cooldown if new retry-after is longer', () => {
    tracker.markRateLimited('openai', 10000, 'first')
    tracker.markRateLimited('openai', 60000, 'second')
    const result = tracker.isRateLimited('openai')
    expect(result.limited).toBe(true)
    // Should use the longer cooldown
    expect(result.retryAfterMs).toBeGreaterThan(10000)
  })

  it('resets all state', () => {
    tracker.markRateLimited('openai', 60000, 'test')
    tracker.markRateLimited('anthropic', 60000, 'test')
    tracker.reset()
    expect(tracker.isRateLimited('openai').limited).toBe(false)
    expect(tracker.isRateLimited('anthropic').limited).toBe(false)
  })
})

describe('LLMProviderRegistry', () => {
  it('has chatWithFallback method', () => {
    const registry = new LLMProviderRegistry()
    expect(registry.chatWithFallback).toBeDefined()
  })

  it('has getRateLimitTracker method', () => {
    const registry = new LLMProviderRegistry()
    expect(registry.getRateLimitTracker).toBeDefined()
    const tracker = registry.getRateLimitTracker()
    expect(tracker).toBeDefined()
  })

  it('has setFallbackConfig method', () => {
    const registry = new LLMProviderRegistry()
    expect(registry.setFallbackConfig).toBeDefined()
    registry.setFallbackConfig({ maxRetries: 5, retryDelayMs: 2000 })
  })

  it('lists all available models', () => {
    const registry = new LLMProviderRegistry()
    const models = registry.getAllModels()
    expect(models.length).toBeGreaterThan(0)
  })
})
