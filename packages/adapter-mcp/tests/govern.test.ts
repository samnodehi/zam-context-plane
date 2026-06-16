import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { governCapabilities } from '../src/index.js';
import type { McpCapabilities } from '../src/types.js';

const CAPS = JSON.parse(
  readFileSync(fileURLToPath(new URL('../example-capabilities.json', import.meta.url)), 'utf8'),
) as McpCapabilities;

const govern = (requestText: string) => governCapabilities({ capabilities: CAPS, requestText });
const toolNames = (r: ReturnType<typeof govern>): string[] => r.surfaced.tools.map((t) => t.name);

const DESTRUCTIVE = ['write_file', 'run_command', 'kill_process', 'drop_table'];

describe('governCapabilities (end-to-end through the deterministic core)', () => {
  it('every selected component maps to a surfaced capability; totals add up', () => {
    const r = govern('hello');
    const surfacedTotal = r.stats.surfacedTools + r.stats.surfacedResources + r.stats.surfacedPrompts;
    expect(r.plan.promptPlan.selectedComponents.length).toBe(surfacedTotal);
    expect(r.stats.totalTools + r.stats.totalResources + r.stats.totalPrompts).toBe(14);
  });

  it('a greeting surfaces almost nothing — high savings, no destructive tool', () => {
    const r = govern('hello');
    expect(r.promptFamily).toBe('simple_greeting');
    expect(r.stats.savedPct).toBeGreaterThan(0.5);
    for (const d of DESTRUCTIVE) expect(toolNames(r)).not.toContain(d);
  });

  it('a coding request surfaces file/edit tools and omits web + destructive', () => {
    const r = govern('Fix the failing build and debug the TypeScript compiler error in this file.');
    expect(r.promptFamily).toBe('coding_build_debug');
    expect(toolNames(r)).toContain('read_file');
    expect(toolNames(r)).toContain('edit_file');
    expect(toolNames(r)).not.toContain('web_search');
    for (const d of DESTRUCTIVE) expect(toolNames(r)).not.toContain(d);
  });

  it('a research request surfaces web/search tools and omits coding + destructive', () => {
    const r = govern('Search the web and research the latest published findings; investigate and compare the sources.');
    expect(r.promptFamily).toBe('research_investigation');
    expect(toolNames(r)).toContain('web_search');
    expect(toolNames(r)).toContain('fetch_url');
    expect(toolNames(r)).not.toContain('edit_file');
    for (const d of DESTRUCTIVE) expect(toolNames(r)).not.toContain(d);
  });

  it('an ops request surfaces destructive tools (they belong there)', () => {
    const r = govern('Deploy the service to production and run the database migration command.');
    expect(r.promptFamily).toBe('ops_security_change_risk');
    expect(toolNames(r)).toContain('run_command');
    expect(toolNames(r).some((n) => DESTRUCTIVE.includes(n))).toBe(true);
  });
});
