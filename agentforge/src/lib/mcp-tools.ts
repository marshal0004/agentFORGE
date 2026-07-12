/**
 * MCP Tool Invocation Service
 *
 * Provides two layers of tool execution:
 *
 * 1. **Built-in tool handlers** — Direct implementations using z-ai-web-dev-sdk
 *    and Node.js built-in modules. These are always available regardless of
 *    whether any MCP server process is running.
 *
 * 2. **Dynamic MCP tool discovery** — Tools discovered from connected MCP server
 *    processes via the real MCP protocol. The `getMCPToolsFromServers()` function
 *    returns the union of all tools from all connected servers, and
 *    `executeMCPToolCall()` routes calls through the MCP JSON-RPC protocol.
 */

import { exec } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { mcpClient, MCPToolSchema } from '@/lib/mcp-client'
import { extensionSystem } from '@/lib/extension-system'
import { agentEventBus } from '@/lib/event-bus'
import { applyDiffToFile, DiffOperation } from '@/lib/diff-editor'
import { db } from '@/lib/db'
import { createZAIInstance } from '@/lib/llm-provider'

const execAsync = promisify(exec)

// In-memory key-value store for the store/retrieve tools
const memoryStore = new Map<string, unknown>()

// Maximum output length for shell commands to prevent overwhelming responses
const MAX_OUTPUT_LENGTH = 50000

// ─────────────────────────────────────────────────────────────────────────────
// CRITICAL FIX: Path Resolution Utility
//
// When a projectId is provided, the agent must resolve ALL paths relative to
// the project workspace directory. The LLM may send absolute paths from the
// USER's machine (e.g., /home/neeraj/Downloads/agentforge/workspace/projId/...),
// but on the SERVER the project lives at a different location
// (e.g., /home/z/my-project/upload/agentforge/workspace/projId/...).
//
// The old code stripped the leading "/" and treated the entire path as relative
// to projectDir, causing DOUBLED paths like:
//   projectDir + "/home/neeraj/.../workspace/projId"
//   → /server/workspace/projId/home/neeraj/.../workspace/projId
//
// The fix: extract the RELATIVE portion within the project by finding the
// workspace/<projectId> segment and taking everything after it.
// ─────────────────────────────────────────────────────────────────────────────

interface PathResolutionResult {
  resolvedPath: string
  relativePath: string
  error?: string
}

/**
 * Resolve a path within a project workspace, handling the case where the LLM
 * sends absolute paths from the user's machine instead of relative paths.
 *
 * Resolution logic:
 *   1. If path is relative → resolve directly against projectDir
 *   2. If path is absolute AND contains "workspace/<projectId>" → extract relative part
 *   3. If path is absolute AND the last segment IS the projectId → treat as project root
 *   4. If path is absolute AND starts with projectDir (server path) → use directly
 *   5. Otherwise → return error with helpful message showing the correct base path
 */
function resolveProjectPath(
  inputPath: string,
  projectId: string,
  projectDir: string
): PathResolutionResult {
  // Case 1: Relative path — simplest case, just resolve against projectDir
  if (!path.isAbsolute(inputPath)) {
    const resolved = path.resolve(projectDir, inputPath)
    if (!resolved.startsWith(projectDir)) {
      return { resolvedPath: '', relativePath: '', error: 'Path traversal detected: path escapes project workspace' }
    }
    return {
      resolvedPath: resolved,
      relativePath: inputPath,
    }
  }

  // Path is absolute. Normalize to forward slashes for consistent matching.
  const normalized = inputPath.replace(/\\/g, '/')

  // Case 2: Absolute path contains "workspace/<projectId>" — extract relative part
  const projectSegment = `workspace/${projectId}`
  const projIdx = normalized.indexOf(projectSegment)
  if (projIdx !== -1) {
    const afterProject = normalized.substring(projIdx + projectSegment.length)
    // afterProject is either "" (project root) or "/sub/path"
    const relativePart = afterProject.startsWith('/') ? afterProject.slice(1) : afterProject
    const resolved = relativePart ? path.resolve(projectDir, relativePart) : projectDir

    if (!resolved.startsWith(projectDir)) {
      return { resolvedPath: '', relativePath: '', error: 'Path traversal detected: path escapes project workspace' }
    }
    return {
      resolvedPath: resolved,
      relativePath: relativePart || '.',
    }
  }

  // Case 3: Last path segment matches projectId — LLM is referencing the project root
  const pathSegments = normalized.split('/').filter(Boolean)
  const lastSegment = pathSegments[pathSegments.length - 1]
  if (lastSegment === projectId) {
    return {
      resolvedPath: projectDir,
      relativePath: '.',
    }
  }

  // Case 4: Absolute path starts with the actual server projectDir
  const normalizedServerProjectDir = projectDir.replace(/\\/g, '/')
  if (normalized.startsWith(normalizedServerProjectDir)) {
    const relativePart = normalized.substring(normalizedServerProjectDir.length)
    const rel = relativePart.startsWith('/') ? relativePart.slice(1) : relativePart
    return {
      resolvedPath: rel ? path.resolve(projectDir, rel) : projectDir,
      relativePath: rel || '.',
    }
  }

  // Case 5: Can't determine relative path — return error with helpful hint
  return {
    resolvedPath: '',
    relativePath: '',
    error: `Absolute path "${inputPath}" cannot be resolved within the project workspace. Use relative paths like "src/app" or "." for the project root. Project directory: ${projectDir}`,
  }
}

