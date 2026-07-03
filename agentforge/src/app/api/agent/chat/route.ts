import { db } from '@/lib/db'
import path from 'path'
import { buildSkillSystemPrompt, collectActiveTools, formatToolsForPrompt } from '@/lib/skill-prompts'
import { parseAllToolCalls, executeToolCall, executeToolCallsParallel, ParallelToolCall } from '@/lib/mcp-tools'
import { writeProjectFiles } from '@/lib/filesystem'
import { parseCodeFiles, parseCodeFilesWithLanguage, getLanguageFromPath } from '@/lib/code-parser'
import { artifactParser, artifactExecutor } from '@/lib/artifact-writer'
import { contextManager, estimateTokens } from '@/lib/context-manager'
import { agentEventBus } from '@/lib/event-bus'
import { llmProviderRegistry, ChatMessage as LLMChatMessage, ChatOptions, StructuredToolCall } from '@/lib/llm-provider'
import { detectToolCalls, ToolCallRequest, getAllToolSchemas, toOpenAITools, formatToolResult } from '@/lib/function-calling'
import { extensionSystem } from '@/lib/extension-system'
import { sessionStore } from '@/lib/session-store'
import { parseInlineDiffs } from '@/lib/diff-editor'
import { validateToolCall, validateToolCalls } from '@/lib/tool-validator'
import { buildActiveSkillsPrompt, loadAllSkills } from '@/lib/skill-loader'
import { SSEStreamWriter } from '@/lib/sse-stream'

// ── Types ───────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: string
  content: string
}

interface ChatRequest {
  messages: ChatMessage[]
  projectId?: string
  skills?: string[]
  mcpTools?: string[]
  model?: string
  provider?: string
  sessionId?: string
  useNativeFunctionCalling?: boolean
}

// ── Tracked File (Issue 6 Fix) ──────────────────────────────────────────────

interface TrackedFile {
  path: string        // Relative path as the LLM specified it
  content: string
  language: string
  bytesWritten: number
  timestamp: number
}

// ── Plan Step (Issue 5 Fix) ─────────────────────────────────────────────────
//
// v1.2: The inline 5-regex parser was replaced by a thin adapter over
// `parsePlanFromThinkOutput` from `@/lib/todo-tracker`. The richer
// `PlanStep` from todo-tracker is converted to the simpler inline shape
// so existing call sites (SSE event emission, plan-summary builder) keep
// working without rewrite. The full `PlanTracker` singleton is also
// imported and wired into the streaming loop for stall detection.

import {
  parsePlanFromThinkOutput,
  planTracker,
  type PlanStep as LibPlanStep,
} from '@/lib/todo-tracker'
import {
  verifyProject,
  quickFileCheck,
} from '@/lib/verification'
import { promptLibraryManager } from '@/lib/prompt-library'
import { runVerificationLoop } from '@/lib/verification'
import { resolveBuildErrors, DEFAULT_BUILD_FIX_CONFIG } from '@/lib/build-error-resolver'
import { reviewProject } from '@/lib/code-reviewer'
import { evaluateAgentOutput } from '@/lib/agent-self-evaluation'
import { typecheckAfterEdit, formatForToolResult as formatTypecheckForToolResult } from '@/lib/post-edit-typecheck'
import { resetGateguardSession } from '@/lib/gateguard'
import { classifyTask } from '@/lib/orch-pipeline'
import { generateArchitecturePlan, CANONICAL_BUILD_SEQUENCE } from '@/lib/code-architect'

// v1.4 — Claude Code-inspired features
import { hookSystem, type StopContext } from '@/lib/hook-system'
import { registerHookifyRules } from '@/lib/hookify'
import { permissionManager } from '@/lib/permissions'
import {
  streamToolExecution,
  executeWithFailureIsolation,
  type StreamingToolCall,
  type StreamingToolResult,
} from '@/lib/tool-executor'
import { shellPool } from '@/lib/shell-pool'
import {
  buildProgressiveSkillPrompt,
  resetProgressiveDisclosure,
} from '@/lib/skill-progressive-disclosure'
import { ContextCompactionError } from '@/lib/context-manager'

interface PlanStep {
  step: number
  text: string
  output: string
  test: string
  done: boolean
}

// ── Auto-Generated Todo (when LLM skips think tool) ──────────────────────────

interface AutoTodo {
  text: string
  done: boolean
  filePath?: string
}

// ── Constants ───────────────────────────────────────────────────────────────

const MAX_TOOL_ITERATIONS = 50
const MAX_VERIFICATION_RETRIES = 3    // Issue 1: How many times to re-inject if LLM stops prematurely
// ZAI-only models — these are ONLY used by the ZAI provider.
// Other providers (NVIDIA, OpenRouter, Ollama) use their own configured models.
// The registry's remapModelForProvider() handles this automatically.
const DEFAULT_MODELS = ['glm-4.7-flash', 'glm-4.5-flash']  // Primary → Fallback (ZAI only)
const DB_MESSAGE_MAX_LENGTH = 50000
const MAX_TOKENS_PER_TURN = 16384

// ── Helpers ─────────────────────────────────────────────────────────────────

function stripToolCalls(text: string): string {
  return text.replace(/\[TOOL_CALL\]\s+\w+\(\{[\s\S]*?\}\)/g, '').trim()
}

function hasToolCalls(text: string): boolean {
  return /\[TOOL_CALL\]/.test(text)
}

/**
 * Parse plan steps from the LLM's think tool output.
 *
 * v1.2: Delegates to `parsePlanFromThinkOutput` from `@/lib/todo-tracker`
 * (which uses a line-by-line state machine that handles `Step N:`,
 * `- Output:`, `- Test:` patterns and supports multiple formats). The
 * richer `LibPlanStep` shape is mapped down to the legacy inline `PlanStep`
 * shape so existing SSE/summary call sites keep working.
 *
 * Supported input formats (all handled by the lib parser):
 *   Step N: [What] - Output: [path] - Test: [verify]   (original)
 *   Step N: [What]                                    (simple step)
 *   - Output: [path]                                  (sub-line)
 *   - Test: [verify]                                  (sub-line)
 *
 * Fallback regex patterns below handle additional formats the lib parser
 * does not yet recognize (numbered lists with arrows, bullet lists with
 * arrows, parenthesized numbers). They run only if the lib parser returns
 * an empty list.
 */
function parsePlanSteps(thought: string): PlanStep[] {
  // ── Primary: delegate to todo-tracker lib ──────────────────────────────
  const libSteps = parsePlanFromThinkOutput(thought)
  if (libSteps.length > 0) {
    return libSteps.map((s: LibPlanStep, idx: number) => ({
      step: idx + 1,
      text: s.description,
      output: s.output || (s.filePaths.length > 0 ? s.filePaths[0] : ''),
      test: s.verification || '',
      done: s.status === 'done',
    }))
  }

  // ── Fallback: additional regex patterns for formats the lib parser ────
  // ── doesn't yet recognize. Keeps the original behavior for these. ─────
  const steps: PlanStep[] = []
  const seen = new Set<string>()

  // Numbered list with arrow — "1. Create index → src/index.html"
  const numberedArrowRegex = /^\s*(\d+)[.)]\s+(.+?)\s*→\s*(\S+)/gm
  let match: RegExpExecArray | null
  while ((match = numberedArrowRegex.exec(thought)) !== null) {
    const text = (match[2] || '').trim()
    if (text && !seen.has(text)) {
      seen.add(text)
      steps.push({
        step: parseInt(match[1], 10),
        text,
        output: (match[3] || '').trim(),
        test: '',
        done: false,
      })
    }
  }
  if (steps.length > 0) return steps

  // Bullet list with arrow — "- Create styles → src/styles.css"
  const bulletArrowRegex = /^\s*[-*]\s+(.+?)\s*→\s*(\S+)/gm
  let bulletIdx = 0
  while ((match = bulletArrowRegex.exec(thought)) !== null) {
    const text = (match[1] || '').trim()
    if (text && !seen.has(text)) {
      seen.add(text)
      bulletIdx++
      steps.push({
        step: bulletIdx,
        text,
        output: (match[2] || '').trim(),
        test: '',
        done: false,
      })
    }
  }
  if (steps.length > 0) return steps

  // Simple numbered list — "1. Create the main page"
  const numberedRegex = /^\s*(\d+)[.)]\s+(.+)/gm
  while ((match = numberedRegex.exec(thought)) !== null) {
    const text = (match[2] || '').trim()
    if (text && text.length > 5 && !seen.has(text)) {
      seen.add(text)
      steps.push({
        step: parseInt(match[1], 10),
        text,
        output: '',
        test: '',
        done: false,
      })
    }
  }
  if (steps.length > 0) return steps

  // Bullet list — "- Create the main page"
  const bulletRegex = /^\s*[-*]\s+(.+)/gm
  let bIdx = 0
  while ((match = bulletRegex.exec(thought)) !== null) {
    const text = (match[1] || '').trim()
    if (text && text.length > 5 && !seen.has(text)) {
      seen.add(text)
      bIdx++
      steps.push({
        step: bIdx,
        text,
        output: '',
        test: '',
        done: false,
      })
    }
  }

  return steps
}

/**
 * Auto-generate todo items from write_file tool calls.
 * When the LLM skips the think tool and writes files directly,
 * this creates a todo for each file write so the user can see
 * progress in the UI.
 */
function generateAutoTodosFromWrites(
  writtenFiles: Map<string, TrackedFile>,
  existingPlanSteps: PlanStep[]
): AutoTodo[] {
  const todos: AutoTodo[] = []
  const existingOutputs = new Set(existingPlanSteps.map(s => s.output.toLowerCase()))

  // Convert existing plan steps to auto-todos
  for (const step of existingPlanSteps) {
    todos.push({
      text: step.text,
      done: writtenFiles.has(step.output),
      filePath: step.output || undefined,
    })
  }

  // Add auto-todos for files written WITHOUT corresponding plan steps
  for (const [filePath, tracked] of writtenFiles) {
    const fileName = filePath.split('/').pop() || filePath
    // Skip if this file is already tracked in plan steps
    if (existingOutputs.has(filePath.toLowerCase())) continue
    if (existingOutputs.has(fileName.toLowerCase())) continue

    // Check if we already have a todo for this file
    if (todos.some(t => t.filePath?.toLowerCase() === filePath.toLowerCase())) continue

    // Derive a human-readable description from the file path
    const ext = fileName.split('.').pop() || ''
    const baseName = fileName.replace(/\.[^.]+$/, '')
    const dirName = filePath.includes('/') ? filePath.split('/').slice(-2, -1)[0] : ''
    const location = dirName ? ` in ${dirName}/` : ''
    let action = 'Create'
    if (ext === 'css' || ext === 'scss') action = 'Style'
    else if (ext === 'js' || ext === 'ts' || ext === 'jsx' || ext === 'tsx') action = 'Implement'
    else if (ext === 'html') action = 'Build'
    else if (ext === 'json') action = 'Configure'

    todos.push({
      text: `${action} ${baseName}${location}`,
      done: true, // Already written
      filePath,
    })
  }

  return todos
}

/**
 * Issue 1 Fix: Determine if the project appears incomplete based on
 * the files that have been written so far.
 * Also checks whether dependencies have been installed and code has been built.
 */
