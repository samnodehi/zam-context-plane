# Phase M3: Model-Assisted History Compressor — Implementation Scoping

## 1. Status and Authority

| Field | Value |
|---|---|
| **Document type** | Implementation Scoping (Phase M3) |
| **Created** | Phase M3 scoping pass |
| **Parent documents** | `docs/13` §10, §13; `docs/14`; `docs/16` §6.2; `docs/24` §3.3, §4.3 |
| **MVP authority** | None — this document does not change any existing MVP schema, fixture, enum, or core pipeline module behavior. |
| **Implementation status** | Not implemented. This is the scoping specification that precedes M3 implementation passes. |
| **Dependencies completed** | Request Analyzer (Phase M1, `docs/25`), Model-Assisted Selector (Phase M2, `docs/26`), `history-compressor-output.schema.json` (FUTURE-ONLY, already exists in `schemas/inputs/`), `summaryPhase` trace shape (FUTURE-ONLY, defined in `docs/16` §6.2), Runtime History State Builder (`packages/runtime/src/history-state-builder.ts`), Runtime Prompt Assembler (`packages/runtime/src/prompt-assembler.ts`). |

---

## 2. Objective

Build the first **live Model-Assisted History Compressor** — a module that takes the raw conversation history from the EventStream, calls a model to extract structured state, and produces a validated `HistoryCompressorOutput` object conforming to the existing `schemas/inputs/history-compressor-output.schema.json`.

This solves a critical scaling problem in multi-turn sessions:

```
[Problem: Raw History Growth]
  Turn  1:   ~500 tokens of history
  Turn  5:  ~3,000 tokens of history
  Turn 10:  ~8,000 tokens of history
  Turn 20: ~20,000 tokens of history  ← exceeds many context budgets

[Solution: Structured State Extraction + Raw Window]
  Turn  1: No compression needed (below threshold)
  Turn  5: No compression needed (below threshold)
  Turn 10: ~1,500 structured summary + ~1,500 raw window = ~3,000 tokens
  Turn 20: ~2,000 structured summary + ~1,500 raw window = ~3,500 tokens
```

The compressor connects two existing subsystems:

```
[Runtime EventStream]                    [ZAM Core Pipeline]
  packages/runtime/                        src/core/
  event-stream.ts                          api.ts → plan()
  (stores raw conversation               (accepts history input
   turn by turn)                           for context governance)
         │                                        ▲
         ▼                                        │
[History Compressor]  ← NEW (Phase M3)            │
  packages/runtime/                               │
  history-compressor.ts                            │
  (calls model to extract                         │
   structured state;                              │
   produces HistoryCompressorOutput)     ─────────┘
```

After M3, the ZAM runtime will be able to:
1. Monitor session history growth across turns.
2. When the raw history exceeds a configurable token threshold, call a model to compress it.
3. Produce a validated `HistoryCompressorOutput` containing 11 structured state categories.
4. Pair the structured summary with a configurable window of recent raw turns.
5. Feed the compressed history into `plan()`, reducing prompt tokens while preserving all safety-critical state.

---

## 3. MVP Non-Interference Guarantee

This section is a hard contractual statement. Phase M3 does **not** authorize changes to:

| Protected artifact | Reason |
|---|---|
| `schemas/inputs/`, `schemas/outputs/`, `schemas/shared/`, `schemas/internal/` | MVP schemas are locked. (`history-compressor-output.schema.json` is already FUTURE-ONLY and will not be modified.) |
| `fixtures/` (all 28 cases) | MVP fixture corpus is locked. |
| `tests/phase12/harness.test.ts` and `harness-checks.ts` | Gate B (651/651) is locked. |
| `src/core/` (all core pipeline modules) | Core pipeline is complete and tested. The compressor lives in the runtime layer. |
| `src/types/` (all MVP type definitions) | MVP types are locked. |
| `docs/04`, `docs/05`, `docs/06`, `docs/11`, `docs/12`, `docs/13` | Canonical MVP specs. |
| `packages/runtime/src/turn-loop.ts` | M3 will modify this file ONLY to add the compressor call. All other turn-loop logic is untouched. |
| `packages/runtime/src/history-state-builder.ts` | Will be modified to accept compressed history as an alternative input source. |

**What M3 creates:** Primarily new, isolated modules. Only `turn-loop.ts` and `history-state-builder.ts` receive narrow modifications to integrate the compressor.

---

## 4. Core Principle: Structured State Extraction, Not Paragraph Summarization

