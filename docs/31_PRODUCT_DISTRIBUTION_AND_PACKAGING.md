# 31 Product Distribution & Packaging — Phase V4 Scoping

> **⚠️ SUPERSEDED (2026-06-16) by [`docs/37`](37_OPEN_CORE_BOUNDARY_AND_ADAPTER_STRATEGY.md) + locked decision F1 (open-core).**
> This document's driving thesis — *"ZAM source code must never be directly accessible to consumers"*
> and the closed Docker → SDK → SaaS funnel — is **retired**. ZAM is **open-core**: the spec, registry
> format, and reference implementation are open; the business is hosting / adapters / support, not
> secrecy. This file is **kept for history**; its container/SDK *mechanics* may be revisited later
> strictly as open-core *deployment* convenience (never for source protection). See `docs/37` for the
> current boundary.

> **Document type:** Scoping Specification — Phase V4
> **Status:** Scoping pass — no code changes authorized by this document.
> **MVP authority:** None — does not change any existing MVP schema, fixture, test, enum, warning code, trace shape, or core pipeline behavior.
> **Implementation status:** Not implemented. This is the scoping specification that defines the architecture, decisions, and execution contract for Phase V4: Product Distribution & Packaging.
> **Canonical sources:** `PROJECT_MASTER_PLAN.md` §14 (Product Direction), `docs/18_HTTP_API_AND_ADAPTER_SPEC.md` (HTTP API contract), `docs/21_HTTP_API_IMPLEMENTATION_PLAN.md` (IQ-2, IQ-3 decisions), `docs/30_HTTP_API_STABILIZATION.md` (V3 foundation — HTTP service now production-grade). (Note: the original `agent-board/` planner board was retired in 2026-06; product strategy/roadmap now live in git history, `DEBT.md`, and the session plan.)

---

## 1. Purpose & Strategic Context

### 1.1 Why Phase V4 Exists

Phase V3 (HTTP API Stabilization) is complete. The ZAM HTTP service is production-grade, formally audited, and verified against the `docs/18` contract. However, the project is currently only usable by someone who clones the repository and runs it locally. That is not a product — it is a development environment.

Phase V4 transforms ZAM from a development project into a **distributable, production-grade infrastructure product**. The strategic decision (Sam-approved, 2026-06-15) is:

> **ZAM is a Context Governance Infrastructure Layer — not an agent runtime.** It is a middleware that agent runtimes (OpenClaw, Hermes, custom bots, etc.) integrate with to obtain intelligent, auditable, fail-safe context planning. No agent runtime currently provides this capability. ZAM fills that gap.

The critical constraint is **source code protection**: ZAM source code must never be directly accessible to consumers. Distribution must deliver the capability without exposing the implementation.

### 1.2 Three-Phase Distribution Roadmap

The product strategy is a three-phase progression toward full SaaS:

| Phase | Name | Deliverable | Source Code Exposure |
|---|---|---|---|
| **Phase 1 (this document)** | Containerization + API Packaging | Docker image + SDK + developer docs | ❌ Hidden inside compiled container |
| **Phase 2** | First Real-World Adapter | OpenClaw or Telegram adapter that calls ZAM API | ❌ Adapter is a thin HTTP client only |
| **Phase 3** | SaaS / Hosted API | Cloud-deployed ZAM with API Key management | ❌ 100% server-side — zero client-side code |

This document scopes Phase 1 exclusively. Phases 2 and 3 will have their own scoping documents.

### 1.3 What Phase 1 Delivers

Phase 1 delivers four artifacts:

1. **Production Docker image** — a compiled, minimal, security-hardened container exposing ZAM's HTTP API. A consumer runs `docker run` and gets a working ZAM endpoint. No TypeScript source is accessible inside the image.
2. **Docker Compose configuration** — a `docker-compose.yml` and `.env.example` enabling one-command local deployment.
3. **Developer SDK (`@zamapi/sdk`)** — a lightweight TypeScript/JavaScript HTTP client package. Consumers install it and call ZAM without writing raw HTTP. No ZAM internals are included.
4. **Developer documentation** — a complete onboarding guide (`DEVELOPER_GUIDE.md`) and HTTP API reference (`API_REFERENCE.md`). A developer can integrate ZAM from zero without reading any source code.

### 1.4 Quality Standard

Per the Sam-approved rule (2026-06-15):

