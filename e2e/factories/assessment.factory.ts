/**
 * Assessment and AssessmentResponse entity factories for the
 * Whoville-Client Assessments module.
 *
 * Models the canonical Assessments-module data shapes:
 *   - `Assessment` — a single assessment cycle / template instance
 *     scheduling a set of questions for a target user population.
 *   - `AssessmentResponse` — a single user's response to an assessment,
 *     including individual question scores and overall completion state.
 *
 * Generates entities with `e2e-test-` prefixed names so the live-mode
 * entity sweeper (e2e/utils/test-data-cleanup.ts) can identify orphan
 * test entities for removal per AAP §0.4.4.
 *
 * Uses `@faker-js/faker` (version pinned per AAP §0.6.1: `^9.0.0`).
 *
 * Foundational layer — imports only `@faker-js/faker`. Pure data
 * generation with no I/O, no Node.js built-ins, no other factory
 * dependencies (no sibling-factory imports per AAP §0.10.1). Each call
 * produces an independent, parallel-safe instance.
 *
 * ## Cleanup contract (AAP §0.4.4)
 *
 * The live-mode sweeper identifies deletion candidates by inspecting the
 * `name` field on `Assessment` and the `reference` field on
 * `AssessmentResponse`. Both fields begin with the configured
 * `e2e-test-` prefix and a randomized 8-character alphanumeric suffix
 * for parallel-worker uniqueness.
 *
 * ## Migration-proof shape (AAP §0.10.1)
 *
 * All exported types use only primitive TypeScript types and
 * `ReadonlyArray<...>` for collections.
 *
 * ## Determinism (AAP §0.4.4)
 *
 * All `faker.date.*` calls use a seed-deterministic `refDate` produced
 * by `deterministicDateAnchor()`. Chronological invariants
 * (`startDate ≤ endDate`, `submittedAt ≤ scoredAt`, `cycleEndDate ≥
 * cycleStartDate`) are enforced.
 *
 * @see AAP §0.5.1.12, §0.4.4, §0.10.1.
 * @see e2e/pages/assessments/template-list.page.ts,
 *      cycle-list.page.ts, response-capture.page.ts — POM consumers.
 * @see e2e/mocks/handlers/assessments.handler.ts — mock handler consumer.
 * @see e2e/fixtures/api-responses/assessments/templates-list.json,
 *      cycles-list.json, responses.json — fixture shape references.
 */

// ---------------------------------------------------------------------------
// Imports — strictly limited to `@faker-js/faker`.
// ---------------------------------------------------------------------------

import { faker } from '@faker-js/faker';

// ---------------------------------------------------------------------------
// Public type definitions
// ---------------------------------------------------------------------------

/**
 * Assessment lifecycle status.
 *
 * Closed union for compile-time safety.
 *
 * - `'draft'`     — Assessment is being authored; not yet launched.
 * - `'scheduled'` — Launched but not yet open to respondents.
 * - `'active'`    — Currently accepting responses.
 * - `'closed'`    — Closed to new responses; in scoring or calibration.
 * - `'archived'`  — Final state after report distribution.
 */
export type AssessmentStatus = 'draft' | 'scheduled' | 'active' | 'closed' | 'archived';

/**
 * Assessment category — typical enterprise-assessment use cases.
 *
 * Closed union for compile-time safety.
 *
 * - `'performance'`   — Annual or quarterly performance review.
 * - `'competency'`    — Skill / competency assessment.
 * - `'engagement'`    — Employee engagement / culture survey.
 * - `'compliance'`    — Regulatory compliance attestation.
 * - `'self'`          — Self-assessment for goal-setting / reflection.
 * - `'360'`           — 360-degree feedback (multiple raters).
 */
export type AssessmentCategory =
  | 'performance'
  | 'competency'
  | 'engagement'
  | 'compliance'
  | 'self'
  | '360';

