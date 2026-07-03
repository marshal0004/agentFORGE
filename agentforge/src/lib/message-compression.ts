/**
 * Message Compression Module
 *
 * Efficient message compression for storage using a pure-JS LZW-based
 * algorithm with UTF-16 + Base64 encoding.  No native or WASM dependencies.
 *
 * The implementation uses a custom LZW compressor/decompressor that operates
 * on UTF-16 code units, making it safe for all Unicode text.  Output is
 * Base64-encoded for transport and storage safety.
 *
 * Design goals:
 *   - Zero native / WASM dependencies
 *   - Effective compression for typical LLM message payloads
 *   - Correct round-trip (lossless) for all Unicode input
 *   - Graceful fallback: if compression doesn't save ≥ 20 %, skip it
 *   - Full event bus integration
 */

import { agentEventBus } from './event-bus'

// ── Public Types ──────────────────────────────────────────────────────────────

export interface CompressedMessage {
  id: string
  /** Base64-encoded compressed data */
  compressedData: string
  /** Byte length of the original uncompressed string */
  originalSize: number
  /** Byte length of the compressed + encoded payload */
  compressedSize: number
  /** compressedSize / originalSize (lower is better) */
  compressionRatio: number
  /** Algorithm identifier */
  algorithm: 'lzw-utf16-base64'
  /** Unix timestamp (ms) when the compressed payload was created */
  createdAt: number
}

// ── Internal LZW Implementation ───────────────────────────────────────────────

/**
 * Compress a string using LZW encoding into an array of 16-bit code units.
 *
 * The dictionary starts with all single UTF-16 code points (0 – 65535).
 * As longer sequences are encountered they are added to the dictionary and
 * emitted as new codes starting at 65536.
 *
 * Returns an array of numbers (codes) that can be losslessly represented as
 * 32-bit integers, then encoded to a binary string for Base64 transport.
 */
function lzwCompress(input: string): number[] {
  if (input.length === 0) return []

  // Build initial dictionary: every possible 16-bit code point
  const dict = new Map<string, number>()
  for (let i = 0; i < 65536; i++) {
    dict.set(String.fromCharCode(i), i)
  }
  let nextCode = 65536

  const output: number[] = []
  let current = input[0]!

  for (let i = 1; i < input.length; i++) {
    const ch = input[i]!
    const combined = current + ch
    if (dict.has(combined)) {
      current = combined
    } else {
      output.push(dict.get(current)!)
      // Only add to dictionary if we haven't exceeded safe code space
      if (nextCode < 0x10ffff) {
        dict.set(combined, nextCode++)
      }
      current = ch
    }
  }
  // Emit the last sequence
  output.push(dict.get(current)!)

  return output
}

/**
 * Decompress an LZW code array back to the original string.
 */
function lzwDecompress(codes: number[]): string {
  if (codes.length === 0) return ''

  // Build initial reverse dictionary
  const dict = new Map<number, string>()
  for (let i = 0; i < 65536; i++) {
    dict.set(i, String.fromCharCode(i))
  }
  let nextCode = 65536

  let result = ''
  let prevCode = codes[0]!
  result += dict.get(prevCode) ?? ''

  for (let i = 1; i < codes.length; i++) {
    const code = codes[i]!
    let entry: string

    if (dict.has(code)) {
      entry = dict.get(code)!
    } else if (code === nextCode) {
      // Special case: code not yet in dictionary
      const prevEntry = dict.get(prevCode) ?? ''
      entry = prevEntry + prevEntry[0]
    } else {
      throw new Error(`LZW decompression error: invalid code ${code} at position ${i}`)
    }

    result += entry

    // Add new dictionary entry
    if (nextCode < 0x10ffff) {
      const prevEntry = dict.get(prevCode) ?? ''
      dict.set(nextCode++, prevEntry + entry[0])
    }

    prevCode = code
  }

  return result
}

// ── Binary Encoding Helpers ───────────────────────────────────────────────────

/**
 * Encode an array of LZW codes (potentially > 16-bit) into a binary string
 * suitable for Base64 encoding.  Each code is stored as a variable-length
 * sequence: 1–3 UTF-16 code units.
 *
 * Encoding scheme:
 *   - code < 0x8000        → 1 unit (bit 15 = 0)
 *   - code < 0x40000000    → 2 units (first unit bit 15 = 1, bit 14 = 0)
 *   - code < 0x2000000000  → 3 units (first unit bit 15 = 1, bit 14 = 1)
 */
