# Phase M2: Model-Assisted Selector — Implementation Scoping

## 1. Status and Authority

| Field | Value |
|---|---|
| **Document type** | Implementation Scoping (Phase M2) |
| **Created** | Phase M2 scoping pass |
| **Parent documents** | `docs/13` §7, §12, §16; `docs/19`; `docs/06` §8, §11.4; `docs/24` §3.5 |
| **MVP authority** | None — this document does not change any existing MVP schema, fixture, enum, or core pipeline module behavior. |
| **Implementation status** | Not implemented. This is the scoping specification that precedes M2 implementation passes. |
| **Dependencies completed** | Request Analyzer (Phase M1, `docs/25`), AnalyzerOutput schema (`schemas/future/analyzer-output.schema.json`), Analyzer Integrator (`src/core/analyzer-integrator.ts`), Model Selector Integrator (`src/core/model-selector-integrator.ts`), Runtime Provider Client (`packages/runtime/src/provider-client.ts`). |

---

## 2. Objective

Build the first **live Model-Assisted Fallback Selector** — a module that takes components which reached Step 8 of the Deterministic Ladder (insufficient evidence), calls a lightweight LLM, and produces structured `SelectionDecision` proposals for the Conflict Resolver.

This connects the Phase M1 Request Analyzer output to an intelligent component selection step:

```
[Phase M1: Request Analyzer]              [Phase M2: Model-Assisted Selector]
  packages/runtime/                         packages/runtime/
  request-analyzer.ts                       model-selector.ts  [NEW]
  (classifies request, produces             (calls LLM for unresolved
   AnalyzerOutput)                           components, produces
         │                                   SelectionDecision proposals)
         │                                          │
         ▼                                          ▼
  [ZAM Core Pipeline]                       [Existing Conflict Resolver]
  src/core/api.ts                           src/core/conflict-resolver.ts
  (receives analyzerOutput)                 (Priority 0–4 guardrails
                                             override any unsafe proposal)
```

After M2, the ZAM runtime will be able to:
1. Receive a user request.
2. Call the Analyzer to classify the request (Phase M1 — already working).
3. Run the deterministic selector ladder (Steps 1–7) for all components.
4. For components that reach Step 8 (no definitive evidence), call a lightweight model to propose `include`/`omit`/`defer`.
5. Feed the model proposals into the existing Conflict Resolver, where Priorities 0–4 enforce all safety guardrails.
6. The main model receives a **context-optimized prompt** — not a static full prompt or a blindly reduced one.

---

## 3. MVP Non-Interference Guarantee

This section is a hard contractual statement. Phase M2 does **not** authorize changes to:

| Protected artifact | Reason |
|---|---|
| `schemas/inputs/`, `schemas/outputs/`, `schemas/shared/`, `schemas/internal/` | MVP schemas are locked. |
| `fixtures/` (all 28 cases) | MVP fixture corpus is locked. |
| `tests/phase12/harness.test.ts` and `harness-checks.ts` | Gate B (651/651) is locked. |
| `src/core/conflict-resolver.ts` | Already complete and tested. Model proposals enter as inputs. |
| `src/core/model-selector-integrator.ts` | Already complete and tested (Phase P6). |
| `src/core/selector-engine.ts` | Already complete and tested (Phase 5). |
| `src/core/deterministic-ladder.ts` | Already complete and tested (Phase 5). |
| `src/core/api.ts` | Already accepts `analyzerOutput`. M2 integration is in the runtime turn-loop only. |
| `src/types/` (all MVP type definitions) | MVP types are locked. |

---

## 4. Resolution of Open Questions

### 4.1 OQ-2 (Schema Shape) — RESOLVED

**Decision:** The model will output a JSON array of objects matching the standard `SelectionDecision` shape from `docs/06` §4. No new `ProposalDecision` schema is needed.

**Rationale:** The existing `model-selector-integrator.ts` already accepts `ProposalDecision` records and converts them to `SelectionDecision` objects for the Conflict Resolver. The runtime Model-Assisted Selector will produce `ProposalDecision` records (matching `src/types/model-selector.ts`) which the existing integrator will process.

**Key constraints:**
- `selectorName` must be `"model_assisted_fallback"` for all proposals from this selector.
- `action` must be from the accepted enum: `include`, `omit`, `defer`.
- `confidence` must be `high`, `medium`, or `low`.
- `path` must be from the accepted SelectionPath enum values.
- `evidence[]` must be non-empty for `omit`/`defer` proposals.

### 4.2 OQ-7 (Confidence Thresholds) — RESOLVED

