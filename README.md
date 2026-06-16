# Context Control Plane — CLI MVP

Portable, vendor-neutral context governance layer for AI agent runtimes.
Produces auditable context decisions: what to include, omit, defer, and why.

## Purpose

Before an agent sends a prompt to a model, the Context Control Plane decides which
components belong in the prompt, which are safe to omit, and which must be deferred.
Every decision is traceable, schema-validated, and deterministic.

Primary deliverables per planning run:

- `prompt-plan.json` — structured context plan with selected, omitted, and deferred components
- `trace.json` — full decision trace per phase, keyed by phase name
- `summary.md` — deterministic human-readable narrative

## MVP Scope

- Offline, deterministic, CLI-only
- No provider calls, no live prompt omission, no runtime mutation
- Input: operator-supplied JSON files
- Output: `prompt-plan.json`, `trace.json`, `summary.md`
- 8 deterministic selector types, 12-step ladder, fail-open by default

## Non-Goals (MVP)

- No OpenClaw adapter, n8n adapter, or Telegram adapter (Gate D — deferred by design)
- No model-assisted selectors
- No live provider or model calls
- No agent runtime integration

## Install

```bash
npm install
```

## Build

```bash
npm run build
```

## Test

```bash
npm test
```

## Usage

### Plan

```bash
context-plane plan \
  --request <path> \
  --registry <path> \
  --active-ids <path> \
  --runtime <path> \
  --history <path> \
  --budget <path> \
  --constraints <path> \
  --policy <path> \
  --request-signals <path> \
  --output-dir <path>
```

| Flag | Class | Description |
|---|---|---|
| `--request` | **A — required** | Request text file (plain text) |
| `--registry` | **A — required** | Component registry JSON |
| `--active-ids` | B — optional | Active IDs JSON |
| `--runtime` | B — optional | Runtime capabilities JSON |
| `--history` | B — optional | History state JSON |
| `--budget` | B — optional | Budget state JSON |
| `--constraints` | B — optional | User constraints JSON |
| `--policy` | B — optional | Selector policy JSON |
| `--request-signals` | B — optional | Pre-normalized request signals JSON. Absent: MVP uses safe default normalization. Present: bypasses default stub and supplies `promptFamily`, `familyConfidence`, and `injectionSuspect` directly. |
| `--output-dir` | optional | Output directory (default: working directory) |

Outputs `prompt-plan.json`, `trace.json`, and `summary.md` to `--output-dir`.

### Evaluate

```bash
context-plane evaluate \
  --fixtures <dir> \
  --report <path>
```

| Flag | Description |
|---|---|
| `--fixtures` | Path to fixtures directory |
| `--report` | Path to write evaluation report JSON |


## Gate B Status

```
SATISFIED WITH 1 APPROVED SKIP(S)
```

- 27 of 28 E2E fixtures passed
- 1 fixture (`13-conflict-resolution/safety-beats-omit`) is approved-skipped:
  `safety_hard_protection` is architecturally unreachable through the current MVP
  deterministic ladder (Step 3 fires before Step 7). Covered by unit test **SHP-1**
  in `tests/phase8/conflict-resolver.test.ts`.
- Gate-B core suite (phases 0–12): **651/651**
- Live test counts are emitted by CI on every push/PR (root + runtime suites + both builds) —
  see [`.github/workflows/ci.yml`](.github/workflows/ci.yml). Latest: root **757/757**, runtime **354/354**.
- Tracked known gaps and technical debt: see [`DEBT.md`](DEBT.md)

## License

Private during development. The open reference implementation is intended to be released under
**Apache-2.0** (permissive + explicit patent grant) at the public flip; the `LICENSE` file is added
at that point, not before. See [`docs/37`](docs/37_OPEN_CORE_BOUNDARY_AND_ADAPTER_STRATEGY.md) for the
open-core boundary (what is open vs. commercial).
