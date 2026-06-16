# assertions.md — fixtures/12-injection-gate/warn-and-continue-baseline

## Purpose

Verify `warn_and_continue` injection gate baseline behavior:
- `injectionSuspect: true` with effective `injectionSuspectAction: warn_and_continue`
- Ordinary low-risk Path B omit decision is preserved (not converted to fail_open)
- Exactly one global `injection_suspect_warn_and_continue` warning is emitted per run
- No `fail_open_all` conversion occurs
- No `family_confidence_fail_open_escalation` occurs (familyConfidence=0.85 >= failOpenThreshold=0.7)

## Design Note — Deferred Override Sub-Case

**WARN_AND_CONTINUE_OVERRIDE_DESIGN_DEFERRED**

docs/06 §17.3.1 specifies that under `warn_and_continue`, if a component is `type: policy`,
`riskLevel: critical/high`, `retainPolicy: safety_critical`, or `omissionPolicy: never`,
and the ladder produces an omit decision, the gate upgrades it to `include / fail_open`.

However: any component with those markers is also hard-protected at **ladder Step 3**
(docs/06 §8 Step 3 / docs/05 §3 protection rules). Hard protection fires *before* the
injection gate, so such a component would never arrive at the injection gate with an
`omit` decision in the first place. No schema-valid component can satisfy *both* the
hard-protection marker (which produces `action: include / path: safety_override` at
Step 3) and simultaneously be an omit candidate at the gate.

The `injection_suspect_policy_override` upgrade path is therefore only reachable for
components with *partial* protection indicators that satisfy the docs/06 §17.3.1 type/risk
criteria without also triggering ladder Step 3 hard protection. This design boundary
requires additional spec clarification before a fixture can safely represent it.

This fixture covers only the pure `warn_and_continue` baseline: ordinary low-risk optional
omit is preserved, and the one-per-run global warning fires correctly.

## Registry

- `scaffold.core-rules`: riskLevel=critical, omissionPolicy=never, retainPolicy=safety_critical → always include / safety_override (hard protection Step 3)
- `skill.optional-tip`: riskLevel=low, omissionPolicy=allow, retainPolicy=optional, defaultAction=omit → Path B omit; preserved under warn_and_continue

## Input signal

- `requestSignals.injectionSuspect: true`
- `requestSignals.familyConfidence: 0.85` (>= failOpenThreshold: 0.7 — escalation does NOT fire)
- `selectorPolicy.injectionSuspectAction: "warn_and_continue"`
- `selectorPolicy.failOpenThreshold: 0.7`

## Assertions

### Assertion 1 — Request phase: injectionSuspect flag is true

`trace.requestPhase.injectionSuspectFlag == true`

### Assertion 2 — Effective policy is warn_and_continue (no fallback, no escalation)

`trace.requestPhase.effectiveInjectionSuspectAction == "warn_and_continue"`
`trace.requestPhase.requestedInjectionSuspectAction == "warn_and_continue"`
`trace.requestPhase.policyFallbackReasons` is an empty array `[]`

No `family_confidence_fail_open_escalation` in any warnings array.
No `injection_suspect_fail_open_all` in any warnings array.

### Assertion 3 — Global injection warning: exactly one, correct code, in global warnings[]

`trace.warnings` contains exactly one entry with `code == "injection_suspect_warn_and_continue"`.

The global `injection_suspect_warn_and_continue` code must NOT appear more than once across
the entire trace (deduplication invariant — docs/06 §17.6 F-18).

The code must NOT appear in any per-decision `selectorTrace[*].warningsEmitted` array.
It must NOT appear in `selectorPhase.planningWarnings` in addition to `trace.warnings`
(or if it does appear in selectorPhase.planningWarnings, that is the canonical location
per docs/06 §17.6 and it must appear in `trace.warnings` as the top-level global summary).

### Assertion 4 — Scaffold: hard-protected, actionChanged: false

`selectorTrace[0].componentId == "scaffold.core-rules"`
`selectorTrace[0].action == "include"`
`selectorTrace[0].injectionSuspect == true`
`selectorTrace[0].injectionSuspectAction == "warn_and_continue"`
`selectorTrace[0].actionChanged == false`
`selectorTrace[0].evidence` contains `"injection_suspect_seen=true"`

### Assertion 5 — Optional skill: Path B omit preserved, injection_suspect_omit_allowed

`selectorTrace[1].componentId == "skill.optional-tip"`
`selectorTrace[1].action == "omit"`
`selectorTrace[1].injectionSuspect == true`
`selectorTrace[1].injectionSuspectAction == "warn_and_continue"`
`selectorTrace[1].actionChanged == false`
`selectorTrace[1].warningsEmitted` contains `"injection_suspect_omit_allowed"`
`selectorTrace[1].evidence` contains `"injection_suspect_seen=true"`

### Assertion 6 — warn_and_continue does NOT globally suppress all omissions

`trace.planPhase.omittedComponents` is non-empty (skill.optional-tip is omitted).
No `action: "include"` with `path: "fail_open"` for skill.optional-tip in any partition.

This distinguishes `warn_and_continue` from `fail_open_all`: ordinary low-risk Path B
omits are still permitted. This fixture is NOT fail_open_all behavior.

### Assertion 7 — Output partition arrays: correct placement

`trace.planPhase.selectedComponents` contains scaffold.core-rules with path: safety_override.
`trace.planPhase.omittedComponents` contains skill.optional-tip with path: default_action_omit.
`trace.planPhase.deferredComponents` is empty.

`prompt-plan.selectedComponents` matches trace.planPhase.selectedComponents.
`prompt-plan.omittedComponents` matches trace.planPhase.omittedComponents.
`prompt-plan.deferredComponents` is empty.

### Assertion 8 — Gap-check holds

`conflictPhase.noConflictComponentIds.length(2) + conflictPhase.conflictResolutionTrace.length(0) == registryPhase.candidateSetSummary.candidateSetSize(2)`

### Assertion 9 — Budget: no overflow, trimActions empty

`budgetPhase.trimActions == []`
`budgetPhase.budgetOverflow == false`
`budgetReport.budgetOverflow == false`
`budgetPhase.budgetOverflow == budgetReport.budgetOverflow`

### Assertion 10 — selectorSummary.narrative matches canonical §3.6 template

Expected narrative:
"2 components evaluated. 1 included, 1 omitted, 0 deferred (0 default, 0 runtime-unavailable), 0 fail-open. 0 conflict(s) identified."

### Assertion 11 — No reference_unknown in output partitions

No `action: "reference_unknown"` or `path: "reference_unknown"` appears in
selectedComponents, omittedComponents, or deferredComponents in either trace or prompt-plan.

### Assertion 12 — resolvedAt values are integers

Every `conflictPhase.resolvedDecisions[*].resolvedAt` is an integer (monotonic counter),
not an ISO timestamp string.
