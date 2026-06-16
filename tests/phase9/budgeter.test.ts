/**
 * Phase 9: Budgeter tests.
 *
 * Tests runBudgeter() against the R2 plan minimum acceptance checks.
 * Groups A–J match the plan test matrix exactly.
 *
 * These tests operate on the pure runBudgeter() function; they do not invoke
 * the CLI. CLI stub tests are in Group J and use the CLI smoke helper.
 *
 * Canonical: docs/04 §7.5; docs/06 §20, §23, §25, §27; docs/11 §5 row 9.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { runBudgeter } from '../../src/core/budgeter.js';
import type { ResolvedSelectionDecision } from '../../src/types/conflict.js';
import type { Component } from '../../src/types/registry.js';
import type { BudgetState } from '../../src/types/inputs.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let step = 0;
function nextStep(): number { return ++step; }

/** Minimal Component for testing. Only budget-relevant fields need specific values. */
function makeComponent(overrides: Partial<Component> & { id: string }): Component {
  return {
    id: overrides.id,
    type: overrides.type ?? 'scaffold',
    title: 'Test Component',
    summary: 'Test summary',
    source: 'test',
    tokensApprox: overrides.tokensApprox ?? 100,
    charsApprox: overrides.charsApprox ?? 400,
    riskLevel: overrides.riskLevel ?? 'low',
    requiredWhen: [],
    safeToOmitWhen: [],
    defaultAction: 'include',
    omissionPolicy: overrides.omissionPolicy ?? 'allow',
    retainPolicy: overrides.retainPolicy ?? 'optional',
    budgetPriority: overrides.budgetPriority ?? 5,
    evidenceRequired: null,
    tags: [],
    version: '1.0.0',
    hash: null,
    ...overrides,
  } as Component;
}

/** Minimal ResolvedSelectionDecision for testing. */
function makeResolved(
  overrides: Partial<ResolvedSelectionDecision> & { componentId: string },
): ResolvedSelectionDecision {
  return {
    componentId: overrides.componentId,
    finalAction: overrides.finalAction ?? 'include',
    finalPath: overrides.finalPath ?? 'default_include',
    resolvedBy: 'conflict_resolver',
    inputDecisionIds: ['d1'],
    resolutionRule: overrides.resolutionRule ?? 'no_conflict',
    losingDecisions: [],
    warningsEmitted: [],
    resolvedAt: nextStep(),
    mergeRuleTrace: 'no_hint',
    ...overrides,
  } as ResolvedSelectionDecision;
}

function makeMap(...comps: Component[]): Map<string, Component> {
  return new Map(comps.map(c => [c.id, c]));
}

function makeBudget(overrides?: Partial<BudgetState>): BudgetState {
  return {
    totalPromptTokenTarget: 1000,
    maxScaffoldTokens: 500,
    maxSkillTokens: 300,
    maxToolTokens: 200,
    maxHistoryTokens: 400,
    reservedUserTokens: 100,
    budgetCritical: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// CLI helpers (Group J)
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'phase9-test-'));
  tempDirs.push(d);
  return d;
}

function makeRegistryJson(ids: string[]): string {
  return JSON.stringify(ids.map(id => ({
    id, type: 'scaffold', title: 'T', summary: 'S', source: 's',
    tokensApprox: 10, charsApprox: 40, riskLevel: 'low',
    requiredWhen: [], safeToOmitWhen: [], defaultAction: 'include',
    omissionPolicy: 'allow', retainPolicy: 'optional',
    budgetPriority: 5, evidenceRequired: null, tags: [], version: '1.0.0', hash: null,
  })));
}

