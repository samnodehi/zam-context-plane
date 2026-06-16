/**
 * Future Harness — Analyzer Integrator Unit Tests. [FUTURE-ONLY]
 *
 * Tests that model-assisted analyzer proposals (AnalyzerOutput.neededLanes)
 * are correctly converted to SelectionDecision + TraceEntry records by
 * integrateAnalyzerOutput(), and that the Conflict Resolver's deterministic
 * priority ladder correctly overrides them when safety rules apply.
 *
 * ISOLATION INVARIANTS (docs/22 §5):
 *   - Does NOT import from tests/phase12/ or src/core/harness-*.
 *   - Does NOT modify any MVP fixture or schema.
 *   - Does NOT affect Gate B status.
 *
 * Canonical: docs/15_REQUEST_ANALYZER_SCHEMA_SCOPING.md §4, §6;
 *            docs/04_PORTABLE_CORE_ARCHITECTURE.md §7.3;
 *            docs/06_SELECTOR_ORCHESTRATION_SPEC.md §11.4.
 */

import { describe, it, expect } from 'vitest';
import { integrateAnalyzerOutput } from '../../src/core/analyzer-integrator.js';
import type { AnalyzerOutput } from '../../src/types/analyzer.js';
import type { Component } from '../../src/types/registry.js';

// ---------------------------------------------------------------------------
// Test fixtures / helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid AnalyzerOutput for testing. */
function makeAnalyzerOutput(overrides: Partial<AnalyzerOutput> = {}): AnalyzerOutput {
  return {
    analyzerVersion: 'test-v1.0',
    tier: 1,
    promptFamily: 'coding_build_debug',
    analyzerConfidence: 0.9,
    assessedRequestRiskLevel: 'low',
    neededLanes: [],
    requiresHistory: false,
    requiresTools: true,
    requiresFiles: true,
    failOpenTriggered: false,
    failOpenReason: null,
    evidence: ['keyword=debug', 'keyword=build'],
    analyzerTraceId: 'trace-test-001',
    ...overrides,
  };
}

/** Build a minimal Component for testing. */
function makeComponent(overrides: Partial<Component> = {}): Component {
  return {
    id: 'test-component',
    type: 'scaffold',
    title: 'Test Component',
    summary: 'A test component for unit testing',
    source: 'test-source',
    riskLevel: 'low',
    omissionPolicy: 'allow',
    retainPolicy: 'optional',
    defaultAction: 'include',
    requiredWhen: [],
    safeToOmitWhen: [],
    budgetPriority: 5,
    evidenceRequired: null,
    tokensApprox: 100,
    charsApprox: 400,
    tags: [],
    version: '1.0.0',
    hash: null,
    ...overrides,
  } as Component;
}

/** Build a candidatesById map from an array of components. */
function makeCandidatesById(components: Component[]): Map<string, Component> {
  const map = new Map<string, Component>();
  for (const c of components) {
    map.set(c.id, c);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('integrateAnalyzerOutput — basic proposal generation', () => {
  it('returns empty results when neededLanes is empty', () => {
    const analyzerOutput = makeAnalyzerOutput({ neededLanes: [] });
    const candidatesById = makeCandidatesById([]);
    const result = integrateAnalyzerOutput(analyzerOutput, candidatesById);

    expect(result.decisions).toHaveLength(0);
    expect(result.traceEntries).toHaveLength(0);
    expect(result.skippedLanes).toHaveLength(0);
    // No fail-open warning since failOpenTriggered: false
    expect(result.warnings).toHaveLength(0);

    // analyzerPhase should still be fully populated even with no lanes.
    expect(result.analyzerPhase).toBeDefined();
    expect(result.analyzerPhase.analyzerVersion).toBe('test-v1.0');
    expect(result.analyzerPhase.proposedLanes).toEqual([]);
  });

  it('generates one include decision per matched lane', () => {
    const comp = makeComponent({ id: 'skill-coding', type: 'skill', riskLevel: 'low' });
    const analyzerOutput = makeAnalyzerOutput({ neededLanes: ['skill-coding'] });
    const candidatesById = makeCandidatesById([comp]);

    const result = integrateAnalyzerOutput(analyzerOutput, candidatesById);

    expect(result.decisions).toHaveLength(1);
    expect(result.traceEntries).toHaveLength(1);
    expect(result.skippedLanes).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);

    const decision = result.decisions[0];
    expect(decision.componentId).toBe('skill-coding');
    expect(decision.action).toBe('include');
    expect(decision.selectorName).toBe('model_assisted_analyzer');
    // path: 'fail_open' — no new enum value required
    expect(decision.path).toBe('fail_open');
    // High confidence because analyzerConfidence: 0.9 >= 0.85
    expect(decision.confidence).toBe('high');
    expect(decision.evidence).toContain('analyzerVersion=test-v1.0');
    expect(decision.evidence).toContain('proposedLane=skill-coding');
    expect(decision.traceRefs).toHaveLength(1);
  });

  it('generates decisions for multiple lanes', () => {
    const comp1 = makeComponent({ id: 'comp-a', type: 'scaffold' });
    const comp2 = makeComponent({ id: 'comp-b', type: 'skill' });
    const analyzerOutput = makeAnalyzerOutput({ neededLanes: ['comp-a', 'comp-b'] });
    const candidatesById = makeCandidatesById([comp1, comp2]);

    const result = integrateAnalyzerOutput(analyzerOutput, candidatesById);

    expect(result.decisions).toHaveLength(2);
    expect(result.traceEntries).toHaveLength(2);
    const ids = result.decisions.map(d => d.componentId);
    expect(ids).toContain('comp-a');
    expect(ids).toContain('comp-b');
  });
});

describe('integrateAnalyzerOutput — skipped lanes', () => {
  it('skips lanes not found in candidatesById and emits warnings', () => {
    const comp = makeComponent({ id: 'known-comp' });
    const analyzerOutput = makeAnalyzerOutput({ neededLanes: ['known-comp', 'unknown-lane'] });
    const candidatesById = makeCandidatesById([comp]);

    const result = integrateAnalyzerOutput(analyzerOutput, candidatesById);

    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].componentId).toBe('known-comp');
    expect(result.skippedLanes).toContain('unknown-lane');
    // One warning for the skipped lane
    const skipWarn = result.warnings.find(w => w.code === 'analyzer_lane_not_found');
    expect(skipWarn).toBeDefined();
    expect(skipWarn?.message).toContain('unknown-lane');
  });
});

