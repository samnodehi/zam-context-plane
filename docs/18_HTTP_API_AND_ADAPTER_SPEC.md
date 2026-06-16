# 18 HTTP API and Adapter Specification

> **Document type:** Architecture Specification — Gate D / Phase 5 Scoping
> **Status:** Scoping Pass — No code, no runtime, no provider calls. Docs-only.
> **MVP authority:** None — does not change current MVP schemas, fixtures, or implementation.
> **Implementation status:** Not implemented. This is a design-only scoping pass.
> **Canonical sources:** `PROJECT_MASTER_PLAN.md` §14.3; `docs/04_PORTABLE_CORE_ARCHITECTURE.md` §5–§6; `docs/13_MODEL_ASSISTED_CONTEXT_PLANNING.md` §15.

---

## 1. Purpose and Scope

This document defines:

1. The **Local HTTP Service** wrapper that exposes the Context Control Plane core to any external client (§14.3 of the Master Plan).
2. The **Adapter Contract** that governs how runtime-specific clients translate between the core's provider-neutral outputs and runtime-specific mechanics (e.g., cache headers, provider APIs).
3. The **hard boundary** between what belongs in the portable core and what belongs in adapter implementations.

**What this document does not do:**
- It does not authorize a Node.js Express/Fastify implementation. That is a future implementation pass.
- It does not introduce any new schemas or change existing MVP schemas.
- It does not alter harness fixtures or test counts.
- It does not introduce provider-specific fields into the core.
- It does not depend on any specific agent runtime being present.

---

## 2. Core Vendor-Neutrality Invariant

> **The core must be compatible with any agent runtime. It must never be designed for one specific runtime.**

This is the architectural rule established by Sam (2026-06-05):

- OpenClaw, n8n, Telegram bots, and custom AI chat platforms are all **equal-status clients** of the HTTP API.
- No adapter receives architectural privilege.
- Adapter implementations are plugin-style additions that consume the standard API; they do not modify the core.
- OpenClaw-specific structures, file formats, or configuration layouts must never appear in any core schema, API contract, or core documentation.

This rule is **permanent and non-negotiable**. If a future implementation pass proposes a core change that benefits one adapter specifically, stop and reject it.

---

## 3. Architectural Position

The HTTP Service wrapper sits strictly **outside** the core boundary defined in `docs/04` §5:

```
 ┌─────────────────────────────────────────────────────────────┐
 │                     External Client Layer                   │
 │  (n8n, Telegram Bot, Custom AI Chat, Test Harness, CLI)     │
 └────────────────────────┬────────────────────────────────────┘
                          │ HTTP (POST /plan, POST /trace, etc.)
 ┌────────────────────────▼────────────────────────────────────┐
 │                Local HTTP Service Wrapper                   │
 │  • Receives request, validates against core input schemas   │
 │  • Calls core context planning pipeline                     │
 │  • Returns prompt-plan.json and trace.json over HTTP        │
 │  • Maintains NO provider-specific or runtime-specific logic │
 └────────────────────────┬────────────────────────────────────┘
                          │ Internal call (in-process or IPC)
 ┌────────────────────────▼────────────────────────────────────┐
 │              Portable Core (context-plane v0.1.0+)          │
 │  Request Router → Section Selectors → Conflict Resolver     │
 │  → Budgeter → Prompt Plan Generator → Trace Layer           │
 │  Outputs: prompt-plan.json, trace.json, summary.md          │
 │  (MVP stops here — no model submission, no adapter assembly) │
 └─────────────────────────────────────────────────────────────┘
                          │
 ┌────────────────────────▼────────────────────────────────────┐
 │                   Adapter Layer (future)                    │
 │  Each adapter is independent and runtime-specific:          │
 │  • OpenClaw Adapter (reads AGENTS.md, TOOLS.md, etc.)       │
 │  • n8n Adapter (reads n8n workflow nodes)                   │
 │  • Telegram Bot Adapter (reads chat history, bot tools)     │
 │  • Generic REST Adapter (translates plan to any runtime)    │
 │                                                             │
 │  Adapters own:                                              │
 │  • Provider-specific cache header generation                │
 │  • Prompt text assembly from prompt-plan.json               │
 │  • Submitting to model providers                            │
 │  • Writing back to runtime state                            │
 └─────────────────────────────────────────────────────────────┘
```

