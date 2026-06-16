# Assertions — 02-fail-open-low-confidence

## Fixture Purpose
Validates that a low-confidence classification correctly triggers fail-open (Tier 3) even when the assessed risk level is "low". This enforces the fail-open semantic from docs/15 §6.

## Expected Properties
- `tier` is 3 (fail-open expands context to maximum)
- `analyzerConfidence` is <= 0.5 (below confidence threshold)
- `assessedRequestRiskLevel` is "low" — the trigger is confidence, not risk
- `failOpenTriggered` is true
- `failOpenReason` is a non-null, non-empty string describing the cause
- `neededLanes` may be empty (low confidence = uncertain about needs)

## Schema Invariants Checked
- All required fields from `schemas/future/analyzer-output.schema.json` are present
- `failOpenTriggered: true` with non-null `failOpenReason`
- `tier: 3` is within the allowed range [0, 3]
