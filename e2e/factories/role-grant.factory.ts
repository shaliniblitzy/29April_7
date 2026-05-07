/**
 * RoleGrant and Permission entity factories for the Whoville-Client
 * Authorization module.
 *
 * Generates entities with `e2e-test-` prefixed names so the live-mode entity
 * sweeper (e2e/utils/test-data-cleanup.ts) can identify orphan test entities
 * for removal per AAP §0.4.4.
 *
 * Uses `@faker-js/faker` (version pinned per AAP §0.6.1: `^9.0.0`).
 *
 * Foundational layer — imports only `@faker-js/faker`. Pure data generation
 * with no I/O, no Node.js built-ins, no other factory dependencies. Each
 * call produces an independent, parallel-safe instance suitable for use by
 * Playwright workers running concurrently.
 *
 * ## Cleanup contract (AAP §0.4.4 — Live-mode database hygiene)
 *
 * The live-mode sweeper (`e2e/utils/test-data-cleanup.ts`) identifies
 * deletion candidates by inspecting the field configured per endpoint:
 *
 *   - For `/api/auth-mgmt/permissions`, `nameField: 'name'` is matched —
 *     therefore `Permission.name` MUST begin with the configured prefix
 *     (default `'e2e-test-'`).
 *   - For `/api/auth-mgmt/role-grants`, `nameField: 'reference'` is matched —
 *     therefore `RoleGrant.reference` MUST begin with the configured prefix.
 *
 * Both factories generate names/references with the `e2e-test-` prefix and
 * a randomized 8-character alphanumeric suffix to guarantee uniqueness
 * across parallel workers (AAP §0.10.1 — "All tests can run independently
 * and in parallel").
 *
 * ## Migration-proof shape (AAP §0.10.1)
 *
 * All exported types use only primitive TypeScript types (`string`, `boolean`,
 * `number`, union literals) and `ReadonlyArray<string>` for collections.
 * No Angular-specific types, no Whoville-Client class references, no
 * runtime decorators. The interfaces are forward-compatible with the
 * Angular 11 → 12 → 13 → … → 21 migration path; HTTP API contract changes
 * (which migrate slowly) are the only events that require updates here.
 *
 * @see AAP §0.5.1.12 — file mandate (Factories, Mocks, and Test Utilities).
 * @see AAP §0.4.4 — Test Data and Fixtures Design (live-mode cleanup).
 * @see AAP §0.10.1 — User-specified directives (parallel-safe, mock-first).
 * @see e2e/pages/authorization/*.page.ts — POM consumers.
 * @see e2e/mocks/handlers/authorization.handler.ts — mock handler consumer.
 * @see e2e/fixtures/api-responses/authorization/*.json — fixture shape references.
 * @see e2e/utils/test-data-cleanup.ts — live-mode sweeper that relies on
 *      the `e2e-test-` prefix to identify deletion candidates.
 */

// ---------------------------------------------------------------------------
// Imports — strictly limited to `@faker-js/faker` per the e2e/factories/
// foundational-layer constraint. No imports from `@fixtures`, `@pages`,
// `@patterns`, `@mocks`, `@utils`, sibling factory files, or Node.js built-ins.
// ---------------------------------------------------------------------------

import { faker } from '@faker-js/faker';

// ---------------------------------------------------------------------------
// Public type definitions
// ---------------------------------------------------------------------------

/**
 * Action verbs supported by the Whoville-Client RBAC system.
 *
 * Closed union (not an open `string` type) to provide compile-time safety:
 * test code that overrides `action` with a typo (e.g., `action: 'unknwn'`)
 * fails at compile time rather than producing a confusing runtime mismatch.
 *
 * - `'read'`    — View data without modification.
 * - `'write'`   — Modify existing data (rename, attribute changes).
 * - `'create'`  — Create new entities.
 * - `'delete'`  — Remove existing entities.
 * - `'admin'`   — Full administrative access (super-user privileges).
 * - `'approve'` — Approve workflow steps (transfers, leave requests, etc.).
 * - `'audit'`   — View audit logs and historical grant records.
 */
export type PermissionAction =
  | 'read'
  | 'write'
  | 'create'
  | 'delete'
  | 'admin'
  | 'approve'
  | 'audit';