describe('integrateAnalyzerOutput — confidence mapping', () => {
  it('maps analyzerConfidence >= 0.85 to high', () => {
    const comp = makeComponent({ id: 'comp' });
    const result = integrateAnalyzerOutput(
      makeAnalyzerOutput({ neededLanes: ['comp'], analyzerConfidence: 0.9 }),
      makeCandidatesById([comp]),
    );
    expect(result.decisions[0].confidence).toBe('high');
  });

  it('maps analyzerConfidence 0.6–0.84 to medium', () => {
    const comp = makeComponent({ id: 'comp' });
    const result = integrateAnalyzerOutput(
      makeAnalyzerOutput({ neededLanes: ['comp'], analyzerConfidence: 0.75 }),
      makeCandidatesById([comp]),
    );
    expect(result.decisions[0].confidence).toBe('medium');
  });

  it('maps analyzerConfidence < 0.6 to low', () => {
    const comp = makeComponent({ id: 'comp' });
    const result = integrateAnalyzerOutput(
      makeAnalyzerOutput({ neededLanes: ['comp'], analyzerConfidence: 0.5 }),
      makeCandidatesById([comp]),
    );
    expect(result.decisions[0].confidence).toBe('low');
  });
});

describe('integrateAnalyzerOutput — fail-open behavior', () => {
  it('emits analyzer_fail_open_triggered warning when failOpenTriggered is true', () => {
    const comp = makeComponent({ id: 'comp' });
    const analyzerOutput = makeAnalyzerOutput({
      neededLanes: ['comp'],
      failOpenTriggered: true,
      failOpenReason: 'Low confidence threshold exceeded',
      analyzerConfidence: 0.4,
    });
    const result = integrateAnalyzerOutput(analyzerOutput, makeCandidatesById([comp]));

    const failOpenWarn = result.warnings.find(w => w.code === 'analyzer_fail_open_triggered');
    expect(failOpenWarn).toBeDefined();
    expect(failOpenWarn?.message).toContain('Low confidence threshold exceeded');
  });

  it('does not emit fail-open warning when failOpenTriggered is false', () => {
    const comp = makeComponent({ id: 'comp' });
    const analyzerOutput = makeAnalyzerOutput({
      neededLanes: ['comp'],
      failOpenTriggered: false,
      failOpenReason: null,
    });
    const result = integrateAnalyzerOutput(analyzerOutput, makeCandidatesById([comp]));

    const failOpenWarn = result.warnings.find(w => w.code === 'analyzer_fail_open_triggered');
    expect(failOpenWarn).toBeUndefined();
  });
});

