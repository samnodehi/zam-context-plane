# 23 Runtime Architecture Synthesis Research

> **Document type:** Research Synthesis Note — Phase R0
> **Status:** Research-grade. No code, no implementation. Docs-only.
> **MVP authority:** None — does not change current MVP schemas, fixtures, or implementation.
> **Implementation status:** Not implemented. This is a research synthesis to inform the design of the ZAM-native Agent Runtime.
> **Canonical sources:** `PROJECT_MASTER_PLAN.md` §14; `docs/02_SYSTEM_COMPARISON_MATRIX.md`; `docs/18_HTTP_API_AND_ADAPTER_SPEC.md` §6–§7; `docs/20_REENTRY_LOOPS_SCOPING.md`.

---

## 1. Purpose

Before designing the ZAM-native Agent Runtime (Phase R1), we must understand how existing state-of-the-art agent runtimes handle three critical concerns:

1. **Loop Structure:** How does the runtime manage the iterative Perceive–Reason–Act–Observe cycle?
2. **Tool Execution Model:** How are tools invoked, sandboxed, and observed?
3. **State Management:** How does the runtime maintain working memory and history without bloating the context window?

This document analyzes five systems — **OpenClaw**, **Claude Code**, **OpenHands**, **SWE-agent**, and **Codex CLI** — extracts their best ideas, identifies their weaknesses, and proposes a hybrid synthesis for ZAM's own lightweight runtime.

**Critical constraint:** ZAM already handles context governance, prompt planning, and trace auditing. The runtime we design must **not** duplicate any of that. It only needs to own the execution loop, tool invocation, provider communication, and session state — then delegate all context decisions to ZAM via `POST /plan`.

---

## 2. System Analysis

### 2.1 OpenClaw

**Architecture model:** Hub-and-spoke gateway runtime. A persistent Node.js process (the "Gateway") manages WebSocket connections to messaging platforms, routes messages to agent sessions, and maintains stateful persistence.

#### Loop Structure

OpenClaw uses a cyclical **Intake → Context Assembly → Model Inference → Tool Execution → Streaming & Persistence** loop:

1. The Gateway receives a user message and routes it to the designated agent session.
2. The runtime builds a comprehensive context package by aggregating core instruction files (`AGENTS.md`, `SOUL.md`), eligible skill prompts, and serialized history (JSONL format).
3. The agent invokes an LLM (model-agnostic) with the assembled context and available tools.
4. If the model requests tool execution, the runtime executes the tool and feeds results back.
5. Session state (including full history) is persisted.

**Key pattern:** Serialization per session — a "Lane Queue" ensures sequential processing within a single session, preventing race conditions and tool conflicts.

#### Tool Execution Model

- Tools are executed directly in the local environment (file system operations, web search, shell commands).
- Tool policy enforcement exists but is relatively coarse.
- Security relies on deep audits of community skill packs, which is fragile.

#### State Management

- **History persistence:** JSONL-based full turn history, appended per session.
- **No structured compression:** History grows unbounded; no built-in compaction or lane-based governance.
- **Skills-as-Markdown:** Capabilities are defined as natural-language instruction packs (`SKILL.md`) with YAML frontmatter, making extension easy but context cost high.

#### Strengths

| ID | Strength | Relevance to ZAM Runtime |
|---|---|---|
| OC-S1 | Skills-as-Markdown extensibility | Good UX pattern for defining agent capabilities. |
| OC-S2 | Session serialization via Lane Queue | Prevents race conditions; reliable for multi-channel deployments. |
| OC-S3 | Model-agnostic provider interface | Aligns with ZAM's vendor-neutrality invariant. |
| OC-S4 | Message steering/queuing during active runs | Sophisticated mid-run priority handling. |

#### Weaknesses

| ID | Weakness | Impact |
|---|---|---|
| OC-W1 | **Massive static context injection** — `AGENTS.md`, `SOUL.md`, all tools and skills injected every turn regardless of relevance. | Extreme token waste. This is the primary problem ZAM was built to solve. |
| OC-W2 | **No context governance** — no audit trail, no fail-open logic, no deterministic selection. | Unsafe omission or bloated inclusion with no middle ground. |
| OC-W3 | **Unbounded history** — JSONL history grows without lane-based governance or structured compression. | Context window pressure scales linearly with conversation length. |
| OC-W4 | **Heavy gateway architecture** — the persistent gateway process adds operational complexity for single-user or local use cases. | Overkill for a lightweight runtime. |
| OC-W5 | **Weak sandbox isolation** — local tool execution with limited policy enforcement. | Security risk, especially with community skill packs. |

---

### 2.2 Claude Code