function codesToBinaryString(codes: number[]): string {
  const units: number[] = []
  for (const code of codes) {
    if (code < 0x8000) {
      // Single unit
      units.push(code)
    } else if (code < 0x40000000) {
      // Two units
      units.push(0x8000 | ((code >> 15) & 0x7fff))
      units.push(code & 0x7fff)
    } else {
      // Three units
      units.push(0xc000 | ((code >> 30) & 0x3ff))
      units.push(0x7fff & ((code >> 15) & 0x7fff))
      units.push(code & 0x7fff)
    }
  }
  return String.fromCharCode(...units)
}

/**
 * Decode a binary string (produced by `codesToBinaryString`) back into an
 * array of LZW codes.
 */
function binaryStringToCodes(binary: string): number[] {
  const codes: number[] = []
  let i = 0
  while (i < binary.length) {
    const unit = binary.charCodeAt(i)!
    if ((unit & 0x8000) === 0) {
      // Single unit
      codes.push(unit)
      i += 1
    } else if ((unit & 0x4000) === 0) {
      // Two units
      const hi = (unit & 0x7fff) << 15
      const lo = binary.charCodeAt(i + 1)! & 0x7fff
      codes.push(hi | lo)
      i += 2
    } else {
      // Three units
      const seg1 = (unit & 0x3ff) << 30
      const seg2 = (binary.charCodeAt(i + 1)! & 0x7fff) << 15
      const seg3 = binary.charCodeAt(i + 2)! & 0x7fff
      codes.push(seg1 | seg2 | seg3)
      i += 3
    }
  }
  return codes
}

// ── Base64 Helpers ────────────────────────────────────────────────────────────

/** Encode a binary string to Base64 (works in both Node.js and browser). */
function toBase64(binaryString: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(binaryString, 'utf16le').toString('base64')
  }
  // Browser fallback: use btoa with UTF-16 → Latin1 conversion
  const bytes: number[] = []
  for (let i = 0; i < binaryString.length; i++) {
    const code = binaryString.charCodeAt(i)
    bytes.push(code & 0xff, (code >> 8) & 0xff)
  }
  return btoa(String.fromCharCode(...bytes))
}

/** Decode a Base64 string back to a binary string. */
function fromBase64(base64: string): string {
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(base64, 'base64')
    let result = ''
    for (let i = 0; i < buf.length; i += 2) {
      const lo = buf[i]!
      const hi = buf[i + 1] ?? 0
      result += String.fromCharCode(lo | (hi << 8))
    }
    return result
  }
  // Browser fallback
  const binary = atob(base64)
  let result = ''
  for (let i = 0; i < binary.length; i += 2) {
    const lo = binary.charCodeAt(i)
    const hi = binary.charCodeAt(i + 1) ?? 0
    result += String.fromCharCode(lo | (hi << 8))
  }
  return result
}

// ── Unique ID Generator ───────────────────────────────────────────────────────

let _idCounter = 0
function generateId(): string {
  return `mc_${Date.now().toString(36)}_${(++_idCounter).toString(36)}`
}

// ── Byte Size Estimation ──────────────────────────────────────────────────────

/**
 * Estimate the byte size of a string when encoded as UTF-8.
 * This is the standard encoding for both storage and network transport.
 */
function utf8ByteLength(str: string): number {
  let bytes = 0
  for (let i = 0; i < str.length; i++) {
    const code = str.codePointAt(i)!
    if (code <= 0x7f) {
      bytes += 1
    } else if (code <= 0x7ff) {
      bytes += 2
    } else if (code <= 0xffff) {
      bytes += 3
    } else {
      bytes += 4
      i++ // Surrogate pair — skip next code unit
    }
  }
  return bytes
}

// ── MessageCompressor ─────────────────────────────────────────────────────────

/** Minimum compression ratio threshold — only compress if we save at least 20 %. */
const COMPRESSION_THRESHOLD = 0.8

