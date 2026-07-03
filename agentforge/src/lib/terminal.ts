import { exec } from 'child_process'
import path from 'path'
import { getWorkspaceRoot, getProjectWorkspacePath } from './filesystem'

/**
 * Result of a command execution
 */
export interface ExecuteResult {
  stdout: string
  stderr: string
  exitCode: number | null
  executionTime: number
  command: string
  cwd: string
  timedOut: boolean
}

/**
 * Dangerous command patterns that should be blocked
 */
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /rm\s+(-\w*r\w*f|--recursive).*\s+\//, reason: 'Recursive force delete from root directory is not allowed' },
  { pattern: /rm\s+(-\w*f\w*r|--force).*\s+\//, reason: 'Force recursive delete from root directory is not allowed' },
  { pattern: /sudo\s+/, reason: 'sudo is not allowed in sandboxed execution' },
  { pattern: /mkfs/, reason: 'Filesystem formatting is not allowed' },
  { pattern: /dd\s+.*of=\/dev/, reason: 'Writing directly to device files is not allowed' },
  { pattern: /:\(\)\{\s*:\|\:&\s*\}\s*;/, reason: 'Fork bomb pattern is not allowed' },
  { pattern: /chmod\s+(-R\s+)?000\s+\//, reason: 'Removing all permissions from root is not allowed' },
  { pattern: /chown\s+.*\s+\//, reason: 'Changing ownership of root directory is not allowed' },
  { pattern: /shutdown/, reason: 'System shutdown is not allowed' },
  { pattern: /reboot/, reason: 'System reboot is not allowed' },
  { pattern: /init\s+[06]/, reason: 'Changing runlevel is not allowed' },
  { pattern: />\s*\/dev\/sd[a-z]/, reason: 'Writing directly to disk devices is not allowed' },
  { pattern: /curl\s+.*\|\s*(ba)?sh/, reason: 'Piping curl output to shell is not allowed' },
  { pattern: /wget\s+.*\|\s*(ba)?sh/, reason: 'Piping wget output to shell is not allowed' },
]

/**
 * Sanitize and validate a command before execution
 * Returns an error message if the command is dangerous, or null if safe
 */
function sanitizeCommand(command: string): string | null {
  const trimmedCommand = command.trim()

  if (!trimmedCommand) {
    return 'Empty command is not allowed'
  }

  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmedCommand)) {
      return `Blocked: ${reason}`
    }
  }

  return null
}

/**
 * Resolve the working directory for command execution
 * If a projectId is provided, use the project's workspace directory
 * Otherwise, use the workspace root
 */
function resolveCwd(projectId?: string, cwd?: string): string {
  if (cwd && path.isAbsolute(cwd)) {
    // Ensure the cwd is within the workspace
    const workspaceRoot = getWorkspaceRoot()
    const resolved = path.resolve(cwd)
    if (resolved.startsWith(workspaceRoot)) {
      return resolved
    }
    // If the provided cwd escapes workspace, fall back to workspace root
    return workspaceRoot
  }

  if (projectId) {
    const projectPath = getProjectWorkspacePath(projectId)
    return projectPath
  }

  return getWorkspaceRoot()
}

/**
 * Execute a shell command and return the result
 *
 * @param command - The shell command to execute
 * @param options - Execution options
 * @param options.projectId - If provided, run in the project's workspace directory
 * @param options.cwd - Override working directory (must be within workspace)
 * @param options.timeout - Maximum execution time in milliseconds (default: 30000)
 * @param options.maxBuffer - Maximum buffer size for stdout/stderr (default: 5MB)
 */
