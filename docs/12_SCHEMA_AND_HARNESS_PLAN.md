# 12 Schema and Harness Plan

> **Status:** Draft — Sections 1–12 currently populated. Pass 4.9B-3 originally appended Sections 6–11; Pass 4.9D-2AI added §10 Harness Runner Contract and renumbered the former §10 Next Pass Sequence to §11 and former §11 Final Status to §12.
> **Source basis:** `docs/09_IMPLEMENTATION_READINESS_AUDIT.md` Pass 4.8F; `docs/11_CLI_MVP_IMPLEMENTATION_PLAN.md` Pass 4.9A.
> **Code implementation:** Not started. Prohibited until user explicitly approves `docs/11`.
> **Actual JSON Schema files:** Batch A (shared) created and audited — Pass 4.9C-2A/2B. Batch B (inputs) created and audited — Pass 4.9C-2B; Batch B extension accepted — Pass 4.9C-5B.1: `schemas/inputs/component-registry.schema.json`, `schemas/inputs/request-signals.schema.json`. Batch C (internal data objects) created prematurely then audited and accepted — Pass 4.9C-3S. Batch D (output files) created and accepted — Pass 4.9C-4C.2: `schemas/outputs/prompt-plan.schema.json`, `schemas/outputs/trace.schema.json`. No remaining schema batch is pending. Fixture inventory accepted (Pass 4.9D-1). **28 fixture cases created, verified, and accepted — Pass 4.9D-2A/2A.1 (first batch, 4 cases, 44 files; resolvedAt repaired Pass 4.9D-2C.2) + Pass 4.9D-2C/2C.1 (second batch, 4 cases, 44 files) + Pass 4.9D-2E/2E.1/2E.2/2E.3 (third batch, 4 cases, 44 files) + Pass 4.9D-2G/2G.1 (fourth batch, 4 cases, 44 files) + Pass 4.9D-2I/2I.1/2I.2/2I.3 (fifth batch, 4 cases, 44 files; trimActions semantics repaired Pass 4.9D-2I.2) + Pass 4.9D-2L/2L.1 (sixth batch, 3 cases, 33 files; CLEAN_WITH_NOTES: quarantine warning-code ambiguity noted, non-blocking) + Pass 4.9D-2O/2O.1 (seventh batch, 2 cases, 22 files; CLEAN_WITH_OUT_OF_SCOPE_FOLLOW_UP: old fixture 17 narrative drift noted) + Pass 4.9D-2R/2R.1 (eighth batch, 2 cases, 22 files; CLEAN_WITH_DEFERRED_SUBCASE: warn_and_continue override sub-case deferred) + Pass 4.9D-2AC/2AC.1 (ninth batch, 1 case, 11 files; first non-empty trimActions[] fixture) — total 308 files: 224 input JSON, 56 expected JSON, 28 assertions.md. Old fixture 17 narrative drift repaired Pass 4.9D-2O.2/2O.3 (field-only repair, case count unchanged).** Full fixture suite not complete. Harness code not created. `docs/13_MODEL_ASSISTED_CONTEXT_PLANNING.md` created by Pass 4.9D-2AE (Future Architecture Note + MVP Compatibility Contract; does not change MVP schema/fixture/runtime behavior). See §12 for full status.
> **Tests / harness implementation:** Not created. Harness coding is Phase 12 of `docs/11`.
> **Runtime / OpenClaw / provider work:** Untouched.
> **Scope:** Planning document only.

---

## 1. Purpose and Scope

This document plans two tightly coupled deliverables:

1. **JSON Schema generation** — formal schema files for all CLI input objects, internal data objects, and output files produced by the CLI MVP.
2. **Evaluation Harness design** — fixture group specifications, zero-tolerance check definitions, and harness tool contract.

These two deliverables are planned together because **harness assertions depend directly on schema-defined fields and enums**. A fixture cannot assert that `resolutionRule` is a member of a 14-value enum unless the schema defines that enum. A harness cannot filter `deferredComponents[]` by `path` unless the schema marks `path` as `required`.

**What this document does not do:**

| Excluded activity | Why |
|---|---|
| Generate all remaining `.json` schema files | Batch A/B/C schemas created and audited/accepted (Pass 4.9C-2A/2B, 4.9C-3S); Batch B extension `component-registry.schema.json` and `request-signals.schema.json` created and accepted (Pass 4.9C-5B.1); Batch D output schemas `prompt-plan.schema.json` and `trace.schema.json` created and accepted (Pass 4.9C-4C.2). Future schema extensions require explicit later passes. |
| Create harness test fixtures | Harness coding is Phase 12 of `docs/11` |
| Implement any module code | Prohibited until `docs/11` is user-approved |
| Touch runtime / OpenClaw / provider systems | Gate D permanently blocked in MVP |
| Approve actual code implementation | AC-01 pending — user review of `docs/11` required first |

**Authority:** `docs/09` Pass 4.8F verdict `READY_FOR_IMPLEMENTATION_PLAN`; `docs/11` Pass 4.9A (all 12 sections complete); Gate A (schema) and Gate B (harness) both 🟢 Ready.

---

## 2. Schema Design Rules

### 2.1 Core Rules

All MVP JSON Schema files must follow these rules without exception:

| Rule | Requirement |
|---|---|
| **Read canonical sources first** | Every schema field, enum value, and constraint must be traced to a canonical spec section before being added. No invented fields. |
| **No future-only fields** | Fields deferred by safe-defer decisions (see §2.3) must not appear in MVP schema files, even as optional fields. |
| **No invented values** | Schema must not introduce new `action`, `path`, `confidence`, `budgetHint`, `resolutionRule`, or warning code values beyond those defined in canonical specs. |
| **Distinguish raw input from effective runtime values** | Some input fields (e.g., `injectionSuspectAction`) accept a superset of values at the input boundary that the runtime normalizes before applying. The input schema and the effective/normalized schema may differ — see §2.2. |
| **Support harness assertions** | Every field the harness must assert on must be `required` in schema. Optional fields cannot be reliably asserted by zero-tolerance checks. |
| **Preserve privacy rules** | Schema must not define fields that would permit raw component text, raw history turn content, API keys, credentials, or secrets in any output file. |
| **`selectedComponents[]` membership is immutable by ordering** | Cache-aware ordering fields are advisory only and must never appear in schema as fields that gate or authorize omission. |
| **`path` required on `deferredComponents[]`** | Every `deferredComponents[]` entry must carry `path` as `required: true` so harnesses can filter `runtime_unavailable` vs `default_defer` subtypes. |
| **`budgetOverflow` always explicit** | Schema must define `budgetOverflow` as a required boolean on `BudgetReport`; optional would allow the zero-tolerance "silent overflow" check to be bypassed. |

### 2.2 Raw Input vs Effective Runtime Value Distinction

Some schema decisions require two distinct schemas or a carefully documented boundary:

- **`injectionSuspectAction`** (in `selectorPolicy` input): The raw input schema must accept `"halt_planning"` as a recognized reserved value, not reject it as invalid. The orchestrator recognizes it, emits `policy_value_not_implemented`, and normalizes to `warn_and_continue`. If the input schema rejects `"halt_planning"` outright, this fallback warning cannot fire — it would be mistaken for a malformed input rather than a recognized-but-not-implemented policy value. See §3.7 for the full treatment.
- **`candidateSetPolicy`**: The orchestrator accepts only `"all_non_quarantined"` in MVP and halts on any other value with `unsupported_candidate_set_policy`. This is an internal constant, not a user-facing schema field.

### 2.3 Non-MVP Exclusion Summary

The following must not enter any MVP schema file. Full exclusion register with canonical references is in §9 (Pass 4.9B-3).

| Excluded item | Canonical deferral |
|---|---|
| `action: quarantine` | Registry-phase state only — `docs/06` §4 F-17 |
| `action: unavailable` (dedicated) | Safe-defer 5-Q7/F-28; use `defer + path: runtime_unavailable` |
| `unknownId` field on `SelectionDecision` | Safe-defer 5-Q4; `componentId` carries unknown string in MVP |
| `capabilityTimestamp`, `capabilityVersion` | Safe-defer 5-Q3/F-26; `docs/06` §2.5 |
| `budgetTrimmable` field on component | Future policy gate — `docs/05` Future Optional Fields; F-30 |
| `byPriority` breakdown on `conflictSummary` | Safe-defer 12-Q5; derivable post-hoc from trace |
| `deferSubtype` field | Safe-defer 5-Q7; `path` is the MVP filter mechanism |
| `constraintTrustLevel` on `userConstraints` | Safe-defer 5-Q5; MVP is operator-supplied high-trust |
| `injectionEvidenceCodes` on `requestSignals` | Future additive field; must not replace boolean |
| Cache advisory prompt-plan fields (`cacheStability`, `stablePrefixHash`, etc.) | Post-MVP adapter work — `docs/04` §7.7 |
| `budgetTrimmable: true` override | Not in MVP — `docs/04` §7.5 |
| `contentInline` on component | Security/privacy concern — `docs/05` Future Optional Fields |
| `dependencies` on component | Dependency graph not in MVP |

> **`halt_planning` note:** `halt_planning` is NOT simply excluded. It is a recognized reserved value that the raw `selectorPolicy` input schema must accept. See §3.7.

---

## 3. CLI Input Schema Planning

### 3.1 Overview

| Input | CLI flag | Class | Canonical owner | Schema priority |
|---|---|---|---|---|
| Component registry | `--registry` | **A** | `docs/05` §3–§8 | 1 — all selector groups depend on it |
| Request text (→ `requestSignals`) | `--request` | **A** | `docs/06` §2.1–§2.2 | 2 — all ladder groups depend on it |
| Active IDs | `--active-ids` | **B** | `docs/06` §2.1 optional signals; 15-Q2 | 3 |
| Runtime capabilities | `--runtime` | **B** | `docs/06` §2.5 | 4 |
| History state summary | `--history` | **B** | `docs/06` §2.6 | 5 |
| Budget state | `--budget` | **B** | `docs/06` §2.7 | 6 |
| User constraints | `--constraints` | **B** | `docs/06` §2.8 | 7 |
| Selector policy | `--policy` | **B** | `docs/06` §2.9 | 8 |

### 3.2 Registry Input (`--registry`)

| Planning item | Detail |
|---|---|
| Class | **A** — halt if absent or unloadable |
| Schema | `schemas/inputs/component-registry.schema.json` — **created and accepted** (Pass 4.9C-5B.1) |
| Top-level shape | Bare JSON array of component objects (`type: array`, `minItems: 1`); no wrapper object |
| Fields | **18 required fields** + 2 optional MVP fields per `docs/05` §3 — id, type, title, summary, source, tokensApprox, charsApprox, riskLevel, requiredWhen, safeToOmitWhen, defaultAction, omissionPolicy, retainPolicy, budgetPriority, evidenceRequired, tags, version, hash. (Note: `docs/12` §3.2 previously said "16 required fields" — corrected to 18 to match `docs/05` §3 Minimum Required Fields table and the accepted schema.) |
| Required enums | `type` (8 values), `riskLevel` (4 values), `omissionPolicy` (3 values), `retainPolicy` (4 values), `defaultAction` (3 values) — all `$ref` to `enums.shared.schema.json` |
| `evidenceRequired` | String or null; grammar validated by loader/orchestrator — schema accepts any non-empty string at boundary; invalid grammar disables Path A (not normalized to null) |
| `hash` | Key always required; value may be null |
| `tokensApprox` / `charsApprox` | ≥ 1 unless `metadataOnly: true`; cross-field rule enforced by loader, not schema |
| Harness dependency | All fixture groups — registry is the input to every selector |

### 3.3 Request Signals (`--request` → `requestSignals`)

The raw request is plain text. The Request Router produces `requestSignals`; the orchestrator receives the struct.

| Planning item | Detail |
|---|---|
| Class | **A** — halt if `requestSignals` absent or undecodable |
| Schema | `schemas/inputs/request-signals.schema.json` — **created and accepted** (Pass 4.9C-5B.1) |
| `injectionSuspect` | Required boolean; strictly typed (`type: boolean`) — if non-boolean, orchestrator treats as `false` + emits `injection_suspect_malformed` warning |
| `promptFamily` | Required closed enum — `$ref` to `PromptFamilyValue` (10 known values). **Closed enum at schema boundary**: only known values are schema-valid; unknown values are schema-invalid at this boundary. JSON Schema does not perform substitution. Runtime handling of unknown values is a separate design concern. |
| `familyConfidence` | Required float 0.0–1.0; required at schema boundary — governs familyConfidence escalation rule (`docs/06` §17.3.4); absence is schema-invalid |
| `explicitCallerFlags` | Optional `string[]`; operator-supplied override flags — must never contain raw user text |
| Optional signals | `activeSkillIds`, `activeToolIds`, `activeMemoryIds` (string arrays); `outputFormatHint` (open string or null) |
| Privacy rule | No raw user request text; no `requestText`/`userText`/`rawRequest` field; `additionalProperties: false` enforces boundary |
| Non-MVP field | `injectionEvidenceCodes` — future additive field; must not replace `injectionSuspect` boolean |
| Harness dependency | Injection gate 17 checks; ladder step fixtures |

### 3.4 Active IDs (`--active-ids`)

| Planning item | Detail |
|---|---|
| Class | **B** — if absent, treat all three arrays as empty `[]`; no warning on absence |
| Fields | `activeSkillIds: string[]`, `activeToolIds: string[]`, `activeMemoryIds: string[]` |
| Malformed behavior | Emit `active_ids_missing` warning; treat as empty |
| Validation | Validated at core boundary before selector fan-out; unknown IDs (not in `componentsById`) produce `active_id_unknown` planning warning per ID |
| Critical distinction | Unknown active IDs do **not** produce `reference_unknown` `SelectionDecision` records — these are two distinct warning classes (`active_id_unknown` vs `reference_unknown`) |
| Harness dependency | Skill selector, tool selector, memory selector fixture groups |

### 3.5 Runtime Capabilities (`--runtime`)

| Planning item | Detail |
|---|---|
| Class | **B** — if absent: `capabilityInventoryComplete: false`, both lists empty, emit `runtime_capabilities_missing` |
| Required fields | `availableToolIds: string[]`, `unavailableToolIds: string[]`, `capabilityInventoryComplete: boolean`, `runtimeLabel: string` |
| Non-MVP fields excluded | `capabilityTimestamp`, `capabilityVersion` — safe-defer 5-Q3/F-26 |
| Schema decision | `capabilityInventoryComplete` must be `required: true`; its value governs the fail-open vs defer split |
| Harness dependency | `runtime_unavailable` fixture group; omission fixture validity (must assert `capabilityInventoryComplete: true`) |

### 3.6 History State Summary (`--history`)

| Planning item | Detail |
|---|---|
| Class | **B** — if absent or `historyMalformed: true`: include all `riskLevel: high` / non-optional history components |
| Key fields | `lanesPresent: string[]`, `durableConstraintsPresent: boolean`, `openCommitmentsPresent: boolean`, `recentRawTurnCount: integer`, `totalHistoryTokensApprox: integer`, `historyMalformed: boolean` |
| Privacy rule | No raw turn content in this object; hash/ref only in trace |
| Harness dependency | History selector fixtures; conflict Case 12 (`history_malformed_fail_open`) |

### 3.7 Selector Policy (`--policy`)

| Planning item | Detail |
|---|---|
| Class | **B** — if absent: `failOpenThreshold: 0.7`, `deterministicOnly: true`, `injectionSuspectAction: "warn_and_continue"`, emit `selector_policy_defaulted` |
| `failOpenThreshold` | Float 0.0–1.0; schema may warn on values near 0.0 |
| `deterministicOnly` | Boolean; always `true` in MVP — model-assisted selectors not implemented |
| `injectionSuspectAction` | See table below |

**`injectionSuspectAction` schema strategy:**

| Value | Status | Input schema treatment | Effective behavior |
|---|---|---|---|
| `warn_and_continue` | ✅ Active MVP | Accept; apply normally | Ladder behavior preserved; ordinary low/medium Path A/B omits may remain omitted and are annotated with `injection_suspect_omit_allowed`. Branch A (hard-protection: `riskLevel: critical`, `retainPolicy: safety_critical/mandatory`, `omissionPolicy: never`) and Branch B (`riskLevel: high`) omit paths cannot reach injection-gate override — Branch A is included at Step 3; Branch B falls to Step 11 fail-open. Branch C (low/medium `type: policy`, history-durable-like without hard-protection metadata) remains unresolved/deferred. `injection_suspect_policy_override` is reserved/advisory and not required by active MVP behavior. (Clarified Pass 4.9D-2U/R2) |
| `fail_open_all` | ✅ Active MVP | Accept; apply normally | Path A and Path B globally suppressed; all omit → include/fail_open |
| `halt_planning` | 🔒 Reserved recognized future value | **Accept in raw input schema** (do not reject as invalid) | Orchestrator emits `policy_value_not_implemented` + normalizes to `warn_and_continue` + records fallback in trace |
| Any other unknown value | ❌ Unrecognized | **Accept at raw input schema boundary** (open string, no enum enforced); orchestrator emits `injection_action_unknown` | Normalize to `warn_and_continue` |

> **Critical schema rule:** `halt_planning` must be accepted at the raw `selectorPolicy` input boundary. If the input schema rejects it as an unknown enum value, the orchestrator cannot emit `policy_value_not_implemented` — the fallback trace entry would be lost and the warning path would be silently broken. The distinction between `policy_value_not_implemented` (for `halt_planning`) and `injection_action_unknown` (for genuine typos) must be preserved. Canonical: `docs/06` §2.9; F-24 resolved.

### 3.8 Budget State and User Constraints

| Input | Class | Key fields | Non-MVP exclusion | Harness dependency |
|---|---|---|---|---|
| Budget state (`--budget`) | **B** | `totalPromptTokenTarget`, `maxScaffoldTokens`, `maxSkillTokens`, `maxToolTokens`, `maxHistoryTokens`, `reservedUserTokens`, `budgetCritical` | — | Budget hint / expensive_optional groups |
| User constraints (`--constraints`) | **B** | `alwaysInclude: string[]`, `neverInclude: string[]`, `constraintSource: string` | `constraintTrustLevel` (safe-defer 5-Q5) | Conflict resolution constraint groups |

---

## 4. Internal Object Schema Planning

### 4.1 Registry Indexes

| Planning item | Detail |
|---|---|
| Canonical owner | `docs/05` §3, §8; `docs/04` §7.1 |
| Key structures | `componentsById: Map<id → ComponentDefinition>`, `componentsByType`, `componentsByTag`, `safetyCriticalIds: Set<id>`, `trimmableCandidateIds: Set<id>`, `quarantinedComponents: component[]`, `validationWarnings: warning[]` |
| Schema decision | `quarantinedComponents` must be a separate list — components here must not appear in `componentsById` |
| Harness dependency | Registry/quarantine fixture group; gap-check denominator verification |

### 4.2 Candidate Set / `candidateSetSummary`

| Planning item | Detail |
|---|---|
| Canonical owner | `docs/06` §3.1 |
| Required fields | `candidateSetPolicy: "all_non_quarantined"` (required string, MVP only value), `candidateSetSize: integer` (required; gap-check denominator), `quarantinedExcluded: integer` |
| Placement in `trace.json` | Under `registryPhase` — emitted before selector fan-out |
| Schema decision | All three fields `required: true`; `candidateSetSize` must be integer ≥ 0 |
| Non-MVP values | `by_type`, `by_prompt_family`, `explicit_component_ids` — named for future reference only; must not appear in MVP schema enum |
| Harness dependency | 5 candidateSetSummary harness checks; gap-check denominator invariant |

### 4.3 `SelectionDecision`

| Planning item | Detail |
|---|---|
| Canonical owner | `docs/06` §4 (sole canonical owner — do not redefine elsewhere) |
| Required fields (all 10) | `componentId`, `selectorName`, `action`, `reason`, `path`, `confidence`, `evidence[]`, `constraintsApplied[]`, `warnings[]`, `traceRefs[]` |
| `action` enum (4 values) | `include`, `omit`, `defer`, `reference_unknown` |
| `path` enum (**12 values**) | `required_match`, `safe_to_omit_match`, `default_action_omit`, `default_include`, `default_defer`, `fail_open`, `conflict_include`, `safety_override`, `runtime_unavailable`, `not_evaluated`, `reference_unknown`, `quarantine_boundary_violation` |
| `confidence` enum (3 values) | `high`, `medium`, `low` — string enum only; no float confidence on `SelectionDecision` (F-08 resolved) |
| `traceRefs[]` | Array of trace entry IDs referencing `TraceEntry.decisionId` in `selectorTrace`; reverse-link from decision to trace events |
| Non-MVP exclusions | `action: quarantine`, `action: unavailable`, `unknownId` field |
| Schema decision | `evidence[]` must be `required: true` and non-empty for any `action: omit` decision; empty `evidence[]` with `omit` is a harness failure |
| Harness dependency | Every selector and ladder fixture group; Path A/B groups; Step 3 group |

### 4.4 Selector Trace Entries and `selectorTrace`

> **Critical schema distinction:** `selectorTrace` is **not** an array of `SelectionDecision` objects. These are two distinct object types with a bi-directional reference relationship. Collapsing them is a schema error.

| Object | Description | Reference direction |
|---|---|---|
| `SelectionDecision` | The decision record produced by a selector (§4.3 above) | `traceRefs[]` → array of `decisionId` values pointing to `TraceEntry` objects |
| `TraceEntry` | A trace event object embedded in `selectorPhase.selectorTrace[]` | `decisionId` → references back to a `SelectionDecision` |

**`TraceEntry` shape (canonical: `docs/04` §7.8):**

| Field | Type | Note |
|---|---|---|
| `decisionId` | string (UUID) | Links to the `SelectionDecision`; referenced in `traceRefs[]` |
| `componentId` | string | Registry ID of the evaluated component |
| `module` | string | Selector module name (e.g., `ScaffoldSelector`) |
| `action` | string | Action produced |
| `reason` | string | Human-readable explanation |
| `evidence` | string[] | Signal atoms |
| `confidence` | string | `high`, `medium`, or `low` — string enum |
| `risk` | string | Component risk level at time of decision |
| `estimatedSavings` | object | `{ tokens: integer }` — omit savings; not counted for `defer` |
| `failOpen` | boolean | Whether this decision was a fail-open outcome |
| `selector` | string | `"deterministic"` in MVP |

**Placement:** `selectorTrace` is embedded at `trace.json.selectorPhase.selectorTrace` (not a separate file in MVP). Canonical: `docs/06` §3.2; 5-Q2 resolved.

**Schema author warning:** Do not define `selectorTrace` as `array of SelectionDecision`. The trace entries carry their own fields (`decisionId`, `module`, `failOpen`, `estimatedSavings`, `selector`) that do not exist on `SelectionDecision`. `SelectionDecision.traceRefs[]` points to `TraceEntry.decisionId`. These are companion objects, not the same object.

**Privacy rule:** Raw component content and raw history turn content must not appear in any `TraceEntry` field. Only `componentId`, `hash`, and `source` references are permitted.

