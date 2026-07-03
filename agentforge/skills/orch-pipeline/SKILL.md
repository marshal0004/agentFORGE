---
name: orch-pipeline
description: "Size classifier + 2-gate model. Classifies tasks as trivial/small/standard/large, applies the right amount of ceremony. Gate 1 (plan approval) and Gate 2 (commit approval) prevent runaway generation and unwanted commits."
metadata:
  origin: ECC
  category: orchestration
  version: 1.0.0
---

# ORCH Pipeline Skill

A size classifier + 2-gate orchestration pipeline. Borrows the `skills/orch-pipeline/SKILL.md` pattern from affaan-m/ecc.

## When to Use
- Before starting any generation task
- To determine how much ceremony (planning, review, gates) is needed

## Size Classification

| Tier | Trigger | Pipeline | Gates |
|------|---------|----------|-------|
| trivial | 1 file, no deps, no ambiguity | implement + review | none |
| small | 1-2 files, no high ambiguity | plan + implement + review | none |
| standard | 2-5 files OR new dep OR security touch | intake → research → plan → ★GATE 1 → implement → review → commit | Gate 1 |
| large | >10 files OR >500 lines OR auth/payment | intake → research → plan → ★GATE 1 → scaffold → implement → review → ★GATE 2 → commit | Gate 1 + Gate 2 |

## Security Trigger Rule
Any file touching auth, database, crypto, secrets, file system, eval, CORS, or payments is **forced to at least `standard`** regardless of file count. This prevents under-engineering security-sensitive code.

## Two Gates

### Gate 1: Plan Approval (standard + large)
After the planner produces a plan, the pipeline PAUSES. The user must approve the plan before implementation begins.
- **Prevents**: Agent writing 50 files based on a plan the user hasn't seen
- **Message**: `GATE 1 — Plan Approval Required (standard tier). Type "approve" to proceed.`

### Gate 2: Commit Approval (large only)
Before the agent commits, the pipeline PAUSES. The user must approve the diff.
- **Prevents**: Agent committing without user review
- **Message**: `GATE 2 — Commit Approval Required (large tier). Type "approve" to commit.`

Between the gates, work flows autonomously without stopping.

## Why Not Always Full Pipeline?
- **Trivial fix** (1 file, no deps): Full pipeline wastes tokens on planning for a 1-line fix
- **Large refactor** (15 files): Skipping gates risks expensive mistakes

The classifier right-sizes the ceremony to the task.

## Integration
- **Lib**: `classifyTask(input)` in `src/lib/orch-pipeline.ts`
- **Lib**: `requestGate1Approval(classification, planSummary)`
- **Lib**: `requestGate2Approval(classification, diffSummary)`
- **Lib**: `getPipelineDescription(tier)`

## Related Skills
- `code-architect` — generates the plan that Gate 1 approves
- `santa-loop` — invoked for standard/large tiers as an additional gate
- `plan-prd` — the plan files that Gate 1 reviews
