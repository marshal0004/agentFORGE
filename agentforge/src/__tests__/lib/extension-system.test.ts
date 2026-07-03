/**
 * Unit tests for the Extension System
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ExtensionSystem, ExtensionManifest, HookContext, CustomToolDefinition } from '@/lib/extension-system'

describe('ExtensionSystem', () => {
  let extSystem: ExtensionSystem

  beforeEach(() => {
    extSystem = new ExtensionSystem()
  })

  afterEach(() => {
    // Clean up all extensions
    const extensions = extSystem.getAllExtensions()
    for (const ext of extensions) {
      extSystem.unregisterExtension(ext.manifest.id)
    }
  })

  describe('registerExtension', () => {
    it('should register an extension with hooks', () => {
      const manifest: ExtensionManifest = {
        id: 'test-ext',
        name: 'Test Extension',
        version: '1.0.0',
        hooks: {
          beforeChat: vi.fn(),
          afterChat: vi.fn(),
        },
      }

      extSystem.registerExtension(manifest)

      expect(extSystem.isExtensionEnabled('test-ext')).toBe(true)
      expect(extSystem.getExtension('test-ext')).toBeDefined()
    })

    it('should register an extension with custom tools', () => {
      const tool: CustomToolDefinition = {
        name: 'custom_tool',
        description: 'A custom tool for testing',
        parameters: {
          type: 'object',
          properties: {
            input: { type: 'string', description: 'Input text' },
          },
          required: ['input'],
        },
        handler: vi.fn().mockResolvedValue({ result: 'processed' }),
      }

      const manifest: ExtensionManifest = {
        id: 'tool-ext',
        name: 'Tool Extension',
        version: '1.0.0',
        tools: [tool],
      }

      extSystem.registerExtension(manifest)

      expect(extSystem.isCustomTool('custom_tool')).toBe(true)
      expect(extSystem.getCustomTool('custom_tool')).toBeDefined()
      expect(extSystem.getCustomTools()).toHaveLength(1)
    })

    it('should not register duplicate tool names', () => {
      const tool1: CustomToolDefinition = {
        name: 'duplicate_tool',
        description: 'First version',
        parameters: { type: 'object', properties: {} },
        handler: vi.fn(),
      }
      const tool2: CustomToolDefinition = {
        name: 'duplicate_tool',
        description: 'Second version',
        parameters: { type: 'object', properties: {} },
        handler: vi.fn(),
      }

      extSystem.registerExtension({ id: 'ext1', name: 'Ext 1', version: '1.0.0', tools: [tool1] })
      extSystem.registerExtension({ id: 'ext2', name: 'Ext 2', version: '1.0.0', tools: [tool2] })

      // Should still have only one tool (the first registration wins)
      expect(extSystem.getCustomTools()).toHaveLength(1)
      expect(extSystem.getCustomTool('duplicate_tool')!.description).toBe('First version')
    })
  })

  describe('unregisterExtension', () => {
    it('should remove hooks and tools when unregistered', () => {
      const tool: CustomToolDefinition = {
        name: 'removable_tool',
        description: 'Will be removed',
        parameters: { type: 'object', properties: {} },
        handler: vi.fn(),
      }

      extSystem.registerExtension({
        id: 'removable',
        name: 'Removable',
        version: '1.0.0',
        hooks: { beforeChat: vi.fn() },
        tools: [tool],
      })

      expect(extSystem.isCustomTool('removable_tool')).toBe(true)

      extSystem.unregisterExtension('removable')

      expect(extSystem.isCustomTool('removable_tool')).toBe(false)
      expect(extSystem.getExtension('removable')).toBeUndefined()
    })
  })

  describe('enable/disable', () => {
    it('should disable an extension', () => {
      extSystem.registerExtension({
        id: 'toggle-ext',
        name: 'Toggle',
        version: '1.0.0',
      })

      extSystem.disableExtension('toggle-ext')
      expect(extSystem.isExtensionEnabled('toggle-ext')).toBe(false)
    })

    it('should re-enable a disabled extension', () => {
      extSystem.registerExtension({
        id: 'toggle-ext',
        name: 'Toggle',
        version: '1.0.0',
      })

      extSystem.disableExtension('toggle-ext')
      extSystem.enableExtension('toggle-ext')
      expect(extSystem.isExtensionEnabled('toggle-ext')).toBe(true)
    })
  })

  describe('executeHooks', () => {
    it('should execute hooks in priority order', async () => {
      const order: string[] = []

      extSystem.registerExtension({
        id: 'low-priority',
        name: 'Low Priority',
        version: '1.0.0',
        priority: 100,
        hooks: {
          beforeChat: vi.fn().mockImplementation(() => {
            order.push('low')
          }),
        },
      })

      extSystem.registerExtension({
        id: 'high-priority',
        name: 'High Priority',
        version: '1.0.0',
        priority: 1,
        hooks: {
          beforeChat: vi.fn().mockImplementation(() => {
            order.push('high')
          }),
        },
      })

      await extSystem.executeHooks('beforeChat', { model: 'test' })
      expect(order).toEqual(['high', 'low'])
    })

    it('should allow hooks to modify context', async () => {
      extSystem.registerExtension({
        id: 'modifier',
        name: 'Modifier',
        version: '1.0.0',
        hooks: {
          beforeChat: vi.fn().mockImplementation((ctx: HookContext) => {
            return { ...ctx, model: 'modified-model' }
          }),
        },
      })

      const result = await extSystem.executeHooks('beforeChat', { model: 'original' })
      expect(result.model).toBe('modified-model')
    })

    it('should isolate errors from one hook to the next', async () => {
      const goodHook = vi.fn().mockResolvedValue(undefined)

      extSystem.registerExtension({
        id: 'bad-ext',
        name: 'Bad',
        version: '1.0.0',
        hooks: {
          beforeChat: vi.fn().mockImplementation(() => {
            throw new Error('Hook crashed!')
          }),
        },
      })

      extSystem.registerExtension({
        id: 'good-ext',
        name: 'Good',
        version: '1.0.0',
        hooks: { beforeChat: goodHook },
      })

      // Should not throw
      const result = await extSystem.executeHooks('beforeChat', { model: 'test' })
      expect(result).toBeDefined()
    })

    it('should skip hooks from disabled extensions', async () => {
      const hook = vi.fn()

      extSystem.registerExtension({
        id: 'disabled-ext',
        name: 'Disabled',
        version: '1.0.0',
        hooks: { beforeChat: hook },
      })

      extSystem.disableExtension('disabled-ext')
      await extSystem.executeHooks('beforeChat', { model: 'test' })

      expect(hook).not.toHaveBeenCalled()
    })
  })

  describe('executeCustomTool', () => {
    it('should execute a custom tool', async () => {
      const handler = vi.fn().mockResolvedValue({ processed: true })

      extSystem.registerExtension({
        id: 'tool-ext',
        name: 'Tool Ext',
        version: '1.0.0',
        tools: [{
          name: 'process_data',
          description: 'Process some data',
          parameters: {
            type: 'object',
            properties: {
              input: { type: 'string', description: 'Input data' },
            },
            required: ['input'],
          },
          handler,
        }],
      })

      const result = await extSystem.executeCustomTool('process_data', { input: 'test data' })
      expect(result.success).toBe(true)
      expect(handler).toHaveBeenCalledWith({ input: 'test data' })
    })

    it('should reject missing required parameters', async () => {
      extSystem.registerExtension({
        id: 'tool-ext',
        name: 'Tool Ext',
        version: '1.0.0',
        tools: [{
          name: 'strict_tool',
          description: 'Requires input',
          parameters: {
            type: 'object',
            properties: {
              input: { type: 'string', description: 'Required input' },
            },
            required: ['input'],
          },
          handler: vi.fn(),
        }],
      })

      const result = await extSystem.executeCustomTool('strict_tool', {})
      expect(result.success).toBe(false)
      expect((result.result as { error: string }).error).toContain('Missing required parameter')
    })

    it('should return error for unknown tools', async () => {
      const result = await extSystem.executeCustomTool('nonexistent', {})
      expect(result.success).toBe(false)
    })

    it('should not execute tools from disabled extensions', async () => {
      extSystem.registerExtension({
        id: 'tool-ext',
        name: 'Tool Ext',
        version: '1.0.0',
        tools: [{
          name: 'disabled_tool',
          description: 'Disabled',
          parameters: { type: 'object', properties: {} },
          handler: vi.fn(),
        }],
      })

      extSystem.disableExtension('tool-ext')
      const result = await extSystem.executeCustomTool('disabled_tool', {})
      expect(result.success).toBe(false)
    })

    it('should handle tool handler errors gracefully', async () => {
      extSystem.registerExtension({
        id: 'error-ext',
        name: 'Error Ext',
        version: '1.0.0',
        tools: [{
          name: 'failing_tool',
          description: 'Always fails',
          parameters: { type: 'object', properties: {} },
          handler: vi.fn().mockRejectedValue(new Error('Tool crashed')),
        }],
      })

      const result = await extSystem.executeCustomTool('failing_tool', {})
      expect(result.success).toBe(false)
      expect((result.result as { error: string }).error).toContain('Tool crashed')
    })
  })

  describe('getAllExtensions', () => {
    it('should list all registered extensions', () => {
      extSystem.registerExtension({ id: 'ext1', name: 'Extension 1', version: '1.0.0' })
      extSystem.registerExtension({ id: 'ext2', name: 'Extension 2', version: '2.0.0' })

      const all = extSystem.getAllExtensions()
      expect(all).toHaveLength(2)
    })
  })
})
