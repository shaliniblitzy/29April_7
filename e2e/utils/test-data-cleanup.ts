/**
 * Live-mode test-data cleanup helper.
 *
 * Removes E2E test entities (identified by a configurable name prefix, default
 * `e2e-test-`) from a Whoville-Client backend via the modules' listing/delete
 * endpoints. Designed to run in live-API mode (`E2E_API_MODE=live`) where
 * factory-created entities accumulate in the staging database; mock-mode runs
 * never touch a real backend and therefore never invoke this code path.
 *
 * Per AAP §0.4.4 ("Live-mode database hygiene"):
 *   "When `E2E_API_MODE=live`, factory-created entities use a `e2e-test-`
 *    prefix and are cleaned up via API in a `test.afterEach()` hook; a
 *    separate nightly-cleanup workflow sweeps any orphans."
 *
 * This module is the SECOND line of defense — each test SHOULD clean up its
 * own entities via `test.afterEach()`, and this function sweeps any leaks at
 * run-end (`global-teardown.ts`) and on a nightly cleanup workflow
 * (`.github/workflows/e2e-live-api-nightly.yml`).
 *
 * ## Foundational layer constraint
 *
 * Per AAP §0.6.2 and the e2e/utils/ architectural pillar: this file imports
 * ONLY `@playwright/test` (for the `request` API context to perform HTTP
 * calls) and Node.js built-ins. It is consumed BY higher layers
 * (`e2e/global-teardown.ts`, scripts) but never imports from
 * `@fixtures`, `@pages`, `@patterns`, `@factories`, or `@mocks` — doing so
 * would create a layering inversion the e2e/.eslintrc.json rules forbid.
 *
 * ## HTTP-only, never browser-launched
 *
 * Cleanup uses `request.newContext()` — a browser-less HTTP client — to issue
 * GET listings and DELETE requests. We never call `chromium.launch()` here:
 * a browser launch would add ~3 seconds of unnecessary overhead per cleanup
 * invocation while contributing zero value (we are not exercising any
 * client-side behavior; we only need to send HTTP).
 *
 * ## Safety rails
 *
 *   - Minimum 3-character prefix guard prevents catastrophic mass-deletion
 *     if `E2E_TEST_DATA_PREFIX` is misconfigured to an empty string.
 *   - Server-side filter + client-side filter (defense-in-depth) ensures we
 *     never delete an entity whose name doesn't actually start with the
 *     prefix, even if the server's `q` parameter is a substring matcher.
 *   - 404 on DELETE counts as success: cleanup is idempotent — a per-test
 *     `afterEach` may have already removed the entity by the time the
 *     global sweep runs.
 *   - Errors are collected into `result.errors`, never thrown — a single
 *     failed DELETE must not abort the whole sweep. Subsequent nightly runs
 *     will retry leftovers.
 *   - `APIRequestContext.dispose()` is called from a `finally` block to
 *     guarantee connection-pool release even on unexpected exception.
 *
 * @see AAP §0.5.1.12 — file mandate (CREATE).
 * @see AAP §0.4.4 — test data and fixtures design.
 * @see AAP §0.3.1 — dependency-mocking table that defines the scope of
 *      backend API endpoints (`/api/workforce/**`, `/api/assessments/**`,
 *      `/api/competencies/**`, `/api/auth-mgmt/**`).
 * @see AAP §0.6.1 — Playwright 1.59.1 lock-step pinning.
 * @see AAP §0.10.2 — critical implementation reminders (idempotency,
 *      mock JSON freshness, route inventory upkeep).
 * @see e2e/global-teardown.ts — primary caller (lazy-imported).
 * @see .github/workflows/e2e-live-api-nightly.yml — secondary caller via
 *      `npm run e2e:nightly-cleanup`.
 */

