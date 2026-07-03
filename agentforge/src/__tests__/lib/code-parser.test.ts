import { describe, it, expect } from 'vitest'
import {
  getLanguageFromPath,
  parseCodeFiles,
  parseCodeFilesWithLanguage,
  extractPreviewHtml,
} from '@/lib/code-parser'

describe('code-parser', () => {
  // -------------------------------------------------------------------------
  // getLanguageFromPath
  // -------------------------------------------------------------------------
  describe('getLanguageFromPath', () => {
    it('maps .ts to typescript', () => {
      expect(getLanguageFromPath('app.ts')).toBe('typescript')
    })

    it('maps .tsx to tsx', () => {
      expect(getLanguageFromPath('component.tsx')).toBe('tsx')
    })

    it('maps .js to javascript', () => {
      expect(getLanguageFromPath('index.js')).toBe('javascript')
    })

    it('maps .jsx to jsx', () => {
      expect(getLanguageFromPath('component.jsx')).toBe('jsx')
    })

    it('maps .py to python', () => {
      expect(getLanguageFromPath('main.py')).toBe('python')
    })

    it('maps .css to css', () => {
      expect(getLanguageFromPath('styles.css')).toBe('css')
    })

    it('maps .scss to scss', () => {
      expect(getLanguageFromPath('theme.scss')).toBe('scss')
    })

    it('maps .html to html', () => {
      expect(getLanguageFromPath('page.html')).toBe('html')
    })

    it('maps .json to json', () => {
      expect(getLanguageFromPath('package.json')).toBe('json')
    })

    it('maps .prisma to prisma', () => {
      expect(getLanguageFromPath('schema.prisma')).toBe('prisma')
    })

    it('maps .sql to sql', () => {
      expect(getLanguageFromPath('migrations.sql')).toBe('sql')
    })

    it('maps .yaml to yaml', () => {
      expect(getLanguageFromPath('config.yaml')).toBe('yaml')
    })

    it('maps .yml to yaml', () => {
      expect(getLanguageFromPath('docker-compose.yml')).toBe('yaml')
    })

    it('maps .env to bash', () => {
      expect(getLanguageFromPath('.env')).toBe('bash')
    })

    it('maps .sh to bash', () => {
      expect(getLanguageFromPath('setup.sh')).toBe('bash')
    })

    it('maps .md to markdown', () => {
      expect(getLanguageFromPath('README.md')).toBe('markdown')
    })

    it('maps .go to go', () => {
      expect(getLanguageFromPath('main.go')).toBe('go')
    })

    it('maps .rs to rust', () => {
      expect(getLanguageFromPath('lib.rs')).toBe('rust')
    })

    it('maps .java to java', () => {
      expect(getLanguageFromPath('App.java')).toBe('java')
    })

    it('returns "text" for unknown extensions', () => {
      expect(getLanguageFromPath('data.xyz')).toBe('text')
    })

    it('returns "text" for files with no extension', () => {
      expect(getLanguageFromPath('Makefile')).toBe('text')
    })

    it('handles uppercase extensions', () => {
      expect(getLanguageFromPath('Component.TSX')).toBe('tsx')
    })

    it('handles deeply nested paths', () => {
      expect(getLanguageFromPath('src/components/ui/button.tsx')).toBe('tsx')
    })

    it('handles dotfiles with .env extension correctly', () => {
      expect(getLanguageFromPath('.env')).toBe('bash')
    })

    it('handles dotfiles with compound extensions as text', () => {
      // .env.local has extension "local", not "env"
      expect(getLanguageFromPath('.env.local')).toBe('text')
    })
  })

  // -------------------------------------------------------------------------
  // parseCodeFiles
  // -------------------------------------------------------------------------
  describe('parseCodeFiles', () => {
    it('parses a single file block', () => {
      const text = `### FILE: src/app.ts
\`\`\`typescript
const app = "hello"
\`\`\``
      const files = parseCodeFiles(text)
      expect(Object.keys(files)).toHaveLength(1)
      expect(files['src/app.ts']).toBe('const app = "hello"\n')
    })

    it('parses multiple file blocks', () => {
      const text = `### FILE: src/index.ts
\`\`\`typescript
console.log("hello")
\`\`\`

### FILE: src/utils.ts
\`\`\`typescript
export function add(a: number, b: number) { return a + b }
\`\`\``
      const files = parseCodeFiles(text)
      expect(Object.keys(files)).toHaveLength(2)
      expect(files['src/index.ts']).toContain('console.log')
      expect(files['src/utils.ts']).toContain('add')
    })

    it('parses file blocks with different language annotations', () => {
      const text = `### FILE: styles.css
\`\`\`css
body { margin: 0; }
\`\`\`

### FILE: schema.prisma
\`\`\`prisma
model User { id String @id }
\`\`\``
      const files = parseCodeFiles(text)
      expect(Object.keys(files)).toHaveLength(2)
      expect(files['styles.css']).toContain('body')
      expect(files['schema.prisma']).toContain('model User')
    })

    it('parses file blocks with no language annotation', () => {
      const text = `### FILE: config.json
\`\`\`
{"key": "value"}
\`\`\``
      const files = parseCodeFiles(text)
      expect(Object.keys(files)).toHaveLength(1)
      expect(files['config.json']).toContain('key')
    })

    it('returns empty object for text with no file blocks', () => {
      const text = 'This is just regular text with no code blocks.'
      const files = parseCodeFiles(text)
      expect(Object.keys(files)).toHaveLength(0)
    })

    it('returns empty object for empty text', () => {
      const files = parseCodeFiles('')
      expect(Object.keys(files)).toHaveLength(0)
    })

    it('handles code blocks that are not FILE blocks', () => {
      const text = `Here is some code:
\`\`\`typescript
const x = 1
\`\`\``
      const files = parseCodeFiles(text)
      expect(Object.keys(files)).toHaveLength(0)
    })

    it('trims whitespace from file paths', () => {
      const text = `### FILE:  src/app.ts  
\`\`\`typescript
const app = "hello"
\`\`\``
      const files = parseCodeFiles(text)
      expect(files['src/app.ts']).toBeDefined()
    })

    it('handles multi-line code content', () => {
      const text = `### FILE: src/app.tsx
\`\`\`tsx
import React from 'react'

export default function App() {
  return <div>Hello</div>
}
\`\`\``
      const files = parseCodeFiles(text)
      expect(files['src/app.tsx']).toContain('import React')
      expect(files['src/app.tsx']).toContain('return <div>')
    })

    it('handles file blocks with empty code content', () => {
      const text = `### FILE: empty.txt
\`\`\`
\`\`\``
      const files = parseCodeFiles(text)
      expect(files['empty.txt']).toBeDefined()
      expect(files['empty.txt']).toBe('')
    })
  })

  // -------------------------------------------------------------------------
  // parseCodeFilesWithLanguage
  // -------------------------------------------------------------------------
  describe('parseCodeFilesWithLanguage', () => {
    it('returns parsed files with correct language', () => {
      const text = `### FILE: src/app.tsx
\`\`\`tsx
export default function App() { return null }
\`\`\`

### FILE: styles.css
\`\`\`css
body { margin: 0; }
\`\`\``
      const files = parseCodeFilesWithLanguage(text)
      expect(files).toHaveLength(2)
      expect(files[0].path).toBe('src/app.tsx')
      expect(files[0].language).toBe('tsx')
      expect(files[1].path).toBe('styles.css')
      expect(files[1].language).toBe('css')
    })

    it('includes content in parsed files', () => {
      const text = `### FILE: main.py
\`\`\`python
print("hello world")
\`\`\``
      const files = parseCodeFilesWithLanguage(text)
      expect(files).toHaveLength(1)
      expect(files[0].content).toContain('print')
      expect(files[0].language).toBe('python')
    })

    it('returns empty array for text with no file blocks', () => {
      const files = parseCodeFilesWithLanguage('no file blocks here')
      expect(files).toEqual([])
    })

    it('returns empty array for empty text', () => {
      const files = parseCodeFilesWithLanguage('')
      expect(files).toEqual([])
    })

    it('detects language from path for prisma files', () => {
      const text = `### FILE: prisma/schema.prisma
\`\`\`prisma
model User { id String @id }
\`\`\``
      const files = parseCodeFilesWithLanguage(text)
      expect(files[0].language).toBe('prisma')
    })

    it('detects language from path for unknown extensions as text', () => {
      const text = `### FILE: data.xyz
\`\`\`
some content
\`\`\``
      const files = parseCodeFilesWithLanguage(text)
      expect(files[0].language).toBe('text')
    })

    it('handles multiple files of the same language', () => {
      const text = `### FILE: a.ts
\`\`\`typescript
const a = 1
\`\`\`

### FILE: b.ts
\`\`\`typescript
const b = 2
\`\`\``
      const files = parseCodeFilesWithLanguage(text)
      expect(files).toHaveLength(2)
      expect(files[0].language).toBe('typescript')
      expect(files[1].language).toBe('typescript')
    })
  })

  // -------------------------------------------------------------------------
  // extractPreviewHtml
  // -------------------------------------------------------------------------
  describe('extractPreviewHtml', () => {
    it('extracts __preview.html content', () => {
      const text = `### FILE: __preview.html
\`\`\`html
<div class="preview">Hello World</div>
\`\`\``
      const result = extractPreviewHtml(text)
      expect(result).toBe('<div class="preview">Hello World</div>\n')
    })

    it('returns null when no __preview.html block exists', () => {
      const text = `### FILE: src/app.ts
\`\`\`typescript
const x = 1
\`\`\``
      const result = extractPreviewHtml(text)
      expect(result).toBeNull()
    })

    it('returns null for empty text', () => {
      const result = extractPreviewHtml('')
      expect(result).toBeNull()
    })

    it('extracts preview HTML from text with other file blocks', () => {
      const text = `### FILE: src/app.ts
\`\`\`typescript
const app = "hello"
\`\`\`

### FILE: __preview.html
\`\`\`html
<html><body>Preview</body></html>
\`\`\`

### FILE: styles.css
\`\`\`css
body { margin: 0; }
\`\`\``
      const result = extractPreviewHtml(text)
      expect(result).toContain('<html>')
      expect(result).toContain('Preview')
    })

    it('extracts complex HTML with scripts and styles', () => {
      const text = `### FILE: __preview.html
\`\`\`html
<!DOCTYPE html>
<html>
<head><style>body{color:red}</style></head>
<body><script>console.log('hi')</script></body>
</html>
\`\`\``
      const result = extractPreviewHtml(text)
      expect(result).toContain('<style>')
      expect(result).toContain('<script>')
    })

    it('only matches the exact filename __preview.html', () => {
      const text = `### FILE: preview.html
\`\`\`html
<div>Not the preview</div>
\`\`\``
      const result = extractPreviewHtml(text)
      expect(result).toBeNull()
    })
  })
})
