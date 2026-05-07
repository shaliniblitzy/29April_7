/**
 * User entity factory for the Whoville-Client App Core authentication
 * surface and for cross-cutting role-based access control (RBAC) testing.
 *
 * Generates entities with `e2e-test-` prefixed display names and
 * `e2e-test-` prefixed username slugs so the live-mode entity sweeper
 * (e2e/utils/test-data-cleanup.ts) can identify orphan test entities for
 * removal per AAP §0.4.4.
 *
 * Uses `@faker-js/faker` (version pinned per AAP §0.6.1: `^9.0.0`).
 *
 * Foundational layer — imports only `@faker-js/faker`. Pure data
 * generation with no I/O, no Node.js built-ins, no other factory
 * dependencies (no sibling-factory imports per AAP §0.10.1). Each call
 * produces an independent, parallel-safe instance suitable for use by
 * Playwright workers running concurrently.
 *
 * ## Cleanup contract (AAP §0.4.4 — Live-mode database hygiene)
 *
 * The live-mode sweeper identifies deletion candidates by inspecting the
 * `displayName` and `username` fields. Both fields begin with the
 * configured `e2e-test-` prefix (default), and a randomized 8-character
 * alphanumeric suffix guarantees uniqueness across parallel workers per
 * AAP §0.10.1 ("All tests can run independently and in parallel").
 *
 * ## Migration-proof shape (AAP §0.10.1)
 *
 * All exported types use only primitive TypeScript types and
 * `ReadonlyArray<string>` for collections. No Angular-specific types, no
 * Whoville-Client class references, no runtime decorators. The interfaces
 * are forward-compatible with the Angular 11 → 12 → 13 → … → 21 migration
 * path; HTTP API contract changes are the only events that require
 * updates here.
 *
 * ## Determinism (AAP §0.4.4)
 *
 * All `faker.date.*` calls use a seed-deterministic `refDate` produced by
 * `deterministicDateAnchor()`. Faker's default `refDate: new Date()`
 * would otherwise read the wall-clock and break byte-identical
 * reproducibility across same-seed invocations. See QA Issue #3 for the
 * defect this avoids.
 *
 * @see AAP §0.5.1.12 — file mandate (Factories, Mocks, and Test Utilities).
 * @see AAP §0.4.4 — Test Data and Fixtures Design (live-mode cleanup,
 *      determinism contract).
 * @see AAP §0.10.1 — User-specified directives (parallel-safe, mock-first,
 *      migration-proof field names).
 * @see e2e/pages/app-shell/login.page.ts — POM consumer (login flow).
 * @see e2e/mocks/handlers/auth.handler.ts — mock handler consumer.
 * @see e2e/fixtures/api-responses/auth/me.json — fixture shape reference.
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
 * Canonical user roles within the Whoville-Client RBAC system.
 *
 * Closed union for compile-time safety: test code that overrides
 * `roles` with a typo (e.g., `'admiin'`) fails at compile time rather
 * than producing a confusing runtime mismatch.
 *
 * - `'admin'`        — Full administrative access across all modules.
 * - `'manager'`      — Approve workflows, manage team-scoped resources.
 * - `'viewer'`       — Read-only across the surface they have access to.
 * - `'auditor'`      — Read access plus audit-log visibility.
 * - `'operator'`     — Day-to-day operations within a single module.
 * - `'analyst'`      — Reporting and read-mostly access patterns.
 * - `'restricted'`   — Sentinel role for negative-path RBAC tests.
 */
export type UserRole =
  | 'admin'
  | 'manager'
  | 'viewer'
  | 'auditor'
  | 'operator'
  | 'analyst'
  | 'restricted';

/**
 * User account lifecycle status.
 *
 * Closed union for compile-time safety.
 *
 * - `'active'`   — Currently able to authenticate and use the application.
 * - `'inactive'` — Temporarily disabled (e.g., extended leave).
 * - `'locked'`   — Locked out due to security policy (e.g., failed-login
 *                  threshold, password expiry, suspicious activity).
 * - `'pending'`  — Account provisioned but never activated; common in SSO
 *                  flows where the user has not yet completed first-login.
 */
export type UserStatus = 'active' | 'inactive' | 'locked' | 'pending';

