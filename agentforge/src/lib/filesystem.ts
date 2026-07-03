import fs from 'fs/promises'
import path from 'path'
import { existsSync } from 'fs'

// Base workspace directory - all project files are stored here
const WORKSPACE_ROOT = path.resolve(process.cwd(), 'workspace')

/**
 * Get the absolute path for a project's workspace directory
 */
function getProjectPath(projectId: string): string {
  return path.join(WORKSPACE_ROOT, projectId)
}

/**
 * Get the absolute path for a file within a project workspace
 */
function getFilePath(projectId: string, filePath: string): string {
  const resolved = path.resolve(getProjectPath(projectId), filePath)
  // Security: ensure the resolved path is still within the project directory
  if (!resolved.startsWith(getProjectPath(projectId))) {
    throw new Error('Path traversal detected: file path escapes project directory')
  }
  return resolved
}

/**
 * Write a file to a project's workspace, creating directories as needed
 */
export async function writeProjectFile(
  projectId: string,
  filePath: string,
  content: string
): Promise<void> {
  const absolutePath = getFilePath(projectId, filePath)
  const dir = path.dirname(absolutePath)

  // Create directories recursively
  await fs.mkdir(dir, { recursive: true })

  // Write the file
  await fs.writeFile(absolutePath, content, 'utf-8')
}

/**
 * Read a file from a project's workspace
 */
export async function readProjectFile(
  projectId: string,
  filePath: string
): Promise<string> {
  const absolutePath = getFilePath(projectId, filePath)

  if (!existsSync(absolutePath)) {
    throw new Error(`File not found: ${filePath}`)
  }

  return fs.readFile(absolutePath, 'utf-8')
}

/**
 * List all files in a project workspace recursively
 * Returns an array of relative file paths
 */
export async function listProjectFiles(projectId: string): Promise<string[]> {
  const projectPath = getProjectPath(projectId)

  if (!existsSync(projectPath)) {
    return []
  }

  const files: string[] = []

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      const relativePath = path.relative(projectPath, fullPath)

      if (entry.isDirectory()) {
        // Skip node_modules and .git directories
        if (entry.name === 'node_modules' || entry.name === '.git') {
          continue
        }
        await walk(fullPath)
      } else if (entry.isFile()) {
        files.push(relativePath)
      }
    }
  }

  await walk(projectPath)
  return files.sort()
}

/**
 * Delete a single file from a project workspace
 */
export async function deleteProjectFile(
  projectId: string,
  filePath: string
): Promise<void> {
  const absolutePath = getFilePath(projectId, filePath)

  if (!existsSync(absolutePath)) {
    throw new Error(`File not found: ${filePath}`)
  }

  await fs.unlink(absolutePath)

  // Try to clean up empty parent directories
  let dir = path.dirname(absolutePath)
  const projectPath = getProjectPath(projectId)

  while (dir !== projectPath && dir.startsWith(projectPath)) {
    try {
      const entries = await fs.readdir(dir)
      if (entries.length === 0) {
        await fs.rmdir(dir)
        dir = path.dirname(dir)
      } else {
        break
      }
    } catch {
      break
    }
  }
}

/**
 * Delete an entire project workspace directory
 */
export async function deleteProjectWorkspace(projectId: string): Promise<void> {
  const projectPath = getProjectPath(projectId)

  if (!existsSync(projectPath)) {
    return // Already gone, no error
  }

  await fs.rm(projectPath, { recursive: true, force: true })
}

/**
 * Check if a file exists in a project workspace
 */
export async function fileExists(
  projectId: string,
  filePath: string
): Promise<boolean> {
  const absolutePath = getFilePath(projectId, filePath)
  return existsSync(absolutePath)
}

/**
 * Tree node structure for the file explorer
 */
export interface FileTreeNode {
  name: string
  path: string
  isFolder: boolean
  children: FileTreeNode[]
  size?: number
  modified?: string
}

/**
 * Get a tree structure of files for the file explorer
 */
export async function getProjectTree(projectId: string): Promise<FileTreeNode[]> {
  const files = await listProjectFiles(projectId)

  if (files.length === 0) {
    return []
  }

  const root: FileTreeNode[] = []

  for (const filePath of files) {
    const parts = filePath.split('/').filter(Boolean)
    let currentLevel = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLast = i === parts.length - 1
      const currentPath = parts.slice(0, i + 1).join('/')

      let existing = currentLevel.find((n) => n.name === part)

      if (!existing) {
        let size: number | undefined
        let modified: string | undefined

        if (isLast) {
          try {
            const absolutePath = getFilePath(projectId, currentPath)
            const stat = await fs.stat(absolutePath)
            size = stat.size
            modified = stat.mtime.toISOString()
          } catch {
            // File may have been deleted between listing and stat
          }
        }

        const node: FileTreeNode = {
          name: part,
          path: currentPath,
          isFolder: !isLast,
          children: [],
          size,
          modified,
        }
        currentLevel.push(node)
        existing = node
      }

      if (!isLast) {
        currentLevel = existing.children
      }
    }
  }

  // Sort: folders first, then alphabetically
  function sortNodes(nodes: FileTreeNode[]): FileTreeNode[] {
    return nodes
      .sort((a, b) => {
        if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      .map((node) => ({
        ...node,
        children: sortNodes(node.children),
      }))
  }

  return sortNodes(root)
}

/**
 * Write multiple files to a project workspace at once
 */
export async function writeProjectFiles(
  projectId: string,
  files: Array<{ path: string; content: string }>
): Promise<{ written: number; errors: Array<{ path: string; error: string }> }> {
  let written = 0
  const errors: Array<{ path: string; error: string }> = []

  for (const file of files) {
    try {
      await writeProjectFile(projectId, file.path, file.content)
      written++
    } catch (err) {
      errors.push({
        path: file.path,
        error: (err as Error).message,
      })
    }
  }

  return { written, errors }
}

/**
 * Get the workspace root path (for terminal cwd resolution)
 */
export function getWorkspaceRoot(): string {
  return WORKSPACE_ROOT
}

/**
 * Get the project workspace path (for terminal cwd)
 */
export function getProjectWorkspacePath(projectId: string): string {
  return getProjectPath(projectId)
}
