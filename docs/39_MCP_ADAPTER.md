# 39 MCP Adapter — Phase 4c (the strategic second adapter)

> **Document type:** Scoping + implementation note — Phase 4c (MCP capability governance).
> **Status:** Implemented. New package `packages/adapter-mcp/` (open reference adapter).
> **Authority:** Additive new package + CI extension. **No change** to `src/**`, `schemas/**`,
> `fixtures/**`, `tests/**`, `packages/runtime/**`, `packages/types/**`, `packages/adapter-openclaw/**`,
> or `benchmarks/**`.
> **Canonical sources:** `docs/37 §5` (adapter contract + deterministic-core-first principle), `docs/38`
> (the OpenClaw adapter — same contract, prior surface), `docs/05` +
> `schemas/inputs/component-registry.schema.json` (registry shape), `schemas/outputs/prompt-plan.schema.json`
> (plan partitions). Locked: **F1 = open-core**; **Sam-decided 2026-06-16** — MCP second, in the
> "ZAM governs an MCP client" shape (govern which capabilities load per turn, not ZAM-as-server).

---

## 1. Purpose

The strategic second adapter, on a surface we did **not** benchmark — which is the point: it proves
**portability**. By 2026 the acute, widely-felt pain is *"I attached many MCP servers and their
tools/resources/prompts blow my context budget every turn."* This adapter takes the aggregated MCP
capability listings + the user request, governs them through the **same deterministic core**, and
returns only the subset of tools/resources/prompts to surface this turn. Same `docs/37 §5` contract,
different surface.

## 2. Honest scope

There is no live MCP client or servers in this repo, so — exactly as with OpenClaw (`docs/38 §2`) —
the adapter operates on **MCP capability listings** (the standard `tools/list` / `resources/list` /
`prompts/list` shapes, aggregated per server) supplied as data, with a **documented synthetic
fixture** (`example-capabilities.json`). A real MCP host feeds its live listings; the mapping and
governance are real and reusable. Nothing fakes a live transport.

## 3. Design decisions

- **DQ-1 — Location: `packages/adapter-mcp/` (`@zam/adapter-mcp`).** Workspace package, core via
  `"context-plane": "file:../.."` (the proven pattern). CI extended to build + test it.
- **DQ-2 — Input shape.** `{ servers: [{ name, tools?, resources?, prompts? }] }`, where each list
  uses the standard MCP item shapes (tool: `{ name, description?, inputSchema?, annotations? }`;
  resource: `{ uri, name?, description?, mimeType? }`; prompt: `{ name, description?, arguments? }`).
  This is what an MCP client aggregates across connected servers.
- **DQ-3 — Capability → ZAM type (relevance-governed).** `tool → skill`, `resource → memory`,
  `prompt → skill`. Tools map to **`skill`, not `tool`**, deliberately: the ZAM **`tool` selector is
  runtime-availability-based and fail-open** (it includes a tool unless told it is unavailable), so it
  cannot prune by *relevance*. The `skill`/`memory` selectors are the family-governed ones
  (`requiredWhen`/`safeToOmitWhen`) that relevance pruning needs. The adapter still reconstructs and
  emits each item as its original MCP kind (tool/resource/prompt) — the ZAM type only selects which
  selector governs it. All existing MVP types; no schema change.
