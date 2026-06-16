/**
 * Phase 5: Deterministic decision ladder.
 *
 * Implements the 12-step ladder defined in docs/06 §8. Shared by all 8 selector
 * types. Each selector calls runLadder() with its component, orchestrator inputs,
 * and selector-specific configuration.
 *
 * What this module does:
 *   - Applies Steps 1–12 in order; returns on first match.
 *   - Evaluates evidenceRequired expressions (AND-only; OR/NOT not supported in MVP).
 *   - Respects selector-specific positive include signals (active ID sets).
 *   - Produces a SelectionDecision + TraceEntry pair per component.
 *
 * What this module does NOT do:
 *   - No gap-check (Phase 6).
 *   - No injection gate (Phase 7).
 *   - No conflict resolution (Phase 8).
 *   - No budget enforcement or hints (Phase 9).
 *   - No file writes, network calls, or provider/model calls.
 *   - No active_id_unknown re-emission (Phase 3 already handled).
 *   - No OR/NOT/parentheses support in evidenceRequired.
 *
 * Canonical: docs/06 §8; docs/05 §7; docs/11 §6 Phase 5.
 */

import { randomUUID } from 'node:crypto';
import type { Component } from '../types/registry.js';
import type { NormalizedInputs } from '../types/normalized.js';
import type { SelectionDecision, TraceEntry } from '../types/selection.js';

// ---------------------------------------------------------------------------
// LadderInputs
// ---------------------------------------------------------------------------

/**
 * Inputs to the deterministic ladder for a single component evaluation.
 *
 * The ladder receives pre-extracted fields to avoid re-reading normalized
 * inputs multiple times. All active ID sets are pre-resolved by the
 * selector before calling runLadder().
 */
export interface LadderInputs {
  /** Current prompt family (e.g. 'general_default'). */
  promptFamily: string;
  /**
   * Selector-specific active ID set.
   * - Skill selector: requestSignals.activeSkillIds
   * - Tool selector: requestSignals.activeToolIds
   * - Memory selector: requestSignals.activeMemoryIds
   * - All other selectors: empty set
   */
  activeIdSet: Set<string>;
  /** Active ID trace atom (e.g. 'active_skill_id_match'). null for non-ID selectors. */
  activeIdAtom: string | null;
  /** alwaysInclude constraint list. Empty array when constraints are null. */
  alwaysInclude: string[];
  /** neverInclude constraint list. Empty array when constraints are null. */
  neverInclude: string[];
  /** IDs of quarantined components (for Step 1 boundary check). */
  quarantinedIds: Set<string>;
  /** The selector's canonical name (e.g. 'deterministic_scaffold'). */
  selectorName: string;
  /** The selector's module name for TraceEntry.module (e.g. 'ScaffoldSelector'). */
  moduleName: string;
}

// ---------------------------------------------------------------------------
// LadderResult
// ---------------------------------------------------------------------------

/** The result of one ladder evaluation: a decision + its companion trace entry. */
export interface LadderResult {
  decision: SelectionDecision;
  traceEntry: TraceEntry;
}

// ---------------------------------------------------------------------------
// evidenceRequired evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate the component's evidenceRequired expression against current signals.
 *
 * MVP grammar: atoms joined by ' AND '. OR, NOT, and parentheses are not supported.
 * Recognized atoms (docs/05 §7):
 *   promptFamily=<value>
 *   riskLevel=<value>
 *   explicitUserConstraint=false
 *
 * Returns:
 *   'satisfied'       — null or all atoms pass
 *   'unsatisfied'     — at least one atom fails
 *   'path_a_disabled' — unrecognized grammar (invalid atom or Phase 2 flag set)
 *
 * Emits 'path_a_null_evidence' per-decision warning when evidenceRequired is null.
 *
 * Canonical: docs/05 §7; docs/06 §8 Step 7.
 */
