/**
 * Diff-Based File Editor — Search/replace blocks for precise file editing
 *
 * Replaces full-file writes with search/replace diff operations that
 * allow the LLM to make targeted edits without rewriting entire files.
 *
 * Features:
 *   - Search/replace block format (compatible with Aider/Cline conventions)
 *   - Fuzzy matching with configurable tolerance
 *   - Conflict detection and reporting
 *   - Line-based diff with context
 *   - Automatic backup before applying edits
 *   - Rollback support
 *   - Full integration with the event bus
 *
 * Format:
 *   The LLM can use the edit_file tool with operations:
 *   [
 *     { "search": "exact text to find", "replace": "replacement text" },
 *     { "search": "another block", "replace": "new content" }
 *   ]
 *
 *   Or inline in the response:
 *   <<<<<<< SEARCH
 *   exact text to find
 *   =======
 *   replacement text
 *   >>>>>>> REPLACE
 */

import { promises as fs } from 'fs'
import path from 'path'
import { agentEventBus } from './event-bus'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DiffOperation {
  search: string
  replace: string
}

export interface DiffResult {
  success: boolean
  filePath: string
  operationsApplied: number
  operationsTotal: number
  conflicts: DiffConflict[]
  content: string
}

export interface DiffConflict {
  operationIndex: number
  search: string
  reason: string
  suggestion?: string
}

export interface BackupEntry {
  filePath: string
  originalContent: string
  timestamp: number
  operation: 'edit' | 'write'
}

// ── Configuration ──────────────────────────────────────────────────────────────

const MAX_BACKUPS_PER_FILE = 10
const FUZZY_MATCH_THRESHOLD = 0.85 // 85% similarity required for fuzzy match

// ── Backup store ───────────────────────────────────────────────────────────────

const backupStore = new Map<string, BackupEntry[]>()

function addBackup(filePath: string, content: string, operation: 'edit' | 'write'): void {
  const backups = backupStore.get(filePath) || []
  backups.push({
    filePath,
    originalContent: content,
    timestamp: Date.now(),
    operation,
  })

  // Keep only the most recent backups
  if (backups.length > MAX_BACKUPS_PER_FILE) {
    backups.splice(0, backups.length - MAX_BACKUPS_PER_FILE)
  }

  backupStore.set(filePath, backups)
}

// ── String similarity ──────────────────────────────────────────────────────────

/**
 * Calculate Levenshtein distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = []

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        )
      }
    }
  }

  return matrix[b.length][a.length]
}

/**
 * Calculate similarity ratio between two strings (0.0–1.0).
 */
function similarity(a: string, b: string): number {
  if (a === b) return 1.0
  if (a.length === 0 || b.length === 0) return 0.0
  const maxLen = Math.max(a.length, b.length)
  return 1.0 - levenshteinDistance(a, b) / maxLen
}

// ── Search strategies ──────────────────────────────────────────────────────────

/**
 * Find the search text in the content, with exact matching first,
 * then fuzzy matching as fallback.
 */
function findSearchBlock(
  content: string,
  search: string,
  fuzzyThreshold: number = FUZZY_MATCH_THRESHOLD,
): { start: number; end: number; matched: string; fuzzy: boolean } | null {
  // 1. Exact match
  const exactIndex = content.indexOf(search)
  if (exactIndex !== -1) {
    return {
      start: exactIndex,
      end: exactIndex + search.length,
      matched: search,
      fuzzy: false,
    }
  }

  // 2. Normalized exact match (strip leading/trailing whitespace per line)
  const normalizeWhitespace = (s: string) =>
    s.split('\n').map((l) => l.trim()).join('\n')
  const normalizedSearch = normalizeWhitespace(search)
  const normalizedContent = normalizeWhitespace(content)
  const normalizedIndex = normalizedContent.indexOf(normalizedSearch)
  if (normalizedIndex !== -1) {
    // Map back to original positions (approximate)
    // For normalized match, find the best line range in the original content
    const searchLines = search.split('\n').map((l) => l.trim())
    const contentLines = content.split('\n')

    for (let i = 0; i < contentLines.length; i++) {
      let match = true
      for (let j = 0; j < searchLines.length; j++) {
        if (i + j >= contentLines.length || contentLines[i + j].trim() !== searchLines[j]) {
          match = false
          break
        }
      }
      if (match) {
        const start = content.split('\n').slice(0, i).join('\n').length + (i > 0 ? 1 : 0)
        const matchedText = content.split('\n').slice(i, i + searchLines.length).join('\n')
        const end = start + matchedText.length
        return { start, end, matched: matchedText, fuzzy: false }
      }
    }
  }

  // 3. Fuzzy match — search by lines
  const searchLines = search.split('\n')
  if (searchLines.length === 0) return null

  const contentLines = content.split('\n')
  let bestScore = 0
  let bestStart = -1

  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    const candidateLines = contentLines.slice(i, i + searchLines.length)
    const candidate = candidateLines.join('\n')
    const score = similarity(candidate, search)

    if (score > bestScore) {
      bestScore = score
      bestStart = i
    }
  }

  if (bestScore >= fuzzyThreshold && bestStart >= 0) {
    const start = content.split('\n').slice(0, bestStart).join('\n').length + (bestStart > 0 ? 1 : 0)
    const matchedLines = content.split('\n').slice(bestStart, bestStart + searchLines.length)
    const matched = matchedLines.join('\n')
    const end = start + matched.length

    return { start, end, matched, fuzzy: true }
  }

  return null
}

