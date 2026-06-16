// ============================================================================
// ZAM Value Benchmark (C6) — deterministic, offline token-accounting.
//
// For each request in the corpus, runs the core plan() with NO request-signals
// (so the Phase 2a deterministic Request Router classifies the request) and
// compares ZAM-planned tokens against the naive "inject everything every turn"
// baseline (the OpenClaw OC-W1 problem ZAM exists to fix).
//
// Headline: mean token savings %, paired with a HARD zero-unsafe-omission gate
// (savings only count if ZAM never omits a component that is requiredWhen-matched,
// safety_critical, mandatory, or omissionPolicy:never for that request).
//
// No model, no API key, no network. Deterministic: same inputs -> identical report.
// Canonical: docs/35. Exit code 1 if any unsafe omission is found.
// ============================================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { plan } from '../dist/core/api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const here = (p) => resolve(__dirname, p);

const registry = JSON.parse(readFileSync(here('fixtures/registry.json'), 'utf8'));
const requests = JSON.parse(readFileSync(here('fixtures/requests.json'), 'utf8'));

const baselineTokens = registry.reduce((s, c) => s + (c.tokensApprox || 0), 0);

/** A component must NOT be omitted for a given family (mirrors the ladder's safety rules). */
function unsafeToOmit(comp, family) {
  if (comp.retainPolicy === 'safety_critical' || comp.retainPolicy === 'mandatory') return true;
  if (comp.omissionPolicy === 'never') return true;
  if (Array.isArray(comp.requiredWhen) && comp.requiredWhen.includes(family)) return true;
  return false;
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;

const perRequest = [];
let totalUnsafe = 0;

for (const req of requests) {
  const { promptPlan } = plan({ request: { text: req.text }, registry });
  const family = promptPlan.promptFamily;
  const selectedIds = new Set(promptPlan.selectedComponents.map((c) => c.componentId));
  const zamTokens =
    promptPlan.estimatedTokens?.total ??
    promptPlan.selectedComponents.reduce((s, c) => s + (c.tokensApprox || 0), 0);

  // Unsafe omissions: any component unsafe-to-omit for this family that is NOT selected.
  const unsafeOmissions = registry
    .filter((c) => unsafeToOmit(c, family) && !selectedIds.has(c.id))
    .map((c) => c.id);
  totalUnsafe += unsafeOmissions.length;

  perRequest.push({
    id: req.id,
    family,
    classifiedAsExpected: req.expectedFamily ? family === req.expectedFamily : null,
    zamTokens,
    baselineTokens,
    tokensSaved: baselineTokens - zamTokens,
    savingsPct: baselineTokens > 0 ? (baselineTokens - zamTokens) / baselineTokens : 0,
    unsafeOmissions,
  });
}

const meanSavings = perRequest.reduce((s, r) => s + r.savingsPct, 0) / perRequest.length;
const byFamily = {};
for (const r of perRequest) (byFamily[r.family] ??= []).push(r.savingsPct);
const byFamilyMeanSavingsPct = Object.fromEntries(
  Object.entries(byFamily).map(([f, a]) => [f, a.reduce((x, y) => x + y, 0) / a.length]),
);
const classificationAccuracy =
  perRequest.filter((r) => r.classifiedAsExpected === true).length /
  perRequest.filter((r) => r.classifiedAsExpected !== null).length;

const report = {
  generatedBy: 'benchmarks/run.mjs (docs/35, C6)',
  method: 'deterministic token-accounting; ZAM plan() vs naive inject-everything baseline; no model/key',
  registryComponents: registry.length,
  baselineTokens,
  requestCount: perRequest.length,
  meanSavingsPct: meanSavings,
  totalUnsafeOmissions: totalUnsafe,
  classificationAccuracy,
  byFamilyMeanSavingsPct,
  perRequest,
};

writeFileSync(here('report.json'), JSON.stringify(report, null, 2) + '\n');

// --- stdout summary -------------------------------------------------------
console.log('ZAM Value Benchmark — token savings vs naive "inject everything" baseline');
console.log('-'.repeat(72));
console.log(`Registry: ${registry.length} components, baseline ${baselineTokens} tokens/turn (all injected)`);
console.log(`Requests: ${perRequest.length}`);
console.log(`Mean token savings: ${pct(meanSavings)}`);
console.log(`Router classification accuracy: ${pct(classificationAccuracy)}`);
console.log(`Unsafe omissions: ${totalUnsafe} ${totalUnsafe === 0 ? '✅' : '❌ FAIL'}`);
console.log('');
console.log('By family (mean savings):');
for (const [f, m] of Object.entries(byFamilyMeanSavingsPct).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${f.padEnd(26)} ${pct(m)}`);
}
console.log('');
console.log('Per request:');
for (const r of perRequest) {
  const flag = r.unsafeOmissions.length ? `  ⚠ UNSAFE: ${r.unsafeOmissions.join(', ')}` : '';
  console.log(`  ${r.id.padEnd(11)} [${r.family.padEnd(24)}] ${pct(r.savingsPct).padStart(6)}  (${r.zamTokens}/${baselineTokens})${flag}`);
}
console.log('');
console.log(`Headline: ${pct(meanSavings)} mean token savings with ${totalUnsafe} unsafe omissions across ${perRequest.length} requests.`);
console.log('Report written to benchmarks/report.json');

// The zero-unsafe-omission gate.
process.exit(totalUnsafe === 0 ? 0 : 1);
