# Schema Decision Pass — Phase 4.5

## 1. Status and Authority

| Field | Value |
|---|---|
| **Document type** | Schema Decision Pass (Phase 4.5) |
| **Created** | Post-MVP research phase |
| **MVP authority** | None — this document does not change current MVP schemas, fixtures, enums, or implementation. |
| **Implementation status** | Decision only. No `.schema.json` file has been edited in this pass. Actual schema edits require a separate explicit implementation pass referencing this document. |
| **Parent documents** | `docs/15_REQUEST_ANALYZER_SCHEMA_SCOPING.md` (Phase 3), `docs/16_TRACE_EXTENSIONS_SCOPING.md` (Phase 4) |
| **Canonical authority** | `docs/13_MODEL_ASSISTED_CONTEXT_PLANNING.md` §8, §10, §15, §18, §19, §20 |

---

## 2. Objective

This document serves as the **explicit canonical approval record** for a future implementation pass that will add the future scoping structures from `docs/15` and `docs/16` to the appropriate schema files.

This document:
- identifies exactly which schema files will be modified;
- specifies exactly what JSON Schema syntax will be added to each file;
- does NOT alter any current schema file;
- does NOT affect any current fixture, test, or harness.

Any future implementation pass that edits a `.schema.json` file must cite this document as its authority.

---

## 3. Non-Negotiable Constraint

No `.schema.json` file may be edited until this document is cited as the authority for a separate, explicitly scoped implementation pass. This document is the gating approval record — it does not itself constitute execution.

---

## 4. Current Schema File Map

The complete current set of schema files (at Phase 4.5 decision point):

### `schemas/outputs/`
| File | Purpose |
|---|---|
| `trace.schema.json` | Output trace for a planning run. 8 required top-level phase keys. `additionalProperties: false`. |
| `prompt-plan.schema.json` | Output prompt plan (`prompt-plan.json`). |

### `schemas/inputs/`
| File | Purpose |
|---|---|
| `active-ids.schema.json` | Active component ID set. |
| `budget-state.schema.json` | Budget state input. |
| `component-registry.schema.json` | Component registry input. |
| `history-state-summary.schema.json` | History state summary input. |
| `request-signals.schema.json` | Request router signals input. |
| `runtime-capabilities.schema.json` | Runtime capabilities input. |
| `selector-policy.schema.json` | Selector policy input. |
| `user-constraints.schema.json` | User constraints input. |

### `schemas/internal/`
| File | Purpose |
|---|---|
| `budget-report.schema.json` | BudgetReport internal object. |
| `conflict-resolution-trace.schema.json` | Conflict resolution trace entry. |
| `planning-warning.schema.json` | PlanningWarning object. |
| `resolved-selection-decision.schema.json` | ResolvedSelectionDecision object. |
| `selection-decision.schema.json` | SelectionDecision object. |
| `selector-summary.schema.json` | SelectorSummary object. |
| `trace-entry.schema.json` | TraceEntry object. |

### `schemas/shared/`
| File | Purpose |
|---|---|
| `enums.shared.schema.json` | Shared enums (SelectionAction, RiskLevel, etc.). |
| `prompt-family.schema.json` | PromptFamilyValue enum. |
| `warning-code.schema.json` | WarningCode enum. |

---

## 5. Schema Files Targeted by Phase 3 (`docs/15`) `[FUTURE-ONLY]`

Phase 3 (`docs/15`) scoped the `AnalyzerOutput` (or `RequestProfile`) object. The implementation pass will create one new file and leave all existing files unchanged.

### 5.1 New File: `schemas/inputs/analyzer-output.schema.json` `[FUTURE-ONLY]`

This file does not yet exist. It will be created by a future implementation pass.

**Authority:** `docs/15` §4 (field definitions), `docs/15` §6 (fail-open semantics), `docs/13` §8.

