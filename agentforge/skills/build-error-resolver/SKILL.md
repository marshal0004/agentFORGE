---
name: build-error-resolver
description: "Build and TypeScript error resolution specialist. Use PROACTIVELY when build fails or tsc reports errors. 3-attempt cap per error, minimal surgical fixes, never refactors."
metadata:
  origin: ECC
  category: error-resolution
  version: 1.0.0
---

# Build Error Resolver Skill

A dedicated agent that fixes build errors with a strict contract. Borrows the `agents/build-error-resolver.md` pattern from affaan-m/ecc.

## When to Use
- `npm run build` fails
- `npx tsc --noEmit` reports errors
- The verification-loop's Build or Types phase fails

## When NOT to Use
- Code needs refactoring → use a general-purpose agent
- Architecture changes needed → escalate to human
- The error is a test failure (not a build error) → use test-runner

## Core Responsibilities
1. Collect ALL build errors from `tsc --noEmit` output
2. Fix each error with MINIMAL changes (no refactoring)
3. Re-run build after each fix to verify
4. Stop if fix introduces more errors than it resolves

## Fix Strategies (in order)
1. **Add missing import** — for `Cannot find name/module` errors
2. **Add null/undefined guard** — for type assignment errors
3. **Add missing semicolon** — for syntax errors

## Stop Conditions (UNIVERSAL — never violated)
Stop and report if:
- Same error persists after **3 fix attempts**
- Fix introduces **more errors** than it resolves
- Error requires **architectural changes** beyond build resolution
- No automatic fix strategy applies (architectural scope)

## Success Metrics
- `npx tsc --noEmit` exits with code 0
- No new errors introduced
- Minimal lines changed (< 5% of affected file)

## Output Format
```
✅ All build errors resolved.
Fixed 5 error(s) in 7 attempt(s).
Files modified: src/index.ts, src/app/page.tsx
```
OR
```
❌ Stopped: same error persists after 3 attempts.
Error: src/index.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'
```

## Integration
- **API**: `POST /api/build-fix { projectId }`
- **Lib**: `resolveBuildErrors(config)` in `src/lib/build-error-resolver.ts`
- **Chat Route**: Automatically invoked when verification-loop detects build failures

## Related Skills
- `verification-loop` — triggers this skill when Build/Types phase fails
- `code-reviewer` — runs after this skill succeeds
