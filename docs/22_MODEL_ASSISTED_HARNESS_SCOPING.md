# 22 Model-Assisted Fixture Harness Scoping

> **Document type:** Future Scoping Note — Model-Assisted Test Harness Architecture
> **Status:** Scoping Only. No implementation, schema, fixture, or test file is created by this document.
> **Authority:** `docs/13_MODEL_ASSISTED_CONTEXT_PLANNING.md` §20; `docs/12_SCHEMA_AND_HARNESS_PLAN.md` §10; `docs/21_HTTP_API_IMPLEMENTATION_PLAN.md`.
> **MVP interference:** None — this document does not modify existing CLI, core, schemas, fixtures, harness code, or tests.
> **Implementation status:** Not implemented. This is a scoping document for future implementation passes only.

---

## 1. Purpose

This document defines the complete technical strategy for testing future model-assisted components (Request Analyzer, History Compressor, and associated Trace extensions) **without modifying or breaking the existing 651-test MVP baseline** in `tests/phase12/harness.test.ts`.

The core problem this document solves:

> `docs/13` §20 defines future fixture groups for model-assisted components.
> `docs/12` §10.2 documents a standard 11-file fixture layout tied to the current 28-case / 651-subtest MVP corpus.
> `tests/phase12/harness.test.ts` runs the full deterministic pipeline against every fixture under `fixtures/`.
> New fixture groups for Analyzer/Compressor schemas must NOT feed into the existing `harness.test.ts` pipeline — the CLI planner produces `prompt-plan.json` + `trace.json` outputs, not `analyzer-output.json` or `history-compressor-output.json`.

**Goal:** Design a safe, isolated future harness that validates model-assisted schema outputs without touching the MVP baseline.

---

## 2. MVP Non-Interference Guarantee

This section restates the binding constraint from `docs/13` §2 in terms applicable to test architecture.

### 2.1 What must not change in any future model-assisted harness pass

| Protected item | Why |
|---|---|
| `fixtures/` directory contents (all 28 cases) | These are canonical MVP fixture inputs/expected outputs; their structure is locked by `docs/12` §10.2. |
| `tests/phase12/harness.test.ts` | This file owns Gate B. Any modification risks breaking the 651-test baseline. |
| `tests/phase12/harness-checks.ts` | Pure check functions used by the MVP harness. Shared logic changes risk cascading failures. |
| `schemas/outputs/prompt-plan.schema.json` | MVP output schema; must remain unchanged until an explicit schema decision pass. |
| `schemas/outputs/trace.schema.json` | MVP trace schema; `[FUTURE-ONLY]` phase keys documented in `docs/16` may only be added by a separate explicit schema decision pass. |
| `src/core/*.ts` | MVP pipeline modules; no model-assisted logic may be introduced. |
| `src/cli/*.ts` | CLI entry point and commands; no model-assisted logic. |

### 2.2 What this scoping document authorizes

This document authorizes **future explicit passes** to create the following new artifacts. None are created by this pass.

| Future artifact | Notes |
|---|---|
| `docs/23_ANALYZER_FIXTURE_CONTRACT.md` | Fixture contract for Request Analyzer quality testing (requires its own scoping pass). |
| `tests/future-harness/` directory | Isolated Vitest test suite for model-assisted component validation (requires its own implementation pass). |
| `fixtures-future/` directory | Future fixture corpus root for model-assisted schemas (kept separate from `fixtures/`). |
| `schemas/future/analyzer-output.schema.json` | Future AnalyzerOutput JSON Schema (requires its own schema decision pass per `docs/15` §9). |
| `schemas/future/history-compressor-output.schema.json` | Already scoped; formal schema creation requires a separate pass. |

---

## 3. Root Cause: Why the Existing Harness Cannot Accept Model-Assisted Fixtures

### 3.1 The `harness.test.ts` discovery mechanism

`tests/phase12/harness.test.ts` calls `runHarness(FIXTURES_DIR, runFn)` where `FIXTURES_DIR` is the absolute path to `fixtures/`. The harness runner (`src/core/harness-runner.ts`) uses this directory as its root.

