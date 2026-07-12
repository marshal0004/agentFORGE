import { describe, it, expect } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'

function parseLoadCommand(message: string): { type: string; skillName?: string; message: string } {
  const trimmed = message.trim()
  const loadMatch = trimmed.match(/^load\/([a-z0-9-]+)/i)
  if (loadMatch) return { type: 'load', skillName: loadMatch[1].toLowerCase(), message: `Loading skill: ${loadMatch[1]}` }
  const unloadMatch = trimmed.match(/^unload\/([a-z0-9-]+)/i)
  if (unloadMatch) return { type: 'unload', skillName: unloadMatch[1].toLowerCase(), message: `Unloading skill: ${unloadMatch[1]}` }
  if (trimmed.match(/^list\/skills/i)) return { type: 'list', message: 'Listing skills' }
  return { type: 'none', message: '' }
}

describe('Skill Loader: Command Parsing', () => {
  it('should parse "load/fullstack-developer"', () => {
    const result = parseLoadCommand('load/fullstack-developer')
    expect(result.type).toBe('load')
    expect(result.skillName).toBe('fullstack-developer')
  })
  it('should parse "unload/fullstack-developer"', () => {
    const result = parseLoadCommand('unload/fullstack-developer')
    expect(result.type).toBe('unload')
    expect(result.skillName).toBe('fullstack-developer')
  })
  it('should parse "list/skills"', () => {
    const result = parseLoadCommand('list/skills')
    expect(result.type).toBe('list')
  })
  it('should return "none" for regular messages', () => {
    const result = parseLoadCommand('build me a task manager app')
    expect(result.type).toBe('none')
  })
})

describe('Skill Loader: Fullstack Developer Skill Files', () => {
  const skillDir = path.join(process.cwd(), 'skills', 'fullstack-developer')
  const expectedFiles = [
    'engineering-senior-developer.md', 'engineering-frontend-developer.md',
    'engineering-backend-architect.md', 'engineering-code-reviewer.md',
    'engineering-database-optimizer.md', 'testing-reality-checker.md',
    'testing-test-automation-engineer.md', 'engineering-rapid-prototyper.md',
  ]
  it('should have all 8 expected .md files', async () => {
    const files = await fs.readdir(skillDir)
    const mdFiles = files.filter(f => f.endsWith('.md'))
    expect(mdFiles.length).toBe(8)
    for (const expected of expectedFiles) expect(mdFiles).toContain(expected)
  })
  it('each file should have content (not truncated)', async () => {
    for (const filename of expectedFiles) {
      const content = await fs.readFile(path.join(skillDir, filename), 'utf-8')
      expect(content.length).toBeGreaterThan(500)
    }
  })
})
