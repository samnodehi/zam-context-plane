/**
 * Phase 12: Harness AJV setup.
 *
 * Schema-loading helper — deterministic but performs schema file I/O.
 * Loads output + input schemas and returns compiled AJV validators for use
 * by the harness. Does NOT import from plan.ts or any CLI command module.
 *
 * Canonical: docs/12 Phase 12 R4 §3 (harness-ajv classification).
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire as _createRequire } from 'node:module';

import type { ValidateFn } from '../types/harness.js';

const _require = _createRequire(import.meta.url);
// AJV draft 2020-12 — loaded via createRequire because ajv/dist/2020 is CJS.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AjvCtor = (_require('ajv/dist/2020') as any).default as new (opts?: Record<string, unknown>) => AjvInstance;
type AjvInstance = {
  addSchema(schema: unknown): AjvInstance;
  compile(schema: unknown): ValidateFn;
};

// ---------------------------------------------------------------------------
// Schema base path resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the schemas/ directory regardless of whether we run via tsx from
 * src/ or from compiled dist/. The schemas/ directory is always at the project
 * root, two levels above src/ or dist/.
 */
function resolveSchemaBase(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = resolve(thisFile, '..');
  return resolve(thisDir, '../../schemas');
}

// ---------------------------------------------------------------------------
// Singleton AJV instance for harness validators
// ---------------------------------------------------------------------------

let _harnessAjv: AjvInstance | null = null;

function getHarnessAjv(): AjvInstance {
  if (_harnessAjv !== null) return _harnessAjv;

  const schemaBase = resolveSchemaBase();
  const ajv = new AjvCtor({ strict: false, allErrors: false });

  // Shared schemas (needed by output and input schemas via $ref)
  ajv.addSchema(_require(resolve(schemaBase, 'shared/enums.shared.schema.json')) as Record<string, unknown>);
  ajv.addSchema(_require(resolve(schemaBase, 'shared/prompt-family.schema.json')) as Record<string, unknown>);
  ajv.addSchema(_require(resolve(schemaBase, 'shared/warning-code.schema.json')) as Record<string, unknown>);

  // Internal schemas needed by trace.schema.json
  ajv.addSchema(_require(resolve(schemaBase, 'internal/planning-warning.schema.json')) as Record<string, unknown>);
  ajv.addSchema(_require(resolve(schemaBase, 'internal/selector-summary.schema.json')) as Record<string, unknown>);
  ajv.addSchema(_require(resolve(schemaBase, 'internal/trace-entry.schema.json')) as Record<string, unknown>);
  ajv.addSchema(_require(resolve(schemaBase, 'internal/selection-decision.schema.json')) as Record<string, unknown>);
  ajv.addSchema(_require(resolve(schemaBase, 'internal/resolved-selection-decision.schema.json')) as Record<string, unknown>);
  ajv.addSchema(_require(resolve(schemaBase, 'internal/conflict-resolution-trace.schema.json')) as Record<string, unknown>);
  ajv.addSchema(_require(resolve(schemaBase, 'internal/budget-report.schema.json')) as Record<string, unknown>);

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
  const schemaBase = resolveSchemaBase();
  const ajv = getHarnessAjv();
  const schema = _require(resolve(schemaBase, 'outputs/prompt-plan.schema.json')) as Record<string, unknown>;
  _validatePromptPlan = ajv.compile(schema);
  return _validatePromptPlan;
}

/**
 * Returns a compiled AJV validator for outputs/trace.schema.json.
 * Lazily compiled and cached.
 */
export function getTraceValidator(): ValidateFn {
  if (_validateTrace !== null) return _validateTrace;
  const schemaBase = resolveSchemaBase();
  const ajv = getHarnessAjv();
  const schema = _require(resolve(schemaBase, 'outputs/trace.schema.json')) as Record<string, unknown>;
  _validateTrace = ajv.compile(schema);
  return _validateTrace;
}

/**
 * Returns a compiled AJV validator for inputs/request-signals.schema.json.
 * Lazily compiled and cached.
 */
export function getRequestSignalsValidator(): ValidateFn {
  if (_validateRequestSignals !== null) return _validateRequestSignals;
  const schemaBase = resolveSchemaBase();
  // request-signals.schema.json only needs the shared schemas, already loaded.
  const ajv = getHarnessAjv();
  const schema = _require(resolve(schemaBase, 'inputs/request-signals.schema.json')) as Record<string, unknown>;
  _validateRequestSignals = ajv.compile(schema);
  return _validateRequestSignals;
}
