/**
 * Competency and CompetencyLevel entity factories for the Whoville-Client
 * Competencies module.
 *
 * Models the canonical Competencies-module data shapes:
 *   - `Competency` — a competency / capability entry in the catalog,
 *     organised by `CompetencyCategory` (`'technical'`, `'leadership'`,
 *     `'soft-skill'`, `'certification'`, `'language'`, `'domain'`) and
 *     associated with a set of {@link CompetencyLevel} instances.
 *   - `CompetencyLevel` — a single proficiency tier within a competency
 *     (e.g., `'Beginner'`, `'Intermediate'`, `'Expert'`) defined by a
 *     numeric `level`, a display `name`, and optional rubric `criteria`.
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
 * The live-mode sweeper identifies deletion candidates by inspecting the
 * `name` field on `Competency`. The field begins with the configured
 * `e2e-test-` prefix (default), and a randomized 8-character alphanumeric
 * suffix guarantees uniqueness across parallel workers per AAP §0.10.1.
 *
 * `CompetencyLevel.name` is intentionally NOT prefixed because levels
 * carry generic names like `'Beginner'`, `'Intermediate'` that recur
 * across every competency. They are matched indirectly via their parent
 * Competency's prefixed `name` (the sweeper deletes the parent and the
 * backend cascades deletion of dependent levels).
 *
 * ## Migration-proof shape (AAP §0.10.1)
 *
 * All exported types use only primitive TypeScript types (`string`,
 * `number`, `boolean`, union literals) and `ReadonlyArray<string>` for
 * collections. No Angular-specific types, no Whoville-Client class
 * references, no runtime decorators. The interfaces are forward-compatible
 * with the Angular 11 → 12 → 13 → … → 21 migration path; HTTP API
 * contract changes are the only events that require updates here.
 *
 * ## Determinism (AAP §0.4.4 — "deterministic (seedable) entity instances")
 *
 * All `faker.date.*` calls use a seed-deterministic `refDate` produced
 * by `deterministicDateAnchor()`. The default `refDate: new Date()` would
 * otherwise read the wall-clock — which changes between successive seeded
 * invocations and produces 1ms-level drift in `createdAt` / `updatedAt`,
 * breaking byte-identical reproducibility. See QA Issue #3 (reproduced
 * in role-grant.factory.ts) for the contained fix this anchor pattern
 * embodies.
 *
 * @see AAP §0.5.1.12 — file mandate (Factories, Mocks, and Test Utilities).
 * @see AAP §0.4.4 — Test Data and Fixtures Design (live-mode cleanup).
 * @see AAP §0.10.1 — User-specified directives (parallel-safe, mock-first).
 * @see e2e/pages/competencies/catalog-list.page.ts,
 *      catalog-detail.page.ts, catalog-form.page.ts, skill-list.page.ts,
 *      skill-form.page.ts, proficiency-matrix.page.ts,
 *      learning-path.page.ts, certification.page.ts — POM consumers.
 * @see e2e/mocks/handlers/competencies.handler.ts — mock handler consumer.
 * @see e2e/fixtures/api-responses/competencies/catalog-list.json,
 *      skills-list.json, proficiency-matrix.json,
 *      learning-paths.json — fixture shape references.
 * @see e2e/utils/test-data-cleanup.ts — live-mode sweeper that relies on
 *      the `e2e-test-` prefix on `Competency.name` to identify deletion
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
 * Category / domain of a competency.
 *
 * Closed union for compile-time safety: test code that overrides
 * `category` with a typo (e.g., `category: 'tehnical'`) fails at compile
 * time rather than producing a confusing runtime mismatch. Drawn from the
 * canonical Whoville-Client competency taxonomy.
 *
 * - `'technical'`     — Technical / engineering skills (e.g., 'Python',
 *                       'AWS', 'Cloud Architecture').
 * - `'leadership'`    — People management and leadership.
 * - `'soft-skill'`    — Communication, collaboration, problem-solving.
 * - `'certification'` — Industry-standard certifications (e.g., PMP,
 *                       CISSP).
 * - `'language'`      — Spoken / written language proficiency.
 * - `'domain'`        — Business-domain knowledge (e.g., insurance,
 *                       banking).
 */
export type CompetencyCategory =
  | 'technical'
  | 'leadership'
  | 'soft-skill'
  | 'certification'
  | 'language'
  | 'domain';

