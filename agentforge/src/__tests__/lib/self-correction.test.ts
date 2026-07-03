import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/event-bus', () => ({
  agentEventBus: { emit: vi.fn(), on: vi.fn(() => () => {}) },
}))

vi.mock('@/lib/file-protection', () => ({
  fileProtectionManager: {
    filterWriteOperations: vi.fn((files) => ({ allowed: files, blocked: [] })),
  },
}))

vi.mock('@/lib/llm-provider', () => ({
  llmProviderRegistry: {
    getProviderForModel: vi.fn(),
    chatWithFallback: vi.fn(),
  },
}))

import { SelfCorrectionLoop, createDefaultValidationSteps } from '@/lib/self-correction'

describe('SelfCorrectionLoop', () => {
  it('formatErrorsForPrompt produces clear error descriptions', () => {
    const loop = new SelfCorrectionLoop()
    const errors = [
      { file: 'src/App.tsx', line: 10, column: 5, severity: 'error' as const, message: "Type 'string' is not assignable to type 'number'" },
      { file: 'src/utils.ts', line: 25, severity: 'warning' as const, message: "Variable 'x' is declared but never used" },
    ]
    const prompt = loop.formatErrorsForPrompt(errors)
    expect(prompt).toContain('src/App.tsx')
    expect(prompt).toContain('Type')
    expect(prompt).toContain('src/utils.ts')
  })

  it('createDefaultValidationSteps returns tsc, eslint, prettier', () => {
    const steps = createDefaultValidationSteps('/tmp/project')
    expect(steps.length).toBe(3)
    expect(steps.map(s => s.name)).toContain('typescript')
    expect(steps.map(s => s.name)).toContain('eslint')
    expect(steps.map(s => s.name)).toContain('prettier')
  })

  it('creates instance with default config', () => {
    const loop = new SelfCorrectionLoop()
    expect(loop).toBeDefined()
  })

  it('creates instance with custom config', () => {
    const loop = new SelfCorrectionLoop({ maxIterations: 5 })
    expect(loop).toBeDefined()
  })
})
