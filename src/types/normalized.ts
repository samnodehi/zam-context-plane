/**
 * Phase 3: Request normalization boundary/runtime types.
 *
 * These types are the post-normalization in-memory contracts — not duplicates
 * of the JSON Schemas. JSON Schema + AJV remains the authoritative validation
 * boundary. Types here exist only to give downstream phases a stable TS contract.
 *
 * Phase 3 scope:
 *   - RequestSignals: the structured signal set produced by the in-process
 *     Request Router stub, matching schemas/inputs/request-signals.schema.json.
 *   - NormalizedInputs: the aggregate result returned by normalizeInputs(),
 *     combining requestSignals with verbatim Phase 1 Class B carry-forwards.
 *
 * Phase 4+ additions must NOT be made here until those phases are approved.
 */

import type {
  ActiveIds,
  RuntimeCapabilities,
  HistoryStateSummary,
  BudgetState,
  UserConstraints,
  SelectorPolicy,
  RequestSignals,
} from './inputs.js';
import type { PlanningWarning } from './warnings.js';

// Re-export RequestSignals from inputs.ts for backward compatibility.
// (Moved to inputs.ts to avoid circular import: normalized.ts imports inputs.ts.)
export type { RequestSignals } from './inputs.js';

// ---------------------------------------------------------------------------
// NormalizedInputs
// ---------------------------------------------------------------------------

/**
 * The aggregate output of normalizeInputs().
 *
 * Contains the Phase 3-produced requestSignals and all Phase 1 Class B inputs
 * carried forward verbatim. This is the primary input boundary for Phase 4+.
 *
 * Phase 3 warnings (prompt_family_defaulted, active_id_unknown) are accumulated
 * in warnings[]. These are separate from Phase 1 LoadedInputs.warnings — plan.ts
 * prints both sets to stderr independently.
 *
 * Canonical: docs/06 §2; docs/11 §6 Phase 3.
 */
export interface NormalizedInputs {
  // Phase 3 primary output
  /** The structured request signal set produced by the Phase 3 Router stub. */
  requestSignals: RequestSignals;

  // Phase 1 Class B inputs carried forward verbatim — not revalidated in Phase 3
  /** Runtime capabilities from Phase 1 (capabilityInventoryComplete already set). */
  runtime: RuntimeCapabilities;
  /** History state summary from Phase 1 (historyMalformed already set). */
  history: HistoryStateSummary;
  /** Budget state from Phase 1, or null if absent/malformed. */
  budget: BudgetState | null;
  /** User constraints from Phase 1, or null if absent/malformed. */
  constraints: UserConstraints | null;
  /** Selector policy from Phase 1 (safe defaults already applied). */
  policy: SelectorPolicy;

  /**
   * Active ID arrays after Phase 3 unknown-ID check.
   * Unknown IDs are still passed through — they produce active_id_unknown
   * warnings but are NOT removed from the arrays.
   */
  activeIds: ActiveIds;

  /**
   * Phase 3 normalization warnings (prompt_family_defaulted, active_id_unknown).
   * Separate from Phase 1 LoadedInputs.warnings.
   * Phase 11 will assemble all warning sets into trace.json.
   */
  warnings: PlanningWarning[];
}
