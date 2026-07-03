/**
 * Project Verification Loop (Borrowed from ECC Pattern)
 *
 * After the agent loop finishes (toolCalls=0), this module runs a
 * multi-phase verification to determine if the project is actually
 * complete.  If verification fails, the failure report is fed back
 * into the agent loop as a tool result so the agent can fix issues.
 *
 * Phases:
 *   1. File existence — all planned files exist on disk
 *   2. Build verification — `npm run build` succeeds (for Next.js)
 *   3. Type check — `tsc --noEmit` passes (if tsconfig.json exists)
 *   4. Lint check — `npm run lint` passes (if configured)
 *   5. Dependency install — node_modules exists, no missing deps
 *   6. Entry point check — key entry files (page.tsx, layout.tsx) exist
 */

import { exec } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import { promisify } from 'util'
import { listProjectFiles, fileExists, readProjectFile } from './filesystem'

const execAsync = promisify(exec)

// ── Types ────────────────────────────────────────────────────────────────────

export interface VerificationPhase {
  name: string
  status: 'pass' | 'fail' | 'skip' | 'error'
  message: string
  details?: string
}

export interface VerificationResult {
  complete: boolean
  phases: VerificationPhase[]
  score: number        // 0-1, fraction of passed phases
  report: string       // Human-readable summary for agent context
  missingFiles: string[]
  buildErrors: string[]
}

// ── Config ───────────────────────────────────────────────────────────────────

const BUILD_TIMEOUT_MS = 120_000  // 2 min
const TYPECHECK_TIMEOUT_MS = 60_000
const LINT_TIMEOUT_MS = 60_000
const INSTALL_TIMEOUT_MS = 180_000 // 3 min for npm install

// ── Phase Implementations ────────────────────────────────────────────────────

async function phaseFileExistence(
  projectId: string,
  plannedFiles: string[],
): Promise<VerificationPhase> {
  const missing: string[] = []
  const onDisk = await listProjectFiles(projectId)
  const onDiskSet = new Set(onDisk)

  for (const planned of plannedFiles) {
    if (!onDiskSet.has(planned)) {
      missing.push(planned)
    }
  }

  if (missing.length === 0) {
    return {
      name: 'File Existence',
      status: 'pass',
      message: `All ${plannedFiles.length} planned files exist on disk`,
    }
  }

  return {
    name: 'File Existence',
    status: 'fail',
    message: `${missing.length}/${plannedFiles.length} planned files are missing`,
    details: missing.join('\n'),
  }
}

async function phaseDependencyInstall(
  projectDir: string,
): Promise<VerificationPhase> {
  const nodeModulesExists = await fs.access(path.join(projectDir, 'node_modules'))
    .then(() => true)
    .catch(() => false)

  if (nodeModulesExists) {
    return {
      name: 'Dependency Install',
      status: 'pass',
      message: 'node_modules exists',
    }
  }

  // Check if package.json exists
  const pkgJsonExists = await fs.access(path.join(projectDir, 'package.json'))
    .then(() => true)
    .catch(() => false)

  if (!pkgJsonExists) {
    return {
      name: 'Dependency Install',
      status: 'skip',
      message: 'No package.json found — not a Node.js project',
    }
  }

  // Try to install
  try {
    await execAsync('npm install --legacy-peer-deps 2>&1', {
      cwd: projectDir,
      timeout: INSTALL_TIMEOUT_MS,
    })
    return {
      name: 'Dependency Install',
      status: 'pass',
      message: 'npm install completed successfully',
    }
  } catch (err: any) {
    return {
      name: 'Dependency Install',
      status: 'fail',
      message: `npm install failed: ${err.message?.substring(0, 500) || 'unknown error'}`,
      details: err.stdout?.substring(0, 2000) || err.stderr?.substring(0, 2000) || '',
    }
  }
}

