# 24 Native Smart Runtime — Architectural Scoping

> **Document type:** Architecture Scoping Specification — Phase R1
> **Status:** Scoping Pass — No code, no runtime, no provider calls. Docs-only.
> **MVP authority:** None — does not change current MVP schemas, fixtures, or implementation.
> **Implementation status:** Not implemented. This is a design-only scoping pass that defines the architecture any future implementation must follow.
> **Canonical sources:** `docs/23_RUNTIME_SYNTHESIS_RESEARCH.md` §4–§6; `docs/20_REENTRY_LOOPS_SCOPING.md` §2–§7; `docs/18_HTTP_API_AND_ADAPTER_SPEC.md` §3–§7; `docs/04_PORTABLE_CORE_ARCHITECTURE.md` §5–§7.

---

## 1. Purpose & Architectural Position

### 1.1 What This Runtime Is

The ZAM-Native Agent Runtime is the **External Runtime / Loop Owner** described in `docs/20` §2. It is the process that:

- Receives user requests.
- Calls ZAM (`POST /plan`) to obtain a governed context plan per turn.
- Assembles provider-specific prompts from the plan.
- Submits prompts to model providers.
- Parses model responses (text answers or tool calls).
- Executes tool calls.
- Loops back to ZAM with updated state (re-entry) until the task is complete or a fail-safe triggers.
- Delivers the final answer to the user.

### 1.2 What This Runtime Is NOT

- It is NOT a context governance engine (ZAM handles that).
- It is NOT a model provider (it calls providers).
- It is NOT a prompt assembler within the core boundary — it sits above the HTTP Service Wrapper from `docs/18` §3.
- It does NOT duplicate any ZAM core logic (no selector engine, no conflict resolver, no budgeter, no trace assembly).

### 1.3 Architectural Diagram

```
  ┌───────────────────────────────────────────────────────────────┐
  │                    User / Channel Layer                       │
  │  (CLI, Telegram Bot, Web UI, IDE Extension, n8n Trigger)      │
  └─────────────────────────┬─────────────────────────────────────┘
                            │ User request (text)
  ┌─────────────────────────▼─────────────────────────────────────┐
  │              ZAM-Native Agent Runtime                          │
  │                                                                │
  │  ┌──────────────────────────────────────────────────────────┐  │
  │  │  Session Manager                                         │  │
  │  │  • Session ID, turn counter, wall-clock tracking         │  │
  │  │  • EventStream (append-only JSONL log)                   │  │
  │  │  • History State Builder                                 │  │
  │  └────────────────────────┬─────────────────────────────────┘  │
  │                           │                                    │
  │  ┌────────────────────────▼─────────────────────────────────┐  │
  │  │  Turn Loop Engine                                        │  │
  │  │  (single-threaded master loop — see §5)                  │  │
  │  └────────────────────────┬─────────────────────────────────┘  │
  │                           │                                    │
  │  ┌────────────────────────▼─────────────────────────────────┐  │
  │  │  Execution Layer                                         │  │
  │  │  ┌───────────────┐ ┌────────────┐ ┌──────────────────┐  │  │
  │  │  │ Prompt        │ │ Provider   │ │ Workspace        │  │  │
  │  │  │ Assembler     │ │ Client     │ │ Interface        │  │  │
  │  │  │ (Adapter role)│ │ (agnostic) │ │ (Local/Docker)   │  │  │
  │  │  └───────────────┘ └────────────┘ └──────────────────┘  │  │
  │  │  ┌───────────────┐ ┌────────────────────────────────┐   │  │
  │  │  │ Permission    │ │ Tool Output Optimizer          │   │  │
  │  │  │ Gate          │ │ (ACI-inspired reshaping)       │   │  │
  │  │  └───────────────┘ └────────────────────────────────┘   │  │
  │  └─────────────────────────────────────────────────────────┘  │
  │                                                                │
  │  ┌──────────────────────────────────────────────────────────┐  │
  │  │  Subscriber Bus (optional)                               │  │
  │  │  • Stuck detector • Cost tracker • Logging/telemetry     │  │
  │  └──────────────────────────────────────────────────────────┘  │
  └──────────────────────────┬────────────────────────────────────┘
                             │ POST /plan (every turn)
                             │ or in-process library call (§7 of docs/18)
  ┌──────────────────────────▼────────────────────────────────────┐
  │            ZAM Context Control Plane (Existing)                │
  │  HTTP Service Wrapper (docs/18 §3)                             │
  │    → Portable Core: Request Router → Selectors → Conflict      │
  │      Resolver → Budgeter → PPG → Trace Layer                  │
  │  Output: prompt-plan.json, trace.json, summary.md              │
  └────────────────────────────────────────────────────────────────┘
```

**Key boundary rule:** The runtime sits *above* the HTTP Service Wrapper. It is a consumer of ZAM's `POST /plan` API. It never calls core internals directly (unless using the approved library API per `docs/18` §7, which provides the same validation and fail-open guarantees).

---

## 2. Answers to Open Questions from docs/23 §9

### RQ-1: Repository Structure

**Decision:** The runtime lives as a separate package directory within the ZAM workspace: `packages/runtime/`.

**Rationale:**
- The ZAM core (`src/core/`) is the portable context control plane. The runtime is a consumer of the core, not part of it.
- `packages/runtime/` keeps the runtime within the workspace (shared version control, shared CI) while maintaining independent deployability.
- The core can be published as `context-plane` and the runtime as `@zam/runtime` — separate packages, same monorepo.
- This mirrors the architectural boundary defined in `docs/18` §3: the HTTP wrapper and adapters sit outside the core; the runtime sits above both.

**Directory structure (conceptual):**

```
packages/
  runtime/
    src/
      turn-loop.ts
      session-manager.ts
      history-state-builder.ts
      prompt-assembler.ts
      provider-client.ts
      workspace.ts
      permission-gate.ts
      tool-output-optimizer.ts
      subscriber-bus.ts
    config/
      runtime.config.json
    package.json
    tsconfig.json
```

### RQ-2: Minimum Tool Set (v0.1)

**Decision:** The v0.1 runtime ships with 5 core tools:

