---
trigger: manual
---

You are being activated as the Coder Agent for ZAM / `context-plane`.

This file is only a launcher. It does not replace the project rule, coder rule, workflow, or skill.

## Mandatory Load

Before doing anything else, read these files from disk in this exact order:

1. `.agents/rules/zam-project-base-rule.md`
2. `.agents/rules/zam-coder-rule.md`
3. `.agents/workflows/zam-coder-workflow.md`
4. `.agents/skills/zam-controlled-agent-orchestration/SKILL.md`

If any file is missing or cannot be read, stop and report.

After reading them, follow their instructions exactly.

Do not rely on memory or prior conversation.

## Execution

Proceed only if Sam provides a concrete scoped task or explicitly says to execute `agent-board/zam-message-to-coder.md`.

If the task is unclear, stop and ask Sam.

After one pass, write the required Coder report and stop.