# ZAM Context Control Plane — Planner Board

This is the living roadmap and state-tracker for the project, maintained by the Reviewer/Planner Agent.

## Core Identity & Invariants
- **Product:** A portable Context Governance / Control Plane for AI agents (not an agent runtime).
- **Goal:** Smaller context only when safe. Fail-open on uncertainty.
- **MVP State:** Deterministic, offline, strictly audited. CLI implementation (Phases 0-13) is 100% complete and verified (651/651 tests pass).
- **Golden Rule:** Model proposes, deterministic guardrails enforce.
- **Technical Lead Rule:** The Reviewer/Planner acts as the Technical Lead. It defines the roadmap, makes decisions based on the project plan, ensures zero technical debt, enforces correct logic, and proposes the next step to Sam. Sam provides his opinion to reach a consensus in case of disagreement.

## Product Strategy — Context Governance as Infrastructure

> **Strategic Decision (Sam-approved, 2026-06-15):** ZAM is NOT an agent runtime competitor. ZAM is a **Context Governance Infrastructure Layer** — a middleware that agent runtimes (OpenClaw, Hermes, custom bots, etc.) integrate with to get intelligent, auditable, fail-safe context planning.

### Product Positioning
- **What ZAM is:** A portable, vendor-neutral Context Governance API. It decides what context an agent should receive, produces auditable trace evidence, and enforces fail-open safety.
- **What ZAM is NOT:** An agent runtime. It does not compete with OpenClaw, Hermes, Claude Code, or any coding agent.
- **Competitive Advantage:** No existing agent runtime has a dedicated context governance layer. ZAM fills this gap.
- **Runtime Role:** The `packages/runtime` is a validation harness — it proved the Core works end-to-end. It is not the product.

### Distribution Model
- **Source Code Protection:** ZAM source code must NOT be publicly accessible. No open-source distribution.
- **Delivery Format:** Compiled Docker image (Phase 1), Hosted SaaS API (Phase 3).
- **Consumer Interface:** HTTP REST API (already production-grade from V3).

### Three-Phase Distribution Roadmap

| Phase | Name | Deliverable | Source Code Exposure |
|---|---|---|---|
| **Phase 1** | Containerization + API Packaging | Docker image + SDK + docs | ❌ Hidden inside container |
| **Phase 2** | First Real-World Adapter | OpenClaw or Telegram adapter using ZAM API | ❌ Adapter is a thin HTTP client |
| **Phase 3** | SaaS / Hosted API | Cloud-deployed ZAM with API Key management | ❌ 100% server-side |

## Quality Standard — Production-Grade Engineering

> **Rule (Sam-approved, 2026-06-15):** Every step from this point forward must be executed at **production-grade quality**. No shortcuts, no "just to pass the phase" implementations, no deferred polish. Every artifact must be something we would ship to a paying customer.

### Quality Checklist (applies to every pass)
- [ ] Code is clean, documented, and follows existing project conventions.
- [ ] Error handling is comprehensive — no unhandled edge cases.
- [ ] Configuration is externalized — no hardcoded values.
- [ ] Security is considered — no exposed secrets, no unnecessary permissions.
- [ ] Documentation is complete — a developer can use the feature without reading source code.
- [ ] Testing covers success paths, error paths, and edge cases.
- [ ] The artifact is something we would present to a customer with confidence.

## Current Project Phase: `V4 — Product Distribution & Packaging` (Phase 1: Containerization)

Phase V3 (HTTP API Stabilization) is **COMPLETE**. The project is entering its productization phase. V4 transforms ZAM from a development project into a distributable, production-grade product.

### Active Epic: Phase V4 — Product Distribution & Packaging

**Goal:** Make ZAM deployable, distributable, and usable by external developers — with source code fully protected.

**Phase 1 — Containerization + API Packaging** (current)
Scoping doc: `docs/31_PRODUCT_DISTRIBUTION_AND_PACKAGING.md` (to be created)