/**
 * User entity. Represents an authenticated identity in the
 * Whoville-Client App Core authentication surface.
 *
 * Migration-proof shape: primitive types only. No nested complex
 * objects beyond `ReadonlyArray<UserRole>` for the closed-union role
 * collection.
 *
 * Field stability:
 *   - `id` and `username` are stable identifiers. `username` follows
 *     the `e2e-test-<slug>-<suffix>` convention so the live-mode
 *     sweeper recognises it as a cleanup candidate.
 *   - `email` is generated with the `@e2e.whoville.example.internal`
 *     domain — a non-routable internal sentinel that never reaches a
 *     real mailbox even if a buggy live-mode call accidentally
 *     dispatches a notification.
 *   - `displayName` is a human-readable label suitable for surfacing
 *     in UI; it carries the `e2e-test-` prefix to make orphans
 *     visually identifiable in admin tooling.
 *   - `roles` is a `ReadonlyArray<UserRole>` to communicate at the
 *     type level that consumers must not mutate the array.
 *
 * @see AAP §0.5.1.13 — `e2e/fixtures/api-responses/auth/me.json` mirrors
 *      this shape for the `/api/auth/me` response.
 */
export interface User {
  /** UUID identifier (RFC 4122 v4). */
  readonly id: string;
  /**
   * `e2e-test-` prefixed slug usable as a login username.
   *
   * Format: `e2e-test-<role-slug>-<8-char-suffix>` (e.g.,
   * `'e2e-test-admin-x7y8a3bc'`). The prefix is the sentinel value
   * the live-mode sweeper matches; the suffix guarantees uniqueness
   * across parallel workers.
   */
  readonly username: string;
  /**
   * `e2e-test-` prefixed display name suitable for UI rendering.
   *
   * Format: `e2e-test-<First> <Last> (<role>)` (e.g.,
   * `'e2e-test-Avery Sloan (admin)'`).
   */
  readonly displayName: string;
  /**
   * Email address using the `@e2e.whoville.example.internal` domain.
   *
   * The domain is a non-routable internal sentinel: even if a buggy
   * live-mode test accidentally fires off a real notification, the
   * email cannot escape the test environment.
   */
  readonly email: string;
  /**
   * Roles assigned to this user. `ReadonlyArray<UserRole>` rather than
   * `UserRole[]` to communicate at the type level that consumers must
   * not mutate the array.
   *
   * Most users carry exactly one role; a small minority carry two for
   * cross-module-permission test scenarios (e.g., manager + auditor).
   */
  readonly roles: ReadonlyArray<UserRole>;
  /** Current account status (closed union — see {@link UserStatus}). */
  readonly status: UserStatus;
  /**
   * Optional first name. Realistic prose generated by faker so display
   * UI renders naturally; `displayName` is the canonical identifier
   * surfaced in lists and audit logs.
   */
  readonly firstName?: string;
  /**
   * Optional last name. Realistic prose generated by faker.
   */
  readonly lastName?: string;
  /**
   * UUID of the team the user belongs to. `null` for users not assigned
   * to a team (e.g., directly-managed roles like 'admin' that operate
   * across all teams). Cross-factory relationship stored as a UUID
   * string rather than a nested object to keep this factory at the
   * foundational layer.
   */
  readonly teamId: string | null;
  /** ISO 8601 timestamp of account creation. */
  readonly createdAt: string;
  /** ISO 8601 timestamp of last update. Optional — absent for never-modified accounts. */
  readonly updatedAt?: string;
  /**
   * ISO 8601 timestamp of last successful login. `null` for accounts
   * that have never logged in (typically `status === 'pending'`).
   */
  readonly lastLoginAt: string | null;
}

// ---------------------------------------------------------------------------
// Internal constants — file-local; not exported.
// ---------------------------------------------------------------------------

/** Common prefix applied to every entity name / username for cleanup eligibility. */
const E2E_TEST_PREFIX = 'e2e-test-';

/** Length of the random alphanumeric uniqueness suffix. */
const UNIQUE_SUFFIX_LENGTH = 8;

/**
 * Non-routable internal sentinel domain for generated email addresses.
 * Even if a buggy live-mode test accidentally dispatches a real
 * notification, the email cannot escape the test environment.
 */
const E2E_EMAIL_DOMAIN = 'e2e.whoville.example.internal';

/**
 * Closed list of values emitted for `UserRole`. Kept in lock-step with
 * the type union above; if a new role is added to the type, append it
 * here too.
 */
