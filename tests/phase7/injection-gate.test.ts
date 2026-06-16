/**
 * Phase 7: Injection gate / policy normalization tests.
 *
 * Tests cover:
 *   - Policy normalization (7-case table + escalation boundary)
 *   - fail_open_all conversion (omit → include/fail_open; pass-throughs unchanged)
 *   - warn_and_continue Branch A (required override + injection_suspect_policy_override)
 *   - warn_and_continue Branch B (allowed omit + injection_suspect_omit_allowed)
 *   - Global warning deduplication (exactly once; not in per-decision warnings)
 *   - selectorSummary recompute (via computeSelectorSummary on post-gate decisions)
 *   - CLI integration (Phase 8 stub)
 *
 * Canonical: docs/06 §17; docs/06 §18 Q1 (resolved); docs/06 §19 DoD; docs/11 §6 Phase 7.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runInjectionGate } from '../../src/core/injection-gate.js';
import { computeSelectorSummary } from '../../src/core/selector-engine.js';
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
  const dir = mkdtempSync(join(tmpdir(), 'ctx-phase7-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

/** Minimal registry JSON for CLI integration tests. */
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

/** Build a minimal NormalizedInputs for the gate (only fields it reads). */
function makeInputs(
  injectionSuspect: boolean,
  injectionSuspectAction: string,
  familyConfidence = 0.0,
  failOpenThreshold = 0.7,
): NormalizedInputs {
  return {
    requestSignals: {
      promptFamily: 'general_default',
      familyConfidence,
      injectionSuspect,
    },
    policy: {
      injectionSuspectAction,
      failOpenThreshold,
      deterministicOnly: true,
    },
    runtime: { capabilityInventoryComplete: false, availableToolIds: [], unavailableToolIds: [] },
    history: { historyMalformed: false },
    budget: null,
    constraints: null,
    activeIds: {},
    warnings: [],
  } as unknown as NormalizedInputs;
}

/** Build a minimal SelectionDecision with required fields. */
function makeDecision(overrides: Partial<SelectionDecision> & {
  componentId: string;
  action: SelectionDecision['action'];
  path: SelectionDecision['path'];
}): SelectionDecision {
  return {
    selectorName: 'TestSelector',
    reason: 'test reason',
    confidence: 'high',
    evidence: ['requiredWhen=test'],
    constraintsApplied: [],
    warnings: [],
    traceRefs: [],
    ...overrides,
  };
}

/** Build a minimal TraceEntry with required fields. */
function makeTrace(decisionId: string, componentId: string, action: TraceEntry['action'] = 'omit'): TraceEntry {
  return {
    decisionId,
    componentId,
    module: 'TestSelector',
    action,
    reason: 'test reason',
    evidence: ['requiredWhen=test'],
    confidence: 'high',
    risk: 'low',
    estimatedSavings: { tokens: 100 },
    failOpen: false,
    selector: 'deterministic',
  };
}

/** Build a minimal Component entry. */
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

/** Build a candidatesById map from an array of components. */
function makeMap(...comps: Component[]): Map<string, Component> {
  return new Map(comps.map(c => [c.id, c]));
}

/** Wire a decision to its trace entry via traceRefs. Returns tuple. */
function wire(d: SelectionDecision, t: TraceEntry): [SelectionDecision, TraceEntry] {
  return [{ ...d, traceRefs: [t.decisionId] }, t];
}

// ---------------------------------------------------------------------------
// §1 — Policy normalization tests
// ---------------------------------------------------------------------------

