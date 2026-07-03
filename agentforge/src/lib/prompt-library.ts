/**
 * Prompt Library — Domain-specific prompt libraries for LLM context
 *
 * Bakes domain expertise directly into system prompts, inspired by Chef's
 * 37KB Convex guidelines. Each library contains real, production-grade
 * knowledge about a specific technology domain.
 *
 * The PromptLibraryManager:
 *   - Stores and retrieves prompt libraries by ID
 *   - Scores libraries for relevance against a task description
 *   - Composes a system prompt that fits within a token budget
 *   - Supports provider-specific caching markers (Anthropic, OpenAI)
 *
 * Integration points:
 *   - `./event-bus` for typed event emission
 *   - `./context-manager` for token estimation utilities
 */

import { agentEventBus } from './event-bus'
import { estimateTokens } from './context-manager'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PromptLibrary {
  id: string
  name: string
  domain: string           // e.g. "nextjs", "react", "typescript", "database"
  content: string          // The actual prompt content
  tokenEstimate: number    // Approximate token count
  priority: number         // Lower = more important, included first
}

export interface ComposedPrompt {
  systemPrompt: string
  includedLibraries: string[]
  estimatedTokens: number
}

// ── PromptLibraryManager ───────────────────────────────────────────────────────

export class PromptLibraryManager {
  private libraries: Map<string, PromptLibrary>

  constructor() {
    this.libraries = new Map()

    // Register built-in libraries
    this.registerLibrary(NEXTJS_LIBRARY)
    this.registerLibrary(TYPESCRIPT_LIBRARY)
    this.registerLibrary(TAILWIND_LIBRARY)
    this.registerLibrary(PRISMA_LIBRARY)
    this.registerLibrary(REACT_PATTERNS_LIBRARY)
  }

  /**
   * Register a prompt library.
   * Overwrites any existing library with the same ID.
   */
  registerLibrary(library: PromptLibrary): void {
    this.libraries.set(library.id, library)
  }

  /**
   * Unregister a prompt library by ID.
   */
  unregisterLibrary(id: string): void {
    this.libraries.delete(id)
  }

  /**
   * Get a specific library by ID.
   */
  getLibrary(id: string): PromptLibrary | undefined {
    return this.libraries.get(id)
  }

  /**
   * Get all registered libraries.
   */
  getAllLibraries(): PromptLibrary[] {
    return Array.from(this.libraries.values())
  }

