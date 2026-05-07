#!/usr/bin/env ts-node
/**
 * Script: e2e/scripts/flake-detector.ts
 *
 * Purpose
 * -------
 * Detect flaky tests by computing per-test retry rates across the last N
 * days of Playwright test runs. Emits an HTML + JSON report flagging tests
 * whose retry rate exceeds the configured threshold (default 1%, per AAP
 * section 0.7.1).
 *
 * Algorithm overview
 * ------------------
 *   1. Walk the `test-results/` directory tree (configurable via env var)
 *      looking for Playwright JSON reporter outputs (e.g., `results.json` or
 *      per-tier `test-results-tier-N.json`).
 *   2. Filter the discovered reports to only those modified within the last
 *      `E2E_FLAKE_LOOKBACK_DAYS` days (default 30 - matches the rolling
 *      30-day rate specified in AAP section 0.7.1).
 *   3. For each report, recursively traverse the suite/spec/test tree and
 *      accumulate per-test counters keyed by `${file}::${title}::${project}`:
 *        * `totalRuns`   - count of test invocations across all reports
 *        * `retriedRuns` - count of invocations that produced more than one
 *                          `result` entry (i.e., at least one retry attempt)
 *        * `failedRuns`  - count of invocations whose `status` is 'unexpected'
 *        * `lastRunAt`   - the most recent `startTime` observed for the test
 *   4. Compute `flakeRatePct = (retriedRuns / totalRuns) * 100` and filter
 *      to entries strictly greater than the threshold.
 *   5. Sort entries descending by `flakeRatePct`, with `totalRuns` as the
 *      tie-breaker so the most-tested flaky cases surface first within the
 *      same rate bucket.
 *   6. Emit two artifacts to disk:
 *        * `e2e-flake-report.html` - human-readable, self-contained HTML
 *          (no external CSS/JS) suitable for email attachment or GitHub
 *          Actions artifact upload.
 *        * `e2e-flake-report.json` - machine-readable JSON sidecar for CI
 *          dashboards (e.g., a future GitHub Action that posts a PR
 *          comment listing flaky tests).
 *   7. Exit with code 0 by default. When `--strict` is supplied as a CLI
 *      argument and the flagged entry list is non-empty, exit with code 1
 *      so the script can serve as a CI gate. The default is informational
 *      (exit 0) per AAP section 0.7.1's "informational, not a CI gate"
 *      statement for the initial commit.
 *
 * Inputs (env vars)
 * -----------------
 *   E2E_TEST_RESULTS_DIR     Root directory containing JSON reporter outputs
 *                            (default: `process.cwd()/test-results`).
 *
 *   E2E_FLAKE_LOOKBACK_DAYS  Number of days to look back when filtering
 *                            reports by mtime (default: `30`).
 *
 *   E2E_FLAKE_THRESHOLD_PCT  Flake rate threshold percent, exclusive lower
 *                            bound. Tests whose rate is strictly greater
 *                            than this value are flagged (default: `1.0`).
 *
 *   E2E_FLAKE_REPORT_HTML    Output HTML path
 *                            (default: `process.cwd()/e2e-flake-report.html`).
 *
 *   E2E_FLAKE_REPORT_JSON    Output JSON path
 *                            (default: `process.cwd()/e2e-flake-report.json`).
 *
 * CLI flags
 * ---------
 *   --strict                 When set, exit with code 1 if any test exceeds
 *                            the threshold. Default is informational (exit 0).
 *
 * Outputs
 * -------
 *   e2e-flake-report.html    Human-readable HTML table sorted by descending
 *                            flake rate.
 *   e2e-flake-report.json    Machine-readable JSON for CI dashboards.
 *
 * Exit codes
 * ----------
 *   0   On successful analysis (default; informational).
 *   1   When `--strict` is set AND at least one flagged entry exists, OR
 *       on fatal error (e.g., output paths unwritable, invalid env vars).
 *
 * Required Playwright reporter configuration
 * ------------------------------------------
 * This script depends on the JSON reporter being registered in
 * `playwright.config.ts`. Example:
 *
 *   reporter: [
 *     ['html', { outputFolder: 'playwright-report' }],
 *     ['json', { outputFile: 'test-results/results.json' }],
 *     ['junit', { outputFile: 'test-results/junit.xml' }],
 *   ]
 *
 * The HTML reporter alone is insufficient because its on-disk format does
 * not preserve the per-test retry granularity needed for accurate flake-rate
 * computation. JUnit XML similarly omits per-result retry detail.
 *
 * Future extension point
 * ----------------------
 * The current implementation reports the current state (rolling N-day
 * window). A future revision can compare the current `flakyTests` array
 * against a checked-in baseline (`e2e-flake-report.prev.json`) to surface
 * tests that DEGRADED week-over-week. The `FlakeReportEntry` shape is
 * already stable enough to support this without a breaking change.
 *
 * Per AAP sections 0.5.1.15 and 0.7.1.
 *
 * @see e2e/scripts/coverage-report.ts (sibling script with similar shape)
 * @see e2e/scripts/merge-tier-reports.ts (sibling script with similar shape)
 * @see playwright.config.ts (JSON reporter configuration)
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Public types (also re-exported at bottom of file for downstream reuse,
// e.g., a custom Playwright reporter that wants to reuse the analysis
// helpers without duplicating the parsing logic).
// ---------------------------------------------------------------------------

/**
 * Resolved configuration for a single flake-detector invocation.
 *
 * Constructed by `resolveConfig()` from environment variables, with sane
 * defaults aligned to AAP section 0.7.1's "rolling 30-day" / "< 1%"
 * quality contract. CLI argument `--strict` (parsed from `process.argv`)
 * controls `strictMode`.
 */
