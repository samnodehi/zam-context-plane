import { describe, it, expect } from 'vitest';
import { deriveSignals } from '../src/signals.js';

describe('deriveSignals (metadata -> requestSignals)', () => {
  it('group chat -> group_chat_behavior', () => {
    const s = deriveSignals({ message: { message_id: 1, chat: { id: 1, type: 'group' }, text: 'hi' } });
    expect(s?.promptFamily).toBe('group_chat_behavior');
    expect(s?.injectionSuspect).toBe(false);
    expect(s?.familyConfidence).toBeGreaterThan(0.5);
  });

  it('supergroup -> group_chat_behavior', () => {
    const s = deriveSignals({ message: { message_id: 1, chat: { id: 1, type: 'supergroup' }, text: 'x' } });
    expect(s?.promptFamily).toBe('group_chat_behavior');
  });

  it('private reply -> history_sensitive', () => {
    const s = deriveSignals({
      message: {
        message_id: 2,
        chat: { id: 1, type: 'private' },
        text: 'yes',
        reply_to_message: { message_id: 1, chat: { id: 1, type: 'private' } },
      },
    });
    expect(s?.promptFamily).toBe('history_sensitive');
  });

  it('plain private message -> null (defer to the text router)', () => {
    expect(deriveSignals({ message: { message_id: 3, chat: { id: 1, type: 'private' }, text: 'hello' } })).toBeNull();
  });

  it('no message -> null', () => {
    expect(deriveSignals({})).toBeNull();
  });
});
