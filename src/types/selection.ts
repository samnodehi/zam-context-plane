/**
 * Phase 5: Selector fan-out and deterministic ladder boundary/runtime types.
 *
 * These types are the post-fan-out in-memory contracts — not duplicates of the
 * JSON Schemas. JSON Schema + AJV is the authoritative validation boundary for
 * outputs. Types here give downstream phases (Phase 6+) a stable TS contract.
 *
 * Phase 5 scope:
 *   - SelectionDecision: one record per candidate component per selector.
 *   - TraceEntry: companion trace object; distinct from SelectionDecision.
 *   - SelectorSummary: aggregate counts + deterministic narrative string.
 *   - UnknownComponentRef: reference_unknown record.
 *   - SelectorFanOutResult: aggregate output of runSelectorFanOut().
 *
 * Canonical owners:
 *   - SelectionDecision: docs/06 §4; schemas/internal/selection-decision.schema.json
 *   - TraceEntry: schemas/internal/trace-entry.schema.json
 *   - SelectorSummary: docs/06 §3.6; schemas/internal/selector-summary.schema.json
 *   - SelectorFanOutResult: docs/11 §6 Phase 5
 *
 * Phase 6+ additions must NOT be made here until those phases are approved.
 */

import type { PlanningWarning } from './warnings.js';

// ---------------------------------------------------------------------------
// SelectionDecision
// ---------------------------------------------------------------------------

/**
 * One SelectionDecision record per candidate component per selector run.
 *
 * 10 required core fields — matches schemas/internal/selection-decision.schema.json.
 * Budget annotation fields (budgetHint, budgetReason, etc.) are Phase 9 scope
 * and are NOT present here.
 *
 * Canonical: docs/06 §4.
 */
export interface SelectionDecision {
  /**
   * The registry ID of the component this decision applies to.
   * For action: reference_unknown, this is the caller-supplied unknown string
   * (not a validated registry ID — intentional dual-use in MVP per 5-Q4).
   */
  componentId: string;

  /**
   * Identifier of the selector that produced this decision.
   * One of the 8 canonical selectorName constants.
   */
  selectorName: string;

  /**
   * What the selector recommends doing with this component.
   * Canonical enum: include | omit | defer | reference_unknown.
   * action: quarantine is NOT valid (F-17). action: unavailable is future-only (5-Q7).
   */
  action: 'include' | 'omit' | 'defer' | 'reference_unknown';

  /**
   * Human-readable explanation of why this action was chosen.
   * Must not contain raw component content, raw history turns, or raw user text.
   */
  reason: string;

  /**
   * The decision path taken by the selector logic.
   * Canonical enum (12 values in MVP): see docs/06 §4.
   */
  path:
    | 'required_match'
    | 'safe_to_omit_match'
    | 'default_action_omit'
    | 'default_include'
    | 'default_defer'
    | 'fail_open'
    | 'conflict_include'
    | 'safety_override'
    | 'runtime_unavailable'
    | 'not_evaluated'
    | 'reference_unknown'
    | 'quarantine_boundary_violation';

  /**
   * How confident the selector is in this decision.
   * Canonical: high | medium | low.
   * A low-confidence omit is invalid in MVP.
   */
  confidence: 'high' | 'medium' | 'low';

  /**
   * Signal atoms that supported this decision.
   * Must be non-empty for action: omit.
   * Must not contain raw component/history/user text.
   */
  evidence: string[];

  /**
   * Which active constraints (user, safety, policy) influenced this decision.
   * Empty array when none apply.
   */
  constraintsApplied: string[];

  /**
   * Non-fatal per-decision issues.
   * Phase 5 canonical per-decision codes: path_a_null_evidence, unexpected_ladder_fallback.
   * Empty array when none.
   */
  warnings: string[];

  /**
   * References to TraceEntry.decisionId values that document this decision.
   * Bi-directional link: SelectionDecision.traceRefs ↔ TraceEntry.decisionId.
   */
  traceRefs: string[];
}

// ---------------------------------------------------------------------------
// TraceEntry
// ---------------------------------------------------------------------------

