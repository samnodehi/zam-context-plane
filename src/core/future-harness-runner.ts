/**
 * Future Harness Runner. [FUTURE-ONLY]
 *
 * I/O orchestrator for the future model-assisted component harness.
 * Discovers fixture cases under a given future fixture directory and validates
 * them against a compiled AJV validator.
 *
 * ISOLATION INVARIANTS (docs/22 §5.1 and §5.3):
 *   - This module does NOT import from harness-runner.ts.
 *   - This module does NOT import the MVP runHarness() function.
 *   - This module does NOT read from fixtures/ (the MVP corpus root).
 *   - This module is NOT imported by tests/phase12/harness.test.ts.
 *   - This module is NOT imported by any MVP pipeline module.
 *
 * Fixture layout (per docs/22 §4.3 — formalized in Phase P4):
 *   fixtures-future/<group>/<case-name>/
 *     inputs/
 *       analyzer-request.json    — Request text + context (placeholder; not validated by schema)
 *       analyzer-config.json     — Analyzer configuration (placeholder; not validated by schema)
 *     expected/
 *       analyzer-output.json     — Expected AnalyzerOutput object (validated by future schema)
 *       assertions.md            — Fixture-specific assertion contract (presence required)
 *
 * The caller passes the fixture group root (e.g. fixtures-future/analyzer/) as fixtureDir.
 * Direct subdirectories of fixtureDir are treated as individual fixture cases.
 *
 * Canonical: docs/22_MODEL_ASSISTED_HARNESS_SCOPING.md §4.3, §5.1, §5.3, §9 (Phase P4).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ValidateFn } from './future-harness-ajv.js';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface FutureHarnessResult {
  /** Number of fixture cases that passed all checks. */
  passed: number;
  /** Number of fixture cases that failed at least one check. */
  failed: number;
  /** Number of fixture cases deliberately skipped (reserved for future skip-reason support). */
  skipped: number;
  /**
   * Number of fixture cases that could not be run due to missing inputs or
   * unrecoverable errors (layout errors, unreadable files, etc.).
   */
  blocked: number;
  /** Per-case details for all cases (useful for debugging failures). */
  details: FutureHarnessCaseResult[];
}

export interface FutureHarnessCaseResult {
  fixturePath: string;
  status: 'passed' | 'failed' | 'skipped' | 'blocked';
  errors: string[];
}

// ---------------------------------------------------------------------------
// Fixture discovery
// ---------------------------------------------------------------------------

/**
 * Discover all fixture case directories directly under fixtureDir.
 *
 * Each direct subdirectory of fixtureDir is a fixture case (per docs/22 §4.3).
 * The caller provides the group root (e.g. fixtures-future/analyzer/).
 *
 * Returns an empty array (without error) if fixtureDir does not exist.
 */
function discoverFutureFixtures(fixtureDir: string): string[] {
  if (!existsSync(fixtureDir)) {
    // Expected if the fixture group root has not been created yet.
    return [];
  }

  try {
    return readdirSync(fixtureDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(fixtureDir, d.name))
      .sort();
  } catch {
    // Cannot read fixtureDir — return empty.
    return [];
  }
}

// ---------------------------------------------------------------------------
// Per-fixture validation
// ---------------------------------------------------------------------------

/**
 * Run a single future fixture case.
 *
 * Formal layout (docs/22 §4.3):
 *   <fixturePath>/expected/analyzer-output.json  — JSON payload validated by schema
 *   <fixturePath>/expected/assertions.md          — Required (presence checked)
 *
 * Status rules:
 *   - Missing expected/<expectedFilename> or expected/assertions.md → blocked
 *   - Unparseable expected/<expectedFilename> → blocked
 *   - AJV schema validation failure → failed
 *   - All checks pass → passed
 */
function runFutureFixtureCase(
  fixturePath: string,
  validator: ValidateFn,
  expectedFilename: string,
): FutureHarnessCaseResult {
  const outputPath = join(fixturePath, 'expected', expectedFilename);
  const assertionsPath = join(fixturePath, 'expected', 'assertions.md');

  // Layout check: expected/<expectedFilename> must exist.
  if (!existsSync(outputPath)) {
    return {
      fixturePath,
      status: 'blocked',
      errors: [`Missing fixture output: expected/${expectedFilename} (path: ${outputPath})`],
    };
  }

  // Layout check: expected/assertions.md must exist.
  if (!existsSync(assertionsPath)) {
    return {
      fixturePath,
      status: 'blocked',
      errors: [`Missing fixture contract: expected/assertions.md (path: ${assertionsPath})`],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(outputPath, 'utf8'));
  } catch (e) {
    return {
      fixturePath,
      status: 'blocked',
      errors: [`Cannot read/parse expected/${expectedFilename}: ${String(e)}`],
    };
  }

  const valid = validator(parsed);
  if (valid) {
    return { fixturePath, status: 'passed', errors: [] };
  }

  const errors: string[] = (validator.errors ?? []).map(
    (err) => `${err.instancePath || '(root)'}: ${err.message ?? 'schema error'}`,
  );
  return { fixturePath, status: 'failed', errors };
}

// ---------------------------------------------------------------------------
// runFutureHarness — main export
// ---------------------------------------------------------------------------

/**
 * Run the future model-assisted component harness.
 *
 * Discovers fixture cases directly under fixtureDir (returns zero-result if the
 * directory does not exist), runs each case through the provided AJV validator,
 * and returns a FutureHarnessResult.
 *
 * @param fixtureDir       - Absolute path to the fixture group root (e.g. fixtures-future/analyzer/).
 * @param validator        - Compiled AJV ValidateFn for the expected output schema.
 * @param expectedFilename - Filename of the expected output JSON inside each case's `expected/` dir.
 *                           e.g. `'analyzer-output.json'` or `'compressor-output.json'`.
 * @returns                - FutureHarnessResult with passed/failed/skipped/blocked counts.
 *
 * Canonical: docs/22_MODEL_ASSISTED_HARNESS_SCOPING.md §4.3, §9 Phase P4–P5;
 *            docs/22 §4.4 (illustrative test pattern).
 */
export function runFutureHarness(
  fixtureDir: string,
  validator: ValidateFn,
  expectedFilename: string,
): FutureHarnessResult {
  const casePaths = discoverFutureFixtures(fixtureDir);

  if (casePaths.length === 0) {
    return { passed: 0, failed: 0, skipped: 0, blocked: 0, details: [] };
  }

  const details: FutureHarnessCaseResult[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let blocked = 0;

  for (const fixturePath of casePaths) {
    const result = runFutureFixtureCase(fixturePath, validator, expectedFilename);
    details.push(result);
    switch (result.status) {
      case 'passed':  passed++;  break;
      case 'failed':  failed++;  break;
      case 'skipped': skipped++; break;
      case 'blocked': blocked++; break;
    }
  }

  return { passed, failed, skipped, blocked, details };
}
