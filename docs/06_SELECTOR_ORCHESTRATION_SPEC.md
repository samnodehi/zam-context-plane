# 06 Selector Orchestration Specification

> **Version:** Pass 3.2.6 + 4.5A + 4.5B + 4.5B.1 sync + 4.7A + 4.7A.1 + 4.7B + 4.7B.1 + 4.7B.2 + 4.7C + 4.8B + 4.8B.1 + 4.8B.2 + 4.8C + 4.8C.1 + 4.8C.2 + 4.8D source sync + 4.8D.1 cleanup + 4.8D.2 accounting cleanup + 4.8E-2A safe-defer notes + 4.8E-2B safe-defer notes — 2026-05-15 (4.8E-2B: §11.3.4 12-Q5 non-MVP note; §12 Q5 resolved/reference; §14.8 15-Q5 harness boundary note; §15 Q5 resolved/reference; §23.2 F-31 implementation guide note; §23.4 F-30 non-MVP cross-reference note)
> **Status:** Spec-only. No code. No schema files. No runtime touched. No provider/model calls.

---

## 1. Purpose

Selector Orchestration is the module responsible for deciding, per component, what the prompt plan should do with it: include, omit, defer, or flag as a reference to an unknown component. Quarantine is a **registry-phase state**, not a selector action — quarantined components are excluded before selector fan-out and never reach selectors in MVP.

It receives a structured set of normalized inputs — request signals, registry metadata, runtime capabilities, history summary, budget state, user constraints, and selector policy — and produces a set of **SelectionDecision records**: one or more per candidate component (one per selector that evaluates it). Every candidate component must receive at least one SelectionDecision. When multiple selectors produce decisions for the same component, all decisions are preserved and later resolved by the Conflict Resolver. The resolved decisions are consumed by the Budgeter and Prompt Plan Generator.

**What Selector Orchestration does:**
- Receives normalized input signals (never raw user text as control instructions)
- Applies selector logic against component registry metadata
- Produces one or more SelectionDecision records per candidate component; every candidate receives at least one
- Allows multiple selectors to produce independent decisions for the same component; conflicts are resolved downstream
- Emits a selectorTrace of every decision and its evidence
- Flags unresolved conflicts, unknown component references, and warnings

**What Selector Orchestration does not do:**
- Does not assemble final prompt text
- Does not execute tools or call tool endpoints
- Does not call any provider or model in MVP
- Does not mutate registry metadata during a planning run
- Does not write to live agent state, `~/.openclaw`, or any runtime system

**Fail-open rule:** When selector evidence is insufficient to confidently authorize omission, the selector must include the component. Uncertainty is never resolved in favor of omission.

---

## 2. Inputs

Selector Orchestration receives the following conceptual inputs. All inputs are validated at the core boundary before selectors are invoked.

### Input Strictness Classes

Not all inputs carry the same failure semantics. Missing or malformed inputs fall into one of two classes:

**Class A — Hard-required inputs.** If any of these is absent or malformed beyond safe substitution, the planning run halts before selector fan-out begins. No selector should run against an unknown or corrupt foundational input.

| Input | Why hard-required |
|---|---|
| `requestSignals` | Without a validated request signal, no selector can classify any component correctly. |
| `promptFamily` (or a safe fallback derived from `requestSignals`) | Every selector rule depends on the prompt family. An unknown family can be substituted with `general_default` and a warning — this counts as safe substitution and does not halt. An absence of both `requestSignals` and any derivable family halts. |
| `registryIndexes` | Selectors cannot evaluate components without a validated registry. A missing or unloadable registry is always a hard halt (consistent with Component Registry Spec). |
| `componentsById` | A derived view of the registry. If `registryIndexes` is present and valid, `componentsById` must be derivable from it. If it cannot be derived, halt. |

**Class B — Defaultable / fail-open inputs.** If any of these is missing or malformed, the orchestrator applies the fail-open behavior defined in the individual section below, emits a planning warning, and continues. Every fallback or default must be recorded in `planningWarnings` or `selectorTrace` — no silent behavior change is permitted.

| Input | Fallback if missing or malformed |
|---|---|
| `runtimeCapabilities` | Treat as `capabilityInventoryComplete: false`, both lists empty — all tool availability unknown; include all tool components; emit `runtime_capabilities_missing` warning. |
| `historyStateSummary` | Treat all history-related components as uncertain; include those with `riskLevel: high` or `retainPolicy` ≠ `optional`; emit `history_summary_missing` warning. |
| `budgetState` | Treat budget as unconstrained; selectors remain budget-aware but not budget-enforcing; emit `budget_config_missing` warning. |
| `userConstraints` | Treat as no constraints; emit `user_constraints_missing` warning only if the field was present but malformed. |
| `selectorPolicy` | Use safe defaults (`failOpenThreshold: 0.7`, `deterministicOnly: true`, `injectionSuspectAction: "warn_and_continue"`); emit `selector_policy_defaulted` warning. |

---

### 2.1 `requestSignals`

**Meaning:** A normalized, validated set of signals derived from the user's request. This is the selector's only window into the request. It is not raw user text.

**Source:** Produced by the Request Router from the raw user request string. The router classifies the request and emits a structured signal set — it does not forward the raw text.

**MVP shape (conceptual):**
```
{
  promptFamily: string (enum value — see architecture doc)
  familyConfidence: float 0.0–1.0
  explicitCallerFlags: string[]   // operator-supplied override flags, not user-supplied
  injectionSuspect: boolean       // true if Request Router detected adversarial patterns
}
```

> **F-25 resolved (Pass 4.7B — Option A):** `requestSignals.injectionSuspect` is frozen as `boolean` for MVP. This is the stable MVP contract. Selectors consume this boolean only — they never inspect raw user text or pattern codes. The Request Router is the sole detection owner.
>
> **Malformed input behavior:** If `injectionSuspect` is present but not a boolean (e.g., a struct or array), the orchestrator must treat it as `false`, emit a `injection_suspect_malformed` planning warning, and continue. If `requestSignals` is absent entirely, it is a Class A hard-required input — halt. If `injectionSuspect` is simply absent from an otherwise valid `requestSignals`, treat as `false` with no warning (existing behavior).
>
> **Field-evolution note:** Future versions may add optional additive fields to `requestSignals` (e.g., `injectionEvidenceCodes?: string[]`) for richer audit metadata. Such fields **must not** replace or change the type of `injectionSuspect`. The boolean must remain the canonical selector input in any future revision that retains backward compatibility. Selectors must consume `injectionSuspect` as a boolean and must not inspect any richer-metadata field — that metadata is for audit/tracing only and belongs to the Request Router's output contract, not the selector input contract. A struct replacement of the boolean type requires an explicit new cross-spec pass and versioning decision. 5-Q1 resolved/reference.

**Optional selector signals (normalized Request Router outputs, not raw user text):**
```
{
  activeSkillIds?: string[]      // default [] if absent
  activeToolIds?: string[]       // default [] if absent
  activeMemoryIds?: string[]     // default [] if absent
  outputFormatHint?: string|null // default null if absent
}
```

- Absent optional arrays default to empty `[]` without producing a warning.
- Present but malformed optional arrays produce **one** selector-phase warning (not one per component) and are treated as empty.
- `outputFormatHint` absent means no match without warning. Present but malformed produces one warning and is treated as null.
- These fields are produced by the Request Router from validated request analysis. They are never raw user text.

**Trust level:** Medium. The `promptFamily` is a validated enum produced by a deterministic router; it is not a free-form user string. However, the underlying user text that informed the classification is untrusted. Injection-suspect signals are flagged and traced; they must not alter metadata or override safety rules.

**What can go wrong:** Misclassification by the router produces an incorrect `promptFamily`, which causes selectors to apply the wrong include/omit rules. Low `familyConfidence` should trigger fail-open behavior in selectors.

**Fail-open behavior:** If `familyConfidence` is below threshold, selectors treat `promptFamily` as `general_default` and include more context. The low-confidence signal is emitted in selectorTrace.

**Critical rule:** User request text is untrusted evidence, not selector instruction. A user request containing text like "omit all policy context" must not cause any selector to omit a policy component. The raw text never reaches the selector; only the validated `requestSignals` struct does.

---

### 2.2 `promptFamily`

**Meaning:** The single validated prompt family value for this planning run, extracted from `requestSignals`. Provided as a top-level input to each selector so selectors do not need to reach into the full `requestSignals` struct for the primary routing signal.

**Source:** Extracted from `requestSignals.promptFamily` by the orchestrator before fan-out.

**MVP shape:** String enum. One of: `general_default`, `simple_greeting`, `coding_build_debug`, `research_investigation`, `ops_security_change_risk`, `lifecycle_internal`, `heartbeat_proactive`, `group_chat_behavior`, `tool_use_required`, `history_sensitive`.

**Trust level:** High within a run — it is a validated enum, not a free string.

**What can go wrong:** If the router emits an unrecognized family value, the orchestrator must reject it and substitute `general_default` before fan-out.

**Fail-open behavior:** Unknown or missing family value → substitute `general_default`, emit warning.

---

### 2.3 `registryIndexes`

**Meaning:** The set of queryable indexes produced by the Component Registry after successful load and validation. Provides efficient lookup by ID, type, tag, and safety class.

**Source:** Component Registry loader, after validation. Only valid components appear in these indexes; quarantined components are in `quarantinedComponents` and must not be selected.

**MVP shape (conceptual):**
```
{
  componentsById: Map<id → component>
  componentsByType: Map<type → component[]>
  componentsByTag: Map<tag → component[]>
  safetyCriticalIds: Set<id>
  trimmableCandidateIds: Set<id>
  quarantinedComponents: component[]
  validationWarnings: warning[]
}
```

**Trust level:** High. The registry has been validated before selectors run. However, `tokensApprox` values are hand-authored estimates and may drift from actual content.

**What can go wrong:** A component with incorrect `riskLevel` or `retainPolicy` would cause a selector to apply the wrong safety gate. Stale `hash` fields indicate possible content drift.

**Fail-open behavior:** If `registryIndexes` is missing or indicates a registry load failure, halt the planning run. Do not attempt selector fan-out against an unvalidated registry.

---

### 2.4 `componentsById`

**Meaning:** Direct lookup of a single component's full metadata by its ID. Provided as a convenience shortcut from `registryIndexes`. Selectors use this to inspect the full field set (`riskLevel`, `omissionPolicy`, `retainPolicy`, `requiredWhen`, `safeToOmitWhen`, `defaultAction`, `evidenceRequired`) for each candidate.

**Source:** Derived from `registryIndexes.componentsById`.

**MVP shape:** `Map<id → ComponentDefinition>` where ComponentDefinition is the full validated component object from the registry spec.

**Trust level:** High (same as registryIndexes).

**What can go wrong:** A selector references a component ID not present in this map — this is a `reference_unknown` event, not a silent skip.

**Fail-open behavior:** Unknown ID → emit `reference_unknown` trace entry, add to `referencedUnknownComponents` output, do not include or omit.

---

### 2.5 `runtimeCapabilities`

**Meaning:** In MVP, `runtimeCapabilities` describes tool availability at the current runtime: which tool IDs are confirmed available, which are confirmed unavailable, and whether the inventory is complete. It is used by the tool selector to decide whether to defer tool components whose runtime availability cannot be confirmed. Broader runtime capability flags such as model-call permission, file I/O, memory access, and network access are future extensions and are not part of the MVP selector input contract.

**Source:** Provided by the caller (CLI operator in MVP, adapter in future). In MVP, this is a manually authored JSON object passed as a CLI input file. It is not probed live from any runtime system.

**MVP shape (conceptual):**
```
{
  availableToolIds: string[]        // IDs of tools confirmed available at this runtime
  unavailableToolIds: string[]      // IDs of tools confirmed unavailable at this runtime
  capabilityInventoryComplete: boolean  // true = absence from both lists means unavailable
                                        // false = absence from both lists means unknown
  runtimeLabel: string              // e.g., "mvp_cli_static"
}
```

**Capability semantics (must be respected by the tool selector):**
- A tool ID present in `availableToolIds`: **confirmed available**. May be included in the plan.
- A tool ID present in `unavailableToolIds`: **confirmed unavailable**. Selector emits `action: defer` with `path: runtime_unavailable` and a planning warning. Must not claim token savings.
- A tool ID absent from both lists AND `capabilityInventoryComplete: true`: treated as **confirmed unavailable** (same as above).
- A tool ID absent from both lists AND `capabilityInventoryComplete: false`: **unknown availability**. Selector must fail open — include the tool component and emit a `runtime_capability_unknown` planning warning. Do not treat unknown as unavailable.

**Trust level:** Medium. In MVP, operator-supplied and not verified against a live runtime. The integrity of `availableToolIds` and `unavailableToolIds` depends on accurate manual authoring.

**What can go wrong:** An incomplete `unavailableToolIds` list paired with `capabilityInventoryComplete: false` means the selector cannot confidently defer any tool. This is safe (fail-open includes tools) but may over-include tool definitions. An incorrect `capabilityInventoryComplete: true` flag would silently defer tools that are actually available.

**Fail-open behavior:** If `runtimeCapabilities` is missing entirely, treat as `capabilityInventoryComplete: false` with both lists empty — all tool availability is unknown, all tool components are included, emit a `runtime_capabilities_missing` planning warning. Do not halt the planning run.

> **Non-MVP boundary note (5-Q3 / F-26 — safe-defer):** `capabilityTimestamp` and `capabilityVersion` are future optional fields, meaningful only when adapter-supplied capability snapshots (e.g., OpenClaw, n8n, or other adapters) introduce cross-run provenance requirements. In MVP, `runtimeCapabilities` is a manually authored JSON file supplied by the CLI operator per planning run. Because each run receives a freshly provided input file, automated drift detection between runs is out of scope in MVP — detecting whether a stale input file was re-used is operator and workflow responsibility, not a core planning concern. `runtimeLabel` (opaque string) is the only MVP runtime identifier required. **No warning is emitted solely because version or timestamp fields are absent** — such a warning would fire on every static CLI run without providing any safety benefit. `capabilityTimestamp` and `capabilityVersion` must not be added as required fields in any MVP schema file. These fields belong in a future adapter-facing extension of this input contract.

---

### 2.6 `historyStateSummary`

**Meaning:** A summary of the history state sufficient for selectors to reason about whether history-sensitive components are needed — without exposing raw turn content. Includes lane occupancy, open commitment count, and a flag for whether durable constraints are present.

**Source:** Produced by the History Lane Manager from the full `historyState` input. The full history (with raw content) is NOT passed to selectors. Only the summary is.

**MVP shape (conceptual):**
```
{
  lanesPresent: string[]           // which lanes have at least one turn
  durableConstraintsPresent: boolean
  openCommitmentsPresent: boolean
  recentRawTurnCount: integer
  totalHistoryTokensApprox: integer
  historyMalformed: boolean        // true if History Lane Manager could not classify turns
}
```

**Trust level:** High — produced by an internal module, not by user input. Raw history content is never in this object.

**What can go wrong:** If the History Lane Manager could not classify turns (`historyMalformed: true`), the summary may be incomplete. The selector should treat this as uncertain and include history-related components.

**Fail-open behavior:** `historyMalformed: true` or missing `historyStateSummary` → selectors include all history-related components with `riskLevel: high` or `retainPolicy` ≠ `optional`.

---

### 2.7 `budgetState`

**Meaning:** The current budget configuration and, if pre-computed, an estimate of how many tokens are already consumed by protected components (mandatory, safety_critical). Informs selectors whether budget pressure exists before the Budgeter runs its trim pass.

**Source:** Provided by the caller (CLI `--budget` input file in MVP). The Budgeter's final enforcement runs after selector fan-out, but the budget config is available to selectors as context.

**MVP shape (conceptual):**
```
{
  totalPromptTokenTarget: integer
  maxScaffoldTokens: integer
  maxSkillTokens: integer
  maxToolTokens: integer
  maxHistoryTokens: integer
  reservedUserTokens: integer
  budgetCritical: boolean          // true if protected components already exceed target
}
```

**Trust level:** High — operator-supplied config, not user-supplied.

**What can go wrong:** If `totalPromptTokenTarget` is 0 or missing, the Budgeter cannot trim safely. Selectors should not use budget pressure alone to justify omitting high-risk components.

**Fail-open behavior:** Missing or zero budget target → treat budget as unconstrained; emit a `budget_config_missing` warning. Selectors do not use budget as an omission justification; that is the Budgeter's role. Selectors are budget-aware (to inform confidence) but not budget-enforcing.

---

### 2.8 `userConstraints`

**Meaning:** Operator or user-supplied explicit constraints on component inclusion or omission. These override selector decisions at high priority. Examples: "always include component X," "never expose component Y in this context."

**Source:** Operator-supplied input file in MVP. In future, may be derived from session metadata or adapter-supplied policy.

**MVP shape (conceptual):**
```
{
  alwaysInclude: string[]          // component IDs that must be included regardless of selector
  neverInclude: string[]           // component IDs that must be excluded regardless of selector
  constraintSource: string         // e.g., "operator_cli", "session_policy"
}
```

**Trust level:** High for operator-supplied constraints (MVP). Lower for user-session-derived constraints in future — these must be validated before use.

**What can go wrong:** A `neverInclude` constraint on a safety-critical component would create a conflict between user constraint and safety rule. Safety wins; the constraint is overridden and logged as `safety_override`.

**Fail-open behavior:** If `userConstraints` is malformed or missing, treat as empty (no explicit constraints). Do not halt. Emit warning if malformed.

> **Non-MVP boundary note (5-Q5 — safe-defer):** In MVP, `userConstraints` is always operator-supplied CLI input. After schema conformance is confirmed, it is treated as high-trust — no further per-constraint validation is required. Session-derived constraints (where individual user session metadata supplies constraint values at runtime) are future adapter work. Before session-derived constraints can be used, the following must be specified in a dedicated adapter spec: (1) a trust-level field or equivalent trust boundary mechanism distinguishing operator-supplied from session-derived constraints; (2) per-constraint validation rules appropriate to the lower-trust source; (3) a refined safety-override interaction spec for session-derived constraints. Until then, the current safety-override rule applies unconditionally: if a constraint in `neverInclude` or `alwaysInclude` conflicts with a hard-protection component (`retainPolicy: safety_critical`, `omissionPolicy: never`, `riskLevel: critical`), safety wins — the constraint is overridden and logged as `safety_override`. Do not add a `constraintTrustLevel` field or per-constraint validation logic in MVP.

---

### 2.9 `selectorPolicy`

**Meaning:** Configuration for how selectors behave — confidence thresholds, which selector types are enabled, and how selectors react to injection-suspect signals received from `requestSignals`. This does not configure injection pattern detection; that is the Request Router's responsibility.

**Source:** Operator-supplied config in MVP. Hardcoded defaults exist so the system works without explicit policy.

**MVP shape (conceptual):**
```
{
  failOpenThreshold: float         // 0.0–1.0; confidence below this → fail open (default: 0.7)
  deterministicOnly: boolean       // true in MVP; model-assisted selectors disabled
  injectionSuspectAction: string   // what to do when requestSignals.injectionSuspect is true
                                   // MVP allowed values: "warn_and_continue" (default) | "fail_open_all"
                                   // Reserved future value: "halt_planning" (recognized, not implemented — see below)
}
```

**`injectionSuspectAction` allowed values in MVP:**

| Value | Status | Behavior |
|---|---|---|
| `warn_and_continue` | ✅ Active MVP value | Ladder behavior preserved; ordinary low/medium Path A/B omits allowed and annotated with `injection_suspect_omit_allowed`; all decisions carry `injection_suspect_seen` evidence atom. Branch A (hard-protection markers: `riskLevel: critical`, `retainPolicy: safety_critical/mandatory`, `omissionPolicy: never`) and Branch B (`riskLevel: high`) injection-gate upgrade paths are structurally unreachable — see §17.3.1. Branch C (low/medium policy, history-durable without hard-protection metadata) upgrade is deferred pending spec decision — `injection_suspect_policy_override` is reserved in advisory enum. Default when policy is missing or unknown. |
| `fail_open_all` | ✅ Active MVP value | Path A and Path B globally disabled; all omit → include/fail_open. Runtime-unavailable and reference_unknown decisions pass through unchanged. |
| `halt_planning` | 🔒 Reserved future value — not implemented in MVP | Intended for high-security deployments where any confirmed injection attempt should abort the planning run. **Not implemented in MVP.** If an operator config supplies `halt_planning` in MVP, the orchestrator must: (1) recognize it as a known-but-not-implemented value (not a typo); (2) emit a `policy_value_not_implemented` planning warning; (3) apply `warn_and_continue` as the safe fallback; (4) record the fallback in the trace. This is distinct from the generic unknown-value fallback path (which emits `injection_action_unknown`). Do not implement halt semantics in MVP. |

> **F-24 resolved (Pass 4.7B — Option B):** `halt_planning` is explicitly recognized as a future/non-MVP value. It must not be treated as a typo or unknown value. It must not silently behave like `warn_and_continue` without a trace-visible warning. The `policy_value_not_implemented` warning distinguishes this from `injection_action_unknown` (used for genuinely unrecognized/typo values). `halt_planning` planning halt semantics are not defined in MVP and must not be implemented. 18-Q2 resolved/reference.

**Injection detection boundary:** Selectors do not detect prompt injection. The Request Router detects adversarial patterns in the raw user text and sets `requestSignals.injectionSuspect: true` when warranted. Selectors consume this pre-computed boolean signal and react according to `injectionSuspectAction`. Raw user text never reaches selectors, so selectors have nothing to scan. `injectionSuspectPatterns` does not belong in `selectorPolicy`.

**Trust level:** High — operator-supplied.

**What can go wrong:** A very low `failOpenThreshold` would cause the system to omit too aggressively. A threshold of 0.0 disables fail-open behavior entirely — this should be rejected or warned against. An `injectionSuspectAction` of `fail_open_all` causes all components to be included when any injection signal is present; this is safe but may be unnecessarily conservative. Supplying `halt_planning` in MVP causes a `policy_value_not_implemented` warning and fallback to `warn_and_continue`. Additionally, `failOpenThreshold` is also used by the familyConfidence escalation rule (§17.3.4): when `requestSignals.injectionSuspect: true` and `requestSignals.familyConfidence < failOpenThreshold`, the effective injection policy automatically escalates to `fail_open_all` regardless of the configured `injectionSuspectAction` — no new field is added for this.

**Fail-open behavior:** Missing `selectorPolicy` → use safe defaults (`failOpenThreshold: 0.7`, `deterministicOnly: true`, `injectionSuspectAction: "warn_and_continue"`). Emit `selector_policy_defaulted` warning.

---

## 3. Outputs

Selector Orchestration produces the following outputs after all selectors have run and before the Conflict Resolver takes over. These outputs feed directly into the Conflict Resolver, Budgeter, Prompt Plan Generator, and Evaluation Harness.

---

### 3.1 `selectionDecisions`

**Meaning:** The primary output. One SelectionDecision record per candidate component per selector that evaluated it. If multiple selectors produce decisions for the same component, all decisions are included here — the Conflict Resolver resolves disagreements.

**Shape:** Array of SelectionDecision objects (see Section 4).

**Candidate components and `candidateSetPolicy`:** The orchestrator uses an internal `candidateSetPolicy` constant to define the candidate set for each planning run. In MVP the only supported value is **`all_non_quarantined`**: the candidate set is all components present in `registryIndexes.componentsById` after registry validation and quarantine exclusion. Quarantined components are excluded before selector fan-out and must not be silently re-evaluated.

> **Unsupported value:** If a future adapter or internal config path supplies a `candidateSetPolicy` value other than `all_non_quarantined`, the orchestrator must emit an `unsupported_candidate_set_policy` planning error and **halt before selector fan-out begins**. Silent fallback to `all_non_quarantined` is prohibited because an incorrect candidate set silently corrupts gap-check accounting.

> **Future-only extension values (not implemented in MVP):** `by_type`, `by_prompt_family`, `explicit_component_ids`. These values are named here only so future passes can reference them without inventing new names. Do not implement them.

**`candidateSetSummary` trace record:** The orchestrator must emit exactly one `candidateSetSummary` record per planning run, placed in the `registryPhase` of `trace.json` (where quarantine events are already recorded), before selector fan-out begins. Required fields:

| Field | Content |
|---|---|
| `candidateSetPolicy` | `"all_non_quarantined"` in MVP |
| `candidateSetSize` | Count of components in the candidate set (= `componentsById.size` after quarantine exclusion) |
| `quarantinedExcluded` | Count of quarantined components excluded before fan-out (consistent with `component_quarantined` events in `registryPhase`) |

**Gap-check denominator invariant:** The orchestrator gap-check (see below) must use `candidateSetSize` from the `candidateSetSummary` as its denominator, not a hard-coded full-registry count. When scoped evaluation is introduced in a future pass, gap-check will apply to the narrowed candidate set, not the full registry. Implementors must not hard-code a full-registry count into the gap-check loop.

**`candidateSetSummary` evaluation harness checks:**
- Missing `candidateSetSummary` in the `registryPhase` of `trace.json` is a traceability failure.
- MVP `candidateSetPolicy` must be `all_non_quarantined`; any other value in an MVP trace is a configuration failure.
- `candidateSetSize` must equal `componentsById.size` after quarantine exclusion; a mismatch is an accounting failure.
- `noConflictComponentIds.length + conflictResolutionTrace.length` must equal `candidateSetSize`; a mismatch is an accounting failure.
- `quarantinedExcluded` must match the count of `component_quarantined` events in `registryPhase`; a mismatch is an accounting failure.

**What must be true:**
- Every candidate component must receive at least one SelectionDecision from at least one selector.
- A component that receives no decision from any selector has been silently skipped — this is a planning error.
- If a component is silently skipped, the orchestrator must emit a `not_evaluated` planning warning, produce a synthetic `action: include` decision with `path: fail_open` and `confidence: low`, and add the component to `planningWarnings`.
- The orchestrator checks for gaps after all selectors complete, before handing off to the Conflict Resolver.

---

### 3.2 `selectorTrace`

**Meaning:** A structured record of every decision event emitted by every selector during fan-out. Captures which selector produced which decision, what evidence was used, and what path was taken (required_match, safe_to_omit_match, fail_open, etc.).

**Shape:** Array of trace event objects. Each event references a `SelectionDecision` via `decisionId` and a component via `componentId`.

**Privacy rule:** Raw component content must not appear in trace events. Only `componentId`, `hash`, and `source` references are permitted. Raw history turn content must not appear. Only `contentHash` and `contentRef` are permitted for history references.

**Relationship to `trace.json` (5-Q2 resolved, Pass 4.5A):** In MVP, `selectorTrace` is embedded in the main `trace.json` output under a `selectorPhase` key, as the `selectorPhase.selectorTrace` array. There is **no separate `selector-trace.json` file in MVP**. The full `trace.json` is a keyed phase object (see `docs/04_PORTABLE_CORE_ARCHITECTURE.md` §7.8 for the top-level phase key structure). Future externalization of `selectorTrace` into a separate file is reserved as a non-MVP extension if trace size becomes a practical problem — it must not be implemented in MVP without an explicit cross-spec decision pass. The Evaluation Harness validates `trace.json.selectorPhase.selectorTrace` directly.

---

### 3.3 `planningWarnings`

**Meaning:** Non-fatal issues detected during selector fan-out. Includes low-confidence decisions, missing optional inputs, injection-suspect signals that were traced but overridden, and components where no rule matched and fail-open was applied.

**Shape:** Array of warning objects, each with a `code`, `componentId` (if applicable), and human-readable `message`.

**What feeds on this:** Prompt Plan Generator includes `planningWarnings` in the prompt plan's `riskFlags`. Evaluation Harness checks that safety-class components never appear in planning warnings as omitted.

---

### 3.4 `unresolvedConflicts`

**Meaning:** Cases where two or more selectors produced contradictory decisions for the same component and the Conflict Resolver (running after this phase) will need to intervene. Selector Orchestration identifies and surfaces these conflicts explicitly rather than silently choosing one.

**Shape:** Array of conflict records, each identifying the `componentId`, the set of conflicting decisions, and the selectors that produced them.

**What feeds on this:** Conflict Resolver consumes this list as its primary input. If the Conflict Resolver cannot resolve a conflict, the component is included (fail-open) and the conflict appears in `unresolvedConflicts` in the final plan.

---

### 3.5 `referencedUnknownComponents`

**Meaning:** Component IDs referenced by a selector (e.g., via an explicit caller flag or a dependency declaration) that do not appear in `componentsById`. These cannot be included or omitted — they are unknown to the registry.

**Shape:** Array of objects: `{ componentId: string, referencedBy: string, traceRef: string }`.

**What must be true:** Unknown component references must never be silently ignored. Each must produce a `reference_unknown` trace entry and appear in this list. The Prompt Plan Generator must include this list in the plan's `riskFlags`.

---

### 3.6 `selectorSummary`

**Meaning:** A human-readable summary of the selector phase: how many components were evaluated, how many were decisively included, omitted, deferred, or failed-open, and how many conflicts were identified. Quarantine events are not counted here — they are registry-phase events recorded in `registryPhase` of `trace.json` before selector fan-out begins.

**Shape:** Structured object with integer counts and a brief narrative string for `summary.md` generation.

`decidedDefer` is the total defer count. `defaultDefer` counts decisions with `path: default_defer`. `runtimeUnavailableDefer` counts decisions with `path: runtime_unavailable`. Splitting these prevents runtime-unavailable tool deferrals from being hidden inside generic defer statistics, which would make evaluation and debugging harder.

**MVP narrative field — deterministic template (F-27 resolved, Pass 4.5B):**

The `narrative` string in MVP is generated by the Selector Orchestration output phase (the module that assembles and emits `selectorSummary`) using the following fixed deterministic template. No model call, no free-form text, no external generation:

```
"{totalEvaluated} components evaluated. {decidedInclude} included, {decidedOmit} omitted, {decidedDefer} deferred ({defaultDefer} default, {runtimeUnavailableDefer} runtime-unavailable), {failOpenInclude} fail-open. {conflictsIdentified} conflict(s) identified."
```

**Template rules:**
- Substitute each `{field}` placeholder with the corresponding integer count from `selectorSummary`.
- If any count is absent or null (e.g., because a sub-count was not computed), substitute `0` for that field.
- No additional sentences, contextual commentary, or severity language may be added in MVP.
- The resulting string must be deterministic: the same counts must always produce the same narrative.

**Future:** A model-generated narrative (richer prose, contextual commentary, risk language) is reserved as a future-only extension. It must not be implemented in MVP. Any implementation of model-generated narrative requires an explicit cross-spec decision pass, a defined model call contract, and deterministic fallback for test harness use. Implementing model-generated narrative in MVP is a scope violation.

**Required counts for template population:** `totalEvaluated`, `decidedInclude`, `decidedOmit`, `decidedDefer`, `defaultDefer`, `runtimeUnavailableDefer`, `failOpenInclude`, `conflictsIdentified`. All are integer fields already required by the `selectorSummary` contract.

**Example (conceptual):**
```
{
  totalEvaluated: 12,
  decidedInclude: 7,
  decidedOmit: 2,
  decidedDefer: 2,
  defaultDefer: 1,
  runtimeUnavailableDefer: 1,
  failOpenInclude: 2,
  conflictsIdentified: 1,
  unknownReferences: 0,
  narrative: "12 components evaluated. 7 included, 2 omitted, 2 deferred (1 default, 1 runtime-unavailable), 2 fail-open. 1 conflict(s) identified."
}
```

---

## 4. SelectionDecision Conceptual Object

A SelectionDecision is the per-component record produced by a single selector run. The Conflict Resolver takes multiple SelectionDecision records for the same component and resolves them to one. The Budgeter and Prompt Plan Generator consume the resolved set.

| Field | Meaning | Allowed Values | Required | Example |
|---|---|---|:---:|---|
| `componentId` | The registry ID of the component this decision applies to | Any string present in `componentsById` (or unknown if `action: reference_unknown`) | ✅ | `"skill.code_review"` |
| `selectorName` | Identifier of the selector that produced this decision | String; e.g., `"deterministic_scaffold"`, `"deterministic_tool"` | ✅ | `"deterministic_scaffold"` |
| `action` | What the selector recommends doing with this component | `include`, `omit`, `defer`, `reference_unknown` | ✅ | `"omit"` |
| `reason` | Human-readable explanation of why this action was chosen | Non-empty string | ✅ | `"safeToOmitWhen matched: simple_greeting; riskLevel=low; evidenceRequired satisfied"` |
| `path` | The decision path taken by the selector logic | See allowed values below | ✅ | `"safe_to_omit_match"` |
| `confidence` | How confident the selector is in this decision | `high`, `medium`, `low` | ✅ | `"high"` |
| `evidence` | List of signal atoms that supported this decision | Array of strings; may be empty only for `reference_unknown` | ✅ | `["promptFamily=simple_greeting", "riskLevel=low"]` |
| `constraintsApplied` | Which active constraints (user, safety, policy) influenced this decision | Array of strings; empty if none | ✅ | `["safety: omissionPolicy=never overrides omit"]` |
| `warnings` | Non-fatal issues specific to this decision | Array of strings; empty if none | ✅ | `["evidenceRequired was null; safeToOmitWhen match alone authorized omission"]` |
| `traceRefs` | References to trace entries that document this decision | Array of trace entry IDs | ✅ | `["trace-uuid-001"]` |

### `action` values

| Value | Meaning |
|---|---|
| `include` | Include this component in the prompt plan |
| `omit` | Omit this component from the prompt plan. **Must identify Path A or Path B** (see `path` field). No omission is valid outside these two paths. |
| `defer` | Exclude from this plan turn; not counted as omitted; no token savings claimed; must emit a defer trace entry |
| `reference_unknown` | Selector referenced this component ID but it is not present in the registry; cannot include or omit |

> **F-17 resolved (Pass 4.7A — Option A):** `quarantine` is **not** a valid `SelectionDecision.action` in MVP. Quarantine is a registry-phase state, not a selector action. Quarantined components are excluded before selector fan-out (they appear in `registryIndexes.quarantinedComponents`, not in `componentsById`) and therefore never reach a selector under correct MVP operation. If a quarantined component ID somehow appears during selector fan-out despite the registry guarantee, this is a **planning boundary violation** — see Step 1 of the deterministic ladder (Section 8) for the boundary-violation handling protocol. `quarantine` may be considered for future non-MVP use cases (e.g., streaming registry updates), but is not part of the MVP selector action set.

### `path` values

| Value | Meaning | When used |
|---|---|---|
| `required_match` | `requiredWhen` tag matched the current `promptFamily` | `action: include` |
| `safe_to_omit_match` | Path A: `safeToOmitWhen` matched AND `evidenceRequired` satisfied AND all Path A gates passed | `action: omit` |
| `default_action_omit` | Path B: no tag matched; `defaultAction: omit`; all Path B conditions held | `action: omit` |
| `default_include` | No rule matched; `defaultAction: include` | `action: include` |
| `default_defer` | No rule matched; `defaultAction: defer` | `action: defer` |
| `fail_open` | Insufficient evidence to confidently omit; uncertainty resolved to include | `action: include` |
| `conflict_include` | Both `requiredWhen` and `safeToOmitWhen` matched; conflict resolved to include | `action: include` |
| `safety_override` | A safety gate (`omissionPolicy: never`, `retainPolicy: safety_critical`, or `riskLevel: critical`) overrode a selector `omit` decision | `action: include` |
| `runtime_unavailable` | Tool component is confirmed unavailable at the current runtime (see `runtimeCapabilities` semantics). **Must use `action: defer`, never `action: omit`.** Not counted as omission. No token savings claimed. Emits a `runtime_capability_unavailable` planning warning. In MVP, the harness distinguishes `runtime_unavailable` defers from `default_defer` defers by inspecting the `path` field on each `deferredComponents[]` entry in `prompt-plan.json` — `path` is a required field on every `deferredComponents[]` entry for this reason. A dedicated `action: unavailable` is **future-only** (5-Q7 / F-28 safe-defer); do not add it to the action enum. A future `deferSubtype` plan field may be considered only if harness or schema requirements prove it necessary. | `action: defer` only |
| `not_evaluated` | Synthetic path assigned by the orchestrator to a candidate component that no selector evaluated. Always produces `action: include` with `confidence: low`. | `action: include` |
| `reference_unknown` | Component ID not found in registry. When `action: reference_unknown`, the `componentId` field carries the caller-supplied unknown string — it is **not** a registry-validated ID. This dual-use of `componentId` is intentional in MVP. A separate `unknownId` field is deferred to schema v1.1 (5-Q4 safe-defer). | `action: reference_unknown` |
| `quarantine_boundary_violation` | **Boundary-violation path (Pass 4.7A).** Assigned by the orchestrator when a quarantined component ID is detected in the selector fan-out candidate set despite the registry guarantee. This represents a planning boundary violation, not a normal selector decision. Always produces `action: include`, `confidence: low` — the component is not silently dropped. See Step 1 of Section 8 for the full protocol. | `action: include` only. Never `omit`. |

**Key rules for `path` and `action`:**
- `action: omit` is only valid with `path: safe_to_omit_match` (Path A) or `path: default_action_omit` (Path B). Any `omit` action with a different path is a planning error.
- `action: omit` with an empty `evidence[]` array is a planning error and must fail the Evaluation Harness.
- `action: reference_unknown` must never be silently ignored. It must appear in `referencedUnknownComponents`.
- `path: safety_override` must always result in `action: include`, never `action: omit`.
- No raw component content or raw history turn content may appear in `evidence[]`, `reason`, `warnings`, or `traceRefs`.
- **Harness rule (5-Q4):** Any harness check that reads `componentId` from a `reference_unknown` decision must not compare it against `componentsById` as if it should exist there. `reference_unknown` decisions are a distinct class, identified by `action: reference_unknown`; their `componentId` is an untrusted caller-supplied string, not a validated registry ID.
- **Harness rule (5-Q7 / F-28):** To distinguish `runtime_unavailable` defers from `default_defer` defers in `prompt-plan.json`, the harness must filter `deferredComponents[]` by `path` (e.g., `path === 'runtime_unavailable'`). Filtering by `action: defer` alone is insufficient.

> **`budget_trim` path boundary (Pass 4.9D-2Z):** `budget_trim` is **not** a valid `SelectionDecision.path` or `ResolvedSelectionDecision.finalPath` value. Selectors and the Conflict Resolver must never emit `path: "budget_trim"`. It is a plan-phase output partition path assigned by the PPG after Budgeter completes, used only in `omittedComponents[]` of the final prompt-plan output to represent an include-resolved component removed due to budget pressure. `safe_to_omit_match` (Path A) and `default_action_omit` (Path B) are selector-origin paths; `budget_trim` is a Budgeter-origin path applied by the PPG — these three are semantically distinct. `trimActions[]` records only actual Budgeter-performed trims on previously include-resolved components; selector-omitted components must not appear in `trimActions[]`. `budget_trim` is not yet in `SelectionPath` (`enums.shared.schema.json`); schema support is required in a future pass before any fixture can use it.

### `confidence` values

| Value | Meaning |
|---|---|
| `high` | A deterministic rule matched cleanly; no ambiguity |
| `medium` | A rule matched but with partial evidence or a weak signal |
| `low` | Minimal signal; decision is primarily fail-open |

**Fail-open threshold:** If `confidence` is `low` and `selectorPolicy.failOpenThreshold` is 0.7 (default), the selector must emit `action: include` with `path: fail_open`, not `action: omit`. A `low`-confidence `omit` is invalid in MVP.

---

## 5. Pass 1 Open Questions

These questions are relevant to inputs and outputs defined in this pass. Selector ladder, conflict resolution, and type-specific rules are deferred to later passes.

1. ~~**`requestSignals` structure finalization.**~~ **Resolved/reference Pass 4.7B (F-25).** Decision: `requestSignals.injectionSuspect` is frozen as `boolean` for MVP. Selectors consume this boolean only; they never inspect raw user text or pattern codes. The Request Router is the sole detection owner. Malformed `injectionSuspect` (non-boolean when `requestSignals` is otherwise valid) → treat as `false`, emit `injection_suspect_malformed` warning. Future richer audit metadata (e.g., `injectionEvidenceCodes?: string[]`) may be added as optional additive fields but must not replace the boolean type. A struct replacement requires an explicit future cross-spec pass. See §2.1 for the canonical wording and field-evolution note.

2. ~~**`selectorTrace` file placement.**~~ **Resolved Pass 4.5A:** In MVP, `selectorTrace` is embedded in the main `trace.json` under `selectorPhase.selectorTrace`. There is no separate `selector-trace.json` in MVP. Future externalization may be considered only as a non-MVP extension if trace size becomes a practical problem. See §3.2 for the canonical wording and `docs/04_PORTABLE_CORE_ARCHITECTURE.md` §7.8 for the full phase-key structure.

3. ~~**`runtimeCapabilities` versioning and source metadata.**~~ **Resolved/reference Pass 4.8E-2A (5-Q3 / F-26 — safe-defer).** Decision: `capabilityTimestamp` and `capabilityVersion` are future optional fields for adapter-supplied capability snapshots. In MVP, `runtimeCapabilities` is operator-authored per run; automated drift detection is out of scope. `runtimeLabel` is the only MVP runtime identifier. No warning is emitted for absent version/timestamp fields in MVP. See §2.5 non-MVP boundary note.

4. ~~**Representing unknown component references cleanly.**~~ **Resolved/reference Pass 4.8E-2A (5-Q4 — safe-defer).** Decision: for `action: reference_unknown`, `componentId` carries the caller-supplied unknown string — not a registry-validated ID. This dual-use is intentional in MVP. A separate `unknownId` field is deferred to schema v1.1. The `SelectionDecision` shape is unchanged. See §4 `path` table `reference_unknown` row and key rules harness note.

5. ~~**`userConstraints` trust boundary in future.**~~ **Resolved/reference Pass 4.8E-2A (5-Q5 — safe-defer).** Decision: MVP `userConstraints` are operator-supplied CLI input treated as high-trust after schema conformance. Session-derived lower-trust constraints are future adapter work requiring: a trust-level mechanism, per-constraint validation, and a refined safety-override spec. Existing safety-override behavior (safety wins over any conflicting constraint) is unchanged. Do not add `constraintTrustLevel` or session-constraint validation in MVP. See §2.8 non-MVP boundary note.

6. ~~**`selectorSummary` narrative generation.**~~ **Resolved/reference Pass 4.5B.** In MVP, `selectorSummary.narrative` is generated by the Selector Orchestration output phase using a fixed deterministic template string populated from count fields. Model-generated narrative is future-only. See §3.6 for the canonical template, template rules, required fields, and the future-only note. No further action needed.

7. ~~**Future `unavailable` action for runtime-unavailable tools.**~~ **Resolved/reference Pass 4.8E-2A (5-Q7 / F-28 — safe-defer).** Decision: MVP keeps `action: defer` + `path: runtime_unavailable`. A dedicated `action: unavailable` is future-only and must not be added to the action enum. A future `deferSubtype` plan field may be considered only if harness or schema requirements prove it necessary. In MVP, harnesses distinguish defer subtypes by filtering `deferredComponents[]` on `path`. The `path` field is required on every `deferredComponents[]` entry. See §4 `path` table `runtime_unavailable` row and key rules harness note.

8. ~~**Scoped evaluation policy.**~~ **Resolved/reference Pass 4.8D (5-Q8, F-29).** Decision: `candidateSetPolicy` is defined as an **internal orchestrator constant** with MVP value `all_non_quarantined`. The candidate set is all components in `registryIndexes.componentsById` after registry validation and quarantine exclusion. The orchestrator emits a `candidateSetSummary` record (fields: `candidateSetPolicy`, `candidateSetSize`, `quarantinedExcluded`) into the `registryPhase` of `trace.json` before selector fan-out begins. The gap-check denominator is `candidateSetSize` from this summary, not a hard-coded full-registry count. If an unsupported `candidateSetPolicy` value is supplied, halt with `unsupported_candidate_set_policy` error — do not silently fall back. Future extension values (`by_type`, `by_prompt_family`, `explicit_component_ids`) are named for future reference only; do not implement in MVP. See §3.1 for the canonical wording and harness checks.

---

## 6. Pass 1.3 Definition of Done

- [x] Purpose defined: what Selector Orchestration does and does not do
- [x] Fail-open rule stated at module level
- [x] Purpose wording aligned with multi-selector output: one or more decisions per candidate; conflicts resolved downstream by Conflict Resolver
- [x] All 9 inputs defined: meaning, source, MVP shape, trust level, failure modes, fail-open behavior
- [x] Input strictness classes defined: hard-required (Class A) vs defaultable/fail-open (Class B) with table of each input and its failure behavior
- [x] "Halt on missing required inputs" narrowed to Class A inputs only; Class B inputs default with mandatory warnings
- [x] Duplicate markdown separator between Input Strictness Classes and Section 2.1 removed
- [x] User text as untrusted evidence (not instruction) stated explicitly in `requestSignals`
- [x] Injection-suspect handling described at input level; detection responsibility attributed to Request Router only
- [x] `injectionSuspectPatterns` removed from `selectorPolicy`; replaced with `injectionSuspectAction` (how to react to the pre-computed signal)
- [x] `runtimeCapabilities` MVP meaning scoped to tool availability only; broader capability flags (model calls, file I/O, memory, network) noted as future extensions
- [x] `runtimeCapabilities` MVP shape: `availableToolIds`, `unavailableToolIds`, `capabilityInventoryComplete`, `runtimeLabel`
- [x] `runtimeCapabilities` semantics defined: confirmed available, confirmed unavailable, unknown (fail-open)
- [x] `runtime_unavailable` path: `action: defer` only, never `action: omit`; no token savings claimed; planning warning emitted
- [x] `not_evaluated` path added: orchestrator-emitted for silently skipped candidates; always produces `action: include`, `path: fail_open`, `confidence: low`
- [x] Candidate component set defined: all valid non-quarantined components from `registryIndexes.componentsById` in MVP
- [x] Gap detection requirement stated: orchestrator checks for unevaluated candidates after fan-out, before Conflict Resolver
- [x] All 6 outputs defined: meaning, shape, privacy rules, downstream consumers
- [x] `selectorSummary` defer counters split by subtype: `decidedDefer` (total), `defaultDefer` (`path: default_defer`), `runtimeUnavailableDefer` (`path: runtime_unavailable`)
- [x] SelectionDecision object defined: all 10 fields with meaning, allowed values, required status, example
- [x] All `action` values defined with meaning
- [x] All `path` values defined with meaning and valid `action` pairing
- [x] Omission constraint stated: only Path A and Path B are valid omission paths; `runtime_unavailable` is not a third omission path
- [x] `reference_unknown` behavior stated: never silently ignored
- [x] Evidence rule stated: `omit` with empty `evidence[]` is a planning error
- [x] `confidence` values defined; fail-open threshold behavior specified
- [x] No raw content in trace stated explicitly
- [x] 8 open questions listed relevant to inputs/outputs
- [x] No selector ladder written
- [x] No conflict resolution logic written
- [x] No tool/skill/history/runtime/budget selector rules written
- [x] No model-assisted selector rules written
- [x] No code implemented
- [x] No JSON Schema files created
- [x] No runtime system touched
- [x] No OpenClaw state modified


---

## 7. Selector Types

In MVP, Selector Orchestration runs a set of **deterministic selector modules** during fan-out. Each module is responsible for a specific component type domain. Selectors are stateless — they receive their typed input slice, apply the deterministic ladder (Section 8), and emit SelectionDecision records. They do not share state with each other.

**Fan-out rule (primary selector ownership):** Each component has exactly one **primary selector** determined by its validated `type`. The primary selector is responsible for producing at least one SelectionDecision for that component in every planning run. A component with `type: scaffold` is owned by the scaffold selector; a component with `type: tool` is owned by the tool selector; and so on. The SelectionDecision contract (Section 3.1) allows one or more decisions per candidate component — additional cross-cutting decisions may be produced by future policy or runtime-layer selectors for the same component, and if they exist, they are preserved and forwarded to the Conflict Resolver. In MVP, only primary-selector decisions are produced.

> **Multi-role component authoring rule (9-Q3 resolved, Pass 4.8D):** A component that conceptually serves multiple roles (e.g., both scaffold structure and policy enforcement) must be registered with exactly one canonical `type` — the most safety-relevant role. Multi-role behavior is resolved at registry authoring time by either choosing the most appropriate primary `type` or splitting the conceptual component into separate registry entries, each with its own canonical `type`. No inter-selector handoff mechanism exists in MVP. A component must be evaluated by exactly one primary selector for its canonical `type`. If a component were independently evaluated by multiple primary selectors due to a multi-role interpretation, that would be a type-ownership violation.

**Unrecognized component types:** All component types are validated by the registry loader before selector fan-out begins. An unrecognized `type` is a registry validation defect, not a selector concern. If a component with an unrecognized type somehow appears after registry validation (indicating a core-boundary defect), the orchestrator must: (1) not route it to any selector including scaffold; (2) emit a `unexpected_component_type_after_validation` planning error; (3) produce a synthetic `action: include`, `path: fail_open`, `confidence: low` decision so the component is not silently dropped; and (4) flag it in `planningWarnings` for evaluation. This must never happen in correct MVP operation.

**MVP selector implementation:** Deterministic only. Model-assisted selectors are future-only and are not defined in this pass.

---

### 7.1 Scaffold Selector

**Responsibility:** Evaluate all components with `type: scaffold` — static structural context injected at the start of a prompt. Persona blocks, general instructions, behavioral rules.

**Input fields used:** `promptFamily`, `requestSignals`, `componentsById` (for scaffold-typed components), `userConstraints`, `budgetState` (informational only), `selectorPolicy`.

**Component types handled:** `scaffold` only. Unrecognized component types are a registry validation defect and are not routed here — see Section 7 fan-out rule.

**Output decision shape:** SelectionDecision per scaffold component with `selectorName: "deterministic_scaffold"`. Action is one of: `include`, `omit`, `defer`, `reference_unknown`. `quarantine` is not a selector action in MVP (see §4 F-17 note).

**Special safety boundaries:**
- Components with `retainPolicy: safety_critical` or `omissionPolicy: never` must be included regardless of prompt family. The scaffold selector must not omit them even if `safeToOmitWhen` matches.
- Components with `riskLevel: critical` are treated as mandatory include at this selector level.

**MVP behavior:** Applies the deterministic ladder (Section 8) against scaffold components. No model calls. Tag matching is exact string equality against `promptFamily`.

**Future behavior:** Hybrid mode — deterministic ladder first; model-assisted classification fills gaps for components where no tag matches and `riskLevel` permits model involvement.

---

### 7.2 Skill Selector

**Responsibility:** Evaluate all components with `type: skill` — callable behavior blocks or procedural instruction sets (e.g., `code_review_skill`, `web_search_skill`).

**Input fields used:** `promptFamily`, `requestSignals`, `componentsById` (skill-typed), `userConstraints`, `selectorPolicy`.

**Component types handled:** `skill`.

**Output decision shape:** SelectionDecision per skill component with `selectorName: "deterministic_skill"`.

**Special safety boundaries:**
- Skills with `riskLevel: high` must not be omitted in MVP without explicit strong positive evidence.
- A skill that is required (`requiredWhen` matches) must be included even if the budget is under pressure — budget trimming is the Budgeter's job, not the skill selector's.

**MVP behavior:** Deterministic ladder only. Detailed skill-specific signal rules (e.g., skill relevance scoring) are deferred to Pass 3.

**Future behavior:** Model-assisted relevance scoring for skills where no tag matches but request semantics suggest relevance.

---

### 7.3 Tool Selector

**Responsibility:** Evaluate all components with `type: tool` — tool schema definitions. Determines which tool definitions should appear in the prompt plan.

**Input fields used:** `promptFamily`, `requestSignals`, `componentsById` (tool-typed), `runtimeCapabilities`, `userConstraints`, `selectorPolicy`.

**Component types handled:** `tool`.

**Output decision shape:** SelectionDecision per tool component with `selectorName: "deterministic_tool"`.

**Special safety boundaries:**
- **Runtime availability pre-check (before ladder):** Tool availability must be checked against `runtimeCapabilities` before the deterministic ladder runs. A tool confirmed unavailable (in `unavailableToolIds`, or absent from both lists when `capabilityInventoryComplete: true`) must receive `action: defer`, `path: runtime_unavailable`. This pre-check runs before Step 3 (hard include protections) because including a confirmed-unavailable tool as if it were available is a runtime-correctness error regardless of retain policy. A `defer` does not count as omission and does not create a third omission path.
- **Hard-protected unavailable tools:** If a confirmed-unavailable tool also has a hard protection marker (`retainPolicy: mandatory`, `retainPolicy: safety_critical`, `omissionPolicy: never`, or `riskLevel: critical`), the selector must still emit `action: defer`, `path: runtime_unavailable`, AND emit a `hard_protected_tool_unavailable` planning warning. The hard protection does not convert an unavailable tool to available — it signals that the registry metadata and runtime state are inconsistent and require human review.
- Unknown availability (`capabilityInventoryComplete: false` + absent from both lists) → fail-open include with `runtime_capability_unknown` warning. The ladder then runs normally.
- Tool components with `riskLevel: high` must not be omitted without strong positive evidence.

**MVP behavior:** Deterministic ladder + capability check. Detailed per-tool-type rules deferred to Pass 3.

**Future behavior:** Adapter-supplied live capability probe replaces manually authored `runtimeCapabilities`.

---

### 7.4 History Selector

**Responsibility:** Evaluate all components with `type: history` — history lane descriptor metadata entries. Works in conjunction with the History Lane Manager's `historyStateSummary`.

**Input fields used:** `promptFamily`, `historyStateSummary`, `componentsById` (history-typed), `budgetState` (informational), `userConstraints`, `selectorPolicy`.

**Component types handled:** `history`.

**Output decision shape:** SelectionDecision per history component with `selectorName: "deterministic_history"`.

**Special safety boundaries:**
- Components representing `durable_constraints` or `open_commitments` lanes must never be omitted regardless of budget pressure. They must carry `retainPolicy: safety_critical` or `omissionPolicy: never` in the registry, and the history selector enforces this.
- If `historyStateSummary.historyMalformed: true`, the history selector fails open — include all history components with `riskLevel: high` or `retainPolicy` ≠ `optional`.

**MVP behavior:** Deterministic ladder against lane metadata descriptors. Detailed lane-level history rules deferred to Pass 3.

**Future behavior:** Model-assisted lane classification replaces manual `lane` tags on history turns.

---

### 7.5 Memory Selector

**Responsibility:** Evaluate all components with `type: memory` — distilled or persistent memory entries (KI-style summaries, project facts).

**Input fields used:** `promptFamily`, `requestSignals`, `componentsById` (memory-typed), `userConstraints`, `selectorPolicy`.

**Component types handled:** `memory`.

**Output decision shape:** SelectionDecision per memory component with `selectorName: "deterministic_memory"`.

**Special safety boundaries:**
- Stale memory (indicated by `hash_drift` flag from registry) must emit a `stale_memory` planning warning. The decision to include or omit still follows the ladder; staleness is evidence, not an automatic omit.
- Memory components with `riskLevel: high` must not be omitted without strong evidence.

**MVP behavior:** Deterministic ladder. No automated staleness detection in MVP (hash drift is flagged by the registry loader, not computed live).

**Future behavior:** Relevance scoring against request semantics; time-decay signals in `budgetPriority`.

---

### 7.6 Policy Selector

**Responsibility:** Evaluate all components with `type: policy` — safety, privacy, and behavior constraint blocks.

**Input fields used:** `promptFamily`, `componentsById` (policy-typed), `userConstraints`, `selectorPolicy`.

**Component types handled:** `policy`.

**Output decision shape:** SelectionDecision per policy component with `selectorName: "deterministic_policy"`.

**Special safety boundaries:**
- Policy components are the most likely to carry `retainPolicy: safety_critical` or `omissionPolicy: never`. The policy selector must apply hard-include protection at ladder step 3 before any other evaluation.
- A `userConstraints.neverInclude` entry on a policy component triggers `safety_override` — user constraint cannot remove a safety-critical policy component. This must be logged.
- The policy selector must never omit a policy component solely based on prompt family unless all Path A gates are satisfied AND the component has `riskLevel: low` or `medium`.

**MVP behavior:** Deterministic ladder with explicit priority on hard-include steps. No model involvement.

**Future behavior:** Dynamic policy profile selection based on session context (e.g., regulated vs. unregulated environments).

---

### 7.7 Output Format Selector

**Responsibility:** Evaluate all components with `type: output_format` — instructions governing response formatting (JSON schema, markdown rules, structured output templates).

**Input fields used:** `promptFamily`, `requestSignals`, `componentsById` (output_format-typed), `userConstraints`, `selectorPolicy`.

**Component types handled:** `output_format`.

**Output decision shape:** SelectionDecision per output_format component with `selectorName: "deterministic_output_format"`.

**Special safety boundaries:**
- If no output_format component is included and the prompt family is one that requires structured output (e.g., `tool_use_required`), the selector must emit a `no_output_format_selected` planning warning. This is not a halt — the Prompt Plan Generator must surface it.
- Output format components are generally lower risk (`riskLevel: low` or `medium`) but may be `retainPolicy: mandatory` for certain prompt families.

**MVP behavior:** Deterministic ladder. Prompt-family-to-format mapping is driven by `requiredWhen` tags in component metadata.

**Future behavior:** Dynamic format selection based on downstream consumer (e.g., different format for API response vs. human chat).

---

### 7.8 Runtime Capability Selector

**Responsibility:** Evaluate all components with `type: runtime_capability` — declarations of what the runtime can and cannot do. These differ from `tool` components: they describe the runtime environment, not individual tool schemas.

**Input fields used:** `promptFamily`, `runtimeCapabilities`, `componentsById` (runtime_capability-typed), `userConstraints`, `selectorPolicy`.

**Component types handled:** `runtime_capability`.

**Output decision shape:** SelectionDecision per runtime_capability component with `selectorName: "deterministic_runtime_capability"`.

**Special safety boundaries:**
- Runtime capability declarations that are inaccurate can cause the model to plan for unavailable capabilities. If `runtimeCapabilities` is missing or `capabilityInventoryComplete: false`, the selector fails open — include all runtime_capability components with `riskLevel: high` or `retainPolicy` ≠ `optional`.
- Do not omit a runtime_capability component that describes a restriction (e.g., "no file write access") — omitting restrictions is more dangerous than omitting permissions.

**MVP behavior:** Deterministic ladder. `runtimeCapabilities` input is manually authored; no live probe.

**Future behavior:** Adapter-supplied live capability declarations; versioned capability snapshots per planning run.

---

## 8. Deterministic Decision Ladder

The deterministic decision ladder defines the exact evaluation order applied by each selector to every candidate component in its domain. Steps are applied in order; evaluation stops at the first matching step.

**Ladder scope:** Applies within a single selector's evaluation of a single component. The ladder does not resolve conflicts between selectors — that is the Conflict Resolver's job.

