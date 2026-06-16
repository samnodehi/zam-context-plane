# Portable Context Control Plane — Master Plan

## 0. Project Identity

Project name, temporary:
**Portable Context Control Plane**

Alternative product names:
- Context Control Plane
- Prompt Surface Compiler
- Agent Context Router
- Smart Prompt Planner
- Context Optimizer for AI Agents

This project is not an OpenClaw fork by default.

**Product category:** This is a **portable Context Governance / Context Control Plane** for AI agent runtimes. It is not an agent runtime itself. It sits before agent runtimes and produces auditable context decisions: what context to include, what can be safely omitted, what must fail open, what should be deferred, and why. The primary deliverable is a structured prompt plan with trace evidence, not an assembled prompt or a provider call.

OpenClaw is used as:
1. a reference implementation,
2. a research target,
3. a testbed,
4. a possible first adapter.

The product/core must remain portable and usable outside OpenClaw, including n8n, Telegram bots, custom AI chat systems, coding agents, and future agent runtimes.

---

## 1. North Star

Build a portable system that decides what context, tools, skills, memory, history, and prompt components an AI agent should receive for a specific user request.

The system should make prompts:

- smaller,
- safer,
- more task-aware,
- cheaper,
- easier to audit,
- explainable,
- reversible,
- and portable across agent runtimes.

The goal is not simply “shorter prompts.”

The real goal is:

> Smaller context only when safe.

If the system is uncertain, it must fail open to fuller context.

---

## 2. Why This Project Exists

The OpenClaw investigation showed that agent runtimes often send large base prompts even for simple requests.

Observed issues from the OpenClaw research track:

- high base prompt mass,
- static scaffold injected into ordinary turns,
- skills and tools visible even when not needed,
- history growth in multiturn sessions,
- output/provider anomalies,
- weak evidence for exact provider-bound final input,
- and risk of unsafe omission without gates.

AGENTS Layer 3 research proved that a specific optional context bundle can save meaningful prompt mass, but also proved that live omission is unsafe without stronger evidence.

Important lesson:

> Prompt reduction must be gated, measurable, traceable, and fail-open.

---

## 3. Strategic Decision

We will not continue by deeply modifying OpenClaw first.

We will start a new independent project in Antigravity.

OpenClaw will be studied legally and carefully as an open-source reference. Useful ideas may be redesigned or adapted, while respecting licensing and attribution.

The portable core must not be locked to OpenClaw internals.

Recommended project split:

```text
OpenClaw / similar systems
    ↓ research, source mapping, lessons
Portable Context Control Plane
    ↓ independent core
Adapters
    ↓ OpenClaw, n8n, Telegram, generic API, coding agents
````

---

## 4. Legal and Safety Rules

Before reusing code from any project:

1. Inspect its license.
2. Preserve required copyright/license notices.
3. Track copied or adapted code explicitly.
4. Prefer clean redesign over direct copying when possible.
5. Do not use project branding in a misleading way.
6. Do not include secrets, credentials, tokens, private logs, or provider payloads in docs.
7. Do not run live agent calls unless explicitly approved.
8. Do not mutate the user’s live OpenClaw installation.
9. Do not modify `~/.openclaw` state unless explicitly approved.
10. Keep research repos separate from live runtime repos.

OpenClaw is open source, but license compliance is still mandatory.

---

## 5. Antigravity Usage Strategy

Use Antigravity as the main research and build workspace.

Recommended model usage:

### Gemini Pro High

Use for:

* architecture reasoning,
* system comparison,
* source mapping,
* large design docs,
* difficult tradeoff analysis.

### Gemini Pro Low

Use for:

* structured doc writing,
* medium-complexity planning,
* summarizing source findings.

### Gemini Flash

Use for:

* quick file classification,
* metadata generation,
* repetitive extraction,
* table generation,
* simple code scaffolding.

### Claude Sonnet / Opus Thinking

Use for:

* code quality review,
* complex refactor planning,
* architecture critique,
* safety/risk analysis,
* schema design.

### GPT-OSS 120B

Use for:

* alternative viewpoint,
* open model comparison,
* cheap reasoning experiments,
* sanity checks.

Rule:
Do not let any agent make broad changes without a written plan and explicit approval.

---

## 6. Repository Plan

Create a fresh project folder/repo:

```text
portable-context-control-plane/
```

Suggested structure:

```text
portable-context-control-plane/
  README.md
  PROJECT_MASTER_PLAN.md

  docs/
    00_NORTH_STAR.md
    01_RESEARCH_PLAN.md
    02_SYSTEM_COMPARISON_MATRIX.md
    03_OPENCLAW_SOURCE_MAP.md
    04_SIMILAR_SYSTEMS_RESEARCH.md
    05_PORTABLE_CORE_ARCHITECTURE.md
    06_COMPONENT_REGISTRY_SPEC.md
    07_SELECTOR_ORCHESTRATION_SPEC.md
    08_HISTORY_MEMORY_SPEC.md
    09_TOOL_SKILL_SELECTION_SPEC.md
    10_PROMPT_PLAN_SCHEMA.md
    11_EVALUATION_AND_GATES.md
    12_MVP_IMPLEMENTATION_PLAN.md
    13_PRODUCTIZATION_PLAN.md

  research/
    openclaw/
    similar-systems/
    notes/
    source-maps/

  specs/
    component.schema.json
    selector-input.schema.json
    selector-output.schema.json
    prompt-plan.schema.json
    trace.schema.json
    evaluation-report.schema.json

  prototype/
    cli/
    core/
    adapters/
      openclaw/
      n8n/
      telegram/
      generic-api/

  fixtures/
    requests/
    registries/
    histories/
    expected-plans/

  evaluations/
    reports/
    scripts/