interface FlakeDetectorConfig {
  /** Absolute path to the directory containing Playwright JSON reports. */
  testResultsDir: string;
  /** Inclusive number of days to look back from `Date.now()`. */
  lookbackDays: number;
  /**
   * Exclusive lower bound for flagging. A test is flagged when its
   * computed flake rate is strictly greater than this percentage.
   */
  thresholdPct: number;
  /** Absolute path where the human-readable HTML report is written. */
  htmlOutputPath: string;
  /** Absolute path where the machine-readable JSON sidecar is written. */
  jsonOutputPath: string;
  /**
   * When `true`, the process exits with code 1 if at least one entry
   * exceeds the threshold. When `false` (default), the report is purely
   * informational and the process always exits with code 0 on success.
   */
  strictMode: boolean;
}

/**
 * Per-test entry surfaced in the final report. One entry exists per
 * `(file, title, projectName)` tuple whose computed flake rate exceeds the
 * configured threshold.
 */
interface FlakeReportEntry {
  /** Spec file path, as reported by Playwright (relative to root). */
  file: string;
  /** Test title (i.e., the string passed to `test('...', ...)`). */
  title: string;
  /** Project name, e.g., `smoke`, `feature-crud`, `integration-firefox`. */
  projectName: string;
  /** Total number of times this test ran across all analyzed reports. */
  totalRuns: number;
  /** Total number of runs that produced at least one retry attempt. */
  retriedRuns: number;
  /** Total number of runs that ended in `status: 'unexpected'`. */
  failedRuns: number;
  /** Computed flake rate as a percentage in the range [0, 100]. */
  flakeRatePct: number;
  /** ISO-8601 timestamp of the most recent run, when known. */
  lastRunAt?: string;
}

/**
 * Per-test aggregation state used internally during report parsing.
 * `FlakeReportEntry` is derived from this by `buildReportEntries`.
 */
interface TestRunStat {
  /** Composite key: `${file}::${title}::${projectName}`. */
  key: string;
  /** Spec file path. */
  file: string;
  /** Test title. */
  title: string;
  /** Project name. */
  projectName: string;
  /** Cumulative count of test invocations. */
  totalRuns: number;
  /** Cumulative count of invocations with at least one retry attempt. */
  retriedRuns: number;
  /** Cumulative count of invocations whose `status` is `'unexpected'`. */
  failedRuns: number;
  /** ISO-8601 timestamp of the most recent run, when known. */
  lastRunAt?: string;
}

/**
 * Aggregated stats keyed by the composite test key.
 * Internal-only; not exported.
 */
type StatsMap = Map<string, TestRunStat>;

// ---------------------------------------------------------------------------
// Internal types: a minimal structural subset of Playwright's JSON reporter
// output. The full schema (https://playwright.dev/docs/test-reporters) is
// large; we only need the fields necessary for retry-rate computation.
// These types are NOT exported because they describe Playwright's wire
// format, not the flake-detector's public contract.
// ---------------------------------------------------------------------------

/** Top-level shape of a Playwright JSON report. */
interface PlaywrightJsonReport {
  config?: { rootDir?: string };
  /** The list of root-level suites; each may nest further. */
  suites: PlaywrightJsonSuite[];
  errors?: Array<{ message?: string }>;
  stats?: {
    startTime?: string;
    duration?: number;
    expected?: number;
    unexpected?: number;
    flaky?: number;
    skipped?: number;
  };
}

/** A suite node; may be a file-level suite or a nested describe block. */
interface PlaywrightJsonSuite {
  title: string;
  /** Spec file path; present on file-level suites, absent on nested ones. */
  file?: string;
  specs?: PlaywrightJsonSpec[];
  suites?: PlaywrightJsonSuite[];
}

