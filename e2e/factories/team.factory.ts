/**
 * Team entity factory for the Whoville-Client Workforce module.
 *
 * Generates `Team` instances with `e2e-test-` prefixed names so the
 * live-mode entity sweeper (`e2e/utils/test-data-cleanup.ts`) can
 * identify orphan test entities for removal per AAP §0.4.4.
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
 * `name` field. The field begins with the configured `e2e-test-` prefix
 * (default), and a randomized 8-character alphanumeric suffix guarantees
 * uniqueness across parallel workers per AAP §0.10.1 ("All tests can run
 * independently and in parallel").
 *
 * ## Migration-proof shape (AAP §0.10.1)
 *
 * All exported types use only primitive TypeScript types (`string`,
 * `number`, `boolean`) and `ReadonlyArray<string>` for collections. No
 * Angular-specific types, no Whoville-Client class references, no
 * runtime decorators. The interface is forward-compatible with the
 * Angular 11 → 12 → 13 → … → 21 migration path; HTTP API contract
 * changes are the only events that require updates here.
 *
 * ## Determinism (AAP §0.4.4 — "deterministic (seedable) entity instances")
 *
 * All `faker.date.*` calls use a seed-deterministic `refDate` produced
 * by `deterministicDateAnchor()`. Faker's default `refDate: new Date()`
 * would otherwise read the wall-clock and break byte-identical
 * reproducibility across same-seed invocations. See QA Issue #3
 * (reproduced in role-grant.factory.ts) for the contained-fix this
 * anchor pattern embodies.
 *
 * ## Internal-consistency invariants
 *
 * Every invocation produces an instance satisfying:
 *   - `id` is an RFC 4122 v4 UUID.
 *   - `name` begins with `'e2e-test-'` and ends with an 8-character
 *     lowercase alphanumeric suffix (parallel-safe).
 *   - `name` contains no commas (sanitized for CSV exports / log lines).
 *   - `memberCount` is in [1, 50] by default.
 *   - `costCenter` matches the format `CC-NNNNN` (5-digit numeric).
 *   - `active` is `true` by default (most teams are operational).
 *   - `createdAt` is ISO 8601 within the deterministic anchor window;
 *     `updatedAt` is ISO 8601 in a tighter recent window so it tends
 *     to be greater than `createdAt` in realistic distributions.
 *   - `tags` is a `ReadonlyArray<string>` of 0–3 entries drawn from a
 *     curated enterprise-vocabulary list.
 *
 * @see AAP §0.5.1.12 — file mandate (Factories, Mocks, and Test Utilities).
 * @see AAP §0.4.4 — Test Data and Fixtures Design (live-mode cleanup,
 *      determinism contract).
 * @see AAP §0.10.1 — User-specified directives (parallel-safe, mock-first,
 *      migration-proof field names).
 * @see e2e/pages/workforce/team-list.page.ts, team-detail.page.ts,
 *      team-form.page.ts — POM consumers.
 * @see e2e/mocks/handlers/workforce.handler.ts — mock handler consumer.
 * @see e2e/fixtures/api-responses/workforce/teams-list.json,
 *      team-detail.json — fixture shape references.
 * @see e2e/utils/test-data-cleanup.ts — live-mode sweeper that relies
 *      on the `e2e-test-` prefix on `Team.name` to identify deletion
 *      candidates.
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
 * Team entity. Represents a workforce organisational unit in the
 * Whoville-Client Workforce module.
 *
 * Migration-proof shape: primitive types only. Survives the Angular
 * 11 → 21 migration without modification — only HTTP API contract
 * changes require updates here.
 *
 * Field stability:
 *   - `id` is the stable primary key (UUID).
 *   - `name` is the user-facing display label and the cleanup sweeper's
 *     match field; it carries the `e2e-test-` prefix and an 8-character
 *     alphanumeric suffix for parallel safety.
 *   - `description` is free-text (faker `lorem.sentence`); tests that
 *     assert on text content should override this directly.
 *   - `memberCount` is the count of members at snapshot time (integer
 *     ≥ 0). The default range is [1, 50]; tests that want zero
 *     (empty-team rendering) override with `memberCount: 0`; tests that
 *     want a large team (pagination) override with `memberCount: 250`.
 *   - `location` / `managerId` / `costCenter` are optional fixture
 *     metadata. Optional matches the typical UI behaviour where these
 *     fields may be absent for newly-created teams.
 *   - `active` is `true` by default (most teams are operational).
 *     Tests for archived / inactive teams override directly.
 *   - `createdAt` / `updatedAt` are ISO 8601 timestamps; `updatedAt` is
 *     optional (absent for never-modified rows).
 *   - `tags` is an optional immutable list of categorisation labels
 *     drawn from a curated enterprise vocabulary; absent or empty is
 *     valid.
 *
 * @see AAP §0.5.1.13 — `e2e/fixtures/api-responses/workforce/teams-list.json`
 *      and `team-detail.json` mirror this shape.
 */
