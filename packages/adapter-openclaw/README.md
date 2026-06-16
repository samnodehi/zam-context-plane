# @zam/adapter-openclaw

The first **reference adapter** for the ZAM context plane. It demonstrates the adapter contract
(`docs/37 §5`) end-to-end on an **OpenClaw-shaped agent workspace**: take files on disk, govern them
through the deterministic core, and emit a smaller, safe, assembled prompt with an auditable savings
report.

> **Honest scope:** this targets a *documented synthetic* OpenClaw-shaped workspace
> (`example-workspace/`), not a live `~/.openclaw` integration — OpenClaw's real internals were never
> captured (`docs/03`/`docs/04`). The *contract* (files → registry → `plan()` → prompt) is real and
> reusable; the file conventions are ours and documented in `docs/38`.

## The contract (what every adapter does)

1. **Extract** workspace files → a ZAM registry (`extractWorkspace`).
2. **Plan** — call the deterministic core `plan()` (no per-turn model call required).
3. **Assemble** the prompt from the **selected** components only (`assemblePrompt`).

`governWorkspace` does all three in one call.

## Usage

```ts
import { governWorkspace } from '@zam/adapter-openclaw';

const { promptFamily, prompt, stats } = governWorkspace({
  workspaceDir: './example-workspace',
  requestText: 'Help me debug the failing build.',
});
// prompt: the governed prompt (selected components only)
// stats:  { selected, omitted, deferred, baselineTokens, selectedTokens, savedPct, ... }
```

### CLI

```bash
zam-openclaw --workspace ./example-workspace --request "Help me debug the failing build."
# prompt -> stdout; a savings line -> stderr.  Add --json for a machine-readable object.
```

## Workspace conventions

A file becomes a governed component **iff** its frontmatter declares a recognized `type`
(`scaffold` | `skill` | `tool` | `history` | `memory` | `output_format`). The frontmatter carries
the ZAM governance metadata; sizes are measured from the body; `hash` is a real SHA-256. Missing
fields fall back to documented type defaults. See `docs/38 §3–§4` for the full rules.

```markdown
---
id: skill.coding-guide
type: skill
title: Coding & Debugging Guide
summary: Conventions for code review, debugging, and builds.
riskLevel: low
requiredWhen: [coding_build_debug]
safeToOmitWhen: [simple_greeting, research_investigation, general_default]
defaultAction: omit
omissionPolicy: allow
retainPolicy: optional
budgetPriority: 5
tags: [skill, coding]
version: 1.0.0
---
<the component body — included verbatim when this component is selected>
```

## Build & test

```bash
npm install   # links the workspace-local `context-plane` (file:../..); build the core first
npm run build
npm test
```
