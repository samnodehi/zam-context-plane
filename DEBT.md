# ZAM — Technical Debt & Known Gaps Register

This file replaces the project's prior "zero technical debt" claim with an honest,
tracked register. "Zero debt" was aspirational; the items below are real and named.
Tracking them openly is stronger than asserting their absence.

Status legend: **OPEN** (not started) · **PLANNED** (scheduled in a roadmap phase) ·
**MITIGATED** (partially addressed) · **CLOSED** (resolved, kept for history).

Roadmap phases referenced below are defined in the approved plan
(`groovy-beaming-shannon` — Phase 1a/1b/2/3/4).

| ID | Severity | Title | Status | Target |
|----|----------|-------|--------|--------|
| C1 | High | Core `promptFamily` classifier is a permanent stub | PLANNED | Phase 2 |
| C2 | Medium | Conflict-resolver canonical-rule gaps; unreachable fixture 13 | PLANNED | Phase 2 |
| C3 | Medium | Hand-synced type/default duplication across core↔runtime | CLOSED | a,b,d in 1b-1; c in 1b-2 |
| C4 | High | No version control | CLOSED | Phase 1a |
| C5 | Medium | Non-constant-time API-key compare; thin auth for SaaS | MITIGATED | Phase 1a (+Phase 4) |
| C6 | High | Value is fixture-proven, not field-proven | PLANNED | Phase 3 |
| C7 | Low | Repo hygiene (root scratch/log/generated clutter) | CLOSED | Phase 1a |
| C9 | Medium | Dead no-progress guard (I-5 over-correction) + 2 stale tests | CLOSED | fixed in fix/c9 |
| C10 | Low | Dev-environment only: dev-dep advisories (prod=0) + vitest major divergence | OPEN | when convenient |
| C-status | Low | Stale `651` test count + `zero tech debt` wording | MITIGATED | Phase 1a (+CI Phase 2) |

---

## C1 — Core classifier is a permanent stub (High)
`src/core/request-normalizer.ts` always returns `promptFamily='general_default'`,
`familyConfidence=0.0`, and never inspects request text. The entire deterministic ladder
keys off `promptFamily`, so the core *enforces a policy given a classification it does not
produce*. Real classification lives in the model analyzer
(`packages/runtime/src/request-analyzer.ts`) or is injected via `--request-signals`.
**Plan:** Phase 2 introduces a deterministic Request Router in the core (`docs/32`),
fail-open to `general_default`, preserving the `--request-signals` bypass and the model
analyzer as a higher tier.

## C2 — Conflict-resolver gaps (Medium)
`src/core/conflict-resolver.ts` header documents cases with "no canonical rule →
fail_open_unresolved as temporary." Fixture 13 (`safety-beats-omit`) is approved-skipped as
"architecturally unreachable." **Plan:** Phase 2 — either define the missing canonical rules
or formally document `fail_open_unresolved` as intended terminal behavior and move fixture 13
to a spec-only set.

## C3 — Hand-synced duplication across boundaries (Medium) — MITIGATED (Phase 1b-1)
The cluster had four items (see `docs/32`):
- **a (CLOSED)** — `AnalyzerOutput` / `ProposalDecision` re-declared in the runtime. Canonical
  definitions moved to `@zam/types` (`packages/types/index.d.ts`), a hand-authored `.d.ts` consumed
  via tsconfig `paths` + `import type` (erased at emit; no install/build/hoist). Core re-exports them.
- **b (CLOSED)** — Class-B defaults triplicated across `api.ts` / `input-loader.ts` / `body-mapper.ts`
  → single source `src/core/class-b-defaults.ts`.
