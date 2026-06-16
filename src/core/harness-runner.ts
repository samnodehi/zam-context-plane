/**
 * Phase 12: Harness I/O orchestrator.
 *
 * NOT pure — reads files (readdirSync, readFileSync), invokes RunFixtureFn
 * (may spawn subprocesses), reads generated output files, writes nothing.
 *
 * Discovers fixture cases, runs Mode 1 (static validation) and Mode 2
 * (generated-output validation via injected RunFixtureFn), runs determinism
 * checks, and assembles the EvaluationReport.
 *
 * The caller (evaluate.ts or test) writes the report to disk.
 *
 * Canonical: docs/12 Phase 12 R4 §3 (harness-runner: I/O orchestrator).
 */

import { readdirSync, readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

import type {
  EvaluationReport,
  PerFixtureResult,
  DeterminismResult,
  HarnessOptions,
  StaticValidation,
  GeneratedValidation,
  SemanticComparison,
  ZTCheckResult,
  SkipApproval,
} from '../types/harness.js';

import {
  checkZT01Schema,
  checkZT02NoUnsafeOmissions,
  checkZT03NoRawContent,
  checkZT04InputDecisionIds,
  checkZT05FailOpenUnresolved,
  checkZT06NoBudgetOverflowSilence,
  checkZT07CandidateSetAccounting,
  checkZT08PartitionExclusivity,
  checkZT09DeferredPath,
  checkZT10BudgetTrimNotInSelectorConflict,
  checkZT11InjectionWarningDedup,
  checkZT12ResolutionRuleEnum,
  checkZT13NarrativeTemplate,
  checkZT14OutputFilesPresent,
  checkZT15ExitCode,
  checkZT16StaticSchemaValid,
  checkZT17AssertionsMd,
  checkRG01TrimOrderNoNullHint,
  checkRG02PlanningWarningsShape,
  checkRSMRequestSignalsMatch,
  comparePartitions,
  comparePhaseKeys,
  compareSelectorSummary,
} from './harness-checks.js';

import { buildEvaluationReport } from './harness-report.js';

// ---------------------------------------------------------------------------
// Fixture layout constants
// ---------------------------------------------------------------------------

const REQUIRED_INPUT_FILES = [
  'active-ids.json',
  'budget-state.json',
  'component-registry.json',
  'history-state-summary.json',
  'request-signals.json',
  'runtime-capabilities.json',
  'selector-policy.json',
  'user-constraints.json',
];

const REQUIRED_EXPECTED_FILES = [
  'assertions.md',
  'prompt-plan.json',
  'trace.json',
];

/** Fixture cases used for determinism checks (run twice and normalized-compared). */
const DETERMINISM_FIXTURE_SUFFIXES = [
  'keyed-trace-no-injection-phase',
  'safety-beats-omit',
  'include-resolved-optional-actual-trim',
];

// ---------------------------------------------------------------------------
// Normalization for determinism (strip run.runId and timestamps)
// ---------------------------------------------------------------------------

// UUID pattern: 8-4-4-4-12 hex groups
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Normalize a trace JSON for determinism comparison.
 *
 * Replaces all UUID-shaped values with sequential stable placeholders so that
 * two runs with different randomUUID() calls but identical structure produce
 * identical normalized output. Handles:
 *   - run.runId (explicit)
 *   - run.planningRunStartedAt / planningRunCompletedAt (explicit)
 *   - selectorTrace[].decisionId (UUID per decision, changes each run)
 *   - resolvedDecisions[].inputDecisionIds (reference the selectorTrace UUIDs)
 *   - Any other UUID-shaped string in the trace
 *
 * Exported for unit testing.
 */
export function normalizeTraceForDeterminism(trace: Record<string, unknown>): string {
  // Step 1: strip non-deterministic timestamps explicitly (they may not be UUID-shaped)
  const copy: Record<string, unknown> = { ...trace };
  if (typeof copy['run'] === 'object' && copy['run'] !== null) {
    const run = { ...(copy['run'] as Record<string, unknown>) };
    run['planningRunStartedAt'] = '<TIMESTAMP>';
    run['planningRunCompletedAt'] = '<TIMESTAMP>';
    copy['run'] = run;
  }

  // Step 2: serialize and replace all UUIDs with sequential stable placeholders.
  // Two identical traces with different UUIDs will produce the same output
  // because UUID positions in the JSON structure are identical.
  const json = JSON.stringify(copy);
  const uuidMap = new Map<string, string>();
  let counter = 0;
  const normalized = json.replace(UUID_PATTERN, (uuid) => {
    const lower = uuid.toLowerCase();
    if (!uuidMap.has(lower)) {
      uuidMap.set(lower, `<uuid-${counter++}>`);
    }
    return uuidMap.get(lower)!;
  });
  return normalized;
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

// ---------------------------------------------------------------------------
// buildDeterminismResult — exported for unit testing
// ---------------------------------------------------------------------------

/**
 * Core determinism comparison logic.
 *
 * Accepts two run results (status + outputDir) and the fixturePath label.
 * Returns a DeterminismResult with normalizedMatch: false if:
 *   - Either run exited non-zero
 *   - trace.json is missing from either output dir
 *   - prompt-plan.json is missing from either output dir
 *   - trace.json cannot be parsed in either run
 *
 * Exported so tests can invoke it directly with synthetic run outputs
 * without needing to spawn the CLI or go through runHarness.
 */
export function buildDeterminismResult(
  fixturePath: string,
  run1: { status: number; outputDir: string },
  run2: { status: number; outputDir: string },
): DeterminismResult {
  // Fail fast: a non-zero exit is never deterministic success.
  if (run1.status !== 0) {
    return { fixturePath, run1ContentHash: '(run1-exit-nonzero)', run2ContentHash: '(not-run)', normalizedMatch: false };
  }
  if (run2.status !== 0) {
    return { fixturePath, run1ContentHash: '(ok)', run2ContentHash: '(run2-exit-nonzero)', normalizedMatch: false };
  }

  const tracePath1 = join(run1.outputDir, 'trace.json');
  const tracePath2 = join(run2.outputDir, 'trace.json');
  const ppPath1    = join(run1.outputDir, 'prompt-plan.json');
  const ppPath2    = join(run2.outputDir, 'prompt-plan.json');

  // Fail fast: missing required outputs.
  if (!existsSync(tracePath1)) {
    return { fixturePath, run1ContentHash: '(trace-missing-run1)', run2ContentHash: '(not-checked)', normalizedMatch: false };
  }
  if (!existsSync(tracePath2)) {
    return { fixturePath, run1ContentHash: '(ok)', run2ContentHash: '(trace-missing-run2)', normalizedMatch: false };
  }
  if (!existsSync(ppPath1)) {
    return { fixturePath, run1ContentHash: '(prompt-plan-missing-run1)', run2ContentHash: '(not-checked)', normalizedMatch: false };
  }
  if (!existsSync(ppPath2)) {
    return { fixturePath, run1ContentHash: '(ok)', run2ContentHash: '(prompt-plan-missing-run2)', normalizedMatch: false };
  }

  // Parse and normalize traces.
  let run1ContentHash: string;
  let run2ContentHash: string;

  try {
    const t1 = JSON.parse(readFileSync(tracePath1, 'utf8')) as Record<string, unknown>;
    run1ContentHash = hashContent(normalizeTraceForDeterminism(t1));
  } catch (e) {
    return { fixturePath, run1ContentHash: `(trace-parse-error-run1: ${String(e)})`, run2ContentHash: '(not-checked)', normalizedMatch: false };
  }

  try {
    const t2 = JSON.parse(readFileSync(tracePath2, 'utf8')) as Record<string, unknown>;
    run2ContentHash = hashContent(normalizeTraceForDeterminism(t2));
  } catch (e) {
    return { fixturePath, run1ContentHash, run2ContentHash: `(trace-parse-error-run2: ${String(e)})`, normalizedMatch: false };
  }

  // Also check prompt-plan.json (fully deterministic — no timestamps in output).
  const pp1 = readFileSync(ppPath1, 'utf8');
  const pp2 = readFileSync(ppPath2, 'utf8');
  if (pp1 !== pp2) {
    run1ContentHash += '|pp=' + hashContent(pp1);
    run2ContentHash += '|pp=' + hashContent(pp2);
  }

  return {
    fixturePath,
    run1ContentHash,
    run2ContentHash,
    normalizedMatch: run1ContentHash === run2ContentHash,
  };
}

// ---------------------------------------------------------------------------
// Fixture discovery
// ---------------------------------------------------------------------------

interface FixtureCase {
  group: string;
  name: string;
  fixturePath: string;
  inputsDir: string;
  expectedDir: string;
}

/**
 * Discover all fixture cases under fixturesDir.
 * Each case is at fixturesDir/<group>/<case-name>/ with inputs/ and expected/ subdirs.
 */
function discoverFixtures(fixturesDir: string): { cases: FixtureCase[]; errors: string[]; totalFiles: number } {
  const cases: FixtureCase[] = [];
  const errors: string[] = [];
  let totalFiles = 0;

  let groups: string[];
  try {
    groups = readdirSync(fixturesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch (err) {
    errors.push(`Cannot read fixtures directory: ${fixturesDir} — ${String(err)}`);
    return { cases, errors, totalFiles };
  }

  for (const group of groups) {
    const groupDir = join(fixturesDir, group);
    let caseNames: string[];
    try {
      caseNames = readdirSync(groupDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
    } catch (err) {
      errors.push(`Cannot read group directory: ${groupDir} — ${String(err)}`);
      continue;
    }

    for (const name of caseNames) {
      const fixturePath = join(groupDir, name);
      const inputsDir = join(fixturePath, 'inputs');
      const expectedDir = join(fixturePath, 'expected');

      // Count files
      try {
        const inputFiles = readdirSync(inputsDir);
        const expectedFiles = readdirSync(expectedDir);
        totalFiles += inputFiles.length + expectedFiles.length;
      } catch {
        // layout check will catch this
      }

      cases.push({ group, name, fixturePath, inputsDir, expectedDir });
    }
  }

  return { cases, errors, totalFiles };
}

// ---------------------------------------------------------------------------
// Mode 1: Static validation
// ---------------------------------------------------------------------------

function runMode1Static(
  fixtureCase: FixtureCase,
  opts: HarnessOptions,
): StaticValidation {
  const errors: string[] = [];

  // Layout check
  let layoutOk = true;
  for (const f of REQUIRED_INPUT_FILES) {
    if (!existsSync(join(fixtureCase.inputsDir, f))) {
      errors.push(`Missing input file: inputs/${f}`);
      layoutOk = false;
    }
  }
  for (const f of REQUIRED_EXPECTED_FILES) {
    if (!existsSync(join(fixtureCase.expectedDir, f))) {
      errors.push(`Missing expected file: expected/${f}`);
      layoutOk = false;
    }
  }

  // request-signals.json schema validation
  let requestSignalsSchemaOk = false;
  const rsPath = join(fixtureCase.inputsDir, 'request-signals.json');
  if (existsSync(rsPath)) {
    try {
      const rsText = readFileSync(rsPath, 'utf8');
      const rsParsed = JSON.parse(rsText);
      requestSignalsSchemaOk = opts.validateRequestSignals(rsParsed);
      if (!requestSignalsSchemaOk) {
        const err = opts.validateRequestSignals.errors?.[0];
        errors.push(
          `inputs/request-signals.json schema invalid: ${err?.instancePath || '(root)'} ${err?.message ?? 'schema error'}`,
        );
      }
    } catch (e) {
      errors.push(`inputs/request-signals.json read/parse error: ${String(e)}`);
    }
  }

  // expected/prompt-plan.json schema validation
  let promptPlanSchemaOk = false;
  const ppPath = join(fixtureCase.expectedDir, 'prompt-plan.json');
  if (existsSync(ppPath)) {
    try {
      const ppText = readFileSync(ppPath, 'utf8');
      const ppParsed = JSON.parse(ppText);
      promptPlanSchemaOk = opts.validatePromptPlan(ppParsed);
      if (!promptPlanSchemaOk) {
        const err = opts.validatePromptPlan.errors?.[0];
        errors.push(
          `expected/prompt-plan.json schema invalid: ${err?.instancePath || '(root)'} ${err?.message ?? 'schema error'}`,
        );
      }
    } catch (e) {
      errors.push(`expected/prompt-plan.json read/parse error: ${String(e)}`);
    }
  }

  // expected/trace.json schema validation
  let traceSchemaOk = false;
  const tracePath = join(fixtureCase.expectedDir, 'trace.json');
  if (existsSync(tracePath)) {
    try {
      const traceText = readFileSync(tracePath, 'utf8');
      const traceParsed = JSON.parse(traceText);
      traceSchemaOk = opts.validateTrace(traceParsed);
      if (!traceSchemaOk) {
        const err = opts.validateTrace.errors?.[0];
        errors.push(
          `expected/trace.json schema invalid: ${err?.instancePath || '(root)'} ${err?.message ?? 'schema error'}`,
        );
      }
    } catch (e) {
      errors.push(`expected/trace.json read/parse error: ${String(e)}`);
    }
  }

  // assertions.md present and non-empty
  let assertionsMdPresent = false;
  const assertPath = join(fixtureCase.expectedDir, 'assertions.md');
  if (existsSync(assertPath)) {
    try {
      const content = readFileSync(assertPath, 'utf8');
      assertionsMdPresent = content.trim().length > 0;
      if (!assertionsMdPresent) {
        errors.push('expected/assertions.md is empty');
      }
    } catch (e) {
      errors.push(`expected/assertions.md read error: ${String(e)}`);
    }
  } else {
    errors.push('expected/assertions.md is missing');
  }

  return {
    layoutOk,
    promptPlanSchemaOk,
    traceSchemaOk,
    requestSignalsSchemaOk,
    assertionsMdPresent,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Mode 2: Generated-output validation
// ---------------------------------------------------------------------------

function runMode2Generated(
  fixtureCase: FixtureCase,
  opts: HarnessOptions,
): { generatedValidation: GeneratedValidation; semanticComparison: SemanticComparison | null; cliExitCode: number; cliStderr: string } {
  const errors: string[] = [];
  const ztChecks: ZTCheckResult[] = [];

  // Run the CLI via injected RunFixtureFn
  const runResult = opts.runFixture(fixtureCase.inputsDir);
  const cliExitCode = runResult.status;
  const cliStderr = runResult.stderr ?? '';

  // ZT-15: exit code
  ztChecks.push(checkZT15ExitCode(cliExitCode));

  // Check for request_signals_defaulted in stderr (hard failure)
  if (runResult.stderr.includes('request_signals_defaulted')) {
    errors.push(
      'CLI emitted request_signals_defaulted warning — fixture request-signals.json not loaded correctly by --request-signals flag',
    );
  }

  // Check output file presence
  const outputDir = runResult.outputDir;
  const ppOutputPath = join(outputDir, 'prompt-plan.json');
  const traceOutputPath = join(outputDir, 'trace.json');
  const summaryOutputPath = join(outputDir, 'summary.md');

  const promptPlanPresent = existsSync(ppOutputPath);
  const tracePresent = existsSync(traceOutputPath);
  const summaryPresent = existsSync(summaryOutputPath);

  ztChecks.push(checkZT14OutputFilesPresent(promptPlanPresent, tracePresent, summaryPresent));
  const outputFilesPresent = promptPlanPresent && tracePresent && summaryPresent;

  // Schema validation of generated outputs
  let generatedPpSchemaOk = false;
  let generatedTraceSchemaOk = false;
  let generatedPpParsed: Record<string, unknown> | null = null;
  let generatedTraceParsed: Record<string, unknown> | null = null;
  let requestSignalsMatch = true; // default: no mismatch detected

  if (promptPlanPresent) {
    try {
      const ppText = readFileSync(ppOutputPath, 'utf8');
      const ppParsed = JSON.parse(ppText) as Record<string, unknown>;
      generatedPpParsed = ppParsed;
      generatedPpSchemaOk = opts.validatePromptPlan(ppParsed);
      const err = opts.validatePromptPlan.errors?.[0];
      ztChecks.push(checkZT01Schema('prompt-plan', generatedPpSchemaOk, err ? `${err.instancePath} ${err.message}` : undefined));
    } catch (e) {
      errors.push(`Generated prompt-plan.json read/parse error: ${String(e)}`);
      ztChecks.push(checkZT01Schema('prompt-plan', false, String(e)));
    }
  }

  if (tracePresent) {
    try {
      const traceText = readFileSync(traceOutputPath, 'utf8');
      const traceParsed = JSON.parse(traceText) as Record<string, unknown>;
      generatedTraceParsed = traceParsed;
      generatedTraceSchemaOk = opts.validateTrace(traceParsed);
      const err = opts.validateTrace.errors?.[0];
      ztChecks.push(checkZT01Schema('trace', generatedTraceSchemaOk, err ? `${err.instancePath} ${err.message}` : undefined));

      if (generatedTraceSchemaOk) {
        // Run all trace ZT checks
        ztChecks.push(checkZT03NoRawContent(traceParsed));
        ztChecks.push(checkZT04InputDecisionIds(traceParsed));
        ztChecks.push(checkZT05FailOpenUnresolved(traceParsed));
        ztChecks.push(checkZT06NoBudgetOverflowSilence(traceParsed));
        ztChecks.push(checkZT07CandidateSetAccounting(traceParsed));
        ztChecks.push(checkZT10BudgetTrimNotInSelectorConflict(traceParsed));
        ztChecks.push(checkZT11InjectionWarningDedup(traceParsed));
        ztChecks.push(checkZT12ResolutionRuleEnum(traceParsed));
        ztChecks.push(checkZT13NarrativeTemplate(traceParsed));
        ztChecks.push(checkRG01TrimOrderNoNullHint(traceParsed));
        ztChecks.push(checkRG02PlanningWarningsShape(traceParsed));

        // RS-M: Check requestPhase matches fixture request-signals.json
        const rsPath = join(fixtureCase.inputsDir, 'request-signals.json');
        if (existsSync(rsPath)) {
          try {
            const rsParsed = JSON.parse(readFileSync(rsPath, 'utf8')) as Record<string, unknown>;
            const rsResult = checkRSMRequestSignalsMatch(traceParsed, rsParsed);
            ztChecks.push(rsResult);
            requestSignalsMatch = rsResult.passed;
            if (!rsResult.passed) {
              errors.push(`RS-M: ${rsResult.message}`);
            }
          } catch (e) {
            errors.push(`RS-M: Cannot read/parse fixture request-signals.json: ${String(e)}`);
            requestSignalsMatch = false;
          }
        }
      }
    } catch (e) {
      errors.push(`Generated trace.json read/parse error: ${String(e)}`);
      ztChecks.push(checkZT01Schema('trace', false, String(e)));
    }
  }

  if (generatedPpParsed) {
    // Run prompt-plan ZT checks
    ztChecks.push(checkZT02NoUnsafeOmissions(generatedPpParsed));
    ztChecks.push(checkZT08PartitionExclusivity(generatedPpParsed));
    ztChecks.push(checkZT09DeferredPath(generatedPpParsed));
  }

  const generatedValidation: GeneratedValidation = {
    outputFilesPresent,
    promptPlanSchemaOk: generatedPpSchemaOk,
    traceSchemaOk: generatedTraceSchemaOk,
    requestSignalsMatch,
    zeroToleranceChecks: ztChecks,
    errors,
  };

  // Semantic comparison (Layer 1 + Layer 2 + Layer 3)
  let semanticComparison: SemanticComparison | null = null;

  if (generatedPpParsed && generatedTraceParsed && generatedPpSchemaOk && generatedTraceSchemaOk) {
    const ppExpectedPath = join(fixtureCase.expectedDir, 'prompt-plan.json');
    const traceExpectedPath = join(fixtureCase.expectedDir, 'trace.json');

    try {
      const expectedPpParsed = JSON.parse(readFileSync(ppExpectedPath, 'utf8')) as Record<string, unknown>;
      const expectedTraceParsed = JSON.parse(readFileSync(traceExpectedPath, 'utf8')) as Record<string, unknown>;

      // Layer 1: partition comparison
      const partitionResult = comparePartitions(generatedPpParsed, expectedPpParsed);

      // Layer 2: trace key comparison (exact set)
      const keyResult = comparePhaseKeys(generatedTraceParsed, expectedTraceParsed);

      // Layer 3: selectorSummary (warning-only)
      const summaryResult = compareSelectorSummary(generatedTraceParsed, expectedTraceParsed);

      const passed = partitionResult.match && keyResult.match;

      semanticComparison = {
        status: passed ? 'passed' : 'fixture_blocker',
        partitionComparison: partitionResult,
        phaseKeyComparison: keyResult,
        selectorSummaryComparison: summaryResult,
        message: passed
          ? null
          : [
              !partitionResult.match ? 'Partition mismatch' : null,
              !keyResult.match
                ? `Trace key mismatch: missing=[${keyResult.missingFromGenerated}], extra=[${keyResult.extraInGenerated}]`
                : null,
            ].filter(Boolean).join('; '),
      };
    } catch (e) {
      semanticComparison = {
        status: 'skipped',
        partitionComparison: null,
        phaseKeyComparison: null,
        selectorSummaryComparison: null,
        message: `Cannot read expected files for semantic comparison: ${String(e)}`,
      };
    }
  }

  return { generatedValidation, semanticComparison, cliExitCode, cliStderr };
}

// ---------------------------------------------------------------------------
// Determinism check
// ---------------------------------------------------------------------------

function runDeterminismCheck(
  fixtureCase: FixtureCase,
  opts: HarnessOptions,
): DeterminismResult {
  const fixturePath = relative(process.cwd(), fixtureCase.fixturePath);
  const run1 = opts.runFixture(fixtureCase.inputsDir);
  const run2 = opts.runFixture(fixtureCase.inputsDir);
  return buildDeterminismResult(fixturePath, run1, run2);
}

// ---------------------------------------------------------------------------
// Approved-skip validation (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Required fields in inputs/skip-reason.json.
 * All must be present and non-empty strings.
 */
const SKIP_REASON_REQUIRED_FIELDS = [
  'reason', 'approvedBy', 'approvedDate', 'unitTestCoverage',
] as const;

/**
 * Validate an approved-skip file at the given path.
 *
 * Returns { valid: true, data: SkipApproval } if all checks pass,
 * or { valid: false, error: string } if any check fails.
 *
 * Validation rules:
 *   - File must parse as JSON.
 *   - Must be a plain object (not array, not null).
 *   - All 4 required fields must be present and non-empty strings.
 *   - approvedBy must be exactly "user".
 *   - approvedDate must match YYYY-MM-DD exactly (anchored).
 *   - unitTestCoverage must reference both tests/phase8/conflict-resolver.test.ts and SHP-1.
 *
 * Exported for direct unit testing in harness.test.ts.
 */
export function validateSkipReason(
  filePath: string,
): { valid: true; data: SkipApproval } | { valid: false; error: string } {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (e) {
    return { valid: false, error: `Cannot read skip-reason.json: ${String(e)}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { valid: false, error: `skip-reason.json is not valid JSON: ${String(e)}` };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { valid: false, error: 'skip-reason.json must be a plain object' };
  }

  const obj = parsed as Record<string, unknown>;

  // Check all required fields present and non-empty string.
  for (const field of SKIP_REASON_REQUIRED_FIELDS) {
    if (typeof obj[field] !== 'string' || (obj[field] as string).trim() === '') {
      return {
        valid: false,
        error: `skip-reason.json missing or empty required field: '${field}'`,
      };
    }
  }

  // approvedBy must be exactly "user".
  if (obj['approvedBy'] !== 'user') {
    return {
      valid: false,
      error: `skip-reason.json approvedBy '${String(obj['approvedBy'])}' is not an allowed value (allowed: user)`,
    };
  }

  // approvedDate must match YYYY-MM-DD exactly (anchored — no trailing characters).
  const dateStr = obj['approvedDate'] as string;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return {
      valid: false,
      error: `skip-reason.json approvedDate '${dateStr}' does not match YYYY-MM-DD format`,
    };
  }

  // unitTestCoverage must reference both the file path and SHP-1.
  const utc = obj['unitTestCoverage'] as string;
  if (
    !utc.includes('tests/phase8/conflict-resolver.test.ts') ||
    !utc.includes('SHP-1')
  ) {
    return {
      valid: false,
      error: `skip-reason.json unitTestCoverage '${utc}' must reference tests/phase8/conflict-resolver.test.ts SHP-1`,
    };
  }

  return {
    valid: true,
    data: {
      reason: obj['reason'] as string,
      approvedBy: obj['approvedBy'] as string,
      approvedDate: dateStr,
      unitTestCoverage: utc,
    },
  };
}

// ---------------------------------------------------------------------------
// runHarness — main export
// ---------------------------------------------------------------------------

/**
 * I/O orchestrator for the harness.
 *
 * Discovers fixture cases, runs Mode 1 (static) and Mode 2 (generated via
 * injected RunFixtureFn), runs determinism checks, assembles EvaluationReport.
 *
 * NOT pure — reads files, invokes RunFixtureFn (may spawn subprocesses),
 * reads generated output files.
 *
 * Does not write files. Caller (evaluate.ts or test) writes the report.
 */
export function runHarness(opts: HarnessOptions): EvaluationReport {
  // 1. Fixture discovery
  const { cases, errors: discoveryErrors, totalFiles } = discoverFixtures(opts.fixturesDir);

  // 2. Per-fixture processing
  const perFixture: PerFixtureResult[] = [];

  for (const fixtureCase of cases) {
    const fixturePath = relative(process.cwd(), fixtureCase.fixturePath);

    // Mode 1: static validation
    const staticValidation = runMode1Static(fixtureCase, opts);

    // If layout is broken, mark as blocked (cannot run Mode 2)
    if (!staticValidation.layoutOk) {
      perFixture.push({
        fixturePath,
        status: 'blocked',
        cliExitCode: null,
        cliStderr: '',
        staticValidation,
        generatedValidation: null,
        semanticComparison: null,
      });
      continue;
    }

    // Approved-skip check: inputs/skip-reason.json
    // Runs AFTER static validation. Static errors override skip.
    const skipReasonPath = join(fixtureCase.inputsDir, 'skip-reason.json');
    if (existsSync(skipReasonPath)) {
      const staticErrors = staticValidation.errors.length > 0;

      // If static validation has errors, fixture is blocked regardless of skip file.
      if (staticErrors) {
        perFixture.push({
          fixturePath,
          status: 'blocked',
          cliExitCode: null,
          cliStderr: '',
          staticValidation: {
            ...staticValidation,
            errors: [
              ...staticValidation.errors,
              'skip-reason.json present but static validation has errors; fixture blocked',
            ],
          },
          generatedValidation: null,
          semanticComparison: null,
        });
        continue;
      }

      // Static is clean. Validate skip file strictly.
      const skipResult = validateSkipReason(skipReasonPath);
      if (skipResult.valid) {
        perFixture.push({
          fixturePath,
          status: 'skipped',
          skipApproval: skipResult.data,
          cliExitCode: null,
          cliStderr: '',
          staticValidation,
          generatedValidation: null,
          semanticComparison: null,
        });
        continue;
      } else {
        // Invalid skip file => blocked. Gate B must not be satisfied.
        perFixture.push({
          fixturePath,
          status: 'blocked',
          cliExitCode: null,
          cliStderr: '',
          staticValidation: {
            ...staticValidation,
            errors: [...staticValidation.errors, skipResult.error],
          },
          generatedValidation: null,
          semanticComparison: null,
        });
        continue;
      }
    }

    // Mode 2: generated-output validation
    const { generatedValidation, semanticComparison, cliExitCode, cliStderr } = runMode2Generated(
      fixtureCase,
      opts,
    );

    // Determine overall status
    const staticErrors = staticValidation.errors.length > 0;
    const generatedErrors =
      generatedValidation.errors.length > 0 ||
      generatedValidation.zeroToleranceChecks.some((zt) => !zt.passed) ||
      !generatedValidation.requestSignalsMatch;
    const semanticErrors =
      semanticComparison !== null &&
      semanticComparison.status === 'fixture_blocker';

    const status =
      staticErrors || generatedErrors || semanticErrors ? 'failed' : 'passed';

    perFixture.push({
      fixturePath,
      status,
      cliExitCode,
      cliStderr,
      staticValidation,
      generatedValidation,
      semanticComparison,
    });
  }

  // 3. Determinism checks (selected fixtures, run twice each).
  //    Approved-skipped fixtures are excluded from determinism checks.
  const approvedSkippedNames = new Set(
    perFixture
      .filter(f => f.status === 'skipped')
      .map(f => {
        const segments = f.fixturePath.replace(/\\/g, '/').split('/');
        return segments[segments.length - 1];
      }),
  );

  const determinismChecks: DeterminismResult[] = [];

  for (const suffix of DETERMINISM_FIXTURE_SUFFIXES) {
    if (approvedSkippedNames.has(suffix)) continue;
    const matchingCase = cases.find((c) => c.name === suffix);
    if (matchingCase) {
      try {
        const result = runDeterminismCheck(matchingCase, opts);
        determinismChecks.push(result);
      } catch (err) {
        determinismChecks.push({
          fixturePath: relative(process.cwd(), matchingCase.fixturePath),
          run1ContentHash: '(error)',
          run2ContentHash: '(error)',
          normalizedMatch: false,
        });
      }
    }
  }

  // 4. Assemble report
  return buildEvaluationReport(perFixture, determinismChecks, {
    totalCases: cases.length,
    totalFiles,
    discoveryErrors,
  });
}