/**
 * AssessmentResponse lifecycle status.
 *
 * Closed union for compile-time safety.
 *
 * - `'not_started'` — Respondent has not begun answering.
 * - `'in_progress'` — Respondent has started but not yet submitted.
 * - `'submitted'`   — Respondent has submitted; awaiting scoring.
 * - `'scored'`      — Submitted and scored; available in reports.
 * - `'calibrated'`  — Score has been calibrated by reviewer.
 */
export type AssessmentResponseStatus =
  | 'not_started'
  | 'in_progress'
  | 'submitted'
  | 'scored'
  | 'calibrated';

/**
 * Assessment entity. Represents a single assessment cycle / template
 * instance in the Whoville-Client Assessments module.
 *
 * Migration-proof shape: primitive types only.
 *
 * Field stability:
 *   - `id` and `name` are stable identifiers; `name` is the cleanup marker.
 *   - `templateId` is the UUID of the canonical template this assessment
 *     was instantiated from. `null` for ad-hoc assessments.
 *   - Date fields use ISO 8601 with timezone for cycle scheduling.
 *   - Cross-factory references (`ownerId`, `templateId`) are stored as
 *     UUID strings.
 */
export interface Assessment {
  /** UUID identifier (RFC 4122 v4). */
  readonly id: string;
  /**
   * `e2e-test-` prefixed display name for live-mode cleanup eligibility.
   *
   * Format: `e2e-test-assessment-<category>-<8-char-suffix>` (e.g.,
   * `'e2e-test-assessment-performance-x7y8a3bc'`).
   */
  readonly name: string;
  /**
   * Optional human-readable description / instructions for respondents.
   * Realistic prose generated by faker.
   */
  readonly description?: string;
  /** Assessment category (closed union — see {@link AssessmentCategory}). */
  readonly category: AssessmentCategory;
  /** Current lifecycle status (closed union — see {@link AssessmentStatus}). */
  readonly status: AssessmentStatus;
  /**
   * UUID of the template this assessment was instantiated from. `null`
   * for ad-hoc assessments authored directly without a template.
   */
  readonly templateId: string | null;
  /** UUID of the owner / author of the assessment. */
  readonly ownerId: string;
  /** ISO 8601 timestamp when the assessment opens to respondents. */
  readonly startDate: string;
  /**
   * ISO 8601 timestamp when the assessment closes to new responses.
   * Guaranteed to be ≥ `startDate`.
   */
  readonly endDate: string;
  /** Total number of questions in the assessment. */
  readonly questionCount: number;
  /**
   * UUIDs of users targeted by this assessment (the audience). Empty
   * array for assessments still in draft. `ReadonlyArray<string>` to
   * communicate immutability at the type level.
   */
  readonly targetUserIds: ReadonlyArray<string>;
  /** ISO 8601 timestamp of creation. */
  readonly createdAt: string;
  /** ISO 8601 timestamp of last update. Optional. */
  readonly updatedAt?: string;
}

/**
 * AssessmentResponse entity. Represents a single user's response to an
 * Assessment.
 *
 * Migration-proof shape: primitive types only. The `answers` array
 * holds question-level scoring data as flat tuples to avoid nested
 * complex objects beyond what is strictly necessary.
 *
 * Field stability:
 *   - `id` and `reference` are stable identifiers; `reference` is the
 *     cleanup marker.
 *   - `assessmentId` and `respondentId` are required UUID references.
 *   - Status-conditional fields (`submittedAt`, `scoredAt`, `score`,
 *     `calibratedAt`, `calibratedById`) are populated only in their
 *     corresponding lifecycle states.
 *   - Chronological invariant: `startedAt ≤ submittedAt ≤ scoredAt ≤
 *     calibratedAt` when each is non-null.
 */
