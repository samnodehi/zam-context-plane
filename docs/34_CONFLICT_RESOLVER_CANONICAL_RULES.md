# 34 Conflict-Resolver Canonical Rules — Phase 2c Scoping (C2)

> **Document type:** Scoping Specification — Phase 2c (C2; option A approved by Sam)
> **Status:** Scoping pass — awaiting Sam approval of the proposed rules. No code authorized yet.
> **Authority:** Completes the conflict-resolver logic by defining the missing canonical
> `resolutionRule` values and fixing one outcome bug. Touches the (previously "locked") `ResolutionRule`
> enum — authorized because completing this logic is the explicit purpose of C2/option A. No change to
> the selector ladder, budgeter, prompt-plan shape, or any other output shape.
> **Implementation status:** Not implemented.
> **Canonical sources:** `DEBT.md` C2; `docs/06` §11.3.1a, §11.4, §11.5; `src/core/conflict-resolver.ts`;
> `src/types/conflict.ts`; `schemas/shared/enums.shared.schema.json`; `tests/phase8/conflict-resolver.test.ts`.

---

## 1. Purpose

`src/core/conflict-resolver.ts` documents four "spec gaps" where it falls back to
`fail_open_unresolved` because the canonical `resolutionRule` enum lacks a value for the case. The
spec (`docs/06` §11.5) **already defines the intended resolutions** for these cases — the gap is that
the enum (§11.3.1a) was never extended, so the code couldn't label them. C2/option A completes the
logic: add the missing enum values, implement the spec's resolutions, and remove the spurious
"unresolved conflict" warnings.

## 2. Findings (current behavior, grounded in the code)

| Gap (code) | Spec (§11.5) intends | Code currently does | Severity |
|---|---|---|---|
| **Case 3** — omit vs ordinary defer (`conflict-resolver.ts` ~620) | **defer wins** (`defer_overrides_omit`) | `finalAction='include'`, `fail_open_unresolved` — *while also emitting a `defer_overrides_omit` warning* (self-contradictory) | **Outcome bug** |
| **Case 1** — include vs omit, P5 (~561) | include wins, with the include's path | correct outcome (`include`) but `finalPath` normalized to `fail_open`, `rule=fail_open_unresolved` + "unresolved" warning | Mislabel |
| **Case 2A** — include vs ordinary defer (~600) | include wins (`include_overrides_defer`) | correct outcome (`include`) but `fail_open_unresolved` + "unresolved" warning | Mislabel |
| **Single `conflict_include`** (~517) | single ladder-Step-4 include → include | `include` but `fail_open_unresolved` + "unresolved" warning (it is NOT an unresolved conflict) | Mislabel |

**Reachability note:** In MVP each component has exactly **one** primary selector (`docs/06` §10 fan-out
rule), so the multi-decision cases (1, 2A, 3) are **defensive paths not exercised by E2E fixtures** —
they are covered by **unit tests** (`tests/phase8`). **Single `conflict_include` IS reachable** (one
selector, ladder Step 4: both `requiredWhen` and `safeToOmitWhen` match). Case 3's outcome bug
therefore matters for correctness-of-the-logic and future multi-selector decisions, not current E2E.

## 3. Decisions (proposed canonical rules — need Sam's approval)

### DQ-1 — Four new `resolutionRule` enum values
Add to `schemas/shared/enums.shared.schema.json#ResolutionRule` and `src/types/conflict.ts`:

| New value | Case | finalAction / finalPath | Notes |
|---|---|---|---|
| `defer_over_omit` | Case 3 | **`defer`** / `default_defer` | Implements §11.5 "defer wins." Warning `defer_overrides_omit` retained in `warningsEmitted`. |
| `include_over_omit` | Case 1 (P5, ordinary) | `include` / winning include's real path | §11.5 Case 1 "include wins unconditionally." Keep `include_vs_omit_with_not_evaluated` warning when applicable. |
| `include_over_defer` | Case 2A | `include` / winning include's real path | §11.5 Case 2A. Warning `include_overrides_defer` retained. |
| `conflict_include_resolved` | single `conflict_include` | `include` / `conflict_include` | Single ladder-Step-4 include; not an unresolved conflict. |

