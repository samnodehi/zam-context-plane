// Deterministic capability classifier (docs/39 §4).
//
// Maps an MCP capability's name + description to promptFamily relevance tags via a
// documented keyword table, and derives a riskLevel from MCP annotations. No model
// call — this is the adapter's documented mapping policy, the analogue of the
// OpenClaw adapter's frontmatter governance.

const FAMILY_KEYWORDS: ReadonlyArray<{ family: string; words: readonly string[] }> = [
  {
    family: 'coding_build_debug',
    words: ['code', 'file', 'edit', 'patch', 'diff', 'build', 'compile', 'lint', 'test', 'debug', 'git', 'repo'],
  },
  {
    family: 'research_investigation',
    words: ['search', 'web', 'fetch', 'browse', 'query', 'lookup', 'scrape', 'docs', 'wiki', 'research', 'investigate'],
  },
  {
    family: 'ops_security_change_risk',
    words: [
      'deploy', 'shell', 'exec', 'run', 'command', 'kill', 'delete', 'remove', 'drop', 'rotate',
      'secret', 'credential', 'database', 'db', 'admin', 'sudo', 'kubectl', 'terraform',
    ],
  },
  {
    family: 'history_sensitive',
    words: ['history', 'conversation', 'session', 'recall', 'memory'],
  },
];

export interface Classification {
  /** Matched promptFamilies (relevance). */
  families: string[];
  /** True if the MCP destructiveHint is set — gates the capability to the ops family. */
  destructive: boolean;
}

/** Tokenize a capability label: split camelCase, treat non-alphanumerics as separators. */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .toLowerCase()
      .split(' ')
      .filter((t) => t.length > 0),
  );
}

export function classifyCapability(
  text: string,
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean },
): Classification {
  const tokens = tokenize(text);
  const families: string[] = [];
  for (const { family, words } of FAMILY_KEYWORDS) {
    if (words.some((w) => tokens.has(w))) families.push(family);
  }

  // riskLevel is intentionally NOT derived here. Per docs/05 §5, riskLevel is the danger of
  // OMITTING a component — and omitting an MCP capability is safe (it just isn't offered this
  // turn). The destructive hint gates a tool to the ops family (see map.ts); it must NOT raise
  // omission-risk, which would fail-open *include* it (the opposite of safe for tool surfacing).
  const destructive = annotations?.destructiveHint === true;
  return { families, destructive };
}
