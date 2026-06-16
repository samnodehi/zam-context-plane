# Fixture Assertions: 12-injection-gate / fail-open-all

## Purpose

Verify that `injectionSuspect: true` combined with `injectionSuspectAction: "fail_open_all"` globally
suppresses Path A and Path B omit outcomes and converts them to include/fail_open, with exactly one
global `injection_suspect_fail_open_all` warning emitted per run.

## Trigger

`request-signals.json` has `injectionSuspect: true` and `familyConfidence: 0.92` (above
`failOpenThreshold: 0.7` — no familyConfidence escalation fires).
`selector-policy.json` has `injectionSuspectAction: "fail_open_all"`.
`skill.optional-helper` has `defaultAction: omit` — it would normally resolve to
`action: omit`, `path: default_action_omit` (Path B). Under `fail_open_all`, this omit is
converted to `action: include`, `path: fail_open` by the injection gate.

## Key Assertions

### Injection Gate — Global Warning
- `warnings[]` MUST contain exactly one entry with `code: injection_suspect_fail_open_all`.
- `injection_suspect_fail_open_all` MUST appear exactly once per run — NOT once per component.
- No `injection_suspect_warn_and_continue` MUST appear (this is fail_open_all, not warn_and_continue).
- No `policy_value_not_implemented` MUST appear (fail_open_all is an active MVP value, not halt_planning).
- No `injection_action_unknown` MUST appear (fail_open_all is a recognized active MVP value).
- No `family_confidence_fail_open_escalation` MUST appear (familyConfidence 0.92 >= failOpenThreshold 0.7).

### Request Phase
- `requestPhase.injectionSuspectFlag` MUST be `true`.
- `requestPhase.effectiveInjectionSuspectAction` MUST be `"fail_open_all"`.
- `requestPhase.requestedInjectionSuspectAction` MUST be `"fail_open_all"` (no fallback occurred).

### Converted Omit Decision — skill.optional-helper
- `selectorPhase.selectorTrace[]` entry for `skill.optional-helper` MUST have:
  - `action: "include"` (converted from omit)
  - `failOpen: true`
  - `injectionSuspect: true`
  - `injectionSuspectAction: "fail_open_all"`
  - `actionChanged: true`
  - `originalCandidateAction: "omit"` (the pre-gate Path B omit)
  - `originalCandidatePath: "default_action_omit"` (the pre-gate Path B path)
- `skill.optional-helper` MUST appear in `planPhase.selectedComponents[]` with `path: "fail_open"`.
- `skill.optional-helper` MUST NOT appear in `planPhase.omittedComponents[]`.
- `skill.optional-helper` MUST NOT appear in `prompt-plan.omittedComponents[]`.

### Hard-Protected Component — scaffold.system-rules
- `scaffold.system-rules` MUST appear in `planPhase.selectedComponents[]` with `path: "safety_override"`.
- `scaffold.system-rules` selectorTrace entry MUST have `actionChanged: false`
  (hard protection was never an omit candidate; injection gate does not override hard protection).

### Gate-Conversion Context in Conflict Phase
- `conflictPhase.resolvedDecisions[]` entry for `skill.optional-helper` MUST have:
  - `hadGateConvertedDecisions: true`
  - `gateConvertedTraceRefs` containing `"tid-002"`
  - `preGateActions: ["omit"]`
  - `preGatePaths: ["default_action_omit"]`
- The gate-conversion context fields are informational — `selectorTrace` is the canonical source.

### Selector Summary
- `selectorSummary.failOpenInclude` MUST equal 1 (the converted omit).
- `selectorSummary.decidedOmit` MUST equal 0 (all omits converted to include by fail_open_all).
- `selectorSummary.decidedInclude` MUST equal 2 (both components resolved as include).

### omittedComponents Empty
- `planPhase.omittedComponents[]` MUST be empty (`[]`).
- `prompt-plan.omittedComponents[]` MUST be empty (`[]`).
- No component may appear in `omittedComponents[]` when `fail_open_all` is effective.

### Gap-Check
- `conflictPhase.noConflictComponentIds.length` (2)
  + `conflictPhase.conflictResolutionTrace.length` (0)
  == `registryPhase.candidateSetSummary.candidateSetSize` (2).

### Budget
- `budgetPhase.trimActions[]` MUST be `[]` (no trimming performed).
- `budgetPhase.budgetOverflow` MUST be `false`.

## What This Fixture Is NOT

- NOT `halt_planning`: that is a recognized-reserved future value that produces `policy_value_not_implemented`.
- NOT unknown policy fallback: `fail_open_all` is an active MVP value; no `injection_action_unknown`.
- NOT `warn_and_continue`: that only overrides safety/policy omit decisions, not all omit decisions.
- NOT familyConfidence escalation: that fires automatically when `familyConfidence < failOpenThreshold`;
  this fixture sets `familyConfidence: 0.92 >= failOpenThreshold: 0.7` to isolate the direct
  `fail_open_all` policy path.

## Canonical Sources

- docs/06 §17.3.2 (fail_open_all behavior)
- docs/06 §17.6 (injection gate trace fields in TraceEntry)
- docs/06 §11.6 (gate-conversion context in conflict phase)
- docs/12 §7.12 (injection gate fixture group)
- trace-entry.schema.json (injectionSuspect, actionChanged, originalCandidateAction, originalCandidatePath)
- resolved-selection-decision.schema.json (hadGateConvertedDecisions, gateConvertedTraceRefs, preGateActions, preGatePaths)
