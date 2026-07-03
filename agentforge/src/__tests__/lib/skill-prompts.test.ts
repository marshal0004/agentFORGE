import { describe, it, expect } from 'vitest'
import {
  skillPromptRegistry,
  getSkillPromptConfig,
  buildSkillSystemPrompt,
  collectActiveTools,
  formatToolsForPrompt,
} from '@/lib/skill-prompts'
import type { SkillPromptConfig } from '@/lib/skill-prompts'

describe('skill-prompts', () => {
  describe('skillPromptRegistry', () => {
    it('should contain all 12 skills', () => {
      const skillNames = Object.keys(skillPromptRegistry)
      expect(skillNames).toHaveLength(12)
    })

    it('should contain expected skill names', () => {
      const expectedSkills = [
        'Web Development',
        'API Design',
        'Database Design',
        'UI/UX Design',
        'Authentication',
        'Real-time Features',
        'File Processing',
        'AI Integration',
        'Testing & QA',
        'DevOps & Deploy',
        'Mobile Development',
        'Data Visualization',
      ]
      for (const name of expectedSkills) {
        expect(skillPromptRegistry[name]).toBeDefined()
      }
    })

    it('each skill should have required fields', () => {
      for (const [name, config] of Object.entries(skillPromptRegistry)) {
        expect(config.name).toBe(name)
        expect(config.systemPromptAddition).toBeTruthy()
        expect(typeof config.systemPromptAddition).toBe('string')
        expect(config.systemPromptAddition.length).toBeGreaterThan(50)
        expect(Array.isArray(config.tools)).toBe(true)
        expect(config.tools.length).toBeGreaterThan(0)
        expect(Array.isArray(config.examples)).toBe(true)
        expect(config.examples.length).toBeGreaterThan(0)
      }
    })

    it('each tool should have required fields', () => {
      for (const config of Object.values(skillPromptRegistry)) {
        for (const tool of config.tools) {
          expect(tool.name).toBeTruthy()
          expect(tool.description).toBeTruthy()
          expect(tool.handler).toBeTruthy()
          expect(typeof tool.parameters).toBe('object')
        }
      }
    })
  })

  describe('getSkillPromptConfig', () => {
    it('should return config for known skills', () => {
      const config = getSkillPromptConfig('Web Development')
      expect(config).not.toBeNull()
      expect(config!.name).toBe('Web Development')
    })

    it('should return null for unknown skills', () => {
      const config = getSkillPromptConfig('Nonexistent Skill')
      expect(config).toBeNull()
    })

    it('should return null for empty string', () => {
      const config = getSkillPromptConfig('')
      expect(config).toBeNull()
    })
  })

  describe('buildSkillSystemPrompt', () => {
    it('should return string with skill instructions', () => {
      const prompt = buildSkillSystemPrompt(['Web Development'])
      expect(prompt).toContain('ACTIVE SKILL INSTRUCTIONS:')
      expect(prompt).toContain('--- Web Development ---')
      expect(prompt).toContain('Web Development skill active')
    })

    it('should include multiple skill sections', () => {
      const prompt = buildSkillSystemPrompt(['Web Development', 'API Design'])
      expect(prompt).toContain('--- Web Development ---')
      expect(prompt).toContain('--- API Design ---')
    })

    it('should return empty string for empty array', () => {
      const prompt = buildSkillSystemPrompt([])
      expect(prompt).toBe('')
    })

    it('should handle unknown skills gracefully (skip them)', () => {
      const prompt = buildSkillSystemPrompt(['Web Development', 'Unknown Skill'])
      expect(prompt).toContain('--- Web Development ---')
      expect(prompt).not.toContain('--- Unknown Skill ---')
    })

    it('should handle all unknown skills (return empty string)', () => {
      const prompt = buildSkillSystemPrompt(['Fake Skill 1', 'Fake Skill 2'])
      expect(prompt).toBe('')
    })
  })

  describe('collectActiveTools', () => {
    it('should return tools for known skills', () => {
      const tools = collectActiveTools(['Web Development'])
      expect(tools.length).toBeGreaterThan(0)
      const toolNames = tools.map((t) => t.name)
      expect(toolNames).toContain('read_file')
      expect(toolNames).toContain('write_file')
    })

    it('should deduplicate tools across skills', () => {
      // Web Development and API Design both have read_file
      const tools = collectActiveTools(['Web Development', 'API Design'])
      const readFileCount = tools.filter((t) => t.name === 'read_file').length
      expect(readFileCount).toBe(1)
    })

    it('should return empty array for empty skill list', () => {
      const tools = collectActiveTools([])
      expect(tools).toEqual([])
    })

    it('should skip unknown skills', () => {
      const tools = collectActiveTools(['Nonexistent Skill'])
      expect(tools).toEqual([])
    })

    it('should collect tools from all active skills', () => {
      const tools = collectActiveTools(['Web Development', 'DevOps & Deploy'])
      const toolNames = tools.map((t) => t.name)
      // Web Development has read_file, write_file, list_directory, search_files, execute_code
      // DevOps & Deploy has write_file, execute_code, git_status, git_commit
      expect(toolNames).toContain('git_status')
      expect(toolNames).toContain('git_commit')
      expect(toolNames).toContain('read_file')
    })
  })

  describe('formatToolsForPrompt', () => {
    it('should format tools as text', () => {
      const tools = collectActiveTools(['Web Development'])
      const formatted = formatToolsForPrompt(tools)
      expect(formatted).toContain('AVAILABLE TOOLS:')
      expect(formatted).toContain('read_file')
      expect(formatted).toContain('write_file')
    })

    it('should include parameter descriptions', () => {
      const tools = collectActiveTools(['Web Development'])
      const formatted = formatToolsForPrompt(tools)
      // read_file has a path parameter
      expect(formatted).toContain('path:')
    })

    it('should include tool call instruction', () => {
      const tools = collectActiveTools(['Web Development'])
      const formatted = formatToolsForPrompt(tools)
      expect(formatted).toContain('[TOOL_CALL]')
    })

    it('should return empty string for empty tools', () => {
      const formatted = formatToolsForPrompt([])
      expect(formatted).toBe('')
    })

    it('should format each tool on its own line with dash prefix', () => {
      const tools = collectActiveTools(['Web Development'])
      const formatted = formatToolsForPrompt(tools)
      const lines = formatted.split('\n').filter((l) => l.startsWith('- '))
      expect(lines.length).toBeGreaterThan(0)
    })
  })
})
