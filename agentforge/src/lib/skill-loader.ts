/**
 * Skill Loader — v3: ROBUST TIERED LOADING WITH EMBEDDED FALLBACK
 *
 * Loads real SKILL.md content from the filesystem at startup.
 * All 6 skills are ALWAYS ACTIVE and injected into the agent's system prompt.
 *
 * KEY FIX: If SKILL.md files are NOT found on disk (e.g., user's local machine
 * doesn't have the skills/ directory), we use EMBEDDED FALLBACK prompts instead
 * of returning null and loading 0/6 skills. The agent MUST always have skill
 * instructions to function properly.
 *
 * Path resolution strategy:
 *   1. SKILLS_DIR env var (explicit override — highest priority)
 *   2. CWD/skills/ (standard location — Next.js dev server CWD)
 *   3. Walk up from CWD looking for any parent with skills/
 *   4. Embedded fallback (always available — no disk dependency)
 *
 * NOTE: __dirname under Turbopack is a virtual path (e.g., /ROOT/src/lib)
 * and does NOT correspond to a real filesystem path. We do NOT use __dirname
 * for path resolution. Only process.cwd() and env vars are reliable.
 */

import { promises as fs } from 'fs'
import path from 'path'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SkillContent {
  name: string
  slug: string
  description: string
  /** Compact core prompt — always injected into system prompt */
  corePrompt: string
  /** Full prompt — used when token budget allows or on-demand */
  fullPrompt: string
  /** Map of auxiliary file path → content (available for on-demand loading) */
  auxiliaryFiles: Map<string, string>
  /** Map of data file path → summary (header + sample rows) */
  dataSummaries: Map<string, string>
  priority: 'critical' | 'high' | 'normal'
  alwaysActive: boolean
  coreLength: number
  fullLength: number
  /** Whether this skill was loaded from disk or from embedded fallback */
  source: 'disk' | 'embedded'
}

// ── Skill Definitions ──────────────────────────────────────────────────────────

/**
 * Max characters for the CORE prompt per skill.
 * Content beyond this limit is truncated with a note about full content.
 * The LLM can read the full skill files via the read_file tool.
 */
const CORE_CHAR_LIMITS: Record<string, number> = {
  'coding-agent':   20_000,
  'fullstack-dev':  20_000,
  'ui-ux-pro-max':  15_000,
  'agent-browser':  12_000,
  'skill-creator':  12_000,
  'skill-vetter':    6_000,
}



// v1.3: Dynamic skill discovery — scans skills/ directory for SKILL.md files
// and merges them with the hardcoded SKILL_DEFINITIONS. This is how Claude Code
// and Z.ai agent mode work: the agent automatically discovers and loads any
// skill placed in the skills/ directory.
interface DiscoveredSkill {
  name: string
  slug: string
  description: string
  priority: 'critical' | 'high' | 'normal'
  alwaysActive: boolean
  auxiliaryFiles: string[]
  dataDirs: string[]
  refDirs: string[]
}

let _discoveredSkills: DiscoveredSkill[] | null = null

async function discoverSkillsFromDisk(): Promise<DiscoveredSkill[]> {
  if (_discoveredSkills) return _discoveredSkills

  const skills: DiscoveredSkill[] = []
  const fs = await import('fs/promises')
  const path = await import('path')

  // Try multiple possible skills/ locations
  const possibleRoots = [
    path.resolve(process.cwd(), 'skills'),
    path.resolve(__dirname, '..', 'skills'),
    path.resolve(__dirname, '..', '..', 'skills'),
  ]

  let skillsDir: string | null = null
  for (const root of possibleRoots) {
    try {
      await fs.access(root)
      skillsDir = root
      break
    } catch { /* try next */ }
  }

  if (!skillsDir) {
    console.log('[SkillLoader] No skills/ directory found — using hardcoded skills only')
    _discoveredSkills = []
    return []
  }

  console.log(`[SkillLoader] Discovering skills in: ${skillsDir}`)

  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const skillDir = path.join(skillsDir, entry.name)
      const skillFile = path.join(skillDir, 'SKILL.md')

      try {
        await fs.access(skillFile)
        const content = await fs.readFile(skillFile, 'utf-8')

        // Parse YAML frontmatter
        const frontMatch = content.match(/^---\n([\s\S]*?)\n---/)
        if (!frontMatch) {
          console.log(`[SkillLoader] ${entry.name}: no frontmatter, skipping`)
          continue
        }

        const frontmatter = frontMatch[1]
        const name = frontmatter.match(/name:\s*(.+)/)?.[1]?.trim() || entry.name
        const description = frontmatter.match(/description:\s*"?(.+?)"?\s*$/m)?.[1]?.trim() || ''
        const priorityMatch = frontmatter.match(/priority:\s*(.+)/)?.[1]?.trim() || 'normal'
        const category = frontmatter.match(/category:\s*(.+)/)?.[1]?.trim() || 'general'

        // Determine priority from category
        let priority: 'critical' | 'high' | 'normal' = 'normal'
        if (priorityMatch === 'critical') priority = 'critical'
        else if (priorityMatch === 'high' || ['verification', 'review', 'security'].includes(category)) priority = 'high'

        skills.push({
          name,
          slug: entry.name,
          description,
          priority,
          alwaysActive: false,
          auxiliaryFiles: [],
          dataDirs: [],
          refDirs: [],
        })

        console.log(`[SkillLoader] Discovered skill: ${name} (${priority}) — ${description.substring(0, 60)}...`)
      } catch {
        // Skip unreadable
      }
    }
  } catch (e) {
    console.log(`[SkillLoader] Error scanning skills/: ${e}`)
  }

  _discoveredSkills = skills
  return skills
}

