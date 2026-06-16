# @zam/adapter-mcp

The **strategic second** reference adapter for the ZAM context plane (`docs/39`). It governs an MCP
client's aggregated capabilities: given the tools/resources/prompts exposed by the connected MCP
servers plus the user request, it returns only the subset worth surfacing this turn — directly
relieving the *"too many MCP servers blow my context budget"* problem.

Same contract as the OpenClaw adapter (`docs/38`), a completely different surface — which is the
point: it proves the deterministic core is **surface-independent** (portability).

> **Honest scope:** there is no live MCP transport here. The adapter operates on MCP capability
> *listings* (the standard `tools/list` / `resources/list` / `prompts/list` shapes, aggregated per
> server) supplied as data — with a synthetic `example-capabilities.json`. A real MCP host feeds its
> live listings; the mapping and governance are real and reusable.

## The contract

1. **Map** MCP capabilities → a ZAM registry (`mapCapabilities`) — tool→`tool`, resource→`memory`,
   prompt→`skill`; sizes measured from the *serialized* capability; relevance + risk derived
   deterministically (`docs/39 §4`).
2. **Plan** — the deterministic core `plan()` (no per-turn model call).
3. **Surface** — reconstruct the tools/resources/prompts to advertise this turn from the selected
   components.

`governCapabilities` does all three.

## Usage

```ts
import { governCapabilities } from '@zam/adapter-mcp';

const { promptFamily, surfaced, stats } = governCapabilities({
  capabilities,                 // { servers: [{ name, tools?, resources?, prompts? }] }
  requestText: 'Search the web for the latest release notes.',
});
// surfaced.tools / surfaced.resources / surfaced.prompts — advertise only these to the model
// stats.savedPct — fraction of capability tokens pruned this turn
```

### CLI

```bash
zam-mcp --capabilities ./example-capabilities.json --request "Deploy the service to production."
# surfaced names -> stdout; a savings line -> stderr.  Add --json for the full object.
```

## How governance works (deterministic, documented)

- **Relevance.** A capability's `name + description` is matched against a keyword→`promptFamily` table
  (`docs/39 §4`); matched families become `requiredWhen` (surface only for those). No match ⇒
  fail-open `include`.
- **Risk.** MCP `annotations.destructiveHint` ⇒ surface **only** for an ops/change request (a
  destructive tool is never advertised for a greeting). `readOnlyHint` ⇒ low risk.

## Build & test

```bash
npm install   # links the workspace-local `context-plane` (file:../..); build the core first
npm run build
npm test
```
