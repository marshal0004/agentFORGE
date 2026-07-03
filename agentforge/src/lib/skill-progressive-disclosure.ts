/**
 * Claude Code-Style Skill Progressive Disclosure — 3-Level Loading
 *
 * Mirrors Claude Code's skill system:
 *   Level 1 (always in context): Skill name + description only (~100 words)
 *   Level 2 (on trigger): Full SKILL.md body (1,500–2,000 words max)
 *   Level 3 (as needed): references/, examples/, scripts/ files loaded on-demand
 *
 * Why this matters for agentFORGE:
 *   - Stops injecting 60K chars of skill content into the system prompt
 *   - Only injects name + description (~100 words per skill)
 *   - When the LLM's response matches a skill's trigger phrases, injects the
 *     full SKILL.md body into the next turn's context
 *   - The LLM can then read_file auxiliary files as needed
 *
 * Existing skill-loader.ts has 3-tier storage (corePrompt / full / auxiliary)
 * but injects ALL skills' corePrompt into the system prompt. This module
 * adds the trigger-detection layer that decides WHEN to escalate from
 * Level 1 (description only) to Level 2 (full body).
 *
 * Integration:
 *   - chat/route.ts: calls buildProgressiveSkillPrompt() instead of
 *     buildActiveSkillsPrompt() when progressive disclosure is enabled
 *   - On each iteration, calls detectTriggeredSkills() to check if any
 *     skill's trigger phrases appeared in the latest user/assistant message
 *   - Triggered skills' full bodies are injected into the next turn
 */

import { loadAllSkills, getFullSkillPrompt, type SkillContent } from './skill-loader'
import { agentEventBus } from './event-bus'

// ── Types ────────────────────────────────────────────────────────────────────

export interface TriggerPhrase {
  /** The phrase to match (case-insensitive substring match) */
  phrase: string
  /** Skill name this trigger belongs to */
  skillName: string
  /** Whether to match in user messages, assistant messages, or both */
  matchIn: 'user' | 'assistant' | 'both'
}

export interface TriggeredSkill {
  /** Skill name */
  name: string
  /** Why it was triggered (which phrase matched, where) */
  triggerReason: string
  /** The full skill prompt to inject */
  fullPrompt: string
}

export interface ProgressiveDisclosureState {
  /** Skills currently escalated to Level 2 (full body in context) */
  escalatedSkills: Set<string>
  /** History of trigger matches (for debugging) */
  triggerHistory: Array<{
    skillName: string
    phrase: string
    messageRole: string
    timestamp: number
  }>
  /** When the state was last reset */
  lastReset: number
}

// ── Trigger Phrase Registry ─────────────────────────────────────────────────

/**
 * Default trigger phrases per skill. These are intentionally broad —
 * we'd rather over-trigger and inject a skill than miss it.
 *
 * Skills not in this map have NO triggers and only appear at Level 1
 * (description only).
 */
