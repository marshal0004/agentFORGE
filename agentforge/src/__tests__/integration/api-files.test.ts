import { describe, it, expect, afterAll } from 'vitest'
import { GET, POST, PUT, DELETE, PATCH } from '@/app/api/files/route'
import { createJsonRequest, createRequest, parseResponse } from '../helpers/api-helpers'
import { deleteProjectWorkspace } from '@/lib/filesystem'

/**
 * Integration tests for the Files API
 * Uses a test-specific project ID to isolate filesystem operations.
 */
const TEST_PROJECT_ID = '__test_project_files__'

describe('Files API', () => {
  // Clean up test workspace after all tests
  afterAll(async () => {
    try {
      await deleteProjectWorkspace(TEST_PROJECT_ID)
    } catch {
      // Ignore if already deleted
    }
  })

  describe('GET /api/files', () => {
    it('returns file tree for a project', async () => {
      // First write a file so there's something to list
      const writeReq = createJsonRequest('/api/files', {
        projectId: TEST_PROJECT_ID,
        filePath: 'list-test.txt',
        content: 'hello list',
      })
      await POST(writeReq)

      const req = createRequest(`/api/files?projectId=${TEST_PROJECT_ID}`)
      const response = await GET(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      expect(data).toHaveProperty('tree')
      expect(data).toHaveProperty('files')
      expect(data).toHaveProperty('fileCount')
      expect((data as Record<string, unknown>).success).toBe(true)
    })

    it('returns file content when filePath is specified', async () => {
      // Write a file first
      const writeReq = createJsonRequest('/api/files', {
        projectId: TEST_PROJECT_ID,
        filePath: 'read-test.txt',
        content: 'hello read content',
      })
      await POST(writeReq)

      const req = createRequest(`/api/files?projectId=${TEST_PROJECT_ID}&filePath=read-test.txt`)
      const response = await GET(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      expect((data as Record<string, unknown>).content).toBe('hello read content')
      expect((data as Record<string, unknown>).filePath).toBe('read-test.txt')
    })

    it('rejects missing projectId', async () => {
      const req = createRequest('/api/files')
      const response = await GET(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(400)
      expect((data as Record<string, unknown>).error).toBeDefined()
    })
  })

  describe('POST /api/files', () => {
    it('writes a file to workspace', async () => {
      const req = createJsonRequest('/api/files', {
        projectId: TEST_PROJECT_ID,
        filePath: 'new-file.txt',
        content: 'new file content',
      })
      const response = await POST(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(201)
      expect((data as Record<string, unknown>).success).toBe(true)
      expect((data as Record<string, unknown>).filePath).toBe('new-file.txt')
    })

    it('creates nested directories automatically', async () => {
      const req = createJsonRequest('/api/files', {
        projectId: TEST_PROJECT_ID,
        filePath: 'nested/deep/file.txt',
        content: 'nested content',
      })
      const response = await POST(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(201)
      expect((data as Record<string, unknown>).success).toBe(true)
    })
  })

  describe('PUT /api/files', () => {
    it('updates a file', async () => {
      // Write a file first
      const writeReq = createJsonRequest('/api/files', {
        projectId: TEST_PROJECT_ID,
        filePath: 'update-test.txt',
        content: 'original content',
      })
      await POST(writeReq)

      // Update it
      const updateReq = createJsonRequest('/api/files', {
        projectId: TEST_PROJECT_ID,
        filePath: 'update-test.txt',
        content: 'updated content',
      }, 'PUT')
      const response = await PUT(updateReq)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      expect((data as Record<string, unknown>).success).toBe(true)

      // Verify content was updated
      const readReq = createRequest(`/api/files?projectId=${TEST_PROJECT_ID}&filePath=update-test.txt`)
      const readRes = await GET(readReq)
      const { data: readData } = await parseResponse(readRes)
      expect((readData as Record<string, unknown>).content).toBe('updated content')
    })
  })

  describe('DELETE /api/files', () => {
    it('deletes a file', async () => {
      // Write a file to delete
      const writeReq = createJsonRequest('/api/files', {
        projectId: TEST_PROJECT_ID,
        filePath: 'delete-test.txt',
        content: 'to be deleted',
      })
      await POST(writeReq)

      const deleteReq = createJsonRequest('/api/files', {
        projectId: TEST_PROJECT_ID,
        filePath: 'delete-test.txt',
      }, 'DELETE')
      const response = await DELETE(deleteReq)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      expect((data as Record<string, unknown>).success).toBe(true)
    })

    it('deletes workspace when no filePath', async () => {
      // Create a separate test project for workspace deletion
      const wsProjectId = '__test_ws_delete__'

      // Write a file
      const writeReq = createJsonRequest('/api/files', {
        projectId: wsProjectId,
        filePath: 'file1.txt',
        content: 'workspace file',
      })
      await POST(writeReq)

      // Delete entire workspace
      const deleteReq = createJsonRequest('/api/files', {
        projectId: wsProjectId,
      }, 'DELETE')
      const response = await DELETE(deleteReq)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      expect((data as Record<string, unknown>).success).toBe(true)
      expect((data as Record<string, unknown>).message).toContain('Workspace deleted')
    })
  })

  describe('PATCH /api/files', () => {
    it('renames a file', async () => {
      // Write a file to rename
      const writeReq = createJsonRequest('/api/files', {
        projectId: TEST_PROJECT_ID,
        filePath: 'before-rename.txt',
        content: 'rename me',
      })
      await POST(writeReq)

      const renameReq = createJsonRequest('/api/files', {
        projectId: TEST_PROJECT_ID,
        oldPath: 'before-rename.txt',
        newPath: 'after-rename.txt',
      }, 'PATCH')
      const response = await PATCH(renameReq)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      expect((data as Record<string, unknown>).success).toBe(true)
      expect((data as Record<string, unknown>).oldPath).toBe('before-rename.txt')
      expect((data as Record<string, unknown>).newPath).toBe('after-rename.txt')
    })
  })
})
