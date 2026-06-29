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

/**
 * Register the shared + internal $ref dependency closure on an AJV instance.
 * This is the set of schemas referenced (directly or transitively) by the
 * output schemas (prompt-plan, trace) and request-signals. Factored out so the
 * harness singleton and the dedicated plan-result instance share one list.
 */
function addBaseSchemas(ajv: AjvInstance): void {
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
}

function getHarnessAjv(): AjvInstance {
  if (_harnessAjv !== null) return _harnessAjv;

  const ajv = createAjv2020({ strict: false, allErrors: false });
  addBaseSchemas(ajv);

  _harnessAjv = ajv;
  return ajv;
}

// ---------------------------------------------------------------------------
// Exported validator factory functions
// ---------------------------------------------------------------------------

let _validatePromptPlan: ValidateFn | null = null;
let _validateTrace: ValidateFn | null = null;
let _validateRequestSignals: ValidateFn | null = null;
let _validatePlanResult: ValidateFn | null = null;

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

/**
 * Returns a compiled AJV validator for outputs/plan-result.schema.json — the
 * POST /plan 200 response envelope `{ promptPlan, trace, summary }`.
 *
 * Uses a dedicated AJV instance (not the harness singleton) so the prompt-plan
 * and trace sub-schemas can be registered as resolvable $refs. The singleton
 * compiles those two directly via getPromptPlanValidator/getTraceValidator, so
 * adding them there would collide on $id; keeping plan-result isolated avoids
 * that without changing the existing validators.
 *
 * Lazily compiled and cached. Canonical: docs/18 §4.2.
 */
export function getPlanResultValidator(): ValidateFn {
  if (_validatePlanResult !== null) return _validatePlanResult;
  const ajv = createAjv2020({ strict: false, allErrors: false });
  addBaseSchemas(ajv);
  // plan-result.schema.json is a pure $ref composition of these two.
  ajv.addSchema(getSchema('outputs/prompt-plan.schema.json'));
  ajv.addSchema(getSchema('outputs/trace.schema.json'));
  _validatePlanResult = ajv.compile(getSchema('outputs/plan-result.schema.json'));
  return _validatePlanResult;
}
