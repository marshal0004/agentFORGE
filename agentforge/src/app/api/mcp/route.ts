import { db } from '@/lib/db'
import { mcpClient } from '@/lib/mcp-client'
import { NextResponse } from 'next/server'

// ---------------------------------------------------------------------------
// Default MCP server seed data
// ---------------------------------------------------------------------------
// These are real MCP server packages with realistic command/args. Tool lists
// start empty — they are discovered dynamically when the server is connected.
// Servers that require API keys (GitHub, Slack) are disabled by default.

const defaultMCPServers = [
  {
    name: 'Filesystem',
    description: 'Read, write, and manage files on the local filesystem',
    command: 'npx',
    args: JSON.stringify(['-y', '@modelcontextprotocol/server-filesystem', '/workspace']),
    env: JSON.stringify({}),
    category: 'core',
    enabled: true,
    connected: false,
    tools: JSON.stringify([]),
  },
  {
    name: 'Web Search',
    description: 'Search the web for current information and retrieve web pages',
    command: 'npx',
    args: JSON.stringify(['-y', '@modelcontextprotocol/server-web-search']),
    env: JSON.stringify({}),
    category: 'core',
    enabled: true,
    connected: false,
    tools: JSON.stringify([]),
  },
  {
    name: 'Code Execution',
    description: 'Execute code in sandboxed environments with support for multiple languages',
    command: 'npx',
    args: JSON.stringify(['-y', '@modelcontextprotocol/server-code-exec']),
    env: JSON.stringify({}),
    category: 'core',
    enabled: true,
    connected: false,
    tools: JSON.stringify([]),
  },
  {
    name: 'Database',
    description: 'Connect to and query databases with schema introspection',
    command: 'npx',
    args: JSON.stringify(['-y', '@modelcontextprotocol/server-db']),
    env: JSON.stringify({}),
    category: 'data',
    enabled: true,
    connected: false,
    tools: JSON.stringify([]),
  },
  {
    name: 'Git',
    description: 'Version control operations including commit, branch, diff, and history',
    command: 'npx',
    args: JSON.stringify(['-y', '@modelcontextprotocol/server-git']),
    env: JSON.stringify({}),
    category: 'development',
    enabled: true,
    connected: false,
    tools: JSON.stringify([]),
  },
  {
    name: 'Docker',
    description: 'Manage Docker containers and images for deployment and sandboxing',
    command: 'npx',
    args: JSON.stringify(['-y', '@modelcontextprotocol/server-docker']),
    env: JSON.stringify({}),
    category: 'infrastructure',
    enabled: false,
    connected: false,
    tools: JSON.stringify([]),
  },
  {
    name: 'Slack',
    description: 'Send messages and read channels from Slack workspaces',
    command: 'npx',
    args: JSON.stringify(['-y', '@modelcontextprotocol/server-slack']),
    env: JSON.stringify({ SLACK_BOT_TOKEN: '' }),
    category: 'integrations',
    enabled: false,
    connected: false,
    tools: JSON.stringify([]),
  },
  {
    name: 'GitHub',
    description: 'Interact with GitHub repositories, issues, and pull requests',
    command: 'npx',
    args: JSON.stringify(['-y', '@modelcontextprotocol/server-github']),
    env: JSON.stringify({ GITHUB_PERSONAL_ACCESS_TOKEN: '' }),
    category: 'integrations',
    enabled: false,
    connected: false,
    tools: JSON.stringify([]),
  },
  {
    name: 'Memory',
    description: 'Persistent key-value memory store for agent context and session data',
    command: 'npx',
    args: JSON.stringify(['-y', '@modelcontextprotocol/server-memory']),
    env: JSON.stringify({}),
    category: 'core',
    enabled: true,
    connected: false,
    tools: JSON.stringify([]),
  },
  {
    name: 'Sequential Thinking',
    description: 'Advanced step-by-step reasoning and planning for complex tasks',
    command: 'npx',
    args: JSON.stringify(['-y', '@modelcontextprotocol/server-sequential-thinking']),
    env: JSON.stringify({}),
    category: 'ai',
    enabled: true,
    connected: false,
    tools: JSON.stringify([]),
  },
]

async function seedDefaultMCPServers() {
  const existing = await db.mCPServer.count()
  if (existing === 0) {
    await db.mCPServer.createMany({ data: defaultMCPServers })
  }
}

// ---------------------------------------------------------------------------
// GET /api/mcp — Return all MCP servers with live connection status
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    await seedDefaultMCPServers()
    const servers = await db.mCPServer.findMany({ orderBy: { createdAt: 'asc' } })

    // Enrich each server with live connection data from the MCP client
    const enriched = servers.map((server) => {
      const conn = mcpClient.getConnection(server.id)
      if (conn) {
        return {
          ...server,
          connected: conn.status === 'connected',
          // Merge dynamically discovered tools with what's in the DB
          tools: conn.tools.length > 0
            ? JSON.stringify(conn.tools)
            : server.tools,
          _connectionStatus: conn.status,
          _serverInfo: conn.serverInfo,
          _error: conn.error,
        }
      }
      return server
    })

    return NextResponse.json({ servers: enriched })
  } catch (error) {
    console.error('Failed to fetch MCP servers:', error)
    return NextResponse.json(
      { error: 'Failed to fetch MCP servers' },
      { status: 500 },
    )
  }
}

