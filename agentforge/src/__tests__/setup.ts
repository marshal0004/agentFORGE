/**
 * Global test setup for vitest
 * Runs before each test suite
 */

// v1.2: Add jest-dom custom matchers for React component tests
// (toBeInTheDocument, toBeVisible, etc.). Safe to import unconditionally —
// @testing-library/jest-dom is a dev dependency.
import '@testing-library/jest-dom'

// Suppress console.error during tests (route handlers log errors)
const originalConsoleError = console.error
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    // Only suppress known route handler error logs
    const msg = String(args[0] || '')
    if (
      msg.includes('Failed to fetch') ||
      msg.includes('Failed to create') ||
      msg.includes('Failed to update') ||
      msg.includes('Failed to delete') ||
      msg.includes('Files API') ||
      msg.includes('Terminal API') ||
      msg.includes('Execution error')
    ) {
      return
    }
    originalConsoleError(...args)
  }
})

afterAll(() => {
  console.error = originalConsoleError
})