**Architecture model:** Single-threaded master loop with subagent delegation. CLI-based (React + Ink) with optional IDE integrations.

#### Loop Structure

Claude Code uses an iterative **Gather–Act–Verify** loop with a 5-layer architectural decomposition:

1. **Perceive:** Gather context from the file system, shell, or user input.
2. **Think & Plan:** The model reasons about the task, using TODO lists for sub-task tracking.
3. **Act:** Execute tools (bash, file edits, search).
4. **Verify:** Inspect action output (e.g., run tests) and iterate or self-correct.

The loop is **single-threaded** — one main conversation drives all work. This prioritizes reliability, debuggability, and human steering over parallelism.

**Five architectural layers:**

| Layer | Responsibility |
|---|---|
| 1. User Interface | CLI (React + Ink) or IDE integrations |
| 2. Agent Loop | Master control logic — 9-step turn pipeline |
| 3. Permission/Safety | Tiered permission system for tool access |
| 4. Tools & Skills | Extensible plugins, MCP servers, reusable skills |
| 5. State & Persistence | Append-oriented session storage, auto-compaction |

#### Tool Execution Model

- **Structured tool contracts:** Tools are exposed via well-defined interfaces with clear input/output schemas.
- **Permission gates:** Human approval required for high-risk operations (destructive bash commands); light tools (file reading) may be automated.
- **StreamingToolExecutor:** Tools begin execution as the model streams output, reducing latency.
- **Subagent isolation:** Specialized tasks are delegated to isolated subagents with their own context windows and tool access, preventing context pollution.
  - Subagent types: `Explore` (read-only research), `Plan` (strategy), `General-Purpose` (execution).
  - **Mailbox pattern:** Subagents send high-risk operation requests to the main agent's mailbox for approval.

#### State Management

- **CLAUDE.md persistence:** Loaded at session start as part of the system prompt; **survives compaction**.
- **Auto-compaction:** Triggers at ~95% context capacity (not 80%). Uses context summarization to free window space.
- **Manual /compact:** Users can trigger compaction with custom preservation instructions.
- **Subagent context isolation:** Each subagent has a completely separate context window.

#### Strengths

