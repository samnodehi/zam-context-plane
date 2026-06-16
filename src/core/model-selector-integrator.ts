/**
 * Phase P6: Model-Assisted Selector Integrator. [FUTURE-ONLY]
 *
 * Converts pre-generated ModelSelectorOutput records (representing proposals
 * from model-assisted selectors) into SelectionDecision + TraceEntry records
 * that can be merged into the post-gate decision set before the Conflict Resolver.
 *
 * WHAT THIS MODULE DOES:
 *   - Accepts an array of ModelSelectorOutput records and the loaded candidatesById map.
 *   - For each ProposalDecision in each ModelSelectorOutput.proposals:
 *     - Looks up the componentId in the registry candidate set.
 *     - Validates that the component exists and is not quarantined.
 *     - Applies the fail-open override: low-confidence 'omit'/'defer' proposals
 *       are overridden to 'include' / path: 'fail_open' per docs/19 §6 Prohibition 4.
 *     - Produces a synthetic SelectionDecision for the Conflict Resolver.
 *     - Produces a companion TraceEntry for the trace.
 *   - Returns ModelSelectorIntegratorResult with decisions, traceEntries, and warnings.
 *
 * WHAT THIS MODULE DOES NOT DO:
 *   - It does NOT call any LLM or model provider.
 *   - It does NOT bypass deterministic guardrails. All decisions enter the Conflict
 *     Resolver (Priority P0–P4) which takes precedence.
 *   - It does NOT alter the Conflict Resolver logic.
 *   - It does NOT validate or modify any MVP schemas or fixtures.
 *   - It does NOT mutate any existing decision or trace entry.
 *
 * SAFETY INVARIANTS (docs/19 §6):
 *   1. A low-confidence 'omit'/'defer' proposal MUST be overridden to 'include'
 *      (fail-open behavior). The Conflict Resolver then determines the final outcome.
 *   2. A missing componentId (not in candidatesById) is skipped with a warning.
 *      These are not tracked as reference_unknown since these are advisory,
 *      not from selector fan-out.
 *   3. All proposals with action 'omit'/'defer' must have non-empty evidence[];
 *      if evidence is empty, override to include/fail_open per docs/19 §6.
 *   4. model proposals enter as Priority 5 advisory inputs ONLY —
 *      Priorities 0–4 always take precedence in the Conflict Resolver.
 *
 * PATH CHOICE:
 *   For fail-open overrides, path is 'fail_open' (matches analyzer-integrator pattern).
 *   For other proposals, path is preserved from the ProposalDecision record.
 *
 * SELECTOR FIELD:
 *   TraceEntry.selector must be 'deterministic' per the current TS type
 *   (model-assisted selector types are future-only). The selectorName field
 *   from ModelSelectorOutput.selectorName distinguishes these entries for audit.
 *
 * Canonical: docs/19_MODEL_ASSISTED_SELECTOR_SCOPING.md §8, §6;
 *            docs/04_PORTABLE_CORE_ARCHITECTURE.md §7.3;
 *            docs/06_SELECTOR_ORCHESTRATION_SPEC.md §4, §11.4.
 */

import { randomUUID } from 'node:crypto';
import type { ModelSelectorOutput, ProposalDecision } from '../types/model-selector.js';
import type { SelectionDecision, TraceEntry } from '../types/selection.js';
import type { Component } from '../types/registry.js';
import type { PlanningWarning } from '../types/warnings.js';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/**
 * The result of integrateModelSelectorOutputs().
 *
 * decisions:        Synthetic SelectionDecision records — one per valid proposal.
 * traceEntries:     Companion TraceEntry records — one per decision.
 * skippedProposals: ComponentIds that had no registry match and were skipped.
 * warnings:         Planning warnings emitted (e.g. unknown component, fail-open override).
 */
export interface ModelSelectorIntegratorResult {
  decisions: SelectionDecision[];
  traceEntries: TraceEntry[];
  skippedProposals: string[];
  warnings: PlanningWarning[];
}

// ---------------------------------------------------------------------------
// Fail-open override logic
// ---------------------------------------------------------------------------

/**
 * Determine whether a proposal should be overridden to fail-open (include).
 *
 * Per docs/19 §6 Prohibition 4:
 *   Low-confidence proposals must trigger fail-open inclusion, not omission.
 *
 * Additionally, 'omit' or 'defer' proposals with empty evidence[] are
 * overridden to prevent unsubstantiated omissions.
 *
 * Canonical: docs/19 §6; src/core/analyzer-integrator.ts (precedent).
 */
