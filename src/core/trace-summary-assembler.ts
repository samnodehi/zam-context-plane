/**
 * Phase 11: Trace and Summary Assembly.
 *
 * Pure assemblers — no I/O, no AJV, no file writes.
 * plan.ts handles AJV validation and file writes.
 *
 * Exports:
 *   runTraceAssembler(inputs: TraceAssemblerInputs): TraceOutput
 *   runSummaryAssembler(inputs: SummaryAssemblerInputs): string
 *
 * Key invariants:
 *   - selectorPhase.selectorTrace = gateResult.traceEntries directly.
 *     No further merge — the gate already received allTraceEntries =
 *     [...fanOutResult.selectorTrace, ...gapCheckResult.syntheticTraceEntries]
 *     and returned the full annotated copy.
 *   - registryPhase.validationWarnings: RegistryValidationWarning.field stripped;
 *     output shape is { code, componentId, message } only.
 *   - registryPhase.componentCount = candidateSetSize + quarantinedComponents.length.
 *   - registryPhase.candidateSetSummary = candidateSetResult.summary.
 *   - selectorPhase.planningWarnings = fanOutResult + gapCheckResult + gateResult warnings.
 *   - conflictPhase.planningWarnings = conflictResult.globalWarnings only.
 *   - top-level warnings[] = accumulatedWarnings from plan.ts.
 *   - No raw component content, no raw history content, no provider/cache/model fields.
 *   - 8 required top-level keys — no injectionGatePhase.
 *   - [FUTURE-ONLY] extension keys (reentryPhase, analyzerPhase, summaryPhase,
 *     etc.) conditionally included when their trigger conditions are met
 *     (docs/20 §7; docs/16 §6.1, §6.2).
 *
 * Canonical: docs/04 §7.8; docs/06 §3.2; docs/11 §4.2, §6 Phase 11.
 */

import type { TraceOutput, TraceAssemblerInputs, SummaryAssemblerInputs } from '../types/trace.js';
import type { PlanningWarning } from '../types/warnings.js';

// ---------------------------------------------------------------------------
// stripWarningContext — serialization boundary guard
// ---------------------------------------------------------------------------

/**
 * Strip the TS-only 'context' field (and any other non-schema fields) from
 * PlanningWarning objects before trace serialization.
 *
 * planning-warning.schema.json uses additionalProperties: false and only
 * allows: { code, message, componentId? }. The TS PlanningWarning type adds
 * an optional 'context' field for in-process diagnostics, but it must never
 * reach serialized trace.json.
 *
 * Used for: selectorPhase.planningWarnings, conflictPhase.planningWarnings,
 * and top-level warnings[].
 *
 * Canonical: Phase 12.5 Cat F fix.
 */
function stripWarningContext(warnings: PlanningWarning[]): PlanningWarning[] {
  return warnings.map(w => {
    const raw = w as unknown as Record<string, unknown>;
    const stripped: PlanningWarning = {
      code: w.code,
      message: w.message,
    };
    if (typeof raw['componentId'] === 'string' && raw['componentId'].length > 0) {
      (stripped as unknown as Record<string, unknown>)['componentId'] = raw['componentId'];
    }
    return stripped;
  });
}

// ---------------------------------------------------------------------------
// runTraceAssembler
// ---------------------------------------------------------------------------

/**
 * Assemble the trace.json in-memory object from all prior phase outputs.
 *
 * Pure function — deterministic for all fields except run.runId and run timestamps,
 * which are observability metadata supplied by plan.ts (randomUUID + wall-clock).
 *
 * Canonical: docs/04 §7.8; docs/11 §6 Phase 11.
 */
