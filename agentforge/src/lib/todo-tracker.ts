/**
 * Phase-Based Task Decomposition & Todo Tracking
 * (Borrowed from Spec-Kit Pattern)
 *
 * Manages the lifecycle of a project build:
 *   1. Parses the agent's plan (from the think tool) into structured steps
 *   2. Tracks completion of each step
 *   3. Detects stalls (no progress for N iterations)
 *   4. Generates progress reports for the agent context
 *   5. Enforces phase ordering (Setup → Foundation → Features → Polish)
 *
 * This module is used by the route.ts agent loop to:
 *   - Parse the plan from the first think tool call
 *   - Track which files have been created vs planned
 *   - Inject progress status into continuation hints
 *   - Detect when the agent is stuck and provide corrective context
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type Phase = 'setup' | 'foundation' | 'features' | 'polish' | 'verify'
export type StepStatus = 'pending' | 'in_progress' | 'done' | 'blocked' | 'failed'

export interface PlanStep {
  id: string
  phase: Phase
  description: string
  filePaths: string[]       // Files this step creates/modifies
  status: StepStatus
  output?: string           // What exists after this step
  verification?: string     // How to verify this step
  startedAt?: number
  completedAt?: number
  error?: string
}

export interface ProjectPlan {
  projectId: string
  projectName: string
  createdAt: number
  steps: PlanStep[]
  currentPhase: Phase
  totalSteps: number
  completedSteps: number
}

// ── Plan Parsing ─────────────────────────────────────────────────────────────

/**
 * Parse the agent's think tool output into a structured plan.
 *
 * Expected format from the think tool:
 *   Step 1: Create package.json - project dependencies
 *   Step 2: Create tsconfig.json - TypeScript configuration
 *   Step 3: Create src/app/layout.tsx - root layout
 *   ...
 *
 * Also handles more structured format:
 *   Step N: [What]
 *   - Output: [What exists after]
 *   - Test: [How to verify]
 *
 * Inline format (v1.2 addition):
 *   Step N: [What] - Output: [path] - Test: [verify]
 *
 * Empty / whitespace-only input returns an empty array (v1.2 fix:
 * previously this returned a single generic step, which masked bugs in
 * callers that passed empty think content).
 */
export function parsePlanFromThinkOutput(thinkContent: string): PlanStep[] {
  // v1.2: short-circuit on empty / whitespace-only input.
  if (!thinkContent || !thinkContent.trim()) {
    return []
  }

  const steps: PlanStep[] = []
  const lines = thinkContent.split('\n')

  let currentStep: Partial<PlanStep> | null = null
  let stepCounter = 0

  for (const line of lines) {
    const trimmed = line.trim()

    // Match "Step N: ..." pattern. We capture only the description portion
    // (everything up to the first ` - Output:` / ` - Test:` separator if
    // present, so the inline format works).
    const stepMatch = trimmed.match(/^Step\s+(\d+)\s*[:–-]\s*(.+)/i)
    if (stepMatch) {
      // Save previous step
      if (currentStep && currentStep.description) {
        steps.push(finalizeStep(currentStep, stepCounter))
      }

      stepCounter++
      let description = stepMatch[2].trim()
      let output: string | undefined
      let verification: string | undefined

      // v1.2: split inline " - Output: X - Test: Y" suffix from the
      // description. This handles the canonical prompt format without
      // requiring multi-line sub-items.
      const inlineMatch = description.match(
        /^(.+?)\s*-\s*Output\s*[:–-]\s*(.+?)(?:\s*-\s*Test\s*[:–-]\s*(.+))?$/i,
      )
      if (inlineMatch) {
        description = inlineMatch[1].trim()
        output = inlineMatch[2].trim()
        verification = inlineMatch[3]?.trim()
      }

      currentStep = {
        id: `step_${stepCounter}`,
        description,
        filePaths: extractFilePaths(description),
        phase: inferPhase(description, stepCounter),
        status: 'pending',
        output,
        verification,
      }
      continue
    }

    // Match "- Output: ..." pattern
    const outputMatch = trimmed.match(/^[-•]\s*Output\s*[:–-]\s*(.+)/i)
    if (outputMatch && currentStep) {
      currentStep.output = outputMatch[1].trim()
      continue
    }

    // Match "- Test: ..." or "- Verify: ..." pattern
    const testMatch = trimmed.match(/^[-•]\s*(?:Test|Verify|Check)\s*[:–-]\s*(.+)/i)
    if (testMatch && currentStep) {
      currentStep.verification = testMatch[1].trim()
      continue
    }

    // Match numbered items that aren't "Step N:" format (1. item, 2. item)
    const numberedMatch = trimmed.match(/^\d+[.)]\s+(.+)/)
    if (numberedMatch && !stepMatch) {
      if (currentStep && currentStep.description) {
        steps.push(finalizeStep(currentStep, stepCounter))
      }

      stepCounter++
      currentStep = {
        id: `step_${stepCounter}`,
        description: numberedMatch[1].trim(),
        filePaths: extractFilePaths(numberedMatch[1]),
        phase: inferPhase(numberedMatch[1], stepCounter),
        status: 'pending',
      }
      continue
    }
  }

  // Save last step
  if (currentStep && currentStep.description) {
    steps.push(finalizeStep(currentStep, stepCounter))
  }

  // v1.2: do NOT auto-create a generic step when no structured content was
  // found. Returning an empty array lets callers distinguish "no plan yet"
  // from "plan with one generic step". If a caller wants a default plan,
  // they can construct one explicitly.

  return steps
}

