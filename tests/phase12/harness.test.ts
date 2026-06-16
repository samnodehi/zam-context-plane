/**
 * Phase 12 — Harness integration test.
 *
 * Tests the full harness pipeline (runHarness) with a development-mode
 * RunFixtureFn that uses --import tsx/esm (test context only).
 *
 * Test groups:
 *   H-ZT  — Zero-tolerance check unit tests (pure harness-checks functions)
 *   H-S   — Static validation only (Mode 1 layout and schema checks)
 *   H-F   — Full harness run on fixtures corpus (report generation)
 *   H-DT  — Determinism test on a known-passing fixture
 *
 * Phase 12 scope:
 *   - H-F tests validate that the harness *runs correctly and reports results*.
 *   - H-F2 explicitly reports Gate B status. Gate B requires results.failed === 0
 *     AND results.blocked === 0. Approved-skipped fixtures (status: 'skipped') are
 *     allowed only when they carry validated skipApproval metadata; they do not
 *     count as failed or blocked.
 *     If failed > 0 or blocked > 0, Gate B is NOT satisfied.
 *   - H-SK covers approved-skip validation (SK-1 through SK-11).
 *   - H-DT covers one known-passing fixture (family-confidence-escalation).
 *     Approved-skipped fixtures (e.g., fixture 13 safety-beats-omit) are excluded
 *     from determinism checks. Fixture 13 is architecturally unreachable E2E;
 *     safety_hard_protection is covered by unit test SHP-1.
 *
 * Canonical: docs/12 Phase 12 R4 §5.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { runHarness, buildDeterminismResult, normalizeTraceForDeterminism, validateSkipReason } from '../../src/core/harness-runner.js';
import {
  getPromptPlanValidator,
  getTraceValidator,
  getRequestSignalsValidator,
} from '../../src/core/harness-ajv.js';
import type { RunFixtureFn, FixtureRunResult, SkipApproval } from '../../src/types/harness.js';

// Pure check functions for unit tests
import {
  checkZT01Schema,
  checkZT02NoUnsafeOmissions,
  checkZT03NoRawContent,
  checkZT05FailOpenUnresolved,
  checkZT08PartitionExclusivity,
  checkZT09DeferredPath,
  checkZT12ResolutionRuleEnum,
  checkZT13NarrativeTemplate,
  checkZT15ExitCode,
  checkRG01TrimOrderNoNullHint,
  checkRG02PlanningWarningsShape,
  checkRSMRequestSignalsMatch,
  comparePartitions,
  comparePhaseKeys,
} from '../../src/core/harness-checks.js';

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = resolve(__dirname, '../../src/cli/index.ts');
const FIXTURES_DIR = resolve(__dirname, '../../fixtures');

/**
 * Development-mode RunFixtureFn — uses --import tsx/esm to invoke the CLI.
 * ONLY for test files. Never imported by src/ modules.
 *
 * tsx/esm does NOT appear in any src/ module. This runner is test-only.
 */
