# 43 Adapter npm Publishing — Phase 4g

> **Document type:** Packaging note — Phase 4g (publish the three reference adapters to npm).
> **Status:** Publish-**READY** (configured + verified). Each `npm publish` is run by the **maintainer**
> (the agent holds no npm credentials).
> **Authority:** Adapter package config + their READMEs + the root README adapter table. **No change**
> to `src/**`, `schemas/**`, the core, the runtime, tests, or adapter **logic**.
> **Canonical sources:** `docs/42` (core publishing), `docs/37 §5` (the adapter contract).

---

## 1. Decisions

- **DQ-1 — Unscoped names (Sam-decided):** `zam-adapter-openclaw`, `zam-adapter-mcp`,
  `zam-adapter-telegram`. All verified available on npm; consistent with the unscoped core
  `context-plane`; no npm org needed. (The historical scoping docs `38`–`40` still use the dev-time
  `@zam/adapter-*` names; the **published** names are the `zam-adapter-*` set recorded here and in the
  adapter + root READMEs.)
- **DQ-2 — Core dependency: `file:../..` → `context-plane@^0.1.0`** (now that the core is published).
  External installs pull the real core from npm; local dev/CI `npm install` also fetches it. The
  adapters now build/test against the **published** core — acceptable, since the core is the stable,
  published product.
- **DQ-3 — `files: ["dist", "<example>"]`** per adapter (`example-workspace` / `example-capabilities.json`
  / `example-bot.json`), so installers get the runnable demo. `prepublishOnly: "npm run build && npm test"`.
- **DQ-4 — Standard metadata** added (license / author / repository[+directory] / homepage / bugs /
  keywords).
- **Honest framing unchanged:** these are *reference* adapters — the **logic is real and reusable** on
  real inputs; only the bundled **examples** are synthetic (each README states its scope).

## 2. Verification (done — clean install against the published core)

| adapter | build | tests | pack: forbidden / dist / example |
|---|---|---|---|
| `zam-adapter-openclaw` | ok | 12/12 | 0 / 20 / 14 |
| `zam-adapter-mcp` | ok | 11/11 | 0 / 20 / 1 |
| `zam-adapter-telegram` | ok | 10/10 | 0 / 24 / 1 |

Each fetched `context-plane@0.1.0` from npm, built, tested, and packs to `dist` + its example only
(0 files from `src/`, `tests/`, `node_modules/`).

## 3. Publish — maintainer procedure (per adapter)

Published under the **maintainer's** npm account.

```bash
cd packages/adapter-openclaw && npm install && npm publish   # -> zam-adapter-openclaw
cd ../adapter-mcp            && npm install && npm publish    # -> zam-adapter-mcp
cd ../adapter-telegram       && npm install && npm publish    # -> zam-adapter-telegram
```

`prepublishOnly` auto-runs `npm run build && npm test` first. Unscoped names are public by default —
no `--access public` needed.

## 4. After publish

`npm install zam-adapter-mcp` (etc.) works for everyone. The full family on npm is then
`context-plane` + the three `zam-adapter-*` packages. Optional later: a publish-on-tag GitHub Actions
workflow (`git tag` → auto-publish via an npm-token secret).
