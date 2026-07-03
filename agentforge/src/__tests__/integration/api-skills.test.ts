import { describe, it, expect, afterAll } from 'vitest'
import { GET, POST, PUT } from '@/app/api/skills/route'
import { createJsonRequest, parseResponse } from '../helpers/api-helpers'
import { db } from '@/lib/db'

/**
 * Integration tests for the Skills API
 * Uses the real SQLite database, cleans up test data after the suite.
 */
describe('Skills API', () => {
  const createdSkillIds: string[] = []

  // Clean up all test skills after the suite
  afterAll(async () => {
    for (const id of createdSkillIds) {
      try {
        await db.skill.delete({ where: { id } })
      } catch {
        // Ignore if already deleted
      }
    }
  })

  describe('GET /api/skills', () => {
    it('seeds and returns default skills', async () => {
      const response = await GET()
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      expect(data).toHaveProperty('skills')
      const skills = (data as Record<string, unknown>).skills as Record<string, unknown>[]
      expect(Array.isArray(skills)).toBe(true)
      // Default skills should be seeded
      expect(skills.length).toBeGreaterThanOrEqual(1)
      // Check first skill has expected fields
      const firstSkill = skills[0]
      expect(firstSkill).toHaveProperty('name')
      expect(firstSkill).toHaveProperty('description')
      expect(firstSkill).toHaveProperty('installed')
      expect(firstSkill).toHaveProperty('enabled')
      // Enriched skills should have promptConfig
      expect(firstSkill).toHaveProperty('promptConfig')
    })
  })

  describe('POST /api/skills', () => {
    it('creates a new skill', async () => {
      const req = createJsonRequest('/api/skills', {
        name: 'Test Skill Unique 1',
        description: 'A test skill',
        category: 'test',
      })
      const response = await POST(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(201)
      expect(data).toHaveProperty('skill')
      const skill = (data as Record<string, unknown>).skill as Record<string, unknown>
      expect(skill.name).toBe('Test Skill Unique 1')
      expect(skill.description).toBe('A test skill')
      expect(skill.category).toBe('test')
      expect(skill).toHaveProperty('id')

      createdSkillIds.push(skill.id as string)
    })

    it('rejects duplicate name', async () => {
      // First create
      const req1 = createJsonRequest('/api/skills', {
        name: 'Duplicate Test Skill',
        description: 'First',
      })
      const res1 = await POST(req1)
      const { data: data1 } = await parseResponse(res1)
      const skillId = ((data1 as Record<string, unknown>).skill as Record<string, unknown>).id as string
      createdSkillIds.push(skillId)

      // Try duplicate
      const req2 = createJsonRequest('/api/skills', {
        name: 'Duplicate Test Skill',
        description: 'Second',
      })
      const res2 = await POST(req2)
      const { status } = await parseResponse(res2)

      expect(status).toBe(409)
    })

    it('rejects missing required fields', async () => {
      const req = createJsonRequest('/api/skills', {
        category: 'test',
      })
      const response = await POST(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(400)
      expect((data as Record<string, unknown>).error).toBeDefined()
    })
  })

  describe('PUT /api/skills', () => {
    let skillId: string

    // Create a skill for update tests
    afterAll(async () => {
      if (skillId) {
        createdSkillIds.push(skillId)
      }
    })

    it('sets up a skill for update tests', async () => {
      const req = createJsonRequest('/api/skills', {
        name: 'Skill For Update Tests',
        description: 'To be updated',
        category: 'test',
      })
      const response = await POST(req)
      const { data } = await parseResponse(response)
      skillId = ((data as Record<string, unknown>).skill as Record<string, unknown>).id as string
      createdSkillIds.push(skillId)
    })

    it('with action=install sets installed=true, enabled=true', async () => {
      // First create a skill that is NOT installed
      const createReq = createJsonRequest('/api/skills', {
        name: 'Install Target Skill',
        description: 'Will be installed',
        category: 'test',
        installed: false,
        enabled: false,
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

    it('with action=uninstall sets installed=false, enabled=false', async () => {
      // Get an installed skill
      const getRes = await GET()
      const { data: getData } = await parseResponse(getRes)
      const skills = (getData as Record<string, unknown>).skills as Record<string, unknown>[]
      const installedSkill = skills.find((s) => s.installed === true)

      if (installedSkill) {
        const req = createJsonRequest('/api/skills', { id: installedSkill.id, action: 'uninstall' }, 'PUT')
        const response = await PUT(req)
        const { data, status } = await parseResponse(response)

        expect(status).toBe(200)
        const skill = (data as Record<string, unknown>).skill as Record<string, unknown>
        expect(skill.installed).toBe(false)
        expect(skill.enabled).toBe(false)

        // Re-install it for other tests
        const reInstallReq = createJsonRequest('/api/skills', { id: installedSkill.id, action: 'install' }, 'PUT')
        await PUT(reInstallReq)
      }
    })

    it('with action=toggle flips enabled', async () => {
      const createReq = createJsonRequest('/api/skills', {
        name: 'Toggle Target Skill',
        description: 'Will be toggled',
        category: 'test',
        installed: true,
        enabled: true,
      })
      const createRes = await POST(createReq)
      const { data: createData } = await parseResponse(createRes)
      const id = ((createData as Record<string, unknown>).skill as Record<string, unknown>).id as string
      createdSkillIds.push(id)

      // Toggle from true to false
      const req = createJsonRequest('/api/skills', { id, action: 'toggle' }, 'PUT')
      const response = await PUT(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      const skill = (data as Record<string, unknown>).skill as Record<string, unknown>
      expect(skill.enabled).toBe(false)

      // Toggle back to true
      const req2 = createJsonRequest('/api/skills', { id, action: 'toggle' }, 'PUT')
      const response2 = await PUT(req2)
      const { data: data2 } = await parseResponse(response2)
      const skill2 = (data2 as Record<string, unknown>).skill as Record<string, unknown>
      expect(skill2.enabled).toBe(true)
    })

    it('with general update changes name/description', async () => {
      const req = createJsonRequest('/api/skills', {
        id: skillId,
        name: 'Updated Skill Name',
        description: 'Updated description',
      }, 'PUT')
      const response = await PUT(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(200)
      const skill = (data as Record<string, unknown>).skill as Record<string, unknown>
      expect(skill.name).toBe('Updated Skill Name')
      expect(skill.description).toBe('Updated description')
    })

    it('returns 404 for non-existent skill', async () => {
      const req = createJsonRequest('/api/skills', {
        id: 'non-existent-skill-id',
        name: 'Ghost Skill',
      }, 'PUT')
      const response = await PUT(req)
      const { data, status } = await parseResponse(response)

      expect(status).toBe(404)
      expect((data as Record<string, unknown>).error).toBeDefined()
    })
  })
})
