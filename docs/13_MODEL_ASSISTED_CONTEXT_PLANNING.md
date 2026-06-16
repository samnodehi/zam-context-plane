# Model-Assisted Context Planning + History Compression

## 1. Status and Authority

| Field | Value |
|---|---|
| **Document type** | Future Architecture Note + MVP Compatibility Contract |
| **Created** | Pass 4.9D-2AE |
| **MVP authority** | None — this document does not change current MVP schemas, fixtures, enums, warning codes, trace shapes, prompt-plan shapes, or implementation behavior. |
| **Compatibility authority** | Active — current MVP architecture should preserve the extension seams documented here unless a later explicit decision pass changes them. |
| **Implementation status** | Not implemented. No module, selector, analyzer, compressor, adapter, or runtime code is authorized by this document. |
| **Provider/model calls in MVP** | Not allowed. MVP remains deterministic and offline. |
| **Schema changes from this document** | None. No schema file is created, modified, or extended by this document. |
| **Fixture changes from this document** | None. No fixture case is created, modified, or extended by this document. |
| **Canonical MVP specs** | `docs/04_PORTABLE_CORE_ARCHITECTURE.md`, `docs/05_COMPONENT_REGISTRY_SPEC.md`, `docs/06_SELECTOR_ORCHESTRATION_SPEC.md` remain canonical for all MVP behavior. |
| **Canonical MVP schemas and fixtures** | `docs/12_SCHEMA_AND_HARNESS_PLAN.md` remains the canonical tracker. All schema files in `schemas/` and all fixture files in `fixtures/` remain unchanged. |

---

## 2. MVP Non-Interference Guarantee

This section is a hard contractual statement, not a soft guideline.

**docs/13 does not authorize any change to:**

- MVP schema files (`schemas/shared/`, `schemas/inputs/`, `schemas/internal/`, `schemas/outputs/`)
- Fixture files (`fixtures/`)
- Enum values in `enums.shared.schema.json` (`SelectionAction`, `SelectionPath`, `SelectionConfidence`, `ComponentType`, `RiskLevel`, `OmissionPolicy`, `RetainPolicy`, `DefaultAction`, `BudgetHint`, `ResolutionRule`)
- Warning codes (advisory open enum in `warning-code.schema.json`)
- Trace shapes (`trace.schema.json`)
- Prompt-plan shapes (`prompt-plan.schema.json`)
- Selector ladder behavior (`docs/06` §8)
- Conflict Resolver behavior and priority table (`docs/06` §11.4)
- Budgeter behavior, trim conditions, and `budgetHint` interpretation (`docs/06` §20–§27)
- Injection gate behavior (`docs/06` §17)
- CLI/runtime/source implementation
- Provider/model integration or adapter code
- `docs/04`, `docs/05`, `docs/06`, `docs/09`, `docs/11`, `docs/12`, or `PROJECT_MASTER_PLAN.md`

**Additional guarantees:**

- Any future change motivated by concepts in docs/13 requires a separate explicit decision/scoping pass with its own scope boundary, allowed files, and acceptance criteria.
- docs/13 must not be used as direct implementation authority for any code, schema, or fixture work.
- docs/13 must not be used to reinterpret accepted MVP behavior documented in docs/04, docs/06, or docs/12.
- In case of conflict between docs/13 and current MVP specs/schemas, the current MVP specs/schemas remain canonical until separately amended through an explicit decision pass.

---

## 3. Current MVP Compatibility Commitments

Although docs/13 does not change MVP behavior, the current MVP architecture should avoid closing off the following extension seams. These are compatibility constraints, not active MVP features.

**Extension seams to preserve:**

1. **Request analysis can become model-assisted.** Future request analyzers can be introduced without changing the user input contract (`request-signals.schema.json`). Analyzer outputs would be separate proposal objects, not modifications to the current `requestSignals` shape.

2. **Analyzer outputs are additive, not overloading.** Future analyzer outputs (request profile, lane requirements, assessed risk) can be introduced as separate internal objects. They must not silently overload or redefine existing MVP objects (`SelectionDecision`, `ResolvedSelectionDecision`, `TraceEntry`).

3. **Selector outputs remain structured and traceable.** Future model-assisted selectors must produce the same structured `SelectionDecision` shape (owned by `docs/06` §4) or a formally accepted extension. Unstructured free-text selector outputs are not permitted.

4. **Prompt planning remains partition-based and traceable.** The three-partition output model (`selectedComponents`, `omittedComponents`, `deferredComponents`) remains the canonical output structure. Future extensions add metadata, not alternative output shapes.

5. **History is representable as lanes/components.** The current component registry model (`docs/05`) and history state summary input (`history-state-summary.schema.json`) can accommodate future structured history summaries. History is not limited to raw transcript only.

6. **Structured history summaries can coexist with recent raw turns.** Future history compression can produce structured state summaries alongside a configurable window of recent raw relevant turns. This does not require changing current schema shapes.

7. **Budgeter semantics remain compatible with lane-level governance.** Future lane-level budget allocation can extend current component-level Budgeter behavior without contradicting current `budgetHint` values or trim conditions (`docs/06` §20/§27).

8. **Cache mechanics remain provider-adapter-owned.** Cache stability classification (`stable`/`session`/`volatile`) is a PPG advisory concern (`docs/04` §7.7). Provider-specific cache implementation belongs in adapters. Cache classification must never alter `selectedComponents[]`, `omittedComponents[]`, or `deferredComponents[]` membership.