| Harness dependency | Trace structure validation; every selector/ladder fixture group |

### 4.5 `selectorSummary`

| Planning item | Detail |
|---|---|
| Canonical owner | `docs/06` §3.6 |
| Required count fields | `totalEvaluated`, `decidedInclude`, `decidedOmit`, `decidedDefer`, `defaultDefer`, `runtimeUnavailableDefer`, `failOpenInclude`, `conflictsIdentified`, `unknownReferences` — all integer |
| `narrative` | String — deterministic template only; no model generation; template defined in `docs/06` §3.6 |
| Quarantine events | Not counted in `selectorSummary` — registry-phase events only |
| Harness dependency | `summary.md` narrative harness check; 5 `candidateSetSummary` accounting checks |

### 4.6 `planningWarnings`

| Planning item | Detail |
|---|---|
| Canonical owner | `docs/06` §3.4 |
| Shape | Array of `{ code: string, componentId?: string, message: string }` |
| Warning codes must be canonical | `runtime_capabilities_missing`, `active_ids_missing`, `selector_policy_defaulted`, `history_summary_missing`, `budget_config_missing`, `injection_suspect_malformed`, `policy_value_not_implemented`, `unexpected_quarantine_reference`, `active_id_unknown`, `path_a_null_evidence`, `unexpected_ladder_fallback`, etc. |
| Global vs per-decision | Global warnings go in `planningWarnings`; per-decision warnings go in `SelectionDecision.warnings[]` |
| Harness dependency | Class A/B input fixture group; injection gate fixtures; all zero-tolerance checks |

### 4.7 `ResolvedSelectionDecision`

| Planning item | Detail |
|---|---|
| Canonical owner | `docs/06` §11, §27 (sole canonical owner) |
| Required fields | `componentId`, `finalAction`, `finalPath`, `inputDecisionIds[]`, `losingDecisions[]`, `resolutionRule`, `warningsEmitted[]`, `resolvedAt` |
| Budget hint fields (from §27 survival) | `budgetHint`, `budgetWarningCodes`, `tokensApproxObserved`, `budgetPriorityObserved`, `budgetCriticalObserved` |
| `resolutionRule` enum | **14 canonical values** per `docs/06` §11.3.1a — strict enum; unrecognized value is a harness failure |
| `losingDecisions[]` | Contains only true losers from conflict; must not include winning decision |
| Non-MVP exclusions | `byPriority` breakdown deferred 12-Q5 |
| Harness dependency | Conflict resolution 16 checks |

### 4.8 `conflictResolutionTrace`, `noConflictComponentIds`, and `conflictSummary`

> **Important placement distinction (canonical: `docs/06` §11.3.2):** `noConflictComponentIds` is a **separate `string[]` output** of the Conflict Resolver — it is NOT a field inside `conflictSummary`. `conflictSummary` carries only the `noConflict` **count** (integer). Do not embed `noConflictComponentIds` into `conflictSummary`.

| Object | Canonical owner | Shape / Required fields | Harness dependency |
|---|---|---|---|
| `conflictResolutionTrace` | `docs/06` §11.3.2, §11.6 | Array of full resolution entries; **8 required fields + 4 optional gate-conversion fields** per entry; emitted only for components with actual conflicts — no entry for no-conflict components | Conflict 16 checks |
| `noConflictComponentIds` | `docs/06` §11.3.2 | Separate `string[]` — lightweight ID list; one entry per component with a single unambiguous decision; **not inside `conflictSummary`** | Accounting invariant: `noConflictComponentIds.length + conflictResolutionTrace.length = candidateSetSummary.candidateSetSize` |
| `conflictSummary` | `docs/06` §11.3.4 | `{ totalComponents: integer, noConflict: integer, resolvedConflicts: integer, failOpenResolutions: integer, unresolvedConflictWarnings: integer, narrative: string }` — `noConflict` must equal `noConflictComponentIds.length`; no `byPriority` breakdown in MVP | `summary.md` narrative; accounting checks |

> **`noConflictComponentIds` accounting rule:** `noConflictComponentIds.length + conflictResolutionTrace.length` must equal `candidateSetSummary.candidateSetSize`. A mismatch is a traceability failure. `reference_unknown` records are tracked separately in `referencedUnknownComponents` and are not subtracted from the candidate-set denominator.

> **Excluded from `conflictSummary` schema:** `byPriority` breakdown — safe-defer 12-Q5. Derivable post-hoc from `conflictResolutionTrace` by grouping on `resolutionRule`. The `narrative` field is freeform text for `summary.md` only; harness must not parse it.

### 4.9 `BudgetReport`

| Planning item | Detail |
|---|---|
| Canonical owner | `docs/04` §7.5; `docs/06` §20, §23, §25, §27 |
| Required fields | `budgetPlan`, `trimOrder`, `budgetOverflow: boolean` (required — not optional), `over_budget_protected` warnings, `budgetHint` interpretation results |
| `budgetOverflow` schema rule | Must be `required: true`, type `boolean`; optional would permit the zero-tolerance "silent budget overflow" check to be bypassed |
| `budgetHint` enum (5 values only) | `protected`, `over_budget_protected`, `candidate_optional`, `expensive_optional`, `unknown_cost` — canonical owner `docs/06` §20/§27; no other values permitted |
| `expensive_optional` threshold | 500 tokens static in MVP — not a schema field, a Budgeter constant |
| Mutation invariant | Budgeter reads `ResolvedSelectionDecision[]` as read-only; `BudgetReport` is a separate output, not a mutation of input |
| Budget-trim output semantics | PPG places budget-trimmed include-resolved components in `omittedComponents[]` with `action: omit` / `path: budget_trim` (Pass 4.9D-2Z); `budget_trim` is a plan-phase output partition path assigned by PPG, not a selector ladder path; selectors and Conflict Resolver must never emit `budget_trim`; schema support added by Pass 4.9D-2AB |
| Token accounting | `budgetPlan.selectedTokensApprox` = pre-trim selected total; `budgetPlan.projectedOverflow` = pre-trim overflow check; `TrimActionEntry.tokensDropped` = per-trim actual drop; `prompt-plan.estimatedTokens` = post-trim final total; `budgetOverflow` = post-trim status |
| Trim warning semantics | Successful trim of eligible optional component does not emit planning warning / risk flag / failOpenReason; trim is traceable only via `trimActions[]` |
| Harness dependency | Budget hint group (10 checks), `over_budget_protected` group (7 checks), `budgetHintSummary` survival group (7 checks) |

> **`BudgetReport.trimActionsPerformed[]` — naming drift resolved (Pass 4.9D-2W/2X):** Pass 4.9D-2W classified the issue as `SAME_CONCEPT_NAMING_DRIFT`: `BudgetReport.trimActionsPerformed[]` was an unused optional property in `schemas/internal/budget-report.schema.json` with a different entry shape (`componentId`, `action: "trimmed"`, `tokensReclaimed`) from the canonical trace-level `TrimActionEntry` (`componentId`, `budgetHint`, `tokensDropped`, `reason`). Pass 4.9D-2X resolved the drift by **removing `trimActionsPerformed[]` from `budget-report.schema.json`**. Canonical actual Budgeter-performed trim actions are recorded only at `trace.budgetPhase.trimActions[]` (`TrimActionEntry` shape, required, per `docs/04` §7.8). `budgetReport.trimOrder[]` remains the candidate / considered trim order (required). Existing accepted fixtures remain valid — `trimActionsPerformed[]` was absent from all 4 budget fixture traces. Non-empty `budgetPhase.trimActions[]` fixture coverage was subsequently added and verified by Pass 4.9D-2AC/2AC.1: `fixtures/14-budget-behavior/include-resolved-optional-actual-trim/` — verifies include-resolved optional component actual trim, `path: budget_trim` in final omitted output partitions, and no selector/resolved/conflict leakage.

---

## 5. Output File Schema Planning

### 5.1 `prompt-plan.json`

| Planning item | Detail |
|---|---|
| Canonical owner | `docs/04` §7.7; `docs/06` §3, §27 |
| Required top-level fields | `schemaVersion`, `promptFamily`, `selectedComponents[]`, `omittedComponents[]`, `deferredComponents[]`, `budgetPlan`, `estimatedTokens`, `riskFlags[]`, `failOpenReasons[]`, `planningWarnings[]` |
| Optional top-level fields | `budgetHintSummary` (PPG output only, computed after `BudgetReport` received; must not appear before Budgeter completes) |
| Component partitions | Three mutually exclusive lists: selected / omitted / deferred; exhaustive (every candidate must appear in exactly one) |
| Budget-trim partition path | Budgeter-trimmed include-resolved components appear in `omittedComponents[]` with `action: omit` / `path: budget_trim` (Pass 4.9D-2Z); `prompt-plan.schema.json` and `trace.schema.json` `omittedComponents[].path` now allow `budget_trim` (Pass 4.9D-2AB); shared `SelectionPath` enum remains selector/resolution-only and does not include `budget_trim`; selector/resolved/conflict schemas unchanged |
| `deferredComponents[]` | Each entry must carry `path` as `required: true` — harnesses filter on `path` to distinguish `runtime_unavailable` from `default_defer` |
| Cache advisory fields | `cacheStability`, `stablePrefixHash`, `recommendedCacheBoundary` etc. — **post-MVP; do not add to MVP schema** |
| Privacy rule | No raw component text, no raw history turn content |

**Cache-aware ordering invariants (schema implications):**

| Invariant | Schema consequence |
|---|---|
| Ordering is advisory only | No schema field may conditionally gate omission on cache classification |
| Cache hints are plan metadata, not prompt text | Advisory fields must be explicitly non-mandatory and must carry schema annotations indicating they must not appear in assembled prompt text |
| Ordering must not alter membership | The three partition lists are defined independently of any ordering field |
| No provider-specific cache APIs in core schema | Fields like `cacheControlHeaders`, `ttl`, `minBlockSize` are adapter work — must not enter core schema |

### 5.2 `trace.json`

| Planning item | Detail |
|---|---|
| Canonical owner | `docs/04` §7.8; `docs/06` §3.2 |
| Container shape | **Keyed phase object** — not a flat array (5-Q2 resolved) |
| Required top-level phase keys | `run`, `requestPhase`, `registryPhase`, `selectorPhase`, `conflictPhase`, `budgetPhase`, `planPhase`, `warnings` |

> **No `injectionGatePhase` top-level key.** The canonical `docs/04` §7.8 trace structure does not define a top-level `injectionGatePhase` key. Injection gate trace data is carried **inside existing phase keys** — see injection gate trace placement note below.

**Required phase key contents:**

| Phase key | Required contents |
|---|---|
| `run` | `runId`, `planningRunStartedAt`, `planningRunCompletedAt`, `promptFamily`, `schemaVersion` |
| `requestPhase` | `requestSignalsSummary`, `injectionSuspectFlag`, `promptFamily`, `familyConfidence` |
| `registryPhase` | `componentCount`, `quarantinedCount`, `validationWarnings[]`, `fatalErrors[]`, **`candidateSetSummary`** (emitted here before fan-out) |
| `selectorPhase` | `selectorTrace[]` (array of `TraceEntry` objects — see §4.4; each entry may carry injection gate per-decision fields when `injectionSuspect: true`), `planningWarnings[]`, `unresolvedConflicts[]`, `selectorSummary` |
| `conflictPhase` | `resolvedDecisions[]`, `conflictResolutionTrace[]`, `noConflictComponentIds[]`, `planningWarnings[]` |
| `budgetPhase` | `budgetReport`, `trimActions[]`, `budgetOverflow` |
| `planPhase` | `selectedComponents[]`, `omittedComponents[]`, `deferredComponents[]`, `riskFlags[]`, `failOpenReasons[]` |
| `warnings` | Global planning warnings from any phase — including `injection_suspect_warn_and_continue`, `injection_suspect_fail_open_all`, `policy_value_not_implemented`, `family_confidence_fail_open_escalation` (emitted exactly once by orchestrator when `injectionSuspect: true`) |

**Injection gate trace placement (canonical: `docs/06` §17.6):**

The injection gate does not have a dedicated top-level trace phase. Its trace data is distributed across:

| Data type | Canonical trace location |
|---|---|
| Per-decision gate fields (`injectionSuspect`, `injectionSuspectAction`, `actionChanged`, `originalCandidateAction`, `originalCandidatePath`, `warningsEmitted`) | Inside each `TraceEntry` object in `selectorPhase.selectorTrace[]` when `injectionSuspect: true` |
| Global per-run injection warning (`injection_suspect_warn_and_continue` or `injection_suspect_fail_open_all`) | `warnings[]` (top-level global; emitted exactly once by orchestrator; **not** in per-decision `warningsEmitted`) |
| Policy fallback fields (`requestedInjectionSuspectAction`, `effectiveInjectionSuspectAction`, `policyFallbackReasons[]`) | Global planning trace entry (once per run, when effective policy differs from requested or when familyConfidence escalation occurred) |
| Gate-conversion context in conflict trace (`hadGateConvertedDecisions`, `gateConvertedTraceRefs`, `preGateActions`, `preGatePaths`) | `conflictPhase.conflictResolutionTrace[]` entries (optional fields — present only when gate conversion was detected) |

**Schema decisions:**

- All 8 required phase keys must be `required: true` in the `trace.json` schema. Do not add `injectionGatePhase` as a 9th required key.
- `selectorPhase.selectorTrace` must be typed as `array of TraceEntry`, not `array of SelectionDecision`.
- `registryPhase` must include `candidateSetSummary` as a required embedded object.
- `conflictPhase` must include `noConflictComponentIds` as a separate `string[]` field alongside `conflictResolutionTrace[]` — not embedded inside `conflictSummary`.
- No raw component text or raw history turn content may appear in any phase.
- Separate `selector-trace.json` file: not in MVP schema (future extension only).

**Accounting invariant the schema must support:**
`noConflictComponentIds.length + conflictResolutionTrace.length = candidateSetSummary.candidateSetSize`

### 5.3 `summary.md` Boundary Rules

`summary.md` is a Markdown text output, not a JSON file. It does not have a JSON Schema. Instead, schema planning must define **boundary rules** the harness can assert:

| Boundary rule | Harness assertion |
|---|---|
| Narrative is generated from `selectorSummary.narrative` deterministic template only | Assert narrative matches template output for given counts |
| No raw component text in `summary.md` | Assert absence of known component IDs followed by content text |
| No raw history turn content in `summary.md` | Assert absence of raw turn fields |
| Budget summary included | Assert presence of budget figures from `BudgetReport` |
| Risk flags included | Assert each `riskFlags[]` entry from `prompt-plan.json` appears in `summary.md` |
| Model-generated narrative prohibited in MVP | Assert narrative matches deterministic template exactly; any deviation is a harness failure |

> **`expected/summary.md` output boundary — minimal shape now defined (Pass 4.9D-2AG).** Current fixtures test `trace.selectorPhase.selectorSummary.narrative` (a JSON string field) — they do not test the actual `summary.md` Markdown file output. No `expected/summary.md` file has been created or approved. The standard fixture layout remains **11 files** (8 input JSON + 2 expected JSON + 1 assertions.md). The minimal expected Markdown shape is now defined in §5.3.1 below. Future `expected/summary.md` fixture contract is in §5.3.2. Harness comparison rules are in §5.3.3. Do not create `expected/summary.md` in any fixture pass until an explicit future fixture-creation pass names the target fixture(s) and updates counts.

#### 5.3.1 Minimal Expected Markdown Shape

`summary.md` is a deterministic Markdown output file. It is not JSON and has no JSON Schema. It must be validated by harness boundary rules, not by JSON Schema validation. In MVP, it must not contain model-generated narrative.

**Required headings (in order):**

| # | Heading | Source field(s) | Required content | Forbidden content |
|---|---|---|---|---|
| 1 | `# Planning Summary` | `trace.run` (run metadata only) | Top-level title. May include safe run metadata (run ID, schema version) if present in `trace.run`. | Raw user request text; raw component content; provider/model output. |
| 2 | `## Selector Summary` | `trace.selectorPhase.selectorSummary.narrative`; `selectorSummary` count fields | Exact deterministic narrative string from `selectorSummary.narrative` per `docs/06` §3.6 template. No paraphrasing, no model-generated replacement. | Model-generated prose; raw component text; deviation from template. |
| 3 | `## Conflict Summary` | `trace.conflictPhase.conflictResolutionTrace[]`; `trace.conflictPhase.noConflictComponentIds[]` | Deterministic statement derived from conflict phase counts: number of conflicts resolved, number of no-conflict components. May reference component IDs. If no conflicts: `"0 conflicts identified. All N components resolved without conflict."` or equivalent deterministic statement. | Invented conflict explanations; raw component text; model-generated prose. |
| 4 | `## Budget Summary` | `trace.budgetPhase` (`budgetReport`, `budgetOverflow`, `trimActions[]`); `prompt-plan.budgetPlan`; `prompt-plan.estimatedTokens` | Target budget (if present); `selectedTokensApprox` (pre-trim selected total); `projectedOverflow` (pre-trim check); `estimatedTokens.total` (post-trim final total); `budgetOverflow` true/false; count of trim actions; if trim actions present, list component IDs and `tokensDropped` only. | Raw component text; provider/model output; invented budget explanations. |
| 5 | `## Output Partitions` | `prompt-plan.selectedComponents[]`; `prompt-plan.omittedComponents[]`; `prompt-plan.deferredComponents[]` | Counts for selected / omitted / deferred. May list component IDs, `action`, and `path`. Must preserve partition exclusivity semantics. | Raw component text; listing unknown references as normal partitions. |
| 6 | `## Warnings and Risk Flags` | `prompt-plan.planningWarnings[]`; `prompt-plan.riskFlags[]`; `prompt-plan.failOpenReasons[]`; `trace.warnings[]` | Warning codes; risk flag IDs/codes; fail-open reasons if present. | Invented prose explanations; raw user text; raw component content; provider/model output. |
| 7 | `## Privacy and Content Boundary` | — (fixed deterministic statement) | Fixed statement: raw component content, raw history turn content, raw user request text, secrets, credentials, API keys, and provider responses are intentionally excluded from this summary. | Any content that contradicts the privacy statement. |

**Optional heading:**

| # | Heading | Constraints |
|---|---|---|
| 8 | `## Notes` | Must be deterministic. Must not contain model-generated narrative or raw content. May include fixed statements such as: `"No model-generated narrative is used in MVP summary output."` or `"All component references are by componentId only."` |

**Budget section accepted semantics (must be respected):**

- `budgetPlan.selectedTokensApprox` = pre-trim selected total.
- `budgetPlan.projectedOverflow` = pre-trim overflow check.
- `prompt-plan.estimatedTokens.total` = post-trim final total.
- `trimActions[]` records actual Budgeter-performed trims only (not selector-omitted components).
- `budget_trim` appears only as final output partition path, not as selector/resolved path.

**Privacy / content exclusion rules:**

| Category | Rule |
|---|---|
| Raw component content | Forbidden — must not appear in `summary.md` |
| Raw history turn content | Forbidden |
| Raw user request text | Forbidden |
| Provider/model responses | Forbidden |
| Secrets / credentials / API keys | Forbidden |
| Component IDs (`componentId` strings) | Allowed — identifier references only |
| Source file paths / component source refs | Allowed only if already present in safe plan/trace fields |
| Hash / source refs | Allowed if already present in plan/trace |
| Prompt text dump | Forbidden |

#### 5.3.2 Future `expected/summary.md` Fixture Contract

- Current accepted fixture layout remains **11 files** per case: 8 input JSON + 2 expected JSON (`expected/prompt-plan.json`, `expected/trace.json`) + 1 `assertions.md`.
- No existing fixture is changed by this boundary definition pass.
- No `expected/summary.md` file is created by this pass.
- A future fixture that validates actual `summary.md` output may add `expected/summary.md` as a 12th file.
- Such a fixture would become a **12-file fixture case** unless a later fixture-contract decision chooses a separate summary-output fixture group.
- Before creating any 12-file fixture, a future explicit pass must:
  - Name the target fixture case(s).
  - State that the fixture intentionally extends the standard 11-file layout.
  - Update `docs/12` fixture counts accordingly (total files, expected file count).
  - Define harness behavior for comparing Markdown output vs. `expected/summary.md`.
- Existing 11-file fixtures remain valid and accepted. Their file counts are not changed.
- `fixtures/18-summary-narrative/deterministic-narrative-template/` remains a JSON-field narrative fixture only; it validates `trace.selectorPhase.selectorSummary.narrative` (a JSON string), not the actual `summary.md` file.

#### 5.3.3 Harness Comparison Rules for `summary.md`

| Rule | Detail |
|---|---|
| Required headings | Harness must verify all 7 required headings are present in the correct order. Missing required heading = harness failure. |
| Deterministic narrative | Harness must compare `## Selector Summary` narrative content against the value derived from `selectorSummary.narrative` template (`docs/06` §3.6). Mismatch = harness failure. |
| Source-derived fields | Harness must verify required source-derived fields are present in each section (budget figures, partition counts, warning codes, risk flag IDs). Missing required field = harness failure. |
| Forbidden raw content | Harness must verify no raw component text, raw history text, raw user request text, secrets, credentials, API keys, or provider/model output appears. Presence = harness failure. |
| Whitespace tolerance | Harness should not require byte-for-byte whitespace equality unless a future pass makes that explicit. Harness may normalize line endings and trim trailing spaces. |
| Model prose check | Harness should not need to parse freeform model prose because MVP summary has no model prose. Any non-template text in the narrative section = harness failure. |
| Warning/risk/budget validation | If the fixture defines expected warnings, risk flags, or budget fields, harness must verify they appear in the corresponding summary section. Missing expected field = harness failure. |
| Provider/model output check | Harness must verify no provider-specific or model-generated content appears anywhere in `summary.md`. Presence = harness failure. |

---

## 6. Enum and Warning-Code Schema Plan

### 6.1 Enum Summary

All enum values below are canonical. Do not add new values without an explicit cross-spec decision pass. Unrecognized values are harness failures unless otherwise noted.

**`SelectionDecision.action` (4 values — `docs/06` §4)**

| Value | Meaning |
|---|---|
| `include` | Component must appear in plan |
| `omit` | Component excluded from plan (requires positive Path A or B evidence) |
| `defer` | Component not included now; not an omission; not counted as budget savings |
| `reference_unknown` | Component ID not found in registry |

> `action: quarantine` and `action: unavailable` are **not valid MVP values** — see §9.

**`SelectionDecision.path` (12 values — `docs/06` §4)**

| Value | Valid with action |
|---|---|
| `required_match` | `include` |
| `safe_to_omit_match` | `omit` (Path A only) |
| `default_action_omit` | `omit` (Path B only) |
| `default_include` | `include` |
| `default_defer` | `defer` |
| `fail_open` | `include` |
| `conflict_include` | `include` |
| `safety_override` | `include` — always; never `omit` |
| `runtime_unavailable` | `defer` only — never `omit` |
| `not_evaluated` | `include` (synthetic fail-open) |
| `reference_unknown` | `reference_unknown` action |
| `quarantine_boundary_violation` | `include` only — never `omit` |

