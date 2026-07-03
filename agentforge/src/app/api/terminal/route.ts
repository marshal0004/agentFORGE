import { NextResponse } from 'next/server'
import { executeCommand } from '@/lib/terminal'

/**
 * POST /api/terminal - Execute a command
 * Body: { command: string, projectId?: string, timeout?: number }
 *
 * If projectId is provided, the command runs in that project's workspace directory.
 * Otherwise, it runs in the workspace root.
 *
 * Returns: { stdout, stderr, exitCode, executionTime, command, cwd, timedOut }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { command, projectId, timeout } = body

    if (!command) {
      return NextResponse.json(
        { error: 'command is required' },
        { status: 400 }
      )
    }

    if (typeof command !== 'string') {
      return NextResponse.json(
        { error: 'command must be a string' },
        { status: 400 }
      )
    }

    // Cap the timeout to prevent excessively long-running commands
    const maxTimeout = 120000 // 2 minutes
    const effectiveTimeout = timeout
      ? Math.min(Number(timeout), maxTimeout)
      : 30000

    const result = await executeCommand(command, {
      projectId: projectId || undefined,
      timeout: effectiveTimeout,
    })

    return NextResponse.json({
      success: result.exitCode === 0,
      ...result,
    })
  } catch (error) {
    console.error('Terminal API error:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to execute command',
        details: (error as Error).message,
      },
      { status: 500 }
    )
  }
}