function runCli(args: string[]): { status: number | null; stderr: string } {
  const cliPath = join(process.cwd(), 'dist', 'cli', 'index.js');
  try {
    execFileSync(process.execPath, [cliPath, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, stderr: '' };
  } catch (err: unknown) {
    const e = err as { status?: number; stderr?: string };
    return { status: e.status ?? 1, stderr: e.stderr ?? '' };
  }
}

afterEach(() => {
  for (const d of tempDirs) {
    try { rmSync(d, { recursive: true }); } catch { /* ignore */ }
  }
  tempDirs.length = 0;
});

// ---------------------------------------------------------------------------
// Group A — Unconstrained short-circuit
// ---------------------------------------------------------------------------

describe('Phase 9 — Group A: Unconstrained short-circuit', () => {

  it('A1: budgetState null → budgetOverflow false, droppedComponents [], trimActions [], budgetTarget 0, budgetUtilization 0', () => {
    const comp = makeComponent({ id: 'a1', tokensApprox: 800 });
    const resolved = makeResolved({ componentId: 'a1' });
    const result = runBudgeter([resolved], null, makeMap(comp));
    expect(result.budgetOverflow).toBe(false);
    expect(result.droppedComponents).toEqual([]);
    expect(result.trimActions).toEqual([]);
    expect(result.budgetTarget).toBe(0);
    expect(result.budgetUtilization).toBe(0);
  });

  it('A2: budgetState null → selectedTokensApprox still computed from include-resolved decisions', () => {
    const comp = makeComponent({ id: 'a2', tokensApprox: 350 });
    const resolved = makeResolved({ componentId: 'a2' });
    const result = runBudgeter([resolved], null, makeMap(comp));
    expect(result.totalSelectedTokensApprox).toBe(350);
    expect(result.budgetPlan.selectedTokensApprox).toBe(350);
  });

  it('A3: totalPromptTokenTarget 0 → same unconstrained short-circuit; budgetTarget 0, trimActions []', () => {
    const comp = makeComponent({ id: 'a3', tokensApprox: 9999 });
    const resolved = makeResolved({ componentId: 'a3' });
    const result = runBudgeter([resolved], makeBudget({ totalPromptTokenTarget: 0 }), makeMap(comp));
    expect(result.budgetTarget).toBe(0);
    expect(result.budgetOverflow).toBe(false);
    expect(result.trimActions).toEqual([]);
  });

  it('A4: totalPromptTokenTarget -1 → unconstrained; budgetTarget 0', () => {
    const comp = makeComponent({ id: 'a4', tokensApprox: 500 });
    const resolved = makeResolved({ componentId: 'a4' });
    const result = runBudgeter([resolved], makeBudget({ totalPromptTokenTarget: -1 }), makeMap(comp));
    expect(result.budgetTarget).toBe(0);
    expect(result.trimActions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Group B — No trim needed (fits within budget)
// ---------------------------------------------------------------------------

describe('Phase 9 — Group B: No trim needed', () => {

  it('B1: All include-resolved fit within target → trimActions [], budgetOverflow false', () => {
    const comp = makeComponent({ id: 'b1', tokensApprox: 200 });
    const resolved = makeResolved({ componentId: 'b1' });
    const result = runBudgeter([resolved], makeBudget({ totalPromptTokenTarget: 1000 }), makeMap(comp));
    expect(result.trimActions).toEqual([]);
    expect(result.budgetOverflow).toBe(false);
  });

  it('B2: Exactly at budget boundary → no trim', () => {
    const comp = makeComponent({ id: 'b2', tokensApprox: 1000 });
    const resolved = makeResolved({ componentId: 'b2' });
    const result = runBudgeter([resolved], makeBudget({ totalPromptTokenTarget: 1000 }), makeMap(comp));
    expect(result.trimActions).toEqual([]);
    expect(result.budgetOverflow).toBe(false);
  });

  it('B3: selectedTokensApprox from Bucket B + C only (defer/omit excluded)', () => {
    const comp1 = makeComponent({ id: 'b3a', tokensApprox: 300 });
    const comp2 = makeComponent({ id: 'b3b', tokensApprox: 200 });
    const inc = makeResolved({ componentId: 'b3a', finalAction: 'include' });
    const omit = makeResolved({ componentId: 'b3b', finalAction: 'omit', finalPath: 'safe_to_omit_match' as ResolvedSelectionDecision['finalPath'] });
    const result = runBudgeter([inc, omit], makeBudget({ totalPromptTokenTarget: 500 }), makeMap(comp1, comp2));
    // Only the include-resolved one (300) should count
    expect(result.totalSelectedTokensApprox).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// Group C — Hard-protected never trimmed
// ---------------------------------------------------------------------------

describe('Phase 9 — Group C: Hard-protected never trimmed', () => {

  function assertProtected(comp: Component, resolvedOverrides?: Partial<ResolvedSelectionDecision>): void {
    const resolved = makeResolved({ componentId: comp.id, ...resolvedOverrides });
    // Budget is very tight — should trigger trim of anything eligible
    const result = runBudgeter([resolved], makeBudget({ totalPromptTokenTarget: 10 }), makeMap(comp));
    expect(result.trimActions.map(t => t.componentId)).not.toContain(comp.id);
    // Should still be counted in totalSelectedTokensApprox
    expect(result.totalSelectedTokensApprox).toBeGreaterThan(0);
  }

  it('C1: retainPolicy safety_critical → counted in total; NOT in trimActions', () => {
    assertProtected(makeComponent({ id: 'c1', retainPolicy: 'safety_critical', tokensApprox: 500 }));
  });

  it('C2: retainPolicy mandatory → counted; not trimmed', () => {
    assertProtected(makeComponent({ id: 'c2', retainPolicy: 'mandatory', tokensApprox: 500 }));
  });

  it('C3: omissionPolicy never → counted; not trimmed', () => {
    assertProtected(makeComponent({ id: 'c3', omissionPolicy: 'never', tokensApprox: 500 }));
  });

  it('C4: riskLevel critical → counted; not trimmed', () => {
    assertProtected(makeComponent({ id: 'c4', riskLevel: 'critical', tokensApprox: 500 }));
  });

  it('C5: riskLevel high → counted; not trimmed', () => {
    assertProtected(makeComponent({ id: 'c5', riskLevel: 'high', tokensApprox: 500 }));
  });

  it('C6: budgetHint protected → counted; not trimmed', () => {
    assertProtected(
      makeComponent({ id: 'c6', tokensApprox: 500 }),
      { budgetHint: 'protected', mergeRuleTrace: 'budget_hint_kept_from_winning_decision' },
    );
  });

  it('C7: budgetHint over_budget_protected → counted; not trimmed; risk flag when exceeds budget', () => {
    const comp = makeComponent({ id: 'c7', tokensApprox: 2000 });
    const resolved = makeResolved({
      componentId: 'c7',
      tokensApproxObserved: 2000,
      budgetHint: 'over_budget_protected',
      mergeRuleTrace: 'budget_hint_kept_from_winning_decision',
    });
    const result = runBudgeter([resolved], makeBudget({ totalPromptTokenTarget: 1000 }), makeMap(comp));
    expect(result.trimActions.map(t => t.componentId)).not.toContain('c7');
    expect(result.riskFlags).toContain('budget_infeasible_protected_component');
  });

  it('C8: Protected-only set exceeds budget → budgetOverflow true; no component trimmed', () => {
    const comp = makeComponent({ id: 'c8', retainPolicy: 'safety_critical', tokensApprox: 5000 });
    const resolved = makeResolved({ componentId: 'c8' });
    const result = runBudgeter([resolved], makeBudget({ totalPromptTokenTarget: 1000 }), makeMap(comp));
    expect(result.trimActions).toEqual([]);
    expect(result.budgetOverflow).toBe(true);
    expect(result.budgetPlan.selectedTokensApprox).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// Group D — Untrimmable (not protected, not eligible)
// ---------------------------------------------------------------------------

describe('Phase 9 — Group D: Untrimmable decisions', () => {

  it('D1: omissionPolicy fail_open include → counted in total; NOT in trimActions', () => {
    const comp = makeComponent({ id: 'd1', omissionPolicy: 'fail_open', tokensApprox: 600 });
    const resolved = makeResolved({ componentId: 'd1' });
    const result = runBudgeter([resolved], makeBudget({ totalPromptTokenTarget: 10 }), makeMap(comp));
    expect(result.trimActions.map(t => t.componentId)).not.toContain('d1');
    expect(result.totalSelectedTokensApprox).toBe(600);
  });

  it('D2: retainPolicy durable include → counted in total; NOT in trimActions', () => {
    const comp = makeComponent({ id: 'd2', retainPolicy: 'durable', tokensApprox: 600 });
    const resolved = makeResolved({ componentId: 'd2' });
    const result = runBudgeter([resolved], makeBudget({ totalPromptTokenTarget: 10 }), makeMap(comp));
    expect(result.trimActions.map(t => t.componentId)).not.toContain('d2');
    expect(result.totalSelectedTokensApprox).toBe(600);
  });

  it('D3: riskLevel high include → counted in total; NOT in trimActions', () => {
    const comp = makeComponent({ id: 'd3', riskLevel: 'high', tokensApprox: 600 });
    const resolved = makeResolved({ componentId: 'd3' });
    const result = runBudgeter([resolved], makeBudget({ totalPromptTokenTarget: 10 }), makeMap(comp));
    expect(result.trimActions.map(t => t.componentId)).not.toContain('d3');
    expect(result.totalSelectedTokensApprox).toBe(600);
  });

  it('D4: Component not in candidatesById → counted via conservative default; NOT in trimActions', () => {
    const resolved = makeResolved({ componentId: 'd4-unknown' });
    const result = runBudgeter([resolved], makeBudget({ totalPromptTokenTarget: 10 }), new Map());
    expect(result.trimActions.map(t => t.componentId)).not.toContain('d4-unknown');
    // Conservative default 500 counted
    expect(result.totalSelectedTokensApprox).toBe(500);
    expect(result.conservativeEstimatesUsed).toContain('d4-unknown');
  });

  it('D5: Absent retainPolicy → untrimmable; NOT in trimActions', () => {
    const comp = { ...makeComponent({ id: 'd5' }), retainPolicy: '' };
    const resolved = makeResolved({ componentId: 'd5' });
    const result = runBudgeter([resolved], makeBudget({ totalPromptTokenTarget: 10 }), makeMap(comp as Component));
    expect(result.trimActions.map(t => t.componentId)).not.toContain('d5');
  });

  it('D6: Absent omissionPolicy → untrimmable; NOT in trimActions', () => {
    const comp = { ...makeComponent({ id: 'd6' }), omissionPolicy: '' };
    const resolved = makeResolved({ componentId: 'd6' });
    const result = runBudgeter([resolved], makeBudget({ totalPromptTokenTarget: 10 }), makeMap(comp as Component));
    expect(result.trimActions.map(t => t.componentId)).not.toContain('d6');
  });

  it('D7: Absent riskLevel → untrimmable; NOT in trimActions', () => {
    const comp = { ...makeComponent({ id: 'd7' }), riskLevel: '' };
    const resolved = makeResolved({ componentId: 'd7' });
    const result = runBudgeter([resolved], makeBudget({ totalPromptTokenTarget: 10 }), makeMap(comp as Component));
    expect(result.trimActions.map(t => t.componentId)).not.toContain('d7');
  });

  it('D8: finalPath quarantine_boundary_violation + finalAction include → counted in totalSelectedTokensApprox; NOT in trimActions', () => {
    const comp = makeComponent({ id: 'd8', tokensApprox: 400 });
    const resolved = makeResolved({
      componentId: 'd8',
      finalAction: 'include',
      finalPath: 'quarantine_boundary_violation' as ResolvedSelectionDecision['finalPath'],
      resolutionRule: 'quarantine_boundary_violation_pass_through',
    });
    const result = runBudgeter([resolved], makeBudget({ totalPromptTokenTarget: 10 }), makeMap(comp));
    expect(result.totalSelectedTokensApprox).toBe(400);
    expect(result.trimActions.map(t => t.componentId)).not.toContain('d8');
  });

  it('D9: omit-resolved decisions → never counted; never in trimActions', () => {
    const comp = makeComponent({ id: 'd9', tokensApprox: 500 });
    const resolved = makeResolved({
      componentId: 'd9',
      finalAction: 'omit',
      finalPath: 'safe_to_omit_match' as ResolvedSelectionDecision['finalPath'],
      resolutionRule: 'path_a_omit_uncontested',
    });
    const result = runBudgeter([resolved], makeBudget({ totalPromptTokenTarget: 10 }), makeMap(comp));
    expect(result.totalSelectedTokensApprox).toBe(0);
    expect(result.trimActions).toEqual([]);
  });

  it('D10: reference_unknown finalAction → not counted; not in trimActions', () => {
    const resolved = makeResolved({
      componentId: 'd10',
      finalAction: 'reference_unknown' as ResolvedSelectionDecision['finalAction'],
      finalPath: 'reference_unknown' as ResolvedSelectionDecision['finalPath'],
      resolutionRule: 'reference_unknown_pass_through',
    });
    const result = runBudgeter([resolved], makeBudget({ totalPromptTokenTarget: 10 }), new Map());
    expect(result.totalSelectedTokensApprox).toBe(0);
    expect(result.trimActions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Group E — Trim eligibility (exact criteria)
// ---------------------------------------------------------------------------

describe('Phase 9 — Group E: Trim eligibility', () => {

  it('E1: retainPolicy optional + omissionPolicy allow + riskLevel low → trim-eligible when over budget', () => {
    const comp = makeComponent({ id: 'e1', retainPolicy: 'optional', omissionPolicy: 'allow', riskLevel: 'low', tokensApprox: 600 });
    const resolved = makeResolved({ componentId: 'e1' });
    const result = runBudgeter([resolved], makeBudget({ totalPromptTokenTarget: 100 }), makeMap(comp));
    expect(result.trimActions.map(t => t.componentId)).toContain('e1');
  });

  it('E2: retainPolicy optional + omissionPolicy allow + riskLevel medium → trim-eligible', () => {
    const comp = makeComponent({ id: 'e2', retainPolicy: 'optional', omissionPolicy: 'allow', riskLevel: 'medium', tokensApprox: 600 });
    const resolved = makeResolved({ componentId: 'e2' });
    const result = runBudgeter([resolved], makeBudget({ totalPromptTokenTarget: 100 }), makeMap(comp));
    expect(result.trimActions.map(t => t.componentId)).toContain('e2');
  });

  it('E3: Missing retainPolicy (empty string) → NOT trim-eligible', () => {
    const comp = { ...makeComponent({ id: 'e3', tokensApprox: 600 }), retainPolicy: '' };
    const resolved = makeResolved({ componentId: 'e3' });
    const result = runBudgeter([resolved], makeBudget({ totalPromptTokenTarget: 100 }), makeMap(comp as Component));
    expect(result.trimActions.map(t => t.componentId)).not.toContain('e3');
  });
});

// ---------------------------------------------------------------------------
// Group F — Greedy trim priority
// ---------------------------------------------------------------------------

describe('Phase 9 — Group F: Greedy trim priority', () => {

  it('F1: Lower budgetPriority trimmed first at equal effective trim class', () => {
    // comp-f1a has priority 1 (lower = trimmed first), comp-f1b has priority 10
    const compA = makeComponent({ id: 'f1a', budgetPriority: 1, tokensApprox: 400, riskLevel: 'low' });
    const compB = makeComponent({ id: 'f1b', budgetPriority: 10, tokensApprox: 400, riskLevel: 'low' });
    const rA = makeResolved({ componentId: 'f1a' });
    const rB = makeResolved({ componentId: 'f1b' });
    // Budget only allows one of them
    const result = runBudgeter([rA, rB], makeBudget({ totalPromptTokenTarget: 500 }), makeMap(compA, compB));
    // f1a (priority 1) should be trimmed first; if only one trim needed, f1a goes first
    expect(result.trimActions[0].componentId).toBe('f1a');
  });

  it('F2: expensive_optional preferred over candidate_optional at equal budgetPriority', () => {
    // f2a: 600 tokens → expensive_optional; f2b: 100 tokens → candidate_optional; same priority
    const compA = makeComponent({ id: 'f2a', budgetPriority: 5, tokensApprox: 600, riskLevel: 'low' });
    const compB = makeComponent({ id: 'f2b', budgetPriority: 5, tokensApprox: 100, riskLevel: 'low' });
    const rA = makeResolved({ componentId: 'f2a' });
    const rB = makeResolved({ componentId: 'f2b' });
    // Need to trim at least one
    const result = runBudgeter([rA, rB], makeBudget({ totalPromptTokenTarget: 400 }), makeMap(compA, compB));
    // f2a (expensive_optional) should be trimmed before f2b (candidate_optional)
    const trimmedIds = result.trimActions.map(t => t.componentId);
    expect(trimmedIds.indexOf('f2a')).toBeLessThan(trimmedIds.indexOf('f2b') === -1 ? Infinity : trimmedIds.indexOf('f2b'));
    // If only one trim: must be f2a (saves more)
    if (result.trimActions.length === 1) {
      expect(result.trimActions[0].componentId).toBe('f2a');
    }
  });

  it('F3: No budgetHint, registry tokensApprox >= 500 (not defaulted) → effective class expensive_optional', () => {
    // f3a: 500 tokens from registry (not defaulted); f3b: 100 tokens; same priority
    const compA = makeComponent({ id: 'f3a', budgetPriority: 5, tokensApprox: 500, riskLevel: 'low' });
    const compB = makeComponent({ id: 'f3b', budgetPriority: 5, tokensApprox: 100, riskLevel: 'low' });
    const rA = makeResolved({ componentId: 'f3a' });
    const rB = makeResolved({ componentId: 'f3b' });
    const result = runBudgeter([rA, rB], makeBudget({ totalPromptTokenTarget: 400 }), makeMap(compA, compB));
    // f3a (expensive_optional effective class) trimmed before f3b (candidate_optional)
    if (result.trimActions.length === 1) {
      expect(result.trimActions[0].componentId).toBe('f3a');
    }
  });

  it('F4: No budgetHint, registry tokensApprox 499 → effective class candidate_optional', () => {
    // f4a: 499 (candidate_optional); f4b: 499 (candidate_optional); f4c: 600 (expensive_optional)
    const compA = makeComponent({ id: 'f4a', budgetPriority: 5, tokensApprox: 499, riskLevel: 'low' });
    const compC = makeComponent({ id: 'f4c', budgetPriority: 5, tokensApprox: 600, riskLevel: 'low' });
    const rA = makeResolved({ componentId: 'f4a' });
    const rC = makeResolved({ componentId: 'f4c' });
    // f4c (expensive_optional) should be trimmed before f4a (candidate_optional) at equal priority
    const result = runBudgeter([rA, rC], makeBudget({ totalPromptTokenTarget: 800 }), makeMap(compA, compC));
    if (result.trimActions.length >= 1) {
      expect(result.trimActions[0].componentId).toBe('f4c');
    }
  });

  it('F5: No budgetHint, no registry cost (conservative 500 defaulted) → effective class unknown_cost, NOT expensive_optional', () => {
    // f5a: defaulted 500 (unknown_cost); f5b: registry 600 (expensive_optional); same priority
    // unknown_cost must sort AFTER expensive_optional
    const compA = makeComponent({ id: 'f5a', budgetPriority: 5, tokensApprox: 0, charsApprox: 0, riskLevel: 'low' });
    const compB = makeComponent({ id: 'f5b', budgetPriority: 5, tokensApprox: 600, riskLevel: 'low' });
    const rA = makeResolved({ componentId: 'f5a' });
    const rB = makeResolved({ componentId: 'f5b' });
    // Both need trimming; f5b (expensive_optional) should go first
    const result = runBudgeter([rA, rB], makeBudget({ totalPromptTokenTarget: 100 }), makeMap(compA, compB));
    const ids = result.trimActions.map(t => t.componentId);
    // f5b (expensive_optional) appears before f5a (unknown_cost)
    expect(ids.indexOf('f5b')).toBeLessThan(ids.indexOf('f5a'));
  });

  it('F6: budgetPriorityObserved on resolved used when present; else component.budgetPriority; else Infinity', () => {
    // f6a: budgetPriorityObserved 2 (override over component priority 10)
    // f6b: no budgetPriorityObserved, component priority 1
    const compA = makeComponent({ id: 'f6a', budgetPriority: 10, tokensApprox: 400, riskLevel: 'low' });
    const compB = makeComponent({ id: 'f6b', budgetPriority: 1, tokensApprox: 400, riskLevel: 'low' });
    const rA = makeResolved({ componentId: 'f6a', budgetPriorityObserved: 2 });
    const rB = makeResolved({ componentId: 'f6b' });
    // f6b (effective priority 1) should be trimmed before f6a (effective priority 2)
    const result = runBudgeter([rA, rB], makeBudget({ totalPromptTokenTarget: 500 }), makeMap(compA, compB));
    if (result.trimActions.length >= 1) {
      expect(result.trimActions[0].componentId).toBe('f6b');
    }
  });

  it('F7: unknown_cost sorts after expensive_optional and candidate_optional at equal priority', () => {
    const compA = makeComponent({ id: 'f7a', budgetPriority: 5, tokensApprox: 0, charsApprox: 0, riskLevel: 'low' }); // unknown_cost
    const compB = makeComponent({ id: 'f7b', budgetPriority: 5, tokensApprox: 100, riskLevel: 'low' }); // candidate_optional
    const rA = makeResolved({ componentId: 'f7a' });
    const rB = makeResolved({ componentId: 'f7b' });
    const result = runBudgeter([rA, rB], makeBudget({ totalPromptTokenTarget: 100 }), makeMap(compA, compB));
    const ids = result.trimActions.map(t => t.componentId);
    // f7b (candidate_optional) must appear before f7a (unknown_cost)
    if (ids.includes('f7a') && ids.includes('f7b')) {
      expect(ids.indexOf('f7b')).toBeLessThan(ids.indexOf('f7a'));
    }
  });
});

// ---------------------------------------------------------------------------
// Group G — Conservative estimates
// ---------------------------------------------------------------------------

describe('Phase 9 — Group G: Conservative estimates', () => {

  it('G1: No tokensApproxObserved, no registry cost → conservative 500; componentId in conservativeEstimatesUsed', () => {
    const comp = makeComponent({ id: 'g1', tokensApprox: 0, charsApprox: 0, riskLevel: 'low' });
    const resolved = makeResolved({ componentId: 'g1' });
    const result = runBudgeter([resolved], makeBudget(), makeMap(comp));
    expect(result.conservativeEstimatesUsed).toContain('g1');
    expect(result.totalSelectedTokensApprox).toBe(500);
  });

  it('G2: charsApprox fallback: ceil(charsApprox / 4) used when tokensApprox absent', () => {
    const comp = makeComponent({ id: 'g2', tokensApprox: 0, charsApprox: 2000, riskLevel: 'low' });
    const resolved = makeResolved({ componentId: 'g2' });
    const result = runBudgeter([resolved], makeBudget(), makeMap(comp));
    // ceil(2000 / 4) = 500
    expect(result.totalSelectedTokensApprox).toBe(500);
    expect(result.conservativeEstimatesUsed).not.toContain('g2');
  });

  it('G3: Conservative estimate counted in selectedTokensApprox for protected component', () => {
    const comp = makeComponent({ id: 'g3', retainPolicy: 'safety_critical', tokensApprox: 0, charsApprox: 0 });
    const resolved = makeResolved({ componentId: 'g3' });
    const result = runBudgeter([resolved], makeBudget(), makeMap(comp));
    expect(result.totalSelectedTokensApprox).toBe(500);
    expect(result.conservativeEstimatesUsed).toContain('g3');
  });

  it('G4: Conservative-defaulted component has reason budget_cost_unknown in trimAction (not trim-eligible category confirmation)', () => {
    // Make it eligible but with no cost data → conservative default → unknown_cost class
    const comp = makeComponent({ id: 'g4', tokensApprox: 0, charsApprox: 0, riskLevel: 'low' });
    const resolved = makeResolved({ componentId: 'g4' });
    const result = runBudgeter([resolved], makeBudget({ totalPromptTokenTarget: 10 }), makeMap(comp));
    // Should be trimmed (eligible + over budget), with reason 'budget_cost_unknown'
    const ta = result.trimActions.find(t => t.componentId === 'g4');
    expect(ta).toBeDefined();
    expect(ta!.reason).toBe('budget_cost_unknown');
  });
});

// ---------------------------------------------------------------------------
// Group H — Budget overflow and risk flags
// ---------------------------------------------------------------------------

describe('Phase 9 — Group H: Budget overflow and risk flags', () => {

  it('H1: Over-budget protected component → budget_infeasible_protected_component in riskFlags', () => {
    const comp = makeComponent({ id: 'h1', retainPolicy: 'safety_critical', tokensApprox: 5000 });
    const resolved = makeResolved({ componentId: 'h1' });
    const result = runBudgeter([resolved], makeBudget({ totalPromptTokenTarget: 1000 }), makeMap(comp));
    expect(result.riskFlags).toContain('budget_infeasible_protected_component');
  });

  it('H2: Protected scaffold component exceeds maxScaffoldTokens → risk flag', () => {
    const comp = makeComponent({ id: 'h2', type: 'scaffold', retainPolicy: 'safety_critical', tokensApprox: 600 });
    const resolved = makeResolved({ componentId: 'h2' });
    // maxScaffoldTokens is 500 in makeBudget(); tokensApprox 600 exceeds it
    const result = runBudgeter([resolved], makeBudget({ maxScaffoldTokens: 500 }), makeMap(comp));
    expect(result.riskFlags).toContain('budget_infeasible_protected_component');
  });

  it('H3: Protected memory component → compared against totalPromptTokenTarget only (no per-type max for memory)', () => {
    // Memory at 400 tokens; totalPromptTokenTarget is 1000; should NOT flag
    const comp = makeComponent({ id: 'h3', type: 'memory', retainPolicy: 'safety_critical', tokensApprox: 400 });
    const resolved = makeResolved({ componentId: 'h3' });
    const result = runBudgeter([resolved], makeBudget({ totalPromptTokenTarget: 1000 }), makeMap(comp));
    expect(result.riskFlags).not.toContain('budget_infeasible_protected_component');
  });

  it('H4: budgetOverflow true when post-trim total still exceeds budget; must be explicit', () => {
    // Only one eligible component, but budget still over after trimming it
    const protectedComp = makeComponent({ id: 'h4p', retainPolicy: 'mandatory', tokensApprox: 2000 });
    const protectedResolved = makeResolved({ componentId: 'h4p' });
    const result = runBudgeter([protectedResolved], makeBudget({ totalPromptTokenTarget: 100 }), makeMap(protectedComp));
    expect(result.budgetOverflow).toBe(true);
  });

  it('H5: budgetOverflow false when trim succeeds in bringing total within budget', () => {
    const comp = makeComponent({ id: 'h5', tokensApprox: 800, riskLevel: 'low' });
    const resolved = makeResolved({ componentId: 'h5' });
    const result = runBudgeter([resolved], makeBudget({ totalPromptTokenTarget: 1000 }), makeMap(comp));
    expect(result.budgetOverflow).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Group I — No-mutation invariant
// ---------------------------------------------------------------------------

describe('Phase 9 — Group I: No-mutation invariant', () => {

  it('I1: Input resolvedDecisions array is not mutated (length and identity preserved)', () => {
    const comp = makeComponent({ id: 'i1', tokensApprox: 600, riskLevel: 'low' });
    const resolved = makeResolved({ componentId: 'i1' });
    const input = [resolved];
    const originalLength = input.length;
    const originalRef = input[0];
    runBudgeter(input, makeBudget({ totalPromptTokenTarget: 100 }), makeMap(comp));
    expect(input).toHaveLength(originalLength);
    expect(input[0]).toBe(originalRef);
  });

  it('I2: finalAction, finalPath, budgetHint, mergeRuleTrace fields unchanged after runBudgeter', () => {
    const comp = makeComponent({ id: 'i2', tokensApprox: 600, riskLevel: 'low' });
    const resolved = makeResolved({
      componentId: 'i2',
      finalAction: 'include',
      finalPath: 'default_include',
      mergeRuleTrace: 'no_hint',
    });
    const before = {
      finalAction: resolved.finalAction,
      finalPath: resolved.finalPath,
      budgetHint: resolved.budgetHint,
      mergeRuleTrace: resolved.mergeRuleTrace,
    };
    runBudgeter([resolved], makeBudget({ totalPromptTokenTarget: 100 }), makeMap(comp));
    expect(resolved.finalAction).toBe(before.finalAction);
    expect(resolved.finalPath).toBe(before.finalPath);
    expect(resolved.budgetHint).toBe(before.budgetHint);
    expect(resolved.mergeRuleTrace).toBe(before.mergeRuleTrace);
  });

  it('I3: Non-defaulted >= 500 token trim emits budgetHint: expensive_optional', () => {
    const comp = makeComponent({ id: 'i3', tokensApprox: 600, riskLevel: 'low' });
    const resolved = makeResolved({ componentId: 'i3' }); // no budgetHint on resolved
    const result = runBudgeter([resolved], makeBudget({ totalPromptTokenTarget: 100 }), makeMap(comp));
    expect(result.trimActions.length).toBeGreaterThan(0);
    expect(result.trimActions[0].budgetHint).toBe('expensive_optional');
    expect(result.trimActions[0].reason).toBe('trim_eligible_optional');
  });

  it('I3b: Non-defaulted < 500 token trim emits budgetHint: candidate_optional', () => {
    const comp = makeComponent({ id: 'i3b', tokensApprox: 200, riskLevel: 'low' });
    const resolved = makeResolved({ componentId: 'i3b' });
    const result = runBudgeter([resolved], makeBudget({ totalPromptTokenTarget: 10 }), makeMap(comp));
    expect(result.trimActions.length).toBeGreaterThan(0);
    expect(result.trimActions[0].budgetHint).toBe('candidate_optional');
    expect(result.trimActions[0].reason).toBe('trim_eligible_optional');
  });

  it('I3c: Defaulted/unknown-cost trim emits budgetHint: candidate_optional and reason: budget_cost_unknown', () => {
    const comp = makeComponent({ id: 'i3c', tokensApprox: 0, charsApprox: 0, riskLevel: 'low' });
    const resolved = makeResolved({ componentId: 'i3c' });
    const result = runBudgeter([resolved], makeBudget({ totalPromptTokenTarget: 10 }), makeMap(comp));
    expect(result.trimActions.length).toBeGreaterThan(0);
    expect(result.trimActions[0].budgetHint).toBe('candidate_optional');
    expect(result.trimActions[0].reason).toBe('budget_cost_unknown');
    // Must not be null or 'unknown_cost'
    expect(result.trimActions[0].budgetHint).not.toBeNull();
    expect(result.trimActions[0].budgetHint).not.toBe('unknown_cost');
  });

  it('I3d: Every trimAction budgetHint is candidate_optional or expensive_optional', () => {
    // Multiple trim-eligible components with mixed cost profiles
    const comps = [
      makeComponent({ id: 'i3d1', tokensApprox: 600, riskLevel: 'low' }),  // expensive_optional
      makeComponent({ id: 'i3d2', tokensApprox: 200, riskLevel: 'low' }),  // candidate_optional
      makeComponent({ id: 'i3d3', tokensApprox: 0, charsApprox: 0, riskLevel: 'low' }),  // unknown_cost → candidate_optional
    ];
    const resolveds = comps.map(c => makeResolved({ componentId: c.id }));
    const result = runBudgeter(resolveds, makeBudget({ totalPromptTokenTarget: 10 }), makeMap(...comps));
    expect(result.trimActions.length).toBe(3);
    for (const ta of result.trimActions) {
      expect(['candidate_optional', 'expensive_optional']).toContain(ta.budgetHint);
    }
  });

  it('I3e: Fixture 14 regression — budget trim produces schema-valid budgetHint for include-resolved-optional-actual-trim', () => {
    // Reproduces the fixture 14 scenario: one protected scaffold, one trim-eligible skill
    const scaffold = makeComponent({
      id: 'scaffold.system-core', type: 'scaffold',
      retainPolicy: 'safety_critical', omissionPolicy: 'never', riskLevel: 'critical',
      tokensApprox: 700,
    });
    const skill = makeComponent({
      id: 'skill.deep-explainer', type: 'skill',
      retainPolicy: 'optional', omissionPolicy: 'allow', riskLevel: 'low',
      tokensApprox: 650, budgetPriority: 7,
    });
    const rScaffold = makeResolved({
      componentId: 'scaffold.system-core',
      finalPath: 'safety_override',
      resolutionRule: 'no_conflict',
    });
    const rSkill = makeResolved({
      componentId: 'skill.deep-explainer',
      finalPath: 'default_include',
      resolutionRule: 'no_conflict',
    });
    const budget = makeBudget({
      totalPromptTokenTarget: 800,
      maxScaffoldTokens: 800,
      maxSkillTokens: 800,
      budgetCritical: true,
    });
    const result = runBudgeter([rScaffold, rSkill], budget, makeMap(scaffold, skill));

    // Skill trimmed
    expect(result.trimActions.length).toBe(1);
    expect(result.trimActions[0].componentId).toBe('skill.deep-explainer');
    // budgetHint is schema-valid string, not null
    expect(result.trimActions[0].budgetHint).toBe('expensive_optional');
    expect(typeof result.trimActions[0].budgetHint).toBe('string');
    // Scaffold not trimmed
    expect(result.trimActions.map(t => t.componentId)).not.toContain('scaffold.system-core');
    // Post-trim accounting
    expect(result.budgetOverflow).toBe(false);
    expect(result.totalSelectedTokensApprox).toBe(1350);
    expect(result.totalDroppedTokensApprox).toBe(650);
  });
});

// ---------------------------------------------------------------------------
// Group J — CLI stub
// ---------------------------------------------------------------------------

describe('Phase 9 — Group J: CLI stub', () => {

  it('J1: CLI exits 0; Phase 11 is now implemented', () => {
    const td = makeTempDir();
    writeFileSync(join(td, 'req.txt'), 'What is the plan?');
    writeFileSync(join(td, 'reg.json'), makeRegistryJson(['scaffold.test']));
    const result = runCli([
      'plan',
      '--request', join(td, 'req.txt'),
      '--registry', join(td, 'reg.json'),
      '--output-dir', td,
    ]);
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('Phase 11 (Trace and Summary Assembly) is not yet implemented');
  });

  it('J2: CLI does NOT emit Phase 9 stub message', () => {
    const td = makeTempDir();
    writeFileSync(join(td, 'req.txt'), 'Plan request');
    writeFileSync(join(td, 'reg.json'), makeRegistryJson(['scaffold.test']));
    const result = runCli([
      'plan',
      '--request', join(td, 'req.txt'),
      '--registry', join(td, 'reg.json'),
    ]);
    expect(result.stderr).not.toContain('Phase 9 (Budgeter) is not yet implemented');
  });
});