**Decision:** The Model-Assisted Selector uses the same confidence model as the Analyzer:
- Model proposals with `confidence: "low"` are **automatically overridden to `include`/`fail_open`** by the existing `model-selector-integrator.ts` (see `shouldOverrideToFailOpen()`).
- Model proposals with `confidence: "medium"` on `omit`/`defer` are passed through to the Conflict Resolver, which applies Priority 0–4 enforcement.
- Model proposals with `confidence: "high"` on `omit` are passed through, but can still be defeated by Priorities 0–4 (safety, user constraints, registry requirements, history durability).

**Fail-open invariant:** Low confidence always expands context, never reduces it. This is enforced by `model-selector-integrator.ts` at the integration layer, not by the selector itself.

### 4.3 IQ-M1 (Which Selectors?) — RESOLVED

**Decision:** Instead of replacing individual type-specific selectors, we create a single `ModelAssistedFallbackSelector` that runs **after** the deterministic ladder has completed for all components.

**How it works:**
1. The deterministic ladder (Steps 1–12 per `docs/06` §8) runs for every component as it does today.
2. After all deterministic decisions are collected, the runtime identifies components that landed on **Step 9 (`default_include`)**, **Step 11 (`fail_open`)**, or **Step 12 (`fail_open` final fallback)** — i.e., components where the deterministic ladder had insufficient evidence to make a confident `include` or `omit` decision and fell back to a default.
3. These "unresolved" components are sent to the Model-Assisted Fallback Selector for a second opinion.
4. The model's proposals are fed into the existing `model-selector-integrator.ts` → Conflict Resolver pipeline.
5. The deterministic Priority 0–4 guardrails enforce all safety invariants on the model's proposals.

**Why not Step 8 (Path B)?** Step 8 is a confident `omit` with full deterministic evidence — the model has nothing useful to add. The fallback selector only helps with components that _lack_ deterministic evidence.

**Activation switch:** The runtime checks `session.config.selector.enabled`. The core `deterministicOnly` flag in `selectorPolicy` remains `true` — the model-assisted selector runs in the runtime layer alongside the core, not inside the core ladder.

### 4.4 IQ-M2 (Model Choice) — RESOLVED

**Decision:** Use the runtime Provider Client, configured via a `selector` section in `runtime.config.json`:
- **Tier 1 (primary):** `google/gemini-3.1-flash-lite` — same lightweight model as the Analyzer.
- **Tier 2 (escalation, future):** `google/gemini-3-flash-preview` — for ambiguous components.

**Rationale:** Selector decisions are simpler than analyzer classifications (binary include/omit per component), so the same lightweight model suffices.

### 4.5 IQ-M3 (Prompt Structure) — RESOLVED

**Decision:** The Model-Assisted Selector prompt contains:

```
You are a context selection advisor for an AI agent runtime.

## Request Context
User request: "{requestText}"
Request classification: {promptFamily} (confidence: {analyzerConfidence})
Needed lanes: {neededLanes}
Risk level: {assessedRequestRiskLevel}

## Unresolved Components
The following components could not be decisively classified by the deterministic
selector. For each, decide whether to include, omit, or defer:

{JSON array of unresolved components with id, type, description, tags}

## Rules
- Return a JSON array of decisions.
- For each component, provide: componentId, action (include/omit/defer), 
  confidence (high/medium/low), path, reason, evidence[].
- When uncertain, prefer "include" (fail-open).
- Safety-critical, mandatory, and high-risk components should always be "include".
- Components not relevant to the current request type may be "omit" if you are confident.
```

**Output schema:** The model must return a JSON array matching the `ProposalDecision` shape from `src/types/model-selector.ts`. Invalid JSON or schema-invalid output is discarded entirely and all unresolved components fall back to their deterministic decisions (fail-open include).

### 4.6 IQ-M4 (Test Strategy) — RESOLVED

**Decision:** M2 unit tests will verify:

| Test category | What it verifies |
|---|---|
| Valid model output | JSON array of ProposalDecisions parsed and converted to SelectionDecisions. |
| Invalid/malformed JSON | Model returns garbage → fallback to deterministic decisions. No crash. |
| Empty proposals | Model returns `[]` → all components keep their deterministic decisions. |
| Low-confidence omit override | Model proposes `omit` with `confidence: "low"` → overridden to `include/fail_open` by integrator. |
| Safety defeat | Model proposes `omit` for a `retainPolicy: safety_critical` component → defeated by Priority 1 in Conflict Resolver. |
| User constraint defeat | Model proposes `omit` for an `alwaysInclude` component → defeated by Priority 2. |
| Timeout | Model call exceeds timeout → fallback to deterministic decisions. |
| Provider error | Provider throws → fallback to deterministic decisions. |
| Disabled selector | `selector.enabled: false` → no model call, deterministic decisions used as-is. |

---

## 5. Architecture: Runtime Integration Point

