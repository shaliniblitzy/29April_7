/**
 * Assessments API mock handler.
 *
 * Registered by `e2e/mocks/api-router.ts` against URL pattern `**\/api/assessments/**`.
 *
 * Handled resources (per AAP §0.3.1, §0.5.1.13, §0.5.1.10):
 *   /api/assessments/templates                   - CRUD + list (paginated)
 *   /api/assessments/templates/:id               - Read / Update / Delete
 *   /api/assessments/templates/:id/clone         - Clone-from-existing (POST)
 *   /api/assessments/cycles                      - CRUD + list (paginated)
 *   /api/assessments/cycles/:id                  - Read / Update / Delete
 *   /api/assessments/cycles/:id/launch           - Launch workflow (POST)
 *   /api/assessments/cycles/:id/close            - Close workflow (POST)
 *   /api/assessments/responses                   - List + create
 *   /api/assessments/responses/:id               - Read / Update / Delete
 *   /api/assessments/responses/:id/submit        - Submit-for-review (POST)
 *   /api/assessments/responses/:id/save          - Save-and-resume (PUT)
 *   /api/assessments/scoring/:cycleId            - Read / Update scoring grid
 *   /api/assessments/scoring/:cycleId/bulk       - Bulk score update (PATCH)
 *   /api/assessments/calibration/:cycleId        - Read calibration view
 *   /api/assessments/calibration/:cycleId/adjust - Manual adjustment (PATCH)
 *   /api/assessments/reporting/export            - Report export (POST -> 202)
 *
 * Pagination contract:
 *   GET /api/assessments/<resource>?page=N&size=M&q=<keyword>&sort=<field>&order=<asc|desc>
 *   Response: { data: [...], pagination: { page, size, total, totalPages } }
 *
 * Search/Filter/Sort contract:
 *   - `q` query parameter performs case-insensitive substring search across
 *     all top-level string/number/boolean fields of each item.
 *   - Any other (non-reserved) query parameter is treated as a strict
 *     case-insensitive equality filter on the same-named field.
 *   - `sort` selects the field to sort by; `order` is `asc` (default) or `desc`.
 *   - Reserved query parameters that are not used as filters: `q`, `page`,
 *     `size`, `sort`, `order`.
 *
 * Workflow sub-actions (REST convention - state transitions via POST):
 *   - Cycle launch / close are POST sub-actions (not PATCH) because they
 *     are stateful business operations matching the real Whoville-Client
 *     API contract per AAP §0.5.1.10's `cycle-launch.crud.spec.ts` and
 *     `cycle-close.crud.spec.ts` specs.
 *   - Response submit (POST) and save (PUT) are distinct endpoints so
 *     `response-save-resume.crud.spec.ts` (Pattern E) can test save and
 *     submit independently.
 *   - Reporting export returns 202 Accepted with a jobId because real
 *     reporting exports are asynchronous; tests assert the UI shows a
 *     "Report queued" status after invoking export.
 *
 * Layering contract (per the e2e/mocks/handlers/ folder requirements):
 *   - Imports allowed: `@playwright/test` (type-only), `fs`, `path`.
 *   - This file imports nothing from `@fixtures/*`, `@pages/*`, `@patterns/*`,
 *     `@factories/*`, `@utils/*`, sibling handlers, `../api-router`,
 *     `../latency-injector`, or `../error-injector`.
 *   - This file launches no browser and opens no network sockets; it only
 *     fulfils Playwright's `route.fulfill()` contract synchronously after
 *     reading from in-memory fixture data.
 *   - This file is stateless: every invocation creates fresh closures and
 *     fresh response objects so parallel test workers do not collide.
 *
 * Migration-proofness (per AAP §0.10.1):
 *   The HTTP API contract is the migration-stable surface; we mock at this
 *   layer rather than at the Angular service layer. The Angular 11 -> 21
 *   migration rewrites internal services freely, but `/api/assessments/**`
 *   URL paths and the JSON shapes returned here remain the contract.
 *
 * @see AAP §0.5.1.12 - mandate (Factories, Mocks, and Test Utilities)
 * @see AAP §0.5.1.13 - canonical fixtures (e2e/fixtures/api-responses/assessments/...)
 * @see AAP §0.3.1   - test target identification (Assessments API scope)
 * @see AAP §0.5.1.10 - Tier 2 CRUD specs that consume this handler
 * @see AAP §0.5.1.5  - Assessments POMs that drive the network requests
 * @see e2e/mocks/api-router.ts - registers this handler at `**\/api/assessments/**`
 * @see e2e/fixtures/api-responses/assessments/* - canonical JSON fixtures
 */

// ---------------------------------------------------------------------------
// Imports - strictly limited to `@playwright/test` (type-only) and the
// Node.js standard library (`fs`, `path`) per the e2e/mocks/handlers/
// layering contract. The `import type` clause is fully erased at compile
// time so no runtime dependency on the package exists.
// ---------------------------------------------------------------------------

import type { Route, Request } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

/**
 * Absolute path to the directory containing canonical assessments-module
 * JSON fixtures. Resolved relative to `__dirname` so the handler is
 * cross-platform (Windows / macOS / Linux) and survives reorganization of
 * the e2e/ directory.
 *
 * Layout:
 *   e2e/mocks/handlers/assessments.handler.ts  <-- file
 *   e2e/mocks/handlers/                        <-- __dirname
 *   e2e/mocks/                                 <-- path.join(__dirname, '..')
 *   e2e/                                       <-- path.join(__dirname, '..', '..')
 *   e2e/fixtures/api-responses/assessments/    <-- FIXTURE_ROOT
 */
const FIXTURE_ROOT = path.resolve(
  __dirname,
  '..',
  '..',
  'fixtures',
  'api-responses',
  'assessments',
);

/**
 * In-memory cache of JSON fixture file contents.
 *
 * - Key: relative path under FIXTURE_ROOT (e.g. 'templates-list.json').
 * - Value: file contents as a string when the read succeeded, or `null`
 *   when the file is missing / unreadable / contains malformed JSON.
 *
 * The cache is populated lazily on first read and persists for the
 * lifetime of the worker process. Fixtures are typically <10KB and the
 * total fixture set is bounded, so the memory footprint is negligible.
 *
 * `null` values are stored intentionally (rather than absent keys) so
 * that the Map.has() check short-circuits repeated read attempts that
 * would otherwise hit the filesystem on every miss.
 */
const FIXTURE_CACHE: Map<string, string | null> = new Map();

/**
 * Common log prefix used by every console message in this module so that
 * stack traces and CI output can be grep'd to a single source. Matches
 * the `[mock-api/<scope>]` convention established by the sibling
 * authorization.handler.ts / competencies.handler.ts and the
 * latency-injector / error-injector helpers.
 */
const LOG_PREFIX = '[mock-api/assessments]';

// ---------------------------------------------------------------------------
// Fixture-reading helpers
// ---------------------------------------------------------------------------

/**
 * Read a JSON fixture file from FIXTURE_ROOT into a cached string.
 *
 * Returns the raw file contents (validated as JSON-parseable) on success,
 * or `null` when the file is missing, unreadable, or contains malformed
 * JSON. Subsequent reads of the same relative path return the cached
 * result without touching the filesystem.
 *
 * Synchronous IO is used because (a) fixtures are tiny, (b) only a handful
 * of distinct fixtures are read per process, and (c) Playwright's route
 * handler API tolerates synchronous work inside an async callback.
 *
 * @param relPath  Path relative to FIXTURE_ROOT (e.g., 'templates-list.json').
 * @returns Raw fixture contents or `null` when unavailable.
 */
