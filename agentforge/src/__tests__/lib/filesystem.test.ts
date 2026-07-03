import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import { existsSync } from 'fs'
import {
  writeProjectFile,
  readProjectFile,
  listProjectFiles,
  deleteProjectFile,
  deleteProjectWorkspace,
  fileExists,
  getProjectTree,
  writeProjectFiles,
  getWorkspaceRoot,
  getProjectWorkspacePath,
} from '@/lib/filesystem'

// Use a unique test project ID to avoid collisions
const TEST_PROJECT_ID = `__test_fs_${Date.now()}`
const WORKSPACE_ROOT = getWorkspaceRoot()

// Helper to get the test project path
function getTestProjectPath() {
  return getProjectWorkspacePath(TEST_PROJECT_ID)
}

describe('filesystem', () => {
  beforeEach(async () => {
    // Ensure the test project directory exists and is clean
    const projectPath = getTestProjectPath()
    if (existsSync(projectPath)) {
      await fs.rm(projectPath, { recursive: true, force: true })
    }
    await fs.mkdir(projectPath, { recursive: true })
  })

  afterEach(async () => {
    // Clean up the test project directory
    const projectPath = getTestProjectPath()
    if (existsSync(projectPath)) {
      await fs.rm(projectPath, { recursive: true, force: true })
    }
  })

  describe('getWorkspaceRoot / getProjectWorkspacePath', () => {
    it('should return a workspace root path', () => {
      expect(getWorkspaceRoot()).toContain('workspace')
    })

    it('should return a project path under workspace root', () => {
      const projectPath = getProjectWorkspacePath('proj-1')
      expect(projectPath).toBe(path.join(WORKSPACE_ROOT, 'proj-1'))
    })
  })

  describe('writeProjectFile', () => {
    it('should create a file with correct content', async () => {
      await writeProjectFile(TEST_PROJECT_ID, 'hello.txt', 'Hello World')
      const content = await readProjectFile(TEST_PROJECT_ID, 'hello.txt')
      expect(content).toBe('Hello World')
    })

    it('should create nested directories', async () => {
      await writeProjectFile(TEST_PROJECT_ID, 'src/components/App.tsx', 'export default App')
      const content = await readProjectFile(TEST_PROJECT_ID, 'src/components/App.tsx')
      expect(content).toBe('export default App')
    })

    it('should overwrite existing files', async () => {
      await writeProjectFile(TEST_PROJECT_ID, 'file.txt', 'v1')
      await writeProjectFile(TEST_PROJECT_ID, 'file.txt', 'v2')
      const content = await readProjectFile(TEST_PROJECT_ID, 'file.txt')
      expect(content).toBe('v2')
    })

    it('should handle deep nesting', async () => {
      await writeProjectFile(TEST_PROJECT_ID, 'a/b/c/d/e/file.txt', 'deep')
      const content = await readProjectFile(TEST_PROJECT_ID, 'a/b/c/d/e/file.txt')
      expect(content).toBe('deep')
    })
  })

  describe('readProjectFile', () => {
    it('should read file content', async () => {
      await writeProjectFile(TEST_PROJECT_ID, 'test.txt', 'content here')
      const content = await readProjectFile(TEST_PROJECT_ID, 'test.txt')
      expect(content).toBe('content here')
    })

    it('should throw for missing files', async () => {
      await expect(readProjectFile(TEST_PROJECT_ID, 'nonexistent.txt')).rejects.toThrow('File not found')
    })
  })

  describe('listProjectFiles', () => {
    it('should list all files recursively', async () => {
      await writeProjectFile(TEST_PROJECT_ID, 'root.txt', 'root')
      await writeProjectFile(TEST_PROJECT_ID, 'src/app.tsx', 'app')
      await writeProjectFile(TEST_PROJECT_ID, 'src/lib/utils.ts', 'utils')

      const files = await listProjectFiles(TEST_PROJECT_ID)
      expect(files).toContain('root.txt')
      expect(files).toContain('src/app.tsx')
      expect(files).toContain('src/lib/utils.ts')
    })

    it('should skip node_modules and .git directories', async () => {
      await writeProjectFile(TEST_PROJECT_ID, 'src/app.tsx', 'app')
      // Create node_modules and .git directories with files
      const nodeModulesPath = path.join(getTestProjectPath(), 'node_modules', 'pkg')
      await fs.mkdir(nodeModulesPath, { recursive: true })
      await fs.writeFile(path.join(nodeModulesPath, 'index.js'), 'module', 'utf-8')

      const gitPath = path.join(getTestProjectPath(), '.git')
      await fs.mkdir(gitPath, { recursive: true })
      await fs.writeFile(path.join(gitPath, 'HEAD'), 'ref: refs/heads/main', 'utf-8')

      const files = await listProjectFiles(TEST_PROJECT_ID)
      expect(files).toContain('src/app.tsx')
      expect(files.some((f) => f.includes('node_modules'))).toBe(false)
      expect(files.some((f) => f.includes('.git'))).toBe(false)
    })

    it('should return empty array for nonexistent project', async () => {
      const files = await listProjectFiles('__nonexistent_project__')
      expect(files).toEqual([])
    })

    it('should return sorted files', async () => {
      await writeProjectFile(TEST_PROJECT_ID, 'z.txt', 'z')
      await writeProjectFile(TEST_PROJECT_ID, 'a.txt', 'a')
      await writeProjectFile(TEST_PROJECT_ID, 'm.txt', 'm')

      const files = await listProjectFiles(TEST_PROJECT_ID)
      expect(files).toEqual([...files].sort())
    })
  })

  describe('deleteProjectFile', () => {
    it('should delete a file', async () => {
      await writeProjectFile(TEST_PROJECT_ID, 'to-delete.txt', 'bye')
      await deleteProjectFile(TEST_PROJECT_ID, 'to-delete.txt')
      const exists = await fileExists(TEST_PROJECT_ID, 'to-delete.txt')
      expect(exists).toBe(false)
    })

    it('should throw for missing files', async () => {
      await expect(deleteProjectFile(TEST_PROJECT_ID, 'nonexistent.txt')).rejects.toThrow('File not found')
    })

    it('should clean up empty parent directories', async () => {
      await writeProjectFile(TEST_PROJECT_ID, 'empty-dir/nested/file.txt', 'content')
      await deleteProjectFile(TEST_PROJECT_ID, 'empty-dir/nested/file.txt')

      // The nested and empty-dir directories should be removed since they're now empty
      const projectPath = getTestProjectPath()
      expect(existsSync(path.join(projectPath, 'empty-dir'))).toBe(false)
    })

    it('should not remove non-empty parent directories', async () => {
      await writeProjectFile(TEST_PROJECT_ID, 'dir/file1.txt', '1')
      await writeProjectFile(TEST_PROJECT_ID, 'dir/file2.txt', '2')
      await deleteProjectFile(TEST_PROJECT_ID, 'dir/file1.txt')

      // dir should still exist because file2.txt is still there
      const exists = await fileExists(TEST_PROJECT_ID, 'dir/file2.txt')
      expect(exists).toBe(true)
    })
  })

  describe('deleteProjectWorkspace', () => {
    it('should delete entire project directory', async () => {
      await writeProjectFile(TEST_PROJECT_ID, 'file.txt', 'content')
      await deleteProjectWorkspace(TEST_PROJECT_ID)
      expect(existsSync(getTestProjectPath())).toBe(false)
    })

    it('should not throw if project directory does not exist', async () => {
      await expect(deleteProjectWorkspace('__nonexistent_project__')).resolves.not.toThrow()
    })
  })

  describe('fileExists', () => {
    it('should return true for existing file', async () => {
      await writeProjectFile(TEST_PROJECT_ID, 'exists.txt', 'yes')
      const exists = await fileExists(TEST_PROJECT_ID, 'exists.txt')
      expect(exists).toBe(true)
    })

    it('should return false for missing file', async () => {
      const exists = await fileExists(TEST_PROJECT_ID, 'nope.txt')
      expect(exists).toBe(false)
    })
  })

  describe('getProjectTree', () => {
    it('should return tree structure', async () => {
      await writeProjectFile(TEST_PROJECT_ID, 'root.txt', 'root')
      await writeProjectFile(TEST_PROJECT_ID, 'src/app.tsx', 'app')
      await writeProjectFile(TEST_PROJECT_ID, 'src/lib/utils.ts', 'utils')

      const tree = await getProjectTree(TEST_PROJECT_ID)

      // Find the src folder node
      const srcNode = tree.find((n) => n.name === 'src')
      expect(srcNode).toBeDefined()
      expect(srcNode!.isFolder).toBe(true)

      // Find the root.txt file node
      const rootNode = tree.find((n) => n.name === 'root.txt')
      expect(rootNode).toBeDefined()
      expect(rootNode!.isFolder).toBe(false)
    })

    it('should return empty array for nonexistent project', async () => {
      const tree = await getProjectTree('__nonexistent_project__')
      expect(tree).toEqual([])
    })

    it('should sort folders first, then files alphabetically', async () => {
      await writeProjectFile(TEST_PROJECT_ID, 'z-file.txt', 'z')
      await writeProjectFile(TEST_PROJECT_ID, 'a-file.txt', 'a')
      await writeProjectFile(TEST_PROJECT_ID, 'z-dir/file.txt', 'z-dir')
      await writeProjectFile(TEST_PROJECT_ID, 'a-dir/file.txt', 'a-dir')

      const tree = await getProjectTree(TEST_PROJECT_ID)

      // First two should be folders
      expect(tree[0].name).toBe('a-dir')
      expect(tree[0].isFolder).toBe(true)
      expect(tree[1].name).toBe('z-dir')
      expect(tree[1].isFolder).toBe(true)

      // Next two should be files
      expect(tree[2].name).toBe('a-file.txt')
      expect(tree[2].isFolder).toBe(false)
      expect(tree[3].name).toBe('z-file.txt')
      expect(tree[3].isFolder).toBe(false)
    })

    it('should include size for files', async () => {
      await writeProjectFile(TEST_PROJECT_ID, 'sized.txt', 'hello world')
      const tree = await getProjectTree(TEST_PROJECT_ID)
      const fileNode = tree.find((n) => n.name === 'sized.txt')
      expect(fileNode!.size).toBeGreaterThan(0)
    })
  })

  describe('writeProjectFiles', () => {
    it('should write multiple files at once', async () => {
      const result = await writeProjectFiles(TEST_PROJECT_ID, [
        { path: 'a.txt', content: 'aaa' },
        { path: 'b.txt', content: 'bbb' },
        { path: 'src/c.ts', content: 'ccc' },
      ])

      expect(result.written).toBe(3)
      expect(result.errors).toHaveLength(0)

      expect(await readProjectFile(TEST_PROJECT_ID, 'a.txt')).toBe('aaa')
      expect(await readProjectFile(TEST_PROJECT_ID, 'b.txt')).toBe('bbb')
      expect(await readProjectFile(TEST_PROJECT_ID, 'src/c.ts')).toBe('ccc')
    })

    it('should track errors for failed writes', async () => {
      // Try to write a file with path traversal - it should fail
      const result = await writeProjectFiles(TEST_PROJECT_ID, [
        { path: 'good.txt', content: 'ok' },
        { path: '../../../etc/passwd', content: 'hacked' },
      ])

      expect(result.written).toBe(1)
      expect(result.errors.length).toBeGreaterThan(0)
    })
  })

  describe('path traversal protection', () => {
    it('should reject paths with ../', async () => {
      await expect(
        writeProjectFile(TEST_PROJECT_ID, '../../../etc/passwd', 'hacked')
      ).rejects.toThrow('Path traversal')
    })

    it('should reject read attempts with ../', async () => {
      await expect(
        readProjectFile(TEST_PROJECT_ID, '../../../etc/passwd')
      ).rejects.toThrow('Path traversal')
    })

    it('should reject delete attempts with ../', async () => {
      await expect(
        deleteProjectFile(TEST_PROJECT_ID, '../../../etc/passwd')
      ).rejects.toThrow('Path traversal')
    })
  })
})