const DEFAULT_TRIGGERS: TriggerPhrase[] = [
  // fullstack-dev skill
  { skillName: 'fullstack-dev', phrase: 'next.js', matchIn: 'both' },
  { skillName: 'fullstack-dev', phrase: 'nextjs', matchIn: 'both' },
  { skillName: 'fullstack-dev', phrase: 'react component', matchIn: 'both' },
  { skillName: 'fullstack-dev', phrase: 'shadcn', matchIn: 'both' },
  { skillName: 'fullstack-dev', phrase: 'prisma', matchIn: 'both' },
  { skillName: 'fullstack-dev', phrase: 'tailwind', matchIn: 'both' },
  { skillName: 'fullstack-dev', phrase: 'full stack', matchIn: 'both' },
  { skillName: 'fullstack-dev', phrase: 'fullstack', matchIn: 'both' },
  { skillName: 'fullstack-dev', phrase: 'api route', matchIn: 'both' },
  { skillName: 'fullstack-dev', phrase: 'trpc', matchIn: 'both' },

  // pdf skill
  { skillName: 'pdf', phrase: 'pdf', matchIn: 'both' },
  { skillName: 'pdf', phrase: 'reportlab', matchIn: 'both' },
  { skillName: 'pdf', phrase: 'latex', matchIn: 'both' },
  { skillName: 'pdf', phrase: 'tectonic', matchIn: 'both' },

  // docx skill
  { skillName: 'docx', phrase: 'word document', matchIn: 'both' },
  { skillName: 'docx', phrase: '.docx', matchIn: 'both' },
  { skillName: 'docx', phrase: 'docx', matchIn: 'both' },

  // xlsx skill
  { skillName: 'xlsx', phrase: 'excel', matchIn: 'both' },
  { skillName: 'xlsx', phrase: '.xlsx', matchIn: 'both' },
  { skillName: 'xlsx', phrase: 'spreadsheet', matchIn: 'both' },
  { skillName: 'xlsx', phrase: 'openpyxl', matchIn: 'both' },

  // pptx skill
  { skillName: 'pptx', phrase: 'powerpoint', matchIn: 'both' },
  { skillName: 'pptx', phrase: '.pptx', matchIn: 'both' },
  { skillName: 'pptx', phrase: 'presentation', matchIn: 'both' },
  { skillName: 'pptx', phrase: 'slides', matchIn: 'both' },

  // charts skill
  { skillName: 'charts', phrase: 'chart', matchIn: 'both' },
  { skillName: 'charts', phrase: 'graph', matchIn: 'both' },
  { skillName: 'charts', phrase: 'matplotlib', matchIn: 'both' },
  { skillName: 'charts', phrase: 'echarts', matchIn: 'both' },
  { skillName: 'charts', phrase: 'd3.js', matchIn: 'both' },
  { skillName: 'charts', phrase: 'mermaid', matchIn: 'both' },
  { skillName: 'charts', phrase: 'flowchart', matchIn: 'both' },
  { skillName: 'charts', phrase: 'mind map', matchIn: 'both' },
  { skillName: 'charts', phrase: 'architecture diagram', matchIn: 'both' },

  // image-generation skill
  { skillName: 'image-generation', phrase: 'generate image', matchIn: 'both' },
  { skillName: 'image-generation', phrase: 'create image', matchIn: 'both' },
  { skillName: 'image-generation', phrase: 'draw', matchIn: 'user' },
  { skillName: 'image-generation', phrase: 'illustration', matchIn: 'both' },

  // ASR / TTS / VLM / LLM / web-search / web-reader skills
  { skillName: 'ASR', phrase: 'transcribe', matchIn: 'both' },
  { skillName: 'ASR', phrase: 'speech to text', matchIn: 'both' },
  { skillName: 'ASR', phrase: 'audio transcription', matchIn: 'both' },

  { skillName: 'TTS', phrase: 'text to speech', matchIn: 'both' },
  { skillName: 'TTS', phrase: 'voice', matchIn: 'both' },
  { skillName: 'TTS', phrase: 'audio', matchIn: 'both' },

  { skillName: 'VLM', phrase: 'analyze image', matchIn: 'both' },
  { skillName: 'VLM', phrase: 'image analysis', matchIn: 'both' },
  { skillName: 'VLM', phrase: 'vision', matchIn: 'both' },

  { skillName: 'LLM', phrase: 'chatbot', matchIn: 'both' },
  { skillName: 'LLM', phrase: 'chat completion', matchIn: 'both' },
  { skillName: 'LLM', phrase: 'ai assistant', matchIn: 'both' },

  { skillName: 'web-search', phrase: 'search the web', matchIn: 'both' },
  { skillName: 'web-search', phrase: 'web search', matchIn: 'both' },
  { skillName: 'web-search', phrase: 'find online', matchIn: 'both' },

  { skillName: 'web-reader', phrase: 'scrape', matchIn: 'both' },
  { skillName: 'web-reader', phrase: 'extract content', matchIn: 'both' },
  { skillName: 'web-reader', phrase: 'web page', matchIn: 'both' },
]

// ── Progressive Disclosure Manager ───────────────────────────────────────────

class ProgressiveDisclosureManager {
  private state: ProgressiveDisclosureState = {
    escalatedSkills: new Set(),
    triggerHistory: [],
    lastReset: Date.now(),
  }

  private customTriggers: TriggerPhrase[] = []

  /**
   * Add a custom trigger phrase (for testing or runtime config).
   */
  addTrigger(phrase: TriggerPhrase): void {
    this.customTriggers.push(phrase)
  }

  /**
   * Reset state (called at the start of a new session).
   */
  reset(): void {
    this.state = {
      escalatedSkills: new Set(),
      triggerHistory: [],
      lastReset: Date.now(),
    }
  }

  /**
   * Detect which skills should be escalated based on the latest messages.
   *
   * @param recentMessages - Recent messages (user + assistant) to scan for triggers
   * @returns Array of triggered skills with their full prompts
   */
  async detectTriggeredSkills(
    recentMessages: Array<{ role: string; content: string }>,
  ): Promise<TriggeredSkill[]> {
    const allTriggers = [...DEFAULT_TRIGGERS, ...this.customTriggers]
    const triggered = new Map<string, TriggeredSkill>()

    for (const msg of recentMessages) {
      const lowerContent = msg.content.toLowerCase()

      for (const trigger of allTriggers) {
        if (trigger.matchIn !== 'both' && trigger.matchIn !== msg.role) continue

        if (lowerContent.includes(trigger.phrase.toLowerCase())) {
          // Skip if already escalated
          if (this.state.escalatedSkills.has(trigger.skillName)) continue
          // Skip if already triggered in this pass
          if (triggered.has(trigger.skillName)) continue

          // Get the full skill prompt
          const fullPrompt = await getFullSkillPrompt(trigger.skillName)
          if (!fullPrompt) continue

          triggered.set(trigger.skillName, {
            name: trigger.skillName,
            triggerReason: `matched "${trigger.phrase}" in ${msg.role} message`,
            fullPrompt,
          })

          this.state.triggerHistory.push({
            skillName: trigger.skillName,
            phrase: trigger.phrase,
            messageRole: msg.role,
            timestamp: Date.now(),
          })

          // Mark as escalated so we don't re-inject on every turn
          this.state.escalatedSkills.add(trigger.skillName)

          agentEventBus.emit('skill:triggered', {
            skillName: trigger.skillName,
            phrase: trigger.phrase,
            messageRole: msg.role,
          })
        }
      }
    }

    return [...triggered.values()]
  }

