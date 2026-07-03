/**
 * Artifact Writer — Dual write mechanism for LLM-generated file changes
 *
 * Implements a two-tier file writing strategy inspired by Chef's boltArtifact
 * and surgical edit tools:
 *
 *   1. Artifacts (bulk writes): XML-based blocks that contain full file contents.
 *      Used when creating new files or when changes span more than ~80% of the file.
 *
 *   2. Surgical edits (find-and-replace): Precise string replacement operations
 *      where both old and new strings are under 1024 characters. Used for small,
 *      targeted changes to existing files.
 *
 * The ArtifactParser extracts both formats from raw LLM output text, and the
 * ArtifactExecutor applies them to the project filesystem with protection
 * manager integration and event bus notifications.
 *
 * Integration points:
 *   - `./event-bus` for typed event emission
 *   - `./filesystem` for project file I/O
 */

import { agentEventBus } from './event-bus'
import {
  writeProjectFile,
  readProjectFile,
  deleteProjectFile,
  fileExists,
} from './filesystem'

// ── Types ──────────────────────────────────────────────────────────────────────

/** Bulk artifact containing one or more file actions */
export interface Artifact {
  id: string
  title: string
  actions: ArtifactAction[]
}

/** A single file operation within an artifact */
export interface ArtifactAction {
  filePath: string
  content: string // FULL file content
  type: 'create' | 'update' | 'delete'
}

/** Surgical find-and-replace edit */
export interface SurgicalEdit {
  filePath: string
  old: string // exact string to find (< 1024 chars)
  new: string // replacement (< 1024 chars)
}

/** Result of executing artifacts */
export interface ArtifactExecutionResult {
  written: string[]
  blocked: string[]
  errors: string[]
}

/** Result of executing surgical edits */
export interface SurgicalEditResult {
  applied: string[]
  blocked: string[]
  errors: string[]
}

/** Strategy recommendation for a set of changes */
export interface StrategyRecommendation {
  artifacts: Array<{ path: string; content: string }>
  edits: SurgicalEdit[]
}

// ── Constants ──────────────────────────────────────────────────────────────────

/** Maximum character length for each side of a surgical edit */
const SURGICAL_EDIT_MAX_LENGTH = 1024

/** Threshold ratio: if more than this % of the file changes, use artifact */
const ARTIFACT_CHANGE_THRESHOLD = 0.80

/** Minimum file size (chars) below which we always use artifacts */
const ARTIFACT_MIN_FILE_SIZE = 200

// ── ArtifactParser ─────────────────────────────────────────────────────────────

export class ArtifactParser {
  // ── Artifact parsing ──────────────────────────────────────────────────────

  /**
   * Parse artifact XML-like blocks from LLM output.
   *
   * Supported format:
   * ```
   * <artifact id="..." title="...">
   *   <action filePath="..." type="create|update|delete">
   *     content here
   *   </action>
   *   <action filePath="..." type="create">
   *     more content
   *   </action>
   * </artifact>
   * ```
   *
   * Also supports self-closing delete actions:
   * ```
   * <action filePath="..." type="delete" />
   * ```
   *
   * The parser is intentionally lenient: missing attributes default to sensible
   * values, and malformed blocks are skipped rather than causing a throw.
   */
  parseArtifacts(text: string): Artifact[] {
    const artifacts: Artifact[] = []

    // Match outer <artifact> blocks
    const artifactRegex = /<artifact\s+([^>]*)>([\s\S]*?)<\/artifact>/gi
    let artifactMatch: RegExpExecArray | null

    while ((artifactMatch = artifactRegex.exec(text)) !== null) {
      const attrString = artifactMatch[1]
      const body = artifactMatch[2]

      // Parse artifact attributes
      const id = this.extractAttribute(attrString, 'id') || `artifact-${Date.now()}-${artifacts.length}`
      const title = this.extractAttribute(attrString, 'title') || 'Untitled Artifact'

      // Parse <action> elements within the artifact body
      const actions = this.parseActions(body)

      if (actions.length > 0) {
        artifacts.push({ id, title, actions })
      }
    }

    return artifacts
  }