Planned sub-passes:
- [ ] V4-A: Scoping document (`docs/31`) — full technical specification for Docker packaging, SDK, and developer documentation
- [ ] V4-B: Production Dockerfile — multi-stage build, minimal image, security hardening, health check, configurable via environment variables
- [ ] V4-C: Docker Compose + environment configuration — `docker-compose.yml`, `.env.example`, startup/shutdown scripts
- [ ] V4-D: Developer SDK — lightweight TypeScript/JavaScript HTTP client package (`@zamapi/sdk`) that wraps ZAM API calls with types, error handling, and examples
- [ ] V4-E: Developer documentation — API reference, quickstart guide, integration examples, troubleshooting
- [ ] V4-F: End-to-end distribution test — build image, run container, call API from SDK, verify full pipeline
- [ ] V4-G: Documentation update and planner board finalization

**Phase 2 — First Real-World Adapter** (future, after Phase 1 complete)
- Build the first adapter that connects ZAM to an existing agent runtime.
- Target platform TBD (OpenClaw adapter or Telegram bot — Sam decides).
- The adapter is a thin HTTP client that calls ZAM API — no ZAM source code exposure.

**Phase 3 — SaaS / Hosted API** (future, after Phase 2 proven)
- Deploy ZAM to a cloud server (Fly.io, Railway, or VPS).
- Add API Key management, usage tracking, rate limiting.
- Provide a public SDK that developers install via npm.
- 100% source code protection — code runs only on our servers.

### Completed Epics & Phases
- [x] CLI MVP Implementation (Phases 0-13) (`docs/11`)
- [x] Schema Batches A/B/C/D (`docs/12`)
- [x] Pass 4.9D-2AE: Creation of `docs/13_MODEL_ASSISTED_CONTEXT_PLANNING.md`
- [x] Phase 5 Schema Implementation: Trace phase keys, analyzer output schemas.
- [x] Phase P1-P12: Model-Assisted Harness Core Infrastructure, Integrators, and Trace Extensions (`docs/22`, `docs/15`, `docs/19`).
- [x] Phase H1-H4: HTTP Service and Generic Test Adapter (`docs/21`, `docs/18`).
- [x] Phase R0: Runtime Architecture Synthesis Research (`docs/23`).
- [x] Phase R1: Runtime Architectural Scoping (`docs/24`). Answered all 6 open questions from R0.

### In Progress / Up Next
- [x] Phase R2: Core Skeleton. Minimal working runtime: user text in → ZAM plan → OpenRouter prompt → model text out. No tools. (packages/runtime)
- [x] Phase R3: Tool Execution. LocalWorkspace, Permission Gate, Tool Output Optimizer, re-entry with tool results.
- [x] Phase R4: Provider Expansion + Cache Advisory. Multi-provider clients, cache hint translation.
- [x] Phase R5: Extensibility + Hardening. Subscriber Bus, Docker workspace, retries, stuck detection.
- [x] Phase R6: Core Integration. Wired the CLI to the real ZAM core, implemented CLI tools support, and performed end-to-end multi-turn testing with real registry.
- **[COMPLETE] Phase M1: Model-Assisted Request Analyzer.** Live LLM-powered request classification producing `AnalyzerOutput`. Connects runtime Provider Client to core Analyzer Integrator. Scoping doc: `docs/25`.
- **[COMPLETE] Phase M2: Model-Assisted Selector.** Live LLM-powered fallback selector for unresolved components using two-pass architecture. Connects runtime Provider Client to existing Conflict Resolver. Scoping doc: `docs/26`.
- **[COMPLETE] Phase M3: Model-Assisted History Compressor.** Live LLM-powered state extraction from session history with 11 categories and fail-open safety. Connects Turn Loop to core Compressor. Scoping doc: `docs/27`.

