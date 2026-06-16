---
id: tool.run-shell
type: tool
title: run_shell
summary: Execute a shell command (higher-risk; not injected by default).
riskLevel: medium
defaultAction: omit
omissionPolicy: allow
retainPolicy: optional
budgetPriority: 6
tags: [tool, shell]
version: 1.0.0
---
run_shell(command: string) -> { stdout, stderr, exitCode }. Executes a shell command in the
workspace. Higher-risk: can modify the filesystem and run arbitrary programs. Not injected by
default — only surfaced when the request clearly needs command execution. Never run destructive
commands without explicit user confirmation.
