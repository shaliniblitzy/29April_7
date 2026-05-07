#!/usr/bin/env ts-node
/**
 * Script: e2e/scripts/merge-tier-reports.ts
 *
 * Purpose
 * -------
 * Merge per-tier Playwright reports (e.g., `playwright-report-tier-1`,
 * `playwright-report-tier-2`, `playwright-report-tier-3`) produced by the
 * 3-tier CI workflow defined in the Agent Action Plan (sections 0.4.1 and
 * 0.5.1.14) into a single consolidated report directory
 * (`playwright-report-merged/`) so reviewers can see all three tiers' results
 * in one CI artifact.
 *
 * Two strategies are supported:
 *
 *   1. **Blob-merge strategy** (preferred when blob reports are present):
 *      invokes `playwright merge-reports` from the locally installed
 *      Playwright CLI to produce a unified HTML report from blob artifacts.
 *      This is the canonical Playwright approach as of 1.45+. To enable it,
 *      set the `E2E_BLOB_REPORTS_DIR` env var to a directory containing
 *      `.zip` blob reports AND configure `playwright.config.ts` to emit
 *      blob reports (e.g., `reporter: [['blob']]`).
 *
 *   2. **Copy-merge strategy** (fallback when only HTML/JSON reports exist):
 *      copies each tier's report subdirectory into the merged output and
 *      writes a self-contained `index.html` that links to each tier's
 *      report. This is the default path because the AAP-mandated reporter
 *      configuration is `[['html'], ['junit'], ['github']]` (see AAP §0.5.2)
 *      with no blob reporter.
 *
 * Inputs (env vars)
 * -----------------
 *   E2E_REPORTS_INPUT_ROOT  Root directory containing per-tier reports
 *                           (default: `process.cwd()`).
 *
 *   E2E_MERGED_REPORT_DIR   Output directory for the consolidated report
 *                           (default: `playwright-report-merged`).
 *
 *   E2E_TIER_REPORT_NAMES   Comma-separated tier directory names to merge
 *                           (default:
 *                           `playwright-report-tier-1,playwright-report-tier-2,
 *                            playwright-report-tier-3`).
 *
 *   E2E_BLOB_REPORTS_DIR    Optional. If set and the directory exists, the
 *                           script attempts the blob-merge strategy via
 *                           `playwright merge-reports`. On failure, falls
 *                           back to copy-merge.
 *
 * Outputs
 * -------
 *   playwright-report-merged/                 Consolidated report directory.
 *   playwright-report-merged/index.html       Top-level navigation HTML
 *                                             (copy-merge strategy only).
 *   playwright-report-merged/summary.json     Aggregate stats
 *                                             (machine-readable, both
 *                                             strategies).
 *   playwright-report-merged/tier-1/, tier-2/, tier-3/
 *                                             Per-tier HTML report copies
 *                                             (copy-merge strategy only).
 *
 * Exit codes
 * ----------
 *   0   On successful merge (even if some tiers were missing - the script is
 *       failure-tolerant on per-tier errors).
 *   1   On fatal error (e.g., output directory cannot be created, or ALL
 *       tiers are missing).
 *
 * Future extension point
 * ----------------------
 * A future revision can compare the current `summary.json` against a
 * `previous-summary.json` checked-in baseline to surface tiers that have
 * DEGRADED. The `AggregatedSummary` shape is already stable enough to support
 * this.
 *
 * Per AAP sections 0.5.1.15 and 0.5.1.14.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync, type SpawnSyncReturns } from 'child_process';

// ---------------------------------------------------------------------------
// Public types (also re-exported at bottom of file)
// ---------------------------------------------------------------------------

/**
 * Resolved configuration for a single merge invocation.
 * Constructed by `resolveConfig()` from environment variables, with sane
 * defaults aligned to the AAP-mandated tier-report directory naming.
 */
