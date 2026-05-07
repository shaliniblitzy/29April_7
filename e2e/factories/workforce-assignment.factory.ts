/**
 * WorkforceAssignment entity factory for the Whoville-Client Workforce
 * module.
 *
 * A `WorkforceAssignment` represents the assignment of a user (and the
 * team they belong to) to a project, task, rotation, or shift, owned by
 * a manager and tracked through a four-state lifecycle (`'pending'`,
 * `'active'`, `'completed'`, `'cancelled'`).
 *
 * Generates entities with `e2e-test-` prefixed `title` values so the
 * live-mode entity sweeper (`e2e/utils/test-data-cleanup.ts` —
 * `nameField: 'title'` for `/api/workforce/assignments`) can identify
 * orphan test entities for removal per AAP §0.4.4.
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
 * `title` field. The field begins with the configured `e2e-test-` prefix
 * (default), and a randomized 8-character alphanumeric suffix guarantees
 * uniqueness across parallel workers per AAP §0.10.1.
 *
 * ## Migration-proof shape (AAP §0.10.1)
 *
 * All exported types use only primitive TypeScript types (`string`,
 * `number`, `boolean`, union literals, `null`) and `ReadonlyArray<string>`
 * for collections. No Angular-specific types, no Whoville-Client class
 * references, no runtime decorators. The interfaces are forward-compatible
 * with the Angular 11 → 12 → 13 → … → 21 migration path; HTTP API
 * contract changes are the only events that require updates here.
 *
 * ## Cross-factory references (AAP §0.5.1.11 cross-module integration)
 *
 * Cross-factory relationships (`userId`, `teamId`, `managerId`,
 * `requiredCompetencyIds`) are stored as UUID strings rather than nested
 * objects. This keeps each factory at the foundational layer with a
 * single import, prevents circular imports during the Angular migration,
 * and lets tests link to specific user / team / competency entities by
 * passing concrete IDs through the `overrides` parameter (e.g.,
 * `workforceAssignmentFactory({ teamId: knownTeam.id })`). The cross-module
 * Tier 3 spec `01-cross-module-workforce-competency.int.spec.ts` exercises
 * this pattern by overriding `requiredCompetencyIds` with real
 * Competency UUIDs.
 *
 * ## Determinism (AAP §0.4.4 — "deterministic (seedable) entity instances")
 *
 * All `faker.date.*` calls use a seed-deterministic `refDate` produced
 * by `deterministicDateAnchor()`. The default `refDate: new Date()`
 * would otherwise read the wall-clock — which changes between
 * successive seeded invocations and produces 1ms-level drift in
 * `createdAt` / `updatedAt` and any other generated date, breaking the
 * byte-identical reproducibility AAP §0.4.4 contracts for. See QA
 * Issue #3 (reproduced in role-grant.factory.ts) for the contained fix
 * this anchor pattern embodies.
 *
 * ## Internal-consistency invariants
 *
 * Every invocation produces an instance satisfying:
 *   - `title` begins with `'e2e-test-'` and ends with an 8-character
 *     lowercase alphanumeric suffix (parallel-safe).
 *   - `startDate` is an ISO 8601 date-only string (`'YYYY-MM-DD'`).
 *   - `endDate` is either an ISO 8601 date-only string or `null`. When
 *     non-null, `endDate >= startDate`.
 *   - When `status === 'completed'`, `endDate` is non-null.
 *   - When `status` is `'pending'` or `'active'`, `endDate` is `null`.
 *   - `estimatedHours` is in [8, 200].
 *   - `actualHours` is in [0, estimatedHours] for non-completed
 *     assignments, and within ±30% of `estimatedHours` for completed
 *     assignments (mirrors realistic effort variance).
 *   - `userId`, `teamId`, `managerId` are RFC 4122 v4 UUIDs (random by
 *     default; tests override to link real entities).
 *   - `requiredCompetencyIds` contains 0–3 UUIDs (most assignments
 *     require 0–2 competencies; a few require 3).
 *
 * @see AAP §0.5.1.12 — file mandate (Factories, Mocks, and Test Utilities).
 * @see AAP §0.4.4 — Test Data and Fixtures Design (live-mode cleanup).
 * @see AAP §0.10.1 — User-specified directives (parallel-safe, mock-first).
 * @see e2e/pages/workforce/assignment-list.page.ts,
 *      assignment-detail.page.ts, assignment-form.page.ts — POM consumers.
 * @see e2e/mocks/handlers/workforce.handler.ts — mock handler consumer.
 * @see e2e/fixtures/api-responses/workforce/assignments-list.json,
 *      assignment-detail.json — fixture shape references.
 * @see e2e/utils/test-data-cleanup.ts — live-mode sweeper that relies
 *      on the `e2e-test-` prefix on `WorkforceAssignment.title` to
 *      identify deletion candidates.
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
 * Lifecycle status of a workforce assignment.
 *
 * Closed union for compile-time safety: test code that overrides
 * `status` with a typo (e.g., `status: 'compleated'`) fails at compile
 * time rather than producing a confusing runtime mismatch.
 *
 * - `'pending'`   — Created but not yet started; no work logged.
 * - `'active'`    — Currently in progress; partial `actualHours` accrue.
 * - `'completed'` — Successfully finished; `endDate` is non-null and
 *                   `actualHours` reflects realised effort (~`estimatedHours`).
 * - `'cancelled'` — Terminated before completion; `endDate` may or may
 *                   not be set depending on when cancellation occurred.
 */
