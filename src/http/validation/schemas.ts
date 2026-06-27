/**
 * HTTP layer schema validation helpers. [FUTURE-ONLY for analyzer-output and model-selector-output]
 *
 * This module provides AJV-based validation for future-only request body
 * fields (specifically `analyzerOutput` and `modelSelectorOutputs`) in the
 * POST /plan handler.
 *
 * WHY THIS EXISTS (isolation invariant):
 *   - The CLI path uses loadAnalyzerOutput() in src/core/input-loader.ts which
 *     reads a file path, parses JSON, then validates via AJV.
 *   - The HTTP path receives already-parsed JSON from Fastify's body parser.
 *     This module provides the AJV validation step for the HTTP path WITHOUT
 *     modifying src/core/input-loader.ts.
 *   - A standalone AJV instance is used (not shared with any MVP AJV instance),
 *     preserving the isolation invariant from docs/22 §5 and docs/15 §4.
 *   - The same isolated AJV instance also validates ModelSelectorOutput records
 *     (docs/19 §8; schemas/future/model-selector-output.schema.json).
 *
 * Canonical: docs/18 §4.2; docs/21 §4.1; docs/15_REQUEST_ANALYZER_SCHEMA_SCOPING.md §4;
 *            docs/19_MODEL_ASSISTED_SELECTOR_SCOPING.md §8;
 *            schemas/future/analyzer-output.schema.json;
 *            schemas/future/model-selector-output.schema.json.
 */

import { createAjv2020, getSchema } from '../../core/schema-store.js';

import type { AnalyzerOutput } from '../../types/analyzer.js';
import type { ModelSelectorOutput } from '../../types/model-selector.js';
import type { PlanningWarning } from '../../types/warnings.js';

// ---------------------------------------------------------------------------
// Compiled validator (lazy singleton, isolated from MVP AJV instance)
// ---------------------------------------------------------------------------

type ValidateFn = (data: unknown) => boolean;
interface ValidateFnWithErrors extends ValidateFn {
  errors?: Array<{ instancePath: string; message?: string }> | null;
}

let _validateAnalyzerOutput: ValidateFnWithErrors | null = null;
let _validatorLoadError: string | null = null;

let _validateModelSelectorOutput: ValidateFnWithErrors | null = null;
let _modelSelectorValidatorLoadError: string | null = null;

/**
 * Return the compiled AJV validator for AnalyzerOutput.
 * Lazy-initialized on first call. Errors are captured and returned
 * as null (caller emits warning).
 */
function getAnalyzerOutputValidator(): ValidateFnWithErrors | null {
  if (_validatorLoadError !== null) return null;
  if (_validateAnalyzerOutput !== null) return _validateAnalyzerOutput;

  try {
    const futureAjv = createAjv2020({ strict: false, allErrors: false });
    _validateAnalyzerOutput = futureAjv.compile(
      getSchema('future/analyzer-output.schema.json'),
    ) as ValidateFnWithErrors;
    return _validateAnalyzerOutput;
  } catch (err) {
    _validatorLoadError = err instanceof Error ? err.message : String(err);
    return null;
  }
}

/**
 * Return the compiled AJV validator for ModelSelectorOutput.
 * Lazy-initialized on first call. Errors are captured and returned
 * as null (caller emits warning).
 */