**Ladder invariants (unconditional):**
- No omission outside Path A (Step 7) or Path B (Step 8). Any `omit` action produced via a different step is a planning error.
- `requiredWhen` always beats `safeToOmitWhen`. A component cannot be omitted if its `requiredWhen` tags match the current prompt family, regardless of `safeToOmitWhen`.
- Hard protections (`safety_critical`, `mandatory`, `omissionPolicy: never`, `riskLevel: critical`) beat all ladder rules **after any type-specific pre-checks have run**. For `type: tool`, confirmed runtime unavailability is a pre-ladder runtime-correctness check that runs before Step 3: a confirmed-unavailable tool produces `action: defer`, `path: runtime_unavailable` — even if it also has a hard protection marker. The hard protection does not convert an unavailable tool to available; if both apply, emit `hard_protected_tool_unavailable`. This is not omission. See Section 7.3 for detail.
- Low-confidence `omit` is invalid in MVP. A selector that cannot produce `confidence: high` or `medium` for an `omit` decision must fail open.
- Unknown component IDs are never silently ignored — they produce `action: reference_unknown` and appear in `referencedUnknownComponents`.
- `runtime_unavailable` produces `action: defer` only, never `action: omit`.
- Budget pressure does not appear in this ladder as an omission justification. Budget enforcement is the Budgeter's responsibility after the selector phase.

---

### Step 1 — Quarantine Boundary Violation Detection

**Decision (F-17 resolved, Pass 4.7A — Option A):** Quarantine is a **registry-phase state**, not a selector action. In correct MVP operation, quarantined components are excluded from `componentsById` before selector fan-out begins and therefore never reach any selector. A component ID that appears in the fan-out candidate set but is also present in `registryIndexes.quarantinedComponents` represents a **planning boundary violation** — the registry guarantee has been breached. This is not a normal selector decision scenario.

**Condition:** A component ID appears in the selector fan-out candidate set but is also present in `registryIndexes.quarantinedComponents` (indicating it was not correctly excluded from `componentsById` at registry load time). This must never happen in correct MVP operation.

**Action:** `include`
**Path:** `quarantine_boundary_violation`
**Confidence:** `low`
**Trace requirement:** Emit an `unexpected_quarantine_reference` planning **error** (not a warning — this is a core-boundary defect) with `componentId`, `selectorName`, and a reference to the registry's `component_quarantined` trace entry via `traceRefs`. Add to `planningWarnings` with severity `error`.
**Fail-open behavior:** The component is included with `action: include`, `path: quarantine_boundary_violation`, `confidence: low`. It must **not** be silently omitted or silently dropped — the boundary violation must be visible in the trace and plan output. The fail-open include is a safety net, not an endorsement of the component's validity. The Evaluation Harness must flag any occurrence of `path: quarantine_boundary_violation` as a registry-boundary defect that requires investigation.

> **Note on trace representation:** Quarantine events under correct MVP operation are recorded only in the registry phase (`registryPhase` of `trace.json`) via `component_quarantined` trace entries — not in the selector phase. The selector phase does not count quarantined components in its statistics or summary. Quarantined components are not counted as budget savings, not included in `decidedOmit`, and not included in any selector count. They are separate registry-phase events.

> **Note on unknown IDs vs. quarantine boundary violation:** A quarantined component is a **validated-but-excluded** component — the registry loaded and validated it but determined it was malformed. An unknown component reference (`action: reference_unknown`, Step 2) is an ID the registry has **never seen** at all. These are different error classes with different implications for safety and trace fidelity. Do not merge them.

---

### Step 2 — Unknown Component Reference

**Condition:** The component ID referenced (e.g., via `userConstraints.alwaysInclude` or an explicit caller flag) does not appear in `componentsById`.

**Action:** `reference_unknown`
**Path:** `reference_unknown`
**Trace requirement:** Emit a `reference_unknown` trace entry with the unknown `componentId`, `referencedBy` (which input or caller flag referenced it), and `selectorName`. Add to `referencedUnknownComponents` output.
**Fail-open behavior:** Do not include and do not omit. Surface in planning warnings and `referencedUnknownComponents`. The Prompt Plan Generator must include these in `riskFlags`.

---

### Step 3 — Hard Include Protections

**Condition:** The component has any of the following:
- `retainPolicy: safety_critical`
- `retainPolicy: mandatory`
- `omissionPolicy: never`
- `riskLevel: critical`

**Action:** `include`
**Path:** `safety_override` — always, for all four hard-protection conditions listed above, regardless of whether `requiredWhen` also matches the current `promptFamily`. The `required_match` path is **not** used for Step 3 hard-protection firings even when `retainPolicy: mandatory` coincides with a `requiredWhen` match; Step 3 fires first, and the `path` must be `safety_override` unconditionally. This makes hard-protection decisions unambiguously distinguishable from ordinary `requiredWhen`-driven includes (Step 5) in both the trace and the Evaluation Harness.

> **Secondary reason preservation:** If `requiredWhen` also matched the current `promptFamily` at the time Step 3 fired, the selector must additionally record this in `SelectionDecision.evidence[]` using the existing trace atom syntax already established for Step 5: `"requiredWhen=<matched_tag>"` and `"promptFamily=<value>"`. These are **trace atoms in `evidence[]`** — they are not `evidenceRequired` governance atoms (Registry spec §7) and do not create new atom grammar. The `constraintsApplied[]` field records the specific hard-protection field that governed the decision (e.g., `"retainPolicy=mandatory"`). No new fields and no new `evidenceRequired` governance additions are required. The secondary reason does not change the `path` — `path: safety_override` is unconditional.

**Harness rule:** Any `path: required_match` decision produced by Step 3 of the ladder is a harness failure. `required_match` is valid only for `requiredWhen`-driven include paths at Steps 5 and 6, never for Step 3 hard-protection firings.
**Trace requirement:** Emit trace entry with the specific protection field and value that triggered this step (e.g., `"retainPolicy=safety_critical"`, `"omissionPolicy=never"`). This makes the protection auditable.
**Fail-open behavior:** Not applicable — this step always produces `include`. No later step may produce `omit` for this component. If a later step would produce `omit` (e.g., from a model-assisted selector in future), it must be overridden to `include` and logged as `safety_override`.

---

### Step 4 — Both `requiredWhen` and `safeToOmitWhen` Match (Conflict)

**Condition:** The current `promptFamily` appears in **both** `requiredWhen` and `safeToOmitWhen`. This is a registry data quality issue. **This step must be checked before the plain `requiredWhen` match (Step 5)** so that the conflict is always traced — if plain `requiredWhen` ran first, it would produce `include` silently without surfacing the conflict.

**Action:** `include`
**Path:** `conflict_include`
**Trace requirement:** Emit a `conflicting_tags` trace entry with the component ID, prompt family, and both matching lists. Add a `planning_warning` with code `conflicting_tags`. The conflict is recorded for the Conflict Resolver's awareness, but the selector must not omit the component.
**Fail-open behavior:** Conflict resolves to `include`. The registry author should review the component's tag configuration. This step guarantees `requiredWhen` beats `safeToOmitWhen` in the conflict case — Path A (Step 7) cannot be reached by a component that matches `requiredWhen`.

---

### Step 5 — `requiredWhen` Match

**Condition:** At least one tag in the component's `requiredWhen` array is string-equal to the current `promptFamily`. The current `promptFamily` does NOT also appear in `safeToOmitWhen` (if it did, Step 4 would have matched first). No hard protection from Step 3 applies.

**Action:** `include`
**Path:** `required_match`
**Trace requirement:** Emit trace entry with the matched tag and the `promptFamily` value. Evidence must include `"requiredWhen=<tag>"` and `"promptFamily=<value>"`.
**Fail-open behavior:** Not applicable — `requiredWhen` match produces `include` unconditionally at this step. `defaultAction: omit` cannot override a `requiredWhen` match.

---

### Step 6 — Active User, Safety, or Privacy Constraint Requires Inclusion

**Condition:** The component ID appears in `userConstraints.alwaysInclude`, or an active safety/privacy rule in the current planning context mandates inclusion independent of `requiredWhen`.

**Action:** `include`
**Path:** `safety_override` if driven by a safety or privacy rule; `required_match` if driven by `userConstraints.alwaysInclude` (since it is an explicit inclusion requirement analogous to a hard required match).
**Trace requirement:** Emit trace entry identifying the constraint source (e.g., `"userConstraints.alwaysInclude"`, `"active_privacy_rule"`). Log `constraintsApplied` field of the SelectionDecision with the constraint description.
**Fail-open behavior:** Not applicable — the constraint produces `include`. If the constraint conflicts with a `neverInclude` entry on the same component, safety wins: include and log `safety_override_constraint_conflict`.

---

### Step 7 — Path A: Explicit Safe-Omit

**Condition:** All of the following must hold:
1. `safeToOmitWhen` contains the current `promptFamily` (exact string match).
2. `evidenceRequired` is either `null` (no additional evidence required) or a recognized expression whose atoms are all satisfied by current signals.
3. `omissionPolicy` is `allow`.
4. `retainPolicy` is `optional`.
5. `riskLevel` is `low` or `medium`.
6. No step 3–6 include rule applies (checked by reaching this step). Critically: if `requiredWhen` also matches the `promptFamily`, Step 4 or Step 5 would have fired already — `safeToOmitWhen` cannot be reached when `requiredWhen` also matches.
7. Selector confidence is `high` or `medium` (a `low`-confidence omit is invalid in MVP and must fall to step 11).

**Action:** `omit`
**Path:** `safe_to_omit_match`
**Confidence:** `high` or `medium` required; `low` is invalid for any omit.
**Trace requirement:** Evidence must be non-empty and must include at minimum: the matched `safeToOmitWhen` tag, the `promptFamily`, and the `omissionPolicy` value. If `evidenceRequired` is `null`, the evidence array must include a note: `"evidenceRequired=null; safeToOmitWhen match is sufficient per registry definition"`. Additionally, when `evidenceRequired` is `null`, the selector must emit the `path_a_null_evidence` warning code in `SelectionDecision.warnings` (per-decision warning — not a global planning warning). This code allows the Evaluation Harness to distinguish intentional null-evidence omissions (registry author explicitly set `evidenceRequired: null`) from accidental ones (evidence expression missing by error). Registry semantics are unchanged: `evidenceRequired: null` means no additional evidence expression beyond the standard Path A gates is required — it does not mean omission is blocked. If `evidenceRequired` is a satisfied expression, each atom must appear in evidence; the `path_a_null_evidence` code is not emitted.
**Fail-open behavior:** If `evidenceRequired` grammar is not recognized (invalid in MVP), Path A is disabled for this component. Do not proceed to omit — fall to step 9 or 11.

---

### Step 8 — Path B: Default Irrelevant-Omit

**Condition:** All of the following must hold:
1. `requiredWhen` does NOT contain the current `promptFamily`.
2. `safeToOmitWhen` does NOT contain the current `promptFamily`.
3. `defaultAction` is `omit`.
4. `omissionPolicy` is `allow`.
5. `retainPolicy` is `optional`.
6. `riskLevel` is `low` or `medium`.
7. No step 3–6 include rule applies.
8. Selector confidence is `high` or `medium`.

**Action:** `omit`
**Path:** `default_action_omit`
**Confidence:** `high`. Path B is fully deterministic — all conditions must hold exactly before this step fires. The confidence describes selector-rule certainty, not registry-author judgment quality. The registry author's `defaultAction: omit` judgment is opaque, but once the registry fields are valid the rule fires unconditionally, making the decision `confidence: high`. A `medium` or `low` confidence Path B omit is a planning error.
**Trace requirement:** Evidence must include: `"requiredWhen=no_match"`, `"safeToOmitWhen=no_match"`, `"defaultAction=omit"`, `"omissionPolicy=allow"`, and the `promptFamily` value. `evidenceRequired` is not evaluated in Path B — do not reference it in evidence.
**Fail-open behavior:** If any Path B condition fails (e.g., `riskLevel` is `high`, or `retainPolicy` is `durable`), Path B is unavailable. Fall to step 9, 10, or 11.

---

### Step 9 — `defaultAction: include`

**Condition:** No earlier step produced a decision. `defaultAction` is `include` (or is absent — treat absent as `include`).

**Action:** `include`
**Path:** `default_include`
**Trace requirement:** Emit trace entry noting that no tag matched and `defaultAction: include` was applied. Evidence: `"requiredWhen=no_match"`, `"safeToOmitWhen=no_match"`, `"defaultAction=include"`.
**Fail-open behavior:** This step itself is the fail-open default for most components that have no matching rule.

---

### Step 10 — `defaultAction: defer`

**Condition:** No earlier step produced a decision. `defaultAction` is `defer`.

**Action:** `defer`
**Path:** `default_defer`
**Trace requirement:** Emit trace entry with `"defaultAction=defer"` and `promptFamily`. This must not be counted as an omission. No token savings claim.
**Fail-open behavior:** `defer` is a safe non-decision. The component is excluded from this plan turn but not treated as omitted.

---

### Step 11 — `omissionPolicy: fail_open` or Insufficient Evidence

**Condition:** Any of the following:
- `omissionPolicy` is `fail_open` and no clear omit signal exists.
- Selector confidence would be `low` for any omit action.
- `evidenceRequired` grammar was invalid (Path A disabled).
- `riskLevel` is `high` and no positive omit evidence exists.
- No Path A or Path B condition was met and `defaultAction` is not `include` or `defer`.

**Action:** `include`
**Path:** `fail_open`
**Trace requirement:** Emit trace entry with `"failOpen=true"` and a human-readable reason (e.g., `"omissionPolicy=fail_open"`, `"confidence=low"`, `"evidenceRequired grammar invalid"`). This entry must be flagged in `selectorTrace` so the Evaluation Harness can verify fail-open correctness.
**Fail-open behavior:** This step is itself the fail-open. It must never produce `omit`.

---

### Step 12 — Final Fallback

**Condition:** No earlier step matched (should not occur if ladder is implemented correctly, but included as a safety net).

**Action:** `include`
**Path:** `fail_open`
**Trace requirement:** Emit trace entry with `"failOpen=true"`, `"reason=ladder_fallback"`, and a planning warning `unexpected_ladder_fallback`. The Evaluation Harness must flag any occurrence of this path as a ladder implementation defect.
**Fail-open behavior:** Always `include`. A ladder fallback reaching this step indicates a gap in the ladder conditions — it must never silently omit.

---

## 9. Pass 2 Open Questions

1. ~~**Should `quarantine` remain a SelectionDecision action or be treated as pre-fan-out registry state only?**~~ **Resolved/reference Pass 4.7A (F-17).** Decision: `quarantine` is **registry-phase state only** in MVP. It is not a valid `SelectionDecision.action`. Quarantined components are excluded from `componentsById` before selector fan-out and never reach selectors in correct MVP operation. Step 1 of the ladder has been updated to boundary-violation detection (not quarantine action production): if a quarantined ID is detected in fan-out despite the registry guarantee, the orchestrator produces `action: include`, `path: quarantine_boundary_violation`, `confidence: low` and emits an `unexpected_quarantine_reference` planning error. Quarantine may be revisited for future non-MVP scenarios (e.g., streaming registry). See §4 F-17 note and §8 Step 1 for the canonical wording.

2. ~~**Should hard-include Step 3 always use `safety_override` or should `mandatory` components use a distinct path?**~~ **Resolved/reference Pass 4.8D (9-Q2).** Decision: Step 3 always emits `path: safety_override` for all four hard-protection conditions (`retainPolicy: safety_critical`, `retainPolicy: mandatory`, `omissionPolicy: never`, `riskLevel: critical`). The former exception allowing `required_match` when `retainPolicy: mandatory` coincides with a `requiredWhen` match has been removed. If `requiredWhen` also matched, the secondary match is preserved as trace atoms in `SelectionDecision.evidence[]` and `constraintsApplied[]` using existing fields — no new atom grammar or new fields. Any `path: required_match` produced by Step 3 is a harness failure. See §8 Step 3 for the canonical wording.

3. ~~**How should ownership be assigned when a component's `type` is relevant to multiple selector domains?**~~ **Resolved/reference Pass 4.8D (9-Q3).** Decision: Each component has exactly one canonical `type`; the primary selector for that `type` is the sole evaluator. Registry authors must resolve multi-role intent at authoring time by choosing the most safety-relevant `type` or by splitting into separate registry entries. No inter-selector handoff mechanism exists or is planned for MVP. A component appearing in independent evaluations from multiple primary selectors due to a multi-role interpretation is a type-ownership violation. See §7 fan-out rule for the canonical wording.

4. ~~**Does Path A with `evidenceRequired: null` need a dedicated warning code?**~~ **Resolved/reference Pass 4.8B.** Decision: yes — a distinct per-decision warning code `path_a_null_evidence` is emitted in `SelectionDecision.warnings` whenever Path A authorizes an omit with `evidenceRequired: null`. This allows the Evaluation Harness to distinguish intentional null-evidence omissions (registry author explicitly set `evidenceRequired: null`) from accidental ones. It is a selector-phase per-decision warning, not a global planning warning. Registry semantics are unchanged: `evidenceRequired: null` means no additional evidence expression beyond the standard Path A gates is required. See §8 Step 7 for the canonical trace requirement.

5. ~~**What is the correct `confidence` level for Path B omissions?**~~ **Resolved/reference Pass 4.8B.** Decision: `confidence: high` for all Path B (`default_action_omit`) omissions. Rationale: Path B is fully deterministic — all conditions must hold exactly before the step fires (`requiredWhen` no match, `safeToOmitWhen` no match, `defaultAction: omit`, `omissionPolicy: allow`, `retainPolicy: optional`, `riskLevel: low|medium`). Once registry fields are valid the rule fires unconditionally. Confidence describes selector-rule certainty, not registry-author judgment quality. A `medium` or `low` confidence Path B omit is a planning error. See §8 Step 8 for the canonical wording.

---

## 10. Pass 2.4 Definition of Done

- [x] Section 7: Selector Types defined — 8 selector modules (scaffold, skill, tool, history, memory, policy, output_format, runtime_capability)
- [x] Each selector type has: responsibility, input fields used, component types handled, output decision shape, special safety boundaries, MVP behavior, future behavior
- [x] Unrecognized component types not routed to scaffold — defined as registry validation defect; orchestrator emits `unexpected_component_type_after_validation` and produces fail-open include
- [x] Scaffold selector handles `type: scaffold` only — unrecognized types removed from its domain
- [x] Tool selector runtime availability pre-check defined: runs before deterministic ladder; confirmed-unavailable → `defer/runtime_unavailable`; hard-protected + unavailable → `defer` + `hard_protected_tool_unavailable` warning
- [x] Policy selector enforces hard-include at step 3 before any other evaluation
- [x] History selector fails open when `historyStateSummary.historyMalformed: true`
- [x] Section 8: Deterministic Decision Ladder defined — 12 steps
- [x] Every ladder step defines: condition, action, path, trace requirement, fail-open behavior
- [x] Ladder invariants stated explicitly (7 unconditional rules)
- [x] Ladder hard-protection invariant updated: tool runtime pre-check exception stated; hard protections apply after type-specific pre-checks
- [x] No omission outside Path A (Step 7) or Path B (Step 8)
- [x] Conflict check (Step 4) now precedes plain `requiredWhen` match (Step 5) — conflict is always traced
- [x] `requiredWhen` beats `safeToOmitWhen` — enforced at steps 4 and 5 before Path A (Step 7)
- [x] Path A (Step 7) guard condition explicitly states: unreachable when `requiredWhen` also matches
- [x] Hard protections at step 3 beat all ladder rules after pre-checks — stated as invariant
- [x] Low-confidence `omit` invalid in MVP — stated as invariant and enforced at Steps 7 and 8
- [x] `runtime_unavailable` produces `defer` only — stated as invariant
- [x] Budget pressure absent from ladder — stated as invariant
- [x] `evidenceRequired: null` evidence trace requirement specified at Step 7
- [x] Path B explicitly does not evaluate `evidenceRequired` — stated at Step 8
- [x] Final fallback step 12 defined as a ladder defect detector
- [x] `path: quarantine_boundary_violation` added to Section 4 path values table (replaces former `path: quarantine`; F-17 resolved Pass 4.7A — quarantine is registry-phase state, not a selector action in MVP)
- [x] Section 9: 5 Pass 2 open questions listed
- [x] Section 10: This checklist
- [x] Primary selector ownership defined without contradicting multi-decision SelectionDecision contract
- [x] Runtime-unavailable tool pre-check clarified: runs before Step 3, produces `defer` not `omit`, does not create a third omission path
- [x] Hard-protected unavailable tool scenario defined: `defer` + `hard_protected_tool_unavailable` warning
- [x] All active Path A / Path B step references consistent: Path A = Step 7, Path B = Step 8
- [x] Model-assisted selector wording corrected: future-only, not defined in this pass
- [x] Pass 3 scope excludes model-assisted selector sandboxing (deferred to a later future pass)
- [x] DoD heading aligned with file version (Pass 2.4)
- [x] No conflict resolution section written
- [x] No per-tool/per-skill/per-history detailed rules written (deferred to Pass 3)
- [x] No model-assisted selector rules written
- [x] No code implemented
- [x] No JSON Schema files created
- [x] No runtime system touched
- [x] No OpenClaw state modified

**Pass 3 scope:**
- Conflict resolution priority table and resolution algorithm
- Per-selector-type detailed deterministic signal rules (tool availability scoring, skill relevance, history lane rules)
- Injection-suspect ladder integration
- Budget-aware selector hints (informational only, not enforcing)

**Future pass (beyond Pass 3):**
- Model-assisted selector sandboxing, output schema validation, and confidence calibration

---

## 11. Conflict Resolution

### 11.1 Purpose

Conflict Resolution is the sub-phase that runs after selector fan-out completes. It consumes all SelectionDecision records and produces one **resolved decision per candidate component**. In MVP, every component that received more than one decision — or whose single decision carried a `conflict_include` path — must pass through this phase. Components with a single unambiguous decision (no conflict) are accounted for in `noConflictComponentIds` and do not emit full `conflictResolutionTrace` entries.

**What Conflict Resolution does:**
- Accepts all SelectionDecision records for a component as a set
- Applies the conflict priority order (Section 11.4) to select one final action/path
- Records every losing decision and the priority rule used to defeat it
- Emits a full `conflictResolutionTrace` entry for every component with an **actual conflict** (more than one input decision or a `conflict_include` path)
- For components with a single unambiguous decision (no conflict), records the component ID only in `noConflictComponentIds` — no full trace entry (see §11.3.2)
- Surfaces unresolvable conflicts as `unresolvedConflictWarnings` and resolves them fail-open

**What Conflict Resolution does not do:**
- Does not re-run selectors or re-evaluate component metadata
- Does not produce `omit` unless an existing valid Path A or Path B omit decision is present and no higher-priority include or defer rule applies
- Does not break ties by selector execution order; order is never a resolution rule
- Does not call any provider or model in MVP

**Fail-open rule:** If the priority order does not cleanly resolve a conflict, the resolver must produce `action: include`, `path: fail_open` and emit an `unresolvedConflictWarning`. Uncertainty is never resolved in favour of omission.

---

### 11.2 Inputs

| Input | Strictness | Source | Meaning |
|---|---|---|---|
| `selectionDecisions` | Class A (required) | Selector fan-out output | All SelectionDecision records from all selectors. At least one record per candidate component. |
| `unresolvedConflicts` | Class A (required) | Orchestrator gap-check | List of component IDs that received decisions from multiple selectors or that carried `path: conflict_include`. Empty list is valid. |
| `selectorTrace` | Class A (required) | Selector fan-out output | Full selector trace. Used to read evidence and warnings for each input decision without re-running selectors. |
| `userConstraints` | Class B (defaultable) | Core boundary | `alwaysInclude` and `neverInclude` constraint lists. Missing → treat as empty; emit warning. |
| `registryComponentMetadata` | Class A (required) | `componentsById` | Component registry fields for each component under resolution: `retainPolicy`, `omissionPolicy`, `riskLevel`, `type`. Used to verify hard-protection status during resolution. |
| `runtimeCapabilities` | Class B (defaultable) | Core boundary input | Required only when a conflict involves a `type: tool` component. Used to verify confirmed-unavailable status. Missing → treat as unknown availability; fail open; warn. |

**Resolution boundary:** The Conflict Resolver receives normalised inputs only. It does not read raw request text, raw history turns, or raw component content. Evidence is read from `selectorTrace`, not re-derived.

---

### 11.3 Outputs

#### 11.3.1 `resolvedSelectionDecisions`

**Meaning:** One resolved SelectionDecision per candidate component. This replaces the per-selector decisions for downstream consumption by the Budgeter and Prompt Plan Generator.

**Shape:** Same schema as a SelectionDecision (Section 4), with the following additions:
- `resolvedBy: "conflict_resolver"` — identifies the producing module
- `inputDecisionIds: string[]` — IDs of the selector decisions that were inputs to this resolution
- `resolutionRule: enum` — the priority rule that produced the winning decision; must be one of the canonical `resolutionRule` enum values (see §11.3.1a below). Free strings are not allowed in MVP; any unrecognized value is a harness failure.
- `losingDecisions: {decisionId, action, path, defeatedBy: string}[]` — each losing decision with the reason it lost

**No-op case:** A component with a single unambiguous decision produces a resolved decision with `inputDecisionIds` containing that one ID, `losingDecisions: []`, and `resolutionRule: "no_conflict"`. It does **not** produce a full `conflictResolutionTrace` entry — it is listed in `noConflictComponentIds` only (see §11.3.2).

#### 11.3.1a `resolutionRule` Canonical Enum Values (12-Q2 resolved, Pass 4.8B)

> **Decision (Pass 4.8B):** `resolutionRule` is a **strict enum** of coded values in MVP. Human-readable free strings are not permitted. The enum values below are derived from the conflict cases and priority rules defined in §11.4–11.5. Any `resolutionRule` value not in this table is a harness failure.

| Value | Meaning | When used |
|---|---|---|
| `no_conflict` | Single unambiguous decision; no resolution required | No-op components |
| `runtime_unavailable_defer` | Priority 0: confirmed-unavailable `type: tool` — resolves to `defer/runtime_unavailable` | Cases 2B, 9 |
| `safety_hard_protection` | Priority 1: `retainPolicy: safety_critical`, `omissionPolicy: never`, or `riskLevel: critical` wins | Cases 7, 8 |
| `user_constraint_include` | Priority 2: `userConstraints.alwaysInclude` wins | Case 6 |
| `registry_require_include` | Priority 3: `retainPolicy: mandatory` or `requiredWhen` match wins | Case 1 (include side), Case 2A |
| `history_durability_include` | Priority 4: `durable_constraints` or `open_commitments` lane wins | History durability cases |
| `path_a_omit_uncontested` | Priority 5: all input decisions are valid Path A omits, resolved to Path A | Case 4 (when Path A is the winner) |
| `path_b_omit_uncontested` | Priority 5: all input decisions are valid Path B omits, resolved to Path B | Case 4 (when Path B is the only decision) |
| `path_a_omit_selected_over_path_b` | Priority 5: Path A selected over Path B in an omit-vs-omit conflict | Case 4 (Path A vs Path B) |
| `multiple_include_merged` | Priority 5: multiple include decisions merged to a single include | Case 5 |
| `include_over_omit` | Priority 5: include vs omit (non-priority include paths) — include wins unconditionally per §11.5 Case 1 | Case 1 (P5) |
| `include_over_defer` | Priority 5: include vs ordinary defer — include wins per §11.5 Case 2A | Case 2A |
| `defer_over_omit` | Priority 5: omit vs ordinary defer — defer wins (defer is the safer exclusion) per §11.5 Case 3 | Case 3 |
| `conflict_include_resolved` | A single `conflict_include` decision (ladder Step 4: both `requiredWhen` and `safeToOmitWhen` matched) — a clean include, not an unresolved conflict | Single conflict_include |
| `fail_open_unresolved` | Priority order did not cleanly resolve; resolved fail-open. **Reserved for a genuinely unmatched conflict group only** (Cases 1/2A/3 and single conflict_include now have dedicated rules; docs/34). | Genuinely unmatched conflict group |
| `quarantine_boundary_violation_pass_through` | Quarantine boundary violation synthetic decision passed through | Case 11 |
| `reference_unknown_pass_through` | Unknown component reference passed through | Case 10 |
| `history_malformed_fail_open` | Specialized Case 1 sub-case: include/fail_open won over omit because the winning include had history-malformed provenance and no Priority 0–4 rule applied | Case 12 |

**Validation rule:** A harness checking `resolutionRule` must treat any value not in this table as a critical failure. Future additions to this enum require an explicit cross-spec decision pass.

#### 11.3.2 `conflictResolutionTrace` and `noConflictComponentIds` (12-Q1 resolved, Pass 4.8B)

> **Decision (Pass 4.8B):** No-conflict components (single unambiguous decision) are **not** emitted as full `conflictResolutionTrace` entries. They are recorded only in `noConflictComponentIds` — a lightweight ID list. Full `conflictResolutionTrace` entries are emitted only for components with actual conflicts. This keeps traces small for large registries without hiding components from accounting. The `conflictSummary.noConflict` count still covers all no-conflict components, preserving accounting completeness.

**`conflictResolutionTrace`:** Array of full resolution trace entries. One entry per component with an actual conflict. No entry for no-conflict components. See §11.6 for required fields per entry.

**`noConflictComponentIds`:** Lightweight ID list. One entry per component with a single unambiguous decision (no conflict). Shape: `string[]` of validated component IDs. Consumed by the Evaluation Harness and `conflictSummary`. The total accounted-for component count is `conflictResolutionTrace.length + noConflictComponentIds.length` and must equal `candidateSetSummary.candidateSetSize` (see §3.1). `reference_unknown` records are tracked separately in `referencedUnknownComponents` and are not subtracted from the candidate-set denominator — the candidate set is defined from validated `componentsById`, which by construction contains no unknown-reference IDs.

**Privacy rule:** No raw component content, no raw history turn content, no raw user message text may appear in any trace field.

#### 11.3.3 `unresolvedConflictWarnings`