  /**
   * Get libraries relevant to a task description.
   *
   * Relevance is determined by keyword matching and domain overlap.
   * Libraries are sorted by relevance score (descending), then by
   * priority (ascending) as a tiebreaker.
   *
   * @param taskDescription - The user's task or project description
   * @param maxTokens - Maximum total tokens to include
   */
  getRelevantLibraries(taskDescription: string, maxTokens: number): PromptLibrary[] {
    const scored = this.scoreLibraries(taskDescription)

    // Sort by relevance (desc), then priority (asc)
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.library.priority - b.library.priority
    })

    // Fill budget
    const result: PromptLibrary[] = []
    let remainingTokens = maxTokens

    // v1.2: Only include libraries with score > 0. The previous behavior
    // included score-0 libraries when NO libraries were relevant, which
    // bloats the system prompt with irrelevant content. A score of 0
    // means the task description has zero keyword/domain overlap with
    // the library — including it would be pure noise.
    for (const { library, score } of scored) {
      if (score === 0) continue
      if (library.tokenEstimate <= remainingTokens) {
        result.push(library)
        remainingTokens -= library.tokenEstimate
      }
    }

    return result
  }

  /**
   * Build a composed system prompt with relevant libraries.
   *
   * The prompt structure:
   *   1. Base prompt (always included)
   *   2. Relevant domain libraries (ordered by relevance and priority)
   *   3. Caching markers for supported providers (optional)
   *
   * @param basePrompt - The base system prompt
   * @param taskDescription - The user's task or project description
   * @param maxTokens - Maximum total tokens for the composed prompt
   * @param options - Optional configuration for caching markers and provider
   */
  buildSystemPrompt(
    basePrompt: string,
    taskDescription: string,
    maxTokens: number,
    options?: { includeCachingMarkers?: boolean; provider?: string },
  ): ComposedPrompt {
    const includeCachingMarkers = options?.includeCachingMarkers ?? false
    const provider = options?.provider ?? ''

    const baseTokens = estimateTokens(basePrompt)
    const libraryBudget = maxTokens - baseTokens

    if (libraryBudget <= 0) {
      return {
        systemPrompt: basePrompt,
        includedLibraries: [],
        estimatedTokens: baseTokens,
      }
    }

    const relevantLibs = this.getRelevantLibraries(taskDescription, libraryBudget)
    const includedLibraries: string[] = []

    const sections: string[] = []

    // Optional opening cache marker (Anthropic)
    if (includeCachingMarkers && (provider === 'anthropic' || provider.includes('claude'))) {
      sections.push('<system_cache>')
    }

    sections.push(basePrompt)

    for (const lib of relevantLibs) {
      includedLibraries.push(lib.id)
      sections.push(`\n--- ${lib.name} Guidelines ---\n\n${lib.content}`)
    }

    // Optional closing cache marker
    if (includeCachingMarkers && (provider === 'anthropic' || provider.includes('claude'))) {
      sections.push('</system_cache>')
    }

    // OpenAI-style system message marker
    if (includeCachingMarkers && (provider === 'openai' || provider.includes('gpt'))) {
      // OpenAI doesn't have native caching markers, but we can add a comment
      sections.push('\n<!-- system_prompt_end -->')
    }

    const systemPrompt = sections.join('\n')
    const estimatedTokens = estimateTokens(systemPrompt)

    return {
      systemPrompt,
      includedLibraries,
      estimatedTokens,
    }
  }

  /**
   * Score each library for relevance to the task description.
   *
   * Scoring strategy:
   *   - Direct domain name match in task: +10
   *   - Domain keywords found in task: +3 per keyword
   *   - Content keyword overlap: +1 per unique match
   *   - Priority bonus (lower priority number = higher base relevance): +2 for priority <= 5
   */
  private scoreLibraries(taskDescription: string): Array<{ library: PromptLibrary; score: number }> {
    const taskLower = taskDescription.toLowerCase()

    return Array.from(this.libraries.values()).map((library) => {
      let score = 0

      // Direct domain match
      if (taskLower.includes(library.domain.toLowerCase())) {
        score += 10
      }

      // Domain alias matching
      const aliases = this.getDomainAliases(library.domain)
      for (const alias of aliases) {
        if (taskLower.includes(alias.toLowerCase())) {
          score += 8
        }
      }

      // Keyword matching from the library content
      const keywords = this.extractKeywords(library.content)
      for (const keyword of keywords) {
        if (taskLower.includes(keyword.toLowerCase())) {
          score += 2
        }
      }

      // v1.2: Removed the unconditional "priority bonus" that added +2 to
      // every library with priority <= 5 (which was all of them). That
      // bonus defeated the purpose of relevance scoring — it guaranteed
      // every library had score > 0, so the getRelevantLibraries filter
      // never excluded anything. Priority is now used only as a sort
      // tiebreaker when relevance scores are equal.

      return { library, score }
    })
  }

  /**
   * Get alias terms for a domain.
   */
  private getDomainAliases(domain: string): string[] {
    const aliasMap: Record<string, string[]> = {
      'nextjs': ['next.js', 'next js', 'app router', 'vercel'],
      'react': ['react.js', 'react js', 'jsx', 'tsx', 'component'],
      'typescript': ['ts', 'typed', 'type safety', 'type system'],
      'tailwind': ['tailwindcss', 'tailwind css', 'utility classes', 'css framework'],
      'prisma': ['orm', 'database', 'sql', 'sqlite', 'postgresql', 'mysql', 'schema'],
    }
    return aliasMap[domain] || []
  }

  /**
   * Extract significant keywords from library content.
   * Returns unique, lowercased terms that are 4+ characters.
   */
  private extractKeywords(content: string): string[] {
    const words = content.toLowerCase().match(/\b[a-z]{4,}\b/g) || []
    const unique = new Set(words)

    // Filter out common stop words
    const stopWords = new Set([
      'that', 'this', 'with', 'from', 'have', 'been', 'were', 'will',
      'would', 'could', 'should', 'their', 'there', 'about', 'which',
      'when', 'what', 'your', 'using', 'these', 'those', 'other', 'than',
      'also', 'some', 'more', 'most', 'such', 'only', 'just', 'like',
      'then', 'into', 'over', 'after', 'before', 'between', 'through',
      'during', 'without', 'within', 'along', 'following', 'across',
    ])

    return Array.from(unique).filter((w) => !stopWords.has(w))
  }
}