9. **Model-assisted components are proposal-only.** Future model-assisted analyzers and selectors are proposal sources behind deterministic guardrails. They must not bypass safety protections, fail-open behavior, or injection gate rules.

10. **Re-entry planning can be added.** Future re-entry context planning (after tool results, errors, retries) can be added without rewriting the core planning pipeline. Re-entry re-runs the planning flow from the analyzer forward with updated lane inputs.

11. **Output review can be added as a future loop stage.** Future output review/verification can be added after the main model call without changing MVP Prompt Plan Generator semantics. The PPG remains the boundary that produces `prompt-plan.json` and `trace.json`.

---

## 4. Purpose: Adaptive Context Governance

The system is not merely a prompt compressor. It is an adaptive context governance and smart prompt assembly layer.

**Goals:**

- Reduce unnecessary token usage in prompts sent to the main model.
- Improve prompt relevance by selecting only the context that matters for each request.
- Preserve safety, policy, and history constraints through deterministic guardrails and fail-open behavior.
- Improve traceability and auditability of all context planning decisions.
- Support future model-assisted planning without giving models unchecked deletion authority over prompt context.

**Observed motivation:**

Agent runtimes often inject large static scaffold, policy, history, and tool payloads into every prompt regardless of request type. In practice, a base prompt can be thousands of tokens, and with accumulated history can grow to tens of thousands or more. This increases cost, reduces signal-to-noise ratio, and can degrade the main model's decision quality.

The solution is not to blindly compress or truncate. It is to build a governed, traceable, schema-validated context planning layer that makes intelligent decisions about what context to include, omit, defer, or summarize — while ensuring that safety-critical, policy-required, and user-committed context is never silently dropped.

**Core identity:**

```
Adaptive Context Governance + Smart Prompt Assembly Layer
```

Not merely:

```
Prompt token reducer
```

---

## 5. Current MVP Boundary

The current MVP foundation is deterministic and offline. This section documents the exact boundary.

| Claim | Status |
|---|---|
| MVP remains deterministic/offline | Active — `docs/04` §4, §10 |
| `deterministicOnly=true` remains active selector behavior | Active — `docs/06` §2.9 |
| No provider/model-assisted selector call exists in MVP | Confirmed — `docs/04` §7.3 |
| No model-assisted request analyzer exists in MVP | Confirmed — `docs/04` §7.2: "Deterministic keyword/pattern matching" |
| No history compressor exists in MVP | Confirmed — `docs/04` §7.6: "No model-assisted summarization" |
| No provider-specific cache implementation exists in core MVP | Confirmed — `docs/04` §7.7; `docs/12` §9 exclusion register |
| MVP output stops at `prompt-plan.json`, `trace.json`, `summary.md` | Confirmed — `docs/04` §7.7, §7.8 |
| Harness code is not created | Confirmed — `docs/12` §11 |
| Implementation remains blocked on AC-01 | Confirmed — user approval of `docs/11` pending |
| docs/13 is now created as architecture note | This document — no implementation authority |

---

## 6. Current Foundation and Interface Points

The MVP deterministic foundation provides the extension points that future model-assisted context planning will use. This table maps current MVP stages to future concepts.

| Current MVP stage | Canonical owner | Future docs/13 concept | Relationship |
|---|---|---|---|
| Normalized Input Validator | `docs/04` §7.1 | Request Intake / Normalization | Future: extends with Tier-0 fast path |
| Request Router | `docs/04` §7.2; `docs/06` §2 | Request Analyzer / Tiered Routing | Future: model-assisted analyzer sits beside or replaces deterministic router |
| Section Selectors (fan-out) | `docs/04` §7.3; `docs/06` §8 | Lane Requirement Planner + Lane-Specific Selection | Future: model-assisted selectors as proposal sources behind deterministic ladder |
| Orchestrator Gap-Check | `docs/06` §3.1 | Candidate coverage / safety accounting | Unchanged — gap-check invariant is preserved |
| Conflict Resolver | `docs/06` §11 | Guardrail + Conflict Review | Future: model proposals enter as input decisions; existing deterministic priority table resolves |
| Budgeter | `docs/04` §7.5; `docs/06` §20–§27 | Context Budget Governor | Future: lane-level budget allocation extends component-level behavior |
| Prompt Plan Generator (PPG) | `docs/04` §7.7 | Prompt Plan Generation + Cache ordering advisory | Future: cache stability classification as advisory ordering; no membership change |
| Trace / Explainability Layer | `docs/04` §7.8 | Trace / Audit foundation | Future: trace extensions for analyzer output, summary trace, re-entry events |
| `prompt-plan.json` + `trace.json` output | `docs/04` §7.7–§7.8 | Future assembled prompt boundary | Future: adapter assembles actual prompt text from prompt-plan; core does not assemble text in MVP |
| — MVP ends here — | `docs/04` §10 | Main Model / Tool Loop / Re-entry / Output Review | Entirely post-MVP; outside current core boundary |

**Key principle:** Future concepts extend or sit beside current MVP stages. They do not replace MVP behavior today. The MVP deterministic pipeline remains the baseline that future model-assisted features build upon.

---

## 7. Core Principle: Model Proposes, Guardrails Enforce

```
Lightweight model proposes.
Deterministic guardrails enforce.
Schema validates.
Trace records.
Fail-open protects.
```

**In MVP, no model proposes. All selector decisions are deterministic.** The deterministic selector ladder (`docs/06` §8 Steps 1–7) is the sole decision authority.