```
The History Compressor is a structured state extractor, not a paragraph summarizer.
```

This is the single most important design principle (from `docs/13` §10). A paragraph summary is dangerous because it can:

- Omit recent user instructions.
- Distort accepted decisions or commitments.
- Lose nuance about failure modes and rejected approaches.
- Drop durable constraints established mid-conversation.
- Miss continuation references the user assumes are still in context.

The compressor must extract state into 11 discrete, structured categories — each independently verifiable, each with clear retention/omission rules.

---

## 5. The 11 State Extraction Categories

These are defined by `schemas/inputs/history-compressor-output.schema.json` (already exists) and `docs/13` §10:

| # | Category | Protection | Description |
|---|---|---|---|
| 1 | `currentTaskState` | **Protected** | Active task, current goal, blockers, progress notes. |
| 2 | `acceptedDecisions` | **Protected** | Decisions explicitly accepted during the session. Cannot be re-litigated. |
| 3 | `openIssues` | Compressible | Unresolved problems identified but not yet addressed. |
| 4 | `openCommitments` | **Protected** (`dropAllowed: false`) | Promises, agreements, pending deliverables. Aligned with `docs/04` §7.6. |
| 5 | `userConstraints` | **Protected** | User-stated requirements and preferences. Aligned with `docs/06` §2.8. |
| 6 | `importantFilesPaths` | Compressible | Files and paths referenced during the session. |
| 7 | `failedAttempts` | Compressible | Approaches tried and rejected, with reasons. |
| 8 | `activeWarnings` | Compressible | Active warnings and risk flags. |
| 9 | `antiRegressionRules` | **Protected** | Hard lessons from the session. `docs/13` §13 lifecycle metadata. |
| 10 | `durableFacts` | Semi-protected | Long-lived factual context. Aligned with `durable_facts` lane. |
| 11 | `recentRawTurnWindow` | **Raw turns alongside summary** | Configuration and metadata for the raw turn window. Actual raw turns are injected separately. |

**Protected categories** must **never** be omitted by the compressor. They must appear in `protectedCategoriesRetained[]` and must **not** appear in `summaryPhase.omitted[]`. This is a zero-tolerance constraint from `docs/14` §4.

---

## 6. Architecture: Where the Compressor Fits

### 6.1 Current Flow (Without Compressor)

```
User Request (Turn N)
    ↓
[History State Builder]
    Reads ALL entries from EventStream
    Builds recent_raw_turns (ALL user/assistant messages)
    Builds open_commitments (ALL tool calls/results)
    → Full raw history passed to plan()
    ↓
[ZAM Core plan()]
    ↓
[Prompt Assembler]
    Injects ALL history entries as provider messages
    → Growing prompt every turn
```

### 6.2 Future Flow (With M3 Compressor)

```
User Request (Turn N)
    ↓
[Compressor Activation Check]
    Is compression enabled?
    Does raw history exceed token threshold?
    If NO → use current flow (no change)
    If YES ↓
    ↓
[History Compressor Module]  ← NEW (Phase M3)
    Reads all EventStream entries
    Calls lightweight LLM with structured extraction prompt
    Receives structured JSON
    Validates against history-compressor-output.schema.json
    Produces HistoryCompressorOutput
    ↓
[History State Builder] (modified)
    Receives HistoryCompressorOutput
    Builds history object with:
      - Structured summary as a system-level component
      - Recent raw turn window (last N turns)
      - Open commitments (always raw, dropAllowed: false)
    → Compressed history passed to plan()
    ↓
[ZAM Core plan()]
    ↓
[Prompt Assembler]
    System components + structured summary + recent raw turns
    → Bounded prompt size regardless of session length
```

### 6.3 Key Integration Decision: When to Compress

Compression is triggered when **all** of these conditions are true:

1. `compressor.enabled: true` in `runtime.config.json`.
2. Total raw history token count exceeds `compressor.tokenThreshold` (default: 4000).
3. The session has more than `compressor.minTurnsBeforeCompression` turns (default: 6).

Below the threshold, raw history is used as-is (current behavior). This ensures short sessions have zero overhead.

### 6.4 Compression Frequency

The compressor does **not** run on every turn. It runs when the raw history exceeds the token threshold. Once compressed, the structured summary is cached in the `Session` object and reused for subsequent turns until one of:

- The session accumulates `compressor.recompressionTurnInterval` new turns since the last compression (default: 5).
- A tool error or significant state change invalidates the cached summary (advisory, not enforced in M3).

