/**
 * Skill Prompt Registry
 *
 * Maps skill names to their prompt configurations. When a skill is active,
 * its systemPromptAddition is concatenated into the agent's system prompt,
 * and its tool definitions are made available to the agent.
 */

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, { type: string; description: string }>
  handler: string // Name of the MCP tool handler function
}

export interface SkillPromptConfig {
  name: string
  systemPromptAddition: string // Extra instructions added to the system prompt when this skill is active
  tools: ToolDefinition[] // Tools this skill makes available
  examples: string[] // Example prompts this skill handles well
}

// --- Web Development Skill ---
const webDevelopmentPrompt = `You are operating with the Web Development skill active. Follow these conventions strictly:

FILE STRUCTURE: Use Next.js 16 App Router conventions. Place pages in src/app/ as page.tsx, layouts as layout.tsx, loading states as loading.tsx, error boundaries as error.tsx. API routes go in src/app/api/[route]/route.ts with named GET/POST/PUT/DELETE exports. Components live in src/components/ with ui/ subfolder for primitives. Hooks in src/hooks/, utilities in src/lib/.

COMPONENT PATTERNS: Every component must be a named function with explicit TypeScript props interface. Use 'use client' directive only when the component uses useState, useEffect, event handlers, or browser APIs. Server components are the default — prefer them for data fetching and static rendering. Use React.memo for expensive renders. Extract custom hooks for reusable stateful logic.

STYLING: Use Tailwind CSS 4 utility classes exclusively. Follow mobile-first responsive design (base → sm → md → lg → xl). Use shadcn/ui components for all interactive elements — never rebuild Button, Dialog, Input, etc. Apply consistent spacing with p-4/p-6 for padding, gap-4/gap-6 for flex/grid gaps. Use CSS variables via Tailwind (bg-primary, text-muted-foreground) for theming.

STATE MANAGEMENT: Use Zustand for client-side global state. Use TanStack Query (React Query) for server state with proper cache invalidation. Local component state with useState for UI-only state. Never use useContext for complex state — use Zustand instead.

PERFORMANCE: Implement Suspense boundaries for async components. Use dynamic imports for heavy client components. Add loading.tsx files at every route level. Use Next.js Image component for all images. Implement proper error boundaries.

CODE QUALITY: No any types — use proper TypeScript generics and interfaces. Handle loading, error, and empty states in every data-fetching component. Implement proper form validation with zod schemas. Use proper error handling in all API routes.`

// --- API Design Skill ---
const apiDesignPrompt = `You are operating with the API Design skill active. Follow these conventions strictly:

REST API DESIGN: Use Next.js Route Handlers in src/app/api/. Name routes with plural nouns (/api/users, /api/projects). Implement proper HTTP methods: GET for reads, POST for creates, PUT for full updates, PATCH for partial updates, DELETE for removals. Return 201 for creation, 204 for deletion with no body. Use proper status codes: 200, 201, 204, 400, 401, 403, 404, 409, 422, 429, 500.

REQUEST/RESPONSE PATTERNS: Validate all request bodies with zod schemas before processing. Return consistent response shapes: { data: T, meta?: { page, limit, total } } for lists, { data: T } for single items, { error: { code: string, message: string, details?: unknown } } for errors. Always include Content-Type: application/json headers. Implement pagination with cursor-based or offset-based patterns.

AUTHENTICATION ON APIS: Protect routes by validating session tokens in middleware or route handlers. Use NextAuth.js session validation. Implement rate limiting per user/IP. Add CORS headers when needed.

ERROR HANDLING: Never expose internal errors to clients. Wrap all route handler logic in try/catch. Log errors server-side with context. Return user-friendly error messages. Handle Prisma-specific errors (P2002 unique constraint, P2025 not found) with appropriate HTTP status codes.

API DOCUMENTATION: Add JSDoc comments to every route handler describing parameters, responses, and authentication requirements. Include example request/response pairs. Document all error codes and their meanings.`

