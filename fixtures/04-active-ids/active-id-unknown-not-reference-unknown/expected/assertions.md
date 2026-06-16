# assertions.md — fixtures/04-active-ids/active-id-unknown-not-reference-unknown/

## Purpose

Verify that unknown active IDs emit `active_id_unknown` planning warnings and do NOT
produce `reference_unknown` SelectionDecision records or appear in any output partition
array.

## Critical Distinction

**`active_id_unknown`**: Warning class for IDs in `activeSkillIds` / `activeToolIds` /
`activeMemoryIds` that are not found in `componentsById`. These are caller-supplied
signals about what is currently active in the context — the caller may reference IDs
that are not in this registry (e.g., future components, typos, cross-registry refs).
The planner emits a per-ID warning and treats the signal as absent. Planning continues.

**`reference_unknown`**: Decision class for component references (e.g., `alwaysInclude`,
`neverInclude`, or explicit component ID references) that do not match any registry ID.
This produces a `SelectionDecision` with `action: "reference_unknown"` and `path:
"reference_unknown"`. The component appears in the selectorTrace but NOT in any output
partition array.

These two classes must never be confused. An unknown active ID is NOT a component
reference — it is only a missing signal, not a missing component.

## Fixture Design

Registry: scaffold.system-rules + skill.general-assistant (2 registered components).
Active IDs: `["skill.general-assistant", "skill.does-not-exist-in-registry"]`
- `skill.general-assistant` → found in registry → normal processing
- `skill.does-not-exist-in-registry` → NOT in registry → `active_id_unknown` warning

## Key Assertions

### Warning Presence (active_id_unknown)
1. `trace.selectorPhase.planningWarnings[]` contains a warning with:
   - `code` == `"active_id_unknown"`
   - `message` references `"skill.does-not-exist-in-registry"`
2. `prompt-plan.planningWarnings[]` contains the same warning

### No reference_unknown Decision
3. `trace.selectorPhase.selectorTrace[]` has NO entry with `componentId` ==
   `"skill.does-not-exist-in-registry"` — unknown active IDs are not evaluated
   by the selector at all
4. `trace.conflictPhase.resolvedDecisions[]` has NO entry for
   `"skill.does-not-exist-in-registry"`
5. `prompt-plan.selectedComponents[]` does NOT contain `"skill.does-not-exist-in-registry"`
6. `prompt-plan.omittedComponents[]` does NOT contain `"skill.does-not-exist-in-registry"`
7. `prompt-plan.deferredComponents[]` does NOT contain `"skill.does-not-exist-in-registry"`

### No reference_unknown Action/Path
8. No entry in any selector, conflict, or partition output has:
   - `action` == `"reference_unknown"` for `"skill.does-not-exist-in-registry"`
   - `path` == `"reference_unknown"` for `"skill.does-not-exist-in-registry"`

### Selector Summary
9. `trace.selectorPhase.selectorSummary.totalEvaluated` == 2
   (only the 2 registry-resident components are evaluated)
10. `trace.selectorPhase.selectorSummary.unknownReferences` == 0
    (active_id_unknown does not increment unknownReferences)

### Accounting Invariant
11. `candidateSetSize` (2) == `noConflictComponentIds.length` (2) + `conflictResolutionTrace.length` (0) ✓
12. The accounting denominator is based on registered candidates, not active ID list entries

### No Global Warning
13. `trace.warnings[]` is empty — `active_id_unknown` is a selector-phase planning
    warning, NOT a global run-level warning

## Non-MVP Boundaries

- No raw component content
- No `injectionGatePhase` top-level key
- No provider/model/cache/OpenClaw fields
- Unknown active ID is silently treated as absent signal after warning; planning continues