// ---------------------------------------------------------------------------
// Built-in tool handlers (always available)
// ---------------------------------------------------------------------------

/**
 * Search the web using z-ai-web-dev-sdk
 */
export async function invokeWebSearch(params: Record<string, unknown>) {
  const query = params.query as string
  const num = (params.num as number) || 5

  if (!query) {
    return { error: 'query parameter is required' }
  }

  try {
    const zai = await createZAIInstance()
    const result = await zai.functions.invoke('web_search', { query, num })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('web_search error:', message)
    return { error: `Web search failed: ${message}` }
  }
}

/**
 * Fetch a web page using z-ai-web-dev-sdk
 */
export async function invokeFetchPage(params: Record<string, unknown>) {
  const url = params.url as string

  if (!url) {
    return { error: 'url parameter is required' }
  }

  try {
    const zai = await createZAIInstance()
    const result = await zai.functions.invoke('page_reader', { url })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('fetch_page error:', message)
    return { error: `Page fetch failed: ${message}` }
  }
}

/**
 * Execute a shell command using child_process
 *
 * FIX: If a projectId is provided, the cwd defaults to the project
 * workspace directory instead of process.cwd().
 */
export async function invokeExecuteCode(params: Record<string, unknown>) {
  const command = params.command as string
  const projectId = params.projectId as string | undefined

  // FIX: Resolve cwd against project workspace when projectId is provided
  let cwd: string
  if (params.cwd) {
    cwd = params.cwd as string
  } else if (projectId) {
    const workspaceRoot = path.resolve(process.cwd(), 'workspace')
    cwd = path.join(workspaceRoot, projectId)
    // Ensure the workspace directory exists
    try {
      await fs.mkdir(cwd, { recursive: true })
    } catch {
      // Directory may already exist
    }
  } else {
    cwd = process.cwd()
  }

  if (!command) {
    return { error: 'command parameter is required' }
  }

  // Block dangerous commands
  const dangerousPatterns = [
    /rm\s+-rf\s+\//,  // rm -rf /
    /:\(\)\{\s*:\|\s*:&\s*\}\s*;/, // fork bomb
    /dd\s+if=/,       // dd can destroy disks
    /mkfs/,            // format filesystem
    /shutdown/,        // shutdown system
    /reboot/,          // reboot system
  ]

  for (const pattern of dangerousPatterns) {
    if (pattern.test(command)) {
      return { error: `Command blocked for safety: contains dangerous pattern` }
    }
  }

  // Determine timeout based on the command type.
  // Package installs and builds can take several minutes.
  const isLongRunningCommand =
    command.includes('npm install') ||
    command.includes('pip install') ||
    command.includes('npm run build') ||
    command.includes('npm run dev') ||
    command.includes('bun install') ||
    command.includes('yarn install') ||
    command.includes('pnpm install') ||
    command.includes('npm test') ||
    command.includes('npx tsc') ||
    command.includes('cargo build') ||
    command.includes('dotnet build')
  const timeout = isLongRunningCommand ? 120000 : 30000 // 2 min for installs/builds, 30s otherwise

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout,
      maxBuffer: 5 * 1024 * 1024, // 5MB buffer (increased for npm install output)
      env: { ...process.env, TERM: 'dumb', CI: 'true', FORCE_COLOR: '0' },
    })

    let result = ''
    if (stdout) {
      result += stdout.length > MAX_OUTPUT_LENGTH
        ? stdout.substring(0, MAX_OUTPUT_LENGTH) + '\n... [output truncated]'
        : stdout
    }
    if (stderr) {
      result += (result ? '\n' : '') + '[stderr] '
      result += stderr.length > MAX_OUTPUT_LENGTH
        ? stderr.substring(0, MAX_OUTPUT_LENGTH) + '\n... [output truncated]'
        : stderr
    }

    return { output: result || '(no output)', exitCode: 0, command }
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string; code?: number; message?: string }
    let output = ''
    if (execError.stdout) output += execError.stdout
    if (execError.stderr) output += (output ? '\n' : '') + execError.stderr
    return {
      output: output || execError.message || 'Command execution failed',
      exitCode: execError.code || 1,
      error: true,
      command,
    }
  }
}

