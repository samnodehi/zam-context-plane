# Fixture: 12-injection-gate / unknown-policy-value

## Purpose

Verify that an unknown (unrecognized) `injectionSuspectAction` string is:
1. **Accepted at the raw input schema boundary** (schema does not reject it — open string, no enum).
2. **Normalized by the orchestrator** to `warn_and_continue`.
3. **Recorded in trace** as `requestedInjectionSuspectAction = "weird_future_policy"` and `effectiveInjectionSuspectAction = "warn_and_continue"`.
4. Produces a **global `injection_action_unknown` warning** in `trace.warnings[]`.
5. Does **NOT** produce `policy_value_not_implemented` (that is reserved for `halt_planning` only).
6. The planning run **completes normally** — no halt.

## Inputs

- `selector-policy.json.injectionSuspectAction = "weird_future_policy"` (unknown string)
- `request-signals.json.injectionSuspect = true` (gate is active)
- `request-signals.json.familyConfidence = 0.82` (above `failOpenThreshold = 0.7`, so no familyConfidence escalation)

## Key Assertions

### Schema boundary
- ASSERT: `selector-policy.json` validates against `schemas/inputs/selector-policy.schema.json` (open string — no enum rejection)

### Trace: policy fallback fields
- ASSERT: `trace.requestPhase.requestedInjectionSuspectAction == "weird_future_policy"`
- ASSERT: `trace.requestPhase.effectiveInjectionSuspectAction == "warn_and_continue"`
- ASSERT: `trace.requestPhase.policyFallbackReasons` is a non-empty array
- ASSERT: `trace.requestPhase.policyFallbackReasons` includes an entry containing `unrecognized` or similar normalization reason atom

### Global warnings
- ASSERT: `trace.warnings` contains an entry with `code == "injection_action_unknown"`
- ASSERT: `trace.warnings` does NOT contain any entry with `code == "policy_value_not_implemented"`
- ASSERT: `trace.warnings` contains an entry with `code == "injection_suspect_warn_and_continue"`

### Trace structure
- ASSERT: `trace.json` top-level keys are exactly: `run`, `requestPhase`, `registryPhase`, `selectorPhase`, `conflictPhase`, `budgetPhase`, `planPhase`, `warnings`
- ASSERT: `trace.json` does NOT have a top-level key `injectionGatePhase`
- ASSERT: `trace.selectorPhase.selectorTrace` is a non-empty array of TraceEntry objects (not SelectionDecision objects)
- ASSERT: each `selectorTrace` entry has: `decisionId`, `module`, `failOpen`, `estimatedSavings`, `selector`
- ASSERT: no `selectorTrace` entry has: `traceRefs`, `constraintsApplied`

### Accounting invariant
- ASSERT: `trace.conflictPhase.noConflictComponentIds.length` + `trace.conflictPhase.conflictResolutionTrace.length` == `trace.registryPhase.candidateSetSummary.candidateSetSize`
  (Expected: 2 + 0 == 2)

### Output partition correctness
- ASSERT: `prompt-plan.json.selectedComponents` all have `action == "include"`
- ASSERT: `prompt-plan.json.omittedComponents` is empty (warn_and_continue upgrades any omit to fail_open)
- ASSERT: no entry in any partition array has `action == "reference_unknown"` or `path == "reference_unknown"`

### Negative assertions (policy_value_not_implemented must NOT appear)
- ASSERT: `trace.warnings` does NOT include `policy_value_not_implemented`
- ASSERT: `prompt-plan.json.planningWarnings` does NOT include `policy_value_not_implemented`

## Known Limitations

- Expected files are reference-only. Full assertion execution requires a harness runner (Pass 4.9D-3+).
- `selectorTrace` entries in `trace.json` show example TraceEntry shapes; actual field population depends on orchestrator implementation.
- `resolvedAt` timestamps are placeholder ISO strings — harness must accept any valid ISO 8601 value, not compare exact strings.
- The `narrative` field in `selectorSummary` is a placeholder string; harness must assert it matches the deterministic template computed from count fields (docs/06 §3.6), not compare this literal string.

## Canonical References

- `docs/06` §2.9 — `injectionSuspectAction` open string; `injection_action_unknown` vs `policy_value_not_implemented` distinction
- `docs/06` §17.6 — policy fallback trace fields placement in `requestPhase`
- `docs/12` §3.7, §6.1 — boundary rule: unknown values accepted at raw input; orchestrator normalizes
- `schemas/inputs/selector-policy.schema.json` — open string, no enum (Pass 4.9C-2B.1)