export interface AssessmentResponse {
  /** UUID identifier (RFC 4122 v4). */
  readonly id: string;
  /**
   * `e2e-test-response-` prefixed reference label for live-mode cleanup.
   *
   * Format: `e2e-test-response-<8-char-suffix>`.
   */
  readonly reference: string;
  /** UUID of the parent {@link Assessment}. */
  readonly assessmentId: string;
  /** UUID of the user who is the respondent (the rater). */
  readonly respondentId: string;
  /**
   * UUID of the user being assessed. May differ from `respondentId` for
   * 360-degree assessments where one user rates another. For self-
   * assessments, equal to `respondentId`.
   */
  readonly subjectId: string;
  /** Current lifecycle status (closed union — see {@link AssessmentResponseStatus}). */
  readonly status: AssessmentResponseStatus;
  /**
   * Per-question answers. Each tuple is
   * `[questionId, score, optionalCommentLength]` — a flat
   * representation that avoids nested objects and is cheap to compare.
   */
  readonly answers: ReadonlyArray<readonly [string, number, number]>;
  /**
   * Overall response score (0–100). `null` for responses not yet scored.
   * Integer in the [0, 100] range when present.
   */
  readonly score: number | null;
  /** ISO 8601 timestamp when the respondent first opened the assessment. */
  readonly startedAt: string;
  /**
   * ISO 8601 timestamp when the respondent submitted. `null` for
   * responses still in `'not_started'` or `'in_progress'`.
   */
  readonly submittedAt: string | null;
  /**
   * ISO 8601 timestamp when scoring completed. `null` for responses not
   * yet scored.
   */
  readonly scoredAt: string | null;
  /**
   * UUID of the user who calibrated the score. Optional — present only
   * when `status === 'calibrated'`.
   */
  readonly calibratedById?: string;
  /**
   * ISO 8601 timestamp when calibration completed. `null` for responses
   * not yet calibrated.
   */
  readonly calibratedAt: string | null;
  /** ISO 8601 timestamp of creation. */
  readonly createdAt: string;
  /** ISO 8601 timestamp of last update. Optional. */
  readonly updatedAt?: string;
}

// ---------------------------------------------------------------------------
// Internal constants — file-local; not exported.
// ---------------------------------------------------------------------------

/** Common prefix applied for cleanup eligibility. */
const E2E_TEST_PREFIX = 'e2e-test-';

/** Length of the random alphanumeric uniqueness suffix. */
const UNIQUE_SUFFIX_LENGTH = 8;

/** Closed list of values emitted for `AssessmentCategory`. */
const ASSESSMENT_CATEGORIES: ReadonlyArray<AssessmentCategory> = [
  'performance',
  'competency',
  'engagement',
  'compliance',
  'self',
  '360',
];

/**
 * Weighted distribution for `AssessmentStatus`. `'active'` and
 * `'closed'` are over-represented to match production reality.
 */
const ASSESSMENT_STATUS_DISTRIBUTION: ReadonlyArray<AssessmentStatus> = [
  'active',
  'active',
  'active',
  'closed',
  'closed',
  'scheduled',
  'draft',
  'archived',
];

/**
 * Weighted distribution for `AssessmentResponseStatus`. `'submitted'`
 * and `'scored'` are over-represented to match production reality.
 */
const ASSESSMENT_RESPONSE_STATUS_DISTRIBUTION: ReadonlyArray<AssessmentResponseStatus> = [
  'submitted',
  'submitted',
  'scored',
  'scored',
  'scored',
  'in_progress',
  'in_progress',
  'not_started',
  'calibrated',
];

/** Probability (0–1) that a generated assessment has a description. */
const PROBABILITY_HAS_DESCRIPTION = 0.85;

/** Probability (0–1) that a generated assessment is template-derived. */
const PROBABILITY_HAS_TEMPLATE = 0.7;

/** Minimum / maximum number of questions per assessment. */
const MIN_QUESTION_COUNT = 5;
const MAX_QUESTION_COUNT = 50;

/** Minimum / maximum number of target users per assessment. */
const MIN_TARGET_USERS = 1;
const MAX_TARGET_USERS = 30;

/** Minimum / maximum overall response score (0–100). */
const MIN_SCORE = 0;
const MAX_SCORE = 100;

/** Per-question score range (typical 1–5 Likert scale). */
const PER_QUESTION_SCORE_MIN = 1;
const PER_QUESTION_SCORE_MAX = 5;

