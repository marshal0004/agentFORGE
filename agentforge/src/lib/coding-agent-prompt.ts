import { promises as fs } from 'fs'
import path from 'path'
import { db } from '@/lib/db'

export interface SkillFile { filename: string; content: string }
export interface UploadedSkillData { name: string; description: string; files: Record<string, string> }

const CODING_AGENT_SKILL_DIR = path.join(process.cwd(), 'skills', 'coding-agent')
let cachedSkillFiles: SkillFile[] | null = null

export async function loadCodingAgentSkill(): Promise<SkillFile[]> {
  if (cachedSkillFiles) return cachedSkillFiles
  const files: SkillFile[] = []
  const filenames = ['SKILL.md', 'planning.md', 'execution.md', 'verification.md', 'state.md', 'criteria.md', 'memory-template.md', 'useful_instruction.md']
  for (const filename of filenames) {
    try { const content = await fs.readFile(path.join(CODING_AGENT_SKILL_DIR, filename), 'utf-8'); files.push({ filename, content }) } catch {}
  }
  cachedSkillFiles = files
  return files
}

// FIX: Use db.agentMemory and db.uploadedSkill (Prisma client methods)
export async function loadAgentMemory(): Promise<string> {
  try {
    const result = await db.agentMemory.findUnique({ where: { key: 'preferences' } })
    return result?.content || ''
  } catch { return '' }
}

export async function saveAgentMemory(content: string): Promise<void> {
  try {
    await db.agentMemory.upsert({
      where: { key: 'preferences' },
      update: { content },
      create: { key: 'preferences', content },
    })
  } catch (err) { console.error('[AgentMemory] Failed to save:', err) }
}

export async function loadUploadedSkills(): Promise<UploadedSkillData[]> {
  try {
    const result = await db.uploadedSkill.findMany({ where: { enabled: true } })
    return result.map(row => ({ name: row.name, description: row.description, files: JSON.parse(row.files || '{}') }))
  } catch { return [] }
}

export async function saveUploadedSkill(skill: UploadedSkillData): Promise<void> {
  try {
    await db.uploadedSkill.upsert({
      where: { name: skill.name },
      update: { description: skill.description, files: JSON.stringify(skill.files) },
      create: { name: skill.name, description: skill.description, files: JSON.stringify(skill.files), enabled: true },
    })
  } catch (err) { console.error('[UploadedSkill] Failed to save:', err) }
}

export async function buildSystemPrompt(context: { userTask: string; projectId?: string }): Promise<string> {
  const parts: string[] = []
  const skillFiles = await loadCodingAgentSkill()
  parts.push(`# AGENTFORGE — CODING AGENT WORKFLOW\n\nYou are AgentForge, a coding agent that follows a structured workflow.\nYour core workflow is: **Request → Plan → Execute → Verify → Deliver**\n\n## CORE SKILL FILES\n\nThe following files define your workflow. Follow them EXACTLY.`)
  for (const file of skillFiles) { parts.push(`### ${file.filename}\n\n${file.content}`) }
  const memory = await loadAgentMemory()
  if (memory) { parts.push(`## USER PREFERENCES (from memory)\n\n${memory}`) }
  else { parts.push(`## USER PREFERENCES\n\nNo preferences stored yet.`) }
  const uploadedSkills = await loadUploadedSkills()
  if (uploadedSkills.length > 0) {
    parts.push(`## ACTIVE UPLOADED SKILLS\n\nThe user has uploaded the following skills:`)
    for (const skill of uploadedSkills) {
      parts.push(`### Skill: ${skill.name}\n${skill.description}\n`)
      for (const [filename, content] of Object.entries(skill.files)) { parts.push(`#### ${filename}\n${content}`) }
    }
  }
  parts.push(`## AGENTFORGE RUNTIME CONTEXT\n\n### Available Tools\n- \`write_file({ path, content })\`\n- \`read_file({ path })\`\n- \`edit_file({ path, search, replace })\`\n- \`list_directory({ path })\`\n- \`execute_code({ command })\`\n- \`think({ thought })\`\n\n### Execution Rules\n1. Sequential execution: ONE tool call per response.\n2. Plan first.\n3. Verify after each step.\n4. Fix-before-send.\n5. Stop on loops after 3 tries.`)
  return parts.join('\n\n---\n\n')
}


// FIX: Next.js "use client" directive rules — exported for injection
export const USE_CLIENT_RULES = `
## CRITICAL: Next.js "use client" Directive Rules

These files MUST have "use client" at the top (line 1):
- src/app/error.tsx — Uses error boundary hooks
- src/app/not-found.tsx — Uses navigation hooks  
- src/app/loading.tsx — Uses loading state
- Any file using: useState, useEffect, useRef, useContext, onClick, onChange, onSubmit
- Any file importing from 'react' hooks

Files that should NOT have "use client":
- layout.tsx (Server Component by default)
- page.tsx (unless using hooks)
- Server-only utility files

Example of CORRECT error.tsx:
\`\`\`tsx
"use client"
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return <div>...</div>
}
\`\`\`


`;