// --- Database Design Skill ---
const databaseDesignPrompt = `You are operating with the Database Design skill active. Follow these conventions strictly:

PRISMA SCHEMA PATTERNS: Place schema in prisma/schema.prisma. Use descriptive model names in PascalCase singular (User, Project, Message). Use @id @default(cuid()) for primary keys. Add @unique for email and other unique fields. Use @updatedAt on all models with DateTime fields. Define proper relations with @relation fields and foreign keys. Use enums for fixed value sets. Add @map() and @@map() to match existing database naming conventions.

MIGRATION STRATEGY: Always use bun run db:push for development schema sync. For production, use prisma migrate deploy. Never use prisma migrate reset in production. Include rollback considerations in schema changes. Add comments for complex schema decisions.

QUERY OPTIMIZATION: Use select and include to limit fetched fields. Implement cursor-based pagination with take/skip for large datasets. Use findFirst instead of findMany[0] for single record lookups. Add indexes with @@index on frequently queried fields. Use transactions (prisma.$transaction) for multi-step operations. Implement optimistic concurrency with version fields.

DATA MODELING: Normalize data to reduce redundancy. Use soft deletes (deletedAt field) for important data. Add audit fields (createdBy, updatedBy) when tracking is needed. Use JSON fields sparingly — prefer structured relations. Implement proper cascade delete behaviors. Consider query patterns when denormalizing for performance.

CLIENT USAGE: Import { db } from '@/lib/db' — never create new PrismaClient instances. Use db.$disconnect() only in long-running scripts. Handle connection pooling in serverless environments.`

// --- UI/UX Design Skill ---
const uiUxDesignPrompt = `You are operating with the UI/UX Design skill active. Follow these conventions strictly:

DESIGN SYSTEM: Use shadcn/ui New York style as the component foundation. Apply consistent spacing scale: 1 = 4px. Use p-4/p-6 for card content, gap-4/gap-6 for layouts. Typography hierarchy: text-4xl font-bold for hero, text-2xl font-semibold for section headers, text-lg font-medium for card titles, text-sm for body, text-xs for captions. Line heights: leading-tight for headings, leading-normal for body text.

COLOR SYSTEM: Use Tailwind CSS built-in variables (bg-primary, text-primary-foreground, bg-background, text-foreground, bg-muted, text-muted-foreground). NEVER use indigo or blue as primary colors unless explicitly requested. Use bg-destructive for error states, bg-warning/amber for warnings, bg-emerald/green for success. Implement dark mode with next-themes using class strategy. Ensure WCAG 2.1 AA contrast ratios (4.5:1 for normal text, 3:1 for large text).

RESPONSIVE DESIGN: Design mobile-first. Every page must work on 320px width minimum. Use responsive breakpoints: base (mobile), sm:640px, md:768px, lg:1024px, xl:1280px. Touch targets must be minimum 44x44px. Use safe area insets for mobile (pb-safe or env(safe-area-inset-bottom)). Implement responsive navigation (hamburger menu on mobile, sidebar on desktop).

ACCESSIBILITY: Use semantic HTML elements (main, nav, header, footer, section, article). Add proper aria-labels to interactive elements. Use sr-only class for screen-reader-only text. Ensure all interactive elements are keyboard accessible with visible focus indicators. Implement skip-to-content links. Add alt text to all images. Use proper heading hierarchy (h1 → h2 → h3, never skip levels). Support prefers-reduced-motion for animations.

LAYOUT: Use min-h-screen flex flex-col on root layout with mt-auto on footer for sticky footer. Implement proper loading skeletons. Use max-w-7xl mx-auto for content width. Cards should have consistent rounded-xl border shadow-sm styling. Lists with max-h-96 overflow-y-auto and custom scrollbar styling.`

// --- Authentication Skill ---
const authenticationPrompt = `You are operating with the Authentication skill active. Follow these conventions strictly:

NEXTAUTH.JS CONFIGURATION: Use NextAuth.js v4 with App Router. Create src/app/api/auth/[...nextauth]/route.ts with GET and POST handlers. Configure providers in pages/api/auth/[...nextauth].ts or route.ts. Use CredentialsProvider for email/password, GoogleProvider and GitHubProvider for OAuth. Store JWT in httpOnly cookies. Set session strategy to 'jwt' for stateless sessions or 'database' for server-side sessions.

OAUTH FLOWS: Implement proper OAuth2 authorization code flow. Store state parameter for CSRF protection. Handle callback with proper error handling for denied access. Implement account linking — allow same email across providers. Store OAuth tokens securely. Implement token refresh for long-lived sessions.

SESSION MANAGEMENT: Use useSession() hook in client components, getServerSession() in server components and API routes. Implement session refresh on activity. Set appropriate session maxAge (default 24h). Implement "Remember me" with extended session duration. Show session expiry warnings. Implement proper sign-out that clears all cookies and tokens.

RBAC PATTERNS: Define roles in the User model (ADMIN, USER, MODERATOR). Implement role-based middleware in Next.js middleware.ts. Create a requireAuth() helper that checks session and role. Use role-based conditional rendering in UI. Implement permission checks in API routes before data access. Never trust client-side role checks alone — always verify on the server.

SECURITY: Hash passwords with bcrypt (salt rounds ≥ 10). Implement rate limiting on auth endpoints (5 attempts per minute). Use CSRF tokens for state-changing operations. Implement proper password reset flow with time-limited tokens. Sanitize all user inputs. Never expose user IDs in client-accessible tokens — use opaque identifiers.`