export interface Team {
  /** UUID identifier (RFC 4122 v4). */
  readonly id: string;
  /**
   * `e2e-test-` prefixed display name for live-mode cleanup eligibility.
   *
   * Format: `e2e-test-<faker-company-name> <8-char-suffix>` (e.g.,
   * `'e2e-test-Acme Corporation x7y8a3bc'`). The prefix is the sentinel
   * value the live-mode sweeper matches; the suffix guarantees
   * uniqueness across parallel workers; commas are stripped so the
   * value is safe to embed in CSV exports / log lines.
   */
  readonly name: string;
  /**
   * Free-text team description (faker `lorem.sentence`). Realistic
   * prose used to populate the team's "About" / mission rendering.
   * Tests for character-limit / overflow rendering override directly.
   */
  readonly description: string;
  /**
   * Snapshot count of team members. Integer ≥ 0. Default range is
   * [1, 50] (realistic team sizes). Tests for empty-team rendering
   * override with `memberCount: 0`; tests for paginated listings
   * override with larger values.
   */
  readonly memberCount: number;
  /**
   * Optional geographic location (city / metro region) — drawn from
   * faker's location provider. Used for filtering in list views.
   * Optional because newly-created teams may not yet have a location
   * assigned.
   */
  readonly location?: string;
  /**
   * Optional UUID of the team manager. Cross-factory relationship
   * stored as a UUID string (no nested objects per the
   * foundational-layer constraint). Tests linking to a specific
   * manager override this field with the real user's `id`.
   */
  readonly managerId?: string;
  /**
   * Optional cost center accounting code. Format: `CC-NNNNN` (e.g.,
   * `'CC-12345'`). Used by reporting export workflows. Optional
   * because teams in setup-only states may not yet be assigned a cost
   * centre.
   */
  readonly costCenter?: string;
  /**
   * Whether the team is currently active. Default: `true`. Tests for
   * archived / inactive team behaviour override with `active: false`.
   */
  readonly active: boolean;
  /** ISO 8601 timestamp of team creation (e.g., `'2024-08-15T08:30:00.000Z'`). */
  readonly createdAt: string;
  /**
   * ISO 8601 timestamp of last update. Optional — absent for
   * never-modified rows. When present, generated within a tighter
   * window than `createdAt` so it tends to be the more recent
   * timestamp.
   */
  readonly updatedAt?: string;
  /**
   * Optional immutable list of categorisation labels / tags. Drawn
   * from a curated enterprise vocabulary so tag values are realistic
   * (engineering, operations, support, …). Absent or empty array is
   * valid; tests for tag-rendering override with specific values.
   *
   * `ReadonlyArray<string>` rather than `string[]` to communicate at
   * the type level that consumers must not mutate the array;
   * immutability is the factory's contract.
   */
  readonly tags?: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Internal constants — file-local; not exported.
// ---------------------------------------------------------------------------

/** Common prefix applied to every entity name for cleanup eligibility. */
const E2E_TEST_PREFIX = 'e2e-test-';

/** Length of the random alphanumeric uniqueness suffix appended to names. */
const UNIQUE_SUFFIX_LENGTH = 8;

/**
 * Curated enterprise vocabulary for the `tags` field. Drawn from the
 * canonical AAP §0.3.1 functional-area decomposition plus generic
 * organisational taxonomy. Closed list keeps tag values realistic and
 * prevents faker from emitting arbitrary lorem-ipsum tokens.
 */
const TEAM_TAG_VOCABULARY: ReadonlyArray<string> = [
  'engineering',
  'operations',
  'support',
  'sales',
  'marketing',
  'finance',
  'hr',
];

/** Minimum member count for the default range. */
const MIN_MEMBER_COUNT = 1;

/**
 * Maximum member count for the default range. 50 is the upper bound for
 * a department-sized team; tests for paginated / virtualised lists
 * override with larger values.
 */
const MAX_MEMBER_COUNT = 50;

/** Minimum word count for the lorem-sentence description. */
const MIN_DESCRIPTION_WORDS = 5;

/** Maximum word count for the lorem-sentence description. */
const MAX_DESCRIPTION_WORDS = 12;

/** Minimum number of tags emitted by default. */
const MIN_TAGS = 0;

/** Maximum number of tags emitted by default. */
const MAX_TAGS = 3;

/** Number of digits in the cost-center suffix (`CC-NNNNN`). */
const COST_CENTER_DIGIT_COUNT = 5;

/** Lookback window (days) for `createdAt` timestamps. */
const RECENT_DAYS_CREATED = 365;

/** Lookback window (days) for `updatedAt` timestamps. */
const RECENT_DAYS_UPDATED = 30;

/**
 * Regex used to strip commas from `faker.company.name()` output before
 * embedding the value in `Team.name`. Faker can produce names like
 * `"Smith, Johnson and Sons"` — valid as a team name but the comma can
 * confuse downstream serialisation (CSV exports from
 * `headcount-export.crud.spec.ts`, comma-separated log lines, etc.).
 * The regex is global so all occurrences in the name are stripped.
 */
const COMMA_STRIP_RE = /,/g;

// ---------------------------------------------------------------------------
// Determinism anchor (per AAP §0.4.4)
//
// Faker's `date.*` API family — `recent`, `between`, `anytime`, `future`,
// `past` — defaults `refDate` to `new Date()` (the wall-clock). Successive
// invocations under the SAME seed therefore produce ms-level drift in any
// generated ISO timestamp, breaking the byte-identical reproducibility
// AAP §0.4.4 requires ("randomized but deterministic (seedable) entity
// instances"). QA Issue #3 (reproduced in role-grant.factory.ts) documents
// this defect at ~10% rate.
//
// The fix: derive a date anchor purely from the seeded RNG via
// `faker.number.int()` over a FIXED epoch-millisecond range that does not
// reference `Date.now()` / `new Date()` at all. The two constants below
// span 2020-01-01 → 2030-12-31 UTC, a window large enough to produce
// realistic-looking timestamps for the lifetime of this test suite without
// ever depending on the wall-clock.
//
// All `faker.date.*` calls in this file pass an explicit `refDate:
// dateAnchor` so the entire date-generation graph is seed-deterministic.
// ---------------------------------------------------------------------------

/** Lower bound of the deterministic date anchor: 2020-01-01T00:00:00.000Z. */
const ANCHOR_MIN_EPOCH_MS = Date.UTC(2020, 0, 1);

/** Upper bound of the deterministic date anchor: 2030-12-31T00:00:00.000Z. */
const ANCHOR_MAX_EPOCH_MS = Date.UTC(2030, 11, 31);

/**
 * Generate a seed-deterministic `Date` anchor without consulting the
 * wall-clock. Used as the `refDate` argument to every `faker.date.*`
 * call in this file so the resulting timestamps are byte-identical
 * across same-seed invocations.
 *
 * @returns A `Date` in the [2020-01-01, 2030-12-31] UTC interval.
 */
function deterministicDateAnchor(): Date {
  return new Date(faker.number.int({ min: ANCHOR_MIN_EPOCH_MS, max: ANCHOR_MAX_EPOCH_MS }));
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Generate a {@link Team} instance with sensible defaults and optional
 * overrides.
 *
 * Each invocation produces an independent, parallel-safe instance:
 *   - `id` is a fresh RFC 4122 v4 UUID.
 *   - `name` carries the `e2e-test-` prefix, a faker company name with
 *     commas stripped, and an 8-character random lowercase alphanumeric
 *     suffix to guarantee uniqueness across parallel test workers.
 *   - `description` is a 5–12 word lorem-ipsum sentence.
 *   - `memberCount` is an integer in [1, 50].
 *   - `location` is a faker city.
 *   - `managerId` is a fresh UUID (cross-factory reference; tests
 *     linking to a specific user override directly).
 *   - `costCenter` matches the `CC-NNNNN` enterprise format.
 *   - `active` defaults to `true`.
 *   - `createdAt` is anchored to the deterministic date anchor; the
 *     lookback window is 365 days.
 *   - `updatedAt` uses a tighter 30-day window so realistic
 *     distributions show `updatedAt > createdAt`.
 *   - `tags` is sampled (0–3 elements) from the curated enterprise
 *     vocabulary.
 *
 * The trailing `...overrides` spread enables targeted customisation
 * without having to construct the full object — a common pattern in
 * test code.
 *
 * @example Default team:
 * ```ts
 * import { teamFactory } from '@factories';
 *
 * const team = teamFactory();
 * // -> {
 * //      id: 'a1b2c3d4-...',
 * //      name: 'e2e-test-Acme Corporation x7y8a3bc',
 * //      memberCount: 12,
 * //      active: true,
 * //      ...
 * //    }
 * ```
 *
 * @example Empty-team rendering test:
 * ```ts
 * const empty = teamFactory({ memberCount: 0 });
 * ```
 *
 * @example Archived team (negative-path test):
 * ```ts
 * const archived = teamFactory({ active: false });
 * ```
 *
 * @example Linked-entity override (assign to a known manager):
 * ```ts
 * const linked = teamFactory({ managerId: knownManager.id });
 * ```
 *
 * @example Pagination / virtualisation test (large team):
 * ```ts
 * const big = teamFactory({ memberCount: 250 });
 * ```
 *
 * @param overrides Partial fields to override on the generated instance.
 *                  Defaults to an empty object.
 * @returns A fully-populated {@link Team} object.
 */
export function teamFactory(overrides: Partial<Team> = {}): Team {
  // Generate a faker company name and sanitize it for use as a stable
  // team name. Faker 9.x's `company.name()` produces names like
  // "Smith, Johnson and Sons" — these are valid but the comma can
  // confuse downstream JSON / CSV / log serialisation. Light sanitisation
  // strips commas while preserving readability.
  const companyName = faker.company.name().replace(COMMA_STRIP_RE, '');

  // 8-character lowercase alphanumeric suffix guarantees uniqueness
  // across parallel test workers (AAP §0.10.1 — "factories generate
  // UUID-suffixed entity names").
  const uniqueSuffix = faker.string.alphanumeric({
    length: UNIQUE_SUFFIX_LENGTH,
    casing: 'lower',
  });

  const name = `${E2E_TEST_PREFIX}${companyName} ${uniqueSuffix}`;

  // Realistic lorem-ipsum sentence. Bounded word count keeps the
  // rendered description visually consistent across snapshots.
  const description = faker.lorem.sentence({
    min: MIN_DESCRIPTION_WORDS,
    max: MAX_DESCRIPTION_WORDS,
  });

  // Default member-count range matches realistic team sizes. The lower
  // bound of 1 avoids zero by default (zero is an edge case that tests
  // override explicitly).
  const memberCount = faker.number.int({ min: MIN_MEMBER_COUNT, max: MAX_MEMBER_COUNT });

  // Realistic geographic location for fixture data. Tests filtering by
  // location override with specific values.
  const location = faker.location.city();

  // Cross-factory relationship stored as a UUID string. Tests linking
  // to a specific manager override this field with the real user's id.
  const managerId = faker.string.uuid();

  // Cost-center format `CC-NNNNN`. The 5-digit numeric mimics common
  // enterprise cost-center conventions; tests for input-validation
  // boundary cases (non-numeric, too-long) override the field.
  const costCenter = `CC-${faker.string.numeric(COST_CENTER_DIGIT_COUNT)}`;

  // Determinism anchor — see `deterministicDateAnchor()` for rationale.
  const dateAnchor = deterministicDateAnchor();

  // `createdAt` uses a 365-day lookback; `updatedAt` uses a tighter
  // 30-day lookback so realistic distributions show `updatedAt`
  // generally greater than `createdAt`. Tests that need exact
  // ordering should override both fields.
  const createdAt = faker.date
    .recent({ days: RECENT_DAYS_CREATED, refDate: dateAnchor })
    .toISOString();
  const updatedAt = faker.date
    .recent({ days: RECENT_DAYS_UPDATED, refDate: dateAnchor })
    .toISOString();

  // Sample 0–3 tags from the curated enterprise vocabulary. The
  // `arrayElements` helper guarantees no duplicates and respects the
  // requested min/max bounds. Empty array is valid (untagged team).
  const tags = faker.helpers.arrayElements(TEAM_TAG_VOCABULARY, {
    min: MIN_TAGS,
    max: MAX_TAGS,
  });

  return {
    id: faker.string.uuid(),
    name,
    description,
    memberCount,
    location,
    managerId,
    costCenter,
    active: true,
    createdAt,
    updatedAt,
    tags,
    ...overrides,
  };
}
