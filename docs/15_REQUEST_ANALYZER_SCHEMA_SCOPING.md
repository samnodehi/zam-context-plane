# Request Analyzer and Lane Proposal Schema Scoping

## 1. Status and Authority

| Field | Value |
|---|---|
| **Document type** | Future Scoping Note (Phase 3 of Phased Adoption Plan) |
| **Created** | Post-MVP research phase |
| **MVP authority** | None — this document does not change current MVP schemas, fixtures, enums, or implementation. |
| **Implementation status** | Not implemented. This is a scoping pass for the future request analyzer schema shape. |
| **Parent document** | `docs/13_MODEL_ASSISTED_CONTEXT_PLANNING.md` §8, §9, §12 |

---

## 2. Objective

Define the structure, field definitions, disambiguation notes, and fail-open semantics for a future `AnalyzerOutput` (or `RequestProfile`) object — the structured output that a future model-assisted Request Analyzer would produce.

This document does **not** create any schema file. It does **not** authorize any code. It defines the expected shape so that a future explicit schema decision pass can produce a validated `analyzer-output.schema.json`.

---

## 3. Relationship to Current MVP

The current MVP Request Router (`docs/04` §7.2) is deterministic and produces `requestSignals` as defined by `request-signals.schema.json` and `docs/06` §2.1. It uses keyword/pattern matching to classify prompt families.

A future model-assisted Request Analyzer sits **beside** (not replacing) the deterministic router. It is a proposal source that enters the existing Conflict Resolver pipeline as additional input.

**Key invariants that must be preserved regardless of future analyzer implementation:**

- `PromptFamilyValue` enum (`docs/06` §2.2) governs all prompt family classifications.
- `SelectionDecision.confidence` is a string enum (`high`/`medium`/`low`) and is owned by `docs/06` §4. The future analyzer's float confidence score (`analyzerConfidence`) is **distinct** from this field.
- The deterministic selector ladder (`docs/06` §8 Steps 1–7) remains the final authority.
- Safety hard-protection (`docs/06` §8 Step 3) cannot be overridden by any analyzer proposal.
- The injection gate (`docs/06` §17) applies to all decisions regardless of source.

---

## 4. Future AnalyzerOutput Schema Shape `[FUTURE-ONLY]`

*Note: The field definitions below are a scoping proposal only. None of these fields exist in any current MVP schema. They must not be added to `request-signals.schema.json` or any other MVP schema file without a separate explicit schema decision pass.*

### 4.1 Top-Level Object

```json
{
  "analyzerVersion": "string",
  "tier": "integer (0–3)",
  "promptFamily": "string (PromptFamilyValue enum)",
  "requestType": "string",
  "taskType": "string",
  "analyzerConfidence": "float (0.0–1.0)",
  "assessedRequestRiskLevel": "string",
  "neededLanes": ["string"],
  "requiresHistory": "boolean",
  "requiresTools": "boolean",
  "requiresFiles": "boolean",
  "failOpenTriggered": "boolean",
  "failOpenReason": "string | null",
  "evidence": ["string"],
  "analyzerTraceId": "string"
}
```

### 4.2 Field Definitions

| Field | Type | Description | Disambiguation |
|---|---|---|---|
| `analyzerVersion` | string | Identifier of the analyzer model/version that produced this output. | For audit and reproducibility. Not a schema version. |
| `tier` | integer 0–3 | Which routing tier was applied (see §5). | `0` = deterministic fast path; `3` = fail-open expanded context. |
| `promptFamily` | string | Prompt family classification proposal. | **Must** be a value from the accepted `PromptFamilyValue` enum (`docs/06` §2.2). Cannot invent new values without a formal enum extension pass. |
| `requestType` `[FUTURE-ONLY]` | string | Broad request category (e.g., `"coding"`, `"research"`, `"greeting"`). | Does not exist in MVP. Not a `requestSignals` field. |
| `taskType` `[FUTURE-ONLY]` | string | Specific task shape (e.g., `"debug"`, `"refactor"`, `"continuation"`). | Does not exist in MVP. |
| `analyzerConfidence` `[FUTURE-ONLY]` | float 0.0–1.0 | Analyzer's float confidence in its classification. | **Distinct from** `SelectionDecision.confidence` (string enum `high`/`medium`/`low`, owned by `docs/06` §4). Aligned with `requestSignals.familyConfidence` (float). |
| `assessedRequestRiskLevel` `[FUTURE-ONLY]` | string | Analyzer's assessment of request-level risk (e.g., `"low"`, `"medium"`, `"high"`, `"critical"`). | **Distinct from** component `riskLevel` (`docs/05` §5, `enums.shared.schema.json#RiskLevel`). That is a per-component registry field. This is a request-level assessment. |
| `neededLanes` `[FUTURE-ONLY]` | string[] | Lanes the analyzer proposes as relevant for this request. | Advisory only. Does not override protected lanes. Deterministic guardrails validate all proposals. |
| `requiresHistory` `[FUTURE-ONLY]` | boolean | Whether the request semantically needs history context. | Advisory. Protected lanes cannot be omitted regardless. |
| `requiresTools` `[FUTURE-ONLY]` | boolean | Whether the request needs tool context. | Advisory. |
| `requiresFiles` `[FUTURE-ONLY]` | boolean | Whether the request needs file/project context. | Advisory. |
| `failOpenTriggered` | boolean | Whether this output represents a fail-open expansion rather than a confident classification. | Must be `true` when `analyzerConfidence < threshold` or when `assessedRequestRiskLevel` is `"high"` or `"critical"`. |
| `failOpenReason` | string or null | Human-readable reason why fail-open was triggered, or `null` if it was not. | Required in trace when `failOpenTriggered: true`. |
| `evidence` | string[] | The textual signals or patterns the analyzer used to reach its classification. | Required for auditability and trace. |
| `analyzerTraceId` | string | Unique ID linking this `AnalyzerOutput` to its trace entry in `trace.json`. | Required for full traceability. |

