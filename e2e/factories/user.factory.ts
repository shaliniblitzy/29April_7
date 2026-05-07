/**
 * @file e2e/factories/user.factory.ts
 * @description User entity factory for the Whoville-Client App Core
 *   authentication surface and for cross-cutting role-based access control
 *   (RBAC) test scenarios.
 *
 *   Generates {@link User} instances whose `username` field carries the
 *   `e2e-test-` prefix so the live-mode entity sweeper
 *   (`e2e/utils/test-data-cleanup.ts`) can identify orphan test entities for
 *   removal per AAP section 0.4.4 ("Live-mode database hygiene"). The
 *   prefix is the searchable identifier for that sweeper -- without it,
 *   the sweeper cannot distinguish synthetic E2E users from real users.
 *
 *   Uses `@faker-js/faker` (version pinned in `package.json` per AAP
 *   section 0.6.1: `^9.0.0` resolved to `9.9.0`) for randomized but
 *   seed-deterministic test-data generation. Faker's seed is set once per
 *   worker (via `e2e/fixtures/factories.fixture.ts` if needed) so calling
 *   the factory with the same seed produces equivalent output for the
 *   string-valued fields (id, names, suffixes, email, phone, department).
 *
 *   Foundational layer: imports ONLY `@faker-js/faker`. Does not import
 *   from `@fixtures`, `@pages`, `@patterns`, `@mocks`, `@utils`, or any
 *   sibling factory file -- a layering inversion would result. Pure data
 *   generation with no I/O, no Node.js built-ins, no external state. Each
 *   call produces an independent, parallel-safe instance suitable for use
 *   by Playwright workers running concurrently.
 *
 *   ## Migration-proof shape (AAP section 0.10.1)
 *
 *   All exported types use only primitive TypeScript types (`string`,
 *   `boolean`) and `ReadonlyArray<UserRole>` for the closed-union role
 *   collection. No Angular-specific types, no Whoville-Client class
 *   references, no runtime decorators, no RxJS observables. The interface
 *   is forward-compatible with the Angular 11 -> 12 -> 13 -> ... -> 21
 *   migration path -- HTTP API contract changes are the only events that
 *   require updates here.
 *
 *   ## Cleanup contract (AAP section 0.4.4)
 *
 *   The username is the searchable identifier the live-mode sweeper uses
 *   to find deletion candidates. Both the `e2e-test-` prefix and the
 *   randomized 8-character alphanumeric suffix are mandatory: the prefix
 *   for cleanup eligibility, the suffix for parallel-safe uniqueness across
 *   workers per AAP section 0.10.1 ("All tests can run independently and
 *   in parallel"). The email uses the RFC 2606 reserved `.example` TLD so
 *   even a buggy live-mode test cannot leak real notifications.
 *
 *   ## Schema contract
 *
 *   This file implements the exports defined in the file's blitzy schema:
 *
 *   - `UserRole` (type) -- closed union with members:
 *     `admin`, `manager`, `viewer`, `restricted`, `auditor`, `standard`.
 *   - `User` (interface) -- with members:
 *     `id`, `username`, `email`, `displayName`, `firstName`, `lastName`,
 *     `roles`, `createdAt`, `active`, `phoneNumber`, `department`.
 *   - `userFactory` (function) -- canonical generator with overrides.
 *   - `adminUserFactory` (function) -- preset for `roles: ['admin']`.
 *   - `viewerUserFactory` (function) -- preset for `roles: ['viewer']`.
 *   - `restrictedUserFactory` (function) -- preset for `roles: ['restricted']`.
 *   - `managerUserFactory` (function) -- preset for `roles: ['manager']`.
 *   - `auditorUserFactory` (function) -- preset for `roles: ['auditor']`.
 *
 *   No default export. Consumers should prefer the convenience presets
 *   for role-specific test setups.
 *
 *   @see AAP section 0.5.1.12 -- file mandate (Factories, Mocks, and
 *        Test Utilities): "`e2e/factories/user.factory.ts` | CREATE | n/a |
 *        Generates `User` instances with role variants."
 *   @see AAP section 0.4.4 -- Test Data and Fixtures Design (live-mode
 *        cleanup, parallel-safe uniqueness, RFC 2606 email domain).
 *   @see AAP section 0.5.1.13 -- API Response Fixtures
 *        (`fixtures/api-responses/auth/me.json` mirrors the User shape).
 *   @see AAP section 0.10.1 -- User-specified directives (parallel-safe,
 *        mock-first, migration-proof field types).
 *   @see e2e/mocks/handlers/auth.handler.ts -- consumer (`/api/auth/me`).
 *   @see e2e/fixtures/factories.fixture.ts -- consumer wrapper (test fixture).
 *   @see e2e/utils/test-data-cleanup.ts -- live-mode entity sweeper that
 *        relies on the `e2e-test-` username prefix for cleanup eligibility.
 */

