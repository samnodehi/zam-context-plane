/**
 * Future Harness — History Compressor Quality Tests. [FUTURE-ONLY]
 *
 * Validates future compressor output fixture cases against
 * schemas/future/history-compressor-output.schema.json.
 *
 * ISOLATION INVARIANTS (docs/22 §5.1, §5.2, §5.3):
 *   - Uses fixtures-future/compressor/ as fixture root (NOT fixtures/).
 *   - Uses future-harness-runner and future-harness-ajv (NOT harness-runner / harness-ajv).
 *   - Does NOT import from tests/phase12/ or src/core/harness-*.
 *   - Does NOT affect Gate B status (Gate B is gated solely on fixtures/ MVP corpus).
 *
 * Canonical: docs/22_MODEL_ASSISTED_HARNESS_SCOPING.md §4.4, §6, §9 (Phase P5);
 *            docs/13_MODEL_ASSISTED_CONTEXT_PLANNING.md §10.
 */

import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runFutureHarness } from '../../src/core/future-harness-runner.js';
import { getCompressorOutputValidator } from '../../src/core/future-harness-ajv.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path to the future compressor fixture group root.
 * Populated in Phase P5 with seed fixture cases.
 */
const FUTURE_COMPRESSOR_DIR = resolve(__dirname, '../../fixtures-future/compressor');

describe('Compressor Harness — Future Quality Tests', () => {
  it('discovers and validates all compressor fixtures', () => {
    const validator = getCompressorOutputValidator();
    const results = runFutureHarness(FUTURE_COMPRESSOR_DIR, validator, 'compressor-output.json');

    // Zero failures required — any failed fixture is a schema-validity defect.
    expect(results.failed).toBe(0);

    // Zero blocked required — any blocked fixture has a layout or I/O error.
    expect(results.blocked).toBe(0);

    // Phase P5: fixtures-future/compressor/ is populated — passed must be > 0.
    expect(results.passed).toBeGreaterThan(0);
  });
});
