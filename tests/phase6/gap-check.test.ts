/**
 * Phase 6 — gap-check unit and integration tests.
 *
 * All test data is inline (no fixture directory reads).
 * Temp files are created in os.tmpdir() and cleaned up in afterEach.
 * No output files are created.
 * No Phase 7+ imports or behavior.
 * Integration tests: spawn the CLI via tsx (same pattern as Phase 2/3/4/5 tests).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runGapCheck } from '../../src/core/gap-check.js';
import { runSelectorFanOut, computeSelectorSummary } from '../../src/core/selector-engine.js';
import type { SelectorFanOutResult, SelectionDecision } from '../../src/types/selection.js';
import type { Component, RegistryResult } from '../../src/types/registry.js';
import type { NormalizedInputs } from '../../src/types/normalized.js';
import type { CandidateSetResult } from '../../src/types/candidate.js';

// ---------------------------------------------------------------------------
// Helpers
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
  const dir = mkdtempSync(join(tmpdir(), 'ctx-phase6-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ---------------------------------------------------------------------------
// Minimal factories (self-contained — no shared test utilities)
// ---------------------------------------------------------------------------

function makeComponent(id: string, overrides: Partial<Component> = {}): Component {
  return {
    id,
    type: 'scaffold',
    title: `Test ${id}`,
    summary: `Minimal component ${id} for Phase 6 tests.`,
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

function makeCandidateSetResult(components: Component[]): CandidateSetResult {
  const candidatesById = new Map<string, Component>();
  for (const c of components) candidatesById.set(c.id, c);
  return {
    summary: {
      candidateSetPolicy: 'all_non_quarantined',
      candidateSetSize: candidatesById.size,
      quarantinedExcluded: 0,
    },
    candidatesById,
    warnings: [],
  };
}

function makeRegistryResult(components: Component[]): RegistryResult {
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
    components.filter((c) => c.retainPolicy === 'optional' && c.omissionPolicy === 'allow').map((c) => c.id),
  );
  return {
    indexes: { componentsById, componentsByType, componentsByTag, safetyCriticalIds, trimmableCandidateIds },
    quarantinedComponents: [],
    validationWarnings: [],
  };
}

function makeNormalizedInputs(): NormalizedInputs {
  return {
    requestSignals: { promptFamily: 'general_default', familyConfidence: 0.0, injectionSuspect: false },
    runtime: { availableToolIds: [], unavailableToolIds: [], capabilityInventoryComplete: true, runtimeLabel: 'test' },
    history: { lanesPresent: [], durableConstraintsPresent: false, openCommitmentsPresent: false, recentRawTurnCount: 0, totalHistoryTokensApprox: 0, historyMalformed: false },
    budget: null,
    constraints: null,
    policy: { failOpenThreshold: 0.5, deterministicOnly: true, injectionSuspectAction: 'warn_and_continue' },
    activeIds: { activeSkillIds: [], activeToolIds: [], activeMemoryIds: [] },
    warnings: [],
  };
}

/**
 * Build a minimal fan-out result with no decisions (simulates a complete gap scenario).
 * Use this to test runGapCheck directly without going through the full selector engine.
 */
function makeEmptyFanOutResult(): SelectorFanOutResult {
  return {
    decisions: [],
    selectorTrace: [],
    selectorSummary: {
      totalEvaluated: 0,
      decidedInclude: 0,
      decidedOmit: 0,
      decidedDefer: 0,
      defaultDefer: 0,
      runtimeUnavailableDefer: 0,
      failOpenInclude: 0,
      conflictsIdentified: 0,
      unknownReferences: 0,
      narrative: '0 components evaluated. 0 included, 0 omitted, 0 deferred (0 default, 0 runtime-unavailable), 0 fail-open. 0 conflict(s) identified.',
    },
    referencedUnknownComponents: [],
    warnings: [],
  };
}

/**
 * Build a fan-out result with a single reference_unknown decision.
 * Used to verify that reference_unknown decisions do NOT cover a real gap.
 */
