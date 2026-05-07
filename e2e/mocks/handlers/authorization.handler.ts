/**
 * Authorization API mock handler.
 *
 * Registered by `e2e/mocks/api-router.ts` against URL pattern `**\/api/auth-mgmt/**`.
 *
 * NOTE: The URL scope is `/api/auth-mgmt/` (not `/api/authorization/`) because
 * the Whoville-Client app distinguishes "auth" (login/session) from "auth-mgmt"
 * (RBAC management). The handler exports `authorizationHandler` to match the
 * Module name; the URL pattern uses the URL scope name. This deliberate
 * mismatch between module name and URL prefix lets the api-router.ts register
 * the handler at the correct URL while keeping the source-code identifier
 * aligned with the AAP module decomposition (App Core + Workforce + Assessments
 * + Competencies + Authorization).
 *
 * Handled resources (per AAP §0.3.1, §0.5.1.13, §0.5.1.10):
 *   /api/auth-mgmt/roles                  - CRUD + list (paginated)
 *   /api/auth-mgmt/roles/:id              - Read / Update / Delete
 *   /api/auth-mgmt/permissions            - CRUD + list (paginated)
 *   /api/auth-mgmt/permissions/:id        - Read / Update / Delete
 *   /api/auth-mgmt/grants                 - List role grants (paginated)
 *   /api/auth-mgmt/grants                 - POST: assign role to user
 *   /api/auth-mgmt/grants/:id             - Read / Delete (revoke)
 *   /api/auth-mgmt/delegated-access       - CRUD + list (paginated)
 *   /api/auth-mgmt/delegated-access/:id   - Read / Update / Delete (revoke)
 *   /api/auth-mgmt/audit                  - Read audit-of-grants log (paginated)
 *
 * Magic recipient IDs for RBAC denial testing (per AAP §0.5.1.11):
 *   - Recipient `e2e-restricted-user` causes grant POST to return 403.
 *   - Role ID `role-in-use` causes role DELETE to return 409 (with usageCount).
 *
 * Pagination contract:
 *   GET /api/auth-mgmt/<resource>?page=N&size=M&q=<keyword>&sort=<field>&order=<asc|desc>
 *   Response: { data: [...], pagination: { page, size, total, totalPages } }
 *
 * Search/Filter/Sort contract:
 *   - `q` query parameter performs case-insensitive substring search across
 *     all top-level string/number fields of each item.
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
 *   migration rewrites internal services freely, but `/api/auth-mgmt/**`
 *   URL paths and the JSON shapes returned here remain the contract.
 *
 * @see AAP §0.5.1.12 - mandate (Factories, Mocks, and Test Utilities)
 * @see AAP §0.5.1.13 - canonical fixtures (e2e/fixtures/api-responses/...)
 * @see AAP §0.3.1   - test target identification (Authorization API scope)
 * @see AAP §0.5.1.10 - Tier 2 CRUD specs that consume this handler
 * @see AAP §0.5.1.11 - Tier 3 spec 03-rbac-denial-paths.int.spec.ts
 * @see e2e/mocks/api-router.ts - registers this handler at `**\/api/auth-mgmt/**`
 * @see e2e/fixtures/api-responses/authorization/* - canonical JSON fixtures
 * @see e2e/fixtures/api-responses/errors/403.json - canonical denial response
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
 * Absolute path to the directory containing canonical authorization-module
 * JSON fixtures. Resolved relative to `__dirname` so the handler is
 * cross-platform (Windows / macOS / Linux) and survives reorganization of
 * the e2e/ directory.
 *
 * Layout:
 *   e2e/mocks/handlers/authorization.handler.ts  <-- file
 *   e2e/mocks/handlers/                          <-- __dirname
 *   e2e/mocks/                                   <-- path.join(__dirname, '..')
 *   e2e/                                         <-- path.join(__dirname, '..', '..')
 *   e2e/fixtures/api-responses/authorization/    <-- FIXTURE_ROOT
 */
