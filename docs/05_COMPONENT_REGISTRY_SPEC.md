# 05 Component Registry Specification

> **Version:** Pass 11 + 4.8E-2B F-30 cross-reference — 2026-05-15 (4.8E-2B: §13 budgetTrimmable row — non-MVP cross-reference note for F-30 / expensive_optional + budgetTrimmable future interaction)
> **Status:** Spec-only. No code. No schema files. No JSON Schema created.

---

## 1. Purpose

The Component Registry is the canonical inventory of all context components available to the planner. It answers the question: *what exists, what is it, and what are the rules governing its inclusion or omission?*

Every component that may appear in a prompt plan must be registered. If a component is not in the registry, no module may include or omit it — it is invisible to the planner.

The registry is **read-only during a planning run**. It is the source of truth for metadata and selection constraints. It does not decide which components are selected; that is the responsibility of the Section Selectors.

---

## 2. Registry Boundary

**The registry owns:**
- Component identity (`id`, `type`, `title`, `hash`)
- Token and character size estimates
- Safety and retention semantics (`riskLevel`, `retainPolicy`, `omissionPolicy`)
- Selection constraint rules (`requiredWhen`, `safeToOmitWhen`, `defaultAction`, `evidenceRequired`)
- Budget ordering (`budgetPriority`)
- Provenance and versioning (`source`, `version`, `hash`)
- Classification tags

