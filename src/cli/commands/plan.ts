import { Command } from 'commander';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire as _createRequire } from 'node:module';
import { loadInputs, loadAnalyzerOutput, ClassAError } from '../../core/input-loader.js';
import type { PlanOptions } from '../../core/input-loader.js';
import type { PlanningWarning } from '../../types/warnings.js';
import { RegistryFatalError } from '../../core/registry-loader.js';
import { CandidateSetFatalError } from '../../core/candidate-set-builder.js';
import { runCorePipeline } from '../../core/api.js';

// ---------------------------------------------------------------------------
// AJV setup for Phase 10 output validation
// ---------------------------------------------------------------------------
// AJV draft 2020-12 — same CJS-require pattern as input-loader.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _require = _createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AjvCtor = (_require('ajv/dist/2020') as any).default as new (opts?: Record<string, unknown>) => AjvInstance;
type AjvInstance = {
  addSchema(schema: unknown): AjvInstance;
  compile(schema: unknown): ValidateFn;
};

/**
 * AJV validate-function shape returned by ajv.compile().
 * Exported so tests can construct a compatible fake validator without depending
 * on the AJV runtime.
 */
export type ValidateFn = {
  (data: unknown): boolean;
  errors?: Array<{ instancePath: string; message?: string }>;
};

function resolveSchemaBase(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = resolve(thisFile, '..');
  return resolve(thisDir, '../../../schemas');
}

function buildOutputAjv(): AjvInstance {
  const schemaBase = resolveSchemaBase();
  const ajv = new AjvCtor({ strict: false, allErrors: false });
  ajv.addSchema(_require(resolve(schemaBase, 'shared/enums.shared.schema.json')) as Record<string, unknown>);
  ajv.addSchema(_require(resolve(schemaBase, 'shared/prompt-family.schema.json')) as Record<string, unknown>);
  ajv.addSchema(_require(resolve(schemaBase, 'shared/warning-code.schema.json')) as Record<string, unknown>);
  ajv.addSchema(_require(resolve(schemaBase, 'internal/planning-warning.schema.json')) as Record<string, unknown>);
  ajv.addSchema(_require(resolve(schemaBase, 'internal/selector-summary.schema.json')) as Record<string, unknown>);
  ajv.addSchema(_require(resolve(schemaBase, 'internal/trace-entry.schema.json')) as Record<string, unknown>);
  ajv.addSchema(_require(resolve(schemaBase, 'internal/selection-decision.schema.json')) as Record<string, unknown>);
  ajv.addSchema(_require(resolve(schemaBase, 'internal/resolved-selection-decision.schema.json')) as Record<string, unknown>);
  ajv.addSchema(_require(resolve(schemaBase, 'internal/conflict-resolution-trace.schema.json')) as Record<string, unknown>);
  ajv.addSchema(_require(resolve(schemaBase, 'internal/budget-report.schema.json')) as Record<string, unknown>);
  return ajv;
}

let _outputAjv: AjvInstance | null = null;
let _validatePromptPlan: ValidateFn | null = null;
let _validateTrace: ValidateFn | null = null;

function getPromptPlanValidator(): ValidateFn {
  if (_validatePromptPlan === null) {
    const schemaBase = resolveSchemaBase();
    const ajv = (_outputAjv ??= buildOutputAjv());
    const schema = _require(resolve(schemaBase, 'outputs/prompt-plan.schema.json')) as Record<string, unknown>;
    _validatePromptPlan = ajv.compile(schema);
  }
  return _validatePromptPlan;
}

function getTraceValidator(): ValidateFn {
  if (_validateTrace === null) {
    const schemaBase = resolveSchemaBase();
    const ajv = (_outputAjv ??= buildOutputAjv());
    const schema = _require(resolve(schemaBase, 'outputs/trace.schema.json')) as Record<string, unknown>;
    _validateTrace = ajv.compile(schema);
  }
  return _validateTrace;
}