// ---------------------------------------------------------------------------
// Imports -- strictly limited to `@faker-js/faker` per the e2e/factories/
// foundational-layer constraint. No imports from `@fixtures`, `@pages`,
// `@patterns`, `@mocks`, `@utils`, sibling factory files, or Node.js
// built-ins (no `fs`, no `path`, no I/O). This keeps the factory truly
// independent and enables it to be used from any context (specs, mocks,
// scripts, even `global-setup.ts` if needed).
// ---------------------------------------------------------------------------

import { faker } from '@faker-js/faker';

// ---------------------------------------------------------------------------
// Public type definitions
// ---------------------------------------------------------------------------

/**
 * Canonical roles used across the Whoville-Client RBAC matrix.
 *
 * Closed union for compile-time safety: test code that overrides `roles`
 * with a typo (e.g., `'admiin'`) fails at compile time rather than
 * producing a confusing runtime mismatch. Aligned with AAP section 0.5.1.11
 * RBAC denial-path scenarios and AAP section 0.5.1.12 `auth.fixture.ts`
 * per-role overrides (admin, viewer, restricted).
 *
 * - `'admin'`      Full administrative access (Authorization module routes
 *                  and cross-module privileged operations).
 * - `'manager'`    Workforce module privileges (transfers, leave approvals,
 *                  team management).
 * - `'viewer'`     Read-only access across all modules.
 * - `'restricted'` Reduced-privilege user used to test denial UX paths.
 * - `'auditor'`    Audit-of-grants visibility (Authorization module).
 * - `'standard'`   Default authenticated user; baseline access with no
 *                  special privileges -- the canonical "regular user"
 *                  most tests rely on.
 */
export type UserRole = 'admin' | 'manager' | 'viewer' | 'restricted' | 'auditor' | 'standard';

/**
 * User entity representing an authenticated identity in the
 * Whoville-Client App Core authentication surface.
 *
 * Shape mirrors the canonical `/api/auth/me` response per AAP section
 * 0.5.1.13 (`fixtures/api-responses/auth/me.json`).
 *
 * Migration-proof: uses primitive types only (`string`, `boolean`,
 * `ReadonlyArray<UserRole>`). The interface survives Angular 11 -> 21
 * upgrades without modification because it doesn't depend on any
 * Angular-specific types or RxJS observables.
 *
 * Field stability:
 *   - `id` and `username` are stable identifiers. `username` follows the
 *     `e2e-test-<slug>-<suffix>` convention so the live-mode sweeper
 *     recognises it as a cleanup candidate.
 *   - `email` is generated with the RFC 2606 reserved `.example` TLD --
 *     a non-routable internal sentinel that never reaches a real mailbox
 *     even if a buggy live-mode call accidentally dispatches a
 *     notification.
 *   - `displayName` is a human-readable label suitable for surfacing in
 *     profile menus and headers.
 *   - `roles` is a `ReadonlyArray<UserRole>` to communicate at the type
 *     level that consumers must not mutate the array. Mutations must go
 *     through factory invocation with overrides -- preserving immutability
 *     semantics across parallel test workers.
 *   - `active` defaults to `true`; tests for inactive/locked accounts
 *     override via `userFactory({ active: false })`.
 *   - `phoneNumber` and `department` are optional, allowing tests to
 *     model "minimal user" vs. "full user" scenarios without separate
 *     factory functions.
 *
 * All fields are `readonly` to prevent accidental mutation of test data
 * after creation; spread-based overrides (`{ ...user, active: false }`)
 * remain ergonomic because TypeScript readonly is a compile-time
 * constraint only.
 */
