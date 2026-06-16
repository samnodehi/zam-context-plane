/**
 * Phase 1: Input loading and validation boundaries.
 *
 * Loads all CLI flag file paths, validates them against accepted JSON Schemas,
 * and applies Class A halt / Class B fallback behavior per docs/06 §2 and
 * docs/11 §4.1.
 *
 * Phase 1 boundary — this module must NOT:
 *   - Index the registry (componentsById, componentsByType, etc.) — Phase 2
 *   - Normalise the request into requestSignals — Phase 3
 *   - Derive promptFamily or injectionSuspect — Phase 3
 *   - Execute any selector, conflict resolver, budgeter, or planner — Phase 5+
 *   - Write any output files (prompt-plan.json, trace.json, summary.md) — Phase 11
 *   - Make provider/model/network calls — permanently prohibited in MVP
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRequire as _createRequire } from 'node:module';
const _require = _createRequire(import.meta.url);
// AJV draft 2020-12 — loaded via createRequire because ajv/dist/2020 is CJS.
// ValidateFn is the type of a compiled validator function.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AjvCtor = (_require('ajv/dist/2020') as any).default as new (opts?: Record<string, unknown>) => AjvInstance;
type AjvInstance = {
  addSchema(schema: unknown): AjvInstance;
  compile(schema: unknown): ValidateFn;
};
type ValidateFn = {
  (data: unknown): boolean;
  errors?: Array<{ instancePath: string; message?: string }>;
};

import type {
  LoadedInputs,
  ActiveIds,
  RuntimeCapabilities,
  HistoryStateSummary,
  BudgetState,
  UserConstraints,
  SelectorPolicy,
  RequestSignals,
} from '../types/inputs.js';
import type { PlanningWarning } from '../types/warnings.js';
import type { AnalyzerOutput } from '../types/analyzer.js';

// ---------------------------------------------------------------------------
// ClassAError
// ---------------------------------------------------------------------------

/** Represents a Class A input failure — planning run must halt immediately. */
export class ClassAError extends Error {
  constructor(
    public readonly flag: string,
    public readonly code: 'class_a_missing' | 'class_a_unreadable' | 'class_a_malformed',
    message: string,
  ) {
    super(message);
    this.name = 'ClassAError';
  }
}

// ---------------------------------------------------------------------------
// CLI options shape (as supplied by Commander)
// ---------------------------------------------------------------------------

export interface PlanOptions {
  request: string;
  registry: string;
  requestSignals?: string;   // --request-signals: Class B optional; bypasses MVP stub when valid
  analyzerOutput?: string;   // --analyzer-output: [FUTURE-ONLY] optional; model-assisted analyzer proposals
  activeIds?: string;
  runtime?: string;
  history?: string;
  budget?: string;
  constraints?: string;
  policy?: string;
  outputDir?: string;
}

// ---------------------------------------------------------------------------
// AJV instance — built once, shared across all validations in a run
// ---------------------------------------------------------------------------

/**
 * Build an AJV instance with draft 2020-12 support and all shared schemas
 * pre-loaded from schemas/shared/. Uses __dirname-relative paths so the
 * loader works from both src/ (via tsx) and dist/ (compiled).
 *
 * Schema URIs in $ref fields use the canonical $id values from the schema
 * files. AJV resolves them via the pre-loaded schema registry, not over the
 * network.
 */
function buildAjv(): AjvInstance {
  const schemaBase = resolveSchemaBase();

  const enumsSchema = _require(resolve(schemaBase, 'shared/enums.shared.schema.json')) as Record<string, unknown>;
  const promptFamilySchema = _require(resolve(schemaBase, 'shared/prompt-family.schema.json')) as Record<string, unknown>;
  const warningCodeSchema = _require(resolve(schemaBase, 'shared/warning-code.schema.json')) as Record<string, unknown>;

  const ajv = new AjvCtor({ strict: false, allErrors: false });

  // Pre-load shared schemas so $ref resolutions within input schemas succeed
  // without network fetches.
  ajv.addSchema(enumsSchema);
  ajv.addSchema(promptFamilySchema);
  ajv.addSchema(warningCodeSchema);

  return ajv;
}