The Model-Assisted Selector runs in the **runtime layer** (`packages/runtime/`), not in the **core pipeline** (`src/core/`). This is critical:

```
┌─────────────────────────────────────────────────────────────┐
│                     Runtime Turn Loop                        │
│                  packages/runtime/turn-loop.ts                │
│                                                               │
│  1. User request arrives                                      │
│  2. Analyzer classifies request (M1) → AnalyzerOutput         │
│  3. Runtime calls ZAM core: plan(analyzerOutput)              │
│     ┌───────────────────────────────────────────────────────┐ │
│     │  ZAM Core (src/core/api.ts)                           │ │
│     │  Phase 2: Registry → Phase 3: Normalize →             │ │
│     │  Phase 4: Candidates → Phase 5: Selector Fan-Out →    │ │
│     │  Phase 6: Gap-Check → Phase 7: Injection Gate →       │ │
│     │  Phase 8: Conflict Resolver →                         │ │
│     │  Phase 9: Budgeter → Phase 10: PPG → Phase 11: Trace │ │
│     └───────────────────────────────────────────────────────┘ │
│  4. Runtime receives prompt-plan from ZAM core                │
│  5. ★ NEW: Model-Assisted Selector evaluates unresolved       │
│     components from the prompt-plan                           │
│  6. If model proposes changes, runtime calls ZAM core again   │
│     with modelSelectorOutputs attached                        │
│  7. Core re-runs pipeline with model proposals merged into     │
│     selector decisions → Conflict Resolver enforces safety    │
│  8. Runtime assembles final prompt from the governed plan      │
│  9. Main model call → response                                │
└─────────────────────────────────────────────────────────────┘
```

**Why two-pass?** The model-assisted selector needs the output of the deterministic ladder to know _which_ components are unresolved. The core runs first (deterministic-only), the runtime identifies unresolved components from the trace, calls the LLM, then optionally re-runs the core with model proposals attached. If no components are unresolved (or if the model has no changes), the second pass is skipped.

