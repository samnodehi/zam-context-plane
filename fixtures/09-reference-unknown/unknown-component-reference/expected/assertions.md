# Assertions: fixtures/09-reference-unknown/unknown-component-reference/

## Purpose
Verify that a component ID referenced in `userConstraints.alwaysInclude` that is absent from the
registry produces a true `reference_unknown` SelectionDecision — not an `active_id_unknown` warning.
This is the canonical input path for `reference_unknown` per `docs/06 §8 Step 2`.

## Fixture Convention
This fixture introduces the unknown reference via `user-constraints.json.alwaysInclude: ["skill.does-not-exist"]`.
`skill.does-not-exist` is intentionally absent from `component-registry.json`.

**This is distinct from `fixtures/04-active-ids/active-id-unknown-not-reference-unknown/`**, which uses
`activeSkillIds` to introduce an unknown ID. That fixture asserts `unknownReferences: 0` and emits only
`active_id_unknown` in `planningWarnings`. Unknown `activeSkillIds` entries do NOT produce `reference_unknown`
decisions — per `docs/06 §15 L1695`: "Unknown active IDs do not automatically produce `reference_unknown`
SelectionDecision records."

Per `user-constraints.schema.json`: "These are registry component ID strings; **unknown IDs produce
`reference_unknown` SelectionDecision records** (not `active_id_unknown` warnings)."

## Gap-Check Accounting Note
`conflictPhase.noConflictComponentIds.length (1) + conflictResolutionTrace.length (0) == candidateSetSize (1)`.
The `reference_unknown` resolved decision for `skill.does-not-exist` is OUTSIDE the gap-check denominator.
Per `docs/06 §11.3.2`: "`reference_unknown` records are tracked separately in `referencedUnknownComponents`
and are not subtracted from the candidate-set denominator — the candidate set is defined from validated
`componentsById`, which by construction contains no unknown-reference IDs."

The `reference_unknown` resolved decision appears in `conflictPhase.resolvedDecisions[]` with
`resolutionRule: "reference_unknown_pass_through"`, but it does NOT appear in `noConflictComponentIds[]`
and does NOT count toward the gap-check denominator.

## Zero-Tolerance Checks

1. `skill.does-not-exist` MUST NOT appear in `selectedComponents[]`, `omittedComponents[]`, or
   `deferredComponents[]` in either `prompt-plan.json` or `trace.json planPhase`.
2. No partition entry MUST have `action: "reference_unknown"` or `path: "reference_unknown"` —
   these values are excluded from all output partition arrays by schema.
3. `selectorSummary.unknownReferences` MUST equal `1`.
4. `selectorPhase.planningWarnings` MUST NOT contain `code: "active_id_unknown"` — this fixture
   uses `userConstraints.alwaysInclude`, not `activeSkillIds`, so no `active_id_unknown` is produced.
5. `selectorPhase.selectorTrace` MUST contain an entry for `skill.does-not-exist` with
   `action: "reference_unknown"`.
6. `conflictPhase.resolvedDecisions` MUST contain an entry for `skill.does-not-exist` with
   `finalAction: "reference_unknown"`, `finalPath: "reference_unknown"`, and
   `resolutionRule: "reference_unknown_pass_through"`.
7. `conflictPhase.resolvedDecisions[*].resolvedAt` MUST be an integer for all entries.
8. `prompt-plan.json.riskFlags` MUST contain a string identifying the unknown reference to
   `skill.does-not-exist`.
9. Gap-check invariant: `noConflictComponentIds.length (1) + conflictResolutionTrace.length (0) == candidateSetSize (1)`.
   The `reference_unknown` entry in `resolvedDecisions[]` is NOT counted in `noConflictComponentIds`.
10. `scaffold.system-rules` MUST appear in `selectedComponents[]` with `path: "safety_override"`.

## Canonical Distinction Summary

| Mechanism | Input vehicle | Warning code | unknownReferences | Fixture |
|---|---|---|---|---|
| `active_id_unknown` | `activeSkillIds` / `activeToolIds` / `activeMemoryIds` | `active_id_unknown` in `planningWarnings` | 0 | `04-active-ids/active-id-unknown-not-reference-unknown/` |
| `reference_unknown` | `userConstraints.alwaysInclude` (or explicit caller flag) | none (riskFlags only) | 1 | this fixture |