// ---------------------------------------------------------------------------
// Imports — strictly limited to `@playwright/test` per the e2e/utils/ layering
// constraint (AAP §0.6.2). The `request` symbol is a runtime value (factory
// for `APIRequestContext`); `APIRequestContext` and `APIResponse` are
// imported with `type` to make their TypeScript-erased nature explicit and
// preserve the foundational module's compile-only coupling on those names.
// ---------------------------------------------------------------------------

import { request, type APIRequestContext, type APIResponse } from '@playwright/test';

// ---------------------------------------------------------------------------
// Public type definitions
// ---------------------------------------------------------------------------

/**
 * Module identifier for restricting cleanup scope.
 *
 * Aligns with AAP §0.3.1 functional-area decomposition (the four lazy-loaded
 * Whoville-Client feature modules whose entities require cleanup). App Core
 * does not appear here because it owns no CRUD entities — its surface is
 * limited to the eager-loaded shell, header/nav, login, error pages, etc.,
 * none of which are persisted to the backend.
 */
export type ModuleScope = 'workforce' | 'assessments' | 'competencies' | 'authorization';

/**
 * Options controlling a sweep run.
 *
 * Required: `baseUrl`, `prefix`. Optional: everything else, with safe defaults
 * applied inside `sweepEntitiesByPrefix`.
 */
export interface CleanupOptions {
  /**
   * Base URL of the Whoville-Client backend (no trailing slash recommended).
   *
   * @example 'https://staging.whoville.example.internal'
   * @example 'http://localhost:4200'
   */
  baseUrl: string;

  /**
   * Name/identifier prefix used to filter test entities. Entities whose
   * `nameField` starts with this prefix are deletion candidates.
   *
   * Must be at least 3 characters long — values shorter than that are
   * rejected to prevent accidental mass-deletion if the env var is
   * misconfigured.
   *
   * @example 'e2e-test-'
   */
  prefix: string;

  /**
   * Optional bearer token for authenticated DELETE requests. When set, the
   * `Authorization: Bearer <token>` header is added to every HTTP call. Leave
   * unset for dev environments with auth disabled (the `Authorization`
   * header is omitted entirely in that case).
   */
  apiToken?: string;

  /**
   * Per-request timeout in milliseconds. Applies to both GET listing calls
   * and individual DELETE calls.
   *
   * @default 15_000 (15 seconds)
   */
  timeoutMs?: number;

  /**
   * Optional list of module identifiers to limit the sweep. When unset,
   * sweeps all four modules. When set, only the listed modules are swept —
   * useful in nightly workflows that target a specific subsystem.
   *
   * @example ['workforce', 'assessments']
   */
  modules?: ReadonlyArray<ModuleScope>;

  /**
   * If true, log each entity that would be deleted but do NOT actually issue
   * DELETE requests. Useful for dry-runs, audit logging, and verifying the
   * filter logic before unleashing real deletes against staging.
   *
   * @default false
   */
  dryRun?: boolean;
}

/**
 * Result of a sweep run, returned for caller logging / metrics aggregation.
 *
 * The `byModule` map is always populated for every `ModuleScope` (even
 * modules excluded by the `modules` filter, which contribute zero) so
 * callers can iterate without checking key presence. The `errors` array
 * captures recoverable failures encountered during the sweep without
 * aborting the run.
 */
export interface CleanupResult {
  /** Total entities cleaned across all modules. Equal to the sum of `byModule` values. */
  totalCleaned: number;
  /** Per-module counts. Keys cover every `ModuleScope`. */
  byModule: Record<ModuleScope, number>;
  /** Per-module errors. Empty when the sweep encountered no recoverable failures. */
  errors: Array<{ module: ModuleScope; entity: string; error: string }>;
  /** Was this a dry run? Mirrors the input option for downstream reporting. */
  dryRun: boolean;
}

// ---------------------------------------------------------------------------
// Internal type definitions (file-local — not exported)
// ---------------------------------------------------------------------------

