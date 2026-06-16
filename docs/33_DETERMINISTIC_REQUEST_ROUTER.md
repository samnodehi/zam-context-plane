# 33 Deterministic Request Router — Phase 2 Scoping

> **Document type:** Scoping Specification — Phase 2 (centerpiece: C1)
> **Status:** Scoping pass — awaiting Sam approval. No code authorized yet.
> **Authority:** Adds a deterministic classifier to the core's Phase 3 (Request Router). Changes the
> **no-signals path only**. Does NOT change schemas, the `--request-signals` bypass, the selector
> ladder, conflict resolver, budgeter, trace/plan shapes, or any model behavior. No model/network calls.
> **Implementation status:** Not implemented.
> **Canonical sources:** approved plan `groovy-beaming-shannon` (Phase 2); `DEBT.md` C1/C2/C-status/D9;
> `src/core/request-normalizer.ts`; `docs/06` §2.1–§2.2, §17.3.4; `schemas/shared/prompt-family.schema.json`;
> `schemas/inputs/request-signals.schema.json`; `docs/25` (model analyzer tiers, for the precedence model).

---

## 1. Purpose & the keystone problem (C1)

`src/core/request-normalizer.ts` (Phase 3) is a **permanent stub**: it always emits
`promptFamily='general_default'`, `familyConfidence=0.0`, and never inspects the request text. The
entire deterministic ladder keys off `promptFamily` (exact-string tag matching) — so today the core
**enforces a policy given a classification it does not produce**. Real classification only happens when
a caller supplies `--request-signals` (e.g. from the runtime's model analyzer, `docs/25`).

C1 makes the "deterministic context governance" claim true end-to-end by adding a **deterministic,
offline, fail-open classifier** to the no-signals path.

### 1.1 The tiered classification model (after C1)
1. **Caller/model signals** (`--request-signals`) — highest fidelity (e.g. M1 analyzer). **Unchanged** —
   the Phase 3 bypass at `request-normalizer.ts` Step 0 still takes precedence.
2. **Deterministic Request Router** (NEW, C1) — best-effort, conservative, offline classification when
   no signals are supplied. Replaces the always-`general_default` stub.
3. **`general_default` floor** — the safe fallback the router returns whenever it is not confident.

## 2. What this is NOT (scope boundary)

- **No model/network calls.** The router is pure and deterministic (offline core invariant).
- **No injection detection** (C1 keeps `injectionSuspect=false` on the no-signals path, as today).
  A deterministic injection detector is a **separate** security-sensitive item (out of C1).
- **No schema changes** (`prompt-family`, `request-signals`, trace, plan — all unchanged; the router
  emits only already-valid enum values + a float confidence).
- **No change** to the `--request-signals` bypass, the selector ladder, conflict resolver, budgeter,
  or any output shape.
- **No move** of the model analyzer into the core (it stays in the runtime as tier 1).

## 3. Decisions

### DQ-1 — Classification approach
**Decision:** A deterministic **keyword/heuristic** classifier (ordered rules + signal scoring). No
model. **Rationale:** the core's defining invariant is offline determinism; a rule classifier is the
only approach consistent with it. (The model analyzer already covers the semantic tier via signals.)

### DQ-2 — Which families the router will assert
The 10 families split by text-detectability:
- **Detectable from request text (router may assert, high-confidence only):** `simple_greeting`,
  `coding_build_debug`, `research_investigation`, `ops_security_change_risk`, `history_sensitive`.
- **NOT reliably text-detectable → router never asserts them** (left to caller/model signals or the
  default): `heartbeat_proactive`, `group_chat_behavior`, `lifecycle_internal`, `tool_use_required`
  (these are runtime/orchestration-driven, not user-text-driven).
- **`general_default`** — the fallback for everything else.
**Rationale:** assert only what request text can justify; never guess a family the text can't support.

### DQ-3 — Confidence model + fail-open
- **Confident, unambiguous single-family match** → that family, `familyConfidence` high (≥ ~0.8).
- **Weak/partial/ambiguous** (no clear winner, or multiple families tie) → `general_default`,
  `familyConfidence` low (< `selectorPolicy.failOpenThreshold`, default 0.7) so selectors fail-open to
  fuller context (docs/06 §2.1, §17.3.4).
- **No signal** → `general_default`, `familyConfidence` 0.0 (preserves today's behavior for blank/unknown).
**Rationale:** confidence is the existing safety lever — low confidence already makes selectors behave
as `general_default`. The router never needs to be "sure" to be safe; it only asserts a narrowing
family when the evidence is strong.

### DQ-4 — Safety bias (the core invariant for this module)
The dangerous error is misclassifying a substantive request into an **omit-heavy** family (above all
`simple_greeting`, whose `safeToOmitWhen` covers many components). Therefore:
- `simple_greeting` is asserted **only on a whole-string greeting/acknowledgement match** (the entire
  trimmed request is a greeting), never on a partial/substring match.
- Any ambiguity, multiple matches, or substantive content beyond the matched signal → `general_default`.
- The router is **fail-open by construction**: when uncertain it returns the *fuller-context* family.
**This mirrors the project spine: smaller context only when safe.**

### DQ-5 — `injectionSuspect` stays out of C1
The router keeps `injectionSuspect=false` on the no-signals path (unchanged). Deterministic injection
detection is a separate, security-sensitive scoping item — bundling it would risk the classifier and
muddy review.

### DQ-6 — Warning semantics
Today Phase 3 unconditionally emits `prompt_family_defaulted`. After C1:
- Emit `prompt_family_defaulted` **only when the router falls back to `general_default`** (no confident
  classification) — its meaning ("no classification performed") becomes accurate.
- On a confident classification, emit no defaulting warning (optionally an advisory trace atom; no new
  warning code required). **No `warning-code` schema change.**
- The bypass path (caller signals) still emits nothing, as today.

## 4. Non-interference (verified)

- **All 28 evaluate fixtures supply `request-signals.json`** and **0 use a bare `request.txt`** — every
  E2E fixture takes the bypass path, which C1 does not touch. **→ the evaluate harness is unaffected.**
- The only tests that assert the stub behavior are the **Phase 3 unit tests**
  (`tests/phase3/request-normalizer.test.ts`): these MUST be updated to the new classifier behavior
  (expected, deliberate).
- Root suite's other tests and the runtime suite do not exercise the no-signals classification path.

## 5. Risk register

| Risk | Impact | Prob | Mitigation |
|------|--------|------|------------|
| R1 Misclassify substantive request into omit-heavy family | High | Low | DQ-4: high-confidence-only; whole-string `simple_greeting`; ambiguity → default. Unit tests for near-miss cases. |
| R2 Phase 3 unit tests break | Low | Certain | Update them deliberately to the classifier contract (in the same pass). |
| R3 Non-determinism (locale/regex/order) | High | Low | Pure function; case-normalize explicitly; deterministic rule order; a determinism unit test (same input ×N → identical output). |
| R4 Warning-semantics change ripples to trace/consumers | Low | Low | `prompt_family_defaulted` already only fires on the no-signals path (no fixture uses it). Verify trace assembler + unit tests. |
| R5 Scope creep into injection detection / new families | Med | Low | DQ-2/DQ-5 fix the boundary; out-of-scope items explicitly deferred. |

## 6. Success criteria

- Router is a **pure deterministic** function: identical text → identical `{promptFamily, familyConfidence}`.
- **Conservative/fail-open:** ambiguous/weak/substantive → `general_default` (low confidence);
  `simple_greeting` only on a whole-string greeting; non-default families only on strong unambiguous signal.
- **Root suite green** (Phase 3 unit tests updated; 28 E2E fixtures unaffected). **Runtime suite 354/354.**
- New unit tests: each detectable family (DQ-2), ambiguity → default, whole-string vs partial greeting,
  determinism, confidence thresholds, and the `--request-signals` bypass still wins.
- `familyConfidence` correctly drives the existing fail-open escalation (docs/06 §17.3.4).

## 7. Phase 2 execution contract (sub-passes; each its own branch → PR)

| Pass | Scope | Key files | Deliverable |
|------|-------|-----------|-------------|
| **2A (C1)** | Deterministic Request Router | `src/core/request-normalizer.ts` (replace stub classifier on the no-signals path; keep Step 0 bypass); new `src/core/request-router.ts` (pure classifier) ; `tests/phase3/request-normalizer.test.ts` (update); new `tests/phase3/request-router.test.ts` | Classifier per DQ-1..6; suites green |
| **2B (C1 E2E)** | Optional end-to-end fixtures exercising the classifier | new `fixtures/NN-*/` with bare `request.txt` (no `request-signals.json`) for ~2 detectable families + ambiguity→default | Evaluate harness exercises the router end-to-end |
| **2C (C2)** | Conflict-resolver canonical-rule decision + fixture 13 | own scoping note; `src/core/conflict-resolver.ts` (define the missing rules) OR formally document `fail_open_unresolved` as intended + retire unreachable fixture 13 to a spec-only set | C2 → CLOSED |
| **2D (D9)** | CI runs **all** package suites + emits status count | CI workflow; a generated status artifact | README/board counts can't drift; runtime suite no longer untracked (closes the C9 follow-up) |

**Order:** 2A → 2B → 2C → 2D. 2A is the substantive design; 2B–2D are smaller. Each gets its own
narrow PR; 2C and 2D get a brief scoping note before code (per R-DOC).

## 8. Verification (per pass)

- **2A:** `npm run build` (core) green; root suite green with updated Phase 3 tests; new router unit
  tests pass (families, ambiguity, determinism, bypass-precedence); runtime suite 354/354 untouched.
- **2B:** evaluate harness runs the new bare-`request.txt` fixtures; produced `promptFamily` matches the
  expected family; the 28 existing fixtures still pass unchanged.
- **2C:** conflict-resolver decision implemented or documented; no unreachable "pending" fixture remains.
- **2D:** CI green on a clean checkout; status count generated from the suites (not hand-edited).

*Code begins only after Sam approves this scope. 2A is the first pass.*
