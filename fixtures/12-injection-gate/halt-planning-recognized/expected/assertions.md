# Fixture: 12-injection-gate / halt-planning-recognized

## Purpose

Verify that `halt_planning` is treated as a **recognized reserved value** (not a typo/unknown string):
1. `halt_planning` passes the raw input schema boundary (open string — not rejected).
2. The orchestrator recognizes it as a known-but-not-implemented value.
3. Produces `policy_value_not_implemented` warning — **not** `injection_action_unknown`.
4. Normalizes effective policy to `warn_and_continue`.
5. Planning run **completes** — no halt output.
6. `requestedInjectionSuspectAction = "halt_planning"` is preserved in trace.

This is the **critical behavioral distinction** between `halt_planning` (recognized reserved) and any
other unknown string (unrecognized typo). Both normalize to `warn_and_continue`, but they emit
different warning codes. A harness that collapses them is a conformance failure.

## Inputs

- `selector-policy.json.injectionSuspectAction = "halt_planning"` (recognized reserved, not implemented)
- `request-signals.json.injectionSuspect = true` (gate is active)
- `request-signals.json.familyConfidence = 0.82` (above `failOpenThreshold = 0.7`, no escalation)

## Key Assertions

### Schema boundary
- ASSERT: `selector-policy.json` validates against `schemas/inputs/selector-policy.schema.json`
  (open string — `halt_planning` is accepted, not rejected)

### Trace: policy fallback fields
- ASSERT: `trace.requestPhase.requestedInjectionSuspectAction == "halt_planning"`
- ASSERT: `trace.requestPhase.effectiveInjectionSuspectAction == "warn_and_continue"`
- ASSERT: `trace.requestPhase.policyFallbackReasons` is a non-empty array
- ASSERT: `trace.requestPhase.policyFallbackReasons` contains an entry referencing
  `halt_planning_recognized_not_implemented` (or equivalent machine-readable reason atom)

### Global warnings
- ASSERT: `trace.warnings` contains an entry with `code == "policy_value_not_implemented"`
- ASSERT: `trace.warnings` does NOT contain any entry with `code == "injection_action_unknown"`
- ASSERT: `trace.warnings` contains an entry with `code == "injection_suspect_warn_and_continue"`

### Planning run completion
- ASSERT: `trace.run.planningRunCompletedAt` is present and non-empty
- ASSERT: `trace.budgetPhase` is present (run completed, budget phase executed)
- ASSERT: `trace.planPhase.selectedComponents` is non-empty (plan was produced)
- ASSERT: `prompt-plan.json.selectedComponents` is non-empty (plan output exists)

### Trace structure
- ASSERT: `trace.json` top-level keys are exactly: `run`, `requestPhase`, `registryPhase`,
  `selectorPhase`, `conflictPhase`, `budgetPhase`, `planPhase`, `warnings`
- ASSERT: `trace.json` does NOT have a top-level key `injectionGatePhase`
- ASSERT: each `selectorTrace` entry has: `decisionId`, `module`, `failOpen`, `estimatedSavings`, `selector`
- ASSERT: no `selectorTrace` entry has: `traceRefs`, `constraintsApplied`

### Accounting invariant
- ASSERT: `trace.conflictPhase.noConflictComponentIds.length` + `trace.conflictPhase.conflictResolutionTrace.length`
  == `trace.registryPhase.candidateSetSummary.candidateSetSize`
  (Expected: 2 + 0 == 2)

### Negative assertions (injection_action_unknown must NOT appear)
- ASSERT: `trace.warnings` does NOT include `injection_action_unknown`
- ASSERT: `prompt-plan.json.planningWarnings` does NOT include `injection_action_unknown`

## Known Limitations

- Expected files are reference-only. Full assertion execution requires a harness runner (Pass 4.9D-3+).
- `resolvedAt` timestamps are placeholder ISO strings — harness must accept any valid ISO 8601 value.
- The `narrative` field is a placeholder — harness must assert it matches the deterministic template
  computed from count fields (docs/06 §3.6).

## Canonical References

- `docs/06` §2.9 — `halt_planning`: recognized reserved (not a typo); `policy_value_not_implemented`
  is the correct warning code; `injection_action_unknown` must NOT be emitted for `halt_planning`
- `docs/06` §17.6 — policy fallback trace fields: `requestedInjectionSuspectAction`,
  `effectiveInjectionSuspectAction`, `policyFallbackReasons` on `requestPhase`
- `docs/12` §3.7, §6.1 — `halt_planning` is "Accept (do not reject)" at raw input schema boundary;
  maps to `policy_value_not_implemented` not `injection_action_unknown`
- `schemas/inputs/selector-policy.schema.json` — open string, no enum (Pass 4.9C-2B.1)