/**
 * Extract file paths from a step description.
 * Matches common patterns like "src/app/page.tsx", "package.json", etc.
 */
function extractFilePaths(text: string): string[] {
  const filePaths: string[] = []

  // v1.3 fix: capture full paths including directory prefix
  const pathPattern = /(?:src|app|components|lib|pages|public|prisma|skills|tests|docs|api|hooks|stores|frontend|backend|server|client|utils|config)\/[\w-]+(?:\/[\w-]+)*\.\w+/g
  const matches = text.match(pathPattern)

  if (matches) {
    filePaths.push(...matches)
  }

  // Also match quoted paths
  const quotedPattern = /["']([^"']+\.\w+)["']/g
  let quotedMatch
  while ((quotedMatch = quotedPattern.exec(text)) !== null) {
    if (!filePaths.includes(quotedMatch[1])) {
      filePaths.push(quotedMatch[1])
    }
  }

  return filePaths
}

/**
 * Infer the phase of a step based on its description and position.
 */
function inferPhase(description: string, position: number): Phase {
  const lower = description.toLowerCase()

  // Setup phase: project config files
  if (
    lower.includes('package.json') ||
    lower.includes('tsconfig') ||
    lower.includes('next.config') ||
    lower.includes('tailwind.config') ||
    lower.includes('postcss') ||
    lower.includes('.env') ||
    lower.includes('setup') ||
    lower.includes('init') ||
    lower.includes('install')
  ) {
    return 'setup'
  }

  // Foundation phase: core layout, database, utilities
  if (
    lower.includes('layout') ||
    lower.includes('globals.css') ||
    lower.includes('schema.prisma') ||
    lower.includes('db.ts') ||
    lower.includes('utils.ts') ||
    lower.includes('middleware') ||
    lower.includes('auth') ||
    lower.includes('foundation') ||
    lower.includes('core') ||
    lower.includes('base')
  ) {
    return 'foundation'
  }

  // Verify phase: testing, build, preview
  if (
    lower.includes('verify') ||
    lower.includes('test') ||
    lower.includes('build') ||
    lower.includes('preview') ||
    lower.includes('check') ||
    lower.includes('review')
  ) {
    return 'verify'
  }

  // Polish phase: final touches
  if (
    lower.includes('polish') ||
    lower.includes('refine') ||
    lower.includes('finalize') ||
    lower.includes('cleanup') ||
    lower.includes('readme')
  ) {
    return 'polish'
  }

  // Default: features phase
  return 'features'
}

function finalizeStep(partial: Partial<PlanStep>, counter: number): PlanStep {
  return {
    id: partial.id || `step_${counter}`,
    phase: partial.phase || 'features',
    description: partial.description || 'Unknown step',
    filePaths: partial.filePaths || [],
    status: partial.status || 'pending',
    output: partial.output,
    verification: partial.verification,
  }
}

// ── Plan Tracker ─────────────────────────────────────────────────────────────

export class PlanTracker {
  private plan: ProjectPlan | null = null
  private iterationCount = 0
  private lastProgressIteration = 0
  private stallThreshold = 3 // iterations without progress = stall

  /**
   * Initialize a plan from the agent's think output
   */
  initialize(projectId: string, projectName: string, thinkContent: string): ProjectPlan {
    const steps = parsePlanFromThinkOutput(thinkContent)
    this.plan = {
      projectId,
      projectName,
      createdAt: Date.now(),
      steps,
      currentPhase: steps[0]?.phase || 'setup',
      totalSteps: steps.length,
      completedSteps: 0,
    }
    this.iterationCount = 0
    this.lastProgressIteration = 0
    return this.plan
  }

  /**
   * Get the current plan (or null if not initialized)
   */
  getPlan(): ProjectPlan | null {
    return this.plan
  }

