// Telegram update -> requestSignals (docs/40 §3 DQ-3) — the novel part of this adapter.
//
// A Telegram message's "group-ness" or "this is a reply to earlier" lives in METADATA,
// not in the message text, so the deterministic text router cannot see it. This maps the
// metadata to the core's requestSignals caller tier (which takes precedence over the text
// router). When there is no strong metadata signal, it returns null so the core's
// deterministic text router classifies the message normally.

import type { RequestSignals, TelegramUpdate } from './types.js';

export function deriveSignals(update: TelegramUpdate): RequestSignals | null {
  const msg = update?.message;
  if (!msg) return null;

  const chatType = msg.chat?.type;
  if (chatType === 'group' || chatType === 'supergroup') {
    // Group/supergroup -> govern as group-chat behavior (metadata wins over text).
    return { promptFamily: 'group_chat_behavior', familyConfidence: 0.95, injectionSuspect: false };
  }

  if (msg.reply_to_message) {
    // A reply references prior conversation -> history-sensitive.
    return { promptFamily: 'history_sensitive', familyConfidence: 0.9, injectionSuspect: false };
  }

  // No strong metadata signal -> defer to the core's deterministic text router.
  return null;
}
