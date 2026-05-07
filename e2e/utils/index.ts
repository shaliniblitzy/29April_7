/**
 * Barrel export for the `e2e/utils` foundational layer.
 *
 * Provides a single, stable import surface for every helper utility
 * used by the Whoville-Client Playwright suite. Per the path-alias
 * convention declared in `tsconfig.e2e.json`, consumers import utilities
 * via:
 *
 *     import { ROUTES, waitForAngular, sweepEntitiesByPrefix } from '@utils';
 *
 * rather than reaching into individual utility files. This keeps the
 * spec / fixture / page-object layer decoupled from the on-disk file
 * layout — adding a new utility becomes a single re-export entry here,
 * and no consumer needs to update its import path.
 *
 * ## Layering constraint (AAP §0.10.1)
 *
 * This barrel imports ONLY from sibling utility files within the same
 * directory. It does NOT import from `@fixtures`, `@pages`, `@patterns`,
 * `@mocks`, `@factories`, or any other E2E layer — that would create a
 * cycle because higher layers import this barrel.
 *
 * Per the QA INFO finding on `test-data-cleanup.ts` (value import of
 * `request` from Playwright), the barrel re-exports the value-importing
 * module identically; the strict-reading layer interpretation is
 * superseded by the explicit AAP §0.5.1.12 file mandate that
 * `test-data-cleanup.ts` perform live-mode HTTP cleanup.
 *
 * ## Re-export style (AAP §0.6.2 import convention)
 *
 * - Function and constant exports use `export { x } from './file'`.
 * - Type exports use `export type { T } from './file'` to ensure
 *   type-only imports compile down to nothing at runtime.
 * - Named re-exports rather than `export *` so the public API surface
 *   is visible at a glance and IDE auto-import suggestions stay focused.
 *
 * @see AAP §0.5.1.12 — file mandate ("`e2e/utils/index.ts` |
 *      CREATE | n/a | Barrel export.").
 * @see AAP §0.6.2 — Import update convention (path aliases).
 * @see AAP §0.10.1 — Foundational layer constraints.
 */

// ---------------------------------------------------------------------------
// Route inventory — single source of truth for all ~163 Whoville-Client routes.
// Used by Tier 1 smoke specs and the route-coverage CI gate.
// ---------------------------------------------------------------------------

export {
  ROUTES,
  ROUTES_BY_MODULE,
  ROUTE_COUNT,
  UNAUTHENTICATED_ROUTES,
  ROLE_RESTRICTED_ROUTES,
  PARAMETERIZED_ROUTES,
} from './route-inventory';
export type { Route, ModuleId, Tier } from './route-inventory';

// ---------------------------------------------------------------------------
// Wait-for-Angular shim — defensive zone-stability helper for the rare
// edge cases where Playwright's web-first auto-waiting is insufficient
// (e.g., before screenshot capture during heavy zone activity in
// Angular 11). Migration-proof: relies on the stable
// `getAllAngularTestabilities` API exposed by Angular 2+.
// ---------------------------------------------------------------------------

export { waitForAngular } from './wait-for-angular';

// ---------------------------------------------------------------------------
// Storage state helper — auth state read/write/exists/clear utilities
// used by `global-setup.ts` and the auth fixture to cache pre-authenticated
// browser contexts and avoid re-login on every test (per AAP §0.4.4).
// ---------------------------------------------------------------------------

export {
  getStorageStatePathForRole,
  readStorageState,
  writeStorageState,
  storageStateExists,
  clearStorageState,
} from './storage-state-helper';
export type {
  StorageState,
  StorageStateOrigin,
  StorageStateLocalStorageEntry,
  StorageStateCookie,
} from './storage-state-helper';

// ---------------------------------------------------------------------------
// Test-data cleanup — live-mode entity sweeper that removes orphan
// `e2e-test-` prefixed entities via API. Used by the `global-teardown`
// hook and the nightly `nightly-cleanup.yml` workflow.
// ---------------------------------------------------------------------------

export { sweepEntitiesByPrefix } from './test-data-cleanup';
export type { CleanupOptions, CleanupResult, ModuleScope } from './test-data-cleanup';