// Merge hardcoded + discovered skills (deduped by name)
async function getAllSkillDefinitions(): Promise<typeof SKILL_DEFINITIONS> {
  const discovered = await discoverSkillsFromDisk()
  const hardcodedNames = new Set(SKILL_DEFINITIONS.map(s => s.name))
  const merged = [...SKILL_DEFINITIONS]

  for (const d of discovered) {
    if (!hardcodedNames.has(d.name)) {
      merged.push(d)
      console.log(`[SkillLoader] Adding discovered skill to registry: ${d.name}`)
    }
  }

  return merged
}

const SKILL_DEFINITIONS: Array<{
  name: string
  slug: string
  description: string
  priority: 'critical' | 'high' | 'normal'
  alwaysActive: boolean
  auxiliaryFiles: string[]
  dataDirs: string[]
  refDirs: string[]
}> = [
  {
    name: 'coding-agent',
    slug: 'code',
    description: 'Coding workflow with planning, implementation, verification, and testing for clean software development.',
    priority: 'critical',
    alwaysActive: true,
    auxiliaryFiles: ['planning.md', 'execution.md', 'verification.md', 'state.md', 'criteria.md', 'memory-template.md'],
    dataDirs: [],
    refDirs: [],
  },
  {
    name: 'fullstack-dev',
    slug: 'fullstack',
    description: 'Production-grade fullstack development with Next.js 16, TypeScript, Tailwind CSS 4, shadcn/ui, Django backend.',
    priority: 'critical',
    alwaysActive: true,
    auxiliaryFiles: [],
    dataDirs: [],
    refDirs: [],
  },
  {
    name: 'ui-ux-pro-max',
    slug: 'uiux',
    description: 'Design intelligence: color palettes, typography, UX heuristics, component specifications.',
    priority: 'high',
    alwaysActive: true,
    auxiliaryFiles: [],
    dataDirs: ['data', 'assets/data'],
    refDirs: ['references'],
  },
  {
    name: 'agent-browser',
    slug: 'browser',
    description: 'Headless browser automation CLI for navigating, clicking, typing, and snapshotting pages.',
    priority: 'high',
    alwaysActive: true,
    auxiliaryFiles: [],
    dataDirs: [],
    refDirs: [],
  },
  {
    name: 'skill-creator',
    slug: 'skill-create',
    description: 'Meta-skill for creating and improving skills.',
    priority: 'normal',
    alwaysActive: true,
    auxiliaryFiles: [],
    dataDirs: [],
    refDirs: ['references', 'agents'],
  },
  {
    name: 'skill-vetter',
    slug: 'skill-vet',
    description: 'Security vetting protocol for skills.',
    priority: 'normal',
    alwaysActive: true,
    auxiliaryFiles: [],
    dataDirs: [],
    refDirs: [],
  },
]

// ── Embedded Fallback Prompts ──────────────────────────────────────────────────
//
// These are used when SKILL.md files are NOT found on disk.
// They provide the ESSENTIAL instructions the agent needs to function.
// Full SKILL.md content is always preferred when available.