// ── Built-in Domain Prompt Libraries ───────────────────────────────────────────

export const NEXTJS_LIBRARY: PromptLibrary = {
  id: 'nextjs',
  name: 'Next.js App Router',
  domain: 'nextjs',
  priority: 1,
  tokenEstimate: 2000,
  content: `Next.js 16 App Router — Production Guidelines

ROUTING ARCHITECTURE:
The App Router uses a file-system based routing approach. Every folder in src/app/ represents a route segment. The special files within each folder are:
- page.tsx — The UI for the route (unique to a route)
- layout.tsx — Shared layout that wraps child routes (persists across navigation)
- loading.tsx — Suspense boundary shown while the page loads
- error.tsx — Error boundary for the route segment
- not-found.tsx — 404 UI for the route segment
- template.tsx — Like layout but re-renders on navigation (does not persist state)
- default.tsx — Fallback for parallel routes

Route groups use parentheses: (dashboard)/page.tsx creates a logical group without adding a URL segment.
Parallel routes use @-prefixed slots: @analytics/page.tsx enables simultaneous rendering.
Intercepting routes use (.)path to intercept same-level, (..)path for one level up.

SERVER VS CLIENT COMPONENTS:
Server Components (default): Cannot use useState, useEffect, event handlers, or browser APIs. Can directly access databases, read files, use environment variables (without NEXT_PUBLIC_ prefix). They render on the server and send HTML to the client.

Client Components (use 'use client'): Required for interactivity. Can use hooks, event handlers, browser APIs. Cannot directly access databases or filesystem. They hydrate on the client.

Rules:
1. Default to Server Components. Only add 'use client' when needed.
2. Server Components can import and render Client Components.
3. Client Components CANNOT import Server Components directly. Pass Server Components as children props.
4. Use 'use server' for Server Actions — functions that run on the server but can be called from client components.

DATA FETCHING:
In Server Components, fetch data directly using async/await. Next.js extends fetch with caching and revalidation:
- cache: 'force-cache' — Cache the response (default for non-dynamic routes)
- cache: 'no-store' — Always refetch (default for dynamic routes)
- next: { revalidate: 60 } — Revalidate every 60 seconds (ISR)

Dynamic routes: Use the params prop. Access dynamic segments via params.slug.
Route handlers: Define GET, POST, PUT, PATCH, DELETE exports in route.ts files.
Return NextResponse.json() for JSON, new Response() for streaming.

SERVER ACTIONS:
Use 'use server' directive at the top of a file or before a function. Server Actions accept FormData or serializable arguments. Always validate inputs with Zod. Return serializable data. Never expose secrets. Use revalidatePath() or revalidateTag() to refresh cached data after mutations.

MIDDLEWARE:
Create middleware.ts at the project root. Runs before every request. Use for auth checks, redirects, and request rewriting. Return NextResponse.next() to continue, NextResponse.redirect() to redirect. Use the matcher config to limit which routes trigger middleware.

PERFORMANCE:
Use Suspense boundaries for streaming. Implement loading.tsx at every route level. Use Next.js Image for optimized images (automatic srcset, lazy loading, WebP). Use dynamic imports: const Component = dynamic(() => import('./Component')). Implement proper caching with fetch options and revalidation. Use generateStaticParams for static generation of dynamic routes.

DEPLOYMENT:
Set output: 'standalone' in next.config for Docker/containers. Use next build && next start for production. Environment variables: NEXT_PUBLIC_ prefix for client-side, server-only for backend. Use Vercel for zero-config deployment with automatic edge functions.`,
}