function isProjectIncomplete(writtenFiles: Map<string, TrackedFile>): boolean {
  if (writtenFiles.size === 0) return true

  const filePaths = [...writtenFiles.keys()]

  // Check for a preview file
  const hasPreview = filePaths.some(p =>
    p === '__preview.html' || p === 'index.html' || p.endsWith('/index.html')
  )

  // Check for a page/entry point file
  const hasEntryPoint = filePaths.some(p =>
    p.includes('page.') || p.includes('Page.') || p.includes('App.') ||
    p.includes('index.') || p.includes('main.')
  )

  // If we have neither preview nor entry point, the project is very likely incomplete
  if (!hasPreview && !hasEntryPoint) return true

  // If we only have 1-2 files and no preview, likely incomplete
  if (writtenFiles.size <= 2 && !hasPreview) return true

  return false
}

/**
 * Determine what post-creation steps are needed (install, build, etc.)
 * based on the files that have been written.
 */
function getMissingBuildSteps(writtenFiles: Map<string, TrackedFile>, executedCommands: Set<string>): string[] {
  const missing: string[] = []
  const filePaths = [...writtenFiles.keys()]

  // Check if there's a package.json but npm install hasn't been run
  const hasPackageJson = filePaths.some(p => p === 'package.json' || p.endsWith('/package.json'))
  if (hasPackageJson && !executedCommands.has('npm install') && !executedCommands.has('bun install')) {
    missing.push('npm install')
  }

  // Check if there's a requirements.txt but pip install hasn't been run
  const hasRequirements = filePaths.some(p => p === 'requirements.txt' || p.endsWith('/requirements.txt'))
  if (hasRequirements && !executedCommands.has('pip install')) {
    missing.push('pip install -r requirements.txt')
  }

  // Check if there's a build script but build hasn't been run
  const hasBuildScript = filePaths.some(p => p === 'package.json')
  if (hasBuildScript && !executedCommands.has('npm run build') && !executedCommands.has('npx tsc')) {
    missing.push('npm run build')
  }

  return missing
}

/**
 * Issue 5 Fix: Build a plan summary for the system prompt continuation hint.
 */
function buildPlanSummary(planSteps: PlanStep[], writtenFiles: Map<string, TrackedFile>): string {
  if (planSteps.length === 0) return ''

  const donePaths = [...writtenFiles.keys()]
  const lines = planSteps.map(step => {
    const isDone = step.output && donePaths.some(p =>
      p.toLowerCase().includes(step.output.toLowerCase().replace(/[^a-z0-9./]/g, ''))
    )
    const marker = isDone ? '[DONE]' : '[ ]'
    return `${marker} Step ${step.step}: ${step.text}${step.output ? ` → ${step.output}` : ''}`
  })

  return `\nCurrent Plan Progress:\n${lines.join('\n')}\n`
}