| ID | Strength | Relevance to ZAM Runtime |
|---|---|---|
| CC-S1 | **Subagent isolation with mailbox pattern** — prevents context pollution while maintaining authority chain. | Excellent pattern for complex multi-step tasks. ZAM can provide per-subagent context plans. |
| CC-S2 | **Tiered permission system** — granular human-in-the-loop control over dangerous operations. | Essential for production safety. |
| CC-S3 | **Single-threaded simplicity** — highly observable, easy to debug and steer. | Proven more effective than complex multi-agent swarms (e.g., Uber's production experience). |
| CC-S4 | **Streaming tool execution** — latency optimization. | Good performance pattern. |
| CC-S5 | **CLAUDE.md as persistent context anchor** — survives compaction. | Analogous to ZAM's "stable" component classification. |

#### Weaknesses

| ID | Weakness | Impact |
|---|---|---|
| CC-W1 | **Compaction is lossy** — auto-compaction at 95% can lose granular details. No structured lane preservation. | Critical conversations can lose durable constraints or decisions. |
| CC-W2 | **No external context governance** — the model itself decides what to compact and what to keep. | No deterministic guarantees; dependent on model quality. |
| CC-W3 | **Proprietary and tightly coupled to Anthropic** — not usable as a general-purpose runtime framework. | Cannot be reused or adapted directly. |
| CC-W4 | **No trace/audit layer** — context decisions are not independently auditable. | No explainability for what was kept or dropped during compaction. |

---

### 2.3 OpenHands

**Architecture model:** Modular event-stream-driven loop with workspace abstraction and optional Docker sandboxing.

#### Loop Structure

OpenHands operates as a **stateless Agent** interacting with a **Conversation** through a central **EventStream**:

1. **Prepare Prompt:** Gather conversation history; optionally use a "Condenser" to summarize if the window is full.
2. **LLM Inference:** Query the LLM to generate the next `Action`.
3. **Dispatch/Classification:** Classify the response (tool call, text message, or empty).
4. **Tool Execution:** Dispatch tool call to the `Workspace`.
5. **Observation:** Capture result as an `Observation` and append to the EventStream.

**Key architectural pattern:** The `EventStream` is the **single source of truth** — an append-only, immutable log of all Actions and Observations (Pydantic models). Auxiliary services (security scanners, memory compressors, stuck detectors) simply **subscribe** to the stream without coupling to core logic.

#### Tool Execution Model

- **Workspace abstraction:** The `Workspace` interface abstracts local vs. remote execution. Same API whether running in-process or in a Docker container.
- **Docker Runtime (default):** Secure, isolated Linux environment. Captures shell commands, Jupyter notebook operations, and file system changes.
- **V1 SDK architecture:** Sandboxing is "opt-in" — developers can run locally (speed/testing) or in containers (security/production) using the same interface.
- **Code-as-Action philosophy:** Emphasizes universal actions (bash, Python, file editing) over bespoke tools, letting the LLM use its reasoning capabilities more effectively.
- **Action Execution Client:** Supports policy engines for rule-based approval/denial of actions before execution.

#### State Management

- **ConversationState:** Centralized state object makes agent progress replayable, debuggable, and safe for parallel execution.
- **Event stream as history:** The immutable event stream IS the history — no separate history store needed.
- **Condenser:** A context summarizer that kicks in when the context window fills up, compressing older events while preserving recent ones.

#### Strengths

| ID | Strength | Relevance to ZAM Runtime |
|---|---|---|
| OH-S1 | **EventStream as single source of truth** — immutable, append-only, decoupled from processing logic. | Excellent auditability and replay capability. Aligns perfectly with ZAM's trace philosophy. |
| OH-S2 | **Workspace abstraction** — same interface for local and sandboxed execution. | Enables flexible deployment without architecture changes. |
| OH-S3 | **Subscriber pattern for auxiliary services** — security, memory, stuck detection are decoupled. | Clean separation of concerns; easy to extend without modifying the core loop. |
| OH-S4 | **Code-as-Action** — small universal tool set instead of hundreds of bespoke tools. | Reduces tool description token cost; lets the model reason freely. |
| OH-S5 | **Policy engine for action gating** — rule-based approval/denial before execution. | Production-grade safety without human-in-the-loop bottleneck. |

#### Weaknesses

| ID | Weakness | Impact |
|---|---|---|
| OH-W1 | **Heavy Docker dependency** — default sandbox requires Docker, which adds operational complexity. | Barrier to entry for lightweight or local deployments. |
| OH-W2 | **Condenser is model-dependent** — summary quality depends on LLM capability. | Same risk as Claude Code's compaction: no deterministic preservation guarantees. |
| OH-W3 | **Complex codebase** — sophisticated architecture can be difficult to understand and extend. | Maintenance burden for smaller teams. |

---

### 2.4 SWE-agent

**Architecture model:** Lightweight thought-action-observation loop with a purpose-built Agent-Computer Interface (ACI).

#### Loop Structure

SWE-agent uses the simplest and most elegant loop of all systems analyzed:

1. **Render Prompt:** Process history (previous actions/observations) into a prompt.
2. **Reason/Call Model:** LLM generates a "thought" and a specific "action" (command to execute).
3. **Validate Action:** Check for forbidden commands, verify bash syntax before execution.
4. **Execute in Sandbox:** Execute the command in an isolated environment (SWE-ReX).
5. **Observe:** Capture stdout/stderr and return to agent as the next observation.

**Key insight:** The loop includes a **`state_command` round-trip** after each action — the system refreshes the agent's understanding of the environment state, creating a "self-correcting" feel.

#### Tool Execution Model

- **ACI (Agent-Computer Interface):** The central innovation. Rather than exposing raw Linux commands, SWE-agent provides LM-optimized commands:
  - Custom file viewer showing 100-line windows (balances context vs. focus).
  - Search commands returning only file names with matches (not full contents).
  - Automatic linter — if code edit is not syntactically correct, the edit is rejected immediately.
- **Tool bundles as YAML:** Tools are defined as YAML-configured sets of bash/Python scripts. Modular, easy to extend.
- **Docker sandbox:** All execution in isolated Docker containers.

#### State Management

- **Linear trajectory log:** Simple, ordered sequence of thought-action-observation tuples.
- **No explicit memory/compression:** Relies on the model's context window and ACI-optimized output to keep context small.
- **State command refresh:** Periodic environment state snapshot keeps the agent grounded.

#### Strengths

| ID | Strength | Relevance to ZAM Runtime |
|---|---|---|
| SA-S1 | **ACI concept — LM-optimized tool outputs** — reshapes command outputs to save context window. | Directly reduces token cost per tool result. Critical for ZAM budget governance. |
| SA-S2 | **Extreme simplicity** — mini-swe-agent achieves ~65% on SWE-bench Verified in ~100 lines of code. | Proves that lightweight loops can be highly effective. |
| SA-S3 | **Pre-execution validation** — linter gate prevents broken state from entering the loop. | Reduces wasted turns and context pollution from errors. |
| SA-S4 | **State command refresh** — periodic environment snapshot prevents agent drift. | Keeps the agent grounded without needing complex state management. |

#### Weaknesses

| ID | Weakness | Impact |
|---|---|---|
| SA-W1 | **No memory/compression** — relies entirely on context window capacity. | Not viable for long conversations or multi-session tasks. |
| SA-W2 | **Focused on GitHub issue resolution** — not designed as a general-purpose runtime. | Architecture is specialized; needs generalization. |
| SA-W3 | **Docker-only sandbox** — same operational overhead as OpenHands. | Local lightweight deployment requires adaptation. |

---

### 2.5 Codex CLI

**Architecture model:** Modular agent loop with policy-based sandboxing and standardized tool integration via MCP.

#### Loop Structure

Codex CLI follows the standard **Reason–Act–Observe** pattern:

1. **Reasoning:** The LLM processes the task, current state, and available tool definitions.
2. **Action:** The agent invokes tools via an integration layer.
3. **Observation:** Actions execute in an isolated environment; output is returned to the LLM.
4. **Loop Management:** State tracking of completed steps with context compaction to keep the prompt window clean.

#### Tool Execution Model

- **MCP (Model Context Protocol):** Standard interface for external tool integrations. Agents dynamically discover relevant tools via a **Tool Router**, preventing context bloating by loading only what is needed.
- **Agent Skills:** Reusable workflows (`SKILL.md` files) for common engineering tasks.
- **Layered orchestration:** A "coding agent" handles the task while an "orchestrator" manages tool access and environment safety.

#### Sandbox & Security

- **MicroVMs (Firecracker):** Hardware-level isolation in Linux/cloud environments. Ephemeral, fully isolated filesystems and kernels.
- **Windows native sandbox:** Specialized unelevated sandbox using Security Identifiers, ACLs, and write-restricted tokens.
- **Policy-based control:** Microsoft eXecution Containers (MXC) SDK provides a policy layer defining what agents can observe and modify.

#### State Management

- **Short-term memory:** Completed step tracking within the current session.
- **Context compaction:** Automatic summarization to manage long-horizon tasks.
- No structured lane-based governance.

#### Strengths

| ID | Strength | Relevance to ZAM Runtime |
|---|---|---|
| CX-S1 | **MCP-based dynamic tool discovery** — only relevant tools loaded per step. | Reduces tool description token cost; aligns with ZAM's selective tool inclusion. |
| CX-S2 | **MicroVM isolation (Firecracker)** — strongest sandbox boundary of all systems analyzed. | Gold standard for security; may be overkill for local lightweight runtime. |
| CX-S3 | **Policy-based action control** — fine-grained rules for what agents can do. | Granular safety without requiring human approval for every action. |
| CX-S4 | **Dynamic Tool Router** — prevents context bloating by selecting relevant tools. | Partial context governance already happening at tool level. |

#### Weaknesses

| ID | Weakness | Impact |
|---|---|---|
| CX-W1 | **Heavy infrastructure requirements** — Firecracker microVMs require Linux KVM; not portable to all environments. | Limits deployment flexibility. |
| CX-W2 | **Context compaction is unstructured** — same model-dependent summarization risk as others. | No deterministic preservation guarantees. |
| CX-W3 | **Proprietary** — cannot be reused or adapted. | Ideas can be borrowed but not code. |

---

## 3. Cross-System Comparison

### 3.1 Loop Structure Comparison

| System | Loop Pattern | Thread Model | Re-entry Support | Complexity |
|---|---|---|---|---|
| OpenClaw | Intake → Assemble → Infer → Execute → Persist | Single-threaded per session (Lane Queue) | Ad-hoc (no structured re-entry) | High |
| Claude Code | Gather → Act → Verify | Single-threaded master + isolated subagents | Via subagent delegation | Medium |
| OpenHands | Prompt → Infer → Dispatch → Execute → Observe | Stateless agent + event stream | Via event stream replay | Medium-High |
| SWE-agent | Render → Reason → Validate → Execute → Observe | Single-threaded | Not designed for re-entry | Low |
| Codex CLI | Reason → Act → Observe | Single-threaded with orchestrator layer | Via orchestrator | Medium |

### 3.2 Tool Execution Comparison

| System | Sandbox Type | Tool Discovery | Pre-execution Validation | Output Optimization |
|---|---|---|---|---|
| OpenClaw | None (local) | Static skill directory | None | None |
| Claude Code | Permission gates | Structured contracts + MCP | Permission system | Streaming executor |
| OpenHands | Docker (opt-in) | Workspace abstraction | Policy engine | Code-as-Action |
| SWE-agent | Docker (mandatory) | YAML tool bundles | Linter gate + validation | **ACI-optimized output** |
| Codex CLI | MicroVM / OS sandbox | MCP + Tool Router | Policy SDK | Dynamic tool selection |

### 3.3 State Management Comparison

| System | History Model | Compression | Structured Preservation | Auditability |
|---|---|---|---|---|
| OpenClaw | JSONL append | None | None | Low |
| Claude Code | Append + compaction | Auto at ~95% capacity | CLAUDE.md survives | Low |
| OpenHands | EventStream (immutable) | Condenser | ConversationState | High |
| SWE-agent | Linear trajectory | None | State command refresh | Medium |
| Codex CLI | Step tracking + compaction | Auto | None | Low |

---

## 4. Extracted Best Ideas

These are the ideas worth adopting for the ZAM-native runtime, ranked by impact:

### Tier 1: Must-Have (Core Architecture)

| ID | Idea | Source | Why It Matters |
|---|---|---|---|
| BEST-1 | **EventStream as single source of truth** | OpenHands (OH-S1) | Immutable, append-only log of all actions and observations. Provides full replay, audit, and debugging capability. Aligns with ZAM's trace philosophy. |
| BEST-2 | **Single-threaded master loop** | Claude Code (CC-S3), SWE-agent (SA-S2) | Proven more reliable and debuggable than multi-agent swarms. Simple, observable, and easy to steer. |
| BEST-3 | **ZAM as the context brain (no local context assembly)** | Original | The runtime NEVER assembles context independently. Every turn calls ZAM `POST /plan` to get the governed prompt plan. This is the fundamental differentiator. |
| BEST-4 | **Pre-execution validation gate** | SWE-agent (SA-S3), Codex CLI (CX-S3) | Validate actions before execution (syntax, safety, policy). Prevents wasted turns and context pollution. |
| BEST-5 | **ACI-optimized tool outputs** | SWE-agent (SA-S1) | Reshape tool outputs for LM consumption — truncate, summarize, and format results to minimize context cost. Critical for staying within ZAM's budget governance. |

### Tier 2: Should-Have (Safety & Extensibility)

| ID | Idea | Source | Why It Matters |
|---|---|---|---|
| BEST-6 | **Tiered permission system** | Claude Code (CC-S2) | Granular human-in-the-loop control. Auto-approve safe actions; require approval for destructive ones. |
| BEST-7 | **Workspace abstraction** | OpenHands (OH-S2) | Same interface for local execution and sandboxed execution. Enables flexible deployment. |
| BEST-8 | **Subscriber pattern for auxiliary services** | OpenHands (OH-S3) | Decouple security scanning, stuck detection, and logging from core loop. Clean extension point. |
| BEST-9 | **Model-agnostic provider interface** | OpenClaw (OC-S3), all systems | Support Gemini, OpenAI, Anthropic, etc. via a thin provider client abstraction. |

### Tier 3: Nice-to-Have (Polish & Performance)

| ID | Idea | Source | Why It Matters |
|---|---|---|---|
| BEST-10 | **State command refresh** | SWE-agent (SA-S4) | Periodic environment snapshot prevents agent drift. |
| BEST-11 | **Streaming tool execution** | Claude Code (CC-S4) | Latency optimization — tools start executing as model streams output. |
| BEST-12 | **Subagent isolation with mailbox** | Claude Code (CC-S1) | For complex multi-step tasks, spawn isolated sub-loops with separate ZAM context plans. |
| BEST-13 | **Session serialization / Lane Queue** | OpenClaw (OC-S2) | For multi-channel deployments, sequential processing prevents conflicts. |

---

## 5. Identified Anti-Patterns (What to Avoid)

| ID | Anti-Pattern | Source | Why to Avoid |
|---|---|---|---|
| ANTI-1 | **Static context injection every turn** | OpenClaw (OC-W1) | ZAM eliminates this by design. The runtime must never assemble its own context. |
| ANTI-2 | **Unstructured compaction** | Claude Code (CC-W1), Codex CLI (CX-W2) | Model-dependent summarization with no deterministic preservation guarantees. ZAM's lane-based governance handles this correctly. |
| ANTI-3 | **Unbounded history growth** | OpenClaw (OC-W3) | History must flow through ZAM's history lane governance, not grow ad-hoc. |
| ANTI-4 | **Heavy gateway/infrastructure requirements** | OpenClaw (OC-W4), Codex CLI (CX-W1) | The runtime must be lightweight. No Firecracker VMs, no persistent gateway daemons. |
| ANTI-5 | **Docker-mandatory sandboxing** | OpenHands (OH-W1), SWE-agent (SA-W3) | Docker is useful but must be opt-in, not required. |
| ANTI-6 | **Tightly coupling to one model provider** | Claude Code (CC-W3) | Violates ZAM's vendor-neutrality invariant. |

---

## 6. Synthesis: The ZAM-Native Runtime Proposal

### 6.1 Design Philosophy

> **The runtime is a thin, auditable execution loop. ZAM is the brain.**

The ZAM-native runtime exists to do only what ZAM cannot: call models, execute tools, manage the turn loop, and maintain session state. Every context decision — what tools to include, what history to show, what components to select — is delegated to ZAM.

This produces the lightest possible runtime because:
- No context assembly logic (ZAM handles it).
- No history compression logic (ZAM's lane governance handles it).
- No tool selection logic (ZAM's selector engine handles it).
- No cache advisory logic (ZAM's PPG handles it).

### 6.2 Proposed Architecture

```
  ┌─────────────────────────────────────────────────────────────────┐
  │                     ZAM-Native Agent Runtime                    │
  │                                                                 │
  │  ┌───────────────────────────────────────────────────────────┐  │
  │  │                    Session Manager                         │  │
  │  │  • Session ID, turn counter, run history                   │  │
  │  │  • EventStream (append-only log of all actions/obs)        │  │
  │  │  • History state builder (extracts ZAM input from stream)  │  │
  │  └───────────────────────────┬───────────────────────────────┘  │
  │                              │                                  │
  │  ┌───────────────────────────▼───────────────────────────────┐  │
  │  │                     Turn Loop Engine                       │  │
  │  │                                                            │  │
  │  │  1. Build ZAM input (request + registry + history state)   │  │
  │  │  2. POST /plan → ZAM → prompt-plan.json + trace.json       │  │
  │  │  3. Assemble prompt text from plan                         │  │
  │  │  4. Submit to model provider → response                    │  │
  │  │  5. Parse response → text answer or tool_call              │  │
  │  │  6. If tool_call:                                          │  │
  │  │     a. Validate (pre-execution gate)                       │  │
  │  │     b. Check permissions (tiered permission system)        │  │
  │  │     c. Execute via Workspace interface                     │  │
  │  │     d. Optimize output (ACI-style truncation/formatting)   │  │
  │  │     e. Append action + observation to EventStream          │  │
  │  │     f. Re-enter loop at step 1                             │  │
  │  │  7. If text answer: deliver to user, end turn              │  │
  │  │  8. If loop limit reached: deliver best available answer   │  │
  │  └───────────────────────────┬───────────────────────────────┘  │
  │                              │                                  │
  │  ┌───────────────────────────▼───────────────────────────────┐  │
  │  │                   Execution Layer                          │  │
  │  │                                                            │  │
  │  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐  │  │
  │  │  │  Provider    │  │  Workspace   │  │  Permission      │  │  │
  │  │  │  Client      │  │  Interface   │  │  Gate            │  │  │
  │  │  │             │  │              │  │                  │  │  │
  │  │  │ Gemini      │  │ Local mode   │  │ Auto-approve:    │  │  │
  │  │  │ OpenAI      │  │ Docker mode  │  │ read, list, grep │  │  │
  │  │  │ Anthropic   │  │ (opt-in)     │  │ Require approval:│  │  │
  │  │  │ (pluggable) │  │              │  │ rm, write, exec  │  │  │
  │  │  └─────────────┘  └──────────────┘  └──────────────────┘  │  │
  │  └──────────────────────────────────────────────────────────┘  │
  │                                                                 │
  │  ┌──────────────────────────────────────────────────────────┐   │
  │  │               Subscriber Bus (Optional)                   │   │
  │  │  • Security scanner                                       │   │
  │  │  • Stuck detector (no-progress detection)                 │   │
  │  │  • Cost tracker                                           │   │
  │  │  • Logging / telemetry                                    │   │
  │  └──────────────────────────────────────────────────────────┘   │
  └──────────────────────────────┬──────────────────────────────────┘
                                 │ POST /plan (every turn)
  ┌──────────────────────────────▼──────────────────────────────────┐
  │              ZAM Context Control Plane (Existing)                │
  │  Request Router → Selectors → Conflict Resolver → Budgeter      │
  │  → Prompt Plan Generator → Trace Layer                           │
  │  Output: prompt-plan.json, trace.json, summary.md                │
  └─────────────────────────────────────────────────────────────────┘
```

### 6.3 Component Breakdown

#### 6.3.1 Turn Loop Engine

The heart of the runtime. Implements the single-threaded master loop (BEST-2):

```
while (not done AND turn < maxTurns) {
  1. Build ZAM input from EventStream + registry
  2. Call ZAM POST /plan → get prompt-plan.json
  3. Assemble prompt text from prompt-plan.json
  4. Call model provider with assembled prompt + available tools
  5. Parse model response
  6. If tool_call → validate, gate, execute, observe, continue
  7. If text answer → deliver to user, set done = true
  8. If no progress → deliver fallback, set done = true
}
```

**Fail-safes (from `docs/20` §5.1):**
- Maximum re-entry count (configurable, default 5).
- No-progress detection (identical plan/response detection).
- Wall-clock timeout.
- Tool execution failure handling (record error in history, re-enter ZAM).

#### 6.3.2 Session Manager

Owns the EventStream and session lifecycle:

- **EventStream:** Immutable, append-only log of all Actions and Observations (BEST-1). Every tool call, every result, every model response is recorded.
- **History State Builder:** Extracts the ZAM-compatible `history-state-summary` input from the EventStream. This is the bridge between the runtime's internal state and ZAM's input contract.
- **Session ID / Turn Counter:** Simple tracking for provenance and loop-limit enforcement.

#### 6.3.3 Provider Client

Thin, model-agnostic interface (BEST-9):

```typescript
interface ProviderClient {
  chat(options: {
    messages: Message[];
    tools?: ToolDefinition[];
    model: string;
  }): Promise<ProviderResponse>;
}
```

Implementations for Gemini, OpenAI, Anthropic, etc. No provider-specific logic leaks into the loop engine.

#### 6.3.4 Workspace Interface

Abstracted tool execution (BEST-7):

```typescript
interface Workspace {
  execute(action: ToolAction): Promise<ToolObservation>;
}

// Implementations:
// - LocalWorkspace: direct CLI/file system execution
// - DockerWorkspace: sandboxed Docker container (opt-in)
```

#### 6.3.5 Permission Gate

Tiered permission system (BEST-6):

| Category | Example Tools | Default Policy |
|---|---|---|
| Read-only | `grep`, `ls`, `cat`, `find` | Auto-approve |
| File write | `write_file`, `edit_file` | Auto-approve within workspace |
| Shell execution | `bash`, `python` | Require approval (configurable) |
| Destructive | `rm`, `drop`, `truncate` | Always require approval |
| Network | `curl`, `wget`, `fetch` | Require approval |

#### 6.3.6 Tool Output Optimizer

ACI-inspired output reshaping (BEST-5):

Before feeding tool results back into the model, optimize them for context efficiency:

- **Truncation:** Cap output at configurable max lines (default: 100 lines, matching SWE-agent's proven window size).
- **Formatting:** Strip ANSI escape codes, normalize whitespace.
- **Summarization:** For very large outputs (e.g., full test suite results), provide summary + tail.
- **Error extraction:** For failures, extract only the relevant error lines, not the full stack trace.

This directly feeds into ZAM's budget governance — smaller tool results mean more budget for other context components.

### 6.4 What the Runtime Does NOT Do

| Responsibility | Owner | Why |
|---|---|---|
| Context selection (which tools, skills, components to include) | ZAM | ZAM's selector engine, conflict resolver, and budgeter handle this deterministically. |
| History compression / lane governance | ZAM | ZAM's lane-based governance and history state summary handle this safely. |
| Prompt plan generation | ZAM | ZAM's PPG produces the structured plan. |
| Trace/audit evidence | ZAM | ZAM's trace layer provides full decision auditing. |
| Cache advisory ordering | ZAM | ZAM's PPG provides stable/session/volatile ordering. |
| Fail-open safety decisions | ZAM | ZAM's fail-open semantics ensure safe context inclusion. |

### 6.5 Interaction Flow (Concrete Example)

```
User → "What's the weather in Tehran and add it to my notes"

Turn 1:
  Runtime builds ZAM input:
    - request: "What's the weather in Tehran and add it to my notes"
    - registry: [all registered components]
    - tools: [weather_api, file_write, web_search, ...]
    - history: [] (empty — first turn)

  ZAM POST /plan responds:
    - selectedComponents: [core_identity, tool_use_instructions, ...]
    - selectedTools: [weather_api, file_write]
    - trace: { decisions: [...], budgetUsed: 2400 }

  Runtime assembles prompt from plan.
  Runtime calls model with assembled prompt + [weather_api, file_write].
  Model responds: tool_call(weather_api, { city: "Tehran" })

  Runtime:
    - Validates: weather_api is an allowed tool ✓
    - Permission gate: API call → auto-approve (configured) ✓
    - Executes: weather_api("Tehran") → "32°C, sunny"
    - Optimizes output: "32°C, sunny" (already concise)
    - Appends to EventStream: [Action: weather_api, Obs: "32°C, sunny"]

Turn 2 (re-entry):
  Runtime builds ZAM input:
    - request: (same)
    - registry: (same)
    - tools: [weather_api, file_write, ...]
    - history: { turns: [tool_call + tool_result] }

  ZAM POST /plan responds (re-entry plan):
    - Updated plan incorporating tool result context
    - reentryPhase populated in trace

  Runtime assembles prompt from new plan.
  Model responds: tool_call(file_write, { path: "notes.md", content: "Tehran: 32°C, sunny" })

  Runtime:
    - Validates: file_write is allowed ✓
    - Permission gate: file write within workspace → auto-approve ✓
    - Executes: writes to notes.md
    - Appends to EventStream

Turn 3 (re-entry):
  Model responds: "Done! I checked the weather in Tehran (32°C, sunny) and added it to your notes."
  Runtime delivers to user. Loop ends.
```

---

## 7. Comparison: ZAM-Native Runtime vs. Existing Systems

| Dimension | OpenClaw | Claude Code | OpenHands | SWE-agent | Codex CLI | **ZAM-Native (Proposed)** |
|---|---|---|---|---|---|---|
| Context governance | None | Model-driven compaction | Condenser | None | Model-driven compaction | **ZAM (deterministic, auditable, fail-open)** |
| Loop complexity | High | Medium | Medium-High | Low | Medium | **Low** (ZAM owns the hard decisions) |
| Tool sandbox | None (local) | Permission gates | Docker (opt-in) | Docker (required) | MicroVM | **Workspace abstraction (local default, Docker opt-in)** |
| History management | JSONL growth | CLAUDE.md + compaction | EventStream + Condenser | Linear trajectory | Step tracking | **EventStream → ZAM lane governance** |
| Auditability | Low | Low | High | Medium | Low | **Very High** (EventStream + ZAM trace) |
| Vendor neutrality | Model-agnostic | Anthropic-locked | Model-agnostic | Model-agnostic | OpenAI-focused | **Model-agnostic (pluggable provider)** |
| Code size estimate | Large | Large | Large | Small (~100 LOC for mini) | Large | **Small-Medium** (ZAM handles most logic) |

---

## 8. MVP Non-Interference Statement

This document does not:

- Change any existing MVP schema (`schemas/inputs/`, `schemas/outputs/`).
- Change any existing harness fixture.
- Change test counts (651 suite, 27 evaluate passed, 1 approved-skipped).
- Alter any existing selector, conflict resolver, budgeter, or trace behavior.
- Authorize implementation of any runtime code.
- Change `docs/04`, `docs/05`, `docs/06`, `docs/11`, `docs/12`, `docs/13`, `docs/18`, or `docs/20`.

This document is research input for the Phase R1 architectural scoping pass.

---

## 9. Open Questions for Phase R1

| # | Question | Impact |
|---|---|---|
| RQ-1 | Should the runtime be a separate package/repo or live inside the ZAM workspace as `src/runtime/`? | Repository structure and dependency management. |
| RQ-2 | What is the minimum tool set for the initial runtime (v0.1)? | Scope of first implementation pass. |
| RQ-3 | Should the Prompt Assembler (step 3 of the loop) be a separate module or inline? | Determines whether adapter-style assembly patterns are reusable. |
| RQ-4 | How should the runtime handle multi-session (e.g., multiple users) vs. single-session (local CLI) modes? | Architecture complexity tradeoff. |
| RQ-5 | Should the EventStream be persisted to disk (for replay/audit) or kept in-memory only? | Storage vs. simplicity tradeoff. |
| RQ-6 | What is the runtime's configuration format (YAML, JSON, environment variables)? | Developer experience. |

---

## 10. Summary

| Area | Decision |
|---|---|
| Loop model | Single-threaded master loop, `while (not done)` pattern |
| Context governance | Delegated entirely to ZAM — runtime calls `POST /plan` every turn |
| Event tracking | EventStream — immutable, append-only action/observation log |
| Tool execution | Workspace abstraction (local default, Docker opt-in) |
| Tool output | ACI-inspired optimization (truncation, formatting, summarization) |
| Permissions | Tiered gate: auto-approve safe, require approval for destructive |
| Provider | Model-agnostic pluggable client |
| Extensibility | Subscriber bus for auxiliary services (security, stuck detection, cost tracking) |
| Anti-patterns avoided | No static context injection, no unstructured compaction, no unbounded history, no heavy infra requirements, no vendor lock-in |
| MVP interference | None |