export const planCommand = new Command('plan')
  .description('Produce context planning outputs from input files')

  .requiredOption('--request <path>', 'Request text file — Class A required')
  .requiredOption('--registry <path>', 'Component registry JSON — Class A required')
  .option('--active-ids <path>', 'Active IDs JSON — Class B optional')
  .option('--runtime <path>', 'Runtime capabilities JSON — Class B optional')
  .option('--history <path>', 'History state JSON — Class B optional')
  .option('--budget <path>', 'Budget state JSON — Class B optional')
  .option('--constraints <path>', 'User constraints JSON — Class B optional')
  .option('--policy <path>', 'Selector policy JSON — Class B optional')
  .option('--request-signals <path>', 'Pre-normalized request signals JSON — Class B optional; bypasses MVP stub when valid')
  .option('--analyzer-output <path>', '[FUTURE-ONLY] Pre-generated AnalyzerOutput JSON — optional; model-assisted analyzer proposals enter pipeline as advisory inputs')
  .option('--output-dir <path>', 'Output directory (default: working directory)')
  .action((opts: PlanOptions) => {
    // -------------------------------------------------------------------------
    // Phase 1: Input loading and validation (filesystem I/O)
    // -------------------------------------------------------------------------
    let result;
    try {
      result = loadInputs(opts);
    } catch (err) {
      if (err instanceof ClassAError) {
        process.stderr.write(
          `context-plane: error [${err.flag}]: ${err.message}\n` +
          `context-plane: Class A input failure — no output files written. Planning run aborted.\n`,
        );
        process.exit(1);
      }
      throw err;
    }

    // Print Phase 1 Class B warnings to stderr.
    for (const w of result.warnings) {
      process.stderr.write(`context-plane: warning [${w.code}]: ${w.message}\n`);
    }

    // Load analyzer output (filesystem I/O, Class B optional)
    const analyzerLoadWarnings: PlanningWarning[] = [];
    const loadedAnalyzerOutput = loadAnalyzerOutput(opts.analyzerOutput, analyzerLoadWarnings);
    for (const w of analyzerLoadWarnings) {
      process.stderr.write(`context-plane: warning [${w.code}]: ${w.message}\n`);
    }

    // -------------------------------------------------------------------------
    // Phases 2–11: Run core pipeline (pure, no I/O)
    // -------------------------------------------------------------------------
    let pipelineResult;
    try {
      pipelineResult = runCorePipeline(result, {
        analyzerOutput: loadedAnalyzerOutput,
      });
    } catch (err) {
      if (err instanceof RegistryFatalError) {
        process.stderr.write(
          `context-plane: error [registry]: ${err.code}: ${err.message}\n` +
          `context-plane: Registry fatal error — no output files written. Planning run aborted.\n`,
        );
        process.exit(1);
      }
      if (err instanceof CandidateSetFatalError) {
        process.stderr.write(
          `context-plane: error [candidate-set]: ${err.code}: ${err.message}\n` +
          `context-plane: Candidate set fatal error — no output files written. Planning run aborted.\n`,
        );
        process.exit(1);
      }
      throw err;
    }

    // Print Phase 2 registry validation warnings to stderr.
    for (const w of pipelineResult.registryValidationWarnings) {
      process.stderr.write(`context-plane: warning [${w.code}]: ${w.message}\n`);
    }

    // Print all pipeline phase warnings (phases 3–11) to stderr.
    // These warnings are also embedded in the prompt plan and trace outputs.
    for (const w of pipelineResult.pipelineWarnings) {
      process.stderr.write(`context-plane: warning [${w.code}]: ${w.message}\n`);
    }

    // -------------------------------------------------------------------------
    // Output: AJV validation and file writing (filesystem I/O)
    // -------------------------------------------------------------------------
    const outputDir = opts.outputDir ?? process.cwd();
    mkdirSync(outputDir, { recursive: true });

    // AJV-validate prompt-plan.json before writing
    const validationResult = validateAndWritePromptPlan(
      pipelineResult.promptPlan,
      getPromptPlanValidator(),
      outputDir,
    );
    if (!validationResult) {
      process.exit(1);
    }

    // AJV-validate trace.json before writing
    const traceWritten = validateAndWriteTrace(
      pipelineResult.trace,
      getTraceValidator(),
      outputDir,
    );
    if (!traceWritten) {
      process.exit(1);
    }

    // Write summary.md
    writeFileSync(join(outputDir, 'summary.md'), pipelineResult.summary, 'utf8');

    // All phases complete — successful run.
    process.exit(0);
  });

// ---------------------------------------------------------------------------
// Exported validate-and-write helper (for testing with fake validators)
// ---------------------------------------------------------------------------

/**
 * Validate promptPlan against the provided AJV validator and, if valid, write
 * prompt-plan.json to outputDir.
 *
 * Returns true on success (file written).
 * Returns false on validation failure (stderr emitted, file NOT written).
 *
 * Exported to allow tests to inject a fake validator and assert the abort path
 * without running the full CLI pipeline.
 *
 * This function contains no I/O beyond the single writeFileSync on the success
 * path; all other I/O (process.exit, process.stderr) is intentional side-effect
 * observable under test.
 *
 * Canonical: docs/11 §4.2; R2 Phase 10 I5 contract.
 */
export function validateAndWritePromptPlan(
  plan: unknown,
  validate: ValidateFn,
  outputDir: string,
): boolean {
  if (!validate(plan)) {
    const firstError = validate.errors?.[0];
    const detail = firstError
      ? `${firstError.instancePath || '(root)'} ${firstError.message ?? 'schema invalid'}`
      : 'schema validation failed';
    process.stderr.write(
      `context-plane: error [plan-schema]: prompt-plan.json failed schema validation: ${detail}\n` +
      `context-plane: No output files written. Planning run aborted.\n`,
    );
    return false;
  }

  const promptPlanPath = join(outputDir, 'prompt-plan.json');
  writeFileSync(promptPlanPath, JSON.stringify(plan, null, 2) + '\n', 'utf8');
  return true;
}

/**
 * Validate trace against the provided AJV validator and, if valid, write
 * trace.json to outputDir.
 *
 * Returns true on success (file written).
 * Returns false on validation failure (stderr emitted, file NOT written).
 *
 * Exported to allow tests to inject a fake validator and assert the abort path
 * without running the full CLI pipeline. On validation failure:
 *   - trace.json is NOT written
 *   - summary.md is NOT written (caller must not proceed)
 *   - prompt-plan.json may already have been written (acceptable — it was valid)
 *
 * Canonical: docs/11 §4.2; R2 Phase 11 J7/J8 contract.
 */
export function validateAndWriteTrace(
  trace: unknown,
  validate: ValidateFn,
  outputDir: string,
): boolean {
  if (!validate(trace)) {
    const firstError = validate.errors?.[0];
    const detail = firstError
      ? `${firstError.instancePath || '(root)'} ${firstError.message ?? 'schema invalid'}`
      : 'schema validation failed';
    process.stderr.write(
      `context-plane: error [trace-schema]: trace.json failed schema validation: ${detail}\n` +
      `context-plane: No output files written. Planning run aborted.\n`,
    );
    return false;
  }

  const tracePath = join(outputDir, 'trace.json');
  writeFileSync(tracePath, JSON.stringify(trace, null, 2) + '\n', 'utf8');
  return true;
}