> Every step from this point forward must be executed at **production-grade quality**. No shortcuts, no "just to pass the phase" implementations, no deferred polish. Every artifact must be something we would ship to a paying customer.

Every sub-pass in V4 must meet this standard.

---

## 2. MVP Non-Interference Guarantee

Phase V4 does **not** authorize changes to:

| Protected Artifact | Reason |
|---|---|
| `schemas/inputs/`, `schemas/outputs/`, `schemas/shared/`, `schemas/internal/` | MVP schemas are locked. |
| `fixtures/` (all 28 cases) | MVP fixture corpus is locked. |
| `tests/phase12/harness.test.ts` and `harness-checks.ts` | Gate B (651/651) is locked. |
| `tests/http/*.test.ts` (33 HTTP tests) | HTTP test suite is locked. |
| Enum values in `enums.shared.schema.json` | Locked. |
| Warning codes (`warning-code.schema.json`) | Locked. |
| Trace shapes (`trace.schema.json`) | Locked. |
| Prompt-plan shapes (`prompt-plan.schema.json`) | Locked. |
| Selector ladder behavior (`docs/06` §8) | Locked. |
| Core pipeline modules (`src/core/*.ts`) | Locked. No behavior changes. |
| `src/http/*.ts`, `src/http/routes/*.ts` | Locked. No behavior changes. |

The only permitted change to existing `src/` files in V4-B is the addition of `ZAM_HOST` env var support to `src/http-server.ts` (see DQ-5). This is an additive change that does not alter any existing behavior.

---

## 3. Architecture Decision: Containerization (Dockerfile)

### DQ-1: Node.js Base Image

**Decision: `node:20-alpine` for the production stage; `node:20-alpine` for the builder stage.**

Reasons:
- `package.json` specifies `"engines": { "node": ">=20" }`. The base image must satisfy this.
- Alpine Linux is chosen over full Debian (`node:20`) because:
  - **Size:** Alpine images are ~50–70 MB vs ~350–400 MB for Debian-based. Smaller images mean faster pull, less storage, smaller attack surface.
  - **Security:** Fewer installed packages = fewer CVEs. Alpine uses musl libc, which is simpler and more audited than glibc for this use case.
  - **Compatibility:** The ZAM core uses no native Node.js add-ons (no `node-gyp`, no native bindings). All dependencies (`fastify`, `ajv`, `commander`) are pure JavaScript. Alpine is fully compatible.
- Exact base image: `node:20-alpine` (not `node:20-alpine3.x` pinned — use the rolling tag managed by Docker Official Images, which tracks security patches automatically).

### DQ-2: Multi-Stage Build Architecture

**Decision: Two-stage build — `builder` then `production`.**

The multi-stage build is mandatory to ensure the final image contains zero TypeScript source, zero devDependencies, and zero development artifacts.

