/**
 * MCP Client — Real Model Context Protocol client implementation
 *
 * Spawns MCP server processes via stdio transport, handles the JSON-RPC 2.0
 * protocol (initialize, tools/list, tools/call), discovers available tools
 * dynamically, and manages server lifecycle.
 *
 * This replaces the cosmetic "flip a boolean" approach with actual process
 * management and protocol communication.
 */

import { spawn, ChildProcess, SpawnOptions } from 'child_process'
import { EventEmitter } from 'events'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MCPToolSchema {
  name: string
  description?: string
  inputSchema: {
    type: 'object'
    properties?: Record<string, unknown>
    required?: string[]
  }
}

export interface MCPServerConfig {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
}

export interface MCPConnection {
  serverId: string
  process: ChildProcess | null
  status: 'starting' | 'connected' | 'disconnected' | 'error'
  tools: MCPToolSchema[]
  serverInfo?: {
    name: string
    version: string
    protocolVersion?: string
  }
  error?: string
  /** Incrementing request ID counter for this connection */
  _nextId: number
  /** Pending JSON-RPC requests awaiting responses, keyed by id */
  _pending: Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>
  /** Accumulated stdout buffer for line-based parsing */
  _buffer: string
  /** Whether the initialize handshake has completed */
  _initialized: boolean
}

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 helpers
// ---------------------------------------------------------------------------

interface JSONRPCRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: Record<string, unknown>
}

interface JSONRPCResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

interface JSONRPCNotification {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
}

function isJSONRPCResponse(obj: unknown): obj is JSONRPCResponse {
  if (typeof obj !== 'object' || obj === null) return false
  const o = obj as Record<string, unknown>
  return o.jsonrpc === '2.0' && typeof o.id === 'number'
}

function isJSONRPCNotification(obj: unknown): obj is JSONRPCNotification {
  if (typeof obj !== 'object' || obj === null) return false
  const o = obj as Record<string, unknown>
  return o.jsonrpc === '2.0' && 'method' in o && !('id' in o)
}

// ---------------------------------------------------------------------------
// MCPClient
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000
const INIT_TIMEOUT_MS = 60_000
const MAX_BUFFER_SIZE = 10 * 1024 * 1024 // 10 MB

/**
 * Singleton MCP client that manages all active MCP server connections.
 * Each server gets its own child process, and communication happens via
 * stdin/stdout using the MCP JSON-RPC 2.0 protocol over stdio transport.
 */
class MCPClient extends EventEmitter {
  private connections: Map<string, MCPConnection> = new Map()

