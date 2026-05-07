/**
 * Assessment and AssessmentResponse entity factories for the
 * Whoville-Client Assessments module.
 *
 * Models the canonical Assessments-module data shapes:
 *   - `Assessment` — a single assessment template OR cycle in the
 *     Whoville-Client Assessments module. The discriminated `type`
 *     field (`'template' | 'cycle'`) drives conditional fields:
 *     templates have `endDate: null` and `participantIds: []`; cycles
 *     have populated `endDate` and at least one participant.
 *   - `AssessmentResponse` — a single user's response to an assessment
 *     cycle, including individual competency / question scores and an
 *     aggregated overall score.
 *   - `AssessmentScore` — a single scoring entry mapping a
 *     competency/question id to the score value (Likert 1–5 typical).
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
 * produces an independent, parallel-safe instance suitable for use by
 * Playwright workers running concurrently.
 *
 * ## Cleanup contract (AAP §0.4.4 — Live-mode database hygiene)
 *
 * The live-mode sweeper identifies deletion candidates by inspecting
 * the `name` field on `Assessment`. The field begins with the
 * configured `e2e-test-` prefix and a randomized 8-character
 * alphanumeric suffix guarantees uniqueness across parallel workers
 * per AAP §0.10.1. `AssessmentResponse` does NOT carry a name; it is
 * identified by its `assessmentId` foreign key — the sweeper deletes
 * the parent assessment and the backend cascades deletion of its
 * responses (per the documented backend contract).
 *
 * ## Migration-proof shape (AAP §0.10.1)
 *
 * All exported types use only primitive TypeScript types (`string`,
 * `number`, `boolean`, union literals, `null`) and `ReadonlyArray<...>`
 * for collections. No Angular-specific types, no Whoville-Client class
 * references, no runtime decorators. The interfaces survive the
 * Angular 11 → 12 → 13 → … → 21 migration path without modification;
 * HTTP API contract changes are the only events that require updates
 * here.
 *
 * ## Determinism (AAP §0.4.4 — "deterministic (seedable) entity instances")
 *
 * All `faker.date.*` calls use a seed-deterministic `refDate` produced
 * by `deterministicDateAnchor()`. The default `refDate: new Date()`
 * would otherwise read the wall-clock — which changes between
 * successive seeded invocations and produces 1ms-level drift in
 * `createdAt` / `updatedAt`, breaking byte-identical reproducibility.
 * See QA Issue #3 (reproduced in role-grant.factory.ts) for the
 * contained fix this anchor pattern embodies.
 *
 * ## Chronological invariants
 *
 * Every status-conditional date field maintains the relationship:
 *   `createdAt ≤ submittedAt ≤ reviewedAt`
 * when the corresponding fields are non-null. The factory uses
 * `faker.date.between()` with an explicit `refDate` for each step so
 * the entire chain is seed-deterministic.
 *
 * ## Internal-consistency invariants
 *
 *  - Templates (`type === 'template'`) have:
 *      `templateId === null`, `cycleId === null`,
 *      `endDate === null`, `participantIds === []`.
 *  - Cycles (`type === 'cycle'`) have:
 *      non-null `templateId`, non-null `cycleId`, non-null `endDate`,
 *      and (typically) one or more `participantIds`.
 *  - `AssessmentResponse.aggregatedScore` is the arithmetic mean of
 *      `scores[].score`, rounded to 2 decimal places.
 *  - `submittedAt` is non-null iff `status !== 'draft'`.
 *  - `reviewedAt` is non-null iff `status === 'reviewed' || status === 'finalized'`.
 *
 * @see AAP §0.5.1.12 — file mandate (Factories, Mocks, and Test Utilities).
 * @see AAP §0.4.4 — Test Data and Fixtures Design (live-mode cleanup).
 * @see AAP §0.10.1 — User-specified directives (parallel-safe, mock-first).
 * @see e2e/pages/assessments/template-list.page.ts,
 *      template-detail.page.ts, template-form.page.ts,
 *      cycle-list.page.ts, cycle-detail.page.ts, cycle-form.page.ts,
 *      response-capture.page.ts, scoring.page.ts, calibration.page.ts,
 *      reporting.page.ts — POM consumers.
 * @see e2e/mocks/handlers/assessments.handler.ts — mock handler consumer
 *      (reads JSON fixtures directly; this factory powers fixture
 *      generation in tests/scripts that need fresh data).
 * @see e2e/fixtures/api-responses/assessments/templates-list.json,
 *      template-detail.json, cycles-list.json, cycle-detail.json,
 *      responses.json — fixture shape references.
 * @see e2e/utils/test-data-cleanup.ts — live-mode sweeper that relies
 *      on the `e2e-test-` prefix on `Assessment.name` to identify
 *      deletion candidates.
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
 * Lifecycle status of an assessment template/cycle.
 *
 * Closed union for compile-time safety: test code that overrides
 * `status` with a typo (e.g., `status: 'draftt'`) fails at compile
 * time rather than producing a confusing runtime mismatch.
 *
 * - `'draft'`        — Created but not yet published; editable.
 * - `'published'`    — Live and visible to participants but not yet active.
 * - `'in-progress'`  — Active cycle accepting responses.
 * - `'closed'`       — No longer accepting responses; results visible.
 * - `'archived'`     — Read-only historical record.
 */