```

---

## 7. Research Phase

### Goal

Understand OpenClaw and similar systems enough to design a better portable context control system.

### Systems to compare

Research these systems or categories:

1. OpenClaw
2. Claude Code-style coding agents
3. Codex-style task runners
4. Cursor / Antigravity IDE agents
5. OpenHands / SWE-agent-style systems
6. LangGraph-style orchestration
7. CrewAI-style multi-agent orchestration
8. n8n AI workflows
9. Telegram bot AI agent patterns
10. Custom chat platforms with tool calling

### Comparison dimensions

For each system, document:

* context handling,
* prompt assembly,
* memory/history handling,
* tool selection,
* skill/plugin system,
* agent loop,
* provider abstraction,
* artifact/logging model,
* cost control,
* safety/fail-open design,
* eval/test support,
* extensibility,
* weaknesses,
* useful ideas to adapt.

Output file:

```text
docs/02_SYSTEM_COMPARISON_MATRIX.md
```

---

## 8. OpenClaw Source Study

### Goal

Map OpenClaw as a reference system, not as the final product.

### Inspect and document

Study these areas:

1. CLI entrypoint
2. gateway/service flow
3. agent command path
4. embedded runner
5. prompt assembly
6. workspace injected files
7. AGENTS/SOUL/TOOLS/BOOTSTRAP/HEARTBEAT usage
8. skill inventory
9. tool registry
10. history/session storage
11. provider adapters
12. hooks/plugin boundaries
13. telemetry/artifact behavior
14. output assembly
15. error/fallback handling

Output file:

```text
docs/03_OPENCLAW_SOURCE_MAP.md
```

Important:
Do not mutate live OpenClaw state.
Do not run provider calls unless explicitly approved.
Prefer reading source and docs first.

---

## 9. Core Concept

The portable system should take:

```json
{
  "userRequest": "...",
  "availableComponents": [],
  "availableTools": [],
  "availableSkills": [],
  "historyState": {},
  "runtimeCapabilities": {},
  "budget": {},
  "riskPolicy": {}
}
```

And output:

```json
{
  "promptFamily": "...",
  "selectedComponents": [],
  "omittedComponents": [],
  "selectedTools": [],
  "selectedSkills": [],
  "historyPlan": {},
  "budgetPlan": {},
  "finalPromptPlan": {},
  "estimatedTokens": {},
  "riskFlags": [],
  "failOpenReasons": [],
  "trace": []
}
```

The core must produce a plan before any prompt is assembled.

---

## 10. Core Modules

### 10.1 Component Registry

A structured registry of prompt/context components.

Each component should have:

```json
{
  "id": "agents.layer3.heartbeat_group_proactive",
  "type": "scaffold",
  "source": "AGENTS.md",
  "title": "Heartbeat, proactive, group behavior",
  "summary": "Rules for heartbeat, proactive behavior, group chat behavior, and memory maintenance.",
  "tokensApprox": 1120,
  "chars": 4441,
  "riskLevel": "medium",
  "requiredWhen": ["heartbeat", "cron", "proactive", "follow-up", "group", "multi-agent"],
  "safeToOmitWhen": ["ordinary_simple", "basic_coding", "simple_explanation"],
  "defaultAction": "include",
  "omissionPolicy": "fail_open",
  "dependencies": [],
  "conflicts": [],
  "version": "v0",
  "hash": "..."
}
```

### 10.2 Request Router

Classifies the user request into a prompt family.

Initial families:

```text
general_default
simple_greeting
coding_build_debug
research_investigation
ops_security_change_risk
lifecycle_internal
heartbeat_proactive
group_chat_behavior
tool_use_required
history_sensitive
```

### 10.3 Section Selectors

Independent selectors for:

* scaffold/context files,
* skills,
* tools,
* history,
* memory,
* output format,
* safety/policy,
* runtime capability.

Selectors may be deterministic, model-assisted, or hybrid.

Rule:
Model-assisted selectors must output strict JSON and must not directly mutate the final plan without validation.

### 10.4 Conflict Resolver

Resolves disagreements between selectors.

Priority order:

```text
safety
privacy
user constraints
runtime capability
task requirement
history continuity
cost saving
style preference
```

If conflict is unresolved, fail open.

### 10.5 Budgeter

Controls prompt size.

Example budget:

```json
{
  "totalPromptTokenTarget": 3000,
  "maxScaffoldTokens": 800,
  "maxSkillTokens": 700,
  "maxToolTokens": 500,
  "maxHistoryTokens": 800,
  "reservedUserTokens": 500
}
```

### 10.6 History Lane Manager

History should be separated into lanes:

```text
durable_constraints
durable_facts
open_commitments
recent_raw_turns
working_summary
discardable_noise
```

Never summarize or drop important commitments without trace.

### 10.7 Prompt Plan Generator

Generates structured prompt plan.

It should not necessarily assemble final text in v1.

### 10.8 Trace / Explainability

Every decision should be explainable.

Trace fields:

```json
{
  "decisionId": "...",
  "componentId": "...",
  "action": "include | omit | summarize | defer | fail_open",
  "reason": "...",
  "evidence": [],
  "risk": "...",
  "estimatedSavings": {},
  "selector": "..."
}
```

---

## 11. Selector Philosophy

Do not blindly replace keyword rules with LLM selectors.

Best approach:

```text
deterministic rules
+ metadata
+ optional model-assisted semantic selection
+ strict schema
+ conflict resolver
+ fail-open
+ trace
```

Model selectors are useful for semantic understanding, but they are not automatically safer.

Failure modes:

* hallucinated selection,
* unsafe omission,
* prompt injection,
* inconsistent output,
* overconfidence,
* missing edge cases.

Therefore, every selector must have:

1. schema validation,
2. confidence,
3. evidence,
4. fail-open behavior,
5. deterministic guardrails,
6. evaluation tests.

---

## 12. MVP Scope

The MVP should be small.

### MVP v0 should be CLI-only

No UI.
No provider calls.
No live OpenClaw mutation.
No n8n integration yet.

Input:

```text
request.txt
registry.json
tools.json
skills.json
history.json
budget.json
```

Output:

```text
prompt-plan.json
trace.json
summary.md
```

Optional output:

```text
assembled-prompt-preview.txt
```

But no provider submission.

### MVP v0 supported decisions

* prompt family classification,
* component selection,
* tool selection,
* skill selection,
* history policy recommendation,
* token estimate,
* fail-open trace.

### MVP v0 forbidden

* live provider calls,
* live omission in OpenClaw,
* runtime mutation,
* automatic history mutation,
* executing tools,
* accessing secrets,
* modifying user files outside project workspace.

---

## 13. Evaluation Plan

Create fixtures:

```text
simple greeting
exact OK response
basic coding review
security checklist
weather/research request
proactive follow-up request
heartbeat vs cron request
group chat behavior request
multiturn ordinary-to-signal
history-sensitive request
tool-required request
ambiguous request
prompt-injection attempt
```

Measure:

* selected components,
* omitted components,
* false omission,
* false inclusion,
* fail-open correctness,
* estimated token savings,
* actual prompt size if assembled,
* trace completeness,
* privacy leakage,
* schema validity.

Pass criteria:

```text
0 unsafe omissions
0 raw secret leakage
0 raw prompt leakage in traces by default
100% schema-valid outputs
100% fail-open on uncertainty
```

---

## 14. Product Direction

### 14.0 Product Positioning

**Primary product:** A portable, vendor-neutral **Context Governance Layer** for AI agents. Also described as: Context Control Plane, Context Planner, auditable context planning for agent runtimes, policy-safe budget-aware prompt-plan compiler.

**What this product does:**
- Decides what context an agent should receive for a specific request.
- Produces an auditable, traceable prompt plan before any text is assembled or submitted.
- Enforces fail-open safety: uncertain omissions always resolve to include.
- Outputs `prompt-plan.json`, `trace.json`, `summary.md`.

**What this product is not:**
- Not a full agent runtime.
- Not an OpenClaw clone or OpenClaw replacement.
- Not a live OpenClaw patch or adapter (that is future/post-MVP).
- Not a provider execution system or model caller.
- Not a "prompt preprocessor" in the trivial sense — it is a policy-safe, budget-aware, deterministic context governance engine.

**OpenClaw role:**
- Reference system and research target only during MVP.
- Possible first adapter **after** CLI MVP correctness is proven via fixture tests.
- Must not be patched, mutated, or inspected live during MVP work.

**Commercial wedge:** Auditable context planning, safe omission with trace evidence, budget-aware selection, portability across agent runtimes, fail-open guarantees. Additionally: lower provider token cost and improved cache hit potential through stable, safety-first prompt layout — without provider-specific cache APIs or unsafe omission. The system can serve as a cost-aware and cache-aware context governance layer, not only a context selector.

### 14.1 Developer CLI (MVP form)

```bash
context-plane plan --request request.txt --registry registry.json
```

### 14.2 Node/Python Library

```js
const plan = await contextPlane.plan({
  request,
  registry,
  tools,
  skills,
  history,
  budget
});
```

### 14.3 Local HTTP Service

```text
POST /plan
POST /trace
POST /evaluate
```

### 14.4 OpenClaw Adapter (future, post-MVP)

Reads OpenClaw workspace files and emits component registry + prompt plan.

### 14.5 n8n Adapter (future)

Receives n8n workflow context and returns selected prompt blocks/tools.

### 14.6 Telegram Bot Adapter (future)

Uses user history, bot tools, and channel constraints to build context-aware prompts.

---

## 15. What To Pause From The Old Track

Pause these OpenClaw-specific branches:

* AGENTS Layer 3 Gate 4 implementation,
* live AGENTS omission,
* runtime shadow omission,
* provider-input trace implementation,
* deep OpenClaw-specific optimization,
* real-model shadow branch.

Keep the evidence and docs as lessons.

---

## 16. Immediate Step-by-Step Plan

### Step 1 — Create Project Folder

Create:

```text
portable-context-control-plane/
```

Add this file as:

```text
PROJECT_MASTER_PLAN.md
```

### Step 2 — Create Documentation Skeleton

Create the docs/specs/prototype folder structure.

### Step 3 — Research OpenClaw

Create:

```text
docs/03_OPENCLAW_SOURCE_MAP.md
```

Map:

* prompt assembly,
* skills,
* tools,
* history,
* gateway,
* provider path,
* artifacts.

### Step 4 — Research Similar Systems

Create:

```text
docs/02_SYSTEM_COMPARISON_MATRIX.md
```

Compare systems by context handling, tools, memory, prompt assembly, cost control, eval, and extensibility.

### Step 5 — Define Portable Core Architecture

Create:

```text
docs/05_PORTABLE_CORE_ARCHITECTURE.md
```

Define:

* modules,
* data flow,
* boundaries,
* adapter model,
* no-go zones.

### Step 6 — Define Schemas

Create:

```text
specs/component.schema.json
specs/selector-output.schema.json
specs/prompt-plan.schema.json
specs/trace.schema.json
```

### Step 7 — Build MVP CLI

Create:

```text
prototype/cli/
```

MVP command:

```bash
node prototype/cli/plan.mjs \
  --request fixtures/requests/simple.txt \
  --registry fixtures/registries/openclaw-like-registry.json \
  --out evaluations/reports/simple-plan.json
```

### Step 8 — Add Evaluation Fixtures

Create fixtures for simple, coding, security, proactive, heartbeat, group, multiturn, and prompt-injection cases.

### Step 9 — Compare Deterministic vs Model-Assisted Selectors

Run both:

```text
deterministic selector
model-assisted selector
hybrid selector
```

Compare:

* correctness,
* cost,
* latency,
* safety,
* false omission,
* trace quality.

### Step 10 — Decide First Adapter

Likely first adapter:

```text
OpenClaw adapter
```

But only after MVP core works independently.