| Tool | Category | Permission | Description |
|---|---|---|---|
| `read_file` | Read-only | Auto-approve | Read file contents from workspace |
| `write_file` | File write | Auto-approve (within workspace) | Write or create file in workspace |
| `list_dir` | Read-only | Auto-approve | List directory contents |
| `grep_search` | Read-only | Auto-approve | Search file contents with pattern matching |
| `shell_exec` | Shell execution | Require approval | Execute a shell command |

**Rationale:**
- These 5 tools cover the fundamental operations any coding agent needs: read, write, search, list, execute.
- No network tools in v0.1 — networking introduces security surface area that requires deeper permission modeling.
- Tool definitions are data (not code) — the runtime loads them from a tool registry, not hard-coded.

### RQ-3: Prompt Assembler — Separate Module

**Decision:** The Prompt Assembler is a dedicated, separate module (`prompt-assembler.ts`).

**Rationale:**
- The Prompt Assembler performs the Adapter role defined in `docs/18` §6.1: translating `prompt-plan.json` into provider-specific message arrays.
- It must be reusable — future adapters (Telegram Bot, n8n, custom platforms) must be able to share the same assembly logic or provide their own implementations.
- It handles cache advisory translation (`stable → session → volatile` ordering per `docs/18` §6.3) which is provider-specific logic that must not leak into the Turn Loop Engine.
- Keeping it separate enforces the invariant: the Turn Loop Engine is provider-agnostic.

### RQ-4: Session Model — Single-Session First

**Decision:** Design for single-session (local CLI) first. Multi-session is structurally possible but NOT implemented in v0.1.

**Rationale:**
- The Session Manager is already per-session by design — each session has its own EventStream, turn counter, and session ID.
- Multi-session support (e.g., handling multiple concurrent users) requires a session router, session storage backend, and concurrency management — none of which are needed for a local CLI agent.
- The architecture does not preclude multi-session: adding a session router above the Turn Loop Engine is a clean extension that does not modify core runtime modules.

### RQ-5: EventStream Persistence — Disk (JSONL)

**Decision:** The EventStream MUST persist to disk as JSONL. In-memory-only is not acceptable.

**Rationale:**
- ZAM's core invariant is auditability (`docs/04` §3 goal 3: "Make every decision traceable"). The runtime's EventStream is the execution-side complement to ZAM's `trace.json`. Losing it loses the complete audit trail.
- JSONL (one JSON object per line) matches the project's existing conventions and is human-readable, easily parseable, and append-efficient.
- Disk persistence enables: session replay, post-mortem debugging, cost auditing, and compliance review.
- The performance cost of JSONL append is negligible compared to model inference latency.

**Persistence path:** Configurable via `runtime.config.json` → `eventStream.persistPath`. Default: `./sessions/{sessionId}/events.jsonl`.

### RQ-6: Configuration Format

**Decision:** A single `runtime.config.json` file. Environment variable overrides for sensitive values only.

**Rationale:**
- JSON is ZAM's native format — all schemas, inputs, and outputs use JSON. Adding YAML or TOML would introduce an inconsistency.
- API keys must never appear in committed config files. They are loaded via environment variables (e.g., `ZAM_PROVIDER_API_KEY`) and referenced in the config file by variable name.
- A single file keeps configuration discoverable and auditable — no scattered env files, dotfiles, or multi-file configs.

---

## 3. Module Architecture

### 3.1 Turn Loop Engine

**Responsibility:** Execute the single-threaded master loop that drives the Perceive–Reason–Act–Observe cycle.

**Interface:**

```typescript
interface TurnLoopEngine {
  run(session: Session, request: UserRequest): Promise<RuntimeResult>;
}

interface RuntimeResult {
  finalResponse: string;
  turnCount: number;
  exitReason: 'completed' | 'max_turns' | 'no_progress' | 'timeout' | 'error';
  sessionId: string;
}
```

**Dependencies:**
- Session Manager (for EventStream access and state)
- History State Builder (for building ZAM input)
- ZAM Client (for calling `POST /plan`)
- Prompt Assembler (for translating plan to messages)
- Provider Client (for calling model)
- Workspace (for executing tools)
- Permission Gate (for gating tool execution)
- Tool Output Optimizer (for reshaping tool results)

**Invariants:**
- The loop is single-threaded. No parallel model calls, no parallel tool executions within a single session.
- Every turn calls ZAM `POST /plan`. The loop never reuses a stale plan.
- The loop implements all fail-safes from `docs/20` §5.1.
- The loop never assembles context independently — all context decisions come from ZAM.

---

### 3.2 Session Manager

**Responsibility:** Own the EventStream lifecycle and session metadata.

**Interface:**

```typescript
interface SessionManager {
  createSession(config: RuntimeConfig): Session;
  getSession(sessionId: string): Session | null;
  closeSession(sessionId: string): void;
}

interface Session {
  sessionId: string;
  turnCounter: number;
  startedAt: string;         // ISO 8601
  eventStream: EventStream;
  config: RuntimeConfig;
}
```

**Dependencies:**
- EventStream (file system for persistence)

**Invariants:**
- Each session has exactly one EventStream.
- Session IDs are unique (UUID v4).
- Session state is never shared across sessions.
- The Session Manager does not interpret event content — it only manages the lifecycle.

---

### 3.3 History State Builder

**Responsibility:** Convert the EventStream into a ZAM-compatible `POST /plan` input body, specifically the `history` field conforming to `history-state-summary.schema.json`.

**Interface:**

```typescript
interface HistoryStateBuilder {
  buildZamInput(
    eventStream: EventStream,
    request: UserRequest,
    registry: ComponentRegistry,
    config: RuntimeConfig
  ): ZamPlanRequestBody;
}

// The output conforms to docs/18 §4.2 POST /plan request body
interface ZamPlanRequestBody {
  request: { text: string; metadata: Record<string, unknown> };
  registry: object;
  tools?: object;
  skills?: object;
  history?: object;   // history-state-summary.schema.json
  budget?: object;
  riskPolicy?: object;
  userConstraints?: object;
}
```

