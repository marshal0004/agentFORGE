import { NextRequest } from 'next/server'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRequestInit = any

/**
 * Create a NextRequest object for testing API route handlers.
 * @param url - The URL path (e.g., '/api/projects')
 * @param options - RequestInit options (method, headers, body, etc.)
 */
export function createRequest(url: string, options?: AnyRequestInit): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), options)
}

/**
 * Create a NextRequest with a JSON body for testing API route handlers.
 * @param url - The URL path (e.g., '/api/projects')
 * @param body - The request body (will be JSON-stringified)
 * @param method - HTTP method (default: 'POST')
 */
export function createJsonRequest(url: string, body: unknown, method = 'POST'): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * Parse the JSON response from an API route handler.
 * @param response - The NextResponse object returned by the handler
 */
export async function parseResponse<T = Record<string, unknown>>(response: Response): Promise<{ data: T; status: number }> {
  const data = await response.json() as T
  return { data, status: response.status }
}