/**
 * Read a file from the filesystem
 */
export async function invokeReadFile(params: Record<string, unknown>) {
  const filePath = params.path as string
  const projectId = params.projectId as string | undefined

  if (!filePath) {
    return { error: 'path parameter is required' }
  }

  // ── Allow reading from the skills/ directory (on-demand skill data) ──────
  // The LLM can read full skill data files (e.g., skills/ui-ux-pro-max/data/colors.csv)
  // This enables the tiered loading: core in prompt, full data on demand.
  const skillsRoot = path.resolve(process.cwd(), 'skills')
  const normalizedFilePath = filePath.replace(/\\/g, '/')
  if (normalizedFilePath.startsWith('skills/') || normalizedFilePath.startsWith('./skills/')) {
    const skillResolvedPath = path.resolve(process.cwd(), normalizedFilePath)
    if (!skillResolvedPath.startsWith(skillsRoot)) {
      return { error: 'Path traversal detected: skill file path escapes skills directory' }
    }
    try {
      const content = await fs.readFile(skillResolvedPath, 'utf-8')
      return {
        path: normalizedFilePath,
        relativePath: normalizedFilePath,
        content: content.length > MAX_OUTPUT_LENGTH
          ? content.substring(0, MAX_OUTPUT_LENGTH) + '\n... [file truncated]'
          : content,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { error: `Failed to read skill file: ${message}` }
    }
  }

  // Resolve relative paths against the project workspace
  let resolvedPath: string
  let relativePath: string = filePath
  if (projectId) {
    const workspaceRoot = path.resolve(process.cwd(), 'workspace')
    const projectDir = path.join(workspaceRoot, projectId)
    const resolution = resolveProjectPath(filePath, projectId, projectDir)
    if (resolution.error) {
      return { error: resolution.error }
    }
    resolvedPath = resolution.resolvedPath
    relativePath = resolution.relativePath
  } else {
    resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath)
    if (resolvedPath.includes('..')) {
      return { error: 'Path traversal is not allowed' }
    }
  }

  try {
    const content = await fs.readFile(resolvedPath, 'utf-8')
    return {
      path: resolvedPath,
      relativePath,
      content: content.length > MAX_OUTPUT_LENGTH
        ? content.substring(0, MAX_OUTPUT_LENGTH) + '\n... [file truncated]'
        : content,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { error: `Failed to read file: ${message}` }
  }
}

/**
 * Write content to a file, creating directories if needed.
 *
 * CRITICAL FIX: Files are written to the project workspace directory,
 * NOT to the CWD (which was causing all files to land in the project
 * root instead of the sandboxed workspace).
 *
 * Resolution order:
 *   1. If a `projectId` param is provided → write to workspace/<projectId>/<filePath>
 *   2. If path is absolute → write as-is (with path traversal check)
 *   3. If path is relative → write to workspace/<activeProjectId>/<filePath>
 *      falling back to CWD if no active project is known
 */
export async function invokeWriteFile(params: Record<string, unknown>) {
  const filePath = params.path as string
  let content = params.content
  const projectId = params.projectId as string | undefined

  // ── PreToolUse: Validate required parameters ──────────────────────────
  if (!filePath) {
    return { error: 'path parameter is required', path: null }
  }
  if (content === undefined || content === null) {
    return { error: 'content parameter is required', path: filePath }
  }

  // ── PreToolUse: Validate path is not empty/whitespace ────────────────
  if (!filePath.trim()) {
    return { error: 'path parameter cannot be empty or whitespace', path: filePath }
  }

  // ── PreToolUse: Block dangerous paths ─────────────────────────────────
  const dangerousPatterns = [
    '/etc/', '/sys/', '/proc/', '/dev/', '/root/',
    '.ssh/', '.env.local', '.env.production',
    'node_modules/', '.git/',
  ]
  const normalizedPath = filePath.replace(/\\/g, '/')
  for (const pattern of dangerousPatterns) {
    if (normalizedPath.includes(pattern) && !normalizedPath.startsWith('src/') && !normalizedPath.startsWith('app/')) {
      return { error: `Path contains restricted segment: ${pattern}`, path: filePath }
    }
  }

  // ── PreToolUse: Validate content size ─────────────────────────────────
  if (typeof content === 'string' && content.length > 5 * 1024 * 1024) {
    return { error: `File content exceeds 5MB limit (${(content.length / 1024 / 1024).toFixed(1)}MB)`, path: filePath }
  }

  // FIX: LLMs sometimes send content as a JSON object instead of a string.
  if (typeof content !== 'string') {
    content = JSON.stringify(content, null, 2)
  }

  // ── Determine the target directory ──────────────────────────────────
  //
  // If we have a projectId (passed from the agent chat route), write
  // to the project workspace. Otherwise fall back to CWD for
  // backward compatibility.
  //
  let resolvedPath: string
  let resolvedRelativePath: string = filePath

  if (projectId) {
    // Write to the project workspace: workspace/<projectId>/<filePath>
    const workspaceRoot = path.resolve(process.cwd(), 'workspace')
    const projectDir = path.join(workspaceRoot, projectId)

    const resolution = resolveProjectPath(filePath, projectId, projectDir)
    if (resolution.error) {
      return { error: resolution.error, path: filePath }
    }
    resolvedPath = resolution.resolvedPath
    resolvedRelativePath = resolution.relativePath
  } else {
    // CRITICAL FIX: No projectId — resolve relative to workspace/default
    const workspaceRoot = path.resolve(process.cwd(), 'workspace')
    const defaultDir = path.join(workspaceRoot, 'default')
    resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(defaultDir, filePath)
  }

  // ===== CONTAINMENT CHECK (closes absolute-path bypass) =====
  const workspaceRootGlobal = path.resolve(process.cwd(), 'workspace')
  const relativeToWorkspace = path.relative(workspaceRootGlobal, resolvedPath)
  if (relativeToWorkspace.startsWith('..') || path.isAbsolute(relativeToWorkspace)) {
    return {
      error: 'Sandbox violation: path escapes workspace directory',
      path: filePath,
      resolvedPath,
      workspaceRoot: workspaceRootGlobal,
    }
  }
  // ===== END CONTAINMENT CHECK =====

  try {
    // Ensure the directory exists
    const dir = path.dirname(resolvedPath)
    await fs.mkdir(dir, { recursive: true })

    await fs.writeFile(resolvedPath, content as string, 'utf-8')
    console.log(`[write_file] SANDBOX: ${resolvedPath} (${(content as string).length} bytes)`)
    return { success: true, path: resolvedPath, bytesWritten: (content as string).length, relativePath: resolvedRelativePath }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    // Issue 7 Fix: Always include the path in error results so the caller
    // can display it instead of falling back to "unknown"
    return { error: `Failed to write file: ${message}`, path: filePath }
  }
}

/**
 * List files and directories at a given path
 *
 * FIX: If a projectId is provided, resolve relative paths against
 * the project workspace instead of process.cwd(). Uses resolveProjectPath
 * to handle the LLM sending absolute paths from the user's machine.
 */
export async function invokeListDirectory(params: Record<string, unknown>) {
  const dirPath = (params.path as string) || '.'
  const projectId = params.projectId as string | undefined

  let resolvedPath: string
  let relativePath: string = dirPath

  if (projectId) {
    // Resolve against project workspace
    const workspaceRoot = path.resolve(process.cwd(), 'workspace')
    const projectDir = path.join(workspaceRoot, projectId)

    const resolution = resolveProjectPath(dirPath, projectId, projectDir)
    if (resolution.error) {
      return { error: resolution.error }
    }
    resolvedPath = resolution.resolvedPath
    relativePath = resolution.relativePath
  } else {
    resolvedPath = path.isAbsolute(dirPath)
      ? dirPath
      : path.resolve(process.cwd(), dirPath)
  }

  try {
    const entries = await fs.readdir(resolvedPath, { withFileTypes: true })
    const result = entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
    }))

    return { path: resolvedPath, relativePath, entries: result }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { error: `Failed to list directory: ${message}` }
  }
}

