import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { GET, POST, PUT, DELETE } from '@/app/api/projects/route'
import { createJsonRequest, parseResponse } from '../helpers/api-helpers'
import { db } from '@/lib/db'

/**
 * Integration tests for the Projects API
 * Uses the real SQLite database, cleans up test data after the suite.
 */
describe('Projects API', () => {
  const createdProjectIds: string[] = []

  // Clean up all test projects after the suite
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

  describe('GET /api/projects', () => {
    it('returns a list of projects', async () => {
      const response = await GET()
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      expect(data).toHaveProperty('projects')
      expect(Array.isArray((data as Record<string, unknown>).projects)).toBe(true)
    })
  })

  describe('POST /api/projects', () => {
    it('creates a project with required fields', async () => {
      const req = createJsonRequest('/api/projects', {
        name: 'Test Project',
        description: 'A test project',
      })
      const response = await POST(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(201)
      expect(data).toHaveProperty('project')
      const project = (data as Record<string, unknown>).project as Record<string, unknown>
      expect(project.name).toBe('Test Project')
      expect(project.description).toBe('A test project')
      expect(project.status).toBe('draft')
      expect(project).toHaveProperty('id')

      createdProjectIds.push(project.id as string)
    })

    it('rejects missing name', async () => {
      const req = createJsonRequest('/api/projects', {
        description: 'No name project',
      })
      const response = await POST(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(400)
      expect((data as Record<string, unknown>).error).toBeDefined()
    })
  })

  describe('PUT /api/projects', () => {
    let projectId: string

    beforeAll(async () => {
      const req = createJsonRequest('/api/projects', {
        name: 'Project To Update',
        description: 'Before update',
      })
      const response = await POST(req)
      const { data } = await parseResponse(response)
      projectId = ((data as Record<string, unknown>).project as Record<string, unknown>).id as string
      createdProjectIds.push(projectId)
    })

    it('updates project name', async () => {
      const req = createJsonRequest('/api/projects', {
        id: projectId,
        name: 'Updated Project Name',
      }, 'PUT')
      const response = await PUT(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      const project = (data as Record<string, unknown>).project as Record<string, unknown>
      expect(project.name).toBe('Updated Project Name')
    })

    it('updates project status', async () => {
      const req = createJsonRequest('/api/projects', {
        id: projectId,
        status: 'active',
      }, 'PUT')
      const response = await PUT(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      const project = (data as Record<string, unknown>).project as Record<string, unknown>
      expect(project.status).toBe('active')
    })

    it('updates project description', async () => {
      const req = createJsonRequest('/api/projects', {
        id: projectId,
        description: 'After update',
      }, 'PUT')
      const response = await PUT(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      const project = (data as Record<string, unknown>).project as Record<string, unknown>
      expect(project.description).toBe('After update')
    })

    it('rejects missing id', async () => {
      const req = createJsonRequest('/api/projects', {
        name: 'No ID update',
      }, 'PUT')
      const response = await PUT(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(400)
      expect((data as Record<string, unknown>).error).toBeDefined()
    })

    it('returns 404 for non-existent project', async () => {
      const req = createJsonRequest('/api/projects', {
        id: 'non-existent-id-12345',
        name: 'Ghost Project',
      }, 'PUT')
      const response = await PUT(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(404)
      expect((data as Record<string, unknown>).error).toBeDefined()
    })
  })

  describe('DELETE /api/projects', () => {
    it('deletes a project', async () => {
      // Create a project to delete
      const createReq = createJsonRequest('/api/projects', {
        name: 'Project To Delete',
      })
      const createRes = await POST(createReq)
      const { data: createData } = await parseResponse(createRes)
      const projectId = ((createData as Record<string, unknown>).project as Record<string, unknown>).id as string

      // Delete it
      const deleteReq = createJsonRequest('/api/projects', { id: projectId }, 'DELETE')
      const response = await DELETE(deleteReq)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      expect((data as Record<string, unknown>).success).toBe(true)
    })

    it('returns 404 for non-existent project', async () => {
      const req = createJsonRequest('/api/projects', { id: 'non-existent-id-99999' }, 'DELETE')
      const response = await DELETE(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(404)
      expect((data as Record<string, unknown>).error).toBeDefined()
    })

    it('also deletes associated messages', async () => {
      // Create project
      const createReq = createJsonRequest('/api/projects', {
        name: 'Project With Messages',
      })
      const createRes = await POST(createReq)
      const { data: createData } = await parseResponse(createRes)
      const projectId = ((createData as Record<string, unknown>).project as Record<string, unknown>).id as string

      // Add a message
      await db.message.create({
        data: {
          projectId,
          role: 'user',
          content: 'Test message for deletion',
        },
      })

      // Verify message exists
      const messagesBefore = await db.message.findMany({ where: { projectId } })
      expect(messagesBefore.length).toBe(1)

      // Delete project
      const deleteReq = createJsonRequest('/api/projects', { id: projectId }, 'DELETE')
      await DELETE(deleteReq)

      // Verify messages are gone
      const messagesAfter = await db.message.findMany({ where: { projectId } })
      expect(messagesAfter.length).toBe(0)
    })
  })
})
