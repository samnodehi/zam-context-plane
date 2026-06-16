# 20 Re-entry Loops Architectural Scoping

> **Document type:** Architecture Scoping Note — Re-entry Loops (docs/13 §22 Phase 4)
> **Status:** Scoping Pass — No code, no runtime, no provider calls. Docs-only.
> **MVP authority:** None — does not change current MVP schemas, fixtures, or implementation.
> **Implementation status:** Not implemented. This is a design-only scoping pass.
> **Canonical sources:** `docs/04_PORTABLE_CORE_ARCHITECTURE.md` §5–§6; `docs/16_TRACE_EXTENSIONS_SCOPING.md` §6.3; `docs/18_HTTP_API_AND_ADAPTER_SPEC.md` §3–§6; `trace.schema.json` `reentryPhase`.

---

## 1. Problem Statement

The current MAX pipeline is a **one-way, single-turn planner**:

```
Request in → MAX Pipeline → prompt-plan.json + trace.json out
```

In a multi-turn or agentic workflow, the External Runtime (e.g., a custom chat platform, OpenClaw, n8n) will:

1. Receive the `prompt-plan.json` from MAX.
2. Assemble the prompt from the plan.
3. Submit the prompt to a model provider.
4. Receive a model response that may include tool calls, skill requests, or partial answers.
5. Execute the tool calls or skill requests.
6. Receive tool results and determine that a **second planning pass** is needed before answering the user — because the tool results must be incorporated into the context.

Step 6 is the **Re-entry trigger**. Without a well-defined re-entry architecture, the runtime either:
- Uses a stale prompt plan that does not reflect the new tool results, or
- Bypasses MAX entirely and assembles context ad-hoc, undermining the portability and governance guarantees.

This document defines how MAX supports structured re-entry planning without violating its core invariants.

---

## 2. Core Invariant: MAX Does Not Drive the Loop

**The External Runtime owns the loop. MAX provides a deterministic plan per turn.**

MAX is not an agent runtime. It does not:
- Call models.
- Execute tools.
- Monitor tool results.
- Decide when to stop looping.

The External Runtime is fully responsible for:
- Executing the loop (calling MAX multiple times as needed).
- Stopping the loop (based on model output, tool completion, or loop limits).
- Enforcing maximum re-entry counts.
- Delivering the final model response to the user.

MAX's responsibility is strictly: **when called for a re-entry turn, produce a correct, deterministic context plan for that turn** — incorporating the new inputs (tool results, updated history) — and emit a complete trace of every decision made.

This is the same as MAX's MVP responsibility. Re-entry is not a new mode; it is a new input context for the same pipeline.

---

## 3. Architectural Position

```
  ┌──────────────────────────────────────────────────────────────────┐
  │                    External Runtime (Loop Owner)                 │
  │                                                                  │
  │  Turn 1:                                                         │
  │  1. Build context input (history, registry, tools, skills...)    │
  │  2. POST /plan → MAX → prompt-plan.json (Turn 1)                 │
  │  3. Assemble prompt from plan                                     │
  │  4. Submit to model provider                                      │
  │  5. Receive model response: tool_call(get_weather, NYC)          │
  │  6. Execute tool → result: "72°F, partly cloudy"                 │
  │  7. Re-entry decision: tool result must be included in context   │
  │                                                                  │
  │  Re-entry Turn 2:                                                │
  │  8. Update history: append tool call + tool result turns         │
  │  9. POST /plan (re-entry) → MAX → prompt-plan.json (Turn 2)      │
  │  10. Assemble prompt from new plan                               │
  │  11. Submit to model provider                                    │
  │  12. Receive final model response (no more tool calls)           │
  │  13. Deliver answer to user                                      │
  └──────────────────────────────────────────────────────────────────┘
                             │  POST /plan (each call)
  ┌────────────────────────  ▼  ─────────────────────────────────────┐
  │                   MAX Context Control Plane                      │
  │  Request Router → Selectors → Conflict Resolver → Budgeter       │
  │  → Prompt Plan Generator → Trace Layer                           │
  │                                                                  │
  │  Per turn output:                                                │
  │  - prompt-plan.json (with all re-entry signals)                  │
  │  - trace.json (with reentryPhase[] populated if re-entry)        │
  │  - summary.md                                                    │
  └──────────────────────────────────────────────────────────────────┘
```

**Key principle:** Each call to MAX is stateless and complete. MAX does not maintain inter-turn state. The External Runtime passes the full updated context on every call.

---

## 4. Re-entry Signals: How the Runtime Informs MAX

A re-entry turn is signaled by the External Runtime through standard MAX inputs — no new top-level API fields are required. The runtime uses the existing input contracts as follows:

### 4.1 Updated History (`history-state-summary`)

The Runtime appends the tool call turn and tool result turn to the history state before calling MAX:

```
historyState.turns = [
  ... (prior turns from Turn 1) ...,
  { turnId: "T2-tool-call", role: "assistant", lane: "open_commitments", content: "get_weather(NYC)" },
  { turnId: "T2-tool-result", role: "tool", lane: "open_commitments", content: "72°F, partly cloudy" }
]
```