// --- Real-time Features Skill ---
const realtimeFeaturesPrompt = `You are operating with the Real-time Features skill active. Follow these conventions strictly:

WEBSOCKET/SOCKET.IO: Create a mini-service in mini-services/ folder with its own port and package.json. Use Socket.IO for real-time bidirectional communication. The service must have index.ts as entry point. Define a specific port (e.g., 3003) — never use PORT env variable. Start with bun --hot for auto-restart. Handle connection/disconnection events. Implement room-based messaging for scoped communication.

FRONTEND INTEGRATION: Always connect via the gateway proxy. Use io('/?XTransformPort={Port}') — NEVER use direct URLs like io('http://localhost:3003'). Handle reconnection with exponential backoff. Show connection status in UI. Implement optimistic updates with server reconciliation. Use Zustand store for real-time state management.

SSE (SERVER-SENT EVENTS): For one-way server pushes, prefer SSE over WebSocket. Create Next.js Route Handlers that return a ReadableStream with text/event-stream content type. Send events with "data:", "event:", and "id:" fields. Implement Last-Event-ID for reconnection. Keep connections alive with periodic comment lines (: keepalive).

REAL-TIME STATE SYNC: Use operational transform or CRDT for collaborative editing. Implement presence indicators showing active users. Add typing indicators for chat interfaces. Use debounce for frequent state updates. Handle conflict resolution with server-authoritative model. Queue offline changes and sync on reconnection.

ARCHITECTURE: Separate real-time service from the main Next.js app. Use Redis or in-memory store for pub/sub between services. Implement heartbeat/health check endpoints. Add connection pooling for scalability. Handle graceful shutdown with proper cleanup.`

// --- File Processing Skill ---
const fileProcessingPrompt = `You are operating with the File Processing skill active. Follow these conventions strictly:

UPLOAD HANDLING: Use Next.js Route Handlers for file upload endpoints. Accept multipart/form-data with proper size limits (default 10MB, configurable). Validate file types against an allowlist before processing. Use the Web Streams API for streaming uploads — never buffer entire files in memory. Generate unique filenames with uuid or hash-based naming to prevent collisions. Store uploads in a dedicated /uploads directory or cloud storage (S3, R2).

IMAGE PROCESSING: Use the sharp library (already available) for image operations. Implement resize, crop, format conversion (webp, avif), and quality optimization on upload. Generate multiple sizes for responsive images (thumbnail, medium, large). Strip EXIF data for privacy. Implement progressive JPEG and lazy loading. Use Next.js Image component with proper width/height/sizes attributes.

FILE VALIDATION: Validate MIME types using magic numbers, not just extensions. Check file size limits before processing. Scan filenames for path traversal attacks. Implement virus scanning for user uploads in production. Use zod schemas for metadata validation. Return clear error messages for rejected files.

STORAGE PATTERNS: Use local filesystem for development with path.join(process.cwd(), 'uploads'). For production, use S3-compatible storage with presigned URLs. Implement file references in the database (path, size, mimeType, originalName). Add soft delete for files with cleanup jobs. Track storage usage per user/tenant. Implement CDN caching with proper cache-control headers.

SECURITY: Never serve user uploads from the public directory. Use a dedicated API route that validates access before serving files. Implement download tokens for temporary access. Set proper Content-Disposition headers. Prevent directory traversal in all file operations.`