**Meaning:** One warning record per component where the priority order could not cleanly determine a winner. The resolved decision for such a component is always `action: include`, `path: fail_open`.

**Required fields:** `componentId`, `inputDecisionIds`, `conflictDescription` (human-readable, no raw content), `warningCode` (e.g., `unresolved_conflict_fail_open`).

#### 11.3.4 `conflictSummary`

**Meaning:** Aggregate summary of the conflict resolution phase for `summary.md` generation.

**Shape (conceptual):**
```
{
  totalComponents: number,
  noConflict: number,
  resolvedConflicts: number,
  failOpenResolutions: number,
  unresolvedConflictWarnings: number,
  narrative: string
}
```

> **Accounting rule:** `noConflict` must equal `noConflictComponentIds.length`. `resolvedConflicts + failOpenResolutions` must equal `conflictResolutionTrace.length`. `totalComponents` must equal `noConflict + resolvedConflicts + failOpenResolutions`. `totalComponents` must also equal `candidateSetSummary.candidateSetSize` (see §3.1 and §11.3.2); a mismatch is an accounting failure.

> **Non-MVP boundary note (12-Q5 — safe-defer):** A `byPriority` breakdown field on `conflictSummary` (counting conflicts resolved at each priority level) is deferred to future/v2 evaluation tooling. Do not add a `byPriority` field to the `conflictSummary` shape in MVP. Per-priority counts are derivable post-hoc from `conflictResolutionTrace` by grouping entries on `resolutionRule` — the enum values encode the winning priority level for each resolved conflict. The `narrative` field is a freeform human-readable string generated for `summary.md` output only; it has no structured format contract. The Evaluation Harness must not parse or assert on `narrative` content — assertions must target the count fields (`noConflict`, `resolvedConflicts`, `failOpenResolutions`) and the canonical `conflictResolutionTrace` entries.

---

### 11.4 Conflict Priority Order

When multiple SelectionDecision records exist for the same component, the resolver applies the following priority order. **Priority 0 is a pre-priority runtime-correctness check that runs before all other rules.** Priorities 1–7 are then applied in order; earlier rules beat later rules unconditionally within this ranked set.

| Priority | Rule | Resolution |
|---|---|---|
| **0** | **Runtime correctness pre-check (type: tool only)** — component is `type: tool` and confirmed unavailable in `runtimeCapabilities` (`unavailableToolIds`, or absent when `capabilityInventoryComplete: true`) | `defer` / `runtime_unavailable`. Runs before all priority rules. Including a confirmed-unavailable tool as if it were available is a runtime-correctness error that no other priority level can authorise. If the component also triggers Priority 1, emit `hard_protected_tool_unavailable` and still resolve to `defer`. If it also appears in `alwaysInclude`, emit `always_include_unavailable_tool` and still resolve to `defer`. This is not omission. |
| 1 | **Safety / privacy hard protection** — component has `retainPolicy: safety_critical`, `omissionPolicy: never`, or `riskLevel: critical` | `include` / `safety_override`. Cannot be overridden by any priority 2–7 rule. Does not override Priority 0 for confirmed-unavailable tools. |
| 2 | **User / operator constraint: alwaysInclude** — component appears in `userConstraints.alwaysInclude` | `include` / `required_match`. Beats priorities 3–7. Does not beat Priority 0 (unavailable tool) or Priority 1 (safety). For `type: tool` components, Priority 0 applies first; if the tool is confirmed unavailable, `alwaysInclude` cannot force an include. |
| 3 | **Registry hard requirement** — component has `retainPolicy: mandatory` or its `requiredWhen` matches the current `promptFamily` | `include` / `required_match`. |
| 4 | **History durability / open commitments** — component is `type: history` representing a `durable_constraints` or `open_commitments` lane | `include` / `required_match`. Delegate to registry metadata; must carry `retainPolicy: safety_critical` or `omissionPolicy: never` at Priority 1 if truly non-negotiable. |
| 5 | **Deterministic selector evidence** — one or more selectors produced a high-confidence decision via Path A or Path B | Winning action is the highest-confidence valid decision. If one selector says `include` and another says `omit` (Path A), `include` wins (see Section 11.5). `omit` can only win if all input decisions agree and all are valid Path A or Path B decisions. |
| 6 | **Budget / cost preference** — budget-awareness signals (informational only) | Future only. Not used in MVP. |
| 7 | **Style / format preference** — output format or presentation signals | Lowest priority. `omit` can win here only under Priority 5 conditions. |

**Invariant:** No `omit` decision may win by priority alone against any `include` decision, except under Priority 5 where all input decisions are valid Path A or Path B omit decisions. Any other `include`-vs-`omit` conflict resolves to `include`.

**Invariant:** The priority order is deterministic. Selector execution order is never a tiebreaker.

**Invariant:** Priority 0 runs before Priority 1. A confirmed-unavailable `type: tool` component resolves to `defer/runtime_unavailable` regardless of any hard-protection, `alwaysInclude`, or registry-require rule.

---

### 11.5 Conflict Cases

#### Case 1 — Include vs Omit

**Inputs:** One decision `action: include`, one decision `action: omit` (Path A or Path B).

**Resolution:** `include` wins unconditionally unless the `include` decision is `path: not_evaluated` (synthetic fail-open) AND the `omit` decision is a valid high-confidence Path A. In that narrow case, emit an `include_vs_omit_with_not_evaluated` warning and still resolve to `include` — the not-evaluated path is a gap-detection safety net, not evidence of irrelevance.

**Rationale:** An explicit include signal always beats an absence-of-evidence include. The omit path requires positive evidence; the include path does not.

#### Case 2 — Include vs Defer

**Inputs:** One decision `action: include`, one decision `action: defer`.

**Sub-case A — ordinary defer (`path: default_defer`):**
`include` wins. A component deferred by default that has an explicit include signal for the current plan turn must be included. Emit `include_overrides_defer` in the trace.

> **Note:** `path: not_evaluated` is an `action: include` / fail-open path (see Section 4), not a defer path. Conflicts where one decision carries `path: not_evaluated` are include/fail-open conflicts, not ordinary-defer cases.

**Sub-case B — runtime-unavailable defer (`path: runtime_unavailable`) for `type: tool`:**
`defer` wins. Priority 0 applies: a confirmed-unavailable tool must not be included as if available regardless of the include signal's source.
- If the include signal came from a hard-protection (`path: safety_override`): still resolve to `defer/runtime_unavailable`. Emit `hard_protected_tool_unavailable` warning.
- If the include signal came from `alwaysInclude` (`path: required_match` via user constraint): still resolve to `defer/runtime_unavailable`. Emit `always_include_unavailable_tool` warning. In MVP, `alwaysInclude` cannot force inclusion of a confirmed-unavailable tool.
- In both sub-cases, flag in `riskFlags` for human review.

**Note on Case 3:** The general rule that defer does not beat include applies to ordinary defer only. `runtime_unavailable` defer is governed by Priority 0 and always beats include for `type: tool` components.

#### Case 3 — Omit vs Defer

**Inputs:** One decision `action: omit` (Path A or B), one decision `action: defer`.

**Resolution:** `defer` wins. An omit decision claims no value; a defer decision claims "not yet, not never." Defer is safer. Emit `defer_overrides_omit` in the trace.

**Note:** In ordinary omit-vs-defer conflicts, defer beats omit. Ordinary defer does not beat `include`; `runtime_unavailable` defer is the explicit exception and is governed by Priority 0 — it beats `include` for confirmed-unavailable `type: tool` components (see Case 2, Sub-case B).

#### Case 4 — Omit vs Omit (Different Paths)

**Inputs:** Two `action: omit` decisions — one `path: safe_to_omit_match` (Path A), one `path: default_action_omit` (Path B).

**Resolution:** Path A wins (stronger positive evidence). The resolved decision uses `path: safe_to_omit_match` with the Path A evidence. Emit `path_a_omit_selected_over_path_b` in the trace.

#### Case 5 — Multiple Includes with Different Reasons

**Inputs:** Two or more `action: include` decisions with different paths (e.g., `required_match` and `fail_open`).

**Resolution:** Merge to a single `include`. Use the highest-priority path as the resolved path. All participating input decisions are recorded in `inputDecisionIds`. `losingDecisions` contains only **true losers** — when all inputs are include decisions and the resolver is only merging reasons, `losingDecisions` may be `[]`.

**Hard-protection preemption:** If any input decision is a hard-protection include (`path: safety_override`, governed by Priority 1), Priority 1 fires and `resolutionRule` must be `safety_hard_protection`, not `multiple_include_merged`. `multiple_include_merged` is valid only when no higher-priority include rule (such as hard protection) governs the resolution — i.e., when all input includes are of equal or lower priority and none carries Priority 1 protection.

Emit `multiple_include_merged` in the trace when this case applies (and no Priority 1 preemption occurred).

#### Case 6 — `alwaysInclude` vs `neverInclude` (Same Component)

**Inputs:** `userConstraints.alwaysInclude` and `userConstraints.neverInclude` both reference the same component ID.

**Resolution:** `alwaysInclude` wins (Priority 2 beats neverInclude, which has no explicit priority above 6). Emit `always_include_overrides_never_include` warning. Flag in `riskFlags`.

#### Case 7 — `neverInclude` vs Safety-Critical Component

**Inputs:** `userConstraints.neverInclude` references a component with `retainPolicy: safety_critical` or `omissionPolicy: never`.

**Resolution:** Safety wins (Priority 1). Resolve to `include` / `safety_override`. Emit `safety_override_never_include` warning. The user constraint cannot remove a safety-critical component. Flag prominently in `riskFlags`.

#### Case 8 — Hard-Protected Component vs Omit Decision

**Inputs:** One selector produced `action: omit` (Path A or B). Registry metadata shows `retainPolicy: safety_critical`, `omissionPolicy: never`, or `riskLevel: critical`.

**Resolution:** Hard protection wins (Priority 1). Resolve to `include` / `safety_override`. Emit `safety_override_omit_decision` warning. The omit decision is recorded as a losing decision with `defeatedBy: "safety_hard_protection"`. This is an Evaluation Harness alert — a hard-protected component should never have reached an omit decision in the selector; it indicates a selector implementation defect.

#### Case 9 — Hard-Protected Unavailable Tool

**Inputs:** Component is `type: tool`. `runtimeCapabilities` confirms it unavailable. It also has a hard protection marker (`retainPolicy: mandatory` / `safety_critical`, `omissionPolicy: never`, or `riskLevel: critical`).

**Resolution:** Runtime correctness (Priority 0) produces `defer` / `runtime_unavailable`. Priority 0 runs before Priority 1; the hard protection cannot override runtime unavailability — including a confirmed-unavailable tool as if it were available is a runtime-correctness error. Emit `hard_protected_tool_unavailable` warning. Flag in `riskFlags` for human review: the registry and runtime are inconsistent.

#### Case 10 — Unknown Component Reference

**Inputs:** A decision with `action: reference_unknown` for a component ID not present in `componentsById`.

**Resolution:** Not a conflict to resolve. Pass through as-is. Record in `referencedUnknownComponents`. The Prompt Plan Generator must include it in `riskFlags`. Do not produce `include` or `omit`. Emit `reference_unknown_passed_through` trace entry.

#### Case 11 — Quarantine Boundary Violation Reaches Conflict Phase

**Inputs:** A synthetic decision with `action: include`, `path: quarantine_boundary_violation`, `confidence: low` — produced by Step 1 of the ladder (boundary-violation detection) when a quarantined component ID appears in the selector fan-out candidate set despite the registry guarantee. This must never occur in correct MVP operation.

**Resolution:** Pass through as `action: include`, `path: quarantine_boundary_violation`, `confidence: low`. Preserve the `unexpected_quarantine_reference` planning error emitted by Step 1. Record in `conflictResolutionTrace` with `resolutionRule: "quarantine_boundary_violation_pass_through"`. The Evaluation Harness must flag any occurrence as a registry-boundary defect requiring investigation. Do not suppress or convert this decision.

**Key distinctions from Case 10 (unknown reference):**
- A quarantine boundary violation is a **validated-but-excluded** component that incorrectly reached selector fan-out — a registry-boundary defect.
- An unknown reference (`action: reference_unknown`, Case 10) is an ID the registry has never seen at all — a reference error.
- These are different error classes. Do not merge them.

> **Note:** `action: quarantine` is not a valid `SelectionDecision.action` in MVP (F-17 resolved, Pass 4.7A). Step 1 produces `action: include` / `path: quarantine_boundary_violation`, not `action: quarantine`. The Conflict Resolver never receives `action: quarantine` from the selector phase.

#### Case 12 — History-Malformed Fail-Open Include vs Omit (12-Q4 + F-22 resolved, Pass 4.8D)

**Context:** This is a specialized sub-case of Case 1 (include vs omit). It fires when Case 1 applies and the winning `include` decision has history-malformed provenance — i.e., the history selector emitted `action: include`, `path: fail_open` because `historyStateSummary.historyMalformed: true` caused a fail-open (see §14.4). This case exists to name the resolution clearly in the trace; Case 1 already resolves correctly because `path: fail_open` is not `path: not_evaluated` and therefore include wins unconditionally. The traceability gap is that without this case, the `resolutionRule` has no named value for this scenario.

**Detection condition (all of the following must hold):**
- No Priority 0–4 rule applied (checked first, as always).
- Case 1 applies: one input decision is `action: include` and one or more are `action: omit`.
- The winning include decision has `path: fail_open`.
- The winning include decision's selectorTrace entry carries the `history_malformed_fail_open` warning (confirming history-malformed provenance).

**Resolution:**
- `action: include`
- `finalPath: fail_open`
- `confidence: low`
- `resolutionRule: history_malformed_fail_open`

**Hard-protection preemption:** If any input decision for this component is a hard-protection include (`path: safety_override`, governed by Priority 1), the Conflict Resolver detects Priority 1 first and the primary `resolutionRule` must be `safety_hard_protection` — not `history_malformed_fail_open` and not `multiple_include_merged`. The history-malformed context is preserved in `conflictResolutionTrace.warningsEmitted` as `history_malformed_conflict`. Hard protection must not be hidden behind the history-malformed label.

**`losingDecisions` rule:** Contains only true losers. The omit decision is the true loser and appears in `losingDecisions` with `defeatedBy: "history_malformed_fail_open"`. The winning include decision does not appear in `losingDecisions`. All input decisions (winner and losers) are listed in `inputDecisionIds`.

**Warning codes:**
- Per-conflict trace: `history_malformed_conflict` in `conflictResolutionTrace.warningsEmitted` for each component resolution where this case fires.
- Global per-run (deduplicated): `history_malformed_conflict_occurred` emitted into `planningWarnings` at most **once per run**. The orchestrator maintains a `historyMalformedConflictWarningSent` conceptual boolean (same deduplication pattern as the global injection warning in §17.6). This prevents per-component noise when many history components are malformed simultaneously.

---

### 11.6 Trace Requirements

Every full `conflictResolutionTrace` entry emitted for an **actual conflict** must contain:

> **No-conflict components do not emit full `conflictResolutionTrace` entries.** Components with a single unambiguous decision are recorded only in `noConflictComponentIds` (see §11.3.2). The fields below apply only to entries produced for actual conflicts.

| Field | Required | Content |
|---|---|---|
| `componentId` | Yes | The validated registry component ID |
| `inputDecisionIds` | Yes | IDs of all SelectionDecision records considered |
| `finalAction` | Yes | The resolved `action` value |
| `finalPath` | Yes | The resolved `path` value |
| `resolutionRule` | Yes | The canonical enum value that produced the winning decision (e.g., `"safety_hard_protection"`, `"runtime_unavailable_defer"`, `"multiple_include_merged"`). Must be a value from the canonical enum (§11.3.1a); `"no_conflict"` is only valid on `resolvedSelectionDecisions` for no-conflict components, which do not emit full `conflictResolutionTrace` entries. |
| `losingDecisions` | Yes | Array of `{decisionId, action, path, defeatedBy}` for every non-winning input decision. Empty array if there are no losing decisions for this actual-conflict entry (e.g., when all input decisions merged into a single winner with no distinct loser). |
| `warningsEmitted` | Yes | Array of warning codes emitted during this resolution. Empty array if none. |
| `resolvedAt` | Yes | Monotonic step counter; not wall-clock time |
| `hadGateConvertedDecisions` | Optional | `true` if one or more input decisions to this resolution had `actionChanged: true` in their selectorTrace entry (i.e., the injection gate converted the action before the Conflict Resolver received it). Present only when gate conversion was detected. Enables operators to see that the resolved `include` result may reflect an original `omit` that was gate-converted rather than a genuine include consensus. |
| `gateConvertedTraceRefs` | Optional | Array of trace entry IDs (from `SelectionDecision.traceRefs`) for each gate-converted input decision. Present only when `hadGateConvertedDecisions: true`. The referenced selectorTrace entries carry `originalCandidateAction` and `originalCandidatePath` as the canonical source of pre-gate context. |
| `preGateActions` | Optional | Array of `originalCandidateAction` values from each gate-converted input decision, in the same order as `gateConvertedTraceRefs`. Informational summary; selectorTrace is canonical. Present only when `hadGateConvertedDecisions: true`. Example: `["omit"]`. |
| `preGatePaths` | Optional | Array of `originalCandidatePath` values from each gate-converted input decision, in the same order as `gateConvertedTraceRefs`. Informational summary; selectorTrace is canonical. Present only when `hadGateConvertedDecisions: true`. Example: `["safe_to_omit_match"]`. |

**Privacy constraints (unconditional):**
- No raw component content (schema text, instruction text, etc.) in any trace field
- No raw history turn content in any trace field
- No raw user message text in any trace field
- Evidence references are IDs and coded atoms only

---

### 11.7 Evaluation Requirements

The Evaluation Harness must enforce zero tolerance for the following conditions:

| Condition | Harness check |
|---|---|
| Untraced conflict | Every component with more than one input decision must have a `conflictResolutionTrace` entry with `resolutionRule` ≠ `"no_conflict"` |
| No-conflict component not in `noConflictComponentIds` | Every component with exactly one unambiguous input decision must appear in `noConflictComponentIds`; absent entries are an accounting failure |
| Omit beating safety/privacy/hard protection | Any `resolvedSelectionDecision` with `action: omit` where registry metadata shows Priority 1 protection is a critical failure |
| Omit without Path A or Path B | Any resolved `action: omit` where `finalPath` is not `safe_to_omit_match` or `default_action_omit` is a planning error |
| Unavailable tool resolved to include | Any resolved `action: include` for a `type: tool` component confirmed unavailable in `runtimeCapabilities` is a runtime-correctness failure |
| Unknown component silently ignored | Any component ID in `unresolvedConflicts` not appearing in `conflictResolutionTrace` is a traceability failure |
| Conflict resolved by selector order | Any `resolutionRule` value of `"selector_order"` or equivalent is prohibited |
| Unrecognized `resolutionRule` value | Any `resolutionRule` value not in the canonical enum (§11.3.1a) is a critical harness failure |
| Raw content in conflict trace | Any raw text, schema content, or history content in `conflictResolutionTrace` fields is a privacy failure |
| Gate-conversion context missing from conflict trace | If any input decision to a resolution had `actionChanged: true` in its selectorTrace entry and `hadGateConvertedDecisions` is absent from the `conflictResolutionTrace` entry, it is a traceability failure (F-20 resolved, Pass 4.8C) |
| Pre-gate omit + final include flagged as planning error | The harness must not flag a `preGateActions: ["omit"]` + resolved `action: include` combination as a planning error when `hadGateConvertedDecisions: true` — injection gate conversion is intentional and correct (F-20 resolved, Pass 4.8C) |
| `history_malformed_fail_open` wrong resolution | Any resolved decision with `resolutionRule: history_malformed_fail_open` that does not have `action: include` and `finalPath: fail_open` is a planning error (12-Q4 resolved, Pass 4.8D) |
| `history_malformed_conflict` missing from warningsEmitted | If `resolutionRule: history_malformed_fail_open`, then `history_malformed_conflict` must appear in `conflictResolutionTrace.warningsEmitted`; absence is a traceability failure (12-Q4 resolved, Pass 4.8D) |
| `history_malformed_conflict_occurred` duplicate global warning | `history_malformed_conflict_occurred` must appear at most once in `planningWarnings` per run; more than one occurrence is a deduplication failure (12-Q4 resolved, Pass 4.8D) |
| Hard protection hidden by history-malformed or merged label | When a component has both a hard-protection include input and a history-malformed fail-open include input, `resolutionRule` must be `safety_hard_protection`, not `history_malformed_fail_open` and not `multiple_include_merged`; if history-malformed context was present, `history_malformed_conflict` must still appear in `warningsEmitted`; absence of either is a traceability failure (12-Q4 resolved, Pass 4.8D; strengthened Pass 4.8D.1) |
| Unsafe omit with history-malformed input | Any resolved decision with `action: omit` where any input decision had history-malformed provenance is a safety failure (12-Q4 resolved, Pass 4.8D) |

---

## 12. Pass 3.1 Open Questions

1. ~~**Should no-op resolutions be emitted to `conflictResolutionTrace` or only to a lighter summary?**~~ **Resolved/reference Pass 4.8B.** Decision: no-conflict components (single unambiguous decision) are recorded only in `noConflictComponentIds` — a lightweight `string[]` of component IDs. Full `conflictResolutionTrace` entries are emitted only for components with actual conflicts. `conflictSummary.noConflict` still covers all no-conflict components, preserving accounting. The Evaluation Harness checks `noConflictComponentIds.length + conflictResolutionTrace.length` equals the total evaluated candidate count. See §11.3.2 for the canonical wording.

2. ~~**How should `resolutionRule` be specified?**~~ **Resolved/reference Pass 4.8B.** Decision: `resolutionRule` is a **strict enum** of coded values in MVP. Free strings are not allowed. The canonical enum values are defined in §11.3.1a. Any unrecognized value is a harness failure. Future additions require an explicit cross-spec decision pass. Rationale: typed enum prevents typos, enables deterministic harness assertions, and makes schema validation precise.

3. ~~**Should Priority 3 (runtime correctness) always beat Priority 2 (user `alwaysInclude`)?**~~ **Resolved.** For MVP, confirmed runtime unavailability beats `alwaysInclude` for `type: tool`. A confirmed-unavailable tool resolves to `defer/runtime_unavailable` regardless of `alwaysInclude`. This is now Priority 0 (pre-priority) in the table. If an operator needs to include a tool definition for documentation or planning purposes even when the tool is unavailable, that use case requires a distinct component type or a future `include_documentation_only` action and is explicitly out of MVP scope.

4. ~~**How should history-lane conflict cases be handled when `historyStateSummary` signals malformation?**~~ **Resolved/reference Pass 4.8D (12-Q4, F-22).** Decision: this is primarily a traceability gap, not a safety-correctness gap — Case 1 (include beats omit) already resolves correctly because `path: fail_open` is not `path: not_evaluated`. A new Case 12 (specialized Case 1 sub-case) is defined with `resolutionRule: history_malformed_fail_open`. It fires when the winning include has history-malformed provenance (selectorTrace carries `history_malformed_fail_open` warning) and no Priority 0–4 rule applied. Hard protection preempts: if a hard-protection include is also present, `resolutionRule` is `safety_hard_protection` and history-malformed context is preserved in `warningsEmitted` only. Warning codes: `history_malformed_conflict` (per-conflict trace) and `history_malformed_conflict_occurred` (global per-run, deduplicated). `losingDecisions` contains only true losers. See §11.5 Case 12 and §11.3.1a for canonical wording.

5. ~~**Should `conflictSummary` include a breakdown by priority rule?**~~ **Resolved/reference Pass 4.8E-2B (12-Q5 — safe-defer).** Decision: a `byPriority` breakdown field is deferred to future/v2 evaluation tooling. In MVP, per-priority conflict counts are derivable post-hoc from `conflictResolutionTrace` by grouping entries on `resolutionRule`. `conflictResolutionTrace` remains the canonical source for per-rule and per-priority analysis. The `narrative` field in `conflictSummary` is freeform text for `summary.md` only; harness must not parse it. See §11.3.4 non-MVP boundary note.

---

## 13. Pass 3.1.1 Definition of Done

- [x] Section 11: Conflict Resolution defined
- [x] Conflict resolver purpose defined: consumes multi-selector decisions, produces one resolved decision per component
- [x] Fail-open rule stated: unresolvable conflicts resolve to `include` / `fail_open`
- [x] Inputs defined: 6 inputs with strictness classes, sources, and meanings
- [x] Outputs defined: 4 Conflict Resolution outputs (`resolvedSelectionDecisions`, `conflictResolutionTrace`, `unresolvedConflictWarnings`, `conflictSummary`) plus `noConflictComponentIds` accounting list (Pass 4.8B: 12-Q1 resolved)
- [x] `resolvedSelectionDecision` shape defined: additions to SelectionDecision schema including `resolvedBy`, `inputDecisionIds`, `resolutionRule` (enum), `losingDecisions`
- [x] No-op resolution defined: single-decision components listed in `noConflictComponentIds` only; no full trace entry (Pass 4.8B: 12-Q1 resolved)
- [x] Conflict priority order restructured: Priority 0 (runtime pre-check) + Priorities 1–7, deterministic, order-independent of selector execution
- [x] Priority 0 defined: confirmed-unavailable `type: tool` → `defer/runtime_unavailable`, runs before all other priorities
- [x] Priority invariants stated: omit cannot beat include outside Priority 5 conditions; selector order never breaks ties; Priority 0 beats Priority 1
- [x] 12 conflict cases defined with explicit resolution and trace requirements
- [x] Case 2 (include vs defer) split into sub-cases: ordinary defer (include wins) vs runtime_unavailable defer (defer wins, Priority 0)
- [x] `alwaysInclude` cannot force inclusion of a confirmed-unavailable tool — MVP decision stated
- [x] Safety-override-beats-neverInclude case defined
- [x] `alwaysInclude`-vs-`neverInclude` conflict case defined
- [x] Hard-protected component vs omit decision case defined as Evaluation Harness alert
- [x] Unknown component reference pass-through defined
- [x] Quarantine boundary violation case defined: Case 11 produces `action: include` / `path: quarantine_boundary_violation` (F-17 resolved Pass 4.7A; `action: quarantine` is not a valid selector action in MVP)
- [x] **Case 12 (history-malformed fail-open include vs omit) defined: `resolutionRule: history_malformed_fail_open`; hard-protection preemption rule; losingDecisions contains only true losers; per-conflict `history_malformed_conflict` warning; global-per-run `history_malformed_conflict_occurred` warning deduplicated (12-Q4 + F-22 resolved, Pass 4.8D)**
- [x] Trace requirements defined: 8 required fields + 4 optional gate-conversion fields, privacy constraints, no raw content (Pass 4.8C: F-20 resolved — optional `hadGateConvertedDecisions`, `gateConvertedTraceRefs`, `preGateActions`, `preGatePaths` added)
- [x] Evaluation requirements defined: **16 zero-tolerance harness checks** (Pass 4.8B added 2: no-conflict accounting, unrecognized `resolutionRule` enum; Pass 4.8C added 2: F-20 gate-conversion traceability checks; **Pass 4.8D added 5: history_malformed_fail_open wrong resolution, history_malformed_conflict missing, history_malformed_conflict_occurred deduplication, hard-protection hidden by history-malformed label, unsafe omit with history-malformed input**)
- [x] File version header updated to Pass 3.1
- [x] Status line updated: `No conflict resolution` removed
- [x] Open Question 3 resolved: runtime unavailability beats alwaysInclude for type: tool in MVP
- [x] Section 12: **1 open question remaining** (Q1–Q4 resolved/reference; Q5 safe-defer)
- [x] Section 13: This checklist
- [x] **candidateSetPolicy internal constant defined: MVP value `all_non_quarantined`; candidateSetSummary trace record; gap-check denominator = candidateSetSize; unsupported value halts with error; future values named only (5-Q8 + F-29 resolved, Pass 4.8D)**
- [x] **Multi-role component authoring rule added to §7 fan-out: singular type, no inter-selector handoff, registry authoring resolves multi-role (9-Q3 resolved, Pass 4.8D)**
- [x] **Step 3 always emits path: safety_override; required_match exception removed; secondary reason preservation via existing evidence[]/constraintsApplied[] fields; harness rule added (9-Q2 resolved, Pass 4.8D)**
- [x] No per-type detailed deterministic signal rules written (deferred to Pass 3.2)
- [x] No injection-suspect ladder integration written (deferred to Pass 3.2)
- [x] No budget-aware selector hints written (deferred to Pass 3.2)
- [x] No model-assisted selector rules written
- [x] No code implemented
- [x] No JSON Schema files created
- [x] No runtime system touched
- [x] No OpenClaw state modified

**Pass 3.2 scope:**
- Per-selector-type detailed deterministic signal rules (tool availability scoring, skill relevance heuristics, history lane-level rules)
- Injection-suspect ladder integration: how `requestSignals.injectionSuspect: true` flows into ladder step conditions
- Budget-aware selector hints: informational signals passed to selectors, not enforcement

---

## 14. Per-Selector Deterministic Signal Rules

### 14.0 Shared Deterministic Matching Rules

These rules apply to every selector type. Selector-specific rules (Sections 14.1–14.8) operate within these constraints and may not override them.