/**
 * Resolve the path to the schemas/ directory regardless of whether we are
 * running via tsx from src/ or from compiled dist/. The schemas/ directory
 * is always at the project root, two levels above src/ or dist/.
 */
function resolveSchemaBase(): string {
  // fileURLToPath correctly handles Windows paths and URL-encoded characters
  // (e.g. spaces encoded as %20 in import.meta.url).
  // dist/core/input-loader.js is 2 levels below project root, same as src/core/.
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = resolve(thisFile, '..');
  return resolve(thisDir, '../../schemas');
}

// Lazily built singleton AJV instance
let _ajv: AjvInstance | null = null;
function getAjv(): AjvInstance {
  if (_ajv === null) {
    _ajv = buildAjv();
  }
  return _ajv;
}

// ---------------------------------------------------------------------------
// File reading helpers
// ---------------------------------------------------------------------------

/**
 * Read a file as UTF-8 text. Throws ClassAError on missing or unreadable file.
 */
function readTextFile(flag: string, filePath: string): string {
  const absPath = resolve(filePath);
  try {
    return readFileSync(absPath, 'utf8');
  } catch (err: unknown) {
    const isNotFound =
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as NodeJS.ErrnoException).code === 'ENOENT';
    if (isNotFound) {
      throw new ClassAError(flag, 'class_a_missing', `File not found: ${absPath}`);
    }
    throw new ClassAError(
      flag,
      'class_a_unreadable',
      `Cannot read file: ${absPath} — ${String(err)}`,
    );
  }
}

/**
 * Parse JSON from a text string. Throws ClassAError on parse failure.
 */
function parseJsonClassA(flag: string, text: string, filePath: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ClassAError(
      flag,
      'class_a_malformed',
      `Invalid JSON in ${filePath}: JSON parse error`,
    );
  }
}

/**
 * Parse JSON from text for Class B input. Returns null on parse failure.
 */
