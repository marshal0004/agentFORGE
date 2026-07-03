import { NextResponse } from 'next/server'
import {
  fileProtectionManager,
  DEFAULT_PROTECTED_FILES,
  type FileProtectionRule,
} from '@/lib/file-protection'

// Blocked operations log
interface BlockedOperation {
  id: string
  timestamp: number
  filePath: string
  operation: 'read' | 'write'
  reason: string
  matchedPattern?: string
}

const blockedOperationsLog: BlockedOperation[] = []

// GET /api/protection — Return current protection rules and status
export async function GET() {
  try {
    const rules = fileProtectionManager.getRules()
    const isEnabled = fileProtectionManager.isEnabled()

    return NextResponse.json({
      enabled: isEnabled,
      rules: rules.map((rule) => ({
        pattern: typeof rule.pattern === 'string' ? rule.pattern : rule.pattern.source,
        reason: rule.reason,
        allowRead: rule.allowRead,
        allowWrite: rule.allowWrite,
      })),
      totalRules: rules.length,
      blockedOperations: blockedOperationsLog.slice(-100),
      defaultRulesCount: DEFAULT_PROTECTED_FILES.length,
    })
  } catch (error) {
    console.error('[Protection API] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to get protection rules' },
      { status: 500 },
    )
  }
}

// POST /api/protection — Add/remove rules, toggle protection, check paths
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { action } = body

    switch (action) {
      case 'add-rule': {
        const { pattern, reason, allowRead, allowWrite } = body
        if (!pattern || !reason) {
          return NextResponse.json(
            { error: 'pattern and reason are required' },
            { status: 400 },
          )
        }
        const rule: FileProtectionRule = {
          pattern,
          reason,
          allowRead: allowRead ?? true,
          allowWrite: allowWrite ?? false,
        }
        fileProtectionManager.addRule(rule)
        return NextResponse.json({
          success: true,
          rule: {
            pattern: typeof rule.pattern === 'string' ? rule.pattern : rule.pattern.source,
            reason: rule.reason,
            allowRead: rule.allowRead,
            allowWrite: rule.allowWrite,
          },
        })
      }

      case 'remove-rule': {
        const { pattern } = body
        if (!pattern) {
          return NextResponse.json(
            { error: 'pattern is required' },
            { status: 400 },
          )
        }
        const removed = fileProtectionManager.removeRule(pattern)
        return NextResponse.json({ success: removed, pattern })
      }

      case 'toggle-protection': {
        const { enabled } = body
        if (enabled === undefined) {
          return NextResponse.json(
            { error: 'enabled is required' },
            { status: 400 },
          )
        }
        if (enabled) {
          fileProtectionManager.enable()
        } else {
          fileProtectionManager.disable()
        }
        return NextResponse.json({
          success: true,
          enabled: fileProtectionManager.isEnabled(),
        })
      }

      case 'check-path': {
        const { filePath } = body
        if (!filePath) {
          return NextResponse.json(
            { error: 'filePath is required' },
            { status: 400 },
          )
        }
        const diagnosis = fileProtectionManager.diagnose(filePath)
        return NextResponse.json({ diagnosis })
      }

      case 'unlock': {
        const { filePath } = body
        if (!filePath) {
          return NextResponse.json(
            { error: 'filePath is required' },
            { status: 400 },
          )
        }
        fileProtectionManager.unlock(filePath)
        return NextResponse.json({ success: true, filePath })
      }

      case 'relock': {
        const { filePath } = body
        if (!filePath) {
          return NextResponse.json(
            { error: 'filePath is required' },
            { status: 400 },
          )
        }
        fileProtectionManager.relock(filePath)
        return NextResponse.json({ success: true, filePath })
      }

      case 'record-blocked': {
        const { filePath, operation, reason, matchedPattern } = body
        if (!filePath) {
          return NextResponse.json(
            { error: 'filePath is required' },
            { status: 400 },
          )
        }
        blockedOperationsLog.push({
          id: `blk_${Date.now()}_${blockedOperationsLog.length}`,
          timestamp: Date.now(),
          filePath,
          operation: operation || 'write',
          reason: reason || 'Protected file',
          matchedPattern,
        })
        if (blockedOperationsLog.length > 500) {
          blockedOperationsLog.splice(0, blockedOperationsLog.length - 500)
        }
        return NextResponse.json({ success: true })
      }

      case 'clear-blocked-log': {
        blockedOperationsLog.length = 0
        return NextResponse.json({ success: true })
      }

      case 'reset-defaults': {
        fileProtectionManager.setRules(DEFAULT_PROTECTED_FILES)
        return NextResponse.json({
          success: true,
          rulesCount: fileProtectionManager.getRules().length,
        })
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 },
        )
    }
  } catch (error) {
    console.error('[Protection API] POST error:', error)
    return NextResponse.json(
      { error: 'Failed to process protection action' },
      { status: 500 },
    )
  }
}
