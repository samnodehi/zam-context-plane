/**
 * Phase 5: Selector fan-out orchestrator.
 *
 * Consumes Phase 3 NormalizedInputs and Phase 4 CandidateSetResult and
 * produces SelectorFanOutResult:
 *   - One SelectionDecision per candidate component (primary selector).
 *   - One TraceEntry companion per decision.
 *   - reference_unknown records for alwaysInclude IDs not in candidatesById.
 *   - SelectorSummary with deterministic narrative.
 *   - Planning warnings accumulated from all selectors.
 *
 * What this module does:
 *   - Routes each component to its primary selector by component.type.
 *   - Runs the deterministic ladder (docs/06 §8) for each component.
 *   - Applies type-specific pre-checks (tool runtime availability).
 *   - Checks alwaysInclude IDs against candidatesById for reference_unknown.
 *   - Computes selectorSummary counts and narrative.
 *
 * What this module does NOT do:
 *   - No gap-check (Phase 6).
 *   - No injection gate (Phase 7).
 *   - No conflict resolution (Phase 8).
 *   - No budgeter (Phase 9).
 *   - No output file writes.
 *   - No provider/model/network/OpenClaw calls.
 *   - No active_id_unknown re-emission (Phase 3 already handled).
 *   - No re-quarantine of components.
 *   - No mutation of candidatesById (read-only by Phase 4 contract).
 *
 * Canonical: docs/06 §3, §7, §8, §14; docs/11 §6 Phase 5.
 */

import { randomUUID } from 'node:crypto';
import type { Component, RegistryResult } from '../types/registry.js';
import type { NormalizedInputs } from '../types/normalized.js';
import type { CandidateSetResult } from '../types/candidate.js';
import type {
  SelectionDecision,
  TraceEntry,
  SelectorSummary,
  SelectorFanOutResult,
  UnknownComponentRef,
} from '../types/selection.js';
import type { PlanningWarning } from '../types/warnings.js';
import {
  runLadder,
  makeLadderInputsNoActiveIds,
  makeLadderInputsWithActiveIds,
  type LadderResult,
} from './deterministic-ladder.js';

// ---------------------------------------------------------------------------
// Selector name constants (docs/11 §7.2)
// ---------------------------------------------------------------------------

const SELECTOR_SCAFFOLD          = 'deterministic_scaffold'          as const;
const SELECTOR_SKILL             = 'deterministic_skill'             as const;
const SELECTOR_TOOL              = 'deterministic_tool'              as const;
const SELECTOR_HISTORY           = 'deterministic_history'           as const;
const SELECTOR_MEMORY            = 'deterministic_memory'            as const;
const SELECTOR_POLICY            = 'deterministic_policy'            as const;
const SELECTOR_OUTPUT_FORMAT     = 'deterministic_output_format'     as const;
const SELECTOR_RUNTIME_CAPABILITY= 'deterministic_runtime_capability'as const;

// ---------------------------------------------------------------------------
// runSelectorFanOut — main export
// ---------------------------------------------------------------------------

/**
 * Phase 5 entry point: run selector fan-out and deterministic ladder.
 *
 * @param candidateSetResult - Phase 4 output; candidatesById is read-only.
 * @param normalizedInputs - Phase 3 output; requestSignals, constraints, etc.
 * @param registryResult - Phase 2 output; used for quarantinedComponents list.
 * @returns SelectorFanOutResult — decisions, trace, summary, unknowns, warnings.
 *
 * Canonical: docs/06 §3; docs/11 §6 Phase 5.
 */
