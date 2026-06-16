# Assertions: fixtures/06-hard-protection/safety-override-include/

## Purpose
Verify hard-protected components always resolve to `include` regardless of any selector omit preference.
Hard protection (riskLevel: critical + omissionPolicy: never + retainPolicy: safety_critical) must beat all omission paths.

## Zero-Tolerance Checks

1. `scaffold.system-rules` MUST appear in `selectedComponents[]` with `action: "include"` and `path: "safety_override"`.
2. `scaffold.system-rules` MUST NOT appear in `omittedComponents[]` or `deferredComponents[]`.
3. `selectorTrace` entry for `scaffold.system-rules` MUST have `action: "include"` and evidence atoms including `riskLevel=critical`, `omissionPolicy=never`, `retainPolicy=safety_critical`.
4. `conflictPhase.resolvedDecisions` entry for `scaffold.system-rules` MUST have `finalAction: "include"` and `finalPath: "safety_override"`.
5. `budgetOverflow` MUST be `false`.
6. `warnings` array MUST be empty (no injection or policy warnings in this run).
7. Accounting invariant: `noConflictComponentIds.length (2) + conflictResolutionTrace.length (0) == candidateSetSize (2)`.

## Invariant
Hard-protected components must NEVER be omitted. Safety/hard protection beats omission evidence at every step of the selector ladder.
