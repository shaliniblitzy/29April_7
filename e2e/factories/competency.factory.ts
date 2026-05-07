/**
 * Competency and CompetencyLevel entity factories for the
 * Whoville-Client Competencies module.
 *
 * Models the canonical Competencies-module data shapes:
 *   - `Competency` — a skill / capability definition in the catalog,
 *     organised by category (`'technical'`, `'leadership'`, etc.) and
 *     associated with a learning path.
 *   - `CompetencyLevel` — a proficiency-level definition within a
 *     competency (e.g., `'novice'`, `'intermediate'`, `'expert'`).
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
 * `name` field on both `Competency` and `CompetencyLevel`. Both fields
 * begin with the configured `e2e-test-` prefix (default), and a
 * randomized 8-character alphanumeric suffix guarantees uniqueness
 * across parallel workers per AAP §0.10.1.
 *
 * ## Migration-proof shape (AAP §0.10.1)
 *
 * All exported types use only primitive TypeScript types and
 * `ReadonlyArray<string>` for collections. No Angular-specific types,
 * no Whoville-Client class references.
 *
 * ## Determinism (AAP §0.4.4)
 *
 * All `faker.date.*` calls use a seed-deterministic `refDate` produced
 * by `deterministicDateAnchor()`. See QA Issue #3 for the wall-clock
 * drift defect this avoids.
 *
 * @see AAP §0.5.1.12, §0.4.4, §0.10.1.
 * @see e2e/pages/competencies/catalog-list.page.ts,
 *      proficiency-matrix.page.ts, learning-path.page.ts — POM consumers.
 * @see e2e/mocks/handlers/competencies.handler.ts — mock handler consumer.
 * @see e2e/fixtures/api-responses/competencies/catalog-list.json,
 *      skills-list.json, proficiency-matrix.json — fixture shape references.
 */

// ---------------------------------------------------------------------------
// Imports — strictly limited to `@faker-js/faker`.
// ---------------------------------------------------------------------------

import { faker } from '@faker-js/faker';

// ---------------------------------------------------------------------------
// Public type definitions
// ---------------------------------------------------------------------------

/**
 * Top-level competency category.
 *
 * Closed union for compile-time safety. Drawn from typical enterprise
 * competency frameworks.
 *
 * - `'technical'`     — Programming, infrastructure, data, security.
 * - `'leadership'`    — People management, strategic planning, mentoring.
 * - `'business'`      — Domain knowledge, financial acumen, stakeholder
 *                       management.
 * - `'communication'` — Writing, presentation, negotiation.
 * - `'process'`       — Project management, agile, lean methodologies.
 * - `'creative'`      — Design, innovation, problem-solving.
 */
export type CompetencyCategory =
  | 'technical'
  | 'leadership'
  | 'business'
  | 'communication'
  | 'process'
  | 'creative';

/**
 * Lifecycle status of a competency in the catalog.
 *
 * Closed union for compile-time safety.
 *
 * - `'draft'`      — Authored but not yet published to the catalog.
 * - `'published'`  — Active in the catalog; available for assessments.
 * - `'deprecated'` — Phased out; new assessments cannot reference it
 *                    but existing references remain valid for audit.
 * - `'archived'`   — Fully removed from the catalog; reference-only.
 */
export type CompetencyStatus = 'draft' | 'published' | 'deprecated' | 'archived';

/**
 * Proficiency-level slug.
 *
 * Closed union for compile-time safety. Standard 5-level rubric used
 * across most enterprise competency frameworks.
 */
export type ProficiencyLevel = 'novice' | 'beginner' | 'intermediate' | 'advanced' | 'expert';

/**
 * Competency entity. Represents a skill / capability definition in the
 * Whoville-Client Competencies catalog.
 *
 * Migration-proof shape: primitive types only.
 *
 * Field stability:
 *   - `id`, `name`, and `slug` are stable identifiers; `name` is the
 *     cleanup marker.
 *   - `levelIds` references the {@link CompetencyLevel} instances that
 *     define this competency's proficiency rubric.
 *   - `prerequisiteCompetencyIds` models the dependency graph between
 *     competencies (e.g., "Advanced Kubernetes" requires "Intermediate
 *     Kubernetes").
 */