  constructor() {
    super()
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Connect to an MCP server by spawning its process and performing the
   * initialization handshake.  After successful init the tool list is
   * automatically discovered via `tools/list`.
   */
  async connect(config: MCPServerConfig): Promise<MCPConnection> {
    // If already connected to this server, disconnect first
    if (this.connections.has(config.id)) {
      await this.disconnect(config.id)
    }

    const conn: MCPConnection = {
      serverId: config.id,
      process: null,
      status: 'starting',
      tools: [],
      _nextId: 1,
      _pending: new Map(),
      _buffer: '',
      _initialized: false,
    }

    this.connections.set(config.id, conn)

    try {
      // Merge the server's env vars into process.env
      const mergedEnv: NodeJS.ProcessEnv = {
        ...process.env,
        ...config.env,
      }

      // Spawn the MCP server process
      const spawnOptions: SpawnOptions = {
        env: mergedEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
      }

      const child = spawn(config.command, config.args, spawnOptions)

      conn.process = child

      // Handle process errors
      child.on('error', (err) => {
        console.error(`[MCP] Process error for ${config.name}:`, err.message)
        conn.status = 'error'
        conn.error = err.message
        this.rejectAllPending(conn, new Error(`Process error: ${err.message}`))
        this.emit('connection-error', { serverId: config.id, error: err.message })
      })

      // Handle process exit
      child.on('exit', (code, signal) => {
        const msg = `Process exited with code ${code}, signal ${signal}`
        console.error(`[MCP] ${config.name}: ${msg}`)
        if (conn.status !== 'disconnected') {
          conn.status = 'error'
          conn.error = msg
        }
        conn.process = null
        this.rejectAllPending(conn, new Error(msg))
        this.emit('connection-lost', { serverId: config.id, code, signal })
      })

      // Read stdout line-by-line for JSON-RPC messages
      child.stdout?.on('data', (chunk: Buffer) => {
        this.handleStdout(conn, chunk)
      })

      // Capture stderr for logging
      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        // Only log first 500 chars to avoid flooding
        console.error(`[MCP stderr:${config.name}]`, text.substring(0, 500))
      })

      // Perform the MCP initialize handshake
      await this.initialize(conn)

      // Discover tools
      await this.discoverTools(conn)

      conn.status = 'connected'
      conn.error = undefined
      this.emit('connected', { serverId: config.id, toolCount: conn.tools.length })

      return conn
    } catch (err) {
      conn.status = 'error'
      conn.error = err instanceof Error ? err.message : String(err)
      this.emit('connection-error', { serverId: config.id, error: conn.error })
      // Clean up the process if we failed during init
      if (conn.process && !conn.process.killed) {
        try { conn.process.kill('SIGKILL') } catch { /* ignore */ }
        conn.process = null
      }
      return conn
    }
  }

  /**
   * Disconnect from an MCP server, killing its process and cleaning up.
   */
  async disconnect(serverId: string): Promise<void> {
    const conn = this.connections.get(serverId)
    if (!conn) return

    conn.status = 'disconnected'
    this.rejectAllPending(conn, new Error('Disconnected'))

    if (conn.process && !conn.process.killed) {
      try {
        // Try graceful shutdown first
        conn.process.stdin?.end()
        // Give it a moment, then force kill
        setTimeout(() => {
          if (conn.process && !conn.process.killed) {
            try { conn.process.kill('SIGKILL') } catch { /* ignore */ }
          }
        }, 3000)
        conn.process.kill('SIGTERM')
      } catch {
        try { conn.process.kill('SIGKILL') } catch { /* ignore */ }
      }
      conn.process = null
    }

    this.connections.delete(serverId)
    this.emit('disconnected', { serverId })
  }

  /**
   * Call a tool on a connected MCP server.
   */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown> = {},
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<unknown> {
    const conn = this.connections.get(serverId)
    if (!conn || conn.status !== 'connected' || !conn.process) {
      throw new Error(`MCP server ${serverId} is not connected`)
    }

    const response = await this.sendRequest(conn, 'tools/call', {
      name: toolName,
      arguments: args,
    }, timeoutMs)

    return response
  }

  /**
   * Re-discover tools on a connected server (e.g. after a reconnect).
   */
  async refreshTools(serverId: string): Promise<MCPToolSchema[]> {
    const conn = this.connections.get(serverId)
    if (!conn || conn.status !== 'connected') {
      throw new Error(`MCP server ${serverId} is not connected`)
    }
    await this.discoverTools(conn)
    return conn.tools
  }

  /**
   * Get the current connection state for a server.
   */
  getConnection(serverId: string): MCPConnection | undefined {
    return this.connections.get(serverId)
  }

  /**
   * Get all active connections.
   */
  getAllConnections(): MCPConnection[] {
    return Array.from(this.connections.values())
  }

  /**
   * Get the union of all tools from all connected MCP servers.
   * Each tool is namespaced with the server name to avoid collisions.
   */
  getAllTools(): Array<MCPToolSchema & { serverId: string; serverName: string }> {
    const result: Array<MCPToolSchema & { serverId: string; serverName: string }> = []
    for (const conn of this.connections.values()) {
      if (conn.status === 'connected') {
        for (const tool of conn.tools) {
          result.push({
            ...tool,
            serverId: conn.serverId,
            serverName: conn.serverInfo?.name ?? conn.serverId,
          })
        }
      }
    }
    return result
  }

  /**
   * Disconnect from all servers. Useful for graceful shutdown.
   */
  async disconnectAll(): Promise<void> {
    const ids = Array.from(this.connections.keys())
    await Promise.all(ids.map((id) => this.disconnect(id)))
  }

  // -----------------------------------------------------------------------
  // Private: Protocol handling
  // -----------------------------------------------------------------------

  /**
   * Perform the MCP `initialize` handshake.
   */
  private async initialize(conn: MCPConnection): Promise<void> {
    const result = await this.sendRequest(conn, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'agentforge',
        version: '0.2.0',
      },
    }, INIT_TIMEOUT_MS) as Record<string, unknown> | null

    if (result && typeof result === 'object') {
      const serverInfo = result.serverInfo as { name: string; version: string } | undefined
      if (serverInfo) {
        conn.serverInfo = {
          name: serverInfo.name,
          version: serverInfo.version,
          protocolVersion: result.protocolVersion as string | undefined,
        }
      }
    }

    // Send the `initialized` notification as required by the protocol
    this.sendNotification(conn, 'notifications/initialized', {})

    conn._initialized = true
  }

  /**
   * Discover tools via `tools/list`.
   */
  private async discoverTools(conn: MCPConnection): Promise<void> {
    try {
      const result = await this.sendRequest(conn, 'tools/list', {}, DEFAULT_TIMEOUT_MS) as Record<string, unknown> | null

      if (result && Array.isArray(result.tools)) {
        conn.tools = result.tools as MCPToolSchema[]
      } else {
        conn.tools = []
      }
    } catch (err) {
      console.error(`[MCP] tools/list failed for ${conn.serverId}:`, err instanceof Error ? err.message : err)
      // Don't fail the entire connection if tools/list fails
      conn.tools = []
    }
  }

  /**
   * Send a JSON-RPC request and wait for the response.
   */
  private sendRequest(
    conn: MCPConnection,
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!conn.process || conn.process.killed) {
        reject(new Error(`Process not running for server ${conn.serverId}`))
        return
      }

      const id = conn._nextId++
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      }

      const timer = setTimeout(() => {
        conn._pending.delete(id)
        reject(new Error(`Request timeout: ${method} (id=${id})`))
      }, timeoutMs)

      conn._pending.set(id, { resolve, reject, timer })

      const message = JSON.stringify(request) + '\n'
      try {
        conn.process.stdin?.write(message)
      } catch (err) {
        clearTimeout(timer)
        conn._pending.delete(id)
        reject(new Error(`Failed to write to stdin: ${err instanceof Error ? err.message : String(err)}`))
      }
    })
  }

  /**
   * Send a JSON-RPC notification (no response expected).
   */
  private sendNotification(
    conn: MCPConnection,
    method: string,
    params: Record<string, unknown>,
  ): void {
    if (!conn.process || conn.process.killed) return

    const notification: JSONRPCNotification = {
      jsonrpc: '2.0',
      method,
      params,
    }

    const message = JSON.stringify(notification) + '\n'
    try {
      conn.process.stdin?.write(message)
    } catch (err) {
      console.error(`[MCP] Failed to send notification ${method}:`, err)
    }
  }

  /**
   * Handle incoming stdout data from an MCP server process.
   * The MCP stdio transport uses newline-delimited JSON.
   */
  private handleStdout(conn: MCPConnection, chunk: Buffer): void {
    conn._buffer += chunk.toString()

    // Guard against unbounded buffer growth
    if (conn._buffer.length > MAX_BUFFER_SIZE) {
      console.error(`[MCP] Buffer overflow for ${conn.serverId}, truncating`)
      conn._buffer = conn._buffer.slice(-1024 * 1024) // keep last 1 MB
    }

    // Process complete lines (each line is a JSON-RPC message)
    let newlineIdx: number
    while ((newlineIdx = conn._buffer.indexOf('\n')) !== -1) {
      const line = conn._buffer.substring(0, newlineIdx).trim()
      conn._buffer = conn._buffer.substring(newlineIdx + 1)

      if (!line) continue

      try {
        const message = JSON.parse(line)
        this.handleMessage(conn, message)
      } catch (err) {
        // Not valid JSON — could be a log line from the server; ignore it
        if (line.length < 500) {
          console.warn(`[MCP] Non-JSON stdout from ${conn.serverId}: ${line.substring(0, 200)}`)
        }
      }
    }
  }

  /**
   * Route a parsed JSON-RPC message to the appropriate handler.
   */
  private handleMessage(conn: MCPConnection, message: unknown): void {
    if (isJSONRPCResponse(message)) {
      const pending = conn._pending.get(message.id)
      if (pending) {
        clearTimeout(pending.timer)
        conn._pending.delete(message.id)

        if (message.error) {
          pending.reject(new Error(`MCP error ${message.error.code}: ${message.error.message}`))
        } else {
          pending.resolve(message.result)
        }
      }
    } else if (isJSONRPCNotification(message)) {
      // Handle server-initiated notifications (e.g. tool list changed)
      this.handleNotification(conn, message)
    } else {
      // Could be a response without an id we recognize, or invalid message
      console.warn(`[MCP] Unhandled message from ${conn.serverId}:`, JSON.stringify(message).substring(0, 200))
    }
  }

  /**
   * Handle server-initiated notifications.
   */
  private handleNotification(conn: MCPConnection, notification: JSONRPCNotification): void {
    switch (notification.method) {
      case 'notifications/tools/list_changed':
        // The server is telling us its tool list has changed; refresh
        console.log(`[MCP] Tool list changed for ${conn.serverId}, refreshing`)
        this.refreshTools(conn.serverId).catch((err) => {
          console.error(`[MCP] Failed to refresh tools for ${conn.serverId}:`, err)
        })
        break
      case 'notifications/message':
      case 'notifications/progress':
        // Forward these as events for consumers
        this.emit('notification', { serverId: conn.serverId, method: notification.method, params: notification.params })
        break
      default:
        // Silently ignore unknown notifications
        break
    }
  }

  /**
   * Reject all pending requests for a connection (e.g. on disconnect/error).
   */
  private rejectAllPending(conn: MCPConnection, err: Error): void {
    for (const [id, pending] of conn._pending) {
      clearTimeout(pending.timer)
      pending.reject(err)
    }
    conn._pending.clear()
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

/**
 * Global MCP client instance.  All interaction with MCP server processes
 * should go through this singleton.
 */
export const mcpClient = new MCPClient()

// Graceful shutdown — kill all child processes when the Node process exits
if (typeof process !== 'undefined') {
  const cleanup = async () => {
    try {
      await mcpClient.disconnectAll()
    } catch {
      // ignore
    }
  }

  process.on('SIGTERM', cleanup)
  process.on('SIGINT', cleanup)
  process.on('exit', () => {
    // Synchronous cleanup on exit
    for (const conn of mcpClient.getAllConnections()) {
      if (conn.process && !conn.process.killed) {
        try { conn.process.kill('SIGKILL') } catch { /* ignore */ }
      }
    }
  })
}
