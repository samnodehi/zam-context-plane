---
trigger: always_on
---

# ZAM / `context-plane` — Project Base Rule

## Project Identity

Workspace: ZAM / `context-plane` — **Portable Context Governance / Context Control Plane** for AI agent runtimes.

**Not:** an agent runtime, OpenClaw fork/replacement, provider execution system, live prompt mutation layer, generic prompt preprocessor, or model-calling runtime.

Core purpose: decide — before prompt assembly — which registered context components to select, omit, defer, fail-open include, quarantine at registry phase, or surface as warnings/trace evidence.

Core deliverables: `prompt-plan.json`, `trace.json`, `summary.md`

Must remain portable across: OpenClaw, n8n, Telegram bots, custom AI chat systems, coding agents, and future adapters.

## Current Baseline

| Field | Value |
|---|---|
| Package | `context-plane` |
| Version | `0.1.0` |
| CLI MVP | accepted / closed |
| Gate A | satisfied |
| Gate B | `SATISFIED WITH 1 APPROVED SKIP(S)` |
| Gate C | satisfied |
| Gate D | intentionally out of MVP scope / blocked by design |
| Full suite | `651/651` |
| Evaluate | `passed=27 failed=0 skipped=1 blocked=0 EXIT:0` |
| Correct wording | `27 passed, 1 approved-skipped` |
| Forbidden wording | `all 28 E2E fixtures passed` |

Approved skipped fixture: `fixtures/13-conflict-resolution/safety-beats-omit`
Not a bug. Approved architectural limitation of MVP E2E selector route. Code path covered by direct unit coverage.

## Core Design Principles

1. **Portability first.** Core must not become OpenClaw-specific. Adapter work is post-MVP and requires explicit approval.
2. **Smaller context only when safe.** Omission requires canonical metadata, deterministic rules, schema-valid outputs, and trace evidence. Uncertainty must fail open to fuller context.
3. **Determinism.** MVP is deterministic and offline. No random behavior, no timestamps in deterministic output fields unless canonical, no provider/model calls.
4. **Auditability.** Every meaningful decision must be traceable. No hidden prompt mutation, silent omission, or silent fallback. Warning and trace placement must follow canonical specs.
5. **Canonical ownership.** Do not invent fields, enums, paths, warning codes, fixture semantics, or schema behavior. Read the canonical owner before changing anything.
6. **Fail-open safety.** Safety-critical, mandatory, durable, policy, and history-sensitive context must not be trimmed/omitted unless canonical rules explicitly allow it. Low confidence must never become aggressive omission.
7. **Exact accounting.** Candidate-set accounting, partition integrity, fixture counts, approved skip wording, and test result wording must remain exact. Do not round, simplify, or clean up status language.
8. **No live runtime mutation.** Do not mutate OpenClaw, `~/.openclaw`, provider settings, runtime state, user environment, or external services. Do not inspect live runtime internals unless Sam explicitly approves.

## Canonical Source Priority

Read canonical owner first (in order):

1. `PROJECT_MASTER_PLAN.md`
2. `docs/00_NORTH_STAR.md`
3. `docs/04_PORTABLE_CORE_ARCHITECTURE.md`
4. `docs/05_COMPONENT_REGISTRY_SPEC.md`
5. `docs/06_SELECTOR_ORCHESTRATION_SPEC.md`
6. `docs/09_IMPLEMENTATION_READINESS_AUDIT.md`
7. `docs/11_CLI_MVP_IMPLEMENTATION_PLAN.md`
8. `docs/12_SCHEMA_AND_HARNESS_PLAN.md`
9. `docs/13_MODEL_ASSISTED_CONTEXT_PLANNING.md`
10. `docs/RELEASE_NOTES_v0.1.0.md`
11. Actual source, schemas, fixtures, and tests relevant to the pass

Documents disagree → report conflict and stop unless the approved task explicitly resolves it.

## Hard Prohibitions

Unless Sam explicitly approves the exact action, never:
- Call providers or models from project code; run live OpenClaw; mutate OpenClaw state; modify `~/.openclaw`
- Use: external websites, browser subagents, `agentapi`, IDE internals
- Read or write: `.gemini`, AppData
- Access files outside active workspace root; introduce subagents; create autonomous agent-to-agent handoffs
- Perform broad refactors; change schemas without canonical approval; change fixtures without matching schema/spec/test reasoning
- Change release/status wording casually
- Add secrets, credentials, tokens, private logs, or provider payloads
- Assume Git rollback exists

## Workspace Boundary

All project files must stay inside the active workspace root.

Forbidden locations: `.gemini/`, AppData, user home config folders, external repos, live OpenClaw install paths, provider/runtime state directories, temporary locations outside workspace root.

Workspace root unclear → stop and ask Sam.

## Change Discipline

Every change must be: small, scoped, explicitly approved, traceable to canonical sources, reviewable by file name, verified by narrowest adequate checks, and reported through `agent-board/coder-report.md`.

Never improve nearby code outside the approved scope. Never rewrite historical notes merely because they are old.

## Verification Discipline

Match verification to change type:

| Change type | Verification |
|---|---|
| Documentation only | Inspect changed files; verify no forbidden files changed; optionally run markdown/static checks if available and approved |
| Schema change | Validate schema syntax; check canonical enum/field ownership; run schema-related tests if available |
| Fixture change | Validate fixture JSON; run relevant harness/evaluation checks; verify expected outputs and assertions stay aligned |
| Source code change | Run targeted tests first; broader tests only if justified; never run expensive or live-provider checks without Sam's explicit approval |

Verification cannot be run → report clearly. Do not claim acceptance.

## Status Language Rules

Allowed:
Gate B: SATISFIED WITH 1 APPROVED SKIP(S)
Evaluate: passed=27 failed=0 skipped=1 blocked=0 EXIT:0
27 passed, 1 approved-skipped
Full suite: 651/651

Forbidden:
all 28 E2E fixtures passed
28/28 passed
all fixtures passed
Gate B fully passed with no exceptions

## Stop Conditions

Stop immediately and report if:
- Scope is unclear
- Canonical sources disagree
- Actual disk state differs from task premise
- Requested work requires touching forbidden files
- Tests or schema validation contradict expected result
- A change would alter MVP behavior without explicit approval
- A change would open Gate D / adapter / runtime work
- A command would access outside workspace root
- A provider/model/runtime call would be needed
- Secrets or private logs appear
- More than one small pass is needed

When in doubt, stop. Do not improvise.
