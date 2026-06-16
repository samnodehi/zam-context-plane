# assertions.md — fixtures/03-candidate-set-summary/gap-check-accounting/

## Purpose

Verify that `candidateSetSummary.candidateSetSize` is the correct accounting denominator
and that the gap-check invariant holds:

  `noConflictComponentIds.length + conflictResolutionTrace.length == candidateSetSummary.candidateSetSize`

## Fixture Design

This seed fixture uses a minimal 3-component registry (scaffold.system-rules,
skill.general-assistant, skill.context-summary) with no conflicts. All 3 components
receive a single unambiguous decision and are resolved with `resolutionRule: "no_conflict"`.

- `candidateSetSize`: 3 (all 3 components entered the selector fan-out; none quarantined)
- `noConflictComponentIds.length`: 3
- `conflictResolutionTrace.length`: 0
- Accounting check: 3 + 0 = 3 ✓

## Gap-Check Invariant (Zero-Tolerance)

The harness MUST assert:

  trace.registryPhase.candidateSetSummary.candidateSetSize
    == trace.conflictPhase.noConflictComponentIds.length
       + trace.conflictPhase.conflictResolutionTrace.length

If any component silently escapes accounting (appears in neither array), this check fails.

## Key Assertions

1. `trace.registryPhase.candidateSetSummary.candidateSetPolicy` == `"all_non_quarantined"`
2. `trace.registryPhase.candidateSetSummary.candidateSetSize` == 3
3. `trace.registryPhase.quarantinedCount` == 0
4. `trace.conflictPhase.noConflictComponentIds.length` == 3
5. `trace.conflictPhase.conflictResolutionTrace.length` == 0
6. Accounting invariant: 3 + 0 == 3 ✓
7. `trace.conflictPhase.resolvedDecisions.length` == 3 (one per candidate)
8. All `resolvedDecisions[].resolutionRule` == `"no_conflict"`
9. All `resolvedDecisions[].resolvedBy` == `"conflict_resolver"`
10. `resolvedDecisions[].resolvedAt` is an integer (monotonic step counter, not ISO timestamp)
11. `trace.budgetPhase.budgetOverflow` == false
12. `trace.budgetPhase.trimActions` is empty array (`[]`)
13. `trace.warnings` is empty array (`[]`)
14. No top-level `injectionGatePhase` key in trace

## Note on Conflict-Trace Design

This seed focuses on the accounting denominator. A future fixture in this group
should include an actual conflict (multiple selectors producing different decisions
for the same component) to verify that conflictResolutionTrace entries also count
toward the denominator. In that case:

  - conflictResolutionTrace.length would be ≥ 1
  - noConflictComponentIds.length would be smaller by the same amount
  - The sum must still equal candidateSetSize

## Non-MVP Boundaries

- No raw component content in trace
- No `injectionGatePhase` top-level key
- `selectorTrace[]` entries are TraceEntry-shaped (have `decisionId`, `module`, `failOpen`,
  `estimatedSavings`, `selector`; do not have `traceRefs` or `constraintsApplied`)
- No provider/model/cache/OpenClaw fields
