---
name: plan-prd
description: "Markdown-staged planning files. PRD → Plan → Generate → PR. Each phase is a committed markdown file the next phase consumes. Diffable, resumable, survives context resets."
metadata:
  origin: ECC
  category: planning
  version: 1.0.0
---

# Plan-PRD-Pattern Skill

Markdown-staged planning files that survive context resets. Borrows the `docs/PLAN-PRD-PATTERN.md` pattern from affaan-m/ecc.

## When to Use
- Any non-trivial feature (2+ files)
- Multi-session generation jobs
- When you need resumable, diffable plans

## When NOT to Use
- Single-file trivial changes
- Quick experiments

## The Pattern
Each planning phase is a **committed markdown file** the next phase consumes via path argument:

```
/prd "<idea>"     → .agentforge/prds/X.prd.md    (users, scope, acceptance criteria)
/plan <prd>       → .agentforge/plans/X.plan.md  (file list, build sequence, validation)
/generate <plan>  → src/                         (the actual codegen)
/pr               → GitHub PR                     (links back to prd + plan)
```

## Why Markdown Files (not conversation memory)
- **Diffable** — you can see what changed between plan versions
- **Resumable** — a 6-hour generation job can be interrupted and resumed
- **Composable** — multiple agents can read the same plan file
- **Auditable** — the plan is on disk, not in a chat log that scrolls away

## PRD Structure
```markdown
# PRD: [Title]
**ID:** prd-xxxxx
**Created:** [timestamp]

## Problem
[The user's idea/problem statement]

## Target Users
- [User persona 1]
- [User persona 2]

## Scope
### In Scope
- [Feature 1]
### Out of Scope
- [Phase 2+ features]

## Acceptance Criteria
1. [Criterion 1]
2. [Criterion 2]
```

## Plan Structure
```markdown
# Plan: [Title]
**ID:** plan-xxxxx
**PRD ID:** prd-xxxxx

## Architecture
[Design decisions and rationale]

## Files to Create
| # | Path | Purpose | Priority |
|---|------|---------|----------|

## Build Sequence
1. types and interfaces
2. core logic
3. integration layer
4. UI components
5. tests
6. documentation

## Validation Commands
- npx tsc --noEmit
- npm test
- npm run build
```

## Integration
- **API**: `POST /api/plan-prd { action, projectId, ... }`
- **Lib**: `createPRD()`, `createPlan()`, `loadPRD()`, `loadPlan()` in `src/lib/plan-prd.ts`

## Related Skills
- `code-architect` — generates the plan's file table + build sequence
- `orch-pipeline` — classifies the plan's size tier and determines gate requirements