  /**
   * Build the Level 1 system prompt — only skill name + description.
   * This is the "always in context" minimum.
   *
   * Output is ~100 words per skill (vs 5K-10K per skill currently).
   */
  async buildLevel1Prompt(): Promise<string> {
    const skills = await loadAllSkills()
    const lines: string[] = []

    lines.push('# Available Skills')
    lines.push('')
    lines.push('The following skills are available. To activate one, mention its topic in your')
    lines.push('response, or call read_file on a skill\'s SKILL.md for full instructions.')
    lines.push('')

    for (const [name, skill] of skills.entries()) {
      // Level 1: just name + 1-line description
      const desc = extractOneLineDescription(skill)
      lines.push(`- **${name}**: ${desc}`)
    }

    return lines.join('\n')
  }

  /**
   * Build the Level 2 prompt — full bodies for all escalated skills.
   * Called when detectTriggeredSkills() returns non-empty array.
   */
  async buildLevel2Prompt(triggered: TriggeredSkill[]): Promise<string> {
    if (triggered.length === 0) return ''

    const parts: string[] = []
    parts.push('# Activated Skills (Triggered by Conversation)')
    parts.push('')
    parts.push('The following skills have been triggered by the conversation. Follow their')
    parts.push('instructions when relevant.')
    parts.push('')

    for (const trig of triggered) {
      parts.push(`${'='.repeat(60)}`)
      parts.push(`SKILL: ${trig.name} (triggered: ${trig.triggerReason})`)
      parts.push(`${'='.repeat(60)}`)
      parts.push('')
      parts.push(trig.fullPrompt)
      parts.push('')
    }

    return parts.join('\n')
  }

  /**
   * Build the COMPLETE progressive skill prompt for the current turn.
   *
   * Combines:
   *   - Level 1: name + description for ALL skills
   *   - Level 2: full body for triggered skills
   *
   * Use this INSTEAD of buildActiveSkillsPrompt() in the chat route.
   */
  async buildProgressivePrompt(
    recentMessages: Array<{ role: string; content: string }> = [],
  ): Promise<string> {
    const level1 = await this.buildLevel1Prompt()
    const triggered = await this.detectTriggeredSkills(recentMessages)
    const level2 = await this.buildLevel2Prompt(triggered)

    if (level2) {
      return `${level1}\n\n${level2}`
    }
    return level1
  }

  /**
   * Get the current state (for debugging).
   */
  getState(): ProgressiveDisclosureState {
    return {
      escalatedSkills: new Set(this.state.escalatedSkills),
      triggerHistory: [...this.state.triggerHistory],
      lastReset: this.state.lastReset,
    }
  }

  /**
   * Get all triggers (default + custom).
   */
  getAllTriggers(): TriggerPhrase[] {
    return [...DEFAULT_TRIGGERS, ...this.customTriggers]
  }
}

/**
 * Extract a one-line description from a SkillContent.
 * Tries to find the first non-frontmatter paragraph.
 */
function extractOneLineDescription(skill: SkillContent): string {
  // The SkillContent has a description field if available
  const desc = (skill as unknown as { description?: string }).description
  if (desc) return desc

  // Fallback: extract first non-empty, non-heading line from corePrompt
  const lines = skill.corePrompt.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('#')) continue
    if (trimmed.startsWith('---')) continue
    // Truncate at 150 chars
    return trimmed.slice(0, 150) + (trimmed.length > 150 ? '...' : '')
  }
  return `${skill.name} skill (no description available)`
}

// ── Singleton ────────────────────────────────────────────────────────────────

export const progressiveSkillLoader = new ProgressiveDisclosureManager()

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Convenience: build the progressive skill prompt.
 * Drop-in replacement for buildActiveSkillsPrompt() from skill-loader.ts.
 */
export async function buildProgressiveSkillPrompt(
  recentMessages: Array<{ role: string; content: string }> = [],
): Promise<string> {
  return progressiveSkillLoader.buildProgressivePrompt(recentMessages)
}

/**
 * Convenience: detect triggered skills.
 */
export async function detectTriggeredSkills(
  recentMessages: Array<{ role: string; content: string }>,
): Promise<TriggeredSkill[]> {
  return progressiveSkillLoader.detectTriggeredSkills(recentMessages)
}

/**
 * Convenience: reset state for a new session.
 */
export function resetProgressiveDisclosure(): void {
  progressiveSkillLoader.reset()
}
