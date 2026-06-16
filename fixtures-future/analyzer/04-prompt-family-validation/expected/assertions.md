# Assertions — 04-prompt-family-validation

## Fixture Purpose
Validates that `promptFamily` is accepted when populated with a known classification value ("coding"), as defined in docs/15 §4.2. This fixture is specifically targeting the `promptFamily` field to ensure the schema accepts expected classifier outputs.

## Expected Properties
- `promptFamily` is "coding" — a value from the accepted PromptFamilyValue enum (docs/06 §2.2)
- `analyzerConfidence` is >= 0.8 (confident classification)
- `assessedRequestRiskLevel` is "medium" — triggers standard Tier 1 analysis, no fail-open
- `failOpenTriggered` is false
- `failOpenReason` is null

## Schema Invariants Checked
- `promptFamily` is a non-empty string (schema accepts any string; enum enforcement is semantic, to be tightened when PromptFamilyValue is formally added to enums.shared.schema.json)
- All required fields are present
- `additionalProperties: false` prevents injection of extra fields