/**
 * Competency entity. Represents a skill / capability definition in the
 * Whoville-Client Competencies module catalog.
 *
 * Migration-proof shape: primitive types only. No nested complex objects,
 * no class references, no Angular-specific types.
 *
 * Field stability:
 *   - `id` and `name` are stable identifiers consumers rely on for
 *     cleanup. `name` carries the `e2e-test-` prefix.
 *   - `category` follows the closed {@link CompetencyCategory} union to
 *     keep test data type-safe at compile time.
 *   - `levelIds` references the {@link CompetencyLevel} instances that
 *     define this competency's proficiency rubric.
 *   - `parentId`, `relatedIds` model the optional dependency / similarity
 *     graph between competencies and are stored as UUID strings (rather
 *     than nested objects) to keep this factory at the foundational layer
 *     (no sibling-factory imports).
 *   - `code` is a short alphanumeric identifier (e.g., `'TECH-1234'`)
 *     suitable for catalog lookup tables.
 *   - `tags` is a free-form list drawn from a controlled vocabulary so
 *     test data remains realistic without faker producing gibberish.
 *
 * @see AAP §0.5.1.13 — `e2e/fixtures/api-responses/competencies/catalog-list.json`
 *      mirrors this shape for paginated list responses.
 */
export interface Competency {
  /** UUID identifier (RFC 4122 v4). */
  readonly id: string;
  /**
   * `e2e-test-` prefixed display name for live-mode cleanup eligibility.
   *
   * Format: `e2e-test-<skill-name> <8-char-suffix>` (e.g.,
   * `'e2e-test-Cloud Architecture x7y8a3bc'`). The prefix is the sentinel
   * value the live-mode sweeper matches; the suffix guarantees uniqueness
   * across parallel workers.
   */
  readonly name: string;
  /**
   * Free-text description of the competency. Realistic prose generated by
   * faker (1–3 sentences).
   */
  readonly description: string;
  /** Top-level category (closed union — see {@link CompetencyCategory}). */
  readonly category: CompetencyCategory;
  /**
   * Optional parent competency ID for hierarchical taxonomies.
   *
   * Present (~30% probability by default) when the competency is a
   * sub-competency of a broader skill (e.g., 'AWS Lambda' under 'AWS').
   * Absent for top-level competencies.
   */
  readonly parentId?: string;
  /**
   * UUIDs of {@link CompetencyLevel} entities associated with this
   * competency. Typically 3–5 levels for the standard proficiency rubric.
   *
   * `ReadonlyArray<string>` rather than `string[]` to communicate at the
   * type level that consumers must not mutate the array; immutability is
   * the factory's contract.
   */
  readonly levelIds: ReadonlyArray<string>;
  /**
   * Whether the competency is currently active in the catalog. Defaults
   * to `true` (matching production reality where most catalog entries
   * are live). Tests for inactive / archived competencies override.
   */
  readonly active: boolean;
  /**
   * Optional code / identifier in `<PREFIX>-<NNNN>` format (e.g.,
   * `'TECH-1234'`, `'LEAD-5678'`). The prefix is derived from the
   * category, making test data instantly recognisable in list views and
   * audit logs. Tests for input validation (alphanumeric only, max
   * length, etc.) override `code` directly.
   */
  readonly code?: string;
  /**
   * Optional list of related competency UUIDs. Models the "similar
   * skills" / "you might also like" graph. Empty or undefined for
   * standalone competencies.
   */
  readonly relatedIds?: ReadonlyArray<string>;
  /**
   * Optional tags for search / filtering. Drawn from a controlled
   * vocabulary so test data remains realistic; tests for free-form tag
   * input override `tags` directly with arbitrary strings.
   */
  readonly tags?: ReadonlyArray<string>;
  /** ISO 8601 timestamp of creation (e.g., `'2025-04-12T08:30:00.000Z'`). */
  readonly createdAt: string;
  /** ISO 8601 timestamp of last update. Optional — absent for never-modified rows. */
  readonly updatedAt?: string;
}

