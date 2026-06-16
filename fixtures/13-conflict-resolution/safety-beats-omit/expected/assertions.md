# Assertions: fixtures/13-conflict-resolution/safety-beats-omit/

## Purpose
Verify that a hard-protected component always wins over an omit decision during conflict resolution.
Resolution must use resolutionRule: "safety_hard_protection" and produce action: include, path: safety_override.
The omit decision must appear in losingDecisions[].
A safety-protected component must never appear in omittedComponents[].

## Zero-Tolerance Checks

1. conflictPhase.conflictResolutionTrace must contain exactly 1 entry for scaffold.safety-rules
2. conflictResolutionTrace[0].resolutionRule must equal "safety_hard_protection"
3. conflictResolutionTrace[0].finalAction must equal "include"
4. conflictResolutionTrace[0].finalPath must equal "safety_override"
5. conflictResolutionTrace[0].losingDecisions must be non-empty
6. conflictResolutionTrace[0].losingDecisions[0].action must equal "omit"
7. conflictResolutionTrace[0].losingDecisions[0].defeatedBy must equal "safety_hard_protection"
8. conflictResolutionTrace[0].warningsEmitted must contain "safety_override_omit_decision"
9. scaffold.safety-rules must NOT appear in prompt-plan.json omittedComponents[]
10. scaffold.safety-rules must appear in prompt-plan.json selectedComponents[] with path: "safety_override"
11. noConflictComponentIds.length (1) + conflictResolutionTrace.length (1) must equal candidateSetSize (2)
12. resolvedDecisions entry for scaffold.safety-rules must have resolvedAt as integer
