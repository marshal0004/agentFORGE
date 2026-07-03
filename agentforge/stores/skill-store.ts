import { create } from 'zustand'

export interface Skill {
  id: string
  name: string
  description: string
  category: string
  version: string
  author: string
  source: 'built-in' | 'custom'
  config: Record<string, unknown>
  installed: boolean
  enabled: boolean
}

export interface MCPTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface MCPServer {
  id: string
  name: string
  description: string
  command: string
  args: string[]
  env: Record<string, string>
  category: string
  enabled: boolean
  connected: boolean
  tools: MCPTool[]
}

interface SkillState {
  skills: Skill[]
  mcpServers: MCPServer[]
  isLoadingSkills: boolean
  isLoadingMCP: boolean
  skillSearchQuery: string
  mcpSearchQuery: string
  selectedSkillCategory: string
  selectedMCPCategory: string

  setSkills: (skills: Skill[]) => void
  toggleSkill: (id: string) => void
  installSkill: (id: string) => void
  uninstallSkill: (id: string) => void
  setMCPServers: (servers: MCPServer[]) => void
  toggleMCP: (id: string) => void
  connectMCP: (id: string) => void
  disconnectMCP: (id: string) => void
  setLoadingSkills: (loading: boolean) => void
  setLoadingMCP: (loading: boolean) => void
  setSkillSearchQuery: (query: string) => void
  setMCPSearchQuery: (query: string) => void
  setSelectedSkillCategory: (category: string) => void
  setSelectedMCPCategory: (category: string) => void
  getFilteredSkills: () => Skill[]
  getFilteredMCPServers: () => MCPServer[]
  getSkillCategories: () => string[]
  getMCPCategories: () => string[]
}

export const useSkillStore = create<SkillState>((set, get) => ({
  skills: [],
  mcpServers: [],
  isLoadingSkills: false,
  isLoadingMCP: false,
  skillSearchQuery: '',
  mcpSearchQuery: '',
  selectedSkillCategory: 'all',
  selectedMCPCategory: 'all',

  setSkills: (skills) => set({ skills }),
  toggleSkill: (id) =>
    set((state) => ({
      skills: state.skills.map((s) =>
        s.id === id ? { ...s, enabled: !s.enabled } : s
      ),
    })),
  installSkill: (id) =>
    set((state) => ({
      skills: state.skills.map((s) =>
        s.id === id ? { ...s, installed: true, enabled: true } : s
      ),
    })),
  uninstallSkill: (id) =>
    set((state) => ({
      skills: state.skills.map((s) =>
        s.id === id ? { ...s, installed: false, enabled: false } : s
      ),
    })),
  setMCPServers: (servers) => set({ mcpServers: servers }),
  toggleMCP: (id) =>
    set((state) => ({
      mcpServers: state.mcpServers.map((s) =>
        s.id === id ? { ...s, enabled: !s.enabled } : s
      ),
    })),
  connectMCP: (id) =>
    set((state) => ({
      mcpServers: state.mcpServers.map((s) =>
        s.id === id ? { ...s, connected: true } : s
      ),
    })),
  disconnectMCP: (id) =>
    set((state) => ({
      mcpServers: state.mcpServers.map((s) =>
        s.id === id ? { ...s, connected: false, tools: [] } : s
      ),
    })),
  setLoadingSkills: (loading) => set({ isLoadingSkills: loading }),
  setLoadingMCP: (loading) => set({ isLoadingMCP: loading }),
  setSkillSearchQuery: (query) => set({ skillSearchQuery: query }),
  setMCPSearchQuery: (query) => set({ mcpSearchQuery: query }),
  setSelectedSkillCategory: (category) => set({ selectedSkillCategory: category }),
  setSelectedMCPCategory: (category) => set({ selectedMCPCategory: category }),

  getFilteredSkills: () => {
    const { skills, skillSearchQuery, selectedSkillCategory } = get()
    return skills.filter((s) => {
      const matchesSearch =
        !skillSearchQuery ||
        s.name.toLowerCase().includes(skillSearchQuery.toLowerCase()) ||
        s.description.toLowerCase().includes(skillSearchQuery.toLowerCase())
      const matchesCategory =
        selectedSkillCategory === 'all' || s.category === selectedSkillCategory
      return matchesSearch && matchesCategory
    })
  },

  getFilteredMCPServers: () => {
    const { mcpServers, mcpSearchQuery, selectedMCPCategory } = get()
    return mcpServers.filter((s) => {
      const matchesSearch =
        !mcpSearchQuery ||
        s.name.toLowerCase().includes(mcpSearchQuery.toLowerCase()) ||
        s.description.toLowerCase().includes(mcpSearchQuery.toLowerCase())
      const matchesCategory =
        selectedMCPCategory === 'all' || s.category === selectedMCPCategory
      return matchesSearch && matchesCategory
    })
  },

  getSkillCategories: () => {
    const { skills } = get()
    return ['all', ...new Set(skills.map((s) => s.category))]
  },

  getMCPCategories: () => {
    const { mcpServers } = get()
    return ['all', ...new Set(mcpServers.map((s) => s.category))]
  },
}))
