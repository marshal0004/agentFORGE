/**
 * Unit tests for the Typed Agent Event System
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventBus, AgentEventName, EventRecord } from '@/lib/event-bus'

describe('EventBus', () => {
  let bus: EventBus

  beforeEach(() => {
    bus = new EventBus(100)
  })

  afterEach(() => {
    bus.removeAllListeners()
  })

  describe('on() and emit()', () => {
    it('should emit events to subscribed listeners', async () => {
      const listener = vi.fn()
      bus.on('agent:start', listener)

      await bus.emit('agent:start', {
        sessionId: 'test-1',
        projectId: 'proj-1',
        model: 'glm-4-flash',
      })

      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'test-1', model: 'glm-4-flash' }),
        'agent:start',
        expect.any(Number),
      )
    })

    it('should support multiple listeners for the same event', async () => {
      const listener1 = vi.fn()
      const listener2 = vi.fn()

      bus.on('tool:call', listener1)
      bus.on('tool:call', listener2)

      await bus.emit('tool:call', {
        toolName: 'read_file',
        params: { path: '/test.ts' },
        source: 'builtin',
        parallel: false,
      })

      expect(listener1).toHaveBeenCalledTimes(1)
      expect(listener2).toHaveBeenCalledTimes(1)
    })

    it('should not deliver events to listeners of other events', async () => {
      const listener = vi.fn()
      bus.on('agent:start', listener)

      await bus.emit('tool:call', {
        toolName: 'read_file',
        params: {},
        source: 'builtin',
        parallel: false,
      })

      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('unsubscribe', () => {
    it('should unsubscribe via the returned function', async () => {
      const listener = vi.fn()
      const unsub = bus.on('agent:error', listener)

      unsub()

      await bus.emit('agent:error', {
        sessionId: 'test-1',
        error: 'test error',
        phase: 'streaming',
      })

      expect(listener).not.toHaveBeenCalled()
    })

    it('should unsubscribe via off()', async () => {
      const listener = vi.fn()
      bus.on('agent:error', listener)
      bus.off('agent:error', listener)

      await bus.emit('agent:error', {
        sessionId: 'test-1',
        error: 'test error',
        phase: 'streaming',
      })

      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('once()', () => {
    it('should fire only once', async () => {
      const listener = vi.fn()
      bus.once('agent:start', listener)

      await bus.emit('agent:start', { sessionId: '1', model: 'test' })
      await bus.emit('agent:start', { sessionId: '2', model: 'test' })

      expect(listener).toHaveBeenCalledTimes(1)
    })
  })

  describe('onAny() — wildcard', () => {
    it('should receive all events', async () => {
      const wildcard = vi.fn()
      bus.onAny(wildcard)

      await bus.emit('agent:start', { sessionId: '1', model: 'test' })
      await bus.emit('tool:call', { toolName: 'test', params: {}, source: 's', parallel: false })

      expect(wildcard).toHaveBeenCalledTimes(2)
    })
  })

  describe('event history', () => {
    it('should record event history', async () => {
      await bus.emit('agent:start', { sessionId: '1', model: 'test' })
      await bus.emit('tool:call', { toolName: 'test', params: {}, source: 's', parallel: false })

      const history = bus.getHistory()
      expect(history).toHaveLength(2)
      expect(history[0].event).toBe('agent:start')
      expect(history[1].event).toBe('tool:call')
    })

    it('should filter history by event name', async () => {
      await bus.emit('agent:start', { sessionId: '1', model: 'test' })
      await bus.emit('agent:complete', { sessionId: '1', iterations: 3 })
      await bus.emit('agent:start', { sessionId: '2', model: 'test' })

      const startHistory = bus.getHistory('agent:start')
      expect(startHistory).toHaveLength(2)
    })

    it('should limit history results', async () => {
      await bus.emit('agent:start', { sessionId: '1', model: 'test' })
      await bus.emit('agent:start', { sessionId: '2', model: 'test' })
      await bus.emit('agent:start', { sessionId: '3', model: 'test' })

      const limited = bus.getHistory('agent:start', 2)
      expect(limited).toHaveLength(2)
    })
  })

  describe('replay()', () => {
    it('should replay past events to a listener', async () => {
      await bus.emit('agent:start', { sessionId: '1', model: 'test' })
      await bus.emit('agent:start', { sessionId: '2', model: 'test' })

      const replayListener = vi.fn()
      await bus.replay('agent:start', replayListener)

      expect(replayListener).toHaveBeenCalledTimes(2)
    })
  })

  describe('error isolation', () => {
    it('should not crash when a listener throws', async () => {
      const goodListener = vi.fn()
      const badListener = vi.fn().mockImplementation(() => {
        throw new Error('Listener error')
      })

      bus.on('agent:start', badListener)
      bus.on('agent:start', goodListener)

      // Should not throw
      await bus.emit('agent:start', { sessionId: '1', model: 'test' })

      expect(goodListener).toHaveBeenCalled()
    })
  })

  describe('diagnostics', () => {
    it('should count listeners', () => {
      bus.on('agent:start', vi.fn())
      bus.on('agent:start', vi.fn())
      bus.on('tool:call', vi.fn())

      expect(bus.listenerCount('agent:start')).toBe(2)
      expect(bus.listenerCount('tool:call')).toBe(1)
      expect(bus.listenerCount()).toBe(3)
    })

    it('should list event names with listeners', () => {
      bus.on('agent:start', vi.fn())
      bus.on('tool:call', vi.fn())

      const names = bus.eventNames()
      expect(names).toContain('agent:start')
      expect(names).toContain('tool:call')
    })

    it('should remove all listeners', () => {
      bus.on('agent:start', vi.fn())
      bus.on('tool:call', vi.fn())
      bus.onAny(vi.fn())

      bus.removeAllListeners()
      expect(bus.listenerCount()).toBe(0)
    })
  })

  describe('history compaction', () => {
    it('should compact history when exceeding maxHistory', async () => {
      const smallBus = new EventBus(10)

      // Emit 15 events
      for (let i = 0; i < 15; i++) {
        await smallBus.emit('agent:start', { sessionId: `s-${i}`, model: 'test' })
      }

      const history = smallBus.getHistory()
      // After compaction, should have about half the max
      expect(history.length).toBeLessThanOrEqual(10)
      expect(history.length).toBeGreaterThan(0)
    })
  })
})