This avoids calling the LLM model on every turn after the first compression.

---

## 7. Model Selection Strategy

### 7.1 Design Principles

The compressor model must be:

| Requirement | Rationale |
|---|---|
| **Strong enough for state extraction** | Must understand conversation context, distinguish decisions from discussion, identify constraints vs. casual mentions. |
| **Structured output capable** | Must produce valid JSON matching the 11-category schema with >20 required fields. |
| **Cost-effective** | Runs once every N turns (not every turn). Can afford a slightly stronger model than the Analyzer. |
| **Fast** | Target: < 8s response time. Longer than Analyzer (500ms) because input is larger and output is more complex. |
| **Provider-agnostic** | Must work through the existing `ProviderClient` abstraction. |

### 7.2 Recommended Models

| Model | Provider | Notes |
|---|---|---|
| **Tier 1: `google/gemini-3.1-flash-lite`** | OpenRouter | Same as Analyzer/Selector. Fast and cheap. Suitable for sessions with clear, structured conversations. |
| **Tier 2: `google/gemini-3-flash-preview`** | OpenRouter | Stronger reasoning. Used when Tier 1 confidence is below threshold or when session history is complex (many tool results, conflicting decisions). |

### 7.3 Configuration Structure

```json
{
  "compressor": {
    "enabled": true,
    "provider": {
      "name": "openrouter",
      "model": "google/gemini-3.1-flash-lite",
      "apiKeyEnvVar": "OPENROUTER_API_KEY"
    },
    "tier2Model": "google/gemini-3-flash-preview",
    "tokenThreshold": 4000,
    "minTurnsBeforeCompression": 6,
    "recompressionTurnInterval": 5,
    "rawWindowSize": 6,
    "confidenceThreshold": 0.75,
    "timeoutMs": 15000,
    "fallbackOnError": "raw_history"
  }
}
```

**Key design decisions:**

1. **`compressor.enabled`**: Boolean flag. When `false`, raw history is always used (current behavior). Default: `false` (opt-in).
2. **`compressor.tokenThreshold`**: Approximate token count above which compression activates. Default: `4000`.
3. **`compressor.minTurnsBeforeCompression`**: Minimum completed turns before compression can activate. Prevents compressing tiny sessions. Default: `6`.
4. **`compressor.recompressionTurnInterval`**: Number of new turns after last compression before re-compressing. Default: `5`.
5. **`compressor.rawWindowSize`**: Number of most recent raw turns to include alongside the structured summary. Default: `6`.
6. **`compressor.confidenceThreshold`**: Below this, trigger fail-open (include more raw history). Default: `0.75`.
7. **`compressor.timeoutMs`**: Maximum time for the compressor LLM call. Default: `15000` (15s — larger input than Analyzer/Selector).
8. **`compressor.fallbackOnError`**: What to do if the compressor fails. `"raw_history"` = use full raw history (current behavior). This is the only accepted value in M3.

---

## 8. Compressor Module Design

### 8.1 Module Location and Interface

**New file:** `packages/runtime/src/history-compressor.ts`

```typescript
export interface CompressorConfig {
  enabled: boolean;
  provider: ProviderConfig;
  tier2Model?: string;
  tokenThreshold: number;
  minTurnsBeforeCompression: number;
  recompressionTurnInterval: number;
  rawWindowSize: number;
  confidenceThreshold: number;
  timeoutMs: number;
  fallbackOnError: 'raw_history';
}

export interface CompressorResult {
  output: HistoryCompressorOutput | null;  // null = disabled, below threshold, or failed
  compressed: boolean;                      // true if compression was applied
  rawTurnWindow: EventStreamEntry[];        // recent raw turns to pair with summary
  durationMs: number;
  fallbackUsed: boolean;
  fallbackReason?: string;
  tokensSaved: number;                      // estimated tokens saved by compression
}

/**
 * Compress session history into a structured state summary.
 * Returns a validated HistoryCompressorOutput or null if compression
 * is not needed or fails.
 *
 * Safety invariant: On ANY error, returns null (raw history fallback).
 * The caller uses raw history exactly as it does today — no behavior change.
 */
export async function compressHistory(
  entries: EventStreamEntry[],
  sessionId: string,
  config: CompressorConfig,
  cachedOutput?: CompressorResult | null,
): Promise<CompressorResult>;
```

### 8.2 Activation Logic

Before calling the LLM, the compressor checks:

