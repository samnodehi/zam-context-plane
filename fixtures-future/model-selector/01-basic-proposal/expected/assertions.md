# Assertions — 01-basic-proposal

## Purpose

This fixture verifies that a `model-selector-output.json` payload containing
one `include` proposal and one `omit` proposal validates successfully against
`schemas/future/model-selector-output.schema.json`.

It also confirms the OQ-2 resolution from
`docs/19_MODEL_ASSISTED_SELECTOR_SCOPING.md §8`: model-assisted selectors
produce `ProposalDecision` records (not `SelectionDecision` records), and the
`ModelSelectorOutput` wrapper carries a `selectorName` identifying the model
selector's scope.

## What Is Tested

- Root shape: `selectorName` (string) and `proposals` (array) are present and
  correctly typed.
- `include` proposal (skill.code-formatter):
  - `action: "include"` with `path: "required_match"` — valid action/path pair.
  - `confidence: "high"` — from the closed `SelectionConfidence` enum.
  - `evidence[]` is non-empty — required for auditability.
  - `reason` is a non-empty string with no raw content.
- `omit` proposal (skill.research-synthesizer):
  - `action: "omit"` with `path: "safe_to_omit_match"` — valid action/path pair.
  - `confidence: "high"` — a low-confidence omit is NOT present (low confidence
    triggers fail-open per docs/19 §6 Prohibition 4).
  - `evidence[]` is non-empty — required for any omit proposal.

## Key Constraint Invariants

- No `traceRefs`, `constraintsApplied`, `budgetHint`, or other
  `SelectionDecision`-only fields are present (these are Orchestrator-owned).
- `action`, `confidence`, and `path` values are all from their respective
  closed inline enums (matching `SelectionAction`, `SelectionConfidence`,
  `SelectionPath` in `docs/06 §4`).
- `additionalProperties: false` is enforced at both root and `ProposalDecision`
  level — no undocumented fields are accepted.

## OQ-2 Resolution (docs/19 §8)

This fixture documents the chosen resolution: **a separate `ProposalDecision`
schema** (not reuse of canonical `SelectionDecision`). The Orchestrator converts
`ProposalDecision` records into `SelectionDecision` records before passing them
to the Conflict Resolver.

## Pass Criterion

AJV schema validation against
`schemas/future/model-selector-output.schema.json` returns `true` for this
payload. The future harness runner reports `status: passed`.

## Canonical References

- `docs/19_MODEL_ASSISTED_SELECTOR_SCOPING.md §8` (OQ-2 resolution)
- `docs/13_MODEL_ASSISTED_CONTEXT_PLANNING.md §12`
- `docs/22_MODEL_ASSISTED_HARNESS_SCOPING.md §9 (Phase P8)`
- `schemas/future/model-selector-output.schema.json`
