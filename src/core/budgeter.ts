/**
 * Phase 9: Budgeter.
 *
 * runBudgeter() takes the read-only set of ResolvedSelectionDecision records
 * produced by Phase 8 and emits a BudgetReport.
 *
 * Key invariants (docs/04 §7.5; docs/06 §20, §23, §25, §27):
 *   - Does NOT mutate any ResolvedSelectionDecision field.
 *   - Does NOT emit 'budget_trim' path (PPG-only, Pass 4.9D-2Z).
 *   - Does NOT assign new budgetHint values to resolved decisions.
 *   - budgetOverflow is NEVER silent.
 *   - totalSelectedTokensApprox sums ALL include-resolved (Bucket B + C).
 *   - quarantine_boundary_violation with finalAction:include → Bucket B (counted, not trimmed).
 *   - Partition and token estimation always run before the unconstrained short-circuit return.
 *
 * Trim eligibility (MVP — docs/04 §7.5; docs/06 §23.4 F-30):
 *   retainPolicy === 'optional'
 *   AND omissionPolicy === 'allow'
 *   AND (riskLevel === 'low' || riskLevel === 'medium')
 *   AND component present in candidatesById
 *   AND budgetHint is not 'protected' or 'over_budget_protected'
 *   AND finalPath is not quarantine_boundary_violation
 *   — everything else is Bucket B (protected_or_untrimmable_include).
 *
 * Per-type budget max mapping (docs/06 §25.3):
 *   scaffold → maxScaffoldTokens
 *   skill    → maxSkillTokens
 *   tool     → maxToolTokens
 *   history  → maxHistoryTokens
 *   all other types → totalPromptTokenTarget only
 */

import type { ResolvedSelectionDecision } from '../types/conflict.js';
import type { BudgetState } from '../types/inputs.js';
import type { Component } from '../types/registry.js';
import type { BudgetReport, TrimActionEntry } from '../types/budget.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Conservative token default when cost metadata is fully absent. docs/04 §7.5. */
const CONSERVATIVE_TOKEN_DEFAULT = 500;

/**
 * Component types that have dedicated per-type budget maxima in BudgetState.
 * All other types compare against totalPromptTokenTarget only.
 * Canonical: docs/06 §25.3.
 */
const PER_TYPE_MAX_FIELD: Record<string, keyof Pick<BudgetState,
  'maxScaffoldTokens' | 'maxSkillTokens' | 'maxToolTokens' | 'maxHistoryTokens'>> = {
  scaffold: 'maxScaffoldTokens',
  skill:    'maxSkillTokens',
  tool:     'maxToolTokens',
  history:  'maxHistoryTokens',
};

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * Source of the token estimate used for a component during Phase 9.
 * Used internally to determine effective trim class without mutating decisions.
 */
type TokenSource = 'resolved' | 'registry_tokens' | 'registry_chars' | 'defaulted';