const FIXTURE_ROOT = path.resolve(
  __dirname,
  '..',
  '..',
  'fixtures',
  'api-responses',
  'authorization',
);

/**
 * Absolute path to the directory containing canonical error-response JSON
 * fixtures (401, 403, 404, 422, 500). Used by `respondForbidden()` to read
 * the canonical 403 body and by future helpers when other status codes
 * become relevant.
 */
const ERRORS_FIXTURE_ROOT = path.resolve(
  __dirname,
  '..',
  '..',
  'fixtures',
  'api-responses',
  'errors',
);

/**
 * In-memory cache of JSON fixture file contents.
 *
 * - Key: relative path under FIXTURE_ROOT (e.g. 'roles-list.json') OR
 *   the prefix-qualified key 'errors/<filename>' for ERRORS_FIXTURE_ROOT.
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
 * error-injector and latency-injector helpers.
 */
const LOG_PREFIX = '[mock-api/authorization]';

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
 * @param relPath  Path relative to FIXTURE_ROOT (e.g., 'roles-list.json').
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

/**
 * Read an error-response JSON fixture from ERRORS_FIXTURE_ROOT.
 *
 * Distinct from `readFixture` because error bodies live in a sibling
 * directory (`fixtures/api-responses/errors/`) rather than the
 * authorization-scoped directory. Cache keys are prefixed with `errors/`
 * to avoid collision with same-named authorization fixtures.
 *
 * @param filename  Bare filename (e.g., '403.json').
 * @returns Raw fixture contents or `null` when unavailable.
 */