export type AssessmentStatus = 'draft' | 'published' | 'in-progress' | 'closed' | 'archived';

/**
 * Lifecycle status of an assessment response.
 *
 * Closed union for compile-time safety. Status drives status-conditional
 * date fields (`submittedAt`, `reviewedAt`):
 *   - `'draft'`      — Started but not yet submitted.
 *                      `submittedAt === null`, `reviewedAt === null`.
 *   - `'submitted'`  — Submitted by respondent; awaiting review.
 *                      `submittedAt !== null`, `reviewedAt === null`.
 *   - `'reviewed'`   — Reviewed by manager/calibration committee.
 *                      `submittedAt !== null`, `reviewedAt !== null`.
 *   - `'finalized'`  — Locked; included in final scoring.
 *                      `submittedAt !== null`, `reviewedAt !== null`.
 */
export type AssessmentResponseStatus = 'draft' | 'submitted' | 'reviewed' | 'finalized';

/**
 * A single scoring entry within an assessment response.
 *
 * Maps a competency/question id to the score value provided by the
 * respondent, plus an optional free-text comment / justification.
 *
 * Migration-proof shape: primitive types only.
 */
export interface AssessmentScore {
  /** UUID of the competency or question being scored. */
  readonly competencyId: string;
  /**
   * Numeric score value (1–5 typical Likert scale; 1–7 or 1–10 also
   * common). Range is enforced by the parent {@link Assessment}'s
   * `scaleMax` field at the consumer layer.
   */
  readonly score: number;
  /**
   * Optional free-text comment / justification. Present on roughly 40%
   * of generated scores — matching realistic engagement-data
   * distributions where most respondents skip comments per question.
   */
  readonly comment?: string;
}

/**
 * Assessment entity. Represents either a template (reusable assessment
 * definition) or a cycle (instantiation of a template applied to a
 * population).
 *
 * Migration-proof shape: primitive types and arrays of structured
 * types only. No nested complex objects, no class references, no
 * Angular-specific types.
 *
 * Field stability:
 *   - `id` is the stable identifier; `name` is the cleanup marker
 *     (carries `e2e-test-` prefix).
 *   - `type` is the discriminator — `'template'` or `'cycle'`. Drives
 *     conditional defaults: templates have null `endDate`,
 *     `templateId`, `cycleId`, and empty `participantIds`; cycles have
 *     populated values for all of these.
 *   - `status` follows the closed {@link AssessmentStatus} union.
 *   - `templateId` is the UUID of the parent template when
 *     `type === 'cycle'`; `null` for templates.
 *   - `cycleId` is the UUID of the parent cycle when
 *     `type === 'cycle'`; `null` for templates.
 *   - `creatorId` is the UUID of the user who authored the entity.
 *   - Cross-factory references (`creatorId`, `participantIds`,
 *     `templateId`, `cycleId`) are stored as UUID strings rather than
 *     nested objects to preserve the foundational-layer constraint
 *     (no sibling-factory imports).
 *
 * @see AAP §0.5.1.13 —
 *      `e2e/fixtures/api-responses/assessments/templates-list.json`
 *      and `cycles-list.json` mirror this shape.
 */
