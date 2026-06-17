# 42 npm Publishing — Phase 4f

> **Document type:** Packaging + procedure note — Phase 4f (make the core installable via `npm install`).
> **Status:** Publish-**READY** — configured and verified with `npm pack --dry-run`. The actual
> `npm publish` is run by the **maintainer** (it requires the maintainer's npm authentication; the
> agent holds no npm credentials).
> **Authority:** Packaging config + docs only — root `package.json` publish fields + the README install
> line. **No change** to `src/**`, `schemas/**`, `tests/**`, core behavior, the runtime, or the adapters.
> **Canonical sources:** `docs/41` (public launch), the README, `src/cli/commands/plan.ts`
> (`resolveSchemaBase()` — the runtime schema load that dictates `files`).

---

## 1. Purpose

Make the open-core product installable with a single **`npm install context-plane`**, so consumers
don't have to clone + build.

## 2. Decisions

- **DQ-1 — Publish the CORE, unscoped, as `context-plane`** (verified **available** on npm). This is the
  product: the library (`import { plan } from 'context-plane'`), the `context-plane` CLI, and the
  `./http` service.
- **DQ-2 — `files: ["dist", "schemas"]`.** `schemas/` **must** ship: the CLI loads JSON Schemas from
  disk at runtime — `src/cli/commands/plan.ts` → `resolveSchemaBase()` resolves `<pkg>/schemas`. npm
  always also includes `package.json`, `README.md`, and `LICENSE`. Everything else (`src/`, `tests/`,
  `fixtures/`, `benchmarks/`, `docs/`, `packages/`) is excluded.
- **DQ-3 — `prepublishOnly: "npm run build && npm test"`.** `dist/` is gitignored, so publishing must
  build it fresh; the test run gates against shipping a broken tarball.
- **DQ-4 — Standard metadata added:** `license` (Apache-2.0), `author`, `repository`, `homepage`,
  `bugs`, `keywords`; the `description` updated from "CLI MVP" to the open-core positioning.
- **DQ-5 — Adapters (`@zam/adapter-*`) are NOT published in this pass.** Two reasons: (a) the `@zam`
  npm scope ownership is unconfirmed; (b) each adapter depends on the core via `file:../..`, which must
  become a published version range (`^0.1.0`) plus an npm-workspaces setup before they can publish
  without breaking local dev/CI. They remain copy-from templates for now; publishing them is a clean
  follow-up once the core is on npm.

## 3. Verification (done — `npm run build && npm pack --dry-run`)

The tarball would contain **exactly** the right files and nothing else:
- `dist/**` (208 files) + `schemas/**` (25 files) + `package.json` + `README.md` + `LICENSE`.
- **0** files from `src/`, `tests/`, `fixtures/`, `benchmarks/`, `packages/`, or `node_modules/`.
- `context-plane@0.1.0` — 236 files, ~254 kB packed / ~1.1 MB unpacked.

## 4. Publish — maintainer procedure (run when ready)

ZAM is published under the **maintainer's** npm account; the agent does not hold npm credentials.

```bash
npm login                      # one-time, maintainer's npm account
npm publish --access public    # prepublishOnly auto-runs `npm run build && npm test` first
```

For later releases: bump `version` (semver) and tag to match the GitHub release.

## 5. After publish

`npm install context-plane` works for everyone, and the README install line is live. Optional
follow-ups: publish the adapters (DQ-5 — needs the scope + workspace setup), and add a publish-on-tag
GitHub Actions workflow (so `git tag vX.Y.Z` auto-publishes via an npm-token secret).