function makeTestRunner(): RunFixtureFn {
  return (fixtureInputsDir: string): FixtureRunResult => {
    const runDir = mkdtempSync(join(tmpdir(), 'ctx-plane-harness-test-'));
    const requestTxtPath = join(runDir, 'request.txt');
    writeFileSync(requestTxtPath, 'fixture harness placeholder request\n', 'utf8');

    // Build optional input flags from fixture inputs directory
    const optionalFlags: string[] = [];
    const optionalInputs = [
      ['--active-ids',  'active-ids.json'],
      ['--budget',      'budget-state.json'],
      ['--history',     'history-state-summary.json'],
      ['--runtime',     'runtime-capabilities.json'],
      ['--policy',      'selector-policy.json'],
      ['--constraints', 'user-constraints.json'],
    ] as const;
    for (const [flag, file] of optionalInputs) {
      const p = join(fixtureInputsDir, file);
      if (existsSync(p)) {
        optionalFlags.push(flag, p);
      }
    }

    const result = spawnSync(
      process.execPath,
      [
        '--import', 'tsx/esm',      // dev-only: tsx/esm is acceptable in test files
        entry,
        'plan',
        '--request',         requestTxtPath,
        '--request-signals', join(fixtureInputsDir, 'request-signals.json'),
        '--registry',        join(fixtureInputsDir, 'component-registry.json'),
        ...optionalFlags,
        '--output-dir',      runDir,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );

    return {
      status: result.status ?? 1,
      stderr: (result.stderr ?? '') + (result.error ? String(result.error) : ''),
      outputDir: runDir,
    };
  };
}

// ---------------------------------------------------------------------------
// Shared validators
// ---------------------------------------------------------------------------

const validatePromptPlan = getPromptPlanValidator();
const validateTrace = getTraceValidator();
const validateRequestSignals = getRequestSignalsValidator();

// ---------------------------------------------------------------------------
// Group H-ZT — Zero-tolerance check unit tests (pure)
// ---------------------------------------------------------------------------

describe('H-ZT — Zero-tolerance check unit tests', () => {

  it('ZT-01 pass: schema valid', () => {
    const r = checkZT01Schema('prompt-plan', true);
    expect(r.passed).toBe(true);
    expect(r.id).toBe('ZT-01');
  });

  it('ZT-01 fail: schema invalid', () => {
    const r = checkZT01Schema('trace', false, '/run must have required property runId');
    expect(r.passed).toBe(false);
    expect(r.message).toContain('runId');
  });

  it('ZT-02 pass: all safe paths', () => {
    const plan = {
      omittedComponents: [
        { componentId: 'c1', path: 'safe_to_omit_match' },
        { componentId: 'c2', path: 'budget_trim' },
      ],
    };
    const r = checkZT02NoUnsafeOmissions(plan as Record<string, unknown>);
    expect(r.passed).toBe(true);
  });

  it('ZT-02 fail: unsafe path present', () => {
    const plan = {
      omittedComponents: [
        { componentId: 'c1', path: 'unknown_custom_path' },
      ],
    };
    const r = checkZT02NoUnsafeOmissions(plan as Record<string, unknown>);
    expect(r.passed).toBe(false);
    expect(r.message).toContain('unknown_custom_path');
  });

  // ZT-05: unresolvedConflicts is in selectorPhase (trace.schema.json)

  it('ZT-05 pass: no fail_open_unresolved entries, no unresolvedConflicts', () => {
    const trace = {
      selectorPhase: { unresolvedConflicts: [] },
      conflictPhase: {
        resolvedDecisions: [
          { componentId: 'c1', resolutionRule: 'no_conflict', finalAction: 'include', finalPath: 'safety_override', warningsEmitted: [] },
        ],
      },
    };
    const r = checkZT05FailOpenUnresolved(trace as Record<string, unknown>);
    expect(r.passed).toBe(true);
  });

  it('ZT-05 pass: matching fail_open_unresolved in resolvedDecisions and selectorPhase.unresolvedConflicts', () => {
    const trace = {
      selectorPhase: { unresolvedConflicts: ['c2'] },
      conflictPhase: {
        resolvedDecisions: [
          {
            componentId: 'c2',
            resolutionRule: 'fail_open_unresolved',
            finalAction: 'include',
            finalPath: 'fail_open',
            warningsEmitted: ['unresolved_conflict_fail_open'],
          },
        ],
      },
    };
    const r = checkZT05FailOpenUnresolved(trace as Record<string, unknown>);
    expect(r.passed).toBe(true);
  });

  it('ZT-05 fail: fail_open_unresolved entry not in selectorPhase.unresolvedConflicts', () => {
    const trace = {
      // selectorPhase.unresolvedConflicts does NOT contain c2
      selectorPhase: { unresolvedConflicts: [] },
      conflictPhase: {
        resolvedDecisions: [
          {
            componentId: 'c2',
            resolutionRule: 'fail_open_unresolved',
            finalAction: 'include',
            finalPath: 'fail_open',
            warningsEmitted: ['unresolved_conflict_fail_open'],
          },
        ],
      },
    };
    const r = checkZT05FailOpenUnresolved(trace as Record<string, unknown>);
    expect(r.passed).toBe(false);
    expect(r.message).toContain('selectorPhase.unresolvedConflicts');
    expect(r.message).toContain('c2');
  });

  it('ZT-05 fail: selectorPhase.unresolvedConflicts entry has no matching fail_open_unresolved', () => {
    const trace = {
      // c3 is listed as unresolved but has no fail_open_unresolved resolvedDecision
      selectorPhase: { unresolvedConflicts: ['c3'] },
      conflictPhase: {
        resolvedDecisions: [
          { componentId: 'c3', resolutionRule: 'no_conflict', finalAction: 'include', finalPath: 'safety_override', warningsEmitted: [] },
        ],
      },
    };
    const r = checkZT05FailOpenUnresolved(trace as Record<string, unknown>);
    expect(r.passed).toBe(false);
    expect(r.message).toContain('c3');
  });

  it('ZT-05 fail: conflictPhase.unresolvedConflicts does NOT exist — ZT-05 reads selectorPhase only', () => {
    // Confirm that putting unresolvedConflicts in conflictPhase is ignored.
    // The check should see selectorPhase.unresolvedConflicts as empty and pass.
    const trace = {
      selectorPhase: { unresolvedConflicts: [] },
      conflictPhase: {
        // unresolvedConflicts here is NOT canonical — ZT-05 must not use it
        unresolvedConflicts: ['c4'], // ignored
        resolvedDecisions: [],
        conflictResolutionTrace: [],
      },
    };
    // c4 in conflictPhase.unresolvedConflicts is NOT seen by ZT-05.
    // selectorPhase.unresolvedConflicts is empty, resolvedDecisions has no fail_open.
    const r = checkZT05FailOpenUnresolved(trace as Record<string, unknown>);
    expect(r.passed).toBe(true); // no mismatch because selectorPhase.unresolvedConflicts is empty
  });

  // ZT-05: conflictResolutionTrace[] must also be inspected for fail_open_unresolved

  it('ZT-05 pass: fail_open_unresolved in conflictResolutionTrace with correct invariants', () => {
    const trace = {
      selectorPhase: { unresolvedConflicts: ['c5'] },
      conflictPhase: {
        resolvedDecisions: [],
        conflictResolutionTrace: [
          {
            componentId: 'c5',
            resolutionRule: 'fail_open_unresolved',
            finalAction: 'include',
            finalPath: 'fail_open',
            warningsEmitted: ['unresolved_conflict_fail_open'],
          },
        ],
      },
    };
    const r = checkZT05FailOpenUnresolved(trace as Record<string, unknown>);
    expect(r.passed).toBe(true);
  });

  it('ZT-05 fail: conflictResolutionTrace fail_open_unresolved with wrong finalAction', () => {
    const trace = {
      selectorPhase: { unresolvedConflicts: ['c6'] },
      conflictPhase: {
        resolvedDecisions: [],
        conflictResolutionTrace: [
          {
            componentId: 'c6',
            resolutionRule: 'fail_open_unresolved',
            finalAction: 'omit', // wrong — must be 'include'
            finalPath: 'fail_open',
            warningsEmitted: ['unresolved_conflict_fail_open'],
          },
        ],
      },
    };
    const r = checkZT05FailOpenUnresolved(trace as Record<string, unknown>);
    expect(r.passed).toBe(false);
    expect(r.message).toContain('finalAction');
    expect(r.message).toContain('conflictResolutionTrace');
  });

  it('ZT-05 fail: conflictResolutionTrace fail_open_unresolved with wrong finalPath', () => {
    const trace = {
      selectorPhase: { unresolvedConflicts: ['c7'] },
      conflictPhase: {
        resolvedDecisions: [],
        conflictResolutionTrace: [
          {
            componentId: 'c7',
            resolutionRule: 'fail_open_unresolved',
            finalAction: 'include',
            finalPath: 'safety_override', // wrong — must be 'fail_open'
            warningsEmitted: ['unresolved_conflict_fail_open'],
          },
        ],
      },
    };
    const r = checkZT05FailOpenUnresolved(trace as Record<string, unknown>);
    expect(r.passed).toBe(false);
    expect(r.message).toContain('finalPath');
    expect(r.message).toContain('conflictResolutionTrace');
  });

  it('ZT-05 fail: conflictResolutionTrace fail_open_unresolved with empty warningsEmitted', () => {
    const trace = {
      selectorPhase: { unresolvedConflicts: ['c8'] },
      conflictPhase: {
        resolvedDecisions: [],
        conflictResolutionTrace: [
          {
            componentId: 'c8',
            resolutionRule: 'fail_open_unresolved',
            finalAction: 'include',
            finalPath: 'fail_open',
            warningsEmitted: [], // wrong — must be non-empty
          },
        ],
      },
    };
    const r = checkZT05FailOpenUnresolved(trace as Record<string, unknown>);
    expect(r.passed).toBe(false);
    expect(r.message).toContain('warningsEmitted');
    expect(r.message).toContain('conflictResolutionTrace');
  });

  it('ZT-05 fail: conflictResolutionTrace fail_open_unresolved absent from selectorPhase.unresolvedConflicts', () => {
    // c9 appears in conflictResolutionTrace but NOT in selectorPhase.unresolvedConflicts
    const trace = {
      selectorPhase: { unresolvedConflicts: [] },
      conflictPhase: {
        resolvedDecisions: [],
        conflictResolutionTrace: [
          {
            componentId: 'c9',
            resolutionRule: 'fail_open_unresolved',
            finalAction: 'include',
            finalPath: 'fail_open',
            warningsEmitted: ['unresolved_conflict_fail_open'],
          },
        ],
      },
    };
    const r = checkZT05FailOpenUnresolved(trace as Record<string, unknown>);
    expect(r.passed).toBe(false);
    expect(r.message).toContain('selectorPhase.unresolvedConflicts');
    expect(r.message).toContain('c9');
  });

  it('ZT-08 pass: no cross-partition duplicates', () => {
    const plan = {
      selectedComponents: [{ componentId: 'a' }],
      omittedComponents: [{ componentId: 'b' }],
      deferredComponents: [{ componentId: 'c' }],
    };
    const r = checkZT08PartitionExclusivity(plan as Record<string, unknown>);
    expect(r.passed).toBe(true);
  });

  it('ZT-08 fail: component in two partitions', () => {
    const plan = {
      selectedComponents: [{ componentId: 'a' }],
      omittedComponents: [{ componentId: 'a' }],
      deferredComponents: [],
    };
    const r = checkZT08PartitionExclusivity(plan as Record<string, unknown>);
    expect(r.passed).toBe(false);
    expect(r.message).toContain('a');
  });

  it('ZT-09 pass: all deferred have path', () => {
    const plan = {
      deferredComponents: [
        { componentId: 'c1', path: 'runtime_unavailable_defer' },
      ],
    };
    const r = checkZT09DeferredPath(plan as Record<string, unknown>);
    expect(r.passed).toBe(true);
  });

  it('ZT-09 fail: deferred missing path', () => {
    const plan = {
      deferredComponents: [
        { componentId: 'c1' }, // no path field
      ],
    };
    const r = checkZT09DeferredPath(plan as Record<string, unknown>);
    expect(r.passed).toBe(false);
  });

  // ZT-12: must validate both resolvedDecisions[] and conflictResolutionTrace[]

  it('ZT-12 fail: invalid resolutionRule in resolvedDecisions', () => {
    const trace = {
      conflictPhase: {
        resolvedDecisions: [
          { componentId: 'c2', resolutionRule: 'budget_trim' }, // invalid
        ],
        conflictResolutionTrace: [],
      },
    };
    const r = checkZT12ResolutionRuleEnum(trace as Record<string, unknown>);
    expect(r.passed).toBe(false);
    expect(r.message).toContain('budget_trim');
    expect(r.message).toContain('resolvedDecisions');
  });

  it('ZT-12 pass: all canonical rules in resolvedDecisions and empty conflictResolutionTrace', () => {
    const trace = {
      conflictPhase: {
        resolvedDecisions: [
          { componentId: 'c1', resolutionRule: 'no_conflict' },
          { componentId: 'c2', resolutionRule: 'fail_open_unresolved' },
        ],
        conflictResolutionTrace: [],
      },
    };
    const r = checkZT12ResolutionRuleEnum(trace as Record<string, unknown>);
    expect(r.passed).toBe(true);
  });

  it('ZT-12 fail: invalid resolutionRule in conflictResolutionTrace', () => {
    // R4 blocker: ZT-12 must also check conflictResolutionTrace[].resolutionRule
    const trace = {
      conflictPhase: {
        resolvedDecisions: [
          { componentId: 'c1', resolutionRule: 'no_conflict' }, // valid
        ],
        conflictResolutionTrace: [
          { componentId: 'c2', resolutionRule: 'custom_invented_rule' }, // invalid
        ],
      },
    };
    const r = checkZT12ResolutionRuleEnum(trace as Record<string, unknown>);
    expect(r.passed).toBe(false);
    expect(r.message).toContain('custom_invented_rule');
    expect(r.message).toContain('conflictResolutionTrace');
  });

  it('ZT-12 pass: canonical rules in both resolvedDecisions and conflictResolutionTrace', () => {
    const trace = {
      conflictPhase: {
        resolvedDecisions: [
          { componentId: 'c1', resolutionRule: 'multiple_include_merged' },
        ],
        conflictResolutionTrace: [
          { componentId: 'c2', resolutionRule: 'path_a_omit_selected_over_path_b' },
        ],
      },
    };
    const r = checkZT12ResolutionRuleEnum(trace as Record<string, unknown>);
    expect(r.passed).toBe(true);
  });

  it('ZT-13 pass: valid narrative', () => {
    const trace = {
      selectorPhase: {
        selectorSummary: {
          narrative: '10 components evaluated. 6 included, 2 omitted, 2 deferred (1 default, 1 runtime-unavailable), 0 fail-open. 0 conflict(s) identified.',
        },
      },
    };
    const r = checkZT13NarrativeTemplate(trace as Record<string, unknown>);
    expect(r.passed).toBe(true);
  });

  it('ZT-13 fail: narrative does not match template', () => {
    const trace = {
      selectorPhase: {
        selectorSummary: {
          narrative: 'Everything is fine, 10 components.',
        },
      },
    };
    const r = checkZT13NarrativeTemplate(trace as Record<string, unknown>);
    expect(r.passed).toBe(false);
  });

  it('ZT-15 pass: exit code 0', () => {
    expect(checkZT15ExitCode(0).passed).toBe(true);
  });

  it('ZT-15 fail: exit code 1', () => {
    expect(checkZT15ExitCode(1).passed).toBe(false);
  });

  // ZT-03: forbidden field names

  it('ZT-03: ZT-03 forbidden field names from Phase 12 R4 §12.3 fail when present', () => {
    const FORBIDDEN = [
      'rawRequestText', 'rawHistoryContent', 'rawComponentContent', 'componentBody',
      'componentText', 'historyContent', 'rawContent',
      'requestText', 'rawRequest', 'userText', 'body', 'turnContent', 'rawTurnContent', 'inline',
    ];
    for (const fieldName of FORBIDDEN) {
      const trace = { [fieldName]: 'some value that should not be here' };
      const r = checkZT03NoRawContent(trace as Record<string, unknown>);
      expect(r.passed, `Expected ZT-03 to fail for forbidden field '${fieldName}'`).toBe(false);
      expect(r.message).toContain(fieldName);
    }
  });

  it('ZT-03: field "content" at any nesting depth fails ZT-03', () => {
    // 'content' is in the forbidden set — must fail even when nested
    const trace = {
      requestPhase: {
        content: 'some user text here',
      },
    };
    const r = checkZT03NoRawContent(trace as Record<string, unknown>);
    expect(r.passed).toBe(false);
    expect(r.message).toContain('content');
  });

  it('RG-01 pass: no null-budgetHint in trimOrder', () => {
    const trace = {
      budgetPhase: {
        budgetReport: {
          trimOrder: [
            { componentId: 'c1', budgetHint: 'soft' },
            { componentId: 'c2', budgetHint: 'hard' },
          ],
        },
      },
    };
    const r = checkRG01TrimOrderNoNullHint(trace as Record<string, unknown>);
    expect(r.passed).toBe(true);
  });

  it('RG-01 fail: null-budgetHint entry in trimOrder', () => {
    const trace = {
      budgetPhase: {
        budgetReport: {
          trimOrder: [
            { componentId: 'c1', budgetHint: null },
          ],
        },
      },
    };
    const r = checkRG01TrimOrderNoNullHint(trace as Record<string, unknown>);
    expect(r.passed).toBe(false);
    expect(r.message).toContain('c1');
  });

  // RG-02: context is NOT a schema-defined field (additionalProperties: false)

  it('RG-02 pass: warning with only code and message', () => {
    const trace = {
      warnings: [
        { code: 'runtime_capabilities_missing', message: 'Runtime missing.' },
      ],
    };
    const r = checkRG02PlanningWarningsShape(trace as Record<string, unknown>);
    expect(r.passed).toBe(true);
  });

  it('RG-02 pass: warning with code, message, and componentId', () => {
    const trace = {
      warnings: [
        { code: 'active_id_unknown', message: 'Unknown ID.', componentId: 'skill.foo' },
      ],
    };
    const r = checkRG02PlanningWarningsShape(trace as Record<string, unknown>);
    expect(r.passed).toBe(true);
  });

  it('RG-02 fail: warning with "context" extra field (context is not in schema)', () => {
    // The planning-warning.schema.json has additionalProperties: false.
    // Only code, message, componentId are allowed. 'context' is a forbidden extra field.
    const trace = {
      warnings: [
        { code: 'runtime_capabilities_missing', message: 'Runtime missing.', context: { path: '/foo' } },
      ],
    };
    const r = checkRG02PlanningWarningsShape(trace as Record<string, unknown>);
    expect(r.passed).toBe(false);
    expect(r.message).toContain('context');
  });

  it('RG-02 fail: warning with any other extra field', () => {
    const trace = {
      warnings: [
        { code: 'schema_invalid', message: 'Schema error.', details: 'some extra detail', extra: true },
      ],
    };
    const r = checkRG02PlanningWarningsShape(trace as Record<string, unknown>);
    expect(r.passed).toBe(false);
    expect(r.message).toMatch(/details|extra/);
  });

  it('RS-M pass: matching requestPhase', () => {
    const trace = {
      requestPhase: {
        promptFamily: 'general_default',
        familyConfidence: 0.4,
        injectionSuspectFlag: true,
      },
    };
    const fixtureSignals = {
      promptFamily: 'general_default',
      familyConfidence: 0.4,
      injectionSuspect: true,
    };
    const r = checkRSMRequestSignalsMatch(
      trace as Record<string, unknown>,
      fixtureSignals as Record<string, unknown>,
    );
    expect(r.passed).toBe(true);
  });

  it('RS-M fail: injectionSuspectFlag mismatch', () => {
    const trace = {
      requestPhase: {
        promptFamily: 'general_default',
        familyConfidence: 0.4,
        injectionSuspectFlag: false,  // mismatch: fixture has true
      },
    };
    const fixtureSignals = {
      promptFamily: 'general_default',
      familyConfidence: 0.4,
      injectionSuspect: true,
    };
    const r = checkRSMRequestSignalsMatch(
      trace as Record<string, unknown>,
      fixtureSignals as Record<string, unknown>,
    );
    expect(r.passed).toBe(false);
    expect(r.message).toContain('injectionSuspectFlag');
  });

  it('comparePartitions: matching → match: true', () => {
    const plan = {
      selectedComponents: [{ componentId: 'a' }, { componentId: 'b' }],
      omittedComponents: [{ componentId: 'c' }],
      deferredComponents: [],
    };
    const result = comparePartitions(
      plan as Record<string, unknown>,
      plan as Record<string, unknown>,
    );
    expect(result.match).toBe(true);
  });

  it('comparePartitions: mismatched selected → match: false', () => {
    const planA = { selectedComponents: [{ componentId: 'a' }], omittedComponents: [], deferredComponents: [] };
    const planB = { selectedComponents: [{ componentId: 'b' }], omittedComponents: [], deferredComponents: [] };
    const result = comparePartitions(
      planA as Record<string, unknown>,
      planB as Record<string, unknown>,
    );
    expect(result.match).toBe(false);
  });

  it('comparePhaseKeys: exact match → match: true', () => {
    const traceA = { run: {}, requestPhase: {}, registryPhase: {}, selectorPhase: {}, conflictPhase: {}, budgetPhase: {}, planPhase: {}, warnings: [] };
    const result = comparePhaseKeys(traceA, traceA);
    expect(result.match).toBe(true);
    expect(result.extraInGenerated).toHaveLength(0);
    expect(result.missingFromGenerated).toHaveLength(0);
  });

  it('comparePhaseKeys: extra key in generated → match: false', () => {
    const expected = { run: {}, requestPhase: {}, registryPhase: {}, selectorPhase: {}, conflictPhase: {}, budgetPhase: {}, planPhase: {}, warnings: [] };
    const generated = { ...expected, extraField: 'bad' };
    const result = comparePhaseKeys(generated, expected);
    expect(result.match).toBe(false);
    expect(result.extraInGenerated).toContain('extraField');
  });

  it('selectorTrace decisionId uniqueness — duplicate detection logic', () => {
    // Validate the uniqueness check logic: two entries with the same decisionId
    // should be detectable by comparing Set size to array length.
    const selectorTrace = [
      { decisionId: 'dec-1' },
      { decisionId: 'dec-1' }, // duplicate
    ];
    const uniqueIds = new Set(selectorTrace.map((e) => e.decisionId));
    // Duplicate detected: set is smaller than array
    expect(uniqueIds.size).toBeLessThan(selectorTrace.length);
  });
});

// ---------------------------------------------------------------------------
// Group H-S — Static validation (Mode 1 only) for selected fixtures
// ---------------------------------------------------------------------------

describe('H-S — Static validation of fixture layout', () => {

  it('H-S1: family-confidence-escalation fixture has all required input files', () => {
    const inputsDir = resolve(FIXTURES_DIR, '12-injection-gate/family-confidence-escalation/inputs');
    const REQUIRED = [
      'active-ids.json', 'budget-state.json', 'component-registry.json',
      'history-state-summary.json', 'request-signals.json', 'runtime-capabilities.json',
      'selector-policy.json', 'user-constraints.json',
    ];
    for (const f of REQUIRED) {
      expect(existsSync(join(inputsDir, f)), `Missing: ${f}`).toBe(true);
    }
  });

  it('H-S2: request-signals.json is AJV-valid for family-confidence-escalation', () => {
    const rsPath = resolve(FIXTURES_DIR, '12-injection-gate/family-confidence-escalation/inputs/request-signals.json');
    const data = JSON.parse(readFileSync(rsPath, 'utf8'));
    const valid = validateRequestSignals(data);
    expect(valid).toBe(true);
  });

  it('H-S3: request-signals.json is AJV-valid for warn-and-continue-baseline', () => {
    const rsPath = resolve(FIXTURES_DIR, '12-injection-gate/warn-and-continue-baseline/inputs/request-signals.json');
    const data = JSON.parse(readFileSync(rsPath, 'utf8'));
    const valid = validateRequestSignals(data);
    expect(valid).toBe(true);
  });

  it('H-S4: all 18 fixture groups exist under fixtures/', () => {
    const EXPECTED_GROUPS = [
      '02-registry-validation', '03-candidate-set-summary', '04-active-ids',
      '05-selector-ladder', '05-selector-policy', '06-hard-protection',
      '07-path-a-omission', '08-path-b-omission', '09-reference-unknown',
      '10-runtime-unavailable', '11-capability-inventory-incomplete', '12-injection-gate',
      '13-conflict-resolution', '14-budget-behavior', '15-over-budget-protected',
      '16-partition-integrity', '17-trace-structure', '18-summary-narrative',
    ];
    for (const g of EXPECTED_GROUPS) {
      expect(existsSync(join(FIXTURES_DIR, g)), `Missing group: ${g}`).toBe(true);
    }
  });

  it('H-S5: family-confidence-escalation has injectionSuspect:true in request-signals.json', () => {
    const rsPath = resolve(FIXTURES_DIR, '12-injection-gate/family-confidence-escalation/inputs/request-signals.json');
    const data = JSON.parse(readFileSync(rsPath, 'utf8')) as Record<string, unknown>;
    expect(data['injectionSuspect']).toBe(true);
    expect(data['familyConfidence']).toBe(0.4);
    expect(data['promptFamily']).toBe('general_default');
  });
});

// ---------------------------------------------------------------------------
// Group H-F — Full harness run on fixtures corpus
// ---------------------------------------------------------------------------

describe('H-F — Full harness run on fixtures corpus', () => {

  it('H-F1: harness discovers all 28 fixture cases with no discovery errors', () => {
    const runner = makeTestRunner();
    const report = runHarness({
      fixturesDir: FIXTURES_DIR,
      runFixture: runner,
      validatePromptPlan,
      validateTrace,
      validateRequestSignals,
    });

    expect(report.fixtureDiscovery.totalCases).toBe(28);
    expect(report.fixtureDiscovery.discoveryErrors).toHaveLength(0);
  }, 300_000);

  it('H-F2: harness produces a complete EvaluationReport; Gate B status reported', () => {
    const runner = makeTestRunner();
    const report = runHarness({
      fixturesDir: FIXTURES_DIR,
      runFixture: runner,
      validatePromptPlan,
      validateTrace,
      validateRequestSignals,
    });

    // Report structure is complete
    expect(typeof report.reportId).toBe('string');
    expect(typeof report.timestamp).toBe('string');
    expect(report.harnessVersion).toBe('1.0.0');
    expect(report.mode).toBe('static+generated');
    expect(Array.isArray(report.perFixture)).toBe(true);
    expect(report.perFixture).toHaveLength(28);
    expect(Array.isArray(report.deferred)).toBe(true);
    expect(report.results.passed + report.results.failed + report.results.skipped + report.results.blocked).toBe(28);

    const { passed, failed, skipped, blocked } = report.results;

    // Gate B status: Gate B requires results.failed === 0 AND results.blocked === 0.
    // Approved-skipped fixtures (status: 'skipped') are allowed when they carry
    // validated skipApproval metadata; they do not count as failed or blocked.
    // If failed > 0 or blocked > 0, Gate B is NOT satisfied.
    const gateBSatisfied = failed === 0 && blocked === 0;
    const gateBStatus = gateBSatisfied
      ? (skipped > 0
          ? `[Gate B] SATISFIED WITH ${skipped} APPROVED SKIP(S)`
          : '[Gate B] SATISFIED — all fixtures pass')
      : `[Gate B] NOT SATISFIED — ${failed} fixture(s) failing, ${blocked} blocked (fixture corpus blockers, not harness bugs)`;

    console.info(
      `[H-F2] Fixture corpus: passed=${passed} failed=${failed} skipped=${skipped} blocked=${blocked}`,
    );
    console.info(`[H-F2] ${gateBStatus}`);

    // The harness must run and produce a valid report regardless of Gate B status.
    // Gate B satisfaction is tracked as an explicit assertion for Phase 13.
    // This test passes if the harness produces a valid report structure.
    // Gate B is NOT asserted here as passing; it is reported for status visibility.
    expect(report.results).toBeDefined();
  }, 300_000);

  it('H-F3: all successfully-run fixtures pass ZT-01 (schema validation)', () => {
    const runner = makeTestRunner();
    const report = runHarness({
      fixturesDir: FIXTURES_DIR,
      runFixture: runner,
      validatePromptPlan,
      validateTrace,
      validateRequestSignals,
    });

    // Only check fixtures where Mode 2 actually ran (generatedValidation is not null)
    // and the CLI exited 0 (cliExitCode === 0).
    const schemaFailures: string[] = [];
    for (const fx of report.perFixture) {
      if (!fx.generatedValidation || fx.cliExitCode !== 0) continue;
      // ZT-01 for trace
      if (!fx.generatedValidation.traceSchemaOk) {
        schemaFailures.push(`${fx.fixturePath}: trace schema invalid`);
      }
      // ZT-01 for prompt-plan
      if (!fx.generatedValidation.promptPlanSchemaOk) {
        schemaFailures.push(`${fx.fixturePath}: prompt-plan schema invalid`);
      }
    }

    expect(schemaFailures).toHaveLength(0);
  }, 300_000);

  it('H-F4: all successfully-run fixtures have no extra trace keys (ZT key set)', () => {
    const runner = makeTestRunner();
    const report = runHarness({
      fixturesDir: FIXTURES_DIR,
      runFixture: runner,
      validatePromptPlan,
      validateTrace,
      validateRequestSignals,
    });

    const keyErrors: string[] = [];
    for (const fx of report.perFixture) {
      if (!fx.generatedValidation || fx.cliExitCode !== 0) continue;
      if (!fx.semanticComparison?.phaseKeyComparison) continue;
      if (fx.semanticComparison.phaseKeyComparison.extraInGenerated.length > 0) {
        keyErrors.push(
          `${fx.fixturePath}: extra trace keys ${fx.semanticComparison.phaseKeyComparison.extraInGenerated.join(',')}`,
        );
      }
    }

    expect(keyErrors).toHaveLength(0);
  }, 300_000);

  it('H-F5: all successfully-run fixtures pass RS-M (requestSignals match)', () => {
    const runner = makeTestRunner();
    const report = runHarness({
      fixturesDir: FIXTURES_DIR,
      runFixture: runner,
      validatePromptPlan,
      validateTrace,
      validateRequestSignals,
    });

    const rsMismatches = report.perFixture.filter(
      (f) => f.cliExitCode === 0 && f.generatedValidation && !f.generatedValidation.requestSignalsMatch,
    );

    if (rsMismatches.length > 0) {
      expect.fail(`RS-M failures on successful runs: ${rsMismatches.map((f) => f.fixturePath).join(', ')}`);
    }
    expect(rsMismatches).toHaveLength(0);
  }, 300_000);
});

// ---------------------------------------------------------------------------
// Group H-DT — Determinism tests
// ---------------------------------------------------------------------------

describe('H-DT — Determinism tests (normalized trace comparison)', () => {

  // ---------------------------------------------------------------------------
  // H-DT-U — Direct unit tests of buildDeterminismResult (Option A)
  //
  // buildDeterminismResult is exported from harness-runner.ts specifically so
  // these tests can directly exercise all fail-fast guards without going
  // through runHarness or spawning the CLI.
  //
  // Each test creates real temp dirs, writes or omits the required files, and
  // calls buildDeterminismResult directly. normalizedMatch is asserted.
  // ---------------------------------------------------------------------------

  function makeTmpRunDir(): string {
    return mkdtempSync(join(tmpdir(), 'ctx-dt-u-'));
  }

  const MINIMAL_TRACE = JSON.stringify({
    run: { runId: '00000000-0000-0000-0000-000000000001', planningRunStartedAt: 't', planningRunCompletedAt: 't' },
    requestPhase: {}, registryPhase: {}, selectorPhase: { unresolvedConflicts: [], planningWarnings: [], selectorTrace: [], selectorSummary: { narrative: '0 components evaluated. 0 included, 0 omitted, 0 deferred (0 default, 0 runtime-unavailable), 0 fail-open. 0 conflict(s) identified.' } },
    conflictPhase: { resolvedDecisions: [], conflictResolutionTrace: [], noConflictComponentIds: [], planningWarnings: [] },
    budgetPhase: {}, planPhase: {}, warnings: [],
  });
  const MINIMAL_PP = JSON.stringify({ schemaVersion: '1.0.0', selectedComponents: [], omittedComponents: [], deferredComponents: [] });

  it('H-DT-U1: both runs exit non-zero => normalizedMatch: false', () => {
    const run1Dir = makeTmpRunDir();
    const run2Dir = makeTmpRunDir();
    // No output files written — both runs "fail"
    try {
      const result = buildDeterminismResult('test/fixture', { status: 1, outputDir: run1Dir }, { status: 1, outputDir: run2Dir });
      expect(result.normalizedMatch).toBe(false);
      expect(result.run1ContentHash).toContain('nonzero');
    } finally {
      rmSync(run1Dir, { recursive: true, force: true });
      rmSync(run2Dir, { recursive: true, force: true });
    }
  });

  it('H-DT-U2: run1 exits 0 but run2 exits non-zero => normalizedMatch: false', () => {
    const run1Dir = makeTmpRunDir();
    const run2Dir = makeTmpRunDir();
    writeFileSync(join(run1Dir, 'trace.json'), MINIMAL_TRACE, 'utf8');
    writeFileSync(join(run1Dir, 'prompt-plan.json'), MINIMAL_PP, 'utf8');
    // run2 has no outputs and fails
    try {
      const result = buildDeterminismResult('test/fixture', { status: 0, outputDir: run1Dir }, { status: 1, outputDir: run2Dir });
      expect(result.normalizedMatch).toBe(false);
      expect(result.run2ContentHash).toContain('nonzero');
    } finally {
      rmSync(run1Dir, { recursive: true, force: true });
      rmSync(run2Dir, { recursive: true, force: true });
    }
  });

  it('H-DT-U3: run1 missing trace.json => normalizedMatch: false', () => {
    const run1Dir = makeTmpRunDir();
    const run2Dir = makeTmpRunDir();
    // run1 has NO trace.json
    writeFileSync(join(run1Dir, 'prompt-plan.json'), MINIMAL_PP, 'utf8');
    writeFileSync(join(run2Dir, 'trace.json'), MINIMAL_TRACE, 'utf8');
    writeFileSync(join(run2Dir, 'prompt-plan.json'), MINIMAL_PP, 'utf8');
    try {
      const result = buildDeterminismResult('test/fixture', { status: 0, outputDir: run1Dir }, { status: 0, outputDir: run2Dir });
      expect(result.normalizedMatch).toBe(false);
      expect(result.run1ContentHash).toContain('trace-missing-run1');
    } finally {
      rmSync(run1Dir, { recursive: true, force: true });
      rmSync(run2Dir, { recursive: true, force: true });
    }
  });

  it('H-DT-U4: run2 missing trace.json => normalizedMatch: false', () => {
    const run1Dir = makeTmpRunDir();
    const run2Dir = makeTmpRunDir();
    writeFileSync(join(run1Dir, 'trace.json'), MINIMAL_TRACE, 'utf8');
    writeFileSync(join(run1Dir, 'prompt-plan.json'), MINIMAL_PP, 'utf8');
    // run2 has NO trace.json
    writeFileSync(join(run2Dir, 'prompt-plan.json'), MINIMAL_PP, 'utf8');
    try {
      const result = buildDeterminismResult('test/fixture', { status: 0, outputDir: run1Dir }, { status: 0, outputDir: run2Dir });
      expect(result.normalizedMatch).toBe(false);
      expect(result.run2ContentHash).toContain('trace-missing-run2');
    } finally {
      rmSync(run1Dir, { recursive: true, force: true });
      rmSync(run2Dir, { recursive: true, force: true });
    }
  });

  it('H-DT-U5: run1 missing prompt-plan.json => normalizedMatch: false', () => {
    const run1Dir = makeTmpRunDir();
    const run2Dir = makeTmpRunDir();
    // run1 has trace.json but NO prompt-plan.json
    writeFileSync(join(run1Dir, 'trace.json'), MINIMAL_TRACE, 'utf8');
    writeFileSync(join(run2Dir, 'trace.json'), MINIMAL_TRACE, 'utf8');
    writeFileSync(join(run2Dir, 'prompt-plan.json'), MINIMAL_PP, 'utf8');
    try {
      const result = buildDeterminismResult('test/fixture', { status: 0, outputDir: run1Dir }, { status: 0, outputDir: run2Dir });
      expect(result.normalizedMatch).toBe(false);
      expect(result.run1ContentHash).toContain('prompt-plan-missing-run1');
    } finally {
      rmSync(run1Dir, { recursive: true, force: true });
      rmSync(run2Dir, { recursive: true, force: true });
    }
  });

  it('H-DT-U6: run2 missing prompt-plan.json => normalizedMatch: false', () => {
    const run1Dir = makeTmpRunDir();
    const run2Dir = makeTmpRunDir();
    writeFileSync(join(run1Dir, 'trace.json'), MINIMAL_TRACE, 'utf8');
    writeFileSync(join(run1Dir, 'prompt-plan.json'), MINIMAL_PP, 'utf8');
    // run2 has trace.json but NO prompt-plan.json
    writeFileSync(join(run2Dir, 'trace.json'), MINIMAL_TRACE, 'utf8');
    try {
      const result = buildDeterminismResult('test/fixture', { status: 0, outputDir: run1Dir }, { status: 0, outputDir: run2Dir });
      expect(result.normalizedMatch).toBe(false);
      expect(result.run2ContentHash).toContain('prompt-plan-missing-run2');
    } finally {
      rmSync(run1Dir, { recursive: true, force: true });
      rmSync(run2Dir, { recursive: true, force: true });
    }
  });

  it('H-DT-U7: trace.json parse error => normalizedMatch: false', () => {
    const run1Dir = makeTmpRunDir();
    const run2Dir = makeTmpRunDir();
    writeFileSync(join(run1Dir, 'trace.json'), 'NOT VALID JSON {{{', 'utf8');
    writeFileSync(join(run1Dir, 'prompt-plan.json'), MINIMAL_PP, 'utf8');
    writeFileSync(join(run2Dir, 'trace.json'), MINIMAL_TRACE, 'utf8');
    writeFileSync(join(run2Dir, 'prompt-plan.json'), MINIMAL_PP, 'utf8');
    try {
      const result = buildDeterminismResult('test/fixture', { status: 0, outputDir: run1Dir }, { status: 0, outputDir: run2Dir });
      expect(result.normalizedMatch).toBe(false);
      expect(result.run1ContentHash).toContain('trace-parse-error-run1');
    } finally {
      rmSync(run1Dir, { recursive: true, force: true });
      rmSync(run2Dir, { recursive: true, force: true });
    }
  });

  it('H-DT-U8: valid equal normalized outputs => normalizedMatch: true', () => {
    // Confirms that the happy path works: two runs with identical content
    // (but different UUIDs and timestamps) produce normalizedMatch: true.
    const run1Dir = makeTmpRunDir();
    const run2Dir = makeTmpRunDir();
    // Use different UUIDs in each trace to prove normalization handles them.
    const trace1 = JSON.stringify({
      run: { runId: 'aaaaaaaa-0000-0000-0000-000000000001', planningRunStartedAt: 't1', planningRunCompletedAt: 't1' },
      requestPhase: {}, registryPhase: {},
      selectorPhase: { selectorTrace: [{ decisionId: 'bbbbbbbb-0000-0000-0000-000000000001' }], unresolvedConflicts: [], planningWarnings: [], selectorSummary: { narrative: '0 components evaluated. 0 included, 0 omitted, 0 deferred (0 default, 0 runtime-unavailable), 0 fail-open. 0 conflict(s) identified.' } },
      conflictPhase: { resolvedDecisions: [], conflictResolutionTrace: [], noConflictComponentIds: [], planningWarnings: [] },
      budgetPhase: {}, planPhase: {}, warnings: [],
    });
    const trace2 = JSON.stringify({
      run: { runId: 'cccccccc-0000-0000-0000-000000000001', planningRunStartedAt: 't2', planningRunCompletedAt: 't2' },
      requestPhase: {}, registryPhase: {},
      selectorPhase: { selectorTrace: [{ decisionId: 'dddddddd-0000-0000-0000-000000000001' }], unresolvedConflicts: [], planningWarnings: [], selectorSummary: { narrative: '0 components evaluated. 0 included, 0 omitted, 0 deferred (0 default, 0 runtime-unavailable), 0 fail-open. 0 conflict(s) identified.' } },
      conflictPhase: { resolvedDecisions: [], conflictResolutionTrace: [], noConflictComponentIds: [], planningWarnings: [] },
      budgetPhase: {}, planPhase: {}, warnings: [],
    });
    writeFileSync(join(run1Dir, 'trace.json'), trace1, 'utf8');
    writeFileSync(join(run1Dir, 'prompt-plan.json'), MINIMAL_PP, 'utf8');
    writeFileSync(join(run2Dir, 'trace.json'), trace2, 'utf8');
    writeFileSync(join(run2Dir, 'prompt-plan.json'), MINIMAL_PP, 'utf8');
    try {
      const result = buildDeterminismResult('test/fixture', { status: 0, outputDir: run1Dir }, { status: 0, outputDir: run2Dir });
      // Different UUIDs/timestamps but identical structure => normalizedMatch: true
      expect(result.normalizedMatch).toBe(true);
      expect(result.run1ContentHash).toBe(result.run2ContentHash);
    } finally {
      rmSync(run1Dir, { recursive: true, force: true });
      rmSync(run2Dir, { recursive: true, force: true });
    }
  });

  // Also verify normalizeTraceForDeterminism is exported and works
  it('normalizeTraceForDeterminism: strips timestamps and normalizes UUIDs', () => {
    const trace: Record<string, unknown> = {
      run: { runId: 'aaaaaaaa-0000-0000-0000-000000000001', planningRunStartedAt: '2026-01-01T00:00:00Z', planningRunCompletedAt: '2026-01-01T00:00:01Z' },
    };
    const normalized = normalizeTraceForDeterminism(trace);
    expect(normalized).toContain('<TIMESTAMP>');
    expect(normalized).not.toContain('2026-01-01');
    expect(normalized).toContain('<uuid-0>');
    expect(normalized).not.toContain('aaaaaaaa-0000-0000-0000-000000000001');
  });

  /**
   * H-DT1: Integration determinism check on family-confidence-escalation.
   *
   * The harness also contains direct unit coverage for determinism fail-fast
   * guards via H-DT-U tests.
   *
   * Approved-skipped fixtures are excluded from corpus-level determinism checks.
   * Fixture 13 (safety-beats-omit) is architecturally unreachable through the
   * current MVP E2E selector routing and is covered by SHP-1 in the conflict
   * resolver unit tests.
   *
   * This integration test asserts determinism on one known-passing E2E fixture.
   */
  it('H-DT1: family-confidence-escalation produces identical normalized traces on two runs', () => {
    const runner = makeTestRunner();
    const fixtureInputsDir = resolve(FIXTURES_DIR, '12-injection-gate/family-confidence-escalation/inputs');

    const run1 = runner(fixtureInputsDir);
    const run2 = runner(fixtureInputsDir);

    try {
      expect(run1.status, `run1 failed: ${run1.stderr}`).toBe(0);
      expect(run2.status, `run2 failed: ${run2.stderr}`).toBe(0);

      // Use buildDeterminismResult directly for the assertion
      const result = buildDeterminismResult('12-injection-gate/family-confidence-escalation', run1, run2);
      expect(result.normalizedMatch, `Determinism failed: run1Hash=${result.run1ContentHash} run2Hash=${result.run2ContentHash}`).toBe(true);
    } finally {
      try { rmSync(run1.outputDir, { recursive: true, force: true }); } catch { /* ignore */ }
      try { rmSync(run2.outputDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Group H-SK — Approved-skip validation
// ---------------------------------------------------------------------------

/** Write content to a temp skip-reason.json and return the path. */
function writeSkipFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ctx-skip-unit-'));
  const filePath = join(dir, 'skip-reason.json');
  writeFileSync(filePath, content, 'utf8');
  return filePath;
}

/** Valid skip-reason.json content for reuse. */
const VALID_SKIP_JSON = JSON.stringify({
  reason: 'Test reason for skip',
  approvedBy: 'user',
  approvedDate: '2026-06-02',
  unitTestCoverage: 'tests/phase8/conflict-resolver.test.ts SHP-1',
});

describe('H-SK — Approved-skip validation', () => {

  // --- Unit tests: validateSkipReason directly ---

  it('SK-1: valid skip-reason.json returns valid=true with full SkipApproval', () => {
    const filePath = writeSkipFile(VALID_SKIP_JSON);
    const result = validateSkipReason(filePath);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.reason).toBe('Test reason for skip');
      expect(result.data.approvedBy).toBe('user');
      expect(result.data.approvedDate).toBe('2026-06-02');
      expect(result.data.unitTestCoverage).toContain('SHP-1');
    }
  });

  it('SK-2: invalid JSON returns valid=false with error mentioning "not valid JSON"', () => {
    const filePath = writeSkipFile('{not valid json');
    const result = validateSkipReason(filePath);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('not valid JSON');
  });

  it('SK-3: missing reason field returns valid=false', () => {
    const data = JSON.parse(VALID_SKIP_JSON);
    delete data.reason;
    const filePath = writeSkipFile(JSON.stringify(data));
    const result = validateSkipReason(filePath);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('reason');
  });

  it('SK-4: missing approvedBy field returns valid=false', () => {
    const data = JSON.parse(VALID_SKIP_JSON);
    delete data.approvedBy;
    const filePath = writeSkipFile(JSON.stringify(data));
    const result = validateSkipReason(filePath);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('approvedBy');
  });

  it('SK-5: missing approvedDate field returns valid=false', () => {
    const data = JSON.parse(VALID_SKIP_JSON);
    delete data.approvedDate;
    const filePath = writeSkipFile(JSON.stringify(data));
    const result = validateSkipReason(filePath);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('approvedDate');
  });

  it('SK-6: invalid approvedDate format returns valid=false (non-ISO string)', () => {
    const data = JSON.parse(VALID_SKIP_JSON);
    data.approvedDate = 'June 2nd 2026';
    const filePath = writeSkipFile(JSON.stringify(data));
    const result = validateSkipReason(filePath);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('YYYY-MM-DD');
  });

  it('SK-6b: approvedDate with trailing junk returns valid=false (anchored regex)', () => {
    const data = JSON.parse(VALID_SKIP_JSON);
    data.approvedDate = '2026-06-02junk';
    const filePath = writeSkipFile(JSON.stringify(data));
    const result = validateSkipReason(filePath);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('YYYY-MM-DD');
  });

  it('SK-7: missing unitTestCoverage field returns valid=false', () => {
    const data = JSON.parse(VALID_SKIP_JSON);
    delete data.unitTestCoverage;
    const filePath = writeSkipFile(JSON.stringify(data));
    const result = validateSkipReason(filePath);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('unitTestCoverage');
  });

  it('SK-8a: unitTestCoverage without SHP-1 returns valid=false', () => {
    const data = JSON.parse(VALID_SKIP_JSON);
    data.unitTestCoverage = 'tests/phase8/conflict-resolver.test.ts';
    const filePath = writeSkipFile(JSON.stringify(data));
    const result = validateSkipReason(filePath);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('SHP-1');
  });

  it('SK-8b: unitTestCoverage with SHP-1 but wrong file path returns valid=false', () => {
    const data = JSON.parse(VALID_SKIP_JSON);
    data.unitTestCoverage = 'tests/phase9/some-other-test.ts SHP-1';
    const filePath = writeSkipFile(JSON.stringify(data));
    const result = validateSkipReason(filePath);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('tests/phase8/conflict-resolver.test.ts');
  });

  it('SK-9: invalid approvedBy value returns valid=false', () => {
    const data = JSON.parse(VALID_SKIP_JSON);
    data.approvedBy = 'unauthorized';
    const filePath = writeSkipFile(JSON.stringify(data));
    const result = validateSkipReason(filePath);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('not an allowed value');
  });

  // --- Integration tests ---

  it('SK-10: real fixture corpus with skip-reason.json produces skipped=1 failed=0 blocked=0', () => {
    const runner = makeTestRunner();
    const report = runHarness({
      fixturesDir: FIXTURES_DIR,
      runFixture: runner,
      validatePromptPlan,
      validateTrace,
      validateRequestSignals,
    });

    const skippedFixture = report.perFixture.find(
      f => f.fixturePath.includes('safety-beats-omit'),
    );
    expect(skippedFixture).toBeDefined();
    expect(skippedFixture!.status).toBe('skipped');
    expect(skippedFixture!.skipApproval).toBeDefined();
    expect(skippedFixture!.skipApproval!.reason).toContain('safety_hard_protection');
    expect(skippedFixture!.skipApproval!.approvedBy).toBe('user');
    expect(skippedFixture!.skipApproval!.approvedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(skippedFixture!.skipApproval!.unitTestCoverage).toContain('SHP-1');

    // Accounting
    expect(report.results.failed).toBe(0);
    expect(report.results.blocked).toBe(0);
    expect(report.results.skipped).toBe(1);
    expect(report.results.passed).toBe(27);
    expect(report.results.passed + report.results.skipped).toBe(28);
  }, 300_000);

  it('SK-11: valid skip-reason.json with static validation errors produces blocked, not skipped', () => {
    // Synthetic fixture with valid skip-reason.json but missing component-registry.json.
    // Static layout check fails => fixture must be blocked, not skipped.
    const tempDir = mkdtempSync(join(tmpdir(), 'ctx-skip-static-'));
    const groupDir = join(tempDir, '99-skip-static-test');
    const caseDir = join(groupDir, 'broken-with-skip');
    const inputsDir = join(caseDir, 'inputs');
    const expectedDir = join(caseDir, 'expected');
    mkdirSync(inputsDir, { recursive: true });
    mkdirSync(expectedDir, { recursive: true });

    // Write required input files EXCEPT component-registry.json (layout breaks).
    for (const f of [
      'active-ids.json', 'budget-state.json',
      'history-state-summary.json', 'request-signals.json',
      'runtime-capabilities.json', 'selector-policy.json', 'user-constraints.json',
    ]) {
      writeFileSync(join(inputsDir, f), '{}', 'utf8');
    }
    // component-registry.json intentionally missing — layout will fail.

    // Write required expected files.
    writeFileSync(join(expectedDir, 'assertions.md'), '# Assertions\n', 'utf8');
    writeFileSync(join(expectedDir, 'prompt-plan.json'), '{}', 'utf8');
    writeFileSync(join(expectedDir, 'trace.json'), '{}', 'utf8');

    // Write a fully valid skip-reason.json.
    writeFileSync(join(inputsDir, 'skip-reason.json'), VALID_SKIP_JSON, 'utf8');

    const runner = makeTestRunner();
    const report = runHarness({
      fixturesDir: tempDir,
      runFixture: runner,
      validatePromptPlan,
      validateTrace,
      validateRequestSignals,
    });

    const result = report.perFixture.find(f => f.fixturePath.includes('broken-with-skip'));
    expect(result).toBeDefined();

    // Must be blocked, not skipped. Static errors override valid skip.
    expect(result!.status).toBe('blocked');
    expect(result!.skipApproval).toBeUndefined();

    // Accounting
    expect(report.results.blocked).toBe(1);
    expect(report.results.skipped).toBe(0);
  });
});