// ---------------------------------------------------------------------------
// POST /api/mcp — Add a new MCP server
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { name, description, command, args, env, category } = body

    if (!name || !description || !command) {
      return NextResponse.json(
        { error: 'Name, description, and command are required' },
        { status: 400 },
      )
    }

    // Check for duplicate name
    const existing = await db.mCPServer.findFirst({ where: { name } })
    if (existing) {
      return NextResponse.json(
        { error: `MCP server with name "${name}" already exists` },
        { status: 409 },
      )
    }

    const server = await db.mCPServer.create({
      data: {
        name,
        description,
        command,
        args: typeof args === 'string' ? args : JSON.stringify(args || []),
        env: typeof env === 'string' ? env : JSON.stringify(env || {}),
        category: category || 'general',
        enabled: body.enabled ?? true,
        connected: false,
        tools: JSON.stringify([]),
      },
    })

    return NextResponse.json({ server }, { status: 201 })
  } catch (error) {
    console.error('Failed to create MCP server:', error)
    return NextResponse.json(
      { error: 'Failed to create MCP server' },
      { status: 500 },
    )
  }
}

// ---------------------------------------------------------------------------
// PUT /api/mcp — Update an MCP server (connect/disconnect/toggle/edit)
// ---------------------------------------------------------------------------

export async function PUT(req: Request) {
  try {
    const body = await req.json()
    const { id, ...updates } = body

    if (!id) {
      return NextResponse.json(
        { error: 'MCP server ID is required' },
        { status: 400 },
      )
    }

    const existing = await db.mCPServer.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json(
        { error: 'MCP server not found' },
        { status: 404 },
      )
    }

    const data: Record<string, unknown> = {}

    if (updates.action === 'toggle') {
      // Toggle enabled/disabled
      data.enabled = !existing.enabled
      // If disabling, also disconnect
      if (existing.enabled) {
        data.connected = false
        await mcpClient.disconnect(id)
      }
    } else if (updates.action === 'connect') {
      // ---------------------------------------------------------------
      // REAL CONNECT: spawn the MCP server process and handshake
      // ---------------------------------------------------------------
      const parsedArgs = typeof existing.args === 'string'
        ? JSON.parse(existing.args)
        : (existing.args as string[] || [])
      const parsedEnv = typeof existing.env === 'string'
        ? JSON.parse(existing.env)
        : (existing.env as Record<string, string> || {})

      const conn = await mcpClient.connect({
        id: existing.id,
        name: existing.name,
        command: existing.command,
        args: parsedArgs,
        env: parsedEnv,
      })

      if (conn.status === 'connected') {
        data.connected = true
        data.enabled = true
        // Persist the dynamically discovered tools back to the DB
        if (conn.tools.length > 0) {
          data.tools = JSON.stringify(conn.tools)
        }
      } else {
        // Connection failed — report the error
        data.connected = false
        return NextResponse.json({
          server: await db.mCPServer.update({ where: { id }, data: { connected: false } }),
          error: conn.error || 'Failed to connect to MCP server',
        }, { status: 502 })
      }
    } else if (updates.action === 'disconnect') {
      // ---------------------------------------------------------------
      // REAL DISCONNECT: kill the MCP server process
      // ---------------------------------------------------------------
      await mcpClient.disconnect(id)
      data.connected = false
    } else if (updates.action === 'refresh') {
      // Re-discover tools on a connected server
      try {
        const tools = await mcpClient.refreshTools(id)
        data.tools = JSON.stringify(tools)
      } catch (err) {
        return NextResponse.json({
          error: err instanceof Error ? err.message : 'Failed to refresh tools',
        }, { status: 500 })
      }
    } else {
      // General field update
      if (updates.name !== undefined) data.name = updates.name
      if (updates.description !== undefined) data.description = updates.description
      if (updates.command !== undefined) data.command = updates.command
      if (updates.args !== undefined) {
        data.args = typeof updates.args === 'string' ? updates.args : JSON.stringify(updates.args)
      }
      if (updates.env !== undefined) {
        data.env = typeof updates.env === 'string' ? updates.env : JSON.stringify(updates.env)
      }
      if (updates.category !== undefined) data.category = updates.category
      if (updates.enabled !== undefined) data.enabled = updates.enabled
      if (updates.connected !== undefined) data.connected = updates.connected
      if (updates.tools !== undefined) {
        data.tools = typeof updates.tools === 'string' ? updates.tools : JSON.stringify(updates.tools)
      }

      // If the command/args/env changed and the server is connected, restart it
      const configChanged = updates.command || updates.args || updates.env
      if (configChanged && existing.connected) {
        await mcpClient.disconnect(id)
        data.connected = false
        data.tools = JSON.stringify([])
      }
    }

    const server = await db.mCPServer.update({
      where: { id },
      data,
    })

    return NextResponse.json({ server })
  } catch (error) {
    console.error('Failed to update MCP server:', error)
    return NextResponse.json(
      { error: 'Failed to update MCP server' },
      { status: 500 },
    )
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/mcp — Remove an MCP server
// ---------------------------------------------------------------------------

export async function DELETE(req: Request) {
  try {
    const body = await req.json()
    const { id } = body

    if (!id) {
      return NextResponse.json(
        { error: 'MCP server ID is required' },
        { status: 400 },
      )
    }

    const existing = await db.mCPServer.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json(
        { error: 'MCP server not found' },
        { status: 404 },
      )
    }

    // Disconnect first if connected
    await mcpClient.disconnect(id)

    await db.mCPServer.delete({ where: { id } })

    return NextResponse.json({ success: true, message: `MCP server "${existing.name}" deleted` })
  } catch (error) {
    console.error('Failed to delete MCP server:', error)
    return NextResponse.json(
      { error: 'Failed to delete MCP server' },
      { status: 500 },
    )
  }
}