The History Lane Manager (`docs/04` §7.6) processes these new turns normally. `open_commitments` lanes are protected and cannot be dropped.

### 4.2 Re-entry Metadata in `request-signals`

The Runtime sets `requestSignals.reentryTurn: true` to indicate to the Request Router and Selectors that this is a re-entry turn (not a fresh request). This signal:
- Prevents the Request Router from reclassifying `promptFamily` from scratch (the family from Turn 1 is inherited unless a full reclassification is appropriate).
- Informs Selectors that tool-use context should be given higher weight.
- Is recorded in `trace.requestPhase`.

> **Future field note:** `requestSignals.reentryTurn` and `requestSignals.priorPlanId` are `[FUTURE-ONLY]` fields in `request-signals.schema.json`. They must not be added without a separate schema extension pass aligned with the MVP Non-Interference Guarantee.

### 4.3 Prior Plan Reference (`priorPlanId`)

The Runtime passes the `runId` of the prior turn's plan (from `trace.run.runId`) as a re-entry signal. This enables:
- `reentryPhase[].priorPlanId` in the trace to link re-entry events to their prior plans.
- Auditable provenance: each re-entry turn's trace references the plan that triggered it.

---

## 5. Loop Limits and Fail-Safes

### 5.1 MAX Is Not the Loop Enforcer

MAX does not count re-entry iterations, enforce maximum loop limits, or decide when to stop. Those responsibilities belong to the External Runtime.

The External Runtime **must** implement:

| Fail-safe | Description |
|---|---|
| **Maximum re-entry count** | A configurable cap (e.g., 3–5 re-entries per user request). If exceeded: deliver a graceful fallback response to the user. |
| **No-progress detection** | If a re-entry turn produces a plan identical to the prior plan (or the model response loops without new tool results), the runtime must break the loop. |
| **Timeout** | A maximum wall-clock time for the full loop. If exceeded: return the best available partial result. |
| **Tool execution failure** | If a tool call fails, the runtime records the failure in the history turn and re-enters MAX with the error state. MAX includes this turn in context; the model decides how to proceed. |

### 5.2 MAX's Fail-Open Guarantee Applies Per Turn

On every re-entry call, MAX applies its full fail-open semantics:
- Components without a clear omission signal are included.
- Safety-critical and mandatory components are inviolable.
- If the re-entry input is malformed or missing required fields, MAX falls back to class-A halt (malformed registry) or class-B fallback (missing optional fields) per existing behavior.