```
1. Is compressor enabled? If not → return null (raw history).
2. Count completed turns in EventStream. < minTurnsBeforeCompression? → return null.
3. Estimate raw history token count. < tokenThreshold? → return null.
4. Is there a valid cached summary that is recent enough? → return cached.
5. Otherwise → call LLM for compression.
```

### 8.3 Token Estimation

A lightweight token estimator counts approximate tokens from EventStream entries:

```typescript
function estimateHistoryTokens(entries: EventStreamEntry[]): number {
  let total = 0;
  for (const entry of entries) {
    if (entry.type === 'user_message' || entry.type === 'model_response' || 
        entry.type === 'tool_result') {
      const content = entry.content as { text?: string; output?: string };
      const text = content.text ?? content.output ?? '';
      total += Math.ceil(text.length / 4); // rough 4-chars-per-token estimate
    }
  }
  return total;
}
```

This is deliberately simple. Exact tokenization is provider-specific and unnecessary for threshold comparison.

### 8.4 Compressor Prompt Template

**New file:** `packages/runtime/src/compressor-prompt.ts`

The compressor prompt instructs the model to extract state into the 11 categories:

```
You are a structured state extractor for an AI agent session history.

Your job is to analyze the conversation history below and extract structured 
state into 11 categories. You are NOT writing a paragraph summary. You are 
extracting discrete, identifiable state items into a JSON schema.

## CRITICAL RULES
1. PROTECTED CATEGORIES must be extracted completely. Missing a user constraint, 
   accepted decision, or open commitment is a CRITICAL failure.
2. Never embed raw conversation text. Extract structured descriptions only.
3. When uncertain whether an item should be included, INCLUDE IT. Fail-open.
4. Preserve the semantic meaning exactly. "Do NOT use React" must not become 
   "Use React".
5. No secrets, credentials, API keys, or sensitive data in any field.

## Session History
{formattedHistory}

## Output Format (JSON)
Respond with ONLY a JSON object matching this exact schema:
{
  "currentTaskState": {
    "activeTask": "<string or null>",
    "currentGoal": "<string or null>",
    "blockers": ["<string>"],
    "progressNotes": ["<string>"]
  },
  "acceptedDecisions": [
    {"decisionId": "<unique-id>", "summary": "<what was decided>", "acceptedAt": "<turn reference>"}
  ],
  "openIssues": [
    {"issueId": "<unique-id>", "summary": "<description>", "severity": "<critical|important|advisory>"}
  ],
  "openCommitments": [
    {"commitmentId": "<unique-id>", "summary": "<what was committed>", "committedAt": "<turn reference>"}
  ],
  "userConstraints": [
    {"constraintId": "<unique-id>", "summary": "<constraint description>"}
  ],
  "importantFilesPaths": ["<path>"],
  "failedAttempts": [
    {"attemptId": "<unique-id>", "summary": "<what was tried>", "failureReason": "<why it failed>"}
  ],
  "activeWarnings": [
    {"warningCode": "<code>", "message": "<warning description>"}
  ],
  "antiRegressionRules": [
    {
      "ruleId": "<unique-id>",
      "category": "<process|architectural|tool_specific|safety>",
      "summary": "<the rule>",
      "severity": "<critical|important|advisory>",
      "applicability": ["<task types>"],
      "sourceReference": "<what incident created this>",
      "reviewDate": null
    }
  ],
  "durableFacts": [
    {"factId": "<unique-id>", "summary": "<fact description>"}
  ],
  "recentRawTurnWindow": {
    "windowSize": {rawWindowSize},
    "turnCount": {actualTurnCount},
    "windowPolicy": "most_recent_N"
  },
  "compressionConfidence": <float 0.0-1.0>,
  "failOpenTriggered": <true if confidence < 0.75 or uncertain>,
  "failOpenReason": "<reason or null>",
  "protectedCategoriesRetained": [<list of protected categories you retained>],
  "totalRawTokensApprox": <integer>,
  "compressedTokensApprox": <integer>
}

## Category Extraction Instructions
- currentTaskState: What is the user currently trying to accomplish?
- acceptedDecisions: What has been explicitly agreed upon? ("OK", "approved", "yes let's do that")
- openIssues: What problems have been identified but not resolved?
- openCommitments: What has been promised or is pending delivery?
- userConstraints: What rules or preferences has the user stated? ("always", "never", "must", "don't")
- importantFilesPaths: What files and directories have been referenced?
- failedAttempts: What approaches were tried and abandoned? Why?
- activeWarnings: Any warnings or risks that are still relevant?
- antiRegressionRules: What hard lessons emerged? What must not be repeated?
- durableFacts: What long-lived facts were established (project structure, naming conventions, etc.)?

Respond with ONLY the JSON object. No explanation, no markdown fences.
```

