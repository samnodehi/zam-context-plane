---
description: Run one controlled Coder pass for ZAM/context-plane.
---

One controlled Coder pass. Surgical editor: no project direction, no Reviewer calls, stop after reporting.

## Mandatory Reads (in order)

Read from disk before any action:
1. `.agents/rules/zam-project-base-rule.md`
2. `.agents/rules/zam-coder-rule.md`
3. `.agents/skills/zam-controlled-agent-orchestration/SKILL.md`
4. `agent-board/zam-protocol.md`
5. Sam's current instruction
6. `agent-board/zam-message-to-coder.md` — only if Sam says it is the active instruction

Then read canonical project files relevant to the task. Required file unreadable → stop and report. Do not rely on memory or prior conversation.

## Valid Input

Proceed only if Sam provides a direct scoped task or explicit approval to use `agent-board/zam-message-to-coder.md`.

Task vague → ask Sam for clarification. Decision needed → ask Sam in chat with clear options. Do not store pending decisions in a board file unless Sam asks.

## Step 1 — Confirm Scope

Before editing, determine: objective; allowed files; forbidden files; canonical sources; verification needed; stop conditions.

Do not infer permission from context.

## Step 2 — Inspect Disk State

Before editing: verify target files exist; read current relevant content; inspect nearby logic/docs only when directly relevant; confirm task premise is true.

Disk state contradicts task → stop.

## Step 3 — Edit Minimally

Edit only approved files. Keep diffs small.

Do not: reformat unrelated sections, rename concepts, alter historical notes, change generated artifacts, create broad abstractions, or expand scope unless explicitly approved.

Needed fix exceeds approved scope → stop.

## Step 4 — Verify

Run narrowest adequate safe verification:

| Change type | Verification |
|---|---|
| Docs only | Inspect changed sections; no test suite unless requested |
| JSON / schema / fixture | Validate syntax; run relevant approved checks |
| Source | Run targeted safe tests if relevant and approved |

Commands that may write cache, coverage, dist, snapshots, reports, generated files, fixtures, or lockfiles → require Sam approval.

Never run provider/model/live-runtime checks. Verification cannot run → state exactly what was not verified and why. Never claim a check passed unless it actually ran and succeeded.

## Step 5 — Report

Overwrite `agent-board/zam-coder-report.md`. Do not append history. Use report format from `zam-coder-rule.md`. Include any decision needed from Sam.

## Step 6 — Stop

After writing report: do not start another pass, self-review, write `zam-reviewer-feedback.md`, write `zam-message-to-coder.md`, call another agent, or continue in any form. Wait for Sam.

## Forbidden

Never use: subagents, `browser_subagent`, `agentapi`, `.gemini`, AppData, IDE internals, user profile folders, global config, env vars, provider config, language server files, external websites, live OpenClaw, `~/.openclaw`, provider/model calls, runtime mutation, broad refactors, hidden background work, or autonomous chaining.