function shouldOverrideToFailOpen(proposal: ProposalDecision): boolean {
  // Low confidence on any omit/defer → fail-open
  if (proposal.confidence === 'low' && (proposal.action === 'omit' || proposal.action === 'defer')) {
    return true;
  }
  // Empty evidence on omit/defer → fail-open (per docs/19 §8: must be non-empty)
  if ((proposal.action === 'omit' || proposal.action === 'defer') && proposal.evidence.length === 0) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main integrator function
// ---------------------------------------------------------------------------

/**
 * Convert pre-generated ModelSelectorOutput records into synthetic
 * SelectionDecision + TraceEntry records that can enter the Conflict Resolver.
 *
 * @param selectorOutputs  Array of AJV-validated ModelSelectorOutput objects.
 * @param candidatesById   The non-quarantined component map from Phase 4.
 * @returns                ModelSelectorIntegratorResult with decisions, trace, warnings.
 */
export function integrateModelSelectorOutputs(
  selectorOutputs: ModelSelectorOutput[],
  candidatesById: Map<string, Component>,
): ModelSelectorIntegratorResult {
  const decisions: SelectionDecision[] = [];
  const traceEntries: TraceEntry[] = [];
  const skippedProposals: string[] = [];
  const warnings: PlanningWarning[] = [];

  for (const selectorOutput of selectorOutputs) {
    const { selectorName, proposals } = selectorOutput;

    for (const proposal of proposals) {
      const comp = candidatesById.get(proposal.componentId);

      if (comp === undefined) {
        // Component not found in the non-quarantined candidate set.
        // Skip silently (advisory proposals, not selector fan-out unknowns)
        // but record in skippedProposals and emit a warning.
        skippedProposals.push(proposal.componentId);
        warnings.push({
          code: 'model_selector_component_not_found',
          message:
            `Model-assisted selector '${selectorName}' proposed component ` +
            `'${proposal.componentId}' but it was not found in the registry candidate set. ` +
            `Proposal skipped. (selectorName: ${selectorName})`,
        });
        continue;
      }

      // Build a unique trace entry ID for bi-directional linking.
      const decisionId = randomUUID();

      // Determine effective action and path.
      // Apply fail-open override if required (docs/19 §6 Prohibition 4).
      const failOpenOverride = shouldOverrideToFailOpen(proposal);
      const effectiveAction: 'include' | 'omit' | 'defer' | 'reference_unknown' = failOpenOverride
        ? 'include'
        : proposal.action;
      const effectivePath: SelectionDecision['path'] = failOpenOverride
        ? 'fail_open'
        : (proposal.path as SelectionDecision['path']);
      const effectiveConfidence: 'high' | 'medium' | 'low' = proposal.confidence;

      if (failOpenOverride) {
        warnings.push({
          code: 'model_selector_fail_open_override',
          message:
            `Model-assisted selector '${selectorName}' proposal for component ` +
            `'${proposal.componentId}' overridden to include/fail_open ` +
            `(low confidence or empty evidence on omit/defer). ` +
            `Canonical: docs/19 §6 Prohibition 4.`,
        });
      }

      // Build evidence atoms from the proposal + component context.
      const evidence: string[] = [
        `selectorName=${selectorName}`,
        `proposedAction=${proposal.action}`,
        `proposedPath=${proposal.path}`,
        `proposedConfidence=${proposal.confidence}`,
        `componentId=${comp.id}`,
        `componentType=${comp.type}`,
        `riskLevel=${comp.riskLevel}`,
        ...(failOpenOverride ? ['failOpenOverride=true'] : []),
        ...proposal.evidence,
      ];

      // Synthetic SelectionDecision.
      // selectorName: from ModelSelectorOutput.selectorName — identifies the source.
      // action/path: effective values (after fail-open override if applicable).
      // The Conflict Resolver's deterministic priority ladder (P0–P4) takes
      // precedence. Model proposals slot in at Priority 5 only (docs/19 §5).
      const decision: SelectionDecision = {
        componentId: comp.id,
        selectorName,
        action: effectiveAction,
        reason:
          failOpenOverride
            ? `Model-assisted selector '${selectorName}' proposal overridden to include ` +
              `(fail-open: low confidence or empty evidence on omit/defer). ` +
              `Original proposal: action=${proposal.action}, confidence=${proposal.confidence}. ` +
              `Advisory — subject to deterministic guardrail override.`
            : `Proposed by model-assisted selector '${selectorName}'. ` +
              `${proposal.reason} Advisory — subject to deterministic guardrail override.`,
        path: effectivePath,
        confidence: effectiveConfidence,
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
        module: 'ModelAssistedSelector',
        action: effectiveAction,
        reason: decision.reason,
        evidence,
        confidence: effectiveConfidence,
        risk: comp.riskLevel,
        estimatedSavings: { tokens: 0 },
        failOpen: failOpenOverride || effectivePath === 'fail_open',
        selector: 'deterministic', // required by TraceEntry type in MVP
      };

      decisions.push(decision);
      traceEntries.push(traceEntry);
    }
  }

  return { decisions, traceEntries, skippedProposals, warnings };
}