async function phaseBuildVerification(
  projectDir: string,
): Promise<VerificationPhase> {
  const pkgJsonPath = path.join(projectDir, 'package.json')
  const pkgJsonExists = await fs.access(pkgJsonPath)
    .then(() => true)
    .catch(() => false)

  if (!pkgJsonExists) {
    return {
      name: 'Build Verification',
      status: 'skip',
      message: 'No package.json — skipping build check',
    }
  }

  // Check if build script exists
  try {
    const pkgContent = await fs.readFile(pkgJsonPath, 'utf-8')
    const pkg = JSON.parse(pkgContent)
    if (!pkg.scripts?.build) {
      return {
        name: 'Build Verification',
        status: 'skip',
        message: 'No build script in package.json',
      }
    }
  } catch {
    return {
      name: 'Build Verification',
      status: 'error',
      message: 'Failed to parse package.json',
    }
  }

  // Ensure node_modules first
  const nodeModulesExists = await fs.access(path.join(projectDir, 'node_modules'))
    .then(() => true)
    .catch(() => false)

  if (!nodeModulesExists) {
    try {
      await execAsync('npm install --legacy-peer-deps 2>&1', {
        cwd: projectDir,
        timeout: INSTALL_TIMEOUT_MS,
      })
    } catch {
      return {
        name: 'Build Verification',
        status: 'fail',
        message: 'Cannot build: npm install failed',
      }
    }
  }

  try {
    const { stdout, stderr } = await execAsync('npm run build 2>&1', {
      cwd: projectDir,
      timeout: BUILD_TIMEOUT_MS,
    })
    return {
      name: 'Build Verification',
      status: 'pass',
      message: 'Build completed successfully',
    }
  } catch (err: any) {
    const errorOutput = (err.stdout || '') + (err.stderr || '')
    return {
      name: 'Build Verification',
      status: 'fail',
      message: `Build failed: ${err.message?.substring(0, 300) || 'unknown'}`,
      details: errorOutput.substring(0, 3000),
    }
  }
}

async function phaseTypeCheck(
  projectDir: string,
): Promise<VerificationPhase> {
  const tsconfigPath = path.join(projectDir, 'tsconfig.json')
  const tsconfigExists = await fs.access(tsconfigPath)
    .then(() => true)
    .catch(() => false)

  if (!tsconfigExists) {
    return {
      name: 'Type Check',
      status: 'skip',
      message: 'No tsconfig.json — not a TypeScript project',
    }
  }

  try {
    await execAsync('npx tsc --noEmit 2>&1', {
      cwd: projectDir,
      timeout: TYPECHECK_TIMEOUT_MS,
    })
    return {
      name: 'Type Check',
      status: 'pass',
      message: 'TypeScript compilation passed',
    }
  } catch (err: any) {
    const output = (err.stdout || '') + (err.stderr || '')
    return {
      name: 'Type Check',
      status: 'fail',
      message: `TypeScript errors found`,
      details: output.substring(0, 3000),
    }
  }
}

async function phaseEntryPointCheck(
  projectId: string,
): Promise<VerificationPhase> {
  const files = await listProjectFiles(projectId)
  const fileSet = new Set(files)

  // Check common entry points for different project types
  const entryPoints: Record<string, string[]> = {
    'Next.js App Router': ['src/app/layout.tsx', 'src/app/page.tsx'],
    'Next.js Pages': ['src/pages/index.tsx', 'src/pages/_app.tsx'],
    'React SPA': ['src/index.tsx', 'src/App.tsx'],
    'Plain HTML': ['index.html'],
  }

  const detectedType = Object.entries(entryPoints).find(([_, entries]) =>
    entries.some(e => fileSet.has(e)),
  )

  if (!detectedType) {
    return {
      name: 'Entry Point Check',
      status: 'fail',
      message: 'No recognized entry point found (no layout.tsx, page.tsx, index.html, etc.)',
    }
  }

  const [projectType, requiredEntries] = detectedType
  const missingEntries = requiredEntries.filter(e => !fileSet.has(e))

  if (missingEntries.length === 0) {
    return {
      name: 'Entry Point Check',
      status: 'pass',
      message: `${projectType} project: all entry points exist`,
    }
  }

  return {
    name: 'Entry Point Check',
    status: 'fail',
    message: `${projectType}: missing entry points: ${missingEntries.join(', ')}`,
  }
}