function makeFanOutWithReferenceUnknown(unknownId: string): SelectorFanOutResult {
  const refUnknown: SelectionDecision = {
    componentId: unknownId,
    selectorName: 'deterministic_scaffold',
    action: 'reference_unknown',
    reason: 'test reference_unknown',
    path: 'reference_unknown',
    confidence: 'low',
    evidence: [],
    constraintsApplied: [],
    warnings: [],
    traceRefs: ['trace-ref-001'],
  };
  return {
    decisions: [refUnknown],
    selectorTrace: [],
    selectorSummary: {
      totalEvaluated: 0,
      decidedInclude: 0,
      decidedOmit: 0,
      decidedDefer: 0,
      defaultDefer: 0,
      runtimeUnavailableDefer: 0,
      failOpenInclude: 0,
      conflictsIdentified: 0,
      unknownReferences: 1,
      narrative: '0 components evaluated. 0 included, 0 omitted, 0 deferred (0 default, 0 runtime-unavailable), 0 fail-open. 0 conflict(s) identified.',
    },
    referencedUnknownComponents: [{ componentId: unknownId, referencedBy: 'test', traceRef: 'trace-ref-001' }],
    warnings: [],
  };
}

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
// Unit tests — runGapCheck: zero gaps
// ---------------------------------------------------------------------------

