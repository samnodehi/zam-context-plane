# Phase M1: Model-Assisted Request Analyzer — Implementation Scoping

## 1. Status and Authority

| Field | Value |
|---|---|
| **Document type** | Implementation Scoping (Phase M1) |
| **Created** | Phase M1 scoping pass |
| **Parent documents** | `docs/13` §7–§9, `docs/15`, `docs/22`, `docs/24` §3.5 |
| **MVP authority** | None — this document does not change any existing MVP schema, fixture, enum, or core pipeline module. |
| **Implementation status** | Not implemented. This is the scoping specification that precedes implementation passes. |
| **Dependencies completed** | AnalyzerOutput schema (`schemas/future/analyzer-output.schema.json`), AnalyzerOutput TS type (`src/types/analyzer.ts`), Analyzer Integrator (`src/core/analyzer-integrator.ts`), Runtime Provider Client (`packages/runtime/src/provider-client.ts`), Core Library API accepting `analyzerOutput` (`src/core/api.ts`). |

---

## 2. Objective

Build the first **live model-assisted Request Analyzer** — a module that takes a user request, calls a lightweight LLM, and produces a structured `AnalyzerOutput` object (as defined in `docs/15` §4 and `schemas/future/analyzer-output.schema.json`).

This connects two existing but currently disconnected systems:

```
[Runtime Provider Client]          [Core AnalyzerOutput Pipeline]
  packages/runtime/                  src/core/
  provider-client.ts      ──────►   analyzer-integrator.ts
  (calls real LLMs)                  (converts AnalyzerOutput →
                                      SelectionDecision + TraceEntry)
```

After M1, the ZAM runtime will be able to:
1. Receive a user request.
2. Call a lightweight model to classify the request (Tier 0/1/2/3).
3. Produce a validated `AnalyzerOutput`.
4. Feed it into the existing `integrateAnalyzerOutput()` → Conflict Resolver → Budgeter → PPG pipeline.
5. The main model then receives a **context-governed prompt** — not a static full prompt.

---

## 3. MVP Non-Interference Guarantee

This section is a hard contractual statement. Phase M1 does **not** authorize changes to:

| Protected artifact | Reason |
|---|---|
| `schemas/inputs/`, `schemas/outputs/`, `schemas/shared/`, `schemas/internal/` | MVP schemas are locked. |
| `fixtures/` (all 28 cases) | MVP fixture corpus is locked. |
| `tests/phase12/harness.test.ts` and `harness-checks.ts` | Gate B (651/651) is locked. |
| `src/core/analyzer-integrator.ts` | Already complete and tested. |
| `src/core/api.ts` (`plan()` / `runCorePipeline()`) | Already accepts `analyzerOutput`. |
| `src/types/analyzer.ts` (`AnalyzerOutput` interface) | Already complete. |
| `docs/04`, `docs/05`, `docs/06`, `docs/11`, `docs/12`, `docs/13` | Canonical MVP specs. |
| `packages/runtime/src/provider-client.ts` | Phase R5 is complete. |
| `packages/runtime/src/turn-loop.ts` | Phase R6 is complete. |

**What M1 creates:** New, isolated modules only. No existing file is modified.

---

## 4. Architecture: Where the Analyzer Fits

### 4.1 Current Flow (Without Analyzer)

```
User Request
    ↓
[Runtime Turn Loop]
    ↓
[ZAM Core plan()]  ← analyzerOutput: null
    ↓
[Deterministic Router] → requestSignals
    ↓
[Selector Ladder] → SelectionDecisions (deterministic only)
    ↓
[Conflict Resolver → Budgeter → PPG]
    ↓
prompt-plan.json → [Prompt Assembler] → [Provider Chat] → Model Response
```

### 4.2 Future Flow (With M1 Analyzer)

```
User Request
    ↓
[Analyzer Module]  ← NEW (Phase M1)
    │  Calls lightweight LLM
    │  Produces AnalyzerOutput
    │  Validates against schema
    ↓
[Runtime Turn Loop]
    ↓
[ZAM Core plan()]  ← analyzerOutput: AnalyzerOutput (populated)
    ↓
[Deterministic Router] → requestSignals
[Analyzer Integrator]  → SelectionDecisions (model-assisted, advisory)
    ↓
[Conflict Resolver] ← receives BOTH deterministic + model-assisted decisions
    ↓                  Deterministic priority table (docs/06 §11.4) resolves
[Budgeter → PPG]
    ↓
prompt-plan.json → [Prompt Assembler] → [Provider Chat] → Model Response
```

