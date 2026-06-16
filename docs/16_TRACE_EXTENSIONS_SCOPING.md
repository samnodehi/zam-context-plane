# Trace Extensions Scoping

## 1. Status and Authority

| Field | Value |
|---|---|
| **Document type** | Future Scoping Note (Phase 4 of Phased Adoption Plan) |
| **Created** | Post-MVP research phase |
| **MVP authority** | None — this document does not change current MVP schemas, fixtures, enums, or implementation. |
| **Implementation status** | Not implemented. This is a scoping pass for future additive trace phase keys. |
| **Parent document** | `docs/13_MODEL_ASSISTED_CONTEXT_PLANNING.md` §20, §22 |

---

## 2. Objective

Define the conceptual shape of future additive trace phase keys for model-assisted context planning. This document does **not** create any schema file. It does **not** authorize any code. It defines the expected extensions so that a future explicit schema decision pass can produce a validated, updated `trace.schema.json`.

---

## 3. Non-Negotiable Constraint

**None of the trace phase keys or sub-object fields defined in this document may be added to `trace.schema.json` or any other file in `schemas/` without a separate explicit schema decision pass** with defined scope, allowed files, and acceptance criteria.

Any action that adds these fields to `trace.schema.json` without that prior explicit approval constitutes a scope violation.

---

## 4. Relationship to Current MVP Trace Structure

The current MVP `trace.json` is a single JSON object with named phase keys, as defined in `docs/04_PORTABLE_CORE_ARCHITECTURE.md` §7.8. The current 8-key structure is:

```
trace.json
{
  "run":           { runId, planningRunStartedAt, planningRunCompletedAt, promptFamily, schemaVersion },
  "requestPhase":  { requestSignalsSummary, injectionSuspectFlag, promptFamily, familyConfidence },
  "registryPhase": { componentCount, quarantinedCount, validationWarnings[], fatalErrors[] },
  "selectorPhase": {
    "selectorTrace":      [ ... array of selector TraceEntry objects ... ],
    "planningWarnings":   [ ... ],
    "unresolvedConflicts": [ ... ],
    "selectorSummary":    { ... }
  },
  "conflictPhase": { resolvedDecisions[], conflictResolutionTrace[], planningWarnings[] },
  "budgetPhase":   { budgetReport, trimActions[], budgetOverflow },
  "planPhase":     { selectedComponents[], omittedComponents[], deferredComponents[], riskFlags[], failOpenReasons[] },
  "warnings":      [ ... global planning warnings from any phase ... ]
}
```

The extensions defined in this document are **additive**. They introduce new optional phase keys alongside the existing ones. They do **not** replace, rename, or remove any current phase key.

---

## 5. Future Trace Extensions `[FUTURE-ONLY]`

The following table reproduces, verbatim from `docs/13_MODEL_ASSISTED_CONTEXT_PLANNING.md` §20, the five future additive trace extensions. All entries are `[FUTURE-ONLY]`.

| Extension | Description | When needed |
|---|---|---|
| Analyzer output trace `[FUTURE-ONLY]` | Structured trace of request analyzer output (tier, confidence, proposed lanes) | When model-assisted analyzer is implemented |
| Summary trace `[FUTURE-ONLY]` | Structured trace of history compressor decisions (included/omitted/uncertain) | When history compressor is implemented |
| Re-entry event trace `[FUTURE-ONLY]` | Trace of re-entry triggers and updated lane state | When re-entry planning is implemented |
| Output review trace `[FUTURE-ONLY]` | Trace of output review findings and re-entry decisions | When output review is implemented |
| Cache advisory trace `[FUTURE-ONLY]` | Trace of cache stability classification applied to components | When cache advisory ordering is implemented |

Each extension would appear as a new optional phase key in `trace.json`, alongside the existing 8-key structure. No existing phase key is modified.

---

## 6. Conceptual Phase Key Shapes `[FUTURE-ONLY]`

*Note: The conceptual shapes below are derived strictly from `docs/13` §20 and the broader context of `docs/13` §8–§19. They are illustrative only. None of these phase keys or their fields exist in any current MVP schema. They must not be added to `trace.schema.json` without a separate explicit schema decision pass.*

### 6.1 `analyzerPhase` `[FUTURE-ONLY]`

Captures the structured output of the future model-assisted request analyzer, as described in `docs/13` §8 and §20.

```
analyzerPhase:
{
  "analyzerVersion": "string",
  "tier": "integer (0–3)",
  "promptFamily": "string (PromptFamilyValue enum)",
  "analyzerConfidence": "float (0.0–1.0)",
  "proposedLanes": ["string"],
  "failOpenTriggered": "boolean",
  "failOpenReason": "string | null",
  "evidence": ["string"],
  "analyzerTraceId": "string"
}
```

**Constraints (derived from `docs/13` §8):**
- `promptFamily` must be a value from the accepted `PromptFamilyValue` enum (`docs/06` §2.2). No new values may be invented without a formal enum extension pass.
- `analyzerConfidence` is a float (0.0–1.0). It is **distinct from** `SelectionDecision.confidence`, which is the string enum `high | medium | low` owned by `docs/06` §4.
- `proposedLanes` are advisory proposals. They do not override safety constraints, protected lanes, or the deterministic selector ladder.
- `failOpenTriggered: true` must be set when `analyzerConfidence` is below threshold or when `assessedRequestRiskLevel` is `"high"` or `"critical"`.