interface MergerConfig {
  /** Root directory containing per-tier report subdirectories. */
  inputRoot: string;
  /** Destination directory for the consolidated report. */
  outputDir: string;
  /** Per-tier directory names (relative to `inputRoot`). */
  tierReportNames: string[];
  /** Optional blob-reports directory; when present, blob-merge is attempted. */
  blobReportsDir?: string;
}

/** Per-tier metadata gathered during discovery. */
interface TierReport {
  /** Short tier-specific name (e.g., 'tier-1' from 'playwright-report-tier-1'). */
  name: string;
  /** Source directory path (input). */
  sourceDir: string;
  /** True when `sourceDir` exists on disk and is a directory. */
  exists: boolean;
  /** Optional summary stats parsed from the tier's results JSON. */
  summary?: TierSummary;
}

/**
 * Summary stats for a single tier. Mirrors the shape of Playwright's JSON
 * reporter `stats` block (with `durationMs` substituted for `duration`).
 */
interface TierSummary {
  expected: number;
  unexpected: number;
  flaky: number;
  skipped: number;
  durationMs: number;
  startTime?: string;
}

/**
 * Aggregated cross-tier summary, written as `summary.json` in the output
 * directory. Consumed by CI dashboards that surface a single score for the
 * whole 3-tier run.
 */
interface AggregatedSummary {
  generatedAt: string;
  inputRoot: string;
  outputDir: string;
  strategy: 'blob-merge' | 'copy-merge';
  tiers: Array<{
    name: string;
    sourceDir: string;
    exists: boolean;
    copied: boolean;
    summary?: TierSummary;
  }>;
  aggregate: {
    expected: number;
    unexpected: number;
    flaky: number;
    skipped: number;
    durationMs: number;
  };
}

// ---------------------------------------------------------------------------
// Configuration resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the merger configuration from environment variables, applying
 * AAP-aligned defaults for any unset value. Throws when
 * `E2E_TIER_REPORT_NAMES` is set to an empty / whitespace-only string.
 */
function resolveConfig(): MergerConfig {
  const inputRoot = process.env.E2E_REPORTS_INPUT_ROOT
    ? path.resolve(process.env.E2E_REPORTS_INPUT_ROOT)
    : process.cwd();

  const outputDir = process.env.E2E_MERGED_REPORT_DIR
    ? path.resolve(process.env.E2E_MERGED_REPORT_DIR)
    : path.resolve(process.cwd(), 'playwright-report-merged');

  const tierNamesRaw =
    process.env.E2E_TIER_REPORT_NAMES ||
    'playwright-report-tier-1,playwright-report-tier-2,playwright-report-tier-3';

  const tierReportNames = tierNamesRaw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const blobReportsDir = process.env.E2E_BLOB_REPORTS_DIR
    ? path.resolve(process.env.E2E_BLOB_REPORTS_DIR)
    : undefined;

  if (tierReportNames.length === 0) {
    throw new Error('[merge-tier-reports] E2E_TIER_REPORT_NAMES must contain at least one entry');
  }

  const config: MergerConfig = { inputRoot, outputDir, tierReportNames };
  if (blobReportsDir) {
    config.blobReportsDir = blobReportsDir;
  }
  return config;
}

// ---------------------------------------------------------------------------
// Tier report discovery and summary parsing
// ---------------------------------------------------------------------------

/**
 * Attempt to extract a `TierSummary` from the conventional locations a
 * Playwright report may write JSON results. Returns `undefined` when no
 * suitable JSON file is found or none parses to the expected shape.
 *
 * The HTML reporter does not, by default, emit a summary JSON inside its
 * output directory. The JSON reporter writes `test-results.json` adjacent to
 * (not inside) the HTML output. We probe several common locations so that
 * either reporter configuration produces useful summaries.
 */
