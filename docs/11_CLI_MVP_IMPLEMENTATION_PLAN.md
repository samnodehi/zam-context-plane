# 11 CLI MVP Implementation Plan

> **Status:** Accepted — All phases (0–12) implemented and tested. Gate B: `SATISFIED WITH 1 APPROVED SKIP(S)`. Full suite: 651/651. Evaluate: `passed=27 failed=0 skipped=1 blocked=0 EXIT:0`. All MVP schema batches (A/B/C/D) are created and accepted — see `docs/12` for schema inventory.
> **Source verdict:** `docs/09_IMPLEMENTATION_READINESS_AUDIT.md` Pass 4.8F — `READY_FOR_IMPLEMENTATION_PLAN`
> **Code implementation:** Complete. All phases (0–12) implemented and tested. Phase 13 final acceptance checklist closed.
> **Schema files:** All MVP schema batches created and accepted — Batch A (shared), Batch B (inputs + extension), Batch C (internal data objects), Batch D (output files). No remaining schema batch is pending.
> **Runtime / OpenClaw / provider work:** Untouched. Gate D intentionally out of MVP scope — blocked by design.
> **Scope:** Planning and status record.

---

## 1. Purpose and Scope

This document is the authorized implementation plan for the **Portable Context Control Plane CLI MVP**, following the `READY_FOR_IMPLEMENTATION_PLAN` verdict recorded in `docs/09_IMPLEMENTATION_READINESS_AUDIT.md` Pass 4.8F.

**What this plan covers:**

- A single file-in / file-out CLI tool that reads operator-supplied JSON and text files, applies deterministic selector logic, and writes three output files: `prompt-plan.json`, `trace.json`, and `summary.md`.
- Implementation sequence across 14 phases (Phase 0–13), covering registry loading, request normalization, selector fan-out, gap-check, injection gate, conflict resolution, budgeting, plan generation, trace assembly, and evaluation harness.
- Data model build order, canonical spec references, and minimum acceptance checks per phase.

**What this plan does not cover (deferred):**

- CLI MVP code implementation was completed after user approval of this plan. Future source changes require separate explicit approval.
- JSON Schema file generation (Gate A — all MVP schema batches A/B/C/D are created and accepted; Gate A schema work is separate from CLI code implementation).
- OpenClaw adapter, n8n adapter, Telegram adapter (Gate D — intentionally out of MVP scope; blocked by design).
- Any provider or model call.

**Source authorizations:**

| Authorization | Source |
|---|---|
| Plan creation authorized | `docs/09` Pass 4.8F — `READY_FOR_IMPLEMENTATION_PLAN` |
| Gate A (schema) | 🟢 Ready — separate pass |
| Gate B (harness) | 🟢 Ready — Phase 12 of this plan |
| Gate C (CLI MVP) | 🟢 Ready — this document |
| Gate D (adapters) | 🔴 Blocked — not MVP |

---

## 2. Non-Goals

The following are explicitly out of scope for the CLI MVP and must not be implemented during any phase covered by this plan:

| Non-goal | Rationale / canonical ref |
|---|---|
| OpenClaw adapter | Adapter boundary — `docs/04` §5; `PROJECT_MASTER_PLAN.md` §3 |
| n8n / Telegram / generic-API adapters | Same adapter boundary |
| Live provider or model calls | MVP offline invariant — `docs/04` §4 Goal 7 |
| Model-assisted selectors | Deterministic only in MVP — `docs/06` §8 MVP version note |
| Runtime prompt mutation | Prohibited — `PROJECT_MASTER_PLAN.md` §4 |
| JSON Schema generation | Gate A is separate from CLI implementation. All MVP schema batches A/B/C/D are created and accepted (Batch A shared, Batch B inputs + extension, Batch C internal data objects, Batch D output files). No remaining schema-generation work is required before AC-01. |
| Provider-specific prompt cache implementation | Advisory PPG ordering only; no new schema fields; cannot alter membership |
| `capabilityTimestamp` / `capabilityVersion` versioning | Safe-defer 5-Q3 / F-26; non-MVP per `docs/06` §2.5 |
| Dedicated `action: unavailable` | Safe-defer 5-Q7 / F-28; `action: defer + path: runtime_unavailable` is MVP form |
| `unknownId` separate field | Safe-defer 5-Q4; `componentId` carries unknown string in MVP |
| Session-derived `userConstraints` trust levels | Safe-defer 5-Q5; operator-supplied CLI input is high-trust in MVP |
| Harness model-generated narrative | `selectorSummary.narrative` is deterministic template only — `docs/06` §3.6 |
| CLI MVP code implementation | CLI MVP (Phases 0–12) was completed after user approval of this plan. Unapproved future implementation changes are out of scope. |

---

## 3. Planned CLI Contract

> **Planning level only.** No JSON Schema syntax. No implementation. This section describes the intended invocation shape and behavior for implementation reference.

### 3.1 Command Shape

```
context-plane plan \
  --request    <path>   # request text file (plain text) — Class A
  --registry   <path>   # component registry JSON — Class A
  [--active-ids        <path>]  # active IDs JSON — Class B
  [--runtime           <path>]  # runtime capabilities JSON — Class B
  [--history           <path>]  # history state JSON — Class B
  [--budget            <path>]  # budget state JSON — Class B
  [--constraints       <path>]  # user constraints JSON — Class B
  [--policy            <path>]  # selector policy JSON — Class B
  [--request-signals   <path>]  # pre-normalized request signals JSON — Class B; absent = MVP safe default normalization; present = bypasses stub and supplies promptFamily/familyConfidence/injectionSuspect
  [--output-dir        <path>]  # output directory (default: working directory)
```

### 3.2 Output Files

All three output files are written to `--output-dir` (default: current working directory):

| File | Description |
|---|---|
| `prompt-plan.json` | Structured prompt plan: selected, omitted, deferred components; budget plan; risk flags |
| `trace.json` | Keyed phase object: full decision trace per phase |
| `summary.md` | Human-readable narrative: deterministic template; budget summary; risk flags |

### 3.3 Exit Behavior

| Condition | Exit behavior |
|---|---|
| Successful plan produced | Exit 0 |
| Class A input missing or malformed | Exit non-zero; no output files written; error to stderr |
| Class B input missing or malformed | Exit 0; planning warning emitted; fail-open behavior applied |
| Budget overflow (safety-critical cannot be trimmed) | Exit 0; `budgetOverflow: true` in output; plan still written |
| Unsupported `candidateSetPolicy` value | Exit non-zero with `unsupported_candidate_set_policy` |

### 3.4 Determinism Invariant

Given identical input files, the CLI must always produce byte-identical output files. No randomness. No timestamps in deterministic fields. No model calls.

---

## 4. Input and Output Files

### 4.1 Inputs