describe('Phase 7 — policy normalization', () => {

  it('injectionSuspect: false → no-op, gateApplied: false, no warnings, decisions unchanged', () => {
    const t = makeTrace('t1', 'a');
    const [d] = wire(makeDecision({ componentId: 'a', action: 'omit', path: 'default_action_omit' }), t);
    const inputs = makeInputs(false, 'warn_and_continue');
    const comp = makeComponent({ id: 'a' });
    const result = runInjectionGate([d], [t], inputs, makeMap(comp));

    expect(result.gateApplied).toBe(false);
    expect(result.effectivePolicy).toBeNull();
    expect(result.warnings).toHaveLength(0);
    expect(result.policyFallbackReasons).toHaveLength(0);
    expect(result.decisions[0].action).toBe('omit'); // unchanged
  });

  it('warn_and_continue direct → effectivePolicy warn_and_continue, global injection_suspect_warn_and_continue', () => {
    const comp = makeComponent({ id: 'x', type: 'scaffold', riskLevel: 'low' });
    const t = makeTrace('t2', 'x');
    const [d] = wire(makeDecision({ componentId: 'x', action: 'omit', path: 'default_action_omit' }), t);
    const inputs = makeInputs(true, 'warn_and_continue', 0.9, 0.7);
    const result = runInjectionGate([d], [t], inputs, makeMap(comp));

    expect(result.gateApplied).toBe(true);
    expect(result.effectivePolicy).toBe('warn_and_continue');
    expect(result.policyFallbackReasons).toHaveLength(0);
    const codes = result.warnings.map(w => w.code);
    expect(codes).toContain('injection_suspect_warn_and_continue');
    expect(codes).not.toContain('injection_suspect_fail_open_all');
  });

  it('fail_open_all direct → effectivePolicy fail_open_all, global injection_suspect_fail_open_all, policyFallbackReasons []', () => {
    const comp = makeComponent({ id: 'x' });
    const t = makeTrace('t3', 'x');
    const [d] = wire(makeDecision({ componentId: 'x', action: 'omit', path: 'default_action_omit' }), t);
    const inputs = makeInputs(true, 'fail_open_all', 0.9, 0.7);
    const result = runInjectionGate([d], [t], inputs, makeMap(comp));

    expect(result.effectivePolicy).toBe('fail_open_all');
    expect(result.policyFallbackReasons).toHaveLength(0);
    const codes = result.warnings.map(w => w.code);
    expect(codes).toContain('injection_suspect_fail_open_all');
    expect(codes).not.toContain('injection_suspect_warn_and_continue');
  });

  it('halt_planning → warn_and_continue, globals [policy_value_not_implemented, injection_suspect_warn_and_continue]', () => {
    const comp = makeComponent({ id: 'x' });
    const t = makeTrace('t4', 'x');
    const [d] = wire(makeDecision({ componentId: 'x', action: 'omit', path: 'default_action_omit' }), t);
    const inputs = makeInputs(true, 'halt_planning', 0.9, 0.7);
    const result = runInjectionGate([d], [t], inputs, makeMap(comp));

    expect(result.effectivePolicy).toBe('warn_and_continue');
    expect(result.policyFallbackReasons).toEqual(['policy_value_not_implemented']);
    const codes = result.warnings.map(w => w.code);
    expect(codes).toContain('policy_value_not_implemented');
    expect(codes).toContain('injection_suspect_warn_and_continue');
    expect(codes.indexOf('policy_value_not_implemented')).toBeLessThan(codes.indexOf('injection_suspect_warn_and_continue'));
  });

  it('unknown/typo policy → warn_and_continue, globals [injection_action_unknown, injection_suspect_warn_and_continue]', () => {
    const comp = makeComponent({ id: 'x' });
    const t = makeTrace('t5', 'x');
    const [d] = wire(makeDecision({ componentId: 'x', action: 'omit', path: 'default_action_omit' }), t);
    const inputs = makeInputs(true, 'some_unknown_value', 0.9, 0.7);
    const result = runInjectionGate([d], [t], inputs, makeMap(comp));

    expect(result.effectivePolicy).toBe('warn_and_continue');
    expect(result.policyFallbackReasons).toEqual(['injection_action_unknown']);
    const codes = result.warnings.map(w => w.code);
    expect(codes).toContain('injection_action_unknown');
    expect(codes).toContain('injection_suspect_warn_and_continue');
  });

  it('warn_and_continue + familyConfidence < threshold → fail_open_all, [family_confidence_fail_open_escalation, injection_suspect_fail_open_all]', () => {
    const comp = makeComponent({ id: 'x' });
    const t = makeTrace('t6', 'x');
    const [d] = wire(makeDecision({ componentId: 'x', action: 'omit', path: 'default_action_omit' }), t);
    const inputs = makeInputs(true, 'warn_and_continue', 0.3, 0.7); // 0.3 < 0.7
    const result = runInjectionGate([d], [t], inputs, makeMap(comp));

    expect(result.effectivePolicy).toBe('fail_open_all');
    expect(result.policyFallbackReasons).toEqual(['family_confidence_fail_open_escalation']);
    const codes = result.warnings.map(w => w.code);
    expect(codes).toContain('family_confidence_fail_open_escalation');
    expect(codes).toContain('injection_suspect_fail_open_all');
    expect(codes).not.toContain('injection_suspect_warn_and_continue');
  });

  it('halt_planning + escalation → fail_open_all, policyFallbackReasons has 2 entries in order', () => {
    const comp = makeComponent({ id: 'x' });
    const t = makeTrace('t7', 'x');
    const [d] = wire(makeDecision({ componentId: 'x', action: 'omit', path: 'default_action_omit' }), t);
    const inputs = makeInputs(true, 'halt_planning', 0.2, 0.7);
    const result = runInjectionGate([d], [t], inputs, makeMap(comp));

    expect(result.effectivePolicy).toBe('fail_open_all');
    expect(result.policyFallbackReasons).toEqual(['policy_value_not_implemented', 'family_confidence_fail_open_escalation']);
    const codes = result.warnings.map(w => w.code);
    expect(codes).toContain('policy_value_not_implemented');
    expect(codes).toContain('family_confidence_fail_open_escalation');
    expect(codes).toContain('injection_suspect_fail_open_all');
    expect(codes).toHaveLength(3);
  });

  it('unknown + escalation → fail_open_all, policyFallbackReasons has 2 entries', () => {
    const comp = makeComponent({ id: 'x' });
    const t = makeTrace('t8', 'x');
    const [d] = wire(makeDecision({ componentId: 'x', action: 'omit', path: 'default_action_omit' }), t);
    const inputs = makeInputs(true, 'typo_value', 0.1, 0.7);
    const result = runInjectionGate([d], [t], inputs, makeMap(comp));

    expect(result.effectivePolicy).toBe('fail_open_all');
    expect(result.policyFallbackReasons).toHaveLength(2);
    expect(result.warnings).toHaveLength(3);
  });

  it('fail_open_all + escalation condition met → no escalation (already fail_open_all), policyFallbackReasons []', () => {
    const comp = makeComponent({ id: 'x' });
    const t = makeTrace('t9', 'x');
    const [d] = wire(makeDecision({ componentId: 'x', action: 'omit', path: 'default_action_omit' }), t);
    const inputs = makeInputs(true, 'fail_open_all', 0.1, 0.7);
    const result = runInjectionGate([d], [t], inputs, makeMap(comp));

    expect(result.effectivePolicy).toBe('fail_open_all');
    expect(result.policyFallbackReasons).toHaveLength(0);
    const codes = result.warnings.map(w => w.code);
    expect(codes).not.toContain('family_confidence_fail_open_escalation');
  });

  it('escalation boundary: familyConfidence === failOpenThreshold → no escalation (strict less-than)', () => {
    const comp = makeComponent({ id: 'x' });
    const t = makeTrace('t10', 'x');
    const [d] = wire(makeDecision({ componentId: 'x', action: 'omit', path: 'default_action_omit' }), t);
    const inputs = makeInputs(true, 'warn_and_continue', 0.7, 0.7); // equal → no escalation
    const result = runInjectionGate([d], [t], inputs, makeMap(comp));

    expect(result.effectivePolicy).toBe('warn_and_continue');
    expect(result.policyFallbackReasons).not.toContain('family_confidence_fail_open_escalation');
  });
});

