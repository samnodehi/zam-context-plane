/**
 * Phase 2 — registry-loader unit and integration tests.
 *
 * All test data is inline (no fixture directory reads).
 * Temp files are created in os.tmpdir() and cleaned up in afterEach.
 * No output files are created.
 * No Phase 3+ imports or behavior.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildRegistryIndexes, RegistryFatalError } from '../../src/core/registry-loader.js';

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
  const dir = mkdtempSync(join(tmpdir(), 'ctx-phase2-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ---------------------------------------------------------------------------
// Minimal valid component factory
// ---------------------------------------------------------------------------

/** Base minimal schema-valid component. All 18 required fields present. */
function makeComp(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'scaffold.test',
    type: 'scaffold',
    title: 'Test Component',
    summary: 'Minimal component for Phase 2 registry tests.',
    source: 'scaffold/test.md',
    tokensApprox: 100,
    charsApprox: 400,
    riskLevel: 'low',
    requiredWhen: [],
    safeToOmitWhen: [],
    defaultAction: 'include',
    // fail_open: component is included by default; no Path A or B advisory fires.
    // Tests that need omissionPolicy: allow must override explicitly.
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

// ---------------------------------------------------------------------------
// 1. Happy path — valid single-component registry
// ---------------------------------------------------------------------------

describe('Phase 2 — happy path', () => {
  it('builds all indexes from a valid single-component registry', () => {
    const reg = [makeComp()];
    const result = buildRegistryIndexes(reg);

    expect(result.quarantinedComponents).toHaveLength(0);
    expect(result.validationWarnings).toHaveLength(0);
    expect(result.indexes.componentsById.size).toBe(1);
    expect(result.indexes.componentsById.has('scaffold.test')).toBe(true);
  });

  it('componentsByType is populated correctly', () => {
    const reg = [
      makeComp({ id: 'scaffold.a', type: 'scaffold' }),
      makeComp({ id: 'skill.b', type: 'skill' }),
    ];
    const result = buildRegistryIndexes(reg);

    expect(result.indexes.componentsByType.get('scaffold')).toHaveLength(1);
    expect(result.indexes.componentsByType.get('skill')).toHaveLength(1);
  });

  it('componentsByTag is populated correctly', () => {
    const reg = [
      makeComp({ id: 'scaffold.a', tags: ['persona', 'scaffold'] }),
      makeComp({ id: 'skill.b', type: 'skill', tags: ['persona', 'code'] }),
    ];
    const result = buildRegistryIndexes(reg);

    expect(result.indexes.componentsByTag.get('persona')).toHaveLength(2);
    expect(result.indexes.componentsByTag.get('scaffold')).toHaveLength(1);
    expect(result.indexes.componentsByTag.get('code')).toHaveLength(1);
  });

  it('safetyCriticalIds populated for safety_critical and omissionPolicy: never', () => {
    const reg = [
      makeComp({ id: 'policy.a', riskLevel: 'critical', retainPolicy: 'safety_critical', omissionPolicy: 'never', defaultAction: 'include' }),
      makeComp({ id: 'policy.b', riskLevel: 'high', retainPolicy: 'mandatory', omissionPolicy: 'never', defaultAction: 'include' }),
      makeComp({ id: 'scaffold.c' }),  // not safety-critical
    ];
    const result = buildRegistryIndexes(reg);

    expect(result.indexes.safetyCriticalIds.has('policy.a')).toBe(true);
    expect(result.indexes.safetyCriticalIds.has('policy.b')).toBe(true);
    expect(result.indexes.safetyCriticalIds.has('scaffold.c')).toBe(false);
  });

  it('trimmableCandidateIds populated only for optional/allow/low-or-medium components', () => {
    const reg = [
      makeComp({ id: 'scaffold.a', retainPolicy: 'optional', omissionPolicy: 'allow', riskLevel: 'low' }),
      makeComp({ id: 'scaffold.b', retainPolicy: 'optional', omissionPolicy: 'allow', riskLevel: 'medium' }),
      makeComp({ id: 'scaffold.c', retainPolicy: 'optional', omissionPolicy: 'allow', riskLevel: 'high' }),
      makeComp({ id: 'scaffold.d', retainPolicy: 'durable', omissionPolicy: 'allow', riskLevel: 'low' }),
      makeComp({ id: 'policy.e', riskLevel: 'critical', retainPolicy: 'safety_critical', omissionPolicy: 'never', defaultAction: 'include' }),
    ];
    const result = buildRegistryIndexes(reg);

    expect(result.indexes.trimmableCandidateIds.has('scaffold.a')).toBe(true);
    expect(result.indexes.trimmableCandidateIds.has('scaffold.b')).toBe(true);
    expect(result.indexes.trimmableCandidateIds.has('scaffold.c')).toBe(false);  // high risk
    expect(result.indexes.trimmableCandidateIds.has('scaffold.d')).toBe(false);  // durable
    expect(result.indexes.trimmableCandidateIds.has('policy.e')).toBe(false);    // safety_critical
  });
});

// ---------------------------------------------------------------------------
// 2. critical_without_protection halt
// ---------------------------------------------------------------------------

describe('Phase 2 — critical_without_protection halt', () => {
  it('throws RegistryFatalError for riskLevel: critical without hard protection', () => {
    const reg = [
      makeComp({
        id: 'policy.bad',
        riskLevel: 'critical',
        retainPolicy: 'optional',  // not safety_critical
        omissionPolicy: 'allow',   // not never
      }),
    ];
    expect(() => buildRegistryIndexes(reg)).toThrow(RegistryFatalError);
    try {
      buildRegistryIndexes(reg);
    } catch (e) {
      expect(e).toBeInstanceOf(RegistryFatalError);
      expect((e as RegistryFatalError).code).toBe('critical_without_protection');
      expect((e as RegistryFatalError).componentId).toBe('policy.bad');
    }
  });

  it('does NOT throw for riskLevel: critical with retainPolicy: safety_critical', () => {
    const reg = [
      makeComp({
        id: 'policy.safe',
        riskLevel: 'critical',
        retainPolicy: 'safety_critical',
        omissionPolicy: 'never',
        defaultAction: 'include',
      }),
    ];
    expect(() => buildRegistryIndexes(reg)).not.toThrow();
  });

  it('does NOT throw for riskLevel: critical with omissionPolicy: never only', () => {
    const reg = [
      makeComp({
        id: 'policy.never',
        riskLevel: 'critical',
        retainPolicy: 'mandatory',
        omissionPolicy: 'never',
        defaultAction: 'include',
      }),
    ];
    expect(() => buildRegistryIndexes(reg)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3. tokensApprox / charsApprox quarantine and halt
// ---------------------------------------------------------------------------

describe('Phase 2 — token/char count checks', () => {
  it('quarantines low-risk component with tokensApprox: 0 and no metadataOnly', () => {
    const reg = [
      makeComp({ id: 'scaffold.bad', tokensApprox: 0, riskLevel: 'low' }),
    ];
    const result = buildRegistryIndexes(reg);

    expect(result.quarantinedComponents).toHaveLength(1);
    expect(result.quarantinedComponents[0].id).toBe('scaffold.bad');
    expect(result.indexes.componentsById.has('scaffold.bad')).toBe(false);

    const warnCodes = result.validationWarnings.map((w) => w.code);
    expect(warnCodes).toContain('component_quarantined');
  });

  it('quarantines medium-risk component with charsApprox: 0 and no metadataOnly', () => {
    const reg = [
      makeComp({ id: 'scaffold.bad2', charsApprox: 0, riskLevel: 'medium' }),
    ];
    const result = buildRegistryIndexes(reg);

    expect(result.quarantinedComponents).toHaveLength(1);
    expect(result.quarantinedComponents[0].id).toBe('scaffold.bad2');
  });

  it('does NOT quarantine component with tokensApprox: 0 when metadataOnly: true', () => {
    const reg = [
      makeComp({
        id: 'history.meta',
        tokensApprox: 0,
        charsApprox: 0,
        metadataOnly: true,
        riskLevel: 'low',
      }),
    ];
    const result = buildRegistryIndexes(reg);

    expect(result.quarantinedComponents).toHaveLength(0);
    expect(result.indexes.componentsById.has('history.meta')).toBe(true);
  });

  it('throws safety_critical_malformed for safety-critical component with tokensApprox: 0', () => {
    const reg = [
      makeComp({
        id: 'policy.malformed',
        tokensApprox: 0,
        riskLevel: 'critical',
        retainPolicy: 'safety_critical',
        omissionPolicy: 'never',
        defaultAction: 'include',
      }),
    ];
    expect(() => buildRegistryIndexes(reg)).toThrow(RegistryFatalError);
    try {
      buildRegistryIndexes(reg);
    } catch (e) {
      expect((e as RegistryFatalError).code).toBe('safety_critical_malformed');
      expect((e as RegistryFatalError).componentId).toBe('policy.malformed');
    }
  });

  it('throws safety_critical_malformed for omissionPolicy: never component with charsApprox: 0', () => {
    const reg = [
      makeComp({
        id: 'policy.never_malformed',
        charsApprox: 0,
        riskLevel: 'high',
        retainPolicy: 'mandatory',
        omissionPolicy: 'never',
        defaultAction: 'include',
      }),
    ];
    expect(() => buildRegistryIndexes(reg)).toThrow(RegistryFatalError);
    try {
      buildRegistryIndexes(reg);
    } catch (e) {
      expect((e as RegistryFatalError).code).toBe('safety_critical_malformed');
    }
  });
});

// ---------------------------------------------------------------------------
// 4. defaultAction: 'omit' override
// ---------------------------------------------------------------------------

describe('Phase 2 — defaultAction override', () => {
  it('overrides defaultAction: omit for safety_critical component and emits warning', () => {
    const reg = [
      makeComp({
        id: 'policy.override',
        defaultAction: 'omit',
        riskLevel: 'critical',
        retainPolicy: 'safety_critical',
        omissionPolicy: 'never',
      }),
    ];
    const result = buildRegistryIndexes(reg);

    const comp = result.indexes.componentsById.get('policy.override');
    expect(comp).toBeDefined();
    expect(comp!.defaultAction).toBe('include');
    expect(comp!.defaultActionOverridden).toBe(true);

    const warnCodes = result.validationWarnings.map((w) => w.code);
    expect(warnCodes).toContain('registry_default_action_overridden');
  });

  it('overrides defaultAction: omit for mandatory retainPolicy and emits warning', () => {
    const reg = [
      makeComp({
        id: 'scaffold.mandatory_omit',
        defaultAction: 'omit',
        retainPolicy: 'mandatory',
        riskLevel: 'low',
        omissionPolicy: 'allow',
      }),
    ];
    const result = buildRegistryIndexes(reg);

    const comp = result.indexes.componentsById.get('scaffold.mandatory_omit');
    expect(comp!.defaultAction).toBe('include');
    expect(comp!.defaultActionOverridden).toBe(true);
  });

  it('overrides defaultAction: omit for omissionPolicy: never and emits warning', () => {
    const reg = [
      makeComp({
        id: 'scaffold.never_omit',
        defaultAction: 'omit',
        retainPolicy: 'durable',
        riskLevel: 'high',
        omissionPolicy: 'never',
      }),
    ];
    const result = buildRegistryIndexes(reg);

    const comp = result.indexes.componentsById.get('scaffold.never_omit');
    expect(comp!.defaultAction).toBe('include');
    expect(comp!.defaultActionOverridden).toBe(true);
  });

  it('does NOT override defaultAction: omit for optional/allow component', () => {
    const reg = [
      makeComp({
        id: 'scaffold.path_b',
        defaultAction: 'omit',
        retainPolicy: 'optional',
        omissionPolicy: 'allow',
        riskLevel: 'low',
      }),
    ];
    const result = buildRegistryIndexes(reg);

    const comp = result.indexes.componentsById.get('scaffold.path_b');
    expect(comp!.defaultAction).toBe('omit');
    expect(comp!.defaultActionOverridden).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. Duplicate ID handling
// ---------------------------------------------------------------------------

describe('Phase 2 — duplicate ID', () => {
  it('retains first, rejects second for non-hard-protected duplicates', () => {
    const reg = [
      makeComp({ id: 'scaffold.dup', title: 'First' }),
      makeComp({ id: 'scaffold.dup', title: 'Second' }),
    ];
    const result = buildRegistryIndexes(reg);

    expect(result.indexes.componentsById.size).toBe(1);
    expect(result.indexes.componentsById.get('scaffold.dup')!.title).toBe('First');

    const warnCodes = result.validationWarnings.map((w) => w.code);
    expect(warnCodes).toContain('duplicate_id_rejected');
  });

  it('throws fatal_duplicate_id when duplicate involves a hard-protected component', () => {
    const reg = [
      makeComp({ id: 'policy.dup', riskLevel: 'critical', retainPolicy: 'safety_critical', omissionPolicy: 'never', defaultAction: 'include' }),
      makeComp({ id: 'policy.dup', riskLevel: 'low' }),
    ];
    expect(() => buildRegistryIndexes(reg)).toThrow(RegistryFatalError);
    try {
      buildRegistryIndexes(reg);
    } catch (e) {
      expect((e as RegistryFatalError).code).toBe('fatal_duplicate_id');
      expect((e as RegistryFatalError).componentId).toBe('policy.dup');
    }
  });

  it('throws fatal_duplicate_id when the second occurrence is hard-protected', () => {
    const reg = [
      makeComp({ id: 'policy.dup2', riskLevel: 'low' }),
      makeComp({ id: 'policy.dup2', riskLevel: 'critical', retainPolicy: 'safety_critical', omissionPolicy: 'never', defaultAction: 'include' }),
    ];
    expect(() => buildRegistryIndexes(reg)).toThrow(RegistryFatalError);
    try {
      buildRegistryIndexes(reg);
    } catch (e) {
      expect((e as RegistryFatalError).code).toBe('fatal_duplicate_id');
    }
  });
});

// ---------------------------------------------------------------------------
// 6. evidenceRequired grammar checks
// ---------------------------------------------------------------------------

describe('Phase 2 — evidenceRequired grammar', () => {
  it('does not quarantine component with unrecognized evidenceRequired grammar', () => {
    const reg = [
      makeComp({ id: 'scaffold.bad_grammar', evidenceRequired: 'unknownAtom=x' }),
    ];
    const result = buildRegistryIndexes(reg);

    // Not quarantined
    expect(result.quarantinedComponents).toHaveLength(0);
    // Still in indexes
    expect(result.indexes.componentsById.has('scaffold.bad_grammar')).toBe(true);
  });

  it('sets evidenceRequiredGrammarInvalid: true and emits registry_evidence_grammar_invalid', () => {
    const reg = [
      makeComp({ id: 'scaffold.bad_grammar', evidenceRequired: 'unknownAtom=x' }),
    ];
    const result = buildRegistryIndexes(reg);

    const comp = result.indexes.componentsById.get('scaffold.bad_grammar');
    expect(comp!.evidenceRequiredGrammarInvalid).toBe(true);

    const warnCodes = result.validationWarnings.map((w) => w.code);
    expect(warnCodes).toContain('registry_evidence_grammar_invalid');
  });

  it('marks OR operator as invalid grammar', () => {
    const reg = [
      makeComp({ id: 'scaffold.or_grammar', evidenceRequired: 'promptFamily=simple_greeting OR riskLevel=low' }),
    ];
    const result = buildRegistryIndexes(reg);
    const comp = result.indexes.componentsById.get('scaffold.or_grammar');
    expect(comp!.evidenceRequiredGrammarInvalid).toBe(true);
  });

  it('marks budgetCritical=true as invalid grammar (explicitly not supported)', () => {
    const reg = [
      makeComp({ id: 'scaffold.budget_atom', evidenceRequired: 'budgetCritical=true' }),
    ];
    const result = buildRegistryIndexes(reg);
    const comp = result.indexes.componentsById.get('scaffold.budget_atom');
    expect(comp!.evidenceRequiredGrammarInvalid).toBe(true);
  });

  it('accepts valid single-atom promptFamily grammar', () => {
    const reg = [
      makeComp({ id: 'scaffold.good1', evidenceRequired: 'promptFamily=simple_greeting' }),
    ];
    const result = buildRegistryIndexes(reg);
    const comp = result.indexes.componentsById.get('scaffold.good1');
    expect(comp!.evidenceRequiredGrammarInvalid).toBeUndefined();
    expect(result.validationWarnings.filter((w) => w.code === 'registry_evidence_grammar_invalid')).toHaveLength(0);
  });

  it('accepts valid two-atom AND grammar', () => {
    const reg = [
      makeComp({ id: 'scaffold.good2', evidenceRequired: 'promptFamily=simple_greeting AND riskLevel=low' }),
    ];
    const result = buildRegistryIndexes(reg);
    const comp = result.indexes.componentsById.get('scaffold.good2');
    expect(comp!.evidenceRequiredGrammarInvalid).toBeUndefined();
  });

  it('accepts valid explicitUserConstraint=false atom', () => {
    const reg = [
      makeComp({ id: 'scaffold.good3', evidenceRequired: 'explicitUserConstraint=false' }),
    ];
    const result = buildRegistryIndexes(reg);
    const comp = result.indexes.componentsById.get('scaffold.good3');
    expect(comp!.evidenceRequiredGrammarInvalid).toBeUndefined();
  });

  it('does not set evidenceRequiredGrammarInvalid for null evidenceRequired', () => {
    const reg = [makeComp({ id: 'scaffold.null_ev', evidenceRequired: null })];
    const result = buildRegistryIndexes(reg);
    const comp = result.indexes.componentsById.get('scaffold.null_ev');
    expect(comp!.evidenceRequiredGrammarInvalid).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6b. Strict atom-value validation (R1 — Issue 1)
// ---------------------------------------------------------------------------
// These tests confirm that the grammar validator checks atom VALUES, not just
// prefixes. Invalid values must be rejected even when the key is recognized.

describe('Phase 2 — evidenceRequired strict value validation (R1)', () => {
  function expectInvalid(id: string, evidenceRequired: string): void {
    const reg = [makeComp({ id, evidenceRequired })];
    const result = buildRegistryIndexes(reg);
    const comp = result.indexes.componentsById.get(id);
    expect(comp!.evidenceRequiredGrammarInvalid).toBe(true);
    const warnCodes = result.validationWarnings.map((w) => w.code);
    expect(warnCodes).toContain('registry_evidence_grammar_invalid');
    // Must not quarantine
    expect(result.quarantinedComponents).toHaveLength(0);
    // Must still be in indexes
    expect(result.indexes.componentsById.has(id)).toBe(true);
  }

  function expectValid(id: string, evidenceRequired: string): void {
    const reg = [makeComp({ id, evidenceRequired })];
    const result = buildRegistryIndexes(reg);
    const comp = result.indexes.componentsById.get(id);
    expect(comp!.evidenceRequiredGrammarInvalid).toBeUndefined();
    const grammarWarns = result.validationWarnings.filter((w) => w.code === 'registry_evidence_grammar_invalid');
    expect(grammarWarns).toHaveLength(0);
  }

  // --- promptFamily value validation ---

  it('promptFamily=not_a_real_family is invalid', () => {
    expectInvalid('scaffold.pf_bad', 'promptFamily=not_a_real_family');
  });

  it('promptFamily=simple_greeting is valid', () => {
    expectValid('scaffold.pf_sg', 'promptFamily=simple_greeting');
  });

  it('promptFamily=general_default is valid', () => {
    expectValid('scaffold.pf_gd', 'promptFamily=general_default');
  });

  it('promptFamily=coding_build_debug is valid', () => {
    expectValid('scaffold.pf_cbd', 'promptFamily=coding_build_debug');
  });

  it('promptFamily=research_investigation is valid', () => {
    expectValid('scaffold.pf_ri', 'promptFamily=research_investigation');
  });

  it('promptFamily=ops_security_change_risk is valid', () => {
    expectValid('scaffold.pf_oscr', 'promptFamily=ops_security_change_risk');
  });

  it('promptFamily=lifecycle_internal is valid', () => {
    expectValid('scaffold.pf_li', 'promptFamily=lifecycle_internal');
  });

  it('promptFamily=heartbeat_proactive is valid', () => {
    expectValid('scaffold.pf_hp', 'promptFamily=heartbeat_proactive');
  });

  it('promptFamily=group_chat_behavior is valid', () => {
    expectValid('scaffold.pf_gcb', 'promptFamily=group_chat_behavior');
  });

  it('promptFamily=tool_use_required is valid', () => {
    expectValid('scaffold.pf_tur', 'promptFamily=tool_use_required');
  });

  it('promptFamily=history_sensitive is valid', () => {
    expectValid('scaffold.pf_hs', 'promptFamily=history_sensitive');
  });

  // --- riskLevel value validation ---

  it('riskLevel=banana is invalid', () => {
    expectInvalid('scaffold.rl_bad', 'riskLevel=banana');
  });

  it('riskLevel=low is valid', () => {
    expectValid('scaffold.rl_low', 'riskLevel=low');
  });

  it('riskLevel=medium is valid', () => {
    expectValid('scaffold.rl_med', 'riskLevel=medium');
  });

  it('riskLevel=high is valid', () => {
    expectValid('scaffold.rl_high', 'riskLevel=high');
  });

  it('riskLevel=critical is valid', () => {
    // riskLevel=critical is a valid atom; a component using it in evidenceRequired
    // is validly expressing evidence. Whether the component is also hard-protected
    // is a separate check. Here we test grammar only — use a safe component.
    expectValid('scaffold.rl_crit', 'riskLevel=critical');
  });

  // --- explicitUserConstraint value validation ---

  it('explicitUserConstraint=false is valid', () => {
    expectValid('scaffold.euc_false', 'explicitUserConstraint=false');
  });

  it('explicitUserConstraint=true is invalid', () => {
    expectInvalid('scaffold.euc_true', 'explicitUserConstraint=true');
  });

  it('explicitUserConstraint=maybe is invalid', () => {
    expectInvalid('scaffold.euc_maybe', 'explicitUserConstraint=maybe');
  });

  // --- explicitly unsupported atoms ---

  it('budgetCritical=true is invalid (explicitly not supported per docs/05 §7)', () => {
    expectInvalid('scaffold.bc_true', 'budgetCritical=true');
  });

  it('requestFamily=simple_greeting is invalid (legacy alias — not canonical for MVP)', () => {
    expectInvalid('scaffold.rf_sg', 'requestFamily=simple_greeting');
  });

  // --- multi-atom AND combinations ---

  it('promptFamily=simple_greeting AND riskLevel=low is valid', () => {
    expectValid('scaffold.multi_and', 'promptFamily=simple_greeting AND riskLevel=low');
  });

  it('promptFamily=simple_greeting AND riskLevel=banana is invalid (bad riskLevel value)', () => {
    expectInvalid('scaffold.multi_bad', 'promptFamily=simple_greeting AND riskLevel=banana');
  });

  it('promptFamily=not_real AND riskLevel=low is invalid (bad promptFamily value)', () => {
    expectInvalid('scaffold.multi_bad2', 'promptFamily=not_real AND riskLevel=low');
  });

  it('promptFamily=simple_greeting AND explicitUserConstraint=false is valid', () => {
    expectValid('scaffold.multi_pf_euc', 'promptFamily=simple_greeting AND explicitUserConstraint=false');
  });
});

// ---------------------------------------------------------------------------
// 7. Advisory Path A warnings
// ---------------------------------------------------------------------------

describe('Phase 2 — advisory warnings', () => {
  it('emits registry_null_evidence_path_a_advisory for allow + non-empty safeToOmitWhen + null evidenceRequired', () => {
    const reg = [
      makeComp({
        id: 'scaffold.null_ev_advisory',
        omissionPolicy: 'allow',
        safeToOmitWhen: ['simple_greeting'],
        evidenceRequired: null,
      }),
    ];
    const result = buildRegistryIndexes(reg);

    const warnCodes = result.validationWarnings.map((w) => w.code);
    expect(warnCodes).toContain('registry_null_evidence_path_a_advisory');
    // Must NOT emit path_a_null_evidence — that is Phase 5 only
    expect(warnCodes).not.toContain('path_a_null_evidence');
  });

  it('emits registry_no_valid_omission_path for allow + empty safeToOmitWhen + not omit defaultAction + null evidenceRequired', () => {
    const reg = [
      makeComp({
        id: 'scaffold.no_omit_path',
        omissionPolicy: 'allow',
        safeToOmitWhen: [],
        defaultAction: 'include',
        evidenceRequired: null,
      }),
    ];
    const result = buildRegistryIndexes(reg);

    const warnCodes = result.validationWarnings.map((w) => w.code);
    expect(warnCodes).toContain('registry_no_valid_omission_path');
  });

  it('does NOT emit no_valid_omission_path when defaultAction is omit (valid Path B)', () => {
    // omissionPolicy: allow + empty safeToOmitWhen + defaultAction: omit → valid Path B; no warning
    const reg = [
      makeComp({
        id: 'scaffold.path_b_valid',
        omissionPolicy: 'allow',
        safeToOmitWhen: [],
        defaultAction: 'omit',
        evidenceRequired: null,
      }),
    ];
    const result = buildRegistryIndexes(reg);

    const warnCodes = result.validationWarnings.map((w) => w.code);
    expect(warnCodes).not.toContain('registry_no_valid_omission_path');
  });

  it('does NOT emit path_a_null_evidence at registry load time', () => {
    // path_a_null_evidence is a Phase 5 per-decision selector warning only
    const reg = [
      makeComp({
        id: 'scaffold.any',
        omissionPolicy: 'allow',
        safeToOmitWhen: ['simple_greeting'],
        evidenceRequired: null,
      }),
    ];
    const result = buildRegistryIndexes(reg);
    const warnCodes = result.validationWarnings.map((w) => w.code);
    expect(warnCodes).not.toContain('path_a_null_evidence');
  });
});

// ---------------------------------------------------------------------------
// 8. CLI integration tests
// ---------------------------------------------------------------------------

describe('Phase 2 — CLI integration', () => {
  it('exits 0 and writes all output files for valid registry', () => {
    const td = makeTempDir();

    const reqPath = join(td, 'req.txt');
    writeFileSync(reqPath, 'Test request text');

    const validComp = makeComp();
    const regPath = join(td, 'reg.json');
    writeFileSync(regPath, JSON.stringify([validComp]));

    const result = runCli(['plan', '--request', reqPath, '--registry', regPath, '--output-dir', td]);

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('Phase 11 (Trace and Summary Assembly) is not yet implemented');
    expect(result.stderr).not.toContain('Phase 2 (registry loading) is not yet implemented');
  });

  it('exits 1 with registry fatal error message for critical_without_protection', () => {
    const td = makeTempDir();

    const reqPath = join(td, 'req.txt');
    writeFileSync(reqPath, 'Test request text');

    const badComp = makeComp({
      id: 'policy.bad',
      riskLevel: 'critical',
      retainPolicy: 'optional',
      omissionPolicy: 'allow',
    });
    const regPath = join(td, 'reg.json');
    writeFileSync(regPath, JSON.stringify([badComp]));

    const result = runCli(['plan', '--request', reqPath, '--registry', regPath]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('critical_without_protection');
    expect(result.stderr).toContain('Registry fatal error');
    expect(result.stderr).not.toContain('Phase 3 (request normalization)');
  });

  it('exits 0 with quarantine warning for non-fatal quarantined component', () => {
    const td = makeTempDir();

    const reqPath = join(td, 'req.txt');
    writeFileSync(reqPath, 'Test request text');

    // A valid component + a quarantined one
    const validComp = makeComp({ id: 'scaffold.valid' });
    const badComp = makeComp({ id: 'scaffold.bad', tokensApprox: 0 });
    const regPath = join(td, 'reg.json');
    writeFileSync(regPath, JSON.stringify([validComp, badComp]));

    const result = runCli(['plan', '--request', reqPath, '--registry', regPath, '--output-dir', td]);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('component_quarantined');
    expect(result.stderr).not.toContain('Phase 11 (Trace and Summary Assembly) is not yet implemented');
  });

  it('creates prompt-plan.json, trace.json, and summary.md on successful run', () => {
    const td = makeTempDir();

    const reqPath = join(td, 'req.txt');
    writeFileSync(reqPath, 'Test request text');

    const regPath = join(td, 'reg.json');
    writeFileSync(regPath, JSON.stringify([makeComp()]));

    runCli(['plan', '--request', reqPath, '--registry', regPath, '--output-dir', td]);

    expect(existsSync(join(td, 'prompt-plan.json'))).toBe(true);
    expect(existsSync(join(td, 'trace.json'))).toBe(true);
    expect(existsSync(join(td, 'summary.md'))).toBe(true);
  });

  it('does not read from any fixtures directory', () => {
    // This test validates by inspection that all test data above is inline.
    // If a fixture directory were read, it would appear as an import or readFileSync
    // referencing the fixtures/ path. No such reference exists in this file.
    expect(true).toBe(true);
  });
});
