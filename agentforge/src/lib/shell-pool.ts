/**
 * Claude Code-Style Persistent Shell Pool — Production Implementation
 *
 * Mirrors Claude Code v2.1.165+:
 *   - Long-lived shell pool keyed by shell ID (shells persist across turns)
 *   - BashOutput(shell_id) reads recent stdout
 *   - KillShell(shell_id) stops a shell with SIGTERM (not SIGKILL)
 *   - Graceful teardown sends SIGTERM, waits, then SIGKILL only as last resort
 *
 * Why this matters for agentFORGE:
 *   - Background servers (Flask / Next dev / Node) survive across tool calls
 *   - Long-running test suites keep their stdout buffer
 *   - SIGTERM lets cleanup handlers run (vs SIGKILL which kills instantly)
 *
 * Replaces child_process.exec() in terminal.ts for the persistent use case.
 * One-shot commands still use exec() (no shell pool overhead for "ls").
 */

import { spawn, ChildProcess } from 'child_process'
import { agentEventBus } from './event-bus'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ShellPoolOptions {
  /** Working directory for new shells */
  cwd?: string
  /** Environment variables */
  env?: Record<string, string>
  /** Max stdout/stderr buffer per shell (in chars). Default: 100_000 (~100KB) */
  maxBufferChars?: number
  /** SIGTERM → SIGKILL grace period in ms. Default: 5000 */
  sigtermGraceMs?: number
  /** Idle timeout in ms — shells that haven't been read in this long get reaped. Default: 600_000 (10 min) */
  idleTimeoutMs?: number
}

export interface PersistentShell {
  /** Unique shell ID */
  id: string
  /** The underlying child process */
  process: ChildProcess
  /** Working directory */
  cwd: string
  /** Stdout ring buffer (most recent first) */
  stdoutBuffer: string
  /** Stderr ring buffer (most recent first) */
  stderrBuffer: string
  /** Last exit code (null if still running) */
  exitCode: number | null
  /** Whether the shell is still alive */
  alive: boolean
  /** Whether the shell was killed (vs exited naturally) */
  killed: boolean
  /** Process start time (ms epoch) */
  startedAt: number
  /** Last time the shell was read (for idle reaping) */
  lastReadAt: number
  /** Pending kill timer (for SIGTERM grace) */
  killTimer?: NodeJS.Timeout
}

export interface ShellOutputResult {
  /** Shell ID */
  shellId: string
  /** All stdout accumulated since last read (or since start) */
  stdout: string
  /** All stderr accumulated since last read (or since start) */
  stderr: string
  /** Whether the shell is still alive */
  alive: boolean
  /** Exit code if the shell has terminated */
  exitCode: number | null
}

export interface KillResult {
  /** Shell ID */
  shellId: string
  /** Whether the kill signal was sent */
  signalSent: boolean
  /** Signal used: 'SIGTERM' or 'SIGKILL' */
  signal: 'SIGTERM' | 'SIGKILL'
  /** Whether the process is now dead */
  killed: boolean
  /** Error message (if any) */
  error?: string
}

// ── Shell Pool ───────────────────────────────────────────────────────────────

class ShellPool {
  private shells: Map<string, PersistentShell> = new Map()
  private counter = 0
  private defaultOptions: ShellPoolOptions = {
    maxBufferChars: 100_000,
    sigtermGraceMs: 5000,
    idleTimeoutMs: 600_000,
  }

