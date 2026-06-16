# 32 Shared Types & Workspace — Phase 1b Scoping

> **Document type:** Scoping Specification — Phase 1b
> **Status:** Scoping pass — awaiting Sam approval. No code authorized yet.
> **Authority:** Structural refactor only. **Zero behavior change.** Does not touch any schema,
> fixture, enum, warning code, trace shape, prompt-plan shape, or selector/conflict/budget logic.
> **Implementation status:** Not implemented.
> **Canonical sources:** approved plan `groovy-beaming-shannon` (Phase 1b); `DEBT.md` C3;
> `src/core/api.ts`; `packages/runtime/src/{request-analyzer,model-selector,create-agent}.ts`;
> `packages/runtime/src/cli/index.ts`.

---

## 1. Purpose

Close `DEBT.md` **C3** — hand-synchronized duplication across the core↔runtime boundary — at its
root cause (no shared types package + a fragile cross-package import), without changing any runtime
behavior. This unblocks every later phase that touches both packages.

## 2. The C3 cluster (grounded inventory)

| ID | Item | Where | Driver |
|----|------|-------|--------|
| a1 | `AnalyzerOutput` re-declared | `packages/runtime/src/request-analyzer.ts` (mirrors `src/types/analyzer.ts`) | runtime can't import across `rootDir` |
| a2 | Model-selector output type "must stay in sync" | `packages/runtime/src/model-selector.ts` | same |
| b  | Class-B defaults "MUST stay identical" | `src/core/api.ts`, `src/core/input-loader.ts`, `src/http/body-mapper.ts` | no single source |
| c  | Fragile core import `new URL('../../../dist/core/api.js')` (depth-counted) | `packages/runtime/src/create-agent.ts`, `packages/runtime/src/cli/index.ts` | no resolvable `context-plane` dep |
| d  | `mergeRegistries` duplicated | `packages/runtime/src/create-agent.ts`, `packages/runtime/src/cli/index.ts` | no shared util |

## 3. What this is NOT (scope boundary)

- **Not** moving core `src/` into `packages/core` (that is Option B in DQ-1 — deferred; higher risk
  to schema relative paths, Dockerfile, bin paths).
- **Not** changing the runtime's dependency-injection design (`createZamClient(planFn)` stays).
- **Not** changing any schema, fixture, public output shape, or planning behavior.
- **Not** publishing anything to npm.

## 4. Decisions

### Finding during implementation-prep (2026-06-16) — refines DQ-1/DQ-3
Reading the actual setup surfaced facts the initial scoping under-weighted:
- Root and runtime have **separate installs** and **divergent test tooling** (`vitest ^4` at root,
  `vitest ^3` in runtime). A full npm-workspaces hoist would reshuffle the runtime's working
  `node_modules`/lockfile and force the two vitest majors to coexist — real risk against the
  "zero behavior change / 737 unchanged" bar.
- The runtime's `tsconfig` **excludes `tests/`**, and the integration test already cross-imports core
  via a **relative source path** (`../../../../src/core/api.js`), injected as `planFn`. So the
  fragile `create-agent.ts` dynamic import (item c) is **not exercised by any test** — only by tsc and
  production.
- The duplicated types are pure **`[FUTURE-ONLY]` interfaces** → consumable as **type-only** imports.

**Consequence:** the type/dedup items (a, b, d) can be closed with **zero packaging risk** and without
workspaces. Item c (DQ-3) is the only part that needs a module-resolution mechanism, and is the only
risky piece. We therefore **split** the pass (see §8).

### DQ-1 — Workspace layout (refined)
**Decision:** Do **not** convert to full npm-workspaces hoisting now. Add `packages/types`
(`@zam/types`) as the single owner of the shared types, consumed via **tsconfig `paths` + `import
type`** (erased at emit; esbuild/vitest never resolve it; no install, no hoist, no lockfile churn).
Core re-exports the moved types so existing core imports are unchanged. **Rationale:** closes the
duplication driver (`rootDir`) with the smallest possible blast radius; defers the heavier
workspaces/vitest-alignment work to when it's actually needed (publishing, Phase 4).

