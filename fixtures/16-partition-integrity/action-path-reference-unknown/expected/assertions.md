# Fixture: 16-partition-integrity / action-path-reference-unknown

## Purpose

Verify that the three output partition arrays enforce **action/path compatibility** and that
`reference_unknown` never appears in any partition array:

1. `selectedComponents[]` entries must have `action: "include"` and a path from the include-compatible set only.
2. `omittedComponents[]` entries must have `action: "omit"` and a path from the omit-compatible set only.
3. `deferredComponents[]` entries must have `action: "defer"` and a path from the defer-compatible set only.
4. `reference_unknown` must NOT appear as a `path` in any partition array entry.
5. Unknown active IDs produce `active_id_unknown` planning warnings — NOT `reference_unknown` decisions.
6. Runtime-unavailable tools appear in `deferredComponents` with `path: runtime_unavailable` — NOT in `omittedComponents`.

## Inputs

- Registry: 3 components — scaffold (include), heartbeat skill (omit), unavailable tool (defer).
- `request-signals.json.promptFamily = "general_default"` — triggers `safeToOmitWhen` match on the skill.
- `runtime-capabilities.json.unavailableToolIds = ["tool.unavailable-tool"]` with `capabilityInventoryComplete: true` — drives `runtime_unavailable` defer.
- `active-ids.json.activeSkillIds = ["skill.does-not-exist-in-registry"]` — unknown ID, triggers `active_id_unknown` warning (not `reference_unknown` decision).

## Path Compatibility Reference

| Partition array | Required `action` | Valid `path` values |
|---|---|---|
| `selectedComponents` | `include` | `required_match`, `default_include`, `fail_open`, `conflict_include`, `safety_override`, `not_evaluated`, `quarantine_boundary_violation` |
| `omittedComponents` | `omit` | `safe_to_omit_match`, `default_action_omit` |
| `deferredComponents` | `defer` | `default_defer`, `runtime_unavailable` |

`reference_unknown` is **excluded from all partition arrays**. It is traceable only through selector decisions and trace mechanisms.

## Key Assertions

### selectedComponents partition correctness
- ASSERT: every entry in `prompt-plan.selectedComponents` has `action == "include"`
- ASSERT: every entry in `prompt-plan.selectedComponents` has `path` in:
  `["required_match", "default_include", "fail_open", "conflict_include", "safety_override", "not_evaluated", "quarantine_boundary_violation"]`
- ASSERT: `prompt-plan.selectedComponents` contains `scaffold.system-rules` with `path == "required_match"`

### omittedComponents partition correctness
- ASSERT: every entry in `prompt-plan.omittedComponents` has `action == "omit"`
- ASSERT: every entry in `prompt-plan.omittedComponents` has `path` in `["safe_to_omit_match", "default_action_omit"]`
- ASSERT: `prompt-plan.omittedComponents` contains `skill.heartbeat-proactive` with `path == "safe_to_omit_match"`
- ASSERT: `skill.heartbeat-proactive` is NOT in `prompt-plan.selectedComponents` or `prompt-plan.deferredComponents`

### deferredComponents partition correctness
- ASSERT: every entry in `prompt-plan.deferredComponents` has `action == "defer"`
- ASSERT: every entry in `prompt-plan.deferredComponents` has `path` in `["default_defer", "runtime_unavailable"]`
- ASSERT: `prompt-plan.deferredComponents` contains `tool.unavailable-tool` with `path == "runtime_unavailable"`
- ASSERT: `tool.unavailable-tool` is NOT in `prompt-plan.selectedComponents` or `prompt-plan.omittedComponents`
- ASSERT: `prompt-plan.deferredComponents` — harnesses MUST filter by `path` to distinguish `runtime_unavailable` from `default_defer`; filtering by `action: "defer"` alone is insufficient

### reference_unknown excluded from all partition arrays
- ASSERT: no entry in `prompt-plan.selectedComponents` has `path == "reference_unknown"` or `action == "reference_unknown"`
- ASSERT: no entry in `prompt-plan.omittedComponents` has `path == "reference_unknown"` or `action == "reference_unknown"`
- ASSERT: no entry in `prompt-plan.deferredComponents` has `path == "reference_unknown"` or `action == "reference_unknown"`
- (Same three assertions for `trace.planPhase.selectedComponents/omittedComponents/deferredComponents`)

### active_id_unknown vs reference_unknown distinction
- ASSERT: `prompt-plan.planningWarnings` (or `trace.selectorPhase.planningWarnings`) contains an entry with `code == "active_id_unknown"`
- ASSERT: `prompt-plan.planningWarnings` does NOT contain an entry with `code == "reference_unknown"` (that is an action value, not a warning code)
- ASSERT: `trace.selectorPhase.selectorSummary.unknownReferences == 0` (no reference_unknown selector decisions in this fixture — unknown ID was in active-ids, not referenced by a selector)

### runtime_unavailable is NOT budget savings
- ASSERT: `trace.budgetPhase.trimActions` does NOT contain `tool.unavailable-tool`
  (runtime_unavailable defer is not a trim action — no token savings claimed)
- ASSERT: `trace.budgetPhase.budgetReport.budgetPlan.selectedTokensApprox` does NOT include tokens from `tool.unavailable-tool`
  (deferred components do not contribute to selected token total)

### Schema conformance
- ASSERT: `prompt-plan.json` parses as valid JSON
- ASSERT: `prompt-plan.json` matches structural requirements of `schemas/outputs/prompt-plan.schema.json`
  (allOf action.const + path.enum enforced per partition; full AJV validation deferred to harness)

### Accounting invariant
- ASSERT: `trace.conflictPhase.noConflictComponentIds.length` + `trace.conflictPhase.conflictResolutionTrace.length`
  == `trace.registryPhase.candidateSetSummary.candidateSetSize`
  (Expected: 3 + 0 == 3)

### Exhaustive partition coverage
- ASSERT: every ID in `registryPhase.candidateSetSummary` (size 3) appears in exactly one of:
  `selectedComponents`, `omittedComponents`, `deferredComponents`
  (scaffold → selected, heartbeat → omitted, unavailable-tool → deferred)

## Known Limitations

- Expected files are reference-only. Full AJV validation against output schemas requires a harness
  runner (Pass 4.9D-3+) because schemas use `$ref` to external schema files.
- `resolvedAt` timestamps are placeholder ISO strings.
- The `narrative` field is a placeholder — harness must compute and compare from count fields.

## Canonical References

- `docs/06` §4 — action/path compatibility table (12 path values, 4 action values)
- `docs/06` §3.1 — `active_id_unknown` vs `reference_unknown` distinction (separate warning classes)
- `docs/06` §14.3 — `runtime_unavailable` defer must not claim token savings
- `docs/12` §5.1 — three mutually exclusive exhaustive partition arrays; `path` required on all entries
- `docs/12` §6.1 — `reference_unknown` excluded from partition arrays (traceable through decisions only)
- `docs/12` §9 — Non-MVP Exclusion Register: `action: unavailable` excluded; MVP uses `defer + path: runtime_unavailable`
- `schemas/outputs/prompt-plan.schema.json` — `allOf` with `action.const` and `path.enum` per partition (Pass 4.9C-4C.2)