**Dependencies:**
- EventStream (reads events to extract history turns)
- ZAM input schemas (conceptual reference for output shape)

**Invariants:**
- Tool call + tool result EventStream entries become `open_commitments` lane turns in the history state, as specified by `docs/20` §4.1–§4.2.
- On re-entry turns, the builder sets `requestSignals.reentryTurn: true` and `requestSignals.priorPlanId` to the prior plan's `runId` (per `docs/20` §4.2–§4.3).
- The builder never modifies the component registry — it passes it through unchanged.
- The builder never fabricates history — it only translates EventStream entries into the history-state-summary schema shape.

---

### 3.4 Prompt Assembler

**Responsibility:** Translate `prompt-plan.json` into a provider-specific message array suitable for submission to a model API. This module performs the Adapter role defined in `docs/18` §6.1.

**Interface:**

```typescript
interface PromptAssembler {
  assemble(
    promptPlan: PromptPlan,
    providerName: string,
    tools: ToolDefinition[]
  ): AssembledPrompt;
}

interface AssembledPrompt {
  messages: ProviderMessage[];
  tools: ProviderToolDefinition[];
  cacheHints: CacheHint[];   // provider-specific, may be empty
}
```

**Dependencies:**
- Provider-specific formatting knowledge (message structure differences between Gemini, OpenAI, Anthropic)
- Cache advisory classification from ZAM's `selectedComponents[]` ordering

**Invariants:**
- The assembler never changes which components are included or omitted — those decisions are final from ZAM (per `docs/18` §6.2).
- Cache advisory translation is advisory only. If the target provider does not support caching, the assembler ignores the ordering (per `docs/18` §6.3).
- No provider-specific logic leaks back into the Turn Loop Engine.
- The assembler produces `stable → session → volatile` ordering in message sequences to align with ZAM's PPG output ordering.

---

### 3.5 Provider Client

**Responsibility:** Thin, model-agnostic interface for calling LLM APIs.

**Interface:**

```typescript
interface ProviderClient {
  chat(options: {
    messages: ProviderMessage[];
    tools?: ProviderToolDefinition[];
    model: string;
    cacheHints?: CacheHint[];
  }): Promise<ProviderResponse>;
}

interface ProviderResponse {
  type: 'text' | 'tool_call';
  text?: string;
  toolCalls?: ToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
  rawResponse?: unknown;  // provider-specific, for debugging only
}

interface ToolCall {
  toolName: string;
  arguments: Record<string, unknown>;
  callId: string;  // provider-assigned ID for correlation
}
```

**Dependencies:**
- Provider-specific SDK or HTTP client (one implementation per provider)

**Invariants:**
- Each provider implementation is independent and pluggable.
- No provider-specific logic exists in the Turn Loop Engine or any other module.
- The `ProviderClient` interface is the only point of contact with model APIs.
- Provider implementations handle rate limiting, retries, and API-specific error translation internally.

---

### 3.6 Workspace

**Responsibility:** Abstract tool execution across different environments (local process, Docker container).

**Interface:**

```typescript
interface Workspace {
  execute(action: ToolAction): Promise<ToolObservation>;
  getWorkspaceRoot(): string;
  isPathWithinWorkspace(path: string): boolean;
}

interface ToolAction {
  toolName: string;
  arguments: Record<string, unknown>;
  callId: string;
}

interface ToolObservation {
  callId: string;
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
}
```

**Implementations:**

- **LocalWorkspace:** Executes tools as local processes (file system operations, shell commands). This is the default for v0.1.
- **DockerWorkspace:** (Future, opt-in) Executes tools inside a Docker container for sandboxed isolation. Same interface, different execution backend.

**Invariants:**
- The Workspace interface is identical regardless of execution backend.
- All tool execution results are captured — stdout, stderr, exit codes, duration.
- The Workspace enforces workspace root boundaries: file operations outside the workspace root are rejected.
- Tool execution is synchronous from the loop's perspective — each tool call completes before the loop continues.

---

### 3.7 Permission Gate

**Responsibility:** Enforce a tiered permission system for tool actions before execution.

**Interface:**

```typescript
interface PermissionGate {
  check(action: ToolAction, session: Session): Promise<PermissionResult>;
}

interface PermissionResult {
  allowed: boolean;
  reason: string;
  requiresApproval: boolean;
  approvedBy?: 'auto' | 'user';
}
```

**Permission Categories:**

| Category | Example Tools | Default Policy |
|---|---|---|
| `read_only` | `read_file`, `list_dir`, `grep_search` | Auto-approve |
| `file_write` | `write_file` | Auto-approve within workspace |
| `shell_exec` | `shell_exec` | Require user approval (configurable) |
| `destructive` | `rm`, `drop`, `truncate` | Always require approval |
| `network` | `curl`, `wget`, `fetch` | Require approval (not in v0.1) |

**Dependencies:**
- Runtime config (permission category overrides)
- User approval callback (for interactive approval)

**Invariants:**
- Auto-approved actions are logged in the EventStream but not shown to the user.
- Actions requiring approval block the loop until the user responds.
- Rejection causes the tool call to fail with a `permission_denied` error, which is recorded in the EventStream and sent back to the model on re-entry.
- Permission categories are configurable via `runtime.config.json` — operators can upgrade or downgrade any category.

---

### 3.8 Tool Output Optimizer

**Responsibility:** Reshape raw tool execution output for efficient LLM consumption (ACI-inspired, per `docs/23` BEST-5).

**Interface:**

```typescript
interface ToolOutputOptimizer {
  optimize(observation: ToolObservation, config: OptimizerConfig): OptimizedOutput;
}

interface OptimizerConfig {
  maxOutputLines: number;       // default: 100
  maxOutputChars: number;       // default: 10000
  stripAnsiCodes: boolean;      // default: true
  errorExtractionMode: boolean; // default: true
}

interface OptimizedOutput {
  content: string;
  truncated: boolean;
  originalLines: number;
  originalChars: number;
}
```

**Optimization Rules (with defaults):**