**In the future model-assisted architecture:**

- A lightweight, inexpensive model may serve as a semantic proposer for request analysis, lane selection, history compression, and component relevance assessment.
- The lightweight model is a proposal source, not the final authority.
- All proposals must be structured, schema-valid, and traceable.
- Deterministic guardrails review every proposal before it takes effect.
- Safety protections (`docs/06` §8 Step 3: hard protection for `riskLevel: critical`, `retainPolicy: safety_critical/mandatory`, `omissionPolicy: never`) cannot be overridden by any model proposal.
- Fail-open behavior remains mandatory: when confidence is low or uncertainty exists, the system includes more context, not less.
- The injection gate (`docs/06` §17) continues to operate on model-assisted proposals exactly as it does on deterministic decisions.
- The accepted action/path schema (`docs/06` §4) governs all decisions regardless of their source (deterministic or model-assisted).

---

## 8. Request Analysis and Tiered Routing

### Current MVP

The Request Router (`docs/04` §7.2) uses deterministic keyword/pattern matching to classify requests and produce `requestSignals` (`docs/06` §2.1).

### Future Architecture

The future system may use multiple analysis tiers to balance cost, latency, and quality:

| Tier | Mode | When used | Example |
|---|---|---|---|
| **Tier 0** | Deterministic fast path | Greetings, acknowledgements, simple yes/no, no-op | "Hello", "Thanks", "OK" |
| **Tier 1** | Lightweight analyzer | Ordinary requests requiring semantic routing | "Explain how X works", "Add a unit test for Y" |
| **Tier 2** | Stronger analyzer/planner | Complex coding, ops/security, long project continuation, ambiguous tasks | "Continue the implementation from where we left off" |
| **Tier 3** | Fail-open / expanded context | Low confidence or high assessed risk | Any request where analyzer confidence is below threshold |

### Future Analyzer Output Fields `[FUTURE-ONLY]`

The following fields describe a possible future analyzer output structure. They are illustrative examples only. **None of these fields exist in any current MVP schema. They must not be added to `request-signals.schema.json` or any other MVP schema file without a separate explicit schema decision pass.**

| Field | Type | Description | Disambiguation |
|---|---|---|---|
| `requestType` `[FUTURE-ONLY]` | string | Broad request category (e.g., "coding", "research", "greeting") | Does not exist in MVP. Not a `requestSignals` field. |
| `taskType` `[FUTURE-ONLY]` | string | Specific task shape (e.g., "debug", "refactor", "review", "continuation") | Does not exist in MVP. |
| `assessedRequestRiskLevel` `[FUTURE-ONLY]` | string | Analyzer's assessment of request-level risk | **Disambiguated from** component `riskLevel` (`docs/05` §5), which is a registry field on individual components. `assessedRequestRiskLevel` is a request-level assessment, not a component property. |
| `analyzerConfidence` `[FUTURE-ONLY]` | float 0.0–1.0 | Analyzer's confidence in its classification | **Disambiguated from** `SelectionDecision.confidence` (`docs/06` §4), which is a string enum (`high`/`medium`/`low`). `analyzerConfidence` is a float, aligned with `requestSignals.familyConfidence`. |
| `neededLanes` `[FUTURE-ONLY]` | string[] | Lanes the analyzer believes are relevant | Advisory proposal only; deterministic guardrails validate. |
| `requiresHistory` `[FUTURE-ONLY]` | boolean | Whether the request needs history context | Advisory; protected lanes cannot be omitted regardless. |
| `requiresTools` `[FUTURE-ONLY]` | boolean | Whether the request needs tool context | Advisory. |
| `requiresFiles` `[FUTURE-ONLY]` | boolean | Whether the request needs file/project context | Advisory. |

### Constraints on Future Analyzer

- Future analyzers must produce `promptFamily` values from the accepted `PromptFamilyValue` enum (`docs/06` §2.2) or a formally extended version of it accepted through an explicit schema decision pass.
- Analyzer outputs are proposals. They must not override safety protections, injection gate behavior, or fail-open semantics.
- Low `analyzerConfidence` must trigger context expansion (fail-open), not context reduction.
- All analyzer outputs must appear in the trace for auditability.

---

## 9. Prompt Family and Lane Requirement Planning

### Current MVP

The prompt family is classified by the Request Router and consumed by the selector ladder (`docs/06` §8). It determines which `requiredWhen` and `safeToOmitWhen` tags match.

### Future Architecture

A future analyzer may propose both the prompt family and a set of needed lanes. However:

- Any future prompt family value must come from the accepted `PromptFamilyValue` enum or a formally accepted extension.
- Needed lanes are advisory proposals until deterministic guardrails validate them.
- Some apparently simple requests may be history-heavy (e.g., "continue", "fix that", "same as before" — these are continuation references that require full history/task state context).
- Some apparently complex requests may not need all lanes (e.g., a pure research question may not need tool context).
- Low confidence or high assessed risk should expand context (more lanes), not reduce it (fewer lanes).
- Protected lanes (safety, policy, durable constraints, open commitments) cannot be excluded by any lane requirement proposal.

---

## 10. History Compression and Summary Safety

### The Problem

As sessions grow, raw conversation history can become very large. Passing full raw history to the main model increases cost, adds noise, and can degrade response quality. However, dropping history entirely or relying on paragraph-style summaries is dangerous.

### Why Summary-Only Is Dangerous

A paragraph summary can:

- Omit recent user instructions.
- Distort accepted decisions or commitments.
- Lose nuance about failure modes and rejected approaches.
- Drop durable constraints that were established mid-conversation.
- Miss continuation references that the user assumes are still in context.

### Future History Compression Architecture

Future history compression should be a **structured state extractor**, not a paragraph summarizer.

**Required state extraction categories:**

| Category | Description | Already in MVP? |
|---|---|---|
| Current task state | Active task, current goal, blockers | No — future |
| Accepted decisions | Decisions accepted during the session | No — future |
| Open issues | Unresolved problems identified but not yet addressed | No — future |
| Open commitments | Promises, agreements, pending deliverables | Partially — `open_commitments` lane (`docs/04` §7.6) |
| User constraints | User-stated requirements and preferences | Partially — `userConstraints` input (`docs/06` §2.8) |
| Important files/paths | Files, directories, and paths referenced in the session | No — future |
| Failed attempts | Approaches tried and rejected, with reasons | No — future |
| Warnings | Active warnings and risk flags | No — future |
| Anti-regression rules | Hard lessons from the session (see §13) | No — future |
| Recent relevant turns | A configurable window of recent raw conversation turns | Partially — `recent_raw_turns` lane (`docs/04` §7.6) |
| Durable facts | Long-lived factual context established in the session | Partially — `durable_facts` lane (`docs/04` §7.6) |

### Structured Summary + Raw Window

Future history compression must pair structured summary with recent raw relevant turns:

```
structured state summary
+
recent raw relevant turns (configurable window)
+
durable decisions and constraints
+
anti-regression rules
```

Not full raw history. Not summary-only.

### Summary Trace

A future history compressor must produce trace output documenting what it retained, omitted, and was uncertain about:

| Trace category | Content |
|---|---|
| `included` | State categories and items retained in the summary |
| `omitted` | Items deliberately excluded (e.g., obsolete rejected drafts, duplicate reports) |
| `uncertain` | Items the compressor was not confident about retaining or omitting |

This trace is essential for debugging: if the main model makes an error, the trace reveals whether the error was caused by the summary (omitted critical information), the selector (wrong lane), or the prompt assembly (wrong ordering/formatting).

### Protected from Compression

The following must never be compressed away or omitted by a future history compressor:

| Protected category | Reason |
|---|---|
| Durable constraints | `dropAllowed: false` in MVP (`docs/04` §7.6) |
| Open commitments | `dropAllowed: false` in MVP |
| Recent direct user instructions | Prevents losing instructions the user just gave |
| Accepted decisions | Prevents decision re-litigation |
| Active task state | Prevents task context loss |
| Anti-regression rules | Prevents re-learning hard lessons |

**No SummaryTrace schema is created by this document. No history compressor implementation is created by this document.**

---

## 11. Lane-Based Prompt Assembly

### Concept

The final prompt sent to the main model should be assembled from distinct, addressable lanes/components rather than a single monolithic text block.

### Candidate Lanes

| Lane | Typical content | Stability class |
|---|---|---|
| System scaffold | Core system rules, identity, behavior constraints | `stable` |
| Project rules | Project-specific rules and guidelines | `stable` |
| Policy/safety | Safety rules, policy constraints, security guidelines | `stable` |
| Developer constraints | Developer-specified requirements and preferences | `session` |
| Skills (selected) | Skill definitions relevant to the current request | `session` |
| Tools (selected) | Tool definitions relevant to the current request | `session` |
| Memory | Persistent session memory, knowledge items | `session` |
| Anti-regression rules | Hard lessons and guardrails from the session (see §13) | `session` |
| Structured history summary | Compressed structured state from history (see §10) | `session` → `volatile` |
| Recent raw turns | Recent raw conversation turns | `volatile` |
| Active task state | Current task, goal, blockers, progress | `volatile` |
| Output format | Response format requirements | `volatile` |
| Runtime capabilities | Available runtime capabilities for this step | `volatile` |
| File context | Relevant files, diffs, error outputs | `volatile` |

### Disambiguation

The current MVP has `runtime-capabilities.json` as a distinct input file (`docs/06` §2.5). Future lane terminology ("runtime capabilities lane") refers to the conceptual prompt section containing runtime capability information. It does not silently redefine the `runtime-capabilities.schema.json` input schema.

### Lane Properties

- Each lane has a membership decision (include/omit/defer) determined by selectors and the conflict resolver.
- Lane membership is traceable through `selectorTrace`, `resolvedDecisions`, and output partition arrays.
- Lane membership is budget-aware — the Budgeter may trim optional lanes when over budget.
- Lane ordering may be optimized for cache stability (§15), but ordering must never alter membership.

---

## 12. Structured Decisions and Future Analyzer Outputs

### Principle

All decisions — whether from deterministic selectors or future model-assisted analyzers — must be structured, schema-valid, traceable, auditable, and harness-testable.

### Current MVP

Selector decisions use the canonical `SelectionDecision` shape owned by `docs/06` §4 (10 required/optional fields). Resolved decisions use `ResolvedSelectionDecision` owned by `docs/06` §11 and §27. These shapes are the sole canonical owners.

### Future Requirements

