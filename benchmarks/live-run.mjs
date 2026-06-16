// ============================================================================
// ZAM Live-Model Value Validation (C6 follow-up; docs/36).
//
// Completes the value story the offline benchmark (docs/35) could not:
//   1) Deterministic-vs-model classification agreement — is the cheap offline
//      Request Router as good as a model? (the long-promised docs/09 comparison;
//      directly informs Phase 4 adapter architecture).
//   2) Answer-quality preservation — does ZAM's ~64%-smaller context still yield
//      an equivalent answer? (LLM-judged; summaries-only context, so indicative).
//
// Live + non-deterministic -> manual only, NEVER a CI gate. Key-gated: reads
// OPENROUTER_API_KEY; without it, prints a skip notice and exits 0. Only the
// synthetic corpus is sent to the provider. Read-only via plan().
// ============================================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { plan } from '../dist/core/api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const here = (p) => resolve(__dirname, p);

const KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.BENCHMARK_MODEL || 'google/gemini-3.1-flash-lite';

if (!KEY) {
  console.log('OPENROUTER_API_KEY not set — skipping live benchmark (this is expected in CI).');
  console.log('Run with: OPENROUTER_API_KEY=... npm run benchmark:live');
  process.exit(0);
}

const registry = JSON.parse(readFileSync(here('fixtures/registry.json'), 'utf8'));
const requests = JSON.parse(readFileSync(here('fixtures/requests.json'), 'utf8'));
const byId = new Map(registry.map((c) => [c.id, c]));

const FAMILIES = [
  'general_default', 'simple_greeting', 'coding_build_debug', 'research_investigation',
  'ops_security_change_risk', 'lifecycle_internal', 'heartbeat_proactive',
  'group_chat_behavior', 'tool_use_required', 'history_sensitive',
];

async function chat(messages, { maxTokens = 350, temperature = 0 } = {}) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens, temperature }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = await res.json();
  return (data.choices?.[0]?.message?.content ?? '').trim();
}

function extractJson(text) {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* nope */ } }
  return null;
}

const contextFrom = (comps) =>
  comps.map((c) => `- ${c.title}: ${c.summary}`).join('\n');

const pct = (x) => `${(x * 100).toFixed(1)}%`;

// --- Run --------------------------------------------------------------------
// Answer-equivalence is run only on a representative non-greeting subset to bound cost.
const ANSWER_SUBSET = new Set(['code-1', 'research-1', 'ops-1', 'hist-1', 'neutral-1']);

const perRequest = [];
let classMatch = 0;
let answerJudged = 0;
let answerPreserved = 0;

for (const req of requests) {
  const { promptPlan } = plan({ request: { text: req.text }, registry });
  const detFamily = promptPlan.promptFamily;
  const selected = promptPlan.selectedComponents.map((c) => byId.get(c.componentId)).filter(Boolean);

  const entry = { id: req.id, text: req.text, deterministicFamily: detFamily };

  // 1) Classification agreement (deterministic vs model)
  try {
    const out = await chat([
      { role: 'user', content:
        `Classify this user request into exactly one of these families: ${FAMILIES.join(', ')}.\n` +
        `Reply ONLY as JSON: {"family":"<one_value>"}.\n\nRequest: ${req.text}` },
    ], { maxTokens: 40 });
    const modelFamily = extractJson(out)?.family;
    entry.modelFamily = modelFamily ?? '(unparsed)';
    entry.classificationAgree = modelFamily === detFamily;
    if (entry.classificationAgree) classMatch++;
  } catch (e) {
    entry.modelFamily = `(error: ${e.message})`;
    entry.classificationAgree = null;
  }

  // 2) Answer-quality preservation (subset; summaries-only context -> indicative)
  if (ANSWER_SUBSET.has(req.id)) {
    try {
      const baseAns = await chat([
        { role: 'system', content: `Context:\n${contextFrom(registry)}` },
        { role: 'user', content: req.text },
      ]);
      const zamAns = await chat([
        { role: 'system', content: `Context:\n${contextFrom(selected)}` },
        { role: 'user', content: req.text },
      ]);
      const judge = await chat([
        { role: 'user', content:
          `A user asked: "${req.text}".\nAnswer A (full context):\n${baseAns}\n\nAnswer B (reduced context):\n${zamAns}\n\n` +
          `Is Answer B at least as good and complete as Answer A for the user's need? ` +
          `Reply ONLY as JSON: {"equivalent": true|false}.` },
      ], { maxTokens: 30 });
      const eq = extractJson(judge)?.equivalent;
      entry.answerEquivalent = typeof eq === 'boolean' ? eq : null;
      if (typeof eq === 'boolean') { answerJudged++; if (eq) answerPreserved++; }
    } catch (e) {
      entry.answerEquivalent = `(error: ${e.message})`;
    }
  }

  perRequest.push(entry);
  process.stdout.write('.');
}
process.stdout.write('\n');

const classScored = perRequest.filter((r) => typeof r.classificationAgree === 'boolean').length;
const classificationAgreementPct = classScored ? classMatch / classScored : 0;
const answerPreservationPct = answerJudged ? answerPreserved / answerJudged : 0;

const report = {
  generatedBy: 'benchmarks/live-run.mjs (docs/36, C6 follow-up)',
  model: MODEL,
  note: 'Live + non-deterministic; answer-quality uses summaries-only context (indicative).',
  requestCount: perRequest.length,
  classificationAgreementPct,
  classificationScored: classScored,
  answerPreservationPct,
  answerJudged,
  perRequest,
};
writeFileSync(here('live-report.json'), JSON.stringify(report, null, 2) + '\n');

console.log('ZAM Live-Model Validation');
console.log('-'.repeat(60));
console.log(`Model: ${MODEL}`);
console.log(`Deterministic-vs-model classification agreement: ${pct(classificationAgreementPct)} (${classMatch}/${classScored})`);
console.log(`Answer-quality preservation (subset, indicative): ${pct(answerPreservationPct)} (${answerPreserved}/${answerJudged})`);
console.log('');
for (const r of perRequest) {
  const cls = r.classificationAgree === true ? '✓' : r.classificationAgree === false ? `✗ model=${r.modelFamily}` : '?';
  const ans = r.answerEquivalent === true ? ' | ans=✓' : r.answerEquivalent === false ? ' | ans=✗' : '';
  console.log(`  ${r.id.padEnd(11)} det=${r.deterministicFamily.padEnd(24)} class:${cls}${ans}`);
}
console.log('\nReport written to benchmarks/live-report.json');
