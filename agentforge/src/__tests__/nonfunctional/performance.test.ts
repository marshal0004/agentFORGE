import { describe, it, expect, afterAll } from 'vitest'
import { GET as GETHealth } from '@/app/api/route'
import { GET as GETSkills } from '@/app/api/skills/route'
import { GET as GETProjects, POST as POSTProjects } from '@/app/api/projects/route'
import { createJsonRequest, parseResponse } from '../helpers/api-helpers'
import { db } from '@/lib/db'

/**
 * Non-functional performance tests:
 * - API response time thresholds
 * - Concurrent request handling
 * - Large data handling
 */
describe('Performance Tests', () => {
  const createdProjectIds: string[] = []

  afterAll(async () => {
    for (const id of createdProjectIds) {
      try {
        await db.message.deleteMany({ where: { projectId: id } })
        await db.project.delete({ where: { id } })
      } catch {
        // Ignore if already deleted
      }
    }
  })

  // -------------------------------------------------------------------------
  // API Response Time
  // -------------------------------------------------------------------------
  describe('API response time', () => {
    it('health endpoint responds in < 100ms', async () => {
      const start = Date.now()
      const response = await GETHealth()
      await parseResponse(response)
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(100)
    })

    it('skills list responds in < 200ms', async () => {
      const start = Date.now()
      const response = await GETSkills()
      await parseResponse(response)
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(200)
    })

    it('projects list responds in < 200ms', async () => {
      const start = Date.now()
      const response = await GETProjects()
      await parseResponse(response)
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(200)
    })
  })

  // -------------------------------------------------------------------------
  // Concurrent Requests
  // -------------------------------------------------------------------------
  describe('concurrent requests', () => {
    it('handles 5 simultaneous API calls', async () => {
      const start = Date.now()

      const promises = Array.from({ length: 5 }, () =>
        GETHealth().then((res) => parseResponse(res))
      )

      const results = await Promise.all(promises)
      const elapsed = Date.now() - start

      // All requests should succeed
      for (const { status } of results) {
        expect(status).toBe(200)
      }

      // Should complete within a reasonable time (5x the single request threshold)
      expect(elapsed).toBeLessThan(500)
    })

    it('handles 5 simultaneous skills API calls', async () => {
      const promises = Array.from({ length: 5 }, () =>
        GETSkills().then((res) => parseResponse(res))
      )

      const results = await Promise.all(promises)

      for (const { status } of results) {
        expect(status).toBe(200)
      }
    })
  })

  // -------------------------------------------------------------------------
  // Large Data Handling
  // -------------------------------------------------------------------------
  describe('large data handling', () => {
    it('creates 50 projects and verifies listing works', async () => {
      const PROJECT_COUNT = 50
      const ids: string[] = []

      // Create projects in batches to avoid overwhelming the DB
      const batchSize = 10
      for (let i = 0; i < PROJECT_COUNT; i += batchSize) {
        const batch = Array.from(
          { length: Math.min(batchSize, PROJECT_COUNT - i) },
          (_, j) => {
            const name = `Perf Test Project ${i + j} ${Date.now()}`
            return POSTProjects(
              createJsonRequest('/api/projects', { name, description: 'Performance test' })
            ).then(async (res) => {
              const { data } = await parseResponse(res)
              const id = ((data as Record<string, unknown>).project as Record<string, unknown>).id as string
              ids.push(id)
            })
          }
        )
        await Promise.all(batch)
      }

      createdProjectIds.push(...ids)

      // Verify listing works
      const start = Date.now()
      const response = await GETProjects()
      const { data, status } = await parseResponse(response)
      const elapsed = Date.now() - start

      expect(status).toBe(200)
      const projects = (data as Record<string, unknown>).projects as Record<string, unknown>[]
      // Should include at least the 50 we just created
      expect(projects.length).toBeGreaterThanOrEqual(PROJECT_COUNT)

      // Listing 50+ projects should still be fast
      expect(elapsed).toBeLessThan(500)
    })
  })
})
