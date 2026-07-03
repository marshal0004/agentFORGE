import { NextResponse } from 'next/server'
import {
  ContextManager,
  LRUFileTracker,
  ToolResultAbbreviator,
  estimateTokens,
  getModelContextWindow,
} from '@/lib/context-manager'

// Singleton context manager instance
const contextManager = new ContextManager()
const lruTracker = new LRUFileTracker()
const abbreviator = new ToolResultAbbreviator()

// In-memory compaction history for the current session
interface CompactionRecord {
  id: string
  timestamp: number
  messagesBefore: number
  messagesAfter: number
  tokensSaved: number
  hysteresisApplied: boolean
  toolAbbreviationApplied: boolean
}

const compactionHistory: CompactionRecord[] = []

// Cache hit/miss tracking
interface CacheRecord {
  timestamp: number
  part: 'static' | 'dynamic'
  hit: boolean
  tokenCount: number
  provider: string
}

const cacheRecords: CacheRecord[] = []

// Tool abbreviation stats
interface AbbreviationStats {
  totalAbbreviated: number
  totalTokensSaved: number
  byTool: Record<string, { count: number; tokensSaved: number }>
}

const abbreviationStats: AbbreviationStats = {
  totalAbbreviated: 0,
  totalTokensSaved: 0,
  byTool: {},
}

// GET /api/context — Return context stats
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const model = searchParams.get('model') || 'gpt-4o'
    const sessionId = searchParams.get('sessionId') || 'default'

    const maxTokens = getModelContextWindow(model)
    const trackedFiles = lruTracker.getAllFiles()
    const relevantFiles = lruTracker.getRelevantFiles()
    const totalFileTokens = trackedFiles.reduce((sum, f) => sum + f.tokenCount, 0)
    const relevantFileTokens = relevantFiles.reduce((sum, f) => sum + f.tokenCount, 0)

    // Calculate approximate current context token count
    const currentTokens = totalFileTokens

    // Cache stats
    const cacheHits = cacheRecords.filter((r) => r.hit).length
    const cacheMisses = cacheRecords.filter((r) => !r.hit).length
    const cacheHitRate = cacheRecords.length > 0
      ? Math.round((cacheHits / cacheRecords.length) * 100)
      : 0

    // Total tokens saved from compaction
    const totalTokensSavedFromCompaction = compactionHistory.reduce(
      (sum, r) => sum + r.tokensSaved,
      0,
    )

    return NextResponse.json({
      sessionId,
      model,
      context: {
        currentTokens,
        maxTokens,
        usagePercent: Math.round((currentTokens / maxTokens) * 100),
        compactionThreshold: 80,
      },
      lruFiles: {
        tracked: trackedFiles.map((f) => ({
          path: f.path,
          lastAccessed: f.lastAccessed,
          accessCount: f.accessCount,
          tokenCount: f.tokenCount,
          preWarmed: f.preWarmed,
          language: f.language,
        })),
        relevant: relevantFiles.map((f) => ({
          path: f.path,
          tokenCount: f.tokenCount,
          preWarmed: f.preWarmed,
        })),
        totalFiles: trackedFiles.length,
        totalFileTokens,
        relevantFileTokens,
      },
      compactionHistory: compactionHistory.slice(-20), // Last 20 records
      totalTokensSavedFromCompaction,
      cache: {
        records: cacheRecords.slice(-50), // Last 50 records
        hits: cacheHits,
        misses: cacheMisses,
        hitRate: cacheHitRate,
      },
      abbreviation: abbreviationStats,
      config: {
        maxLRUFiles: 5,
        lruFileTokenBudget: 8000,
        toolAbbreviationThreshold: 500,
        enableHysteresis: true,
        enableToolAbbreviation: true,
        enableLRUFiles: true,
      },
    })
  } catch (error) {
    console.error('[Context API] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to get context stats' },
      { status: 500 },
    )
  }
}

// POST /api/context — Track file access, record compaction, update cache records
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { action } = body

    switch (action) {
      case 'touch': {
        // Track a file access
        const { path, content, language } = body
        if (!path || !content) {
          return NextResponse.json(
            { error: 'path and content are required for touch action' },
            { status: 400 },
          )
        }
        lruTracker.touch(path, content, language)
        return NextResponse.json({ success: true, action: 'touch', path })
      }

      case 'forget': {
        // Remove a file from tracking
        const { path } = body
        if (!path) {
          return NextResponse.json(
            { error: 'path is required for forget action' },
            { status: 400 },
          )
        }
        lruTracker.forget(path)
        return NextResponse.json({ success: true, action: 'forget', path })
      }

      case 'record-compaction': {
        // Record a compaction event
        const {
          messagesBefore,
          messagesAfter,
          tokensSaved,
          hysteresisApplied,
          toolAbbreviationApplied,
        } = body
        if (messagesBefore === undefined || messagesAfter === undefined) {
          return NextResponse.json(
            { error: 'messagesBefore and messagesAfter are required' },
            { status: 400 },
          )
        }
        const record: CompactionRecord = {
          id: `comp_${Date.now()}_${compactionHistory.length}`,
          timestamp: Date.now(),
          messagesBefore,
          messagesAfter,
          tokensSaved: tokensSaved || 0,
          hysteresisApplied: hysteresisApplied ?? false,
          toolAbbreviationApplied: toolAbbreviationApplied ?? false,
        }
        compactionHistory.push(record)
        // Keep only last 100 records
        if (compactionHistory.length > 100) {
          compactionHistory.splice(0, compactionHistory.length - 100)
        }
        return NextResponse.json({ success: true, record })
      }

      case 'record-cache': {
        // Record a cache hit/miss
        const { part, hit, tokenCount, provider } = body
        if (!part || hit === undefined) {
          return NextResponse.json(
            { error: 'part and hit are required for record-cache action' },
            { status: 400 },
          )
        }
        const record: CacheRecord = {
          timestamp: Date.now(),
          part,
          hit: Boolean(hit),
          tokenCount: tokenCount || 0,
          provider: provider || 'unknown',
        }
        cacheRecords.push(record)
        if (cacheRecords.length > 500) {
          cacheRecords.splice(0, cacheRecords.length - 500)
        }
        return NextResponse.json({ success: true, record })
      }

      case 'record-abbreviation': {
        // Record tool abbreviation stats
        const { toolName, tokensSaved } = body
        if (!toolName) {
          return NextResponse.json(
            { error: 'toolName is required' },
            { status: 400 },
          )
        }
        abbreviationStats.totalAbbreviated++
        abbreviationStats.totalTokensSaved += tokensSaved || 0
        if (!abbreviationStats.byTool[toolName]) {
          abbreviationStats.byTool[toolName] = { count: 0, tokensSaved: 0 }
        }
        abbreviationStats.byTool[toolName].count++
        abbreviationStats.byTool[toolName].tokensSaved += tokensSaved || 0
        return NextResponse.json({ success: true, stats: abbreviationStats })
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 },
        )
    }
  } catch (error) {
    console.error('[Context API] POST error:', error)
    return NextResponse.json(
      { error: 'Failed to process context action' },
      { status: 500 },
    )
  }
}