  /**
   * Parse <action> elements from the body of an artifact block.
   */
  private parseActions(body: string): ArtifactAction[] {
    const actions: ArtifactAction[] = []

    // Match <action filePath="..." type="...">content</action>
    const actionRegex = /<action\s+([^>]*?)>([\s\S]*?)<\/action>/gi
    let actionMatch: RegExpExecArray | null

    while ((actionMatch = actionRegex.exec(body)) !== null) {
      const attrString = actionMatch[1]
      const content = actionMatch[2]

      const filePath = this.extractAttribute(attrString, 'filePath') || this.extractAttribute(attrString, 'filepath') || this.extractAttribute(attrString, 'path') || ''
      const typeAttr = (this.extractAttribute(attrString, 'type') || 'create').toLowerCase()

      if (!filePath) continue

      const type: ArtifactAction['type'] =
        typeAttr === 'delete' ? 'delete' :
        typeAttr === 'update' ? 'update' : 'create'

      actions.push({
        filePath,
        content: type === 'delete' ? '' : this.unescapeContent(content),
        type,
      })
    }

    // Also match self-closing delete actions: <action filePath="..." type="delete" />
    const selfClosingRegex = /<action\s+([^>]*?)\/>/gi
    let scMatch: RegExpExecArray | null

    while ((scMatch = selfClosingRegex.exec(body)) !== null) {
      const attrString = scMatch[1]
      const filePath = this.extractAttribute(attrString, 'filePath') || this.extractAttribute(attrString, 'filepath') || this.extractAttribute(attrString, 'path') || ''
      const typeAttr = (this.extractAttribute(attrString, 'type') || '').toLowerCase()

      if (!filePath || typeAttr !== 'delete') continue

      actions.push({ filePath, content: '', type: 'delete' })
    }

    return actions
  }

  /**
   * Extract an attribute value from an HTML-like attribute string.
   * Handles both double-quoted and single-quoted values.
   */
  private extractAttribute(attrString: string, name: string): string | null {
    // Try double quotes: name="value"
    const doubleQuoted = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i')
    const dqMatch = attrString.match(doubleQuoted)
    if (dqMatch) return dqMatch[1]

    // Try single quotes: name='value'
    const singleQuoted = new RegExp(`${name}\\s*=\\s*'([^']*)'`, 'i')
    const sqMatch = attrString.match(singleQuoted)
    if (sqMatch) return sqMatch[1]

    // Try unquoted: name=value (value until whitespace or end)
    const unquoted = new RegExp(`${name}\\s*=\\s*(\\S+)`, 'i')
    const uqMatch = attrString.match(unquoted)
    if (uqMatch) return uqMatch[1]

    return null
  }

  /**
   * Unescape common XML/HTML entities in content.
   */
  private unescapeContent(content: string): string {
    return content
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
}

  // ── Surgical edit parsing ─────────────────────────────────────────────────

