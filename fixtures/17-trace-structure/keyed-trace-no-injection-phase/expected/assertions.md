# Fixture: 17-trace-structure / keyed-trace-no-injection-phase

## Purpose

Verify that `trace.json` is a **keyed phase object** with **exactly the 8 MVP top-level phase keys**
and that `selectorPhase.selectorTrace[]` entries are **TraceEntry-shaped** (not SelectionDecision-shaped).

This is the zero-tolerance trace structure invariant: no `injectionGatePhase` key may exist at the
top level; `selectorTrace` must never be typed as or populated with `SelectionDecision` objects.

## Inputs

- `request-signals.json.injectionSuspect = false` — gate is inactive; no optional injection gate
  fields should appear in `selectorTrace` entries, keeping the TraceEntry shape minimal and clear.
- `active-ids.json.activeToolIds = ["tool.read-file"]` — gives the tool selector an active-match
  signal, producing a second distinct `selectorTrace` entry from a different module (`ToolSelector`).

## Key Assertions

### Top-level trace structure (8 keys exactly)
- ASSERT: `Object.keys(trace).sort()` equals exactly:
  `["budgetPhase", "conflictPhase", "planPhase", "registryPhase", "requestPhase", "run", "selectorPhase", "warnings"]`
- ASSERT: `trace` does NOT have a key `injectionGatePhase`
- ASSERT: `trace.warnings` is present and is an array (may be empty)

### selectorTrace[] — TraceEntry shape, NOT SelectionDecision shape
For each entry in `trace.selectorPhase.selectorTrace`:

**Required TraceEntry fields (must be present):**
- ASSERT: entry has `decisionId` (string, non-empty)
- ASSERT: entry has `module` (string, non-empty — e.g., `"ScaffoldSelector"`, `"ToolSelector"`)
- ASSERT: entry has `failOpen` (boolean)
- ASSERT: entry has `estimatedSavings` (object with `tokens` integer)
- ASSERT: entry has `selector` (string, must equal `"deterministic"` in MVP)
- ASSERT: entry has `componentId` (string)
- ASSERT: entry has `action` (string)
- ASSERT: entry has `reason` (string)
- ASSERT: entry has `evidence` (array)
- ASSERT: entry has `confidence` (string — one of `high`, `medium`, `low`)
- ASSERT: entry has `risk` (string — one of `critical`, `high`, `medium`, `low`)

**Forbidden SelectionDecision fields (must NOT be present):**
- ASSERT: entry does NOT have `traceRefs`
- ASSERT: entry does NOT have `constraintsApplied`

### No injection gate fields (injectionSuspect: false)
- ASSERT: no `selectorTrace` entry has `injectionSuspect` field (absent when false — not included)
- ASSERT: no `selectorTrace` entry has `injectionSuspectAction` field
- ASSERT: no `selectorTrace` entry has `actionChanged` field

### requestPhase — no policy fallback fields (no gate active)
- ASSERT: `trace.requestPhase` does NOT have `requestedInjectionSuspectAction`
- ASSERT: `trace.requestPhase` does NOT have `effectiveInjectionSuspectAction`
- ASSERT: `trace.requestPhase` does NOT have `policyFallbackReasons`
- ASSERT: `trace.requestPhase.injectionSuspectFlag == false`

### Accounting invariant
- ASSERT: `trace.conflictPhase.noConflictComponentIds.length` + `trace.conflictPhase.conflictResolutionTrace.length`
  == `trace.registryPhase.candidateSetSummary.candidateSetSize`
  (Expected: 2 + 0 == 2)

### selectorTrace non-empty
- ASSERT: `trace.selectorPhase.selectorTrace.length >= 1`
  (At minimum, the scaffold component must produce a trace entry)

### required sub-object fields
- ASSERT: `trace.registryPhase.candidateSetSummary` is present with `candidateSetPolicy`, `candidateSetSize`, `quarantinedExcluded`
- ASSERT: `trace.selectorPhase.selectorSummary` is present with all 10 required count fields + `narrative`
- ASSERT: `trace.budgetPhase.budgetOverflow` is present and is a boolean
- ASSERT: `trace.budgetPhase.trimActions` is present and is an array

### Schema conformance
- ASSERT: `trace.json` parses as valid JSON
- ASSERT: `trace.json` matches structural requirements of `schemas/outputs/trace.schema.json`
  (full AJV validation deferred to harness implementation — Pass 4.9D-3+)

## Known Limitations

- Expected file is a reference shape. Full AJV validation against `trace.schema.json` requires a
  harness runner (Pass 4.9D-3+) because the schema uses `$ref` to external schema files that
  need to be resolved.
- `resolvedAt` timestamps are placeholder ISO strings — harness must accept any valid ISO 8601 value.
- The `narrative` field is a placeholder — harness must assert it matches the deterministic template
  computed from count fields (docs/06 §3.6).
- `runId` is a placeholder string — harness must accept any non-empty string, not compare exact value.

## Canonical References

- `docs/04` §7.8 — `trace.json` is a keyed phase object with 8 required phase keys; no `injectionGatePhase`
- `docs/06` §3.2 — `selectorTrace` is array of `TraceEntry`, never array of `SelectionDecision`
- `docs/06` §17.6 — injection gate per-decision fields are optional on `TraceEntry` when `injectionSuspect: true` only
- `docs/12` §4.4 — `TraceEntry` vs `SelectionDecision` critical distinction
- `docs/12` §5.2 — no `injectionGatePhase` top-level key; 8 phase keys enumerated
- `schemas/outputs/trace.schema.json` — `additionalProperties: false`; 8 required keys; `selectorTrace` `$ref` to `trace-entry.schema.json`
- `schemas/internal/trace-entry.schema.json` — required fields: `decisionId`, `module`, `failOpen`, `estimatedSavings`, `selector`, etc.