/**
 * A single trace event embedded in selectorPhase.selectorTrace[].
 *
 * CRITICAL: TraceEntry is NOT a SelectionDecision. These are two distinct
 * companion types with a bi-directional reference:
 *   TraceEntry.decisionId ← referenced by → SelectionDecision.traceRefs[]
 *
 * Required fields match schemas/internal/trace-entry.schema.json exactly.
 * Optional injection gate fields (injectionSuspect, injectionSuspectAction,
 * actionChanged, originalCandidateAction, originalCandidatePath, warningsEmitted)
 * were deferred to Phase 7 scope and are added here in Phase 7.
 *
 * Canonical: docs/04 §7.8; docs/06 §3.2; docs/06 §17.6.
 */
export interface TraceEntry {
  /** UUID linking this entry to its SelectionDecision (via traceRefs[]). */
  decisionId: string;
  /** Registry ID of the component evaluated. Must not contain raw content. */
  componentId: string;
  /**
   * Selector module name (e.g. 'ScaffoldSelector').
   * Derived from selectorName with PascalCase formatting.
   */
  module: string;
  /** Must match the corresponding SelectionDecision.action. */
  action: 'include' | 'omit' | 'defer' | 'reference_unknown';
  /** Human-readable explanation. No raw content. */
  reason: string;
  /** Signal atoms. No raw content. */
  evidence: string[];
  /** Selector confidence for this event. */
  confidence: 'high' | 'medium' | 'low';
  /** Component riskLevel at decision time (from registry metadata). */
  risk: string;
  /**
   * Token savings estimate.
   * tokens: 0 for include and defer decisions.
   * Must be 0 for runtime_unavailable defer (not counted as savings).
   */
  estimatedSavings: { tokens: number };
  /**
   * true if this event was a fail-open outcome
   * (action: include, path: fail_open or quarantine_boundary_violation).
   */
  failOpen: boolean;
  /** Always 'deterministic' in MVP. Model-assisted selectors are future-only. */
  selector: 'deterministic';

  // ---------------------------------------------------------------------------
  // Optional injection gate fields — Phase 7 (docs/06 §17.6)
  // Present only when injectionSuspect: true at decision time.
  // ---------------------------------------------------------------------------

  /**
   * true when requestSignals.injectionSuspect was true at decision time.
   * Only ever set to true — never set to false (omit the field when not applicable).
   * Canonical: docs/06 §17.6.
   */
  injectionSuspect?: true;
  /**
   * The effective applied injection policy for this run ('warn_and_continue' or
   * 'fail_open_all'). Present only when injectionSuspect: true.
   * Always the final effective policy — not the requested policy if a fallback occurred.
   * Canonical: docs/06 §17.6.
   */
  injectionSuspectAction?: 'warn_and_continue' | 'fail_open_all';
  /**
   * true if the injection gate overrode the candidate action (e.g., omit → include/fail_open).
   * false if the candidate action passed through unchanged.
   * Present only when injectionSuspect: true.
   * When true, originalCandidateAction and originalCandidatePath are required.
   * Canonical: docs/06 §17.4, §17.6; F-20 resolved.
   */
  actionChanged?: boolean;
  /**
   * The action the deterministic ladder produced before the gate overrode it (e.g., 'omit').
   * Required when actionChanged: true.
   * Canonical source of pre-gate context for the Conflict Resolver.
   * Canonical: docs/06 §17.6; F-20 resolved.
   */
  originalCandidateAction?: 'include' | 'omit' | 'defer' | 'reference_unknown';
  /**
   * The path the ladder produced before the gate overrode it (e.g., 'safe_to_omit_match').
   * Required when actionChanged: true.
   * Canonical: docs/06 §17.6; F-20 resolved.
   */
  originalCandidatePath?: SelectionDecision['path'];
  /**
   * Per-decision injection warning codes for this trace entry.
   * Examples: 'injection_suspect_omit_allowed', 'injection_suspect_policy_override'.
   * Must NOT contain global per-run codes (injection_suspect_warn_and_continue,
   * injection_suspect_fail_open_all) — those are orchestrator-level globals only.
   * Canonical: docs/06 §17.6.
   */
  warningsEmitted?: string[];
}

