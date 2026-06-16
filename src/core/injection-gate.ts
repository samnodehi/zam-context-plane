/**
 * Phase 7: Injection gate / policy normalization.
 *
 * After Phase 6 gap-check, the orchestrator applies the injection gate to the
 * full set of SelectionDecision[] produced by Phases 5–6. The gate:
 *   1. Normalizes the raw selectorPolicy.injectionSuspectAction to an effective
 *      policy (warn_and_continue or fail_open_all), applying halt_planning and
 *      unknown-value fallbacks and the familyConfidence escalation rule.
 *   2. Emits exactly one global injection warning per planning run (orchestrator-
 *      owned; never emitted by individual selectors).
 *   3. Processes every SelectionDecision:
 *      - Pass-through decisions (runtime_unavailable, reference_unknown,
 *        quarantine_boundary_violation, not_evaluated, any include) receive
 *        injection_suspect_seen=true in evidence and gate fields on TraceEntry.
 *      - fail_open_all: all action:omit decisions are converted to include/fail_open.
 *      - warn_and_continue Branch A: policy/high-risk/output_format critical-high
 *        omit decisions are converted to include/fail_open + injection_suspect_policy_override.
 *      - warn_and_continue Branch B: all other omit decisions are allowed but
 *        annotated with injection_suspect_omit_allowed.
 *   4. Returns InjectionGateResult (no mutation of input arrays).
 *
 * Authoritative sources:
 *   - docs/06 §17 (injection gate specification)
 *   - docs/06 §18 Q1 (resolved Pass 4.8C): output_format critical/high override
 *   - docs/06 §19 DoD: safety/policy/history-durable upgraded under warn_and_continue
 *   - docs/11 §6 Phase 7 row
 *
 * What this module does NOT do:
 *   - No conflict resolution (Phase 8).
 *   - No budgeter (Phase 9).
 *   - No output file writes.
 *   - No injection detection / pattern matching (owned by Request Router, F-25).
 *   - No mutation of input arrays or Phase 4–6 result objects.
 *   - No provider/model/network/OpenClaw calls.
 */

import type { SelectionDecision, TraceEntry } from '../types/selection.js';
import type { NormalizedInputs } from '../types/normalized.js';
import type { Component } from '../types/registry.js';
import type { PlanningWarning } from '../types/warnings.js';

// ---------------------------------------------------------------------------
// InjectionGateResult
// ---------------------------------------------------------------------------

/**
 * The output of runInjectionGate().
 *
 * Contains post-gate decisions and trace entries, global planning warnings
 * emitted by the orchestrator, policy fallback reasons for Phase 11 trace
 * assembly, and gate metadata.
 */
export interface InjectionGateResult {
  /** Post-gate SelectionDecision array (may contain converted decisions). */
  decisions: SelectionDecision[];
  /** Post-gate TraceEntry array (updated with injection gate fields). */
  traceEntries: TraceEntry[];
  /**
   * Global planning warnings emitted by the orchestrator for this pass.
   * Printed to stderr by plan.ts. Must NOT be placed in per-decision warnings.
   * Codes: injection_suspect_warn_and_continue, injection_suspect_fail_open_all,
   * policy_value_not_implemented, injection_action_unknown,
   * family_confidence_fail_open_escalation.
   */
  warnings: PlanningWarning[];
  /**
   * Policy resolution step codes in order. Consumed by Phase 11 global trace
   * assembly (policyFallbackReasons field in global planning trace entry).
   * NOT printed to stderr. Empty when no fallback or escalation occurred.
   * Canonical: docs/06 §17.6.
   */
  policyFallbackReasons: string[];
  /** true when injectionSuspect: true and the gate was applied. */
  gateApplied: boolean;
  /** Final effective policy applied, or null when gateApplied: false. */
  effectivePolicy: 'warn_and_continue' | 'fail_open_all' | null;
}

// ---------------------------------------------------------------------------
// Policy normalization (internal)
// ---------------------------------------------------------------------------