### DQ-2 — Case 3 outcome change (the one behavioral change) — **flagged for explicit approval**
Case 3 currently resolves to **include**; the spec says **defer**. Option A = implement the spec →
**the outcome changes from `include` to `defer`** for omit-vs-defer conflicts. Both exclude the
component from the current plan; `defer` is the spec's intended, less-final semantics ("not yet, not
never"). This is *less* inclusive than today's accidental `include`, but it is the canonical rule and
only occurs in the (currently-unreachable) multi-selector path. **Confirm this is intended.**

### DQ-3 — Stop emitting "unresolved" warnings for now-resolved cases
The four cases above must no longer push `unresolvedConflictWarnings` / `unresolved_conflict_fail_open`
— they are resolved by canonical rules now. `fail_open_unresolved` remains ONLY for a genuinely
unmatched conflict group (the final `else`, ~671) as the safety net.

### DQ-4 — Fixture 13 (`safety-beats-omit`) — keep as documented-intended skip
Independent of the rule gaps: `safety-beats-omit` is approved-skipped because `safety_hard_protection`
(Case 8) is unreachable through the single-primary-selector E2E routing (Step 3 hard-protection fires
in the ladder before any omit decision is produced). It is covered by unit test **SHP-1**. **Decision:**
keep it as an intended, documented skip (update its `skip-reason.json` wording to "intended:
architecturally unreachable in single-selector MVP; covered by SHP-1"), rather than inventing an
unreachable E2E path. (This is the honest closure for fixture 13; it is not a missing rule.)

## 4. What this is NOT
- No change to the selector ladder, budgeter, PPG, trace shape (beyond the additive enum values), or
  any output file shape. No new warning codes (reuses existing `defer_overrides_omit`,
  `include_overrides_defer`). No model/network calls.

## 5. Change inventory
- `schemas/shared/enums.shared.schema.json` — add the 4 `ResolutionRule` values.
- `src/types/conflict.ts` — add the same 4 to the `ResolutionRule` union.
- `docs/06` §11.3.1a — document the 4 values + case mappings; update Case 3's note that the enum now has `defer_over_omit`.
- `src/core/conflict-resolver.ts` — implement Cases 3/1/2A/single-conflict_include per DQ-1; remove their `unresolvedConflictWarnings`; update the file header (remove the "spec gaps" block).
- `tests/phase8/conflict-resolver.test.ts` — update expectations (new rules; Case 3 → defer; no "unresolved" warnings for resolved cases); add coverage for each new rule.
- `fixtures/13-conflict-resolution/safety-beats-omit/inputs/skip-reason.json` — reword to "intended/unreachable."

## 6. Risk register
| Risk | Impact | Prob | Mitigation |
|---|---|---|---|
| R1 Case 3 defer is a real outcome change | Med | — | Only fires in the unreachable multi-selector path; flagged in DQ-2 for approval; defer is the spec's choice. |
| R2 Enum addition breaks schema $refs / harness "unrecognized resolutionRule" check | High | Low | enums.shared is the single source; other schemas `$ref` it. Harness check (§11.7) *accepts* canonical-enum values — adding to the enum keeps it valid. Run full suite. |
| R3 Phase-8 unit tests assert the old `fail_open_unresolved` labels | Med | Certain | Update them deliberately to the new rules (expected). |
| R4 E2E fixtures change | Low | Very Low | Cases 1/2A/3 are unreachable in E2E (single selector); the 28 fixtures should be unaffected. Verify. |

## 7. Success criteria
- The 4 new `resolutionRule` values exist in the shared schema + TS type + docs/06 §11.3.1a.
- Case 3 resolves to **`defer`/`default_defer`/`defer_over_omit`**; Cases 1/2A/single-conflict_include
  resolve to `include` with their proper rule + real path; none emit `unresolved_conflict_fail_open`.
- `fail_open_unresolved` remains reachable only for a genuinely unmatched group.
- Root suite green (phase-8 tests updated; 28 E2E fixtures unaffected); runtime suite 354/354.
- The "spec gaps" block is gone from the conflict-resolver header. `DEBT.md` C2 → CLOSED.

## 8. Verification
1. `npm run build` green. 2. `npm test` (root) green — updated phase-8 unit tests assert each new rule;
the evaluate harness (28 fixtures) still passes. 3. runtime suite 354/354. 4. grep: no
`fail_open_unresolved` emitted for Cases 1/2A/3/single-conflict_include; no "spec gap" comments remain.

*Code begins only after Sam approves §3 (especially DQ-2, the Case-3 outcome change).*