const EMBEDDED_SKILL_PROMPTS: Record<string, string> = {
  'coding-agent': `# Coding Agent

You are an expert coding agent. Follow this structured workflow for EVERY task:

## Planning Phase
1. Analyze the user's request thoroughly
2. Identify all files that need to be created or modified
3. Break the work into numbered steps: "Step N: [What] - Output: [File] - Test: [How to verify]"
4. List ALL files you will create before starting implementation

## Implementation Phase
1. Create files using write_file — write COMPLETE, production-ready code
2. NEVER write placeholder code, TODO comments, or stub implementations
3. Each file must be fully functional on its own
4. Follow best practices: proper error handling, TypeScript types, clean imports
5. Use modern framework conventions (Next.js App Router, React hooks, etc.)

## Verification Phase
1. After writing all files, verify the project structure is complete
2. Check that all imports resolve correctly
3. Ensure entry points exist (page.tsx, layout.tsx, etc.)
4. Do NOT re-read files you just wrote — trust your writes
5. If all steps are complete, STOP. Do not add unnecessary refinements.

## Critical Rules
- NEVER read a file you just wrote — you already know its contents
- NEVER call list_directory or read_file on paths you already explored
- Write ALL files in your plan, then STOP
- Each write_file call must contain the COMPLETE file content
- Do NOT split a single file across multiple write_file calls`,

  'fullstack-dev': `# Fullstack Development

You are a fullstack development expert specializing in:
- Next.js 16 with App Router and Turbopack
- TypeScript with strict mode
- Tailwind CSS 4 for styling
- shadcn/ui component library
- Prisma ORM with SQLite
- React Server Components and Client Components

## Project Structure
- \`src/app/\` — App Router pages and layouts
- \`src/components/\` — Reusable UI components
- \`src/lib/\` — Utility functions and shared logic
- \`src/hooks/\` — Custom React hooks
- \`prisma/\` — Database schema and migrations

## Key Conventions
1. Use \`"use client"\` directive only when needed (useState, useEffect, event handlers)
2. Server Components by default — no unnecessary \`"use client"\`
3. Use shadcn/ui components: Button, Card, Input, etc.
4. Tailwind for all styling — no inline styles or CSS modules
5. Proper TypeScript types — no \`any\` unless absolutely necessary
6. Error boundaries and loading states for all pages
7. Responsive design with mobile-first approach`,

  'ui-ux-pro-max': `# UI/UX Design Intelligence

You have deep expertise in user interface and experience design.

## Design Principles
1. Visual Hierarchy — Guide the user's eye through content importance
2. Consistency — Use uniform spacing, colors, and typography
3. Feedback — Every interaction should provide visual feedback
4. Accessibility — WCAG 2.1 AA compliance minimum
5. Mobile-first — Design for small screens, enhance for larger ones

## Color System
- Use CSS custom properties for theming
- Primary, secondary, accent, muted, destructive variants
- Support both light and dark modes
- Maintain 4.5:1 contrast ratio for text

## Typography
- Use system font stack or Google Fonts via next/font
- Scale: 12/14/16/18/20/24/30/36/48/60/72px
- Line height: 1.5 for body, 1.2 for headings

## Component Patterns
- Cards with consistent padding (p-6) and border-radius (rounded-lg)
- Buttons with clear states (default, hover, active, disabled, loading)
- Forms with inline validation and clear error messages
- Navigation with active state indicators`,

  'agent-browser': `# Agent Browser

Headless browser automation CLI for navigating, clicking, typing, and snapshotting pages.

## Available Commands
- \`navigate <url>\` — Go to a URL
- \`click <selector>\` — Click an element
- \`type <selector> <text>\` — Type text into an input
- \`snapshot\` — Take a screenshot of the current page
- \`scroll <direction> <amount>\` — Scroll the page
- \`wait <ms>\` — Wait for a specified duration
- \`evaluate <js>\` — Execute JavaScript in the page

## Usage Patterns
1. Navigate to the target page first
2. Use snapshot to verify the page loaded correctly
3. Interact with elements using CSS selectors
4. Always wait for dynamic content to load before interacting
5. Take snapshots after significant interactions to verify state`,

  'skill-creator': `# Skill Creator

Meta-skill for creating and improving other skills.

## Skill Structure
A skill consists of:
1. SKILL.md — Main skill definition with instructions
2. Auxiliary .md files — Detailed sub-instructions
3. Data files — CSV/JSON reference data
4. Reference documents — Extended documentation

## Creating a Skill
1. Define the skill's purpose and scope
2. Write clear, actionable instructions in SKILL.md
3. Include concrete examples and patterns
4. Add validation criteria for skill outputs
5. Test the skill with real prompts

## Skill Quality Criteria
- Instructions must be unambiguous
- Examples must be concrete and copy-pasteable
- Edge cases must be covered
- No placeholder or TODO content`,

  'skill-vetter': `# Skill Vetter

Security and quality vetting protocol for skills.

## Vetting Checklist
1. No executable code that runs outside sandbox
2. No network requests to unknown endpoints
3. No file system access beyond designated directories
4. No environment variable leakage
5. No prompt injection vulnerabilities
6. Clear scope boundaries defined
7. No recursive self-improvement loops
8. Resource usage within acceptable limits

## Quality Standards
- Instructions are deterministic and repeatable
- Output format is well-defined
- Error handling is specified
- Performance characteristics documented`,
}