export type WorkforceAssignmentStatus = 'pending' | 'active' | 'completed' | 'cancelled';

/**
 * Type / category of a workforce assignment.
 *
 * Closed union for compile-time safety.
 *
 * - `'project'`  — Long-running project assignment (weeks / months);
 *                  typically has clear `startDate` / `endDate`.
 * - `'task'`     — Short-term task (hours / days); often a single
 *                  deliverable with a tight deadline.
 * - `'rotation'` — Recurring rotational duty (e.g., on-call rotation,
 *                  rotational training).
 * - `'shift'`    — Time-bounded shift assignment (e.g., specific shift
 *                  on a given calendar day).
 */
export type WorkforceAssignmentType = 'project' | 'task' | 'rotation' | 'shift';

/**
 * Priority level of an assignment.
 *
 * Closed union for compile-time safety. The four-level priority scale
 * is the canonical Whoville-Client priority taxonomy used across the
 * Workforce, Assessments, and Competencies modules.
 */
type WorkforceAssignmentPriority = 'low' | 'medium' | 'high' | 'critical';

/**
 * WorkforceAssignment entity. Represents the assignment of a user (and
 * the team they belong to) to a project / task / rotation / shift in
 * the Whoville-Client Workforce module.
 *
 * Migration-proof shape: primitive types only. Cross-factory
 * relationships stored as UUID strings (see file-level JSDoc, "Cross-
 * factory references").
 *
 * Field stability:
 *   - `id` is the stable primary key.
 *   - `title` is the user-facing display label and the cleanup sweeper's
 *     match field; it carries the `e2e-test-` prefix.
 *   - `assignmentType` and `status` are closed unions for type-safe
 *     overrides at the test-authoring layer.
 *   - `userId`, `teamId`, `managerId` are required UUID references.
 *   - `startDate` / `endDate` are date-only ISO strings (`'YYYY-MM-DD'`)
 *     because workforce assignments are scheduled at day granularity,
 *     not minute granularity. `endDate` is nullable for open-ended
 *     assignments.
 *   - `estimatedHours` and `actualHours` are non-negative integers.
 *   - `priority` is optional (some teams don't track priority).
 *   - `requiredCompetencyIds` is optional; an empty array means
 *     "no required competencies" (semantically distinct from `undefined`,
 *     which means "competency requirements are not specified").
 *
 * @see AAP §0.5.1.13 — `e2e/fixtures/api-responses/workforce/assignments-list.json`
 *      and `assignment-detail.json` mirror this shape.
 */
