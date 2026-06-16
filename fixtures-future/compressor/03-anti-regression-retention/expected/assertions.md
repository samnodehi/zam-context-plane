# Assertions — 03-anti-regression-retention

## Fixture Purpose
Validates that the schema accepts payloads focused on `antiRegressionRules` — the "hard lessons" memory (docs/13 §13). This fixture exercises the protection of critical rules that must survive compression.

## Expected Properties
- `antiRegressionRules` has 3 populated entries (protected from compression per docs/13 §10)
- Each entry has `content` (the rule) and `notes` (severity + source reference)
- `failedAttempts` has 1 entry documenting a rejected design approach
- All other arrays are empty []
- `summaryTrace.included` references antiRegressionRules and failedAttempts

## Schema Invariants Checked
- `StateItem` with both `content` and `notes` is valid
- `currentTaskState.blockers` as empty array [] is valid (blockers is not required by schema)
- `antiRegressionRules` being a non-empty array is accepted by the schema
