---
name: eval-harness
description: "pass@k / pass^k metrics for reliability tracking. 3 grader types (code/model/human). Use to track whether agent output is getting better or worse over time. CI-gateable reliability number."
metadata:
  origin: ECC
  category: evaluation
  version: 1.0.0
---

# Eval Harness Skill

pass@k / pass^k metrics for measurable reliability tracking. Borrows the `skills/eval-harness/SKILL.md` pattern from affaan-m/ecc.

## When to Use
- To track agent reliability over time
- As a CI gate before releasing agent updates
- To compare agent versions (A/B testing)

## When NOT to Use
- For single-run quality checks (use `agent-self-evaluation` instead)
- During active development

## Two Metrics

### pass@k — "at least one success in k attempts"
- **Target**: pass@3 > 90% for capability evals
- **Meaning**: "If we try 3 times, at least one attempt will succeed"
- **Use for**: Capability evaluation (can the agent do this at all?)

### pass^k — "all k trials succeed"
- **Target**: pass^3 = 100% for release-critical regression evals
- **Meaning**: "Every attempt succeeds — the agent is reliable"
- **Use for**: Regression testing (does this still work every time?)

## Three Grader Types

### Code-based (deterministic)
Runs a command and checks:
- Exit code (default: 0)
- Output must contain / must not contain specific strings
- Example: `{ command: "npm test", expectedExitCode: 0 }`

### Model-based (LLM-as-judge)
Uses a rubric to score the output:
- Checks for file structure (package.json, tsconfig.json, src/, tests, docs)
- Scores 0-1, passes if ≥ passThreshold (default 0.7)
- Example: `{ rubric: "Has proper Next.js structure", passThreshold: 0.7 }`

### Human (manual)
Requires manual adjudication:
- Returns "pending human review" when run
- Verdict submitted via separate API endpoint
- Use for: subjective quality, UX, design

## Eval Definition Format
```markdown
# Eval: [Name]
**Grader:** code
**Metric:** pass-at-k
**Trials:** 3
**Target:** 90.0%

## Grader Config
{ "command": "npm test", "expectedExitCode": 0 }
```

## Baseline Tracking
Every eval run is logged to `.agentforge/evals/baseline.json` with:
- Last pass rate
- Last run timestamp
- History (last 100 runs)

This lets you track reliability trends over time.

## Integration
- **API**: `POST /api/eval-harness { action, projectId, ... }`
- **Lib**: `runEval(workspaceDir, evalDef)` in `src/lib/eval-harness.ts`
- **Storage**: `.agentforge/evals/<id>.md` (definitions), `.agentforge/evals/<id>.log.jsonl` (trials), `.agentforge/evals/baseline.json` (history)

## Related Skills
- `agent-self-evaluation` — per-run quality score (this skill tracks trends)
- `verification-loop` — provides the build/test status that code-based graders check
