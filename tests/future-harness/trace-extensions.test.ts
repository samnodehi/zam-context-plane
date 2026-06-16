/**
 * Future Harness — Trace Extension Quality Tests. [FUTURE-ONLY]
 *
 * Validates future trace extension fixture cases against
 * schemas/outputs/trace.schema.json.
 *
 * PURPOSE:
 *   Verifies that the five [FUTURE-ONLY] phase extension keys added to
 *   trace.schema.json (analyzerPhase, summaryPhase, reentryPhase,
 *   outputReviewPhase, cacheAdvisoryPhase) correctly validate against AJV
 *   when present alongside the 8 required MVP phase keys.
 *
 * ISOLATION INVARIANTS (docs/22 §5.1, §5.2, §5.3):
 *   - Uses fixtures-future/trace-extensions/ as fixture root (NOT fixtures/).
 *   - Uses future-harness-runner (NOT harness-runner).
 *   - Uses getTraceValidator from harness-ajv (MVP validator) — safe and
 *     intentional: trace.schema.json is the canonical schema for trace.json
 *     at all stages. Future extension keys are already optional properties
 *     in trace.schema.json, validated under the same schema.
 *   - Does NOT import from tests/phase12/ or any MVP test file.
 *   - Does NOT affect Gate B status (Gate B is gated solely on fixtures/ MVP corpus).
 *   - Does NOT modify schemas/outputs/trace.schema.json.
 *   - Does NOT modify fixtures/ (the MVP corpus).
 *
 * Canonical: docs/22_MODEL_ASSISTED_HARNESS_SCOPING.md §4.4, §6, §9 (Phase P7);
 *            docs/16_TRACE_EXTENSIONS_SCOPING.md §6;
 *            docs/13_MODEL_ASSISTED_CONTEXT_PLANNING.md §20.
 */

import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runFutureHarness } from '../../src/core/future-harness-runner.js';
import { getTraceValidator } from '../../src/core/harness-ajv.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path to the future trace-extensions fixture group root.
 * Populated in Phase P7 with seed fixture cases.
 */
const FUTURE_TRACE_EXTENSIONS_DIR = resolve(__dirname, '../../fixtures-future/trace-extensions');

describe('Trace Extensions Harness — Future Quality Tests', () => {
  it('discovers and validates all trace-extensions fixtures', () => {
    const validator = getTraceValidator();
    const results = runFutureHarness(FUTURE_TRACE_EXTENSIONS_DIR, validator, 'trace.json');

    // Zero failures required — any failed fixture is a schema-validity defect.
    expect(results.failed).toBe(0);

    // Zero blocked required — any blocked fixture has a layout or I/O error.
    expect(results.blocked).toBe(0);

    // Phase P7: fixtures-future/trace-extensions/ is populated — passed must be > 0.
    expect(results.passed).toBeGreaterThan(0);
  });
});
