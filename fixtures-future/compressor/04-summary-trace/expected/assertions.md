# Assertions — 04-summary-trace

## Fixture Purpose
Validates that the `summaryTrace` object correctly accepts all three required arrays — `included`, `omitted`, and `uncertain` — each with at least one entry. This targets the audit trace structure from docs/13 §10.

## Expected Properties
- `summaryTrace.included` is non-empty — at least 5 entries naming retained categories
- `summaryTrace.omitted` is non-empty — at least 5 entries naming omitted categories
- `summaryTrace.uncertain` is non-empty — at least 1 entry describing an undecided item
- All three summaryTrace arrays contain non-empty strings (minLength: 1)

## Schema Invariants Checked
- `summaryTrace` is an object with `required: ["included", "omitted", "uncertain"]`
- Each array item is a string with minLength: 1
- Non-empty arrays are accepted in all three positions simultaneously
- No extra fields allowed in summaryTrace (additionalProperties: false)
