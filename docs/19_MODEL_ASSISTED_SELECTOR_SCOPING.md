# 19 Model-Assisted Selector Scoping

> **Document type:** Architecture Scoping Note — Phase 6 of the Phased Adoption Plan
> **Status:** Scoping Pass — No code, no runtime, no provider calls. Docs-only.
> **MVP authority:** None — does not change current MVP schemas, fixtures, or implementation.
> **Implementation status:** Not implemented. This is a design-only scoping pass.
> **Canonical sources:** `docs/13_MODEL_ASSISTED_CONTEXT_PLANNING.md` §7, §12, §16, §22; `docs/06_SELECTOR_ORCHESTRATION_SPEC.md` §11.4; `docs/04_PORTABLE_CORE_ARCHITECTURE.md` §7.3, §7.4.

---

## 1. Purpose and Scope

This document defines:

1. How **Model-Assisted Selectors** integrate into the existing Portable Core Pipeline.
2. The **safety boundaries** that prevent model proposals from overriding deterministic guardrails.
3. How model proposals slot into the existing **Conflict Priority Order** (`docs/06` §11.4).
4. The **activation switch** (`deterministicOnly`) that separates MVP operation from future model-assisted operation.

**What this document does not do:**
- It does not authorize implementation of any model-assisted selector code.
- It does not introduce any new schemas or change existing MVP schemas.
- It does not alter harness fixtures or test counts.
- It does not introduce provider-specific fields into the core.
- It does not define the `ProposalDecision` or `AnalyzerOutput` schema — those require separate explicit schema decision passes (`docs/13` §24 OQ-1, OQ-2).

---

## 2. The Governing Principle

> **"Lightweight model proposes. Deterministic guardrails enforce."**
>
> — `docs/13` §7 (Core Principle)

This is the single most important rule for all model-assisted selector work. It is non-negotiable and applies unconditionally.

**Unpacked:**

| Role | Party | Authority |
|---|---|---|
| **Proposer** | Lightweight model (LLM) | Proposes `SelectionDecision` records for components. No authority to finalize decisions. |
| **Enforcer** | Deterministic pipeline (Conflict Resolver, Priority Table) | Has final authority. Overrides or rejects model proposals that violate priorities 0–4. |
| **Validator** | Schema layer (Draft 2020-12) | Rejects any model output that is not a valid `SelectionDecision` JSON object. |
| **Auditor** | Trace layer (`trace.json`) | Records every proposal, every override, every guard that fired. No silent decisions. |
| **Safety net** | Fail-open behavior | Low-confidence or uncertain proposals expand context, never reduce it. |

---

## 3. Current MVP Baseline (Do Not Disturb)

The following MVP mechanisms are **unchanged** by this document and must remain unchanged through any future model-assisted selector implementation:

| Mechanism | Owner | Status |
|---|---|---|
| Deterministic selector ladder (Steps 1–8) | `docs/04` §7.3; `docs/06` §8 | **Active — do not modify** |
| `deterministicOnly=true` setting | `docs/06` §2.9 | **Active in MVP — future Phase 6 sets this to `false`** |
| Conflict Priority Order (Priorities 0–7) | `docs/06` §11.4 | **Active — model proposals enter as inputs only** |
| Safety hard-protection (Priority 1) | `docs/06` §8 Step 3; §11.4 | **Active — cannot be overridden by any model proposal** |
| Injection gate | `docs/06` §17 | **Active — applies to model proposals exactly as to deterministic decisions** |
| Orchestrator Gap-Check | `docs/06` §3.1 | **Active — unchanged** |
| Schema validation of all selector inputs | `docs/04` §7.1 | **Active — model output must also pass validation** |
| Fail-open on uncertainty | `docs/04` §2; `docs/06` §1 | **Active — low model confidence triggers fail-open** |

---

## 4. How Model Proposals Enter the Pipeline

Model-assisted selectors are **proposal sources** — they run alongside deterministic selectors during the fan-out phase and produce standard `SelectionDecision` records. They do not replace the pipeline.

