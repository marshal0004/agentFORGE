import { NextResponse } from 'next/server'
import { loadAllSkills } from '@/lib/skill-loader'

/**
 * Skills API — Returns REAL skills loaded from the skill-loader system.
 *
 * These are the actual skills that power the agent (coding-agent, fullstack-dev,
 * ui-ux-pro-max, agent-browser, skill-creator, skill-vetter). They load from
 * SKILL.md files on disk with embedded fallbacks.
 *
 * No fake/database skills — only skills that actually inject instructions
 * into the agent's system prompt are shown here.
 */

// GET /api/skills - Return all real skills from the skill-loader
export async function GET() {
  try {
    const realSkillsMap = await loadAllSkills()

    const skills = Array.from(realSkillsMap.values()).map((skill) => ({
      id: `skill-${skill.slug}`,
      name: skill.name,
      description: skill.description,
      category: skill.priority === 'critical'
        ? 'development'
        : skill.priority === 'high'
          ? 'ai'
          : 'general',
      version: '1.0.0',
      author: 'AgentForge',
      source: 'built-in' as const,
      config: {
        priority: skill.priority,
        sourceDetail: skill.source,
        coreLength: skill.coreLength,
        fullLength: skill.fullLength,
      },
      installed: skill.alwaysActive,
      enabled: skill.alwaysActive,
    }))

    return NextResponse.json({ skills })
  } catch (error) {
    console.error('Failed to load skills:', error)
    return NextResponse.json(
      { error: 'Failed to load skills' },
      { status: 500 }
    )
  }
}

// PUT /api/skills - No-op for real skills (they're always active)
export async function PUT() {
  return NextResponse.json(
    { error: 'Built-in skills are always active and cannot be toggled' },
    { status: 400 }
  )
}

// POST /api/skills - No-op (custom skills not supported in this mode)
export async function POST() {
  return NextResponse.json(
    { error: 'Custom skill creation is not supported. All skills are built-in and always active.' },
    { status: 400 }
  )
}

// DELETE /api/skills - No-op
export async function DELETE() {
  return NextResponse.json(
    { error: 'Built-in skills cannot be deleted' },
    { status: 400 }
  )
}