**Stage 1 — `builder`:**
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build
```

- `npm ci` installs ALL dependencies (including devDependencies: `typescript`, `tsx`, `vitest`, `@types/node`) needed to compile.
- `npm run build` executes `tsc`, which compiles `src/**/*.ts` → `dist/` (output: `./dist` per `tsconfig.json` `outDir`).
- The `tsconfig.json` `rootDir` is `./src` and `outDir` is `./dist`. After build, `dist/` contains all compiled JS files and `.d.ts` declaration files.
- Tests are NOT run in the builder stage (they require fixtures and test infrastructure). Tests are verified separately in CI.

**Stage 2 — `production`:**
```dockerfile
FROM node:20-alpine AS production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist/
```

- Only production dependencies are installed: `fastify`, `@fastify/type-provider-typebox`, `ajv`, `commander`.
- `dist/` is copied from the builder stage. This contains compiled JS only — no `.ts` source files.
- Result: a consumer inspecting the container finds only compiled JavaScript and production npm packages. No TypeScript source, no test files, no fixtures, no schemas directory (schemas are embedded in compiled code via AJV validation at build time).

**Verification at V4-B:** After building the image, run `docker run --rm zamapi/context-plane ls /app/src` — this must fail (no `src/` in the production image).

### DQ-3: Container Entrypoint

**Decision: `CMD ["node", "dist/http-server.js"]`**

Justification:
- `src/http-server.ts` is the HTTP service entrypoint (per `docs/21` and verified in V3-D).
- It compiles to `dist/http-server.js` (matching `tsconfig.json` `rootDir: src` → `outDir: dist`).
- The file uses ES module syntax (`import`), compatible with `"type": "module"` in `package.json` and `"module": "Node16"` in `tsconfig.json`.
- Node 20 supports ES modules natively.

Full Dockerfile entrypoint lines:
```dockerfile
EXPOSE 3000
CMD ["node", "dist/http-server.js"]
```

### DQ-4: Port Exposure

**Decision: Container `EXPOSE 3000`. Default `ZAM_PORT=3000`.**

- `src/http-server.ts` reads `ZAM_PORT` env var, defaulting to `3000`.
- The Dockerfile `EXPOSE 3000` documents the default port.
- Consumer overrides via `-p 3001:3000` (external:internal) or via `ZAM_PORT` env var if changing the internal port.
- Docker Compose will map `3001:3000` by default to avoid conflict with common local development services on port 3000.

### DQ-5: Host Binding — Critical Docker Networking Fix

**Problem:** `src/http-server.ts` currently hardcodes `host = '127.0.0.1'`. Inside a Docker container, binding to `127.0.0.1` means the server is only reachable from within the container itself — not from the host or other containers. This makes the current code non-functional in a containerized deployment.

**Decision: Add `ZAM_HOST` environment variable support to `src/http-server.ts` in V4-B.**

This is an additive change only — no existing behavior is altered:

```typescript
const host = process.env['ZAM_HOST'] ?? '127.0.0.1';
```

- **Default (`ZAM_HOST` not set):** `127.0.0.1` — preserves existing local-only behavior exactly. Local development and all existing tests are unaffected.
- **Docker deployment (`ZAM_HOST=0.0.0.0`):** Server binds to all interfaces inside the container, making it reachable via the mapped port from the host.
- **Security note:** `ZAM_HOST=0.0.0.0` should only be used when `ZAM_API_KEY` is also set, enforcing authentication. The developer documentation (V4-E) must clearly communicate this requirement.

This change is permitted in V4-B because it is purely additive, does not alter any existing behavior, and does not touch any MVP core module. The Dockerfile will set `ZAM_HOST=0.0.0.0` as its default.

### DQ-6: Environment Variables — Complete Specification

All configuration is via environment variables only. No config files are read from disk inside the container.

| Variable | Type | Default | Required | Description |
|---|---|---|---|---|
| `ZAM_PORT` | integer | `3000` | No | TCP port the server listens on inside the container. |
| `ZAM_HOST` | string | `127.0.0.1` | No | Host interface to bind to. **Must be `0.0.0.0` inside Docker** to be reachable from outside the container. Set only in conjunction with `ZAM_API_KEY` in production. |
| `ZAM_API_KEY` | string | (unset) | No | If set, enforces `X-ZAM-API-Key` header authentication on every request. Absent or mismatched key → `401`. **Required for any non-local deployment.** Key value is never logged. |
| `ZAM_LOG_LEVEL` | string | `info` | No | Fastify log level. Valid values: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent`. Set to `silent` in production to prevent log-based source analysis. |

**Note on `ZAM_LOG_LEVEL`:** The Fastify logger currently accepts a `logger: boolean` option in `buildServer()`. V4-B must extend this to accept a `logLevel` string option (defaulting to the `ZAM_LOG_LEVEL` env var). This is an additive change to `src/http-server.ts` only — `buildServer()` signature in `src/http/server.ts` remains backward-compatible.

**Open Question OQ-3:** Should the Dockerfile default `ZAM_LOG_LEVEL` to `silent` in the production image? Arguments for: prevents consumers from analyzing log output to infer internal behavior. Arguments against: makes debugging harder. **Decision deferred to Sam.**

### DQ-7: Health Check Endpoint

**Decision: Add `GET /health` endpoint returning `{ "status": "ok", "version": "0.1.0" }`.**

This endpoint is required for:
- Docker health check (`HEALTHCHECK` directive).
- Kubernetes readiness/liveness probes (future).
- Consumer verification that the service is alive before making planning requests.

Implementation scope (V4-B):
- Add `src/http/routes/health.ts` — a new route file (similar to existing route files).
- Register in `src/http/server.ts` via `fastify.register(healthRoutes)`.
- Response schema: `{ status: 'ok', version: string }`.
- Version is read from `package.json` at startup (not from a hardcoded constant).
- This endpoint does NOT require `X-ZAM-API-Key` authentication — it must be reachable without credentials to serve health check purposes.

