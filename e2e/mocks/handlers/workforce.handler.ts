/**
 * Workforce API mock handler.
 *
 * Registered by `e2e/mocks/api-router.ts` against URL pattern `**\/api/workforce/**`.
 *
 * Handled resources (per AAP §0.3.1, §0.5.1.13, §0.5.1.10):
 *   /api/workforce/teams                          - CRUD + list (paginated, sortable, filterable)
 *   /api/workforce/teams/:id                      - Read / Update / Delete
 *   /api/workforce/assignments                    - CRUD + list (paginated)
 *   /api/workforce/assignments/:id                - Read / Update / Delete
 *   /api/workforce/schedule                       - Read schedule grid
 *   /api/workforce/schedule/:id                   - Update schedule entry
 *   /api/workforce/headcount                      - Read headcount summary
 *   /api/workforce/transfers                      - CRUD + approval workflow
 *   /api/workforce/transfers/:id                  - Read / Update / Delete
 *   /api/workforce/transfers/:id/approve          - Approve transfer (POST)
 *   /api/workforce/transfers/:id/reject           - Reject transfer (POST)
 *   /api/workforce/leave-requests                 - CRUD + approval workflow
 *   /api/workforce/leave-requests/:id             - Read / Update / Delete
 *   /api/workforce/leave-requests/:id/approve     - Approve leave (POST)
 *   /api/workforce/leave-requests/:id/reject      - Reject leave (POST)
 *   /api/workforce/leave-requests/:id/cancel      - Cancel leave (POST)
 *
 * Pagination contract (per AAP §0.3.1):
 *   GET /api/workforce/<resource>?page=N&size=M&q=<keyword>&sort=<field>&order=<asc|desc>
 *   Response: { data: [...], pagination: { page, size, total, totalPages } }
 *
 * Search/Filter/Sort contract:
 *   - `q` query parameter performs case-insensitive substring search across
 *     all top-level string/number/boolean fields of each item.
 *   - `filter[fieldName]=value` and `filter.fieldName=value` are treated as
 *     strict case-insensitive equality filters on the same-named field.
 *     Both forms are accepted because Angular HttpParams, Axios + qs, and
 *     other client libraries serialize filter params differently.
 *   - Any other (non-reserved) query parameter is also treated as a strict
 *     case-insensitive equality filter on the same-named field.
 *   - `sort` selects the field to sort by; `order` is `asc` (default) or `desc`.
 *   - Reserved query parameters that are not used as filters: `q`, `page`,
 *     `size`, `sort`, `order`, `limit`.
 *
 * Workflow sub-actions (REST convention - state transitions via POST):
 *   - Transfer / leave-request approval, rejection, and cancellation are
 *     POST sub-actions matching the canonical REST pattern used by the
 *     real Whoville-Client API (per AAP §0.5.1.10's
 *     transfer-approval.crud.spec.ts and leave-request-approval.crud.spec.ts).
 *   - Sub-actions return the updated entity merged with the new status
 *     and a server-issued timestamp (approvedAt / rejectedAt / cancelledAt).
 *
 * Test-data prefix recognition (per AAP §0.4.4):
 *   Entities created via POST receive an id `e2e-test-<resource>-<...>` so
 *   live-mode cleanup can sweep orphans by prefix match. Mock-mode IDs
 *   use the same prefix to keep assertion shapes identical between
 *   E2E_API_MODE=mock and E2E_API_MODE=live.
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
 *   migration rewrites internal services freely, but `/api/workforce/**`
 *   URL paths and the JSON shapes returned here remain the contract.
 *
 * @see AAP §0.5.1.12 - mandate (Factories, Mocks, and Test Utilities)
 * @see AAP §0.5.1.13 - canonical fixtures (e2e/fixtures/api-responses/workforce/...)
 * @see AAP §0.3.1   - test target identification (Workforce API scope)
 * @see AAP §0.5.1.10 - Tier 2 CRUD specs that consume this handler
 * @see AAP §0.5.1.4  - Workforce POMs that drive the network requests
 * @see e2e/mocks/api-router.ts - registers this handler at `**\/api/workforce/**`
 * @see e2e/fixtures/api-responses/workforce/* - canonical JSON fixtures
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
 * Absolute path to the directory containing canonical workforce-module
 * JSON fixtures. Resolved relative to `__dirname` so the handler is
 * cross-platform (Windows / macOS / Linux) and survives reorganization of
 * the e2e/ directory.
 *
 * Layout:
 *   e2e/mocks/handlers/workforce.handler.ts  <-- file
 *   e2e/mocks/handlers/                      <-- __dirname
 *   e2e/mocks/                               <-- path.join(__dirname, '..')
 *   e2e/                                     <-- path.join(__dirname, '..', '..')
 *   e2e/fixtures/api-responses/workforce/    <-- FIXTURE_ROOT
 */
const FIXTURE_ROOT = path.resolve(__dirname, '..', '..', 'fixtures', 'api-responses', 'workforce');

