---
name: santa-loop
description: "Adversarial dual-reviewer convergence. Two independent reviewers must BOTH pass before push. Max 3 rounds, fresh reviewers each round. Strongest pre-merge gate."
metadata:
  origin: ECC
  category: review-gate
  version: 1.0.0
---

# Santa Loop Skill

An adversarial dual-reviewer convergence loop. Borrows the `commands/santa-loop.md` pattern from affaan-m/ecc. This is the strongest pre-merge quality gate.

## When to Use
- Before pushing/committing code to a shared branch
- For standard/large changes (per orch-pipeline classification)
- When "good enough" isn't good enough — you need two independent confirmations

## When NOT to Use
- Trivial changes (1 file, no deps) — overkill
- During active development (use after you think you're done)
- When you don't have two reviewer models available

## Workflow
```
Step 1: Launch Reviewer A (primary) + Reviewer B (secondary) in PARALLEL
        — each gets full rubric + files, NO shared context
        — return structured verdict: { verdict: PASS|FAIL, findings[] }

Step 2: Verdict Gate
        — Both PASS → NICE → push
        — Either FAIL → NAUGHTY

Step 3: NAUGHTY path
        — Fix all flagged issues
        — Commit fixes (so they're preserved if loop is interrupted)
        — Re-run Step 1 with FRESH reviewers (no memory of previous rounds)

Step 4: Push ONLY when both PASS — never mid-loop.

Maximum: 3 iterations. After 3 NAUGHTY rounds: ESCALATE to human, do NOT push.
```

## Key Design Choices
- **Fresh reviewers each round** — prevents anchoring bias from prior findings
- **Commits happen on NAUGHTY rounds** — fixes are preserved if the loop is interrupted
- **Push only after NICE** — never mid-loop

## Reviewer A vs Reviewer B
- **Reviewer A**: Primary review with standard confidence threshold (0.8), all categories
- **Reviewer B**: Security/error-handling focus with stricter confidence threshold (0.6), filters to security + error-handling + bug categories

In production, Reviewer B should be a **different model family** (e.g. GPT-5 or Gemini) for true independence. The current implementation simulates this with different rule priorities.

## Output Format
```
═════════════ SANTA LOOP REPORT ═════════════
Rounds: 2
Final verdict: NICE
Pushed: ✅ YES

### Round 1: NAUGHTY
  Reviewer A: FAIL — 3 findings (1 critical, 2 high)
  Reviewer B: PASS — 0 findings
  Fixes: 3

### Round 2: NICE
  Reviewer A: PASS — 0 findings
  Reviewer B: PASS — 0 findings

✅ Both reviewers passed — ready to push.
═══════════════════════════════════════════════
```

## Integration
- **API**: `POST /api/santa-loop { projectId }`
- **Lib**: `runSantaLoop(config)` in `src/lib/santa-loop.ts`
- **Chat Route**: Available as an optional pre-commit gate for standard/large changes

## Related Skills
- `code-reviewer` — used as Reviewer A and Reviewer B
- `orch-pipeline` — determines whether to invoke Santa Loop based on tier