// --- AI Integration Skill ---
const aiIntegrationPrompt = `You are operating with the AI Integration skill active. Follow these conventions strictly:

LLM API PATTERNS: Use the z-ai-web-dev-sdk for all AI operations. Create SDK instance with await ZAI.create(). Use zai.chat.completions.create() for text generation with proper message formatting. Implement streaming responses with stream: true and for-await-of iteration. Handle rate limits (429) with exponential backoff retry. Set appropriate max_tokens and temperature per use case. Always validate AI outputs before using them.

RAG IMPLEMENTATION: Implement retrieval-augmented generation in three steps: (1) Embed the user query using zai.embeddings.create(), (2) Search the vector store for top-k relevant documents (k=3-5), (3) Inject retrieved context into the system prompt before generation. Store document embeddings with metadata for filtering. Implement chunking strategies: 500-1000 tokens per chunk with 100-200 token overlap. Use cosine similarity for relevance scoring.

EMBEDDING PIPELINES: Process documents through: ingest → chunk → embed → store → index. Use consistent embedding models across ingestion and retrieval. Store embeddings with metadata (source, chunk_index, timestamps). Implement incremental indexing for new documents. Handle embedding dimension changes with re-indexing. Batch embedding requests for efficiency (up to 100 per batch).

PROMPT ENGINEERING: Structure system prompts with clear sections: role, context, instructions, constraints, output format. Use few-shot examples for complex tasks. Implement prompt templates with variable interpolation. Chain prompts for multi-step reasoning. Add guardrails: output format validation, content filtering, length limits. Never expose system prompts to end users.

AI SAFETY: Validate all AI-generated content before displaying. Implement content moderation on user inputs and AI outputs. Rate limit AI API calls per user. Log AI interactions for auditing (with PII redaction). Handle hallucinations by cross-referencing AI outputs with source data. Implement fallback responses when AI services are unavailable.`

// --- Testing & QA Skill ---
const testingQaPrompt = `You are operating with the Testing & QA skill active. Follow these conventions strictly:

UNIT TESTS: Use Vitest as the test runner (faster than Jest, native ESM support). Place test files alongside source files as filename.test.ts. Test pure functions with describe/it blocks. Mock external dependencies with vi.mock(). Test edge cases: empty inputs, null values, boundary conditions, error states. Aim for meaningful coverage over percentage — test behavior, not implementation. Use Arrange-Act-Assert pattern consistently.

INTEGRATION TESTS: Test API routes by creating Request objects and calling the route handler directly. Use Prisma with a test database (separate SQLite file). Reset the database between test suites. Test the full request-response cycle including validation, authentication, and error handling. Verify database state after mutations. Test concurrent request handling.

E2E TESTS: Use Playwright for end-to-end browser testing. Write tests from the user's perspective — test user flows, not implementation details. Use Page Object Model for reusable page interactions. Test critical paths: authentication, data creation, data editing, deletion. Test responsive behavior at different viewport sizes. Implement visual regression testing with screenshot comparison.

MOCKING STRATEGIES: Mock fetch/API calls with MSW (Mock Service Worker) for consistent responses. Mock NextAuth session for authenticated route testing. Use vi.fn() for function mocks, vi.spyOn() for method spies. Create factory functions for test data (buildUser(), buildProject()). Use zod schemas to validate mock data matches real shapes. Never mock what you're testing.

COVERAGE: Prioritize testing: (1) Authentication and authorization logic, (2) Data mutation endpoints, (3) Business logic calculations, (4) Error handling paths, (5) UI component rendering. Skip testing: Third-party library internals, Simple getters/setters, Type system guarantees.`

// --- DevOps & Deploy Skill ---
const devopsDeployPrompt = `You are operating with the DevOps & Deploy skill active. Follow these conventions strictly:

DOCKER: Create multi-stage Dockerfiles for minimal image size. Use node:20-alpine as base. Stage 1: install dependencies with bun. Stage 2: build the application. Stage 3: production image with standalone output. Never include devDependencies in production image. Use .dockerignore to exclude node_modules, .next, .git. Expose only necessary ports. Use non-root user in production. Implement health check endpoints.

CI/CD PIPELINES: Use GitHub Actions with proper workflow files in .github/workflows/. Implement PR checks: lint, type-check, test, build. Use cache actions for node_modules and .next/cache. Separate staging and production deployments. Implement automatic rollback on failed deployments. Use environment secrets for sensitive values. Run database migrations before deployment.

ENVIRONMENT MANAGEMENT: Use .env.local for local development (never commit). Use .env.example with all required variables documented. Validate environment variables at startup with zod schemas. Use NEXT_PUBLIC_ prefix only for client-side variables. Implement environment-specific configurations (development, staging, production). Never log sensitive values.

MONITORING: Implement structured logging with JSON format. Add request ID tracking across services. Monitor key metrics: response time, error rate, CPU/memory usage. Set up alerts for error rate spikes. Implement health check endpoints (/api/health) returning dependency status. Use proper HTTP status codes for monitoring endpoints. Track deployment versions in logs.

OPTIMIZATION: Enable Next.js standalone output mode for smaller Docker images. Implement ISR for frequently changing pages. Use edge runtime where possible for lower latency. Configure proper caching headers for static assets. Implement code splitting and lazy loading. Monitor bundle size with @next/bundle-analyzer.`

