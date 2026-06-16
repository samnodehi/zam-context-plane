/**
 * Phase P10: Request Analyzer Integrator. [FUTURE-ONLY]
 *
 * Converts a pre-generated AnalyzerOutput (representing proposals from a
 * model-assisted Request Analyzer) into SelectionDecision + TraceEntry records
 * that can be merged into the post-gate decision set before the Conflict Resolver.
 *
 * WHAT THIS MODULE DOES:
 *   - Accepts an AnalyzerOutput and the loaded candidatesById map.
 *   - For each lane string in AnalyzerOutput.neededLanes, looks up matching
 *     components in the registry (treated as exact componentId matches in MVP).
 *   - Produces a synthetic SelectionDecision (action: include, path: fail_open,
 *     selectorName: 'model_assisted_analyzer') for each matched component.
 *   - Produces a companion TraceEntry for each decision.
 *   - Returns AnalyzerIntegratorResult with decisions, traceEntries, and
 *     diagnostic info.
 *
 * WHAT THIS MODULE DOES NOT DO:
 *   - It does NOT call any LLM or model provider.
 *   - It does NOT bypass deterministic guardrails.
 *   - It does NOT alter the Conflict Resolver logic.
 *   - It does NOT validate or modify any MVP schemas or fixtures.
 *   - It does NOT mutate any existing decision or trace entry.
 *   - It does NOT implement model-assisted confidence calibration.
 *
 * SAFETY INVARIANT:
 *   All synthetic decisions produced here use action: 'include' and path: 'fail_open'.
 *   They enter the Conflict Resolver as ordinary advisory inputs. The deterministic
 *   priority ladder (P0–P4, docs/06 §11.4) always takes precedence over advisory
 *   include proposals. Specifically:
 *     - P0 (tool unavailability) — overrides any include proposal.
 *     - P1 (safety hard protection) — overrides any omit; these proposals are include,
 *       so P1 reinforces the existing include direction.
 *     - P2–P4 (user/registry/history constraints) — may override or reinforce.
 *
 *   If the analyzer proposes a lane that is NOT found in the registry, it is
 *   silently skipped (unknown reference, not tracked as reference_unknown since
 *   these are advisory, not from selector fan-out). A warning is emitted.
 *
 * PATH CHOICE:
 *   Model-proposed decisions use path: 'fail_open' because:
 *   (a) 'fail_open' semantically means "include because uncertain / advisory" —
 *       which correctly describes an unverified model proposal.
 *   (b) No new SelectionPath enum value (e.g. 'model_proposal') may be added
 *       to the closed MVP enum without an explicit schema decision pass
 *       (enums.shared.schema.json; SelectionPath is a closed 12-value enum).
 *   (c) Using 'fail_open' allows Case 5 (multiple includes) and other Conflict
 *       Resolver paths to function correctly without modification.
 *
 * SELECTOR FIELD:
 *   TraceEntry.selector must be 'deterministic' per the current TS type
 *   (model-assisted selector types are future-only). The selectorName field
 *   'model_assisted_analyzer' distinguishes these entries from actual
 *   deterministic ladder decisions for audit purposes.
 *
 * Canonical: docs/15_REQUEST_ANALYZER_SCHEMA_SCOPING.md;
 *            docs/04_PORTABLE_CORE_ARCHITECTURE.md §7.3;
 *            docs/06_SELECTOR_ORCHESTRATION_SPEC.MD §4, §11.4.
 */

import { randomUUID } from 'node:crypto';
import type { AnalyzerOutput } from '../types/analyzer.js';
import type { SelectionDecision, TraceEntry } from '../types/selection.js';
import type { Component } from '../types/registry.js';
import type { PlanningWarning } from '../types/warnings.js';
import type { AnalyzerPhase } from '../types/trace.js';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/**
 * The result of integrateAnalyzerOutput().
 *
 * decisions:     Synthetic SelectionDecision records — one per matched lane.
 * traceEntries:  Companion TraceEntry records — one per decision.
 * skippedLanes:  Lane strings from neededLanes that had no registry match.
 * warnings:      Planning warnings emitted (e.g. skipped lane warnings).
 */
export interface AnalyzerIntegratorResult {
  decisions: SelectionDecision[];
  traceEntries: TraceEntry[];
  skippedLanes: string[];
  warnings: PlanningWarning[];
  /** [FUTURE-ONLY] Assembled AnalyzerPhase trace for conditional trace.json emission. */
  analyzerPhase: AnalyzerPhase;
}

// ---------------------------------------------------------------------------
// Confidence mapping
// ---------------------------------------------------------------------------

/**
 * Map analyzerConfidence (float 0.0–1.0) to SelectionDecision confidence enum.
 *
 * Thresholds mirror the canonical tier thresholds in docs/15 §5:
 *   >= 0.85 → high
 *   >= 0.60 → medium
 *   < 0.60  → low (fail-open triggered at this level)
 *
 * NOTE: A low-confidence omit is invalid in MVP. Since all proposals here are
 * action: include, all confidence levels are valid.
 *
 * Canonical: docs/15 §5 (confidence thresholds, illustrative [FUTURE-ONLY]).
 */
function mapConfidence(analyzerConfidence: number): 'high' | 'medium' | 'low' {
  if (analyzerConfidence >= 0.85) return 'high';
  if (analyzerConfidence >= 0.60) return 'medium';
  return 'low';
}

// ---------------------------------------------------------------------------
// Main integrator function
// ---------------------------------------------------------------------------

