import { NextResponse } from 'next/server'
import {
  templateEngine,
  type ProjectTemplate,
} from '@/lib/template-engine'

// GET /api/templates — Return all available templates
export async function GET() {
  try {
    const templates = templateEngine.listTemplates()

    // Enrich with full template details for the UI
    const enriched = templates.map((t) => {
      const full = templateEngine.getTemplate(t.id)
      return {
        id: t.id,
        name: t.name,
        category: t.category,
        description: t.description,
        fileCount: full?.files.length ?? 0,
        lockedFiles: full?.lockedFiles ?? [],
        prewarmedFiles: full?.prewarmedFiles ?? [],
        dependencies: full
          ? Object.keys(full.dependencies).length
          : 0,
        hasSystemPrompt: !!(full?.systemPromptAddition),
      }
    })

    return NextResponse.json({
      templates: enriched,
      total: enriched.length,
    })
  } catch (error) {
    console.error('[Templates API] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to get templates' },
      { status: 500 },
    )
  }
}

// POST /api/templates — Create a project from a template
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { action } = body

    switch (action) {
      case 'create': {
        const { templateId, projectId, projectName, variables } = body
        if (!templateId || !projectId || !projectName) {
          return NextResponse.json(
            { error: 'templateId, projectId, and projectName are required' },
            { status: 400 },
          )
        }

        // Check template exists
        const template = templateEngine.getTemplate(templateId)
        if (!template) {
          return NextResponse.json(
            { error: `Template not found: ${templateId}` },
            { status: 404 },
          )
        }

        const result = await templateEngine.createProject(
          templateId,
          projectId,
          projectName,
          variables,
        )

        return NextResponse.json({
          success: result.errors.length === 0,
          filesWritten: result.filesWritten,
          errors: result.errors,
          templateId,
          projectId,
          projectName,
        }, { status: result.errors.length > 0 ? 207 : 201 })
      }

      case 'get-details': {
        const { templateId } = body
        if (!templateId) {
          return NextResponse.json(
            { error: 'templateId is required' },
            { status: 400 },
          )
        }

        const template = templateEngine.getTemplate(templateId)
        if (!template) {
          return NextResponse.json(
            { error: `Template not found: ${templateId}` },
            { status: 404 },
          )
        }

        return NextResponse.json({
          template: {
            id: template.id,
            name: template.name,
            description: template.description,
            category: template.category,
            files: template.files.map((f) => ({ path: f.path })),
            lockedFiles: template.lockedFiles,
            prewarmedFiles: template.prewarmedFiles,
            dependencies: template.dependencies,
            scripts: template.scripts,
            hasSystemPrompt: !!template.systemPromptAddition,
          },
        })
      }

      case 'register': {
        // Register a custom template
        const { template: templateData } = body as { template: ProjectTemplate }
        if (!templateData?.id || !templateData?.name) {
          return NextResponse.json(
            { error: 'Template must have id and name' },
            { status: 400 },
          )
        }

        templateEngine.registerTemplate(templateData)
        return NextResponse.json({
          success: true,
          templateId: templateData.id,
        }, { status: 201 })
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 },
        )
    }
  } catch (error) {
    console.error('[Templates API] POST error:', error)
    return NextResponse.json(
      { error: 'Failed to process template action' },
      { status: 500 },
    )
  }
}