export function evaluateEvidenceRequired(
  component: Component,
  promptFamily: string,
  alwaysInclude: string[],
  neverInclude: string[],
): { result: 'satisfied' | 'unsatisfied' | 'path_a_disabled'; nullEvidence: boolean } {
  const { evidenceRequired, evidenceRequiredGrammarInvalid } = component;

  // Phase 2 already flagged invalid grammar.
  if (evidenceRequiredGrammarInvalid === true) {
    return { result: 'path_a_disabled', nullEvidence: false };
  }

  // null → no additional expression required; Path A condition 2 is satisfied.
  if (evidenceRequired === null) {
    return { result: 'satisfied', nullEvidence: true };
  }

  // Split on ' AND ' to get atom tokens.
  const atoms = evidenceRequired.split(' AND ');
  for (const rawAtom of atoms) {
    const atom = rawAtom.trim();

    if (atom.startsWith('promptFamily=')) {
      const value = atom.slice('promptFamily='.length);
      if (promptFamily !== value) return { result: 'unsatisfied', nullEvidence: false };
      continue;
    }

    if (atom.startsWith('riskLevel=')) {
      const value = atom.slice('riskLevel='.length);
      if (component.riskLevel !== value) return { result: 'unsatisfied', nullEvidence: false };
      continue;
    }

    if (atom === 'explicitUserConstraint=false') {
      const allConstrainedIds = [...alwaysInclude, ...neverInclude];
      if (allConstrainedIds.includes(component.id)) {
        return { result: 'unsatisfied', nullEvidence: false };
      }
      continue;
    }

    // Unrecognized atom — disable Path A.
    // (Should not reach here if Phase 2 set evidenceRequiredGrammarInvalid correctly,
    //  but guarded defensively.)
    return { result: 'path_a_disabled', nullEvidence: false };
  }

  return { result: 'satisfied', nullEvidence: false };
}

// ---------------------------------------------------------------------------
// makeDecisionAndTrace helpers
// ---------------------------------------------------------------------------

function makeDecisionAndTrace(
  component: Component,
  inputs: LadderInputs,
  action: SelectionDecision['action'],
  path: SelectionDecision['path'],
  confidence: SelectionDecision['confidence'],
  reason: string,
  evidence: string[],
  constraintsApplied: string[],
  perDecisionWarnings: string[],
  failOpen: boolean,
  estimatedSavingsTokens: number,
): LadderResult {
  const decisionId = randomUUID();

  const decision: SelectionDecision = {
    componentId: component.id,
    selectorName: inputs.selectorName,
    action,
    reason,
    path,
    confidence,
    evidence,
    constraintsApplied,
    warnings: perDecisionWarnings,
    traceRefs: [decisionId],
  };

  const traceEntry: TraceEntry = {
    decisionId,
    componentId: component.id,
    module: inputs.moduleName,
    action,
    reason,
    evidence,
    confidence,
    risk: component.riskLevel,
    estimatedSavings: { tokens: estimatedSavingsTokens },
    failOpen,
    selector: 'deterministic',
  };

  return { decision, traceEntry };
}

// ---------------------------------------------------------------------------
// runLadder — main export
// ---------------------------------------------------------------------------

/**
 * Run the 12-step deterministic decision ladder for a single component.
 *
 * Steps are applied in order; evaluation stops at the first matching step.
 * Returns a SelectionDecision + TraceEntry pair.
 *
 * Pre-condition: component is confirmed present in candidatesById (the orchestrator
 * checks this before dispatching to selectors).
 *
 * Canonical: docs/06 §8.
 */
