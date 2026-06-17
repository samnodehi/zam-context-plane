# 41 Public Launch Readiness — Phase 4e

> **Document type:** Launch checklist + decisions — Phase 4e (open-core public-launch prep).
> **Status:** Implemented (content prep). **The visibility flip itself is performed by the maintainer,
> not automated.**
> **Authority:** Repo presentation only — adds `LICENSE` / `README` / `CONTRIBUTING` / `SECURITY`,
> removes the orphaned closed-source V4 artifacts. **No change** to `src/**`, `schemas/**`,
> `fixtures/**`, `tests/**`, the core, the runtime, or the adapters.
> **Canonical sources:** `docs/37` (open-core boundary), F1 (open-core), `DEBT.md` (C5 commercial
> remainder), `docs/31` (the SUPERSEDED V4 plan whose artifacts are removed here).

---

## 1. Purpose

Prepare the repository to be a coherent, honest, public **open-core** reference — then hand the actual
visibility flip to the maintainer.

## 2. Decisions

- **DQ-1 — License = Apache-2.0** (permissive + explicit patent grant), copyright "Sam Noodehi".
  `LICENSE` added at the root (per `docs/37 §4`: never flip public without the license first).
- **DQ-2 — Remove the orphaned, retired closed-source V4 artifacts** (Sam-decided): `Dockerfile`,
  `docker-compose.yml`, `.dockerignore`, `packages/sdk/` (`@zamapi/sdk`). They were built on the
  *"source must never be accessible"* thesis (`docs/31`, SUPERSEDED), are **not** wired into the
  workspace or CI, and contradict open-core. They remain in git history; any future container/SDK work
  is re-scoped under *hosting*, not resurrected (`docs/37 §3`).
- **DQ-3 — Rewrite the root README** as an open-core introduction: the problem, what/why, the
  benchmark evidence, the three adapters, the architecture, quickstart, repo layout, status, and the
  open-core boundary.
- **DQ-4 — Add standard OSS files:** `CONTRIBUTING.md` (the project's doc-before-code /
  no-deferred-debt workflow) and `SECURITY.md` (private vulnerability reporting via GitHub — **no
  personal email published**).
- **DQ-5 — Keep `PROJECT_MASTER_PLAN.md`** as an internal vision/history document (Sam-decided).

## 3. Out of scope

- **The visibility flip itself** (a sharing-permission change) — performed by the maintainer, not
  automated (§4). - Hosting/SaaS (the C5 commercial remainder). - A typed client SDK or container, if
  wanted later, is re-scoped under *hosting*, not restored from `docs/31`.

## 4. The flip — maintainer checklist (run when the prepped content is approved)

1. Confirm this PR is merged to `main` and CI is green.
2. Confirm `LICENSE` exists at the root (it does, Apache-2.0).
3. *(Recommended)* Enable **Private vulnerability reporting** in the repo's Security settings.
4. **Flip visibility to public** — either the GitHub UI (*Settings → General → Danger Zone → Change
   repository visibility → Public*) or:
   ```bash
   gh repo edit samnodehi/zam-context-plane --visibility public
   ```
5. *(Optional)* Add repository topics and a description for discoverability.

## 5. Verification

- `LICENSE`, `README.md`, `CONTRIBUTING.md`, `SECURITY.md` present and accurate; no `Dockerfile` /
  `docker-compose.yml` / `.dockerignore` / `packages/sdk` remain in the tree.
- Root suite **743/743** (was 757 — the removed `packages/sdk` contributed 14 tests that the root
  `vitest.config.ts` `include` picked up; that include line is removed in this pass), runtime
  **354/354**, adapters **12 + 11 + 10**; both core builds green, CI green.