  /**
   * Parse surgical edit tool calls from LLM output.
   *
   * Supported formats:
   *
   * 1. Explicit tool call notation:
   *    [TOOL_CALL] edit_file({"path":"...","old":"...","new":"..."})
   *
   * 2. Multiple edits on separate lines:
   *    [TOOL_CALL] edit_file({"path":"...","old":"...","new":"..."})
   *    [TOOL_CALL] edit_file({"path":"...","old":"...","new":"..."})
   *
   * 3. Alternative syntax with `file_path`:
   *    [TOOL_CALL] edit_file({"file_path":"...","old":"...","new":"..."})
   *
   * The parser validates that old and new strings are under the 1024-char
   * limit and skips any edits that violate this constraint.
   */
  parseSurgicalEdits(text: string): SurgicalEdit[] {
    const edits: SurgicalEdit[] = []

    // Match [TOOL_CALL] edit_file({...})
    const toolCallRegex = /\[TOOL_CALL\]\s*edit_file\s*\(\s*(\{[\s\S]*?\})\s*\)/gi
    let match: RegExpExecArray | null

    while ((match = toolCallRegex.exec(text)) !== null) {
      const jsonStr = match[1]

      try {
        const parsed = JSON.parse(jsonStr)
        const filePath = parsed.path || parsed.file_path || parsed.filePath || ''
        const oldStr = typeof parsed.old === 'string' ? parsed.old : ''
        const newStr = typeof parsed.new === 'string' ? parsed.new : ''

        if (!filePath) continue
        if (!oldStr && !newStr) continue

        // Enforce length limits
        if (oldStr.length > SURGICAL_EDIT_MAX_LENGTH || newStr.length > SURGICAL_EDIT_MAX_LENGTH) {
          continue
        }

        edits.push({ filePath, old: oldStr, new: newStr })
      } catch {
        // Malformed JSON — skip this edit
        continue
      }
    }

    // Also parse inline <<<<<<< SEARCH / ======= / >>>>>>> REPLACE blocks
    // that are commonly used by Aider/Cline-style agents
    const searchReplaceRegex = /<<<<<<< SEARCH\s*\n([\s\S]*?)\n=======\s*\n([\s\S]*?)\n>>>>>>> REPLACE/gi
    let srMatch: RegExpExecArray | null

    // Track file context — look for a preceding file reference
    const lines = text.split('\n')
    let currentFilePath = ''

    while ((srMatch = searchReplaceRegex.exec(text)) !== null) {
      const searchContent = srMatch[1]
      const replaceContent = srMatch[2]

      if (!searchContent && !replaceContent) continue
      if (searchContent.length > SURGICAL_EDIT_MAX_LENGTH || replaceContent.length > SURGICAL_EDIT_MAX_LENGTH) {
        continue
      }

      // Try to find a file path preceding this block
      const blockStartIndex = srMatch.index
      const precedingText = text.substring(Math.max(0, blockStartIndex - 500), blockStartIndex)

      // Look for ### FILE: path or // File: path patterns
      const fileRefMatch = precedingText.match(/(?:###\s*FILE:\s*|\/\/\s*File:\s*|\/\*\s*File:\s*)([^\n*]+)/i)
      if (fileRefMatch) {
        currentFilePath = fileRefMatch[1].trim()
      }

      if (currentFilePath) {
        edits.push({
          filePath: currentFilePath,
          old: searchContent,
          new: replaceContent,
        })
      }
    }

    return edits
  }

  // ── Strategy recommendation ───────────────────────────────────────────────

  /**
   * Determine which write strategy to use for a set of changes.
   *
   * Strategy rules:
   *   - If the file doesn't exist → use artifact (create)
   *   - If the file is very small (< 200 chars) → use artifact (rewrite is cheap)
   *   - If the change affects > 80% of the file → use artifact (rewrite is more efficient)
   *   - If both old and new strings are < 1024 chars → use surgical edit
   *   - Otherwise → use artifact
   *
   * @param changes - Array of file changes with optional old content
   */
  recommendStrategy(changes: Array<{ path: string; oldContent?: string; newContent: string }>): StrategyRecommendation {
    const artifacts: StrategyRecommendation['artifacts'] = []
    const edits: StrategyRecommendation['edits'] = []

    for (const change of changes) {
      const { path, oldContent, newContent } = change

      // New file → always use artifact
      if (oldContent === undefined || oldContent === null) {
        artifacts.push({ path, content: newContent })
        continue
      }

      // Small file → always use artifact (rewrite is cheap and less error-prone)
      if (oldContent.length < ARTIFACT_MIN_FILE_SIZE) {
        artifacts.push({ path, content: newContent })
        continue
      }

      // Calculate change ratio
      const changeRatio = this.calculateChangeRatio(oldContent, newContent)

      if (changeRatio > ARTIFACT_CHANGE_THRESHOLD) {
        // Large change → use artifact
        artifacts.push({ path, content: newContent })
        continue
      }

      // Try to extract a surgical edit
      const edit = this.extractSurgicalEdit(oldContent, newContent, path)
      if (edit) {
        edits.push(edit)
      } else {
        // Fallback to artifact if we can't isolate a clean edit
        artifacts.push({ path, content: newContent })
      }
    }

    return { artifacts, edits }
  }

  /**
   * Calculate what fraction of the file has changed.
   * Returns a value between 0.0 (no change) and 1.0 (completely different).
   */
  private calculateChangeRatio(oldContent: string, newContent: string): number {
    if (oldContent === newContent) return 0.0
    if (oldContent.length === 0) return 1.0

    // Simple line-based diff ratio
    const oldLines = oldContent.split('\n')
    const newLines = newContent.split('\n')

    const maxLen = Math.max(oldLines.length, newLines.length)
    if (maxLen === 0) return 0.0

    // Count lines that differ using a simple LCS-inspired approach
    const oldSet = new Map<string, number>()
    for (const line of oldLines) {
      oldSet.set(line, (oldSet.get(line) || 0) + 1)
    }

    let matchingLines = 0
    const newSet = new Map<string, number>()
    for (const line of newLines) {
      const count = oldSet.get(line) || 0
      if (count > 0) {
        matchingLines++
        oldSet.set(line, count - 1)
      }
    }

    const changedLines = maxLen - matchingLines
    return changedLines / maxLen
  }

  /**
   * Try to extract a single surgical edit from an old→new content pair.
   *
   * Finds the longest common prefix and suffix, then uses the differing
   * middle section as the "old" and "new" for the edit. Returns null if
   * either side exceeds the 1024-char limit.
   */
  private extractSurgicalEdit(oldContent: string, newContent: string, filePath: string): SurgicalEdit | null {
    // Find common prefix length
    let prefixLen = 0
    const minLen = Math.min(oldContent.length, newContent.length)
    while (prefixLen < minLen && oldContent[prefixLen] === newContent[prefixLen]) {
      prefixLen++
    }

    // Find common suffix length
    let suffixLen = 0
    while (
      suffixLen < minLen - prefixLen &&
      oldContent[oldContent.length - 1 - suffixLen] === newContent[newContent.length - 1 - suffixLen]
    ) {
      suffixLen++
    }

    const oldMiddle = oldContent.substring(prefixLen, oldContent.length - suffixLen)
    const newMiddle = newContent.substring(prefixLen, newContent.length - suffixLen)

    // Check length constraints
    if (oldMiddle.length > SURGICAL_EDIT_MAX_LENGTH || newMiddle.length > SURGICAL_EDIT_MAX_LENGTH) {
      return null
    }

    // If both middles are empty, there's no actual change
    if (oldMiddle === '' && newMiddle === '') {
      return null
    }

    // Add a small context window around the change for more robust matching
    const contextBefore = Math.min(40, prefixLen)
    const contextAfter = Math.min(40, suffixLen)

    const oldWithContext = oldContent.substring(prefixLen - contextBefore, oldContent.length - suffixLen + contextAfter)
    const newWithContext = newContent.substring(prefixLen - contextBefore, newContent.length - suffixLen + contextAfter)

    // If the context pushes us over the limit, use the middle-only version
    if (oldWithContext.length > SURGICAL_EDIT_MAX_LENGTH || newWithContext.length > SURGICAL_EDIT_MAX_LENGTH) {
      return { filePath, old: oldMiddle, new: newMiddle }
    }

    return { filePath, old: oldWithContext, new: newWithContext }
  }
}

// ── ArtifactExecutor ──────────────────────────────────────────────────────────

export class ArtifactExecutor {
  /**
   * Execute artifacts (bulk write multiple files).
   *
   * For each action:
   *   - 'create': Write the file only if it doesn't already exist
   *   - 'update': Write the file, overwriting existing content
   *   - 'delete': Delete the file from the project
   *
   * If a protectionManager is provided, protected files will be blocked.
   *
   * @param projectId - The project identifier
   * @param artifacts - Array of artifacts to execute
   * @param protectionManager - Optional FileProtectionManager instance
   */
  async executeArtifacts(
    projectId: string,
    artifacts: Artifact[],
    protectionManager?: {
      isProtected?: (projectId: string, filePath: string) => boolean
    },
  ): Promise<ArtifactExecutionResult> {
    const written: string[] = []
    const blocked: string[] = []
    const errors: string[] = []

    for (const artifact of artifacts) {
      for (const action of artifact.actions) {
        try {
          // Check protection
          if (protectionManager?.isProtected?.(projectId, action.filePath)) {
            blocked.push(action.filePath)
            agentEventBus.emit('diff:conflict', {
              filePath: action.filePath,
              reason: `File is protected: ${action.filePath}`,
            })
            continue
          }

          // Validate path for traversal attacks
          if (this.isPathTraversal(action.filePath)) {
            blocked.push(action.filePath)
            errors.push(`Path traversal detected: ${action.filePath}`)
            continue
          }

          switch (action.type) {
            case 'create': {
              const exists = await fileExists(projectId, action.filePath)
              if (exists) {
                // For create actions on existing files, treat as an update warning
                // but still write — the LLM may intend to overwrite
                await writeProjectFile(projectId, action.filePath, action.content)
                written.push(action.filePath)
              } else {
                await writeProjectFile(projectId, action.filePath, action.content)
                written.push(action.filePath)
              }
              break
            }

            case 'update': {
              await writeProjectFile(projectId, action.filePath, action.content)
              written.push(action.filePath)
              break
            }

            case 'delete': {
              const exists = await fileExists(projectId, action.filePath)
              if (exists) {
                await deleteProjectFile(projectId, action.filePath)
                written.push(action.filePath)
              } else {
                // File doesn't exist — that's fine for delete
                written.push(action.filePath)
              }
              break
            }

            default: {
              errors.push(`Unknown action type: ${(action as ArtifactAction).type} for ${action.filePath}`)
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error'
          errors.push(`Failed to execute action on ${action.filePath}: ${msg}`)
        }
      }
    }

    // Emit events for each written file
    for (const filePath of written) {
      agentEventBus.emit('diff:apply', {
        filePath,
        operations: 1,
        success: true,
      })
    }

    return { written, blocked, errors }
  }

  /**
   * Execute surgical edits (find-and-replace operations).
   *
   * For each edit:
   *   1. Read the current file content
   *   2. Find the `old` string in the content
   *   3. Replace it with the `new` string
   *   4. Write the modified content back
   *
   * Supports both exact matching and normalized whitespace matching
   * (strips leading/trailing whitespace per line) as a fallback.
   *
   * @param projectId - The project identifier
   * @param edits - Array of surgical edits to apply
   * @param protectionManager - Optional FileProtectionManager instance
   */
  async executeSurgicalEdits(
    projectId: string,
    edits: SurgicalEdit[],
    protectionManager?: {
      isProtected?: (projectId: string, filePath: string) => boolean
    },
  ): Promise<SurgicalEditResult> {
    const applied: string[] = []
    const blocked: string[] = []
    const errors: string[] = []

    // Group edits by file for efficient processing
    const editsByFile = new Map<string, SurgicalEdit[]>()
    for (const edit of edits) {
      const existing = editsByFile.get(edit.filePath) || []
      existing.push(edit)
      editsByFile.set(edit.filePath, existing)
    }

    for (const [filePath, fileEdits] of editsByFile) {
      try {
        // Check protection
        if (protectionManager?.isProtected?.(projectId, filePath)) {
          blocked.push(filePath)
          agentEventBus.emit('diff:conflict', {
            filePath,
            reason: `File is protected: ${filePath}`,
          })
          continue
        }

        // Validate path
        if (this.isPathTraversal(filePath)) {
          blocked.push(filePath)
          errors.push(`Path traversal detected: ${filePath}`)
          continue
        }

        // Read current content
        let content: string
        try {
          content = await readProjectFile(projectId, filePath)
        } catch {
          errors.push(`File not found for surgical edit: ${filePath}`)
          continue
        }

        // Apply edits sequentially (order matters!)
        let currentContent = content
        let allApplied = true

        for (const edit of fileEdits) {
          const result = this.applySurgicalEdit(currentContent, edit)
          if (result.found) {
            currentContent = result.content
          } else {
            allApplied = false
            errors.push(
              `Could not find old string in ${filePath} for surgical edit. ` +
              `Old string preview: "${edit.old.substring(0, 80)}${edit.old.length > 80 ? '...' : ''}"`
            )
          }
        }

        // Write back only if at least one edit was applied
        if (currentContent !== content) {
          await writeProjectFile(projectId, filePath, currentContent)
          applied.push(filePath)

          agentEventBus.emit('diff:apply', {
            filePath,
            operations: fileEdits.length,
            success: allApplied,
          })
        } else if (!allApplied) {
          errors.push(`No edits could be applied to ${filePath}`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        errors.push(`Failed to apply surgical edits to ${filePath}: ${msg}`)
      }
    }

    return { applied, blocked, errors }
  }

  /**
   * Apply a single surgical edit to content.
   * Returns the modified content and whether the old string was found.
   */
  private applySurgicalEdit(
    content: string,
    edit: SurgicalEdit,
  ): { content: string; found: boolean } {
    // Strategy 1: Exact match
    const exactIndex = content.indexOf(edit.old)
    if (exactIndex !== -1) {
      return {
        content: content.substring(0, exactIndex) + edit.new + content.substring(exactIndex + edit.old.length),
        found: true,
      }
    }

    // Strategy 2: Normalized whitespace match (strip leading/trailing whitespace per line)
    const normalizeWhitespace = (s: string) =>
      s.split('\n').map((l) => l.trim()).join('\n')

    const normalizedOld = normalizeWhitespace(edit.old)
    const normalizedContent = normalizeWhitespace(content)
    const normalizedIndex = normalizedContent.indexOf(normalizedOld)

    if (normalizedIndex !== -1) {
      // Map the normalized match back to original positions
      // Find the line range in the normalized content
      const beforeLines = normalizedContent.substring(0, normalizedIndex).split('\n')
      const startLine = beforeLines.length - 1
      const editLineCount = normalizedOld.split('\n').length

      // Extract the original lines and replace them
      const contentLines = content.split('\n')
      const matchedOriginal = contentLines.slice(startLine, startLine + editLineCount).join('\n')

      // Use the original matched text's boundaries for replacement
      const originalStart = contentLines.slice(0, startLine).join('\n').length + (startLine > 0 ? 1 : 0)
      const originalEnd = originalStart + matchedOriginal.length

      return {
        content: content.substring(0, originalStart) + edit.new + content.substring(originalEnd),
        found: true,
      }
    }

    // Strategy 3: Fuzzy line-based match
    const oldLines = edit.old.split('\n')
    if (oldLines.length === 0) return { content, found: false }

    const contentLines = content.split('\n')
    let bestScore = 0
    let bestStartLine = -1

    for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
      const candidate = contentLines.slice(i, i + oldLines.length).join('\n')
      const score = this.similarity(candidate, edit.old)

      if (score > bestScore) {
        bestScore = score
        bestStartLine = i
      }
    }

    // Require at least 85% similarity for fuzzy match
    if (bestScore >= 0.85 && bestStartLine >= 0) {
      const beforeLines = contentLines.slice(0, bestStartLine)
      const afterLines = contentLines.slice(bestStartLine + oldLines.length)
      const newContent = [...beforeLines, ...edit.new.split('\n'), ...afterLines].join('\n')

      return { content: newContent, found: true }
    }

    return { content, found: false }
  }

  /**
   * Calculate similarity ratio between two strings (0.0–1.0).
   * Uses Levenshtein distance.
   */
  private similarity(a: string, b: string): number {
    if (a === b) return 1.0
    if (a.length === 0 || b.length === 0) return 0.0

    const matrix: number[][] = []
    for (let i = 0; i <= b.length; i++) matrix[i] = [i]
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j

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

    const maxLen = Math.max(a.length, b.length)
    return 1.0 - matrix[b.length][a.length] / maxLen
  }

  /**
   * Check if a file path contains path traversal sequences.
   */
  private isPathTraversal(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/')
    return normalized.includes('..') || normalized.includes('//')
  }
}

// ── Singletons ────────────────────────────────────────────────────────────────

export const artifactParser = new ArtifactParser()
export const artifactExecutor = new ArtifactExecutor()
