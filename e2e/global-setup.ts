/**
 * @file e2e/global-setup.ts
 * @description Pre-suite global setup hook for the Whoville-Client Playwright
 *   E2E test suite. Mandated by the Agent Action Plan (AAP) section 0.5.1.2
 *   ("Core Fixtures and Test Setup"):
 *
 *     > Runs once before all tests: validates env vars, generates per-role
 *     > storageState files via headless login flow, warms mock-api JSON cache.
 *
 *   This module is referenced by `playwright.config.ts` via the
 *   `globalSetup: <resolved path>` configuration property. Playwright invokes
 *   the default-exported function exactly once per `playwright test` run,
 *   BEFORE any worker is spawned and BEFORE any spec begins executing.
 *
 *   ## Responsibilities (in execution order)
 *
 *     1. Load `.env.e2e` (repository-root) into `process.env` via `dotenv`,
 *        so subsequent reads of `E2E_BASE_URL`, `E2E_API_MODE`, `MOCK_API`,
 *        and per-role credentials see developer overrides.
 *     2. Validate required environment variables (`E2E_BASE_URL`) and the
 *        well-formedness of optional variables (`E2E_API_MODE`, `MOCK_API`).
 *        Abort with an actionable error if validation fails.
 *     3. Probe `${E2E_BASE_URL}` via Playwright's `request.newContext()` HTTP
 *        client (no browser launch) to confirm the Angular dev server is
 *        reachable. Failing here surfaces a single, clear "is the dev server
 *        running?" message instead of ~640 cryptic per-test timeouts.
 *     4. Collect per-role login credentials from `process.env` and run a
 *        headless Chromium login flow per role to produce
 *        `e2e/storage-states/<role>.json`. These files cache the
 *        authenticated cookies + localStorage + sessionStorage so that every
 *        test simply reuses them via `auth.fixture.ts` instead of re-logging
 *        in (~640 logins -> 1-3 logins per suite run).
 *     5. When mock-mode is active (`E2E_API_MODE=mock` AND `MOCK_API!='false'`)
 *        eagerly read and JSON-parse-validate every fixture under
 *        `e2e/fixtures/api-responses/**\/*.json`, which both warms the disk
 *        cache and fails fast on malformed fixtures.
 *
 *   ## Side effects
 *
 *     - Mutates `process.env` via `dotenv.config()`.
 *     - Creates the directory `e2e/storage-states/` if missing.
 *     - Writes one `*.json` file per discovered role to `e2e/storage-states/`.
 *     - Reads (but does not modify) every JSON file under
 *       `e2e/fixtures/api-responses/`.
 *     - Emits structured `[e2e/global-setup] ...` log lines to stdout/stderr.
 *
 *   ## Failure modes
 *
 *     - Missing required env var -> hard fail with copy-the-template hint.
 *     - Unreachable BaseURL (5xx or network error) -> hard fail with the
 *       "is the Whoville-Client dev server running?" hint.
 *     - Login flow fails for a role -> hard fail (with username; never the
 *       password) and the entire suite is aborted before any test starts.
 *     - Malformed JSON fixture -> hard fail with file path.
 *     - No credentials in env -> warn and skip storage-state generation
 *       (allows non-authenticated tests to run; auth-required tests will
 *       fail gracefully when their fixture cannot resolve a storage state).
 *
 *   ## Companion teardown
 *
 *   See `e2e/global-teardown.ts` for the symmetric post-suite hook (live-mode
 *   entity cleanup, coverage finalize). storageState `*.json` files are
 *   gitignored and overwritten on each run, so they do NOT require explicit
 *   cleanup in teardown.
 *
 *   ## AAP cross-references
 *
 *     - AAP section 0.4.4 -- "Worker-scoped storage state" caching strategy.
 *     - AAP section 0.5.1.2 -- mandates this exact file with these exact
 *       responsibilities.
 *     - AAP section 0.6.1 -- pinned dependencies (`@playwright/test@1.59.1`,
 *       `dotenv@^16.4.0`).
 *     - AAP section 0.10.1 -- migration-proof selectors (regex `getByLabel`
 *       and `getByRole` in the headless login flow).
 *     - AAP section 0.10.2 -- "Critical Implementation Reminders":
 *       no-credentials-in-logs, structured `[e2e/global-setup]` prefix.
 */