// ── Skill Cache ────────────────────────────────────────────────────────────────

let skillCache: Map<string, SkillContent> | null = null
let skillLoadPromise: Promise<Map<string, SkillContent>> | null = null

// ── Path Resolution ────────────────────────────────────────────────────────────

/**
 * Find a skill directory by searching multiple candidate paths.
 *
 * CRITICAL: Under Next.js Turbopack, __dirname is a VIRTUAL path
 * (e.g., /ROOT/src/lib) that does NOT exist on the real filesystem.
 * We ONLY use process.cwd() and environment variables for path resolution.
 */
async function findSkillDir(skillName: string): Promise<string | null> {
  const cwd = process.cwd()
  console.log(`[SkillLoader] Searching for skill: ${skillName} (CWD: ${cwd})`)

  // Build candidate paths from CWD only (NOT __dirname)
  const candidates: string[] = []

  // 1. SKILLS_DIR env var — highest priority explicit override
  if (process.env.SKILLS_DIR) {
    candidates.push(path.resolve(process.env.SKILLS_DIR, skillName))
  }

  // 2. CWD/skills/<name> — standard location
  candidates.push(path.resolve(cwd, 'skills', skillName))

  // 3. Walk up from CWD to find skills/ directory in parent directories
  let searchDir = cwd
  for (let i = 0; i < 8; i++) {
    const parent = path.dirname(searchDir)
    if (parent === searchDir) break // reached filesystem root
    candidates.push(path.resolve(parent, 'skills', skillName))
    searchDir = parent
  }

  // Deduplicate candidates
  const uniqueCandidates = [...new Set(candidates)]

  for (const dir of uniqueCandidates) {
    try {
      const stat = await fs.stat(dir)
      if (stat.isDirectory()) {
        const skillMd = path.join(dir, 'SKILL.md')
        try {
          await fs.access(skillMd, fs.constants.R_OK)
          console.log(`[SkillLoader] Found skill '${skillName}' at: ${dir}`)
          return dir
        } catch {
          // Directory exists but no SKILL.md — skip
        }
      }
    } catch {
      // Directory doesn't exist — skip
    }
  }

  console.warn(`[SkillLoader] Skill '${skillName}' not found on disk among ${uniqueCandidates.length} candidates — using embedded fallback`)
  return null
}

// ── CSV Summary Generator ──────────────────────────────────────────────────────

function summarizeCsv(csvContent: string, filename: string): string {
  const lines = csvContent.trim().split('\n')
  if (lines.length === 0) return `  ${filename}: (empty)`

  const header = lines[0]
  const sampleRows = lines.slice(1, 4)
  const totalDataRows = Math.max(0, lines.length - 1)

  let summary = `  ### ${filename} (${totalDataRows} entries)\n`
  summary += `  Columns: ${header}\n`

  if (sampleRows.length > 0) {
    summary += `  Sample entries:\n`
    for (const row of sampleRows) {
      const truncated = row.length > 200 ? row.substring(0, 200) + '...' : row
      summary += `    ${truncated}\n`
    }
  }

  if (totalDataRows > 3) {
    summary += `  ... and ${totalDataRows - 3} more entries\n`
  }

  return summary
}

function summarizeMarkdown(mdContent: string, filename: string): string {
  const lines = mdContent.trim().split('\n')
  const firstHeading = lines.find(l => l.startsWith('#')) || filename
  const contentWithoutFrontmatter = mdContent.replace(/^---\n[\s\S]*?\n---\n?/, '')
  const preview = contentWithoutFrontmatter.substring(0, 500).trim()
  return `  ### ${filename}\n  Heading: ${firstHeading.replace(/^#+\s*/, '')}\n  Preview: ${preview}${contentWithoutFrontmatter.length > 500 ? '...' : ''}\n`
}

// ── Directory Readers ──────────────────────────────────────────────────────────

