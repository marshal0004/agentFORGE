---
name: code-architect
description: "Types-first build sequence planner. Forces types → core → integration → UI → tests → docs order. Prevents import-not-found errors. Use before generating multi-file features."
metadata:
  origin: ECC
  category: planning
  version: 1.0.0
---

# Code Architect Skill

A types-first build sequence planner. Borrows the `agents/code-architect.md` pattern from affaan-m/ecc.

## When to Use
- Before generating any multi-file feature
- When you need consistent imports across generated files
- As input to the Plan-PRD-Pattern

## The Fixed Build Sequence
```
1. types and interfaces     ← ALWAYS FIRST
2. core logic               ← imports from types
3. integration layer        ← imports from types + core
4. UI components            ← imports from types + core
5. tests                    ← imports from all layers
6. documentation            ← no runtime impact
```

**Why types first?** Types are imported by ALL other files. Defining them first prevents "import not found" errors and ensures consistent naming. agentFORGE's freeform planner decides file order ad-hoc — this is why imports break.

## Output Schema
```markdown
## Files to Create
| File | Purpose | Priority |
|------|---------|----------|
| src/types/user.ts | Type definitions | critical |
| src/lib/user.ts | Core logic | high |
| src/app/api/user/route.ts | API route | high |
| src/app/user/page.tsx | UI page | high |

## Build Sequence
1. types and interfaces
2. core logic
3. integration layer
4. UI components
5. tests
6. documentation
```

## File Classification Rules
- `src/types/` or `*.types.ts` → **types**
- `src/lib/` or `src/utils/` → **core**
- `src/app/api/` or `route.ts` → **integration**
- `.tsx` or `src/app/` or `src/components/` → **ui**
- `*.test.ts` or `*.spec.ts` → **tests**
- `*.md` or `docs/` → **docs**

## Complexity Classification
| Tier | Trigger | Files Generated |
|------|---------|-----------------|
| trivial | 1 feature, no auth/db | types + (UI OR core) |
| small | 1-2 features | types + core + UI + tests |
| standard | 3+ features | types + core + integration + UI + tests |
| large | auth/payment/realtime | types + core + integration + UI + tests + docs |

## Integration
- **Lib**: `generateArchitecturePlan(config)` in `src/lib/code-architect.ts`
- **Helper**: `classifyFile(path)` → BuildPhase
- **Helper**: `sortFilesByBuildPhase(files)` → sorted files
- **Helper**: `validateBuildSequence(files)` → violations list

## Related Skills
- `plan-prd` — the architect's output feeds into the Plan's file table
- `orch-pipeline` — uses the architect's complexity classification
