---
id: skill.ops-change-safety
type: skill
title: Ops Change-Safety Checklist
summary: Pre-flight checklist for production changes, deletions, and credential handling.
riskLevel: medium
requiredWhen: [ops_security_change_risk]
safeToOmitWhen: [simple_greeting, coding_build_debug, research_investigation, history_sensitive, general_default]
defaultAction: omit
omissionPolicy: allow
retainPolicy: optional
budgetPriority: 5
tags: [skill, ops]
version: 1.0.0
---
Before any production-affecting change: confirm the blast radius, confirm a rollback path exists,
and confirm the change is reversible or backed up. For deletions, verify the target and prefer a
soft delete or archive first. Never handle raw credentials in plaintext or echo them; use the
secret store. State the risk and ask for explicit confirmation before executing an irreversible or
outward-facing action.