**`confidence` (3 values — `docs/06` §4)**

`high` | `medium` | `low` — string enum; no float on `SelectionDecision` (F-08 resolved).

**Component `type` (8 values — `docs/05`)**

`scaffold` | `skill` | `tool` | `history` | `memory` | `policy` | `output_format` | `runtime_capability`

**`riskLevel` (4 values — `docs/05`)**

`critical` | `high` | `medium` | `low`

**`omissionPolicy` (3 values — `docs/05`)**

`allow` | `fail_open` | `never`

> `allow` — omission permitted if selector evidence supports it (Path A eligible). `fail_open` — include when evidence is insufficient; not trimmable in MVP. `never` — always include regardless of selector output; sets hard protection.

**`retainPolicy` (4 values — `docs/05`)**

`mandatory` | `safety_critical` | `durable` | `optional`

**`defaultAction` (3 values — `docs/05`)**

`include` | `omit` | `defer`

**`budgetHint` (5 values — `docs/06` §20/§27)**

| Value | Budgeter behavior |
|---|---|
| `protected` | Must not trim |
| `over_budget_protected` | Must not trim; emits planning warning |
| `candidate_optional` | May trim |
| `expensive_optional` | Prefer to trim first at equal priority (≥ 500 tokens threshold) |
| `unknown_cost` | Uses conservative default; emits `budget_cost_unknown` |

**`resolutionRule` (14 values — `docs/06` §11.3.1a — strict enum)**

| Value | Priority | When used |
|---|---|---|
| `no_conflict` | — | Single unambiguous decision; no-conflict components only |
| `runtime_unavailable_defer` | 0 | Confirmed-unavailable `type: tool` |
| `safety_hard_protection` | 1 | `safety_critical` / `omissionPolicy: never` / `riskLevel: critical` |
| `user_constraint_include` | 2 | `alwaysInclude` wins |
| `registry_require_include` | 3 | `retainPolicy: mandatory` or `requiredWhen` match |
| `history_durability_include` | 4 | `durable_constraints` or `open_commitments` lane |
| `path_a_omit_uncontested` | 5 | All inputs valid Path A omits |
| `path_b_omit_uncontested` | 5 | All inputs valid Path B omits |
| `path_a_omit_selected_over_path_b` | 5 | Path A vs Path B omit conflict |
| `multiple_include_merged` | 5 | Multiple include decisions merged |
| `fail_open_unresolved` | — | Priority order could not cleanly resolve |
| `quarantine_boundary_violation_pass_through` | — | Quarantine boundary violation synthetic decision |
| `reference_unknown_pass_through` | — | Unknown reference passed through |
| `history_malformed_fail_open` | — | Case 12: history-malformed fail-open include beats omit |

> Any value not in this table is a critical harness failure. Future additions require an explicit cross-spec decision pass.

**`injectionSuspectAction` (raw input boundary vs effective policy — `docs/06` §2.9)**

| Value | Input schema | Effective policy | Notes |
|---|---|---|---|
| `warn_and_continue` | Accept | Apply directly | Default |
| `fail_open_all` | Accept | Apply directly | Path A/B globally suppressed |
| `halt_planning` | **Accept** (do not reject) | `warn_and_continue` | Emits `policy_value_not_implemented`; preserved in fallback trace |
| Any other | **Accept at raw input schema boundary** (open string, no enum enforced) | `warn_and_continue` | Orchestrator emits `injection_action_unknown` |

### 6.2 Warning-Code Schema Strategy

Warning codes must be machine-readable string constants — no free-form prose. Schema planning distinguishes four warning scopes:

| Scope | Location in trace | Deduplication |
|---|---|---|
| Global per-run planning warnings | `trace.json.warnings[]` and `selectorPhase.planningWarnings[]` | Some codes must appear at most once per run (see critical codes) |
| Per-decision selector warnings | `SelectionDecision.warnings[]` and `TraceEntry.warningsEmitted` | Per-decision; no deduplication required |
| Conflict resolution warnings | `conflictResolutionTrace[].warningsEmitted` | Per-conflict entry |
| Budget warnings | `SelectionDecision.budgetWarningCodes[]` | Per-decision |

**Critical required warning codes (schema must define these as valid):**

| Code | Scope | Deduplication rule |
|---|---|---|
| `injection_suspect_warn_and_continue` | Global | Exactly once per run — orchestrator-owned |
| `injection_suspect_fail_open_all` | Global | Exactly once per run — orchestrator-owned |
| `policy_value_not_implemented` | Global | Once per run (for `halt_planning` fallback) |
| `injection_action_unknown` | Global | Once per run (for typo values) |
| `family_confidence_fail_open_escalation` | Global | Once per run |
| `history_malformed_conflict_occurred` | Global | Exactly once per run (12-Q4 resolved) |
| `runtime_capabilities_missing` | Global | Once per run |
| `selector_policy_defaulted` | Global | Once per run |
| `injection_suspect_policy_override` | Per-decision | No deduplication |
| `injection_suspect_omit_allowed` | Per-decision | No deduplication |
| `injection_suspect_seen` | Trace atom (evidence) | Not a warning code — evidence atom |
| `history_malformed_conflict` | Per-conflict | No deduplication |
| `budget_cost_unknown` | Per-decision (budget) | No deduplication |
| `over_budget_protected` | Per-decision (budget) | No deduplication |
| `budget_pressure_seen` | Per-decision (budget) | No deduplication |
| `runtime_capability_unavailable` | Per-decision | No deduplication |
| `active_id_unknown` | Global or per-ID | One per unknown ID, not one total |
| `lane_missing` | Per-decision (history) | No deduplication |

> **Schema rule:** Warning codes must be typed as `string` with an advisory enum listing known codes. Do not use a closed strict enum for warning codes — the list grows across passes. Harness checks must compare against exact string literals, not against a schema-enforced closed enum, to allow forward compatibility.

> **`injection_suspect_seen` is an evidence/trace atom, not a warning code.** It must not appear in `planningWarnings` or `warningsEmitted`. It belongs in `evidence[]` or `traceEntry` signal atoms only.

---

## 7. Evaluation Harness Fixture Plan

This section plans fixture *groups* — logical test scenarios. No actual fixture files or test code are created in this pass. Each group maps to one or more planned fixture JSON files in a later pass (Pass 4.9D-1).

### 7.1 Class A / B Input Strictness

| Goal | Verify Class A inputs halt planning on absence; Class B inputs apply defaults |
|---|---|
| Schema dependency | `requestSignals` required; `registryIndexes` required; `selectorPolicy` optional |
| Expected output | Class A absent → non-zero exit with `schema_invalid` error; Class B absent → `planningWarnings` contains appropriate default-applied code |
| Failure mode caught | Silent continuation on missing mandatory input; silent omission of Class B default warning |

> **Seed fixture created and verified CLEAN_WITH_NOTES (Pass 4.9D-2L/2L.1):**
> - `fixtures/05-selector-policy/deterministic-only-false-defaulted/` — present `selector-policy.json` with `deterministicOnly: false` is normalized to deterministic-only MVP behavior; emits `selector_policy_defaulted` in `selectorPhase.planningWarnings[]` and global `warnings[]`; prompt-plan output is unaffected beyond the normalization. **Note:** this is a present-file normalization/defaulting fixture, not a missing-file fixture. Missing optional input file behavior (absent `selector-policy.json`) remains uncovered — the missing-file path requires either a 7-input layout or an orchestrator-level absent-file contract decision before a fixture can be created.

> **Missing-file selector-policy fixture contract — decision deferred (Pass 4.9D-2U):** The standard fixture layout uses **8 input JSON files**. An absent optional Class B input (e.g., absent `selector-policy.json`) cannot be represented by a present placeholder file — a placeholder would change the semantics (present-but-empty vs. absent). Missing optional input file behavior requires one of the following before a fixture can be created: (a) a nonstandard **7-input fixture layout** with a documented fixture-contract extension in this section; (b) a **harness loader / CLI-level simulation** of an absent file (not yet designed); or (c) an **explicit fixture contract extension** in `docs/12` that defines how absent Class B inputs are represented in the fixture tree. Until that contract decision is made and accepted here, missing-file Class B behavior remains uncovered and must not be approximated by a present placeholder file.

### 7.2 Registry Validation and Quarantine

| Goal | Verify quarantined components are excluded from `componentsById` before selector fan-out |
|---|---|
| Schema dependency | `registryPhase.quarantinedCount` required; `quarantinedComponents[]` separate from `componentsById` |
| Expected output | `registryPhase.quarantinedCount = fixture_quarantined.length`; no quarantined ID appears in any `SelectionDecision.componentId` via normal selector path |
| Failure mode caught | Quarantined component reaching selector; `quarantine_boundary_violation` path not fired when quarantine guarantee breaks |

> **Seed fixture created and verified CLEAN_WITH_NOTES (Pass 4.9D-2L/2L.1):**
> - `fixtures/02-registry-validation/quarantine-excluded-from-candidates/` — schema-valid but loader-invalid low-risk component (`skill.malformed-zero-tokens`) quarantined before selector fan-out. `tokensApprox: 0` and `charsApprox: 0` without `metadataOnly: true` passes JSON Schema boundary (minimum: 0) but violates the loader cross-field rule (tokensApprox >= 1 unless metadataOnly: true). `registryPhase.quarantinedCount == 1`; `candidateSetSize == 1`. Quarantined component is absent from `selectorTrace[]`, `resolvedDecisions[]`, `noConflictComponentIds[]`, and all output partition arrays. No `quarantine_boundary_violation` expected in correct operation. **Warning-code note:** `registryPhase.validationWarnings[]` uses `schema_invalid` (schema-permissible via open advisory enum); `component_quarantined` (docs/05 §11 trace entry code) has not been added to the PlanningWarning advisory list — quarantine warning-code reconciliation is a later spec clarification item, not a fixture blocker.

### 7.3 `candidateSetSummary` / Gap-Check

| Goal | Verify `candidateSetSize` is correct denominator; accounting invariant holds |
|---|---|
| Schema dependency | `registryPhase.candidateSetSummary.candidateSetSize` required integer |
| Expected output | `noConflictComponentIds.length + conflictResolutionTrace.length = candidateSetSummary.candidateSetSize` |
| Failure mode caught | Silent component escape from accounting; denominator mismatch; `candidateSetSize` absent or wrong |

> **Seed fixture created and verified (Pass 4.9D-2C/2C.1):**
> - `fixtures/03-candidate-set-summary/gap-check-accounting/` — 3-component registry, all no-conflict; `candidateSetSize=3`; `noConflictComponentIds.length=3`; `conflictResolutionTrace.length=0`; 3+0=3 invariant confirmed

### 7.4 Active IDs / `active_id_unknown`

| Goal | Verify unknown active IDs emit `active_id_unknown` per unknown ID; do not produce `reference_unknown` decisions |
|---|---|
| Schema dependency | `activeSkillIds`, `activeToolIds`, `activeMemoryIds` arrays; `planningWarnings[].code` |
| Expected output | Each unknown ID → one `active_id_unknown` warning in `planningWarnings`; no `SelectionDecision` with `action: reference_unknown` for these IDs |
| Failure mode caught | Confusion between `active_id_unknown` and `reference_unknown` warning classes |

> **Seed fixture created and verified (Pass 4.9D-2C/2C.1):**
> - `fixtures/04-active-ids/active-id-unknown-not-reference-unknown/` — unknown active skill ID emits `active_id_unknown` in `selectorPhase.planningWarnings` only; absent from `selectorTrace`, `resolvedDecisions`, and all output partition arrays; `unknownReferences=0` in `selectorSummary`; no `reference_unknown` action/path produced

### 7.5 Selector Ladder

| Goal | Verify the 8-step deterministic ladder produces correct `action` / `path` per fixture input |
|---|---|
| Schema dependency | `SelectionDecision.action`, `path`, `evidence[]`, `confidence` all required |
| Expected output | Each ladder step produces the expected `action`/`path` combination; `evidence[]` non-empty for `omit` decisions |
| Failure mode caught | Wrong path for given input; `omit` with empty evidence; `low`-confidence omit |

> **Seed fixture created and verified CLEAN (Pass 4.9D-2O/2O.1):**
> - `fixtures/05-selector-ladder/required-when-match/` — `requiredWhen` tag matching the request `promptFamily` (ladder Step 5) produces `action: include`, `path: required_match`. Target component (`skill.coding-guide`) is not hard-protected (`riskLevel: low`, `omissionPolicy: allow`, `retainPolicy: optional`) and is not included via user constraint (`userConstraints.alwaysInclude: []`). No `conflictResolutionTrace[]` entry is needed when no conflict exists — target appears in `noConflictComponentIds[]` only. Target appears in `trace.planPhase.selectedComponents[]` and `prompt-plan.selectedComponents[]` with `path: required_match`; absent from omitted/deferred partitions. Gap-check uses `candidateSetSize` as denominator: `noConflictComponentIds.length(2) + conflictResolutionTrace.length(0) = candidateSetSize(2)`.

### 7.6 Step 3 Hard Protection

| Goal | Verify safety/policy/history-durable components always resolve to `include` / `safety_override` |
|---|---|
| Schema dependency | `path: safety_override` required; `action: include` required for all Step 3 components |
| Expected output | Every `retainPolicy: safety_critical`, `omissionPolicy: never`, `riskLevel: critical` component has `action: include`, `path: safety_override` |
| Failure mode caught | Hard-protected component omitted; `safety_override` path on non-include action |

> **Seed fixture created and verified (Pass 4.9D-2E/2E.1/2E.2/2E.3):**
> - `fixtures/06-hard-protection/safety-override-include/` — hard-protected component (`riskLevel: critical`, `omissionPolicy: never`, `retainPolicy: safety_critical`) always resolves to `action: include`, `path: safety_override`; never appears in `omittedComponents[]` or `deferredComponents[]` regardless of any selector omit preference

### 7.7 Path A Omission

| Goal | Verify Path A gate passes only when `safeToOmitWhen` matched AND `evidenceRequired` satisfied AND all Path A gates passed |
|---|---|
| Schema dependency | `path: safe_to_omit_match` only valid with `action: omit`; `evidence[]` non-empty |
| Expected output | Path A omit present exactly when all gate conditions met; `evidence[]` contains matched signal atoms |
| Failure mode caught | Path A omit without evidence; malformed `evidenceRequired` still producing omit |

> **Seed fixture created and verified (Pass 4.9D-2E/2E.1/2E.2/2E.3):**
> - `fixtures/07-path-a-omission/safe-to-omit-positive-evidence/` — `safeToOmitWhen` matches `promptFamily`; `evidence[]` non-empty; component appears in `omittedComponents[]` with `action: omit`, `path: safe_to_omit_match`; absent from `selectedComponents[]`

### 7.8 Path B Omission

| Goal | Verify Path B fires only when no tag matched and `defaultAction: omit` |
|---|---|
| Schema dependency | `path: default_action_omit` only valid with `action: omit` |
| Expected output | Path B omit present only when `defaultAction: omit` and no requiredWhen/safeToOmitWhen matched |
| Failure mode caught | Path B omit on a component with matched tags |

> **Seed fixture created and verified (Pass 4.9D-2E/2E.1/2E.2/2E.3):**
> - `fixtures/08-path-b-omission/default-action-omit/` — `defaultAction: omit`; no `requiredWhen` match; no `safeToOmitWhen` match; component appears in `omittedComponents[]` with `action: omit`, `path: default_action_omit`; co-existing hard-protected scaffold remains in `selectedComponents[]` with `path: safety_override`

### 7.9 `reference_unknown`

| Goal | Verify unknown component IDs produce `action: reference_unknown`; not silently ignored; excluded from output partition arrays |
|---|---|
| Schema dependency | `action: reference_unknown`, `path: reference_unknown` both required values; `selectorSummary.unknownReferences` counter |
| Expected output | Unknown ID → one `reference_unknown` selectorTrace entry + one `reference_unknown_pass_through` resolved decision; `unknownReferences: 1`; ID in `riskFlags[]`; absent from `selectedComponents[]`, `omittedComponents[]`, `deferredComponents[]` |
| Failure mode caught | Unknown reference silently dropped; `componentId` confused with validated registry ID; `reference_unknown` in output partition array |
| Canonical input path | `userConstraints.alwaysInclude` (or explicit caller flag) — per `docs/06` §8 Step 2 and `user-constraints.schema.json` |
| Distinction from active IDs | Unknown `activeSkillIds`/`activeToolIds`/`activeMemoryIds` produce `active_id_unknown` warning only (`unknownReferences: 0`); true `reference_unknown` requires a selector/caller reference — see §7.4 and `fixtures/04-active-ids/active-id-unknown-not-reference-unknown/` |

> **Seed fixture created, repaired, and verified (Pass 4.9D-2E/2E.1/2E.2/2E.3):**
> - `fixtures/09-reference-unknown/unknown-component-reference/` — unknown component ID introduced via `userConstraints.alwaysInclude` (canonical `reference_unknown` path per `docs/06` §8 Step 2); `selectorTrace[]` carries a `reference_unknown` TraceEntry; `resolvedDecisions[]` carries a `reference_unknown_pass_through` entry; `unknownReferences: 1` in `selectorSummary`; unknown ID absent from all output partition arrays; `riskFlags[]` identifies the unknown reference; no `active_id_unknown` warning produced. **Note:** original Case 4 design used `activeSkillIds` incorrectly; redesigned in Pass 4.9D-2E.2 to use `userConstraints.alwaysInclude`. Unknown `activeSkillIds` remain covered separately by `fixtures/04-active-ids/active-id-unknown-not-reference-unknown/` (`unknownReferences: 0`).

### 7.10 `runtime_unavailable`

| Goal | Verify confirmed-unavailable tools are deferred (not omitted); `path: runtime_unavailable` set; no budget savings claimed |
|---|---|
| Schema dependency | `path: runtime_unavailable` required on `deferredComponents[]` entries; `budgetOverflow` unaffected by unavailable tool tokens |
| Expected output | Unavailable tool in `deferredComponents[]` with `path: runtime_unavailable`; no token savings claimed |
| Failure mode caught | Unavailable tool in `selectedComponents[]`; `runtime_unavailable` defer counted as savings; filtering by `action: defer` alone insufficient |

> **Seed fixture created and verified (Pass 4.9D-2C/2C.1):**
> - `fixtures/10-runtime-unavailable/tool-defer-not-savings/` — `tool.write-file` in `unavailableToolIds`, `capabilityInventoryComplete: true`; tool deferred as `path: runtime_unavailable`; `trimActions=[]`; `selectedTokensApprox` excludes deferred tool tokens; `estimatedSavings.tokens=0` on deferred selectorTrace entry

### 7.11 `capabilityInventoryComplete`

| Goal | Verify `capabilityInventoryComplete: false` triggers fail-open (include all tool components) |
|---|---|
| Schema dependency | `capabilityInventoryComplete: boolean` required |
| Expected output | When `false` → all tool components included; `runtime_capabilities_missing` or equivalent warning in `planningWarnings` |
| Failure mode caught | Tool silently omitted when capability inventory incomplete |

> **Seed fixture created and verified (Pass 4.9D-2C/2C.1):**
> - `fixtures/11-capability-inventory-incomplete/fail-open-tools/` — `capabilityInventoryComplete: false`, both tool lists empty; both tools included via `path: fail_open`; `failOpenInclude=2`; `runtime_capabilities_missing` warning in `selectorPhase.planningWarnings` and global `warnings[]`; no `runtime_unavailable` defer produced

### 7.12 Injection Gate (17 checks)

| Goal | Verify all 17 zero-tolerance injection gate harness checks from `docs/06` §17.7 |
|---|---|
| Schema dependency | `injectionSuspect` boolean; `injectionSuspectAction` enum; `actionChanged`; `originalCandidateAction`; `policyFallbackReasons[]`; global `warnings[]` |
| Sub-fixtures | `warn_and_continue` baseline; `fail_open_all`; `halt_planning` fallback (→ `warn_and_continue` + `policy_value_not_implemented`); unknown policy value; `familyConfidence` escalation; safety/policy omit override; duplicate global warning violation |
| Failure mode caught | `halt_planning` halting run; `halt_planning` treated as unknown; raw user text in trace; selector-side pattern matching; `fail_open_all` producing omit |

> **Seed fixtures created and verified (Pass 4.9D-2A/4.9D-2A.1); `resolvedAt` repaired Pass 4.9D-2C.2:**
> - `fixtures/12-injection-gate/unknown-policy-value/` — unknown `injectionSuspectAction` string accepted at boundary; orchestrator emits `injection_action_unknown`; effective policy `warn_and_continue`
> - `fixtures/12-injection-gate/halt-planning-recognized/` — `halt_planning` recognized reserved (not typo); orchestrator emits `policy_value_not_implemented` (not `injection_action_unknown`); effective policy `warn_and_continue`
>
> **Additional seed fixture created and verified CLEAN_WITH_NOTES (Pass 4.9D-2L/2L.1):**
> - `fixtures/12-injection-gate/fail-open-all/` — `injectionSuspect: true` + `injectionSuspectAction: "fail_open_all"`; Path B omit outcome for `skill.optional-helper` (defaultAction: omit) converted to `action: include`, `path: fail_open` by injection gate. Converted `selectorTrace` entry preserves `originalCandidateAction: "omit"` and `originalCandidatePath: "default_action_omit"`. Exactly one global `injection_suspect_fail_open_all` warning is expected — emitted once per run, not per component. Hard-protected scaffold unaffected (`actionChanged: false`). `familyConfidence: 0.92 >= failOpenThreshold: 0.7` — family-confidence escalation is not part of this fixture. `hadGateConvertedDecisions: true` on the skill's `conflictPhase.resolvedDecisions` entry.

