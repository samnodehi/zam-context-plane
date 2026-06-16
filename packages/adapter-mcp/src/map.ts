// MCP capability mapper (docs/39 §3-§5).
//
// Turns aggregated MCP capability listings into a SCHEMA-VALID ZAM registry plus a
// side map of component id -> original MCP item (used to reconstruct the surfaced
// subset). Token cost is measured from the SERIALIZED capability — exactly what
// surfacing it costs in the model's tool list.

import { createHash } from 'node:crypto';
import { classifyCapability } from './classify.js';
import type {
  CapabilityKind,
  ComponentType,
  DefaultAction,
  McpCapabilities,
  McpPrompt,
  McpResource,
  McpTool,
  MappedItem,
  RegistryEntry,
} from './types.js';

export interface MapResult {
  registry: RegistryEntry[];
  items: Map<string, MappedItem>;
}

const tokensFor = (chars: number): number => Math.max(1, Math.ceil(chars / 4));

// The 10 promptFamily values. A relevance-tagged capability lists every family it is
// NOT required for as safe-to-omit, because the core omits via a safeToOmitWhen match
// (Path A) — `defaultAction: omit` alone fails open to include.
const ALL_FAMILIES = [
  'general_default',
  'simple_greeting',
  'coding_build_debug',
  'research_investigation',
  'ops_security_change_risk',
  'lifecycle_internal',
  'heartbeat_proactive',
  'group_chat_behavior',
  'tool_use_required',
  'history_sensitive',
] as const;

// MCP tools map to `skill`, NOT `tool`: the ZAM tool selector is runtime-availability-based
// and fail-open (it includes tools unless told they are unavailable — it cannot prune by
// relevance). The skill/memory selectors are the family-governed ones (requiredWhen /
// safeToOmitWhen) that relevance pruning needs. The adapter still emits each item as its
// original MCP kind (see governCapabilities) — the ZAM type only picks the governing selector.
const TYPE_FOR: Record<CapabilityKind, ComponentType> = {
  tool: 'skill',
  resource: 'memory',
  prompt: 'skill',
};

function sanitizeId(kind: CapabilityKind, server: string, name: string): string {
  const slug = `${server}.${name}`.replace(/[^a-zA-Z0-9._-]+/g, '-').toLowerCase();
  const id = `${kind}.${slug}`; // id prefix is the MCP kind (tool/resource/prompt) for readability
  return /^[a-z]/.test(id) ? id : `${kind}.x-${slug}`;
}

export function mapCapabilities(capabilities: McpCapabilities): MapResult {
  const registry: RegistryEntry[] = [];
  const items = new Map<string, MappedItem>();
  const seen = new Set<string>();

  const add = (
    kind: CapabilityKind,
    server: string,
    name: string,
    title: string,
    description: string,
    serialized: string,
    source: string,
    annotations: { readOnlyHint?: boolean; destructiveHint?: boolean } | undefined,
    raw: McpTool | McpResource | McpPrompt,
  ): void => {
    const id = sanitizeId(kind, server, name);
    if (seen.has(id)) return; // duplicate id -> first wins (deterministic via final sort)
    seen.add(id);

    const { families, destructive } = classifyCapability(`${name} ${description}`, annotations);
    // Destructive tools surface ONLY for an ops/change request; relevance-tagged
    // capabilities surface only for their families. Omission goes through the core's
    // Path A (a safeToOmitWhen match), so a tagged capability marks every OTHER family
    // safe-to-omit; an untagged (general-purpose) capability fails open (always surfaced).
    const requiredWhen = destructive ? ['ops_security_change_risk'] : families;
    const safeToOmitWhen = requiredWhen.length > 0 ? ALL_FAMILIES.filter((f) => !requiredWhen.includes(f)) : [];
    const defaultAction: DefaultAction = requiredWhen.length > 0 ? 'omit' : 'include';
    const charsApprox = serialized.length;

    registry.push({
      id,
      type: TYPE_FOR[kind],
      title: (title || name).slice(0, 120),
      summary: (description || title || name).slice(0, 300),
      source,
      tokensApprox: tokensFor(charsApprox),
      charsApprox,
      riskLevel: 'low', // omitting an MCP capability is safe; riskLevel is danger-of-omission (docs/05 §5)
      requiredWhen,
      safeToOmitWhen,
      defaultAction,
      omissionPolicy: 'allow',
      retainPolicy: 'optional',
      budgetPriority: destructive ? 6 : kind === 'tool' ? 4 : kind === 'resource' ? 6 : 5,
      evidenceRequired: null,
      tags: ['mcp', kind, server],
      version: '1.0.0',
      hash: createHash('sha256').update(serialized, 'utf8').digest('hex'),
    });

    const mapped: MappedItem = { id, kind, server };
    if (kind === 'tool') mapped.tool = raw as McpTool;
    else if (kind === 'resource') mapped.resource = raw as McpResource;
    else mapped.prompt = raw as McpPrompt;
    items.set(id, mapped);
  };

  for (const srv of capabilities.servers ?? []) {
    const server = srv.name || 'server';
    for (const t of srv.tools ?? []) {
      const serialized = JSON.stringify({
        name: t.name,
        description: t.description ?? '',
        inputSchema: t.inputSchema ?? {},
      });
      add('tool', server, t.name, t.annotations?.title ?? t.name, t.description ?? '', serialized, `mcp://${server}/tools/${t.name}`, t.annotations, t);
    }
    for (const r of srv.resources ?? []) {
      const nm = r.name ?? r.uri;
      const serialized = JSON.stringify({
        uri: r.uri,
        name: r.name ?? '',
        description: r.description ?? '',
        mimeType: r.mimeType ?? '',
      });
      add('resource', server, nm, nm, r.description ?? '', serialized, r.uri, undefined, r);
    }
    for (const p of srv.prompts ?? []) {
      const serialized = JSON.stringify({
        name: p.name,
        description: p.description ?? '',
        arguments: p.arguments ?? [],
      });
      add('prompt', server, p.name, p.name, p.description ?? '', serialized, `mcp://${server}/prompts/${p.name}`, undefined, p);
    }
  }

  registry.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (registry.length === 0) {
    throw new Error(
      'MCP adapter: no capabilities in input (expected { servers: [{ name, tools?, resources?, prompts? }] }).',
    );
  }
  return { registry, items };
}
