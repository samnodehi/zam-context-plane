/**
 * Phase 12 — --request-signals tests.
 *
 * Three groups:
 *   RS-L — input-loader unit tests (RS-L1–RS-L6)
 *   RS-N — request-normalizer unit tests (RS-N1–RS-N5)
 *   RS-C — CLI integration tests (RS-C1–RS-C4)
 *
 * Canonical: docs/12 Phase 12 R4 §5.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { loadInputs, loadRequestSignals } from '../../src/core/input-loader.js';
import { normalizeInputs } from '../../src/core/request-normalizer.js';
import type { LoadedInputs, RequestSignals } from '../../src/types/inputs.js';

// ---------------------------------------------------------------------------
// Test infrastructure
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

/** A minimal schema-valid component registry with one component. */
const MINIMAL_REGISTRY = JSON.stringify([
  {
    id: 'scaffold.test_component',
    type: 'scaffold',
    title: 'Test Component',
    summary: 'Minimal component for Phase 12 request-signals tests.',
    source: 'scaffold/test_component.md',
    tokensApprox: 100,
    charsApprox: 400,
    riskLevel: 'low',
    requiredWhen: [],
    safeToOmitWhen: [],
    defaultAction: 'include',
    omissionPolicy: 'allow',
    retainPolicy: 'optional',
    budgetPriority: 3,
    evidenceRequired: null,
    tags: ['test'],
    version: '1.0.0',
    hash: null,
  },
]);

/** Valid request-signals JSON: injectionSuspect true, familyConfidence 0.4. */
const VALID_REQUEST_SIGNALS: RequestSignals = {
  promptFamily: 'general_default',
  familyConfidence: 0.4,
  injectionSuspect: true,
};

const VALID_REQUEST_SIGNALS_JSON = JSON.stringify(VALID_REQUEST_SIGNALS);

/** Temp directory state — reset per test. */
let tmpDir: string;

