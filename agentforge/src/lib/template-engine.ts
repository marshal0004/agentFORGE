/**
 * Template Engine — Opinionated project templates system
 *
 * Provides project templates that agents start from, similar to Chef's
 * Vite+React+Convex template. Each template includes:
 *
 *   - Complete file contents for the project scaffold
 *   - Locked files that the agent cannot modify
 *   - Prewarmed files always injected into context
 *   - Dependencies and scripts for package.json
 *   - A system prompt addition with template-specific guidelines
 *
 * The engine supports variable interpolation (e.g., {{projectName}}) so that
 * a single template can be instantiated with different project names, authors,
 * and other parameters.
 *
 * Integration points:
 *   - `./event-bus` for typed event emission
 *   - `./filesystem` for project file I/O
 */

import { agentEventBus } from './event-bus'
import { writeProjectFile, writeProjectFiles } from './filesystem'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ProjectTemplate {
  id: string
  name: string
  description: string
  category: 'web-app' | 'api' | 'fullstack' | 'static' | 'cli'
  files: Array<{ path: string; content: string }>
  lockedFiles: string[]           // Files the agent cannot modify
  prewarmedFiles: string[]        // Files always injected into context
  dependencies: Record<string, string>  // package.json dependencies
  scripts: Record<string, string>       // package.json scripts
  systemPromptAddition?: string  // Extra system prompt for this template
}

// ── Template Engine ────────────────────────────────────────────────────────────

export class TemplateEngine {
  private templates: Map<string, ProjectTemplate>

  constructor() {
    this.templates = new Map()

    // Register built-in templates
    this.registerTemplate(REACT_TAILWIND_TEMPLATE)
    this.registerTemplate(FULLSTACK_NEXTJS_TEMPLATE)
    this.registerTemplate(API_EXPRESS_TEMPLATE)
  }

  /**
   * Register a new template.
   * If a template with the same ID already exists, it will be overwritten.
   */
  registerTemplate(template: ProjectTemplate): void {
    this.templates.set(template.id, template)
  }

  /**
   * Get a template by ID.
   */
  getTemplate(id: string): ProjectTemplate | undefined {
    return this.templates.get(id)
  }

  /**
   * List all available templates with summary information.
   */
  listTemplates(): Array<{ id: string; name: string; category: string; description: string }> {
    return Array.from(this.templates.values()).map((t) => ({
      id: t.id,
      name: t.name,
      category: t.category,
      description: t.description,
    }))
  }