export interface Assessment {
  /** UUID identifier (RFC 4122 v4). */
  readonly id: string;
  /**
   * `e2e-test-` prefixed display name for live-mode cleanup
   * eligibility.
   *
   * Format:
   *   `e2e-test-<Department> <Verb> <Period> <8-char-suffix>`
   * Example:
   *   `'e2e-test-Engineering Performance Q3 x7y8a3bc'`
   *
   * The prefix is the sentinel value the live-mode sweeper matches;
   * the suffix guarantees uniqueness across parallel workers per AAP
   * §0.10.1.
   */
  readonly name: string;
  /**
   * Description of the assessment scope. Realistic prose generated by
   * `faker.lorem.paragraph` (1–3 sentences).
   */
  readonly description: string;
  /** Whether this is a reusable template or an instantiated cycle. */
  readonly type: 'template' | 'cycle';
  /** Current lifecycle status (closed union — see {@link AssessmentStatus}). */
  readonly status: AssessmentStatus;
  /**
   * UUID of the parent template if `type === 'cycle'`; `null` for
   * templates. Cycles are instantiations of templates; templates are
   * standalone definitions and have no parent.
   */
  readonly templateId: string | null;
  /**
   * UUID of the parent cycle if `type === 'cycle'`; `null` for
   * templates. (In a cycle context, this is the cycle's own id; the
   * factory generates a fresh UUID here for parallel-safety. Tests
   * that need to link multiple cycle entities to the same `cycleId`
   * pass an override.)
   */
  readonly cycleId: string | null;
  /** UUID of the user who created the assessment. */
  readonly creatorId: string;
  /**
   * ISO 8601 date (YYYY-MM-DD) when the assessment opens to
   * participants.
   */
  readonly startDate: string;
  /**
   * ISO 8601 date (YYYY-MM-DD) when the assessment closes. `null` for
   * templates (templates do not expire).
   */
  readonly endDate: string | null;
  /** Number of competencies / questions in this assessment. */
  readonly questionCount: number;
  /**
   * UUIDs of users participating in this assessment cycle. Empty
   * array (`[]`) for templates. `ReadonlyArray<string>` to communicate
   * immutability at the type level.
   */
  readonly participantIds: ReadonlyArray<string>;
  /**
   * Optional category / domain tag (e.g., `'leadership'`,
   * `'technical'`, `'communication'`). Drawn from a controlled
   * vocabulary so test data remains realistic.
   */
  readonly category?: string;
  /**
   * Optional Likert-scale max value. Common values: 5 (very common),
   * 7 (some), 10 (rare). When present, scoring entries should be in
   * the [1, scaleMax] range.
   */
  readonly scaleMax?: number;
  /** ISO 8601 timestamp of creation. */
  readonly createdAt: string;
  /** ISO 8601 timestamp of last update. Optional. */
  readonly updatedAt?: string;
}

/**
 * Assessment response entity. Represents a single user's response to
 * an assessment cycle, including their scoring of each competency /
 * question.
 *
 * Migration-proof shape: primitive types and arrays of structured
 * types only. The `scores` field is a `ReadonlyArray<AssessmentScore>`
 * for type-level immutability and clarity.
 *
 * Field stability:
 *   - `id` is the stable identifier.
 *   - `assessmentId` is the UUID of the parent {@link Assessment}.
 *   - `respondentId` is the UUID of the user providing the response.
 *   - `subjectId` is the UUID of the user being assessed (for 360
 *     reviews, may differ from `respondentId`; for self-assessment,
 *     equal to `respondentId`).
 *   - Status-conditional fields (`submittedAt`, `reviewedAt`) are
 *     populated only in their corresponding lifecycle states.
 *   - Chronological invariant: `createdAt ≤ submittedAt ≤ reviewedAt`
 *     when each is non-null.
 *   - `aggregatedScore` is the arithmetic mean of `scores[].score`,
 *     rounded to 2 decimal places. Computed by the factory rather
 *     than randomized to maintain internal data consistency.
 */
export interface AssessmentResponse {
  /** UUID identifier (RFC 4122 v4). */
  readonly id: string;
  /** UUID of the parent {@link Assessment} cycle this response belongs to. */
  readonly assessmentId: string;
  /** UUID of the user who provided the response (the respondent / rater). */
  readonly respondentId: string;
  /**
   * UUID of the user being assessed. May differ from `respondentId`
   * for 360-degree assessments where one user rates another. For
   * self-assessments, equal to `respondentId` (~70% of generated
   * responses by default to model the typical self-assessment-heavy
   * distribution).
   */
  readonly subjectId: string;
  /** Current lifecycle status (closed union — see {@link AssessmentResponseStatus}). */
  readonly status: AssessmentResponseStatus;
  /**
   * Array of scoring entries, one per competency / question. Length
   * matches the parent assessment's `questionCount` in real flows;
   * the factory draws a representative count of 5–15.
   *
   * `ReadonlyArray<AssessmentScore>` to communicate immutability at
   * the type level.
   */
  readonly scores: ReadonlyArray<AssessmentScore>;
  /**
   * Optional overall comment / qualitative feedback from the
   * respondent. Present on roughly 60% of generated responses —
   * matching realistic distributions where most respondents add at
   * least a brief overall comment.
   */
  readonly overallComment?: string;
  /**
   * Aggregated score, computed as the arithmetic mean of
   * `scores[].score`, rounded to 2 decimal places. Optional in the
   * type because consumers may explicitly omit it via override; the
   * factory always populates this field.
   */
  readonly aggregatedScore?: number;
  /**
   * ISO 8601 timestamp when the response was submitted. `null` for
   * responses still in `'draft'`.
   */
  readonly submittedAt: string | null;
  /**
   * ISO 8601 timestamp when the response was reviewed. `null` for
   * responses not yet reviewed (i.e., status is `'draft'` or
   * `'submitted'`).
   */
  readonly reviewedAt: string | null;
  /** ISO 8601 timestamp of creation. */
  readonly createdAt: string;
  /** ISO 8601 timestamp of last update. Optional. */
  readonly updatedAt?: string;
}

