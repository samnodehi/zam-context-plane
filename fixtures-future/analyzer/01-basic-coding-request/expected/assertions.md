# Assertions — 01-basic-coding-request

## Fixture Purpose
Validates that a confident, low-risk coding request classification is accepted by the AnalyzerOutput schema.

## Expected Properties
- `tier` is 1 (lightweight analyzer applied)
- `analyzerConfidence` is >= 0.9 (confident classification)
- `assessedRequestRiskLevel` is "low"
- `failOpenTriggered` is false — confident classification does not trigger fail-open
- `failOpenReason` is null — no fail-open means no reason string
- `promptFamily` is "coding"
- `requiresTools` and `requiresFiles` are both true
- `evidence` is non-empty (at least one signal recorded)

## Schema Invariants Checked
- All required fields from `schemas/future/analyzer-output.schema.json` are present
- `additionalProperties: false` — no extra fields injected
- `analyzerConfidence` is in range [0.0, 1.0]
- `tier` is in range [0, 3]
