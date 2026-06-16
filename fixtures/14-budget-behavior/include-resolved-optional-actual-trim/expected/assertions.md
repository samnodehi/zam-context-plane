# assertions.md — fixtures/14-budget-behavior/include-resolved-optional-actual-trim

## Purpose
Verify that an include-resolved optional component (not selector-omitted) is actually trimmed by the
Budgeter when budget pressure requires it, and that the trimmed component appears in the final output
`omittedComponents[]` with `action: "omit"` and `path: "budget_trim"`. This is the first fixture to
exercise a non-empty `budgetPhase.trimActions[]` and the `budget_trim` output partition path.

## Scenario
- `scaffold.system-core`: riskLevel=critical, omissionPolicy=never, retainPolicy=safety_critical,
  defaultAction=include, tokensApprox=700 — hard-protected; selector includes via safety_override.
- `skill.deep-explainer`: riskLevel=low, retainPolicy=optional, omissionPolicy=allow,
  defaultAction=include, tokensApprox=650 — include-resolved by selector (default_include);
  budgetHint: expensive_optional (650 >= 500 threshold); actually trimmed by Budgeter.

## Token / Budget Math
- totalPromptTokenTarget: 800
- Pre-trim selected total: 700 + 650 = 1350 tokens
- Projected overflow: 1350 − 800 = 550 tokens
- Budgeter trims skill.deep-explainer: 650 tokensDropped
- Post-trim selected total: 700 tokens
- budgetOverflow: false (700 <= 800)

## Required Assertions

### A. Selector / Resolver Precondition

1. skill.deep-explainer selector action MUST be "include" in trace.selectorPhase.selectorTrace[]
2. skill.deep-explainer selector path evidence MUST include "default_include" — NOT "budget_trim"
3. skill.deep-explainer resolved finalAction MUST be "include" in conflictPhase.resolvedDecisions[]
4. skill.deep-explainer resolved finalPath MUST be "default_include" — NOT "budget_trim"
5. "budget_trim" MUST NOT appear anywhere in selectorPhase.selectorTrace[] path or evidence fields
6. "budget_trim" MUST NOT appear in conflictPhase.resolvedDecisions[].finalPath
7. skill.deep-explainer was include-resolved before the Budgeter received its ResolvedSelectionDecision

### B. Actual Trim Occurred

8. trace.budgetPhase.trimActions[] MUST contain exactly one entry
9. trimActions[0].componentId MUST be "skill.deep-explainer"
10. trimActions[0].budgetHint MUST be "expensive_optional"
11. trimActions[0].tokensDropped MUST be 650
12. trimActions[0].reason MUST be a non-empty string (no raw component content)
13. budgetReport.trimOrder[] MUST contain one entry for skill.deep-explainer
14. trimOrder[0].budgetHint MUST be "expensive_optional"
15. trimOrder[0].tokensApprox MUST be 650

### C. Budget Trim Output Placement

16. skill.deep-explainer MUST NOT appear in prompt-plan.json selectedComponents[]
17. skill.deep-explainer MUST NOT appear in prompt-plan.json deferredComponents[]
18. skill.deep-explainer MUST appear in prompt-plan.json omittedComponents[]
19. prompt-plan.json omittedComponents[0].componentId MUST be "skill.deep-explainer"
20. prompt-plan.json omittedComponents[0].action MUST be "omit"
21. prompt-plan.json omittedComponents[0].path MUST be "budget_trim"
22. trace.json planPhase.omittedComponents[0].componentId MUST be "skill.deep-explainer"
23. trace.json planPhase.omittedComponents[0].action MUST be "omit"
24. trace.json planPhase.omittedComponents[0].path MUST be "budget_trim"
25. prompt-plan and trace planPhase omittedComponents MUST match (same componentId, action, path)

### D. No Leakage

26. "budget_trim" MUST NOT appear in any selectorTrace[] entry (action, reason, evidence, or path fields)
27. "budget_trim" MUST NOT appear in any resolvedDecisions[].finalPath
28. "budget_trim" MUST NOT appear in any conflictResolutionTrace[] path field
29. "budget_trim" MUST NOT appear in selectedComponents[] or deferredComponents[] in either output file
30. The shared SelectionPath enum semantics are not changed by this fixture — budget_trim is a PPG output assignment only

### E. Budget Accounting

31. budgetReport.budgetPlan.selectedTokensApprox MUST be 1350 (pre-trim: scaffold 700 + skill 650)
32. budgetReport.budgetPlan.projectedOverflow MUST be 550 (pre-trim check: 1350 − 800)
33. prompt-plan.json budgetPlan.selectedTokensApprox MUST be 1350 (pre-trim mirror)
34. prompt-plan.json budgetPlan.projectedOverflow MUST be 550
35. prompt-plan.json estimatedTokens.total MUST be 700 (post-trim final plan total)
36. budgetReport.budgetOverflow MUST be false (post-trim: 700 <= 800)
37. budgetPhase.budgetOverflow MUST be false
38. budgetPhase.budgetOverflow MUST equal budgetReport.budgetOverflow

### F. Partition Invariant

39. Every candidate must appear in exactly one partition (selected OR omitted OR deferred)
40. scaffold.system-core: selected only
41. skill.deep-explainer: omitted only (path: budget_trim)
42. No component missing from all partitions
43. Gap-check: noConflictComponentIds.length + conflictResolutionTrace.length == candidateSetSize (2 == 2)
44. deferredComponents[] MUST be empty (no runtime unavailability involved)
45. reference_unknown MUST NOT appear in any partition array

### G. Regression Guard

46. "trimActionsPerformed" MUST NOT appear anywhere in trace.json or prompt-plan.json
47. scaffold.system-core MUST NOT appear in trimActions[] (protected component — never trim-eligible)
48. scaffold.system-core MUST NOT appear in budgetReport.trimOrder[] (protected budgetHint: protected)
49. selector-omitted components (those with finalAction="omit" from resolver) MUST NOT appear in trimActions[]
50. skill.deep-explainer was include-resolved (finalAction="include") — the Budgeter's trim is the only reason it appears in omittedComponents[]

### H. Schema Compliance

51. prompt-plan.json MUST be structurally valid against prompt-plan.schema.json
52. trace.json MUST be structurally valid against trace.schema.json
53. component-registry.json MUST use "id" field — NOT "componentId"
54. trimActions[].budgetHint MUST be "candidate_optional" or "expensive_optional" (restricted enum)
55. budgetPhase.trimActions[] MUST be present (required array — non-empty for this fixture)
56. budgetPhase.budgetOverflow MUST be present and boolean (required field)
57. "budget_trim" is schema-valid in omittedComponents[].path (added by Pass 4.9D-2AB)
58. "budget_trim" is schema-invalid in selectedComponents[].path and deferredComponents[].path
