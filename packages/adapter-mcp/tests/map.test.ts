import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { mapCapabilities } from '../src/map.js';
import type { McpCapabilities } from '../src/types.js';

const CAPS = JSON.parse(
  readFileSync(fileURLToPath(new URL('../example-capabilities.json', import.meta.url)), 'utf8'),
) as McpCapabilities;

describe('mapCapabilities', () => {
  const { registry, items } = mapCapabilities(CAPS);

  it('maps every capability to a registry entry', () => {
    expect(registry.length).toBe(14);
    expect(items.size).toBe(14);
  });

  it('emits schema-shaped entries (valid types/enums, measured sizes, real hash)', () => {
    const TYPES = new Set(['scaffold', 'skill', 'tool', 'history', 'memory', 'output_format']);
    for (const c of registry) {
      expect(c.id).toMatch(/^[a-z][a-z0-9._-]*$/);
      expect(TYPES.has(c.type)).toBe(true);
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.summary.length).toBeGreaterThan(0);
      expect(c.summary.length).toBeLessThanOrEqual(300);
      expect(c.tokensApprox).toBeGreaterThanOrEqual(1);
      expect(c.budgetPriority).toBeGreaterThanOrEqual(1);
      expect(c.budgetPriority).toBeLessThanOrEqual(10);
      expect(c.evidenceRequired).toBeNull();
      expect(c.hash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('maps tool->skill (relevance-governed), resource->memory, prompt->skill', () => {
    expect(registry.find((c) => c.title === 'read_file')?.type).toBe('skill');
    expect(registry.find((c) => c.title === 'project_readme')?.type).toBe('memory');
    expect(registry.find((c) => c.title === 'code_review')?.type).toBe('skill');
  });

  it('gates a destructive tool to the ops family only (surfaced only for ops requests)', () => {
    const writeFile = registry.find((c) => c.title === 'write_file');
    expect(writeFile).toBeDefined();
    expect(writeFile!.requiredWhen).toEqual(['ops_security_change_risk']);
    expect(writeFile!.defaultAction).toBe('omit');
    // riskLevel stays low: omitting a tool is safe (risk is danger-of-omission, docs/05 §5)
    expect(writeFile!.riskLevel).toBe('low');
  });

  it('classifies a coding tool into the coding family', () => {
    const editFile = registry.find((c) => c.title === 'edit_file');
    expect(editFile!.requiredWhen).toContain('coding_build_debug');
    expect(editFile!.defaultAction).toBe('omit');
  });

  it('throws on empty input', () => {
    expect(() => mapCapabilities({ servers: [] })).toThrow();
  });
});
