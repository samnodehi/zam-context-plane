# 38 OpenClaw Adapter — Phase 4b (first real adapter)

> **Document type:** Scoping + implementation note — Phase 4b (the first reference adapter).
> **Status:** Implemented. New package `packages/adapter-openclaw/` (open reference adapter).
> **Authority:** Additive new package + CI extension. **No change** to `src/**`, `schemas/**`,
> `fixtures/**`, `tests/**`, `packages/runtime/**`, `packages/types/**`, or `benchmarks/**`.
> **Canonical sources:** `docs/37 §5` (adapter contract + the deterministic-core-first principle),
> `docs/04` (portable core; OpenClaw as a "workspace-file" context source; "source mapping pending"
> caveat), `docs/05` + `schemas/inputs/component-registry.schema.json` (the 18-field registry shape +
> loader cross-rules), `schemas/outputs/prompt-plan.schema.json` (the plan partitions), `docs/36 §7`
> (evidence). Locked decision **F1 = open-core**; **DQ-4 of docs/37** (OpenClaw first).

---

## 1. Purpose

The first concrete proof of the `docs/37 §5` adapter contract: take a real **OpenClaw-shaped agent
workspace** (files on disk — `AGENTS.md`-style scaffolds, skills, tools, memory, history), govern it
through the deterministic core, and emit a **smaller, safe, assembled prompt** plus an auditable
savings report. It turns the synthetic benchmark registry into something produced *from files*.

## 2. Honest scope (the key constraint)

`docs/03` (the OpenClaw source map) was **never filled in**, and `docs/04` explicitly flags OpenClaw's
internals as *"source mapping pending / unverified — do not hardcode assumptions."* Therefore this
adapter targets a **documented, synthetic OpenClaw-shaped workspace** (`example-workspace/`), **not** a
claimed live `~/.openclaw` integration. The *contract* (files → registry → `plan()` → assembled
prompt) is real and reusable; only the concrete file conventions are ours and documented. This keeps
the work R-DEBT-clean: nothing unverified is asserted, nothing is left "to fix later."

## 3. Design decisions

- **DQ-1 — Location: `packages/adapter-openclaw/` (scoped `@zam/adapter-openclaw`).** A workspace
  package consuming the core via `"context-plane": "file:../.."` (the proven `packages/runtime`
  mechanism). Reference adapters ship **open** (`docs/37 §2`). CI is extended to build + test it.
- **DQ-2 — Governance source: frontmatter-primary with type-based defaults.** A workspace file becomes
  a component **iff** its YAML-style frontmatter declares a `type`. The frontmatter carries the ZAM
  governance (`riskLevel`, `requiredWhen`, `safeToOmitWhen`, `defaultAction`, `omissionPolicy`,
  `retainPolicy`, `budgetPriority`, `tags`, `title`, `summary`, `id`, `version`); any missing field
  falls back to a documented **type default** (§4). Explicit + auditable; no hidden inference.
- **DQ-3 — Sizes are measured, not guessed.** `charsApprox` = the file body length (frontmatter
  stripped); `tokensApprox` = `ceil(charsApprox / 4)` (min 1) — the same rough heuristic the benchmark
  used; no live tokenizer (matches the MVP "no live tokenizer calls" rule). This is the real value-add
  over a hand-authored registry: the registry tracks the actual files.
- **DQ-4 — Real content hash.** `hash` = SHA-256 of the body (64 lowercase hex) — populates the
  schema's drift-detection field with a real value (provenance), instead of `null`.
- **DQ-5 — Loadable-by-construction normalization.** The extractor enforces the loader's cross-field
  rules so every emitted registry loads **without warnings/overrides**: (a) `riskLevel: critical`
  ⇒ force `omissionPolicy: never` if no hard protection was declared; (b) a hard-protected component
  (`retainPolicy ∈ {mandatory, safety_critical}` or `omissionPolicy: never`) never keeps
  `defaultAction: omit` — it is normalized to `include`. Documented, deterministic, defensive.
- **DQ-6 — Assembler = selected-only.** `assemblePrompt` reads **only** `promptPlan.selectedComponents`,
  pulls each component's cached body, and concatenates `## {title}\n\n{body}` in plan order. Omitted
  and deferred components are *excluded* — that is the governance payoff. It also returns a `stats`
  object (selected/omitted/deferred counts; baseline tokens = Σ all registry `tokensApprox`; selected
  tokens; `savedPct`) mirroring the benchmark's savings framing.