interface PolicyNormalizationResult {
  effectivePolicy: 'warn_and_continue' | 'fail_open_all';
  /** Global warnings to emit BEFORE the effective-policy global warning. */
  prefixWarnings: PlanningWarning[];
  /** policyFallbackReasons[] for Phase 11. */
  fallbackReasons: string[];
}

/**
 * Normalize the raw injectionSuspectAction to an effective policy.
 *
 * Step 1: Resolve base policy from the raw string.
 *   - 'warn_and_continue' → base: warn_and_continue, no fallback
 *   - 'fail_open_all'     → base: fail_open_all, no fallback
 *   - 'halt_planning'     → base: warn_and_continue + policy_value_not_implemented
 *   - any other string    → base: warn_and_continue + injection_action_unknown
 *
 * Step 2: Apply familyConfidence escalation (§17.3.4).
 *   If base ≠ fail_open_all AND familyConfidence < failOpenThreshold (strict):
 *     escalate to fail_open_all + family_confidence_fail_open_escalation.
 *
 * Canonical: docs/06 §17.3, §17.3.4.
 */
function normalizePolicy(
  rawPolicy: string,
  familyConfidence: number,
  failOpenThreshold: number,
): PolicyNormalizationResult {
  const prefixWarnings: PlanningWarning[] = [];
  const fallbackReasons: string[] = [];
  let effectivePolicy: 'warn_and_continue' | 'fail_open_all';

  // Step 1: base policy
  if (rawPolicy === 'fail_open_all') {
    effectivePolicy = 'fail_open_all';
  } else if (rawPolicy === 'warn_and_continue') {
    effectivePolicy = 'warn_and_continue';
  } else if (rawPolicy === 'halt_planning') {
    // Known reserved future value — not implemented in MVP.
    effectivePolicy = 'warn_and_continue';
    prefixWarnings.push({
      code: 'policy_value_not_implemented',
      message:
        `injectionSuspectAction 'halt_planning' is a reserved future value and is not ` +
        `implemented in MVP. Effective policy: warn_and_continue.`,
    });
    fallbackReasons.push('policy_value_not_implemented');
  } else {
    // Genuinely unknown/typo value — not halt_planning.
    effectivePolicy = 'warn_and_continue';
    prefixWarnings.push({
      code: 'injection_action_unknown',
      message:
        `injectionSuspectAction '${rawPolicy}' is not a recognized MVP value. ` +
        `Effective policy: warn_and_continue.`,
    });
    fallbackReasons.push('injection_action_unknown');
  }

  // Step 2: familyConfidence escalation (§17.3.4).
  // Escalation fires when: injectionSuspect: true (caller guarantees this),
  // base policy ≠ fail_open_all, and familyConfidence < failOpenThreshold (strict).
  if (effectivePolicy !== 'fail_open_all' && familyConfidence < failOpenThreshold) {
    effectivePolicy = 'fail_open_all';
    prefixWarnings.push({
      code: 'family_confidence_fail_open_escalation',
      message:
        `familyConfidence (${familyConfidence}) is below failOpenThreshold (${failOpenThreshold}). ` +
        `Injection policy escalated to fail_open_all.`,
    });
    fallbackReasons.push('family_confidence_fail_open_escalation');
  }

  return { effectivePolicy, prefixWarnings, fallbackReasons };
}

// ---------------------------------------------------------------------------
// Branch A trigger check (warn_and_continue required override)
// ---------------------------------------------------------------------------

/**
 * Returns true if this component's omit decision must be overridden under
 * warn_and_continue (Option A, §18 Q1 resolved + §19 DoD).
 *
 * Triggers (any one sufficient):
 *   - type === 'policy' (any riskLevel)
 *   - riskLevel === 'critical' (defensive: Branch A — structurally unreachable,
 *     but handled if somehow arrives as omit)
 *   - riskLevel === 'high' (defensive: Branch B — omit-gate blocked normally,
 *     but handled if somehow arrives as omit)
 *   - retainPolicy === 'safety_critical' or 'mandatory' (defensive)
 *   - omissionPolicy === 'never' (defensive)
 *   - type === 'output_format' AND (riskLevel === 'critical' OR riskLevel === 'high')
 *     — canonical: docs/06 §18 Q1 resolved Pass 4.8C
 *
 * Missing metadata: if the component is not in candidatesById, treat as
 * uncertainty and fail-open (override). Canonical: plan R2 defensive note.
 */