### 8.5 History Formatting for the Prompt

The `formattedHistory` input is built from EventStream entries, structured as:

```
[Turn 1] User: <user message text>
[Turn 1] Assistant: <model response text>
[Turn 1] Tool Call: <tool name>(<arguments>)
[Turn 1] Tool Result: <output>
[Turn 2] User: <user message text>
...
```

Only `user_message`, `model_response` (text), `tool_call`, and `tool_result` entries are included. System events, `zam_plan`, and errors are excluded from the formatted history (they are internal).

### 8.6 Response Parsing and Validation

After receiving the model's response:

1. **Parse JSON**: Extract JSON from the response. Handle markdown code fences, trailing text.
2. **Schema validate**: Validate against AJV-compiled `history-compressor-output.schema.json`.
3. **Enforce protection invariants**:
   - Verify `protectedCategoriesRetained` includes all 6 protected categories.
   - Verify no protected category appears with zero items when the raw history contains relevant turns.
4. **Enforce fail-open invariants**:
   - If `compressionConfidence < confidenceThreshold` → set `failOpenTriggered: true`.
5. **Add metadata**: Set `compressorVersion`, `sessionId`, `compressionTraceId` (UUID).
6. **Return**: The validated `HistoryCompressorOutput` or `null` on any validation failure.

### 8.7 Error Handling

| Error condition | Behavior |
|---|---|
| Model call timeout | Return `null` (raw history fallback). Log warning. |
| Model returns non-JSON | Return `null`. Log warning. |
| JSON fails schema validation | Return `null`. Log warning. |
| Provider API error (rate limit, 500) | Return `null`. Log warning. |
| `compressor.enabled: false` | Return `null` immediately. No call made. |
| Below token threshold | Return `null` immediately. No call made. |
| Below turn threshold | Return `null` immediately. No call made. |

**Core safety principle**: The compressor can never block the main pipeline. Any failure results in `null`, which means the runtime uses full raw history — identical to current behavior.

---

## 9. Integration with Runtime Turn Loop

### 9.1 Where the Compressor is Called

The compressor runs **once per turn** (when compression is needed), before building the ZAM input:

```typescript
// In turn-loop.ts (conceptual — actual integration is a separate pass)

// Step 1b: Analyze request (M1)
const analyzerResult = await analyzeRequest(request.text, config.analyzer);

// Step 1d: Compress history if needed (M3)
const compressorResult = await compressHistory(
  session.eventStream.read(),
  session.sessionId,
  config.compressor,
  session.cachedCompressorResult,  // from previous turn
);

// Step 2: Build ZAM input (modified to accept compressed history)
const zamInput = buildZamInput(
  session.eventStream,
  request,
  registry,
  session.config,
  compressorResult,  // NEW parameter
);

// Step 3: Call ZAM plan()
// ... (unchanged)
```

### 9.2 History State Builder Modification

The `buildZamInput()` function in `history-state-builder.ts` is modified to accept an optional `CompressorResult`:

```typescript
export function buildZamInput(
  eventStream: EventStream,
  request: UserRequest,
  registry: object,
  config: RuntimeConfig,
  compressorResult?: CompressorResult | null,  // NEW parameter
): ZamPlanRequestBody {
  
  if (compressorResult?.compressed && compressorResult.output) {
    // Use compressed history:
    // 1. Structured summary as a system-level history component
    // 2. Recent raw turn window (last N turns)
    // 3. Open commitments (always raw, dropAllowed: false)
    return buildCompressedZamInput(
      eventStream, request, registry, config,
      compressorResult.output,
      compressorResult.rawTurnWindow,
    );
  }

  // Default: use full raw history (existing behavior, unchanged)
  return buildRawZamInput(eventStream, request, registry, config);
}
```

When compression is active, the `history` object in the `ZamPlanRequestBody` contains:

```json
{
  "history": {
    "structured_summary": "<JSON-stringified HistoryCompressorOutput>",
    "recent_raw_turns": [ /* last N raw turns */ ],
    "open_commitments": [ /* always raw, never compressed */ ]
  }
}
```

### 9.3 EventStream Recording

A new `compressor_completed` system event is recorded in the EventStream for audit trail:

