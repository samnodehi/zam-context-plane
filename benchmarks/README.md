# ZAM Value Benchmark (C6)

Quantifies ZAM's core thesis — *smaller context, only when safe* — as a reproducible number,
**offline, with no model and no API key** (the deterministic token-accounting tier; docs/35).

## Run

```bash
npm run benchmark
```

Builds the core, runs `plan()` over the request corpus, writes `report.json`, prints a summary, and
**exits non-zero if any unsafe omission is found**.

## Method

For each request (plain text, **no** `request-signals` → the Phase 2a deterministic Request Router
classifies it), run core `plan({ request, registry })` and compare:

- **ZAM tokens** = Σ `tokensApprox` of the plan's `selectedComponents`.
- **Baseline tokens** = Σ `tokensApprox` of **all** registry components — the naive runtime that
  injects everything every turn (the OpenClaw OC-W1 problem ZAM exists to fix).
- **Savings** = `(baseline − ZAM) / baseline`.

The corpus (`fixtures/`) models a realistic agent registry: an always-on core (identity, safety
rules, durable constraints), the **heavy optional scaffolds** that naive runtimes inject every turn
(heartbeat / proactive / group-chat / lifecycle, ~1100/640/540 tokens), per-family skills, tools,
history, and memory. Requests span the router-detectable families plus neutral.

## Headline result (current corpus)

**63.9% mean token savings, 0 unsafe omissions, 100% router classification accuracy** (18 components,
5770-token baseline, 14 requests). Savings gradient is as expected — `simple_greeting` saves most
(75%), `ops`/`coding` least (~58%, because they include their task skill).

## Honest caveats (so the number isn't overread)

- **Tools are conservatively *included*, not omitted.** The benchmark supplies no
  `runtime-capabilities`, so tool availability is unknown and ZAM fail-opens to including all tools.
  The savings therefore come entirely from omitting the heavy scaffolds + non-matching skills +
  memory — **not** from dropping tools. A real runtime that supplies `activeToolIds` would save more;
  this run is the conservative floor.
- **The safety gate is the point.** A savings number only counts paired with `unsafeOmissions: 0`:
  ZAM never omits a `requiredWhen`-matched, `safety_critical`, `mandatory`, or `omissionPolicy:never`
  component (e.g. `scaffold.system-rules`, `history.durable-constraints` are always included).
- **Offline tier only.** This measures *context-size* reduction. Whether the smaller context still
  yields a correct answer — and a deterministic-vs-model classification comparison — require a live
  model and are deferred to an optional, key-gated follow-up (docs/35 §6).

`report.json` (committed) is the full per-request breakdown; it is deterministic (same corpus → identical report).