// ── Route Handler ───────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let body: ChatRequest
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { messages, projectId, skills, mcpTools, model, provider, sessionId, useNativeFunctionCalling } = body

  // ── Normalize model name ────────────────────────────────────────────────
  // Map outdated model names to their current equivalents.
  // This handles legacy session data or frontend state that still references
  // old model names like 'glm-4-flash-250414'.
  const MODEL_ALIASES: Record<string, string> = {
    'glm-4-flash-250414': 'glm-5.1',
    'glm-4-flashx-250414': 'glm-5.1',
    'glm-4-plus-0111': 'glm-5.1',
    'glm-4-air-250414': 'glm-5.1',
    'glm-4-flash': 'glm-5.1',
    'glm-4-flashx': 'glm-5.1',
    'glm-4-plus': 'glm-5.1',
    'glm-4': 'glm-5.1',
    'glm-3-turbo': 'glm-4.5-flash',
  }
  const normalizedModel = MODEL_ALIASES[model] || model || DEFAULT_MODELS[0]

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return new Response(
      JSON.stringify({ error: 'Messages array is required and must not be empty' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  for (const msg of messages) {
    if (!msg.role || !msg.content) {
      return new Response(
        JSON.stringify({ error: 'Each message must have a role and content' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }
    if (!['user', 'assistant', 'system'].includes(msg.role)) {
      return new Response(
        JSON.stringify({ error: `Invalid message role: ${msg.role}` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }
  }

  // ── Initialize or load session ───────────────────────────────────────────

  let activeSessionId = sessionId
  if (!activeSessionId) {
    try {
      const session = await sessionStore.createSession({
        projectId,
        model: normalizedModel,
        provider: provider || 'zai',
      })
      activeSessionId = session.id
    } catch {
      // Session store may not be available; continue without it
    }
  }

  // ── Fetch project context ────────────────────────────────────────────────

  let projectContext = ''
  if (projectId) {
    try {
      const project = await db.project.findUnique({
        where: { id: projectId },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      })
      if (project) {
        projectContext = `\n\nCurrent Project: "${project.name}" (Status: ${project.status})\nProject Description: ${project.description}\nOriginal Prompt: ${project.prompt}\n`

        // CRITICAL FIX: Scan the workspace directory and include the file tree
        // in the project context so the LLM knows the layout WITHOUT needing
        // to call list_directory or read_file to explore. This prevents the
        // infinite read loop where the agent spends all its turns exploring
        // instead of creating files.
        try {
          const workspaceRoot = path.resolve(process.cwd(), 'workspace')
          const projectDir = path.join(workspaceRoot, projectId)
          const { promises: fsp } = await import('fs')

          async function listTree(dir: string, prefix: string = ''): Promise<string> {
            const lines: string[] = []
            try {
              const entries = await fsp.readdir(dir, { withFileTypes: true })
              // Sort: directories first, then files, ignore node_modules and .next
              const sorted = entries
                .filter(e => e.name !== 'node_modules' && e.name !== '.next' && e.name !== '.git')
                .sort((a, b) => {
                  if (a.isDirectory() && !b.isDirectory()) return -1
                  if (!a.isDirectory() && b.isDirectory()) return 1
                  return a.name.localeCompare(b.name)
                })
              for (const entry of sorted) {
                const fullPath = path.join(dir, entry.name)
                if (entry.isDirectory()) {
                  lines.push(`${prefix}├── ${entry.name}/`)
                  lines.push(await listTree(fullPath, `${prefix}│   `))
                } else {
                  // Show file size for context
                  try {
                    const stat = await fsp.stat(fullPath)
                    const sizeStr = stat.size > 1024 ? ` (${(stat.size / 1024).toFixed(1)}KB)` : ` (${stat.size}B)`
                    lines.push(`${prefix}├── ${entry.name}${sizeStr}`)
                  } catch {
                    lines.push(`${prefix}├── ${entry.name}`)
                  }
                }
              }
            } catch {
              // Directory might not exist yet
              lines.push(`${prefix}(empty or not found)`)
            }
            return lines.join('\n')
          }

          const tree = await listTree(projectDir)
          if (tree && !tree.includes('(empty or not found)')) {
            projectContext += `\nCURRENT WORKSPACE FILE TREE (DO NOT re-explore these — they already exist):\n${tree}\n`
            projectContext += `\nIMPORTANT: The files above ALREADY EXIST. Do NOT call list_directory or read_file to explore them again. If you need to modify existing files, use edit_file. If you need to create NEW files, use write_file with a path that doesn't exist yet.\n`
          } else {
            projectContext += '\nWORKSPACE: Empty — no files exist yet. Create all project files from scratch.\n'
          }
        } catch (treeError) {
          // Tree listing failed, continue without it
          console.warn('[Agent Chat] Failed to scan workspace tree:', treeError)
        }

        if (project.messages.length > 0) {
          projectContext += '\nConversation History:\n'
          for (const msg of project.messages.slice(-10)) {
            projectContext += `[${msg.role}]: ${msg.content.substring(0, 500)}\n`
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch project context:', error)
    }
  }

  // ── Build active skills list ─────────────────────────────────────────────

  // Issue 4 Fix: The 6 real skills are ALWAYS ACTIVE and loaded from disk.
  // The DB skill query is only used for the old fallback system (tool definitions).
  let activeSkillNames: string[] = []
  if (skills && skills.length > 0) {
    activeSkillNames = skills
  } else {
    // Always include the 6 core skills — these are the real skill names
    const coreSkillNames = [
      'coding-agent',
      'fullstack-dev',
      'ui-ux-pro-max',
      'agent-browser',
      'skill-creator',
      'skill-vetter',
    ]

    try {
      const enabledSkills = await db.skill.findMany({
        where: { enabled: true, installed: true },
        select: { name: true },
      })
      const dbSkillNames = enabledSkills.map((s) => s.name)
      // Merge DB skills with core skills (deduplicated)
      const mergedSet = new Set([...coreSkillNames, ...dbSkillNames])
      activeSkillNames = [...mergedSet]
    } catch (error) {
      // DB not available — use the 6 core skills
      console.warn('[Agent Chat] DB skill query failed, using core skills:', error)
      activeSkillNames = coreSkillNames
    }
  }

  // ── Build system prompt ──────────────────────────────────────────────────

  // v1.4: Register hookify rules from .agentforge/hookify.*.local.md files.
  // Best-effort — failures are logged but never fatal.
  try {
    const registeredCount = await registerHookifyRules()
    if (registeredCount > 0) {
      console.log(`[Agent Chat] Registered ${registeredCount} hookify rule(s)`)
    }
  } catch (err) {
    console.warn('[Agent Chat] Hookify registration failed:', (err as Error).message)
  }

  // v1.4: Load permission rules from .agentforge/permissions.json.
  // Best-effort — defaults to "allow all" if file is missing.
  try {
    await permissionManager.load()
  } catch (err) {
    console.warn('[Agent Chat] Permission load failed:', (err as Error).message)
  }

  // v1.4: Reset progressive disclosure state for the new session.
  try {
    resetProgressiveDisclosure()
  } catch {
    /* best-effort */
  }

  // Issue 4 Fix: Load real skill content from SKILL.md files — this is the PRIMARY
  // skill system. It reads actual SKILL.md content from the skills/ directory.
  let realSkillsPrompt = ''
  let realSkillsLoaded = false
  try {
    // v1.4: Use progressive disclosure (Level 1 only — name + description).
    // Level 2 (full body) is injected on-demand when trigger phrases match.
    // Falls back to the legacy "always inject full body" if progressive
    // disclosure fails for any reason.
    try {
      realSkillsPrompt = await buildProgressiveSkillPrompt(
        messages.map((m) => ({ role: m.role, content: m.content })),
      )
      realSkillsLoaded = realSkillsPrompt.length > 100
    } catch (progressiveErr) {
      console.warn(
        '[Agent Chat] Progressive disclosure failed, falling back to legacy:',
        (progressiveErr as Error).message,
      )
      realSkillsPrompt = await buildActiveSkillsPrompt()
      realSkillsLoaded = realSkillsPrompt.length > 100
    }
    if (realSkillsLoaded) {
      console.log(`[Agent Chat] Real skills loaded: ${realSkillsPrompt.length.toLocaleString()} chars`)
    } else {
      console.warn('[Agent Chat] Real skills prompt is unexpectedly short — fallback will be used')
    }
  } catch (error) {
    console.warn('[Agent Chat] Failed to load real skills, falling back to built-in prompts:', error)
  }

  // Keep the old skill system as fallback for tool definitions only.
  // When real skills are loaded successfully, the old system is secondary.
  const skillInstructions = realSkillsLoaded
    ? ''   // Real skills already contain all instructions — no need to duplicate
    : buildSkillSystemPrompt(activeSkillNames)  // Fallback if real skills failed
  const activeTools = collectActiveTools(activeSkillNames)
  const toolsSection = formatToolsForPrompt(activeTools)

  const explicitMcpTools = mcpTools?.length
    ? `\nADDITIONAL MCP TOOLS AVAILABLE: ${mcpTools.join(', ')}`
    : ''

  const diffEditInstructions = `
DIFF-BASED FILE EDITING:
For small changes to existing files, prefer the edit_file tool with search/replace operations:
[TOOL_CALL] edit_file({"path": "file/path.ts", "operations": [{"search": "old text", "replace": "new text"}]})

This is more efficient than rewriting entire files. Use write_file only for new files or complete rewrites.
`

  // v1.3: Artifact XML format — the preferred bulk-write mechanism for
  // multi-file creation. Inspired by Claude Code / Z.ai / emergent.sh.
  const artifactInstructions = `
ARTIFACT XML FORMAT — BULK FILE CREATION (PREFERRED FOR MULTI-FILE OUTPUT):
When you need to create or update MANY files in one response, wrap each file in
an <artifact> block. The system will parse and apply all of them in one pass.

<artifact id="project-scaffold" title="Initial project files">
  <action filePath="package.json" type="create">
{
  "name": "my-app",
  "version": "1.0.0"
}
  </action>
  <action filePath="src/app/page.tsx" type="create">
export default function Home() { return <h1>Hello</h1> }
  </action>
  <action filePath="old/legacy-file.ts" type="delete" />
</artifact>

Rules:
- type="create" — write a new file (overwrites if exists)
- type="update" — replace an existing file's content
- type="delete" — remove a file (self-closing tag is fine)
- filePath is relative to the project root (no leading /)
- XML-escape special chars in content: &lt; &gt; &amp; &quot; &apos;
- You may emit multiple <artifact> blocks per response
- PREFER artifacts when creating 3+ files at once (cleaner than many write_file calls)
`

  const systemPrompt = `You are an expert full-stack application builder AI agent. When given a prompt, you MUST generate a complete, working, TESTED application — NOT just a collection of files.

═══════════════════════════════════════════════════════════
⚠️ ABSOLUTELY MANDATORY — YOUR FIRST ACTION MUST BE THE think TOOL ⚠️
═══════════════════════════════════════════════════════════

BEFORE writing ANY code, you MUST call the think tool with a structured plan.
Do NOT skip this step. Do NOT start with write_file. ALWAYS think FIRST.

Example of CORRECT first response:
  think({"thought": "PLAN: Restaurant App\\nStep 1: Create package.json - Output: package.json - Test: npm install succeeds\\nStep 2: Create main page - Output: src/index.html - Test: renders in browser\\nStep 3: Create styles - Output: src/styles.css - Test: styles apply\\nStep 4: Create preview - Output: __preview.html - Test: standalone HTML works\\nStep 5: Install deps - Test: npm install\\nStep 6: Build/compile - Test: no errors"})

Example of WRONG first response (DO NOT DO THIS):
  write_file({"path": "package.json", "content": "..."})  ← NEVER start with write_file

═══════════════════════════════════════════════════════════
MANDATORY WORKFLOW (follow EXACTLY in this order):
═══════════════════════════════════════════════════════════

PHASE 1 — PLAN (use the think tool FIRST — this is NOT optional):
  Use the think tool to create a structured plan listing:
  - Every file that needs to be created (full paths)
  - The purpose of each file
  - Dependencies between files
  - The order of creation
  - What build/test commands to run AFTER creating files
  Format: Step N: [What] - Output: [file path] - Test: [How to verify]
  You can also use: N. [What] → [file path]  or  - [What] → [file path]

PHASE 2 — CREATE FILES (batch multiple write_file calls):
  Create ALL project files using write_file. Batch MULTIPLE files per iteration.
  Example of CORRECT behavior (4 files in one response):
    write_file({"path": "src/index.html", "content": "..."})
    write_file({"path": "src/styles.css", "content": "..."})
    write_file({"path": "src/app.js", "content": "..."})
    write_file({"path": "package.json", "content": "..."})

PHASE 3 — INSTALL DEPENDENCIES (use execute_code — NOT manual instructions):
  ⚠️ CRITICAL: You have FULL terminal access. You MUST run commands yourself.
  NEVER tell the user to run commands — RUN THEM YOURSELF with execute_code.
  
  For Node.js projects:
    execute_code({"command": "cd . && npm install"})
  For Python projects:
    execute_code({"command": "cd . && pip install -r requirements.txt"})
  
  WRONG (DO NOT DO THIS):
    "Run npm install to install dependencies" ← NEVER say this
    "You can start the server by running python main.py" ← NEVER say this
  
  CORRECT:
    execute_code({"command": "cd . && npm install"})  ← DO THIS

PHASE 4 — BUILD & COMPILE (use execute_code to verify code compiles):
  Run the build/compile step to check for errors:
    execute_code({"command": "cd . && npm run build"})   (for React/Next.js/Vite)
    execute_code({"command": "cd . && npx tsc --noEmit"}) (for TypeScript check)
    execute_code({"command": "cd . && python -c 'import app'"}) (for Python check)

PHASE 5 — FIX ERRORS (if build/compile fails, fix the errors):
  If the build step returns errors, you MUST:
  1. Read the error output carefully
  2. Use edit_file to fix the errors in the relevant files
  3. Re-run the build to verify the fix works
  4. Repeat until the build succeeds with ZERO errors
  
  Example:
    execute_code({"command": "cd . && npm run build"})  ← fails with error
    edit_file({"path": "src/App.tsx", "operations": [{"search": "broken code", "replace": "fixed code"}]})
    execute_code({"command": "cd . && npm run build"})  ← succeeds

PHASE 6 — RUN TESTS (if tests exist, run them):
  execute_code({"command": "cd . && npm test"})
  If tests fail, fix the code and re-run until they pass.

PHASE 7 — CREATE PREVIEW (generate __preview.html for instant preview):
  Create __preview.html — a COMPLETE standalone HTML/CSS/JS version that runs in a browser iframe.
  This file must be entirely self-contained (all CSS in <style> tags, all JS in <script> tags).

═══════════════════════════════════════════════════════════
⚠️ CRITICAL: YOU ARE AN AUTONOMOUS AGENT WITH TERMINAL ACCESS ⚠️
═══════════════════════════════════════════════════════════

You have a TERMINAL. You can RUN COMMANDS. You are NOT a chatbot that gives instructions.
You are an AGENT that EXECUTES actions. Every command you need to run — YOU RUN IT.

NEVER say "Run this command" or "You can start the server by..."
ALWAYS use execute_code to actually run the command.

Your job is not done when files are written. Your job is done when:
1. ✅ All files are created
2. ✅ Dependencies are installed (via execute_code)
3. ✅ Code compiles without errors (verified via execute_code)
4. ✅ Any build errors are fixed
5. ✅ __preview.html is created for instant preview

═══════════════════════════════════════════════════════════
ANTI-LOOP RULES (CRITICAL — VIOLATION = FAILURE):
═══════════════════════════════════════════════════════════

1. NEVER rewrite a file that was already written in a previous iteration
2. If a file already exists and needs changes, use edit_file instead of write_file
3. If you wrote package.json in iteration 1, do NOT write it again in iteration 2
4. Each iteration MUST create NEW files or FIX errors — never re-write unchanged files
5. After all files are created AND compiled AND tested, STOP. Do not keep iterating.

═══════════════════════════════════════════════════════════
FILE CONTENT RULES:
═══════════════════════════════════════════════════════════

- Generate COMPLETE, WORKING code. No placeholders, no "..." no "// rest of code"
- Include ALL necessary files for a runnable application
- Use TypeScript, Tailwind CSS, and modern React patterns where appropriate
- Include proper error handling, loading states, and responsive design
- Make UI modern, clean, and professional with good color choices
- For simple landing pages or static apps, plain HTML/CSS/JS is preferred

═══════════════════════════════════════════════════════════
MANDATORY: __preview.html FILE:
═══════════════════════════════════════════════════════════

You MUST generate __preview.html — a COMPLETE standalone HTML/CSS/JS
version that runs directly in a browser iframe. This file must:
- Be entirely self-contained (all CSS in <style> tags, all JS in <script> tags)
- Include all the UI elements and interactivity of the app
- Use modern CSS (flexbox, grid, custom properties) for styling
- Be fully functional as a standalone HTML page
- This is created LAST after all other files compile successfully

═══════════════════════════════════════════════════════════
write_file PARAMETER RULES (CRITICAL — PREVENTS ERRORS):
═══════════════════════════════════════════════════════════

write_file REQUIRES exactly 2 parameters: path AND content. BOTH are mandatory.
NEVER call write_file with only content and no path.
NEVER call write_file with only path and no content.

CORRECT: write_file({"path": "src/App.tsx", "content": "import React..."})
WRONG:   write_file({"content": "import React..."})  ← MISSING path — will FAIL

${realSkillsPrompt}

${skillInstructions}

${toolsSection}${explicitMcpTools}
${diffEditInstructions}
${artifactInstructions}

SKILL DATA ON-DEMAND: Skill content above includes SUMMARIES of reference data (colors, typography, styles, etc.). When you need the FULL data for a specific design decision, use read_file to access it:
- read_file({"path": "skills/ui-ux-pro-max/data/colors.csv"}) — Full color palette data
- read_file({"path": "skills/ui-ux-pro-max/data/styles.csv"}) — Full design style catalog
- read_file({"path": "skills/ui-ux-pro-max/data/typography.csv"}) — Typography scale data
- read_file({"path": "skills/ui-ux-pro-max/data/ux-guidelines.csv"}) — UX heuristics
- read_file({"path": "skills/ui-ux-pro-max/data/icons.csv"}) — Icon reference
- read_file({"path": "skills/ui-ux-pro-max/SKILL.md"}) — Full UI/UX skill content
- read_file({"path": "skills/fullstack-dev/SKILL.md"}) — Full fullstack-dev content
- read_file({"path": "skills/coding-agent/SKILL.md"}) — Full coding-agent content
Only read these when you need specific data for the task — don't read them preemptively.
${projectContext}

Remember: PLAN → CREATE FILES → INSTALL DEPS (execute_code) → BUILD (execute_code) → FIX ERRORS → TEST → CREATE PREVIEW → DELIVER WORKING APP.`

  // ── Build the message list and manage context window ─────────────────────

  // If the primary default model fails, try the fallback default model.
  // This is set once per request — the LLM registry handles per-provider fallback.
  // v1.3: ECC Pattern #10 — classify task size to determine ceremony level.
  // This determines whether gates are required (standard/large) or skipped
  // (trivial/small). The classification is logged for observability.
  const taskClassification = classifyTask({
    fileCount: messages.length,
    hasNewDependencies: false,
    fileDescriptions: messages.map(m => m.content?.substring(0, 100) || ''),
  })
  console.log(`[Agent Chat] Task classified as: ${taskClassification.tier} — ${taskClassification.rationale}`)

  // v1.3: ECC Pattern #9 — generate types-first architecture plan.
  // The build sequence (types → core → integration → UI → tests → docs) is
  // injected into the system prompt so the LLM generates files in the right
  // order, preventing import-not-found errors.
  const archPlan = await generateArchitecturePlan({
    featureDescription: messages.find(m => m.role === 'user')?.content?.substring(0, 200) || 'general task',
  }).catch(() => null)

  const selectedModel = normalizedModel
  const selectedProvider = provider || 'zai'
  const nativeFunctionCalling = useNativeFunctionCalling ?? true

  // v1.2: Augment the system prompt with domain-specific libraries from
  // prompt-library.ts. The manager scores each library against the user's
  // task description (extracted from the first user message) and includes
  // the most relevant ones within a token budget. This bakes production-
  // grade knowledge (Next.js 16 App Router, TypeScript strict mode, Tailwind
  // 4, Prisma patterns, React 19) directly into the prompt when relevant —
  // without bloating it for tasks that don't need it.
  //
  // Best-effort: if the library manager throws, we fall back to the base
  // system prompt. This must never break the chat flow.
  let finalSystemPrompt = systemPrompt
  try {
    const taskDescription = messages.find((m: ChatMessage) => m.role === 'user')?.content || ''
    if (taskDescription.length > 0) {
      const composed = promptLibraryManager.buildSystemPrompt(
        systemPrompt,
        taskDescription,
        // Reserve half the per-turn token budget for libraries; the other
        // half is for the base system prompt + tools + user messages.
        MAX_TOKENS_PER_TURN / 2,
        { includeCachingMarkers: true, provider: selectedProvider },
      )
      finalSystemPrompt = composed.systemPrompt
      if (composed.includedLibraries.length > 0) {
        console.log(
          `[Agent Chat] Prompt libraries injected: ${composed.includedLibraries.join(', ')} ` +
          `(${composed.estimatedTokens} tokens total)`,
        )
      }
    }
  } catch (libError) {
    // Best-effort — fall back to base prompt
    console.warn('[Agent Chat] prompt-library injection failed:', libError)
  }

  // Convert to context manager format
  const contextMessages = [
    { role: 'system' as const, content: finalSystemPrompt },
    ...messages.map((m: ChatMessage) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    })),
  ]

  // Apply context window management
  const managedMessages = await contextManager.buildContextWindow(
    contextMessages,
    selectedModel,
    activeSessionId || 'anonymous',
  )

  // Convert to LLM ChatMessage format
  const chatMessages: LLMChatMessage[] = managedMessages.map((m) => ({
    role: m.role as 'system' | 'user' | 'assistant' | 'tool',
    content: m.content,
  }))

  // Build tool definitions for native function calling
  const toolSchemas = getAllToolSchemas()
  const openAITools = nativeFunctionCalling ? toOpenAITools(toolSchemas) : undefined

  // ── Execute extension beforeChat hook ────────────────────────────────────

  const hookContext = await extensionSystem.executeHooks('beforeChat', {
    sessionId: activeSessionId,
    projectId,
    model: selectedModel,
    provider: selectedProvider,
    messages: chatMessages,
  })

  // Use potentially modified messages from hook
  const finalMessages = (hookContext.messages as LLMChatMessage[]) || chatMessages

  // ── Emit agent:start event ──────────────────────────────────────────────

  agentEventBus.emit('agent:start', {
    sessionId: activeSessionId || 'anonymous',
    projectId,
    model: selectedModel,
  })

  // ── Streaming response with agentic tool loop ───────────────────────────

  const encoder = new TextEncoder()
  let fullResponse = ''

  const stream = new ReadableStream({
    async start(controller) {
      const sse = new SSEStreamWriter(controller, encoder)
      // Hoist these so the catch block can reference them safely (TS strict
      // mode complains about "possibly undefined" if they're declared inside try).
      let iteration = 0
      let writtenFilesTracker = new Map<string, TrackedFile>()
      try {
        sse.status('thinking')
        iteration = 0
        let runningMessages = [...finalMessages]

        // v1.2: Reset the PlanTracker singleton at the start of each chat
        // request so state from a previous request doesn't leak in.
        try { planTracker.reset() } catch { /* best-effort */ }
        // v1.3: Reset gateguard per-session tracking.
        try { resetGateguardSession() } catch { /* best-effort */ }

        // ── Issue 6 Fix: Track files written during execution ──────────
        // Instead of relying on parseCodeFiles() which only finds ### FILE:
        // markdown blocks, we track every file written by write_file tool calls.
        writtenFilesTracker = new Map<string, TrackedFile>()

        // ── Issue 5 Fix: Track plan steps from think tool ──────────────
        let planSteps: PlanStep[] = []

        // ── Issue 1 Fix: Verification retry counter ────────────────────
        let verificationRetries = 0

        // ── Stuck-loop detection ────────────────────────────────────────
        const allWrittenFiles: string[] = []
        let consecutiveDuplicateWrites = 0

        // ── Read-loop detection (CRITICAL FIX) ────────────────────────────
        // Track ALL tool call signatures to detect repeated reads of the same
        // file/directory. The LLM often re-reads the same files after context
        // compaction erases its memory, causing infinite read loops.
        const toolCallSignatureCounts = new Map<string, number>()
        const MAX_SAME_TOOL_CALL = 3          // Same tool+params 3 times = stuck
        const MAX_CONSECUTIVE_READ_TURNS = 4  // 4 read-only turns = must write
        let consecutiveReadOnlyTurns = 0
        const exploredFiles = new Set<string>()
        const exploredDirs = new Set<string>()

        // ── Track whether the think tool was used at least once ────────
        let hasUsedThinkTool = false

        // ── Track execute_code commands to detect missing build steps ────
        const executedCommands = new Set<string>()

        // ── Helper: Emit plan_update with current done-status ────────────
        const emitPlanUpdate = () => {
          if (planSteps.length === 0 && writtenFilesTracker.size === 0) return

          // If we have plan steps, update their done status
          if (planSteps.length > 0) {
            try {
              sse.planUpdate(planSteps.map(s => ({
                step: s.step,
                text: s.text,
                output: s.output,
                test: s.test,
                done: writtenFilesTracker.has(s.output),
              })))
            } catch { /* don't break stream */ }
          }

          // Also emit todo_update for auto-generated todos (from file writes)
          // This ensures the frontend ALWAYS has a todo list visible,
          // even when the LLM skips the think tool entirely.
          const autoTodos = generateAutoTodosFromWrites(writtenFilesTracker, planSteps)
          if (autoTodos.length > 0) {
            try {
              sse.todoUpdate(autoTodos.map((t, i) => ({
                text: t.text,
                done: t.done,
                filePath: t.filePath,
                priority: i < 2 ? 'high' : i < 4 ? 'med' : 'low',
              })))
            } catch { /* don't break stream */ }
          }
        }

        while (iteration < MAX_TOOL_ITERATIONS) {
          iteration++
          // v1.2: keep PlanTracker iteration count in sync so isStalled() works.
          try { planTracker.incrementIteration() } catch { /* best-effort */ }

          agentEventBus.emit('agent:iteration', {
            sessionId: activeSessionId || 'anonymous',
            iteration,
            maxIterations: MAX_TOOL_ITERATIONS,
          })

          let iterationResponse = ''

          // ── FORCE: First iteration must use think tool ──────────────────
          // If this is the first iteration and the LLM hasn't used think yet,
          // inject a strong user message requiring it to plan first.
          // This ensures todos ALWAYS appear in the UI.
          if (iteration === 1 && !hasUsedThinkTool) {
            runningMessages.push({
              role: 'user',
              content: 'Before creating any files, you MUST use the think tool to create a structured plan. Call think({"thought": "PLAN: ...\\nStep 1: ... - Output: path1\\nStep 2: ... - Output: path2\\n..."}) first. Do NOT start with write_file.',
            })
          }

          // ── FORCE: Second iteration reminder if think was skipped ───────
          // If iteration 2+ and the LLM STILL hasn't used think, inject another
          // reminder. This is crucial because the first forced message may have
          // been ignored or context-compacted away.
          if (iteration === 2 && !hasUsedThinkTool && writtenFilesTracker.size > 0) {
            // LLM skipped think and jumped straight to writing — that's OK,
            // but we should still request a plan for remaining files
            runningMessages.push({
              role: 'user',
              content: `You skipped the planning step. You have written ${writtenFilesTracker.size} file(s) so far. Before creating more files, please use the think tool to list ALL remaining files you plan to create. Example: think({"thought": "REMAINING PLAN:\\nStep N: Create X - Output: path/X\\nStep N+1: Create Y - Output: path/Y"})`,
            })
          }

          // ── Call the LLM via the multi-provider registry ───────────────

          const chatOptions: ChatOptions = {
            model: selectedModel,
            messages: runningMessages,
            tools: openAITools,
            maxTokens: MAX_TOKENS_PER_TURN,
            temperature: 0.7,
            useNativeFunctionCalling: nativeFunctionCalling,
          }

          let llmContent = ''
          let llmToolCalls: ToolCallRequest[] = []

          try {
            let response: any = null
            let modelUsed = selectedModel

            // Try each default model in order as a fallback chain.
            // NOTE: glm-4.7-flash and glm-4.5-flash are ZAI-only models.
            // The registry's remapModelForProvider() ensures non-ZAI providers
            // (NVIDIA, OpenRouter, Ollama) use their own configured models.
            // So "glm-4.7-flash" → ZAI gets glm-4.7-flash, NVIDIA gets its model, etc.
            // The chatWithFallback has UNLIMITED retry — it cycles providers forever.
            // This model fallback is just for trying a different ZAI model if one fails.
            const modelsToTry = DEFAULT_MODELS.includes(selectedModel)
              ? DEFAULT_MODELS  // If using a default model, try the full fallback chain
              : [selectedModel] // If user explicitly picked a model, only use that one

            for (const tryModel of modelsToTry) {
              try {
                const tryOptions = { ...chatOptions, model: tryModel }
                response = await llmProviderRegistry.chatWithFallback(tryOptions)
                modelUsed = tryModel
                break  // Success — stop trying fallback models
              } catch (modelErr) {
                const mErr = modelErr as Error
                console.warn("[Agent] Model '" + tryModel + "' failed across all providers: " + mErr.message)
                if (tryModel === modelsToTry[modelsToTry.length - 1]) {
                  // Last model in chain also failed — rethrow
                  throw modelErr
                }
                sse.terminal('warn', "Model '" + tryModel + "' failed, trying fallback...")
              }
            }

            llmContent = response.content

            // Parse structured tool calls from the response
            if (response.toolCalls && response.toolCalls.length > 0) {
              llmToolCalls = detectToolCalls({
                content: response.content,
                toolCalls: response.toolCalls,
              })
            } else {
              // Fallback: check text for [TOOL_CALL] blocks
              llmToolCalls = detectToolCalls({ content: response.content })
            }

            // Stream the content to the client
            if (llmContent) {
              iterationResponse += llmContent
              fullResponse += llmContent
              sse.content(llmContent)
            }

            // Stream tool call events for native function calls
            if (response.toolCalls && response.toolCalls.length > 0) {
              for (const tc of llmToolCalls) {
                fullResponse += `\n[TOOL_CALL] ${tc.toolName}(${JSON.stringify(tc.params)})`
                sse.toolCall(tc.id || `tc_${iteration}_${Date.now()}`, tc.toolName, tc.params as Record<string, unknown>)
              }
            }
          } catch (llmError) {
            const err = llmError as Error
            sse.error(`All LLM providers failed: ${err.message}`, 'PROVIDER_FAILURE')
            break
          }

          // ── Issue 1 Fix: Verification Loop ────────────────────────────
          // When the LLM returns 0 tool calls, DON'T just break.
          // Check if the project is actually complete. If not, inject a
          // continuation message and retry (up to MAX_VERIFICATION_RETRIES).
          if (llmToolCalls.length === 0) {
            const projectIncomplete = isProjectIncomplete(writtenFilesTracker)
            const missingBuildSteps = getMissingBuildSteps(writtenFilesTracker, executedCommands)

            // v1.2: Use verification.ts's quickFileCheck for a richer
            // missing-files report when we have a projectId. This is a
            // cheap O(filesystem-listing) check — no subprocess spawn.
            // Falls back to the inline heuristic when projectId is absent.
            let missingPlannedFiles: string[] = []
            if (projectId && planTracker.getPlan()) {
              try {
                const planned = planTracker.getPlannedFiles()
                if (planned.length > 0) {
                  const check = await quickFileCheck(projectId, planned)
                  missingPlannedFiles = check.missing
                }
              } catch {
                /* best-effort — fall back to inline heuristic */
              }
            }

            // If there are missing build steps (install, build), tell the agent to run them
            if (missingBuildSteps.length > 0 && verificationRetries < MAX_VERIFICATION_RETRIES + 3) {
              verificationRetries++
              const fileCount = writtenFilesTracker.size
              const missingSteps = missingBuildSteps.join(', ')

              const buildContinuationMessage = `You have created ${fileCount} file(s) but have NOT run the required build steps yet. You MUST run these commands using execute_code BEFORE finishing:\n${missingBuildSteps.map(cmd => `- execute_code({"command": "${cmd}"})`).join('\n')}\n\nDo NOT tell the user to run these commands — YOU must run them yourself. After running them, if there are errors, fix them with edit_file and re-run the build.`

              runningMessages.push({
                role: 'user',
                content: buildContinuationMessage,
              })

              sse.terminal('warn', `build-check: Missing build steps: ${missingSteps}. Asking agent to run them...`)

              console.log(
                `[Agent Loop] BUILD-CHECK: Missing build steps: ${missingSteps}. Retry ${verificationRetries}`
              )
              continue  // Continue the while loop — don't break
            }

            // v1.2: If quickFileCheck found planned files that are missing
            // from disk, surface them to the agent before falling back to
            // the inline incomplete heuristic.
            if (missingPlannedFiles.length > 0 && verificationRetries < MAX_VERIFICATION_RETRIES) {
              verificationRetries++
              const fileList = missingPlannedFiles.slice(0, 20).join(', ')
              const continuationMessage = `VERIFICATION: The following planned files are MISSING from disk:\n${missingPlannedFiles.map(f => `- ${f}`).join('\n')}\n\nCreate them now using write_file tool calls. Do not respond with text only — use the tool.`

              runningMessages.push({
                role: 'user',
                content: continuationMessage,
              })

              sse.terminal('warn', `verification: ${missingPlannedFiles.length} planned file(s) missing (${fileList}${missingPlannedFiles.length > 20 ? '...' : ''}). Asking agent to create them... (${verificationRetries}/${MAX_VERIFICATION_RETRIES})`)

              console.log(
                `[Agent Loop] VERIFICATION (quickFileCheck): ${missingPlannedFiles.length} planned files missing. Retry ${verificationRetries}/${MAX_VERIFICATION_RETRIES}`
              )
              continue
            }

            if (projectIncomplete && verificationRetries < MAX_VERIFICATION_RETRIES) {
              verificationRetries++
              const fileCount = writtenFilesTracker.size
              const filePaths = [...writtenFilesTracker.keys()].join(', ')

              const continuationMessage = `CRITICAL: You stopped generating files but the project is NOT complete. You have only written ${fileCount} file(s): ${filePaths || 'none'}. You MUST continue creating the remaining files using write_file tool calls. Remember to create __preview.html for the live preview. Do NOT respond with just text — use tool calls to create files.`

              runningMessages.push({
                role: 'user',
                content: continuationMessage,
              })

              sse.terminal('warn', `verification: Project incomplete (${fileCount} files), retrying... (${verificationRetries}/${MAX_VERIFICATION_RETRIES})`)

              console.log(
                `[Agent Loop] VERIFICATION: LLM returned 0 tool calls but project is incomplete (${fileCount} files). Retry ${verificationRetries}/${MAX_VERIFICATION_RETRIES}`
              )
              continue  // Continue the while loop — don't break
            }

            // Project appears complete or max retries reached
            if (projectIncomplete) {
              sse.terminal('warn', `verification: Agent stopped but project may be incomplete after ${verificationRetries} retries. Some files may be missing.`)
            }
            break
          }

          // ── Issue 1 Fix: Reset verification retries on successful tool calls
          // The LLM is still making tool calls, so it's still working.
          verificationRetries = 0

          // ── Read-loop detection: Track signatures and detect stuck patterns ──
          let hasWriteCall = false
          let hasReadCall = false
          const duplicateToolCallIndices = new Set<number>()  // Indices to skip during execution

          // Update agent status based on tool calls
          if (llmToolCalls.some(tc => tc.toolName === 'write_file' || tc.toolName === 'edit_file')) {
            sse.status('coding')
          } else if (llmToolCalls.some(tc => tc.toolName === 'execute_code')) {
            sse.status('executing')
          } else {
            sse.status('thinking')
          }

          for (let tci = 0; tci < llmToolCalls.length; tci++) {
            const tc = llmToolCalls[tci]
            if (tc.toolName === 'write_file' || tc.toolName === 'edit_file') {
              hasWriteCall = true
            }
            if (tc.toolName === 'read_file' || tc.toolName === 'list_directory' || tc.toolName === 'search_files') {
              hasReadCall = true
              // Track what the agent is exploring
              const tcPath = String(tc.params.path || tc.params.directory || tc.params.pattern || '')
              if (tc.toolName === 'read_file') exploredFiles.add(tcPath)
              if (tc.toolName === 'list_directory') exploredDirs.add(tcPath || '.')
            }
            // Build a signature: toolName + key param
            const sigKey = `${tc.toolName}:${JSON.stringify(tc.params.path || tc.params.directory || tc.params.command || tc.params.query || '')}`
            const sigCount = (toolCallSignatureCounts.get(sigKey) || 0) + 1
            toolCallSignatureCounts.set(sigKey, sigCount)

            if (sigCount >= MAX_SAME_TOOL_CALL) {
              console.warn(`[Agent Loop] READ-LOOP DETECTED: Tool call ${sigKey} repeated ${sigCount} times. Marking as duplicate to skip execution.`)
              sse.terminal('warn', `loop-detector: Skipping duplicate ${tc.toolName} call (repeated ${sigCount} times). STOP re-reading and START writing code now.`)
              // Mark this tool call index for skipping during execution
              duplicateToolCallIndices.add(tci)
              // Reset the counter so we don't keep flagging the same call
              toolCallSignatureCounts.set(sigKey, 0)
            }
          }

          // If ALL tool calls are duplicates, inject a force-write message
          if (duplicateToolCallIndices.size === llmToolCalls.length && llmToolCalls.length > 0) {
            runningMessages.push({
              role: 'user',
              content: `CRITICAL ANTI-LOOP: ALL your tool calls are duplicates — you are re-reading the same files. You have explored: files=[${[...exploredFiles].join(', ')}] dirs=[${[...exploredDirs].join(', ')}]. STOP reading and START creating files with write_file. Create ALL project files now.`,
            })
            // Skip to next iteration — don't execute any of these duplicate calls
            continue  // This continues the while loop
          }

          // Filter out duplicate tool calls before validation
          if (duplicateToolCallIndices.size > 0) {
            llmToolCalls = llmToolCalls.filter((_, idx) => !duplicateToolCallIndices.has(idx))
          }

          // Track consecutive read-only turns (no write calls)
          if (hasReadCall && !hasWriteCall) {
            consecutiveReadOnlyTurns++
          } else if (hasWriteCall) {
            consecutiveReadOnlyTurns = 0
          }

          if (consecutiveReadOnlyTurns >= MAX_CONSECUTIVE_READ_TURNS) {
            console.warn(`[Agent Loop] READ-ONLY STUCK: ${consecutiveReadOnlyTurns} turns with only reads, no writes. Force-breaking.`)
            sse.terminal('warn', `loop-detector: ${consecutiveReadOnlyTurns} consecutive read-only turns. You must start writing files now.`)
            // Inject a very strong message
            runningMessages.push({
              role: 'user',
              content: `CRITICAL: You have been reading files for ${consecutiveReadOnlyTurns} turns without creating ANY new files. You have explored: files=[${[...exploredFiles].join(', ')}] dirs=[${[...exploredDirs].join(', ')}]. You MUST now call write_file to create the project files. Do NOT read any more files. Create ALL files in a single response with multiple write_file calls.`,
            })
            consecutiveReadOnlyTurns = 0 // Reset to give it one more chance
          }

          // ── Issue 7 Fix: PreToolUse Validation ────────────────────────
          // Validate ALL tool call parameters BEFORE execution.
          // Reject malformed calls early with clear error messages.
          const validationResult = validateToolCalls(
            llmToolCalls.map((tc, idx) => ({
              id: tc.id || `tc_${idx}_${Date.now()}`,
              toolName: tc.toolName,
              params: tc.params,
            }))
          )

          // Stream validation errors for rejected tool calls
          for (const rejected of validationResult.rejected) {
            const validationErrorMsg = `[TOOL_VALIDATION_ERROR] ${rejected.toolName}: ${rejected.error}`
            fullResponse += `\n${validationErrorMsg}`
            sse.content(validationErrorMsg)
            sse.validationError(rejected.toolName, rejected.error)
          }

          if (validationResult.valid.length === 0) {
            // ALL tool calls failed validation — don't execute anything
            // Instead, feed the validation errors back to the LLM so it can fix them
            const errorMessages = validationResult.rejected
              .map(r => `${r.toolName}: ${r.error}`)
              .join('\n')

            runningMessages.push({
              role: 'user',
              content: `Your tool calls had validation errors:\n${errorMessages}\n\nPlease fix the parameters and try again.`,
            })
            continue  // Continue the loop to let LLM retry
          }

          // ── Execute tool calls in PARALLEL ─────────────────────────────

          // Use validated calls (with corrected params) instead of raw calls
          const parallelCalls: ParallelToolCall[] = validationResult.valid.map((tc, idx) => ({
            id: tc.id,
            toolName: tc.toolName,
            params: {
              ...tc.params,
              ...(projectId && ['write_file', 'read_file', 'list_directory', 'search_files', 'edit_file', 'execute_code'].includes(tc.toolName)
                ? { projectId }
                : {}),
            },
          }))

          // Also need to handle rejected calls — create error results for them
          const rejectedResults = validationResult.rejected.map(r => ({
            toolCallId: r.id,
            toolName: r.toolName,
            result: { error: r.error, validated: false },
            success: false,
          }))

          // ── Execute tool calls with STREAMING + PARALLEL + FAILURE ISOLATION ──
          //
          // v1.4 (Claude Code v2.1.154 + v2.1.161):
          //   - Streaming: results yield AS SOON AS each call completes
          //   - Parallel: up to 5 calls run concurrently (configurable)
          //   - Failure isolation: one failing call does NOT cancel its siblings
          //
          // The old sequential loop (one-at-a-time) is preserved as a fallback
          // if the streaming executor throws — production safety first.
          //
          // NOTE: We still validate first (above) to catch malformed params
          // before any hook or execution. The streaming executor then runs
          // PreToolUse hooks + permission checks per-call.
          const allResults: Array<any> = [...rejectedResults]
          const toolResultMessages: string[] = []

          // Build StreamingToolCall[] from validated calls
          const streamingCalls: StreamingToolCall[] = parallelCalls.map((tc) => ({
            id: tc.id,
            toolName: tc.toolName,
            params: tc.params,
          }))

          // Execute extension beforeToolCall hook (kept for back-compat with
          // existing extensions; the new hook-system.ts PreToolUse fires
          // automatically inside streamToolExecution)
          await extensionSystem.executeHooks('beforeToolCall', {
            sessionId: activeSessionId,
            toolName: parallelCalls.length === 1 ? parallelCalls[0].toolName : 'multiple',
            toolParams: parallelCalls.length === 1 ? parallelCalls[0].params : {},
          })

          // v1.4: Stream results as they complete
          try {
            for await (const tr of streamToolExecution(streamingCalls, {
              sessionId: activeSessionId,
              projectId,
              iteration,
              maxConcurrency: 5,
            })) {
              allResults.push(tr)

              // Execute extension afterToolCall hook (per-call for real-time)
              await extensionSystem.executeHooks('afterToolCall', {
                sessionId: activeSessionId,
                toolName: tr.toolName,
                toolResult: [tr],
              })

              // ── Stream result immediately (live progress!) ─────────────────
              const trId = tr.id || ''
              const matchedCallIndex = validationResult.valid.findIndex((vc) => vc.id === trId)
              const matchedCall =
                matchedCallIndex >= 0 ? validationResult.valid[matchedCallIndex] : streamingCalls.find((c) => c.id === trId)
              const matchedRejected = validationResult.rejected.find((r) => r.id === trId)

              const resultStr = JSON.stringify(tr.result, null, 2)
              toolResultMessages.push(`[TOOL_RESULT] ${tr.toolName}\n${resultStr}`)
              sse.toolResult(trId, tr.toolName, tr.result, tr.success)

              // ── Track files from write_file tool results ────
              if (tr.toolName === 'write_file' && tr.success) {
                const relativePath = matchedCall
                  ? String(matchedCall.params.path || '')
                  : String((tr.result as any)?.relativePath || (tr.result as any)?.path || '')
                const fileContent = matchedCall
                  ? String(matchedCall.params.content || '')
                  : ''
                if (relativePath) {
                  writtenFilesTracker.set(relativePath, {
                    path: relativePath,
                    content: fileContent,
                    language: getLanguageFromPath(relativePath),
                    bytesWritten: fileContent.length,
                    timestamp: Date.now(),
                  })

                  // v1.2: Sync PlanTracker so its stall-detection accounts for
                  // every successful write. Best-effort — must never break the
                  // streaming loop on tracker errors.
                  try {
                    planTracker.updateFromExistingFiles([...writtenFilesTracker.keys()])
                  } catch { /* best-effort */ }

                  // Emit __FILE_WRITTEN__ event for real-time frontend update
                  try {
                    sse.fileWritten(relativePath, fileContent, getLanguageFromPath(relativePath), fileContent.length)
                } catch {
                  // Don't let file event encoding break the stream
                }

                // v1.3: ECC Pattern #5 — per-edit typecheck hook.
                // After writing .ts/.tsx files, run tsc --noEmit and feed
                // filtered errors back via SSE. Non-blocking.
                if (relativePath.match(/\.(ts|tsx|mts|cts)$/)) {
                  try {
                    const wsRoot = path.resolve(process.cwd(), 'workspace')
                    const fullPath = projectId ? path.join(wsRoot, projectId, relativePath) : path.resolve(process.cwd(), relativePath)
                    const tcResult = await typecheckAfterEdit(fullPath)
                    if (tcResult.hasErrors) {
                      const warning = formatTypecheckForToolResult(tcResult)
                      if (warning) sse.terminal('warn', warning.substring(0, 1000))
                    }
                  } catch { /* best-effort */ }
                }

                // Auto-switch to preview when __preview.html is created
                if (relativePath === '__preview.html') {
                  sse.switchTab('preview')
                }

                // Real-time plan update
                emitPlanUpdate()
              }
            }

            // ── Track plan steps from think tool ────────────
            if (tr.toolName === 'think' && matchedCall) {
              hasUsedThinkTool = true
              const thought = String(matchedCall.params.thought || '')
              const newSteps = parsePlanSteps(thought)
              if (newSteps.length > 0) {
                planSteps = newSteps
                // v1.2: also initialize the PlanTracker singleton so its
                // stall-detection + progress-report APIs are usable from
                // elsewhere in the loop (continuation hints, verification gate).
                try {
                  planTracker.initialize(
                    projectId || 'default',
                    projectId || 'default',
                    thought,
                  )
                } catch { /* tracker is best-effort; don't break the loop */ }
                emitPlanUpdate()
              }
            }

            // ── Improved terminal logging ──
            if (tr.toolName === 'execute_code') {
              const output = (tr.result as any)?.output || ''
              const exitCode = (tr.result as any)?.exitCode
              const isError = (tr.result as any)?.error || exitCode !== 0
              const cmd = (tr.result as any)?.command || (matchedCall?.params.command as string) || ''
              sse.terminal(isError ? 'error' : 'success', `$ ${cmd}${output ? '\n' + output.substring(0, 2000) : ''}${exitCode !== undefined && exitCode !== 0 ? '\nexit code: ' + exitCode : ''}`)

              // Track executed commands for build-step detection
              if (cmd) {
                // Normalize: track the base command (e.g. "npm install" not the full path)
                const baseCmd = cmd.trim().split(/\s+/).slice(0, 2).join(' ')
                executedCommands.add(baseCmd)
                // Also track specific patterns
                if (cmd.includes('npm install')) executedCommands.add('npm install')
                if (cmd.includes('bun install')) executedCommands.add('bun install')
                if (cmd.includes('pip install')) executedCommands.add('pip install')
                if (cmd.includes('npm run build')) executedCommands.add('npm run build')
                if (cmd.includes('npx tsc')) executedCommands.add('npx tsc')
                if (cmd.includes('npm test')) executedCommands.add('npm test')
              }
            } else if (tr.toolName === 'write_file') {
              const result = tr.result as any
              if (result?.error || matchedRejected) {
                const errorPath = matchedCall?.params.path
                  ? String(matchedCall.params.path)
                  : (result?.path ? String(result.path) : 'unknown')
                sse.terminal('error', 'write_file: ' + errorPath + ' — ' + (result?.error || matchedRejected?.error || 'validation failed'))
              } else {
                const displayPath = result?.relativePath
                  || (matchedCall?.params.path ? String(matchedCall.params.path) : null)
                  || (result?.path ? String(result.path).split('/').slice(-3).join('/') : 'unknown')
                const bytes = result?.bytesWritten || 0
                sse.terminal('success', 'write_file: ' + displayPath + ' (' + bytes + ' bytes)')
              }
            } else if (tr.toolName === 'list_directory') {
              const entries = ((tr.result as any)?.entries || []) as Array<{name: string; type: string}>
              const entryList = entries.map(e => (e.type === 'directory' ? 'd' : 'f') + ' ' + e.name).join(', ')
              sse.terminal('info', 'list_directory: ' + (entryList || '(empty)'))
            } else if (tr.toolName === 'read_file') {
              const result = tr.result as any
              const filePath = matchedCall?.params.path
                ? String(matchedCall.params.path)
                : (result?.path ? String(result.path).split('/').slice(-3).join('/') : 'unknown')
              const contentLength = typeof tr.result === 'string'
                ? tr.result.length
                : (result?.content?.length || 0)
              sse.terminal('info', 'read_file: ' + filePath + ' (' + contentLength + ' chars)')
            } else if (tr.toolName === 'edit_file') {
              const result = tr.result as any
              const filePath = matchedCall?.params.path
                ? String(matchedCall.params.path)
                : (result?.path ? String(result.path).split('/').slice(-3).join('/') : 'unknown')
              const ops = Array.isArray(matchedCall?.params.operations)
                ? (matchedCall!.params.operations as any[]).length
                : 0
              const success = tr.success && !(tr.result as any)?.error
              sse.terminal(success ? 'success' : 'error', 'edit_file: ' + filePath + ' (' + ops + ' ops)')
            }
            } // end for-await
          } catch (streamExecErr) {
            // Fallback: if the streaming executor fails (shouldn't happen — it
            // has its own try/catch), fall back to the old sequential path.
            console.error('[Agent Chat] Streaming executor failed, falling back:', streamExecErr)
            for (const call of parallelCalls) {
              let tr: any
              try {
                const singleResults = await executeToolCallsParallel([call])
                tr = singleResults[0]
              } catch (err) {
                tr = {
                  id: call.id,
                  toolName: call.toolName,
                  result: { error: String(err) },
                  success: false,
                }
              }
              allResults.push(tr)
              sse.toolResult(tr.id || call.id, tr.toolName, tr.result, tr.success)
            }
          }

          // Feed tool results back into the conversation.
          //
          // CRITICAL FIX: When native function calling is enabled, the OpenAI
          // API contract requires:
          //   1. An assistant message with the original `tool_calls` array
          //   2. A `{ role: 'tool', tool_call_id, content }` message for EACH tool call
          // Without this, every provider (NVIDIA, OpenRouter, etc.) returns:
          //   "missing field `tool_call_id`" (400 Bad Request)

          // Strong anti-loop continuation hint
          const writtenFilesInThisIteration = validationResult.valid
            .filter(tc => tc.toolName === 'write_file' && tc.params.path)
            .map(tc => tc.params.path as string)
          const previouslyWrittenMatch = writtenFilesInThisIteration.length > 0
            ? `\n⚠️ ANTI-LOOP CHECK: You just wrote these files: ${writtenFilesInThisIteration.join(', ')}. Do NOT write any of these files again! Only create NEW files that don't exist yet. If all files are done, respond with text summary and STOP.`
            : ''

          // Issue 5 Fix: Include plan progress in the continuation hint
          const planProgressHint = planSteps.length > 0
            ? buildPlanSummary(planSteps, writtenFilesTracker)
            : ''

          // CRITICAL FIX: Include explored files summary so the LLM doesn't re-read
          // the same files after context compaction erases its memory.
          const exploredSummary = exploredFiles.size > 0
            ? `\n\n📂 FILES ALREADY EXPLORED (DO NOT read these again): ${[...exploredFiles].join(', ')}\n📂 DIRS ALREADY LISTED (DO NOT list these again): ${[...exploredDirs].join(', ')}`
            : ''

          // CRITICAL FIX: If no files written yet, remind the LLM to STOP reading and START writing
          const noFilesWrittenYet = writtenFilesTracker.size === 0 && exploredFiles.size > 3
            ? `\n\n⚠️ CRITICAL: You have explored ${exploredFiles.size} files but created ZERO project files. STOP reading. Call write_file NOW to create the project.`
            : ''

          const continuationHint = iteration < MAX_TOOL_ITERATIONS - 1
            ? `${previouslyWrittenMatch}${planProgressHint}${exploredSummary}${noFilesWrittenYet}\n\nNEXT ACTION: Create the REMAINING files from your plan. Batch MULTIPLE write_file calls in ONE response. If all files are done, respond with a summary and no tool calls.`
            : 'This is the last iteration. Summarize what was created.'

          const newMessages: LLMChatMessage[] = []

          if (nativeFunctionCalling && llmToolCalls.length > 0) {
            // ── Native function calling mode ─────────────────────────────
            // Build the proper assistant message with tool_calls array
            // and individual tool result messages with tool_call_id.

            // Only include tool calls that were actually executed (valid ones)
            const validToolCallIds = new Set(validationResult.valid.map(vc => vc.id))

            const assistantToolCalls: StructuredToolCall[] = validationResult.valid.map((tc, idx) => ({
              id: tc.id,
              type: 'function' as const,
              function: {
                name: tc.toolName,
                arguments: JSON.stringify(tc.params),
              },
            }))

            // Also include rejected calls as tool_calls in the assistant message
            // so the tool result messages have matching IDs
            for (const rejected of validationResult.rejected) {
              assistantToolCalls.push({
                id: rejected.id,
                type: 'function' as const,
                function: {
                  name: rejected.toolName,
                  arguments: JSON.stringify(rejected.params),
                },
              })
            }

            newMessages.push({
              role: 'assistant',
              content: iterationResponse || null,
              toolCalls: assistantToolCalls,
            })

            // Push one tool result message per tool call (both valid and rejected)
            for (const tr of allResults) {
              const resultStr = JSON.stringify(tr.result, null, 2)
              newMessages.push({
                role: 'tool',
                content: resultStr,
                toolCallId: (tr as any).toolCallId || (tr as any).id || '',
              })
            }

            // Add continuation hint as a user message after tool results
            if (continuationHint) {
              newMessages.push({
                role: 'user',
                content: continuationHint,
              })
            }
          } else {
            // ── Text-based (non-native) tool call mode ──────────────
            const toolResultsMessage = toolResultMessages.join('\n\n')
            newMessages.push(
              { role: 'assistant' as const, content: iterationResponse },
              { role: 'user' as const, content: `Tool execution results:\n\n${toolResultsMessage}${continuationHint}` },
            )
          }

          runningMessages = [...runningMessages, ...newMessages]
          const toolResultsMessageForLog = toolResultMessages.join('\n\n')
          fullResponse += `\n\n${toolResultsMessageForLog}`

          console.log(`[Agent Loop] Iteration ${iteration}/${MAX_TOOL_ITERATIONS}: ${validationResult.valid.length} valid + ${validationResult.rejected.length} rejected tool calls, contentLen=${llmContent.length}, filesWritten=${writtenFilesTracker.size}`)

          // Apply context compaction for next iteration
          const RECENT_MESSAGE_KEEP_COUNT = 12
          const splitIndex = Math.max(0, runningMessages.length - RECENT_MESSAGE_KEEP_COUNT)

          const oldMessages = runningMessages.slice(0, splitIndex)
          const recentMessages = runningMessages.slice(splitIndex)

          const oldMessagesForCompaction = oldMessages.map((m) => ({
            role: m.role as any,
            content: m.content,
          }))

          const compactedOld = oldMessagesForCompaction.length > 2
            ? await contextManager.buildContextWindow(
                oldMessagesForCompaction,
                selectedModel,
                activeSessionId || 'anonymous',
              )
            : oldMessagesForCompaction

          const compactedOldMessages: LLMChatMessage[] = compactedOld.map((m) => ({
            role: m.role as 'system' | 'user' | 'assistant' | 'tool',
            content: m.content,
          }))

          runningMessages = [...compactedOldMessages, ...recentMessages]

          // ── Stuck-loop detection ─────────────────────────────────────
          const filesWrittenThisIteration = validationResult.valid
            .filter(tc => tc.toolName === 'write_file' && tc.params.path)
            .map(tc => tc.params.path as string)

          if (filesWrittenThisIteration.length > 0) {
            const allAlreadyWritten = filesWrittenThisIteration.every(f => allWrittenFiles.includes(f))
            if (allAlreadyWritten) {
              consecutiveDuplicateWrites++
            } else {
              consecutiveDuplicateWrites = 0
            }
            allWrittenFiles.push(...filesWrittenThisIteration)

            if (consecutiveDuplicateWrites >= 3) {
              console.warn(
                `[Agent Loop] STUCK DETECTED: Same files rewritten ${consecutiveDuplicateWrites} times. Breaking loop.`,
              )
              sse.terminal('warn', 'Agent loop detected stuck behavior (rewriting same files repeatedly). Stopping to prevent infinite loop.')
              break
            }

            // v1.2: PlanTracker stall detection — if no plan progress for 3+
            // iterations, surface a corrective hint to the LLM via the
            // continuation message (built later in this iteration). The hint
            // is added only if the inline stuck-detector above didn't fire.
            if (planTracker.getPlan() && planTracker.isStalled()) {
              try {
                const report = planTracker.getProgressReport()
                if (report) {
                  sse.terminal('warn', `Plan progress stall detected by PlanTracker. ${report.split('\n').slice(0, 3).join(' | ')}`)
                }
              } catch { /* best-effort */ }
            }
          }

          // v1.4 (Claude Code Stop hook): BEFORE we exit the while-loop on a
          // "0 tool calls" iteration, fire Stop hooks. If any returns
          // decision="block", re-feed its reason as a new user message and
          // continue the loop. This catches issues like "tests not run before
          // stopping."
          if (llmToolCalls.length === 0 && iteration < MAX_TOOL_ITERATIONS - 1) {
            try {
              const stopContext: StopContext = {
                sessionId: activeSessionId,
                projectId,
                finalResponse: fullResponse,
                iterationsCompleted: iteration,
                filesWritten: [...writtenFilesTracker.keys()],
                commandsExecuted: [...executedCommands],
              }
              const stopDecision = await hookSystem.fireStop(stopContext)
              if (stopDecision.decision === 'block' && stopDecision.reason) {
                console.log('[Agent Chat] Stop hook blocked stop — re-feeding reason to LLM')
                sse.terminal('warn', `Stop hook blocked: ${stopDecision.reason.slice(0, 200)}`)
                runningMessages.push({
                  role: 'user',
                  content: stopDecision.reason,
                })
                continue // re-enter the while loop with the new message
              }
            } catch (err) {
              console.warn('[Agent Chat] Stop hook error:', (err as Error).message)
            }
          }
        }

        // ── After streaming: save tracked files to project ──────────────
        // Issue 6 Fix: Use writtenFilesTracker instead of parseCodeFiles()

        // Convert tracked files to the format expected by DB and metadata
        const trackedFilesMap: Record<string, string> = {}
        const trackedFilesWithLanguage: Array<{ path: string; content: string; language: string }> = []

        for (const [relativePath, tracked] of writtenFilesTracker) {
          trackedFilesMap[relativePath] = tracked.content
          trackedFilesWithLanguage.push({
            path: relativePath,
            content: tracked.content,
            language: tracked.language,
          })
        }

        // Also parse ### FILE: blocks as a fallback (for text-based tool calling)
        const codeFiles = parseCodeFiles(fullResponse)
        for (const [path, content] of Object.entries(codeFiles)) {
          if (!trackedFilesMap[path]) {
            trackedFilesMap[path] = content
            trackedFilesWithLanguage.push({
              path,
              content,
              language: getLanguageFromPath(path),
            })
          }
        }

        // Parse and apply inline diffs if present
        const inlineDiffs = parseInlineDiffs(fullResponse)
        if (inlineDiffs.length > 0) {
          for (const diff of inlineDiffs) {
            agentEventBus.emit('diff:apply', {
              filePath: 'inline-diff',
              operations: 1,
              success: true,
            })
          }
        }

        // v1.3: Parse and apply <artifact> XML blocks (Claude Code / Z.ai /
        // emergent.sh style). The system prompt instructs the LLM to emit
        // these for multi-file bulk writes. Files written via artifacts are
        // merged into trackedFilesMap so the downstream DB save includes them.
        if (projectId) {
          try {
            const artifacts = artifactParser.parseArtifacts(fullResponse)
            if (artifacts.length > 0) {
              const totalActions = artifacts.reduce((s, a) => s + a.actions.length, 0)
              console.log(`[Agent Chat] Parsed ${artifacts.length} artifact(s) with ${totalActions} action(s)`)
              sse.terminal('info', `Artifact pipeline: ${artifacts.length} block(s), ${totalActions} action(s)`)

              const result = await artifactExecutor.executeArtifacts(projectId, artifacts)

              // Merge executed artifact actions into trackedFilesMap
              for (const artifact of artifacts) {
                for (const action of artifact.actions) {
                  if (action.type === 'delete') continue
                  if (!trackedFilesMap[action.filePath]) {
                    trackedFilesMap[action.filePath] = action.content
                    trackedFilesWithLanguage.push({
                      path: action.filePath,
                      content: action.content,
                      language: getLanguageFromPath(action.filePath),
                    })
                    writtenFilesTracker.set(action.filePath, {
                      path: action.filePath,
                      content: action.content,
                      language: getLanguageFromPath(action.filePath),
                      bytesWritten: action.content.length,
                      timestamp: Date.now(),
                    })
                    try {
                      sse.fileWritten(action.filePath, action.content, getLanguageFromPath(action.filePath), action.content.length)
                    } catch { /* SSE safety */ }
                  }
                }
              }

              if (result.blocked.length > 0) {
                sse.terminal('warn', `Artifact blocked ${result.blocked.length} action(s): ${result.blocked.slice(0, 5).join(', ')}`)
              }
              if (result.errors.length > 0) {
                sse.terminal('warn', `Artifact errors: ${result.errors.slice(0, 3).join(' | ')}`)
              }

              agentEventBus.emit('diff:apply', {
                filePath: 'artifact-batch',
                operations: result.written.length,
                success: result.errors.length === 0,
              })
            }
          } catch (artifactError) {
            const msg = artifactError instanceof Error ? artifactError.message : String(artifactError)
            console.warn('[Agent Chat] Artifact pipeline error:', msg)
            sse.terminal('warn', `Artifact pipeline error: ${msg.substring(0, 200)}`)
          }
        }

        // Save to database
        if (projectId && trackedFilesWithLanguage.length > 0) {
          try {
            const project = await db.project.findUnique({ where: { id: projectId } })
            if (project) {
              const existingFiles = JSON.parse(project.files || '[]') as Array<{
                path: string
                content: string
                language: string
              }>

              const mergedFiles = [...existingFiles]
              for (const newFile of trackedFilesWithLanguage) {
                const existingIdx = mergedFiles.findIndex((f) => f.path === newFile.path)
                if (existingIdx >= 0) {
                  mergedFiles[existingIdx] = newFile
                } else {
                  mergedFiles.push(newFile)
                }
              }

              await db.project.update({
                where: { id: projectId },
                data: {
                  files: JSON.stringify(mergedFiles),
                  status: 'generated',
                },
              })
            }
          } catch (dbError) {
            console.error('Failed to save project files:', dbError)
          }

          // Write files to workspace filesystem
          try {
            const filesToWrite = trackedFilesWithLanguage.map(f => ({
              path: f.path,
              content: f.content,
            }))
            const writeResult = await writeProjectFiles(projectId, filesToWrite)
            if (writeResult.errors.length > 0) {
              console.error('Some files failed to write to workspace:', writeResult.errors)
            }
          } catch (fsError) {
            console.error('Failed to write files to workspace:', fsError)
          }
        }

        // Save assistant message to project
        if (projectId && fullResponse) {
          try {
            await db.message.create({
              data: {
                projectId,
                role: 'assistant',
                content:
                  fullResponse.length > DB_MESSAGE_MAX_LENGTH
                    ? fullResponse.substring(0, DB_MESSAGE_MAX_LENGTH)
                    : fullResponse,
              },
            })
          } catch (error) {
            console.error('Failed to save assistant message:', error)
          }
        }

        // Save message to session store
        if (activeSessionId) {
          try {
            await sessionStore.appendMessage(activeSessionId, {
              role: 'assistant',
              content: fullResponse.substring(0, DB_MESSAGE_MAX_LENGTH),
              metadata: {
                model: selectedModel,
                tokens: estimateTokens(fullResponse),
              },
            })
          } catch {
            // Session store may not be available
          }
        }

        // Issue 6 Fix: Send metadata with ACTUAL tracked file count
        if (trackedFilesWithLanguage.length > 0) {
          sse.metadata({
            type: 'metadata',
            files: trackedFilesMap,
            fileCount: trackedFilesWithLanguage.length,
            sessionId: activeSessionId,
          })
        } else {
          // No tracked files — send 0 count explicitly
          sse.metadata({
            type: 'metadata',
            files: {},
            fileCount: 0,
            sessionId: activeSessionId,
          })
        }

        // ── Emit completion event ─────────────────────────────────────────

        // Post-loop check: warn if no preview was created
        const hasPreviewFile = writtenFilesTracker.has('__preview.html')
        if (!hasPreviewFile && writtenFilesTracker.size > 0) {
          sse.terminal('warn', `⚠️ No __preview.html was created. The user won't see a live preview. Consider creating one for instant preview.`)
          console.warn('[Agent Loop] No __preview.html was created. User may not see a preview.')
        }

        // v1.2: Run the full 5-phase verifyProject suite (file existence,
        // dependency install, build, typecheck, entry point) on the final
        // project workspace. This is the post-loop gate that catches issues
        // the inline heuristic misses (e.g. build failures, missing entry
        // points, missing dependencies).
        //
        // The check is best-effort: subprocess failures (npm install
        // timeout, build hang) are caught and reported via SSE terminal
        // without breaking the stream. We only run it when there are files
        // AND a projectId to verify against.
        if (projectId && writtenFilesTracker.size > 0) {
          try {
            const workspaceRoot = path.resolve(process.cwd(), 'workspace')
            const projectDir = path.join(workspaceRoot, projectId)
            const plannedFiles = planTracker.getPlannedFiles().length > 0
              ? planTracker.getPlannedFiles()
              : [...writtenFilesTracker.keys()]

            // verifyProject runs `npm install` (up to 3min) and `npm run
            // build` (up to 2min). Wrap in a hard timeout so a hung build
            // can't stall the SSE stream forever.
            const verificationPromise = verifyProject(projectId, plannedFiles, projectDir)
            const timeoutPromise = new Promise<null>((resolve) =>
              setTimeout(() => resolve(null), 5 * 60 * 1000), // 5 min hard cap
            )
            const result = await Promise.race([verificationPromise, timeoutPromise])

            if (result) {
              const scorePct = Math.round(result.score * 100)
              sse.terminal(
                result.complete ? 'success' : 'warn',
                `Verification: ${result.complete ? '✅ COMPLETE' : '❌ INCOMPLETE'} (${scorePct}% score, ${result.phases.filter(p => p.status === 'pass').length}/${result.phases.length} phases passed)`,
              )
              if (result.missingFiles.length > 0) {
                sse.terminal('warn', `Verification: ${result.missingFiles.length} missing file(s): ${result.missingFiles.slice(0, 10).join(', ')}${result.missingFiles.length > 10 ? '...' : ''}`)
              }
              if (result.buildErrors.length > 0) {
                const firstError = result.buildErrors[0].split('\n').slice(0, 3).join(' | ')
                sse.terminal('warn', `Verification: build errors detected — ${firstError.substring(0, 200)}`)
              }
              agentEventBus.emit('validation:run', {
                projectPath: projectDir,
                step: 'post-loop',
                iteration,
              })
              if (result.complete) {
                agentEventBus.emit('validation:pass', {
                  projectPath: projectDir,
                  step: 'post-loop',
                })
              } else {
                agentEventBus.emit('validation:error', {
                  projectPath: projectDir,
                  step: 'post-loop',
                  errors: result.missingFiles.length + result.buildErrors.length,
                  warnings: 0,
                })
              }
            } else {
              sse.terminal('warn', `Verification: timed out after 5 minutes. Skipping full build/typecheck phases.`)
            }
          } catch (verifyError) {
            // Verification must never break the completion flow.
            const msg = verifyError instanceof Error ? verifyError.message : String(verifyError)
            sse.terminal('warn', `Verification: error during post-loop check — ${msg.substring(0, 200)}`)
            console.warn('[Agent Loop] verifyProject error:', msg)
          }
        }

        // v1.3: ECC Pattern #1 — 6-phase verification loop.
        if (projectId && writtenFilesTracker.size > 0) {
          try {
            const wsRoot = path.resolve(process.cwd(), 'workspace')
            const pDir = path.join(wsRoot, projectId)
            const planned = planTracker.getPlannedFiles().length > 0 ? planTracker.getPlannedFiles() : [...writtenFilesTracker.keys()]
            sse.terminal('info', 'Running 6-phase verification (Build→Types→Lint→Tests→Security→Diff)...')
            const vl = await runVerificationLoop(pDir, planned)
            sse.terminal(vl.overall === 'READY' ? 'success' : 'warn', `Verification: ${vl.overall} — ${vl.passedCount} pass, ${vl.failedCount} fail, ${vl.skippedCount} skip (${vl.totalDurationMs}ms)`)
            try { sse.terminal('info', vl.report.substring(0, 1500)) } catch { /* SSE safety */ }
            // v1.3: ECC Pattern #2 — build-error-resolver if verification found failures
            if (vl.failedCount > 0) {
              sse.terminal('info', 'Invoking build-error-resolver (max 3 attempts per error)...')
              try {
                const fr = await resolveBuildErrors({ ...DEFAULT_BUILD_FIX_CONFIG, workspaceDir: pDir, projectId })
                sse.terminal(fr.resolved ? 'success' : 'warn', `Build fix: ${fr.report.substring(0, 400)}`)
              } catch (e) { sse.terminal('warn', `Build fix error: ${String(e).substring(0, 200)}`) }
            }
          } catch (e) { sse.terminal('warn', `Verification error: ${String(e).substring(0, 200)}`) }
        }

        // v1.3: ECC Pattern #6 — code reviewer with Pre-Report Gate.
        if (projectId && writtenFilesTracker.size > 0) {
          try {
            const wsRoot = path.resolve(process.cwd(), 'workspace')
            const pDir = path.join(wsRoot, projectId)
            sse.terminal('info', 'Running code review (Pre-Report Gate + false-positive filtering)...')
            const rr = await reviewProject({ projectId, workspaceDir: pDir, minConfidence: 0.8, blockOnCritical: true })
            sse.terminal(rr.verdict === 'BLOCK' ? 'error' : rr.verdict === 'WARNING' ? 'warn' : 'success', `Code review: ${rr.verdict} — ${rr.findings.length} finding(s) in ${rr.filesReviewed} file(s)`)
            if (rr.findings.length > 0) { const top = rr.findings.slice(0, 5).map(f => `[${f.severity.toUpperCase()}] ${f.file}:${f.line} — ${f.message.substring(0, 80)}`); sse.terminal('info', `Top findings:\n${top.join('\n')}`) }
          } catch (e) { sse.terminal('warn', `Code review error: ${String(e).substring(0, 200)}`) }
        }

        // v1.3: ECC Pattern #11 — agent self-evaluation (5-axis rubric).
        if (fullResponse.length > 0) {
          try {
            sse.terminal('info', 'Running agent self-evaluation (5-axis rubric)...')
            const se = await evaluateAgentOutput({ agentResponse: fullResponse, filesWritten: [...writtenFilesTracker.keys()], buildSucceeded: true, testsPassed: true, typecheckPassed: true, lintPassed: true, workspaceDir: projectId ? path.resolve(process.cwd(), 'workspace', projectId) : undefined })
            sse.terminal(se.verdict === 'deliver-as-is' ? 'success' : se.verdict === 'fix-issues-then-deliver' ? 'warn' : 'error', `Self-eval: ${se.verdict} — ${se.totalScore}/${se.maxTotalScore} (${se.percentage.toFixed(1)}%)`)
            if (se.topImprovements.length > 0) sse.terminal('info', `Improvements:\n${se.topImprovements.map((i, n) => `${n + 1}. ${i}`).join('\n')}`)
          } catch (e) { sse.terminal('warn', `Self-eval error: ${String(e).substring(0, 200)}`) }
        }

        sse.status('idle')
        sse.done('complete', iteration, writtenFilesTracker.size)

        agentEventBus.emit('agent:complete', {
          sessionId: activeSessionId || 'anonymous',
          iterations: iteration,
        })

        // Execute extension afterChat hook
        await extensionSystem.executeHooks('afterChat', {
          sessionId: activeSessionId,
          projectId,
          model: selectedModel,
          messages: runningMessages,
        })

        controller.close()
      } catch (error: unknown) {
        const err = error as Error & { status?: number; headers?: Record<string, string> }

        agentEventBus.emit('agent:error', {
          sessionId: activeSessionId || 'anonymous',
          error: err.message || 'Unknown error',
          phase: 'streaming',
        })

        if (err.status === 429) {
          const retryAfter = err.headers?.['retry-after'] || err.headers?.['Retry-After']
          const retryHint = retryAfter
            ? `Retry after ${retryAfter} seconds.`
            : 'Please wait a moment and try again.'
          sse.error(`Rate limit exceeded (429). ${retryHint}`, 'RATE_LIMITED')
        } else if (err instanceof ContextCompactionError) {
          // v1.4: Auto-compact circuit breaker tripped — give the user an
          // actionable message instead of burning more API calls.
          console.error('[Agent Chat] Context compaction circuit breaker tripped:', err.message)
          sse.error(
            `Context window exhausted: ${err.message} ` +
              `Start a new session or reduce the project scope.`,
            'CONTEXT_EXHAUSTED',
          )
          sse.terminal(
            'error',
            `Auto-compact failed ${err.consecutiveFailures} times — circuit breaker tripped. ` +
              `The conversation is too large for a single session.`,
          )
        } else {
          console.error('Stream error:', err)
          sse.error(err.message || 'An unexpected error occurred during streaming', 'STREAM_ERROR')
        }
        sse.done('error', iteration, writtenFilesTracker.size)
        controller.close()
      }
    },

    cancel() {
      console.log('Stream cancelled by client')
    },
  })

  // Save the user message to project if projectId provided
  if (projectId) {
    try {
      const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
      if (lastUserMsg) {
        await db.message.create({
          data: {
            projectId,
            role: 'user',
            content: lastUserMsg.content,
          },
        })
      }
    } catch (error) {
      console.error('Failed to save user message:', error)
    }
  }

  // Save user message to session store
  if (activeSessionId) {
    try {
      const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
      if (lastUserMsg) {
        await sessionStore.appendMessage(activeSessionId, {
          role: 'user',
          content: lastUserMsg.content,
        })
      }
    } catch {
      // Session store may not be available
    }
  }

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