export async function executeCommand(
  command: string,
  options: {
    projectId?: string
    cwd?: string
    timeout?: number
    maxBuffer?: number
  } = {}
): Promise<ExecuteResult> {
  const {
    projectId,
    cwd,
    timeout = 30000,
    maxBuffer = 5 * 1024 * 1024, // 5MB
  } = options

  // Sanitize the command
  const sanitizeError = sanitizeCommand(command)
  if (sanitizeError) {
    return {
      stdout: '',
      stderr: sanitizeError,
      exitCode: 1,
      executionTime: 0,
      command,
      cwd: resolveCwd(projectId, cwd),
      timedOut: false,
    }
  }

  const resolvedCwd = resolveCwd(projectId, cwd)
  const startTime = Date.now()

  // v1.3 ROOT FIX: Persistent background processes.
  if (command.trim().endsWith('&')) {
    const cleanCmd = command.trim().slice(0, -1).trim();
    return new Promise<ExecuteResult>((resolve) => {
      const child = spawn(cleanCmd, {
        cwd: resolvedCwd,
        shell: '/bin/bash',
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      setTimeout(() => {
        resolve({
          stdout: `Background process started (PID: ${child.pid})`,
          stderr: '',
          exitCode: 0,
          executionTime: Date.now() - startTime,
          command,
          cwd: resolvedCwd,
          timedOut: false,
        });
      }, 1000);
    });
  }

  return new Promise<ExecuteResult>((resolve) => {
    const childProcess = exec(
      command,
      {
        cwd: resolvedCwd,
        timeout,
        maxBuffer,
        env: {
          ...process.env,
          // Force non-interactive mode
          TERM: 'dumb',
          // Disable input prompts
          CI: 'true',
          // Set a reasonable PATH
          PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
        },
        // Shell options for safety
        shell: '/bin/bash',
      },
      (error, stdout, stderr) => {
        const executionTime = Date.now() - startTime
        const timedOut = error?.killed === true && error?.signal === 'SIGTERM'

        resolve({
          stdout: stdout || '',
          stderr: stderr || '',
          exitCode: error ? (error.code ?? 1) : 0,
          executionTime,
          command,
          cwd: resolvedCwd,
          timedOut,
        })
      }
    )

    // Handle process errors (e.g., spawn failures)
    childProcess.on('error', (err) => {
      const executionTime = Date.now() - startTime
      resolve({
        stdout: '',
        stderr: `Failed to execute command: ${err.message}`,
        exitCode: 1,
        executionTime,
        command,
        cwd: resolvedCwd,
        timedOut: false,
      })
    })
  })
}

/**
 * Determine the execution command based on language
 */
export function getLanguageCommand(
  language: string,
  code: string,
  projectId: string
): { command: string; fileName?: string } {
  const projectPath = getProjectWorkspacePath(projectId)
  const tmpDir = path.join(projectPath, '.agent-tmp')

  switch (language.toLowerCase()) {
    case 'javascript':
    case 'js': {
      const fileName = `.agent-tmp/run_${Date.now()}.js`
      return {
        command: `bun run "${path.join(projectPath, fileName)}"`,
        fileName,
      }
    }
    case 'typescript':
    case 'ts':
    case 'tsx': {
      const fileName = `.agent-tmp/run_${Date.now()}.ts`
      return {
        command: `bun run "${path.join(projectPath, fileName)}"`,
        fileName,
      }
    }
    case 'python':
    case 'py': {
      const fileName = `.agent-tmp/run_${Date.now()}.py`
      return {
        command: `python3 "${path.join(projectPath, fileName)}"`,
        fileName,
      }
    }
    case 'sql': {
      // Write SQL to a temp file and execute with sqlite3 against project DB
      const dbPath = path.join(projectPath, 'app.db')
      const fileName = `.agent-tmp/query_${Date.now()}.sql`
      return {
        command: `sqlite3 "${dbPath}" < "${path.join(projectPath, fileName)}"`,
        fileName,
      }
    }
    case 'bash':
    case 'sh': {
      const fileName = `.agent-tmp/script_${Date.now()}.sh`
      return {
        command: `bash "${path.join(projectPath, fileName)}"`,
        fileName,
      }
    }
    case 'html':
    case 'css': {
      // For HTML/CSS, do basic validation instead of execution
      return { command: '' }
    }
    case 'json': {
      // Validate JSON by writing to a temp file first — avoids command injection
      // via echo piping. This is consistent with the other language handlers.
      const fileName = `.agent-tmp/validate_${Date.now()}.json`
      return {
        command: `python3 -m json.tool "${path.join(projectPath, fileName)}" > /dev/null 2>&1 && echo "✓ Valid JSON" || echo "✗ Invalid JSON"`,
        fileName,
      }
    }
    case 'prisma': {
      return {
        command: `cd "${projectPath}" && npx prisma validate 2>&1 || echo "Prisma validation not available"`,
      }
    }
    default: {
      const fileName = `.agent-tmp/run_${Date.now()}.txt`
      return {
        command: `echo "No execution handler for language: ${language}"`,
      }
    }
  }
}

/**
 * Get the temporary directory path for a project
 */
export function getTmpDir(projectId: string): string {
  return path.join(getProjectWorkspacePath(projectId), '.agent-tmp')
}