- Future model-assisted proposals must either conform to the canonical `SelectionDecision` shape (`docs/06` §4) or use a separately accepted future proposal schema defined through an explicit schema decision pass.
- docs/13 does not define that future proposal schema.
- docs/13 does not reproduce the `SelectionDecision` JSON shape. See `docs/06` §4 for the canonical definition.
- Future model-assisted decisions must not add the following fields to any core schema: `modelPrompt`, `modelResponse`, `rawAnalyzerOutput`, `providerCost`, `providerCacheKey`. These are provider-adapter concerns, not core schema fields.
- All future decisions must be:
  - **Structured** — JSON objects with defined fields, not free-text.
  - **Schema-valid** — conforming to an accepted schema.
  - **Traceable** — appearing in `trace.json` with decision ID, module, and evidence.
  - **Auditable** — carrying reason, confidence, and evidence fields.
  - **Harness-testable** — fixture-compatible for automated verification.

---

## 13. Anti-Regression Memory Lane

### Concept

Long-running project sessions accumulate hard-won lessons about tool behavior, process pitfalls, architectural constraints, and failure modes. These lessons are valuable context that prevents repeating costly mistakes.

### Future Anti-Regression Lane

A future anti-regression memory lane should:

- Carry structured rules derived from session experience (not raw chat history).
- Be a protected lane for relevant prompt families (project-continuation, implementation review, coding/debugging tasks).
- Be inactive for irrelevant prompt families (simple greetings, one-shot research, lifecycle/heartbeat).

### Lane Activation by Prompt Family

| Prompt family examples | Anti-regression lane active? |
|---|---|
| `coding_build_debug`, `ops_security_change_risk`, `history_sensitive` | Yes — project-continuation and implementation tasks benefit from hard-lesson context |
| `simple_greeting`, `lifecycle_heartbeat` | No — unnecessary for these request types |
| `general_default`, `research_exploration` | Conditional — depends on whether the session has project-specific lessons |

### Rule Structure and Lifecycle

Each anti-regression rule should carry metadata for lifecycle management:

| Field | Purpose |
|---|---|
| Category | Process rule, architectural rule, tool-specific rule, or safety rule |
| Source reference | The incident or pass that created the rule |
| Severity | Critical, important, advisory |
| Applicability | Which task types or prompt families this rule applies to |
| Review/expiry | When the rule should be reviewed for continued relevance |

### Important Constraints

- docs/13 defines the lane structure and lifecycle only. It does not embed specific anti-regression rules as normative permanent rules.
- Anti-regression rules should be reviewed periodically for continued relevance. Temporary process notes should not become permanent hard rules without review.
- Illustrative examples of anti-regression rule categories (not normative active rules):
  - Tool behavior constraints (e.g., encoding/formatting pitfalls).
  - Process guardrails (e.g., scope discipline, inventory-only pass boundaries).
  - Schema/architecture constraints (e.g., object type disambiguation).
  - Safety/policy constraints (e.g., fail-open defaults under uncertainty).

---

## 14. Context Budget Governor

### Current MVP

The Budgeter (`docs/04` §7.5; `docs/06` §20–§27) operates at the component level. It consumes `ResolvedSelectionDecision` records, reads `budgetHint` values (`protected`, `over_budget_protected`, `candidate_optional`, `expensive_optional`, `unknown_cost`), and determines which optional components to trim when the budget is exceeded. Protected and safety-critical components are never trimmed.

### Future Architecture

A future Context Budget Governor may extend current behavior with lane-level budget allocation:

- Each lane could have an approximate token budget based on its importance for the current request type.
- Trim priorities would be future lane-level generalizations of current component-level Budgeter behavior.
- The existing 5 `budgetHint` values (`docs/06` §20/§27) remain canonical. docs/13 does not introduce new values.
- The existing Budgeter trim conditions remain canonical: protected, `over_budget_protected`, `safety_critical`, and `mandatory` components are never trimmed.
- The accepted `budget_trim` output partition semantics (`docs/06` §23.5; Pass 4.9D-2Z/2AB) remain canonical.

### Protected from Trimming (Current + Future)

| Protected category | Current MVP status | Future status |
|---|---|---|
| Safety rules / `riskLevel: critical` | Protected (`docs/06` §8 Step 3) | Remains protected |
| `retainPolicy: safety_critical` / `mandatory` | Protected (`docs/06` §20.3) | Remains protected |
| `omissionPolicy: never` | Protected (`docs/06` §20.3) | Remains protected |
| Current user constraints | Protected (via `userConstraints.alwaysInclude`) | Remains protected |
| Active task state | N/A — future lane | Should be protected |
| Accepted decisions | N/A — future lane | Should be protected |
| Anti-regression rules | N/A — future lane | Should be protected |
| Recent direct user instructions | N/A — future lane | Should be protected |

### Trim Priority (Future, Illustrative)

When budget is exceeded, trim in this approximate order (most expendable first):

1. Verbose examples and redundant demonstrations
2. Repeated/duplicated context across lanes
3. Obsolete rejected attempts
4. Low-confidence memory items
5. Optional skills not relevant to the current request
6. Old raw turns already covered by structured summary

---

## 15. Token Cache / Stable Prefix Advisory

### Concept

Some portions of the prompt are stable across many requests and can benefit from provider-level caching (e.g., prompt prefix caching). However, cache mechanics are provider-specific and must not enter core schema.

### Provider-Neutral Classification

docs/13 defines a provider-neutral stability taxonomy for advisory use by the PPG during component ordering (`docs/04` §7.7):

| Classification | Description | Typical lanes |
|---|---|---|
| `stable` | Identical or nearly identical across many requests; changes only on deployment or project configuration change | System scaffold, project rules, stable policy/safety baseline |
| `session` | Stable within a session or task; may change across sessions | Developer constraints, anti-regression rules, selected skills/tools, memory |
| `volatile` | Changes every turn or every step | Recent raw turns, tool results, file diffs, errors, active task state, runtime capabilities |

