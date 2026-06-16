// @zam/adapter-telegram — the third reference adapter (docs/40).
//
// Governs a Telegram bot's per-message context: build the bot's context inventory
// into a registry, derive requestSignals from the update metadata (chat type, reply)
// — the core's caller tier, which takes precedence over the text router — and assemble
// the per-message prompt. Same docs/37 §5 contract; no per-turn model call.

import { plan as corePlan } from 'context-plane';
import { buildRegistry } from './build.js';
import { deriveSignals } from './signals.js';
import { assemblePrompt, type AssembleStats, type PromptPlan } from './assemble.js';
import type { BotComponent, RegistryEntry, RequestSignals, TelegramUpdate } from './types.js';

export { buildRegistry } from './build.js';
export { deriveSignals } from './signals.js';
export { assemblePrompt } from './assemble.js';
export type {
  BotComponent,
  RegistryEntry,
  RequestSignals,
  TelegramUpdate,
  TelegramMessage,
  TelegramChat,
} from './types.js';

interface PlanResult {
  promptPlan: PromptPlan;
  trace: unknown;
  summary: string;
}

// Structural annotation over the documented prompt-plan; requestSignals is the
// optional caller tier (src/core/api.ts) that takes precedence over the text router.
const plan = corePlan as unknown as (input: {
  request: { text: string };
  registry: RegistryEntry[];
  requestSignals?: RequestSignals | null;
}) => PlanResult;

export interface GovernUpdateInput {
  components: BotComponent[];
  update: TelegramUpdate;
}

export interface GovernUpdateResult {
  promptFamily: string;
  /** The requestSignals derived from metadata, or null when the text router was used. */
  signals: RequestSignals | null;
  prompt: string;
  stats: AssembleStats;
  registry: RegistryEntry[];
  plan: PlanResult;
}

/**
 * Govern a Telegram bot's context for a single incoming update: build registry ->
 * derive signals from metadata (or defer to the text router) -> plan() -> assemble.
 */
export function governUpdate(input: GovernUpdateInput): GovernUpdateResult {
  const { registry, bodies } = buildRegistry(input.components);
  const text = input.update?.message?.text ?? '';
  const signals = deriveSignals(input.update);
  const result = plan({
    request: { text },
    registry,
    ...(signals ? { requestSignals: signals } : {}),
  });
  const { prompt, stats } = assemblePrompt(result.promptPlan, registry, bodies);
  return {
    promptFamily: result.promptPlan.promptFamily,
    signals,
    prompt,
    stats,
    registry,
    plan: result,
  };
}
