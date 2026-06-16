/**
 * Phase 10: Prompt Plan Generator (PPG).
 *
 * runPromptPlanGenerator() is a PURE ASSEMBLER:
 *   - No I/O, no AJV validation, no file writes.
 *   - Returns a PromptPlanOutput object.
 *   - AJV validation and file writing are performed by plan.ts.
 *
 * Inputs:
 *   - resolvedDecisions: ResolvedSelectionDecision[] — read-only (not mutated)
 *   - budgetReport: BudgetReport — read-only
 *   - normalizedInputs: NormalizedInputs — for requestSignals.promptFamily
 *   - candidatesById: Map<string, Component> — for tokensApprox lookup
 *   - accumulatedWarnings: PlanningWarning[] — from plan.ts, all prior phases
 *
 * Key invariants (docs/04 §7.7; docs/11 §4.2, I-09, I-13–I-15):
 *   - Three partition arrays are exhaustive and mutually exclusive.
 *   - reference_unknown finalAction decisions excluded from all arrays.
 *   - budget_trim path emitted only here (not by selectors or Conflict Resolver).
 *   - deferredComponents[] entries always carry path field.
 *   - tokensApprox source: tokensApproxObserved > registry tokensApprox > omit.
 *   - charsApprox not used; conservative 500 not used (Budgeter-internal only).
 *   - budget_trim entries use BudgetReport.trimActions[].tokensDropped.
 *   - budgetHintSummary computed last, after BudgetReport received.
 *   - PPG does not reinterpret or assign budgetHint values.
 *   - No cache advisory fields (post-MVP).
 *   - No raw component/history content in output.
 *
 * Phase 11+ additions must NOT be made here until those phases are approved.
 */

import type { ResolvedSelectionDecision } from '../types/conflict.js';
import type { BudgetReport } from '../types/budget.js';
import type { NormalizedInputs } from '../types/normalized.js';
import type { Component } from '../types/registry.js';
import type { PlanningWarning } from '../types/warnings.js';
import type { PartitionEntry, PromptPlanOutput } from '../types/plan.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Schema version for this planning run's prompt-plan.json. */
const SCHEMA_VERSION = 'v0';

/**
 * Component type → estimatedTokens schema key mapping.
 * 'skill' (singular component type) maps to 'skills' (plural schema key).
 * Types not in this map contribute to 'total' only.
 * Canonical: docs/04 §7.7; schemas/outputs/prompt-plan.schema.json.
 */