afterEach(() => {
  if (tmpDir) {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function setup(): { req: string; reg: string } {
  tmpDir = mkdtempSync(join(tmpdir(), 'ctx-plane-p12-rs-'));
  const req = join(tmpDir, 'request.txt');
  const reg = join(tmpDir, 'registry.json');
  writeFileSync(req, 'Write me a function that reverses a string.');
  writeFileSync(reg, MINIMAL_REGISTRY);
  return { req, reg };
}

/** Build a minimal LoadedInputs usable with normalizeInputs. */
function makeLoadedInputs(overrides: Partial<LoadedInputs> = {}): LoadedInputs {
  return {
    requestText: 'What is the current system status?',
    registryRaw: [],
    activeIds: {
      activeSkillIds: [],
      activeToolIds: [],
      activeMemoryIds: [],
    },
    runtime: {
      availableToolIds: [],
      unavailableToolIds: [],
      capabilityInventoryComplete: false,
      runtimeLabel: 'test',
    },
    history: {
      lanesPresent: [],
      durableConstraintsPresent: false,
      openCommitmentsPresent: false,
      recentRawTurnCount: 0,
      totalHistoryTokensApprox: 0,
      historyMalformed: true,
    },
    budget: null,
    constraints: null,
    policy: {
      failOpenThreshold: 0.7,
      deterministicOnly: true,
      injectionSuspectAction: 'warn_and_continue',
    },
    requestSignals: null,
    warnings: [],
    ...overrides,
  };
}

/** Build a minimal RegistryResult for normalizeInputs. */
function makeRegistryResult(registeredIds: string[] = []) {
  const componentsById = new Map(registeredIds.map((id) => [id, { id }]));
  const indexes = {
    componentsById,
    componentsByType: new Map(),
    activeComponentsById: new Map(),
    candidateIds: new Set<string>(),
  };
  return {
    indexes,
    quarantinedComponents: [],
    validationWarnings: [],
  };
}

// ---------------------------------------------------------------------------
// Group RS-L — input-loader unit tests
// ---------------------------------------------------------------------------

describe('RS-L — loadRequestSignals unit tests', () => {

  // RS-L1: valid file → returns parsed RequestSignals with correct fields
  it('RS-L1: valid request-signals.json → parsed RequestSignals returned', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ctx-plane-p12-rs-'));
    const rsPath = join(tmpDir, 'request-signals.json');
    writeFileSync(rsPath, VALID_REQUEST_SIGNALS_JSON);
    const warnings: Array<{ code: string; message: string }> = [];

    const result = loadRequestSignals(rsPath, warnings);

    expect(result).not.toBeNull();
    expect(result?.promptFamily).toBe('general_default');
    expect(result?.familyConfidence).toBe(0.4);
    expect(result?.injectionSuspect).toBe(true);
    expect(warnings).toHaveLength(0);
  });

  // RS-L2: malformed JSON → returns null; request_signals_defaulted warning
  it('RS-L2: malformed JSON → null + request_signals_defaulted warning', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ctx-plane-p12-rs-'));
    const rsPath = join(tmpDir, 'request-signals.json');
    writeFileSync(rsPath, '{ not valid json }');
    const warnings: Array<{ code: string; message: string }> = [];

    const result = loadRequestSignals(rsPath, warnings);

    expect(result).toBeNull();
    expect(warnings.some((w) => w.code === 'request_signals_defaulted')).toBe(true);
  });

  // RS-L3: undefined (flag absent) → returns null; no warning
  it('RS-L3: flag absent (undefined) → null, no warning emitted', () => {
    const warnings: Array<{ code: string; message: string }> = [];

    const result = loadRequestSignals(undefined, warnings);

    expect(result).toBeNull();
    expect(warnings).toHaveLength(0);
  });

  // RS-L4: schema-invalid JSON (familyConfidence: 2.0 violates 0–1) → null + warning
  it('RS-L4: schema-invalid JSON → null + request_signals_defaulted warning', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ctx-plane-p12-rs-'));
    const rsPath = join(tmpDir, 'request-signals.json');
    writeFileSync(rsPath, JSON.stringify({
      promptFamily: 'general_default',
      familyConfidence: 2.0,   // invalid: must be 0–1
      injectionSuspect: false,
    }));
    const warnings: Array<{ code: string; message: string }> = [];

    const result = loadRequestSignals(rsPath, warnings);

    expect(result).toBeNull();
    expect(warnings.some((w) => w.code === 'request_signals_defaulted')).toBe(true);
  });

  // RS-L5: loadInputs with requestSignals option → loadedInputs.requestSignals is non-null
  it('RS-L5: loadInputs with --request-signals → requestSignals non-null in LoadedInputs', () => {
    const { req, reg } = setup();
    const rsPath = join(tmpDir, 'request-signals.json');
    writeFileSync(rsPath, VALID_REQUEST_SIGNALS_JSON);

    const result = loadInputs({ request: req, registry: reg, requestSignals: rsPath });

    expect(result.requestSignals).not.toBeNull();
    expect(result.requestSignals?.injectionSuspect).toBe(true);
    expect(result.requestSignals?.familyConfidence).toBe(0.4);
  });

  // RS-L6: loadInputs without requestSignals → loadedInputs.requestSignals is null
  it('RS-L6: loadInputs without --request-signals → requestSignals is null', () => {
    const { req, reg } = setup();

    const result = loadInputs({ request: req, registry: reg });

    expect(result.requestSignals).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Group RS-N — request-normalizer unit tests
// ---------------------------------------------------------------------------

describe('RS-N — request-normalizer bypass/stub behavior', () => {

  // RS-N1: non-null requestSignals → normalizedInputs.requestSignals equals provided object
  it('RS-N1: provided requestSignals used directly — values match exactly', () => {
    const loaded = makeLoadedInputs({ requestSignals: VALID_REQUEST_SIGNALS });
    const registry = makeRegistryResult();

    const result = normalizeInputs(loaded, registry);

    expect(result.requestSignals.promptFamily).toBe('general_default');
    expect(result.requestSignals.familyConfidence).toBe(0.4);
    expect(result.requestSignals.injectionSuspect).toBe(true);
  });

  // RS-N2: non-null requestSignals → prompt_family_defaulted NOT in warnings
  it('RS-N2: provided requestSignals → prompt_family_defaulted not emitted', () => {
    const loaded = makeLoadedInputs({ requestSignals: VALID_REQUEST_SIGNALS });
    const registry = makeRegistryResult();

    const result = normalizeInputs(loaded, registry);

    const codes = result.warnings.map((w) => w.code);
    expect(codes).not.toContain('prompt_family_defaulted');
  });

  // RS-N3: non-null requestSignals → active_id_unknown still emitted for unknown IDs
  it('RS-N3: provided requestSignals → active_id_unknown still emitted for unknown IDs', () => {
    const loaded = makeLoadedInputs({
      requestSignals: VALID_REQUEST_SIGNALS,
      activeIds: {
        activeSkillIds: ['skill.nonexistent'],
        activeToolIds: [],
        activeMemoryIds: [],
      },
    });
    const registry = makeRegistryResult([]); // empty registry — skill.nonexistent unknown

    const result = normalizeInputs(loaded, registry);

    expect(result.warnings.some((w) => w.code === 'active_id_unknown')).toBe(true);
  });

  // RS-N4: null requestSignals → always-stub output
  it('RS-N4: null requestSignals → stub produces general_default / 0.0 / false', () => {
    const loaded = makeLoadedInputs({ requestSignals: null });
    const registry = makeRegistryResult();

    const result = normalizeInputs(loaded, registry);

    expect(result.requestSignals.promptFamily).toBe('general_default');
    expect(result.requestSignals.familyConfidence).toBe(0.0);
    expect(result.requestSignals.injectionSuspect).toBe(false);
  });

  // RS-N5: null requestSignals → prompt_family_defaulted in warnings
  it('RS-N5: null requestSignals → prompt_family_defaulted warning emitted', () => {
    const loaded = makeLoadedInputs({ requestSignals: null });
    const registry = makeRegistryResult();

    const result = normalizeInputs(loaded, registry);

    expect(result.warnings.some((w) => w.code === 'prompt_family_defaulted')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Group RS-C — CLI integration tests
// ---------------------------------------------------------------------------

describe('RS-C — CLI integration with --request-signals', () => {
  const INJECTION_FIXTURE_INPUTS = resolve(
    __dirname,
    '../../fixtures/12-injection-gate/family-confidence-escalation/inputs',
  );

  // RS-C1: --request-signals with injectionSuspect:true → trace.requestPhase.injectionSuspectFlag === true
  it('RS-C1: family-confidence-escalation fixture → injectionSuspectFlag true in generated trace', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ctx-plane-p12-rs-'));
    const reqPath = join(tmpDir, 'request.txt');
    writeFileSync(reqPath, 'fixture harness request\n');

    const result = runCli([
      'plan',
      '--request',         reqPath,
      '--request-signals', join(INJECTION_FIXTURE_INPUTS, 'request-signals.json'),
      '--registry',        join(INJECTION_FIXTURE_INPUTS, 'component-registry.json'),
      '--active-ids',      join(INJECTION_FIXTURE_INPUTS, 'active-ids.json'),
      '--budget',          join(INJECTION_FIXTURE_INPUTS, 'budget-state.json'),
      '--history',         join(INJECTION_FIXTURE_INPUTS, 'history-state-summary.json'),
      '--runtime',         join(INJECTION_FIXTURE_INPUTS, 'runtime-capabilities.json'),
      '--policy',          join(INJECTION_FIXTURE_INPUTS, 'selector-policy.json'),
      '--constraints',     join(INJECTION_FIXTURE_INPUTS, 'user-constraints.json'),
      '--output-dir',      tmpDir,
    ]);

    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    expect(result.stderr).not.toContain('request_signals_defaulted');

    const traceJson = JSON.parse(readFileSync(join(tmpDir, 'trace.json'), 'utf8')) as Record<string, unknown>;
    const requestPhase = traceJson['requestPhase'] as Record<string, unknown>;
    expect(requestPhase['injectionSuspectFlag']).toBe(true);
  });

  // RS-C2: familyConfidence: 0.4 in request-signals → familyConfidence 0.4 in trace
  it('RS-C2: family-confidence-escalation fixture → familyConfidence 0.4 in generated trace', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ctx-plane-p12-rs-'));
    const reqPath = join(tmpDir, 'request.txt');
    writeFileSync(reqPath, 'fixture harness request\n');

    const result = runCli([
      'plan',
      '--request',         reqPath,
      '--request-signals', join(INJECTION_FIXTURE_INPUTS, 'request-signals.json'),
      '--registry',        join(INJECTION_FIXTURE_INPUTS, 'component-registry.json'),
      '--active-ids',      join(INJECTION_FIXTURE_INPUTS, 'active-ids.json'),
      '--budget',          join(INJECTION_FIXTURE_INPUTS, 'budget-state.json'),
      '--history',         join(INJECTION_FIXTURE_INPUTS, 'history-state-summary.json'),
      '--runtime',         join(INJECTION_FIXTURE_INPUTS, 'runtime-capabilities.json'),
      '--policy',          join(INJECTION_FIXTURE_INPUTS, 'selector-policy.json'),
      '--constraints',     join(INJECTION_FIXTURE_INPUTS, 'user-constraints.json'),
      '--output-dir',      tmpDir,
    ]);

    expect(result.status, `stderr: ${result.stderr}`).toBe(0);

    const traceJson = JSON.parse(readFileSync(join(tmpDir, 'trace.json'), 'utf8')) as Record<string, unknown>;
    const requestPhase = traceJson['requestPhase'] as Record<string, unknown>;
    expect(requestPhase['familyConfidence']).toBe(0.4);
  });

  // RS-C3: without --request-signals → familyConfidence 0.0, injectionSuspectFlag false
  it('RS-C3: no --request-signals → familyConfidence 0.0, injectionSuspectFlag false', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ctx-plane-p12-rs-'));
    const reqPath = join(tmpDir, 'request.txt');
    writeFileSync(reqPath, 'fixture harness request\n');

    const result = runCli([
      'plan',
      '--request',     reqPath,
      '--registry',    join(INJECTION_FIXTURE_INPUTS, 'component-registry.json'),
      '--active-ids',  join(INJECTION_FIXTURE_INPUTS, 'active-ids.json'),
      '--budget',      join(INJECTION_FIXTURE_INPUTS, 'budget-state.json'),
      '--history',     join(INJECTION_FIXTURE_INPUTS, 'history-state-summary.json'),
      '--runtime',     join(INJECTION_FIXTURE_INPUTS, 'runtime-capabilities.json'),
      '--policy',      join(INJECTION_FIXTURE_INPUTS, 'selector-policy.json'),
      '--constraints', join(INJECTION_FIXTURE_INPUTS, 'user-constraints.json'),
      '--output-dir',  tmpDir,
    ]);

    expect(result.status, `stderr: ${result.stderr}`).toBe(0);

    const traceJson = JSON.parse(readFileSync(join(tmpDir, 'trace.json'), 'utf8')) as Record<string, unknown>;
    const requestPhase = traceJson['requestPhase'] as Record<string, unknown>;
    expect(requestPhase['familyConfidence']).toBe(0.0);
    expect(requestPhase['injectionSuspectFlag']).toBe(false);
  });

  // RS-C4: malformed --request-signals → exits 0 (Class B fallback); stderr contains request_signals_defaulted
  it('RS-C4: malformed --request-signals → exits 0 (Class B fallback) with request_signals_defaulted', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ctx-plane-p12-rs-'));
    const reqPath = join(tmpDir, 'request.txt');
    const malformedRs = join(tmpDir, 'bad-signals.json');
    writeFileSync(reqPath, 'fixture harness request\n');
    writeFileSync(malformedRs, '{ invalid json }');

    const result = runCli([
      'plan',
      '--request',          reqPath,
      '--request-signals',  malformedRs,
      '--registry',         join(INJECTION_FIXTURE_INPUTS, 'component-registry.json'),
      '--active-ids',       join(INJECTION_FIXTURE_INPUTS, 'active-ids.json'),
      '--budget',           join(INJECTION_FIXTURE_INPUTS, 'budget-state.json'),
      '--history',          join(INJECTION_FIXTURE_INPUTS, 'history-state-summary.json'),
      '--runtime',          join(INJECTION_FIXTURE_INPUTS, 'runtime-capabilities.json'),
      '--policy',           join(INJECTION_FIXTURE_INPUTS, 'selector-policy.json'),
      '--constraints',      join(INJECTION_FIXTURE_INPUTS, 'user-constraints.json'),
      '--output-dir',       tmpDir,
    ]);

    expect(result.status).toBe(0);  // Class B fallback — does not halt
    expect(result.stderr).toContain('request_signals_defaulted');
  });
});
