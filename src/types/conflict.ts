/**
 * Phase 8: Conflict resolver boundary/runtime types.
 *
 * These types are the post-conflict-resolution in-memory contracts.
 * JSON Schema + AJV remains the authoritative validation boundary for outputs.
 * Types here give downstream phases (Phase 9+) a stable TS contract.
 *
 * Phase 8 scope:
 *   - ResolutionRule: 14-value canonical enum.
 *   - BudgetHint: 5-value canonical enum (§27 survival skeleton).
 *   - MergeRuleTrace: 4-value enum for §27 merge path tracking.
 *   - LosingDecision: per-conflict loser record.
 *   - ResolvedSelectionDecision: one per candidate component.
 *   - ConflictResolutionTraceEntry: one per actual conflict.
 *   - ConflictSummary: aggregate counts.
 *   - UnresolvedConflictWarning: per unresolvable conflict.
 *   - ConflictResolverResult: aggregate output of runConflictResolver().
 *
 * No `confidence` field on ResolvedSelectionDecision or ConflictResolutionTraceEntry.
 * Confidence belongs to SelectionDecision only. Provenance is preserved via
 * inputDecisionIds and traceRefs.
 *
 * Canonical owners:
 *   - ResolvedSelectionDecision: docs/06 §11.3.1, §11.6, §27;
 *     schemas/internal/resolved-selection-decision.schema.json
 *   - ConflictResolutionTraceEntry: docs/06 §11.3.2, §11.6;
 *     schemas/internal/conflict-resolution-trace.schema.json
 *   - ResolutionRule: docs/06 §11.3.1a; schemas/shared/enums.shared.schema.json
 *   - BudgetHint: docs/06 §20, §27; schemas/shared/enums.shared.schema.json
 *
 * Phase 9+ additions must NOT be made here until those phases are approved.
 */

import type { SelectionDecision } from './selection.js';
import type { PlanningWarning } from './warnings.js';

// ---------------------------------------------------------------------------
// ResolutionRule
// ---------------------------------------------------------------------------

/**
 * 14-value canonical enum for conflict resolution results.
 *
 * Matches schemas/shared/enums.shared.schema.json#ResolutionRule exactly.
 * Any value outside this set is a harness failure.
 * Future additions require an explicit cross-spec decision pass.
 *
 * Known spec gaps (as of Phase 8):
 *   - No canonical value for "defer beats omit" (Case 3) → uses fail_open_unresolved.
 *   - No canonical value for "include beats ordinary defer" at P5 for
 *     default_include / fail_open / not_evaluated / conflict_include paths → uses fail_open_unresolved.
 *   - No canonical value for "include beats omit" at P5 for those same paths → uses fail_open_unresolved.
 *   - No canonical value for single conflict_include decision → uses fail_open_unresolved.
 *
 * Canonical: docs/06 §11.3.1a.
 */
export type ResolutionRule =
  | 'no_conflict'
  | 'runtime_unavailable_defer'
  | 'safety_hard_protection'
  | 'user_constraint_include'
  | 'registry_require_include'
  | 'history_durability_include'
  | 'path_a_omit_uncontested'
  | 'path_b_omit_uncontested'
  | 'path_a_omit_selected_over_path_b'
  | 'multiple_include_merged'
  | 'fail_open_unresolved'
  | 'quarantine_boundary_violation_pass_through'
  | 'reference_unknown_pass_through'
  | 'history_malformed_fail_open';

// ---------------------------------------------------------------------------
// BudgetHint
// ---------------------------------------------------------------------------

/**
 * 5-value canonical enum for budget hint survival (§27 skeleton).
 *
 * Matches schemas/shared/enums.shared.schema.json#BudgetHint exactly.
 * Phase 8 implements the §27 survival skeleton: if any input SelectionDecision
 * carries a budgetHint, it must survive into ResolvedSelectionDecision.
 * Phase 8 does NOT assign new budgetHint values — that is Phase 9 scope.
 *
 * Canonical: docs/06 §20, §27.
 */
export type BudgetHint =
  | 'protected'
  | 'over_budget_protected'
  | 'candidate_optional'
  | 'expensive_optional'
  | 'unknown_cost';

// ---------------------------------------------------------------------------
// MergeRuleTrace
// ---------------------------------------------------------------------------