**Critical constraint:** The runner discovers ALL subdirectories under `FIXTURES_DIR`. If a new fixture group is placed inside `fixtures/`, it will be picked up by the existing harness automatically.

### 3.2 Why model-assisted fixture groups cannot go under `fixtures/`

The existing MVP harness validates fixture expected outputs by:
1. Running the **CLI planning pipeline** (`plan` command) on each fixture's `inputs/`.
2. Comparing the CLI output (`prompt-plan.json`, `trace.json`) against `expected/prompt-plan.json` and `expected/trace.json`.
3. Applying MVP-schema zero-tolerance checks (ZT-01 through ZT-15) defined in `docs/12` §10.9.

A fixture for the Request Analyzer expects `analyzer-output.json` as output — not `prompt-plan.json`. The CLI planner does not produce `analyzer-output.json`. Placing an Analyzer fixture under `fixtures/` would cause:
- The harness to try running `plan` on it.
- The `plan` run to produce `prompt-plan.json` / `trace.json`.
- The harness to then fail comparing against a non-existent `expected/analyzer-output.json` — or worse, find no `expected/` directory and report a discovery error.

**Conclusion:** Model-assisted fixture groups must live in a separate directory root.

### 3.3 Hardcoded fixture assertions in harness.test.ts

The harness test (`tests/phase12/harness.test.ts`) contains fixture-count assertions such as:
- `results.passed` expected to match known counts (verified at setup time).
- Gate B status string: `SATISFIED WITH 1 APPROVED SKIP(S)`.
- The H-F2 test explicitly verifies `results.failed === 0` and `results.blocked === 0`.

Adding new fixture groups to `fixtures/` — even if they had the correct 11-file layout — would change `results.passed` and break the gate assertions. The exact wording `passed=27 failed=0 skipped=1 blocked=0` (Gate B status) is a canonical locked baseline.

---

## 4. Proposed Architecture: Isolated Future Harness

### 4.1 Directory Separation

```
MAX/
  fixtures/                  ← MVP corpus (28 cases, LOCKED, never touched by future passes)
  fixtures-future/           ← [NEW, FUTURE] Model-assisted fixture corpus root
    analyzer/                ← Request Analyzer fixtures
      01-basic-coding-request/
      02-fail-open-low-confidence/
      ...
    compressor/              ← History Compressor fixtures
      01-structured-state-extraction/
      02-protected-categories/
      ...
  tests/
    phase12/                 ← MVP harness tests (LOCKED, never modified by future passes)
      harness.test.ts
      ...
    future-harness/          ← [NEW, FUTURE] Model-assisted harness Vitest suite
      analyzer.test.ts
      compressor.test.ts
      ...
  schemas/
    outputs/                 ← MVP output schemas (LOCKED)
    inputs/                  ← MVP input schemas (LOCKED)
    shared/                  ← MVP shared schemas (LOCKED)
    future/                  ← [NEW, FUTURE] Model-assisted component schemas
      analyzer-output.schema.json
      history-compressor-output.schema.json
```

**Key invariant:** `tests/phase12/harness.test.ts` must never be given a `FIXTURES_DIR` that includes `fixtures-future/`. Each test file owns its own fixture root.

### 4.2 Separate Vitest Test Suite

The future model-assisted harness lives at `tests/future-harness/`. It is a separate set of Vitest test files with:
- Its own fixture discovery root (`fixtures-future/`).
- Its own schema validators (loaded from `schemas/future/`).
- Its own check functions (`src/core/future-harness-checks.ts` — `[FUTURE]`).
- No dependency on `src/core/harness-runner.ts` or `tests/phase12/harness.test.ts`.

