# ZAM — Context Governance Layer

> A portable, vendor-neutral layer that decides **what context an AI agent receives** for each
> request — smaller, safer prompts, *only when safe*.

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![CI](https://github.com/samnodehi/zam-context-plane/actions/workflows/ci.yml/badge.svg)](https://github.com/samnodehi/zam-context-plane/actions/workflows/ci.yml)

ZAM (a "Context Control Plane") runs **before** an agent builds its prompt. Given the user's request
and an inventory of available context components — system scaffolds, skills, tools, memory, history —
it decides which ones to **include**, **omit**, or **defer**, and records *why*. It emits a structured
*plan*, never assembled prompt text: **the model proposes, deterministic guardrails enforce.**

## The problem

Most agent runtimes inject *everything* every turn — every skill, every tool definition, every memory
lane — regardless of what the user actually asked. That bloats the prompt (cost + latency), buries the
relevant context, and degrades answers. Trimming it by hand is risky: drop the wrong thing and you
silently break safety or correctness.

## What ZAM does

A deterministic pipeline classifies the request and runs a 12-step selector ladder, a conflict
resolver, and a budgeter to produce, per turn:

- `prompt-plan.json` — the selected / omitted / deferred components,
- `trace.json` — the full, auditable decision trace,
- `summary.md` — a human-readable narrative.

Design properties (the spine of the project):

- **Fail-open on uncertainty** — it only makes the context smaller when it is *safe* to; when unsure,
  it includes more. "Smaller context only when safe."
- **Deterministic & reproducible** — no model call is required to plan; the same input yields the same
  plan.
- **Schema-validated & fail-closed outputs** — it refuses to emit an invalid plan.
- **Auditable** — every decision carries a reason and a trace.
- **Portable** — the core depends on no particular runtime; adapters map any host into it.

## Evidence (measured, not asserted)

**Try it in one command — offline, deterministic, no API key:** `npm run benchmark` reproduces the
headline number on a realistic registry.

- **Offline benchmark** (`benchmarks/`): **63.9% mean token savings** with **0 unsafe omissions** vs.
  the naive "inject everything" baseline.
- **Live benchmark** (optional, key-gated): the cheap *deterministic* router agrees with a *model's*
  classification **85.7%** of the time — and both disagreements were on the **safe side** (it fell back
  to fuller context). Answer-quality preservation ~**80%**.
- **Three reference adapters** demonstrate the contract is **surface-independent** — the same
  deterministic core governs three very different surfaces with **zero core changes**:

  | Adapter | Surface | What it shows |
  |---|---|---|
  | [`zam-adapter-openclaw`](packages/adapter-openclaw) | agent **workspace** (Markdown files) | 73% saved on a greeting, 53% on a coding request; safety always kept |
  | [`zam-adapter-mcp`](packages/adapter-mcp) | **MCP** tools / resources / prompts | prunes the tool list per request; destructive tools surfaced **only** for ops |
  | [`zam-adapter-telegram`](packages/adapter-telegram) | Telegram **bot metadata** | uses the `requestSignals` caller tier (group / reply → family) |

  These are **reference adapters** run against *documented, synthetic* inputs (each package's README
  states its scope) — they demonstrate the planning contract and its portability, not live production
  integrations. ("OpenClaw" here denotes a generic agent-workspace shape — `AGENTS.md`-style scaffolds,
  skills, tools — not a third-party dependency.)

## How it works

```
request ──▶ request router (deterministic) ──▶ 12-step selector ladder
                                                     │
                                            conflict resolver
                                                     │
                                                 budgeter
                                                     │
                              prompt-plan.json · trace.json · summary.md
```

An adapter's job (see any of the three above, and `docs/37 §5`) is always the same four steps:
**extract** the host's context into a ZAM registry, call `plan()`, **assemble** the prompt from the
selected components, and feed it back to the host's loop. No per-turn model call is required.

## Quickstart

**Add it to your project:**

```bash
npm install context-plane
```

**Or develop ZAM itself** — clone, then:

```bash
npm install
npm run build
npm test
```

**See the value (offline, deterministic, no API key):**

```bash
npm run benchmark
# prints mean token savings + 0 unsafe omissions on a realistic OpenClaw-modeled registry
```

**CLI:**

```bash
context-plane plan --request <text-file> --registry <registry.json> --output-dir ./out
# writes out/prompt-plan.json, out/trace.json, out/summary.md
```

**As a library:**

```ts
import { plan } from 'context-plane';

const { promptPlan, trace, summary } = plan({
  request: { text: 'Help me debug the failing build.' },
  registry, // ComponentRegistryEntry[] — see docs/05
});
console.log(promptPlan.selectedComponents);
```

**As an HTTP service** (language-agnostic): the `./http` export serves a `POST /plan` endpoint with
constant-time API-key auth (`X-ZAM-API-Key`). See `src/http`.

## Repository layout

| Path | What |
|---|---|
| `src/` | the deterministic core (router → ladder → conflict resolver → budgeter), CLI, and HTTP service |
| `packages/runtime/` | a thin agent runtime used as a validation harness |
| `packages/types/` | shared hand-authored types (`@zam/types`) |
| `packages/adapter-openclaw/`, `adapter-mcp/`, `adapter-telegram/` | the three reference adapters |
| `benchmarks/` | the offline (committed, deterministic) and live (key-gated) value benchmarks |
| `schemas/` | JSON Schemas for every input/output (the open registry + plan formats) |
| `docs/` | numbered scoping records — the engineering decision log, one document per change |
| `fixtures/`, `tests/` | the E2E fixture corpus and the test suites |

## Status

The roadmap is complete and the tree is green: core suite **743/743**, runtime **354/354**, adapters
**12 + 11 + 10**, all run in CI on every push/PR. Known gaps and tracked debt live honestly in
[`DEBT.md`](DEBT.md) rather than being asserted absent.

## Open-core

This repository is the **open** reference: the spec, the registry/plan formats (`schemas/`), the
reference implementation, and the reference adapters — under **Apache-2.0**. Managed hosting, bespoke
adapters, and support are the commercial side. The boundary is drawn in
[`docs/37`](docs/37_OPEN_CORE_BOUNDARY_AND_ADAPTER_STRATEGY.md).

## Contributing & security

See [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`SECURITY.md`](SECURITY.md).

## License

[Apache-2.0](LICENSE) — permissive, with an explicit patent grant.