| Rule | Default | Description |
|---|---|---|
| Line truncation | 100 lines | Cap output at N lines. Append `[... truncated N remaining lines]` if exceeded. |
| Character truncation | 10,000 chars | Hard cap on total output characters. |
| ANSI stripping | enabled | Remove ANSI escape codes (color, cursor, formatting). |
| Whitespace normalization | enabled | Collapse consecutive blank lines into one. |
| Error extraction | enabled | For outputs containing error patterns (stack traces, compilation errors), extract only the relevant error lines + 3 lines of context. |
| Summary + tail | automatic | For outputs > 100 lines, show first 10 lines + last 20 lines + `[... N lines omitted]` summary in between. |

**Invariants:**
- The optimizer never modifies the semantic meaning of tool output — it only formats and truncates.
- Truncation is always clearly marked in the output so the model knows information was removed.
- The original line count and character count are preserved in the `OptimizedOutput` metadata.

---

### 3.9 Subscriber Bus

**Responsibility:** Optional event bus that enables auxiliary services to observe EventStream activity without coupling to the core loop.

**Interface:**

```typescript
interface SubscriberBus {
  subscribe(handler: EventHandler): void;
  unsubscribe(handler: EventHandler): void;
}

type EventHandler = (event: EventStreamEntry) => void;
```

**Built-in Subscribers (future):**

| Subscriber | Purpose |
|---|---|
| Stuck Detector | Detect no-progress loops (identical responses, repeated tool failures). Emit advisory signal to the Turn Loop Engine. |
| Cost Tracker | Track cumulative token usage and estimated cost across turns. Emit warning if approaching budget limits. |
| Telemetry Logger | Emit structured telemetry events for monitoring and dashboards. |
| Security Scanner | Scan tool actions for policy violations before or after execution. |

**Invariants:**
- Subscribers are read-only observers. They cannot modify events, block the loop, or alter control flow.
- The exception is the Stuck Detector, which may set an advisory flag that the Turn Loop Engine checks during its no-progress evaluation.
- Subscriber failures are isolated — a failing subscriber does not crash the loop.
- The bus is optional. If no subscribers are registered, the loop runs identically.

---

## 4. EventStream Schema

### 4.1 Entry Shape

Each EventStream entry is a single JSON object, stored as one line in a JSONL file:

```typescript
interface EventStreamEntry {
  entryId: string;          // UUID v4 — unique per entry
  sessionId: string;        // Session this entry belongs to
  turnIndex: number;        // 0-indexed turn within the session
  type: EventType;
  timestamp: string;        // ISO 8601 with milliseconds
  content: EventContent;    // Polymorphic based on type
}

type EventType =
  | 'user_message'      // User's original request or follow-up
  | 'zam_plan'          // ZAM POST /plan response (plan + trace)
  | 'model_response'    // Model provider response (text or tool calls)
  | 'tool_call'         // Tool invocation request (from model)
  | 'tool_result'       // Tool execution result
  | 'error'             // Error event (provider error, tool error, etc.)
  | 'system_event';     // Lifecycle events (session start, session end, config loaded)
```

### 4.2 Content Shapes Per Type

```typescript
// user_message
interface UserMessageContent {
  text: string;
  metadata?: Record<string, unknown>;
}

// zam_plan
interface ZamPlanContent {
  runId: string;                // ZAM's trace.run.runId — used for reentryPhase.priorPlanId
  promptPlan: object;           // Full prompt-plan.json from ZAM
  trace: object;                // Full trace.json from ZAM
  summary: string;              // summary.md string from ZAM
  isReentry: boolean;           // true if this was a re-entry call
}

// model_response
interface ModelResponseContent {
  type: 'text' | 'tool_call';
  text?: string;
  toolCalls?: ToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
  providerName: string;
  model: string;
}

// tool_call
interface ToolCallContent {
  callId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  permissionResult: PermissionResult;
}

// tool_result
interface ToolResultContent {
  callId: string;               // Correlates with tool_call.callId
  toolName: string;
  success: boolean;
  output: string;               // Optimized output (post-ToolOutputOptimizer)
  rawOutputLength: number;      // Original output length before optimization
  truncated: boolean;
  durationMs: number;
  error?: string;
}

// error
interface ErrorContent {
  errorType: 'provider_error' | 'tool_error' | 'zam_error' | 'permission_denied' | 'config_error' | 'internal_error';
  message: string;
  recoverable: boolean;
  details?: Record<string, unknown>;
}

// system_event
interface SystemEventContent {
  event: 'session_start' | 'session_end' | 'config_loaded' | 'fail_safe_triggered';
  details?: Record<string, unknown>;
}
```

### 4.3 Mapping EventStream to ZAM `POST /plan` Input

The History State Builder converts EventStream entries into ZAM-compatible history turns as follows:

| EventStream Type | ZAM History Lane | `role` | Notes |
|---|---|---|---|
| `user_message` | `recent_raw_turns` | `user` | User's request text becomes a history turn |
| `model_response` (text) | `recent_raw_turns` | `assistant` | Model's text response |
| `tool_call` | `open_commitments` | `assistant` | Tool call request, per `docs/20` §4.1 |
| `tool_result` | `open_commitments` | `tool` | Tool execution result, per `docs/20` §4.1 |
| `error` (tool_error) | `open_commitments` | `tool` | Failed tool execution, per `docs/20` §5.1 |
| `zam_plan` | (not included in history) | — | Plans are not history turns; they are archived separately |
| `system_event` | (not included in history) | — | Lifecycle events are not history turns |

**Critical mapping rule:** `tool_call` + `tool_result` pairs are placed in the `open_commitments` lane with `dropAllowed: false`. This ensures ZAM's History Lane Manager (`docs/04` §7.6) protects them from budget trimming.

**Re-entry signal construction (per `docs/20` §4.2):**
- On any turn after the first, the History State Builder sets `requestSignals.reentryTurn: true`.
- It also sets `requestSignals.priorPlanId` to the `runId` from the most recent `zam_plan` entry in the EventStream (per `docs/20` §4.3).

---

## 5. Turn Loop Algorithm

### 5.1 Precise Algorithm