const USER_ROLES: ReadonlyArray<UserRole> = [
  'admin',
  'manager',
  'viewer',
  'auditor',
  'operator',
  'analyst',
  'restricted',
];

/**
 * Weighted distribution for `UserStatus`. `'active'` appears five times
 * to give it ~70 % probability when sampled by
 * `faker.helpers.arrayElement` — matching production reality where most
 * accounts are currently active. Tests that need a specific status
 * override the field directly.
 */
const USER_STATUS_DISTRIBUTION: ReadonlyArray<UserStatus> = [
  'active',
  'active',
  'active',
  'active',
  'active',
  'inactive',
  'locked',
  'pending',
];

/** Probability (0–1) that a generated user has a non-null `lastLoginAt`. */
const PROBABILITY_HAS_LOGIN_HISTORY = 0.85;

/** Probability (0–1) that a generated user is assigned to a team. */
const PROBABILITY_HAS_TEAM = 0.8;

/** Probability (0–1) that a generated user carries a second role. */
const PROBABILITY_HAS_MULTIPLE_ROLES = 0.15;

/** Lookback window (days) for `createdAt` timestamps. */
const RECENT_DAYS_CREATED = 730;

/** Lookback window (days) for `updatedAt` timestamps. */
const RECENT_DAYS_UPDATED = 60;

/** Lookback window (days) for `lastLoginAt` timestamps. */
const RECENT_DAYS_LAST_LOGIN = 14;

// ---------------------------------------------------------------------------
// Determinism anchor (per AAP §0.4.4)
//
// See e2e/factories/role-grant.factory.ts for the full rationale. The
// short version: faker's `date.*` API defaults `refDate` to `new Date()`,
// which reads the wall-clock and breaks byte-identical reproducibility
// across same-seed invocations. The two constants below span 2020-01-01
// → 2030-12-31 UTC, a window large enough to produce realistic-looking
// timestamps for the lifetime of this test suite without ever depending
// on the wall-clock.
// ---------------------------------------------------------------------------

/** Lower bound of the deterministic date anchor: 2020-01-01T00:00:00.000Z. */
const ANCHOR_MIN_EPOCH_MS = Date.UTC(2020, 0, 1);

/** Upper bound of the deterministic date anchor: 2030-12-31T00:00:00.000Z. */
const ANCHOR_MAX_EPOCH_MS = Date.UTC(2030, 11, 31);

/**
 * Generate a seed-deterministic `Date` anchor without consulting the
 * wall-clock. Used as the `refDate` argument to every `faker.date.*` call
 * in this file so the resulting timestamps are byte-identical across
 * same-seed invocations (per AAP §0.4.4).
 */
