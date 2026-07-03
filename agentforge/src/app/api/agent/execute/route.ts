import { db } from '@/lib/db'
import { NextResponse } from 'next/server'
import { executeCommand, getLanguageCommand } from '@/lib/terminal'
import { writeProjectFile } from '@/lib/filesystem'
import { existsSync } from 'fs'
import path from 'path'

interface ExecuteRequest {
  code: string
  language: string
  projectId: string
}

const LANGUAGE_CONFIG: Record<string, { ext: string; comment: string; runtime: string }> = {
  javascript: { ext: 'js', comment: '//', runtime: 'Node.js v20' },
  typescript: { ext: 'ts', comment: '//', runtime: 'Bun v1.1 + TypeScript 5' },
  python: { ext: 'py', comment: '#', runtime: 'Python 3.11' },
  html: { ext: 'html', comment: '<!--', runtime: 'Browser' },
  css: { ext: 'css', comment: '/*', runtime: 'Browser' },
  sql: { ext: 'sql', comment: '--', runtime: 'SQLite 3' },
  bash: { ext: 'sh', comment: '#', runtime: 'Bash 5.2' },
  json: { ext: 'json', comment: '//', runtime: 'Parser' },
  prisma: { ext: 'prisma', comment: '//', runtime: 'Prisma CLI' },
}

/**
 * Validate HTML/CSS without real execution
 */
function validateHtmlCss(code: string, language: string): { output: string; error?: string } {
  const config = LANGUAGE_CONFIG[language.toLowerCase()] || LANGUAGE_CONFIG.html
  const lines = code.trim().split('\n')
  const issues: string[] = []

  if (language === 'html') {
    // Basic HTML validation
    if (!code.includes('<')) {
      issues.push('No HTML tags found')
    }
    const openTags = (code.match(/<(\w+)[\s>]/g) || []).length
    const closeTags = (code.match(/<\/\w+>/g) || []).length
    if (openTags > 0 && closeTags === 0 && !code.includes('<!DOCTYPE') && !code.includes('<br') && !code.includes('<hr') && !code.includes('<img')) {
      issues.push('Has opening tags but no closing tags')
    }
    if (code.includes('<script') && !code.includes('</script>')) {
      issues.push('Unclosed <script> tag')
    }
  } else if (language === 'css') {
    // Basic CSS validation
    const openBraces = (code.match(/\{/g) || []).length
    const closeBraces = (code.match(/\}/g) || []).length
    if (openBraces !== closeBraces) {
      issues.push(`Mismatched braces: ${openBraces} opening, ${closeBraces} closing`)
    }
  }

  if (issues.length > 0) {
    return {
      output: `> Validating ${language.toUpperCase()} with ${config.runtime}...\n> Found ${issues.length} issue(s):\n${issues.map(i => `  ⚠ ${i}`).join('\n')}\n\n✗ Validation failed`,
      error: issues.join('; '),
    }
  }

  return {
    output: [
      `> Validating ${language.toUpperCase()} with ${config.runtime}...`,
      `> Processing ${lines.length} lines of ${language.toUpperCase()}...`,
      language === 'html'
        ? `> DOM elements estimated: ${(code.match(/<\w+/g) || []).length}`
        : `> Rules parsed: ${(code.match(/\{/g) || []).length}`,
      `> Validation passed`,
      ``,
      `✓ Validation completed`,
    ].join('\n'),
  }
}