```
 User Request
      │
      ▼
 Request Router (deterministic)
 → requestSignals (promptFamily, familyConfidence, injectionSuspect, ...)
      │
      ▼
 ┌───────────────────────────────────────────────────────────────┐
 │               Section Selector Fan-out                        │
 │                                                               │
 │  ┌──────────────────────┐   ┌──────────────────────────────┐  │
 │  │ Deterministic        │   │ Model-Assisted Selector      │  │
 │  │ Selector             │   │ (Phase 6 / future only)      │  │
 │  │                      │   │                              │  │
 │  │ Applies ladder       │   │ Sends structured prompt to   │  │
 │  │ steps 1–7 per        │   │ lightweight LLM.             │  │
 │  │ component.           │   │ Receives schema-validated    │  │
 │  │ Step 8 → include     │   │ JSON SelectionDecision back. │  │
 │  │ (fail-open).         │   │ selectorName: "model_assisted│  │
 │  │                      │   │ _<scope>" in trace.          │  │
 │  └──────────┬───────────┘   └───────────────┬──────────────┘  │
 │             │                               │                  │
 │             └──────────────┬────────────────┘                  │
 │                            │                                   │
 │             Multiple SelectionDecision records per component   │
 └────────────────────────────┼───────────────────────────────────┘
                              │
                              ▼
                Orchestrator Gap-Check (unchanged)
                              │
                              ▼
               Conflict Resolver (§11.4 — deterministic)
               Priorities 0–7 resolve all conflicts
               Model proposals are inputs — not final authority
                              │
                              ▼
                  Budgeter → PPG → Trace Layer
                  (all unchanged)
```

---

## 5. The Conflict Priority Boundary

This is the most critical safety constraint for model-assisted selectors.

The Conflict Priority Order (`docs/06` §11.4) defines **7 priorities** (plus Priority 0). Model proposals slot in **only at Priority 5 — and only for components that reached no higher-priority decision**.

| Priority | Rule | Can a model proposal win here? |
|---|---|---|
| **0** | Runtime correctness (tool unavailable) | **No.** Priority 0 runs before all other rules. |
| **1** | Safety / privacy hard protection | **No.** A model `omit` proposal for a `retainPolicy: safety_critical` or `omissionPolicy: never` component is **unconditionally defeated** by Priority 1. |
| **2** | User / operator `alwaysInclude` constraint | **No.** A model `omit` proposal for an `alwaysInclude` component is defeated by Priority 2. |
| **3** | Registry `mandatory` or `requiredWhen` match | **No.** Defeated by registry hard requirement. |
| **4** | History durability / open commitments | **No.** Defeated by history protection. |
| **5** | Deterministic selector evidence (Path A / Path B) | **Yes, for components where deterministic evidence is absent (step 8 / insufficient evidence).** Model proposals resolve ambiguity here only. |
| **6** | Budget / cost preference | **Future only.** Not MVP. |
| **7** | Style / format preference | **Lowest priority.** Model proposals cannot use this to override higher priorities. |

**The key insight:** A model-assisted selector's `SelectionDecision` record is structurally identical to a deterministic one — the Conflict Resolver does not treat them differently by type. What matters is the **priority of the conflict rule** that governs the component. If any Priority 0–4 rule applies, the model's proposal is defeated before it can influence the outcome.

---

## 6. Explicit Safety Prohibitions

These are hard invariants. They cannot be relaxed by any implementation pass without an explicit architectural decision from Sam and a full coupled update of `docs/06`, schemas, and fixtures.

1. **A model-assisted selector must never produce a winning `omit` decision for a component with `retainPolicy: safety_critical`, `omissionPolicy: never`, or `riskLevel: critical`.** Priority 1 unconditionally defeats such a proposal. If this occurs in a running system, it is a Conflict Resolver defect — emit `safety_override_omit_decision` warning and flag in `riskFlags`.

2. **A model-assisted selector must never produce a winning `omit` decision for a component in `userConstraints.alwaysInclude`.** Priority 2 defeats this unconditionally.

3. **A model-assisted selector must never receive raw user text.** It receives only the validated `requestSignals` struct (same as deterministic selectors). The injection gate (`docs/06` §17) applies to model proposals exactly as it does to deterministic decisions.

4. **Low model confidence must trigger fail-open, not reduced context.** If the model returns low confidence on a proposal, the orchestrator must treat that proposal as insufficient evidence (ladder step 8) and default to `include`.

5. **A model-assisted selector output that fails schema validation must be discarded entirely.** The orchestrator falls back to deterministic behavior (fail-open include) for all components that the invalid output was intended to evaluate. Log the failure.

6. **A model-assisted selector must never return a proposal for a quarantined component.** Quarantine is a registry-phase decision that runs before selector fan-out (`docs/04` §7.1). A quarantined component never reaches any selector, deterministic or model-assisted.