/**
 * Lifecycle status of a role grant.
 *
 * Closed union for the same compile-time-safety reason as
 * {@link PermissionAction}.
 *
 * - `'active'`  — Currently in effect; the user has the role's permissions.
 * - `'revoked'` — Manually revoked before expiry (`revokedAt` and
 *                 `revokedById` are populated when this status applies).
 * - `'expired'` — Past the configured `expiresAt` timestamp.
 * - `'pending'` — Awaiting approval (typically for delegated-access flows).
 */
export type RoleGrantStatus = 'active' | 'revoked' | 'expired' | 'pending';

/**
 * Permission entity. Represents a single (resource, action) tuple in the
 * Whoville-Client RBAC system.
 *
 * Migration-proof shape: primitive types only. No nested complex objects,
 * no class references, no Angular-specific types.
 *
 * Field stability:
 *   - `id` and `name` are stable identifiers consumers rely on for cleanup.
 *   - `resource` follows the `<module>.<subResource>` hierarchical
 *     dotted-notation convention used industry-wide for RBAC paths.
 *   - `system` distinguishes built-in (cannot-be-edited) permissions from
 *     custom (user-defined) ones — a distinction the UI surfaces.
 *
 * @see AAP §0.5.1.13 — `e2e/fixtures/api-responses/authorization/permissions-list.json`
 *      mirrors this shape for paginated list responses.
 */
export interface Permission {
  /** UUID identifier (RFC 4122 v4). */
  readonly id: string;
  /**
   * `e2e-test-` prefixed name for live-mode cleanup eligibility.
   *
   * Format: `e2e-test-<resource>.<action>-<8-char-suffix>` (e.g.
   * `'e2e-test-workforce.teams.read-x7y8a3bc'`). The prefix is the
   * sentinel value the live-mode sweeper matches; the suffix guarantees
   * uniqueness across parallel workers.
   */
  readonly name: string;
  /**
   * Resource path / scope, hierarchical dotted notation.
   *
   * Format: `<module>.<subResource>` where `<module>` is one of the
   * Whoville-Client module identifiers and `<subResource>` is a CRUD
   * entity slug (e.g., `'workforce.teams'`, `'assessments.cycles'`,
   * `'authorization.roles'`).
   */
  readonly resource: string;
  /** Action verb (closed union — see {@link PermissionAction}). */
  readonly action: PermissionAction;
  /**
   * Optional human-readable description of what this permission grants.
   * UI surfaces this in permission-detail views and audit-log entries.
   */
  readonly description?: string;
  /**
   * Whether this is a system-defined (built-in) permission or a custom
   * (user-defined) one. System permissions cannot be edited or deleted;
   * the UI typically renders them with a distinct icon or badge.
   */
  readonly system: boolean;
  /** ISO 8601 timestamp of creation (e.g., `'2025-04-12T08:30:00.000Z'`). */
  readonly createdAt: string;
  /** ISO 8601 timestamp of last update. Optional — absent for never-modified rows. */
  readonly updatedAt?: string;
}

/**
 * Role grant entity. Represents the assignment of a role to a user, with
 * optional expiry and revocation tracking.
 *
 * Migration-proof shape: primitive types and arrays of UUID strings only.
 * Cross-factory relationships (`userId`, `roleId`, `grantedById`,
 * `revokedById`, `permissionIds`) are stored as UUID strings rather than
 * nested objects to keep this factory at the foundational layer (no
 * sibling-factory imports).
 *
 * Field stability:
 *   - `id` and `reference` are stable identifiers; `reference` is the
 *     cleanup-eligibility marker.
 *   - `roleName` is a snapshot captured at grant time so audit logs remain
 *     accurate even if the underlying role is later renamed.
 *   - Status-conditional fields (`revokedAt`, `revokedById`) are populated
 *     only when `status === 'revoked'`; otherwise they are `null` /
 *     `undefined` respectively.
 *
 * @see AAP §0.5.1.13 — `e2e/fixtures/api-responses/authorization/role-grants.json`
 *      mirrors this shape for paginated list responses.
 */
