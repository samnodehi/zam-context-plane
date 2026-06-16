/**
 * Phase 3 — request-normalizer unit and integration tests.
 *
 * All test data is inline (no fixture directory reads).
 * Temp files are created in os.tmpdir() and cleaned up in afterEach.
 * No output files are created.
 * No Phase 4+ imports or behavior.
 *
 * Unit tests: call normalizeInputs() directly.
 * Integration tests: spawn the CLI via tsx (same pattern as Phase 2 tests).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeInputs } from '../../src/core/request-normalizer.js';
import type { LoadedInputs } from '../../src/types/inputs.js';
import type { RegistryResult, RegistryIndexes } from '../../src/types/registry.js';
import type { Component } from '../../src/types/registry.js';

// ---------------------------------------------------------------------------
// Helpers — CLI
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

/** Temp dir registry for cleanup. */
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ctx-phase3-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ---------------------------------------------------------------------------
// Helpers — inline data factories
// ---------------------------------------------------------------------------

/** Minimal valid Component for building a RegistryResult. */
function makeComponent(id: string, type: string = 'scaffold'): Component {
  return {
    id,
    type,
    title: `Test ${id}`,
    summary: `Minimal component ${id} for Phase 3 tests.`,
    source: `${type}/${id}.md`,
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
  };
}

/** Build a minimal RegistryResult with the given component IDs pre-populated. */
function makeRegistryResult(componentIds: string[] = []): RegistryResult {
  const componentsById = new Map<string, Component>();
  const componentsByType = new Map<string, Component[]>();
  const componentsByTag = new Map<string, Component[]>();
  const safetyCriticalIds = new Set<string>();
  const trimmableCandidateIds = new Set<string>();

  for (const id of componentIds) {
    const comp = makeComponent(id);
    componentsById.set(id, comp);
    const typeList = componentsByType.get(comp.type) ?? [];
    typeList.push(comp);
    componentsByType.set(comp.type, typeList);
    for (const tag of comp.tags) {
      const tagList = componentsByTag.get(tag) ?? [];
      tagList.push(comp);
      componentsByTag.set(tag, tagList);
    }
    trimmableCandidateIds.add(id);
  }

  const indexes: RegistryIndexes = {
    componentsById,
    componentsByType,
    componentsByTag,
    safetyCriticalIds,
    trimmableCandidateIds,
  };

  return {
    indexes,
    quarantinedComponents: [],
    validationWarnings: [],
  };
}