**Vitest test file isolation:** Vitest's glob patterns in `vitest.config.ts` currently pick up all `*.test.ts` files. When `tests/future-harness/` files are created, they will be automatically discovered by Vitest as additional test files — contributing to the total test count. This is safe because:
- They are separate `describe` blocks with unique IDs.
- They do not modify `tests/phase12/` assertions.
- The Gate B check in `harness.test.ts` (H-F2) references only `runHarness(FIXTURES_DIR)` with the locked MVP fixtures root.

### 4.3 Future Fixture Layout for Model-Assisted Components

Unlike the MVP 11-file layout, model-assisted fixture cases need a different structure. Each fixture case contains:

```
fixtures-future/analyzer/01-basic-coding-request/
  inputs/
    analyzer-request.json       ← Request text + context (input to the analyzer)
    analyzer-config.json        ← Analyzer configuration (tier thresholds, etc.)
  expected/
    analyzer-output.json        ← Expected AnalyzerOutput object
    assertions.md               ← Fixture-specific assertion contract
```

For History Compressor:

```
fixtures-future/compressor/01-structured-state-extraction/
  inputs/
    history-raw.json            ← Raw conversation history (structured input)
    compressor-config.json      ← Compressor configuration
  expected/
    compressor-output.json      ← Expected HistoryCompressorOutput object
    assertions.md               ← Fixture-specific assertion contract
```

**Key properties of the future fixture layout:**
- Does NOT use `component-registry.json` as a required Class A input (the CLI planner is not involved).
- Does NOT produce `prompt-plan.json` or `trace.json` outputs.
- Uses its own schema validators (future schemas).
- Fixture count is tracked separately from the MVP 28-case baseline.

### 4.4 Future Harness Test Pattern

Each `tests/future-harness/*.test.ts` file follows this pattern (illustrative only — not authorized for implementation until an explicit pass):

```typescript
// tests/future-harness/analyzer.test.ts
// [FUTURE-ONLY] — not yet implemented

import { describe, it, expect } from 'vitest';
import { runFutureHarness } from '../../src/core/future-harness-runner.js'; // [FUTURE]
import { getAnalyzerOutputValidator } from '../../src/core/future-harness-ajv.js'; // [FUTURE]

const FUTURE_FIXTURES_DIR = resolve(__dirname, '../../fixtures-future/analyzer');

describe('Analyzer Harness — Future Quality Tests', () => {
  it('discovers and validates all analyzer fixtures', async () => {
    const results = await runFutureHarness(FUTURE_FIXTURES_DIR, getAnalyzerOutputValidator());
    expect(results.failed).toBe(0);
    expect(results.blocked).toBe(0);
  });
});
```

**This is an illustrative example only.** No source file, test file, or fixture is created by this document. The exact function signatures and test structure are to be defined by a future implementation pass with its own explicit scope.

---

## 5. Isolation Rules

The following isolation rules must be enforced at implementation time by the future pass.

### 5.1 No cross-directory harness discovery

| Rule | Detail |
|---|---|
| `tests/phase12/harness.test.ts` must never use `fixtures-future/` | `FIXTURES_DIR` constant must remain `fixtures/` (the MVP corpus root). |
| `tests/future-harness/*.test.ts` must never use `fixtures/` | Future tests use `fixtures-future/` only. |
| The MVP `runHarness()` function must not be called on `fixtures-future/` | `runHarness` runs the CLI planner; the planner produces MVP outputs, not model-assisted outputs. |
| The future harness runner must not import `runHarness` | The future runner is a separate module with its own pipeline. |

### 5.2 No schema cross-contamination

| Rule | Detail |
|---|---|
| Future schema files go under `schemas/future/` | They must not overwrite or conflict with `schemas/outputs/`, `schemas/inputs/`, or `schemas/shared/`. |
| `schemas/future/` schemas may `$ref` to `schemas/shared/` enums only when the referenced enum is already an accepted MVP enum | No future-only enum values may enter MVP schemas via `$ref`. |
| `schemas/outputs/trace.schema.json` must not be modified | Future trace extension phase keys (`analyzerPhase`, `summaryPhase`, etc.) documented in `docs/16` are `[FUTURE-ONLY]` and require a separate explicit schema decision pass to be added. |