Dockerfile directive:
```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O- http://localhost:3000/health | grep -q '"status":"ok"' || exit 1
```

`wget` is used instead of `curl` because Alpine Linux includes `wget` by default.

### DQ-8: Security Hardening

**Decision: Non-root user, minimal filesystem, no unnecessary OS packages.**

**Non-root user:**
```dockerfile
RUN addgroup -S zamgroup && adduser -S zamuser -G zamgroup
USER zamuser
```

This must appear in the `production` stage before the `CMD`. The working directory `/app` must be owned by this user (or readable by it).

**No shell in production image:** Alpine images come with `sh`. We do not add `bash` or other shells. This limits the blast radius if a container is compromised.

**No development tools:** The production stage does not install `curl`, `vim`, `git`, or any other debugging tools. `wget` is available by default in Alpine and is used only by the health check.

**Read-only filesystem:** The container must be runnable with `--read-only`. ZAM is stateless — it reads nothing from disk at runtime (all schema validation is compiled into JS via AJV). If any temp directory is needed by Node.js, a `--tmpfs /tmp` mount is specified in Docker Compose. This is verified in V4-F.

**Secrets:** `ZAM_API_KEY` is NEVER baked into the image. It is always provided at runtime via environment variable or Docker secrets. The `.env.example` must prominently document this.

### DQ-9: `.dockerignore` Specification

The `.dockerignore` file prevents unnecessary files from being sent to the Docker build context, reducing build time and preventing accidental inclusion of sensitive files.

**Complete `.dockerignore` contents (to be created in V4-B):**
```
# Dependencies (installed fresh in container)
node_modules/

# Compiled output (rebuilt in container)
dist/

# Test infrastructure
tests/
fixtures/
fixtures-future/

# Schema sources (compiled into JS; not needed at runtime)
schemas/

# Development and research
.agents/
agent-board/
docs/
evaluations/
scratch/
specs/

# Runtime session data
sessions/
test-sessions/
packages/

# Build artifacts and logs
coverage/
*.tsbuildinfo
*.txt
failed_fixture_log*.txt
harness-*.txt
scratch-output.txt
temp_log.txt

# Environment files (never bake into image)
.env
.env.*

# Generated CLI outputs
prompt-plan.json
trace.json
summary.md

# Scratch and temporary files
scratch-*.cjs
scratch-*.ts

# Git
.git/
.gitignore

# Editor / OS
.DS_Store
Thumbs.db
*.swp
```

**What IS included in the build context (everything not listed above):**
- `package.json`, `package-lock.json` — required by `npm ci`
- `tsconfig.json` — required by `tsc`
- `src/` — TypeScript source (present in builder stage only; excluded from final image)

---

## 4. Architecture Decision: Docker Compose

### `docker-compose.yml` Specification

**Purpose:** Provides a one-command local deployment for developers evaluating or integrating ZAM.

**Full structure:**
```yaml
version: '3.8'

services:
  zam-api:
    build:
      context: .
      dockerfile: Dockerfile
    image: zamapi/context-plane:latest
    container_name: zam-api
    ports:
      - "${ZAM_EXTERNAL_PORT:-3001}:${ZAM_PORT:-3000}"
    environment:
      ZAM_PORT: "${ZAM_PORT:-3000}"
      ZAM_HOST: "0.0.0.0"
      ZAM_API_KEY: "${ZAM_API_KEY:-}"
      ZAM_LOG_LEVEL: "${ZAM_LOG_LEVEL:-info}"
    healthcheck:
      test: ["CMD", "wget", "-q", "-O-", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
```

**Notes:**
- `ZAM_HOST: "0.0.0.0"` is set directly (not from env) — containers always need `0.0.0.0` binding.
- `ZAM_API_KEY` is sourced from the host `.env` file — if unset, the server runs in local-only mode.
- `read_only: true` with `/tmp` tmpfs enforces the stateless, read-only filesystem requirement.
- `no-new-privileges: true` prevents privilege escalation attacks.
- `restart: unless-stopped` is appropriate for a local development service.

### `.env.example` Specification

