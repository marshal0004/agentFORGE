import { describe, it, expect } from 'vitest'

/**
 * Integration test that verifies all 12 Chef-inspired features
 * work together and export correctly.
 */

describe('Chef-Inspired Features Integration', () => {
  it('1. Hysteresis context truncation - ContextManager exports', async () => {
    const mod = await import('@/lib/context-manager')
    expect(mod.ContextManager).toBeDefined()
    expect(mod.LRUFileTracker).toBeDefined()
    expect(mod.ToolResultAbbreviator).toBeDefined()
    expect(mod.contextManager).toBeDefined()
    expect(mod.estimateTokens).toBeDefined()
    expect(mod.getModelContextWindow).toBeDefined()
  })

  it('2. LRU file injection - LRUFileTracker functional', async () => {
    const { LRUFileTracker } = await import('@/lib/context-manager')
    const tracker = new LRUFileTracker()
    tracker.touch('/src/test.ts', 'export const test = 1')
    const files = tracker.getRelevantFiles(5, 10000)
    expect(files.length).toBeGreaterThan(0)
  })

  it('3. Prompt caching - buildCachedPrompt exports', async () => {
    const mod = await import('@/lib/context-manager')
    expect(mod.buildCachedPrompt).toBeDefined()
  })

  it('4. Self-correction loop - exports', async () => {
    const mod = await import('@/lib/self-correction')
    expect(mod.SelfCorrectionLoop).toBeDefined()
    expect(mod.createDefaultValidationSteps).toBeDefined()
    expect(mod.selfCorrectionLoop).toBeDefined()
  })

  it('5. Tool result abbreviation - functional', async () => {
    const { ToolResultAbbreviator } = await import('@/lib/context-manager')
    const abbreviator = new ToolResultAbbreviator()
    const result = abbreviator.abbreviate('write_file', 'success')
    expect(result).toBeTruthy()
    expect(result.length).toBeLessThan(50)
  })

  it('6. File protection - exports', async () => {
    const mod = await import('@/lib/file-protection')
    expect(mod.FileProtectionManager).toBeDefined()
    expect(mod.fileProtectionManager).toBeDefined()
    expect(mod.DEFAULT_PROTECTED_FILES).toBeDefined()
    expect(mod.DEFAULT_PROTECTED_FILES.length).toBeGreaterThan(0)
  })

  it('7. Dual write mechanism - ArtifactWriter exports', async () => {
    const mod = await import('@/lib/artifact-writer')
    expect(mod.ArtifactParser).toBeDefined()
    expect(mod.ArtifactExecutor).toBeDefined()
  })

  it('8. Opinionated templates - TemplateEngine exports', async () => {
    const mod = await import('@/lib/template-engine')
    expect(mod.TemplateEngine).toBeDefined()
    expect(mod.REACT_TAILWIND_TEMPLATE).toBeDefined()
    expect(mod.FULLSTACK_NEXTJS_TEMPLATE).toBeDefined()
    expect(mod.API_EXPRESS_TEMPLATE).toBeDefined()
    expect(mod.REACT_TAILWIND_TEMPLATE.files.length).toBeGreaterThan(0)
  })

  it('9. Domain-specific prompt libraries - exports', async () => {
    const mod = await import('@/lib/prompt-library')
    expect(mod.PromptLibraryManager).toBeDefined()
    expect(mod.NEXTJS_LIBRARY).toBeDefined()
    expect(mod.NEXTJS_LIBRARY.content.length).toBeGreaterThan(100)
    expect(mod.TYPESCRIPT_LIBRARY).toBeDefined()
    expect(mod.TAILWIND_LIBRARY).toBeDefined()
    expect(mod.PRISMA_LIBRARY).toBeDefined()
    expect(mod.REACT_PATTERNS_LIBRARY).toBeDefined()
  })

  it('10. Provider fallback chains - RateLimitTracker exports', async () => {
    const mod = await import('@/lib/llm-provider')
    expect(mod.RateLimitTracker).toBeDefined()
    expect(mod.llmProviderRegistry).toBeDefined()
  })

  it('11. Message compression - exports', async () => {
    const mod = await import('@/lib/message-compression')
    expect(mod.MessageCompressor).toBeDefined()
    expect(mod.messageCompressor).toBeDefined()
  })

  it('12. Subchats - SubchatManager exports', async () => {
    const mod = await import('@/lib/subchat-manager')
    expect(mod.SubchatManager).toBeDefined()
    expect(mod.subchatManager).toBeDefined()
  })

  it('Cross-module integration: template → context → protection → compression', async () => {
    const { TemplateEngine, REACT_TAILWIND_TEMPLATE } = await import('@/lib/template-engine')
    const { LRUFileTracker } = await import('@/lib/context-manager')
    const { FileProtectionManager, DEFAULT_PROTECTED_FILES } = await import('@/lib/file-protection')
    const { MessageCompressor } = await import('@/lib/message-compression')

    // 1. Create a template engine
    const engine = new TemplateEngine()
    engine.registerTemplate(REACT_TAILWIND_TEMPLATE)

    // 2. Track template files in LRU
    const tracker = new LRUFileTracker()
    for (const file of REACT_TAILWIND_TEMPLATE.files) {
      tracker.touch(file.path, file.content)
    }
    const relevantFiles = tracker.getRelevantFiles(16, 50000)
    expect(relevantFiles.length).toBeGreaterThan(0)

    // 3. Check file protection
    const protection = new FileProtectionManager(DEFAULT_PROTECTED_FILES)
    const packageJsonWrite = protection.canWrite('package.json')
    expect(packageJsonWrite.allowed).toBe(false)
    const appPageWrite = protection.canWrite('src/app/page.tsx')
    expect(appPageWrite.allowed).toBe(true)

    // 4. Compress a conversation
    const compressor = new MessageCompressor()
    const messages = REACT_TAILWIND_TEMPLATE.files.map(f => ({
      role: 'assistant' as const,
      content: `### FILE: ${f.path}\n${f.content}`,
    }))
    const compressed = compressor.compressMessages(messages)
    expect(compressed.compressedData).toBeTruthy()
    const decompressed = compressor.decompressMessages(compressed)
    expect(decompressed.length).toBe(messages.length)
  })
})