### 4.3 Key Safety Invariant

The analyzer's output is **advisory only**. It enters the existing pipeline through `integrateAnalyzerOutput()` (already implemented in `src/core/analyzer-integrator.ts`), which converts it into synthetic `SelectionDecision` records with `path: 'fail_open'` and `selectorName: 'model_assisted_analyzer'`. These decisions enter the Conflict Resolver alongside deterministic decisions, and the deterministic priority table (`docs/06` §11.4) remains the **sole final authority**.

---

## 5. Model Selection Strategy

### 5.1 Design Principles

The analyzer model must be:

| Requirement | Rationale |
|---|---|
| **Lightweight** | Runs before every main model call. Must not add significant latency. |
| **Cheap** | Called on every turn. Cost per call must be negligible compared to the main model. |
| **Fast** | Target: < 500ms response time for Tier 1 requests. |
| **Structured output capable** | Must produce valid JSON matching `AnalyzerOutput` schema. |
| **Provider-agnostic** | Must work through the existing `ProviderClient` abstraction. |

### 5.2 Recommended Models (Tier 1 — Lightweight Analyzer)

| Model | Provider | Notes |
|---|---|---|
| **`google/gemini-3.1-flash-lite`** | OpenRouter | **✅ Selected by Sam.** Ultra-lightweight, fastest, cheapest. Ideal for request classification. |

### 5.3 Selected Model (Tier 2 — Stronger Analyzer)

For complex or ambiguous requests where Tier 1 confidence is below threshold:

| Model | Provider | Notes |
|---|---|---|
| **`google/gemini-3-flash-preview`** | OpenRouter | **✅ Selected by Sam.** Stronger reasoning than Flash Lite, still fast and affordable. |

### 5.4 Configuration Structure

The analyzer model is configured separately from the main model in `runtime.config.json`:

```json
{
  "zam": {
    "endpoint": "library"
  },
  "provider": {
    "name": "openrouter",
    "model": "x-ai/grok-4.3",
    "apiKeyEnvVar": "OPENROUTER_API_KEY"
  },
  "analyzer": {
    "enabled": true,
    "provider": {
      "name": "openrouter",
      "model": "google/gemini-3.1-flash-lite",
      "apiKeyEnvVar": "OPENROUTER_API_KEY"
    },
    "tier2Model": "google/gemini-3-flash-preview",
    "confidenceThreshold": 0.85,
    "tier2ConfidenceThreshold": 0.60,
    "timeoutMs": 5000,
    "fallbackOnError": "deterministic"
  },
  "workspace": { "mode": "local", "rootPath": "." },
  "loop": { "maxTurns": 5, "timeoutMs": 120000 },
  "eventStream": { "persistPath": "./sessions" }
}
```

**Key design decisions:**

1. **`analyzer.enabled`**: Boolean flag. When `false`, the analyzer is bypassed entirely and the pipeline uses deterministic-only routing (current behavior). Default: `false` (opt-in).
2. **`analyzer.provider`**: Separate provider config from the main model. The analyzer can use a different (cheaper) model, or even a different provider.
3. **`analyzer.tier2Model`**: Optional stronger model for Tier 2 escalation. If absent, Tier 2 uses the same model as Tier 1 with a richer prompt.
4. **`analyzer.confidenceThreshold`**: Float 0.0–1.0. Below this, escalate to Tier 2. Default: `0.85`.
5. **`analyzer.tier2ConfidenceThreshold`**: Below this, trigger Tier 3 fail-open. Default: `0.60`.
6. **`analyzer.timeoutMs`**: Maximum time to wait for the analyzer response. On timeout, fall back to deterministic routing. Default: `5000`.
7. **`analyzer.fallbackOnError`**: What to do if the analyzer call fails. `"deterministic"` = use deterministic router only (fail-safe). This is the only accepted value in M1.

### 5.5 Provider Reuse

The analyzer uses the same `ProviderClient` infrastructure built in Phase R4. No new provider client is created. The analyzer creates its own `ProviderClient` instance configured with the `analyzer.provider` settings.

---

## 6. Analyzer Module Design

### 6.1 Module Location and Interface

**New file:** `packages/runtime/src/request-analyzer.ts`