/**
 * A single test() invocation as declared in source. The actual run
 * results (per-project) are nested under `tests`.
 */
interface PlaywrightJsonSpec {
  title: string;
  ok: boolean;
  tests: PlaywrightJsonTest[];
  file?: string;
  line?: number;
  column?: number;
}

/**
 * The execution of a spec under a particular project. Holds an array of
 * `results` - one entry per attempt (retries appear as additional results).
 */
interface PlaywrightJsonTest {
  projectName?: string;
  results: PlaywrightJsonTestResult[];
  /**
   * Final status of this test. `'unexpected'` means failed; `'flaky'`
   * means recovered after retry. We treat both as candidates for the
   * retry-counter when more than one `result` is present.
   */
  status?: 'expected' | 'unexpected' | 'flaky' | 'skipped';
  expectedStatus?: string;
  /** Number of retries from Playwright's perspective. */
  retry?: number;
}

/** A single result inside a test's `results` array (one per attempt). */
interface PlaywrightJsonTestResult {
  status: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
  startTime?: string;
  duration?: number;
  retry?: number;
}

// ---------------------------------------------------------------------------
// Configuration resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the flake-detector configuration from environment variables and
 * CLI arguments, applying AAP-aligned defaults for any unset value.
 *
 * Default values (in alignment with AAP section 0.7.1):
 *   - `lookbackDays`    = 30  (rolling 30-day rate)
 *   - `thresholdPct`    = 1.0 ("< 1%" is the stated quality target)
 *   - `testResultsDir`  = `${cwd}/test-results`
 *   - `htmlOutputPath`  = `${cwd}/e2e-flake-report.html`
 *   - `jsonOutputPath`  = `${cwd}/e2e-flake-report.json`
 *   - `strictMode`      = `process.argv.includes('--strict')`
 *
 * Throws when a provided env var fails type/range validation. The exception
 * propagates to `main()`, which logs and exits with code 1.
 */
function resolveConfig(): FlakeDetectorConfig {
  const lookbackRaw = process.env.E2E_FLAKE_LOOKBACK_DAYS;
  const thresholdRaw = process.env.E2E_FLAKE_THRESHOLD_PCT;

  const lookbackDays =
    lookbackRaw !== undefined && lookbackRaw !== '' ? Number.parseInt(lookbackRaw, 10) : 30;
  const thresholdPct =
    thresholdRaw !== undefined && thresholdRaw !== '' ? Number.parseFloat(thresholdRaw) : 1.0;

  if (!Number.isFinite(lookbackDays) || lookbackDays <= 0) {
    throw new Error(
      `[flake-detector] Invalid E2E_FLAKE_LOOKBACK_DAYS='${lookbackRaw ?? ''}'; ` +
        'must be a positive integer number of days.',
    );
  }
  if (!Number.isFinite(thresholdPct) || thresholdPct < 0) {
    throw new Error(
      `[flake-detector] Invalid E2E_FLAKE_THRESHOLD_PCT='${thresholdRaw ?? ''}'; ` +
        'must be a non-negative number (percent).',
    );
  }

  const testResultsDir = process.env.E2E_TEST_RESULTS_DIR
    ? path.resolve(process.env.E2E_TEST_RESULTS_DIR)
    : path.resolve(process.cwd(), 'test-results');

  const htmlOutputPath = process.env.E2E_FLAKE_REPORT_HTML
    ? path.resolve(process.env.E2E_FLAKE_REPORT_HTML)
    : path.resolve(process.cwd(), 'e2e-flake-report.html');

  const jsonOutputPath = process.env.E2E_FLAKE_REPORT_JSON
    ? path.resolve(process.env.E2E_FLAKE_REPORT_JSON)
    : path.resolve(process.cwd(), 'e2e-flake-report.json');

  const strictMode = process.argv.includes('--strict');

  return {
    testResultsDir,
    lookbackDays,
    thresholdPct,
    htmlOutputPath,
    jsonOutputPath,
    strictMode,
  };
}

// ---------------------------------------------------------------------------
// Report-file discovery (Phase 6)
// ---------------------------------------------------------------------------

/**
 * Heuristic: does a filename look like a Playwright JSON report?
 *
 * We accept any `.json` file whose basename matches one of the conventional
 * patterns Playwright (or our CI workflows) tend to write:
 *
 *   - `results.json`             (default JSON reporter output)
 *   - `test-results.json`        (alternative naming)
 *   - `test-results-tier-N.json` (per-tier output from CI workflows)
 *   - any `*.json`               (broad fallback - the candidate is then
 *                                 parsed and validated by `parseReport`,
 *                                 which silently rejects anything that
 *                                 isn't a Playwright report)
 *
 * The function is intentionally inclusive at the filename level and strict
 * at the parse level: this reduces the number of disjoint regex literals
 * spread across the codebase and keeps the "is this a Playwright report?"
 * decision in one place (`parseReport`).
 */
