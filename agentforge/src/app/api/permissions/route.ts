import { NextResponse } from 'next/server'
import { executeCommand } from '@/lib/terminal'
import { shellPool } from '@/lib/shell-pool'
import { getProjectWorkspacePath } from '@/lib/filesystem'

/**
 * POST /api/terminal - Execute a command
 * Body: { command: string, projectId?: string, timeout?: number }
 *
 * If projectId is provided, the command runs in that project's workspace directory.
 * Otherwise, it runs in the workspace root.
 *
 * v1.4: Supports persistent shell mode via `shellId` parameter.
 * If `shellId` is provided, the command runs in that persistent shell
 * (Claude Code v2.1.165 pattern). The shell stays alive across calls.
 *
 * Body (persistent shell mode):
 *   { command: string, shellId: string, timeout?: number }
 *
 * Returns: { stdout, stderr, exitCode, executionTime, command, cwd, timedOut }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { command, projectId, timeout, shellId } = body

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

    // v1.4: Persistent shell mode — if shellId provided, run in that shell
    if (shellId && typeof shellId === 'string') {
      try {
        const result = await shellPool.runInShell(shellId, command, { timeoutMs: effectiveTimeout })
        return NextResponse.json({
          success: result.exitCode === 0,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          executionTime: 0, // not tracked separately in shell-pool mode
          command,
          cwd: '', // populated by the shell's cwd
          timedOut: result.timedOut,
          shellId,
        })
      } catch (err) {
        return NextResponse.json(
          {
            success: false,
            error: 'Persistent shell execution failed',
            details: (err as Error).message,
            shellId,
          },
          { status: 500 }
        )
      }
    }

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

/**
 * GET /api/terminal - List active persistent shells
 *
 * v1.4: Mirrors Claude Code's BashOutput(shell_id) + KillShell(shell_id).
 * Query params:
 *   ?action=list        — list all shells (default)
 *   ?action=output&id=X — get recent stdout from shell X
 *   ?action=kill&id=X   — kill shell X with SIGTERM
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const action = url.searchParams.get('action') || 'list'
    const id = url.searchParams.get('id')

    if (action === 'list') {
      const shells = shellPool.list()
      return NextResponse.json({ success: true, shells })
    }

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id parameter is required for action=' + action },
        { status: 400 }
      )
    }

    if (action === 'output') {
      const output = shellPool.getOutput(id)
      if (!output) {
        return NextResponse.json(
          { success: false, error: `Shell ${id} not found` },
          { status: 404 }
        )
      }
      return NextResponse.json({ success: true, ...output })
    }

    if (action === 'kill') {
      const result = shellPool.kill(id)
      return NextResponse.json({ success: result.signalSent, ...result })
    }

    return NextResponse.json(
      { success: false, error: `Unknown action: ${action}` },
      { status: 400 }
    )
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}

/**
 * POST /api/terminal with action=spawn creates a new persistent shell.
 *
 * Body: { action: 'spawn', projectId?: string }
 * Returns: { shellId: string }
 *
 * This is the Claude Code v2.1.165 pattern — shells persist across
 * tool calls so background servers (Flask / Next dev / Node) survive.
 */
export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const { projectId } = body

    const cwd = projectId ? getProjectWorkspacePath(projectId) : undefined
    const shellId = shellPool.spawn({ cwd })

    return NextResponse.json({
      success: true,
      shellId,
      cwd: cwd || process.cwd(),
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}