/**
 * In-memory cache of JSON fixture file contents.
 *
 * - Key: relative path under FIXTURE_ROOT (e.g. 'teams-list.json').
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
 * authorization.handler.ts and assessments.handler.ts files.
 */
const LOG_PREFIX = '[mock-api/workforce]';

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
 * @param relPath  Path relative to FIXTURE_ROOT (e.g., 'teams-list.json').
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
// `e2e/fixtures/api-responses/workforce/` are missing. They contain
// realistic data that mirrors typical Whoville-Client workforce entities
// so tests asserting on visible content (team names, employee IDs, dates)
// remain valid even before the canonical fixtures are committed.
//
// All defaults are plain object literals (not `as const`) because the
// handler frequently spreads them into response objects with overrides;
// `as const` would make the inferred types too narrow for the spread
// operations that follow.
// ---------------------------------------------------------------------------

/**
 * Default teams list used when `teams-list.json` is unavailable. Mirrors
 * the canonical Whoville-Client team catalog with three representative
 * teams covering active and inactive states.
 */
const DEFAULT_TEAMS_LIST = {
  data: [
    {
      id: 'team-001',
      name: 'Alpha Squad',
      size: 8,
      manager: 'jdoe',
      status: 'active',
      createdAt: '2026-01-15T10:00:00Z',
    },
    {
      id: 'team-002',
      name: 'Beta Team',
      size: 12,
      manager: 'asmith',
      status: 'active',
      createdAt: '2026-02-01T10:00:00Z',
    },
    {
      id: 'team-003',
      name: 'Gamma Group',
      size: 5,
      manager: 'bjones',
      status: 'inactive',
      createdAt: '2026-02-15T10:00:00Z',
    },
  ],
};

/**
 * Default team detail returned for any GET /api/workforce/teams/:id request.
 * The `id` field is overridden with the requested id at response time so
 * that detail-view tests asserting `id === '<requested>'` always pass.
 */
const DEFAULT_TEAM_DETAIL = {
  id: 'team-001',
  name: 'Alpha Squad',
  description: 'Core platform engineering team',
  size: 8,
  manager: { id: 'jdoe', displayName: 'Jane Doe' },
  status: 'active',
  members: [
    { id: 'jdoe', displayName: 'Jane Doe', role: 'Manager' },
    { id: 'asmith', displayName: 'Alex Smith', role: 'Engineer' },
  ],
  createdAt: '2026-01-15T10:00:00Z',
  updatedAt: '2026-04-15T10:00:00Z',
};

/**
 * Default assignments list used when `assignments-list.json` is unavailable.
 * Each assignment is a (employee, team, role, date-range) tuple modeling
 * the canonical Whoville-Client workforce assignment entity.
 */
const DEFAULT_ASSIGNMENTS_LIST = {
  data: [
    {
      id: 'asn-001',
      employeeId: 'jdoe',
      teamId: 'team-001',
      startDate: '2026-01-15',
      endDate: null,
      status: 'active',
    },
    {
      id: 'asn-002',
      employeeId: 'asmith',
      teamId: 'team-001',
      startDate: '2026-02-01',
      endDate: null,
      status: 'active',
    },
  ],
};

/**
 * Default assignment detail returned for GET /api/workforce/assignments/:id.
 * Embeds nested employee and team objects so detail views can render
 * "Jane Doe on Alpha Squad" without an additional HTTP round-trip.
 */
const DEFAULT_ASSIGNMENT_DETAIL = {
  id: 'asn-001',
  employeeId: 'jdoe',
  employee: { id: 'jdoe', displayName: 'Jane Doe' },
  teamId: 'team-001',
  team: { id: 'team-001', name: 'Alpha Squad' },
  role: 'Manager',
  startDate: '2026-01-15',
  endDate: null,
  status: 'active',
  createdAt: '2026-01-15T10:00:00Z',
};

/**
 * Default schedule data used when `schedule.json` is unavailable. Models
 * a typical week's schedule with shift times and locations so the
 * Workforce schedule grid can render in the absence of a real fixture.
 */
const DEFAULT_SCHEDULE = {
  weekStarting: '2026-05-04',
  entries: [
    { day: 'Mon', employeeId: 'jdoe', shift: '09:00-17:00', location: 'Office' },
    { day: 'Tue', employeeId: 'jdoe', shift: '09:00-17:00', location: 'Remote' },
    { day: 'Wed', employeeId: 'jdoe', shift: '09:00-17:00', location: 'Office' },
    { day: 'Thu', employeeId: 'asmith', shift: '08:00-16:00', location: 'Office' },
    { day: 'Fri', employeeId: 'asmith', shift: '08:00-16:00', location: 'Remote' },
  ],
};

/**
 * Default headcount summary used when `headcount.json` is unavailable.
 * Includes both per-team breakdown and per-status counts so headcount
 * dashboards can render charts and tables in fallback mode.
 */