```
FUNCTION run(session, userRequest) → RuntimeResult:
  SET turnIndex = 0
  SET startTime = now()
  SET lastPlanHash = null
  SET lastResponseHash = null

  // Step 0: Record user message
  session.eventStream.append({
    type: 'user_message',
    turnIndex: 0,
    content: { text: userRequest.text, metadata: userRequest.metadata }
  })

  LOOP:
    // Step 1: Check fail-safes
    IF turnIndex >= config.loop.maxTurns:
      session.eventStream.append({ type: 'system_event', content: { event: 'fail_safe_triggered', details: { reason: 'max_turns' } } })
      RETURN { exitReason: 'max_turns', turnCount: turnIndex, finalResponse: bestAvailableResponse() }

    IF (now() - startTime) >= config.loop.timeoutMs:
      session.eventStream.append({ type: 'system_event', content: { event: 'fail_safe_triggered', details: { reason: 'timeout' } } })
      RETURN { exitReason: 'timeout', turnCount: turnIndex, finalResponse: bestAvailableResponse() }

    // Step 2: Build ZAM input
    TRY:
      zamInput = historyStateBuilder.buildZamInput(session.eventStream, userRequest, registry, config)
    CATCH buildError:
      session.eventStream.append({ type: 'error', content: { errorType: 'internal_error', message: buildError.message, recoverable: false } })
      RETURN { exitReason: 'error', turnCount: turnIndex, finalResponse: 'Internal error building context.' }

    // Step 3: Call ZAM POST /plan
    TRY:
      zamResponse = zamClient.plan(zamInput)
    CATCH zamError:
      session.eventStream.append({ type: 'error', content: { errorType: 'zam_error', message: zamError.message, recoverable: false } })
      RETURN { exitReason: 'error', turnCount: turnIndex, finalResponse: 'Context planning failed.' }

    // Step 3a: Record ZAM plan in EventStream
    session.eventStream.append({
      type: 'zam_plan',
      turnIndex: turnIndex,
      content: {
        runId: zamResponse.trace.run.runId,
        promptPlan: zamResponse.promptPlan,
        trace: zamResponse.trace,
        summary: zamResponse.summary,
        isReentry: turnIndex > 0
      }
    })

    // Step 3b: No-progress detection (plan)
    planHash = hash(zamResponse.promptPlan)
    IF planHash == lastPlanHash:
      session.eventStream.append({ type: 'system_event', content: { event: 'fail_safe_triggered', details: { reason: 'no_progress_plan' } } })
      RETURN { exitReason: 'no_progress', turnCount: turnIndex, finalResponse: bestAvailableResponse() }
    lastPlanHash = planHash

    // Step 4: Assemble prompt from plan
    assembledPrompt = promptAssembler.assemble(zamResponse.promptPlan, config.provider.name, zamResponse.promptPlan.selectedTools)

    // Step 5: Call model provider
    TRY:
      providerResponse = providerClient.chat({
        messages: assembledPrompt.messages,
        tools: assembledPrompt.tools,
        model: config.provider.model,
        cacheHints: assembledPrompt.cacheHints
      })
    CATCH providerError:
      session.eventStream.append({ type: 'error', content: { errorType: 'provider_error', message: providerError.message, recoverable: true } })
      // Provider errors are recoverable — record and re-enter ZAM with error in history
      turnIndex++
      CONTINUE LOOP

    // Step 5a: Record model response in EventStream
    session.eventStream.append({
      type: 'model_response',
      turnIndex: turnIndex,
      content: {
        type: providerResponse.type,
        text: providerResponse.text,
        toolCalls: providerResponse.toolCalls,
        usage: providerResponse.usage,
        providerName: config.provider.name,
        model: config.provider.model
      }
    })

    // Step 6: Parse model response
    IF providerResponse.type == 'text':
      // Step 6a: Text answer — deliver to user, end loop
      RETURN { exitReason: 'completed', turnCount: turnIndex + 1, finalResponse: providerResponse.text }

    IF providerResponse.type == 'tool_call':
      // Step 6b: No-progress detection (response)
      responseHash = hash(providerResponse.toolCalls)
      IF responseHash == lastResponseHash:
        session.eventStream.append({ type: 'system_event', content: { event: 'fail_safe_triggered', details: { reason: 'no_progress_response' } } })
        RETURN { exitReason: 'no_progress', turnCount: turnIndex, finalResponse: bestAvailableResponse() }
      lastResponseHash = responseHash

      // Step 6c: Execute each tool call sequentially
      FOR EACH toolCall IN providerResponse.toolCalls:

        // Step 6c-i: Permission gate
        permResult = permissionGate.check(toolCall, session)
        session.eventStream.append({
          type: 'tool_call',
          turnIndex: turnIndex,
          content: { callId: toolCall.callId, toolName: toolCall.toolName, arguments: toolCall.arguments, permissionResult: permResult }
        })

        IF NOT permResult.allowed:
          session.eventStream.append({
            type: 'tool_result',
            turnIndex: turnIndex,
            content: { callId: toolCall.callId, toolName: toolCall.toolName, success: false, output: '', error: 'Permission denied: ' + permResult.reason, truncated: false, rawOutputLength: 0, durationMs: 0 }
          })
          CONTINUE FOR

        // Step 6c-ii: Execute via Workspace
        TRY:
          rawObservation = workspace.execute(toolCall)
        CATCH toolError:
          session.eventStream.append({
            type: 'tool_result',
            turnIndex: turnIndex,
            content: { callId: toolCall.callId, toolName: toolCall.toolName, success: false, output: '', error: toolError.message, truncated: false, rawOutputLength: 0, durationMs: 0 }
          })
          session.eventStream.append({ type: 'error', content: { errorType: 'tool_error', message: toolError.message, recoverable: true } })
          CONTINUE FOR

        // Step 6c-iii: Optimize output
        optimized = toolOutputOptimizer.optimize(rawObservation, config.optimizer)

        // Step 6c-iv: Record tool result in EventStream
        session.eventStream.append({
          type: 'tool_result',
          turnIndex: turnIndex,
          content: {
            callId: toolCall.callId,
            toolName: toolCall.toolName,
            success: rawObservation.success,
            output: optimized.content,
            rawOutputLength: optimized.originalChars,
            truncated: optimized.truncated,
            durationMs: rawObservation.durationMs,
            error: rawObservation.error
          }
        })

      END FOR

      // Step 7: Notify subscriber bus
      subscriberBus.notifyAll(session.eventStream.latestEntries())

      // Step 8: Re-enter loop
      turnIndex++
      CONTINUE LOOP

  END LOOP
END FUNCTION
```