/**
 * Competency level entity. Represents a single proficiency tier within
 * a {@link Competency} (e.g., `'Beginner'`, `'Intermediate'`,
 * `'Advanced'`, `'Expert'`).
 *
 * Multiple levels typically attach to one competency, defining the
 * progression scale used in assessments and proficiency matrices.
 *
 * Migration-proof shape: primitive types only.
 *
 * Field stability:
 *   - `id` is the stable identifier; `competencyId` is a UUID reference
 *     to the parent Competency.
 *   - `level` is a numeric value (typically 1–5) where 1 is the lowest
 *     proficiency and N is the highest.
 *   - `name` is the human-readable display label (e.g., `'Beginner'`).
 *     The default factory output maps `level` → `name` deterministically
 *     so `level: 1` always corresponds to `name: 'Beginner'`. Tests for
 *     custom level names override `name` directly.
 *   - `criteria` is an optional free-text description of what evidence /
 *     demonstration is required to attain the level.
 *   - `displayOrder` defaults to `level` so most assessments order
 *     levels by their numeric value (lowest to highest); tests for
 *     custom orderings override.
 */
export interface CompetencyLevel {
  /** UUID identifier (RFC 4122 v4). */
  readonly id: string;
  /** UUID of the parent {@link Competency}. */
  readonly competencyId: string;
  /**
   * Numeric level (1=lowest, N=highest). Default factory output uses the
   * range [1, 5] matching the standard 5-level proficiency rubric.
   */
  readonly level: number;
  /**
   * Display name (e.g., `'Beginner'`, `'Intermediate'`, `'Expert'`).
   * Default factory output maps `level → name` via the standard
   * 5-level vocabulary; tests for custom level names override.
   */
  readonly name: string;
  /** Description of what this level represents. Realistic prose. */
  readonly description: string;
  /**
   * Optional minimum criteria / evidence required to attain this level.
   * Some competencies define explicit level criteria; others use a
   * description-based approach. Optionality matches real-world variation.
   */
  readonly criteria?: string;
  /**
   * Optional ordering hint (used when level numbers don't reflect
   * display order). Defaults to `level` so the natural numeric ordering
   * is preserved unless the test overrides.
   */
  readonly displayOrder?: number;
}

// ---------------------------------------------------------------------------
// Internal constants — file-local; not exported.
//
// Centralised here so changes to canonical competency vocabulary
// (categories, level names, code prefixes) can be made in one place
// without touching factory body logic. The constants are `as const` to
// preserve literal types where used by `faker.helpers.arrayElement<T>()`.
// ---------------------------------------------------------------------------

/** Common prefix applied to every entity name for cleanup eligibility. */
const E2E_TEST_PREFIX = 'e2e-test-';

/** Length of the random alphanumeric uniqueness suffix appended to names. */
const UNIQUE_SUFFIX_LENGTH = 8;

/** Length (digits) of the numeric portion of a competency `code`. */
const CODE_NUMERIC_LENGTH = 4;

/** Closed list of values emitted for `CompetencyCategory`. Kept in lock-step
 *  with the type union above; if a new category is added to the type, append
 *  it here too. */
const COMPETENCY_CATEGORIES: ReadonlyArray<CompetencyCategory> = [
  'technical',
  'leadership',
  'soft-skill',
  'certification',
  'language',
  'domain',
];

/**
 * Code-prefix mapping per category. Keeps generated `code` values
 * instantly recognisable in test logs (`TECH-1234` is clearly a technical
 * skill, `LEAD-5678` is leadership, etc.).
 */
const CODE_PREFIX_BY_CATEGORY: Readonly<Record<CompetencyCategory, string>> = {
  technical: 'TECH',
  leadership: 'LEAD',
  'soft-skill': 'SOFT',
  certification: 'CERT',
  language: 'LANG',
  domain: 'DOM',
};

/**
 * Curated category-aware skill name vocabularies. Faker's generic
 * `commerce.productName()` produces strings like `'Refined Cotton Hat'`
 * which are nonsensical as competency names. The `generateSkillName`
 * helper below uses these arrays to produce realistic names per category
 * (a 'Cloud Architecture' competency in a technical assessment is
 * intuitive; a 'Refined Cotton Hat' is not). This makes test debugging
 * easier and keeps fixture data plausible.
 */