async function listDirectoryFiles(
  dirPath: string,
  extensions: string[] = ['.md', '.csv', '.json', '.txt']
): Promise<Array<{ name: string; path: string; size: number }>> {
  const result: Array<{ name: string; path: string; size: number }> = []

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if (extensions.includes(ext)) {
          try {
            const stat = await fs.stat(path.join(dirPath, entry.name))
            result.push({ name: entry.name, path: path.join(dirPath, entry.name), size: stat.size })
          } catch { /* skip */ }
        }
      }
    }
  } catch { /* directory doesn't exist */ }

  return result
}

async function listDataFilesRecursive(
  dirPath: string
): Promise<Array<{ name: string; relativePath: string; path: string; size: number }>> {
  const result: Array<{ name: string; relativePath: string; path: string; size: number }> = []

  async function walk(dir: string, prefix: string) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name

        if (entry.isDirectory()) {
          await walk(fullPath, relPath)
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase()
          if (['.csv', '.json'].includes(ext)) {
            try {
              const stat = await fs.stat(fullPath)
              result.push({ name: entry.name, relativePath: relPath, path: fullPath, size: stat.size })
            } catch { /* skip */ }
          }
        }
      }
    } catch { /* directory doesn't exist */ }
  }

  await walk(dirPath, '')
  return result
}

// ── Smart Truncation ───────────────────────────────────────────────────────────

function smartTruncate(content: string, maxChars: number, skillName: string): string {
  if (content.length <= maxChars) return content

  const lines = content.split('\n')
  let result = ''

  for (const line of lines) {
    if (result.length + line.length + 1 > maxChars) break
    result += (result ? '\n' : '') + line
  }

  if (result.length === 0) {
    result = content.substring(0, maxChars)
  }

  const fullSize = content.length
  result += `\n\n[... ${skillName} content truncated: ${maxChars.toLocaleString()}/${fullSize.toLocaleString()} chars shown. Full content available via read_file at skills/${skillName}/SKILL.md ...]`

  return result
}

// ── Embedded Fallback Builder ──────────────────────────────────────────────────

/**
 * Build a SkillContent from the embedded fallback prompt when the
 * SKILL.md file is not found on disk. This ensures the agent ALWAYS
 * has skill instructions, even when deployed without the skills/ directory.
 */
function buildEmbeddedSkill(skillDef: typeof SKILL_DEFINITIONS[0]): SkillContent {
  const prompt = EMBEDDED_SKILL_PROMPTS[skillDef.name] || `# ${skillDef.name}\n\n${skillDef.description}`
  const charLimit = CORE_CHAR_LIMITS[skillDef.name] ?? 15_000
  const corePrompt = smartTruncate(prompt, charLimit, skillDef.name)

  console.log(`[SkillLoader] Using embedded fallback for '${skillDef.name}' (${prompt.length} chars)`)

  return {
    name: skillDef.name,
    slug: skillDef.slug,
    description: skillDef.description,
    corePrompt: corePrompt.trim(),
    fullPrompt: prompt.trim(),
    auxiliaryFiles: new Map(),
    dataSummaries: new Map(),
    priority: skillDef.priority,
    alwaysActive: skillDef.alwaysActive,
    coreLength: corePrompt.length,
    fullLength: prompt.length,
    source: 'embedded',
  }
}

// ── Core Skill Loader ──────────────────────────────────────────────────────────