function deterministicDateAnchor(): Date {
  return new Date(faker.number.int({ min: ANCHOR_MIN_EPOCH_MS, max: ANCHOR_MAX_EPOCH_MS }));
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Generate a {@link User} instance with sensible defaults and optional
 * overrides.
 *
 * Each invocation produces an independent, parallel-safe instance:
 *   - `id` is a fresh RFC 4122 v4 UUID.
 *   - `username` carries the `e2e-test-` prefix and an 8-character
 *     random suffix to guarantee uniqueness across parallel workers.
 *   - `displayName` is a realistic-looking label suitable for UI
 *     rendering, with the `e2e-test-` prefix preserved.
 *   - `email` uses the non-routable sentinel domain
 *     `@e2e.whoville.example.internal`.
 *   - `roles` is randomly drawn from the closed {@link UserRole} union;
 *     ~85 % of users have a single role, ~15 % carry two roles for
 *     multi-role test scenarios.
 *   - `status` is weighted so ~70 % of users are `'active'`, matching
 *     production-realistic distributions.
 *   - `lastLoginAt` is non-null for ~85 % of users; pending accounts
 *     and a small fraction of inactive accounts have `null`.
 *   - `teamId` is non-null for ~80 % of users; admins and similar
 *     cross-cutting roles typically have `null`.
 *
 * @example Default user (mostly active, single role):
 * ```ts
 * const u = userFactory();
 * // -> { id: '7c5b...', username: 'e2e-test-admin-a3b8x2pq', ... }
 * ```
 *
 * @example Targeted override (admin user with known credentials):
 * ```ts
 * const admin = userFactory({
 *   roles: ['admin'],
 *   status: 'active',
 *   username: 'e2e-test-admin-known',
 * });
 * ```
 *
 * @example Locked account for negative-path tests:
 * ```ts
 * const locked = userFactory({ status: 'locked' });
 * ```
 *
 * @example Multi-role user for permission-intersection tests:
 * ```ts
 * const both = userFactory({ roles: ['manager', 'auditor'] });
 * ```
 *
 * @param overrides Partial fields to override on the generated instance.
 *                  Defaults to an empty object.
 * @returns A fully-populated {@link User} object.
 */
export function userFactory(overrides: Partial<User> = {}): User {
  // Pick the primary role from the closed union. The role drives the
  // username slug and display-name suffix so test failures referencing
  // a username can be traced back to a role expectation quickly.
  const primaryRole: UserRole = faker.helpers.arrayElement<UserRole>(USER_ROLES);

  // ~15% of generated users carry two roles for cross-permission tests.
  // The second role is drawn from the remaining options to avoid the
  // duplicate `[admin, admin]` combination.
  const hasMultipleRoles = faker.datatype.boolean({
    probability: PROBABILITY_HAS_MULTIPLE_ROLES,
  });
  const roles: ReadonlyArray<UserRole> = hasMultipleRoles
    ? [
        primaryRole,
        faker.helpers.arrayElement<UserRole>(USER_ROLES.filter((r) => r !== primaryRole)),
      ]
    : [primaryRole];

  // 8-character lowercase alphanumeric suffix guarantees uniqueness
  // across parallel test workers. Combined with the role slug the
  // namespace per parallel worker is effectively non-colliding.
  const uniqueSuffix = faker.string.alphanumeric({
    length: UNIQUE_SUFFIX_LENGTH,
    casing: 'lower',
  });
  const username = `${E2E_TEST_PREFIX}${primaryRole}-${uniqueSuffix}`;

  // Realistic first/last names without introducing locale dependence;
  // the default `en` faker locale is used everywhere in this suite.
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  const displayName = `${E2E_TEST_PREFIX}${firstName} ${lastName} (${primaryRole})`;

  // Sentinel-domain email so a buggy live-mode test cannot leak real
  // emails into a real mailbox. The local part is derived from the
  // username slug so logs remain easy to correlate.
  const email = `${username}@${E2E_EMAIL_DOMAIN}`;

  // Weighted random status — `'active'` is over-represented in the
  // distribution array to bias generated data towards production
  // reality (most accounts are active most of the time).
  const status: UserStatus = faker.helpers.arrayElement<UserStatus>(USER_STATUS_DISTRIBUTION);

  // Determinism anchor — see `deterministicDateAnchor()` for rationale.
  // All `faker.date.*` calls in this function pass `refDate: dateAnchor`
  // so every generated timestamp is seed-deterministic. QA Issue #3
  // (resolved) reproduced wall-clock drift; this pattern prevents it.
  const dateAnchor = deterministicDateAnchor();

  const createdAt = faker.date
    .recent({ days: RECENT_DAYS_CREATED, refDate: dateAnchor })
    .toISOString();
  const updatedAt = faker.date
    .recent({ days: RECENT_DAYS_UPDATED, refDate: dateAnchor })
    .toISOString();

  // Last-login is null for `pending` accounts (matching production
  // reality where pending accounts have not authenticated yet) and
  // for ~15% of other accounts (inactive / dormant accounts). For the
  // remaining ~85% of accounts, last-login is a recent timestamp.
  const hasLoginHistory =
    status !== 'pending' && faker.datatype.boolean({ probability: PROBABILITY_HAS_LOGIN_HISTORY });
  const lastLoginAt = hasLoginHistory
    ? faker.date.recent({ days: RECENT_DAYS_LAST_LOGIN, refDate: dateAnchor }).toISOString()
    : null;

  // teamId is null for ~20% of users (typically admin-class roles that
  // operate across all teams). Non-null teamIds are fresh UUIDs; tests
  // that need a specific team override the field directly.
  const hasTeam = faker.datatype.boolean({ probability: PROBABILITY_HAS_TEAM });
  const teamId = hasTeam ? faker.string.uuid() : null;

  return {
    id: faker.string.uuid(),
    username,
    displayName,
    email,
    roles,
    status,
    firstName,
    lastName,
    teamId,
    createdAt,
    updatedAt,
    lastLoginAt,
    ...overrides,
  };
}