const SKILL_NAMES_BY_CATEGORY: Readonly<Record<CompetencyCategory, ReadonlyArray<string>>> = {
  technical: [
    'Cloud Architecture',
    'Microservices',
    'Database Design',
    'API Development',
    'DevOps Pipeline',
    'Security Engineering',
    'Frontend Development',
    'Mobile Development',
  ],
  leadership: [
    'People Management',
    'Strategic Planning',
    'Conflict Resolution',
    'Mentoring',
    'Stakeholder Communication',
    'Team Building',
  ],
  'soft-skill': [
    'Active Listening',
    'Public Speaking',
    'Negotiation',
    'Critical Thinking',
    'Creative Problem Solving',
    'Emotional Intelligence',
  ],
  certification: [
    'PMP Certification',
    'AWS Solutions Architect',
    'CISSP',
    'CKA',
    'Azure Administrator',
    'Google Cloud Professional',
  ],
  language: [
    'Spanish Fluency',
    'Mandarin Proficiency',
    'French Conversational',
    'German Business',
    'Japanese Reading',
  ],
  domain: [
    'Insurance Underwriting',
    'Banking Operations',
    'Healthcare Compliance',
    'Retail Logistics',
    'Manufacturing Quality',
  ],
};

/**
 * Controlled vocabulary for `Competency.tags`. Tags are typically chosen
 * from a curated list (rather than free-text), so the factory uses this
 * vocabulary to produce realistic tag values. Tests for free-form tag
 * input override `tags` directly with arbitrary strings.
 */
const TAG_VOCABULARY: ReadonlyArray<string> = [
  'core',
  'technical',
  'leadership',
  'communication',
  'problem-solving',
  'team-skills',
  'certifiable',
];

/**
 * Standard 5-level proficiency vocabulary. Position N (zero-indexed)
 * corresponds to level N+1: position 0 → 'Beginner' for level 1, …,
 * position 4 → 'Expert' for level 5. Exposed via `mapLevelToName`.
 */
const LEVEL_NAMES: ReadonlyArray<string> = [
  'Beginner',
  'Novice',
  'Intermediate',
  'Advanced',
  'Expert',
];

/** Fallback name returned by `mapLevelToName` for out-of-range levels. */
const LEVEL_NAME_FALLBACK = 'Unknown';

/** Minimum / maximum number of levels per competency (default factory output). */
const MIN_LEVELS = 3;
const MAX_LEVELS = 5;

/** Minimum / maximum number of related competency UUIDs (default factory output). */
const MIN_RELATED = 0;
const MAX_RELATED = 3;

/** Minimum / maximum number of tags drawn from the controlled vocabulary. */
const MIN_TAGS = 0;
const MAX_TAGS = 4;

/**
 * Numeric range for `CompetencyLevel.level`. Matches the typical
 * Likert-style 5-tier proficiency rubric. Tests for non-standard rubrics
 * (e.g., 1–10 or 1–3) override `level` directly.
 */
const MIN_LEVEL = 1;
const MAX_LEVEL = 5;

/** Probability (0–1) that a generated competency has a non-undefined `parentId`. */
const PROBABILITY_HAS_PARENT = 0.3;

/** Minimum / maximum sentence count for `Competency.description`. */
const MIN_DESCRIPTION_SENTENCES = 1;
const MAX_DESCRIPTION_SENTENCES = 3;

/** Minimum / maximum word count for `CompetencyLevel.description`. */
const MIN_LEVEL_DESCRIPTION_WORDS = 5;
const MAX_LEVEL_DESCRIPTION_WORDS = 15;

/** Minimum / maximum sentence count for `CompetencyLevel.criteria`. */
const MIN_CRITERIA_SENTENCES = 1;
const MAX_CRITERIA_SENTENCES = 3;

/** Lookback window (days) for `createdAt` timestamps. */
const RECENT_DAYS_CREATED = 365;

/** Lookback window (days) for `updatedAt` timestamps. */
const RECENT_DAYS_UPDATED = 30;

// ---------------------------------------------------------------------------
// Determinism anchor (per AAP §0.4.4)
//
// Faker's `date.*` API family — `recent`, `between`, `anytime`, `future`,
// `past` — defaults `refDate` to `new Date()` (the wall-clock). Successive
// invocations under the SAME seed therefore produce ms-level drift in any
// generated ISO timestamp, breaking the byte-identical reproducibility
// that the AAP §0.4.4 contract requires ("randomized but deterministic
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
 * Pick a category-appropriate skill base name from the curated
 * vocabulary. Avoids faker's generic `commerce.productName()` output
 * (which produces nonsensical strings like `'Refined Cotton Hat'`) and
 * keeps test data realistic.
 *
 * @param category Category whose vocabulary to draw from.
 * @returns A skill name from the matching curated array.
 */
