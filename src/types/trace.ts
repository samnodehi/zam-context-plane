/**
 * Phase 11: Trace assembly boundary/runtime types.
 *
 * In-memory contract for trace.json before AJV validation and serialization.
 * Not duplicating the JSON schema — types give plan.ts a stable TS contract.
 *
 * Key invariants (docs/04 §7.8; schemas/outputs/trace.schema.json):
 *   - 8 required top-level keys: run, requestPhase, registryPhase,
 *     selectorPhase, conflictPhase, budgetPhase, planPhase, warnings.
 *   - [FUTURE-ONLY] extension keys (reentryPhase, analyzerPhase, etc.) may be
 *     conditionally included when their trigger conditions are met. These are
 *     optional properties defined in trace.schema.json but NOT in the required array.
 *   - NO injectionGatePhase — injection gate data lives in selectorPhase.selectorTrace.
 *   - selectorTrace is TraceEntry[] (NOT SelectionDecision[]).
 *   - noConflictComponentIds is a separate string[] on conflictPhase (NOT inside conflictSummary).
 *   - budgetOverflow is required boolean on budgetPhase — never silent.
 *   - No raw component text, no raw history content, no provider/cache/model fields.
 *
 * Phase 12+ additions must NOT be made here until those phases are approved.
 *
 * Canonical: docs/04 §7.8; docs/06 §3.2; docs/11 §4.2.
 */

import type { PlanningWarning } from './warnings.js';
import type { TraceEntry, SelectorSummary, SelectorFanOutResult } from './selection.js';
import type { ResolvedSelectionDecision, ConflictResolutionTraceEntry, ConflictResolverResult } from './conflict.js';
import type { BudgetReport, TrimActionEntry } from './budget.js';
import type { NormalizedInputs } from './normalized.js';
import type { RegistryResult } from './registry.js';
import type { CandidateSetResult } from './candidate.js';
import type { InjectionGateResult } from '../core/injection-gate.js';
import type { GapCheckResult } from '../core/gap-check.js';
import type { PromptPlanOutput, PartitionEntry } from './plan.js';

// ---------------------------------------------------------------------------
// ReentryEvent
// ---------------------------------------------------------------------------

/**
 * [FUTURE-ONLY] A single re-entry event in reentryPhase[].
 *
 * Matches schemas/outputs/trace.schema.json reentryPhase items shape exactly:
 *   - trigger: string (event that initiated re-entry)
 *   - updatedLanes: string[] (lanes that received new content)
 *   - reentryTraceId: string (unique ID for this re-entry event)
 *   - priorPlanId: string (runId of the prior planning run)
 *
 * Canonical: docs/20 §7; docs/16 §6.3; schemas/outputs/trace.schema.json.
 */
export interface ReentryEvent {
  /** Event that initiated this re-entry (e.g., "external_reentry", "tool_result:get_weather"). */
  trigger: string;
  /** Lanes that received new or changed content as a result of this re-entry. */
  updatedLanes: string[];
  /** Unique ID for this re-entry event trace entry. */
  reentryTraceId: string;
  /** runId of the prior planning run that this re-entry updates. */
  priorPlanId: string;
}

// ---------------------------------------------------------------------------
// SummaryPhase (for trace.json summaryPhase)
// ---------------------------------------------------------------------------

/**
 * An included state category entry in summaryPhase.included[].
 *
 * Matches trace.schema.json summaryPhase.included items shape exactly:
 *   { category, description, sourceReference } — all required, additionalProperties: false.
 *
 * Canonical: docs/16 §6.2; schemas/outputs/trace.schema.json.
 */
export interface SummaryPhaseIncludedItem {
  /** State category name. */
  category: string;
  /** Description of the retained state. */
  description: string;
  /** Source reference (e.g., turn number, compressor category). */
  sourceReference: string;
}

/**
 * An omitted or uncertain state category entry in summaryPhase.omitted[] or
 * summaryPhase.uncertain[].
 *
 * Matches trace.schema.json summaryPhase.omitted and summaryPhase.uncertain
 * items shape exactly:
 *   { category, reason } — both required, additionalProperties: false.
 *
 * Canonical: docs/16 §6.2; schemas/outputs/trace.schema.json.
 */
export interface SummaryPhaseOmittedItem {
  /** State category name. */
  category: string;
  /** Reason for omission or uncertainty. */
  reason: string;
}

