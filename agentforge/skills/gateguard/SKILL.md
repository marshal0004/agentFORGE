---
name: gateguard
description: "Fact-forcing PreToolUse hook. Before first write per file, demands importers list, exports list, data file structure, user instruction quote. DENY→FORCE→ALLOW. +2.25 points vs ungated agents."
metadata:
  origin: ECC
  category: pre-write-gate
  version: 1.0.0
---

# Gateguard Skill

A fact-forcing PreToolUse hook that demands concrete facts before the first write to each file. Borrows the `skills/gateguard/SKILL.md` pattern from affaan-m/ecc.

## When to Use
- Automatically invoked before every `write_file` / `edit_file` / `execute_code` call
- Only gates the FIRST write to each file per session

## When NOT to Use
- Read operations (not gated)
- Subsequent writes to the same file (already forced on first write)

## The Philosophical Claim
> "LLM self-evaluation doesn't work. Ask 'did you violate any policies?' and the answer is always 'no.' But asking 'list every file that imports this module' forces Grep+Read. **The investigation itself creates context that changes the output.**"

## Three-Stage Decision: DENY → FORCE → ALLOW

### ALLOW
The tool call proceeds normally. Facts are gathered but no force is needed.
- Condition: First write to a file with no downstream impact (no importers)
- OR: User instruction is provided in context

### FORCE
The tool call proceeds, but a "forced investigation" prompt is injected into the tool result. The LLM must read it before the next iteration.
- Condition: First write to a file WITH downstream impact (has importers) but no user instruction provided
- The investigation includes: importers list, exports list, data file usage

### DENY
The tool call is blocked. The LLM must provide the required facts before retrying.
- Condition: Not currently used (reserved for future stricter mode)

## Facts Gathered (the "investigation")
1. **Importers** — all files that import this file (via Grep)
2. **Exports** — public functions/classes in the file (if it exists)
3. **Data file usage** — if the file reads/writes JSON/CSV/etc, show field names + structure
4. **User instruction** — quote the user's verbatim instruction for this task

## A/B Test Evidence
From ECC: **+2.25 points vs ungated agents** on identical tasks. The investigation itself (Grep + Read) creates context that changes the LLM's output, even though the LLM never explicitly "answers" the questions.

## Integration
- **Lib**: `evaluateGateguard(ctx)` in `src/lib/gateguard.ts`
- **Chat Route**: Invoked before every write_file/edit_file call
- **Session**: `resetGateguardSession()` called at the start of each chat request

## Related Skills
- `tool-validator` — runs AFTER gateguard (validates params, checks path traversal)
- `post-edit-typecheck` — runs AFTER the write (feeds back type errors)
