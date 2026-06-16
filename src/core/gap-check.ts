/**
 * Phase 6: Gap-check and synthetic not_evaluated decisions.
 *
 * After selector fan-out (Phase 5), the orchestrator must verify that every
 * non-quarantined candidate component received at least one SelectionDecision.
 * Any candidate that was silently skipped — a planning boundary violation — gets
 * a synthetic fail-open include decision injected here.
 *
 * What this module does:
 *   - Builds a covered-ID set from Phase 5 decisions (excluding reference_unknown).
 *   - Iterates candidatesById; any ID absent from covered-ID set is a gap.
 *   - For each gap: produces a synthetic SelectionDecision + TraceEntry + PlanningWarning.
 *   - Returns GapCheckResult (no mutation of inputs).
 *
 * What this module does NOT do:
 *   - No injection gate (Phase 7).
 *   - No conflict resolution (Phase 8).
 *   - No budgeter (Phase 9).
 *   - No output file writes.
 *   - No provider/model/network/OpenClaw calls.
 *   - No mutation of SelectorFanOutResult or CandidateSetResult.
 *
 * Denominator: candidateSetResult.candidatesById.size
 *   (= candidateSetSummary.candidateSetSize enforced by Phase 4).
 *   Never hard-coded. Never the full registry count.
 *
 * Canonical: docs/06 §3.1 (gap-check requirement); docs/06 §4 (not_evaluated path);
 *            docs/11 §6 Phase 6.
 */

import { randomUUID } from 'node:crypto';
import type { SelectionDecision, TraceEntry, SelectorFanOutResult } from '../types/selection.js';
import type { CandidateSetResult } from '../types/candidate.js';
import type { PlanningWarning } from '../types/warnings.js';

// ---------------------------------------------------------------------------
// GapCheckResult
// ---------------------------------------------------------------------------

/**
 * The output of runGapCheck().
 *
 * Synthetic decisions and trace entries must be merged into the Phase 5
 * fan-out result by the caller (plan.ts). After merging, the caller must
 * recompute selectorSummary via computeSelectorSummary() to reflect the
 * additional not_evaluated decisions in decidedInclude and failOpenInclude.
 */
export interface GapCheckResult {
  /** Synthetic SelectionDecision records — one per gap component. */
  syntheticDecisions: SelectionDecision[];
  /** Companion TraceEntry records — one per synthetic decision. */
  syntheticTraceEntries: TraceEntry[];
  /**
   * Planning warnings — one PlanningWarning per gap.
   * code: 'not_evaluated'. Printed to stderr by plan.ts.
   */
  warnings: PlanningWarning[];
  /** Count of gap components detected. 0 in correct operation. */
  gapCount: number;
}

// ---------------------------------------------------------------------------
// runGapCheck — main export
// ---------------------------------------------------------------------------

/**
 * Run the Phase 6 gap-check pass.
 *
 * Detects any candidate component that received no SelectionDecision from
 * Phase 5 selector fan-out and injects a synthetic fail-open include decision
 * for each gap.
 *
 * @param fanOutResult    - Phase 5 output (read-only; not mutated).
 * @param candidateSetResult - Phase 4 output; provides the authoritative
 *                         candidate set and component metadata for risk fields.
 * @returns GapCheckResult — synthetic decisions, trace entries, warnings, count.
 *
 * Canonical: docs/06 §3.1; docs/06 §4 path: not_evaluated; docs/11 §6 Phase 6.
 */
export function runGapCheck(
  fanOutResult: SelectorFanOutResult,
  candidateSetResult: CandidateSetResult,
): GapCheckResult {
  // -------------------------------------------------------------------------
  // Step 1 — Build covered-ID set from Phase 5 decisions.
  // -------------------------------------------------------------------------
  // Exclude reference_unknown decisions: their componentId values are
  // caller-supplied unknown strings, not validated registry IDs. Including them
  // in the covered set could mask a real gap if a candidate's ID happened to
  // match an unknown-reference string.
  // Canonical: docs/06 §4 key rules (reference_unknown is a distinct class).
  const coveredIds = new Set<string>();
  for (const decision of fanOutResult.decisions) {
    if (decision.action !== 'reference_unknown') {
      coveredIds.add(decision.componentId);
    }
  }

  // -------------------------------------------------------------------------
  // Step 2 — Detect gaps and produce synthetic outputs.
  // -------------------------------------------------------------------------
  const syntheticDecisions: SelectionDecision[] = [];
  const syntheticTraceEntries: TraceEntry[] = [];
  const warnings: PlanningWarning[] = [];

  for (const [id, component] of candidateSetResult.candidatesById) {
    if (coveredIds.has(id)) {
      // Component received at least one SelectionDecision from Phase 5 — no gap.
      continue;
    }

    // Gap detected: this component was silently skipped by all selectors.
    // This is a planning boundary defect — should never happen in correct
    // MVP operation. Fail-open include is the mandatory safe outcome.
    const decisionId = randomUUID();
    const reason =
      `Component "${id}" was not evaluated by any selector. ` +
      `Synthetic fail-open include applied by gap-check.`;
    const evidence: string[] = [
      'gap_check=true',
      'no_selector_evaluated_this_component',
    ];

    const decision: SelectionDecision = {
      componentId: id,
      selectorName: 'gap_check',
      action: 'include',
      reason,
      path: 'not_evaluated',
      confidence: 'low',
      evidence,
      constraintsApplied: [],
      // Per-decision warning code: 'not_evaluated'.
      // Coexists with the planning-level PlanningWarning below.
      warnings: ['not_evaluated'],
      traceRefs: [decisionId],
    };

    const traceEntry: TraceEntry = {
      decisionId,
      componentId: id,
      module: 'GapCheck',
      action: 'include',
      reason,
      evidence,
      confidence: 'low',
      // risk taken from candidate component metadata, not hardcoded.
      risk: component.riskLevel,
      estimatedSavings: { tokens: 0 },
      failOpen: true,
      selector: 'deterministic',
    };

    // Planning-level warning — one per gap.
    // code: 'not_evaluated' (exactly — not 'not_evaluated_component').
    const warning: PlanningWarning = {
      code: 'not_evaluated',
      message:
        `Component "${id}" was not evaluated by any selector. ` +
        `Synthetic fail-open include applied.`,
      context: { componentId: id },
    };

    syntheticDecisions.push(decision);
    syntheticTraceEntries.push(traceEntry);
    warnings.push(warning);
  }

  return {
    syntheticDecisions,
    syntheticTraceEntries,
    warnings,
    gapCount: syntheticDecisions.length,
  };
}
