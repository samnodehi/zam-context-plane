/**
 * Phase 10: PPG boundary/runtime types.
 *
 * In-memory contract for prompt-plan.json before AJV validation and serialization.
 * Not duplicating the JSON schema — types give Phase 11+ a stable TS contract.
 *
 * Key invariants (docs/04 §7.7; docs/11 §4.2; schemas/outputs/prompt-plan.schema.json):
 *   - selectedComponents + omittedComponents + deferredComponents is exhaustive
 *     and mutually exclusive across all non-reference_unknown decisions.
 *   - reference_unknown finalAction decisions are excluded from all three arrays.
 *   - deferredComponents[] entries always carry a path field.
 *   - budgetHintSummary is computed by PPG only, after BudgetReport received.
 *   - No raw component content, no raw history content, no contentInline.
 *   - No cache advisory fields (cacheStability, stablePrefixHash, etc.) — post-MVP.
 *
 * Phase 11+ additions must NOT be made here until those phases are approved.
 */

// ---------------------------------------------------------------------------
// PartitionEntry
// ---------------------------------------------------------------------------

/**
 * One entry in selectedComponents[], omittedComponents[], or deferredComponents[].
 * Matches schemas/outputs/prompt-plan.schema.json#PartitionEntry exactly.
 *
 * Required: componentId, action, path, reason.
 * tokensApprox is optional — omitted when no reliable token cost is available.
 *
 * tokensApprox sources (priority order, R2 approved):
 *   1. resolved.tokensApproxObserved if present and > 0
 *   2. registry component.tokensApprox if present and > 0
 *   3. Otherwise omit (no charsApprox derivation; no conservative 500 default)
 *   Exception: budget_trim entries use BudgetReport.trimActions[].tokensDropped.
 *
 * No raw component content, no contentInline, no cache advisory fields.
 * Canonical: docs/04 §7.7 F-13; docs/11 §4.2; docs/12 §5.1.
 */
export interface PartitionEntry {
  componentId: string;
  /** 'include' | 'omit' | 'defer' — must match the containing partition array. */
  action: string;
  /**
   * The final output partition path for this component.
   * Valid values are constrained by the partition array (schema allOf).
   * deferredComponents entries carry this to distinguish 'runtime_unavailable'
   * from 'default_defer' — harnesses filter on path, not action.
   * Canonical: docs/06 §4; docs/11 §4.2; 5-Q7/F-28.
   */
  path: string;
  /** Coded atom. Must not contain raw component or history content. */
  reason: string;
  /**
   * Optional approximate token count from registry metadata or resolved decision.
   * No live tokenizer calls. Absent when cost is unknown or not meaningful.
   * Conservative default 500 must not appear here — that is Budgeter-internal only.
   * Canonical: docs/04 §7.5; docs/06 §20.2.
   */
  tokensApprox?: number;
}

// ---------------------------------------------------------------------------
// PromptPlanOutput
// ---------------------------------------------------------------------------

/**
 * In-memory shape of prompt-plan.json before AJV validation and serialization.
 *
 * budgetHintSummary is typed as required here even though the JSON schema marks
 * it optional — the PPG always emits it to prevent accidental omission.
 * Canonical: docs/04 §7.7; docs/11 §4.2; docs/06 §27.6.
 */
export interface PromptPlanOutput {
  /** 'v0' in MVP. Canonical: docs/11 §4.2. */
  schemaVersion: string;
  promptFamily: string;
  /** Include-resolved components not trimmed by Budgeter. action MUST be 'include'. */
  selectedComponents: PartitionEntry[];
  /**
   * Omitted and budget-trimmed components.
   * action MUST be 'omit'.
   * path: 'safe_to_omit_match' | 'default_action_omit' (selector-origin)
   *     | 'budget_trim' (PPG-only — docs/04 §7.5 Pass 4.9D-2Z)
   */
  omittedComponents: PartitionEntry[];
  /**
   * Deferred components. action MUST be 'defer'.
   * Every entry carries a path field: 'runtime_unavailable' | 'default_defer'.
   * Harnesses filter by path, not action. Canonical: docs/04 §7.7; 5-Q7/F-28.
   */
  deferredComponents: PartitionEntry[];
  /**
   * Budget planning summary from BudgetReport.
   * selectedTokensApprox: pre-trim total (from BudgetReport.totalSelectedTokensApprox).
   * projectedOverflow: integer max(0, selectedTokensApprox - totalPromptTokenTarget).
   * Canonical: docs/04 §7.5 Pass 4.9D-2Z.
   */
  budgetPlan: {
    totalPromptTokenTarget: number;
    selectedTokensApprox: number;
    projectedOverflow: number;
  };
  /**
   * Post-trim selected token breakdown.
   * total: sum of tokensApprox from selectedComponents[] only.
   * Per-type fields optional — omitted when zero or type not present.
   * 'skill' component type maps to 'skills' schema key (plural).
   * Canonical: docs/04 §7.7.
   */
  estimatedTokens: {
    scaffold?: number;
    skills?: number;
    tools?: number;
    history?: number;
    total: number;
  };
  /** Risk flags from BudgetReport. No raw content. */
  riskFlags: string[];
  /**
   * Coded reasons for include-resolved fail-open decisions.
   * Only components where the selection was driven by uncertainty qualify.
   * injection_suspect_omit_allowed is NOT a fail-open include reason.
   * Canonical: docs/04 §7.7.
   */
  failOpenReasons: string[];
  /**
   * Global planning warnings from all prior phases.
   * Projected to { code, message } — context field dropped.
   * Not hard-coded empty; receives accumulated warnings from plan.ts.
   */
  planningWarnings: Array<{ code: string; message: string }>;
  /**
   * Aggregated budget hint counts from resolved decisions.
   * Computed by PPG only, after BudgetReport received.
   * Budgeter does not consume this field.
   * All counts are 0 in current pipeline (Phase 5 does not assign hints).
   * Canonical: docs/06 §27.6; docs/11 I-14.
   */
  budgetHintSummary: {
    protectedCount: number;
    overBudgetProtectedCount: number;
    candidateOptionalCount: number;
    expensiveOptionalCount: number;
    unknownCostCount: number;
  };
}