export const TYPESCRIPT_LIBRARY: PromptLibrary = {
  id: 'typescript',
  name: 'TypeScript Best Practices',
  domain: 'typescript',
  priority: 2,
  tokenEstimate: 2000,
  content: `TypeScript 5 — Production Best Practices

TYPE SYSTEM FUNDAMENTALS:
Always prefer interfaces for object shapes and type aliases for unions, intersections, and utility types. Use 'interface' for objects that may be extended or merged; use 'type' for unions, tuples, mapped types, and conditional types. Never use 'any' — use 'unknown' when the type is truly not known at compile time, then narrow with type guards.

EXACT TYPES AND EXCESS PROPERTY CHECKING:
Interfaces perform excess property checking when assigning object literals directly. Use 'satisfies' operator to validate a value matches a type while preserving its narrower inferred type: const config = { port: 3000 } satisfies Config. This gives you both type safety and precise autocompletion.

GENERICS:
Use generics when a function or class needs to work with multiple types while preserving type information. Name type parameters descriptively: TItem, TResult, TInput — avoid single-letter names except for simple cases. Constrain generics with 'extends' when possible: function process<T extends HasId>(item: T). Use default type parameters: interface PaginatedResponse<T, Meta = PaginationMeta>.

DISCRIMINATED UNIONS:
Use discriminated unions for state machines and tagged variants. Each variant has a literal 'type' or 'status' field that TypeScript can narrow on. Always handle every case in switch statements — use the 'never' type for exhaustive checking.

TYPE NARROWING:
Use type guards for runtime checks that TypeScript can reason about: typeof, instanceof, 'in' operator, Array.isArray(), and custom type guard functions with 'is' return type. Prefer 'in' operator for checking object properties: if ('email' in user). Use the 'satisfies' operator instead of type annotation when you want to preserve narrower types.

ERROR HANDLING:
Define typed error classes that extend Error. Use Result<T, E> pattern for operations that can fail without throwing: type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E }. Use unknown for caught errors and narrow with instanceof: catch (err) { if (err instanceof NotFoundError) ... }.

UTILITY TYPES:
Master built-in utility types: Partial<T>, Required<T>, Readonly<T>, Record<K,V>, Pick<T,K>, Omit<T,K>, Exclude<U,E>, Extract<U,E>, NonNullable<T>, ReturnType<T>, Parameters<T>, Awaited<T>. Combine them for complex transformations: type UpdateDTO<T> = Partial<Omit<T, 'id' | 'createdAt'>>.

ASYNC TYPES:
Always type async function return values: the return type is automatically wrapped in Promise<T>. Use Awaited<T> to unwrap nested promise types. Handle promise rejections explicitly — never let unhandled promise rejections propagate. Use Promise.allSettled() when you want all results regardless of individual failures.

ENUMS AND CONSTANTS:
Prefer string literal unions over enums: type Status = 'active' | 'inactive' | 'pending'. Use 'as const' for object literals that serve as enum-like constants. Use 'satisfies' with 'as const' for maximum type safety: const ROLES = { admin: 'admin', user: 'user' } as const satisfies Record<string, string>.

MODULE PATTERNS:
Use barrel exports (index.ts) sparingly — they can cause circular dependencies and increase bundle size. Prefer direct imports. Use namespace imports for utility modules: import * as DateUtils from './date-utils'. Use named exports for functions and types that are consumed individually.

TYPE CONFIGURATION:
Enable strict mode in tsconfig.json: "strict": true. Enable noUncheckedIndexedAccess for safe array/object access. Use "moduleResolution": "bundler" for modern bundler support. Define path aliases (@/*) for clean imports.`,
}

