/**
 * Future Harness — Model-Assisted Selector Output Quality Tests. [FUTURE-ONLY]
 *
 * Validates future model-selector fixture cases against
 * schemas/future/model-selector-output.schema.json.
 *
 * PURPOSE:
 *   Verifies that the ModelSelectorOutput schema correctly validates
 *   model-assisted selector proposals conforming to the OQ-2 resolution
 *   from docs/19_MODEL_ASSISTED_SELECTOR_SCOPING.md §8. A ProposalDecision
 *   is the correct model-facing output type — distinct from the
 *   Orchestrator-internal SelectionDecision.
 *
 * ISOLATION INVARIANTS (docs/22 §5.1, §5.2, §5.3):
 *   - Uses fixtures-future/model-selector/ as fixture root (NOT fixtures/).
 *   - Uses future-harness-runner and future-harness-ajv (NOT harness-runner / harness-ajv).
 *   - Does NOT import from tests/phase12/ or any MVP test file.
 *   - Does NOT affect Gate B status (Gate B is gated solely on fixtures/ MVP corpus).
 *   - Does NOT modify schemas/outputs/, schemas/inputs/, or schemas/shared/.
 *   - Does NOT modify fixtures/ (the MVP corpus).
 *
 * Canonical: docs/19_MODEL_ASSISTED_SELECTOR_SCOPING.md §8 (OQ-2 resolution);
 *            docs/13_MODEL_ASSISTED_CONTEXT_PLANNING.md §12;
 *            docs/22_MODEL_ASSISTED_HARNESS_SCOPING.md §4.4, §6, §9 (Phase P8).
 */

import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runFutureHarness } from '../../src/core/future-harness-runner.js';
import { getModelSelectorOutputValidator } from '../../src/core/future-harness-ajv.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path to the future model-selector fixture group root.
 * Populated in Phase P8 with seed fixture cases.
 */
const FUTURE_MODEL_SELECTOR_DIR = resolve(__dirname, '../../fixtures-future/model-selector');

describe('Model Selector Harness — Future Quality Tests', () => {
  it('discovers and validates all model-selector fixtures', () => {
    const validator = getModelSelectorOutputValidator();
    const results = runFutureHarness(FUTURE_MODEL_SELECTOR_DIR, validator, 'model-selector-output.json');

    // Zero failures required — any failed fixture is a schema-validity defect.
    expect(results.failed).toBe(0);

    // Zero blocked required — any blocked fixture has a layout or I/O error.
    expect(results.blocked).toBe(0);

    // Phase P8: fixtures-future/model-selector/ is populated — passed must be > 0.
    expect(results.passed).toBeGreaterThan(0);
  });
});
