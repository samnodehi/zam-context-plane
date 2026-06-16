# assertions.md — fixtures/14-budget-behavior/expensive-optional-trim

## Purpose
Verify an optional component above the canonical expensive_optional threshold (>= 500 tokens)
is correctly classified as expensive_optional and identified as the first trim candidate by the
Budgeter under budget pressure. The optional component is already omitted by the selector via
Path B (default_action_omit) — the Budgeter performs no actual trim action.

## Canonical Threshold
- expensive_optional threshold: 500 approximate tokens (docs/06 §23.2)
- This is a static MVP threshold — not configurable per run or per component type
- Rule applied: tokensApprox >= 500 → budgetHint: expensive_optional

## Registry
- scaffold.core-policy: riskLevel=critical, omissionPolicy=never, retainPolicy=safety_critical (hard protected; budgetHint: protected)
- skill.large-optional-skill: riskLevel=low, retainPolicy=optional, omissionPolicy=allow, defaultAction=omit, tokensApprox=900 (>= 500 → expensive_optional)

## Budget Context
- totalPromptTokenTarget: 600
- budgetCritical: true (budget pressure active)
- large-optional-skill alone (900 tokens) exceeds target (600) — confirms expensive_optional classification rationale

## Required Assertions

### Protected component assertions
1. scaffold.core-policy MUST appear in prompt-plan.json selectedComponents[]
2. scaffold.core-policy MUST appear in trace.json planPhase.selectedComponents[]
3. scaffold.core-policy action MUST be "include"
4. scaffold.core-policy path MUST be "safety_override"
5. scaffold.core-policy MUST NOT appear in trimActions[]
6. scaffold.core-policy MUST NOT appear in budgetReport.trimOrder[]
7. scaffold.core-policy budgetHint MUST be "protected" (not expensive_optional or any trim-eligible value)

### Expensive optional selector-omit assertions
8. skill.large-optional-skill MUST appear in prompt-plan.json omittedComponents[]
9. skill.large-optional-skill MUST appear in trace.json planPhase.omittedComponents[]
10. skill.large-optional-skill action MUST be "omit"
11. skill.large-optional-skill path MUST be "default_action_omit"
12. skill.large-optional-skill is already selector-omitted via Path B (default_action_omit) — the Budgeter received finalAction="omit" in its ResolvedSelectionDecision input
13. The Budgeter performs NO actual trim action for skill.large-optional-skill — it was not include-resolved; there is nothing for the Budgeter to trim
14. budgetPhase.trimActions[] MUST be [] (empty array) — no actual Budgeter trim action occurred
15. selectorTrace evidence for skill.large-optional-skill MUST include "budgetHint=expensive_optional"
16. selectorTrace evidence MUST include threshold reference: "thresholdUsed=500" or "high_token_estimate"

### trim candidate record assertions
17. budgetReport.trimOrder[] MUST contain skill.large-optional-skill
18. budgetReport.trimOrder[].componentId MUST be "skill.large-optional-skill"
19. budgetReport.trimOrder[].budgetHint MUST be "expensive_optional"
20. budgetReport.trimOrder[].tokensApprox MUST be 900
21. trimOrder[] records that the Budgeter identified skill.large-optional-skill as the trim candidate and would prioritize it first (expensive_optional before candidate_optional) — this is a candidate consideration record, not a performed trim action
22. expensive_optional classification remains valid: tokensApprox=900 >= 500 threshold AND retainPolicy=optional AND no hard protection markers

### Threshold application assertions
23. expensive_optional requires: retainPolicy=optional AND tokensApprox >= 500 AND no hard protection markers
24. expensive_optional MUST NOT be assigned to scaffold.core-policy (riskLevel=critical — hard protected)
25. expensive_optional MUST NOT be assigned to any component with retainPolicy=mandatory, durable, or safety_critical
26. expensive_optional MUST NOT be assigned when tokensApprox < 500 (use candidate_optional instead)
27. expensive_optional threshold MUST be 500 (static MVP value — not configurable)
28. No live tokenizer calls may be used to compute tokensApprox — only pre-computed registry metadata

### Budget accounting assertions
29. budgetPhase.budgetOverflow MUST be false (400 selected tokens < 600 target)
30. budgetReport.budgetOverflow MUST be false
31. budgetPhase.budgetOverflow MUST equal budgetReport.budgetOverflow
32. budgetReport.budgetPlan.selectedTokensApprox MUST be 400 (scaffold only — expensive optional was never selected)
33. budgetReport.budgetPlan.projectedOverflow MUST be 0

### Partition integrity assertions
34. Every candidate must appear in exactly one partition
35. Gap-check: noConflictComponentIds.length + conflictResolutionTrace.length == candidateSetSize (2 == 2)

### Budget behavior semantics
36. expensive_optional trim CANNOT override protected or mandatory component retention
37. expensive_optional trim CANNOT override safety_critical retention
38. expensive_optional is prioritized for trimming before candidate_optional at equal budgetPriority (per docs/06 §27.5) — this ordering is reflected in trimOrder[]
39. Budget pressure (budgetCritical=true) MUST appear in planningWarnings
40. trimActions[] is for Budgeter-performed trim actions only — components already selector-omitted via Path B must not appear in trimActions[]
41. trimOrder[] and trimActions[] have different semantics: trimOrder[] = candidates the Budgeter considered; trimActions[] = trim actions actually performed

### Schema compliance
42. prompt-plan.json MUST be structurally valid against prompt-plan.schema.json
43. trace.json MUST be structurally valid against trace.schema.json
44. component-registry.json MUST use "id" field — NOT "componentId"
45. trimActions[].budgetHint MUST be restricted to "candidate_optional" or "expensive_optional" only (when trimActions[] is non-empty)
46. budgetPhase.trimActions[] MUST be present (required array — empty array is valid)
47. budgetPhase.budgetOverflow MUST be present and boolean (required field)
