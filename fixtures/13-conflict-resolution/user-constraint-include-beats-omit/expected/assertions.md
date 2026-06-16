# Assertions: fixtures/13-conflict-resolution/user-constraint-include-beats-omit/

## Purpose
Verify that userConstraints.alwaysInclude wins over a Path A omit decision during conflict resolution.
Resolution must use resolutionRule: "user_constraint_include" and produce action: include.
This is NOT a reference_unknown case — skill.code-review exists in the registry.
alwaysInclude forces include even when the selector would omit via Path A.

## Zero-Tolerance Checks

1. conflictPhase.conflictResolutionTrace must contain exactly 1 entry for skill.code-review
2. conflictResolutionTrace[0].resolutionRule must equal "user_constraint_include"
3. conflictResolutionTrace[0].finalAction must equal "include"
4. conflictResolutionTrace[0].losingDecisions must be non-empty
5. conflictResolutionTrace[0].losingDecisions[0].action must equal "omit"
6. conflictResolutionTrace[0].losingDecisions[0].defeatedBy must equal "user_constraint_include"
7. skill.code-review must NOT appear in prompt-plan.json omittedComponents[]
8. skill.code-review must appear in prompt-plan.json selectedComponents[]
9. noConflictComponentIds.length (1) + conflictResolutionTrace.length (1) must equal candidateSetSize (2)
10. No reference_unknown action or path appears anywhere in the trace for skill.code-review
11. resolvedDecisions entry for skill.code-review must have resolvedAt as integer
12. alwaysInclude constraint source must be traceable in selectorTrace evidence for skill.code-review