**Matching primitives:**
- All tag/field matching is **exact string comparison** only. No fuzzy matching, no semantic similarity, no partial prefix matching in MVP.
- `promptFamily` matching compares the current `promptFamily` value against `requiredWhen[]` and `safeToOmitWhen[]` arrays using string equality only.
- `requiredWhen` and `safeToOmitWhen` evaluation follows the ladder defined in Section 8. Selector-specific rules add evidence atoms to the trace; they do not create alternative ladder paths.
- `evidenceRequired` atoms (defined in Component Registry Spec §5) are evaluated deterministically. An atom is satisfied only if its named field is present, non-null, and matches the expected value or type. An unrecognised or malformed `evidenceRequired` atom **disables Path A** for that component — the selector falls through to Path B or beyond.
- `defaultAction` values (`include` / `omit` / `defer`) come from the registry spec. The selector reads the value as-is; it does not interpret or override it.
- Selector-specific signals may add `planningWarning` entries and extra `evidence` atoms to the trace. They **cannot** create a new `action: omit` path outside Path A or Path B.
- Hard protections (Step 3 of the deterministic ladder) take precedence over all selector-specific signals. A selector must not omit a hard-protected component.
- No raw user text, raw history content, or raw component schema text may appear in any trace field.

**Selector-specific registry fields (defensive rule):**
- Selector-specific registry fields (e.g., `lane`, `formatTag`) are optional metadata. They are read-only; selectors never invent or infer field values.
- If a selector-specific field required as a positive include signal is absent or malformed, the selector must not infer omission. Missing fields may only reduce positive evidence; they cannot authorize omit.
- If a selector-specific field is absent and the component would otherwise be omitted (e.g., `defaultAction: omit`, no `requiredWhen` match), the selector must fail open and emit a warning. It may not proceed to omit based on the absence of a field it did not receive.
- This rule applies to: `lane` (History Selector), `formatTag` (Output Format Selector), and any future per-type field.

---

### 14.1 Scaffold Selector

**Signals consumed:** `promptFamily`, `componentsById` (scaffold-typed), `userConstraints`, `selectorPolicy`.

> **Note:** `requestSignals.promptFamilyTag` does not exist. The primary routing signal is `promptFamily`, extracted by the orchestrator from `requestSignals.promptFamily` before fan-out.

**Positive include signals:**
- `requiredWhen` contains the current `promptFamily` → include / `required_match`
- Component has `retainPolicy: mandatory` or `safety_critical` → include / `safety_override` (Step 3)
- `omissionPolicy: never` → include / `safety_override` (Step 3)

**Safe omit signals (Path A only):**
- `safeToOmitWhen` contains the current `promptFamily` AND `requiredWhen` does not → omit / `safe_to_omit_match`
- `evidenceRequired` atoms all satisfied → Path A eligible
- If any `evidenceRequired` atom is unrecognised or malformed → Path A disabled; fall to Path B or fail-open

**Path B omit:**
- `defaultAction: omit` AND no `requiredWhen` match AND no `safeToOmitWhen` match → omit / `default_action_omit`

**Fail-open triggers:**
- `promptFamily` absent or unrecognised → include / `fail_open` + `prompt_family_unknown` warning
- `safeToOmitWhen` match but `evidenceRequired` malformed → include / `fail_open` + `evidence_required_invalid` warning
- `defaultAction` absent or unrecognised → include / `fail_open` + `default_action_unknown` warning

**Warning codes:** `prompt_family_unknown`, `evidence_required_invalid`, `default_action_unknown`, `conflicting_tags` (Step 4)

**Trace atoms required:** `promptFamily`, matched `requiredWhen`/`safeToOmitWhen` tag (if any), `retainPolicy` or `omissionPolicy` value (if hard protection fired), `defaultAction` value (if Path B)