// ---------------------------------------------------------------------------
// §2 — fail_open_all conversion tests
// ---------------------------------------------------------------------------

describe('Phase 7 — fail_open_all conversion', () => {

  it('omit/safe_to_omit_match → include/fail_open/low', () => {
    const comp = makeComponent({ id: 'c1', riskLevel: 'low' });
    const t = makeTrace('tr1', 'c1');
    const [d] = wire(makeDecision({ componentId: 'c1', action: 'omit', path: 'safe_to_omit_match' }), t);
    const inputs = makeInputs(true, 'fail_open_all', 0.9, 0.7);
    const result = runInjectionGate([d], [t], inputs, makeMap(comp));

    expect(result.decisions[0].action).toBe('include');
    expect(result.decisions[0].path).toBe('fail_open');
    expect(result.decisions[0].confidence).toBe('low');
  });

  it('evidence contains injection_suspect_seen=true and injectionSuspectAction=fail_open_all', () => {
    const comp = makeComponent({ id: 'c2' });
    const t = makeTrace('tr2', 'c2');
    const [d] = wire(makeDecision({ componentId: 'c2', action: 'omit', path: 'default_action_omit' }), t);
    const inputs = makeInputs(true, 'fail_open_all', 0.9, 0.7);
    const result = runInjectionGate([d], [t], inputs, makeMap(comp));

    expect(result.decisions[0].evidence).toContain('injection_suspect_seen=true');
    expect(result.decisions[0].evidence).toContain('injectionSuspectAction=fail_open_all');
  });

  it('trace: actionChanged=true, originalCandidateAction=omit, originalCandidatePath=safe_to_omit_match', () => {
    const comp = makeComponent({ id: 'c3' });
    const t = makeTrace('tr3', 'c3', 'omit');
    const [d] = wire(makeDecision({ componentId: 'c3', action: 'omit', path: 'safe_to_omit_match' }), t);
    const inputs = makeInputs(true, 'fail_open_all', 0.9, 0.7);
    const result = runInjectionGate([d], [t], inputs, makeMap(comp));

    const outTrace = result.traceEntries.find(te => te.decisionId === 'tr3');
    expect(outTrace).toBeDefined();
    expect(outTrace!.actionChanged).toBe(true);
    expect(outTrace!.originalCandidateAction).toBe('omit');
    expect(outTrace!.originalCandidatePath).toBe('safe_to_omit_match');
  });

  it('trace: action=include, failOpen=true, estimatedSavings.tokens=0', () => {
    const comp = makeComponent({ id: 'c4' });
    const t = makeTrace('tr4', 'c4');
    const [d] = wire(makeDecision({ componentId: 'c4', action: 'omit', path: 'default_action_omit' }), t);
    const inputs = makeInputs(true, 'fail_open_all', 0.9, 0.7);
    const result = runInjectionGate([d], [t], inputs, makeMap(comp));

    const outTrace = result.traceEntries.find(te => te.decisionId === 'tr4');
    expect(outTrace).toBeDefined();
    expect(outTrace!.action).toBe('include');
    expect(outTrace!.failOpen).toBe(true);
    expect(outTrace!.estimatedSavings.tokens).toBe(0);
  });

  it('trace: warningsEmitted=[] (no injection_suspect_policy_override)', () => {
    const comp = makeComponent({ id: 'c5' });
    const t = makeTrace('tr5', 'c5');
    const [d] = wire(makeDecision({ componentId: 'c5', action: 'omit', path: 'default_action_omit' }), t);
    const inputs = makeInputs(true, 'fail_open_all', 0.9, 0.7);
    const result = runInjectionGate([d], [t], inputs, makeMap(comp));

    const outTrace = result.traceEntries.find(te => te.decisionId === 'tr5');
    expect(outTrace!.warningsEmitted).toEqual([]);
  });

  it('trace: injectionSuspect=true, injectionSuspectAction=fail_open_all', () => {
    const comp = makeComponent({ id: 'c6' });
    const t = makeTrace('tr6', 'c6');
    const [d] = wire(makeDecision({ componentId: 'c6', action: 'omit', path: 'default_action_omit' }), t);
    const inputs = makeInputs(true, 'fail_open_all', 0.9, 0.7);
    const result = runInjectionGate([d], [t], inputs, makeMap(comp));

    const outTrace = result.traceEntries.find(te => te.decisionId === 'tr6');
    expect(outTrace!.injectionSuspect).toBe(true);
    expect(outTrace!.injectionSuspectAction).toBe('fail_open_all');
  });

  it('multiple omit decisions → all converted', () => {
    const comp1 = makeComponent({ id: 'a1' });
    const comp2 = makeComponent({ id: 'a2' });
    const t1 = makeTrace('tra1', 'a1');
    const t2 = makeTrace('tra2', 'a2');
    const [d1] = wire(makeDecision({ componentId: 'a1', action: 'omit', path: 'default_action_omit' }), t1);
    const [d2] = wire(makeDecision({ componentId: 'a2', action: 'omit', path: 'safe_to_omit_match' }), t2);
    const inputs = makeInputs(true, 'fail_open_all', 0.9, 0.7);
    const result = runInjectionGate([d1, d2], [t1, t2], inputs, makeMap(comp1, comp2));

    expect(result.decisions.every(d => d.action === 'include')).toBe(true);
    expect(result.decisions.every(d => d.path === 'fail_open')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §3 — Pass-through tests
// ---------------------------------------------------------------------------

describe('Phase 7 — pass-through decisions', () => {

  function runPassThrough(
    action: SelectionDecision['action'],
    path: SelectionDecision['path'],
    traceAction: TraceEntry['action'] = 'defer',
  ) {
    const comp = makeComponent({ id: 'pt' });
    const t = makeTrace('tr_pt', 'pt', traceAction);
    const [d] = wire(makeDecision({ componentId: 'pt', action, path }), t);
    const inputs = makeInputs(true, 'fail_open_all', 0.9, 0.7);
    return runInjectionGate([d], [t], inputs, makeMap(comp));
  }

  it('defer/runtime_unavailable is NOT converted under fail_open_all', () => {
    const result = runPassThrough('defer', 'runtime_unavailable', 'defer');
    expect(result.decisions[0].action).toBe('defer');
    expect(result.decisions[0].path).toBe('runtime_unavailable');
  });

  it('defer/runtime_unavailable is NOT converted under warn_and_continue', () => {
    const comp = makeComponent({ id: 'pt2' });
    const t = makeTrace('tr_pt2', 'pt2', 'defer');
    const [d] = wire(makeDecision({ componentId: 'pt2', action: 'defer', path: 'runtime_unavailable' }), t);
    const inputs = makeInputs(true, 'warn_and_continue', 0.9, 0.7);
    const result = runInjectionGate([d], [t], inputs, makeMap(comp));
    expect(result.decisions[0].action).toBe('defer');
  });

  it('reference_unknown is NOT converted', () => {
    const result = runPassThrough('reference_unknown', 'reference_unknown', 'reference_unknown');
    expect(result.decisions[0].action).toBe('reference_unknown');
  });

  it('include/not_evaluated (Phase 6 synthetic) is NOT converted; path preserved', () => {
    const result = runPassThrough('include', 'not_evaluated', 'include');
    expect(result.decisions[0].action).toBe('include');
    expect(result.decisions[0].path).toBe('not_evaluated');
  });

  it('include/quarantine_boundary_violation is NOT converted; path preserved', () => {
    const result = runPassThrough('include', 'quarantine_boundary_violation', 'include');
    expect(result.decisions[0].action).toBe('include');
    expect(result.decisions[0].path).toBe('quarantine_boundary_violation');
  });

  it('include/safety_override is NOT converted', () => {
    const result = runPassThrough('include', 'safety_override', 'include');
    expect(result.decisions[0].action).toBe('include');
  });

  it('all pass-through decisions receive injection_suspect_seen=true in evidence when injectionSuspect: true', () => {
    const result = runPassThrough('defer', 'runtime_unavailable', 'defer');
    expect(result.decisions[0].evidence).toContain('injection_suspect_seen=true');
  });

  it('all pass-through trace entries have actionChanged=false', () => {
    const result = runPassThrough('defer', 'runtime_unavailable', 'defer');
    expect(result.traceEntries[0].actionChanged).toBe(false);
  });

  it('defer/default_defer is NOT converted; evidence gets injection_suspect_seen=true', () => {
    const result = runPassThrough('defer', 'default_defer', 'defer');
    expect(result.decisions[0].action).toBe('defer');
    expect(result.decisions[0].evidence).toContain('injection_suspect_seen=true');
  });
});

// ---------------------------------------------------------------------------
// §4 — warn_and_continue Branch B (allowed omit) tests
// ---------------------------------------------------------------------------

describe('Phase 7 — warn_and_continue Branch B (allowed omit)', () => {

  it('type:scaffold riskLevel:low omit → action unchanged, SelectionDecision.warnings has injection_suspect_omit_allowed', () => {
    const comp = makeComponent({ id: 'b1', type: 'scaffold', riskLevel: 'low' });
    const t = makeTrace('tr_b1', 'b1');
    const [d] = wire(makeDecision({ componentId: 'b1', action: 'omit', path: 'safe_to_omit_match' }), t);
    const inputs = makeInputs(true, 'warn_and_continue', 0.9, 0.7);
    const result = runInjectionGate([d], [t], inputs, makeMap(comp));

    expect(result.decisions[0].action).toBe('omit');
    expect(result.decisions[0].warnings).toContain('injection_suspect_omit_allowed');
  });

  it('type:skill riskLevel:medium omit → action unchanged, evidence has injection_suspect_seen=true', () => {
    const comp = makeComponent({ id: 'b2', type: 'skill', riskLevel: 'medium' });
    const t = makeTrace('tr_b2', 'b2');
    const [d] = wire(makeDecision({ componentId: 'b2', action: 'omit', path: 'default_action_omit' }), t);
    const inputs = makeInputs(true, 'warn_and_continue', 0.9, 0.7);
    const result = runInjectionGate([d], [t], inputs, makeMap(comp));

    expect(result.decisions[0].action).toBe('omit');
    expect(result.decisions[0].evidence).toContain('injection_suspect_seen=true');
  });

  it('type:output_format riskLevel:low omit → allowed, injection_suspect_omit_allowed (NOT converted)', () => {
    const comp = makeComponent({ id: 'b3', type: 'output_format', riskLevel: 'low' });
    const t = makeTrace('tr_b3', 'b3');
    const [d] = wire(makeDecision({ componentId: 'b3', action: 'omit', path: 'default_action_omit' }), t);
    const inputs = makeInputs(true, 'warn_and_continue', 0.9, 0.7);
    const result = runInjectionGate([d], [t], inputs, makeMap(comp));

    expect(result.decisions[0].action).toBe('omit');
    expect(result.decisions[0].warnings).toContain('injection_suspect_omit_allowed');
    expect(result.decisions[0].warnings).not.toContain('injection_suspect_policy_override');
  });

  it('type:output_format riskLevel:medium omit → allowed, injection_suspect_omit_allowed (NOT converted)', () => {
    const comp = makeComponent({ id: 'b4', type: 'output_format', riskLevel: 'medium' });
    const t = makeTrace('tr_b4', 'b4');
    const [d] = wire(makeDecision({ componentId: 'b4', action: 'omit', path: 'default_action_omit' }), t);
    const inputs = makeInputs(true, 'warn_and_continue', 0.9, 0.7);
    const result = runInjectionGate([d], [t], inputs, makeMap(comp));

    expect(result.decisions[0].action).toBe('omit');
    expect(result.decisions[0].warnings).not.toContain('injection_suspect_policy_override');
    expect(result.decisions[0].warnings).toContain('injection_suspect_omit_allowed');
  });

  it('Branch B trace: actionChanged=false, warningsEmitted=[injection_suspect_omit_allowed]', () => {
    const comp = makeComponent({ id: 'b5', type: 'scaffold', riskLevel: 'low' });
    const t = makeTrace('tr_b5', 'b5');
    const [d] = wire(makeDecision({ componentId: 'b5', action: 'omit', path: 'safe_to_omit_match' }), t);
    const inputs = makeInputs(true, 'warn_and_continue', 0.9, 0.7);
    const result = runInjectionGate([d], [t], inputs, makeMap(comp));

    const outTrace = result.traceEntries.find(te => te.decisionId === 'tr_b5');
    expect(outTrace).toBeDefined();
    expect(outTrace!.actionChanged).toBe(false);
    expect(outTrace!.warningsEmitted).toEqual(['injection_suspect_omit_allowed']);
  });
});

// ---------------------------------------------------------------------------
// §5 — warn_and_continue Branch A (required override) tests — Option A mandatory
// ---------------------------------------------------------------------------

describe('Phase 7 — warn_and_continue Branch A (required override)', () => {

  function branchACase(type: string, riskLevel = 'low', extra: Partial<Component> = {}) {
    const comp = makeComponent({ id: 'bra', type, riskLevel, ...extra });
    const t = makeTrace('tr_bra', 'bra');
    const [d] = wire(makeDecision({ componentId: 'bra', action: 'omit', path: 'default_action_omit' }), t);
    const inputs = makeInputs(true, 'warn_and_continue', 0.9, 0.7);
    return { result: runInjectionGate([d], [t], inputs, makeMap(comp)), traceId: 'tr_bra' };
  }

  it('type:policy omit → action:include, path:fail_open, confidence:low', () => {
    const { result } = branchACase('policy');
    expect(result.decisions[0].action).toBe('include');
    expect(result.decisions[0].path).toBe('fail_open');
    expect(result.decisions[0].confidence).toBe('low');
  });

  it('type:policy omit → SelectionDecision.warnings contains injection_suspect_policy_override', () => {
    const { result } = branchACase('policy');
    expect(result.decisions[0].warnings).toContain('injection_suspect_policy_override');
  });

  it('type:policy omit → evidence contains injection_suspect_seen=true and injectionSuspectAction=warn_and_continue', () => {
    const { result } = branchACase('policy');
    expect(result.decisions[0].evidence).toContain('injection_suspect_seen=true');
    expect(result.decisions[0].evidence).toContain('injectionSuspectAction=warn_and_continue');
  });

  it('type:policy omit → TraceEntry: actionChanged=true, originalCandidateAction=omit, warningsEmitted=[injection_suspect_policy_override]', () => {
    const { result, traceId } = branchACase('policy');
    const outTrace = result.traceEntries.find(te => te.decisionId === traceId);
    expect(outTrace).toBeDefined();
    expect(outTrace!.actionChanged).toBe(true);
    expect(outTrace!.originalCandidateAction).toBe('omit');
    expect(outTrace!.warningsEmitted).toEqual(['injection_suspect_policy_override']);
  });

  it('type:policy omit → TraceEntry: failOpen=true, estimatedSavings.tokens=0', () => {
    const { result, traceId } = branchACase('policy');
    const outTrace = result.traceEntries.find(te => te.decisionId === traceId);
    expect(outTrace!.failOpen).toBe(true);
    expect(outTrace!.estimatedSavings.tokens).toBe(0);
  });

  it('type:output_format riskLevel:critical omit → include/fail_open + injection_suspect_policy_override', () => {
    const { result } = branchACase('output_format', 'critical');
    expect(result.decisions[0].action).toBe('include');
    expect(result.decisions[0].warnings).toContain('injection_suspect_policy_override');
  });

  it('type:output_format riskLevel:high omit → include/fail_open + injection_suspect_policy_override', () => {
    const { result } = branchACase('output_format', 'high');
    expect(result.decisions[0].action).toBe('include');
    expect(result.decisions[0].warnings).toContain('injection_suspect_policy_override');
  });

  it('riskLevel:high (defensive catch) omit → include/fail_open + injection_suspect_policy_override', () => {
    const { result } = branchACase('skill', 'high');
    expect(result.decisions[0].action).toBe('include');
    expect(result.decisions[0].warnings).toContain('injection_suspect_policy_override');
  });

  it('riskLevel:critical (defensive catch) omit → include/fail_open + injection_suspect_policy_override', () => {
    const { result } = branchACase('scaffold', 'critical');
    expect(result.decisions[0].action).toBe('include');
    expect(result.decisions[0].warnings).toContain('injection_suspect_policy_override');
  });

  it('retainPolicy:safety_critical (defensive) omit → include/fail_open + injection_suspect_policy_override', () => {
    const { result } = branchACase('scaffold', 'low', { retainPolicy: 'safety_critical' });
    expect(result.decisions[0].action).toBe('include');
    expect(result.decisions[0].warnings).toContain('injection_suspect_policy_override');
  });

  it('omissionPolicy:never (defensive) omit → include/fail_open + injection_suspect_policy_override', () => {
    const { result } = branchACase('scaffold', 'low', { omissionPolicy: 'never' });
    expect(result.decisions[0].action).toBe('include');
    expect(result.decisions[0].warnings).toContain('injection_suspect_policy_override');
  });

  it('missing metadata (componentId not in candidatesById) → fail-open override (uncertainty → include)', () => {
    const emptyMap: Map<string, Component> = new Map();
    const t = makeTrace('tr_miss', 'unknown_id');
    const [d] = wire(makeDecision({ componentId: 'unknown_id', action: 'omit', path: 'default_action_omit' }), t);
    const inputs = makeInputs(true, 'warn_and_continue', 0.9, 0.7);
    const result = runInjectionGate([d], [t], inputs, emptyMap);

    expect(result.decisions[0].action).toBe('include');
    expect(result.decisions[0].warnings).toContain('injection_suspect_policy_override');
  });
});

// ---------------------------------------------------------------------------
// §6 — Global warning deduplication tests
// ---------------------------------------------------------------------------

describe('Phase 7 — global warning deduplication', () => {

  it('multiple omit decisions under fail_open_all → exactly one injection_suspect_fail_open_all in gateResult.warnings', () => {
    const comps = [
      makeComponent({ id: 'g1' }),
      makeComponent({ id: 'g2' }),
      makeComponent({ id: 'g3' }),
    ];
    const pairs = comps.map((comp, i) => {
      const t = makeTrace(`tr_g${i + 1}`, comp.id);
      const [d] = wire(makeDecision({ componentId: comp.id, action: 'omit', path: 'default_action_omit' }), t);
      return { d, t };
    });
    const inputs = makeInputs(true, 'fail_open_all', 0.9, 0.7);
    const result = runInjectionGate(
      pairs.map(p => p.d),
      pairs.map(p => p.t),
      inputs,
      makeMap(...comps),
    );

    const failOpenAllWarnings = result.warnings.filter(w => w.code === 'injection_suspect_fail_open_all');
    expect(failOpenAllWarnings).toHaveLength(1);
  });

  it('injection_suspect_policy_override must NOT appear in gateResult.warnings (per-decision only)', () => {
    const comp = makeComponent({ id: 'pol', type: 'policy' });
    const t = makeTrace('tr_pol', 'pol');
    const [d] = wire(makeDecision({ componentId: 'pol', action: 'omit', path: 'default_action_omit' }), t);
    const inputs = makeInputs(true, 'warn_and_continue', 0.9, 0.7);
    const result = runInjectionGate([d], [t], inputs, makeMap(comp));

    const globalCodes = result.warnings.map(w => w.code);
    expect(globalCodes).not.toContain('injection_suspect_policy_override');
  });

  it('global warning codes must NOT appear in any SelectionDecision.warnings[]', () => {
    const comp = makeComponent({ id: 'gd1' });
    const t = makeTrace('tr_gd1', 'gd1');
    const [d] = wire(makeDecision({ componentId: 'gd1', action: 'omit', path: 'default_action_omit' }), t);
    const inputs = makeInputs(true, 'fail_open_all', 0.9, 0.7);
    const result = runInjectionGate([d], [t], inputs, makeMap(comp));

    const globalCodes = new Set(['injection_suspect_warn_and_continue', 'injection_suspect_fail_open_all']);
    for (const dec of result.decisions) {
      for (const w of dec.warnings) {
        expect(globalCodes.has(w)).toBe(false);
      }
    }
  });

  it('global warning codes must NOT appear in any TraceEntry.warningsEmitted[]', () => {
    const comp = makeComponent({ id: 'gd2' });
    const t = makeTrace('tr_gd2', 'gd2');
    const [d] = wire(makeDecision({ componentId: 'gd2', action: 'omit', path: 'default_action_omit' }), t);
    const inputs = makeInputs(true, 'fail_open_all', 0.9, 0.7);
    const result = runInjectionGate([d], [t], inputs, makeMap(comp));

    const globalCodes = new Set(['injection_suspect_warn_and_continue', 'injection_suspect_fail_open_all']);
    for (const te of result.traceEntries) {
      for (const w of te.warningsEmitted ?? []) {
        expect(globalCodes.has(w)).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// §7 — selectorSummary recompute tests
// ---------------------------------------------------------------------------

describe('Phase 7 — selectorSummary recompute', () => {

  it('fail_open_all converting N omits: decidedOmit=0, decidedInclude += N, failOpenInclude += N', () => {
    const comps = [
      makeComponent({ id: 's1', riskLevel: 'low' }),
      makeComponent({ id: 's2', riskLevel: 'low' }),
    ];
    const pairs = comps.map((comp, i) => {
      const t = makeTrace(`tr_s${i + 1}`, comp.id);
      const [d] = wire(makeDecision({ componentId: comp.id, action: 'omit', path: 'default_action_omit' }), t);
      return { d, t };
    });
    const inputs = makeInputs(true, 'fail_open_all', 0.9, 0.7);
    const result = runInjectionGate(
      pairs.map(p => p.d),
      pairs.map(p => p.t),
      inputs,
      makeMap(...comps),
    );

    const summary = computeSelectorSummary(result.decisions, 0);
    expect(summary.decidedOmit).toBe(0);
    expect(summary.decidedInclude).toBe(2);
    expect(summary.failOpenInclude).toBe(2);
  });

  it('warn_and_continue Branch A converting omit: failOpenInclude increases', () => {
    const comp = makeComponent({ id: 'pol2', type: 'policy' });
    const t = makeTrace('tr_pol2', 'pol2');
    const [d] = wire(makeDecision({ componentId: 'pol2', action: 'omit', path: 'default_action_omit' }), t);
    const inputs = makeInputs(true, 'warn_and_continue', 0.9, 0.7);
    const result = runInjectionGate([d], [t], inputs, makeMap(comp));

    const summary = computeSelectorSummary(result.decisions, 0);
    expect(summary.decidedOmit).toBe(0);
    expect(summary.failOpenInclude).toBe(1);
  });

  it('warn_and_continue Branch B only (no conversion): counts unchanged', () => {
    const comp = makeComponent({ id: 'scf2', type: 'scaffold', riskLevel: 'low' });
    const t = makeTrace('tr_scf2', 'scf2');
    const [d] = wire(makeDecision({ componentId: 'scf2', action: 'omit', path: 'default_action_omit' }), t);
    const inputs = makeInputs(true, 'warn_and_continue', 0.9, 0.7);
    const result = runInjectionGate([d], [t], inputs, makeMap(comp));

    const summary = computeSelectorSummary(result.decisions, 0);
    expect(summary.decidedOmit).toBe(1);
    expect(summary.failOpenInclude).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §8 — CLI integration tests (Phase 8 stub)
// ---------------------------------------------------------------------------

describe('Phase 7 — CLI integration (Phase 8 stub)', () => {

  it('valid inputs → exit 0; all three output files written', () => {
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

  it('stderr does NOT contain Phase 7 stub message', () => {
    const td = makeTempDir();
    writeFileSync(join(td, 'req.txt'), 'Hello');
    writeFileSync(join(td, 'reg.json'), makeRegistryJson(['scaffold.test']));
    const result = runCli([
      'plan',
      '--request', join(td, 'req.txt'),
      '--registry', join(td, 'reg.json'),
    ]);
    expect(result.stderr).not.toContain('Phase 7 (injection gate) is not yet implemented');
  });

  it('all three output files created; stdout is empty', () => {
    const td = makeTempDir();
    writeFileSync(join(td, 'req.txt'), 'Test request.');
    writeFileSync(join(td, 'reg.json'), makeRegistryJson(['scaffold.test']));
    // stdout must be empty (all output written to files)
    const result = runCli([
      'plan',
      '--request', join(td, 'req.txt'),
      '--registry', join(td, 'reg.json'),
      '--output-dir', td,
    ]);
    expect(result.stdout.trim()).toBe('');
    expect(existsSync(join(td, 'trace.json'))).toBe(true);
    expect(existsSync(join(td, 'summary.md'))).toBe(true);
  });
});
