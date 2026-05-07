/**
 * Competencies API mock handler.
 *
 * Registered by `e2e/mocks/api-router.ts` against URL pattern `**\/api/competencies/**`.
 *
 * Handled resources (per AAP §0.3.1, §0.5.1.13, §0.5.1.10):
 *   /api/competencies/catalog                          - CRUD + list (paginated)
 *   /api/competencies/catalog/:id                      - Read / Update / Delete
 *   /api/competencies/skills                           - CRUD + list (paginated)
 *   /api/competencies/skills/:id                       - Read / Update / Delete
 *   /api/competencies/proficiency-matrix               - Read / Update full matrix
 *   /api/competencies/proficiency-matrix/:competencyId - Per-competency proficiency entry
 *   /api/competencies/learning-paths                   - CRUD + list (paginated)
 *   /api/competencies/learning-paths/:id               - Read / Update / Delete
 *   /api/competencies/certifications                   - CRUD + list (paginated)
 *   /api/competencies/certifications/:id               - Read / Update / Delete
 *   /api/competencies/certifications/:id/award         - Award certification (POST)
 *
 * Pagination contract:
 *   GET /api/competencies/<resource>?page=N&size=M&q=<keyword>&sort=<field>&order=<asc|desc>
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
 *   migration rewrites internal services freely, but `/api/competencies/**`
 *   URL paths and the JSON shapes returned here remain the contract.
 *
 * @see AAP §0.5.1.12 - mandate (Factories, Mocks, and Test Utilities)
 * @see AAP §0.5.1.13 - canonical fixtures (e2e/fixtures/api-responses/competencies/...)
 * @see AAP §0.3.1   - test target identification (Competencies API scope)
 * @see AAP §0.5.1.10 - Tier 2 CRUD specs that consume this handler
 * @see AAP §0.5.1.6  - Competencies POMs that drive the network requests
 * @see e2e/mocks/api-router.ts - registers this handler at `**\/api/competencies/**`
 * @see e2e/fixtures/api-responses/competencies/* - canonical JSON fixtures
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
 * Absolute path to the directory containing canonical competencies-module
 * JSON fixtures. Resolved relative to `__dirname` so the handler is
 * cross-platform (Windows / macOS / Linux) and survives reorganization of
 * the e2e/ directory.
 *
 * Layout:
 *   e2e/mocks/handlers/competencies.handler.ts  <-- file
 *   e2e/mocks/handlers/                         <-- __dirname
 *   e2e/mocks/                                  <-- path.join(__dirname, '..')
 *   e2e/                                        <-- path.join(__dirname, '..', '..')
 *   e2e/fixtures/api-responses/competencies/    <-- FIXTURE_ROOT
 */
const FIXTURE_ROOT = path.resolve(
  __dirname,
  '..',
  '..',
  'fixtures',
  'api-responses',
  'competencies',
);

/**
 * In-memory cache of JSON fixture file contents.
 *
 * - Key: relative path under FIXTURE_ROOT (e.g. 'catalog-list.json').
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
 * authorization.handler.ts and the latency-injector / error-injector
 * helpers.
 */
const LOG_PREFIX = '[mock-api/competencies]';

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
 * @param relPath  Path relative to FIXTURE_ROOT (e.g., 'catalog-list.json').
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
// `e2e/fixtures/api-responses/competencies/` are missing. They contain
// realistic, recognizable Engineering-domain data (TypeScript, System
// Design, Code Review) so test assertions remain readable - e.g.
// `expect(page.getByText('TypeScript')).toBeVisible()` is more meaningful
// than `expect(page.getByText('Skill 001')).toBeVisible()` per AAP §0.10.1
// ("Migration-proof through... readable test data").
//
// All defaults are declared as plain object literals (not `as const`) so
// downstream code can spread them into Records without having to peel off
// the readonly-tuple types that `as const` introduces.
// ---------------------------------------------------------------------------