import { FullConfig, chromium, request } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// ---------------------------------------------------------------------------
// Load .env.e2e at module-load time, BEFORE any process.env read below.
// The dotenv config file lives at the repository root, one level up from
// this file's directory (e2e/global-setup.ts -> ../.env.e2e).
// `quiet: true` suppresses the verbose dotenv banner that otherwise pollutes
// CI logs; missing-file is non-fatal because real env vars from the shell or
// CI provider are sufficient.
// ---------------------------------------------------------------------------
dotenv.config({ path: path.resolve(__dirname, '..', '.env.e2e'), quiet: true });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Log prefix applied to every emitted log line so `grep '[e2e/global-setup]'`
 * surfaces only this hook's output during CI debugging.
 */
const LOG_PREFIX = '[e2e/global-setup]';

/**
 * Hard-coded canonical default URL used as the FINAL fallback when neither
 * the resolved Playwright config nor the `E2E_BASE_URL` env var supply one.
 * Matches the Angular CLI default `ng serve` port (4200).
 */
const DEFAULT_BASE_URL = 'http://localhost:4200';

/**
 * Login form navigation URL fragment appended to baseURL. The login screen
 * lives at `/login` per Whoville-Client convention; if the route changes in
 * a future Angular major version, update this constant rather than search-
 * and-replacing. Per AAP section 0.10.1 the POM-side authoritative selectors
 * live in `e2e/pages/app-shell/login.page.ts`.
 */
const LOGIN_PATH = '/login';

/**
 * Timeout (ms) for the pre-flight HTTP probe of the dev server.
 * 30 seconds matches the global navigationTimeout in playwright.config.ts.
 */
const PREFLIGHT_TIMEOUT_MS = 30_000;

/**
 * Timeout (ms) for the headless login flow's post-submit redirect wait.
 * Generous (30s) because cold-start dev-server first-paint can exceed 10s on
 * Angular 11 with HMR enabled.
 */
const LOGIN_REDIRECT_TIMEOUT_MS = 30_000;

/**
 * Optional per-role credentials supported by the suite, in addition to the
 * canonical `E2E_TEST_USER_USERNAME/PASSWORD` pair. Each entry causes the
 * setup hook to look for `E2E_<ROLE>_USER_USERNAME` and
 * `E2E_<ROLE>_USER_PASSWORD` env vars and produce a corresponding
 * `<role>-user.json` storage state. Aligns with AAP section 0.4.4.
 */
const OPTIONAL_ROLES = ['admin', 'viewer', 'restricted'] as const;

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

/**
 * Shape of a single role's login credentials and the storage-state output
 * path the headless login flow will write to. Internal type; not exported.
 */
interface RoleCredentials {
  /** Display label for the role; used in log lines (no PII concerns). */
  readonly roleLabel: string;
  /** Username supplied to the login form (logged on failure). */
  readonly username: string;
  /** Password supplied to the login form (NEVER logged). */
  readonly password: string;
  /** Absolute path where `BrowserContext.storageState({ path })` will write. */
  readonly storageStatePath: string;
}

/**
 * Structured run-time report of what setup accomplished. Currently used only
 * for the single "[e2e/global-setup] Complete." summary log line; reserved
 * for future use (e.g., persisted setup metadata for the teardown hook).
 */
interface SetupReport {
  readonly startedAt: string;
  readonly apiMode: 'mock' | 'live';
  readonly mockEnabled: boolean;
  readonly rolesGenerated: readonly string[];
  readonly fixturesWarmed: number;
  readonly baseUrlReachable: boolean;
  readonly baseUrl: string;
}

// ---------------------------------------------------------------------------
// Default export -- the function Playwright invokes
// ---------------------------------------------------------------------------

