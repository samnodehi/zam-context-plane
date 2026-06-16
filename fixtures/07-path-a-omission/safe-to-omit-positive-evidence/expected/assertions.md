# Assertions: fixtures/07-path-a-omission/safe-to-omit-positive-evidence/

## Purpose
Verify Path A omission fires correctly when `safeToOmitWhen` matches the current `promptFamily`,
positive evidence is present in `evidence[]`, and `omissionPolicy: allow`.

## Zero-Tolerance Checks

1. `skill.heartbeat-proactive` MUST appear in `omittedComponents[]` with `action: "omit"` and `path: "safe_to_omit_match"`.
2. `skill.heartbeat-proactive` MUST NOT appear in `selectedComponents[]` or `deferredComponents[]`.
3. `selectorTrace` entry for `skill.heartbeat-proactive` MUST have `action: "omit"` and `evidence[]` NON-EMPTY, including `safeToOmitWhen=general_default`.
4. `evidence[]` for the omit decision MUST NOT be empty — omit with empty evidence is a planning error (harness failure).
5. `conflictPhase.resolvedDecisions` for `skill.heartbeat-proactive` MUST have `finalAction: "omit"` and `finalPath: "safe_to_omit_match"`.
6. `scaffold.system-rules` MUST appear in `selectedComponents[]` with `path: "safety_override"` — hard protection is never bypassed by Path A decisions on other components.
7. `budgetOverflow` MUST be `false`.
8. `warnings` array MUST be empty.
9. Accounting invariant: `noConflictComponentIds.length (2) + conflictResolutionTrace.length (0) == candidateSetSize (2)`.

## Invariant
Path A omit requires positive evidence (`evidence[]` non-empty). A `path: safe_to_omit_match` omit decision
with an empty `evidence[]` array is a harness failure. `evidenceRequired: null` means the `safeToOmitWhen`
match alone is sufficient — but that match itself is the evidence atom that must appear in `evidence[]`.
