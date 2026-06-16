// OpenClaw workspace extractor (docs/38 §3-§5).
//
// Walks an OpenClaw-shaped workspace and produces a SCHEMA-VALID ZAM registry
// (schemas/inputs/component-registry.schema.json — 18 required fields) plus a
// side map of component id -> body, used later by the assembler.
//
// A file becomes a component IFF its frontmatter declares a recognized `type`.
// Sizes are MEASURED from the file body (the real value-add); `hash` is a real
// SHA-256 of the body. DQ-5 normalization keeps every emitted entry loadable
// without loader warnings/overrides.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parseFrontmatter } from './frontmatter.js';

export type ComponentType =
  | 'scaffold'
  | 'skill'
  | 'tool'
  | 'history'
  | 'memory'
  | 'output_format';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type DefaultAction = 'include' | 'omit' | 'defer';
export type OmissionPolicy = 'allow' | 'fail_open' | 'never';
export type RetainPolicy = 'optional' | 'durable' | 'mandatory' | 'safety_critical';

/** A registry entry — the 18 required component fields (docs/05 §3). */
export interface RegistryEntry {
  id: string;
  type: ComponentType;
  title: string;
  summary: string;
  source: string;
  tokensApprox: number;
  charsApprox: number;
  riskLevel: RiskLevel;
  requiredWhen: string[];
  safeToOmitWhen: string[];
  defaultAction: DefaultAction;
  omissionPolicy: OmissionPolicy;
  retainPolicy: RetainPolicy;
  budgetPriority: number;
  evidenceRequired: string | null;
  tags: string[];
  version: string;
  hash: string | null;
}

export interface ExtractResult {
  registry: RegistryEntry[];
  /** component id -> raw body (frontmatter stripped); consumed by the assembler. */
  bodies: Map<string, string>;
}

const KNOWN_TYPES = new Set<ComponentType>([
  'scaffold',
  'skill',
  'tool',
  'history',
  'memory',
  'output_format',
]);

const TYPE_DEFAULTS: Record<ComponentType, { defaultAction: DefaultAction; budgetPriority: number }> = {
  scaffold: { defaultAction: 'include', budgetPriority: 3 },
  skill: { defaultAction: 'omit', budgetPriority: 5 },
  tool: { defaultAction: 'include', budgetPriority: 4 },
  history: { defaultAction: 'include', budgetPriority: 5 },
  memory: { defaultAction: 'omit', budgetPriority: 6 },
  output_format: { defaultAction: 'include', budgetPriority: 7 },
};

const RISKS = new Set<RiskLevel>(['low', 'medium', 'high', 'critical']);
const OMISSIONS = new Set<OmissionPolicy>(['allow', 'fail_open', 'never']);
const RETAINS = new Set<RetainPolicy>(['optional', 'durable', 'mandatory', 'safety_critical']);
const ACTIONS = new Set<DefaultAction>(['include', 'omit', 'defer']);

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(full);
  }
  return out;
}

function asString(v: string | string[] | undefined, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}
function asArray(v: string | string[] | undefined): string[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.length > 0) return [v];
  return [];
}

const tokensFor = (chars: number): number => Math.max(1, Math.ceil(chars / 4));

/**
 * Extract a schema-valid ZAM registry from an OpenClaw-shaped workspace directory.
 * Throws if the directory is missing or contains no ZAM component files.
 */
export function extractWorkspace(workspaceDir: string): ExtractResult {
  let stat: import('node:fs').Stats;
  try {
    stat = statSync(workspaceDir);
  } catch {
    throw new Error(`OpenClaw adapter: workspace not found: ${workspaceDir}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`OpenClaw adapter: not a directory: ${workspaceDir}`);
  }

  const registry: RegistryEntry[] = [];
  const bodies = new Map<string, string>();
  const seen = new Set<string>();

  for (const file of walk(workspaceDir)) {
    let raw: string;
    try {
      raw = readFileSync(file, 'utf8');
    } catch {
      continue; // unreadable file -> skip, never fatal (DQ-7)
    }
    const { data, body } = parseFrontmatter(raw);
    const rawType = typeof data.type === 'string' ? data.type : '';
    if (!KNOWN_TYPES.has(rawType as ComponentType)) continue; // not a ZAM component file
    const type = rawType as ComponentType;
    const td = TYPE_DEFAULTS[type];

    const rel = relative(workspaceDir, file).split(sep).join('/');
    const id = asString(
      data.id,
      `${type}.${rel.replace(/[^a-z0-9._-]+/gi, '-').toLowerCase()}`,
    );
    if (seen.has(id)) continue; // duplicate id -> first wins (deterministic via final sort)
    seen.add(id);

    const charsApprox = body.length;

    let riskLevel = asString(data.riskLevel, 'low') as RiskLevel;
    if (!RISKS.has(riskLevel)) riskLevel = 'low';
    let omissionPolicy = asString(data.omissionPolicy, 'allow') as OmissionPolicy;
    if (!OMISSIONS.has(omissionPolicy)) omissionPolicy = 'allow';
    let retainPolicy = asString(data.retainPolicy, 'optional') as RetainPolicy;
    if (!RETAINS.has(retainPolicy)) retainPolicy = 'optional';
    let defaultAction = asString(data.defaultAction, td.defaultAction) as DefaultAction;
    if (!ACTIONS.has(defaultAction)) defaultAction = td.defaultAction;

    // DQ-5 normalization: keep the registry loadable without loader warnings/overrides.
    // (a) critical risk must carry a hard protection; (b) a hard-protected component
    // never keeps defaultAction: omit (the loader would override it anyway).
    if (riskLevel === 'critical' && omissionPolicy !== 'never' && retainPolicy !== 'safety_critical') {
      omissionPolicy = 'never';
    }
    const hardProtected =
      omissionPolicy === 'never' || retainPolicy === 'mandatory' || retainPolicy === 'safety_critical';
    if (hardProtected && defaultAction === 'omit') defaultAction = 'include';

    let budgetPriority = Number.parseInt(asString(data.budgetPriority, String(td.budgetPriority)), 10);
    if (!Number.isFinite(budgetPriority) || budgetPriority < 1 || budgetPriority > 10) {
      budgetPriority = td.budgetPriority;
    }

    const title = asString(data.title, id).slice(0, 120);
    const entry: RegistryEntry = {
      id,
      type,
      title,
      summary: asString(data.summary, title).slice(0, 300),
      source: rel,
      tokensApprox: tokensFor(charsApprox),
      charsApprox,
      riskLevel,
      requiredWhen: asArray(data.requiredWhen),
      safeToOmitWhen: asArray(data.safeToOmitWhen),
      defaultAction,
      omissionPolicy,
      retainPolicy,
      budgetPriority,
      evidenceRequired: null,
      tags: asArray(data.tags),
      version: asString(data.version, '1.0.0'),
      hash: createHash('sha256').update(body, 'utf8').digest('hex'),
    };
    registry.push(entry);
    bodies.set(id, body);
  }

  registry.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  if (registry.length === 0) {
    throw new Error(
      `OpenClaw adapter: no ZAM component files under ${workspaceDir} ` +
        `(a component file needs frontmatter declaring a recognized 'type').`,
    );
  }
  return { registry, bodies };
}