// ── Main Verification Runner ─────────────────────────────────────────────────

/**
 * Run the full verification suite against a project workspace.
 *
 * @param projectId - The project ID (used to resolve workspace path)
 * @param plannedFiles - List of file paths the agent planned to create
 * @param workspaceDir - Absolute path to the project workspace directory
 * @returns VerificationResult with pass/fail status and detailed report
 */
export async function verifyProject(
  projectId: string,
  plannedFiles: string[],
  workspaceDir: string,
): Promise<VerificationResult> {
  const phases: VerificationPhase[] = []
  const buildErrors: string[] = []

  // Phase 1: File existence
  const filePhase = await phaseFileExistence(projectId, plannedFiles)
  phases.push(filePhase)

  // Phase 2: Dependency install
  const installPhase = await phaseDependencyInstall(workspaceDir)
  phases.push(installPhase)

  // Phase 3: Build verification
  const buildPhase = await phaseBuildVerification(workspaceDir)
  phases.push(buildPhase)
  if (buildPhase.status === 'fail' && buildPhase.details) {
    buildErrors.push(buildPhase.details)
  }

  // Phase 4: Type check
  const typePhase = await phaseTypeCheck(workspaceDir)
  phases.push(typePhase)

  // Phase 5: Entry point check
  const entryPhase = await phaseEntryPointCheck(projectId)
  phases.push(entryPhase)

  // Compute score
  const scoredPhases = phases.filter(p => p.status !== 'skip')
  const passedPhases = scoredPhases.filter(p => p.status === 'pass')
  const score = scoredPhases.length > 0 ? passedPhases.length / scoredPhases.length : 0

  // Determine completion
  const criticalFailures = phases.filter(
    p => p.status === 'fail' && (p.name === 'File Existence' || p.name === 'Entry Point Check')
  )
  const complete = criticalFailures.length === 0 && score >= 0.6

  // Build human-readable report for agent context
  const missingFiles = filePhase.status === 'fail'
    ? (filePhase.details || '').split('\n').filter(Boolean)
    : []

  const report = buildVerificationReport(phases, score, complete)

  return {
    complete,
    phases,
    score,
    report,
    missingFiles,
    buildErrors,
  }
}

function buildVerificationReport(
  phases: VerificationPhase[],
  score: number,
  complete: boolean,
): string {
  const lines: string[] = [
    '═══ PROJECT VERIFICATION REPORT ═══',
    `Overall: ${complete ? '✅ COMPLETE' : '❌ INCOMPLETE'} (score: ${Math.round(score * 100)}%)`,
    '',
  ]

  for (const phase of phases) {
    const icon = phase.status === 'pass' ? '✅'
      : phase.status === 'fail' ? '❌'
      : phase.status === 'skip' ? '⏭️'
      : '⚠️'
    lines.push(`${icon} ${phase.name}: ${phase.message}`)
    if (phase.details && phase.status === 'fail') {
      lines.push(`   Details: ${phase.details.substring(0, 500)}`)
    }
  }

  if (!complete) {
    lines.push('')
    lines.push('ACTION REQUIRED: The project is NOT complete. Continue creating the missing files and fixing the errors listed above.')
  }

  return lines.join('\n')
}

/**
 * Lightweight check: just verify planned files exist, without running
 * expensive build/typecheck phases. Used mid-loop for progress tracking.
 */
