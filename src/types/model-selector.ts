/**
 * Phase P6 (Phase 6): TypeScript interfaces for ModelSelectorOutput. [FUTURE-ONLY]
 *
 * Mirrors schemas/future/model-selector-output.schema.json exactly.
 *
 * ISOLATION INVARIANTS:
 *   - These types are used only by src/core/model-selector-integrator.ts and
 *     the HTTP body-mapper / plan route handler.
 *   - They are NOT used by any MVP pipeline module.
 *   - ModelSelectorOutput does NOT extend or modify any MVP type
 *     (SelectionDecision, RequestSignals, LoadedInputs, etc.).
 *   - No field from this type may be added to any MVP schema without
 *     a separate explicit schema decision pass.
 *   - OQ-2 from docs/19 is resolved here: model proposals use a SEPARATE
 *     ProposalDecision shape (not SelectionDecision). The Orchestrator
 *     (model-selector-integrator.ts) converts ProposalDecision → SelectionDecision
 *     before passing to the Conflict Resolver.
 *
 * Canonical: docs/19_MODEL_ASSISTED_SELECTOR_SCOPING.md §8;
 *            schemas/future/model-selector-output.schema.json.
 */

/**
 * One ProposalDecision record per component evaluated by the model-assisted selector.
 *
 * [FUTURE-ONLY] — does not participate in any MVP planning phase.
 * Enters the pipeline as advisory input only, through the selector integrator.
 *
 * Canonical: docs/19 §8; schemas/future/model-selector-output.schema.json#proposals.
 */
export interface ProposalDecision {
  /**
   * The registry component ID this proposal applies to.
   * Must match a known, non-quarantined component in the candidate set.
   * Quarantined components never reach any selector (docs/19 §6 Prohibition 6).
   * Canonical: docs/19 §6; docs/06 §4.
   */
  componentId: string;

  /**
   * The model's proposed action for this component.
   * Inline enum — values identical to SelectionAction (docs/06 §4).
   * A model-proposed 'omit' for a safety-critical, never-omit, or
   * alwaysInclude component is unconditionally defeated by Priorities 1–2
   * of the Conflict Resolver.
   * Canonical: docs/19 §5; docs/06 §4.
   */
  action: 'include' | 'omit' | 'defer' | 'reference_unknown';

  /**
   * Model confidence in this proposal.
   * Inline enum — values identical to SelectionConfidence (docs/06 §4).
   * Low confidence triggers fail-open expansion (include) in the integrator.
   * Canonical: docs/19 §6 Prohibition 4; docs/06 §4.
   */
  confidence: 'high' | 'medium' | 'low';

  /**
   * Human-readable rationale for this proposal.
   * Must not contain raw component content, raw history turn content,
   * or raw user message text.
   * Canonical: docs/13 §12; docs/06 §4.
   */
  reason: string;

  /**
   * Structured signal atoms that justify this proposal.
   * Must be non-empty for any 'omit' or 'defer' proposal.
   * Evidence items are coded atoms — must not contain raw content.
   * Canonical: docs/13 §12; docs/06 §4.
   */
  evidence: string[];

  /**
   * The decision ladder path the model used to produce this proposal.
   * Inline enum — values identical to SelectionPath (docs/06 §4).
   * Must be consistent with the action value.
   * Canonical: docs/19 §8; docs/06 §4.
   */
  path:
    | 'required_match'
    | 'safe_to_omit_match'
    | 'default_action_omit'
    | 'default_include'
    | 'default_defer'
    | 'fail_open'
    | 'conflict_include'
    | 'safety_override'
    | 'runtime_unavailable'
    | 'not_evaluated'
    | 'reference_unknown'
    | 'quarantine_boundary_violation';
}

/**
 * Structured output produced by a model-assisted selector during Phase 6 fan-out.
 *
 * [FUTURE-ONLY] — does not participate in any MVP planning phase.
 * This is intentionally separate from SelectionDecision (docs/19 §8; OQ-2 resolution):
 * SelectionDecision contains orchestrator-owned fields (traceRefs, constraintsApplied,
 * budgetHint, etc.) that a model must never generate.
 *
 * The Orchestrator (model-selector-integrator.ts) converts ProposalDecision records
 * into SelectionDecision records before passing them to the Conflict Resolver.
 *
 * Canonical: docs/19_MODEL_ASSISTED_SELECTOR_SCOPING.md §8;
 *            schemas/future/model-selector-output.schema.json.
 */
export interface ModelSelectorOutput {
  /**
   * Name identifying the model-assisted selector that produced this output.
   * Must use the naming convention 'model_assisted_<scope>' from docs/19 §9.
   * Canonical: docs/19 §9; docs/13 §16.
   */
  selectorName: string;

  /**
   * Array of ProposalDecision records — one per component evaluated.
   * May be empty if the model evaluated no components.
   * Canonical: docs/19 §8; docs/13 §12.
   */
  proposals: ProposalDecision[];
}
