import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    // v1.2: Keep `node` as the default environment for the existing lib
    // tests (they don't need DOM). React component tests (.tsx) opt into
    // jsdom via a `// @vitest-environment jsdom` pragma at the top of the
    // file. This avoids the 4-test regression caused by switching the
    // global default to jsdom.
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts', 'src/__tests__/**/*.test.tsx'],
    setupFiles: ['./src/__tests__/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