// ---------------------------------------------------------------------------
// Internal constants — file-local; not exported.
// ---------------------------------------------------------------------------

/** Common prefix applied for cleanup eligibility (AAP §0.4.4). */
const E2E_TEST_PREFIX = 'e2e-test-';

/** Length of the random alphanumeric uniqueness suffix (AAP §0.10.1). */
const UNIQUE_SUFFIX_LENGTH = 8;

/**
 * Closed list of values emitted for {@link Assessment.type}. The discriminated
 * union drives the conditional-field defaults below.
 */
const ASSESSMENT_TYPES: ReadonlyArray<'template' | 'cycle'> = ['template', 'cycle'];

/**
 * Closed list of values emitted for {@link AssessmentStatus}. Excludes
 * `'archived'` from the default distribution because archived
 * assessments are uncommon in active test scenarios; tests that need
 * an archived assessment override `status` directly.
 */
const ASSESSMENT_STATUS_DEFAULTS: ReadonlyArray<AssessmentStatus> = [
  'draft',
  'published',
  'in-progress',
  'closed',
];

/** Closed list of values emitted for {@link AssessmentResponseStatus}. */
const ASSESSMENT_RESPONSE_STATUSES: ReadonlyArray<AssessmentResponseStatus> = [
  'draft',
  'submitted',
  'reviewed',
  'finalized',
];

/**
 * Verb tokens used in the assessment name slug. Combined with a
 * department and a period to produce a realistic-looking name like
 * `'e2e-test-Engineering Performance Q3 x7y8a3bc'`.
 */
const ASSESSMENT_NAME_VERBS: ReadonlyArray<string> = [
  'Skills',
  'Performance',
  'Competency',
  'Capability',
];

/**
 * Closed vocabulary of assessment categories. Drawn from typical
 * enterprise-assessment taxonomies. Exposed to the optional
 * {@link Assessment.category} field; tests for free-form / custom
 * categories override.
 */
const CATEGORY_VOCABULARY: ReadonlyArray<string> = [
  'leadership',
  'technical',
  'communication',
  'project-management',
  'strategic',
];

/**
 * Common Likert-scale max values. 5-point is by far the most common
 * (over half of real assessments); 7- and 10-point are less common
 * but still represented.
 */
const SCALE_MAX_OPTIONS: ReadonlyArray<number> = [5, 7, 10];

/** Minimum / maximum number of questions per assessment (typical range). */
const MIN_QUESTION_COUNT = 5;
const MAX_QUESTION_COUNT = 30;

/** Minimum / maximum number of participants per cycle. */
const MIN_PARTICIPANT_COUNT = 1;
const MAX_PARTICIPANT_COUNT = 50;

/** Minimum / maximum number of score entries per response (typical range). */
const MIN_SCORE_COUNT = 5;
const MAX_SCORE_COUNT = 15;

/** Likert score range emitted by the factory (1–5 standard). */
const SCORE_VALUE_MIN = 1;
const SCORE_VALUE_MAX = 5;

/** Probability (0–1) that a generated score has a free-text comment. */
const PROBABILITY_SCORE_HAS_COMMENT = 0.4;

/** Probability (0–1) that a generated response has an overall comment. */
const PROBABILITY_RESPONSE_HAS_OVERALL_COMMENT = 0.6;

/** Probability (0–1) that respondent === subject (self-assessment). */
const PROBABILITY_SELF_ASSESSMENT = 0.7;

/** Lookback window (days) for `Assessment.startDate` from the date anchor. */
const RECENT_DAYS_START_DATE = 30;

/** Lookback window (days) for `Assessment.createdAt`. */
const RECENT_DAYS_CREATED = 90;

/** Lookback window (days) for `updatedAt` fields. */
const RECENT_DAYS_UPDATED_ASSESSMENT = 7;
const RECENT_DAYS_UPDATED_RESPONSE = 3;

/** Lookback window (days) for `AssessmentResponse.createdAt`. */
const RECENT_DAYS_RESPONSE_CREATED = 30;

/**
 * Default cycle duration window (years). Cycles last roughly a quarter;
 * `0.25` years ≈ 91 days. Used by `faker.date.future()`.
 */
