/**
 * ZAM Core Library API — In-Process Plan Function
 *
 * Exposes the full ZAM context planning pipeline as a direct library call,
 * matching the contract defined in docs/18 §7:
 *
 *   "The library API must expose the same validation and fail-open
 *    guarantees as the HTTP API. It is not a raw internal call that
 *    bypasses schema validation."
 *
 * Two entry points:
 *
 *   1. plan(input: CorePlanInput): CorePlanOutput
 *      Public API for external consumers. Accepts in-memory objects,
 *      applies Class B defaults, runs the full pipeline, returns results.
 *
 *   2. runCorePipeline(loadedInputs, opts?): CorePlanOutput
 *      Internal entry point for the CLI. Accepts pre-loaded/pre-validated
 *      LoadedInputs (from input-loader.ts) and runs phases 2–11.
 *
 * Neither function performs filesystem I/O or calls process.exit().
 * All errors are communicated through thrown exceptions.
 *
 * Canonical: docs/18 §7; docs/24 §9.
 */

import { randomUUID } from 'node:crypto';

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

// Core pipeline phases
import { buildRegistryIndexes } from './registry-loader.js';
import { normalizeInputs } from './request-normalizer.js';
import { buildCandidateSet } from './candidate-set-builder.js';
import { runSelectorFanOut, computeSelectorSummary } from './selector-engine.js';
import { runGapCheck } from './gap-check.js';
import { runInjectionGate } from './injection-gate.js';
import { runConflictResolver } from './conflict-resolver.js';
import { runBudgeter } from './budgeter.js';
import { runPromptPlanGenerator } from './prompt-plan-generator.js';
import { runTraceAssembler, runSummaryAssembler } from './trace-summary-assembler.js';
import { integrateAnalyzerOutput } from './analyzer-integrator.js';

// ============================================================================
// Public Types
// ============================================================================

/**
 * Input shape for the library API plan() function.
 * Matches the POST /plan request body from docs/18 §4.2.
 *
 * All fields except `request` and `registry` are optional — matching
 * the Class A / Class B input distinction from the core pipeline.
 */
export interface CorePlanInput {
  /** Class A required. The user request text. */
  request: { text: string; metadata?: Record<string, unknown> };
  /** Class A required. Component registry array (AJV-validated in Phase 2). */
  registry: unknown[];
  /** Class B optional. Active IDs — defaults to empty arrays. */
  activeIds?: ActiveIds;
  /** Class B optional. Runtime capabilities — defaults to missing/incomplete. */
  runtime?: RuntimeCapabilities;
  /** Class B optional. History state — defaults to historyMalformed: true. */
  history?: HistoryStateSummary;
  /** Class B optional. Budget state — defaults to unconstrained (null). */
  budget?: BudgetState | null;
  /** Class B optional. User constraints — defaults to none (null). */
  constraints?: UserConstraints | null;
  /** Class B optional. Selector policy — defaults to safe defaults. */
  policy?: SelectorPolicy;
  /** Class B optional. Pre-normalized request signals — null triggers Phase 3 stub. */
  requestSignals?: RequestSignals | null;
  /** [FUTURE-ONLY] Optional analyzer output for model-assisted proposals. */
  analyzerOutput?: AnalyzerOutput | null;
}

/**
 * Output shape for the library API.
 * Matches the POST /plan response body from docs/18 §4.2.
 */
export interface CorePlanOutput {
  /** The assembled prompt plan (prompt-plan.json structure). */
  promptPlan: unknown;
  /** The full trace (trace.json structure). */
  trace: unknown;
  /** The human-readable summary (summary.md content). */
  summary: string;
  /**
   * All planning warnings collected during pipeline execution (phases 2–11).
   * Exposed so the CLI can print them to stderr for human readability.
   * The library API consumer may choose to inspect or ignore these.
   * These warnings are also embedded in the promptPlan and trace outputs.
   */
  pipelineWarnings: PlanningWarning[];
  /**
   * Registry validation warnings from Phase 2 (separate from pipeline warnings
   * because the old CLI printed them with a distinct prefix for registry).
   */
  registryValidationWarnings: PlanningWarning[];
}

/**
 * Options for runCorePipeline() — used internally by the CLI.
 */
export interface PipelineOptions {
  /** Pre-loaded analyzer output. When provided, proposals enter the pipeline as advisory. */
  analyzerOutput?: AnalyzerOutput | null;
}

