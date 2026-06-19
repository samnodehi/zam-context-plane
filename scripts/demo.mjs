// npm run demo — a narrated, human-friendly walkthrough of ZAM's per-request
// context decisions, using the real core (dist/core/api.js) over the benchmark's
// realistic 18-component registry. Self-contained (clone + build); for the rigorous
// metrics + report.json see `npm run benchmark`. Great for a screen recording.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { plan } from '../dist/core/api.js';

const here = dirname(fileURLToPath(import.meta.url));
const fx = (p) => resolve(here, '../benchmarks/fixtures', p);
const registry = JSON.parse(readFileSync(fx('registry.json'), 'utf8'));
const requests = JSON.parse(readFileSync(fx('requests.json'), 'utf8'));

const byId = new Map(registry.map((c) => [c.id, c]));
const reqById = new Map(requests.map((r) => [r.id, r]));
const titleOf = (cid) => byId.get(cid)?.title ?? cid;
const baseline = registry.reduce((s, c) => s + c.tokensApprox, 0);
const SAFETY = 'scaffold.system-rules'; // omissionPolicy: never — must survive every request

console.log('');
console.log('  ╶─ ZAM — what context does each request actually need? ─╴');
console.log(`     Agent registry: ${registry.length} components · ${baseline} tokens if you inject everything.`);
console.log('');

// Benchmark-proven request ids (one per family) — classify crisply via the deterministic router.
for (const id of ['greet-1', 'code-1', 'research-1', 'ops-1']) {
  const req = reqById.get(id);
  if (!req) continue;
  const { promptPlan } = plan({ request: { text: req.text }, registry });
  const sel = promptPlan.selectedComponents.map((c) => c.componentId);
  const selTokens = sel.reduce((s, cid) => s + (byId.get(cid)?.tokensApprox ?? 0), 0);
  const saved = Math.round(((baseline - selTokens) / baseline) * 100);
  const safety = sel.includes(SAFETY) ? '🔒 safety rules kept' : '⚠️  SAFETY MISSING';
  console.log(`  ▶ "${req.text}"`);
  console.log(`      family : ${promptPlan.promptFamily}`);
  console.log(`      keep   : ${sel.map(titleOf).join(', ')}`);
  console.log(`      drop   : ${promptPlan.omittedComponents.map((c) => titleOf(c.componentId)).join(', ') || '(none)'}`);
  console.log(`      result : ${saved}% smaller   ${safety}`);
  console.log('');
}

console.log('  Across the full 14-request corpus: 63.9% mean token savings, 0 unsafe omissions.');
console.log('  Metrics: `npm run benchmark`   ·   per-surface adapters: `packages/adapter-*`');
console.log('');
