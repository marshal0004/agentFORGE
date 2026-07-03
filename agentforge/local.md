# AgentForge v1.2 — Local Development Setup (Arch Linux + VS Code)

## Table of Contents

1. [System Requirements](#1-system-requirements)
2. [Arch Linux Dependencies](#2-arch-linux-dependencies)
3. [Clone & Extract](#3-clone--extract)
4. [Environment Variables](#4-environment-variables)
5. [Install Dependencies](#5-install-dependencies)
6. [Database Setup](#6-database-setup)
7. [Run the Dev Server](#7-run-the-dev-server)
8. [Run Tests](#8-run-tests)
9. [VS Code Configuration](#9-vs-code-configuration)
10. [Project Structure](#10-project-structure)
11. [Architecture Overview](#11-architecture-overview)
12. [Available Scripts](#12-available-scripts)
13. [LLM Provider Configuration](#13-llm-provider-configuration)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. System Requirements

| Requirement | Minimum | Recommended |
|---|---|---|
| **OS** | Arch Linux (rolling) | Arch Linux (up-to-date) |
| **Node.js** | 20.x LTS | 22.x LTS |
| **Bun** | 1.1.x | Latest |
| **RAM** | 4 GB | 8 GB+ |
| **Disk** | 1 GB free | 2 GB free |

---

## 2. Arch Linux Dependencies

Install all system-level prerequisites:

```bash
# Update the system
sudo pacman -Syu

# Install Node.js (LTS), npm, and core build tools
sudo pacman -S --needed nodejs npm base-devel

# Install Bun (primary package manager for this project)
curl -fsSL https://bun.sh/install | bash

# Reload shell to pick up Bun
source ~/.bashrc   # or: source ~/.zshrc

# Verify installations
node --version     # expect v20+ or v22+
npm --version      # expect 10+
bun --version      # expect 1.1+

# SQLite (Prisma's database engine — usually pre-installed on Arch)
sudo pacman -S --needed sqlite

# Git
sudo pacman -S --needed git

# VS Code
sudo pacman -S code    # if using the community package
# OR install via AUR:
# yay -S visual-studio-code-bin
```

### Optional: Ollama (Local LLM Inference)

```bash
sudo pacman -S ollama
# OR
curl -fsSL https://ollama.com/install.sh | sh

# Start the Ollama service
systemctl --user start ollama
# OR: ollama serve &

# Pull a model
ollama pull llama3.1
```

---

## 3. Clone & Extract

If you have the `agentforge1.2.zip` file:

```bash
# Create your project directory
mkdir -p ~/projects
cd ~/projects

# Unzip
unzip /path/to/agentforge1.2.zip

# This creates: ~/projects/agentforge/
cd agentforge

# Verify the structure
ls -la
# You should see: package.json, src/, prisma/, tsconfig.json, etc.
```

If cloning from a repository:

```bash
cd ~/projects
git clone <your-repo-url> agentforge
cd agentforge
```

---

## 4. Environment Variables

Create a `.env.local` file in the project root:

```bash
cat > .env.local << 'EOF'
# ── LLM Provider API Keys ──────────────────────────────────────────────────
# At minimum, the ZAI provider (z-ai-web-dev-sdk) works out-of-the-box.
# Uncomment and fill in the providers you want to use.

# ZAI (default provider — works without an API key in the Z.ai platform)
# ZAI_API_KEY=

# OpenAI
# OPENAI_API_KEY=sk-...

# Anthropic (Claude)
# ANTHROPIC_API_KEY=sk-ant-...

# Google AI (Gemini)
# GOOGLE_AI_API_KEY=AIza...

# Groq
# GROQ_API_KEY=gsk_...

# DeepSeek
# DEEPSEEK_API_KEY=sk-...

# Together AI
# TOGETHER_API_KEY=...

# OpenRouter (gateway to 100+ models)
# OPENROUTER_API_KEY=sk-or-...

# Azure OpenAI
# AZURE_OPENAI_API_KEY=...
# AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
# AZURE_OPENAI_DEPLOYMENT=gpt-4

# ── Ollama (local models) ─────────────────────────────────────────────────
# Only change if Ollama is running on a non-default port
# OLLAMA_BASE_URL=http://localhost:11434

# ── Database ───────────────────────────────────────────────────────────────
# Prisma uses SQLite by default (file:./dev.db in prisma/schema.prisma)
# No DATABASE_URL needed unless switching to PostgreSQL

# ── NextAuth ──────────────────────────────────────────────────────────────
# NEXTAUTH_SECRET=your-random-secret-here
# NEXTAUTH_URL=http://localhost:3000

EOF
```

**Minimum for first run**: No environment variables are required. The app uses:
- **SQLite** for the database (zero config)
- **ZAI provider** (z-ai-web-dev-sdk) as the default LLM — works without an API key
- **`glm-4-flash`** as the default model

---

## 5. Install Dependencies

```bash
cd ~/projects/agentforge

# Install all npm packages (this project has a bun.lock but npm works fine)
bun install

# If you don't have Bun, use npm instead:
# npm install
```

> **Note**: This project has **84 runtime dependencies** and **13 dev dependencies** (see package.json). Installation may take 30–60 seconds on first run.

---

## 6. Database Setup

The project uses **Prisma ORM** with **SQLite**. The schema is at `prisma/schema.prisma` and defines three models: `Project`, `Message`, and `Skill`, plus `MCPServer`.

```bash
cd ~/projects/agentforge

# Generate the Prisma client (reads schema, creates node_modules/.prisma/client)
bunx prisma generate

# Push the schema to the SQLite database (creates prisma/dev.db)
bunx prisma db push

# Verify the database was created
ls -la prisma/dev.db
# Should show the SQLite file

# (Optional) Open Prisma Studio to browse data visually
bunx prisma studio
# Opens at http://localhost:5555
```

### Database Schema

```
Project
  ├── id          String   @id @default(cuid())
  ├── name        String
  ├── description String   @default("")
  ├── prompt      String   @default("")
  ├── status      String   @default("draft")
  ├── files       String   @default("[]")  ← JSON array of file objects
  ├── createdAt   DateTime
  ├── updatedAt   DateTime
  └── messages    Message[]

Message
  ├── id          String   @id @default(cuid())
  ├── projectId   String
  ├── role        String   ← "user" | "assistant" | "system"
  ├── content     String
  ├── metadata    String   @default("{}")  ← JSON
  └── createdAt   DateTime

Skill
  ├── id          String   @id @default(cuid())
  ├── name        String
  ├── description String
  ├── category    String   @default("general")
  ├── version     String   @default("1.0.0")
  ├── author      String   @default("community")
  ├── source      String   @default("built-in")
  ├── config      String   @default("{}")  ← JSON
  ├── installed   Boolean  @default(false)
  ├── enabled     Boolean  @default(true)
  ├── createdAt   DateTime
  └── updatedAt   DateTime

MCPServer
  ├── id          String   @id @default(cuid())
  ├── name        String
  ├── description String
  ├── command     String
  ├── args        String   @default("[]")  ← JSON
  ├── env         String   @default("{}")  ← JSON
  ├── category    String   @default("general")
  ├── enabled     Boolean  @default(true)
  ├── connected   Boolean  @default(false)
  ├── tools       String   @default("[]")  ← JSON
  ├── createdAt   DateTime
  └── updatedAt   DateTime
```

---

## 7. Run the Dev Server

```bash
cd ~/projects/agentforge

# Start Next.js dev server on port 3000
bun run dev
```

The `dev` script (from package.json) is:
```
next dev -p 3000 2>&1 | tee dev.log
```

**Wait for this output**:
```
  ▲ Next.js 16.x.x
  - Local:        http://localhost:3000
  - Environments: .env.local

 ✓ Starting...
 ✓ Ready in 2.5s
```

Open **http://localhost:3000** in your browser. You should see the AgentForge web UI.

### What happens on startup

1. Next.js compiles the app (TypeScript + Tailwind CSS)
2. Prisma client connects to `prisma/dev.db` (SQLite)
3. The `LLMProviderRegistry` singleton auto-initializes:
   - Registers the **ZAI** provider (always available, priority 0)
   - Scans environment variables for other providers (OpenAI, Anthropic, Google, Groq, etc.)
   - Registers **Ollama** (if running at `localhost:11434`)
   - Builds the **fallback chain** sorted by priority
4. The `SessionStore` creates a `sessions/` directory in the project root
5. The `ContextManager` initializes with Chef-inspired features:
   - Hysteresis context truncation
   - LRU file tracker (pre-warmed files: package.json, tsconfig.json, schema.prisma, etc.)
   - Tool result abbreviation
   - Prompt caching architecture (static + dynamic system prompts)

---

## 8. Run Tests

The project uses **Vitest** (v4.x) with the `node` environment. Tests are located in `src/__tests__/`.

```bash
cd ~/projects/agentforge

# Run all tests once
bun run test

# Run tests in watch mode (re-runs on file changes)
bun run test:watch

# Run a specific test file
bunx vitest run src/__tests__/lib/context-manager.test.ts

# Run with verbose output
bunx vitest run --reporter=verbose

# Run only unit tests
bunx vitest run src/__tests__/lib/

# Run only integration tests
bunx vitest run src/__tests__/integration/

# Run only E2E tests
bunx vitest run src/__tests__/e2e/

# Run with coverage
bunx vitest run --coverage
```

### Test Structure

```
src/__tests__/
├── setup.ts                          ← Global beforeAll/afterAll hooks
├── helpers/
│   └── api-helpers.ts                ← Shared test utilities
├── lib/                              ← Unit tests (18 files)
│   ├── artifact-writer.test.ts
│   ├── code-parser.test.ts
│   ├── context-manager.test.ts
│   ├── context-manager-v2.test.ts    ← Tests for hysteresis + LRU + tool abbreviation
│   ├── diff-editor.test.ts
│   ├── event-bus.test.ts
│   ├── extension-system.test.ts
│   ├── file-protection.test.ts
│   ├── filesystem.test.ts
│   ├── function-calling.test.ts
│   ├── llm-provider.test.ts
│   ├── llm-provider-fallback.test.ts ← Tests for provider fallback chains
│   ├── mcp-client.test.ts
│   ├── mcp-tools.test.ts
│   ├── message-compression.test.ts
│   ├── parallel-tools.test.ts
│   ├── prompt-library.test.ts
│   ├── self-correction.test.ts
│   ├── session-store.test.ts
│   ├── skill-prompts.test.ts
│   ├── subchat-manager.test.ts
│   ├── template-engine.test.ts
│   └── terminal.test.ts
├── stores/                           ← Zustand store tests
│   ├── agent-store.test.ts
│   └── skill-store.test.ts
├── integration/                      ← API integration tests (8 files)
│   ├── api-files.test.ts
│   ├── api-health.test.ts
│   ├── api-mcp.test.ts
│   ├── api-projects.test.ts
│   ├── api-skills.test.ts
│   ├── api-skills-custom.test.ts
│   ├── api-terminal.test.ts
│   └── api-terminal-extended.test.ts
├── e2e/                              ← End-to-end tests (3 files)
│   ├── chef-features-integration.test.ts  ← Tests for all 12 Chef features
│   ├── system-integration.test.ts
│   └── workflow.test.ts
└── nonfunctional/                    ← Performance & security tests
    ├── performance.test.ts
    └── security.test.ts
```

---

## 9. VS Code Configuration

### Recommended Extensions

Install these VS Code extensions for the best development experience:

```bash
# From the command line
code --install-extension dbaeumer.vscode-eslint
code --install-extension bradlc.vscode-tailwindcss
code --install-extension prisma.prisma
code --install-extension ms-vscode.vscode-typescript-next
code --install-extension vitest.explorer
code --install-extension formulahendry.auto-rename-tag
code --install-extension pkief.material-icon-theme
```

Or install manually from the Extensions panel (`Ctrl+Shift+X`):

| Extension | Purpose |
|---|---|
| **ESLint** (`dbaeumer.vscode-eslint`) | JavaScript/TypeScript linting |
| **Tailwind CSS IntelliSense** (`bradlc.vscode-tailwindcss`) | Tailwind class autocomplete |
| **Prisma** (`prisma.prisma`) | Schema highlighting, formatting, introspection |
| **TypeScript Nightly** (`ms-vscode.vscode-typescript-next`) | Latest TS features |
| **Vitest** (`vitest.explorer`) | Test runner integration |
| **Auto Rename Tag** (`formulahendry.auto-rename-tag`) | Sync JSX/HTML tag edits |

### VS Code `settings.json`

Create `.vscode/settings.json` in the project root:

```json
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true,
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "dbaeumer.vscode-eslint",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  },
  "tailwindCSS.includeLanguages": {
    "typescript": "javascript",
    "typescriptreact": "javascript"
  },
  "tailwindCSS.classAttributes": [
    "class",
    "className",
    "ngClass",
    "class:list"
  ],
  "files.associations": {
    "*.css": "tailwindcss"
  },
  "vitest.enable": true,
  "vitest.commandLine": "bunx vitest"
}
```

### VS Code `launch.json`

Create `.vscode/launch.json` for debugging:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Next.js: debug server-side",
      "type": "node-terminal",
      "request": "launch",
      "command": "bun run dev"
    },
    {
      "name": "Next.js: debug client-side",
      "type": "chrome",
      "request": "launch",
      "url": "http://localhost:3000",
      "webRoot": "${workspaceFolder}"
    }
  ]
}
```

### VS Code `extensions.json`

Create `.vscode/extensions.json` to recommend extensions to team members:

```json
{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "bradlc.vscode-tailwindcss",
    "prisma.prisma",
    "ms-vscode.vscode-typescript-next",
    "vitest.explorer"
  ]
}
```

---

## 10. Project Structure

```
agentforge/
├── .env.local                    ← Your environment variables (git-ignored)
├── .gitignore
├── bun.lock                      ← Bun lockfile
├── components.json               ← shadcn/ui config (style: "new-york")
├── eslint.config.mjs             ← ESLint flat config
├── next.config.ts                ← Next.js config (standalone output, strict mode off)
├── package.json                  ← Dependencies & scripts
├── postcss.config.mjs            ← PostCSS with @tailwindcss/postcss
├── prisma/
│   ├── schema.prisma             ← Database schema (SQLite)
│   └── dev.db                    ← SQLite database (git-ignored)
├── tailwind.config.ts            ← Tailwind CSS config with shadcn/ui theme
├── tsconfig.json                 ← TypeScript config (paths: @/* → ./src/*)
├── vitest.config.ts              ← Vitest config (node env, @/ alias)
├── public/
│   ├── logo.svg
│   └── robots.txt
├── workspace/                    ← Project workspaces (scaffolded apps live here)
│   └── test-project-123/         ← Example workspace
│       ├── .env
│       ├── package.json
│       ├── prisma/schema.prisma
│       ├── src/
│       │   ├── app/
│       │   │   ├── api/health/route.ts
│       │   │   ├── globals.css
│       │   │   ├── layout.tsx
│       │   │   └── page.tsx
│       │   ├── lib/
│       │   │   ├── db.ts
│       │   │   └── utils.ts
│       │   └── utils/
│       │       ├── helpers.ts
│       │       └── index.ts
│       └── tsconfig.json
├── sessions/                     ← JSONL session storage (auto-created at runtime)
├── db/                           ← Custom DB directory
├── examples/
│   └── websocket/
│       ├── frontend.tsx
│       └── server.ts
├── mini-services/
│   └── .gitkeep
│
└── src/                          ← ━━ APPLICATION SOURCE ━━━━━━━━━━━━━━━━━━
    ├── app/                      ← Next.js App Router
    │   ├── globals.css           ← Tailwind base + shadcn/ui CSS variables
    │   ├── layout.tsx            ← Root layout (Geist font, Toaster)
    │   ├── page.tsx              ← Main app page
    │   └── api/                  ← API Route Handlers
    │       ├── route.ts          ← Health check
    │       ├── agent/
    │       │   ├── chat/route.ts       ← ⭐ Main chat endpoint (LLM + tools loop)
    │       │   └── execute/route.ts    ← Tool execution endpoint
    │       ├── context/route.ts        ← Context window management API
    │       ├── correction/route.ts     ← Self-correction loop API
    │       ├── files/route.ts          ← File CRUD API
    │       ├── mcp/route.ts            ← MCP server management API
    │       ├── projects/route.ts       ← Project CRUD API
    │       ├── protection/route.ts     ← File protection API
    │       ├── skills/route.ts         ← Skill management API
    │       ├── subchats/route.ts       ← Subchat (branching) API
    │       ├── templates/route.ts      ← Template scaffolding API
    │       └── terminal/route.ts       ← Terminal/shell execution API
    │
    ├── components/
    │   ├── platform/             ← ━━ AgentForge UI Components ━━━━━━━━━━━
    │   │   ├── agent-chat.tsx          ← Chat interface with streaming
    │   │   ├── code-editor.tsx         ← Monaco-style code editor
    │   │   ├── context-panel.tsx       ← Context window inspector
    │   │   ├── correction-panel.tsx    ← Self-correction loop UI
    │   │   ├── file-explorer.tsx       ← File tree browser
    │   │   ├── file-protection-panel.tsx ← Locked files management
    │   │   ├── mcp-registry.tsx        ← MCP server connections
    │   │   ├── preview-panel.tsx       ← Live preview iframe
    │   │   ├── project-manager.tsx     ← Project CRUD
    │   │   ├── project-sidebar.tsx     ← Left sidebar navigation
    │   │   ├── skill-registry.tsx      ← Skill management
    │   │   ├── subchat-panel.tsx       ← Subchat branching UI
    │   │   ├── template-selector.tsx   ← Template picker
    │   │   └── terminal-panel.tsx      ← Terminal emulator
    │   └── ui/                   ← shadcn/ui component library (40+ components)
    │       ├── accordion.tsx … tooltip.tsx
    │
    ├── hooks/
    │   ├── use-mobile.ts
    │   └── use-toast.ts
    │
    ├── lib/                      ← ━━ Core Backend Libraries ━━━━━━━━━━━━━
    │   ├── artifact-writer.ts          ← Bulk artifact-style file creation
    │   ├── code-parser.ts              ← Parse LLM output into code files
    │   ├── context-manager.ts          ← ⭐ Chef-inspired context management
    │   │                                (hysteresis, LRU files, tool abbreviation,
    │   │                                 prompt caching architecture)
    │   ├── db.ts                       ← Prisma client singleton
    │   ├── diff-editor.ts              ← Surgical find-and-replace editing
    │   ├── event-bus.ts                ← Typed event bus for observability
    │   ├── extension-system.ts         ← Hook system (beforeChat, afterChat, etc.)
    │   ├── file-protection.ts          ← Locked files / write protection
    │   ├── filesystem.ts              ← Project workspace file operations
    │   ├── function-calling.ts         ← Native + text-based tool calling
    │   ├── llm-provider.ts            ← ⭐ Multi-provider LLM registry
    │   │                                (ZAI, OpenAI, Anthropic, Google, Groq,
    │   │                                 DeepSeek, Ollama, Azure, OpenRouter)
    │   │                                with rate-limit-aware fallback chains
    │   ├── mcp-client.ts              ← MCP JSON-RPC 2.0 client
    │   ├── mcp-tools.ts               ← MCP tool integration + parallel execution
    │   ├── message-compression.ts     ← LZ4-style message compression
    │   ├── prompt-library.ts          ← Domain-specific prompt libraries
    │   ├── self-correction.ts         ← Edit → typecheck → fix loop
    │   ├── session-store.ts           ← JSONL session tree with branching
    │   ├── skill-prompts.ts           ← Skill-based system prompt builder
    │   ├── subchat-manager.ts         ← Lightweight conversation branching
    │   ├── template-engine.ts         ← Opinionated project templates
    │   ├── terminal.ts                ← Sandboxed shell execution
    │   └── utils.ts                   ← cn() utility (clsx + tailwind-merge)
    │
    ├── stores/
    │   ├── agent-store.ts             ← Zustand store (agents, messages, state)
    │   └── skill-store.ts             ← Zustand store (skills, categories)
    │
    └── __tests__/                ← ━━ Test Suites ━━━━━━━━━━━━━━━━━━━━━━━
        ├── setup.ts
        ├── helpers/api-helpers.ts
        ├── lib/                        ← 18 unit test files
        ├── stores/                     ← 2 store test files
        ├── integration/               ← 8 API integration test files
        ├── e2e/                       ← 3 end-to-end test files
        └── nonfunctional/             ← Performance + security tests
```

---

## 11. Architecture Overview

### Request Flow (Chat)

```
Browser (React)
  │
  │ POST /api/agent/chat
  │ { messages, projectId, model, provider, skills, sessionId }
  │
  ▼
API Route (src/app/api/agent/chat/route.ts)
  │
  ├── 1. Validate request
  ├── 2. Load/create session (SessionStore)
  ├── 3. Fetch project context (Prisma → SQLite)
  ├── 4. Build system prompt (SkillPrompts + tools + diff-edit instructions)
  ├── 5. Build context window (ContextManager)
  │      ├── Apply hysteresis truncation
  │      ├── Inject LRU files
  │      ├── Abbreviate old tool results
  │      └── Build cached prompt (static + dynamic parts)
  ├── 6. Execute extension hooks (ExtensionSystem)
  ├── 7. Call LLM via LLMProviderRegistry
  │      ├── Route to correct provider (ZAI, OpenAI, Anthropic, etc.)
  │      ├── Stream response chunks to browser
  │      └── On failure → chatWithFallback (rate-limit-aware fallback chain)
  ├── 8. Parse tool calls (native or [TOOL_CALL] text)
  ├── 9. Execute tools in parallel (MCPTools)
  │      ├── Check file protection (FileProtection)
  │      ├── Execute via MCPClient or built-in
  │      └── Feed results back to LLM
  ├── 10. Repeat steps 7-9 up to MAX_TOOL_ITERATIONS (5)
  ├── 11. Parse code files from response (CodeParser)
  ├── 12. Write files to workspace (Filesystem)
  ├── 13. Save messages to DB (Prisma) + session (SessionStore)
  └── 14. Return streaming response
```

### Provider Fallback Chain

When the primary provider fails with a rate-limit error (429, 529, 503), the registry automatically falls back through the chain:

```
Priority 0:  ZAI (glm-4-flash, glm-4-plus, glm-4-long)   ← always available
Priority 1:  OpenAI (gpt-4o, gpt-3.5-turbo, o1, o3-mini)
Priority 2:  Anthropic (claude-3.5-sonnet, claude-3-opus)
Priority 3:  Google (gemini-2.0-flash, gemini-1.5-pro)
Priority 4:  DeepSeek (deepseek-chat, deepseek-coder)
Priority 5:  Groq (llama-3.1-70b, mixtral-8x7b)
Priority 6:  Together AI
Priority 8:  OpenRouter (gateway to 100+ models)
Priority 50: Ollama (local models)
```

Each provider is tracked for rate-limit cooldowns. The `RateLimitTracker` implements exponential backoff with jitter.

---

## 12. Available Scripts

From `package.json`:

| Script | Command | Description |
|---|---|---|
| `dev` | `next dev -p 3000 2>&1 \| tee dev.log` | Start dev server with logging |
| `build` | `next build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/` | Production build (standalone output) |
| `start` | `NODE_ENV=production bun .next/standalone/server.js` | Run production build |
| `lint` | `eslint .` | Run ESLint |
| `test` | `vitest run` | Run all tests once |
| `test:watch` | `vitest` | Run tests in watch mode |
| `db:push` | `prisma db push` | Push schema changes to SQLite |
| `db:generate` | `prisma generate` | Regenerate Prisma client |
| `db:migrate` | `prisma migrate dev` | Create & apply migration |
| `db:reset` | `prisma migrate reset` | Reset database (destructive) |

---

## 13. LLM Provider Configuration

### Default (ZAI)

The app uses `z-ai-web-dev-sdk` as the default LLM provider. It works without any API key configuration. The default model is `glm-4-flash`.

Available ZAI models:
| Model | Context Window | Speed | Quality |
|---|---|---|---|
| `glm-4-flash` | 128K | Fastest | Good |
| `glm-4-plus` | 128K | Medium | Better |
| `glm-4-long` | 1M | Slow | Good (long context) |
| `glm-4` | 128K | Medium | Best |
| `glm-3-turbo` | 32K | Fastest | Basic |

### Adding OpenAI

```bash
# Add to .env.local
echo 'OPENAI_API_KEY=sk-your-key-here' >> .env.local

# Restart the dev server
# The LLMProviderRegistry will auto-detect the key and register OpenAI
```

### Adding Ollama (Local Models)

```bash
# Start Ollama
ollama serve &

# Pull a model
ollama pull llama3.1
ollama pull codellama

# The Ollama provider auto-registers at http://localhost:11434
# It discovers available models dynamically
```

### Adding Multiple Providers (Fallback Chain)

```bash
# All providers with keys will be auto-registered on startup
# Priority order determines the fallback chain
cat >> .env.local << 'EOF'
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_AI_API_KEY=AIza...
GROQ_API_KEY=gsk_...
DEEPSEEK_API_KEY=sk-...
EOF

# Restart dev server
bun run dev
```

---

## 14. Troubleshooting

### Port 3000 already in use

```bash
# Find and kill the process
lsof -i :3000
kill -9 <PID>

# Or use a different port
PORT=3001 bun run dev
```

### Prisma client not generated

```bash
# Regenerate the client
bunx prisma generate

# If that fails, clear the cache
rm -rf node_modules/.prisma
bunx prisma generate
```

### SQLite database locked

```bash
# Stop the dev server first
# Then reset if needed
rm prisma/dev.db
bunx prisma db push
```

### `z-ai-web-dev-sdk` import errors

```bash
# Ensure the package is installed
bun add z-ai-web-dev-sdk

# If using npm:
# npm install z-ai-web-dev-sdk
```

### Node.js version mismatch

```bash
# Check your version
node --version

# Install nvm for version management
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc

# Install and use Node.js 22
nvm install 22
nvm use 22
```

### Tests failing due to missing Prisma client

```bash
# Generate Prisma client before running tests
bunx prisma generate
bun run test
```

### Bun vs npm

The project's `bun.lock` is included, but `npm install` works identically. Use whichever you prefer:

```bash
# Bun (faster)
bun install

# npm (more compatible)
npm install
```

### Workspace directory permissions

The `workspace/` directory must be writable by the Node.js process:

```bash
# Check permissions
ls -la workspace/

# Fix if needed
chmod 755 workspace/
```

### Tailwind CSS not compiling

```bash
# Clear Next.js cache
rm -rf .next
bun run dev
```

### TypeScript errors in VS Code

```bash
# Ensure the TypeScript version in VS Code matches the project
# Press Ctrl+Shift+P → "TypeScript: Select TypeScript Version"
# Choose "Use Workspace Version" (from node_modules/typescript)
```

---

## Quick Start (One-Command Summary)

```bash
# From a fresh Arch Linux install:
sudo pacman -Syu --needed nodejs npm base-devel sqlite git
curl -fsSL https://bun.sh/install | bash && source ~/.bashrc
cd ~/projects && unzip /path/to/agentforge1.2.zip && cd agentforge
echo 'OPENAI_API_KEY=sk-your-key' > .env.local   # optional
bun install
bunx prisma generate && bunx prisma db push
bun run dev
# → Open http://localhost:3000
```
