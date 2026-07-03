import { NextResponse } from 'next/server'
import {
  writeProjectFile,
  readProjectFile,
  listProjectFiles,
  deleteProjectFile,
  deleteProjectWorkspace,
  getProjectTree,
} from '@/lib/filesystem'
import { existsSync } from 'fs'
import { rename as fsRename } from 'fs/promises'
import path from 'path'

/**
 * Get the workspace root path
 */
function getWorkspaceRoot(): string {
  return path.resolve(process.cwd(), 'workspace')
}

/**
 * GET /api/files?projectId=xxx - List all files in project workspace (as tree)
 * GET /api/files?projectId=xxx&filePath=xxx - Read specific file content
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')
    const filePath = searchParams.get('filePath')

    if (!projectId) {
      return NextResponse.json(
        { error: 'projectId query parameter is required' },
        { status: 400 }
      )
    }

    // If filePath is specified, return the file content
    if (filePath) {
      try {
        const content = await readProjectFile(projectId, filePath)
        return NextResponse.json({
          success: true,
          projectId,
          filePath,
          content,
        })
      } catch (err) {
        const message = (err as Error).message
        if (message.includes('not found')) {
          return NextResponse.json(
            { error: `File not found: ${filePath}` },
            { status: 404 }
          )
        }
        throw err
      }
    }

    // Otherwise, return the file tree
    const tree = await getProjectTree(projectId)
    const files = await listProjectFiles(projectId)

    return NextResponse.json({
      success: true,
      projectId,
      tree,
      files,
      fileCount: files.length,
    })
  } catch (error) {
    console.error('Files API GET error:', error)
    return NextResponse.json(
      { error: 'Failed to read project files', details: (error as Error).message },
      { status: 500 }
    )
  }
}

/**
 * POST /api/files - Write a new file to the project workspace
 * Body: { projectId: string, filePath: string, content: string }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { projectId, filePath, content } = body

    if (!projectId) {
      return NextResponse.json(
        { error: 'projectId is required' },
        { status: 400 }
      )
    }

    if (!filePath) {
      return NextResponse.json(
        { error: 'filePath is required' },
        { status: 400 }
      )
    }

    if (content === undefined || content === null) {
      return NextResponse.json(
        { error: 'content is required' },
        { status: 400 }
      )
    }

    await writeProjectFile(projectId, filePath, String(content))

    return NextResponse.json({
      success: true,
      message: `File written: ${filePath}`,
      projectId,
      filePath,
    }, { status: 201 })
  } catch (error) {
    console.error('Files API POST error:', error)
    return NextResponse.json(
      { error: 'Failed to write file', details: (error as Error).message },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/files - Update an existing file in the project workspace
 * Body: { projectId: string, filePath: string, content: string }
 */
export async function PUT(req: Request) {
  try {
    const body = await req.json()
    const { projectId, filePath, content } = body

    if (!projectId) {
      return NextResponse.json(
        { error: 'projectId is required' },
        { status: 400 }
      )
    }

    if (!filePath) {
      return NextResponse.json(
        { error: 'filePath is required' },
        { status: 400 }
      )
    }

    if (content === undefined || content === null) {
      return NextResponse.json(
        { error: 'content is required' },
        { status: 400 }
      )
    }

    await writeProjectFile(projectId, filePath, String(content))

    return NextResponse.json({
      success: true,
      message: `File updated: ${filePath}`,
      projectId,
      filePath,
    })
  } catch (error) {
    console.error('Files API PUT error:', error)
    return NextResponse.json(
      { error: 'Failed to update file', details: (error as Error).message },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/files - Delete a file or entire workspace
 * Body: { projectId: string, filePath?: string }
 * If filePath is provided, delete just that file. Otherwise delete the entire workspace.
 */
export async function DELETE(req: Request) {
  try {
    const body = await req.json()
    const { projectId, filePath } = body

    if (!projectId) {
      return NextResponse.json(
        { error: 'projectId is required' },
        { status: 400 }
      )
    }

    if (filePath) {
      // Delete a specific file
      try {
        await deleteProjectFile(projectId, filePath)
        return NextResponse.json({
          success: true,
          message: `File deleted: ${filePath}`,
          projectId,
          filePath,
        })
      } catch (err) {
        const message = (err as Error).message
        if (message.includes('not found')) {
          return NextResponse.json(
            { error: `File not found: ${filePath}` },
            { status: 404 }
          )
        }
        throw err
      }
    } else {
      // Delete the entire project workspace
      await deleteProjectWorkspace(projectId)
      return NextResponse.json({
        success: true,
        message: `Workspace deleted for project: ${projectId}`,
        projectId,
      })
    }
  } catch (error) {
    console.error('Files API DELETE error:', error)
    return NextResponse.json(
      { error: 'Failed to delete', details: (error as Error).message },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/files - Rename a file in the project workspace
 * Body: { projectId: string, oldPath: string, newPath: string }
 */
export async function PATCH(req: Request) {
  try {
    const body = await req.json()
    const { projectId, oldPath, newPath } = body

    if (!projectId) {
      return NextResponse.json(
        { error: 'projectId is required' },
        { status: 400 }
      )
    }

    if (!oldPath || !newPath) {
      return NextResponse.json(
        { error: 'oldPath and newPath are required' },
        { status: 400 }
      )
    }

    // Resolve the absolute paths
    const projectDir = path.join(getWorkspaceRoot(), projectId)
    const oldAbsolutePath = path.resolve(projectDir, oldPath)
    const newAbsolutePath = path.resolve(projectDir, newPath)

    // Security: ensure paths stay within the project directory
    if (!oldAbsolutePath.startsWith(projectDir) || !newAbsolutePath.startsWith(projectDir)) {
      return NextResponse.json(
        { error: 'Path traversal detected' },
        { status: 403 }
      )
    }

    // Check old file exists
    if (!existsSync(oldAbsolutePath)) {
      return NextResponse.json(
        { error: `File not found: ${oldPath}` },
        { status: 404 }
      )
    }

    // Check new path doesn't already exist
    if (existsSync(newAbsolutePath)) {
      return NextResponse.json(
        { error: `A file already exists at: ${newPath}` },
        { status: 409 }
      )
    }

    // Ensure the target directory exists
    const newDir = path.dirname(newAbsolutePath)
    if (!existsSync(newDir)) {
      const { mkdir } = await import('fs/promises')
      await mkdir(newDir, { recursive: true })
    }

    // Rename the file
    await fsRename(oldAbsolutePath, newAbsolutePath)

    return NextResponse.json({
      success: true,
      message: `File renamed: ${oldPath} → ${newPath}`,
      projectId,
      oldPath,
      newPath,
    })
  } catch (error) {
    console.error('Files API PATCH error:', error)
    return NextResponse.json(
      { error: 'Failed to rename file', details: (error as Error).message },
      { status: 500 }
    )
  }
}
