/**
 * Phase 12: Harness report builder.
 *
 * No I/O, no AJV, no file reads/writes. Not strictly pure — uses randomUUID()
 * for reportId and new Date() for timestamp, both of which are non-deterministic.
 * Receives an array of PerFixtureResult and DeterminismResult objects
 * and assembles the EvaluationReport. The caller (harness-runner.ts or
 * evaluate.ts) writes the report to disk.
 *
 * Canonical: docs/12 Phase 12 R4 §3 (harness-report: no I/O).
 */

import { randomUUID } from 'node:crypto';
import type { EvaluationReport, PerFixtureResult, DeterminismResult } from '../types/harness.js';

// ---------------------------------------------------------------------------
// Deferred items — surfaced in every report
// ---------------------------------------------------------------------------

const DEFERRED_ITEMS = [
  'Branch C WARN_AND_CONTINUE_OVERRIDE_DESIGN_DEFERRED',
  'unknown_cost budget hint fixture (schema gap)',
  'expected/summary.md fixture files (no current fixture has one)',
  'assertions.md machine-readable syntax (future)',
  'Report JSON Schema (future formalization)',
];

// ---------------------------------------------------------------------------
// buildEvaluationReport
// ---------------------------------------------------------------------------

/**
 * Assemble the EvaluationReport from all fixture results and determinism checks.
 *
 * No I/O / no AJV. Generates non-deterministic report metadata (randomUUID
 * for reportId, new Date() for timestamp).
 */
export function buildEvaluationReport(
  perFixture: PerFixtureResult[],
  determinismChecks: DeterminismResult[],
  fixtureDiscovery: {
    totalCases: number;
    totalFiles: number;
    discoveryErrors: string[];
  },
): EvaluationReport {
  const passed = perFixture.filter((f) => f.status === 'passed').length;
  const failed = perFixture.filter((f) => f.status === 'failed').length;
  const skipped = perFixture.filter((f) => f.status === 'skipped').length;
  const blocked = perFixture.filter((f) => f.status === 'blocked').length;

  return {
    reportId: randomUUID(),
    timestamp: new Date().toISOString(),
    harnessVersion: '1.0.0',
    mode: 'static+generated',
    fixtureDiscovery,
    results: { passed, failed, skipped, blocked },
    perFixture,
    determinismChecks,
    deferred: DEFERRED_ITEMS,
  };
}
