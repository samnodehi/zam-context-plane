# assertions.md — fixtures/11-capability-inventory-incomplete/fail-open-tools/

## Purpose

Verify that `capabilityInventoryComplete: false` triggers fail-open behavior for tool
components. Tools whose availability is unknown (not in either list, inventory incomplete)
must be INCLUDED via the `fail_open` path, NOT silently omitted or deferred.

## Fixture Design

Registry: scaffold.system-rules (always included) + tool.read-file + tool.run-shell.
- `runtime-capabilities.json.availableToolIds` = `[]`
- `runtime-capabilities.json.unavailableToolIds` = `[]`
- `runtime-capabilities.json.capabilityInventoryComplete` = `false`

With `capabilityInventoryComplete: false`, any tool absent from both lists has
UNKNOWN availability (not confirmed-unavailable). The tool selector must fail open
and include the tool. This is the opposite of `runtime_unavailable` defer, which
requires `capabilityInventoryComplete: true` to be meaningful.

## Key Assertions

### Tool Inclusion via fail_open
1. `tool.read-file` appears in `prompt-plan.selectedComponents[]` with:
   - `action` == `"include"`
   - `path` == `"fail_open"`
2. `tool.run-shell` appears in `prompt-plan.selectedComponents[]` with:
   - `action` == `"include"`
   - `path` == `"fail_open"`
3. Neither tool appears in `prompt-plan.omittedComponents[]`
4. Neither tool appears in `prompt-plan.deferredComponents[]`

### Warning Presence
5. `runtime_capabilities_missing` warning is present in:
   - `trace.selectorPhase.planningWarnings[]` (code == `"runtime_capabilities_missing"`)
   - `trace.warnings[]` (global) (code == `"runtime_capabilities_missing"`)
   - `prompt-plan.planningWarnings[]` (code == `"runtime_capabilities_missing"`)

### Fail-Open Reasons
6. `prompt-plan.failOpenReasons` is non-empty
7. Each fail-open reason references `capabilityInventoryComplete=false`

### Selector Summary
8. `trace.selectorPhase.selectorSummary.failOpenInclude` == 2
9. `trace.selectorPhase.selectorSummary.runtimeUnavailableDefer` == 0

### Distinction from runtime_unavailable
10. Neither tool has `path: "runtime_unavailable"` — that path is reserved for
    CONFIRMED unavailable tools (requires `capabilityInventoryComplete: true`)
11. No tool appears in `deferredComponents[]` — unknown availability does not defer

### Budget
12. `trace.budgetPhase.budgetReport.budgetPlan.selectedTokensApprox` == 540
    (scaffold 350 + read-file 100 + run-shell 90 = 540)
    — fail-open included tools count toward budget; they are not deferred
13. `trace.budgetPhase.trimActions` == `[]`
14. `trace.budgetPhase.budgetOverflow` == false

### Accounting Invariant
15. `candidateSetSize` (3) == `noConflictComponentIds.length` (3) + `conflictResolutionTrace.length` (0) ✓

## Non-MVP Boundaries

- No raw component content
- No `injectionGatePhase` top-level key
- No `runtime_unavailable` defer when inventory is incomplete
- No provider/model/cache/OpenClaw fields
