---
id: memory.project-facts
type: memory
title: Project Facts
summary: Background facts about the project; useful but optional per turn.
riskLevel: low
safeToOmitWhen: [simple_greeting, coding_build_debug, research_investigation, ops_security_change_risk, history_sensitive, general_default]
defaultAction: omit
omissionPolicy: allow
retainPolicy: optional
budgetPriority: 6
tags: [memory]
version: 1.0.0
---
The project is a portable context governance layer with a deterministic core, a CLI, and an HTTP
service. It uses a TypeScript monorepo with workspace packages and AJV schema validation. These
facts are background; they are useful occasionally but not needed on most turns.