export interface User {
  /** UUID identifier (RFC 4122 v4). */
  readonly id: string;
  /**
   * `e2e-test-` prefixed username. Format:
   * `e2e-test-<firstName>.<lastName>-<8-char-suffix>` (e.g.,
   * `'e2e-test-jane.doe-x7y8a3bc'`). The prefix is the sentinel value
   * the live-mode sweeper matches; the suffix guarantees uniqueness
   * across parallel workers.
   */
  readonly username: string;
  /**
   * Email address using the RFC 2606 reserved `.example` TLD
   * (`<localpart>@e2e-test.example`). Reserved per RFC 2606 for
   * documentation/testing -- emails generated by this factory will
   * never accidentally hit a real mailbox in live-API mode.
   */
  readonly email: string;
  /**
   * Display name shown in profile menu / header. Format: `"<First> <Last>"`.
   */
  readonly displayName: string;
  /** First name (faker-generated). */
  readonly firstName: string;
  /** Last name (faker-generated). */
  readonly lastName: string;
  /**
   * Roles granted to this user. Always non-empty: default is `['standard']`
   * (the canonical baseline authenticated user). Multiple roles per user is
   * realistic (e.g., `['admin', 'manager']`) for cross-permission tests.
   */
  readonly roles: ReadonlyArray<UserRole>;
  /** ISO 8601 timestamp of account creation. */
  readonly createdAt: string;
  /**
   * Whether the user account is currently active. Default `true`.
   * Tests for inactive/locked-account UX override via
   * `userFactory({ active: false })`.
   */
  readonly active: boolean;
  /**
   * Optional phone number. Locale-aware formatting per
   * `faker.phone.number()` defaults; tests with strict format
   * requirements override directly.
   */
  readonly phoneNumber?: string;
  /**
   * Optional department / organizational unit. Generated via
   * `faker.commerce.department()` for realistic-looking labels.
   */
  readonly department?: string;
}

// ---------------------------------------------------------------------------
// Internal constants -- file-local; not exported. These are tuned to
// produce realistic-looking but parallel-safe test data. Tests that need
// specific values override via the `overrides` parameter.
// ---------------------------------------------------------------------------

/**
 * Cleanup-eligibility prefix applied to every generated `username`.
 *
 * The live-mode entity sweeper (`e2e/utils/test-data-cleanup.ts`) uses
 * this exact string to identify orphan test entities for removal. Every
 * factory in this folder enforces the same prefix convention -- without
 * it, the sweeper cannot distinguish synthetic E2E entities from real
 * data. See AAP section 0.4.4 ("Live-mode database hygiene").
 */
const E2E_USERNAME_PREFIX = 'e2e-test-';

/**
 * Length of the random alphanumeric uniqueness suffix appended to each
 * generated `username`.
 *
 * 8 characters of lowercase alphanumeric (`[a-z0-9]{8}`) yields ~2.8e12
 * combinations -- effectively non-colliding across parallel test workers
 * even at sustained authoring rates. Per AAP section 0.10.1: "factories
 * generate UUID-suffixed entity names" -- the spirit is parallel-safe
 * uniqueness; an 8-char suffix is sufficient without making the username
 * unwieldy. Using a full UUID would make usernames unreadable in test
 * output.
 */
const UNIQUE_SUFFIX_LENGTH = 8;

/**
 * RFC 2606 reserved TLD subdomain for generated email addresses.
 *
 * `.example` is reserved per RFC 2606 for documentation and testing, so
 * emails generated by this factory will never accidentally hit a real
 * mailbox in live-API mode. The `e2e-test.example` subdomain doubles as
 * a cleanup-eligibility marker.
 */
const E2E_EMAIL_PROVIDER = 'e2e-test.example';

/**
 * Lookback window (days) for `createdAt` timestamps. 365 days provides a
 * realistic spread of "account aged some time ago" without the timestamps
 * looking suspicious. Tests that need specific creation dates override
 * the field directly.
 */
const RECENT_DAYS_CREATED = 365;

/**
 * Regex used to strip non-alphanumeric characters from the username slug.
 *
 * Faker's name generators may produce non-ASCII characters or apostrophes
 * (e.g., "O'Brien", names with accents). Stripping to `[a-z0-9.]` ensures
 * usernames are URL-safe, file-system-safe, and compatible with most
 * authentication backends. The dot is permitted so the natural
 * `firstname.lastname` separator survives.
 */