/** Per-question comment length range (chars). 0 = no comment. */
const COMMENT_LENGTH_MIN = 0;
const COMMENT_LENGTH_MAX = 500;

/** Lookback window (days) for `createdAt` and `startedAt`. */
const RECENT_DAYS_CREATED = 365;

/** Lookback window (days) for `updatedAt`. */
const RECENT_DAYS_UPDATED = 30;

/** Cycle window (days) — typical assessment cycle duration. */
const CYCLE_DURATION_MIN_DAYS = 14;
const CYCLE_DURATION_MAX_DAYS = 90;

/** Future window (days) for `startDate` relative to anchor. */
const START_DATE_OFFSET_MIN_DAYS = -180;
const START_DATE_OFFSET_MAX_DAYS = 30;

/** Minimum / maximum word count for description. */
const MIN_DESCRIPTION_WORDS = 6;
const MAX_DESCRIPTION_WORDS = 15;

// ---------------------------------------------------------------------------
// Determinism anchor (per AAP §0.4.4)
// ---------------------------------------------------------------------------

/** Lower bound of the deterministic date anchor: 2020-01-01T00:00:00.000Z. */
const ANCHOR_MIN_EPOCH_MS = Date.UTC(2020, 0, 1);

/** Upper bound of the deterministic date anchor: 2030-12-31T00:00:00.000Z. */
const ANCHOR_MAX_EPOCH_MS = Date.UTC(2030, 11, 31);

/**
 * Generate a seed-deterministic `Date` anchor without consulting the
 * wall-clock. See e2e/factories/role-grant.factory.ts for the full
 * rationale (the contained fix for QA Issue #3).
 */
function deterministicDateAnchor(): Date {
  return new Date(faker.number.int({ min: ANCHOR_MIN_EPOCH_MS, max: ANCHOR_MAX_EPOCH_MS }));
}

// ---------------------------------------------------------------------------
// Public factories
// ---------------------------------------------------------------------------

/**
 * Generate an {@link Assessment} instance with sensible defaults and
 * optional overrides.
 *
 * Each invocation produces an independent, parallel-safe instance:
 *   - `id` is a fresh RFC 4122 v4 UUID.
 *   - `name` carries the `e2e-test-assessment-` prefix.
 *   - `category` and `status` are weighted to match production reality.
 *   - `startDate` and `endDate` are seed-deterministic ISO 8601
 *     timestamps; `endDate` is guaranteed ≥ `startDate`.
 *   - `targetUserIds` is an array of 1–30 fresh UUIDs.
 *
 * @example Default assessment:
 * ```ts
 * const a = assessmentFactory();
 * ```
 *
 * @example Targeted override (specific category and status):
 * ```ts
 * const perf = assessmentFactory({
 *   category: 'performance',
 *   status: 'active',
 *   targetUserIds: [user1.id, user2.id],
 * });
 * ```
 *
 * @param overrides Partial fields to override on the generated instance.
 * @returns A fully-populated {@link Assessment} object.
 */