export const TAILWIND_LIBRARY: PromptLibrary = {
  id: 'tailwind',
  name: 'Tailwind CSS Patterns',
  domain: 'tailwind',
  priority: 3,
  tokenEstimate: 1500,
  content: `Tailwind CSS 4 — Production Patterns

CONFIGURATION AND SETUP:
Tailwind CSS 4 uses a CSS-first configuration approach. Define theme customizations directly in your CSS file using @theme directives instead of tailwind.config.js. Import Tailwind with @import "tailwindcss". Use @custom-variant for custom variant definitions. The PostCSS plugin @tailwindcss/postcss handles processing.

COLOR SYSTEM:
Define colors using CSS custom properties with oklch color space for perceptually uniform values. Create semantic color tokens: --background, --foreground, --primary, --primary-foreground, --secondary, --muted, --accent, --destructive, --border, --input, --ring. Apply via Tailwind's theme mapping: bg-background, text-foreground, bg-primary, etc. Implement dark mode with @custom-variant dark (&:is(.dark *)) and override custom properties in the .dark selector.

RESPONSIVE DESIGN:
Mobile-first approach: base styles target mobile, then layer on responsive styles. Breakpoints: sm:640px, md:768px, lg:1024px, xl:1280px, 2xl:1536px. Use min-width queries (default) — styles apply from the breakpoint upward. Think in terms of progressive enhancement: define mobile styles first, then override for larger screens. Use container queries (@container) for component-level responsiveness.

LAYOUT PATTERNS:
Use flex for one-dimensional layouts, grid for two-dimensional. Center content with flex items-center justify-center. Sticky footer: min-h-screen flex flex-col on root, mt-auto on footer. Card grid: grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6. Max-width content wrapper: max-w-7xl mx-auto px-4 sm:px-6 lg:px-8. Use gap utilities instead of margin for spacing between flex/grid children.

COMPONENT PATTERNS:
Use cn() utility (clsx + tailwind-merge) for conditional class composition. Build variant systems with class-variance-authority (cva): define base, variants, and defaultVariants. Create consistent button variants: default, destructive, outline, secondary, ghost, link. Use data attributes for state: data-[state=open]:animate-in. Group related styles with @apply sparingly — prefer direct utility classes for better IDE support.

SPACING AND SIZING:
Follow a consistent spacing scale: 1 = 4px (p-1, m-1, gap-1). Standard padding: p-4 (16px) for compact cards, p-6 (24px) for spacious sections. Standard gap: gap-4 for within cards, gap-6 for between cards. Touch targets: minimum 44x44px (min-h-11 min-w-11). Line heights: leading-tight for headings, leading-normal for body, leading-relaxed for long-form text.

ANIMATION AND TRANSITION:
Use transition utilities: transition-all duration-200 for interactive elements. Use Tailwind animate utilities: animate-spin, animate-ping, animate-pulse, animate-bounce. Custom animations via @keyframes in CSS. Respect prefers-reduced-motion: use motion-safe: prefix or add CSS @media (prefers-reduced-motion: reduce) rules. Use transform for performant animations: scale-95 hover:scale-100 transition-transform.

TYPOGRAPHY:
Font sizes follow a scale: text-xs (12px), text-sm (14px), text-base (16px), text-lg (18px), text-xl (20px), text-2xl (24px), text-3xl (30px), text-4xl (36px). Use font-medium for emphasis, font-semibold for headings, font-bold for hero text. Truncate text: truncate (overflow-hidden text-ellipsis whitespace-nowrap). Multi-line clamp: line-clamp-2, line-clamp-3.

DARK MODE:
Use class strategy with next-themes for SSR-safe dark mode. Override custom properties in .dark selector. Use dark: variant prefix for one-off dark styles: dark:bg-gray-900. Test both themes for every component. Ensure WCAG 2.1 AA contrast in both modes (4.5:1 for normal text, 3:1 for large text). Use opacity modifiers for subtle dark mode adjustments: bg-white/80 dark:bg-gray-900/80.`,
}

