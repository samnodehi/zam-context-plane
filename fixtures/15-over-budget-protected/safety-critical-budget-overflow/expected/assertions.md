# assertions.md — fixtures/15-over-budget-protected/safety-critical-budget-overflow

## Purpose
Verify that when safety-critical and mandatory protected components together exceed the budget
target, budgetOverflow=true is explicit and required, protected components remain selected,
optional components are already selector-omitted via Path B (the Budgeter performs no actual trim
action), and planning completes without halting.

## Key Invariant
budgetOverflow is REQUIRED and EXPLICIT — it must be true, not absent or false, when selected
components exceed totalPromptTokenTarget. A plan that silently overflows without setting
budgetOverflow=true is a harness failure (zero tolerance per docs/12 §2.1).

## Registry
- scaffold.safety-critical-core: riskLevel=critical, omissionPolicy=never, retainPolicy=safety_critical, tokensApprox=700
- scaffold.mandatory-compliance: riskLevel=high, omissionPolicy=never, retainPolicy=mandatory, tokensApprox=500
- skill.optional-quick: riskLevel=low, retainPolicy=optional, omissionPolicy=allow, defaultAction=omit, tokensApprox=50

## Budget Context
- totalPromptTokenTarget: 1000
- Protected scaffolds combined: 700 + 500 = 1200 > 1000 → overflow unavoidable
- skill.optional-quick is already selector-omitted via Path B — Budgeter performed no actual trim action
- budgetCritical: true

## Required Assertions

### budgetOverflow assertions (critical)
1. budgetPhase.budgetOverflow MUST be true (REQUIRED boolean — not absent)
2. budgetReport.budgetOverflow MUST be true
3. budgetPhase.budgetOverflow MUST equal budgetReport.budgetOverflow exactly
4. prompt-plan.json budgetPlan.projectedOverflow MUST be 200 (1200 - 1000)
5. prompt-plan.json budgetPlan.selectedTokensApprox MUST be 1200 (protected scaffolds only — optional skill was never selected)
6. budgetOverflow=true is explicit and traceable — NOT silent or absent

### Protected component retention assertions
7. scaffold.safety-critical-core MUST appear in prompt-plan.json selectedComponents[]
8. scaffold.mandatory-compliance MUST appear in prompt-plan.json selectedComponents[]
9. Both protected scaffolds MUST appear in trace.json planPhase.selectedComponents[]
10. scaffold.safety-critical-core action MUST be "include"
11. scaffold.mandatory-compliance action MUST be "include"
12. scaffold.safety-critical-core MUST NOT appear in trimActions[]
13. scaffold.mandatory-compliance MUST NOT appear in trimActions[]
14. Neither protected scaffold MUST appear in omittedComponents[]
15. Neither protected scaffold MUST appear in deferredComponents[]

### Optional skill selector-omit assertions (overflow persists)
16. skill.optional-quick MUST appear in prompt-plan.json omittedComponents[]
17. skill.optional-quick action MUST be "omit"
18. skill.optional-quick path MUST be "default_action_omit"
19. skill.optional-quick is already selector-omitted via Path B (default_action_omit) — the Budgeter received finalAction="omit" in its ResolvedSelectionDecision input
20. The Budgeter performs NO actual trim action for skill.optional-quick — it was not include-resolved; there is nothing for the Budgeter to trim
21. budgetPhase.trimActions[] MUST be [] (empty array) — no actual Budgeter trim action occurred
22. trimming skill.optional-quick (50 tokens) would NOT resolve overflow regardless — overflow persists from protected components (1200 > 1000 after removing 50 still leaves 1200 protected)

### trim candidate record assertions
23. budgetReport.trimOrder[] MUST contain skill.optional-quick
24. budgetReport.trimOrder[].componentId MUST be "skill.optional-quick"
25. budgetReport.trimOrder[].budgetHint MUST be "candidate_optional"
26. budgetReport.trimOrder[].tokensApprox MUST be 50
27. trimOrder[] records that the Budgeter identified skill.optional-quick as the first trim candidate / considered order — this is a candidate consideration record, not a performed trim action
28. trimOrder[] and trimActions[] have different semantics: trimOrder[] = candidates the Budgeter considered; trimActions[] = trim actions actually performed

### Warning and risk flag assertions
29. selectorPhase.planningWarnings MUST contain code "over_budget_protected" referencing the protected scaffolds
30. planPhase.riskFlags MUST contain "budget_infeasible_protected_component" entries for both protected scaffolds
31. budgetReport.overBudgetProtectedWarnings[] MUST contain entries for both:
    - scaffold.safety-critical-core: tokensApprox=700, thresholdCrossed="totalPromptTokenTarget", applicableBudgetLimit=1000
    - scaffold.mandatory-compliance: tokensApprox=500, thresholdCrossed="totalPromptTokenTarget", applicableBudgetLimit=1000

### Plan completion assertions
32. Plan output MUST be present and complete — planning MUST NOT halt
33. All 3 candidates MUST appear in exactly one partition
34. Gap-check: noConflictComponentIds.length + conflictResolutionTrace.length == candidateSetSize (3 == 3)
35. noConflictComponentIds[] MUST contain all 3 component IDs (no conflicts in this fixture)

### Budget behavior semantics
36. budgetOverflow=true is required and must be EXPLICIT — never absent or silent
37. Protected components are preserved even when over budget — overflow is safer than unsafe omission
38. trimActions[] is for Budgeter-performed trim actions only — components already selector-omitted via Path B must not appear in trimActions[]
39. Protected components with budgetHint=over_budget_protected MUST NOT appear in trimActions[]
40. trimActions[].budgetHint MUST be restricted to "candidate_optional" or "expensive_optional" only (when trimActions[] is non-empty)

### Schema compliance
41. prompt-plan.json MUST be structurally valid against prompt-plan.schema.json
42. trace.json MUST be structurally valid against trace.schema.json
43. component-registry.json MUST use "id" field — NOT "componentId"
44. budgetPhase.trimActions[] MUST be present (required array — empty array is valid)
45. budgetPhase.budgetOverflow MUST be present and boolean (true — required field)
46. budgetReport.budgetOverflow MUST be present and boolean (true — required field)
47. All resolvedAt values in conflictPhase.resolvedDecisions MUST be integers (not ISO strings)