### 5.2 Fail-Safe Summary (per `docs/20` §5.1)

| Fail-Safe | Source | Implementation |
|---|---|---|
| Maximum re-entry count | `docs/20` §5.1 | `config.loop.maxTurns` (default: 10). Checked at Step 1. |
| No-progress detection (plan) | `docs/20` §5.1 | Hash comparison of consecutive `prompt-plan.json` at Step 3b. |
| No-progress detection (response) | `docs/20` §5.1 | Hash comparison of consecutive model tool calls at Step 6b. |
| Wall-clock timeout | `docs/20` §5.1 | `config.loop.timeoutMs` (default: 300000 = 5 minutes). Checked at Step 1. |
| Tool execution failure | `docs/20` §5.1 | Error recorded in EventStream; loop continues with error in history. Model decides how to proceed. |
| Provider error | Runtime safety | Error recorded in EventStream; loop re-enters ZAM with error in history. |

### 5.3 `reentryPhase` Trace Population

Per `docs/20` §7, the `reentryPhase[]` array in ZAM's trace output is populated by ZAM itself based on the re-entry signals provided by the runtime. The runtime's role is:

1. On re-entry turns (`turnIndex > 0`), set `requestSignals.reentryTurn: true` in the ZAM input.
2. Set `requestSignals.priorPlanId` to the `runId` from the most recent `zam_plan` event.
3. ZAM's pipeline processes these signals and populates `reentryPhase[]` with:
   - `trigger`: derived from the last `tool_result` in history (e.g., `"tool_result:grep_search"`).
   - `updatedLanes`: lanes that received new content (`open_commitments`, `recent_raw_turns`).
   - `reentryTraceId`: unique ID for this re-entry event.
   - `priorPlanId`: the `runId` the runtime provided.

The runtime archives the full `trace.json` (including `reentryPhase[]`) in the EventStream as a `zam_plan` entry for each turn.

---

## 6. Provider Client Abstraction

### 6.1 Provider Interface

The `ProviderClient` interface (§3.5) is the sole abstraction for all model interactions. Provider implementations include:

| Provider | Implementation | Notes |
|---|---|---|
| Gemini | `GeminiProviderClient` | Uses `@google/genai` SDK. Supports tool calling via `functionDeclarations`. |
| OpenAI | `OpenAIProviderClient` | Uses `openai` SDK. Supports `tools` parameter with function calling. |
| Anthropic | `AnthropicProviderClient` | Uses `@anthropic-ai/sdk`. Supports tool_use blocks and `cache_control`. |

### 6.2 Cache Advisory Translation

The Prompt Assembler handles cache advisory translation per `docs/18` §6.3:

1. ZAM's `selectedComponents[]` are ordered `stable → session → volatile`.
2. The Prompt Assembler reads this ordering and generates provider-specific cache hints.

| Core Advisory | Anthropic Translation | OpenAI Translation | Gemini Translation |
|---|---|---|---|
| `stable` components | `cache_control: { type: 'ephemeral' }` on the last stable message | Rely on automatic prefix caching (position-based) | `cachedContent` config (if supported) |
| `session` components | No explicit cache control (naturally follows stable) | Same prefix caching | No explicit control |
| `volatile` components | No cache control | No cache control | No cache control |

**Invariant:** Cache translation never changes component membership. If a provider does not support caching, the assembler simply ignores the advisory ordering.

### 6.3 Provider Isolation

- Each provider implementation is a separate file (`gemini-provider.ts`, `openai-provider.ts`, `anthropic-provider.ts`).
- The Turn Loop Engine references only the `ProviderClient` interface, never a concrete implementation.
- Provider selection is determined by `config.provider.name` at startup.
- No provider-specific error codes, response shapes, or behaviors leak into the Turn Loop Engine.

---

## 7. Workspace & Permission Gate

### 7.1 LocalWorkspace Implementation

The default `LocalWorkspace` executes tools as local processes:

| Tool | Execution Method |
|---|---|
| `read_file` | `fs.readFile()` — reads file contents, returns as string |
| `write_file` | `fs.writeFile()` — writes content to file, creates parent directories |
| `list_dir` | `fs.readdir()` — lists directory contents with metadata |
| `grep_search` | `child_process.exec('grep ...')` or built-in pattern matching |
| `shell_exec` | `child_process.exec()` — runs command in a subprocess with configurable timeout |

**Security boundary:**
- All file paths are validated against the workspace root before execution.
- Paths that resolve outside the workspace root are rejected with a `security_violation` error.
- Shell commands inherit a restricted environment (no access to secrets, limited PATH).

### 7.2 DockerWorkspace (Future, Opt-In)

A future `DockerWorkspace` implementation would:
- Spin up a Docker container per session (or reuse a warm container).
- Mount the workspace root as a volume.
- Execute all tools inside the container.
- Capture stdout/stderr via Docker exec.
- Use the same `Workspace` interface — transparent to the Turn Loop Engine.

### 7.3 Tool Output Optimizer Defaults

| Parameter | Default | Rationale |
|---|---|---|
| `maxOutputLines` | 100 | Matches SWE-agent's proven window size. Balances context vs. information density. |
| `maxOutputChars` | 10,000 | Hard cap prevents extremely long single-line outputs from consuming context budget. |
| `stripAnsiCodes` | `true` | ANSI codes waste tokens and are meaningless to LLMs. |
| `errorExtractionMode` | `true` | Stack traces are mostly noise. Extracting the error line + 3 lines of context is sufficient for model reasoning. |

---

## 8. Configuration

