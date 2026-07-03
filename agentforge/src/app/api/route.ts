import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  const startTime = Date.now()

  try {
    // Check database connectivity
    await db.$queryRaw`SELECT 1`

    return NextResponse.json({
      status: 'healthy',
      service: 'agentforge',
      version: '0.2.0',
      database: 'connected',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      responseTime: `${Date.now() - startTime}ms`,
    })
  } catch (error) {
    return NextResponse.json({
      status: 'unhealthy',
      service: 'agentforge',
      version: '0.2.0',
      database: 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown database error',
      timestamp: new Date().toISOString(),
      responseTime: `${Date.now() - startTime}ms`,
    }, { status: 503 })
  }
}