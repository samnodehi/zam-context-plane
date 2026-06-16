/**
 * Phase 11: Trace and Summary Assembly tests.
 *
 * Tests runTraceAssembler() and runSummaryAssembler() (pure assemblers — no I/O).
 * CLI integration tests (Group J) verify file write and AJV validation
 * via process execution using the same spawnSync pattern as phases 2–10.
 *
 * Groups A–J cover all R2 acceptance criteria.
 *
 * Key invariants tested:
 *   - selectorTrace = gateResult.traceEntries (no further merge; decisionId unique)
 *   - validationWarnings strips 'field' from RegistryValidationWarning
 *   - componentCount = candidateSetSize + quarantinedCount
 *   - selectorPhase.planningWarnings includes fanOut + gapCheck + gate warnings
 *   - conflictPhase.planningWarnings = globalWarnings only
 *   - noConflictComponentIds is separate string[] (not in conflictSummary)
 *   - validateAndWriteTrace: behavioral abort test with fake validator
 *
 * Canonical: docs/04 §7.8; docs/06 §3.2; docs/11 §4.2, §6 Phase 11.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runTraceAssembler, runSummaryAssembler } from '../../src/core/trace-summary-assembler.js';
import { validateAndWriteTrace } from '../../src/cli/commands/plan.js';
import type { ValidateFn } from '../../src/cli/commands/plan.js';
import type { TraceAssemblerInputs, SummaryAssemblerInputs } from '../../src/types/trace.js';
import type { SelectorSummary, TraceEntry, SelectorFanOutResult } from '../../src/types/selection.js';
import type { ResolvedSelectionDecision, ConflictResolverResult } from '../../src/types/conflict.js';
import type { BudgetReport } from '../../src/types/budget.js';
import type { NormalizedInputs } from '../../src/types/normalized.js';
import type { RegistryResult, RegistryValidationWarning } from '../../src/types/registry.js';
import type { CandidateSetResult, CandidateSetSummary } from '../../src/types/candidate.js';
import type { InjectionGateResult } from '../../src/core/injection-gate.js';
import type { GapCheckResult } from '../../src/core/gap-check.js';
import type { PromptPlanOutput } from '../../src/types/plan.js';
import type { PlanningWarning } from '../../src/types/warnings.js';

// ---------------------------------------------------------------------------
// CLI helper
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = resolve(__dirname, '../../src/cli/index.ts');

function runCLI(args: string[]): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx/esm', entry, ...args],
    { encoding: 'utf8', timeout: 30_000 },
  );
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  };
}

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

function makeRegistryValidationWarning(
  overrides: Partial<RegistryValidationWarning> = {},
): RegistryValidationWarning {
  return {
    code: 'component_quarantined',
    componentId: 'comp.a',
    message: 'Component quarantined: test.',
    ...overrides,
  };
}

function makeRegistryResult(overrides: {
  quarantinedCount?: number;
  validationWarnings?: RegistryValidationWarning[];
} = {}): RegistryResult {
  const quarantinedComponents = Array.from(
    { length: overrides.quarantinedCount ?? 0 },
    (_, i) => ({
      id: `quarantined.${i}`,
      reason: 'test quarantine',
      riskLevel: 'low',
      rawEntry: {},
    }),
  );
  return {
    indexes: {
      componentsById: new Map(),
      componentsByType: new Map(),
      componentsByTag: new Map(),
      safetyCriticalIds: new Set(),
      trimmableCandidateIds: new Set(),
    },
    quarantinedComponents,
    validationWarnings: overrides.validationWarnings ?? [],
  };
}

function makeCandidateSetSummary(candidateSetSize = 1): CandidateSetSummary {
  return {
    candidateSetPolicy: 'all_non_quarantined',
    candidateSetSize,
    quarantinedExcluded: 0,
  };
}

function makeCandidateSetResult(candidateSetSize = 1): CandidateSetResult {
  return {
    summary: makeCandidateSetSummary(candidateSetSize),
    candidatesById: new Map(),
    warnings: [],
  };
}

function makeTraceEntry(decisionId: string, componentId = 'comp.a'): TraceEntry {
  return {
    decisionId,
    componentId,
    module: 'test-selector',
    action: 'include',
    path: 'default_include',
    failOpen: false,
    estimatedSavings: { tokens: 0 },
    selector: 'test',
  };
}

function makeFanOutResult(traceEntries: TraceEntry[] = []): SelectorFanOutResult {
  return {
    decisions: [],
    selectorTrace: traceEntries,
    selectorSummary: makeSelectorSummary(),
    referencedUnknownComponents: [],
    warnings: [],
  };
}

function makeGapCheckResult(warnings: PlanningWarning[] = []): Pick<GapCheckResult, 'warnings'> {
  return { warnings };
}

function makeGateResult(overrides: Partial<InjectionGateResult> = {}): InjectionGateResult {
  return {
    decisions: [],
    traceEntries: [],
    warnings: [],
    policyFallbackReasons: [],
    gateApplied: false,
    effectivePolicy: null,
    ...overrides,
  };
}

function makeSelectorSummary(overrides: Partial<SelectorSummary> = {}): SelectorSummary {
  return {
    totalEvaluated: 1,
    decidedInclude: 1,
    decidedOmit: 0,
    decidedDefer: 0,
    defaultDefer: 0,
    runtimeUnavailableDefer: 0,
    failOpenInclude: 0,
    conflictsIdentified: 0,
    unknownReferences: 0,
    narrative: '1 components evaluated. 1 included, 0 omitted, 0 deferred (0 default, 0 runtime-unavailable), 0 fail-open. 0 conflict(s) identified.',
    ...overrides,
  };
}

function makeResolvedDecision(
  componentId: string,
  overrides: Partial<ResolvedSelectionDecision> = {},
): ResolvedSelectionDecision {
  return {
    componentId,
    finalAction: 'include',
    finalPath: 'default_include',
    resolvedBy: 'conflict_resolver',
    inputDecisionIds: ['d-' + componentId],
    resolutionRule: 'no_conflict',
    losingDecisions: [],
    warningsEmitted: [],
    resolvedAt: 1,
    mergeRuleTrace: 'no_hint',
    ...overrides,
  };
}

function makeConflictResult(overrides: Partial<ConflictResolverResult> = {}): ConflictResolverResult {
  return {
    resolvedDecisions: [makeResolvedDecision('comp.a')],
    conflictResolutionTrace: [],
    noConflictComponentIds: ['comp.a'],
    conflictSummary: {
      totalComponents: 1,
      noConflict: 1,
      resolvedConflicts: 0,
      failOpenResolutions: 0,
      unresolvedConflictWarnings: 0,
      narrative: '1 total. 1 no-conflict.',
    },
    unresolvedConflictWarnings: [],
    globalWarnings: [],
    ...overrides,
  };
}

function makeEmptyBudgetReport(): BudgetReport {
  return {
    budgetPlan: { selectedTokensApprox: 0, projectedOverflow: false },
    totalSelectedTokensApprox: 0,
    totalDroppedTokensApprox: 0,
    droppedComponents: [],
    budgetTarget: 0,
    budgetUtilization: 0,
    budgetOverflow: false,
    riskFlags: [],
    conservativeEstimatesUsed: [],
    trimActions: [],
  };
}

function makeNormalizedInputs(overrides: { injectionSuspectAction?: string } = {}): NormalizedInputs {
  return {
    requestSignals: {
      promptFamily: 'general_default',
      familyConfidence: 0.0,
      injectionSuspect: false,
    },
    runtime: {
      availableToolIds: [],
      unavailableToolIds: [],
      capabilityInventoryComplete: false,
      runtimeLabel: 'test',
    },
    history: {
      lanesPresent: [],
      durableConstraintsPresent: false,
      openCommitmentsPresent: false,
      recentRawTurnCount: 0,
      totalHistoryTokensApprox: 0,
      historyMalformed: false,
    },
    budget: null,
    constraints: null,
    policy: {
      failOpenThreshold: 0.7,
      deterministicOnly: true,
      injectionSuspectAction: overrides.injectionSuspectAction ?? 'warn_and_continue',
    },
    activeIds: { activeSkillIds: [], activeToolIds: [], activeMemoryIds: [] },
    warnings: [],
  };
}

function makePromptPlan(): PromptPlanOutput {
  return {
    schemaVersion: 'v0',
    promptFamily: 'general_default',
    selectedComponents: [
      { componentId: 'comp.a', action: 'include', path: 'default_include', reason: 'default include' },
    ],
    omittedComponents: [],
    deferredComponents: [],
    budgetPlan: { totalPromptTokenTarget: 0, selectedTokensApprox: 0, projectedOverflow: 0 },
    estimatedTokens: { total: 0 },
    riskFlags: [],
    failOpenReasons: [],
    planningWarnings: [],
    budgetHintSummary: {
      protectedCount: 0,
      overBudgetProtectedCount: 0,
      candidateOptionalCount: 0,
      expensiveOptionalCount: 0,
      unknownCostCount: 0,
    },
  };
}

/**
 * Build a minimal but complete TraceAssemblerInputs for happy-path tests.
 * Override individual fields as needed.
 */