/**
 * Playwright's `globalSetup` entrypoint. Invoked exactly once per
 * `playwright test` run, BEFORE any worker is forked.
 *
 * Per Playwright's contract, this function:
 *   - Receives the resolved `FullConfig` (after `playwright.config.ts` has
 *     been evaluated, env vars merged, and projects expanded).
 *   - May be `async`; Playwright awaits the returned Promise before spawning
 *     workers.
 *   - Should throw to abort the entire suite (no tests run, no workers spawn).
 *   - Receives no return value contract; we return `void`.
 *
 * @param config - The resolved Playwright configuration. Used here to read
 *   the first project's `use.baseURL` so this hook honours any per-config
 *   override even when `E2E_BASE_URL` is not set.
 * @returns A Promise that resolves once setup is complete. Rejection causes
 *   Playwright to abort the entire suite.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const startedAt = new Date().toISOString();
  // eslint-disable-next-line no-console
  console.log(`${LOG_PREFIX} Starting at ${startedAt}`);

  // Step 1: Validate environment variables (fail-fast on misconfiguration).
  validateEnv();

  // Step 2: Resolve baseURL from the resolved Playwright config (preferred)
  // or `E2E_BASE_URL` (fallback) or the localhost default (last resort).
  const baseUrl = getBaseUrl(config);

  // Step 3: Probe the dev server with a lightweight HTTP request (no
  // browser). If the server isn't running, abort BEFORE we spend seconds
  // launching Chromium just to fail again.
  await checkBaseUrlReachable(baseUrl);

  // Step 4: Collect per-role credentials from process.env and (if any are
  // present) launch a single headless Chromium and capture storageState per
  // role. Skipped silently with a warning when no credentials are present.
  const roles = collectRoleCredentials();
  await generateStorageStates(baseUrl, roles);

  // Step 5: When mock-mode is active, eager-load every JSON fixture to
  // (a) warm the OS disk cache and (b) fail-fast on malformed JSON.
  const mockEnabled = isMockMode();
  let fixturesWarmed = 0;
  if (mockEnabled) {
    fixturesWarmed = warmMockFixtureCache();
  } else {
    // eslint-disable-next-line no-console
    console.log(
      `${LOG_PREFIX} Mock-mode disabled (E2E_API_MODE=${process.env.E2E_API_MODE ?? 'mock'}, ` +
        `MOCK_API=${process.env.MOCK_API ?? '<unset>'}); fixture cache warm-up skipped.`,
    );
  }

  // Step 6: Emit the structured run-summary line for CI traceability.
  const report: SetupReport = {
    startedAt,
    apiMode: (process.env.E2E_API_MODE as 'mock' | 'live' | undefined) === 'live' ? 'live' : 'mock',
    mockEnabled,
    rolesGenerated: roles.map((r) => r.roleLabel),
    fixturesWarmed,
    baseUrlReachable: true,
    baseUrl,
  };
  emitSetupReport(report);

  // eslint-disable-next-line no-console
  console.log(`${LOG_PREFIX} Complete.`);
}

// ---------------------------------------------------------------------------
// Step 1: Environment validation
// ---------------------------------------------------------------------------

/**
 * Validate that required environment variables are present and that optional
 * variables, if set, parse to allowed values. Throws with an actionable hint
 * if any check fails.
 *
 * Per AAP section 0.10.1 the only HARD-required variable is `E2E_BASE_URL`
 * because:
 *   - Test-user credentials are optional (their absence simply skips the
 *     storage-state generation step and emits a warning).
 *   - `E2E_API_MODE` and `MOCK_API` have safe defaults (`'mock'` and `'true'`
 *     respectively).
 */