export async function quickFileCheck(
  projectId: string,
  plannedFiles: string[],
): Promise<{ existing: string[]; missing: string[] }> {
  const onDisk = await listProjectFiles(projectId)
  const onDiskSet = new Set(onDisk)

  const existing: string[] = []
  const missing: string[] = []

  for (const planned of plannedFiles) {
    // v1.3: Check exact match, then with common prefixes, then by basename
    if (onDiskSet.has(planned)) {
      existing.push(planned)
    } else if (onDiskSet.has('frontend/' + planned)) {
      existing.push(planned)
    } else if (onDiskSet.has('backend/' + planned)) {
      existing.push(planned)
    } else {
      // Check by basename (e.g., "components/Header.jsx" matches "frontend/components/Header.jsx")
      const basename = planned.split('/').pop()
      const found = basename && onDisk.some(f => f.endsWith('/' + basename) || f === basename)
      if (found) {
        existing.push(planned)
      } else {
        missing.push(planned)
      }
    }
  }

  return { existing, missing }
}

// ── v1.3: ECC 6-Phase Verification Loop ─────────────────────────────────────

export interface VerificationLoopPhase {
  name: string
  status: 'pass' | 'fail' | 'skip'
  message: string
  details?: string
  durationMs: number
}

export interface VerificationLoopResult {
  phases: VerificationLoopPhase[]
  overall: 'READY' | 'NOT_READY'
  report: string
  passedCount: number
  failedCount: number
  skippedCount: number
  totalDurationMs: number
}

async function runCmd(cmd: string, cwd: string, timeoutMs: number): Promise<string> {
  try {
    const r = await execAsync(cmd, { cwd, timeout: timeoutMs, maxBuffer: 5 * 1024 * 1024, env: { ...process.env, CI: 'true', FORCE_COLOR: '0' } })
    return (r.stdout || '') + (r.stderr || '')
  } catch (err) {
    const e = err as Error & { stdout?: string; stderr?: string; killed?: boolean }
    if (e.killed) throw new Error(`Timed out after ${timeoutMs}ms`)
    throw new Error(([e.stdout, e.stderr].filter(Boolean).join('\n')) || e.message)
  }
}

async function vlBuild(dir: string): Promise<VerificationLoopPhase> {
  const s = Date.now()
  // v1.3: Check root package.json first, then frontend/ subdirectory
  const hasRootPkg = await fs.access(path.join(dir, 'package.json')).then(() => true).catch(() => false)
  const hasFrontendPkg = await fs.access(path.join(dir, 'frontend', 'package.json')).then(() => true).catch(() => false)
  
  if (!hasRootPkg && !hasFrontendPkg)
    return { name: 'Build', status: 'skip', message: 'No package.json (root or frontend/)', durationMs: 0 }
  
  const buildDir = hasRootPkg ? dir : path.join(dir, 'frontend')
  try {
    await runCmd('npm run build 2>&1', buildDir, 120000)
    return { name: 'Build', status: 'pass', message: `npm run build succeeded (${path.relative(dir, buildDir) || 'root'})`, durationMs: Date.now() - s }
  } catch (e) {
    return { name: 'Build', status: 'fail', message: 'npm run build failed', details: String(e).substring(0, 2000), durationMs: Date.now() - s }
  }
}

async function vlTypes(dir: string): Promise<VerificationLoopPhase> {
  const s = Date.now()
  const hasRootTsconfig = await fs.access(path.join(dir, 'tsconfig.json')).then(() => true).catch(() => false)
  const hasFrontendTsconfig = await fs.access(path.join(dir, 'frontend', 'tsconfig.json')).then(() => true).catch(() => false)
  if (!hasRootTsconfig && !hasFrontendTsconfig)
    return { name: 'Types', status: 'skip', message: 'No tsconfig.json', durationMs: 0 }
  const tsDir = hasRootTsconfig ? dir : path.join(dir, 'frontend')
  try {
    await runCmd('npx tsc --noEmit 2>&1', tsDir, 60000)
    return { name: 'Types', status: 'pass', message: 'tsc --noEmit passed', durationMs: Date.now() - s }
  } catch (e) {
    const c = (String(e).match(/error TS\d+:/g) || []).length
    return { name: 'Types', status: 'fail', message: `tsc failed (${c} error${c === 1 ? '' : 's'})`, details: String(e).substring(0, 2000), durationMs: Date.now() - s }
  }
}