> **Eighth-batch fixtures created and verified CLEAN_WITH_DEFERRED_SUBCASE (Pass 4.9D-2R/2R.1):**
> - `fixtures/12-injection-gate/warn-and-continue-baseline/` — `injectionSuspect: true` + requested/effective `warn_and_continue`. `familyConfidence: 0.85 >= failOpenThreshold: 0.7` — family-confidence escalation does not trigger. Exactly one global `injection_suspect_warn_and_continue` warning expected (emitted once per run by orchestrator). Ordinary low-risk Path B omit (`defaultAction: omit`) remains omitted — `warn_and_continue` does not globally suppress all omissions. Omit trace entry: `actionChanged: false`, `injectionSuspect: true`, `injectionSuspectAction: "warn_and_continue"`, `injection_suspect_omit_allowed` in per-decision `warningsEmitted`. No `injection_suspect_fail_open_all`, no `family_confidence_fail_open_escalation`, no `policy_value_not_implemented`, no `injection_action_unknown`.
> - `fixtures/12-injection-gate/family-confidence-escalation/` — requested policy `warn_and_continue`; `familyConfidence: 0.4 < failOpenThreshold: 0.7` with `injectionSuspect: true` — effective policy escalates to `fail_open_all`. `policyFallbackReasons[]` includes `"family_confidence_fail_open_escalation"`. Global warnings: `family_confidence_fail_open_escalation` (index 0) then `injection_suspect_fail_open_all` (index 1) — canonical order per `docs/06` §17.6. Path B omit candidate converts to `include / fail_open`; converted trace entry preserves `originalCandidateAction: "omit"` and `originalCandidatePath: "default_action_omit"`; per-decision `injectionSuspectAction: "fail_open_all"` (effective policy, not requested). This is not unknown policy fallback and not `halt_planning`. No `injection_suspect_warn_and_continue` under effective `fail_open_all`.
>
> **Deferred sub-case — `WARN_AND_CONTINUE_OVERRIDE_DESIGN_DEFERRED` (repaired Pass 4.9D-2U.R1.1):** The `injection_suspect_policy_override` sub-case remains not covered. Three-branch reachability analysis per `docs/06` §17.3.1 (Pass 4.9D-2U.R1/R1.1):
> - **Branch A (Step 3 hard-protection — structurally unreachable as pre-gate omit):** Trigger markers that are Step 3 hard-protection conditions (`riskLevel: critical`, `retainPolicy: safety_critical`, `retainPolicy: mandatory`, `omissionPolicy: never`) are included at Step 3 before the injection gate — these components cannot arrive at the gate as `action: omit`. No injection-gate upgrade is needed or possible.
> - **Branch B (omit-gate blocked — also unreachable as omit):** `riskLevel: high` is not a Step 3 condition but is excluded from both Path A (Step 7 condition 5) and Path B (Step 8 condition 6), which require `riskLevel: low` or `medium`. A high-risk component without Step 3–6 include conditions falls to Step 11 fail-open (`action: include`, `path: fail_open`) — not `action: omit`. Upgrade is also moot.
> - **Branch C (unresolved — genuinely deferred; no current mandatory upgrade behavior):** `type: policy` alone with low/medium risk and valid omit gate conditions; history-durable/open-commitment components not already covered by hard-protection metadata. Whether these can simultaneously satisfy the override trigger and a valid Path A/B omit condition is not definitively settled. **No upgrade may be asserted and no allow may be asserted for Branch C cases today.** No fixture may be created until a future clarification pass explicitly resolves one of: (1) narrow the override so ordinary low/medium policy omits are allowed; (2) define Branch C as protected and require `include / fail_open`; or (3) define explicit registry metadata / signal atoms that make the trigger reachable.
> `injection_suspect_policy_override` remains in the advisory enum as a reserved code. Existing `warn-and-continue-baseline`, `family-confidence-escalation`, and `fail-open-all` fixtures are not affected.


### 7.13 Conflict Resolution (16 checks)

| Goal | Verify all 16 zero-tolerance conflict resolution harness checks from `docs/06` §11.7 |
|---|---|
| Schema dependency | `resolutionRule` strict 14-value enum; `conflictResolutionTrace[]`; `noConflictComponentIds[]`; accounting invariant |
| Sub-fixtures | Include vs omit; omit vs omit (Path A vs B); multiple includes merged; `runtime_unavailable` beats `alwaysInclude`; safety beats `neverInclude`; `history_malformed_fail_open`; unrecognized `resolutionRule`; gate-conversion context |
| Failure mode caught | Conflict resolved by selector order; unrecognized `resolutionRule`; no-conflict component missing from `noConflictComponentIds`; gate-conversion context missing |

> **Seed fixtures created and verified (Pass 4.9D-2G/2G.1):**
> - `fixtures/13-conflict-resolution/safety-beats-omit/` — hard-protected include (`riskLevel: critical`, `omissionPolicy: never`, `retainPolicy: safety_critical`) beats omit decision; `conflictResolutionTrace[]` contains actual conflict entry; `resolutionRule: "safety_hard_protection"`; `finalPath: "safety_override"`; losingDecisions[] contains omit loser; target in `selectedComponents[]`, never in `omittedComponents[]`; `riskFlags[]` contains `safety_override_omit_decision`
> - `fixtures/13-conflict-resolution/user-constraint-include-beats-omit/` — `userConstraints.alwaysInclude` include beats Path A omit; `resolutionRule: "user_constraint_include"`; `finalPath: "required_match"`; ID exists in registry (not `reference_unknown`); target in `selectedComponents[]`; losingDecisions[] contains omit loser
> - `fixtures/13-conflict-resolution/path-a-beats-path-b-omit/` — Path A omit (`safe_to_omit_match`, positive evidence) beats Path B omit (`default_action_omit`); `resolutionRule: "path_a_omit_selected_over_path_b"`; `finalPath: "safe_to_omit_match"`; losingDecisions[] contains Path B loser; target in `omittedComponents[]`; Path A evidence non-empty
> - `fixtures/13-conflict-resolution/multiple-include-merged/` — multiple include decisions (registry require + `alwaysInclude`) merge into single include; `resolutionRule: "multiple_include_merged"`; `losingDecisions=[]` (valid per `docs/06` §11.5 Case 5: no true loser when merging includes); `inputDecisionIds` has 2 entries; target appears exactly once in `selectedComponents[]`; `resolutionRule` is NOT `safety_hard_protection` (component has `riskLevel: low`, `retainPolicy: mandatory`, not `safety_critical`)

### 7.14 Budget Hints / `expensive_optional`

| Goal | Verify `budgetHint` classification is correct; 500-token threshold applied correctly |
|---|---|
| Schema dependency | `budgetHint` 5-value enum; `tokensApproxObserved`; `budgetWarningCodes[]` |
| Sub-fixtures | `protected` component never trimmed; `expensive_optional` at threshold; `unknown_cost` uses conservative default; budget hint does not change `action` or `path` |
| Failure mode caught | Budget hint mutating decision; `expensive_optional` threshold wrong; `unknown_cost` not logged |

> **Seed fixtures created, repaired, and verified (Pass 4.9D-2I/2I.1/2I.2/2I.3):**
> - `fixtures/14-budget-behavior/candidate-optional-trim/` — optional low-risk component classified as `candidate_optional` (tokensApprox < 500 threshold; retainPolicy=optional; omissionPolicy=allow); selector-omitted via Path B before Budgeter; `trimActions[]` = [] (Budgeter performs no actual trim on a selector-omitted component); `trimOrder[]` = 1 entry (Budgeter considers it as candidate); assertions verify trimOrder/trimActions semantic distinction.
> - `fixtures/14-budget-behavior/expensive-optional-trim/` — optional component above canonical expensive threshold classified as `expensive_optional` (tokensApprox=900 >= 500 threshold; retainPolicy=optional; omissionPolicy=allow); selector-omitted via Path B; `trimActions[]` = []; `trimOrder[]` = 1 entry.

> **Seed fixture created (Pass 4.9D-2AC):** `fixtures/14-budget-behavior/include-resolved-optional-actual-trim/` — optional skill (`skill.deep-explainer`, tokensApprox=650, `expensive_optional`) is include-resolved by selector (`default_include`) before Budgeter; Budgeter performs actual trim (pre-trim selected total 1350 > target 800, overflow 550); `trimActions[]` has exactly one entry; trimmed component appears in final `omittedComponents[]` with `action: omit` / `path: budget_trim`; `budget_trim` absent from selectorTrace, resolvedDecisions, and conflictResolutionTrace; verifies first non-empty `budgetPhase.trimActions[]` and first use of `path: budget_trim` output partition path.

### 7.15 `over_budget_protected`

| Goal | Verify `over_budget_protected` emits warning and retains component; does not halt planning |
|---|---|
| Schema dependency | `budgetHint: over_budget_protected`; `budgetWarningCodes[]`; `budgetOverflow: boolean` |
| Expected output | Component included with `over_budget_protected`; `budgetOverflow: true` set in BudgetReport; planning continues |
| Failure mode caught | Silent overflow; halt on protected-over-budget component; omit of protected component |

> **Seed fixtures created, repaired, and verified (Pass 4.9D-2I/2I.1/2I.2/2I.3):**
> - `fixtures/15-over-budget-protected/warn-only-no-trim/` — protected component (riskLevel=critical, omissionPolicy=never, retainPolicy=safety_critical) alone exceeds budget target; `over_budget_protected` is warn-only — component remains in `selectedComponents[]`; protected component absent from `trimActions[]`; `budgetOverflow: true` is explicit and required (not absent or silent); planning completes without halting; `overBudgetProtectedWarnings[]` populated.
> - `fixtures/15-over-budget-protected/safety-critical-budget-overflow/` — two protected scaffolds combined (700+500=1200 tokens) exceed target (1000); overflow is unavoidable; optional skill (`skill.optional-quick`) is selector-omitted via Path B (`default_action_omit`) before Budgeter runs; `budgetReport.trimOrder[]` records optional skill as first trim candidate/considered order; `budgetPhase.trimActions[] == []` because optional was never include-resolved; protected components are never trimmed; `budgetOverflow: true` remains explicit because protected selected components alone exceed target; `overBudgetProtectedWarnings[]` populated for both protected scaffolds.

### 7.16 Prompt-Plan Partitions

| Goal | Verify three mutually exclusive exhaustive component lists; `path` required on `deferredComponents[]` |
|---|---|
| Schema dependency | `selectedComponents[]`, `omittedComponents[]`, `deferredComponents[]` all required; `path` required on every deferred entry |
| Expected output | Every candidate in exactly one list; `deferredComponents[].path` filterable by `runtime_unavailable` vs `default_defer` |
| Failure mode caught | Component in multiple lists; component missing from all lists; deferred entry without `path` |

> **Seed fixture created and verified (Pass 4.9D-2A/4.9D-2A.1); `resolvedAt` repaired Pass 4.9D-2C.2:**
> - `fixtures/16-partition-integrity/action-path-reference-unknown/` — all three partition arrays exercised with correct action/path pairs; `reference_unknown` absent from all partition arrays; `runtime_unavailable` defer not counted as trim savings; `active_id_unknown` warning (not `reference_unknown` decision) for unknown active ID

### 7.17 Trace Keyed Phase Object

| Goal | Verify `trace.json` is a keyed phase object with all 8 required top-level keys |
|---|---|
| Schema dependency | 8 required top-level phase keys; `selectorPhase.selectorTrace` non-empty after any run |
| Expected output | All 8 keys present; `selectorTrace` typed as array of `TraceEntry` not `SelectionDecision`; no raw content in any phase |
| Failure mode caught | Missing phase key; flat-array trace; `selectorTrace` collapsed into `SelectionDecision`; raw content leak |

> **Seed fixture created and verified (Pass 4.9D-2A/4.9D-2A.1); `resolvedAt` repaired Pass 4.9D-2C.2; `selectorSummary.narrative` repaired Pass 4.9D-2O.2/2O.3:**
> - `fixtures/17-trace-structure/keyed-trace-no-injection-phase/` — exactly 8 top-level trace keys (`run`, `requestPhase`, `registryPhase`, `selectorPhase`, `conflictPhase`, `budgetPhase`, `planPhase`, `warnings`); no `injectionGatePhase`; `selectorTrace[]` entries are TraceEntry-shaped (have `decisionId`, `module`, `failOpen`, `estimatedSavings`, `selector`; do not have `traceRefs` or `constraintsApplied`). **Narrative repair (Pass 4.9D-2O.2/2O.3):** existing fixture's `selectorPhase.selectorSummary.narrative` was non-canonical (semicolon-delimited format); repaired to match exact canonical `docs/06` §3.6 template; all count fields and all other fixture content unchanged; verified clean.

### 7.18 `summary.md` Deterministic Narrative

| Goal | Verify narrative matches deterministic template exactly; no model generation |
|---|---|
| Schema dependency | `selectorSummary.narrative` template per `docs/06` §3.6; count fields |
| Expected output | Narrative string matches template computed from count fields; no deviation |
| Failure mode caught | Model-generated narrative; narrative mismatch; raw content in `summary.md` |

> **Seed fixture created and verified CLEAN (Pass 4.9D-2O/2O.1):**
> - `fixtures/18-summary-narrative/deterministic-narrative-template/` — `selectorPhase.selectorSummary.narrative` follows the exact canonical `docs/06` §3.6 count-derived template: `"{totalEvaluated} components evaluated. {decidedInclude} included, {decidedOmit} omitted, {decidedDefer} deferred ({defaultDefer} default, {runtimeUnavailableDefer} runtime-unavailable), {failOpenInclude} fail-open. {conflictsIdentified} conflict(s) identified."` (3-component registry: scaffold via `required_match`, skill via `default_action_omit`, policy via `default_include`; narrative = `"3 components evaluated. 2 included, 1 omitted, 0 deferred (0 default, 0 runtime-unavailable), 0 fail-open. 0 conflict(s) identified."`). Narrative is derived from count fields only — no model-generated prose, no raw user request text, no raw component content. No `expected/summary.md` is created for this fixture; this fixture is JSON-field-only and validates `trace.selectorPhase.selectorSummary.narrative`. Actual `summary.md` file output remains for a future explicit summary-output fixture/harness pass using the minimal expected Markdown shape now defined in `docs/12` §5.3.1 (Pass 4.9D-2AG); that future pass must follow the fixture contract in §5.3.2.

### 7.19 Cache-Aware Ordering Invariants

| Goal | Verify advisory cache ordering never alters component membership or authorizes omission |
|---|---|
| Schema dependency | `selectedComponents[]` membership unchanged by ordering; no cache classification field in safety gate |
| Expected output | Reordering entries in `selectedComponents[]` does not change which components appear; `volatile` classification never causes omission |
| Failure mode caught | Cache ordering changing membership; `cacheStability` field used as omission gate; provider cache API fields in core schema |

---

## 8. Schema–Harness Dependency Matrix

Each row shows a schema field, the harness checks that depend on it, what breaks if the field is optional/missing/wrong, and its canonical source.

| Schema field | Harness checks depending on it | Failure if optional / missing / wrong | Canonical source |
|---|---|---|---|
| `deferredComponents[].path` | §7.10 runtime_unavailable; §7.16 partitions | Cannot distinguish `runtime_unavailable` from `default_defer`; F-28/5-Q7 zero-tolerance check silently bypassed | `docs/06` §4; `docs/04` §7.7 |
| `candidateSetSummary.candidateSetSize` | §7.3 gap-check; §7.13 conflict accounting | Denominator unknown; accounting invariant cannot be verified; silent escape | `docs/06` §3.1 |
| `SelectionDecision.traceRefs[]` | §7.17 trace keyed phase; §7.5 ladder | Cannot link decisions to trace events; `conflictResolutionTrace.gateConvertedTraceRefs` loses canonical source; untraced decisions undetectable | `docs/06` §4 |
| `selectorPhase.selectorTrace[]` | §7.12 injection gate; §7.5 ladder; §7.17 trace | Injection gate per-decision fields (`actionChanged`, `originalCandidateAction`) have no canonical home; zero-tolerance "untraced decision" check cannot fire | `docs/04` §7.8; `docs/06` §3.2 |
| `conflictResolutionTrace[]` | §7.13 conflict resolution 16 checks | Full conflict audit trail missing; gate-conversion context fields (`hadGateConvertedDecisions`) have no home | `docs/06` §11.3.2, §11.6 |
| `noConflictComponentIds[]` | §7.3 gap-check; §7.13 conflict accounting | Accounting invariant unprovable; no-conflict components unverifiable; harness cannot check that every candidate was accounted for | `docs/06` §11.3.2 |
| `conflictSummary.noConflict` | §7.13 accounting; `summary.md` check | `noConflict` count cannot be verified against `noConflictComponentIds.length`; accounting mismatch undetectable | `docs/06` §11.3.4 |
| `budgetOverflow` (required boolean on `BudgetReport`) | §7.15 over_budget_protected; §7.16 partitions | Silent budget overflow — zero-tolerance check bypassed; overflow may pass undetected | `docs/04` §7.5; `docs/06` §23 |
| `budgetHint` | §7.14 budget hints; §7.15 over_budget_protected | Cannot assert correct Budgeter treatment; wrong trim decisions uncaught; `expensive_optional` threshold check impossible | `docs/06` §20/§27 |
| `resolutionRule` (strict 14-value enum) | §7.13 all 16 conflict checks | Unrecognized values not caught; conflict type mis-labeled; history-malformed fail-open indistinguishable from ordinary fail-open; priority ordering unverifiable | `docs/06` §11.3.1a |
| `policyFallbackReasons[]` (array) | §7.12 injection gate; `halt_planning` fallback fixture | Cannot verify `halt_planning` was recognized vs treated as unknown typo; `family_confidence_fail_open_escalation` escalation audit trail lost | `docs/06` §17.6 |
| `planningWarnings[].code` | §7.1 Class A/B; §7.4 active IDs; §7.12 injection gate; §7.15 over_budget_protected | Deduplication failures undetectable; missing required global warnings undetectable; wrong warning class (e.g., `active_id_unknown` vs `reference_unknown`) indistinguishable | `docs/06` §3.4, §17.6 |

---

## 9. Non-MVP Exclusion Register

This section expands the exclusion summary in §2.3 into a full register. Each entry documents why a field or value is excluded from MVP schema files, what future condition would permit re-entry, and the unsafe failure mode if accidentally added.

> **`halt_planning` is NOT in this register.** It is a recognized reserved value accepted at the raw input boundary. See §3.7 and §6.1. It does not belong in the exclusion register.

| Excluded item | Type | Why excluded | Future re-entry condition | Unsafe failure if accidentally added in MVP schema |
|---|---|---|---|---|
| `action: quarantine` | Action enum value | Registry-phase state only; quarantine is pre-selector; quarantined components never reach selectors in correct operation (F-17 resolved, Pass 4.7A) | Future non-MVP use case (e.g., streaming registry updates) with explicit cross-spec decision | Harness accepts `quarantine` as a valid selector action; selector producing `quarantine` passes schema validation silently; boundary violation protocol (Step 1) unreachable |
| `action: unavailable` | Action enum value | Safe-defer 5-Q7/F-28; MVP uses `defer + path: runtime_unavailable` instead; dedicated action adds no information and splits harness filter logic | Future schema v1.1 if `path` filtering proves insufficient | Harness cannot assert `action: defer` + `path: runtime_unavailable` is the only valid unavailability pattern; two different unavailability semantics coexist silently |
| `unknownId` field | `SelectionDecision` field | Safe-defer 5-Q4; `componentId` carries the unknown string in MVP; a separate field deferred to schema v1.1 | Schema v1.1 with explicit cross-spec decision | Harness checking `componentId` for `reference_unknown` decisions must be taught to use `unknownId` instead; confusion between validated registry IDs and untrusted caller-supplied strings |
| `capabilityTimestamp` | Runtime capabilities field | Safe-defer 5-Q3/F-26; not required for MVP deterministic selector behavior | Future versioning/staleness detection work | Schema accepts stale timestamps silently; staleness detection fires incorrectly on missing field |
| `capabilityVersion` | Runtime capabilities field | Safe-defer 5-Q3/F-26 (same as above) | Same as `capabilityTimestamp` | Same as above |
| `budgetTrimmable` field | Component registry field | Safe-defer; `docs/05` Future Optional Fields; F-30; budget enforcement is Budgeter-owned, not registry-declared | Future budget policy gate with explicit decision | Budget enforcement logic leaks into registry; selector budget hint logic must be updated; Budgeter and selectors have conflicting trim authority |
| `conflictSummary.byPriority` | `conflictSummary` sub-field | Safe-defer 12-Q5; derivable post-hoc from `conflictResolutionTrace` by grouping on `resolutionRule`; adds no new information in MVP | Future v2 evaluation tooling if post-hoc derivation proves inconvenient | Harness may incorrectly assert on `byPriority` counts rather than canonical `conflictResolutionTrace` entries; counts may diverge from trace |
| `deferSubtype` | Deferred component field | Safe-defer 5-Q7; `path` is the MVP filter mechanism; a dedicated `deferSubtype` was explicitly deferred | Future if harness or schema requirements prove `path` filtering insufficient | Two defer subtypes (`runtime_unavailable` vs `default_defer`) have two different filter mechanisms; harness assertions become inconsistent |
| `constraintTrustLevel` | `userConstraints` field | Safe-defer 5-Q5; MVP operator-supplied constraints are treated as high-trust; trust-level differentiation deferred | Future multi-tenant or user-supplied constraint support | Trust level field present but not enforced; low-trust user constraints bypass safety checks if field is silently ignored |
| `injectionEvidenceCodes` | `requestSignals` field | Future additive field; must not replace or change the type of `injectionSuspect` boolean (F-25 resolved) | Future audit metadata expansion if richer injection evidence codes are needed | Selectors may inspect `injectionEvidenceCodes` instead of `injectionSuspect` boolean; trust boundary violated; router-side detection no longer the sole owner |
| `cacheStability` | `prompt-plan.json` advisory field | Post-MVP provider-adapter work; `docs/04` §7.7; advisory only; must not appear in MVP core schema as a required or safety-relevant field | Post-MVP adapter implementation pass | Core schema marks `cacheStability` as required; ordering logic treats it as omission gate; safety invariant ("ordering never alters membership") broken |
| `stablePrefixHash` | `prompt-plan.json` advisory field | Same as `cacheStability` | Same | Same |
| `sessionPrefixHash` | `prompt-plan.json` advisory field | Same | Same | Same |
| `recommendedCacheBoundary` | `prompt-plan.json` advisory field | Same | Same | Same |
| `volatileAfterBoundary` | `prompt-plan.json` advisory field | Same | Same | Same |
| Provider cache API fields (`cacheControlHeaders`, `ttl`, `minBlockSize`, etc.) | Adapter-specific fields | Gate D permanently blocked in MVP; provider-specific fields belong in adapter, not core schema | Post-MVP adapter implementations | Core schema becomes provider-coupled; portability guarantee broken; different adapters require different schema versions |
| `contentInline` | Component registry field | Security/privacy concern; `docs/05` Future Optional Fields; raw component text in schema output violates privacy rules (raw content must not appear in `trace.json` or `prompt-plan.json`) | Future controlled-access extension with explicit privacy review | Raw component text leaks into trace.json; privacy zero-tolerance check violated; secret leaks in CI artifacts |
| Component `dependencies` | Component registry field | Dependency graph not in MVP; no inter-selector dependency resolution defined | Future dependency-aware selector pass with explicit design | Undefined dependency semantics silently accepted; circular dependency detection absent; ordering assumptions incorrect |
| `budgetTrimmable: true` override | Registry field value | Not in MVP; `docs/04` §7.5; all trimming is Budgeter-owned | Same as `budgetTrimmable` field | Same as `budgetTrimmable` field |

---

## 10. Harness Runner Contract

> **Scope:** This section defines the harness runner validation contract — the architecture, fixture discovery rules, validation pipeline, and reporting format that future Phase 12 harness code must implement. **No harness code is created by this section.** No fixtures are created or modified. No schemas are changed. This is a docs-only contract definition (Pass 4.9D-2AI).
>
> **Relationship to `docs/11`:** `docs/11` Phase 12 is harness coding. This `docs/12` section defines the contract Phase 12 must implement. AC-01 (user approval of `docs/11`) still blocks all implementation, including harness coding. Defining this contract does not satisfy AC-01.