  /**
   * Spawn a new persistent shell.
   *
   * The shell runs /bin/bash (or cmd.exe on Windows) and stays alive
   * across multiple command-execution calls. Use `runInShell` to execute
   * commands inside it, `getOutput` to read recent stdout/stderr.
   */
  spawn(options: ShellPoolOptions = {}): string {
    const opts = { ...this.defaultOptions, ...options }
    const id = `shell_${++this.counter}_${Date.now()}`

    const child = spawn(
      process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
      process.platform === 'win32' ? [] : ['--noprofile', '--norc', '-i'],
      {
        cwd: opts.cwd || process.cwd(),
        env: {
          ...process.env,
          ...opts.env,
          // Force non-interactive prompts
          TERM: 'dumb',
          CI: 'true',
          PS1: '$ ',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )

    const shell: PersistentShell = {
      id,
      process: child,
      cwd: opts.cwd || process.cwd(),
      stdoutBuffer: '',
      stderrBuffer: '',
      exitCode: null,
      alive: true,
      killed: false,
      startedAt: Date.now(),
      lastReadAt: Date.now(),
    }

    // Wire stdout
    child.stdout?.on('data', (data: Buffer) => {
      const str = data.toString('utf-8')
      shell.stdoutBuffer = (shell.stdoutBuffer + str).slice(-(opts.maxBufferChars || 100_000))
      shell.lastReadAt = Date.now()
    })

    // Wire stderr
    child.stderr?.on('data', (data: Buffer) => {
      const str = data.toString('utf-8')
      shell.stderrBuffer = (shell.stderrBuffer + str).slice(-(opts.maxBufferChars || 100_000))
      shell.lastReadAt = Date.now()
    })

    // Wire exit
    child.on('exit', (code, signal) => {
      shell.alive = false
      shell.exitCode = code
      if (signal) {
        shell.killed = true
      }
      agentEventBus.emit('terminal:exit', {
        shellId: id,
        exitCode: code,
        signal: signal || undefined,
      })
    })

    child.on('error', (err) => {
      shell.alive = false
      shell.stderrBuffer += `\n[shell error: ${err.message}]\n`
      agentEventBus.emit('agent:error', {
        sessionId: id,
        error: `Shell ${id} error: ${err.message}`,
        phase: 'shell-pool',
      })
    })

    this.shells.set(id, shell)
    agentEventBus.emit('terminal:shell-started', { shellId: id, cwd: shell.cwd })

    // Schedule idle reap
    this.scheduleIdleReap(id, opts.idleTimeoutMs || 600_000)

    return id
  }

  /**
   * Run a command in an existing shell. The shell stays alive after the command.
   *
   * Uses a sentinel marker to detect command completion:
   *   echo "<marker>"; <command>; echo "<marker>:$?"
   *
   * Resolves when the marker appears in stdout, with the command's exit code.
   */
  async runInShell(
    shellId: string,
    command: string,
    options: { timeoutMs?: number } = {},
  ): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
    const shell = this.shells.get(shellId)
    if (!shell) {
      throw new Error(`Shell ${shellId} not found`)
    }
    if (!shell.alive) {
      throw new Error(`Shell ${shellId} is not alive (exit code ${shell.exitCode})`)
    }

    // Sentinel marker — unique per call
    const marker = `__AGENTFORGE_END_${Date.now()}_${Math.random().toString(36).slice(2, 8)}__`

    // We need to detect when the command finishes by watching stdout for the marker
    return new Promise((resolve) => {
      const timeoutMs = options.timeoutMs ?? 30_000
      let resolved = false
      let accumulatedStdout = ''
      let accumulatedStderr = ''
      const startBufferLen = shell.stdoutBuffer.length
      const startErrBufferLen = shell.stderrBuffer.length

      const timeoutHandle = setTimeout(() => {
        if (resolved) return
        resolved = true
        // On timeout, send SIGINT to interrupt the command (but don't kill the shell)
        try {
          shell.process.kill('SIGINT')
        } catch {
          // ignore
        }
        resolve({
          stdout: accumulatedStdout,
          stderr: accumulatedStderr + '\n[timeout — command interrupted with SIGINT]',
          exitCode: 124, // Standard timeout exit code
          timedOut: true,
        })
      }, timeoutMs)

      // Write the command + marker to stdin
      const wrappedCmd = `${command}; echo "${marker}:$?"\n`
      shell.process.stdin?.write(wrappedCmd)

      // Poll for the marker
      const checkInterval = setInterval(() => {
        if (resolved) return

        // Get new output since start
        const newOut = shell.stdoutBuffer.slice(startBufferLen)
        const newErr = shell.stderrBuffer.slice(startErrBufferLen)
        accumulatedStdout = newOut
        accumulatedStderr = newErr

        const markerRe = new RegExp(`${marker}:(\\d+)`)
        const match = newOut.match(markerRe)
        if (match) {
          resolved = true
          clearInterval(checkInterval)
          clearTimeout(timeoutHandle)

          // Strip the marker line from stdout
          const cleanOut = newOut.replace(new RegExp(`${marker}:\\d+\n?`), '').replace(new RegExp(`${marker}\\n?`), '')

          resolve({
            stdout: cleanOut,
            stderr: accumulatedStderr,
            exitCode: parseInt(match[1], 10),
            timedOut: false,
          })
        }
      }, 50)

      // If shell dies, resolve immediately
      shell.process.once('exit', () => {
        if (resolved) return
        resolved = true
        clearInterval(checkInterval)
        clearTimeout(timeoutHandle)
        resolve({
          stdout: accumulatedStdout,
          stderr: accumulatedStderr + `\n[shell exited with code ${shell.exitCode}]`,
          exitCode: shell.exitCode ?? 1,
          timedOut: false,
        })
      })
    })
  }

  /**
   * Get recent stdout/stderr from a shell.
   * Resets the "new" pointer so subsequent calls only return fresh output.
   */
  getOutput(shellId: string, since?: number): ShellOutputResult | null {
    const shell = this.shells.get(shellId)
    if (!shell) return null

    const stdout = since ? shell.stdoutBuffer.slice(since) : shell.stdoutBuffer
    const stderr = since ? shell.stderrBuffer.slice(since) : shell.stderrBuffer

    return {
      shellId,
      stdout,
      stderr,
      alive: shell.alive,
      exitCode: shell.exitCode,
    }
  }

  /**
   * Kill a shell. Sends SIGTERM first, escalates to SIGKILL after grace period.
   *
   * Returns as soon as SIGTERM is sent (doesn't wait for process to die).
   * Use `getOutput` to check if it actually died.
   */
  kill(shellId: string, options: { graceMs?: number; signal?: 'SIGTERM' | 'SIGKILL' } = {}): KillResult {
    const shell = this.shells.get(shellId)
    if (!shell) {
      return { shellId, signalSent: false, signal: 'SIGTERM', killed: false, error: 'Shell not found' }
    }

    if (!shell.alive) {
      return { shellId, signalSent: false, signal: 'SIGTERM', killed: true }
    }

    const graceMs = options.graceMs ?? this.defaultOptions.sigtermGraceMs ?? 5000
    const signal = options.signal ?? 'SIGTERM'

    try {
      shell.process.kill(signal)
      shell.killed = true

      // Schedule SIGKILL if it doesn't die within grace period
      if (signal === 'SIGTERM' && graceMs > 0) {
        shell.killTimer = setTimeout(() => {
          if (shell.alive) {
            try {
              shell.process.kill('SIGKILL')
              agentEventBus.emit('terminal:killed', {
                shellId,
                signal: 'SIGKILL',
                reason: 'did not exit after SIGTERM grace period',
              })
            } catch {
              // already dead
            }
          }
        }, graceMs)
      }

      agentEventBus.emit('terminal:killed', { shellId, signal, reason: 'requested by caller' })

      return {
        shellId,
        signalSent: true,
        signal,
        killed: !shell.alive,
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      return {
        shellId,
        signalSent: false,
        signal,
        killed: !shell.alive,
        error: errMsg,
      }
    }
  }

  /**
   * List all shells (alive and dead).
   */
  list(): Array<{
    id: string
    alive: boolean
    exitCode: number | null
    startedAt: number
    cwd: string
    stdoutLen: number
    stderrLen: number
  }> {
    return [...this.shells.values()].map((s) => ({
      id: s.id,
      alive: s.alive,
      exitCode: s.exitCode,
      startedAt: s.startedAt,
      cwd: s.cwd,
      stdoutLen: s.stdoutBuffer.length,
      stderrLen: s.stderrBuffer.length,
    }))
  }

  /**
   * Get a specific shell.
   */
  get(shellId: string): PersistentShell | undefined {
    return this.shells.get(shellId)
  }

  /**
   * Clean up all shells. Called on process exit.
   */
  async cleanup(): Promise<void> {
    const killPromises: Promise<void>[] = []

    for (const shellId of [...this.shells.keys()]) {
      killPromises.push(
        new Promise<void>((resolve) => {
          const shell = this.shells.get(shellId)
          if (!shell || !shell.alive) {
            resolve()
            return
          }

          // SIGTERM
          try {
            shell.process.kill('SIGTERM')
          } catch {
            resolve()
            return
          }

          // Wait up to grace period for it to die
          const graceMs = this.defaultOptions.sigtermGraceMs ?? 5000
          const checkStart = Date.now()
          const checkInterval = setInterval(() => {
            if (!shell.alive || Date.now() - checkStart > graceMs) {
              clearInterval(checkInterval)
              if (shell.alive) {
                try {
                  shell.process.kill('SIGKILL')
                } catch {
                  // ignore
                }
              }
              resolve()
            }
          }, 100)
        }),
      )
    }

    await Promise.all(killPromises)
    this.shells.clear()
  }

  /**
   * Schedule a shell for idle reaping.
   */
  private scheduleIdleReap(shellId: string, idleTimeoutMs: number): void {
    setTimeout(() => {
      const shell = this.shells.get(shellId)
      if (!shell) return
      if (!shell.alive) {
        // Already dead — remove from pool
        this.shells.delete(shellId)
        return
      }
      const idleMs = Date.now() - shell.lastReadAt
      if (idleMs >= idleTimeoutMs) {
        console.log(`[ShellPool] Reaping idle shell ${shellId} (idle ${Math.round(idleMs / 1000)}s)`)
        this.kill(shellId, { signal: 'SIGTERM' })
        // Remove from pool after grace period
        setTimeout(() => {
          this.shells.delete(shellId)
        }, this.defaultOptions.sigtermGraceMs || 5000)
      } else {
        // Reschedule
        this.scheduleIdleReap(shellId, idleTimeoutMs - idleMs)
      }
    }, idleTimeoutMs)
  }

  /**
   * Clear all shells without killing (for tests).
   */
  clear(): void {
    for (const shell of this.shells.values()) {
      if (shell.alive) {
        try {
          shell.process.kill('SIGKILL')
        } catch {
          // ignore
        }
      }
      if (shell.killTimer) {
        clearTimeout(shell.killTimer)
      }
    }
    this.shells.clear()
    this.counter = 0
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

export const shellPool = new ShellPool()

// ── Process Exit Cleanup ────────────────────────────────────────────────────

// Don't let shells leak on process exit
let cleanupRegistered = false
function registerCleanup(): void {
  if (cleanupRegistered) return
  cleanupRegistered = true

  const doCleanup = async () => {
    await shellPool.cleanup()
    process.exit(0)
  }

  process.once('SIGINT', doCleanup)
  process.once('SIGTERM', doCleanup)
  process.once('beforeExit', () => {
    shellPool.cleanup()
  })
}

registerCleanup()