---

## 4. HTTP API Contract

### 4.1 Base Principles

- All endpoints speak **JSON over HTTP**.
- All request payloads are validated against existing core input schemas (Draft 2020-12) before the core pipeline is invoked.
- All response payloads are the core's canonical output structures (`prompt-plan.json`, `trace.json`, `summary.md`).
- The HTTP service is **stateless** — it does not maintain session state. Session/history state is provided by the caller per-request.
- Error responses follow a standard structure (§4.5).
- No provider-specific fields appear in any request or response.

### 4.2 `POST /plan`

**Purpose:** The primary endpoint. Accepts a full context planning request and returns a structured prompt plan with trace.

**Request Body:**

```json
{
  "request": {
    "text": "...",
    "metadata": {}
  },
  "registry": { /* component registry JSON, validated against component.schema.json */ },
  "tools": { /* tools JSON, validated against tools input schema */ },
  "skills": { /* skills JSON, validated against skills input schema */ },
  "history": { /* history state JSON, validated against history-state-summary.schema.json */ },
  "budget": { /* budget constraints JSON, validated against budget input schema */ },
  "riskPolicy": { /* risk policy JSON, validated against risk policy input schema */ },
  "userConstraints": { /* user constraints JSON, validated against user-constraints schema */ }
}
```

All fields except `request` and `registry` are **optional**. Absent optional fields trigger class-B fallback behavior as defined in existing selector specs.

**Response Body (HTTP 200):**

```json
{
  "promptPlan": { /* full prompt-plan.json structure */ },
  "trace": { /* full trace.json structure */ },
  "summary": "..." /* summary.md content as a string */
}
```

**HTTP Status Codes:**

| Code | Meaning |
|---|---|
| `200` | Plan generated successfully |
| `400` | Request payload validation failed — malformed input |
| `422` | Request payload valid but semantically unprocessable (e.g., empty registry) |
| `500` | Internal planning pipeline error |

### 4.3 `POST /trace`

**Purpose:** Accepts an existing `trace.json` (produced by a previous `/plan` call) and returns a human-readable explanation of every decision in the trace.

**Request Body:**

```json
{
  "trace": { /* trace.json structure */ }
}
```

**Response Body (HTTP 200):**

```json
{
  "explanation": "..." /* human-readable narrative of all trace decisions */
}
```

This endpoint is useful for debugging, operator review, and audit tooling without re-running the full planning pipeline.

### 4.4 `POST /evaluate`

**Purpose:** Accepts a fixture input (request + registry + expected outputs) and returns an evaluation result comparing actual output against expected.

**Request Body:**

```json
{
  "fixtureId": "...",
  "input": { /* same structure as POST /plan request body */ },
  "expected": {
    "selectedComponentIds": [],
    "omittedComponentIds": [],
    "deferredComponentIds": [],
    "promptFamily": "...",
    "failOpenExpected": false
  }
}
```

**Response Body (HTTP 200):**

```json
{
  "fixtureId": "...",
  "passed": true,
  "violations": [],
  "actualPlan": { /* the actual prompt plan produced */ },
  "actualTrace": { /* the actual trace produced */ }
}
```

This endpoint enables runtime-agnostic fixture-based evaluation of the planning core from any client.

### 4.5 Standard Error Response