function getModelSelectorOutputValidator(): ValidateFnWithErrors | null {
  if (_modelSelectorValidatorLoadError !== null) return null;
  if (_validateModelSelectorOutput !== null) return _validateModelSelectorOutput;

  try {
    const futureAjv = createAjv2020({ strict: false, allErrors: false });
    _validateModelSelectorOutput = futureAjv.compile(
      getSchema('future/model-selector-output.schema.json'),
    ) as ValidateFnWithErrors;
    return _validateModelSelectorOutput;
  } catch (err) {
    _modelSelectorValidatorLoadError = err instanceof Error ? err.message : String(err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate an already-parsed request body field as AnalyzerOutput.
 *
 * This is the HTTP-path equivalent of the file-read+validate path in
 * src/core/input-loader.ts loadAnalyzerOutput(). Since Fastify has already
 * parsed the JSON body, this function receives the parsed object directly.
 *
 * Behavior:
 *   - absent / null: returns null silently (no warning).
 *   - fails schema validation: returns null, emits 'analyzer_output_invalid' warning.
 *   - passes schema validation: returns the value cast as AnalyzerOutput.
 *
 * Canonical: docs/15 §4; src/core/input-loader.ts loadAnalyzerOutput().
 *
 * @param rawValue  The raw parsed JSON value from the request body.
 * @param warnings  Warning accumulator — mutated in place on failure.
 * @returns         AnalyzerOutput on success, null on failure or absence.
 */
export function validateAnalyzerOutputBody(
  rawValue: unknown,
  warnings: PlanningWarning[],
): AnalyzerOutput | null {
  if (rawValue == null) return null;

  const validator = getAnalyzerOutputValidator();
  if (validator === null) {
    warnings.push({
      code: 'analyzer_output_invalid',
      message:
        `analyzerOutput in request body: could not load analyzer-output.schema.json for validation ` +
        `(${_validatorLoadError ?? 'unknown error'}). Analyzer proposals will not be applied.`,
    });
    return null;
  }

  if (!validator(rawValue)) {
    const firstError = validator.errors?.[0];
    const detail = firstError
      ? `${firstError.instancePath || '(root)'} ${firstError.message ?? 'schema invalid'}`
      : 'schema validation failed';
    warnings.push({
      code: 'analyzer_output_invalid',
      message:
        `analyzerOutput in request body failed schema validation: ${detail}. ` +
        `Analyzer proposals will not be applied.`,
    });
    return null;
  }

  return rawValue as AnalyzerOutput;
}

/**
 * Validate an already-parsed request body field as an array of ModelSelectorOutput.
 *
 * Each item in the array is validated individually against the
 * model-selector-output.schema.json schema. Items that fail validation are
 * skipped with a warning; valid items are returned.
 *
 * Behavior:
 *   - absent / null / not an array: returns null silently.
 *   - any item fails schema validation: that item is skipped; warning emitted.
 *   - all items pass: returns array cast as ModelSelectorOutput[].
 *   - all items fail: returns null.
 *
 * Canonical: docs/19 §8; schemas/future/model-selector-output.schema.json.
 *
 * @param rawValue  The raw parsed JSON value from the request body.
 * @param warnings  Warning accumulator — mutated in place on failure.
 * @returns         ModelSelectorOutput[] on success, null if absent or fully invalid.
 */
export function validateModelSelectorOutputsBody(
  rawValue: unknown,
  warnings: PlanningWarning[],
): ModelSelectorOutput[] | null {
  if (rawValue == null) return null;
  if (!Array.isArray(rawValue)) {
    warnings.push({
      code: 'model_selector_output_invalid',
      message:
        'modelSelectorOutputs in request body must be an array. ' +
        'Model selector proposals will not be applied.',
    });
    return null;
  }

  const validator = getModelSelectorOutputValidator();
  if (validator === null) {
    warnings.push({
      code: 'model_selector_output_invalid',
      message:
        `modelSelectorOutputs in request body: could not load model-selector-output.schema.json ` +
        `for validation (${_modelSelectorValidatorLoadError ?? 'unknown error'}). ` +
        `Model selector proposals will not be applied.`,
    });
    return null;
  }

  const valid: ModelSelectorOutput[] = [];
  for (let i = 0; i < rawValue.length; i++) {
    const item = rawValue[i];
    if (!validator(item)) {
      const firstError = validator.errors?.[0];
      const detail = firstError
        ? `${firstError.instancePath || '(root)'} ${firstError.message ?? 'schema invalid'}`
        : 'schema validation failed';
      warnings.push({
        code: 'model_selector_output_invalid',
        message:
          `modelSelectorOutputs[${i}] in request body failed schema validation: ${detail}. ` +
          `Item skipped.`,
      });
      continue;
    }
    valid.push(item as ModelSelectorOutput);
  }

  if (valid.length === 0) return null;
  return valid;
}