function isCandidateReportFilename(name: string): boolean {
  if (!name.endsWith('.json')) return false;
  // Skip a few well-known files that are NOT Playwright reports but live in
  // adjacent directories. This avoids unnecessary parse-and-warn churn.
  const skipList = new Set<string>([
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'tsconfig.e2e.json',
    '.eslintrc.json',
    '.prettierrc.json',
    'e2e-flake-report.json',
    'e2e-flake-report.prev.json',
    'e2e-coverage.json',
    'summary.json',
  ]);
  if (skipList.has(name)) return false;
  return true;
}

/**
 * Recursively walk `rootDir` and return absolute paths of all JSON files
 * whose mtime is at or after `cutoffMs`. The walk is failure-tolerant: a
 * permission error on a single subdirectory logs a warning and skips that
 * subtree; the rest of the walk continues.
 *
 * Returns an empty array (with a warning) when `rootDir` does not exist;
 * this is the expected state on a fresh checkout that has not yet executed
 * any Playwright runs.
 */
function findReportFiles(rootDir: string, cutoffMs: number): string[] {
  if (!fs.existsSync(rootDir)) {
    console.warn(`[flake-detector] test-results directory not found: ${rootDir}`);
    return [];
  }

  const matches: string[] = [];

  /**
   * Inner recursive walker. Hoisted as a named function so the call site
   * is self-documenting, and so tests can reason about its structure.
   */
  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[flake-detector] Cannot read ${dir}: ${msg}`);
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        // Skip symlinks, sockets, FIFOs, etc.
        continue;
      }

      if (!isCandidateReportFilename(entry.name)) {
        continue;
      }

      try {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs >= cutoffMs) {
          matches.push(fullPath);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[flake-detector] Cannot stat ${fullPath}: ${msg}`);
      }
    }
  }

  walk(rootDir);
  return matches;
}

// ---------------------------------------------------------------------------
// Report parsing (Phase 7)
// ---------------------------------------------------------------------------

/**
 * Read and parse a single Playwright JSON report.
 *
 * Returns `null` (with a warning logged) when:
 *   - the file cannot be read (e.g., permission error),
 *   - the file is not valid JSON,
 *   - the parsed value is not a non-null object, OR
 *   - the parsed value lacks a `suites` array (so we can be sure it is not
 *     a Playwright report - this filters out package.json, fixtures, etc.).
 *
 * The non-throwing contract is deliberate: in CI, a single corrupt report
 * file should not abort the entire flake analysis. The caller skips `null`
 * results and continues with the remaining reports.
 */
function parseReport(filePath: string): PlaywrightJsonReport | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[flake-detector] Cannot read ${filePath}: ${msg}`);
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[flake-detector] ${filePath} is not valid JSON: ${msg}`);
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const candidate = parsed as PlaywrightJsonReport;
  if (!Array.isArray(candidate.suites)) {
    // Looks like something else (e.g., test-results/.last-run.json,
    // a fixture, or a hand-authored summary). Silently skip - this is
    // expected, not an error.
    return null;
  }

  return candidate;
}

// ---------------------------------------------------------------------------
// Aggregation (Phase 8)
// ---------------------------------------------------------------------------

/**
 * Aggregate the contents of a single parsed report into the running stats
 * map. The map is mutated in place; the function returns void so callers
 * can fold many reports into the same map without re-allocation.
 *
 * The key for each test is `${file}::${title}::${projectName}` so the same
 * spec running under two projects (e.g., 'feature-crud' on Chromium and
 * 'feature-crud-firefox' on Firefox) is tracked independently - that
 * matches how Playwright reports them and matches how flakiness manifests
 * (a test may be stable on Chromium but flaky on Firefox).
 */
function aggregateReport(report: PlaywrightJsonReport, stats: StatsMap): void {
  for (const suite of report.suites) {
    aggregateSuite(suite, stats, suite.file ?? '<unknown>');
  }
}

/**
 * Recursively aggregate a single suite (which may itself contain nested
 * suites for `describe` blocks). The `inheritedFile` argument propagates
 * the file path down through nested suites that don't carry their own
 * `file` property.
 */
function aggregateSuite(suite: PlaywrightJsonSuite, stats: StatsMap, inheritedFile: string): void {
  const file = suite.file ?? inheritedFile;

  if (Array.isArray(suite.specs)) {
    for (const spec of suite.specs) {
      aggregateSpec(spec, stats, spec.file ?? file);
    }
  }

  if (Array.isArray(suite.suites)) {
    for (const child of suite.suites) {
      aggregateSuite(child, stats, file);
    }
  }
}

