/**
 * Phase 12: Harness AJV setup.
 *
 * Schema-loading helper — deterministic but performs schema file I/O.
 * Loads output + input schemas and returns compiled AJV validators for use
 * by the harness. Does NOT import from plan.ts or any CLI command module.
 *
 * Canonical: docs/12 Phase 12 R4 §3 (harness-ajv classification).
 */

import { createAjv2020, getSchema, type AjvInstance } from './schema-store.js';

import type { ValidateFn } from '../types/harness.js';

// ---------------------------------------------------------------------------
// Singleton AJV instance for harness validators
// ---------------------------------------------------------------------------

let _harnessAjv: AjvInstance | null = null;

function getHarnessAjv(): AjvInstance {
  if (_harnessAjv !== null) return _harnessAjv;

  const ajv = createAjv2020({ strict: false, allErrors: false });

  // Shared schemas (needed by output and input schemas via $ref)
  ajv.addSchema(getSchema('shared/enums.shared.schema.json'));
  ajv.addSchema(getSchema('shared/prompt-family.schema.json'));
  ajv.addSchema(getSchema('shared/warning-code.schema.json'));

  // Internal schemas needed by trace.schema.json
  ajv.addSchema(getSchema('internal/planning-warning.schema.json'));
  ajv.addSchema(getSchema('internal/selector-summary.schema.json'));
  ajv.addSchema(getSchema('internal/trace-entry.schema.json'));
  ajv.addSchema(getSchema('internal/selection-decision.schema.json'));
  ajv.addSchema(getSchema('internal/resolved-selection-decision.schema.json'));
  ajv.addSchema(getSchema('internal/conflict-resolution-trace.schema.json'));
  ajv.addSchema(getSchema('internal/budget-report.schema.json'));

  _harnessAjv = ajv;
  return ajv;
}

// ---------------------------------------------------------------------------
// Exported validator factory functions
// ---------------------------------------------------------------------------

let _validatePromptPlan: ValidateFn | null = null;
let _validateTrace: ValidateFn | null = null;
let _validateRequestSignals: ValidateFn | null = null;

/**
 * Returns a compiled AJV validator for outputs/prompt-plan.schema.json.
 * Lazily compiled and cached.
 */
export function getPromptPlanValidator(): ValidateFn {
  if (_validatePromptPlan !== null) return _validatePromptPlan;
  const ajv = getHarnessAjv();
  _validatePromptPlan = ajv.compile(getSchema('outputs/prompt-plan.schema.json'));
  return _validatePromptPlan;
}

/**
 * Returns a compiled AJV validator for outputs/trace.schema.json.
 * Lazily compiled and cached.
 */
export function getTraceValidator(): ValidateFn {
  if (_validateTrace !== null) return _validateTrace;
  const ajv = getHarnessAjv();
  _validateTrace = ajv.compile(getSchema('outputs/trace.schema.json'));
  return _validateTrace;
}

/**
 * Returns a compiled AJV validator for inputs/request-signals.schema.json.
 * Lazily compiled and cached.
 */
export function getRequestSignalsValidator(): ValidateFn {
  if (_validateRequestSignals !== null) return _validateRequestSignals;
  // request-signals.schema.json only needs the shared schemas, already loaded.
  const ajv = getHarnessAjv();
  _validateRequestSignals = ajv.compile(getSchema('inputs/request-signals.schema.json'));
  return _validateRequestSignals;
}
