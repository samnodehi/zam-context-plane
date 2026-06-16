# 21 HTTP API Implementation Plan

> **Document type:** Implementation Plan — HTTP Service and Adapter Layer
> **Status:** COMPLETE — Implementation verified.
> **Authority:** `docs/18_HTTP_API_AND_ADAPTER_SPEC.md` — this document resolves all Open Questions from `docs/18` §10 and defines the concrete technical plan for the implementation pass.
> **MVP interference:** None — this plan does not modify existing CLI, schemas, or tests.
> **Canonical sources:** `docs/18_HTTP_API_AND_ADAPTER_SPEC.md`; `docs/04_PORTABLE_CORE_ARCHITECTURE.md` §5–§6; `docs/13_MODEL_ASSISTED_CONTEXT_PLANNING.md` §15.

---

## 1. Purpose

This document resolves every Open Question left in `docs/18` §10 and defines the complete, unambiguous technical architecture for the Local HTTP Service and the first Adapter. There are no TBD items in this document. Technical debt is absolutely forbidden.

Scope of this plan:

1. **Answer all IQ-1 to IQ-6** from `docs/18` §10 with concrete, justified decisions.
2. **Define the directory structure** for `src/http/` and `src/adapters/`.
3. **Define how each endpoint maps** to the existing core pipeline modules (`src/core/`).
4. **Define the testing strategy** that introduces HTTP tests without breaking the 651-test MVP baseline.
5. **Identify what the next Coder implementation pass will build**, in one narrow, safe scope.

---

## 2. Open Questions Resolved

### IQ-1: HTTP Framework Choice