**Full contents:**
```bash
# ZAM Context Governance API — Environment Configuration
# Copy this file to .env and fill in the values.
# NEVER commit .env to version control.

# ─── Server Configuration ───────────────────────────────────────────────────

# Port the ZAM container listens on internally (default: 3000)
ZAM_PORT=3000

# External port mapped on the host machine (default: 3001)
ZAM_EXTERNAL_PORT=3001

# Log level: trace | debug | info | warn | error | fatal | silent
# Use 'silent' in production environments.
ZAM_LOG_LEVEL=info

# ─── Authentication ──────────────────────────────────────────────────────────

# API key for authenticating requests (X-ZAM-API-Key header).
# REQUIRED for any deployment accessible beyond localhost.
# If unset, the server accepts all requests without authentication (local-only mode).
# Generate a strong random key: openssl rand -hex 32
ZAM_API_KEY=
```

---

## 5. Architecture Decision: SDK (`@zamapi/sdk`)

### DQ-10: SDK Package Location and Identity

**Decision:**
- Location: `packages/sdk/` (new directory within the existing monorepo)
- Package name: `@zamapi/sdk`
- This is a separate npm package from the core `context-plane` package.
- The SDK is the only artifact consumers install directly.
- The SDK contains zero ZAM Core code — it is a pure HTTP client.

**Package structure:**
```
packages/sdk/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts          ← main export
    client.ts         ← ZAMClient class
    types.ts          ← all TypeScript interfaces
    errors.ts         ← ZAMError class hierarchy
  dist/               ← compiled output (gitignored)
  tests/
    client.test.ts    ← unit tests (mock server responses)
```

**Dual package (CJS + ESM):**
```json
{
  "exports": {
    ".": {
      "import": "./dist/esm/index.js",
      "require": "./dist/cjs/index.js",
      "types": "./dist/types/index.d.ts"
    }
  }
}
```

This ensures compatibility with both CommonJS (`require`) and ES module (`import`) consumers without requiring configuration.

**Minimum Node.js version for SDK:** `>=18`. This is broader than the server (`>=20`) to maximize compatibility with existing codebases. Node 18 supports the global `fetch` API used by the SDK.

**Open Question OQ-1:** Should `@zamapi/sdk` be published to:
- (A) `npm` private registry (requires npm Pro plan, ~$7/month)?
- (B) GitHub Packages (private, free for private repos)?
- (C) Manual distribution (tar.gz attached to GitHub Releases)?

**Decision deferred to Sam.** The SDK code is identical regardless; only the publish target changes.

**Open Question OQ-2:** Should the Docker image be published to:
- (A) Docker Hub (private repository, requires paid plan)?
- (B) GitHub Container Registry (`ghcr.io`, free for private repos)?

**Decision deferred to Sam.**

### DQ-11: SDK Exports — Full API Surface

**`ZAMClientOptions` interface:**
```typescript
interface ZAMClientOptions {
  /** Base URL of the ZAM API server, e.g. "http://localhost:3001" */
  baseUrl: string;
  /** API key for X-ZAM-API-Key header. Omit if server is in local-only mode. */
  apiKey?: string;
  /** Request timeout in milliseconds. Default: 30000 (30 seconds). */
  timeout?: number;
  /** Number of automatic retries on network error (not on HTTP errors). Default: 0. */
  retries?: number;
}
```

**`ZAMClient` class:**
```typescript
class ZAMClient {
  constructor(options: ZAMClientOptions)

  /** Submit a planning request. Returns the context plan, trace, and summary. */
  async plan(request: PlanRequest): Promise<PlanResponse>

  /** Explain a trace produced by a prior /plan call. */
  async trace(request: TraceRequest): Promise<TraceResponse>

  /** Run fixture-based evaluation of the planning pipeline. */
  async evaluate(request: EvaluateRequest): Promise<EvaluateResponse>

  /** Check if the ZAM server is alive. Throws ZAMNetworkError if unreachable. */
  async health(): Promise<HealthResponse>
}
```

### DQ-12: SDK Type Definitions

All SDK types are defined independently in `packages/sdk/src/types.ts`. They are derived from the `docs/18` §4 API contract — NOT copied or imported from the ZAM Core package. This ensures zero coupling between the SDK and the server implementation.

**Key types (abbreviated for reference — full definitions written in V4-D):**

```typescript
interface PlanRequest {
  request: { text: string };
  registry: ComponentRegistryEntry[];
  tools?: ToolDefinition[];
  skills?: SkillDefinition[];
  history?: HistoryState;
  budget?: BudgetConfig;
}

interface PlanResponse {
  promptPlan: PromptPlan;
  trace: Trace;
  summary: string;
}

interface TraceRequest {
  trace: Trace;
}

interface TraceResponse {
  explanation: string;
}

interface EvaluateRequest {
  fixtureId: string;
  input: PlanRequest;
  expected?: Partial<PlanResponse>;
}

interface EvaluateResponse {
  fixtureId: string;
  passed: boolean;
  violations: string[];
  actualPlan: PromptPlan;
  actualTrace: Trace;
}

interface HealthResponse {
  status: 'ok';
  version: string;
}
```