export function runTraceAssembler(inputs: TraceAssemblerInputs): TraceOutput {
  const {
    runId,
    planningRunStartedAt,
    planningRunCompletedAt,
    schemaVersion,
    normalizedInputs,
    registryResult,
    candidateSetResult,
    fanOutResult,
    gapCheckResult,
    gateResult,
    conflictResult,
    budgetReport,
    promptPlan,
    postGateSummary,
    accumulatedWarnings,
    analyzerPhase,
    summaryPhase,
  } = inputs;

  const { requestSignals, policy } = normalizedInputs;

  // ---------------------------------------------------------------------------
  // run phase
  // ---------------------------------------------------------------------------
  const run: TraceOutput['run'] = {
    runId,
    planningRunStartedAt,
    planningRunCompletedAt,
    promptFamily: requestSignals.promptFamily,
    schemaVersion,
  };

  // ---------------------------------------------------------------------------
  // requestPhase
  // ---------------------------------------------------------------------------
  const requestSignalsSummary = {
    promptFamily: requestSignals.promptFamily,
    familyConfidence: requestSignals.familyConfidence,
    injectionSuspect: requestSignals.injectionSuspect,
  };

  const requestPhaseBase = {
    requestSignalsSummary,
    injectionSuspectFlag: requestSignals.injectionSuspect,
    promptFamily: requestSignals.promptFamily,
    familyConfidence: requestSignals.familyConfidence,
  };

  // Emit policy-fallback optional fields only when a fallback occurred.
  const requestPhase: TraceOutput['requestPhase'] =
    gateResult.policyFallbackReasons.length > 0
      ? {
          ...requestPhaseBase,
          requestedInjectionSuspectAction: policy.injectionSuspectAction,
          ...(gateResult.effectivePolicy !== null
            ? { effectiveInjectionSuspectAction: gateResult.effectivePolicy }
            : {}),
          policyFallbackReasons: gateResult.policyFallbackReasons,
        }
      : requestPhaseBase;

  // ---------------------------------------------------------------------------
  // registryPhase
  // ---------------------------------------------------------------------------

  // componentCount: total loaded = valid (candidate) + quarantined.
  const componentCount =
    candidateSetResult.summary.candidateSetSize +
    registryResult.quarantinedComponents.length;

  // validationWarnings: strip 'field' property — not in PlanningWarning schema
  // (schema uses additionalProperties: false with only code, componentId, message).
  const validationWarnings: PlanningWarning[] = registryResult.validationWarnings.map(w => ({
    code: w.code,
    componentId: w.componentId,
    message: w.message,
  }));

  const registryPhase: TraceOutput['registryPhase'] = {
    componentCount,
    quarantinedCount: registryResult.quarantinedComponents.length,
    validationWarnings,
    fatalErrors: [],  // only reached on successful run
    candidateSetSummary: candidateSetResult.summary,
  };

  // ---------------------------------------------------------------------------
  // selectorPhase
  // ---------------------------------------------------------------------------

  // selectorTrace = gateResult.traceEntries directly.
  // The gate received allTraceEntries = [...fanOutResult.selectorTrace,
  // ...gapCheckResult.syntheticTraceEntries] and returned the full annotated copy.
  // No further merge is needed or correct.
  const selectorTrace = gateResult.traceEntries;

  // planningWarnings = fanOut + gap-check + gate warnings combined.
  // Gate warnings are global injection warnings (injection_suspect_warn_and_continue etc.)
  // that belong in selectorPhase because there is no injectionGatePhase key.
  const selectorPlanningWarnings: PlanningWarning[] = [
    ...fanOutResult.warnings,
    ...gapCheckResult.warnings,
    ...gateResult.warnings,
  ];

  // unresolvedConflicts: component IDs resolved as fail_open_unresolved.
  const unresolvedConflicts = conflictResult.resolvedDecisions
    .filter(d => d.resolutionRule === 'fail_open_unresolved')
    .map(d => d.componentId);

  const selectorPhase: TraceOutput['selectorPhase'] = {
    selectorTrace,
    planningWarnings: stripWarningContext(selectorPlanningWarnings),
    unresolvedConflicts,
    selectorSummary: postGateSummary,
  };

  // ---------------------------------------------------------------------------
  // conflictPhase
  // ---------------------------------------------------------------------------

  // planningWarnings = conflictResult.globalWarnings only.
  // unresolvedConflictWarnings are NOT placed here — they are converted separately
  // in plan.ts and included in accumulatedWarnings (top-level warnings[]).
  const conflictPhase: TraceOutput['conflictPhase'] = {
    resolvedDecisions: conflictResult.resolvedDecisions,
    conflictResolutionTrace: conflictResult.conflictResolutionTrace,
    // Separate string[] — NOT inside conflictSummary.
    noConflictComponentIds: conflictResult.noConflictComponentIds,
    planningWarnings: stripWarningContext(conflictResult.globalWarnings),
  };

  // ---------------------------------------------------------------------------
  // budgetPhase
  // ---------------------------------------------------------------------------
  //
  // budget-report.schema.json uses different field names than the TS BudgetReport type.
  // We must produce a schema-compliant object:
  //   - budgetPlan.totalPromptTokenTarget from budgetReport.budgetTarget
  //   - budgetPlan.projectedOverflow is an integer (not boolean) — tokens over target
  //   - trimOrder (not trimActions): array of { componentId, budgetHint, tokensApprox, trimReason }
  //   - Only: budgetPlan, trimOrder, budgetOverflow required (additionalProperties: false)
  //
  // This mapping is necessary because the schema contract and TS type diverged before
  // Phase 11. The TS type is used for in-memory logic; the schema shape is for output.

  const schemaBudgetReport = {
    budgetPlan: {
      totalPromptTokenTarget: budgetReport.budgetTarget,
      selectedTokensApprox: budgetReport.budgetPlan.selectedTokensApprox,
      // schema: integer (token overflow amount); TS BudgetPlan has boolean
      projectedOverflow: budgetReport.budgetTarget > 0 && budgetReport.budgetPlan.selectedTokensApprox > budgetReport.budgetTarget
        ? budgetReport.budgetPlan.selectedTokensApprox - budgetReport.budgetTarget
        : 0,
    },
    // map trimActions → trimOrder (schema field name).
    // budgetHint is always non-null and schema-valid ('candidate_optional' or
    // 'expensive_optional') — guaranteed by budgeter since Phase 12.5 fix.
    trimOrder: budgetReport.trimActions.map(a => ({
      componentId: a.componentId,
      budgetHint: a.budgetHint,
      tokensApprox: a.tokensDropped,
      trimReason: a.reason,
    })),
    budgetOverflow: budgetReport.budgetOverflow,
  };

  const budgetPhase: TraceOutput['budgetPhase'] = {
    budgetReport: schemaBudgetReport,
    trimActions: budgetReport.trimActions,
    budgetOverflow: budgetReport.budgetOverflow,
  };

  // ---------------------------------------------------------------------------
  // planPhase — mirror from promptPlan
  // ---------------------------------------------------------------------------
  const planPhase: TraceOutput['planPhase'] = {
    selectedComponents: promptPlan.selectedComponents,
    omittedComponents: promptPlan.omittedComponents,
    deferredComponents: promptPlan.deferredComponents,
    riskFlags: promptPlan.riskFlags,
    failOpenReasons: promptPlan.failOpenReasons,
  };

  // ---------------------------------------------------------------------------
  // warnings (top-level) — global per-run warnings from all phases.
  // accumulatedWarnings already contains: result.warnings, normalizedInputs.warnings,
  // candidateSetResult.warnings, fanOutResult.warnings, gapCheckResult.warnings,
  // gateResult.warnings, conflictResult.globalWarnings, converted unresolvedConflictWarnings.
  //
  // Strip 'context' and any extra fields — planning-warning.schema.json uses
  // additionalProperties: false; only { code, componentId, message } are allowed.
  // Uses the same stripWarningContext helper as selectorPhase and conflictPhase.
  // ---------------------------------------------------------------------------
  const warnings: PlanningWarning[] = stripWarningContext(accumulatedWarnings);

  // ---------------------------------------------------------------------------
  // [FUTURE-ONLY] reentryPhase — conditionally emitted when reentryTurn === true.
  //
  // The trace schema (trace.schema.json) already defines reentryPhase as an
  // optional property (not in the required array) with additionalProperties: false
  // on the root object. Emitting it is AJV-safe.
  //
  // Canonical: docs/20 §7; docs/16 §6.3.
  // ---------------------------------------------------------------------------
  const reentryPhase = requestSignals.reentryTurn === true
    ? [
        {
          trigger: 'external_reentry',
          updatedLanes: ['open_commitments'],
          reentryTraceId: 'rt-' + runId,
          priorPlanId: requestSignals.priorPlanId ?? 'unknown_prior_plan',
        },
      ]
    : undefined;

  // ---------------------------------------------------------------------------
  // Assemble final TraceOutput — 8 required top-level keys + optional
  // [FUTURE-ONLY] extension keys (reentryPhase, analyzerPhase, summaryPhase,
  // etc.) when triggered.
  // ---------------------------------------------------------------------------
  return {
    run,
    requestPhase,
    registryPhase,
    selectorPhase,
    conflictPhase,
    budgetPhase,
    planPhase,
    warnings,
    ...(reentryPhase !== undefined ? { reentryPhase } : {}),
    ...(analyzerPhase !== undefined ? { analyzerPhase } : {}),
    ...(summaryPhase !== undefined ? { summaryPhase } : {}),
  };
}

