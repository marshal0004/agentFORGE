---
name: code-reviewer
description: "Code review specialist with Pre-Report Gate and false-positive filtering. Use after code is written. Zero findings is a valid review. Blocks on critical security issues."
metadata:
  origin: ECC
  category: review
  version: 1.0.0
---

# Code Reviewer Skill

A code review agent that produces structured findings with confidence filtering and false-positive suppression. Borrows the `agents/code-reviewer.md` pattern from affaan-m/ecc.

## When to Use
- After code is written and build passes
- Before committing changes
- As part of the Santa Loop dual-reviewer convergence

## When NOT to Use
- Build is broken → use `build-error-resolver` first
- You need to run tests → use `verification-loop`

## Pre-Report Gate (4 Questions)
Before reporting ANY finding, answer these 4 questions. If any answer is "no", DROP the finding:

1. Can I cite the **exact line**?
2. Can I describe the **concrete failure mode**?
3. Have I **read the surrounding context**?
4. Is the **severity defensible**?

## Common False Positives (SKIP THESE)
- Missing JSDoc on single-purpose helpers
- N+1 on fixed-cardinality loops (e.g. 3 items)
- Math.random() in non-crypto contexts
- console.log in development code
- Missing await on fire-and-forget calls
- Magic numbers for well-known constants (200, 404, 1000ms, 60, 24)
- Suggesting optional chaining where value is guaranteed non-null
- Prefer-const suggestions where let is intentional
- Missing explicit return type where TS infers correctly
- Subjective early-return preferences
- Vague "consider using X" suggestions

## "Zero Findings is a Valid Review"
**It Is Acceptable And Expected To Return Zero Findings.** Manufactured findings, filler nits, and speculative "consider using X" are the primary failure mode of LLM reviewers. If the code is clean, say so.

## Analysis Rules
1. **empty-catch** (high) — Empty catch block swallows errors
2. **sql-injection** (critical) — String interpolation in SQL queries
3. **hardcoded-secret** (critical) — API keys, tokens in source code
4. **dangerous-fallback** (medium) — `.catch(() => [])` hides errors
5. **todo-fixme** (low) — TODO/FIXME comments left in code
6. **any-type** (medium) — Explicit `any` bypasses type safety

## Verdict
- **APPROVE** — no critical/high findings (zero findings is valid)
- **WARNING** — high findings present (reviewer recommends fixes but doesn't block)
- **BLOCK** — critical findings present (must fix before proceeding)

## Integration
- **API**: `POST /api/code-review { projectId }`
- **Lib**: `reviewProject(config)` in `src/lib/code-reviewer.ts`
- **Chat Route**: Automatically invoked after verification-loop passes

## Related Skills
- `verification-loop` — runs before this skill
- `santa-loop` — uses this skill as Reviewer A
- `agent-self-evaluation` — runs after this skill