const DEFAULT_HEADCOUNT = {
  asOfDate: '2026-05-01',
  total: 247,
  byTeam: [
    { teamId: 'team-001', name: 'Alpha Squad', headcount: 8 },
    { teamId: 'team-002', name: 'Beta Team', headcount: 12 },
    { teamId: 'team-003', name: 'Gamma Group', headcount: 5 },
  ],
  byStatus: { active: 230, onLeave: 12, contractor: 5 },
};

/**
 * Default transfers list used when no canonical fixture exists. Models
 * the transfer-request entity with a from/to-team pair and a pending
 * approval status. Transfer-approval specs depend on POST sub-action
 * routing for /approve and /reject.
 */
const DEFAULT_TRANSFERS_LIST = {
  data: [
    {
      id: 'tr-001',
      employeeId: 'jdoe',
      fromTeam: 'team-001',
      toTeam: 'team-002',
      requestedAt: '2026-04-01T10:00:00Z',
      status: 'pending',
    },
    {
      id: 'tr-002',
      employeeId: 'asmith',
      fromTeam: 'team-002',
      toTeam: 'team-001',
      requestedAt: '2026-04-15T10:00:00Z',
      status: 'pending',
    },
  ],
};

/**
 * Default transfer detail returned for GET /api/workforce/transfers/:id.
 * Embeds nested employee and team objects for richer detail-view
 * rendering without an additional HTTP round-trip.
 */
const DEFAULT_TRANSFER_DETAIL = {
  id: 'tr-001',
  employeeId: 'jdoe',
  employee: { id: 'jdoe', displayName: 'Jane Doe' },
  fromTeam: { id: 'team-001', name: 'Alpha Squad' },
  toTeam: { id: 'team-002', name: 'Beta Team' },
  reason: 'Career development opportunity',
  requestedAt: '2026-04-01T10:00:00Z',
  effectiveDate: '2026-05-01',
  status: 'pending',
};

/**
 * Default leave-requests list used when no canonical fixture exists.
 * Models a leave request with start/end dates and a leave type
 * (vacation, sick, personal, etc.) per the canonical Whoville-Client
 * leave-management entity.
 */
const DEFAULT_LEAVE_REQUESTS_LIST = {
  data: [
    {
      id: 'lr-001',
      employeeId: 'jdoe',
      startDate: '2026-06-01',
      endDate: '2026-06-07',
      type: 'vacation',
      status: 'pending',
    },
    {
      id: 'lr-002',
      employeeId: 'asmith',
      startDate: '2026-07-15',
      endDate: '2026-07-19',
      type: 'personal',
      status: 'pending',
    },
  ],
};

/**
 * Default leave-request detail returned for GET /api/workforce/leave-requests/:id.
 * Includes nested employee object and human-readable type/status fields.
 */
const DEFAULT_LEAVE_REQUEST_DETAIL = {
  id: 'lr-001',
  employeeId: 'jdoe',
  employee: { id: 'jdoe', displayName: 'Jane Doe' },
  startDate: '2026-06-01',
  endDate: '2026-06-07',
  type: 'vacation',
  reason: 'Annual family vacation',
  requestedAt: '2026-04-15T10:00:00Z',
  status: 'pending',
};

// ---------------------------------------------------------------------------
// Pagination + Search + Sort + Filter helpers
//
// All helpers are pure functions: they accept input arrays and URL search
// parameters and return new arrays/objects without mutating their inputs.
// This guarantees parallel-safety across worker processes per the AAP
// §0.10.1 directive ("All tests can run independently and in parallel").
// ---------------------------------------------------------------------------

/**
 * Resolved pagination parameters. Both fields are clamped to safe ranges:
 *   - `page` is at least 1 (1-indexed, matching typical REST convention).
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
 *
 * 500 is generous (vs. the more typical 100 used in production APIs)
 * because Tier 3 large-list-performance specs (per AAP §0.5.1.11)
 * exercise lists with up to 1k-10k rows and may legitimately request
 * larger pages to reduce request count.
 */
const PAGINATION_MAX_SIZE = 500;

/**
 * Default page size when `?size=N` is absent. Mirrors the typical
 * Angular Material `<mat-paginator>` default of 20 rows per page used
 * throughout the Whoville-Client list views.
 */
const PAGINATION_DEFAULT_SIZE = 20;

/**
 * Reserved query-parameter names that are NOT treated as field filters.
 * These control pagination, search, and sort and are consumed by their
 * dedicated helpers; including them in the filter step would attempt to
 * filter `data[].q === '<value>'` which is semantically wrong.
 *
 * `limit` is reserved as an alias for `size` per common REST conventions
 * (Spring Data, Express+sequelize, etc.).
 */
const RESERVED_QUERY_PARAMS: ReadonlySet<string> = new Set([
  'q',
  'page',
  'size',
  'limit',
  'sort',
  'order',
]);

/**
 * Parse `?page=N&size=M` (or `?page=N&limit=M`) into a typed Pagination
 * object with sensible defaults and bounds.
 *
 * Accepts `limit` as an alias for `size` because different Angular HTTP
 * client conventions use one or the other; falling through to `limit`
 * lets the same handler serve both API styles.
 *
 * @param url  Request URL with searchParams to inspect.
 * @returns Pagination object with `page >= 1` and
 *   `1 <= size <= PAGINATION_MAX_SIZE`.
 */