### 5.3 No source module pollution

| Rule | Detail |
|---|---|
| Future harness runner module goes in `src/core/future-harness-runner.ts` | Separate from `src/core/harness-runner.ts`. |
| Future check functions go in `src/core/future-harness-checks.ts` | Separate from `src/core/harness-checks.ts`. |
| Neither future module is imported by `tests/phase12/harness.test.ts` | Phase 12 harness remains self-contained. |
| Neither future module is imported by any MVP pipeline module (`input-loader.ts`, `selector-engine.ts`, etc.) | MVP pipeline stays pure and model-call-free. |

---

## 6. Future Fixture Groups (from `docs/13` §20)

The following fixture groups are anticipated but are not created by this document. Each group requires its own explicit fixture-creation pass after the relevant schema has been formally accepted.

| Future group | Schema dependency | Fixture root | What it tests |
|---|---|---|---|
| Analyzer — basic classification | `schemas/future/analyzer-output.schema.json` | `fixtures-future/analyzer/` | Does the analyzer correctly classify request types and needed lanes? |
| Analyzer — fail-open (low confidence) | Same | Same | Does low confidence trigger expanded context (Tier 3)? |
| Analyzer — high-risk expansion | Same | Same | Does `assessedRequestRiskLevel: "critical"` trigger fail-open regardless of confidence? |
| Analyzer — prompt family validation | Same + `enums.shared.schema.json` | Same | Does the analyzer only produce values from the accepted `PromptFamilyValue` enum? |
| Compressor — structured state extraction | `schemas/future/history-compressor-output.schema.json` | `fixtures-future/compressor/` | Does the compressor extract all 11 required state categories? |
| Compressor — protected category preservation | Same | Same | Does compression never drop durable constraints, open commitments, accepted decisions? |
| Compressor — anti-regression retention | Same | Same | Are anti-regression rules preserved by the compressor? |
| Compressor — summary trace | Same | Same | Does the compressor produce `included`/`omitted`/`uncertain` trace output? |
| Trace extensions — analyzer phase | `schemas/outputs/trace.schema.json` (after extension pass) | `fixtures-future/trace-extensions/` | Do future trace extension phase keys validate correctly? |

**Important constraints:**
- No fixture from this list may be created until its schema has been formally accepted through an explicit schema decision pass.
- `schemas/future/history-compressor-output.schema.json` has already been scoped but its formal creation still requires a dedicated schema pass (not created by `docs/13` alone).
- `schemas/future/analyzer-output.schema.json` has been scoped in `docs/15` but not formally created. Its creation requires the explicit schema decision pass described in `docs/15` §9.

---

## 7. Gate B Preservation

Gate B status is **permanently protected** from any future model-assisted harness work.

| Gate B item | Protection rule |
|---|---|
| `passed=27 failed=0 skipped=1 blocked=0` | This count references the `fixtures/` MVP corpus only. Future fixture additions to `fixtures-future/` do not change it. |
| `Gate B: SATISFIED WITH 1 APPROVED SKIP(S)` | This status string is canonical. It is asserted by `tests/phase12/harness.test.ts` H-F2. No future harness pass may modify H-F2. |
| Total Vitest test count (currently 670) | Future `tests/future-harness/*.test.ts` files will add to the total count. The new count must be documented in the coder report for each future pass. It does not change Gate B. |
| Approved-skip fixture (`fixtures/13-conflict-resolution/safety-beats-omit`) | This fixture is permanently approved-skipped. No future pass may change its status. |

---

## 8. MVP Harness Constraint Reference

This section records the hardcoded constraints of the existing `tests/phase12/harness.test.ts` for reference. Any future pass that touches `tests/phase12/` (which is forbidden) would break these invariants.