// --- Mobile Development Skill ---
const mobileDevelopmentPrompt = `You are operating with the Mobile Development skill active. Follow these conventions strictly:

REACT NATIVE PATTERNS: Use Expo managed workflow for cross-platform development. Create screens in app/ directory following Expo Router file-based routing. Use TypeScript for all components with proper NativeWind (Tailwind for RN) styling. Implement proper navigation types. Use FlatList for long lists (never ScrollView for dynamic data). Implement pull-to-refresh patterns. Handle keyboard avoidance with KeyboardAvoidingView.

EXPO CONFIGURATION: Configure app.json/app.config.ts with proper app name, bundle identifier, and version. Use expo-updates for OTA updates. Configure deep linking with proper URL schemes. Set up EAS Build for cloud builds. Use expo-constants for environment variables. Implement proper splash screen and app icon assets.

CROSS-PLATFORM: Write shared business logic in platform-agnostic files. Use Platform.select() for platform-specific styling. Use .ios.tsx and .android.tsx extensions for platform-specific components. Test on both iOS and Android — never assume behavior. Handle safe area insets with react-native-safe-area-context. Implement responsive layouts with Dimensions API or useWindowDimensions hook.

NATIVE MODULES: Prefer Expo modules over custom native modules. Use expo-camera, expo-image-picker, expo-location for common native features. Implement proper permission handling with graceful fallbacks. Handle background/foreground app state transitions. Use AsyncStorage for local persistence. Implement biometric authentication with expo-local-authentication.

PERFORMANCE: Use React.memo for expensive list items. Implement virtualized lists (FlatList/FlashList). Optimize image loading with expo-image. Minimize bridge calls. Use worklets for animations with react-native-reanimated. Implement proper memory management — clean up subscriptions and timers on unmount. Test performance on low-end devices.`

// --- Data Visualization Skill ---
const dataVisualizationPrompt = `You are operating with the Data Visualization skill active. Follow these conventions strictly:

CHART PATTERNS: Use Recharts (already available) as the primary charting library. Create reusable chart wrapper components that accept data, config, and responsive props. Always handle loading, empty, and error states in chart containers. Use proper data formatting with Intl.NumberFormat and date-fns. Implement animated transitions with Recharts animation props. Use responsive containers (ResponsiveContainer) that adapt to parent width. Export chart components from src/components/charts/.

DASHBOARD LAYOUTS: Use CSS Grid for dashboard layouts with named areas. Implement drag-and-drop dashboard customization with @dnd-kit. Add time range selectors (7d, 30d, 90d, custom) with proper data aggregation. Implement KPI cards with trend indicators (up/down arrows, percentage change). Use skeleton loaders for chart data loading states. Make dashboards responsive: stack vertically on mobile, grid on desktop.

INTERACTIVE VISUALIZATIONS: Implement tooltips with formatted values and labels. Add click handlers for drill-down navigation. Support zoom and pan on time-series charts. Use controlled components for filter state. Implement cross-filtering between charts. Add export functionality (CSV, PNG). Use debounced interactions for performance. Support keyboard navigation between chart elements.

COLOR THEORY: Use colorblind-safe palettes (avoid red-green distinctions alone). Implement sequential palettes for ordered data, diverging for data with a midpoint, categorical for discrete groups. Use consistent color mapping across related charts. Ensure sufficient contrast against the background. Add pattern/shape fills for accessibility beyond color. Implement dark mode color variants.

DATA HANDLING: Aggregate data on the server, not the client. Implement efficient data fetching with TanStack Query. Use proper data types (Date objects, not strings). Handle timezone-aware dates consistently. Implement real-time data updates with polling or WebSocket. Cache chart data with appropriate stale times. Validate data shapes with zod schemas before rendering.`

/**
 * The skill prompt registry maps skill names to their full prompt configurations.
 * When a skill is enabled, its systemPromptAddition is injected into the agent's
 * system prompt and its tools become available for the agent to invoke.
 */