MAX does not fail-open at the loop level (that is the runtime's job). MAX fails open at the **per-component, per-turn** level — which is its existing invariant.

### 5.3 Deterministic Loop-Breaking Within MAX

If MAX receives a re-entry request that appears to be a degenerate loop (e.g., the history contains identical tool call/result pairs repeated beyond a threshold), the Request Router may set `requestSignals.loopSuspect: true`. Selectors receiving this signal include a `loop_suspect_seen` evidence atom in their decisions. This signal does **not** cause MAX to halt or refuse the request — it is an advisory trace signal for operator review.

> **Future field note:** `requestSignals.loopSuspect` is a `[FUTURE-ONLY]` field. It must not be added to `request-signals.schema.json` without a separate schema extension pass.

---

## 6. Pipeline Integration: Re-entry vs. Fresh Turn

On a re-entry turn, MAX runs the **full pipeline** — the same phases as a fresh turn:

| Phase | Fresh Turn Behavior | Re-entry Turn Behavior |
|---|---|---|
| **Input loading** | Load and validate all inputs | Load and validate all inputs (including updated history with tool results) |
| **Registry loading** | Load and index all components | Same — registry is stateless; re-loaded from the same source |
| **Request normalization** | Classify request, emit `requestSignals` | Same, but `reentryTurn: true` carries forward `promptFamily` from Turn 1 unless reclassification is warranted |
| **Selector fan-out** | Deterministic ladder per component | Same — `open_commitments` lane content (tool results) raises weight of relevant selectors |
| **Conflict Resolution** | Priority 0–7 enforced | Same — safety, user constraints, and priority order are inviolable |
| **Budgeter** | Enforce token envelope | Same — token cost of tool result turns is factored in |
| **Prompt Plan Generator** | Produce `prompt-plan.json` | Produces updated `prompt-plan.json` reflecting tool results in context |
| **Trace Layer** | Produce `trace.json` | Produces `trace.json` with `reentryPhase[]` populated |

**There are no pipeline shortcuts for re-entry turns.** The full deterministic pipeline runs every time. This is necessary to preserve:
- Safety and privacy invariants (Priority 0–1 in Conflict Resolver must run).
- Auditability (every decision is traced).
- Portability (no hidden fast-paths the adapter must know about).

The cost of running the full pipeline on re-entry is acceptable: MAX is fast and offline. It does not call models. Re-running the pipeline is cheap compared to model inference.

---

## 7. `reentryPhase` Trace Integration

The existing `trace.schema.json` already defines `reentryPhase` as a `[FUTURE-ONLY]` array (per `docs/17 §6.1.3`). Each element of the array captures one re-entry event:

```json
"reentryPhase": [
  {
    "trigger": "tool_result:get_weather",
    "updatedLanes": ["open_commitments", "recent_raw_turns"],
    "reentryTraceId": "rt-abc123",
    "priorPlanId": "run-xyz789"
  }
]
```

**Constraints (from `docs/16` §6.3):**
- `trigger`: describes the event that initiated re-entry (tool result, error, retry, user clarification).
- `updatedLanes`: lists the lanes that received new or changed content in this re-entry turn.
- `reentryTraceId`: unique ID for this re-entry event, linkable to `outputReviewPhase.reentryTraceId` when output review is also implemented.
- `priorPlanId`: the `runId` of the prior planning run this re-entry updates.
- Re-entry does not blindly reuse the prior plan — it re-runs context planning from the Request Router forward with updated inputs.
- Multiple re-entry events per run are recorded as separate array elements, in chronological order.

---

## 8. Vendor-Neutrality Constraint

Re-entry semantics must be **fully runtime-agnostic**:

- The re-entry API is `POST /plan` with updated inputs. No new API endpoint is needed for re-entry.
- Tool result formats are normalized by the External Runtime's adapter before passing to MAX as history turns. MAX never receives raw provider-formatted tool results.
- The `trigger` string in `reentryPhase[]` is a free-form description — not a provider-specific enum. OpenClaw function call formats, Anthropic tool_use blocks, and OpenAI tool_calls are all translated to neutral strings by adapters.

This is consistent with the vendor-neutrality invariant established in `docs/18` §2.

---

## 9. Relationship to Output Review (`outputReviewPhase`)

Re-entry is closely related to output review (defined conceptually in `docs/16` §6.4). The difference:

| Concept | Trigger | Loop Owner |
|---|---|---|
| **Re-entry (this document)** | Model produced a tool call that must be executed and incorporated | External Runtime |
| **Output Review** | Model produced an answer but an automated reviewer finds defects (wrong scope, missing citation, etc.) | External Runtime (with MAX providing context plan for correction) |

Both result in the runtime calling `POST /plan` again. The distinction is in the `trigger` recorded in `reentryPhase[].trigger` and `outputReviewPhase.reviewType`.

In the future, when both are implemented, a single planning run might produce a trace with both `reentryPhase[]` (tool result incorporation) and `outputReviewPhase` (defect review) entries. These are separate optional phase keys; they do not conflict.

---

## 10. MVP Non-Interference Statement

This document does not:

- Change any existing MVP schema (`schemas/inputs/`, `schemas/outputs/`).
- Change any existing harness fixture.
- Change test counts (651 suite, 27 evaluate passed, 1 approved-skipped).
- Alter any existing selector, conflict resolver, budgeter, or trace behavior.
- Add `reentryTurn`, `loopSuspect`, or `priorPlanId` to `request-signals.schema.json` — those are `[FUTURE-ONLY]` fields requiring a separate schema pass.
- Change `docs/04`, `docs/05`, `docs/06`, `docs/11`, `docs/12`, `docs/13`, `docs/16`, or `docs/18`.

The `reentryPhase` array is already present in `trace.schema.json` as `[FUTURE-ONLY]`. This document defines the behavioral semantics that implementation must conform to when that key becomes active.

---

## 11. Open Questions for Future Implementation Pass

| # | Question | Impact |
|---|---|---|
| IQ-1 | What is the exact schema shape for `requestSignals.reentryTurn` and `requestSignals.priorPlanId`? | Requires formal schema extension pass against `docs/06 §2.1` |
| IQ-2 | Should the Request Router inherit `promptFamily` from the prior plan via `priorPlanId`, or always re-classify? | Affects Request Router behavior and `requestPhase` trace shape |
| IQ-3 | How does the Selector Engine weight `open_commitments` lane content higher on re-entry turns? | Affects deterministic ladder configuration |
| IQ-4 | What is the canonical maximum re-entry count guidance for adapter authors? | Documentation only — MAX does not enforce this |
| IQ-5 | How are failed tool executions represented as history turns? Schema shape for `role: "tool"` with error content? | Requires new history turn shape pass |
| IQ-6 | Should the HTTP service expose a stateful session endpoint that caches the prior plan for re-entry, or remain fully stateless per-request? | Architecture decision for `docs/18` implementation pass |

---

## 12. Summary

| Area | Decision |
|---|---|
| Loop ownership | External Runtime — MAX does not drive or limit loops |
| MAX's responsibility | Deterministic context plan per turn, every time, full pipeline |
| Re-entry signal | Updated history (tool results as `open_commitments` turns) + `requestSignals.reentryTurn` (future field) |
| Pipeline on re-entry | Full pipeline — no shortcuts, no phase skipping |
| Safety invariants | Inviolable — Priority 0–1 Conflict Resolver rules apply on every re-entry turn |
| Trace | `reentryPhase[]` already defined in `trace.schema.json`; this document defines its behavioral semantics |
| Vendor neutrality | Fully runtime-agnostic — tool results translated to neutral history turns by adapters |
| MVP interference | None |