export interface WorkforceAssignment {
  /** UUID identifier (RFC 4122 v4). */
  readonly id: string;
  /**
   * `e2e-test-` prefixed title for live-mode cleanup eligibility.
   *
   * Format: `e2e-test-<faker-hacker-phrase> <8-char-suffix>` (e.g.,
   * `'e2e-test-Migrate the optical SSL system x7y8a3bc'`). The prefix
   * is the sentinel value the live-mode sweeper matches; the suffix
   * guarantees uniqueness across parallel workers.
   */
  readonly title: string;
  /**
   * Free-text description of the assignment scope (deliverables,
   * context, rationale). Realistic prose generated by
   * {@link https://fakerjs.dev/api/lorem.html#paragraph faker.lorem.paragraph}
   * (2–4 sentences). Tests for character limits or rendering overflow
   * override this field directly.
   */
  readonly description: string;
  /** Type / category of assignment (closed union — see {@link WorkforceAssignmentType}). */
  readonly assignmentType: WorkforceAssignmentType;
  /** Current lifecycle status (closed union — see {@link WorkforceAssignmentStatus}). */
  readonly status: WorkforceAssignmentStatus;
  /**
   * UUID of the assigned user. Cross-factory reference: tests that
   * need to link to a specific user override this field with the real
   * user's `id`.
   */
  readonly userId: string;
  /**
   * UUID of the team this assignment belongs to. Cross-factory
   * reference: tests linking to a specific team override directly.
   */
  readonly teamId: string;
  /**
   * UUID of the manager who created / owns the assignment. May differ
   * from `userId` (e.g., a manager creating an assignment on behalf of
   * a team member). Cross-factory reference.
   */
  readonly managerId: string;
  /**
   * ISO 8601 date-only string (`'YYYY-MM-DD'`) for assignment start.
   * Anchored to the deterministic date anchor for seed reproducibility.
   */
  readonly startDate: string;
  /**
   * ISO 8601 date-only string (`'YYYY-MM-DD'`) for assignment end, or
   * `null` for open-ended assignments. When non-null, guaranteed to be
   * greater than or equal to `startDate`. Always non-null when
   * `status === 'completed'`.
   */
  readonly endDate: string | null;
  /**
   * Estimated effort in hours. Integer in [8, 200] by default — the
   * lower bound matches the smallest realistic task (1 day) and the
   * upper bound matches a typical multi-week project. Tests for very
   * small or very large estimates override directly.
   */
  readonly estimatedHours: number;
  /**
   * Actual logged hours. Integer ≥ 0. For non-completed assignments
   * this is in [0, estimatedHours] (work-in-progress); for completed
   * assignments it is within ±30% of `estimatedHours` (realistic
   * effort variance).
   */
  readonly actualHours: number;
  /**
   * Optional priority level. Drawn from the canonical four-level
   * priority scale ({@link WorkforceAssignmentPriority}). Some teams
   * don't track priority and may submit assignments with this field
   * absent — tests for the no-priority path override with `undefined`.
   */
  readonly priority?: WorkforceAssignmentPriority;
  /**
   * Optional list of competency UUIDs required to perform this
   * assignment. Cross-factory references to {@link Competency.id}
   * entities (defined in `e2e/factories/competency.factory.ts`).
   *
   * Empty array means "no required competencies" (semantically
   * distinct from absent / `undefined` which means "requirements not
   * specified"). Cross-module integration tests
   * (`01-cross-module-workforce-competency.int.spec.ts`) override this
   * field with real Competency UUIDs to exercise the "user lacks
   * competency X" denial UX.
   */
  readonly requiredCompetencyIds?: ReadonlyArray<string>;
  /** ISO 8601 timestamp of creation (e.g., `'2025-04-12T08:30:00.000Z'`). */
  readonly createdAt: string;
  /** ISO 8601 timestamp of last update. Optional — absent for never-modified rows. */
  readonly updatedAt?: string;
}

// ---------------------------------------------------------------------------
// Internal constants — file-local; not exported.
// ---------------------------------------------------------------------------

/** Common prefix applied to every entity title for cleanup eligibility. */
const E2E_TEST_PREFIX = 'e2e-test-';

/** Length of the random alphanumeric uniqueness suffix appended to each title. */
const UNIQUE_SUFFIX_LENGTH = 8;

/**
 * Maximum length of the faker-generated title base before the unique
 * suffix is appended. Keeps the total title under most database
 * `VARCHAR(255)` limits even after the prefix and suffix are added.
 */
const TITLE_BASE_MAX_LENGTH = 60;

/** Closed list of values emitted for `WorkforceAssignmentType`. */
const ASSIGNMENT_TYPES: ReadonlyArray<WorkforceAssignmentType> = [
  'project',
  'task',
  'rotation',
  'shift',
];

/** Closed list of values emitted for `WorkforceAssignmentPriority`. */
const PRIORITY_VALUES: ReadonlyArray<WorkforceAssignmentPriority> = [
  'low',
  'medium',
  'high',
  'critical',
];

/**
 * Probability (0–1) that a generated assignment is in the `'completed'`
 * status. Most active workflows have 20–40 % completed assignments at
 * any given moment; 0.30 sits in the middle of that band and produces
 * a realistic distribution between in-progress and done.
 */
const PROBABILITY_COMPLETED = 0.3;