/**
 * Convert a pre-generated AnalyzerOutput into synthetic SelectionDecision +
 * TraceEntry records that can enter the Conflict Resolver pipeline.
 *
 * @param analyzerOutput  The AJV-validated AnalyzerOutput object.
 * @param candidatesById  The non-quarantined component map from Phase 4.
 * @returns               AnalyzerIntegratorResult with decisions, trace, and warnings.
 */
export function integrateAnalyzerOutput(
  analyzerOutput: AnalyzerOutput,
  candidatesById: Map<string, Component>,
): AnalyzerIntegratorResult {
  const decisions: SelectionDecision[] = [];
  const traceEntries: TraceEntry[] = [];
  const skippedLanes: string[] = [];
  const warnings: PlanningWarning[] = [];

  const confidence = mapConfidence(analyzerOutput.analyzerConfidence);

  // Build evidence atoms for trace auditability.
  // Include key AnalyzerOutput fields as coded atoms (no raw content).
  const baseEvidence: string[] = [
    `analyzerVersion=${analyzerOutput.analyzerVersion}`,
    `tier=${analyzerOutput.tier}`,
    `promptFamily=${analyzerOutput.promptFamily}`,
    `analyzerConfidence=${analyzerOutput.analyzerConfidence}`,
    `assessedRequestRiskLevel=${analyzerOutput.assessedRequestRiskLevel}`,
    `failOpenTriggered=${analyzerOutput.failOpenTriggered}`,
    `analyzerTraceId=${analyzerOutput.analyzerTraceId}`,
  ];

  if (analyzerOutput.failOpenReason !== null) {
    baseEvidence.push(`failOpenReason=${analyzerOutput.failOpenReason}`);
  }

  // Emit a warning if the analyzer triggered fail-open (for run-level visibility).
  if (analyzerOutput.failOpenTriggered) {
    warnings.push({
      code: 'analyzer_fail_open_triggered',
      message:
        `Model-assisted analyzer (version: ${analyzerOutput.analyzerVersion}) triggered fail-open` +
        (analyzerOutput.failOpenReason !== null
          ? `: ${analyzerOutput.failOpenReason}`
          : '. All proposed lanes included as advisory inputs.'),
    });
  }

  // Process each proposed lane.
  for (const lane of analyzerOutput.neededLanes) {
    const comp = candidatesById.get(lane);

    if (comp === undefined) {
      // Lane string does not match any non-quarantined component ID.
      // Skip silently (advisory proposals, not selector fan-out unknowns)
      // but record in skippedLanes and emit a warning for operator visibility.
      skippedLanes.push(lane);
      warnings.push({
        code: 'analyzer_lane_not_found',
        message:
          `Model-assisted analyzer proposed lane '${lane}' but no matching component was found in ` +
          `the registry candidate set. Lane skipped. ` +
          `(analyzerVersion: ${analyzerOutput.analyzerVersion})`,
      });
      continue;
    }

    // Build a unique trace entry ID for bi-directional linking.
    const decisionId = randomUUID();

    // Construct the evidence array for this specific component.
    const evidence: string[] = [
      ...baseEvidence,
      `proposedLane=${lane}`,
      `componentId=${comp.id}`,
      `componentType=${comp.type}`,
      `riskLevel=${comp.riskLevel}`,
    ];

    // Synthetic SelectionDecision.
    // action: 'include' — the analyzer is proposing to include this lane.
    // path: 'fail_open' — "include because uncertain / advisory" (no model_proposal enum in MVP).
    // selectorName: 'model_assisted_analyzer' — identifies the source for audit.
    const decision: SelectionDecision = {
      componentId: comp.id,
      selectorName: 'model_assisted_analyzer',
      action: 'include',
      reason:
        `Proposed by model-assisted request analyzer (version: ${analyzerOutput.analyzerVersion}). ` +
        `Tier: ${analyzerOutput.tier}. Advisory — subject to deterministic guardrail override.`,
      path: 'fail_open',
      confidence,
      evidence,
      constraintsApplied: [],
      warnings: [],
      traceRefs: [decisionId],
    };

    // Companion TraceEntry.
    // selector: 'deterministic' — required by current TS type (model-assisted is future-only).
    // selectorName distinguishes this from actual deterministic ladder decisions.
    const traceEntry: TraceEntry = {
      decisionId,
      componentId: comp.id,
      module: 'ModelAssistedAnalyzer',
      action: 'include',
      reason: decision.reason,
      evidence,
      confidence,
      risk: comp.riskLevel,
      estimatedSavings: { tokens: 0 },
      failOpen: true,  // path: fail_open → failOpen: true
      selector: 'deterministic',  // required by TraceEntry type in MVP
    };

    decisions.push(decision);
    traceEntries.push(traceEntry);
  }

  // -------------------------------------------------------------------------
  // Construct AnalyzerPhase trace object.
  //
  // This maps directly from the AnalyzerOutput fields to the 9 required fields
  // in schemas/outputs/trace.schema.json analyzerPhase. No field transformation
  // is needed — the analyzer output already contains the exact data.
  // -------------------------------------------------------------------------
  const analyzerPhase: AnalyzerPhase = {
    analyzerVersion: analyzerOutput.analyzerVersion,
    tier: analyzerOutput.tier,
    promptFamily: analyzerOutput.promptFamily,
    analyzerConfidence: analyzerOutput.analyzerConfidence,
    proposedLanes: analyzerOutput.neededLanes,
    failOpenTriggered: analyzerOutput.failOpenTriggered,
    failOpenReason: analyzerOutput.failOpenReason,
    evidence: analyzerOutput.evidence,
    analyzerTraceId: analyzerOutput.analyzerTraceId,
  };

  return { decisions, traceEntries, skippedLanes, warnings, analyzerPhase };
}
