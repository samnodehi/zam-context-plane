# Fixture Assertions: 05-selector-policy / deterministic-only-false-defaulted

## Purpose

Verify that a present `selector-policy.json` with `deterministicOnly: false` is normalized to
deterministic-only MVP behavior and causes a `selector_policy_defaulted` warning. This is a
present-file normalization/defaulting case — it does NOT test missing optional input file behavior.

## Trigger

`selector-policy.json` is present and schema-valid. It contains `deterministicOnly: false`.
Model-assisted selectors are not implemented in MVP. The orchestrator detects the non-MVP value,
normalizes effective `deterministicOnly` to `true`, and emits `selector_policy_defaulted`.
The planning run completes normally with deterministic-only behavior applied.

## Key Assertions

### Warning Emission
- `selectorPhase.planningWarnings[]` MUST contain exactly one entry with `code: selector_policy_defaulted`.
- `warnings[]` (global) MUST also contain the `selector_policy_defaulted` warning
  (cross-phase propagation of policy defaulting warning to global scope).
- No injection warnings MUST be present (`injectionSuspect: false` in inputs).

### Plan Output
- Both components MUST appear in `selectedComponents[]` (plan is unaffected by the defaulting).
- `omittedComponents[]` MUST be empty.
- `deferredComponents[]` MUST be empty.
- `deterministicOnly: false` MUST NOT change which components appear in the plan — only
  `selector_policy_defaulted` is emitted; plan membership is unchanged.

### Registry Phase
- `registryPhase.quarantinedCount` MUST equal 0 (no quarantine; all components are well-formed).
- `registryPhase.fatalErrors[]` MUST be empty.
- `registryPhase.candidateSetSummary.candidateSetSize` MUST equal 2.

### Selector Phase
- `selectorPhase.selectorSummary.totalEvaluated` MUST equal 2.
- `selectorPhase.selectorSummary.decidedInclude` MUST equal 2.
- `selectorPhase.selectorSummary.failOpenInclude` MUST equal 0.
- Selector trace entries MUST use `selector: deterministic` (effective normalization applied).
- No model-assisted selector fields, no `rawAnalyzerOutput`, no model-generated trace content.

### Gap-Check
- `conflictPhase.noConflictComponentIds.length` (2)
  + `conflictPhase.conflictResolutionTrace.length` (0)
  == `registryPhase.candidateSetSummary.candidateSetSize` (2).

## What This Fixture Does NOT Cover

- Missing `selector-policy.json` file behavior (Class B absent-file defaulting).
  That case requires the orchestrator to handle an absent file path — it is a different
  code path and requires a fixture contract extension to represent 7 instead of 8 inputs.
  This fixture tests only the present-file normalization path.
- `failOpenThreshold` value edge cases.
- Unknown `injectionSuspectAction` value (see fixtures/12-injection-gate/ group).
- `halt_planning` reserved value recognition (see fixtures/12-injection-gate/ group).

## Canonical Sources

- docs/06 §2.9 (selector policy defaulting for deterministicOnly: false)
- docs/12 §3.7 (Class B input, selector policy)
- selector-policy.schema.json (deterministicOnly is boolean; no enum restriction)
- planning-warning.schema.json (`selector_policy_defaulted` is a known advisory code)