/**
 * Status values emitted for non-completed assignments. `'pending'` and
 * `'active'` are equally weighted because both represent "in-flight"
 * states the UI must render. `'cancelled'` is intentionally excluded
 * from the default distribution — tests for the cancelled-path
 * override `status` directly.
 */
const NON_COMPLETED_STATUSES: ReadonlyArray<WorkforceAssignmentStatus> = ['pending', 'active'];

/**
 * Lookback window (days) for `startDate`. The factory generates
 * `startDate` as `dateAnchor - random(0, days)`, producing dates in
 * the recent past relative to the anchor.
 */
const RECENT_DAYS_START = 60;

/**
 * Forward window (years) for `endDate`. For completed assignments,
 * `endDate` is generated as `startDate + random(0, years)` —
 * fractional years are supported by faker.
 */
const FUTURE_YEARS_END = 0.5;

/** Lower bound of estimated hours. One business day. */
const ESTIMATED_HOURS_MIN = 8;

/** Upper bound of estimated hours. ~5 weeks of full-time work. */
const ESTIMATED_HOURS_MAX = 200;

/**
 * Multiplier ranges for `actualHours` of a completed assignment.
 * Realistic effort variance for delivered work is typically within
 * ±30 % of estimate.
 */
const COMPLETED_ACTUAL_HOURS_MIN_RATIO = 0.7;
const COMPLETED_ACTUAL_HOURS_MAX_RATIO = 1.3;

/** Lookback window (days) for `createdAt` timestamps. */
const RECENT_DAYS_CREATED = 90;

/** Lookback window (days) for `updatedAt` timestamps. */
const RECENT_DAYS_UPDATED = 7;

/** Sentence-count range for the `description` field. */
const DESCRIPTION_MIN_SENTENCES = 2;
const DESCRIPTION_MAX_SENTENCES = 4;

/**
 * Pool size for the `requiredCompetencyIds` candidate list. The factory
 * generates this many fresh UUIDs and then samples 0–3 from the pool.
 * A small pool with sampling produces realistic distributions and keeps
 * the per-call faker invocation count bounded.
 */
const COMPETENCY_POOL_SIZE = 5;

/** Min / max number of competency IDs included in `requiredCompetencyIds`. */
const REQUIRED_COMPETENCY_MIN = 0;
const REQUIRED_COMPETENCY_MAX = 3;

/**
 * Regex used to strip terminal punctuation (`.`, `!`, `?`) from
 * `faker.hacker.phrase()` output before constructing the title. Faker
 * generates whole sentences with terminal punctuation; titles read more
 * naturally without it. The regex is global so all occurrences in the
 * phrase are stripped (not just the final character).
 */
const TITLE_PUNCTUATION_STRIP_RE = /[!.?]/g;

// ---------------------------------------------------------------------------
// Determinism anchor (per AAP §0.4.4)
//
// Faker's `date.*` API family — `recent`, `between`, `anytime`, `future`,
// `past` — defaults `refDate` to `new Date()` (the wall-clock). Successive
// invocations under the SAME seed therefore produce ms-level drift in any
// generated ISO timestamp, breaking the byte-identical reproducibility
// AAP §0.4.4 requires ("randomized but deterministic (seedable) entity
// instances"). QA Issue #3 reproduced this defect at ~10 % rate.
//
// The fix: derive a date anchor purely from the seeded RNG via
// `faker.number.int()` over a FIXED epoch-millisecond range that does not
// reference `Date.now()` / `new Date()` at all. The two constants below
// span 2020-01-01 → 2030-12-31 UTC, a window large enough to produce
// realistic-looking timestamps for the lifetime of this test suite without
// ever depending on the wall-clock.
//
// All `faker.date.*` calls in this file pass an explicit `refDate:
// dateAnchor` (or use the anchor as a chained reference for date-after-
// date computations) so the entire date-generation graph is
// seed-deterministic.
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

/**
 * Convert a `Date` to an ISO 8601 date-only string (`'YYYY-MM-DD'`).
 *
 * Workforce assignments are scheduled at day granularity, not minute
 * granularity, so the date-only form matches the API contract for
 * `startDate` / `endDate` fields. Implemented inline (rather than
 * importing a date library) to keep the foundational-layer constraint
 * intact.
 *
 * @param d The `Date` to convert.
 * @returns The date in `'YYYY-MM-DD'` form.
 */
function dateOnlyIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Generate a {@link WorkforceAssignment} instance with sensible defaults
 * and optional overrides.
 *
 * Each invocation produces an independent, parallel-safe instance with
 * internally-consistent status-conditional fields:
 *   - `id` is a fresh RFC 4122 v4 UUID.
 *   - `title` carries the `e2e-test-` prefix and an 8-character random
 *     lowercase alphanumeric suffix to guarantee uniqueness across
 *     parallel test workers.
 *   - `assignmentType` is randomly drawn from the four-value closed
 *     union; `status` is `'completed'` with probability ~0.30 and
 *     otherwise `'pending'` or `'active'` (`'cancelled'` requires an
 *     explicit override).
 *   - `startDate` is a date-only ISO string anchored to the
 *     deterministic date anchor.
 *   - `endDate` is non-null when `status === 'completed'` and `null`
 *     otherwise. When non-null, `endDate >= startDate`.
 *   - `actualHours` is bounded by `[0, estimatedHours]` for
 *     non-completed, and within ±30 % of `estimatedHours` for
 *     completed.
 *   - `requiredCompetencyIds` contains 0–3 fresh UUIDs sampled from a
 *     pool of 5 candidates.
 *   - `priority` is randomly drawn from the four-value priority union.
 *
 * The trailing `...overrides` spread enables targeted customisation
 * without having to construct the full object — a common pattern in
 * test code.
 *
 * @example Default assignment (typically active or pending):
 * ```ts
 * import { workforceAssignmentFactory } from '@factories';
 *
 * const assignment = workforceAssignmentFactory();
 * // -> {
 * //      id: 'a1b2c3d4-...',
 * //      title: 'e2e-test-Migrate the optical SSL system x7y8a3bc',
 * //      status: 'active',
 * //      assignmentType: 'project',
 * //      ...
 * //    }
 * ```
 *
 * @example Targeted override (force completed status):
 * ```ts
 * const completed = workforceAssignmentFactory({
 *   status: 'completed',
 *   actualHours: 120,
 * });
 * ```
 *
 * @example Linked-entity override (assign to a specific team):
 * ```ts
 * const linked = workforceAssignmentFactory({
 *   teamId: knownTeam.id,
 *   userId: knownUser.id,
 *   managerId: knownManager.id,
 * });
 * ```
 *
 * @example Cross-module integration override (require specific competency):
 * ```ts
 * const requiresCloud = workforceAssignmentFactory({
 *   requiredCompetencyIds: [cloudCompetency.id],
 * });
 * ```
 *
 * @example Cancelled-path override (testing cancellation UX):
 * ```ts
 * const cancelled = workforceAssignmentFactory({
 *   status: 'cancelled',
 *   actualHours: 4,
 * });
 * ```
 *
 * @param overrides Partial fields to override on the generated instance.
 *                  Defaults to an empty object.
 * @returns A fully-populated {@link WorkforceAssignment} object.
 */