const USERNAME_SANITIZER_RE = /[^a-z0-9.]/g;

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Generate a {@link User} instance with sensible defaults and optional
 * overrides.
 *
 * Each invocation produces an independent, parallel-safe instance:
 *   - `id` is a fresh RFC 4122 v4 UUID via `faker.string.uuid()`.
 *   - `username` carries the `e2e-test-` prefix and an 8-character random
 *     alphanumeric suffix to guarantee uniqueness across parallel workers
 *     (per AAP section 0.10.1).
 *   - `displayName` is `"<First> <Last>"`, suitable for profile-menu and
 *     header rendering.
 *   - `email` uses the RFC 2606 reserved `.example` TLD via the local
 *     part derived from first and last name.
 *   - `roles` defaults to `['standard']` -- the canonical baseline
 *     authenticated user. The default is a single-element array; never
 *     empty per the type contract.
 *   - `active` defaults to `true` -- most tests assume an active user.
 *   - `phoneNumber` and `department` are populated by faker by default;
 *     tests override with `undefined` to model minimal-user scenarios.
 *
 * Overrides shallow-merge over the generated defaults via spread:
 *   `{ ...generated, ...overrides }`. To override a nested property,
 *   replace the whole property (the type forbids deep mutation via
 *   `readonly`).
 *
 * @param overrides Partial fields to override on the generated instance.
 *                  Defaults to an empty object. Use `roles: ['admin']` to
 *                  set the role; use `active: false` for inactive
 *                  accounts; use `username: 'e2e-test-fixed'` for tests
 *                  that need a known stable username.
 * @returns A fully-populated {@link User} object.
 *
 * @example Default user (canonical baseline):
 * ```ts
 * import { userFactory } from '@factories/user.factory';
 *
 * const user = userFactory();
 * // -> { id: 'a1b2c3d4-...', username: 'e2e-test-jane.doe-x7y8a3bc',
 * //      roles: ['standard'], active: true, ... }
 * ```
 *
 * @example Targeted role override:
 * ```ts
 * const admin = userFactory({ roles: ['admin'] });
 * ```
 *
 * @example Multi-role user for permission-intersection tests:
 * ```ts
 * const both = userFactory({ roles: ['admin', 'manager'] });
 * ```
 *
 * @example Inactive account for negative-path tests:
 * ```ts
 * const inactive = userFactory({ active: false });
 * ```
 *
 * @example Fixed username for tests that assert against a known value:
 * ```ts
 * const known = userFactory({
 *   username: 'e2e-test-fixed-user',
 *   email: 'fixed@e2e-test.example',
 * });
 * ```
 *
 * @example Minimal user (no optional fields):
 * ```ts
 * const minimal = userFactory({ phoneNumber: undefined, department: undefined });
 * ```
 */