### 6.2 `summaryPhase` `[FUTURE-ONLY]`

Captures the structured decisions of the future history compressor, as described in `docs/13` §10 and §20.

```
summaryPhase:
{
  "compressorVersion": "string",
  "included": [
    { "category": "string", "description": "string", "sourceReference": "string" }
  ],
  "omitted": [
    { "category": "string", "reason": "string" }
  ],
  "uncertain": [
    { "category": "string", "reason": "string" }
  ],
  "protectedCategories": ["string"],
  "summaryTraceId": "string"
}
```

**Constraints (derived from `docs/13` §10):**
- The `included`, `omitted`, and `uncertain` arrays correspond directly to the three summary trace categories defined in `docs/13` §10.
- `protectedCategories` must list any state category that was unconditionally retained (e.g., durable constraints, open commitments, active task state). Protected categories may never appear in `omitted`.
- Raw turn content must not appear in any of these fields — only category names, descriptions, and source references.

### 6.3 `reentryPhase` `[FUTURE-ONLY]`

Captures re-entry planning events, as described in `docs/13` §18 and §20.

```
reentryPhase:
{
  "trigger": "string",
  "updatedLanes": ["string"],
  "reentryTraceId": "string",
  "priorPlanId": "string"
}
```

**Constraints (derived from `docs/13` §18):**
- `trigger` must describe the event that initiated re-entry (e.g., tool result, error, retry, user clarification).
- `updatedLanes` lists the lanes that received new or changed content as a result of re-entry.
- Re-entry does not blindly reuse the prior plan. It re-runs context planning from the analyzer forward with updated lane inputs.

### 6.4 `outputReviewPhase` `[FUTURE-ONLY]`

Captures the structured findings of the future output review stage, as described in `docs/13` §19 and §20.

```
outputReviewPhase:
{
  "reviewType": "string",
  "defectsFound": ["string"],
  "reentryTriggered": "boolean",
  "reentryTraceId": "string | null",
  "reviewTraceId": "string"
}
```

**Constraints (derived from `docs/13` §19):**
- `reviewType` describes what kind of review was applied (e.g., code review, source/citation review, scope/status review, artifact consistency review, instruction compliance review).
- `defectsFound` lists specific defects identified. If empty, no re-entry is triggered.
- `reentryTriggered: true` only when defects were found and context planning re-ran.
- Output review must not unilaterally block response delivery without operator/human override.

### 6.5 `cacheAdvisoryPhase` `[FUTURE-ONLY]`

Captures cache stability classification decisions applied by the Prompt Plan Generator during component ordering, as described in `docs/13` §15 and §20.

```
cacheAdvisoryPhase:
{
  "classificationApplied": "boolean",
  "componentClassifications": [
    { "componentId": "string", "cacheStability": "stable | session | volatile" }
  ],
  "orderingInvariantsVerified": "boolean",
  "cacheAdvisoryTraceId": "string"
}
```

**Constraints (derived from `docs/13` §15 and `docs/04` §7.7):**
- `cacheStability` values are: `stable`, `session`, `volatile`. These are the exact three values defined in `docs/13` §15 and `docs/04` §7.7. No other values may be used.
- Cache advisory classification is **advisory only**. It affects the sequence of entries in `selectedComponents[]` only.
- `orderingInvariantsVerified: true` asserts that ordering did not alter the membership of `selectedComponents[]`, `omittedComponents[]`, or `deferredComponents[]`.
- No provider-specific cache fields (`cacheControlHeaders`, `ttl`, `minBlockSize`, provider pricing/billing fields) may appear in this phase key.

---

## 7. Integration with Existing MVP Trace Structure

When future extensions are implemented, the `trace.json` object would grow from 8 to at most 13 keys (8 existing + 5 new optional phase keys):

```
trace.json (future, illustrative)
{
  "run":                { ... }               ← current MVP key
  "requestPhase":       { ... }               ← current MVP key
  "registryPhase":      { ... }               ← current MVP key
  "selectorPhase":      { ... }               ← current MVP key
  "conflictPhase":      { ... }               ← current MVP key
  "budgetPhase":        { ... }               ← current MVP key
  "planPhase":          { ... }               ← current MVP key
  "warnings":           [ ... ]               ← current MVP key

  "analyzerPhase":      { ... }               [FUTURE-ONLY]
  "summaryPhase":       { ... }               [FUTURE-ONLY]
  "reentryPhase":       { ... }               [FUTURE-ONLY]
  "outputReviewPhase":  { ... }               [FUTURE-ONLY]
  "cacheAdvisoryPhase": { ... }               [FUTURE-ONLY]
}
```

**What does NOT change in this model:**
- The existing 8-key structure remains intact and unchanged.
- `trace.schema.json` is not modified by this document.
- No existing MVP phase key is renamed or removed.
- New phase keys are optional. Their absence in an MVP-only trace does not constitute a schema validation failure.

---

## 8. Next Steps

This scoping document establishes the conceptual shape for Phase 4. Before any implementation proceeds:

1. A formal update to `trace.schema.json` to add any of these phase keys requires its own **explicit schema decision pass** with canonical approval.
2. Enum extensions to `cacheStability` values (if any) require their own **explicit enum extension pass** against `docs/13` §15 and `docs/04` §7.7.
3. Fixture groups for these extensions (defined in `docs/13` §20) require **Phase 5+ scoping**.