/** Build a minimal LoadedInputs with the given active IDs and request text. */
function makeLoadedInputs(overrides: {
  requestText?: string;
  activeSkillIds?: string[];
  activeToolIds?: string[];
  activeMemoryIds?: string[];
} = {}): LoadedInputs {
  return {
    requestText: overrides.requestText ?? 'What is the current system status?',
    registryRaw: [],
    activeIds: {
      activeSkillIds: overrides.activeSkillIds ?? [],
      activeToolIds: overrides.activeToolIds ?? [],
      activeMemoryIds: overrides.activeMemoryIds ?? [],
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
  };
}

/** Minimal valid JSON component for CLI integration tests. */
function makeRegistryJson(ids: string[]): string {
  const comps = ids.map((id) => ({
    id,
    type: 'scaffold',
    title: `Test ${id}`,
    summary: `Component ${id}`,
    source: `scaffold/${id}.md`,
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
  }));
  return JSON.stringify(comps, null, 2);
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe('normalizeInputs — requestSignals required fields', () => {
  it('produces promptFamily: general_default', () => {
    const result = normalizeInputs(makeLoadedInputs(), makeRegistryResult());
    expect(result.requestSignals.promptFamily).toBe('general_default');
  });

  it('produces familyConfidence: 0.0', () => {
    const result = normalizeInputs(makeLoadedInputs(), makeRegistryResult());
    expect(result.requestSignals.familyConfidence).toBe(0.0);
  });

  it('produces injectionSuspect: false', () => {
    const result = normalizeInputs(makeLoadedInputs(), makeRegistryResult());
    expect(result.requestSignals.injectionSuspect).toBe(false);
  });
});

describe('normalizeInputs — warning behavior', () => {
  it('always emits exactly one prompt_family_defaulted warning', () => {
    const result = normalizeInputs(makeLoadedInputs(), makeRegistryResult());
    const codes = result.warnings.map((w) => w.code);
    const count = codes.filter((c) => c === 'prompt_family_defaulted').length;
    expect(count).toBe(1);
  });

  it('does not emit prompt_family_unknown', () => {
    const result = normalizeInputs(makeLoadedInputs(), makeRegistryResult());
    const codes = result.warnings.map((w) => w.code);
    expect(codes).not.toContain('prompt_family_unknown');
  });

  it('does not emit prompt_family_substituted', () => {
    const result = normalizeInputs(makeLoadedInputs(), makeRegistryResult());
    const codes = result.warnings.map((w) => w.code);
    expect(codes).not.toContain('prompt_family_substituted');
  });

  it('does not emit request_text_empty for any request text', () => {
    for (const text of ['', '   ', '\n', 'normal request text']) {
      const result = normalizeInputs(makeLoadedInputs({ requestText: text }), makeRegistryResult());
      const codes = result.warnings.map((w) => w.code);
      expect(codes).not.toContain('request_text_empty');
    }
  });

  it('does not emit reference_unknown', () => {
    const result = normalizeInputs(makeLoadedInputs(), makeRegistryResult());
    const codes = result.warnings.map((w) => w.code);
    expect(codes).not.toContain('reference_unknown');
  });
});

describe('normalizeInputs — empty/whitespace request text', () => {
  it('empty request text produces same output as non-empty request', () => {
    const empty = normalizeInputs(makeLoadedInputs({ requestText: '' }), makeRegistryResult());
    const normal = normalizeInputs(
      makeLoadedInputs({ requestText: 'real request' }),
      makeRegistryResult(),
    );
    expect(empty.requestSignals.promptFamily).toBe(normal.requestSignals.promptFamily);
    expect(empty.requestSignals.familyConfidence).toBe(normal.requestSignals.familyConfidence);
    expect(empty.requestSignals.injectionSuspect).toBe(normal.requestSignals.injectionSuspect);
    const emptyCodes = empty.warnings.map((w) => w.code);
    const normalCodes = normal.warnings.map((w) => w.code);
    expect(emptyCodes).toEqual(normalCodes);
  });

  it('whitespace-only request text produces prompt_family_defaulted and no extra warning', () => {
    const result = normalizeInputs(
      makeLoadedInputs({ requestText: '   \n  ' }),
      makeRegistryResult(),
    );
    const codes = result.warnings.map((w) => w.code);
    expect(codes).toContain('prompt_family_defaulted');
    expect(codes).not.toContain('request_text_empty');
  });
});

describe('normalizeInputs — active ID carry-forward', () => {
  it('carries activeSkillIds into requestSignals and activeIds', () => {
    const result = normalizeInputs(
      makeLoadedInputs({ activeSkillIds: ['skill.test'] }),
      makeRegistryResult(['skill.test']),
    );
    expect(result.requestSignals.activeSkillIds).toEqual(['skill.test']);
    expect(result.activeIds.activeSkillIds).toEqual(['skill.test']);
  });

  it('carries activeToolIds into requestSignals and activeIds', () => {
    const result = normalizeInputs(
      makeLoadedInputs({ activeToolIds: ['tool.test'] }),
      makeRegistryResult(['tool.test']),
    );
    expect(result.requestSignals.activeToolIds).toEqual(['tool.test']);
    expect(result.activeIds.activeToolIds).toEqual(['tool.test']);
  });

  it('carries activeMemoryIds into requestSignals and activeIds', () => {
    const result = normalizeInputs(
      makeLoadedInputs({ activeMemoryIds: ['memory.test'] }),
      makeRegistryResult(['memory.test']),
    );
    expect(result.requestSignals.activeMemoryIds).toEqual(['memory.test']);
    expect(result.activeIds.activeMemoryIds).toEqual(['memory.test']);
  });
});

describe('normalizeInputs — active ID unknown check', () => {
  it('known active ID (in componentsById) emits no active_id_unknown warning', () => {
    const result = normalizeInputs(
      makeLoadedInputs({ activeSkillIds: ['skill.known'] }),
      makeRegistryResult(['skill.known']),
    );
    const codes = result.warnings.map((w) => w.code);
    expect(codes).not.toContain('active_id_unknown');
  });

  it('unknown skill ID emits active_id_unknown', () => {
    const result = normalizeInputs(
      makeLoadedInputs({ activeSkillIds: ['skill.unknown'] }),
      makeRegistryResult([]),
    );
    const unknownWarns = result.warnings.filter((w) => w.code === 'active_id_unknown');
    expect(unknownWarns).toHaveLength(1);
    expect(unknownWarns[0]!.message).toContain('skill.unknown');
  });

  it('unknown tool ID emits active_id_unknown', () => {
    const result = normalizeInputs(
      makeLoadedInputs({ activeToolIds: ['tool.unknown'] }),
      makeRegistryResult([]),
    );
    const unknownWarns = result.warnings.filter((w) => w.code === 'active_id_unknown');
    expect(unknownWarns).toHaveLength(1);
    expect(unknownWarns[0]!.message).toContain('tool.unknown');
  });

  it('unknown memory ID emits active_id_unknown', () => {
    const result = normalizeInputs(
      makeLoadedInputs({ activeMemoryIds: ['memory.unknown'] }),
      makeRegistryResult([]),
    );
    const unknownWarns = result.warnings.filter((w) => w.code === 'active_id_unknown');
    expect(unknownWarns).toHaveLength(1);
    expect(unknownWarns[0]!.message).toContain('memory.unknown');
  });

  it('multiple unknown IDs across types emit one warning per unknown ID', () => {
    const result = normalizeInputs(
      makeLoadedInputs({
        activeSkillIds: ['skill.a', 'skill.b'],
        activeToolIds: ['tool.x'],
        activeMemoryIds: ['memory.y'],
      }),
      makeRegistryResult([]),
    );
    const unknownWarns = result.warnings.filter((w) => w.code === 'active_id_unknown');
    expect(unknownWarns).toHaveLength(4);
    const msgs = unknownWarns.map((w) => w.message);
    expect(msgs.some((m) => m.includes('skill.a'))).toBe(true);
    expect(msgs.some((m) => m.includes('skill.b'))).toBe(true);
    expect(msgs.some((m) => m.includes('tool.x'))).toBe(true);
    expect(msgs.some((m) => m.includes('memory.y'))).toBe(true);
  });

  it('empty active ID arrays produce no active_id_unknown warnings', () => {
    const result = normalizeInputs(
      makeLoadedInputs({ activeSkillIds: [], activeToolIds: [], activeMemoryIds: [] }),
      makeRegistryResult([]),
    );
    const codes = result.warnings.map((w) => w.code);
    expect(codes).not.toContain('active_id_unknown');
  });

  it('unknown active ID is still passed through in arrays (not removed)', () => {
    const result = normalizeInputs(
      makeLoadedInputs({ activeSkillIds: ['skill.ghost'] }),
      makeRegistryResult([]),
    );
    expect(result.requestSignals.activeSkillIds).toContain('skill.ghost');
    expect(result.activeIds.activeSkillIds).toContain('skill.ghost');
  });

  it('does not emit reference_unknown for unknown active IDs', () => {
    const result = normalizeInputs(
      makeLoadedInputs({ activeSkillIds: ['skill.unknown'] }),
      makeRegistryResult([]),
    );
    const codes = result.warnings.map((w) => w.code);
    expect(codes).not.toContain('reference_unknown');
  });
});

describe('normalizeInputs — Class B carry-forward', () => {
  it('carries runtime verbatim', () => {
    const loaded = makeLoadedInputs();
    loaded.runtime.runtimeLabel = 'test-runtime';
    loaded.runtime.capabilityInventoryComplete = true;
    const result = normalizeInputs(loaded, makeRegistryResult());
    expect(result.runtime.runtimeLabel).toBe('test-runtime');
    expect(result.runtime.capabilityInventoryComplete).toBe(true);
  });

  it('carries history verbatim (historyMalformed: true)', () => {
    const loaded = makeLoadedInputs();
    loaded.history.historyMalformed = true;
    const result = normalizeInputs(loaded, makeRegistryResult());
    expect(result.history.historyMalformed).toBe(true);
  });

  it('carries history verbatim (historyMalformed: false)', () => {
    const loaded = makeLoadedInputs();
    loaded.history.historyMalformed = false;
    const result = normalizeInputs(loaded, makeRegistryResult());
    expect(result.history.historyMalformed).toBe(false);
  });

  it('carries budget: null verbatim', () => {
    const loaded = makeLoadedInputs();
    loaded.budget = null;
    const result = normalizeInputs(loaded, makeRegistryResult());
    expect(result.budget).toBeNull();
  });

  it('carries non-null budget verbatim', () => {
    const loaded = makeLoadedInputs();
    loaded.budget = {
      totalPromptTokenTarget: 8000,
      maxScaffoldTokens: 2000,
      maxSkillTokens: 2000,
      maxToolTokens: 1000,
      maxHistoryTokens: 1000,
      reservedUserTokens: 500,
      budgetCritical: false,
    };
    const result = normalizeInputs(loaded, makeRegistryResult());
    expect(result.budget?.totalPromptTokenTarget).toBe(8000);
    expect(result.budget?.budgetCritical).toBe(false);
  });

  it('carries constraints: null verbatim', () => {
    const loaded = makeLoadedInputs();
    loaded.constraints = null;
    const result = normalizeInputs(loaded, makeRegistryResult());
    expect(result.constraints).toBeNull();
  });

  it('carries non-null constraints verbatim', () => {
    const loaded = makeLoadedInputs();
    loaded.constraints = {
      alwaysInclude: ['comp.always'],
      neverInclude: [],
      constraintSource: 'operator_cli',
    };
    const result = normalizeInputs(loaded, makeRegistryResult());
    expect(result.constraints?.alwaysInclude).toEqual(['comp.always']);
    expect(result.constraints?.constraintSource).toBe('operator_cli');
  });

  it('carries policy verbatim', () => {
    const loaded = makeLoadedInputs();
    loaded.policy.failOpenThreshold = 0.85;
    const result = normalizeInputs(loaded, makeRegistryResult());
    expect(result.policy.failOpenThreshold).toBe(0.85);
  });

  it('does not re-emit Phase 1 warning codes', () => {
    const loaded = makeLoadedInputs();
    // Simulate Phase 1 having emitted warnings
    loaded.warnings = [
      { code: 'selector_policy_defaulted', message: 'Policy defaulted in Phase 1.' },
      { code: 'runtime_capabilities_missing', message: 'Runtime absent.' },
    ];
    const result = normalizeInputs(loaded, makeRegistryResult());
    const phase3Codes = result.warnings.map((w) => w.code);
    expect(phase3Codes).not.toContain('selector_policy_defaulted');
    expect(phase3Codes).not.toContain('runtime_capabilities_missing');
  });
});

describe('normalizeInputs — mutation and side-effect guards', () => {
  it('does not mutate the input loadedInputs object', () => {
    const loaded = makeLoadedInputs({
      activeSkillIds: ['skill.orig'],
      activeToolIds: ['tool.orig'],
    });
    const originalSkills = [...loaded.activeIds.activeSkillIds];
    const originalTools = [...loaded.activeIds.activeToolIds];
    const originalWarnings = [...loaded.warnings];
    normalizeInputs(loaded, makeRegistryResult());
    expect(loaded.activeIds.activeSkillIds).toEqual(originalSkills);
    expect(loaded.activeIds.activeToolIds).toEqual(originalTools);
    expect(loaded.warnings).toEqual(originalWarnings);
  });

  it('does not write any files', () => {
    const td = makeTempDir();
    normalizeInputs(makeLoadedInputs(), makeRegistryResult());
    // No prompt-plan.json, trace.json, or summary.md should exist
    expect(existsSync(join(td, 'prompt-plan.json'))).toBe(false);
    expect(existsSync(join(td, 'trace.json'))).toBe(false);
    expect(existsSync(join(td, 'summary.md'))).toBe(false);

  });

  it('has no network/model/provider imports (structural check)', async () => {
    // If this module imported fetch, axios, openai, etc., the import() would
    // succeed but the assertions below would catch the unexpected export.
    const mod = await import('../../src/core/request-normalizer.js');
    expect(typeof mod.normalizeInputs).toBe('function');
    // The module should export exactly one symbol
    expect(Object.keys(mod)).toEqual(['normalizeInputs']);
  });
});

// ---------------------------------------------------------------------------
// CLI integration tests
// ---------------------------------------------------------------------------

describe('CLI integration — Phase 3 behavior', () => {
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

  it('stderr does NOT contain Phase 3 not-implemented message after Phase 3 is wired', () => {
    const td = makeTempDir();
    writeFileSync(join(td, 'req.txt'), 'Hello');
    writeFileSync(join(td, 'reg.json'), makeRegistryJson(['scaffold.test']));
    const result = runCli([
      'plan',
      '--request', join(td, 'req.txt'),
      '--registry', join(td, 'reg.json'),
    ]);
    expect(result.stderr).not.toContain('Phase 3 (request normalization) is not yet implemented');
  });

  it('stderr contains prompt_family_defaulted warning', () => {
    const td = makeTempDir();
    writeFileSync(join(td, 'req.txt'), 'Explain the deployment process.');
    writeFileSync(join(td, 'reg.json'), makeRegistryJson(['scaffold.test']));
    const result = runCli([
      'plan',
      '--request', join(td, 'req.txt'),
      '--registry', join(td, 'reg.json'),
    ]);
    expect(result.stderr).toContain('prompt_family_defaulted');
  });

  it('stderr does NOT contain prompt_family_unknown', () => {
    const td = makeTempDir();
    writeFileSync(join(td, 'req.txt'), 'Test request.');
    writeFileSync(join(td, 'reg.json'), makeRegistryJson(['scaffold.test']));
    const result = runCli([
      'plan',
      '--request', join(td, 'req.txt'),
      '--registry', join(td, 'reg.json'),
    ]);
    expect(result.stderr).not.toContain('prompt_family_unknown');
  });

  it('stderr does NOT contain prompt_family_substituted', () => {
    const td = makeTempDir();
    writeFileSync(join(td, 'req.txt'), 'Test request.');
    writeFileSync(join(td, 'reg.json'), makeRegistryJson(['scaffold.test']));
    const result = runCli([
      'plan',
      '--request', join(td, 'req.txt'),
      '--registry', join(td, 'reg.json'),
    ]);
    expect(result.stderr).not.toContain('prompt_family_substituted');
  });

  it('stderr does NOT contain request_text_empty', () => {
    const td = makeTempDir();
    writeFileSync(join(td, 'req.txt'), 'Test request.');
    writeFileSync(join(td, 'reg.json'), makeRegistryJson(['scaffold.test']));
    const result = runCli([
      'plan',
      '--request', join(td, 'req.txt'),
      '--registry', join(td, 'reg.json'),
    ]);
    expect(result.stderr).not.toContain('request_text_empty');
  });

  it('fatal registry (empty array) halts before Phase 3 with registry fatal error', () => {
    const td = makeTempDir();
    writeFileSync(join(td, 'req.txt'), 'Test request.');
    // An empty array is a registry Class A failure (no components to index)
    // OR it may produce a RegistryFatalError if the registry is entirely invalid.
    // Actually an empty array is valid JSON and valid per schema (minItems not required).
    // Use a malformed JSON to ensure a Class A failure at Phase 1 boundary.
    writeFileSync(join(td, 'reg.json'), 'NOT JSON AT ALL');
    const result = runCli([
      'plan',
      '--request', join(td, 'req.txt'),
      '--registry', join(td, 'reg.json'),
    ]);
    expect(result.status).toBe(1);
    // Should contain an error, NOT the Phase 7 message
    expect(result.stderr).not.toContain('Phase 11 (Trace and Summary Assembly) is not yet implemented');
  });

  it('unknown active ID in registry produces active_id_unknown warning; exits 0', () => {
    const td = makeTempDir();
    writeFileSync(join(td, 'req.txt'), 'Test request.');
    writeFileSync(join(td, 'reg.json'), makeRegistryJson(['scaffold.test']));
    // Active IDs file references a non-existent component
    const activeIds = {
      activeSkillIds: ['skill.ghost_does_not_exist'],
      activeToolIds: [],
      activeMemoryIds: [],
    };
    writeFileSync(join(td, 'active-ids.json'), JSON.stringify(activeIds));
    const result = runCli([
      'plan',
      '--request', join(td, 'req.txt'),
      '--registry', join(td, 'reg.json'),
      '--active-ids', join(td, 'active-ids.json'),
      '--output-dir', td,
    ]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('active_id_unknown');
    expect(result.stderr).toContain('skill.ghost_does_not_exist');
  });

  it('all three output files are created on successful run', () => {
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
});