function readFixture(relPath: string): string | null {
  if (FIXTURE_CACHE.has(relPath)) {
    return FIXTURE_CACHE.get(relPath) ?? null;
  }
  const fullPath = path.join(FIXTURE_ROOT, relPath);
  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    // Validate that the file is JSON-parseable so downstream callers can
    // safely call JSON.parse without redundant try/catch.
    JSON.parse(content);
    FIXTURE_CACHE.set(relPath, content);
    return content;
  } catch (err) {
    const reason =
      (err as NodeJS.ErrnoException).code === 'ENOENT'
        ? 'missing'
        : `unreadable: ${(err as Error).message}`;
    console.warn(`${LOG_PREFIX} Fixture ${reason}: ${fullPath}. Using inline default.`);
    FIXTURE_CACHE.set(relPath, null);
    return null;
  }
}

/**
 * Read and JSON-parse a fixture file in one call. Returns `null` when the
 * file is unavailable or contains malformed JSON. Callers should fall
 * back to inline defaults when this returns `null`.
 *
 * @typeParam T  Expected shape of the parsed JSON. No runtime validation
 *   is performed; the cast is a static-only assertion.
 */
function readFixtureJson<T>(relPath: string): T | null {
  const raw = readFixture(relPath);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Should not happen because readFixture validates JSON-parseability
    // up-front, but we defend against the cache being externally mutated.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Inline default responses
//
// These constants act as the safety net when canonical JSON fixtures under
// `e2e/fixtures/api-responses/assessments/` are missing. They contain
// realistic, recognizable performance-management-domain data ("Annual
// Performance Review", "Quarterly Check-in") so test assertions remain
// readable - e.g., `expect(page.getByText('Annual Performance Review'))
// .toBeVisible()` is more meaningful than `expect(page.getByText('Template 001'))
// .toBeVisible()` per AAP §0.10.1's migration-proof readability directive.
//
// All defaults are declared as plain object literals (not `as const`) so
// downstream code can spread them into Records without having to peel off
// the readonly-tuple types that `as const` introduces.
// ---------------------------------------------------------------------------

/**
 * Default templates list returned when `templates-list.json` is unavailable.
 * Three canonical templates: an annual review (published v3), a quarterly
 * check-in (published v2), and a probationary review (still draft v1).
 * Mixed status values let filter-by-status test scenarios exercise the
 * `applyFilters` helper without authoring a per-test fixture.
 */
const DEFAULT_TEMPLATES_LIST = {
  data: [
    {
      id: 'tmpl-001',
      name: 'Annual Performance Review',
      version: 'v3',
      status: 'published',
      createdAt: '2026-01-10T10:00:00Z',
    },
    {
      id: 'tmpl-002',
      name: 'Quarterly Check-in',
      version: 'v2',
      status: 'published',
      createdAt: '2026-02-01T10:00:00Z',
    },
    {
      id: 'tmpl-003',
      name: 'Probationary Review',
      version: 'v1',
      status: 'draft',
      createdAt: '2026-03-15T10:00:00Z',
    },
  ],
};

/**
 * Default template detail returned for any GET /api/assessments/templates/:id
 * request. The `id` field is overridden with the requested id at response
 * time so detail-view tests asserting `id === '<requested>'` always pass.
 *
 * The `sections` array models the canonical 3-section template (Goals,
 * Competencies, Self-Reflection) used by the Tier 2 Pattern C
 * `template-create.crud.spec.ts` and `template-edit.crud.spec.ts` specs.
 */
const DEFAULT_TEMPLATE_DETAIL = {
  id: 'tmpl-001',
  name: 'Annual Performance Review',
  description: 'Comprehensive yearly performance assessment.',
  version: 'v3',
  status: 'published',
  sections: [
    { id: 'sec-001', name: 'Goals', order: 1, questionCount: 5 },
    { id: 'sec-002', name: 'Competencies', order: 2, questionCount: 8 },
    { id: 'sec-003', name: 'Self-Reflection', order: 3, questionCount: 4 },
  ],
  createdAt: '2026-01-10T10:00:00Z',
  updatedAt: '2026-04-15T10:00:00Z',
};

/**
 * Default cycles list returned when `cycles-list.json` is unavailable.
 * Two canonical cycles cover the active and closed lifecycle states so
 * status-filter test scenarios exercise non-trivial result sets.
 */
const DEFAULT_CYCLES_LIST = {
  data: [
    {
      id: 'cyc-001',
      name: '2026 Annual Review',
      templateId: 'tmpl-001',
      status: 'active',
      startsAt: '2026-04-01T00:00:00Z',
      endsAt: '2026-05-31T23:59:59Z',
    },
    {
      id: 'cyc-002',
      name: '2026 Q1 Check-in',
      templateId: 'tmpl-002',
      status: 'closed',
      startsAt: '2026-03-01T00:00:00Z',
      endsAt: '2026-03-31T23:59:59Z',
    },
  ],
};

/**
 * Default cycle detail returned for GET /api/assessments/cycles/:id.
 *
 * The `participantCount`, `responseCount`, and `completionRate` fields
 * give the Whoville-Client cycle-detail UI sensible numbers to render
 * even before a canonical fixture is committed. Tests asserting on
 * specific completion rates would override these via
 * `mockApi.intercept()` per AAP §0.4.4.
 */
const DEFAULT_CYCLE_DETAIL = {
  id: 'cyc-001',
  name: '2026 Annual Review',
  templateId: 'tmpl-001',
  templateName: 'Annual Performance Review',
  status: 'active',
  startsAt: '2026-04-01T00:00:00Z',
  endsAt: '2026-05-31T23:59:59Z',
  participantCount: 247,
  responseCount: 89,
  completionRate: 0.36,
  createdAt: '2026-03-15T10:00:00Z',
};

/**
 * Default responses list returned when `responses.json` is unavailable.
 * Includes one in-progress response (50% complete) and one submitted
 * response (100% complete) so the Pattern E
 * `response-save-resume.crud.spec.ts` and `response-submit.crud.spec.ts`
 * specs can exercise both lifecycle endpoints with realistic data.
 */
const DEFAULT_RESPONSES = {
  data: [
    {
      id: 'rsp-001',
      cycleId: 'cyc-001',
      responderId: 'jdoe',
      status: 'in-progress',
      completionRate: 0.5,
      updatedAt: '2026-04-20T10:00:00Z',
    },
    {
      id: 'rsp-002',
      cycleId: 'cyc-001',
      responderId: 'asmith',
      status: 'submitted',
      completionRate: 1.0,
      submittedAt: '2026-04-25T15:30:00Z',
    },
  ],
};

/**
 * Default scoring grid returned for GET /api/assessments/scoring/:cycleId.
 *
 * Two rows: one un-scored (overallScore: null) and one fully-scored.
 * The `cycleId` field is overridden with the requested cycle id at
 * response time. Section IDs (sec-001..sec-003) match the
 * DEFAULT_TEMPLATE_DETAIL section list so the UI's section-by-section
 * scoring view renders consistent labels.
 */
const DEFAULT_SCORING_GRID = {
  cycleId: 'cyc-001',
  rows: [
    {
      responseId: 'rsp-001',
      responderId: 'jdoe',
      responderName: 'Jane Doe',
      overallScore: null,
      sectionScores: {},
    },
    {
      responseId: 'rsp-002',
      responderId: 'asmith',
      responderName: 'Alex Smith',
      overallScore: 4.2,
      sectionScores: { 'sec-001': 4.5, 'sec-002': 4.0, 'sec-003': 4.1 },
    },
  ],
};

/**
 * Default calibration view returned for GET /api/assessments/calibration/:cycleId.
 *
 * The `distribution` totals mirror DEFAULT_CYCLE_DETAIL.participantCount
 * (32 + 168 + 47 = 247) so the calibration histogram and the cycle
 * participant count are mathematically consistent. Tests asserting on
 * total counts can rely on this invariant without per-test fixture
 * juggling.
 */
const DEFAULT_CALIBRATION = {
  cycleId: 'cyc-001',
  distribution: { exceedsExpectations: 32, meetsExpectations: 168, needsImprovement: 47 },
  managerCalibrations: [
    {
      managerId: 'jdoe',
      managerName: 'Jane Doe',
      adjustments: 3,
      finalDistribution: { exceedsExpectations: 5, meetsExpectations: 22, needsImprovement: 1 },
    },
  ],
};

// ---------------------------------------------------------------------------
// Pagination + Search + Sort + Filter helpers
//
// All helpers are pure functions: they accept input arrays and URL search
// parameters and return new arrays/objects without mutating their inputs.
// This guarantees parallel-safety across worker processes per the AAP
// §0.10.1 directive ("All tests can run independently and in parallel").
//
// The pattern is duplicated per-handler for clarity (per the
// e2e/mocks/handlers/ folder requirements doc). Keeping the helpers
// inline rather than centralizing them in a shared utility avoids a
// cross-handler import which would break the layering contract.
// ---------------------------------------------------------------------------

/**
 * Resolved pagination parameters. Both fields are clamped to safe ranges:
 *   - `page` is at least 1.
 *   - `size` is between 1 and PAGINATION_MAX_SIZE inclusive.
 */
interface Pagination {
  page: number;
  size: number;
}

/**
 * Maximum page size accepted from `?size=N` query parameter. Larger
 * values are clamped to this cap to prevent accidental denial-of-service
 * on the test runner when a buggy spec requests millions of rows.
 */
const PAGINATION_MAX_SIZE = 100;

/**
 * Default page size when `?size=N` is absent. Mirrors the typical
 * Whoville-Client default of 20 rows per page in list views (matches
 * Angular Material's `mat-paginator` default for consistency).
 */
const PAGINATION_DEFAULT_SIZE = 20;

/**
 * Reserved query-parameter names that are NOT treated as field filters.
 * These control pagination, search, and sort and are consumed by their
 * dedicated helpers; including them in the filter step would attempt to
 * filter `data[].q === '<value>'` which is semantically wrong.
 */
const RESERVED_QUERY_PARAMS: ReadonlySet<string> = new Set(['q', 'page', 'size', 'sort', 'order']);

/**
 * Parse `?page=N&size=M` into a typed Pagination object with sensible
 * defaults and bounds.
 *
 * @param url  Request URL with searchParams to inspect.
 * @returns Pagination object with `page >= 1` and
 *   `1 <= size <= PAGINATION_MAX_SIZE`.
 */
function parsePagination(url: URL): Pagination {
  const rawPage = url.searchParams.get('page');
  const rawSize = url.searchParams.get('size');

  // parseInt with radix 10; NaN falls through to the default below via the
  // Number.isFinite check.
  const parsedPage = rawPage !== null ? parseInt(rawPage, 10) : 1;
  const parsedSize = rawSize !== null ? parseInt(rawSize, 10) : PAGINATION_DEFAULT_SIZE;

  const page = Math.max(1, Number.isFinite(parsedPage) ? parsedPage : 1);
  const sizeRaw = Number.isFinite(parsedSize) ? parsedSize : PAGINATION_DEFAULT_SIZE;
  const size = Math.max(1, Math.min(PAGINATION_MAX_SIZE, sizeRaw));

  return { page, size };
}

/**
 * Slice an array into a paginated response envelope.
 *
 * Returns a fresh object on every call so the handler can safely return
 * it from `route.fulfill({ body: JSON.stringify(...) })` without sharing
 * state with other tests.
 *
 * @typeParam T  Element type of the input array.
 */
function paginate<T>(
  items: T[],
  pagination: Pagination,
): {
  data: T[];
  pagination: { page: number; size: number; total: number; totalPages: number };
} {
  const total = items.length;
  // totalPages is at least 1 even for an empty list so consumers can
  // safely render "Page 1 of 1" in empty-state scenarios.
  const totalPages = Math.max(1, Math.ceil(total / pagination.size));
  const start = (pagination.page - 1) * pagination.size;
  const end = start + pagination.size;
  return {
    data: items.slice(start, end),
    pagination: {
      page: pagination.page,
      size: pagination.size,
      total,
      totalPages,
    },
  };
}

/**
 * Apply `?q=<keyword>` substring search across all top-level
 * string/number/boolean fields of each item. Case-insensitive.
 *
 * Returns the input array unchanged when no `q` parameter is present.
 * Returns a new array (does not mutate the input) when filtering.
 *
 * @typeParam T  Item shape; constrained to record types so we can
 *   iterate over their values via Object.values().
 */
function applySearch<T extends Record<string, unknown>>(items: T[], url: URL): T[] {
  const q = url.searchParams.get('q')?.trim();
  if (!q) return items;
  const needle = q.toLowerCase();
  return items.filter((item) =>
    Object.values(item).some((v) => {
      if (typeof v === 'string') {
        return v.toLowerCase().includes(needle);
      }
      if (typeof v === 'number' || typeof v === 'boolean') {
        return String(v).toLowerCase().includes(needle);
      }
      return false;
    }),
  );
}

/**
 * Apply per-field filters from the query string. Any non-reserved query
 * parameter is treated as a strict case-insensitive equality filter
 * against the same-named field of each item.
 *
 * Examples:
 *   ?status=active   -> keep items with item.status === 'active'
 *   ?templateId=tmpl-001 -> keep items with item.templateId === 'tmpl-001'
 *
 * Multiple filters AND together. Items missing the field are excluded
 * (we treat undefined fields as non-matching).
 *
 * Returns the input array unchanged when no filters are present.
 *
 * @typeParam T  Item shape; constrained to record types for index access.
 */
function applyFilters<T extends Record<string, unknown>>(items: T[], url: URL): T[] {
  const filters: Array<[string, string]> = [];
  for (const [k, v] of url.searchParams.entries()) {
    if (!RESERVED_QUERY_PARAMS.has(k)) {
      filters.push([k, v]);
    }
  }
  if (filters.length === 0) return items;
  return items.filter((item) =>
    filters.every(([field, value]) => {
      const v = item[field];
      if (v === undefined || v === null) return false;
      return String(v).toLowerCase() === value.toLowerCase();
    }),
  );
}

/**
 * Apply `?sort=<field>&order=<asc|desc>` ordering to the array. Returns
 * a new array; does not mutate the input. Numeric fields are sorted
 * numerically; everything else is sorted via String.localeCompare.
 *
 * Returns the input array unchanged when no `sort` parameter is present.
 *
 * @typeParam T  Item shape; constrained to record types for index access.
 */
function applySort<T extends Record<string, unknown>>(items: T[], url: URL): T[] {
  const sortField = url.searchParams.get('sort');
  if (!sortField) return items;

  const orderRaw = url.searchParams.get('order')?.toLowerCase();
  const direction = orderRaw === 'desc' ? -1 : 1;

  // Copy first to avoid mutating the input array; Array.prototype.sort
  // sorts in place which would corrupt cached fixture data.
  const result = [...items];
  result.sort((a, b) => {
    const av = a[sortField];
    const bv = b[sortField];
    if (av === bv) return 0;
    if (av === undefined || av === null) return 1; // undefined sorts last
    if (bv === undefined || bv === null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') {
      return (av - bv) * direction;
    }
    return String(av).localeCompare(String(bv)) * direction;
  });
  return result;
}

// ---------------------------------------------------------------------------
// Response helpers
//
// Thin wrappers around `route.fulfill()` that codify the canonical
// response shapes expected by Whoville-Client clients. Centralizing here
// keeps content-type, CORS headers, and serialization consistent across
// every sub-handler.
// ---------------------------------------------------------------------------

/**
 * Default response headers applied by `respondWithJson()`. Permissive CORS
 * headers are required because Playwright tests run against Angular dev
 * servers that may serve from a different origin (port mismatch, dual-host
 * proxies, etc.). The mock should never be the cause of a CORS failure.
 *
 * `Cache-Control: no-store` prevents browser caching that would mask
 * intra-test state changes - critical when a Tier 2 test creates an
 * entity and immediately reads it back from a list endpoint.
 */
const DEFAULT_JSON_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-expose-headers': '*',
};

