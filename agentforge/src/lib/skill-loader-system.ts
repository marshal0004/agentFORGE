import { promises as fs } from 'fs'
import path from 'path'

export interface LoadedSkill {
  name: string
  files: Array<{ filename: string; content: string }>
  loadedAt: number
}

export interface SkillListEntry {
  name: string
  available: boolean
  active: boolean
  fileCount: number
}

export interface LoadCommandResult {
  type: 'load' | 'unload' | 'list' | 'none'
  skillName?: string
  skill?: LoadedSkill
  list?: SkillListEntry[]
  message: string
}

const sessionSkills = new Map<string, Map<string, LoadedSkill>>()

export function parseLoadCommand(message: string): LoadCommandResult {
  const trimmed = message.trim()
  const loadMatch = trimmed.match(/^load\/([a-z0-9-]+)/i)
  if (loadMatch) return { type: 'load', skillName: loadMatch[1].toLowerCase(), message: `Loading skill: ${loadMatch[1]}` }
  const unloadMatch = trimmed.match(/^unload\/([a-z0-9-]+)/i)
  if (unloadMatch) return { type: 'unload', skillName: unloadMatch[1].toLowerCase(), message: `Unloading skill: ${unloadMatch[1]}` }
  if (trimmed.match(/^list\/skills/i) || trimmed.match(/^\/list\s+skills/i)) return { type: 'list', message: 'Listing skills' }
  return { type: 'none', message: '' }
}

export async function loadSkill(skillName: string): Promise<LoadedSkill | null> {
  const skillDir = path.join(process.cwd(), 'skills', skillName)
  try {
    const entries = await fs.readdir(skillDir)
    const mdFiles = entries.filter(f => f.endsWith('.md')).sort()
    if (mdFiles.length === 0) return null
    const files: Array<{ filename: string; content: string }> = []
    for (const filename of mdFiles) {
      const content = await fs.readFile(path.join(skillDir, filename), 'utf-8')
      files.push({ filename, content })
    }
    return { name: skillName, files, loadedAt: Date.now() }
  } catch { return null }
}

export async function activateSkill(sessionId: string, skillName: string): Promise<LoadedSkill | null> {
  const active = sessionSkills.get(sessionId)
  if (active && active.has(skillName)) return active.get(skillName)!
  const skill = await loadSkill(skillName)
  if (!skill) return null
  if (!sessionSkills.has(sessionId)) sessionSkills.set(sessionId, new Map())
  sessionSkills.get(sessionId)!.set(skillName, skill)
  return skill
}

export function deactivateSkill(sessionId: string, skillName: string): boolean {
  const active = sessionSkills.get(sessionId)
  if (!active) return false
  return active.delete(skillName)
}

export function getActiveSkills(sessionId: string): LoadedSkill[] {
  const active = sessionSkills.get(sessionId)
  if (!active) return []
  return Array.from(active.values())
}

export async function listAvailableSkills(sessionId: string): Promise<SkillListEntry[]> {
  const skillsDir = path.join(process.cwd(), 'skills')
  const active = sessionSkills.get(sessionId)
  const entries: SkillListEntry[] = []
  try {
    const dirs = await fs.readdir(skillsDir)
    for (const dir of dirs) {
      const stat = await fs.stat(path.join(skillsDir, dir))
      if (!stat.isDirectory()) continue
      const files = await fs.readdir(path.join(skillsDir, dir))
      const mdCount = files.filter(f => f.endsWith('.md')).length
      entries.push({ name: dir, available: mdCount > 0, active: active?.has(dir) || false, fileCount: mdCount })
    }
  } catch {}
  return entries.sort((a, b) => a.name.localeCompare(b.name))
}

export function buildSkillInjection(sessionId: string): string {
  const skills = getActiveSkills(sessionId)
  if (skills.length === 0) return ''
  const parts: string[] = []
  for (const skill of skills) {
    parts.push(`## ACTIVE SKILL: ${skill.name}\n`)
    for (const file of skill.files) parts.push(`### ${file.filename}\n\n${file.content}`)
  }
  return parts.join('\n\n---\n\n')
}

export function clearSessionSkills(sessionId: string): void { sessionSkills.delete(sessionId) }
