# assertions.md — fixtures/15-over-budget-protected/warn-only-no-trim

## Purpose
Verify that a protected component whose tokensApprox exceeds totalPromptTokenTarget triggers
the over_budget_protected warning and emits the budget_infeasible_protected_component risk flag,
but remains in selectedComponents[]. The Budgeter must not trim it. Planning must not halt.

## Canonical Policy
over_budget_protected is WARN-ONLY in MVP. Planning halt is explicitly rejected (docs/06 §25.2).
No trim, no omit, no defer, no halt occurs for over_budget_protected components.

## Registry
- scaffold.mandatory-rules: riskLevel=critical, omissionPolicy=never, retainPolicy=safety_critical, tokensApprox=900
- skill.greeting-skill: riskLevel=low, retainPolicy=optional, requiredWhen=[general_default], tokensApprox=80

## Budget Context
- totalPromptTokenTarget: 800
- scaffold.mandatory-rules (900) > totalPromptTokenTarget (800) → over_budget_protected condition met
- budgetCritical: true

## Required Assertions

### Protected component retention assertions
1. scaffold.mandatory-rules MUST appear in prompt-plan.json selectedComponents[]
2. scaffold.mandatory-rules MUST appear in trace.json planPhase.selectedComponents[]
3. scaffold.mandatory-rules action MUST be "include"
4. scaffold.mandatory-rules path MUST be "safety_override"
5. scaffold.mandatory-rules MUST NOT appear in prompt-plan.json omittedComponents[]
6. scaffold.mandatory-rules MUST NOT appear in prompt-plan.json deferredComponents[]
7. scaffold.mandatory-rules MUST NOT appear in budgetPhase.trimActions[]
8. scaffold.mandatory-rules MUST NOT appear in budgetReport.trimOrder[]

### Warning and risk flag assertions
9. selectorPhase.planningWarnings MUST contain code "over_budget_protected" for scaffold.mandatory-rules
10. planPhase.riskFlags MUST contain a string referencing "budget_infeasible_protected_component"
11. budgetReport.overBudgetProtectedWarnings[] MUST contain scaffold.mandatory-rules entry with:
    - tokensApprox: 900
    - thresholdCrossed: "totalPromptTokenTarget"
    - applicableBudgetLimit: 800
12. selectorTrace for scaffold.mandatory-rules MUST include evidence atoms:
    - "budgetHint=over_budget_protected"
    - "thresholdCrossed=totalPromptTokenTarget"
    - "applicableBudgetLimit=800"
    - "tokensApproxObserved=900"
    - "riskFlag=budget_infeasible_protected_component"
    - "actionChanged=false"

### Budget accounting assertions
13. budgetPhase.budgetOverflow MUST be true (980 selected tokens > 800 target)
14. budgetReport.budgetOverflow MUST be true
15. budgetPhase.budgetOverflow MUST equal budgetReport.budgetOverflow
16. budgetReport.budgetPlan.selectedTokensApprox MUST be 980 (900 + 80)
17. budgetReport.budgetPlan.projectedOverflow MUST be 180 (980 - 800)
18. budgetReport.trimOrder[] MUST be empty (no trim candidates — both components are selected)
19. budgetPhase.trimActions[] MUST be empty [] (no trim performed)

### No-halt assertions
20. Planning MUST NOT halt due to over_budget_protected (warn-only MVP policy)
21. Plan output MUST be present (no absent/null plan)
22. skill.greeting-skill MUST also appear in selectedComponents[] — planning continued

### Partition integrity assertions
23. Every candidate must appear in exactly one partition
24. Gap-check: noConflictComponentIds.length + conflictResolutionTrace.length == candidateSetSize (2 == 2)
25. noConflictComponentIds[] MUST contain both component IDs

### Budget behavior semantics
26. over_budget_protected is WARN-ONLY — it MUST NOT authorize trimming
27. over_budget_protected MUST NOT change action or path of the protected component
28. over_budget_protected budgetHint MUST NOT appear in trimActions[].budgetHint
   (trimActions[].budgetHint is restricted to candidate_optional and expensive_optional only)
29. selected membership of scaffold.mandatory-rules is PRESERVED despite budget overflow
30. A future halt_planning option is deferred — not implemented in MVP

### Schema compliance
31. prompt-plan.json MUST be structurally valid against prompt-plan.schema.json
32. trace.json MUST be structurally valid against trace.schema.json
33. component-registry.json MUST use "id" field — NOT "componentId"
34. budgetPhase.trimActions[] MUST be present (required array — empty in this case)
35. budgetPhase.budgetOverflow MUST be present and boolean (true)
36. budgetReport.budgetOverflow MUST be present and boolean (true)
