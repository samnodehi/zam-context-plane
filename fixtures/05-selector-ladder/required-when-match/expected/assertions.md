# Assertions — 05-selector-ladder/required-when-match

## Purpose

Verify that a component with a `requiredWhen` tag matching the current `promptFamily` is resolved to
`action: include` / `path: required_match` via ladder Step 5, without relying on user constraints,
safety overrides, or fail-open behavior.

---

## Assertion 1 — requiredWhen match produces include / required_match

`skill.coding-guide` has `requiredWhen: ["coding_build_debug"]`.
The request signal `promptFamily: "coding_build_debug"` exactly matches that tag.
The selector must produce `action: include`, `path: required_match`, `confidence: high`.

The selectorTrace entry for `skill.coding-guide` (decisionId `tid-rwm-002`) must include:
- `action: "include"`
- `confidence: "high"`
- `failOpen: false`
- `selector: "deterministic"`
- evidence includes `"requiredWhen=coding_build_debug"` and `"promptFamily=coding_build_debug"`

The resolvedDecision for `skill.coding-guide` must have:
- `finalAction: "include"`
- `finalPath: "required_match"`
- `resolutionRule: "no_conflict"`
- `resolvedAt` is an integer (monotonic counter, not an ISO timestamp string)

`skill.coding-guide` must appear in:
- `trace.planPhase.selectedComponents[]` with `action: "include"` and `path: "required_match"`
- `prompt-plan.json` `selectedComponents[]` with `action: "include"` and `path: "required_match"`

`skill.coding-guide` must NOT appear in `omittedComponents` or `deferredComponents`.

---

## Assertion 2 — required_match is distinct from safety_override and user_constraint_include

`userConstraints.alwaysInclude` is empty — the include decision for `skill.coding-guide` is NOT
driven by a user constraint. The `resolutionRule` is `"no_conflict"`, not `"user_constraint_include"`.

No hard-protection rule applies to `skill.coding-guide` (`retainPolicy: "optional"`,
`omissionPolicy: "allow"`, `riskLevel: "low"`). Therefore `path: "safety_override"` must NOT appear
for this component.

The ladder Step 5 (`requiredWhen` match) is the sole driver.

---

## Assertion 3 — No conflictResolutionTrace entry for a no-conflict required include

Both components receive a single unambiguous decision from one selector each.
Neither has multiple selector decisions; neither carries `path: conflict_include`.

Therefore:
- `conflictPhase.conflictResolutionTrace` must be an empty array `[]`.
- Both component IDs must appear in `conflictPhase.noConflictComponentIds[]`.
- `conflictPhase.noConflictComponentIds` must contain exactly `["scaffold.system-rules", "skill.coding-guide"]`.

---

## Assertion 4 — Gap-check uses candidateSetSize denominator

`registryPhase.candidateSetSummary.candidateSetSize` = 2.
`conflictPhase.noConflictComponentIds.length` = 2.
`conflictPhase.conflictResolutionTrace.length` = 0.

Gap-check invariant: `noConflictComponentIds.length + conflictResolutionTrace.length == candidateSetSize`
=> 2 + 0 = 2 ✓

---

## Assertion 5 — Scaffold component uses default_include, not required_match

`scaffold.system-rules` has `requiredWhen: []` — no requiredWhen tag matches.
It is included via ladder Step 9 (`defaultAction: include`).
Its `path` must be `"default_include"`, not `"required_match"` or `"safety_override"`.

---

## Assertion 6 — Budget invariants

`budgetPhase.trimActions` must be present and must be an array (empty `[]` in this case).
`budgetPhase.budgetOverflow` must be present and boolean (`false`).
`budgetPhase.budgetOverflow` must equal `budgetPhase.budgetReport.budgetOverflow` (`false`).
`budgetPhase.budgetReport.budgetPlan.projectedOverflow` must be 0.

---

## Assertion 7 — component-registry.json uses id field

The component-registry.json input uses `"id"` as the component identifier field, not `"componentId"`.
This matches the accepted schema (`component-registry.schema.json`) which requires `"id"`.
