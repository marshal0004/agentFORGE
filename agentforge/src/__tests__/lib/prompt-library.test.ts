import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  PromptLibraryManager,
  NEXTJS_LIBRARY,
  TYPESCRIPT_LIBRARY,
  TAILWIND_LIBRARY,
  PRISMA_LIBRARY,
  REACT_PATTERNS_LIBRARY,
} from '@/lib/prompt-library'

describe('Built-in Prompt Libraries', () => {
  it('Next.js library has substantial content', () => {
    expect(NEXTJS_LIBRARY.content.length).toBeGreaterThan(500)
    expect(NEXTJS_LIBRARY.domain).toBe('nextjs')
    expect(NEXTJS_LIBRARY.tokenEstimate).toBeGreaterThan(500)
  })

  it('TypeScript library has substantial content', () => {
    expect(TYPESCRIPT_LIBRARY.content.length).toBeGreaterThan(500)
    expect(TYPESCRIPT_LIBRARY.domain).toBe('typescript')
  })

  it('Tailwind library has substantial content', () => {
    expect(TAILWIND_LIBRARY.content.length).toBeGreaterThan(500)
  })

  it('Prisma library has substantial content', () => {
    expect(PRISMA_LIBRARY.content.length).toBeGreaterThan(500)
  })

  it('React patterns library has substantial content', () => {
    expect(REACT_PATTERNS_LIBRARY.content.length).toBeGreaterThan(500)
  })
})

describe('PromptLibraryManager', () => {
  let manager: PromptLibraryManager

  beforeEach(() => {
    manager = new PromptLibraryManager()
    manager.registerLibrary(NEXTJS_LIBRARY)
    manager.registerLibrary(TYPESCRIPT_LIBRARY)
    manager.registerLibrary(TAILWIND_LIBRARY)
    manager.registerLibrary(PRISMA_LIBRARY)
    manager.registerLibrary(REACT_PATTERNS_LIBRARY)
  })

  it('registers and retrieves libraries', () => {
    const relevant = manager.getRelevantLibraries('Build a Next.js app with TypeScript', 10000)
    expect(relevant.length).toBeGreaterThan(0)
  })

  it('builds system prompt within token budget', () => {
    const result = manager.buildSystemPrompt(
      'You are a helpful assistant.',
      'Create a Next.js app with Prisma database',
      5000,
    )
    expect(result.systemPrompt).toBeTruthy()
    expect(result.systemPrompt.length).toBeGreaterThan(0)
    expect(result.includedLibraries.length).toBeGreaterThan(0)
    expect(result.estimatedTokens).toBeGreaterThan(0)
  })

  it('includes relevant libraries based on task description', () => {
    const result = manager.buildSystemPrompt(
      'Base prompt',
      'Build a Next.js application with Prisma',
      10000,
    )
    expect(result.includedLibraries).toContain('nextjs')
  })

  it('respects token budget by dropping lower-priority libraries', () => {
    const smallBudget = 1000 // Very small
    const result = manager.buildSystemPrompt(
      'Base prompt',
      'Build a full-stack app',
      smallBudget,
    )
    // Should include some but not all libraries
    expect(result.includedLibraries.length).toBeLessThan(5)
  })
})