export interface RoleGrant {
  /** UUID identifier (RFC 4122 v4). */
  readonly id: string;
  /**
   * `e2e-test-grant-` prefixed reference label for live-mode cleanup
   * eligibility. Format: `e2e-test-grant-<role-slug>-<8-char-suffix>`
   * (e.g., `'e2e-test-grant-admin-x7y8a3bc'`).
   */
  readonly reference: string;
  /** UUID of the user receiving the role. */
  readonly userId: string;
  /** UUID of the role being granted. */
  readonly roleId: string;
  /**
   * Display name of the role at the time the grant was created. Snapshot
   * field — audit log accuracy is preserved even if the underlying role
   * is later renamed.
   */
  readonly roleName: string;
  /**
   * UUIDs of permissions associated with this role at grant time.
   *
   * `ReadonlyArray<string>` rather than `string[]` to communicate at the
   * type level that consumers must not mutate the array; immutability is
   * the factory's contract.
   */
  readonly permissionIds: ReadonlyArray<string>;
  /** UUID of the user who granted the role. */
  readonly grantedById: string;
  /** Current lifecycle status (closed union — see {@link RoleGrantStatus}). */
  readonly status: RoleGrantStatus;
  /** ISO 8601 timestamp when the grant takes effect. */
  readonly grantedAt: string;
  /**
   * ISO 8601 timestamp when the grant expires. `null` for permanent grants
   * (e.g., owner roles, system service accounts).
   */
  readonly expiresAt: string | null;
  /**
   * ISO 8601 timestamp when the grant was revoked. `null` if the grant has
   * not been revoked (i.e., status is one of `'active'`, `'expired'`,
   * `'pending'`).
   */
  readonly revokedAt: string | null;
  /**
   * UUID of the user who revoked the grant. Optional — present only when
   * `status === 'revoked'`. Absent (undefined) for grants that have never
   * been revoked, matching typical JSON serialization where missing fields
   * are omitted from the wire payload.
   */
  readonly revokedById?: string;
  /**
   * Optional reason / justification for the grant. Populated for grants
   * created via workflows that prompt for justification (e.g., delegated
   * access, sensitive-role escalation); absent otherwise.
   */
  readonly reason?: string;
  /**
   * Whether this grant was created via the delegated-access feature
   * (`true`) or via the standard role-assignment flow (`false`).
   */
  readonly delegated: boolean;
}

// ---------------------------------------------------------------------------
// Internal constants — file-local; not exported.
//
// Centralised here so changes to canonical RBAC vocabulary (modules,
// sub-resources, role names) can be made in one place without touching
// factory body logic. The constants are `as const` to preserve literal
// types where used by `faker.helpers.arrayElement<T>()`.
// ---------------------------------------------------------------------------

/**
 * Canonical Whoville-Client module identifiers.
 *
 * Mirrors the AAP §0.3.1 functional-area decomposition (App Core + 4
 * lazy-loaded modules). Used to build `Permission.resource` paths in the
 * `<module>.<subResource>` format.
 */
const MODULE_IDENTIFIERS = [
  'workforce',
  'assessments',
  'competencies',
  'authorization',
  'app-core',
] as const;

/**
 * Canonical sub-resource slugs spanning the four lazy modules + App Core.
 *
 * Drawn from the entities enumerated in AAP §0.5.1.4 through §0.5.1.7
 * (Page Object Model breakdowns). Cross-module — any combination of
 * `<module>.<subResource>` may be syntactically valid in the RBAC system,
 * even when the combination doesn't map to a real route (this matches the
 * permissive grammar of typical RBAC engines).
 */
const SUB_RESOURCE_SLUGS = [
  'teams',
  'assignments',
  'schedules',
  'templates',
  'cycles',
  'responses',
  'catalog',
  'skills',
  'roles',
  'permissions',
  'audit',
] as const;

/**
 * Closed list of values emitted for `PermissionAction`. Kept in lock-step
 * with the type union above; if a new action is added to the type, append
 * it here too.
 */
const PERMISSION_ACTIONS: ReadonlyArray<PermissionAction> = [
  'read',
  'write',
  'create',
  'delete',
  'admin',
  'approve',
  'audit',
];

/**
 * Weighted distribution for `RoleGrantStatus`. `'active'` appears three
 * times to give it ~50 % probability when sampled by
 * `faker.helpers.arrayElement` — matching production reality where most
 * grants in any RBAC system are currently active. Tests that need a
 * specific status override the field directly.
 */
