# assertions.md — fixtures/12-injection-gate/family-confidence-escalation

## Purpose

Verify `familyConfidence` escalation rule (docs/06 §17.3.4):
- `injectionSuspect: true` + `familyConfidence (0.4) < failOpenThreshold (0.7)` escalates
  effective policy from requested `warn_and_continue` to `fail_open_all`
- `family_confidence_fail_open_escalation` warning emitted exactly once
- `injection_suspect_fail_open_all` warning emitted exactly once (after escalation warning)
- Path B omit candidate converted to `include / fail_open`
- `policyFallbackReasons` records escalation chain

## Registry

- `scaffold.base-rules`: riskLevel=critical, omissionPolicy=never, retainPolicy=safety_critical → always include / safety_override (hard protection Step 3; unaffected by gate)
- `skill.context-helper`: riskLevel=low, omissionPolicy=allow, retainPolicy=optional, defaultAction=omit → Path B omit candidate; converted to include/fail_open by escalated fail_open_all

## Input signal

- `requestSignals.injectionSuspect: true`
- `requestSignals.familyConfidence: 0.4` (< failOpenThreshold: 0.7 — escalation fires)
- `selectorPolicy.injectionSuspectAction: "warn_and_continue"` (requested; escalated to fail_open_all)
- `selectorPolicy.failOpenThreshold: 0.7`

## Assertions

### Assertion 1 — Request phase: injectionSuspect flag is true

`trace.requestPhase.injectionSuspectFlag == true`

### Assertion 2 — Requested policy is warn_and_continue; effective policy is fail_open_all

`trace.requestPhase.requestedInjectionSuspectAction == "warn_and_continue"`
`trace.requestPhase.effectiveInjectionSuspectAction == "fail_open_all"`

This distinguishes escalation from a directly-configured `fail_open_all`. The escalation
occurred because `familyConfidence (0.4) < failOpenThreshold (0.7)` — not because the
operator requested `fail_open_all`. This is NOT an unknown-policy fallback and NOT
`halt_planning` behavior.

### Assertion 3 — policyFallbackReasons records escalation

`trace.requestPhase.policyFallbackReasons` is an array containing `"family_confidence_fail_open_escalation"`.

It does NOT contain `"policy_value_not_implemented"` (that would indicate `halt_planning` fallback).
It does NOT contain `"injection_action_unknown"` (that would indicate unknown/typo policy).

### Assertion 4 — Global warnings: family_confidence_fail_open_escalation appears exactly once

`trace.warnings` contains exactly one entry with `code == "family_confidence_fail_open_escalation"`.

This code must NOT appear more than once across the entire trace (deduplication — docs/06 §17.7).

### Assertion 5 — Global warnings: injection_suspect_fail_open_all appears exactly once

`trace.warnings` contains exactly one entry with `code == "injection_suspect_fail_open_all"`.

This code must NOT appear in any per-decision `selectorTrace[*].warningsEmitted` array
(it is a global orchestrator-level code only — docs/06 §17.6).

### Assertion 6 — Warning order: family_confidence_fail_open_escalation precedes injection_suspect_fail_open_all

Per docs/06 §17.6 global warning emission table, when `warn_and_continue + familyConfidence escalation`
occurs, the warning order is:
1. `family_confidence_fail_open_escalation`
2. `injection_suspect_fail_open_all`

`trace.warnings[0].code == "family_confidence_fail_open_escalation"`
`trace.warnings[1].code == "injection_suspect_fail_open_all"`

### Assertion 7 — No injection_suspect_warn_and_continue in any warning

`trace.warnings` must NOT contain `"injection_suspect_warn_and_continue"` (the escalation
produced fail_open_all, not warn_and_continue).

No `injection_suspect_warn_and_continue` in `selectorPhase.planningWarnings`.

### Assertion 8 — Scaffold: hard-protected, actionChanged: false, effective policy injected into evidence

`selectorTrace[0].componentId == "scaffold.base-rules"`
`selectorTrace[0].action == "include"`
`selectorTrace[0].injectionSuspect == true`
`selectorTrace[0].injectionSuspectAction == "fail_open_all"` (effective policy — not the requested value)
`selectorTrace[0].actionChanged == false`
`selectorTrace[0].evidence` contains `"injection_suspect_seen=true"`

### Assertion 9 — Optional skill: converted from Path B omit to include/fail_open

`selectorTrace[1].componentId == "skill.context-helper"`
`selectorTrace[1].action == "include"`
`selectorTrace[1].injectionSuspect == true`
`selectorTrace[1].injectionSuspectAction == "fail_open_all"` (effective escalated policy)
`selectorTrace[1].actionChanged == true`
`selectorTrace[1].originalCandidateAction == "omit"`
`selectorTrace[1].originalCandidatePath == "default_action_omit"`
`selectorTrace[1].failOpen == true`
`selectorTrace[1].evidence` contains `"injection_suspect_seen=true"`

### Assertion 10 — No ordinary omit remains in output partitions

`trace.planPhase.omittedComponents` is empty.
`prompt-plan.omittedComponents` is empty.

Any component that was a Path A or Path B omit candidate must have been converted to
include/fail_open under the escalated fail_open_all policy.

### Assertion 11 — Conflict Resolver records gate-converted decision context

The resolved decision for `skill.context-helper` has:
`hadGateConvertedDecisions == true`
`gateConvertedTraceRefs` contains `"tid-002"`
`preGateActions` contains `"omit"`
`preGatePaths` contains `"default_action_omit"`
`finalAction == "include"`
`finalPath == "fail_open"`

### Assertion 12 — Output partition arrays: correct placement

`trace.planPhase.selectedComponents` contains both scaffold.base-rules (path: safety_override)
and skill.context-helper (path: fail_open).
`trace.planPhase.omittedComponents` is empty.
`trace.planPhase.deferredComponents` is empty.

`prompt-plan.selectedComponents` matches trace.planPhase.selectedComponents.

### Assertion 13 — failOpenReasons records the converted component

`trace.planPhase.failOpenReasons` is non-empty and references `skill.context-helper` with
mention of the familyConfidence escalation as the cause.

### Assertion 14 — Gap-check holds

`conflictPhase.noConflictComponentIds.length(2) + conflictPhase.conflictResolutionTrace.length(0) == registryPhase.candidateSetSummary.candidateSetSize(2)`

### Assertion 15 — Budget: no overflow, trimActions empty

`budgetPhase.trimActions == []`
`budgetPhase.budgetOverflow == false`
`budgetReport.budgetOverflow == false`
`budgetPhase.budgetOverflow == budgetReport.budgetOverflow`

### Assertion 16 — selectorSummary.narrative matches canonical §3.6 template

Expected narrative:
"2 components evaluated. 2 included, 0 omitted, 0 deferred (0 default, 0 runtime-unavailable), 1 fail-open. 0 conflict(s) identified."

### Assertion 17 — No reference_unknown in output partitions

No `action: "reference_unknown"` or `path: "reference_unknown"` appears in
selectedComponents, omittedComponents, or deferredComponents in either trace or prompt-plan.

### Assertion 18 — resolvedAt values are integers

Every `conflictPhase.resolvedDecisions[*].resolvedAt` is an integer (monotonic counter),
not an ISO timestamp string.

### Assertion 19 — Per-decision injectionSuspectAction always reflects effective policy

For every selectorTrace entry:
`selectorTrace[*].injectionSuspectAction == "fail_open_all"` (the effective escalated policy,
not the requested `warn_and_continue`). Per docs/06 §17.6 invariant: "The per-decision
injectionSuspectAction field always reflects the final effective policy."
