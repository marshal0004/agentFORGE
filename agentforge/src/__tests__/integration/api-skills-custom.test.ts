import { describe, it, expect, afterAll } from 'vitest'
import { GET, POST, PUT, DELETE } from '@/app/api/skills/route'
import { createJsonRequest, createRequest, parseResponse } from '../helpers/api-helpers'
import { db } from '@/lib/db'

/**
 * Integration tests for the custom Skills API features:
 * - Custom skill creation (source='custom')
 * - Custom skill deletion
 * - Built-in skill deletion protection
 * - Install/uninstall behavior
 */
describe('Skills API — Custom Skills', () => {
  const createdSkillIds: string[] = []

  afterAll(async () => {
    for (const id of createdSkillIds) {
      try {
        await db.skill.delete({ where: { id } })
      } catch {
        // Ignore if already deleted
      }
    }
  })

  describe('POST /api/skills — custom skill creation', () => {
    it('creates a custom skill with source=custom', async () => {
      const req = createJsonRequest('/api/skills', {
        name: 'Custom Test Skill Unique',
        description: 'A custom test skill',
        category: 'custom-test',
        config: JSON.stringify({ systemPromptAddition: 'You are a test assistant' }),
      })
      const response = await POST(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(201)
      const skill = (data as Record<string, unknown>).skill as Record<string, unknown>
      expect(skill.name).toBe('Custom Test Skill Unique')
      expect(skill.source).toBe('custom')
      expect(skill).toHaveProperty('id')

      createdSkillIds.push(skill.id as string)
    })

    it('requires name and description', async () => {
      // Missing both
      const req1 = createJsonRequest('/api/skills', {})
      const res1 = await POST(req1)
      const { status: status1 } = await parseResponse(res1)
      expect(status1).toBe(400)

      // Missing description
      const req2 = createJsonRequest('/api/skills', { name: 'No desc' })
      const res2 = await POST(req2)
      const { status: status2 } = await parseResponse(res2)
      expect(status2).toBe(400)

      // Missing name
      const req3 = createJsonRequest('/api/skills', { description: 'No name' })
      const res3 = await POST(req3)
      const { status: status3 } = await parseResponse(res3)
      expect(status3).toBe(400)
    })

    it('creates a custom skill with systemPromptAddition in config', async () => {
      const req = createJsonRequest('/api/skills', {
        name: 'Custom Skill With Config Unique',
        description: 'Has config',
        config: { systemPromptAddition: 'Always respond in JSON format' },
      })
      const response = await POST(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(201)
      const skill = (data as Record<string, unknown>).skill as Record<string, unknown>
      expect(skill.source).toBe('custom')

      createdSkillIds.push(skill.id as string)
    })

    it('sets author to user by default for custom skills', async () => {
      const req = createJsonRequest('/api/skills', {
        name: 'Custom Author Test Unique',
        description: 'Author test',
        config: { systemPromptAddition: 'Test' },
      })
      const response = await POST(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(201)
      const skill = (data as Record<string, unknown>).skill as Record<string, unknown>
      expect(skill.author).toBe('user')

      createdSkillIds.push(skill.id as string)
    })
  })

  describe('DELETE /api/skills — custom skill deletion', () => {
    it('deletes a custom skill', async () => {
      // Create a custom skill
      const createReq = createJsonRequest('/api/skills', {
        name: 'Delete Target Custom Unique',
        description: 'Will be deleted',
        config: { systemPromptAddition: 'Delete me' },
      })
      const createRes = await POST(createReq)
      const { data: createData } = await parseResponse(createRes)
      const skillId = ((createData as Record<string, unknown>).skill as Record<string, unknown>).id as string

      // Delete it
      const deleteReq = createRequest(`/api/skills?id=${skillId}`, { method: 'DELETE' })
      const response = await DELETE(deleteReq)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      expect((data as Record<string, unknown>).success).toBe(true)

      // Verify it's gone
      const getRes = await GET()
      const { data: getData } = await parseResponse(getRes)
      const skills = (getData as Record<string, unknown>).skills as Record<string, unknown>[]
      const found = skills.find((s) => s.id === skillId)
      expect(found).toBeUndefined()
    })

    it('returns 403 for built-in skills', async () => {
      // Get the list of skills and find a built-in one
      const getRes = await GET()
      const { data: getData } = await parseResponse(getRes)
      const skills = (getData as Record<string, unknown>).skills as Record<string, unknown>[]

      const builtInSkill = skills.find((s) => s.source === 'built-in')
      if (builtInSkill) {
        const deleteReq = createRequest(`/api/skills?id=${builtInSkill.id}`, { method: 'DELETE' })
        const response = await DELETE(deleteReq)
        const { data, status } = await parseResponse(response)

        expect(status).toBe(403)
        expect((data as Record<string, unknown>).error).toContain('Built-in')
      }
    })

    it('returns 400 when id is missing', async () => {
      const deleteReq = createRequest('/api/skills', { method: 'DELETE' })
      const response = await DELETE(deleteReq)
      const { status } = await parseResponse(response)

      expect(status).toBe(400)
    })

    it('returns 404 for non-existent skill', async () => {
      const deleteReq = createRequest('/api/skills?id=nonexistent-skill-id-99999', { method: 'DELETE' })
      const response = await DELETE(deleteReq)
      const { status } = await parseResponse(response)

      expect(status).toBe(404)
    })
  })

  describe('PUT /api/skills — install/uninstall behavior', () => {
    it('install sets enabled=true AND installed=true', async () => {
      // Create a skill that is NOT installed
      const createReq = createJsonRequest('/api/skills', {
        name: 'Install Behavior Test Unique',
        description: 'Install test',
        installed: false,
        enabled: false,
        config: { systemPromptAddition: 'Install me' },
      })
      const createRes = await POST(createReq)
      const { data: createData } = await parseResponse(createRes)
      const id = ((createData as Record<string, unknown>).skill as Record<string, unknown>).id as string
      createdSkillIds.push(id)

      const req = createJsonRequest('/api/skills', { id, action: 'install' }, 'PUT')
      const response = await PUT(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      const skill = (data as Record<string, unknown>).skill as Record<string, unknown>
      expect(skill.installed).toBe(true)
      expect(skill.enabled).toBe(true)
    })

    it('uninstall sets enabled=false AND installed=false', async () => {
      // Create a skill that IS installed
      const createReq = createJsonRequest('/api/skills', {
        name: 'Uninstall Behavior Test Unique',
        description: 'Uninstall test',
        installed: true,
        enabled: true,
        config: { systemPromptAddition: 'Uninstall me' },
      })
      const createRes = await POST(createReq)
      const { data: createData } = await parseResponse(createRes)
      const id = ((createData as Record<string, unknown>).skill as Record<string, unknown>).id as string
      createdSkillIds.push(id)

      const req = createJsonRequest('/api/skills', { id, action: 'uninstall' }, 'PUT')
      const response = await PUT(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      const skill = (data as Record<string, unknown>).skill as Record<string, unknown>
      expect(skill.installed).toBe(false)
      expect(skill.enabled).toBe(false)
    })
  })
})