/**
 * [FUTURE-ONLY] The summaryPhase object in trace.json.
 *
 * Captures history compressor decisions (included/omitted/uncertain).
 * Present only when a history compressor is integrated.
 *
 * Matches schemas/outputs/trace.schema.json summaryPhase shape exactly:
 *   - compressorVersion: string
 *   - included: SummaryPhaseIncludedItem[]
 *   - omitted: SummaryPhaseOmittedItem[]
 *   - uncertain: SummaryPhaseOmittedItem[]
 *   - protectedCategories: string[]
 *   - summaryTraceId: string
 *
 * Canonical: docs/16 §6.2; docs/13 §10; schemas/outputs/trace.schema.json.
 */
export interface SummaryPhase {
  /** Identifier of the compressor version. */
  compressorVersion: string;
  /** State categories unconditionally retained. No raw turn content. */
  included: SummaryPhaseIncludedItem[];
  /** State categories omitted by the compressor. Protected categories must never appear here. */
  omitted: SummaryPhaseOmittedItem[];
  /** State categories with uncertain retention status. */
  uncertain: SummaryPhaseOmittedItem[];
  /** Categories unconditionally retained regardless of compressor decision. Must not appear in omitted[]. */
  protectedCategories: string[];
  /** Unique ID for this summary phase trace entry. */
  summaryTraceId: string;
}

// ---------------------------------------------------------------------------
// AnalyzerPhase (for trace.json analyzerPhase)
// ---------------------------------------------------------------------------

/**
 * [FUTURE-ONLY] The analyzerPhase object in trace.json.
 *
 * Captures the structured trace of request analyzer output.
 * Present only when a model-assisted analyzer is integrated.
 *
 * Matches schemas/outputs/trace.schema.json analyzerPhase shape exactly:
 *   - analyzerVersion: string
 *   - tier: integer (0–3)
 *   - promptFamily: string (PromptFamilyValue)
 *   - analyzerConfidence: number (0.0–1.0)
 *   - proposedLanes: string[]
 *   - failOpenTriggered: boolean
 *   - failOpenReason: string | null
 *   - evidence: string[]
 *   - analyzerTraceId: string
 *
 * All 9 fields are required. additionalProperties: false.
 *
 * Canonical: docs/16 §6.1; docs/13 §8; schemas/outputs/trace.schema.json.
 */
export interface AnalyzerPhase {
  /** Identifier of the analyzer model/version. */
  analyzerVersion: string;
  /** Routing tier applied. 0 = fast path; 3 = fail-open. */
  tier: number;
  /** Prompt family proposal from PromptFamilyValue enum. */
  promptFamily: string;
  /** Float confidence score (0.0–1.0). DISTINCT from SelectionDecision.confidence string enum. */
  analyzerConfidence: number;
  /** Advisory lane proposals. */
  proposedLanes: string[];
  /** true when analyzerConfidence is below threshold or risk is high/critical. */
  failOpenTriggered: boolean;
  /** Reason for fail-open, or null. */
  failOpenReason: string | null;
  /** Signals used to reach the classification. */
  evidence: string[];
  /** Unique ID linking this phase to analyzer-output.schema.json analyzerTraceId. */
  analyzerTraceId: string;
}

// ---------------------------------------------------------------------------
// TraceOutput
// ---------------------------------------------------------------------------

/**
 * In-memory shape of trace.json before AJV validation and serialization.
 *
 * Matches schemas/outputs/trace.schema.json:
 *   - 8 required top-level keys
 *   - [FUTURE-ONLY] extension keys (reentryPhase, etc.) conditionally included
 *   - No injectionGatePhase
 *   - selectorTrace is TraceEntry[] (not SelectionDecision[])
 *
 * Canonical: docs/04 §7.8; docs/11 §4.2.
 */
export interface TraceOutput {
  /**
   * Top-level run metadata. Non-deterministic fields (runId, timestamps).
   * Determinism tests must normalize or exclude these fields before comparison.
   */
  run: {
    runId: string;
    planningRunStartedAt: string;
    planningRunCompletedAt: string;
    promptFamily: string;
    schemaVersion: string;
  };