function readErrorFixture(filename: string): string | null {
  const cacheKey = `errors/${filename}`;
  if (FIXTURE_CACHE.has(cacheKey)) {
    return FIXTURE_CACHE.get(cacheKey) ?? null;
  }
  const fullPath = path.join(ERRORS_FIXTURE_ROOT, filename);
  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    JSON.parse(content);
    FIXTURE_CACHE.set(cacheKey, content);
    return content;
  } catch {
    // Silent fall-through: error fixtures are convenience overrides, not
    // required infrastructure. Inline DEFAULT_403 always works as a
    // baseline so we don't spam the console with warnings here.
    FIXTURE_CACHE.set(cacheKey, null);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Inline default responses
//
// These constants act as the safety net when canonical JSON fixtures under
// `e2e/fixtures/api-responses/authorization/` are missing. They contain
// realistic data that mirrors typical Whoville-Client RBAC entities so
// tests asserting on visible content (role names, permission codes,
// user counts, audit messages) remain valid even before the canonical
// fixtures are committed.
//
// All defaults are declared `as const` would over-constrain mutability for
// downstream `as Array<Record<string, unknown>>` casts; instead we declare
// them as plain object literals and rely on the read-only contract of the
// handler (no mutation; spreads/slices instead).
// ---------------------------------------------------------------------------

/**
 * Default roles list used when `roles-list.json` is unavailable. Mirrors
 * the canonical Whoville-Client role catalog: Administrator, Manager,
 * Employee, and Read-Only Viewer.
 */
const DEFAULT_ROLES_LIST = {
  data: [
    { id: 'role-admin', name: 'Administrator', code: 'ADMIN', userCount: 5, status: 'active' },
    { id: 'role-manager', name: 'Manager', code: 'MGR', userCount: 18, status: 'active' },
    { id: 'role-employee', name: 'Employee', code: 'EMP', userCount: 224, status: 'active' },
    { id: 'role-viewer', name: 'Read-Only Viewer', code: 'VIEW', userCount: 12, status: 'active' },
  ],
};

/**
 * Default role detail returned for any GET /api/auth-mgmt/roles/:id request.
 * The `id` field is overridden with the requested id at response time so
 * that detail-view tests asserting `id === '<requested>'` always pass.
 */
const DEFAULT_ROLE_DETAIL = {
  id: 'role-admin',
  name: 'Administrator',
  code: 'ADMIN',
  description: 'Full access to all Whoville-Client resources.',
  userCount: 5,
  status: 'active',
  permissions: [
    'workforce.read',
    'workforce.write',
    'workforce.delete',
    'assessments.read',
    'assessments.write',
    'assessments.delete',
    'competencies.read',
    'competencies.write',
    'competencies.delete',
    'authorization.read',
    'authorization.write',
    'authorization.delete',
  ],
  createdAt: '2026-01-10T10:00:00Z',
  updatedAt: '2026-04-15T10:00:00Z',
};

/**
 * Default permissions list used when `permissions-list.json` is unavailable.
 * Codes follow the standard `<module>.<action>` convention used throughout
 * the Whoville-Client; tests asserting on permission codes can rely on
 * exact matches against this set.
 */
const DEFAULT_PERMISSIONS_LIST = {
  data: [
    {
      id: 'perm-001',
      code: 'workforce.read',
      name: 'View Workforce',
      module: 'workforce',
      status: 'active',
    },
    {
      id: 'perm-002',
      code: 'workforce.write',
      name: 'Edit Workforce',
      module: 'workforce',
      status: 'active',
    },
    {
      id: 'perm-003',
      code: 'workforce.delete',
      name: 'Delete Workforce',
      module: 'workforce',
      status: 'active',
    },
    {
      id: 'perm-004',
      code: 'assessments.read',
      name: 'View Assessments',
      module: 'assessments',
      status: 'active',
    },
    {
      id: 'perm-005',
      code: 'assessments.write',
      name: 'Edit Assessments',
      module: 'assessments',
      status: 'active',
    },
    {
      id: 'perm-006',
      code: 'competencies.read',
      name: 'View Competencies',
      module: 'competencies',
      status: 'active',
    },
    {
      id: 'perm-007',
      code: 'authorization.read',
      name: 'View Authorization',
      module: 'authorization',
      status: 'active',
    },
    {
      id: 'perm-008',
      code: 'authorization.write',
      name: 'Manage Authorization',
      module: 'authorization',
      status: 'active',
    },
  ],
};

/**
 * Default permission detail returned for GET /api/auth-mgmt/permissions/:id.
 * The `id` field is overridden with the requested id at response time.
 */
const DEFAULT_PERMISSION_DETAIL = {
  id: 'perm-001',
  code: 'workforce.read',
  name: 'View Workforce',
  description: 'Permission to view workforce-related entities and reports.',
  module: 'workforce',
  resource: '*',
  action: 'read',
  status: 'active',
  assignedRoleCount: 3,
  createdAt: '2026-01-10T10:00:00Z',
  updatedAt: '2026-04-15T10:00:00Z',
};

/**
 * Default role-grants list used when `role-grants.json` is unavailable.
 * Each grant represents a (user, role) tuple with provenance metadata
 * (grantedAt, grantedBy) so audit-style assertions work end-to-end.
 */
const DEFAULT_GRANTS_LIST = {
  data: [
    {
      id: 'grant-001',
      userId: 'jdoe',
      userName: 'Jane Doe',
      roleId: 'role-manager',
      roleName: 'Manager',
      grantedAt: '2026-01-15T10:00:00Z',
      grantedBy: 'admin',
      status: 'active',
    },
    {
      id: 'grant-002',
      userId: 'asmith',
      userName: 'Alex Smith',
      roleId: 'role-employee',
      roleName: 'Employee',
      grantedAt: '2026-02-01T10:00:00Z',
      grantedBy: 'admin',
      status: 'active',
    },
  ],
};

/**
 * Default grant detail returned for GET /api/auth-mgmt/grants/:id. The
 * `grantedBy` field is intentionally an object (not a string) to model
 * the typical "who granted this" audit metadata expected by the
 * authorization detail view.
 */
const DEFAULT_GRANT_DETAIL = {
  id: 'grant-001',
  userId: 'jdoe',
  userName: 'Jane Doe',
  roleId: 'role-manager',
  roleName: 'Manager',
  scope: 'global',
  grantedAt: '2026-01-15T10:00:00Z',
  grantedBy: { id: 'admin', displayName: 'Administrator' },
  expiresAt: null,
  status: 'active',
};

/**
 * Default delegated-access list. There is no canonical fixture file for
 * delegated access in the AAP §0.5.1.13 inventory; this default is the
 * only data source for the delegated-access endpoint.
 */
const DEFAULT_DELEGATED_ACCESS_LIST = {
  data: [
    {
      id: 'da-001',
      granteeId: 'jdoe',
      delegatorId: 'asmith',
      scope: 'workforce',
      startsAt: '2026-04-01T00:00:00Z',
      endsAt: '2026-04-30T23:59:59Z',
      status: 'active',
    },
  ],
};

/**
 * Default delegated-access detail. Returned for any
 * GET /api/auth-mgmt/delegated-access/:id with the `id` overridden at
 * response time.
 */
const DEFAULT_DELEGATED_ACCESS_DETAIL = {
  id: 'da-001',
  granteeId: 'jdoe',
  granteeName: 'Jane Doe',
  delegatorId: 'asmith',
  delegatorName: 'Alex Smith',
  scope: 'workforce',
  permissions: ['workforce.read', 'workforce.write'],
  startsAt: '2026-04-01T00:00:00Z',
  endsAt: '2026-04-30T23:59:59Z',
  reason: 'Coverage during PTO',
  status: 'active',
  createdAt: '2026-03-25T10:00:00Z',
};

/**
 * Default audit-of-grants log. Audit logs are append-only by design so
 * the handler returns these entries as paginated GET-only responses.
 * No POST/PUT/PATCH/DELETE methods are exposed for audit (returns 405).
 */
const DEFAULT_AUDIT_LOG = {
  data: [
    {
      id: 'audit-001',
      timestamp: '2026-04-25T15:30:00Z',
      actor: 'admin',
      action: 'role.granted',
      target: 'jdoe',
      details: 'Granted role role-manager to user jdoe',
    },
    {
      id: 'audit-002',
      timestamp: '2026-04-26T09:15:00Z',
      actor: 'admin',
      action: 'permission.created',
      target: 'perm-009',
      details: 'Created permission code: workforce.export',
    },
  ],
};

/**
 * Default 403 response body. Used by `respondForbidden()` when
 * `errors/403.json` is unavailable. The shape (error, message, code)
 * matches the canonical error envelope used across all
 * Whoville-Client APIs.
 */
const DEFAULT_403 = {
  error: 'forbidden',
  message: 'You do not have permission to perform this action.',
  code: 'AUTHZ_403',
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

  // parseInt with radix 10; NaN becomes the default. We use `|| default`
  // (logical OR) instead of `??` because `parseInt('abc', 10)` returns
  // NaN (which is truthy-coerced to false), and we want NaN to fall
  // through to the default.
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
 *   ?module=workforce -> keep items with item.module === 'workforce'
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
 * (role/permission/grant/delegated-access deletion) and other endpoints
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
 * Respond with HTTP 403 Forbidden using the canonical error envelope.
 *
 * Reads the response body from `errors/403.json` if available, falling
 * back to the inline DEFAULT_403 constant when the fixture file is
 * missing. An optional `message` override lets callers provide context
 * specific to the denial (e.g., "Cannot grant roles to restricted
 * user accounts") which surfaces in the UI's error toast.
 *
 * Used by `handleGrants()` for the magic recipient `e2e-restricted-user`
 * (per AAP §0.5.1.11 RBAC denial paths).
 */
async function respondForbidden(route: Route, message?: string): Promise<void> {
  const fixture = readErrorFixture('403.json');
  let body: Record<string, unknown>;
  if (fixture) {
    try {
      body = JSON.parse(fixture) as Record<string, unknown>;
    } catch {
      body = { ...DEFAULT_403 };
    }
  } else {
    body = { ...DEFAULT_403 };
  }
  if (message) {
    body.message = message;
  }
  return respondWithJson(route, 403, body);
}

/**
 * Generate a unique entity id with the `e2e-test-` prefix mandated by
 * AAP §0.4.4 (live-mode cleanup helper sweeps any orphan entity whose
 * id begins with this prefix). The body of the id encodes a millisecond
 * timestamp (base 36) and 6 random base-36 characters so collisions
 * across parallel workers are effectively impossible within a single
 * test run.
 *
 * @param prefix  Entity-type prefix (e.g., 'role', 'perm', 'grant', 'da').
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
// Sub-handler: Roles
//
// /api/auth-mgmt/roles            GET (list)  POST (create)
// /api/auth-mgmt/roles/:id        GET (read)  PUT/PATCH (update)  DELETE (remove)
//
// Magic role id `role-in-use` returns HTTP 409 on DELETE so the CRUD spec
// `role-delete.crud.spec.ts` (AAP §0.5.1.10) can assert the
// "Cannot delete role: assigned to active users" UX without needing a
// per-test `mockApi.intercept()` override.
// ---------------------------------------------------------------------------

/**
 * Magic role id that triggers a 409 Conflict on DELETE. Models the
 * "role is assigned to N active users" usage-check scenario.
 */
const MAGIC_ROLE_IN_USE_ID = 'role-in-use';

/**
 * Reported `usageCount` on the 409 response for `MAGIC_ROLE_IN_USE_ID`.
 * Tests assert the exact value in the error toast so it must remain
 * stable across versions of this handler.
 */
const MAGIC_ROLE_IN_USE_COUNT = 18;

/**
 * Handle requests to the roles collection endpoint:
 *   GET  /api/auth-mgmt/roles  -> paginated list (search/filter/sort applied)
 *   POST /api/auth-mgmt/roles  -> create (echoes body with generated id)
 *
 * Other methods receive 405 with a simple error envelope.
 */
async function handleRoles(route: Route, request: Request, url: URL): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    const fixture = readFixtureJson<{ data: unknown[] }>('roles-list.json') ?? DEFAULT_ROLES_LIST;
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
      id: generateId('role'),
      status: body.status ?? 'active',
      userCount: 0,
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
 * Handle requests to a specific role by id:
 *   GET    /api/auth-mgmt/roles/:id  -> role detail
 *   PUT    /api/auth-mgmt/roles/:id  -> update (echoes body merged onto detail)
 *   PATCH  /api/auth-mgmt/roles/:id  -> partial update (treated identically to PUT)
 *   DELETE /api/auth-mgmt/roles/:id  -> 204 (or 409 for `role-in-use`)
 *
 * Other methods receive 405 with a list of allowed verbs.
 */
async function handleRoleById(route: Route, request: Request, id: string): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    return respondWithJson(route, 200, { ...DEFAULT_ROLE_DETAIL, id });
  }

  if (method === 'PUT' || method === 'PATCH') {
    const body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
    return respondWithJson(route, 200, {
      ...DEFAULT_ROLE_DETAIL,
      ...body,
      id,
      updatedAt: nowIso(),
    });
  }

  if (method === 'DELETE') {
    // Per AAP §0.5.1.10 (role-delete.crud.spec.ts): the role-in-use
    // scenario expects 409 with a usageCount in the error envelope so
    // the UI can render "Cannot delete role: 18 active users".
    if (id === MAGIC_ROLE_IN_USE_ID) {
      return respondWithJson(route, 409, {
        error: 'conflict',
        message: 'Cannot delete role: assigned to active users.',
        code: 'AUTHZ_409',
        usageCount: MAGIC_ROLE_IN_USE_COUNT,
      });
    }
    return respondWithNoContent(route);
  }

  return respondWithJson(route, 405, {
    error: 'method_not_allowed',
    allowed: ['GET', 'PUT', 'PATCH', 'DELETE'],
  });
}

// ---------------------------------------------------------------------------
// Sub-handler: Permissions
//
// /api/auth-mgmt/permissions            GET (list)  POST (create)
// /api/auth-mgmt/permissions/:id        GET (read)  PUT/PATCH (update)  DELETE (remove)
//
// Permissions are owned by the system and can be created, edited, and
// deleted; grants (the user<->role relationship) live at a separate URL
// scope and use POST/DELETE only because grants are immutable.
// ---------------------------------------------------------------------------

/**
 * Handle requests to the permissions collection endpoint:
 *   GET  /api/auth-mgmt/permissions  -> paginated list
 *   POST /api/auth-mgmt/permissions  -> create
 */
async function handlePermissions(route: Route, request: Request, url: URL): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    const fixture =
      readFixtureJson<{ data: unknown[] }>('permissions-list.json') ?? DEFAULT_PERMISSIONS_LIST;
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
      id: generateId('perm'),
      status: body.status ?? 'active',
      assignedRoleCount: 0,
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
 * Handle requests to a specific permission by id:
 *   GET    /api/auth-mgmt/permissions/:id  -> permission detail
 *   PUT    /api/auth-mgmt/permissions/:id  -> update
 *   PATCH  /api/auth-mgmt/permissions/:id  -> partial update
 *   DELETE /api/auth-mgmt/permissions/:id  -> 204
 */
async function handlePermissionById(route: Route, request: Request, id: string): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    return respondWithJson(route, 200, { ...DEFAULT_PERMISSION_DETAIL, id });
  }

  if (method === 'PUT' || method === 'PATCH') {
    const body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
    return respondWithJson(route, 200, {
      ...DEFAULT_PERMISSION_DETAIL,
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
// Sub-handler: Grants (role assignment / revocation)
//
// /api/auth-mgmt/grants            GET (list)  POST (assign)
// /api/auth-mgmt/grants/:id        GET (read)  DELETE (revoke)
//
// Grants are immutable: there is no PUT/PATCH because changing a grant
// equals revoking the old one and creating a new one. This mirrors the
// canonical RBAC pattern used by most enterprise systems.
//
// Magic recipient `e2e-restricted-user` causes POST to return 403 so the
// Tier 3 spec `03-rbac-denial-paths.int.spec.ts` (AAP §0.5.1.11) can
// exercise denial UX without a per-test mockApi.intercept() override.
// ---------------------------------------------------------------------------

/**
 * Magic user id that triggers a 403 on POST /api/auth-mgmt/grants. Models
 * a server-side denial of granting roles to "restricted" identities
 * (system accounts, locked-out users, etc.).
 */
const MAGIC_RESTRICTED_USER_ID = 'e2e-restricted-user';

/**
 * Shape of the POST /api/auth-mgmt/grants request body. All fields are
 * optional at the type level so malformed clients (missing userId,
 * missing roleId) still produce well-defined responses.
 */
interface GrantPostBody {
  userId?: string;
  roleId?: string;
  scope?: string;
}

/**
 * Handle requests to the grants collection endpoint:
 *   GET  /api/auth-mgmt/grants  -> paginated list
 *   POST /api/auth-mgmt/grants  -> assign role to user (magic user id -> 403)
 */
async function handleGrants(route: Route, request: Request, url: URL): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    const fixture = readFixtureJson<{ data: unknown[] }>('role-grants.json') ?? DEFAULT_GRANTS_LIST;
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
    const body = (request.postDataJSON() as GrantPostBody | null) ?? {};
    const userId = body.userId ?? '';
    const roleId = body.roleId ?? '';

    // Magic recipient denial path (per AAP §0.5.1.11). Tests grant a role
    // to `e2e-restricted-user` and assert the UI surfaces the canonical
    // 403 message ("You do not have permission..." or the override below).
    if (userId === MAGIC_RESTRICTED_USER_ID) {
      return respondForbidden(route, 'Cannot grant roles to restricted user accounts.');
    }

    return respondWithJson(route, 201, {
      id: generateId('grant'),
      userId,
      roleId,
      scope: body.scope ?? 'global',
      grantedAt: nowIso(),
      grantedBy: 'mock-admin',
      status: 'active',
    });
  }

  return respondWithJson(route, 405, {
    error: 'method_not_allowed',
    allowed: ['GET', 'POST'],
  });
}

/**
 * Handle requests to a specific grant by id:
 *   GET    /api/auth-mgmt/grants/:id  -> grant detail
 *   DELETE /api/auth-mgmt/grants/:id  -> 204 (revoke the grant)
 *
 * PUT/PATCH return 405 because grants are immutable; updating a grant
 * equals revoking and re-granting at the workflow level.
 */
async function handleGrantById(route: Route, request: Request, id: string): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    return respondWithJson(route, 200, { ...DEFAULT_GRANT_DETAIL, id });
  }

  if (method === 'DELETE') {
    return respondWithNoContent(route);
  }

  return respondWithJson(route, 405, {
    error: 'method_not_allowed',
    allowed: ['GET', 'DELETE'],
  });
}