  /**
   * Create a project from a template.
   *
   * Steps:
   *   1. Look up the template by ID
   *   2. Interpolate variables into file contents
   *   3. Write all template files to the project workspace
   *   4. Generate and write a package.json from template deps/scripts
   *   5. Emit events for observability
   *
   * @param templateId - The template to instantiate
   * @param projectId - The project identifier (used for filesystem operations)
   * @param projectName - The human-readable project name
   * @param variables - Optional key-value pairs for template interpolation
   */
  async createProject(
    templateId: string,
    projectId: string,
    projectName: string,
    variables?: Record<string, string>,
  ): Promise<{ filesWritten: number; errors: string[] }> {
    const template = this.templates.get(templateId)
    if (!template) {
      return { filesWritten: 0, errors: [`Template not found: ${templateId}`] }
    }

    const errors: string[] = []
    let filesWritten = 0

    // Merge default variables with provided ones
    const allVars: Record<string, string> = {
      projectName,
      projectId,
      projectSlug: this.slugify(projectName),
      timestamp: new Date().toISOString(),
      year: new Date().getFullYear().toString(),
      ...variables,
    }

    // Interpolate variables into file contents
    const interpolatedFiles = template.files.map((file) => ({
      path: this.interpolate(file.path, allVars),
      content: this.interpolate(file.content, allVars),
    }))

    // Write template files
    try {
      const result = await writeProjectFiles(projectId, interpolatedFiles)
      filesWritten += result.written

      for (const err of result.errors) {
        errors.push(`Failed to write ${err.path}: ${err.error}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      errors.push(`Failed to write template files: ${msg}`)
    }

    // Generate and write package.json
    try {
      const packageJson = this.generatePackageJson(template, allVars)
      await writeProjectFile(projectId, 'package.json', packageJson)
      filesWritten++
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      errors.push(`Failed to write package.json: ${msg}`)
    }

    // Generate and write tsconfig.json
    try {
      const tsconfig = this.generateTsConfig(template)
      await writeProjectFile(projectId, 'tsconfig.json', tsconfig)
      filesWritten++
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      errors.push(`Failed to write tsconfig.json: ${msg}`)
    }

    // Emit event
    agentEventBus.emit('agent:start', {
      sessionId: `template-${templateId}`,
      projectId,
      model: 'template-engine',
    })

    return { filesWritten, errors }
  }

  /**
   * Get the system prompt addition for a template.
   * Returns an empty string if the template doesn't exist or has no addition.
   */
  getSystemPromptAddition(templateId: string): string {
    const template = this.templates.get(templateId)
    return template?.systemPromptAddition || ''
  }

  /**
   * Get the list of locked files for a template.
   */
  getLockedFiles(templateId: string): string[] {
    const template = this.templates.get(templateId)
    return template?.lockedFiles || []
  }

  /**
   * Get the list of prewarmed files for a template.
   * These files should always be included in the agent's context.
   */
  getPrewarmedFiles(templateId: string): string[] {
    const template = this.templates.get(templateId)
    return template?.prewarmedFiles || []
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Interpolate {{variable}} placeholders in a string.
   */
  private interpolate(text: string, variables: Record<string, string>): string {
    return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
      return variables[key] !== undefined ? variables[key] : match
    })
  }

  /**
   * Generate a URL-safe slug from a project name.
   */
  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  }

  /**
   * Generate a package.json string from template dependencies and scripts.
   */
  private generatePackageJson(template: ProjectTemplate, variables: Record<string, string>): string {
    const pkg = {
      name: variables.projectSlug || variables.projectName.toLowerCase().replace(/\s+/g, '-'),
      version: '0.1.0',
      private: true,
      scripts: {
        dev: 'next dev',
        build: 'next build',
        start: 'next start',
        lint: 'eslint .',
        ...template.scripts,
      },
      dependencies: {
        ...template.dependencies,
      },
    }

    return JSON.stringify(pkg, null, 2) + '\n'
  }

  /**
   * Generate a tsconfig.json appropriate for the template category.
   */
  private generateTsConfig(template: ProjectTemplate): string {
    const baseConfig = {
      compilerOptions: {
        target: 'ES2017',
        lib: ['dom', 'dom.iterable', 'esnext'],
        allowJs: true,
        skipLibCheck: true,
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        module: 'esnext',
        moduleResolution: 'bundler',
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: 'react-jsx',
        incremental: true,
        plugins: [{ name: 'next' }],
        paths: { '@/*': ['./src/*'] },
      },
      include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts', '.next/dev/types/**/*.ts'],
      exclude: ['node_modules'],
    }

    return JSON.stringify(baseConfig, null, 2) + '\n'
  }
}

// ── Built-in Templates ─────────────────────────────────────────────────────────

export const REACT_TAILWIND_TEMPLATE: ProjectTemplate = {
  id: 'react-tailwind',
  name: 'React + Tailwind CSS',
  description: 'A lightweight client-side React app with Tailwind CSS for styling. Perfect for SPAs and static sites.',
  category: 'web-app',
  lockedFiles: ['vite.config.ts', 'postcss.config.js', 'tailwind.config.js'],
  prewarmedFiles: ['src/App.tsx', 'src/main.tsx'],
  dependencies: {
    'react': '^19.0.0',
    'react-dom': '^19.0.0',
    'tailwindcss': '^4',
    '@tailwindcss/postcss': '^4',
    'clsx': '^2.1.1',
    'tailwind-merge': '^3.3.1',
    'lucide-react': '^0.525.0',
  },
  scripts: {
    dev: 'vite',
    build: 'vite build',
    preview: 'vite preview',
  },
  systemPromptAddition: `You are working with a React + Tailwind CSS project scaffolded with Vite. Follow these conventions:

STRUCTURE: Components live in src/components/. Pages/views in src/pages/. Hooks in src/hooks/. Utilities in src/lib/. The entry point is src/main.tsx which renders src/App.tsx.

COMPONENTS: Use functional components with explicit TypeScript interfaces for props. Keep components focused on a single responsibility. Extract reusable logic into custom hooks. Use React.memo for expensive renders. Handle loading, error, and empty states in every data-fetching component.

STYLING: Use Tailwind CSS utility classes exclusively. Follow mobile-first responsive design (base → sm → md → lg → xl). Use clsx or tailwind-merge for conditional classes. Apply consistent spacing with p-4/p-6 for padding, gap-4/gap-6 for flex/grid gaps.

STATE: Use useState for local component state. Use useReducer for complex state. Create custom hooks for shared stateful logic. For global state, use Zustand. For server state, use TanStack Query.

ROUTING: Use react-router-dom for client-side routing. Define routes in a central routes configuration. Use lazy loading for route components with React.lazy and Suspense.

DO NOT modify vite.config.ts, postcss.config.js, or tailwind.config.js unless explicitly asked.`,

  files: [
    {
      path: 'src/main.tsx',
      content: `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
`,
    },
    {
      path: 'src/index.css',
      content: `@import "tailwindcss";

:root {
  --foreground: #171717;
  --background: #ffffff;
}

@media (prefers-color-scheme: dark) {
  :root {
    --foreground: #ededed;
    --background: #0a0a0a;
  }
}

body {
  color: var(--foreground);
  background: var(--background);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
`,
    },
    {
      path: 'src/App.tsx',
      content: `import { useState } from 'react'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground">
      <header className="text-center mb-8">
        <h1 className="text-4xl font-bold mb-2">{{projectName}}</h1>
        <p className="text-muted-foreground">React + Tailwind CSS</p>
      </header>

      <main className="flex flex-col items-center gap-6">
        <div className="bg-card border rounded-xl p-8 shadow-sm">
          <button
            onClick={() => setCount((c) => c + 1)}
            className="bg-primary text-primary-foreground px-6 py-3 rounded-lg font-medium hover:opacity-90 transition-opacity"
          >
            Count: {count}
          </button>
        </div>

        <p className="text-sm text-muted-foreground">
          Edit <code className="bg-muted px-1.5 py-0.5 rounded text-xs">src/App.tsx</code> and save to test HMR
        </p>
      </main>
    </div>
  )
}

export default App
`,
    },
    {
      path: 'src/lib/utils.ts',
      content: `import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
`,
    },
    {
      path: 'index.html',
      content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{{projectName}}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
    },
    {
      path: 'vite.config.ts',
      content: `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
`,
    },
    {
      path: 'postcss.config.js',
      content: `export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
`,
    },
    {
      path: '.gitignore',
      content: `node_modules
dist
.env
.env.local
*.local
.DS_Store
`,
    },
  ],
}

export const FULLSTACK_NEXTJS_TEMPLATE: ProjectTemplate = {
  id: 'fullstack-nextjs',
  name: 'Fullstack Next.js',
  description: 'A complete fullstack application with Next.js 16 App Router, Prisma ORM, shadcn/ui components, and Tailwind CSS. Best for production web applications.',
  category: 'fullstack',
  lockedFiles: [
    'next.config.ts',
    'postcss.config.mjs',
    'tailwind.config.ts',
    'prisma/schema.prisma',
  ],
  prewarmedFiles: [
    'src/app/page.tsx',
    'src/app/layout.tsx',
    'src/lib/db.ts',
    'prisma/schema.prisma',
  ],
  dependencies: {
    'next': '^16.1.1',
    'react': '^19.0.0',
    'react-dom': '^19.0.0',
    '@prisma/client': '^6.11.1',
    'next-auth': '^4.24.11',
    'next-themes': '^0.4.6',
    'zod': '^4.0.2',
    'zustand': '^5.0.6',
    '@tanstack/react-query': '^5.82.0',
    'class-variance-authority': '^0.7.1',
    'clsx': '^2.1.1',
    'tailwind-merge': '^3.3.1',
    'lucide-react': '^0.525.0',
    'tailwindcss-animate': '^1.0.7',
    'sonner': '^2.0.6',
    'uuid': '^11.1.0',
  },
  scripts: {
    dev: 'next dev -p 3000',
    build: 'next build',
    start: 'next start',
    lint: 'eslint .',
    'db:push': 'prisma db push',
    'db:generate': 'prisma generate',
    'db:migrate': 'prisma migrate dev',
    'db:reset': 'prisma migrate reset',
  },
  systemPromptAddition: `You are working with a fullstack Next.js 16 project. Follow these conventions strictly:

ROUTING: Use the App Router (src/app/). Pages are page.tsx, layouts are layout.tsx, loading states are loading.tsx, error boundaries are error.tsx. API routes go in src/app/api/[route]/route.ts with named GET/POST/PUT/DELETE exports.

COMPONENTS: Place UI primitives in src/components/ui/. Feature components in src/components/. Use 'use client' only when the component uses hooks or browser APIs. Server components are the default.

STYLING: Use Tailwind CSS 4 with shadcn/ui components (New York style). Use cn() utility from src/lib/utils.ts for conditional classes. Follow mobile-first responsive design.

DATABASE: Prisma ORM with SQLite. Schema in prisma/schema.prisma. Import { db } from '@/lib/db'. Use bun run db:push to sync schema changes. Never create new PrismaClient instances.

STATE: Zustand for client-side global state. TanStack Query for server state. useState for local component state.

AUTH: NextAuth.js v4 is available. Configure in src/app/api/auth/[...nextauth]/route.ts.

DO NOT modify next.config.ts, tailwind.config.ts, or prisma/schema.prisma unless explicitly asked. When modifying the database schema, always run bun run db:push after changes.`,

  files: [
    {
      path: 'src/app/layout.tsx',
      content: `import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: '{{projectName}}',
  description: 'Built with AgentForge',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>{children}</body>
    </html>
  )
}
`,
    },
    {
      path: 'src/app/globals.css',
      content: `@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  --radius: 0.625rem;
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.985 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.269 0 0);
  --input: oklch(0.269 0 0);
  --ring: oklch(0.439 0 0);
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
`,
    },
    {
      path: 'src/app/page.tsx',
      content: `export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl mx-auto text-center">
        <h1 className="text-4xl font-bold mb-4">{{projectName}}</h1>
        <p className="text-lg text-muted-foreground mb-8">
          Built with Next.js, Prisma, and shadcn/ui
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <h2 className="text-lg font-semibold mb-2">App Router</h2>
            <p className="text-sm text-muted-foreground">
              Next.js 16 with server components, streaming, and partial prerendering.
            </p>
          </div>
          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <h2 className="text-lg font-semibold mb-2">Database</h2>
            <p className="text-sm text-muted-foreground">
              Prisma ORM with SQLite for data persistence and type-safe queries.
            </p>
          </div>
          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <h2 className="text-lg font-semibold mb-2">UI Components</h2>
            <p className="text-sm text-muted-foreground">
              shadcn/ui with Tailwind CSS for beautiful, accessible components.
            </p>
          </div>
          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <h2 className="text-lg font-semibold mb-2">Authentication</h2>
            <p className="text-sm text-muted-foreground">
              NextAuth.js v4 ready for OAuth, credentials, and session management.
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}
`,
    },
    {
      path: 'src/lib/utils.ts',
      content: `import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