export function runLadder(component: Component, inputs: LadderInputs): LadderResult {
  const promptFamily = inputs.promptFamily;
  const activeIdSet = inputs.activeIdSet;
  const activeIdAtom = inputs.activeIdAtom;
  const alwaysInclude = inputs.alwaysInclude;
  // -------------------------------------------------------------------------
  // Step 1 — Quarantine Boundary Violation Detection
  // -------------------------------------------------------------------------
  // In correct MVP operation this never fires. Quarantined components are
  // excluded from componentsById before fan-out (Phase 2 guarantee). If a
  // quarantined ID somehow appears here, it is a core-boundary defect.
  // Note: unexpected_quarantine_reference is a planning-level warning emitted
  // by the orchestrator (selector-engine.ts). It must NOT appear in
  // SelectionDecision.warnings[]; that field is reserved for per-decision codes.
  if (inputs.quarantinedIds.has(component.id)) {
    return makeDecisionAndTrace(
      component,
      inputs,
      'include',
      'quarantine_boundary_violation',
      'low',
      `Component "${component.id}" appears in the selector candidate set but is also in quarantinedComponents. This is a planning boundary violation — the registry guarantee has been breached. Fail-open include applied.`,
      [`quarantine_boundary_violation_detected=true`, `componentId=${component.id}`],
      [],
      [],  // per-decision warnings: none (unexpected_quarantine_reference is planning-level)
      true,
      0,
    );
  }

  // -------------------------------------------------------------------------
  // Step 3 — Hard Include Protections
  // -------------------------------------------------------------------------
  // Checked before Steps 4/5 as per docs/06 §8 Step 3.
  // All four hard-protection conditions always produce path: safety_override.
  // path: required_match is NOT used here even when retainPolicy: mandatory
  // coincides with a requiredWhen match (9-Q2 resolved, Pass 4.8D).
  const hardProtectionField = getHardProtectionField(component);
  if (hardProtectionField !== null) {
    const evidenceAtoms: string[] = [`${hardProtectionField}=true`, `promptFamily=${promptFamily}`];
    // Secondary reason preservation: if requiredWhen also matched, add to evidence.
    const matchedRequired = component.requiredWhen.find((t) => t === promptFamily);
    if (matchedRequired !== undefined) {
      evidenceAtoms.push(`requiredWhen=${matchedRequired}`);
    }
    return makeDecisionAndTrace(
      component,
      inputs,
      'include',
      'safety_override',
      'high',
      `Hard include protection fired (${hardProtectionField}). Component must be included regardless of other rules.`,
      evidenceAtoms,
      [hardProtectionField],
      [],
      false,
      0,
    );
  }

  // -------------------------------------------------------------------------
  // Step 4 — Both requiredWhen AND safeToOmitWhen Match (Conflict)
  // -------------------------------------------------------------------------
  // Must be checked before Step 5 so conflicts are always traced.
  const requiredMatch = component.requiredWhen.find((t) => t === promptFamily);
  const safeOmitMatch = component.safeToOmitWhen.find((t) => t === promptFamily);

  if (requiredMatch !== undefined && safeOmitMatch !== undefined) {
    return makeDecisionAndTrace(
      component,
      inputs,
      'include',
      'conflict_include',
      'medium',
      `Both requiredWhen ("${requiredMatch}") and safeToOmitWhen ("${safeOmitMatch}") match promptFamily "${promptFamily}". Conflict resolved to include. Registry author should review component tag configuration.`,
      [
        `requiredWhen=${requiredMatch}`,
        `safeToOmitWhen=${safeOmitMatch}`,
        `promptFamily=${promptFamily}`,
        `conflict=true`,
      ],
      [],
      [],
      false,
      0,
    );
  }

  // -------------------------------------------------------------------------
  // Step 5 — requiredWhen Match
  // -------------------------------------------------------------------------
  if (requiredMatch !== undefined) {
    return makeDecisionAndTrace(
      component,
      inputs,
      'include',
      'required_match',
      'high',
      `Component is required for promptFamily "${promptFamily}" (requiredWhen match).`,
      [`requiredWhen=${requiredMatch}`, `promptFamily=${promptFamily}`],
      [],
      [],
      false,
      0,
    );
  }

  // -------------------------------------------------------------------------
  // Step 5.5 — Selector-specific Active ID positive include
  // -------------------------------------------------------------------------
  // Applies to Skill, Tool, and Memory selectors only. Other selectors pass
  // an empty activeIdSet so this step never fires for them.
  if (activeIdSet.size > 0 && activeIdSet.has(component.id)) {
    const atom = activeIdAtom ?? 'active_id_match';
    return makeDecisionAndTrace(
      component,
      inputs,
      'include',
      'required_match',
      'high',
      `Component is in the active ID set (${atom}).`,
      [atom, `promptFamily=${promptFamily}`],
      [],
      [],
      false,
      0,
    );
  }

  // -------------------------------------------------------------------------
  // Step 6 — Active User Constraint Requires Inclusion
  // -------------------------------------------------------------------------
  if (alwaysInclude.includes(component.id)) {
    return makeDecisionAndTrace(
      component,
      inputs,
      'include',
      'required_match',
      'high',
      `Component is in userConstraints.alwaysInclude.`,
      [`userConstraints.alwaysInclude`, `promptFamily=${promptFamily}`],
      [`userConstraints.alwaysInclude`],
      [],
      false,
      0,
    );
  }

  // -------------------------------------------------------------------------
  // Step 7 — Path A: Explicit Safe-Omit
  // -------------------------------------------------------------------------
  // All 7 conditions must hold. safeToOmitWhen already checked above (not in
  // requiredWhen). The active ID check gate applies for Skill/Tool/Memory selectors.
  if (
    safeOmitMatch !== undefined &&
    component.omissionPolicy === 'allow' &&
    component.retainPolicy === 'optional' &&
    (component.riskLevel === 'low' || component.riskLevel === 'medium') &&
    (activeIdSet.size === 0 || !activeIdSet.has(component.id)) // gate: not in active ID set
  ) {
    const evResult = evaluateEvidenceRequired(component, promptFamily, alwaysInclude, inputs.neverInclude);

    if (evResult.result === 'satisfied') {
      // Path A: omit
      const evidenceAtoms: string[] = [
        `safeToOmitWhen=${safeOmitMatch}`,
        `promptFamily=${promptFamily}`,
        `omissionPolicy=allow`,
      ];
      const perDecisionWarnings: string[] = [];

      if (evResult.nullEvidence) {
        evidenceAtoms.push(`evidenceRequired=null; safeToOmitWhen match is sufficient per registry definition`);
        perDecisionWarnings.push('path_a_null_evidence');
      } else if (component.evidenceRequired !== null) {
        // Add each satisfied atom to evidence.
        const atoms = component.evidenceRequired.split(' AND ');
        for (const a of atoms) evidenceAtoms.push(a.trim());
      }

      return makeDecisionAndTrace(
        component,
        inputs,
        'omit',
        'safe_to_omit_match',
        'high',
        `Component may be safely omitted for promptFamily "${promptFamily}" (Path A: safeToOmitWhen match, all gates passed).`,
        evidenceAtoms,
        [],
        perDecisionWarnings,
        false,
        component.tokensApprox,
      );
    }

    if (evResult.result === 'unsatisfied') {
      // evidenceRequired not satisfied — Path A unavailable; fall through to Step 8+.
    }
    // path_a_disabled: fall through to Step 8+.
  }

  // -------------------------------------------------------------------------
  // Step 8 — Path B: Default Irrelevant-Omit
  // -------------------------------------------------------------------------
  // safeToOmitWhen does NOT match (checked above — safeOmitMatch is undefined
  // or Step 7 fell through). requiredWhen does NOT match (checked above).
  // Active ID gate: component must not be in active ID set.
  if (
    safeOmitMatch === undefined &&
    component.defaultAction === 'omit' &&
    component.omissionPolicy === 'allow' &&
    component.retainPolicy === 'optional' &&
    (component.riskLevel === 'low' || component.riskLevel === 'medium') &&
    (activeIdSet.size === 0 || !activeIdSet.has(component.id))
  ) {
    return makeDecisionAndTrace(
      component,
      inputs,
      'omit',
      'default_action_omit',
      'high', // Path B is fully deterministic; confidence: high unconditionally.
      `Component has defaultAction: omit and no matching requiredWhen or safeToOmitWhen for promptFamily "${promptFamily}" (Path B).`,
      [
        `requiredWhen=no_match`,
        `safeToOmitWhen=no_match`,
        `defaultAction=omit`,
        `omissionPolicy=allow`,
        `promptFamily=${promptFamily}`,
      ],
      [],
      [],
      false,
      component.tokensApprox,
    );
  }

  // -------------------------------------------------------------------------
  // Step 9 — defaultAction: include
  // -------------------------------------------------------------------------
  if (component.defaultAction === 'include' || !['omit', 'defer'].includes(component.defaultAction)) {
    return makeDecisionAndTrace(
      component,
      inputs,
      'include',
      'default_include',
      'medium',
      `No tag matched and defaultAction is "include" (or absent) for promptFamily "${promptFamily}".`,
      [`requiredWhen=no_match`, `safeToOmitWhen=no_match`, `defaultAction=include`],
      [],
      [],
      false,
      0,
    );
  }

  // -------------------------------------------------------------------------
  // Step 10 — defaultAction: defer
  // -------------------------------------------------------------------------
  if (component.defaultAction === 'defer') {
    return makeDecisionAndTrace(
      component,
      inputs,
      'defer',
      'default_defer',
      'medium',
      `No tag matched and defaultAction is "defer" for promptFamily "${promptFamily}". Component excluded from this plan turn but not omitted.`,
      [`defaultAction=defer`, `promptFamily=${promptFamily}`],
      [],
      [],
      false,
      0,
    );
  }

  // -------------------------------------------------------------------------
  // Step 11 — omissionPolicy: fail_open or Legally-Blocked Omit
  // -------------------------------------------------------------------------
  // Reached when:
  //   (a) omissionPolicy: fail_open — explicit registry instruction, or
  //   (b) defaultAction: omit but Path B legal conditions are NOT all met
  //       (riskLevel not in [low, medium], retainPolicy not optional,
  //        omissionPolicy not allow, or active ID gate blocked it).
  // In all these cases, the component cannot legally be omitted, so we
  // fail open to include. This is the safe-by-default outcome.
  //
  // It is NOT a ladder defect to reach Step 11 via case (b).
  // Step 12 is reserved for genuine defects only (e.g. unrecognised defaultAction).
  if (
    component.omissionPolicy === 'fail_open' ||
    component.defaultAction === 'omit'
  ) {
    const reason = component.omissionPolicy === 'fail_open'
      ? `omissionPolicy is fail_open for promptFamily "${promptFamily}". Uncertainty resolved to include.`
      : `defaultAction is omit but Path B legal conditions were not met (riskLevel=${component.riskLevel}, retainPolicy=${component.retainPolicy}, omissionPolicy=${component.omissionPolicy}). Fail-open include applied.`;
    return makeDecisionAndTrace(
      component,
      inputs,
      'include',
      'fail_open',
      'low',
      reason,
      [`failOpen=true`, `omissionPolicy=${component.omissionPolicy}`, `defaultAction=${component.defaultAction}`],
      [],
      [],
      true,
      0,
    );
  }

  // -------------------------------------------------------------------------
  // Step 12 — Final Fallback (ladder defect detector)
  // -------------------------------------------------------------------------
  // Should never be reached in correct MVP operation.
  // Signals a genuine gap in ladder conditions (e.g. an unrecognised defaultAction
  // value that bypassed Steps 9–11). Always fails open to avoid silent omission.
  return makeDecisionAndTrace(
    component,
    inputs,
    'include',
    'fail_open',
    'low',
    `No ladder step matched for component "${component.id}" with promptFamily "${promptFamily}". Fail-open fallback applied. This indicates a ladder implementation defect.`,
    [`failOpen=true`, `reason=ladder_fallback`],
    [],
    ['unexpected_ladder_fallback'],
    true,
    0,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return the first hard-protection field present on the component, or null.
 *
 * Hard-protection conditions (docs/06 §8 Step 3):
 *   retainPolicy: safety_critical
 *   retainPolicy: mandatory
 *   omissionPolicy: never
 *   riskLevel: critical
 *
 * All four always produce path: safety_override.
 */
function getHardProtectionField(component: Component): string | null {
  if (component.retainPolicy === 'safety_critical') return 'retainPolicy=safety_critical';
  if (component.retainPolicy === 'mandatory') return 'retainPolicy=mandatory';
  if (component.omissionPolicy === 'never') return 'omissionPolicy=never';
  if (component.riskLevel === 'critical') return 'riskLevel=critical';
  return null;
}

/**
 * Build a LadderInputs object for selectors that do not use active IDs
 * (Scaffold, History, Policy, Output Format, Runtime Capability).
 */
export function makeLadderInputsNoActiveIds(
  normalizedInputs: NormalizedInputs,
  quarantinedIds: Set<string>,
  selectorName: string,
  moduleName: string,
): LadderInputs {
  return {
    promptFamily: normalizedInputs.requestSignals.promptFamily,
    activeIdSet: new Set<string>(),
    activeIdAtom: null,
    alwaysInclude: normalizedInputs.constraints?.alwaysInclude ?? [],
    neverInclude: normalizedInputs.constraints?.neverInclude ?? [],
    quarantinedIds,
    selectorName,
    moduleName,
  };
}

/**
 * Build a LadderInputs object for selectors that use active IDs
 * (Skill, Tool, Memory).
 */
export function makeLadderInputsWithActiveIds(
  normalizedInputs: NormalizedInputs,
  quarantinedIds: Set<string>,
  selectorName: string,
  moduleName: string,
  activeIds: string[],
  activeIdAtom: string,
): LadderInputs {
  return {
    promptFamily: normalizedInputs.requestSignals.promptFamily,
    activeIdSet: new Set<string>(activeIds),
    activeIdAtom,
    alwaysInclude: normalizedInputs.constraints?.alwaysInclude ?? [],
    neverInclude: normalizedInputs.constraints?.neverInclude ?? [],
    quarantinedIds,
    selectorName,
    moduleName,
  };
}
