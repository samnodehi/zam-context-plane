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

### DQ-1 — Workspace layout
**Decision:** npm **workspaces**; add one new package `packages/types` (`@zam/types`). Core stays at
repo root (`context-plane`); runtime stays at `packages/runtime`. Root `package.json` gains
`"workspaces": ["packages/*"]`. **Rationale:** kills the `rootDir` driver with minimal blast radius;
avoids the risky Option B move.

### DQ-2 — Contents of `@zam/types`
**Decision:** only the genuinely cross-boundary types: `AnalyzerOutput` (canonical, from
`src/types/analyzer.ts`) and the model-selector output shape. Core keeps re-exporting them from
`src/types/*` (so existing core imports are unchanged); runtime imports from `@zam/types`.
**Rationale:** minimal, grounded extraction — only what is duplicated today.

### DQ-3 — The fragile core import (item c) — **needs Sam's pick**
- **Option A (recommended):** with workspaces, `context-plane` is resolvable from `@zam/runtime`, so
  replace `new URL('../../../dist/core/api.js', …)` with a clean `await import('context-plane')`.
  Keeps the dynamic/decoupled design (no static compile dependency) but removes the fragile path.
- **Option B:** leave item c untouched (types-only fix). Lower change, but knowingly leaves debt —
  conflicts with the R-DEBT rule.
- **Option C:** static `import { plan } from 'context-plane'`. Cleanest types, but changes the
  intentional runtime→core decoupling and build ordering. Higher risk.

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