// ---------------------------------------------------------------------------
// SelectorSummary
// ---------------------------------------------------------------------------

/**
 * Aggregate counts and deterministic narrative for the selector fan-out phase.
 *
 * Required fields match schemas/internal/selector-summary.schema.json exactly.
 *
 * Narrative is generated from the fixed deterministic template (docs/06 §3.6):
 * "{totalEvaluated} components evaluated. {decidedInclude} included,
 *  {decidedOmit} omitted, {decidedDefer} deferred ({defaultDefer} default,
 *  {runtimeUnavailableDefer} runtime-unavailable), {failOpenInclude} fail-open.
 *  {conflictsIdentified} conflict(s) identified."
 *
 * unknownReferences is a required count field but does NOT appear in the narrative.
 *
 * Canonical: docs/06 §3.6; schemas/internal/selector-summary.schema.json.
 */
export interface SelectorSummary {
  /** Total candidate set size (= candidateSetSummary.candidateSetSize). */
  totalEvaluated: number;
  /** Count of action: include decisions (any path). */
  decidedInclude: number;
  /** Count of action: omit decisions (Path A or Path B only). */
  decidedOmit: number;
  /** Total count of action: defer decisions (defaultDefer + runtimeUnavailableDefer). */
  decidedDefer: number;
  /** Count of defer via path: default_defer. */
  defaultDefer: number;
  /** Count of defer via path: runtime_unavailable. */
  runtimeUnavailableDefer: number;
  /** Count of action: include via path: fail_open (or quarantine_boundary_violation). */
  failOpenInclude: number;
  /** Count of conflict_include path decisions. */
  conflictsIdentified: number;
  /** Count of action: reference_unknown decisions. */
  unknownReferences: number;
  /** Deterministic template-based narrative string. */
  narrative: string;
}

// ---------------------------------------------------------------------------
// UnknownComponentRef
// ---------------------------------------------------------------------------

/**
 * A component ID referenced during selector evaluation that was not found in
 * componentsById. Never silently ignored.
 *
 * Canonical: docs/06 §3.5; docs/06 §8 Step 2.
 */
export interface UnknownComponentRef {
  /** The caller-supplied unknown string (not a validated registry ID). */
  componentId: string;
  /** Which input referenced it (e.g. 'userConstraints.alwaysInclude'). */
  referencedBy: string;
  /** TraceEntry.decisionId of the reference_unknown trace entry. */
  traceRef: string;
}

// ---------------------------------------------------------------------------
// SelectorFanOutResult
// ---------------------------------------------------------------------------

/**
 * The aggregate output of runSelectorFanOut().
 *
 * Contains all SelectionDecision records, the accompanying selectorTrace,
 * aggregate summary counts/narrative, and all planning warnings emitted
 * during fan-out.
 *
 * Phase 6 (gap-check) consumes decisions[] to verify every candidate received
 * at least one decision. Phase 6 is NOT performed here.
 *
 * Canonical: docs/11 §6 Phase 5; docs/06 §3.
 */
export interface SelectorFanOutResult {
  /**
   * All SelectionDecision records from all selectors.
   * One record per candidate component (primary selector only in MVP).
   * Plus one record per reference_unknown reference.
   */
  decisions: SelectionDecision[];

  /**
   * One TraceEntry per decision event.
   * Embedded in trace.json selectorPhase.selectorTrace[] by Phase 11.
   * Length equals decisions.length (one-to-one).
   */
  selectorTrace: TraceEntry[];

  /**
   * Aggregate counts and deterministic narrative for the selector phase.
   * Embedded in trace.json selectorPhase.selectorSummary by Phase 11.
   */
  selectorSummary: SelectorSummary;

  /**
   * All component IDs referenced but not found in componentsById.
   * Produced by alwaysInclude checks in MVP Phase 5.
   * Embedded in trace.json selectorPhase (future) by Phase 11.
   */
  referencedUnknownComponents: UnknownComponentRef[];

  /**
   * Planning warnings emitted during fan-out.
   * Printed to stderr by plan.ts. Embedded in trace.json selectorPhase
   * planningWarnings[] by Phase 11.
   */
  warnings: PlanningWarning[];
}