/**
 * Recursively search for files matching a pattern
 *
 * FIX: If a projectId is provided, search within the project workspace.
 */
export async function invokeSearchFiles(params: Record<string, unknown>) {
  const pattern = params.pattern as string
  const projectId = params.projectId as string | undefined

  if (!pattern) {
    return { error: 'pattern parameter is required' }
  }

  let resolvedDir: string
  if (projectId) {
    const workspaceRoot = path.resolve(process.cwd(), 'workspace')
    const projectDir = path.join(workspaceRoot, projectId)
    // Use resolveProjectPath for the directory parameter to handle absolute paths
    if (params.directory) {
      const resolution = resolveProjectPath(params.directory as string, projectId, projectDir)
      if (resolution.error) {
        return { error: resolution.error }
      }
      resolvedDir = resolution.resolvedPath
    } else {
      resolvedDir = projectDir
    }
  } else if (params.directory) {
    resolvedDir = path.isAbsolute(params.directory as string)
      ? (params.directory as string)
      : path.resolve(process.cwd(), params.directory as string)
  } else {
    resolvedDir = process.cwd()
  }

  try {
    // Use find command for recursive search
    const { stdout } = await execAsync(
      `find "${resolvedDir}" -type f -name "${pattern}" | head -100`,
      { timeout: 10000 }
    )

    const files = stdout.trim().split('\n').filter(Boolean)
    return { pattern, directory: resolvedDir, files, count: files.length }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { error: `File search failed: ${message}` }
  }
}

