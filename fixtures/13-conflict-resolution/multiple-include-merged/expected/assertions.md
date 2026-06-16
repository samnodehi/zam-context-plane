# Assertions: fixtures/13-conflict-resolution/multiple-include-merged/

## Purpose
Verify that multiple include decisions for the same component merge cleanly into a single final include.
Resolution must use resolutionRule: "multiple_include_merged".
The winning component must appear exactly once in selectedComponents[].
losingDecisions[] may be empty [] because all inputs are include decisions with no true loser.

## Zero-Tolerance Checks

1. conflictPhase.conflictResolutionTrace must contain exactly 1 entry for scaffold.system-rules
2. conflictResolutionTrace[0].resolutionRule must equal "multiple_include_merged"
3. conflictResolutionTrace[0].finalAction must equal "include"
4. conflictResolutionTrace[0].inputDecisionIds must contain at least 2 entries (both include decisions)
5. losingDecisions[] must NOT contain the winning decision (scaffold.system-rules include)
6. scaffold.system-rules must appear exactly once in prompt-plan.json selectedComponents[]
7. scaffold.system-rules must NOT appear in omittedComponents[] or deferredComponents[]
8. selectedComponents[] must have no duplicate componentId values
9. noConflictComponentIds.length (1) + conflictResolutionTrace.length (1) must equal candidateSetSize (2)
10. resolvedDecisions entry for scaffold.system-rules must have resolvedAt as integer
11. Multiple include decisions for scaffold.system-rules must be traceable in selectorTrace[] (2 entries with action: include)
12. resolutionRule must NOT be safety_hard_protection (no Priority 1 applies: riskLevel=low, retainPolicy=mandatory not safety_critical)
