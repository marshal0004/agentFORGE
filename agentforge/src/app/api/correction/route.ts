import { NextResponse } from 'next/server'
import {
  SelfCorrectionLoop,
  createDefaultValidationSteps,
  parseTypeScriptErrors,
  parseESLintErrors,
  parsePrettierErrors,
  type ValidationError,
  type CorrectionConfig,
  type CorrectionResult,
} from '@/lib/self-correction'

// In-memory state for the correction loop
let activeLoop: SelfCorrectionLoop | null = null
let currentStatus: 'idle' | 'running' | 'pass' | 'fail' = 'idle'
let currentErrors: ValidationError[] = []
let currentWarnings: ValidationError[] = []
let lastResult: CorrectionResult | null = null

// Step toggles (which validation steps are enabled)
const stepToggles: Record<string, boolean> = {
  typescript: true,
  eslint: true,
  prettier: true,
}

// Auto-fix toggle
let autoFixEnabled = true

// Blocked operations log (from file protection)
interface BlockedOperation {
  id: string
  timestamp: number
  filePath: string
  operation: string
  reason: string
}

const blockedOperations: BlockedOperation[] = []

// GET /api/correction — Return current correction status
export async function GET() {
  try {
    return NextResponse.json({
      status: currentStatus,
      errors: currentErrors,
      warnings: currentWarnings,
      lastResult: lastResult
        ? {
            validated: lastResult.validated,
            iterations: lastResult.iterations,
            maxIterations: lastResult.maxIterations,
            fixedErrors: lastResult.fixedErrors,
            remainingErrors: lastResult.remainingErrors,
            correctionHistory: lastResult.correctionHistory,
          }
        : null,
      stepToggles,
      autoFixEnabled,
      blockedOperations: blockedOperations.slice(-50),
    })
  } catch (error) {
    console.error('[Correction API] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to get correction status' },
      { status: 500 },
    )
  }
}

// POST /api/correction — Trigger validation or correction
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { action, projectPath, config } = body

    switch (action) {
      case 'validate': {
        // Run validation only (no auto-fix)
        if (!projectPath) {
          return NextResponse.json(
            { error: 'projectPath is required' },
            { status: 400 },
          )
        }

        currentStatus = 'running'
        const steps = createDefaultValidationSteps(projectPath).filter(
          (step) => stepToggles[step.name] !== false,
        )

        const loop = new SelfCorrectionLoop({
          steps,
          maxIterations: 0, // Validation only, no correction
          skipFileProtection: false,
        })

        const errors = await loop.validate(projectPath)
        currentErrors = errors.filter((e) => e.severity === 'error')
        currentWarnings = errors.filter((e) => e.severity === 'warning')
        currentStatus = currentErrors.length === 0 ? 'pass' : 'fail'

        return NextResponse.json({
          status: currentStatus,
          errors: currentErrors,
          warnings: currentWarnings,
          totalErrors: currentErrors.length,
          totalWarnings: currentWarnings.length,
        })
      }

      case 'correct': {
        // Run the full correction loop
        if (!projectPath) {
          return NextResponse.json(
            { error: 'projectPath is required' },
            { status: 400 },
          )
        }

        if (currentStatus === 'running') {
          return NextResponse.json(
            { error: 'A correction loop is already running' },
            { status: 409 },
          )
        }

        currentStatus = 'running'
        const steps = createDefaultValidationSteps(projectPath).filter(
          (step) => stepToggles[step.name] !== false,
        )

        const correctionConfig: CorrectionConfig = {
          steps,
          maxIterations: config?.maxIterations ?? 3,
          model: config?.model ?? 'glm-5.1',
          skipFileProtection: !autoFixEnabled ? true : false,
        }

        activeLoop = new SelfCorrectionLoop(correctionConfig)
        const result = await activeLoop.correctUntilClean(projectPath)

        currentErrors = result.errors
        currentWarnings = result.warnings
        currentStatus = result.validated ? 'pass' : 'fail'
        lastResult = result
        activeLoop = null

        return NextResponse.json({
          status: currentStatus,
          validated: result.validated,
          iterations: result.iterations,
          maxIterations: result.maxIterations,
          fixedErrors: result.fixedErrors,
          remainingErrors: result.remainingErrors,
          errors: result.errors,
          warnings: result.warnings,
          correctionHistory: result.correctionHistory,
        })
      }

      case 'toggle-step': {
        // Toggle a validation step on/off
        const { stepName, enabled } = body
        if (!stepName) {
          return NextResponse.json(
            { error: 'stepName is required' },
            { status: 400 },
          )
        }
        stepToggles[stepName] = enabled ?? !stepToggles[stepName]
        return NextResponse.json({
          success: true,
          stepToggles,
        })
      }

      case 'toggle-autofix': {
        // Toggle auto-fix on/off
        const { enabled: autoFixValue } = body
        autoFixEnabled = autoFixValue ?? !autoFixEnabled
        return NextResponse.json({
          success: true,
          autoFixEnabled,
        })
      }

      case 'clear-errors': {
        // Clear current errors
        currentErrors = []
        currentWarnings = []
        currentStatus = 'idle'
        return NextResponse.json({ success: true })
      }

      case 'record-blocked': {
        // Record a blocked operation from file protection
        const { filePath, operation, reason } = body
        if (!filePath) {
          return NextResponse.json(
            { error: 'filePath is required' },
            { status: 400 },
          )
        }
        blockedOperations.push({
          id: `blk_${Date.now()}_${blockedOperations.length}`,
          timestamp: Date.now(),
          filePath,
          operation: operation || 'write',
          reason: reason || 'Protected file',
        })
        if (blockedOperations.length > 200) {
          blockedOperations.splice(0, blockedOperations.length - 200)
        }
        return NextResponse.json({ success: true })
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 },
        )
    }
  } catch (error) {
    console.error('[Correction API] POST error:', error)
    currentStatus = 'fail'
    return NextResponse.json(
      { error: 'Failed to process correction action' },
      { status: 500 },
    )
  }
}