/**
 * Default catalog list returned when `catalog-list.json` is unavailable.
 * Models four canonical Whoville-Client competency categories spanning
 * technical, leadership, soft-skill, and domain-knowledge axes so the
 * Pattern D (Search/Filter) tests have meaningful diversity to query.
 */
const DEFAULT_CATALOG_LIST = {
  data: [
    { id: 'cat-001', name: 'Engineering', code: 'ENG', skillCount: 24, status: 'active' },
    { id: 'cat-002', name: 'Leadership', code: 'LEAD', skillCount: 12, status: 'active' },
    { id: 'cat-003', name: 'Communication', code: 'COMM', skillCount: 8, status: 'active' },
    { id: 'cat-004', name: 'Domain Knowledge', code: 'DOM', skillCount: 32, status: 'active' },
  ],
};

/**
 * Default catalog detail returned for any GET /api/competencies/catalog/:id
 * request. The `id` field is overridden with the requested id at response
 * time so detail-view tests asserting `id === '<requested>'` always pass.
 *
 * `topSkills` is included so the detail view can render a "top skills in
 * this category" widget without needing a separate skills fetch in the
 * mock layer.
 */
const DEFAULT_CATALOG_DETAIL = {
  id: 'cat-001',
  name: 'Engineering',
  code: 'ENG',
  description: 'Software engineering technical competencies.',
  status: 'active',
  skillCount: 24,
  topSkills: [
    { id: 'skl-001', name: 'TypeScript' },
    { id: 'skl-002', name: 'System Design' },
    { id: 'skl-003', name: 'Code Review' },
  ],
  createdAt: '2026-01-10T10:00:00Z',
  updatedAt: '2026-04-15T10:00:00Z',
};

/**
 * Default skills list returned when `skills-list.json` is unavailable.
 * Spans Engineering and Leadership categories so list-filter tests have
 * realistic data even before the canonical fixtures are committed.
 */
const DEFAULT_SKILLS_LIST = {
  data: [
    {
      id: 'skl-001',
      name: 'TypeScript',
      categoryId: 'cat-001',
      categoryName: 'Engineering',
      level: 'intermediate',
      status: 'active',
    },
    {
      id: 'skl-002',
      name: 'System Design',
      categoryId: 'cat-001',
      categoryName: 'Engineering',
      level: 'advanced',
      status: 'active',
    },
    {
      id: 'skl-003',
      name: 'Code Review',
      categoryId: 'cat-001',
      categoryName: 'Engineering',
      level: 'intermediate',
      status: 'active',
    },
    {
      id: 'skl-004',
      name: 'Stakeholder Management',
      categoryId: 'cat-002',
      categoryName: 'Leadership',
      level: 'advanced',
      status: 'active',
    },
  ],
};

/**
 * Default skill detail returned for GET /api/competencies/skills/:id.
 * The `id` field is overridden with the requested id at response time.
 *
 * The `proficiencyLevels` ladder mirrors the canonical 5-level scale used
 * across Whoville-Client (Novice / Beginner / Intermediate / Advanced /
 * Expert) so Pattern C (Form CRUD) tests can assert on the labels.
 */
const DEFAULT_SKILL_DETAIL = {
  id: 'skl-001',
  name: 'TypeScript',
  description: 'Proficiency in TypeScript for production-grade applications.',
  categoryId: 'cat-001',
  categoryName: 'Engineering',
  level: 'intermediate',
  proficiencyLevels: [
    { level: 1, name: 'Novice', description: 'Familiar with syntax.' },
    { level: 2, name: 'Beginner', description: 'Can write simple programs.' },
    { level: 3, name: 'Intermediate', description: 'Comfortable with types and generics.' },
    { level: 4, name: 'Advanced', description: 'Designs type-safe APIs and tooling.' },
    { level: 5, name: 'Expert', description: 'Contributes to TypeScript ecosystem.' },
  ],
  status: 'active',
  createdAt: '2026-01-15T10:00:00Z',
  updatedAt: '2026-04-15T10:00:00Z',
};