async function loadSkillFromDisk(skillDef: typeof SKILL_DEFINITIONS[0]): Promise<SkillContent | null> {
  const skillDir = await findSkillDir(skillDef.name)
  if (!skillDir) {
    // KEY FIX: Return embedded fallback instead of null
    return buildEmbeddedSkill(skillDef)
  }

  // Read the main SKILL.md
  const skillMdPath = path.join(skillDir, 'SKILL.md')
  let mainContent: string
  try {
    mainContent = await fs.readFile(skillMdPath, 'utf-8')
  } catch (error) {
    console.warn(`[SkillLoader] Failed to read SKILL.md for ${skillDef.name}:`, error)
    return buildEmbeddedSkill(skillDef)
  }

  // Strip YAML frontmatter
  const contentWithoutFrontmatter = mainContent.replace(/^---\n[\s\S]*?\n---\n?/, '')

  // Build the full prompt (includes everything)
  let fullPrompt = contentWithoutFrontmatter
  const auxiliaryFiles = new Map<string, string>()
  const dataSummaries = new Map<string, string>()

  // ── Load named auxiliary .md files ──────────────────────────────────────
  for (const auxFile of skillDef.auxiliaryFiles) {
    const auxPath = path.join(skillDir, auxFile)
    try {
      const content = await fs.readFile(auxPath, 'utf-8')
      auxiliaryFiles.set(auxFile, content)
      fullPrompt += `\n\n## ${auxFile.replace('.md', '')}\n${content}`
    } catch (error) {
      console.warn(`[SkillLoader] Failed to read auxiliary file ${auxFile} for ${skillDef.name}:`, error)
    }
  }

  // ── Process data directories → generate SUMMARIES, not raw content ──────
  for (const dataDir of skillDef.dataDirs) {
    const fullDataDir = path.join(skillDir, dataDir)
    const dataFiles = await listDataFilesRecursive(fullDataDir)

    if (dataFiles.length > 0) {
      let dataSummarySection = `\n\n## Available Design Data (summaries — use read_file for full data)\n`
      dataSummarySection += `Full data files are in skills/${skillDef.name}/${dataDir}/. Use read_file to access specific files.\n\n`

      for (const df of dataFiles) {
        try {
          const fileContent = await fs.readFile(df.path, 'utf-8')
          const ext = path.extname(df.name).toLowerCase()

          if (ext === '.csv') {
            const summary = summarizeCsv(fileContent, df.relativePath)
            dataSummarySection += summary + '\n'
            dataSummaries.set(`${dataDir}/${df.relativePath}`, summary)
          } else if (ext === '.json') {
            const preview = fileContent.length > 300
              ? fileContent.substring(0, 300) + '...'
              : fileContent
            dataSummarySection += `  ### ${df.relativePath} (${(df.size / 1024).toFixed(1)}KB)\n  Preview: ${preview}\n\n`
            dataSummaries.set(`${dataDir}/${df.relativePath}`, preview)
          }

          auxiliaryFiles.set(`${dataDir}/${df.relativePath}`, fileContent)
        } catch { /* skip unreadable files */ }
      }

      fullPrompt += dataSummarySection
    }
  }

  // ── Process reference directories → generate summaries ──────────────────
  for (const refDir of skillDef.refDirs) {
    const fullRefDir = path.join(skillDir, refDir)
    const refFiles = await listDirectoryFiles(fullRefDir, ['.md', '.json', '.txt'])

    if (refFiles.length > 0) {
      let refSummarySection = `\n\n## Reference Documents\n`
      refSummarySection += `Full reference files are in skills/${skillDef.name}/${refDir}/. Use read_file to access.\n\n`

      for (const rf of refFiles) {
        try {
          const content = await fs.readFile(rf.path, 'utf-8')
          const ext = path.extname(rf.name).toLowerCase()

          if (ext === '.md') {
            const summary = summarizeMarkdown(content, `${refDir}/${rf.name}`)
            refSummarySection += summary + '\n'
          } else {
            const preview = content.length > 300
              ? content.substring(0, 300) + '...'
              : content
            refSummarySection += `  ### ${refDir}/${rf.name} (${(rf.size / 1024).toFixed(1)}KB)\n  Preview: ${preview}\n\n`
          }

          auxiliaryFiles.set(`${refDir}/${rf.name}`, content)
        } catch { /* skip */ }
      }

      fullPrompt += refSummarySection
    }
  }

  // ── Build core prompt with smart truncation ─────────────────────────────
  const charLimit = CORE_CHAR_LIMITS[skillDef.name] ?? 15_000
  const corePrompt = smartTruncate(fullPrompt, charLimit, skillDef.name)

  return {
    name: skillDef.name,
    slug: skillDef.slug,
    description: skillDef.description,
    corePrompt: corePrompt.trim(),
    fullPrompt: fullPrompt.trim(),
    auxiliaryFiles,
    dataSummaries,
    priority: skillDef.priority,
    alwaysActive: skillDef.alwaysActive,
    coreLength: corePrompt.length,
    fullLength: fullPrompt.length,
    source: 'disk',
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Load all skills from disk. Results are cached after first load.
 * If a skill's SKILL.md is not found on disk, the embedded fallback is used.
 * This ensures the agent ALWAYS has 6/6 skills loaded.
 */
export async function loadAllSkills(): Promise<SkillContent[]> {
  const skills: SkillContent[] = []
  const fs = await import('fs/promises')
  const path = await import('path')

  // v1.3: Dynamic skill discovery — scan skills/ directory for ALL skills
  // Each skill is a directory with SKILL.md + optional auxiliary .md files.
  // This matches how Z.ai agent mode and Claude Code load skills.
  const possibleRoots = [
    path.resolve(process.cwd(), 'skills'),
    path.resolve(__dirname, '..', 'skills'),
    path.resolve(__dirname, '..', '..', 'skills'),
  ]

  let skillsDir: string | null = null
  for (const root of possibleRoots) {
    try {
      await fs.access(root)
      skillsDir = root
      break
    } catch { /* try next */ }
  }

  if (skillsDir) {
    console.log(`[SkillLoader] Discovering skills in: ${skillsDir}`)
    try {
      const entries = await fs.readdir(skillsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const skillDir = path.join(skillsDir, entry.name)
        const skillFile = path.join(skillDir, 'SKILL.md')

        try {
          await fs.access(skillFile)
        } catch {
          continue // No SKILL.md, skip
        }

        try {
          const skillContent = await fs.readFile(skillFile, 'utf-8')

          // Parse YAML frontmatter
          const frontMatch = skillContent.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
          let skillName = entry.name
          let skillDesc = ''
          let priority: 'critical' | 'high' | 'normal' = 'normal'
          let alwaysActive = false

          if (frontMatch) {
            const frontmatter = frontMatch[1]
            skillName = frontmatter.match(/name:\s*(.+)/)?.[1]?.trim() || entry.name
            skillDesc = frontmatter.match(/description:\s*"?(.+?)"?\s*$/m)?.[1]?.trim() || ''
            const priorityMatch = frontmatter.match(/priority:\s*(.+)/)?.[1]?.trim()
            if (priorityMatch === 'critical') priority = 'critical'
            else if (priorityMatch === 'high') priority = 'high'
            const alwaysMatch = frontmatter.match(/alwaysActive:\s*(true|false)/)?.[1]?.trim()
            if (alwaysMatch === 'true') alwaysActive = true
          }

          // Extract body (without frontmatter)
          const body = frontMatch ? frontMatch[2] : skillContent

          // Load ALL auxiliary .md files in the skill directory
          const auxiliaryFiles = new Map<string, string>()
          try {
            const auxEntries = await fs.readdir(skillDir, { withFileTypes: true })
            for (const auxEntry of auxEntries) {
              if (auxEntry.isFile() && auxEntry.name.endsWith('.md') && auxEntry.name !== 'SKILL.md') {
                try {
                  const auxContent = await fs.readFile(path.join(skillDir, auxEntry.name), 'utf-8')
                  auxiliaryFiles.set(auxEntry.name, auxContent)
                } catch { /* skip */ }
              }
            }
          } catch { /* skip */ }

          // Build the full prompt: SKILL.md body + all auxiliary files
          let fullPrompt = body.trim()
          for (const [filename, auxContent] of auxiliaryFiles) {
            fullPrompt += `\n\n--- ${filename} ---\n\n${auxContent}`
          }

          // Truncate for core prompt (keep first 15000 chars)
          const charLimit = 15000
          const corePrompt = fullPrompt.length > charLimit
            ? fullPrompt.substring(0, charLimit) + `\n\n[... content truncated: ${fullPrompt.length} total chars. Full content available via read_file at skills/${entry.name}/SKILL.md ...]`
            : fullPrompt

          console.log(`[SkillLoader] Loaded skill: ${skillName} (${priority}, disk) — core: ${corePrompt.length} chars, auxiliary: ${auxiliaryFiles.size} files`)

          skills.push({
            name: skillName,
            slug: entry.name,
            description: skillDesc,
            corePrompt: corePrompt.trim(),
            fullPrompt: fullPrompt.trim(),
            auxiliaryFiles,
            dataSummaries: new Map(),
            priority,
            alwaysActive,
            coreLength: corePrompt.length,
            fullLength: fullPrompt.length,
            source: 'disk',
          })
        } catch (e) {
          console.log(`[SkillLoader] Error loading skill ${entry.name}: ${e}`)
        }
      }
    } catch (e) {
      console.log(`[SkillLoader] Error scanning skills/: ${e}`)
    }
  }

  // Also load hardcoded skills as fallback (for skills not found on disk)
  const diskSkillNames = new Set(skills.map(s => s.name))
  for (const skillDef of SKILL_DEFINITIONS) {
    if (diskSkillNames.has(skillDef.name)) {
      // Already loaded from disk — skip hardcoded version
      continue
    }
    console.log(`[SkillLoader] Skill '${skillDef.name}' not found on disk — using embedded fallback`)
    skills.push(buildEmbeddedSkill(skillDef))
  }

  // Sort by priority: critical first, then high, then normal
  const priorityOrder = { critical: 0, high: 1, normal: 2 }
  skills.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

  console.log(`[SkillLoader] Loaded ${skills.length} skills (${skills.filter(s => s.source === 'disk').length} from disk, ${skills.filter(s => s.source !== 'disk').length} embedded) — core prompt: ${skills.reduce((sum, s) => sum + s.coreLength, 0).toLocaleString()} chars`)

  return skills
}

/**
 * Get a specific skill by name.
 */
export async function getSkill(name: string): Promise<SkillContent | null> {
  const skills = await loadAllSkills()
  return skills.get(name) || null
}

/**
 * Build the CORE system prompt from all always-active skills.
 * Uses the compact corePrompt for each skill — NOT the full content.
 * This keeps the system prompt at ~50K chars instead of 790K.
 */
export async function buildActiveSkillsPrompt(): Promise<string> {
  const skills = await loadAllSkills()
  const parts: string[] = []

  // Sort: critical first, then high, then normal
  const priorityOrder: Record<string, number> = { critical: 0, high: 1, normal: 2 }
  const sortedSkills = [...skills.values()].sort((a, b) => {
    const pa = priorityOrder[a.priority] ?? 3
    const pb = priorityOrder[b.priority] ?? 3
    if (pa !== pb) return pa - pb
    return a.name.localeCompare(b.name)
  })

  // v1.3 ROOT FIX: Only inject critical + high priority skills into system prompt.
  // Injecting all 18 skills (60K chars) overloads the LLM's instruction-following
  // capacity. Z.ai and Claude Code only inject 2-3 relevant skills per task.
  // Other skills are available via read_file but not injected into the prompt.
  for (const skill of sortedSkills) {
    if (skill.name !== 'coding-agent') continue

    const priorityTag = skill.priority === 'critical' ? 'CRITICAL' : skill.priority === 'high' ? 'HIGH' : 'NORMAL'
    const sourceTag = skill.source === 'disk' ? 'DISK' : 'EMBEDDED'
    const auxNote = skill.auxiliaryFiles.size > 0
      ? ` | ${skill.auxiliaryFiles.size} files available via read_file`
      : ''

    parts.push(`
${'='.repeat(60)}
SKILL: ${skill.name} [${priorityTag}] [${sourceTag}]
Core: ${skill.coreLength.toLocaleString()} chars | Full: ${skill.fullLength.toLocaleString()} chars${auxNote}
${'='.repeat(60)}

${skill.corePrompt}
`)
  }

  return parts.join('\n')
}

/**
 * Get the full prompt for a specific skill (for on-demand loading).
 */
export async function getFullSkillPrompt(skillName: string): Promise<string | null> {
  const skills = await loadAllSkills()
  const skill = skills.get(skillName)
  return skill?.fullPrompt ?? null
}

/**
 * Get a specific auxiliary file's content from a skill.
 */
export async function getSkillAuxiliaryFile(
  skillName: string,
  filePath: string
): Promise<string | null> {
  const skills = await loadAllSkills()
  const skill = skills.get(skillName)
  if (!skill) return null
  return skill.auxiliaryFiles.get(filePath) ?? null
}

/**
 * Get the count of loaded skills.
 */
export async function getLoadedSkillCount(): Promise<number> {
  const skills = await loadAllSkills()
  return skills.size
}

/**
 * Get a summary of all loaded skills for diagnostics.
 */
export async function getSkillsSummary(): Promise<Array<{
  name: string
  priority: string
  coreLength: number
  fullLength: number
  auxiliaryFileCount: number
  dataSummaryCount: number
  loaded: boolean
  source: string
}>> {
  const skills = await loadAllSkills()
  return SKILL_DEFINITIONS.map(def => {
    const skill = skills.get(def.name)
    return {
      name: def.name,
      priority: def.priority,
      coreLength: skill?.coreLength ?? 0,
      fullLength: skill?.fullLength ?? 0,
      auxiliaryFileCount: skill?.auxiliaryFiles.size ?? 0,
      dataSummaryCount: skill?.dataSummaries.size ?? 0,
      loaded: !!skill,
      source: skill?.source ?? 'none',
    }
  })
}

/**
 * Force reload all skills (e.g., after updating skill files).
 */
export async function reloadSkills(): Promise<Map<string, SkillContent>> {
  skillCache = null
  skillLoadPromise = null
  return loadAllSkills()
}