export const PRISMA_LIBRARY: PromptLibrary = {
  id: 'prisma',
  name: 'Prisma ORM Patterns',
  domain: 'prisma',
  priority: 4,
  tokenEstimate: 1500,
  content: `Prisma ORM — Production Patterns

SCHEMA DESIGN:
Place schema in prisma/schema.prisma. Use descriptive model names in PascalCase singular: User, Project, Message, not Users or user. Primary keys: use @id @default(cuid()) for all models — cuid() generates collision-resistant, sort-friendly IDs. Add @unique for email and other unique fields. Always include createdAt and updatedAt timestamps: createdAt DateTime @default(now()), updatedAt DateTime @updatedAt.

RELATIONS:
Define relations explicitly with @relation fields and foreign keys. Always name your relations when there are multiple relations between the same two models: @relation("UserPosts"). Use relation scalar fields explicitly: authorId String @map("author_id") for database column naming. Prefer @map() and @@map() to match existing database naming conventions (snake_case columns, PascalCase models). Use onDelete: Cascade for dependent records, SetNull for optional relations, Restrict for protected relations.

ENUMS:
Use Prisma enums for fixed value sets: enum Role { ADMIN USER MODERATOR }. Define enums at the schema level, not as strings. Use @default() for default enum values: role Role @default(USER). For SQLite, use String fields with comments indicating valid values since SQLite doesn't support native enums.

INDEXES:
Add @@index on frequently queried fields: @@index([email]), @@index([createdAt]). Use composite indexes for multi-field queries: @@index([userId, createdAt]). Use @@unique for compound uniqueness constraints: @@unique([userId, projectId]). Consider query patterns when designing indexes — add them based on actual query patterns, not speculation.

QUERY PATTERNS:
Import { db } from '@/lib/db' — never create new PrismaClient instances. Use select and include to limit fetched fields and avoid over-fetching. Use findFirst instead of findMany[0] for single record lookups. Implement cursor-based pagination: const items = await db.item.findMany({ take: limit, cursor: cursor ? { id: cursor } : undefined, skip: cursor ? 1 : 0 }). Use findMany with where for filtering, orderBy for sorting.

TRANSACTIONS:
Use prisma.$transaction for multi-step operations that must succeed or fail together. Sequential operations: await db.$transaction([db.user.create(...), db.auditLog.create(...)]). Interactive transactions for complex logic: await db.$transaction(async (tx) => { ... }). Set timeout for long transactions: db.$transaction(fn, { maxWait: 5000, timeout: 10000 }). Use transactions for operations that modify multiple related records.

SOFT DELETES AND AUDIT:
Use soft deletes for important data: add deletedAt DateTime? field. Query with where: { deletedAt: null } for active records. Add audit fields when tracking is needed: createdBy String?, updatedBy String?. Use middleware or extensions for automatic audit field population.

MIGRATION STRATEGY:
Use bun run db:push for development schema sync (applies schema without migration history). For production, use prisma migrate deploy (applies pending migrations). Never use prisma migrate reset in production. Always review generated SQL before applying migrations. Include rollback considerations in schema changes. Use prisma migrate diff to preview changes.

CLIENT OPTIMIZATION:
Use the singleton pattern to avoid creating multiple PrismaClient instances in development (prevents connection pool exhaustion). Enable query logging in development: new PrismaClient({ log: ['query', 'info', 'warn', 'error'] }). Use $queryRaw for complex queries that Prisma's API doesn't support. Use $executeRaw for bulk updates or deletes. Handle connection pooling properly in serverless environments with the connection limit config.

ERROR HANDLING:
Handle Prisma-specific error codes: P2002 (unique constraint violation) → 409 Conflict, P2025 (record not found) → 404 Not Found, P2003 (foreign key constraint) → 400 Bad Request, P2014 (required relation violation) → 400 Bad Request. Wrap Prisma operations in try/catch and translate error codes to HTTP responses. Use PrismaClientKnownRequestError for type-safe error handling.

PERFORMANCE:
Use include strategically — deep nesting causes N+1 queries. Prefer separate queries with manual joins over deeply nested includes. Use select to fetch only needed fields. Batch operations with createMany, updateMany, deleteMany. Use upsert for insert-or-update patterns. Monitor query performance with Prisma Accelerate or query logging.`,
}