/**
 * Which §27 budget-hint merge rule was applied during conflict resolution.
 * Present on all resolved decisions where budget-hint merge logic ran.
 *
 * Canonical: docs/06 §27.4, §27.7.
 */
export type MergeRuleTrace =
  | 'budget_hint_kept_from_winning_decision'
  | 'budget_hint_promoted_from_losing_decision'
  | 'no_hint'
  | 'runtime_unavailable_skip';

// ---------------------------------------------------------------------------
// LosingDecision
// ---------------------------------------------------------------------------

/**
 * A losing SelectionDecision in a conflict resolution entry.
 * The winning decision does NOT appear here.
 *
 * Canonical: docs/06 §11.3.1, §11.6.
 */
export interface LosingDecision {
  /** ID of the losing SelectionDecision record. */
  decisionId: string;
  /** The action from the losing decision. */
  action: SelectionDecision['action'];
  /** The path from the losing decision. */
  path: SelectionDecision['path'];
  /** Coded reason this decision was defeated. No raw content. */
  defeatedBy: string;
}

// ---------------------------------------------------------------------------
// ResolvedSelectionDecision
// ---------------------------------------------------------------------------

/**
 * One resolved decision per candidate component after conflict resolution.
 *
 * Required fields (9) match resolved-selection-decision.schema.json exactly.
 * No `confidence` field — confidence belongs to SelectionDecision only.
 * Optional §27 budget-hint survival fields are present only when applicable.
 *
 * Canonical: docs/06 §11.3.1, §11.6, §27.
 */
export interface ResolvedSelectionDecision {
  // --- 9 required fields (match schema required array) ---
  /** The validated registry component ID this resolved decision applies to. */
  componentId: string;
  /** The resolved action value after conflict resolution. */
  finalAction: SelectionDecision['action'];
  /** The resolved path value after conflict resolution. */
  finalPath: SelectionDecision['path'];
  /** Always 'conflict_resolver' for ResolvedSelectionDecision records. */
  resolvedBy: 'conflict_resolver';
  /** IDs of all SelectionDecision records that were inputs to this resolution. */
  inputDecisionIds: string[];
  /** The canonical priority rule that produced the winning decision. */
  resolutionRule: ResolutionRule;
  /**
   * Array of losing decisions. Empty when no decision was a true loser
   * (e.g., no_conflict, multiple_include_merged, or single conflict_include).
   */
  losingDecisions: LosingDecision[];
  /** Warning codes emitted during this conflict resolution. Empty array if none. */
  warningsEmitted: string[];
  /** Monotonic step counter at resolution time. Not wall-clock time. */
  resolvedAt: number;

  // --- Optional gate-conversion fields (docs/06 §11.6) ---
  /** true if one or more input decisions had actionChanged: true (injection gate converted). */
  hadGateConvertedDecisions?: boolean;
  /** TraceEntry IDs for each gate-converted input decision. */
  gateConvertedTraceRefs?: string[];
  /** originalCandidateAction values from gate-converted inputs (same order as refs). */
  preGateActions?: SelectionDecision['action'][];
  /** originalCandidatePath values from gate-converted inputs (same order as refs). */
  preGatePaths?: SelectionDecision['path'][];

  // --- Optional §27 budget-hint survival fields ---
  // Present only when budgetHint is set (Phase 9 will add hints to SelectionDecision).
  // Phase 8 produces no_hint for all decisions since Phase 5/7 do not assign hints.
  budgetHint?: BudgetHint;
  budgetReason?: string;
  tokensApproxObserved?: number | null;
  budgetPriorityObserved?: number | null;
  budgetCriticalObserved?: boolean;
  budgetWarningCodes?: string[];
  tokenSource?: 'tokensApprox' | 'charsApprox_estimate' | 'absent';
  thresholdUsed?: number;
  estimatedTokensFromChars?: number;
  charsApproxObserved?: number | null;
  thresholdCrossed?: string;
  applicableBudgetLimit?: number;
  riskFlag?: 'budget_infeasible_protected_component';
  budgetHintSourceDecisionId?: string;
  /** Always present; encodes which §27 merge path ran. Canonical: docs/06 §27.4. */
  mergeRuleTrace?: MergeRuleTrace;
}

// ---------------------------------------------------------------------------
// ConflictResolutionTraceEntry
// ---------------------------------------------------------------------------