// ── Core apply function ────────────────────────────────────────────────────────

/**
 * Apply diff operations to a file's content.
 * Does NOT write to disk — only returns the transformed content.
 */
export function applyDiffOperations(
  content: string,
  operations: DiffOperation[],
  filePath?: string,
): DiffResult {
  let currentContent = content
  const conflicts: DiffConflict[] = []
  let operationsApplied = 0

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i]

    // Empty search = append at end of file
    if (op.search.trim() === '') {
      currentContent = currentContent + (currentContent.endsWith('\n') ? '' : '\n') + op.replace
      operationsApplied++
      continue
    }

    const match = findSearchBlock(currentContent, op.search)

    if (!match) {
      conflicts.push({
        operationIndex: i,
        search: op.search.substring(0, 100) + (op.search.length > 100 ? '...' : ''),
        reason: 'Search text not found in file (no exact or fuzzy match)',
        suggestion: 'Verify the search text matches the current file content exactly',
      })
      continue
    }

    // Apply the replacement
    currentContent =
      currentContent.substring(0, match.start) +
      op.replace +
      currentContent.substring(match.end)
    operationsApplied++
  }

  const result: DiffResult = {
    success: conflicts.length === 0,
    filePath: filePath || '',
    operationsApplied,
    operationsTotal: operations.length,
    conflicts,
    content: currentContent,
  }

  if (filePath) {
    agentEventBus.emit('diff:apply', {
      filePath,
      operations: operations.length,
      success: result.success,
    })

    for (const conflict of conflicts) {
      agentEventBus.emit('diff:conflict', {
        filePath,
        reason: conflict.reason,
      })
    }
  }

  return result
}

/**
 * Parse inline diff blocks from LLM text output.
 * Supports the <<<<<<< SEARCH / ======= / >>>>>>> REPLACE format.
 */
export function parseInlineDiffs(text: string): DiffOperation[] {
  const operations: DiffOperation[] = []
  const regex = /<<<<<<< SEARCH\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>> REPLACE/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    operations.push({
      search: match[1].trimEnd(),
      replace: match[2].trimEnd(),
    })
  }

  return operations
}

// ── File-level operations ──────────────────────────────────────────────────────

/**
 * Apply diff operations to a file on disk.
 * Creates a backup before modifying.
 */
export async function applyDiffToFile(
  filePath: string,
  operations: DiffOperation[],
): Promise<DiffResult> {
  // Resolve path
  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath)

  // Path traversal protection: check if the original (unresolved) path contains ..
  if (filePath.includes('..')) {
    return {
      success: false,
      filePath,
      operationsApplied: 0,
      operationsTotal: operations.length,
      conflicts: [{ operationIndex: -1, search: '', reason: 'Path traversal is not allowed' }],
      content: '',
    }
  }

  // Also check if resolved path escapes the workspace when relative paths were used
  if (!path.isAbsolute(filePath)) {
    const cwd = process.cwd()
    if (!resolvedPath.startsWith(cwd)) {
      return {
        success: false,
        filePath,
        operationsApplied: 0,
        operationsTotal: operations.length,
        conflicts: [{ operationIndex: -1, search: '', reason: 'File path escapes the workspace directory' }],
        content: '',
      }
    }
  }

  // Read the current file
  let currentContent: string
  try {
    currentContent = await fs.readFile(resolvedPath, 'utf-8')
  } catch (error) {
    // If file doesn't exist and first operation is a creation (empty search), create it
    if (operations.length > 0 && operations[0].search.trim() === '') {
      currentContent = ''
    } else {
      return {
        success: false,
        filePath,
        operationsApplied: 0,
        operationsTotal: operations.length,
        conflicts: [{
          operationIndex: -1,
          search: '',
          reason: `Cannot read file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        }],
        content: '',
      }
    }
  }

  // Create backup
  addBackup(filePath, currentContent, 'edit')

  // Apply the diff operations
  const result = applyDiffOperations(currentContent, operations, filePath)

  // Write the result if successful
  if (result.success || result.operationsApplied > 0) {
    try {
      const dir = path.dirname(resolvedPath)
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(resolvedPath, result.content, 'utf-8')
    } catch (error) {
      return {
        ...result,
        success: false,
        conflicts: [
          ...result.conflicts,
          {
            operationIndex: -1,
            search: '',
            reason: `Failed to write file: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
      }
    }
  }

  return result
}

/**
 * Rollback a file to its previous state.
 */
export async function rollbackFile(filePath: string): Promise<boolean> {
  const backups = backupStore.get(filePath)
  if (!backups || backups.length === 0) return false

  const lastBackup = backups[backups.length - 1]
  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath)

  try {
    await fs.writeFile(resolvedPath, lastBackup.originalContent, 'utf-8')
    backups.pop()
    return true
  } catch {
    return false
  }
}

/**
 * Get the backup history for a file.
 */
export function getBackupHistory(filePath: string): BackupEntry[] {
  return backupStore.get(filePath) || []
}

/**
 * Clear backups for a specific file or all files.
 */
export function clearBackups(filePath?: string): void {
  if (filePath) {
    backupStore.delete(filePath)
  } else {
    backupStore.clear()
  }
}