/**
 * Get git repository status
 */
export async function invokeGitStatus(_params: Record<string, unknown>) {
  try {
    const { stdout } = await execAsync('git status --porcelain', {
      timeout: 10000,
    })

    const lines = stdout.trim().split('\n').filter(Boolean)
    const files = lines.map((line) => ({
      status: line.substring(0, 2).trim(),
      path: line.substring(3),
    }))

    return { files, count: files.length }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { error: `git status failed: ${message}` }
  }
}

/**
 * Stage and commit changes
 */
export async function invokeGitCommit(params: Record<string, unknown>) {
  const message = params.message as string

  if (!message) {
    return { error: 'message parameter is required for commit' }
  }

  // Write the commit message to a temp file to avoid shell injection.
  // Using `git commit -F <file>` is safe because the message never touches
  // the shell — no escaping needed.
  const tmpPath = path.join(os.tmpdir(), `git-commit-msg-${Date.now()}.txt`)

  try {
    await fs.writeFile(tmpPath, message, 'utf-8')
    await execAsync('git add -A', { timeout: 10000 })
    const { stdout } = await execAsync(`git commit -F "${tmpPath}"`, {
      timeout: 10000,
    })
    return { success: true, output: stdout.trim() }
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string; message?: string }
    // "nothing to commit" is not really an error
    if (execError.message?.includes('nothing to commit')) {
      return { success: true, output: 'Nothing to commit, working tree clean' }
    }
    const msg = execError.stderr || execError.message || 'git commit failed'
    return { error: `git commit failed: ${msg}` }
  } finally {
    // Always clean up the temp file
    try {
      await fs.unlink(tmpPath)
    } catch {
      // Intentionally ignored — temp file cleanup is best-effort
    }
  }
}

/**
 * Store a value in the in-memory key-value store
 */
export async function invokeStore(params: Record<string, unknown>) {
  const key = params.key as string
  const value = params.value

  if (!key) {
    return { error: 'key parameter is required' }
  }

  memoryStore.set(key, value)
  return { success: true, key, stored: true }
}

/**
 * Retrieve a value from the in-memory key-value store
 */
export async function invokeRetrieve(params: Record<string, unknown>) {
  const key = params.key as string

  if (!key) {
    return { error: 'key parameter is required' }
  }

  if (!memoryStore.has(key)) {
    return { error: `No value found for key: ${key}`, found: false }
  }

  return { key, value: memoryStore.get(key), found: true }
}