**Exact JSON Schema to be added (verbatim from `docs/15` §4.1 and §4.2):**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://portable-context-control-plane/schemas/inputs/analyzer-output.schema.json",
  "title": "Portable Context Control Plane — Analyzer Output Schema",
  "description": "Future-only. Structured output of the model-assisted Request Analyzer. Advisory input to the Conflict Resolver. Does not override safety constraints, protected lanes, or the deterministic selector ladder. Canonical: docs/15 §4; docs/13 §8.",
  "$comment": "[FUTURE-ONLY] Phase 3 implementation. Not active in MVP. Authority: docs/17_SCHEMA_DECISION_PASS.md §5.1.",

  "type": "object",
  "required": [
    "analyzerVersion",
    "tier",
    "promptFamily",
    "analyzerConfidence",
    "failOpenTriggered",
    "failOpenReason",
    "evidence",
    "analyzerTraceId"
  ],
  "additionalProperties": false,

  "properties": {
    "analyzerVersion": {
      "type": "string",
      "minLength": 1,
      "description": "Identifier of the analyzer model/version that produced this output. For audit and reproducibility. Not a schema version. Canonical: docs/15 §4.2."
    },
    "tier": {
      "type": "integer",
      "minimum": 0,
      "maximum": 3,
      "description": "Which routing tier was applied. 0 = deterministic fast path; 3 = fail-open expanded context. Canonical: docs/15 §5."
    },
    "promptFamily": {
      "$ref": "https://portable-context-control-plane/schemas/shared/prompt-family.schema.json#PromptFamilyValue",
      "description": "Prompt family classification proposal. MUST be a value from the accepted PromptFamilyValue enum (docs/06 §2.2). Cannot invent new values without a formal enum extension pass. Canonical: docs/15 §4.2."
    },
    "requestType": {
      "type": "string",
      "minLength": 1,
      "description": "[FUTURE-ONLY] Broad request category (e.g., coding, research, greeting). Does not exist in MVP. Not a requestSignals field. Canonical: docs/15 §4.2."
    },
    "taskType": {
      "type": "string",
      "minLength": 1,
      "description": "[FUTURE-ONLY] Specific task shape (e.g., debug, refactor, continuation). Does not exist in MVP. Canonical: docs/15 §4.2."
    },
    "analyzerConfidence": {
      "type": "number",
      "minimum": 0.0,
      "maximum": 1.0,
      "description": "[FUTURE-ONLY] Analyzer's float confidence in its classification. DISTINCT from SelectionDecision.confidence (string enum high/medium/low, owned by docs/06 §4). Aligned with requestSignals.familyConfidence (float). Canonical: docs/15 §4.2."
    },
    "assessedRequestRiskLevel": {
      "type": "string",
      "minLength": 1,
      "description": "[FUTURE-ONLY] Analyzer's assessment of request-level risk. DISTINCT from component riskLevel (docs/05 §5, enums.shared.schema.json#RiskLevel) — that is a per-component registry field. This is a request-level assessment. Canonical: docs/15 §4.2."
    },
    "neededLanes": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      },
      "description": "[FUTURE-ONLY] Lanes the analyzer proposes as relevant for this request. Advisory only. Does not override protected lanes. Deterministic guardrails validate all proposals. Canonical: docs/15 §4.2."
    },
    "requiresHistory": {
      "type": "boolean",
      "description": "[FUTURE-ONLY] Whether the request semantically needs history context. Advisory. Protected lanes cannot be omitted regardless. Canonical: docs/15 §4.2."
    },
    "requiresTools": {
      "type": "boolean",
      "description": "[FUTURE-ONLY] Whether the request needs tool context. Advisory. Canonical: docs/15 §4.2."
    },
    "requiresFiles": {
      "type": "boolean",
      "description": "[FUTURE-ONLY] Whether the request needs file/project context. Advisory. Canonical: docs/15 §4.2."
    },
    "failOpenTriggered": {
      "type": "boolean",
      "description": "Whether this output represents a fail-open expansion rather than a confident classification. Must be true when analyzerConfidence is below threshold or when assessedRequestRiskLevel is high or critical. Canonical: docs/15 §4.2, §6."
    },
    "failOpenReason": {
      "type": ["string", "null"],
      "description": "Human-readable reason why fail-open was triggered, or null if it was not. Required in trace when failOpenTriggered: true. Canonical: docs/15 §4.2, §6."
    },
    "evidence": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      },
      "description": "The textual signals or patterns the analyzer used to reach its classification. Required for auditability and trace. Canonical: docs/15 §4.2."
    },
    "analyzerTraceId": {
      "type": "string",
      "minLength": 1,
      "description": "Unique ID linking this AnalyzerOutput to its trace entry in trace.json (analyzerPhase.analyzerTraceId). Required for full traceability. Canonical: docs/15 §4.2; docs/16 §6.1."
    }
  }
}
```

**Forbidden fields** (per `docs/15` §8 — must never be added):
- `modelPrompt` — provider-adapter concern
- `modelResponse` — provider-adapter concern
- `rawAnalyzerOutput` — provider-adapter concern
- `providerCost` — provider-adapter concern
- `providerCacheKey` — provider-adapter concern

**Existing files unchanged by Phase 3:**
- `request-signals.schema.json` — no new fields added
- `selection-decision.schema.json` — no changes; `AnalyzerOutput` is a separate object
- `resolved-selection-decision.schema.json` — no changes

---

## 6. Schema Files Targeted by Phase 4 (`docs/16`) `[FUTURE-ONLY]`

Phase 4 (`docs/16`) scoped the 5 additive trace phase keys. The implementation pass will modify exactly one existing file: `trace.schema.json`.

### 6.1 Modified File: `schemas/outputs/trace.schema.json` `[FUTURE-ONLY]`

The current `trace.schema.json` has:
- `"required": ["run", "requestPhase", "registryPhase", "selectorPhase", "conflictPhase", "budgetPhase", "planPhase", "warnings"]` (8 keys)
- `"additionalProperties": false`

The future implementation pass must:
1. Change `"additionalProperties": false` to either `"additionalProperties": false` with 5 new optional properties added to `"properties"`, **or** the equivalent approach of keeping `additionalProperties: false` and adding the 5 keys as optional properties (not required). The 8 existing required keys must remain in `"required"` unchanged.
2. Add 5 new optional property definitions (not required) to `"properties"`.

**The 8 existing `"required"` keys must not change.** The new keys are optional — their absence in MVP-only traces does not constitute a schema validation failure.

#### 6.1.1 `analyzerPhase` property definition `[FUTURE-ONLY]`

Authority: `docs/16` §6.1; `docs/13` §8.

```json
"analyzerPhase": {
  "type": "object",
  "$comment": "[FUTURE-ONLY] Phase 4 trace extension. Not active in MVP. Authority: docs/17_SCHEMA_DECISION_PASS.md §6.1.1.",
  "description": "[FUTURE-ONLY] Captures the structured trace of request analyzer output (tier, confidence, proposed lanes). Present only when model-assisted analyzer is implemented. Canonical: docs/16 §6.1; docs/13 §8.",
  "required": [
    "analyzerVersion",
    "tier",
    "promptFamily",
    "analyzerConfidence",
    "proposedLanes",
    "failOpenTriggered",
    "failOpenReason",
    "evidence",
    "analyzerTraceId"
  ],
  "additionalProperties": false,
  "properties": {
    "analyzerVersion": {
      "type": "string",
      "minLength": 1,
      "description": "Identifier of the analyzer model/version. Canonical: docs/16 §6.1."
    },
    "tier": {
      "type": "integer",
      "minimum": 0,
      "maximum": 3,
      "description": "Routing tier applied. 0 = fast path; 3 = fail-open. Canonical: docs/15 §5."
    },
    "promptFamily": {
      "$ref": "https://portable-context-control-plane/schemas/shared/prompt-family.schema.json#PromptFamilyValue",
      "description": "Prompt family proposal. Must be from PromptFamilyValue enum. Canonical: docs/06 §2.2."
    },
    "analyzerConfidence": {
      "type": "number",
      "minimum": 0.0,
      "maximum": 1.0,
      "description": "Float confidence score. DISTINCT from SelectionDecision.confidence string enum. Canonical: docs/16 §6.1."
    },
    "proposedLanes": {
      "type": "array",
      "items": { "type": "string", "minLength": 1 },
      "description": "Advisory lane proposals. Do not override safety constraints or protected lanes. Canonical: docs/16 §6.1."
    },
    "failOpenTriggered": {
      "type": "boolean",
      "description": "true when analyzerConfidence is below threshold or assessedRequestRiskLevel is high or critical. Canonical: docs/16 §6.1."
    },
    "failOpenReason": {
      "type": ["string", "null"],
      "description": "Reason why fail-open was triggered, or null. Canonical: docs/16 §6.1."
    },
    "evidence": {
      "type": "array",
      "items": { "type": "string", "minLength": 1 },
      "description": "Signals used to reach the classification. Required for auditability. Canonical: docs/16 §6.1."
    },
    "analyzerTraceId": {
      "type": "string",
      "minLength": 1,
      "description": "Unique ID linking this phase to analyzer-output.schema.json analyzerTraceId. Canonical: docs/16 §6.1."
    }
  }
}
```

#### 6.1.2 `summaryPhase` property definition `[FUTURE-ONLY]`

Authority: `docs/16` §6.2; `docs/13` §10.

```json
"summaryPhase": {
  "type": "object",
  "$comment": "[FUTURE-ONLY] Phase 4 trace extension. Not active in MVP. Authority: docs/17_SCHEMA_DECISION_PASS.md §6.1.2.",
  "description": "[FUTURE-ONLY] Captures history compressor decisions (included/omitted/uncertain). Present only when history compressor is implemented. Canonical: docs/16 §6.2; docs/13 §10.",
  "required": [
    "compressorVersion",
    "included",
    "omitted",
    "uncertain",
    "protectedCategories",
    "summaryTraceId"
  ],
  "additionalProperties": false,
  "properties": {
    "compressorVersion": {
      "type": "string",
      "minLength": 1,
      "description": "Identifier of the compressor version. Canonical: docs/16 §6.2."
    },
    "included": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["category", "description", "sourceReference"],
        "additionalProperties": false,
        "properties": {
          "category": { "type": "string", "minLength": 1 },
          "description": { "type": "string", "minLength": 1 },
          "sourceReference": { "type": "string", "minLength": 1 }
        }
      },
      "description": "State categories unconditionally retained. No raw turn content. Canonical: docs/16 §6.2; docs/13 §10."
    },
    "omitted": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["category", "reason"],
        "additionalProperties": false,
        "properties": {
          "category": { "type": "string", "minLength": 1 },
          "reason": { "type": "string", "minLength": 1 }
        }
      },
      "description": "State categories omitted by the compressor. Protected categories must never appear here. No raw turn content. Canonical: docs/16 §6.2."
    },
    "uncertain": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["category", "reason"],
        "additionalProperties": false,
        "properties": {
          "category": { "type": "string", "minLength": 1 },
          "reason": { "type": "string", "minLength": 1 }
        }
      },
      "description": "State categories with uncertain retention status. No raw turn content. Canonical: docs/16 §6.2."
    },
    "protectedCategories": {
      "type": "array",
      "items": { "type": "string", "minLength": 1 },
      "description": "Categories unconditionally retained regardless of compressor decision. Must not appear in omitted[]. Canonical: docs/16 §6.2."
    },
    "summaryTraceId": {
      "type": "string",
      "minLength": 1,
      "description": "Unique ID for this summary phase trace entry. Canonical: docs/16 §6.2."
    }
  }
}
```

#### 6.1.3 `reentryPhase` property definition `[FUTURE-ONLY]`

Authority: `docs/16` §6.3; `docs/13` §18.

**Decision (approved by Sam):** `reentryPhase` is an **array of objects**, not a single object. A single planning run may produce multiple re-entry events (e.g., a validation error re-entry followed by a tool-result re-entry). Modeling as a single object would silently overwrite earlier re-entry records, violating the full-auditability requirement. An array preserves all re-entry events in chronological order.

```json
"reentryPhase": {
  "type": "array",
  "$comment": "[FUTURE-ONLY] Phase 4 trace extension. Not active in MVP. Array shape — multiple re-entry events per run. Authority: docs/17_SCHEMA_DECISION_PASS.md §6.1.3.",
  "description": "[FUTURE-ONLY] Ordered array of re-entry events in this planning run. Each entry captures one re-entry trigger and updated lane state. Array shape ensures multiple re-entry events are not overwritten. Present only when re-entry planning is implemented. Canonical: docs/16 §6.3; docs/13 §18.",
  "items": {
    "type": "object",
    "required": [
      "trigger",
      "updatedLanes",
      "reentryTraceId",
      "priorPlanId"
    ],
    "additionalProperties": false,
    "properties": {
      "trigger": {
        "type": "string",
        "minLength": 1,
        "description": "Event that initiated this re-entry (e.g., tool result, error, retry, user clarification). Canonical: docs/16 §6.3."
      },
      "updatedLanes": {
        "type": "array",
        "items": { "type": "string", "minLength": 1 },
        "description": "Lanes that received new or changed content as a result of this re-entry. Canonical: docs/16 §6.3."
      },
      "reentryTraceId": {
        "type": "string",
        "minLength": 1,
        "description": "Unique ID for this re-entry event trace entry. Canonical: docs/16 §6.3."
      },
      "priorPlanId": {
        "type": "string",
        "minLength": 1,
        "description": "runId of the prior planning run that this re-entry updates. Canonical: docs/16 §6.3."
      }
    }
  }
}
```

#### 6.1.4 `outputReviewPhase` property definition `[FUTURE-ONLY]`

Authority: `docs/16` §6.4; `docs/13` §19.

```json
"outputReviewPhase": {
  "type": "object",
  "$comment": "[FUTURE-ONLY] Phase 4 trace extension. Not active in MVP. Authority: docs/17_SCHEMA_DECISION_PASS.md §6.1.4.",
  "description": "[FUTURE-ONLY] Captures output review findings and re-entry decisions. Present only when output review is implemented. Canonical: docs/16 §6.4; docs/13 §19.",
  "required": [
    "reviewType",
    "defectsFound",
    "reentryTriggered",
    "reentryTraceId",
    "reviewTraceId"
  ],
  "additionalProperties": false,
  "properties": {
    "reviewType": {
      "type": "string",
      "minLength": 1,
      "description": "Kind of review applied (e.g., code review, source/citation review, scope/status review, artifact consistency review, instruction compliance review). Canonical: docs/16 §6.4."
    },
    "defectsFound": {
      "type": "array",
      "items": { "type": "string", "minLength": 1 },
      "description": "Specific defects identified. If empty, no re-entry is triggered. Canonical: docs/16 §6.4."
    },
    "reentryTriggered": {
      "type": "boolean",
      "description": "true only when defects were found and context planning re-ran. Canonical: docs/16 §6.4."
    },
    "reentryTraceId": {
      "type": ["string", "null"],
      "description": "reentryTraceId of the triggered re-entry, or null when reentryTriggered is false. Canonical: docs/16 §6.4."
    },
    "reviewTraceId": {
      "type": "string",
      "minLength": 1,
      "description": "Unique ID for this output review phase trace entry. Canonical: docs/16 §6.4."
    }
  }
}
```

#### 6.1.5 `cacheAdvisoryPhase` property definition `[FUTURE-ONLY]`

Authority: `docs/16` §6.5; `docs/13` §15; `docs/04` §7.7.

```json
"cacheAdvisoryPhase": {
  "type": "object",
  "$comment": "[FUTURE-ONLY] Phase 4 trace extension. Not active in MVP. Authority: docs/17_SCHEMA_DECISION_PASS.md §6.1.5.",
  "description": "[FUTURE-ONLY] Captures cache stability classification applied to components during ordering. Present only when cache advisory ordering is implemented. Canonical: docs/16 §6.5; docs/13 §15; docs/04 §7.7.",
  "required": [
    "classificationApplied",
    "componentClassifications",
    "orderingInvariantsVerified",
    "cacheAdvisoryTraceId"
  ],
  "additionalProperties": false,
  "properties": {
    "classificationApplied": {
      "type": "boolean",
      "description": "Whether cache advisory classification was applied in this run. Canonical: docs/16 §6.5."
    },
    "componentClassifications": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["componentId", "cacheStability"],
        "additionalProperties": false,
        "properties": {
          "componentId": {
            "type": "string",
            "minLength": 1,
            "description": "Registry component ID. Canonical: docs/16 §6.5."
          },
          "cacheStability": {
            "type": "string",
            "enum": ["stable", "session", "volatile"],
            "description": "Cache stability classification. Exactly 3 valid values: stable, session, volatile. No other values permitted. Canonical: docs/13 §15; docs/04 §7.7; docs/16 §6.5."
          }
        }
      },
      "description": "Per-component cache stability classifications applied during ordering. Advisory only — affects sequence only, never partition membership. Canonical: docs/16 §6.5."
    },
    "orderingInvariantsVerified": {
      "type": "boolean",
      "description": "true asserts that ordering did not alter the membership of selectedComponents[], omittedComponents[], or deferredComponents[]. Canonical: docs/16 §6.5."
    },
    "cacheAdvisoryTraceId": {
      "type": "string",
      "minLength": 1,
      "description": "Unique ID for this cache advisory phase trace entry. Canonical: docs/16 §6.5."
    }
  }
}
```

**Forbidden `cacheAdvisoryPhase` fields** (must never be added):
- `cacheControlHeaders` — provider-specific
- `ttl` — provider-specific
- `minBlockSize` — provider-specific
- Any provider pricing or billing fields

---

## 7. Summary of Schema Changes

| Schema file | Change type | What changes |
|---|---|---|
| `schemas/inputs/analyzer-output.schema.json` | **Create new** `[FUTURE-ONLY]` | New schema file for `AnalyzerOutput` object (Phase 3 / `docs/15`) |
| `schemas/outputs/trace.schema.json` | **Add 5 optional properties** `[FUTURE-ONLY]` | `analyzerPhase`, `summaryPhase`, `reentryPhase`, `outputReviewPhase`, `cacheAdvisoryPhase` added to `properties` — not to `required` (Phase 4 / `docs/16`) |

**All other schema files are unchanged.**

---

## 8. Invariants That Must Be Preserved During Implementation

All invariants from `trace.schema.json` and the canonical project specs must be fully preserved:

1. The existing 8 `required` keys in `trace.schema.json` (`run`, `requestPhase`, `registryPhase`, `selectorPhase`, `conflictPhase`, `budgetPhase`, `planPhase`, `warnings`) must not change.
2. The 5 new phase keys are optional — their absence in an MVP-only trace must not cause schema validation failure.
3. No existing phase key is renamed, removed, or modified.
4. `analyzerConfidence` (float) must remain explicitly distinct from `SelectionDecision.confidence` (string enum `high`/`medium`/`low`).
5. `cacheStability` enum must use exactly `stable`, `session`, `volatile` — no other values.
6. No provider-specific fields may appear in any future phase key.
7. `PromptFamilyValue` in `analyzerPhase.promptFamily` and `analyzer-output.schema.json#promptFamily` must reference the canonical `prompt-family.schema.json#PromptFamilyValue`.
8. `protectedCategories[]` in `summaryPhase` must never appear in `omitted[]`.
9. `orderingInvariantsVerified: true` in `cacheAdvisoryPhase` asserts partition membership is unchanged.

---

## 9. Next Steps

This document is the gating approval for Phase 5 (schema implementation). Before the implementation pass proceeds:

1. The implementation pass must cite this document (`docs/17_SCHEMA_DECISION_PASS.md`) as its authority.
2. The implementation pass must be a separate, narrowly scoped Coder pass with exactly two allowed files: `schemas/inputs/analyzer-output.schema.json` (create) and `schemas/outputs/trace.schema.json` (modify).
3. After schema edits, a fixture and harness compatibility check must confirm no existing MVP tests are broken.
4. Phase 5+ fixture groups for these extensions (defined in `docs/13` §20) are deferred to a separate scoping pass.
