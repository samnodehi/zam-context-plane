/**
 * Future Harness AJV setup. [FUTURE-ONLY]
 *
 * Schema-loading helper for the future model-assisted harness.
 * Loads schemas from schemas/future/ and returns compiled AJV validators.
 *
 * ISOLATION INVARIANTS (docs/22 §5.2 and §5.3):
 *   - This module does NOT import from harness-ajv.ts.
 *   - This module does NOT load any schema from schemas/outputs/, schemas/inputs/,
 *     or schemas/shared/. It is strictly limited to schemas/future/.
 *   - This module is NOT imported by tests/phase12/harness.test.ts.
 *   - This module is NOT imported by any MVP pipeline module.
 *
 * Canonical: docs/22_MODEL_ASSISTED_HARNESS_SCOPING.md §5.3, §9 (Phase P3).
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire as _createRequire } from 'node:module';

// ---------------------------------------------------------------------------
// AJV bootstrap (CJS interop — mirrors harness-ajv.ts pattern)
// ---------------------------------------------------------------------------

const _require = _createRequire(import.meta.url);
// AJV draft 2020-12 — loaded via createRequire because ajv/dist/2020 is CJS.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AjvCtor = (_require('ajv/dist/2020') as any).default as new (opts?: Record<string, unknown>) => AjvInstance;
type AjvInstance = {
  compile(schema: unknown): ValidateFn;
};

/**
 * Minimal ValidateFn shape — compatible with the project's harness.ts ValidateFn
 * but defined locally to avoid coupling this future module to MVP types.
 */
export type ValidateFn = ((data: unknown) => boolean) & {
  errors?: Array<{ instancePath: string; message?: string }> | null;
};

// ---------------------------------------------------------------------------
// Schema base path resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the schemas/future/ directory regardless of whether we run via tsx
 * from src/ or from compiled dist/. schemas/ is always at the project root,
 * two levels above src/ or dist/.
 */
function resolveFutureSchemaBase(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = resolve(thisFile, '..');
  return resolve(thisDir, '../../schemas/future');
}

// ---------------------------------------------------------------------------
// Singleton AJV instance for future harness validators
// ---------------------------------------------------------------------------

let _futureHarnessAjv: AjvInstance | null = null;

function getFutureHarnessAjv(): AjvInstance {
  if (_futureHarnessAjv !== null) return _futureHarnessAjv;
  // strict: false — future schemas use $anchor which AJV strict mode flags.
  // allErrors: false — fail fast on first error (same as MVP harness pattern).
  _futureHarnessAjv = new AjvCtor({ strict: false, allErrors: false });
  return _futureHarnessAjv;
}

// ---------------------------------------------------------------------------
// Exported validator factory functions
// ---------------------------------------------------------------------------

let _validateAnalyzerOutput: ValidateFn | null = null;

/**
 * Returns a compiled AJV validator for schemas/future/analyzer-output.schema.json.
 * Lazily compiled and cached.
 *
 * analyzer-output.schema.json uses only inline enums and no $ref to shared
 * schemas, so no pre-loading of shared schemas is required.
 *
 * Canonical: docs/15_REQUEST_ANALYZER_SCHEMA_SCOPING.md §4;
 *            docs/22_MODEL_ASSISTED_HARNESS_SCOPING.md §9 Phase P3.
 */
export function getAnalyzerOutputValidator(): ValidateFn {
  if (_validateAnalyzerOutput !== null) return _validateAnalyzerOutput;
  const futureSchemaBase = resolveFutureSchemaBase();
  const ajv = getFutureHarnessAjv();
  const schema = _require(
    resolve(futureSchemaBase, 'analyzer-output.schema.json'),
  ) as Record<string, unknown>;
  _validateAnalyzerOutput = ajv.compile(schema);
  return _validateAnalyzerOutput;
}

// ---------------------------------------------------------------------------
// History Compressor output validator
// ---------------------------------------------------------------------------

let _validateCompressorOutput: ValidateFn | null = null;

/**
 * Returns a compiled AJV validator for schemas/future/history-compressor-output.schema.json.
 * Lazily compiled and cached.
 *
 * history-compressor-output.schema.json uses a local $anchor ($defs.StateItem) and
 * no $ref to MVP shared schemas, so no pre-loading of external schemas is required.
 *
 * Canonical: docs/13_MODEL_ASSISTED_CONTEXT_PLANNING.md §10;
 *            docs/22_MODEL_ASSISTED_HARNESS_SCOPING.md §9 Phase P5.
 */
export function getCompressorOutputValidator(): ValidateFn {
  if (_validateCompressorOutput !== null) return _validateCompressorOutput;
  const futureSchemaBase = resolveFutureSchemaBase();
  const ajv = getFutureHarnessAjv();
  const schema = _require(
    resolve(futureSchemaBase, 'history-compressor-output.schema.json'),
  ) as Record<string, unknown>;
  _validateCompressorOutput = ajv.compile(schema);
  return _validateCompressorOutput;
}

// ---------------------------------------------------------------------------
// Model Selector output validator
// ---------------------------------------------------------------------------

let _validateModelSelectorOutput: ValidateFn | null = null;

/**
 * Returns a compiled AJV validator for schemas/future/model-selector-output.schema.json.
 * Lazily compiled and cached.
 *
 * model-selector-output.schema.json uses inline enums only (NOT $ref to
 * schemas/shared/enums.shared.schema.json). This preserves the isolation
 * invariant: this future module must not load schemas from schemas/shared/.
 * The inline enum values are exact copies of the canonical enums (SelectionAction,
 * SelectionPath, SelectionConfidence in docs/06 §4; enums.shared.schema.json).
 *
 * Canonical: docs/19_MODEL_ASSISTED_SELECTOR_SCOPING.md §8 (OQ-2 resolution);
 *            docs/13_MODEL_ASSISTED_CONTEXT_PLANNING.md §12;
 *            docs/22_MODEL_ASSISTED_HARNESS_SCOPING.md §9 (Phase P8).
 */
export function getModelSelectorOutputValidator(): ValidateFn {
  if (_validateModelSelectorOutput !== null) return _validateModelSelectorOutput;
  const futureSchemaBase = resolveFutureSchemaBase();
  const ajv = getFutureHarnessAjv();
  const schema = _require(
    resolve(futureSchemaBase, 'model-selector-output.schema.json'),
  ) as Record<string, unknown>;
  _validateModelSelectorOutput = ajv.compile(schema);
  return _validateModelSelectorOutput;
}

