# 36 Live-Model Value Validation — Phase 3 (C6 follow-up)

> **Document type:** Scoping + implementation note — Phase 3 (optional live tier).
> **Status:** Implemented. Key-gated, non-deterministic — **manual, not a CI gate**.
> **Authority:** Additive benchmark tooling. Read-only via `plan()`; no core/schema/fixture/test changes.
> Makes real model calls (OpenRouter) using only the **synthetic** benchmark corpus — no user data, no secrets.
> **Canonical sources:** `DEBT.md` C6; `docs/35` (offline tier); the long-promised `docs/09`
> deterministic-vs-model comparison; `benchmarks/fixtures/`.

---

## 1. Purpose

The offline benchmark (`docs/35`) proved the **first half** of the value — token savings (63.9%) with
**structural** safety (0 `requiredWhen`/safety omissions). It cannot prove the **second half**: that
ZAM's smaller context still yields a correct answer, and that the cheap *deterministic* router is
actually as good as a *model* at classification. This layer measures both, with a live model.

## 2. Metrics

1. **Classification agreement (deterministic-vs-model).** For each corpus request, compare the
   deterministic Request Router's `promptFamily` (from `plan()`) against a model's classification of
   the same request into the 10 families. Metric: **agreement %**. Answers "is the offline router as
   good as a model?" (validates the F3 decision).
2. **Answer-quality preservation.** For each request, generate a model answer with the **baseline**
   context (all component summaries) and with the **ZAM** context (only `selectedComponents`), then
   ask an LLM **judge** whether the ZAM answer is *equivalent-or-better* (not degraded). Metric:
   **preservation %** — how often the 64%-smaller context did not hurt the answer.

## 3. Method
- Reuse `benchmarks/fixtures/{registry,requests}.json`. For each request: run core `plan()` →
  `selectedComponents` + `promptFamily`.
- Calls (per request, on a cheap model — default `google/gemini-3.1-flash-lite`):
  classification (1) + baseline answer (1) + ZAM answer (1) + judge (1) ≈ 4. ~14 requests → bounded cost.
- Resilient: JSON-extraction + per-call try/catch; a failed call is recorded, not fatal.

## 4. Boundaries / honesty
- **Non-deterministic** (live model) → emitted to `benchmarks/live-report.json` + stdout, **never a CI
  gate** (the offline benchmark remains the deterministic, CI-friendly tier).
- **Key-gated:** reads `process.env.OPENROUTER_API_KEY`; if absent, prints a clear skip message and
  exits 0 (so it never breaks anyone without a key).
- The "model" tier here is a direct classification/answer call — a fair proxy for the runtime's M1
  analyzer, not its exact prompt. The judge is itself a model (subjective); treat results as indicative.
- Only the **synthetic** corpus is sent to the provider. No core/schema/fixture/test changes.

## 5. Run
```bash
OPENROUTER_API_KEY=... npm run benchmark:live
```

## 6. Success criteria
- `npm run benchmark:live` runs with a key (skips cleanly without one), prints classification agreement
  % and answer-preservation %, writes `live-report.json`.
- Interpreted alongside the offline 63.9% savings, it completes the value story: *meaningful token
  savings AND preserved answer quality AND a deterministic router competitive with a model.*

## 7. First-run result (2026-06-16, `google/gemini-3.1-flash-lite`, 14 requests)
- **Deterministic-vs-model classification agreement: 85.7% (12/14).** Both disagreements
  (`neutral-3`, `neutral-4`) are on the **safe side** — the deterministic router returned
  `general_default` (fuller context) where the model *narrowed* to a specific family. The router
  never unsafely narrows; it is conservative exactly where it should be (fail-open by design).
- **Answer-quality preservation (subset of 5, indicative): 80% (4/5).** ZAM's ~64%-smaller context
  produced a judged-equivalent answer in 4/5; summaries-only context makes this indicative, not definitive.

**Architectural takeaway for Phase 4:** the deterministic core is sufficient for the bulk of requests;
the model-assisted tier adds value mainly on ambiguous/neutral requests where the model narrows
further. An adapter can rely on the deterministic core and treat the model tier as an optional
refinement. (`live-report.json` is non-deterministic and gitignored; re-run to reproduce.)
