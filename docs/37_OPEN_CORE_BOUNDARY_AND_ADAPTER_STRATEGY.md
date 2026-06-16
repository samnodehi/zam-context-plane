# 37 Open-Core Boundary & Phase 4 Adapter Strategy

> **Document type:** Strategy + scoping note — Phase 4a (the open-core boundary; adapter-agnostic).
> **Status:** Implemented (4a is documentation-only). Defines, but does not implement, the adapter contract.
> **Authority:** Authorizes (a) a *superseded* banner on `docs/31` and (b) a README license-line
> clarification. **No code, schema, fixture, test, or pipeline change.** Builds/tests are untouched.
> **Canonical sources:** `docs/00` (North Star), `docs/04` (Portable Core Architecture — adapter
> boundary, "future adapters" list), `docs/05` (Component Registry Spec — the open registry format),
> `docs/18` (HTTP API & Adapter Spec), `docs/36 §7` (benchmark evidence feeding adapter design),
> `DEBT.md` C5 (hosted-exposure remainder). Locked decision **F1 = open-core**.

---

## 1. Purpose & the strategic reframe

Phase 4 is "open-core execution + first real adapter." Before any adapter code, Phase **4a** does the
one thing the whole phase is named for: **draw the open-core boundary** and retire the prior framing
that contradicts it.

The prior framing (`docs/31`, "Phase V4 — Product Distribution & Packaging") was built on an explicit
thesis: *"ZAM source code must never be directly accessible to consumers"* — a closed Docker image
→ thin SDK → fully server-side SaaS funnel, justified by **source-code protection**.

Locked decision **F1 reverses that thesis.** ZAM is **open-core**: the spec, the registry format, and
the reference implementation are open; the business is hosting, managed adapters, and support — *not*
secrecy. This document makes the reversal explicit and canonical, so no later work inherits the
retired "hide the source" driver.

## 2. The open-core boundary

| Layer | Disposition | What it is |
|---|---|---|
| **Specification** | **OPEN** | The conceptual contract: `docs/00` North Star, `docs/04` architecture, `docs/05` registry spec, `docs/06` selector/orchestration spec, `docs/18` API & adapter contract, the schemas in `schemas/`. |
| **Registry format** | **OPEN** | The `ComponentRegistryEntry` shape (`docs/05`, `schemas/`) — anyone can author a registry for any host. Portability depends on this being open. |
| **Reference implementation** | **OPEN** | `src/` (deterministic core: router → ladder → conflict-resolver → budgeter), the CLI, the HTTP service, and `packages/runtime/` (validation harness). The "model proposes, deterministic guardrails enforce" engine is the open reference. |
| **First-party adapters** | **OPEN** (reference) | The reference adapters built in Phase 4b+ (OpenClaw, then MCP) ship open as integration proofs and templates. |
| **Managed hosting** | **COMMERCIAL** | A run-it-for-you hosted endpoint with per-tenant keys, rotation, rate-limiting, usage metering, TLS, SLA. (This is exactly the `DEBT.md` C5 remainder — it is a *hosting* concern, not a core gap.) |
| **Managed / bespoke adapters & support** | **COMMERCIAL** | Building/operating adapters for a customer's proprietary stack; integration support; SLAs. |

**The dividing line:** value accrues from *running and integrating* ZAM well (hosting, adapters,
support), not from *hiding* it. Openness is the distribution strategy, not a liability.

## 3. What this supersedes / reframes

- **`docs/31` (Phase V4) is SUPERSEDED** as a *strategy* document. Its driving thesis (source-code
  protection; 3-phase march to closed SaaS) is retired by F1. A banner is added at its top pointing
  here. It is **kept, not deleted** (house style: history is preserved).
- **Container / SDK *mechanics* are not forbidden** — only their *rationale* changes. A Docker image
  or a typed HTTP SDK is still a legitimate **deployment convenience** under open-core (it just no
  longer exists to *hide* anything, and is no longer a prerequisite). Any such work is re-scoped later
  under *hosting*, not resurrected from `docs/31` as written.
- **Incidental `Docker`/`SaaS`/`V4` mentions** in other docs (e.g. `docs/02`, `docs/23`, `docs/24`,
  `docs/30`) are historical references, not live strategy; they are left as-is. This doc + F1 are the
  canonical statement of direction.

## 4. License posture

- **DQ-3 — License = Apache-2.0** for the open reference implementation (permissive + explicit patent
  grant — the right default for an open *reference* that others embed in adapters).
- The repo is **private today**; the `LICENSE` file is added **at the public flip**, not before.
  **Never flip public without adding the license first.**
- The README license line is clarified from "TBD" to state this posture (private during development;
  Apache-2.0 intended for the open reference at public release) — honesty over a bare "TBD".

## 5. The adapter contract (adapter-agnostic)

Every adapter — OpenClaw, MCP, n8n, Telegram, anything — does the same four things. The core never
changes per host; only the **mapping** does:

1. **Extract** the host's context sources (files, tools, skills, memory, history) and **map** them
   into a ZAM **registry** (`docs/05` format).
2. **Call** `plan({ request, registry, ... })` — the open deterministic core.
3. **Assemble** the host's actual prompt from the returned `selectedComponents` (ZAM emits a *plan*,
   not prompt text — `docs/04`).
4. **Feed** the assembled prompt back into the host's own agent loop.