function validateEnv(): void {
  // ---------- Required: E2E_BASE_URL ----------
  const required = ['E2E_BASE_URL'] as const;
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `${LOG_PREFIX} Missing required env vars: ${missing.join(', ')}. ` +
        `Copy .env.e2e.example to .env.e2e and fill in real values, or set them in your shell. ` +
        `See e2e/README.md for setup instructions.`,
    );
  }

  // ---------- Optional: E2E_API_MODE (default 'mock') ----------
  const apiMode = process.env.E2E_API_MODE ?? 'mock';
  if (!['mock', 'live'].includes(apiMode)) {
    throw new Error(`${LOG_PREFIX} Invalid E2E_API_MODE: '${apiMode}'. Must be 'mock' or 'live'.`);
  }

  // ---------- Optional: MOCK_API (default 'true') ----------
  const mockApi = process.env.MOCK_API;
  if (mockApi !== undefined && !['true', 'false'].includes(mockApi)) {
    throw new Error(`${LOG_PREFIX} Invalid MOCK_API: '${mockApi}'. Must be 'true' or 'false'.`);
  }

  // ---------- Cross-variable consistency warning ----------
  // `mock+true` and `live+false` are the documented canonical combinations.
  // Any other pairing is technically valid (mockEnabled() resolves them
  // unambiguously) but is likely a configuration mistake worth surfacing.
  if (apiMode === 'mock' && mockApi === 'false') {
    // eslint-disable-next-line no-console
    console.warn(
      `${LOG_PREFIX} Configuration ambiguity: E2E_API_MODE='mock' but MOCK_API='false'. ` +
        `Mock-mode will be DISABLED (live HTTP) - confirm this is intentional.`,
    );
  }
  if (apiMode === 'live' && mockApi === 'true') {
    // eslint-disable-next-line no-console
    console.warn(
      `${LOG_PREFIX} Configuration ambiguity: E2E_API_MODE='live' but MOCK_API='true'. ` +
        `Live-mode will be DISABLED (mocks active) - confirm this is intentional.`,
    );
  }

  // ---------- Live-mode warning ----------
  if (apiMode === 'live') {
    // eslint-disable-next-line no-console
    console.warn(
      `${LOG_PREFIX} WARNING E2E_API_MODE=live: tests will hit a real backend. ` +
        `Ensure E2E_BASE_URL points to a non-production environment and ` +
        `E2E_TEST_DATA_PREFIX is set for cleanup eligibility (default: 'e2e-test-').`,
    );
  }
}

// ---------------------------------------------------------------------------
// Step 2: Resolve the effective base URL
// ---------------------------------------------------------------------------

/**
 * Resolve the effective base URL by consulting, in priority order:
 *   1. The first project's `use.baseURL` from the resolved Playwright config.
 *      This honours any per-config override (e.g., a CI workflow that calls
 *      `playwright test --config=playwright.staging.ts`).
 *   2. The `E2E_BASE_URL` environment variable (now populated by dotenv).
 *   3. The hard-coded `DEFAULT_BASE_URL` (Angular CLI's `ng serve` default).
 *
 * @param config - The resolved Playwright configuration.
 * @returns A non-empty base URL string suitable for HTTP probing and
 *   navigation, with no trailing slash normalisation applied (Playwright
 *   handles trailing-slash semantics on its own).
 */
function getBaseUrl(config: FullConfig): string {
  // Defensive: `config.projects` is non-null per Playwright's contract, but
  // the array could in theory be empty if a downstream agent removes all
  // projects. Guard against that to avoid an Index-out-of-range crash here.
  const firstProject = config.projects[0];
  const fromConfig = firstProject?.use?.baseURL;
  if (typeof fromConfig === 'string' && fromConfig.length > 0) {
    return fromConfig;
  }
  const fromEnv = process.env.E2E_BASE_URL;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) {
    return fromEnv;
  }
  return DEFAULT_BASE_URL;
}

// ---------------------------------------------------------------------------
// Step 3: Pre-flight reachability check
// ---------------------------------------------------------------------------

/**
 * Issue a single GET to the base URL and verify the dev server responds.
 *
 * Implementation choice: we use Playwright's `request.newContext()` rather
 * than `chromium.launch()` here for two reasons:
 *   1. Browser launch is expensive (1-3 s); HTTP probe is essentially free.
 *   2. We have not yet validated credentials, so any failure mode in launch
 *      would mask the simpler "the server isn't running" diagnosis.
 *
 * Status-code policy:
 *   - `< 500`: any 1xx/2xx/3xx/4xx is treated as "server is alive". A 404 on
 *     the bare base URL is fine (e.g., the SPA might serve from a sub-path).
 *   - `>= 500`: hard failure. The server is reachable but unhealthy; tests
 *     would fail en masse.
 *   - Network error (connection refused, DNS failure, TLS error): hard
 *     failure with the underlying error message attached.
 *
 * @param baseUrl - The base URL to probe.
 * @throws Error with an actionable "is the dev server running?" hint when
 *   the server is unreachable or returning a 5xx.
 */
