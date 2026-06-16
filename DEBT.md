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
| C3 | Medium | Hand-synced type/default duplication across core↔runtime | MITIGATED | 1b-1 done (a,b,d); c→1b-2 |
| C4 | High | No version control | CLOSED | Phase 1a |
| C5 | Medium | Non-constant-time API-key compare; thin auth for SaaS | MITIGATED | Phase 1a (+Phase 4) |
| C6 | High | Value is fixture-proven, not field-proven | PLANNED | Phase 3 |
| C7 | Low | Repo hygiene (root scratch/log/generated clutter) | CLOSED | Phase 1a |
| C9 | Medium | Runtime suite has 2 pre-existing failing tests; not in any gate | OPEN | Phase 2 (decision) |
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
- **c (OPEN → Phase 1b-2)** — the fragile `../../../dist/core/api.js` dynamic import in the runtime.
  Sam picked DQ-3=A (`import('context-plane')`), but a finding showed that needs the npm-workspaces
  hoist, which collides with the runtime/root `vitest` major divergence (^3 vs ^4) and separate
  installs. Deferred to a dedicated **Phase 1b-2** that does workspaces + vitest alignment properly.
  Until then the existing import remains (it works; not test-covered). This is burning inherited debt
  down in order, not parking new debt.

Verified: 737/737 root suite unchanged; runtime suite unchanged (same 2 C9 fails); both builds green.

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

## C9 — Runtime suite has 2 pre-existing failing tests (Medium)
The `@zam/runtime` package has its own 354-test suite that is **not part of the headline
651/735 gates** (those cover only the root `context-plane` package: core + HTTP + future-harness).
Running it surfaces **2 failing tests**, both stale (test-vs-code drift, not product/network bugs):

- `tests/turn-loop.test.ts > "should detect no-progress (identical plans)"` — expects `no_progress`
  but gets `max_turns`. The documented **I-5 fix** (`docs/28` §4) made no-progress require the event
  count to be unchanged too; with an always-failing provider each turn appends an error event, so the
  loop now runs to `maxTurns`. The test was not updated for I-5.
- `tests/history-state-builder.test.ts > "should NOT set reentryTurn on first turn"` — expects
  `requestSignals` to be `undefined`, but `buildZamInput` now always populates it (M1 analyzer
  integration). Stale assertion.

**Discovered:** Phase 1a (these failures predate git init; this pass changed zero runtime files).
**Plan:** Phase 2 — decide per test whether to update the assertion to the documented intended
behavior or treat it as a real regression; **and** extend CI (D9) to run *all* package suites, not
just the root, so runtime health can't go untracked again.

## C-status — Stale claims (Low) — MITIGATED in Phase 1a
Docs quoted `651/651` and "zero technical debt." Real full suite is **735/735**; `651` is the
Gate-B core subset (phases 0–12). **Mitigated:** status text clarified across README, release
notes, and the planner board; this register replaces the "zero debt" wording. **Phase 2** adds
a CI step that emits the count so it can't drift again.