/**
 * Default proficiency matrix returned when `proficiency-matrix.json` is
 * unavailable. The matrix is the most complex resource: it has a
 * categories[].skills[].* shape so the proficiency-matrix-view spec can
 * render a 2D grid (categories down, skills across) and assert on
 * specific cells.
 *
 * `requiredLevel` vs `averageLevel` lets the UI show a "gap analysis"
 * widget (red cells where average < required, green where average >=
 * required) which the matrix-view CRUD spec exercises.
 */
const DEFAULT_PROFICIENCY_MATRIX = {
  generatedAt: '2026-05-01T00:00:00Z',
  categories: [
    {
      id: 'cat-001',
      name: 'Engineering',
      skills: [
        {
          id: 'skl-001',
          name: 'TypeScript',
          requiredLevel: 3,
          averageLevel: 3.4,
          employeeCount: 42,
        },
        {
          id: 'skl-002',
          name: 'System Design',
          requiredLevel: 4,
          averageLevel: 3.1,
          employeeCount: 42,
        },
      ],
    },
    {
      id: 'cat-002',
      name: 'Leadership',
      skills: [
        {
          id: 'skl-004',
          name: 'Stakeholder Management',
          requiredLevel: 3,
          averageLevel: 2.9,
          employeeCount: 18,
        },
      ],
    },
  ],
};

/**
 * Default learning paths list returned when `learning-paths.json` is
 * unavailable. Three paths span the typical career-arc (onboarding ->
 * senior track -> manager transition) so the Pattern B (List/Detail)
 * tests have realistic variety.
 */
const DEFAULT_LEARNING_PATHS_LIST = {
  data: [
    {
      id: 'lp-001',
      name: 'New Engineer Onboarding',
      skillCount: 8,
      durationWeeks: 12,
      status: 'active',
    },
    {
      id: 'lp-002',
      name: 'Senior Engineer Track',
      skillCount: 16,
      durationWeeks: 26,
      status: 'active',
    },
    {
      id: 'lp-003',
      name: 'Manager Transition',
      skillCount: 12,
      durationWeeks: 16,
      status: 'active',
    },
  ],
};

/**
 * Default learning path detail returned for any
 * GET /api/competencies/learning-paths/:id request. The `id` field is
 * overridden with the requested id at response time.
 *
 * `steps` models a typical mixed-format learning path with `course` and
 * `project` step types. The Pattern E (Workflow) tests for learning-path
 * authoring exercise this shape.
 *
 * `enrolledCount` and `completedCount` enable the UI's "completion rate"
 * widget without requiring a separate enrollment-stats fetch.
 */
const DEFAULT_LEARNING_PATH_DETAIL = {
  id: 'lp-001',
  name: 'New Engineer Onboarding',
  description: 'Foundational learning path for new engineering hires.',
  skillCount: 8,
  durationWeeks: 12,
  status: 'active',
  steps: [
    {
      order: 1,
      type: 'course',
      skillId: 'skl-001',
      title: 'TypeScript Fundamentals',
      durationHours: 12,
    },
    {
      order: 2,
      type: 'course',
      skillId: 'skl-002',
      title: 'System Design Basics',
      durationHours: 16,
    },
    {
      order: 3,
      type: 'project',
      skillId: 'skl-003',
      title: 'Code Review Practicum',
      durationHours: 8,
    },
  ],
  enrolledCount: 18,
  completedCount: 9,
};

/**
 * Default certifications list. Per AAP §0.5.1.13 there is no canonical
 * fixture file for certifications; this default is the only data source
 * for the certifications endpoint until a fixture is committed by a
 * future agent.
 */