const ROLE_GRANT_STATUS_DISTRIBUTION: ReadonlyArray<RoleGrantStatus> = [
  'active',
  'active',
  'active',
  'revoked',
  'expired',
  'pending',
];

/**
 * Canonical role display names. Single-token PascalCase strings — matches
 * typical RBAC role naming where names are human-readable labels rather
 * than full sentences. Used as the snapshot value for `RoleGrant.roleName`.
 */
const CANONICAL_ROLE_NAMES = [
  'Admin',
  'Manager',
  'Viewer',
  'Auditor',
  'Operator',
  'Analyst',
] as const;

/** Common prefix applied to every entity name / reference for cleanup eligibility. */
const E2E_TEST_PREFIX = 'e2e-test-';

/** Length of the random alphanumeric uniqueness suffix appended to names/references. */
const UNIQUE_SUFFIX_LENGTH = 8;

/** Probability (0–1) that a generated permission is system-defined. */
const PROBABILITY_SYSTEM_PERMISSION = 0.7;

/** Probability (0–1) that a generated grant has a non-null `expiresAt`. */
const PROBABILITY_GRANT_HAS_EXPIRY = 0.75;

/** Probability (0–1) that a generated grant carries a `reason`. */
const PROBABILITY_GRANT_HAS_REASON = 0.5;

/** Probability (0–1) that a generated grant is delegated. */
const PROBABILITY_GRANT_IS_DELEGATED = 0.2;

/** Lookback window (days) for `createdAt` / `grantedAt` timestamps. */
const RECENT_DAYS_CREATED = 365;

/** Lookback window (days) for `updatedAt` timestamps. */
const RECENT_DAYS_UPDATED = 30;

/** Lookback window (days) for grants — typical staging-data freshness window. */
const RECENT_DAYS_GRANT = 180;

/** Forward window (years) used as the upper bound for `expiresAt`. */
const FUTURE_YEARS_EXPIRY = 1;

/** Minimum number of permissions packaged into a generated role grant. */
const MIN_PERMISSIONS_PER_GRANT = 1;

/** Maximum number of permissions packaged into a generated role grant. */
const MAX_PERMISSIONS_PER_GRANT = 10;

/** Minimum word count for `lorem.sentence` description / reason values. */
const MIN_DESCRIPTION_WORDS = 4;
const MIN_REASON_WORDS = 5;

/** Maximum word count for `lorem.sentence` description / reason values. */
const MAX_DESCRIPTION_WORDS = 10;
const MAX_REASON_WORDS = 15;

// ---------------------------------------------------------------------------
// Determinism anchor (per AAP §0.4.4)
//
// Faker's `date.*` API family — `recent`, `between`, `anytime`, `future`,
// `past` — defaults `refDate` to `new Date()` (the wall-clock). Successive
// invocations under the SAME seed therefore produce ms-level drift in any
// generated ISO timestamp, breaking the byte-identical reproducibility that
// the AAP §0.4.4 contract requires ("randomized but deterministic
// (seedable) entity instances"). QA Issue #3 reproduced this defect at
// ~10% rate.
//
// The fix: derive a date anchor purely from the seeded RNG via
// `faker.number.int()` over a FIXED epoch-millisecond range that does not
// reference `Date.now()` / `new Date()` at all. The two constants below
// span 2020-01-01 → 2030-12-31 UTC, a window large enough to produce
// realistic-looking timestamps for the lifetime of this test suite without
// ever depending on the wall-clock.
//
// All `faker.date.*` calls in the factories below pass an explicit
// `refDate: dateAnchor` (or use the anchor directly as a `to` / `from`
// bound) so the entire date-generation graph is seed-deterministic.
// ---------------------------------------------------------------------------

/** Lower bound of the deterministic date anchor: 2020-01-01T00:00:00.000Z. */
const ANCHOR_MIN_EPOCH_MS = Date.UTC(2020, 0, 1);

/** Upper bound of the deterministic date anchor: 2030-12-31T00:00:00.000Z. */
const ANCHOR_MAX_EPOCH_MS = Date.UTC(2030, 11, 31);