const TYPE_TO_TOKEN_KEY: Record<string, 'scaffold' | 'skills' | 'tools' | 'history'> = {
  scaffold: 'scaffold',
  skill:    'skills',
  tool:     'tools',
  history:  'history',
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the tokensApprox value for a partition entry.
 *
 * Priority (R2 approved — Q2 closed):
 *   1. resolved.tokensApproxObserved if defined, not null, and > 0.
 *   2. candidatesById component.tokensApprox if present and > 0.
 *   3. Otherwise undefined (omit from partition entry).
 *
 * charsApprox is NOT used. Conservative 500 is NOT used.
 * These are Budgeter-internal; prompt-plan output must omit rather than estimate.
 */
function lookupTokens(
  resolved: ResolvedSelectionDecision,
  candidatesById: Map<string, Component>,
): number | undefined {
  if (
    resolved.tokensApproxObserved !== undefined &&
    resolved.tokensApproxObserved !== null &&
    resolved.tokensApproxObserved > 0
  ) {
    return resolved.tokensApproxObserved;
  }
  const comp = candidatesById.get(resolved.componentId);
  if (comp !== undefined && comp.tokensApprox > 0) {
    return comp.tokensApprox;
  }
  return undefined;
}

/**
 * Determine the failOpenReasons[] reason string for an include-resolved decision.
 *
 * Priority (R2 correction 2):
 *   1. resolutionRule === 'fail_open_unresolved' → ':fail_open_unresolved'
 *   2. resolutionRule === 'history_malformed_fail_open' → ':history_malformed_fail_open'
 *   3. finalPath === 'fail_open' otherwise → ':path_fail_open'
 *
 * Rule 3 handles the case where finalPath is 'fail_open' but resolutionRule is
 * 'no_conflict' (a single uncontested fail_open decision from selectors). Using
 * ':path_fail_open' prevents 'no_conflict' from appearing as a misleading cause label.
 *
 * Returns null if none of the criteria apply.
 */
function failOpenReason(resolved: ResolvedSelectionDecision): string | null {
  if (resolved.finalAction !== 'include') return null;

  const prefix = `fail_open:componentId:${resolved.componentId}`;

  if (resolved.resolutionRule === 'fail_open_unresolved') {
    return `${prefix}:fail_open_unresolved`;
  }
  if (resolved.resolutionRule === 'history_malformed_fail_open') {
    return `${prefix}:history_malformed_fail_open`;
  }
  if (resolved.finalPath === 'fail_open') {
    return `${prefix}:path_fail_open`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Run the Phase 10 Prompt Plan Generator.
 *
 * Pure assembler — no I/O, no AJV validation, no file writes.
 * Caller (plan.ts) is responsible for AJV validation and writeFileSync.
 *
 * Algorithm:
 *   Step 1: Identify budget-trimmed IDs.
 *   Step 2: Partition resolvedDecisions into three arrays.
 *   Step 3: Compute estimatedTokens from selectedComponents[].
 *   Step 4: Assemble budgetPlan.
 *   Step 5: Assemble failOpenReasons, riskFlags, planningWarnings, budgetHintSummary.
 *   Step 6: Assert exhaustive+mutually-exclusive invariant and return.
 *
 * Canonical: docs/04 §7.7; docs/11 §4.2, §5 row 11, I-09, I-13–I-15.
 */
export function runPromptPlanGenerator(
  resolvedDecisions: ResolvedSelectionDecision[],
  budgetReport: BudgetReport,
  normalizedInputs: NormalizedInputs,
  candidatesById: Map<string, Component>,
  accumulatedWarnings: PlanningWarning[],
): PromptPlanOutput {

  // -------------------------------------------------------------------------
  // Step 1 — Identify budget-trimmed component IDs
  // -------------------------------------------------------------------------
  // Build a map from componentId → trimAction for O(1) lookup during partition.
  const trimActionByComponentId = new Map(
    budgetReport.trimActions.map(t => [t.componentId, t]),
  );

  // -------------------------------------------------------------------------
  // Step 2 — Partition resolved decisions into three arrays
  // -------------------------------------------------------------------------
  const selectedComponents: PartitionEntry[] = [];
  const omittedComponents: PartitionEntry[] = [];
  const deferredComponents: PartitionEntry[] = [];

  for (const resolved of resolvedDecisions) {
    // Skip reference_unknown decisions — excluded from all partition arrays.
    // These have finalAction === 'reference_unknown' and are not valid partition paths.
    if (resolved.finalAction === 'reference_unknown') continue;

    const componentId = resolved.componentId;

    if (resolved.finalAction === 'defer') {
      // ── Bucket: deferredComponents[] ──────────────────────────────────────
      const tokensApprox = lookupTokens(resolved, candidatesById);
      const entry: PartitionEntry = {
        componentId,
        action: 'defer',
        path: resolved.finalPath,     // 'runtime_unavailable' | 'default_defer'
        reason: `deferred_${resolved.finalPath}`,
      };
      if (tokensApprox !== undefined) entry.tokensApprox = tokensApprox;
      deferredComponents.push(entry);

    } else if (resolved.finalAction === 'omit') {
      // ── Bucket: omittedComponents[] (selector-origin) ─────────────────────
      const tokensApprox = lookupTokens(resolved, candidatesById);
      const entry: PartitionEntry = {
        componentId,
        action: 'omit',
        path: resolved.finalPath,     // 'safe_to_omit_match' | 'default_action_omit'
        reason: `omitted_${resolved.finalPath}`,
      };
      if (tokensApprox !== undefined) entry.tokensApprox = tokensApprox;
      omittedComponents.push(entry);

    } else if (resolved.finalAction === 'include') {
      const trimAction = trimActionByComponentId.get(componentId);

      if (trimAction !== undefined) {
        // ── Bucket: omittedComponents[] (budget-trim, PPG-only) ───────────────
        // Use tokensDropped from BudgetReport (not lookupTokens) for accounting consistency.
        const entry: PartitionEntry = {
          componentId,
          action: 'omit',
          path: 'budget_trim',
          reason: 'budget_trim',
          tokensApprox: trimAction.tokensDropped,
        };
        omittedComponents.push(entry);

      } else {
        // ── Bucket: selectedComponents[] ─────────────────────────────────────
        const tokensApprox = lookupTokens(resolved, candidatesById);
        const entry: PartitionEntry = {
          componentId,
          action: 'include',
          path: resolved.finalPath,
          reason: `selected_${resolved.finalPath}`,
        };
        if (tokensApprox !== undefined) entry.tokensApprox = tokensApprox;
        selectedComponents.push(entry);
      }
    }
    // Note: any other finalAction values (should not occur post-Phase 8) are
    // defensively dropped — they do not satisfy any partition condition and
    // would violate the schema if included.
  }

  // -------------------------------------------------------------------------
  // Step 3 — Compute estimatedTokens from selectedComponents[] (post-trim only)
  // -------------------------------------------------------------------------
  let totalTokens = 0;
  const perType: Record<string, number> = {};

  for (const entry of selectedComponents) {
    if (entry.tokensApprox === undefined) continue;
    totalTokens += entry.tokensApprox;

    const comp = candidatesById.get(entry.componentId);
    if (comp !== undefined) {
      const key = TYPE_TO_TOKEN_KEY[comp.type];
      if (key !== undefined) {
        perType[key] = (perType[key] ?? 0) + entry.tokensApprox;
      }
    }
  }

  const estimatedTokens: PromptPlanOutput['estimatedTokens'] = { total: totalTokens };
  // Only emit per-type fields when > 0 (optional in schema; avoid cluttering output with zeros)
  if ((perType['scaffold'] ?? 0) > 0) estimatedTokens.scaffold = perType['scaffold'];
  if ((perType['skills']   ?? 0) > 0) estimatedTokens.skills   = perType['skills'];
  if ((perType['tools']    ?? 0) > 0) estimatedTokens.tools     = perType['tools'];
  if ((perType['history']  ?? 0) > 0) estimatedTokens.history   = perType['history'];

  // -------------------------------------------------------------------------
  // Step 4 — Assemble budgetPlan
  // -------------------------------------------------------------------------
  const selectedTokensApprox = budgetReport.totalSelectedTokensApprox;  // pre-trim
  const budgetTarget = budgetReport.budgetTarget;                         // 0 if unconstrained

  const budgetPlan: PromptPlanOutput['budgetPlan'] = {
    totalPromptTokenTarget: budgetTarget,
    selectedTokensApprox,
    // projectedOverflow is 0 when unconstrained (budgetTarget <= 0).
    // When constrained: max(0, selectedTokensApprox - budgetTarget).
    projectedOverflow: budgetTarget > 0
      ? Math.max(0, selectedTokensApprox - budgetTarget)
      : 0,
  };


  // -------------------------------------------------------------------------
  // Step 5 — Assemble failOpenReasons, riskFlags, planningWarnings, budgetHintSummary
  // -------------------------------------------------------------------------

  // failOpenReasons: include-resolved decisions driven by uncertainty.
  // injection_suspect_omit_allowed is NOT a fail-open include reason.
  const failOpenReasons: string[] = [];
  for (const resolved of resolvedDecisions) {
    const reason = failOpenReason(resolved);
    if (reason !== null) {
      failOpenReasons.push(reason);
    }
  }

  // riskFlags: surface BudgetReport.riskFlags verbatim. No raw content.
  const riskFlags: string[] = [...budgetReport.riskFlags];

  // planningWarnings: project accumulated warnings to { code, message }.
  // context field is dropped (not part of prompt-plan schema).
  const planningWarnings = accumulatedWarnings.map(w => ({
    code: w.code,
    message: w.message,
  }));

  // budgetHintSummary: computed last, after BudgetReport received.
  // Count budgetHint values across ALL resolved decisions (not only selected).
  // All counts are 0 in the current pipeline (Phase 5 does not assign hints).
  // PPG does not assign or reinterpret budgetHint values.
  const budgetHintSummary: PromptPlanOutput['budgetHintSummary'] = {
    protectedCount:           0,
    overBudgetProtectedCount: 0,
    candidateOptionalCount:   0,
    expensiveOptionalCount:   0,
    unknownCostCount:         0,
  };
  for (const resolved of resolvedDecisions) {
    switch (resolved.budgetHint) {
      case 'protected':             budgetHintSummary.protectedCount++;           break;
      case 'over_budget_protected': budgetHintSummary.overBudgetProtectedCount++; break;
      case 'candidate_optional':    budgetHintSummary.candidateOptionalCount++;   break;
      case 'expensive_optional':    budgetHintSummary.expensiveOptionalCount++;   break;
      case 'unknown_cost':          budgetHintSummary.unknownCostCount++;          break;
      default: break; // undefined/absent: no count
    }
  }

  // -------------------------------------------------------------------------
  // Step 6 — Assert exhaustive+mutually-exclusive invariant and return
  // -------------------------------------------------------------------------
  const nonRefUnknownCount = resolvedDecisions.filter(
    d => d.finalAction !== 'reference_unknown',
  ).length;
  const partitionTotal =
    selectedComponents.length + omittedComponents.length + deferredComponents.length;

  if (partitionTotal !== nonRefUnknownCount) {
    throw new Error(
      `[PPG internal error] Partition invariant violated: ` +
      `selected(${selectedComponents.length}) + omitted(${omittedComponents.length}) + ` +
      `deferred(${deferredComponents.length}) = ${partitionTotal} ` +
      `!== nonRefUnknown(${nonRefUnknownCount}). ` +
      `Check for unhandled finalAction values.`,
    );
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    promptFamily: normalizedInputs.requestSignals.promptFamily,
    selectedComponents,
    omittedComponents,
    deferredComponents,
    budgetPlan,
    estimatedTokens,
    riskFlags,
    failOpenReasons,
    planningWarnings,
    budgetHintSummary,
  };
}
