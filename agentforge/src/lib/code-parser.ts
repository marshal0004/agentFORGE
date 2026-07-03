/**
 * Shared code parsing utilities.
 *
 * Used by the agent chat route and the agent-store to avoid duplication.
 */

/**
 * Map a file extension to a language identifier.
 */
export function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    css: 'css',
    scss: 'scss',
    html: 'html',
    json: 'json',
    md: 'markdown',
    prisma: 'prisma',
    sql: 'sql',
    yaml: 'yaml',
    yml: 'yaml',
    env: 'bash',
    sh: 'bash',
    py: 'python',
    go: 'go',
    rs: 'rust',
    java: 'java',
  }
  return langMap[ext] || 'text'
}

/**
 * Parse `### FILE:` blocks from LLM output text.
 *
 * Expected format:
 * ```
 * ### FILE: path/to/file.ext
 * ```lang
 * ... code ...
 * ```
 * ```
 *
 * Returns a mapping of file path → file content.
 */
export function parseCodeFiles(text: string): Record<string, string> {
  const files: Record<string, string> = {}
  const regex = /### FILE: (.+)\n```[\w]*\n([\s\S]*?)```/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    const filePath = match[1].trim()
    const code = match[2]
    files[filePath] = code
  }

  return files
}

/**
 * Parse `### FILE:` blocks from LLM output text and return an array with
 * path, content, and detected language — convenient for the store / DB.
 */
export interface ParsedFile {
  path: string
  content: string
  language: string
}

export function parseCodeFilesWithLanguage(text: string): ParsedFile[] {
  const files: ParsedFile[] = []
  const regex = /### FILE: (.+)\n```[\w]*\n([\s\S]*?)```/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    const filePath = match[1].trim()
    const content = match[2]
    files.push({
      path: filePath,
      content,
      language: getLanguageFromPath(filePath),
    })
  }

  return files
}

/**
 * Extract the __preview.html content from LLM output text.
 * Returns null if no __preview.html block exists.
 */
export function extractPreviewHtml(text: string): string | null {
  const match = text.match(/### FILE: __preview\.html\n```html\n([\s\S]*?)```/)
  return match ? match[1] : null
}