### DQ-2 — Contents of `@zam/types`
**Decision:** only the genuinely cross-boundary types: `AnalyzerOutput` (canonical, from
`src/types/analyzer.ts`) and the model-selector output shape. Core keeps re-exporting them from
`src/types/*` (so existing core imports are unchanged); runtime imports from `@zam/types`.
**Rationale:** minimal, grounded extraction — only what is duplicated today.

### DQ-3 — The fragile core import (item c)
**Sam picked Option A** (`await import('context-plane')` by package name). The implementation-prep
finding shows A *requires* `context-plane` to be resolvable from the runtime — which means either the
npm-workspaces hoist (now deferred per refined DQ-1, due to the vitest-major risk) or a `file:` local
dependency (risks a node_modules symlink cycle to the workspace root). Either carries the exact risk
we are deliberately deferring, and item c is **not test-covered**, so the win is compile-time
cleanliness only.

**Therefore c is split to a dedicated follow-up** (Phase 1b-2), bundled with the workspaces +
`vitest` alignment when that is done properly. Until then the existing dynamic import remains (it
works); it stays tracked in `DEBT.md` C3 as partially-open. This is burning inherited debt down in
order (allowed), not parking new debt.

### DQ-4 — Class-B defaults (item b)
**Decision:** extract the four defaults to a single exported constant in core (e.g.
`src/core/class-b-defaults.ts`); `api.ts`, `input-loader.ts`, `body-mapper.ts` import it. No values
change. **Rationale:** single source of truth; removes the "MUST stay identical by hand" comment.

### DQ-5 — `mergeRegistries` (item d)
**Decision:** move to one shared module in the runtime package and import from both `create-agent.ts`
and `cli/index.ts`. **Rationale:** removes the "duplicates the logic" comment; identical behavior.

## 5. Non-interference guarantee (locked artifacts)

`schemas/**`, `fixtures/**`, all enum/warning/trace/prompt-plan shapes, selector ladder, conflict
resolver, budgeter logic, and all HTTP route behavior. No values in the Class-B defaults change. The
737/737 root suite and runtime suite behavior must be unchanged (runtime's 2 known C9 failures remain
exactly those 2 — not more).

## 6. Risk register

| Risk | Impact | Prob. | Mitigation |
|------|--------|-------|------------|
| R1 tsconfig `rootDir`/project-reference wiring breaks builds | High | Med | Add `@zam/types` as a referenced project; build types first; verify both `tsc` runs green. |
| R2 Schema relative paths in runtime (`../../../schemas/...`) break | High | Low | We do not move files that resolve schemas; only add imports. Verify analyzer schema load still works. |
| R3 DQ-3 Option A: `context-plane` not resolvable at runtime | Med | Low | Workspace symlink puts it in `node_modules`; verify `createAgent` integration test + a real dynamic import. |
| R4 Vitest module resolution changes with workspaces | Med | Low | Run full suite from root after change; both packages. |
| R5 Hidden third duplicated type missed | Low | Med | grep runtime for `mirrors`/`must stay in sync`/`rootDir` before finishing; extract all. |

## 7. Success criteria

- No duplicated `AnalyzerOutput`/model-selector type in the runtime (imported from `@zam/types`).
- Single Class-B-defaults source; the "MUST stay identical" comment is gone.
- (If DQ-3=A) no `../../../dist/core/api.js` path remains.
- `mergeRegistries` defined once.
- **Root suite 737/737; runtime suite unchanged (still exactly the 2 C9 failures); both `tsc` builds green.**
- `DEBT.md` C3 → CLOSED (and C9 noted: still open, untouched here).

## 8. Execution contract (one pass)