async function vlLint(dir: string): Promise<VerificationLoopPhase> {
  const s = Date.now()
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf-8'))
    if (!pkg.scripts?.lint) return { name: 'Lint', status: 'skip', message: 'No lint script', durationMs: 0 }
  } catch { return { name: 'Lint', status: 'skip', message: 'No package.json', durationMs: 0 } }
  try {
    await runCmd('npm run lint 2>&1', dir, 60000)
    return { name: 'Lint', status: 'pass', message: 'npm run lint passed', durationMs: Date.now() - s }
  } catch (e) {
    return { name: 'Lint', status: 'fail', message: 'npm run lint failed', details: String(e).substring(0, 2000), durationMs: Date.now() - s }
  }
}

async function vlTests(dir: string): Promise<VerificationLoopPhase> {
  const s = Date.now()
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf-8'))
    if (!pkg.scripts?.test) return { name: 'Tests', status: 'skip', message: 'No test script', durationMs: 0 }
  } catch { return { name: 'Tests', status: 'skip', message: 'No package.json', durationMs: 0 } }
  try {
    const out = await runCmd('npm test 2>&1', dir, 180000)
    const p = parseInt((out.match(/(\d+) passing/) || [])[1] || '0', 10)
    const f = parseInt((out.match(/(\d+) failing/) || [])[1] || '0', 10)
    if (f > 0) return { name: 'Tests', status: 'fail', message: `${p}/${p + f} passed`, details: out.substring(0, 2000), durationMs: Date.now() - s }
    return { name: 'Tests', status: 'pass', message: `${p}/${p + f} passed`, durationMs: Date.now() - s }
  } catch (e) {
    return { name: 'Tests', status: 'fail', message: 'npm test failed', details: String(e).substring(0, 2000), durationMs: Date.now() - s }
  }
}

async function vlSecurity(dir: string): Promise<VerificationLoopPhase> {
  const s = Date.now()
  const patterns = [
    { n: 'AWS Key', r: /AKIA[0-9A-Z]{16}/g },
    { n: 'GitHub Token', r: /gh[pousr]_[0-9a-zA-Z]{36}/g },
    { n: 'OpenAI Key', r: /sk-[a-zA-Z0-9]{48}/g },
    { n: 'Private Key', r: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g },
  ]
  const findings: string[] = []
  async function scan(d: string): Promise<void> {
    for (const entry of await fs.readdir(d, { withFileTypes: true })) {
      if (['node_modules', '.git', '.next', 'dist', 'build', 'coverage'].includes(entry.name)) continue
      const fp = path.join(d, entry.name)
      if (entry.isDirectory()) await scan(fp)
      else if (['.ts', '.tsx', '.js', '.jsx', '.json', '.env', '.py'].includes(path.extname(entry.name)) || entry.name === '.env') {
        if (entry.name === 'package-lock.json' || entry.name === 'bun.lock') continue
        try {
          const c = await fs.readFile(fp, 'utf-8')
          for (const { n, r } of patterns) { const m = c.match(r); if (m) findings.push(`${n} in ${path.relative(dir, fp)}`) }
        } catch { /* skip */ }
      }
    }
  }
  try { await scan(dir) } catch { /* skip */ }
  if (findings.length > 0) return { name: 'Security', status: 'fail', message: `${findings.length} secret(s) found`, details: findings.join('\n'), durationMs: Date.now() - s }
  return { name: 'Security', status: 'pass', message: 'No secrets detected', durationMs: Date.now() - s }
}

