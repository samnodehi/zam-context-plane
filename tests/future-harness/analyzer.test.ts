/**
 * Future Harness — Analyzer Quality Tests. [FUTURE-ONLY]
 *
 * Validates future analyzer output fixture cases against
 * schemas/future/analyzer-output.schema.json.
 *
 * ISOLATION INVARIANTS (docs/22 §5.1, §5.2, §5.3):
 *   - Uses fixtures-future/analyzer/ as fixture root (NOT fixtures/).
 *   - Uses future-harness-runner and future-harness-ajv (NOT harness-runner / harness-ajv).
 *   - Does NOT import from tests/phase12/ or src/core/harness-*.
 *   - Does NOT affect Gate B status (Gate B is gated solely on fixtures/ MVP corpus).
 *   - When fixtures-future/analyzer/ does not exist (Phase P3), the test
 *     passes with 0 results — this is the expected skeleton behavior.
 *
 * Canonical: docs/22_MODEL_ASSISTED_HARNESS_SCOPING.md §4.4, §9 (Phase P3);
 *            docs/15_REQUEST_ANALYZER_SCHEMA_SCOPING.md §4.
 */

import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runFutureHarness } from '../../src/core/future-harness-runner.js';
import { getAnalyzerOutputValidator } from '../../src/core/future-harness-ajv.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path to the future analyzer fixture group root.
 * This directory does not exist in Phase P3 — it will be created in Phase P4.
 * runFutureHarness() handles the missing directory gracefully by returning
 * a zero-result { passed: 0, failed: 0, skipped: 0, blocked: 0 }.
 */
const FUTURE_FIXTURES_DIR = resolve(__dirname, '../../fixtures-future/analyzer');

describe('Analyzer Harness — Future Quality Tests', () => {
  it('discovers and validates all analyzer fixtures', async () => {
    const validator = getAnalyzerOutputValidator();
    const results = runFutureHarness(FUTURE_FIXTURES_DIR, validator, 'analyzer-output.json');

    // Zero failures required — any failed fixture is a schema-validity defect.
    expect(results.failed).toBe(0);

    // Zero blocked required — any blocked fixture has a layout or I/O error.
    expect(results.blocked).toBe(0);

    // Phase P4+: fixtures-future/analyzer/ is populated — passed must be > 0.
    expect(results.passed).toBeGreaterThan(0);
  });
});