/** Internal enriched record for a Bucket B or Bucket C component. */
interface EnrichedInclude {
  resolved: ResolvedSelectionDecision;
  component: Component | null;  // null only if not in candidatesById
  estimatedTokens: number;
  tokenSource: TokenSource;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Classify whether a component is hard-protected by its budgetHint alone. */
function isHintProtected(resolved: ResolvedSelectionDecision): boolean {
  return resolved.budgetHint === 'protected' || resolved.budgetHint === 'over_budget_protected';
}

/** Classify whether a component is protected/untrimmable by registry metadata. */
function isRegistryProtectedOrUntrimmable(comp: Component | null): boolean {
  if (comp === null) return true; // missing metadata → fail-open
  const { retainPolicy, omissionPolicy, riskLevel } = comp;
  // Absent/null values → fail-open (conservative)
  if (!retainPolicy || !omissionPolicy || !riskLevel) return true;
  // Hard-protected retain policies
  if (retainPolicy === 'mandatory' || retainPolicy === 'safety_critical' || retainPolicy === 'durable') return true;
  // Hard-protected omission policies
  if (omissionPolicy === 'never' || omissionPolicy === 'fail_open') return true;
  // High-risk or critical
  if (riskLevel === 'critical' || riskLevel === 'high') return true;
  return false;
}

/**
 * Returns true if this include-resolved decision belongs to Bucket C (trim-eligible).
 * ALL conditions must be exactly true. Missing/uncertain metadata → Bucket B.
 *
 * Canonical: docs/04 §7.5 MVP trim rule; docs/06 §23.4 F-30.
 */
function isTrimEligible(
  resolved: ResolvedSelectionDecision,
  comp: Component | null,
): boolean {
  // finalAction must be 'include' (caller ensures this, but guard defensively)
  if (resolved.finalAction !== 'include') return false;
  // QBV path → Bucket B
  if (resolved.finalPath === 'quarantine_boundary_violation') return false;
  // Missing metadata → Bucket B
  if (comp === null) return false;
  // Hint-level protection
  if (isHintProtected(resolved)) return false;
  // All three registry fields must be exactly the expected values
  if (comp.retainPolicy !== 'optional') return false;
  if (comp.omissionPolicy !== 'allow') return false;
  if (comp.riskLevel !== 'low' && comp.riskLevel !== 'medium') return false;
  return true;
}

/**
 * Estimate token cost for an include-resolved component.
 * Returns { estimatedTokens, tokenSource }.
 * Records the componentId in conservativeEstimatesUsed if source is 'defaulted'.
 *
 * Priority (docs/04 §7.5):
 *   1. resolved.tokensApproxObserved (if defined and > 0)
 *   2. comp.tokensApprox (if present and > 0)
 *   3. ceil(comp.charsApprox / 4) (if charsApprox present and > 0)
 *   4. CONSERVATIVE_TOKEN_DEFAULT (500)
 */
function estimateTokens(
  resolved: ResolvedSelectionDecision,
  comp: Component | null,
  conservativeEstimatesUsed: string[],
): { estimatedTokens: number; tokenSource: TokenSource } {
  // 1. resolved.tokensApproxObserved
  if (
    resolved.tokensApproxObserved !== undefined &&
    resolved.tokensApproxObserved !== null &&
    resolved.tokensApproxObserved > 0
  ) {
    return { estimatedTokens: resolved.tokensApproxObserved, tokenSource: 'resolved' };
  }

  if (comp !== null) {
    // 2. registry tokensApprox
    if (comp.tokensApprox > 0) {
      return { estimatedTokens: comp.tokensApprox, tokenSource: 'registry_tokens' };
    }
    // 3. charsApprox fallback
    if (comp.charsApprox > 0) {
      const estimatedTokens = Math.ceil(comp.charsApprox / 4);
      return { estimatedTokens, tokenSource: 'registry_chars' };
    }
  }

  // 4. Conservative default
  conservativeEstimatesUsed.push(resolved.componentId);
  return { estimatedTokens: CONSERVATIVE_TOKEN_DEFAULT, tokenSource: 'defaulted' };
}

/**
 * Determine the effective trim class for sort ordering.
 * Does NOT mutate the resolved decision or assign a new budgetHint.
 *
 * Priority (R2 canonical order):
 *   1. If resolved.budgetHint is set → use it.
 *   2. If cost was defaulted → 'unknown_cost'.
 *   3. If estimatedTokens >= 500 → 'expensive_optional'.
 *   4. Otherwise → 'candidate_optional'.
 *
 * Canonical: docs/06 §23.2 (threshold 500); R2 correction 3.
 */
type EffectiveTrimClass = 'expensive_optional' | 'candidate_optional' | 'unknown_cost' | 'protected' | 'over_budget_protected';

function effectiveTrimClass(
  resolved: ResolvedSelectionDecision,
  tokenSource: TokenSource,
  estimatedTokens: number,
): EffectiveTrimClass {
  if (resolved.budgetHint !== undefined) {
    return resolved.budgetHint as EffectiveTrimClass;
  }
  // Rule 2: defaulted cost → unknown_cost (before >= 500 check)
  if (tokenSource === 'defaulted') return 'unknown_cost';
  // Rule 3: non-defaulted estimate >= 500
  if (estimatedTokens >= CONSERVATIVE_TOKEN_DEFAULT) return 'expensive_optional';
  // Rule 4
  return 'candidate_optional';
}

/** Sort weight for effective trim class (lower = trimmed first). */
function trimClassWeight(cls: EffectiveTrimClass): number {
  switch (cls) {
    case 'expensive_optional': return 0;
    case 'candidate_optional': return 1;
    case 'unknown_cost':       return 2;
    default:                   return 3; // protected / over_budget_protected (should not be in Bucket C)
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Run the Phase 9 Budgeter.
 *
 * Reads resolvedDecisions (ResolvedSelectionDecision[]) as read-only input.
 * candidatesById is the same Map<string, Component> produced by Phase 4 and
 * threaded through Phases 5–8 without re-sourcing.
 *
 * Algorithm:
 *   Step 1: Partition into Bucket A / B / C.
 *   Step 2: Estimate token costs for Bucket B + C.
 *   Step 0: Unconstrained short-circuit (after Steps 1–2).
 *   Step 3: over_budget_protected risk flag check.
 *   Step 4: Greedy trim of Bucket C.
 *   Step 5: Compute post-trim state.
 *   Step 6: Assemble and return BudgetReport.
 *
 * Canonical: docs/04 §7.5; docs/06 §20, §23, §25, §27; docs/11 §5 row 9.
 */
export function runBudgeter(
  resolvedDecisions: ResolvedSelectionDecision[],
  budgetState: BudgetState | null,
  candidatesById: Map<string, Component>,
): BudgetReport {

  // -------------------------------------------------------------------------
  // Step 1 — Partition
  // -------------------------------------------------------------------------
  // Bucket A: finalAction !== 'include'.
  //   - All defer (including runtime_unavailable), omit, reference_unknown decisions.
  //   - Never counted in selectedTokensApprox; never in trimActions.
  //
  // Bucket B: finalAction === 'include', protected_or_untrimmable.
  //   - QBV (quarantine_boundary_violation finalPath with include action) → always Bucket B.
  //   - Hard-protected by hint or registry fields, or metadata missing/uncertain.
  //   - Counted in selectedTokensApprox; never in trimActions.
  //
  // Bucket C: finalAction === 'include', trim_eligible.
  //   - All conditions in isTrimEligible() exactly satisfied.
  //   - Counted in selectedTokensApprox; may be trimmed in Step 4.
  //
  const bucketB: EnrichedInclude[] = [];
  const bucketC: EnrichedInclude[] = [];

  const conservativeEstimatesUsed: string[] = [];

  for (const resolved of resolvedDecisions) {
    // Bucket A
    if (resolved.finalAction !== 'include') continue;

    const comp = candidatesById.get(resolved.componentId) ?? null;

    // Step 2 inline: estimate tokens now (always runs for include-resolved)
    const { estimatedTokens, tokenSource } = estimateTokens(resolved, comp, conservativeEstimatesUsed);

    const enriched: EnrichedInclude = { resolved, component: comp, estimatedTokens, tokenSource };

    if (isTrimEligible(resolved, comp)) {
      bucketC.push(enriched);
    } else {
      bucketB.push(enriched);
    }
  }

  // -------------------------------------------------------------------------
  // Pre-trim totals (used in unconstrained return and constrained Steps 3–5)
  // -------------------------------------------------------------------------
  let selectedTokensApprox = 0;
  for (const e of bucketB) selectedTokensApprox += e.estimatedTokens;
  for (const e of bucketC) selectedTokensApprox += e.estimatedTokens;

  // -------------------------------------------------------------------------
  // Step 0 — Unconstrained short-circuit (evaluated after Steps 1–2)
  // -------------------------------------------------------------------------
  const isUnconstrained =
    budgetState === null ||
    budgetState.totalPromptTokenTarget <= 0;

  if (isUnconstrained) {
    return {
      budgetPlan: { selectedTokensApprox, projectedOverflow: false },
      totalSelectedTokensApprox: selectedTokensApprox,
      totalDroppedTokensApprox: 0,
      droppedComponents: [],
      budgetTarget: 0,
      budgetUtilization: 0,
      budgetOverflow: false,
      riskFlags: [],
      conservativeEstimatesUsed,
      trimActions: [],
    };
  }

  const totalPromptTokenTarget = budgetState.totalPromptTokenTarget;

  // -------------------------------------------------------------------------
  // Step 3 — over_budget_protected risk flag
  // -------------------------------------------------------------------------
  // For each Bucket B component: if its estimated tokens exceed totalPromptTokenTarget
  // OR the applicable per-type max, add 'budget_infeasible_protected_component' once.
  const riskFlags: string[] = [];

  for (const { resolved, component, estimatedTokens } of bucketB) {
    // Determine the applicable limit for this component.
    let applicableLimit = totalPromptTokenTarget;
    if (component !== null) {
      const perTypeField = PER_TYPE_MAX_FIELD[component.type];
      if (perTypeField !== undefined) {
        const perTypeMax = budgetState[perTypeField];
        // Use the more restrictive of per-type max and total target.
        applicableLimit = Math.min(totalPromptTokenTarget, perTypeMax);
      }
    }

    if (estimatedTokens > applicableLimit) {
      if (!riskFlags.includes('budget_infeasible_protected_component')) {
        riskFlags.push('budget_infeasible_protected_component');
      }
      // Diagnostic: emit to stderr (internal only; not in BudgetReport globalWarnings)
      process.stderr.write(
        `context-plane: [budget diagnostic] over_budget_protected: componentId '${resolved.componentId}' ` +
        `estimatedTokens ${estimatedTokens} exceeds applicable limit ${applicableLimit}.\n`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Step 4 — Greedy trim (Bucket C only)
  // -------------------------------------------------------------------------
  const trimActions: TrimActionEntry[] = [];

  const projectedOverflow = selectedTokensApprox > totalPromptTokenTarget;

  if (projectedOverflow && bucketC.length > 0) {
    // Sort Bucket C by trim priority (ascending = most trim-worthy first).
    // Primary:   effectivePriority ascending (lower number = trimmed first)
    // Secondary: trimClassWeight ascending (expensive_optional < candidate_optional < unknown_cost)
    // Tertiary:  stable (preserve insertion order within equal tiers)
    const sorted = [...bucketC].sort((a, b) => {
      const aPriority = a.resolved.budgetPriorityObserved ?? a.component?.budgetPriority ?? Infinity;
      const bPriority = b.resolved.budgetPriorityObserved ?? b.component?.budgetPriority ?? Infinity;
      if (aPriority !== bPriority) return aPriority - bPriority;

      const aClass = trimClassWeight(effectiveTrimClass(a.resolved, a.tokenSource, a.estimatedTokens));
      const bClass = trimClassWeight(effectiveTrimClass(b.resolved, b.tokenSource, b.estimatedTokens));
      return aClass - bClass;
    });

    let runningTotal = selectedTokensApprox;

    for (const { resolved, tokenSource, estimatedTokens } of sorted) {
      if (runningTotal <= totalPromptTokenTarget) break;

      const reason = tokenSource === 'defaulted' ? 'budget_cost_unknown' : 'trim_eligible_optional';
      // Compute schema-facing trim bucket. TrimActionEntry.budgetHint is restricted
      // to the trace schema enum: 'candidate_optional' | 'expensive_optional'.
      // Unknown/defaulted cost trims use 'candidate_optional' as the schema-facing
      // bucket; the unknown-cost meaning is preserved in reason: 'budget_cost_unknown'.
      const etc = effectiveTrimClass(resolved, tokenSource, estimatedTokens);
      const schemaBudgetHint: 'candidate_optional' | 'expensive_optional' =
        etc === 'expensive_optional' ? 'expensive_optional' : 'candidate_optional';
      trimActions.push({
        componentId: resolved.componentId,
        budgetHint: schemaBudgetHint,
        tokensDropped: estimatedTokens,
        reason,
      });
      runningTotal -= estimatedTokens;
    }
  }

  // -------------------------------------------------------------------------
  // Step 5 — Post-trim state
  // -------------------------------------------------------------------------
  const totalDroppedTokensApprox = trimActions.reduce((sum, t) => sum + t.tokensDropped, 0);
  const postTrimTotal = selectedTokensApprox - totalDroppedTokensApprox;
  const budgetOverflow = postTrimTotal > totalPromptTokenTarget;
  const budgetUtilization = selectedTokensApprox / totalPromptTokenTarget;

  if (budgetOverflow && !riskFlags.includes('budget_infeasible_protected_component')) {
    riskFlags.push('budget_infeasible_protected_component');
  }

  // -------------------------------------------------------------------------
  // Step 6 — Assemble BudgetReport
  // -------------------------------------------------------------------------
  return {
    budgetPlan: { selectedTokensApprox, projectedOverflow },
    totalSelectedTokensApprox: selectedTokensApprox,
    totalDroppedTokensApprox,
    droppedComponents: trimActions.map(t => t.componentId),
    budgetTarget: totalPromptTokenTarget,
    budgetUtilization,
    budgetOverflow,
    riskFlags,
    conservativeEstimatesUsed,
    trimActions,
  };
}
