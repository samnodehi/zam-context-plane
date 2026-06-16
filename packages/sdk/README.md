# `@zamapi/sdk`

> TypeScript/JavaScript HTTP client for the [ZAM Context Governance API](https://zamapi.dev).

ZAM is a **portable Context Governance infrastructure layer** — a middleware that AI agent runtimes integrate with to get intelligent, auditable, fail-safe context planning. This SDK provides a lightweight, zero-dependency HTTP client that wraps the ZAM REST API with full TypeScript types and a structured error hierarchy.

---

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Quickstart](#quickstart)
- [Client Configuration](#client-configuration)
- [API Reference](#api-reference)
  - [`plan(request)`](#planrequest)
  - [`trace(request)`](#tracerequest)
  - [`evaluate(request)`](#evaluaterequest)
  - [`health()`](#health)
- [Error Handling](#error-handling)
  - [Error Class Hierarchy](#error-class-hierarchy)
  - [Catching Errors](#catching-errors)
  - [Error Properties](#error-properties)
- [TypeScript Integration](#typescript-integration)
- [Retry Behavior](#retry-behavior)
- [Authentication](#authentication)

---

## Requirements

- **Node.js** ≥ 18 (uses the built-in `fetch` API — no external HTTP library required)
- A running ZAM API server (see the [ZAM server documentation](../README.md) for setup)

---

## Installation

```bash
npm install @zamapi/sdk
```

```bash
yarn add @zamapi/sdk
```

```bash
pnpm add @zamapi/sdk
```

---

## Quickstart

```typescript
import { ZAMClient } from '@zamapi/sdk';

// Initialize the client pointing to your ZAM server
const zam = new ZAMClient({
  baseUrl: 'http://localhost:3001',
  // apiKey: 'your-api-key',  // Required only if ZAM_API_KEY is set on the server
});

// Submit a context planning request
const result = await zam.plan({
  request: {
    text: 'Analyze this codebase and suggest refactoring opportunities',
  },
  registry: [
    {
      id: 'ctx-system-prompt',
      type: 'scaffold',
      label: 'System Prompt',
      tokensApprox: 500,
      priority: 0,
      mandatory: true,
    },
    {
      id: 'ctx-codebase',
      type: 'skill',
      label: 'Codebase Context',
      tokensApprox: 8000,
      priority: 2,
    },
  ],
});

// Use the planning outputs
console.log(result.promptPlan);   // Structured prompt plan (selectedComponents, etc.)
console.log(result.summary);      // Human-readable planning summary (Markdown string)
// result.trace                   // Full audit trace of every planning decision
```

---

## Client Configuration

```typescript
const zam = new ZAMClient(options: ZAMClientOptions);
```

### `ZAMClientOptions`

| Property  | Type     | Required | Default | Description |
|-----------|----------|----------|---------|-------------|
| `baseUrl` | `string` | ✅ Yes | — | Base URL of the ZAM API server. Trailing slashes are removed automatically. Example: `"http://localhost:3001"` |
| `apiKey`  | `string` | ❌ No  | `undefined` | API key sent in the `X-ZAM-API-Key` header. Omit if the server is running without `ZAM_API_KEY` set (local-only mode). |
| `timeout` | `number` | ❌ No  | `30000` | Request timeout in milliseconds. Applies per request (not per retry). Default: 30 seconds. |
| `retries` | `number` | ❌ No  | `0` | Number of automatic retries on **network errors** (not on HTTP error responses). Default: 0 (no retries). |

**Example — all options:**

```typescript
const zam = new ZAMClient({
  baseUrl: 'https://zam.example.com',
  apiKey: process.env.ZAM_API_KEY,
  timeout: 60_000,   // 60 seconds
  retries: 2,        // retry up to 2 times on network failure
});
```

---

## API Reference

### `plan(request)`

Submit a context planning request. Runs the full ZAM planning pipeline and returns a prompt plan, trace, and summary.

**Signature:**

```typescript
async plan(request: PlanRequest): Promise<PlanResponse>
```

**Request — `PlanRequest`:**

| Field            | Type                          | Required | Description |
|------------------|-------------------------------|----------|-------------|
| `request`        | `{ text: string; metadata?: Record<string, unknown> }` | ✅ Yes | The planning request. `text` must be a non-empty string describing what the agent is about to do. |
| `registry`       | `Record<string, unknown>[]`   | ✅ Yes | Array of component registry entries. Validated server-side against the component schema. |
| `tools`          | `Record<string, unknown>`     | ❌ No  | Tool definitions. Triggers class-B fallback when absent. |
| `skills`         | `Record<string, unknown>`     | ❌ No  | Skill definitions. Triggers class-B fallback when absent. |
| `history`        | `Record<string, unknown>`     | ❌ No  | History state summary. Triggers class-B fallback when absent. |
| `budget`         | `Record<string, unknown>`     | ❌ No  | Budget constraints. Triggers class-B fallback when absent. |
| `riskPolicy`     | `Record<string, unknown>`     | ❌ No  | Risk policy configuration. Triggers class-B fallback when absent. |
| `userConstraints`| `Record<string, unknown>`     | ❌ No  | User-defined constraints. Triggers class-B fallback when absent. |

**Response — `PlanResponse`:**

| Field        | Type                        | Description |
|--------------|-----------------------------|-------------|
| `promptPlan` | `Record<string, unknown>`   | The generated prompt plan. Contains `selectedComponents`, `omittedComponents`, `deferredComponents`, `estimatedTokens`, `budgetPlan`, and other planning outputs. |
| `trace`      | `Record<string, unknown>`   | Full per-phase audit trace. Contains decision evidence for every phase of the planning pipeline. |
| `summary`    | `string`                    | Human-readable Markdown summary of the planning run. |

**HTTP errors thrown:**

| Error | Condition |
|-------|-----------|
| `ZAMAuthenticationError` | `401` — missing or invalid API key |
| `ZAMValidationError`     | `400` — request payload failed schema validation |
| `ZAMUnprocessableError`  | `422` — valid input but semantically unprocessable (e.g., empty registry) |
| `ZAMServerError`         | `5xx` — internal server error |
| `ZAMTimeoutError`        | Request exceeded configured `timeout` |
| `ZAMNetworkError`        | Network failure before HTTP response received |

**Example:**

```typescript
import { ZAMClient, ZAMValidationError, ZAMUnprocessableError } from '@zamapi/sdk';

const zam = new ZAMClient({ baseUrl: 'http://localhost:3001' });

try {
  const result = await zam.plan({
    request: { text: 'Summarize the project documentation' },
    registry: [
      {
        id: 'ctx-docs',
        type: 'skill',
        label: 'Documentation',
        tokensApprox: 4000,
        priority: 1,
      },
    ],
    budget: { totalTokenLimit: 8000 },
  });

  // selectedComponents contains what ZAM decided to include
  const selected = result.promptPlan['selectedComponents'] as unknown[];
  console.log(`Selected ${selected.length} context components`);
  console.log(result.summary);

} catch (err) {
  if (err instanceof ZAMValidationError) {
    console.error('Request payload is invalid:', err.message, err.details);
  } else if (err instanceof ZAMUnprocessableError) {
    console.error('Registry issue:', err.message);
  } else {
    throw err;
  }
}
```

---

### `trace(request)`

Explain a trace produced by a prior `/plan` call. Returns a human-readable narrative of every decision in the trace — useful for debugging, operator review, and audit tooling without re-running the full pipeline.

**Signature:**

```typescript
async trace(request: TraceRequest): Promise<TraceResponse>
```

**Request — `TraceRequest`:**

| Field   | Type                      | Required | Description |
|---------|---------------------------|----------|-------------|
| `trace` | `Record<string, unknown>` | ✅ Yes | A `trace` object produced by a prior `plan()` call. |

**Response — `TraceResponse`:**

| Field         | Type     | Description |
|---------------|----------|-------------|
| `explanation` | `string` | Human-readable narrative explaining all decisions in the trace. |

**HTTP errors thrown:** `ZAMAuthenticationError`, `ZAMValidationError`, `ZAMServerError`, `ZAMTimeoutError`, `ZAMNetworkError`

**Example:**

```typescript
// First, run planning to get a trace
const planResult = await zam.plan({ request: { text: '...' }, registry: [...] });

// Then explain the trace
const traceResult = await zam.trace({ trace: planResult.trace });
console.log(traceResult.explanation);
```

---

### `evaluate(request)`

Run fixture-based evaluation of the ZAM planning pipeline. Submits a test input alongside expected outputs and returns a comparison result. Designed for integration testing and CI validation.

**Signature:**

```typescript
async evaluate(request: EvaluateRequest): Promise<EvaluateResponse>
```

**Request — `EvaluateRequest`:**

| Field       | Type               | Required | Description |
|-------------|--------------------|----------|-------------|
| `fixtureId` | `string`           | ✅ Yes | Caller-supplied fixture identifier. Returned verbatim in the response. |
| `input`     | `PlanRequest`      | ✅ Yes | The planning input — same shape as a `plan()` request body. |
| `expected`  | `EvaluateExpected` | ❌ No  | Expected outputs to compare actual results against. If absent, no comparison is performed. |

**`EvaluateExpected`:**

| Field        | Type                      | Required | Description |
|--------------|---------------------------|----------|-------------|
| `promptPlan` | `Record<string, unknown>` | ❌ No  | Expected prompt plan structure (partition comparison). |
| `trace`      | `Record<string, unknown>` | ❌ No  | Expected trace structure (top-level phase key comparison). |

**Response — `EvaluateResponse`:**

| Field         | Type                   | Description |
|---------------|------------------------|-------------|
| `fixtureId`   | `string`               | Echo of the `fixtureId` supplied in the request. |
| `passed`      | `boolean`              | `true` if no violations were found; `false` otherwise. |
| `violations`  | `EvaluateViolation[]`  | List of field-level comparison violations. Empty array when `passed === true`. |
| `actualPlan`  | `Record<string, unknown>` | The actual prompt plan produced by the pipeline. |
| `actualTrace` | `Record<string, unknown>` | The actual trace produced by the pipeline. |

**`EvaluateViolation`:**

| Field      | Type      | Description |
|------------|-----------|-------------|
| `field`    | `string`  | The path of the field that violated expectations. |
| `expected` | `unknown` | The expected value. |
| `actual`   | `unknown` | The actual value produced by the pipeline. |
| `message`  | `string`  | Human-readable description of the violation. |

**HTTP errors thrown:** `ZAMAuthenticationError`, `ZAMValidationError`, `ZAMUnprocessableError`, `ZAMServerError`, `ZAMTimeoutError`, `ZAMNetworkError`

**Example:**

```typescript
const result = await zam.evaluate({
  fixtureId: 'fixture-001',
  input: {
    request: { text: 'Test planning request' },
    registry: [{ id: 'ctx-1', type: 'scaffold', label: 'Test', tokensApprox: 100, priority: 0, mandatory: true }],
  },
  expected: {
    promptPlan: { selectedComponents: [{ path: 'ctx-1' }] },
  },
});

if (result.passed) {
  console.log(`Fixture ${result.fixtureId}: PASSED`);
} else {
  console.error(`Fixture ${result.fixtureId}: FAILED`);
  for (const v of result.violations) {
    console.error(`  [${v.field}] expected=${JSON.stringify(v.expected)}, actual=${JSON.stringify(v.actual)}`);
  }
}
```

---

### `health()`

Check if the ZAM server is alive. Does **not** require authentication — the `/health` endpoint bypasses API key validation by design.

**Signature:**

```typescript
async health(): Promise<HealthResponse>
```

**Response — `HealthResponse`:**

| Field     | Type     | Description |
|-----------|----------|-------------|
| `status`  | `'ok'`   | Always `"ok"` when the server is alive and accepting requests. |
| `version` | `string` | Server version (read from `package.json` at startup). |

**HTTP errors thrown:** `ZAMServerError`, `ZAMTimeoutError`, `ZAMNetworkError`

**Example:**

```typescript
const health = await zam.health();
console.log(`ZAM server is up. Version: ${health.version}`);
// Output: ZAM server is up. Version: 0.1.0
```

---

## Error Handling

All SDK errors extend the base `ZAMError` class. Raw `fetch` errors and raw HTTP responses are always wrapped — you never receive a raw network primitive or an unparsed HTTP response.

### Error Class Hierarchy

```
ZAMError                        — Base class for all SDK errors
├── ZAMAuthenticationError      — HTTP 401: missing or invalid API key
├── ZAMValidationError          — HTTP 400: request payload failed schema validation
├── ZAMUnprocessableError       — HTTP 422: valid input, but semantically unprocessable
├── ZAMServerError              — HTTP 5xx: internal server error
└── ZAMNetworkError             — No HTTP response (network/DNS failure, connection refused)
    └── ZAMTimeoutError         — Request exceeded the configured timeout
```

### Catching Errors

```typescript
import {
  ZAMClient,
  ZAMAuthenticationError,
  ZAMValidationError,
  ZAMUnprocessableError,
  ZAMServerError,
  ZAMNetworkError,
  ZAMTimeoutError,
} from '@zamapi/sdk';

const zam = new ZAMClient({
  baseUrl: 'http://localhost:3001',
  apiKey: process.env.ZAM_API_KEY,
  timeout: 30_000,
  retries: 1,
});

try {
  const result = await zam.plan({
    request: { text: 'Analyze dependencies' },
    registry: [...],
  });
  // handle success
} catch (err) {
  if (err instanceof ZAMAuthenticationError) {
    // HTTP 401 — check your API key
    console.error('Authentication failed:', err.message);

  } else if (err instanceof ZAMValidationError) {
    // HTTP 400 — fix your request payload
    console.error('Validation error:', err.message);
    console.error('Details:', err.details); // field-level validation errors

  } else if (err instanceof ZAMUnprocessableError) {
    // HTTP 422 — valid format but semantically invalid (e.g., empty registry)
    console.error('Unprocessable request:', err.message);

  } else if (err instanceof ZAMServerError) {
    // HTTP 5xx — server-side error
    console.error(`Server error (HTTP ${err.statusCode}):`, err.message);

  } else if (err instanceof ZAMTimeoutError) {
    // Request timed out (no HTTP response)
    console.error('Request timed out:', err.message);

  } else if (err instanceof ZAMNetworkError) {
    // Network-level failure (DNS, connection refused, etc.)
    console.error('Network error:', err.message);

  } else {
    // Unexpected — rethrow
    throw err;
  }
}
```

### Error Properties

All errors that extend `ZAMError` expose the following properties:

| Property     | Type              | Description |
|--------------|-------------------|-------------|
| `message`    | `string`          | Human-readable error description. |
| `name`       | `string`          | Error class name (e.g., `"ZAMAuthenticationError"`). |
| `statusCode` | `number \| null`  | HTTP status code (`401`, `400`, `422`, `5xx`). `null` for `ZAMNetworkError` and `ZAMTimeoutError` (no HTTP response available). |
| `code`       | `string`          | Machine-readable error code. See table below. |
| `details`    | `unknown`         | Optional structured details from the server error response. Present for `ZAMValidationError` and `ZAMUnprocessableError`. |

**Error codes:**

| Error Class              | `code`                  | `statusCode` |
|--------------------------|-------------------------|--------------|
| `ZAMAuthenticationError` | `AUTH_ERROR`            | `401`        |
| `ZAMValidationError`     | `VALIDATION_ERROR`      | `400`        |
| `ZAMUnprocessableError`  | `UNPROCESSABLE_REQUEST` | `422`        |
| `ZAMServerError`         | `SERVER_ERROR`          | `5xx`        |
| `ZAMNetworkError`        | `NETWORK_ERROR`         | `null`       |
| `ZAMTimeoutError`        | `TIMEOUT_ERROR`         | `null`       |

---

## TypeScript Integration

The SDK is written in TypeScript and ships with full type declarations. All request and response shapes are exported for use in your own code.

**Importing types:**

```typescript
import type {
  ZAMClientOptions,
  PlanRequest,
  PlanResponse,
  TraceRequest,
  TraceResponse,
  EvaluateRequest,
  EvaluateExpected,
  EvaluateResponse,
  EvaluateViolation,
  HealthResponse,
} from '@zamapi/sdk';
```

**Typing your registry entries:**

The SDK intentionally types complex nested objects (like registry entries) as `Record<string, unknown>` — the SDK is a pure transport layer and does not validate or interpret their internal structure. All schema validation is performed server-side.

If you want stronger typing for registry entries in your own codebase, you can define your own interface and cast:

```typescript
interface ComponentEntry {
  id: string;
  type: 'scaffold' | 'skill' | 'tool' | 'history';
  label: string;
  tokensApprox?: number;
  priority?: number;
  mandatory?: boolean;
}

const registry: ComponentEntry[] = [
  { id: 'ctx-system', type: 'scaffold', label: 'System Prompt', tokensApprox: 500, priority: 0, mandatory: true },
  { id: 'ctx-tools',  type: 'tool',     label: 'Available Tools', tokensApprox: 200, priority: 1 },
];

// Cast to the SDK's expected type when calling plan()
const result = await zam.plan({
  request: { text: 'Your request' },
  registry: registry as Record<string, unknown>[],
});
```

**Accessing the prompt plan response:**

```typescript
const result = await zam.plan({ request: { text: '...' }, registry: [...] });

// Cast to your own typed interface if you know the structure:
interface PromptPlan {
  selectedComponents: Array<{ path: string; tokensApprox?: number }>;
  omittedComponents: Array<{ path: string }>;
  deferredComponents: Array<{ path: string }>;
  estimatedTokens: { total: number };
}

const plan = result.promptPlan as unknown as PromptPlan;
console.log(`Selected ${plan.selectedComponents.length} components`);
console.log(`Estimated tokens: ${plan.estimatedTokens.total}`);
```

---

## Retry Behavior

The SDK retries only on **network-level failures** (`ZAMNetworkError`), not on HTTP error responses. This is by design — HTTP 4xx and 5xx errors are deterministic and retrying them is rarely useful.

- **Network errors** (connection refused, DNS failure, etc.) → retried up to `retries` times.
- **Timeout errors** (`ZAMTimeoutError`) → retried (they extend `ZAMNetworkError`).
- **HTTP errors** (401, 400, 422, 5xx) → **not retried** — thrown immediately on first occurrence.

```typescript
const zam = new ZAMClient({
  baseUrl: 'http://localhost:3001',
  retries: 2,       // 1 initial attempt + 2 retries = 3 total attempts on network failure
  timeout: 10_000,  // 10 seconds per attempt
});
```

---

## Authentication

Authentication is optional and controlled server-side by the `ZAM_API_KEY` environment variable.

- **If `ZAM_API_KEY` is set on the server:** Every request (except `GET /health`) must include the `X-ZAM-API-Key` header with the correct value. Pass `apiKey` in client options.
- **If `ZAM_API_KEY` is not set (local-only mode):** The server does not require authentication. Omit `apiKey` from client options.
- **`GET /health`** always bypasses authentication regardless of server configuration.

```typescript
// With authentication
const zam = new ZAMClient({
  baseUrl: 'https://zam.example.com',
  apiKey: process.env.ZAM_API_KEY,
});

// Without authentication (local-only server)
const zam = new ZAMClient({
  baseUrl: 'http://localhost:3001',
});
```

---

## License

`UNLICENSED` — proprietary. All rights reserved.