function parseTierSummary(reportDir: string): TierSummary | undefined {
  const candidates = [
    path.join(reportDir, 'summary.json'),
    path.join(reportDir, 'results.json'),
    path.join(reportDir, '..', 'test-results', 'results.json'),
    path.join(reportDir, '..', 'test-results.json'),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const raw = fs.readFileSync(candidate, 'utf-8');
      const parsed = JSON.parse(raw) as { stats?: Partial<TierSummary> } & Partial<TierSummary>;
      // Playwright JSON reports nest stats under a `stats` property, but a
      // hand-authored `summary.json` may use the flat shape directly.
      const stats: Partial<TierSummary> | undefined = parsed.stats ?? parsed;
      if (stats && typeof stats === 'object' && typeof stats.expected === 'number') {
        const summary: TierSummary = {
          expected: stats.expected ?? 0,
          unexpected: stats.unexpected ?? 0,
          flaky: stats.flaky ?? 0,
          skipped: stats.skipped ?? 0,
          durationMs: stats.durationMs ?? 0,
        };
        if (typeof stats.startTime === 'string') {
          summary.startTime = stats.startTime;
        }
        return summary;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[merge-tier-reports] Failed to parse summary from ${candidate}: ${msg}`);
    }
  }
  return undefined;
}

/**
 * Discover all per-tier report directories named in `config.tierReportNames`
 * under `config.inputRoot`. Returns one `TierReport` per configured name -
 * the `exists` flag distinguishes present from missing directories so the
 * caller can render a complete table even when some tiers failed.
 */
function discoverTierReports(config: MergerConfig): TierReport[] {
  return config.tierReportNames.map((dirName) => {
    const sourceDir = path.join(config.inputRoot, dirName);
    let exists = false;
    try {
      exists = fs.existsSync(sourceDir) && fs.statSync(sourceDir).isDirectory();
    } catch {
      // statSync can throw on permission errors; treat as missing.
      exists = false;
    }
    // Derive a short name: 'playwright-report-tier-1' -> 'tier-1'.
    const shortName = dirName.replace(/^playwright-report-?/, '') || dirName;
    const summary = exists ? parseTierSummary(sourceDir) : undefined;
    const report: TierReport = { name: shortName, sourceDir, exists };
    if (summary) {
      report.summary = summary;
    }
    return report;
  });
}

// ---------------------------------------------------------------------------
// Output directory preparation and recursive copy helper
// ---------------------------------------------------------------------------

/**
 * Prepare the output directory: create it if missing, OR clear its contents
 * (preserving the directory inode) if it already exists. Some CI runners
 * track artifact directories by path/inode, so removing-and-recreating the
 * directory could break artifact upload steps; clearing in-place is safer.
 */
function prepareOutputDir(outputDir: string): void {
  if (fs.existsSync(outputDir)) {
    const entries = fs.readdirSync(outputDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(outputDir, entry.name);
      try {
        if (entry.isDirectory()) {
          fs.rmSync(entryPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(entryPath);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[merge-tier-reports] Failed to clear ${entryPath}: ${msg}`);
      }
    }
  } else {
    fs.mkdirSync(outputDir, { recursive: true });
  }
}

/**
 * Recursively copy `src` to `dst`. Uses Node 20's stable `fs.cpSync` to
 * avoid implementing a manual walker that has to handle symlinks, cross-
 * filesystem copies, and sparse files. Per AAP §0.6.1 / §0.10.2, Node 20.x
 * is the pinned runtime for the test process.
 */