---

## 5. Tiered Routing Semantics

The analyzer tier governs how aggressively it classifies versus how quickly it falls back to fail-open behavior:

| Tier | Mode | Condition | Outcome |
|---|---|---|---|
| **0** | Deterministic fast path | Request matches simple pattern (greeting, acknowledgement, no-op) | Bypass analyzer; use deterministic router only. `failOpenTriggered: false`. |
| **1** | Lightweight analyzer | Ordinary requests needing semantic routing | Analyzer runs. High-confidence classification. `failOpenTriggered: false` if confidence is above threshold. |
| **2** | Stronger analyzer/planner | Complex, ambiguous, or high-risk requests | Richer analysis; more lanes proposed. `failOpenTriggered: false` if confident. |
| **3** | Fail-open / expanded context | Low confidence or high assessed risk | All protected lanes included. `failOpenTriggered: true`. `failOpenReason` required. |

### Confidence Thresholds (Illustrative `[FUTURE-ONLY]`)

| `analyzerConfidence` | `assessedRequestRiskLevel` | Outcome |
|---|---|---|
| ≥ 0.85 | `"low"` / `"medium"` | Proceed with analyzer proposal at Tier 1/2. |
| 0.60–0.84 | any | Escalate to Tier 2 or 3 based on risk. |
| < 0.60 | any | Trigger Tier 3 fail-open. Include all protected lanes. |
| any | `"high"` or `"critical"` | Trigger Tier 3 fail-open regardless of confidence score. |

---

## 6. Fail-Open Semantics (Non-Negotiable)

The following rules apply unconditionally to any future analyzer implementation:

1. **Low confidence = more context, not less.** A low `analyzerConfidence` score must expand lane inclusion, never reduce it.
2. **High risk = fail-open.** Any `assessedRequestRiskLevel` of `"high"` or `"critical"` triggers Tier 3 regardless of confidence.
3. **Protected lanes are inviolable.** `neededLanes` proposals cannot exclude safety, policy, durable constraints, or open commitments lanes.
4. **Proposals are inputs, not decisions.** All `AnalyzerOutput` fields enter the Conflict Resolver as additional `SelectionDecision`-equivalent inputs. They do not bypass the deterministic priority table (`docs/06` §11.4).
5. **No silent omission.** Any uncertainty must appear in the trace (`analyzerTraceId`, `evidence`, `failOpenReason`).

---

## 7. Integration with Existing MVP Pipeline

The future `AnalyzerOutput` enters the existing pipeline at a specific seam:

```
Request Input
   ↓
[Tier 0 Fast Path?] ──yes──> Deterministic Router only
   ↓ no
[Analyzer (Tier 1/2/3)]
   ↓
AnalyzerOutput (proposals)
   ↓
[Deterministic Guardrails Check]
   │  - Safety hard-protection enforced (docs/06 §8 Step 3)
   │  - Injection gate applied (docs/06 §17)
   │  - PromptFamilyValue validated against accepted enum
   ↓
[Conflict Resolver] ← receives AnalyzerOutput proposals + deterministic selector decisions
   ↓
[Budgeter → PPG → trace.json / prompt-plan.json]
```

**What does NOT change in this model:**
- `request-signals.schema.json` shape (no new fields added to it).
- `SelectionDecision` shape (owned by `docs/06` §4; `AnalyzerOutput` is a separate object).
- `ResolvedSelectionDecision` shape (owned by `docs/06` §11).
- Any existing MVP schemas, fixtures, or harness behavior.

---

## 8. Forbidden AnalyzerOutput Fields

Per `docs/13` §12, the following fields must **never** be added to any core schema:

| Field | Reason |
|---|---|
| `modelPrompt` | Provider-adapter concern, not core schema. |
| `modelResponse` | Provider-adapter concern. |
| `rawAnalyzerOutput` | Provider-adapter concern. |
| `providerCost` | Provider-adapter concern. |
| `providerCacheKey` | Provider-adapter concern; cache mechanics belong in adapters. |

---

## 9. Next Steps

This scoping document establishes the conceptual shape for Phase 3. Before any implementation proceeds:

1. A formal `analyzer-output.schema.json` requires its own **explicit schema decision pass** with canonical approval.
2. `PromptFamilyValue` enum extensions (if needed for new analyzer-surfaced families) require their own **explicit enum extension pass** against `docs/06` §2.2.
3. Trace extensions for analyzer output (`docs/13` §20) require **Phase 4** scoping.