/**
 * Generate a seed-deterministic `Date` anchor without consulting the
 * wall-clock. Used as the `refDate` argument to every `faker.date.*` call
 * in this file so the resulting timestamps are byte-identical across
 * same-seed invocations.
 *
 * @returns A `Date` in the [2020-01-01, 2030-12-31] UTC interval.
 */
function deterministicDateAnchor(): Date {
  return new Date(faker.number.int({ min: ANCHOR_MIN_EPOCH_MS, max: ANCHOR_MAX_EPOCH_MS }));
}

// ---------------------------------------------------------------------------
// Public factories
// ---------------------------------------------------------------------------

/**
 * Generate a {@link Permission} instance with sensible defaults and optional
 * overrides.
 *
 * Each invocation produces an independent, parallel-safe instance:
 *   - `id` is a fresh RFC 4122 v4 UUID.
 *   - `name` carries the `e2e-test-` prefix and an 8-character random
 *     suffix to guarantee uniqueness across parallel workers.
 *   - `resource` is a randomly-selected `<module>.<subResource>` path drawn
 *     from the canonical Whoville-Client vocabulary.
 *   - `action` is randomly selected from the closed {@link PermissionAction}
 *     union.
 *   - `system` is `true` ~70 % of the time (reflecting production reality
 *     where most permissions are built-in).
 *
 * The trailing `...overrides` spread enables targeted customisation without
 * having to construct the full object — a common pattern in test code:
 *
 * @example Default permission:
 * ```ts
 * const perm = permissionFactory();
 * // -> {
 * //      id: '7c5b1f3a-...',
 * //      name: 'e2e-test-workforce.teams.read-a3b8x2pq',
 * //      resource: 'workforce.teams',
 * //      action: 'read',
 * //      description: '...',
 * //      system: true,
 * //      createdAt: '2025-...',
 * //      updatedAt: '2026-...'
 * //    }
 * ```
 *
 * @example Targeted override (admin permission on the roles resource):
 * ```ts
 * const adminOnRoles = permissionFactory({
 *   action: 'admin',
 *   resource: 'authorization.roles',
 *   system: true,
 * });
 * ```
 *
 * @example Custom (non-system) permission:
 * ```ts
 * const custom = permissionFactory({ system: false });
 * ```
 *
 * @param overrides Partial fields to override on the generated instance.
 *                  Defaults to an empty object.
 * @returns A fully-populated {@link Permission} object.
 */
export function permissionFactory(overrides: Partial<Permission> = {}): Permission {
  // Build a `<module>.<subResource>` resource path from canonical Whoville-Client
  // vocabulary. Random pairing produces realistic but varied test data without
  // requiring callers to know all valid combinations up front.
  const moduleId = faker.helpers.arrayElement(MODULE_IDENTIFIERS);
  const subResource = faker.helpers.arrayElement(SUB_RESOURCE_SLUGS);
  const resource = `${moduleId}.${subResource}`;

  // Random action drawn from the closed union — type-safe at compile time.
  const action: PermissionAction = faker.helpers.arrayElement<PermissionAction>(PERMISSION_ACTIONS);

  // 8-character lowercase alphanumeric suffix guarantees uniqueness across
  // parallel test workers (256^8 ≈ 1.8e19 possible suffixes per resource+action
  // combination). Combined with the resource path and action, collisions are
  // effectively impossible within a single test-suite run.
  const uniqueSuffix = faker.string.alphanumeric({
    length: UNIQUE_SUFFIX_LENGTH,
    casing: 'lower',
  });
  const name = `${E2E_TEST_PREFIX}${resource}.${action}-${uniqueSuffix}`;

  // `createdAt` is generated first; `updatedAt` is constrained to a more
  // recent window so the (createdAt <= updatedAt) invariant holds for the
  // vast majority of generated rows. Tests that care about strict ordering
  // override one or both fields.
  //
  // Determinism guarantee (per AAP §0.4.4 — "deterministic (seedable) entity
  // instances"): every `faker.date.*` call uses an explicit `refDate` anchored
  // to a seed-deterministic timestamp produced by `deterministicDateAnchor()`.
  // The default `refDate: new Date()` would otherwise read the wall-clock —
  // which changes between successive seeded invocations and produces 1ms-level
  // drift in `createdAt` / `updatedAt`, breaking byte-identical reproducibility.
  // QA Issue #3 reproduced this defect at ~10% rate; this anchor pattern is
  // the contained fix that achieves 100% same-seed reproducibility.
  const dateAnchor = deterministicDateAnchor();
  const createdAt = faker.date
    .recent({ days: RECENT_DAYS_CREATED, refDate: dateAnchor })
    .toISOString();
  const updatedAt = faker.date
    .recent({ days: RECENT_DAYS_UPDATED, refDate: dateAnchor })
    .toISOString();

  // Description: short lorem-ipsum sentence — realistic prose without
  // requiring a real corpus. Length is bounded so descriptions render
  // reasonably in list-view UI without truncation.
  const description = faker.lorem.sentence({
    min: MIN_DESCRIPTION_WORDS,
    max: MAX_DESCRIPTION_WORDS,
  });

  // System probability of 0.7 matches typical production RBAC distributions
  // where most permissions are built-in and only a minority are
  // organisation-defined custom permissions.
  const system = faker.datatype.boolean({ probability: PROBABILITY_SYSTEM_PERMISSION });

  return {
    id: faker.string.uuid(),
    name,
    resource,
    action,
    description,
    system,
    createdAt,
    updatedAt,
    ...overrides,
  };
}