- **DQ-4 — Governance heuristic (deterministic, documented).** Two signals, no model call:
  1. **Relevance → `requiredWhen` + `safeToOmitWhen`.** Match each capability's `name + description`
     against a documented keyword→`promptFamily` table (§4). Matched families become `requiredWhen`
     (surface for those), and **every other family is listed in `safeToOmitWhen`** so the core omits it
     elsewhere via Path A (a `safeToOmitWhen` match — note `defaultAction: omit` *alone* fails open to
     include in the core). **No keyword match ⇒ fail-open**: empty `safeToOmitWhen` + `defaultAction:
     include` (a general-purpose capability is always surfaced rather than hidden).
  2. **Destructive gating → `requiredWhen`.** `annotations.destructiveHint: true` ⇒ the capability is
     gated to the ops family (`requiredWhen: [ops_security_change_risk]`, safe-to-omit elsewhere) — a
     destructive tool is surfaced only for an ops/change request, never for a greeting or a
     coding/research turn. **`riskLevel` stays `low`**: per `docs/05 §5`, `riskLevel` is the danger of
     *omitting* a component, and omitting a tool is safe (it simply isn't offered that turn). Marking
     it high would fail-open **include** it — the opposite of what tool governance wants.
- **DQ-5 — Token cost is measured from the *serialized* capability** (`name + description +
  inputSchema`) — i.e. exactly what surfacing it costs in the model's tool list. `tokensApprox =
  ceil(chars / 4)` (min 1). This is the real budget pressure the adapter relieves.
- **DQ-6 — Output = the surfaced subset, reconstructed.** From `promptPlan.selectedComponents`, rebuild
  the original MCP `tools` / `resources` / `prompts` to advertise this turn, plus `stats`
  (surfaced vs. total counts, baseline vs. surfaced tokens, `savedPct`). The host then advertises only
  the surfaced capabilities to the model.
- **DQ-7 — Fail-open, no per-turn model call** (`docs/37 DQ-5`): classification is the deterministic
  core router; uncertain ⇒ `general_default` ⇒ surface more, never less. Safety here means **not**
  surfacing destructive tools unnecessarily (omission is the safe direction for tools).

## 4. Keyword → promptFamily table (the documented mapping policy)

| promptFamily | keyword signals (matched in name + description, case-insensitive) |
|---|---|
| `coding_build_debug` | code, file, edit, patch, diff, build, compile, lint, test, debug, git, repo |
| `research_investigation` | search, web, fetch, browse, query, lookup, scrape, docs, wiki, research, investigate |
| `ops_security_change_risk` | deploy, shell, exec, run, command, kill, delete, remove, drop, rotate, secret, credential, database, db, admin, sudo, kubectl, terraform |
| `history_sensitive` | history, conversation, session, recall, memory |

A capability may match several families (all become `requiredWhen`). The destructive-annotation rule
(DQ-4.2) overrides to the ops family. No match ⇒ general-purpose ⇒ `defaultAction: include`.

## 5. Modules

- `src/map.ts` — `mapCapabilities(input) → { registry, items }`: MCP listings → schema-valid
  `RegistryEntry[]` (DQ-3/4/5) + `items` (id → original MCP item + kind + server) for reconstruction.
- `src/classify.ts` — the deterministic keyword→family + annotation→risk heuristic (§4).
- `src/index.ts` — `governCapabilities({ capabilities, requestText }) → { registry, plan, surfaced, stats }`
  (map → `plan()` → reconstruct surfaced tools/resources/prompts).
- `src/cli.ts` — `zam-mcp --capabilities <file.json> --request "<text>" [--json]`.
- `example-capabilities.json` — synthetic multi-server MCP listings (filesystem / web / shell / db),
  mixing read-only and destructive tools, plus resources and prompts.

## 6. What this is NOT / out of scope

- **Not** a live MCP transport/client (no stdio/SSE/socket; §2). - **Not** ZAM-as-an-MCP-server (the
  *other* shape; explicitly not chosen). - **Not** semantic relevance via embeddings/model — the
  relevance signal is the documented deterministic keyword heuristic (§4). - **Not** a change to the
  core, schemas, fixtures, runtime, types, the OpenClaw adapter, or benchmarks.

## 7. Verification

- New `@zam/adapter-mcp` suite: capability mapping yields schema-shaped entries (sizes measured from
  serialized capabilities; valid enums); **a research request surfaces web/search tools and omits
  deploy/db tools**; **a coding request surfaces file/edit tools**; **a greeting surfaces almost
  nothing (high savings) and never surfaces a destructive tool**; partition completeness; the
  reconstructed `surfaced` lists contain only selected capabilities.
- CI (`.github/workflows/ci.yml`) extended: build + test the MCP adapter (same `file:` link pattern).
- Root **757/757**, runtime **354/354**, OpenClaw adapter **12/12** remain untouched.

## 8. Execution contract — Phase 4c

| | |
|---|---|
| **Allowed (create)** | `docs/39_MCP_ADAPTER.md`; `packages/adapter-mcp/**` |
| **Allowed (modify)** | `.github/workflows/ci.yml` (add the MCP adapter build+test steps only) |
| **Forbidden** | `src/**`, `schemas/**`, `fixtures/**`, `tests/**`, `packages/runtime/**`, `packages/types/**`, `packages/adapter-openclaw/**`, `benchmarks/**` |
| **Deliverable** | A runnable MCP governance adapter (`governCapabilities` + CLI) with a synthetic fixture and a green suite; CI builds+tests it; portability of the `docs/37 §5` contract demonstrated on a second surface |

---

*4c proves the contract is surface-independent: the same deterministic core governs an OpenClaw
workspace (`docs/38`) and an MCP capability set (this doc) with no core change.*