/**
 * Think tool — no-op that returns the input for chain-of-thought reasoning.
 * This allows the agent to "think out loud" and reason step by step.
 */
export async function invokeThink(params: Record<string, unknown>) {
  return {
    thought: params,
    note: 'Think tool invoked — this is a no-op for chain-of-thought reasoning',
  }
}

/**
 * Edit a file using search/replace diff operations.
 * This is the diff-based alternative to write_file that allows
 * targeted edits without rewriting the entire file.
 */
export async function invokeEditFile(params: Record<string, unknown>) {
  const filePath = params.path as string
  const operations = params.operations as DiffOperation[]
  const projectId = params.projectId as string | undefined

  if (!filePath) {
    return { error: 'path parameter is required' }
  }
  if (!operations || !Array.isArray(operations) || operations.length === 0) {
    return { error: 'operations parameter is required and must be a non-empty array of {search, replace} objects' }
  }

  // Validate each operation
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i]
    if (typeof op.search !== 'string' || typeof op.replace !== 'string') {
      return { error: `Operation at index ${i} must have string 'search' and 'replace' fields` }
    }
  }

  // Resolve the file path using the same logic as read/write
  let resolvedFilePath = filePath
  if (projectId) {
    const workspaceRoot = path.resolve(process.cwd(), 'workspace')
    const projectDir = path.join(workspaceRoot, projectId)
    const resolution = resolveProjectPath(filePath, projectId, projectDir)
    if (resolution.error) {
      return { error: resolution.error, path: filePath }
    }
    resolvedFilePath = resolution.resolvedPath
  }

  try {
    const result = await applyDiffToFile(resolvedFilePath, operations)
    return {
      success: result.success,
      path: resolvedFilePath,
      relativePath: filePath,
      operationsApplied: result.operationsApplied,
      operationsTotal: result.operationsTotal,
      conflicts: result.conflicts,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { error: `Failed to edit file: ${message}` }
  }
}

// ---------------------------------------------------------------------------
// Built-in tool handler registry
// ---------------------------------------------------------------------------

/**
 * Map of MCP tool names to their actual implementations.
 * Used by the agent chat API to execute tool calls.
 */
export const mcpToolHandlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
  web_search: invokeWebSearch,
  fetch_page: invokeFetchPage,
  execute_code: invokeExecuteCode,
  read_file: invokeReadFile,
  write_file: invokeWriteFile,
  edit_file: invokeEditFile,
  list_directory: invokeListDirectory,
  search_files: invokeSearchFiles,
  git_status: invokeGitStatus,
  git_commit: invokeGitCommit,
  store: invokeStore,
  retrieve: invokeRetrieve,
  think: invokeThink,
}

// ---------------------------------------------------------------------------
// Dynamic MCP tool discovery from connected servers
// ---------------------------------------------------------------------------

/**
 * Represents a tool discovered from a connected MCP server, with metadata
 * about which server it came from.
 */
export interface DiscoveredMCPTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  serverId: string
  serverName: string
}

/**
 * Get the union of all tools from all connected MCP servers.
 *
 * This function queries both the in-memory MCP client connections AND the
 * database to produce a comprehensive tool list. The tools from the MCP
 * client are dynamically discovered via the real protocol; the DB tools
 * serve as a fallback for servers that aren't currently connected.
 *
 * @returns Array of tool definitions with server provenance
 */
export async function getMCPToolsFromServers(): Promise<DiscoveredMCPTool[]> {
  const tools: DiscoveredMCPTool[] = []

  // First, collect tools from live connections
  const liveTools = mcpClient.getAllTools()
  const seenNames = new Set<string>()

  for (const tool of liveTools) {
    const namespacedName = `${tool.serverName}__${tool.name}`
    seenNames.add(namespacedName)

    tools.push({
      name: tool.name,
      description: tool.description || `Tool from ${tool.serverName}: ${tool.name}`,
      inputSchema: tool.inputSchema || {},
      serverId: tool.serverId,
      serverName: tool.serverName,
    })
  }

  // Then, include tools from the DB for servers that are marked connected
  // but may not yet have live connections (e.g. just started, reconnecting)
  try {
    const servers = await db.mCPServer.findMany({
      where: { enabled: true, connected: true },
    })

    for (const server of servers) {
      // Skip if we already have live tools for this server
      if (liveTools.some((t) => t.serverId === server.id)) continue

      let serverTools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> = []
      try {
        serverTools = JSON.parse(server.tools || '[]')
      } catch {
        serverTools = []
      }

      for (const tool of serverTools) {
        tools.push({
          name: tool.name,
          description: tool.description || `Tool from ${server.name}: ${tool.name}`,
          inputSchema: tool.inputSchema || {},
          serverId: server.id,
          serverName: server.name,
        })
      }
    }
  } catch (error) {
    // DB might not be available (e.g. during testing); that's OK
    console.error('Failed to fetch MCP servers from DB:', error)
  }

  return tools
}

