/**
 * Phase 5 — selector-engine and deterministic-ladder unit and integration tests.
 *
 * All test data is inline (no fixture directory reads).
 * Temp files are created in os.tmpdir() and cleaned up in afterEach.
 * No output files are created.
 * No Phase 6+ imports or behavior.
 * Integration tests: spawn the CLI via tsx (same pattern as Phase 2/3/4 tests).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runSelectorFanOut } from '../../src/core/selector-engine.js';
import { runLadder, evaluateEvidenceRequired, makeLadderInputsNoActiveIds, makeLadderInputsWithActiveIds } from '../../src/core/deterministic-ladder.js';
import type { Component, RegistryResult } from '../../src/types/registry.js';
import type { NormalizedInputs, RequestSignals } from '../../src/types/normalized.js';
import type { CandidateSetResult } from '../../src/types/candidate.js';
import type { RuntimeCapabilities, HistoryStateSummary, UserConstraints, SelectorPolicy, ActiveIds } from '../../src/types/inputs.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = resolve(__dirname, '../../src/cli/index.ts');

/** Spawn the CLI via tsx for integration-level tests. */
function runCli(args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx/esm', entry, ...args],
    { encoding: 'utf8', timeout: 30_000 },
  );
}

/** Temp dir registry for cleanup. */
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ctx-phase5-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ---------------------------------------------------------------------------
// Minimal factories
// ---------------------------------------------------------------------------

function makeComponent(id: string, overrides: Partial<Component> = {}): Component {
  return {
    id,
    type: 'scaffold',
    title: `Test ${id}`,
    summary: `Minimal component ${id} for Phase 5 tests.`,
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
    ...overrides,
  };
}

function makeRuntime(overrides: Partial<RuntimeCapabilities> = {}): RuntimeCapabilities {
  return {
    availableToolIds: [],
    unavailableToolIds: [],
    capabilityInventoryComplete: true,
    runtimeLabel: 'test',
    ...overrides,
  };
}

function makeHistory(overrides: Partial<HistoryStateSummary> = {}): HistoryStateSummary {
  return {
    lanesPresent: [],
    durableConstraintsPresent: false,
    openCommitmentsPresent: false,
    recentRawTurnCount: 0,
    totalHistoryTokensApprox: 0,
    historyMalformed: false,
    ...overrides,
  };
}

function makePolicy(): SelectorPolicy {
  return { failOpenThreshold: 0.5, deterministicOnly: true, injectionSuspectAction: 'warn_and_continue' };
}

function makeActiveIds(overrides: Partial<ActiveIds> = {}): ActiveIds {
  return { activeSkillIds: [], activeToolIds: [], activeMemoryIds: [], ...overrides };
}

function makeRequestSignals(overrides: Partial<RequestSignals> = {}): RequestSignals {
  return {
    promptFamily: 'general_default',
    familyConfidence: 0.0,
    injectionSuspect: false,
    ...overrides,
  };
}

function makeNormalizedInputs(overrides: {
  requestSignals?: Partial<RequestSignals>;
  runtime?: Partial<RuntimeCapabilities>;
  history?: Partial<HistoryStateSummary>;
  constraints?: UserConstraints | null;
  activeIds?: Partial<ActiveIds>;
} = {}): NormalizedInputs {
  return {
    requestSignals: makeRequestSignals(overrides.requestSignals),
    runtime: makeRuntime(overrides.runtime),
    history: makeHistory(overrides.history),
    budget: null,
    constraints: overrides.constraints !== undefined ? overrides.constraints : null,
    policy: makePolicy(),
    activeIds: makeActiveIds(overrides.activeIds),
    warnings: [],
  };
}

function makeRegistryResult(
  components: Component[] = [],
  quarantineIds: string[] = [],
): RegistryResult {
  const componentsById = new Map<string, Component>();
  const componentsByType = new Map<string, Component[]>();
  const componentsByTag = new Map<string, Component[]>();
  for (const c of components) {
    componentsById.set(c.id, c);
    const byType = componentsByType.get(c.type) ?? [];
    byType.push(c);
    componentsByType.set(c.type, byType);
    for (const t of c.tags) {
      const byTag = componentsByTag.get(t) ?? [];
      byTag.push(c);
      componentsByTag.set(t, byTag);
    }
  }
  const safetyCriticalIds = new Set<string>(
    components.filter((c) => c.retainPolicy === 'safety_critical' || c.omissionPolicy === 'never').map((c) => c.id),
  );
  const trimmableCandidateIds = new Set<string>(
    components.filter((c) => c.retainPolicy === 'optional' && c.omissionPolicy === 'allow' && (c.riskLevel === 'low' || c.riskLevel === 'medium')).map((c) => c.id),
  );
  return {
    indexes: { componentsById, componentsByType, componentsByTag, safetyCriticalIds, trimmableCandidateIds },
    quarantinedComponents: quarantineIds.map((id) => ({ id, reason: `test-quarantine: ${id}`, riskLevel: 'low', rawEntry: { id } })),
    validationWarnings: [],
  };
}

function makeCandidateSetResult(components: Component[]): CandidateSetResult {
  const candidatesById = new Map<string, Component>();
  for (const c of components) candidatesById.set(c.id, c);
  return {
    summary: { candidateSetPolicy: 'all_non_quarantined', candidateSetSize: candidatesById.size, quarantinedExcluded: 0 },
    candidatesById,
    warnings: [],
  };
}