| Constraint | Value | Location in harness |
|---|---|---|
| Fixture corpus root | `fixtures/` (absolute path resolved from `__dirname`) | Line ~68: `const FIXTURES_DIR` |
| CLI entry point | `src/cli/index.ts` (invoked via `spawnSync` with `--import tsx/esm`) | Lines ~67–119: `makeTestRunner()` |
| Gate B pass condition | `results.failed === 0 AND results.blocked === 0` | H-F2 test |
| Gate B status string | `SATISFIED WITH 1 APPROVED SKIP(S)` | H-F2 output |
| Fixture count (evaluate results) | `passed=27 failed=0 skipped=1 blocked=0` | H-F2 stdout assertion |
| Phase 12 Vitest test groups | H-ZT, H-S, H-F, H-DT, H-SK | Top-level describe blocks |
| Total Vitest tests in phase12 suite | 74 Vitest tests (as of baseline) | Test runner output |

---

## 9. Phased Implementation Plan

The following phases represent the implementation sequence for future model-assisted harness work. Each phase requires an explicit scoped pass authorized by Sam.

| Phase | Description | Prerequisites |
|---|---|---|
| **P1** | Create `schemas/future/analyzer-output.schema.json` — formal JSON Schema for AnalyzerOutput (scoped in `docs/15` §4) | Sam approval + explicit schema decision pass |
| **P2** | Create `schemas/future/history-compressor-output.schema.json` — formal JSON Schema for HistoryCompressorOutput | Sam approval + explicit schema decision pass |
| **P3** | Create `tests/future-harness/` directory with `analyzer.test.ts` and the supporting `src/core/future-harness-runner.ts` and `src/core/future-harness-ajv.ts` modules | P1 completed |
| **P4** | Create `fixtures-future/analyzer/` with seed fixture cases for the Analyzer groups defined in §6 | P1 + P3 completed |
| **P5** | Create `tests/future-harness/compressor.test.ts` and `fixtures-future/compressor/` seed fixtures | P2 + P3 completed |
| **P6** | Trace extension schema additions to `schemas/outputs/trace.schema.json` for `analyzerPhase` and `summaryPhase` keys (scoped in `docs/16`) | Separate explicit schema decision pass; does not depend on P1–P5 |

Each phase is one narrow, independently reviewable Coder pass.

---

## 10. Decision Required Before Implementation

Before any implementation pass for the future harness, Sam must explicitly authorize:

1. **The `fixtures-future/` directory name** — this document proposes `fixtures-future/` to make the separation visually clear. Sam may prefer a different name (e.g., `fixtures-model-assisted/`, `fixtures-post-mvp/`).

2. **The `schemas/future/` directory name** — similarly, Sam may prefer `schemas/post-mvp/` or another convention.

3. **Whether to create `src/core/future-harness-runner.ts` as a new module** — or reuse/extend `harness-runner.ts` with a different fixture root parameter. Reuse risks coupling; separation is cleaner but creates duplicate infrastructure.

4. **Schema creation order** — whether P1 (Analyzer schema) or P2 (Compressor schema) comes first.

No implementation pass may begin without explicit Sam approval of the above decisions.

---

## 11. Summary

| Concern | Resolution |
|---|---|
| MVP 651-test baseline preserved | ✅ Future harness uses `fixtures-future/` (separate root); `tests/phase12/harness.test.ts` is never modified. |
| Gate B wording preserved | ✅ Gate B references the MVP corpus only; future fixture additions have no effect on it. |
| Schema isolation | ✅ Future schemas go under `schemas/future/`; MVP schemas are never modified. |
| Test suite isolation | ✅ `tests/future-harness/` is a new directory; no phase12 file is touched. |
| Model-call-free | ✅ Future harness validates schema-valid fixture outputs only; no provider/model calls in test logic. |
| Portability preserved | ✅ The future harness is stateless and offline; it validates expected outputs against schemas. |
| `docs/13` §2 MVP Non-Interference Guarantee | ✅ No MVP schema, fixture, source, or test file is changed by this document or any future pass it describes. |

---

*This document is a scoping reference only. No implementation is authorized until Sam explicitly approves each phase individually through a dedicated Coder pass.*