/**
 * Full trace entry for an actual conflict.
 *
 * Must NOT be produced for no-conflict components (those go in noConflictComponentIds).
 * Required fields (8) match conflict-resolution-trace.schema.json exactly.
 * resolutionRule must NOT be 'no_conflict' — the schema enforces this via `not`.
 * No `confidence` field — confidence belongs to SelectionDecision only.
 *
 * Canonical: docs/06 §11.3.2, §11.6.
 */
export interface ConflictResolutionTraceEntry {
  // --- 8 required fields (match schema required array) ---
  componentId: string;
  inputDecisionIds: string[];
  finalAction: SelectionDecision['action'];
  finalPath: SelectionDecision['path'];
  /**
   * Must not be 'no_conflict' — enforced by conflict-resolution-trace.schema.json
   * via a `not: { const: 'no_conflict' }` constraint.
   */
  resolutionRule: Exclude<ResolutionRule, 'no_conflict'>;
  losingDecisions: LosingDecision[];
  warningsEmitted: string[];
  resolvedAt: number;

  // --- Optional gate-conversion fields ---
  hadGateConvertedDecisions?: boolean;
  gateConvertedTraceRefs?: string[];
  preGateActions?: SelectionDecision['action'][];
  preGatePaths?: SelectionDecision['path'][];
}

// ---------------------------------------------------------------------------
// ConflictSummary
// ---------------------------------------------------------------------------

/**
 * Aggregate counts for the conflict resolution phase.
 *
 * Accounting identity (must hold):
 *   totalComponents = noConflict + resolvedConflicts + failOpenResolutions
 *   totalComponents = candidatesById.size
 *   noConflict = noConflictComponentIds.length
 *   resolvedConflicts + failOpenResolutions = conflictResolutionTrace.length
 *
 * reference_unknown and out-of-candidatesById quarantine records are excluded.
 */
export interface ConflictSummary {
  /** = noConflict + resolvedConflicts + failOpenResolutions. */
  totalComponents: number;
  /** = noConflictComponentIds.length. */
  noConflict: number;
  /** conflictResolutionTrace entries where resolutionRule ≠ 'fail_open_unresolved'. */
  resolvedConflicts: number;
  /** conflictResolutionTrace entries where resolutionRule = 'fail_open_unresolved'. */
  failOpenResolutions: number;
  unresolvedConflictWarnings: number;
  /** Freeform narrative string. Harness must not parse. */
  narrative: string;
}

// ---------------------------------------------------------------------------
// UnresolvedConflictWarning
// ---------------------------------------------------------------------------

/**
 * Emitted when a conflict group falls through all priority and case logic
 * without a canonical resolution.
 * Also emitted for Phase 8 spec-gap cases (Case 3, Case 2A non-priority paths,
 * single conflict_include, Case 1 non-priority includes).
 */
export interface UnresolvedConflictWarning {
  componentId: string;
  inputDecisionIds: string[];
  /** Human-readable conflict description. No raw content. */
  conflictDescription: string;
  warningCode: 'unresolved_conflict_fail_open';
}

// ---------------------------------------------------------------------------
// ConflictResolverResult
// ---------------------------------------------------------------------------

/**
 * Aggregate output of runConflictResolver().
 *
 * Canonical: docs/11 §6 Phase 8.
 */
export interface ConflictResolverResult {
  /**
   * One ResolvedSelectionDecision per candidate component, plus pass-through
   * records for reference_unknown and quarantine_boundary_violation IDs.
   */
  resolvedDecisions: ResolvedSelectionDecision[];
  /**
   * One ConflictResolutionTraceEntry per actual conflict only.
   * No-conflict components appear in noConflictComponentIds, not here.
   */
  conflictResolutionTrace: ConflictResolutionTraceEntry[];
  /**
   * Component IDs that had a single unambiguous decision (not conflict_include,
   * not reference_unknown, not quarantine_boundary_violation).
   */
  noConflictComponentIds: string[];
  conflictSummary: ConflictSummary;
  unresolvedConflictWarnings: UnresolvedConflictWarning[];
  /**
   * Orchestrator-level per-run warnings, e.g. history_malformed_conflict_occurred.
   * Deduplicated — each code appears at most once per runConflictResolver() call.
   * Phase 11 will embed in trace.json.
   */
  globalWarnings: PlanningWarning[];
}