/**
 * Internal descriptor mapping one module's entity type to its REST endpoints.
 *
 * Endpoint descriptors are data, not code: adding a new entity's cleanup is
 * a one-line addition to `ENDPOINT_DESCRIPTORS`, never a code change to the
 * sweep loop. This mirrors the "configuration-driven" philosophy of Patterns
 * A–E (AAP §0.10.1) — adding a new entity is a config change, not a logic
 * change.
 */
interface EndpointDescriptor {
  /** Module id used to bucket counts in `CleanupResult.byModule`. */
  module: ModuleScope;
  /** API path used to list entities (relative to baseUrl). Supports query params at runtime. */
  listPath: string;
  /**
   * API path template used to DELETE a single entity (relative to baseUrl).
   * The `{id}` placeholder is substituted with the URI-encoded id at runtime.
   */
  deletePathTemplate: string;
  /** Field on each list-response item that identifies the entity to delete. Typically `'id'`. */
  idField: string;
  /** Field on each list-response item that holds the searchable name. Typically `'name'`. */
  nameField: string;
  /**
   * Query parameter name used to filter listings by prefix server-side. When
   * unset, the listing is fetched unfiltered and matching is done entirely
   * client-side. Server-side filter is preferred when supported because it
   * reduces bandwidth on large data sets.
   */
  searchQueryParam?: string;
}

// ---------------------------------------------------------------------------
// Module-to-endpoint map
//
// Each entry represents one CRUD-eligible entity type within a module that
// needs cleanup. The endpoint paths align with the AAP §0.3.1
// dependency-mocking table:
//
//   - /api/workforce/**     -> Workforce module
//   - /api/assessments/**   -> Assessments module
//   - /api/competencies/**  -> Competencies module
//   - /api/auth-mgmt/**     -> Authorization module
//
// The exact entity slugs (`teams`, `assignments`, `templates`, etc.) reflect
// the entities enumerated in AAP §0.5.1.4 through §0.5.1.7 (Page Object
// Models). When the Whoville-Client backend's actual REST routes differ
// (e.g., kebab-case vs. snake_case), this constant is the single point of
// adjustment — sweep loop logic stays unchanged.
// ---------------------------------------------------------------------------

const ENDPOINT_DESCRIPTORS: ReadonlyArray<EndpointDescriptor> = [
  // ----------------------------- Workforce -----------------------------
  {
    module: 'workforce',
    listPath: '/api/workforce/teams',
    deletePathTemplate: '/api/workforce/teams/{id}',
    idField: 'id',
    nameField: 'name',
    searchQueryParam: 'q',
  },
  {
    module: 'workforce',
    listPath: '/api/workforce/assignments',
    deletePathTemplate: '/api/workforce/assignments/{id}',
    idField: 'id',
    nameField: 'title',
    searchQueryParam: 'q',
  },
  {
    module: 'workforce',
    listPath: '/api/workforce/transfers',
    deletePathTemplate: '/api/workforce/transfers/{id}',
    idField: 'id',
    nameField: 'reference',
    searchQueryParam: 'q',
  },
  {
    module: 'workforce',
    listPath: '/api/workforce/leave-requests',
    deletePathTemplate: '/api/workforce/leave-requests/{id}',
    idField: 'id',
    nameField: 'reference',
    searchQueryParam: 'q',
  },

  // ---------------------------- Assessments ----------------------------
  {
    module: 'assessments',
    listPath: '/api/assessments/templates',
    deletePathTemplate: '/api/assessments/templates/{id}',
    idField: 'id',
    nameField: 'name',
    searchQueryParam: 'q',
  },
  {
    module: 'assessments',
    listPath: '/api/assessments/cycles',
    deletePathTemplate: '/api/assessments/cycles/{id}',
    idField: 'id',
    nameField: 'name',
    searchQueryParam: 'q',
  },
  {
    module: 'assessments',
    listPath: '/api/assessments/responses',
    deletePathTemplate: '/api/assessments/responses/{id}',
    idField: 'id',
    nameField: 'reference',
    searchQueryParam: 'q',
  },

  // --------------------------- Competencies ----------------------------
  {
    module: 'competencies',
    listPath: '/api/competencies/catalog',
    deletePathTemplate: '/api/competencies/catalog/{id}',
    idField: 'id',
    nameField: 'name',
    searchQueryParam: 'q',
  },
  {
    module: 'competencies',
    listPath: '/api/competencies/skills',
    deletePathTemplate: '/api/competencies/skills/{id}',
    idField: 'id',
    nameField: 'name',
    searchQueryParam: 'q',
  },
  {
    module: 'competencies',
    listPath: '/api/competencies/learning-paths',
    deletePathTemplate: '/api/competencies/learning-paths/{id}',
    idField: 'id',
    nameField: 'name',
    searchQueryParam: 'q',
  },
  {
    module: 'competencies',
    listPath: '/api/competencies/certifications',
    deletePathTemplate: '/api/competencies/certifications/{id}',
    idField: 'id',
    nameField: 'name',
    searchQueryParam: 'q',
  },

  // --------------------------- Authorization ---------------------------
  {
    module: 'authorization',
    listPath: '/api/auth-mgmt/roles',
    deletePathTemplate: '/api/auth-mgmt/roles/{id}',
    idField: 'id',
    nameField: 'name',
    searchQueryParam: 'q',
  },
  {
    module: 'authorization',
    listPath: '/api/auth-mgmt/permissions',
    deletePathTemplate: '/api/auth-mgmt/permissions/{id}',
    idField: 'id',
    nameField: 'name',
    searchQueryParam: 'q',
  },
  {
    module: 'authorization',
    listPath: '/api/auth-mgmt/role-grants',
    deletePathTemplate: '/api/auth-mgmt/role-grants/{id}',
    idField: 'id',
    nameField: 'reference',
    searchQueryParam: 'q',
  },
];

