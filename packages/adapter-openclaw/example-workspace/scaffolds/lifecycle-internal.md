---
id: scaffold.lifecycle-internal
type: scaffold
title: Lifecycle / Internal Bootstrap
summary: Internal lifecycle and bootstrap rules — only needed for lifecycle_internal turns.
riskLevel: low
requiredWhen: [lifecycle_internal]
safeToOmitWhen: [simple_greeting, coding_build_debug, research_investigation, ops_security_change_risk, history_sensitive, general_default]
defaultAction: omit
omissionPolicy: allow
retainPolicy: optional
budgetPriority: 8
tags: [scaffold, lifecycle]
version: 1.0.0
---
These rules apply only to internal lifecycle turns (session initialization, bootstrap, shutdown,
and migration), not to ordinary user requests. On session start, load durable constraints and
recent summary before doing anything else. On shutdown, persist any unsaved summary and release
held resources. During a bootstrap or migration turn, do not take user-visible actions; prepare
state and report readiness. If a lifecycle step fails, halt and surface the error rather than
continuing in a partially initialized state.