export function runSelectorFanOut(
  candidateSetResult: CandidateSetResult,
  normalizedInputs: NormalizedInputs,
  registryResult: RegistryResult,
): SelectorFanOutResult {
  const decisions: SelectionDecision[] = [];
  const selectorTrace: TraceEntry[] = [];
  const planningWarnings: PlanningWarning[] = [];
  const referencedUnknownComponents: UnknownComponentRef[] = [];

  // Pre-compute quarantined ID set for Step 1 boundary check (defensive guard).
  const quarantinedIds = new Set<string>(
    registryResult.quarantinedComponents.map((q) => q.id),
  );

  // Pre-extract selector-specific active ID arrays.
  const activeSkillIds = normalizedInputs.requestSignals.activeSkillIds ?? [];
  const activeToolIds  = normalizedInputs.requestSignals.activeToolIds  ?? [];
  const activeMemoryIds= normalizedInputs.requestSignals.activeMemoryIds?? [];
  const runtime        = normalizedInputs.runtime;
  const history        = normalizedInputs.history;

  // -------------------------------------------------------------------------
  // Fan-out loop — primary selector per component
  // -------------------------------------------------------------------------
  for (const [, component] of candidateSetResult.candidatesById) {
    const { ladderResult, warnings } = evaluateComponent(
      component,
      normalizedInputs,
      quarantinedIds,
      activeSkillIds,
      activeToolIds,
      activeMemoryIds,
      runtime,
      history,
    );
    decisions.push(ladderResult.decision);
    selectorTrace.push(ladderResult.traceEntry);
    for (const w of warnings) planningWarnings.push(w);

    // Step 4: if this decision is conflict_include, also emit a planning-level warning.
    // The conflict atoms are already in decision.evidence[] (per-decision trace).
    // The planning warning surfaces the conflict at the aggregate plan level.
    if (ladderResult.decision.path === 'conflict_include') {
      planningWarnings.push({
        code: 'conflicting_tags',
        message: `Component "${component.id}" has both requiredWhen and safeToOmitWhen matching the current promptFamily. Conflict resolved to include. Registry author should review tag configuration.`,
        context: { componentId: component.id, selectorName: ladderResult.decision.selectorName },
      });
    }

    // Step 1: if this decision is quarantine_boundary_violation, emit a planning-level error warning.
    if (ladderResult.decision.path === 'quarantine_boundary_violation') {
      planningWarnings.push({
        code: 'unexpected_quarantine_reference',
        message: `Component "${component.id}" appeared in the candidate set but is also quarantined. This is a core planning boundary defect. Fail-open include applied.`,
        context: { componentId: component.id },
      });
    }
  }

  // -------------------------------------------------------------------------
  // reference_unknown check for userConstraints.alwaysInclude
  // -------------------------------------------------------------------------
  // Any alwaysInclude ID not in candidatesById produces a reference_unknown
  // decision (docs/06 §8 Step 2; docs/06 §3.5).
  const alwaysInclude = normalizedInputs.constraints?.alwaysInclude ?? [];
  for (const refId of alwaysInclude) {
    if (!candidateSetResult.candidatesById.has(refId)) {
      const { decisionId, decision, traceEntry } = makeReferenceUnknownDecision(refId, 'userConstraints.alwaysInclude');
      decisions.push(decision);
      selectorTrace.push(traceEntry);
      referencedUnknownComponents.push({
        componentId: refId,
        referencedBy: 'userConstraints.alwaysInclude',
        traceRef: decisionId,
      });
    }
  }

  // -------------------------------------------------------------------------
  // post-loop: output_format selector audit (docs/06 §7.7)
  // -------------------------------------------------------------------------
  // After fan-out, check if the prompt family requires structured output but
  // no output_format component was included.
  const promptFamily = normalizedInputs.requestSignals.promptFamily;
  const structuredOutputFamilies = new Set(['tool_use_required']);
  if (structuredOutputFamilies.has(promptFamily)) {
    const anyOutputFormatIncluded = decisions.some(
      (d) => {
        const comp = candidateSetResult.candidatesById.get(d.componentId);
        return comp?.type === 'output_format' && d.action === 'include';
      },
    );
    if (!anyOutputFormatIncluded) {
      planningWarnings.push({
        code: 'no_output_format_selected',
        message: `No output_format component was included and promptFamily "${promptFamily}" requires structured output. Prompt Plan Generator must surface this.`,
        context: { promptFamily },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Compute selectorSummary
  // -------------------------------------------------------------------------
  const selectorSummary = computeSelectorSummary(decisions, referencedUnknownComponents.length);

  return {
    decisions,
    selectorTrace,
    selectorSummary,
    referencedUnknownComponents,
    warnings: planningWarnings,
  };
}

// ---------------------------------------------------------------------------
// evaluateComponent — route to primary selector
// ---------------------------------------------------------------------------

interface ComponentEvalResult {
  ladderResult: LadderResult;
  warnings: PlanningWarning[];
}

function evaluateComponent(
  component: Component,
  normalizedInputs: NormalizedInputs,
  quarantinedIds: Set<string>,
  activeSkillIds: string[],
  activeToolIds: string[],
  activeMemoryIds: string[],
  runtime: NormalizedInputs['runtime'],
  history: NormalizedInputs['history'],
): ComponentEvalResult {
  const warnings: PlanningWarning[] = [];

  switch (component.type) {

    case 'scaffold':
      return {
        ladderResult: runLadder(
          component,
          makeLadderInputsNoActiveIds(normalizedInputs, quarantinedIds, SELECTOR_SCAFFOLD, 'ScaffoldSelector'),
        ),
        warnings,
      };

    case 'skill': {
      // Check for malformed activeSkillIds (already defaulted to [] by Phase 3,
      // but we surface the warning here if the array was originally malformed —
      // Phase 1 sets it to [] silently; no way to detect in Phase 5 without
      // a flag. We treat [] as absent/valid per docs/06 §14.2.)
      const ladderResult = runLadder(
        component,
        makeLadderInputsWithActiveIds(
          normalizedInputs,
          quarantinedIds,
          SELECTOR_SKILL,
          'SkillSelector',
          activeSkillIds,
          'active_skill_id_match',
        ),
      );
      return { ladderResult, warnings };
    }

    case 'tool': {
      // Runtime availability pre-check (before ladder — docs/06 §7.3, §14.3).
      const toolPreCheck = checkToolAvailability(component, runtime, warnings);
      if (toolPreCheck !== null) {
        return { ladderResult: toolPreCheck, warnings };
      }
      // Availability confirmed or unknown → run ladder.
      const ladderResult = runLadder(
        component,
        makeLadderInputsWithActiveIds(
          normalizedInputs,
          quarantinedIds,
          SELECTOR_TOOL,
          'ToolSelector',
          activeToolIds,
          'active_tool_id_match',
        ),
      );
      return { ladderResult, warnings };
    }

    case 'history': {
      // historyMalformed pre-check (docs/06 §14.4).
      const historyPreCheck = checkHistoryMalformed(component, history, normalizedInputs, quarantinedIds, warnings);
      if (historyPreCheck !== null) {
        return { ladderResult: historyPreCheck, warnings };
      }
      const ladderResult = runLadder(
        component,
        makeLadderInputsNoActiveIds(normalizedInputs, quarantinedIds, SELECTOR_HISTORY, 'HistorySelector'),
      );
      return { ladderResult, warnings };
    }

    case 'memory': {
      const ladderResult = runLadder(
        component,
        makeLadderInputsWithActiveIds(
          normalizedInputs,
          quarantinedIds,
          SELECTOR_MEMORY,
          'MemorySelector',
          activeMemoryIds,
          'active_memory_id_match',
        ),
      );
      return { ladderResult, warnings };
    }

    case 'policy':
      return {
        ladderResult: runLadder(
          component,
          makeLadderInputsNoActiveIds(normalizedInputs, quarantinedIds, SELECTOR_POLICY, 'PolicySelector'),
        ),
        warnings,
      };

    case 'output_format': {
      const ladderResult = runLadder(
        component,
        makeLadderInputsNoActiveIds(normalizedInputs, quarantinedIds, SELECTOR_OUTPUT_FORMAT, 'OutputFormatSelector'),
      );
      return { ladderResult, warnings };
    }

    case 'runtime_capability': {
      // capabilityInventoryComplete: false → conservatively include all runtime_capability.
      // docs/06 §14.8 and §7.8.
      if (!runtime.capabilityInventoryComplete) {
        warnings.push({
          code: 'capability_inventory_incomplete',
          message: `runtimeCapabilities.capabilityInventoryComplete is false. Including runtime_capability component "${component.id}" conservatively.`,
          context: { componentId: component.id },
        });
        const { decision, traceEntry } = makeFailOpenDecision(
          component,
          SELECTOR_RUNTIME_CAPABILITY,
          'RuntimeCapabilitySelector',
          `runtimeCapabilities.capabilityInventoryComplete is false. Including runtime_capability component conservatively.`,
          ['capabilityInventoryComplete=false', `promptFamily=${normalizedInputs.requestSignals.promptFamily}`],
        );
        return { ladderResult: { decision, traceEntry }, warnings };
      }
      const ladderResult = runLadder(
        component,
        makeLadderInputsNoActiveIds(normalizedInputs, quarantinedIds, SELECTOR_RUNTIME_CAPABILITY, 'RuntimeCapabilitySelector'),
      );
      return { ladderResult, warnings };
    }

    default: {
      // Unrecognized component type after Phase 2 validation — planning boundary defect.
      // docs/06 §7: "unexpected_component_type_after_validation".
      warnings.push({
        code: 'unexpected_component_type_after_validation',
        message: `Component "${component.id}" has unrecognized type "${component.type}" after Phase 2 registry validation. This indicates a core-boundary defect. Fail-open include applied.`,
        context: { componentId: component.id, componentType: component.type },
      });
      const { decision, traceEntry } = makeFailOpenDecision(
        component,
        'deterministic_unknown',
        'UnknownTypeSelector',
        `Unrecognized component type "${component.type}". Fail-open include applied.`,
        [`unexpected_component_type=true`, `componentType=${component.type}`],
      );
      return { ladderResult: { decision, traceEntry }, warnings };
    }
  }
}

// ---------------------------------------------------------------------------
// Tool runtime availability pre-check
// ---------------------------------------------------------------------------

/**
 * Check tool runtime availability before running the ladder.
 *
 * Returns a LadderResult if the tool should be deferred (unavailable or confirmed-unavailable),
 * or null if availability is confirmed/unknown and the ladder should run normally.
 *
 * Canonical: docs/06 §7.3; docs/06 §14.3.
 */
function checkToolAvailability(
  component: Component,
  runtime: NormalizedInputs['runtime'],
  warnings: PlanningWarning[],
): LadderResult | null {
  const { availableToolIds, unavailableToolIds, capabilityInventoryComplete } = runtime;
  const id = component.id;

  const confirmedUnavailable =
    unavailableToolIds.includes(id) ||
    (!availableToolIds.includes(id) && capabilityInventoryComplete);

  const confirmedAvailable = availableToolIds.includes(id);

  const unknownAvailability =
    !confirmedAvailable && !unavailableToolIds.includes(id) && !capabilityInventoryComplete;

  if (confirmedUnavailable) {
    // Check for hard-protection conflict.
    const hardField = getHardProtectionFieldForTool(component);
    if (hardField !== null) {
      warnings.push({
        code: 'hard_protected_tool_unavailable',
        message: `Tool "${id}" is confirmed unavailable (runtime pre-check) but also has hard-protection (${hardField}). Registry metadata and runtime state are inconsistent. Deferred.`,
        context: { componentId: id, hardProtectionField: hardField },
      });
    }
    warnings.push({
      code: 'runtime_unavailable',
      message: `Tool "${id}" is confirmed unavailable at this runtime. Deferred (not omitted). No token savings claimed.`,
      context: { componentId: id },
    });
    const decisionId = randomUUID();
    const decision: SelectionDecision = {
      componentId: id,
      selectorName: SELECTOR_TOOL,
      action: 'defer',
      reason: `Tool "${id}" is confirmed unavailable at the current runtime. Deferred (action: defer, path: runtime_unavailable). Not counted as omission.`,
      path: 'runtime_unavailable',
      confidence: 'high',
      evidence: [`availabilityStatus=confirmed_unavailable`, `capabilityInventoryComplete=${capabilityInventoryComplete}`],
      constraintsApplied: [],
      warnings: [],
      traceRefs: [decisionId],
    };
    const traceEntry: TraceEntry = {
      decisionId,
      componentId: id,
      module: 'ToolSelector',
      action: 'defer',
      reason: decision.reason,
      evidence: decision.evidence,
      confidence: 'high',
      risk: component.riskLevel,
      estimatedSavings: { tokens: 0 }, // runtime_unavailable is never counted as savings.
      failOpen: false,
      selector: 'deterministic',
    };
    return { decision, traceEntry };
  }

  if (unknownAvailability) {
    // Unknown availability — must fail open IMMEDIATELY before the ladder.
    // The ladder must NOT run, because Path B could legally omit a tool
    // (defaultAction:omit + omissionPolicy:allow + retainPolicy:optional + riskLevel:low)
    // even though we have no capability evidence. Fail-open include is the safe outcome.
    // Canonical: docs/06 §14.3 fail-open rule for incomplete capability inventory.
    warnings.push({
      code: 'runtime_capability_unknown',
      message: `Tool "${id}" availability is unknown (absent from both lists, capabilityInventoryComplete: false). Fail-open include applied immediately — ladder not run.`,
      context: { componentId: id },
    });
    const { decision, traceEntry } = makeFailOpenDecision(
      component,
      SELECTOR_TOOL,
      'ToolSelector',
      `Tool "${id}" availability is unknown (capabilityInventoryComplete: false). Fail-open include applied.`,
      [`availabilityStatus=unknown`, `capabilityInventoryComplete=false`],
    );
    return { decision, traceEntry };
  }

  // Availability confirmed → run ladder.
  return null;
}

function getHardProtectionFieldForTool(component: Component): string | null {
  if (component.retainPolicy === 'safety_critical') return 'retainPolicy=safety_critical';
  if (component.retainPolicy === 'mandatory') return 'retainPolicy=mandatory';
  if (component.omissionPolicy === 'never') return 'omissionPolicy=never';
  if (component.riskLevel === 'critical') return 'riskLevel=critical';
  return null;
}

// ---------------------------------------------------------------------------
// History malformed pre-check
// ---------------------------------------------------------------------------

/**
 * If historyMalformed is true AND the component is high-risk or non-optional,
 * fail-open include without running the ladder.
 *
 * Low-risk optional history components still run the ladder normally.
 *
 * Canonical: docs/06 §14.4.
 */
function checkHistoryMalformed(
  component: Component,
  history: NormalizedInputs['history'],
  normalizedInputs: NormalizedInputs,
  quarantinedIds: Set<string>,
  warnings: PlanningWarning[],
): LadderResult | null {
  if (!history.historyMalformed) return null;

  const isHighRisk = component.riskLevel === 'high';
  const isNonOptional = component.retainPolicy !== 'optional';

  if (isHighRisk || isNonOptional) {
    warnings.push({
      code: 'history_malformed_fail_open',
      message: `historyStateSummary.historyMalformed is true. Fail-open include applied for history component "${component.id}" (riskLevel=${component.riskLevel}, retainPolicy=${component.retainPolicy}).`,
      context: { componentId: component.id, riskLevel: component.riskLevel, retainPolicy: component.retainPolicy },
    });
    const { decision, traceEntry } = makeFailOpenDecision(
      component,
      SELECTOR_HISTORY,
      'HistorySelector',
      `historyStateSummary.historyMalformed is true. Fail-open include for high-risk or non-optional history component.`,
      [`historyMalformed=true`, `riskLevel=${component.riskLevel}`, `retainPolicy=${component.retainPolicy}`],
    );
    return { decision, traceEntry };
  }

  // Low-risk optional: run ladder normally.
  return null;
}

// ---------------------------------------------------------------------------
// reference_unknown decision factory
// ---------------------------------------------------------------------------

function makeReferenceUnknownDecision(
  unknownId: string,
  referencedBy: string,
): { decisionId: string; decision: SelectionDecision; traceEntry: TraceEntry } {
  const decisionId = randomUUID();
  const decision: SelectionDecision = {
    componentId: unknownId,
    selectorName: 'deterministic_orchestrator',
    action: 'reference_unknown',
    reason: `Component ID "${unknownId}" referenced by ${referencedBy} was not found in the component registry. Cannot include or omit.`,
    path: 'reference_unknown',
    confidence: 'high',
    evidence: [],
    constraintsApplied: [],
    warnings: [],
    traceRefs: [decisionId],
  };
  const traceEntry: TraceEntry = {
    decisionId,
    componentId: unknownId,
    module: 'Orchestrator',
    action: 'reference_unknown',
    reason: decision.reason,
    evidence: [`referencedBy=${referencedBy}`, `componentId=${unknownId}`],
    confidence: 'high',
    // MVP placeholder: reference_unknown has no real component riskLevel to read.
    // Use "low" — a valid RiskLevel enum value ["low","medium","high","critical"].
    // "unknown" is schema-invalid and was rejected by AJV trace validation.
    // Canonical: Phase 12.5 remediation, Cat E fix.
    risk: 'low',
    estimatedSavings: { tokens: 0 },
    failOpen: false,
    selector: 'deterministic',
  };
  return { decisionId, decision, traceEntry };
}

// ---------------------------------------------------------------------------
// fail-open decision factory (shared helper)
// ---------------------------------------------------------------------------

function makeFailOpenDecision(
  component: Component,
  selectorName: string,
  moduleName: string,
  reason: string,
  evidence: string[],
): { decision: SelectionDecision; traceEntry: TraceEntry } {
  const decisionId = randomUUID();
  const decision: SelectionDecision = {
    componentId: component.id,
    selectorName,
    action: 'include',
    reason,
    path: 'fail_open',
    confidence: 'low',
    evidence: ['failOpen=true', ...evidence],
    constraintsApplied: [],
    warnings: [],
    traceRefs: [decisionId],
  };
  const traceEntry: TraceEntry = {
    decisionId,
    componentId: component.id,
    module: moduleName,
    action: 'include',
    reason,
    evidence: decision.evidence,
    confidence: 'low',
    risk: component.riskLevel,
    estimatedSavings: { tokens: 0 },
    failOpen: true,
    selector: 'deterministic',
  };
  return { decision, traceEntry };
}

// ---------------------------------------------------------------------------
// computeSelectorSummary
// ---------------------------------------------------------------------------

/**
 * Compute aggregate counts and generate deterministic narrative.
 *
 * Template (docs/06 §3.6):
 * "{totalEvaluated} components evaluated. {decidedInclude} included,
 *  {decidedOmit} omitted, {decidedDefer} deferred ({defaultDefer} default,
 *  {runtimeUnavailableDefer} runtime-unavailable), {failOpenInclude} fail-open.
 *  {conflictsIdentified} conflict(s) identified."
 *
 * reference_unknown decisions are tracked separately in unknownReferences;
 * they are NOT counted in totalEvaluated or other decision buckets.
 */
export function computeSelectorSummary(
  decisions: SelectionDecision[],
  unknownReferences: number,
): SelectorSummary {
  // Filter out reference_unknown decisions from aggregate counts.
  const evaluated = decisions.filter((d) => d.action !== 'reference_unknown');

  let decidedInclude = 0;
  let decidedOmit = 0;
  let decidedDefer = 0;
  let defaultDefer = 0;
  let runtimeUnavailableDefer = 0;
  let failOpenInclude = 0;
  let conflictsIdentified = 0;

  for (const d of evaluated) {
    switch (d.action) {
      case 'include':
        decidedInclude++;
        if (
          d.path === 'fail_open' ||
          d.path === 'quarantine_boundary_violation' ||
          d.path === 'not_evaluated'
        ) {
          failOpenInclude++;
        }
        if (d.path === 'conflict_include') {
          conflictsIdentified++;
        }
        break;
      case 'omit':
        decidedOmit++;
        break;
      case 'defer':
        decidedDefer++;
        if (d.path === 'default_defer') defaultDefer++;
        if (d.path === 'runtime_unavailable') runtimeUnavailableDefer++;
        break;
    }
  }

  const totalEvaluated = evaluated.length;

  const narrative =
    `${totalEvaluated} components evaluated. ` +
    `${decidedInclude} included, ` +
    `${decidedOmit} omitted, ` +
    `${decidedDefer} deferred (${defaultDefer} default, ${runtimeUnavailableDefer} runtime-unavailable), ` +
    `${failOpenInclude} fail-open. ` +
    `${conflictsIdentified} conflict(s) identified.`;

  return {
    totalEvaluated,
    decidedInclude,
    decidedOmit,
    decidedDefer,
    defaultDefer,
    runtimeUnavailableDefer,
    failOpenInclude,
    conflictsIdentified,
    unknownReferences,
    narrative,
  };
}