// ---------------------------------------------------------------------------
// Sub-handler: Delegated access
//
// /api/auth-mgmt/delegated-access            GET (list)  POST (grant)
// /api/auth-mgmt/delegated-access/:id        GET (read)  PUT/PATCH (update)
//                                            DELETE (revoke)
//
// Delegated access is a temporary scoped-permission grant from one user
// (delegator) to another (grantee), typically for PTO coverage or
// substitution. The model is similar to grants but supports update
// (e.g., extending the end date) so PUT/PATCH are allowed.
// ---------------------------------------------------------------------------

/**
 * Handle requests to the delegated-access collection endpoint.
 *
 * No canonical fixture file exists for delegated access (per AAP
 * §0.5.1.13 inventory) so this handler always reads from
 * DEFAULT_DELEGATED_ACCESS_LIST.
 */
async function handleDelegatedAccess(route: Route, request: Request, url: URL): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    const baseItems = Array.isArray(DEFAULT_DELEGATED_ACCESS_LIST.data)
      ? (DEFAULT_DELEGATED_ACCESS_LIST.data as Array<Record<string, unknown>>)
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
      id: generateId('da'),
      status: body.status ?? 'active',
      createdAt: nowIso(),
    });
  }

  return respondWithJson(route, 405, {
    error: 'method_not_allowed',
    allowed: ['GET', 'POST'],
  });
}

