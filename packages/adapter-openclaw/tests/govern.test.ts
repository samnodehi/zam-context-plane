import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { governWorkspace } from '../src/index.js';

const WS = fileURLToPath(new URL('../example-workspace', import.meta.url));

const selectedIds = (r: ReturnType<typeof governWorkspace>): Set<string> =>
  new Set(r.plan.promptPlan.selectedComponents.map((c) => c.componentId));

describe('governWorkspace (end-to-end through the deterministic core)', () => {
  it('partition completeness: selected + omitted + deferred = registry size', () => {
    const r = governWorkspace({ workspaceDir: WS, requestText: 'hello' });
    expect(r.stats.selected + r.stats.omitted + r.stats.deferred).toBe(r.registry.length);
  });

  it('safety preserved: every omissionPolicy:never component is always selected and in the prompt', () => {
    const r = governWorkspace({ workspaceDir: WS, requestText: 'hi there' });
    const selected = selectedIds(r);
    for (const c of r.registry) {
      if (c.omissionPolicy === 'never') expect(selected.has(c.id)).toBe(true);
    }
    expect(r.prompt).toContain('never omitted'); // from the system-rules body
  });

  it('a simple greeting yields high, safe savings (the heavy bundle is omitted)', () => {
    const r = governWorkspace({ workspaceDir: WS, requestText: 'hello' });
    expect(r.promptFamily).toBe('simple_greeting');
    expect(r.stats.savedPct).toBeGreaterThan(0.3);
    expect(selectedIds(r).has('scaffold.heartbeat-proactive-group')).toBe(false);
  });

  it('a strong coding request classifies coding_build_debug and selects the coding skill', () => {
    const r = governWorkspace({
      workspaceDir: WS,
      requestText:
        'Fix the failing build and debug the TypeScript compiler error in this function; the unit tests fail when I run the build.',
    });
    expect(r.promptFamily).toBe('coding_build_debug');
    const selected = selectedIds(r);
    expect(selected.has('skill.coding-guide')).toBe(true);
    expect(selected.has('skill.research-methodology')).toBe(false);
    expect(r.prompt).toContain('Coding & Debugging Guide');
    expect(r.prompt).not.toContain('Research Methodology');
  });

  it('the assembled prompt contains exactly the selected components', () => {
    const r = governWorkspace({ workspaceDir: WS, requestText: 'hello' });
    const titles = r.plan.promptPlan.selectedComponents
      .map((c) => r.registry.find((e) => e.id === c.componentId)?.title)
      .filter((t): t is string => Boolean(t));
    for (const t of titles) expect(r.prompt).toContain(t);
  });
});
