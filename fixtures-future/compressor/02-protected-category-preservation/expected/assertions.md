# Assertions — 02-protected-category-preservation

## Fixture Purpose
Validates that the schema accepts payloads where only the "protected" categories (acceptedDecisions, openCommitments, durableFacts) are populated. All other arrays are empty []. This exercises the protection rules from docs/13 §10.

## Expected Properties
- `acceptedDecisions` has 2 populated StateItem entries (protected from compression)
- `openCommitments` has 1 populated StateItem entry (dropAllowed: false per docs/04 §7.6)
- `durableFacts` has 2 populated StateItem entries (protected from compression)
- All other required arrays (`openIssues`, `userConstraints`, `importantFilesPaths`, `failedAttempts`, `warnings`, `antiRegressionRules`, `recentRelevantTurns`) are empty []
- `summaryTrace.omitted` lists the empty categories to show the compressor traced its decision

## Schema Invariants Checked
- Empty arrays ([]) are valid for all array fields
- StateItem with only `content` (no `notes`) is valid — `notes` is optional
- `currentTaskState` with only `activeTask` (no `currentGoal` or `blockers`) is valid