export function assessmentFactory(overrides: Partial<Assessment> = {}): Assessment {
  // Category drives the name slug for traceability.
  const category: AssessmentCategory =
    faker.helpers.arrayElement<AssessmentCategory>(ASSESSMENT_CATEGORIES);

  // 8-character lowercase alphanumeric suffix for parallel-worker uniqueness.
  const uniqueSuffix = faker.string.alphanumeric({
    length: UNIQUE_SUFFIX_LENGTH,
    casing: 'lower',
  });
  const name = `${E2E_TEST_PREFIX}assessment-${category}-${uniqueSuffix}`;

  // Description present in ~85% of assessments.
  const hasDescription = faker.datatype.boolean({ probability: PROBABILITY_HAS_DESCRIPTION });
  const description = hasDescription
    ? faker.lorem.sentence({
        min: MIN_DESCRIPTION_WORDS,
        max: MAX_DESCRIPTION_WORDS,
      })
    : undefined;

  const status: AssessmentStatus = faker.helpers.arrayElement<AssessmentStatus>(
    ASSESSMENT_STATUS_DISTRIBUTION,
  );

  const hasTemplate = faker.datatype.boolean({ probability: PROBABILITY_HAS_TEMPLATE });
  const templateId = hasTemplate ? faker.string.uuid() : null;

  const ownerId = faker.string.uuid();
  const questionCount = faker.number.int({ min: MIN_QUESTION_COUNT, max: MAX_QUESTION_COUNT });

  const targetUserCount = faker.number.int({ min: MIN_TARGET_USERS, max: MAX_TARGET_USERS });
  const targetUserIds: ReadonlyArray<string> = Array.from({ length: targetUserCount }, () =>
    faker.string.uuid(),
  );

  // Determinism anchor — see `deterministicDateAnchor()`.
  const dateAnchor = deterministicDateAnchor();

  // startDate is offset from the anchor by [-180, +30] days; this gives
  // realistic distributions (some past cycles, some upcoming cycles)
  // while remaining seed-deterministic.
  const startDateMs =
    dateAnchor.getTime() +
    faker.number.int({
      min: START_DATE_OFFSET_MIN_DAYS * 24 * 60 * 60 * 1000,
      max: START_DATE_OFFSET_MAX_DAYS * 24 * 60 * 60 * 1000,
    });
  const startDate = new Date(startDateMs).toISOString();

  // endDate is startDate + cycle-duration; guaranteed ≥ startDate.
  const cycleDurationMs =
    faker.number.int({
      min: CYCLE_DURATION_MIN_DAYS,
      max: CYCLE_DURATION_MAX_DAYS,
    }) *
    24 *
    60 *
    60 *
    1000;
  const endDate = new Date(startDateMs + cycleDurationMs).toISOString();

  const createdAt = faker.date
    .recent({ days: RECENT_DAYS_CREATED, refDate: dateAnchor })
    .toISOString();
  const updatedAt = faker.date
    .recent({ days: RECENT_DAYS_UPDATED, refDate: dateAnchor })
    .toISOString();

  return {
    id: faker.string.uuid(),
    name,
    description,
    category,
    status,
    templateId,
    ownerId,
    startDate,
    endDate,
    questionCount,
    targetUserIds,
    createdAt,
    updatedAt,
    ...overrides,
  };
}

/**
 * Generate an {@link AssessmentResponse} instance with sensible defaults
 * and optional overrides.
 *
 * Each invocation produces an independent, parallel-safe instance with
 * internally-consistent status-conditional fields:
 *   - `id` is a fresh RFC 4122 v4 UUID.
 *   - `reference` carries the `e2e-test-response-` prefix.
 *   - Status-conditional fields populated coherently:
 *       - `'not_started'`  → submittedAt/scoredAt/calibratedAt all null
 *       - `'in_progress'`  → submittedAt/scoredAt/calibratedAt all null
 *       - `'submitted'`    → submittedAt non-null; scoredAt/calibratedAt null
 *       - `'scored'`       → submittedAt and scoredAt non-null; calibratedAt null
 *       - `'calibrated'`   → submittedAt, scoredAt, calibratedAt all non-null
 *   - Chronological invariant: `startedAt ≤ submittedAt ≤ scoredAt ≤
 *     calibratedAt` when each is non-null.
 *   - `score` is `null` until `'scored'`; integer in [0, 100] thereafter.
 *   - `answers` is a ReadonlyArray of `[questionId, score (1–5),
 *     commentLength (0–500)]` tuples.
 *
 * @example Default response:
 * ```ts
 * const r = responseFactory();
 * ```
 *
 * @example Scoped to a specific assessment:
 * ```ts
 * const r = responseFactory({
 *   assessmentId: assessment.id,
 *   respondentId: user.id,
 *   subjectId: user.id,
 * });
 * ```
 *
 * @example In-progress response for save-and-resume tests:
 * ```ts
 * const r = responseFactory({ status: 'in_progress' });
 * // r.submittedAt === null
 * ```
 *
 * @param overrides Partial fields to override on the generated instance.
 * @returns A fully-populated {@link AssessmentResponse} object.
 */