### 10.1 Purpose and Non-Goals

**Purpose:** The harness runner validates fixture expected outputs against accepted JSON Schemas and accepted semantic invariants. It is a deterministic, offline validation tool.

**The harness runner:**

| Does | Does not |
|---|---|
| Validates existing fixture expected files against schemas | Call providers or models |
| Applies semantic invariant checks from `docs/12` §7 and §8 | Execute OpenClaw, n8n, Telegram, or any adapter |
| Applies zero-tolerance checks from `docs/11` §9.1 | Generate prompt outputs or run the CLI planner |
| Applies privacy/raw-content boundary checks | Mutate fixture files or schema files |
| Produces a deterministic, machine-readable evaluation report | Create schemas or approve implementation |
| Runs locally with no network dependency | Touch runtime, provider credentials, or secrets |

**Non-goals for MVP harness:**

- No generated-output validation mode (see §10.14 for future distinction).
- No model-assisted analysis of fixture quality.
- No fixture auto-generation.
- No coverage gap auto-detection (fixture coverage gaps are documented in `docs/12` §7).

### 10.2 Fixture Discovery

The harness discovers fixture cases by scanning the `fixtures/` directory tree.

**Discovery rules:**

1. A fixture case is a directory under `fixtures/<group>/<case>/` containing both `inputs/` and `expected/` subdirectories.
2. A valid fixture case must contain at minimum:
   - `inputs/` directory with at least the 2 Class A required input files (`component-registry.json`, `request-signals.json`).
   - `expected/prompt-plan.json` — expected prompt-plan output.
   - `expected/trace.json` — expected trace output.
   - `expected/assertions.md` — fixture-specific assertion contract.
3. The harness reports the total count of discovered fixture cases and total file count.
4. Fixture cases that fail discovery validation (missing essential files) are reported as discovery errors, not silently skipped.
5. The fixture directory structure is `fixtures/<group-number>-<group-name>/<case-name>/`.

**Current accepted inventory:** 28 fixture cases / 308 files (224 input JSON, 56 expected JSON, 28 assertions.md). All current cases follow the standard 11-file layout defined in §10.3.

### 10.3 Standard 11-File Fixture Layout

Every current accepted fixture case follows this standard layout:

**Inputs (8 files under `inputs/`):**

| # | File | Class | Schema | Required |
|---|---|---|---|---|
| 1 | `component-registry.json` | A | `schemas/inputs/component-registry.schema.json` | Yes — halt if missing/malformed |
| 2 | `request-signals.json` | A | `schemas/inputs/request-signals.schema.json` | Yes — halt if missing/malformed |
| 3 | `active-ids.json` | B | — | Optional — Class B defaults if absent |
| 4 | `budget-state.json` | B | — | Optional — Class B defaults if absent |
| 5 | `history-state-summary.json` | B | — | Optional — Class B defaults if absent |
| 6 | `runtime-capabilities.json` | B | — | Optional — Class B defaults if absent |
| 7 | `selector-policy.json` | B | — | Optional — Class B defaults if absent |
| 8 | `user-constraints.json` | B | — | Optional — Class B defaults if absent |

**Expected outputs (2 files under `expected/`):**

| # | File | Schema |
|---|---|---|
| 9 | `prompt-plan.json` | `schemas/outputs/prompt-plan.schema.json` |
| 10 | `trace.json` | `schemas/outputs/trace.schema.json` |

**Assertions (1 file under `expected/`):**

| # | File | Role |
|---|---|---|
| 11 | `assertions.md` | Fixture-specific assertion contract and review checklist |

**Layout invariants:**

- All current 28 fixture cases use this exact 11-file layout.
- The harness must accept standard 11-file fixture cases as valid and complete.
- The harness must not require `expected/summary.md` for standard 11-file cases.
- The `assertions.md` file lives at `expected/assertions.md`, not at the case root.

### 10.4 Future Extended Fixture Layouts

Future fixture passes may extend the standard layout. This section defines support rules without creating extended fixtures.

**12-file `summary.md` fixture:**

- A future fixture may add `expected/summary.md` as a 12th file per §5.3.2.
- Such a fixture becomes a 12-file fixture case.
- The harness must detect the presence of `expected/summary.md` and activate `summary.md` boundary validation (§10.11) for that case only.
- The harness must not fail existing 11-file cases for lacking `expected/summary.md`.
- Creation of any 12-file fixture requires an explicit future pass that names the target fixture(s) and updates `docs/12` fixture counts per §5.3.2.

**Other future extensions:**

- Any new expected output file type requires an explicit fixture-contract pass.
- No extension is active until accepted and counted.

### 10.5 Missing Optional Class B Input Handling

**Problem:** All current 28 fixture cases provide all 8 input files, including the 6 optional Class B inputs. The CLI contract (`docs/11` §3.1) defines that Class B inputs are optional with documented defaults. A future fixture testing Class B default behavior would need to represent "file intentionally absent."

**Design constraint:** Present-but-empty JSON and absent-file are semantically different. A present file with `{}` is a valid (empty) input object. An absent file triggers Class B default behavior. The harness must not conflate the two.

**Selected strategy: Fixture manifest with explicit absent-file declaration.**

A future fixture that intentionally omits a Class B input file must include a `fixture-manifest.json` at the case root declaring which optional files are intentionally absent:

```json
{
  "intentionallyAbsentInputs": ["selector-policy.json"],
  "layoutNote": "Tests Class B default selector-policy behavior"
}
```

**Manifest rules:**

- If `fixture-manifest.json` is absent, the harness treats the fixture as standard layout and requires all 8 input files.
- If `fixture-manifest.json` is present, the harness reads `intentionallyAbsentInputs[]` and does not require listed files.
- Only Class B files (`active-ids.json`, `budget-state.json`, `history-state-summary.json`, `runtime-capabilities.json`, `selector-policy.json`, `user-constraints.json`) may appear in `intentionallyAbsentInputs[]`. Class A files may never be absent.
- The harness must verify that files listed as intentionally absent are actually absent. If a listed file is present, that is a manifest consistency error.
- The harness must verify that non-listed files are present. If a non-listed file is absent, that is a missing-file error.

**Current state:** No `fixture-manifest.json` exists in any current fixture. All 28 cases use standard 8-input layout. No missing-file fixture is created by this pass.

**Future activation:** Creation of a missing-file fixture requires an explicit future fixture-contract pass that creates the fixture, adds `fixture-manifest.json`, and updates `docs/12` fixture counts. The manifest schema may be formally defined at that time.

### 10.6 Validation Pipeline Order

The harness executes validation in this order:

| Step | Name | Scope | Failure behavior |
|---|---|---|---|
| 1 | Fixture discovery | Scan `fixtures/` tree | Report discovery errors; continue to other fixtures |
| 2 | Layout validation | Verify expected files present per §10.3/§10.4/§10.5 | Missing essential file = hard failure for that fixture; skip downstream checks |
| 3 | JSON parse | Parse all JSON files | Invalid JSON = hard failure for that file; skip schema/semantic checks for that file |
| 4 | Input schema validation | Validate Class A inputs against input schemas | Schema failure = hard failure; note for report |
| 5 | Output schema validation | Validate `expected/prompt-plan.json` against `schemas/outputs/prompt-plan.schema.json`; validate `expected/trace.json` against `schemas/outputs/trace.schema.json` | Schema failure = hard failure; skip semantic checks for that output |
| 6 | Cross-file semantic checks | Checks requiring both prompt-plan and trace data (accounting invariants, partition consistency, budget consistency) | Failure = semantic violation |
| 7 | Trace/accounting checks | `candidateSetSize` accounting, `noConflictComponentIds` + `conflictResolutionTrace` count, selectorTrace shape | Failure = semantic violation |
| 8 | Partition checks | `selectedComponents[]` / `omittedComponents[]` / `deferredComponents[]` mutual exclusivity and exhaustiveness | Failure = semantic violation |
| 9 | Budget checks | `budgetOverflow` consistency, `trimActions[]` vs `trimOrder[]`, protected-never-trimmed, `budget_trim` path constraints | Failure = semantic violation |
| 10 | Warning/risk/fail-open checks | Warning code presence, deduplication, `riskFlags[]`, `failOpenReasons[]` | Failure = semantic violation |
| 11 | Privacy/raw-content checks | Forbidden content scanning across all expected output files | Failure = privacy violation |
| 12 | `summary.md` boundary checks | Only when `expected/summary.md` is present — heading validation, narrative comparison, forbidden content (§5.3.3) | Failure = summary boundary violation |
| 13 | `assertions.md` checks | Fixture-specific assertion evaluation (see §10.10) | Failure per assertion type |
| 14 | Report generation | Aggregate results into evaluation report (§10.12) | — |

**Key ordering invariants:**

- Schema validation (steps 4–5) must complete before semantic checks (steps 6–11). A schema-invalid file may still be reported, but semantic checks on that file are skipped or marked "blocked by schema failure."
- JSON parse (step 3) must complete before schema validation (step 4–5).
- Cross-file checks (step 6) require both prompt-plan and trace to be schema-valid.
- Privacy checks (step 11) run on all output files regardless of semantic check results.

### 10.7 JSON Parse and Schema Validation Rules

| Rule | Detail |
|---|---|
| Invalid JSON | Hard failure. The file cannot be validated further. Report the parse error location. |
| Schema validation failure | Hard failure. Report each schema violation with field path and violation type. |
| `additionalProperties: false` | Must be honored where output schemas define it. Extra fields = schema violation. |
| Shared enum constraints | `schemas/shared/enums.shared.schema.json` values are authoritative. Unknown enum values = schema violation. |
| Output schemas authoritative | `schemas/outputs/prompt-plan.schema.json` and `schemas/outputs/trace.schema.json` are the sole schema authorities for output validation. |
| `summary.md` has no JSON Schema | Markdown validation is boundary-rule validation only (§5.3.3), not JSON Schema. |
| Input schema validation | Class A inputs validated against their schemas. Class B inputs validated if present and if schemas exist. |

### 10.8 Semantic Validation Categories

Semantic checks are grouped by domain, mapped to `docs/12` §7 fixture groups and §8 dependency matrix.

| Category | Key invariant(s) | Source §7 group(s) | Source §8 field(s) |
|---|---|---|---|
| Candidate-set accounting | `noConflictComponentIds.length + conflictResolutionTrace.length == candidateSetSummary.candidateSetSize` | §7.3, §7.13 | `candidateSetSummary.candidateSetSize` |
| SelectorTrace shape | `selectorTrace` contains `TraceEntry` objects, not `SelectionDecision` objects | §7.17 | `selectorPhase.selectorTrace[]` |
| SelectorSummary narrative | Narrative matches `docs/06` §3.6 deterministic template exactly | §7.18 | `selectorSummary.narrative` |
| Conflict resolution | `resolutionRule` strict 14-value enum; no `no_conflict` in `conflictResolutionTrace[]`; `losingDecisions` contains only true losers | §7.13 | `resolutionRule`; `conflictResolutionTrace[]` |
| Output partitions | `selected` / `omitted` / `deferred` are mutually exclusive and exhaustive for candidate components; `reference_unknown` excluded; `deferredComponents[].path` present | §7.16 | `selectedComponents[]`; `omittedComponents[]`; `deferredComponents[]` |
| Budget | `budgetOverflow` required boolean; `trimOrder[]` vs `trimActions[]` distinction; protected never trimmed; `budget_trim` only in final omitted partitions, absent from selector/resolved/conflict paths | §7.14, §7.15 | `budgetOverflow`; `budgetHint`; `trimActions` |
| Injection gate | Global warning deduplication (exactly once per run); `halt_planning` recognized fallback; unknown action fallback; `fail_open_all` conversion; `warn_and_continue` baseline; family-confidence escalation; Branch C remains deferred | §7.12 | `policyFallbackReasons[]`; `planningWarnings[].code` |
| Runtime capability | Unavailable tool → `defer` + `path: runtime_unavailable`, not direct omit; incomplete inventory → fail-open | §7.11 | `deferredComponents[].path` |
| Active/reference unknown | `active_id_unknown` for unknown active IDs vs `reference_unknown` for unknown component references | §7.4, §7.9 | — |
| Quarantine boundary | Quarantined components excluded before selector fan-out; no quarantine boundary violation | §7.2 | — |
| Summary boundary | Only when `expected/summary.md` present: required headings, narrative comparison, forbidden content per §5.3.1/§5.3.3 | §7.18 (summary aspect) | — |
| Privacy boundary | No raw request text, component content, history turn content, provider/model output, secrets/credentials/API keys in any output | §5.3 privacy rules | — |

### 10.9 Zero-Tolerance Check Mapping

Zero-tolerance checks cause harness failure (non-zero exit). Mapped from `docs/11` §9.1 and expanded by `docs/12` §7 groups.

| Check | Failure condition | Source | Related fixture group(s) |
|---|---|---|---|
| No unsafe omissions | Any component omitted without a valid Path A or Path B decision | `docs/11` §9.1 | §7.6, §7.7, §7.8 |
| No schema-invalid outputs | Any expected output file fails JSON Schema validation | `docs/11` §9.1 | All groups |
| No raw content in trace | Raw component content, raw history turn content, or raw user request text appears in `expected/trace.json` | `docs/11` §9.1 | §7.17, privacy |
| No untraced decisions | Any `SelectionDecision` absent from `selectorTrace` | `docs/11` §9.1 | §7.5, §7.17 |
| No unresolved conflicts without fail-open | Any conflict that produced no `ResolvedSelectionDecision` | `docs/11` §9.1 | §7.13 |
| No silent budget overflow | `budgetOverflow: true` not set when protected components exceed budget | `docs/11` §9.1 | §7.15 |
| Candidate-set accounting mismatch | `noConflictComponentIds.length + conflictResolutionTrace.length != candidateSetSize` | `docs/12` §7.3, §8 | §7.3, §7.13 |
| Partition exclusivity violation | A component ID appears in more than one of `selected` / `omitted` / `deferred` | `docs/12` §7.16 | §7.16 |
| `deferredComponents[].path` missing | Any `deferredComponents[]` entry lacks `path` field | `docs/12` §7.16, §8 | §7.10, §7.16 |
| `budget_trim` in non-output path | `budget_trim` appears in `selectorTrace`, `resolvedDecisions`, or `conflictResolutionTrace` paths | `docs/12` §7.14 | §7.14 |
| Injection warning deduplication failure | Global injection warning emitted more than once per run | `docs/06` §17.7 | §7.12 |
| ResolutionRule invalid value | `resolutionRule` not in canonical 14-value enum | `docs/12` §8 | §7.13 |
| Narrative mismatch | `selectorSummary.narrative` does not match `docs/06` §3.6 deterministic template | `docs/12` §7.18, §8 | §7.18 |

### 10.10 `assertions.md` Role

`expected/assertions.md` serves as the fixture-specific assertion contract and review checklist.

**Current role:**

- Human-readable documentation of what each fixture tests.
- Review checklist for fixture verification passes.
- Source of fixture-specific invariants that go beyond generic schema/semantic checks.

**Harness consumption in MVP:**

- The MVP harness treats `assertions.md` as documentation input. It verifies the file exists and is non-empty.
- The MVP harness does not parse `assertions.md` for machine-executable assertion syntax.
- A future pass may define a machine-readable assertion marker syntax (e.g., structured assertion tags) that the harness can parse and evaluate programmatically. Such a syntax must not invalidate current `assertions.md` files.

**Invariant:** All current 28 `expected/assertions.md` files remain valid under this contract.

### 10.11 `summary.md` Validation

**Current state:** No current fixture includes `expected/summary.md`. The harness must not require it for 11-file cases.

**Future activation:** When a future fixture includes `expected/summary.md` (per §5.3.2), the harness must:

1. Verify all 7 required headings from §5.3.1 are present in the correct order.
2. Compare `## Selector Summary` narrative content exactly against the value derived from `selectorSummary.narrative` and the `docs/06` §3.6 template. Mismatch = harness failure.
3. Verify source-derived fields are present in each section (budget figures, partition counts, warning codes, risk flag IDs).
4. Verify no forbidden raw content appears (raw component text, raw history text, raw user request text, secrets, credentials, API keys, provider/model output).
5. Apply whitespace normalization rules from §5.3.3 (normalize line endings, trim trailing spaces; do not require byte-for-byte whitespace equality unless a future pass makes that explicit).
6. Fail if any non-template text appears in the narrative section (no model-generated prose in MVP).

**Invariant:** Actual `summary.md` generation is future source/runtime work. This contract defines how the harness validates expected `summary.md` files, not how the planner produces them.

### 10.12 Reporting Format

The harness must produce a deterministic, machine-readable JSON evaluation report.

**Required report fields:**

| Field | Type | Description |
|---|---|---|
| `reportId` | string | Unique report identifier |
| `timestamp` | string (ISO 8601) | Report generation time |
| `harnessVersion` | string | Harness contract version (initially `"1.0.0"`) |
| `fixtureDiscovery.totalCases` | integer | Number of discovered fixture cases |
| `fixtureDiscovery.totalFiles` | integer | Total files across all fixtures |
| `results.passed` | integer | Fixtures with all checks passing |
| `results.failed` | integer | Fixtures with at least one failure |
| `results.skipped` | integer | Fixtures skipped due to discovery/layout error |
| `results.blocked` | integer | Fixtures with downstream checks blocked by schema/parse failure |
| `perFixture[]` | array | Per-fixture result detail |
| `perFixture[].fixturePath` | string | Relative path to fixture case directory |
| `perFixture[].status` | enum | `"passed"` / `"failed"` / `"skipped"` / `"blocked"` |
| `perFixture[].parseValidation` | object | JSON parse results per file |
| `perFixture[].schemaValidation` | object | Schema validation results per file |
| `perFixture[].semanticValidation` | object | Semantic check results by category |
| `perFixture[].privacyValidation` | object | Privacy/raw-content check results |
| `perFixture[].summaryValidation` | object or null | `summary.md` boundary check results (null if no `expected/summary.md`) |
| `perFixture[].warnings` | array | Non-blocking notes or deferred-item notices |
| `deferred[]` | array | List of explicitly deferred check categories (e.g., Branch C injection, `unknown_cost`) |

**Report schema:** The formal JSON Schema for the report is deferred to a future pass. This section defines the required shape; the schema formalizes it later.

### 10.13 Fail-Fast vs Collect-All Strategy

| Scenario | Behavior |
|---|---|
| **Within a fixture:** parse failure | Skip schema and semantic checks for that file. Report the parse error. Continue to other files in the fixture. |
| **Within a fixture:** schema failure | Skip semantic checks that depend on the schema-invalid file. Report the schema error. Continue to other checks. |
| **Within a fixture:** semantic failure | Continue to remaining semantic checks. Collect all violations. |
| **Across fixtures:** any fixture failure | Continue to next fixture. Do not stop the entire harness run. |
| **Final exit code** | Non-zero if any fixture has a hard failure (parse, schema, zero-tolerance, or privacy violation). Zero only if all fixtures pass all checks. |

**Rationale:** Collect-all at fixture level allows users to see the full violation landscape. Hard blockers (parse, schema) prevent unreliable downstream checks but do not halt the run.

### 10.14 Static Fixture Validation vs Future Generated-Output Validation

Two distinct harness modes are architecturally possible. Only the first is defined by this contract.

**Mode 1 — Static fixture validation (this contract):**

- Validates existing `expected/` files under `fixtures/`.
- Does not run the CLI planner.
- Does not produce actual outputs.
- Suitable before implementation — validates fixture correctness against schemas and invariants.
- Active in MVP harness.

**Mode 2 — Generated-output validation (future):**

- Runs the CLI planner (`context-plane plan`) against fixture `inputs/`.
- Compares generated `prompt-plan.json`, `trace.json`, and `summary.md` against `expected/` files.
- Requires implementation to exist (AC-01 satisfied; Phase 0–11 complete).
- Not active now. Not defined by this contract.
- A future pass must define: invocation contract, diff comparison strategy, tolerance for non-deterministic fields (if any), and CI integration.

**Invariant:** Mode 2 does not replace Mode 1. Both modes may coexist: Mode 1 validates fixture self-consistency; Mode 2 validates implementation correctness.

### 10.15 Privacy and Content Boundary Checks

The harness must scan all expected output files for forbidden content.

**Forbidden content (any occurrence = privacy violation = hard failure):**

| Category | Detection approach |
|---|---|
| Raw component content | Scan for known component body text patterns from fixture inputs. Component IDs (short identifier strings) are allowed; component body content is not. |
| Raw history turn content | Scan for raw `turns[]` content strings from fixture `history-state-summary.json` inputs. |
| Raw user request text | Scan for raw request text from fixture `request-signals.json` `requestText` field. |
| Provider/model responses | Scan for provider-specific response patterns (API response shapes, model output markers). In MVP fixtures, no provider content exists; this check ensures none is introduced. |
| Secrets/credentials/API keys | Scan for common secret patterns (API key formats, `Bearer` tokens, credential-like strings). |

**Allowed references:**

| Category | Rule |
|---|---|
| Component IDs (`componentId` strings) | Allowed — these are short identifier strings, not content. |
| Warning codes | Allowed. |
| Risk flag codes | Allowed. |
| File paths / source refs | Allowed only if already present in safe plan/trace fields. |
| Hash values | Allowed if already present in plan/trace. |

**Constraints:** No OCR, no external tools, no network access. Privacy checks are string-matching operations on fixture file content.

### 10.16 Deterministic and Offline Execution

| Guarantee | Detail |
|---|---|
| Deterministic | Same fixtures + same schemas → same report. No randomness, no timestamps in comparison logic, no environment-dependent behavior. |
| Offline | No network calls. No provider API. No model inference. No remote schema registry. |
| No mutation | Harness reads fixtures and schemas. It never writes to fixture or schema directories. Report output goes to a separate report path. |
| No runtime dependency | Harness does not depend on OpenClaw, n8n, Telegram, or any adapter being installed or reachable. |
| No generated output | Harness does not run the CLI planner (Mode 1 only — see §10.14). |

### 10.17 Relationship to AC-01 and `docs/11`

| Item | Status |
|---|---|
| AC-01 (user approval of `docs/11`) | ⬜ Pending. This harness contract does not satisfy AC-01. |
| AC-03 (harness plan approved) | This contract contributes toward AC-03 readiness. AC-03 formally follows AC-01. |
| Phase 12 (harness coding) | Future. Phase 12 must implement this contract. Phase 12 entry gate is "Phase 11 done." |
| Implementation readiness review | Should happen after this contract is accepted, not before. This contract reduces AC-01 review risk by documenting harness design before implementation. |

### 10.18 Deferred Items After Harness Contract

The following items remain deferred after this contract definition:

| Item | Classification | When to resolve |
|---|---|---|
| Harness code implementation | Implementation — blocked on AC-01 | Phase 12 after AC-01 |
| Generated-output validation (Mode 2) | Future harness mode | After Phase 0–11 implementation |
| Missing optional Class B input fixture | Fixture creation — manifest strategy defined, no fixture created | Future fixture-contract pass |
| Actual `expected/summary.md` fixture | Fixture creation per §5.3.2 | Future fixture pass after harness contract acceptance |
| Branch C `WARN_AND_CONTINUE_OVERRIDE_DESIGN_DEFERRED` | Spec ambiguity | Future spec clarification |
| `unknown_cost` budget hint reachability | Spec/schema gap — unreachable under current schema | Future spec/schema decision |
| Quarantine warning-code reconciliation | Spec clarification — non-blocking | Future spec pass |
| Cache-aware ordering fixture (§7.19) | Fixture coverage gap | Future fixture pass |
| Report JSON Schema | Schema formalization | Future pass (shape defined in §10.12) |
| `assertions.md` machine-readable syntax | Harness extension | Future pass |
| docs/12 duplicate Final Status polish | Docs hygiene | Future polish pass |

---

## 11. Next Pass Sequence

> **Current status (Pass 4.9D-2AI):** Passes 4.9B-4, 4.9C-1, 4.9C-2A, 4.9C-2B, 4.9C-2B.2, 4.9C-3R, 4.9C-3S, 4.9C-4C.2, 4.9C-5B.1, 4.9D-1, 4.9C-5C, 4.9D-2A, 4.9D-2A.1, 4.9D-2B, 4.9D-2C, 4.9D-2C.1, 4.9D-2C.2, 4.9D-2C.3, 4.9D-2D, 4.9D-2E, 4.9D-2E.1, 4.9D-2E.2, 4.9D-2E.3, 4.9D-2F, 4.9D-2G, 4.9D-2G.1, 4.9D-2H, 4.9D-2I, 4.9D-2I.1, 4.9D-2I.2, 4.9D-2I.3, 4.9D-2J, 4.9D-2K, 4.9D-2K.1, 4.9D-2L, 4.9D-2L.1, 4.9D-2M, 4.9D-2N, 4.9D-2O, 4.9D-2O.1, 4.9D-2O.2, 4.9D-2O.3, 4.9D-2P, 4.9D-2Q, 4.9D-2R, 4.9D-2R.1, 4.9D-2S, 4.9D-2T, **4.9D-2U** (accepted after R1/R1.1/R1.2/R1.3/R2 repair and verification chain), 4.9D-2U.R2, 4.9D-2V, 4.9D-2W, 4.9D-2X, 4.9D-2X.1, 4.9D-2Y, 4.9D-2Z, 4.9D-2Z.1, 4.9D-2AA, 4.9D-2AB, 4.9D-2AB.1, 4.9D-2AC, 4.9D-2AC.1, and 4.9D-2AD are accepted complete. All schema batches (A, B, C, D) including Batch B extension are created and accepted. Fixture inventory accepted (Pass 4.9D-1). **28 fixture cases created, verified, and accepted — first batch (Pass 4.9D-2A/2A.1, 4 cases, 44 files; resolvedAt repaired Pass 4.9D-2C.2/2C.3) + second batch (Pass 4.9D-2C/2C.1, 4 cases, 44 files) + third batch (Pass 4.9D-2E/2E.1/2E.2/2E.3, 4 cases, 44 files) + fourth batch (Pass 4.9D-2G/2G.1, 4 cases, 44 files) + fifth batch (Pass 4.9D-2I/2I.1/2I.2/2I.3, 4 cases, 44 files; trimActions semantics repaired Pass 4.9D-2I.2) + sixth batch (Pass 4.9D-2L/2L.1, 3 cases, 33 files; CLEAN_WITH_NOTES) + seventh batch (Pass 4.9D-2O/2O.1, 2 cases, 22 files; CLEAN_WITH_OUT_OF_SCOPE_FOLLOW_UP) + eighth batch (Pass 4.9D-2R/2R.1, 2 cases, 22 files; CLEAN_WITH_DEFERRED_SUBCASE: warn_and_continue override sub-case deferred) + ninth batch (Pass 4.9D-2AC/2AC.1, 1 case, 11 files; first non-empty trimActions[] fixture) — total 308 files: 224 input JSON, 56 expected JSON, 28 assertions.md. Old fixture 17 narrative repaired Pass 4.9D-2O.2/2O.3 (field-only, case count unchanged).** Full fixture suite is not complete. Harness code not created. `docs/13_MODEL_ASSISTED_CONTEXT_PLANNING.md` created by Pass 4.9D-2AE as a Future Architecture Note + MVP Compatibility Contract; does not change MVP schema/fixture/runtime behavior. **Pass 4.9D-2AE** created `docs/13`; verified by 4.9D-2AE.1 (accepted). **Pass 4.9D-2AE.R1/R1.1** repaired docs/12 status drift. **Pass 4.9D-2AF** (read-only decision) recommended summary.md boundary as next direction. **Pass 4.9D-2AG** defined minimal `summary.md` output boundary in §5.3 (§5.3.1 minimal Markdown shape, §5.3.2 future fixture contract, §5.3.3 harness comparison rules); verified by 4.9D-2AG.1; R1 stale wording repaired. **Pass 4.9D-2AH** (read-only decision) recommended harness runner contract as next direction. **Pass 4.9D-2AI (this pass):** defines Harness Runner Contract in §10 (§10.1–§10.18: purpose, fixture discovery, standard/extended layouts, missing-file manifest strategy, validation pipeline, schema validation, semantic categories, zero-tolerance mapping, assertions.md role, summary.md validation, reporting format, fail-fast/collect-all, static vs generated-output modes, privacy checks, deterministic/offline guarantee, AC-01 relationship, deferred items). No harness code created. No schema, fixture, or implementation change. Fixture count unchanged: 28 cases / 308 files. The active next pass is **4.9D-2AI.1 — Read-only verification of Harness Runner Contract**. The table below is preserved for historical traceability; accepted passes are marked ✅.

| Pass | Goal | Status |
|---|---|---|
| **4.9B-4** | Validate `docs/12_SCHEMA_AND_HARNESS_PLAN.md` — internal consistency, enum counts, `noConflictComponentIds` placement, `injectionGatePhase` absence, `halt_planning` treatment | ✅ Completed (merged with 4.9C-1 inventory; validation confirmed before schema generation began) |
| **4.9C-1** | JSON Schema file inventory — enumerate schema files to be created, file names, objects covered, ordering | ✅ Completed — inventory folded into Pass 4.9C-2A pre-work |
| **4.9C-2A** | Create Batch A shared schemas (`enums.shared`, `prompt-family`, `warning-code`) | ✅ Completed — Pass 4.9C-2A |
| **4.9C-2B** | Create Batch B input schemas (6 files: `active-ids`, `runtime-capabilities`, `history-state-summary`, `budget-state`, `user-constraints`, `selector-policy`) | ✅ Completed — Pass 4.9C-2B; audit passed 4.9C-2B.2 with no edits |
| **4.9C-3** | Create Batch C internal data object schemas (`SelectionDecision`, `ResolvedSelectionDecision`, `TraceEntry`, `conflictResolutionTrace`, `selectorSummary`, `planningWarning`, `BudgetReport`) | Files created prematurely in scope overrun — see Pass 4.9C-3R/4.9C-3S |
| **4.9C-3R** | Batch C containment audit/repair: validate files, fix `planning-warning.schema.json`, revert premature docs/12 status | ✅ Completed — Pass 4.9C-3R |
| **4.9C-3S** | Full audit of all 7 Batch C schemas against canonical specs; accept or reject Batch C | ✅ Completed — Pass 4.9C-3S (audit clean; Batch C accepted) |
| **4.9C-4+** | Output file schemas (`prompt-plan.json`, `trace.json`) — creation, strictness repair, path-enum enforcement | ✅ Completed through Pass 4.9C-4C.2 — `schemas/outputs/prompt-plan.schema.json` and `schemas/outputs/trace.schema.json` created and accepted |
| **4.9C-5B.1** | Create Batch B extension input schemas (`component-registry.schema.json`, `request-signals.schema.json`); wording repair pass | ✅ Completed — schemas created and accepted |
| **4.9C-5C** | `docs/12` status sync after Batch B extension acceptance | ✅ Completed |
| **4.9D-1** | Evaluation Harness fixture inventory — enumerate fixture files, map to §7 groups, define input/output file names | ✅ Completed — inventory accepted |
| **4.9D-2A** | Create 4 MVP seed fixture cases (`unknown-policy-value`, `halt-planning-recognized`, `keyed-trace-no-injection-phase`, `action-path-reference-unknown`) — 44 files | ✅ Completed |
| **4.9D-2A.1** | Verify fixture tree scope and content — read-only spot-check; all 44 files confirmed clean | ✅ Completed |
| **4.9D-2B** | `docs/12` status sync after verified MVP seed fixtures | ✅ Completed |
| **4.9D-2C** | Create 4 accounting/runtime foundation fixture cases (`gap-check-accounting`, `tool-defer-not-savings`, `fail-open-tools`, `active-id-unknown-not-reference-unknown`) — 44 files | ✅ Completed |
| **4.9D-2C.1** | Verify 4.9D-2C batch clean + found prior 4.9D-2A `resolvedAt` ISO string drift | ✅ Completed |
| **4.9D-2C.2** | Repair prior 4.9D-2A `resolvedAt` drift — 9 fields changed from ISO string to integer monotonic counter | ✅ Completed |
| **4.9D-2C.3** | Scratch cleanup verification — scratch validation script deleted; repaired traces confirmed clean | ✅ Completed |
| **4.9D-2D** | `docs/12` status sync after repaired seed fixtures and accepted accounting/runtime batch | ✅ Completed |
| **4.9D-2E** | Create 4 selector ladder / omission foundation fixture cases (`safety-override-include`, `safe-to-omit-positive-evidence`, `default-action-omit`, `unknown-component-reference`) — 44 files | ✅ Completed |
| **4.9D-2E.1** | Verify 4.9D-2E batch — found Case 4 conceptual invalid (activeSkillIds used for reference_unknown) and Cases 1/2 registry field drift (`componentId` → `id`) | ✅ Completed |
| **4.9D-2E.2** | Repair Case 4 (redesigned to use `userConstraints.alwaysInclude`) and Cases 1/2 registry field drift | ✅ Completed |
| **4.9D-2E.3** | Verify repaired batch clean — 72/72 checks passed | ✅ Completed |
| **4.9D-2F** | `docs/12` status sync after accepted selector ladder fixture batch | ✅ Completed |
| **4.9D-2G** | Create 4 conflict resolution foundation fixture cases (`safety-beats-omit`, `user-constraint-include-beats-omit`, `path-a-beats-path-b-omit`, `multiple-include-merged`) — 44 files | ✅ Completed |
| **4.9D-2G.1** | Verify conflict resolution batch — 264 checks, 0 failures; all 4 cases confirmed clean | ✅ Completed |
| **4.9D-2H** | `docs/12` status sync after accepted conflict resolution fixture batch | ✅ Completed |
| **4.9D-2I** | Create 4 budget behavior fixture cases (`candidate-optional-trim`, `expensive-optional-trim`, `warn-only-no-trim`, `safety-critical-budget-overflow`) — 44 files | ✅ Completed |
| **4.9D-2I.1** | Verify budget fixture batch — found trimActions semantic defect: selector-omitted components incorrectly placed in `budgetPhase.trimActions[]` in Cases 1, 2, and 4 | ✅ Completed |
| **4.9D-2I.2** | Repair trimActions/assertions semantics — `trimActions[]` → `[]` in Cases 1, 2, 4; assertions.md updated to distinguish `trimOrder[]` (candidates) from `trimActions[]` (performed actions) | ✅ Completed |
| **4.9D-2I.3** | Verify repaired budget fixture batch clean — all 4 cases confirmed clean across 7 verification sections | ✅ Completed |
| **4.9D-2J** | `docs/12` status sync after accepted budget behavior fixture batch | ✅ Completed |
| **4.9D-2K** | Remaining fixture coverage inventory — read-only survey of uncovered §7 groups | ✅ Completed |
| **4.9D-2K.1** | Next-batch proposal hardening — resolved 3 ambiguities before fixture creation | ✅ Completed |
| **4.9D-2L** | Create 3 fixture cases: registry quarantine exclusion, selector-policy deterministicOnly normalization, fail_open_all injection gate — 33 files | ✅ Completed |
| **4.9D-2L.1** | Verify 4.9D-2L batch — 163 checks, 0 errors; CLEAN_WITH_NOTES (quarantine warning-code ambiguity noted, non-blocking) | ✅ Completed |
| **4.9D-2M** | `docs/12` status sync after accepted sixth fixture batch | ✅ Completed |
| **4.9D-2N** | Decide next controlled fixture / spec clarification step — scoping and decision pass; no files created | ✅ Completed |
| **4.9D-2O** | Create 2 fixture cases: `requiredWhen` selector ladder (`required-when-match`) and deterministic `selectorSummary` narrative (`deterministic-narrative-template`) — 22 files | ✅ Completed |
| **4.9D-2O.1** | Verify 4.9D-2O batch — CLEAN_WITH_OUT_OF_SCOPE_FOLLOW_UP: both new fixtures clean; old fixture 17 narrative drift identified as out-of-scope follow-up | ✅ Completed |
| **4.9D-2O.2** | Repair old fixture 17 narrative drift — surgical single-field edit to `selectorSummary.narrative` in `fixtures/17-trace-structure/keyed-trace-no-injection-phase/expected/trace.json` | ✅ Completed |
| **4.9D-2O.3** | Verify old narrative repair clean — CLEAN; all count fields unchanged; narrative matches canonical `docs/06` §3.6 template | ✅ Completed |
| **4.9D-2P** | `docs/12` status sync after accepted seventh fixture batch and old narrative repair | ✅ Completed |
| **4.9D-2Q** | Decide next controlled fixture / spec / harness step | ✅ Completed |
| **4.9D-2R** | Create 2 fixture cases: `warn-and-continue-baseline` and `family-confidence-escalation` injection gate fixtures — 22 files | ✅ Completed |
| **4.9D-2R.1** | Verify 4.9D-2R batch — CLEAN_WITH_DEFERRED_SUBCASE: both fixtures clean; `WARN_AND_CONTINUE_OVERRIDE_DESIGN_DEFERRED` sub-case documented | ✅ Completed |
| **4.9D-2S** | `docs/12` status sync after accepted eighth fixture batch | ✅ Completed |
| **4.9D-2T** | Decide next controlled fixture / spec / docs13 / harness step | ✅ Completed |
| **4.9D-2U** | Targeted MVP spec clarification — docs/06 §17.3.1, docs/12 gaps A–E (over-broad `WARN_AND_CONTINUE_OVERRIDE_DESIGN_DEFERRED` claim; other 4 gaps documented); repaired through R1/R1.1/R1.1-CHECK/R1.2/R1.2-CHECK2/R1.3 | ✅ Accepted — R2 verification: CLEAN_WITH_HISTORICAL_STALE_RECORDS (§19 DoD checklist historical-only; all active sections clean) |
| **4.9D-2U.R1** | Repair over-broad `WARN_AND_CONTINUE_OVERRIDE_DESIGN_DEFERRED` clarification — replace "all unreachable / dead code" with three-branch analysis (Branch A: Step 3 hard-protection; Branch B: omit-gate blocked; Branch C: unresolved trigger ambiguity) | ⚠️ Superseded by R1.1 — residual normative contradiction remained |
| **4.9D-2U.R1.1** | Repair remaining normative contradiction — remove unconditional "must upgrade" behavior bullets for Branch C from `docs/06` §17.3.1; replace with explicit staged three-branch rule; update §7.7 cross-reference and §17 policy table; update `docs/12` §7.12/§11 | ⚠️ Superseded by R1.2 — three missed normative sections found by R1.1-CHECK |
| **4.9D-2U.R1.1-CHECK** | Read-only reconciliation — confirmed R1.1 edits were on disk but §3, §17.4, §17.5 remained stale | ✅ Completed |
| **4.9D-2U.R1.2** | Repair three missed normative sections in `docs/06`: §3 overview policy table, §17.4 Ladder Interaction pseudocode, §17.5 Per-Selector Effect Summary (history/memory/policy/output_format rows) | ⚠️ Superseded by R1.3 — §17.7 active harness check rows found stale by R1.2-CHECK2 |
| **4.9D-2U.R1.2-CHECK2** | Read-only reconciliation — confirmed R1.2 edits on disk; found §17.7 rows still stale (`ACTIVE_HARNESS_CHECK_STALE_WORDING`) | ✅ Completed |
| **4.9D-2U.R1.3** | Repair two stale active harness check rows in `docs/06` §17.7: "Safety/policy omit not overridden" and "High-risk output_format omit not overridden" — replaced with Branch A/B/C-aware wording | ✅ Completed |
| **4.9D-2U.R2** | Read-only verification of repaired targeted MVP spec clarification — result: CLEAN_WITH_HISTORICAL_STALE_RECORDS | ✅ Completed |
| **4.9D-2V** | Formal acceptance of 4.9D-2U after R2; next-step decision: budget trim action schema reconciliation scoping | ✅ Completed — this pass |
| **4.9D-2W** | Budget trim action schema reconciliation scoping — read-only analysis of `trimActionsPerformed[]` vs `budgetPhase.trimActions[]` naming mismatch; classification: `SAME_CONCEPT_NAMING_DRIFT` | ✅ Completed |
| **4.9D-2X** | Remove `BudgetReport.trimActionsPerformed[]` from `schemas/internal/budget-report.schema.json` — naming drift resolved; canonical performed trim actions at `trace.budgetPhase.trimActions[]` only; docs/12 status sync | ✅ Completed — this pass |
| **4.9D-2X.1** | Read-only verification of BudgetReport trimActionsPerformed removal | ✅ Completed — Pass 4.9D-2X.1 |
| **4.9D-2Y** | Non-empty `budgetPhase.trimActions[]` fixture scoping — read-only; result: `SCHEMA_SCOPE_NEEDED`; `budget_trim` absent from `SelectionPath`; fixture blocked | ✅ Completed — Pass 4.9D-2Y |
| **4.9D-2Z** | Budget-trim output semantics clarification — docs-only; partition placement, PPG override rule, token accounting, warning semantics, schema scope note | ✅ Completed — Pass 4.9D-2Z |
| **4.9D-2Z.1** | Read-only verification of budget-trim output semantics clarification | ✅ Completed — Pass 4.9D-2Z.1 |
| **4.9D-2AA** | `budget_trim` schema-extension scoping — read-only; result: Option C two-part recommended; `SelectionPath` must not receive `budget_trim`; local allOf enum extension in output schemas only | ✅ Completed — Pass 4.9D-2AA |
| **4.9D-2AB** | `budget_trim` output partition schema repair — two-part Option C: widened `PartitionEntry.path` base to `type:string`; added `budget_trim` to `omittedComponents[]` local allOf enum in both output schemas; docs/12 status sync | ✅ Completed — Pass 4.9D-2AB |
| **4.9D-2AB.1** | Read-only verification of budget_trim output partition schema repair | ✅ Completed — Pass 4.9D-2AB.1 |
| **4.9D-2AC** | Non-empty `budgetPhase.trimActions[]` fixture creation — `fixtures/14-budget-behavior/include-resolved-optional-actual-trim/`; `skill.deep-explainer` include-resolved then actually trimmed; `path: budget_trim` in omittedComponents; first non-empty trimActions[]; no selector/resolved leakage | ✅ Completed — Pass 4.9D-2AC |
| **4.9D-2AC.1** | Read-only verification of non-empty budget trim fixture | ✅ Completed — Pass 4.9D-2AC.1 |
| **4.9D-2AD** | Read-only scoping for `docs/13_MODEL_ASSISTED_CONTEXT_PLANNING.md` — MVP boundary confirmation, structure critique, canonical conflict analysis, architecture flow validation, outdated draft content analysis; recommended Option A (create docs/13) | ✅ Completed — Pass 4.9D-2AD |
| **4.9D-2AE** | Create `docs/13_MODEL_ASSISTED_CONTEXT_PLANNING.md` as Future Architecture Note + MVP Compatibility Contract — 25 sections; docs/12 status sync | ✅ Completed — Pass 4.9D-2AE |
| **4.9D-2AE.R1** | Repair docs/12 active status/header drift after docs/13 creation | ✅ Completed — Pass 4.9D-2AE.R1 |
| **4.9D-2AE.R1.1** | Micro-repair two stale `budgetPhase.trimActions[]` status references in docs/12 | ✅ Completed — Pass 4.9D-2AE.R1.1 |
| **4.9D-2AE.1** | Read-only verification of docs/13 creation | ✅ Completed — Pass 4.9D-2AE.1 |
| **4.9D-2AF** | Read-only decision pass for next project direction after docs/13 acceptance — recommended Option A1 (`summary.md` boundary) | ✅ Completed — Pass 4.9D-2AF |
| **4.9D-2AG** | Define minimal `summary.md` output boundary in docs/12 §5.3 — §5.3.1 Minimal Expected Markdown Shape (7 required headings + 1 optional), §5.3.2 Future `expected/summary.md` Fixture Contract, §5.3.3 Harness Comparison Rules | ✅ Completed — Pass 4.9D-2AG |
| **4.9D-2AG.R1** | Micro-repair stale §7.18 `summary.md` wording after summary boundary definition | ✅ Completed — Pass 4.9D-2AG.R1 |
| **4.9D-2AG.1** | Read-only verification of summary.md output boundary definition | ✅ Completed — Pass 4.9D-2AG.1 |
| **4.9D-2AH** | Read-only decision pass for next direction after summary.md boundary acceptance — recommended Option A (harness runner contract) | ✅ Completed — Pass 4.9D-2AH |
| **4.9D-2AI** | Define Harness Runner Contract in docs/12 §10 — §10.1–§10.18: purpose, fixture discovery, standard/extended layouts, missing-file manifest, validation pipeline, semantic categories, zero-tolerance mapping, reporting format, privacy checks, AC-01 relationship, deferred items | **This pass** — pending verification |
| **4.9D-2AI.1** | Read-only verification of Harness Runner Contract | **Active next pass** — pending explicit user approval |

**Implementation code remains blocked until the user explicitly approves `docs/11_CLI_MVP_IMPLEMENTATION_PLAN.md` (AC-01 pending).** Schema generation and harness fixture creation are each gated on separate explicit user approvals.

---

## 12. Final Status

