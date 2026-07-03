---
name: verification-loop
description: "6-phase post-generation verification gate. Use PROACTIVELY after creating files to verify Build → Types → Lint → Tests → Security → Diff. Stops on first failure, emits structured VERIFICATION REPORT."
metadata:
  origin: ECC
  category: verification
  version: 1.0.0
---

# Verification Loop Skill

A comprehensive 6-phase verification system for AgentForge sessions. Borrows the `skills/verification-loop/SKILL.md` pattern from affaan-m/ecc.

## When to Use
- After completing a feature or significant code change
- Before declaring a project "done"
- When you want to ensure quality gates pass
- After refactoring

## When NOT to Use
- Mid-generation (use per-edit typecheck instead)
- For single-file trivial changes (overkill)

## Verification Phases

### Phase 1: Build Verification
Runs `npm run build` (or project-appropriate build command). Fails if the build exits non-zero.

### Phase 2: Type Check
Runs `npx tsc --noEmit`. Counts `error TS####` lines and reports the count.

### Phase 3: Lint Check
Runs `npm run lint` if a lint script exists in package.json. Skipped if no lint script.

### Phase 4: Test Suite
Runs `npm test`. Parses `N passing` / `N failing` from output. Reports pass/fail counts and coverage percentage if available.

### Phase 5: Security Scan
Scans all source files for common secret patterns:
- AWS Access Keys (`AKIA[0-9A-Z]{16}`)
- GitHub Tokens (`gh[pousr]_[0-9a-zA-Z]{36}`)
- OpenAI API Keys (`sk-[a-zA-Z0-9]{48}`)
- Private Key blocks (`-----BEGIN PRIVATE KEY-----`)

### Phase 6: Diff Review
Compares planned files against files on disk. Fails if any planned file is missing.

## Stop-on-First-Failure
Phases run SEQUENTIALLY. If any phase fails, remaining phases are SKIPPED. This is intentional — if the build fails, there's no point running tests.

## Output Format
```
═════════════ VERIFICATION REPORT ═════════════
✅ Build      PASS npm run build succeeded
✅ Types      PASS tsc --noEmit passed
✅ Lint       PASS npm run lint passed
✅ Tests      PASS 12/12 passed
✅ Security   PASS No secrets detected
✅ Diff       PASS 8 files, all 8 planned present
Passed: 6  Failed: 0  Skipped: 0
Overall: ✅ READY for PR
═══════════════════════════════════════════════
```

## Integration
- **API**: `POST /api/verify { projectId, plannedFiles }`
- **Lib**: `runVerificationLoop(workspaceDir, plannedFiles)` in `src/lib/verification.ts`
- **Chat Route**: Automatically invoked after agent loop completes

## Related Skills
- `build-error-resolver` — invoked when this loop's Build or Types phase fails
- `code-reviewer` — runs after this loop passes, for semantic review
- `agent-self-evaluation` — runs after this loop, for agent output quality assessment