describe('Phase 6 — runGapCheck: zero gaps', () => {
  it('all candidates covered → gapCount=0, no synthetic decisions', () => {
    const c = makeComponent('gc.covered');
    const csr = makeCandidateSetResult([c]);
    const reg = makeRegistryResult([c]);
    const ni = makeNormalizedInputs();
    const fanOut = runSelectorFanOut(csr, ni, reg);
    const result = runGapCheck(fanOut, csr);
    expect(result.gapCount).toBe(0);
    expect(result.syntheticDecisions).toHaveLength(0);
    expect(result.syntheticTraceEntries).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('multiple candidates all covered → gapCount=0', () => {
    const c1 = makeComponent('gc.cov1');
    const c2 = makeComponent('gc.cov2');
    const csr = makeCandidateSetResult([c1, c2]);
    const reg = makeRegistryResult([c1, c2]);
    const ni = makeNormalizedInputs();
    const fanOut = runSelectorFanOut(csr, ni, reg);
    const result = runGapCheck(fanOut, csr);
    expect(result.gapCount).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Unit tests — runGapCheck: one gap
// ---------------------------------------------------------------------------

describe('Phase 6 — runGapCheck: one gap', () => {
  it('one candidate not covered → gapCount=1, one synthetic decision', () => {
    const c = makeComponent('gc.gap1');
    const csr = makeCandidateSetResult([c]);
    const fanOut = makeEmptyFanOutResult();
    const result = runGapCheck(fanOut, csr);
    expect(result.gapCount).toBe(1);
    expect(result.syntheticDecisions).toHaveLength(1);
    expect(result.syntheticTraceEntries).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
  });

  it('synthetic decision has action:include, path:not_evaluated, confidence:low, selectorName:gap_check', () => {
    const c = makeComponent('gc.gap2');
    const csr = makeCandidateSetResult([c]);
    const fanOut = makeEmptyFanOutResult();
    const result = runGapCheck(fanOut, csr);
    const d = result.syntheticDecisions[0];
    expect(d.action).toBe('include');
    expect(d.path).toBe('not_evaluated');
    expect(d.confidence).toBe('low');
    expect(d.selectorName).toBe('gap_check');
    expect(d.componentId).toBe('gc.gap2');
  });

  it('synthetic decision evidence contains gap_check=true and no_selector_evaluated_this_component', () => {
    const c = makeComponent('gc.gap3');
    const csr = makeCandidateSetResult([c]);
    const fanOut = makeEmptyFanOutResult();
    const result = runGapCheck(fanOut, csr);
    const d = result.syntheticDecisions[0];
    expect(d.evidence).toContain('gap_check=true');
    expect(d.evidence).toContain('no_selector_evaluated_this_component');
  });

  it('synthetic decision warnings[] contains "not_evaluated" (per-decision code)', () => {
    const c = makeComponent('gc.gap4');
    const csr = makeCandidateSetResult([c]);
    const fanOut = makeEmptyFanOutResult();
    const result = runGapCheck(fanOut, csr);
    expect(result.syntheticDecisions[0].warnings).toContain('not_evaluated');
  });

  it('synthetic decision constraintsApplied is empty', () => {
    const c = makeComponent('gc.gap5');
    const csr = makeCandidateSetResult([c]);
    const fanOut = makeEmptyFanOutResult();
    const result = runGapCheck(fanOut, csr);
    expect(result.syntheticDecisions[0].constraintsApplied).toHaveLength(0);
  });

  it('traceRefs[0] matches companion TraceEntry.decisionId', () => {
    const c = makeComponent('gc.gap6');
    const csr = makeCandidateSetResult([c]);
    const fanOut = makeEmptyFanOutResult();
    const result = runGapCheck(fanOut, csr);
    const d = result.syntheticDecisions[0];
    const te = result.syntheticTraceEntries[0];
    expect(d.traceRefs).toHaveLength(1);
    expect(d.traceRefs[0]).toBe(te.decisionId);
  });
});

// ---------------------------------------------------------------------------
// Unit tests — runGapCheck: companion TraceEntry shape
// ---------------------------------------------------------------------------

describe('Phase 6 — runGapCheck: TraceEntry shape', () => {
  it('TraceEntry has module:GapCheck, action:include, failOpen:true, selector:deterministic', () => {
    const c = makeComponent('gc.te1');
    const csr = makeCandidateSetResult([c]);
    const fanOut = makeEmptyFanOutResult();
    const result = runGapCheck(fanOut, csr);
    const te = result.syntheticTraceEntries[0];
    expect(te.module).toBe('GapCheck');
    expect(te.action).toBe('include');
    expect(te.failOpen).toBe(true);
    expect(te.selector).toBe('deterministic');
  });

  it('TraceEntry.estimatedSavings.tokens is 0', () => {
    const c = makeComponent('gc.te2');
    const csr = makeCandidateSetResult([c]);
    const fanOut = makeEmptyFanOutResult();
    const result = runGapCheck(fanOut, csr);
    expect(result.syntheticTraceEntries[0].estimatedSavings.tokens).toBe(0);
  });

  it('TraceEntry.risk is taken from candidatesById component.riskLevel (not hardcoded)', () => {
    const c = makeComponent('gc.te3', { riskLevel: 'high' });
    const csr = makeCandidateSetResult([c]);
    const fanOut = makeEmptyFanOutResult();
    const result = runGapCheck(fanOut, csr);
    expect(result.syntheticTraceEntries[0].risk).toBe('high');
  });

  it('TraceEntry.risk reflects low riskLevel correctly', () => {
    const c = makeComponent('gc.te4', { riskLevel: 'low' });
    const csr = makeCandidateSetResult([c]);
    const fanOut = makeEmptyFanOutResult();
    const result = runGapCheck(fanOut, csr);
    expect(result.syntheticTraceEntries[0].risk).toBe('low');
  });

  it('TraceEntry.confidence is low', () => {
    const c = makeComponent('gc.te5');
    const csr = makeCandidateSetResult([c]);
    const fanOut = makeEmptyFanOutResult();
    const result = runGapCheck(fanOut, csr);
    expect(result.syntheticTraceEntries[0].confidence).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// Unit tests — runGapCheck: PlanningWarning shape
// ---------------------------------------------------------------------------

describe('Phase 6 — runGapCheck: PlanningWarning', () => {
  it('planning warning has code "not_evaluated" (exactly)', () => {
    const c = makeComponent('gc.pw1');
    const csr = makeCandidateSetResult([c]);
    const fanOut = makeEmptyFanOutResult();
    const result = runGapCheck(fanOut, csr);
    expect(result.warnings[0].code).toBe('not_evaluated');
  });

  it('planning warning context.componentId matches the gap ID', () => {
    const c = makeComponent('gc.pw2');
    const csr = makeCandidateSetResult([c]);
    const fanOut = makeEmptyFanOutResult();
    const result = runGapCheck(fanOut, csr);
    expect((result.warnings[0].context as { componentId: string }).componentId).toBe('gc.pw2');
  });

  it('planning warning message mentions the component ID', () => {
    const c = makeComponent('gc.pw3');
    const csr = makeCandidateSetResult([c]);
    const fanOut = makeEmptyFanOutResult();
    const result = runGapCheck(fanOut, csr);
    expect(result.warnings[0].message).toContain('gc.pw3');
  });
});

// ---------------------------------------------------------------------------
// Unit tests — runGapCheck: multiple gaps
// ---------------------------------------------------------------------------

describe('Phase 6 — runGapCheck: multiple gaps', () => {
  it('two gaps → gapCount=2, two synthetic decisions, two warnings', () => {
    const c1 = makeComponent('gc.mg1');
    const c2 = makeComponent('gc.mg2');
    const csr = makeCandidateSetResult([c1, c2]);
    const fanOut = makeEmptyFanOutResult();
    const result = runGapCheck(fanOut, csr);
    expect(result.gapCount).toBe(2);
    expect(result.syntheticDecisions).toHaveLength(2);
    expect(result.syntheticTraceEntries).toHaveLength(2);
    expect(result.warnings).toHaveLength(2);
  });

  it('two gaps → each traceRefs[0] matches its companion TraceEntry.decisionId', () => {
    const c1 = makeComponent('gc.mg3');
    const c2 = makeComponent('gc.mg4');
    const csr = makeCandidateSetResult([c1, c2]);
    const fanOut = makeEmptyFanOutResult();
    const result = runGapCheck(fanOut, csr);
    for (let i = 0; i < 2; i++) {
      expect(result.syntheticDecisions[i].traceRefs[0]).toBe(result.syntheticTraceEntries[i].decisionId);
    }
  });
});

// ---------------------------------------------------------------------------
// Unit tests — runGapCheck: reference_unknown does NOT mask a real gap
// ---------------------------------------------------------------------------

describe('Phase 6 — runGapCheck: reference_unknown exclusion from coveredIds', () => {
  it('reference_unknown decision for an ID that is also a candidate → still a gap', () => {
    // The candidate ID appears in decisions[] as reference_unknown.
    // This must NOT be treated as covered — reference_unknown IDs are
    // untrusted caller strings, not confirmed evaluations.
    const c = makeComponent('gc.ru1');
    const csr = makeCandidateSetResult([c]);
    // Fan-out result has reference_unknown for the same ID as the candidate.
    const fanOut = makeFanOutWithReferenceUnknown('gc.ru1');
    const result = runGapCheck(fanOut, csr);
    // The component must still be detected as a gap.
    expect(result.gapCount).toBe(1);
    expect(result.syntheticDecisions[0].componentId).toBe('gc.ru1');
  });

  it('reference_unknown for a different unknown ID → does not create a gap for the candidate', () => {
    // The reference_unknown is for an ID ('x.unknown') not in candidatesById.
    // The real candidate ('gc.ru2') is covered by Phase 5 fan-out.
    const c = makeComponent('gc.ru2');
    const csr = makeCandidateSetResult([c]);
    const reg = makeRegistryResult([c]);
    const ni = makeNormalizedInputs();
    const fanOut = runSelectorFanOut(csr, ni, reg);
    // fanOut.decisions[0] should be an include for gc.ru2 (from Phase 5).
    const result = runGapCheck(fanOut, csr);
    expect(result.gapCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Unit tests — computeSelectorSummary: not_evaluated bucket (R1 fix #1)
// ---------------------------------------------------------------------------

describe('Phase 6 — computeSelectorSummary: not_evaluated increments failOpenInclude', () => {
  it('synthetic not_evaluated decision increments decidedInclude by 1', () => {
    const c = makeComponent('gc.cs1');
    const csr = makeCandidateSetResult([c]);
    const fanOut = makeEmptyFanOutResult();
    const gapResult = runGapCheck(fanOut, csr);
    const allDecisions = [...fanOut.decisions, ...gapResult.syntheticDecisions];
    const summary = computeSelectorSummary(allDecisions, 0);
    expect(summary.decidedInclude).toBe(1);
  });

  it('synthetic not_evaluated decision increments failOpenInclude by 1', () => {
    const c = makeComponent('gc.cs2');
    const csr = makeCandidateSetResult([c]);
    const fanOut = makeEmptyFanOutResult();
    const gapResult = runGapCheck(fanOut, csr);
    const allDecisions = [...fanOut.decisions, ...gapResult.syntheticDecisions];
    const summary = computeSelectorSummary(allDecisions, 0);
    expect(summary.failOpenInclude).toBe(1);
  });

  it('zero gaps → decidedInclude and failOpenInclude unchanged after merge', () => {
    const c = makeComponent('gc.cs3');
    const csr = makeCandidateSetResult([c]);
    const reg = makeRegistryResult([c]);
    const ni = makeNormalizedInputs();
    const fanOut = runSelectorFanOut(csr, ni, reg);
    const summaryBefore = fanOut.selectorSummary;
    const gapResult = runGapCheck(fanOut, csr);
    expect(gapResult.gapCount).toBe(0);
    const allDecisions = [...fanOut.decisions, ...gapResult.syntheticDecisions];
    const summaryAfter = computeSelectorSummary(allDecisions, fanOut.referencedUnknownComponents.length);
    expect(summaryAfter.decidedInclude).toBe(summaryBefore.decidedInclude);
    expect(summaryAfter.failOpenInclude).toBe(summaryBefore.failOpenInclude);
  });

  it('totalEvaluated is unchanged after gap injection (denominator = candidateSetSize)', () => {
    const c = makeComponent('gc.cs4');
    const csr = makeCandidateSetResult([c]);
    const fanOut = makeEmptyFanOutResult();
    const gapResult = runGapCheck(fanOut, csr);
    const allDecisions = [...fanOut.decisions, ...gapResult.syntheticDecisions];
    const summary = computeSelectorSummary(allDecisions, 0);
    // totalEvaluated == number of non-reference_unknown decisions in allDecisions.
    // One synthetic decision, so totalEvaluated = 1.
    expect(summary.totalEvaluated).toBe(1);
  });

  it('narrative is recomputed correctly after merge', () => {
    const c = makeComponent('gc.cs5');
    const csr = makeCandidateSetResult([c]);
    const fanOut = makeEmptyFanOutResult();
    const gapResult = runGapCheck(fanOut, csr);
    const allDecisions = [...fanOut.decisions, ...gapResult.syntheticDecisions];
    const summary = computeSelectorSummary(allDecisions, 0);
    const expected =
      `${summary.totalEvaluated} components evaluated. ` +
      `${summary.decidedInclude} included, ` +
      `${summary.decidedOmit} omitted, ` +
      `${summary.decidedDefer} deferred (${summary.defaultDefer} default, ${summary.runtimeUnavailableDefer} runtime-unavailable), ` +
      `${summary.failOpenInclude} fail-open. ` +
      `${summary.conflictsIdentified} conflict(s) identified.`;
    expect(summary.narrative).toBe(expected);
  });

  it('two synthetic not_evaluated decisions → failOpenInclude=2, decidedInclude=2', () => {
    const c1 = makeComponent('gc.cs6a');
    const c2 = makeComponent('gc.cs6b');
    const csr = makeCandidateSetResult([c1, c2]);
    const fanOut = makeEmptyFanOutResult();
    const gapResult = runGapCheck(fanOut, csr);
    const allDecisions = [...fanOut.decisions, ...gapResult.syntheticDecisions];
    const summary = computeSelectorSummary(allDecisions, 0);
    expect(summary.decidedInclude).toBe(2);
    expect(summary.failOpenInclude).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// CLI integration tests — Phase 6 behavior
// ---------------------------------------------------------------------------

describe('CLI integration — Phase 6 behavior', () => {
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

  it('stderr does NOT contain Phase 6 not-implemented message', () => {
    const td = makeTempDir();
    writeFileSync(join(td, 'req.txt'), 'Hello');
    writeFileSync(join(td, 'reg.json'), makeRegistryJson(['scaffold.test']));
    const result = runCli([
      'plan',
      '--request', join(td, 'req.txt'),
      '--registry', join(td, 'reg.json'),
    ]);
    expect(result.stderr).not.toContain('Phase 6 (gap-check) is not yet implemented');
  });

  it('fatal registry halts before Phase 6 and does not print Phase 7 message', () => {
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