/**
 * Generate a {@link RoleGrant} instance with sensible defaults and optional
 * overrides.
 *
 * Each invocation produces an independent, parallel-safe instance with
 * internally-consistent status-conditional fields:
 *
 *   - `id` and all `*Id` fields are fresh RFC 4122 v4 UUIDs.
 *   - `reference` carries the `e2e-test-grant-` prefix and an 8-character
 *     random suffix.
 *   - `roleName` is a snapshot from the canonical role-name vocabulary.
 *   - `status` is weighted to 50 % `'active'`, with the remaining 50 %
 *     spread evenly across `'revoked'`, `'expired'`, `'pending'`.
 *   - `expiresAt` is non-null with 75 % probability; when present, it is
 *     guaranteed to be later than `grantedAt` via `faker.date.future` with
 *     `refDate` anchored to `grantedAt`.
 *   - `revokedAt` and `revokedById` are populated **only** when
 *     `status === 'revoked'`; otherwise they are `null` / `undefined`.
 *     `revokedAt` is guaranteed to fall in the (grantedAt, now] interval.
 *   - `permissionIds` is an array of 1–10 fresh UUIDs (representing the
 *     permissions packaged into the role at grant time).
 *   - `delegated` is `true` ~20 % of the time (delegated access is the
 *     less common code path in production RBAC).
 *
 * @example Default grant:
 * ```ts
 * const grant = roleGrantFactory();
 * ```
 *
 * @example Grant scoped to a specific user and role:
 * ```ts
 * const grant = roleGrantFactory({
 *   userId: knownUser.id,
 *   roleId: knownRole.id,
 *   roleName: knownRole.name,
 * });
 * ```
 *
 * @example Revoked grant for testing audit-of-grants UI:
 * ```ts
 * const revoked = roleGrantFactory({ status: 'revoked' });
 * // revoked.revokedAt is non-null; revoked.revokedById is defined.
 * ```
 *
 * @example Permanent grant (no expiry):
 * ```ts
 * const permanent = roleGrantFactory({ expiresAt: null });
 * ```
 *
 * @param overrides Partial fields to override on the generated instance.
 *                  Defaults to an empty object. When overriding `status`,
 *                  callers should consider also overriding `revokedAt` /
 *                  `revokedById` to avoid producing an internally-inconsistent
 *                  grant (e.g., `status: 'revoked'` with `revokedAt: null`).
 * @returns A fully-populated {@link RoleGrant} object.
 */
