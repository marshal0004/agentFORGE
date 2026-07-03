import { describe, it, expect } from 'vitest'
import { GET } from '@/app/api/route'
import { parseResponse } from '../helpers/api-helpers'

/**
 * Integration tests for the Health API endpoint (GET /api)
 */
describe('Health API', () => {
  describe('GET /api', () => {
    it('returns 200 with healthy status', async () => {
      const response = await GET()
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      expect((data as Record<string, unknown>).status).toBe('healthy')
    })

    it('response has required field: service', async () => {
      const response = await GET()
      const { data } = await parseResponse(response)

      expect((data as Record<string, unknown>).service).toBe('agentforge')
    })

    it('response has required field: version', async () => {
      const response = await GET()
      const { data } = await parseResponse(response)

      expect((data as Record<string, unknown>).version).toBeDefined()
      expect(typeof (data as Record<string, unknown>).version).toBe('string')
    })

    it('response has required field: database', async () => {
      const response = await GET()
      const { data } = await parseResponse(response)

      expect((data as Record<string, unknown>).database).toBe('connected')
    })

    it('response has required field: timestamp', async () => {
      const response = await GET()
      const { data } = await parseResponse(response)

      const timestamp = (data as Record<string, unknown>).timestamp as string
      expect(timestamp).toBeDefined()
      // Validate it's a valid ISO date string
      expect(new Date(timestamp).toISOString()).toBe(timestamp)
    })

    it('response has required field: responseTime', async () => {
      const response = await GET()
      const { data } = await parseResponse(response)

      const responseTime = (data as Record<string, unknown>).responseTime as string
      expect(responseTime).toBeDefined()
      expect(responseTime).toMatch(/^\d+ms$/)
    })

    it('response has uptime field', async () => {
      const response = await GET()
      const { data } = await parseResponse(response)

      expect((data as Record<string, unknown>).uptime).toBeDefined()
      expect(typeof (data as Record<string, unknown>).uptime).toBe('number')
    })
  })
})