| Input | CLI flag | Class | Fallback if absent / malformed |
|---|---|---|---|
| Request text | `--request` | **A** | Halt — no safe fallback |
| Component registry | `--registry` | **A** | Halt — no safe fallback |
| Prompt family (derived from request) | — (derived) | A* | Safe substitution: `general_default` + warning; no halt if `requestSignals` otherwise valid |
| Active IDs | `--active-ids` | **B** | Treat `activeSkillIds`, `activeToolIds`, `activeMemoryIds` as empty `[]`; selectors receive no active-ID signals; emit `active_ids_missing` warning only if field present but malformed |
| Runtime capabilities | `--runtime` | **B** | `capabilityInventoryComplete: false`; all tools unknown; include all; `runtime_capabilities_missing` warning |
| History state | `--history` | **B** | All history components uncertain; include `riskLevel: high` / non-optional; `history_summary_missing` warning |
| Budget state | `--budget` | **B** | Unconstrained; budget-aware but not budget-enforcing; `budget_config_missing` warning |
| User constraints | `--constraints` | **B** | No constraints applied; `user_constraints_missing` warning only if field present but malformed |
| Selector policy | `--policy` | **B** | Safe defaults: `failOpenThreshold: 0.7`, `deterministicOnly: true`, `injectionSuspectAction: "warn_and_continue"`; `selector_policy_defaulted` warning |
| Request signals | `--request-signals` | **B** | Absent or malformed: falls back to MVP safe default normalization — `promptFamily=general_default`, `familyConfidence=0.0`, `injectionSuspect=false`; `request_signals_defaulted` warning emitted. Present and valid: bypasses default stub and supplies `promptFamily`, `familyConfidence`, and `injectionSuspect` directly, enabling harness fixtures to exercise specific signal combinations. |

**Active IDs note:** `--active-ids` supplies `activeSkillIds`, `activeToolIds`, and `activeMemoryIds`. These are validated at the core boundary/orchestrator before selector fan-out. Unknown active IDs (IDs not present in `componentsById`) produce `active_id_unknown` planning warnings per unknown ID. Unknown active IDs do **not** produce `reference_unknown` SelectionDecision records — the distinction is enforced by the orchestrator boundary (15-Q2 resolved, `docs/06` §2 optional selector signals). Canonical: `docs/06` §2; 15-Q2 Pass 4.8B.

*Class A hard-required means halt on absent/unrecoverable. Safe-fallback substitution (e.g. `general_default` for prompt family) does not halt. Canonical detail: `docs/06` §2.*

### 4.2 Outputs

| File | Key top-level fields | Canonical spec |
|---|---|---|
| `prompt-plan.json` | `schemaVersion`, `promptFamily`, `selectedComponents[]`, `omittedComponents[]`, `deferredComponents[]` (each entry requires `path` field), `budgetPlan`, `estimatedTokens`, `riskFlags[]`, `failOpenReasons[]`, `planningWarnings[]`, `budgetHintSummary` (optional, PPG output only) | `docs/04` §7.7; `docs/06` §3, §27 |
| `trace.json` | Keyed phase object — canonical 8 required keys: `run`, `requestPhase`, `registryPhase` (includes `candidateSetSummary`), `selectorPhase` (includes `selectorTrace[]`), `conflictPhase` (includes `conflictResolutionTrace`), `budgetPhase`, `planPhase`, `warnings`. **No top-level `injectionGatePhase` exists.** Injection-gate trace data belongs in canonical selector/conflict/warnings trace locations per `docs/04` §7.8, `docs/12` §5.2, and `docs/06` §17. | `docs/04` §7.8; `docs/06` §3.1, §3.2 |
| `summary.md` | Deterministic narrative from `selectorSummary.narrative` template; budget summary; risk flags; no raw component content or raw history content | `docs/06` §3.6; `docs/04` §7.8 |

**Key invariants:**

- `deferredComponents[]` entries **must** carry a `path` field (e.g. `runtime_unavailable`, `default_defer`) — harness filters on `path`, not `action`. Canonical: `docs/06` §4; `docs/04` §7.7.
- `budgetHintSummary` is computed by the Prompt Plan Generator **after** receiving `BudgetReport` — the Budgeter does not consume it. Canonical: `docs/06` §27; F-19.
- No raw component text or raw history content in `trace.json` — hash/ref only.
- Cache-aware ordering of `selectedComponents[]` is advisory only — must never alter list membership or authorize omission.
- `candidateSetSummary` must be emitted in `registryPhase` before selector fan-out begins. MVP value: `candidateSetPolicy: "all_non_quarantined"`. Canonical: `docs/06` §3.1.

---

## 5. Internal Module / Data Model Build Order

Modules are listed in dependency order. Each module must be implemented and unit-tested before downstream modules begin.

| Build order | Data object / model | Canonical owner |
|---|---|---|
| 1 | Registry indexes (`registryIndexes`, `componentsById`, `quarantinedComponents`) | `docs/05` §3, §8; `docs/04` §7.1 |
| 2 | Candidate set / `candidateSetSummary` (`candidateSetPolicy`, `candidateSetSize`, `quarantinedExcluded`) | `docs/06` §3.1 |
| 3 | `SelectionDecision` (10 required core fields per `docs/06` §4: `componentId`, `selectorName`, `action`, `reason`, `path`, `confidence`, `evidence[]`, `constraintsApplied`, `warnings`, `traceRefs`). `budgetHint` and related budget annotation fields (`budgetReason`, `tokensApproxObserved`, `budgetPriorityObserved`, `budgetCriticalObserved`, `budgetWarningCodes`) may appear only as **optional** informational annotations per `docs/06` §20.4 — they are not among the 10 required core fields. | `docs/06` §4 (canonical owner) |
| 4 | `selectorTrace` (array of `TraceEntry` objects, embedded in `trace.json` under `selectorPhase.selectorTrace`; `TraceEntry` objects reference `SelectionDecision` records via `decisionId`, while `SelectionDecision.traceRefs[]` points back to trace entries — two distinct companion object types with a bi-directional reference, not a single merged type) | `docs/06` §3.2; `docs/04` §7.8 |
| 5 | `selectorSummary` (count fields + deterministic `narrative` string) | `docs/06` §3.6 |
| 6 | `planningWarnings` (array of warning objects, keyed by warning code) | `docs/06` §3.4 |
| 7 | `ResolvedSelectionDecision` (resolved shape post-Conflict Resolver; carries `resolutionRule`, `losingDecisions`, `conflictType`, optional gate-conversion fields; `budgetHint` and related budget fields survive per `docs/06` §27 merge rules when set on any input decision — these are the records consumed by the Budgeter, not raw `SelectionDecision` records) | `docs/06` §11, §27 (canonical owner) |
| 8 | `conflictResolutionTrace` (one entry per actual conflict; 8 required fields + 4 optional gate-conversion fields) | `docs/06` §11 |
| 9a | `noConflictComponentIds` — **separate `string[]`** output of the Conflict Resolver; one entry per component with a single unambiguous decision; accounting invariant: `noConflictComponentIds.length + conflictResolutionTrace.length = candidateSetSummary.candidateSetSize`; **not embedded inside `conflictSummary`** | `docs/06` §11.3.2 |
| 9b | `conflictSummary` — counts/invariants object only: `totalComponents` (tied to `candidateSetSummary.candidateSetSize`), `noConflict` count (must equal `noConflictComponentIds.length`), `resolvedConflicts`, `failOpenResolutions`, `unresolvedConflictWarnings`, `narrative` (freeform, harness must not parse); `noConflictComponentIds[]` array is separate — see row 9a; no `byPriority` breakdown in MVP (12-Q5 safe-defer) | `docs/06` §11.3.4 |
| 10 | `BudgetReport` (`budgetPlan`, `trimOrder`, `budgetOverflow`, `over_budget_protected` warnings, `budgetHint` interpretation results) | `docs/04` §7.5; `docs/06` §20, §23, §25, §27 |
| 11 | Prompt plan object (`prompt-plan.json` top-level shape; `budgetHintSummary` computed last by PPG after BudgetReport received) | `docs/04` §7.7; `docs/06` §27 |
| 12 | Trace phase object (`trace.json` keyed phase structure; all phase keys required) | `docs/04` §7.8; `docs/06` §3.2 |