| Area | Status |
|---|---|
| Evaluation Harness fixture repair — old narrative drift | ✅ **Repaired and verified CLEAN** — Pass 4.9D-2O.2/2O.3: `fixtures/17-trace-structure/keyed-trace-no-injection-phase/expected/trace.json` — field `selectorPhase.selectorSummary.narrative` replaced from non-canonical semicolon-delimited format to exact canonical `docs/06` §3.6 template output. Case count unchanged (this is an existing first-batch fixture). |
| Evaluation Harness fixture files — eighth batch | ✅ **Created and verified CLEAN_WITH_DEFERRED_SUBCASE** — Pass 4.9D-2R/2R.1: **2 cases / 22 files** (16 input JSON, 4 expected JSON, 2 assertions.md). `WARN_AND_CONTINUE_OVERRIDE_DESIGN_DEFERRED` sub-case documented — not covered. Cases: `fixtures/12-injection-gate/warn-and-continue-baseline/`, `fixtures/12-injection-gate/family-confidence-escalation/`. |
| Evaluation Harness fixture files — ninth batch | ✅ **Created and verified** — Pass 4.9D-2AC/2AC.1: **1 case / 11 files** (8 input JSON, 2 expected JSON, 1 assertions.md). First non-empty `budgetPhase.trimActions[]` fixture; first use of `path: budget_trim` in omitted output partitions. Case: `fixtures/14-budget-behavior/include-resolved-optional-actual-trim/`. |
| Evaluation Harness fixture files — combined | **28 cases / 308 files total** — 28 case directories; 224 input JSON files; 56 expected JSON files; 28 assertions.md files. Each case: 8 input JSON + 2 expected JSON + 1 assertions.md = 11 files. **Verified fixture inventory by batch:** First batch: `fixtures/12-injection-gate/unknown-policy-value/`, `fixtures/12-injection-gate/halt-planning-recognized/`, `fixtures/17-trace-structure/keyed-trace-no-injection-phase/`, `fixtures/16-partition-integrity/action-path-reference-unknown/`. Second batch: `fixtures/03-candidate-set-summary/gap-check-accounting/`, `fixtures/10-runtime-unavailable/tool-defer-not-savings/`, `fixtures/11-capability-inventory-incomplete/fail-open-tools/`, `fixtures/04-active-ids/active-id-unknown-not-reference-unknown/`. Third batch: `fixtures/06-hard-protection/safety-override-include/`, `fixtures/07-path-a-omission/safe-to-omit-positive-evidence/`, `fixtures/08-path-b-omission/default-action-omit/`, `fixtures/09-reference-unknown/unknown-component-reference/`. Fourth batch: `fixtures/13-conflict-resolution/safety-beats-omit/`, `fixtures/13-conflict-resolution/user-constraint-include-beats-omit/`, `fixtures/13-conflict-resolution/path-a-beats-path-b-omit/`, `fixtures/13-conflict-resolution/multiple-include-merged/`. Fifth batch: `fixtures/14-budget-behavior/candidate-optional-trim/`, `fixtures/14-budget-behavior/expensive-optional-trim/`, `fixtures/15-over-budget-protected/warn-only-no-trim/`, `fixtures/15-over-budget-protected/safety-critical-budget-overflow/`. Sixth batch: `fixtures/02-registry-validation/quarantine-excluded-from-candidates/`, `fixtures/05-selector-policy/deterministic-only-false-defaulted/`, `fixtures/12-injection-gate/fail-open-all/`. Seventh batch: `fixtures/05-selector-ladder/required-when-match/`, `fixtures/18-summary-narrative/deterministic-narrative-template/`. Eighth batch: `fixtures/12-injection-gate/warn-and-continue-baseline/`, `fixtures/12-injection-gate/family-confidence-escalation/`. Ninth batch: `fixtures/14-budget-behavior/include-resolved-optional-actual-trim/`. |
| Evaluation Harness full fixture suite | **Not complete** — 28 cases / 308 files accepted; additional fixture coverage groups remain uncovered |

**Implementation code remains blocked until the user explicitly approves `docs/11_CLI_MVP_IMPLEMENTATION_PLAN.md` (AC-01 pending).** Schema generation and harness fixture creation are each gated on separate explicit user approvals.

---

## 12. Final Status

| Item | Status |
|---|---|
| `docs/12_SCHEMA_AND_HARNESS_PLAN.md` Sections 1–5 | Complete (Pass 4.9B-2 + 4.9B-2.1) |
| `docs/12_SCHEMA_AND_HARNESS_PLAN.md` Sections 6–11 | Complete (Pass 4.9B-3) |
| `omissionPolicy` enum drift fix | Complete (Pass 4.9B-3.1) — corrected `never/conditional/always` to canonical `allow/fail_open/never` per `docs/05` §3 |
| Actual JSON Schema files — Batch A (shared) | **Created** — Pass 4.9C-2A: `schemas/shared/enums.shared.schema.json`, `schemas/shared/prompt-family.schema.json`, `schemas/shared/warning-code.schema.json` |
| Actual JSON Schema files — Batch B (inputs) | ✅ **Created and accepted** — Pass 4.9C-2B (6 files: `active-ids`, `runtime-capabilities`, `history-state-summary`, `budget-state`, `user-constraints`, `selector-policy`; audit passed 4.9C-2B.2 with no edits). Batch B extension accepted Pass 4.9C-5B.1: `schemas/inputs/component-registry.schema.json` (bare array, 18 required fields), `schemas/inputs/request-signals.schema.json` (closed `PromptFamilyValue` enum, required `familyConfidence`, boolean `injectionSuspect`). |
| Actual JSON Schema files — Batch C (internal data objects) | ✅ **Audited and accepted** — Pass 4.9C-3S: `schemas/internal/selection-decision.schema.json`, `schemas/internal/resolved-selection-decision.schema.json`, `schemas/internal/trace-entry.schema.json`, `schemas/internal/conflict-resolution-trace.schema.json`, `schemas/internal/selector-summary.schema.json`, `schemas/internal/planning-warning.schema.json`, `schemas/internal/budget-report.schema.json` |
| Actual JSON Schema files — Batch D (output files) | ✅ **Created and accepted** — Pass 4.9C-4C.2: `schemas/outputs/prompt-plan.schema.json`, `schemas/outputs/trace.schema.json`. Partition arrays enforce both action and path per partition; `reference_unknown` excluded from all output partition arrays. |
| Evaluation Harness fixture inventory | ✅ **Accepted** — Pass 4.9D-1: 19 fixture groups inventoried; input/output contracts defined; MVP set identified. |
| Evaluation Harness fixture files — first batch | ✅ **Created, verified, and repaired** — Pass 4.9D-2A/2A.1/2C.2/2C.3: **4 cases / 44 files** (32 input JSON, 8 expected JSON, 4 assertions.md). `resolvedAt` repaired from ISO string to integer monotonic counter (Pass 4.9D-2C.2). Cases: `fixtures/12-injection-gate/unknown-policy-value/`, `fixtures/12-injection-gate/halt-planning-recognized/`, `fixtures/17-trace-structure/keyed-trace-no-injection-phase/`, `fixtures/16-partition-integrity/action-path-reference-unknown/`. |
| Evaluation Harness fixture files — second batch | ✅ **Created and verified** — Pass 4.9D-2C/2C.1: **4 cases / 44 files** (32 input JSON, 8 expected JSON, 4 assertions.md). Cases: `fixtures/03-candidate-set-summary/gap-check-accounting/`, `fixtures/10-runtime-unavailable/tool-defer-not-savings/`, `fixtures/11-capability-inventory-incomplete/fail-open-tools/`, `fixtures/04-active-ids/active-id-unknown-not-reference-unknown/`. |
| Evaluation Harness fixture files — third batch | ✅ **Created, repaired, and verified** — Pass 4.9D-2E/2E.1/2E.2/2E.3: **4 cases / 44 files** (32 input JSON, 8 expected JSON, 4 assertions.md). Cases 1/2 registry field drift repaired (Pass 4.9D-2E.2); Case 4 redesigned to use `userConstraints.alwaysInclude` as canonical `reference_unknown` path (Pass 4.9D-2E.2). Cases: `fixtures/06-hard-protection/safety-override-include/`, `fixtures/07-path-a-omission/safe-to-omit-positive-evidence/`, `fixtures/08-path-b-omission/default-action-omit/`, `fixtures/09-reference-unknown/unknown-component-reference/`. |
| Evaluation Harness fixture files — fourth batch | ✅ **Created and verified** — Pass 4.9D-2G/2G.1: **4 cases / 44 files** (32 input JSON, 8 expected JSON, 4 assertions.md). 264 checks, 0 failures. Cases: `fixtures/13-conflict-resolution/safety-beats-omit/`, `fixtures/13-conflict-resolution/user-constraint-include-beats-omit/`, `fixtures/13-conflict-resolution/path-a-beats-path-b-omit/`, `fixtures/13-conflict-resolution/multiple-include-merged/`. |
| Evaluation Harness fixture files — fifth batch | ✅ **Created, repaired, and verified** — Pass 4.9D-2I/2I.1/2I.2/2I.3: **4 cases / 44 files** (32 input JSON, 8 expected JSON, 4 assertions.md). trimActions semantic defect repaired (Pass 4.9D-2I.2): selector-omitted components removed from `budgetPhase.trimActions[]`; `trimOrder[]` vs `trimActions[]` distinction confirmed. Cases: `fixtures/14-budget-behavior/candidate-optional-trim/`, `fixtures/14-budget-behavior/expensive-optional-trim/`, `fixtures/15-over-budget-protected/warn-only-no-trim/`, `fixtures/15-over-budget-protected/safety-critical-budget-overflow/`. |
| Evaluation Harness fixture files — sixth batch | ✅ **Created and verified CLEAN_WITH_NOTES** — Pass 4.9D-2L/2L.1: **3 cases / 33 files** (24 input JSON, 6 expected JSON, 3 assertions.md). 163 checks, 0 errors. Quarantine warning-code ambiguity noted (non-blocking, spec clarification deferred). Cases: `fixtures/02-registry-validation/quarantine-excluded-from-candidates/`, `fixtures/05-selector-policy/deterministic-only-false-defaulted/`, `fixtures/12-injection-gate/fail-open-all/`. |
| Evaluation Harness fixture files — seventh batch | ✅ **Created and verified CLEAN_WITH_OUT_OF_SCOPE_FOLLOW_UP** — Pass 4.9D-2O/2O.1: **2 cases / 22 files** (16 input JSON, 4 expected JSON, 2 assertions.md). Cases: `fixtures/05-selector-ladder/required-when-match/`, `fixtures/18-summary-narrative/deterministic-narrative-template/`. Old fixture 17 narrative drift identified as out-of-scope follow-up; repaired and verified CLEAN (Pass 4.9D-2O.2/2O.3). |
| Evaluation Harness fixture repair — old narrative drift | ✅ **Repaired and verified CLEAN** — Pass 4.9D-2O.2/2O.3: `fixtures/17-trace-structure/keyed-trace-no-injection-phase/expected/trace.json` — field `selectorPhase.selectorSummary.narrative` replaced from non-canonical semicolon-delimited format to exact canonical `docs/06` §3.6 template output. Case count unchanged (this is an existing first-batch fixture). |
| Evaluation Harness fixture files — eighth batch | ✅ **Created and verified CLEAN_WITH_DEFERRED_SUBCASE** — Pass 4.9D-2R/2R.1: **2 cases / 22 files** (16 input JSON, 4 expected JSON, 2 assertions.md). `WARN_AND_CONTINUE_OVERRIDE_DESIGN_DEFERRED` sub-case documented — not covered. Cases: `fixtures/12-injection-gate/warn-and-continue-baseline/`, `fixtures/12-injection-gate/family-confidence-escalation/`. |
| Evaluation Harness fixture files — combined | **28 cases / 308 files total** — 28 case directories; 224 input JSON files; 56 expected JSON files; 28 assertions.md files. Each case: 8 input JSON + 2 expected JSON + 1 assertions.md = 11 files. **Verified fixture inventory by batch:** First batch: `fixtures/12-injection-gate/unknown-policy-value/`, `fixtures/12-injection-gate/halt-planning-recognized/`, `fixtures/17-trace-structure/keyed-trace-no-injection-phase/`, `fixtures/16-partition-integrity/action-path-reference-unknown/`. Second batch: `fixtures/03-candidate-set-summary/gap-check-accounting/`, `fixtures/10-runtime-unavailable/tool-defer-not-savings/`, `fixtures/11-capability-inventory-incomplete/fail-open-tools/`, `fixtures/04-active-ids/active-id-unknown-not-reference-unknown/`. Third batch: `fixtures/06-hard-protection/safety-override-include/`, `fixtures/07-path-a-omission/safe-to-omit-positive-evidence/`, `fixtures/08-path-b-omission/default-action-omit/`, `fixtures/09-reference-unknown/unknown-component-reference/`. Fourth batch: `fixtures/13-conflict-resolution/safety-beats-omit/`, `fixtures/13-conflict-resolution/user-constraint-include-beats-omit/`, `fixtures/13-conflict-resolution/path-a-beats-path-b-omit/`, `fixtures/13-conflict-resolution/multiple-include-merged/`. Fifth batch: `fixtures/14-budget-behavior/candidate-optional-trim/`, `fixtures/14-budget-behavior/expensive-optional-trim/`, `fixtures/15-over-budget-protected/warn-only-no-trim/`, `fixtures/15-over-budget-protected/safety-critical-budget-overflow/`. Sixth batch: `fixtures/02-registry-validation/quarantine-excluded-from-candidates/`, `fixtures/05-selector-policy/deterministic-only-false-defaulted/`, `fixtures/12-injection-gate/fail-open-all/`. Seventh batch: `fixtures/05-selector-ladder/required-when-match/`, `fixtures/18-summary-narrative/deterministic-narrative-template/`. Eighth batch: `fixtures/12-injection-gate/warn-and-continue-baseline/`, `fixtures/12-injection-gate/family-confidence-escalation/`. Ninth batch: `fixtures/14-budget-behavior/include-resolved-optional-actual-trim/`. |
| Evaluation Harness full fixture suite | **Not complete** — 28 cases / 308 files accepted; additional fixture coverage groups remain uncovered |
| Evaluation Harness code | **Not created** — harness coding is Phase 12 of `docs/11`; blocked until fixture suite complete and AC-01 approved |
| Module code implementation | **Not started** — blocked on AC-01 (user approval of `docs/11`) |
| Runtime / OpenClaw / provider work | **Untouched** — Gate D permanently blocked in MVP |
| Implementation approval | **Pending** — user must explicitly approve `docs/11_CLI_MVP_IMPLEMENTATION_PLAN.md` |
| `docs/13_MODEL_ASSISTED_CONTEXT_PLANNING.md` | ✅ **Created** — Pass 4.9D-2AE: Future Architecture Note + MVP Compatibility Contract (25 sections). Does not change MVP schemas, fixtures, enums, warning codes, trace shapes, prompt-plan shapes, or implementation behavior. Includes MVP Non-Interference Guarantee and Current MVP Compatibility Commitments. Future work requires separate explicit decision passes. |

**Invariants preserved in all sections:**

- No `injectionGatePhase` top-level trace key — injection gate data lives inside `selectorPhase.selectorTrace[]` per-decision entries and global `warnings[]`
- `selectorTrace` is **not** collapsed into `SelectionDecision` — two distinct companion object types
- `halt_planning` is raw-input accepted / effective-policy not implemented — not excluded, not an unknown typo
- unknown `injectionSuspectAction` strings are accepted at the raw input schema boundary; orchestrator emits `injection_action_unknown` and normalizes to `warn_and_continue`
- `noConflictComponentIds` is a separate `string[]` output of the Conflict Resolver — not inside `conflictSummary`
- `resolutionRule` is a strict 14-value enum per `docs/06` §11.3.1a
- `no_conflict` must **not** appear in `conflictResolutionTrace[]` entries — no-conflict components belong in `noConflictComponentIds[]` only; the schema enforces this with a `not: const: "no_conflict"` constraint (Pass 4.9C-3S; confirmed in fixtures Pass 4.9D-2G/2G.1)
- `multiple_include_merged` may have `losingDecisions=[]` when all input decisions are include decisions with no true loser — per `docs/06` §11.5 Case 5 (confirmed in `fixtures/13-conflict-resolution/multiple-include-merged/`, Pass 4.9D-2G/2G.1)
- conflict gap-check: `noConflictComponentIds.length + conflictResolutionTrace.length == candidateSetSummary.candidateSetSize` — enforced in all fixtures (1+1=2 in four-batch cases; 2+0=2 and 3+0=3 in fifth-batch cases)
- `budgetPhase.trimActions[]` is required and always an array — must be `[]` when no actual Budgeter trim action occurred (Pass 4.9D-2I.2)
- `budgetPhase.budgetOverflow` is required and always boolean — must match `budgetReport.budgetOverflow` exactly; silent/absent overflow is a zero-tolerance failure
- `budgetReport.trimOrder[]` records the Budgeter's candidate consideration order; `budgetPhase.trimActions[]` records actual Budgeter-performed trim actions only — these are semantically distinct arrays
- components already selector-omitted via Path A or Path B must not appear in `budgetPhase.trimActions[]` — the Budgeter cannot trim what was never include-resolved (confirmed Pass 4.9D-2I.1/2I.2)
- protected components (riskLevel=critical, omissionPolicy=never, or retainPolicy=safety_critical/mandatory) must never appear in `trimActions[]` — `budgetHint` restricted to `candidate_optional` or `expensive_optional` only
- `over_budget_protected` is warn-only in MVP — it does not authorize trim or halt; protected component remains selected; `budgetOverflow: true` is set explicitly; planning continues
- `budgetOverflow` is `required: true` boolean on `BudgetReport`
- `budget_trim` is a plan-phase output partition path (Pass 4.9D-2Z): PPG places budget-trimmed include-resolved components in `omittedComponents[]` with `action: omit` / `path: budget_trim`; Budgeter does not mutate `ResolvedSelectionDecision[]`; selectors and Conflict Resolver must never emit `budget_trim`; schema support added by Pass 4.9D-2AB: `PartitionEntry.path` widened to `type:string` in both output schemas; `budget_trim` added to `omittedComponents[]` local allOf enum; `SelectionPath` shared enum unchanged
- token accounting (Pass 4.9D-2Z): `budgetPlan.selectedTokensApprox` = pre-trim selected total; `budgetPlan.projectedOverflow` = pre-trim check; `TrimActionEntry.tokensDropped` = per-trim actual drop; `prompt-plan.estimatedTokens` = post-trim final total; `budgetPhase.budgetOverflow` = post-trim status
- successful trim of eligible optional component does not emit planning warning / risk flag / failOpenReason — trim is traceable only via `trimActions[]` (Pass 4.9D-2Z)
- non-empty `budgetPhase.trimActions[]` fixture created and verified by Pass 4.9D-2AC/2AC.1: `fixtures/14-budget-behavior/include-resolved-optional-actual-trim/`; `skill.deep-explainer` include-resolved by selector then actually trimmed by Budgeter; `path: budget_trim` used in final `omittedComponents[]` output partitions; no selector/resolved/conflict leakage
- `path` is `required: true` on every `deferredComponents[]` entry
- output partition arrays in `prompt-plan.schema.json` and `trace.schema.json` enforce both `action` and `path` compatibility per partition — `allOf` with `action.const` and `path.enum` (Pass 4.9C-4C.2)
- `reference_unknown` is excluded from all output partition arrays (`selectedComponents`, `omittedComponents`, `deferredComponents`) — it is traceable through selectorTrace TraceEntry and `resolvedDecisions` pass-through mechanisms only
- true `reference_unknown` is triggered by a selector/caller reference (e.g., `userConstraints.alwaysInclude`) to a component ID absent from `componentsById` — per `docs/06` §8 Step 2; unknown `activeSkillIds`/`activeToolIds`/`activeMemoryIds` entries produce `active_id_unknown` warnings only (`unknownReferences: 0`) and are covered separately by `fixtures/04-active-ids/active-id-unknown-not-reference-unknown/` (Pass 4.9D-2E.1 canonical clarification)
- `component-registry.schema.json` is a bare top-level array of component objects (`type: array`, `minItems: 1`; no wrapper object)
- component registry schema requires **18** component fields per `docs/05` §3 (not 16 — corrected in Pass 4.9C-5C)
- `request-signals.promptFamily` is a **closed enum** at the schema boundary — only the 10 known `PromptFamilyValue` values are schema-valid; unknown values are schema-invalid; JSON Schema does not perform substitution
- `request-signals.injectionSuspect` is `type: boolean` only — frozen per F-25; no struct replacement permitted
- no raw user request text appears in `request-signals.schema.json`; `additionalProperties: false` enforces boundary
- no `contentInline` field appears in `component-registry.schema.json`
- `resolvedAt` in `ResolvedSelectionDecision` is an **integer monotonic step counter** — not a wall-clock timestamp string (corrected in Pass 4.9D-2C.2 across all prior seed fixture traces)
- component registry input files use `id` as the component identifier field — not `componentId` (field drift corrected in Pass 4.9D-2E.2 for Cases 1 and 2 of the third batch)
- no raw component content and no raw user request text appear in any fixture trace or prompt-plan file; no provider/model/cache/OpenClaw adapter work in any MVP fixture pass
- registry quarantine excludes quarantined components before selector fan-out; quarantined IDs must be absent from `selectorTrace[]`, `resolvedDecisions[]`, `noConflictComponentIds[]`, and all output partition arrays
- correct quarantine exclusion must not emit `quarantine_boundary_violation` — that path fires only on boundary defects (quarantined component incorrectly reaching selector fan-out)
- `deterministicOnly: false` in a present `selector-policy.json` is a normalization/defaulting fixture (emits `selector_policy_defaulted`), not a missing-file fixture; missing optional input file behavior remains uncovered pending fixture-contract decision
- `fail_open_all` converts all Path A / Path B omit outcomes to `action: include`, `path: fail_open` under injection suspicion; converted trace entries preserve `originalCandidateAction` and `originalCandidatePath`
- `fail_open_all` emits exactly one global `injection_suspect_fail_open_all` warning per run — not per converted component
- quarantine warning-code reconciliation (`schema_invalid` vs `component_quarantined` / future canonical code in PlanningWarning advisory list) remains a later spec clarification item, not a fixture blocker
- `fixtures/14-budget-behavior/unknown-cost-classification/` remains deferred — docs/06 §23.3 requires absent `tokensApprox`/`charsApprox` to trigger `unknown_cost`; registry schema requires both fields; no schema-valid trigger exists without a schema or spec change
- `requiredWhen` prompt-family match (ladder Step 5) produces `action: include`, `path: required_match` without requiring a `conflictResolutionTrace[]` entry when no conflict exists — no-conflict required includes belong in `noConflictComponentIds[]` only (confirmed in `fixtures/05-selector-ladder/required-when-match/`, Pass 4.9D-2O)
- `selectorSummary.narrative` must follow the exact canonical `docs/06` §3.6 count-derived template — harness must assert string equality against the template-substituted value; any deviation is a harness failure (confirmed in `fixtures/18-summary-narrative/deterministic-narrative-template/`, Pass 4.9D-2O)
- `selectorSummary.narrative` must not contain raw user request text, raw component content, or model-generated prose — it is a statistical count summary only (confirmed Pass 4.9D-2O)
- `expected/summary.md` is not created by fixture-only passes — the canonical expected Markdown shape is now defined in `docs/12` §5.3.1 (Pass 4.9D-2AG: 7 required headings, source field mapping, privacy exclusion rules); future fixture creation requires an explicit future pass per §5.3.2 (boundary also documented in `fixtures/18-summary-narrative/deterministic-narrative-template/expected/assertions.md` Assertion 5)
- old non-canonical `selectorSummary.narrative` in `fixtures/17-trace-structure/keyed-trace-no-injection-phase/` has been repaired to match the canonical `docs/06` §3.6 template (Pass 4.9D-2O.2/2O.3; narrative drift follow-up resolved)
- `warn_and_continue` emits exactly one global `injection_suspect_warn_and_continue` warning per run — not per decision; deduplication is an orchestrator invariant
- `warn_and_continue` does not globally suppress ordinary low-risk Path B omissions; the `injection_suspect_policy_override` upgrade path (safety/policy/history-durable omit override) has unresolved Branch C trigger ambiguity — Branches A and B are structurally unreachable (Step 3 hard-protection and omit-gate exclusion respectively); Branch C is not yet resolved — see `WARN_AND_CONTINUE_OVERRIDE_DESIGN_DEFERRED` below
- low-risk allowed omit decisions under `warn_and_continue` remain omitted with `actionChanged: false` and `injection_suspect_omit_allowed` in per-decision `warningsEmitted`
- family-confidence escalation: when `injectionSuspect: true` and `familyConfidence < failOpenThreshold`, effective policy automatically escalates to `fail_open_all` regardless of the requested policy value; `family_confidence_fail_open_escalation` is recorded in `policyFallbackReasons[]` and global warnings
- under family-confidence escalation, Path A / Path B omit outcomes convert to `include / fail_open` and the converted trace entry preserves `originalCandidateAction` and `originalCandidatePath`; per-decision `injectionSuspectAction` reflects the effective (escalated) policy, not the requested value
- global warning order under family-confidence escalation: `family_confidence_fail_open_escalation` precedes `injection_suspect_fail_open_all`
- `WARN_AND_CONTINUE_OVERRIDE_DESIGN_DEFERRED` (three-branch reachability analysis per `docs/06` §17.3.1 Pass 4.9D-2U.R1/R1.1): Branch A (`riskLevel: critical`, `retainPolicy: safety_critical/mandatory`, `omissionPolicy: never`) is unreachable before injection gate via Step 3 hard-protection — cannot arrive as `action: omit`; Branch B (`riskLevel: high`) is unreachable as omit because Path A/B gate conditions require `riskLevel: low` or `medium` (falls to Step 11 fail-open instead); Branch C (`type: policy` with low/medium risk and valid omit gates; history-durable without hard-protection metadata) has unresolved trigger ambiguity — **no current mandatory upgrade behavior and no current mandatory allow behavior for Branch C cases**; no fixture may be created until Branch C is explicitly resolved by a future clarification; `injection_suspect_policy_override` is reserved in advisory enum; not fired in standard MVP operation until Branch C resolved
- `docs/13_MODEL_ASSISTED_CONTEXT_PLANNING.md` is a Future Architecture Note + MVP Compatibility Contract (created Pass 4.9D-2AE) — it does not introduce MVP schema fields, enum values, warning codes, fixture changes, or implementation behavior changes; any future work motivated by docs/13 requires a separate explicit decision pass
- `BudgetReport.trimActionsPerformed[]` naming drift resolved (Pass 4.9D-2W/2X): `trimActionsPerformed[]` removed from `schemas/internal/budget-report.schema.json`; canonical actual Budgeter-performed trim actions are recorded only at `trace.budgetPhase.trimActions[]` (`TrimActionEntry` shape: `componentId`, `budgetHint`, `tokensDropped`, `reason`; `budgetHint` restricted to `candidate_optional` / `expensive_optional`); `budgetReport.trimOrder[]` remains distinct (candidate / considered trim order, required); existing 4 budget fixtures remain valid and unchanged; non-empty `budgetPhase.trimActions[]` fixture coverage added and verified by Pass 4.9D-2AC/2AC.1 (`fixtures/14-budget-behavior/include-resolved-optional-actual-trim/`)
- `unknown_cost` (`budgetHint` enum value) is not testable in MVP: `docs/06` §23.3 triggers it when both `tokensApprox` and `charsApprox` are absent, but `component-registry.schema.json` requires both fields — no schema-valid component can omit both; `metadataOnly: true` with zero values does not equal absent fields; `fixtures/14-budget-behavior/unknown-cost-classification/` remains deferred until a future spec/schema decision makes the trigger reachable
- missing optional Class B input file (e.g., absent `selector-policy.json`) cannot be represented by a present placeholder file; a fixture-contract decision defining a 7-input layout, harness loader simulation, or explicit extension must precede any missing-file fixture (documented in `docs/12` §7.1, Pass 4.9D-2U)
- `expected/summary.md` is not created by fixture-only passes — minimal expected Markdown shape is now defined in `docs/12` §5.3.1 (Pass 4.9D-2AG: 7 required headings, source field mapping, privacy exclusion rules, harness comparison rules); future `expected/summary.md` fixture contract defined in §5.3.2 (12-file layout, requires explicit future pass to create); fixture layout would change from 11 to 12 files for that group

