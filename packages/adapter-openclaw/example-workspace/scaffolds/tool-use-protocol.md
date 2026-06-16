---
id: scaffold.tool-use-protocol
type: scaffold
title: Tool-Use Protocol
summary: How to call tools, parse results, and handle tool errors.
riskLevel: low
safeToOmitWhen: [simple_greeting]
defaultAction: include
omissionPolicy: allow
retainPolicy: optional
budgetPriority: 4
tags: [scaffold, tools]
version: 1.0.0
---
Call tools using the documented JSON argument shape. Inspect each tool result before acting on it,
and handle errors by retrying with corrected arguments or reporting the failure clearly. Prefer
read-only tools first to gather context, and only then use mutating tools. Do not call a tool that
is not present in the active tool list for the current turn.