**Alternative (single-pass):** The core `api.ts` already accepts `modelSelectorOutputs` via `PipelineOptions`. If we can identify unresolved candidates _before_ the core runs (from the AnalyzerOutput's `neededLanes`), we could send speculative proposals. However, this is less accurate because we'd be guessing which components are unresolved. The two-pass approach is more precise and matches the `docs/19` architecture.

**Decision:** Use the **two-pass** approach for M2. It is safer, more accurate, and the latency of the second core run (local in-process) is negligible compared to the LLM call.

---

## 6. Configuration

### 6.1 `runtime.config.json` Addition

```json
"selector": {
  "enabled": true,
  "provider": {
    "name": "openrouter",
    "model": "google/gemini-3.1-flash-lite",
    "apiKeyEnvVar": "OPENROUTER_API_KEY"
  },
  "timeoutMs": 5000,
  "fallbackOnError": "deterministic"
}
```

### 6.2 TypeScript Config Type

The `selector` config type will be added to `packages/runtime/src/analyzer-config.ts` (renamed or extended to `model-config.ts`). It mirrors the `AnalyzerConfig` shape:

```typescript
export interface SelectorConfig {
  enabled: boolean;
  provider: ProviderConfig;
  timeoutMs: number;
  fallbackOnError: 'deterministic';
}
```

---

## 7. Fail-Open Safety Model

The Model-Assisted Selector has **three layers of fail-open protection**:

| Layer | Location | What it protects against |
|---|---|---|
| **Layer 1: Selector** | `packages/runtime/src/model-selector.ts` | LLM returns invalid JSON, timeout, provider error → return empty proposals (deterministic decisions stand). |
| **Layer 2: Integrator** | `src/core/model-selector-integrator.ts` | Low-confidence omit/defer proposals → overridden to `include/fail_open`. Empty evidence on omit/defer → overridden. Unknown componentIds → skipped with warning. |
| **Layer 3: Conflict Resolver** | `src/core/conflict-resolver.ts` | Priority 0 (runtime unavailable), Priority 1 (safety), Priority 2 (user constraints), Priority 3 (registry requirements), Priority 4 (history durability) → all unconditionally defeat any model `omit` proposal for protected components. |

**Invariant:** At no point can the Model-Assisted Selector cause a safety-critical, mandatory, or high-risk component to be omitted from the prompt. The three layers ensure this independently.

---

## 8. EventStream Recording

The runtime will record a `model_selector_completed` system event in the EventStream for each turn where the model-assisted selector runs:

```typescript
interface SelectorEventContent {
  selectorVersion: string;     // model name used
  unresolvedCount: number;     // how many components were sent to the model
  proposalCount: number;       // how many proposals the model returned
  changedCount: number;        // how many proposals differ from deterministic
  durationMs: number;          // wall-clock time for the LLM call
  fallbackUsed: boolean;       // true if the model call failed and fallback was used
  fallbackReason?: string;     // reason for fallback (timeout, parse error, etc.)
}
```

---

## 9. Phased Implementation Roadmap for M2

M2 is split into narrow, independently reviewable Coder passes:

| Pass | Scope | Files Created | Files Modified |
|---|---|---|---|
| **M2-A** | Selector config type + config loader extension | None | `packages/runtime/src/analyzer-config.ts` (add SelectorConfig), `packages/runtime/src/config.ts` (add selector section parsing), `packages/runtime/tests/config.test.ts` (add selector config tests) |
| **M2-B** | Selector prompt templates | `packages/runtime/src/selector-prompt.ts`, `packages/runtime/tests/selector-prompt.test.ts` | None |
| **M2-C** | Core selector module (LLM call + JSON parsing + error handling) | `packages/runtime/src/model-selector.ts`, `packages/runtime/tests/model-selector.test.ts` | None |
| **M2-D** | Turn loop integration + EventStream recording | None | `packages/runtime/src/turn-loop.ts` (add selector call after first plan), `packages/runtime/src/types.ts` (add SelectorEventContent) |
| **M2-E** | Live E2E verification (Sam-approved) | None | `runtime.config.json` (add selector section) |

Each pass is one Coder activation with review.

---

## 10. Identifying Unresolved Components

After the first `plan()` call returns a `CorePlanOutput`, the runtime inspects `trace.selectorPhase.selectorTrace` to find unresolved components:

**Unresolved criteria:** A component is "unresolved" if its `SelectionDecision` from the deterministic ladder has:
- `path: "default_include"` (Step 9 — no tag matched, defaulted to include)
- `path: "fail_open"` (Step 11/12 — insufficient evidence)

These components had no positive deterministic signal. The model-assisted selector can potentially improve the decision (e.g., omitting an irrelevant skill that defaulted to include).

**Excluded from unresolved set:**
- `path: "safety_override"` (Step 3) — deterministically protected, model cannot override.
- `path: "required_match"` (Step 5) — deterministically required.
- `path: "safe_to_omit_match"` (Step 7, Path A) — already has positive omit evidence.
- `path: "default_action_omit"` (Step 8, Path B) — already has positive omit evidence.
- `path: "runtime_unavailable"` — tool availability is a runtime fact, not a model opinion.
- `path: "conflict_include"` (Step 4) — registry conflict, not a model concern.

---

## 11. Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Model omits a safety-critical component | Safety rule violated | Priority 1 unconditionally defeats the proposal. Three-layer fail-open. |
| Model returns invalid JSON | No selector proposals generated | Fallback to deterministic decisions. Warning logged. No crash. |
| Model adds latency to every turn | User perceives slower response | Skip model selector if no components are unresolved. Timeout cap (5s). |
| Model cost accumulates | Provider bills increase | Use cheapest capable model (Flash-lite). Config flag to disable. |
| Two-pass core run wastes resources | Double computation | Second pass only if model proposes changes. Core runs in-process (< 50ms). |
| Model proposes action for unknown component | Invalid proposal | `model-selector-integrator.ts` skips unknown componentIds with warning. |

---

## 12. Decision Required From Sam

Before implementation begins, Sam should confirm:

### 12.1 Model Selection — PROPOSED
> **Selector model:** `google/gemini-3.1-flash-lite` (same as Analyzer Tier 1)
> Acceptable? Or should a different model be used?

### 12.2 Implementation Order — PROPOSED
> M2-A → M2-B → M2-C → M2-D → M2-E (config first, same pattern as M1).

### 12.3 Two-Pass Architecture — PROPOSED
> The runtime calls `plan()` twice per turn when unresolved components exist.
> The second call includes model selector proposals.
> Acceptable? Or should we use the single-pass speculative approach?

---

## 13. Summary

| Aspect | Decision |
|---|---|
| What M2 builds | A live model-assisted fallback selector that calls a lightweight LLM for components the deterministic ladder couldn't decisively classify. |
| Where it lives | `packages/runtime/src/model-selector.ts` (new file). |
| How it integrates | Produces `ModelSelectorOutput` → existing `model-selector-integrator.ts` → existing Conflict Resolver (Priority 0–4 enforce). |
| Safety model | Three-layer fail-open. Low confidence → include. Safety/user constraints → always enforced. Invalid output → deterministic fallback. |
| Model choice | Configurable via `runtime.config.json`. Same Tier 1 model as Analyzer. |
| MVP impact | Zero. No existing core file modified. All changes in `packages/runtime/`. |
| Fallback | Any selector failure → empty proposals → deterministic decisions (identical to current behavior). |
| Testing | Unit tests with mocked providers + live E2E with Sam approval. |

---