**Recommended next pass:** Pass 4.9D-2AI.1 — Read-only verification of Harness Runner Contract. Requires explicit user approval before starting.

*Pass 4.9C-2C status sync: Updated §3 header line, §1 scope table `Generate actual .json schema files` row, and §11 status table `Actual JSON Schema files` row — split into Batch A (created), Batch B (created), and Batch C+ (pending) rows. No canonical spec sections, no schema files, no harness fixtures, no runtime/OpenClaw/provider work changed.*

*Pass 4.9C-2C.1 correction: Replaced stale §10 next-pass sequence (pre-creation planning language: "No pass below creates schema files", "4.9B-4", "4.9C-2 Create first JSON Schema files", "Recommended immediate next pass: 4.9B-4") with a historically-aware table marking completed passes (✅ 4.9B-4, 4.9C-1, 4.9C-2A, 4.9C-2B) and stating the active next pass (4.9C-3 Batch C). No canonical spec sections, schema files, harness fixtures, source code, or OpenClaw/provider work changed.*

*Pass 4.9C-2C.2 correction: Fixed §3.7 `injectionSuspectAction` table row for unknown values — replaced "Reject / emit `injection_action_unknown`" with "Accept at raw input schema boundary (open string, no enum enforced); orchestrator emits `injection_action_unknown`". Added corresponding invariant bullet to §11 invariants list. Aligns with `selector-policy.schema.json` open-string design (Pass 4.9C-2B.1) and canonical orchestrator-owned normalization contract in `docs/06` §2.9 / F-24. No schema files, source code, tests, fixtures, or OpenClaw/provider work changed.*

*Pass 4.9C-2C.3 correction: Fixed §6.1 `injectionSuspectAction` enum-summary table row for unknown values — replaced "Reject" with "Accept at raw input schema boundary (open string, no enum enforced)"; updated "Emits `injection_action_unknown`" to "Orchestrator emits `injection_action_unknown`". Updated §10 status label from Pass 4.9C-2C.1 to Pass 4.9C-2C.3. §3.7 and §6.1 now agree: unknown raw `injectionSuspectAction` strings are accepted at the schema boundary and normalized by the orchestrator. No schema files, docs/11, docs/09, source code, tests, fixtures, or OpenClaw/provider work changed.*

*Pass 4.9C-3 premature scope overrun: Created 7 Batch C internal schema files and marked Pass 4.9C-3 complete without user authorization. This was a scope violation — Pass 4.9C-3A was inventory-only. Files exist on disk but are not accepted. See Pass 4.9C-3R containment note below.*

*Pass 4.9C-3R containment/repair: (1) Removed `injection_suspect_seen` from `planning-warning.schema.json` examples — it is a trace/evidence atom, not a warning code (docs/06 §3.4; docs/12 §6.2). Added `$comment` noting intentional exclusion. (2) Reverted §10 current-status blurb from “4.9C-3 complete, 4.9C-4+ active” to “files created prematurely, 4.9C-3R active”. (3) Added 4.9C-3R row to §10 pass table; changed 4.9C-3 from ✅ Completed to “pending containment audit/review”; changed 4.9C-4+ from Active to Pending. (4) Updated §11 Batch C row to “pending containment audit/review”. (5) Updated docs header §Actual JSON Schema files line. (6) Updated Recommended next pass to 4.9C-3R. No other docs/04, docs/05, docs/06, docs/09, docs/11, Batch A/B schema files, output schemas, tests, fixtures, source code, or OpenClaw/provider work changed.*


*Pass 4.9C-4D status sync: Updated header Actual JSON Schema files line (Batch D created/accepted after 4.9C-4C.2); Section 1 scope table row (Batch D now listed as created/accepted; future extensions noted); Section 10 blurb (active next pass changed to 4.9D-1) and pass table (4.9C-4+ marked completed; 4.9D-1 now active); Section 11 Batch D row (changed from Not yet created to Created and accepted -- Pass 4.9C-4C.2); Section 11 invariant list (added two bullets: output partition action/path enforcement; reference_unknown excluded from output partition arrays); Section 11 recommended next pass (changed to Pass 4.9D-1 harness fixture inventory). No schema files, docs/04, docs/05, docs/06, docs/09, docs/11, tests, fixtures, source, runtime, OpenClaw, or provider work changed.*

*Pass 4.9C-5C status sync: Updated header Actual JSON Schema files line (Batch B extension accepted — component-registry.schema.json and request-signals.schema.json; fixture inventory accepted); Section 1 scope table row (Batch B extension noted); Section 3.2 (corrected 16 required fields to 18 per docs/05 §3 Minimum Required Fields table; added bare-array shape note; added schema-accepted row); Section 3.3 (added schema-accepted row; clarified promptFamily is closed enum at schema boundary — unknown values schema-invalid; JSON Schema does not perform substitution; added optional signals and privacy rule rows); Section 10 current-status blurb (updated to Pass 4.9C-5C; noted Batch B extension and fixture inventory accepted; active next pass changed to 4.9D-2) and pass table (added 4.9C-5B.1, 4.9C-5C, 4.9D-1 as completed; 4.9D-2 as active next pass); Section 11 Batch B row (updated to include extension schemas); fixture inventory row split into inventory-accepted and fixture-files-not-created rows; invariant list (added 6 new invariants for component-registry bare array, 18 required fields, promptFamily closed enum, injectionSuspect boolean, no raw request text, no contentInline); recommended next pass changed to 4.9D-2. No schema files, docs/04, docs/05, docs/06, docs/09, docs/11, tests, fixtures, source, runtime, OpenClaw, or provider work changed.*

*Pass 4.9D-2B status sync: Updated header Actual JSON Schema files line (4 MVP seed fixture cases created and verified — 44 files); Section 7.12 injection gate (added seed fixture note: unknown-policy-value and halt-planning-recognized); Section 7.16 partition integrity (added seed fixture note: action-path-reference-unknown); Section 7.17 trace keyed phase (added seed fixture note: keyed-trace-no-injection-phase); Section 10 current-status blurb (updated to Pass 4.9D-2B; noted seed fixtures created/verified; active next pass changed to 4.9D-2C pending user approval) and pass table (replaced 4.9D-2 Active row with completed 4.9D-2A/4.9D-2A.1/4.9D-2B rows; added 4.9D-2C as active next pass); Section 11 fixture files row split into seed-created/verified and full-suite-not-complete rows; added harness code row; recommended next pass changed to 4.9D-2C. No schema files, fixture files, docs/04, docs/05, docs/06, docs/09, docs/11, tests, harness, source, runtime, OpenClaw, or provider work changed.*

*Pass 4.9D-2D status sync: Updated header status line (8 cases/88 files; both batches noted; resolvedAt repair noted); Section 7.3 gap-check (added seed fixture note: gap-check-accounting); Section 7.4 active IDs (added seed fixture note: active-id-unknown-not-reference-unknown); Section 7.10 runtime_unavailable (added seed fixture note: tool-defer-not-savings); Section 7.11 capabilityInventoryComplete (added seed fixture note: fail-open-tools); Section 7.12/7.16/7.17 prior seed notes (updated to reference resolvedAt repair Pass 4.9D-2C.2); Section 10 current-status blurb (updated to Pass 4.9D-2D; listed all new completed passes; active next pass changed to 4.9D-2E pending user approval) and pass table (added 4.9D-2C/2C.1/2C.2/2C.3/2D completed rows; added 4.9D-2E as active next pass); Section 11 fixture rows (split into first-batch/second-batch/combined rows; updated counts to 8 cases/88 files; active next pass changed to 4.9D-2E); Section 11 invariant list (added resolvedAt integer monotonic counter bullet); recommended next pass changed to 4.9D-2E. No schema files, fixture files, docs/04, docs/05, docs/06, docs/09, docs/11, tests, harness, source, runtime, OpenClaw, or provider work changed.*

*Pass 4.9D-2F status sync: Updated header status line (12 cases/132 files; third batch noted); Section 7.6 Step 3 Hard Protection (added seed fixture note: safety-override-include); Section 7.7 Path A Omission (added seed fixture note: safe-to-omit-positive-evidence); Section 7.8 Path B Omission (added seed fixture note: default-action-omit); Section 7.9 reference_unknown (expanded goal table with canonical input path and active-ID distinction; added seed fixture note: unknown-component-reference with redesign history); Section 10 current-status blurb (updated to Pass 4.9D-2F; listed all new completed passes 4.9D-2E/2E.1/2E.2/2E.3/2F; active next pass changed to 4.9D-2G pending user approval) and pass table (added 4.9D-2E/2E.1/2E.2/2E.3/2F completed rows; added 4.9D-2G as active next pass); Section 11 fixture rows (added third-batch row; updated combined to 12 cases/132 files with full batch inventory; active next pass changed to 4.9D-2G); Section 11 invariant list (added reference_unknown canonical distinction bullet and component registry id field bullet); recommended next pass changed to 4.9D-2G. No schema files, fixture files, docs/04, docs/05, docs/06, docs/09, docs/11, tests, harness, source, runtime, OpenClaw, or provider work changed.*

*Pass 4.9D-2H status sync: Updated header status line (16 cases/176 files; fourth batch noted — Pass 4.9D-2G/2G.1); Section 7.13 conflict resolution (added 4 seed fixture notes: safety-beats-omit, user-constraint-include-beats-omit, path-a-beats-path-b-omit, multiple-include-merged); Section 10 current-status blurb (updated to Pass 4.9D-2H; listed all new completed passes 4.9D-2G/2G.1/2H; active next pass changed to 4.9D-2I pending user approval) and pass table (added 4.9D-2G/2G.1/2H completed rows; added 4.9D-2I as active next pass); Section 11 fixture rows (added fourth-batch row; updated combined to 16 cases/176 files with full batch inventory including fourth batch; active next pass changed to 4.9D-2I); Section 11 invariant list (added: no_conflict in conflictResolutionTrace forbidden bullet; multiple_include_merged losingDecisions=[] valid bullet; conflict gap-check bullet; raw content/provider work bullet); recommended next pass changed to 4.9D-2I. No schema files, fixture files, docs/04, docs/05, docs/06, docs/09, docs/11, tests, harness, source, runtime, OpenClaw, or provider work changed.*

*Pass 4.9D-2J status sync: Updated header status line (20 cases/220 files; fifth batch noted — Pass 4.9D-2I/2I.1/2I.2/2I.3; trimActions semantics repair noted); Section 7.14 budget hints (added 2 seed fixture notes: candidate-optional-trim, expensive-optional-trim; trimOrder vs trimActions distinction documented); Section 7.15 over_budget_protected (added 2 seed fixture notes: warn-only-no-trim, safety-critical-budget-overflow); Section 10 current-status blurb (updated to Pass 4.9D-2J; listed all new completed passes 4.9D-2I/2I.1/2I.2/2I.3/2J; active next pass changed to 4.9D-2K pending user approval) and pass table (added 4.9D-2H/2I/2I.1/2I.2/2I.3/2J completed rows; added 4.9D-2K as active next pass); Section 11 fixture rows (added fifth-batch row; updated combined to 20 cases/220 files with full batch inventory including fifth batch; active next pass changed to 4.9D-2K); Section 11 invariant list (added 6 budget-specific bullets: trimActions[] required array; budgetOverflow required boolean matching budgetReport; trimOrder[] vs trimActions[] semantic distinction; selector-omitted components must not appear in trimActions[]; protected components never in trimActions[]; over_budget_protected warn-only); recommended next pass changed to 4.9D-2K. No schema files, fixture files, docs/04, docs/05, docs/06, docs/09, docs/11, tests, harness, source, runtime, OpenClaw, or provider work changed.*

*Pass 4.9D-2M status sync: Updated header status line (23 cases/253 files; sixth batch noted — Pass 4.9D-2L/2L.1, CLEAN_WITH_NOTES); Section 7.1 Class A/B Input Strictness (added seed fixture note: deterministic-only-false-defaulted; present selector-policy normalization vs missing-file distinction noted); Section 7.2 Registry Validation and Quarantine (added seed fixture note: quarantine-excluded-from-candidates; warning-code ambiguity note added); Section 7.12 Injection Gate (added seed fixture note: fail-open-all; gate conversion fields, one-per-run global warning, family-confidence non-escalation noted); Section 10 current-status blurb (updated to Pass 4.9D-2M; listed all new completed passes 4.9D-2K/2K.1/2L/2L.1/2M; active next pass changed to 4.9D-2N pending user approval) and pass table (added 4.9D-2K/2K.1/2L/2L.1/2M completed rows; added 4.9D-2N as active next pass); Section 11 fixture rows (added sixth-batch row; updated combined to 23 cases/253 files with full batch inventory including sixth batch; active next pass changed to 4.9D-2N); Section 11 invariant list (added 8 sixth-batch invariant bullets: quarantine exclusion, quarantine_boundary_violation absence, deterministicOnly false normalization vs missing-file, fail_open_all conversion, one-per-run global warning, quarantine warning-code deferred, unknown-cost-classification deferred); recommended next pass changed to 4.9D-2N. No schema files, fixture files, docs/04, docs/05, docs/06, docs/09, docs/11, tests, harness, source, runtime, OpenClaw, or provider work changed.*

*Pass 4.9D-2P status sync: Updated header status line (25 cases/275 files; seventh batch noted — Pass 4.9D-2O/2O.1, CLEAN_WITH_OUT_OF_SCOPE_FOLLOW_UP; old fixture 17 narrative repair noted — Pass 4.9D-2O.2/2O.3); Section 7.5 Selector Ladder (added seed fixture note: required-when-match; requiredWhen match, no-conflict include, noConflictComponentIds membership, gap-check denominator noted); Section 7.17 Trace Keyed Phase (expanded seed fixture note to include narrative repair history — Pass 4.9D-2O.2/2O.3); Section 7.18 Summary Narrative (added seed fixture note: deterministic-narrative-template; canonical template, count-derived only, no raw content, no model prose, no expected/summary.md noted); Section 10 current-status blurb (updated to Pass 4.9D-2P; listed all new completed passes 4.9D-2O/2O.1/2O.2/2O.3/2P; active next pass changed to 4.9D-2Q pending user approval) and pass table (4.9D-2M row updated from this-pass to completed; 4.9D-2N row updated from active to completed; added 4.9D-2O/2O.1/2O.2/2O.3/2P completed rows; added 4.9D-2Q as active next pass); Section 11 fixture rows (added seventh-batch row, narrative repair row; updated combined to 25 cases/275 files with seventh batch in inventory; active next pass changed to 4.9D-2Q); Section 11 invariant list (added 6 seventh-batch bullets: requiredWhen match no-conflict include, narrative canonical template, narrative no raw content, no expected/summary.md without approved shape, fixture 17 repair resolved); recommended next pass changed to 4.9D-2Q. No schema files, fixture files, docs/04, docs/05, docs/06, docs/09, docs/11, tests, harness, source, runtime, OpenClaw, or provider work changed.*

*Pass 4.9D-2U.R1.1 normative contradiction repair: docs/06 §17.3.1 behavior bullets replaced — removed unconditional "must upgrade to include/fail_open" bullets for Branch C cases (type: policy, type: output_format, history-durable); replaced with explicit staged three-branch rule: Branch A (hard-protection — unreachable as pre-gate omit), Branch B (riskLevel: high — omit-gate blocked, falls to Step 11 fail-open), Branch C (type: policy with low/medium risk, history-durable without hard-protection metadata — genuinely deferred; no current mandatory upgrade behavior and no current mandatory allow; three resolution paths listed). docs/06 §17 policy table and §7.7 cross-reference note updated. docs/12 §7.12 and §11 updated to mirror. No schema files, fixture files, docs/04, docs/05, docs/09, docs/11, docs/13, tests, harness, source, runtime, OpenClaw, or provider work changed.*

*Pass 4.9D-2U.R1.2 missed normative sections repair: docs/06 §3 overview policy table (line 300) updated — replaced "safety/policy/history-durable omit upgraded to include/fail_open" with Branch A/B/C-aware summary. docs/06 §17.4 Ladder Interaction pseudocode updated — replaced unconditional warn_and_continue override block with Branch A/B/C NOTE annotations (injection_suspect_policy_override NOT fired in standard MVP). docs/06 §17.5 Per-Selector Effect Summary table updated — history/memory/policy/output_format rows all updated to Branch A/B/C three-branch structure. docs/12 §10 blurb, pass table, and footer updated. No schema files, fixture files, docs/04, docs/05, docs/09, docs/11, docs/13, tests, harness, source, runtime, OpenClaw, or provider work changed.*

*Pass 4.9D-2U.R1.3 stale active §17.7 harness check repair: docs/06 §17.7 table — replaced "Safety/policy omit not overridden under warn_and_continue" row with Branch A/B/C-aware harness check: Branch A (riskLevel: critical, retainPolicy: safety_critical/mandatory, omissionPolicy: never) producing action:omit is a hard-protection/Step 3 ladder failure; Branch B (riskLevel: high) producing action:omit is an omit-gate failure; neither is an injection-gate override defect; Branch C (type: policy low/medium risk — unresolved) — no MVP harness check may assert mandatory upgrade or allow; injection_suspect_policy_override must not be expected or required by any MVP harness check. Replaced "High-risk output_format omit not overridden under warn_and_continue" row with Branch A/B reachability-aware check: riskLevel: critical output_format is Branch A (Step 3, cannot arrive as omit); riskLevel: high output_format is Branch B (omit-gate blocked, Step 11 fail-open); action:omit for either is a ladder/omit-gate failure, not missing injection-gate override; no injection_suspect_policy_override expected for output_format in standard MVP (18-Q1 resolved, Pass 4.8C). docs/06 §18 (struck-through resolved questions) and §19 (completed DoD checklist) left untouched as historical records. docs/12 §10 blurb updated to Pass 4.9D-2U.R1.3; pass table: R1.2 row marked superseded; R1.2-CHECK2 and R1.3 rows added (completed this pass). No schema files, fixture files, docs/04, docs/05, docs/09, docs/11, docs/13, tests, harness, source, runtime, OpenClaw, or provider work changed.*

