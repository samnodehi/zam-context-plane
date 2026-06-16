# 35 Value Benchmark (Token Savings) — Phase 3 Scoping (C6)

> **Document type:** Scoping Specification — Phase 3 (C6)
> **Status:** Scoping pass — awaiting Sam approval. No code authorized yet.
> **Authority:** Additive benchmark tooling + corpus. **Read-only** on the core (uses the public
> `plan()` API). No change to `src/`, `schemas/`, `fixtures/`, or any test. No live model / no API key
> (Sam-approved option A).
> **Implementation status:** Not implemented.
> **Canonical sources:** `DEBT.md` C6; the approved plan `groovy-beaming-shannon` (Phase 3);
> `PROJECT_MASTER_PLAN.md` §2 (OpenClaw over-injection), §10.1 (example component); `src/core/api.ts` (`plan()`).

---

## 1. Purpose

C6: the project's entire value thesis — *"smaller context, only when safe"* — has only ever been
shown on synthetic fixtures, never quantified. This benchmark produces a **reproducible token-savings
number** that demonstrates the core value without a live model (option A): for a realistic agent
registry and a realistic request set, how many prompt tokens does ZAM's plan include versus the naive
"inject everything every turn" baseline (the OpenClaw OC-W1 problem ZAM was built to fix)?

The number is only meaningful if the savings are **safe**, so the benchmark's headline metric is
paired with a hard **zero-unsafe-omission** gate.

## 2. Method (deterministic token-accounting; no model, no key)

For each request in the corpus:
1. Run the core `plan({ request, registry })` (no `--request-signals` → exercises the full Phase 2a
   deterministic Request Router + the whole pipeline).
2. **ZAM tokens** = Σ `tokensApprox` of the plan's `selectedComponents`.
3. **Baseline tokens** = Σ `tokensApprox` of **all** registry components (the naive runtime that
   injects everything every turn — OC-W1).
4. **Savings** = `(baseline − zam) / baseline`.

Aggregate across the corpus (mean savings, total tokens saved), and break the numbers down **by
prompt family** (we expect `simple_greeting` to save the most and `ops_security_change_risk` the
least — the safety-first gradient).

## 3. Corpus (must be credible, not toy)

### 3.1 Registry (`benchmarks/fixtures/registry.json`)
~25–35 components modeling a real agent runtime's context (the OpenClaw motivating case), with
realistic `tokensApprox` and correct selector metadata, e.g.:
- **Always-on scaffold** (`defaultAction: include`, often `requiredWhen` broad or `retainPolicy`
  protected): core identity, base system rules, safety policy.
- **Heavy optional scaffold** (the value driver): heartbeat/cron/proactive bundle, group-chat-behavior
  bundle, lifecycle-internal rules — large (`tokensApprox` ~800–1200, per `PROJECT_MASTER_PLAN` §10.1),
  with `requiredWhen: [heartbeat_proactive, group_chat_behavior, …]` and
  `safeToOmitWhen: [simple_greeting, coding_build_debug, …]`. These are omitted safely on ordinary turns.
- **Tools / skills** (`type: tool`/`skill`, `defaultAction: omit` or `safeToOmitWhen` ordinary).
- **History components** and a **safety-critical** component (`retainPolicy: safety_critical`) that must
  NEVER be omitted (anchors the safety gate).

### 3.2 Requests (`benchmarks/fixtures/requests.json`)
~12–20 realistic requests spanning the router-detectable families + neutral, each as plain text (no
request-signals), e.g. greetings, coding/debug asks, research asks, ops/security asks, history-referencing
asks, and several neutral/general requests. Each entry: `{ id, text, expectedFamily? }`.

## 4. Metrics & the safety gate

| Metric | Definition |
|---|---|
| `savingsPct` (per request + mean) | `(baseline − zam) / baseline` |
| `tokensSaved` (per request + total) | `baseline − zam` |
| `byFamily` | mean savings grouped by the router's classified `promptFamily` |
| `classification` | family + `familyConfidence` the router assigned each request |
| **`unsafeOmissions`** | **MUST be 0.** Any component that is `requiredWhen`-matched, `retainPolicy: safety_critical`/`mandatory`, or `omissionPolicy: never` for a request but appears omitted/deferred in the plan. A non-zero count fails the benchmark. |

The headline result is reported as **"X% mean token savings with 0 unsafe omissions across N requests."**

## 5. Output & location
- New top-level `benchmarks/` dir (additive): `run.mjs` (or `.ts`), `fixtures/registry.json`,
  `fixtures/requests.json`.
- Emits `benchmarks/report.json` (structured) + prints a human-readable summary table to stdout.
- An npm script `npm run benchmark`. Optionally added to CI as an **informational** step (not a gate),
  surfacing the savings number in the job summary.
- Consumes the published core via `import { plan } from 'context-plane'` (or the built `dist/core/api.js`);
  **no core/schema/fixture/test changes.**

## 6. What this is NOT
- **No live model, no API key, no network** (option A). The "does the smaller context still produce a
  correct answer?" question and the **deterministic-vs-model** comparison both need a live model — they
  are deferred to an optional, key-gated follow-up layer (noted, not built now).
- Not a change to any planning behavior — purely measurement over the existing `plan()`.

## 7. Risks
| Risk | Impact | Mitigation |
|---|---|---|
| Toy/unfair corpus → non-credible number | High (defeats the purpose) | Model the registry on the real OpenClaw motivating case (§3.1) with documented token sizes; baseline = literally all components (the real OC-W1 behavior). |
| "Savings" hiding an unsafe omission | High | The zero-unsafe-omission gate (§4) is a hard fail; the headline pairs savings with it. |
| Registry metadata not exercising the router | Med | Requests are plain text (no signals) so the Phase 2a router runs; corpus spans families. |

## 8. Success criteria
- `npm run benchmark` runs offline (no key/network), deterministically (same inputs → same report).
- Report shows per-request + mean `savingsPct`, `byFamily` breakdown, and **`unsafeOmissions: 0`**.
- A credible headline number (expectation: meaningful double-digit mean savings, driven by ordinary
  requests safely omitting the heavy proactive/group/heartbeat scaffolds).
- Existing suites unaffected (root 757/757, runtime 354/354). `DEBT.md` C6 → CLOSED (field-proven, offline tier).

## 9. Verification
1. `npm run benchmark` → exits 0, prints the summary, writes `report.json`. 2. `unsafeOmissions: 0`.
3. Re-run → byte-identical `report.json` (determinism). 4. `npm test` still 757/757; runtime 354/354.

*Code begins only after Sam approves this scope.*
