/**
 * Phase 12: Evaluation Harness types.
 *
 * All types used by the harness modules (harness-runner, harness-checks,
 * harness-report, harness-ajv, evaluate.ts). Pure type declarations — no I/O,
 * no AJV, no runtime logic.
 *
 * Canonical: docs/12 Phase 12 R4.
 */

// ---------------------------------------------------------------------------
// RunFixtureFn — injected CLI runner
// ---------------------------------------------------------------------------

/**
 * Result of invoking the planner against one fixture's inputs.
 * The outputDir is a temporary directory where the CLI wrote its outputs.
 */
export interface FixtureRunResult {
  /** CLI exit code (0 = success). */
  status: number;
  /** Combined stderr text from the CLI invocation. */
  stderr: string;
  /** Directory where the CLI wrote prompt-plan.json, trace.json, summary.md. */
  outputDir: string;
}

/**
 * A function that invokes the planner against one fixture's inputs directory
 * and returns the run result. Injected by the caller of runHarness.
 *
 * Callers:
 *   - evaluate.ts (shipped): provides a runtime-safe subprocess spawner using
 *     process.execPath + process.execArgv + process.argv[1].
 *   - harness.test.ts (dev): provides an explicit tsx/esm spawner for Vitest.
 *
 * Note: tsx/esm appears ONLY in test files, never in src/ modules.
 */
export type RunFixtureFn = (fixtureInputsDir: string) => FixtureRunResult;

// ---------------------------------------------------------------------------
// AJV validate-function type (mirrors plan.ts ValidateFn)
// ---------------------------------------------------------------------------

/**
 * AJV compiled validator function shape.
 * Declared here so harness-ajv.ts and harness-checks.ts stay self-contained
 * without importing from plan.ts (which would create a circular src dependency).
 */
export type ValidateFn = {
  (data: unknown): boolean;
  errors?: Array<{ instancePath: string; message?: string }>;
};

// ---------------------------------------------------------------------------
// HarnessOptions — input to runHarness()
// ---------------------------------------------------------------------------

export interface HarnessOptions {
  /** Absolute path to the fixtures/ directory. */
  fixturesDir: string;
  /** Injected CLI runner. Provides the CLI invocation appropriate for the context. */
  runFixture: RunFixtureFn;
  /** AJV validator for outputs/prompt-plan.schema.json. */
  validatePromptPlan: ValidateFn;
  /** AJV validator for outputs/trace.schema.json. */
  validateTrace: ValidateFn;
  /** AJV validator for inputs/request-signals.schema.json. */
  validateRequestSignals: ValidateFn;
}

// ---------------------------------------------------------------------------
// EvaluationReport — top-level harness output
// ---------------------------------------------------------------------------

export interface EvaluationReport {
  reportId: string;
  timestamp: string;
  harnessVersion: '1.0.0';
  mode: 'static+generated';
  fixtureDiscovery: {
    totalCases: number;
    totalFiles: number;
    discoveryErrors: string[];
  };
  results: {
    passed: number;
    failed: number;
    skipped: number;
    blocked: number;
  };
  perFixture: PerFixtureResult[];
  determinismChecks: DeterminismResult[];
  deferred: string[];
}

// ---------------------------------------------------------------------------
// SkipApproval
// ---------------------------------------------------------------------------

/** Full approval metadata from a validated inputs/skip-reason.json. */
export interface SkipApproval {
  reason: string;
  approvedBy: string;
  approvedDate: string;
  unitTestCoverage: string;
}

// ---------------------------------------------------------------------------
// PerFixtureResult
// ---------------------------------------------------------------------------

export interface PerFixtureResult {
  fixturePath: string;
  status: 'passed' | 'failed' | 'skipped' | 'blocked';
  /** Present when status is 'skipped'. Full validated approval metadata. */
  skipApproval?: SkipApproval;
  cliExitCode: number | null;
  /** Raw stderr from the CLI subprocess run (empty string if CLI was not invoked or produced no stderr). */
  cliStderr: string;
  staticValidation: StaticValidation;
  generatedValidation: GeneratedValidation | null;
  semanticComparison: SemanticComparison | null;
}

export interface StaticValidation {
  layoutOk: boolean;
  promptPlanSchemaOk: boolean;
  traceSchemaOk: boolean;
  /** Whether inputs/request-signals.json is AJV-valid. */
  requestSignalsSchemaOk: boolean;
  assertionsMdPresent: boolean;
  errors: string[];
}

export interface GeneratedValidation {
  outputFilesPresent: boolean;
  promptPlanSchemaOk: boolean;
  traceSchemaOk: boolean;
  /** Whether generated trace.requestPhase matches fixture request-signals.json. */
  requestSignalsMatch: boolean;
  zeroToleranceChecks: ZTCheckResult[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// SemanticComparison
// ---------------------------------------------------------------------------

export interface SemanticComparison {
  status: 'passed' | 'fixture_blocker' | 'skipped';
  partitionComparison: PartitionComparison | null;
  phaseKeyComparison: PhaseKeyComparison | null;
  selectorSummaryComparison: SelectorSummaryComparison | null;
  message: string | null;
}

export interface PartitionComparison {
  expectedSelected: string[];
  generatedSelected: string[];
  expectedOmitted: string[];
  generatedOmitted: string[];
  expectedDeferred: string[];
  generatedDeferred: string[];
  match: boolean;
}

export interface PhaseKeyComparison {
  expectedKeys: string[];
  generatedKeys: string[];
  missingFromGenerated: string[];
  /** Extra keys in generated trace not in the expected fixture trace. Hard failure. */
  extraInGenerated: string[];
  match: boolean;
}

export interface SelectorSummaryComparison {
  expected: Record<string, number>;
  generated: Record<string, number>;
  match: boolean;
}

// ---------------------------------------------------------------------------
// ZTCheckResult — per zero-tolerance check
// ---------------------------------------------------------------------------

export interface ZTCheckResult {
  id: string;
  passed: boolean;
  message: string | null;
}

// ---------------------------------------------------------------------------
// DeterminismResult — per determinism check
// ---------------------------------------------------------------------------

export interface DeterminismResult {
  fixturePath: string;
  run1ContentHash: string;
  run2ContentHash: string;
  normalizedMatch: boolean;
}