```typescript
interface CompressorEventContent {
  compressorVersion: string;      // model name used
  compressed: boolean;            // whether compression was applied
  totalRawTokens: number;         // raw history token count
  compressedTokens: number;       // compressed output token count
  compressionRatio: number;       // 1 - (compressed / raw)
  rawWindowSize: number;          // number of raw turns retained
  confidenceScore: number;        // model's compression confidence
  failOpenTriggered: boolean;     // whether fail-open expanded context
  durationMs: number;             // wall-clock time for the LLM call
  fallbackUsed: boolean;          // true if raw history was used as fallback
  fallbackReason?: string;        // reason for fallback
  cachedResult: boolean;          // true if a cached summary was reused
  protectedCategories: string[];  // categories unconditionally retained
}
```

This is recorded as a `system_event` with `event: 'compressor_completed'`.

---

## 10. Fail-Open Safety Model

The History Compressor has **three layers of fail-open protection**:

| Layer | Location | What it protects against |
|---|---|---|
| **Layer 1: Activation Guard** | `history-compressor.ts` | Sessions below token/turn thresholds → no compression (raw history used). |
| **Layer 2: Compressor** | `history-compressor.ts` | LLM returns invalid JSON, timeout, provider error → `null` returned (raw history fallback). Low confidence → `failOpenTriggered: true`, raw history used. |
| **Layer 3: Protection Validator** | `history-compressor.ts` | Validates all 6 protected categories are retained. Missing protected categories → `null` returned (raw history fallback). |

**Invariant:** At no point can the History Compressor cause a protected state item (accepted decision, open commitment, user constraint, anti-regression rule, active task state, or recent user instruction) to be silently dropped from the prompt. Any compression failure or confidence drop results in full raw history — identical to current behavior.

### 10.1 Protected Categories (Zero-Tolerance)

From `docs/14` §4, these are zero-tolerance failures:

| Failure Mode | Description | Enforcement |
|---|---|---|
| **Dropped Constraint** | A user-stated durable constraint is omitted. | Verify `userConstraints` array is non-empty when raw history contains constraint-like patterns. |
| **Dropped Commitment** | An open commitment is omitted. | Verify `openCommitments` array is non-empty when raw history contains tool calls. |
| **Dropped Decision** | An accepted decision is lost. | Verify `acceptedDecisions` contains items when raw history has approval patterns. |
| **Dropped Anti-Regression** | A session-derived hard lesson is omitted. | Verify `antiRegressionRules` includes rules from significant failure events. |
| **Semantic Distortion** | Summary changes meaning of a retained item. | Cannot be verified programmatically in M3. Future: model-assisted equivalence checking (docs/14 §4). |

---

## 11. Prompt Assembler Integration

When compressed history is active, the Prompt Assembler's behavior changes:

### 11.1 Current Behavior (No Compressor)

```
System messages (from ZAM plan selectedComponents)
  + Full raw conversation history (from EventStream)
  + Current user message
  → Provider messages array
```

### 11.2 Modified Behavior (With Compressor)

```
System messages (from ZAM plan selectedComponents)
  + Structured summary (as a system message with role: 'system')
  + Recent raw turn window (last N turns, as user/assistant/tool messages)
  + Open commitments (always raw, as tool messages)
  + Current user message
  → Provider messages array
```

The structured summary is injected as a **system message** between the ZAM plan components and the conversation history. This gives the main model:
- All governance-selected context from ZAM (scaffold, skills, tools, policies).
- A complete structured understanding of the session state.
- Recent raw conversational context for immediate continuity.
- All pending tool commitments for re-entry awareness.

---

## 12. Caching Strategy

### 12.1 Why Cache

The compressor calls an LLM, which adds latency (estimated 2–8 seconds). If compression ran on every turn after the threshold, it would add this latency to every model interaction. Caching avoids this.

### 12.2 Cache Location

The compressed result (`CompressorResult`) is cached on the `Session` object:

```typescript
interface Session {
  // ... existing fields ...
  cachedCompressorResult?: CompressorResult | null;
  lastCompressionTurnIndex?: number;
}
```

### 12.3 Cache Invalidation

A cached summary is invalidated when:
1. `recompressionTurnInterval` new turns have occurred since `lastCompressionTurnIndex`.
2. The session is explicitly reset.

A cached summary is NOT invalidated by individual tool results or model responses within the interval window — those are captured in the raw turn window and open commitments lanes.

---

## 13. New Files Created by M3

