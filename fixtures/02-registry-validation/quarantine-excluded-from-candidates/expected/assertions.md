# Fixture Assertions: 02-registry-validation / quarantine-excluded-from-candidates

## Purpose

Verify that a schema-valid but loader-invalid component is quarantined during the registry phase and
does not reach the selector fan-out, the candidate set, or any output partition.

## Trigger

`skill.malformed-zero-tokens` has `tokensApprox: 0` and `charsApprox: 0` without `metadataOnly: true`.
This passes JSON schema validation (schema enforces `minimum: 0` only) but violates the orchestrator
loader cross-field rule: "tokensApprox >= 1 unless metadataOnly: true" (docs/05 §8).
Because this component is low-risk (`riskLevel: low`, `retainPolicy: optional`,
`omissionPolicy: allow`), the loader quarantines it (non-fatal) and planning continues.
A high-risk safety-critical component with the same defect would instead halt planning.

## Key Assertions

### Registry Phase
- `registryPhase.componentCount` MUST equal 2 (both components are loaded from the registry input file).
- `registryPhase.quarantinedCount` MUST equal 1.
- `registryPhase.validationWarnings[]` MUST be non-empty and MUST identify `skill.malformed-zero-tokens`.
- `registryPhase.fatalErrors[]` MUST be empty (`[]`).
- `registryPhase.candidateSetSummary.candidateSetSize` MUST equal 1 (quarantined component excluded).
- `registryPhase.candidateSetSummary.quarantinedExcluded` MUST equal 1.
- `registryPhase.candidateSetSummary.candidateSetPolicy` MUST equal `all_non_quarantined`.

### Quarantine Exclusion
- `skill.malformed-zero-tokens` MUST NOT appear in `selectorPhase.selectorTrace[]`.
- `skill.malformed-zero-tokens` MUST NOT appear in `conflictPhase.resolvedDecisions[]`.
- `skill.malformed-zero-tokens` MUST NOT appear in `conflictPhase.noConflictComponentIds[]`.
- `skill.malformed-zero-tokens` MUST NOT appear in `planPhase.selectedComponents[]`.
- `skill.malformed-zero-tokens` MUST NOT appear in `planPhase.omittedComponents[]`.
- `skill.malformed-zero-tokens` MUST NOT appear in `planPhase.deferredComponents[]`.
- `skill.malformed-zero-tokens` MUST NOT appear in `prompt-plan.selectedComponents[]`.
- `skill.malformed-zero-tokens` MUST NOT appear in `prompt-plan.omittedComponents[]`.
- `skill.malformed-zero-tokens` MUST NOT appear in `prompt-plan.deferredComponents[]`.

### Candidate Set and Gap-Check
- `selectorPhase.selectorSummary.totalEvaluated` MUST equal 1 (only surviving candidate).
- Quarantine events are NOT counted in `selectorSummary` — they are registry-phase events only.
- Gap-check invariant MUST hold:
  `conflictPhase.noConflictComponentIds.length` (1)
  + `conflictPhase.conflictResolutionTrace.length` (0)
  == `registryPhase.candidateSetSummary.candidateSetSize` (1).

### No Quarantine Boundary Violation
- `path: quarantine_boundary_violation` MUST NOT appear in any trace or partition entry.
- Quarantine boundary violation is a defensive backstop for impossible boundary failures, not for
  correct-operation quarantine. In correct operation, quarantined components never reach the selector
  fan-out — there is no boundary violation to detect.

### Surviving Component
- `scaffold.system-rules` MUST appear in `selectorPhase.selectorTrace[]` with `action: include`,
  `path: safety_override` (hard protection: riskLevel=critical, omissionPolicy=never,
  retainPolicy=safety_critical).
- `scaffold.system-rules` MUST appear in `planPhase.selectedComponents[]` with `path: safety_override`.
- `scaffold.system-rules` MUST appear in `prompt-plan.selectedComponents[]` with `path: safety_override`.

## Known Scope

This fixture tests correct quarantine exclusion for a non-safety-critical component only.
A safety-critical component with the same defect (tokensApprox=0 + charsApprox=0 + no metadataOnly)
would trigger a hard error and halt planning — that is a separate test group (Class A fatal error).

## Not Covered by This Fixture

- Quarantine of safety-critical or high-risk components (those halt planning).
- Duplicate ID quarantine scenarios.
- Hash mismatch validation warnings (non-quarantine warning).
- The `quarantine_boundary_violation` path (requires illegal boundary breach, not correct quarantine).
- Missing optional input file behavior.
