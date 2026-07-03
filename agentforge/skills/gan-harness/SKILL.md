---
name: gan-harness
description: "GAN generator↔evaluator loop for full-app generation. Use for premium-tier 'build from scratch' tasks. Separate evaluator context, file-based feedback, plateau detection, 4 weighted axes."
metadata:
  origin: ECC
  category: generation-loop
  version: 1.0.0
---

# GAN Harness Skill

A generator↔evaluator loop for iterative full-app generation. Borrows the `skills/gan-style-harness/SKILL.md` pattern from affaan-m/ecc. This is how emergent.sh and Z.ai agent mode produce polished UIs.

## When to Use
- "Build a full app from a one-line brief"
- Premium-tier generation where single-pass output isn't good enough
- Visual app generation requiring design iteration

## When NOT to Use
- Single-file changes (overkill)
- Quick fixes (use build-error-resolver instead)
- Non-visual backends (use code-only eval mode)

## Critical Design Rules

### 1. Evaluator is SEPARATE from Generator
The evaluator must be a **separate agent process** from the generator — never the same context window.
> "The reviewer never wrote the code it reviews. This eliminates author bias — the most common source of missed issues in self-review."

### 2. File-Based Feedback
Feedback is written to `gan-harness/feedback/feedback-NNN.md` — NOT passed inline. This survives context resets and lets the generator read previous feedback at the start of each iteration.

### 3. Evaluator Tests the LIVE App
The evaluator runs against the live running app (Playwright), not screenshots or code review. For non-UI projects, use `code-only` eval mode.

### 4. Plateau Detection
If `iteration >= 3` and score has not improved in last `2` iterations → **stop early**. Prevents wasting iterations on a stuck generator.

## 4 Weighted Axes
| Axis | Weight | What it measures |
|------|--------|------------------|
| Design | 0.3 | File structure, naming, CSS presence |
| Originality | 0.2 | Custom files vs boilerplate |
| Craft | 0.3 | Error handling, type safety, code quality |
| Functionality | 0.2 | Build succeeds, entry points exist, typecheck passes |

**Pass threshold: 7.0/10** (weighted sum)

## Loop Pseudocode
```
iteration = 1
while iteration <= 15:
    GENERATE  → generator reads spec + previous feedback, builds/commits
    EVALUATE  → evaluator (SEPARATE CONTEXT) tests the live app, scores 4 axes
    if score >= 7.0:  break (PASS)
    if iteration >= 3 and score not improved in last 2 iters:  break (PLATEAU)
    iteration += 1
```

## Anti-Patterns (from ECC)
- Evaluator praising its own fixes
- Generator ignoring feedback
- Infinite loops without exit conditions
- Evaluator testing superficially

## Integration
- **API**: `POST /api/gan { projectId, iteration }`
- **Lib**: `runGANLoop(config, generator)` in `src/lib/gan-harness.ts`
- **Chat Route**: Available as a premium-tier option (not auto-invoked)

## Related Skills
- `verification-loop` — runs after GAN loop completes
- `santa-loop` — can run after GAN for additional gate