function isWarnAndContinueBranchA(
  componentId: string,
  candidatesById: Map<string, Component>,
): boolean {
  const component = candidatesById.get(componentId);

  // Missing metadata → uncertainty → fail-open (override).
  if (!component) {
    return true;
  }

  const { type, riskLevel, retainPolicy, omissionPolicy } = component;

  if (type === 'policy') return true;
  if (riskLevel === 'critical') return true;
  if (riskLevel === 'high') return true;
  if (retainPolicy === 'safety_critical') return true;
  if (retainPolicy === 'mandatory') return true;
  if (omissionPolicy === 'never') return true;
  if (type === 'output_format' && (riskLevel === 'critical' || riskLevel === 'high')) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Decision converters (internal)
// ---------------------------------------------------------------------------

/** Produce a converted SelectionDecision (omit → include/fail_open). */
function convertDecision(
  original: SelectionDecision,
  effectivePolicy: 'warn_and_continue' | 'fail_open_all',
  perDecisionWarningCode: string,
): SelectionDecision {
  return {
    ...original,
    action: 'include',
    path: 'fail_open',
    confidence: 'low',
    evidence: [
      ...original.evidence,
      'injection_suspect_seen=true',
      `injectionSuspectAction=${effectivePolicy}`,
    ],
    warnings: [...original.warnings, perDecisionWarningCode],
    // traceRefs already link to the companion TraceEntry; we update its fields separately.
  };
}

/** Produce a pass-through SelectionDecision (evidence augmented only). */
function passthroughDecision(
  original: SelectionDecision,
  effectivePolicy: 'warn_and_continue' | 'fail_open_all',
): SelectionDecision {
  return {
    ...original,
    evidence: [
      ...original.evidence,
      'injection_suspect_seen=true',
      `injectionSuspectAction=${effectivePolicy}`,
    ],
  };
}

/** Produce an allowed-omit SelectionDecision (Branch B: evidence + omit_allowed warning). */
function allowedOmitDecision(
  original: SelectionDecision,
  effectivePolicy: 'warn_and_continue' | 'fail_open_all',
): SelectionDecision {
  return {
    ...original,
    evidence: [
      ...original.evidence,
      'injection_suspect_seen=true',
      `injectionSuspectAction=${effectivePolicy}`,
    ],
    warnings: [...original.warnings, 'injection_suspect_omit_allowed'],
  };
}

// ---------------------------------------------------------------------------
// TraceEntry updaters (internal)
// ---------------------------------------------------------------------------

/** Update a TraceEntry for a converted decision (actionChanged: true). */
function convertedTraceEntry(
  original: TraceEntry,
  effectivePolicy: 'warn_and_continue' | 'fail_open_all',
  warningCode: string,
  originalPath: SelectionDecision['path'],
): TraceEntry {
  return {
    ...original,
    action: 'include',
    failOpen: true,
    estimatedSavings: { tokens: 0 },
    injectionSuspect: true,
    injectionSuspectAction: effectivePolicy,
    actionChanged: true,
    originalCandidateAction: 'omit',
    originalCandidatePath: originalPath,
    warningsEmitted: [warningCode],
  };
}

/**
 * Update a TraceEntry for a pass-through or allowed-omit decision (actionChanged: false).
 * warningCode is empty string for pure pass-throughs (no per-decision injection warning).
 * warningCode is 'injection_suspect_omit_allowed' for allowed-omit Branch B.
 */
function passthroughTraceEntry(
  original: TraceEntry,
  effectivePolicy: 'warn_and_continue' | 'fail_open_all',
  warningCode?: string,
): TraceEntry {
  return {
    ...original,
    injectionSuspect: true,
    injectionSuspectAction: effectivePolicy,
    actionChanged: false,
    ...(warningCode ? { warningsEmitted: [warningCode] } : {}),
  };
}

// ---------------------------------------------------------------------------
// runInjectionGate — main export
// ---------------------------------------------------------------------------

/**
 * Run the Phase 7 injection gate and policy normalization pass.
 *
 * @param decisions        All SelectionDecision[] from Phase 5 + Phase 6 (read-only).
 * @param traceEntries     All TraceEntry[] from Phase 5 + Phase 6 (read-only).
 * @param normalizedInputs Phase 3 output — provides requestSignals and policy.
 * @param candidatesById   Phase 4 non-quarantined candidate map (read-only).
 *                         Must be candidateSetResult.candidatesById, NOT
 *                         registryResult.indexes.candidatesById.
 * @returns InjectionGateResult
 *
 * Canonical: docs/06 §17; docs/06 §18 Q1 (resolved); docs/06 §19 DoD; docs/11 §6 Phase 7.
 */
export function runInjectionGate(
  decisions: SelectionDecision[],
  traceEntries: TraceEntry[],
  normalizedInputs: NormalizedInputs,
  candidatesById: Map<string, Component>,
): InjectionGateResult {
  const injectionSuspect = normalizedInputs.requestSignals.injectionSuspect;

  // -------------------------------------------------------------------------
  // No-op path: injectionSuspect === false
  // -------------------------------------------------------------------------
  if (!injectionSuspect) {
    return {
      decisions,
      traceEntries,
      warnings: [],
      policyFallbackReasons: [],
      gateApplied: false,
      effectivePolicy: null,
    };
  }

  // -------------------------------------------------------------------------
  // Step 1: Effective policy normalization
  // -------------------------------------------------------------------------
  const rawPolicy = normalizedInputs.policy.injectionSuspectAction;
  const familyConfidence = normalizedInputs.requestSignals.familyConfidence;
  const failOpenThreshold = normalizedInputs.policy.failOpenThreshold;

  const { effectivePolicy, prefixWarnings, fallbackReasons } = normalizePolicy(
    rawPolicy,
    familyConfidence,
    failOpenThreshold,
  );

  // -------------------------------------------------------------------------
  // Step 2: Emit global injection warning (exactly once — orchestrator-owned)
  // -------------------------------------------------------------------------
  const globalWarnings: PlanningWarning[] = [...prefixWarnings];

  if (effectivePolicy === 'fail_open_all') {
    globalWarnings.push({
      code: 'injection_suspect_fail_open_all',
      message:
        `Injection-suspect signal detected. Effective policy: fail_open_all. ` +
        `All Path A and Path B omit decisions suppressed; all omit → include/fail_open.`,
    });
  } else {
    globalWarnings.push({
      code: 'injection_suspect_warn_and_continue',
      message:
        `Injection-suspect signal detected. Effective policy: warn_and_continue. ` +
        `Allowed omit decisions annotated with injection_suspect_omit_allowed. ` +
        `Policy/high-risk/output_format critical-high omits converted to include/fail_open.`,
    });
  }

  // -------------------------------------------------------------------------
  // Step 3: Build a traceEntry lookup map for O(1) companion entry access.
  // -------------------------------------------------------------------------
  // Map: decisionId → index in traceEntries array.
  const traceIndexByDecisionId = new Map<string, number>();
  for (let i = 0; i < traceEntries.length; i++) {
    traceIndexByDecisionId.set(traceEntries[i].decisionId, i);
  }

  // -------------------------------------------------------------------------
  // Step 4: Process every SelectionDecision.
  // -------------------------------------------------------------------------
  const outDecisions: SelectionDecision[] = [];
  const outTraceEntries: TraceEntry[] = [...traceEntries]; // copy; update by index

  for (const decision of decisions) {
    // Locate companion TraceEntry (by first traceRef, if any).
    // gap_check synthetic decisions have exactly one traceRef; Phase 5 decisions
    // also have exactly one traceRef per SelectionDecision.
    const traceRef = decision.traceRefs[0];
    const traceIdx = traceRef !== undefined
      ? traceIndexByDecisionId.get(traceRef)
      : undefined;
    const originalTrace = traceIdx !== undefined ? traceEntries[traceIdx] : undefined;

    // -----------------------------------------------------------------------
    // Pass-through conditions (action / path must not change):
    //   1. action: defer, path: runtime_unavailable
    //   2. action: reference_unknown
    //   3. action: include, path: quarantine_boundary_violation (markers preserved)
    //   4. action: include, path: not_evaluated (Phase 6 synthetic)
    //   5. Any other action: include (already conservative)
    //   6. action: defer (non-runtime_unavailable)
    // -----------------------------------------------------------------------
    const isPassThrough =
      decision.action !== 'omit';

    if (isPassThrough) {
      outDecisions.push(passthroughDecision(decision, effectivePolicy));
      if (originalTrace !== undefined && traceIdx !== undefined) {
        outTraceEntries[traceIdx] = passthroughTraceEntry(originalTrace, effectivePolicy);
      }
      continue;
    }

    // decision.action === 'omit' from here on.

    if (effectivePolicy === 'fail_open_all') {
      // ------------------------------------------------------------------
      // fail_open_all: all omit decisions → include/fail_open.
      // No injection_suspect_policy_override (global warning covers this mode).
      // ------------------------------------------------------------------
      const convertedDecision: SelectionDecision = {
        ...decision,
        action: 'include',
        path: 'fail_open',
        confidence: 'low',
        evidence: [
          ...decision.evidence,
          'injection_suspect_seen=true',
          'injectionSuspectAction=fail_open_all',
        ],
        // Original per-decision warnings preserved; no injection_suspect_policy_override here.
        warnings: [...decision.warnings],
      };
      outDecisions.push(convertedDecision);

      if (originalTrace !== undefined && traceIdx !== undefined) {
        const convTrace: TraceEntry = {
          ...originalTrace,
          action: 'include',
          failOpen: true,
          estimatedSavings: { tokens: 0 },
          injectionSuspect: true,
          injectionSuspectAction: 'fail_open_all',
          actionChanged: true,
          originalCandidateAction: 'omit',
          originalCandidatePath: decision.path,
          warningsEmitted: [],
        };
        outTraceEntries[traceIdx] = convTrace;
      }
    } else {
      // ------------------------------------------------------------------
      // warn_and_continue: classify into Branch A or Branch B.
      // ------------------------------------------------------------------
      if (isWarnAndContinueBranchA(decision.componentId, candidatesById)) {
        // Branch A: required override → include/fail_open + injection_suspect_policy_override
        outDecisions.push(
          convertDecision(decision, effectivePolicy, 'injection_suspect_policy_override'),
        );
        if (originalTrace !== undefined && traceIdx !== undefined) {
          outTraceEntries[traceIdx] = convertedTraceEntry(
            originalTrace,
            effectivePolicy,
            'injection_suspect_policy_override',
            decision.path,
          );
        }
      } else {
        // Branch B: allowed omit → annotate with injection_suspect_omit_allowed
        outDecisions.push(allowedOmitDecision(decision, effectivePolicy));
        if (originalTrace !== undefined && traceIdx !== undefined) {
          outTraceEntries[traceIdx] = passthroughTraceEntry(
            originalTrace,
            effectivePolicy,
            'injection_suspect_omit_allowed',
          );
        }
      }
    }
  }

  return {
    decisions: outDecisions,
    traceEntries: outTraceEntries,
    warnings: globalWarnings,
    policyFallbackReasons: fallbackReasons,
    gateApplied: true,
    effectivePolicy,
  };
}