export const skillPromptRegistry: Record<string, SkillPromptConfig> = {
  'Web Development': {
    name: 'Web Development',
    systemPromptAddition: webDevelopmentPrompt,
    tools: [
      {
        name: 'read_file',
        description: 'Read the contents of a file at the given path',
        parameters: {
          path: { type: 'string', description: 'Absolute or relative file path to read' },
        },
        handler: 'read_file',
      },
      {
        name: 'write_file',
        description: 'Write content to a file at the given path, creating directories if needed',
        parameters: {
          path: { type: 'string', description: 'File path to write' },
          content: { type: 'string', description: 'Content to write to the file' },
        },
        handler: 'write_file',
      },
      {
        name: 'list_directory',
        description: 'List files and directories at the given path',
        parameters: {
          path: { type: 'string', description: 'Directory path to list' },
        },
        handler: 'list_directory',
      },
      {
        name: 'search_files',
        description: 'Recursively search for files matching a pattern',
        parameters: {
          pattern: { type: 'string', description: 'Glob pattern or regex to match file names' },
          directory: { type: 'string', description: 'Root directory to search in' },
        },
        handler: 'search_files',
      },
      {
        name: 'execute_code',
        description: 'Execute a shell command and return the output',
        parameters: {
          command: { type: 'string', description: 'Shell command to execute' },
          cwd: { type: 'string', description: 'Working directory for the command' },
        },
        handler: 'execute_code',
      },
    ],
    examples: [
      'Build a Next.js blog with MDX support',
      'Create a dashboard with sidebar navigation',
      'Build a todo app with drag-and-drop reordering',
    ],
  },

  'API Design': {
    name: 'API Design',
    systemPromptAddition: apiDesignPrompt,
    tools: [
      {
        name: 'web_search',
        description: 'Search the web for API design best practices and documentation',
        parameters: {
          query: { type: 'string', description: 'Search query' },
        },
        handler: 'web_search',
      },
      {
        name: 'read_file',
        description: 'Read existing API route code',
        parameters: {
          path: { type: 'string', description: 'Path to the API route file' },
        },
        handler: 'read_file',
      },
      {
        name: 'write_file',
        description: 'Write or update an API route file',
        parameters: {
          path: { type: 'string', description: 'Path for the API route file' },
          content: { type: 'string', description: 'API route code' },
        },
        handler: 'write_file',
      },
    ],
    examples: [
      'Create a REST API for a blog with CRUD operations',
      'Build an API with authentication and rate limiting',
      'Design a GraphQL schema for an e-commerce app',
    ],
  },

  'Database Design': {
    name: 'Database Design',
    systemPromptAddition: databaseDesignPrompt,
    tools: [
      {
        name: 'read_file',
        description: 'Read the current Prisma schema',
        parameters: {
          path: { type: 'string', description: 'Path to schema.prisma file' },
        },
        handler: 'read_file',
      },
      {
        name: 'write_file',
        description: 'Write or update the Prisma schema',
        parameters: {
          path: { type: 'string', description: 'Path for the schema file' },
          content: { type: 'string', description: 'Prisma schema content' },
        },
        handler: 'write_file',
      },
      {
        name: 'execute_code',
        description: 'Run Prisma CLI commands like db:push, generate, migrate',
        parameters: {
          command: { type: 'string', description: 'Prisma CLI command to execute' },
        },
        handler: 'execute_code',
      },
    ],
    examples: [
      'Design a database schema for a social media app',
      'Create a Prisma schema with user authentication',
      'Optimize the database schema for a high-traffic blog',
    ],
  },

  'UI/UX Design': {
    name: 'UI/UX Design',
    systemPromptAddition: uiUxDesignPrompt,
    tools: [
      {
        name: 'web_search',
        description: 'Search for UI/UX design inspiration and best practices',
        parameters: {
          query: { type: 'string', description: 'Design-related search query' },
        },
        handler: 'web_search',
      },
      {
        name: 'fetch_page',
        description: 'Fetch a webpage for design reference',
        parameters: {
          url: { type: 'string', description: 'URL of the page to fetch' },
        },
        handler: 'fetch_page',
      },
    ],
    examples: [
      'Design a modern onboarding flow with step indicators',
      'Create an accessible form with proper validation UX',
      'Build a responsive dashboard with dark mode support',
    ],
  },

  'Authentication': {
    name: 'Authentication',
    systemPromptAddition: authenticationPrompt,
    tools: [
      {
        name: 'read_file',
        description: 'Read existing auth configuration files',
        parameters: {
          path: { type: 'string', description: 'Path to auth config file' },
        },
        handler: 'read_file',
      },
      {
        name: 'write_file',
        description: 'Write auth configuration and middleware',
        parameters: {
          path: { type: 'string', description: 'Path for the auth file' },
          content: { type: 'string', description: 'Auth code content' },
        },
        handler: 'write_file',
      },
      {
        name: 'web_search',
        description: 'Search for auth implementation patterns',
        parameters: {
          query: { type: 'string', description: 'Auth-related search query' },
        },
        handler: 'web_search',
      },
    ],
    examples: [
      'Implement Google and GitHub OAuth with NextAuth',
      'Add role-based access control to my app',
      'Set up password reset flow with email verification',
    ],
  },

  'Real-time Features': {
    name: 'Real-time Features',
    systemPromptAddition: realtimeFeaturesPrompt,
    tools: [
      {
        name: 'write_file',
        description: 'Write Socket.IO service files in mini-services/',
        parameters: {
          path: { type: 'string', description: 'Path for the service file' },
          content: { type: 'string', description: 'Service code content' },
        },
        handler: 'write_file',
      },
      {
        name: 'execute_code',
        description: 'Start or restart the real-time service',
        parameters: {
          command: { type: 'string', description: 'Command to manage the service' },
        },
        handler: 'execute_code',
      },
    ],
    examples: [
      'Add real-time chat with Socket.IO',
      'Implement live collaboration with cursor presence',
      'Build a notification system with SSE',
    ],
  },

  'File Processing': {
    name: 'File Processing',
    systemPromptAddition: fileProcessingPrompt,
    tools: [
      {
        name: 'read_file',
        description: 'Read file upload route handlers',
        parameters: {
          path: { type: 'string', description: 'Path to the file route' },
        },
        handler: 'read_file',
      },
      {
        name: 'write_file',
        description: 'Write file upload and processing routes',
        parameters: {
          path: { type: 'string', description: 'Path for the route file' },
          content: { type: 'string', description: 'File processing code' },
        },
        handler: 'write_file',
      },
      {
        name: 'execute_code',
        description: 'Run image processing or file manipulation commands',
        parameters: {
          command: { type: 'string', description: 'Shell command for file processing' },
        },
        handler: 'execute_code',
      },
    ],
    examples: [
      'Build a profile image upload with cropping and resizing',
      'Create a file sharing system with download links',
      'Implement document upload with virus scanning',
    ],
  },

  'AI Integration': {
    name: 'AI Integration',
    systemPromptAddition: aiIntegrationPrompt,
    tools: [
      {
        name: 'web_search',
        description: 'Search for AI/ML documentation and examples',
        parameters: {
          query: { type: 'string', description: 'AI-related search query' },
        },
        handler: 'web_search',
      },
      {
        name: 'fetch_page',
        description: 'Fetch AI API documentation pages',
        parameters: {
          url: { type: 'string', description: 'URL of the documentation page' },
        },
        handler: 'fetch_page',
      },
      {
        name: 'store',
        description: 'Store data in memory for RAG context retrieval',
        parameters: {
          key: { type: 'string', description: 'Storage key' },
          value: { type: 'string', description: 'Data to store (JSON serializable)' },
        },
        handler: 'store',
      },
      {
        name: 'retrieve',
        description: 'Retrieve previously stored data by key',
        parameters: {
          key: { type: 'string', description: 'Storage key to look up' },
        },
        handler: 'retrieve',
      },
    ],
    examples: [
      'Build a chatbot with streaming responses',
      'Implement RAG over my documentation',
      'Create an AI-powered content generator',
    ],
  },

  'Testing & QA': {
    name: 'Testing & QA',
    systemPromptAddition: testingQaPrompt,
    tools: [
      {
        name: 'read_file',
        description: 'Read source files to understand what needs testing',
        parameters: {
          path: { type: 'string', description: 'Path to the source file' },
        },
        handler: 'read_file',
      },
      {
        name: 'write_file',
        description: 'Write test files alongside source files',
        parameters: {
          path: { type: 'string', description: 'Path for the test file' },
          content: { type: 'string', description: 'Test code content' },
        },
        handler: 'write_file',
      },
      {
        name: 'execute_code',
        description: 'Run test suites and check results',
        parameters: {
          command: { type: 'string', description: 'Test command to execute' },
        },
        handler: 'execute_code',
      },
    ],
    examples: [
      'Write unit tests for my API routes',
      'Create e2e tests for the user signup flow',
      'Add integration tests for the database layer',
    ],
  },

  'DevOps & Deploy': {
    name: 'DevOps & Deploy',
    systemPromptAddition: devopsDeployPrompt,
    tools: [
      {
        name: 'write_file',
        description: 'Write Dockerfile, CI/CD configs, and deployment scripts',
        parameters: {
          path: { type: 'string', description: 'Path for the config file' },
          content: { type: 'string', description: 'Configuration content' },
        },
        handler: 'write_file',
      },
      {
        name: 'execute_code',
        description: 'Run deployment commands and check infrastructure status',
        parameters: {
          command: { type: 'string', description: 'DevOps command to execute' },
        },
        handler: 'execute_code',
      },
      {
        name: 'git_status',
        description: 'Check git repository status',
        parameters: {},
        handler: 'git_status',
      },
      {
        name: 'git_commit',
        description: 'Stage and commit changes',
        parameters: {
          message: { type: 'string', description: 'Commit message' },
        },
        handler: 'git_commit',
      },
    ],
    examples: [
      'Create a Docker configuration for my Next.js app',
      'Set up a GitHub Actions CI/CD pipeline',
      'Configure environment variables for staging and production',
    ],
  },

  'Mobile Development': {
    name: 'Mobile Development',
    systemPromptAddition: mobileDevelopmentPrompt,
    tools: [
      {
        name: 'write_file',
        description: 'Write React Native component and screen files',
        parameters: {
          path: { type: 'string', description: 'Path for the mobile component' },
          content: { type: 'string', description: 'React Native code' },
        },
        handler: 'write_file',
      },
      {
        name: 'execute_code',
        description: 'Run Expo and React Native CLI commands',
        parameters: {
          command: { type: 'string', description: 'Mobile dev command to execute' },
        },
        handler: 'execute_code',
      },
      {
        name: 'web_search',
        description: 'Search for React Native and Expo documentation',
        parameters: {
          query: { type: 'string', description: 'Mobile dev search query' },
        },
        handler: 'web_search',
      },
    ],
    examples: [
      'Build a React Native chat app with Expo',
      'Create a cross-platform e-commerce mobile app',
      'Implement biometric authentication in my mobile app',
    ],
  },

  'Data Visualization': {
    name: 'Data Visualization',
    systemPromptAddition: dataVisualizationPrompt,
    tools: [
      {
        name: 'web_search',
        description: 'Search for data visualization patterns and examples',
        parameters: {
          query: { type: 'string', description: 'Data viz search query' },
        },
        handler: 'web_search',
      },
      {
        name: 'write_file',
        description: 'Write chart components and dashboard layouts',
        parameters: {
          path: { type: 'string', description: 'Path for the chart component' },
          content: { type: 'string', description: 'Chart component code' },
        },
        handler: 'write_file',
      },
      {
        name: 'store',
        description: 'Cache processed data for visualization',
        parameters: {
          key: { type: 'string', description: 'Cache key' },
          value: { type: 'string', description: 'Data to cache' },
        },
        handler: 'store',
      },
      {
        name: 'retrieve',
        description: 'Retrieve cached visualization data',
        parameters: {
          key: { type: 'string', description: 'Cache key' },
        },
        handler: 'retrieve',
      },
    ],
    examples: [
      'Build a sales analytics dashboard with charts',
      'Create an interactive data table with sorting and filtering',
      'Design a real-time monitoring dashboard with KPIs',
    ],
  },
}

