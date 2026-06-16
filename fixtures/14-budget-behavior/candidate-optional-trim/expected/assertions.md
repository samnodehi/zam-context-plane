# assertions.md — fixtures/14-budget-behavior/candidate-optional-trim

## Purpose
Verify a low-risk optional component with budgetHint: "candidate_optional" is correctly
classified and identified as a trim candidate by the Budgeter under budget pressure, while the
protected scaffold component is unaffected. The optional component is already omitted by the
selector via Path B (default_action_omit) — the Budgeter performs no actual trim action.

## Registry
- scaffold.system-rules: riskLevel=critical, omissionPolicy=never, retainPolicy=safety_critical (hard protected)
- skill.optional-helper: riskLevel=low, retainPolicy=optional, omissionPolicy=allow, defaultAction=omit, tokensApprox=300 (< 500 threshold → candidate_optional)

## Budget Context
- totalPromptTokenTarget: 500
- budgetCritical: true (budget pressure active)

## Required Assertions

### Protected component assertions
1. scaffold.system-rules MUST appear in prompt-plan.json selectedComponents[]
2. scaffold.system-rules MUST appear in trace.json planPhase.selectedComponents[]
3. scaffold.system-rules action MUST be "include"
4. scaffold.system-rules path MUST be "safety_override"
5. scaffold.system-rules MUST NOT appear in trimActions[]
6. scaffold.system-rules MUST NOT appear in budgetReport.trimOrder[]
7. scaffold.system-rules MUST have budgetHint="protected" in selectorTrace evidence (not candidate_optional or expensive_optional)

### Optional candidate selector-omit assertions
8. skill.optional-helper MUST appear in prompt-plan.json omittedComponents[]
9. skill.optional-helper MUST appear in trace.json planPhase.omittedComponents[]
10. skill.optional-helper action MUST be "omit"
11. skill.optional-helper path MUST be "default_action_omit"
12. skill.optional-helper is already selector-omitted via Path B (default_action_omit) — the Budgeter received finalAction="omit" in its ResolvedSelectionDecision input
13. The Budgeter performs NO actual trim action for skill.optional-helper — it was not include-resolved; there is nothing for the Budgeter to trim
14. budgetPhase.trimActions[] MUST be [] (empty array) — no actual Budgeter trim action occurred

### trim candidate record assertions
15. budgetReport.trimOrder[] MUST be non-empty and contain skill.optional-helper
16. budgetReport.trimOrder[].componentId MUST be "skill.optional-helper"
17. budgetReport.trimOrder[].budgetHint MUST be "candidate_optional"
18. budgetReport.trimOrder[].tokensApprox MUST be 300
19. trimOrder[] records that the Budgeter identified skill.optional-helper as the trim candidate — this is a candidate consideration record, not a performed trim action

### Budget accounting assertions
20. budgetPhase.budgetOverflow MUST be false (350 selected tokens < 500 target)
21. budgetReport.budgetOverflow MUST be false
22. budgetPhase.budgetOverflow MUST equal budgetReport.budgetOverflow
23. budgetReport.budgetPlan.selectedTokensApprox MUST be 350 (scaffold only — optional was never selected)
24. budgetReport.budgetPlan.projectedOverflow MUST be 0

### Partition integrity assertions
25. Every candidate must appear in exactly one of: selectedComponents, omittedComponents, deferredComponents
26. No component may appear in more than one partition
27. Gap-check: noConflictComponentIds.length + conflictResolutionTrace.length == candidateSetSize (2 == 2)
28. noConflictComponentIds[] MUST contain both component IDs (no conflicts in this fixture)

### Budget behavior semantics
29. Budget pressure (budgetCritical=true) MUST appear in planningWarnings with code "budget_pressure_seen"
30. Budget pressure MUST NOT change scaffold.system-rules action or path
31. Budget pressure CANNOT authorize a new omit path; Path B (default_action_omit) was the selector's decision
32. trimActions[] is for Budgeter-performed trim actions only — components already selector-omitted via Path B must not appear in trimActions[]
33. trimOrder[] and trimActions[] have different semantics: trimOrder[] = candidates the Budgeter considered; trimActions[] = trim actions actually performed
34. runtime_unavailable defer decisions MUST NOT appear in trimActions[] (not applicable to this fixture)

### Schema compliance
35. prompt-plan.json MUST be structurally valid against prompt-plan.schema.json
36. trace.json MUST be structurally valid against trace.schema.json
37. component-registry.json MUST use "id" field — NOT "componentId" — for component identity
38. All component-registry.json input objects MUST use "id" as the identifier field
39. trimActions[].budgetHint MUST be restricted to "candidate_optional" or "expensive_optional" only (when trimActions[] is non-empty)
40. budgetPhase.trimActions[] MUST be present (required array — empty array is valid)
41. budgetPhase.budgetOverflow MUST be present and boolean (required field)
