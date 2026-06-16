import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { extractWorkspace } from '../src/extract.js';

const WS = fileURLToPath(new URL('../example-workspace', import.meta.url));

describe('extractWorkspace', () => {
  const { registry, bodies } = extractWorkspace(WS);

  it('extracts every component file from the example workspace', () => {
    expect(registry.length).toBe(14);
  });

  it('emits schema-shaped entries (18 fields, valid enums, real hash)', () => {
    const TYPES = new Set(['scaffold', 'skill', 'tool', 'history', 'memory', 'output_format']);
    const RISKS = new Set(['low', 'medium', 'high', 'critical']);
    const ACTIONS = new Set(['include', 'omit', 'defer']);
    const OMISSIONS = new Set(['allow', 'fail_open', 'never']);
    const RETAINS = new Set(['optional', 'durable', 'mandatory', 'safety_critical']);
    for (const c of registry) {
      expect(c.id).toMatch(/^[a-z][a-z0-9._-]*$/);
      expect(TYPES.has(c.type)).toBe(true);
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.title.length).toBeLessThanOrEqual(120);
      expect(c.summary.length).toBeGreaterThan(0);
      expect(c.summary.length).toBeLessThanOrEqual(300);
      expect(c.source.length).toBeGreaterThan(0);
      expect(c.tokensApprox).toBeGreaterThanOrEqual(1);
      expect(c.charsApprox).toBeGreaterThanOrEqual(0);
      expect(RISKS.has(c.riskLevel)).toBe(true);
      expect(ACTIONS.has(c.defaultAction)).toBe(true);
      expect(OMISSIONS.has(c.omissionPolicy)).toBe(true);
      expect(RETAINS.has(c.retainPolicy)).toBe(true);
      expect(c.budgetPriority).toBeGreaterThanOrEqual(1);
      expect(c.budgetPriority).toBeLessThanOrEqual(10);
      expect(c.evidenceRequired).toBeNull();
      expect(Array.isArray(c.requiredWhen)).toBe(true);
      expect(Array.isArray(c.safeToOmitWhen)).toBe(true);
      expect(Array.isArray(c.tags)).toBe(true);
      expect(typeof c.version).toBe('string');
      expect(c.hash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('produces unique component ids', () => {
    const ids = registry.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('measures sizes from the body and parses frontmatter governance', () => {
    const coding = registry.find((c) => c.id === 'skill.coding-guide');
    expect(coding).toBeDefined();
    expect(coding!.type).toBe('skill');
    expect(coding!.requiredWhen).toContain('coding_build_debug');
    expect(coding!.defaultAction).toBe('omit');

    const body = bodies.get('skill.coding-guide') ?? '';
    expect(body.length).toBe(coding!.charsApprox);
    expect(coding!.tokensApprox).toBe(Math.max(1, Math.ceil(body.length / 4)));
    expect(body.startsWith('---')).toBe(false); // frontmatter stripped from the cached body
  });

  it('DQ-5 normalization: critical component is hard-protected with defaultAction include', () => {
    const rules = registry.find((c) => c.id === 'scaffold.system-rules');
    expect(rules).toBeDefined();
    expect(rules!.riskLevel).toBe('critical');
    expect(rules!.omissionPolicy).toBe('never');
    expect(rules!.defaultAction).toBe('include');
  });

  it('caches a body for every registry id', () => {
    for (const c of registry) expect(bodies.has(c.id)).toBe(true);
  });

  it('throws on a missing workspace directory', () => {
    expect(() => extractWorkspace(`${WS}-does-not-exist`)).toThrow();
  });
});
