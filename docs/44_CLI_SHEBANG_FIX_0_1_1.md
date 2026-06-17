# 44 CLI Shebang Fix + v0.1.1

> **Document type:** Packaging fix — follow-up to `docs/42` (npm publishing).
> **Status:** Fixed in-repo; core to be re-published as **0.1.1** by the maintainer.
> **Authority:** `src/cli/index.ts` (shebang) + `package.json` version/bin only. No core logic, schema,
> or test change.
> **Canonical sources:** `docs/42` (core publishing), `docs/43` (adapter publishing).

---

## 1. The defect (found post-publish, on v0.1.0)

The published `context-plane` CLI bin had **no shebang**: `src/cli/index.ts` (→ `dist/cli/index.js`)
started with `import …`, not `#!/usr/bin/env node`. A bin without a shebang **fails on Linux/macOS**
(the shell cannot exec a JS file directly); it worked only on Windows, where npm generates a `.cmd`
shim that calls `node` explicitly — which is why it wasn't noticed at publish time. Since the README
documents the `context-plane` CLI, this was a cross-platform defect. (The three adapters already had
the shebang, so their CLIs were fine.)

The npm publish warning — `"bin[…]" … was invalid and removed` — was a **separate, cosmetic** issue:
npm normalized `./dist/cli.js` → `dist/cli.js`. `npm view` confirmed the published bins are present and
correct, so there was **no functional impact** from that warning.

## 2. The fix

- Added the shebang to the **shipped `dist/cli/index.js` via a postbuild step**
  (`scripts/add-cli-shebang.mjs`, wired into `build`), **not** to the source. Reason: the CLI
  integration tests run the *source* via `node --import tsx/esm src/cli/index.ts`, and a source-level
  shebang breaks that run (it broke 22 tests on the first attempt). The source stays shebang-free; the
  published bin gets the shebang. (node strips it on the entry file, so `node dist/cli/index.js` still
  works.)
- Cleaned the cosmetic `./` from every `bin` path (core + the three adapters) to silence the npm
  warning on future publishes.
- Bumped the core to **0.1.1** (0.1.0 is immutable on npm).

## 3. Verification

`npm run build` → `dist/cli/index.js` starts with the shebang; `context-plane --help` runs; root suite
**743/743**; `npm pack --dry-run` clean (schemas + dist, 0 forbidden), version 0.1.1.

## 4. Republish — maintainer

Core only — the adapters are unaffected (their published `0.1.0` CLIs already have a shebang):

```bash
npm publish      # -> context-plane@0.1.1
```

The adapters depend on `context-plane@^0.1.0`, which resolves to `0.1.1` for new installs (patch-
compatible). Optionally tag `v0.1.1` to match the release.