function copyDirRecursive(src: string, dst: string): void {
  fs.cpSync(src, dst, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Strategy 1: Blob merge via the Playwright CLI
// ---------------------------------------------------------------------------

/**
 * Walk up from `rootDir` looking for `node_modules/.bin/playwright` (or its
 * `.cmd` shim on Windows). Capped at 5 directory levels to prevent runaway
 * filesystem walks in unusual mount configurations. Returns `null` when no
 * Playwright CLI is found - callers must fall back to copy-merge.
 */
function resolvePlaywrightBin(rootDir: string): string | null {
  let dir = rootDir;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'node_modules', '.bin', 'playwright');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const candidateCmd = `${candidate}.cmd`;
    if (fs.existsSync(candidateCmd)) {
      return candidateCmd;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Attempt the blob-merge strategy. Returns true on success, false (with a
 * warning logged) when the strategy is unavailable or fails - the caller
 * then falls back to copy-merge.
 *
 * Activation conditions:
 *   - `config.blobReportsDir` must be set AND exist on disk.
 *   - The Playwright CLI must be resolvable in the local node_modules.
 *
 * Spawning is synchronous with `stdio: 'inherit'` so that the script's log
 * order remains deterministic and Playwright's own output is streamed
 * directly to the user/CI log.
 */
function blobMergeStrategy(config: MergerConfig): boolean {
  if (!config.blobReportsDir) {
    return false;
  }
  if (!fs.existsSync(config.blobReportsDir)) {
    console.warn(
      `[merge-tier-reports] E2E_BLOB_REPORTS_DIR='${config.blobReportsDir}' does not exist; ` +
        'falling back to copy strategy',
    );
    return false;
  }

  console.log(
    `[merge-tier-reports] Using blob-merge strategy: input=${config.blobReportsDir}, ` +
      `output=${config.outputDir}`,
  );

  const playwrightBin = resolvePlaywrightBin(config.inputRoot);
  if (!playwrightBin) {
    console.warn(
      '[merge-tier-reports] Cannot locate playwright CLI in node_modules/.bin/; ' +
        'falling back to copy strategy',
    );
    return false;
  }

  const args = [
    'merge-reports',
    '--reporter',
    `html,{outputFolder:${JSON.stringify(config.outputDir)}}`,
    config.blobReportsDir,
  ];

  let result: SpawnSyncReturns<Buffer>;
  try {
    result = spawnSync(playwrightBin, args, {
      stdio: 'inherit',
      cwd: config.inputRoot,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[merge-tier-reports] spawnSync threw while invoking playwright: ${msg}; ` +
        'falling back to copy strategy',
    );
    return false;
  }

  if (result.error || result.status !== 0) {
    const errMsg = result.error instanceof Error ? result.error.message : 'none';
    console.warn(
      `[merge-tier-reports] playwright merge-reports failed (status=${result.status}, ` +
        `error=${errMsg}); falling back to copy strategy`,
    );
    return false;
  }

  console.log('[merge-tier-reports] Blob merge succeeded.');
  return true;
}

// ---------------------------------------------------------------------------
// Strategy 2: Copy merge (default fallback)
// ---------------------------------------------------------------------------

/**
 * Copy each present tier's report directory into a per-tier subdirectory of
 * `config.outputDir`. Missing tiers are skipped with a warning - the script
 * is failure-tolerant on per-tier errors so a flaky CI step that fails one
 * tier still yields a partial merged report for the remaining tiers.
 */
function copyMergeStrategy(
  config: MergerConfig,
  tiers: TierReport[],
): { copiedTiers: string[]; missingTiers: string[] } {
  const copiedTiers: string[] = [];
  const missingTiers: string[] = [];

  for (const tier of tiers) {
    if (!tier.exists) {
      missingTiers.push(tier.name);
      console.warn(`[merge-tier-reports] Tier '${tier.name}' source missing: ${tier.sourceDir}`);
      continue;
    }
    const dst = path.join(config.outputDir, tier.name);
    try {
      copyDirRecursive(tier.sourceDir, dst);
      copiedTiers.push(tier.name);
      console.log(`[merge-tier-reports] Copied ${tier.sourceDir} -> ${dst}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[merge-tier-reports] Failed to copy ${tier.sourceDir}: ${msg}`);
      missingTiers.push(tier.name);
    }
  }

  return { copiedTiers, missingTiers };
}

// ---------------------------------------------------------------------------
// HTML index generation (copy-merge strategy only)
// ---------------------------------------------------------------------------

/** Escape an arbitrary string for safe interpolation into HTML body/attributes. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format a duration in milliseconds as a human-readable string. */
function formatDuration(ms: number): string {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return '\u2014';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Build a self-contained HTML index page that lists every configured tier
 * with its status, summary stats, and a deep link into the per-tier HTML
 * report (when copied successfully). All CSS is inlined so the page renders
 * correctly when opened directly from the file system, served from a static
 * artifact host, or attached to an email.
 */
function generateIndexHtml(
  config: MergerConfig,
  tiers: TierReport[],
  copiedTiers: string[],
): string {
  const lines: string[] = [];
  lines.push('<!DOCTYPE html>');
  lines.push('<html lang="en">');
  lines.push('<head>');
  lines.push('  <meta charset="UTF-8">');
  lines.push('  <title>Whoville-Client E2E - Merged Tier Reports</title>');
  lines.push('  <style>');
  lines.push(
    '    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;' +
      ' margin: 2rem; color: #1f2328; }',
  );
  lines.push('    h1 { color: #0969da; }');
  lines.push('    h2 { margin-top: 2rem; }');
  lines.push('    table { border-collapse: collapse; width: 100%; margin-top: 1rem; }');
  lines.push(
    '    th, td { border: 1px solid #d0d7de; padding: 0.5rem 0.75rem; text-align: left; }',
  );
  lines.push('    th { background: #f6f8fa; font-weight: 600; }');
  lines.push('    tr:nth-child(even) { background: #f6f8fa; }');
  lines.push('    .pass { color: #1a7f37; font-weight: 600; }');
  lines.push('    .fail { color: #cf222e; font-weight: 600; }');
  lines.push('    .flaky { color: #d4a72c; font-weight: 600; }');
  lines.push('    .skipped { color: #6e7781; }');
  lines.push('    a { color: #0969da; text-decoration: none; }');
  lines.push('    a:hover { text-decoration: underline; }');
  lines.push('    .footer { margin-top: 3rem; color: #6e7781; font-size: 0.9em; }');
  lines.push('    code { background: #f6f8fa; padding: 0.1rem 0.3rem; border-radius: 3px; }');
  lines.push('  </style>');
  lines.push('</head>');
  lines.push('<body>');
  lines.push('  <h1>Whoville-Client E2E - Merged Tier Reports</h1>');
  lines.push(
    '  <p>Consolidated report aggregating Tier 1 (Smoke), Tier 2 (Feature CRUD),' +
      ' and Tier 3 (Integration / Edge Cases) Playwright runs.</p>',
  );

  lines.push('  <h2>Tier Summary</h2>');
  lines.push('  <table>');
  lines.push('    <thead>');
  lines.push('      <tr>');
  lines.push('        <th>Tier</th>');
  lines.push('        <th>Status</th>');
  lines.push('        <th>Expected</th>');
  lines.push('        <th>Unexpected</th>');
  lines.push('        <th>Flaky</th>');
  lines.push('        <th>Skipped</th>');
  lines.push('        <th>Duration</th>');
  lines.push('        <th>Report</th>');
  lines.push('      </tr>');
  lines.push('    </thead>');
  lines.push('    <tbody>');

  for (const tier of tiers) {
    const reportLink = copiedTiers.includes(tier.name)
      ? `<a href="./${escapeHtml(tier.name)}/index.html">View HTML report \u2192</a>`
      : '<em>missing</em>';
    if (tier.exists && tier.summary) {
      const s = tier.summary;
      const failed = s.unexpected > 0;
      lines.push('      <tr>');
      lines.push(`        <td>${escapeHtml(tier.name)}</td>`);
      lines.push(
        `        <td><span class="${failed ? 'fail' : 'pass'}">` +
          `${failed ? '\u2717 failed' : '\u2713 passed'}</span></td>`,
      );
      lines.push(`        <td class="pass">${s.expected}</td>`);
      lines.push(`        <td class="fail">${s.unexpected}</td>`);
      lines.push(`        <td class="flaky">${s.flaky}</td>`);
      lines.push(`        <td class="skipped">${s.skipped}</td>`);
      lines.push(`        <td>${formatDuration(s.durationMs)}</td>`);
      lines.push(`        <td>${reportLink}</td>`);
      lines.push('      </tr>');
    } else if (tier.exists) {
      lines.push('      <tr>');
      lines.push(`        <td>${escapeHtml(tier.name)}</td>`);
      lines.push('        <td><em>summary unavailable</em></td>');
      lines.push('        <td colspan="5"></td>');
      lines.push(`        <td>${reportLink}</td>`);
      lines.push('      </tr>');
    } else {
      lines.push('      <tr>');
      lines.push(`        <td>${escapeHtml(tier.name)}</td>`);
      lines.push('        <td><em>not found</em></td>');
      lines.push('        <td colspan="5"></td>');
      lines.push('        <td><em>missing</em></td>');
      lines.push('      </tr>');
    }
  }

  lines.push('    </tbody>');
  lines.push('  </table>');

  lines.push('  <div class="footer">');
  lines.push(
    `    <p>Generated by <code>e2e/scripts/merge-tier-reports.ts</code> at ` +
      `${escapeHtml(new Date().toISOString())}.</p>`,
  );
  lines.push(`    <p>Input root: <code>${escapeHtml(config.inputRoot)}</code></p>`);
  lines.push(`    <p>Output: <code>${escapeHtml(config.outputDir)}</code></p>`);
  lines.push('  </div>');

  lines.push('</body>');
  lines.push('</html>');
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Aggregate summary construction
// ---------------------------------------------------------------------------

/**
 * Build the cross-tier `AggregatedSummary` consumed by `summary.json`.
 * Per-tier summary objects contribute to the aggregate counters; tiers that
 * could not be parsed contribute zero, so a degraded run still produces a
 * machine-readable artifact.
 */
function buildAggregatedSummary(
  config: MergerConfig,
  tiers: TierReport[],
  copiedTiers: string[],
  strategy: 'blob-merge' | 'copy-merge',
): AggregatedSummary {
  let expected = 0;
  let unexpected = 0;
  let flaky = 0;
  let skipped = 0;
  let durationMs = 0;

  for (const tier of tiers) {
    if (tier.summary) {
      expected += tier.summary.expected;
      unexpected += tier.summary.unexpected;
      flaky += tier.summary.flaky;
      skipped += tier.summary.skipped;
      durationMs += tier.summary.durationMs;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    inputRoot: config.inputRoot,
    outputDir: config.outputDir,
    strategy,
    tiers: tiers.map((t) => {
      const entry: AggregatedSummary['tiers'][number] = {
        name: t.name,
        sourceDir: t.sourceDir,
        exists: t.exists,
        copied: copiedTiers.includes(t.name),
      };
      if (t.summary) {
        entry.summary = t.summary;
      }
      return entry;
    }),
    aggregate: { expected, unexpected, flaky, skipped, durationMs },
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Entry point. Discovers per-tier reports, prepares the output directory,
 * runs the chosen merge strategy, then emits `summary.json` (always) and
 * `index.html` (copy-merge only). Aborts with exit code 1 only when ALL
 * configured tiers are missing.
 *
 * The function is declared `async` for forward-compatibility: future
 * revisions may replace `spawnSync` with the streaming `spawn` API or add
 * other async I/O (e.g., uploading the merged artifact). The current body
 * is synchronous, so the await of a no-op resolved promise below is the
 * idiomatic Node-script pattern that satisfies static analysis without
 * forcing a signature change.
 */
async function main(): Promise<void> {
  // Reserved async no-op (see JSDoc above). Keeping the async signature
  // stable lets us add real async work without churning every caller.
  await Promise.resolve();

  console.log('[merge-tier-reports] Starting tier-report merge.');
  const config = resolveConfig();
  console.log(`[merge-tier-reports] Input root: ${config.inputRoot}`);
  console.log(`[merge-tier-reports] Output dir: ${config.outputDir}`);
  console.log(`[merge-tier-reports] Tier names: ${config.tierReportNames.join(', ')}`);
  if (config.blobReportsDir) {
    console.log(`[merge-tier-reports] Blob reports dir: ${config.blobReportsDir}`);
  }

  // Discover per-tier sources.
  const tiers = discoverTierReports(config);
  const presentTiers = tiers.filter((t) => t.exists);
  if (presentTiers.length === 0) {
    console.error(
      `[merge-tier-reports] No tier report directories found under ${config.inputRoot}. ` +
        'Aborting.',
    );
    process.exit(1);
  }
  console.log(
    `[merge-tier-reports] Discovered ${presentTiers.length} of ${tiers.length} tier report(s).`,
  );

  // Prepare output directory (clear contents or create).
  prepareOutputDir(config.outputDir);

  // Try blob-merge strategy first; fall back to copy-merge on any failure.
  let strategy: 'blob-merge' | 'copy-merge';
  let copiedTiers: string[] = [];
  if (blobMergeStrategy(config)) {
    strategy = 'blob-merge';
    // For blob merge, we don't write per-tier subdirectories; the output is
    // the unified report. Treat all present tiers as "copied" for summary
    // purposes (the blob reporter merged them into the unified output).
    copiedTiers = presentTiers.map((t) => t.name);
  } else {
    const copyResult = copyMergeStrategy(config, tiers);
    copiedTiers = copyResult.copiedTiers;
    if (copyResult.missingTiers.length > 0) {
      console.warn(
        `[merge-tier-reports] Skipped tiers (missing or failed): ` +
          `${copyResult.missingTiers.join(', ')}`,
      );
    }
    strategy = 'copy-merge';

    // Emit navigation index HTML (copy-merge only - blob merge already wrote
    // its own canonical Playwright HTML at the output root).
    const indexHtml = generateIndexHtml(config, tiers, copiedTiers);
    fs.writeFileSync(path.join(config.outputDir, 'index.html'), indexHtml, 'utf-8');
    console.log('[merge-tier-reports] Wrote index.html.');
  }

  // Emit summary.json regardless of strategy so CI dashboards have a uniform
  // artifact to consume.
  const summary = buildAggregatedSummary(config, tiers, copiedTiers, strategy);
  fs.writeFileSync(
    path.join(config.outputDir, 'summary.json'),
    JSON.stringify(summary, null, 2) + '\n',
    'utf-8',
  );
  console.log('[merge-tier-reports] Wrote summary.json.');

  console.log(
    `[merge-tier-reports] Aggregate stats: expected=${summary.aggregate.expected}, ` +
      `unexpected=${summary.aggregate.unexpected}, flaky=${summary.aggregate.flaky}, ` +
      `skipped=${summary.aggregate.skipped}, ` +
      `duration=${formatDuration(summary.aggregate.durationMs)}`,
  );
  console.log(`[merge-tier-reports] Strategy: ${strategy}`);
  console.log('[merge-tier-reports] Done.');
}

// ---------------------------------------------------------------------------
// Module guard - run main() only when invoked directly (not when imported)
// ---------------------------------------------------------------------------

if (require.main === module) {
  main().catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    console.error(`[merge-tier-reports] Failed: ${e.message}`);
    if (e.stack) {
      console.error(e.stack);
    }
    process.exit(1);
  });
}

// ---------------------------------------------------------------------------
// Public exports - per AAP file schema (10 exports total)
// ---------------------------------------------------------------------------

export { main as runMergeTierReports };
export {
  resolveConfig,
  discoverTierReports,
  blobMergeStrategy,
  copyMergeStrategy,
  buildAggregatedSummary,
};
export type { MergerConfig, TierReport, TierSummary, AggregatedSummary };
