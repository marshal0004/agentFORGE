---
name: agent-self-evaluation
description: "5-axis deterministic self-evaluation rubric. Scores Accuracy/Completeness/Clarity/Actionability/Conciseness using regex heuristics. No LLM judge needed for first pass. Verdict: deliver-as-is / fix-issues / redo."
metadata:
  origin: ECC
  category: evaluation
  version: 1.0.0
---

# Agent Self-Evaluation Skill

A deterministic 5-axis self-evaluation rubric. Borrows the `skills/agent-self-evaluation/SKILL.md` + `scripts/evaluate.py` pattern from affaan-m/ecc.

## When to Use
- After the agent loop completes
- As a final quality check before declaring "done"
- To track agent output quality over time

## 5 Axes (1-5 each, total 5-25)

### 1. Accuracy (1-5)
- **Positive signals**: "tests pass", "exit code 0", "lint clean", "type check passed"
- **Negative signals**: "should work", "I think", "untested", "TODO/FIXME"
- **Hard signals**: buildSucceeded, testsPassed, typecheckPassed (+1/-1 each)

### 2. Completeness (1-5)
- File count (5+ files = +1, 0 files = -1)
- Coverage ≥80% = +1
- Lint passed = +0.5

### 3. Clarity (1-5)
- Reasonable length (50-2000 words) = +0.5
- Has headings = +0.5
- Has code blocks = +0.5
- Too short (<50 words) = -1
- Too many vague words = -0.5

### 4. Actionability (1-5)
- Specific file paths referenced = +0.5
- Specific commands referenced = +0.5
- Delegates work to user ("you should run...") = -0.5

### 5. Conciseness (1-5)
- Words per file <50 = +1 (concise)
- Words per file 150-500 = reasonable
- Words per file >500 = -1 (verbose)
- Repetitive content = -0.5

## Verdict
| Percentage | Critical Issues | Verdict |
|------------|----------------|---------|
| ≥80% | 0 | **deliver-as-is** |
| ≥50% | any | **fix-issues-then-deliver** |
| <50% | any | **redo-from-scratch** |

Critical issues = axes with score ≤ 2.

## Why Deterministic (not LLM judge)?
- **Cheap**: no extra LLM call needed
- **Reproducible**: same input → same score every time
- **Fast**: regex heuristics run in <1ms
- **Catches obvious slop**: "I think this should work" is a reliable negative signal that an LLM judge would miss

## Output Format
```
═════════════ AGENT SELF-EVALUATION REPORT ═════════════
Total Score: 18/25 (72.0%)
Verdict: FIX ISSUES THEN DELIVER

## Axis Scores
  accuracy        ████░ 4/5
    → Build succeeded
    → Tests passed
  completeness    ████░ 4/5
    → 5 files
  clarity         ████░ 4/5
    → Reasonable length
    → Has headings
  actionability   █████ 5/5
    → 3 file paths
    → 2 commands
  conciseness     █░░░░ 1/5
    → Verbose (250 words/file)

## Top Improvements
  1. [conciseness] Verbose
═══════════════════════════════════════════════════════
```

## Integration
- **API**: `POST /api/self-eval { agentResponse, filesWritten, ... }`
- **Lib**: `evaluateAgentOutput(input)` in `src/lib/agent-self-evaluation.ts`
- **Chat Route**: Automatically invoked after code-reviewer

## Related Skills
- `verification-loop` — provides buildSucceeded/testsPassed inputs
- `code-reviewer` — runs before this skill
- `eval-harness` — tracks pass@k metrics over time (this skill is per-run)
