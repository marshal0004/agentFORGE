import { describe, it, expect } from 'vitest'
import { POST } from '@/app/api/terminal/route'
import { createJsonRequest, parseResponse } from '../helpers/api-helpers'

/**
 * Integration tests for the Terminal API
 * Executes real shell commands.
 */
describe('Terminal API', () => {
  describe('POST /api/terminal', () => {
    it('executes a simple command (echo hello)', async () => {
      const req = createJsonRequest('/api/terminal', {
        command: 'echo hello',
      })
      const response = await POST(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      expect((data as Record<string, unknown>).stdout).toContain('hello')
      expect((data as Record<string, unknown>).exitCode).toBe(0)
    })

    it('rejects missing command', async () => {
      const req = createJsonRequest('/api/terminal', {})
      const response = await POST(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(400)
      expect((data as Record<string, unknown>).error).toBeDefined()
    })

    it('rejects non-string command', async () => {
      const req = createJsonRequest('/api/terminal', {
        command: 12345,
      })
      const response = await POST(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(400)
      expect((data as Record<string, unknown>).error).toBeDefined()
    })

    it('returns exitCode, stdout, stderr', async () => {
      const req = createJsonRequest('/api/terminal', {
        command: 'echo test_output && echo test_error >&2',
      })
      const response = await POST(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      expect(data).toHaveProperty('exitCode')
      expect(data).toHaveProperty('stdout')
      expect(data).toHaveProperty('stderr')
      expect((data as Record<string, unknown>).exitCode).toBe(0)
      expect((data as Record<string, unknown>).stdout).toContain('test_output')
      expect((data as Record<string, unknown>).stderr).toContain('test_error')
    })

    it('returns non-zero exitCode for failing commands', async () => {
      const req = createJsonRequest('/api/terminal', {
        command: 'exit 1',
      })
      const response = await POST(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200) // API returns 200 even for non-zero exit codes
      expect((data as Record<string, unknown>).exitCode).toBe(1)
    })
  })
})
