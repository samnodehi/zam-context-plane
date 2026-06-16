# Assertions — 18-summary-narrative/deterministic-narrative-template

## Purpose

Verify that `selectorPhase.selectorSummary.narrative` is deterministic, derived only from count
fields, matches the exact canonical template defined in `docs/06_SELECTOR_ORCHESTRATION_SPEC.md §3.6`,
and contains no model-generated prose, no raw component content, and no raw user request text.

---

## Assertion 1 — selectorSummary.narrative is deterministic

The `narrative` field in `trace.selectorPhase.selectorSummary` must match the exact canonical
template from `docs/06 §3.6 (F-27 resolved, Pass 4.5B)`:

  `"{totalEvaluated} components evaluated. {decidedInclude} included, {decidedOmit} omitted,`
  `{decidedDefer} deferred ({defaultDefer} default, {runtimeUnavailableDefer} runtime-unavailable),`
  `{failOpenInclude} fail-open. {conflictsIdentified} conflict(s) identified."`

For this fixture (totalEvaluated=3, decidedInclude=2, decidedOmit=1, decidedDefer=0,
defaultDefer=0, runtimeUnavailableDefer=0, failOpenInclude=0, conflictsIdentified=0), the
exact expected narrative string is:

  `"3 components evaluated. 2 included, 1 omitted, 0 deferred (0 default, 0 runtime-unavailable), 0 fail-open. 0 conflict(s) identified."`

The harness must assert the narrative string is exactly this value. Any deviation is a harness
failure. Narrative source: docs/06 §3.6, which defines a fixed deterministic template — no model
generation is permitted.

---

## Assertion 2 — Narrative is derived from count fields only

Each placeholder in the template corresponds to an integer field in `selectorSummary`:
- `{totalEvaluated}` → `selectorSummary.totalEvaluated` (3)
- `{decidedInclude}` → `selectorSummary.decidedInclude` (2)
- `{decidedOmit}` → `selectorSummary.decidedOmit` (1)
- `{decidedDefer}` → `selectorSummary.decidedDefer` (0)
- `{defaultDefer}` → `selectorSummary.defaultDefer` (0)
- `{runtimeUnavailableDefer}` → `selectorSummary.runtimeUnavailableDefer` (0)
- `{failOpenInclude}` → `selectorSummary.failOpenInclude` (0)
- `{conflictsIdentified}` → `selectorSummary.conflictsIdentified` (0)

The harness must verify that substituting these count values into the template produces the
exact narrative string found in the fixture. No additional or reduced fields are permitted.

---

## Assertion 3 — No raw component content or raw user request text

The `narrative` string must not contain any component content, component title text beyond
count numbers, or text derived from the user request. It is a statistical summary only.

The harness may verify the narrative matches the regex pattern:
`^\d+ components evaluated\. \d+ included, \d+ omitted, \d+ deferred \(\d+ default, \d+ runtime-unavailable\), \d+ fail-open\. \d+ conflict\(s\) identified\.$`

---

## Assertion 4 — No model-generated summary prose

The `narrative` field must not contain any prose that cannot be explained by template substitution
of the integer count fields. Phrases like "excellent results", "potential risk", or "budget pressure
observed" are forbidden. Only count substitution is permitted per docs/06 §3.6.

The implementation must not invoke any model call to produce the narrative. The narrative is
produced by the Selector Orchestration output phase module using a string template — not by a
language model.

---

## Assertion 5 — No summary.md file in this fixture

This fixture tests `trace.selectorSummary.narrative`. It does NOT test the `summary.md` output
file. No `expected/summary.md` file is created for this fixture. The actual `summary.md` output
file (produced from the narrative string by the output writer) is deferred until harness and
output implementation are complete. Inventing an `expected/summary.md` without a defined
canonical shape in `docs/12` is a scope violation.

---

## Assertion 6 — selectorSummary count invariants

- `decidedDefer` = `defaultDefer` + `runtimeUnavailableDefer` (0 = 0 + 0) ✓
- `totalEvaluated` = `decidedInclude` + `decidedOmit` + `decidedDefer` + `unknownReferences`
  (3 = 2 + 1 + 0 + 0) ✓

---

## Assertion 7 — Gap-check invariant

`registryPhase.candidateSetSummary.candidateSetSize` = 3
`conflictPhase.noConflictComponentIds.length` = 3
`conflictPhase.conflictResolutionTrace.length` = 0

Gap-check: `noConflictComponentIds.length + conflictResolutionTrace.length == candidateSetSize`
=> 3 + 0 = 3 ✓

---

## Assertion 8 — Budget invariants

`budgetPhase.trimActions` must be present and an array (empty `[]`).
`budgetPhase.budgetOverflow` must be present and boolean (`false`).
`budgetPhase.budgetOverflow` must equal `budgetPhase.budgetReport.budgetOverflow` (`false`).

---

## Assertion 9 — Partition integrity

Every candidate component appears in exactly one partition:
- `scaffold.agent-persona` → selectedComponents (path: required_match) ✓
- `skill.greeting-flow` → omittedComponents (path: default_action_omit) ✓
- `policy.privacy-baseline` → selectedComponents (path: default_include) ✓

No component appears in more than one partition. No component is absent from all partitions.
`reference_unknown` does not appear in any partition array.

---

## Narrative template source

The canonical narrative template is defined in:
`docs/06_SELECTOR_ORCHESTRATION_SPEC.md §3.6` (F-27 resolved, Pass 4.5B).

This fixture uses the existing canonical template — no new template was invented.
