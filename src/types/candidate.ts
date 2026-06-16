/**
 * Phase 4: Candidate set boundary types.
 *
 * These types are the post-candidate-set-construction in-memory contracts.
 * JSON Schema + AJV validation is not performed at the Phase 4 boundary —
 * the candidate set is computed from already-validated Phase 2 output, not
 * parsed from an external input. Types here give downstream phases (Phase 5+)
 * a stable TS contract.
 *
 * This file must contain ONLY type/interface definitions.
 * Runtime error classes (e.g. CandidateSetFatalError) live in
 * src/core/candidate-set-builder.ts.
 *
 * Phase 4 scope:
 *   - CandidateSetSummary: the trace-ready accounting record emitted in
 *     registryPhase of trace.json before selector fan-out begins.
 *     Canonical: docs/06 §3.1; schemas/outputs/trace.schema.json
 *     registryPhase.candidateSetSummary.
 *   - CandidateSetResult: the aggregate output of buildCandidateSet().
 *
 * Phase 5+ additions must NOT be made here until those phases are approved.
 */

import type { Component } from './registry.js';
import type { PlanningWarning } from './warnings.js';

// ---------------------------------------------------------------------------
// CandidateSetSummary
// ---------------------------------------------------------------------------

/**
 * The trace-ready accounting record for the candidate set.
 *
 * Emitted in `registryPhase` of `trace.json` before selector fan-out begins.
 * This is the gap-check denominator: Phase 6 gap-check uses `candidateSetSize`
 * to verify every non-quarantined candidate received ≥ 1 SelectionDecision.
 *
 * Required fields match schemas/outputs/trace.schema.json
 * `registryPhase.candidateSetSummary` exactly:
 *   - `candidateSetPolicy` (`const: "all_non_quarantined"`)
 *   - `candidateSetSize`
 *   - `quarantinedExcluded`
 * `additionalProperties: false` — no additional fields.
 *
 * Canonical: docs/06 §3.1; docs/11 §5 build-order row 2; I-07; I-08.
 */
export interface CandidateSetSummary {
  /**
   * The candidate set policy applied. Always `"all_non_quarantined"` in MVP —
   * all non-quarantined components enter selector fan-out.
   * Other values are future-only and must not appear in MVP.
   * Canonical: docs/06 §3.1; I-07.
   */
  candidateSetPolicy: 'all_non_quarantined';

  /**
   * Total number of non-quarantined components entering selector fan-out.
   * Equal to `componentsById.size` after Phase 2 quarantine exclusion.
   * This is the gap-check denominator — Phase 6 must verify:
   *   `noConflictComponentIds.length + conflictResolutionTrace.length === candidateSetSize`.
   * Canonical: docs/06 §3.1; I-08.
   */
  candidateSetSize: number;

  /**
   * Number of components excluded from the candidate set due to quarantine.
   * Equal to `quarantinedComponents.length` from Phase 2 RegistryResult.
   * Must match `registryPhase.quarantinedCount` in trace.json.
   * Canonical: docs/06 §3.1.
   */
  quarantinedExcluded: number;
}

// ---------------------------------------------------------------------------
// CandidateSetResult
// ---------------------------------------------------------------------------

/**
 * The aggregate output of buildCandidateSet().
 *
 * Contains the `CandidateSetSummary` (for Phase 11 trace assembly) and a
 * reference to the live candidate component map (for Phase 5 selector fan-out).
 *
 * IMPORTANT: `candidatesById` is a direct reference to
 * `registryResult.indexes.componentsById` — it is NOT a copy. Phase 5
 * selectors must treat it as read-only. Mutation is prohibited.
 *
 * Phase 4 warnings are always `[]` in a successful run. The field exists for
 * structural consistency with Phase 2/3 result types and future extension.
 *
 * Canonical: docs/06 §3.1; docs/11 §6 Phase 4.
 */
export interface CandidateSetResult {
  /**
   * The trace-ready accounting record. Placed in `registryPhase` of
   * `trace.json` by Phase 11. Contains the gap-check denominator.
   */
  summary: CandidateSetSummary;

  /**
   * The live candidate component map. Direct reference to
   * `registryResult.indexes.componentsById`. All entries are valid and
   * non-quarantined (guaranteed by Phase 2).
   *
   * Phase 5 selectors iterate this map for fan-out. They must not mutate it.
   */
  candidatesById: Map<string, Component>;

  /**
   * Phase 4 warnings. Always `[]` in a successful MVP run.
   * Fatal conditions (e.g. unsupported_candidate_set_policy) throw
   * CandidateSetFatalError before this is returned — they never appear here.
   */
  warnings: PlanningWarning[];
}