const CYCLE_DURATION_YEARS = 0.25;

/** Min / max paragraph sentence count for the description. */
const MIN_DESCRIPTION_SENTENCES = 1;
const MAX_DESCRIPTION_SENTENCES = 3;

/** Min / max sentence word count for score-comment text. */
const MIN_SCORE_COMMENT_WORDS = 4;
const MAX_SCORE_COMMENT_WORDS = 12;

/** Min / max paragraph sentence count for the overall comment. */
const MIN_OVERALL_COMMENT_SENTENCES = 1;
const MAX_OVERALL_COMMENT_SENTENCES = 3;

/** Quarter / half-year period bounds. */
const QUARTER_MIN = 1;
const QUARTER_MAX = 4;
const HALF_MIN = 1;
const HALF_MAX = 2;

/** Lookback window (years) for the year token in the period suffix. */
const PERIOD_YEAR_LOOKBACK = 2;

// ---------------------------------------------------------------------------
// Determinism anchor (per AAP §0.4.4)
//
// The factory must produce byte-identical output across same-seed
// invocations so that JSON fixtures generated from these factories
// remain stable in version control. The default `refDate: new Date()`
// behaviour of `faker.date.*` consults the wall-clock and breaks this
// guarantee at the 1ms level.
//
// The fix: derive a date anchor purely from the seeded RNG via
// `faker.number.int()` over a FIXED epoch-millisecond range that does
// not reference `Date.now()` / `new Date()` at all. The two constants
// below span 2020-01-01 → 2030-12-31 UTC, a window large enough to
// produce realistic-looking timestamps for the lifetime of this test
// suite without ever depending on the wall-clock.
//
// All `faker.date.*` calls in the factories below pass an explicit
// `refDate: dateAnchor` so the entire date-generation graph is
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

// ---------------------------------------------------------------------------
// Internal helpers — file-local; not exported.
// ---------------------------------------------------------------------------

/**
 * Compose the period token used in the assessment name slug. Picks
 * uniformly from a quarter (`'Q1'`–`'Q4'`), a half (`'H1'`/`'H2'`),
 * or a calendar year (e.g., `'2024'`) up to {@link PERIOD_YEAR_LOOKBACK}
 * years ago.
 *
 * Uses `faker.date.past()` with a deterministic `refDate` so the
 * year-token branch remains seed-deterministic.
 *
 * @param dateAnchor The seed-deterministic anchor for the year branch.
 * @returns A non-empty period string.
 */
function generatePeriodToken(dateAnchor: Date): string {
  const yearToken = `${faker.date
    .past({ years: PERIOD_YEAR_LOOKBACK, refDate: dateAnchor })
    .getFullYear()}`;
  const quarterToken = `Q${faker.number.int({ min: QUARTER_MIN, max: QUARTER_MAX })}`;
  const halfToken = `H${faker.number.int({ min: HALF_MIN, max: HALF_MAX })}`;
  return faker.helpers.arrayElement<string>([quarterToken, halfToken, yearToken]);
}

/**
 * Format a `Date` as an ISO 8601 calendar date (YYYY-MM-DD). Used for
 * the {@link Assessment.startDate} and {@link Assessment.endDate}
 * fields, which are date-only (no time component).
 *
 * The cast on the `split('-')` result is justified by the contract of
 * `Date.prototype.toISOString()`, which RFC 3339 mandates returns a
 * string of the form `'YYYY-MM-DDTHH:mm:ss.sssZ'`. The first
 * `'-'`-prefix split component is therefore always defined.
 *
 * @param d Source `Date`.
 * @returns ISO 8601 calendar date string (YYYY-MM-DD).
 */