7. **`deterministicOnly` must remain `true` in MVP.** Model-assisted selector paths are only activated when this flag is set to `false` through an explicit Phase 6 implementation pass. No MVP behavior changes.

---

## 7. The Activation Switch: `deterministicOnly`

The `selectorPolicy.deterministicOnly` field (`docs/06` §2.9) is the flag that separates MVP behavior from the Phase 6 model-assisted architecture:

| `deterministicOnly` value | Behavior |
|---|---|
| `true` (MVP default) | Only deterministic selectors run. Step 8 of the ladder always defaults to `include / fail_open`. No model calls are made. |
| `false` (Phase 6, future) | Deterministic selectors run first. For components that reach step 8 (insufficient evidence), model-assisted selectors may be consulted. Deterministic guardrails still enforce Priorities 0–4. |

**The transition to `deterministicOnly=false` requires:**
- A Phase 6 implementation pass (separate from this scoping pass).
- Fixture additions to cover model-assisted decision paths.
- A schema decision on whether model proposals use the canonical `SelectionDecision` shape or a separate `ProposalDecision` shape (`docs/13` §24 OQ-2).

---

## 8. What a Model-Assisted Selector Produces

Whether a model proposal reuses the canonical `SelectionDecision` shape (`docs/06` §4) or a separate future proposal schema (`docs/13` §24 OQ-2) is an open question for a future schema decision pass. However, regardless of the exact schema, the output must satisfy:

| Requirement | Source |
|---|---|
| Structured JSON (not free text) | `docs/13` §12; `docs/04` §7.3 |
| Schema-validated (against accepted schema) | `docs/13` §12 |
| Contains `selectorName` identifying model origin | `docs/13` §16 — `selectorName: "model_assisted_<scope>"` |
| Contains `action` from accepted enum (`include`, `omit`, `defer`, `reference_unknown`) | `docs/06` §4; `docs/04` §7.3 |
| Contains `confidence` (`high`, `medium`, `low`) | `docs/06` §4 |
| Contains `evidence[]` and `reason` for every decision | `docs/13` §12 |
| Contains `path` from accepted `SelectionPath` enum | `docs/06` §4 |
| Does NOT contain provider-specific fields (`modelPrompt`, `rawAnalyzerOutput`, `providerCost`, etc.) | `docs/13` §12 |
| Appears in `selectorTrace` in `trace.json` | `docs/13` §12 |

---

## 9. Trace Requirements

Every model-assisted selector decision must appear in `trace.json`. Without this, the audit guarantee is broken.

**Required trace entries for each model-assisted decision:**
- `selectorName`: identifies the model-assisted selector (e.g., `"model_assisted_skill"`, `"model_assisted_tool"`).
- `action`, `path`, `confidence`: the proposal values.
- `evidence[]`: structured evidence atoms supporting the proposal.
- `reason`: human-readable rationale.
- When overridden by the Conflict Resolver (e.g., Priority 1 safety): the override appears in `conflictResolutionTrace` with the appropriate `resolutionRule` (e.g., `safety_hard_protection`).

**Trace entries for rejected / invalid model output:**
- When model output fails schema validation: emit `model_selector_output_invalid` warning.
- When model output is discarded: record `model_selector_fallback_to_include` for each affected component.

---

## 10. Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| **Model omits a safety-critical component** | Safety rule violated; policy context lost | Priority 1 unconditionally defeats omit proposals for protected components; `safety_override_omit_decision` warning emitted; flagged in `riskFlags` |
| **Model output fails schema validation** | No selection decisions produced | Discard entire model output; fall back to deterministic (fail-open include) for all affected components; log failure |
| **Low model confidence triggers false reductions** | Context reduced when it should expand | Low confidence → fail-open include (not omit); confidence threshold is configurable in `selectorPolicy` |
| **Model receives injection-suspect input** | Adversarial request manipulates model proposals | Raw user text never reaches model selector; only `requestSignals` struct; injection gate applies to model proposals |
| **Model proposal bypasses Conflict Resolver** | Proposals treated as final without deterministic check | Architecture forbids this; model proposals are inputs to Conflict Resolver, never final decisions |
| **Provider-specific model output leaks into core schema** | Portability guarantee broken | Exclusion list (`docs/13` §12): `modelPrompt`, `rawAnalyzerOutput`, `providerCost`, `providerCacheKey` forbidden from core schema |