/**
 * Respond to a Playwright route with a JSON body. Auto-stringifies the
 * `body` argument (unless already a string) and sets sensible default
 * headers; caller-supplied headers via `extraHeaders` override defaults
 * at the same key.
 *
 * @param route  Playwright Route (provided by `page.route()` callback).
 * @param status HTTP status code to return.
 * @param body   Object/array/primitive to JSON.stringify into the body.
 *   If a string is passed, it is sent verbatim (assumed to already be
 *   JSON-serialized) so callers can pre-stringify when they need the
 *   exact bytes (e.g., to test malformed-JSON tolerance).
 * @param extraHeaders Optional caller-supplied headers; override defaults.
 */
async function respondWithJson(
  route: Route,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<void> {
  const serialized = typeof body === 'string' ? body : JSON.stringify(body);
  await route.fulfill({
    status,
    headers: {
      ...DEFAULT_JSON_HEADERS,
      ...extraHeaders,
    },
    body: serialized,
  });
}

/**
 * Respond with HTTP 204 No Content. Used for successful DELETE operations
 * (template / cycle / response deletion) and other endpoints where no
 * response body is appropriate.
 *
 * The `access-control-allow-origin: *` header is included so the browser
 * doesn't reject the response on cross-origin DELETE requests.
 */
async function respondWithNoContent(route: Route): Promise<void> {
  await route.fulfill({
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-expose-headers': '*',
    },
    body: '',
  });
}

