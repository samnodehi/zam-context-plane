// Bot context-inventory builder (docs/40 §3 DQ-2).
//
// Turns a bot's light `BotComponent[]` (body + optional governance) into a
// SCHEMA-VALID ZAM registry + a body map. Fills type defaults, applies the
// loadable-by-construction normalization (same rules as the OpenClaw adapter),
// and measures tokensApprox/charsApprox/hash from the body.

import { createHash } from 'node:crypto';
import type {
  BotComponent,
  ComponentType,
  DefaultAction,
  OmissionPolicy,
  RegistryEntry,
  RetainPolicy,
  RiskLevel,
} from './types.js';

export interface BuildResult {
  registry: RegistryEntry[];
  bodies: Map<string, string>;
}

const TYPE_DEFAULTS: Record<ComponentType, { defaultAction: DefaultAction; budgetPriority: number }> = {
  scaffold: { defaultAction: 'include', budgetPriority: 3 },
  skill: { defaultAction: 'omit', budgetPriority: 5 },
  tool: { defaultAction: 'include', budgetPriority: 4 },
  history: { defaultAction: 'include', budgetPriority: 5 },
  memory: { defaultAction: 'omit', budgetPriority: 6 },
  output_format: { defaultAction: 'include', budgetPriority: 7 },
};

const tokensFor = (chars: number): number => Math.max(1, Math.ceil(chars / 4));

export function buildRegistry(components: BotComponent[]): BuildResult {
  const registry: RegistryEntry[] = [];
  const bodies = new Map<string, string>();
  const seen = new Set<string>();

  for (const c of components ?? []) {
    if (!c || !c.id || !c.type || seen.has(c.id)) continue;
    seen.add(c.id);
    const td = TYPE_DEFAULTS[c.type] ?? TYPE_DEFAULTS.skill;
    const body = c.body ?? '';
    const charsApprox = body.length;

    const riskLevel: RiskLevel = c.riskLevel ?? 'low';
    let omissionPolicy: OmissionPolicy = c.omissionPolicy ?? 'allow';
    const retainPolicy: RetainPolicy = c.retainPolicy ?? 'optional';
    let defaultAction: DefaultAction = c.defaultAction ?? td.defaultAction;

    // Loadable-by-construction normalization (docs/38 DQ-5).
    if (riskLevel === 'critical' && omissionPolicy !== 'never' && retainPolicy !== 'safety_critical') {
      omissionPolicy = 'never';
    }
    const hardProtected =
      omissionPolicy === 'never' || retainPolicy === 'mandatory' || retainPolicy === 'safety_critical';
    if (hardProtected && defaultAction === 'omit') defaultAction = 'include';

    let budgetPriority = c.budgetPriority ?? td.budgetPriority;
    if (!Number.isFinite(budgetPriority) || budgetPriority < 1 || budgetPriority > 10) {
      budgetPriority = td.budgetPriority;
    }

    const title = (c.title || c.id).slice(0, 120);
    registry.push({
      id: c.id,
      type: c.type,
      title,
      summary: (c.summary || title).slice(0, 300),
      source: `telegram://bot/${c.id}`,
      tokensApprox: tokensFor(charsApprox),
      charsApprox,
      riskLevel,
      requiredWhen: c.requiredWhen ?? [],
      safeToOmitWhen: c.safeToOmitWhen ?? [],
      defaultAction,
      omissionPolicy,
      retainPolicy,
      budgetPriority,
      evidenceRequired: null,
      tags: c.tags ?? [],
      version: c.version ?? '1.0.0',
      hash: createHash('sha256').update(body, 'utf8').digest('hex'),
    });
    bodies.set(c.id, body);
  }

  registry.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (registry.length === 0) {
    throw new Error('Telegram adapter: no bot components provided (expected a non-empty BotComponent[]).');
  }
  return { registry, bodies };
}