function generateSkillName(category: CompetencyCategory): string {
  const vocabulary = SKILL_NAMES_BY_CATEGORY[category];
  return faker.helpers.arrayElement(vocabulary);
}

/**
 * Map a numeric proficiency level to its standard display name.
 *
 * The default 5-level vocabulary is:
 *   - 1 → 'Beginner'
 *   - 2 → 'Novice'
 *   - 3 → 'Intermediate'
 *   - 4 → 'Advanced'
 *   - 5 → 'Expert'
 *
 * Out-of-range levels (≤ 0 or > 5) map to `'Unknown'`. Tests that need
 * a custom mapping override `name` directly on the factory output.
 *
 * @param level Numeric level (typically 1–5).
 * @returns Display name from {@link LEVEL_NAMES} or `'Unknown'`.
 */
function mapLevelToName(level: number): string {
  if (!Number.isInteger(level) || level < 1 || level > LEVEL_NAMES.length) {
    return LEVEL_NAME_FALLBACK;
  }
  // `level - 1` is in [0, LEVEL_NAMES.length - 1] given the bounds check above.
  // The non-null assertion is justified because the bounds check guarantees
  // a valid index; using `??` for additional safety against
  // noUncheckedIndexedAccess if it is ever enabled.
  return LEVEL_NAMES[level - 1] ?? LEVEL_NAME_FALLBACK;
}

// ---------------------------------------------------------------------------
// Public factories
// ---------------------------------------------------------------------------

/**
 * Generate a {@link Competency} instance with sensible defaults and
 * optional overrides.
 *
 * Each invocation produces an independent, parallel-safe instance:
 *   - `id` is a fresh RFC 4122 v4 UUID.
 *   - `name` carries the `e2e-test-` prefix and an 8-character random
 *     suffix to guarantee uniqueness across parallel workers. The base
 *     skill name is drawn from a category-appropriate curated vocabulary.
 *   - `category` is randomly selected from the closed
 *     {@link CompetencyCategory} union.
 *   - `code` follows the `<PREFIX>-<NNNN>` enterprise convention with
 *     prefix derived from the category (e.g., `'TECH-1234'`).
 *   - `levelIds` is an array of 3–5 fresh UUIDs (matching the typical
 *     proficiency-rubric size).
 *   - `parentId` is non-undefined ~30 % of the time (matching typical
 *     hierarchical-taxonomy distributions; most competencies are
 *     top-level).
 *   - `relatedIds` is an array of 0–3 fresh UUIDs.
 *   - `active` defaults to `true` (matching production reality where
 *     most catalog entries are live).
 *
 * The trailing `...overrides` spread enables targeted customisation
 * without having to construct the full object — a common pattern in test
 * code:
 *
 * @example Default competency:
 * ```ts
 * import { competencyFactory } from '@factories';
 *
 * const comp = competencyFactory();
 * // -> {
 * //      id: '7c5b1f3a-...',
 * //      name: 'e2e-test-Cloud Architecture x7y8a3bc',
 * //      description: '...',
 * //      category: 'technical',
 * //      parentId: undefined,            // 70% probability
 * //      levelIds: ['...', '...', '...'],
 * //      active: true,
 * //      code: 'TECH-1234',
 * //      relatedIds: [],
 * //      tags: ['core', 'technical'],
 * //      createdAt: '2025-...',
 * //      updatedAt: '2025-...'
 * //    }
 * ```
 *
 * @example Targeted override (leadership, with explicit parent):
 * ```ts
 * const leadership = competencyFactory({
 *   category: 'leadership',
 *   parentId: parent.id,
 * });
 * ```
 *
 * @example Inactive competency for negative-path tests:
 * ```ts
 * const inactive = competencyFactory({ active: false });
 * ```
 *
 * @example Linked competency-and-levels pair:
 * ```ts
 * const comp = competencyFactory();
 * const levels = comp.levelIds.map((id, idx) =>
 *   competencyLevelFactory({ id, competencyId: comp.id, level: idx + 1 }),
 * );
 * ```
 *
 * @param overrides Partial fields to override on the generated instance.
 *                  Defaults to an empty object.
 * @returns A fully-populated {@link Competency} object.
 */
