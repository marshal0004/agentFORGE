/**
 * Unit tests for Multi-Provider LLM Registry
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  LLMProviderRegistry,
  LLMProvider,
  ChatOptions,
  ChatResponse,
  StreamChunk,
  ProviderConfig,
} from '@/lib/llm-provider'

describe('LLMProviderRegistry', () => {
  let registry: LLMProviderRegistry

  beforeEach(() => {
    registry = new LLMProviderRegistry()
  })

  describe('default ZAI provider', () => {
    it('should have the ZAI provider registered by default', () => {
      const provider = registry.getProvider('zai')
      expect(provider).toBeDefined()
      expect(provider!.id).toBe('zai')
      expect(provider!.name).toContain('GLM')
    })

    it('should list GLM models', () => {
      const provider = registry.getProvider('zai')
      expect(provider!.models).toContain('glm-4-flash')
      expect(provider!.models).toContain('glm-4-plus')
    })
  })

  describe('registerProvider', () => {
    it('should register a custom provider', () => {
      const mockProvider: LLMProvider = {
        id: 'test-provider',
        name: 'Test Provider',
        models: ['test-model-1', 'test-model-2'],
        available: true,
        priority: 10,
        chat: vi.fn().mockResolvedValue({
          content: 'test response',
          model: 'test-model-1',
          provider: 'test-provider',
          finishReason: 'stop',
        }),
        chatStream: vi.fn(),
      }

      registry.registerProvider(mockProvider)
      expect(registry.getProvider('test-provider')).toBeDefined()
    })
  })

  describe('registerOpenAICompatible', () => {
    it('should register an OpenAI-compatible provider from config', () => {
      registry.registerOpenAICompatible({
        id: 'custom-openai',
        name: 'Custom OpenAI',
        apiKey: 'test-key',
        baseUrl: 'https://api.example.com/v1',
        models: ['custom-model'],
        priority: 5,
      })

      const provider = registry.getProvider('custom-openai')
      expect(provider).toBeDefined()
      expect(provider!.models).toContain('custom-model')
      expect(provider!.available).toBe(true)
    })

    it('should mark provider as unavailable without API key', () => {
      registry.registerOpenAICompatible({
        id: 'no-key-provider',
        name: 'No Key Provider',
        apiKey: '',
        baseUrl: 'https://api.example.com/v1',
        models: ['model-1'],
      })

      const provider = registry.getProvider('no-key-provider')
      expect(provider!.available).toBe(false)
    })
  })

  describe('getProviderForModel', () => {
    it('should find the provider for a known model', () => {
      const provider = registry.getProviderForModel('glm-4-flash')
      expect(provider).toBeDefined()
      expect(provider!.id).toBe('zai')
    })

    it('should find provider for a custom model', () => {
      registry.registerOpenAICompatible({
        id: 'test',
        name: 'Test',
        apiKey: 'key',
        models: ['my-custom-model'],
      })

      const provider = registry.getProviderForModel('my-custom-model')
      expect(provider).toBeDefined()
      expect(provider!.id).toBe('test')
    })

    it('should fall back to default for unknown models', () => {
      const provider = registry.getProviderForModel('completely-unknown-model')
      expect(provider).toBeDefined()
      // Should fall back to ZAI
      expect(provider!.id).toBe('zai')
    })
  })

  describe('getAllModels', () => {
    it('should list all models across providers', () => {
      registry.registerOpenAICompatible({
        id: 'extra',
        name: 'Extra',
        apiKey: 'key',
        models: ['extra-model-1'],
      })

      const models = registry.getAllModels()
      expect(models.length).toBeGreaterThan(0)

      const glmModels = models.filter((m) => m.provider === 'zai')
      expect(glmModels.length).toBeGreaterThan(0)
    })
  })

  describe('setDefaultProvider', () => {
    it('should change the default provider', () => {
      registry.registerOpenAICompatible({
        id: 'new-default',
        name: 'New Default',
        apiKey: 'key',
        models: ['default-model'],
      })

      registry.setDefaultProvider('new-default')
      const defaultProvider = registry.getDefaultProvider()
      expect(defaultProvider!.id).toBe('new-default')
    })

    it('should throw for unknown provider IDs', () => {
      expect(() => registry.setDefaultProvider('nonexistent')).toThrow()
    })
  })

  describe('unregisterProvider', () => {
    it('should remove a provider', () => {
      registry.registerOpenAICompatible({
        id: 'removable',
        name: 'Removable',
        apiKey: 'key',
        models: ['removable-model'],
      })

      expect(registry.getProvider('removable')).toBeDefined()
      registry.unregisterProvider('removable')
      expect(registry.getProvider('removable')).toBeUndefined()
    })
  })

  describe('chatWithFallback', () => {
    it('should throw when all providers fail', async () => {
      // Register a provider that always fails
      const failingProvider: LLMProvider = {
        id: 'failing',
        name: 'Failing Provider',
        models: ['fail-model'],
        available: true,
        priority: 1,
        chat: vi.fn().mockRejectedValue(new Error('Provider down')),
        chatStream: vi.fn(),
      }
      registry.registerProvider(failingProvider)

      await expect(
        registry.chatWithFallback({ model: 'fail-model', messages: [] }),
      ).rejects.toThrow('All providers failed')
    })
  })
})