- **d (CLOSED)** — `mergeRegistries` duplicated → single source `packages/runtime/src/merge-registries.ts`.
- **c (CLOSED — Phase 1b-2)** — the fragile `../../../dist/core/api.js` dynamic import in the runtime.
  Implemented DQ-3=A (`import('context-plane')`). Resolution is provided by a workspace-local
  `"context-plane": "file:../.."` dependency in `packages/runtime/package.json` (symlinks the root
  core package into the runtime's `node_modules`). Both `create-agent.ts` and `cli/index.ts` now
  import by package name — no hand-counted relative path remains. The originally-scoped full
  npm-workspaces hoist + `vitest` alignment turned out **unnecessary** for c (the `file:` dep is the
  minimal correct mechanism, since the core is the root package, not a `packages/*` member).

Verified: runtime build + core build green; runtime suite 354/354; the production path smoke-tested
(`createAgent` without an injected planFn loads core via `import('context-plane')`); root 737/737.

## C4 — No version control (High) — CLOSED in Phase 1a
Repo was Google-Drive-synced only. **Resolved:** `git init` + baseline commit; `.gitignore`
hardened (Drive temp dirs, `test-sessions/`); Coder/Reviewer passes now map to branches.

## C5 — Auth security (Medium) — MITIGATED in Phase 1a
`src/http/server.ts` previously used a non-constant-time `provided !== expected` compare.
**Mitigated:** now `timingSafeEqual` over SHA-256 digests (constant-time, length-safe).
**Still open for Phase 4 (any hosted exposure):** single static shared key — no per-consumer
keys, rotation, usage metering, rate limiting, or TLS.

## C6 — Value not field-proven (High)
All evidence is synthetic fixtures. No before/after token-savings number from a real agent's
real traffic. **Plan:** Phase 3 — one reproducible benchmark (with vs without ZAM; and
deterministic vs model-assisted) per the long-promised `docs/09` comparison.

## C7 — Repo hygiene (Low) — CLOSED in Phase 1a
Removed root clutter (`scratch-*.cjs`, `*_log.txt`, `harness-*.txt`, stray generated
`prompt-plan.json`/`trace.json`/`summary.md`) and added root-anchored `.gitignore` patterns
to prevent recurrence.

## C9 — Dead no-progress guard + 2 stale tests (Medium) — CLOSED (fix/c9)
The `@zam/runtime` package has its own 354-test suite, **not part of the headline 651/735 gates**
(those cover only the root `context-plane` package). It had 2 failing tests; investigation showed
one was a genuine logic defect, not just a stale test:

- **Real defect — dead no-progress guard.** The I-5 fix (`docs/28` §4) made Step 3b require the
  EventStream count to be unchanged too. But `analyzer_completed` + `zam_plan` (+ `error`) events
  append every iteration, so the raw count is *never* unchanged → the plan-hash no-progress guard
  became **unreachable**. I-5 stopped a false-positive by silently disabling the guard (other
  safety nets — max_turns, stuck-detector, tool-call-hash — masked it).
  **Fix (Sam-approved option A):** Step 3b now compares a count of **meaningful** events
  (`tool_result` + `user_message`) instead of the raw count. It fires when the plan repeats *and*
  no new external observation arrived (genuinely stuck), while a real re-entry (new `tool_result`)
  still counts as progress — so the I-5 false-positive does not return. New helper
  `countMeaningfulEvents` in `turn-loop.ts`. The "identical plans" test now passes unmodified.
- **Stale test.** `history-state-builder.test.ts > "should NOT set reentryTurn on first turn"`
  asserted `requestSignals` undefined, but `buildZamInput` intentionally always populates it now
  (docs/25 §7.1). Assertion corrected to check that `reentryTurn` specifically is unset.

**Outcome:** runtime suite **354/354**; root suite **737/737** unchanged. **Follow-up (Phase 2 D9):**
CI must run *all* package suites (not just root) so runtime health can't go untracked again.

## C10 — Dev-environment tooling (Low)
Surfaced during Phase 1b-2; neither affects shipped/production code:
- **Dev-dependency advisories.** `npm audit` reports high-severity advisories in the dependency
  tree, but `npm audit --omit=dev` at the root reports **0** — they are all in dev dependencies
  (vitest/tsx/esbuild chain) which never ship (the image installs with `npm ci --only=production`).
  Low urgency; revisit during a dependency-maintenance pass.
- **`vitest` major divergence.** Root uses `vitest ^4`, `packages/runtime` uses `^3`. A minor
  dev-tooling inconsistency (not incorrect logic). The Phase 1b-2 `file:` dep fix did not require
  aligning them. Align when convenient (bump runtime to ^4 and re-run its suite).

## C-status — Stale claims (Low) — MITIGATED in Phase 1a
Docs quoted `651/651` and "zero technical debt." Real full suite is **735/735**; `651` is the
Gate-B core subset (phases 0–12). **Mitigated:** status text clarified across README, release
notes, and the planner board; this register replaces the "zero debt" wording. **Phase 2** adds
a CI step that emits the count so it can't drift again.
