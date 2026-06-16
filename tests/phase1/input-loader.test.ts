/**
 * Phase 1 — input-loader unit and integration tests.
 *
 * All temp files are created inside os.tmpdir() and cleaned up in afterEach.
 * No fixture directory is read. No output files are created.
 * No Phase 2+ imports or behavior.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadInputs, ClassAError } from '../../src/core/input-loader.js';

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
    { encoding: 'utf8', timeout: 20_000 },
  );
}

/** A minimal schema-valid component registry (single component, all 18 required fields). */
const MINIMAL_REGISTRY = JSON.stringify([
  {
    id: 'scaffold.test_component',
    type: 'scaffold',
    title: 'Test Component',
    summary: 'Minimal component for Phase 1 test boundary validation.',
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

/** Minimal valid selector policy JSON. */
const VALID_POLICY = JSON.stringify({
  failOpenThreshold: 0.7,
  deterministicOnly: true,
  injectionSuspectAction: 'warn_and_continue',
});

/** Minimal valid active-ids JSON. */
const VALID_ACTIVE_IDS = JSON.stringify({
  activeSkillIds: [],
  activeToolIds: [],
  activeMemoryIds: [],
});

/** Temp directory state — reset per test. */
let tmpDir: string;

afterEach(() => {
  if (tmpDir) {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function setup(): { req: string; reg: string } {
  tmpDir = mkdtempSync(join(tmpdir(), 'ctx-plane-p1-'));
  const req = join(tmpDir, 'request.txt');
  const reg = join(tmpDir, 'registry.json');
  writeFileSync(req, 'Write me a function that reverses a string.');
  writeFileSync(reg, MINIMAL_REGISTRY);
  return { req, reg };
}

// ---------------------------------------------------------------------------
// Class A — CLI/Commander integration (missing required flag)
// ---------------------------------------------------------------------------

describe('Phase 1 CLI integration', () => {
  it('missing --request flag exits non-zero (Commander enforces requiredOption)', () => {
    // Commander handles this before loadInputs() is called.
    const result = runCli(['plan', '--registry', 'some.json']);
    expect(result.status, `stderr: ${result.stderr}`).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Class A — file-level failures
// ---------------------------------------------------------------------------

describe('Class A — --request', () => {
  it('request path missing => ClassAError class_a_missing', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ctx-plane-p1-'));
    const reg = join(tmpDir, 'registry.json');
    writeFileSync(reg, MINIMAL_REGISTRY);

    expect(() =>
      loadInputs({ request: join(tmpDir, 'nonexistent.txt'), registry: reg }),
    ).toThrow(ClassAError);

    try {
      loadInputs({ request: join(tmpDir, 'nonexistent.txt'), registry: reg });
    } catch (e) {
      expect(e).toBeInstanceOf(ClassAError);
      expect((e as ClassAError).code).toBe('class_a_missing');
      expect((e as ClassAError).flag).toBe('--request');
    }
  });
});

describe('Class A — --registry', () => {
  it('registry path missing => ClassAError class_a_missing', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ctx-plane-p1-'));
    const req = join(tmpDir, 'request.txt');
    writeFileSync(req, 'hello');

    try {
      loadInputs({ request: req, registry: join(tmpDir, 'nonexistent.json') });
      expect.fail('expected ClassAError');
    } catch (e) {
      expect(e).toBeInstanceOf(ClassAError);
      expect((e as ClassAError).code).toBe('class_a_missing');
      expect((e as ClassAError).flag).toBe('--registry');
    }
  });

  it('registry invalid JSON => ClassAError class_a_malformed', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ctx-plane-p1-'));
    const req = join(tmpDir, 'request.txt');
    const reg = join(tmpDir, 'registry.json');
    writeFileSync(req, 'hello');
    writeFileSync(reg, '{ not valid json ');

    try {
      loadInputs({ request: req, registry: reg });
      expect.fail('expected ClassAError');
    } catch (e) {
      expect(e).toBeInstanceOf(ClassAError);
      expect((e as ClassAError).code).toBe('class_a_malformed');
      expect((e as ClassAError).flag).toBe('--registry');
    }
  });

  it('registry valid JSON but not an array => ClassAError class_a_malformed', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ctx-plane-p1-'));
    const req = join(tmpDir, 'request.txt');
    const reg = join(tmpDir, 'registry.json');
    writeFileSync(req, 'hello');
    writeFileSync(reg, '{ "notAnArray": true }');

    try {
      loadInputs({ request: req, registry: reg });
      expect.fail('expected ClassAError');
    } catch (e) {
      expect(e).toBeInstanceOf(ClassAError);
      expect((e as ClassAError).code).toBe('class_a_malformed');
    }
  });

  it('registry valid array but component missing required field => ClassAError class_a_malformed', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ctx-plane-p1-'));
    const req = join(tmpDir, 'request.txt');
    const reg = join(tmpDir, 'registry.json');
    writeFileSync(req, 'hello');
    // Missing 'type', 'title', and most other required fields
    writeFileSync(reg, JSON.stringify([{ id: 'scaffold.test', source: 'x.md' }]));

    try {
      loadInputs({ request: req, registry: reg });
      expect.fail('expected ClassAError');
    } catch (e) {
      expect(e).toBeInstanceOf(ClassAError);
      expect((e as ClassAError).code).toBe('class_a_malformed');
    }
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('Happy path', () => {
  it('valid request + valid registry => LoadedInputs with no errors', () => {
    const { req, reg } = setup();
    const result = loadInputs({ request: req, registry: reg });
    expect(result.requestText).toBe('Write me a function that reverses a string.');
    expect(Array.isArray(result.registryRaw)).toBe(true);
    expect(result.registryRaw).toHaveLength(1);
    // No Class A error — all Class B defaults applied silently or with warnings
  });

  it('empty request file is allowed (Phase 3 handles semantics)', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ctx-plane-p1-'));
    const req = join(tmpDir, 'empty.txt');
    const reg = join(tmpDir, 'registry.json');
    writeFileSync(req, '');
    writeFileSync(reg, MINIMAL_REGISTRY);
    const result = loadInputs({ request: req, registry: reg });
    expect(result.requestText).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Class B — --policy
// ---------------------------------------------------------------------------

describe('Class B — --policy', () => {
  it('absent => defaults applied + selector_policy_defaulted warning', () => {
    const { req, reg } = setup();
    const result = loadInputs({ request: req, registry: reg });
    expect(result.policy.failOpenThreshold).toBe(0.7);
    expect(result.policy.deterministicOnly).toBe(true);
    expect(result.policy.injectionSuspectAction).toBe('warn_and_continue');
    expect(result.warnings.some(w => w.code === 'selector_policy_defaulted')).toBe(true);
  });

  it('file missing => defaults + selector_policy_defaulted warning', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ctx-plane-p1-'));
    const req = join(tmpDir, 'request.txt');
    const reg = join(tmpDir, 'registry.json');
    writeFileSync(req, 'hello');
    writeFileSync(reg, MINIMAL_REGISTRY);
    const result = loadInputs({ request: req, registry: reg, policy: join(tmpDir, 'no-policy.json') });
    expect(result.policy.failOpenThreshold).toBe(0.7);
    expect(result.warnings.some(w => w.code === 'selector_policy_defaulted')).toBe(true);
  });

  it('invalid JSON => defaults + selector_policy_defaulted warning', () => {
    const { req, reg } = setup();
    const policyPath = join(tmpDir, 'policy.json');
    writeFileSync(policyPath, '{ bad json }');
    const result = loadInputs({ request: req, registry: reg, policy: policyPath });
    expect(result.policy.failOpenThreshold).toBe(0.7);
    expect(result.warnings.some(w => w.code === 'selector_policy_defaulted')).toBe(true);
  });

  it('deterministicOnly: false is coerced to true + selector_policy_defaulted warning', () => {
    const { req, reg } = setup();
    const policyPath = join(tmpDir, 'policy.json');
    writeFileSync(policyPath, JSON.stringify({
      failOpenThreshold: 0.8,
      deterministicOnly: false,
      injectionSuspectAction: 'warn_and_continue',
    }));
    const result = loadInputs({ request: req, registry: reg, policy: policyPath });
    expect(result.policy.deterministicOnly).toBe(true);
    expect(result.policy.failOpenThreshold).toBe(0.8);
    expect(result.warnings.some(w => w.code === 'selector_policy_defaulted')).toBe(true);
  });

  it('valid policy with deterministicOnly: true => loaded without warning', () => {
    const { req, reg } = setup();
    const policyPath = join(tmpDir, 'policy.json');
    writeFileSync(policyPath, VALID_POLICY);
    const result = loadInputs({ request: req, registry: reg, policy: policyPath });
    expect(result.policy.failOpenThreshold).toBe(0.7);
    expect(result.policy.deterministicOnly).toBe(true);
    expect(result.warnings.some(w => w.code === 'selector_policy_defaulted')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Class B — --active-ids
// ---------------------------------------------------------------------------

describe('Class B — --active-ids', () => {
  it('absent => empty arrays, NO warning', () => {
    const { req, reg } = setup();
    const result = loadInputs({ request: req, registry: reg });
    expect(result.activeIds.activeSkillIds).toEqual([]);
    expect(result.activeIds.activeToolIds).toEqual([]);
    expect(result.activeIds.activeMemoryIds).toEqual([]);
    expect(result.warnings.some(w => w.code === 'active_ids_missing')).toBe(false);
  });

  it('file missing => empty arrays + active_ids_missing warning', () => {
    const { req, reg } = setup();
    const result = loadInputs({ request: req, registry: reg, activeIds: join(tmpDir, 'no-ids.json') });
    expect(result.activeIds.activeSkillIds).toEqual([]);
    expect(result.warnings.some(w => w.code === 'active_ids_missing')).toBe(true);
  });

  it('invalid JSON => empty arrays + active_ids_missing warning', () => {
    const { req, reg } = setup();
    const idsPath = join(tmpDir, 'ids.json');
    writeFileSync(idsPath, '{ broken');
    const result = loadInputs({ request: req, registry: reg, activeIds: idsPath });
    expect(result.activeIds.activeSkillIds).toEqual([]);
    expect(result.warnings.some(w => w.code === 'active_ids_missing')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Class B — --runtime
// ---------------------------------------------------------------------------

describe('Class B — --runtime', () => {
  it('absent => capabilityInventoryComplete: false + runtime_capabilities_missing warning', () => {
    const { req, reg } = setup();
    const result = loadInputs({ request: req, registry: reg });
    expect(result.runtime.capabilityInventoryComplete).toBe(false);
    expect(result.runtime.availableToolIds).toEqual([]);
    expect(result.warnings.some(w => w.code === 'runtime_capabilities_missing')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Class B — --history
// ---------------------------------------------------------------------------

describe('Class B — --history', () => {
  it('absent => historyMalformed: true + history_summary_missing warning', () => {
    const { req, reg } = setup();
    const result = loadInputs({ request: req, registry: reg });
    expect(result.history.historyMalformed).toBe(true);
    expect(result.history.durableConstraintsPresent).toBe(false);
    expect(result.warnings.some(w => w.code === 'history_summary_missing')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Class B — --budget
// ---------------------------------------------------------------------------

describe('Class B — --budget', () => {
  it('absent => null + budget_config_missing warning', () => {
    const { req, reg } = setup();
    const result = loadInputs({ request: req, registry: reg });
    expect(result.budget).toBeNull();
    expect(result.warnings.some(w => w.code === 'budget_config_missing')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Class B — --constraints
// ---------------------------------------------------------------------------

describe('Class B — --constraints', () => {
  it('absent => null, NO warning', () => {
    const { req, reg } = setup();
    const result = loadInputs({ request: req, registry: reg });
    expect(result.constraints).toBeNull();
    expect(result.warnings.some(w => w.code === 'user_constraints_missing')).toBe(false);
  });

  it('file missing => null + user_constraints_missing warning', () => {
    const { req, reg } = setup();
    const result = loadInputs({
      request: req,
      registry: reg,
      constraints: join(tmpDir, 'no-constraints.json'),
    });
    expect(result.constraints).toBeNull();
    expect(result.warnings.some(w => w.code === 'user_constraints_missing')).toBe(true);
  });

  it('invalid JSON => null + user_constraints_missing warning', () => {
    const { req, reg } = setup();
    const cPath = join(tmpDir, 'constraints.json');
    writeFileSync(cPath, '{ invalid');
    const result = loadInputs({ request: req, registry: reg, constraints: cPath });
    expect(result.constraints).toBeNull();
    expect(result.warnings.some(w => w.code === 'user_constraints_missing')).toBe(true);
  });
});