**DQ-5 — Architecture principle, grounded in evidence (`docs/36 §7`):** the deterministic core is
sufficient for the bulk of requests; the model tier is an **optional refinement** for ambiguous ones
(live benchmark: 85.7% deterministic-vs-model classification agreement, both misses on the *safe*
side). **Therefore no adapter requires a per-turn model call.** An adapter relies on the deterministic
core by default and may *optionally* enrich classification via `--request-signals` (the model tier)
where a host already runs a model. This keeps adapters cheap, fast, and offline-capable by default.

## 6. Phase 4 sub-structure & adapter order

| Sub-pass | Scope | Status |
|---|---|---|
| **4a** (this doc) | Open-core boundary, docs/31 supersession, license posture, adapter contract | **Done** |
| **4b** | **First adapter = OpenClaw** — its own scoping doc (`docs/38`) + code + fixtures + tests | Next |
| **4c+** | **MCP** adapter (strategic second), then Telegram / n8n as demand warrants | Planned |

- **DQ-4 — First adapter = OpenClaw, then MCP (Sam-decided, 2026-06-16).** OpenClaw first because the
  benchmark registry is already OpenClaw-shaped (so 4b is *data-driven*, per the stated intent) and it
  exercises all 10 `promptFamily` values end-to-end — the fullest, lowest-risk proof. **MCP second** as
  the strategic play: deterministically governing which MCP tools/resources/prompts load per turn is
  the highest-leverage 2026 surface and proves *portability* to a surface we did **not** benchmark
  (answering the fair "you only adapted what you measured" critique). Telegram and n8n are deferred
  (an app and an automation niche — lower leverage than either OpenClaw or MCP for a first proof).
- **Honest scope for 4b (per `docs/04`'s own caveat that OpenClaw specifics are "source mapping
  pending / unverified"):** the OpenClaw adapter targets a **documented, synthetic OpenClaw-shaped
  workspace** (`AGENTS.md` / `TOOLS.md` / skills dir as context sources) and the registry mapping —
  **not** a claimed live `~/.openclaw` integration. That stays R-DEBT-clean: no unverified assumptions
  hardcoded, nothing "to fix later."

## 7. What this is NOT / out of scope (4a)

- **Not** a public flip. Repo stays private; no `LICENSE` file added yet (only the README posture).
- **Not** adapter code. 4a writes no adapter; 4b does (`docs/38`).
- **Not** hosting/SaaS build. The C5 commercial remainder (per-tenant keys, rotation, rate-limit, TLS)
  is named and bounded here but built only if/when hosting is pursued.
- **Not** a rewrite of historical docs. `docs/31` gets a banner; incidental mentions elsewhere stand.
- **Not** an SDK/Docker resurrection. Those return only re-scoped under *hosting*, never from the
  retired source-protection rationale.

## 8. Non-interference (locked; untouched by 4a)

`schemas/**`, `fixtures/**` (28 cases), all `tests/**`, every `src/**` and `packages/**` module,
enum/warning/trace/prompt-plan shapes, the selector ladder, the benchmark fixtures and `report.json`.
4a touches **only** `docs/37` (new), a banner in `docs/31`, and the README license line.

## 9. Risk register

| Risk | Impact | Prob. | Mitigation |
|---|---|---|---|
| **R1** Retiring `docs/31` loses useful container/SDK detail | Low | Low | `docs/31` is kept (banner, not deletion); §3 explicitly preserves its mechanics for later hosting re-scope. |
| **R2** Open-core boundary stays abstract → 4b drifts | Medium | Low | §5 fixes a concrete, testable adapter contract; 4b's `docs/38` inherits it. |
| **R3** "Open" misread as "public now" → premature exposure | Medium | Low | §4 + §7 state the repo stays **private** and `LICENSE` is added only at the flip; F4 keeps it private. |
| **R4** Adapter assumes a model call per turn (cost/latency) | Medium | Low | **DQ-5** mandates deterministic-core-by-default, model tier optional — grounded in `docs/36 §7`. |

## 10. Success criteria

- The open-core boundary is stated as a single canonical table (§2); `docs/31`'s source-protection
  thesis is explicitly retired with a banner pointing here.
- License posture is unambiguous (Apache-2.0 at flip; private until then) and the README no longer
  says a bare "TBD".
- The adapter contract (§5) is concrete enough that `docs/38` (OpenClaw) can be scoped directly
  against it, with the deterministic-core-first principle locked.
- Zero code/schema/test impact: `npm test` and both builds remain green by construction (docs-only).

## 11. Execution contract — Phase 4a

| | |
|---|---|
| **Allowed (create/modify)** | `docs/37_OPEN_CORE_BOUNDARY_AND_ADAPTER_STRATEGY.md` [NEW]; `docs/31_PRODUCT_DISTRIBUTION_AND_PACKAGING.md` (top banner only); `README.md` (license line only) |
| **Forbidden** | All `src/**`, `packages/**`, `schemas/**`, `fixtures/**`, `tests/**`, `benchmarks/**`; any behavior, enum, or contract change |
| **Deliverable** | This doc; `docs/31` marked superseded; README license clarified; CI green (docs-only, no test/build delta) |

---

*4a is the adapter-agnostic foundation. 4b (`docs/38`) scopes the OpenClaw adapter against the §5
contract; MCP follows as the strategic second.*