**The registry does not own:**
- Runtime prompt assembly or text concatenation
- Provider or model calls
- Tool execution or live shell access
- History state (history turns have their own `historyState` input)
- Selector decisions (those are made by Section Selectors using registry metadata)
- Budget enforcement (that is the Budgeter's job)
- Live OpenClaw state or `~/.openclaw`

---

## 3. Component Definition

### Minimum Required Fields

| Field | Type | Req? | Allowed Values | Meaning | Validation Rule | Example |
|---|---|:---:|---|---|---|---|
| `id` | string | ✅ | Dot-namespaced string, unique per registry | Stable identifier for this component | Must be unique; no whitespace; pattern: `[a-z][a-z0-9._-]*` | `scaffold.coding_standards` |
| `type` | string | ✅ | See Section 4 | Component category | Must be a known type enum value | `scaffold` |
| `title` | string | ✅ | Non-empty string | Human-readable name | Non-empty, max 120 chars | `Coding Standards Scaffold` |
| `summary` | string | ✅ | Non-empty string | One-sentence description of what this component provides | Non-empty, max 300 chars | `Provides coding style and review guidelines for code tasks.` |
| `source` | string | ✅ | File path, logical ID, or URI | Where the component content comes from | Non-empty; must be a string; format is runtime-specific | `skills/coding_standards.md` |
| `tokensApprox` | integer | ✅ | ≥ 1 (or 0 if `metadataOnly: true`) | Estimated token count of this component's content | Must be ≥ 1 unless `metadataOnly: true`; if `metadataOnly` is false or absent, value must be ≥ 1 | `420` |
| `charsApprox` | integer | ✅ | ≥ 1 (or 0 if `metadataOnly: true`) | Estimated character count | Must be ≥ 1 unless `metadataOnly: true` | `1680` |
| `riskLevel` | string | ✅ | `low`, `medium`, `high`, `critical` | How dangerous omission is | Must be a known enum value | `low` |
| `requiredWhen` | array of string | ✅ | Array of prompt family tag strings (may be empty `[]`) | Families where this component must be included | Must be an array; each element must be a non-empty string | `["coding_build_debug"]` |
| `safeToOmitWhen` | array of string | ✅ | Array of prompt family tag strings (may be empty `[]`) | Families where it is safe to omit | Must be an array; each element must be a non-empty string | `["simple_greeting"]` |
| `defaultAction` | string | ✅ | `include`, `omit`, `defer` | What to do when no other rule matches | Must be a known enum value | `include` |
| `omissionPolicy` | string | ✅ | `allow`, `fail_open`, `never` | How to behave when selector evidence is insufficient | Must be a known enum value | `allow` |
| `retainPolicy` | string | ✅ | `optional`, `durable`, `mandatory`, `safety_critical` | How the Budgeter and selectors must treat this component | Must be a known enum value | `optional` |
| `budgetPriority` | integer | ✅ | 1–10 | Budgeter trim order (lower = trimmed first) | Must be integer in [1, 10] | `5` |
| `evidenceRequired` | string or null | ✅ | Constrained string (see Section 7) or `null` | Additional signal conditions for Path A omission. `null` = no expression required; `safeToOmitWhen` match alone is sufficient for Path A. | If non-null, must follow MVP grammar (see Section 7); invalid grammar disables Path A and is not normalized to `null` | `"promptFamily=simple_greeting AND riskLevel=low"` |
| `tags` | array of string | ✅ | Non-empty strings | Classification labels for filtering | Must be an array; may be empty `[]`; each element non-empty | `["coding", "style"]` |
| `version` | string | ✅ | Semver or opaque version string | Version of this component definition | Non-empty string | `"1.0.0"` |
| `hash` | string or null | ✅ | 64-char SHA-256 hex string, or `null` | Content hash for drift detection. Key must always be present; value is `null` when hash not yet computed. | Key must be present; if non-null, must be exactly 64-char lowercase hex string | `null` |

### Optional MVP Fields

These fields are recognized and used by the MVP registry loader.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `metadataOnly` | boolean | `false` | If `true`, this component is a metadata descriptor with no inline content. `tokensApprox` and `charsApprox` may be 0. Use for history lane descriptors and similar structural entries. |
| `formatTag` | string \| null | `null` | Output-format tag matched by the output_format selector. Meaningful only for `type: output_format` components; other types should omit this field or set it to `null`. If absent or `null` on an `output_format` component, the selector cannot authorize omission via `outputFormatHint` matching and must fail open rather than omit based on this field. |

> **Note (F-05 resolved, Pass 4.3A):** `formatTag` is only meaningful for `type: output_format` components. Other component types may omit it or set it to `null`. Its value is matched by the output_format selector (see `docs/06_SELECTOR_ORCHESTRATION_SPEC.md` §14.7).

### Future Optional Fields (not in MVP)

These fields are reserved for future versions. The MVP registry loader should emit a warning if it encounters them but must not halt.

| Field | Type | Default | Meaning | Deferral reason |
|---|---|---|---|---|
| `contentInline` | string | — | Inline content string | Raises security/privacy concerns; prefer `source` reference in MVP |
| `dependencies` | array of id | `[]` | Other component IDs this depends on | Dependency graph not implemented in MVP |
| `budgetTrimmable` | boolean | — | Override to allow trimming of `fail_open` components | Future policy gate; not in MVP |
| `privacyLevel` | string | — | e.g., `public`, `internal`, `confidential` | Privacy scan model TBD |

---

## 4. Component Types

| Type | Represents | Examples | Risks | Selector Implications |
|---|---|---|---|---|
| `scaffold` | Static structural context injected at the start of a prompt | `AGENTS.md` content, persona block, general instructions | Omitting required scaffold → wrong agent behavior | `requiredWhen` drives most inclusion; `safeToOmitWhen` only for truly minimal families |
| `skill` | A callable behavior block or procedural instruction set | `web_search_skill.md`, `code_review_skill.md` | Skills not present when needed → task failure | Should be included only for prompt families where skill is relevant |
| `tool` | A tool schema definition (signature, description, parameters) | `read_file`, `run_shell`, `web_search` | Tool present in prompt but not available at runtime → model attempts undefined tool | Tool selector must check `runtimeCapabilities` |
| `history` | A history lane or segment (metadata descriptor, not raw content) | Lane metadata entry for `durable_constraints` lane | Dropping durable history → constraint forgotten | History Lane Manager governs; registry holds metadata only |
| `memory` | Distilled or persistent memory entries | KI-style distilled summaries, project facts | Stale memory → wrong assumptions | Should carry explicit version or content hash |
| `policy` | Safety, privacy, or behavior constraints | Privacy policy block, tool restriction policy | Omitting policy → unsafe agent behavior | Should be `retainPolicy: mandatory` or `safety_critical` |
| `output_format` | Instructions governing output formatting | JSON schema for response, markdown rules | Omitting → malformed output | Include for tasks with structured output requirements |
| `runtime_capability` | Declaration of what the runtime can and cannot do | Supported tools list, max file size | Misleading capability info → model plans for unavailable tools | Should be validated against runtime state before planning |

---

## 5. Safety and Retention Semantics

### riskLevel

| Value | Meaning | Budgeter behavior | MVP trimming |
|---|---|---|---|
| `low` | Omission unlikely to cause incorrect behavior | May trim if `retainPolicy: optional` and `omissionPolicy: allow` | Allowed under trim conditions |
| `medium` | Omission may degrade quality but not cause unsafe behavior | May trim only with strong evidence and explicit policy | Allowed under trim conditions |
| `high` | Omission likely causes incorrect or degraded behavior | Must not trim in MVP | Not trimmable in MVP |
| `critical` | Omission causes unsafe or policy-violating behavior | Never trim; should be `retainPolicy: safety_critical` | Never trimmed |

> **Rule:** `riskLevel: critical` must have at least one hard protection: `retainPolicy: safety_critical` OR `omissionPolicy: never`. A `critical` component that has neither is a **hard validation error that halts the planning run**. Silent auto-upgrade is not allowed.

### omissionPolicy

| Value | Meaning | Behavior when evidence is insufficient | Budgeter interaction |
|---|---|---|---|
| `allow` | Omission is permitted if selector evidence supports it | Selector may omit if `safeToOmitWhen` matches | Trimmable if also `retainPolicy: optional` and low/medium risk |
| `fail_open` | Include when uncertain | Selector includes when no clear signal exists | **Not trimmable in MVP.** If included due to uncertainty, Budgeter must not trim. |
| `never` | Always include regardless of selector output | Selector output is overridden to `include` | Never trimmed by Budgeter |

> **Clarification:** `fail_open` does not automatically mean mandatory. A `fail_open` + `retainPolicy: optional` component with strong positive evidence *could* be trimmed in a future policy with an explicit `budgetTrimmable: true` override. In MVP, `fail_open` components are never trimmed.

### retainPolicy

| Value | Meaning | Can selector omit? | Can Budgeter trim? |
|---|---|:---:|:---:|
| `optional` | Budget-trimmable if low-priority | Yes, with evidence | Yes, if trim conditions met |
| `durable` | Retain unless very strong evidence supports omission | Only with strong positive evidence | No |
| `mandatory` | Must be in every plan regardless of family or budget | No | No |
| `safety_critical` | Cannot be removed by any module under any circumstance | No | No — sets `budgetOverflow: true` instead |

### defaultAction

| Value | Meaning |
|---|---|
| `include` | Include this component when no selector rule matches |
| `omit` | Omit this component when no selector rule matches (only valid for `retainPolicy: optional` and `omissionPolicy: allow`). Invalid if `retainPolicy` is `mandatory` or `safety_critical`, or if `omissionPolicy` is `never`. |
| `defer` | Exclude from this plan turn. Must emit a trace entry with `action: "defer"` and `reason: "defaultAction=defer"`. Must not be counted as omitted. No token savings claim is made. Lazy-loading is future work. |

> `defaultAction: omit` is invalid for components with `retainPolicy: mandatory`, `retainPolicy: safety_critical`, or `omissionPolicy: never`. A registry entry with this combination emits a non-fatal validation warning and has its `defaultAction` overridden to `include` by the loader. The run continues. (Hard halt applies only if the component is separately safety-critical malformed.)

### budgetPriority

Integer from 1 (trimmed first) to 10 (trimmed last). Used by the Budgeter as a tie-breaker when multiple optional components must be dropped to meet budget. Components with the same `budgetPriority` are trimmed in arbitrary order (both must be traced).

### evidenceRequired

See Section 7. Summary: `evidenceRequired` describes the additional signal conditions that must be satisfied for **Path A (explicit safe-omit)** beyond the `safeToOmitWhen` tag match. It is not evaluated in **Path B (default irrelevant-omit)**.

- `null`: no additional evidence expression is required. For Path A, the `safeToOmitWhen` match alone is sufficient (if all other Path A gates pass). A validation warning is emitted when this is combined with `omissionPolicy: allow` and non-empty `safeToOmitWhen`, because the registry author is authorizing omission without any signal expression.
- Non-null string: the expression must be satisfied for Path A to proceed. If the expression is not recognized in MVP, **Path A is disabled** for that component. Invalid grammar does not normalize to `null`.

---

## 6. Matching Semantics

### How requiredWhen and safeToOmitWhen match

In MVP, matching is **deterministic tag comparison only**. No fuzzy matching. No model interpretation.

A tag in `requiredWhen` or `safeToOmitWhen` matches if and only if it is string-equal to the current `promptFamily` value (after the Request Router produces a prompt family).

### Conflict: both requiredWhen and safeToOmitWhen match

If the current `promptFamily` appears in **both** `requiredWhen` and `safeToOmitWhen`:
- Action = `include` (fail-open)
- Emit a `conflicting_tags` trace entry identifying the component and prompt family
- This is a registry data quality issue; do not halt the run but emit a warning

### Neither requiredWhen nor safeToOmitWhen match

If no tag in either list matches the current `promptFamily`:
- Apply `defaultAction`
- If `defaultAction` is `include` or unset: include the component
- If `defaultAction` is `omit`: omit only if all omission conditions are met (see Section 5)
- If `defaultAction` is `defer`: exclude from this plan turn; emit a trace entry with `action: "defer"` and `reason: "defaultAction=defer"`; do not count as omitted; make no token savings claim

### Omission paths in MVP

There are exactly two valid omission paths in MVP. No component may be omitted via any other means.

#### Path A — Explicit safe-omit

Conditions (all must hold):
1. `safeToOmitWhen` contains the current `promptFamily`.
2. `evidenceRequired` is satisfied (all atoms evaluate to true against available signals).
3. No higher-priority include rule applies (e.g., `requiredWhen` match, user constraint, safety gate).
4. `omissionPolicy` is `allow`.

Trace reason: `safe_to_omit_match`.

`evidenceRequired: null` on a Path A component means: the `safeToOmitWhen` match alone is sufficient evidence (no additional signal atoms required). This is valid. The selector may omit.

#### Path B — Default irrelevant-omit

Conditions (all must hold):
1. `requiredWhen` does not match the current `promptFamily`.
2. `safeToOmitWhen` does not match the current `promptFamily`.
3. `defaultAction` is `omit`.
4. `retainPolicy` is `optional`.
5. `omissionPolicy` is `allow`.
6. `riskLevel` is `low` or `medium`.
7. No safety, privacy, or user constraint applies.

Trace reason: `default_action_omit`.

`evidenceRequired` is not evaluated in Path B. It applies only to Path A.

#### What cannot use Path B

Components with any of the following may not be omitted via Path B:
- `defaultAction: include` or `defaultAction: defer`
- `omissionPolicy: fail_open` or `omissionPolicy: never`
- `retainPolicy: durable`, `mandatory`, or `safety_critical`
- `riskLevel: high` or `riskLevel: critical`
- Any active user, safety, or privacy constraint

#### Key clarifications
- `defaultAction: omit` must never override `requiredWhen`. If `requiredWhen` matches, Path B is unavailable regardless of `defaultAction`.
- `safeToOmitWhen: []` means Path A is unavailable. Path B can still apply if all Path B conditions hold.
- A component with `omissionPolicy: allow`, non-empty `evidenceRequired`, and `safeToOmitWhen: []` may still be omitted via Path B if all Path B gates pass — `evidenceRequired` is irrelevant to Path B.
- A component with `omissionPolicy: allow`, `safeToOmitWhen: []`, and `defaultAction: include` cannot be omitted by either path in MVP. Treat as fail-open include.

### Future extensions (not MVP)

- Hierarchical tag inheritance (e.g., `coding.*` matching `coding_build_debug`)
- Logical expressions in `requiredWhen` (e.g., `coding_build_debug OR research_investigation`)
- Model-assisted tag classification

---

## 7. evidenceRequired Grammar

`evidenceRequired` is a constrained string that describes the conditions under which omission of this component is considered authorized. It authorizes **omission only**, never inclusion.

### MVP grammar (constrained string format)

### Atom Governance (F-04 resolved, Pass 4.3B)

**Canonical ownership:** `docs/05_COMPONENT_REGISTRY_SPEC.md` §7 is the sole canonical owner of all recognized `evidenceRequired` atoms. No other spec may define or extend the `evidenceRequired` atom set without a corresponding update to this section.

**Atom vs trace atom distinction:** Selector-phase signals such as `active_skill_id_match`, `active_tool_id_match`, `active_memory_id_match`, and `output_format_hint_match` (defined in `docs/06_SELECTOR_ORCHESTRATION_SPEC.md` §14) are **trace atoms** — they are added to the `evidence` array of a `SelectionDecision` to record why a selector made a positive include decision. They are **not** `evidenceRequired` atoms. The `evidenceRequired` field on a registry entry authorizes **omission only**; it cannot reference positive-include-only signals. Using a trace atom that represents a positive include signal inside `evidenceRequired` would be logically incoherent (it would claim that a signal authorizing inclusion is required to authorize omission).

**Unknown/unlisted atoms:** An atom string that does not appear in the active MVP atom table below is unrecognized. The selector must emit a validation warning and disable Path A for that component. Path B is unaffected. The invalid atom string must not be normalized to null.

**Future atoms:** New atoms must be defined in this section before they may be used in any registry entry or evaluated by any selector. Per-selector additions require a cross-spec decision pass.

### Active MVP Atom Set

A formal parser is **deferred**. In MVP, `evidenceRequired` is a human-readable string that the deterministic selector compares against the following fixed set of recognized atoms.

| Atom | Meaning | Notes |
|---|---|---|
| `promptFamily=<value>` | Current prompt family equals value (canonical; see compatibility note below) | Value must be a known `promptFamily` enum string |
| `riskLevel=<value>` | Component `riskLevel` field equals value | Value must be `low`, `medium`, `high`, or `critical` |
| `explicitUserConstraint=false` | No active user constraint from `userConstraints` references this component | Evaluates `userConstraints.alwaysInclude` and `userConstraints.neverInclude` |

> **Compatibility note (F-07 resolved, Pass 4.3A):** `requestFamily` was used in earlier drafts. It is **not canonical for MVP**. Registry authors must use `promptFamily=<value>`. A future migration tool may warn on legacy `requestFamily` atoms, but the MVP spec does not require supporting it as an alias unless explicitly decided in a future pass.

### Atoms Not Supported in MVP

The following atoms were previously listed as recognized but are explicitly **not supported** in MVP. Using them in `evidenceRequired` is treated as an unrecognized atom: Path A is disabled, a validation warning is emitted.

| Atom | Why not supported in MVP | Future path |
|---|---|---|
| `budgetCritical=true` | **Decision (F-06, Pass 4.3B):** `budgetState.budgetCritical` is available to selectors as context for producing informational budget hints (Orchestration spec §20). However, using `budgetCritical=true` inside `evidenceRequired` would allow budget pressure to authorize a Path A omission — a hidden budget-enforcement path inside selectors that directly contradicts the Orchestration spec §20 invariant: *"Budget pressure cannot authorize omit."* Selectors are budget-aware but must not use budget pressure as omission evidence. The Budgeter exclusively owns budget enforcement. | Future: define a scoped, explicit "budget-relaxed omission" path with its own trace code and safety constraints; remove this restriction only via a formal cross-spec pass. |

Atoms may be combined with `AND`. `OR` and `NOT` are **not supported in MVP** — mark as future.

### Examples

```
null
  → No additional evidence expression required.
  → For Path A: safeToOmitWhen match alone is sufficient if all other Path A gates pass.
  → Emits a validation warning when combined with omissionPolicy: allow + non-empty safeToOmitWhen.

"promptFamily=simple_greeting AND riskLevel=low"
  → Path A proceeds only if both atoms are satisfied AND safeToOmitWhen matches.

"promptFamily=simple_greeting AND riskLevel=medium"
  → Path A proceeds only if both atoms are satisfied AND safeToOmitWhen matches.

"promptFamily=coding_build_debug"
  → Path A proceeds only in coding_build_debug family AND safeToOmitWhen matches.

"explicitUserConstraint=false"
  → Path A proceeds only if no active user constraint applies AND safeToOmitWhen matches.

"promptFamily=simple_greeting OR riskLevel=low"  [INVALID in MVP — OR not supported]
  → Grammar not recognized. Path A disabled for this component. Not normalized to null.
  → Path B unaffected (Path B does not evaluate evidenceRequired).
```

### Worked Evaluation Example

**Component:**
- `riskLevel: low`
- `safeToOmitWhen: ["simple_greeting"]`
- `evidenceRequired: "promptFamily=simple_greeting AND riskLevel=low"`

**Signals available at decision time:**
- `promptFamily = simple_greeting`
- `riskLevel = low` (from component metadata)
- `explicitUserConstraint = false`

**Evaluation:**
1. `promptFamily=simple_greeting` → matches ✅
2. `riskLevel=low` → matches ✅
3. Both atoms satisfied → `evidenceRequired` is satisfied.
4. `safeToOmitWhen` also matches → Path A conditions met.
5. Result: selector may emit `action: omit` with trace reason `safe_to_omit_match`.

**Negative example (one atom fails):**

Same component, but signals:
- `promptFamily = coding_build_debug`
- `riskLevel = low`

Evaluation:
1. `promptFamily=simple_greeting` → does NOT match ❌
2. First atom fails → `evidenceRequired` is NOT satisfied → Path A unavailable.
3. `safeToOmitWhen` does not match `coding_build_debug` → Path A also unavailable on tag.
4. Result: selector must NOT omit via Path A. Check Path B gates if applicable.

**Null example (`evidenceRequired: null`):**

Component:
- `safeToOmitWhen: ["simple_greeting"]`, `evidenceRequired: null`, `omissionPolicy: allow`

Signals: `promptFamily = simple_greeting`

Evaluation:
1. `safeToOmitWhen` matches ✅
2. `evidenceRequired` is `null` → no additional atoms required; Path A condition 2 is satisfied.
3. Path A proceeds. Result: selector may omit.
4. Note: validation emits a warning at load time because `omissionPolicy: allow` + non-empty `safeToOmitWhen` + `evidenceRequired: null` means omission is authorized by tag match alone.

**Invalid grammar example:**

Component:
- `evidenceRequired: "promptFamily=simple_greeting OR riskLevel=low"` (OR not supported in MVP)

Evaluation at load time:
1. Grammar not recognized (OR operator). Emit validation warning.
2. Path A is **disabled** for this component. Invalid grammar is NOT normalized to `null`.
3. Path B is unaffected — Path B does not evaluate `evidenceRequired`.

### Validation

- `evidenceRequired: null`: no additional evidence expression is required for Path A. The `safeToOmitWhen` match alone is sufficient (subject to all Path A gates). See warnings below.
- `evidenceRequired` is non-null and the grammar is recognized: all atoms must be satisfied for Path A to proceed. If any atom fails, Path A is unavailable.
- `evidenceRequired` is non-null but grammar is **not recognized** in MVP: emit validation warning; **Path A is disabled** for this component. The invalid string is **not normalized to `null`**. Do not halt.
- `omissionPolicy: allow` AND `safeToOmitWhen` is non-empty AND `evidenceRequired` is `null`: emit a validation warning — omission is authorized by `safeToOmitWhen` tag match alone. This is valid but must be an intentional registry decision.
- `omissionPolicy: allow` AND `defaultAction: omit` AND `safeToOmitWhen` is empty AND `evidenceRequired` is `null`: **no warning**. Valid for Path B; `evidenceRequired` not evaluated in Path B.
- `omissionPolicy: allow` AND `safeToOmitWhen` is empty AND `defaultAction` is not `omit` AND `evidenceRequired` is `null`: emit a validation warning. This component has no valid omission path in MVP; consider using `omissionPolicy: fail_open`.

---

## 8. Validation Rules

All validation occurs at registry load time, before any planning run begins.

| Scenario | Behavior |
|---|---|
| Registry file not found | **Hard error: halt immediately.** Exit non-zero. |
| Invalid JSON (unparseable) | **Hard error: halt immediately.** |
| Missing or invalid `riskLevel`, `retainPolicy`, or `omissionPolicy` (safety-classification fields) | **Hard error: halt the planning run.** These fields cannot be guessed or defaulted. Treating unknown values as high-risk still guesses; halting is the only safe option. |
| Missing required non-safety field on any component | If component has `retainPolicy: safety_critical` OR `riskLevel: critical` OR `omissionPolicy: never` → **hard error: halt planning.** Otherwise: quarantine component, emit validation warning, add to `quarantinedComponents`, continue planning. Do not default missing fields. Do not include malformed components. |
| Invalid enum value on non-safety-classification field (e.g., unknown `type`, invalid `defaultAction`) | If component has `retainPolicy: safety_critical` OR `riskLevel: critical` OR `omissionPolicy: never` → **hard error: halt planning.** Otherwise: quarantine component, emit validation warning, continue planning. Exception: if `defaultAction: omit` is paired with a valid `retainPolicy: mandatory` or `safety_critical`, apply the override-to-include rule (see below) rather than quarantine. |
| Duplicate `id` — any occurrence involves a hard-protected component (`retainPolicy: safety_critical` OR `riskLevel: critical` OR `omissionPolicy: never`) | **Hard error: halt the planning run.** A duplicate ID can silently replace or corrupt a hard-protected component. Emit `fatal_duplicate_id` trace entry with both occurrences identified. Add to `fatalErrors`. |
| Duplicate `id` — no occurrence is hard-protected | Retain first occurrence. Reject later occurrences. Emit `duplicate_id_rejected` trace entry. Add validation warning. Continue planning. |
| Unknown component ID referenced by selector | Do not include, do not omit. Emit `reference_unknown` trace entry. Flag as planning warning. |
| `hash` mismatch (hash field present but does not match content hash) | Emit validation warning. Do not halt. Flag component as `hash_drift` in registry output. |
| `tokensApprox` or `charsApprox` < 1 and `metadataOnly` is false or absent | Treated as malformed. If component has `retainPolicy: safety_critical` OR `riskLevel: critical` OR `omissionPolicy: never` → **hard error: halt planning.** Otherwise: quarantine component, emit validation warning, add to `quarantinedComponents`, continue planning. Do not default or clamp token/char values. Do not include malformed components. |
| `tokensApprox` or `charsApprox` < 0 (negative) | Always malformed, even if `metadataOnly: true`. Apply same halt-or-quarantine policy: if `retainPolicy: safety_critical` OR `riskLevel: critical` OR `omissionPolicy: never` → **hard error: halt planning.** Otherwise: quarantine, emit validation warning, continue. Do not clamp negative values. |
| `budgetPriority` out of [1, 10] range | Clamp to nearest valid value (1 or 10). Emit warning. |
| `defaultAction: omit` combined with `retainPolicy: mandatory`, `retainPolicy: safety_critical`, or `omissionPolicy: never` | Emit non-fatal validation warning. Do not halt (unless component is separately malformed under a halt condition). Override `defaultAction` to `include`. Continue planning. |
| `riskLevel: critical` without `retainPolicy: safety_critical` AND without `omissionPolicy: never` | **Hard error: halt the planning run.** A `critical` component must have at least one hard protection (`retainPolicy: safety_critical` OR `omissionPolicy: never`). Silent auto-upgrade is not allowed. |
| `evidenceRequired` is non-null but grammar not recognized | Emit validation warning. **Path A is disabled** for this component. Invalid grammar is not normalized to `null`. Path B is unaffected. |
| `omissionPolicy: allow`, non-empty `safeToOmitWhen`, `evidenceRequired: null` | Emit validation warning. Path A proceeds with `safeToOmitWhen` match alone; registry author should verify this is intentional. |
| `omissionPolicy: allow`, `defaultAction: omit`, empty `safeToOmitWhen`, `evidenceRequired: null` | Valid for Path B. No warning. |
| `omissionPolicy: allow`, empty `safeToOmitWhen`, `defaultAction` not `omit`, `evidenceRequired: null` | Emit validation warning. No valid omission path in MVP. Consider using `omissionPolicy: fail_open`. |

---

## 9. Example Components

### 9.1 Low-risk scaffold component

```json
{
  "id": "scaffold.general_assistant",
  "type": "scaffold",
  "title": "General Assistant Persona",
  "summary": "Defines the agent's general assistant persona and behavioral guidelines.",
  "source": "scaffold/general_assistant.md",
  "tokensApprox": 320,
  "charsApprox": 1280,
  "riskLevel": "low",
  "requiredWhen": ["general_default", "simple_greeting"],
  "safeToOmitWhen": [],
  "defaultAction": "include",
  "omissionPolicy": "fail_open",
  "retainPolicy": "optional",
  "budgetPriority": 4,
  "evidenceRequired": null,
  "tags": ["persona", "scaffold"],
  "version": "1.0.0",
  "hash": null
}
```

### 9.2 Coding skill component

```json
{
  "id": "skill.code_review",
  "type": "skill",
  "title": "Code Review Skill",
  "summary": "Provides step-by-step instructions for reviewing code for correctness, style, and security.",
  "source": "skills/code_review.md",
  "tokensApprox": 580,
  "charsApprox": 2320,
  "riskLevel": "low",
  "requiredWhen": ["coding_build_debug"],
  "safeToOmitWhen": ["simple_greeting"],
  "defaultAction": "omit",
  "omissionPolicy": "allow",
  "retainPolicy": "optional",
  "budgetPriority": 6,
  "evidenceRequired": "promptFamily=simple_greeting AND riskLevel=low",
  "tags": ["coding", "review", "skill"],
  "version": "1.2.0",
  "hash": null
}
```

### 9.3 Tool component (web_search)

```json
{
  "id": "tool.web_search",
  "type": "tool",
  "title": "Web Search Tool",
  "summary": "Allows the agent to search the web for current information.",
  "source": "tools/web_search.schema.json",
  "tokensApprox": 180,
  "charsApprox": 720,
  "riskLevel": "medium",
  "requiredWhen": ["research_investigation", "tool_use_required"],
  "safeToOmitWhen": ["simple_greeting"],
  "defaultAction": "omit",
  "omissionPolicy": "allow",
  "retainPolicy": "optional",
  "budgetPriority": 5,
  "evidenceRequired": "promptFamily=simple_greeting AND riskLevel=medium",
  "tags": ["tool", "search", "web"],
  "version": "2.0.0",
  "hash": null
}
```

### 9.4 Safety policy component

```json
{
  "id": "policy.privacy_constraints",
  "type": "policy",
  "title": "Privacy Constraint Policy",
  "summary": "Defines what the agent must not disclose, share, or expose about user data.",
  "source": "policies/privacy_constraints.md",
  "tokensApprox": 260,
  "charsApprox": 1040,
  "riskLevel": "critical",
  "requiredWhen": [],
  "safeToOmitWhen": [],
  "defaultAction": "include",
  "omissionPolicy": "never",
  "retainPolicy": "safety_critical",
  "budgetPriority": 10,
  "evidenceRequired": null,
  "tags": ["policy", "privacy", "safety"],
  "version": "3.1.0",
  "hash": "a3f1b2c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2"
}
```

### 9.5 History lane descriptor component

```json
{
  "id": "history.durable_constraints",
  "type": "history",
  "title": "Durable Constraints History Lane",
  "summary": "Metadata descriptor for the durable_constraints history lane. Turns in this lane must never be dropped.",
  "source": "history:lane:durable_constraints",
  "tokensApprox": 0,
  "charsApprox": 0,
  "metadataOnly": true,
  "riskLevel": "critical",
  "requiredWhen": [],
  "safeToOmitWhen": [],
  "defaultAction": "include",
  "omissionPolicy": "never",
  "retainPolicy": "safety_critical",
  "budgetPriority": 10,
  "evidenceRequired": null,
  "tags": ["history", "lane", "durable"],
  "version": "1.0.0",
  "hash": null
}
```

> **Note:** `metadataOnly: true` permits `tokensApprox: 0` and `charsApprox: 0`. The actual token cost of this lane is borne by the turn content in `historyState`, not the lane descriptor itself.

---

## 10. Registry Output / Indexes

After loading and validating the registry file, the registry loader produces the following conceptual indexes (no code — design only):

| Index | Type | Contents |
|---|---|---|
| `componentsById` | Map<id → component> | All valid components keyed by id |
| `componentsByType` | Map<type → component[]> | All valid components grouped by type |
| `componentsByTag` | Map<tag → component[]> | All valid components grouped by each tag |
| `safetyCriticalIds` | Set<id> | All component IDs with `retainPolicy: safety_critical` or `omissionPolicy: never` |
| `trimmableCandidateIds` | Set<id> | Static registry-level candidate set: `retainPolicy: optional` AND `omissionPolicy: allow` AND `riskLevel` in [low, medium]. **This is not a final trim list.** The Budgeter must still verify each candidate against the resolved `SelectionDecision`, active constraints, fail-open status, and runtime budget state before trimming. |
| `quarantinedComponents` | component[] | Components excluded due to non-fatal validation failures (not safety-critical — those halt the run entirely) |
| `validationWarnings` | warning[] | Non-fatal validation issues: unrecognized `evidenceRequired` grammar, `evidenceRequired: null` with non-empty `safeToOmitWhen`, `budgetPriority` clamped, `hash_drift`, duplicate non-hard-protected id rejected. Does not include hard-protected duplicate id (halt), `critical_without_protection` (halt), or missing `hash` key (required field). |
| `fatalErrors` | error[] | Issues that halted the planning run (missing/invalid safety-classification fields, malformed safety-critical component, etc.). Populated before halt for logging purposes. |

---

## 11. Trace Requirements

The registry must emit the following trace entries into `trace.json`:

| Event | When | Required fields in trace |
|---|---|---|
| `registry_loaded` | On successful load | registry file path/id, component count, timestamp |
| `registry_version` | If `version` or `hash` available on registry file | version, hash (if available) |
| `component_quarantined` | For each quarantined component | componentId, reason, riskLevel |
| `duplicate_id_rejected` | For each non-hard-protected duplicate (non-fatal) | duplicateId, retainedSource, rejectedSource |
| `fatal_duplicate_id` | When a duplicate involves any hard-protected component (fatal) | duplicateId, occurrenceSources, haltReason |
| `validation_warning` | For each non-fatal warning | componentId (if applicable), field, issue |
| `safety_critical_halt` | On halt due to safety-critical malformation | componentId, missingFields, haltReason |
| `reference_unknown` | When a selector references an unknown ID | componentId, selectorModule |
| `hash_drift` | When hash field is present but does not match content | componentId, expectedHash, actualHash |

Raw component content must **not** appear in trace entries. Only `id`, `hash`, and `source` references are permitted.

---

## 12. MVP Constraints

- **Single registry JSON input file.** One file per planning run. Passed via CLI `--registry` argument.
- **No hot reload.** Registry is loaded once at the start of a planning run and is immutable during the run.
- **No adapter extraction yet.** Adapters (OpenClaw file scanner, n8n node extractor) are future work. In MVP, the operator manually creates the registry JSON.
- **No model-assisted registry generation.** Metadata fields are hand-authored in MVP.
- **No automatic metadata rewriting.** The registry loader reads but never writes back to the registry file.
- **No fuzzy matching.** `requiredWhen` and `safeToOmitWhen` use exact string comparison against prompt family tags.
- **No live runtime integration.** `runtime_capability` components are manually authored; no live capability probe.
- **No formal evidenceRequired parser.** MVP uses constrained string comparison against known signal atoms.

---

## 13. Future Extensions

| Extension | Description | Prerequisite |
|---|---|---|
| Generated metadata from source files | Auto-compute `tokensApprox`, `charsApprox`, and `hash` from actual source file at load time | Tokenizer library integration |
| Adapter-provided registries | OpenClaw, n8n, Telegram adapters populate registry from their file structures | Adapter interface finalized |
| Source hash drift detection | Alert when `hash` field no longer matches current source file content | Hash computation at load time |
| Tokenizer-based `tokensApprox` | Compute actual token counts per model family rather than hand-authored estimates | Multi-model tokenizer support |
| Component dependency graph | Allow components to declare dependencies on other components | Dependency resolver module |
| Formal `evidenceRequired` parser | Parse and evaluate logical expressions in `evidenceRequired` | Grammar design and parser implementation |
| `budgetTrimmable: true` override | Allow carefully reviewed `fail_open` components to be trimmed under explicit policy | Policy governance process |
| Model-assisted metadata suggestion | Model suggests `riskLevel`, `tags`, `requiredWhen` values from content; operator reviews and confirms | Model-assisted tooling (review-only, never auto-apply) |

> **Non-MVP cross-reference note (F-30 — safe-defer):** A future policy combining `budgetTrimmable: true` with the `expensive_optional` budget hint (Orchestration spec §23) may allow the Budgeter to trim carefully reviewed `fail_open` components flagged as expensive. This interaction is **not implemented in MVP**. In MVP, `fail_open` components are never trimmed by the Budgeter regardless of their `budgetHint` value — see §5 `omissionPolicy: fail_open` row. The combined trim condition, safety gate, and governance process for this interaction are deferred to a future cross-spec design pass. See Orchestration spec §23.4 for the reciprocal note.

---

## 14. Definition of Done

- [x] All minimum fields defined with type, required/optional, allowed values, meaning, validation rule, and example.
- [x] All enums defined: `riskLevel`, `omissionPolicy`, `retainPolicy`, `defaultAction`, component types.
- [x] Safety semantics consistent with `docs/04_PORTABLE_CORE_ARCHITECTURE.md`.
- [x] Validation behavior defined for all failure scenarios.
- [x] Five example components covering all major types and risk levels.
- [x] Registry output indexes defined.
- [x] Trace requirements defined.
- [x] MVP constraints explicitly listed.
- [x] Future extensions listed with prerequisites.
- [x] No code implemented.
- [x] No JSON Schema files created.
- [x] No OpenClaw live state touched.
- [x] No provider or model calls.
- [x] `metadataOnly` field added; zero-token rule resolved for history lane descriptors.
- [x] Safety-classification field failure behavior defined: missing/invalid `riskLevel`, `retainPolicy`, `omissionPolicy` halt the run.
- [x] `evidenceRequired` examples internally consistent with `safeToOmitWhen` and `riskLevel`.
- [x] `defaultAction: defer` trace behavior defined (emit defer trace entry, no token savings claim).
- [x] Registry output error categories clarified: `fatalErrors`, `validationWarnings`, `quarantinedComponents`.
- [x] Worked `evidenceRequired` evaluation example added (positive and negative).
- [x] `hash` field table example changed to `null` (field table); full 64-char hex used only in policy example.
- [x] Spec examples do not trigger known validation warnings: scaffold example uses `omissionPolicy: fail_open`.
- [x] `metadataOnly` classified as MVP optional field; future-only fields in separate table.
- [x] `trimmableCandidateIds` replaces `trimmableIds`; clarified as static registry candidate set, not final Budgeter decision.
- [x] `defaultAction: omit` invalid-combination behavior aligned: non-fatal warning + override to `include`, not hard halt.
- [x] Two explicit omission paths defined (Path A: explicit safe-omit; Path B: default irrelevant-omit); contradiction with prior omission gate resolved.
- [x] `evidenceRequired` scope clarified: governs Path A only; not evaluated in Path B.
- [x] `safeToOmitWhen: []` meaning updated: Path A unavailable, but Path B can still apply if Path B conditions hold.
- [x] `critical_without_protection` changed from validation warning to hard halt.
- [x] `hash` field changed from optional to required-nullable (key always present; value may be `null`).
- [x] `version` field confirmed required for MVP; open question removed.
- [x] `evidenceRequired: null` semantics clarified: no additional atoms required; safeToOmitWhen match sufficient for Path A; validation warning emitted.
- [x] Invalid `evidenceRequired` grammar no longer normalized to `null`; Path A disabled on invalid grammar; Path B unaffected.
- [x] Examples updated: null example and invalid grammar example added to Section 7.
- [x] Validation rules cover all risk levels (low, medium, high, critical) and all retain/omit policies; halt-or-quarantine policy unified without requiring implementation guesses.
- [x] Token/char malformation rows (`tokensApprox`/`charsApprox` < 1 and < 0) now use the same unified halt-or-quarantine policy; no longer imprecise "optional/medium risk" wording.
- [x] `riskLevel: critical` hard-protection rule reworded unambiguously: must have at least one of (`retainPolicy: safety_critical` OR `omissionPolicy: never`), not both.
- [x] `defaultAction: omit` invalid-combination coverage extended to `omissionPolicy: never` in both Section 5 and Section 8 Validation Rules.
- [x] Duplicate-id validation hardened: any occurrence involving a hard-protected component (`retainPolicy: safety_critical` OR `riskLevel: critical` OR `omissionPolicy: never`) now halts planning; non-hard-protected duplicates warn and continue.

---

## Open Questions

1. **Should `history` type components hold a reference to actual lane content or only lane descriptor metadata?** The current design keeps content in `historyState` input and uses registry only for lane rules. Confirm this is the right boundary. *(Deferred to History Lane Manager spec.)*

2. **How should `runtime_capability` components interact with the selector?** The selector checks `runtimeCapabilities` from the runtime input, but `runtime_capability` components in the registry represent declared capability metadata. The boundary between runtime-provided and registry-declared capability information needs clarification before the selector spec. *(Deferred to Selector Orchestration Spec.)*

3. **Should `evidenceRequired` grammar errors quarantine the component or only disable Path A?** Current behavior: emit warning + Path A disabled (invalid grammar is not normalized to `null`). A stricter future policy could quarantine the component entirely, preventing both Path A and Path B. *(Deferred to schema validation pass; current behavior is fail-safe for Path A while preserving Path B.)*

> **Resolved from Pass 1:** `tokensApprox: 0` allowed via `metadataOnly: true`.
> **Resolved from Pass 3:** `version` is required for MVP. May be semver or opaque string (e.g., `"mvp-1"`). Rationale: stable registry evolution and future drift tracking.