### DQ-13: SDK Error Handling

All SDK errors extend a base `ZAMError` class. Raw `fetch` errors and HTTP errors are always wrapped — consumers never see raw network primitives.

**Error hierarchy:**
```typescript
class ZAMError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number | null,
    public readonly code: string,
    public readonly details?: unknown
  )
}

class ZAMAuthenticationError extends ZAMError {}  // 401
class ZAMValidationError extends ZAMError {}       // 400
class ZAMUnprocessableError extends ZAMError {}    // 422
class ZAMServerError extends ZAMError {}           // 500
class ZAMNetworkError extends ZAMError {}          // Network failure, timeout
class ZAMTimeoutError extends ZAMNetworkError {}   // Request timeout
```

**SDK behavior:**
- HTTP `401` → `ZAMAuthenticationError`
- HTTP `400` → `ZAMValidationError` (with `details` from response body)
- HTTP `422` → `ZAMUnprocessableError` (with `details`)
- HTTP `5xx` → `ZAMServerError`
- Network failure → `ZAMNetworkError`
- Timeout → `ZAMTimeoutError`
- All error classes are exported from the SDK's main entry point.

### DQ-14: SDK Has Zero ZAM Source Code

**Enforced by design.** The `packages/sdk/package.json` has no dependency on `context-plane` (the ZAM Core package). The SDK is a standalone package that communicates exclusively via HTTP.

A consumer who installs `@zamapi/sdk` gets: TypeScript types, an HTTP client class, and error classes. They get zero visibility into ZAM's planning pipeline, selector logic, schema definitions, or fixture data.

---

## 6. Architecture Decision: Developer Documentation

### DQ-15: Documentation Files

| File | Action | Purpose |
|---|---|---|
| `README.md` | Update existing (first 50 lines only) | Add Docker quickstart to the top; preserve existing content below |
| `docs/DEVELOPER_GUIDE.md` | [NEW] | Complete developer onboarding guide |
| `docs/API_REFERENCE.md` | [NEW] | Full HTTP API reference for consumers |
| `packages/sdk/README.md` | [NEW] | SDK-specific quickstart and usage examples |

### DQ-16: Developer Guide Content Requirements

`docs/DEVELOPER_GUIDE.md` must cover all of the following:

1. **Overview** — What ZAM is (Context Governance Layer, not an agent runtime), what it produces (`prompt-plan.json`, `trace.json`, `summary.md`), and how to use it with an existing agent loop.

2. **Prerequisites** — Docker Desktop (or Docker Engine + Docker Compose), any modern OS.

3. **Quickstart (3 commands):**
   ```bash
   # 1. Copy environment config
   cp .env.example .env
   # 2. Start ZAM
   docker compose up -d
   # 3. Verify
   curl http://localhost:3001/health
   ```

4. **Configuration Reference** — table of all env vars (DQ-6), with valid values and security notes.

5. **Authentication** — local mode vs. authenticated mode, how to generate an API key (`openssl rand -hex 32`), how to set `ZAM_API_KEY`, what the header looks like.

6. **SDK Installation and Usage:**
   ```typescript
   import { ZAMClient } from '@zamapi/sdk';
   const zam = new ZAMClient({ baseUrl: 'http://localhost:3001', apiKey: 'your-key' });
   const result = await zam.plan({ request: { text: 'Analyze this codebase' }, registry: [...] });
   console.log(result.promptPlan);
   ```

7. **Direct HTTP Usage** — for non-JavaScript consumers, full `curl` examples for each endpoint.

8. **Integration Pattern** — a code example showing how to wire ZAM into a typical agent loop:
   - Receive user request.
   - Build component registry from the agent's available tools/skills/context.
   - Call `POST /plan`.
   - Use the returned `promptPlan` to assemble the final prompt.
   - Send to model provider.

9. **Troubleshooting:**
   - Container not starting: check logs with `docker compose logs zam-api`.
   - `401 Unauthorized`: verify `ZAM_API_KEY` is set identically in `.env` and in client.
   - `422 Unprocessable Content`: registry is empty (must have at least one component).
   - `400 Bad Request`: request body validation failed — check `details` field.

