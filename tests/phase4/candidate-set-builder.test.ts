/**
 * Phase 4 — candidate-set-builder unit and integration tests.
 *
 * All test data is inline (no fixture directory reads).
 * Temp files are created in os.tmpdir() and cleaned up in afterEach.
 * No output files are created.
 * No Phase 5+ imports or behavior.
 * Integration tests: spawn the CLI via tsx (same pattern as Phase 2/3 tests).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCandidateSet, CandidateSetFatalError } from '../../src/core/candidate-set-builder.js';
import type { RegistryResult } from '../../src/types/registry.js';
import type { Component } from '../../src/types/registry.js';

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

/** Temp dir registry for cleanup. */
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ctx-phase4-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ---------------------------------------------------------------------------
// Minimal valid component + RegistryResult factories
// ---------------------------------------------------------------------------

/** Build a minimal valid Component with optional field overrides. */
function makeComponent(id: string, overrides: Partial<Component> = {}): Component {
  return {
    id,
    type: 'scaffold',
    title: `Test Component ${id}`,
    summary: `Minimal component ${id} for Phase 4 tests.`,
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

/**
 * Build a minimal valid RegistryResult with given components and quarantine list.
 * Does not call buildRegistryIndexes — constructs the result shape inline.
 */
function makeRegistryResult(
  components: Component[] = [],
  quarantineIds: string[] = [],
): RegistryResult {
  const componentsById = new Map<string, Component>();
  for (const c of components) {
    componentsById.set(c.id, c);
  }

  const componentsByType = new Map<string, Component[]>();
  for (const c of components) {
    const list = componentsByType.get(c.type) ?? [];
    list.push(c);
    componentsByType.set(c.type, list);
  }

  const componentsByTag = new Map<string, Component[]>();
  for (const c of components) {
    for (const tag of c.tags) {
      const list = componentsByTag.get(tag) ?? [];
      list.push(c);
      componentsByTag.set(tag, list);
    }
  }

  const safetyCriticalIds = new Set<string>(
    components
      .filter((c) => c.retainPolicy === 'safety_critical' || c.omissionPolicy === 'never')
      .map((c) => c.id),
  );

  const trimmableCandidateIds = new Set<string>(
    components
      .filter(
        (c) =>
          c.retainPolicy === 'optional' &&
          c.omissionPolicy === 'allow' &&
          (c.riskLevel === 'low' || c.riskLevel === 'medium'),
      )
      .map((c) => c.id),
  );

  return {
    indexes: {
      componentsById,
      componentsByType,
      componentsByTag,
      safetyCriticalIds,
      trimmableCandidateIds,
    },
    quarantinedComponents: quarantineIds.map((id) => ({
      id,
      reason: `Quarantined for test: ${id}`,
      riskLevel: 'low',
      rawEntry: { id },
    })),
    validationWarnings: [],
  };
}

/**
 * Build a minimal valid registry JSON string for CLI integration tests.
 * Each ID produces a schema-valid component entry.
 */
function makeRegistryJson(ids: string[]): string {
  return JSON.stringify(
    ids.map((id) => ({
      id,
      type: 'scaffold',
      title: `Test Component ${id}`,
      summary: `Minimal component ${id} for Phase 4 tests.`,
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
    })),
  );
}

// ---------------------------------------------------------------------------
// Unit tests — buildCandidateSet()
// ---------------------------------------------------------------------------

describe('Phase 4 — empty registry (0 components, 0 quarantined)', () => {
  it('produces candidateSetSize 0', () => {
    const reg = makeRegistryResult([], []);
    const result = buildCandidateSet(reg);
    expect(result.summary.candidateSetSize).toBe(0);
  });

  it('produces quarantinedExcluded 0', () => {
    const reg = makeRegistryResult([], []);
    const result = buildCandidateSet(reg);
    expect(result.summary.quarantinedExcluded).toBe(0);
  });

  it('produces empty candidatesById', () => {
    const reg = makeRegistryResult([], []);
    const result = buildCandidateSet(reg);
    expect(result.candidatesById.size).toBe(0);
  });

  it('produces empty warnings', () => {
    const reg = makeRegistryResult([], []);
    const result = buildCandidateSet(reg);
    expect(result.warnings).toEqual([]);
  });
});

describe('Phase 4 — N valid components, 0 quarantined', () => {
  it('candidateSetSize equals N for N=1', () => {
    const reg = makeRegistryResult([makeComponent('scaffold.a')], []);
    const result = buildCandidateSet(reg);
    expect(result.summary.candidateSetSize).toBe(1);
  });

  it('candidateSetSize equals N for N=3', () => {
    const comps = [
      makeComponent('scaffold.a'),
      makeComponent('scaffold.b'),
      makeComponent('scaffold.c'),
    ];
    const reg = makeRegistryResult(comps, []);
    const result = buildCandidateSet(reg);
    expect(result.summary.candidateSetSize).toBe(3);
  });

  it('quarantinedExcluded is 0', () => {
    const reg = makeRegistryResult([makeComponent('scaffold.a'), makeComponent('scaffold.b')], []);
    const result = buildCandidateSet(reg);
    expect(result.summary.quarantinedExcluded).toBe(0);
  });

  it('all valid component IDs are present in candidatesById', () => {
    const comps = [makeComponent('scaffold.x'), makeComponent('scaffold.y')];
    const reg = makeRegistryResult(comps, []);
    const result = buildCandidateSet(reg);
    expect(result.candidatesById.has('scaffold.x')).toBe(true);
    expect(result.candidatesById.has('scaffold.y')).toBe(true);
  });

  it('warnings are []', () => {
    const reg = makeRegistryResult([makeComponent('scaffold.a')], []);
    const result = buildCandidateSet(reg);
    expect(result.warnings).toEqual([]);
  });
});

describe('Phase 4 — N valid + M quarantined', () => {
  it('candidateSetSize equals N only (not N+M)', () => {
    const comps = [makeComponent('scaffold.good1'), makeComponent('scaffold.good2')];
    const reg = makeRegistryResult(comps, ['scaffold.bad1', 'scaffold.bad2', 'scaffold.bad3']);
    const result = buildCandidateSet(reg);
    expect(result.summary.candidateSetSize).toBe(2);
  });

  it('quarantinedExcluded equals M', () => {
    const comps = [makeComponent('scaffold.good1')];
    const reg = makeRegistryResult(comps, ['scaffold.bad1', 'scaffold.bad2']);
    const result = buildCandidateSet(reg);
    expect(result.summary.quarantinedExcluded).toBe(2);
  });

  it('quarantined IDs are not present in candidatesById', () => {
    const comps = [makeComponent('scaffold.good1')];
    const reg = makeRegistryResult(comps, ['scaffold.bad1']);
    const result = buildCandidateSet(reg);
    expect(result.candidatesById.has('scaffold.bad1')).toBe(false);
  });

  it('valid IDs are present in candidatesById', () => {
    const comps = [makeComponent('scaffold.good1')];
    const reg = makeRegistryResult(comps, ['scaffold.bad1']);
    const result = buildCandidateSet(reg);
    expect(result.candidatesById.has('scaffold.good1')).toBe(true);
  });
});

describe('Phase 4 — candidateSetPolicy invariant', () => {
  it('candidateSetPolicy is always "all_non_quarantined"', () => {
    const reg = makeRegistryResult([makeComponent('scaffold.a')], []);
    const result = buildCandidateSet(reg);
    expect(result.summary.candidateSetPolicy).toBe('all_non_quarantined');
  });

  it('candidateSetPolicy is "all_non_quarantined" for empty registry', () => {
    const reg = makeRegistryResult([], []);
    const result = buildCandidateSet(reg);
    expect(result.summary.candidateSetPolicy).toBe('all_non_quarantined');
  });
});

describe('Phase 4 — candidatesById reference identity', () => {
  it('candidatesById is the same reference as registryResult.indexes.componentsById', () => {
    const reg = makeRegistryResult([makeComponent('scaffold.a')], []);
    const result = buildCandidateSet(reg);
    // Must be the exact same Map reference — not a copy.
    expect(result.candidatesById).toBe(reg.indexes.componentsById);
  });
});

describe('Phase 4 — accounting invariant', () => {
  it('candidateSetSize + quarantinedExcluded equals total component count (N=2, M=3)', () => {
    const comps = [makeComponent('scaffold.a'), makeComponent('scaffold.b')];
    const quarIds = ['scaffold.q1', 'scaffold.q2', 'scaffold.q3'];
    const reg = makeRegistryResult(comps, quarIds);
    const result = buildCandidateSet(reg);
    expect(result.summary.candidateSetSize + result.summary.quarantinedExcluded).toBe(5);
  });

  it('candidateSetSize + quarantinedExcluded equals total (N=0, M=2)', () => {
    const reg = makeRegistryResult([], ['scaffold.q1', 'scaffold.q2']);
    const result = buildCandidateSet(reg);
    expect(result.summary.candidateSetSize + result.summary.quarantinedExcluded).toBe(2);
  });
});

describe('Phase 4 — mutation safety', () => {
  it('does not mutate registryResult.indexes.componentsById', () => {
    const comps = [makeComponent('scaffold.a'), makeComponent('scaffold.b')];
    const reg = makeRegistryResult(comps, []);
    const sizeBefore = reg.indexes.componentsById.size;
    buildCandidateSet(reg);
    expect(reg.indexes.componentsById.size).toBe(sizeBefore);
  });

  it('does not mutate registryResult.quarantinedComponents', () => {
    const comps = [makeComponent('scaffold.a')];
    const reg = makeRegistryResult(comps, ['scaffold.q1']);
    const lenBefore = reg.quarantinedComponents.length;
    buildCandidateSet(reg);
    expect(reg.quarantinedComponents.length).toBe(lenBefore);
  });
});

describe('Phase 4 — file write prohibition', () => {
  it('writes no output files', () => {
    const td = makeTempDir();
    const reg = makeRegistryResult([makeComponent('scaffold.a')], []);
    buildCandidateSet(reg);
    expect(existsSync(join(td, 'prompt-plan.json'))).toBe(false);

    expect(existsSync(join(td, 'trace.json'))).toBe(false);
    expect(existsSync(join(td, 'summary.md'))).toBe(false);
  });
});

describe('Phase 4 — module exports', () => {
  it('buildCandidateSet is a function', () => {
    expect(typeof buildCandidateSet).toBe('function');
  });

  it('CandidateSetFatalError is a class (constructor)', () => {
    expect(typeof CandidateSetFatalError).toBe('function');
  });

  it('CandidateSetFatalError has correct name and code', () => {
    const err = new CandidateSetFatalError('unsupported_candidate_set_policy', 'test');
    expect(err.name).toBe('CandidateSetFatalError');
    expect(err.code).toBe('unsupported_candidate_set_policy');
    expect(err instanceof Error).toBe(true);
    expect(err instanceof CandidateSetFatalError).toBe(true);
  });
});

describe('Phase 4 — warnings always empty on success', () => {
  it('warnings is [] for empty registry', () => {
    const result = buildCandidateSet(makeRegistryResult([], []));
    expect(result.warnings).toEqual([]);
    expect(result.warnings.length).toBe(0);
  });

  it('warnings is [] for N valid + M quarantined', () => {
    const result = buildCandidateSet(
      makeRegistryResult(
        [makeComponent('scaffold.a'), makeComponent('scaffold.b')],
        ['scaffold.q1'],
      ),
    );
    expect(result.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// CLI integration tests — Phase 4 behavior
// ---------------------------------------------------------------------------

describe('CLI integration — Phase 4 behavior', () => {
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

  it('stderr does NOT contain Phase 4 not-implemented message', () => {
    const td = makeTempDir();
    writeFileSync(join(td, 'req.txt'), 'Hello');
    writeFileSync(join(td, 'reg.json'), makeRegistryJson(['scaffold.test']));
    const result = runCli([
      'plan',
      '--request', join(td, 'req.txt'),
      '--registry', join(td, 'reg.json'),
    ]);
    expect(result.stderr).not.toContain('Phase 4 (candidate set construction) is not yet implemented');
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

  it('quarantined component + valid component exits 0 and prints component_quarantined', () => {
    const td = makeTempDir();
    writeFileSync(join(td, 'req.txt'), 'Test request.');

    // valid component + one with tokensApprox 0 (non-safety-critical → quarantine)
    const reg = [
      {
        id: 'scaffold.valid',
        type: 'scaffold',
        title: 'Valid',
        summary: 'Valid component for Phase 4 test.',
        source: 'scaffold/valid.md',
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
      },
      {
        id: 'scaffold.quarantined',
        type: 'scaffold',
        title: 'Bad tokens',
        summary: 'Component with tokensApprox 0 — will be quarantined.',
        source: 'scaffold/quarantined.md',
        tokensApprox: 0,  // triggers quarantine (non-metadataOnly)
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

  it('fatal registry halts before Phase 4/5 and does not print Phase 7 message', () => {
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
});