### Ordering for Cache Stability

The PPG may order entries in `selectedComponents[]` so that `stable` components appear before `session` components, which appear before `volatile` components. This is already documented in `docs/04` §7.7 (Cache-Aware Component Ordering).

### Unconditional Invariants

- Cache ordering is **advisory only**. It affects the sequence of entries in `selectedComponents[]` only.
- Cache ordering **must never alter membership** of `selectedComponents[]`, `omittedComponents[]`, or `deferredComponents[]`. Which components appear in which list is decided entirely upstream by selectors, the Conflict Resolver, and the Budgeter.
- Cache ordering **must never authorize omission**. A `volatile` classification does not make a component safe to omit.
- **Safety ordering beats cache ordering.** Safety, fail-open, user constraint, budget enforcement, and hard-protection rules take unconditional precedence.

### Provider-Adapter Boundary

Provider-specific cache implementation belongs entirely in adapter implementations. The following fields are explicitly excluded from core MVP schemas per `docs/12` §9 (Non-MVP Exclusion Register) and must not be added:

- `cacheStability` (advisory, post-MVP)
- `stablePrefixHash` (advisory, post-MVP)
- `sessionPrefixHash` (advisory, post-MVP)
- `recommendedCacheBoundary` (advisory, post-MVP)
- `volatileAfterBoundary` (advisory, post-MVP)
- Provider cache API fields: `cacheControlHeaders`, `ttl`, `minBlockSize`, provider pricing/billing fields

These are mentioned here as explicitly excluded examples, not as planned fields.

---

## 16. Conflict Resolver and Guardrail Mapping

### Current MVP

The Conflict Resolver (`docs/06` §11) uses a deterministic 7-priority table (`docs/06` §11.4) to resolve conflicting `SelectionDecision` records for the same component. It produces `ResolvedSelectionDecision` records and `conflictResolutionTrace` entries.

### Future Architecture

docs/13 does not create a new conflict resolution system. Future model-assisted proposals enter the existing pipeline as additional input `SelectionDecision` records.

**Mapping:**

- Future model-assisted selector proposals are structured `SelectionDecision` objects with `selector: "model_assisted"` (or equivalent future identifier) in the trace.
- These proposals enter the Conflict Resolver alongside deterministic selector decisions.
- The existing deterministic priority table (`docs/06` §11.4) resolves conflicts.
- Deterministic guardrails may override or reject model proposals:
  - Safety hard-protection (`docs/06` §8 Step 3) overrides any model `omit` proposal for protected components.
  - User constraint include (`userConstraints.alwaysInclude`) overrides model `omit` proposals.
  - Injection gate (`docs/06` §17) applies to model-proposed decisions just as it does to deterministic decisions.
- Protected and safety-critical constraints remain authoritative over all model proposals.

---

## 17. Prompt Plan Generation and Trace Continuity

### Current MVP

The Prompt Plan Generator (PPG, `docs/04` §7.7) assembles resolved decisions into `prompt-plan.json`. The Trace Layer (`docs/04` §7.8) produces `trace.json`. Both are canonical MVP outputs.

### Future Architecture

- The PPG remains the boundary that turns accepted decisions into final output partitions.
- Future prompt assembly (producing actual prompt text from the plan) is downstream from `prompt-plan.json` and belongs to provider adapters, not the core.
- Future assembled prompt generation is a post-MVP adapter responsibility.
- Current `prompt-plan.json` and `trace.json` remain canonical MVP outputs.
- docs/13 does not add an assembled prompt schema.
- docs/13 does not require `expected/summary.md` fixtures.
- Future trace extensions (§20) may add new trace phase keys for analyzer output, summary trace, re-entry events, and output review findings. These would be additive to the current 8-key trace structure, not replacements.

---

## 18. Main Model, Tool Loop, and Re-entry Planning

### Post-MVP Boundary

The main model call is post-MVP and outside the current core boundary. MVP stops at `prompt-plan.json` / `trace.json` / `summary.md` generation (`docs/04` §10).

### Future Architecture

**Main model call:** The main model receives only the assembled prompt context — a structured, validated, budget-checked prompt produced by the context planning pipeline. It does not receive raw unplanned context.

**Tool loop:** After the main model decides that tools are needed, tool calls are executed. Tool results (outputs, errors, changed files, new data) change the context landscape.

**Re-entry planning:** After a tool result, file diff, error, retry, user clarification, or long-running task checkpoint, context planning should re-enter the pipeline:

```
Tool result / error / retry / clarification
→ Re-enter from Request Analyzer forward
→ Update relevant lanes with new information
→ Re-run selector fan-out with updated context
→ Re-resolve conflicts
→ Re-budget
→ Re-generate prompt plan
→ Next main model call
```

**Principle:**

```
Every reasoning step gets context-governed.
```

Re-entry does not blindly reuse the previous prompt. It updates the relevant lanes (adding tool results, error context, changed file state) and re-runs the planning pipeline so the next model call gets fresh, relevant, budget-appropriate context.

**This is future architecture only, not MVP behavior.**

---

## 19. Output Review / Verification

### Concept

After the main model produces output, a future output review stage can verify quality before delivery. This is entirely post-MVP.

### Task-Dependent Review