function parseJsonClassB(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// AJV validation helpers
// ---------------------------------------------------------------------------

/**
 * Load and compile a named input schema from schemas/inputs/.
 * Caches compiled validators keyed by schema filename.
 */
const _compiledValidators = new Map<string, ValidateFn>();

function getValidator(schemaFile: string): ValidateFn {
  if (_compiledValidators.has(schemaFile)) {
    return _compiledValidators.get(schemaFile)!;
  }
  const schemaBase = resolveSchemaBase();
  const schema = _require(resolve(schemaBase, `inputs/${schemaFile}`)) as Record<string, unknown>;
  const validate = getAjv().compile(schema);
  _compiledValidators.set(schemaFile, validate);
  return validate;
}

/**
 * Validate parsed JSON against an input schema.
 * Returns the validated value (typed) on success, or null on failure.
 * Class B callers use the null return to trigger fallback behavior.
 */
function validateClassB<T>(schemaFile: string, data: unknown): T | null {
  const validate = getValidator(schemaFile);
  if (validate(data)) {
    return data as T;
  }
  return null;
}

/**
 * Validate parsed JSON against an input schema for Class A.
 * Throws ClassAError with schema error details on failure.
 */
function validateClassA(flag: string, schemaFile: string, data: unknown, filePath: string): void {
  const validate = getValidator(schemaFile);
  if (!validate(data)) {
    const firstError = validate.errors?.[0];
    const detail = firstError
      ? `${firstError.instancePath || '(root)'} ${firstError.message ?? 'schema invalid'}`
      : 'schema validation failed';
    throw new ClassAError(
      flag,
      'class_a_malformed',
      `Schema validation failed for ${filePath}: ${detail}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Class B loaders — each returns [value, warnings]
// ---------------------------------------------------------------------------

const ACTIVE_IDS_DEFAULT: ActiveIds = {
  activeSkillIds: [],
  activeToolIds: [],
  activeMemoryIds: [],
};

const RUNTIME_DEFAULT: RuntimeCapabilities = {
  availableToolIds: [],
  unavailableToolIds: [],
  capabilityInventoryComplete: false,
  runtimeLabel: 'missing',
};

const HISTORY_DEFAULT: HistoryStateSummary = {
  lanesPresent: [],
  durableConstraintsPresent: false,
  openCommitmentsPresent: false,
  recentRawTurnCount: 0,
  totalHistoryTokensApprox: 0,
  historyMalformed: true,
};

const POLICY_DEFAULT: SelectorPolicy = {
  failOpenThreshold: 0.7,
  deterministicOnly: true,
  injectionSuspectAction: 'warn_and_continue',
};

function warn(warnings: PlanningWarning[], code: string, message: string, context?: Record<string, unknown>): void {
  warnings.push({ code, message, ...(context ? { context } : {}) });
}

function loadActiveIds(
  flagPath: string | undefined,
  warnings: PlanningWarning[],
): ActiveIds {
  // Absent: silent default — no warning per docs/06 §2.1 and docs/11 §4.1.
  if (!flagPath) return ACTIVE_IDS_DEFAULT;

  let text: string;
  try {
    text = readFileSync(resolve(flagPath), 'utf8');
  } catch {
    warn(warnings, 'active_ids_missing', '--active-ids file could not be read; treating active ID arrays as empty.', { flag: '--active-ids', path: flagPath });
    return ACTIVE_IDS_DEFAULT;
  }

  const parsed = parseJsonClassB(text);
  if (parsed === null) {
    warn(warnings, 'active_ids_missing', '--active-ids file contains invalid JSON; treating active ID arrays as empty.', { flag: '--active-ids', path: flagPath });
    return ACTIVE_IDS_DEFAULT;
  }

  const validated = validateClassB<ActiveIds>('active-ids.schema.json', parsed);
  if (validated === null) {
    warn(warnings, 'active_ids_missing', '--active-ids file failed schema validation; treating active ID arrays as empty.', { flag: '--active-ids', path: flagPath });
    return ACTIVE_IDS_DEFAULT;
  }

  return validated;
}

function loadRuntime(
  flagPath: string | undefined,
  warnings: PlanningWarning[],
): RuntimeCapabilities {
  if (!flagPath) {
    warn(warnings, 'runtime_capabilities_missing', '--runtime not provided; treating capabilityInventoryComplete as false. All tool availability unknown; all tool components will be included.');
    return RUNTIME_DEFAULT;
  }

  let text: string;
  try {
    text = readFileSync(resolve(flagPath), 'utf8');
  } catch {
    warn(warnings, 'runtime_capabilities_missing', '--runtime file could not be read; applying missing-runtime fallback.', { flag: '--runtime', path: flagPath });
    return RUNTIME_DEFAULT;
  }

  const parsed = parseJsonClassB(text);
  if (parsed === null) {
    warn(warnings, 'runtime_capabilities_missing', '--runtime file contains invalid JSON; applying missing-runtime fallback.', { flag: '--runtime', path: flagPath });
    return RUNTIME_DEFAULT;
  }

  const validated = validateClassB<RuntimeCapabilities>('runtime-capabilities.schema.json', parsed);
  if (validated === null) {
    warn(warnings, 'runtime_capabilities_missing', '--runtime file failed schema validation; applying missing-runtime fallback.', { flag: '--runtime', path: flagPath });
    return RUNTIME_DEFAULT;
  }

  return validated;
}

function loadHistory(
  flagPath: string | undefined,
  warnings: PlanningWarning[],
): HistoryStateSummary {
  if (!flagPath) {
    warn(warnings, 'history_summary_missing', '--history not provided; treating all history components as uncertain (historyMalformed: true). All high-risk/non-optional history components will be included.');
    return HISTORY_DEFAULT;
  }

  let text: string;
  try {
    text = readFileSync(resolve(flagPath), 'utf8');
  } catch {
    warn(warnings, 'history_summary_missing', '--history file could not be read; applying missing-history fallback.', { flag: '--history', path: flagPath });
    return HISTORY_DEFAULT;
  }

  const parsed = parseJsonClassB(text);
  if (parsed === null) {
    warn(warnings, 'history_summary_missing', '--history file contains invalid JSON; applying missing-history fallback.', { flag: '--history', path: flagPath });
    return HISTORY_DEFAULT;
  }

  const validated = validateClassB<HistoryStateSummary>('history-state-summary.schema.json', parsed);
  if (validated === null) {
    warn(warnings, 'history_summary_missing', '--history file failed schema validation; applying missing-history fallback.', { flag: '--history', path: flagPath });
    return HISTORY_DEFAULT;
  }

  return validated;
}

function loadBudget(
  flagPath: string | undefined,
  warnings: PlanningWarning[],
): BudgetState | null {
  if (!flagPath) {
    warn(warnings, 'budget_config_missing', '--budget not provided; treating budget as unconstrained. Selectors are budget-aware but not budget-enforcing.');
    return null;
  }

  let text: string;
  try {
    text = readFileSync(resolve(flagPath), 'utf8');
  } catch {
    warn(warnings, 'budget_config_missing', '--budget file could not be read; treating budget as unconstrained.', { flag: '--budget', path: flagPath });
    return null;
  }

  const parsed = parseJsonClassB(text);
  if (parsed === null) {
    warn(warnings, 'budget_config_missing', '--budget file contains invalid JSON; treating budget as unconstrained.', { flag: '--budget', path: flagPath });
    return null;
  }

  const validated = validateClassB<BudgetState>('budget-state.schema.json', parsed);
  if (validated === null) {
    warn(warnings, 'budget_config_missing', '--budget file failed schema validation; treating budget as unconstrained.', { flag: '--budget', path: flagPath });
    return null;
  }

  return validated;
}

function loadConstraints(
  flagPath: string | undefined,
  warnings: PlanningWarning[],
): UserConstraints | null {
  // Absent: silent — no warning per docs/06 §2.8 and docs/11 §4.1.
  if (!flagPath) return null;

  let text: string;
  try {
    text = readFileSync(resolve(flagPath), 'utf8');
  } catch {
    warn(warnings, 'user_constraints_missing', '--constraints file could not be read; treating as no constraints.', { flag: '--constraints', path: flagPath });
    return null;
  }

  const parsed = parseJsonClassB(text);
  if (parsed === null) {
    warn(warnings, 'user_constraints_missing', '--constraints file contains invalid JSON; treating as no constraints.', { flag: '--constraints', path: flagPath });
    return null;
  }

  const validated = validateClassB<UserConstraints>('user-constraints.schema.json', parsed);
  if (validated === null) {
    warn(warnings, 'user_constraints_missing', '--constraints file failed schema validation; treating as no constraints.', { flag: '--constraints', path: flagPath });
    return null;
  }

  return validated;
}

function loadPolicy(
  flagPath: string | undefined,
  warnings: PlanningWarning[],
): SelectorPolicy {
  if (!flagPath) {
    warn(warnings, 'selector_policy_defaulted', '--policy not provided; applying safe defaults (failOpenThreshold: 0.7, deterministicOnly: true, injectionSuspectAction: "warn_and_continue").');
    return { ...POLICY_DEFAULT };
  }

  let text: string;
  try {
    text = readFileSync(resolve(flagPath), 'utf8');
  } catch {
    warn(warnings, 'selector_policy_defaulted', '--policy file could not be read; applying safe defaults.', { flag: '--policy', path: flagPath });
    return { ...POLICY_DEFAULT };
  }

  const parsed = parseJsonClassB(text);
  if (parsed === null) {
    warn(warnings, 'selector_policy_defaulted', '--policy file contains invalid JSON; applying safe defaults.', { flag: '--policy', path: flagPath });
    return { ...POLICY_DEFAULT };
  }

  const validated = validateClassB<SelectorPolicy>('selector-policy.schema.json', parsed);
  if (validated === null) {
    warn(warnings, 'selector_policy_defaulted', '--policy file failed schema validation; applying safe defaults.', { flag: '--policy', path: flagPath });
    return { ...POLICY_DEFAULT };
  }

  // deterministicOnly coercion: must be true in MVP per docs/06 §2.9.
  if (!validated.deterministicOnly) {
    warn(
      warnings,
      'selector_policy_defaulted',
      '--policy supplied deterministicOnly: false; model-assisted selectors are not implemented in MVP. Coercing to true.',
      { flag: '--policy', path: flagPath },
    );
    return { ...validated, deterministicOnly: true };
  }

  return validated;
}

/**
 * Load and AJV-validate a --request-signals JSON file (Class B optional).
 *
 * Behavior:
 *   - Absent flag (flagPath === undefined): returns null silently. No warning
 *     emitted. Existing behavior is unchanged.
 *   - File unreadable, invalid JSON, or schema-invalid: returns null and emits
 *     a 'request_signals_defaulted' warning so callers can detect the fallback.
 *
 * Phase 3 (request-normalizer.ts) checks loadedInputs.requestSignals:
 *   - non-null: bypass the always-stub; use this object directly (no
 *     prompt_family_defaulted warning emitted).
 *   - null: run the always-stub (general_default / 0.0 / false).
 *
 * Canonical: docs/12 Phase 12 R4 plan §4.
 */
export function loadRequestSignals(
  flagPath: string | undefined,
  warnings: PlanningWarning[],
): RequestSignals | null {
  // Absent flag: silent null, no warning. Existing behavior unchanged.
  if (!flagPath) return null;

  // Read file
  let text: string;
  try {
    text = readFileSync(resolve(flagPath), 'utf8');
  } catch {
    warn(
      warnings,
      'request_signals_defaulted',
      `--request-signals file could not be read: ${flagPath}. Falling back to MVP stub (general_default / 0.0 / false).`,
      { flag: '--request-signals', path: flagPath },
    );
    return null;
  }

  // Parse JSON
  const parsed = parseJsonClassB(text);
  if (parsed === null) {
    warn(
      warnings,
      'request_signals_defaulted',
      `--request-signals file contains invalid JSON: ${flagPath}. Falling back to MVP stub.`,
      { flag: '--request-signals', path: flagPath },
    );
    return null;
  }

  // Validate against request-signals.schema.json
  const validated = validateClassB<RequestSignals>('request-signals.schema.json', parsed);
  if (validated === null) {
    warn(
      warnings,
      'request_signals_defaulted',
      `--request-signals file failed schema validation: ${flagPath}. Falling back to MVP stub.`,
      { flag: '--request-signals', path: flagPath },
    );
    return null;
  }

  return validated;
}

/**
 * Load and AJV-validate a --analyzer-output JSON file. [FUTURE-ONLY]
 *
 * Behavior:
 *   - Absent flag (flagPath === undefined): returns null silently. No warning.
 *   - File unreadable, invalid JSON, or schema-invalid: returns null and emits
 *     an 'analyzer_output_invalid' warning.
 *
 * The loaded AnalyzerOutput is consumed by src/core/analyzer-integrator.ts.
 * It does NOT modify any MVP LoadedInputs field.
 *
 * Canonical: docs/15_REQUEST_ANALYZER_SCHEMA_SCOPING.md §4;
 *            schemas/future/analyzer-output.schema.json.
 */
export function loadAnalyzerOutput(
  flagPath: string | undefined,
  warnings: PlanningWarning[],
): AnalyzerOutput | null {
  // Absent flag: silent null.
  if (!flagPath) return null;

  // Read file
  let text: string;
  try {
    text = readFileSync(resolve(flagPath), 'utf8');
  } catch {
    warn(
      warnings,
      'analyzer_output_invalid',
      `--analyzer-output file could not be read: ${flagPath}. Analyzer proposals will not be applied.`,
      { flag: '--analyzer-output', path: flagPath },
    );
    return null;
  }

  // Parse JSON
  const parsed = parseJsonClassB(text);
  if (parsed === null) {
    warn(
      warnings,
      'analyzer_output_invalid',
      `--analyzer-output file contains invalid JSON: ${flagPath}. Analyzer proposals will not be applied.`,
      { flag: '--analyzer-output', path: flagPath },
    );
    return null;
  }

  // Validate against schemas/future/analyzer-output.schema.json using AJV.
  // Uses a standalone AJV instance for the future schema — does not share
  // the MVP input-loader AJV instance (isolation invariant).
  const futureSchemaBase = resolve(resolveSchemaBase(), '../future');
  const futureAjv = new AjvCtor({ strict: false, allErrors: false });
  let validateAnalyzerOutput: ValidateFn;
  try {
    const schema = _require(resolve(futureSchemaBase, 'analyzer-output.schema.json')) as Record<string, unknown>;
    validateAnalyzerOutput = futureAjv.compile(schema);
  } catch {
    warn(
      warnings,
      'analyzer_output_invalid',
      `--analyzer-output: could not load analyzer-output.schema.json for validation. Analyzer proposals will not be applied.`,
      { flag: '--analyzer-output', path: flagPath },
    );
    return null;
  }

  if (!validateAnalyzerOutput(parsed)) {
    const firstError = validateAnalyzerOutput.errors?.[0];
    const detail = firstError
      ? `${firstError.instancePath || '(root)'} ${firstError.message ?? 'schema invalid'}`
      : 'schema validation failed';
    warn(
      warnings,
      'analyzer_output_invalid',
      `--analyzer-output file failed schema validation: ${flagPath}: ${detail}. Analyzer proposals will not be applied.`,
      { flag: '--analyzer-output', path: flagPath },
    );
    return null;
  }

  return parsed as AnalyzerOutput;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Load and validate all CLI inputs.
 *
 * Returns LoadedInputs on success. All Class B failures produce warnings and
 * fallback values. Class A failures throw ClassAError — caller must catch and
 * exit non-zero.
 *
 * This function does NOT run any pipeline logic:
 *   - No registry indexing (Phase 2)
 *   - No request normalisation (Phase 3)
 *   - No selectors (Phase 5)
 *   - No output file creation (Phase 11)
 */
export function loadInputs(opts: PlanOptions): LoadedInputs {
  const warnings: PlanningWarning[] = [];

  // --- Class A: --request ---
  const requestText = readTextFile('--request', opts.request);
  // Empty request is allowed — Phase 3 handles semantic classification.

  // --- Class A: --registry ---
  const registryText = readTextFile('--registry', opts.registry);
  const registryParsed = parseJsonClassA('--registry', registryText, opts.registry);
  validateClassA('--registry', 'component-registry.schema.json', registryParsed, opts.registry);
  const registryRaw = registryParsed as unknown[];

  // --- Class B inputs ---
  const activeIds = loadActiveIds(opts.activeIds, warnings);
  const runtime = loadRuntime(opts.runtime, warnings);
  const history = loadHistory(opts.history, warnings);
  const budget = loadBudget(opts.budget, warnings);
  const constraints = loadConstraints(opts.constraints, warnings);
  const policy = loadPolicy(opts.policy, warnings);
  // Class B: --request-signals (Phase 12). Non-null bypasses Phase 3 stub.
  const requestSignals = loadRequestSignals(opts.requestSignals, warnings);

  return {
    requestText,
    registryRaw,
    activeIds,
    runtime,
    history,
    budget,
    constraints,
    policy,
    requestSignals,
    warnings,
  };
}
