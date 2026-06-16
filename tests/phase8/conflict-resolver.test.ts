/**
 * Phase 8: Conflict resolver tests.
 *
 * Tests cover:
 *   - reference_unknown pass-through (excluded from accounting)
 *   - quarantine_boundary_violation pass-through (in/out candidatesById)
 *   - neverInclude-only diagnostic (single and multi-decision)
 *   - No-conflict fast path (single decisions incl. runtime_unavailable, conflict_include exclusion)
 *   - Priority 0 (tool unavailability)
 *   - Priority 1 (safety hard protection, Cases 7, 8, 9)
 *   - Priority 2 (alwaysInclude, Case 6)
 *   - Priority 3 (mandatory / requiredWhen)
 *   - Priority 4 (history durable + run-wide flag)
 *   - Case 12 (history-malformed fail-open)
 *   - Case 1 (include vs omit, spec gaps)
 *   - Case 2A (include vs ordinary defer, spec gaps)
 *   - Case 3 (omit vs ordinary defer, spec gap)
 *   - Case 4 (omit vs omit)
 *   - Case 5 (multiple includes)
 *   - Single conflict_include (spec gap)
 *   - Unresolvable (no case matched)
 *   - Gate-conversion metadata
 *   - resolutionRule enum constraints
 *   - losingDecisions integrity
 *   - Accounting invariants
 *   - §27 budget-hint survival skeleton
 *   - no confidence field on resolved decisions
 *   - CLI integration (Phase 9 stub)
 *
 * Canonical: docs/06 §11, §27; docs/11 §6 Phase 8.
 */

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runConflictResolver } from '../../src/core/conflict-resolver.js';
import type { SelectionDecision, TraceEntry } from '../../src/types/selection.js';
import type { NormalizedInputs } from '../../src/types/normalized.js';
import type { Component } from '../../src/types/registry.js';

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = resolve(__dirname, '../../src/cli/index.ts');

function runCli(args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx/esm', entry, ...args],
    { encoding: 'utf8', timeout: 30_000 },
  );
}

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ctx-phase8-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function makeRegistryJson(ids: string[]): string {
  return JSON.stringify(ids.map((id) => ({
    id,
    type: 'scaffold',
    title: `Test ${id}`,
    summary: `Minimal component ${id}.`,
    source: `scaffold/${id}.md`,
    tokensApprox: 100,
    charsApprox: 400,
    riskLevel: 'low',
    requiredWhen: [],
    safeToOmitWhen: [],
    defaultAction: 'include',
    omissionPolicy: 'fail_open',
    retainPolicy: 'optional',
    budgetPriority: 3,
    evidenceRequired: null,
    tags: ['test'],
    version: '1.0.0',
    hash: null,
  })));
}

// ---------------------------------------------------------------------------
// Unit test helpers
// ---------------------------------------------------------------------------

let decisionCounter = 0;

function makeDecision(overrides: Partial<SelectionDecision> & {
  componentId: string;
  action: SelectionDecision['action'];
  path: SelectionDecision['path'];
}): SelectionDecision {
  const id = `trace-${++decisionCounter}`;
  return {
    selectorName: 'TestSelector',
    reason: 'test reason',
    confidence: 'high',
    evidence: ['test=true'],
    constraintsApplied: [],
    warnings: [],
    traceRefs: [id],
    ...overrides,
  };
}

function makeTrace(decisionId: string, componentId: string, overrides: Partial<TraceEntry> = {}): TraceEntry {
  return {
    decisionId,
    componentId,
    module: 'TestSelector',
    action: 'include',
    reason: 'test reason',
    evidence: ['test=true'],
    confidence: 'high',
    risk: 'low',
    estimatedSavings: { tokens: 0 },
    failOpen: false,
    selector: 'deterministic',
    ...overrides,
  };
}

function makeComponent(overrides: Partial<Component> & { id: string }): Component {
  return {
    type: 'scaffold',
    title: 'Test',
    summary: 'test',
    source: 'test.md',
    tokensApprox: 100,
    charsApprox: 400,
    riskLevel: 'low',
    requiredWhen: [],
    safeToOmitWhen: [],
    defaultAction: 'include',
    omissionPolicy: 'allow',
    retainPolicy: 'optional',
    budgetPriority: 5,
    evidenceRequired: null,
    tags: [],
    version: '1.0.0',
    hash: null,
    ...overrides,
  };
}

function makeMap(...comps: Component[]): Map<string, Component> {
  return new Map(comps.map(c => [c.id, c]));
}

function makeInputs(overrides: Partial<NormalizedInputs> = {}): NormalizedInputs {
  return {
    requestSignals: {
      promptFamily: 'general_default',
      familyConfidence: 0.0,
      injectionSuspect: false,
    },
    policy: { injectionSuspectAction: 'warn_and_continue', failOpenThreshold: 0.7, deterministicOnly: true },
    runtime: { capabilityInventoryComplete: false, availableToolIds: [], unavailableToolIds: [], runtimeLabel: 'test' },
    history: {
      lanesPresent: [], durableConstraintsPresent: false, openCommitmentsPresent: false,
      recentRawTurnCount: 0, totalHistoryTokensApprox: 0, historyMalformed: false,
    },
    budget: null,
    constraints: null,
    activeIds: { activeSkillIds: [], activeToolIds: [], activeMemoryIds: [] },
    warnings: [],
    ...overrides,
  } as NormalizedInputs;
}

/** Wire a decision to its trace entry — returns [decision, traceEntry] with matching IDs. */
function wire(d: SelectionDecision, t: Partial<TraceEntry> = {}): [SelectionDecision, TraceEntry] {
  const decisionId = d.traceRefs[0] ?? 'auto';
  const te = makeTrace(decisionId, d.componentId, { action: d.action as TraceEntry['action'], ...t });
  return [d, te];
}

// ---------------------------------------------------------------------------
// §1 — reference_unknown pass-through
// ---------------------------------------------------------------------------

describe('Phase 8 — reference_unknown pass-through', () => {

  it('reference_unknown group → in resolvedDecisions; NOT in noConflictComponentIds; NOT in conflictResolutionTrace', () => {
    const d = makeDecision({ componentId: 'uk1', action: 'reference_unknown', path: 'reference_unknown' });
    const [dec, te] = wire(d);
    const inputs = makeInputs();
    const result = runConflictResolver([dec], [te], inputs, new Map());

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'uk1');
    expect(resolved).toBeDefined();
    expect(resolved!.resolutionRule).toBe('reference_unknown_pass_through');
    expect(result.noConflictComponentIds).not.toContain('uk1');
    expect(result.conflictResolutionTrace).toHaveLength(0);
  });

  it('reference_unknown excluded from totalComponents accounting', () => {
    const d = makeDecision({ componentId: 'uk2', action: 'reference_unknown', path: 'reference_unknown' });
    const [dec, te] = wire(d);
    const result = runConflictResolver([dec], [te], makeInputs(), new Map());
    expect(result.conflictSummary.totalComponents).toBe(0); // candidatesById.size = 0
  });

  it('reference_unknown → mergeRuleTrace: no_hint', () => {
    const d = makeDecision({ componentId: 'uk3', action: 'reference_unknown', path: 'reference_unknown' });
    const [dec, te] = wire(d);
    const result = runConflictResolver([dec], [te], makeInputs(), new Map());
    const resolved = result.resolvedDecisions.find(r => r.componentId === 'uk3');
    expect(resolved!.mergeRuleTrace).toBe('no_hint');
  });
});

// ---------------------------------------------------------------------------
// §2 — quarantine_boundary_violation pass-through
// ---------------------------------------------------------------------------