// ---------------------------------------------------------------------------
// runSummaryAssembler
// ---------------------------------------------------------------------------

/**
 * Assemble the summary.md Markdown string from prior phase outputs.
 *
 * Deterministic — same inputs produce same output.
 * No raw component content, no raw history content.
 *
 * Template canonical: docs/06 §3.6; docs/11 §4.2.
 */
export function runSummaryAssembler(inputs: SummaryAssemblerInputs): string {
  const {
    promptFamily,
    selectorSummary,
    budgetReport,
    riskFlags,
    failOpenReasons,
    planningWarningsCount,
  } = inputs;

  const budgetTargetStr =
    budgetReport.budgetTarget === 0
      ? 'unconstrained'
      : String(budgetReport.budgetTarget);

  const riskFlagsStr =
    riskFlags.length > 0
      ? riskFlags.map(f => `- ${f}`).join('\n')
      : '(none)';

  const failOpenReasonsStr =
    failOpenReasons.length > 0
      ? failOpenReasons.map(r => `- ${r}`).join('\n')
      : '(none)';

  return [
    '# Context Planning Summary',
    '',
    `**Prompt Family:** ${promptFamily}`,
    '',
    '## Component Selection',
    '',
    selectorSummary.narrative,
    '',
    '## Budget',
    '',
    `- **Token Target:** ${budgetTargetStr}`,
    `- **Selected Tokens (approx):** ${budgetReport.totalSelectedTokensApprox}`,
    `- **Trimmed Tokens:** ${budgetReport.totalDroppedTokensApprox}`,
    `- **Budget Overflow:** ${budgetReport.budgetOverflow}`,
    '',
    '## Risk Flags',
    '',
    riskFlagsStr,
    '',
    '## Fail-Open Reasons',
    '',
    failOpenReasonsStr,
    '',
    '## Planning Warnings',
    '',
    `${planningWarningsCount} planning warning(s) accumulated. See trace.json for details.`,
    '',
  ].join('\n');
}
