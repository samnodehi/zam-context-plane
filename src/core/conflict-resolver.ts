/**
 * Phase 8: Conflict resolver.
 *
 * Consumes post-gate SelectionDecision[] and companion TraceEntry[] and produces
 * one ResolvedSelectionDecision per candidate component, a conflict trace for
 * actual conflicts only, and aggregate summary counts.
 *
 * Known spec gaps (fail_open_unresolved as temporary behavior):
 *   - Case 3 (omit vs ordinary defer): no canonical ResolutionRule.
 *   - Case 2A P5 (include vs ordinary defer, non-priority paths): no canonical rule.
 *   - Case 1 P5 (include vs omit, non-priority paths): no canonical rule.
 *   - Single conflict_include: no canonical rule.
 *
 * Internal diagnostics (stderr-only — NOT in globalWarnings[], NOT in trace.json):
 *   - neverInclude_only_unenforced: neverInclude constraint not enforceable in MVP.
 *   - quarantine_boundary_accounting_error: quarantine ID not in candidatesById.
 *
 * Canonical: docs/06 §11, §27; docs/11 §6 Phase 8.
 */

import type { SelectionDecision, TraceEntry } from '../types/selection.js';
import type { NormalizedInputs } from '../types/normalized.js';
import type { Component } from '../types/registry.js';
import type { PlanningWarning } from '../types/warnings.js';
import type {
  ResolutionRule,
  BudgetHint,
  MergeRuleTrace,
  LosingDecision,
  ResolvedSelectionDecision,
  ConflictResolutionTraceEntry,
  ConflictSummary,
  UnresolvedConflictWarning,
  ConflictResolverResult,
} from '../types/conflict.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Decision extended with optional budgetHint for §27 skeleton. */
type DecisionWithHint = SelectionDecision & { budgetHint?: BudgetHint };

/**
 * Build a LosingDecision record from a SelectionDecision.
 */
function makeLosing(d: SelectionDecision, defeatedBy: string): LosingDecision {
  return {
    decisionId: d.traceRefs[0] ?? `${d.componentId}:${d.selectorName}`,
    action: d.action,
    path: d.path,
    defeatedBy,
  };
}

/**
 * Determine the highest-priority include path from a set of include decisions.
 * Priority: safety_override > required_match > conflict_include > fail_open
 *          > not_evaluated > default_include
 */
function highestIncludePath(decisions: SelectionDecision[]): SelectionDecision['path'] {
  const order: SelectionDecision['path'][] = [
    'safety_override',
    'required_match',
    'conflict_include',
    'fail_open',
    'not_evaluated',
    'default_include',
  ];
  for (const p of order) {
    if (decisions.some(d => d.path === p)) return p;
  }
  return decisions[0].path;
}

/**
 * Check whether a component triggers Priority 1 (safety hard protection).
 * Checked against both registry metadata and input decisions' evidence.
 */
function isP1(comp: Component | undefined): boolean {
  if (!comp) return false;
  return (
    comp.retainPolicy === 'safety_critical' ||
    comp.omissionPolicy === 'never' ||
    comp.riskLevel === 'critical'
  );
}

/**
 * Check whether a component triggers Priority 0 (confirmed tool unavailability).
 */