| Allowed to create/modify | Forbidden |
|---|---|
| `packages/types/**` [NEW]; root `package.json` (workspaces field); `package-lock.json`; `tsconfig*` (project refs); `packages/runtime/package.json` (+`@zam/types`, +`context-plane` if DQ-3=A); `packages/runtime/src/{request-analyzer,model-selector,create-agent,cli/index}.ts`; `src/types/{analyzer,...}.ts` (re-export only); new `src/core/class-b-defaults.ts`; `src/core/{api,input-loader}.ts` + `src/http/body-mapper.ts` (import the constant); `DEBT.md` (C3→CLOSED) | `schemas/**`, `fixtures/**`, selector/conflict/budgeter logic, any output shape, any test assertion (tests may only be added if a new shared module needs coverage) |

## 9. Verification

1. `npm install` (root) — workspaces link `@zam/types` and (if DQ-3=A) `context-plane`.
2. `npm run build` (root) and `npm --prefix packages/runtime run build` — both exit 0.
3. `npm test` (root) — **737/737**.
4. `npm --prefix packages/runtime test` — same result as today (exactly the 2 pre-existing C9 fails,
   no new failures).
5. grep: zero `mirrors`/`must stay in sync`/`../../../dist/core/api.js` left (per DQ-3 choice).

*Code begins only after Sam approves the scope and picks DQ-3.*

---

## 10. Phase 1b-1 outcome (2026-06-16) — DONE

Sam approved the split (1b-1 now; c → 1b-2) and DQ-3=A. Landed in this pass:
- **a — CLOSED.** `@zam/types` (`packages/types/index.d.ts`, hand-authored `.d.ts`) is the single
  owner of `AnalyzerOutput`, `ProposalDecision`, `ModelSelectorOutput`. Consumed via tsconfig `paths`
  + `import type` (both packages). Core (`src/types/analyzer.ts`, `src/types/model-selector.ts`) and
  runtime (`request-analyzer.ts`, `model-selector.ts`) re-export/import it; no duplicate interfaces remain.
- **b — CLOSED.** `src/core/class-b-defaults.ts` is the single source; `api.ts`, `input-loader.ts`,
  `body-mapper.ts` import it.
- **d — CLOSED.** `packages/runtime/src/merge-registries.ts` is the single source; `create-agent.ts`
  and `cli/index.ts` import it.
- **c — DEFERRED to Phase 1b-2** (workspaces + `vitest` alignment), tracked in `DEBT.md` C3.

**Verification (all green):** core `tsc` build, runtime `tsc` build; root suite **737/737**; runtime
suite unchanged (same 2 pre-existing C9 failures, 352/354). Grep confirms zero leftover duplicate
interfaces, default consts, `mergeRegistries` definitions, or "stay in sync" comments.

---

## 11. Phase 1b-2 outcome (2026-06-16) — DONE

Implemented DQ-3=A (`import('context-plane')`) and closed C3 item c. The originally-scoped full
npm-workspaces hoist + `vitest` alignment proved **unnecessary**: because the core *is* the root
package (not a `packages/*` member), the minimal correct mechanism is a workspace-local **`file:`
dependency**, not a workspaces hoist.

- `packages/runtime/package.json` gains `"context-plane": "file:../.."` → `npm install` symlinks
  `packages/runtime/node_modules/context-plane → <repo root>`. `import('context-plane')` then
  resolves by name at runtime, and `tsc` resolves its types from the root package's built `.d.ts`.
- `create-agent.ts` and `cli/index.ts` now `await import('context-plane')` — no hand-counted
  `../../../dist/core/api.js` path remains. Imports stay dynamic (lazy core load).
- **Build order:** the runtime build now depends on the core being built first (so its `.d.ts`
  exists for type resolution) — a normal, intended monorepo coupling.

**Verification (all green):** core build, runtime build; runtime suite **354/354**; root suite
**737/737**; production path smoke-tested (`createAgent` with no injected `planFn` loads the core via
`import('context-plane')` and creates a session). C3 → CLOSED. Dev-only follow-ups noted as DEBT C10.