### Completed Epic: Phase V1 — Full-Stack Validation & Stabilization
Validate the complete ZAM system (Core + Runtime + M1/M2/M3) end-to-end with real models and real tasks.
- [x] V1-A: Scoping Document (`docs/28_FULL_STACK_VALIDATION.md`)
- [x] V1-B: Basic E2E — text request → ZAM Core → real model → text response
- [x] V1-C: Tool E2E — request → model → tool call → re-entry → final answer
- [x] V1-D: Multi-turn E2E — M1, M2, and M3 successfully validated in live multi-turn session.
- [x] V1-E: Issue resolution + results documentation (COMPLETED)
  - [x] Pass 1: Document I-5 and fix docs for I-1 & I-2
  - [x] Pass 2: Fix I-3 (promptFamily propagation)
  - [x] Pass 3: Fix I-4 (Capability Inventory propagation)
  - [x] Pass 4: Fix I-5 (No-progress detection on re-entry turns)
  - [x] Pass 5: Re-run V1-D multi-turn validation and update V1 documentation

*Note: All future steps must strictly respect the MVP Non-Interference Guarantee and require explicitly scoped, Sam-approved passes.*

### Completed Epic: Phase V2 — Library API & Integration Testing
Formalize the public Library API, build automated integration tests (Core + Runtime), and confirm production model compatibility.
- [x] V2-A: Scoping Document (`docs/29_LIBRARY_API_AND_INTEGRATION_TESTING.md`)
- [x] V2-B: Core package exports (make `plan()` importable from root package)
- [x] V2-C: Runtime convenience factory (`createAgent()` high-level API)
- [x] V2-D: Integration test suite (IT-1 through IT-5: real Core + mocked provider)
- [x] V2-E: Production confirmation run (Grok 4.3, requires Sam approval)
- [x] V2-F: Documentation update and planner board finalization

### Completed Epic: Phase V3 — HTTP API Stabilization
Formalize, harden, and stabilize the existing HTTP service implementation. Scoping doc: `docs/30_HTTP_API_STABILIZATION.md`. **COMPLETE — Zero technical debt.**
- [x] V3-A: Compliance audit (`docs/18` contract vs `src/http/` implementation)
- [x] V3-B: Package exports (`context-plane/http` subpath for `buildServer()`)
- [x] V3-C: Test hardening (edge-case tests HT-1 through HT-10)
- [x] V3-D: Production confirmation run (live TCP socket, requires Sam approval)
- [x] V3-E: Documentation update and planner board finalization

## Appendix: Project Structure Index

*(A comprehensive map of the ZAM workspace, generated for complete Reviewer/Planner context)*

### `/docs` - Specifications & Architecture
- `00_NORTH_STAR.md`: Foundational goals and vision for ZAM as a portable context control plane.
- `01_RESEARCH_PLAN.md` & `02_SYSTEM_COMPARISON_MATRIX.md`: Research docs comparing ZAM with other agent frameworks.
- `03_OPENCLAW_SOURCE_MAP.md`: Map detailing ZAM's relationship to OpenClaw.
- `04_PORTABLE_CORE_ARCHITECTURE.md`: **[CORE]** Defines module boundaries, the Request Router (§7.2), the Deterministic Ladder (§7.3), and overall pipeline phases.
- `05_COMPONENT_REGISTRY_SPEC.md`: **[CORE]** How tools/skills/constraints are registered, indexed, and quarantined.
- `06_SELECTOR_ORCHESTRATION_SPEC.md`: **[CORE]** The heart of the logic: deterministic selectors, the 12-step ladder, Conflict Resolver priority order (§11.4), and Injection Gate (§17).
- `07` through `12`: Project planning, decision logs, readiness audits, and schema/harness plans for the MVP (Phase 0-12).
- `13_MODEL_ASSISTED_CONTEXT_PLANNING.md`: **[FUTURE]** Key architecture document outlining Post-MVP model-assisted features (History Compressor, Request Analyzer, API layers).
- `14_SUMMARY_QUALITY_HARNESS_SCOPING.md`: Scoping for evaluating context summary quality.
- `15_REQUEST_ANALYZER_SCHEMA_SCOPING.md`: Phase 3 scoping defining `AnalyzerOutput` schema, Tier 0-3 routing, and fail-open semantics.
- `16` & `17`: Trace extensions and Phase 4.5 Schema Decisions.
- `18_HTTP_API_AND_ADAPTER_SPEC.md`: Phase 5 scoping for Local HTTP Service wrappers and adapter isolation boundaries.
- `19_MODEL_ASSISTED_SELECTOR_SCOPING.md`: Phase 6 scoping on how model proposals integrate with deterministic Conflict Priority logic.
- `20_REENTRY_LOOPS_SCOPING.md`: Re-entry loop architecture, fail-safes, and reentryPhase trace specification.
- `23_RUNTIME_SYNTHESIS_RESEARCH.md`: Phase R0 research — OpenClaw, Hermes, Claude Code, Codex, OpenHands, SWE-agent analysis and synthesis.
- `24_NATIVE_SMART_RUNTIME_SCOPING.md`: Phase R1 scoping — module architecture, EventStream schema, Turn Loop algorithm, integration contract.
- `25_MODEL_ASSISTED_ANALYZER_IMPLEMENTATION.md`: Phase M1 scoping — live model-assisted request classification.
- `26_MODEL_ASSISTED_SELECTOR_IMPLEMENTATION.md`: Phase M2 scoping — live model-assisted fallback selector with two-pass architecture.
- `27_MODEL_ASSISTED_HISTORY_COMPRESSOR_IMPLEMENTATION.md`: Phase M3 scoping — structured state extraction from session history with 11 categories and fail-open safety.
- `28_FULL_STACK_VALIDATION.md`: Phase V1 scoping — End-to-end full stack execution validation.