export function workforceAssignmentFactory(
  overrides: Partial<WorkforceAssignment> = {},
): WorkforceAssignment {
  // Determinism anchor — every faker.date.* call below uses this as
  // its refDate so the entire date graph is seed-reproducible.
  const dateAnchor = deterministicDateAnchor();

  // 8-character lowercase alphanumeric suffix for parallel-worker
  // uniqueness. The prefix + faker phrase + suffix together form the
  // title that the live-mode cleanup sweeper matches by prefix.
  const uniqueSuffix = faker.string.alphanumeric({
    length: UNIQUE_SUFFIX_LENGTH,
    casing: 'lower',
  });

  // Faker's hacker.phrase produces sentences like "We need to bypass
  // the optical SSL system!" — silly enough to be obviously test data,
  // technical enough to feel realistic for a workforce-management UI.
  // Strip terminal punctuation (`.`, `!`, `?`) for a clean title and
  // truncate to TITLE_BASE_MAX_LENGTH so the total stays under typical
  // database VARCHAR limits.
  const rawPhrase = faker.hacker.phrase();
  const cleanedPhrase = rawPhrase.replace(TITLE_PUNCTUATION_STRIP_RE, '');
  const titleBase = cleanedPhrase.slice(0, TITLE_BASE_MAX_LENGTH).trim();
  const title = `${E2E_TEST_PREFIX}${titleBase} ${uniqueSuffix}`;

  // 30 % of assignments are completed (matches production reality where
  // most assignments are in-flight). Completed assignments require an
  // `endDate`; non-completed ones leave it null.
  const isCompleted = faker.datatype.boolean({ probability: PROBABILITY_COMPLETED });
  const status: WorkforceAssignmentStatus = isCompleted
    ? 'completed'
    : faker.helpers.arrayElement<WorkforceAssignmentStatus>(NON_COMPLETED_STATUSES);

  // Generate `startDate` first (recent past relative to the anchor),
  // then conditionally compute `endDate` after it so the
  // `endDate >= startDate` invariant holds when non-null. The anchor
  // is the seed-deterministic reference, NOT the wall-clock — see the
  // determinism anchor section.
  const startDateObj = faker.date.recent({ days: RECENT_DAYS_START, refDate: dateAnchor });
  const endDateObj = isCompleted
    ? faker.date.future({ years: FUTURE_YEARS_END, refDate: startDateObj })
    : null;
  const startDate = dateOnlyIso(startDateObj);
  const endDate = endDateObj === null ? null : dateOnlyIso(endDateObj);

  // Estimated hours: integer in [8, 200]. Lower bound is one business
  // day; upper bound is roughly five weeks of full-time work.
  const estimatedHours = faker.number.int({
    min: ESTIMATED_HOURS_MIN,
    max: ESTIMATED_HOURS_MAX,
  });

  // Actual hours: bounded differently depending on status.
  //   - Completed: within ±30 % of estimate (realistic effort variance).
  //   - Non-completed: in [0, estimatedHours] (work-in-progress).
  // Math.floor on the multiplied bounds keeps the result strictly
  // integer; for the smallest estimatedHours (8), the completed band
  // becomes [5, 10] which is still a meaningful range.
  const actualHours = isCompleted
    ? faker.number.int({
        min: Math.floor(estimatedHours * COMPLETED_ACTUAL_HOURS_MIN_RATIO),
        max: Math.floor(estimatedHours * COMPLETED_ACTUAL_HOURS_MAX_RATIO),
      })
    : faker.number.int({ min: 0, max: estimatedHours });

  // Cross-factory references stored as UUID strings. Tests that need
  // to link to a specific user, team, or manager override these via
  // the `overrides` parameter — see the @example blocks above.
  const userId = faker.string.uuid();
  const teamId = faker.string.uuid();
  const managerId = faker.string.uuid();

  // Closed-union random selection. The explicit type parameter
  // preserves narrowing — `assignmentType` is typed as
  // `WorkforceAssignmentType`, not `string`.
  const assignmentType = faker.helpers.arrayElement<WorkforceAssignmentType>(ASSIGNMENT_TYPES);

  // Closed-union random selection. The explicit type parameter
  // preserves narrowing — `priority` is typed as
  // `WorkforceAssignmentPriority`, not `string`.
  const priority = faker.helpers.arrayElement<WorkforceAssignmentPriority>(PRIORITY_VALUES);

  // Generate a small pool of candidate competency UUIDs and sample
  // 0–3 of them. Cross-module integration tests override this entire
  // field to link to specific Competency entities.
  const competencyPool: ReadonlyArray<string> = Array.from({ length: COMPETENCY_POOL_SIZE }, () =>
    faker.string.uuid(),
  );
  const requiredCompetencyIds: ReadonlyArray<string> = faker.helpers.arrayElements(competencyPool, {
    min: REQUIRED_COMPETENCY_MIN,
    max: REQUIRED_COMPETENCY_MAX,
  });

  // Realistic multi-sentence description (2–4 sentences). Tests for
  // character limits or rendering overflow override directly.
  const description = faker.lorem.paragraph({
    min: DESCRIPTION_MIN_SENTENCES,
    max: DESCRIPTION_MAX_SENTENCES,
  });

  // Lifecycle timestamps — both anchored to the deterministic anchor.
  // `updatedAt` uses a tighter window (7 days) so it's always more
  // recent than `createdAt` in the typical case.
  const createdAt = faker.date
    .recent({ days: RECENT_DAYS_CREATED, refDate: dateAnchor })
    .toISOString();
  const updatedAt = faker.date
    .recent({ days: RECENT_DAYS_UPDATED, refDate: dateAnchor })
    .toISOString();

  return {
    id: faker.string.uuid(),
    title,
    description,
    assignmentType,
    status,
    userId,
    teamId,
    managerId,
    startDate,
    endDate,
    estimatedHours,
    actualHours,
    priority,
    requiredCompetencyIds,
    createdAt,
    updatedAt,
    ...overrides,
  };
}