### DQ-17: API Reference Content Requirements

`docs/API_REFERENCE.md` must document each endpoint with:
- HTTP method and path
- Authentication requirements
- Request body schema (all fields, types, required/optional)
- Response body schema (all fields)
- Full example request (as `curl` command)
- Full example response (JSON)
- All possible error codes and their meanings

Endpoints to document: `GET /health`, `POST /plan`, `POST /trace`, `POST /evaluate`.

---

## 7. Scope of V4-B through V4-G — Execution Contract

This section is the execution contract. Each sub-pass is one Coder activation with subsequent Reviewer review. No pass may proceed without Sam's approval.

| Pass | Scope | Allowed Files (modify/create) | Forbidden | Deliverable |
|---|---|---|---|---|
| **V4-B** | Production Dockerfile + host fix + health endpoint | `Dockerfile`, `.dockerignore`, `src/http-server.ts` (ZAM_HOST + ZAM_LOG_LEVEL only), `src/http/routes/health.ts` [NEW], `src/http/server.ts` (register health route only), `tests/http/health.test.ts` [NEW] | All other `src/` files, all `tests/http/` files except health test | Docker image builds; health check passes; `docker run` works; `src/http-server.ts` supports ZAM_HOST env var |
| **V4-C** | Docker Compose + environment config | `docker-compose.yml` [NEW], `.env.example` [NEW] | All source files, all test files | `docker compose up -d` starts ZAM; health check passes; `.env.example` complete |
| **V4-D** | SDK package | `packages/sdk/**` (all new) | All existing project files | `@zamapi/sdk` package with ZAMClient, types, errors, unit tests; dual CJS+ESM build |
| **V4-E** | Developer documentation | `README.md` (first section update only), `docs/DEVELOPER_GUIDE.md` [NEW], `docs/API_REFERENCE.md` [NEW], `packages/sdk/README.md` [NEW] | All source files, all test files, all schema/fixture files | Developer can onboard from zero without reading source code |
| **V4-F** | End-to-end distribution test | Temporary scratch script: `tests/scratch-docker-e2e.sh` or `tests/scratch-docker-e2e.ts` (create then delete) | All existing permanent files | Build → run → SDK call → correct response verified; scratch script deleted after |
| **V4-G** | Documentation + board finalization | `docs/31_PRODUCT_DISTRIBUTION_AND_PACKAGING.md` (update status), `agent-board/zam-planner-board.md` | All other files | Phase V4 Phase 1 Epic Conclusion added to docs/31; board updated to V4 Phase 2 |

**V4-B constraint detail:** The `src/http/server.ts` change in V4-B is limited to registering the new `healthRoutes` — one additional `fastify.register()` call. No other changes to `server.ts`. The health route implementation is entirely in the new `src/http/routes/health.ts`. The test `tests/http/health.test.ts` follows the exact pattern of the existing HTTP test files.

---

## 8. What Is Explicitly Out of Scope for Phase V4 Phase 1

| Exclusion | Reason |
|---|---|
| Phase 2: Real-World Adapter (OpenClaw/Telegram) | Separate phase with separate scoping document |
| Phase 3: SaaS / Hosted API deployment | Separate phase requiring cloud infrastructure decisions |
| Kubernetes / Helm charts | Over-engineering for current scale |
| CI/CD pipeline (GitHub Actions) | Useful but not required for Phase 1 delivery |
| Multi-architecture Docker images (ARM/AMD64) | Can be added later; single-arch sufficient for Phase 1 |
| Rate limiting | Not in `docs/18` contract; deferred per IQ-3 |
| HTTPS / TLS termination | Reverse proxy responsibility; out of scope for the container |
| Billing / usage tracking | Phase 3 concern |
| Dashboard / UI | Out of scope — this is an infrastructure product |
| Changes to `packages/runtime` | Runtime is a validation harness, not the product |

---