describe('Phase 8 — quarantine_boundary_violation pass-through', () => {

  it('QBV decision with ID in candidatesById → conflictResolutionTrace entry; counted in totalComponents', () => {
    const comp = makeComponent({ id: 'qbv1' });
    const d = makeDecision({ componentId: 'qbv1', action: 'include', path: 'quarantine_boundary_violation' });
    const [dec, te] = wire(d);
    const result = runConflictResolver([dec], [te], makeInputs(), makeMap(comp));

    expect(result.conflictResolutionTrace).toHaveLength(1);
    expect(result.conflictResolutionTrace[0].resolutionRule).toBe('quarantine_boundary_violation_pass_through');
    expect(result.conflictSummary.totalComponents).toBe(1);
  });

  it('QBV decision with ID NOT in candidatesById → resolvedDecisions only; not counted in totalComponents', () => {
    const d = makeDecision({ componentId: 'qbv-unknown', action: 'include', path: 'quarantine_boundary_violation' });
    const [dec, te] = wire(d);
    const result = runConflictResolver([dec], [te], makeInputs(), new Map());

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'qbv-unknown');
    expect(resolved).toBeDefined();
    expect(result.conflictResolutionTrace).toHaveLength(0);
    expect(result.conflictSummary.totalComponents).toBe(0);
  });

  it('QBV → finalAction: include, finalPath: quarantine_boundary_violation; no confidence field', () => {
    const comp = makeComponent({ id: 'qbv2' });
    const d = makeDecision({ componentId: 'qbv2', action: 'include', path: 'quarantine_boundary_violation' });
    const [dec, te] = wire(d);
    const result = runConflictResolver([dec], [te], makeInputs(), makeMap(comp));

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'qbv2')!;
    expect(resolved.finalAction).toBe('include');
    expect(resolved.finalPath).toBe('quarantine_boundary_violation');
    expect('confidence' in resolved).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §3 — neverInclude-only diagnostic
// ---------------------------------------------------------------------------

describe('Phase 8 — neverInclude-only diagnostic', () => {

  it('single include + neverInclude (no Case 6/7) → no_conflict; original action/path preserved; no omit produced', () => {
    const comp = makeComponent({ id: 'nv1' });
    const d = makeDecision({ componentId: 'nv1', action: 'include', path: 'default_include' });
    const [dec, te] = wire(d);
    const inputs = makeInputs({ constraints: { alwaysInclude: [], neverInclude: ['nv1'], constraintSource: 'test' } });
    const result = runConflictResolver([dec], [te], inputs, makeMap(comp));

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'nv1')!;
    expect(resolved.resolutionRule).toBe('no_conflict');
    expect(resolved.finalAction).toBe('include');
    expect(resolved.finalPath).toBe('default_include');
    expect(result.noConflictComponentIds).toContain('nv1');
  });

  it('single include + neverInclude → no invented resolutionRule; no omit', () => {
    const comp = makeComponent({ id: 'nv2' });
    const d = makeDecision({ componentId: 'nv2', action: 'include', path: 'default_include' });
    const [dec, te] = wire(d);
    const inputs = makeInputs({ constraints: { alwaysInclude: [], neverInclude: ['nv2'], constraintSource: 'test' } });
    const result = runConflictResolver([dec], [te], inputs, makeMap(comp));

    // Must not produce omit
    const resolved = result.resolvedDecisions.find(r => r.componentId === 'nv2')!;
    expect(resolved.finalAction).not.toBe('omit');
    // resolutionRule must be from the 14-value canonical set
    const validRules = ['no_conflict','runtime_unavailable_defer','safety_hard_protection',
      'user_constraint_include','registry_require_include','history_durability_include',
      'path_a_omit_uncontested','path_b_omit_uncontested','path_a_omit_selected_over_path_b',
      'multiple_include_merged','fail_open_unresolved','quarantine_boundary_violation_pass_through',
      'reference_unknown_pass_through','history_malformed_fail_open'];
    expect(validRules).toContain(resolved.resolutionRule);
  });

  it('multi-decision neverInclude conflict → normal conflict resolution continues', () => {
    const comp = makeComponent({ id: 'nv3' });
    const d1 = makeDecision({ componentId: 'nv3', action: 'include', path: 'default_include' });
    const d2 = makeDecision({ componentId: 'nv3', action: 'omit', path: 'safe_to_omit_match', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const inputs = makeInputs({ constraints: { alwaysInclude: [], neverInclude: ['nv3'], constraintSource: 'test' } });
    const result = runConflictResolver([dec1, dec2], [te1, te2], inputs, makeMap(comp));

    // Conflict resolution still runs; a trace entry is produced
    expect(result.conflictResolutionTrace.some(e => e.componentId === 'nv3')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §4 — No-conflict fast path
// ---------------------------------------------------------------------------

describe('Phase 8 — no-conflict fast path', () => {

  it('single include/default_include → no_conflict; no trace entry', () => {
    const comp = makeComponent({ id: 'nc1' });
    const d = makeDecision({ componentId: 'nc1', action: 'include', path: 'default_include' });
    const [dec, te] = wire(d);
    const result = runConflictResolver([dec], [te], makeInputs(), makeMap(comp));

    expect(result.noConflictComponentIds).toContain('nc1');
    expect(result.conflictResolutionTrace).toHaveLength(0);
    const resolved = result.resolvedDecisions.find(r => r.componentId === 'nc1')!;
    expect(resolved.resolutionRule).toBe('no_conflict');
    expect(resolved.losingDecisions).toHaveLength(0);
  });

  it('single defer/runtime_unavailable → no_conflict; no trace entry; mergeRuleTrace: runtime_unavailable_skip', () => {
    const comp = makeComponent({ id: 'nc2', type: 'tool' });
    const d = makeDecision({ componentId: 'nc2', action: 'defer', path: 'runtime_unavailable' });
    const [dec, te] = wire(d);
    const result = runConflictResolver([dec], [te], makeInputs(), makeMap(comp));

    expect(result.noConflictComponentIds).toContain('nc2');
    expect(result.conflictResolutionTrace).toHaveLength(0);
    const resolved = result.resolvedDecisions.find(r => r.componentId === 'nc2')!;
    expect(resolved.resolutionRule).toBe('no_conflict');
    expect(resolved.mergeRuleTrace).toBe('runtime_unavailable_skip');
  });

  it('single required_match → no_conflict; finalAction: include', () => {
    const comp = makeComponent({ id: 'nc3' });
    const d = makeDecision({ componentId: 'nc3', action: 'include', path: 'required_match' });
    const [dec, te] = wire(d);
    const result = runConflictResolver([dec], [te], makeInputs(), makeMap(comp));

    expect(result.noConflictComponentIds).toContain('nc3');
    expect(result.resolvedDecisions.find(r => r.componentId === 'nc3')!.finalAction).toBe('include');
  });

  it('single conflict_include → classified as actual conflict; trace entry produced; NOT in noConflictComponentIds', () => {
    const comp = makeComponent({ id: 'ci1' });
    const d = makeDecision({ componentId: 'ci1', action: 'include', path: 'conflict_include' });
    const [dec, te] = wire(d);
    const result = runConflictResolver([dec], [te], makeInputs(), makeMap(comp));

    expect(result.noConflictComponentIds).not.toContain('ci1');
    expect(result.conflictResolutionTrace.some(e => e.componentId === 'ci1')).toBe(true);
  });

  it('single conflict_include → fail_open_unresolved; finalAction: include; finalPath: fail_open; losingDecisions: []; UnresolvedConflictWarning', () => {
    const comp = makeComponent({ id: 'ci2' });
    const d = makeDecision({ componentId: 'ci2', action: 'include', path: 'conflict_include' });
    const [dec, te] = wire(d);
    const result = runConflictResolver([dec], [te], makeInputs(), makeMap(comp));

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'ci2')!;
    expect(resolved.resolutionRule).toBe('fail_open_unresolved');
    expect(resolved.finalAction).toBe('include');
    expect(resolved.finalPath).toBe('fail_open');
    expect(resolved.losingDecisions).toHaveLength(0);
    expect(result.unresolvedConflictWarnings.some(w => w.componentId === 'ci2')).toBe(true);
  });

  it('single conflict_include → NOT resolutionRule: multiple_include_merged', () => {
    const comp = makeComponent({ id: 'ci3' });
    const d = makeDecision({ componentId: 'ci3', action: 'include', path: 'conflict_include' });
    const [dec, te] = wire(d);
    const result = runConflictResolver([dec], [te], makeInputs(), makeMap(comp));

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'ci3')!;
    expect(resolved.resolutionRule).not.toBe('multiple_include_merged');
  });

  it('no confidence field on no-conflict resolved decision', () => {
    const comp = makeComponent({ id: 'nc4' });
    const d = makeDecision({ componentId: 'nc4', action: 'include', path: 'default_include' });
    const [dec, te] = wire(d);
    const result = runConflictResolver([dec], [te], makeInputs(), makeMap(comp));
    const resolved = result.resolvedDecisions.find(r => r.componentId === 'nc4')!;
    expect('confidence' in resolved).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §5 — Priority 0 (tool unavailability)
// ---------------------------------------------------------------------------

describe('Phase 8 — Priority 0 (tool unavailability)', () => {

  it('tool in unavailableToolIds → runtime_unavailable_defer (multi-decision conflict)', () => {
    const comp = makeComponent({ id: 'tool1', type: 'tool' });
    const d1 = makeDecision({ componentId: 'tool1', action: 'include', path: 'default_include' });
    const d2 = makeDecision({ componentId: 'tool1', action: 'defer', path: 'runtime_unavailable', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const inputs = makeInputs({ runtime: { capabilityInventoryComplete: false, availableToolIds: [], unavailableToolIds: ['tool1'], runtimeLabel: 'test' } });
    const result = runConflictResolver([dec1, dec2], [te1, te2], inputs, makeMap(comp));

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'tool1')!;
    expect(resolved.resolutionRule).toBe('runtime_unavailable_defer');
    expect(resolved.finalAction).toBe('defer');
    expect(resolved.finalPath).toBe('runtime_unavailable');
  });

  it('capabilityInventoryComplete=true + tool absent from availableToolIds → runtime_unavailable_defer', () => {
    const comp = makeComponent({ id: 'tool2', type: 'tool' });
    const d1 = makeDecision({ componentId: 'tool2', action: 'include', path: 'default_include' });
    const d2 = makeDecision({ componentId: 'tool2', action: 'omit', path: 'default_action_omit', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const inputs = makeInputs({ runtime: { capabilityInventoryComplete: true, availableToolIds: ['other_tool'], unavailableToolIds: [], runtimeLabel: 'test' } });
    const result = runConflictResolver([dec1, dec2], [te1, te2], inputs, makeMap(comp));

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'tool2')!;
    expect(resolved.resolutionRule).toBe('runtime_unavailable_defer');
  });

  it('P0 with P1 marker → hard_protected_tool_unavailable in warningsEmitted', () => {
    const comp = makeComponent({ id: 'tool3', type: 'tool', retainPolicy: 'safety_critical' });
    const d1 = makeDecision({ componentId: 'tool3', action: 'include', path: 'safety_override' });
    const d2 = makeDecision({ componentId: 'tool3', action: 'defer', path: 'runtime_unavailable', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const inputs = makeInputs({ runtime: { capabilityInventoryComplete: false, availableToolIds: [], unavailableToolIds: ['tool3'], runtimeLabel: 'test' } });
    const result = runConflictResolver([dec1, dec2], [te1, te2], inputs, makeMap(comp));

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'tool3')!;
    expect(resolved.resolutionRule).toBe('runtime_unavailable_defer');
    expect(resolved.warningsEmitted).toContain('hard_protected_tool_unavailable');
  });

  it('P0 with alwaysInclude → always_include_unavailable_tool in warningsEmitted', () => {
    const comp = makeComponent({ id: 'tool4', type: 'tool' });
    const d1 = makeDecision({ componentId: 'tool4', action: 'include', path: 'required_match' });
    const d2 = makeDecision({ componentId: 'tool4', action: 'defer', path: 'runtime_unavailable', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const inputs = makeInputs({
      runtime: { capabilityInventoryComplete: false, availableToolIds: [], unavailableToolIds: ['tool4'], runtimeLabel: 'test' },
      constraints: { alwaysInclude: ['tool4'], neverInclude: [], constraintSource: 'test' },
    });
    const result = runConflictResolver([dec1, dec2], [te1, te2], inputs, makeMap(comp));

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'tool4')!;
    expect(resolved.warningsEmitted).toContain('always_include_unavailable_tool');
  });
});

// ---------------------------------------------------------------------------
// §6 — Priority 1 (safety hard protection)
// ---------------------------------------------------------------------------

describe('Phase 8 — Priority 1 (safety hard protection)', () => {

  it('retainPolicy: safety_critical + include vs omit → safety_hard_protection; safety_override_omit_decision', () => {
    const comp = makeComponent({ id: 'p1a', retainPolicy: 'safety_critical' });
    const d1 = makeDecision({ componentId: 'p1a', action: 'include', path: 'safety_override' });
    const d2 = makeDecision({ componentId: 'p1a', action: 'omit', path: 'safe_to_omit_match', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const result = runConflictResolver([dec1, dec2], [te1, te2], makeInputs(), makeMap(comp));

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'p1a')!;
    expect(resolved.resolutionRule).toBe('safety_hard_protection');
    expect(resolved.finalAction).toBe('include');
    expect(resolved.warningsEmitted).toContain('safety_override_omit_decision');
  });

  it('omissionPolicy: never → safety_hard_protection', () => {
    const comp = makeComponent({ id: 'p1b', omissionPolicy: 'never' });
    const d1 = makeDecision({ componentId: 'p1b', action: 'include', path: 'safety_override' });
    const d2 = makeDecision({ componentId: 'p1b', action: 'omit', path: 'default_action_omit', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const result = runConflictResolver([dec1, dec2], [te1, te2], makeInputs(), makeMap(comp));

    expect(result.resolvedDecisions.find(r => r.componentId === 'p1b')!.resolutionRule).toBe('safety_hard_protection');
  });

  it('riskLevel: critical → safety_hard_protection', () => {
    const comp = makeComponent({ id: 'p1c', riskLevel: 'critical' });
    const d1 = makeDecision({ componentId: 'p1c', action: 'include', path: 'safety_override' });
    const d2 = makeDecision({ componentId: 'p1c', action: 'omit', path: 'default_action_omit', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const result = runConflictResolver([dec1, dec2], [te1, te2], makeInputs(), makeMap(comp));

    expect(result.resolvedDecisions.find(r => r.componentId === 'p1c')!.resolutionRule).toBe('safety_hard_protection');
  });

  it('Case 7 — P1 vs neverInclude → safety_hard_protection; safety_override_never_include', () => {
    const comp = makeComponent({ id: 'p1d', retainPolicy: 'safety_critical' });
    const d1 = makeDecision({ componentId: 'p1d', action: 'include', path: 'safety_override' });
    const d2 = makeDecision({ componentId: 'p1d', action: 'omit', path: 'default_action_omit', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const inputs = makeInputs({ constraints: { alwaysInclude: [], neverInclude: ['p1d'], constraintSource: 'test' } });
    const result = runConflictResolver([dec1, dec2], [te1, te2], inputs, makeMap(comp));

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'p1d')!;
    expect(resolved.resolutionRule).toBe('safety_hard_protection');
    expect(resolved.warningsEmitted).toContain('safety_override_never_include');
  });

  it('P1 + history-malformed input → history_malformed_conflict in warningsEmitted even under P1', () => {
    const comp = makeComponent({ id: 'p1e', retainPolicy: 'safety_critical' });
    const d1 = makeDecision({ componentId: 'p1e', action: 'include', path: 'fail_open' });
    const d2 = makeDecision({ componentId: 'p1e', action: 'omit', path: 'default_action_omit', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1, { warningsEmitted: ['history_malformed_fail_open'] });
    const [dec2, te2] = wire(d2);
    const result = runConflictResolver([dec1, dec2], [te1, te2], makeInputs(), makeMap(comp));

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'p1e')!;
    expect(resolved.resolutionRule).toBe('safety_hard_protection');
    expect(resolved.warningsEmitted).toContain('history_malformed_conflict');
  });

  it('no confidence field on safety_hard_protection resolved decision', () => {
    const comp = makeComponent({ id: 'p1f', retainPolicy: 'safety_critical' });
    const d1 = makeDecision({ componentId: 'p1f', action: 'include', path: 'safety_override' });
    const d2 = makeDecision({ componentId: 'p1f', action: 'omit', path: 'default_action_omit', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const result = runConflictResolver([dec1, dec2], [te1, te2], makeInputs(), makeMap(comp));
    const resolved = result.resolvedDecisions.find(r => r.componentId === 'p1f')!;
    expect('confidence' in resolved).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §7 — Priority 2 (alwaysInclude) and Case 6
// ---------------------------------------------------------------------------

describe('Phase 8 — Priority 2 (alwaysInclude)', () => {

  it('alwaysInclude wins over ordinary omit → user_constraint_include', () => {
    const comp = makeComponent({ id: 'p2a' });
    const d1 = makeDecision({ componentId: 'p2a', action: 'include', path: 'required_match' });
    const d2 = makeDecision({ componentId: 'p2a', action: 'omit', path: 'default_action_omit', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const inputs = makeInputs({ constraints: { alwaysInclude: ['p2a'], neverInclude: [], constraintSource: 'test' } });
    const result = runConflictResolver([dec1, dec2], [te1, te2], inputs, makeMap(comp));

    expect(result.resolvedDecisions.find(r => r.componentId === 'p2a')!.resolutionRule).toBe('user_constraint_include');
  });

  it('Case 6 — alwaysInclude vs neverInclude → user_constraint_include; always_include_overrides_never_include', () => {
    const comp = makeComponent({ id: 'p2b' });
    const d1 = makeDecision({ componentId: 'p2b', action: 'include', path: 'required_match' });
    const d2 = makeDecision({ componentId: 'p2b', action: 'omit', path: 'default_action_omit', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const inputs = makeInputs({ constraints: { alwaysInclude: ['p2b'], neverInclude: ['p2b'], constraintSource: 'test' } });
    const result = runConflictResolver([dec1, dec2], [te1, te2], inputs, makeMap(comp));

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'p2b')!;
    expect(resolved.resolutionRule).toBe('user_constraint_include');
    expect(resolved.warningsEmitted).toContain('always_include_overrides_never_include');
  });
});

// ---------------------------------------------------------------------------
// §8 — Priority 3 (registry mandatory / requiredWhen)
// ---------------------------------------------------------------------------

describe('Phase 8 — Priority 3 (registry hard requirement)', () => {

  it('retainPolicy: mandatory → registry_require_include', () => {
    const comp = makeComponent({ id: 'p3a', retainPolicy: 'mandatory' });
    const d1 = makeDecision({ componentId: 'p3a', action: 'include', path: 'required_match' });
    const d2 = makeDecision({ componentId: 'p3a', action: 'omit', path: 'default_action_omit', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const result = runConflictResolver([dec1, dec2], [te1, te2], makeInputs(), makeMap(comp));

    expect(result.resolvedDecisions.find(r => r.componentId === 'p3a')!.resolutionRule).toBe('registry_require_include');
  });

  it('requiredWhen matches promptFamily → registry_require_include', () => {
    const comp = makeComponent({ id: 'p3b', requiredWhen: ['general_default'] });
    const d1 = makeDecision({ componentId: 'p3b', action: 'include', path: 'required_match' });
    const d2 = makeDecision({ componentId: 'p3b', action: 'omit', path: 'default_action_omit', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const result = runConflictResolver([dec1, dec2], [te1, te2], makeInputs(), makeMap(comp));

    expect(result.resolvedDecisions.find(r => r.componentId === 'p3b')!.resolutionRule).toBe('registry_require_include');
  });
});

// ---------------------------------------------------------------------------
// §9 — Priority 4 (history durability)
// ---------------------------------------------------------------------------

describe('Phase 8 — Priority 4 (history durability)', () => {

  it('type:history + retainPolicy:durable + durableConstraintsPresent=true → history_durability_include', () => {
    const comp = makeComponent({ id: 'p4a', type: 'history', retainPolicy: 'durable' });
    const d1 = makeDecision({ componentId: 'p4a', action: 'include', path: 'default_include' });
    const d2 = makeDecision({ componentId: 'p4a', action: 'omit', path: 'default_action_omit', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const inputs = makeInputs({ history: { lanesPresent: [], durableConstraintsPresent: true, openCommitmentsPresent: false, recentRawTurnCount: 0, totalHistoryTokensApprox: 0, historyMalformed: false } });
    const result = runConflictResolver([dec1, dec2], [te1, te2], inputs, makeMap(comp));

    expect(result.resolvedDecisions.find(r => r.componentId === 'p4a')!.resolutionRule).toBe('history_durability_include');
  });

  it('type:history + retainPolicy:durable + openCommitmentsPresent=true → history_durability_include', () => {
    const comp = makeComponent({ id: 'p4b', type: 'history', retainPolicy: 'durable' });
    const d1 = makeDecision({ componentId: 'p4b', action: 'include', path: 'default_include' });
    const d2 = makeDecision({ componentId: 'p4b', action: 'omit', path: 'default_action_omit', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const inputs = makeInputs({ history: { lanesPresent: [], durableConstraintsPresent: false, openCommitmentsPresent: true, recentRawTurnCount: 0, totalHistoryTokensApprox: 0, historyMalformed: false } });
    const result = runConflictResolver([dec1, dec2], [te1, te2], inputs, makeMap(comp));

    expect(result.resolvedDecisions.find(r => r.componentId === 'p4b')!.resolutionRule).toBe('history_durability_include');
  });

  it('type:history + retainPolicy:durable + no history flags → P4 does NOT fire', () => {
    const comp = makeComponent({ id: 'p4c', type: 'history', retainPolicy: 'durable' });
    const d1 = makeDecision({ componentId: 'p4c', action: 'include', path: 'default_include' });
    const d2 = makeDecision({ componentId: 'p4c', action: 'omit', path: 'default_action_omit', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const result = runConflictResolver([dec1, dec2], [te1, te2], makeInputs(), makeMap(comp));

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'p4c')!;
    expect(resolved.resolutionRule).not.toBe('history_durability_include');
  });

  it('type:history + retainPolicy:mandatory + history flag → P3 governs (not P4)', () => {
    const comp = makeComponent({ id: 'p4d', type: 'history', retainPolicy: 'mandatory' });
    const d1 = makeDecision({ componentId: 'p4d', action: 'include', path: 'required_match' });
    const d2 = makeDecision({ componentId: 'p4d', action: 'omit', path: 'default_action_omit', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const inputs = makeInputs({ history: { lanesPresent: [], durableConstraintsPresent: true, openCommitmentsPresent: false, recentRawTurnCount: 0, totalHistoryTokensApprox: 0, historyMalformed: false } });
    const result = runConflictResolver([dec1, dec2], [te1, te2], inputs, makeMap(comp));

    expect(result.resolvedDecisions.find(r => r.componentId === 'p4d')!.resolutionRule).toBe('registry_require_include');
  });

  it('type:scaffold + retainPolicy:durable + history flag → P4 does NOT fire', () => {
    const comp = makeComponent({ id: 'p4e', type: 'scaffold', retainPolicy: 'durable' });
    const d1 = makeDecision({ componentId: 'p4e', action: 'include', path: 'default_include' });
    const d2 = makeDecision({ componentId: 'p4e', action: 'omit', path: 'default_action_omit', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const inputs = makeInputs({ history: { lanesPresent: [], durableConstraintsPresent: true, openCommitmentsPresent: false, recentRawTurnCount: 0, totalHistoryTokensApprox: 0, historyMalformed: false } });
    const result = runConflictResolver([dec1, dec2], [te1, te2], inputs, makeMap(comp));

    expect(result.resolvedDecisions.find(r => r.componentId === 'p4e')!.resolutionRule).not.toBe('history_durability_include');
  });

  it('type:history + retainPolicy:safety_critical → P1 governs', () => {
    const comp = makeComponent({ id: 'p4f', type: 'history', retainPolicy: 'safety_critical' });
    const d1 = makeDecision({ componentId: 'p4f', action: 'include', path: 'safety_override' });
    const d2 = makeDecision({ componentId: 'p4f', action: 'omit', path: 'default_action_omit', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const inputs = makeInputs({ history: { lanesPresent: [], durableConstraintsPresent: true, openCommitmentsPresent: false, recentRawTurnCount: 0, totalHistoryTokensApprox: 0, historyMalformed: false } });
    const result = runConflictResolver([dec1, dec2], [te1, te2], inputs, makeMap(comp));

    expect(result.resolvedDecisions.find(r => r.componentId === 'p4f')!.resolutionRule).toBe('safety_hard_protection');
  });
});

// ---------------------------------------------------------------------------
// §10 — Case 12 (history-malformed fail-open)
// ---------------------------------------------------------------------------

describe('Phase 8 — Case 12 (history-malformed fail-open)', () => {

  it('include/fail_open with history_malformed_fail_open trace + omit → history_malformed_fail_open', () => {
    const comp = makeComponent({ id: 'hm1' });
    const d1 = makeDecision({ componentId: 'hm1', action: 'include', path: 'fail_open' });
    const d2 = makeDecision({ componentId: 'hm1', action: 'omit', path: 'default_action_omit', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1, { warningsEmitted: ['history_malformed_fail_open'] });
    const [dec2, te2] = wire(d2);
    const result = runConflictResolver([dec1, dec2], [te1, te2], makeInputs(), makeMap(comp));

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'hm1')!;
    expect(resolved.resolutionRule).toBe('history_malformed_fail_open');
    expect(resolved.finalAction).toBe('include');
    expect(resolved.finalPath).toBe('fail_open');
  });

  it('history_malformed_conflict in warningsEmitted for the conflict trace entry', () => {
    const comp = makeComponent({ id: 'hm2' });
    const d1 = makeDecision({ componentId: 'hm2', action: 'include', path: 'fail_open' });
    const d2 = makeDecision({ componentId: 'hm2', action: 'omit', path: 'default_action_omit', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1, { warningsEmitted: ['history_malformed_fail_open'] });
    const [dec2, te2] = wire(d2);
    const result = runConflictResolver([dec1, dec2], [te1, te2], makeInputs(), makeMap(comp));

    const trace = result.conflictResolutionTrace.find(e => e.componentId === 'hm2')!;
    expect(trace.warningsEmitted).toContain('history_malformed_conflict');
  });

  it('global history_malformed_conflict_occurred emitted exactly once for multiple cases', () => {
    const comp1 = makeComponent({ id: 'hm3' });
    const comp2 = makeComponent({ id: 'hm4' });

    const d1a = makeDecision({ componentId: 'hm3', action: 'include', path: 'fail_open' });
    const d1b = makeDecision({ componentId: 'hm3', action: 'omit', path: 'default_action_omit', selectorName: 'Sel2' });
    const [dec1a, te1a] = wire(d1a, { warningsEmitted: ['history_malformed_fail_open'] });
    const [dec1b, te1b] = wire(d1b);

    const d2a = makeDecision({ componentId: 'hm4', action: 'include', path: 'fail_open' });
    const d2b = makeDecision({ componentId: 'hm4', action: 'omit', path: 'default_action_omit', selectorName: 'Sel2' });
    const [dec2a, te2a] = wire(d2a, { warningsEmitted: ['history_malformed_fail_open'] });
    const [dec2b, te2b] = wire(d2b);

    const result = runConflictResolver(
      [dec1a, dec1b, dec2a, dec2b],
      [te1a, te1b, te2a, te2b],
      makeInputs(),
      makeMap(comp1, comp2),
    );

    const globalCodes = result.globalWarnings.filter(w => w.code === 'history_malformed_conflict_occurred');
    expect(globalCodes).toHaveLength(1);
  });

  it('P1 preempts history-malformed: safety_hard_protection governs; history_malformed_conflict still in warningsEmitted', () => {
    const comp = makeComponent({ id: 'hm5', retainPolicy: 'safety_critical' });
    const d1 = makeDecision({ componentId: 'hm5', action: 'include', path: 'fail_open' });
    const d2 = makeDecision({ componentId: 'hm5', action: 'omit', path: 'default_action_omit', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1, { warningsEmitted: ['history_malformed_fail_open'] });
    const [dec2, te2] = wire(d2);
    const result = runConflictResolver([dec1, dec2], [te1, te2], makeInputs(), makeMap(comp));

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'hm5')!;
    expect(resolved.resolutionRule).toBe('safety_hard_protection');
    expect(resolved.warningsEmitted).toContain('history_malformed_conflict');
  });
});

// ---------------------------------------------------------------------------
// §11 — Case 1 (include vs omit, P5 spec gaps)
// ---------------------------------------------------------------------------

describe('Phase 8 — Case 1 (include vs omit)', () => {

  it('default_include vs safe_to_omit_match → fail_open_unresolved (spec gap); UnresolvedConflictWarning', () => {
    const comp = makeComponent({ id: 'c1a' });
    const d1 = makeDecision({ componentId: 'c1a', action: 'include', path: 'default_include' });
    const d2 = makeDecision({ componentId: 'c1a', action: 'omit', path: 'safe_to_omit_match', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const result = runConflictResolver([dec1, dec2], [te1, te2], makeInputs(), makeMap(comp));

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'c1a')!;
    expect(resolved.resolutionRule).toBe('fail_open_unresolved');
    expect(resolved.finalAction).toBe('include');
    expect(result.unresolvedConflictWarnings.some(w => w.componentId === 'c1a')).toBe(true);
  });

  it('not_evaluated vs safe_to_omit_match (Path A) → fail_open_unresolved; include_vs_omit_with_not_evaluated', () => {
    const comp = makeComponent({ id: 'c1b' });
    const d1 = makeDecision({ componentId: 'c1b', action: 'include', path: 'not_evaluated' });
    const d2 = makeDecision({ componentId: 'c1b', action: 'omit', path: 'safe_to_omit_match', selectorName: 'Sel2', confidence: 'high' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const result = runConflictResolver([dec1, dec2], [te1, te2], makeInputs(), makeMap(comp));

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'c1b')!;
    expect(resolved.resolutionRule).toBe('fail_open_unresolved');
    expect(resolved.warningsEmitted).toContain('include_vs_omit_with_not_evaluated');
  });
});

// ---------------------------------------------------------------------------
// §12 — Case 2A (include vs ordinary defer, spec gaps)
// ---------------------------------------------------------------------------

describe('Phase 8 — Case 2A (include vs ordinary defer)', () => {

  it('default_include vs default_defer → fail_open_unresolved; include_overrides_defer; UnresolvedConflictWarning', () => {
    const comp = makeComponent({ id: 'c2a1' });
    const d1 = makeDecision({ componentId: 'c2a1', action: 'include', path: 'default_include' });
    const d2 = makeDecision({ componentId: 'c2a1', action: 'defer', path: 'default_defer', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const result = runConflictResolver([dec1, dec2], [te1, te2], makeInputs(), makeMap(comp));

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'c2a1')!;
    expect(resolved.resolutionRule).toBe('fail_open_unresolved');
    expect(resolved.finalAction).toBe('include');
    expect(resolved.warningsEmitted).toContain('include_overrides_defer');
    expect(result.unresolvedConflictWarnings.some(w => w.componentId === 'c2a1')).toBe(true);
  });

  it('fail_open vs default_defer → fail_open_unresolved; include_overrides_defer', () => {
    const comp = makeComponent({ id: 'c2a2' });
    const d1 = makeDecision({ componentId: 'c2a2', action: 'include', path: 'fail_open' });
    const d2 = makeDecision({ componentId: 'c2a2', action: 'defer', path: 'default_defer', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const result = runConflictResolver([dec1, dec2], [te1, te2], makeInputs(), makeMap(comp));

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'c2a2')!;
    expect(resolved.resolutionRule).toBe('fail_open_unresolved');
    expect(resolved.warningsEmitted).toContain('include_overrides_defer');
  });

  it('not_evaluated vs default_defer → fail_open_unresolved; include_overrides_defer', () => {
    const comp = makeComponent({ id: 'c2a3' });
    const d1 = makeDecision({ componentId: 'c2a3', action: 'include', path: 'not_evaluated' });
    const d2 = makeDecision({ componentId: 'c2a3', action: 'defer', path: 'default_defer', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const result = runConflictResolver([dec1, dec2], [te1, te2], makeInputs(), makeMap(comp));

    expect(result.resolvedDecisions.find(r => r.componentId === 'c2a3')!.resolutionRule).toBe('fail_open_unresolved');
  });
});

// ---------------------------------------------------------------------------
// §13 — Case 3 (omit vs ordinary defer, spec gap)
// ---------------------------------------------------------------------------

describe('Phase 8 — Case 3 (omit vs ordinary defer)', () => {

  it('omit vs default_defer → fail_open_unresolved (spec gap); defer_overrides_omit in warningsEmitted; finalAction: include', () => {
    const comp = makeComponent({ id: 'c3a' });
    const d1 = makeDecision({ componentId: 'c3a', action: 'omit', path: 'safe_to_omit_match' });
    const d2 = makeDecision({ componentId: 'c3a', action: 'defer', path: 'default_defer', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const result = runConflictResolver([dec1, dec2], [te1, te2], makeInputs(), makeMap(comp));

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'c3a')!;
    expect(resolved.resolutionRule).toBe('fail_open_unresolved');
    expect(resolved.finalAction).toBe('include');
    expect(resolved.warningsEmitted).toContain('defer_overrides_omit');
    expect(result.unresolvedConflictWarnings.some(w => w.componentId === 'c3a')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §14 — Case 4 (omit vs omit)
// ---------------------------------------------------------------------------

describe('Phase 8 — Case 4 (omit vs omit)', () => {

  it('Path A vs Path B omit → path_a_omit_selected_over_path_b', () => {
    const comp = makeComponent({ id: 'c4a' });
    const d1 = makeDecision({ componentId: 'c4a', action: 'omit', path: 'safe_to_omit_match' });
    const d2 = makeDecision({ componentId: 'c4a', action: 'omit', path: 'default_action_omit', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const result = runConflictResolver([dec1, dec2], [te1, te2], makeInputs(), makeMap(comp));

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'c4a')!;
    expect(resolved.resolutionRule).toBe('path_a_omit_selected_over_path_b');
    expect(resolved.finalAction).toBe('omit');
    expect(resolved.finalPath).toBe('safe_to_omit_match');
  });

  it('all Path A → path_a_omit_uncontested; losingDecisions: []', () => {
    const comp = makeComponent({ id: 'c4b' });
    const d1 = makeDecision({ componentId: 'c4b', action: 'omit', path: 'safe_to_omit_match' });
    const d2 = makeDecision({ componentId: 'c4b', action: 'omit', path: 'safe_to_omit_match', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const result = runConflictResolver([dec1, dec2], [te1, te2], makeInputs(), makeMap(comp));

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'c4b')!;
    expect(resolved.resolutionRule).toBe('path_a_omit_uncontested');
    expect(resolved.losingDecisions).toHaveLength(0);
  });

  it('all Path B → path_b_omit_uncontested; losingDecisions: []', () => {
    const comp = makeComponent({ id: 'c4c' });
    const d1 = makeDecision({ componentId: 'c4c', action: 'omit', path: 'default_action_omit' });
    const d2 = makeDecision({ componentId: 'c4c', action: 'omit', path: 'default_action_omit', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const result = runConflictResolver([dec1, dec2], [te1, te2], makeInputs(), makeMap(comp));

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'c4c')!;
    expect(resolved.resolutionRule).toBe('path_b_omit_uncontested');
    expect(resolved.losingDecisions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §15 — Case 5 (multiple includes)
// ---------------------------------------------------------------------------

describe('Phase 8 — Case 5 (multiple includes)', () => {

  it('two include decisions → multiple_include_merged; losingDecisions: []', () => {
    const comp = makeComponent({ id: 'c5a' });
    const d1 = makeDecision({ componentId: 'c5a', action: 'include', path: 'default_include' });
    const d2 = makeDecision({ componentId: 'c5a', action: 'include', path: 'fail_open', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const result = runConflictResolver([dec1, dec2], [te1, te2], makeInputs(), makeMap(comp));

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'c5a')!;
    expect(resolved.resolutionRule).toBe('multiple_include_merged');
    expect(resolved.losingDecisions).toHaveLength(0);
  });

  it('multiple includes: highest path wins (fail_open > default_include)', () => {
    const comp = makeComponent({ id: 'c5b' });
    const d1 = makeDecision({ componentId: 'c5b', action: 'include', path: 'default_include' });
    const d2 = makeDecision({ componentId: 'c5b', action: 'include', path: 'fail_open', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const result = runConflictResolver([dec1, dec2], [te1, te2], makeInputs(), makeMap(comp));

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'c5b')!;
    expect(resolved.finalPath).toBe('fail_open');
  });
});

// ---------------------------------------------------------------------------
// §16 — Gate-conversion metadata
// ---------------------------------------------------------------------------

describe('Phase 8 — gate-conversion metadata', () => {

  it('input decision with actionChanged=true → hadGateConvertedDecisions; gateConvertedTraceRefs; preGateActions', () => {
    const comp = makeComponent({ id: 'gc1' });
    const d1 = makeDecision({ componentId: 'gc1', action: 'include', path: 'fail_open' });
    const d2 = makeDecision({ componentId: 'gc1', action: 'omit', path: 'default_action_omit', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1, {
      actionChanged: true,
      originalCandidateAction: 'omit',
      originalCandidatePath: 'safe_to_omit_match',
    });
    const [dec2, te2] = wire(d2);
    const result = runConflictResolver([dec1, dec2], [te1, te2], makeInputs(), makeMap(comp));

    const traceEntry = result.conflictResolutionTrace.find(e => e.componentId === 'gc1')!;
    expect(traceEntry.hadGateConvertedDecisions).toBe(true);
    expect(traceEntry.gateConvertedTraceRefs).toContain(te1.decisionId);
    expect(traceEntry.preGateActions).toContain('omit');
  });

  it('no gate-converted decisions → hadGateConvertedDecisions absent from trace entry', () => {
    const comp = makeComponent({ id: 'gc2' });
    const d1 = makeDecision({ componentId: 'gc2', action: 'include', path: 'default_include' });
    const d2 = makeDecision({ componentId: 'gc2', action: 'omit', path: 'default_action_omit', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const result = runConflictResolver([dec1, dec2], [te1, te2], makeInputs(), makeMap(comp));

    const traceEntry = result.conflictResolutionTrace.find(e => e.componentId === 'gc2')!;
    expect(traceEntry.hadGateConvertedDecisions).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §17 — resolutionRule enum and losingDecisions integrity
// ---------------------------------------------------------------------------

describe('Phase 8 — resolutionRule enum and losingDecisions', () => {

  const VALID_RULES = new Set([
    'no_conflict','runtime_unavailable_defer','safety_hard_protection',
    'user_constraint_include','registry_require_include','history_durability_include',
    'path_a_omit_uncontested','path_b_omit_uncontested','path_a_omit_selected_over_path_b',
    'multiple_include_merged','fail_open_unresolved','quarantine_boundary_violation_pass_through',
    'reference_unknown_pass_through','history_malformed_fail_open',
  ]);

  it('all resolutionRule values are from the canonical 14-value enum', () => {
    const comp1 = makeComponent({ id: 'e1' });
    const comp2 = makeComponent({ id: 'e2' });
    const d1 = makeDecision({ componentId: 'e1', action: 'include', path: 'default_include' });
    const d2 = makeDecision({ componentId: 'e1', action: 'omit', path: 'safe_to_omit_match', selectorName: 'S2' });
    const d3 = makeDecision({ componentId: 'e2', action: 'include', path: 'default_include' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const [dec3, te3] = wire(d3);
    const result = runConflictResolver([dec1, dec2, dec3], [te1, te2, te3], makeInputs(), makeMap(comp1, comp2));

    for (const r of result.resolvedDecisions) {
      expect(VALID_RULES.has(r.resolutionRule)).toBe(true);
    }
  });

  it('no_conflict never appears in conflictResolutionTrace entries', () => {
    const comp = makeComponent({ id: 'e3' });
    const d1 = makeDecision({ componentId: 'e3', action: 'include', path: 'default_include' });
    const d2 = makeDecision({ componentId: 'e3', action: 'omit', path: 'default_action_omit', selectorName: 'S2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const result = runConflictResolver([dec1, dec2], [te1, te2], makeInputs(), makeMap(comp));

    for (const e of result.conflictResolutionTrace) {
      expect(e.resolutionRule).not.toBe('no_conflict');
    }
  });

  it('winning decision does not appear in losingDecisions', () => {
    const comp = makeComponent({ id: 'e4', retainPolicy: 'safety_critical' });
    const d1 = makeDecision({ componentId: 'e4', action: 'include', path: 'safety_override' });
    const d2 = makeDecision({ componentId: 'e4', action: 'omit', path: 'safe_to_omit_match', selectorName: 'S2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const result = runConflictResolver([dec1, dec2], [te1, te2], makeInputs(), makeMap(comp));

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'e4')!;
    const losingIds = resolved.losingDecisions.map(l => l.decisionId);
    // Winner's decisionId (te1.decisionId) must not be in losingDecisions
    expect(losingIds).not.toContain(te1.decisionId);
  });

  it('no confidence field on any resolved decision or trace entry', () => {
    const comp = makeComponent({ id: 'e5' });
    const d1 = makeDecision({ componentId: 'e5', action: 'include', path: 'default_include' });
    const d2 = makeDecision({ componentId: 'e5', action: 'omit', path: 'default_action_omit', selectorName: 'S2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const result = runConflictResolver([dec1, dec2], [te1, te2], makeInputs(), makeMap(comp));

    for (const r of result.resolvedDecisions) {
      expect('confidence' in r).toBe(false);
    }
    for (const e of result.conflictResolutionTrace) {
      expect('confidence' in e).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// §18 — Accounting invariants
// ---------------------------------------------------------------------------

describe('Phase 8 — accounting invariants', () => {

  it('totalComponents = candidatesById.size for mixed scenario', () => {
    const comp1 = makeComponent({ id: 'acc1' });
    const comp2 = makeComponent({ id: 'acc2' });
    // acc1: no-conflict; acc2: actual conflict
    const d1 = makeDecision({ componentId: 'acc1', action: 'include', path: 'default_include' });
    const d2a = makeDecision({ componentId: 'acc2', action: 'include', path: 'default_include' });
    const d2b = makeDecision({ componentId: 'acc2', action: 'omit', path: 'safe_to_omit_match', selectorName: 'S2' });
    const [dec1, te1] = wire(d1);
    const [dec2a, te2a] = wire(d2a);
    const [dec2b, te2b] = wire(d2b);
    const result = runConflictResolver([dec1, dec2a, dec2b], [te1, te2a, te2b], makeInputs(), makeMap(comp1, comp2));

    expect(result.conflictSummary.totalComponents).toBe(2);
  });

  it('noConflict + resolvedConflicts + failOpenResolutions = totalComponents', () => {
    const comp1 = makeComponent({ id: 'ac2a' });
    const comp2 = makeComponent({ id: 'ac2b' });
    const d1 = makeDecision({ componentId: 'ac2a', action: 'include', path: 'default_include' });
    const d2a = makeDecision({ componentId: 'ac2b', action: 'include', path: 'default_include' });
    const d2b = makeDecision({ componentId: 'ac2b', action: 'omit', path: 'safe_to_omit_match', selectorName: 'S2' });
    const [dec1, te1] = wire(d1);
    const [dec2a, te2a] = wire(d2a);
    const [dec2b, te2b] = wire(d2b);
    const result = runConflictResolver([dec1, dec2a, dec2b], [te1, te2a, te2b], makeInputs(), makeMap(comp1, comp2));

    const s = result.conflictSummary;
    expect(s.noConflict + s.resolvedConflicts + s.failOpenResolutions).toBe(s.totalComponents);
  });

  it('noConflict = noConflictComponentIds.length', () => {
    const comp = makeComponent({ id: 'ac3' });
    const d = makeDecision({ componentId: 'ac3', action: 'include', path: 'default_include' });
    const [dec, te] = wire(d);
    const result = runConflictResolver([dec], [te], makeInputs(), makeMap(comp));

    expect(result.conflictSummary.noConflict).toBe(result.noConflictComponentIds.length);
  });

  it('reference_unknown excluded: totalComponents = candidatesById.size (not counting unknown)', () => {
    const comp = makeComponent({ id: 'real1' });
    const d1 = makeDecision({ componentId: 'real1', action: 'include', path: 'default_include' });
    const d2 = makeDecision({ componentId: 'uk-ref', action: 'reference_unknown', path: 'reference_unknown' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const result = runConflictResolver([dec1, dec2], [te1, te2], makeInputs(), makeMap(comp));

    expect(result.conflictSummary.totalComponents).toBe(1); // candidatesById.size = 1
  });
});

// ---------------------------------------------------------------------------
// §19 — §27 budget-hint survival skeleton
// ---------------------------------------------------------------------------

describe('Phase 8 — §27 budget-hint survival skeleton', () => {

  it('no input has budgetHint → mergeRuleTrace: no_hint; no budgetHint on resolved', () => {
    const comp = makeComponent({ id: 'bh1' });
    const d = makeDecision({ componentId: 'bh1', action: 'include', path: 'default_include' });
    const [dec, te] = wire(d);
    const result = runConflictResolver([dec], [te], makeInputs(), makeMap(comp));

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'bh1')!;
    expect(resolved.mergeRuleTrace).toBe('no_hint');
    expect(resolved.budgetHint).toBeUndefined();
  });

  it('single runtime_unavailable no-conflict → mergeRuleTrace: runtime_unavailable_skip', () => {
    const comp = makeComponent({ id: 'bh2', type: 'tool' });
    const d = makeDecision({ componentId: 'bh2', action: 'defer', path: 'runtime_unavailable' });
    const [dec, te] = wire(d);
    const result = runConflictResolver([dec], [te], makeInputs(), makeMap(comp));

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'bh2')!;
    expect(resolved.mergeRuleTrace).toBe('runtime_unavailable_skip');
  });

  it('synthetic input with budgetHint → budgetHint survives into resolved decision', () => {
    const comp = makeComponent({ id: 'bh3' });
    const d = makeDecision({ componentId: 'bh3', action: 'include', path: 'default_include' });
    // Inject synthetic budgetHint (simulating future Phase 9 assignment)
    const decWithHint = { ...d, budgetHint: 'protected' as const };
    const [, te] = wire(d);
    const result = runConflictResolver([decWithHint as SelectionDecision], [te], makeInputs(), makeMap(comp));

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'bh3')!;
    expect(resolved.budgetHint).toBe('protected');
    expect(resolved.mergeRuleTrace).toBe('budget_hint_kept_from_winning_decision');
  });

  it('input with budgetHint is not silently discarded', () => {
    const comp = makeComponent({ id: 'bh4' });
    const d = makeDecision({ componentId: 'bh4', action: 'include', path: 'default_include' });
    const decWithHint = { ...d, budgetHint: 'unknown_cost' as const };
    const [, te] = wire(d);
    const result = runConflictResolver([decWithHint as SelectionDecision], [te], makeInputs(), makeMap(comp));

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'bh4')!;
    expect(resolved.budgetHint).toBeDefined();
    expect(resolved.budgetHint).toBe('unknown_cost');
  });
});

// ---------------------------------------------------------------------------
// §20 — CLI integration (Phase 9 stub)
// ---------------------------------------------------------------------------

describe('Phase 8 — CLI integration (Phase 9 stub)', () => {

  it('valid inputs → exit 0; Phase 11 is now implemented', () => {
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

  it('Phase 8 stub text is absent from stderr', () => {
    const td = makeTempDir();
    writeFileSync(join(td, 'req.txt'), 'Plan request');
    writeFileSync(join(td, 'reg.json'), makeRegistryJson(['scaffold.test']));
    const result = runCli([
      'plan',
      '--request', join(td, 'req.txt'),
      '--registry', join(td, 'reg.json'),
    ]);
    expect(result.stderr).not.toContain('Phase 8 (conflict resolver) is not yet implemented');
  });
});

// ---------------------------------------------------------------------------
// §21 — Stderr internal diagnostic spy tests (Fix 1)
// ---------------------------------------------------------------------------

describe('Phase 8 — stderr internal diagnostics (spy)', () => {

  let stderrCalls: string[] = [];
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrCalls = [];
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(
      (...args: Parameters<typeof process.stderr.write>) => {
        stderrCalls.push(String(args[0]));
        return true;
      },
    );
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  // ---- neverInclude_only_unenforced ----

  it("single include + neverInclude-only → exact 'neverInclude_only_unenforced' string emitted to stderr", () => {
    const comp = makeComponent({ id: 'spy-nv1' });
    const d = makeDecision({ componentId: 'spy-nv1', action: 'include', path: 'default_include' });
    const [dec, te] = wire(d);
    const inputs = makeInputs({ constraints: { alwaysInclude: [], neverInclude: ['spy-nv1'], constraintSource: 'test' } });
    runConflictResolver([dec], [te], inputs, makeMap(comp));

    const matched = stderrCalls.some(s =>
      s.includes('neverInclude_only_unenforced') &&
      s.includes("componentId 'spy-nv1'"),
    );
    expect(matched).toBe(true);
  });

  it("multi-decision neverInclude conflict → 'neverInclude_only_unenforced' emitted to stderr before resolution", () => {
    const comp = makeComponent({ id: 'spy-nv2' });
    const d1 = makeDecision({ componentId: 'spy-nv2', action: 'include', path: 'default_include' });
    const d2 = makeDecision({ componentId: 'spy-nv2', action: 'omit', path: 'safe_to_omit_match', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const inputs = makeInputs({ constraints: { alwaysInclude: [], neverInclude: ['spy-nv2'], constraintSource: 'test' } });
    runConflictResolver([dec1, dec2], [te1, te2], inputs, makeMap(comp));

    const matched = stderrCalls.some(s =>
      s.includes('neverInclude_only_unenforced') &&
      s.includes("componentId 'spy-nv2'"),
    );
    expect(matched).toBe(true);
  });

  it("neverInclude_only_unenforced NOT in globalWarnings[]", () => {
    const comp = makeComponent({ id: 'spy-nv3' });
    const d = makeDecision({ componentId: 'spy-nv3', action: 'include', path: 'default_include' });
    const [dec, te] = wire(d);
    const inputs = makeInputs({ constraints: { alwaysInclude: [], neverInclude: ['spy-nv3'], constraintSource: 'test' } });
    const result = runConflictResolver([dec], [te], inputs, makeMap(comp));

    const found = result.globalWarnings.some(w => w.code.includes('neverInclude'));
    expect(found).toBe(false);
  });

  it("neverInclude_only_unenforced NOT in conflictResolutionTrace[].warningsEmitted", () => {
    const comp = makeComponent({ id: 'spy-nv4' });
    const d1 = makeDecision({ componentId: 'spy-nv4', action: 'include', path: 'default_include' });
    const d2 = makeDecision({ componentId: 'spy-nv4', action: 'omit', path: 'safe_to_omit_match', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);
    const inputs = makeInputs({ constraints: { alwaysInclude: [], neverInclude: ['spy-nv4'], constraintSource: 'test' } });
    const result = runConflictResolver([dec1, dec2], [te1, te2], inputs, makeMap(comp));

    for (const entry of result.conflictResolutionTrace) {
      for (const w of entry.warningsEmitted) {
        expect(w).not.toContain('neverInclude');
      }
    }
  });

  it("ID not in neverInclude → neverInclude_only_unenforced NOT emitted to stderr", () => {
    const comp = makeComponent({ id: 'spy-nv5' });
    const d = makeDecision({ componentId: 'spy-nv5', action: 'include', path: 'default_include' });
    const [dec, te] = wire(d);
    // No neverInclude constraint.
    runConflictResolver([dec], [te], makeInputs(), makeMap(comp));

    const found = stderrCalls.some(s => s.includes('neverInclude_only_unenforced'));
    expect(found).toBe(false);
  });

  // ---- quarantine_boundary_accounting_error ----

  it("QBV ID not in candidatesById → exact 'quarantine_boundary_accounting_error' string emitted to stderr", () => {
    const d = makeDecision({ componentId: 'spy-qbv1', action: 'include', path: 'quarantine_boundary_violation' });
    const [dec, te] = wire(d);
    runConflictResolver([dec], [te], makeInputs(), new Map());

    const matched = stderrCalls.some(s =>
      s.includes('quarantine_boundary_accounting_error') &&
      s.includes("componentId 'spy-qbv1'"),
    );
    expect(matched).toBe(true);
  });

  it("quarantine_boundary_accounting_error NOT in globalWarnings[]", () => {
    const d = makeDecision({ componentId: 'spy-qbv2', action: 'include', path: 'quarantine_boundary_violation' });
    const [dec, te] = wire(d);
    const result = runConflictResolver([dec], [te], makeInputs(), new Map());

    const found = result.globalWarnings.some(w => w.code.includes('quarantine'));
    expect(found).toBe(false);
  });

  it("quarantine_boundary_accounting_error: conflictResolutionTrace is empty (unknown ID excluded from accounting)", () => {
    const d = makeDecision({ componentId: 'spy-qbv3', action: 'include', path: 'quarantine_boundary_violation' });
    const [dec, te] = wire(d);
    const result = runConflictResolver([dec], [te], makeInputs(), new Map());

    // Unknown QBV ID → excluded from accounting → trace is empty.
    expect(result.conflictResolutionTrace).toHaveLength(0);
  });

  it("QBV ID present in candidatesById → quarantine_boundary_accounting_error NOT emitted to stderr", () => {
    const comp = makeComponent({ id: 'spy-qbv4' });
    const d = makeDecision({ componentId: 'spy-qbv4', action: 'include', path: 'quarantine_boundary_violation' });
    const [dec, te] = wire(d);
    runConflictResolver([dec], [te], makeInputs(), makeMap(comp));

    const found = stderrCalls.some(s => s.includes('quarantine_boundary_accounting_error'));
    expect(found).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §22 — §27.5 budget-hint priority order (Fix 2)
// ---------------------------------------------------------------------------

describe('Phase 8 — §27.5 budget-hint priority order', () => {

  it('winner has candidate_optional (low), loser has protected (high) → protected survives; mergeRuleTrace: budget_hint_promoted_from_losing_decision', () => {
    const comp = makeComponent({ id: 'bhp1' });
    const d1 = makeDecision({ componentId: 'bhp1', action: 'include', path: 'default_include' });
    const d1WithHint = { ...d1, budgetHint: 'candidate_optional' as const };
    const d2 = makeDecision({ componentId: 'bhp1', action: 'omit', path: 'safe_to_omit_match', selectorName: 'Sel2' });
    const d2WithHint = { ...d2, budgetHint: 'protected' as const };
    const [, te1] = wire(d1);
    const [, te2] = wire(d2);

    const result = runConflictResolver(
      [d1WithHint as SelectionDecision, d2WithHint as SelectionDecision],
      [te1, te2],
      makeInputs(),
      makeMap(comp),
    );

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'bhp1')!;
    // Loser had the higher-priority hint — it must be promoted.
    expect(resolved.budgetHint).toBe('protected');
    expect(resolved.mergeRuleTrace).toBe('budget_hint_promoted_from_losing_decision');
  });

  it('winner has protected (highest), loser has candidate_optional → winner hint kept; mergeRuleTrace: budget_hint_kept_from_winning_decision', () => {
    const comp = makeComponent({ id: 'bhp2' });
    const d1 = makeDecision({ componentId: 'bhp2', action: 'include', path: 'default_include' });
    const d1WithHint = { ...d1, budgetHint: 'protected' as const };
    const d2 = makeDecision({ componentId: 'bhp2', action: 'omit', path: 'safe_to_omit_match', selectorName: 'Sel2' });
    const d2WithHint = { ...d2, budgetHint: 'candidate_optional' as const };
    const [, te1] = wire(d1);
    const [, te2] = wire(d2);

    const result = runConflictResolver(
      [d1WithHint as SelectionDecision, d2WithHint as SelectionDecision],
      [te1, te2],
      makeInputs(),
      makeMap(comp),
    );

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'bhp2')!;
    expect(resolved.budgetHint).toBe('protected');
    expect(resolved.mergeRuleTrace).toBe('budget_hint_kept_from_winning_decision');
  });

  it('winner has expensive_optional, loser has over_budget_protected → over_budget_protected promoted', () => {
    const comp = makeComponent({ id: 'bhp3' });
    const d1 = makeDecision({ componentId: 'bhp3', action: 'include', path: 'default_include' });
    const d1WithHint = { ...d1, budgetHint: 'expensive_optional' as const };
    const d2 = makeDecision({ componentId: 'bhp3', action: 'omit', path: 'safe_to_omit_match', selectorName: 'Sel2' });
    const d2WithHint = { ...d2, budgetHint: 'over_budget_protected' as const };
    const [, te1] = wire(d1);
    const [, te2] = wire(d2);

    const result = runConflictResolver(
      [d1WithHint as SelectionDecision, d2WithHint as SelectionDecision],
      [te1, te2],
      makeInputs(),
      makeMap(comp),
    );

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'bhp3')!;
    expect(resolved.budgetHint).toBe('over_budget_protected');
    expect(resolved.mergeRuleTrace).toBe('budget_hint_promoted_from_losing_decision');
  });

  it('only winner has hint, loser has none → winner hint kept; budget_hint_kept_from_winning_decision', () => {
    const comp = makeComponent({ id: 'bhp4' });
    const d1 = makeDecision({ componentId: 'bhp4', action: 'include', path: 'default_include' });
    const d1WithHint = { ...d1, budgetHint: 'unknown_cost' as const };
    const d2 = makeDecision({ componentId: 'bhp4', action: 'omit', path: 'safe_to_omit_match', selectorName: 'Sel2' });
    const [, te1] = wire(d1);
    const [, te2] = wire(d2);

    const result = runConflictResolver(
      [d1WithHint as SelectionDecision, d2 as SelectionDecision],
      [te1, te2],
      makeInputs(),
      makeMap(comp),
    );

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'bhp4')!;
    expect(resolved.budgetHint).toBe('unknown_cost');
    expect(resolved.mergeRuleTrace).toBe('budget_hint_kept_from_winning_decision');
  });

  it('only loser has hint, winner has none → loser hint promoted; budget_hint_promoted_from_losing_decision', () => {
    const comp = makeComponent({ id: 'bhp5' });
    const d1 = makeDecision({ componentId: 'bhp5', action: 'include', path: 'default_include' });
    const d2 = makeDecision({ componentId: 'bhp5', action: 'omit', path: 'safe_to_omit_match', selectorName: 'Sel2' });
    const d2WithHint = { ...d2, budgetHint: 'candidate_optional' as const };
    const [, te1] = wire(d1);
    const [, te2] = wire(d2);

    const result = runConflictResolver(
      [d1 as SelectionDecision, d2WithHint as SelectionDecision],
      [te1, te2],
      makeInputs(),
      makeMap(comp),
    );

    const resolved = result.resolvedDecisions.find(r => r.componentId === 'bhp5')!;
    expect(resolved.budgetHint).toBe('candidate_optional');
    expect(resolved.mergeRuleTrace).toBe('budget_hint_promoted_from_losing_decision');
  });
});

// ---------------------------------------------------------------------------
// §23 — preGatePaths validity: never emits action values as paths (Fix 3)
// ---------------------------------------------------------------------------

describe('Phase 8 — preGatePaths validity (never action values)', () => {

  /** Action values that are NOT valid path values. */
  const ACTION_VALUES_ONLY = new Set(['include', 'omit', 'defer', 'reference_unknown']);

  it('gate-converted decision with originalCandidatePath → preGatePaths contains path (not raw action)', () => {
    const comp = makeComponent({ id: 'pgp1' });
    const d1 = makeDecision({ componentId: 'pgp1', action: 'include', path: 'fail_open' });
    const d2 = makeDecision({ componentId: 'pgp1', action: 'omit', path: 'default_action_omit', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1, {
      actionChanged: true,
      originalCandidateAction: 'omit',
      originalCandidatePath: 'safe_to_omit_match',
    });
    const [dec2, te2] = wire(d2);
    const result = runConflictResolver([dec1, dec2], [te1, te2], makeInputs(), makeMap(comp));

    const traceEntry = result.conflictResolutionTrace.find(e => e.componentId === 'pgp1')!;
    expect(traceEntry.preGatePaths).toBeDefined();
    expect(traceEntry.preGatePaths).toContain('safe_to_omit_match');
    for (const p of traceEntry.preGatePaths ?? []) {
      expect(ACTION_VALUES_ONLY.has(p)).toBe(false);
    }
  });

  it('gate-converted decision WITHOUT originalCandidatePath → preGatePaths is absent (no action-as-path fallback)', () => {
    const comp = makeComponent({ id: 'pgp2' });
    const d1 = makeDecision({ componentId: 'pgp2', action: 'include', path: 'fail_open' });
    const d2 = makeDecision({ componentId: 'pgp2', action: 'omit', path: 'default_action_omit', selectorName: 'Sel2' });
    const [dec1, te1] = wire(d1, {
      actionChanged: true,
      originalCandidateAction: 'omit',
      // No originalCandidatePath set.
    });
    const [dec2, te2] = wire(d2);
    const result = runConflictResolver([dec1, dec2], [te1, te2], makeInputs(), makeMap(comp));

    const traceEntry = result.conflictResolutionTrace.find(e => e.componentId === 'pgp2')!;
    // Must be undefined — not emitted as 'include' or 'omit'.
    expect(traceEntry.preGatePaths).toBeUndefined();
  });

  it('no action value ever appears in preGatePaths across mixed scenarios', () => {
    const comp1 = makeComponent({ id: 'pgp3' });
    const comp2 = makeComponent({ id: 'pgp4' });

    const d1a = makeDecision({ componentId: 'pgp3', action: 'include', path: 'fail_open' });
    const d1b = makeDecision({ componentId: 'pgp3', action: 'omit', path: 'default_action_omit', selectorName: 'S2' });
    const [dec1a, te1a] = wire(d1a, {
      actionChanged: true,
      originalCandidateAction: 'omit',
      originalCandidatePath: 'safe_to_omit_match',
    });
    const [dec1b, te1b] = wire(d1b);

    // pgp4: gate-converted but no originalCandidatePath.
    const d2a = makeDecision({ componentId: 'pgp4', action: 'include', path: 'fail_open' });
    const d2b = makeDecision({ componentId: 'pgp4', action: 'omit', path: 'default_action_omit', selectorName: 'S2' });
    const [dec2a, te2a] = wire(d2a, { actionChanged: true, originalCandidateAction: 'omit' });
    const [dec2b, te2b] = wire(d2b);

    const result = runConflictResolver(
      [dec1a, dec1b, dec2a, dec2b],
      [te1a, te1b, te2a, te2b],
      makeInputs(),
      makeMap(comp1, comp2),
    );

    for (const entry of result.conflictResolutionTrace) {
      for (const p of entry.preGatePaths ?? []) {
        expect(ACTION_VALUES_ONLY.has(p)).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// §SHP — safety_hard_protection synthetic conflict (Fixture 13 coverage)
// ---------------------------------------------------------------------------

describe('Phase 8 — safety_hard_protection synthetic conflict (Fixture 13 coverage)', () => {

  it('SHP-1: include/safety_override wins over omit/safe_to_omit_match for same componentId', () => {
    // Synthetic decisions for the same component:
    //   Decision A: include / safety_override (from hard protection)
    //   Decision B: omit / safe_to_omit_match (hypothetical safeToOmitWhen match)
    // This conflict is not reachable through current MVP E2E selector routing
    // because the deterministic ladder applies hard protection (Step 3) before
    // safeToOmitWhen (Step 7). This test exercises the conflict resolver code
    // path directly with synthetic input decisions.
    const comp = makeComponent({
      id: 'scaffold.safety-rules',
      type: 'scaffold',
      retainPolicy: 'safety_critical',
      omissionPolicy: 'never',
      riskLevel: 'critical',
    });

    const d1 = makeDecision({
      componentId: 'scaffold.safety-rules',
      action: 'include',
      path: 'safety_override',
      selectorName: 'deterministic_scaffold',
      reason: 'Hard include protection fired (retainPolicy=safety_critical).',
    });
    const d2 = makeDecision({
      componentId: 'scaffold.safety-rules',
      action: 'omit',
      path: 'safe_to_omit_match',
      selectorName: 'deterministic_scaffold',
      reason: 'Component may be safely omitted (Path A).',
    });

    const [dec1, te1] = wire(d1);
    const [dec2, te2] = wire(d2);

    const result = runConflictResolver(
      [dec1, dec2],
      [te1, te2],
      makeInputs(),
      makeMap(comp),
    );

    // Resolved decision
    const rd = result.resolvedDecisions.find(
      r => r.componentId === 'scaffold.safety-rules',
    );
    expect(rd).toBeDefined();
    expect(rd!.finalAction).toBe('include');
    expect(rd!.finalPath).toBe('safety_override');
    expect(rd!.resolutionRule).toBe('safety_hard_protection');

    // losingDecisions includes the omit decision
    expect(rd!.losingDecisions.length).toBeGreaterThan(0);
    expect(rd!.losingDecisions.some(l => l.action === 'omit')).toBe(true);
    expect(rd!.losingDecisions.some(l => l.path === 'safe_to_omit_match')).toBe(true);

    // warningsEmitted includes safety_override_omit_decision
    expect(rd!.warningsEmitted).toContain('safety_override_omit_decision');

    // conflictResolutionTrace has an entry
    const crt = result.conflictResolutionTrace.find(
      c => c.componentId === 'scaffold.safety-rules',
    );
    expect(crt).toBeDefined();
    expect(crt!.resolutionRule).toBe('safety_hard_protection');
    expect(crt!.warningsEmitted).toContain('safety_override_omit_decision');
  });
});