  /**
   * Mark a step as in progress
   */
  markStepInProgress(stepId: string): void {
    if (!this.plan) return
    const step = this.plan.steps.find(s => s.id === stepId)
    if (step && step.status === 'pending') {
      step.status = 'in_progress'
      step.startedAt = Date.now()
      this.plan.currentPhase = step.phase
    }
  }

  /**
   * Mark a step as done
   */
  markStepDone(stepId: string): void {
    if (!this.plan) return
    const step = this.plan.steps.find(s => s.id === stepId)
    if (step && step.status !== 'done') {
      step.status = 'done'
      step.completedAt = Date.now()
      this.plan.completedSteps++
      this.lastProgressIteration = this.iterationCount
    }
  }

  /**
   * Mark a step as failed
   */
  markStepFailed(stepId: string, error: string): void {
    if (!this.plan) return
    const step = this.plan.steps.find(s => s.id === stepId)
    if (step) {
      step.status = 'failed'
      step.error = error
    }
  }

  /**
   * Update step statuses based on files that exist on disk.
   * If a step's target files all exist, mark it as done.
   */
  updateFromExistingFiles(existingFiles: string[]): void {
    if (!this.plan) return

    const existingSet = new Set(existingFiles)

    for (const step of this.plan.steps) {
      if (step.status === 'done') continue

      // If all target files for this step exist, mark it done
      if (step.filePaths.length > 0 && step.filePaths.every(f => existingSet.has(f))) {
        step.status = 'done'
        step.completedAt = Date.now()
        this.plan.completedSteps++
        this.lastProgressIteration = this.iterationCount
      }
    }
  }

  /**
   * Increment iteration counter
   */
  incrementIteration(): void {
    this.iterationCount++
  }

  /**
   * Detect if the agent is stuck (no progress for N iterations)
   */
  isStalled(): boolean {
    if (!this.plan) return false
    return (this.iterationCount - this.lastProgressIteration) >= this.stallThreshold
  }

  /**
   * Get the next pending step
   */
  getNextStep(): PlanStep | null {
    if (!this.plan) return null
    return this.plan.steps.find(s => s.status === 'pending') || null
  }

  /**
   * Get the current in-progress step
   */
  getCurrentStep(): PlanStep | null {
    if (!this.plan) return null
    return this.plan.steps.find(s => s.status === 'in_progress') || null
  }

  /**
   * Get a progress report suitable for injecting into the agent context.
   * This is the key integration point — the route.ts calls this to
   * build continuation hints.
   */
  getProgressReport(): string {
    if (!this.plan) return ''

    const lines: string[] = [
      `📊 PROGRESS: ${this.plan.completedSteps}/${this.plan.totalSteps} steps complete`,
      '',
    ]

    for (const step of this.plan.steps) {
      const icon = step.status === 'done' ? '✅'
        : step.status === 'in_progress' ? '🔄'
        : step.status === 'failed' ? '❌'
        : step.status === 'blocked' ? '🚫'
        : '⬜'

      lines.push(`${icon} [${step.phase.toUpperCase()}] ${step.description}`)

      if (step.filePaths.length > 0) {
        lines.push(`   Files: ${step.filePaths.join(', ')}`)
      }
    }

    // If stalled, add warning
    if (this.isStalled()) {
      lines.push('')
      lines.push('⚠️ STALL DETECTED: No progress for 3+ iterations.')
      const nextStep = this.getNextStep()
      if (nextStep) {
        lines.push(`   NEXT ACTION: ${nextStep.description}`)
        if (nextStep.filePaths.length > 0) {
          lines.push(`   Create these files: ${nextStep.filePaths.join(', ')}`)
        }
      }
    }

    return lines.join('\n')
  }

  /**
   * Get the list of all planned file paths
   */
  getPlannedFiles(): string[] {
    if (!this.plan) return []
    return this.plan.steps.flatMap(s => s.filePaths)
  }

  /**
   * Get the list of files that haven't been created yet
   */
  getMissingFiles(existingFiles: string[]): string[] {
    const planned = this.getPlannedFiles()
    const existingSet = new Set(existingFiles)
    return planned.filter(f => !existingSet.has(f))
  }

  /**
   * Check if all planned steps are done
   */
  isComplete(): boolean {
    if (!this.plan) return false
    return this.plan.steps.every(s => s.status === 'done' || s.status === 'failed')
  }

  /**
   * Reset the tracker
   */
  reset(): void {
    this.plan = null
    this.iterationCount = 0
    this.lastProgressIteration = 0
  }
}

// Singleton instance for use across the agent loop
export const planTracker = new PlanTracker()