/**
 * Handle requests to a specific delegated-access grant by id:
 *   GET    /api/auth-mgmt/delegated-access/:id  -> detail
 *   PUT    /api/auth-mgmt/delegated-access/:id  -> update
 *   PATCH  /api/auth-mgmt/delegated-access/:id  -> partial update
 *   DELETE /api/auth-mgmt/delegated-access/:id  -> 204 (revoke)
 */
async function handleDelegatedAccessById(
  route: Route,
  request: Request,
  id: string,
): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    return respondWithJson(route, 200, { ...DEFAULT_DELEGATED_ACCESS_DETAIL, id });
  }

  if (method === 'PUT' || method === 'PATCH') {
    const body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
    return respondWithJson(route, 200, {
      ...DEFAULT_DELEGATED_ACCESS_DETAIL,
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
// Sub-handler: Audit-of-grants
//
// /api/auth-mgmt/audit  GET (paginated list of audit records)
//
// Audit logs are append-only by design: any non-GET method receives 405.
// This matches the production API contract and prevents tests from
// accidentally mutating audit history through the mock layer.
// ---------------------------------------------------------------------------

/**
 * Handle requests to the audit-of-grants endpoint. Supports pagination,
 * search, filter, and sort like every other list endpoint, but rejects
 * all non-GET methods with HTTP 405.
 */
async function handleAudit(route: Route, request: Request, url: URL): Promise<void> {
  const method = request.method().toUpperCase();

  if (method === 'GET') {
    const baseItems = Array.isArray(DEFAULT_AUDIT_LOG.data)
      ? (DEFAULT_AUDIT_LOG.data as Array<Record<string, unknown>>)
      : [];
    let items: Array<Record<string, unknown>> = baseItems;
    items = applySearch(items, url);
    items = applyFilters(items, url);
    items = applySort(items, url);
    return respondWithJson(route, 200, paginate(items, parsePagination(url)));
  }

  return respondWithJson(route, 405, {
    error: 'method_not_allowed',
    allowed: ['GET'],
  });
}

// ---------------------------------------------------------------------------
// Unknown-route handler
// ---------------------------------------------------------------------------

/**
 * Catch-all for requests under `/api/auth-mgmt/...` that the dispatcher
 * does not recognise. Returns HTTP 501 Not Implemented and emits a
 * structured warning so that test authors immediately see which URL
 * lacks coverage instead of silently falling through to network mode.
 */
async function handleUnknown(route: Route, request: Request): Promise<void> {
  console.warn(
    `${LOG_PREFIX} No sub-handler for ${request.method()} ${request.url()}. ` +
      `Returning 501. Add a sub-handler in e2e/mocks/handlers/authorization.handler.ts.`,
  );
  return respondWithJson(route, 501, {
    error: 'not_implemented',
    method: request.method(),
    url: request.url(),
  });
}

// ---------------------------------------------------------------------------
// Public function: authorizationHandler
// ---------------------------------------------------------------------------

/**
 * URL pathname regex used to extract the resource and (optional) entity id
 * from `/api/auth-mgmt/<resource>[/<id>][/<sub-action>]`. Capturing groups:
 *   1: resource (required)         e.g., 'roles'
 *   2: id (optional)               e.g., 'role-admin'
 *   3: sub-action (optional)       reserved for future expansion
 *
 * The third group is captured but not consumed by the dispatcher; it
 * exists so the regex tolerates URLs like `/api/auth-mgmt/roles/role-1/permissions`
 * without rejecting them outright (we route on the first two segments
 * and let the appropriate sub-handler 404 the unknown sub-action).
 */
const PATH_REGEX = /\/api\/auth-mgmt\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?/;

/**
 * Authorization API mock handler. Public entry point invoked by Playwright
 * for any request matching `**\/api/auth-mgmt/**`.
 *
 * Dispatch rules:
 *   1. OPTIONS preflight requests receive 204 with permissive CORS headers.
 *   2. URLs are normalized (trailing slashes stripped) before regex match.
 *   3. The matched resource and (optional) entity id are routed to the
 *      appropriate sub-handler.
 *   4. Unmatched paths and unknown resources receive HTTP 501 with a
 *      structured warning so test authors see exactly which URL is
 *      uncovered.
 *
 * The function is async (returns Promise<void>) to match Playwright's
 * `page.route(url, handler)` callback contract; sub-handlers are also
 * async so all network responses are emitted via `await route.fulfill()`.
 *
 * @param route   Playwright route object; used for `route.fulfill()`.
 * @param request Playwright request metadata; used to read URL/method/body.
 */
export async function authorizationHandler(route: Route, request: Request): Promise<void> {
  const url = new URL(request.url());
  // Strip trailing slashes so `/api/auth-mgmt/roles/` and
  // `/api/auth-mgmt/roles` behave identically.
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

  switch (resource) {
    case 'roles':
      if (id !== undefined) {
        return handleRoleById(route, request, id);
      }
      return handleRoles(route, request, url);

    case 'permissions':
      if (id !== undefined) {
        return handlePermissionById(route, request, id);
      }
      return handlePermissions(route, request, url);

    case 'grants':
      if (id !== undefined) {
        return handleGrantById(route, request, id);
      }
      return handleGrants(route, request, url);

    case 'delegated-access':
      if (id !== undefined) {
        return handleDelegatedAccessById(route, request, id);
      }
      return handleDelegatedAccess(route, request, url);

    case 'audit':
      return handleAudit(route, request, url);

    default:
      return handleUnknown(route, request);
  }
}