### 8.1 `runtime.config.json` Schema Shape

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["zam", "provider"],
  "properties": {
    "zam": {
      "type": "object",
      "required": ["endpoint"],
      "properties": {
        "endpoint": {
          "type": "string",
          "description": "ZAM endpoint. Use 'library' for in-process calls or an HTTP URL (e.g., 'http://localhost:3000') for HTTP calls.",
          "examples": ["library", "http://localhost:3000"]
        }
      }
    },
    "provider": {
      "type": "object",
      "required": ["name", "model"],
      "properties": {
        "name": {
          "type": "string",
          "enum": ["gemini", "openai", "anthropic", "openrouter"],
          "description": "Provider name."
        },
        "model": {
          "type": "string",
          "description": "Model identifier (e.g., 'gemini-2.5-pro', 'gpt-4.1', 'claude-sonnet-4')."
        },
        "apiKeyEnvVar": {
          "type": "string",
          "description": "Name of the environment variable containing the API key. NOT the key itself.",
          "default": "ZAM_PROVIDER_API_KEY"
        }
      }
    },
    "workspace": {
      "type": "object",
      "properties": {
        "mode": {
          "type": "string",
          "enum": ["local", "docker"],
          "default": "local"
        },
        "rootPath": {
          "type": "string",
          "description": "Workspace root directory. Default: current working directory."
        }
      }
    },
    "loop": {
      "type": "object",
      "properties": {
        "maxTurns": {
          "type": "integer",
          "minimum": 1,
          "maximum": 50,
          "default": 10,
          "description": "Maximum number of turns (including re-entry turns) before the loop terminates."
        },
        "timeoutMs": {
          "type": "integer",
          "minimum": 1000,
          "default": 300000,
          "description": "Maximum wall-clock time in milliseconds for the entire loop."
        }
      }
    },
    "permissions": {
      "type": "object",
      "description": "Override default permission categories. Keys are tool names, values are policy overrides.",
      "additionalProperties": {
        "type": "string",
        "enum": ["auto_approve", "require_approval", "deny"]
      }
    },
    "eventStream": {
      "type": "object",
      "properties": {
        "persistPath": {
          "type": "string",
          "description": "Directory for JSONL event stream files. Default: './sessions/{sessionId}/'.",
          "default": "./sessions"
        }
      }
    },
    "optimizer": {
      "type": "object",
      "properties": {
        "maxOutputLines": { "type": "integer", "default": 100 },
        "maxOutputChars": { "type": "integer", "default": 10000 },
        "stripAnsiCodes": { "type": "boolean", "default": true },
        "errorExtractionMode": { "type": "boolean", "default": true }
      }
    }
  }
}
```

### 8.2 Environment Variable Overrides

| Variable | Purpose | Overrides |
|---|---|---|
| `ZAM_PROVIDER_API_KEY` | Model provider API key | `config.provider.apiKeyEnvVar` |
| `ZAM_ENDPOINT` | ZAM endpoint URL | `config.zam.endpoint` |
| `ZAM_WORKSPACE_ROOT` | Workspace root path | `config.workspace.rootPath` |

Environment variables take precedence over config file values when both are present.

---

## 9. Integration Contract with ZAM

### 9.1 Core Principle

> **The runtime is a consumer of ZAM's `POST /plan` API. It never modifies ZAM core.**

The runtime calls ZAM; ZAM produces a context plan; the runtime executes the plan. This relationship is one-directional and strictly bounded.

### 9.2 Request Building (EventStream → ZAM Input)

On every turn, the History State Builder converts the EventStream into a `POST /plan` request body:

1. **Extract user request:** The original `user_message` event's text becomes `request.text`.
2. **Build history:** Convert relevant EventStream entries into history turns following the mapping in §4.3.
3. **Attach registry:** Pass the component registry unchanged.
4. **Attach tools:** Pass available tool definitions unchanged.
5. **Attach budget/risk/constraints:** Pass from config unchanged.
6. **Set re-entry signals:** On turns > 0, set `requestSignals.reentryTurn: true` and `requestSignals.priorPlanId`.

### 9.3 Response Consumption (ZAM Output → Runtime Actions)

The runtime reads and uses the `POST /plan` response as follows:

| ZAM Output Field | Runtime Action |
|---|---|
| `promptPlan.selectedComponents[]` | Prompt Assembler converts these into provider message content, in the order provided (respecting cache stability advisory). |
| `promptPlan.omittedComponents[]` | Ignored by the runtime — these are ZAM's decisions, not the runtime's concern. |
| `promptPlan.deferredComponents[]` | Ignored by the runtime — deferred components are not included in the prompt. |
| `promptPlan.selectedTools[]` | Prompt Assembler converts these into provider-specific tool definitions for the model. |
| `trace` | Archived in the EventStream as a `zam_plan` event. Available for post-session audit. |
| `summary` | Archived in the EventStream. May be displayed to the user for debugging. |

### 9.4 Re-Entry Flow (Precise)

This implements the exact flow from `docs/20` §3:

```
Turn 1 (fresh):
  1. Runtime builds ZAM input with user request + empty history.
  2. Runtime calls POST /plan.
  3. ZAM returns prompt-plan.json (Turn 1).
  4. Runtime assembles prompt, calls model.
  5. Model responds with tool_call(grep_search, { query: "TODO" }).
  6. Runtime gates permission → auto-approve (read_only).
  7. Runtime executes grep_search → result.
  8. Runtime optimizes output.
  9. Runtime appends tool_call + tool_result to EventStream.
  10. Re-entry decision: tool result must be incorporated.

Turn 2 (re-entry):
  11. Runtime builds ZAM input with updated history:
      - history.turns includes tool_call (lane: open_commitments, role: assistant)
      - history.turns includes tool_result (lane: open_commitments, role: tool)
      - requestSignals.reentryTurn = true
      - requestSignals.priorPlanId = Turn 1's runId
  12. Runtime calls POST /plan (re-entry).
  13. ZAM returns prompt-plan.json (Turn 2) with updated context.
  14. ZAM's trace includes reentryPhase[{ trigger: "tool_result:grep_search", ... }].
  15. Runtime assembles prompt from new plan, calls model.
  16. Model responds with text answer.
  17. Runtime delivers answer to user. Loop ends.
