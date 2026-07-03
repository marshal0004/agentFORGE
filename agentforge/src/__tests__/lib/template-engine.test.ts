import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/event-bus', () => ({
  agentEventBus: { emit: vi.fn(), on: vi.fn(() => () => {}) },
}))

vi.mock('@/lib/filesystem', () => ({
  writeProjectFiles: vi.fn(() => Promise.resolve({ written: 5, errors: [] })),
}))

import { TemplateEngine, REACT_TAILWIND_TEMPLATE, FULLSTACK_NEXTJS_TEMPLATE, API_EXPRESS_TEMPLATE } from '@/lib/template-engine'

describe('TemplateEngine', () => {
  let engine: TemplateEngine

  beforeEach(() => {
    engine = new TemplateEngine()
    // Register built-in templates
    engine.registerTemplate(REACT_TAILWIND_TEMPLATE)
    engine.registerTemplate(FULLSTACK_NEXTJS_TEMPLATE)
    engine.registerTemplate(API_EXPRESS_TEMPLATE)
  })

  it('registers and retrieves templates', () => {
    const template = engine.getTemplate('react-tailwind')
    expect(template).toBeDefined()
    expect(template?.name).toBeTruthy()
  })

  it('lists all registered templates', () => {
    const list = engine.listTemplates()
    expect(list.length).toBeGreaterThanOrEqual(3)
    expect(list.some(t => t.id === 'react-tailwind')).toBe(true)
    expect(list.some(t => t.id === 'fullstack-nextjs')).toBe(true)
    expect(list.some(t => t.id === 'api-express')).toBe(true)
  })

  it('has files in each template', () => {
    const templates = [REACT_TAILWIND_TEMPLATE, FULLSTACK_NEXTJS_TEMPLATE, API_EXPRESS_TEMPLATE]
    for (const tmpl of templates) {
      expect(tmpl.files.length).toBeGreaterThan(0)
      for (const file of tmpl.files) {
        expect(file.path).toBeTruthy()
        expect(file.content.length).toBeGreaterThan(0)
      }
    }
  })

  it('has locked files defined', () => {
    expect(REACT_TAILWIND_TEMPLATE.lockedFiles.length).toBeGreaterThan(0)
    expect(FULLSTACK_NEXTJS_TEMPLATE.lockedFiles.length).toBeGreaterThan(0)
  })

  it('has prewarmed files defined', () => {
    expect(REACT_TAILWIND_TEMPLATE.prewarmedFiles.length).toBeGreaterThan(0)
  })

  it('returns system prompt addition for templates', () => {
    const addition = engine.getSystemPromptAddition('react-tailwind')
    expect(addition).toBeTruthy()
  })

  it('creates a project from a template', async () => {
    const result = await engine.createProject('react-tailwind', 'test-project-123', 'My App')
    expect(result.filesWritten).toBeGreaterThan(0)
  })

  it('handles variable interpolation in templates', async () => {
    const result = await engine.createProject('react-tailwind', 'test-project-456', 'TestApp')
    // The template should have replaced {{projectName}} with TestApp
    expect(result.filesWritten).toBeGreaterThan(0)
  })

  it('returns undefined for non-existent template', () => {
    expect(engine.getTemplate('non-existent')).toBeUndefined()
  })
})