**Canonical ownership reminder:**
- `SelectionDecision` shape: `docs/06` §4 only — do not redefine in architecture or implementation code.
- `ResolvedSelectionDecision` shape: `docs/06` §11 / §27 only.
- Registry field semantics: `docs/05` §3–§8 only.
- `budgetHint` values (5 canonical): `docs/06` §20 / §27.

---

## 6. Implementation Phase Table

> Phases 0–13. Each phase has a defined entry gate, minimum acceptance checks, and canonical spec references. **No phase may begin before its entry gate is satisfied.** Code implementation of any phase is prohibited until this plan is reviewed and approved.

| Phase | Purpose | Entry gate | Key inputs | Key outputs | Canonical spec refs | Minimum acceptance checks |
|---|---|---|---|---|---|---|
| **0** | Repo layout and CLI skeleton planning | Plan approved by user | — | Directory structure; CLI entrypoint stub; test runner configured; fixture directory created | `PROJECT_MASTER_PLAN.md` §6; `docs/04` §4 | Repo layout matches planned structure; CLI invokes without error on `--help`; no provider calls reachable |
| **1** | Input loading and validation boundaries | Phase 0 done | All CLI flags | Validated input objects; Class A halt on missing/malformed; Class B fallback with warning | `docs/06` §2 (Class A/B table) | Class A missing → non-zero exit; Class B missing → exit 0 + warning in `trace.json`; selector policy defaults applied correctly |
| **2** | Registry loading, indexing, and quarantine | Phase 1 done | `registry.json` | `registryIndexes`, `componentsById`, `quarantinedComponents`; `registryPhase` trace | `docs/04` §7.1; `docs/05` §3, §8 | Malformed low-risk → quarantine + warning; malformed safety-critical → halt; duplicate ID → reject second + warning; unknown reference → `reference_unknown` trace entry |
| **3** | Request / runtime / history / userConstraints / active-IDs normalization | Phase 2 done | `--request`, `--active-ids`, `--runtime`, `--history`, `--constraints`, `--request-signals` | `requestSignals` (including `injectionSuspect: boolean`, `promptFamily`, `familyConfidence`); `historyStateSummary`; `runtimeCapabilities`; `userConstraints`; normalized active ID arrays (`activeSkillIds`, `activeToolIds`, `activeMemoryIds`); unknown active IDs produce `active_id_unknown` warning (not `reference_unknown`) | `docs/06` §2.1–§2.8; `docs/04` §7.2 | All prompt families reachable; `injectionSuspect` boolean produced; `historyMalformed` flag produced when applicable; active ID arrays validated at boundary; Class B fallbacks applied with warnings; `--request-signals` absent/malformed falls back to `general_default`/`0.0`/`false` with `request_signals_defaulted` warning |
| **4** | Candidate set construction and `candidateSetSummary` | Phase 3 done | `registryIndexes`, `quarantinedComponents` | `candidateSetSummary` (`candidateSetPolicy: "all_non_quarantined"`, `candidateSetSize`, `quarantinedExcluded`); emitted in `registryPhase` before fan-out | `docs/06` §3.1 | `candidateSetSummary` present in `registryPhase` before any `SelectionDecision` is produced; `candidateSetSize` matches non-quarantined count; unsupported policy → halt with `unsupported_candidate_set_policy` |
| **5** | Selector fan-out and deterministic ladder | Phase 4 done | Candidate set; `requestSignals`; `budgetState`; `selectorPolicy` | `SelectionDecision[]` per selector; 8 selector types applied | `docs/06` §7, §8, §14 | All 12 ladder steps reachable in fixtures; Step 3 always emits `path: safety_override` (never `path: required_match`) for all 4 hard-protection conditions; Path A omit requires `confidence ≥ failOpenThreshold`; Path B omit requires `confidence: high`; no `action: quarantine` produced |
| **6** | Gap-check and synthetic `not_evaluated` | Phase 5 done | `candidateSetSummary.candidateSetSize`; all `SelectionDecision[]` produced | Synthetic `action: include / path: not_evaluated / confidence: low` injected for any unevaluated candidate | `docs/06` §3.1; `docs/04` §6 (Gap-Check node) | Every non-quarantined candidate has ≥ 1 `SelectionDecision`; gap-check synthetic decisions appear in `selectorTrace`; gap-check denominator equals `candidateSetSize` |
| **7** | Injection gate / policy normalization | Phase 5–6 done | `requestSignals.injectionSuspect`; `selectorPolicy.injectionSuspectAction`; `familyConfidence`; all `SelectionDecision[]` | Post-gate `SelectionDecision[]` with any policy-override upgrades applied; exactly-one global injection warning per run emitted by orchestrator | `docs/06` §17 | 17 injection harness checks pass; `warn_and_continue` preserves ordinary allowed Path A/B omits and annotates them with `injection_suspect_omit_allowed`; Branch A hard-protection components cannot arrive at the gate as `action: omit` (Step 3 includes them before the gate fires); Branch B high-risk components fall to Step 11 fail-open include before the gate (omit-gate blocked); Branch C (low/medium policy / history-durable without hard-protection metadata) remains explicitly deferred in MVP — implementation must not fire `injection_suspect_policy_override`; `fail_open_all` suppresses all Path A and Path B omits and converts them to `include / fail_open` with original action/path preserved in trace; `halt_planning` recognized as reserved future value — `policy_value_not_implemented` warning + `warn_and_continue` effective policy applied; unknown `injectionSuspectAction` value → `injection_action_unknown` + `warn_and_continue` fallback; `familyConfidence` escalation rule applied when `injectionSuspect: true` and `familyConfidence < failOpenThreshold`; global warning emitted exactly once by orchestrator (not by individual selectors) |
| **8** | Conflict resolution | Phase 7 done | All post-gate `SelectionDecision[]` | `ResolvedSelectionDecision[]`; `conflictResolutionTrace`; `conflictSummary`; `noConflictComponentIds` | `docs/06` §11 | 16 conflict harness checks pass; 12 conflict cases covered; `resolutionRule` values are strict enum (14 canonical values per §11.3.1a); `losingDecisions` contains only true losers; `multiple_include_merged` cannot hide hard protection; `history_malformed_fail_open` handled as Case 12 |
| **9** | Budgeter | Phase 8 done | `ResolvedSelectionDecision[]` (read-only); `budgetState` | `BudgetReport` (`budgetPlan`, `trimOrder`, `budgetOverflow`, `over_budget_protected` warnings) | `docs/04` §7.5; `docs/06` §20, §23, §25, §27 | Budgeter reads `ResolvedSelectionDecision[]` as read-only — no mutation; 5 canonical `budgetHint` values only; `expensive_optional` threshold 500 tokens static MVP — 10 harness checks; `over_budget_protected` warn-only — 7 harness checks; `safety_critical` components never trimmed; `budgetOverflow: true` when they cannot fit |
| **10** | Prompt Plan Generator | Phase 9 done | `ResolvedSelectionDecision[]`; `BudgetReport`; `historyStateSummary` | `prompt-plan.json`; `budgetHintSummary` computed last (optional, PPG output only) | `docs/04` §7.7; `docs/06` §27 | `deferredComponents[]` entries carry `path` field; `budgetHintSummary` computed after `BudgetReport` received — not before; cache-aware ordering is advisory only — does not alter list membership; 7 `budgetHint` survival harness checks |
| **11** | Trace and summary assembly | Phase 10 done | All phase outputs | `trace.json` (all required phase keys present); `summary.md` (deterministic narrative template) | `docs/04` §7.8; `docs/06` §3.2, §3.6 | All keyed phase keys present in `trace.json`; `selectorTrace` embedded under `selectorPhase.selectorTrace`; no raw component content or raw history content in `trace.json`; `summary.md` narrative matches deterministic template from `selectorSummary` counts; 5 `candidateSetSummary` harness checks |
| **12** | Evaluation harness and fixtures | Phase 11 done | Fixture input files (`fixtures/` directory) | Machine-readable evaluation JSON report; zero-tolerance check results | `docs/04` §7.9; `PROJECT_MASTER_PLAN.md` §13 | Zero-tolerance checks: 0 unsafe omissions, 0 schema-invalid outputs, 0 raw content in `trace.json`, 0 untraced decisions, 0 unresolved conflicts without fail-open, 0 silent budget overflow; 9 named fixture scenarios covered (simple greeting, basic coding, security checklist, heartbeat/proactive, group chat, multiturn history-sensitive, tool-required, ambiguous request, injection attempt); harness exits non-zero on any violation |
| **13** | Final CLI acceptance checklist | Phase 12 done | All phase outputs; harness report | Acceptance sign-off checklist | All specs | All zero-tolerance checks pass; determinism verified (same inputs → same outputs on repeat runs); Class A/B boundary verified; no unsafe omission paths reachable; all 8 selector types exercised; Phase 0–12 entry/exit gates all satisfied |

