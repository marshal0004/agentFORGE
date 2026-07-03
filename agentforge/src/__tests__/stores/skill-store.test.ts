import { describe, it, expect, beforeEach } from 'vitest'
import { useSkillStore } from '../../../stores/skill-store'
import type { Skill, MCPServer } from '../../../stores/skill-store'

const createSkill = (overrides: Partial<Skill> = {}): Skill => ({
  id: 'skill-1',
  name: 'Web Development',
  description: 'Build web applications',
  category: 'Frontend',
  version: '1.0.0',
  author: 'AgentForge',
  source: 'built-in',
  config: {},
  installed: false,
  enabled: false,
  ...overrides,
})

const createMCPServer = (overrides: Partial<MCPServer> = {}): MCPServer => ({
  id: 'mcp-1',
  name: 'GitHub MCP',
  description: 'GitHub integration',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
  env: {},
  category: 'Development',
  enabled: false,
  connected: false,
  tools: [],
  ...overrides,
})

describe('skill-store', () => {
  beforeEach(() => {
    // Reset the store by setting empty arrays and defaults
    const store = useSkillStore.getState()
    store.setSkills([])
    store.setMCPServers([])
    store.setSkillSearchQuery('')
    store.setMCPSearchQuery('')
    store.setSelectedSkillCategory('all')
    store.setSelectedMCPCategory('all')
    store.setLoadingSkills(false)
    store.setLoadingMCP(false)
  })

  describe('initial state', () => {
    it('should have correct default values', () => {
      const state = useSkillStore.getState()
      expect(state.skills).toEqual([])
      expect(state.mcpServers).toEqual([])
      expect(state.isLoadingSkills).toBe(false)
      expect(state.isLoadingMCP).toBe(false)
      expect(state.skillSearchQuery).toBe('')
      expect(state.mcpSearchQuery).toBe('')
      expect(state.selectedSkillCategory).toBe('all')
      expect(state.selectedMCPCategory).toBe('all')
    })
  })

  describe('setSkills', () => {
    it('should replace skills', () => {
      const skills = [
        createSkill({ id: '1', name: 'Skill A' }),
        createSkill({ id: '2', name: 'Skill B' }),
      ]
      useSkillStore.getState().setSkills(skills)
      expect(useSkillStore.getState().skills).toEqual(skills)
    })

    it('should clear skills with empty array', () => {
      useSkillStore.getState().setSkills([createSkill()])
      useSkillStore.getState().setSkills([])
      expect(useSkillStore.getState().skills).toEqual([])
    })
  })

  describe('toggleSkill', () => {
    it('should toggle enabled from false to true', () => {
      useSkillStore.getState().setSkills([createSkill({ id: '1', enabled: false })])
      useSkillStore.getState().toggleSkill('1')
      expect(useSkillStore.getState().skills[0].enabled).toBe(true)
    })

    it('should toggle enabled from true to false', () => {
      useSkillStore.getState().setSkills([createSkill({ id: '1', enabled: true })])
      useSkillStore.getState().toggleSkill('1')
      expect(useSkillStore.getState().skills[0].enabled).toBe(false)
    })

    it('should not affect other skills', () => {
      useSkillStore.getState().setSkills([
        createSkill({ id: '1', enabled: false }),
        createSkill({ id: '2', enabled: false }),
      ])
      useSkillStore.getState().toggleSkill('1')
      expect(useSkillStore.getState().skills[0].enabled).toBe(true)
      expect(useSkillStore.getState().skills[1].enabled).toBe(false)
    })
  })

  describe('installSkill', () => {
    it('should set installed=true and enabled=true', () => {
      useSkillStore.getState().setSkills([createSkill({ id: '1', installed: false, enabled: false })])
      useSkillStore.getState().installSkill('1')
      const skill = useSkillStore.getState().skills[0]
      expect(skill.installed).toBe(true)
      expect(skill.enabled).toBe(true)
    })

    it('should not affect other skills', () => {
      useSkillStore.getState().setSkills([
        createSkill({ id: '1', installed: false, enabled: false }),
        createSkill({ id: '2', installed: false, enabled: false }),
      ])
      useSkillStore.getState().installSkill('1')
      expect(useSkillStore.getState().skills[1].installed).toBe(false)
      expect(useSkillStore.getState().skills[1].enabled).toBe(false)
    })
  })

  describe('uninstallSkill', () => {
    it('should set installed=false and enabled=false', () => {
      useSkillStore.getState().setSkills([createSkill({ id: '1', installed: true, enabled: true })])
      useSkillStore.getState().uninstallSkill('1')
      const skill = useSkillStore.getState().skills[0]
      expect(skill.installed).toBe(false)
      expect(skill.enabled).toBe(false)
    })

    it('should disable skill even if it was previously enabled', () => {
      useSkillStore.getState().setSkills([createSkill({ id: '1', installed: true, enabled: true })])
      useSkillStore.getState().uninstallSkill('1')
      expect(useSkillStore.getState().skills[0].enabled).toBe(false)
    })
  })

  describe('setMCPServers', () => {
    it('should replace MCP servers', () => {
      const servers = [
        createMCPServer({ id: '1', name: 'Server A' }),
        createMCPServer({ id: '2', name: 'Server B' }),
      ]
      useSkillStore.getState().setMCPServers(servers)
      expect(useSkillStore.getState().mcpServers).toEqual(servers)
    })
  })

  describe('toggleMCP', () => {
    it('should toggle enabled from false to true', () => {
      useSkillStore.getState().setMCPServers([createMCPServer({ id: '1', enabled: false })])
      useSkillStore.getState().toggleMCP('1')
      expect(useSkillStore.getState().mcpServers[0].enabled).toBe(true)
    })

    it('should toggle enabled from true to false', () => {
      useSkillStore.getState().setMCPServers([createMCPServer({ id: '1', enabled: true })])
      useSkillStore.getState().toggleMCP('1')
      expect(useSkillStore.getState().mcpServers[0].enabled).toBe(false)
    })

    it('should not disconnect when toggling (toggle only changes enabled)', () => {
      useSkillStore.getState().setMCPServers([createMCPServer({ id: '1', enabled: true, connected: true, tools: [{ name: 'tool1', description: 'test', inputSchema: {} }] })])
      useSkillStore.getState().toggleMCP('1')
      // toggleMCP only toggles enabled; it doesn't disconnect
      const server = useSkillStore.getState().mcpServers[0]
      expect(server.enabled).toBe(false)
      expect(server.connected).toBe(true) // Still connected until disconnectMCP is called
    })
  })

  describe('connectMCP', () => {
    it('should set connected=true', () => {
      useSkillStore.getState().setMCPServers([createMCPServer({ id: '1', connected: false })])
      useSkillStore.getState().connectMCP('1')
      expect(useSkillStore.getState().mcpServers[0].connected).toBe(true)
    })
  })

  describe('disconnectMCP', () => {
    it('should set connected=false and clear tools', () => {
      useSkillStore.getState().setMCPServers([
        createMCPServer({
          id: '1',
          connected: true,
          tools: [{ name: 'tool1', description: 'test', inputSchema: {} }],
        }),
      ])
      useSkillStore.getState().disconnectMCP('1')
      const server = useSkillStore.getState().mcpServers[0]
      expect(server.connected).toBe(false)
      expect(server.tools).toEqual([])
    })
  })

  describe('setLoadingSkills / setLoadingMCP', () => {
    it('should set loading states', () => {
      useSkillStore.getState().setLoadingSkills(true)
      expect(useSkillStore.getState().isLoadingSkills).toBe(true)
      useSkillStore.getState().setLoadingMCP(true)
      expect(useSkillStore.getState().isLoadingMCP).toBe(true)
    })
  })

  describe('setSkillSearchQuery / setMCPSearchQuery', () => {
    it('should set search queries', () => {
      useSkillStore.getState().setSkillSearchQuery('web')
      expect(useSkillStore.getState().skillSearchQuery).toBe('web')
      useSkillStore.getState().setMCPSearchQuery('github')
      expect(useSkillStore.getState().mcpSearchQuery).toBe('github')
    })
  })

  describe('setSelectedSkillCategory / setSelectedMCPCategory', () => {
    it('should set selected categories', () => {
      useSkillStore.getState().setSelectedSkillCategory('Frontend')
      expect(useSkillStore.getState().selectedSkillCategory).toBe('Frontend')
      useSkillStore.getState().setSelectedMCPCategory('Development')
      expect(useSkillStore.getState().selectedMCPCategory).toBe('Development')
    })
  })

  describe('getFilteredSkills', () => {
    beforeEach(() => {
      useSkillStore.getState().setSkills([
        createSkill({ id: '1', name: 'Web Development', description: 'Build web apps', category: 'Frontend' }),
        createSkill({ id: '2', name: 'API Design', description: 'REST API patterns', category: 'Backend' }),
        createSkill({ id: '3', name: 'Database Design', description: 'Prisma and SQL', category: 'Backend' }),
        createSkill({ id: '4', name: 'UI/UX Design', description: 'User interface design', category: 'Frontend' }),
      ])
    })

    it('should return all skills when no filter is applied', () => {
      const filtered = useSkillStore.getState().getFilteredSkills()
      expect(filtered).toHaveLength(4)
    })

    it('should filter by search query matching name', () => {
      useSkillStore.getState().setSkillSearchQuery('web')
      const filtered = useSkillStore.getState().getFilteredSkills()
      expect(filtered).toHaveLength(1)
      expect(filtered[0].name).toBe('Web Development')
    })

    it('should filter by search query matching description (case insensitive)', () => {
      useSkillStore.getState().setSkillSearchQuery('REST')
      const filtered = useSkillStore.getState().getFilteredSkills()
      expect(filtered).toHaveLength(1)
      expect(filtered[0].name).toBe('API Design')
    })

    it('should filter by category', () => {
      useSkillStore.getState().setSelectedSkillCategory('Frontend')
      const filtered = useSkillStore.getState().getFilteredSkills()
      expect(filtered).toHaveLength(2)
      expect(filtered.every((s) => s.category === 'Frontend')).toBe(true)
    })

    it('should filter by both search query and category', () => {
      useSkillStore.getState().setSkillSearchQuery('sql')
      useSkillStore.getState().setSelectedSkillCategory('Backend')
      const filtered = useSkillStore.getState().getFilteredSkills()
      expect(filtered).toHaveLength(1)
      expect(filtered[0].name).toBe('Database Design')
    })

    it('should return empty array when no skills match', () => {
      useSkillStore.getState().setSkillSearchQuery('nonexistent')
      const filtered = useSkillStore.getState().getFilteredSkills()
      expect(filtered).toHaveLength(0)
    })
  })

  describe('getFilteredMCPServers', () => {
    beforeEach(() => {
      useSkillStore.getState().setMCPServers([
        createMCPServer({ id: '1', name: 'GitHub MCP', description: 'GitHub integration', category: 'Development' }),
        createMCPServer({ id: '2', name: 'Filesystem MCP', description: 'File operations', category: 'Utility' }),
        createMCPServer({ id: '3', name: 'Postgres MCP', description: 'Database access', category: 'Database' }),
      ])
    })

    it('should return all servers when no filter is applied', () => {
      const filtered = useSkillStore.getState().getFilteredMCPServers()
      expect(filtered).toHaveLength(3)
    })

    it('should filter by search query matching name', () => {
      useSkillStore.getState().setMCPSearchQuery('github')
      const filtered = useSkillStore.getState().getFilteredMCPServers()
      expect(filtered).toHaveLength(1)
      expect(filtered[0].name).toBe('GitHub MCP')
    })

    it('should filter by category', () => {
      useSkillStore.getState().setSelectedMCPCategory('Database')
      const filtered = useSkillStore.getState().getFilteredMCPServers()
      expect(filtered).toHaveLength(1)
      expect(filtered[0].name).toBe('Postgres MCP')
    })

    it('should filter by both search and category', () => {
      useSkillStore.getState().setMCPSearchQuery('file')
      useSkillStore.getState().setSelectedMCPCategory('Utility')
      const filtered = useSkillStore.getState().getFilteredMCPServers()
      expect(filtered).toHaveLength(1)
      expect(filtered[0].name).toBe('Filesystem MCP')
    })
  })

  describe('getSkillCategories', () => {
    it('should return unique categories with "all" prefix', () => {
      useSkillStore.getState().setSkills([
        createSkill({ id: '1', category: 'Frontend' }),
        createSkill({ id: '2', category: 'Backend' }),
        createSkill({ id: '3', category: 'Frontend' }),
      ])
      const categories = useSkillStore.getState().getSkillCategories()
      expect(categories).toEqual(['all', 'Frontend', 'Backend'])
    })

    it('should return ["all"] when no skills exist', () => {
      useSkillStore.getState().setSkills([])
      const categories = useSkillStore.getState().getSkillCategories()
      expect(categories).toEqual(['all'])
    })
  })

  describe('getMCPCategories', () => {
    it('should return unique categories with "all" prefix', () => {
      useSkillStore.getState().setMCPServers([
        createMCPServer({ id: '1', category: 'Development' }),
        createMCPServer({ id: '2', category: 'Database' }),
        createMCPServer({ id: '3', category: 'Development' }),
      ])
      const categories = useSkillStore.getState().getMCPCategories()
      expect(categories).toEqual(['all', 'Development', 'Database'])
    })

    it('should return ["all"] when no MCP servers exist', () => {
      useSkillStore.getState().setMCPServers([])
      const categories = useSkillStore.getState().getMCPCategories()
      expect(categories).toEqual(['all'])
    })
  })
})