| Task type | Review focus |
|---|---|
| Coding tasks | Code review: syntax validity, security concerns, scope compliance, test coverage sanity |
| Research tasks | Source/citation review: factual accuracy, source quality, freshness |
| Agent-review tasks | Scope/status review: did the agent stay within the stated scope? Were all file changes authorized? |
| Artifact work | Artifact consistency review: are all referenced files, artifacts, and cross-references consistent? |
| General tasks | Instruction compliance review: does the output address the user's request? |

### Re-entry on Defect Detection

If the output review identifies defects, it may trigger re-entry planning (§18):

1. Defect information is added to the context (error lane, active task state).
2. Context planning re-runs with defect awareness.
3. The main model re-generates output with corrected context.

### Constraints

- Output review is future-only. No review schemas, harness fixtures, or implementation are created by docs/13.
- Output review must not unilaterally block response delivery without operator/human override.
- Output review findings must be traceable.

---

## 20. Trace Extensions and Future Harness Fixture Groups

### Future Trace Extensions

Future work may require additive trace extensions beyond the current 8-key trace structure. These would be new optional phase keys or sub-objects within existing phases:

| Extension | Description | When needed |
|---|---|---|
| Analyzer output trace | Structured trace of request analyzer output (tier, confidence, proposed lanes) | When model-assisted analyzer is implemented |
| Summary trace | Structured trace of history compressor decisions (included/omitted/uncertain) | When history compressor is implemented |
| Re-entry event trace | Trace of re-entry triggers and updated lane state | When re-entry planning is implemented |
| Output review trace | Trace of output review findings and re-entry decisions | When output review is implemented |
| Cache advisory trace | Trace of cache stability classification applied to components | When cache advisory ordering is implemented |

### Future Harness Fixture Groups

Future harness fixtures may test the following categories. None of these fixtures are created by docs/13.

| Fixture group | What it tests |
|---|---|
| Analyzer quality | Does the analyzer correctly classify request types and needed lanes? |
| Lane selection quality | Are the right lanes selected for each request type? |
| Summary preservation | Does the summary retain accepted decisions, open tasks, user constraints? |
| Summary distortion detection | Does the summary avoid changing the semantic meaning of retained items? |
| Anti-regression retention | Does the summary retain all active anti-regression rules? |
| Fail-open expansion | Does low confidence trigger expanded context, not reduced context? |
| Cache advisory non-membership | Does cache ordering never alter partition membership? |
| Re-entry after tool result | Does re-entry correctly update lanes after tool results/errors? |
| Output review loops | Does output review correctly trigger re-entry on defect detection? |
| Compression ratio | Does summary achieve meaningful token reduction vs. raw history? |

---

## 21. Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| **Lightweight model drops important context** | Main model makes incorrect decisions due to missing information | Fail-open behavior; protected lanes for safety/policy/constraints; confidence thresholds; deterministic override for critical components |
| **History summarizer distorts state** | Accepted decisions misrepresented; commitments lost; anti-regression rules dropped | Structured summary (not paragraph); source references for each extracted state item; uncertainty fields; summary trace with included/omitted/uncertain; recent raw turn window alongside summary |
| **Orchestration cost exceeds savings** | The cost of running the analyzer + selectors + compressor exceeds the token savings | Tier-0 fast path for trivial requests; tiered model routing (cheapest model that works); batching and parallelization |
| **Latency increases** | Additional model call adds latency before the main model responds | Deterministic fast path for simple requests; parallel lane selection; cache of stable component decisions; incremental re-planning instead of full re-planning |
| **Provider cache assumptions leak into core schema** | Core schema becomes provider-coupled; portability guarantee broken | Cache stability is advisory-only classification; no provider-specific fields in core schema; all cache mechanics in adapters; `docs/12` §9 exclusion register |
| **Prompt becomes intelligent but unauditable** | Model-assisted decisions are opaque and cannot be explained or debugged | All decisions structured and schema-valid; every decision appears in `trace.json`; harness fixtures test every decision path; `summary.md` provides human-readable narrative |
| **Model-assisted proposals bypass guardrails** | Safety-critical context omitted because model proposal was trusted without review | Model proposals are inputs to the deterministic conflict resolver, not final decisions; safety hard-protection (`docs/06` §8 Step 3) overrides all proposals; injection gate applies to all decisions regardless of source |

---

## 22. Phased Adoption Plan

| Phase | Description | Status |
|---|---|---|
| **Phase 0** | Current deterministic MVP foundation: schemas, fixtures, harness plan, deterministic selectors, offline CLI | Active — current work |
| **Phase 1** | docs/13 architecture note + MVP compatibility contract | This document — created by Pass 4.9D-2AE |
| **Phase 2** | Future: summary quality harness scoping — define fixture contract for history compressor quality testing | Not started — requires explicit scoping pass |
| **Phase 3** | Future: request analyzer / lane proposal schema scoping — define future `AnalyzerOutput` or `RequestProfile` schema shape | Not started — requires explicit schema decision pass |
| **Phase 4** | Future: trace extensions for summary/analyzer/re-entry/output-review — define additive trace phase keys | Not started — requires explicit schema decision pass |
| **Phase 5** | Future: provider adapter / cache implementation — implement provider-specific cache mechanics in adapters | Not started — requires explicit implementation pass; post-MVP |
| **Phase 6** | Future: model-assisted selectors behind deterministic guardrails — enable `deterministicOnly=false` with model-assisted proposal sources | Not started — requires explicit design pass; post-MVP |

Each future phase requires its own explicit decision/scoping pass with defined scope, allowed files, and acceptance criteria. No future phase is authorized by docs/13.

---

