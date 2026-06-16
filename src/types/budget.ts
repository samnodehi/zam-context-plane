/**
 * Phase 9: Budgeter boundary/runtime types.
 *
 * These types are the post-budgeting in-memory contracts.
 * JSON Schema + AJV remains the authoritative validation boundary for outputs.
 * Types here give downstream phases (Phase 10+) a stable TS contract.
 *
 * Phase 9 scope:
 *   - TrimActionEntry: one record per component trimmed by the Budgeter.
 *   - BudgetPlan: pre-trim accounting snapshot.
 *   - BudgetReport: aggregate output of runBudgeter().
 *
 * Key invariants (docs/04 §7.5; docs/06 §20, §23, §25, §27):
 *   - Budgeter does NOT emit 'budget_trim' path — PPG-only (Pass 4.9D-2Z).
 *   - Budgeter does NOT mutate any ResolvedSelectionDecision field.
 *   - Budgeter does NOT assign new budgetHint values to resolved decisions.
 *   - budgetOverflow is NEVER silent.
 *   - totalSelectedTokensApprox sums ALL include-resolved decisions (Bucket B + C).
 *
 * Phase 10+ additions must NOT be made here until those phases are approved.
 */

// Note: TrimActionEntry.budgetHint uses a restricted literal union (schema-facing
// trim bucket), not the full canonical BudgetHint type from conflict.ts.

// ---------------------------------------------------------------------------
// TrimActionEntry
// ---------------------------------------------------------------------------

/**
 * One record per component trimmed by the Budgeter during greedy trim (Step 4).
 *
 * budgetHint is the schema-facing trim bucket: 'candidate_optional' or
 * 'expensive_optional'. This is NOT the full canonical 5-value BudgetHint.
 * Computed from effectiveTrimClass at trim time.
 *
 * Unknown/defaulted cost trims use budgetHint: 'candidate_optional' with
 * reason: 'budget_cost_unknown'. The unknown-cost semantic is preserved in
 * the reason field, not in budgetHint.
 *
 * reason is a coded atom only; no raw component content.
 * reason values: 'trim_eligible_optional' | 'budget_cost_unknown'
 *
 * Canonical: docs/04 §7.5; docs/06 §23; trace.schema.json TrimActionEntry.
 */
export interface TrimActionEntry {
  componentId: string;
  /**
   * Schema-facing trim bucket: 'candidate_optional' or 'expensive_optional'.
   * Computed from effectiveTrimClass at trim time. Not the full canonical
   * 5-value BudgetHint. Unknown/defaulted cost trims use 'candidate_optional'
   * as the schema-facing bucket; the unknown-cost meaning is preserved in
   * reason: 'budget_cost_unknown'.
   * Canonical: trace.schema.json TrimActionEntry.budgetHint enum.
   */
  budgetHint: 'candidate_optional' | 'expensive_optional';
  /** The token estimate actually used (conservative 500 if absent from registry). */
  tokensDropped: number;
  /** Coded atom: 'trim_eligible_optional' | 'budget_cost_unknown'. No raw content. */
  reason: string;
}

// ---------------------------------------------------------------------------
// BudgetPlan
// ---------------------------------------------------------------------------

/**
 * Pre-trim accounting snapshot produced by the Budgeter.
 *
 * selectedTokensApprox is the sum of estimated tokens for ALL include-resolved
 * components (Bucket B protected_or_untrimmable + Bucket C trim_eligible).
 * finalAction !== 'include' decisions (Bucket A) are excluded.
 *
 * projectedOverflow is computed pre-trim:
 *   selectedTokensApprox > totalPromptTokenTarget
 *
 * Canonical: docs/04 §7.5 token accounting (Pass 4.9D-2Z).
 */
export interface BudgetPlan {
  /** Sum of estimated tokens for all include-resolved components. Pre-trim. */
  selectedTokensApprox: number;
  /** true if selectedTokensApprox > totalPromptTokenTarget (pre-trim). */
  projectedOverflow: boolean;
}

// ---------------------------------------------------------------------------
// BudgetReport
// ---------------------------------------------------------------------------

/**
 * Aggregate output of runBudgeter().
 *
 * Produced after greedy trim. budgetOverflow is post-trim and must never be silent.
 *
 * Token accounting (docs/04 §7.5 Pass 4.9D-2Z):
 *   budgetUtilization = totalSelectedTokensApprox / budgetTarget  (pre-trim; 0 if budgetTarget=0)
 *   budgetOverflow    = (selectedTokensApprox - totalDroppedTokensApprox) > budgetTarget
 *
 * Unconstrained mode (budgetState null or totalPromptTokenTarget <= 0):
 *   budgetTarget = 0, budgetUtilization = 0, budgetOverflow = false,
 *   trimActions = [], droppedComponents = []
 *   selectedTokensApprox is still computed.
 *
 * Canonical: docs/04 §7.5; docs/06 §20, §23, §25, §27.
 */
export interface BudgetReport {
  /** Pre-trim accounting snapshot. */
  budgetPlan: BudgetPlan;
  /** Pre-trim sum of estimated tokens for all include-resolved components. */
  totalSelectedTokensApprox: number;
  /** Sum of tokensDropped from trimActions. */
  totalDroppedTokensApprox: number;
  /** IDs of components trimmed by the greedy trim loop. */
  droppedComponents: string[];
  /**
   * The totalPromptTokenTarget from budgetState.
   * 0 if budgetState is null or totalPromptTokenTarget <= 0 (unconstrained).
   */
  budgetTarget: number;
  /**
   * totalSelectedTokensApprox / budgetTarget (pre-trim ratio).
   * 0 if budgetTarget is 0 (unconstrained or zero-target).
   */
  budgetUtilization: number;
  /**
   * Post-trim overflow flag.
   * true if (selectedTokensApprox - totalDroppedTokensApprox) > budgetTarget.
   * NEVER silent — must always be set explicitly.
   */
  budgetOverflow: boolean;
  /**
   * Risk flags for this planning run.
   * e.g. 'budget_infeasible_protected_component' when a protected component
   * alone exceeds the applicable budget limit.
   * Deduplicated — each code appears at most once per runBudgeter() call.
   */
  riskFlags: string[];
  /**
   * IDs of components where the conservative 500-token default was substituted
   * because both tokensApprox and charsApprox were absent from registry and
   * resolved decision metadata.
   */
  conservativeEstimatesUsed: string[];
  /** One entry per component trimmed during greedy trim. Empty if no trim ran. */
  trimActions: TrimActionEntry[];
}