export function competencyFactory(overrides: Partial<Competency> = {}): Competency {
  // Resolve the effective category: an override (when provided) takes
  // precedence over a random draw. Resolving early — BEFORE generating
  // `name` and `code` — guarantees that those derived fields are
  // category-consistent. A naive implementation that only spreads
  // `...overrides` at the end of `return` produces a competency whose
  // `category` is `'leadership'` but whose `name` reads
  // `'e2e-test-Cloud Architecture …'` and whose `code` reads
  // `'TECH-1234'` — a confusing mismatch that breaks code-prefix
  // validation tests. Honouring the override here is the correct
  // contract: callers reasonably expect `competencyFactory({ category:
  // 'leadership' })` to produce a leadership-flavoured object end-to-end.
  //
  // `arrayElement<const T>()` preserves literal types when given a
  // `ReadonlyArray<CompetencyCategory>` so the random fallback path
  // remains type-safe.
  const category: CompetencyCategory =
    overrides.category ?? faker.helpers.arrayElement<CompetencyCategory>(COMPETENCY_CATEGORIES);

  // Compose the entity name: `e2e-test-<skill> <suffix>`. The suffix is
  // 8-character lowercase alphanumeric (62^8 ≈ 2.18e14 possible values)
  // so collisions across parallel workers are effectively impossible
  // within any plausible test-suite run. The `name` field is itself
  // overridable via the spread below — this default exists to provide a
  // category-consistent realistic value when no override is supplied.
  const skillBase = generateSkillName(category);
  const uniqueSuffix = faker.string.alphanumeric({
    length: UNIQUE_SUFFIX_LENGTH,
    casing: 'lower',
  });
  const name = `${E2E_TEST_PREFIX}${skillBase} ${uniqueSuffix}`;

  // Build a `<PREFIX>-<NNNN>` code where the prefix is category-derived
  // from the effective category resolved above (i.e., honours the
  // `category` override if one was supplied). The mapping is exhaustive
  // (every category has an entry), so the lookup is type-safe and never
  // undefined.
  const codePrefix = CODE_PREFIX_BY_CATEGORY[category];
  const codeNumeric = faker.string.numeric({ length: CODE_NUMERIC_LENGTH });
  const code = `${codePrefix}-${codeNumeric}`;

  // Generate level IDs (UUID references to CompetencyLevel instances).
  // 3–5 levels matches the typical proficiency rubric. Tests that need
  // to coordinate with actual CompetencyLevel instances override
  // `levelIds` directly with the matching UUIDs (or use the
  // `competencyLevelFactory({ competencyId: comp.id })` pattern).
  const levelCount = faker.number.int({ min: MIN_LEVELS, max: MAX_LEVELS });
  const levelIds: ReadonlyArray<string> = Array.from({ length: levelCount }, () =>
    faker.string.uuid(),
  );

  // 0–3 related-competency UUIDs (the "similar skills" graph).
  const relatedCount = faker.number.int({ min: MIN_RELATED, max: MAX_RELATED });
  const relatedIds: ReadonlyArray<string> = Array.from({ length: relatedCount }, () =>
    faker.string.uuid(),
  );

  // Tags drawn from controlled vocabulary so test data remains realistic.
  // The arrayElements helper guarantees uniqueness within the picked subset.
  const tags: ReadonlyArray<string> = faker.helpers.arrayElements(TAG_VOCABULARY, {
    min: MIN_TAGS,
    max: MAX_TAGS,
  });

  // Optional parent — present ~30% of the time for hierarchical taxonomies.
  // Tests that explicitly need a top-level vs nested competency override
  // `parentId` directly (with a known UUID or `undefined`).
  const parentId = faker.datatype.boolean({ probability: PROBABILITY_HAS_PARENT })
    ? faker.string.uuid()
    : undefined;

  // Description: short lorem-ipsum paragraph (1–3 sentences). Realistic
  // prose without requiring a real corpus. Length is bounded so
  // descriptions render reasonably in list-view UI without truncation.
  const description = faker.lorem.paragraph({
    min: MIN_DESCRIPTION_SENTENCES,
    max: MAX_DESCRIPTION_SENTENCES,
  });

  // `createdAt` is generated first; `updatedAt` is constrained to a more
  // recent window so the `createdAt <= updatedAt` invariant holds for the
  // vast majority of generated rows. Tests that care about strict
  // ordering override one or both fields.
  //
  // Determinism guarantee (per AAP §0.4.4): every `faker.date.*` call
  // uses an explicit `refDate` anchored to a seed-deterministic timestamp
  // produced by `deterministicDateAnchor()`. The default `refDate: new
  // Date()` would otherwise read the wall-clock — which changes between
  // successive seeded invocations and produces 1ms-level drift in
  // `createdAt` / `updatedAt`, breaking byte-identical reproducibility.
  // QA Issue #3 reproduced this defect at ~10% rate; this anchor pattern
  // is the contained fix that achieves 100% same-seed reproducibility.
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
    description,
    category,
    parentId,
    levelIds,
    active: true,
    code,
    relatedIds,
    tags,
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
 *   - `id` and `competencyId` are fresh RFC 4122 v4 UUIDs.
 *   - `level` is randomly drawn from [1, 5] — the standard 5-tier
 *     proficiency rubric.
 *   - `name` is deterministically mapped from `level` via the standard
 *     vocabulary (`'Beginner'`, `'Novice'`, `'Intermediate'`,
 *     `'Advanced'`, `'Expert'`). Tests for custom level names override
 *     `name` directly.
 *   - `displayOrder` defaults to `level` so the natural numeric ordering
 *     is preserved.
 *
 * Note: by default, `competencyId` is a fresh UUID unrelated to any
 * Competency. Per the foundational-layer constraint, factories cannot
 * import each other; tests that need linked Competency↔CompetencyLevel
 * pairs pass real IDs explicitly:
 *
 * ```ts
 * const comp = competencyFactory();
 * const level = competencyLevelFactory({ competencyId: comp.id });
 * ```
 *
 * @example Default level (random in [1, 5]):
 * ```ts
 * const lvl = competencyLevelFactory();
 * ```
 *
 * @example Targeted override (specific level, scoped to a competency):
 * ```ts
 * const intermediate = competencyLevelFactory({
 *   level: 3,
 *   name: 'Intermediate',
 *   competencyId: comp.id,
 * });
 * ```
 *
 * @example Custom-named level:
 * ```ts
 * const customNamed = competencyLevelFactory({
 *   level: 5,
 *   name: 'Master',
 * });
 * ```
 *
 * @param overrides Partial fields to override on the generated instance.
 *                  Defaults to an empty object. When overriding `level`,
 *                  callers may also wish to override `name` and
 *                  `displayOrder` to keep the triple internally
 *                  consistent (e.g., `level: 3, name: 'Intermediate',
 *                  displayOrder: 3`).
 * @returns A fully-populated {@link CompetencyLevel} object.
 */
export function competencyLevelFactory(overrides: Partial<CompetencyLevel> = {}): CompetencyLevel {
  // Random level in the standard 5-tier rubric. `faker.number.int` with
  // explicit `min`/`max` guarantees the value is in range; `mapLevelToName`
  // safely handles any out-of-range overrides callers might apply afterwards.
  const level = faker.number.int({ min: MIN_LEVEL, max: MAX_LEVEL });
  const name = mapLevelToName(level);

  // Description: short single sentence (5–15 words). Sized to fit in a
  // tooltip / inline help text without requiring truncation.
  const description = faker.lorem.sentence({
    min: MIN_LEVEL_DESCRIPTION_WORDS,
    max: MAX_LEVEL_DESCRIPTION_WORDS,
  });

  // Criteria: optional 1–3 sentences describing what evidence /
  // demonstration is required to attain this level. Some competencies
  // define explicit level criteria; others rely on `description` alone.
  // The factory generates criteria by default; tests for the
  // criteria-absent code path override with `criteria: undefined`.
  const criteria = faker.lorem.sentences({
    min: MIN_CRITERIA_SENTENCES,
    max: MAX_CRITERIA_SENTENCES,
  });

  return {
    id: faker.string.uuid(),
    competencyId: faker.string.uuid(),
    level,
    name,
    description,
    criteria,
    displayOrder: level,
    ...overrides,
  };
}