// ---------------------------------------------------------------------------
// Module constants
// ---------------------------------------------------------------------------

/** Default name prefix used when `opts.prefix` is the empty string / unset. */
const DEFAULT_PREFIX = 'e2e-test-';

/** Default per-request timeout (15 seconds) — generous enough for cold caches on staging. */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Minimum prefix length safety rail. Prefixes shorter than this trigger a
 * thrown error before any HTTP call is issued. The intent is to make
 * "delete every entity whose name starts with `''`" impossible —
 * even an explicit `prefix: ''` argument is rejected.
 */
const MIN_PREFIX_LENGTH = 3;

/**
 * Page size requested in listings. 1000 is large enough to cover a typical
 * test run's entity surface in a single request; if a single test family
 * leaks more than 1000 entities the next nightly sweep catches the rest
 * (the sweep is designed to be idempotent across multiple runs).
 */
const LIST_PAGE_SIZE = 1000;

/** Log prefix applied to every console message emitted from this module. */
const LOG_PREFIX = '[test-data-cleanup]';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sweeps all entities whose name field begins with the configured prefix
 * across all (or a subset of) modules. Issues HTTP DELETE for each match.
 *
 * The function is fail-tolerant: HTTP errors during list or delete are
 * collected into `result.errors` and the sweep continues. The only
 * exceptions thrown are validation errors raised before any HTTP call
 * (missing baseUrl, too-short prefix); these signal misconfiguration and
 * should fail loudly so the caller can correct the inputs.
 *
 * @param opts - Sweep configuration. See {@link CleanupOptions}.
 * @returns Promise resolving to a {@link CleanupResult} with per-module
 *   counts and accumulated errors.
 *
 * @throws {Error} If `opts.baseUrl` is empty, or if the resolved prefix is
 *   shorter than 3 characters.
 *
 * @example Default sweep against staging:
 * ```ts
 * const result = await sweepEntitiesByPrefix({
 *   baseUrl: 'https://staging.whoville.example.internal',
 *   prefix: 'e2e-test-',
 *   apiToken: process.env.E2E_API_TOKEN,
 * });
 * console.log(`Cleaned ${result.totalCleaned} entities; errors: ${result.errors.length}`);
 * ```
 *
 * @example Dry-run on a single module:
 * ```ts
 * const result = await sweepEntitiesByPrefix({
 *   baseUrl: 'http://localhost:4200',
 *   prefix: 'e2e-test-',
 *   modules: ['workforce'],
 *   dryRun: true,
 * });
 * // Logs each entity that WOULD be deleted; result.totalCleaned reflects
 * // the count that would be deleted; no actual DELETE requests sent.
 * ```
 */
