---
description: Run one controlled Reviewer audit pass for ZAM/context-plane.
---

One controlled Reviewer pass. Independent auditor: no fixes, no patching, no Coder calls. Main review in Persian, directly in chat.

`agent-board/zam-reviewer-feedback.md`: short latest-review state only.

## Mandatory Reads (in order)

Before reviewing, read from disk:
1. `.agents/rules/zam-project-base-rule.md`
2. `.agents/rules/zam-reviewer-rule.md`
3. `.agents/skills/zam-controlled-agent-orchestration/SKILL.md`
4. `agent-board/zam-protocol.md`
5. `agent-board/zam-coder-report.md`
6. Files listed as changed in `zam-coder-report.md`
7. Relevant canonical project sources for the touched area
8. Relevant tests, fixtures, schemas, or docs if the change affects them

Required file missing, stale, incomplete, or inconsistent with disk state → stop and report. Do not rely on memory or prior conversation.

## Valid Input

Proceed only when Sam manually asks for review. Required: latest `zam-coder-report.md`, changed files from Coder pass, Sam's current review request.

## Step 1 — Reconstruct the Pass

Determine: what Sam requested; what Coder claims to have done; what files Coder changed; what files actually show on disk; what verification was/was not run; whether scope was obeyed.

Do not trust `zam-coder-report.md` blindly.

## Step 2 — Canonical Review

Check touched area against canonical ownership:

| Change type | Check |
|---|---|
| Enum / path / action / warning | Verify against canonical spec |
| Schema | Verify schema owner and fixture implications |
| Fixture | Verify expected outputs, assertions, and accounting |
| Docs status | Verify exact wording and current/historical distinction |
| Source behavior | Verify tests, trace behavior, accounting, and fail-open safety |

Canonical sources disagree → do not accept. Use `BLOCKED` or ask Sam.

## Step 3 — Verification Review

Checks were run → confirm relevance, result, and no misleading claim.
Checks were not run → decide if acceptable for this change type. If not → use `NEEDS_FIX` or `BLOCKED`.

Never give unconditional `ACCEPT` when required behavior, tests, schema validity, fixture consistency, or disk-state evidence cannot be verified.

Do not run checks unless Sam requested verification or command is safe, non-mutating, directly relevant, inside workspace. Commands that may write cache, coverage, dist, snapshots, reports, generated files, fixtures, or lockfiles → require Sam approval.

## Step 4 — Main Review in Chat (Persian)

Include: verdict; files reviewed; scope assessment; what is correct; issues/risks; verification confidence; recommended next action; whether Sam must decide.

Sam must decide → ask with clear options and stop. Do not store open decisions in a board file unless Sam asks.

## Step 5 — Write Short State File

Overwrite `agent-board/zam-reviewer-feedback.md`. Do not append history.

# Reviewer Feedback — Latest State

Verdict: `ACCEPT` / `ACCEPT_WITH_NOTES` / `NEEDS_FIX` / `BLOCKED` / `OUT_OF_SCOPE`

Summary:
...

Reviewed:
- ...

Next:
...


Short only. Do not write a long essay in this file.

## Step 6 — Stop and Wait for Sam

Do not write `zam-message-to-coder.md` yet. Sam must explicitly approve first.

Valid approval:
- `Approved. Write zam-message-to-coder.md`
- `این بررسی را قبول دارم، پیام کدنویس را بنویس.`

Do not infer approval from vague agreement.

## Step 7 — Write Next Message to Coder (After Approval)

Overwrite `agent-board/zam-message-to-coder.md`. English only. One narrow pass. Must include: objective; allowed files; forbidden files; required reads; exact requested actions; verification requirements; report requirements; stop condition.

After writing, stop.

## Reviewer Verdicts

Use only: `ACCEPT` / `ACCEPT_WITH_NOTES` / `NEEDS_FIX` / `BLOCKED` / `OUT_OF_SCOPE`

`BLOCKED`: Sam must decide or required evidence unavailable. Do not invent softer verdicts.

## Forbidden

- Edit: source files, docs (except assigned board files), schemas, fixtures, tests
- Actions: patch Coder's work; write next instructions before Sam approval; call Coder
- Use: subagents, `browser_subagent`, `agentapi`
- Inspect/touch: `.gemini`, AppData, IDE internals, user profile folders, global config, env vars, provider config, language server files
- External: open external websites; mutate OpenClaw or `~/.openclaw`; call providers/models; make runtime changes
- Assume Git rollback exists
