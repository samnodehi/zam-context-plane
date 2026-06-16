# Release Notes — v0.1.0

**Version:** 0.1.0
**Date:** 2026-06-03
**Package:** `context-plane`

---

## Included in This Release

### CLI MVP — Phases 0–12

- Phase 0: Repo layout and CLI skeleton
- Phase 1: Input loading and validation boundaries (Class A/B)
- Phase 2: Registry loading, indexing, and quarantine
- Phase 3: Request / runtime / history / userConstraints / active-IDs normalization (`--request-signals` support)
- Phase 4: Candidate set construction and `candidateSetSummary`
- Phase 5: Selector fan-out and deterministic 12-step ladder (8 selector types)
- Phase 6: Gap-check and synthetic `not_evaluated` injection
- Phase 7: Injection gate (fail-open, halt-planning, warn-and-continue, familyConfidence escalation)
- Phase 8: Conflict resolution (12 cases, Case 12 history-malformed fail-open)
- Phase 9: Budget-aware planning (over_budget_protected, expensive_optional, candidate_optional)
- Phase 10: Prompt plan generator (`prompt-plan.json`)
- Phase 11: Trace and summary assembler (`trace.json`, `summary.md`)
- Phase 12: Evaluation harness (28 fixture cases, approved-skip mechanism, `skip-reason.json` validation)

### Schema Batches

All MVP schema batches created and accepted:

- Batch A: shared enums, prompt-family, warning-code
- Batch B: inputs (active-ids, runtime-capabilities, history-state-summary, budget-state, user-constraints, selector-policy) + Batch B extension
- Batch C: internal data objects (SelectionDecision, ResolvedSelectionDecision, TraceEntry, etc.)
- Batch D: output files (prompt-plan.json, trace.json)

---

## Gate B Final Status

```
SATISFIED WITH 1 APPROVED SKIP(S)
```

- 27 of 28 E2E fixtures passed
- 1 fixture approved-skipped: `13-conflict-resolution/safety-beats-omit`

### Known Limitation — Fixture 13

`safety_hard_protection` conflict is architecturally unreachable through the current MVP E2E selector routing. The deterministic ladder applies hard protection (Step 3) before `safeToOmitWhen` (Step 7), producing a single `include/safety_override` decision per component. No multi-selector conflict is possible for the same component type.

The code path is implemented and covered by unit test **SHP-1** in `tests/phase8/conflict-resolver.test.ts`. The approved skip is documented in `fixtures/13-conflict-resolution/safety-beats-omit/inputs/skip-reason.json`.

---

## Test Results

- **Gate-B core suite (phases 0–12):** 651/651 — 14 test files, all pass
- **Full suite (incl. HTTP API + model-assisted future-harness):** 735/735 — verified 2026-06-16
- **Evaluate:** `passed=27 failed=0 skipped=1 blocked=0 EXIT:0`
- **Tracked known gaps:** see `DEBT.md`

---

## Out of Scope

- Gate D: OpenClaw adapter, n8n adapter, Telegram adapter — intentionally out of MVP scope; blocked by design
- Live provider or model calls
- Runtime prompt mutation
- Model-assisted selectors

---

## Pending (Non-Blocking)

- `READY_FOR_REVIEW.txt` formalization into `docs/13_MODEL_ASSISTED_CONTEXT_PLANNING.md` — separate controlled pass required
