import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/event-bus', () => ({
  agentEventBus: {
    emit: vi.fn(),
    on: vi.fn(() => () => {}),
  },
}))

import {
  FileProtectionManager,
  DEFAULT_PROTECTED_FILES,
  fileProtectionManager,
} from '@/lib/file-protection'

describe('DEFAULT_PROTECTED_FILES', () => {
  it('covers critical Next.js files', () => {
    const patterns = DEFAULT_PROTECTED_FILES.map(r => r.pattern)
    expect(patterns.some(p => String(p).includes('next.config'))).toBe(true)
    expect(patterns.some(p => String(p).includes('package.json'))).toBe(true)
    expect(patterns.some(p => String(p).includes('tsconfig'))).toBe(true)
  })
})

describe('FileProtectionManager', () => {
  let manager: FileProtectionManager

  beforeEach(() => {
    manager = new FileProtectionManager(DEFAULT_PROTECTED_FILES)
  })

  it('blocks writing to protected files', () => {
    const result = manager.canWrite('next.config.ts')
    expect(result.allowed).toBe(false)
    expect(result.reason).toBeTruthy()
  })

  it('blocks writing to package.json', () => {
    const result = manager.canWrite('package.json')
    expect(result.allowed).toBe(false)
  })

  it('blocks writing to .env files', () => {
    const result = manager.canWrite('.env.local')
    expect(result.allowed).toBe(false)
  })

  it('allows writing to non-protected files', () => {
    const result = manager.canWrite('src/app/page.tsx')
    expect(result.allowed).toBe(true)
  })

  it('allows reading protected files by default', () => {
    const result = manager.canRead('next.config.ts')
    expect(result.allowed).toBe(true)
  })

  it('blocks reading .env files', () => {
    const result = manager.canRead('.env.local')
    expect(result.allowed).toBe(false)
  })

  it('filterWriteOperations separates allowed from blocked', () => {
    const files = [
      { path: 'src/app/page.tsx', content: 'export default function Page() {}' },
      { path: 'package.json', content: '{"name": "test"}' },
      { path: 'src/components/Button.tsx', content: 'export const Button = () => {}' },
      { path: '.env', content: 'SECRET=123' },
    ]
    const result = manager.filterWriteOperations(files)
    expect(result.allowed.length).toBe(2)
    expect(result.blocked.length).toBe(2)
    expect(result.allowed.map(f => f.path)).toContain('src/app/page.tsx')
    expect(result.blocked.map(f => f.path)).toContain('package.json')
  })

  it('addRule adds a new protection rule', () => {
    manager.addRule({
      pattern: 'custom.config.js',
      reason: 'Custom config',
      allowRead: true,
      allowWrite: false,
    })
    const result = manager.canWrite('custom.config.js')
    expect(result.allowed).toBe(false)
  })

  it('removeRule removes a protection rule', () => {
    manager.removeRule('package.json')
    const result = manager.canWrite('package.json')
    expect(result.allowed).toBe(true)
  })

  it('handles glob patterns with *', () => {
    const result = manager.canWrite('next.config.mjs')
    expect(result.allowed).toBe(false)
  })

  it('getRules returns all rules', () => {
    const rules = manager.getRules()
    expect(rules.length).toBeGreaterThan(0)
  })
})