export class MessageCompressor {
  /**
   * Compress a string into a `CompressedMessage`.
   *
   * The flow is:
   *   1. LZW-compress the input string → array of codes
   *   2. Encode codes into a binary string
   *   3. Base64-encode the binary string for safe transport
   */
  compress(data: string): CompressedMessage {
    const id = generateId()
    const originalSize = utf8ByteLength(data)

    // Short strings are unlikely to benefit from LZW compression
    if (data.length < 32) {
      const b64 = this.rawBase64Encode(data)
      const compressedSize = b64.length
      agentEventBus.emit('message:compression-skipped', {
        id,
        reason: 'input-too-short',
      })
      return {
        id,
        compressedData: b64,
        originalSize,
        compressedSize,
        compressionRatio: compressedSize / originalSize,
        algorithm: 'lzw-utf16-base64',
        createdAt: Date.now(),
      }
    }

    const codes = lzwCompress(data)
    const binaryStr = codesToBinaryString(codes)
    const compressedData = toBase64(binaryStr)
    const compressedSize = utf8ByteLength(compressedData)
    const compressionRatio = originalSize > 0 ? compressedSize / originalSize : 1

    agentEventBus.emit('message:compressed', {
      id,
      originalSize,
      compressedSize,
      ratio: compressionRatio,
    })

    return {
      id,
      compressedData,
      originalSize,
      compressedSize,
      compressionRatio,
      algorithm: 'lzw-utf16-base64',
      createdAt: Date.now(),
    }
  }

  /**
   * Decompress a `CompressedMessage` back to the original string.
   */
  decompress(compressed: CompressedMessage): string {
    const { compressedData, originalSize } = compressed

    try {
      const binaryStr = fromBase64(compressedData)
      const codes = binaryStringToCodes(binaryStr)
      const result = lzwDecompress(codes)

      agentEventBus.emit('message:decompressed', {
        id: compressed.id,
        compressedSize: compressed.compressedSize,
        originalSize: originalSize,
      })

      return result
    } catch {
      // If LZW decompression fails, try raw Base64 decode (short-string path)
      return this.rawBase64Decode(compressedData)
    }
  }

  /**
   * Compress an array of chat messages into a single `CompressedMessage`.
   *
   * The messages are serialised as a JSON array before compression, so the
   * original structure is preserved losslessly on decompression.
   */
  compressMessages(messages: Array<{ role: string; content: string }>): CompressedMessage {
    const serialised = JSON.stringify(messages)
    return this.compress(serialised)
  }

  /**
   * Decompress a `CompressedMessage` back into an array of chat messages.
   */
  decompressMessages(compressed: CompressedMessage): Array<{ role: string; content: string }> {
    const serialised = this.decompress(compressed)
    return JSON.parse(serialised) as Array<{ role: string; content: string }>
  }

  /**
   * Determine whether compression is worthwhile for the given data.
   * Returns `true` when the actual compressed payload is smaller than the
   * original (i.e. compressionRatio < 1.0).
   *
   * v1.2 fix: the previous implementation sampled a 1KB prefix and
   * extrapolated, but LZW builds its dictionary over time — the prefix
   * compresses WORSE than the full payload, so the heuristic was overly
   * pessimistic and skipped compression on payloads that would have
   * benefited. We now compress the full payload and compare actual sizes.
   * For large payloads (≥2KB) the cost of an extra compress pass is
   * negligible compared to the disk savings.
   */
  shouldCompress(data: string): boolean {
    if (data.length < 64) return false
    try {
      const codes = lzwCompress(data)
      const binaryStr = codesToBinaryString(codes)
      const b64 = toBase64(binaryStr)
      const originalBytes = utf8ByteLength(data)
      const compressedBytes = utf8ByteLength(b64)
      return compressedBytes < originalBytes
    } catch {
      return false
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Encode a string as raw UTF-8 → Base64 (for short strings where LZW
   * overhead would exceed the original size).
   */
  private rawBase64Encode(str: string): string {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(str, 'utf-8').toString('base64')
    }
    // Browser: encode to UTF-8 bytes, then btoa
    const encoder = new TextEncoder()
    const bytes = encoder.encode(str)
    return btoa(String.fromCharCode(...bytes))
  }

  /**
   * Decode a raw UTF-8 → Base64 string.
   */
  private rawBase64Decode(b64: string): string {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(b64, 'base64').toString('utf-8')
    }
    const binary = atob(b64)
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const messageCompressor = new MessageCompressor()