**Decision: [Fastify](https://fastify.dev/), version 4.x (latest stable).**

Reasons:
- **Lightweight and fast.** Fastify's JSON serialization is significantly faster than Express. For a context-planning service that may be called multiple times per agent turn (Re-entry Loops, §4 of `docs/20`), low overhead matters.
- **First-class TypeScript support.** The project is already fully TypeScript (`tsconfig.json`, `src/**/*.ts`). Fastify provides accurate TypeScript typings out of the box; no DefinitelyTyped workarounds are needed.
- **Schema-first validation.** Fastify natively integrates with JSON Schema (AJV under the hood) for request/response validation — directly aligned with MAX's existing Draft 2020-12 schema boundary. We can supply our existing core input schemas directly to Fastify's `schema.body` option.
- **No framework lock-in.** Fastify does not require any framework-specific decorators, class hierarchies, or dependency injection containers. The core pipeline functions (`loadInputs`, `buildRegistryIndexes`, etc.) remain pure functions — Fastify simply wraps them in route handlers.
- **Production-ready.** Fastify is used in production by major organizations; it is not experimental.

Express is rejected for this project because: its JSON serialization is slower, its TypeScript support requires `@types/express`, and its middleware model is more permissive (harder to enforce the strict no-cross-contamination boundary required by `docs/18` §2).

### IQ-2: In-Process vs. Separate Process

**Decision: In-process (same Node.js process as the core pipeline).**

Reasons:
- The core pipeline functions are already pure TypeScript functions with no external I/O beyond reading input files. Calling them in-process eliminates all IPC latency and serialization overhead.
- There is no state to isolate between core and HTTP layer — MAX is stateless. The HTTP service calls core functions directly and returns their outputs.
- A separate process (e.g., via `child_process.fork`) would add complexity (IPC protocol, process lifecycle, error propagation) without any architectural benefit for a stateless planner.
- The Adapter Layer that sits outside the core remains a separate process concern; the HTTP service itself is in-process.

The deployment model is: a single Node.js process runs the Fastify server, which calls the core planning functions directly. For CLI usage, the `src/cli/` entry point continues to work unchanged.

### IQ-3: Authentication / Authorization Model

**Decision: API Key header (`X-MAX-API-Key`) with a configurable secret, defaulting to no-auth mode for local development.**

Rules:
- If the environment variable `MAX_API_KEY` is set, the HTTP service requires an `X-MAX-API-Key` header matching that value on every request. Requests with a missing or mismatched key receive `401 Unauthorized`.
- If `MAX_API_KEY` is not set, the service operates in **local-only mode**: it binds to `127.0.0.1` only (not `0.0.0.0`) and does not enforce any key. This is safe for local development and integration testing.
- No OAuth, no JWT, no session tokens. MAX is a local planning service, not a multi-tenant SaaS. The authorization model must be as simple as possible while preventing accidental exposure.
- The `X-MAX-API-Key` value is never logged. The service logs only the presence/absence of the header, not its value.
- Rate limiting is not in scope for the initial implementation pass. It may be added in a future pass if deployment patterns require it.

### IQ-4: Streaming Responses

**Decision: No streaming in the initial pass. Standard JSON responses only.**

Reasons:
- The core planning pipeline is synchronous and deterministic. It completes in milliseconds (as demonstrated by the 651-test suite running in ~94 seconds, averaging ~145ms per test including harness overhead). There is no long-running operation to stream.
- Streaming (SSE or chunked transfer encoding) adds significant complexity to both server and client without any practical benefit for a sub-second planning service.
- If model-assisted components (Request Analyzer, History Compressor) are added in future, they may introduce latency worth streaming. That is a separate future-pass decision with a separate scoping document.

### IQ-5: Concurrency Model

**Decision: Stateless per-request workers, Fastify's default async/await concurrency.**

Rules:
- Each request is handled independently. The core planning pipeline is stateless — it reads from its input arguments and returns its outputs with no global mutation.
- Fastify's default event-loop concurrency (Node.js single-threaded async I/O) is sufficient for local usage. There are no blocking operations inside the core pipeline (no network calls, no database access).
- No worker threads, no cluster mode, no request queuing in the initial implementation pass.
- The service does not maintain per-request sessions, so there is no concurrency conflict around shared state.

### IQ-6: Minimum Viable Adapter for Integration Testing

**Decision: A Generic Test Adapter (`src/adapters/test-adapter/`) that calls `POST /plan` with a standard JSON fixture and asserts the response.**

The first adapter is not OpenClaw-specific and not Telegram-specific. It is a **generic HTTP client adapter** used exclusively for integration testing. It:
- Reads a fixture input (same format as existing harness fixtures).
- Posts it to `POST /plan`.
- Asserts that the response matches the expected outputs.

This approach:
- Validates the HTTP service end-to-end without requiring any external runtime.
- Confirms that the vendor-neutrality invariant from `docs/18` §2 is preserved — the first adapter proves that any client (not just OpenClaw) can use the API.
- Establishes the pattern that all future adapters must follow.

---

## 3. Directory Structure

The implementation introduces three new top-level source directories. No existing directories are modified.

```
src/
  cli/           ← unchanged; CLI entry point and commands
  core/          ← unchanged; all MVP pipeline modules
  types/         ← unchanged; TypeScript interfaces
  http/          ← [NEW] Fastify HTTP service wrapper
    server.ts    ← [NEW] Fastify instance factory + plugin registration
    routes/
      plan.ts    ← [NEW] POST /plan route handler
      trace.ts   ← [NEW] POST /trace route handler
      evaluate.ts← [NEW] POST /evaluate route handler
    validation/
      schemas.ts ← [NEW] AJV/Fastify schema registration (reuses existing JSON schemas)
    errors.ts    ← [NEW] Standard error response builder (per docs/18 §4.5)
  adapters/      ← [NEW] Adapter implementations (each adapter is independent)
    test-adapter/
      index.ts   ← [NEW] Generic test adapter (calls POST /plan, asserts response)
  http-server.ts ← [NEW] Entry point for running the HTTP server (analogous to cli/index.ts)
```

**Key isolation rules:**
- `src/http/` may import from `src/core/` and `src/types/`. It must never import from `src/cli/`.
- `src/adapters/` may import from `src/http/` (the client-side HTTP types) only. It must never import from `src/core/` directly.
- `src/cli/` has zero awareness of `src/http/`. The CLI pipeline in `plan.ts` is not modified.

---

## 4. Pipeline Integration per Endpoint

### 4.1 `POST /plan` → Core Pipeline

The route handler in `src/http/routes/plan.ts` mirrors the logic in `src/cli/commands/plan.ts` — but instead of reading files from disk and writing files to disk, it reads from the JSON request body and returns JSON.

| CLI step | HTTP equivalent |
|---|---|
| Read `--request` file from disk | Extract `request.text` from JSON body |
| Read `--registry`, `--history`, etc. files from disk | Extract `registry`, `history`, etc. from JSON body |
| AJV-validate all inputs | Fastify schema validation on `body` using existing core schemas |
| Run Phases 1–11 (loadInputs → ... → runSummaryAssembler) | Call the same core functions in the same order |
| Write `prompt-plan.json`, `trace.json`, `summary.md` to disk | Return `{ promptPlan, trace, summary }` as JSON response |
| `process.exit(1)` on Class A failure | Return `422 Unprocessable Content` with error body |
| `process.exit(1)` on schema validation failure | Return `500 Internal Server Error` with error body |

The core functions themselves are not modified. The route handler wraps them.

**Input construction difference:** `loadInputs()` in the CLI reads files from disk by path and validates them against AJV schemas. In the HTTP service, input validation happens at the Fastify layer before the handler is called. The handler then constructs the equivalent in-memory structs directly from the validated body, bypassing the file-reading portions of `loadInputs()`.

This requires extracting the pure validation/transformation logic from `loadInputs()` into reusable functions — but this is a new **HTTP-specific helper** in `src/http/`, not a modification to `src/core/input-loader.ts`.

### 4.2 `POST /trace` → Trace Explanation

The route handler in `src/http/routes/trace.ts`:
- Receives a `trace` JSON object (already produced by a prior `/plan` call).
- Validates it against `schemas/outputs/trace.schema.json`.
- Generates a human-readable explanation using a new pure function in `src/http/` (does not touch `src/core/trace-summary-assembler.ts`).
- Returns `{ explanation: "..." }`.

The explanation function iterates over `trace.phases` and `trace.decisions` to produce readable text. It is deterministic and has no side effects.

### 4.3 `POST /evaluate` → Fixture Evaluation

The route handler in `src/http/routes/evaluate.ts`:
- Receives a `{ fixtureId, input, expected }` body.
- Runs the full planning pipeline (same as `POST /plan`) on the `input`.
- Compares actual outputs against `expected` fields.
- Returns `{ fixtureId, passed, violations, actualPlan, actualTrace }`.

This endpoint exposes the same evaluation logic as `src/cli/commands/evaluate.ts` over HTTP. It does not modify `evaluate.ts`.

---

## 5. Testing Strategy

The existing 651-test MVP suite (`tests/phase12/harness.test.ts` and supporting files) must not be touched. The HTTP tests live in a new directory.

```
tests/
  phase12/     ← unchanged; existing 651-test deterministic harness
  http/        ← [NEW] HTTP integration tests (Fastify test mode; no real port binding)
    plan.test.ts
    trace.test.ts
    evaluate.test.ts
    test-adapter.test.ts
```

**Test approach:**
- Use Fastify's built-in `inject()` method, which runs requests through the full Fastify pipeline (route matching, schema validation, handler) without opening a real TCP socket. This is the standard Fastify integration-testing pattern.
- Each HTTP test imports the Fastify instance from `src/http/server.ts` and calls `server.inject({ method: 'POST', url: '/plan', payload: ... })`.
- Test fixtures for HTTP tests are a small subset of the existing harness fixtures (e.g., 3–5 representative cases per endpoint). They are not the full 651-case suite.
- No new harness groups or cases are added to `tests/phase12/`. The 18-group / 28-case structure of `harness.test.ts` is untouched.
- The HTTP test suite runs as a separate Vitest test file. The existing `vitest.config.ts` (or equivalent) will pick it up automatically via glob pattern.

**Result:** After implementation, the total test count will be approximately `651 + N` (where N is the number of new HTTP tests). The existing `651/651 passed, 27 evaluate passed, 1 approved-skipped` baseline is fully preserved.

---

## 6. MVP Non-Interference Statement

This implementation plan does not:

- Modify `src/core/*.ts`.
- Modify `src/cli/*.ts` or `src/cli/commands/*.ts`.
- Modify `schemas/**/*.json`.
- Modify `tests/phase12/`.
- Change the 651-test baseline or fixture corpus.
- Change Gate A/B/C/D status.
- Add provider-specific fields to any core schema or HTTP response.
- Open any external network connections or call model providers.

---

## 7. Dependency Changes Required

The implementation pass will require adding two new npm dependencies:

| Package | Version | Purpose |
|---|---|---|
| `fastify` | `^4.x` | HTTP server framework |
| `@fastify/type-provider-typebox` | `^4.x` | TypeScript type integration for Fastify route schemas |

These are **runtime dependencies** (`dependencies` in `package.json`), not devDependencies, because `src/http-server.ts` is a production entry point.

No other new dependencies are required. AJV is already a project dependency (used by the existing harness).

> **Note for implementation pass:** Adding npm dependencies to `package.json` and `package-lock.json` requires Sam's approval per the project change discipline rules. The implementation pass Coder must confirm this approval before running `npm install`.

---

## 8. Implementation Pass Scope (Next Coder Instruction)

The next Coder pass (triggered after Sam approves this plan) will:

1. Add `fastify` and `@fastify/type-provider-typebox` to `package.json`.
2. Create `src/http/server.ts` — the Fastify factory function.
3. Create `src/http/errors.ts` — the standard error response builder.
4. Create `src/http/validation/schemas.ts` — schema registration.
5. Create `src/http/routes/plan.ts` — `POST /plan` handler.
6. Create `src/http-server.ts` — the HTTP server entry point.
7. Create `tests/http/plan.test.ts` — integration tests for `POST /plan` using `server.inject()`.

The `POST /trace` and `POST /evaluate` routes, the test adapter, and `tests/http/trace.test.ts` and `tests/http/evaluate.test.ts` are deferred to a subsequent pass to keep each pass small and reviewable.

---

## 9. Vendor-Neutrality Compliance Audit

Per `docs/18` §8, the following items are verified as excluded from the core and HTTP API:

| Excluded item | Status in this plan |
|---|---|
| Provider-specific cache headers | Not present. Cache advisory is `docs/18` §6.3 adapter responsibility only. |
| Model submission / provider API calls | Not present. No model calls in HTTP service. |
| OpenClaw workspace file reading | Not present. No OpenClaw-specific logic anywhere. |
| n8n workflow node extraction | Not present. |
| Telegram message history reading | Not present. |
| Live `~/.openclaw` state reading | Not present. Forbidden. |
| Final prompt text assembly | Not present. Adapter responsibility. |
| Tool execution results | Not present. Runtime responsibility. |
| Session state storage | Not present. Service is stateless per IQ-2/IQ-5 decisions. |
| Provider pricing / billing fields | Not present. |

**Compliance: PASS.** No vendor-specific logic is introduced anywhere in this plan.

---

## 10. Summary

| Area | Decision |
|---|---|
| HTTP framework | Fastify 4.x |
| Process model | In-process with core (single Node.js process) |
| Authentication | API key header (`X-MAX-API-Key`) via `MAX_API_KEY` env; local-dev no-auth mode |
| Streaming | Not in initial pass; standard JSON responses |
| Concurrency | Stateless per-request; Fastify async/await default |
| First adapter | Generic test adapter (`src/adapters/test-adapter/`) |
| New directories | `src/http/`, `src/adapters/`, `tests/http/` |
| MVP interference | None |
| New npm deps | `fastify`, `@fastify/type-provider-typebox` (require Sam approval before install) |
| First implementation pass scope | `POST /plan` route + server factory + HTTP plan tests only |