/**
 * Format discovered MCP tools into a system prompt section that tells the
 * agent which tools are available and how to invoke them.
 */
export function formatDiscoveredToolsForPrompt(tools: DiscoveredMCPTool[]): string {
  if (tools.length === 0) return ''

  let section = '\nMCP SERVER TOOLS (available via real MCP protocol):\n'

  for (const tool of tools) {
    const params = tool.inputSchema?.properties as Record<string, Record<string, string>> | undefined
    const paramStr = params
      ? Object.entries(params)
          .map(([key, schema]) => `${key}: ${schema.type || 'any'}`)
          .join(', ')
      : ''

    section += `  - ${tool.name}(${paramStr}) — ${tool.description} [from: ${tool.serverName}]\n`
  }

  section += '\nTo call an MCP server tool, use: [TOOL_CALL] tool_name({"param": "value"})\n'
  return section
}

// ---------------------------------------------------------------------------
// Tool call parsing and execution
// ---------------------------------------------------------------------------

/**
 * Parse a [TOOL_CALL] invocation from the agent's response text.
 * Returns null if the text doesn't contain a valid tool call.
 *
 * Expected format: [TOOL_CALL] tool_name({"param": "value"})
 */
export function parseToolCall(text: string): { toolName: string; params: Record<string, unknown> } | null {
  const match = text.match(/\[TOOL_CALL\]\s+(\w+)\((\{[\s\S]*?\})\)/)
  if (!match) return null

  const toolName = match[1]
  const paramsStr = match[2]

  try {
    const params = JSON.parse(paramsStr) as Record<string, unknown>
    return { toolName, params }
  } catch {
    return { toolName, params: { raw: paramsStr } }
  }
}

/**
 * Parse ALL [TOOL_CALL] invocations from the agent's response text.
 * Returns an array of parsed tool calls (may be empty).
 *
 * Expected format: [TOOL_CALL] tool_name({"param": "value"})
 */
export function parseAllToolCalls(text: string): Array<{ toolName: string; params: Record<string, unknown> }> {
  const results: Array<{ toolName: string; params: Record<string, unknown> }> = []
  const regex = /\[TOOL_CALL\]\s+(\w+)\((\{[\s\S]*?\})\)/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    const toolName = match[1]
    const paramsStr = match[2]

    try {
      const params = JSON.parse(paramsStr) as Record<string, unknown>
      results.push({ toolName, params })
    } catch {
      results.push({ toolName, params: { raw: paramsStr } })
    }
  }

  return results
}

/**
 * Execute a parsed tool call by:
 * 1. Checking if it's a built-in handler (always available)
 * 2. If not, routing it through the MCP protocol to the appropriate server
 */
export async function executeToolCall(
  toolName: string,
  params: Record<string, unknown>,
): Promise<{ success: boolean; result: unknown; source?: string }> {
  // 1. Try built-in handlers first
  const handler = mcpToolHandlers[toolName]
  if (handler) {
    try {
      const result = await handler(params)
      return { success: true, result, source: 'builtin' }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, result: { error: `Tool execution failed: ${message}` }, source: 'builtin' }
    }
  }

  // 2. Try extension custom tools
  if (extensionSystem.isCustomTool(toolName)) {
    const result = await extensionSystem.executeCustomTool(toolName, params)
    return { success: result.success, result: result.result, source: 'custom' }
  }

  // 3. Try routing through MCP protocol to a connected server
  const allTools = mcpClient.getAllTools()
  const mcpTool = allTools.find((t) => t.name === toolName)
  if (mcpTool) {
    try {
      const result = await mcpClient.callTool(mcpTool.serverId, toolName, params)
      return { success: true, result, source: `mcp:${mcpTool.serverName}` }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return {
        success: false,
        result: { error: `MCP tool call failed (${mcpTool.serverName}/${toolName}): ${message}` },
        source: `mcp:${mcpTool.serverName}`,
      }
    }
  }

  return { success: false, result: { error: `Unknown tool: ${toolName}` } }
}