`,
    },
    {
      path: 'src/lib/db.ts',
      content: `import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
`,
    },
    {
      path: 'prisma/schema.prisma',
      content: `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
`,
    },
    {
      path: 'next.config.ts',
      content: `import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
}

export default nextConfig
`,
    },
    {
      path: 'postcss.config.mjs',
      content: `/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}

export default config
`,
    },
    {
      path: '.env',
      content: `DATABASE_URL="file:./dev.db"
NEXTAUTH_SECRET="change-me-in-production"
NEXTAUTH_URL="http://localhost:3000"
`,
    },
    {
      path: '.gitignore',
      content: `node_modules
.next
.env
.env.local
*.local
.DS_Store
prisma/dev.db
prisma/*.db
`,
    },
    {
      path: 'src/app/api/health/route.ts',
      content: `import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: '{{projectName}}',
  })
}
`,
    },
  ],
}

export const API_EXPRESS_TEMPLATE: ProjectTemplate = {
  id: 'api-express',
  name: 'Express API',
  description: 'A RESTful API server with Express.js, TypeScript, Prisma ORM, and Zod validation. Ideal for building backend services and APIs.',
  category: 'api',
  lockedFiles: ['prisma/schema.prisma', 'tsconfig.json'],
  prewarmedFiles: ['src/index.ts', 'src/routes/index.ts', 'src/middleware/errorHandler.ts', 'prisma/schema.prisma'],
  dependencies: {
    'express': '^4.21.0',
    '@prisma/client': '^6.11.1',
    'zod': '^4.0.2',
    'cors': '^2.8.5',
    'helmet': '^8.0.0',
    'morgan': '^1.10.0',
    'uuid': '^11.1.0',
    'dotenv': '^16.4.0',
  },
  scripts: {
    dev: 'tsx watch src/index.ts',
    build: 'tsc',
    start: 'node dist/index.js',
    'db:push': 'prisma db push',
    'db:generate': 'prisma generate',
    'db:migrate': 'prisma migrate dev',
  },
  systemPromptAddition: `You are working with an Express.js API project. Follow these conventions strictly:

STRUCTURE: Entry point is src/index.ts. Routes live in src/routes/. Middleware in src/middleware/. Utilities in src/lib/. Types in src/types/. The Prisma client is imported from src/lib/db.ts.

ROUTING: Define routes in dedicated files under src/routes/. Each route file exports an Express Router. Register routers in src/index.ts with appropriate path prefixes. Use proper HTTP methods: GET for reads, POST for creates, PUT for full updates, PATCH for partial updates, DELETE for removals.

VALIDATION: Validate all request bodies with Zod schemas. Define schemas alongside route files or in a src/schemas/ directory. Return 400 with validation error details for invalid input.

ERROR HANDLING: Use a centralized error handler middleware. Never expose internal errors to clients. Return consistent error shapes: { error: { code: string, message: string, details?: unknown } }. Handle Prisma-specific errors (P2002 unique constraint, P2025 not found) with appropriate HTTP status codes.

RESPONSE FORMAT: Return consistent shapes: { data: T } for single items, { data: T[], meta: { page, limit, total } } for lists. Use proper status codes: 200, 201, 204, 400, 401, 403, 404, 409, 422, 500.

SECURITY: Use helmet for security headers. Use cors for cross-origin requests. Implement rate limiting. Validate and sanitize all user input. Use environment variables for secrets.

DO NOT modify prisma/schema.prisma unless explicitly asked. When modifying the database schema, always run bun run db:push after changes.`,

  files: [
    {
      path: 'src/index.ts',
      content: `import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import { errorHandler } from './middleware/errorHandler'
import { healthRouter } from './routes/health'
import { apiRouter } from './routes/index'

const app = express()
const PORT = process.env.PORT || 3001

// Middleware
app.use(helmet())
app.use(cors())
app.use(morgan('dev'))
app.use(express.json({ limit: '10mb' }))

// Routes
app.use('/health', healthRouter)
app.use('/api', apiRouter)

// Error handler (must be last)
app.use(errorHandler)

app.listen(PORT, () => {
  console.log(\`🚀 {{projectName}} API running on http://localhost:\${PORT}\`)
})

export default app
`,
    },
    {
      path: 'src/lib/db.ts',
      content: `import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
`,
    },
    {
      path: 'src/middleware/errorHandler.ts',
      content: `import type { Request, Response, NextFunction } from 'express'

interface AppError extends Error {
  statusCode?: number
  code?: string
}

export function errorHandler(
  err: AppError,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  const statusCode = err.statusCode || 500
  const message = statusCode === 500 ? 'Internal server error' : err.message

  // Log internal errors for debugging
  if (statusCode === 500) {
    console.error('[Error]', err)
  }

  // Handle Prisma errors
  if (err.code === 'P2002') {
    return res.status(409).json({
      error: {
        code: 'CONFLICT',
        message: 'A record with this data already exists',
      },
    })
  }

  if (err.code === 'P2025') {
    return res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Record not found',
      },
    })
  }

  return res.status(statusCode).json({
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message,
    },
  })
}
`,
    },
    {
      path: 'src/middleware/validate.ts',
      content: `import type { Request, Response, NextFunction } from 'express'
import { ZodSchema, ZodError } from 'zod'

export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = schema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body',
            details: result.error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
          },
        })
      }
      req.body = result.data
      next()
    } catch (err) {
      next(err)
    }
  }
}
`,
    },
    {
      path: 'src/routes/health.ts',
      content: `import { Router } from 'express'

export const healthRouter = Router()

healthRouter.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: '{{projectName}}',
  })
})
`,
    },
    {
      path: 'src/routes/index.ts',
      content: `import { Router } from 'express'

export const apiRouter = Router()

apiRouter.get('/', (_req, res) => {
  res.json({
    message: '{{projectName}} API',
    version: '0.1.0',
    endpoints: {
      health: '/health',
      api: '/api',
    },
  })
})

// Add your route modules here:
// apiRouter.use('/users', userRouter)
// apiRouter.use('/projects', projectRouter)
`,
    },
    {
      path: 'prisma/schema.prisma',
      content: `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
`,
    },
    {
      path: '.env',
      content: `DATABASE_URL="file:./dev.db"
PORT=3001
NODE_ENV=development
`,
    },
    {
      path: '.gitignore',
      content: `node_modules
dist
.env
.env.local
*.local
.DS_Store
prisma/dev.db
prisma/*.db
`,
    },
  ],
}

// ── Singleton ──────────────────────────────────────────────────────────────────

export const templateEngine = new TemplateEngine()