All error responses (4xx, 5xx) use:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request field 'registry' failed schema validation.",
    "details": []
  }
}
```

`code` values are a closed enum defined by the HTTP service implementation. No provider-specific error codes appear.

---

## 5. Input Validation Contract

The HTTP service **must** validate every request body against the existing core input schemas before calling the planning pipeline:

| Input Field | Schema | On Failure |
|---|---|---|
| `request` | (inline — text string + optional metadata object) | `400 VALIDATION_ERROR` |
| `registry` | `schemas/inputs/registry.schema.json` | `400 VALIDATION_ERROR` |
| `tools` | `schemas/inputs/tools.schema.json` | `400 VALIDATION_ERROR` |
| `skills` | `schemas/inputs/skills.schema.json` | `400 VALIDATION_ERROR` |
| `history` | `schemas/inputs/history-state-summary.schema.json` | Class-B fallback (absent = safe) |
| `budget` | `schemas/inputs/budget.schema.json` | Class-B fallback (absent = safe) |
| `riskPolicy` | `schemas/inputs/risk-policy.schema.json` | Class-B fallback (absent = safe) |
| `userConstraints` | `schemas/inputs/user-constraints.schema.json` | Class-B fallback (absent = safe) |

The service never passes an invalid or unvalidated payload to the core. The core's fail-open guarantees apply after validation — they do not replace input validation.

---

## 6. Adapter Contract

### 6.1 What Adapters Are

An **Adapter** is a thin client-side integration layer that:

1. **Translates** runtime-specific data (e.g., OpenClaw workspace files, n8n workflow nodes, Telegram message history) into the standard `POST /plan` request body format.
2. **Calls** `POST /plan` (or the equivalent in-process library API, see §7).
3. **Receives** the `prompt-plan.json` and `trace.json` response.
4. **Translates** the response into runtime-specific actions (e.g., assembling final prompt text, applying provider cache headers, submitting to a model API).

### 6.2 What Adapters Must Never Do

Adapters must not:

- Modify the core planning pipeline.
- Add provider-specific fields to `prompt-plan.json` or `trace.json`.
- Bypass the HTTP API to call core internals directly (unless using the approved library API in §7).
- Alter the `selectedComponents[]`, `omittedComponents[]`, or `deferredComponents[]` membership — those decisions are final from the core.
- Submit to model providers from inside the core.

### 6.3 Cache Advisory Translation (Adapter Responsibility)

The core produces `selectedComponents[]` with components ordered by cache stability classification (`stable` → `session` → `volatile`) per `docs/13` §15 and `docs/04` §7.7. This ordering is **advisory only**.

**Adapters** are responsible for translating these ordered lists into provider-specific cache mechanics:

| Core Advisory | Adapter Responsibility |
|---|---|
| `stable` components appear first in `selectedComponents[]` | Adapter may generate provider-specific cache control headers (e.g., Anthropic `cache_control`, OpenAI prefix caching hints) for these components |
| `session` components appear next | Adapter may generate session-scoped cache hints |
| `volatile` components appear last | Adapter should not apply persistent cache headers to these components |

**Invariants the adapter must respect:**

- Cache translation is advisory. The adapter must never change which components are included or omitted.
- If the provider does not support caching, the adapter simply ignores the ordering and submits components in the order received.
- No provider-specific fields (`cacheControlHeaders`, `ttl`, `minBlockSize`, etc.) may ever appear in the core's output schemas. They are generated entirely by the adapter.

### 6.4 Adapter Isolation Requirement

Each adapter must be independently deployable and independently testable without any other adapter being present.

An adapter for n8n must not contain any OpenClaw-specific logic. An OpenClaw adapter must not contain any Telegram-specific logic. This ensures the core remains compatible with new runtimes without touching existing adapters.

---

## 7. Library API Alternative (Node/Python)

In addition to the HTTP service, the core may expose a direct library API (Master Plan §14.2) for cases where HTTP overhead is undesirable (e.g., tight integration in a Node.js or Python agent runtime):

**Node.js (illustrative, not yet implemented):**

```js
const { plan } = require('context-plane');

const result = await plan({
  request: { text: "..." },
  registry: { ... },
  tools: { ... },
  skills: { ... },
  history: { ... },
  budget: { ... }
});