async function vlDiff(dir: string, planned: string[]): Promise<VerificationLoopPhase> {
  const s = Date.now()
  try {
    const all = await listProjectFiles(path.basename(dir))
    // v1.3: Also check subdirectories (frontend/, backend/) for planned files
    const missing = planned.filter(f => {
      // Check exact match
      if (all.includes(f)) return false
      // Check with frontend/ prefix
      if (all.includes('frontend/' + f)) return false
      // Check with backend/ prefix
      if (all.includes('backend/' + f)) return false
      // Check by filename only (e.g., "Header.jsx" matches "frontend/components/Header.jsx")
      const basename = f.split('/').pop()
      if (basename && all.some(a => a.endsWith('/' + basename))) return false
      return true
    })
    if (missing.length > 0) return { name: 'Diff', status: 'fail', message: `${missing.length} planned file(s) missing`, details: missing.slice(0, 20).join(', '), durationMs: Date.now() - s }
    return { name: 'Diff', status: 'pass', message: `${all.length} files, all ${planned.length} planned present`, durationMs: Date.now() - s }
  } catch (e) {
    return { name: 'Diff', status: 'fail', message: 'Could not enumerate files', details: String(e).substring(0, 500), durationMs: Date.now() - s }
  }
}

export async function runVerificationLoop(workspaceDir: string, plannedFiles: string[] = []): Promise<VerificationLoopResult> {
  const phases: VerificationLoopPhase[] = []
  const start = Date.now()
  const run = async (p: () => Promise<VerificationLoopPhase>): Promise<boolean> => {
    const phase = await p(); phases.push(phase)
    return phase.status !== 'fail'
  }
  if (!await run(() => vlBuild(workspaceDir))) return finalize(phases, start)
  if (!await run(() => vlTypes(workspaceDir))) return finalize(phases, start)
  if (!await run(() => vlLint(workspaceDir))) return finalize(phases, start)
  if (!await run(() => vlTests(workspaceDir))) return finalize(phases, start)
  if (!await run(() => vlSecurity(workspaceDir))) return finalize(phases, start)
  await run(() => vlDiff(workspaceDir, plannedFiles))
  return finalize(phases, start)
}

function finalize(phases: VerificationLoopPhase[], start: number): VerificationLoopResult {
  const p = phases.filter(x => x.status === 'pass').length
  const f = phases.filter(x => x.status === 'fail').length
  const sk = phases.filter(x => x.status === 'skip').length
  const overall = f === 0 ? 'READY' : 'NOT_READY'
  const lines = ['═════════════ VERIFICATION REPORT ═════════════']
  for (const ph of phases) {
    const icon = ph.status === 'pass' ? '✅' : ph.status === 'fail' ? '❌' : '⏭️'
    lines.push(`${icon} ${ph.name.padEnd(10)} ${ph.status.toUpperCase().padEnd(4)} ${ph.message}`)
  }
  lines.push(`Passed: ${p}  Failed: ${f}  Skipped: ${sk}`)
  lines.push(`Overall: ${overall === 'READY' ? '✅ READY for PR' : '❌ NOT READY'}`)
  return { phases, overall, report: lines.join('\n'), passedCount: p, failedCount: f, skippedCount: sk, totalDurationMs: Date.now() - start }
}

// ── v1.3: Build Error Parser (for build-error-resolver) ─────────────────────

export function parseBuildErrors(output: string): Array<{ file: string; line?: number; column?: number; code?: string; message: string; raw: string }> {
  const errors: Array<{ file: string; line?: number; column?: number; code?: string; message: string; raw: string }> = []
  const seen = new Set<string>()
  const tsRe = /^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)$/gm
  let m: RegExpExecArray | null
  while ((m = tsRe.exec(output)) !== null) {
    const key = `${m[1]}:${m[2]}:${m[4]}`
    if (!seen.has(key)) { seen.add(key); errors.push({ file: m[1]!, line: +m[2]!, column: +m[3]!, code: m[4]!, message: m[5]!, raw: m[0] }) }
  }
  return errors
}