```typescript
import type { AnalyzerOutput } from '../../src/types/analyzer.js';

export interface AnalyzerConfig {
  enabled: boolean;
  provider: {
    name: string;
    model: string;
    apiKeyEnvVar: string;
  };
  tier2Model?: string;
  confidenceThreshold: number;
  tier2ConfidenceThreshold: number;
  timeoutMs: number;
  fallbackOnError: 'deterministic';
}

export interface AnalyzerResult {
  output: AnalyzerOutput | null;  // null = analyzer disabled or failed
  tier: 0 | 1 | 2 | 3;
  durationMs: number;
  fallbackUsed: boolean;
  fallbackReason?: string;
}

/**
 * Analyze a user request using a lightweight model.
 * Returns a validated AnalyzerOutput or null if the analyzer is
 * disabled, timed out, or encountered an error.
 *
 * Safety invariant: On ANY error, returns null (fallback to deterministic).
 * The caller passes null to plan() which means deterministic-only routing.
 */
export async function analyzeRequest(
  requestText: string,
  config: AnalyzerConfig,
): Promise<AnalyzerResult>;
```

### 6.2 Tier 0 Fast Path (Deterministic, No LLM Call)

Before calling any model, the analyzer checks if the request matches simple patterns that don't need semantic analysis:

| Pattern | Examples | Result |
|---|---|---|
| Greeting | "Hello", "Hi", "Hey" | `tier: 0`, `promptFamily: 'simple_greeting'` |
| Acknowledgement | "Thanks", "OK", "Got it" | `tier: 0`, `promptFamily: 'simple_greeting'` |
| Empty/whitespace | "", "   " | `tier: 0`, `promptFamily: 'general_default'` |

Tier 0 produces a hardcoded `AnalyzerOutput` without calling any LLM. This preserves the "deterministic fast path" principle from `docs/13` §8 and `docs/15` §5.

### 6.3 Tier 1 Prompt Template

The Tier 1 analyzer prompt instructs the lightweight model to classify the request:

```
You are a request classifier for an AI agent context governance system.

Analyze the following user request and produce a structured JSON classification.

## User Request
{requestText}

## Output Format (JSON)
Respond with ONLY a JSON object matching this exact schema:
{
  "promptFamily": "<one of: general_default, simple_greeting, coding_build_debug, research_investigation, ops_security_change_risk, lifecycle_internal, heartbeat_proactive, group_chat_behavior, tool_use_required, history_sensitive>",
  "requestType": "<broad category: greeting, coding, research, ops, lifecycle, conversation>",
  "taskType": "<specific: debug, refactor, review, continuation, explain, create, deploy, other>",
  "analyzerConfidence": <float 0.0-1.0>,
  "assessedRequestRiskLevel": "<low, medium, high, critical>",
  "neededLanes": [<list of relevant lanes from: scaffold, project_rules, policy_safety, skills, tools, memory, history, files, output_format, runtime_capabilities>],
  "requiresHistory": <true/false>,
  "requiresTools": <true/false>,
  "requiresFiles": <true/false>,
  "evidence": [<list of textual signals you used>]
}

## Classification Rules
1. If the request is a simple greeting or acknowledgement, use promptFamily "simple_greeting".
2. If the request involves code (writing, debugging, reviewing), use "coding_build_debug".
3. If the request involves research or explanation, use "research_investigation".
4. If the request involves deployment, security, or infrastructure changes, use "ops_security_change_risk".
5. If the request references previous conversation ("continue", "fix that", "as before"), set requiresHistory to true and consider "history_sensitive".
6. If the request requires executing commands or file operations, set requiresTools to true.
7. For neededLanes, include only the lanes that are genuinely needed. Be conservative — include rather than exclude when uncertain.
8. Set analyzerConfidence to reflect your actual confidence. Use < 0.6 if the request is genuinely ambiguous.

Respond with ONLY the JSON object. No explanation, no markdown.
```

### 6.4 Response Parsing and Validation

After receiving the model's response:

1. **Parse JSON**: Extract JSON from the response. Handle common model quirks (markdown code fences, trailing text).
2. **Schema validate**: Validate against the AJV-compiled `analyzer-output.schema.json`.
3. **Enforce fail-open invariants**:
   - If `analyzerConfidence < tier2ConfidenceThreshold` → set `failOpenTriggered: true`.
   - If `assessedRequestRiskLevel` is `"high"` or `"critical"` → set `failOpenTriggered: true`.
4. **Add metadata**: Set `analyzerVersion`, `analyzerTraceId` (UUID), `tier`.
5. **Return**: The validated `AnalyzerOutput` or `null` on any validation failure.

### 6.5 Tier 2 Escalation

If Tier 1 returns `analyzerConfidence` between `tier2ConfidenceThreshold` and `confidenceThreshold`:

