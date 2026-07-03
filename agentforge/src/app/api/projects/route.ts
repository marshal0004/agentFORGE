import { db } from '@/lib/db'
import { NextResponse } from 'next/server'

// GET /api/projects - List all projects
export async function GET() {
  try {
    const projects = await db.project.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: {
          select: { messages: true },
        },
      },
    })

    const formattedProjects = projects.map((project) => ({
      ...project,
      messageCount: project._count.messages,
      _count: undefined,
    }))

    return NextResponse.json({ projects: formattedProjects })
  } catch (error) {
    console.error('Failed to fetch projects:', error)
    return NextResponse.json(
      { error: 'Failed to fetch projects' },
      { status: 500 }
    )
  }
}

// POST /api/projects - Create a new project
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { name, description, prompt } = body

    if (!name) {
      return NextResponse.json(
        { error: 'Project name is required' },
        { status: 400 }
      )
    }

    const project = await db.project.create({
      data: {
        name,
        description: description || '',
        prompt: prompt || '',
        status: 'draft',
        files: '[]',
      },
    })

    return NextResponse.json({ project }, { status: 201 })
  } catch (error) {
    console.error('Failed to create project:', error)
    return NextResponse.json(
      { error: 'Failed to create project' },
      { status: 500 }
    )
  }
}

// PUT /api/projects - Update a project
export async function PUT(req: Request) {
  try {
    const body = await req.json()
    const { id, ...updates } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      )
    }

    const existing = await db.project.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      )
    }

    const data: Record<string, unknown> = {}

    if (updates.name !== undefined) data.name = updates.name
    if (updates.description !== undefined) data.description = updates.description
    if (updates.prompt !== undefined) data.prompt = updates.prompt
    if (updates.status !== undefined) data.status = updates.status
    if (updates.files !== undefined) {
      data.files = typeof updates.files === 'string'
        ? updates.files
        : JSON.stringify(updates.files)
    }

    const project = await db.project.update({
      where: { id },
      data,
    })

    return NextResponse.json({ project })
  } catch (error) {
    console.error('Failed to update project:', error)
    return NextResponse.json(
      { error: 'Failed to update project' },
      { status: 500 }
    )
  }
}

// DELETE /api/projects - Delete a project
export async function DELETE(req: Request) {
  try {
    const body = await req.json()
    const { id } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      )
    }

    const existing = await db.project.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      )
    }

    // Delete associated messages first (cascade should handle this, but be explicit)
    await db.message.deleteMany({ where: { projectId: id } })
    await db.project.delete({ where: { id } })

    return NextResponse.json({ success: true, message: `Project "${existing.name}" deleted` })
  } catch (error) {
    console.error('Failed to delete project:', error)
    return NextResponse.json(
      { error: 'Failed to delete project' },
      { status: 500 }
    )
  }
}