export function roleGrantFactory(overrides: Partial<RoleGrant> = {}): RoleGrant {
  // Snapshot the role name at grant time, then build a slug-safe lowercase
  // form for the reference (mirrors typical kebab-case URL slug conventions).
  const roleName = faker.helpers.arrayElement(CANONICAL_ROLE_NAMES);
  const uniqueSuffix = faker.string.alphanumeric({
    length: UNIQUE_SUFFIX_LENGTH,
    casing: 'lower',
  });
  const reference = `${E2E_TEST_PREFIX}grant-${roleName.toLowerCase()}-${uniqueSuffix}`;

  // Weighted random status — `'active'` is over-represented in the
  // distribution array to bias generated data towards the production-realistic
  // case (most grants in any RBAC system are currently active). Tests that
  // need a specific status override.
  const status: RoleGrantStatus = faker.helpers.arrayElement<RoleGrantStatus>(
    ROLE_GRANT_STATUS_DISTRIBUTION,
  );

  // Capture grantedDate as a `Date` (rather than just the ISO string) so
  // subsequent date generators can use it as `refDate` to enforce
  // chronological invariants (`grantedAt < expiresAt`, `grantedAt < revokedAt`).
  //
  // Determinism guarantee (per AAP §0.4.4): the underlying lookback uses an
  // explicit `refDate` anchored to a seed-deterministic timestamp produced
  // by `deterministicDateAnchor()`, NOT the wall-clock. See the equivalent
  // comment in `permissionFactory` above for the full rationale. The same
  // anchor is reused below as the upper bound for `revokedAt` so its
  // (grantedDate, anchor] interval is also seed-deterministic.
  const dateAnchor = deterministicDateAnchor();
  const grantedDate = faker.date.recent({ days: RECENT_DAYS_GRANT, refDate: dateAnchor });
  const grantedAt = grantedDate.toISOString();

  // Most grants have expiry (security best practice — time-bounded grants
  // limit blast radius if credentials leak); some are permanent. The 75 %
  // expiry probability matches typical configurations.
  //
  // When generating an expiry, anchor `faker.date.future` to `grantedDate`
  // so the resulting timestamp is guaranteed to be later than `grantedAt`.
  const hasExpiry = faker.datatype.boolean({ probability: PROBABILITY_GRANT_HAS_EXPIRY });
  const expiresAt = hasExpiry
    ? faker.date.future({ years: FUTURE_YEARS_EXPIRY, refDate: grantedDate }).toISOString()
    : null;

  // Status-conditional fields: only revoked grants carry revocation metadata.
  // `revokedAt` falls strictly within (grantedDate, dateAnchor] via
  // faker.date.between. Using `dateAnchor` (the seed-deterministic
  // `faker.date.anytime()` timestamp) as the upper bound — rather than
  // `new Date()` — preserves byte-identical reproducibility across seeded
  // invocations. The chronological invariant `grantedDate < revokedAt <= dateAnchor`
  // continues to hold because both bounds are derived from the same seeded
  // RNG stream.
  let revokedAt: string | null = null;
  let revokedById: string | undefined;
  if (status === 'revoked') {
    revokedAt = faker.date.between({ from: grantedDate, to: dateAnchor }).toISOString();
    revokedById = faker.string.uuid();
  }

  // Generate 1–10 permission UUIDs for the role's bundle. Larger bundles
  // are unusual edge cases; tests modelling oversized roles should override
  // `permissionIds` directly.
  const permissionCount = faker.number.int({
    min: MIN_PERMISSIONS_PER_GRANT,
    max: MAX_PERMISSIONS_PER_GRANT,
  });
  const permissionIds: ReadonlyArray<string> = Array.from({ length: permissionCount }, () =>
    faker.string.uuid(),
  );

  // ~50 % of grants document a justification reason. The remainder leave it
  // undefined (matching typical production data where many grants are
  // routine and don't require explicit reasons).
  const reason = faker.datatype.boolean({ probability: PROBABILITY_GRANT_HAS_REASON })
    ? faker.lorem.sentence({ min: MIN_REASON_WORDS, max: MAX_REASON_WORDS })
    : undefined;

  // Delegated access is a less common feature; only ~20 % of grants are
  // delegated in typical production data.
  const delegated = faker.datatype.boolean({ probability: PROBABILITY_GRANT_IS_DELEGATED });

  return {
    id: faker.string.uuid(),
    reference,
    userId: faker.string.uuid(),
    roleId: faker.string.uuid(),
    roleName,
    permissionIds,
    grantedById: faker.string.uuid(),
    status,
    grantedAt,
    expiresAt,
    revokedAt,
    revokedById,
    reason,
    delegated,
    ...overrides,
  };
}
