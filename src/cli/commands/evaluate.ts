/**
 * Phase 12: `context-plane evaluate` CLI command.
 *
 * Thin Commander wrapper. Injects a runtime-safe RunFixtureFn and calls
 * runHarness. Writes the EvaluationReport JSON to disk. Exits 0 if no
 * fixtures failed or blocked (approved-skipped fixtures are allowed and
 * explicitly reported). Exits 1 if any fixture failed, blocked, or a
 * discovery error occurred.
 *
 * Runtime RunFixtureFn uses:
 *   process.execPath     — exact Node.js binary path
 *   process.execArgv     — preserves --import tsx/esm, --require hooks, etc.
 *   process.argv[1]      — the entry point (dist/cli/index.js OR src/cli/index.ts)
 *
 * This approach is runtime-safe:
 *   compiled:   process.execArgv is empty   → node dist/cli/index.js plan ...
 *   tsx/dev:    process.execArgv has flags  → node --import tsx/esm src/cli/index.ts plan ...
 *   No tsx/esm is hardcoded in this module.
 *
 * Canonical: docs/12 Phase 12 R4 §4 (runtime-safe RunFixtureFn).
 */

import { Command } from 'commander';
import { writeFileSync, mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import type { RunFixtureFn, FixtureRunResult } from '../../types/harness.js';
import { runHarness } from '../../core/harness-runner.js';
import {
  getPromptPlanValidator,
  getTraceValidator,
  getRequestSignalsValidator,
} from '../../core/harness-ajv.js';

// ---------------------------------------------------------------------------
// Runtime RunFixtureFn — injected by this module
// ---------------------------------------------------------------------------

/**
 * Build a runtime-safe RunFixtureFn.
 *
 * Uses process.execPath + process.execArgv + process.argv[1] so that Node.js
 * loader flags (e.g., --import tsx/esm from the parent invocation) are
 * preserved in the child subprocess.
 *
 * A placeholder request.txt is synthesized in the runDir because the plan
 * command requires --request. The actual planning signal comes from
 * --request-signals which bypasses the MVP normalizer stub.
 */
function makeRuntimeRunner(): RunFixtureFn {
  return (fixtureInputsDir: string): FixtureRunResult => {
    const runDir = mkdtempSync(join(tmpdir(), 'ctx-plane-evaluate-'));
    const requestTxtPath = join(runDir, 'request.txt');
    writeFileSync(requestTxtPath, 'fixture harness placeholder request\n', 'utf8');

    // Build fixture input flag values — only include files that exist
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
      process.execPath,                       // exact Node.js binary path
      [
        ...process.execArgv,                  // preserves --import tsx/esm, --require hooks, etc.
        process.argv[1],                      // entry: dist/cli/index.js OR src/cli/index.ts
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
// evaluateCommand
// ---------------------------------------------------------------------------

export const evaluateCommand = new Command('evaluate')
  .description('Run the evaluation harness against fixture cases')
  .requiredOption('--fixtures <path>', 'Path to fixtures directory')
  .requiredOption('--report <path>', 'Path to write evaluation report JSON')
  .action((opts: { fixtures: string; report: string }) => {
    const fixturesDir = resolve(opts.fixtures);
    const reportPath = resolve(opts.report);

    // Ensure report directory exists
    const reportDir = dirname(reportPath);
    if (!existsSync(reportDir)) {
      mkdirSync(reportDir, { recursive: true });
    }

    // Build validators
    const validatePromptPlan = getPromptPlanValidator();
    const validateTrace = getTraceValidator();
    const validateRequestSignals = getRequestSignalsValidator();

    // Run harness
    const report = runHarness({
      fixturesDir,
      runFixture: makeRuntimeRunner(),
      validatePromptPlan,
      validateTrace,
      validateRequestSignals,
    });

    // Write report
    writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

    // Per-fixture detail output
    for (const fixture of report.perFixture) {
      process.stderr.write(`${fixture.fixturePath}:\n`);
      if (fixture.status === 'skipped' && fixture.skipApproval) {
        process.stderr.write(`  skipped: ${fixture.skipApproval.reason}\n`);
        process.stderr.write(`  approvedBy: ${fixture.skipApproval.approvedBy}\n`);
        process.stderr.write(`  approvedDate: ${fixture.skipApproval.approvedDate}\n`);
        process.stderr.write(`  unitTestCoverage: ${fixture.skipApproval.unitTestCoverage}\n`);
        continue;
      }
      if (fixture.status === 'blocked') {
        const errors = fixture.staticValidation?.errors ?? [];
        process.stderr.write(`  blocked: ${errors.join('; ') || 'unknown reason'}\n`);
        continue;
      }
      const semantic = fixture.semanticComparison?.status ?? 'n/a';
      process.stderr.write(`  semantic: ${semantic}\n`);
    }
    process.stderr.write('\n');

    // Summary to stderr
    const { passed, failed, skipped, blocked } = report.results;
    process.stderr.write(
      `context-plane evaluate: ${report.fixtureDiscovery.totalCases} fixtures — ` +
      `passed=${passed} failed=${failed} skipped=${skipped} blocked=${blocked}\n`,
    );

    // Gate B status
    if (failed === 0 && blocked === 0 && skipped === 0) {
      process.stderr.write('Gate B: SATISFIED — all fixtures pass\n');
    } else if (failed === 0 && blocked === 0 && skipped > 0) {
      process.stderr.write(
        `Gate B: SATISFIED WITH ${skipped} APPROVED SKIP(S) — ` +
        `all E2E-reachable fixtures pass; ${skipped} architecturally unreachable ` +
        `fixture(s) approved-skipped\n`,
      );
    } else if (blocked > 0) {
      process.stderr.write(
        `Gate B: NOT SATISFIED — ${blocked} fixture(s) blocked` +
        (failed > 0 ? `, ${failed} fixture(s) failing` : '') + '\n',
      );
    } else {
      process.stderr.write(
        `Gate B: NOT SATISFIED — ${failed} fixture(s) failing\n`,
      );
    }

    // Exit code: 0 if no fixtures failed or blocked (skipped is allowed); 1 otherwise
    if (failed > 0 || blocked > 0 || report.fixtureDiscovery.discoveryErrors.length > 0) {
      process.exit(1);
    }
    process.exit(0);
  });