1. Use `tier2Model` (or the same Tier 1 model with an enriched prompt).
2. The Tier 2 prompt includes the Tier 1 result for context: "A lightweight classifier classified this request as X with confidence Y. Please provide a more detailed analysis."
3. Tier 2 output replaces Tier 1 output.

If Tier 2 still reports confidence below `tier2ConfidenceThreshold`, Tier 3 fail-open is triggered.

### 6.6 Error Handling

| Error condition | Behavior |
|---|---|
| Model call timeout | Return `null` (deterministic fallback). Log warning. |
| Model returns non-JSON | Return `null`. Log warning. |
| JSON fails schema validation | Return `null`. Log warning. |
| Provider API error (rate limit, 500) | Return `null`. Log warning. |
| `analyzer.enabled: false` | Return `null` immediately. No call made. |
| Unknown provider name | Return `null`. Log error. |

**Core safety principle**: The analyzer can never block the main pipeline. Any failure results in `null`, which means the core pipeline uses deterministic-only routing — identical to current behavior.

---

## 7. Integration with Runtime Turn Loop

### 7.1 Where the Analyzer is Called

The analyzer runs **once per turn**, before calling `plan()`:

```typescript
// In turn-loop.ts (conceptual — actual integration is a separate pass)

// Step 1: Analyze the request (if enabled)
const analyzerResult = await analyzeRequest(request.text, config.analyzer);

// Step 2: Call ZAM core plan() with the analyzer output
const planOutput = zamClient.plan({
  request: { text: request.text },
  registry: registry,
  analyzerOutput: analyzerResult.output,  // null if disabled/failed
  // ... other inputs
});

// Step 3: Assemble prompt and call main model
// (unchanged from current flow)
```

### 7.2 EventStream Recording

A new `EventStreamEntry` type records analyzer activity:

```typescript
export interface AnalyzerEventContent {
  analyzerVersion: string;
  tier: number;
  promptFamily: string;
  analyzerConfidence: number;
  durationMs: number;
  failbackUsed: boolean;
  failbackReason?: string;
}
```

This is recorded as a `system_event` with `event: 'analyzer_completed'` in the EventStream for audit trail purposes.

---

## 8. New Files Created by M1

| File | Purpose |
|---|---|
| `packages/runtime/src/request-analyzer.ts` | Core analyzer module: Tier 0 fast path, Tier 1/2 LLM calls, response parsing, schema validation, error handling. |
| `packages/runtime/src/analyzer-prompt.ts` | Prompt templates for Tier 1 and Tier 2 analyzer calls. Separated from logic for testability and future prompt iteration. |
| `packages/runtime/tests/request-analyzer.test.ts` | Unit tests: Tier 0 patterns, JSON parsing, schema validation, error handling, timeout simulation, fail-open enforcement. Uses mocked provider (no real LLM calls in tests). |
| `packages/runtime/tests/analyzer-prompt.test.ts` | Unit tests: Prompt template correctness, variable interpolation, schema reference integrity. |

**No existing files are modified in M1 implementation passes.**

---

## 9. Verification Plan

### 9.1 Unit Tests (Mocked Provider)

| Test category | What it verifies |
|---|---|
| Tier 0 fast path | Greetings, acknowledgements bypass LLM. Returns hardcoded AnalyzerOutput. |
| Tier 1 happy path | Mocked model returns valid JSON → valid AnalyzerOutput produced. |
| Tier 1 malformed JSON | Mocked model returns garbage → `null` returned, warning logged. |
| Tier 1 schema validation failure | Mocked model returns JSON missing required fields → `null` returned. |
| Tier 2 escalation | Confidence below threshold → Tier 2 model called with enriched prompt. |
| Tier 3 fail-open | Low confidence or high risk → `failOpenTriggered: true`. |
| Timeout handling | Mocked provider delays beyond `timeoutMs` → `null` returned. |
| Provider error | Mocked provider throws → `null` returned, no crash. |
| Disabled analyzer | `enabled: false` → `null` returned immediately, no provider call. |
| PromptFamily validation | Output `promptFamily` must be from accepted enum values. |
| Confidence mapping | Float confidence correctly maps to `high`/`medium`/`low`. |
| Fail-open invariants | High/critical risk always triggers fail-open regardless of confidence. |

### 9.2 Integration Test (Live, Sam-Approved)

After unit tests pass, with Sam's explicit approval:

```bash
node packages/runtime/dist/cli/index.js run "Please list the files in the src directory." \
  --analyzer-enabled
```