function toIsoDateOnly(d: Date): string {
  // `toISOString()` is specified to never throw and always returns
  // `'YYYY-MM-DDT…'`; the `split('T')[0]` always yields the date part.
  // The non-null assertion-equivalent `?? ''` keeps the function total
  // even under `noUncheckedIndexedAccess` if it is ever enabled.
  const parts = d.toISOString().split('T');
  return parts[0] ?? d.toISOString();
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
 *   - `name` carries the `e2e-test-` prefix and an 8-character random
 *     suffix to guarantee uniqueness across parallel workers per AAP
 *     §0.10.1.
 *   - `type` is randomly drawn from `['template', 'cycle']` unless
 *     overridden.
 *   - Conditional defaults are honoured based on the resolved `type`:
 *       - `'template'` → `templateId: null`, `cycleId: null`,
 *         `endDate: null`, `participantIds: []`.
 *       - `'cycle'`    → non-null `templateId`, non-null `cycleId`,
 *         non-null `endDate` (≥ `startDate`), and 1–50
 *         `participantIds`.
 *   - All `faker.date.*` calls are anchored to a seed-deterministic
 *     `dateAnchor` so output is byte-identical across same-seed
 *     invocations.
 *
 * Override resolution order: the factory resolves overrides for
 * `type` BEFORE deriving conditional fields, so consumers calling
 * `assessmentFactory({ type: 'template' })` get an internally
 * consistent template (null endDate, empty participants) — even if
 * the random draw would have produced a cycle.
 *
 * @example Default assessment (random type / status):
 * ```ts
 * import { assessmentFactory } from '@factories';
 *
 * const a = assessmentFactory();
 * ```
 *
 * @example Template:
 * ```ts
 * const tmpl = assessmentFactory({ type: 'template', status: 'published' });
 * // tmpl.endDate === null
 * // tmpl.participantIds.length === 0
 * ```
 *
 * @example Cycle linked to a template:
 * ```ts
 * const tmpl = assessmentFactory({ type: 'template' });
 * const cycle = assessmentFactory({
 *   type: 'cycle',
 *   templateId: tmpl.id,
 *   status: 'in-progress',
 * });
 * ```
 *
 * @example Targeted override (specific category and question count):
 * ```ts
 * const a = assessmentFactory({
 *   category: 'leadership',
 *   questionCount: 50,
 *   scaleMax: 7,
 * });
 * ```
 *
 * @param overrides Partial fields to override on the generated
 *                  instance. Defaults to an empty object.
 * @returns A fully-populated {@link Assessment} object.
 */
export function assessmentFactory(overrides: Partial<Assessment> = {}): Assessment {
  // Determinism anchor — see `deterministicDateAnchor()`.
  const dateAnchor = deterministicDateAnchor();

  // Resolve the effective type FIRST: an override (when provided)
  // takes precedence over a random draw. Resolving early guarantees
  // that all derived fields (templateId, cycleId, endDate,
  // participantIds) are type-consistent. A naive implementation that
  // only spreads `...overrides` at the end of `return` produces a
  // template whose `endDate` is non-null and `participantIds`
  // non-empty — a confusing mismatch that breaks template-specific
  // tests.
  const type: 'template' | 'cycle' =
    overrides.type ?? faker.helpers.arrayElement<'template' | 'cycle'>(ASSESSMENT_TYPES);
  const isTemplate = type === 'template';

  // Compose the entity name: `e2e-test-<Department> <Verb> <Period> <suffix>`.
  // The suffix is 8-character lowercase alphanumeric (62^8 ≈ 2.18e14
  // possible values) so collisions across parallel workers are
  // effectively impossible within any plausible test-suite run.
  const department = faker.commerce.department();
  const verb = faker.helpers.arrayElement<string>(ASSESSMENT_NAME_VERBS);
  const period = generatePeriodToken(dateAnchor);
  const uniqueSuffix = faker.string.alphanumeric({
    length: UNIQUE_SUFFIX_LENGTH,
    casing: 'lower',
  });
  const name = `${E2E_TEST_PREFIX}${department} ${verb} ${period} ${uniqueSuffix}`;

  // Status — uniform random across the active lifecycle states.
  const status: AssessmentStatus = faker.helpers.arrayElement<AssessmentStatus>(
    ASSESSMENT_STATUS_DEFAULTS,
  );

  // Conditional foreign keys: templates are standalone (no parent
  // template/cycle); cycles always reference both their parent
  // template and their own cycle id.
  const templateId: string | null = isTemplate ? null : faker.string.uuid();
  const cycleId: string | null = isTemplate ? null : faker.string.uuid();

  // Date generation — seed-deterministic and chronologically sound.
  // startDate is drawn from the [-RECENT_DAYS_START_DATE, anchor]
  // window so cycles open slightly in the past relative to the
  // anchor, producing a realistic distribution.
  const startDateDate = faker.date.recent({ days: RECENT_DAYS_START_DATE, refDate: dateAnchor });
  const startDate = toIsoDateOnly(startDateDate);

  // endDate is null for templates (templates do not expire); for
  // cycles, it is offset forward from startDate by a quarter via
  // `faker.date.future()`, guaranteeing endDate > startDate.
  const endDate: string | null = isTemplate
    ? null
    : toIsoDateOnly(faker.date.future({ years: CYCLE_DURATION_YEARS, refDate: startDateDate }));

  // questionCount is independent of type — both templates and cycles
  // have a defined question set.
  const questionCount = faker.number.int({ min: MIN_QUESTION_COUNT, max: MAX_QUESTION_COUNT });

  // Participants — empty for templates; 1–50 fresh UUIDs for cycles.
  const participantCount = isTemplate
    ? 0
    : faker.number.int({ min: MIN_PARTICIPANT_COUNT, max: MAX_PARTICIPANT_COUNT });
  const participantIds: ReadonlyArray<string> = Array.from({ length: participantCount }, () =>
    faker.string.uuid(),
  );

  // createdAt / updatedAt — anchored timestamps with createdAt
  // generated first; updatedAt drawn from a more recent window so the
  // `createdAt ≤ updatedAt` invariant holds for the vast majority of
  // generated rows. Tests that care about strict ordering override.
  const createdAt = faker.date
    .recent({ days: RECENT_DAYS_CREATED, refDate: dateAnchor })
    .toISOString();
  const updatedAt = faker.date
    .recent({ days: RECENT_DAYS_UPDATED_ASSESSMENT, refDate: dateAnchor })
    .toISOString();

  return {
    id: faker.string.uuid(),
    name,
    description: faker.lorem.paragraph({
      min: MIN_DESCRIPTION_SENTENCES,
      max: MAX_DESCRIPTION_SENTENCES,
    }),
    type,
    status,
    templateId,
    cycleId,
    creatorId: faker.string.uuid(),
    startDate,
    endDate,
    questionCount,
    participantIds,
    category: faker.helpers.arrayElement<string>(CATEGORY_VOCABULARY),
    scaleMax: faker.helpers.arrayElement<number>(SCALE_MAX_OPTIONS),
    createdAt,
    updatedAt,
    ...overrides,
  };
}

/**
 * Generate an {@link AssessmentResponse} instance with sensible
 * defaults and optional overrides.
 *
 * Each invocation produces an independent, parallel-safe instance with
 * internally-consistent status-conditional fields:
 *   - `id` is a fresh RFC 4122 v4 UUID.
 *   - Status-conditional date fields populated coherently:
 *       - `'draft'`      → `submittedAt === null`, `reviewedAt === null`.
 *       - `'submitted'`  → `submittedAt !== null`, `reviewedAt === null`.
 *       - `'reviewed'`   → `submittedAt !== null`, `reviewedAt !== null`.
 *       - `'finalized'`  → `submittedAt !== null`, `reviewedAt !== null`.
 *   - Chronological invariant: `createdAt ≤ submittedAt ≤ reviewedAt`
 *     when each is non-null. The factory uses `faker.date.between()`
 *     with explicit chronological bounds so the chain is
 *     seed-deterministic.
 *   - `scores` is a `ReadonlyArray<AssessmentScore>` of 5–15 entries.
 *     Each score has a Likert value in [1, 5]; ~40% have an attached
 *     comment.
 *   - `aggregatedScore` is computed as the arithmetic mean of
 *     `scores[].score`, rounded to 2 decimal places — never randomized.
 *   - `subjectId === respondentId` ~70% of the time (self-assessment
 *     bias); ~30% of responses model 360-degree feedback with a
 *     distinct subject.
 *
 * Override resolution order: the factory resolves overrides for
 * `status` BEFORE deriving conditional date fields, so consumers
 * calling `assessmentResponseFactory({ status: 'reviewed' })` get an
 * internally consistent response (non-null submittedAt and reviewedAt)
 * — even if the random draw would have produced a draft.
 *
 * @example Default response:
 * ```ts
 * import { assessmentResponseFactory } from '@factories';
 *
 * const r = assessmentResponseFactory();
 * ```
 *
 * @example Scoped to a specific assessment:
 * ```ts
 * const r = assessmentResponseFactory({
 *   assessmentId: cycle.id,
 *   respondentId: user.id,
 *   subjectId: user.id, // self-assessment
 * });
 * ```
 *
 * @example Submitted but not yet reviewed:
 * ```ts
 * const r = assessmentResponseFactory({ status: 'submitted' });
 * // r.submittedAt !== null, r.reviewedAt === null
 * ```
 *
 * @example Reviewed response:
 * ```ts
 * const r = assessmentResponseFactory({ status: 'reviewed' });
 * // r.submittedAt !== null, r.reviewedAt !== null
 * ```
 *
 * @param overrides Partial fields to override on the generated
 *                  instance. Defaults to an empty object.
 * @returns A fully-populated {@link AssessmentResponse} object.
 */
export function assessmentResponseFactory(
  overrides: Partial<AssessmentResponse> = {},
): AssessmentResponse {
  // Determinism anchor — see `deterministicDateAnchor()`.
  const dateAnchor = deterministicDateAnchor();

  // Resolve the effective status FIRST so conditional date-field
  // generation honours the override.
  const status: AssessmentResponseStatus =
    overrides.status ??
    faker.helpers.arrayElement<AssessmentResponseStatus>(ASSESSMENT_RESPONSE_STATUSES);
  const isSubmitted = status !== 'draft';
  const isReviewed = status === 'reviewed' || status === 'finalized';

  // Generate per-question scores. Length is in the [5, 15] range —
  // matching the typical assessment size. Tests that need atypical
  // sizes (e.g., 100-question assessments) override `scores` directly.
  const scoreCount = faker.number.int({ min: MIN_SCORE_COUNT, max: MAX_SCORE_COUNT });
  const scores: ReadonlyArray<AssessmentScore> = Array.from({ length: scoreCount }, () => {
    const hasComment = faker.datatype.boolean({ probability: PROBABILITY_SCORE_HAS_COMMENT });
    const baseScore: AssessmentScore = {
      competencyId: faker.string.uuid(),
      score: faker.number.int({ min: SCORE_VALUE_MIN, max: SCORE_VALUE_MAX }),
    };
    // Conditionally attach `comment` only when present; preserves
    // `exactOptionalPropertyTypes` semantics where `undefined` ≠ absent.
    return hasComment
      ? {
          ...baseScore,
          comment: faker.lorem.sentence({
            min: MIN_SCORE_COMMENT_WORDS,
            max: MAX_SCORE_COMMENT_WORDS,
          }),
        }
      : baseScore;
  });

  // Computed aggregated score: arithmetic mean of individual scores,
  // rounded to 2 decimal places. The `Math.max(scores.length, 1)`
  // guard prevents division by zero when consumers pass `scores: []`
  // via override (a legal edge case for empty-state tests).
  const totalScore = scores.reduce((acc, s) => acc + s.score, 0);
  const aggregatedScore = Math.round((totalScore / Math.max(scores.length, 1)) * 100) / 100;

  // createdAt: anchored timestamp from a recent window relative to
  // the date anchor. Used as the lower bound for submittedAt /
  // reviewedAt so chronological invariants hold.
  const createdAtDate = faker.date.recent({
    days: RECENT_DAYS_RESPONSE_CREATED,
    refDate: dateAnchor,
  });
  const createdAt = createdAtDate.toISOString();

  // Status-conditional date generation. Each subsequent field uses
  // the previous as its lower bound so `createdAt ≤ submittedAt ≤
  // reviewedAt` holds. `faker.date.between` is seed-deterministic
  // when given a fixed `from`/`to` pair (no `refDate` consults the
  // wall-clock).
  let submittedAtDate: Date | null = null;
  let submittedAt: string | null = null;
  let reviewedAt: string | null = null;

  if (isSubmitted) {
    submittedAtDate = faker.date.between({ from: createdAtDate, to: dateAnchor });
    submittedAt = submittedAtDate.toISOString();

    if (isReviewed) {
      // submittedAtDate is non-null inside this branch (we are inside
      // isSubmitted which was set true to enter the outer branch).
      const reviewedAtDate = faker.date.between({ from: submittedAtDate, to: dateAnchor });
      reviewedAt = reviewedAtDate.toISOString();
    }
  }

  // Subject defaults to respondent (~70% self-assessment); ~30% of
  // responses have a distinct subject to model 360-degree feedback.
  const respondentId = faker.string.uuid();
  const subjectId = faker.datatype.boolean({ probability: PROBABILITY_SELF_ASSESSMENT })
    ? respondentId
    : faker.string.uuid();

  // updatedAt — drawn from a more recent window than createdAt so the
  // typical `createdAt ≤ updatedAt` ordering holds.
  const updatedAt = faker.date
    .recent({ days: RECENT_DAYS_UPDATED_RESPONSE, refDate: dateAnchor })
    .toISOString();

  // Conditionally attach the optional `overallComment` only when
  // present (~60%). Omitting the property entirely (rather than
  // setting it to `undefined`) is the cleaner JSON shape for
  // consumers serialising via `JSON.stringify`.
  const hasOverallComment = faker.datatype.boolean({
    probability: PROBABILITY_RESPONSE_HAS_OVERALL_COMMENT,
  });
  const overallComment: string | undefined = hasOverallComment
    ? faker.lorem.paragraph({
        min: MIN_OVERALL_COMMENT_SENTENCES,
        max: MAX_OVERALL_COMMENT_SENTENCES,
      })
    : undefined;

  // Build the response object. Optional fields (`overallComment`) are
  // only included when defined to keep JSON output compact and to
  // honour the conditional-attach semantics.
  const result: AssessmentResponse = {
    id: faker.string.uuid(),
    assessmentId: faker.string.uuid(),
    respondentId,
    subjectId,
    status,
    scores,
    aggregatedScore,
    submittedAt,
    reviewedAt,
    createdAt,
    updatedAt,
    ...(overallComment !== undefined ? { overallComment } : {}),
    ...overrides,
  };

  return result;
}