---

## 7. Selector Plan

### 7.1 Principles

All 8 MVP selectors share the same operational constraints:

| Constraint | Rule |
|---|---|
| Deterministic only | No model or provider calls in MVP. Pattern matching against registry metadata only. |
| Read-only registry | Selectors never mutate `componentsById`, `registryIndexes`, or any component field during a planning run. |
| One primary selector per component | Each component has exactly one canonical `type`. The primary selector for that type is the sole evaluator. Multi-role components are resolved at registry authoring time — not at runtime. |
| No inter-selector handoff | A selector does not delegate to or call another selector. Fan-out is orchestrator-managed. |
| Fail-open by default | Any component without a clear `omit` decision defaults to `include`. Uncertainty resolves to inclusion. |
| Single `SelectionDecision` per candidate | Each selector produces one `SelectionDecision` per candidate component it evaluates. Multiple selectors may evaluate the same component; all decisions are preserved for the Conflict Resolver. |

### 7.2 Selector Types and `selectorName` Constants

| Selector | `selectorName` constant | Primary `type` value | Key signal inputs |
|---|---|---|---|
| Scaffold selector | `deterministic_scaffold` | `scaffold` | `promptFamily`, `requiredWhen`, `safeToOmitWhen`, `riskLevel`, `retainPolicy` |
| Skill selector | `deterministic_skill` | `skill` | `promptFamily`, `activeSkillIds`, `requiredWhen`, `safeToOmitWhen` |
| Tool selector | `deterministic_tool` | `tool` | `runtimeCapabilities`, `activeToolIds`, `requiredWhen`; pre-check: runtime availability before Step 3 |
| History selector | `deterministic_history` | `history` | `historyStateSummary`, `promptFamily`, `turnRetentionPolicy` |
| Memory selector | `deterministic_memory` | `memory` | `promptFamily`, `activeMemoryIds`, `requiredWhen` |
| Policy selector | `deterministic_policy` | `policy` | `promptFamily`, `riskLevel`, `retainPolicy` — hard-protected by default |
| Output format selector | `deterministic_output_format` | `output_format` | `outputFormatHint`, `promptFamily`; high-risk bias under injection-suspect gate |
| Runtime capability selector | `deterministic_runtime_capability` | `runtime_capability` | `runtimeCapabilities.capabilityInventoryComplete`, `requiredWhen` |

### 7.3 Deterministic Ladder — Implementation Note

> **Canonical owner: `docs/06_SELECTOR_ORCHESTRATION_SPEC.md` §8.** The full 12-step ladder with all conditions, trace requirements, and fail-open behaviors is defined there. Implementation must read §8 directly. This plan does **not** duplicate the canonical step table — any table here would be a secondary copy and therefore a potential source of drift.

**Implementation-critical invariants pinned here (all canonical path values from `docs/06` §4 `path` table):**

| Invariant | Canonical path / action |
|---|---|
| Tool selector runtime availability pre-check runs **before** Step 3 | `action: defer`, `path: runtime_unavailable`; simultaneously hard-protected → also emit `hard_protected_tool_unavailable` warning |
| Step 3 hard-protect fires for `retainPolicy: safety_critical`, `retainPolicy: mandatory`, `omissionPolicy: never`, or `riskLevel: critical` | `action: include`, **`path: safety_override`** — unconditionally. `path: required_match` from Step 3 is a harness failure. |
| Quarantine boundary violation (Step 1) | `action: include`, `path: quarantine_boundary_violation`, `confidence: low` — never `action: quarantine` |
| Path A (Step 7) is the only `safe_to_omit_match` omit path | `action: omit`, `path: safe_to_omit_match` |
| Path B (Step 8) is the only `default_action_omit` omit path | `action: omit`, `path: default_action_omit`, `confidence: high` |
| No other step may produce `action: omit` | Any `omit` outside Path A or Path B is a planning error |
| Step 9 — `defaultAction: include` or absent | `action: include`, `path: default_include` |
| Step 10 — `defaultAction: defer` | `action: defer`, `path: default_defer` |
| Step 11 — fail-open (`omissionPolicy: fail_open`, low confidence, invalid `evidenceRequired`, etc.) | `action: include`, `path: fail_open` |
| Step 12 — final fallback (should never be reached) | `action: include`, `path: fail_open`, `reason: ladder_fallback`, + `unexpected_ladder_fallback` warning; harness must flag this as a ladder defect |