| File | Purpose |
|---|---|
| `packages/runtime/src/history-compressor.ts` | Core compressor module: activation logic, LLM call, response parsing, schema validation, protection validation, caching, error handling. |
| `packages/runtime/src/compressor-prompt.ts` | Prompt templates for the compressor LLM call. Separated from logic for testability and prompt iteration. |
| `packages/runtime/src/compressor-config.ts` | `CompressorConfig` type definition and config parsing extension. |
| `packages/runtime/tests/history-compressor.test.ts` | Unit tests: activation thresholds, JSON parsing, schema validation, protection enforcement, caching, timeout, fallback behavior. Mocked provider. |
| `packages/runtime/tests/compressor-prompt.test.ts` | Unit tests: prompt template correctness, history formatting, variable interpolation. |

**Modified files:**
| File | Change |
|---|---|
| `packages/runtime/src/turn-loop.ts` | Add compressor call between analyzer and ZAM input building (Step 1d). |
| `packages/runtime/src/history-state-builder.ts` | Accept optional `CompressorResult`, implement `buildCompressedZamInput()`. |
| `packages/runtime/src/config.ts` | Add `compressor` section parsing. |
| `packages/runtime/src/types.ts` | Add `CompressorEventContent` type. |
| `packages/runtime/tests/config.test.ts` | Add compressor config tests. |
| `runtime.config.json` | Add `compressor` section for live E2E test. |

---

## 14. Phased Implementation Roadmap for M3

M3 is split into narrow, independently reviewable Coder passes:

| Pass | Scope | Files Created | Files Modified |
|---|---|---|---|
| **M3-A** | Compressor config type + config loader extension | `packages/runtime/src/compressor-config.ts` | `packages/runtime/src/config.ts` (add compressor section parsing), `packages/runtime/tests/config.test.ts` (add compressor config tests) |
| **M3-B** | Compressor prompt templates + history formatter | `packages/runtime/src/compressor-prompt.ts`, `packages/runtime/tests/compressor-prompt.test.ts` | None |
| **M3-C** | Core compressor module (activation, LLM call, parsing, validation, caching, error handling) | `packages/runtime/src/history-compressor.ts`, `packages/runtime/tests/history-compressor.test.ts` | None |
| **M3-D** | History State Builder modification (accept compressed input) | None | `packages/runtime/src/history-state-builder.ts` (add `buildCompressedZamInput()`), `packages/runtime/tests/history-state-builder.test.ts` (add compressed path tests) |
| **M3-E** | Turn loop integration + EventStream recording | None | `packages/runtime/src/turn-loop.ts` (add compressor call at Step 1d), `packages/runtime/src/types.ts` (add `CompressorEventContent`) |
| **M3-F** | Live E2E verification (Sam-approved) | None | `runtime.config.json` (add compressor section) |

Each pass is one Coder activation with review.

---

## 15. Verification Plan

### 15.1 Unit Tests (Mocked Provider)

| Test category | What it verifies |
|---|---|
| Activation: disabled | `enabled: false` → `null` returned immediately. No provider call. |
| Activation: below token threshold | History below `tokenThreshold` → `null` returned. No provider call. |
| Activation: below turn threshold | Fewer than `minTurnsBeforeCompression` turns → `null` returned. |
| Activation: cache hit | Valid cached result within `recompressionTurnInterval` → cached result returned. No provider call. |
| Activation: cache expired | Cached result past interval → new compression triggered. |
| Happy path | Mocked model returns valid JSON → valid `HistoryCompressorOutput` produced. |
| Malformed JSON | Mocked model returns garbage → `null` returned, warning logged. |
| Schema validation failure | Mocked model returns JSON missing required fields → `null` returned. |
| Timeout handling | Mocked provider delays beyond `timeoutMs` → `null` returned, no crash. |
| Provider error | Mocked provider throws → `null` returned, no crash. |
| Protection validation | Output missing a protected category → `null` returned with `protection_violation` reason. |
| Fail-open on low confidence | `compressionConfidence < threshold` → `failOpenTriggered: true`, raw history used. |
| Token estimation | Token estimator produces reasonable approximations for various entry types. |
| History formatting | EventStream entries are correctly formatted as conversation text. |
| Raw window extraction | Correct N most recent turns are included in `rawTurnWindow`. |
| Compressed ZAM input | `buildCompressedZamInput` produces correct `ZamPlanRequestBody` with structured summary. |

### 15.2 Integration Test (Live, Sam-Approved)

After unit tests pass, with Sam's explicit approval, run a multi-turn session that exceeds the token threshold:

