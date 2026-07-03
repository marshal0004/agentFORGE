import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/event-bus', () => ({
  agentEventBus: { emit: vi.fn(), on: vi.fn(() => () => {}) },
}))

import { MessageCompressor, messageCompressor } from '@/lib/message-compression'

describe('MessageCompressor', () => {
  let compressor: MessageCompressor

  beforeEach(() => {
    compressor = new MessageCompressor()
  })

  it('compresses and decompresses English text roundtrip', () => {
    const original = 'Hello world! This is a test of the message compression system. It should compress and decompress correctly.'
    const compressed = compressor.compress(original)
    expect(compressed.compressedData).toBeTruthy()
    expect(compressed.originalSize).toBeGreaterThan(0)
    
    const decompressed = compressor.decompress(compressed)
    expect(decompressed).toBe(original)
  })

  it('compresses and decompresses code roundtrip', () => {
    const original = `
function hello(name: string): string {
  return \`Hello, \${name}!\`;
}

const result = hello("World");
console.log(result);
`
    const compressed = compressor.compress(original)
    const decompressed = compressor.decompress(compressed)
    expect(decompressed).toBe(original)
  })

  it('compresses and decompresses message arrays', () => {
    const messages = [
      { role: 'user', content: 'Build me a todo app' },
      { role: 'assistant', content: 'I will create a todo application for you...' },
      { role: 'user', content: 'Add dark mode support' },
    ]
    const compressed = compressor.compressMessages(messages)
    const decompressed = compressor.decompressMessages(compressed)
    expect(decompressed).toEqual(messages)
  })

  it('calculates compression ratio', () => {
    const original = 'x'.repeat(1000)
    const compressed = compressor.compress(original)
    expect(compressed.compressionRatio).toBeGreaterThan(0)
    expect(compressed.compressionRatio).toBeLessThanOrEqual(1)
  })

  it('shouldCompress returns false for very small strings', () => {
    expect(compressor.shouldCompress('hi')).toBe(false)
  })

  it('shouldCompress returns true for large repetitive text', () => {
    const text = 'Lorem ipsum '.repeat(100)
    expect(compressor.shouldCompress(text)).toBe(true)
  })

  it('exports singleton', () => {
    expect(messageCompressor).toBeDefined()
    expect(messageCompressor).toBeInstanceOf(MessageCompressor)
  })
})
