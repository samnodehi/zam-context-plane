# Assertions — 01-full-extensions

## Purpose

This fixture verifies that a `trace.json` payload containing all five
`[FUTURE-ONLY]` trace extension phase keys validates successfully against
`schemas/outputs/trace.schema.json`.

## What Is Tested

- The eight required MVP phase keys are present with valid stub data:
  `run`, `requestPhase`, `registryPhase`, `selectorPhase`, `conflictPhase`,
  `budgetPhase`, `planPhase`, `warnings`.
- All five future extension phase keys are present with data conforming
  exactly to the shapes defined in `docs/16_TRACE_EXTENSIONS_SCOPING.md §6`:
  - `analyzerPhase` (§6.1): `analyzerVersion`, `tier` (0–3), `promptFamily`,
    `analyzerConfidence` (0.0–1.0), `proposedLanes`, `failOpenTriggered`,
    `failOpenReason` (null when not triggered), `evidence`, `analyzerTraceId`.
  - `summaryPhase` (§6.2): `compressorVersion`, `included[]`, `omitted[]`,
    `uncertain[]`, `protectedCategories[]`, `summaryTraceId`.
  - `reentryPhase` (§6.3): array of re-entry event objects, each with
    `trigger`, `updatedLanes`, `reentryTraceId`, `priorPlanId`.
  - `outputReviewPhase` (§6.4): `reviewType`, `defectsFound[]`,
    `reentryTriggered`, `reentryTraceId` (null when not triggered),
    `reviewTraceId`.
  - `cacheAdvisoryPhase` (§6.5): `classificationApplied`,
    `componentClassifications[]` (each with `componentId` and `cacheStability`
    in `[stable, session, volatile]`), `orderingInvariantsVerified`,
    `cacheAdvisoryTraceId`.

## Constraint Invariants Verified

- `protectedCategories` in `summaryPhase` do not appear in `omitted[]`.
- `reentryPhase` is an array (can contain multiple re-entry events).
- `reentryTriggered: false` in `outputReviewPhase` → `reentryTraceId: null`.
- `cacheStability` values are from the closed set `[stable, session, volatile]`.
- `analyzerConfidence` is a float 0.0–1.0 (distinct from `SelectionDecision.confidence` string enum).
- No raw user text or raw component content in any field.

## Pass Criterion

AJV schema validation against `schemas/outputs/trace.schema.json` returns
`true` for this payload. The future harness runner reports `status: passed`.

## Canonical References

- `docs/16_TRACE_EXTENSIONS_SCOPING.md §6.1–§6.5`
- `docs/13_MODEL_ASSISTED_CONTEXT_PLANNING.md §20`
- `docs/22_MODEL_ASSISTED_HARNESS_SCOPING.md §6, §9 (Phase P7)`
- `schemas/outputs/trace.schema.json` (lines 414–674)
