// Dependency-free frontmatter parser for the OpenClaw adapter (docs/38 §5).
//
// Supports the constrained, FLAT frontmatter block the example workspace uses:
//   ---
//   key: value
//   listKey: [a, b, c]
//   ---
//   <body>
// Scalar values are strings; bracketed values are parsed as string arrays. No
// nesting, no YAML dependency. CRLF-safe (this repo is developed on Windows).

export interface ParsedFrontmatter {
  data: Record<string, string | string[]>;
  body: string;
}

// Leading frontmatter fence: `---` ... `---`, then the body. `?` is non-greedy so
// only the FIRST fence pair is consumed; `---` inside the body is left untouched.
const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const m = FENCE.exec(raw);
  if (!m) return { data: {}, body: raw.trim() };

  const data: Record<string, string | string[]> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (!key || key.startsWith('#')) continue;
    const rest = line.slice(idx + 1).trim();
    if (rest.startsWith('[') && rest.endsWith(']')) {
      data[key] = rest
        .slice(1, -1)
        .split(',')
        .map((s) => stripQuotes(s.trim()))
        .filter((s) => s.length > 0);
    } else {
      data[key] = stripQuotes(rest);
    }
  }
  return { data, body: (m[2] ?? '').trim() };
}

function stripQuotes(s: string): string {
  if (
    s.length >= 2 &&
    ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}
