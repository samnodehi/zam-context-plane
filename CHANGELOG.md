# Changelog

All notable changes to `context-plane` (the ZAM core). The reference adapters
(`zam-adapter-openclaw` / `-mcp` / `-telegram`) are versioned together, currently at `0.1.0`.

## 0.1.2 — 2026-06-17

- **Fix:** the `context-plane` CLI `--version` now reads the package version (it was hardcoded to an
  old value); the `--help` description was updated to the open-core wording. (`docs/45`)
- **Docs:** corrected `docs/04` (reference adapters now ship as separate packages); documentation
  accuracy pass.

## 0.1.1 — 2026-06-17

- **Fix:** the published CLI bin now carries a `#!/usr/bin/env node` shebang, so the `context-plane`
  command works on Linux/macOS — previously it worked only on Windows (via npm's `.cmd` shim). (`docs/44`)

## 0.1.0 — 2026-06-17

- First **open-core** release (Apache-2.0). Deterministic context-governance core: request router →
  12-step selector ladder → conflict resolver → budgeter, emitting `prompt-plan.json` + `trace.json` +
  `summary.md`. Fail-open on uncertainty; schema-validated, fail-closed outputs.
- A CLI, a library API (`import { plan } from 'context-plane'`), and an optional HTTP service.
- Three reference adapters: `zam-adapter-openclaw`, `zam-adapter-mcp`, `zam-adapter-telegram`.
- Offline benchmark: **63.9% mean token savings, 0 unsafe omissions** vs. the inject-everything
  baseline; live tier: **85.7%** deterministic-vs-model classification agreement.