export function userFactory(overrides: Partial<User> = {}): User {
  // Faker-generated person details. The default `en` locale is used; tests
  // requiring locale-specific names override `firstName` / `lastName`
  // directly. faker.person.firstName/lastName always returns a non-empty
  // string in faker 9.x.
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();

  // Build the username slug: lowercase, dot-separated, sanitised to
  // [a-z0-9.] to handle Faker-emitted apostrophes / non-ASCII characters
  // (e.g., "O'Brien", "Renée"). Sanitization keeps usernames URL-safe,
  // file-system-safe, and compatible with most authentication backends.
  const usernameBase = `${firstName}.${lastName}`.toLowerCase().replace(USERNAME_SANITIZER_RE, '');

  // 8-character lowercase alphanumeric suffix guarantees uniqueness across
  // parallel test workers without making the username unwieldy. Combined
  // with the slug, the per-worker namespace is effectively non-colliding.
  // Per AAP section 0.10.1: "All tests can run independently and in parallel".
  const uniqueSuffix = faker.string.alphanumeric({
    length: UNIQUE_SUFFIX_LENGTH,
    casing: 'lower',
  });

  // The username is the searchable identifier for the live-mode sweeper
  // per AAP section 0.4.4. The prefix is mandatory -- without it, the
  // sweeper cannot distinguish synthetic E2E users from real users.
  const username = `${E2E_USERNAME_PREFIX}${usernameBase}-${uniqueSuffix}`;

  // RFC 2606 reserved TLD ensures emails never reach a real mailbox even
  // if a buggy live-mode test accidentally dispatches a notification.
  // `faker.internet.email` may insert random digits or casing; lowercasing
  // produces a canonical form for tests that compare emails for equality.
  const email = faker.internet
    .email({
      firstName,
      lastName,
      provider: E2E_EMAIL_PROVIDER,
    })
    .toLowerCase();

  // ISO 8601 timestamp; tests that assert on createdAt format use
  // `expect(...).toMatch(/^\d{4}-\d{2}-\d{2}T/)` rather than a fixed
  // string, since faker.date.recent reads the wall-clock by default.
  const createdAt = faker.date.recent({ days: RECENT_DAYS_CREATED }).toISOString();

  return {
    id: faker.string.uuid(),
    username,
    email,
    displayName: `${firstName} ${lastName}`,
    firstName,
    lastName,
    // The cast to `ReadonlyArray<UserRole>` is required because TypeScript
    // would otherwise infer the literal type `['standard']` (a tuple),
    // which is too narrow for the User.roles field.
    roles: ['standard'] as ReadonlyArray<UserRole>,
    createdAt,
    active: true,
    phoneNumber: faker.phone.number(),
    department: faker.commerce.department(),
    // Spread overrides last so they take precedence over every default
    // above. Spread is shallow, which is correct here since every User
    // field is a primitive or a ReadonlyArray (no deep nesting).
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Convenience preset factories
//
// 90% of role-specific test setups are one-liners. Presets like
// `adminUserFactory()` save typing and improve readability:
//
//     const admin = adminUserFactory();
//
// is clearer than:
//
//     const admin = userFactory({ roles: ['admin'] });
//
// The presets compose with overrides:
//
//     const inactiveAdmin = adminUserFactory({ active: false });
//
// produces an inactive admin. The override-merge order is: factory
// defaults -> role override -> caller overrides, so caller overrides
// always win.
// ---------------------------------------------------------------------------

/**
 * Generate a {@link User} with the `'admin'` role.
 *
 * Convenience preset for Authorization module tests and admin-only flows.
 * Equivalent to `userFactory({ roles: ['admin'] })` with caller overrides
 * applied after the role assignment.
 *
 * @param overrides Partial fields to override (excluding `roles`, which
 *                  is set by this preset; pass `roles` explicitly to
 *                  this preset's overrides only if you intend to extend
 *                  or replace the admin role).
 * @returns A fully-populated {@link User} object with `roles: ['admin']`.
 *
 * @example
 * ```ts
 * const admin = adminUserFactory();
 * // -> roles: ['admin']
 *
 * const inactiveAdmin = adminUserFactory({ active: false });
 * // -> roles: ['admin'], active: false
 * ```
 */
export function adminUserFactory(overrides: Partial<User> = {}): User {
  return userFactory({ roles: ['admin'] as ReadonlyArray<UserRole>, ...overrides });
}

/**
 * Generate a {@link User} with the `'viewer'` (read-only) role.
 *
 * Convenience preset for read-only access tests across all modules.
 *
 * @param overrides Partial fields to override.
 * @returns A fully-populated {@link User} object with `roles: ['viewer']`.
 *
 * @example
 * ```ts
 * const viewer = viewerUserFactory();
 * // -> roles: ['viewer']
 * ```
 */
export function viewerUserFactory(overrides: Partial<User> = {}): User {
  return userFactory({ roles: ['viewer'] as ReadonlyArray<UserRole>, ...overrides });
}

/**
 * Generate a {@link User} with the `'restricted'` role.
 *
 * Convenience preset for RBAC denial-path tests per AAP section 0.5.1.11
 * (`integration/03-rbac-denial-paths.int.spec.ts`). The restricted role
 * is the sentinel under-privileged identity used to verify denial UX.
 *
 * @param overrides Partial fields to override.
 * @returns A fully-populated {@link User} object with `roles: ['restricted']`.
 *
 * @example
 * ```ts
 * const restricted = restrictedUserFactory();
 * // -> roles: ['restricted']
 * ```
 */
export function restrictedUserFactory(overrides: Partial<User> = {}): User {
  return userFactory({ roles: ['restricted'] as ReadonlyArray<UserRole>, ...overrides });
}

/**
 * Generate a {@link User} with the `'manager'` role.
 *
 * Convenience preset for Workforce module approval-flow tests (transfers,
 * leave requests, team management).
 *
 * @param overrides Partial fields to override.
 * @returns A fully-populated {@link User} object with `roles: ['manager']`.
 *
 * @example
 * ```ts
 * const manager = managerUserFactory();
 * // -> roles: ['manager']
 * ```
 */
export function managerUserFactory(overrides: Partial<User> = {}): User {
  return userFactory({ roles: ['manager'] as ReadonlyArray<UserRole>, ...overrides });
}

/**
 * Generate a {@link User} with the `'auditor'` role.
 *
 * Convenience preset for audit-of-grants tests in the Authorization
 * module (`feature-crud/authorization/audit-of-grants-view.crud.spec.ts`).
 *
 * @param overrides Partial fields to override.
 * @returns A fully-populated {@link User} object with `roles: ['auditor']`.
 *
 * @example
 * ```ts
 * const auditor = auditorUserFactory();
 * // -> roles: ['auditor']
 * ```
 */
export function auditorUserFactory(overrides: Partial<User> = {}): User {
  return userFactory({ roles: ['auditor'] as ReadonlyArray<UserRole>, ...overrides });
}