/**
 * Aggregate a single spec's runs into the stats map. Each `test` entry
 * inside the spec corresponds to one (project, run) pair; its `results`
 * array holds one entry per attempt (the first attempt + any retries).
 *
 * Counter semantics:
 *   - `totalRuns`   increments by 1 per `test` entry (NOT per `result`,
 *                   because multiple results from the same `test` are
 *                   retries of the SAME run, not independent runs).
 *   - `retriedRuns` increments by 1 when the test had >1 result entries
 *                   (i.e., at least one retry attempt was made, regardless
 *                   of final pass/fail outcome).
 *   - `failedRuns`  increments by 1 when the final `status` is
 *                   `'unexpected'` (Playwright's term for a test that did
 *                   not match its expected status).
 *   - `lastRunAt`   tracks the maximum `startTime` across all results,
 *                   compared lexicographically (ISO-8601 sorts correctly
 *                   as a string when in UTC `Z` form).
 */
function aggregateSpec(spec: PlaywrightJsonSpec, stats: StatsMap, file: string): void {
  if (!Array.isArray(spec.tests)) {
    return;
  }

  for (const test of spec.tests) {
    const projectName = test.projectName ?? '<default>';
    const key = `${file}::${spec.title}::${projectName}`;

    let entry = stats.get(key);
    if (!entry) {
      entry = {
        key,
        file,
        title: spec.title,
        projectName,
        totalRuns: 0,
        retriedRuns: 0,
        failedRuns: 0,
      };
      stats.set(key, entry);
    }

    entry.totalRuns += 1;

    const resultCount = Array.isArray(test.results) ? test.results.length : 0;
    if (resultCount > 1) {
      entry.retriedRuns += 1;
    }

    if (test.status === 'unexpected') {
      entry.failedRuns += 1;
    }

    // Track most-recent run timestamp. When all results lack startTime, the
    // entry's lastRunAt remains undefined (the schema marks it optional).
    if (Array.isArray(test.results) && test.results.length > 0) {
      const lastResult = test.results[test.results.length - 1];
      const startTime = lastResult?.startTime;
      if (typeof startTime === 'string' && startTime.length > 0) {
        if (!entry.lastRunAt || startTime > entry.lastRunAt) {
          entry.lastRunAt = startTime;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Threshold filtering and entry construction (Phase 9)
// ---------------------------------------------------------------------------

/**
 * Build the public-facing list of `FlakeReportEntry` from the internal
 * stats map, filtering by threshold and sorting in priority order.
 *
 * Filter rule: `flakeRatePct > thresholdPct` (strict inequality, so a test
 * with exactly 0% flake rate and a threshold of 0 would not be flagged).
 *
 * Sort rule: descending by `flakeRatePct`, with `totalRuns` as the
 * tie-breaker (descending). This surfaces the most-flaky tests first, and
 * within the same rate, surfaces the most-frequently-exercised tests
 * (which represent the highest-leverage refactor candidates).
 */
function buildReportEntries(stats: StatsMap, thresholdPct: number): FlakeReportEntry[] {
  const entries: FlakeReportEntry[] = [];

  for (const stat of stats.values()) {
    if (stat.totalRuns === 0) {
      // Defensive: should not happen given how aggregateSpec increments,
      // but guards against a future change that pre-populates entries
      // without a corresponding run.
      continue;
    }

    const flakeRatePct = (stat.retriedRuns / stat.totalRuns) * 100;

    if (flakeRatePct > thresholdPct) {
      const entry: FlakeReportEntry = {
        file: stat.file,
        title: stat.title,
        projectName: stat.projectName,
        totalRuns: stat.totalRuns,
        retriedRuns: stat.retriedRuns,
        failedRuns: stat.failedRuns,
        flakeRatePct,
      };
      if (stat.lastRunAt) {
        entry.lastRunAt = stat.lastRunAt;
      }
      entries.push(entry);
    }
  }

  entries.sort((a, b) => {
    if (b.flakeRatePct !== a.flakeRatePct) {
      return b.flakeRatePct - a.flakeRatePct;
    }
    return b.totalRuns - a.totalRuns;
  });

  return entries;
}

// ---------------------------------------------------------------------------
// HTML report emission (Phase 10)
// ---------------------------------------------------------------------------

/**
 * Escape a string for safe embedding inside HTML text or attribute values.
 *
 * Covers the OWASP-recommended five-character minimum (`& < > " '`). The
 * single-quote is escaped as the numeric entity `&#39;` because the named
 * entity `&apos;` is not universally supported in older email clients.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render the final HTML report. The output is fully self-contained:
 *   - no `<link>` to external CSS,
 *   - no `<script>` blocks,
 *   - all visible strings escaped via `escapeHtml`.
 *
 * This makes the file safe to attach to email, upload as a CI artifact, or
 * open directly with `file://` protocol on any modern browser.
 *
 * The structure is:
 *   1. header (title, summary block: either "ok" or "warning")
 *   2. table of flagged tests (sorted by descending flake rate)
 *   3. recommended remediation actions (when entries exist)
 *   4. footer (generation timestamp, configuration echo)
 */
function generateHtml(
  entries: FlakeReportEntry[],
  config: FlakeDetectorConfig,
  totalTestsAnalyzed: number,
  reportCount: number,
): string {
  const lines: string[] = [];

  lines.push('<!DOCTYPE html>');
  lines.push('<html lang="en">');
  lines.push('<head>');
  lines.push('  <meta charset="UTF-8">');
  lines.push('  <meta name="viewport" content="width=device-width, initial-scale=1">');
  lines.push('  <title>Whoville-Client E2E Flake Report</title>');
  lines.push('  <style>');
  lines.push(
    '    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", ' +
      'Roboto, Helvetica, Arial, sans-serif; margin: 2rem; color: #1f2328; ' +
      'line-height: 1.5; }',
  );
  lines.push('    h1 { color: #cf222e; margin-top: 0; }');
  lines.push(
    '    h2 { margin-top: 2rem; border-bottom: 1px solid #d0d7de; padding-bottom: 0.25rem; }',
  );
  lines.push(
    '    .summary { background: #fff8c5; padding: 1rem; border-left: 4px solid #d4a72c; ' +
      'margin: 1rem 0; border-radius: 0 4px 4px 0; }',
  );
  lines.push('    .summary p { margin: 0.25rem 0; }');
  lines.push(
    '    .ok { background: #dafbe1; padding: 1rem; border-left: 4px solid #1a7f37; ' +
      'margin: 1rem 0; border-radius: 0 4px 4px 0; }',
  );
  lines.push('    .ok p { margin: 0.25rem 0; }');
  lines.push(
    '    table { border-collapse: collapse; width: 100%; margin-top: 1rem; font-size: 0.95em; }',
  );
  lines.push(
    '    th, td { border: 1px solid #d0d7de; padding: 0.5rem 0.75rem; text-align: left; vertical-align: top; }',
  );
  lines.push('    th { background: #f6f8fa; font-weight: 600; }');
  lines.push('    tr:nth-child(even) { background: #f6f8fa; }');
  lines.push('    td.numeric { text-align: right; font-variant-numeric: tabular-nums; }');
  lines.push('    .rate-high { color: #cf222e; font-weight: 700; }');
  lines.push('    .rate-mid  { color: #d4a72c; font-weight: 600; }');
  lines.push(
    '    code { background: #f6f8fa; padding: 0.1em 0.4em; border-radius: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }',
  );
  lines.push(
    '    .footer { margin-top: 3rem; color: #6e7781; font-size: 0.9em; border-top: 1px solid #d0d7de; padding-top: 1rem; }',
  );
  lines.push('    ul { margin-top: 0.5rem; }');
  lines.push('    li { margin: 0.25rem 0; }');
  lines.push('  </style>');
  lines.push('</head>');
  lines.push('<body>');

  lines.push('  <h1>Whoville-Client E2E Flake Report</h1>');

  // Summary block
  if (entries.length === 0) {
    lines.push('  <div class="ok">');
    lines.push('    <p><strong>&#10003; No flaky tests detected.</strong></p>');
    if (totalTestsAnalyzed === 0 && reportCount === 0) {
      lines.push(
        '    <p>No Playwright JSON reports were found within the lookback window of ' +
          `${config.lookbackDays} day(s). Add the JSON reporter to ` +
          '<code>playwright.config.ts</code> and re-run a test tier to populate ' +
          'the analysis.</p>',
      );
    } else {
      lines.push(
        `    <p>All ${totalTestsAnalyzed} unique test(s) analyzed across ${reportCount} ` +
          `report(s) have flake rates &le; ${config.thresholdPct}%.</p>`,
      );
    }
    lines.push('  </div>');
  } else {
    lines.push('  <div class="summary">');
    lines.push(`    <p><strong>&#9888; ${entries.length} flaky test(s) detected.</strong></p>`);
    lines.push(
      `    <p>Threshold: ${config.thresholdPct}% retry rate over the last ` +
        `${config.lookbackDays} day(s).</p>`,
    );
    lines.push(
      `    <p>Reports analyzed: ${reportCount}; Unique tests analyzed: ${totalTestsAnalyzed}.</p>`,
    );
    lines.push('  </div>');
  }

  // Table of flagged tests
  if (entries.length > 0) {
    lines.push('  <h2>Flagged Tests (sorted by retry rate)</h2>');
    lines.push('  <table>');
    lines.push('    <thead>');
    lines.push('      <tr>');
    lines.push('        <th>File</th>');
    lines.push('        <th>Test Title</th>');
    lines.push('        <th>Project</th>');
    lines.push('        <th>Total Runs</th>');
    lines.push('        <th>Retried Runs</th>');
    lines.push('        <th>Failed Runs</th>');
    lines.push('        <th>Flake Rate</th>');
    lines.push('        <th>Last Run</th>');
    lines.push('      </tr>');
    lines.push('    </thead>');
    lines.push('    <tbody>');

    for (const entry of entries) {
      const rateClass = entry.flakeRatePct >= 5 ? 'rate-high' : 'rate-mid';
      lines.push('      <tr>');
      lines.push(`        <td><code>${escapeHtml(entry.file)}</code></td>`);
      lines.push(`        <td>${escapeHtml(entry.title)}</td>`);
      lines.push(`        <td>${escapeHtml(entry.projectName)}</td>`);
      lines.push(`        <td class="numeric">${entry.totalRuns}</td>`);
      lines.push(`        <td class="numeric">${entry.retriedRuns}</td>`);
      lines.push(`        <td class="numeric">${entry.failedRuns}</td>`);
      lines.push(`        <td class="numeric ${rateClass}">${entry.flakeRatePct.toFixed(2)}%</td>`);
      lines.push(`        <td>${escapeHtml(entry.lastRunAt ?? '\u2014')}</td>`);
      lines.push('      </tr>');
    }

    lines.push('    </tbody>');
    lines.push('  </table>');

    lines.push('  <h2>Recommended Actions</h2>');
    lines.push('  <ul>');
    lines.push(
      '    <li>Refactor selectors to prefer accessibility primitives ' +
        '(<code>getByRole</code>, <code>getByLabel</code>, <code>getByText</code>) ' +
        'over CSS classes (per AAP &sect; 0.7.2).</li>',
    );
    lines.push(
      '    <li>Replace any <code>page.waitForTimeout()</code> calls with ' +
        'auto-waiting locators or web-first <code>expect()</code> assertions.</li>',
    );
    lines.push(
      '    <li>Examine the trace for the most recent failure: ' +
        '<code>npx playwright show-trace test-results/&lt;path&gt;/trace.zip</code>.</li>',
    );
    lines.push(
      '    <li>If the flakiness is environmental (network, dev-server cold start), ' +
        'consider adjusting <code>actionTimeout</code> or <code>navigationTimeout</code> ' +
        'in <code>playwright.config.ts</code>.</li>',
    );
    lines.push(
      '    <li>For tests that are flaky only on a specific project (e.g., Firefox), ' +
        'verify that the affected POM uses cross-browser-stable locators rather than ' +
        'browser-specific CSS selectors.</li>',
    );
    lines.push('  </ul>');
  }

  // Footer
  lines.push('  <div class="footer">');
  lines.push(
    `    <p>Generated by <code>e2e/scripts/flake-detector.ts</code> at ` +
      `${escapeHtml(new Date().toISOString())}.</p>`,
  );
  lines.push(
    `    <p>Configuration: ` +
      `<code>E2E_FLAKE_LOOKBACK_DAYS=${config.lookbackDays}</code>, ` +
      `<code>E2E_FLAKE_THRESHOLD_PCT=${config.thresholdPct}</code>, ` +
      `<code>E2E_TEST_RESULTS_DIR=${escapeHtml(config.testResultsDir)}</code>.</p>`,
  );
  lines.push('    <p>Per AAP &sect; 0.5.1.15 and &sect; 0.7.1.</p>');
  lines.push('  </div>');
  lines.push('</body>');
  lines.push('</html>');

  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// JSON sidecar emission (Phase 11)
// ---------------------------------------------------------------------------

/**
 * Render the machine-readable JSON sidecar. Shape (in JSON):
 *
 *   {
 *     "generatedAt":  ISO-8601,
 *     "config":       { "lookbackDays", "thresholdPct", "testResultsDir" },
 *     "summary":      { "reportsAnalyzed", "uniqueTestsAnalyzed",
 *                       "flakyTestCount", "thresholdExceeded" },
 *     "flakyTests":   FlakeReportEntry[]
 *   }
 *
 * Pretty-printed (2-space indent) for human readability when inspecting CI
 * artifacts. The `flakyTests` array is identical in shape and order to the
 * HTML table.
 */
function generateJson(
  entries: FlakeReportEntry[],
  config: FlakeDetectorConfig,
  totalTestsAnalyzed: number,
  reportCount: number,
): string {
  const payload = {
    generatedAt: new Date().toISOString(),
    config: {
      lookbackDays: config.lookbackDays,
      thresholdPct: config.thresholdPct,
      testResultsDir: config.testResultsDir,
    },
    summary: {
      reportsAnalyzed: reportCount,
      uniqueTestsAnalyzed: totalTestsAnalyzed,
      flakyTestCount: entries.length,
      thresholdExceeded: entries.length > 0,
    },
    flakyTests: entries,
  };
  return JSON.stringify(payload, null, 2) + '\n';
}

// ---------------------------------------------------------------------------
// Main entry point (Phase 12)
// ---------------------------------------------------------------------------

/**
 * Top-level orchestration. Logs progress to stdout (informational) and
 * stderr (errors) using the `[flake-detector]` prefix so output is
 * grep-friendly in CI logs.
 *
 * Returns a Promise<void> for symmetry with sibling scripts and to allow
 * the `--strict` exit-code path to be a `process.exit(1)` rather than a
 * thrown exception.
 *
 * Side effects: writes `config.htmlOutputPath` and `config.jsonOutputPath`.
 */
async function main(): Promise<void> {
  // Reserved async no-op so the function signature stays stable as we add
  // real async work in future revisions (e.g., concurrent file reads via
  // fs.promises.readFile, network fetches for trend baselines). Mirrors the
  // pattern used by sibling scripts (merge-tier-reports.ts).
  await Promise.resolve();

  const config = resolveConfig();

  console.log('[flake-detector] Starting flake-rate analysis.');
  console.log(`[flake-detector] Reading from:  ${config.testResultsDir}`);
  console.log(`[flake-detector] Lookback days: ${config.lookbackDays}`);
  console.log(`[flake-detector] Threshold:     ${config.thresholdPct}%`);
  console.log(`[flake-detector] HTML output:   ${config.htmlOutputPath}`);
  console.log(`[flake-detector] JSON output:   ${config.jsonOutputPath}`);
  if (config.strictMode) {
    console.log('[flake-detector] Strict mode:   ENABLED (will exit 1 on threshold breach)');
  }

  const cutoffMs = Date.now() - config.lookbackDays * 24 * 60 * 60 * 1000;
  const reportFiles = findReportFiles(config.testResultsDir, cutoffMs);
  console.log(
    `[flake-detector] Found ${reportFiles.length} candidate report file(s) ` +
      'within lookback window.',
  );

  const stats: StatsMap = new Map();
  let parsedReports = 0;

  for (const file of reportFiles) {
    const parsed = parseReport(file);
    if (parsed) {
      aggregateReport(parsed, stats);
      parsedReports += 1;
    }
  }

  console.log(`[flake-detector] Parsed ${parsedReports} valid Playwright JSON report(s).`);
  console.log(`[flake-detector] Aggregated stats for ${stats.size} unique test(s).`);

  const entries = buildReportEntries(stats, config.thresholdPct);
  console.log(
    `[flake-detector] Tests exceeding ${config.thresholdPct}% threshold: ${entries.length}`,
  );

  // Ensure parent directories exist before writing.
  fs.mkdirSync(path.dirname(config.htmlOutputPath), { recursive: true });
  fs.mkdirSync(path.dirname(config.jsonOutputPath), { recursive: true });

  const html = generateHtml(entries, config, stats.size, parsedReports);
  fs.writeFileSync(config.htmlOutputPath, html, 'utf-8');
  console.log(`[flake-detector] Wrote HTML report: ${config.htmlOutputPath}`);

  const json = generateJson(entries, config, stats.size, parsedReports);
  fs.writeFileSync(config.jsonOutputPath, json, 'utf-8');
  console.log(`[flake-detector] Wrote JSON report: ${config.jsonOutputPath}`);

  if (config.strictMode && entries.length > 0) {
    console.error(
      `[flake-detector] STRICT mode: ${entries.length} test(s) exceed the ` +
        `${config.thresholdPct}% threshold. Exiting with code 1.`,
    );
    process.exit(1);
  }

  console.log('[flake-detector] Done.');
}

// ---------------------------------------------------------------------------
// Module guard - run main() only when invoked directly (not when imported)
// ---------------------------------------------------------------------------

if (require.main === module) {
  main().catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    console.error(`[flake-detector] Failed: ${e.message}`);
    if (e.stack) {
      console.error(e.stack);
    }
    process.exit(1);
  });
}

// ---------------------------------------------------------------------------
// Public exports - per AAP file schema (9 exports total: 6 functions + 3
// interfaces). The `runFlakeDetector` re-export of `main` provides a stable
// API for downstream consumers (e.g., a custom Playwright reporter that
// wants to invoke the analysis programmatically without spawning ts-node).
// ---------------------------------------------------------------------------

export { main as runFlakeDetector };
export { resolveConfig, findReportFiles, parseReport, aggregateReport, buildReportEntries };
export type { FlakeDetectorConfig, FlakeReportEntry, TestRunStat };
