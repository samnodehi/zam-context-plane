# Assertions — 03-high-risk-expansion

## Fixture Purpose
Validates that a "critical" assessedRequestRiskLevel unconditionally triggers fail-open (Tier 3), even when analyzerConfidence is high (0.9). This enforces the safety-first semantic from docs/15 §6.

## Expected Properties
- `tier` is 3 — critical risk always expands to maximum context
- `analyzerConfidence` is >= 0.8 (high, but irrelevant for fail-open decision)
- `assessedRequestRiskLevel` is "critical" — the trigger for fail-open, not confidence
- `failOpenTriggered` is true
- `failOpenReason` is non-null, referencing the critical risk level
- `neededLanes` is non-empty — critical requests expand all relevant lanes

## Schema Invariants Checked
- All required fields from `schemas/future/analyzer-output.schema.json` are present
- `assessedRequestRiskLevel` value is from the allowed enum ["low", "medium", "high", "critical"]
- `failOpenTriggered: true` co-occurs with non-null `failOpenReason`