  /**
   * Request Router phase trace. No raw user text.
   * Policy-fallback optional fields present only when policyFallbackReasons is non-empty.
   */
  requestPhase: {
    requestSignalsSummary: {
      promptFamily: string;
      familyConfidence: number;
      injectionSuspect: boolean;
    };
    /** Mirror of requestSignalsSummary.injectionSuspect. */
    injectionSuspectFlag: boolean;
    /** Mirror of requestSignalsSummary.promptFamily. */
    promptFamily: string;
    /** Mirror of requestSignalsSummary.familyConfidence. */
    familyConfidence: number;
    /** Optional — present only when a policy fallback/escalation occurred. */
    requestedInjectionSuspectAction?: string;
    /** Optional — closed enum: 'warn_and_continue' | 'fail_open_all'. */
    effectiveInjectionSuspectAction?: 'warn_and_continue' | 'fail_open_all';
    /** Optional — present only when policyFallbackReasons is non-empty. */
    policyFallbackReasons?: string[];
  };

  /**
   * Component Registry phase trace. fatalErrors is [] on successful run.
   * validationWarnings items must be { code, componentId, message } only —
   * RegistryValidationWarning.field must be stripped before placement here.
   */
  registryPhase: {
    componentCount: number;
    quarantinedCount: number;
    validationWarnings: PlanningWarning[];
    fatalErrors: string[];
    candidateSetSummary: {
      candidateSetPolicy: 'all_non_quarantined';
      candidateSetSize: number;
      quarantinedExcluded: number;
    };
  };

  /**
   * Selector fan-out phase trace.
   * selectorTrace = gateResult.traceEntries directly (full post-gate annotated list).
   * planningWarnings = fanOutResult.warnings + gapCheckResult.warnings + gateResult.warnings.
   * No injectionGatePhase key — gate data lives here.
   */
  selectorPhase: {
    selectorTrace: TraceEntry[];
    planningWarnings: PlanningWarning[];
    unresolvedConflicts: string[];
    selectorSummary: SelectorSummary;
  };

  /**
   * Conflict Resolver phase trace.
   * noConflictComponentIds is a separate string[] — NOT inside conflictSummary.
   * Accounting invariant: noConflictComponentIds.length + conflictResolutionTrace.length
   * must equal registryPhase.candidateSetSummary.candidateSetSize.
   */
  conflictPhase: {
    resolvedDecisions: ResolvedSelectionDecision[];
    conflictResolutionTrace: ConflictResolutionTraceEntry[];
    /** Separate string[] — NOT inside conflictSummary. */
    noConflictComponentIds: string[];
    /** conflictResult.globalWarnings only — not unresolvedConflictWarnings. */
    planningWarnings: PlanningWarning[];
  };

  /**
   * Budgeter phase trace.
   * budgetOverflow is required boolean — never silent.
   * trimActions is [] when no trimming occurred (unconstrained).
   *
   * NOTE: budgetReport is typed as unknown because the assembler produces a
   * budget-report.schema.json-compatible shape (with trimOrder, totalPromptTokenTarget)
   * that differs from the TS BudgetReport type (which has trimActions, budgetTarget).
   * AJV validates the schema-compliant shape at the trace validation boundary.
   */
  budgetPhase: {
    /** Schema-compliant budget-report object (NOT raw TS BudgetReport). AJV-validated. */
    budgetReport: unknown;
    trimActions: TrimActionEntry[];
    /** Mirror of budgetReport.budgetOverflow. */
    budgetOverflow: boolean;
  };

  /**
   * Prompt Plan Generator phase trace.
   * Mirrors prompt-plan.json partition arrays exactly.
   * No raw component text, no raw history content.
   */
  planPhase: {
    selectedComponents: PartitionEntry[];
    omittedComponents: PartitionEntry[];
    deferredComponents: PartitionEntry[];
    riskFlags: string[];
    failOpenReasons: string[];
  };

  /**
   * Global per-run planning warnings from all phases.
   * = accumulatedWarnings from plan.ts (includes gateResult.warnings).
   * Must be [] (empty array), never absent.
   */
  warnings: PlanningWarning[];

  /**
   * [FUTURE-ONLY] Ordered array of re-entry events in this planning run.
   * Conditionally present when requestSignals.reentryTurn === true.
   * Each entry captures one re-entry trigger and updated lane state.
   * Canonical: docs/20 §7; docs/16 §6.3; schemas/outputs/trace.schema.json.
   */
  reentryPhase?: ReentryEvent[];

