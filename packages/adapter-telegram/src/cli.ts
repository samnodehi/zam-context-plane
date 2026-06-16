#!/usr/bin/env node
// zam-telegram — CLI for the Telegram governance adapter (docs/40 §4).
//   zam-telegram --bot <file.json> --text "<msg>" [--chat-type private|group|supergroup] [--reply] [--json]
// Builds a synthetic Telegram update from the flags, governs the bot context for it,
// and prints the governed prompt + a savings line. The bot file is a BotComponent[]
// (or { components: [...] }).

import { readFileSync } from 'node:fs';
import { governUpdate } from './index.js';
import type { BotComponent, TelegramUpdate } from './types.js';

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
  const botPath = typeof args.bot === 'string' ? args.bot : '';
  const text = typeof args.text === 'string' ? args.text : '';
  const chatTypeArg = typeof args['chat-type'] === 'string' ? (args['chat-type'] as string) : 'private';

  if (!botPath || !text) {
    console.error('Usage: zam-telegram --bot <file.json> --text "<msg>" [--chat-type private|group|supergroup] [--reply] [--json]');
    process.exit(2);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(botPath, 'utf8'));
  } catch (e) {
    console.error(`zam-telegram: could not read/parse bot file: ${(e as Error).message}`);
    process.exit(1);
    return;
  }
  const components = (Array.isArray(parsed) ? parsed : (parsed as { components?: BotComponent[] }).components) ?? [];

  const chatType = (['private', 'group', 'supergroup'].includes(chatTypeArg) ? chatTypeArg : 'private') as
    | 'private'
    | 'group'
    | 'supergroup';
  const update: TelegramUpdate = {
    message: {
      message_id: 1,
      chat: { id: 1, type: chatType },
      text,
      ...(args.reply ? { reply_to_message: { message_id: 0, chat: { id: 1, type: chatType }, text: '(earlier)' } } : {}),
    },
  };

  const result = governUpdate({ components: components as BotComponent[], update });
  const s = result.stats;

  if (args.json) {
    console.log(JSON.stringify({ promptFamily: result.promptFamily, signals: result.signals, stats: s, prompt: result.prompt }, null, 2));
    return;
  }

  const via = result.signals ? `signals(${result.signals.promptFamily})` : 'text-router';
  console.error(
    `[zam-telegram] family=${result.promptFamily} via=${via} ` +
      `selected=${s.selected} omitted=${s.omitted} tokens=${s.selectedTokens}/${s.baselineTokens} ` +
      `saved=${(s.savedPct * 100).toFixed(1)}%`,
  );
  console.log(result.prompt);
}

main();