async function checkBaseUrlReachable(baseUrl: string): Promise<void> {
  const ctx = await request.newContext();
  try {
    const response = await ctx.get(baseUrl, {
      timeout: PREFLIGHT_TIMEOUT_MS,
      failOnStatusCode: false,
      ignoreHTTPSErrors: true,
    });
    const status = response.status();
    if (status >= 500) {
      throw new Error(
        `${LOG_PREFIX} BaseURL ${baseUrl} returned ${status}. ` +
          `Is the Whoville-Client dev server running and healthy? Try 'npm run start:e2e'.`,
      );
    }
    // eslint-disable-next-line no-console
    console.log(`${LOG_PREFIX} BaseURL ${baseUrl} reachable (HTTP ${status}).`);
  } catch (err: unknown) {
    // Re-throw our own already-formatted error untouched.
    if (err instanceof Error && err.message.startsWith(LOG_PREFIX)) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${LOG_PREFIX} Cannot reach ${baseUrl}: ${message}. ` +
        `Verify the Angular dev server is running and accessible. ` +
        `Local default: 'npm run start:e2e' (port 4200).`,
    );
  } finally {
    // Always dispose to release sockets and avoid leak warnings, even if the
    // probe threw.
    await ctx.dispose();
  }
}

// ---------------------------------------------------------------------------
// Step 4: Storage state generation
// ---------------------------------------------------------------------------

/**
 * Read per-role credentials from `process.env` and produce a list of
 * `RoleCredentials` to drive the headless login flow.
 *
 * Roles are discovered in two passes:
 *   1. The canonical role uses `E2E_TEST_USER_USERNAME`/`E2E_TEST_USER_PASSWORD`
 *      and writes to `e2e/storage-states/canonical-user.json`.
 *   2. Each role in `OPTIONAL_ROLES` is checked for `E2E_<ROLE>_USER_USERNAME`
 *      and `E2E_<ROLE>_USER_PASSWORD`. Both must be present (and non-empty)
 *      for the role to be included; partial pairs are silently skipped.
 *
 * @returns A list of role credentials, possibly empty when no env vars are
 *   set (e.g., a non-authenticated smoke run).
 */
function collectRoleCredentials(): readonly RoleCredentials[] {
  const roles: RoleCredentials[] = [];
  const storageDir = path.resolve(__dirname, 'storage-states');

  // ---------- Canonical / default role ----------
  const canonicalUser = process.env.E2E_TEST_USER_USERNAME;
  const canonicalPass = process.env.E2E_TEST_USER_PASSWORD;
  if (canonicalUser && canonicalPass) {
    roles.push({
      roleLabel: 'canonical',
      username: canonicalUser,
      password: canonicalPass,
      storageStatePath: path.join(storageDir, 'canonical-user.json'),
    });
  }

  // ---------- Optional per-role credentials ----------
  for (const role of OPTIONAL_ROLES) {
    const userKey = `E2E_${role.toUpperCase()}_USER_USERNAME`;
    const passKey = `E2E_${role.toUpperCase()}_USER_PASSWORD`;
    const username = process.env[userKey];
    const password = process.env[passKey];
    if (username && password) {
      roles.push({
        roleLabel: role,
        username,
        password,
        storageStatePath: path.join(storageDir, `${role}-user.json`),
      });
    }
  }

  return roles;
}

/**
 * Launch a single headless Chromium browser, then perform a login flow per
 * role and persist each authenticated context's `storageState` to JSON.
 *
 * Why a single shared browser process:
 *   - Browser launch is expensive (1-3 s). Sharing the process across all
 *     roles divides the cost by N rather than multiplying it.
 *   - Each role still gets its own isolated `BrowserContext` (no cookie /
 *     localStorage bleed across roles).
 *
 * Why Chromium specifically:
 *   - Always available (smoke tier is Chromium-only per AAP section 0.4.1).
 *   - storageState JSON is browser-agnostic for cookies + localStorage +
 *     sessionStorage, so the resulting files work across all 3 browsers in
 *     the cross-browser nightly matrix.
 *
 * Locator strategy (per AAP section 0.10.1 "migration-proof selectors"):
 *   - `getByLabel(/username|email/i)` and `getByLabel(/password/i)` -- a
 *     case-insensitive regex tolerates label-text changes across Angular
 *     major versions and i18n locales.
 *   - `getByRole('button', { name: /sign in|log in/i })` -- role + accessible
 *     name is the most stable Playwright locator class per Playwright docs.
 *
 * Error handling:
 *   - On any failure, we log the role label AND username (for diagnostics)
 *     but NEVER the password.
 *   - We re-throw to abort `globalSetup`; failing here means subsequent
 *     auth-required tests would all fail, so it is faster to abort now.
 *
 * @param baseUrl - The base URL where the login form is served.
 * @param roles - Per-role credentials produced by `collectRoleCredentials()`.
 *   When empty, this function returns immediately with a warning.
 */
async function generateStorageStates(
  baseUrl: string,
  roles: readonly RoleCredentials[],
): Promise<void> {
  if (roles.length === 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `${LOG_PREFIX} No role credentials provided; storage-state generation skipped. ` +
        `Auth-required tests will fail unless E2E_TEST_USER_USERNAME and ` +
        `E2E_TEST_USER_PASSWORD are set in .env.e2e or the shell.`,
    );
    return;
  }

  // Ensure the output directory exists. `recursive: true` makes the call
  // idempotent: if the directory already exists no error is thrown.
  const storageDir = path.resolve(__dirname, 'storage-states');
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }

  // eslint-disable-next-line no-console
  console.log(
    `${LOG_PREFIX} Generating storage states for ${roles.length} role(s): ` +
      roles.map((r) => r.roleLabel).join(', '),
  );

  const browser = await chromium.launch();
  try {
    for (const role of roles) {
      // Each role gets a fresh, isolated BrowserContext. We close it after
      // capturing the storageState so memory does not accumulate across roles.
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        // Navigate to the login screen. URL fragment is constant across
        // Angular major versions per AAP section 0.10.1 (Whoville-Client
        // routing convention). If routing changes during the migration,
        // update LOGIN_PATH and the corresponding LoginPage POM in lock-step.
        await page.goto(`${baseUrl}${LOGIN_PATH}`);

        // Migration-proof selectors per AAP section 0.10.1:
        // role + accessible-name regex tolerates copy changes between
        // Angular versions and locales.
        await page.getByLabel(/username|email/i).fill(role.username);
        await page.getByLabel(/password/i).fill(role.password);
        await page.getByRole('button', { name: /sign in|log in/i }).click();

        // Wait for the post-login redirect away from `/login`. We do NOT
        // assert a specific destination URL because the canonical landing
        // route differs per role (admin -> dashboard, viewer -> read-only
        // home, etc.). The negation predicate works for every role.
        await page.waitForURL((url) => !url.pathname.includes(LOGIN_PATH), {
          timeout: LOGIN_REDIRECT_TIMEOUT_MS,
        });

        // Persist the authenticated state. Playwright writes a JSON document
        // containing cookies + localStorage + sessionStorage (browser-
        // agnostic, see fn doc above).
        await ctx.storageState({ path: role.storageStatePath });

        // eslint-disable-next-line no-console
        console.log(
          `${LOG_PREFIX} Generated storage state for role='${role.roleLabel}': ` +
            `${role.storageStatePath}`,
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        // Diagnostics: log role + username for debugging; NEVER the password.
        // eslint-disable-next-line no-console
        console.error(
          `${LOG_PREFIX} Failed to generate storage state for role='${role.roleLabel}', ` +
            `username='${role.username}': ${message}`,
        );
        // Re-throw so the entire suite aborts: continuing would hide auth
        // failures behind ~640 cryptic per-test errors.
        throw new Error(
          `${LOG_PREFIX} Storage-state generation failed for role='${role.roleLabel}': ${message}`,
        );
      } finally {
        // Always close the context to release its resources.
        await ctx.close();
      }
    }
  } finally {
    // Always close the browser even when an inner role threw, so the process
    // does not leak Chromium handles.
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Step 5: Mock-mode fixture cache warm-up
// ---------------------------------------------------------------------------

/**
 * Eager-load and JSON-validate every fixture under
 * `e2e/fixtures/api-responses/**\/*.json`. Returns the count of validated
 * files for the run summary.
 *
 * Why warm the cache here:
 *   - Per-test fixture reads happen during page.route() handler invocation;
 *     a malformed fixture throws inside the handler, which Playwright
 *     surfaces as a timeout rather than a parse error. Validating up front
 *     produces a single clear "this file is broken" error instead.
 *   - Reading every fixture once also pre-populates the OS page cache so
 *     subsequent test reads are essentially free.
 *
 * Behavior when the fixture root does not exist:
 *   - Emits a warning but DOES NOT FAIL. The fixture directory is authored
 *     by sibling source-code agents (per setup-status log); allowing
 *     globalSetup to run before those files exist supports incremental
 *     development.
 *
 * @returns The count of JSON files successfully validated. Zero when the
 *   fixture root is missing.
 * @throws Error with the file path when a JSON fixture fails to parse.
 */
function warmMockFixtureCache(): number {
  const fixtureRoot = path.resolve(__dirname, 'fixtures', 'api-responses');

  if (!fs.existsSync(fixtureRoot)) {
    // eslint-disable-next-line no-console
    console.warn(
      `${LOG_PREFIX} Fixture directory ${fixtureRoot} does not exist; ` +
        `cache warm-up skipped. (This is expected before fixture files are authored.)`,
    );
    return 0;
  }

  const fixtures = walkJsonFiles(fixtureRoot);
  let count = 0;
  for (const filePath of fixtures) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      // Validate the file is well-formed JSON. We discard the parsed value;
      // the goal is fail-fast detection, not in-memory caching (mocks read
      // these files lazily per test via the page.route() handler).
      JSON.parse(raw);
      count++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`${LOG_PREFIX} Fixture file ${filePath} is not valid JSON: ${message}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`${LOG_PREFIX} Warmed and validated ${count} mock API fixture file(s).`);
  return count;
}

/**
 * Recursively walk a directory and return absolute paths of every `.json`
 * file found. Order is the OS-reported `readdirSync` order (typically
 * insertion-order on Linux ext4, alphabetical on others).
 *
 * Implementation note: synchronous `readdirSync`/`statSync` are acceptable
 * here because globalSetup is allowed to block; per AAP section 0.5.1.2 the
 * hook is invoked once before any worker is spawned and tests do not start
 * until this function returns.
 *
 * @param dir - Absolute directory path to walk.
 * @returns A list of absolute paths to every `.json` descendant.
 */
function walkJsonFiles(dir: string): string[] {
  const out: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Recurse into subdirectory, preserving discovery order.
      out.push(...walkJsonFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      out.push(full);
    }
    // Symlinks and other special files are ignored on purpose -- the
    // fixture tree is expected to contain only real files and directories.
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine whether mock-mode is active.
 *
 * Truth table:
 *
 *   | E2E_API_MODE | MOCK_API   | Result          |
 *   |--------------|------------|-----------------|
 *   | (unset)      | (unset)    | true (default)  |
 *   | mock         | (unset)    | true            |
 *   | mock         | true       | true            |
 *   | mock         | false      | false           |
 *   | live         | (unset)    | false           |
 *   | live         | true       | false           |
 *   | live         | false      | false           |
 *
 * Both env vars are validated upstream by `validateEnv()`, so by the time
 * this function executes the values (if set) are guaranteed to be valid.
 *
 * @returns `true` iff mocks should be active for the current run.
 */
function isMockMode(): boolean {
  const apiMode = process.env.E2E_API_MODE ?? 'mock';
  // MOCK_API is treated as truthy unless explicitly 'false' (the documented
  // legacy compatibility toggle from .env.e2e.example).
  const mockApiNotFalse = process.env.MOCK_API !== 'false';
  return apiMode === 'mock' && mockApiNotFalse;
}

/**
 * Emit a single structured one-line summary of what setup accomplished, for
 * CI traceability. Kept multi-segment but on one line so log aggregation
 * tools (Splunk, Datadog) can ingest it as a single event.
 *
 * Credentials are NEVER included; only counts and labels.
 */
function emitSetupReport(report: SetupReport): void {
  // eslint-disable-next-line no-console
  console.log(
    `${LOG_PREFIX} Summary: baseUrl=${report.baseUrl} | ` +
      `apiMode=${report.apiMode} | mockEnabled=${report.mockEnabled} | ` +
      `rolesGenerated=[${report.rolesGenerated.join(',')}] | ` +
      `fixturesWarmed=${report.fixturesWarmed} | ` +
      `baseUrlReachable=${report.baseUrlReachable}`,
  );
}