export async function sweepEntitiesByPrefix(opts: CleanupOptions): Promise<CleanupResult> {
  // -------------------------------------------------------------------------
  // Step 1: Resolve defaults and validate inputs.
  //
  // We use `||` (not `??`) on `prefix` so that a literal empty-string passed
  // for `prefix` falls back to the default — the caller plainly didn't mean
  // to sweep with empty prefix, and we also enforce the minimum-length guard
  // immediately after.
  // -------------------------------------------------------------------------
  const prefix = opts.prefix && opts.prefix.length > 0 ? opts.prefix : DEFAULT_PREFIX;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const dryRun = opts.dryRun ?? false;
  const modulesFilter = opts.modules;

  if (!opts.baseUrl) {
    throw new Error(`${LOG_PREFIX} sweepEntitiesByPrefix requires opts.baseUrl`);
  }
  if (prefix.length < MIN_PREFIX_LENGTH) {
    // Refusing too-short prefixes prevents catastrophic mass-deletion if
    // E2E_TEST_DATA_PREFIX is misconfigured. The default 'e2e-test-' is
    // 9 characters, well above this threshold.
    throw new Error(
      `${LOG_PREFIX} Refusing to sweep with prefix '${prefix}' — must be \u2265 ${MIN_PREFIX_LENGTH} characters`,
    );
  }

  // -------------------------------------------------------------------------
  // Step 2: Build the HTTP request context.
  //
  // We use Playwright's `request.newContext()` (not a browser launch). This
  // is a pure HTTP client, identical in capability to `fetch`/`axios` but
  // bundled with `@playwright/test` so we add zero new dependencies. The
  // `baseURL` option lets all subsequent paths be relative.
  // -------------------------------------------------------------------------
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (opts.apiToken) {
    headers.Authorization = `Bearer ${opts.apiToken}`;
  }

  const ctx: APIRequestContext = await request.newContext({
    baseURL: opts.baseUrl,
    extraHTTPHeaders: headers,
    timeout: timeoutMs,
  });

  // -------------------------------------------------------------------------
  // Step 3: Initialize the result accumulator. Every ModuleScope is
  // pre-populated with 0 so callers can iterate the map without checking
  // key presence.
  // -------------------------------------------------------------------------
  const result: CleanupResult = {
    totalCleaned: 0,
    byModule: { workforce: 0, assessments: 0, competencies: 0, authorization: 0 },
    errors: [],
    dryRun,
  };

  // -------------------------------------------------------------------------
  // Step 4: Iterate the endpoint descriptors, skipping any module not
  // included in the optional filter. Per-endpoint failures are localized
  // (collected into `result.errors`) and never abort the loop.
  //
  // The `try/finally` guarantees `ctx.dispose()` runs even if a sweep step
  // throws unexpectedly — failing to dispose leaks the connection pool and
  // can hang Node's process exit.
  // -------------------------------------------------------------------------
  try {
    for (const desc of ENDPOINT_DESCRIPTORS) {
      if (modulesFilter && !modulesFilter.includes(desc.module)) {
        continue;
      }
      await sweepSingleEndpoint(ctx, desc, prefix, dryRun, result);
    }
  } finally {
    await ctx.dispose();
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internal helpers (not exported)
// ---------------------------------------------------------------------------

/**
 * Sweeps a single endpoint: list → filter → delete.
 *
 * Errors are appended to `result.errors` and never thrown. The caller
 * (`sweepEntitiesByPrefix`) continues with the next endpoint regardless of
 * what happens here — a failed sweep on `/api/workforce/teams` does not
 * prevent `/api/workforce/assignments` from running.
 *
 * @param ctx - The shared `APIRequestContext`. Caller owns disposal.
 * @param desc - The endpoint descriptor (list/delete paths, field map).
 * @param prefix - The prefix to filter on (already validated for length).
 * @param dryRun - When true, log but do not issue DELETE.
 * @param result - Mutable accumulator: counts and errors are written in place.
 */
async function sweepSingleEndpoint(
  ctx: APIRequestContext,
  desc: EndpointDescriptor,
  prefix: string,
  dryRun: boolean,
  result: CleanupResult,
): Promise<void> {
  // -------------------------------------------------------------------------
  // Step 1: Fetch the listing (server-side filter applied when supported).
  //
  // We append `&size=LIST_PAGE_SIZE` to encourage the server to return as
  // many matching entities as possible in a single response. Backends that
  // ignore unknown params will simply use their default page size; backends
  // that honor it return up to LIST_PAGE_SIZE rows. Either way we proceed
  // with whatever the server returns.
  // -------------------------------------------------------------------------
  const listUrl = desc.searchQueryParam
    ? `${desc.listPath}?${desc.searchQueryParam}=${encodeURIComponent(prefix)}&size=${LIST_PAGE_SIZE}`
    : `${desc.listPath}?size=${LIST_PAGE_SIZE}`;

  let response: APIResponse;
  try {
    response = await ctx.get(listUrl, { failOnStatusCode: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${LOG_PREFIX} Failed to list ${desc.module} at ${listUrl}: ${message}`);
    result.errors.push({ module: desc.module, entity: '<list>', error: message });
    return;
  }

  if (!response.ok()) {
    const message = `HTTP ${response.status()} ${response.statusText()}`;
    console.warn(`${LOG_PREFIX} ${desc.module} listing returned ${message}`);
    result.errors.push({ module: desc.module, entity: '<list>', error: message });
    return;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    const message = `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`;
    console.warn(`${LOG_PREFIX} ${desc.module} listing returned ${message}`);
    result.errors.push({ module: desc.module, entity: '<list>', error: message });
    return;
  }

  const items = extractItems(body);
  if (items === null) {
    console.warn(
      `${LOG_PREFIX} ${desc.module} listing did not return an array or known wrapper shape; skipping`,
    );
    return;
  }

  // -------------------------------------------------------------------------
  // Step 2: Apply the client-side prefix filter (defense-in-depth).
  //
  // Even when the server-side `q` parameter is honored, we re-filter on the
  // client because:
  //   (a) Some backends interpret `q` as a substring match (a query for
  //       'e2e-test-' could match 'My Item e2e-test-suffix' which doesn't
  //       *start* with the prefix), risking wrong-target deletes.
  //   (b) If the server-side filter is broken (e.g., returns ALL entities),
  //       the client-side filter prevents accidentally deleting non-test
  //       data.
  //   (c) The minimum-3-character prefix guard combined with a strict
  //       `String.startsWith` check makes this filter a hard safety rail
  //       against catastrophic data loss.
  //
  // The filter rejects items whose name field is missing, non-string, or
  // doesn't startWith the prefix.
  // -------------------------------------------------------------------------
  const matching = items.filter((item) => {
    const name = readField(item, desc.nameField);
    return typeof name === 'string' && name.startsWith(prefix);
  });

  // -------------------------------------------------------------------------
  // Step 3: Issue DELETE for each match (or log if dry run).
  //
  // - Missing/null id → skip with warning (we cannot construct the DELETE
  //   path without an id).
  // - HTTP 2xx → success, increment counter.
  // - HTTP 404 → success (idempotent: entity was already deleted by an
  //   afterEach hook earlier in the suite).
  // - HTTP 5xx / 4xx-other → failure, append to errors, continue.
  // - Network error / timeout → failure, append to errors, continue.
  // -------------------------------------------------------------------------
  for (const item of matching) {
    const idValue = readField(item, desc.idField);
    const nameValue = readField(item, desc.nameField);
    const entityName = typeof nameValue === 'string' ? nameValue : String(nameValue);

    if (idValue === undefined || idValue === null) {
      console.warn(
        `${LOG_PREFIX} ${desc.module} entity '${entityName}' missing '${desc.idField}'; skipping`,
      );
      continue;
    }

    const deletePath = desc.deletePathTemplate.replace('{id}', encodeURIComponent(String(idValue)));

    if (dryRun) {
      console.log(
        `${LOG_PREFIX} DRY-RUN would DELETE ${desc.module} '${entityName}' (${deletePath})`,
      );
      result.byModule[desc.module] += 1;
      result.totalCleaned += 1;
      continue;
    }

    try {
      const del = await ctx.delete(deletePath, { failOnStatusCode: false });
      if (del.ok() || del.status() === 404) {
        // 404 acceptable — entity already removed (idempotent cleanup).
        // The afterEach hook may have raced this sweep; that's expected
        // and not an error per REST DELETE semantics.
        result.byModule[desc.module] += 1;
        result.totalCleaned += 1;
      } else {
        const message = `HTTP ${del.status()} ${del.statusText()}`;
        console.warn(`${LOG_PREFIX} DELETE ${deletePath} failed: ${message}`);
        result.errors.push({ module: desc.module, entity: entityName, error: message });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`${LOG_PREFIX} DELETE ${deletePath} threw: ${message}`);
      result.errors.push({ module: desc.module, entity: entityName, error: message });
    }
  }
}

/**
 * Extracts the list-of-items payload from a paginated API response.
 *
 * Handles common response shapes used by REST APIs:
 *   - Bare array:               `[...]`
 *   - Spring Data:              `{ content: [...] }`
 *   - JSON:API / generic:       `{ data: [...] }`
 *   - HAL / common pagination:  `{ items: [...] }`
 *   - Search-result style:      `{ results: [...] }`
 *
 * The probe order is biased toward most-common shapes first. The first
 * key whose value is an array wins. If no recognized shape matches,
 * returns `null` to signal "skip this endpoint" to the caller (rather
 * than crashing on a poorly-shaped response that we can't interpret).
 *
 * @param body - Parsed JSON body of a list response.
 * @returns The array of items if recognized, otherwise `null`.
 */
function extractItems(body: unknown): unknown[] | null {
  // `Array.isArray` narrows to `any[]` due to a TypeScript stdlib quirk; we
  // re-cast to `unknown[]` immediately so downstream code keeps the strict
  // unknown-element type and never silently propagates `any` through the
  // sweep loop. This is a deliberate, type-safe widening (every `any[]` IS
  // an `unknown[]`).
  if (Array.isArray(body)) {
    return body as unknown[];
  }
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    for (const key of ['data', 'items', 'content', 'results'] as const) {
      const value = obj[key];
      if (Array.isArray(value)) {
        return value as unknown[];
      }
    }
  }
  return null;
}

/**
 * Reads a top-level field from a list-response item.
 *
 * Supports simple top-level fields only — no nested 'a.b.c' path syntax.
 * The endpoints in `ENDPOINT_DESCRIPTORS` all expose their identifier and
 * name as top-level fields, so we don't pay the complexity tax for nested
 * paths. If a future endpoint requires nested access, extend this helper
 * (and update the `idField` / `nameField` shape on `EndpointDescriptor`).
 *
 * Returns `undefined` for non-object inputs, arrays, or missing keys.
 *
 * @param item - A single entity from a list response.
 * @param field - The top-level field name to read.
 * @returns The field value, or `undefined` if not readable.
 */
function readField(item: unknown, field: string): unknown {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    return (item as Record<string, unknown>)[field];
  }
  return undefined;
}
