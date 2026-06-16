import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { governUpdate } from '../src/index.js';
import type { BotComponent, TelegramChat, TelegramUpdate } from '../src/types.js';

const COMPONENTS = JSON.parse(
  readFileSync(fileURLToPath(new URL('../example-bot.json', import.meta.url)), 'utf8'),
) as BotComponent[];

const msg = (text: string, type: TelegramChat['type'] = 'private', reply = false): TelegramUpdate => ({
  message: {
    message_id: 1,
    chat: { id: 1, type },
    text,
    ...(reply ? { reply_to_message: { message_id: 0, chat: { id: 1, type } } } : {}),
  },
});
const govern = (text: string, type: TelegramChat['type'] = 'private', reply = false) =>
  governUpdate({ components: COMPONENTS, update: msg(text, type, reply) });
const selectedIds = (r: ReturnType<typeof govern>): Set<string> =>
  new Set(r.plan.promptPlan.selectedComponents.map((c) => c.componentId));

describe('governUpdate (end-to-end through the deterministic core)', () => {
  it('partition completeness + safety always present', () => {
    const r = govern('hello');
    expect(r.stats.selected + r.stats.omitted + r.stats.deferred).toBe(r.registry.length);
    const sel = selectedIds(r);
    for (const c of r.registry) {
      if (c.omissionPolicy === 'never') expect(sel.has(c.id)).toBe(true);
    }
  });

  it('group message -> group_chat_behavior via requestSignals; etiquette surfaced, coding omitted', () => {
    const r = govern('hi everyone, what is up?', 'group');
    expect(r.signals?.promptFamily).toBe('group_chat_behavior');
    expect(r.promptFamily).toBe('group_chat_behavior');
    const sel = selectedIds(r);
    expect(sel.has('scaffold.group-etiquette')).toBe(true);
    expect(sel.has('skill.coding')).toBe(false);
  });

  it('private coding message -> text router -> coding skill surfaced, etiquette omitted', () => {
    const r = govern('Fix the failing build and debug the TypeScript compiler error in this file.');
    expect(r.signals).toBeNull();
    expect(r.promptFamily).toBe('coding_build_debug');
    const sel = selectedIds(r);
    expect(sel.has('skill.coding')).toBe(true);
    expect(sel.has('scaffold.group-etiquette')).toBe(false);
  });

  it('greeting -> simple_greeting; small-talk surfaced, savings high', () => {
    const r = govern('hello');
    expect(r.promptFamily).toBe('simple_greeting');
    expect(r.stats.savedPct).toBeGreaterThan(0.3);
    expect(selectedIds(r).has('skill.smalltalk')).toBe(true);
  });

  it('reply message -> history_sensitive via requestSignals; history surfaced', () => {
    const r = govern('yes, do that', 'private', true);
    expect(r.signals?.promptFamily).toBe('history_sensitive');
    expect(r.promptFamily).toBe('history_sensitive');
    expect(selectedIds(r).has('history.recent')).toBe(true);
  });
});