// ---------------------------------------------------------------------------
// Parallel tool execution
// ---------------------------------------------------------------------------

export interface ParallelToolCall {
  id: string
  toolName: string
  params: Record<string, unknown>
}

export interface ParallelToolResult {
  id: string
  toolName: string
  success: boolean
  result: unknown
  source?: string
  latencyMs: number
}

/**
 * Execute multiple tool calls in parallel using Promise.all().
 * Tools that are safe to run concurrently (independent of each other)
 * will be executed simultaneously for significant performance improvement.
 *
 * Safety rules:
 *   - write_file and edit_file on the SAME path are serialized (sequenced)
 *   - All other combinations run in parallel
 *   - Extension hooks (beforeToolCall / afterToolCall) are still invoked
 *   - Each result includes timing information
 */
export async function executeToolCallsParallel(
  toolCalls: ParallelToolCall[],
): Promise<ParallelToolResult[]> {
  if (toolCalls.length === 0) return []

  // Group tool calls by file path to serialize writes to the same file
  const fileWriteGroups = new Map<string, ParallelToolCall[]>()
  const independentCalls: ParallelToolCall[] = []

  for (const tc of toolCalls) {
    const isFileWrite = (tc.toolName === 'write_file' || tc.toolName === 'edit_file')
    const filePath = isFileWrite ? (tc.params.path as string) : null

    if (filePath) {
      const group = fileWriteGroups.get(filePath) || []
      group.push(tc)
      fileWriteGroups.set(filePath, group)
    } else {
      independentCalls.push(tc)
    }
  }

  // Build execution promises
  const promises: Promise<ParallelToolResult>[] = []

  // Independent calls → all parallel
  for (const tc of independentCalls) {
    promises.push(executeSingleToolCall(tc))
  }

  // File-write groups → parallel across groups, sequential within group
  for (const [, group] of fileWriteGroups) {
    if (group.length === 1) {
      promises.push(executeSingleToolCall(group[0]))
    } else {
      // Sequential chain within the same file path
      let chain: Promise<ParallelToolResult> = executeSingleToolCall(group[0])
      for (let i = 1; i < group.length; i++) {
        chain = chain.then(() => executeSingleToolCall(group[i]))
      }
      promises.push(chain)
    }
  }

  return Promise.all(promises)
}

/**
 * Execute a single tool call with timing and event emission.
 */
async function executeSingleToolCall(tc: ParallelToolCall): Promise<ParallelToolResult> {
  const startTime = Date.now()

  agentEventBus.emit('tool:call', {
    toolName: tc.toolName,
    params: tc.params,
    source: 'parallel-executor',
    parallel: true,
  })

  // Execute extension beforeToolCall hook
  const hookContext = await extensionSystem.executeHooks('beforeToolCall', {
    toolName: tc.toolName,
    toolParams: tc.params,
  })

  // Use potentially modified params from hook
  const effectiveParams = hookContext.toolParams as Record<string, unknown> || tc.params

  try {
    const result = await executeToolCall(tc.toolName, effectiveParams)
    const latencyMs = Date.now() - startTime

    agentEventBus.emit('tool:result', {
      toolName: tc.toolName,
      success: result.success,
      latencyMs,
      source: result.source || 'unknown',
    })

    // Execute extension afterToolCall hook
    await extensionSystem.executeHooks('afterToolCall', {
      toolName: tc.toolName,
      toolParams: effectiveParams,
      toolResult: result.result,
    })

    return {
      id: tc.id,
      toolName: tc.toolName,
      success: result.success,
      result: result.result,
      source: result.source,
      latencyMs,
    }
  } catch (error) {
    const latencyMs = Date.now() - startTime
    const errMsg = error instanceof Error ? error.message : 'Unknown error'

    agentEventBus.emit('tool:error', {
      toolName: tc.toolName,
      error: errMsg,
      source: 'parallel-executor',
    })

    return {
      id: tc.id,
      toolName: tc.toolName,
      success: false,
      result: { error: errMsg },
      latencyMs,
    }
  }
}
