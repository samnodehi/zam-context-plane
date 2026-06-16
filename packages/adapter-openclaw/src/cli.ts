#!/usr/bin/env node
// zam-openclaw — CLI for the OpenClaw reference adapter (docs/38 §5).
//   zam-openclaw --workspace <dir> --request "<text>" [--json]
// Prints the governed prompt to stdout and a savings line to stderr (so the
// prompt can be piped cleanly). Dependency-free arg parsing.

import { governWorkspace } from './index.js';

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
  const workspaceDir = typeof args.workspace === 'string' ? args.workspace : '';
  const requestText = typeof args.request === 'string' ? args.request : '';

  if (!workspaceDir || !requestText) {
    console.error('Usage: zam-openclaw --workspace <dir> --request "<text>" [--json]');
    process.exit(2);
  }

  const result = governWorkspace({ workspaceDir, requestText });

  if (args.json) {
    console.log(
      JSON.stringify(
        { promptFamily: result.promptFamily, stats: result.stats, prompt: result.prompt },
        null,
        2,
      ),
    );
    return;
  }

  const s = result.stats;
  console.error(
    `[zam-openclaw] family=${result.promptFamily} ` +
      `selected=${s.selected} omitted=${s.omitted} deferred=${s.deferred} ` +
      `tokens=${s.selectedTokens}/${s.baselineTokens} saved=${(s.savedPct * 100).toFixed(1)}%`,
  );
  console.log(result.prompt);
}

main();