/**
 * Get the prompt config for a skill by name.
 * Returns a default minimal config if the skill is not in the registry.
 */
export function getSkillPromptConfig(skillName: string): SkillPromptConfig | null {
  return skillPromptRegistry[skillName] ?? null
}

/**
 * Build the combined system prompt addition from all active skills.
 * Each skill's systemPromptAddition is concatenated with clear section headers.
 */
export function buildSkillSystemPrompt(activeSkillNames: string[]): string {
  const sections: string[] = []

  for (const name of activeSkillNames) {
    const config = skillPromptRegistry[name]
    if (config) {
      sections.push(`--- ${name} ---\n${config.systemPromptAddition}`)
    }
  }

  return sections.length > 0
    ? `ACTIVE SKILL INSTRUCTIONS:\n${sections.join('\n\n')}`
    : ''
}

/**
 * Collect all unique tools from active skills, deduplicating by tool name.
 */
export function collectActiveTools(activeSkillNames: string[]): ToolDefinition[] {
  const toolMap = new Map<string, ToolDefinition>()

  for (const name of activeSkillNames) {
    const config = skillPromptRegistry[name]
    if (config) {
      for (const tool of config.tools) {
        if (!toolMap.has(tool.name)) {
          toolMap.set(tool.name, tool)
        }
      }
    }
  }

  return Array.from(toolMap.values())
}

/**
 * Format the available tools section for the system prompt.
 */
export function formatToolsForPrompt(tools: ToolDefinition[]): string {
  if (tools.length === 0) return ''

  const toolLines = tools.map((tool) => {
    const params = Object.entries(tool.parameters)
      .map(([key, val]) => `${key}: ${val.type} - ${val.description}`)
      .join(', ')
    return `- ${tool.name}(${params}): ${tool.description}`
  })

  return `AVAILABLE TOOLS:\n${toolLines.join('\n')}\n\nWhen you need to use a tool, format it as:\n[TOOL_CALL] tool_name({"param": "value"})`
}