**Runtime capability selector note:** Omission fixtures must set `capabilityInventoryComplete: true`. When `capabilityInventoryComplete: false` or capability inventory is missing, the selector must fail open (include). Canonical: `docs/06` §14.8 / 15-Q5 resolved.

---

## 8. Critical Invariants

These invariants are absolute. Any violation is a harness failure or planning error. Implementation must enforce all of them.

| # | Invariant | Canonical ref |
|---|---|---|
| I-01 | **Fail-open safety.** Uncertainty always resolves to `include`. Omit only when evidence is traceable, confidence meets threshold, and the component is marked safe to omit. | `docs/04` §2; `docs/06` §1 |
| I-02 | **Only Path A or Path B can produce `action: omit`.** Any `omit` arising from a different step is a planning error. | `docs/06` §8 ladder invariants |
| I-03 | **Step 3 always emits `path: safety_override`** for all four hard-protection conditions (`retainPolicy: safety_critical`, `retainPolicy: mandatory`, `omissionPolicy: never`, `riskLevel: critical`). `path: required_match` from Step 3 is a harness failure. | `docs/06` §8 Step 3; 9-Q2 resolved |
| I-04 | **`quarantine` is registry-phase state only.** It is not a valid `SelectionDecision.action`. Quarantined components are excluded from `componentsById` before selector fan-out. | `docs/06` §4; `docs/04` §7.3 F-17 |
| I-05 | **`quarantine_boundary_violation` represents a planning error.** If a quarantined component ID appears during selector fan-out, the result is `action: include / path: quarantine_boundary_violation / confidence: low` + `unexpected_quarantine_reference` planning error. | `docs/06` §8 Step 1 |
| I-06 | **`reference_unknown.componentId` is an untrusted caller-supplied string.** It is not a registry-validated ID. Harness must not compare it against `componentsById`. `unknownId` as a separate field is deferred to schema v1.1. | `docs/06` §4; 5-Q4 resolved |
| I-07 | **`candidateSetPolicy` = `"all_non_quarantined"` in MVP.** An unsupported policy value halts the run with `unsupported_candidate_set_policy`. | `docs/06` §3.1; 5-Q8/F-29 resolved |
| I-08 | **Gap-check denominator = `candidateSetSummary.candidateSetSize`.** Every non-quarantined candidate must receive ≥ 1 `SelectionDecision`. Missing decisions are injected synthetically (`action: include / path: not_evaluated / confidence: low`) before the Conflict Resolver runs. | `docs/06` §3.1; `docs/04` §6 |
| I-09 | **`runtime_unavailable` = `action: defer` + `path: runtime_unavailable`.** A dedicated `action: unavailable` is future-only and must not be implemented in MVP. `path` is required on every `deferredComponents[]` entry; harness filters on `path`. | `docs/06` §4; 5-Q7/F-28 resolved |
| I-10 | **Global injection warning emitted exactly once per run by the orchestrator.** Individual selectors emit per-decision `injection_suspect_seen` atoms in `evidence[]` — they do not emit global warnings independently. | `docs/06` §17; F-18/F-21 resolved |
| I-11 | **Budgeter does not mutate `ResolvedSelectionDecision` records.** It reads them as read-only and emits a separate `BudgetReport`. Selector and conflict decisions are final before the Budgeter runs. | `docs/04` §7.5 "No mutation invariant" |
| I-12 | **Budgeter trims only `retainPolicy: optional` + `omissionPolicy: allow` + `riskLevel: low/medium` components.** `omissionPolicy: fail_open` components are not trimmed in MVP. Budget pressure is not a valid omission path. | `docs/04` §7.5 MVP trim rule |
| I-13 | **PPG does not reinterpret `budgetHint` values.** Only the 5 canonical values defined in `docs/06` §20/§27 are valid. The PPG surfaces `BudgetReport` fields in plan output; it does not override Budgeter trim decisions. | `docs/04` §7.5; `docs/06` §27 |
| I-14 | **`budgetHintSummary` is PPG output only, computed after `BudgetReport` is received.** The Budgeter does not consume it. Computed last, not before `BudgetReport`. | `docs/06` §27; F-19 resolved |
| I-15 | **Cache-aware ordering of `selectedComponents[]` is advisory only.** It must never alter list membership, authorize omission, or introduce non-determinism. The ordering hint is a PPG convenience; it cannot affect component selection outcomes. | `docs/04` §7.7 ordering invariants |
| I-16 | **No raw component text or raw history content in `trace.json`.** Hash and ref only. Content must not appear in evaluation logs or CI artifacts. | `docs/04` §7.8; `docs/04` §7.6 |
| I-17 | **Agents and developers must read current files directly from disk before editing.** No reliance on same-name uploaded-file memory, prior cached context, or in-session summaries as a substitute for live file content. | Workspace rules |

---

## 9. Evaluation Harness Planning

> This section plans fixture coverage groups. No tests are created here. Fixture files and harness code are Phase 12 of the implementation sequence (§6).

### 9.1 Zero-Tolerance Checks (any failure = non-zero exit)

| Check | Violation condition |
|---|---|
| No unsafe omissions | Any component omitted without a valid Path A or Path B decision |
| No schema-invalid outputs | Any output file fails structural validation |
| No raw content in `trace.json` | Any turn content or component content appears unredacted in trace |
| No untraced decisions | Any `SelectionDecision` absent from `selectorTrace` |
| No unresolved conflicts without fail-open | Any conflict that produced no `ResolvedSelectionDecision` |
| No silent budget overflow | `budgetOverflow: true` not set when protected components exceed budget |

### 9.2 Fixture Groups

