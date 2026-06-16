# Agent Board protocol — ZAM / context-plane

## 1. Purpose

This board coordinates a controlled, manual two-agent workflow for ZAM / `context-plane`.

It is not an autonomous orchestration system.

Sam manually activates each pass.

Agents do not call each other.

## 2. Project Boundary

ZAM / `context-plane` is a portable Context Governance / Context Control Plane for AI agent runtimes.

The project must remain:

* portable across runtimes
* deterministic and offline in MVP
* schema-valid
* fixture-verifiable
* fail-open on uncertainty
* auditable through trace evidence
* independent from OpenClaw internals
* free from live provider/runtime mutation

The MVP is not an agent runtime, not an OpenClaw fork, not a provider execution system, and not a live prompt mutation layer.

## 3. Board Files

The active board files are:

```text
agent-board/
  zam-protocol.md
  zam-coder-report.md
  zam-reviewer-feedback.md
  zam-message-to-coder.md
```

No `pending-decisions.md` is used in the normal workflow.

Decisions are handled directly in chat. If an agent needs Sam to decide, it must stop and ask Sam with clear options.

## 4. File Ownership

| File                   | Owner                             | Purpose                            | Write Rule                                                |
| ---------------------- | --------------------------------- | ---------------------------------- | --------------------------------------------------------- |
| `zam-protocol.md`          | Sam / approved setup pass         | Board protocol and ownership       | Stable. Do not casually edit.                             |
| `zam-coder-report.md`      | Coder Agent                       | Latest Coder pass report           | Overwrite after each Coder pass. Latest pass only.        |
| `zam-reviewer-feedback.md` | Reviewer Agent                    | Short latest-review state          | Overwrite after each review. Keep concise.                |
| `zam-message-to-coder.md`  | Reviewer Agent after Sam approval | Next English instruction for Coder | Write only after Sam explicitly approves and asks for it. |

## 5. Coder Agent

Coder is a surgical implementation/editor agent.

Coder may make only small, scoped, explicitly approved changes.

Coder must:

1. read `agent-board/zam-protocol.md`;
2. read Sam's current instruction or approved `agent-board/zam-message-to-coder.md`;
3. read relevant rules, workflow, skill, and canonical project sources;
4. inspect actual disk state;
5. edit only approved files;
6. run only safe and relevant verification;
7. overwrite `agent-board/zam-coder-report.md`;
8. stop.

Coder must not:

* write `zam-reviewer-feedback.md`;
* write `zam-message-to-coder.md`;
* call Reviewer;
* call subagents;
* start another pass.

## 6. Reviewer Agent

Reviewer is an independent auditor.

Reviewer must not edit source files, docs, schemas, fixtures, tests, package files, config files, or implementation files.

Reviewer must:

1. read `agent-board/zam-protocol.md`;
2. read `agent-board/zam-coder-report.md`;
3. inspect files listed in the Coder report;
4. read relevant rules, workflow, skill, and canonical project sources;
5. verify whether the Coder's claims match disk state;
6. give the main Persian review directly in chat;
7. ask Sam directly in chat if a decision is needed;
8. overwrite `agent-board/zam-reviewer-feedback.md` with a short latest-review state;
9. stop.

Reviewer may write `agent-board/zam-message-to-coder.md` only after Sam explicitly approves the review direction and asks for the next Coder message.

`zam-message-to-coder.md` must be written in English and must define one narrow Coder pass.

## 7. Chat-Based Decisions

If Coder or Reviewer needs a decision from Sam, it must stop and ask in chat.

Use clear options when helpful.

Example:

```text
Decision needed:
A) Ask Coder to fix only docs wording.
B) Ask Coder to update schema + fixtures.
C) Stop and defer this issue.
```

Do not continue until Sam answers.

Do not store open decisions in a board file unless Sam explicitly asks.

## 8. No Automatic Agent Chaining

Forbidden unless Sam explicitly approves that exact action:

* Coder calling Reviewer
* Reviewer calling Coder
* subagent delegation
* `browser_subagent`
* `agentapi`
* autonomous multi-pass loops
* hidden background work
* IDE internal exploration
* external website access

Sam manually activates each pass.

## 9. Workspace Boundary

All reads, writes, inspections, and commands must stay inside the active ZAM workspace root.

Forbidden unless Sam explicitly approves the exact path and action:

* `.gemini`
* AppData
* IDE internals
* Antigravity internal config
* plugin directories
* MCP config
* language server files
* provider credentials
* environment variables
* external websites
* files outside the active workspace root
* live OpenClaw state
* `~/.openclaw`
* provider/runtime state
* secrets or private logs

If the workspace root is unclear, stop and ask Sam.

Never mix files from different project roots unless Sam explicitly approves that exact cross-workspace operation.

## 10. Reviewer Verdicts

Reviewer verdicts must use only one of:

* `ACCEPT`
* `ACCEPT_WITH_NOTES`
* `NEEDS_FIX`
* `BLOCKED`
* `OUT_OF_SCOPE`

Use `BLOCKED` when Sam must decide or when required evidence is unavailable.

Do not invent softer verdicts.

Do not give unconditional `ACCEPT` when required runtime behavior, tests, schema validity, fixture consistency, or disk-state evidence cannot be verified.

## 11. Exact Status Wording

When reporting the accepted setup-time baseline, use exact wording:

```text
context-plane v0.1.0
Gate B: SATISFIED WITH 1 APPROVED SKIP(S)
Full suite: 651/651
Evaluate: passed=27 failed=0 skipped=1 blocked=0 EXIT:0
Correct wording: 27 passed, 1 approved-skipped
```

Do not write:

```text
all 28 E2E fixtures passed
28/28 passed
all fixtures passed
Gate B fully passed with no exceptions
```

Before relying on baseline counts, read the latest release/status docs or Sam's current instruction.

Treat baseline numbers as setup-time context, not eternal truth.

## 12. Change Discipline

Every Coder pass must have:

* clear objective
* allowed files
* forbidden files
* canonical sources
* exact edits
* verification
* latest-pass report

Every Reviewer pass must check:

* scope
* disk state
* canonical consistency
* verification
* forbidden-file safety
* exact status language
* remaining risks

## 13. Stop Conditions

Any agent must stop if:

* scope is unclear
* workspace root is unclear
* disk state contradicts the task
* canonical sources conflict
* forbidden files would be touched
* provider/model/runtime calls would be needed
* external access would be needed
* verification cannot support the claimed result
* Sam must decide
* a second pass would be required

When in doubt, stop and ask Sam.

## 14. Active Collaboration Method

The Reviewer Agent acts as the project lead, and Sam acts as a supervising collaborator.

At each stage, the Reviewer should NOT ask Sam "what is the next step?". Instead, the Reviewer must:
1. Determine the next logical step based on canonical project plans (e.g., `docs/13`).
2. Explain to Sam what has happened and what the proposed next step is.
3. Wait for Sam's approval.
4. If approved, write `agent-board/zam-message-to-coder.md` for the Coder agent.
5. Notify Sam that the message has been written so the Coder can be activated.