export interface Competency {
  /** UUID identifier (RFC 4122 v4). */
  readonly id: string;
  /**
   * `e2e-test-` prefixed display name for live-mode cleanup eligibility.
   *
   * Format: `e2e-test-competency-<category>-<8-char-suffix>`.
   */
  readonly name: string;
  /**
   * `e2e-test-` prefixed URL-safe slug derived from the name.
   *
   * Format: `e2e-test-competency-<category>-<8-char-suffix>` (lowercase,
   * hyphenated). Suitable for use in route params.
   */
  readonly slug: string;
  /**
   * Optional human-readable description / definition. Realistic prose
   * generated by faker.
   */
  readonly description?: string;
  /** Top-level category (closed union — see {@link CompetencyCategory}). */
  readonly category: CompetencyCategory;
  /** Current lifecycle status (closed union — see {@link CompetencyStatus}). */
  readonly status: CompetencyStatus;
  /**
   * UUIDs of the {@link CompetencyLevel} instances that define this
   * competency's proficiency rubric. Typically 5 levels for the standard
   * novice → expert rubric. `ReadonlyArray<string>` to communicate
   * immutability at the type level.
   */
  readonly levelIds: ReadonlyArray<string>;
  /**
   * UUIDs of competencies that must be achieved before this one. Empty
   * array for foundational competencies with no prerequisites.
   */
  readonly prerequisiteCompetencyIds: ReadonlyArray<string>;
  /**
   * UUID of the associated learning path. `null` for competencies not
   * yet linked to a learning path (typically `status === 'draft'`).
   */
  readonly learningPathId: string | null;
  /**
   * UUIDs of users certified in this competency at any level.
   * `ReadonlyArray<string>` to communicate immutability.
   */
  readonly certifiedUserIds: ReadonlyArray<string>;
  /** UUID of the user who authored / owns the competency definition. */
  readonly ownerId: string;
  /** ISO 8601 timestamp of creation. */
  readonly createdAt: string;
  /** ISO 8601 timestamp of last update. Optional. */
  readonly updatedAt?: string;
}

/**
 * CompetencyLevel entity. Represents a single proficiency level within
 * a {@link Competency} (e.g., "Intermediate Kubernetes").
 *
 * Migration-proof shape: primitive types only.
 *
 * Field stability:
 *   - `id` and `name` are stable identifiers; `name` is the cleanup marker.
 *   - `competencyId` is a UUID reference to the parent {@link Competency}.
 *   - `level` is the standard proficiency slug.
 *   - `numericValue` provides the same level information in numeric form
 *     (1–5) for sortable list views and percentile calculations.
 */
