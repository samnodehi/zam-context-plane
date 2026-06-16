/**
 * Phase 4: Candidate set construction.
 *
 * Consumes Phase 2 `RegistryResult` and produces `CandidateSetResult`:
 *   - A `CandidateSetSummary` for Phase 11 trace assembly.
 *   - A reference to the live candidate component map for Phase 5 fan-out.
 *
 * What this module does:
 *   - Reads `registryResult.indexes.componentsById` as the candidate set.
 *   - Records `quarantinedComponents.length` for accounting.
 *   - Produces `candidateSetSummary` with policy/size/quarantinedExcluded.
 *   - Throws `CandidateSetFatalError` if the internal policy constant is
 *     somehow not `"all_non_quarantined"` (unsupported_candidate_set_policy).
 *
 * What this module does NOT do:
 *   - No AJV validation (candidate set is computed, not parsed from input).
 *   - No selector logic.
 *   - No SelectionDecision production.
 *   - No reference_unknown emission.
 *   - No active ID re-validation (Phase 3 already emitted active_id_unknown).
 *   - No re-quarantine of components.
 *   - No re-filtering by type/tag/risk/promptFamily.
 *   - No file writes.
 *   - No network/provider/model calls.
 *
 * Canonical: docs/06 §3.1; docs/11 §5 build-order row 2, §6 Phase 4; I-04; I-07.
 */

import type { RegistryResult } from '../types/registry.js';
import type { CandidateSetResult } from '../types/candidate.js';

// ---------------------------------------------------------------------------
// CandidateSetFatalError
// ---------------------------------------------------------------------------

/**
 * Thrown when Phase 4 encounters an unrecoverable fatal condition.
 *
 * In MVP the only fatal code is `unsupported_candidate_set_policy`, which
 * fires if the internal `CANDIDATE_SET_POLICY` constant is not
 * `"all_non_quarantined"`. Silent fallback to `all_non_quarantined` is
 * prohibited — per docs/06 §3.1, an incorrect candidate set silently corrupts
 * gap-check accounting.
 *
 * Canonical: docs/06 §3.1; docs/11 §3.3 exit behavior; I-07.
 */
export class CandidateSetFatalError extends Error {
  /** Machine-readable fatal error code. */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'CandidateSetFatalError';
    this.code = code;
    // Maintain proper prototype chain for instanceof checks in CommonJS/ESM.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Internal constant
// ---------------------------------------------------------------------------

/**
 * The MVP candidate set policy.
 *
 * Only `"all_non_quarantined"` is supported in MVP. Future values
 * (`by_type`, `by_prompt_family`, `explicit_component_ids`) are named in
 * docs/06 §3.1 but must not be implemented until explicitly authorized.
 *
 * The guard in buildCandidateSet() checks this constant to ensure any future
 * refactor that introduces an alternate policy path will fail loudly rather
 * than silently corrupting gap-check accounting.
 *
 * Canonical: docs/06 §3.1; I-07.
 */
const CANDIDATE_SET_POLICY = 'all_non_quarantined' as const;

// ---------------------------------------------------------------------------
// buildCandidateSet
// ---------------------------------------------------------------------------

/**
 * Phase 4 entry point: construct the candidate set from Phase 2 output.
 *
 * @param registryResult - The output of buildRegistryIndexes() (Phase 2).
 *   Must be a fully indexed, non-fatal RegistryResult. Phase 4 does not
 *   re-validate with AJV.
 * @returns CandidateSetResult containing the summary, candidate map reference,
 *   and (always empty) warnings array.
 * @throws CandidateSetFatalError with code `unsupported_candidate_set_policy`
 *   if the internal policy constant is not `"all_non_quarantined"`. This
 *   guard is a future-proof invariant check — it should never fire in MVP.
 *
 * Canonical: docs/06 §3.1; docs/11 §6 Phase 4; I-04; I-07; I-08.
 */
export function buildCandidateSet(registryResult: RegistryResult): CandidateSetResult {
  // ---------------------------------------------------------------------------
  // Step 1: Validate internal policy constant (I-07)
  // ---------------------------------------------------------------------------
  // In MVP the only supported candidate set policy is "all_non_quarantined".
  // Silent fallback is prohibited — per docs/06 §3.1, an unsupported value
  // must halt with unsupported_candidate_set_policy.
  //
  // This guard exists as a future-proof invariant: if a future refactor
  // introduces an alternate policy path without an explicit spec decision,
  // it will fail loudly here rather than silently corrupting gap-check accounting.
  if (CANDIDATE_SET_POLICY !== 'all_non_quarantined') {
    throw new CandidateSetFatalError(
      'unsupported_candidate_set_policy',
      `Unsupported candidateSetPolicy value: "${CANDIDATE_SET_POLICY}". ` +
        'Only "all_non_quarantined" is supported in MVP. ' +
        'Canonical: docs/06 §3.1; docs/11 §3.3; I-07.',
    );
  }

  // ---------------------------------------------------------------------------
  // Step 2: Derive candidate set accounting values (I-08)
  // ---------------------------------------------------------------------------
  // candidatesById: direct reference — do not copy. Phase 5 selectors must
  // treat this as read-only. All entries are valid and non-quarantined
  // (guaranteed by Phase 2 buildRegistryIndexes). I-04: quarantine is a
  // registry-phase state — Phase 4 never re-quarantines or re-adds components.
  const candidatesById = registryResult.indexes.componentsById;

  // candidateSetSize: the gap-check denominator. Every non-quarantined
  // candidate must receive ≥ 1 SelectionDecision in Phase 5 (I-08).
  const candidateSetSize = registryResult.indexes.componentsById.size;

  // quarantinedExcluded: accounting record. These components were excluded
  // by Phase 2 and are not in componentsById. Phase 4 does not re-filter —
  // it only counts how many were already excluded.
  const quarantinedExcluded = registryResult.quarantinedComponents.length;

  // ---------------------------------------------------------------------------
  // Step 3: Assemble result
  // ---------------------------------------------------------------------------
  // warnings: always [] on success. The only fatal code
  // (unsupported_candidate_set_policy) throws before reaching here.
  // The field exists for structural consistency with Phase 2/3 result types
  // and to remain safe for future extension without a type change.
  return {
    summary: {
      candidateSetPolicy: CANDIDATE_SET_POLICY,
      candidateSetSize,
      quarantinedExcluded,
    },
    candidatesById,
    warnings: [],
  };
}