export function assessmentResponseFactory(
  overrides: Partial<AssessmentResponse> = {},
): AssessmentResponse {
  const uniqueSuffix = faker.string.alphanumeric({
    length: UNIQUE_SUFFIX_LENGTH,
    casing: 'lower',
  });
  const reference = `${E2E_TEST_PREFIX}response-${uniqueSuffix}`;

  const status: AssessmentResponseStatus = faker.helpers.arrayElement<AssessmentResponseStatus>(
    ASSESSMENT_RESPONSE_STATUS_DISTRIBUTION,
  );

  const assessmentId = faker.string.uuid();
  const respondentId = faker.string.uuid();
  // Subject defaults to respondent (self-assessment); ~30% have a
  // distinct subject to model 360-degree feedback flows.
  const subjectId = faker.datatype.boolean({ probability: 0.7 })
    ? respondentId
    : faker.string.uuid();

  // Generate per-question answers. Length matches the parent assessment's
  // questionCount in real flows; here we draw a representative count.
  const answerCount = faker.number.int({ min: MIN_QUESTION_COUNT, max: MAX_QUESTION_COUNT });
  const answers: ReadonlyArray<readonly [string, number, number]> = Array.from(
    { length: answerCount },
    () =>
      [
        faker.string.uuid(),
        faker.number.int({ min: PER_QUESTION_SCORE_MIN, max: PER_QUESTION_SCORE_MAX }),
        faker.number.int({ min: COMMENT_LENGTH_MIN, max: COMMENT_LENGTH_MAX }),
      ] as const,
  );

  // Determinism anchor — see `deterministicDateAnchor()`.
  const dateAnchor = deterministicDateAnchor();

  // startedAt: seed-deterministic ISO timestamp from the recent window
  // anchored to the date anchor.
  const startedAtDate = faker.date.recent({
    days: RECENT_DAYS_CREATED,
    refDate: dateAnchor,
  });
  const startedAt = startedAtDate.toISOString();

  // Status-conditional date fields, computed in chronological order so
  // the invariant `startedAt ≤ submittedAt ≤ scoredAt ≤ calibratedAt`
  // holds. Each subsequent date is anchored to the previous one as
  // `refDate` for `faker.date.between(...)` so the entire chain is
  // seed-deterministic.

  let submittedAt: string | null = null;
  let scoredAt: string | null = null;
  let score: number | null = null;
  let calibratedAt: string | null = null;
  let calibratedById: string | undefined;

  // 'submitted', 'scored', 'calibrated' all have submittedAt set
  if (status === 'submitted' || status === 'scored' || status === 'calibrated') {
    const submittedAtDate = faker.date.between({ from: startedAtDate, to: dateAnchor });
    submittedAt = submittedAtDate.toISOString();

    // 'scored', 'calibrated' have scoredAt + score set
    if (status === 'scored' || status === 'calibrated') {
      const scoredAtDate = faker.date.between({ from: submittedAtDate, to: dateAnchor });
      scoredAt = scoredAtDate.toISOString();
      score = faker.number.int({ min: MIN_SCORE, max: MAX_SCORE });

      // 'calibrated' has calibratedAt + calibratedById set
      if (status === 'calibrated') {
        const calibratedAtDate = faker.date.between({ from: scoredAtDate, to: dateAnchor });
        calibratedAt = calibratedAtDate.toISOString();
        calibratedById = faker.string.uuid();
      }
    }
  }

  const createdAt = faker.date
    .recent({ days: RECENT_DAYS_CREATED, refDate: dateAnchor })
    .toISOString();
  const updatedAt = faker.date
    .recent({ days: RECENT_DAYS_UPDATED, refDate: dateAnchor })
    .toISOString();

  return {
    id: faker.string.uuid(),
    reference,
    assessmentId,
    respondentId,
    subjectId,
    status,
    answers,
    score,
    startedAt,
    submittedAt,
    scoredAt,
    calibratedById,
    calibratedAt,
    createdAt,
    updatedAt,
    ...overrides,
  };
}