- **DQ-7 — Fail-open & robustness.** An absent/empty workspace → a clear thrown error (Class-A parity:
  an empty registry halts the core too). A single unparseable/typeless file → skipped, never fatal.
  The deterministic core's fail-open is inherited unchanged (uncertain ⇒ `general_default` ⇒ fuller
  context). Per **docs/37 DQ-5**, the adapter needs **no per-turn model call**; classification is the
  deterministic router. (A future enrichment may pass `--request-signals`; out of scope here.)

## 4. Type defaults (applied only when frontmatter omits a field)

| type | defaultAction | omissionPolicy | retainPolicy | budgetPriority |
|---|---|---|---|---|
| `scaffold` | include | allow | optional | 3 |
| `skill` | omit | allow | optional | 5 |
| `tool` | include | allow | optional | 4 |
| `history` | include | allow | optional | 5 |
| `memory` | omit | allow | optional | 6 |
| `output_format` | include | allow | optional | 7 |

`riskLevel` defaults to `low`; `requiredWhen`/`safeToOmitWhen`/`tags` default to `[]`; `version`
defaults to `1.0.0`; `evidenceRequired` is always `null`. DQ-5 normalization runs after defaults.

## 5. Modules

- `src/frontmatter.ts` — dependency-free parser for flat frontmatter (`key: value`, inline
  `[a, b]` arrays); CRLF-safe.
- `src/extract.ts` — `extractWorkspace(dir) → { registry, bodies }`. Recursively walks the workspace,
  builds schema-valid `RegistryEntry[]` (sorted by `id` for determinism) + a `Map<id, body>`.
- `src/assemble.ts` — `assemblePrompt(promptPlan, registry, bodies) → { prompt, stats }`.
- `src/index.ts` — `governWorkspace({ workspaceDir, requestText }) → { registry, plan, prompt, stats }`
  (extract → `plan()` → assemble). The one call an OpenClaw-style host would make.
- `src/cli.ts` — `zam-openclaw --workspace <dir> --request "<text>" [--json]`; prints the governed
  prompt + savings stats. Dependency-free arg parsing.
- `example-workspace/` — the documented synthetic OpenClaw workspace (scaffolds, skills, tools,
  history, memory, output), every file carrying explicit governance frontmatter.

## 6. What this is NOT / out of scope

- **Not** a live OpenClaw integration (no `~/.openclaw` read; §2). - **Not** a change to the core, the
  schemas, the fixtures, the runtime, or the benchmarks (additive package only). - **Not** the MCP
  adapter (the strategic second; its own later doc). - **Not** prompt *delivery* to a provider — the
  adapter emits an assembled prompt string; sending it is the host's job (ZAM emits a plan, not calls).

## 7. Verification

- **First-run result (2026-06-16):** the `@zam/adapter-openclaw` suite is **12/12** green. On the
  14-component example workspace, `governWorkspace` measured **73.0% token savings** for a
  `simple_greeting` (`423/1568` tokens; 5 selected / 9 omitted) and **53.0%** for a strong
  `coding_build_debug` request (`737/1568`; 9 selected / 5 omitted) — consistent with the benchmark's
  63.9% mean, with safety preserved (every `never`-omit component stays in the plan).
- New `@zam/adapter-openclaw` suite (extractor + end-to-end `governWorkspace`): every emitted entry is
  schema-shaped and loads cleanly; sizes measured; `hash` is 64-hex; **safety preserved** — every
  `omissionPolicy: never` component is always in `selectedComponents` and its text is in the assembled
  prompt; partition completeness (selected+omitted+deferred = registry size); a `simple_greeting`
  request yields high, safe savings; a strong coding request classifies `coding_build_debug` and
  selects the coding skill while omitting the non-matching skills.
- CI (`.github/workflows/ci.yml`) extended: build + test the adapter on every push/PR (after the core
  build, with `npm install` to link the `file:` dep — same pattern as the runtime).
- Root **757/757** and runtime **354/354** remain untouched (no files in those trees changed).

## 8. Execution contract — Phase 4b

| | |
|---|---|
| **Allowed (create)** | `docs/38_OPENCLAW_ADAPTER.md`; `packages/adapter-openclaw/**` (package, src, example-workspace, tests, README) |
| **Allowed (modify)** | `.github/workflows/ci.yml` (add the adapter build+test job steps only) |
| **Forbidden** | `src/**`, `schemas/**`, `fixtures/**`, `tests/**`, `packages/runtime/**`, `packages/types/**`, `benchmarks/**`; any core/schema/behavior change |
| **Deliverable** | A runnable reference adapter (`governWorkspace` + CLI) with a synthetic workspace and a green suite; CI builds+tests it; the §5 contract demonstrated end-to-end |

---

*4b proves the `docs/37 §5` contract on a real (synthetic) workspace. The MCP adapter (strategic
second) reuses the same contract against a different surface.*