**Not allowed:**
- Omit based on component content length or token count (Budgeter's domain)
- Omit based on user request text similarity
- Override hard protections

---

### 14.2 Skill Selector

**Signals consumed:** `promptFamily`, `requestSignals.activeSkillIds` (optional, default `[]`), `componentsById` (skill-typed), `userConstraints`, `selectorPolicy`.

**Positive include signals:**
- `requiredWhen` contains the current `promptFamily` → include / `required_match`
- Component ID appears in `requestSignals.activeSkillIds` → include / `required_match` + `active_skill_id_match` evidence atom
- Hard protection fields present → include / `safety_override` (Step 3)

**Safe omit signals (Path A only):**
- `safeToOmitWhen` contains `promptFamily` AND `requiredWhen` does not AND component ID is NOT in `activeSkillIds` → Path A eligible
- All `evidenceRequired` atoms satisfied

**Path B omit:**
- `defaultAction: omit` AND no `requiredWhen` match AND no `safeToOmitWhen` match AND NOT in `activeSkillIds`

**Fail-open triggers:**
- `activeSkillIds` absent → treat as empty list; no warning (optional field, default is `[]`)
- `activeSkillIds` present but malformed → treat as empty list; emit one `active_skill_ids_malformed` selector-phase warning
- Malformed `evidenceRequired` → Path A disabled; include / `fail_open`

**Warning codes:** `active_skill_ids_malformed`, `evidence_required_invalid`, `conflicting_tags`

**Trace atoms required:** `promptFamily`, matched tag or `activeSkillIds` membership, `defaultAction`

**Not allowed:**
- Semantic similarity scoring between skill description and user request text
- NLP-based relevance classification
- Any fuzzy matching

---

### 14.3 Tool Selector

**Signals consumed:** `promptFamily`, `requestSignals.activeToolIds`, `componentsById` (tool-typed), `runtimeCapabilities`, `userConstraints`, `selectorPolicy`.

**Runtime availability pre-check (before ladder — Priority 0):**
- Component ID in `runtimeCapabilities.unavailableToolIds` → `defer` / `runtime_unavailable` (never omit)
- Component ID absent from both lists AND `capabilityInventoryComplete: true` → `defer` / `runtime_unavailable`
- Component ID absent from both lists AND `capabilityInventoryComplete: false` → include / `fail_open` + `runtime_capability_unknown` warning; ladder continues normally
- Component ID in `runtimeCapabilities.availableToolIds` → availability confirmed; proceed to ladder

**Positive include signals (after pre-check):**
- `requiredWhen` contains `promptFamily` → include / `required_match`
- Component ID in `requestSignals.activeToolIds` → include / `required_match` + `active_tool_id_match` atom
- Hard protection → include / `safety_override` (Step 3)

**Safe omit signals (Path A only):**
- `safeToOmitWhen` match AND `requiredWhen` no match AND NOT in `activeToolIds` AND tool is confirmed available → Path A eligible
- All `evidenceRequired` atoms satisfied

**Path B omit:**
- `defaultAction: omit` AND no positive signals AND tool confirmed available

**Fail-open triggers:**
- `runtimeCapabilities` absent → treat availability as unknown; include / `fail_open` + `runtime_capabilities_missing` warning for all tool components
- Malformed `evidenceRequired` → Path A disabled
- `activeToolIds` absent → treat as empty list; no warning (optional field, default is `[]`)
- `activeToolIds` present but malformed → treat as empty; one `active_tool_ids_malformed` selector-phase warning

**Warning codes:** `runtime_unavailable`, `runtime_capability_unknown`, `runtime_capabilities_missing`, `active_tool_ids_malformed`, `hard_protected_tool_unavailable`, `always_include_unavailable_tool`, `evidence_required_invalid`, `conflicting_tags`

**Trace atoms required:** `availabilityStatus` (`confirmed_available` / `confirmed_unavailable` / `unknown`), `capabilityInventoryComplete` value, `promptFamily`, matched tag or `activeToolIds` membership, `defaultAction`

**Invariant:** `runtime_unavailable` is never counted as omission in token savings or omit counters.

**Not allowed:**
- Include a confirmed-unavailable tool as if available
- Omit based on runtime unavailability (always defer, never omit)
- Override the runtime pre-check with any ladder step

---

### 14.4 History Selector

**Signals consumed:** `promptFamily`, `historyStateSummary`, `componentsById` (history-typed), `userConstraints`, `selectorPolicy`.

**Positive include signals:**
- `requiredWhen` contains `promptFamily` → include / `required_match`
- Component registry entry has `lane` value in `{durable_constraints, open_commitments}` → include / `safety_override` (these must carry `retainPolicy: safety_critical` or `omissionPolicy: never`)
- `historyStateSummary.historyMalformed: true` AND component `riskLevel` is `high` or `retainPolicy` ≠ `optional` → include / `fail_open` + `history_malformed_fail_open` warning

**Safe omit signals (Path A only):**
- `safeToOmitWhen` contains `promptFamily` AND component lane is NOT `durable_constraints` / `open_commitments` AND no hard protection → Path A eligible
- All `evidenceRequired` atoms satisfied

**Path B omit:**
- `defaultAction: omit` AND lane is not durability/commitment AND no positive signals

**Fail-open triggers:**
- `historyStateSummary` absent → include all history components with `riskLevel: high` or non-optional `retainPolicy`; `history_state_summary_missing` warning for all
- `historyStateSummary.historyMalformed: true` → fail-open for non-optional components (see above)
- `lane` field absent from registry entry → do not assume the component is safe to omit; fail open for components with `riskLevel: high` or non-optional `retainPolicy`; emit `history_lane_missing` warning; proceed to ordinary Path A/B ladder for components with `defaultAction: include` and no safety markers
- Malformed `evidenceRequired` → Path A disabled

**Warning codes:** `history_malformed_fail_open`, `history_state_summary_missing`, `history_lane_missing`, `evidence_required_invalid`, `conflicting_tags`

**Trace atoms required:** `lane` value, `promptFamily`, `historyMalformed` flag (if applicable), matched tag or fail-open trigger

**Not allowed:**
- Omit a `durable_constraints` or `open_commitments` lane component for any reason
- Include raw history turn content in trace
- Use conversation turn count or recency as an omission signal (Budgeter's domain)

---

### 14.5 Memory Selector

**Signals consumed:** `promptFamily`, `requestSignals.activeMemoryIds`, `componentsById` (memory-typed), `userConstraints`, `selectorPolicy`.

**Positive include signals:**
- `requiredWhen` contains `promptFamily` → include / `required_match`
- Component ID in `requestSignals.activeMemoryIds` → include / `required_match` + `active_memory_id_match` atom
- Hard protection → include / `safety_override` (Step 3)

**Safe omit signals (Path A only):**
- `safeToOmitWhen` match AND `requiredWhen` no match AND NOT in `activeMemoryIds` → Path A eligible
- All `evidenceRequired` atoms satisfied

**Path B omit:**
- `defaultAction: omit` AND no positive signals

**Fail-open triggers:**
- `activeMemoryIds` absent → treat as empty list; no warning (optional field, default is `[]`)
- `activeMemoryIds` present but malformed → treat as empty list; emit one `active_memory_ids_malformed` selector-phase warning
- Malformed `evidenceRequired` → Path A disabled; include / `fail_open`

**Warning codes:** `active_memory_ids_malformed`, `evidence_required_invalid`, `conflicting_tags`

**Trace atoms required:** `promptFamily`, `activeMemoryIds` membership, matched tag, `defaultAction`

**Not allowed:**
- Semantic staleness scoring or time-based eviction (future pass)
- Include raw memory content in trace
- Omit memory components based on estimated token cost

---

### 14.6 Policy Selector

**Signals consumed:** `promptFamily`, `requestSignals`, `componentsById` (policy-typed), `userConstraints`, `selectorPolicy`.

**Positive include signals:**
- `requiredWhen` contains `promptFamily` → include / `required_match`
- Component has `retainPolicy: safety_critical`, `omissionPolicy: never`, or `riskLevel: critical` → include / `safety_override` (Step 3); enforced before any other evaluation
- Hard protection present → Step 3 fires first; no other step may produce omit

**Safe omit signals (Path A only):**
- `safeToOmitWhen` match AND `requiredWhen` no match AND NO hard protection → Path A eligible
- All `evidenceRequired` atoms satisfied
- A policy component with any hard protection marker is **never eligible for Path A**

**Path B omit:**
- `defaultAction: omit` AND no positive signals AND no hard protection

**Fail-open triggers:**
- Hard protection absent but `riskLevel: high` → include / `fail_open` + `policy_high_risk_fail_open` warning
- Malformed `evidenceRequired` → Path A disabled; include / `fail_open`
- `promptFamily` unknown → include / `fail_open` + `prompt_family_unknown` warning

**Warning codes:** `policy_high_risk_fail_open`, `prompt_family_unknown`, `evidence_required_invalid`, `conflicting_tags`

**Trace atoms required:** `promptFamily`, `retainPolicy`/`omissionPolicy`/`riskLevel` value (if hard protection or high-risk), matched tag, `defaultAction`

**Not allowed:**
- Omit a safety/privacy hard-protected policy component under any condition
- Override hard protection with `selectorPolicy` overrides
- Include raw policy instruction text in trace

---

### 14.7 Output Format Selector

**Signals consumed:** `promptFamily`, `requestSignals.outputFormatHint`, `componentsById` (output_format-typed), `userConstraints`, `selectorPolicy`.

**Positive include signals:**
- `requiredWhen` contains `promptFamily` → include / `required_match`
- `requestSignals.outputFormatHint` is string-equal to the component's `formatTag` registry field → include / `required_match` + `output_format_hint_match` atom
- Hard protection → include / `safety_override` (Step 3)

**Safe omit signals (Path A only):**
- `safeToOmitWhen` match AND `requiredWhen` no match AND `outputFormatHint` does NOT match component `formatTag` → Path A eligible
- All `evidenceRequired` atoms satisfied

**Path B omit:**
- `defaultAction: omit` AND no positive signals

**Fail-open triggers:**
- `outputFormatHint` absent → treat as null / no match; no warning (optional field, default is null)
- `outputFormatHint` present but malformed → treat as null; one `output_format_hint_malformed` selector-phase warning
- `formatTag` absent from registry entry → do not use `outputFormatHint` to make an omit decision; fail open for components that would otherwise be omitted; emit `format_tag_missing` warning
- Malformed `evidenceRequired` → Path A disabled

**Warning codes:** `output_format_hint_malformed`, `format_tag_missing`, `evidence_required_invalid`, `conflicting_tags`

**Trace atoms required:** `promptFamily`, `outputFormatHint` value (if present), `formatTag` value, match result, `defaultAction`

**Not allowed:**
- Fuzzy format inference from user request text
- Use output token length estimates as a format selection signal

> **Injection-suspect interaction (Pass 4.9D-2U.R1 — see §17.3.1 for full analysis):** When `requestSignals.injectionSuspect: true` and the effective injection policy is `warn_and_continue`, the original rule described overriding output_format components with `riskLevel: critical` or `riskLevel: high` to `include / fail_open`. Under the three-branch reachability analysis in §17.3.1: `riskLevel: critical` is a Step 3 hard-protection condition (Branch A — cannot arrive at the injection gate as `action: omit`); `riskLevel: high` is blocked from Path A/B omit gates (Branch B — falls to Step 11 fail-open instead). `riskLevel: low` or `riskLevel: medium` output_format components are explicitly not biased by the injection-gate override (18-Q1 resolved, Pass 4.8C). The canonical rule and Branch C deferred status are in §17.3.1.

---

### 14.8 Runtime Capability Selector

**Signals consumed:** `promptFamily`, `runtimeCapabilities`, `componentsById` (runtime_capability-typed), `userConstraints`, `selectorPolicy`.

> **Note:** In MVP, `runtime_capability` components are registry metadata descriptors, not live capability state. MVP `runtimeCapabilities` models only tool availability (see Section 2.5); it does not contain capability classes beyond `availableToolIds`, `unavailableToolIds`, and `capabilityInventoryComplete`. The runtime_capability selector must not reason about undefined capability-class fields.

**Positive include signals:**
- `requiredWhen` contains `promptFamily` → include / `required_match`
- `runtimeCapabilities.capabilityInventoryComplete: false` → conservatively include all `runtime_capability` components; emit `capability_inventory_incomplete` warning
- Component describes a restriction, limitation, no-access rule, or safety-relevant runtime constraint (signalled by `riskLevel: high`, `retainPolicy` ≠ `optional`, or `omissionPolicy: never`) → include / `safety_override` or fail-open
- Hard protection → include / `safety_override` (Step 3)

**Safe omit signals (Path A only):**
- `safeToOmitWhen` contains `promptFamily` AND `requiredWhen` does not AND `capabilityInventoryComplete: true` AND component has no safety or restriction markers → Path A eligible
- All `evidenceRequired` atoms satisfied
- **Restriction/safety components are never eligible for Path A.** Do not omit descriptors that express access limitations or safety constraints.

**Path B omit:**
- `defaultAction: omit` AND no positive signals AND `capabilityInventoryComplete: true` AND no safety/restriction markers

**Fail-open triggers:**
- `runtimeCapabilities` absent → include / `fail_open` for all runtime_capability components + `runtime_capabilities_missing` warning
- `capabilityInventoryComplete: false` → conservatively include all runtime_capability components + `capability_inventory_incomplete` warning
- Any safety/restriction signal present → include / `fail_open`; do not omit
- Malformed `evidenceRequired` → Path A disabled

**Warning codes:** `runtime_capabilities_missing`, `capability_inventory_incomplete`, `evidence_required_invalid`, `conflicting_tags`

**Trace atoms required:** `promptFamily`, `capabilityInventoryComplete` value, matched tag, safety/restriction markers if applicable, `defaultAction`

**Not allowed:**
- Live runtime probing or endpoint calls
- Include raw capability payload data in trace
- Reason about capability classes or fields not defined in the MVP `runtimeCapabilities` input contract (Section 2.5)
- Omit restriction or safety-relevant runtime descriptors

> **Evaluation Harness boundary note (15-Q5 — safe-defer):** Path A and Path B omission for `runtime_capability` components are gated on `capabilityInventoryComplete: true`. In early MVP, operator-authored `runtimeCapabilities` inputs may set `capabilityInventoryComplete: false` or omit `runtimeCapabilities` entirely; both cases are treated as incomplete inventory. In that state, fail-open inclusion of all `runtime_capability` components is **correct MVP behavior, not a test failure** — the selector emits `capability_inventory_incomplete` or `runtime_capabilities_missing` and includes all such components.
>
> **Harness fixture rules:**
> - Fixtures that exercise `runtime_capability` omission (Path A or Path B) **must** explicitly set `capabilityInventoryComplete: true` in the `runtimeCapabilities` input. A fixture that omits this flag and then asserts an omit decision was produced is testing the wrong path and will produce false-green results.
> - Fixtures for the incomplete-inventory path must assert all three of: (a) every `runtime_capability` component received `action: include`, (b) `capability_inventory_incomplete` or `runtime_capabilities_missing` is present in `planningWarnings`, and (c) no `runtime_capability` component received `action: omit` or `action: defer`.

---

## 15. Pass 3.2.1 Open Questions

1. **How should `evidenceRequired` atoms be extended for selector-specific signals?** The Component Registry Spec defines the base atom set. Selector-specific signals (e.g., `active_skill_id_match`, `output_format_hint_match`) add new atoms. Should new atoms be defined centrally in the registry spec or per-selector? Needs a governance decision before trace schema is finalised.

2. ~~**Should `activeSkillIds`, `activeToolIds`, `activeMemoryIds` be validated against the registry before selector evaluation?**~~ **Resolved/reference Pass 4.8B.** Decision: validation of `activeSkillIds`, `activeToolIds`, and `activeMemoryIds` against `componentsById` is owned by the **core boundary / orchestrator**, not by individual selectors. Validation runs once before selector fan-out begins.

   **Canonical behavior:**
   - For each ID in `activeSkillIds`, `activeToolIds`, `activeMemoryIds`: if the ID is not present in `componentsById`, it is unknown.
   - Unknown active IDs are collected into `unknownActiveIds[]` in the core boundary output — one entry per unknown ID, recording the ID and which list it appeared in (`skill`, `tool`, or `memory`).
   - Each unknown active ID produces a `active_id_unknown` planning warning (one per ID). These warnings appear in `planningWarnings`.
   - Unknown active IDs do **not** automatically produce `reference_unknown` SelectionDecision records — `reference_unknown` is for IDs referenced during selector evaluation of candidates, not for IDs listed as active that simply have no matching registry component.
   - Selectors receive the **validated** lists (IDs confirmed present in `componentsById`). Selectors treat these lists as trusted and do not re-validate them.
   - The distinction between `active_id_unknown` (active-list validation at the boundary) and `reference_unknown` (candidate-evaluation reference at selector time) must be preserved in both trace and harness.

   **Rationale:** A single validation pass at the core boundary prevents duplicate validation logic across 8 selectors, centralizes warning emission, and gives selectors a clean trusted input. It also matches the Class A / Class B input validation pattern already established in §2.

3. ~~**How should the history selector handle a component whose `lane` field is absent from the registry entry?**~~ **Resolved (Pass 3.2.1.1).** Absent `lane` is now handled in Section 14.4: fail-open for components with `riskLevel: high` or non-optional `retainPolicy`; warning code `history_lane_missing`; ordinary ladder proceeds for components with `defaultAction: include` and no safety markers. Remaining future work: confirm `lane` field name and allowed values against the Component Registry Spec before implementation (registry schema alignment, not selector behavior).

4. **What is the exact `formatTag` field name in the Component Registry Spec?** The output_format selector references `formatTag` as a registry field. This name should be confirmed against the registry spec before implementation to avoid a field-name mismatch.

5. ~~**Should `runtime_capability` component omission ever require `capabilityInventoryComplete: true`?**~~ **Resolved/reference Pass 4.8E-2B (15-Q5 — safe-defer, harness-sensitive).** Decision: the selector behavior is already correct — Path A and Path B omission are gated on `capabilityInventoryComplete: true`, and fail-open inclusion with the appropriate warning is the correct behavior when inventory is incomplete. The missing piece was a harness boundary note. That note has been added to §14.8. Key rule: harness fixtures for `runtime_capability` omission must explicitly set `capabilityInventoryComplete: true`; with `false` or missing inventory, fail-open inclusion is the expected and correct result. See §14.8 Evaluation Harness boundary note.

---

## 16. Pass 3.2.1.2 Definition of Done

- [x] Section 14: Per-Selector Deterministic Signal Rules defined
- [x] Section 14.0: Shared Deterministic Matching Rules defined — exact string matching, promptFamily enum matching, evidenceRequired evaluation, defaultAction behavior, no new omit paths
- [x] Section 14.0: Selector-specific missing-field defensive rule added — absent fields cannot authorize omit
- [x] Section 14.1: Scaffold selector — `requestSignals.promptFamilyTag` reference removed; uses `promptFamily` only
- [x] Section 14.2: Skill selector — `requestSignals.promptFamilyTag` removed; uses `promptFamily` only; absent `activeSkillIds` defaults to `[]` without warning; malformed produces one phase-level warning
- [x] Section 14.3: Tool selector — absent `activeToolIds` defaults to `[]` without warning; malformed produces one phase-level warning
- [x] Section 14.4: History selector — absent `lane` field handled: fail-open for safety/high-risk, `history_lane_missing` warning
- [x] Section 14.5: Memory selector — absent `activeMemoryIds` defaults to `[]` without warning; malformed emits one `active_memory_ids_malformed` phase warning
- [x] Section 14.6: Policy selector — hard-protected policy never eligible for Path A; high-risk fail-open defined
- [x] Section 14.7: Output format selector — absent `outputFormatHint` defaults to null without warning; malformed produces one phase warning; absent `formatTag` fails open (no omit decision)
- [x] Section 14.8: Runtime capability selector rewritten — undefined capability-class logic removed; restriction/safety-relevant descriptors never omitted; MVP runtimeCapabilities contract respected
- [x] Section 2.1: Optional selector signals (`activeSkillIds`, `activeToolIds`, `activeMemoryIds`, `outputFormatHint`) defined with defaults and malformed semantics
- [x] `requestSignals.promptFamilyTag` removed everywhere; replaced with `promptFamily`
- [x] No new omission path introduced beyond Path A and Path B
- [x] runtime_unavailable behavior preserved exactly: confirmed-unavailable → defer, unknown → fail-open, never omit
- [x] Hard protections not overridable by any selector-specific signal
- [x] No raw user text, raw history content, or raw component schema in any trace field
- [x] Header aligned with Pass 3.2.1
- [x] No active `requestSignals.promptFamilyTag` remains in any selector rule
- [x] All absent optional active* arrays consistently default to `[]` without warning (skill, tool, memory)
- [x] Section 15 Q3 resolved: `history_lane_missing` warning and fail-open behavior defined in Section 14.4
- [x] Section 15 Q3 no longer contradicts Section 14.4
- [x] Section 15: Q3 resolved (4 open questions remaining: Q1, Q2, Q4, Q5)
- [x] Section 16: This checklist
- [x] No injection-suspect ladder integration written (deferred to Pass 3.2.2)
- [x] No budget-aware selector hints written (deferred to Pass 3.2.2)
- [x] No model-assisted selector rules written
- [x] No code implemented
- [x] No JSON Schema files created
- [x] No runtime system touched
- [x] No OpenClaw state modified

**Pass 3.2.2 scope:**
- Injection-suspect ladder integration: how `requestSignals.injectionSuspect: true` flows into ladder step conditions
- Budget-aware selector hints: informational signals passed to selectors, not enforcement
- Resolve remaining open questions from Section 15 as needed before implementation

---

## 17. Injection-Suspect Integration

### 17.1 Purpose

Injection detection is performed exclusively by the **Request Router**. The Router analyzes the raw user request and emits a boolean flag: `requestSignals.injectionSuspect: true` if adversarial patterns are detected, `false` otherwise. Selectors never receive raw request text. They never perform pattern matching. They only consume the flag and apply the configured policy.

**Why selectors must not detect injection:** Selectors operate on registry metadata and structured signals. Allowing pattern matching inside selectors would require them to touch raw user text, violate the trust boundary defined in Section 2.1, and introduce a code path where untrusted content can influence selector logic directly.

**What selectors do with the flag:**
- Read `requestSignals.injectionSuspect` (boolean)
- Read `selectorPolicy.injectionSuspectAction` (enum)
- Apply the corresponding policy to ladder decisions
- Emit injection-suspect trace atoms on every affected decision
- Never alter hard protections or runtime_unavailable behavior

---

### 17.2 Inputs

The following inputs are consumed by injection-suspect integration. No new inputs are introduced.

| Input | Source | Role |
|---|---|---|
| `requestSignals.injectionSuspect` | `requestSignals` (Section 2.1) — boolean, validated by core boundary | Primary signal. If `true`, injection policy applies. If `false` or absent, injection policy does not apply. Absent is treated as `false`; no warning. |
| `selectorPolicy.injectionSuspectAction` | `selectorPolicy` (Section 2.9) — enum | Governs what happens when `injectionSuspect: true`. Required when injectionSuspect is used; absent defaults to `warn_and_continue`. |
| `promptFamily` | Existing input (Section 2.2) | Used by per-selector effect rules. |
| Registry component metadata | Existing — `retainPolicy`, `omissionPolicy`, `riskLevel`, `type` | Used to identify safety/privacy/policy components that must bias to include under injection signal. |
| Existing SelectionDecision records | Selector fan-out output | Injection policy is applied before a candidate `omit` or `defer` decision is finalised; it may upgrade the action to `include/fail_open`. |

**What is not a valid input:**
- Raw user request text
- Matched pattern snippets from injection detection
- Any new fields beyond those listed above

---

### 17.3 Allowed Policies

`selectorPolicy.injectionSuspectAction` has two **active MVP values**, one **reserved future value**, and a catch-all for genuinely unknown/typo values:

| Value | Status | Handling |
|---|---|---|
| `warn_and_continue` | ✅ Active MVP | Default. Ladder behavior preserved; ordinary low/medium-risk omits allowed and annotated with `injection_suspect_omit_allowed`. Branch A (hard-protection) and Branch B (high-risk) injection-gate upgrade paths are structurally unreachable. Branch C (low/medium policy, history-durable without hard-protection metadata) upgrade is deferred pending spec decision. See §17.3.1. |
| `fail_open_all` | ✅ Active MVP | Path A and Path B globally disabled; all omit → include/fail_open. See §17.3.2. |
| `halt_planning` | 🔒 Reserved future — not implemented in MVP | Recognized as a known future value. Must not halt planning. Apply `warn_and_continue` as effective policy. See §17.3.3. |
| Any other unknown value | ⚠️ Unknown/typo | Defaults to `warn_and_continue`; emits `injection_action_unknown` warning. Distinct from `halt_planning`. |

---

#### 17.3.1 `warn_and_continue`

**Behavior:**

- Ordinary ladder logic runs without modification.
- Every SelectionDecision emits `injection_suspect_seen: true` as an evidence atom when `injectionSuspect: true`.
- Any Path A or Path B `omit` decision that would be produced by the ladder is still allowed, **but:**
  - Add evidence/trace atom `injection_suspect_seen=true` to the decision.
  - Add warning code `injection_suspect_omit_allowed` to the `SelectionDecision.warnings` array and to the associated trace entry's `warningsEmitted` array. This distinguishes allowed omits from non-injection omits in both the decision record and the trace.
- **Branch A — Hard-protection cases (structurally unreachable as pre-gate omit):** Components carrying `riskLevel: critical`, `retainPolicy: safety_critical`, `retainPolicy: mandatory`, or `omissionPolicy: never` are included unconditionally at Step 3 before the injection gate fires. The injection-gate override is structurally unreachable for these components under standard MVP ladder ordering. They are not subject to any injection-gate upgrade because they cannot arrive at the injection gate as `action: omit`.
- **Branch B — High-risk cases (omit-gate blocked):** Components with `riskLevel: high` that do not satisfy any Step 3–6 include rule fall to Step 11 fail-open (`action: include`, `path: fail_open`) because Path A (Step 7, condition 5) and Path B (Step 8, condition 6) both require `riskLevel: low` or `medium`. A high-risk component therefore cannot arrive at the injection gate as `action: omit` either. The injection-gate override is unreachable for high-risk cases, but for omit-gate reasons, not Step 3 reasons.
- **Branch C — Unresolved / deferred (no current mandatory upgrade behavior):** Whether the injection gate should upgrade `action: omit` to `include / fail_open` for the following cases is **not yet resolved**:
  - `type: policy` components with `riskLevel: low` or `medium`, `retainPolicy: optional`, `omissionPolicy: allow`, and valid Path A/B omit gate conditions (per §7.6, this pattern can produce a Path A omit)
  - history-durable / open-commitment-like components not already covered by hard-protection metadata (`retainPolicy: safety_critical`, `retainPolicy: mandatory`, or `omissionPolicy: never`)
  - ~~`type: output_format` with `riskLevel: critical` or `riskLevel: high`~~ — both branches are already settled: `critical` is Branch A (Step 3), `high` is Branch B (omit-gate blocked); `riskLevel: low/medium` output_format components are explicitly **not** biased by this rule (18-Q1 resolved, Pass 4.8C).

  For Branch C cases today: **no upgrade and no omit may be asserted without a future clarification decision**. No fixture may be created for Branch C until a future pass explicitly resolves one of: (1) narrow the override so ordinary low/medium policy/output_format omits are allowed under `warn_and_continue`; (2) define Branch C triggers as protected and require `include / fail_open`; or (3) define explicit registry metadata or signal atoms that make the trigger reachable and testable. Reserve `injection_suspect_policy_override` as a future per-decision warning code for resolved Branch C or future ladder variants. Do not fire it in standard MVP operation.
- Hard protections (Step 3) still win unconditionally — no change; carry `injection_suspect_seen=true` evidence atom only.
- `runtime_unavailable` defer still wins unconditionally — no change; carry `injection_suspect_seen=true` evidence atom only.

> **MVP ladder ordering reachability analysis (Pass 4.9D-2U.R1):** The `injection_suspect_policy_override` override rule contains three structurally distinct branches with different reachability status:
>
> **Branch A — Structurally unreachable (Step 3 hard protection):** The following trigger markers are Step 3 hard-protection conditions (§8 Step 3): `riskLevel: critical`, `retainPolicy: safety_critical`, `retainPolicy: mandatory`, `omissionPolicy: never`. Any component carrying one of these markers is included unconditionally at Step 3 before the injection gate fires. It cannot arrive at the injection gate as `action: omit`. The `injection_suspect_policy_override` upgrade can never apply to these components under standard MVP ladder ordering.
>
> **Branch B — Omit-gate blocked (Path A/B condition 5):** `riskLevel: high` is not a Step 3 hard-protection condition and is therefore not caught by Branch A. However, both Path A (§8 Step 7, condition 5) and Path B (§8 Step 8, condition 6) require `riskLevel` to be `low` or `medium`. A `riskLevel: high` component that does not satisfy any Step 3–6 include rule falls through to Step 11 (`omissionPolicy: fail_open` or insufficient evidence), which produces `action: include`, `path: fail_open` — not `action: omit`. Therefore `riskLevel: high` trigger branches are also unreachable as pre-gate omit decisions in standard MVP, but for a different structural reason than Branch A (omit-gate exclusion, not hard-protection).
>
> **Branch C — Unresolved trigger ambiguity (deferred):** The following trigger cases are **not** conclusively handled by Branch A or B:
> - `type: policy` alone with `riskLevel: low` or `medium`, `omissionPolicy: allow`, `retainPolicy: optional`, and valid Path A/B omit gate conditions — §7.6 (Policy Selector) confirms this pattern is theoretically allowed by Path A gates (`riskLevel: low` or `medium` required). Whether a schema-valid low/medium-risk policy component can simultaneously satisfy the `injection_suspect_policy_override` trigger (`type: policy`) and the Path A/B omit conditions is not definitively ruled out by the spec.
> - `type: output_format` with `riskLevel: low` or `medium` — explicitly not biased by the rule (see 18-Q1 note; `riskLevel: high` is Branch B). No Branch C ambiguity for output_format.
> - History-durable / open-commitment components not already covered by hard-protection metadata (`retainPolicy: safety_critical`, `retainPolicy: mandatory`, or `omissionPolicy: never`): whether a history-durable component with optional/allow metadata can satisfy both the history-durable override trigger and a valid Path A/B omit condition is not definitively settled by current spec text.
>
> **Consequence for MVP implementation:** Do not implement or fire `injection_suspect_policy_override` for Branch A or Branch B triggers — both are structurally unreachable. For Branch C, the trigger ambiguity is unresolved: do not assert mandatory upgrade and do not assert mandatory allow for Branch C cases until a future clarification resolves the rule. Do not remove `injection_suspect_policy_override` from the advisory warning-code list — it is preserved for future use once Branch C reachability is resolved.
>
> **Consequence for fixture coverage:** The `injection_suspect_policy_override` sub-case is marked `WARN_AND_CONTINUE_OVERRIDE_DESIGN_DEFERRED` in `docs/12` §7.12. No fixture for this sub-case may be created until Branch C reachability is explicitly resolved. Existing `warn-and-continue-baseline`, `family-confidence-escalation`, and `fail-open-all` fixtures are not affected.

**Canonical evidence/warning distinction:**
- `injection_suspect_seen=true` is an **evidence/trace atom** on every finalised decision. It is not a warning code.
- `injection_suspect_omit_allowed` is the **warning code** for allowed Path A/B omit decisions under `warn_and_continue`.
- `injection_suspect_policy_override` is the **warning code** when the gate upgrades an omit to `include / fail_open`. Reserved in advisory enum; not fired in standard MVP until Branch C is resolved (see note above).

**Summary:** Ladder behavior is preserved; all decisions carry trace evidence of the injection signal. Branch A (hard-protection) and Branch B (high-risk) injection-gate override paths are structurally unreachable. Branch C (low/medium-risk policy, history-durable without hard-protection metadata) has unresolved trigger ambiguity and is deferred — no upgrade and no allow may be asserted today for Branch C cases.

---

#### 17.3.2 `fail_open_all`

**Behavior:**

- Path A (`safe_to_omit_match`) is disabled globally. No component may be omitted via Path A.
- Path B (`default_action_omit`) is disabled globally. No component may be omitted via Path B.
- All components that would have resolved to `omit` now resolve to `include / fail_open`.
- The following are **not** affected:
  - Confirmed-unavailable tools: still resolve to `defer / runtime_unavailable` (Priority 0 — unchanged).
  - `reference_unknown` components: still pass through as `reference_unknown`.
  - `path: quarantine_boundary_violation` decisions: already `action: include` / `confidence: low` with a planning error from Step 1. The injection gate must not convert, suppress, or re-annotate these as ordinary include evidence. They carry `quarantine_boundary_violation` path and `unexpected_quarantine_reference` planning error — those markers must be preserved intact. `quarantine` is not a selector action in MVP (F-17 resolved, Pass 4.7A); there are no `action: quarantine` decisions to pass through.
- Emit one global `injection_suspect_fail_open_all` planning warning (not one per component).
- Every SelectionDecision still carries `injection_suspect_seen: true` and `injectionSuspectAction: fail_open_all` as evidence atoms.

**Summary:** Conservative. All ordinary omit decisions are suppressed. May increase prompt size significantly. Runtime correctness decisions (defer), unknown references, and quarantine-boundary-violation (already include) decisions are not altered by the injection gate.

---

#### 17.3.3 `halt_planning` (reserved future value — not implemented in MVP)

**Status:** `halt_planning` is a recognized, known-but-not-implemented reserved future value. It is intended for high-security deployments where any confirmed injection attempt should abort the planning run entirely. This semantics is **not defined or implemented in MVP**.

**MVP behavior when `halt_planning` is supplied:**

1. The orchestrator recognizes `halt_planning` as a known future value (not a typo or unknown value).
2. The orchestrator emits a `policy_value_not_implemented` planning warning in `planningWarnings`.
3. The orchestrator applies `warn_and_continue` as the effective policy for this planning run.
4. Every SelectionDecision records the effective policy via `injectionSuspectAction` (always the final effective policy for this run). The **global planning trace entry** (once per run) records the requested policy (`halt_planning`), the final effective policy (`warn_and_continue`, or `fail_open_all` if familyConfidence escalation also fired), `policyFallbackReasons: ["policy_value_not_implemented"]` (escalation adds `"family_confidence_fail_open_escalation"` as a second element) — see §17.6 fallback trace fields. These fallback fields do **not** appear on every per-decision trace entry.

**What must not happen in MVP:**
- The orchestrator must not halt, abort, or short-circuit the planning run.
- The orchestrator must not suppress injection-suspect handling entirely.
- The orchestrator must not treat `halt_planning` silently as `warn_and_continue` without a trace-visible warning.
- The orchestrator must not emit `injection_action_unknown` for `halt_planning` (that code is for genuinely unknown/typo values only).

**Distinction from unknown values:**
- `halt_planning` → `policy_value_not_implemented` + `warn_and_continue` effective policy (planned future value, not a typo)
- Any other unrecognized value → `injection_action_unknown` + `warn_and_continue` effective policy (typo or unrecognized value)

**Summary:** `halt_planning` is safe to supply in a config file for forward-compatibility testing. MVP treats it as a known-but-disabled reserved value and continues with `warn_and_continue`. The fallback is always trace-visible.

**Chaining with familyConfidence escalation (§17.3.4):** If `requestSignals.familyConfidence < selectorPolicy.failOpenThreshold` also holds when `halt_planning` is supplied, the policy chain is: requested `halt_planning` → intermediate `warn_and_continue` → final effective `fail_open_all`. The `policyFallbackReasons` array records both steps in order: `["policy_value_not_implemented", "family_confidence_fail_open_escalation"]`.

---

#### 17.3.4 Low `familyConfidence` + `injectionSuspect` Escalation Rule (18-Q3 resolved, Pass 4.8C)

**Condition:** If **both** of the following hold simultaneously:
- `requestSignals.injectionSuspect === true`
- `requestSignals.familyConfidence < selectorPolicy.failOpenThreshold` (strict less-than)

**Effect:** The effective injection policy escalates to `fail_open_all`, regardless of the configured `injectionSuspectAction` — unless `fail_open_all` is already the effective policy (no change in that case).

This is **effective-policy normalization only** — `selectorPolicy` is never mutated. The requested policy is preserved in the trace.

**Threshold:** Uses the existing `selectorPolicy.failOpenThreshold` (float, default `0.7` when `selectorPolicy` is absent or field is absent). Comparison is strict less-than. A `familyConfidence` value exactly equal to `failOpenThreshold` is treated as barely adequate — no escalation fires at the boundary.

**Rationale:** When both the injection-detection signal and the family-confidence signal indicate degraded request quality simultaneously, the system lacks reliable categorical clarity to trust any ladder-based omit decision. The combined degraded-signal state is qualitatively more dangerous than either signal alone. `fail_open_all` is the safest conservative response consistent with the project’s fail-open safety invariant.

**Warning code:** `family_confidence_fail_open_escalation` — emitted once into `planningWarnings` per planning run alongside the standard `injection_suspect_fail_open_all` that fires for the resulting effective `fail_open_all` policy.

**Escalation does not apply when:**
- `injectionSuspect: false` or absent
- `familyConfidence >= failOpenThreshold` (at or above the threshold)
- Effective policy is already `fail_open_all` (no change; `family_confidence_fail_open_escalation` is not emitted)
- `familyConfidence` is absent or null — treat as non-triggering; emit `family_confidence_missing` warning and proceed with the configured policy

**Policy chain table (all cases):**

| Requested policy | Escalation condition met? | Final effective policy | `policyFallbackReasons[]` |
|---|---|---|---|
| `warn_and_continue` | No | `warn_and_continue` | `[]` |
| `warn_and_continue` | Yes | `fail_open_all` | `["family_confidence_fail_open_escalation"]` |
| `fail_open_all` | Yes or No | `fail_open_all` | `[]` |
| `halt_planning` | No | `warn_and_continue` | `["policy_value_not_implemented"]` |
| `halt_planning` | Yes | `fail_open_all` | `["policy_value_not_implemented", "family_confidence_fail_open_escalation"]` |
| unknown/typo | No | `warn_and_continue` | `["injection_action_unknown"]` |
| unknown/typo | Yes | `fail_open_all` | `["injection_action_unknown", "family_confidence_fail_open_escalation"]` |

**Global warning emission when escalation fires:**
1. Orchestrator emits `family_confidence_fail_open_escalation` into `planningWarnings` (once).
2. Orchestrator then emits `injection_suspect_fail_open_all` as the effective-policy global warning (once, for the final effective `fail_open_all`).
3. If a prior fallback also occurred (e.g., `halt_planning`), its warning (`policy_value_not_implemented`) was emitted first. Total: two or three global warnings depending on the chain.

---

### 17.4 Ladder Interaction

The injection policy check runs as a **post-step gate** after the deterministic ladder produces a candidate action for a component, but before the decision is finalised and recorded.

```

[Deterministic Ladder Steps 1–12]
      ↓
[Candidate action produced]
      ↓
[Policy Normalization — runs before the gate]
  → if familyConfidence < failOpenThreshold AND injectionSuspect: true:
       effective policy escalates to fail_open_all (§17.3.4)
  → else: effective policy = configured injectionSuspectAction (with halt_planning/unknown fallbacks)
      ↓
[Injection Gate — runs only if injectionSuspect: true]
  → if effective fail_open_all and candidate is omit:
       override to include/fail_open
  → if effective warn_and_continue and candidate is omit:
       NOTE: Branch A (riskLevel: critical, retainPolicy: safety_critical/mandatory, omissionPolicy: never)
             and Branch B (riskLevel: high) components cannot reach this point as action:omit —
             Branch A is included at Step 3; Branch B falls to Step 11 fail-open include.
       NOTE: Branch C (type: policy low/medium risk, history-durable without hard-protection metadata)
             is unresolved — injection_suspect_policy_override is NOT fired in standard MVP;
             no mandatory upgrade and no mandatory allow may be asserted for Branch C today.
       → pass through omit with injection_suspect_seen evidence atom
         + injection_suspect_omit_allowed warning on per-decision warningsEmitted
      ↓
[Final SelectionDecision recorded]
```

**Invariants:**

- **Injection gate cannot create a new omit path.** It may only upgrade `omit` to `include/fail_open`. It never downgrades.
- **Injection gate cannot override `runtime_unavailable`.** A confirmed-unavailable tool's `defer / runtime_unavailable` passes through unchanged; the gate skips it.
- **Injection gate cannot alter `reference_unknown` decisions.** `reference_unknown` is not an omit decision; it passes through unchanged.
- **Injection gate does not receive `action: quarantine` decisions.** `quarantine` is not a valid selector action in MVP (F-17 resolved, Pass 4.7A). If a `path: quarantine_boundary_violation` decision appears (Step 1 boundary-violation detection), it is already `action: include` / `confidence: low` with a planning error. The injection gate must not suppress or re-annotate it as ordinary include evidence; the `quarantine_boundary_violation` path and `unexpected_quarantine_reference` planning error must be preserved intact.
- **Hard protections are not affected.** Step 3 decisions (`include / safety_override`) pass through the gate with `injection_suspect_seen` added and no other change.
- **Injection signal cannot be silently ignored.** If `injectionSuspect: true`, every finalised decision must carry `injection_suspect_seen` in its evidence.
- **Gate-conversion metadata is preserved in selectorTrace (F-20 resolved, Pass 4.8C).** When the injection gate converts a decision (`actionChanged: true`), the pre-gate `originalCandidateAction` and `originalCandidatePath` are recorded in the selectorTrace entry. These fields are the canonical source of pre-gate conflict context. The Conflict Resolver may consult them via `SelectionDecision.traceRefs` and optionally summarize them in `conflictResolutionTrace` (see §11.6). The `SelectionDecision` shape does not change.

---

### 17.5 Per-Selector Effect Summary

The injection gate applies after each selector's ladder run. The following summarises the expected effect per selector type.

| Selector | `warn_and_continue` effect | `fail_open_all` effect |
|---|---|---|
| **scaffold** | Omit decisions carry `injection_suspect_seen`; no override unless component is safety-critical. | All omit disabled → include/fail_open. |
| **skill** | Omit decisions carry `injection_suspect_seen`; no override for standard skills. | All omit disabled → include/fail_open. |
| **tool** | Unavailable tools: `defer/runtime_unavailable` unchanged. Available tools: omit decisions carry `injection_suspect_seen`. | Unavailable: unchanged. Available: all omit disabled. |
| **history** | Hard-protection-encoded durable/open-commitment components (those with `retainPolicy: safety_critical/mandatory` or `omissionPolicy: never`) are included at Step 3 before the gate (Branch A — cannot arrive as omit). Non-durable omit decisions carry `injection_suspect_seen`. History-durable components not encoded via Step 3 hard-protection metadata are Branch C (unresolved) — no mandatory upgrade and no mandatory allow under `warn_and_continue` today. | All non-Step-3 omit disabled → include/fail_open. |
| **memory** | Omit decisions carry `injection_suspect_seen`. Components with `riskLevel: high` cannot produce Path A/B omit under standard omit-gate conditions (Branch B — falls to Step 11 fail-open include); no injection-gate upgrade applies. Low/medium ordinary omits are allowed under `warn_and_continue` unless a future Branch C rule asserts otherwise. | All omit disabled → include/fail_open. |
| **policy** | Hard-protection policy components (Branch A: `riskLevel: critical`, `retainPolicy: safety_critical/mandatory`, `omissionPolicy: never`) are included at Step 3 — cannot arrive at gate as omit. High-risk policy components (Branch B: `riskLevel: high`) are omit-gate blocked and fall to Step 11 fail-open include. Low/medium optional policy components (Branch C) are unresolved — no mandatory upgrade to `include / fail_open` and no mandatory allow may be asserted today; `injection_suspect_policy_override` is reserved in advisory enum and must not be fired in standard MVP. Allowed omit decisions carry `injection_suspect_omit_allowed`. | All omit disabled → include/fail_open (same effect as fail_open_all for policy components; different path). |
| **output_format** | `riskLevel: critical` output_format components are Branch A (Step 3 hard-protection — cannot arrive at gate as omit). `riskLevel: high` output_format components are Branch B (omit-gate blocked — fall to Step 11 fail-open include). `riskLevel: low` or `riskLevel: medium` output_format components are not an injection-gate override trigger (18-Q1 resolved, Pass 4.8C) — allowed omit decisions carry `injection_suspect_seen` only. No `injection_suspect_policy_override` is fired for output_format components in standard MVP. | All omit disabled → include/fail_open. |
| **runtime_capability** | Safety/restriction descriptors already fail-open by Section 14.8 rules. Other omit decisions carry `injection_suspect_seen`. | All omit disabled → include/fail_open. |

**Global rules for all selectors:**
- No raw component content in trace.
- No matched injection pattern text in trace.
- `injection_suspect_seen` must appear on every finalised decision when `injectionSuspect: true`.

---

### 17.6 Trace Requirements

Every SelectionDecision finalised when `injectionSuspect: true` must include the following in its trace entry:

| Field | Required | Content |
|---|---|---|
| `injectionSuspect` | Yes | `true` |
| `injectionSuspectAction` | Yes | The **effective** applied policy value (`warn_and_continue` or `fail_open_all`) — the policy that actually governed behavior in this run |
| `actionChanged` | Yes | `true` if the injection gate overrode the candidate action; `false` if the candidate passed through unchanged |
| `originalCandidateAction` | Yes if `actionChanged: true` | The action that the ladder produced before the gate overrode it (e.g., `omit`) |
| `originalCandidatePath` | Yes if `actionChanged: true` | The path the ladder produced (e.g., `safe_to_omit_match`) |
| `warningsEmitted` | Yes | Array of injection-related warning codes emitted for this decision |

**Policy fallback trace fields (required when effective policy differs from requested policy, or when familyConfidence escalation occurred):**

When the orchestrator applies a fallback policy (e.g., `halt_planning` supplied in MVP) or a familyConfidence escalation (§17.3.4), both the requested and final effective policies must be recorded. These fields appear in the **global planning trace entry** (once per run), not on every per-decision trace entry:

| Field | Required | Content |
|---|---|---|
| `requestedInjectionSuspectAction` | Yes when fallback or escalation occurred | The value the operator supplied in `selectorPolicy.injectionSuspectAction` (e.g., `halt_planning`) |
| `effectiveInjectionSuspectAction` | Yes when fallback or escalation occurred | The **final** effective policy actually applied (e.g., `fail_open_all`) |
| `policyFallbackReasons` | Yes when fallback or escalation occurred | **Array** of warning codes explaining each resolution step, in order. Empty array when no fallback or escalation occurred. Examples: `["policy_value_not_implemented"]` for a `halt_planning` fallback only; `["family_confidence_fail_open_escalation"]` for a familyConfidence escalation only; `["policy_value_not_implemented", "family_confidence_fail_open_escalation"]` for a `halt_planning` fallback followed by familyConfidence escalation. The same codes also appear in `planningWarnings`. |

> **Invariant:** The per-decision `injectionSuspectAction` field always reflects the **final effective** policy. The global trace fields `requestedInjectionSuspectAction` / `effectiveInjectionSuspectAction` / `policyFallbackReasons` are the audit record for all resolution steps. A trace that shows only `warn_and_continue` without preserving that `halt_planning` was the requested value is a traceability failure. A trace that omits `family_confidence_fail_open_escalation` from `policyFallbackReasons` when familyConfidence escalation occurred is also a traceability failure.

> **selectorTrace canonical note for injection gate conversion (F-20 resolved, Pass 4.8C):** For each SelectionDecision where the injection gate converted the action (`actionChanged: true`), the `originalCandidateAction` and `originalCandidatePath` fields on the selectorTrace entry are the **canonical record** of what the ladder produced before gate conversion. The Conflict Resolver may consult these fields via `SelectionDecision.traceRefs`. The `conflictResolutionTrace` optionally summarizes gate-conversion context via `hadGateConvertedDecisions`, `gateConvertedTraceRefs`, `preGateActions`, `preGatePaths` — see §11.6. The `SelectionDecision` shape does not change.

**Privacy constraints (unconditional):**
- No raw user request text in any trace field
- No matched injection pattern text in any trace field
- No raw component content in any trace field

**One global warning per planning run — orchestrator-owned, exactly-once (F-18 resolved, Pass 4.7C):**

The **orchestrator** is the sole owner of global injection warning emission. Selectors and per-decision injection gates must not emit the global per-run injection warning codes (`injection_suspect_warn_and_continue`, `injection_suspect_fail_open_all`) independently.

**Emission rule:**

If `requestSignals.injectionSuspect: true`, the orchestrator emits exactly one global injection warning per planning run into `planningWarnings`. The warning code is determined by the effective policy:

| Effective policy | Global warning code emitted |
|---|---|
| `warn_and_continue` | `injection_suspect_warn_and_continue` |
| `fail_open_all` | `injection_suspect_fail_open_all` |

The orchestrator emits this warning once after policy normalization (before or after fan-out, but never repeated). The orchestrator maintains a conceptual `globalInjectionWarningSent` boolean that is set to `true` on first emission. No second emission occurs regardless of how many selectors run.

**Policy fallback interaction:**

| Scenario | Global warnings emitted (in order) |
|---|---|
| `halt_planning` supplied, no escalation | `policy_value_not_implemented` → `injection_suspect_warn_and_continue` — total: 2 |
| `halt_planning` supplied + familyConfidence escalation | `policy_value_not_implemented` → `family_confidence_fail_open_escalation` → `injection_suspect_fail_open_all` — total: 3 |
| unknown/typo policy, no escalation | `injection_action_unknown` → `injection_suspect_warn_and_continue` — total: 2 |
| unknown/typo policy + familyConfidence escalation | `injection_action_unknown` → `family_confidence_fail_open_escalation` → `injection_suspect_fail_open_all` — total: 3 |
| `warn_and_continue` + familyConfidence escalation | `family_confidence_fail_open_escalation` → `injection_suspect_fail_open_all` — total: 2 |
| `fail_open_all` configured directly | `injection_suspect_fail_open_all` — total: 1 |
| `warn_and_continue`, no escalation | `injection_suspect_warn_and_continue` — total: 1 |

**Per-decision warning codes are distinct and unaffected:**
The following are per-decision codes, not global-per-run codes. They are written to `SelectionDecision.warnings` and `traceEntry.warningsEmitted`. They do not count toward the global warning deduplication rule:
- `injection_suspect_omit_allowed` — allowed omit under `warn_and_continue`
- `injection_suspect_policy_override` — omit upgraded to include by the gate

**What must not happen:**
- A selector must not independently emit `injection_suspect_warn_and_continue` or `injection_suspect_fail_open_all`.
- A per-decision trace entry must not contain `injection_suspect_warn_and_continue` or `injection_suspect_fail_open_all` in `warningsEmitted`.
- The global warning must not appear more than once in `planningWarnings` per planning run.
- The global warning must not be emitted once per selector invocation (8 selectors → 8 warnings is a defect).

**Trace placement:** `planningWarnings` array in the global planning trace entry. Appears exactly once. Not in per-decision `warningsEmitted`.

---

### 17.7 Evaluation Requirements

The Evaluation Harness must enforce zero tolerance for the following conditions:

| Condition | Harness check |
|---|---|
| Raw prompt text in injection trace | Any raw user text or matched pattern text in trace fields is a privacy failure |
| Selector-side pattern matching | Any evidence that a selector performed injection detection independently is a trust-boundary violation |
| `fail_open_all` producing omit | Any `action: omit` decision when `injectionSuspectAction: fail_open_all` is a critical failure |
| Injection signal creating new omit path | Any new `omit` decision that only arises because `injectionSuspect: true` (rather than being suppressed) is a planning error |
| Injection signal overriding `runtime_unavailable` | Any confirmed-unavailable tool resolved to `include` due to injection signal is a runtime-correctness failure |
| `injectionSuspect: true` silently ignored | Any finalised decision missing `injection_suspect_seen` when `injectionSuspect: true` is a traceability failure |
| Branch A/B hard-protection or high-risk invalid omit under `warn_and_continue` | Any `action: omit` for a component with `riskLevel: critical`, `retainPolicy: safety_critical`, `retainPolicy: mandatory`, or `omissionPolicy: never` (Branch A) is a hard-protection / Step 3 ladder failure — these components are included before the injection gate fires and cannot arrive as `action: omit`. Any `action: omit` for a `riskLevel: high` component (Branch B) is an omit-gate failure — Path A/B require `riskLevel: low` or `medium`; high-risk components fall to Step 11 fail-open include. Neither failure is an injection-gate override defect. Branch C (`type: policy` with low/medium risk — unresolved): no harness check may assert mandatory upgrade or mandatory allow for Branch C cases until a future clarification pass resolves the rule. `injection_suspect_policy_override` must not be expected or required by any MVP harness check. (Pass 4.9D-2U.R1.3) |
| `halt_planning` halting the planning run in MVP | Any planning run that aborts or short-circuits when `injectionSuspectAction: halt_planning` is supplied is a critical failure — MVP must apply `warn_and_continue` effective policy and continue |
| `halt_planning` treated as unknown value | Emitting `injection_action_unknown` (instead of `policy_value_not_implemented`) when `halt_planning` is supplied is a harness-distinguishable error |
| Missing fallback trace when fallback occurred | A trace missing `requestedInjectionSuspectAction`, `effectiveInjectionSuspectAction`, or `policyFallbackReasons` in the global planning trace entry when a policy fallback or escalation was applied is a traceability failure |
| Global injection warning emitted more than once | More than one occurrence of `injection_suspect_warn_and_continue` or `injection_suspect_fail_open_all` in `planningWarnings` for a single planning run is a deduplication failure (F-18 resolved, Pass 4.7C) |
| Global injection warning emitted from selector or gate | Any occurrence of `injection_suspect_warn_and_continue` or `injection_suspect_fail_open_all` in a per-decision `warningsEmitted` array is a trust-boundary violation — these are orchestrator-level codes only |
| Global injection warning absent when injectionSuspect: true | If `injectionSuspect: true` and neither `injection_suspect_warn_and_continue` nor `injection_suspect_fail_open_all` appears in `planningWarnings`, the orchestrator has silently suppressed the required notification — a traceability failure |
| Critical/high output_format invalid omit under `warn_and_continue` | Any `action: omit` for a `type: output_format` component with `riskLevel: critical` (Branch A — Step 3 hard-protection, included before injection gate) or `riskLevel: high` (Branch B — omit-gate blocked, falls to Step 11 fail-open include) is a Step 3 / omit-gate ladder failure, not a missing injection-gate override. `riskLevel: low` or `riskLevel: medium` output_format components are not subject to injection-gate override in standard MVP (18-Q1 resolved, Pass 4.8C). No `injection_suspect_policy_override` is expected for output_format components under `warn_and_continue` in standard MVP. (Pass 4.9D-2U.R1.3) |
| `fail_open_all` not achieved when both signals degrade | If `injectionSuspect: true` and `familyConfidence < failOpenThreshold`, any resolved omit decision under effective `warn_and_continue` policy is a policy-normalization failure — the escalation rule (§17.3.4) must have fired and produced effective `fail_open_all` (18-Q3 resolved, Pass 4.8C) |
| familyConfidence escalation missing from `policyFallbackReasons` | If the §17.3.4 escalation condition was met and `family_confidence_fail_open_escalation` does not appear in `policyFallbackReasons` in the global planning trace, it is a traceability failure (18-Q3 resolved, Pass 4.8C) |
| `actionChanged: true` missing pre-gate fields in selectorTrace | If a selectorTrace entry has `actionChanged: true` but lacks `originalCandidateAction` or `originalCandidatePath`, it is a traceability failure (F-20 resolved, Pass 4.8C) |

---

## 18. Pass 3.2.2 Open Questions

1. ~~**Should `injectionSuspect: true` bias `output_format` components to include under `warn_and_continue`?**~~ **Resolved/reference Pass 4.8C.** Decision: scoped output_format bias applies. If `injectionSuspect: true`, effective policy is `warn_and_continue`, and the component is `type: output_format` with `riskLevel: critical` or `riskLevel: high`, the injection gate converts any ladder `omit` to `include / fail_open` and emits `injection_suspect_policy_override`. `riskLevel: low` or `riskLevel: medium` output_format components are not biased. Canonical rule in §17.3.1; per-selector summary in §17.5; harness check in §17.7.

2. ~~**Should there be a third policy value (e.g., `halt_planning`)?**~~ **Resolved/reference Pass 4.7B (F-24).** Decision: `halt_planning` is recognized as a known future/non-MVP value in `selectorPolicy.injectionSuspectAction`. It is not implemented in MVP. If an operator config supplies `halt_planning` in MVP, the orchestrator emits `policy_value_not_implemented` and applies `warn_and_continue` as the safe fallback — this is distinct from the generic `injection_action_unknown` path used for typos. Halt semantics are not defined and must not be implemented in MVP. See §2.9 `injectionSuspectAction` table for the canonical wording.

3. ~~**How should `injectionSuspect` interact with `familyConfidence`?**~~ **Resolved/reference Pass 4.8C.** Decision: if `requestSignals.injectionSuspect === true` and `requestSignals.familyConfidence < selectorPolicy.failOpenThreshold` (strict less-than), the effective injection policy escalates to `fail_open_all` regardless of the configured `injectionSuspectAction`. Uses existing `failOpenThreshold` (no new field). `family_confidence_fail_open_escalation` warning emitted once into `planningWarnings`. `policyFallbackReasons: string[]` records all resolution steps in order (replaces the former singular `policyFallbackReason`). Chaining with `halt_planning` and unknown-policy fallbacks is defined in §17.3.4 policy chain table. Canonical rule in §17.3.4.

4. ~~**Should the global injection warning be emitted once per planning run or once per selector invocation?**~~ **Resolved/reference Pass 4.7C (F-18).** Decision: the **orchestrator** emits exactly one global injection warning per planning run. Selectors and per-decision injection gates must not emit the global warning codes (`injection_suspect_warn_and_continue`, `injection_suspect_fail_open_all`) independently. The orchestrator maintains a conceptual `globalInjectionWarningSent` boolean; emission occurs once after policy normalization. Warning code is determined by effective policy. Fallback-only cases (`halt_planning`, unknown/typo with no escalation) emit one policy-level warning followed by exactly one effective-policy global warning (total: 2). Fallback plus familyConfidence escalation may additionally emit `family_confidence_fail_open_escalation` before the final effective-policy global warning (total: 3). See §17.6 for the complete per-scenario warning table. Per-decision codes (`injection_suspect_omit_allowed`, `injection_suspect_policy_override`) are distinct and unaffected.

---

## 19. Pass 3.2.2 Definition of Done

- [x] Section 17: Injection-Suspect Integration defined
- [x] Injection boundary stated: Request Router detects, selectors consume boolean flag only; no pattern matching inside selectors
- [x] Inputs defined: 5 inputs, no raw prompt text, no new fields
- [x] `warn_and_continue` behavior defined: ladder unchanged; safety/policy/history-durable omit upgraded to include/fail_open; all decisions carry injection_suspect_seen; high-risk output_format omit also upgraded (18-Q1 resolved, Pass 4.8C)
- [x] `fail_open_all` behavior defined: Path A and Path B globally disabled; all omit → include/fail_open; runtime_unavailable and reference_unknown pass through unchanged; `path: quarantine_boundary_violation` decisions (already `action: include`) pass through with markers preserved; `action: quarantine` is not a valid selector action in MVP (F-17 resolved, Pass 4.7A)
- [x] Unknown `injectionSuspectAction` value defaults to `warn_and_continue` with `injection_action_unknown` warning
- [x] `halt_planning` recognized as reserved future value — not implemented in MVP; emits `policy_value_not_implemented` warning; applies `warn_and_continue` effective policy; distinct from `injection_action_unknown`; trace preserves requested vs. effective policy (Pass 4.7B.1)
- [x] familyConfidence escalation rule defined: if `injectionSuspect: true` and `familyConfidence < failOpenThreshold`, effective policy escalates to `fail_open_all`; uses existing `failOpenThreshold`; `family_confidence_fail_open_escalation` warning; `policyFallbackReasons[]` array; chain table defined (§17.3.4) (18-Q3 resolved, Pass 4.8C)
- [x] Ladder interaction defined: injection gate runs post-ladder as a gated override; invariants stated
- [x] Injection gate cannot create new omit path
- [x] Injection gate cannot override runtime_unavailable
- [x] Injection gate cannot alter reference_unknown decisions; `action: quarantine` is not a valid selector action in MVP (F-17 resolved, Pass 4.7A); `path: quarantine_boundary_violation` decisions pass through with markers preserved
- [x] Per-selector effect summary defined for all 8 selector types (output_format row updated, Pass 4.8C)
- [x] Trace requirements defined: 6 per-decision fields + 3 global-planning-trace fallback fields (`policyFallbackReasons[]` replaces singular `policyFallbackReason`, Pass 4.8C) + 3 privacy constraints + orchestrator-owned exactly-once global planning warning + selectorTrace canonical note for F-20 (F-20 resolved, Pass 4.8C)
- [x] Evaluation requirements defined: 17 zero-tolerance harness checks (13 prior + 4 added Pass 4.8C: high-risk output_format omit, familyConfidence escalation not achieved, escalation missing from trace, `actionChanged` missing pre-gate fields)
- [x] Section 18: 4 Pass 3.2.2 open questions listed; 18-Q1 resolved/reference (Pass 4.8C); 18-Q2 resolved/reference (Pass 4.7B); 18-Q3 resolved/reference (Pass 4.8C); 18-Q4 resolved/reference (Pass 4.7C)
- [x] Global injection warning deduplication defined: orchestrator-owned, exactly-once per run, globalInjectionWarningSent conceptual state, per-decision codes distinct (Pass 4.7C)
- [x] Header aligned with Pass 3.2.2
- [x] `selectorPolicy` reference corrected to Section 2.9 in Section 17.2
- [x] `injection_suspect_seen=true` defined as evidence/trace atom, not a warning code
- [x] `injection_suspect_omit_allowed` defined as the warning code for allowed Path A/B omit decisions under warn_and_continue
- [x] Privacy constraint count corrected to 3 in Section 17.6 and DoD
- [x] Warning destination clarified: `injection_suspect_omit_allowed` is written to `SelectionDecision.warnings` AND trace entry `warningsEmitted`
- [x] Section 19: This checklist
- [x] No budget-aware selector hints written (deferred to Pass 3.2.3)
- [x] No model-assisted selector rules written
- [x] No code implemented
- [x] No JSON Schema files created
- [x] No runtime system touched
- [x] No OpenClaw state modified

**Pass 3.2.3 scope:**
- Budget-aware selector hints: informational token-budget signals passed to selectors, not enforcement
- Resolve open questions from Sections 15 and 18 as needed before implementation

---

*File changed: `docs/06_SELECTOR_ORCHESTRATION_SPEC.md`*
*Pass 3.2.2.1 fixes: (1) header updated to Pass 3.2.2; (2) selectorPolicy reference corrected to Section 2.9; (3) injection_suspect_seen clarified as evidence/trace atom; injection_suspect_omit_allowed added as warning code for allowed omits; (4) privacy constraint count corrected to 3; (5) DoD updated.*
*Open questions: 8 from Pass 1 (§5) + 5 from Pass 2 (§9) + 4 from Pass 3.1 (§12) + 4 from Pass 3.2.1 (§15) + 4 from Pass 3.2.2 (§18).*
*Pass 3.2.3 handles: budget-aware selector hints.*

---

## 20. Budget-Aware Selector Hints

### 20.1 Purpose

Selectors may observe budget context in order to annotate decisions with informational hint atoms, warning codes, and trace fields. **Budget enforcement is exclusively the Budgeter's responsibility.** Selectors never trim, omit, or defer components based on budget pressure alone. Budget hints exist to give the Budgeter richer per-component context without adding enforcement logic to selectors.

**Why budget hints are informational only:**
- Selectors operate on registry metadata and request signals. Allowing selectors to omit based on token cost would mix the planning (inclusion/omission) and budgeting (sizing) concerns, violate the single-responsibility boundary between the Selector Orchestrator and the Budgeter, and create a second omission path outside Path A and Path B.
- The Budgeter has full visibility into the prompt plan and can make globally-optimal trimming decisions. A selector only sees one component at a time.

**What budget-aware selectors do:**
- Observe `budgetState` and component cost metadata
- Attach `budgetHint` and related atoms to SelectionDecision or selectorTrace entries
- Emit budget-related warning codes when cost data is missing or budget pressure is high
- Never change `action` or `path` based on budget signals alone

---

### 20.2 Inputs

The following existing fields are consumed. No new required inputs are introduced.

| Input | Source | Notes |
|---|---|---|
| `budgetState` | Section 2.7 — existing input | Contains `totalPromptTokenTarget`, `maxScaffoldTokens`, `maxSkillTokens`, `maxToolTokens`, `maxHistoryTokens`, `reservedUserTokens`, `budgetCritical`. Fields such as `remainingTokens`, `usedTokens`, `totalTokenBudget`, and `budgetPressureLevel` are **not** part of the MVP selector input contract; they are Budgeter-derived and not forwarded to selectors. |
| `tokensApprox` | Component registry metadata | Estimated token cost of this component. May be absent. |
| `charsApprox` | Component registry metadata | Estimated character count. May be absent. May substitute for `tokensApprox`. |
| `budgetPriority` | Component registry metadata | Ordered hint for Budgeter trimming order. Optional. |
| `retainPolicy` | Component registry metadata | Existing field — determines hard protection. |
| `omissionPolicy` | Component registry metadata | Existing field — determines hard protection. |
| `riskLevel` | Component registry metadata | Existing field — influences hint classification. |
| `defaultAction` | Component registry metadata | Existing field — read-only. |
| Existing SelectionDecision records | Selector fan-out output | Budget hints are attached after the ladder decision is produced. |

**What is not a valid input:**
- Raw prompt text or assembled prompt content
- Token counts derived from model tokenization at planning time (only pre-computed registry metadata is used)
- Any new input field not listed above

---

### 20.3 Core Rules

These invariants apply unconditionally. No selector-specific behavior may override them.

1. **Budget pressure cannot authorize omit.** A component whose ladder decision is `include` (any path) must remain `include` regardless of `budgetCritical` or `tokensApprox`.
2. **Budget pressure cannot override hard protections.** Components with `retainPolicy: safety_critical`, `omissionPolicy: never`, or `riskLevel: critical` remain included regardless of budget.
3. **Budget pressure cannot override `runtime_unavailable`.** A confirmed-unavailable tool's `defer / runtime_unavailable` is not changed by budget signals.
4. **Budget pressure cannot override `fail_open_all`.** When `injectionSuspectAction: fail_open_all` is active, budget hints may still be attached but cannot re-enable omit.
5. **Budget pressure cannot remove durable/open-commitment history.** History components with `lane: durable_constraints` or `lane: open_commitments` are protected regardless of cost.
6. **Budget hints cannot change `action` or `path`.** The `action` and `path` fields of a SelectionDecision are set exclusively by the deterministic ladder and the injection gate. Budget hints are additional metadata only.
7. **Selectors may attach `budgetHint` and `budgetWarningCodes` to SelectionDecision and trace entries.** They may not add a new `action` or mutate an existing one.
8. **Budget savings claims are forbidden for `runtime_unavailable` defers.** A confirmed-unavailable tool's deferral is not token savings; it must not be counted as such.

---

### 20.4 Budget Hint Fields

The following conceptual fields may be attached to a `SelectionDecision` record or its associated `selectorTrace` entry. They are informational annotations, not decision fields.

| Field | Type | Meaning |
|---|---|---|
| `budgetHint` | enum string | Classification of this component's budget posture. One of the values below. |
| `budgetReason` | coded string atom | Machine-readable reason code explaining the hint. No raw text. |
| `tokensApproxObserved` | integer or null | The `tokensApprox` value read from registry metadata, or null if absent. |
| `budgetPriorityObserved` | integer 1–10 or null | The `budgetPriority` value read from registry metadata (numeric rank 1–10, per Component Registry Spec), or null if absent. |
| `budgetCriticalObserved` | boolean | The `budgetState.budgetCritical` flag value at the time the hint was produced. |
| `budgetWarningCodes` | string[] | Warning codes emitted by budget-hint logic for this component. |

**`budgetHint` values:**

| Value | Meaning |
|---|---|
| `protected` | Component is hard-protected (safety, policy, durable history, `omissionPolicy: never`). Budgeter must not trim. |
| `candidate_optional` | Component is optional (`defaultAction: omit` or `retainPolicy: optional`) and has no hard protection. Budgeter may consider trimming. |
| `expensive_optional` | Component is optional (meeting the Section 23 eligibility criteria) AND cost meets the Section 23 threshold (>= 500 approximate tokens). Budgeter may prioritise trimming this first. |
| `over_budget_protected` | Component is protected AND its `tokensApprox` alone exceeds `totalPromptTokenTarget` or the applicable per-type max (`maxScaffoldTokens`, `maxHistoryTokens`, etc.) from `budgetState` (Section 2.7). Selectors cannot compare against remaining budget in MVP — that comparison is Budgeter-owned. Budgeter must still include the component; this is a planning warning. |
| `unknown_cost` | `tokensApprox` and `charsApprox` are both absent. Budgeter cannot estimate this component's contribution. |

**`budgetReason` coded atoms (non-exhaustive):**

- `retain_policy_safety_critical`
- `omission_policy_never`
- `risk_level_critical`
- `durable_history_lane`
- `default_action_optional`
- `high_token_estimate`
- `cost_unknown`
- `budget_critical_flag`

**Privacy rule:** `budgetReason` must never contain raw component content, raw user text, or free-form strings. Only defined coded atoms are allowed.

---

### 20.5 Per-Selector Hint Behavior

The following summarises how each selector type produces budget hints. All hints are produced after the ladder decision is finalised; they do not alter it.

| Selector | `budgetHint` logic | Notable warnings |
|---|---|---|
| **scaffold** | If hard-protected → `protected`. If eligible-optional (Section 23 criteria): apply Section 23 threshold rules → `expensive_optional`, `candidate_optional`, or `unknown_cost`. If `defaultAction: omit` but hard-protection fields are contradictory → fail safe to `protected` or `unknown_cost`. | `budget_cost_unknown` if both `tokensApprox` and `charsApprox` absent. |
| **skill** | If hard-protected → `protected`. Eligible-optional skills (Section 23): apply Section 23 threshold rules. Missing cost → `unknown_cost`. | `budget_cost_unknown`. |
| **tool** | Confirmed-unavailable: no budget hint emitted (tool is deferred, not budgeted). Available tools: apply Section 23 threshold rules if eligible-optional. | `runtime_unavailable_no_budget_savings` if a caller incorrectly tries to count deferred tools as savings. |
| **history** | Durable/open-commitment lane → `protected` (highest priority). Non-durable optional lanes: apply Section 23 threshold rules. `historyMalformed: true` → annotate with `budget_pressure_seen` but keep include/fail_open action. | `budget_cost_unknown`, `durable_history_protected`. |
| **memory** | If hard-protected → `protected`. Eligible-optional memory (Section 23): apply Section 23 threshold rules. Missing cost → `unknown_cost`. | `budget_cost_unknown`. |
| **policy** | Safety/privacy hard-protected → `protected`. Non-safety optional policy → `candidate_optional`. If protected component's `tokensApprox` exceeds `totalPromptTokenTarget` or applicable per-type max from `budgetState` → `over_budget_protected` + warning. Remaining-budget comparison is Budgeter-owned; selectors do not receive `remainingTokens` in MVP. | `over_budget_protected_policy`. |
| **output_format** | Output format components may be inexpensive but structurally important. Do not assign `expensive_optional` based on cost alone if the format is `requiredWhen`-matched. Eligible-optional unmatched format: apply Section 23 threshold rules. Missing cost → `unknown_cost`. | `budget_cost_unknown`. |
| **runtime_capability** | Safety/restriction descriptors → `protected`. Eligible-optional non-safety metadata descriptors: apply Section 23 threshold rules. Missing cost → `unknown_cost`. | `budget_cost_unknown`. |

**Global rule:** If `budgetState.budgetCritical: true`, all selectors must emit `budget_pressure_seen` as a warning code in `budgetWarningCodes` for every component that is not hard-protected **and is not a confirmed-unavailable tool**. Confirmed-unavailable tools are deferred for runtime correctness and are not in the budget accounting; they must not receive generic budget hints and must not be counted in budget savings.

---

### 20.6 Interaction with Path A and Path B

Budget hints interact with ladder omit decisions as follows:

- **If Path A is already valid** (omit / `safe_to_omit_match`): the budget hint may annotate the decision (e.g., `expensive_optional`) but does not change `action` or `path`. The omit proceeds as ladder-derived.
- **If Path B is already valid** (omit / `default_action_omit`): same — hint annotates, does not change.
- **Budget hints cannot make Path A or Path B valid.** A component that fails the Path A gate (e.g., malformed `evidenceRequired`) cannot become eligible for omit because it is expensive.
- **Budget hints cannot turn `include` into `omit`.** A ladder-produced `include` decision (any path) is final from the selector's perspective; the Budgeter may later trim, but not the selector.
- **If `budgetCritical: true`:** selectors emit `budget_pressure_seen` in `budgetWarningCodes` for non-protected components, **except confirmed-unavailable tools / `runtime_unavailable` decisions**. Runtime-unavailable decisions are excluded because they are deferred for runtime correctness, not budget trimming; they must not receive generic budget hints or be counted in budget savings. The `action` and `path` of all other decisions remain unchanged. The Budgeter receives the warnings and uses them to prioritise trimming.
- **Injection gate takes precedence.** If `injectionSuspectAction: fail_open_all` is active, Path A/B omit decisions are already suppressed. Budget hints may still be attached but cannot re-enable omit.

---

### 20.7 Trace Requirements

Every SelectionDecision with a budget hint must include the following in its trace entry:

| Field | Required | Content |
|---|---|---|
| `componentId` | Yes | The registry ID of the component |
| `selectorName` | Yes | The name of the selector that produced the hint |
| `budgetHint` | Yes if hint produced | The enum value |
| `budgetReason` | Yes if hint produced | The coded atom (not free-form text) |
| `tokensApproxObserved` | Yes | The value or null if absent |
| `budgetPriorityObserved` | Yes | The value or null if absent |
| `budgetCriticalObserved` | Yes | The `budgetCritical` flag value at hint time |
| `actionChanged` | Yes | Must always be `false` for budget-only hints |
| `budgetWarningCodes` | Yes if any emitted | Array of coded warning strings |

**Privacy constraints (unconditional):**
- No raw component content in any budget trace field
- No raw user text in any budget trace field
- `budgetReason` must be a coded atom only; no free-form strings

---

### 20.8 Evaluation Requirements

The Evaluation Harness must enforce zero tolerance for the following conditions:

| Condition | Harness check |
|---|---|
| Budget pressure producing omit without Path A or Path B | Any `action: omit` where the only trigger is a budget signal (no valid `safe_to_omit_match` or `default_action_omit`) is a planning error |
| Budget pressure overriding hard protection | Any hard-protected component (safety, `omissionPolicy: never`, `riskLevel: critical`) with `action` changed due to budget is a safety failure |
| Budget pressure overriding `runtime_unavailable` | Any confirmed-unavailable tool changed from `defer / runtime_unavailable` due to budget is a runtime-correctness failure |
| Budget pressure overriding `fail_open_all` | Any omit produced during `fail_open_all` active injection policy due to budget is a critical failure |
| Budget hint changing `action` or `path` | Any SelectionDecision where `action` or `path` differs from the ladder output and the only cause is a budget hint is a planning error |
| Missing trace for budget hint | Any SelectionDecision with a `budgetHint` field but no corresponding trace entry is a traceability failure |
| Raw content in budget trace | Any raw component content or raw user text in `budgetReason` or other budget trace fields is a privacy failure |
| `runtime_unavailable` tool counted as budget savings | Any trace or summary that counts a deferred unavailable tool's tokens as budget savings is a correctness failure |

---

## 21. Pass 3.2.3 Open Questions

1. ~~**Should `budgetPriority` be a numeric rank or a named tier?**~~ **Resolved (Pass 3.2.3.1).** The Component Registry Spec defines `budgetPriority` as a numeric rank 1–10 (lower number = higher priority). Selectors read it as an integer; `budgetPriorityObserved` type is `integer 1–10 or null`. A future named-tier system would be a separate schema change, not MVP.

2. ~~**Should `expensive_optional` have a defined token threshold?**~~ **Resolved (Pass 3.2.4).** See Section 23. MVP threshold is 500 approximate tokens. `charsApprox` fallback: `ceil(charsApprox / 4) >= 500`. Both absent → `unknown_cost`, not `expensive_optional`. No model tokenizer calls, no remaining-budget comparisons, no dynamic thresholds in MVP.

3. ~~**Should `over_budget_protected` trigger a planning halt or a warning only?**~~ **Resolved (Pass 3.2.5).** See Section 25. MVP policy is **warn-only**. Protected components are never trimmed, omitted, deferred, or halted by selectors. The selector emits `budgetHint: over_budget_protected`, adds `over_budget_protected` to `budgetWarningCodes`, and carries a risk flag for the Prompt Plan Generator. Planning halt is explicitly rejected for MVP; it is a future policy option only.

4. ~~**Should the Budgeter receive `budgetHint` values directly from SelectionDecision records, or via a separate hint summary?**~~ **Resolved (Pass 3.2.6).** See Section 27. Canonical source is `resolvedSelectionDecisions` — budget hints must survive Conflict Resolution by being copied/merged into resolved records. An optional derived `budgetHintSummary` may be produced for Budgeter convenience, but it is not a second source of truth.

---

## 22. Pass 3.2.3 Definition of Done

- [x] Section 20: Budget-Aware Selector Hints defined
- [x] Section 20.1: Purpose — budget hints are informational only; enforcement is Budgeter's responsibility
- [x] Section 20.2: Inputs — budgetState fields now match Section 2.7 exactly; no phantom `remainingTokens`, `usedTokens`, `totalTokenBudget`, or `budgetPressureLevel`
- [x] Section 20.3: Core rules — 8 invariants; `remainingTokens` removed from invariant 1 (not an MVP selector input)
- [x] Section 20.4: Hint fields — `budgetPriorityObserved` type corrected to `integer 1–10 or null`; `over_budget_protected` definition restricted to `totalPromptTokenTarget`/per-type max comparisons only (no `remainingTokens`)
- [x] Section 20.5: Per-selector hint behavior — all 8 selector types covered; global rule updated: runtime_unavailable tools excluded from `budget_pressure_seen` and generic budget hints
- [x] Section 20.5 policy row aligned: `over_budget_protected` uses `totalPromptTokenTarget`/per-type max only; no `remainingTokens`
- [x] Section 20.6: `budgetCritical` bullet updated: runtime_unavailable decisions excluded from `budget_pressure_seen`; exclusion rationale stated
- [x] Section 21 Q3 updated: no longer references remaining budget as selector input; uses `totalPromptTokenTarget`/per-type max wording
- [x] No active selector-side remaining-budget comparisons remain; all such wording is either removed or noted as Budgeter-owned
- [x] Section 20.7: Trace requirements — 9 trace fields; 3 privacy constraints
- [x] Section 20.8: Evaluation requirements — 8 zero-tolerance harness checks
- [x] Header aligned with Pass 3.2.3
- [x] budgetState fields match Section 2.7 exactly
- [x] No active `remainingTokens`, `usedTokens`, `totalTokenBudget`, or `budgetPressureLevel` in MVP selector inputs
- [x] `budgetPriorityObserved` type corrected to numeric 1–10 matching registry contract
- [x] Section 21 Q1 resolved: `budgetPriority` is numeric 1–10
- [x] runtime_unavailable tools excluded from generic budget hints and `budget_pressure_seen`
- [x] No budget enforcement written into selectors
- [x] No new omission path introduced
- [x] No model-assisted rules written
- [x] Section 21: Q1, Q2, and Q3 resolved; 1 open question remaining (Q4)
- [x] Section 22: This checklist
- [x] No code implemented
- [x] No JSON Schema files created
- [x] No runtime system touched
- [x] No OpenClaw state modified

**Next pass scope (historical — Pass 3.2.3/3.2.4 state):**
- ~~Resolve Q4 (`budgetHint` survival through Conflict Resolution)~~ — Resolved in Pass 3.2.6 (Section 27).
- Q2 resolved in Pass 3.2.4 (Section 23); Q3 resolved in Pass 3.2.5 (Section 25); Q4 resolved in Pass 3.2.6 (Section 27).
- **Current next pass:** implementation-readiness review, Evaluation Harness spec, or Budgeter spec.

---

*File changed: `docs/06_SELECTOR_ORCHESTRATION_SPEC.md`*
*Pass 3.2.3.1 fixes: (1) header updated to Pass 3.2.3; (2) budgetState fields in Section 20.2 corrected to match Section 2.7 (removed phantom remainingTokens/usedTokens/totalTokenBudget/budgetPressureLevel); (3) Section 20.3 invariant 1 no longer references remainingTokens; (4) over_budget_protected restricted to totalPromptTokenTarget/per-type max comparisons; (5) budgetPriorityObserved type corrected to integer 1–10; (6) Section 21 Q1 resolved; (7) global rule updated to exclude runtime_unavailable tools from budget_pressure_seen.*
*Historical open-question state at this footer (Pass 3.2.3): Q1 resolved, Q2/Q3/Q4 open. Current state after Pass 3.2.6: all Q1/Q2/Q3/Q4 resolved.*
*Current next pass: implementation-readiness review, Evaluation Harness spec, or Budgeter spec.*

---

## 23. Expensive Optional Threshold Policy

### 23.1 Purpose

This section resolves Section 21 Q2 by establishing the MVP threshold policy for assigning `budgetHint: expensive_optional`. The policy is informational only. It governs when a selector may classify an optional component as expensive for the Budgeter's benefit. It does not authorize omission, does not enforce budget, and does not change `action` or `path`.

---

### 23.2 MVP Threshold

The MVP threshold for `expensive_optional` is **500 approximate tokens**.

This value is:
- Static in MVP — not configurable per run, per component type, or per budget target
- Applied consistently across all selector types
- A planning-time classification, not a runtime enforcement boundary
- Informational: the Budgeter uses it to prioritise trimming; it does not produce omit

> **Implementation guide note (F-31 — safe-defer):** When implementing this threshold in MVP code, define a named constant — e.g., `EXPENSIVE_OPTIONAL_THRESHOLD_DEFAULT = 500` — rather than scattering the literal `500` inline across selector checks. The `thresholdUsed: 500` trace field (§23.5) makes the applied threshold value observable to the Evaluation Harness. Future threshold externalization must update both the named constant and the trace emission site. Do not add `defaultExpensiveOptionalThreshold` as a `selectorPolicy` input field or any other runtime-configurable value in MVP — threshold configurability remains deferred.

> **Future note:** Threshold configurability (e.g., per-type thresholds in `selectorPolicy`, or Budgeter-supplied thresholds at planning time) is a valid future enhancement. It is deferred and must not be implemented in MVP.

---

### 23.3 Token Cost Classification Rules

The following rules are applied in order. A component must satisfy both a cost threshold and eligibility criteria before receiving `budgetHint: expensive_optional`.

**Eligibility criteria (must ALL be true):**
- `retainPolicy: optional` (required positive signal for optionality)
- No hard-protection markers present:
  - not `retainPolicy: mandatory`
  - not `retainPolicy: durable`
  - not `retainPolicy: safety_critical`
  - not `omissionPolicy: never`
  - not `riskLevel: critical`
- Not a confirmed-unavailable tool (`runtime_unavailable` decision is excluded)
- Not a `reference_unknown` or `quarantine` decision

> **Note:** `defaultAction: omit` may support optionality but is not sufficient by itself. If a component has `defaultAction: omit` but lacks `retainPolicy: optional` or has contradictory hard-protection markers, the selector must fail safe: assign `budgetHint: protected` if any protection marker is present, or `budgetHint: unknown_cost` if optionality cannot be confirmed. Never assign `expensive_optional` when registry fields are contradictory.

**Rule 1 — `tokensApprox` present:**
- If `tokensApprox >= 500` → assign `budgetHint: expensive_optional`
- If `tokensApprox < 500` → assign `budgetHint: candidate_optional` (eligible but not expensive)
- Trace field: `tokenSource: tokensApprox`, `tokensApproxObserved: <value>`

**Rule 2 — `tokensApprox` absent, `charsApprox` present:**
- Compute `estimatedTokens = ceil(charsApprox / 4)`
- If `estimatedTokens >= 500` → assign `budgetHint: expensive_optional`
- If `estimatedTokens < 500` → assign `budgetHint: candidate_optional`
- Trace field: `tokenSource: charsApprox_estimate`, `tokensApproxObserved: null`, `charsApproxObserved: <value>`, `estimatedTokensFromChars: <estimatedTokens>`
- Add `budgetReason: chars_approx_estimated_tokens` to the decision record

**Rule 3 — Both `tokensApprox` and `charsApprox` absent:**
- Assign `budgetHint: unknown_cost`
- Do NOT assign `expensive_optional`
- Emit `budget_cost_unknown` warning
- Trace field: `tokenSource: absent`, `tokensApproxObserved: null`

---

### 23.4 What Does Not Affect the Threshold

The following must NOT influence the `expensive_optional` threshold in MVP:

- **Remaining budget** — not a selector input; `remainingTokens` is Budgeter-owned
- **Model tokenizer calls** — no live tokenization at planning time; only pre-computed registry metadata is used
- **Dynamic thresholds** — no per-run, per-type, or per-request threshold adjustment in MVP
- **Hard protections** — hard-protected components receive `budgetHint: protected` regardless of cost; they are never `expensive_optional`
- **`runtime_unavailable` decisions** — excluded from all budget hint logic (Section 20.5 global rule)

> **Non-MVP cross-reference note (F-30 — safe-defer):** In MVP, `expensive_optional` does not override the `omissionPolicy: fail_open` not-trimmable rule. A component with `omissionPolicy: fail_open` that receives `budgetHint: expensive_optional` **cannot be trimmed by the MVP Budgeter** — see Architecture §7.5 MVP trim rule. A future policy combining `expensive_optional` with `budgetTrimmable: true` (Registry spec §13 future extension) may allow opt-in trimming of carefully reviewed `fail_open` components, but that combined behavior requires a dedicated future cross-spec design pass and must not be implemented in MVP. Do not treat `expensive_optional` as sufficient grounds to trim a `fail_open` component.

---

### 23.5 Trace Requirements

Every decision annotated with `budgetHint: expensive_optional` must include the following in its trace entry:

| Field | Required | Content |
|---|---|---|
| `budgetHint` | Yes | `expensive_optional` |
| `tokenSource` | Yes | `tokensApprox` or `charsApprox_estimate` |
| `tokensApproxObserved` | Yes | The registry `tokensApprox` value, or null if absent |
| `charsApproxObserved` | If Rule 2 applied | The registry `charsApprox` value |
| `estimatedTokensFromChars` | If Rule 2 applied | `ceil(charsApprox / 4)` |
| `thresholdUsed` | Yes | `500` (the static MVP threshold) |
| `budgetReason` | Yes | Coded atom: `high_token_estimate` (Rule 1) or `chars_approx_estimated_tokens` (Rule 2) |
| `actionChanged` | Yes | Must always be `false`; hint does not change action |

**Privacy constraints (unconditional):**
- No raw component content in any trace field
- `budgetReason` must be a coded atom; no free-form strings

---

### 23.6 Evaluation Requirements

The Evaluation Harness must enforce zero tolerance for the following conditions:

| Condition | Harness check |
|---|---|
| `expensive_optional` assigned to hard-protected component | Any component with `retainPolicy: safety_critical`, `omissionPolicy: never`, or `riskLevel: critical` receiving `budgetHint: expensive_optional` is a safety failure |
| `expensive_optional` assigned to `retainPolicy: mandatory` component | Any component with `retainPolicy: mandatory` receiving `budgetHint: expensive_optional` is a correctness failure |
| `expensive_optional` assigned to `retainPolicy: durable` component | Any component with `retainPolicy: durable` receiving `budgetHint: expensive_optional` is a correctness failure |
| `expensive_optional` assigned when registry optionality is contradictory | Any component with conflicting protection/optionality markers receiving `budgetHint: expensive_optional` instead of `protected` or `unknown_cost` is a classification failure |
| `expensive_optional` assigned to `runtime_unavailable` tool | Any confirmed-unavailable tool receiving `budgetHint: expensive_optional` is a correctness failure |
| `expensive_optional` assigned when no cost data present | Any component with both `tokensApprox` and `charsApprox` absent receiving `budgetHint: expensive_optional` instead of `unknown_cost` is a classification failure |
| `expensive_optional` changing `action` or `path` | Any SelectionDecision where `action` or `path` differs from the ladder output because of `expensive_optional` is a planning error |
| `expensive_optional` creating an omit path | Any component omitted solely because `budgetHint: expensive_optional` was assigned is a planning error |
| Missing threshold in trace | Any trace entry with `budgetHint: expensive_optional` but no `thresholdUsed` field is a traceability failure |
| Live tokenizer call used | Any evidence that a model tokenizer was invoked at planning time to compute `tokensApprox` is an architecture violation |

---

## 24. Pass 3.2.4 Definition of Done

- [x] Section 23: Expensive Optional Threshold Policy defined
- [x] Section 23.1: Purpose — informational only; does not authorize omission or enforce budget
- [x] Section 23.2: MVP threshold set to 500 approximate tokens; static; not configurable in MVP; future configurability noted
- [x] Section 23.3: Three classification rules defined (tokensApprox present; charsApprox fallback; both absent → unknown_cost)
- [x] Section 23.3: charsApprox fallback: `estimatedTokens = ceil(charsApprox / 4)`, threshold 500; trace includes `chars_approx_estimated_tokens` reason
- [x] Section 23.3: Both absent → `unknown_cost`, not `expensive_optional`; `budget_cost_unknown` warning emitted
- [x] Section 23.4: Remaining budget, model tokenizer calls, dynamic thresholds, hard protections, and runtime_unavailable decisions explicitly excluded
- [x] Section 23.5: Trace requirements — 8 fields including `tokenSource`, `thresholdUsed`, `estimatedTokensFromChars`; 2 privacy constraints
- [x] Section 23.6: Evaluation requirements — 10 zero-tolerance harness checks (added: mandatory, durable, contradictory-optionality rows)
- [x] Section 23.3 eligibility tightened: `retainPolicy: optional` required as positive signal; `defaultAction: omit` alone is not sufficient
- [x] Section 23.3: `retainPolicy: mandatory`, `retainPolicy: durable`, `retainPolicy: safety_critical`, `omissionPolicy: never`, `riskLevel: critical` are all excluded from `expensive_optional`
- [x] Section 23.3: `runtime_unavailable`, `reference_unknown`, and `quarantine` are excluded from `expensive_optional`
- [x] Section 23.3: contradictory registry optionality fails safe to `protected` or `unknown_cost`; never `expensive_optional`
- [x] Section 21 Q2 marked resolved
- [x] No budget enforcement written
- [x] No new omission path introduced
- [x] No model-assisted rules written
- [x] No code implemented
- [x] No JSON Schema files created
- [x] No runtime system touched
- [x] No OpenClaw state modified

**Next pass scope (historical — Pass 3.2.4 state):**
- ~~Resolve Section 21 Q4: `budgetHint` survival through Conflict Resolution~~ — Resolved in Pass 3.2.6 (Section 27).
- Q3 resolved in Pass 3.2.5 (Section 25); Q4 resolved in Pass 3.2.6 (Section 27).
- **Current state after Pass 3.2.6:** Q1/Q2/Q3/Q4 are all resolved.
- **Current next pass:** implementation-readiness review, Evaluation Harness spec, Budgeter spec, or cross-spec open-question cleanup.

---

*File changed: `docs/06_SELECTOR_ORCHESTRATION_SPEC.md`*
*Pass 3.2.4 additions: Section 21 Q2 resolved; Section 23 (Expensive Optional Threshold Policy); Section 24 (DoD).*
*Historical open-question state at this footer (Pass 3.2.4): Q1/Q2 resolved; Q3/Q4 open. Current state after Pass 3.2.6: all Q1/Q2/Q3/Q4 resolved.*
*Current next pass: implementation-readiness review, Evaluation Harness spec, Budgeter spec, or cross-spec open-question cleanup.*

---

## 25. over_budget_protected Policy

### 25.1 Purpose

This section resolves Section 21 Q3 by establishing the MVP policy for `budgetHint: over_budget_protected`. The core question was: should a protected component whose cost estimate exceeds the prompt token target trigger a planning halt, or should it emit a warning only?

**MVP decision: warn-only.** Planning halt is explicitly rejected for MVP.

---

### 25.2 Rationale

- **Protected components are intentionally non-trimmable.** Components with hard-protection markers (`retainPolicy: safety_critical/mandatory/durable`, `omissionPolicy: never`, `riskLevel: critical`) must always be included. The selector and Budgeter have no authority to trim them.
- **Budget infeasibility is not selector-actionable.** When a protected component's `tokensApprox` exceeds `totalPromptTokenTarget` or an applicable per-type max, the budget is infeasible. But infeasibility cannot be resolved by the selector — it has no view of the full prompt plan or total budget consumption.
- **Halting in Selector Orchestration mixes concerns.** Selector Orchestration decides what to include, omit, or defer per component. Budget feasibility enforcement belongs to the Budgeter and Prompt Plan Generator. Halting at the selector phase would conflate these responsibilities.
- **Warn-only preserves composability.** The selector emits a risk flag; the Budgeter and Prompt Plan Generator decide whether to surface an error, expand the budget target, or proceed with a known overrun warning.

> **Future note:** A `halt_planning` policy option (e.g., via `selectorPolicy.overBudgetProtectedAction: halt`) is a valid future enhancement for high-security or strict-budget deployments. It must not be implemented in MVP.

---

### 25.3 MVP Behavior

When a protected component's `tokensApprox` exceeds `totalPromptTokenTarget` or the applicable per-type max from `budgetState` (Section 2.7):

- **`action` and `path` are unchanged.** The component remains `include / <existing path>` (e.g., `required_match`, `safety_override`).
- **`budgetHint`** is set to `over_budget_protected`.
- **`budgetWarningCodes`** includes `over_budget_protected`.
- **A planning warning** is emitted at selector phase: `over_budget_protected`.
- **A risk flag** is set for the Prompt Plan Generator: `budget_infeasible_protected_component`. This flag signals that the prompt may exceed the token target and the cause is a protected component that cannot be trimmed.
- **No trim, no omit, no defer, no halt** occurs in the selector phase.
- **The Budgeter must preserve the component.** It cannot trim or omit a component with `budgetHint: protected` or `budgetHint: over_budget_protected`.

**When to assign `over_budget_protected`:**
- Component has at least one hard-protection marker
- `tokensApprox` is present and exceeds `totalPromptTokenTarget` OR exceeds the applicable per-type budget max (`maxScaffoldTokens`, `maxSkillTokens`, `maxToolTokens`, `maxHistoryTokens`)
- If `tokensApprox` is absent: do NOT assign `over_budget_protected`; use `unknown_cost` instead

---

### 25.4 Trace Requirements

Every decision annotated with `budgetHint: over_budget_protected` must include the following in its trace entry:

| Field | Required | Content |
|---|---|---|
| `componentId` | Yes | The registry ID of the component |
| `selectorName` | Yes | The name of the selector that produced the hint |
| `budgetHint` | Yes | `over_budget_protected` |
| `thresholdCrossed` | Yes | The name of the limit exceeded: `totalPromptTokenTarget` or the applicable per-type max key |
| `applicableBudgetLimit` | Yes | The integer value of the limit from `budgetState` |
| `tokensApproxObserved` | Yes | The `tokensApprox` value from registry metadata |
| `actionChanged` | Yes | Must always be `false`; hint does not change action |
| `budgetWarningCodes` | Yes | Array including `over_budget_protected` |
| `riskFlag` | Yes | `budget_infeasible_protected_component` |

**Privacy constraints (unconditional):**
- No raw component content in any trace field
- `thresholdCrossed` must be a field-name atom, not a free-form string

---

### 25.5 Evaluation Requirements

The Evaluation Harness must enforce zero tolerance for the following conditions:

| Condition | Harness check |
|---|---|
| `over_budget_protected` changing `action` or `path` | Any SelectionDecision where `action` or `path` differs from the ladder output because of `over_budget_protected` is a planning error |
| `over_budget_protected` causing omit/defer/halt | Any component with `budgetHint: over_budget_protected` that receives `action: omit`, `action: defer`, or a planning halt signal is a safety failure |
| Budgeter trimming `over_budget_protected` component | Any component with `budgetHint: over_budget_protected` or `protected` that is trimmed or omitted by the Budgeter is a safety failure |
| Missing warning for `over_budget_protected` | Any SelectionDecision with `budgetHint: over_budget_protected` but no `over_budget_protected` entry in `budgetWarningCodes` is a traceability failure |
| Missing risk flag | Any SelectionDecision with `budgetHint: over_budget_protected` but no `budget_infeasible_protected_component` risk flag is a traceability failure |
| Raw component content in trace | Any raw content in `thresholdCrossed` or other trace fields is a privacy failure |
| `over_budget_protected` assigned without `tokensApprox` evidence | Any component with both `tokensApprox` absent receiving `budgetHint: over_budget_protected` instead of `unknown_cost` is a classification failure |

---

## 26. Pass 3.2.5 Definition of Done

- [x] Section 25: over_budget_protected Policy defined
- [x] Section 25.1: Purpose — Q3 resolved as warn-only for MVP
- [x] Section 25.2: Rationale — halt rejected for MVP; future halt option noted; separation of selector/Budgeter concerns stated
- [x] Section 25.3: MVP behavior defined — action/path unchanged; budgetHint and warning emitted; Budgeter must preserve component; risk flag set
- [x] Section 25.3: Assignment conditions defined — requires hard-protection marker AND tokensApprox present AND exceeds limit; absent tokensApprox → unknown_cost
- [x] Section 25.4: Trace requirements — 9 fields including `thresholdCrossed`, `applicableBudgetLimit`, `riskFlag`; 2 privacy constraints
- [x] Section 25.5: Evaluation requirements — 7 zero-tolerance harness checks
- [x] Section 21 Q3 marked resolved
- [x] Planning halt explicitly rejected for MVP
- [x] No budget enforcement written
- [x] No new omission path introduced
- [x] No model-assisted rules written
- [x] No code implemented
- [x] No JSON Schema files created
- [x] No runtime system touched
- [x] No OpenClaw state modified
- [x] Section 21 Q4: resolved in Pass 3.2.6 (Section 27). Historical note: Q4 was open at Pass 3.2.5; current state is fully resolved.

**Next pass scope (historical — Pass 3.2.5 state):**
- ~~Resolve Section 21 Q4: `budgetHint` survival through Conflict Resolution~~ — Resolved in Pass 3.2.6 (Section 27).
- **Current next pass:** implementation-readiness review, Evaluation Harness spec, or Budgeter spec.

---

*File changed: `docs/06_SELECTOR_ORCHESTRATION_SPEC.md`*
*Pass 3.2.5 additions: Section 21 Q3 resolved (warn-only, halt rejected for MVP); Section 25 (over_budget_protected Policy); Section 26 (DoD).*
*Historical open-question state at this footer (Pass 3.2.5): Q1/Q2/Q3 resolved; Q4 open. Current state after Pass 3.2.6: all Q1/Q2/Q3/Q4 resolved.*
*Current next pass: implementation-readiness review, Evaluation Harness spec, or Budgeter spec.*

---

## 27. Budget Hint Survival Through Conflict Resolution

### 27.1 Purpose

This section resolves Section 21 Q4 by establishing how `budgetHint` values and related budget fields survive the Conflict Resolution step and reach the Budgeter. The core question was: should the Budgeter receive budget hints directly from raw per-selector `SelectionDecision` records, or should hints be preserved into resolved records?

**MVP decision:** Budget hints must be merged into `ResolvedSelectionDecision` records. `ResolvedSelectionDecision` records are the canonical source. An optional derived `budgetHintSummary` may be produced for Budgeter convenience but is not a second source of truth.

---

### 27.2 Rationale

- **Budgeter consumes resolved decisions, not raw per-selector decisions.** The Budgeter operates on the resolved plan; it does not have access to the raw fan-out output of individual selectors.
- **Budget hints on any input decision could be lost without explicit merge.** If Conflict Resolution discards non-winning decisions entirely, a `protected` or `over_budget_protected` hint on a losing record would never reach the Budgeter, causing safety failures.
- **The strongest hint wins, not the action/path winner.** The resolved `budgetHint` is selected by the Section 27.5 priority order across all input decisions. The action/path winning decision does not automatically win the budget hint. A losing input decision may carry a higher-priority hint (e.g., `over_budget_protected`) that must be promoted even when the winning decision has a weaker hint (e.g., `expensive_optional`).
- **Supporting fields travel with the hint source.** The budget fields that justify the selected `budgetHint` (e.g., `thresholdCrossed`, `tokensApproxObserved`, `budgetReason`) must come from the same source decision that provided the hint, not necessarily from the action/path winner.
- **A separate summary aids efficiency but is derived only.** An optional `budgetHintSummary` aggregate object helps the Budgeter avoid iterating all resolved records. It must be derived from resolved records and must never be a second source of truth.

---

### 27.3 Budget Fields That Must Survive

The following fields must be present on every `ResolvedSelectionDecision` where they were set on the winning or promoted input decision:

| Field | Source |
|---|---|
| `budgetHint` | Strongest hint by §27.5 priority order across all input decisions. If the winning action/path decision also has the strongest hint, trace `budget_hint_kept_from_winning_decision`. If the strongest hint comes from a losing decision, trace `budget_hint_promoted_from_losing_decision` and record `sourceDecisionId`. |
| `budgetReason` | From the source decision that contributes the `budgetHint` (winning or promoted). |
| `tokensApproxObserved` | From the source decision that contributes the `budgetHint`. |
| `budgetPriorityObserved` | From the winning action/path decision. |
| `budgetCriticalObserved` | From the winning action/path decision. |
| `budgetWarningCodes` | Merged union of all input decision `budgetWarningCodes`. |
| `tokenSource` | From the source decision that contributes the `budgetHint` (Section 23 field). |
| `thresholdUsed` | From the source decision that contributes the `budgetHint` (Section 23 field). |
| `estimatedTokensFromChars` | From the source decision that contributes the `budgetHint` (Section 23 field, if Rule 2 applied). |
| `charsApproxObserved` | From the source decision that contributes the `budgetHint` (Section 23 field, if Rule 2 applied). |
| `thresholdCrossed` | From the source decision that contributes `over_budget_protected` hint (Section 25 field), if applicable. |
| `applicableBudgetLimit` | From the source decision that contributes `over_budget_protected` hint (Section 25 field), if applicable. |
| `riskFlag` | Promoted from any input decision carrying `budget_infeasible_protected_component`, regardless of which decision won the action/path. |

---

### 27.4 Merge Rules

The following rules apply during Conflict Resolution for budget hint fields. The Section 27.5 priority order applies globally — the action/path winning decision does **not** automatically win the budget hint.

**Pre-step — Suppress for `runtime_unavailable`:**
- If the final resolved `action/path` is `defer/runtime_unavailable`, skip all generic budget hint merge steps.
- Do not assign any generic `budgetHint` to this resolved record.
- Preserve `runtime_unavailable_no_budget_savings` only in `budgetWarningCodes` if present in any input decision.
- Do not count the component as budget savings. Trace `mergeRule: runtime_unavailable_skip`.

**Step 1 — Collect all budget hints from input decisions:**
- Gather the `budgetHint` value (if present) from every input decision.
- Merge `budgetWarningCodes` as the union of all input decision warning-code sets.
- If any input decision carries `riskFlag: budget_infeasible_protected_component`, mark it for promotion regardless of which decision wins.

**Step 2 — Select hint by priority order (§27.5):**
- Apply the Section 27.5 priority order to all collected hints.
- Select the highest-priority hint as the resolved `budgetHint`.
- If the winning action/path decision holds the selected hint → trace `mergeRule: budget_hint_kept_from_winning_decision`.
- If a losing decision holds the selected hint → trace `mergeRule: budget_hint_promoted_from_losing_decision` and record `sourceDecisionId`.
- If no input decision has any budget hint → leave `budgetHint` absent and trace `mergeRule: no_hint`. This is not an error.

**Step 3 — Promote supporting fields from hint source:**
- The budget fields that justify the selected `budgetHint` must come from the same source decision that provided the hint (not necessarily the action/path winner).
- For `over_budget_protected`: promote `thresholdCrossed`, `applicableBudgetLimit`, `tokensApproxObserved`, `riskFlag`, `budgetReason`, and associated `budgetWarningCodes` from the source decision.
- For `protected`: promote `budgetReason` and protection-related `budgetWarningCodes` from the source decision.
- For `expensive_optional` or `candidate_optional`: promote `tokenSource`, `thresholdUsed`, `tokensApproxObserved`, and `budgetReason` from the source decision.
- `budgetWarningCodes` on the resolved record is always the union of all input decision sets.

---

### 27.5 Budget Hint Priority Order

When multiple budget hints exist across input decisions and a merge decision must be made, the following priority order determines which hint takes precedence (highest to lowest):

1. `over_budget_protected`
2. `protected`
3. `unknown_cost`
4. `expensive_optional`
5. `candidate_optional`

**Invariant:** `expensive_optional` must never override `protected` or `over_budget_protected`. A downgrade from a safety/protection hint to an optional-cost hint during Conflict Resolution is a harness failure.

---

### 27.6 Optional budgetHintSummary

**Ownership (F-19 resolved, Pass 4.5B / ordering fixed Pass 4.5B.1):** `budgetHintSummary` is computed by the **Prompt Plan Generator** during final prompt-plan output assembly — after the Budgeter has produced its `BudgetReport` and the PPG holds the full resolved decision set. No other module may compute or mutate this object. The Prompt Plan Generator must never invent, override, or change any hint value; it may only count and aggregate what is already present in the resolved decisions.

**The Budgeter does not consume `budgetHintSummary` in MVP.** The Budgeter's canonical input for budget hints is `resolvedSelectionDecisions` only. `budgetHintSummary` is a derived convenience output included in the prompt-plan / trace / summary output for operator and harness readability. It is not a second source of truth, and it is not an input to the Budgeter.

**MVP optional status:** `budgetHintSummary` is optional in MVP. The Prompt Plan Generator may omit it entirely. If omitted, nothing special happens — the Budgeter has already operated directly on `resolvedSelectionDecisions`.

**Why Prompt Plan Generator and not other modules:**
- The Conflict Resolver's responsibility ends at producing `ResolvedSelectionDecision` records and the conflict trace. Deriving a summary is a final-assembly concern, not a conflict-resolution concern.
- The Budgeter must not be the source of a summary that appears in its own outputs — that would create a circular dependency and risk hiding divergence.
- The Prompt Plan Generator receives all resolved decisions and `BudgetReport` as inputs and assembles the final plan, trace, and summary outputs. Deriving `budgetHintSummary` during this final assembly step is consistent with its role and does not introduce any ordering contradiction.

**Divergence behavior:** If `budgetHintSummary` is present in the prompt-plan output, any count, ID, or value in it that does not exactly match the state derivable from `resolvedSelectionDecisions` is an **Evaluation Harness failure** (data integrity failure). This includes count mismatches, missing component IDs, and any hint value that is not derivable from the resolved records. The canonical data is always `resolvedSelectionDecisions`. If divergence is detected at harness time, the harness must fail the run and report which field diverged. There is no runtime recovery path for divergence — the PPG must re-derive the summary from scratch if any resolved decision changes.

**Structure (conceptual):**
```
{
  totalComponents: integer
  countByHint: {
    protected: integer
    over_budget_protected: integer
    expensive_optional: integer
    candidate_optional: integer
    unknown_cost: integer
    no_hint: integer
  }
  protectedComponentIds: string[]
  overBudgetProtectedComponentIds: string[]
  unknownCostComponentIds: string[]
  expensiveOptionalComponentIds: string[]
  totalApproxTokensKnown: integer     // sum of tokensApproxObserved where present
  approximateCoverageRatio: float     // fraction of components with cost data
  warningCount: integer
  riskFlags: string[]                 // e.g., budget_infeasible_protected_component
}
```

**Rules:**
- `resolvedSelectionDecisions` are canonical; `budgetHintSummary` is derived only and must not be a second source of truth.
- `budgetHintSummary` is not a Budgeter input. The Budgeter consumes `resolvedSelectionDecisions` directly. `budgetHintSummary` appears only in the final prompt-plan / trace / summary outputs.
- Any mismatch between the summary and the resolved decisions is an Evaluation Harness failure.
- `budgetHintSummary` must not be produced before the PPG holds the full resolved decision set and the `BudgetReport` from the Budgeter.
- If `budgetHintSummary` is omitted from the prompt-plan output, nothing special happens; the Budgeter has already completed its work on `resolvedSelectionDecisions`.

---

### 27.7 Trace Requirements

Every budget-hint merge or promotion during Conflict Resolution must include the following in its trace entry:

| Field | Required | Content |
|---|---|---|
| `componentId` | Yes | The registry ID of the component |
| `inputDecisionIds` | Yes | IDs of all input SelectionDecision records considered |
| `winningDecisionId` | Yes | ID of the decision whose `action/path` was selected |
| `promotedBudgetHint` | If Rule 2 applied | The hint promoted from a losing decision |
| `sourceDecisionId` | If promotion | ID of the losing decision the hint was promoted from |
| `mergeRule` | Yes | Which rule was applied. Must be exactly one of: `budget_hint_kept_from_winning_decision`, `budget_hint_promoted_from_losing_decision`, `no_hint`, `runtime_unavailable_skip` |
| `budgetWarningCodesMerged` | Yes | The union set of all warning codes from input decisions |
| `actionChanged` | Yes | Must always be `false`; budget hint merge does not change action |
| `pathChanged` | Yes | Must always be `false`; budget hint merge does not change path |

**Privacy constraints (unconditional):**
- No raw component content in any merge trace field
- `mergeRule` must be one of the defined coded values above

---

### 27.8 Evaluation Requirements

The Evaluation Harness must enforce zero tolerance for the following conditions:

| Condition | Harness check |
|---|---|
| Budget hint lost during Conflict Resolution | Any `ResolvedSelectionDecision` missing a `budgetHint` that was present on any input decision (where the hint is not suppressed by `runtime_unavailable`) is a traceability failure |
| `protected`/`over_budget_protected` lost to `expensive_optional` | Any resolved decision where a safety hint was downgraded to a cost-only hint is a safety failure |
| `runtime_unavailable` receiving generic budget hints | Any resolved `defer/runtime_unavailable` decision carrying any generic `budgetHint` field is a correctness failure. Only `runtime_unavailable_no_budget_savings` may appear in `budgetWarningCodes` for such records; it is not a `budgetHint` value. |
| `budgetHintSummary` disagreeing with resolved decisions | Any mismatch between summary counts/IDs and resolved records is a data integrity failure (§27.6). Harness must report which field diverged. |
| `budgetHintSummary` produced by a module other than the Prompt Plan Generator | Any evidence that `budgetHintSummary` was computed by the Conflict Resolver, Budgeter, or any other module is an ownership violation (§27.6). |
| `budgetHintSummary` produced before Conflict Resolution is complete | Any `budgetHintSummary` derived from an incomplete resolved-decision set is a correctness failure (§27.6). |
| Budget hint merge changing `action` or `path` | Any change to `action` or `path` attributable to a budget hint merge is a planning error |
| Raw content in merge trace | Any raw component content in budget hint merge trace fields is a privacy failure |
| Budgeter receiving raw input decisions instead of resolved decisions | Any evidence that the Budgeter consumed non-resolved per-selector decisions rather than resolved decisions is an architecture violation |

---

## 28. Pass 3.2.6 Definition of Done

- [x] Section 27: Budget Hint Survival Through Conflict Resolution defined
- [x] Section 27.1: Purpose — Q4 resolved; canonical source is `resolvedSelectionDecisions`
- [x] Section 27.2: Rationale — aligned with global priority-order hint selection; winning-first wording removed; supporting-fields-travel-with-hint rationale added
- [x] Section 27.3: 13 budget fields listed; source column reflects priority-order-based hint selection
- [x] Section 27.4: Merge rules rewritten — priority order (§27.5) applies globally; action/path winner does not automatically win budget hint; supporting fields promoted with hint
- [x] Section 27.4: Pre-step — `runtime_unavailable` suppresses generic budget hints entirely; only `runtime_unavailable_no_budget_savings` in `budgetWarningCodes` preserved
- [x] Section 27.5: Priority order defined; expensive_optional cannot override protection hints
- [x] Section 27.6: Optional `budgetHintSummary` defined as derived-only
- [x] Section 27.7: `mergeRule` enum corrected to exactly match Section 27.4 coded values: `budget_hint_kept_from_winning_decision`, `budget_hint_promoted_from_losing_decision`, `no_hint`, `runtime_unavailable_skip`
- [x] Section 27.8: Evaluation requirements — 7 zero-tolerance harness checks
- [x] Header aligned with Pass 3.2.6
- [x] Section 27.2 rationale aligned with global priority-order hint selection (pass 3.2.6.2)
- [x] Section 27.7 mergeRule enum exactly matches Section 27.4 (pass 3.2.6.2)
- [x] Stale Q4-open / next-pass-Q4 metadata marked historical with current-state note in Sections 22, 26 footers and next-pass-scope blocks (pass 3.2.6.2)
- [x] Merge rules apply Section 27.5 priority order globally
- [x] Budget hint can be promoted from losing decision even when winning decision has weaker hint
- [x] Supporting fields are promoted with promoted hints
- [x] runtime_unavailable preserves warning metadata only; no generic `budgetHint` assigned
- [x] Section 26 stale Q4-open bullet updated to resolved historical note
- [x] Section 21 Q4 marked resolved
- [x] No budget enforcement written
- [x] No new omission path introduced
- [x] No model-assisted rules written
- [x] No code implemented
- [x] No JSON Schema files created
- [x] No runtime system touched
- [x] No OpenClaw state modified
- [x] All Section 21 open questions resolved (Q1/Q2/Q3/Q4)

**Next pass scope:**
- All Section 21 questions are now resolved.
- Remaining work: resolve cross-spec open questions from Sections 5, 9, 12, 15, 18 before implementation.
- Candidate next topics: Evaluation Harness spec, Budgeter spec, or implementation readiness review.

---

*File changed: `docs/06_SELECTOR_ORCHESTRATION_SPEC.md`*
*Pass 3.2.6.2 fixes: (1) Section 27.2 rationale rewritten to match global priority-order merge logic; (2) Section 27.7 mergeRule enum corrected to match Section 27.4 coded values; (3) stale “resolve Q4” wording in Section 22 next-pass scope and footer, Section 26 next-pass scope and footer marked as historical with current-state notes.*
*Open questions (Section 21): All resolved. Q1/Q2/Q3/Q4 resolved.*
*Remaining open questions: from Sections 5, 9, 12, 15, 18 (cross-spec, pre-dating budget-hint work).*
*Next pass: implementation readiness review or Evaluation Harness / Budgeter spec.*