function makeInputs(overrides: Partial<TraceAssemblerInputs> = {}): TraceAssemblerInputs {
  const traceEntry = makeTraceEntry('decision-1');
  const gateResult = makeGateResult({ traceEntries: [traceEntry] });
  return {
    runId: 'test-run-id',
    planningRunStartedAt: '2026-01-01T00:00:00.000Z',
    planningRunCompletedAt: '2026-01-01T00:00:01.000Z',
    schemaVersion: 'v0',
    normalizedInputs: makeNormalizedInputs(),
    registryResult: makeRegistryResult(),
    candidateSetResult: makeCandidateSetResult(1),
    fanOutResult: makeFanOutResult([traceEntry]),
    gapCheckResult: makeGapCheckResult(),
    gateResult,
    conflictResult: makeConflictResult(),
    budgetReport: makeEmptyBudgetReport(),
    promptPlan: makePromptPlan(),
    postGateSummary: makeSelectorSummary(),
    accumulatedWarnings: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Group A — run phase assembly
// ---------------------------------------------------------------------------

describe('Group A — run phase assembly', () => {
  it('A1: run.runId is a non-empty string', () => {
    const result = runTraceAssembler(makeInputs({ runId: 'my-run-uuid' }));
    expect(typeof result.run.runId).toBe('string');
    expect(result.run.runId.length).toBeGreaterThan(0);
    expect(result.run.runId).toBe('my-run-uuid');
  });

  it('A2: run.planningRunStartedAt and planningRunCompletedAt are non-empty strings', () => {
    const result = runTraceAssembler(makeInputs({
      planningRunStartedAt: '2026-01-01T00:00:00.000Z',
      planningRunCompletedAt: '2026-01-01T00:00:01.000Z',
    }));
    expect(typeof result.run.planningRunStartedAt).toBe('string');
    expect(result.run.planningRunStartedAt.length).toBeGreaterThan(0);
    expect(typeof result.run.planningRunCompletedAt).toBe('string');
    expect(result.run.planningRunCompletedAt.length).toBeGreaterThan(0);
  });

  it('A3: run.promptFamily matches normalizedInputs.requestSignals.promptFamily', () => {
    const ni = makeNormalizedInputs();
    ni.requestSignals.promptFamily = 'coding_review';
    const result = runTraceAssembler(makeInputs({ normalizedInputs: ni }));
    expect(result.run.promptFamily).toBe('coding_review');
  });

  it('A4: run.schemaVersion is v0', () => {
    const result = runTraceAssembler(makeInputs({ schemaVersion: 'v0' }));
    expect(result.run.schemaVersion).toBe('v0');
  });
});

// ---------------------------------------------------------------------------
// Group B — requestPhase assembly
// ---------------------------------------------------------------------------

describe('Group B — requestPhase assembly', () => {
  it('B1: requestSignalsSummary contains promptFamily, familyConfidence, injectionSuspect', () => {
    const ni = makeNormalizedInputs();
    ni.requestSignals.promptFamily = 'coding_review';
    ni.requestSignals.familyConfidence = 0.9;
    ni.requestSignals.injectionSuspect = true;
    const result = runTraceAssembler(makeInputs({ normalizedInputs: ni }));
    expect(result.requestPhase.requestSignalsSummary).toEqual({
      promptFamily: 'coding_review',
      familyConfidence: 0.9,
      injectionSuspect: true,
    });
  });

  it('B2: injectionSuspectFlag mirrors requestSignalsSummary.injectionSuspect', () => {
    const ni = makeNormalizedInputs();
    ni.requestSignals.injectionSuspect = true;
    const result = runTraceAssembler(makeInputs({ normalizedInputs: ni }));
    expect(result.requestPhase.injectionSuspectFlag).toBe(true);
    expect(result.requestPhase.injectionSuspectFlag).toBe(result.requestPhase.requestSignalsSummary.injectionSuspect);
  });

  it('B3: top-level promptFamily/familyConfidence mirror requestSignalsSummary', () => {
    const ni = makeNormalizedInputs();
    ni.requestSignals.promptFamily = 'security_checklist';
    ni.requestSignals.familyConfidence = 0.85;
    const result = runTraceAssembler(makeInputs({ normalizedInputs: ni }));
    expect(result.requestPhase.promptFamily).toBe('security_checklist');
    expect(result.requestPhase.familyConfidence).toBe(0.85);
    expect(result.requestPhase.promptFamily).toBe(result.requestPhase.requestSignalsSummary.promptFamily);
  });

  it('B4: policy-fallback fields absent when policyFallbackReasons is empty', () => {
    const gateResult = makeGateResult({ policyFallbackReasons: [], effectivePolicy: null });
    const result = runTraceAssembler(makeInputs({ gateResult }));
    expect(result.requestPhase).not.toHaveProperty('requestedInjectionSuspectAction');
    expect(result.requestPhase).not.toHaveProperty('effectiveInjectionSuspectAction');
    expect(result.requestPhase).not.toHaveProperty('policyFallbackReasons');
  });

  it('B5: policy-fallback fields present when policyFallbackReasons is non-empty', () => {
    const gateResult = makeGateResult({
      policyFallbackReasons: ['halt_planning_recognized_not_implemented_normalized_to_warn_and_continue'],
      effectivePolicy: 'warn_and_continue',
      gateApplied: true,
    });
    const ni = makeNormalizedInputs({ injectionSuspectAction: 'halt_planning' });
    const result = runTraceAssembler(makeInputs({ normalizedInputs: ni, gateResult }));
    expect(result.requestPhase.requestedInjectionSuspectAction).toBe('halt_planning');
    expect(result.requestPhase.effectiveInjectionSuspectAction).toBe('warn_and_continue');
    expect(result.requestPhase.policyFallbackReasons).toEqual([
      'halt_planning_recognized_not_implemented_normalized_to_warn_and_continue',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Group C — registryPhase assembly
// ---------------------------------------------------------------------------

describe('Group C — registryPhase assembly', () => {
  it('C1: componentCount = candidateSetSize + quarantinedCount', () => {
    const registryResult = makeRegistryResult({ quarantinedCount: 2 });
    const candidateSetResult = makeCandidateSetResult(5);
    const result = runTraceAssembler(makeInputs({ registryResult, candidateSetResult }));
    expect(result.registryPhase.componentCount).toBe(7); // 5 + 2
  });

  it('C2: quarantinedCount equals registryResult.quarantinedComponents.length', () => {
    const registryResult = makeRegistryResult({ quarantinedCount: 3 });
    const result = runTraceAssembler(makeInputs({ registryResult }));
    expect(result.registryPhase.quarantinedCount).toBe(3);
  });

  it('C3: validationWarnings items have only { code, componentId, message } — field property absent', () => {
    const registryWarningWithField: RegistryValidationWarning = {
      code: 'duplicate_id_rejected',
      componentId: 'comp.dup',
      message: 'Duplicate ID rejected.',
      field: 'id',    // must be stripped
    };
    const registryResult = makeRegistryResult({ validationWarnings: [registryWarningWithField] });
    const result = runTraceAssembler(makeInputs({ registryResult }));
    expect(result.registryPhase.validationWarnings).toHaveLength(1);
    const mapped = result.registryPhase.validationWarnings[0];
    // field property must be absent
    expect(mapped).not.toHaveProperty('field');
    // required fields present
    expect(mapped.code).toBe('duplicate_id_rejected');
    expect(mapped.componentId).toBe('comp.dup');
    expect(mapped.message).toBe('Duplicate ID rejected.');
  });

  it('C4: validationWarnings code and message are preserved through mapping', () => {
    const w = makeRegistryValidationWarning({
      code: 'registry_default_action_overridden',
      componentId: 'comp.b',
      message: 'Default action overridden.',
    });
    const registryResult = makeRegistryResult({ validationWarnings: [w] });
    const result = runTraceAssembler(makeInputs({ registryResult }));
    expect(result.registryPhase.validationWarnings[0].code).toBe('registry_default_action_overridden');
    expect(result.registryPhase.validationWarnings[0].message).toBe('Default action overridden.');
  });

  it('C5: fatalErrors is empty array on successful run', () => {
    const result = runTraceAssembler(makeInputs());
    expect(result.registryPhase.fatalErrors).toEqual([]);
  });

  it('C6: candidateSetSummary.candidateSetPolicy is all_non_quarantined', () => {
    const result = runTraceAssembler(makeInputs());
    expect(result.registryPhase.candidateSetSummary.candidateSetPolicy).toBe('all_non_quarantined');
  });

  it('C7: candidateSetSummary.candidateSetSize matches candidateSetResult.summary.candidateSetSize', () => {
    const candidateSetResult = makeCandidateSetResult(7);
    const result = runTraceAssembler(makeInputs({ candidateSetResult }));
    expect(result.registryPhase.candidateSetSummary.candidateSetSize).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Group D — selectorPhase assembly
// ---------------------------------------------------------------------------

describe('Group D — selectorPhase assembly', () => {
  it('D1: selectorTrace equals gateResult.traceEntries exactly (no further merge)', () => {
    const te1 = makeTraceEntry('d1', 'comp.a');
    const te2 = makeTraceEntry('d2', 'comp.b');
    const gateResult = makeGateResult({ traceEntries: [te1, te2] });
    const result = runTraceAssembler(makeInputs({ gateResult }));
    expect(result.selectorPhase.selectorTrace).toBe(gateResult.traceEntries); // same reference
    expect(result.selectorPhase.selectorTrace).toHaveLength(2);
  });

  it('D2: each decisionId appears exactly once in selectorTrace (no duplicates)', () => {
    const te1 = makeTraceEntry('uniq-1', 'comp.a');
    const te2 = makeTraceEntry('uniq-2', 'comp.b');
    const te3 = makeTraceEntry('uniq-3', 'comp.c');
    const gateResult = makeGateResult({ traceEntries: [te1, te2, te3] });
    const result = runTraceAssembler(makeInputs({ gateResult }));
    const decisionIds = result.selectorPhase.selectorTrace.map(e => e.decisionId);
    const uniqueIds = new Set(decisionIds);
    expect(uniqueIds.size).toBe(decisionIds.length);
    expect([...uniqueIds]).toEqual(['uniq-1', 'uniq-2', 'uniq-3']);
  });

  it('D3: gate-converted entries preserve actionChanged, originalCandidateAction, originalCandidatePath in selectorTrace', () => {
    const te: TraceEntry = {
      ...makeTraceEntry('converted-1', 'comp.converted'),
      action: 'include',
      failOpen: true,
      injectionSuspect: true,
      injectionSuspectAction: 'fail_open_all',
      actionChanged: true,
      originalCandidateAction: 'omit',
      originalCandidatePath: 'safe_to_omit_match',
      warningsEmitted: [],
    };
    const gateResult = makeGateResult({ traceEntries: [te] });
    const result = runTraceAssembler(makeInputs({ gateResult }));
    const found = result.selectorPhase.selectorTrace[0];
    expect(found.actionChanged).toBe(true);
    expect(found.originalCandidateAction).toBe('omit');
    expect(found.originalCandidatePath).toBe('safe_to_omit_match');
  });

  it('D4: selectorPhase.planningWarnings includes fanOutResult.warnings', () => {
    const w: PlanningWarning = { code: 'path_a_null_evidence', message: 'Fan-out warning.' };
    const fanOutResult = makeFanOutResult([]);
    fanOutResult.warnings = [w];
    const result = runTraceAssembler(makeInputs({ fanOutResult }));
    expect(result.selectorPhase.planningWarnings).toContainEqual(w);
  });

  it('D5: selectorPhase.planningWarnings includes gapCheckResult.warnings', () => {
    const w: PlanningWarning = { code: 'unexpected_ladder_fallback', componentId: 'comp.gap', message: 'Gap warning.' };
    const gapCheckResult = makeGapCheckResult([w]);
    const result = runTraceAssembler(makeInputs({ gapCheckResult }));
    expect(result.selectorPhase.planningWarnings).toContainEqual(w);
  });

  it('D6: selectorPhase.planningWarnings includes gateResult.warnings', () => {
    const w: PlanningWarning = { code: 'injection_suspect_warn_and_continue', message: 'Gate warning.' };
    const gateResult = makeGateResult({ warnings: [w], traceEntries: [] });
    const result = runTraceAssembler(makeInputs({ gateResult }));
    expect(result.selectorPhase.planningWarnings).toContainEqual(w);
  });

  it('D7: unresolvedConflicts contains componentIds where resolutionRule === fail_open_unresolved', () => {
    const conflictResult = makeConflictResult({
      resolvedDecisions: [
        makeResolvedDecision('comp.unresolved', { resolutionRule: 'fail_open_unresolved' }),
        makeResolvedDecision('comp.resolved', { resolutionRule: 'no_conflict' }),
      ],
      noConflictComponentIds: ['comp.resolved'],
    });
    const result = runTraceAssembler(makeInputs({ conflictResult }));
    expect(result.selectorPhase.unresolvedConflicts).toEqual(['comp.unresolved']);
  });

  it('D8: unresolvedConflicts is [] when no fail_open_unresolved decisions', () => {
    const conflictResult = makeConflictResult({
      resolvedDecisions: [makeResolvedDecision('comp.ok', { resolutionRule: 'no_conflict' })],
      noConflictComponentIds: ['comp.ok'],
    });
    const result = runTraceAssembler(makeInputs({ conflictResult }));
    expect(result.selectorPhase.unresolvedConflicts).toEqual([]);
  });

  it('D9: selectorSummary is postGateSummary (reflects gate conversions)', () => {
    const postGateSummary = makeSelectorSummary({
      decidedInclude: 3,
      decidedOmit: 0,
      failOpenInclude: 1,
      narrative: '3 included, gate converted 1.',
    });
    const result = runTraceAssembler(makeInputs({ postGateSummary }));
    expect(result.selectorPhase.selectorSummary).toBe(postGateSummary); // same reference
    expect(result.selectorPhase.selectorSummary.decidedInclude).toBe(3);
    expect(result.selectorPhase.selectorSummary.failOpenInclude).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Group E — conflictPhase assembly
// ---------------------------------------------------------------------------

describe('Group E — conflictPhase assembly', () => {
  it('E1: resolvedDecisions passes through conflictResult.resolvedDecisions', () => {
    const rd = makeResolvedDecision('comp.e1');
    const conflictResult = makeConflictResult({ resolvedDecisions: [rd] });
    const result = runTraceAssembler(makeInputs({ conflictResult }));
    expect(result.conflictPhase.resolvedDecisions).toContain(rd);
  });

  it('E2: conflictResolutionTrace passes through', () => {
    const crt = {
      componentId: 'comp.conflict',
      inputDecisions: [],
      winnerDecision: makeResolvedDecision('comp.conflict'),
      losingDecisions: [],
      resolutionRule: 'safety_hard_protection' as const,
      warningsEmitted: [],
      resolvedAt: 1,
    };
    const conflictResult = makeConflictResult({ conflictResolutionTrace: [crt] });
    const result = runTraceAssembler(makeInputs({ conflictResult }));
    expect(result.conflictPhase.conflictResolutionTrace).toContain(crt);
  });

  it('E3: noConflictComponentIds is a separate top-level string[] on conflictPhase (not inside conflictSummary)', () => {
    const conflictResult = makeConflictResult({
      noConflictComponentIds: ['comp.nc1', 'comp.nc2'],
    });
    const result = runTraceAssembler(makeInputs({ conflictResult }));
    // separate string[] at top level
    expect(result.conflictPhase.noConflictComponentIds).toEqual(['comp.nc1', 'comp.nc2']);
    // must not exist inside conflictSummary (conflictSummary is NOT in TraceOutput.conflictPhase)
    expect(result.conflictPhase).not.toHaveProperty('conflictSummary');
  });

  it('E4: accounting invariant: noConflictComponentIds.length + conflictResolutionTrace.length equals candidateSetSize', () => {
    const candidateSetResult = makeCandidateSetResult(3);
    const rd1 = makeResolvedDecision('comp.a');
    const rd2 = makeResolvedDecision('comp.b');
    const rd3 = makeResolvedDecision('comp.c', { resolutionRule: 'safety_hard_protection' });
    const conflictResult = makeConflictResult({
      resolvedDecisions: [rd1, rd2, rd3],
      noConflictComponentIds: ['comp.a', 'comp.b'],
      conflictResolutionTrace: [{
        componentId: 'comp.c',
        inputDecisions: [],
        winnerDecision: rd3,
        losingDecisions: [],
        resolutionRule: 'safety_hard_protection',
        warningsEmitted: [],
        resolvedAt: 1,
      }],
    });
    const result = runTraceAssembler(makeInputs({ candidateSetResult, conflictResult }));
    const size = result.registryPhase.candidateSetSummary.candidateSetSize;
    const count = result.conflictPhase.noConflictComponentIds.length +
                  result.conflictPhase.conflictResolutionTrace.length;
    expect(count).toBe(size); // 2 + 1 = 3
  });

  it('E5: conflictPhase.planningWarnings equals conflictResult.globalWarnings (not unresolvedConflictWarnings)', () => {
    const globalW: PlanningWarning = { code: 'history_malformed_conflict_occurred', message: 'History malformed.' };
    const conflictResult = makeConflictResult({
      globalWarnings: [globalW],
      unresolvedConflictWarnings: [
        {
          componentId: 'comp.unres',
          inputDecisionIds: [],
          conflictDescription: 'Unresolved.',
          warningCode: 'unresolved_conflict_fail_open',
        },
      ],
    });
    const result = runTraceAssembler(makeInputs({ conflictResult }));
    // Must contain globalWarning
    expect(result.conflictPhase.planningWarnings).toContainEqual(globalW);
    // Must NOT contain unresolvedConflictWarning (it has a different shape and is NOT placed here)
    expect(result.conflictPhase.planningWarnings.some(
      w => w.code === 'unresolved_conflict_fail_open',
    )).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Group F — budgetPhase assembly
// ---------------------------------------------------------------------------

describe('Group F — budgetPhase assembly', () => {
  it('F1: budgetPhase.budgetReport is schema-compliant shape mapped from BudgetReport', () => {
    // The trace assembler maps the TS BudgetReport to a budget-report.schema.json-compatible shape.
    // The schema requires: budgetPlan (with totalPromptTokenTarget), trimOrder, budgetOverflow.
    // trimActions and other TS-only fields are NOT in the schema shape.
    const budgetReport = makeEmptyBudgetReport();
    const result = runTraceAssembler(makeInputs({ budgetReport }));
    const schemaBudgetReport = result.budgetPhase.budgetReport as Record<string, unknown>;
    // schema required fields present
    expect(schemaBudgetReport).toHaveProperty('budgetPlan');
    expect(schemaBudgetReport).toHaveProperty('trimOrder');
    expect(schemaBudgetReport).toHaveProperty('budgetOverflow');
    // budgetPlan has totalPromptTokenTarget (schema-required)
    const bp = schemaBudgetReport['budgetPlan'] as Record<string, unknown>;
    expect(bp).toHaveProperty('totalPromptTokenTarget');
    // trimOrder (not trimActions) is empty for unconstrained
    expect(Array.isArray(schemaBudgetReport['trimOrder'])).toBe(true);
    expect((schemaBudgetReport['trimOrder'] as unknown[]).length).toBe(0);
    // budgetOverflow mirrors BudgetReport.budgetOverflow
    expect(schemaBudgetReport['budgetOverflow']).toBe(budgetReport.budgetOverflow);
  });

  it('F2: trimActions passes through budgetReport.trimActions', () => {
    const ta = {
      componentId: 'comp.trimmed',
      budgetHint: 'candidate_optional' as const,
      tokensDropped: 200,
      reason: 'trim_eligible_optional',
    };
    const budgetReport = { ...makeEmptyBudgetReport(), trimActions: [ta] };
    const result = runTraceAssembler(makeInputs({ budgetReport }));
    expect(result.budgetPhase.trimActions).toContain(ta);
  });

  it('F3a: budgetOverflow mirrors budgetReport.budgetOverflow = false', () => {
    const budgetReport = { ...makeEmptyBudgetReport(), budgetOverflow: false };
    const result = runTraceAssembler(makeInputs({ budgetReport }));
    expect(result.budgetPhase.budgetOverflow).toBe(false);
  });

  it('F3b: budgetOverflow mirrors budgetReport.budgetOverflow = true', () => {
    const budgetReport = { ...makeEmptyBudgetReport(), budgetOverflow: true };
    const result = runTraceAssembler(makeInputs({ budgetReport }));
    expect(result.budgetPhase.budgetOverflow).toBe(true);
  });

  it('F4: trimActions is [] when no trimming occurred (unconstrained)', () => {
    const result = runTraceAssembler(makeInputs({ budgetReport: makeEmptyBudgetReport() }));
    expect(result.budgetPhase.trimActions).toEqual([]);
  });

  it('F5: all trimActions have schema-valid budgetHint and appear in trimOrder; unknown-cost preserved via reason', () => {
    // Post Phase 12.5: TrimActionEntry.budgetHint is always 'candidate_optional' or
    // 'expensive_optional'. Unknown/defaulted cost is represented via
    // budgetHint: 'candidate_optional' + reason: 'budget_cost_unknown'.
    const taUnknownCost = {
      componentId: 'comp.unknown-cost',
      budgetHint: 'candidate_optional' as const,
      tokensDropped: 200,
      reason: 'budget_cost_unknown',
    };
    const taWithHint = {
      componentId: 'comp.with-hint',
      budgetHint: 'candidate_optional' as const,
      tokensDropped: 150,
      reason: 'trim_eligible_optional',
    };
    const budgetReport = {
      ...makeEmptyBudgetReport(),
      trimActions: [taUnknownCost, taWithHint],
    };
    const result = runTraceAssembler(makeInputs({ budgetReport }));

    // budgetPhase.trimActions retains both entries (raw pass-through)
    expect(result.budgetPhase.trimActions).toHaveLength(2);
    expect(result.budgetPhase.trimActions).toContain(taUnknownCost);
    expect(result.budgetPhase.trimActions).toContain(taWithHint);

    // schemaBudgetReport.trimOrder includes both entries (no null filter needed)
    const schemaBudgetReport = result.budgetPhase.budgetReport as Record<string, unknown>;
    const trimOrder = schemaBudgetReport['trimOrder'] as Array<Record<string, unknown>>;
    expect(trimOrder).toHaveLength(2);
    expect(trimOrder.some(r => r['componentId'] === 'comp.unknown-cost')).toBe(true);
    expect(trimOrder.some(r => r['componentId'] === 'comp.with-hint')).toBe(true);
    // unknown-cost entry preserves reason
    const unknownEntry = trimOrder.find(r => r['componentId'] === 'comp.unknown-cost')!;
    expect(unknownEntry['budgetHint']).toBe('candidate_optional');
    expect(unknownEntry['trimReason']).toBe('budget_cost_unknown');
  });
});

// ---------------------------------------------------------------------------
// Group G — planPhase assembly
// ---------------------------------------------------------------------------

describe('Group G — planPhase assembly', () => {
  it('G1: selectedComponents mirrors promptPlan.selectedComponents', () => {
    const promptPlan = makePromptPlan();
    const result = runTraceAssembler(makeInputs({ promptPlan }));
    expect(result.planPhase.selectedComponents).toBe(promptPlan.selectedComponents);
  });

  it('G2: omittedComponents mirrors promptPlan.omittedComponents', () => {
    const promptPlan = makePromptPlan();
    promptPlan.omittedComponents = [
      { componentId: 'comp.omit', action: 'omit', path: 'safe_to_omit_match', reason: 'test' },
    ];
    const result = runTraceAssembler(makeInputs({ promptPlan }));
    expect(result.planPhase.omittedComponents).toBe(promptPlan.omittedComponents);
  });

  it('G3: deferredComponents all carry path field', () => {
    const promptPlan = makePromptPlan();
    promptPlan.deferredComponents = [
      { componentId: 'comp.defer', action: 'defer', path: 'runtime_unavailable', reason: 'tool unavailable' },
    ];
    const result = runTraceAssembler(makeInputs({ promptPlan }));
    for (const entry of result.planPhase.deferredComponents) {
      expect(entry.path).toBeDefined();
      expect(entry.path.length).toBeGreaterThan(0);
    }
  });

  it('G4: riskFlags mirrors promptPlan.riskFlags', () => {
    const promptPlan = makePromptPlan();
    promptPlan.riskFlags = ['budget_infeasible_protected_component'];
    const result = runTraceAssembler(makeInputs({ promptPlan }));
    expect(result.planPhase.riskFlags).toEqual(['budget_infeasible_protected_component']);
  });

  it('G5: failOpenReasons mirrors promptPlan.failOpenReasons', () => {
    const promptPlan = makePromptPlan();
    promptPlan.failOpenReasons = ['path_fail_open:componentId:comp.a:no_conflict'];
    const result = runTraceAssembler(makeInputs({ promptPlan }));
    expect(result.planPhase.failOpenReasons).toEqual(['path_fail_open:componentId:comp.a:no_conflict']);
  });
});

// ---------------------------------------------------------------------------
// Group H — global warnings[] assembly
// ---------------------------------------------------------------------------

describe('Group H — global warnings[] assembly', () => {
  it('H1: warnings content matches accumulatedWarnings (schema fields only)', () => {
    // Assembler maps accumulatedWarnings to strip 'context' and other non-schema fields.
    // Only { code, message, componentId? } are retained (additionalProperties: false).
    const aw: PlanningWarning[] = [
      { code: 'selector_policy_defaulted', message: 'Policy defaulted.' },
    ];
    const result = runTraceAssembler(makeInputs({ accumulatedWarnings: aw }));
    // deep equal — not same reference, since map() creates new objects
    expect(result.warnings).toEqual([{ code: 'selector_policy_defaulted', message: 'Policy defaulted.' }]);
    // 'context' field must be absent (stripped by assembler)
    expect((result.warnings[0] as Record<string, unknown>)['context']).toBeUndefined();
  });

  it('H2: warnings includes gateResult.warnings when gate warnings are in accumulatedWarnings', () => {
    const gw: PlanningWarning = { code: 'injection_suspect_warn_and_continue', message: 'Gate.' };
    // accumulatedWarnings in plan.ts includes gateResult.warnings
    const accumulatedWarnings: PlanningWarning[] = [gw];
    const result = runTraceAssembler(makeInputs({ accumulatedWarnings }));
    expect(result.warnings).toContainEqual(gw);
  });

  it('H3: warnings is [] when no warnings accumulated', () => {
    const result = runTraceAssembler(makeInputs({ accumulatedWarnings: [] }));
    expect(result.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Group I — runSummaryAssembler (summary.md content)
// ---------------------------------------------------------------------------

describe('Group I — runSummaryAssembler', () => {
  function makeInputsSummary(overrides: Partial<SummaryAssemblerInputs> = {}): SummaryAssemblerInputs {
    return {
      promptFamily: 'general_default',
      selectorSummary: makeSelectorSummary(),
      budgetReport: makeEmptyBudgetReport(),
      riskFlags: [],
      failOpenReasons: [],
      planningWarningsCount: 0,
      ...overrides,
    };
  }

  it('I1: output starts with # Context Planning Summary', () => {
    const result = runSummaryAssembler(makeInputsSummary());
    expect(result.startsWith('# Context Planning Summary')).toBe(true);
  });

  it('I2: promptFamily appears in output', () => {
    const result = runSummaryAssembler(makeInputsSummary({ promptFamily: 'security_checklist' }));
    expect(result).toContain('security_checklist');
  });

  it('I3: selectorSummary.narrative appears verbatim', () => {
    const summary = makeSelectorSummary({ narrative: 'Custom narrative text.' });
    const result = runSummaryAssembler(makeInputsSummary({ selectorSummary: summary }));
    expect(result).toContain('Custom narrative text.');
  });

  it('I4: budget section shows unconstrained when budgetTarget === 0', () => {
    const result = runSummaryAssembler(makeInputsSummary({
      budgetReport: { ...makeEmptyBudgetReport(), budgetTarget: 0 },
    }));
    expect(result).toContain('unconstrained');
  });

  it('I5: budget section shows numeric target when budgetTarget > 0', () => {
    const result = runSummaryAssembler(makeInputsSummary({
      budgetReport: { ...makeEmptyBudgetReport(), budgetTarget: 8000 },
    }));
    expect(result).toContain('8000');
    expect(result).not.toContain('unconstrained');
  });

  it('I6: risk flags appear as list items; (none) when empty', () => {
    const resultNone = runSummaryAssembler(makeInputsSummary({ riskFlags: [] }));
    expect(resultNone).toContain('(none)');

    const resultList = runSummaryAssembler(makeInputsSummary({
      riskFlags: ['budget_infeasible_protected_component'],
    }));
    expect(resultList).toContain('- budget_infeasible_protected_component');
  });

  it('I7: fail-open reasons appear as list items; (none) when empty', () => {
    const resultNone = runSummaryAssembler(makeInputsSummary({ failOpenReasons: [] }));
    expect(resultNone).toContain('(none)');

    const resultList = runSummaryAssembler(makeInputsSummary({
      failOpenReasons: ['path_fail_open:componentId:comp.a:no_conflict'],
    }));
    expect(resultList).toContain('- path_fail_open:componentId:comp.a:no_conflict');
  });

  it('I8: planning warning count reflected in output', () => {
    const result = runSummaryAssembler(makeInputsSummary({ planningWarningsCount: 3 }));
    expect(result).toContain('3 planning warning(s)');
  });
});

// ---------------------------------------------------------------------------
// Group J — CLI integration (AJV + file write)
// ---------------------------------------------------------------------------

describe('Group J — CLI integration (AJV + file write)', () => {
  const tempDirs: string[] = [];

  // Minimal schema-valid registry component
  const REGISTRY_COMPONENT = {
    id: 'scaffold.test',
    type: 'scaffold',
    title: 'Test Scaffold',
    summary: 'A test scaffold component',
    source: 'test',
    tokensApprox: 100,
    charsApprox: 400,
    riskLevel: 'low',
    retainPolicy: 'optional',
    omissionPolicy: 'allow',
    defaultAction: 'include',
    budgetPriority: 5,
    requiredWhen: [],
    safeToOmitWhen: [],
    evidenceRequired: null,
    tags: [],
    version: '1.0.0',
    hash: null,
  };

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'ctx-phase11-'));
    tempDirs.push(dir);
    return dir;
  }

  function setupFixtures(td: string): { reqFile: string; regFile: string } {
    const reqFile = join(td, 'request.txt');
    const regFile = join(td, 'registry.json');
    writeFileSync(reqFile, 'What time is it?', 'utf8');
    writeFileSync(regFile, JSON.stringify([REGISTRY_COMPONENT]), 'utf8');
    return { reqFile, regFile };
  }

  it('J1: CLI writes trace.json to --output-dir', () => {
    const td = makeTempDir();
    const { reqFile, regFile } = setupFixtures(td);
    runCLI(['plan', '--request', reqFile, '--registry', regFile, '--output-dir', td]);
    expect(existsSync(join(td, 'trace.json'))).toBe(true);
  });

  it('J2: written trace.json is valid JSON', () => {
    const td = makeTempDir();
    const { reqFile, regFile } = setupFixtures(td);
    runCLI(['plan', '--request', reqFile, '--registry', regFile, '--output-dir', td]);
    const content = readFileSync(join(td, 'trace.json'), 'utf8');
    expect(() => JSON.parse(content)).not.toThrow();
  });

  it('J3: written trace.json has all 8 required top-level keys', () => {
    const td = makeTempDir();
    const { reqFile, regFile } = setupFixtures(td);
    runCLI(['plan', '--request', reqFile, '--registry', regFile, '--output-dir', td]);
    const trace = JSON.parse(readFileSync(join(td, 'trace.json'), 'utf8'));
    const required = ['run', 'requestPhase', 'registryPhase', 'selectorPhase', 'conflictPhase', 'budgetPhase', 'planPhase', 'warnings'];
    for (const key of required) {
      expect(trace).toHaveProperty(key);
    }
    // Confirm no injectionGatePhase
    expect(trace).not.toHaveProperty('injectionGatePhase');
  });

  it('J4: CLI writes summary.md to --output-dir', () => {
    const td = makeTempDir();
    const { reqFile, regFile } = setupFixtures(td);
    runCLI(['plan', '--request', reqFile, '--registry', regFile, '--output-dir', td]);
    expect(existsSync(join(td, 'summary.md'))).toBe(true);
  });

  it('J5: written summary.md is non-empty and contains # Context Planning Summary', () => {
    const td = makeTempDir();
    const { reqFile, regFile } = setupFixtures(td);
    runCLI(['plan', '--request', reqFile, '--registry', regFile, '--output-dir', td]);
    const content = readFileSync(join(td, 'summary.md'), 'utf8');
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain('# Context Planning Summary');
  });

  it('J6: CLI exits 0 on successful run (Phase 11 stub exit 1 removed)', () => {
    const td = makeTempDir();
    const { reqFile, regFile } = setupFixtures(td);
    const { status } = runCLI(['plan', '--request', reqFile, '--registry', regFile, '--output-dir', td]);
    expect(status).toBe(0);
  });

  it('J7: validateAndWriteTrace schema-invalid abort — fake validator; trace.json not written; stderr error', () => {
    // Real behavior test: fake validator injected directly into exported helper.
    // Asserts the abort contract without running the full CLI pipeline.
    //
    // Invariants:
    //   (1) validateAndWriteTrace returns false
    //   (2) stderr contains canonical trace schema error prefix
    //   (3) stderr contains "No output files written"
    //   (4) trace.json NOT written to outputDir
    //   (5) validator's instancePath/message reflected in stderr

    const td = makeTempDir();

    const fakeError = { instancePath: '/run', message: 'must have required property runId' };
    const fakeValidator: ValidateFn = Object.assign(
      (_data: unknown): boolean => false,
      { errors: [fakeError] },
    );

    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    const spy = (chunk: unknown, ...rest: unknown[]) => {
      stderrChunks.push(String(chunk));
      return (origWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
    };
    process.stderr.write = spy as typeof process.stderr.write;

    let returnValue: boolean;
    try {
      returnValue = validateAndWriteTrace({ run: {} }, fakeValidator, td);
    } finally {
      process.stderr.write = origWrite;
    }

    const stderrOutput = stderrChunks.join('');

    // (1) Returns false
    expect(returnValue!).toBe(false);

    // (2) Canonical trace schema error prefix
    expect(stderrOutput).toContain('context-plane: error [trace-schema]: trace.json failed schema validation');

    // (3) Canonical abort line
    expect(stderrOutput).toContain('No output files written. Planning run aborted.');

    // (4) trace.json NOT written
    expect(existsSync(join(td, 'trace.json'))).toBe(false);

    // (5) Validator error fields reflected
    expect(stderrOutput).toContain('/run');
    expect(stderrOutput).toContain('must have required property runId');
  });

  it('J8: trace validation failure after prompt-plan.json written: prompt-plan.json exists; trace.json absent; summary.md absent', () => {
    // Simulate the state after prompt-plan.json has been written but trace validation fails.
    // Uses validateAndWriteTrace directly with a fake failing validator.
    const td = makeTempDir();

    // Pre-write a prompt-plan.json to simulate it having been written
    writeFileSync(join(td, 'prompt-plan.json'), JSON.stringify({ schemaVersion: 'v0' }), 'utf8');

    const fakeValidator: ValidateFn = Object.assign(
      (_data: unknown): boolean => false,
      { errors: [{ instancePath: '/selectorPhase', message: 'required' }] },
    );

    // Capture and suppress stderr
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (() => true) as typeof process.stderr.write;
    let returnValue: boolean;
    try {
      returnValue = validateAndWriteTrace({}, fakeValidator, td);
    } finally {
      process.stderr.write = origWrite;
    }

    // Failure contract:
    expect(returnValue!).toBe(false);
    // prompt-plan.json already existed — still there
    expect(existsSync(join(td, 'prompt-plan.json'))).toBe(true);
    // trace.json was NOT written
    expect(existsSync(join(td, 'trace.json'))).toBe(false);
    // summary.md was NOT written (caller must not proceed after false return)
    expect(existsSync(join(td, 'summary.md'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Group K — Cat F regression: planningWarnings context stripping
// ---------------------------------------------------------------------------

describe('Group K — Cat F regression: planningWarnings context stripping', () => {
  it('K1: selectorPhase.planningWarnings strips context from fanOut warnings', () => {
    const warningWithContext: PlanningWarning = {
      code: 'runtime_unavailable_no_budget_savings',
      message: 'Tool "tool.write-file" is confirmed unavailable.',
      context: { componentId: 'tool.write-file', runtimeLabel: 'test' },
    };
    const fanOut = makeFanOutResult([makeTraceEntry('d1')]);
    fanOut.warnings = [warningWithContext];
    const result = runTraceAssembler(makeInputs({
      fanOutResult: fanOut,
      gateResult: makeGateResult({ traceEntries: [makeTraceEntry('d1')] }),
    }));

    expect(result.selectorPhase.planningWarnings.length).toBe(1);
    const w = result.selectorPhase.planningWarnings[0] as Record<string, unknown>;
    expect(w.code).toBe('runtime_unavailable_no_budget_savings');
    expect(w.message).toBe('Tool "tool.write-file" is confirmed unavailable.');
    expect(w).not.toHaveProperty('context');
  });

  it('K2: selectorPhase.planningWarnings strips context from gapCheck warnings', () => {
    const warningWithContext: PlanningWarning = {
      code: 'active_id_unknown',
      message: 'Active skill ID not found.',
      context: { componentId: 'skill.missing' },
    };
    const gapCheck = makeGapCheckResult([warningWithContext]);
    const result = runTraceAssembler(makeInputs({ gapCheckResult: gapCheck }));

    const gapW = result.selectorPhase.planningWarnings.find(
      w => w.code === 'active_id_unknown',
    ) as Record<string, unknown>;
    expect(gapW).toBeDefined();
    expect(gapW).not.toHaveProperty('context');
  });

  it('K3: selectorPhase.planningWarnings strips context from gate warnings', () => {
    const warningWithContext: PlanningWarning = {
      code: 'injection_suspect_warn_and_continue',
      message: 'Injection suspect seen, warn and continue.',
      context: { effectivePolicy: 'warn_and_continue' },
    };
    const gate = makeGateResult({
      traceEntries: [makeTraceEntry('d1')],
      warnings: [warningWithContext],
    });
    const result = runTraceAssembler(makeInputs({ gateResult: gate }));

    const gateW = result.selectorPhase.planningWarnings.find(
      w => w.code === 'injection_suspect_warn_and_continue',
    ) as Record<string, unknown>;
    expect(gateW).toBeDefined();
    expect(gateW).not.toHaveProperty('context');
  });

  it('K4: conflictPhase.planningWarnings strips context from globalWarnings', () => {
    const warningWithContext: PlanningWarning = {
      code: 'unresolved_conflict_fail_open',
      message: 'Unresolved conflict fail-open.',
      context: { componentId: 'comp.conflict' },
    };
    const conflict = makeConflictResult({
      globalWarnings: [warningWithContext],
    });
    const result = runTraceAssembler(makeInputs({ conflictResult: conflict }));

    expect(result.conflictPhase.planningWarnings.length).toBe(1);
    const cw = result.conflictPhase.planningWarnings[0] as Record<string, unknown>;
    expect(cw.code).toBe('unresolved_conflict_fail_open');
    expect(cw).not.toHaveProperty('context');
  });

  it('K5: top-level warnings[] strips context from accumulatedWarnings', () => {
    const warningWithContext: PlanningWarning = {
      code: 'selector_policy_defaulted',
      message: 'Policy defaulted.',
      context: { reason: 'file not found' },
    };
    const result = runTraceAssembler(makeInputs({
      accumulatedWarnings: [warningWithContext],
    }));

    expect(result.warnings.length).toBe(1);
    const tw = result.warnings[0] as Record<string, unknown>;
    expect(tw.code).toBe('selector_policy_defaulted');
    expect(tw.message).toBe('Policy defaulted.');
    expect(tw).not.toHaveProperty('context');
  });

  it('K6: componentId is preserved on warnings that have it (not stripped with context)', () => {
    // PlanningWarning TS type does not have componentId, but it can be present
    // at runtime via the Record<string, unknown> cast pattern used in core modules.
    const warningWithBoth = {
      code: 'over_budget_protected',
      message: 'Over budget protected.',
      componentId: 'comp.expensive',
      context: { tokensApprox: 5000 },
    } as unknown as PlanningWarning;

    const result = runTraceAssembler(makeInputs({
      accumulatedWarnings: [warningWithBoth],
    }));

    expect(result.warnings.length).toBe(1);
    const tw = result.warnings[0] as Record<string, unknown>;
    expect(tw.code).toBe('over_budget_protected');
    expect(tw['componentId']).toBe('comp.expensive');
    expect(tw).not.toHaveProperty('context');
  });
});
