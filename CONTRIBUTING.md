# Contributing to ZAM

Thanks for your interest. ZAM is an open-core reference implementation; contributions to the open core
and the reference adapters are welcome under Apache-2.0.

## Ground rules (how this project works)

- **A document before the code.** Every behavior-affecting change gets a numbered scoping note in
  `docs/` (`NN_TITLE.md`) with its decisions and rationale, *before* implementation. See any of
  `docs/33`–`docs/40` for the pattern.
- **No deferred technical debt.** Each change lands clean, tested, and documented — no `TODO`s,
  skipped tests, or "temporary" shortcuts parked for later. If a clean solution isn't feasible within
  a pass, raise it rather than committing a shortcut.
- **Fail-open is the spine.** Changes to selection logic must preserve *"smaller context only when
  safe"*: when in doubt, include more, never less.
- **Honest status.** Quote exact numbers (e.g. "27 passed, 1 approved-skipped"), never rounded up.

## Workflow

1. Branch from `main`.
2. Make the change with tests. Keep both builds green:
   ```bash
   npm run build && npm test
   # for an adapter:
   cd packages/adapter-<name> && npm install && npm run build && npm test
   ```
3. Open a PR. CI (root + runtime + all adapters) must be green.
4. Reviewer verdicts use a fixed vocabulary: `ACCEPT` / `ACCEPT_WITH_NOTES` / `NEEDS_FIX` / `BLOCKED`
   / `OUT_OF_SCOPE`.

## Schemas are the contract

Inputs and outputs are JSON-Schema validated (`schemas/`). Changing a schema, enum, warning code, or
trace shape is a deliberate, documented decision — not an incidental edit.

## Reporting

Functional bugs: open an issue. Security issues: see [`SECURITY.md`](SECURITY.md) — please report
those privately.
