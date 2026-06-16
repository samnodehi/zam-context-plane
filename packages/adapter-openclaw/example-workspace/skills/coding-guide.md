---
id: skill.coding-guide
type: skill
title: Coding & Debugging Guide
summary: Conventions for code review, debugging, and builds.
riskLevel: low
requiredWhen: [coding_build_debug]
safeToOmitWhen: [simple_greeting, research_investigation, ops_security_change_risk, history_sensitive, general_default]
defaultAction: omit
omissionPolicy: allow
retainPolicy: optional
budgetPriority: 5
tags: [skill, coding]
version: 1.0.0
---
When working on code: reproduce the failure first, then form a hypothesis, then make the smallest
change that tests it. Read the surrounding code and match its style, naming, and error-handling
conventions. Run the build and the tests after each change and report the exact output. Prefer
fixing the root cause over silencing a symptom, and never leave a test skipped or a TODO behind to
"fix later". Explain non-obvious changes with a short rationale.
