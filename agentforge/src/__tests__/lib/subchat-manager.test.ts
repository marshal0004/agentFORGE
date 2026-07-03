import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/event-bus', () => ({
  agentEventBus: { emit: vi.fn(), on: vi.fn(() => () => {}) },
}))

import { SubchatManager, subchatManager } from '@/lib/subchat-manager'

describe('SubchatManager', () => {
  let manager: SubchatManager

  beforeEach(() => {
    manager = new SubchatManager()
  })

  it('creates a subchat from a parent chat', () => {
    const subchat = manager.createSubchat('parent-1', 5, 'Bug investigation')
    expect(subchat).toBeDefined()
    expect(subchat.parentChatId).toBe('parent-1')
    expect(subchat.parentMessageIndex).toBe(5)
    expect(subchat.title).toBe('Bug investigation')
    expect(subchat.status).toBe('active')
  })

  it('auto-generates title if not provided', () => {
    const subchat = manager.createSubchat('parent-1', 3)
    expect(subchat.title).toBeTruthy()
  })

  it('adds messages to an active subchat', () => {
    const subchat = manager.createSubchat('parent-1', 0)
    manager.addMessage(subchat.id, 'user', 'What about this approach?')
    manager.addMessage(subchat.id, 'assistant', 'That could work, let me try...')
    
    const retrieved = manager.getSubchat(subchat.id)
    expect(retrieved?.messages.length).toBe(2)
    expect(retrieved?.messages[0].role).toBe('user')
  })

  it('resolves a subchat', () => {
    const subchat = manager.createSubchat('parent-1', 0)
    manager.resolveSubchat(subchat.id)
    
    const retrieved = manager.getSubchat(subchat.id)
    expect(retrieved?.status).toBe('resolved')
  })

  it('abandons a subchat', () => {
    const subchat = manager.createSubchat('parent-1', 0)
    manager.abandonSubchat(subchat.id)
    
    const retrieved = manager.getSubchat(subchat.id)
    expect(retrieved?.status).toBe('abandoned')
  })

  it('lists subchats for a parent chat', () => {
    const sub1 = manager.createSubchat('parent-1', 0)
    manager.resolveSubchat(sub1.id) // Must resolve before creating another for same parent
    manager.createSubchat('parent-1', 5)
    manager.createSubchat('parent-2', 0)
    
    const list = manager.listSubchats('parent-1')
    expect(list.length).toBe(2)
  })

  it('getActiveSubchat returns the active subchat for a parent', () => {
    const subchat = manager.createSubchat('parent-1', 0)
    const active = manager.getActiveSubchat('parent-1')
    expect(active?.id).toBe(subchat.id)
  })

  it('returns undefined for non-existent subchat', () => {
    expect(manager.getSubchat('non-existent')).toBeUndefined()
  })

  it('getSubchatContext returns formatted context', () => {
    const subchat = manager.createSubchat('parent-1', 0)
    manager.addMessage(subchat.id, 'user', 'Test question')
    manager.addMessage(subchat.id, 'assistant', 'Test answer')
    
    const context = manager.getSubchatContext(subchat.id)
    expect(context).toContain('Test question')
    expect(context).toContain('Test answer')
  })

  it('reset clears all subchats', () => {
    manager.createSubchat('parent-1', 0)
    manager.createSubchat('parent-2', 0)
    manager.reset()
    
    expect(manager.listSubchats('parent-1').length).toBe(0)
    expect(manager.listSubchats('parent-2').length).toBe(0)
  })

  it('exports singleton', () => {
    expect(subchatManager).toBeDefined()
  })
})