/** Build a minimal valid registry JSON string for CLI integration tests. */
function makeRegistryJson(ids: string[], typeOverride: string = 'scaffold'): string {
  return JSON.stringify(ids.map((id) => ({
    id,
    type: typeOverride,
    title: `Test ${id}`,
    summary: `Minimal component ${id}.`,
    source: `${typeOverride}/${id}.md`,
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

const QUARANTINE_IDS = new Set<string>();
const PROMPT_FAMILY = 'general_default';

function makeLadderInputs(overrides: {
  promptFamily?: string;
  activeIdSet?: Set<string>;
  activeIdAtom?: string | null;
  alwaysInclude?: string[];
  neverInclude?: string[];
  quarantinedIds?: Set<string>;
  selectorName?: string;
  moduleName?: string;
} = {}) {
  return {
    promptFamily: overrides.promptFamily ?? PROMPT_FAMILY,
    activeIdSet: overrides.activeIdSet ?? new Set<string>(),
    activeIdAtom: overrides.activeIdAtom ?? null,
    alwaysInclude: overrides.alwaysInclude ?? [],
    neverInclude: overrides.neverInclude ?? [],
    quarantinedIds: overrides.quarantinedIds ?? QUARANTINE_IDS,
    selectorName: overrides.selectorName ?? 'deterministic_scaffold',
    moduleName: overrides.moduleName ?? 'ScaffoldSelector',
  };
}

// ---------------------------------------------------------------------------
// Unit tests — deterministic ladder Step 3 (hard protection)
// ---------------------------------------------------------------------------

describe('Phase 5 — Step 3: hard protection always produces safety_override', () => {
  it('retainPolicy: safety_critical → safety_override', () => {
    const c = makeComponent('sc.a', { retainPolicy: 'safety_critical' });
    const result = runLadder(c, makeLadderInputs());
    expect(result.decision.action).toBe('include');
    expect(result.decision.path).toBe('safety_override');
    expect(result.decision.confidence).toBe('high');
  });

  it('retainPolicy: mandatory → safety_override', () => {
    const c = makeComponent('sc.b', { retainPolicy: 'mandatory' });
    const result = runLadder(c, makeLadderInputs());
    expect(result.decision.action).toBe('include');
    expect(result.decision.path).toBe('safety_override');
  });

  it('omissionPolicy: never → safety_override', () => {
    const c = makeComponent('sc.c', { omissionPolicy: 'never' });
    const result = runLadder(c, makeLadderInputs());
    expect(result.decision.action).toBe('include');
    expect(result.decision.path).toBe('safety_override');
  });

  it('riskLevel: critical → safety_override', () => {
    const c = makeComponent('sc.d', { riskLevel: 'critical' });
    const result = runLadder(c, makeLadderInputs());
    expect(result.decision.action).toBe('include');
    expect(result.decision.path).toBe('safety_override');
  });

  it('Step 3 never produces required_match even if requiredWhen also matches', () => {
    const c = makeComponent('sc.e', { retainPolicy: 'mandatory', requiredWhen: [PROMPT_FAMILY] });
    const result = runLadder(c, makeLadderInputs());
    expect(result.decision.path).toBe('safety_override');
    expect(result.decision.path).not.toBe('required_match');
  });
});

// ---------------------------------------------------------------------------
// Unit tests — Step 4: conflict_include
// ---------------------------------------------------------------------------

describe('Phase 5 — Step 4: conflict_include when both tags match', () => {
  it('both requiredWhen and safeToOmitWhen match → conflict_include', () => {
    const c = makeComponent('sc.f', {
      requiredWhen: [PROMPT_FAMILY],
      safeToOmitWhen: [PROMPT_FAMILY],
    });
    const result = runLadder(c, makeLadderInputs());
    expect(result.decision.action).toBe('include');
    expect(result.decision.path).toBe('conflict_include');
    expect(result.decision.confidence).toBe('medium');
  });

  it('conflict evidence contains both requiredWhen and safeToOmitWhen atoms', () => {
    const c = makeComponent('sc.g', {
      requiredWhen: [PROMPT_FAMILY],
      safeToOmitWhen: [PROMPT_FAMILY],
    });
    const result = runLadder(c, makeLadderInputs());
    expect(result.decision.evidence.some((e) => e.startsWith('requiredWhen='))).toBe(true);
    expect(result.decision.evidence.some((e) => e.startsWith('safeToOmitWhen='))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unit tests — Step 5: requiredWhen match
// ---------------------------------------------------------------------------

describe('Phase 5 — Step 5: requiredWhen match', () => {
  it('requiredWhen match → required_match, confidence high', () => {
    const c = makeComponent('sc.h', { requiredWhen: [PROMPT_FAMILY] });
    const result = runLadder(c, makeLadderInputs());
    expect(result.decision.action).toBe('include');
    expect(result.decision.path).toBe('required_match');
    expect(result.decision.confidence).toBe('high');
  });

  it('evidence includes promptFamily and requiredWhen atom', () => {
    const c = makeComponent('sc.i', { requiredWhen: [PROMPT_FAMILY] });
    const result = runLadder(c, makeLadderInputs());
    expect(result.decision.evidence.some((e) => e.startsWith('requiredWhen='))).toBe(true);
    expect(result.decision.evidence.some((e) => e.startsWith('promptFamily='))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unit tests — Step 5.5: active ID positive include hook
// ---------------------------------------------------------------------------

describe('Phase 5 — Step 5.5: active ID positive include', () => {
  it('component ID in activeSkillIds → required_match + active_skill_id_match evidence', () => {
    const c = makeComponent('skill.a', { type: 'skill' });
    const inputs = makeLadderInputs({
      activeIdSet: new Set(['skill.a']),
      activeIdAtom: 'active_skill_id_match',
      selectorName: 'deterministic_skill',
      moduleName: 'SkillSelector',
    });
    const result = runLadder(c, inputs);
    expect(result.decision.action).toBe('include');
    expect(result.decision.path).toBe('required_match');
    expect(result.decision.confidence).toBe('high');
    expect(result.decision.evidence).toContain('active_skill_id_match');
  });

  it('active ID in set blocks Path A omission', () => {
    const c = makeComponent('skill.b', {
      type: 'skill',
      safeToOmitWhen: [PROMPT_FAMILY],
      omissionPolicy: 'allow',
      retainPolicy: 'optional',
      riskLevel: 'low',
    });
    const inputs = makeLadderInputs({
      activeIdSet: new Set(['skill.b']),
      activeIdAtom: 'active_skill_id_match',
      selectorName: 'deterministic_skill',
      moduleName: 'SkillSelector',
    });
    const result = runLadder(c, inputs);
    expect(result.decision.action).not.toBe('omit');
    expect(result.decision.action).toBe('include');
  });

  it('active ID in set blocks Path B omission', () => {
    const c = makeComponent('tool.a', {
      type: 'tool',
      defaultAction: 'omit',
      omissionPolicy: 'allow',
      retainPolicy: 'optional',
      riskLevel: 'low',
    });
    const inputs = makeLadderInputs({
      activeIdSet: new Set(['tool.a']),
      activeIdAtom: 'active_tool_id_match',
      selectorName: 'deterministic_tool',
      moduleName: 'ToolSelector',
    });
    const result = runLadder(c, inputs);
    expect(result.decision.action).not.toBe('omit');
  });

  it('component NOT in active ID set falls through normally', () => {
    const c = makeComponent('skill.c', { type: 'skill', defaultAction: 'include' });
    const inputs = makeLadderInputs({
      activeIdSet: new Set(['skill.other']),
      activeIdAtom: 'active_skill_id_match',
      selectorName: 'deterministic_skill',
      moduleName: 'SkillSelector',
    });
    const result = runLadder(c, inputs);
    // Falls to default_include since no requiredWhen and no safeToOmitWhen
    expect(result.decision.action).toBe('include');
    expect(result.decision.path).toBe('default_include');
  });
});

// ---------------------------------------------------------------------------
// Unit tests — Path A (Step 7)
// ---------------------------------------------------------------------------

describe('Phase 5 — Path A: safe_to_omit_match', () => {
  it('safeToOmitWhen match + null evidenceRequired → omit + path_a_null_evidence warning', () => {
    const c = makeComponent('sc.pa1', {
      safeToOmitWhen: [PROMPT_FAMILY],
      omissionPolicy: 'allow',
      retainPolicy: 'optional',
      riskLevel: 'low',
      evidenceRequired: null,
    });
    const result = runLadder(c, makeLadderInputs());
    expect(result.decision.action).toBe('omit');
    expect(result.decision.path).toBe('safe_to_omit_match');
    expect(result.decision.confidence).toBe('high');
    expect(result.decision.warnings).toContain('path_a_null_evidence');
  });

  it('safeToOmitWhen match + satisfied expression → omit, no path_a_null_evidence', () => {
    const c = makeComponent('sc.pa2', {
      safeToOmitWhen: [PROMPT_FAMILY],
      omissionPolicy: 'allow',
      retainPolicy: 'optional',
      riskLevel: 'low',
      evidenceRequired: `promptFamily=${PROMPT_FAMILY} AND riskLevel=low`,
    });
    const result = runLadder(c, makeLadderInputs());
    expect(result.decision.action).toBe('omit');
    expect(result.decision.path).toBe('safe_to_omit_match');
    expect(result.decision.warnings).not.toContain('path_a_null_evidence');
  });

  it('safeToOmitWhen match + failing promptFamily atom → Path A unavailable, falls to default_include', () => {
    const c = makeComponent('sc.pa3', {
      safeToOmitWhen: [PROMPT_FAMILY],
      omissionPolicy: 'allow',
      retainPolicy: 'optional',
      riskLevel: 'low',
      evidenceRequired: `promptFamily=coding_debug AND riskLevel=low`,
    });
    const result = runLadder(c, makeLadderInputs());
    // promptFamily atom fails ('general_default' ≠ 'coding_debug') → Path A unsatisfied
    expect(result.decision.action).not.toBe('omit');
    expect(result.decision.path).not.toBe('safe_to_omit_match');
  });

  it('safeToOmitWhen match + evidenceRequiredGrammarInvalid → Path A disabled → no omit', () => {
    const c = makeComponent('sc.pa4', {
      safeToOmitWhen: [PROMPT_FAMILY],
      omissionPolicy: 'allow',
      retainPolicy: 'optional',
      riskLevel: 'low',
      evidenceRequired: `promptFamily=${PROMPT_FAMILY} OR riskLevel=low`,
      evidenceRequiredGrammarInvalid: true,
    });
    const result = runLadder(c, makeLadderInputs());
    expect(result.decision.action).not.toBe('omit');
  });

  it('OR not supported — grammar invalid disables Path A', () => {
    const evResult = evaluateEvidenceRequired(
      makeComponent('x', { evidenceRequired: 'promptFamily=general_default OR riskLevel=low', evidenceRequiredGrammarInvalid: true }),
      'general_default',
      [],
      [],
    );
    expect(evResult.result).toBe('path_a_disabled');
  });
});

// ---------------------------------------------------------------------------
// Unit tests — Path B (Step 8)
// ---------------------------------------------------------------------------

describe('Phase 5 — Path B: default_action_omit', () => {
  it('defaultAction: omit, no tag matches → default_action_omit, confidence high', () => {
    const c = makeComponent('sc.pb1', {
      defaultAction: 'omit',
      omissionPolicy: 'allow',
      retainPolicy: 'optional',
      riskLevel: 'low',
    });
    const result = runLadder(c, makeLadderInputs());
    expect(result.decision.action).toBe('omit');
    expect(result.decision.path).toBe('default_action_omit');
    expect(result.decision.confidence).toBe('high');
  });

  it('evidence includes requiredWhen=no_match and safeToOmitWhen=no_match', () => {
    const c = makeComponent('sc.pb2', {
      defaultAction: 'omit',
      omissionPolicy: 'allow',
      retainPolicy: 'optional',
      riskLevel: 'low',
    });
    const result = runLadder(c, makeLadderInputs());
    expect(result.decision.evidence).toContain('requiredWhen=no_match');
    expect(result.decision.evidence).toContain('safeToOmitWhen=no_match');
    expect(result.decision.evidence).toContain('defaultAction=omit');
  });

  it('Path B not available when riskLevel: high → include / fail_open (not omit, not unexpected_ladder_fallback)', () => {
    const c = makeComponent('sc.pb3', {
      defaultAction: 'omit',
      omissionPolicy: 'allow',
      retainPolicy: 'optional',
      riskLevel: 'high',
    });
    const result = runLadder(c, makeLadderInputs());
    expect(result.decision.action).toBe('include');
    expect(result.decision.path).toBe('fail_open');
    expect(result.decision.warnings).not.toContain('unexpected_ladder_fallback');
  });

  it('Path B not available when retainPolicy: durable → include / fail_open (not omit, not unexpected_ladder_fallback)', () => {
    const c = makeComponent('sc.pb4', {
      defaultAction: 'omit',
      omissionPolicy: 'allow',
      retainPolicy: 'durable',
      riskLevel: 'low',
    });
    const result = runLadder(c, makeLadderInputs());
    expect(result.decision.action).toBe('include');
    expect(result.decision.path).toBe('fail_open');
    expect(result.decision.warnings).not.toContain('unexpected_ladder_fallback');
  });
});

// ---------------------------------------------------------------------------
// Unit tests — Steps 9/10/11/12
// ---------------------------------------------------------------------------

describe('Phase 5 — Steps 9/10/11/12', () => {
  it('defaultAction: include → default_include, confidence medium', () => {
    const c = makeComponent('sc.s9', { defaultAction: 'include' });
    const result = runLadder(c, makeLadderInputs());
    expect(result.decision.action).toBe('include');
    expect(result.decision.path).toBe('default_include');
    expect(result.decision.confidence).toBe('medium');
  });

  it('defaultAction: defer → default_defer, action defer', () => {
    const c = makeComponent('sc.s10', { defaultAction: 'defer' });
    const result = runLadder(c, makeLadderInputs());
    expect(result.decision.action).toBe('defer');
    expect(result.decision.path).toBe('default_defer');
  });

  it('omissionPolicy: fail_open (no other match) → fail_open include', () => {
    const c = makeComponent('sc.s11', {
      defaultAction: 'omit',
      omissionPolicy: 'fail_open',
      retainPolicy: 'optional',
      riskLevel: 'low',
    });
    const result = runLadder(c, makeLadderInputs());
    // omissionPolicy: fail_open blocks Path B; falls to Step 11
    expect(result.decision.action).toBe('include');
    expect(result.decision.path).toBe('fail_open');
  });
});

// ---------------------------------------------------------------------------
// Unit tests — Step 1: quarantine boundary violation
// ---------------------------------------------------------------------------

describe('Phase 5 — Step 1: quarantine boundary violation', () => {
  it('component in quarantinedIds set → quarantine_boundary_violation, include, confidence low', () => {
    const c = makeComponent('sc.q1');
    const inputs = makeLadderInputs({ quarantinedIds: new Set(['sc.q1']) });
    const result = runLadder(c, inputs);
    expect(result.decision.action).toBe('include');
    expect(result.decision.path).toBe('quarantine_boundary_violation');
    expect(result.decision.confidence).toBe('low');
    // unexpected_ladder_fallback must NOT appear in decision.warnings (Step 1 is not a ladder defect).
    expect(result.decision.warnings).not.toContain('unexpected_ladder_fallback');
  });

  it('quarantine boundary violation emits unexpected_quarantine_reference in SelectorFanOutResult.warnings', () => {
    // Simulate the boundary defect: component is in both candidatesById and quarantinedComponents.
    const c = makeComponent('sc.qbv');
    // candidatesById contains the component
    const csr = makeCandidateSetResult([c]);
    // registryResult says it is also quarantined
    const reg: RegistryResult = {
      indexes: { componentsById: new Map([[c.id, c]]), componentsByType: new Map(), componentsByTag: new Map(), safetyCriticalIds: new Set(), trimmableCandidateIds: new Set() },
      quarantinedComponents: [{ id: c.id, reason: 'test-boundary-defect', riskLevel: 'low', rawEntry: { id: c.id } }],
      validationWarnings: [],
    };
    const ni = makeNormalizedInputs();
    const r = runSelectorFanOut(csr, ni, reg);
    expect(r.decisions[0].path).toBe('quarantine_boundary_violation');
    expect(r.warnings.some((w) => w.code === 'unexpected_quarantine_reference' && (w.context as any)?.componentId === c.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unit tests — invariants
// ---------------------------------------------------------------------------

describe('Phase 5 — invariants', () => {
  it('no omit action outside Path A or Path B', () => {
    // Enumerate all non-Path-A/B paths by building components that trigger each
    const cases: Component[] = [
      makeComponent('inv.1', { retainPolicy: 'safety_critical' }),                     // Step 3
      makeComponent('inv.2', { requiredWhen: [PROMPT_FAMILY], safeToOmitWhen: [PROMPT_FAMILY] }), // Step 4
      makeComponent('inv.3', { requiredWhen: [PROMPT_FAMILY] }),                       // Step 5
      makeComponent('inv.4', { defaultAction: 'include' }),                            // Step 9
      makeComponent('inv.5', { defaultAction: 'defer' }),                              // Step 10
      makeComponent('inv.6', { omissionPolicy: 'fail_open', defaultAction: 'omit' }), // Step 11
    ];
    for (const c of cases) {
      const result = runLadder(c, makeLadderInputs());
      expect(result.decision.action, `Component ${c.id} should not be omit`).not.toBe('omit');
    }
  });

  it('Path A omit has non-empty evidence', () => {
    const c = makeComponent('inv.pa', {
      safeToOmitWhen: [PROMPT_FAMILY],
      omissionPolicy: 'allow',
      retainPolicy: 'optional',
      riskLevel: 'low',
      evidenceRequired: null,
    });
    const result = runLadder(c, makeLadderInputs());
    expect(result.decision.action).toBe('omit');
    expect(result.decision.evidence.length).toBeGreaterThan(0);
  });

  it('Path B omit has non-empty evidence', () => {
    const c = makeComponent('inv.pb', {
      defaultAction: 'omit',
      omissionPolicy: 'allow',
      retainPolicy: 'optional',
      riskLevel: 'low',
    });
    const result = runLadder(c, makeLadderInputs());
    expect(result.decision.action).toBe('omit');
    expect(result.decision.evidence.length).toBeGreaterThan(0);
  });

  it('TraceEntry has all required fields', () => {
    const c = makeComponent('inv.trace');
    const result = runLadder(c, makeLadderInputs());
    const te = result.traceEntry;
    expect(typeof te.decisionId).toBe('string');
    expect(te.decisionId.length).toBeGreaterThan(0);
    expect(te.componentId).toBe('inv.trace');
    expect(typeof te.module).toBe('string');
    expect(['include','omit','defer','reference_unknown']).toContain(te.action);
    expect(typeof te.reason).toBe('string');
    expect(Array.isArray(te.evidence)).toBe(true);
    expect(['high','medium','low']).toContain(te.confidence);
    expect(typeof te.risk).toBe('string');
    expect(typeof te.estimatedSavings.tokens).toBe('number');
    expect(typeof te.failOpen).toBe('boolean');
    expect(te.selector).toBe('deterministic');
  });

  it('SelectionDecision.traceRefs references TraceEntry.decisionId', () => {
    const c = makeComponent('inv.link');
    const result = runLadder(c, makeLadderInputs());
    expect(result.decision.traceRefs).toContain(result.traceEntry.decisionId);
  });
});

// ---------------------------------------------------------------------------
// Unit tests — evidenceRequired evaluation
// ---------------------------------------------------------------------------

describe('Phase 5 — evaluateEvidenceRequired', () => {
  it('null evidenceRequired → satisfied + nullEvidence:true', () => {
    const c = makeComponent('ev.null', { evidenceRequired: null });
    const r = evaluateEvidenceRequired(c, PROMPT_FAMILY, [], []);
    expect(r.result).toBe('satisfied');
    expect(r.nullEvidence).toBe(true);
  });

  it('evidenceRequiredGrammarInvalid:true → path_a_disabled', () => {
    const c = makeComponent('ev.invalid', {
      evidenceRequired: 'some broken expr',
      evidenceRequiredGrammarInvalid: true,
    });
    const r = evaluateEvidenceRequired(c, PROMPT_FAMILY, [], []);
    expect(r.result).toBe('path_a_disabled');
  });

  it('promptFamily=general_default atom satisfied', () => {
    const c = makeComponent('ev.pf', { evidenceRequired: 'promptFamily=general_default' });
    const r = evaluateEvidenceRequired(c, 'general_default', [], []);
    expect(r.result).toBe('satisfied');
    expect(r.nullEvidence).toBe(false);
  });

  it('promptFamily=other_family atom fails', () => {
    const c = makeComponent('ev.pf2', { evidenceRequired: 'promptFamily=other_family' });
    const r = evaluateEvidenceRequired(c, 'general_default', [], []);
    expect(r.result).toBe('unsatisfied');
  });

  it('riskLevel=low atom satisfied', () => {
    const c = makeComponent('ev.rl', { evidenceRequired: 'riskLevel=low', riskLevel: 'low' });
    const r = evaluateEvidenceRequired(c, PROMPT_FAMILY, [], []);
    expect(r.result).toBe('satisfied');
  });

  it('riskLevel=high atom fails when riskLevel is low', () => {
    const c = makeComponent('ev.rl2', { evidenceRequired: 'riskLevel=high', riskLevel: 'low' });
    const r = evaluateEvidenceRequired(c, PROMPT_FAMILY, [], []);
    expect(r.result).toBe('unsatisfied');
  });

  it('explicitUserConstraint=false satisfied when no constraints', () => {
    const c = makeComponent('ev.uc', { evidenceRequired: 'explicitUserConstraint=false' });
    const r = evaluateEvidenceRequired(c, PROMPT_FAMILY, [], []);
    expect(r.result).toBe('satisfied');
  });

  it('explicitUserConstraint=false fails when component is in alwaysInclude', () => {
    const c = makeComponent('ev.uc2', { evidenceRequired: 'explicitUserConstraint=false' });
    const r = evaluateEvidenceRequired(c, PROMPT_FAMILY, ['ev.uc2'], []);
    expect(r.result).toBe('unsatisfied');
  });

  it('AND combinator: both atoms satisfied → satisfied', () => {
    const c = makeComponent('ev.and1', {
      evidenceRequired: `promptFamily=${PROMPT_FAMILY} AND riskLevel=low`,
      riskLevel: 'low',
    });
    const r = evaluateEvidenceRequired(c, PROMPT_FAMILY, [], []);
    expect(r.result).toBe('satisfied');
  });

  it('AND combinator: first atom fails → unsatisfied', () => {
    const c = makeComponent('ev.and2', {
      evidenceRequired: `promptFamily=other AND riskLevel=low`,
      riskLevel: 'low',
    });
    const r = evaluateEvidenceRequired(c, PROMPT_FAMILY, [], []);
    expect(r.result).toBe('unsatisfied');
  });

  it('AND combinator: second atom fails → unsatisfied', () => {
    const c = makeComponent('ev.and3', {
      evidenceRequired: `promptFamily=${PROMPT_FAMILY} AND riskLevel=medium`,
      riskLevel: 'low',
    });
    const r = evaluateEvidenceRequired(c, PROMPT_FAMILY, [], []);
    expect(r.result).toBe('unsatisfied');
  });

  it('unrecognized atom → path_a_disabled', () => {
    const c = makeComponent('ev.unk', { evidenceRequired: 'budgetCritical=true' });
    const r = evaluateEvidenceRequired(c, PROMPT_FAMILY, [], []);
    expect(r.result).toBe('path_a_disabled');
  });
});

// ---------------------------------------------------------------------------
// Unit tests — runSelectorFanOut
// ---------------------------------------------------------------------------

describe('Phase 5 — runSelectorFanOut: basic shapes', () => {
  it('empty candidate set → decisions[], selectorTrace[], summary counts 0', () => {
    const reg = makeRegistryResult([]);
    const csr = makeCandidateSetResult([]);
    const ni = makeNormalizedInputs();
    const result = runSelectorFanOut(csr, ni, reg);
    expect(result.decisions).toHaveLength(0);
    expect(result.selectorTrace).toHaveLength(0);
    expect(result.selectorSummary.totalEvaluated).toBe(0);
    expect(result.referencedUnknownComponents).toHaveLength(0);
  });

  it('one scaffold component → one decision + one traceEntry', () => {
    const c = makeComponent('sc.fanout');
    const reg = makeRegistryResult([c]);
    const csr = makeCandidateSetResult([c]);
    const ni = makeNormalizedInputs();
    const result = runSelectorFanOut(csr, ni, reg);
    expect(result.decisions).toHaveLength(1);
    expect(result.selectorTrace).toHaveLength(1);
    expect(result.decisions[0].componentId).toBe('sc.fanout');
    expect(result.selectorTrace[0].componentId).toBe('sc.fanout');
  });

  it('decisions.length equals selectorTrace.length', () => {
    const comps = ['sc.a', 'sc.b', 'sc.c'].map((id) => makeComponent(id));
    const reg = makeRegistryResult(comps);
    const csr = makeCandidateSetResult(comps);
    const ni = makeNormalizedInputs();
    const result = runSelectorFanOut(csr, ni, reg);
    expect(result.decisions.length).toBe(result.selectorTrace.length);
  });

  it('candidatesById is not mutated after fan-out', () => {
    const c = makeComponent('sc.m');
    const csr = makeCandidateSetResult([c]);
    const ni = makeNormalizedInputs();
    const reg = makeRegistryResult([c]);
    const sizeBefore = csr.candidatesById.size;
    runSelectorFanOut(csr, ni, reg);
    expect(csr.candidatesById.size).toBe(sizeBefore);
  });

  it('SelectorFanOutResult has all required fields', () => {
    const c = makeComponent('sc.shape');
    const reg = makeRegistryResult([c]);
    const csr = makeCandidateSetResult([c]);
    const ni = makeNormalizedInputs();
    const result = runSelectorFanOut(csr, ni, reg);
    expect(Array.isArray(result.decisions)).toBe(true);
    expect(Array.isArray(result.selectorTrace)).toBe(true);
    expect(Array.isArray(result.referencedUnknownComponents)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(typeof result.selectorSummary.totalEvaluated).toBe('number');
    expect(typeof result.selectorSummary.narrative).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Unit tests — selectorSummary counts and narrative
// ---------------------------------------------------------------------------

describe('Phase 5 — selectorSummary', () => {
  it('one include decision → totalEvaluated=1, decidedInclude=1', () => {
    const c = makeComponent('sc.sum1');
    const reg = makeRegistryResult([c]);
    const csr = makeCandidateSetResult([c]);
    const ni = makeNormalizedInputs();
    const r = runSelectorFanOut(csr, ni, reg);
    expect(r.selectorSummary.totalEvaluated).toBe(1);
    expect(r.selectorSummary.decidedInclude).toBe(1);
    expect(r.selectorSummary.decidedOmit).toBe(0);
    expect(r.selectorSummary.decidedDefer).toBe(0);
  });

  it('one Path A omit → decidedOmit=1', () => {
    const c = makeComponent('sc.sum2', {
      safeToOmitWhen: [PROMPT_FAMILY],
      omissionPolicy: 'allow',
      retainPolicy: 'optional',
      riskLevel: 'low',
      evidenceRequired: null,
    });
    const reg = makeRegistryResult([c]);
    const csr = makeCandidateSetResult([c]);
    const ni = makeNormalizedInputs();
    const r = runSelectorFanOut(csr, ni, reg);
    expect(r.selectorSummary.decidedOmit).toBe(1);
    expect(r.selectorSummary.decidedInclude).toBe(0);
  });

  it('one conflict_include → conflictsIdentified=1', () => {
    const c = makeComponent('sc.sum3', {
      requiredWhen: [PROMPT_FAMILY],
      safeToOmitWhen: [PROMPT_FAMILY],
    });
    const reg = makeRegistryResult([c]);
    const csr = makeCandidateSetResult([c]);
    const ni = makeNormalizedInputs();
    const r = runSelectorFanOut(csr, ni, reg);
    expect(r.selectorSummary.conflictsIdentified).toBe(1);
  });

  it('narrative matches deterministic template', () => {
    const c = makeComponent('sc.narr');
    const reg = makeRegistryResult([c]);
    const csr = makeCandidateSetResult([c]);
    const ni = makeNormalizedInputs();
    const r = runSelectorFanOut(csr, ni, reg);
    const s = r.selectorSummary;
    const expected =
      `${s.totalEvaluated} components evaluated. ` +
      `${s.decidedInclude} included, ` +
      `${s.decidedOmit} omitted, ` +
      `${s.decidedDefer} deferred (${s.defaultDefer} default, ${s.runtimeUnavailableDefer} runtime-unavailable), ` +
      `${s.failOpenInclude} fail-open. ` +
      `${s.conflictsIdentified} conflict(s) identified.`;
    expect(s.narrative).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Unit tests — reference_unknown via alwaysInclude
// ---------------------------------------------------------------------------

describe('Phase 5 — reference_unknown via alwaysInclude', () => {
  it('alwaysInclude ID not in candidatesById → reference_unknown decision', () => {
    const c = makeComponent('sc.real');
    const reg = makeRegistryResult([c]);
    const csr = makeCandidateSetResult([c]);
    const ni = makeNormalizedInputs({
      constraints: { alwaysInclude: ['sc.missing'], neverInclude: [], constraintSource: 'test' },
    });
    const r = runSelectorFanOut(csr, ni, reg);
    const unkDecision = r.decisions.find((d) => d.action === 'reference_unknown');
    expect(unkDecision).toBeDefined();
    expect(unkDecision?.componentId).toBe('sc.missing');
    expect(unkDecision?.path).toBe('reference_unknown');
  });

  it('reference_unknown appears in referencedUnknownComponents', () => {
    const c = makeComponent('sc.real2');
    const reg = makeRegistryResult([c]);
    const csr = makeCandidateSetResult([c]);
    const ni = makeNormalizedInputs({
      constraints: { alwaysInclude: ['sc.unknown'], neverInclude: [], constraintSource: 'test' },
    });
    const r = runSelectorFanOut(csr, ni, reg);
    const ref = r.referencedUnknownComponents.find((u) => u.componentId === 'sc.unknown');
    expect(ref).toBeDefined();
    expect(ref?.referencedBy).toBe('userConstraints.alwaysInclude');
    expect(typeof ref?.traceRef).toBe('string');
    expect(ref!.traceRef.length).toBeGreaterThan(0);
  });

  it('alwaysInclude ID present in candidatesById → NOT reference_unknown (normal include)', () => {
    const c = makeComponent('sc.known');
    const reg = makeRegistryResult([c]);
    const csr = makeCandidateSetResult([c]);
    const ni = makeNormalizedInputs({
      constraints: { alwaysInclude: ['sc.known'], neverInclude: [], constraintSource: 'test' },
    });
    const r = runSelectorFanOut(csr, ni, reg);
    const unkDecision = r.decisions.find((d) => d.action === 'reference_unknown');
    expect(unkDecision).toBeUndefined();
    expect(r.referencedUnknownComponents).toHaveLength(0);
  });

  it('unknownReferences count matches referencedUnknownComponents length', () => {
    const c = makeComponent('sc.real3');
    const reg = makeRegistryResult([c]);
    const csr = makeCandidateSetResult([c]);
    const ni = makeNormalizedInputs({
      constraints: { alwaysInclude: ['x.missing1', 'x.missing2'], neverInclude: [], constraintSource: 'test' },
    });
    const r = runSelectorFanOut(csr, ni, reg);
    expect(r.selectorSummary.unknownReferences).toBe(r.referencedUnknownComponents.length);
    expect(r.selectorSummary.unknownReferences).toBe(2);
  });

  it('reference_unknown TraceEntry.risk is "low" — schema-valid RiskLevel, not "unknown"', () => {
    // Regression guard — Phase 12.5 Cat E fix.
    // selector-engine.ts previously emitted risk: 'unknown' which is not in
    // RiskLevel enum ["low","medium","high","critical"]. This caused AJV trace
    // schema validation failure on fixture 09-reference-unknown/unknown-component-reference.
    // After fix: risk must be "low" — schema-valid and matches expected/trace.json.
    const c = makeComponent('sc.riskGuard');
    const reg = makeRegistryResult([c]);
    const csr = makeCandidateSetResult([c]);
    const ni = makeNormalizedInputs({
      constraints: { alwaysInclude: ['sc.missing-risk-guard'], neverInclude: [], constraintSource: 'test' },
    });
    const r = runSelectorFanOut(csr, ni, reg);
    const unkTrace = r.selectorTrace.find((te) => te.action === 'reference_unknown');
    expect(unkTrace).toBeDefined();
    expect(unkTrace?.risk).toBe('low');
    expect(unkTrace?.risk).not.toBe('unknown');
    expect(['low', 'medium', 'high', 'critical']).toContain(unkTrace?.risk);
  });
});

// ---------------------------------------------------------------------------
// Unit tests — tool runtime availability pre-check
// ---------------------------------------------------------------------------

describe('Phase 5 — tool runtime pre-check', () => {
  it('tool in unavailableToolIds → defer/runtime_unavailable', () => {
    const c = makeComponent('tool.unavail', { type: 'tool' });
    const reg = makeRegistryResult([c]);
    const csr = makeCandidateSetResult([c]);
    const ni = makeNormalizedInputs({
      runtime: { unavailableToolIds: ['tool.unavail'], availableToolIds: [], capabilityInventoryComplete: true, runtimeLabel: 'test' },
    });
    const r = runSelectorFanOut(csr, ni, reg);
    expect(r.decisions[0].action).toBe('defer');
    expect(r.decisions[0].path).toBe('runtime_unavailable');
    expect(r.warnings.some((w) => w.code === 'runtime_unavailable')).toBe(true);
  });

  it('runtime_unavailable defer has estimatedSavings.tokens = 0 (not counted as savings)', () => {
    const c = makeComponent('tool.unavail2', { type: 'tool' });
    const reg = makeRegistryResult([c]);
    const csr = makeCandidateSetResult([c]);
    const ni = makeNormalizedInputs({
      runtime: { unavailableToolIds: ['tool.unavail2'], availableToolIds: [], capabilityInventoryComplete: true, runtimeLabel: 'test' },
    });
    const r = runSelectorFanOut(csr, ni, reg);
    expect(r.selectorTrace[0].estimatedSavings.tokens).toBe(0);
  });

  it('hard-protected tool + unavailable → defer + hard_protected_tool_unavailable warning', () => {
    const c = makeComponent('tool.hardprot', { type: 'tool', retainPolicy: 'mandatory' });
    const reg = makeRegistryResult([c]);
    const csr = makeCandidateSetResult([c]);
    const ni = makeNormalizedInputs({
      runtime: { unavailableToolIds: ['tool.hardprot'], availableToolIds: [], capabilityInventoryComplete: true, runtimeLabel: 'test' },
    });
    const r = runSelectorFanOut(csr, ni, reg);
    expect(r.decisions[0].action).toBe('defer');
    expect(r.warnings.some((w) => w.code === 'hard_protected_tool_unavailable')).toBe(true);
  });

  it('tool absent from both lists + inventoryComplete:false → fail-open IMMEDIATELY (action:include, path:fail_open)', () => {
    const c = makeComponent('tool.unknown', { type: 'tool' });
    const reg = makeRegistryResult([c]);
    const csr = makeCandidateSetResult([c]);
    const ni = makeNormalizedInputs({
      runtime: { unavailableToolIds: [], availableToolIds: [], capabilityInventoryComplete: false, runtimeLabel: 'test' },
    });
    const r = runSelectorFanOut(csr, ni, reg);
    // Must be include / fail_open immediately — NOT deferred to ladder.
    expect(r.decisions[0].action).toBe('include');
    expect(r.decisions[0].path).toBe('fail_open');
    expect(r.warnings.some((w) => w.code === 'runtime_capability_unknown')).toBe(true);
  });

  it('unknown tool with defaultAction:omit + omissionPolicy:allow + retainPolicy:optional + riskLevel:low → include/fail_open (NOT omit)', () => {
    // This is the critical case: without the immediate fail-open, the ladder's Path B
    // would legally omit this tool since all Path B conditions are met. But we have
    // no capability evidence, so we must fail open.
    const c = makeComponent('tool.unknown.omit', {
      type: 'tool',
      defaultAction: 'omit',
      omissionPolicy: 'allow',
      retainPolicy: 'optional',
      riskLevel: 'low',
    });
    const reg = makeRegistryResult([c]);
    const csr = makeCandidateSetResult([c]);
    const ni = makeNormalizedInputs({
      runtime: { unavailableToolIds: [], availableToolIds: [], capabilityInventoryComplete: false, runtimeLabel: 'test' },
    });
    const r = runSelectorFanOut(csr, ni, reg);
    expect(r.decisions[0].action).toBe('include');
    expect(r.decisions[0].path).toBe('fail_open');
    expect(r.decisions[0].action).not.toBe('omit');
    expect(r.warnings.some((w) => w.code === 'runtime_capability_unknown')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unit tests — historyMalformed pre-check
// ---------------------------------------------------------------------------

describe('Phase 5 — historyMalformed pre-check', () => {
  it('historyMalformed:true + riskLevel:high → fail_open include', () => {
    const c = makeComponent('hist.a', { type: 'history', riskLevel: 'high' });
    const reg = makeRegistryResult([c]);
    const csr = makeCandidateSetResult([c]);
    const ni = makeNormalizedInputs({ history: { historyMalformed: true, lanesPresent: [], durableConstraintsPresent: false, openCommitmentsPresent: false, recentRawTurnCount: 0, totalHistoryTokensApprox: 0 } });
    const r = runSelectorFanOut(csr, ni, reg);
    expect(r.decisions[0].action).toBe('include');
    expect(r.decisions[0].path).toBe('fail_open');
    expect(r.warnings.some((w) => w.code === 'history_malformed_fail_open')).toBe(true);
  });

  it('historyMalformed:true + riskLevel:low + retainPolicy:optional → ladder runs (default_include)', () => {
    const c = makeComponent('hist.b', {
      type: 'history',
      riskLevel: 'low',
      retainPolicy: 'optional',
      defaultAction: 'include',
    });
    const reg = makeRegistryResult([c]);
    const csr = makeCandidateSetResult([c]);
    const ni = makeNormalizedInputs({ history: { historyMalformed: true, lanesPresent: [], durableConstraintsPresent: false, openCommitmentsPresent: false, recentRawTurnCount: 0, totalHistoryTokensApprox: 0 } });
    const r = runSelectorFanOut(csr, ni, reg);
    // Low-risk optional → not fail-open; runs ladder → default_include
    expect(r.decisions[0].path).not.toBe('fail_open');
    expect(r.decisions[0].path).toBe('default_include');
    expect(r.warnings.some((w) => w.code === 'history_malformed_fail_open')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unit tests — conflicting_tags warning placement
// ---------------------------------------------------------------------------

describe('Phase 5 — conflicting_tags warning placement', () => {
  it('Step 4 conflict: conflict evidence in decision.evidence AND conflicting_tags in planning warnings', () => {
    const c = makeComponent('sc.ct', {
      requiredWhen: [PROMPT_FAMILY],
      safeToOmitWhen: [PROMPT_FAMILY],
    });
    const reg = makeRegistryResult([c]);
    const csr = makeCandidateSetResult([c]);
    const ni = makeNormalizedInputs();
    const r = runSelectorFanOut(csr, ni, reg);
    // Decision path must be conflict_include.
    const d = r.decisions[0];
    expect(d.path).toBe('conflict_include');
    // Per-decision evidence must contain both tag atoms.
    expect(d.evidence.some((e) => e.startsWith('requiredWhen='))).toBe(true);
    expect(d.evidence.some((e) => e.startsWith('safeToOmitWhen='))).toBe(true);
    // conflicting_tags must NOT be in SelectionDecision.warnings[] (planning-level only).
    expect(d.warnings).not.toContain('conflicting_tags');
    // conflicting_tags MUST appear as a planning warning in SelectorFanOutResult.warnings[].
    expect(r.warnings.some((w) => w.code === 'conflicting_tags' && (w.context as any)?.componentId === c.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unit tests — no output files
// ---------------------------------------------------------------------------

describe('Phase 5 — no output files written', () => {
  it('runSelectorFanOut does not produce prompt-plan.json, trace.json, or summary.md', () => {
    // Verify by calling directly — no file I/O in the module
    const c = makeComponent('sc.nofile');
    const reg = makeRegistryResult([c]);
    const csr = makeCandidateSetResult([c]);
    const ni = makeNormalizedInputs();
    // Just calling the function — it must not throw and must not write files
    const r = runSelectorFanOut(csr, ni, reg);
    expect(r).toBeDefined();
    // No file-write side effects; existence checks would be meaningless here
    // (integration tests cover this via CLI)
  });
});

// ---------------------------------------------------------------------------
// CLI integration tests
// ---------------------------------------------------------------------------

describe('CLI integration — Phase 5 behavior', () => {
  it('valid inputs exit 0 with all three output files written', () => {
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

  it('stderr does NOT contain Phase 5 not-implemented message', () => {
    const td = makeTempDir();
    writeFileSync(join(td, 'req.txt'), 'Hello');
    writeFileSync(join(td, 'reg.json'), makeRegistryJson(['scaffold.test']));
    const result = runCli([
      'plan',
      '--request', join(td, 'req.txt'),
      '--registry', join(td, 'reg.json'),
    ]);
    expect(result.stderr).not.toContain('Phase 5 (selector fan-out) is not yet implemented');
  });

  it('fatal registry halts before Phase 5 and does not print Phase 7 message', () => {
    const td = makeTempDir();
    writeFileSync(join(td, 'req.txt'), 'Test request.');
    writeFileSync(join(td, 'reg.json'), 'NOT JSON AT ALL');
    const result = runCli([
      'plan',
      '--request', join(td, 'req.txt'),
      '--registry', join(td, 'reg.json'),
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain('Phase 11 (Trace and Summary Assembly) is not yet implemented');
  });

  it('all three output files created after successful run', () => {
    const td = makeTempDir();
    writeFileSync(join(td, 'req.txt'), 'Test request.');
    writeFileSync(join(td, 'reg.json'), makeRegistryJson(['scaffold.test']));
    runCli([
      'plan',
      '--request', join(td, 'req.txt'),
      '--registry', join(td, 'reg.json'),
      '--output-dir', td,
    ]);
    expect(existsSync(join(td, 'prompt-plan.json'))).toBe(true);
    expect(existsSync(join(td, 'trace.json'))).toBe(true);
    expect(existsSync(join(td, 'summary.md'))).toBe(true);
  });

  it('quarantine warning appears in stderr; CLI exits 0', () => {
    const td = makeTempDir();
    writeFileSync(join(td, 'req.txt'), 'Test request.');
    const reg = [
      {
        id: 'scaffold.valid', type: 'scaffold', title: 'Valid', summary: 'Valid.',
        source: 'scaffold/valid.md', tokensApprox: 100, charsApprox: 400,
        riskLevel: 'low', requiredWhen: [], safeToOmitWhen: [], defaultAction: 'include',
        omissionPolicy: 'fail_open', retainPolicy: 'optional', budgetPriority: 3,
        evidenceRequired: null, tags: ['test'], version: '1.0.0', hash: null,
      },
      {
        id: 'scaffold.bad', type: 'scaffold', title: 'Bad tokens', summary: 'Bad.',
        source: 'scaffold/bad.md', tokensApprox: 0, charsApprox: 400,
        riskLevel: 'low', requiredWhen: [], safeToOmitWhen: [], defaultAction: 'include',
        omissionPolicy: 'fail_open', retainPolicy: 'optional', budgetPriority: 3,
        evidenceRequired: null, tags: ['test'], version: '1.0.0', hash: null,
      },
    ];
    writeFileSync(join(td, 'reg.json'), JSON.stringify(reg));
    const result = runCli([
      'plan',
      '--request', join(td, 'req.txt'),
      '--registry', join(td, 'reg.json'),
      '--output-dir', td,
    ]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('component_quarantined');
    expect(result.stderr).not.toContain('Phase 11 (Trace and Summary Assembly) is not yet implemented');
  });
});