```bash
# Step 1: Start a session with several turns of tool use
node packages/runtime/dist/cli/index.js run "List the files in the src directory"
# (execute 6+ turns manually or via script)

# Step 2: Verify compressor activation
# Check EventStream for 'compressor_completed' event
# Verify compressionRatio > 0.5
# Verify protectedCategories includes all 6 protected categories
```

### 15.3 Baseline Verification

After M3 implementation:
- `vitest run` from `packages/runtime` → all runtime tests pass.
- MVP test suite (651/651) remains unaffected.
- No changes to `fixtures/`, `schemas/outputs/`, `schemas/inputs/` (except reading the existing FUTURE-ONLY schema), `tests/phase12/`.

---

## 16. Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Compressor drops a user constraint | Main model violates user preferences, potential safety issue. | Zero-tolerance protection validation. Raw history fallback on any protection violation. Protected categories checked programmatically. |
| Compressor distorts semantic meaning | "Do NOT use React" becomes "Use React" in summary. | Cannot be prevented by schema alone. Mitigated by: (1) structured extraction (not paragraph summary), (2) explicit prompt instructions, (3) future model-assisted equivalence checking (`docs/14` §4). |
| Compressor adds latency | 2–8 seconds per compression call. | Caching: compress once every N turns, not every turn. Below-threshold sessions have zero overhead. |
| Compressor cost | Additional LLM call. | Uses cheapest capable model. Called once every ~5 turns after threshold, not every turn. Config flag to disable entirely. |
| Compressor returns invalid JSON | Compression fails. | Fallback to raw history. No behavior change. Logged warning. |
| Compressor hallucinates state | Invents decisions or constraints that never occurred. | Each extracted item includes source references. Main model can cross-reference with recent raw turns. Future: harness fixtures for hallucination detection (`docs/14` §5). |
| Token estimation is inaccurate | Compression activates too early or too late. | The 4-chars-per-token estimate is conservative. Threshold is configurable. |
| Cached summary becomes stale | Main model makes decisions based on outdated summary. | Cache invalidation after N turns. Recent raw window provides immediate conversational context. Open commitments are always raw. |

---

## 17. Decision Required From Sam

Before implementation begins, Sam should confirm:

### 17.1 Model Selection — ✅ DECIDED
> **Tier 1 (lightweight compressor):** `google/gemini-3.1-flash-lite` (Sam's choice)
> **Tier 2 (stronger compressor):** `google/gemini-3-flash-preview` (Sam's choice)
> **Main model:** `x-ai/grok-4.3` (unchanged)

### 17.2 Implementation Order — ✅ DECIDED
> M3-A → M3-B → M3-C → M3-D → M3-E → M3-F (config first). Approved by Sam.

### 17.3 Token Threshold — ✅ DECIDED
> Default threshold: 4000 tokens of raw history before compression activates. Approved by Sam.

### 17.4 Raw Window Size — ✅ DECIDED
> Default: 6 most recent raw turns alongside the structured summary. Approved by Sam.

### 17.5 Caching Strategy — ✅ DECIDED
> Recompress every 5 turns after first compression. Cache between compressions. Approved by Sam.

---

## 18. Summary

| Aspect | Decision |
|---|---|
| What M3 builds | A live model-assisted History Compressor that calls a lightweight LLM and produces structured `HistoryCompressorOutput` with 11 state categories. |
| Where it lives | `packages/runtime/src/history-compressor.ts` (new file). |
| How it integrates | Produces `HistoryCompressorOutput` → `buildCompressedZamInput()` → `plan()` → context-governed prompt with compressed history. |
| Safety model | Three-layer fail-open. Raw history fallback on any error. Zero-tolerance protection validation for 6 protected categories. |
| Model choice | Configurable via `runtime.config.json`. Tier 1: lightweight (Flash-tier). Tier 2: stronger model for complex sessions. |
| MVP impact | Zero. No existing core file modified. Runtime modifications are narrowly scoped. |
| Fallback | Any compressor failure → raw history (identical to current behavior). |
| Activation | Conditional: only when enabled, above token threshold, and above turn threshold. Short sessions have zero overhead. |
| Caching | Compress once every N turns. Cached summary reused between compressions. |
| Testing | Unit tests with mocked providers + live E2E with Sam approval. |

---

*All decisions approved by Sam on 2026-06-09. Phase M3 is authorized for implementation via the Coder Agent, following the M3-A → M3-F pass sequence.*