  /**
   * [FUTURE-ONLY] Request analyzer trace — tier, confidence, proposed lanes.
   * Conditionally present when a model-assisted AnalyzerOutput is integrated.
   * Canonical: docs/16 §6.1; docs/13 §8; schemas/outputs/trace.schema.json.
   */
  analyzerPhase?: AnalyzerPhase;

  /**
   * [FUTURE-ONLY] History compressor trace — included, omitted, uncertain categories.
   * Conditionally present when a HistoryCompressorOutput is integrated.
   * Canonical: docs/16 §6.2; docs/13 §10; schemas/outputs/trace.schema.json.
   */
  summaryPhase?: SummaryPhase;
}

// ---------------------------------------------------------------------------
// TraceAssemblerInputs
// ---------------------------------------------------------------------------

/**
 * All data required by runTraceAssembler() from plan.ts.
 *
 * Passed from plan.ts after all phases (0–10) complete successfully.
 * All fields are read-only by the assembler.
 *
 * Canonical: docs/11 §6 Phase 11.
 */
export interface TraceAssemblerInputs {
  /** Generated by plan.ts via randomUUID() at start of action handler. */
  runId: string;
  /** ISO 8601 — captured at the start of the action handler (before Phase 1). */
  planningRunStartedAt: string;
  /**
   * ISO 8601 — captured after prompt-plan.json is written, before trace assembly.
   * Determinism tests must normalize or exclude this field.
   */
  planningRunCompletedAt: string;
  /** Always 'v0' in MVP. */
  schemaVersion: string;

  // Phase 3 output
  normalizedInputs: NormalizedInputs;

  // Phase 2 output
  registryResult: RegistryResult;

  // Phase 4 output
  candidateSetResult: CandidateSetResult;

  // Phase 5 output
  fanOutResult: SelectorFanOutResult;

  // Phase 6 output
  /**
   * Only gapCheckResult.warnings is used by the assembler.
   * gapCheckResult.syntheticTraceEntries were already folded into allTraceEntries
   * before being passed to the gate, so gateResult.traceEntries is the complete list.
   */
  gapCheckResult: Pick<GapCheckResult, 'warnings'>;

  // Phase 7 output
  gateResult: InjectionGateResult;

  // Phase 8 output
  conflictResult: ConflictResolverResult;

  // Phase 9 output
  budgetReport: BudgetReport;

  // Phase 10 output
  promptPlan: PromptPlanOutput;

  /**
   * Post-gate selector summary (recomputed in plan.ts after Phase 7).
   * Reflects gate conversions (omit → include/fail_open) in decidedOmit/decidedInclude/failOpenInclude.
   * Used as selectorPhase.selectorSummary.
   */
  postGateSummary: SelectorSummary;

  /**
   * All accumulated planning warnings from plan.ts (stable insertion order).
   * Includes: result.warnings, normalizedInputs.warnings, candidateSetResult.warnings,
   * fanOutResult.warnings, gapCheckResult.warnings, gateResult.warnings,
   * conflictResult.globalWarnings, converted unresolvedConflictWarnings.
   * Used as trace.json top-level warnings[].
   */
  accumulatedWarnings: PlanningWarning[];

  // [FUTURE-ONLY] Phase extension inputs — conditionally passed from plan.ts.

  /**
   * [FUTURE-ONLY] Assembled AnalyzerPhase trace from analyzer integrator.
   * Undefined when --analyzer-output is absent.
   * Canonical: docs/16 §6.1; docs/13 §8.
   */
  analyzerPhase?: AnalyzerPhase;

  /**
   * [FUTURE-ONLY] Assembled SummaryPhase trace from compressor integrator.
   * Undefined when --compressor-output is absent.
   * Canonical: docs/16 §6.2; docs/13 §10.
   */
  summaryPhase?: SummaryPhase;
}

// ---------------------------------------------------------------------------
// SummaryAssemblerInputs
// ---------------------------------------------------------------------------

/**
 * All data required by runSummaryAssembler() from plan.ts.
 *
 * Canonical: docs/11 §4.2.
 */
export interface SummaryAssemblerInputs {
  promptFamily: string;
  selectorSummary: SelectorSummary;
  budgetReport: BudgetReport;
  riskFlags: string[];
  failOpenReasons: string[];
  planningWarningsCount: number;
}