const DEFAULT_CERTIFICATIONS_LIST = {
  data: [
    {
      id: 'cert-001',
      name: 'Engineering Onboarding Cert',
      skillId: 'skl-001',
      recipientCount: 9,
      status: 'active',
    },
    {
      id: 'cert-002',
      name: 'System Design Mastery',
      skillId: 'skl-002',
      recipientCount: 4,
      status: 'active',
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
 * Whoville-Client default of 20 rows per page in list views.
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
 *   ?categoryId=cat-001 -> keep items with item.categoryId === 'cat-001'
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
 */
const DEFAULT_JSON_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-expose-headers': '*',
};

/**
 * Respond to a Playwright route with a JSON body. Auto-stringifies the
 * `body` argument and sets sensible default headers; caller-supplied
 * headers via `extraHeaders` override defaults at the same key.
 *
 * @param route  Playwright Route (provided by `page.route()` callback).
 * @param status HTTP status code to return.
 * @param body   Object/array/primitive to JSON.stringify into the body.
 * @param extraHeaders Optional caller-supplied headers; override defaults.
 */
async function respondWithJson(
  route: Route,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<void> {
  await route.fulfill({
    status,
    headers: {
      ...DEFAULT_JSON_HEADERS,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

/**
 * Respond with HTTP 204 No Content. Used for successful DELETE operations
 * (catalog/skill/learning-path/certification deletion) and other endpoints
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
 * Resource-specific prefixes (`cat`, `skl`, `lp`, `cert`) make log
 * inspection trivially decodable: at a glance, `e2e-test-skl-...`
 * indicates a skill was created.
 *
 * @param prefix  Entity-type prefix (e.g., 'cat', 'skl', 'lp', 'cert').
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
// Sub-handler: Catalog
//
// /api/competencies/catalog            GET (list)  POST (create)
// /api/competencies/catalog/:id        GET (read)  PUT/PATCH (update)
//                                      DELETE (remove)
//
// Catalog entries are the top-level competency categories (Engineering,
// Leadership, etc). Skills belong to a category via `categoryId`.
// ---------------------------------------------------------------------------

/**
 * Handle requests to the catalog collection endpoint:
 *   GET  /api/competencies/catalog  -> paginated list (search/filter/sort applied)
 *   POST /api/competencies/catalog  -> create (echoes body with generated id)
 *
 * Other methods receive 405 with a list of allowed verbs. POST responses
 * include a `skillCount: 0` field because newly-created categories own
 * no skills until skills are explicitly assigned.
 */
async function handleCatalog(route: Route, request: Request, url: URL): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    const fixture =
      readFixtureJson<{ data: unknown[] }>('catalog-list.json') ?? DEFAULT_CATALOG_LIST;
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
      id: generateId('cat'),
      status: body.status ?? 'active',
      skillCount: 0,
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
 * Handle requests to a specific catalog entry by id:
 *   GET    /api/competencies/catalog/:id  -> catalog detail
 *   PUT    /api/competencies/catalog/:id  -> update (echoes body merged onto detail)
 *   PATCH  /api/competencies/catalog/:id  -> partial update (treated identically to PUT)
 *   DELETE /api/competencies/catalog/:id  -> 204
 *
 * The detail body is built by spreading DEFAULT_CATALOG_DETAIL and
 * overriding `id` with the requested id so detail-view tests asserting
 * `expect(catalog.id).toBe('<requested>')` always pass.
 */
async function handleCatalogById(route: Route, request: Request, id: string): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    return respondWithJson(route, 200, { ...DEFAULT_CATALOG_DETAIL, id });
  }

  if (method === 'PUT' || method === 'PATCH') {
    const body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
    return respondWithJson(route, 200, {
      ...DEFAULT_CATALOG_DETAIL,
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
// Sub-handler: Skills
//
// /api/competencies/skills            GET (list)  POST (create)
// /api/competencies/skills/:id        GET (read)  PUT/PATCH (update)
//                                     DELETE (remove)
//
// Skills are the leaf-level competency entries; each belongs to a catalog
// category via `categoryId`. The skill detail response includes the
// canonical 5-level proficiency ladder (Novice -> Expert).
// ---------------------------------------------------------------------------

/**
 * Handle requests to the skills collection endpoint:
 *   GET  /api/competencies/skills  -> paginated list
 *   POST /api/competencies/skills  -> create (echoes body with generated id)
 */
async function handleSkills(route: Route, request: Request, url: URL): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    const fixture = readFixtureJson<{ data: unknown[] }>('skills-list.json') ?? DEFAULT_SKILLS_LIST;
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
      id: generateId('skl'),
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
 * Handle requests to a specific skill by id:
 *   GET    /api/competencies/skills/:id  -> skill detail
 *   PUT    /api/competencies/skills/:id  -> update
 *   PATCH  /api/competencies/skills/:id  -> partial update
 *   DELETE /api/competencies/skills/:id  -> 204
 */
async function handleSkillById(route: Route, request: Request, id: string): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    return respondWithJson(route, 200, { ...DEFAULT_SKILL_DETAIL, id });
  }

  if (method === 'PUT' || method === 'PATCH') {
    const body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
    return respondWithJson(route, 200, {
      ...DEFAULT_SKILL_DETAIL,
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
// Sub-handler: Proficiency Matrix
//
// /api/competencies/proficiency-matrix                  GET (full matrix)
//                                                       PUT/PATCH (replace/update)
// /api/competencies/proficiency-matrix/:competencyId    GET (per-competency entry)
//                                                       PUT/PATCH (per-competency update)
//
// Per AAP §0.5.1.6 (Competencies POMs) and §0.5.1.10 (Tier 2 specs), the
// proficiency matrix is exercised both as a full-grid view AND as
// per-competency edit operations. The handler reflects this:
//   - GET /proficiency-matrix              returns the whole categories[].skills[] matrix
//   - GET /proficiency-matrix/:competencyId returns just one row with distribution stats
//
// The Pattern B (List/Detail) and Pattern C (Form CRUD) tests both
// benefit from this split; a full refresh fetches the matrix, and an
// optimistic-UI edit hits the per-competency endpoint.
// ---------------------------------------------------------------------------

/**
 * Handle requests to the full proficiency matrix endpoint.
 *
 * GET returns the entire categories[].skills[] structure suitable for
 * 2D-grid rendering. PUT/PATCH update the matrix wholesale; the body is
 * spread on top of DEFAULT_PROFICIENCY_MATRIX so partial-update bodies
 * (e.g., `{ categories: [...new categories...] }`) compose correctly.
 *
 * `generatedAt` is refreshed on every PUT/PATCH so the UI's "last
 * generated" timestamp updates to confirm the write succeeded.
 *
 * POST and DELETE are intentionally not allowed because the matrix is
 * a derived view: it is regenerated server-side from skill+role data,
 * not created or deleted as a free-standing entity.
 */
async function handleProficiencyMatrix(route: Route, request: Request): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    const fixture =
      readFixtureJson<Record<string, unknown>>('proficiency-matrix.json') ??
      DEFAULT_PROFICIENCY_MATRIX;
    return respondWithJson(route, 200, fixture);
  }

  if (method === 'PUT' || method === 'PATCH') {
    const body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
    return respondWithJson(route, 200, {
      ...DEFAULT_PROFICIENCY_MATRIX,
      ...body,
      generatedAt: nowIso(),
    });
  }

  return respondWithJson(route, 405, {
    error: 'method_not_allowed',
    allowed: ['GET', 'PUT', 'PATCH'],
  });
}

/**
 * Handle requests to a per-competency proficiency entry:
 *   GET    /api/competencies/proficiency-matrix/:competencyId  -> single-row view
 *   PUT    /api/competencies/proficiency-matrix/:competencyId  -> update entry
 *   PATCH  /api/competencies/proficiency-matrix/:competencyId  -> partial update
 *
 * The GET response includes a `distribution` object showing how many
 * employees are at each proficiency level (level1..level5). This drives
 * the histogram widget in the proficiency-matrix-edit view.
 *
 * The PATCH response echoes the body with an `updatedAt` so the UI can
 * show optimistic-UI confirmation per AAP §0.5.1.10's
 * `proficiency-matrix-edit.crud.spec.ts`.
 *
 * DELETE is intentionally unsupported (the matrix entry is derived;
 * deleting it requires deleting the underlying skill via the skills
 * endpoint).
 */
async function handleProficiencyMatrixCompetency(
  route: Route,
  request: Request,
  competencyId: string,
): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    return respondWithJson(route, 200, {
      competencyId,
      requiredLevel: 3,
      averageLevel: 3.2,
      employeeCount: 42,
      distribution: { level1: 2, level2: 8, level3: 18, level4: 12, level5: 2 },
    });
  }

  if (method === 'PUT' || method === 'PATCH') {
    const body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
    return respondWithJson(route, 200, {
      competencyId,
      ...body,
      updatedAt: nowIso(),
    });
  }

  return respondWithJson(route, 405, {
    error: 'method_not_allowed',
    allowed: ['GET', 'PUT', 'PATCH'],
  });
}

// ---------------------------------------------------------------------------
// Sub-handler: Learning Paths
//
// /api/competencies/learning-paths            GET (list)  POST (create)
// /api/competencies/learning-paths/:id        GET (read)  PUT/PATCH (update)
//                                             DELETE (remove)
//
// Learning paths are ordered sequences of skill-development steps
// (courses, projects, mentorship, etc) that an employee enrolls in.
// ---------------------------------------------------------------------------

/**
 * Handle requests to the learning paths collection endpoint:
 *   GET  /api/competencies/learning-paths  -> paginated list
 *   POST /api/competencies/learning-paths  -> create
 *
 * POST responses include `enrolledCount: 0` and `completedCount: 0` so
 * newly-created paths render correctly in the "completion rate" widget
 * without needing a separate enrollment-stats fetch.
 */
async function handleLearningPaths(route: Route, request: Request, url: URL): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    const fixture =
      readFixtureJson<{ data: unknown[] }>('learning-paths.json') ?? DEFAULT_LEARNING_PATHS_LIST;
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
      id: generateId('lp'),
      status: body.status ?? 'active',
      enrolledCount: 0,
      completedCount: 0,
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
 * Handle requests to a specific learning path by id:
 *   GET    /api/competencies/learning-paths/:id  -> path detail (with steps)
 *   PUT    /api/competencies/learning-paths/:id  -> update
 *   PATCH  /api/competencies/learning-paths/:id  -> partial update
 *   DELETE /api/competencies/learning-paths/:id  -> 204
 *
 * The detail response includes the full `steps[]` array so the path
 * builder UI can render the ordered step list without additional fetches.
 */
async function handleLearningPathById(route: Route, request: Request, id: string): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    return respondWithJson(route, 200, { ...DEFAULT_LEARNING_PATH_DETAIL, id });
  }

  if (method === 'PUT' || method === 'PATCH') {
    const body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
    return respondWithJson(route, 200, {
      ...DEFAULT_LEARNING_PATH_DETAIL,
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
// Sub-handler: Certifications
//
// /api/competencies/certifications              GET (list)  POST (create)
// /api/competencies/certifications/:id          GET (read)  PUT/PATCH (update)
//                                               DELETE (remove)
// /api/competencies/certifications/:id/award    POST (award to recipients)
//
// Certifications are awarded credentials tied to a skill. The "award"
// sub-action is a workflow operation distinct from CRUD on the
// certification template; per AAP §0.5.1.10's `certification-create.crud.spec.ts`,
// awarding is a separate user gesture exercised by the Pattern E
// (Workflow) tests.
//
// No canonical fixture file exists for certifications (per AAP §0.5.1.13);
// this handler always reads from DEFAULT_CERTIFICATIONS_LIST until a
// fixture is committed by a future agent.
// ---------------------------------------------------------------------------

/**
 * Shape of the POST /api/competencies/certifications/:id/award request
 * body. `recipientIds` is the only meaningful field at this layer; the
 * server-side logic would normally also validate per-recipient
 * eligibility but the mock is permissive (any recipient list succeeds).
 */
interface CertificationAwardBody {
  recipientIds?: string[];
}

/**
 * Handle requests to the certifications collection endpoint:
 *   GET  /api/competencies/certifications  -> paginated list
 *   POST /api/competencies/certifications  -> create
 *
 * POST responses include `recipientCount: 0` because newly-created
 * certifications have not been awarded to anyone until the award
 * sub-action is invoked.
 */
async function handleCertifications(route: Route, request: Request, url: URL): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    const baseItems = Array.isArray(DEFAULT_CERTIFICATIONS_LIST.data)
      ? (DEFAULT_CERTIFICATIONS_LIST.data as Array<Record<string, unknown>>)
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
      id: generateId('cert'),
      status: body.status ?? 'active',
      recipientCount: 0,
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
 * Handle requests to a specific certification by id:
 *   GET    /api/competencies/certifications/:id  -> certification detail
 *   PUT    /api/competencies/certifications/:id  -> update
 *   PATCH  /api/competencies/certifications/:id  -> partial update
 *   DELETE /api/competencies/certifications/:id  -> 204
 *
 * The detail body is constructed inline (rather than spreading from a
 * DEFAULT constant) because the certification detail shape is small
 * enough to be readable in-place and including a bespoke detail
 * constant offered no semantic benefit.
 */
async function handleCertificationById(route: Route, request: Request, id: string): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    return respondWithJson(route, 200, {
      id,
      name: 'Engineering Onboarding Cert',
      description: 'Awarded upon completion of the new engineer onboarding path.',
      skillId: 'skl-001',
      durationDays: 365,
      recipientCount: 9,
      status: 'active',
      createdAt: '2026-01-15T10:00:00Z',
      updatedAt: '2026-04-15T10:00:00Z',
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
 * Handle the certification award sub-action:
 *   POST /api/competencies/certifications/:id/award
 *
 * Body shape:
 *   { recipientIds: ['uid-1', 'uid-2', ...] }
 *
 * Response shape:
 *   {
 *     certificationId: ':id',
 *     awardedTo: ['uid-1', 'uid-2', ...],
 *     awardCount: <number>,
 *     awardedAt: '<iso-timestamp>'
 *   }
 *
 * Per AAP §0.5.1.10's `certification-create.crud.spec.ts`, awarding is
 * a workflow operation distinct from creating the certification
 * template. Tests exercise the "award N badges" UI pattern by
 * constructing a recipient list and asserting the count round-trips.
 *
 * Non-POST methods receive 405 with `allowed: ['POST']` because award
 * is a write-only sub-action; querying past awards happens via the
 * audit/grants endpoints in other handlers, not here.
 */
async function handleCertificationAward(route: Route, request: Request, id: string): Promise<void> {
  if (request.method().toUpperCase() !== 'POST') {
    return respondWithJson(route, 405, {
      error: 'method_not_allowed',
      allowed: ['POST'],
    });
  }
  const body = (request.postDataJSON() as CertificationAwardBody | null) ?? {};
  const recipientIds = Array.isArray(body.recipientIds) ? body.recipientIds : [];
  return respondWithJson(route, 200, {
    certificationId: id,
    awardedTo: recipientIds,
    awardCount: recipientIds.length,
    awardedAt: nowIso(),
  });
}

// ---------------------------------------------------------------------------
// Unknown-route handler
// ---------------------------------------------------------------------------

/**
 * Catch-all for requests under `/api/competencies/...` that the dispatcher
 * does not recognise. Returns HTTP 501 Not Implemented and emits a
 * structured warning so that test authors immediately see which URL
 * lacks coverage instead of silently falling through to network mode.
 */
async function handleUnknown(route: Route, request: Request): Promise<void> {
  console.warn(
    `${LOG_PREFIX} No sub-handler for ${request.method()} ${request.url()}. ` +
      `Returning 501. Add a sub-handler in e2e/mocks/handlers/competencies.handler.ts.`,
  );
  return respondWithJson(route, 501, {
    error: 'not_implemented',
    method: request.method(),
    url: request.url(),
  });
}

// ---------------------------------------------------------------------------
// Public function: competenciesHandler
// ---------------------------------------------------------------------------

/**
 * URL pathname regex used to extract the resource, optional id, and
 * optional sub-action from
 * `/api/competencies/<resource>[/<id>][/<sub-action>]`. Capturing groups:
 *   1: resource (required)         e.g., 'catalog', 'skills', 'certifications'
 *   2: id (optional)               e.g., 'cat-001'
 *   3: sub-action (optional)       e.g., 'award' for certifications
 *
 * The third group is captured because the `certifications/:id/award`
 * path is the only sub-action sub-route in this scope; other resources
 * leave it as `undefined`. Resources that receive an unexpected
 * sub-action fall through to `handleUnknown()` (returning 501) so test
 * authors see exactly which URL lacks coverage.
 */
const PATH_REGEX = /\/api\/competencies\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?/;

/**
 * Competencies API mock handler. Public entry point invoked by Playwright
 * for any request matching `**\/api/competencies/**`.
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
 * Resource routing matrix (for `/api/competencies/<resource>/...`):
 *
 *   resource           | no id, no sub        | with id, no sub                      | with id+sub
 *   ------------------ | -------------------- | ------------------------------------ | ----------------
 *   catalog            | handleCatalog        | handleCatalogById                    | handleUnknown
 *   skills             | handleSkills         | handleSkillById                      | handleUnknown
 *   proficiency-matrix | handleProficiencyMatrix | handleProficiencyMatrixCompetency | handleUnknown
 *   learning-paths     | handleLearningPaths  | handleLearningPathById               | handleUnknown
 *   certifications     | handleCertifications | handleCertificationById              | handleCertificationAward (sub === 'award')
 *
 * The function is async (returns Promise<void>) to match Playwright's
 * `page.route(url, handler)` callback contract; sub-handlers are also
 * async so all network responses are emitted via `await route.fulfill()`.
 *
 * @param route   Playwright route object; used for `route.fulfill()`.
 * @param request Playwright request metadata; used to read URL/method/body.
 */
export async function competenciesHandler(route: Route, request: Request): Promise<void> {
  const url = new URL(request.url());
  // Strip trailing slashes so `/api/competencies/catalog/` and
  // `/api/competencies/catalog` behave identically.
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
    case 'catalog':
      if (id !== undefined && subAction === undefined) {
        return handleCatalogById(route, request, id);
      }
      if (id === undefined) {
        return handleCatalog(route, request, url);
      }
      return handleUnknown(route, request);

    case 'skills':
      if (id !== undefined && subAction === undefined) {
        return handleSkillById(route, request, id);
      }
      if (id === undefined) {
        return handleSkills(route, request, url);
      }
      return handleUnknown(route, request);

    case 'proficiency-matrix':
      if (id !== undefined && subAction === undefined) {
        return handleProficiencyMatrixCompetency(route, request, id);
      }
      if (id === undefined) {
        return handleProficiencyMatrix(route, request);
      }
      return handleUnknown(route, request);

    case 'learning-paths':
      if (id !== undefined && subAction === undefined) {
        return handleLearningPathById(route, request, id);
      }
      if (id === undefined) {
        return handleLearningPaths(route, request, url);
      }
      return handleUnknown(route, request);

    case 'certifications':
      if (id !== undefined && subAction === 'award') {
        return handleCertificationAward(route, request, id);
      }
      if (id !== undefined && subAction === undefined) {
        return handleCertificationById(route, request, id);
      }
      if (id === undefined) {
        return handleCertifications(route, request, url);
      }
      return handleUnknown(route, request);

    default:
      return handleUnknown(route, request);
  }
}