/**
 * Thrown when the library API receives invalid input that cannot be processed.
 * Matches the VALIDATION_ERROR shape from docs/18 §4.5.
 */
export class PlanValidationError extends Error {
  public readonly code = 'VALIDATION_ERROR';
  public readonly details: string[];

  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = 'PlanValidationError';
    this.details = details;
  }
}

// ============================================================================
// Class B Defaults — Canonical values from docs/06 §2 and input-loader.ts
// ============================================================================
// These MUST stay identical to the defaults in src/core/input-loader.ts and
// src/http/body-mapper.ts. Any change to defaults must be synchronized.

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

// ============================================================================
// Input Mapping
// ============================================================================

/**
 * Map a CorePlanInput to LoadedInputs, applying Class B defaults for absent
 * optional fields. Produces the same warnings as the CLI input-loader.ts and
 * the HTTP body-mapper.ts for absent fields.
 *
 * This function does NOT perform AJV schema validation — Phase 2
 * (buildRegistryIndexes) handles detailed registry validation. Basic type
 * checks are performed for Class A required fields.
 */
function mapToLoadedInputs(input: CorePlanInput): LoadedInputs {
  const warnings: PlanningWarning[] = [];

  // Active IDs — absent: silent default (no warning), matching CLI behavior
  const activeIds: ActiveIds = input.activeIds ?? ACTIVE_IDS_DEFAULT;

  // Runtime — absent: emit warning (matching CLI behavior)
  let runtime: RuntimeCapabilities;
  if (input.runtime != null) {
    runtime = input.runtime;
  } else {
    warnings.push({
      code: 'runtime_capabilities_missing',
      message:
        'runtime not provided; treating capabilityInventoryComplete as false. ' +
        'All tool availability unknown; all tool components will be included.',
    });
    runtime = RUNTIME_DEFAULT;
  }

  // History — absent: emit warning (matching CLI behavior)
  let history: HistoryStateSummary;
  if (input.history != null) {
    history = input.history;
  } else {
    warnings.push({
      code: 'history_summary_missing',
      message:
        'history not provided; treating all history components as uncertain ' +
        '(historyMalformed: true). All high-risk/non-optional history components will be included.',
    });
    history = HISTORY_DEFAULT;
  }

  // Budget — absent: emit warning (matching CLI behavior)
  let budget: BudgetState | null;
  if (input.budget !== undefined && input.budget !== null) {
    budget = input.budget;
  } else {
    if (input.budget === undefined) {
      warnings.push({
        code: 'budget_config_missing',
        message:
          'budget not provided; treating budget as unconstrained. ' +
          'Selectors are budget-aware but not budget-enforcing.',
      });
    }
    budget = null;
  }

  // Constraints — absent: silent null (no warning), matching CLI behavior
  const constraints: UserConstraints | null = input.constraints ?? null;

  // Policy — absent: emit warning + apply defaults, matching CLI behavior
  let policy: SelectorPolicy;
  if (input.policy != null) {
    // deterministicOnly coercion: must be true in MVP per docs/06 §2.9
    if (!input.policy.deterministicOnly) {
      warnings.push({
        code: 'selector_policy_defaulted',
        message:
          'policy supplied deterministicOnly: false; model-assisted selectors are not ' +
          'implemented in MVP. Coercing to true.',
      });
      policy = { ...input.policy, deterministicOnly: true };
    } else {
      policy = input.policy;
    }
  } else {
    warnings.push({
      code: 'selector_policy_defaulted',
      message:
        'policy not provided; applying safe defaults ' +
        '(failOpenThreshold: 0.7, deterministicOnly: true, injectionSuspectAction: "warn_and_continue").',
    });
    policy = { ...POLICY_DEFAULT };
  }

  // requestSignals — absent: null (Phase 3 stub will run)
  const requestSignals: RequestSignals | null = input.requestSignals ?? null;

  return {
    requestText: input.request.text,
    registryRaw: input.registry,
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

// ============================================================================
// Core Pipeline (Phases 2–11) — Pure, No I/O
// ============================================================================

/**
 * Run the full ZAM planning pipeline (Phases 2–11) on pre-loaded inputs.
 *
 * This is the internal entry point used by the CLI after loadInputs().
 * It does NOT perform filesystem I/O, does NOT call process.exit(),
 * and does NOT perform output AJV validation (the CLI handles that).
 *
 * Pipeline phases:
 *   2. Registry indexing and cross-field validation
 *   3. Request / runtime / history normalization
 *   4. Candidate set construction
 *   5. Selector fan-out and deterministic ladder
 *   6. Gap-check and synthetic not_evaluated decisions
 *   7. Injection gate / policy normalization
 *   P10. [FUTURE-ONLY] Analyzer output integration
 *   8. Conflict resolution
 *   9. Budgeting
 *   10. Prompt plan generation
 *   11. Trace and summary assembly
 *
 * Errors from pipeline phases (RegistryFatalError, CandidateSetFatalError)
 * propagate naturally — the caller decides how to handle them.
 */
export function runCorePipeline(
  loadedInputs: LoadedInputs,
  options?: PipelineOptions,
): CorePlanOutput {
  const startedAt = new Date().toISOString();
  const runId = randomUUID();

  // ---------------------------------------------------------------------------
  // Phase 2: Registry indexing, cross-field validation, and quarantine
  // ---------------------------------------------------------------------------
  const registryResult = buildRegistryIndexes(loadedInputs.registryRaw);

  // ---------------------------------------------------------------------------
  // Phase 3: Request / runtime / history / active-IDs normalization
  // ---------------------------------------------------------------------------
  const normalizedInputs = normalizeInputs(loadedInputs, registryResult);

  // ---------------------------------------------------------------------------
  // Phase 4: Candidate set construction and candidateSetSummary
  // ---------------------------------------------------------------------------
  const candidateSetResult = buildCandidateSet(registryResult);

  // ---------------------------------------------------------------------------
  // Phase 5: Selector fan-out and deterministic ladder
  // ---------------------------------------------------------------------------
  const fanOutResult = runSelectorFanOut(candidateSetResult, normalizedInputs, registryResult);

  // ---------------------------------------------------------------------------
  // Phase 6: Gap-check and synthetic not_evaluated decisions
  // ---------------------------------------------------------------------------
  const gapCheckResult = runGapCheck(fanOutResult, candidateSetResult);

  // Recompute selectorSummary over merged decision set
  const allDecisions = [...fanOutResult.decisions, ...gapCheckResult.syntheticDecisions];
  computeSelectorSummary(
    allDecisions,
    fanOutResult.referencedUnknownComponents.length,
  );

  // ---------------------------------------------------------------------------
  // Phase 7: Injection gate / policy normalization
  // ---------------------------------------------------------------------------
  const allTraceEntries = [
    ...fanOutResult.selectorTrace,
    ...gapCheckResult.syntheticTraceEntries,
  ];
  const gateResult = runInjectionGate(
    allDecisions,
    allTraceEntries,
    normalizedInputs,
    candidateSetResult.candidatesById,
  );

  // Recompute post-gate summary
  const postGateSummary = computeSelectorSummary(
    gateResult.decisions,
    fanOutResult.referencedUnknownComponents.length,
  );

  const postGateDecisions = gateResult.decisions;
  const postGateTraceEntries = gateResult.traceEntries;

  // ---------------------------------------------------------------------------
  // Phase P10 (future-only): Analyzer output integration
  // ---------------------------------------------------------------------------
  const analyzerOutput = options?.analyzerOutput ?? null;
  let allPostGateDecisions = postGateDecisions;
  let allPostGateTraceEntries = postGateTraceEntries;
  let analyzerPhaseForTrace: ReturnType<typeof integrateAnalyzerOutput>['analyzerPhase'] | undefined;

  if (analyzerOutput !== null) {
    const analyzerResult = integrateAnalyzerOutput(
      analyzerOutput,
      candidateSetResult.candidatesById,
    );

    allPostGateDecisions = [...postGateDecisions, ...analyzerResult.decisions];
    allPostGateTraceEntries = [...postGateTraceEntries, ...analyzerResult.traceEntries];
    analyzerPhaseForTrace = analyzerResult.analyzerPhase;
  }

  // ---------------------------------------------------------------------------
  // Phase 8: Conflict resolution
  // ---------------------------------------------------------------------------
  const conflictResult = runConflictResolver(
    allPostGateDecisions,
    allPostGateTraceEntries,
    normalizedInputs,
    candidateSetResult.candidatesById,
  );

  const postConflictDecisions = conflictResult.resolvedDecisions;

  // ---------------------------------------------------------------------------
  // Phase 9: Budgeter
  // ---------------------------------------------------------------------------
  const budgetReport = runBudgeter(
    postConflictDecisions,
    normalizedInputs.budget,
    candidateSetResult.candidatesById,
  );

  // ---------------------------------------------------------------------------
  // Phase 10: Prompt Plan Generator
  // ---------------------------------------------------------------------------
  // Phase 2+ warnings only — excludes Phase 1 (loadedInputs.warnings) which
  // the CLI prints separately. Used for the pipelineWarnings return field.
  const phase2PlusWarnings: PlanningWarning[] = [
    ...normalizedInputs.warnings,
    ...candidateSetResult.warnings,
    ...fanOutResult.warnings,
    ...gapCheckResult.warnings,
    ...gateResult.warnings,
    ...conflictResult.globalWarnings,
    ...conflictResult.unresolvedConflictWarnings.map(w => ({
      code: w.warningCode,
      message: `unresolved conflict for ${w.componentId}`,
    })),
  ];

  // Full accumulated warnings (Phase 1 + Phase 2-11) — used by the prompt
  // plan generator and trace assembler. These are the canonical warning set
  // embedded in prompt-plan.json and trace.json.
  const accumulatedWarnings: PlanningWarning[] = [
    ...loadedInputs.warnings,
    ...phase2PlusWarnings,
  ];

  const promptPlan = runPromptPlanGenerator(
    postConflictDecisions,
    budgetReport,
    normalizedInputs,
    candidateSetResult.candidatesById,
    accumulatedWarnings,
  );

  // ---------------------------------------------------------------------------
  // Phase 11: Trace and Summary Assembly
  // ---------------------------------------------------------------------------
  const completedAt = new Date().toISOString();

  const traceOutput = runTraceAssembler({
    runId,
    planningRunStartedAt: startedAt,
    planningRunCompletedAt: completedAt,
    schemaVersion: 'v0',
    normalizedInputs,
    registryResult,
    candidateSetResult,
    fanOutResult,
    gapCheckResult,
    gateResult,
    conflictResult,
    budgetReport,
    promptPlan,
    postGateSummary,
    accumulatedWarnings,
    analyzerPhase: analyzerPhaseForTrace,
    summaryPhase: undefined,
  });

  const summaryOutput = runSummaryAssembler({
    promptFamily: normalizedInputs.requestSignals.promptFamily,
    selectorSummary: postGateSummary,
    budgetReport,
    riskFlags: promptPlan.riskFlags,
    failOpenReasons: promptPlan.failOpenReasons,
    planningWarningsCount: accumulatedWarnings.length,
  });

  return {
    promptPlan,
    trace: traceOutput,
    summary: summaryOutput,
    pipelineWarnings: phase2PlusWarnings,
    registryValidationWarnings: registryResult.validationWarnings,
  };
}

// ============================================================================
// Public Library API — docs/18 §7
// ============================================================================

/**
 * Run a full ZAM context planning pass from in-memory inputs.
 *
 * This is the public library API entry point matching docs/18 §7:
 *
 *   const { plan } = require('context-plane');
 *   const result = await plan({
 *     request: { text: "..." },
 *     registry: [...],
 *   });
 *   // result.promptPlan  → prompt-plan.json structure
 *   // result.trace       → trace.json structure
 *   // result.summary     → summary.md string
 *
 * Validates required inputs, applies Class B defaults for optional fields,
 * then runs the full pipeline (phases 2–11).
 *
 * Throws PlanValidationError for invalid inputs.
 * Throws RegistryFatalError / CandidateSetFatalError for pipeline errors.
 *
 * @param input - The planning request (docs/18 §4.2 shape)
 * @returns The planning outputs (promptPlan, trace, summary)
 */
export function plan(input: CorePlanInput): CorePlanOutput {
  // Validate Class A required fields
  if (!input.request || typeof input.request.text !== 'string') {
    throw new PlanValidationError(
      "Request field 'request.text' is required and must be a string.",
      ['request.text is missing or not a string'],
    );
  }
  if (!Array.isArray(input.registry)) {
    throw new PlanValidationError(
      "Request field 'registry' is required and must be an array.",
      ['registry is missing or not an array'],
    );
  }

  // Map input to LoadedInputs with Class B defaults
  const loadedInputs = mapToLoadedInputs(input);

  // Run the core pipeline
  return runCorePipeline(loadedInputs, {
    analyzerOutput: input.analyzerOutput ?? null,
  });
}
