#!/usr/bin/env node
// zam-mcp — CLI for the MCP governance adapter (docs/39 §5).
//   zam-mcp --capabilities <file.json> --request "<text>" [--json]
// Reads an MCP capabilities file ({ servers: [...] }), governs it for the request,
// and prints the surfaced capability names + a savings line (stderr). --json emits
// the full surfaced object + stats to stdout. Dependency-free arg parsing.

import { readFileSync } from 'node:fs';
import { governCapabilities } from './index.js';
import type { McpCapabilities } from './types.js';

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const capPath = typeof args.capabilities === 'string' ? args.capabilities : '';
  const requestText = typeof args.request === 'string' ? args.request : '';

  if (!capPath || !requestText) {
    console.error('Usage: zam-mcp --capabilities <file.json> --request "<text>" [--json]');
    process.exit(2);
  }

  let capabilities: McpCapabilities;
  try {
    capabilities = JSON.parse(readFileSync(capPath, 'utf8')) as McpCapabilities;
  } catch (e) {
    console.error(`zam-mcp: could not read/parse capabilities file: ${(e as Error).message}`);
    process.exit(1);
    return;
  }

  const result = governCapabilities({ capabilities, requestText });
  const s = result.stats;

  if (args.json) {
    console.log(JSON.stringify({ promptFamily: result.promptFamily, stats: s, surfaced: result.surfaced }, null, 2));
    return;
  }

  console.error(
    `[zam-mcp] family=${result.promptFamily} ` +
      `tools=${s.surfacedTools}/${s.totalTools} resources=${s.surfacedResources}/${s.totalResources} ` +
      `prompts=${s.surfacedPrompts}/${s.totalPrompts} tokens=${s.surfacedTokens}/${s.baselineTokens} ` +
      `saved=${(s.savedPct * 100).toFixed(1)}%`,
  );
  console.log('Surfaced tools:     ' + (result.surfaced.tools.map((t) => t.name).join(', ') || '(none)'));
  console.log('Surfaced resources: ' + (result.surfaced.resources.map((r) => r.name ?? r.uri).join(', ') || '(none)'));
  console.log('Surfaced prompts:   ' + (result.surfaced.prompts.map((p) => p.name).join(', ') || '(none)'));
}

main();
