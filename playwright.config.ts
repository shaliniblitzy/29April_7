/**
 * Playwright configuration for the Whoville-Client E2E test suite.
 *
 * Implements the 3-tier execution model described in the Agent Action Plan
 * (sections 0.1.1, 0.4.1, 0.5.2):
 *
 *   - Tier 1 - "smoke"        ~40 tests,  ~3 min   (PR-blocking on every commit)
 *   - Tier 2 - "feature-crud" ~640 tests, ~15 min  (PR pre-merge gate)
 *   - Tier 3 - "integration"  ~130 tests, ~25 min  (nightly + pre-release)
 *
 * Each project is wired to its own testMatch glob, retry policy, worker
 * allocation, and timeout budget. The webServer block is intentionally
 * commented-out in this stub - it will be enabled when the Whoville-Client
 * Angular 11.2.5 application is brought into scope (its source is not present
 * in this documentation-locus repository per AAP section 0.8.2).
 *
 * Mock-by-default: tests register page.route('**\/api/**', ...) interceptors
 * via the shared mock-api fixture unless E2E_API_MODE=live is set.
 *
 * The globalSetup / globalTeardown hooks are wired conditionally - they bind
 * to e2e/global-setup.(ts|js) and e2e/global-teardown.(ts|js) IF those files
 * exist on disk, and are a no-op otherwise. This lets the config load before
 * subsequent agents author the full implementation per AAP section 0.5.1.2.
 */

import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

// Load .env.e2e if present (developer-local). Optional; CI uses real env vars.
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('dotenv').config({ path: path.resolve(__dirname, '.env.e2e') });
} catch {
  // dotenv is optional - if it isn't installed yet we fall back to process.env
}

const isCI = !!process.env.CI;
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:4200';

/**
 * Resolve a Playwright hook (global-setup / global-teardown) to its on-disk
 * path if any of the expected file extensions exist. Returns undefined when
 * the file has not yet been authored, which causes Playwright to skip the
 * hook silently.
 */
function resolveOptionalHook(relativeBaseName: string): string | undefined {
  for (const ext of ['.ts', '.js', '.mjs', '.cjs']) {
    const candidate = path.resolve(__dirname, `${relativeBaseName}${ext}`);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

const globalSetupPath = resolveOptionalHook('e2e/global-setup');
const globalTeardownPath = resolveOptionalHook('e2e/global-teardown');

export default defineConfig({
  // ------------------------------------------------------------------
  // Test discovery
  // ------------------------------------------------------------------
  testDir: './e2e/specs',

  // ------------------------------------------------------------------
  // Global timeouts
  // ------------------------------------------------------------------
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },

  // ------------------------------------------------------------------
  // Execution policy
  // ------------------------------------------------------------------
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? '50%' : undefined,

  // ------------------------------------------------------------------
  // Global setup / teardown (conditional - see resolveOptionalHook above)
  // ------------------------------------------------------------------
  ...(globalSetupPath ? { globalSetup: globalSetupPath } : {}),
  ...(globalTeardownPath ? { globalTeardown: globalTeardownPath } : {}),

  // ------------------------------------------------------------------
  // Reporter pipeline (HTML + JUnit + GitHub annotations on CI)
  // ------------------------------------------------------------------
  reporter: isCI
    ? [
        ['list'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
        ['junit', { outputFile: 'test-results/junit.xml' }],
        ['github'],
      ]
    : [
        ['list'],
        ['html', { open: 'on-failure', outputFolder: 'playwright-report' }],
      ],

  outputDir: 'test-results',

  // ------------------------------------------------------------------
  // Shared options applied to every project unless overridden
  // ------------------------------------------------------------------
  use: {
    baseURL,
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true,
    ignoreHTTPSErrors: true,
    locale: 'en-US',
    timezoneId: 'America/New_York',
  },

  // ------------------------------------------------------------------
  // Three-tier project matrix (matches AAP section 0.4.1 budgets)
  // ------------------------------------------------------------------
  projects: [
    // -------- Tier 1: Smoke (~40 tests, ~3 min, Chromium only) --------
    {
      name: 'smoke',
      testMatch: /smoke\/.*\.smoke\.spec\.ts$/,
      timeout: 30_000,
      retries: isCI ? 1 : 0,
      use: { ...devices['Desktop Chrome'] },
    },

    // -------- Tier 2: Feature CRUD (~640 tests, ~15 min) --------
    {
      name: 'feature-crud',
      testMatch: /feature-crud\/.*\.crud\.spec\.ts$/,
      timeout: 30_000,
      retries: isCI ? 1 : 0,
      use: { ...devices['Desktop Chrome'] },
    },

    // -------- Tier 3: Integration (~130 tests, ~25 min) --------
    {
      name: 'integration',
      testMatch: /integration\/.*\.int\.spec\.ts$/,
      timeout: 60_000,
      retries: isCI ? 2 : 0,
      use: { ...devices['Desktop Chrome'] },
    },

    // -------- Cross-browser variants (used by nightly matrix only) --------
    {
      name: 'feature-crud-firefox',
      testMatch: /feature-crud\/.*\.crud\.spec\.ts$/,
      timeout: 30_000,
      retries: isCI ? 1 : 0,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'feature-crud-webkit',
      testMatch: /feature-crud\/.*\.crud\.spec\.ts$/,
      timeout: 30_000,
      retries: isCI ? 1 : 0,
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'integration-firefox',
      testMatch: /integration\/.*\.int\.spec\.ts$/,
      timeout: 60_000,
      retries: isCI ? 2 : 0,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'integration-webkit',
      testMatch: /integration\/.*\.int\.spec\.ts$/,
      timeout: 60_000,
      retries: isCI ? 2 : 0,
      use: { ...devices['Desktop Safari'] },
    },
  ],

  // ------------------------------------------------------------------
  // Local dev server (commented-out: enable when Whoville-Client app is
  // committed to this repository - see AAP section 0.8.2).
  // ------------------------------------------------------------------
  // webServer: {
  //   command: 'npm run start:e2e',
  //   url: baseURL,
  //   reuseExistingServer: !isCI,
  //   timeout: 180_000,
  //   stdout: 'pipe',
  //   stderr: 'pipe',
  // },
});