| Group | What it covers | Key invariants exercised |
|---|---|---|
| **Registry / quarantine** | Valid registry load; malformed low-risk quarantine; malformed safety-critical halt; duplicate ID rejection; unknown reference `reference_unknown` trace entry | I-04, I-05, I-06 |
| **Input strictness (Class A/B)** | Class A missing → halt; Class B missing → exit 0 + warning; all Class B defaults applied correctly | §4.1; `docs/06` §2 |
| **Candidate set / gap-check** | `candidateSetSummary` present before fan-out; `candidateSetSize` correct; unsupported policy halts; every candidate has ≥ 1 decision; synthetic `not_evaluated` injected; denominator = `candidateSetSize` | I-07, I-08; 5 harness checks |
| **Selector ladder** | All 12 steps reachable; ladder stops at first match; no step skipped silently | §7.3 |
| **Path A / Path B** | Path A: `safeToOmitWhen` match + evidence atoms + `confidence ≥ failOpenThreshold`; `path_a_null_evidence` warning when `evidenceRequired: null`; Path B: all 7 conditions; `confidence: high` required | I-01, I-02; 9-Q4, 9-Q5 resolved |
| **Step 3 hard protection** | All 4 hard-protection conditions → `path: safety_override`; `path: required_match` from Step 3 is harness failure | I-03; 9-Q2 resolved |
| **`reference_unknown`** | Unknown component ID → `action: reference_unknown`; `componentId` carries caller string; not subtracted from `candidateSetSize` denominator; harness must not compare against `componentsById` | I-06; 5-Q4 resolved |
| **`runtime_unavailable`** | Tool unavailable when `capabilityInventoryComplete: true` → `action: defer / path: runtime_unavailable`; `path` field present on every `deferredComponents[]` entry; `hard_protected_tool_unavailable` warning when applicable | I-09; 5-Q7/F-28 resolved |
| **Injection gate — 17 checks** | `warn_and_continue` preserves ordinary allowed Path A/B omits and annotates them with `injection_suspect_omit_allowed`; Branch A hard-protection components cannot reach the gate as `action: omit` (Step 3 includes them first); Branch B high-risk components fall to Step 11 fail-open include before the gate (omit-gate blocked); Branch C (low/medium policy / history-durable without hard-protection metadata) remains explicitly deferred in MVP — fixtures must not expect `injection_suspect_policy_override`; low/medium `output_format` remains non-override behavior; `fail_open_all` suppresses all Path A and Path B omits; `familyConfidence < failOpenThreshold` + `injectionSuspect: true` → escalate to `fail_open_all`; global warning exactly once by orchestrator | I-10; `docs/06` §17; 18-Q1, 18-Q3 resolved |
| **Conflict resolution — 16 checks** | All 12 conflict cases; 14 canonical `resolutionRule` enum values; `losingDecisions` contains only true losers; `multiple_include_merged` cannot hide hard protection; Case 12 `history_malformed_fail_open` | `docs/06` §11; 9-Q3, 12-Q4 resolved |
| **Budget hints / `expensive_optional` / `over_budget_protected`** | 5 canonical `budgetHint` values; `protected` / `over_budget_protected` never trimmed; `expensive_optional` preferred over `candidate_optional` at equal priority; 500-token static threshold; `unknown_cost` → conservative default + `budget_cost_unknown` warning; `omissionPolicy: fail_open` not trimmed; `budgetOverflow: true` always explicit | I-11–I-14; 10 + 7 + 7 harness checks |
| **Prompt-plan partition** | `selectedComponents[]`, `omittedComponents[]`, `deferredComponents[]` are exhaustive and mutually exclusive; all `deferredComponents[]` entries carry `path` field; `budgetHintSummary` present only after `BudgetReport` received | I-09, I-14; `docs/04` §7.7 |
| **Cache-aware ordering invariants** | Advisory reordering of `selectedComponents[]` does not alter membership; same inputs → same membership regardless of ordering hint; ordering never authorizes omission | I-15; `docs/04` §7.7 ordering invariants |
| **Named fixture scenarios (9)** | simple greeting, basic coding review, security checklist, heartbeat/proactive, group chat, multiturn history-sensitive, tool-required, ambiguous request, prompt-injection attempt | All invariants; `PROJECT_MASTER_PLAN.md` §13 |

### 9.3 Harness Tool

- CLI-invocable: `context-plane evaluate --fixtures <dir> --report <path>`
- Reads fixture input sets from `fixtures/` directory
- Produces machine-readable JSON evaluation report
- Exits non-zero if any zero-tolerance check fails
- Does not call any model or provider

---

## 10. Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| **Schema drift from `docs/06`** — implementation code defines its own `SelectionDecision` or `ResolvedSelectionDecision` shape instead of deriving from canonical spec | High | Implement module contracts directly from `docs/06` §4, §11, §27. Do not reduplicate shape definitions in implementation code or architecture. Run harness field-presence checks against spec shape. |
| **Harness false greens around `capabilityInventoryComplete`** — runtime_capability omission test passes when `capabilityInventoryComplete: false`, masking that fail-open was triggered instead of a genuine omission | High | Omission fixtures must set `capabilityInventoryComplete: true`. Harness must assert this field is `true` before accepting an omit decision as valid for that fixture. Canonical: `docs/06` §14.8 / 15-Q5. |
| **Treating `reference_unknown.componentId` as a validated registry ID** — code incorrectly looks up `componentId` in `componentsById` for `reference_unknown` records | High | Harness asserts `reference_unknown.componentId` is NOT in `componentsById`. `unknownId` as a separate field is deferred to schema v1.1. Canonical: `docs/06` §4; 5-Q4. |
| **Accidentally trimming `omissionPolicy: fail_open` components** — Budgeter treats a fail-open inclusion as trim-eligible under budget pressure | High | MVP trim rule: trim only `retainPolicy: optional` + `omissionPolicy: allow` + `riskLevel: low/medium`. Harness checks that no fail-open component appears in `BudgetReport.droppedComponents`. |
| **Cache-aware ordering changing membership** — PPG advisory ordering accidentally alters `selectedComponents[]` membership or triggers omission decisions | Medium | Ordering is advisory and applied after all membership decisions are final. Harness verifies same membership on identical inputs regardless of ordering hint. |
| **Inventing `budgetHint` values beyond the 5 canonical values** — implementation adds `budgetHint: preserve` or similar unlisted values | Medium | Budgeter code references only `docs/06` §20/§27 table. Harness lints output for unknown `budgetHint` values. PPG must not invent new values. |
| **Injection gate running before ladder completes** — gate fires mid-ladder instead of post-ladder, corrupting Path A/B decisions | Medium | Gate is post-ladder. Implementation sequence enforces ladder → gap-check → injection gate. Verified by 17 injection harness checks. |
| **OpenClaw adapter temptation before CLI proof** — implementation begins adapter work (OpenClaw, n8n, Telegram) before the core CLI is validated | Medium | Gate D is permanently blocked in MVP. Adapter work is prohibited until CLI is proven correct via harness. Any adapter impulse must be documented as a future-pass item. |
| **Stale same-name file / cached context risk** — an agent or developer edits a file based on a prior uploaded-file snapshot or in-session cached summary rather than the current on-disk state | Medium | **Working rule:** Future agents and developers working on this project must read current files directly from disk before editing. Do not rely on same-name uploaded-file memory, prior session context summaries, or in-session cached views as a substitute for live file content. This applies to all implementation passes. |
| **`deferredComponents[]` entries missing `path` field** — deferred components are written without the required `path` field, breaking harness subtype filtering | Low | Required by `docs/04` §7.7. Harness asserts every `deferredComponents[]` entry carries a non-null `path` field. |

---

## 11. Acceptance Criteria Before Coding

No implementation code may be written until all of the following are satisfied:

| # | Criterion | Status |
|---|---|---|
| AC-01 | This plan (`docs/11`) has been reviewed and explicitly approved by the user | ✅ Approved — plan reviewed and explicitly approved by user; all phases (0–12) implemented |
| AC-02 | Schema-generation pass (Gate A) is separately planned and approved | ✅ Confirmed — all MVP schema batches A/B/C/D created and accepted; no remaining schema batch pending (`docs/12` is the Gate A plan; future schema extensions require separate explicit passes) |
| AC-03 | Harness plan is approved (fixture groups confirmed) | ✅ Confirmed — `docs/12` harness fixture groups (§7), Harness Runner Contract (§10), and fixture inventory accepted; 28 fixture cases / 308 files accepted; harness implemented (Phase 12); 651/651 tests pass; Gate B: `SATISFIED WITH 1 APPROVED SKIP(S)` |
| AC-04 | No active spec drift detected between `docs/06`, `docs/04`, `docs/05` and this plan | ✅ Confirmed — all files read from disk in Pass 4.9A-2A/2B |
| AC-05 | No unresolved audit regressions (all `docs/09` findings resolved/reference) | ✅ Confirmed — 0 active open questions; 0 active findings as of Pass 4.8F |
| AC-06 | No OpenClaw / runtime / provider work initiated | ✅ Confirmed — Gate D intentionally out of MVP scope; blocked by design |
| AC-07 | No actual code implementation initiated | ✅ Complete — all phases (0–12) implemented; 651/651 tests pass |
| AC-08 | Selector `selectorName` constants confirmed (all 8 listed in §7.2) | ✅ Confirmed in this document |
| AC-09 | All 12 conflict cases covered in harness plan (§9.2 conflict group) | ✅ Confirmed |
| AC-10 | All 5 canonical `budgetHint` values covered in harness plan (§9.2 budget group) | ✅ Confirmed |
| AC-11 | All 3 active MVP `evidenceRequired` atoms confirmed by `docs/05` §7; not duplicated here to avoid drift from canonical source | ✅ Atoms: `promptFamily=<v>`, `riskLevel=<v>`, `explicitUserConstraint=false` — canonical owner `docs/05` §7 |
| AC-12 | 12-step deterministic ladder reproduced/referenced (§7.3) | ✅ Confirmed |

---

## 12. Final Status

| Item | Value |
|---|---|
| **Plan status** | Accepted — All phases (0–12) implemented. Phase 13 final acceptance checklist closed. |
| **Code implementation** | Complete — all phases (0–12) implemented and tested; 651/651 tests pass. |
| **Schema files** | All MVP schema batches created and accepted: Batch A (shared), Batch B (inputs + Batch B extension), Batch C (internal data objects), Batch D (output files). No remaining schema batch is pending. See `docs/12` for full schema inventory. |
| **Runtime / OpenClaw / provider work** | Untouched. Gate D intentionally out of MVP scope — blocked by design. |
| **Source verdict** | `docs/09` Pass 4.8F — `READY_FOR_IMPLEMENTATION_PLAN` |
| **Active open questions** | 0 (as of `docs/09` Pass 4.8F) |
| **Active audit findings** | 0 (as of `docs/09` Pass 4.8F) |
| **Gate B final status** | `SATISFIED WITH 1 APPROVED SKIP(S)` — `passed=27 failed=0 skipped=1 blocked=0 EXIT:0` |

### Implementation Pass Record

| Pass | Scope | Status |
|---|---|---|
| **User review of this plan** | AC-01 gate | ✅ Complete — plan approved; implementation authorized |
| **Pass 4.9B — Schema / harness planning** | ~~Separately plan JSON Schema file generation (Gate A) and harness spec (Gate B detail)~~ | ✅ Complete — docs/12 written and validated |
| **Pass 4.9C-3 — Batch C schemas** | ~~Create internal data object schemas (`SelectionDecision`, `ResolvedSelectionDecision`, `TraceEntry`, etc.)~~ | ✅ Complete — Pass 4.9C-3S |
| **Pass 4.9C-4+ — remaining schema batches** | ~~Output file schemas (`prompt-plan.json`, `trace.json`), shared enums extension if needed~~ | ✅ Complete — Pass 4.9C-4C.2 + 4.9C-5B.1 |
| **Pass 4.9D-1 — Harness fixture inventory** | ~~Enumerate fixture files, map to `docs/12` §7 groups, define input/output file names~~ | ✅ Complete — 28 fixture cases / 308 files accepted |
| **Pass 5.0 — Phase 0 coding** | Repo layout, CLI skeleton, test runner, fixture directory | ✅ Complete |
| **Phase 1–4 coding** | Input loading, registry, request normalization, candidate set | ✅ Complete |
| **Phase 5–8 coding** | Selector fan-out, ladder, gap-check, injection gate, conflict resolution | ✅ Complete |
| **Phase 9–11 coding** | Budgeter, PPG, trace/summary assembly | ✅ Complete |
| **Phase 12** | Evaluation harness, fixture runs, approved-skip mechanism | ✅ Complete — Gate B satisfied with 1 approved skip |
| **Phase 13** | Final acceptance checklist, docs sync, cleanup | ✅ Complete |

---

*Pass 4.9A-2B: Sections 7–12 appended. Placeholder removed. No source spec docs edited. No code implemented. No schema files created. No runtime/OpenClaw/provider work. Code implementation remains prohibited pending user review and approval.*

*Pass 4.9A-3 validation: Status block updated to reflect Sections 1–12 complete. All 14 validation checks passed. No source spec docs edited. No code/schema/runtime/OpenClaw/provider work.*

*Pass 4.9A-3.1/3.2 cleanup: `--active-ids` input added to §3.1 command shape, §4.1 input table, and §6 Phase 3 row (key inputs and key outputs). §7.3 ladder drift fixed — stale non-canonical path values removed; `docs/06_SELECTOR_ORCHESTRATION_SPEC.md` §8 is now the explicit canonical ladder owner; only invariant-level facts with canonical path values are pinned in this plan. AC-11 updated to reference `docs/05` §7 directly for evidenceRequired atoms, removing the stale §7.3 Path A implication. No source spec docs edited. No code implemented. No schema files created. No runtime/OpenClaw/provider work. Implementation still awaits explicit user review and approval.*

*Pass 4.9C-1C.1 pre-approval cleanup: removed stale `injectionGatePhase` key from §4.2 `trace.json` phase list and replaced with canonical 8 keys plus clarifying note (`docs/04` §7.8 authoritative); corrected §5 row 4 `selectorTrace` description from "array of `SelectionDecision` records" to "array of `TraceEntry` objects" with bi-directional reference note (`docs/06` §3.2 authoritative). No behavioral invariants changed. No source spec docs edited. No code implemented. No schema files created. No runtime/OpenClaw/provider work. Implementation still awaits explicit user approval.*