export interface CompetencyLevel {
  /** UUID identifier (RFC 4122 v4). */
  readonly id: string;
  /**
   * `e2e-test-` prefixed display name for live-mode cleanup.
   *
   * Format: `e2e-test-level-<level-slug>-<8-char-suffix>`.
   */
  readonly name: string;
  /** UUID of the parent {@link Competency}. */
  readonly competencyId: string;
  /** Proficiency-level slug (closed union — see {@link ProficiencyLevel}). */
  readonly level: ProficiencyLevel;
  /**
   * Numeric value of the level (1–5). Sortable and suitable for
   * percentile calculations. The mapping is:
   *   - `'novice'`        → 1
   *   - `'beginner'`      → 2
   *   - `'intermediate'`  → 3
   *   - `'advanced'`      → 4
   *   - `'expert'`        → 5
   */
  readonly numericValue: number;
  /**
   * Description of what this proficiency level entails. Realistic prose
   * generated by faker.
   */
  readonly description: string;
  /**
   * Criteria a user must demonstrate to achieve this level.
   * `ReadonlyArray<string>` of brief, sentence-form criteria phrases.
   */
  readonly criteria: ReadonlyArray<string>;
  /**
   * Recommended learning resources (URLs, course names, etc.) for users
   * working towards this level.
   */
  readonly recommendedResources: ReadonlyArray<string>;
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

/** Closed list of values emitted for `CompetencyCategory`. */
const COMPETENCY_CATEGORIES: ReadonlyArray<CompetencyCategory> = [
  'technical',
  'leadership',
  'business',
  'communication',
  'process',
  'creative',
];

/**
 * Weighted distribution for `CompetencyStatus`. `'published'` is
 * over-represented to match production reality where most catalog
 * entries are live.
 */
const COMPETENCY_STATUS_DISTRIBUTION: ReadonlyArray<CompetencyStatus> = [
  'published',
  'published',
  'published',
  'published',
  'draft',
  'deprecated',
  'archived',
];

/** Closed list of values emitted for `ProficiencyLevel`. */
const PROFICIENCY_LEVELS: ReadonlyArray<ProficiencyLevel> = [
  'novice',
  'beginner',
  'intermediate',
  'advanced',
  'expert',
];

/**
 * Deterministic mapping from {@link ProficiencyLevel} slug to numeric
 * value (1–5). Used by {@link competencyLevelFactory} to populate the
 * `numericValue` field consistently.
 */
const PROFICIENCY_LEVEL_NUMERIC: Readonly<Record<ProficiencyLevel, number>> = {
  novice: 1,
  beginner: 2,
  intermediate: 3,
  advanced: 4,
  expert: 5,
};

/** Probability (0–1) that a generated competency has a description. */
const PROBABILITY_HAS_DESCRIPTION = 0.9;

/** Probability (0–1) that a generated competency has a learning path. */
const PROBABILITY_HAS_LEARNING_PATH = 0.7;

/** Minimum / maximum number of levels per competency. */
const MIN_LEVELS = 3;
const MAX_LEVELS = 5;

/** Minimum / maximum number of prerequisite competencies. */
const MIN_PREREQUISITES = 0;
const MAX_PREREQUISITES = 3;

/** Minimum / maximum number of certified users per competency. */
const MIN_CERTIFIED_USERS = 0;
const MAX_CERTIFIED_USERS = 25;

/** Minimum / maximum number of criteria per level. */
const MIN_CRITERIA = 2;
const MAX_CRITERIA = 5;

/** Minimum / maximum number of recommended resources per level. */
const MIN_RESOURCES = 0;
const MAX_RESOURCES = 4;

/** Minimum / maximum word count for description. */
const MIN_DESCRIPTION_WORDS = 6;
const MAX_DESCRIPTION_WORDS = 15;

/** Minimum / maximum word count for criteria sentences. */
const MIN_CRITERIA_WORDS = 5;
const MAX_CRITERIA_WORDS = 12;

/** Lookback window (days) for `createdAt` timestamps. */
const RECENT_DAYS_CREATED = 730;

/** Lookback window (days) for `updatedAt` timestamps. */
const RECENT_DAYS_UPDATED = 60;

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
 * Generate a {@link Competency} instance with sensible defaults and
 * optional overrides.
 *
 * Each invocation produces an independent, parallel-safe instance:
 *   - `id`, `name`, `slug` are unique per invocation.
 *   - `levelIds` is an array of 3–5 fresh UUIDs (matching the typical
 *     proficiency-rubric size).
 *   - `prerequisiteCompetencyIds` is an array of 0–3 fresh UUIDs.
 *   - `certifiedUserIds` is an array of 0–25 fresh UUIDs.
 *
 * @example Default competency:
 * ```ts
 * const c = competencyFactory();
 * ```
 *
 * @example Targeted override (technical, with known prerequisites):
 * ```ts
 * const c = competencyFactory({
 *   category: 'technical',
 *   prerequisiteCompetencyIds: [parent.id],
 *   status: 'published',
 * });
 * ```
 *
 * @example Deprecated competency for negative-path tests:
 * ```ts
 * const dep = competencyFactory({ status: 'deprecated' });
 * ```
 *
 * @param overrides Partial fields to override on the generated instance.
 * @returns A fully-populated {@link Competency} object.
 */
export function competencyFactory(overrides: Partial<Competency> = {}): Competency {
  const category: CompetencyCategory =
    faker.helpers.arrayElement<CompetencyCategory>(COMPETENCY_CATEGORIES);

  const uniqueSuffix = faker.string.alphanumeric({
    length: UNIQUE_SUFFIX_LENGTH,
    casing: 'lower',
  });
  const slug = `${E2E_TEST_PREFIX}competency-${category}-${uniqueSuffix}`;
  const name = slug;

  const hasDescription = faker.datatype.boolean({ probability: PROBABILITY_HAS_DESCRIPTION });
  const description = hasDescription
    ? faker.lorem.sentence({
        min: MIN_DESCRIPTION_WORDS,
        max: MAX_DESCRIPTION_WORDS,
      })
    : undefined;

  const status: CompetencyStatus = faker.helpers.arrayElement<CompetencyStatus>(
    COMPETENCY_STATUS_DISTRIBUTION,
  );

  // Generate level IDs (UUID references to CompetencyLevel instances).
  // Tests that need to coordinate with actual CompetencyLevel instances
  // override `levelIds` directly with the matching UUIDs.
  const levelCount = faker.number.int({ min: MIN_LEVELS, max: MAX_LEVELS });
  const levelIds: ReadonlyArray<string> = Array.from({ length: levelCount }, () =>
    faker.string.uuid(),
  );

  const prerequisiteCount = faker.number.int({
    min: MIN_PREREQUISITES,
    max: MAX_PREREQUISITES,
  });
  const prerequisiteCompetencyIds: ReadonlyArray<string> = Array.from(
    { length: prerequisiteCount },
    () => faker.string.uuid(),
  );

  const certifiedUserCount = faker.number.int({
    min: MIN_CERTIFIED_USERS,
    max: MAX_CERTIFIED_USERS,
  });
  const certifiedUserIds: ReadonlyArray<string> = Array.from({ length: certifiedUserCount }, () =>
    faker.string.uuid(),
  );

  const hasLearningPath = faker.datatype.boolean({ probability: PROBABILITY_HAS_LEARNING_PATH });
  const learningPathId = hasLearningPath ? faker.string.uuid() : null;

  const ownerId = faker.string.uuid();

  // Determinism anchor — see `deterministicDateAnchor()`.
  const dateAnchor = deterministicDateAnchor();

  const createdAt = faker.date
    .recent({ days: RECENT_DAYS_CREATED, refDate: dateAnchor })
    .toISOString();
  const updatedAt = faker.date
    .recent({ days: RECENT_DAYS_UPDATED, refDate: dateAnchor })
    .toISOString();

  return {
    id: faker.string.uuid(),
    name,
    slug,
    description,
    category,
    status,
    levelIds,
    prerequisiteCompetencyIds,
    learningPathId,
    certifiedUserIds,
    ownerId,
    createdAt,
    updatedAt,
    ...overrides,
  };
}

/**
 * Generate a {@link CompetencyLevel} instance with sensible defaults and
 * optional overrides.
 *
 * Each invocation produces an independent, parallel-safe instance:
 *   - `id`, `name` are unique per invocation.
 *   - `level` is randomly drawn from the closed proficiency-level union.
 *   - `numericValue` is deterministically derived from `level` per the
 *     `PROFICIENCY_LEVEL_NUMERIC` mapping.
 *   - `criteria` is an array of 2–5 sentence-form criteria phrases.
 *
 * @example Default level:
 * ```ts
 * const l = competencyLevelFactory();
 * ```
 *
 * @example Targeted override (specific level, scoped to a competency):
 * ```ts
 * const l = competencyLevelFactory({
 *   competencyId: comp.id,
 *   level: 'expert',
 * });
 * // l.numericValue === 5
 * ```
 *
 * @param overrides Partial fields to override on the generated instance.
 * @returns A fully-populated {@link CompetencyLevel} object.
 */
export function competencyLevelFactory(overrides: Partial<CompetencyLevel> = {}): CompetencyLevel {
  const level: ProficiencyLevel = faker.helpers.arrayElement<ProficiencyLevel>(PROFICIENCY_LEVELS);

  const uniqueSuffix = faker.string.alphanumeric({
    length: UNIQUE_SUFFIX_LENGTH,
    casing: 'lower',
  });
  const name = `${E2E_TEST_PREFIX}level-${level}-${uniqueSuffix}`;

  const competencyId = faker.string.uuid();

  // numericValue is derived deterministically from level — guaranteed
  // consistency across the rubric (e.g., 'expert' is always 5).
  // If the consumer overrides `level`, but not `numericValue`, the
  // override of level happens after this calculation through the
  // spread of overrides; tests that need both fields aligned should
  // either override both or rely on the default.
  const numericValue = PROFICIENCY_LEVEL_NUMERIC[level];

  const description = faker.lorem.sentence({
    min: MIN_DESCRIPTION_WORDS,
    max: MAX_DESCRIPTION_WORDS,
  });

  const criteriaCount = faker.number.int({ min: MIN_CRITERIA, max: MAX_CRITERIA });
  const criteria: ReadonlyArray<string> = Array.from({ length: criteriaCount }, () =>
    faker.lorem.sentence({ min: MIN_CRITERIA_WORDS, max: MAX_CRITERIA_WORDS }),
  );

  const resourceCount = faker.number.int({ min: MIN_RESOURCES, max: MAX_RESOURCES });
  const recommendedResources: ReadonlyArray<string> = Array.from({ length: resourceCount }, () =>
    faker.internet.url(),
  );

  // Determinism anchor — see `deterministicDateAnchor()`.
  const dateAnchor = deterministicDateAnchor();

  const createdAt = faker.date
    .recent({ days: RECENT_DAYS_CREATED, refDate: dateAnchor })
    .toISOString();
  const updatedAt = faker.date
    .recent({ days: RECENT_DAYS_UPDATED, refDate: dateAnchor })
    .toISOString();

  return {
    id: faker.string.uuid(),
    name,
    competencyId,
    level,
    numericValue,
    description,
    criteria,
    recommendedResources,
    createdAt,
    updatedAt,
    ...overrides,
  };
}