Verify:
1. Analyzer calls lightweight model (check EventStream for `analyzer_completed` event).
2. AnalyzerOutput is produced and passed to `plan()`.
3. Main model receives a context-governed prompt (not static full context).
4. Final response is correct.

### 9.3 MVP Baseline Verification

After M1 implementation:
- `vitest run` from root → 651/651 MVP tests still pass.
- `vitest run packages/runtime` → all runtime tests pass.
- No changes to `fixtures/`, `schemas/outputs/`, `schemas/inputs/`, `schemas/shared/`, `tests/phase12/`.

---

## 10. Phased Implementation Roadmap for M1

M1 is split into narrow, independently reviewable Coder passes:

| Pass | Scope | Files Created | Files Modified |
|---|---|---|---|
| **M1-A** | Analyzer config type + config loader extension | `packages/runtime/src/analyzer-config.ts` | `packages/runtime/src/config.ts` (add analyzer section parsing) |
| **M1-B** | Analyzer prompt templates | `packages/runtime/src/analyzer-prompt.ts`, `packages/runtime/tests/analyzer-prompt.test.ts` | None |
| **M1-C** | Core analyzer module (Tier 0/1/2/3 + error handling) | `packages/runtime/src/request-analyzer.ts`, `packages/runtime/tests/request-analyzer.test.ts` | None |
| **M1-D** | Turn loop integration + EventStream recording | None | `packages/runtime/src/turn-loop.ts` (add analyzer call before plan), `packages/runtime/src/types.ts` (add AnalyzerEventContent) |
| **M1-E** | Live E2E verification (Sam-approved) | None | `runtime.config.json` (add analyzer section) |

Each pass is one Coder activation with review.

---

## 11. Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Analyzer model produces invalid JSON | Main pipeline falls back to deterministic. No user impact. | Robust JSON parsing with fallback. Logged warning. |
| Analyzer adds latency to every turn | User perceives slower response. | Tier 0 fast path for trivial requests. Timeout cap (5s default). Async implementation possible in future. |
| Analyzer cost accumulates | Provider bills increase. | Use cheapest capable model (Flash-tier). Cost tracked via EventStream. Config flag to disable. |
| Analyzer misclassifies request | Wrong context included/excluded. | All proposals are advisory. Deterministic guardrails enforce safety. Fail-open on low confidence. |
| Analyzer prompt leaks sensitive info | Request text sent to analyzer model. | Analyzer model is the same provider as the main model — no additional trust boundary crossed. |
| Analyzer model halluccinates new promptFamily values | Invalid enum value enters pipeline. | Schema validation rejects unknown values. Returns `null` on validation failure. |

---

## 12. Decision Required From Sam

Before implementation begins, Sam should confirm:

### 12.1 Model Selection — ✅ DECIDED
> **Tier 1 (lightweight analyzer):** `google/gemini-3.1-flash-lite` (Sam's choice)
> **Tier 2 (stronger analyzer):** `google/gemini-3-flash-preview` (Sam's choice)
> **Main model:** `x-ai/grok-4.3` (unchanged)
> **Future:** Models and providers must be configurable via UI settings (post-M1).

### 12.2 Implementation Order — ✅ DECIDED
> M1-A → M1-B → M1-C → M1-D → M1-E (config first). Approved by Sam.

### 12.3 Scope Confirmation — ✅ DECIDED
> Scope confirmed by Sam. M1 covers analyzer only (no compressor, no UI, no model-assisted selector).

---

## 13. Summary

| Aspect | Decision |
|---|---|
| What M1 builds | A live model-assisted Request Analyzer that calls a lightweight LLM and produces structured `AnalyzerOutput`. |
| Where it lives | `packages/runtime/src/request-analyzer.ts` (new file). |
| How it integrates | Produces `AnalyzerOutput` → passed to existing `plan(analyzerOutput)` → `integrateAnalyzerOutput()` → Conflict Resolver. |
| Safety model | Advisory only. Deterministic guardrails enforce. Fail-open on error/uncertainty. |
| Model choice | Configurable via `runtime.config.json`. Tier 1: lightweight (Flash-tier). Tier 2: stronger model for ambiguous requests. |
| MVP impact | Zero. No existing file modified except `config.ts` (add new section) and `turn-loop.ts` (call analyzer before plan). |
| Fallback | Any analyzer failure → `null` → deterministic-only routing (identical to current behavior). |
| Testing | Unit tests with mocked providers + live E2E with Sam approval. |

---

*This document is the scoping specification for Phase M1. Implementation is not authorized until Sam approves the scope and answers the decisions in §12.*
