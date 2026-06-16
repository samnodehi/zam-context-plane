# Assertions — 01-structured-state-extraction

## Fixture Purpose
Validates that the HistoryCompressorOutput schema accepts a payload that populates all 11 required state extraction categories. This is the baseline "all categories present" fixture.

## Expected Properties
- All 11 required array fields are present and non-null
- `currentTaskState.activeTask` is non-empty
- `summaryTrace.included` lists all 11 category names
- `summaryTrace.omitted` and `summaryTrace.uncertain` are empty (nothing was omitted or uncertain)
- All `StateItem` entries have at least a non-empty `content` field

## Schema Invariants Checked
- All required fields from `schemas/future/history-compressor-output.schema.json` are present
- `additionalProperties: false` — no extra fields accepted
- `StateItem.$defs` correctly validates each array item with `required: ["content"]`
