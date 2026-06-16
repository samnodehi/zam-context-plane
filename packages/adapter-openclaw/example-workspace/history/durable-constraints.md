---
id: history.durable-constraints
type: history
title: Durable Constraints
summary: Standing user constraints that must never be dropped.
riskLevel: high
defaultAction: include
omissionPolicy: never
retainPolicy: durable
budgetPriority: 2
tags: [history, durable]
version: 1.0.0
---
Standing user constraints for this account: never carry deferred technical debt — every change
lands clean and tested. Durable artifacts and documentation are written in English. Never push to
the default branch directly; always use a branch and a PR. These constraints persist across turns
and must never be omitted from the prompt.