## 23. Glossary of New Terms

| Term | Definition | Disambiguation |
|---|---|---|
| **Adaptive context governance** | The overall discipline of deciding what context to include, omit, defer, or summarize for each model interaction — not just token compression, but intelligent, traceable, safety-aware context management. | New concept introduced by docs/13. |
| **Lane** | A conceptual prompt section (e.g., scaffold, skills, tools, history, memory, policy) that can be independently selected, omitted, deferred, or budget-governed. | In MVP, all lanes are represented as components in the component registry. Future lane-level governance is a generalization. |
| **Request analyzer** | A future module (potentially model-assisted) that classifies incoming requests and proposes which lanes and resources are needed. | In MVP, the Request Router (`docs/04` §7.2) performs this role deterministically. |
| `requestType` `[FUTURE-ONLY]` | Broad request category (e.g., "coding", "research", "greeting"). | Does not exist in any MVP schema. Not a `requestSignals` field. |
| `taskType` `[FUTURE-ONLY]` | Specific task shape (e.g., "debug", "refactor", "review", "continuation"). | Does not exist in any MVP schema. |
| `assessedRequestRiskLevel` `[FUTURE-ONLY]` | Analyzer's assessment of request-level risk (how risky is this request?). | **Different from** component `riskLevel` (`docs/05` §5, `enums.shared.schema.json#RiskLevel`), which is a per-component registry field. |
| `analyzerConfidence` `[FUTURE-ONLY]` | Float 0.0–1.0 confidence score for the analyzer's classification. | **Different from** `SelectionDecision.confidence` (`docs/06` §4), which is a string enum (`high`/`medium`/`low`). Aligned with `requestSignals.familyConfidence` (float). |
| `neededLanes` `[FUTURE-ONLY]` | String array of lanes the analyzer proposes as relevant. | Advisory proposal. Does not override protected lanes or safety constraints. |
| **History compressor** | A future module (potentially model-assisted) that converts raw conversation history into structured state summaries. | Does not exist in MVP. `docs/04` §7.6 defines history lanes but no compressor. |
| **Summary trace** | Future trace output from the history compressor documenting included/omitted/uncertain items. | Does not exist in MVP. No schema defined by docs/13. |
| **Anti-regression memory lane** | A future protected prompt section carrying hard-won lessons from the session to prevent repeating costly mistakes. | Does not exist in MVP as a distinct lane. See §13. |
| **Re-entry planning** | Future capability to re-run context planning after tool results, errors, retries, or user clarifications. | Post-MVP. See §18. |
| **Output review** | Future capability to verify main model output quality before delivery. | Post-MVP. See §19. |
| **Stable / session / volatile** | Provider-neutral cache stability classification for prompt components. `stable` = rarely changes; `session` = stable within a session; `volatile` = changes every turn. | Advisory classification used for PPG ordering only. Does not affect partition membership. See §15. |

---

## 24. Open Questions

The following questions are unresolved and require future explicit decision passes:

| # | Question | Impact |
|---|---|---|
| OQ-1 | What is the exact future `RequestProfile` / `AnalyzerOutput` schema shape? | Determines how analyzer proposals are structured and validated. |
| OQ-2 | Should model-assisted proposals reuse the canonical `SelectionDecision` shape (`docs/06` §4) or use a separate `ProposalDecision` object? | Determines whether proposals share or extend the existing schema. |
| OQ-3 | What is the `SummaryTrace` shape? | Determines how history compressor decisions are traced and tested. |
| OQ-4 | What is the default recent raw turn retention window? | Determines how many recent raw turns are kept alongside structured summary. |
| OQ-5 | How should cache-stable lane classification be represented without provider-specific schema pollution? | Determines whether classification is PPG-internal or exposed as advisory metadata. |
| OQ-6 | What is the minimum summary quality harness? | Determines which fixture groups (§20) are needed to validate compressor quality. |
| OQ-7 | What confidence thresholds should trigger expanded context (fail-open)? | Determines the boundary between normal and fail-open context planning. |
| OQ-8 | Which lanes are always protected for project-continuation tasks? | Determines the minimum protected lane set for long-running project sessions. |
| OQ-9 | How should output review findings be traced? | Determines whether output review has its own trace phase key or integrates into existing phases. |
| OQ-10 | What re-entry event taxonomy is needed? | Determines how re-entry triggers (tool result, error, retry, clarification) are classified and traced. |

---

## 25. Final Decision Statement

**Model-assisted context planning is accepted as a post-MVP architecture direction.**

**docs/13 also establishes current MVP compatibility constraints so the deterministic foundation does not block that direction.**

**Summary of authority:**

- Future architecture direction: **Accepted and documented.**
- Current MVP behavior: **Unchanged.** Deterministic, offline, schema-validated, fixture-tested.
- Current MVP schemas, fixtures, enums, warning codes, trace shapes, prompt-plan shapes: **Not changed by this document.**
- Provider/model calls in MVP: **Not allowed.**
- Implementation, harness code, source code, adapter code: **Not authorized by this document.**
- Future schema/fixture/runtime/provider/adapter work: **Requires separate explicit decision passes with defined scope, allowed files, and acceptance criteria.**

**This document is a planning note and compatibility contract, not an implementation authorization.**

**Core principle preserved:**

```
Lightweight model proposes.
Deterministic guardrails enforce.
Schema validates.
Trace records.
Fail-open protects.
```

In MVP, no model proposes. All decisions are deterministic. The foundation is built. The extension seams are preserved.
