# assertions.md — fixtures/10-runtime-unavailable/tool-defer-not-savings/

## Purpose

Verify that a confirmed-unavailable tool resolves to `defer / runtime_unavailable`,
appears only in `deferredComponents[]`, and is NOT counted as budget savings or a
trim action.

## Fixture Design

Registry: scaffold.system-rules (always included) + tool.write-file (confirmed unavailable).
- `runtime-capabilities.json.unavailableToolIds` = `["tool.write-file"]`
- `runtime-capabilities.json.capabilityInventoryComplete` = `true`
- Result: tool.write-file → `action: "defer"`, `path: "runtime_unavailable"`

## Key Assertions

### Partition Placement
1. `tool.write-file` appears in `prompt-plan.deferredComponents[]` with:
   - `action` == `"defer"`
   - `path` == `"runtime_unavailable"`
2. `tool.write-file` does NOT appear in `prompt-plan.selectedComponents[]`
3. `tool.write-file` does NOT appear in `prompt-plan.omittedComponents[]`

### Budget — No Savings Claimed
4. `trace.budgetPhase.trimActions` is empty (`[]`)
   — runtime_unavailable deferrals are NOT trim events; they must not appear here
5. `trace.budgetPhase.budgetReport.trimOrder` is empty (`[]`)
   — same rule: no trimOrder entry for runtime_unavailable tool
6. `trace.budgetPhase.budgetReport.budgetPlan.selectedTokensApprox` == 350
   — only scaffold.system-rules tokens counted; tool.write-file tokens excluded
7. `trace.budgetPhase.budgetOverflow` == false
8. `trace.budgetPhase.budgetReport.budgetOverflow` == false (must match above)

### Trace Entry
9. `trace.selectorPhase.selectorTrace[]` contains an entry for `tool.write-file` with:
   - `action` == `"defer"`
   - `estimatedSavings.tokens` == 0
     (no savings claimed — defer is not an omit)
10. `trace.selectorPhase.selectorSummary.runtimeUnavailableDefer` == 1
11. `trace.selectorPhase.selectorSummary.decidedDefer` == 1

### Conflict Phase
12. `tool.write-file` in `trace.conflictPhase.noConflictComponentIds`
    (single decision, no conflict)
13. `trace.conflictPhase.conflictResolutionTrace` is empty (`[]`)
14. Accounting: `noConflictComponentIds.length` (2) + `conflictResolutionTrace.length` (0)
    == `candidateSetSize` (2) ✓

### Path Filterability
15. Harness MUST filter by `path` (not `action` alone) to distinguish
    `runtime_unavailable` from `default_defer`. Both have `action: "defer"`,
    but only `runtime_unavailable` is confirmed-unavailable behavior.

## Non-MVP Boundaries

- No `estimatedSavings` claimed for deferred tools
- No provider/model/cache/OpenClaw fields
- No raw component content
- No `injectionGatePhase` top-level key
