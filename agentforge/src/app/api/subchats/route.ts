import { NextResponse } from 'next/server'
import {
  subchatManager,
  type Subchat,
  type SubchatStatus,
} from '@/lib/subchat-manager'

// GET /api/subchats — Return subchats for a parent chat
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const parentChatId = searchParams.get('parentChatId')
    const subchatId = searchParams.get('subchatId')

    // If a specific subchat ID is requested
    if (subchatId) {
      const subchat = subchatManager.getSubchat(subchatId)
      if (!subchat) {
        return NextResponse.json(
          { error: `Subchat not found: ${subchatId}` },
          { status: 404 },
        )
      }
      return NextResponse.json({ subchat })
    }

    // If parent chat ID is provided, list subchats for that parent
    if (parentChatId) {
      const subchats = subchatManager.listSubchats(parentChatId)
      const activeSubchat = subchatManager.getActiveSubchat(parentChatId)

      return NextResponse.json({
        parentChatId,
        subchats: subchats.map(formatSubchat),
        activeSubchat: activeSubchat ? formatSubchat(activeSubchat) : null,
        totalSubchats: subchats.length,
      })
    }

    // Otherwise return global stats
    const stats = subchatManager.getStats()
    return NextResponse.json({
      stats,
    })
  } catch (error) {
    console.error('[Subchats API] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to get subchats' },
      { status: 500 },
    )
  }
}

// POST /api/subchats — Create, update, or resolve/abandon subchats
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { action } = body

    switch (action) {
      case 'create': {
        const { parentChatId, fromMessageIndex, title } = body
        if (!parentChatId || fromMessageIndex === undefined) {
          return NextResponse.json(
            { error: 'parentChatId and fromMessageIndex are required' },
            { status: 400 },
          )
        }

        try {
          const subchat = subchatManager.createSubchat(
            parentChatId,
            fromMessageIndex,
            title,
          )
          return NextResponse.json({
            success: true,
            subchat: formatSubchat(subchat),
          }, { status: 201 })
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to create subchat'
          return NextResponse.json(
            { error: message },
            { status: 409 },
          )
        }
      }

      case 'add-message': {
        const { subchatId, role, content } = body
        if (!subchatId || !role || !content) {
          return NextResponse.json(
            { error: 'subchatId, role, and content are required' },
            { status: 400 },
          )
        }

        try {
          subchatManager.addMessage(subchatId, role, content)
          const subchat = subchatManager.getSubchat(subchatId)
          return NextResponse.json({
            success: true,
            subchat: subchat ? formatSubchat(subchat) : null,
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to add message'
          return NextResponse.json(
            { error: message },
            { status: 400 },
          )
        }
      }

      case 'resolve': {
        const { subchatId } = body
        if (!subchatId) {
          return NextResponse.json(
            { error: 'subchatId is required' },
            { status: 400 },
          )
        }

        try {
          subchatManager.resolveSubchat(subchatId)
          const subchat = subchatManager.getSubchat(subchatId)
          return NextResponse.json({
            success: true,
            subchat: subchat ? formatSubchat(subchat) : null,
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to resolve subchat'
          return NextResponse.json(
            { error: message },
            { status: 404 },
          )
        }
      }

      case 'abandon': {
        const { subchatId } = body
        if (!subchatId) {
          return NextResponse.json(
            { error: 'subchatId is required' },
            { status: 400 },
          )
        }

        try {
          subchatManager.abandonSubchat(subchatId)
          const subchat = subchatManager.getSubchat(subchatId)
          return NextResponse.json({
            success: true,
            subchat: subchat ? formatSubchat(subchat) : null,
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to abandon subchat'
          return NextResponse.json(
            { error: message },
            { status: 404 },
          )
        }
      }

      case 'get-context': {
        const { subchatId, maxTokens } = body
        if (!subchatId) {
          return NextResponse.json(
            { error: 'subchatId is required' },
            { status: 400 },
          )
        }

        const context = subchatManager.getSubchatContext(
          subchatId,
          maxTokens ?? 4000,
        )
        return NextResponse.json({
          subchatId,
          context,
          hasContext: context.length > 0,
        })
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 },
        )
    }
  } catch (error) {
    console.error('[Subchats API] POST error:', error)
    return NextResponse.json(
      { error: 'Failed to process subchat action' },
      { status: 500 },
    )
  }
}

// Helper to format a subchat for JSON output
function formatSubchat(subchat: Subchat) {
  return {
    id: subchat.id,
    parentChatId: subchat.parentChatId,
    parentMessageIndex: subchat.parentMessageIndex,
    title: subchat.title,
    status: subchat.status,
    messageCount: subchat.messages.length,
    messages: subchat.messages.map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
    })),
    createdAt: subchat.createdAt,
    updatedAt: subchat.updatedAt,
  }
}