*Pass 4.9C-1C.2 final pre-approval cleanup: corrected §5 row 3 `SelectionDecision` core field list — restored missing `componentId`, removed `budgetHint` from required fields, added optional-annotation note (`docs/06` §4 and §20.4 authoritative); updated §5 row 7 `ResolvedSelectionDecision` to note `budgetHint` survival per §27 and clarify Budgeter consumes resolved records; split §5 row 9 into rows 9a/9b to make `noConflictComponentIds` a clearly separate `string[]` from `conflictSummary` counts (`docs/06` §11.3.2/§11.3.4 authoritative). No behavioral invariants changed. No source spec docs edited. No code implemented. No schema files created. No runtime/OpenClaw/provider work. Implementation still awaits explicit user approval.*

*Pass 4.9C-2C status sync: Updated §3 header line and §12 status table `Schema files` row — Batch A (shared) and Batch B (inputs) schema files now exist (Pass 4.9C-2A/2B); remaining schema batches (internal data objects, output files) still pending. Code implementation, harness fixtures, and runtime/OpenClaw/provider work remain untouched. No behavioral invariants changed. No canonical spec sections edited. No schema files edited or created.*

*Pass 4.9C-2C.1 correction: Fixed §3 header — removed "before any code or schema work begins" (contradicted by existing Batch A/B schemas); replaced with "before any code implementation begins" with schema-generation-has-begun note. Fixed §1 non-goals — replaced blanket "JSON Schema file generation (Gate A — a separate later pass)" with narrowed "Remaining JSON Schema file generation" noting Batch A/B already created. No canonical spec sections, schema files, source code, tests, fixtures, or OpenClaw/provider work changed.*


*Pass 4.9D-2AL Phase 7 acceptance wording repair (Pass 4.9D-2AK accepted): Replaced stale Phase 7 minimum acceptance check wording in §6 — "warn_and_continue upgrades omit on safety/policy/history-durable components" — with Branch A/B/C-accurate wording per docs/06 §17.3.1, §17.4, §17.5, and §17.7. New wording: warn_and_continue preserves ordinary allowed Path A/B omits with injection_suspect_omit_allowed; Branch A hard-protection components cannot arrive at the gate as action:omit (Step 3 includes them first); Branch B high-risk components fall to Step 11 fail-open before the gate; Branch C remains explicitly deferred in MVP — implementation must not fire injection_suspect_policy_override; fail_open_all, halt_planning fallback, unknown policy fallback, familyConfidence escalation, and global warning dedupe items explicitly stated. No other §6 rows changed. No other sections changed. AC-01 remains pending. Implementation remains prohibited pending user approval. No docs/06, docs/12, docs/13, docs/04, docs/05, docs/09, schemas, fixtures, harness, source, runtime, OpenClaw, or provider files edited.*

*Pass 4.9D-2AL.R1 §9.2 injection-gate fixture-group wording repair (Pass 4.9D-2AL NEEDS_R1): Replaced stale §9.2 Injection Gate fixture group row — "warn_and_continue: upgrades omit on safety/policy/history-durable" and "riskLevel: critical/high output_format omit → include/fail_open + injection_suspect_policy_override" — with Branch A/B/C-accurate wording per docs/06 §17.3.1, §17.4, §17.5, and §17.7. New wording: warn_and_continue preserves ordinary allowed Path A/B omits with injection_suspect_omit_allowed; Branch A/B cannot reach the gate as valid omits; Branch C remains explicitly deferred — fixtures must not expect injection_suspect_policy_override; low/medium output_format remains non-override behavior; fail_open_all, familyConfidence escalation, and global warning dedupe retained. §6 Phase 7 row unchanged. AC-01 remains pending. Implementation remains prohibited pending user approval. No docs/06, docs/12, docs/13, docs/04, docs/05, docs/09, schemas, fixtures, harness, source, runtime, OpenClaw, or provider files edited.*

*Pass 4.9D-2AN docs/11 status sync before AC-01 (Pass 4.9D-2AM accepted): Repaired stale schema-status wording in five locations — header block (lines 3 and 6), §1 Purpose non-goals bullet, §2 Non-Goals table JSON Schema generation row, §12 Final Status Schema files row. All previously said "remaining schema batches pending" or "internal data object schemas and output file schemas are pending"; replaced with accurate wording: all MVP schema batches A/B/C/D (including Batch B extension) are created and accepted, no remaining schema batch is pending. Marked three completed pass rows in §12 Next Recommended Passes as complete: Pass 4.9C-3 (Batch C schemas, Pass 4.9C-3S), Pass 4.9C-4+ (output schemas, Pass 4.9C-4C.2 + 4.9C-5B.1), Pass 4.9D-1 (fixture inventory accepted, 28 cases / 308 files). Full fixture suite not complete; harness code not created; implementation not started; AC-01 remains pending. AC-02 row left unchanged (see rationale: AC-02 criterion is "separately planned and approved"; the schema batches are complete, but AC-02 was not a formally resolved gate criterion — leaving it unchanged avoids inventing a gate sign-off). No docs/06, docs/12, docs/13, docs/04, docs/05, docs/09, schemas, fixtures, harness, source, runtime, OpenClaw, or provider files edited.*

*Pass 4.9D-2AN.R1 AC-table / user-review consistency repair (Pass 4.9D-2AN NEEDS_R1): Resolved contradiction between AC table and User review gate-impact wording. AC-02 updated from ⏸️ Pending to ✅ Confirmed — all MVP schema batches A/B/C/D are created and accepted; docs/12 is the accepted Gate A plan; future schema extensions require separate explicit passes. AC-03 updated from ⏸️ Pending to ✅ Confirmed — docs/12 harness fixture groups (§7), Harness Runner Contract (§10), and fixture inventory (28 cases / 308 files) are all accepted; full fixture suite not complete; harness code not created (Phase 12). User review gate-impact tightened from "Unblocks all implementation passes" to "Satisfies AC-01 — the sole remaining AC gate; unblocks all implementation coding phases" — AC-01 is now the only remaining ⏸️ entry. AC-01 remains pending. Implementation remains not started and prohibited until explicit user approval. No docs/06, docs/12, docs/13, docs/04, docs/05, docs/09, schemas, fixtures, harness, source, runtime, OpenClaw, or provider files edited.*

*Phase 13 status sync: AC-01 marked ✅ Approved; AC-03 updated to record harness implementation complete; AC-06/AC-07 updated to final Phase 13 wording; §11 acceptance criteria heading note updated; §12 Final Status table updated from Draft/Not-started to Accepted/Complete; §12 Next Recommended Passes replaced with Implementation Pass Record (all rows ✅ Complete); file header block updated from Draft/Prohibited to Accepted/Complete. No canonical phase contracts, invariants, selector plans, spec references, docs/04/05/06, schemas, fixtures, tests, or source code changed. Gate D wording updated to "intentionally out of MVP scope — blocked by design." READY_FOR_REVIEW.txt not touched. 651/651 tests confirmed passing. Gate B: SATISFIED WITH 1 APPROVED SKIP(S).*