/**
 * Respond with HTTP 204 to a CORS preflight (OPTIONS) request, including
 * permissive CORS headers so the browser proceeds with the actual
 * request. We accept all standard methods and any header the client
 * cares to send; the mock is not a security boundary.
 */
async function respondCorsPreflightOk(route: Route): Promise<void> {
  await route.fulfill({
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'access-control-allow-headers': '*',
      'access-control-max-age': '86400',
    },
    body: '',
  });
}

/**
 * Generate a unique entity id with the `e2e-test-` prefix mandated by
 * AAP §0.4.4 (live-mode cleanup helper sweeps any orphan entity whose
 * id begins with this prefix). The body of the id encodes a millisecond
 * timestamp (base 36) and 6 random base-36 characters so collisions
 * across parallel workers are effectively impossible within a single
 * test run.
 *
 * Resource-specific prefixes (`tmpl`, `cyc`, `rsp`, `export`) make log
 * inspection trivially decodable: at a glance, `e2e-test-rsp-...`
 * indicates a response was created.
 *
 * @param prefix  Entity-type prefix (e.g., 'tmpl', 'cyc', 'rsp', 'export').
 */
function generateId(prefix: string): string {
  return `e2e-test-${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Return the current time as an ISO-8601 string. Centralized so tests
 * can mock the system clock by replacing `Date` globally if needed and
 * so future audit/logging changes flow through a single chokepoint.
 */
function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Sub-handler: Templates
//
// /api/assessments/templates              GET (list)  POST (create)
// /api/assessments/templates/:id          GET (read)  PUT/PATCH (update)
//                                         DELETE (remove)
// /api/assessments/templates/:id/clone    POST (clone-from-existing)
//
// Templates are the reusable assessment definition; cycles (below)
// instantiate a template for a specific time window. Per AAP §0.5.1.10's
// `template-clone.crud.spec.ts` spec, cloning is an explicit sub-action
// (not a regular POST) because the source template ID is part of the
// URL, making the API clearer and the test assertion targeted.
// ---------------------------------------------------------------------------

/**
 * Handle requests to the templates collection endpoint:
 *   GET  /api/assessments/templates  -> paginated list (search/filter/sort applied)
 *   POST /api/assessments/templates  -> create (echoes body with generated id)
 *
 * Other methods receive 405 with a list of allowed verbs. POST responses
 * include `status: 'draft'` and `version: 'v1'` defaults because newly-
 * created templates are not yet published and start at version 1.
 */
async function handleTemplates(route: Route, request: Request, url: URL): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    const fixture =
      readFixtureJson<{ data: unknown[] }>('templates-list.json') ?? DEFAULT_TEMPLATES_LIST;
    const baseItems = Array.isArray(fixture.data)
      ? (fixture.data as Array<Record<string, unknown>>)
      : [];
    let items: Array<Record<string, unknown>> = baseItems;
    items = applySearch(items, url);
    items = applyFilters(items, url);
    items = applySort(items, url);
    return respondWithJson(route, 200, paginate(items, parsePagination(url)));
  }

  if (method === 'POST') {
    const body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
    return respondWithJson(route, 201, {
      ...body,
      id: generateId('tmpl'),
      status: body.status ?? 'draft',
      version: body.version ?? 'v1',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }

  return respondWithJson(route, 405, {
    error: 'method_not_allowed',
    allowed: ['GET', 'POST'],
  });
}

/**
 * Handle requests to a specific template by id:
 *   GET    /api/assessments/templates/:id  -> template detail
 *   PUT    /api/assessments/templates/:id  -> update (echoes body merged onto detail)
 *   PATCH  /api/assessments/templates/:id  -> partial update (treated identically to PUT)
 *   DELETE /api/assessments/templates/:id  -> 204
 *
 * The detail body is built by spreading DEFAULT_TEMPLATE_DETAIL (or the
 * fixture, when present) and overriding `id` with the requested id so
 * detail-view tests asserting `expect(template.id).toBe('<requested>')`
 * always pass.
 */
async function handleTemplateById(route: Route, request: Request, id: string): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    const fixture =
      readFixtureJson<Record<string, unknown>>('template-detail.json') ?? DEFAULT_TEMPLATE_DETAIL;
    return respondWithJson(route, 200, { ...fixture, id });
  }

  if (method === 'PUT' || method === 'PATCH') {
    const body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
    const fixture =
      readFixtureJson<Record<string, unknown>>('template-detail.json') ?? DEFAULT_TEMPLATE_DETAIL;
    return respondWithJson(route, 200, {
      ...fixture,
      ...body,
      id,
      updatedAt: nowIso(),
    });
  }

  if (method === 'DELETE') {
    return respondWithNoContent(route);
  }

  return respondWithJson(route, 405, {
    error: 'method_not_allowed',
    allowed: ['GET', 'PUT', 'PATCH', 'DELETE'],
  });
}

/**
 * Handle the template clone sub-action:
 *   POST /api/assessments/templates/:id/clone
 *
 * Body shape (all optional):
 *   { name?: string }
 *
 * Response shape (HTTP 201):
 *   {
 *     ...template-detail-fields,
 *     id: '<generated>',
 *     name: <body.name> or '<source.name> (Clone)',
 *     sourceTemplateId: ':id',
 *     version: 'v1',
 *     status: 'draft',
 *     createdAt: '<now>',
 *     updatedAt: '<now>',
 *   }
 *
 * The clone is always created as a fresh draft (status: 'draft', version:
 * 'v1') regardless of the source's published-state, modeling the typical
 * "clone-then-edit-then-publish" workflow. The `sourceTemplateId` field
 * surfaces in the UI's "Cloned from..." breadcrumb per AAP §0.5.1.10's
 * `template-clone.crud.spec.ts` assertions.
 *
 * Non-POST methods receive 405 with `allowed: ['POST']` because clone is
 * a write-only sub-action.
 */
async function handleTemplateClone(route: Route, request: Request, id: string): Promise<void> {
  if (request.method().toUpperCase() !== 'POST') {
    return respondWithJson(route, 405, {
      error: 'method_not_allowed',
      allowed: ['POST'],
    });
  }
  const body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
  const fixture =
    readFixtureJson<Record<string, unknown>>('template-detail.json') ?? DEFAULT_TEMPLATE_DETAIL;
  const sourceName = typeof fixture.name === 'string' ? fixture.name : 'Template';
  const cloneName =
    typeof body.name === 'string' && body.name.length > 0 ? body.name : `${sourceName} (Clone)`;
  return respondWithJson(route, 201, {
    ...fixture,
    id: generateId('tmpl'),
    name: cloneName,
    sourceTemplateId: id,
    version: 'v1',
    status: 'draft',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
}

// ---------------------------------------------------------------------------
// Sub-handler: Cycles
//
// /api/assessments/cycles            GET (list)  POST (create)
// /api/assessments/cycles/:id        GET (read)  PUT/PATCH (update)
//                                    DELETE (remove)
// /api/assessments/cycles/:id/launch POST (workflow: open cycle to participants)
// /api/assessments/cycles/:id/close  POST (workflow: finalize cycle)
//
// Cycles are time-boxed assessment campaigns instantiated from a template.
// Workflow transitions (launch / close) are POST sub-actions, not PATCH,
// because they are stateful business operations matching the real
// Whoville-Client API contract per AAP §0.5.1.10's `cycle-launch.crud.spec.ts`
// and `cycle-close.crud.spec.ts` specs.
// ---------------------------------------------------------------------------

/**
 * Default `notificationsSent` count returned by the cycle launch
 * sub-action. Matches DEFAULT_CYCLE_DETAIL.participantCount so the UI's
 * "Notifications sent to N participants" toast aligns with the cycle's
 * displayed participant count without requiring per-test fixture juggling.
 */
const DEFAULT_LAUNCH_NOTIFICATIONS_SENT = 247;

/**
 * Default final completion rate returned by the cycle close sub-action.
 * 0.94 (94%) models a typical real-world close-out completion rate;
 * tests asserting on the post-close "Final completion: 94%" UI element
 * can rely on this value without per-test fixture juggling.
 */
const DEFAULT_CLOSE_FINAL_COMPLETION_RATE = 0.94;

/**
 * Handle requests to the cycles collection endpoint:
 *   GET  /api/assessments/cycles  -> paginated list (search/filter/sort applied)
 *   POST /api/assessments/cycles  -> create (echoes body with generated id)
 *
 * POST responses include `status: 'draft'` because newly-created cycles
 * are not yet active until the launch sub-action is invoked.
 */
async function handleCycles(route: Route, request: Request, url: URL): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    const fixture = readFixtureJson<{ data: unknown[] }>('cycles-list.json') ?? DEFAULT_CYCLES_LIST;
    const baseItems = Array.isArray(fixture.data)
      ? (fixture.data as Array<Record<string, unknown>>)
      : [];
    let items: Array<Record<string, unknown>> = baseItems;
    items = applySearch(items, url);
    items = applyFilters(items, url);
    items = applySort(items, url);
    return respondWithJson(route, 200, paginate(items, parsePagination(url)));
  }

  if (method === 'POST') {
    const body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
    return respondWithJson(route, 201, {
      ...body,
      id: generateId('cyc'),
      status: body.status ?? 'draft',
      participantCount: 0,
      responseCount: 0,
      completionRate: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }

  return respondWithJson(route, 405, {
    error: 'method_not_allowed',
    allowed: ['GET', 'POST'],
  });
}

/**
 * Handle requests to a specific cycle by id:
 *   GET    /api/assessments/cycles/:id  -> cycle detail
 *   PUT    /api/assessments/cycles/:id  -> update
 *   PATCH  /api/assessments/cycles/:id  -> partial update
 *   DELETE /api/assessments/cycles/:id  -> 204
 */
async function handleCycleById(route: Route, request: Request, id: string): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    const fixture =
      readFixtureJson<Record<string, unknown>>('cycle-detail.json') ?? DEFAULT_CYCLE_DETAIL;
    return respondWithJson(route, 200, { ...fixture, id });
  }

  if (method === 'PUT' || method === 'PATCH') {
    const body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
    const fixture =
      readFixtureJson<Record<string, unknown>>('cycle-detail.json') ?? DEFAULT_CYCLE_DETAIL;
    return respondWithJson(route, 200, {
      ...fixture,
      ...body,
      id,
      updatedAt: nowIso(),
    });
  }

  if (method === 'DELETE') {
    return respondWithNoContent(route);
  }

  return respondWithJson(route, 405, {
    error: 'method_not_allowed',
    allowed: ['GET', 'PUT', 'PATCH', 'DELETE'],
  });
}

/**
 * Handle the cycle launch sub-action:
 *   POST /api/assessments/cycles/:id/launch
 *
 * Response shape (HTTP 200):
 *   {
 *     id: ':id',
 *     status: 'active',
 *     launchedAt: '<iso-timestamp>',
 *     notificationsSent: <number>,
 *   }
 *
 * Per AAP §0.5.1.10's `cycle-launch.crud.spec.ts`, launch transitions a
 * cycle from `draft` to `active` and sends notifications to all
 * participants. Tests assert the post-launch UI shows "Active" status
 * and "Notifications sent to N participants".
 *
 * Non-POST methods receive 405 with `allowed: ['POST']`.
 */
async function handleCycleLaunch(route: Route, request: Request, id: string): Promise<void> {
  if (request.method().toUpperCase() !== 'POST') {
    return respondWithJson(route, 405, {
      error: 'method_not_allowed',
      allowed: ['POST'],
    });
  }
  return respondWithJson(route, 200, {
    id,
    status: 'active',
    launchedAt: nowIso(),
    notificationsSent: DEFAULT_LAUNCH_NOTIFICATIONS_SENT,
  });
}

/**
 * Handle the cycle close sub-action:
 *   POST /api/assessments/cycles/:id/close
 *
 * Body shape (all optional):
 *   { note?: string }
 *
 * Response shape (HTTP 200):
 *   {
 *     id: ':id',
 *     status: 'closed',
 *     closedAt: '<iso-timestamp>',
 *     finalCompletionRate: <number>,  // 0..1
 *     note: <body.note> or '',
 *   }
 *
 * Per AAP §0.5.1.10's `cycle-close.crud.spec.ts`, close transitions a
 * cycle from `active` to `closed`, records the manager-supplied close
 * note (for audit), and freezes the final completion rate. Tests assert
 * the post-close UI shows "Closed" status and "Final completion: 94%".
 *
 * Non-POST methods receive 405 with `allowed: ['POST']`.
 */
async function handleCycleClose(route: Route, request: Request, id: string): Promise<void> {
  if (request.method().toUpperCase() !== 'POST') {
    return respondWithJson(route, 405, {
      error: 'method_not_allowed',
      allowed: ['POST'],
    });
  }
  const body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
  return respondWithJson(route, 200, {
    id,
    status: 'closed',
    closedAt: nowIso(),
    finalCompletionRate: DEFAULT_CLOSE_FINAL_COMPLETION_RATE,
    note: typeof body.note === 'string' ? body.note : '',
  });
}

// ---------------------------------------------------------------------------
// Sub-handler: Responses
//
// /api/assessments/responses              GET (list)  POST (create)
// /api/assessments/responses/:id          GET (read)  PUT/PATCH (update)
//                                         DELETE (remove)
// /api/assessments/responses/:id/submit   POST (submit-for-review)
// /api/assessments/responses/:id/save     PUT (save-and-resume)
//
// Responses are the per-participant assessment submissions for a cycle.
// Submit and save are distinct endpoints because:
//   - PUT /save  marks status `in-progress` (save-and-resume mid-wizard)
//   - POST /submit  marks status `submitted` (final commit at wizard end)
//
// Per AAP §0.5.1.10's `response-save-resume.crud.spec.ts` and
// `response-submit.crud.spec.ts` (Pattern E), tests exercise save and
// submit as separate user gestures. Distinct endpoints make the test
// boundaries clear and let each scenario assert the correct status
// transition.
// ---------------------------------------------------------------------------

/**
 * Handle requests to the responses collection endpoint:
 *   GET  /api/assessments/responses  -> paginated list (filter/sort applied)
 *   POST /api/assessments/responses  -> create (echoes body with generated id)
 *
 * Note: search (`?q=...`) is intentionally NOT applied to responses
 * because response bodies are large and heterogeneous; the typical
 * Whoville-Client UX filters responses by cycle/responder/status only.
 *
 * POST responses include `status: 'in-progress'` and `completionRate: 0`
 * because newly-created responses are empty placeholders awaiting the
 * first save.
 */
async function handleResponses(route: Route, request: Request, url: URL): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    const fixture = readFixtureJson<{ data: unknown[] }>('responses.json') ?? DEFAULT_RESPONSES;
    const baseItems = Array.isArray(fixture.data)
      ? (fixture.data as Array<Record<string, unknown>>)
      : [];
    let items: Array<Record<string, unknown>> = baseItems;
    items = applyFilters(items, url);
    items = applySort(items, url);
    return respondWithJson(route, 200, paginate(items, parsePagination(url)));
  }

  if (method === 'POST') {
    const body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
    return respondWithJson(route, 201, {
      ...body,
      id: generateId('rsp'),
      status: 'in-progress',
      completionRate: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }

  return respondWithJson(route, 405, {
    error: 'method_not_allowed',
    allowed: ['GET', 'POST'],
  });
}

/**
 * Handle requests to a specific response by id:
 *   GET    /api/assessments/responses/:id  -> response detail
 *   PUT    /api/assessments/responses/:id  -> update
 *   PATCH  /api/assessments/responses/:id  -> partial update
 *   DELETE /api/assessments/responses/:id  -> 204
 *
 * The detail body is constructed inline (rather than spreading from a
 * DEFAULT constant) because the response detail shape is small enough
 * to be readable in-place and including a bespoke detail constant
 * offered no semantic benefit. The `sections: []` default lets tests
 * that only care about top-level fields (id, status, completionRate)
 * succeed without per-test overrides.
 */
async function handleResponseById(route: Route, request: Request, id: string): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    return respondWithJson(route, 200, {
      id,
      cycleId: 'cyc-001',
      responderId: 'jdoe',
      status: 'in-progress',
      completionRate: 0.5,
      sections: [],
      updatedAt: nowIso(),
    });
  }

  if (method === 'PUT' || method === 'PATCH') {
    const body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
    return respondWithJson(route, 200, {
      id,
      ...body,
      updatedAt: nowIso(),
    });
  }

  if (method === 'DELETE') {
    return respondWithNoContent(route);
  }

  return respondWithJson(route, 405, {
    error: 'method_not_allowed',
    allowed: ['GET', 'PUT', 'PATCH', 'DELETE'],
  });
}

/**
 * Handle the response submit sub-action:
 *   POST /api/assessments/responses/:id/submit
 *
 * Response shape (HTTP 200):
 *   {
 *     id: ':id',
 *     status: 'submitted',
 *     completionRate: 1.0,
 *     submittedAt: '<iso-timestamp>',
 *   }
 *
 * Per AAP §0.5.1.10's `response-submit.crud.spec.ts`, submit transitions
 * a response from `in-progress` to `submitted` (final commit at wizard
 * end). Tests assert the post-submit UI shows "Submitted" badge and the
 * "Submitted at <date>" timestamp.
 *
 * `completionRate: 1.0` is hard-coded because submission requires 100%
 * completion server-side; the mock matches this contract so tests do
 * not need to compose per-section completion data.
 *
 * Non-POST methods receive 405 with `allowed: ['POST']`.
 */
async function handleResponseSubmit(route: Route, request: Request, id: string): Promise<void> {
  if (request.method().toUpperCase() !== 'POST') {
    return respondWithJson(route, 405, {
      error: 'method_not_allowed',
      allowed: ['POST'],
    });
  }
  return respondWithJson(route, 200, {
    id,
    status: 'submitted',
    completionRate: 1.0,
    submittedAt: nowIso(),
  });
}

/**
 * Handle the response save-and-resume sub-action:
 *   PUT /api/assessments/responses/:id/save
 *
 * Body shape (passthrough):
 *   { sections?: ..., currentStep?: ..., ...other partial response data }
 *
 * Response shape (HTTP 200):
 *   {
 *     id: ':id',
 *     ...echoed-body-fields,
 *     status: 'in-progress',
 *     updatedAt: '<iso-timestamp>',
 *   }
 *
 * Per AAP §0.5.1.10's `response-save-resume.crud.spec.ts` (Pattern E),
 * save preserves status as `in-progress` regardless of the body's
 * declared status (clients should not be able to bypass /submit by
 * sending status: 'submitted' to /save). Tests exercise the
 * fill-form-then-leave-then-return workflow and assert that returning
 * to the wizard restores the saved state.
 *
 * The `id` field is set FIRST (then the body spread) so a malicious or
 * buggy client cannot override it via the request body. The status
 * field is set LAST to enforce the in-progress invariant.
 *
 * Non-PUT methods receive 405 with `allowed: ['PUT']` because save is a
 * write-only sub-action.
 */
async function handleResponseSave(route: Route, request: Request, id: string): Promise<void> {
  if (request.method().toUpperCase() !== 'PUT') {
    return respondWithJson(route, 405, {
      error: 'method_not_allowed',
      allowed: ['PUT'],
    });
  }
  const body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
  return respondWithJson(route, 200, {
    id,
    ...body,
    // status MUST come after the body spread to enforce the in-progress
    // invariant - preventing clients from bypassing /submit by sending
    // status: 'submitted' to /save.
    status: 'in-progress',
    updatedAt: nowIso(),
  });
}

// ---------------------------------------------------------------------------
// Sub-handler: Scoring
//
// /api/assessments/scoring/:cycleId         GET (read scoring grid)
//                                           PUT/PATCH (update single score)
// /api/assessments/scoring/:cycleId/bulk    PATCH (bulk score update)
//
// Scoring is the manager-facing grid view that lets reviewers assign
// numeric ratings to each section of each response within a cycle. The
// bulk endpoint accepts an array of `updates` and returns per-batch
// counts (succeeded, failed, total) so the UI can render the
// "Updated N scores; M failed" toast.
//
// Per AAP §0.5.1.10's `scoring-grid.crud.spec.ts` and
// `scoring-bulk.crud.spec.ts`, the grid view and the bulk operation are
// distinct user gestures. Tier 3's `bulk-partial-failure.int.spec.ts`
// (per AAP §0.5.1.11) overrides the bulk handler via
// `mockApi.intercept()` to return non-zero `failed` counts.
// ---------------------------------------------------------------------------

/**
 * Shape of the PATCH /api/assessments/scoring/:cycleId/bulk request body.
 * `updates` is the array of per-response score updates. The mock does
 * not validate the inner shape because Tier 3 specs intentionally pass
 * malformed bodies to test client-side validation; the mock's job is
 * only to count items and return per-item success counts.
 */
interface ScoringBulkBody {
  updates?: Array<Record<string, unknown>>;
}

/**
 * Handle requests to a specific cycle's scoring grid:
 *   GET    /api/assessments/scoring/:cycleId  -> full scoring grid
 *   PUT    /api/assessments/scoring/:cycleId  -> update grid (bulk-replace)
 *   PATCH  /api/assessments/scoring/:cycleId  -> partial grid update
 *
 * The GET response includes a `rows[]` array suitable for 2D-grid
 * rendering (responder rows × section columns). The PATCH response
 * echoes the body with an `updatedAt` so the UI can show optimistic-UI
 * confirmation.
 *
 * POST and DELETE are intentionally not allowed because the scoring
 * grid is a derived view: it is regenerated server-side from
 * cycle+response data, not created or deleted as a free-standing entity.
 */
async function handleScoring(route: Route, request: Request, cycleId: string): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    return respondWithJson(route, 200, { ...DEFAULT_SCORING_GRID, cycleId });
  }

  if (method === 'PUT' || method === 'PATCH') {
    const body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
    return respondWithJson(route, 200, {
      cycleId,
      ...body,
      updatedAt: nowIso(),
    });
  }

  return respondWithJson(route, 405, {
    error: 'method_not_allowed',
    allowed: ['GET', 'PUT', 'PATCH'],
  });
}

/**
 * Handle the scoring bulk-update sub-action:
 *   PATCH /api/assessments/scoring/:cycleId/bulk
 *
 * Body shape:
 *   { updates: [{ responseId, sectionId, score }, ...] }
 *
 * Response shape (HTTP 200):
 *   {
 *     cycleId: ':cycleId',
 *     updateCount: <number>,   // total received
 *     succeeded: <number>,     // happy-path: equals updateCount
 *     failed: 0,               // happy-path: zero failures
 *     appliedAt: '<iso-timestamp>',
 *   }
 *
 * Per AAP §0.5.1.10's `scoring-bulk.crud.spec.ts`, the bulk operation
 * UI shows succeeded/failed counts. The mock returns these so the UI
 * can render correctly. Tier 3's `bulk-partial-failure.int.spec.ts`
 * (per AAP §0.5.1.11) overrides this handler via `mockApi.intercept()`
 * to return non-zero `failed` counts and exercise the partial-failure
 * UX.
 *
 * Non-PATCH methods receive 405 with `allowed: ['PATCH']`.
 */
async function handleScoringBulk(route: Route, request: Request, cycleId: string): Promise<void> {
  if (request.method().toUpperCase() !== 'PATCH') {
    return respondWithJson(route, 405, {
      error: 'method_not_allowed',
      allowed: ['PATCH'],
    });
  }
  const body = (request.postDataJSON() as ScoringBulkBody | null) ?? {};
  const updateCount = Array.isArray(body.updates) ? body.updates.length : 0;
  return respondWithJson(route, 200, {
    cycleId,
    updateCount,
    succeeded: updateCount,
    failed: 0,
    appliedAt: nowIso(),
  });
}

// ---------------------------------------------------------------------------
// Sub-handler: Calibration
//
// /api/assessments/calibration/:cycleId          GET (read calibration view)
// /api/assessments/calibration/:cycleId/adjust   PATCH (manual adjustment)
//
// Calibration is the post-scoring review step where managers can
// manually shift the rating distribution to match organizational
// guidelines (e.g., enforce a 25%/50%/25% distribution). The adjust
// endpoint records a single calibration adjustment and is exercised
// by AAP §0.5.1.10's `calibration-adjust.crud.spec.ts`.
// ---------------------------------------------------------------------------

/**
 * Handle requests to a specific cycle's calibration view:
 *   GET /api/assessments/calibration/:cycleId  -> calibration data
 *
 * The GET response includes a `distribution` object (counts per rating
 * bucket) and a `managerCalibrations[]` array (per-manager adjustment
 * history). PUT/PATCH/POST/DELETE are intentionally not allowed at this
 * URL; manual adjustments go through the `/adjust` sub-action below.
 *
 * Per AAP §0.5.1.10's `calibration-view.crud.spec.ts`, the calibration
 * view is a read-only presentation of the calibration state.
 */
async function handleCalibration(route: Route, request: Request, cycleId: string): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    return respondWithJson(route, 200, { ...DEFAULT_CALIBRATION, cycleId });
  }

  return respondWithJson(route, 405, {
    error: 'method_not_allowed',
    allowed: ['GET'],
  });
}

/**
 * Handle the calibration adjust sub-action:
 *   PATCH /api/assessments/calibration/:cycleId/adjust
 *
 * Body shape (passthrough):
 *   { managerId?, responseId?, fromBucket?, toBucket?, reason?, ... }
 *
 * Response shape (HTTP 200):
 *   {
 *     cycleId: ':cycleId',
 *     adjustment: <body-passthrough>,
 *     adjustedAt: '<iso-timestamp>',
 *   }
 *
 * The adjustment body is passed through verbatim so tests can assert on
 * any field shape (which lets the spec evolve without the mock having
 * to know the exact business semantics). The `adjustedAt` timestamp is
 * the one piece the mock contributes for audit-style assertions.
 *
 * Per AAP §0.5.1.10's `calibration-adjust.crud.spec.ts`, the adjust
 * operation is exercised as a manager workflow; tests assert the
 * post-adjustment UI shows the adjustment in the calibration history
 * list with the correct timestamp.
 *
 * Non-PATCH methods receive 405 with `allowed: ['PATCH']`.
 */
async function handleCalibrationAdjust(
  route: Route,
  request: Request,
  cycleId: string,
): Promise<void> {
  if (request.method().toUpperCase() !== 'PATCH') {
    return respondWithJson(route, 405, {
      error: 'method_not_allowed',
      allowed: ['PATCH'],
    });
  }
  const body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
  return respondWithJson(route, 200, {
    cycleId,
    adjustment: body,
    adjustedAt: nowIso(),
  });
}

// ---------------------------------------------------------------------------
// Sub-handler: Reporting Export
//
// /api/assessments/reporting/export  POST (queue an async report export)
//
// Real reporting exports are async: the report is generated in the
// background and the client polls for completion. The 202 Accepted
// status code with `jobId` matches the asynchronous-job pattern that
// the Whoville-Client UI expects per AAP §0.5.1.10's
// `reporting-export.crud.spec.ts`.
//
// Tests assert that the UI shows a "Report queued" status after export.
// Tier 3 specs can poll for completion via a separate
// `/api/assessments/reporting/jobs/:jobId` endpoint (mocked separately
// via `mockApi.intercept()` per AAP §0.4.4).
// ---------------------------------------------------------------------------

/**
 * Default estimated completion time (in seconds) returned by the
 * reporting export sub-action. 30 seconds models a typical real-world
 * export latency for medium-sized reports; tests asserting on the
 * "Estimated 30 seconds" UI element can rely on this value without
 * per-test fixture juggling.
 */
const DEFAULT_EXPORT_ETA_SECONDS = 30;

/**
 * Handle the reporting export sub-action:
 *   POST /api/assessments/reporting/export
 *
 * Body shape (all optional):
 *   { format?: 'csv' | 'xlsx' | 'pdf', cycleId?, sections?, ... }
 *
 * Response shape (HTTP 202 Accepted):
 *   {
 *     jobId: '<generated>',
 *     status: 'queued',
 *     format: <body.format> or 'csv',
 *     requestedAt: '<iso-timestamp>',
 *     estimatedCompletionSeconds: <number>,
 *   }
 *
 * Per AAP §0.5.1.10's `reporting-export.crud.spec.ts`, the export
 * operation is a write-only async-job initiator. The 202 status code
 * (not 200/201) signals to the UI that the export is queued and
 * polling is required for completion. The `jobId` follows the
 * `e2e-test-export-...` naming convention so live-mode cleanup can
 * sweep abandoned export jobs.
 *
 * Non-POST methods receive 405 with `allowed: ['POST']`.
 */
async function handleReportingExport(route: Route, request: Request): Promise<void> {
  if (request.method().toUpperCase() !== 'POST') {
    return respondWithJson(route, 405, {
      error: 'method_not_allowed',
      allowed: ['POST'],
    });
  }
  const body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
  return respondWithJson(route, 202, {
    jobId: generateId('export'),
    status: 'queued',
    format: typeof body.format === 'string' ? body.format : 'csv',
    requestedAt: nowIso(),
    estimatedCompletionSeconds: DEFAULT_EXPORT_ETA_SECONDS,
  });
}

// ---------------------------------------------------------------------------
// Unknown-route handler
// ---------------------------------------------------------------------------

/**
 * Catch-all for requests under `/api/assessments/...` that the dispatcher
 * does not recognise. Returns HTTP 501 Not Implemented and emits a
 * structured warning so that test authors immediately see which URL
 * lacks coverage instead of silently falling through to network mode.
 *
 * The 501 response is structured (JSON envelope with `error`, `method`,
 * `url`) so spec-side `expect(response.status()).toBe(501)` and
 * `expect(body.error).toBe('not_implemented')` assertions work
 * end-to-end during exploratory testing and during the migration
 * window when new endpoints may be added before the mock catches up.
 */
async function handleUnknown(route: Route, request: Request): Promise<void> {
  console.warn(
    `${LOG_PREFIX} No sub-handler for ${request.method()} ${request.url()}. ` +
      `Returning 501. Add a sub-handler in e2e/mocks/handlers/assessments.handler.ts.`,
  );
  return respondWithJson(route, 501, {
    error: 'not_implemented',
    method: request.method(),
    url: request.url(),
  });
}

// ---------------------------------------------------------------------------
// Public function: assessmentsHandler
// ---------------------------------------------------------------------------

/**
 * URL pathname regex used to extract the resource, optional id, and
 * optional sub-action from
 * `/api/assessments/<resource>[/<id>][/<sub-action>]`. Capturing groups:
 *   1: resource (required)         e.g., 'templates', 'cycles', 'reporting'
 *   2: id (optional)               e.g., 'tmpl-001', 'cyc-001', 'export'
 *   3: sub-action (optional)       e.g., 'clone', 'launch', 'submit', 'bulk'
 *
 * The third group is captured because most resources in this scope have
 * sub-actions (templates/clone, cycles/launch, cycles/close,
 * responses/submit, responses/save, scoring/bulk, calibration/adjust).
 * Resources that receive an unexpected sub-action fall through to
 * `handleUnknown()` (returning 501) so test authors see exactly which
 * URL lacks coverage.
 *
 * Note that `reporting/export` uses the second capture group (id slot)
 * for the sub-action name because there is no per-resource id for
 * reports - the export action is keyed entirely by the request body.
 * The dispatcher handles this case explicitly via `id === 'export'`.
 */
const PATH_REGEX = /\/api\/assessments\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?/;

/**
 * Assessments API mock handler. Public entry point invoked by Playwright
 * for any request matching `**\/api/assessments/**`.
 *
 * Dispatch rules:
 *   1. OPTIONS preflight requests receive 204 with permissive CORS headers.
 *   2. URLs are normalized (trailing slashes stripped) before regex match.
 *   3. The matched resource, optional id, and optional sub-action are
 *      routed to the appropriate sub-handler.
 *   4. Unmatched paths and unknown resources receive HTTP 501 with a
 *      structured warning so test authors see exactly which URL is
 *      uncovered.
 *
 * Resource routing matrix (for `/api/assessments/<resource>/...`):
 *
 *   resource     | no id, no sub      | with id, no sub      | with id+sub
 *   ------------ | ------------------ | -------------------- | --------------------------
 *   templates    | handleTemplates    | handleTemplateById   | handleTemplateClone (sub === 'clone')
 *   cycles       | handleCycles       | handleCycleById      | handleCycleLaunch (sub === 'launch')
 *                |                    |                      | handleCycleClose  (sub === 'close')
 *   responses    | handleResponses    | handleResponseById   | handleResponseSubmit (sub === 'submit')
 *                |                    |                      | handleResponseSave   (sub === 'save')
 *   scoring      | handleUnknown      | handleScoring        | handleScoringBulk    (sub === 'bulk')
 *   calibration  | handleUnknown      | handleCalibration    | handleCalibrationAdjust (sub === 'adjust')
 *   reporting    | handleUnknown      | handleReportingExport (id === 'export', no sub)
 *
 * The function is async (returns Promise<void>) to match Playwright's
 * `page.route(url, handler)` callback contract; sub-handlers are also
 * async so all network responses are emitted via `await route.fulfill()`.
 *
 * @param route   Playwright route object; used for `route.fulfill()`.
 * @param request Playwright request metadata; used to read URL/method/body.
 */
export async function assessmentsHandler(route: Route, request: Request): Promise<void> {
  const url = new URL(request.url());
  // Strip trailing slashes so `/api/assessments/templates/` and
  // `/api/assessments/templates` behave identically.
  const pathname = url.pathname.replace(/\/+$/, '');
  const method = request.method().toUpperCase();

  // CORS preflight: most browsers send OPTIONS before the actual request.
  // Return early so resource sub-handlers don't have to consider OPTIONS.
  if (method === 'OPTIONS') {
    return respondCorsPreflightOk(route);
  }

  const match = pathname.match(PATH_REGEX);
  if (!match) {
    return handleUnknown(route, request);
  }

  const resource = match[1];
  const id = match[2];
  const subAction = match[3];

  switch (resource) {
    case 'templates':
      if (id !== undefined && subAction === 'clone') {
        return handleTemplateClone(route, request, id);
      }
      if (id !== undefined && subAction === undefined) {
        return handleTemplateById(route, request, id);
      }
      if (id === undefined) {
        return handleTemplates(route, request, url);
      }
      return handleUnknown(route, request);

    case 'cycles':
      if (id !== undefined && subAction === 'launch') {
        return handleCycleLaunch(route, request, id);
      }
      if (id !== undefined && subAction === 'close') {
        return handleCycleClose(route, request, id);
      }
      if (id !== undefined && subAction === undefined) {
        return handleCycleById(route, request, id);
      }
      if (id === undefined) {
        return handleCycles(route, request, url);
      }
      return handleUnknown(route, request);

    case 'responses':
      if (id !== undefined && subAction === 'submit') {
        return handleResponseSubmit(route, request, id);
      }
      if (id !== undefined && subAction === 'save') {
        return handleResponseSave(route, request, id);
      }
      if (id !== undefined && subAction === undefined) {
        return handleResponseById(route, request, id);
      }
      if (id === undefined) {
        return handleResponses(route, request, url);
      }
      return handleUnknown(route, request);

    case 'scoring':
      // /api/assessments/scoring with no cycleId is unsupported.
      if (id !== undefined && subAction === 'bulk') {
        return handleScoringBulk(route, request, id);
      }
      if (id !== undefined && subAction === undefined) {
        return handleScoring(route, request, id);
      }
      return handleUnknown(route, request);

    case 'calibration':
      // /api/assessments/calibration with no cycleId is unsupported.
      if (id !== undefined && subAction === 'adjust') {
        return handleCalibrationAdjust(route, request, id);
      }
      if (id !== undefined && subAction === undefined) {
        return handleCalibration(route, request, id);
      }
      return handleUnknown(route, request);

    case 'reporting':
      // The export sub-action is keyed entirely by the request body
      // (no per-resource id) so it occupies the second capture group's
      // id slot rather than the third sub-action slot.
      if (id === 'export' && subAction === undefined) {
        return handleReportingExport(route, request);
      }
      return handleUnknown(route, request);

    default:
      return handleUnknown(route, request);
  }
}
