# 45 Documentation Accuracy Pass + v0.1.2

> **Document type:** Accuracy / maintenance pass — follow-up to the npm publish phases (`docs/42`–`44`).
> **Status:** Implemented; core re-published as **0.1.2** by the maintainer.
> **Authority:** `docs/04` wording, `src/cli/index.ts` metadata, adapter header comments, version bump.
> **No behavior, schema, or test change.**

---

## 1. Why

After publishing + the adapter rename + the 0.1.1 CLI fix, a documentation audit found a few stale
*user-facing* items. This pass corrects them and records which docs are intentionally historical.

## 2. Fixes

- **CLI `--version`** was hardcoded to `0.0.1` → now reads the `package.json` version (via
  `createRequire`, the same pattern as the health route), so it never drifts again.
- **CLI `--help` description** updated from "Portable Context Control Plane CLI MVP" to the open-core
  positioning.
- **`docs/04`** (*"does not provide an OpenClaw adapter yet"*; *"adapters … not MVP targets"*)
  corrected — reference adapters now ship as separate packages (OpenClaw/MCP/Telegram, `docs/37`–`40`).
  The historical text is struck through, not deleted.
- Adapter `src/index.ts` header comments: `@zam/adapter-*` → `zam-adapter-*` (the published names).
- Core bumped to **0.1.2**.

## 3. Intentionally historical (NOT changed)

These are dated records; the current state lives in `docs/37`–`44` + the READMEs:

- `docs/09`, `docs/11`, `docs/12`, `docs/18` — MVP-era plans/audits ("Gate D blocked", "651 tests",
  "adapters out of MVP scope").
- `RELEASE_NOTES_v0.1.0.md`, `PROJECT_MASTER_PLAN.md` — dated release / vision records.
- The `@zam/adapter-*` names inside `docs/38`–`docs/40` — the rename to `zam-adapter-*` is recorded
  canonically in `docs/43`.

## 4. Republish — maintainer

`npm publish` from the repo root → `context-plane@0.1.2`. The adapters are unaffected.
