# Assertions: fixtures/13-conflict-resolution/path-a-beats-path-b-omit/

## Purpose
Verify conflict between Path A omit (safe_to_omit_match) and Path B omit (default_action_omit) resolves to Path A.
Path A has stronger positive evidence and must win. Resolution uses resolutionRule: "path_a_omit_selected_over_path_b".

## Zero-Tolerance Checks

1. conflictPhase.conflictResolutionTrace must contain exactly 1 entry for skill.proactive-tips
2. conflictResolutionTrace[0].resolutionRule must equal "path_a_omit_selected_over_path_b"
3. conflictResolutionTrace[0].finalAction must equal "omit"
4. conflictResolutionTrace[0].finalPath must equal "safe_to_omit_match"
5. conflictResolutionTrace[0].losingDecisions must be non-empty
6. conflictResolutionTrace[0].losingDecisions[0].path must equal "default_action_omit" (Path B is the loser)
7. conflictResolutionTrace[0].losingDecisions[0].defeatedBy must equal "path_a_omit_selected_over_path_b"
8. skill.proactive-tips must appear in prompt-plan.json omittedComponents[] with path: "safe_to_omit_match"
9. skill.proactive-tips must NOT appear in selectedComponents[] or deferredComponents[]
10. omit decision evidence in selectorTrace must be non-empty for the Path A decision
11. noConflictComponentIds.length (1) + conflictResolutionTrace.length (1) must equal candidateSetSize (2)
12. resolvedDecisions entry for skill.proactive-tips must have resolvedAt as integer