// result.promptPlan  → prompt-plan.json structure
// result.trace       → trace.json structure
// result.summary     → summary.md string
```

The library API must expose **the same validation and fail-open guarantees** as the HTTP API. It is not a raw internal call that bypasses schema validation.

---

## 8. What Is Explicitly Excluded from Core and HTTP API

The following must **never** appear in any core schema, HTTP request/response body, or this specification:

| Excluded item | Why excluded | Where it belongs |
|---|---|---|
| Provider-specific cache headers (`cacheControlHeaders`, `ttl`, `minBlockSize`) | Provider-specific | Adapter implementations |
| Model submission / provider API calls | Post-MVP; runtime-specific | Adapter implementations |
| OpenClaw workspace file reading (AGENTS.md, TOOLS.md, etc.) | Runtime-specific | OpenClaw Adapter |
| n8n workflow node extraction | Runtime-specific | n8n Adapter |
| Telegram message history reading | Runtime-specific | Telegram Bot Adapter |
| Live `~/.openclaw` state reading | Forbidden in core | Adapter implementations |
| Final prompt text assembly | Post-MVP; adapter responsibility | Runtime Assembly Adapter |
| Tool execution results | Post-MVP; runtime-specific | Agent runtime |
| Session state storage | Runtime-specific | Adapter / runtime layer |
| Provider pricing / billing fields | Provider-specific | Adapter / billing layer |

---

## 9. MVP Non-Interference Statement

This document does not:

- Change any existing MVP schema (`schemas/inputs/`, `schemas/outputs/`).
- Change any existing harness fixture.
- Change test counts (651 suite, 27 evaluate passed, 1 approved-skipped).
- Alter any existing selector, conflict resolver, budgeter, or trace behavior.
- Open Gate D / authorize adapter implementation. That remains a separate future pass.
- Add provider/model calls to any existing module.
- Change `docs/04`, `docs/05`, `docs/06`, `docs/11`, `docs/12`, or `docs/13`.

The Phased Adoption Plan in `docs/13` §22 lists Phase 5 (provider adapter / cache implementation) as "Not started — requires explicit implementation pass; post-MVP." This document is the architectural scoping note that precedes that implementation pass — it is not that pass.

---

## 10. Open Questions for Future Implementation Pass

| # | Question | Impact |
|---|---|---|
| IQ-1 | Which HTTP framework should be used (Express, Fastify, Hono, or other)? | Determines implementation approach |
| IQ-2 | Should the HTTP service run in-process with the core or as a separate process? | Determines latency and deployment model |
| IQ-3 | What authentication/authorization model should the HTTP service use? | Determines how callers are identified and rate-limited |
| IQ-4 | Should the HTTP service support streaming responses (Server-Sent Events or chunked) for large plans? | Determines API design for latency-sensitive clients |
| IQ-5 | How should the HTTP service handle concurrent requests — stateless per-request or pooled workers? | Determines scalability design |
| IQ-6 | What is the minimum viable adapter for initial integration testing? A generic testbed (not OpenClaw-specific)? | Determines first adapter scope |

These questions are explicitly not answered by this document. They require a dedicated implementation scoping pass with Sam's approval.

---

## 11. Summary

| Area | Decision |
|---|---|
| Core vendor neutrality | Permanent. No runtime-specific code in core. |
| HTTP endpoints | `POST /plan`, `POST /trace`, `POST /evaluate` |
| Response payloads | `promptPlan` (prompt-plan.json), `trace` (trace.json), `summary` (string) |
| Input validation | Against existing core input schemas before calling core |
| Cache advisory | Advisory ordering in `selectedComponents[]` only; translation to provider headers is adapter responsibility |
| Provider-specific fields | Never in core schemas or HTTP response; adapter-only |
| Adapter isolation | Each adapter independent; no cross-adapter dependencies |
| Library API | Same guarantees as HTTP API; not a raw internal call bypass |
| Implementation | Not authorized by this document; requires separate pass |
| MVP interference | None |
