---
id: tool.read-file
type: tool
title: read_file
summary: Read a file from the workspace.
riskLevel: low
safeToOmitWhen: [simple_greeting]
defaultAction: include
omissionPolicy: allow
retainPolicy: optional
budgetPriority: 4
tags: [tool, fs]
version: 1.0.0
---
read_file(path: string) -> string. Returns the UTF-8 contents of a file inside the workspace.
Read-only and safe to call freely to gather context before acting. Errors if the path is outside
the workspace or does not exist.
