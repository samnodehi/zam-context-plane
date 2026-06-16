# Assertions: fixtures/08-path-b-omission/default-action-omit/

## Purpose
Verify Path B omission fires when `defaultAction: omit` and no `requiredWhen` or `safeToOmitWhen`
matched the current `promptFamily`. Component is optional and not hard-protected.

## Zero-Tolerance Checks

1. `skill.context-summary` MUST appear in `omittedComponents[]` with `action: "omit"` and `path: "default_action_omit"`.
2. `skill.context-summary` MUST NOT appear in `selectedComponents[]` or `deferredComponents[]`.
3. `selectorTrace` entry for `skill.context-summary` MUST have `action: "omit"` and evidence including `defaultAction=omit` and `requiredWhen_no_match`.
4. `conflictPhase.resolvedDecisions` for `skill.context-summary` MUST have `finalAction: "omit"` and `finalPath: "default_action_omit"`.
5. `scaffold.system-rules` MUST appear in `selectedComponents[]` with `path: "safety_override"` — hard protection is unaffected by Path B decisions on other components.
6. `budgetOverflow` MUST be `false`.
7. `warnings` MUST be empty.
8. Accounting invariant: `noConflictComponentIds.length (2) + conflictResolutionTrace.length (0) == candidateSetSize (2)`.

## Invariant
Path B omit is default-action based — it fires when no tag rule matched and `defaultAction: omit`.
Path B must never override hard protection (riskLevel: critical, omissionPolicy: never, retainPolicy: safety_critical).
A component with any hard-protection attribute must not be omitted even if `defaultAction: omit` were set —
hard protection beats all omit paths at every step of the selector ladder.