export const REACT_PATTERNS_LIBRARY: PromptLibrary = {
  id: 'react-patterns',
  name: 'React Patterns',
  domain: 'react',
  priority: 2,
  tokenEstimate: 1500,
  content: `React 19 — Production Patterns

COMPONENT DESIGN:
Every component must be a named function (not arrow function) with an explicit TypeScript props interface. Define props interfaces above the component, prefixed with the component name: ButtonProps, CardProps. Use destructuring in the function signature: function Button({ variant, size, children }: ButtonProps). Keep components focused on a single responsibility — if a component does too many things, split it.

STATE MANAGEMENT:
Use useState for local component state (UI toggles, form inputs, simple counters). Use useReducer for complex state with multiple related values or when the next state depends on the previous one. Extract custom hooks for reusable stateful logic: useLocalStorage, useDebounce, useMediaQuery. Use Zustand for client-side global state — define stores with create() and use selectors for re-render optimization. Use TanStack Query for server state with proper cache invalidation and stale-while-revalidate patterns.

RENDERING PATTERNS:
Use React.memo for components that receive complex props and re-render frequently without prop changes. Implement useMemo for expensive computations that don't need to run on every render. Use useCallback for event handlers passed as props to memoized child components. Avoid premature optimization — profile first with React DevTools before adding memo/callback. Lift state up to the nearest common ancestor when sibling components need to share state.

COMPOSITION PATTERNS:
Use the compound component pattern for components with related sub-components: Tabs + TabsList + TabsTrigger + TabsContent. Use render props / function-as-child for flexible component APIs. Use the provider pattern for sharing state across deeply nested components. Prefer composition over props drilling — use React Context or Zustand when prop chains exceed 2-3 levels. Use children prop for layout components: Card, Panel, Layout.

ERROR HANDLING:
Implement error boundaries (class component or react-error-boundary library) at route and feature boundaries. Show meaningful fallback UI — never leave users staring at a blank screen. Log errors to a monitoring service. Handle loading, error, and empty states in every data-fetching component. Use try/catch in event handlers and effects. Gracefully degrade features when dependencies fail.

FORM HANDLING:
Use react-hook-form for complex forms — it minimizes re-renders and handles validation efficiently. Define Zod schemas for validation and derive TypeScript types from them: type FormData = z.infer<typeof formSchema>. Use the zodResolver with react-hook-form. Handle server-side validation errors by mapping them to form fields. Implement proper submit states: idle, submitting, success, error. Disable the submit button during submission.

SIDE EFFECTS:
Use useEffect only for synchronization with external systems (API calls, subscriptions, DOM manipulation). Don't use useEffect for data transformation — compute during render. Don't use useEffect for event handling — use event handlers directly. Always include a cleanup function for subscriptions and timers. Use the dependency array correctly — list all reactive values used inside the effect. Consider useSyncExternalStore for subscribing to external data sources.

PERFORMANCE:
Use React.lazy and Suspense for code splitting route components. Implement virtualization for long lists with @tanstack/react-virtual. Use the useDeferredValue hook for expensive re-renders that can wait. Use useTransition for non-urgent state updates. Debounce input handlers that trigger API calls. Implement optimistic updates for a responsive UI with TanStack Query's onMutate + onError + onSettled pattern.

KEYBOARD AND ACCESSIBILITY:
Ensure all interactive elements are keyboard accessible. Use proper focus management — tabIndex, autoFocus, and roving tabindex for custom widgets. Implement keyboard shortcuts with the useKeyPress hook. Add aria-labels to icon buttons and interactive elements. Use role attributes for custom widgets. Announce dynamic content changes with aria-live regions.`,
}

// ── Singleton ──────────────────────────────────────────────────────────────────

export const promptLibraryManager = new PromptLibraryManager()