function isToolUnavailable(comp: Component | undefined, runtime: NormalizedInputs['runtime']): boolean {
  if (!comp || comp.type !== 'tool') return false;
  if (runtime.unavailableToolIds.includes(comp.id)) return true;
  if (runtime.capabilityInventoryComplete && !runtime.availableToolIds.includes(comp.id)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// §27 budget-hint survival skeleton
// ---------------------------------------------------------------------------

/**
 * §27.5 canonical priority order for BudgetHint values.
 * Lower index = higher priority.
 * Canonical: docs/06 §20, §27.5.
 */
const BUDGET_HINT_PRIORITY: Record<BudgetHint, number> = {
  protected: 0,             // highest — safety/always include
  over_budget_protected: 1, // protected but over budget
  unknown_cost: 2,          // cost unknown, treat as elevated
  expensive_optional: 3,    // optional, higher cost
  candidate_optional: 4,    // lowest — optional, routine cost
};

/**
 * Apply §27 budget-hint merge logic to a resolved decision.
 *
 * Implements §27.5 priority order: finds the highest-priority hint across ALL
 * input decisions (winner and losers). If the highest-priority hint originates
 * from the winning decision, emits 'budget_hint_kept_from_winning_decision'.
 * If it originates from a losing decision, emits
 * 'budget_hint_promoted_from_losing_decision'.
 *
 * Phase 8: Phase 5/7 do not assign budgetHint, so inputs will always produce
 * mergeRuleTrace: 'no_hint' today. The skeleton is implemented so that any
 * future synthetic or Phase-9-injected hints survive correctly.
 *
 * Does NOT assign new budgetHint values. Does NOT implement Budgeter logic.
 */
function applyBudgetHintSurvival(
  resolved: ResolvedSelectionDecision,
  inputDecisions: SelectionDecision[],
  winningDecision: SelectionDecision,
): ResolvedSelectionDecision {
  // runtime_unavailable defer: skip merge entirely.
  if (resolved.finalAction === 'defer' && resolved.finalPath === 'runtime_unavailable') {
    return { ...resolved, mergeRuleTrace: 'runtime_unavailable_skip' };
  }

  // Collect hints from all inputs.
  const typed = inputDecisions as DecisionWithHint[];
  const withHints = typed.filter(d => d.budgetHint !== undefined);

  if (withHints.length === 0) {
    return { ...resolved, mergeRuleTrace: 'no_hint' };
  }

  // §27.5 priority order: find the decision whose budgetHint has the lowest
  // priority index (= highest priority) across ALL input decisions.
  const bestSource = withHints.reduce((best, d) => {
    const bestPriority = BUDGET_HINT_PRIORITY[best.budgetHint!];
    const dPriority = BUDGET_HINT_PRIORITY[d.budgetHint!];
    return dPriority < bestPriority ? d : best;
  });

  const bestHint = bestSource.budgetHint!;

  // Determine whether the best-hint decision is the winner.
  const bestIsWinner =
    bestSource.traceRefs[0] === winningDecision.traceRefs[0] &&
    bestSource.componentId === winningDecision.componentId &&
    bestSource.selectorName === winningDecision.selectorName;

  if (bestIsWinner) {
    return {
      ...resolved,
      mergeRuleTrace: 'budget_hint_kept_from_winning_decision',
      budgetHint: bestHint,
    };
  }

  // Best hint comes from a losing decision — promote it.
  return {
    ...resolved,
    mergeRuleTrace: 'budget_hint_promoted_from_losing_decision',
    budgetHint: bestHint,
    budgetHintSourceDecisionId:
      bestSource.traceRefs[0] ??
      `${bestSource.componentId}:${bestSource.selectorName}`,
  };
}

// ---------------------------------------------------------------------------
// Gate-conversion metadata
// ---------------------------------------------------------------------------

/**
 * Populate optional gate-conversion fields on a ConflictResolutionTraceEntry
 * from the companion TraceEntry map.
 */
function applyGateConversionMeta(
  entry: ConflictResolutionTraceEntry,
  inputDecisions: SelectionDecision[],
  traceByDecisionId: Map<string, TraceEntry>,
): ConflictResolutionTraceEntry {
  const converted: TraceEntry[] = [];
  for (const d of inputDecisions) {
    const ref = d.traceRefs[0];
    if (!ref) continue;
    const te = traceByDecisionId.get(ref);
    if (te && te.actionChanged === true) {
      converted.push(te);
    }
  }
  if (converted.length === 0) return entry;

  // Collect valid preGatePaths — only from originalCandidatePath; never fall back
  // to action (which is not a valid path value).
  const preGatePaths = converted
    .map(te => te.originalCandidatePath)
    .filter((p): p is SelectionDecision['path'] => p !== undefined);

  return {
    ...entry,
    hadGateConvertedDecisions: true,
    gateConvertedTraceRefs: converted.map(te => te.decisionId),
    preGateActions: converted.map(te => te.originalCandidateAction ?? te.action),
    ...(preGatePaths.length > 0 ? { preGatePaths } : {}),
  };
}

// ---------------------------------------------------------------------------
// Main resolver
// ---------------------------------------------------------------------------

/**
 * Resolve conflicts in the post-gate SelectionDecision set.
 *
 * Algorithm steps:
 *   1. Setup (group decisions, build helper maps).
 *   2. reference_unknown pass-through (before all other logic).
 *   3. quarantine_boundary_violation pass-through.
 *   4. Ordinary neverInclude-only diagnostic (before classification).
 *   5. No-conflict / actual-conflict classification.
 *   6. Priority resolution (P0–P4, then P5 cases) for actual conflicts.
 *   7. Gate-conversion metadata on conflict trace entries.
 *   8. §27 budget-hint survival skeleton on all resolved decisions.
 *   9. conflictSummary assembly.
 */
export function runConflictResolver(
  postGateDecisions: SelectionDecision[],
  postGateTraceEntries: TraceEntry[],
  normalizedInputs: NormalizedInputs,
  candidatesById: Map<string, Component>,
): ConflictResolverResult {

  // -------------------------------------------------------------------------
  // Step 1 — Setup
  // -------------------------------------------------------------------------
  const groupMap = new Map<string, SelectionDecision[]>();
  for (const d of postGateDecisions) {
    const existing = groupMap.get(d.componentId);
    if (existing) {
      existing.push(d);
    } else {
      groupMap.set(d.componentId, [d]);
    }
  }

  const traceByDecisionId = new Map<string, TraceEntry>();
  for (const te of postGateTraceEntries) {
    traceByDecisionId.set(te.decisionId, te);
  }

  const alwaysIncludeIds = new Set<string>(normalizedInputs.constraints?.alwaysInclude ?? []);
  const neverIncludeIds = new Set<string>(normalizedInputs.constraints?.neverInclude ?? []);

  let resolvedAtCounter = 0;
  let historyMalformedGlobalWarningEmitted = false;

  const resolvedDecisions: ResolvedSelectionDecision[] = [];
  const conflictResolutionTrace: ConflictResolutionTraceEntry[] = [];
  const noConflictComponentIds: string[] = [];
  const unresolvedConflictWarnings: UnresolvedConflictWarning[] = [];
  const globalWarnings: PlanningWarning[] = [];

  // -------------------------------------------------------------------------
  // Step 2 — reference_unknown pass-through
  // -------------------------------------------------------------------------
  const remainingGroups = new Map<string, SelectionDecision[]>();

  for (const [componentId, decisions] of groupMap) {
    if (decisions.every(d => d.action === 'reference_unknown')) {
      const winner = decisions[0];
      const resolved: ResolvedSelectionDecision = {
        componentId,
        finalAction: 'reference_unknown',
        finalPath: 'reference_unknown',
        resolvedBy: 'conflict_resolver',
        inputDecisionIds: decisions.map(d => d.traceRefs[0] ?? `${d.componentId}:${d.selectorName}`),
        resolutionRule: 'reference_unknown_pass_through',
        losingDecisions: [],
        warningsEmitted: [],
        resolvedAt: resolvedAtCounter++,
        mergeRuleTrace: 'no_hint',
      };
      resolvedDecisions.push(applyBudgetHintSurvival(resolved, decisions, winner));
      // Not in candidate accounting.
      continue;
    }
    remainingGroups.set(componentId, decisions);
  }

  // -------------------------------------------------------------------------
  // Step 3 — quarantine_boundary_violation pass-through
  // -------------------------------------------------------------------------
  const afterQuarantine = new Map<string, SelectionDecision[]>();

  for (const [componentId, decisions] of remainingGroups) {
    const hasQBV = decisions.some(d => d.path === 'quarantine_boundary_violation');
    if (!hasQBV) {
      afterQuarantine.set(componentId, decisions);
      continue;
    }

    const winner = decisions.find(d => d.path === 'quarantine_boundary_violation') ?? decisions[0];
    const resolved: ResolvedSelectionDecision = {
      componentId,
      finalAction: 'include',
      finalPath: 'quarantine_boundary_violation',
      resolvedBy: 'conflict_resolver',
      inputDecisionIds: decisions.map(d => d.traceRefs[0] ?? `${d.componentId}:${d.selectorName}`),
      resolutionRule: 'quarantine_boundary_violation_pass_through',
      losingDecisions: [],
      warningsEmitted: [],
      resolvedAt: resolvedAtCounter++,
    };
    const withMerge = applyBudgetHintSurvival(resolved, decisions, winner);

    if (!candidatesById.has(componentId)) {
      // Accounting error: this ID should not have reached the resolver.
      // Emit stderr-only diagnostic — NOT in globalWarnings, NOT in trace.json.
      process.stderr.write(
        `context-plane: [internal diagnostic] quarantine_boundary_accounting_error: ` +
        `componentId '${componentId}' has quarantine_boundary_violation but is not in candidatesById. ` +
        `Excluded from candidate accounting.\n`,
      );
      resolvedDecisions.push(withMerge);
      // Not counted in accounting.
      continue;
    }

    // In candidatesById — counts in accounting.
    resolvedDecisions.push(withMerge);
    const traceEntry: ConflictResolutionTraceEntry = {
      componentId,
      inputDecisionIds: withMerge.inputDecisionIds,
      finalAction: 'include',
      finalPath: 'quarantine_boundary_violation',
      resolutionRule: 'quarantine_boundary_violation_pass_through',
      losingDecisions: [],
      warningsEmitted: [],
      resolvedAt: withMerge.resolvedAt,
    };
    conflictResolutionTrace.push(applyGateConversionMeta(traceEntry, decisions, traceByDecisionId));
  }

  // -------------------------------------------------------------------------
  // Step 4 — Ordinary neverInclude-only diagnostic (before classification)
  //
  // Runs for ALL remaining groups (single and multi-decision).
  // The neverInclude constraint is NOT enforced in this scenario.
  // This is a known MVP limitation — a future cross-spec pass must add a
  // canonical ResolutionRule if enforcement is required.
  // -------------------------------------------------------------------------
  for (const [componentId, decisions] of afterQuarantine) {
    const comp = candidatesById.get(componentId);
    const inNever = neverIncludeIds.has(componentId);
    const inAlways = alwaysIncludeIds.has(componentId);
    const p1Applies = isP1(comp);

    if (inNever && !inAlways && !p1Applies) {
      // Emit internal stderr-only diagnostic.
      // NOT in globalWarnings[], NOT serialized to trace.json.
      process.stderr.write(
        `context-plane: [internal diagnostic] neverInclude_only_unenforced: ` +
        `componentId '${componentId}' is in neverInclude but no canonical resolutionRule ` +
        `exists for enforcement without Case 6/7. Constraint not enforced (MVP spec gap).\n`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Step 5 — No-conflict / actual-conflict classification
  // -------------------------------------------------------------------------
  const actualConflictGroups = new Map<string, SelectionDecision[]>();

  for (const [componentId, decisions] of afterQuarantine) {
    const isActualConflict =
      decisions.length > 1 ||
      (decisions.length === 1 && decisions[0].path === 'conflict_include');

    if (!isActualConflict) {
      // No-conflict fast path.
      noConflictComponentIds.push(componentId);
      const single = decisions[0];
      const resolved: ResolvedSelectionDecision = {
        componentId,
        finalAction: single.action,
        finalPath: single.path,
        resolvedBy: 'conflict_resolver',
        inputDecisionIds: [single.traceRefs[0] ?? `${single.componentId}:${single.selectorName}`],
        resolutionRule: 'no_conflict',
        losingDecisions: [],
        warningsEmitted: [],
        resolvedAt: resolvedAtCounter++,
      };
      resolvedDecisions.push(applyBudgetHintSurvival(resolved, decisions, single));
      continue;
    }

    actualConflictGroups.set(componentId, decisions);
  }

  // -------------------------------------------------------------------------
  // Step 6 — Conflict resolution (actual-conflict groups only)
  // -------------------------------------------------------------------------
  for (const [componentId, decisions] of actualConflictGroups) {
    const comp = candidatesById.get(componentId);
    const decisionIds = decisions.map(d => d.traceRefs[0] ?? `${d.componentId}:${d.selectorName}`);

    let finalAction: SelectionDecision['action'] = 'include';
    let finalPath: SelectionDecision['path'] = 'fail_open';
    let rule: Exclude<ResolutionRule, 'no_conflict'> = 'fail_open_unresolved';
    let losingDecisions: LosingDecision[] = [];
    let warningsEmitted: string[] = [];
    let winnerDecision: SelectionDecision = decisions[0];

    // Helper to collect all history-malformed-related warnings.
    function checkHistoryMalformedWarning(): boolean {
      return decisions.some(d => {
        const ref = d.traceRefs[0];
        if (!ref) return false;
        const te = traceByDecisionId.get(ref);
        return te?.warningsEmitted?.includes('history_malformed_fail_open') ?? false;
      });
    }

    // ----- Priority 0: Runtime unavailability (type: tool) -----
    if (isToolUnavailable(comp, normalizedInputs.runtime)) {
      finalAction = 'defer';
      finalPath = 'runtime_unavailable';
      rule = 'runtime_unavailable_defer';
      winnerDecision = decisions.find(d => d.path === 'runtime_unavailable') ?? decisions[0];
      losingDecisions = decisions
        .filter(d => d !== winnerDecision)
        .map(d => makeLosing(d, 'runtime_unavailable_defer'));
      if (isP1(comp)) warningsEmitted.push('hard_protected_tool_unavailable');
      if (alwaysIncludeIds.has(componentId)) warningsEmitted.push('always_include_unavailable_tool');
    }

    // ----- Priority 1: Safety hard protection -----
    else if (isP1(comp)) {
      finalAction = 'include';
      finalPath = 'safety_override';
      rule = 'safety_hard_protection';
      winnerDecision = decisions.find(d => d.path === 'safety_override') ?? decisions[0];
      const losers = decisions.filter(d => d !== winnerDecision);
      losingDecisions = losers.map(d => makeLosing(d, 'safety_hard_protection'));
      if (losers.some(d => d.action === 'omit')) warningsEmitted.push('safety_override_omit_decision');
      if (neverIncludeIds.has(componentId)) warningsEmitted.push('safety_override_never_include');
      if (checkHistoryMalformedWarning()) warningsEmitted.push('history_malformed_conflict');
    }

    // ----- Priority 2: alwaysInclude user constraint -----
    else if (alwaysIncludeIds.has(componentId)) {
      finalAction = 'include';
      finalPath = 'required_match';
      rule = 'user_constraint_include';
      winnerDecision = decisions.find(d => d.path === 'required_match') ?? decisions[0];
      losingDecisions = decisions
        .filter(d => d !== winnerDecision)
        .map(d => makeLosing(d, 'user_constraint_include'));
      if (neverIncludeIds.has(componentId)) warningsEmitted.push('always_include_overrides_never_include');
    }

    // ----- Priority 3: Registry hard requirement -----
    else if (
      comp &&
      (comp.retainPolicy === 'mandatory' ||
        comp.requiredWhen.includes(normalizedInputs.requestSignals.promptFamily))
    ) {
      finalAction = 'include';
      finalPath = 'required_match';
      rule = 'registry_require_include';
      winnerDecision = decisions.find(d => d.path === 'required_match') ?? decisions[0];
      losingDecisions = decisions
        .filter(d => d !== winnerDecision)
        .map(d => makeLosing(d, 'registry_require_include'));
    }

    // ----- Priority 4: History durability -----
    else if (
      comp &&
      comp.type === 'history' &&
      comp.retainPolicy === 'durable' &&
      (normalizedInputs.history.durableConstraintsPresent ||
        normalizedInputs.history.openCommitmentsPresent)
    ) {
      finalAction = 'include';
      finalPath = 'required_match';
      rule = 'history_durability_include';
      winnerDecision = decisions.find(d => d.path === 'required_match') ?? decisions[0];
      losingDecisions = decisions
        .filter(d => d !== winnerDecision)
        .map(d => makeLosing(d, 'history_durability_include'));
    }

    // ----- Priority 5: Deterministic selector evidence -----
    else {
      const includeDecisions = decisions.filter(d => d.action === 'include');
      const omitDecisions = decisions.filter(d => d.action === 'omit');
      const deferDecisions = decisions.filter(d => d.action === 'defer');
      const ordinaryDeferDecisions = deferDecisions.filter(d => d.path === 'default_defer');

      // -- Single conflict_include (spec gap — before Case 5) --
      if (decisions.length === 1 && decisions[0].path === 'conflict_include') {
        finalAction = 'include';
        finalPath = 'fail_open';
        rule = 'fail_open_unresolved';
        losingDecisions = [];
        winnerDecision = decisions[0];
        unresolvedConflictWarnings.push({
          componentId,
          inputDecisionIds: decisionIds,
          conflictDescription: `Single conflict_include decision — no canonical resolutionRule (Phase 8 spec gap).`,
          warningCode: 'unresolved_conflict_fail_open',
        });
      }

      // -- Case 12: History-malformed fail-open (before general Case 1) --
      else if (
        includeDecisions.some(d => d.path === 'fail_open') &&
        omitDecisions.length > 0 &&
        (() => {
          const failOpenInclude = includeDecisions.find(d => d.path === 'fail_open');
          if (!failOpenInclude) return false;
          const ref = failOpenInclude.traceRefs[0];
          if (!ref) return false;
          const te = traceByDecisionId.get(ref);
          return te?.warningsEmitted?.includes('history_malformed_fail_open') ?? false;
        })()
      ) {
        const winnerD = includeDecisions.find(d => d.path === 'fail_open')!;
        finalAction = 'include';
        finalPath = 'fail_open';
        rule = 'history_malformed_fail_open';
        winnerDecision = winnerD;
        losingDecisions = omitDecisions.map(d => makeLosing(d, 'history_malformed_fail_open'));
        warningsEmitted.push('history_malformed_conflict');
        if (!historyMalformedGlobalWarningEmitted) {
          historyMalformedGlobalWarningEmitted = true;
          globalWarnings.push({
            code: 'history_malformed_conflict_occurred',
            message: 'One or more conflict resolutions involved history-malformed fail-open decisions. Review history state.',
          });
        }
      }

      // -- Case 1: Include vs Omit (general) --
      else if (includeDecisions.length > 0 && omitDecisions.length > 0 && ordinaryDeferDecisions.length === 0) {
        // Determine the winning include.
        const winnerD = includeDecisions.reduce((best, d) => {
          const priority = ['safety_override', 'required_match', 'conflict_include', 'fail_open', 'not_evaluated', 'default_include'];
          return priority.indexOf(d.path) < priority.indexOf(best.path) ? d : best;
        }, includeDecisions[0]);
        finalAction = 'include';
        finalPath = winnerD.path;
        winnerDecision = winnerD;
        losingDecisions = omitDecisions.map(d => makeLosing(d, 'fail_open_unresolved'));

        // Case 1 P5 spec gap: non-priority include paths have no canonical resolutionRule.
        const nonPriorityPaths: SelectionDecision['path'][] = ['default_include', 'fail_open', 'not_evaluated', 'conflict_include'];
        if (nonPriorityPaths.includes(winnerD.path)) {
          rule = 'fail_open_unresolved';
          finalPath = 'fail_open'; // normalize to fail_open for unresolved
          if (winnerD.path === 'not_evaluated' && omitDecisions.some(d => d.path === 'safe_to_omit_match')) {
            warningsEmitted.push('include_vs_omit_with_not_evaluated');
          }
          unresolvedConflictWarnings.push({
            componentId,
            inputDecisionIds: decisionIds,
            conflictDescription: `Include (${winnerD.path}) vs omit — no canonical resolutionRule at P5 (Phase 8 spec gap).`,
            warningCode: 'unresolved_conflict_fail_open',
          });
        } else {
          // Should have been caught by P1–P4; use fail_open_unresolved as safety net.
          rule = 'fail_open_unresolved';
          finalPath = 'fail_open';
          unresolvedConflictWarnings.push({
            componentId,
            inputDecisionIds: decisionIds,
            conflictDescription: `Include vs omit — unexpected path '${winnerD.path}' at P5 (safety fallback).`,
            warningCode: 'unresolved_conflict_fail_open',
          });
        }
      }

      // -- Case 2A: Include vs Ordinary Defer (P5 spec gap) --
      else if (includeDecisions.length > 0 && ordinaryDeferDecisions.length > 0 && omitDecisions.length === 0) {
        const winnerD = includeDecisions.reduce((best, d) => {
          const priority = ['safety_override', 'required_match', 'conflict_include', 'fail_open', 'not_evaluated', 'default_include'];
          return priority.indexOf(d.path) < priority.indexOf(best.path) ? d : best;
        }, includeDecisions[0]);
        finalAction = 'include';
        finalPath = 'fail_open'; // normalized for spec-gap unresolved
        rule = 'fail_open_unresolved';
        winnerDecision = winnerD;
        losingDecisions = ordinaryDeferDecisions.map(d => makeLosing(d, 'include_overrides_defer'));
        warningsEmitted.push('include_overrides_defer');
        unresolvedConflictWarnings.push({
          componentId,
          inputDecisionIds: decisionIds,
          conflictDescription: `Include (${winnerD.path}) vs ordinary defer — no canonical resolutionRule at P5 (Phase 8 spec gap).`,
          warningCode: 'unresolved_conflict_fail_open',
        });
      }

      // -- Case 3: Omit vs Ordinary Defer (spec gap) --
      else if (omitDecisions.length > 0 && ordinaryDeferDecisions.length > 0 && includeDecisions.length === 0) {
        finalAction = 'include';
        finalPath = 'fail_open';
        rule = 'fail_open_unresolved';
        winnerDecision = decisions[0];
        losingDecisions = decisions.map(d => makeLosing(d, 'defer_overrides_omit_spec_gap'));
        warningsEmitted.push('defer_overrides_omit');
        unresolvedConflictWarnings.push({
          componentId,
          inputDecisionIds: decisionIds,
          conflictDescription: `Omit vs ordinary defer — no canonical resolutionRule (Phase 8 spec gap; doc says defer wins but enum lacks defer_overrides_omit).`,
          warningCode: 'unresolved_conflict_fail_open',
        });
      }

      // -- Case 4: Omit vs Omit --
      else if (omitDecisions.length === decisions.length && decisions.length >= 1) {
        const pathADecisions = omitDecisions.filter(d => d.path === 'safe_to_omit_match');
        const pathBDecisions = omitDecisions.filter(d => d.path === 'default_action_omit');

        if (pathADecisions.length > 0 && pathBDecisions.length === 0) {
          rule = 'path_a_omit_uncontested';
          finalAction = 'omit';
          finalPath = 'safe_to_omit_match';
          winnerDecision = pathADecisions[0];
          losingDecisions = [];
        } else if (pathBDecisions.length > 0 && pathADecisions.length === 0) {
          rule = 'path_b_omit_uncontested';
          finalAction = 'omit';
          finalPath = 'default_action_omit';
          winnerDecision = pathBDecisions[0];
          losingDecisions = [];
        } else {
          rule = 'path_a_omit_selected_over_path_b';
          finalAction = 'omit';
          finalPath = 'safe_to_omit_match';
          winnerDecision = pathADecisions[0];
          losingDecisions = pathBDecisions.map(d => makeLosing(d, 'path_a_omit_selected_over_path_b'));
        }
      }

      // -- Case 5: Multiple Includes (two or more) --
      else if (includeDecisions.length === decisions.length && decisions.length >= 2) {
        finalAction = 'include';
        finalPath = highestIncludePath(includeDecisions);
        rule = 'multiple_include_merged';
        winnerDecision = includeDecisions.find(d => d.path === finalPath) ?? includeDecisions[0];
        losingDecisions = []; // no true losers when all include
      }

      // -- Unresolvable --
      else {
        finalAction = 'include';
        finalPath = 'fail_open';
        rule = 'fail_open_unresolved';
        winnerDecision = decisions[0];
        unresolvedConflictWarnings.push({
          componentId,
          inputDecisionIds: decisionIds,
          conflictDescription: `No priority rule matched for this conflict group.`,
          warningCode: 'unresolved_conflict_fail_open',
        });
      }
    }

    // Build ResolvedSelectionDecision.
    const resolved: ResolvedSelectionDecision = {
      componentId,
      finalAction,
      finalPath,
      resolvedBy: 'conflict_resolver',
      inputDecisionIds: decisionIds,
      resolutionRule: rule,
      losingDecisions,
      warningsEmitted,
      resolvedAt: resolvedAtCounter++,
    };
    resolvedDecisions.push(applyBudgetHintSurvival(resolved, decisions, winnerDecision));

    // Build ConflictResolutionTraceEntry (actual conflicts only).
    const traceEntry: ConflictResolutionTraceEntry = {
      componentId,
      inputDecisionIds: decisionIds,
      finalAction,
      finalPath,
      resolutionRule: rule,
      losingDecisions,
      warningsEmitted,
      resolvedAt: resolved.resolvedAt,
    };
    conflictResolutionTrace.push(applyGateConversionMeta(traceEntry, decisions, traceByDecisionId));
  }

  // -------------------------------------------------------------------------
  // Step 9 — conflictSummary and accounting
  // -------------------------------------------------------------------------
  const noConflict = noConflictComponentIds.length;
  const resolvedConflicts = conflictResolutionTrace.filter(
    e => e.resolutionRule !== 'fail_open_unresolved',
  ).length;
  const failOpenResolutions = conflictResolutionTrace.filter(
    e => e.resolutionRule === 'fail_open_unresolved',
  ).length;
  const totalComponents = noConflict + resolvedConflicts + failOpenResolutions;

  const conflictSummary: ConflictSummary = {
    totalComponents,
    noConflict,
    resolvedConflicts,
    failOpenResolutions,
    unresolvedConflictWarnings: unresolvedConflictWarnings.length,
    narrative:
      `${totalComponents} components resolved. ` +
      `${noConflict} no-conflict, ${resolvedConflicts} resolved conflict(s), ` +
      `${failOpenResolutions} fail-open resolution(s), ` +
      `${unresolvedConflictWarnings.length} unresolved conflict warning(s).`,
  };

  return {
    resolvedDecisions,
    conflictResolutionTrace,
    noConflictComponentIds,
    conflictSummary,
    unresolvedConflictWarnings,
    globalWarnings,
  };
}