---

## 11. Open Questions for Phase 6 Implementation Pass

| # | Question | Impact |
|---|---|---|
| OQ-2 (from `docs/13` §24) | Should model proposals reuse canonical `SelectionDecision` shape (`docs/06` §4) or use a separate `ProposalDecision` object? | Determines whether existing schemas need extension or a new schema is required |
| OQ-7 (from `docs/13` §24) | What confidence thresholds should trigger expanded context (fail-open)? | Determines the boundary between normal and fail-open model-assisted behavior |
| IQ-M1 | Which specific selectors get model-assisted fallback first? (Skill? Tool? Scaffold? History?) | Determines the initial scope of the Phase 6 implementation pass |
| IQ-M2 | What lightweight model / API should be used for the initial implementation? | Determines the adapter implementation approach (see `docs/18` §4 for HTTP API contract) |
| IQ-M3 | How should the structured prompt sent to the model be formed and validated? | Determines the model-assisted selector prompt contract |
| IQ-M4 | What harness fixture groups are needed to validate model-assisted paths? | See `docs/13` §20 fixture group: "Analyzer quality", "Lane selection quality", "Fail-open expansion" |

These questions are explicitly not answered by this document. They require a dedicated implementation scoping pass with Sam's approval.

---

## 12. Relationship to Other Scoping Documents

| Document | Relationship |
|---|---|
| `docs/13_MODEL_ASSISTED_CONTEXT_PLANNING.md` | Parent architecture note. §7 defines the core principle. §12 defines structured decision requirements. §16 maps model proposals to the Conflict Resolver. §22 defines Phase 6 as the target phase for this scoping. |
| `docs/06_SELECTOR_ORCHESTRATION_SPEC.md` §11.4 | Canonical owner of the Conflict Priority Order. Model proposals slot in at Priority 5 only for components without higher-priority coverage. |
| `docs/04_PORTABLE_CORE_ARCHITECTURE.md` §7.3 | Defines the deterministic selector ladder (Steps 1–8). Step 8 is where model-assisted selectors are consulted (future only). |
| `docs/18_HTTP_API_AND_ADAPTER_SPEC.md` | Defines the HTTP API contract that external clients (including model-assisted selector integrations) use to call the core. |
| `docs/14_SUMMARY_QUALITY_HARNESS_SCOPING.md` | Sibling scoping document for History Compressor (Phase 2). Shares the same safety principles. |

---

## 13. MVP Non-Interference Statement

This document does not:

- Change any existing MVP schema (`schemas/inputs/`, `schemas/outputs/`).
- Change any existing harness fixture.
- Change test counts (651 suite, 27 evaluate passed, 1 approved-skipped).
- Alter any existing selector ladder behavior (`docs/06` §8).
- Alter the Conflict Priority Order (`docs/06` §11.4).
- Alter the Conflict Resolver behavior.
- Alter the injection gate behavior (`docs/06` §17).
- Set `deterministicOnly` to `false` — that requires a Phase 6 implementation pass.
- Add provider/model calls to any existing module.
- Change `docs/04`, `docs/05`, `docs/06`, `docs/11`, `docs/12`, or `docs/13`.

The Phased Adoption Plan in `docs/13` §22 lists Phase 6 as "Not started — requires explicit design pass; post-MVP." This document is the architectural scoping note that precedes that design pass — it is not that pass.

---

## 14. Summary

| Area | Decision |
|---|---|
| Core principle | "Model proposes, deterministic guardrails enforce." Non-negotiable. |
| Model proposal authority | Priority 5 only; cannot beat Priorities 0–4 |
| Safety hard-protection (Priority 1) | Unconditionally defeats all model `omit` proposals for protected components |
| User constraints (Priority 2) | Defeats model `omit` proposals for `alwaysInclude` components |
| Activation switch | `selectorPolicy.deterministicOnly` — must remain `true` in MVP |
| Model proposal format | Structured JSON, schema-validated, traceable — not free text |
| Provider-specific fields | Forbidden from core schema |
| Injection gate | Applies to model proposals exactly as to deterministic decisions |
| Low confidence | Triggers fail-open (include), never context reduction |
| Invalid model output | Discard; fall back to fail-open include; log failure |
| Implementation authorization | Not authorized by this document; requires Phase 6 implementation pass |
| MVP interference | None |