## 9. Risk Register

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| **R1:** `host = '127.0.0.1'` hardcode prevents Docker networking | **Critical** — container unusable without fix | Certain (already confirmed) | DQ-5: Add `ZAM_HOST` env var in V4-B. Default remains `127.0.0.1` so existing behavior unchanged. |
| **R2:** `dist/` may not include all runtime-needed assets | High — server crashes at startup | Low | `schemas/` are not read from disk at runtime (AJV validates in-memory objects). Verify in V4-F by running container and calling `/plan`. |
| **R3:** `npm ci --only=production` strips packages needed at runtime | Medium — missing imports cause crashes | Low | Fastify, AJV, commander are all in `dependencies` (not `devDependencies`). Verify in V4-B build step. |
| **R4:** Alpine libc incompatibility with native Node add-ons | Low — crash if any native dep exists | Very Low | ZAM has no native add-ons. All deps are pure JS. Verified by reviewing `package.json`. |
| **R5:** `@zamapi` npm scope not registered | Medium — SDK cannot be published | Low | OQ-1 addresses publish target. If npm scope unavailable, use `zamapi-sdk` or GitHub Packages. |
| **R6:** SDK `fetch` API not available in older Node environments | Low — consumer gets cryptic error | Low | SDK requires Node >=18 (global `fetch` available). Documented in `packages/sdk/README.md`. |
| **R7:** Health endpoint authentication bypass as attack vector | Low — minimal information exposed | Very Low | `/health` response is `{ status: 'ok', version: '0.1.0' }`. No internal state, no schema data, no trace information exposed. |

---

## 10. Success Criteria

Phase V4 Phase 1 is complete when ALL of the following are true:

| Criterion | Measurement |
|---|---|
| Docker image builds from clean checkout | `docker build -t zamapi/context-plane .` exits 0 |
| TypeScript source NOT in final image | `docker run --rm zamapi/context-plane ls /app/src` → fails (directory does not exist) |
| Health check passes | `GET http://localhost:3001/health` → `{ "status": "ok", "version": "0.1.0" }` |
| Local-mode plan request succeeds | `POST /plan` with valid registry returns 200 with `{ promptPlan, trace, summary }` |
| Authenticated-mode auth enforced | `POST /plan` without key → `401`; with correct key → `200` |
| `docker compose up -d` works | `docker compose up -d && sleep 5 && curl localhost:3001/health` succeeds |
| SDK builds successfully | `npm run build` in `packages/sdk/` exits 0 |
| SDK unit tests pass | `npm test` in `packages/sdk/` — all tests green |
| SDK plan call works | `new ZAMClient({...}).plan({...})` returns `PlanResponse` with correct TypeScript types |
| Developer onboarding < 10 minutes | A developer following `DEVELOPER_GUIDE.md` from zero reaches a successful `/plan` call in under 10 minutes |
| Zero regressions | Existing `651/651` core tests pass; existing `33/33` HTTP tests pass (no source changed in core or http paths) |
| Tracked technical debt | Known gaps recorded in `DEBT.md` rather than asserted absent; no undocumented deferrals |

---

## 11. Open Questions

These questions require Sam's decision before or during V4-B:

**OQ-1: SDK package publish target.**
Where should `@zamapi/sdk` be published so developers can install it?
- A) npm private registry (npmjs.com — requires paid plan, ~$7/month)
- B) GitHub Packages (private, free with private repository — developers need GitHub account and `npm login --registry`)
- C) Manual tar.gz distribution (attached to GitHub Releases — no registry needed, but less convenient)

**Recommendation:** B (GitHub Packages) — free, private, integrates with GitHub Actions for future CI, and developers are already familiar with the pattern.

**OQ-2: Docker image publish target.**
Where should the Docker image be hosted so approved developers can `docker pull`?
- A) Docker Hub private repository (requires paid plan after the 1 free private repo limit)
- B) GitHub Container Registry (`ghcr.io` — free with private GitHub repository)

**Recommendation:** B (GitHub Container Registry) — free, same credentials as the source repository, simpler access management.

**OQ-3: Default log level in production Docker image.**
Should the Dockerfile default `ZAM_LOG_LEVEL` to `silent`?
- A) Default `info` — easier debugging, but logs may reveal internal request shapes
- B) Default `silent` — maximum source code protection, requires explicit opt-in for debugging

**Recommendation:** A (`info`) — consumers setting up the container for the first time need visibility. They can set `ZAM_LOG_LEVEL=silent` in production. Document this recommendation in the developer guide.

---

*This document is the scoping specification for Phase V4 Phase 1. Code implementation is not authorized until Sam approves the scope and the Reviewer confirms this document is complete. OQ-1, OQ-2, and OQ-3 must be answered before V4-D (SDK) and V4-F (distribution test) begin.*
