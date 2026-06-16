/**
 * Phase 10: Prompt Plan Generator tests.
 *
 * Tests runPromptPlanGenerator() directly (pure assembler — no I/O).
 * CLI integration tests (Group I) verify file write and AJV validation
 * via process execution using the same spawnSync pattern as phases 2–9.
 *
 * Groups A–I cover all R2 acceptance criteria.
 *
 * Canonical: docs/04 §7.7; docs/11 §4.2, I-09, I-13–I-15.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runPromptPlanGenerator } from '../../src/core/prompt-plan-generator.js';
import { validateAndWritePromptPlan } from '../../src/cli/commands/plan.js';
import type { ValidateFn } from '../../src/cli/commands/plan.js';
import type { ResolvedSelectionDecision } from '../../src/types/conflict.js';
import type { BudgetReport } from '../../src/types/budget.js';
import type { NormalizedInputs } from '../../src/types/normalized.js';
import type { Component } from '../../src/types/registry.js';
import type { PlanningWarning } from '../../src/types/warnings.js';

// ---------------------------------------------------------------------------
// CLI helper (matches pattern in phase 2–9 tests)
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
// Fixture helpers
// ---------------------------------------------------------------------------

function makeDecision(
  componentId: string,
  finalAction: ResolvedSelectionDecision['finalAction'],
  finalPath: ResolvedSelectionDecision['finalPath'],
  overrides: Partial<ResolvedSelectionDecision> = {},
): ResolvedSelectionDecision {
  return {
    componentId,
    finalAction,
    finalPath,
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

function makeEmptyBudgetReport(): BudgetReport {
  return {
    budgetPlan:                { selectedTokensApprox: 0, projectedOverflow: false },
    totalSelectedTokensApprox: 0,
    totalDroppedTokensApprox:  0,
    droppedComponents:         [],
    budgetTarget:              0,
    budgetUtilization:         0,
    budgetOverflow:            false,
    riskFlags:                 [],
    conservativeEstimatesUsed: [],
    trimActions:               [],
  };
}

function makeNormalizedInputs(promptFamily = 'general_default'): NormalizedInputs {
  return {
    requestSignals: {
      promptFamily,
      familyConfidence: 0.0,
      injectionSuspect: false,
    },
    runtime:     { capabilityInventoryComplete: false, availableTools: [] },
    history:     { historyMalformed: false, turns: [] },
    budget:      null,
    constraints: null,
    policy:      { failOpenThreshold: 0.7, deterministicOnly: true, injectionSuspectAction: 'warn_and_continue' },
    activeIds:   { activeSkillIds: [], activeToolIds: [], activeMemoryIds: [] },
    warnings:    [],
  };
}

function makeComponent(
  id: string,
  type: string,
  tokensApprox = 0,
): Component {
  return {
    id,
    type:         type as Component['type'],
    title:        `${id} title`,
    summary:      `${id} summary`,
    source:       'test',
    requiredWhen: [],
    safeToOmitWhen: [],
    tokensApprox,
    charsApprox:  tokensApprox * 4,
    riskLevel:    'low',
    retainPolicy: 'optional',
    omissionPolicy: 'allow',
    defaultAction: 'include',
    budgetPriority: 5,
    evidenceRequired: null,
    tags: [],
    version: '1.0.0',
    hash: null,
  };
}


// ---------------------------------------------------------------------------
// Group A — Partition: selectedComponents
// ---------------------------------------------------------------------------

describe('Group A — Partition: selectedComponents', () => {
  it('A1: include-resolved, not trimmed → selectedComponents; action include; correct path', () => {
    const decisions = [makeDecision('c1', 'include', 'required_match')];
    const result = runPromptPlanGenerator(decisions, makeEmptyBudgetReport(), makeNormalizedInputs(), new Map(), []);
    expect(result.selectedComponents).toHaveLength(1);
    expect(result.selectedComponents[0]).toMatchObject({
      componentId: 'c1',
      action: 'include',
      path: 'required_match',
    });
    expect(result.omittedComponents).toHaveLength(0);
    expect(result.deferredComponents).toHaveLength(0);
  });

  it('A2: include-resolved finalPath fail_open → selectedComponents', () => {
    const decisions = [makeDecision('c2', 'include', 'fail_open')];
    const result = runPromptPlanGenerator(decisions, makeEmptyBudgetReport(), makeNormalizedInputs(), new Map(), []);
    expect(result.selectedComponents).toHaveLength(1);
    expect(result.selectedComponents[0]).toMatchObject({ action: 'include', path: 'fail_open' });
  });

  it('A3: include-resolved finalPath quarantine_boundary_violation → selectedComponents', () => {
    const decisions = [makeDecision('c3', 'include', 'quarantine_boundary_violation')];
    const result = runPromptPlanGenerator(decisions, makeEmptyBudgetReport(), makeNormalizedInputs(), new Map(), []);
    expect(result.selectedComponents[0]).toMatchObject({ action: 'include', path: 'quarantine_boundary_violation' });
  });
});

// ---------------------------------------------------------------------------
// Group B — Partition: omittedComponents (selector-origin)
// ---------------------------------------------------------------------------

describe('Group B — Partition: omittedComponents (selector-origin)', () => {
  it('B1: omit + safe_to_omit_match → omittedComponents; action omit; correct path', () => {
    const decisions = [makeDecision('c4', 'omit', 'safe_to_omit_match')];
    const result = runPromptPlanGenerator(decisions, makeEmptyBudgetReport(), makeNormalizedInputs(), new Map(), []);
    expect(result.omittedComponents).toHaveLength(1);
    expect(result.omittedComponents[0]).toMatchObject({ componentId: 'c4', action: 'omit', path: 'safe_to_omit_match' });
    expect(result.selectedComponents).toHaveLength(0);
  });

  it('B2: omit + default_action_omit → omittedComponents', () => {
    const decisions = [makeDecision('c5', 'omit', 'default_action_omit')];
    const result = runPromptPlanGenerator(decisions, makeEmptyBudgetReport(), makeNormalizedInputs(), new Map(), []);
    expect(result.omittedComponents[0]).toMatchObject({ action: 'omit', path: 'default_action_omit' });
  });
});

// ---------------------------------------------------------------------------
// Group C — Partition: budget_trim
// ---------------------------------------------------------------------------

describe('Group C — Partition: budget_trim', () => {
  function makeTrimReport(componentId: string, tokensDropped: number): BudgetReport {
    const report = makeEmptyBudgetReport();
    report.trimActions = [{ componentId, budgetHint: null, tokensDropped, reason: 'trim_eligible_optional' }];
    report.droppedComponents = [componentId];
    return report;
  }

  it('C1: include-resolved + in trimActions → omittedComponents with path budget_trim', () => {
    const decisions = [makeDecision('c6', 'include', 'default_include')];
    const report = makeTrimReport('c6', 300);
    const result = runPromptPlanGenerator(decisions, report, makeNormalizedInputs(), new Map(), []);
    expect(result.omittedComponents).toHaveLength(1);
    expect(result.omittedComponents[0]).toMatchObject({ componentId: 'c6', action: 'omit', path: 'budget_trim' });
    expect(result.selectedComponents).toHaveLength(0);
  });

  it('C2: budget_trim entry uses tokensDropped from BudgetReport (not fresh lookup)', () => {
    // Registry has different tokensApprox than trimAction.tokensDropped
    const decisions = [makeDecision('c7', 'include', 'default_include')];
    const report = makeTrimReport('c7', 777);
    const candidates = new Map([['c7', makeComponent('c7', 'scaffold', 999)]]);
    const result = runPromptPlanGenerator(decisions, report, makeNormalizedInputs(), candidates, []);
    expect(result.omittedComponents[0].tokensApprox).toBe(777);  // BudgetReport value, not 999
  });

  it('C3: budget-trimmed component does NOT appear in selectedComponents', () => {
    const decisions = [
      makeDecision('trimmed', 'include', 'default_include'),
      makeDecision('kept', 'include', 'required_match'),
    ];
    const report = makeTrimReport('trimmed', 200);
    const result = runPromptPlanGenerator(decisions, report, makeNormalizedInputs(), new Map(), []);
    expect(result.selectedComponents.map(e => e.componentId)).toEqual(['kept']);
    expect(result.omittedComponents.map(e => e.componentId)).toEqual(['trimmed']);
  });
});

// ---------------------------------------------------------------------------
// Group D — Partition: deferredComponents
// ---------------------------------------------------------------------------

describe('Group D — Partition: deferredComponents', () => {
  it('D1: defer + runtime_unavailable → deferredComponents; path field present', () => {
    const decisions = [makeDecision('c8', 'defer', 'runtime_unavailable')];
    const result = runPromptPlanGenerator(decisions, makeEmptyBudgetReport(), makeNormalizedInputs(), new Map(), []);
    expect(result.deferredComponents).toHaveLength(1);
    expect(result.deferredComponents[0]).toMatchObject({ componentId: 'c8', action: 'defer', path: 'runtime_unavailable' });
    expect(result.selectedComponents).toHaveLength(0);
  });

  it('D2: defer + default_defer → deferredComponents; path field present', () => {
    const decisions = [makeDecision('c9', 'defer', 'default_defer')];
    const result = runPromptPlanGenerator(decisions, makeEmptyBudgetReport(), makeNormalizedInputs(), new Map(), []);
    expect(result.deferredComponents[0]).toMatchObject({ action: 'defer', path: 'default_defer' });
  });

  it('D3: every deferredComponents entry carries a path field', () => {
    const decisions = [
      makeDecision('d1', 'defer', 'runtime_unavailable'),
      makeDecision('d2', 'defer', 'default_defer'),
    ];
    const result = runPromptPlanGenerator(decisions, makeEmptyBudgetReport(), makeNormalizedInputs(), new Map(), []);
    for (const entry of result.deferredComponents) {
      expect(typeof entry.path).toBe('string');
      expect(entry.path.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Group E — reference_unknown exclusion + exhaustive invariant
// ---------------------------------------------------------------------------

describe('Group E — reference_unknown exclusion + exhaustive invariant', () => {
  it('E1: reference_unknown → absent from all three partition arrays', () => {
    const decisions = [
      makeDecision('ref-unknown', 'reference_unknown', 'reference_unknown'),
      makeDecision('normal', 'include', 'required_match'),
    ];
    const result = runPromptPlanGenerator(decisions, makeEmptyBudgetReport(), makeNormalizedInputs(), new Map(), []);
    const allIds = [
      ...result.selectedComponents,
      ...result.omittedComponents,
      ...result.deferredComponents,
    ].map(e => e.componentId);
    expect(allIds).not.toContain('ref-unknown');
    expect(allIds).toContain('normal');
  });

  it('E2: total partition count equals count of non-reference_unknown decisions', () => {
    const decisions = [
      makeDecision('r1', 'reference_unknown', 'reference_unknown'),
      makeDecision('r2', 'reference_unknown', 'reference_unknown'),
      makeDecision('inc', 'include', 'required_match'),
      makeDecision('omit', 'omit', 'safe_to_omit_match'),
      makeDecision('defer', 'defer', 'runtime_unavailable'),
    ];
    const result = runPromptPlanGenerator(decisions, makeEmptyBudgetReport(), makeNormalizedInputs(), new Map(), []);
    const partitionTotal =
      result.selectedComponents.length +
      result.omittedComponents.length +
      result.deferredComponents.length;
    const nonRefUnknown = decisions.filter(d => d.finalAction !== 'reference_unknown').length;
    expect(partitionTotal).toBe(nonRefUnknown);
  });
});

// ---------------------------------------------------------------------------
// Group F — Token source order (Q2 closed — charsApprox not used)
// ---------------------------------------------------------------------------

describe('Group F — Token source order', () => {
  it('F1: tokensApproxObserved > 0 takes precedence over registry tokensApprox', () => {
    const decisions = [makeDecision('f1', 'include', 'required_match', {
      tokensApproxObserved: 111,
    })];
    const candidates = new Map([['f1', makeComponent('f1', 'scaffold', 999)]]);
    const result = runPromptPlanGenerator(decisions, makeEmptyBudgetReport(), makeNormalizedInputs(), candidates, []);
    expect(result.selectedComponents[0].tokensApprox).toBe(111);
  });

  it('F2: absent tokensApproxObserved falls back to registry tokensApprox', () => {
    const decisions = [makeDecision('f2', 'include', 'required_match', {
      tokensApproxObserved: undefined,
    })];
    const candidates = new Map([['f2', makeComponent('f2', 'scaffold', 456)]]);
    const result = runPromptPlanGenerator(decisions, makeEmptyBudgetReport(), makeNormalizedInputs(), candidates, []);
    expect(result.selectedComponents[0].tokensApprox).toBe(456);
  });

  it('F3: neither tokensApproxObserved nor registry tokensApprox available → tokensApprox absent (not 500, not charsApprox)', () => {
    const decisions = [makeDecision('f3', 'include', 'required_match', {
      tokensApproxObserved: undefined,
    })];
    // No registry entry for this component
    const result = runPromptPlanGenerator(decisions, makeEmptyBudgetReport(), makeNormalizedInputs(), new Map(), []);
    expect(result.selectedComponents[0].tokensApprox).toBeUndefined();
    expect(result.selectedComponents[0].tokensApprox).not.toBe(500);
  });

  it('F3b: registry tokensApprox is 0 → treated as absent → tokensApprox omitted', () => {
    const decisions = [makeDecision('f3b', 'include', 'required_match', {
      tokensApproxObserved: 0,
    })];
    const candidates = new Map([['f3b', makeComponent('f3b', 'scaffold', 0)]]);
    const result = runPromptPlanGenerator(decisions, makeEmptyBudgetReport(), makeNormalizedInputs(), candidates, []);
    expect(result.selectedComponents[0].tokensApprox).toBeUndefined();
  });

  it('F4: budget_trim entry uses tokensDropped from trimActions (not lookupTokens)', () => {
    const decisions = [makeDecision('f4', 'include', 'default_include', { tokensApproxObserved: 222 })];
    const report = makeEmptyBudgetReport();
    report.trimActions = [{ componentId: 'f4', budgetHint: null, tokensDropped: 555, reason: 'trim_eligible_optional' }];
    const candidates = new Map([['f4', makeComponent('f4', 'scaffold', 888)]]);
    const result = runPromptPlanGenerator(decisions, report, makeNormalizedInputs(), candidates, []);
    // budget_trim uses trimAction.tokensDropped, not observed (222) or registry (888)
    expect(result.omittedComponents[0].tokensApprox).toBe(555);
  });
});

// ---------------------------------------------------------------------------
// Group G — estimatedTokens
// ---------------------------------------------------------------------------

describe('Group G — estimatedTokens', () => {
  it('G1: total = sum of tokensApprox from selectedComponents only (not omitted/deferred)', () => {
    const decisions = [
      makeDecision('s1', 'include', 'required_match', { tokensApproxObserved: 100 }),
      makeDecision('s2', 'include', 'required_match', { tokensApproxObserved: 200 }),
      makeDecision('o1', 'omit', 'safe_to_omit_match', { tokensApproxObserved: 500 }),
      makeDecision('d1', 'defer', 'runtime_unavailable', { tokensApproxObserved: 400 }),
    ];
    const result = runPromptPlanGenerator(decisions, makeEmptyBudgetReport(), makeNormalizedInputs(), new Map(), []);
    expect(result.estimatedTokens.total).toBe(300);
  });

  it('G2: skill type → contributes to skills field (plural) and total', () => {
    const decisions = [makeDecision('sk1', 'include', 'required_match', { tokensApproxObserved: 150 })];
    const candidates = new Map([['sk1', makeComponent('sk1', 'skill', 0)]]);
    const result = runPromptPlanGenerator(decisions, makeEmptyBudgetReport(), makeNormalizedInputs(), candidates, []);
    expect(result.estimatedTokens.skills).toBe(150);
    expect(result.estimatedTokens.total).toBe(150);
  });

  it('G3: scaffold type → scaffold field and total', () => {
    const decisions = [makeDecision('sc1', 'include', 'required_match', { tokensApproxObserved: 80 })];
    const candidates = new Map([['sc1', makeComponent('sc1', 'scaffold', 0)]]);
    const result = runPromptPlanGenerator(decisions, makeEmptyBudgetReport(), makeNormalizedInputs(), candidates, []);
    expect(result.estimatedTokens.scaffold).toBe(80);
    expect(result.estimatedTokens.total).toBe(80);
  });

  it('G4: tool type → tools field and total', () => {
    const decisions = [makeDecision('t1', 'include', 'required_match', { tokensApproxObserved: 60 })];
    const candidates = new Map([['t1', makeComponent('t1', 'tool', 0)]]);
    const result = runPromptPlanGenerator(decisions, makeEmptyBudgetReport(), makeNormalizedInputs(), candidates, []);
    expect(result.estimatedTokens.tools).toBe(60);
    expect(result.estimatedTokens.total).toBe(60);
  });

  it('G5: history type → history field and total', () => {
    const decisions = [makeDecision('h1', 'include', 'required_match', { tokensApproxObserved: 200 })];
    const candidates = new Map([['h1', makeComponent('h1', 'history', 0)]]);
    const result = runPromptPlanGenerator(decisions, makeEmptyBudgetReport(), makeNormalizedInputs(), candidates, []);
    expect(result.estimatedTokens.history).toBe(200);
    expect(result.estimatedTokens.total).toBe(200);
  });

  it('G6: unknown component type → total only; no per-type field invented', () => {
    const decisions = [makeDecision('u1', 'include', 'required_match', { tokensApproxObserved: 50 })];
    const candidates = new Map([['u1', makeComponent('u1', 'memory', 0)]]);
    const result = runPromptPlanGenerator(decisions, makeEmptyBudgetReport(), makeNormalizedInputs(), candidates, []);
    expect(result.estimatedTokens.total).toBe(50);
    // No per-type field for 'memory'
    expect(result.estimatedTokens.scaffold).toBeUndefined();
    expect(result.estimatedTokens.skills).toBeUndefined();
    expect(result.estimatedTokens.tools).toBeUndefined();
    expect(result.estimatedTokens.history).toBeUndefined();
  });

  it('G7: absent tokensApprox on selected entry → 0 contribution; no conservative default', () => {
    const decisions = [makeDecision('g7', 'include', 'required_match')];
    const result = runPromptPlanGenerator(decisions, makeEmptyBudgetReport(), makeNormalizedInputs(), new Map(), []);
    expect(result.estimatedTokens.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Group H — budgetPlan, failOpenReasons, planningWarnings, budgetHintSummary
// ---------------------------------------------------------------------------

describe('Group H — budgetPlan, failOpenReasons, planningWarnings, budgetHintSummary', () => {
  it('H1: budgetPlan.totalPromptTokenTarget = budgetReport.budgetTarget', () => {
    const report = { ...makeEmptyBudgetReport(), budgetTarget: 8000 };
    const result = runPromptPlanGenerator([], report, makeNormalizedInputs(), new Map(), []);
    expect(result.budgetPlan.totalPromptTokenTarget).toBe(8000);
  });

  it('H2: budgetPlan.selectedTokensApprox = BudgetReport.totalSelectedTokensApprox (pre-trim)', () => {
    const report = { ...makeEmptyBudgetReport(), totalSelectedTokensApprox: 1500, budgetTarget: 2000 };
    const result = runPromptPlanGenerator([], report, makeNormalizedInputs(), new Map(), []);
    expect(result.budgetPlan.selectedTokensApprox).toBe(1500);
  });

  it('H3: projectedOverflow = max(0, selectedTokensApprox - totalPromptTokenTarget); 0 when unconstrained', () => {
    const report1 = { ...makeEmptyBudgetReport(), totalSelectedTokensApprox: 2500, budgetTarget: 2000 };
    const r1 = runPromptPlanGenerator([], report1, makeNormalizedInputs(), new Map(), []);
    expect(r1.budgetPlan.projectedOverflow).toBe(500);

    const report2 = { ...makeEmptyBudgetReport(), totalSelectedTokensApprox: 1000, budgetTarget: 0 };
    const r2 = runPromptPlanGenerator([], report2, makeNormalizedInputs(), new Map(), []);
    expect(r2.budgetPlan.projectedOverflow).toBe(0);
  });

  it('H4: finalPath fail_open + resolutionRule no_conflict → failOpenReasons contains :path_fail_open (NOT :no_conflict)', () => {
    const decisions = [makeDecision('fo1', 'include', 'fail_open', {
      resolutionRule: 'no_conflict',  // typical single uncontested decision
    })];
    const result = runPromptPlanGenerator(decisions, makeEmptyBudgetReport(), makeNormalizedInputs(), new Map(), []);
    expect(result.failOpenReasons).toHaveLength(1);
    expect(result.failOpenReasons[0]).toContain(':path_fail_open');
    expect(result.failOpenReasons[0]).not.toContain(':no_conflict');
  });

  it('H5: resolutionRule fail_open_unresolved → failOpenReasons contains :fail_open_unresolved', () => {
    const decisions = [makeDecision('fo2', 'include', 'fail_open', {
      resolutionRule: 'fail_open_unresolved',
    })];
    const result = runPromptPlanGenerator(decisions, makeEmptyBudgetReport(), makeNormalizedInputs(), new Map(), []);
    expect(result.failOpenReasons[0]).toContain(':fail_open_unresolved');
  });

  it('H6: resolutionRule history_malformed_fail_open → failOpenReasons contains :history_malformed_fail_open', () => {
    const decisions = [makeDecision('fo3', 'include', 'fail_open', {
      resolutionRule: 'history_malformed_fail_open',
    })];
    const result = runPromptPlanGenerator(decisions, makeEmptyBudgetReport(), makeNormalizedInputs(), new Map(), []);
    expect(result.failOpenReasons[0]).toContain(':history_malformed_fail_open');
  });

  it('H7: injection_suspect_omit_allowed warning alone does NOT produce a failOpenReasons entry', () => {
    // Include decision whose warningsEmitted contains injection_suspect_omit_allowed
    // but finalPath is required_match (not fail_open) and resolutionRule is no_conflict
    const decisions = [makeDecision('inj1', 'include', 'required_match', {
      warningsEmitted: ['injection_suspect_omit_allowed'],
      resolutionRule: 'no_conflict',
    })];
    const result = runPromptPlanGenerator(decisions, makeEmptyBudgetReport(), makeNormalizedInputs(), new Map(), []);
    expect(result.failOpenReasons).toHaveLength(0);
  });

  it('H8: planningWarnings contains all accumulated phase warnings passed in', () => {
    const warnings: PlanningWarning[] = [
      { code: 'selector_policy_defaulted', message: 'policy defaulted' },
      { code: 'active_id_unknown', message: 'unknown id: x' },
    ];
    const result = runPromptPlanGenerator([], makeEmptyBudgetReport(), makeNormalizedInputs(), new Map(), warnings);
    expect(result.planningWarnings).toHaveLength(2);
    expect(result.planningWarnings[0]).toEqual({ code: 'selector_policy_defaulted', message: 'policy defaulted' });
    expect(result.planningWarnings[1]).toEqual({ code: 'active_id_unknown', message: 'unknown id: x' });
  });

  it('H9: planningWarnings is not empty when warnings were accumulated', () => {
    const warnings: PlanningWarning[] = [
      { code: 'runtime_capabilities_missing', message: 'runtime missing' },
    ];
    const result = runPromptPlanGenerator([], makeEmptyBudgetReport(), makeNormalizedInputs(), new Map(), warnings);
    expect(result.planningWarnings.length).toBeGreaterThan(0);
  });

  it('H10: budgetHintSummary always emitted; zero counts when no hints assigned', () => {
    const result = runPromptPlanGenerator([], makeEmptyBudgetReport(), makeNormalizedInputs(), new Map(), []);
    expect(result.budgetHintSummary).toBeDefined();
    expect(result.budgetHintSummary.protectedCount).toBe(0);
    expect(result.budgetHintSummary.overBudgetProtectedCount).toBe(0);
    expect(result.budgetHintSummary.candidateOptionalCount).toBe(0);
    expect(result.budgetHintSummary.expensiveOptionalCount).toBe(0);
    expect(result.budgetHintSummary.unknownCostCount).toBe(0);
  });

  it('H11: budgetHintSummary.protectedCount counts resolved.budgetHint === protected across ALL decisions', () => {
    const decisions = [
      makeDecision('bp1', 'include', 'required_match', { budgetHint: 'protected' }),
      makeDecision('bp2', 'omit',    'safe_to_omit_match', { budgetHint: 'protected' }),
      makeDecision('bp3', 'include', 'required_match', { budgetHint: 'candidate_optional' }),
    ];
    const result = runPromptPlanGenerator(decisions, makeEmptyBudgetReport(), makeNormalizedInputs(), new Map(), []);
    expect(result.budgetHintSummary.protectedCount).toBe(2);
    expect(result.budgetHintSummary.candidateOptionalCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Group I — CLI integration (AJV + file write)
// ---------------------------------------------------------------------------

describe('Group I — CLI integration (AJV + file write)', () => {
  const tempDirs: string[] = [];

  // Minimal registry component — schema-valid (canonical format matching phase 2–9 tests)
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
    const dir = mkdtempSync(join(tmpdir(), 'ctx-phase10-'));
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

  it('I1: CLI writes prompt-plan.json, trace.json, and summary.md to --output-dir', () => {
    const td = makeTempDir();
    const { reqFile, regFile } = setupFixtures(td);
    runCLI(['plan', '--request', reqFile, '--registry', regFile, '--output-dir', td]);
    expect(existsSync(join(td, 'prompt-plan.json'))).toBe(true);
    expect(existsSync(join(td, 'trace.json'))).toBe(true);
    expect(existsSync(join(td, 'summary.md'))).toBe(true);
  });

  it('I2: written prompt-plan.json is valid JSON', () => {
    const td = makeTempDir();
    const { reqFile, regFile } = setupFixtures(td);
    runCLI(['plan', '--request', reqFile, '--registry', regFile, '--output-dir', td]);
    const content = readFileSync(join(td, 'prompt-plan.json'), 'utf8');
    expect(() => JSON.parse(content)).not.toThrow();
  });

  it('I3: written file has schemaVersion v0', () => {
    const td = makeTempDir();
    const { reqFile, regFile } = setupFixtures(td);
    runCLI(['plan', '--request', reqFile, '--registry', regFile, '--output-dir', td]);
    const plan = JSON.parse(readFileSync(join(td, 'prompt-plan.json'), 'utf8'));
    expect(plan.schemaVersion).toBe('v0');
  });

  it('I4: written file has all required top-level keys', () => {
    const td = makeTempDir();
    const { reqFile, regFile } = setupFixtures(td);
    runCLI(['plan', '--request', reqFile, '--registry', regFile, '--output-dir', td]);
    const plan = JSON.parse(readFileSync(join(td, 'prompt-plan.json'), 'utf8'));
    const required = [
      'schemaVersion', 'promptFamily', 'selectedComponents', 'omittedComponents',
      'deferredComponents', 'budgetPlan', 'estimatedTokens', 'riskFlags',
      'failOpenReasons', 'planningWarnings',
    ];
    for (const key of required) {
      expect(plan).toHaveProperty(key);
    }
  });

  it('I5: schema-invalid promptPlan → stderr schema error; return false; prompt-plan.json NOT written', () => {
    // This tests the real behavior contract using a fake (always-failing) validator
    // injected into the exported validateAndWritePromptPlan helper.
    //
    // Invariants asserted:
    //   (1) validateAndWritePromptPlan returns false when validator returns false
    //   (2) stderr contains the canonical schema error prefix
    //   (3) stderr contains the canonical "No output files written" line
    //   (4) prompt-plan.json is NOT written to outputDir
    //   (5) The validator's .errors[] instancePath/message are reflected in stderr
    //
    // This catches regressions where writeFileSync happens before validation
    // or validation is bypassed entirely.

    const td = makeTempDir();

    // Fake validator: always fails, with a controlled error object.
    const fakeError = { instancePath: '/selectedComponents', message: 'must be array' };
    const fakeValidator: ValidateFn = Object.assign(
      (_data: unknown): boolean => false,
      { errors: [fakeError] },
    );

    // Capture stderr writes during the call
    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    const spy = (chunk: unknown, ...rest: unknown[]) => {
      stderrChunks.push(String(chunk));
      return (origWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
    };
    process.stderr.write = spy as typeof process.stderr.write;

    let returnValue: boolean;
    try {
      returnValue = validateAndWritePromptPlan({ schemaVersion: 'v0' }, fakeValidator, td);
    } finally {
      process.stderr.write = origWrite;
    }

    const stderrOutput = stderrChunks.join('');

    // (1) Returns false — abort signal to plan.ts action handler.
    expect(returnValue!).toBe(false);

    // (2) Canonical schema error prefix present in stderr.
    expect(stderrOutput).toContain(
      'context-plane: error [plan-schema]: prompt-plan.json failed schema validation',
    );

    // (3) Canonical "No output files written" abort line present.
    expect(stderrOutput).toContain('No output files written. Planning run aborted.');

    // (4) prompt-plan.json must NOT have been written.
    expect(existsSync(join(td, 'prompt-plan.json'))).toBe(false);

    // (5) Validator's instancePath and message reflected in stderr.
    expect(stderrOutput).toContain('/selectedComponents');
    expect(stderrOutput).toContain('must be array');
  });


  it('I5b: CLI exits 0 (Phase 11 implemented, no stub)', () => {
    const td = makeTempDir();
    const { reqFile, regFile } = setupFixtures(td);
    const { status, stderr } = runCLI(['plan', '--request', reqFile, '--registry', regFile, '--output-dir', td]);
    expect(status).toBe(0);
    expect(stderr).not.toContain('Phase 11 (Trace and Summary Assembly) is not yet implemented');
  });

  it('I6: CLI does NOT emit Phase 10 stub', () => {
    const td = makeTempDir();
    const { reqFile, regFile } = setupFixtures(td);
    const { stderr } = runCLI(['plan', '--request', reqFile, '--registry', regFile, '--output-dir', td]);
    expect(stderr).not.toContain('Phase 10 (Prompt Plan Generator) is not yet implemented');
  });
});