```

### 9.5 What the Runtime Never Does

| Action | Why Forbidden |
|---|---|
| Assemble context without calling ZAM | Violates BEST-3 (ZAM as context brain). All context decisions must be governed. |
| Modify `selectedComponents[]` membership | Violates `docs/18` §6.2. Component selection is final from ZAM. |
| Compress or summarize history independently | Violates ANTI-2 (unstructured compaction). History governance belongs to ZAM's lane manager. |
| Cache a prior plan and skip ZAM on re-entry | Violates `docs/20` §6 (no pipeline shortcuts). Full pipeline runs every time. |
| Add provider-specific fields to ZAM input | Violates `docs/18` §2 (vendor-neutrality invariant). |

---

## 10. MVP Non-Interference Statement

This document does not:

- Change any existing MVP schema (`schemas/inputs/`, `schemas/outputs/`).
- Change any existing harness fixture.
- Change test counts (651 suite, 27 evaluate passed, 1 approved-skipped).
- Alter any existing selector, conflict resolver, budgeter, or trace behavior.
- Authorize implementation of any runtime code.
- Add any file to `src/core/`, `schemas/`, `fixtures/`, or `tests/`.
- Change `docs/04`, `docs/05`, `docs/06`, `docs/11`, `docs/12`, `docs/13`, `docs/18`, or `docs/20`.

This document is the architectural scoping specification that precedes future implementation passes (Phase R2+). It defines module boundaries and contracts; it does not implement them.

---

## 11. Phased Implementation Roadmap

### Phase R2: Core Skeleton

**Goal:** Minimal working loop — user text in, model text out (no tools).

**Components built:**
- Turn Loop Engine (simplified: no tool execution path)
- Session Manager + EventStream (JSONL persistence)
- History State Builder (basic: user + assistant turns only)
- Prompt Assembler (single provider)
- Provider Client (one implementation — Gemini or OpenAI)
- Runtime config loading

**Not built:** Workspace, Permission Gate, Tool Output Optimizer, Subscriber Bus.

**Verification:** Unit tests for each module. End-to-end test: send a text request, receive a model response, verify EventStream contains correct entries.

---

### Phase R3: Tool Execution

**Goal:** First end-to-end agentic loop — tools can be called and results fed back.

**Components built:**
- LocalWorkspace (5 core tools from RQ-2)
- Permission Gate (tiered system)
- Tool Output Optimizer
- Turn Loop Engine tool execution path (Steps 6b–6c from §5.1)
- History State Builder re-entry signal construction

**Verification:** End-to-end test: request requiring tool use → tool called → result fed back → model produces final answer. Verify re-entry flow matches `docs/20` §3 exactly.

---

### Phase R4: Provider Expansion + Cache Advisory

**Goal:** Multi-provider support and cache advisory translation.

**Components built:**
- Additional Provider Client implementations (OpenAI, Anthropic, or Gemini — whichever was not built in R2)
- Prompt Assembler cache advisory translation (stable/session/volatile → provider-specific hints per `docs/18` §6.3)
- Provider selection via config

**Verification:** Same end-to-end tests run against each provider. Verify cache hints are generated correctly for each provider format.

---

### Phase R5: Extensibility + Hardening

**Goal:** Production-grade extensibility and optional sandboxing.

**Components built:**
- Subscriber Bus
- Built-in subscribers: Stuck Detector, Cost Tracker, Telemetry Logger
- DockerWorkspace (opt-in)
- Multi-session groundwork (Session Manager routing, but not full multi-user)

**Verification:** Subscriber tests (stuck detection accuracy, cost tracking accuracy). Docker integration test. Session isolation test.

---

## 12. Open Questions for Phase R2

| # | Question | Impact |
|---|---|---|
| R2-Q1 | Which provider should be the first implementation target (Gemini or OpenAI)? | Determines Phase R2 scope. Recommendation: Gemini (lower latency, native JSON mode). |
| R2-Q2 | Should the ZAM client in v0.1 use HTTP (`POST /plan`) or the in-process library API (`docs/18` §7)? | In-process is simpler for v0.1 (no HTTP server needed) but requires the core to export a library API first. |
| R2-Q3 | What testing framework should be used for runtime tests? (Vitest, Jest, or the existing harness?) | Must be compatible with the existing project setup but may differ from the core's harness. |
| R2-Q4 | Should the EventStream JSONL file be flushed after every entry (immediate durability) or buffered? | Immediate flush is safer for audit but has minor I/O overhead. Recommendation: immediate flush. |
| R2-Q5 | What is the CLI interface for the runtime? (e.g., `zam-agent run "prompt"`, or interactive REPL?) | Determines user experience for the first implementation pass. |
| R2-Q6 | Should the runtime load the component registry from the same source as the core CLI, or accept it as a config parameter? | Determines the bootstrapping flow. |

---

## 13. Summary

| Area | Decision |
|---|---|
| Repository structure | `packages/runtime/` — separate package within ZAM workspace |
| Loop model | Single-threaded master loop, `while (not done)` pattern |
| Context governance | Delegated entirely to ZAM — runtime calls `POST /plan` every turn |
| Event tracking | EventStream — immutable, append-only JSONL log persisted to disk |
| Tool execution | Workspace abstraction (local default, Docker opt-in) |
| Tool output | ACI-inspired optimization (truncation, formatting, error extraction) |
| Permissions | Tiered gate: auto-approve safe, require approval for destructive |
| Provider | Model-agnostic pluggable client (Gemini, OpenAI, Anthropic) |
| Prompt assembly | Separate Prompt Assembler module (Adapter role per docs/18 §6) |
| Cache advisory | Advisory-only translation from ZAM ordering to provider-specific hints |
| Configuration | `runtime.config.json` + env vars for secrets |
| Session model | Single-session (CLI) first; multi-session structurally possible |
| Extensibility | Subscriber bus for auxiliary services (stuck detection, cost tracking) |
| Re-entry | Exact implementation of `docs/20` §3 flow |
| Anti-patterns avoided | No static context injection, no unstructured compaction, no unbounded history, no heavy infra, no vendor lock-in |
| MVP interference | None |
| Implementation roadmap | R2 (skeleton) → R3 (tools) → R4 (providers) → R5 (extensibility) |