describe('integrateAnalyzerOutput — Conflict Resolver safety invariant (simulated)', () => {
  /**
   * This test simulates the safety invariant documented in docs/15 §6 and
   * docs/04 §7.3: deterministic guardrails (P0–P4) override model proposals.
   *
   * We do this WITHOUT calling the real Conflict Resolver (to maintain unit test
   * isolation). Instead, we verify that the proposals produced by the integrator
   * are ordinary 'fail_open' include decisions — which the Conflict Resolver's
   * priority ladder handles correctly per its existing logic:
   *
   *   - If a safety-critical component (P1) also gets an analyzer proposal, the
   *     Conflict Resolver will see two include decisions. Case 5 (multiple includes)
   *     applies, producing rule: 'multiple_include_merged'. The highest-priority
   *     path wins — 'safety_override' beats 'fail_open'. The output is always include.
   *
   *   - If a deterministic omit decision conflicts with an analyzer include, the
   *     Conflict Resolver applies Case 1 (include vs omit). The 'fail_open' path
   *     triggers 'fail_open_unresolved' → result is include. This means the
   *     analyzer proposal effectively acts as a fail-open fence, which is the
   *     correct conservative behavior.
   */
  it('produces proposals with action: include and path: fail_open only', () => {
    const components = [
      makeComponent({ id: 'comp-safe', riskLevel: 'low', retainPolicy: 'optional' }),
      makeComponent({ id: 'comp-critical', riskLevel: 'critical', retainPolicy: 'safety_critical', omissionPolicy: 'never' }),
    ];
    const analyzerOutput = makeAnalyzerOutput({
      neededLanes: ['comp-safe', 'comp-critical'],
    });
    const result = integrateAnalyzerOutput(analyzerOutput, makeCandidatesById(components));

    // All proposals are action: include / path: fail_open
    for (const d of result.decisions) {
      expect(d.action).toBe('include');
      expect(d.path).toBe('fail_open');
      expect(d.selectorName).toBe('model_assisted_analyzer');
    }

    // Proposals are advisory — they do NOT carry omission authority
    // (confirmed by action: include, not omit)
    const omitDecisions = result.decisions.filter(d => d.action === 'omit');
    expect(omitDecisions).toHaveLength(0);
  });

  it('trace entries have selector: deterministic (MVP constraint)', () => {
    const comp = makeComponent({ id: 'comp', riskLevel: 'medium' });
    const result = integrateAnalyzerOutput(
      makeAnalyzerOutput({ neededLanes: ['comp'] }),
      makeCandidatesById([comp]),
    );

    for (const te of result.traceEntries) {
      // TraceEntry.selector must be 'deterministic' per current TS type.
      // model-assisted selector type is future-only.
      expect(te.selector).toBe('deterministic');
      // But the module name identifies the source for audit.
      expect(te.module).toBe('ModelAssistedAnalyzer');
      // fail_open decisions always have failOpen: true
      expect(te.failOpen).toBe(true);
    }
  });

  it('bi-directional traceRef link is maintained', () => {
    const comp = makeComponent({ id: 'comp' });
    const result = integrateAnalyzerOutput(
      makeAnalyzerOutput({ neededLanes: ['comp'] }),
      makeCandidatesById([comp]),
    );

    const decision = result.decisions[0];
    const traceEntry = result.traceEntries[0];

    // SelectionDecision.traceRefs[0] must equal TraceEntry.decisionId
    expect(decision.traceRefs[0]).toBe(traceEntry.decisionId);
    // Both must reference the same component
    expect(decision.componentId).toBe(traceEntry.componentId);
  });
});

describe('integrateAnalyzerOutput — analyzerPhase assembly', () => {
  it('returns an analyzerPhase with all 9 required fields', () => {
    const comp = makeComponent({ id: 'comp' });
    const analyzerOutput = makeAnalyzerOutput({
      neededLanes: ['comp'],
      analyzerVersion: 'model-v2.1',
      tier: 2,
      promptFamily: 'research_learn',
      analyzerConfidence: 0.72,
      failOpenTriggered: true,
      failOpenReason: 'Confidence below tier threshold',
      evidence: ['signal-a', 'signal-b'],
      analyzerTraceId: 'at-test-999',
    });
    const result = integrateAnalyzerOutput(analyzerOutput, makeCandidatesById([comp]));

    const phase = result.analyzerPhase;
    expect(phase.analyzerVersion).toBe('model-v2.1');
    expect(phase.tier).toBe(2);
    expect(phase.promptFamily).toBe('research_learn');
    expect(phase.analyzerConfidence).toBe(0.72);
    expect(phase.proposedLanes).toEqual(['comp']);
    expect(phase.failOpenTriggered).toBe(true);
    expect(phase.failOpenReason).toBe('Confidence below tier threshold');
    expect(phase.evidence).toEqual(['signal-a', 'signal-b']);
    expect(phase.analyzerTraceId).toBe('at-test-999');
  });

  it('maps neededLanes to proposedLanes in analyzerPhase', () => {
    const comp1 = makeComponent({ id: 'lane-a' });
    const comp2 = makeComponent({ id: 'lane-b' });
    const analyzerOutput = makeAnalyzerOutput({
      neededLanes: ['lane-a', 'lane-b', 'unknown-lane'],
    });
    const result = integrateAnalyzerOutput(
      analyzerOutput,
      makeCandidatesById([comp1, comp2]),
    );

    // proposedLanes mirrors neededLanes (all of them, including unknown)
    expect(result.analyzerPhase.proposedLanes).toEqual(['lane-a', 'lane-b', 'unknown-lane']);
  });

  it('sets failOpenReason to null when failOpenTriggered is false', () => {
    const analyzerOutput = makeAnalyzerOutput({
      neededLanes: [],
      failOpenTriggered: false,
      failOpenReason: null,
    });
    const result = integrateAnalyzerOutput(analyzerOutput, makeCandidatesById([]));

    expect(result.analyzerPhase.failOpenTriggered).toBe(false);
    expect(result.analyzerPhase.failOpenReason).toBeNull();
  });
});