function parsePagination(url: URL): Pagination {
  const rawPage = url.searchParams.get('page');
  // `size` takes precedence; fall back to `limit` when `size` is absent.
  const rawSize = url.searchParams.get('size') ?? url.searchParams.get('limit');

  // parseInt with radix 10; NaN becomes the default. We use Number.isFinite
  // to detect NaN explicitly because `parseInt('abc', 10)` returns NaN
  // (which is truthy-coerced to false in `||`-chains) and we want NaN
  // to fall through to the default.
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
 * Apply per-field filters from the query string. Supports two filter
 * syntaxes side-by-side (per AAP-listed Whoville-Client client-library
 * heterogeneity):
 *
 *   - `filter[fieldName]=value`  (Angular HttpParams + JSON-API style)
 *   - `filter.fieldName=value`   (RxJS-based services + dot-notation)
 *   - `fieldName=value`          (bare-key shorthand for any non-reserved key)
 *
 * Every form is resolved to a strict case-insensitive equality match
 * against the same-named field of each item. Multiple filters AND
 * together. Items missing the field are excluded.
 *
 * Returns the input array unchanged when no filters are present.
 *
 * @typeParam T  Item shape; constrained to record types for index access.
 */
function applyFilters<T extends Record<string, unknown>>(items: T[], url: URL): T[] {
  const filters: Array<[string, string]> = [];
  url.searchParams.forEach((value, key) => {
    // Bracket form: filter[field]=value
    const bracketMatch = key.match(/^filter\[(.+)\]$/);
    if (bracketMatch) {
      filters.push([bracketMatch[1], value]);
      return;
    }
    // Dot form: filter.field=value
    const dotMatch = key.match(/^filter\.(.+)$/);
    if (dotMatch) {
      filters.push([dotMatch[1], value]);
      return;
    }
    // Bare-key shorthand for any non-reserved param.
    if (!RESERVED_QUERY_PARAMS.has(key)) {
      filters.push([key, value]);
    }
  });
  if (filters.length === 0) return items;
  return items.filter((item) =>
    filters.every(([field, expected]) => {
      const v = item[field];
      if (v === undefined || v === null) return false;
      return String(v).toLowerCase() === expected.toLowerCase();
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
 * `Cache-Control: no-store` ensures every test sees a fresh response and
 * cannot be misled by an HTTP cache layer interposed by the runtime
 * (e.g., service-worker caching during dev-server reloads).
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
 * @param body   Object/array/primitive/string to JSON.stringify into the body.
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
 * (team/assignment/transfer/leave-request deletion) and other endpoints
 * where no response body is appropriate.
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
 * The resource-specific prefix (`team`, `asn`, `tr`, `lr`) helps log
 * inspection and debugging - a quick scan of test output reveals which
 * resource type each ID belongs to.
 *
 * @param prefix  Entity-type prefix (e.g., 'team', 'asn', 'tr', 'lr').
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
// Sub-handler: Teams
//
// /api/workforce/teams            GET (list)  POST (create)
// /api/workforce/teams/:id        GET (read)  PUT/PATCH (update)  DELETE (remove)
//
// Teams are the canonical organizational unit in the Workforce module.
// CRUD specs (per AAP §0.5.1.10): team-list, team-create, team-edit,
// team-delete, team-detail, team-search.
// ---------------------------------------------------------------------------

/**
 * Handle requests to the teams collection endpoint:
 *   GET  /api/workforce/teams  -> paginated list (search/filter/sort applied)
 *   POST /api/workforce/teams  -> create (echoes body with generated id)
 *
 * Other methods receive 405 with a simple error envelope.
 */
async function handleTeams(route: Route, request: Request, url: URL): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    const fixture = readFixtureJson<{ data: unknown[] }>('teams-list.json') ?? DEFAULT_TEAMS_LIST;
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
      id: generateId('team'),
      status: body.status ?? 'active',
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
 * Handle requests to a specific team by id:
 *   GET    /api/workforce/teams/:id  -> team detail
 *   PUT    /api/workforce/teams/:id  -> update (echoes body merged onto detail)
 *   PATCH  /api/workforce/teams/:id  -> partial update (treated identically to PUT)
 *   DELETE /api/workforce/teams/:id  -> 204
 *
 * Other methods receive 405 with a list of allowed verbs.
 */
async function handleTeamById(route: Route, request: Request, id: string): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    const fixture =
      readFixtureJson<Record<string, unknown>>('team-detail.json') ?? DEFAULT_TEAM_DETAIL;
    return respondWithJson(route, 200, { ...fixture, id });
  }

  if (method === 'PUT' || method === 'PATCH') {
    const body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
    const fixture =
      readFixtureJson<Record<string, unknown>>('team-detail.json') ?? DEFAULT_TEAM_DETAIL;
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

// ---------------------------------------------------------------------------
// Sub-handler: Assignments
//
// /api/workforce/assignments            GET (list)  POST (create)
// /api/workforce/assignments/:id        GET (read)  PUT/PATCH (update)  DELETE (remove)
//
// Assignments link an employee to a team for a date range. CRUD specs
// (per AAP §0.5.1.10): assignment-list, assignment-create, assignment-edit,
// assignment-delete, assignment-detail, assignment-search, assignment-bulk.
// ---------------------------------------------------------------------------

/**
 * Handle requests to the assignments collection endpoint:
 *   GET  /api/workforce/assignments  -> paginated list
 *   POST /api/workforce/assignments  -> create (echoes body with generated id)
 */
async function handleAssignments(route: Route, request: Request, url: URL): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    const fixture =
      readFixtureJson<{ data: unknown[] }>('assignments-list.json') ?? DEFAULT_ASSIGNMENTS_LIST;
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
      id: generateId('asn'),
      status: body.status ?? 'active',
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
 * Handle requests to a specific assignment by id:
 *   GET    /api/workforce/assignments/:id  -> assignment detail
 *   PUT    /api/workforce/assignments/:id  -> update
 *   PATCH  /api/workforce/assignments/:id  -> partial update
 *   DELETE /api/workforce/assignments/:id  -> 204
 */
async function handleAssignmentById(route: Route, request: Request, id: string): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    const fixture =
      readFixtureJson<Record<string, unknown>>('assignment-detail.json') ??
      DEFAULT_ASSIGNMENT_DETAIL;
    return respondWithJson(route, 200, { ...fixture, id });
  }

  if (method === 'PUT' || method === 'PATCH') {
    const body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
    const fixture =
      readFixtureJson<Record<string, unknown>>('assignment-detail.json') ??
      DEFAULT_ASSIGNMENT_DETAIL;
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

// ---------------------------------------------------------------------------
// Sub-handler: Schedule
//
// /api/workforce/schedule            GET (read schedule grid)
// /api/workforce/schedule/:id        PUT/PATCH (update entry)
//
// The schedule resource is unusual: GET returns the entire schedule grid
// for the current week (not a paginated list), and PUT/PATCH on the
// /:id sub-route updates a single schedule entry. CRUD specs (per AAP
// §0.5.1.10): schedule-view, schedule-edit.
// ---------------------------------------------------------------------------

/**
 * Handle requests to the schedule collection endpoint:
 *   GET   /api/workforce/schedule  -> full schedule grid for the week
 *   PUT   /api/workforce/schedule  -> bulk-update schedule (entire grid)
 *   PATCH /api/workforce/schedule  -> partial update (entire grid)
 *
 * Note: Per the canonical Whoville-Client API, the schedule endpoint
 * returns the full grid as a single object (not a paginated list) so
 * the schedule view can render all days in one round-trip.
 */
async function handleSchedule(route: Route, request: Request): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    const fixture = readFixtureJson<Record<string, unknown>>('schedule.json') ?? DEFAULT_SCHEDULE;
    return respondWithJson(route, 200, fixture);
  }

  if (method === 'PUT' || method === 'PATCH') {
    const body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
    const fixture = readFixtureJson<Record<string, unknown>>('schedule.json') ?? DEFAULT_SCHEDULE;
    return respondWithJson(route, 200, {
      ...fixture,
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
 * Handle requests to a specific schedule entry by id:
 *   GET    /api/workforce/schedule/:id  -> schedule entry detail
 *   PUT    /api/workforce/schedule/:id  -> update (echoes body)
 *   PATCH  /api/workforce/schedule/:id  -> partial update
 *   DELETE /api/workforce/schedule/:id  -> 204 (remove entry)
 */
async function handleScheduleById(route: Route, request: Request, id: string): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    // Return the first matching schedule entry, or a synthetic detail
    // when no fixture entries match. This keeps detail-view tests
    // operational without requiring per-id fixture files.
    const fixture =
      readFixtureJson<{ entries?: Array<Record<string, unknown>> }>('schedule.json') ??
      DEFAULT_SCHEDULE;
    const entries: Array<Record<string, unknown>> = Array.isArray(fixture.entries)
      ? fixture.entries
      : (DEFAULT_SCHEDULE.entries as Array<Record<string, unknown>>);
    const matched = entries.find((entry) => entry.id === id);
    if (matched) {
      return respondWithJson(route, 200, matched);
    }
    return respondWithJson(route, 200, {
      id,
      day: 'Mon',
      employeeId: 'jdoe',
      shift: '09:00-17:00',
      location: 'Office',
    });
  }

  if (method === 'PUT' || method === 'PATCH') {
    const body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
    return respondWithJson(route, 200, {
      id,
      day: 'Mon',
      employeeId: 'jdoe',
      shift: '09:00-17:00',
      location: 'Office',
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

// ---------------------------------------------------------------------------
// Sub-handler: Headcount
//
// /api/workforce/headcount            GET (read summary)
//
// Headcount is a read-only summary endpoint - all non-GET methods return
// 405. CRUD specs (per AAP §0.5.1.10): headcount-view, headcount-export.
// ---------------------------------------------------------------------------

/**
 * Handle requests to the headcount endpoint:
 *   GET /api/workforce/headcount  -> headcount summary (total, byTeam, byStatus)
 *
 * Only GET is supported because headcount is a derived metric, not a
 * directly-mutable resource. All non-GET methods return 405.
 */
async function handleHeadcount(route: Route, request: Request): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    const fixture = readFixtureJson<Record<string, unknown>>('headcount.json') ?? DEFAULT_HEADCOUNT;
    return respondWithJson(route, 200, fixture);
  }

  return respondWithJson(route, 405, {
    error: 'method_not_allowed',
    allowed: ['GET'],
  });
}

// ---------------------------------------------------------------------------
// Sub-handler: Transfers
//
// /api/workforce/transfers                       GET (list)  POST (create)
// /api/workforce/transfers/:id                   GET (read)  PUT/PATCH/DELETE
// /api/workforce/transfers/:id/approve           POST (approve workflow)
// /api/workforce/transfers/:id/reject            POST (reject workflow)
//
// Transfers move an employee from one team to another. The workflow is
// modeled as POST sub-actions per the canonical REST pattern (see
// AAP §0.5.1.10's transfer-approval.crud.spec.ts).
// ---------------------------------------------------------------------------

/**
 * Handle requests to the transfers collection endpoint:
 *   GET  /api/workforce/transfers  -> paginated list
 *   POST /api/workforce/transfers  -> create (echoes body with generated id)
 */
async function handleTransfers(route: Route, request: Request, url: URL): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    // No canonical fixture file is enumerated in AAP §0.5.1.13 for transfers,
    // so we serve the inline default. Tests requiring richer transfer data
    // can override via mockApi.intercept() per AAP §0.10.1.
    const baseItems = Array.isArray(DEFAULT_TRANSFERS_LIST.data)
      ? (DEFAULT_TRANSFERS_LIST.data as Array<Record<string, unknown>>)
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
      id: generateId('tr'),
      status: body.status ?? 'pending',
      requestedAt: nowIso(),
      createdAt: nowIso(),
    });
  }

  return respondWithJson(route, 405, {
    error: 'method_not_allowed',
    allowed: ['GET', 'POST'],
  });
}

/**
 * Handle requests to a specific transfer by id:
 *   GET    /api/workforce/transfers/:id  -> transfer detail
 *   PUT    /api/workforce/transfers/:id  -> update
 *   PATCH  /api/workforce/transfers/:id  -> partial update
 *   DELETE /api/workforce/transfers/:id  -> 204 (cancel a pending transfer)
 */
async function handleTransferById(route: Route, request: Request, id: string): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    return respondWithJson(route, 200, { ...DEFAULT_TRANSFER_DETAIL, id });
  }

  if (method === 'PUT' || method === 'PATCH') {
    const body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
    return respondWithJson(route, 200, {
      ...DEFAULT_TRANSFER_DETAIL,
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
 * Handle approve sub-action on a transfer:
 *   POST /api/workforce/transfers/:id/approve  -> 200 with status=approved
 *
 * Returns the updated transfer entity merged with `status: 'approved'`
 * and a server-issued `approvedAt` timestamp. Non-POST methods return
 * 405 because workflow operations are inherently action-oriented (POST).
 */
async function handleTransferApprove(route: Route, request: Request, id: string): Promise<void> {
  if (request.method().toUpperCase() !== 'POST') {
    return respondWithJson(route, 405, {
      error: 'method_not_allowed',
      allowed: ['POST'],
    });
  }
  return respondWithJson(route, 200, {
    ...DEFAULT_TRANSFER_DETAIL,
    id,
    status: 'approved',
    approvedAt: nowIso(),
  });
}

/**
 * Handle reject sub-action on a transfer:
 *   POST /api/workforce/transfers/:id/reject  -> 200 with status=rejected
 *
 * The request body may include a `reason` field that is echoed back in
 * the response so audit trails preserve the rejection rationale. If
 * absent, the response includes an empty `reason` string.
 */
async function handleTransferReject(route: Route, request: Request, id: string): Promise<void> {
  if (request.method().toUpperCase() !== 'POST') {
    return respondWithJson(route, 405, {
      error: 'method_not_allowed',
      allowed: ['POST'],
    });
  }
  const body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
  const reason = typeof body.reason === 'string' ? body.reason : '';
  return respondWithJson(route, 200, {
    ...DEFAULT_TRANSFER_DETAIL,
    id,
    status: 'rejected',
    rejectedAt: nowIso(),
    reason,
  });
}

// ---------------------------------------------------------------------------
// Sub-handler: Leave Requests
//
// /api/workforce/leave-requests                       GET (list)  POST (create)
// /api/workforce/leave-requests/:id                   GET (read)  PUT/PATCH/DELETE
// /api/workforce/leave-requests/:id/approve           POST (approve workflow)
// /api/workforce/leave-requests/:id/reject            POST (reject workflow)
// /api/workforce/leave-requests/:id/cancel            POST (cancel workflow)
//
// Leave requests have an additional `cancel` sub-action (vs. transfers)
// because employees can withdraw their own pending leave requests, and
// the cancel transition is auditable separately from "rejected by manager"
// (per AAP §0.5.1.10's leave-request-cancel.crud.spec.ts).
// ---------------------------------------------------------------------------

/**
 * Handle requests to the leave-requests collection endpoint:
 *   GET  /api/workforce/leave-requests  -> paginated list
 *   POST /api/workforce/leave-requests  -> create (echoes body with generated id)
 */
async function handleLeaveRequests(route: Route, request: Request, url: URL): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    // No canonical fixture file is enumerated for leave-requests in AAP
    // §0.5.1.13, so we serve the inline default. Tests requiring richer
    // data can override via mockApi.intercept() per AAP §0.10.1.
    const baseItems = Array.isArray(DEFAULT_LEAVE_REQUESTS_LIST.data)
      ? (DEFAULT_LEAVE_REQUESTS_LIST.data as Array<Record<string, unknown>>)
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
      id: generateId('lr'),
      status: body.status ?? 'pending',
      requestedAt: nowIso(),
      createdAt: nowIso(),
    });
  }

  return respondWithJson(route, 405, {
    error: 'method_not_allowed',
    allowed: ['GET', 'POST'],
  });
}

/**
 * Handle requests to a specific leave-request by id:
 *   GET    /api/workforce/leave-requests/:id  -> detail
 *   PUT    /api/workforce/leave-requests/:id  -> update
 *   PATCH  /api/workforce/leave-requests/:id  -> partial update
 *   DELETE /api/workforce/leave-requests/:id  -> 204 (administrator-side delete)
 */
async function handleLeaveById(route: Route, request: Request, id: string): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    return respondWithJson(route, 200, { ...DEFAULT_LEAVE_REQUEST_DETAIL, id });
  }

  if (method === 'PUT' || method === 'PATCH') {
    const body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
    return respondWithJson(route, 200, {
      ...DEFAULT_LEAVE_REQUEST_DETAIL,
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
 * Handle approve sub-action on a leave-request:
 *   POST /api/workforce/leave-requests/:id/approve  -> 200 with status=approved
 *
 * Returns the updated leave-request entity merged with `status: 'approved'`
 * and a server-issued `approvedAt` timestamp.
 */
async function handleLeaveApprove(route: Route, request: Request, id: string): Promise<void> {
  if (request.method().toUpperCase() !== 'POST') {
    return respondWithJson(route, 405, {
      error: 'method_not_allowed',
      allowed: ['POST'],
    });
  }
  return respondWithJson(route, 200, {
    ...DEFAULT_LEAVE_REQUEST_DETAIL,
    id,
    status: 'approved',
    approvedAt: nowIso(),
  });
}

/**
 * Handle reject sub-action on a leave-request:
 *   POST /api/workforce/leave-requests/:id/reject  -> 200 with status=rejected
 *
 * The request body may include a `reason` field that is echoed back in
 * the response so audit trails preserve the rejection rationale.
 */
async function handleLeaveReject(route: Route, request: Request, id: string): Promise<void> {
  if (request.method().toUpperCase() !== 'POST') {
    return respondWithJson(route, 405, {
      error: 'method_not_allowed',
      allowed: ['POST'],
    });
  }
  const body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
  const reason = typeof body.reason === 'string' ? body.reason : '';
  return respondWithJson(route, 200, {
    ...DEFAULT_LEAVE_REQUEST_DETAIL,
    id,
    status: 'rejected',
    rejectedAt: nowIso(),
    reason,
  });
}

/**
 * Handle cancel sub-action on a leave-request:
 *   POST /api/workforce/leave-requests/:id/cancel  -> 200 with status=cancelled
 *
 * Distinct from rejection: cancellation is initiated by the employee
 * (withdrawing their own request), while rejection is initiated by the
 * approver. The audit log distinguishes them via the `status` field
 * (`cancelled` vs `rejected`) and the `cancelledAt` vs `rejectedAt`
 * timestamps.
 */
async function handleLeaveCancel(route: Route, request: Request, id: string): Promise<void> {
  if (request.method().toUpperCase() !== 'POST') {
    return respondWithJson(route, 405, {
      error: 'method_not_allowed',
      allowed: ['POST'],
    });
  }
  return respondWithJson(route, 200, {
    ...DEFAULT_LEAVE_REQUEST_DETAIL,
    id,
    status: 'cancelled',
    cancelledAt: nowIso(),
  });
}

// ---------------------------------------------------------------------------
// Unknown-route handler
// ---------------------------------------------------------------------------

/**
 * Catch-all for requests under `/api/workforce/...` that the dispatcher
 * does not recognise. Returns HTTP 501 Not Implemented and emits a
 * structured warning so that test authors immediately see which URL
 * lacks coverage instead of silently falling through to network mode.
 *
 * The warning includes the file path so the next test author knows
 * exactly where to add the missing sub-handler.
 */
async function handleUnknown(route: Route, request: Request): Promise<void> {
  console.warn(
    `${LOG_PREFIX} No sub-handler for ${request.method()} ${request.url()}. ` +
      `Returning 501. Add a sub-handler in e2e/mocks/handlers/workforce.handler.ts.`,
  );
  return respondWithJson(route, 501, {
    error: 'not_implemented',
    method: request.method(),
    url: request.url(),
  });
}

// ---------------------------------------------------------------------------
// Public function: workforceHandler
// ---------------------------------------------------------------------------

/**
 * URL pathname regex used to extract the resource, optional id, and
 * optional sub-action from `/api/workforce/<resource>[/<id>][/<sub-action>]`.
 *
 * Capturing groups:
 *   1: resource (required)         e.g., 'teams', 'transfers'
 *   2: id (optional)               e.g., 'team-001', 'tr-001'
 *   3: sub-action (optional)       e.g., 'approve', 'reject', 'cancel'
 *
 * The regex tolerates a fourth segment (e.g. for future expansion) by
 * not anchoring to end-of-string with `$`. Trailing segments beyond the
 * third are ignored at the dispatcher level.
 */
const PATH_REGEX = /\/api\/workforce\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?/;

/**
 * Workforce API mock handler. Public entry point invoked by Playwright
 * for any request matching `**\/api/workforce/**`.
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
 * Resource routing matrix (for `/api/workforce/<resource>/...`):
 *
 *   resource        | no id, no sub        | with id, no sub      | with id+sub
 *   --------------- | -------------------- | -------------------- | ---------------------
 *   teams           | handleTeams          | handleTeamById       | handleUnknown
 *   assignments     | handleAssignments    | handleAssignmentById | handleUnknown
 *   schedule        | handleSchedule       | handleScheduleById   | handleUnknown
 *   headcount       | handleHeadcount      | handleUnknown        | handleUnknown
 *   transfers       | handleTransfers      | handleTransferById   | handleTransferApprove (sub === 'approve')
 *                   |                      |                      | handleTransferReject  (sub === 'reject')
 *   leave-requests  | handleLeaveRequests  | handleLeaveById      | handleLeaveApprove   (sub === 'approve')
 *                   |                      |                      | handleLeaveReject    (sub === 'reject')
 *                   |                      |                      | handleLeaveCancel    (sub === 'cancel')
 *
 * The function is async (returns Promise<void>) to match Playwright's
 * `page.route(url, handler)` callback contract; sub-handlers are also
 * async so all network responses are emitted via `await route.fulfill()`.
 *
 * @param route   Playwright route object; used for `route.fulfill()`.
 * @param request Playwright request metadata; used to read URL/method/body.
 */
export async function workforceHandler(route: Route, request: Request): Promise<void> {
  const url = new URL(request.url());
  // Strip trailing slashes so `/api/workforce/teams/` and
  // `/api/workforce/teams` behave identically.
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
    case 'teams':
      if (id !== undefined && subAction === undefined) {
        return handleTeamById(route, request, id);
      }
      if (id === undefined) {
        return handleTeams(route, request, url);
      }
      return handleUnknown(route, request);

    case 'assignments':
      if (id !== undefined && subAction === undefined) {
        return handleAssignmentById(route, request, id);
      }
      if (id === undefined) {
        return handleAssignments(route, request, url);
      }
      return handleUnknown(route, request);

    case 'schedule':
      if (id !== undefined && subAction === undefined) {
        return handleScheduleById(route, request, id);
      }
      if (id === undefined) {
        return handleSchedule(route, request);
      }
      return handleUnknown(route, request);

    case 'headcount':
      // Headcount has no per-id endpoint; bare GET returns the summary.
      if (id === undefined) {
        return handleHeadcount(route, request);
      }
      return handleUnknown(route, request);

    case 'transfers':
      if (id !== undefined && subAction === 'approve') {
        return handleTransferApprove(route, request, id);
      }
      if (id !== undefined && subAction === 'reject') {
        return handleTransferReject(route, request, id);
      }
      if (id !== undefined && subAction === undefined) {
        return handleTransferById(route, request, id);
      }
      if (id === undefined) {
        return handleTransfers(route, request, url);
      }
      return handleUnknown(route, request);

    case 'leave-requests':
      if (id !== undefined && subAction === 'approve') {
        return handleLeaveApprove(route, request, id);
      }
      if (id !== undefined && subAction === 'reject') {
        return handleLeaveReject(route, request, id);
      }
      if (id !== undefined && subAction === 'cancel') {
        return handleLeaveCancel(route, request, id);
      }
      if (id !== undefined && subAction === undefined) {
        return handleLeaveById(route, request, id);
      }
      if (id === undefined) {
        return handleLeaveRequests(route, request, url);
      }
      return handleUnknown(route, request);

    default:
      return handleUnknown(route, request);
  }
}
