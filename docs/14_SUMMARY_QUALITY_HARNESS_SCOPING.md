# Summary Quality Harness Scoping

## 1. Status and Authority

| Field | Value |
|---|---|
| **Document type** | Future Scoping Note (Phase 2 of Phased Adoption Plan) |
| **Created** | Post-MVP phase |
| **MVP authority** | None — this document does not change current MVP schemas, fixtures, or implementation. |
| **Implementation status** | Not implemented. This is a scoping pass for future evaluation criteria. |
| **Parent document** | `docs/13_MODEL_ASSISTED_CONTEXT_PLANNING.md` §10, §20 |

---

## 2. Objective

Define the evaluation criteria, fixture contract, and zero-tolerance checks for the future model-assisted **History Compressor**. 

Before any model-assisted history compression is authorized, its safety and efficacy must be provable. The History Compressor must act as a *structured state extractor* (per `docs/13` §10), not a paragraph summarizer. This document defines how we will test it.

---

## 3. Core Principle: Safety Before Compression

```
Compression is meaningless if it drops constraints.
Summarization is dangerous if it distorts decisions.
```

The primary goal of the summary quality harness is to catch **unsafe omission** and **semantic distortion**. Token reduction (compression ratio) is a secondary goal that is only measured after safety is proven.

---

## 4. Zero-Tolerance Failure Modes (Red Lines)

The harness must fail any compressor proposal that commits a zero-tolerance failure.

| Failure Mode | Description | Harness Enforcement |
|---|---|---|
| **Dropped Constraint** | A user-stated durable constraint is omitted. | `assert.includes(summary.userConstraints, expectedConstraint)` |
| **Dropped Commitment** | An open commitment or pending task is omitted. | `assert.includes(summary.openCommitments, expectedTask)` |
| **Dropped Decision** | An explicitly accepted decision is lost. | `assert.includes(summary.acceptedDecisions, expectedDecision)` |
| **Dropped Instruction** | A direct instruction from the most recent turns is lost. | `assert.includes(summary.activeTaskState, expectedInstruction)` |
| **Dropped Anti-Regression** | A session-derived hard lesson is omitted. | `assert.includes(summary.antiRegressionRules, expectedRule)` |
| **Semantic Distortion** | The summary changes the meaning of a retained item (e.g., "Do not use React" becomes "Use React"). | Evaluated via model-assisted factual equivalence checking in the harness. |

---

## 5. Fixture Contract

A history compression fixture must follow a structured contract to test the compressor against specific scenarios.

### 5.1 Fixture Structure `[FUTURE-ONLY]`

*Note: These are illustrative fixture definitions, not current MVP schema changes.*

```json
{
  "fixtureId": "history_compression_01_durable_constraint",
  "description": "Tests that a durable constraint established in turn 3 is retained in turn 50.",
  "inputs": {
    "rawHistory": [ /* 50 turns of mock conversation */ ],
    "currentTask": "Implement the frontend",
    "budget": { "maxHistoryTokens": 500 }
  },
  "expected": {
    "mustInclude": [
      {
        "category": "userConstraints",
        "contentMatch": "Never use Tailwind CSS"
      }
    ],
    "mustOmit": [
      {
        "category": "failedAttempts",
        "contentMatch": "Initial layout with Flexbox that was rejected in turn 10"
      }
    ],
    "traceRequirements": {
      "uncertaintyFlagged": false
    }
  }
}
```

### 5.2 Fixture Categories

The harness must cover these specific test categories (`docs/13` §20):

1. **Summary Preservation:** Verifies that accepted decisions, open tasks, and user constraints are not lost in long (50+ turn) conversations.
2. **Summary Distortion Detection:** Verifies that negative constraints ("Do NOT do X") are not accidentally summarized as positive constraints ("Do X").
3. **Anti-Regression Retention:** Verifies that hard rules derived from earlier failures are retained.
4. **Compression Ratio:** Measures the token size of the structured summary against the raw history to ensure meaningful reduction (e.g., target 60%+ reduction).

---

## 6. Evaluation Criteria (Metrics)

The harness will report the following metrics for any future compressor candidate:

| Metric | Target | Description |
|---|---|---|
| **Preservation Completeness** | 100% | Percentage of `mustInclude` items successfully extracted across all fixtures. |
| **Distortion Rate** | 0% | Percentage of items where the semantic meaning was altered. |
| **Safe Omission Rate** | >90% | Percentage of `mustOmit` items (noise, rejected attempts) successfully dropped. |
| **Uncertainty Fallback** | 100% | Whenever the compressor cannot confidently extract a constraint, it must flag it in the `uncertain` trace array rather than silently omitting it. |
| **Compression Ratio** | >60% | Token savings compared to retaining the full raw history. |

---

## 7. Trace Requirements

To pass the harness, the compressor must produce a valid **Summary Trace** (`docs/13` §10). The harness will assert that the trace contains:

1. `included`: Exact state items extracted and retained.
2. `omitted`: Explicitly dropped items (proving deliberate omission vs. accidental loss).
3. `uncertain`: Items the compressor could not classify. The core system will fail-open on these items.

---

## 8. Next Steps

With the quality harness scoped, the next phases from `docs/13` §22 can proceed in future scoping passes:

- **Phase 3:** Request analyzer / lane proposal schema scoping.
- **Phase 4:** Trace extensions for summary/analyzer.