### `/src/core` - MVP Implementation Modules (Phases 1-11)
- `input-loader.ts` (Phase 1): Loads CLI files, validates schemas, applies fallback behaviors.
- `registry-loader.ts` (Phase 2): Indexes components, performs cross-field validation.
- `request-normalizer.ts` (Phase 3): MVP deterministic Request Router producing `RequestSignals`.
- `candidate-set-builder.ts` (Phase 4): Builds the candidate set from the registry for planning.
- `deterministic-ladder.ts` & `selector-engine.ts` (Phase 5): Implements the 12-step selector logic and orchestrates fan-out.
- `gap-check.ts` (Phase 6): Ensures every valid candidate has a decision after fan-out.
- `injection-gate.ts` (Phase 7): Applies security policies if injection is detected.
- `conflict-resolver.ts` (Phase 8): Enforces Priorities 0-7, resolving competing decisions into one `ResolvedSelectionDecision`.
- `budgeter.ts` (Phase 9): Enforces token limits and trims context based on priority.
- `prompt-plan-generator.ts` (Phase 10): Assembler that builds the final `prompt-plan.json`.
- `trace-summary-assembler.ts` (Phase 11): Assembles `trace.json` and `summary.md`.

### `/packages/runtime` - Native Agent Runtime (Phase R2–R6)
- **[COMPLETE]** Core skeleton: Turn Loop, Session Manager, EventStream, History State Builder, Prompt Assembler, Multi-Provider Client (OpenRouter/Anthropic), ZAM Library Client, Config Loader, CLI, LocalWorkspace, Permission Gate, Tool Output Optimizer, Subscriber Bus, Docker Workspace, Stuck Detector, Cost Tracker, Core Integration.
- **[COMPLETE]** Phase M1: Model-Assisted Request Analyzer (`docs/25`).
- **[COMPLETE]** Phase M2: Model-Assisted Selector (`docs/26`).
- **[COMPLETE]** Phase M3: Model-Assisted History Compressor (`docs/27`).

### Other Key Directories
- `/src/types`: TypeScript interfaces (`budget.ts`, `candidate.ts`, `conflict.ts`, `registry.ts`, `selection.ts`, etc.) defining post-AJV in-memory states.
- `/src/cli` & `/dist`: Command-line interface and compiled output files.
- `/schemas`: **[AUTHORITY]** Authoritative JSON Schema validation boundaries (`inputs`, `outputs`, `internal`, `shared`).
- `/tests`: Evaluation harness driven by `harness.test.ts`, currently covering 651 test cases across Phase 0-12.