// POST /api/agent/execute - Execute code in a sandboxed environment
export async function POST(req: Request) {
  try {
    const body: ExecuteRequest = await req.json()
    const { code, language, projectId } = body

    if (!code) {
      return NextResponse.json(
        { success: false, error: 'Code is required' },
        { status: 400 }
      )
    }

    if (!language) {
      return NextResponse.json(
        { success: false, error: 'Language is required' },
        { status: 400 }
      )
    }

    const config = LANGUAGE_CONFIG[language.toLowerCase()] || LANGUAGE_CONFIG.javascript
    const startTime = Date.now()

    // Check for obvious syntax errors in simple cases
    let syntaxError: string | null = null

    if (language === 'json') {
      try {
        JSON.parse(code)
      } catch (e) {
        syntaxError = `JSON parse error: ${(e as Error).message}`
      }
    }

    if (language === 'sql') {
      const trimmedCode = code.trim().toLowerCase()
      if (
        trimmedCode.includes('drop table') &&
        !trimmedCode.includes('if exists')
      ) {
        syntaxError = 'Safety check: DROP TABLE without IF EXISTS is not allowed in sandbox'
      }
    }

    if (syntaxError) {
      // Log the failed execution to project if projectId provided
      if (projectId) {
        try {
          await db.message.create({
            data: {
              projectId,
              role: 'system',
              content: `Code execution failed (${language}): ${syntaxError}`,
              metadata: JSON.stringify({ type: 'execution_error', language, error: syntaxError }),
            },
          })
        } catch (dbError) {
          console.error('Failed to log execution error:', dbError)
        }
      }

      return NextResponse.json({
        success: false,
        output: `❌ Execution failed\n\nError: ${syntaxError}\n\nLanguage: ${language}\nLines: ${code.split('\n').length}`,
        error: syntaxError,
      })
    }

    // Handle HTML/CSS with validation instead of execution
    if (language === 'html' || language === 'css') {
      const result = validateHtmlCss(code, language)
      const executionTime = Date.now() - startTime

      // Log the execution to project if projectId provided
      if (projectId) {
        try {
          await db.message.create({
            data: {
              projectId,
              role: 'system',
              content: `Code validated (${language}): ${code.split('\n').length} lines`,
              metadata: JSON.stringify({
                type: 'execution',
                language,
                executionTime,
              }),
            },
          })
        } catch (dbError) {
          console.error('Failed to log execution:', dbError)
        }
      }

      return NextResponse.json({
        success: !result.error,
        output: result.output,
        error: result.error,
        metadata: {
          language,
          lines: code.split('\n').length,
          characters: code.length,
          executionTime: `${executionTime}ms`,
          runtime: config.runtime,
        },
      })
    }

    // For JSON validation, just return the result
    if (language === 'json') {
      const executionTime = Date.now() - startTime
      const output = `> Validating JSON...\n> JSON is valid\n> Size: ${code.length} bytes\n\n✓ Validation completed in ${executionTime}ms`

      if (projectId) {
        try {
          await db.message.create({
            data: {
              projectId,
              role: 'system',
              content: `JSON validated successfully: ${code.length} bytes`,
              metadata: JSON.stringify({ type: 'execution', language, executionTime }),
            },
          })
        } catch (dbError) {
          console.error('Failed to log execution:', dbError)
        }
      }

      return NextResponse.json({
        success: true,
        output,
        metadata: {
          language,
          lines: code.split('\n').length,
          characters: code.length,
          executionTime: `${executionTime}ms`,
          runtime: config.runtime,
        },
      })
    }

    // For executable languages, use real execution
    const { command, fileName } = getLanguageCommand(language, code, projectId || 'default')

    if (!command) {
      return NextResponse.json({
        success: false,
        output: `No execution handler for language: ${language}`,
        error: `Language ${language} is not executable`,
      })
    }

    // If we need to write a temp file first (for most languages)
    if (fileName && projectId) {
      try {
        // Ensure the .agent-tmp directory exists and write the code file
        await writeProjectFile(projectId, fileName, code)

        // For SQL, also ensure the database file exists
        if (language === 'sql') {
          const projectPath = path.join(process.cwd(), 'workspace', projectId)
          const dbPath = path.join(projectPath, 'app.db')
          if (!existsSync(dbPath)) {
            // Create empty SQLite database
            await executeCommand(`sqlite3 "${dbPath}" ".databases"`, {
              projectId,
              timeout: 5000,
            })
          }
        }
      } catch (writeError) {
        console.error('Failed to write temp execution file:', writeError)
        return NextResponse.json({
          success: false,
          output: `❌ Failed to prepare execution environment: ${(writeError as Error).message}`,
          error: (writeError as Error).message,
        })
      }
    }

    // Execute the command
    const result = await executeCommand(command, {
      projectId: projectId || undefined,
      timeout: 30000,
    })

    const executionTime = Date.now() - startTime

    // Clean up temp file
    if (fileName && projectId) {
      try {
        const { deleteProjectFile } = await import('@/lib/filesystem')
        await deleteProjectFile(projectId, fileName)
      } catch {
        // Ignore cleanup errors
      }
    }

    // Format the output
    const outputLines: string[] = []
    outputLines.push(`> Running with ${config.runtime}...`)

    if (result.timedOut) {
      outputLines.push(`> Execution timed out after ${result.executionTime}ms`)
      outputLines.push('')
      if (result.stdout) {
        outputLines.push('Partial output:')
        outputLines.push(result.stdout.substring(0, 5000))
      }
      outputLines.push('')
      outputLines.push(`⚠ Execution timed out`)
    } else if (result.exitCode === 0) {
      if (result.stdout) {
        outputLines.push(result.stdout.substring(0, 10000))
      }
      if (result.stderr) {
        outputLines.push(`[stderr] ${result.stderr.substring(0, 2000)}`)
      }
      outputLines.push('')
      outputLines.push(`✓ Execution completed in ${result.executionTime}ms`)
    } else {
      outputLines.push(`> Process exited with code ${result.exitCode}`)
      if (result.stdout) {
        outputLines.push(result.stdout.substring(0, 5000))
      }
      if (result.stderr) {
        outputLines.push(`[stderr] ${result.stderr.substring(0, 5000)}`)
      }
      outputLines.push('')
      outputLines.push(`✗ Execution failed with exit code ${result.exitCode}`)
    }

    const success = result.exitCode === 0 && !result.timedOut
    const output = outputLines.join('\n')

    // Log the execution to project if projectId provided
    if (projectId) {
      try {
        await db.message.create({
          data: {
            projectId,
            role: 'system',
            content: `Code ${success ? 'executed successfully' : 'execution failed'} (${language}): ${code.split('\n').length} lines`,
            metadata: JSON.stringify({
              type: 'execution',
              language,
              exitCode: result.exitCode,
              executionTime: result.executionTime,
              timedOut: result.timedOut,
            }),
          },
        })
      } catch (dbError) {
        console.error('Failed to log execution:', dbError)
      }
    }

    return NextResponse.json({
      success,
      output,
      error: success ? undefined : (result.stderr || `Exit code: ${result.exitCode}`),
      metadata: {
        language,
        lines: code.split('\n').length,
        characters: code.length,
        executionTime: `${executionTime}ms`,
        runtime: config.runtime,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
      },
    })
  } catch (error) {
    console.error('Execution error:', error)
    return NextResponse.json(
      {
        success: false,
        output: '❌ Internal execution error',
        error: (error as Error).message || 'An unexpected error occurred',
      },
      { status: 500 }
    )
  }
}
