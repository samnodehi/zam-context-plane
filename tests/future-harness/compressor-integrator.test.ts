/**
 * Future Harness — Compressor Integrator Unit Tests. [FUTURE-ONLY]
 *
 * Tests that model-assisted compressor output (HistoryCompressorOutput) is
 * correctly converted to a SummaryPhase trace object by
 * integrateCompressorOutput(), and that protected category safety invariants
 * are enforced.
 *
 * ISOLATION INVARIANTS (docs/22 §5):
 *   - Does NOT import from tests/phase12/ or src/core/harness-*.
 *   - Does NOT modify any MVP fixture or schema.
 *   - Does NOT affect Gate B status.
 *
 * Canonical: docs/13_MODEL_ASSISTED_CONTEXT_PLANNING.md §10;
 *            docs/14_SUMMARY_QUALITY_HARNESS_SCOPING.md §4, §7;
 *            docs/16_TRACE_EXTENSIONS_SCOPING.md §6.2.
 */

import { describe, it, expect } from 'vitest';
import {
  integrateCompressorOutput,
  PROTECTED_CATEGORIES,
} from '../../src/core/compressor-integrator.js';
import type { HistoryCompressorOutput } from '../../src/types/compressor.js';

// ---------------------------------------------------------------------------
// Test fixtures / helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid HistoryCompressorOutput for testing. */
function makeCompressorOutput(
  overrides: Partial<HistoryCompressorOutput> = {},
): HistoryCompressorOutput {
  return {
    compressorVersion: 'test-compressor-v1.0',
    compressorTraceId: 'ct-test-001',
    currentTaskState: {
      activeTask: 'Implement the frontend dashboard',
      currentGoal: 'Build the chart component',
      blockers: [],
    },
    acceptedDecisions: [{ content: 'Use React for the frontend' }],
    openIssues: [],
    openCommitments: [{ content: 'Deliver by Friday' }],
    userConstraints: [{ content: 'Never use Tailwind CSS' }],
    importantFilesPaths: [],
    failedAttempts: [],
    warnings: [],
    antiRegressionRules: [
      { content: 'Always validate schema before deployment', notes: 'Learned from incident #42' },
    ],
    recentRelevantTurns: [],
    durableFacts: [{ content: 'Project uses TypeScript 5.x' }],
    summaryTrace: {
      included: ['currentTaskState', 'acceptedDecisions', 'openCommitments', 'userConstraints', 'antiRegressionRules', 'durableFacts'],
      omitted: [],
      uncertain: [],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests — basic mapping
// ---------------------------------------------------------------------------

describe('integrateCompressorOutput — basic mapping', () => {
  it('produces a valid SummaryPhase for a minimal output', () => {
    const output = makeCompressorOutput();
    const result = integrateCompressorOutput(output);

    expect(result.summaryPhase.compressorVersion).toBe('test-compressor-v1.0');
    expect(result.summaryPhase.summaryTraceId).toBe('ct-test-001');
    expect(result.warnings).toHaveLength(0);
  });

  it('includes non-empty state categories in included[]', () => {
    const output = makeCompressorOutput();
    const result = integrateCompressorOutput(output);

    // Non-empty categories: currentTaskState, acceptedDecisions,
    // openCommitments, userConstraints, antiRegressionRules, durableFacts
    const includedCategories = result.summaryPhase.included.map(i => i.category);
    expect(includedCategories).toContain('currentTaskState');
    expect(includedCategories).toContain('acceptedDecisions');
    expect(includedCategories).toContain('openCommitments');
    expect(includedCategories).toContain('userConstraints');
    expect(includedCategories).toContain('antiRegressionRules');
    expect(includedCategories).toContain('durableFacts');
    // Empty categories should not appear
    expect(includedCategories).not.toContain('openIssues');
    expect(includedCategories).not.toContain('importantFilesPaths');
    expect(includedCategories).not.toContain('failedAttempts');
  });

  it('maps summaryTrace.omitted to omitted[] for non-protected categories', () => {
    const output = makeCompressorOutput({
      summaryTrace: {
        included: ['currentTaskState'],
        omitted: ['failedAttempts', 'importantFilesPaths'],
        uncertain: [],
      },
    });
    const result = integrateCompressorOutput(output);

    expect(result.summaryPhase.omitted).toHaveLength(2);
    const omittedCategories = result.summaryPhase.omitted.map(o => o.category);
    expect(omittedCategories).toContain('failedAttempts');
    expect(omittedCategories).toContain('importantFilesPaths');
    expect(result.warnings).toHaveLength(0);
  });

  it('maps summaryTrace.uncertain to uncertain[]', () => {
    const output = makeCompressorOutput({
      summaryTrace: {
        included: ['currentTaskState'],
        omitted: [],
        uncertain: ['openIssues', 'recentRelevantTurns'],
      },
    });
    const result = integrateCompressorOutput(output);

    const uncertainCategories = result.summaryPhase.uncertain.map(u => u.category);
    expect(uncertainCategories).toContain('openIssues');
    expect(uncertainCategories).toContain('recentRelevantTurns');
  });

  it('sets sourceReference to compressorTraceId for included items', () => {
    const output = makeCompressorOutput();
    const result = integrateCompressorOutput(output);

    for (const item of result.summaryPhase.included) {
      expect(item.sourceReference).toBe('ct-test-001');
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — protected categories
// ---------------------------------------------------------------------------

describe('integrateCompressorOutput — protected category enforcement', () => {
  it('populates protectedCategories from the static set', () => {
    const output = makeCompressorOutput();
    const result = integrateCompressorOutput(output);

    expect(result.summaryPhase.protectedCategories).toEqual(
      expect.arrayContaining([...PROTECTED_CATEGORIES]),
    );
    expect(result.summaryPhase.protectedCategories).toHaveLength(PROTECTED_CATEGORIES.size);
  });

  it('moves a protected category from omitted to uncertain with a warning', () => {
    const output = makeCompressorOutput({
      summaryTrace: {
        included: [],
        omitted: ['acceptedDecisions'],
        uncertain: [],
      },
    });
    const result = integrateCompressorOutput(output);

    // Should NOT be in omitted
    const omittedCategories = result.summaryPhase.omitted.map(o => o.category);
    expect(omittedCategories).not.toContain('acceptedDecisions');

    // Should be moved to uncertain
    const uncertainCategories = result.summaryPhase.uncertain.map(u => u.category);
    expect(uncertainCategories).toContain('acceptedDecisions');

    // Should emit a warning
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].code).toBe('compressor_protected_category_violation');
    expect(result.warnings[0].message).toContain('acceptedDecisions');
  });

  it('handles multiple protected categories in omitted', () => {
    const output = makeCompressorOutput({
      summaryTrace: {
        included: [],
        omitted: ['durableFacts', 'openCommitments', 'failedAttempts'],
        uncertain: [],
      },
    });
    const result = integrateCompressorOutput(output);

    // Only failedAttempts (non-protected) should remain in omitted
    const omittedCategories = result.summaryPhase.omitted.map(o => o.category);
    expect(omittedCategories).toEqual(['failedAttempts']);

    // durableFacts and openCommitments should be moved to uncertain
    const uncertainCategories = result.summaryPhase.uncertain.map(u => u.category);
    expect(uncertainCategories).toContain('durableFacts');
    expect(uncertainCategories).toContain('openCommitments');

    // Two warnings — one per protected category violation
    expect(result.warnings).toHaveLength(2);
    for (const w of result.warnings) {
      expect(w.code).toBe('compressor_protected_category_violation');
    }
  });

  it('preserves all six protected categories', () => {
    const expectedProtected = [
      'currentTaskState',
      'acceptedDecisions',
      'openCommitments',
      'userConstraints',
      'antiRegressionRules',
      'durableFacts',
    ];

    for (const cat of expectedProtected) {
      expect(PROTECTED_CATEGORIES.has(cat)).toBe(true);
    }
    expect(PROTECTED_CATEGORIES.size).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Tests — empty output
// ---------------------------------------------------------------------------

describe('integrateCompressorOutput — empty output', () => {
  it('handles an output with all empty state categories', () => {
    const output = makeCompressorOutput({
      currentTaskState: { activeTask: 'Nothing active' },
      acceptedDecisions: [],
      openIssues: [],
      openCommitments: [],
      userConstraints: [],
      importantFilesPaths: [],
      failedAttempts: [],
      warnings: [],
      antiRegressionRules: [],
      recentRelevantTurns: [],
      durableFacts: [],
      summaryTrace: { included: [], omitted: [], uncertain: [] },
    });
    const result = integrateCompressorOutput(output);

    // Only currentTaskState should be in included (activeTask is always non-empty)
    expect(result.summaryPhase.included).toHaveLength(1);
    expect(result.summaryPhase.included[0].category).toBe('currentTaskState');
    expect(result.summaryPhase.omitted).toHaveLength(0);
    expect(result.summaryPhase.uncertain).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('produces empty omitted and uncertain when summaryTrace arrays are empty', () => {
    const output = makeCompressorOutput({
      summaryTrace: { included: [], omitted: [], uncertain: [] },
    });
    const result = integrateCompressorOutput(output);

    expect(result.summaryPhase.omitted).toHaveLength(0);
    expect(result.summaryPhase.uncertain).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — combined scenarios
// ---------------------------------------------------------------------------

describe('integrateCompressorOutput — combined scenarios', () => {
  it('combines included categories, safe omissions, and uncertainty correctly', () => {
    const output = makeCompressorOutput({
      failedAttempts: [{ content: 'Tried Flexbox layout — rejected in turn 10' }],
      summaryTrace: {
        included: ['currentTaskState', 'acceptedDecisions'],
        omitted: ['importantFilesPaths'],
        uncertain: ['recentRelevantTurns'],
      },
    });
    const result = integrateCompressorOutput(output);

    // included should have all non-empty categories
    const includedCategories = result.summaryPhase.included.map(i => i.category);
    expect(includedCategories).toContain('currentTaskState');
    expect(includedCategories).toContain('acceptedDecisions');
    expect(includedCategories).toContain('failedAttempts');

    // omitted should have importantFilesPaths
    expect(result.summaryPhase.omitted).toHaveLength(1);
    expect(result.summaryPhase.omitted[0].category).toBe('importantFilesPaths');

    // uncertain should have recentRelevantTurns
    expect(result.summaryPhase.uncertain).toHaveLength(1);
    expect(result.summaryPhase.uncertain[0].category).toBe('recentRelevantTurns');

    expect(result.warnings).toHaveLength(0);
  });
});
