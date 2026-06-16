// ============================================================================
// Tests — Subscriber Bus
// Phase R5
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import { createSubscriberBus } from '../src/subscriber-bus.js';
import type { EventStreamEntry } from '../src/types.js';

function makeEvent(overrides?: Partial<EventStreamEntry>): EventStreamEntry {
  return {
    entryId: 'test-entry-id',
    sessionId: 'test-session',
    turnIndex: 0,
    type: 'user_message',
    timestamp: '2026-01-01T00:00:00.000Z',
    content: { text: 'hello', metadata: {} },
    ...overrides,
  };
}

describe('SubscriberBus', () => {
  it('publishes events to subscribed handlers', () => {
    const bus = createSubscriberBus();
    const handler = vi.fn();
    bus.subscribe(handler);

    const event = makeEvent();
    bus.publish(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('publishes to multiple handlers', () => {
    const bus = createSubscriberBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    bus.subscribe(handler1);
    bus.subscribe(handler2);

    const event = makeEvent();
    bus.publish(event);

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  it('does not call unsubscribed handlers', () => {
    const bus = createSubscriberBus();
    const handler = vi.fn();
    bus.subscribe(handler);
    bus.unsubscribe(handler);

    bus.publish(makeEvent());

    expect(handler).not.toHaveBeenCalled();
  });

  it('isolates handler failures — other handlers still receive events', () => {
    const bus = createSubscriberBus();
    const failingHandler = vi.fn(() => { throw new Error('boom'); });
    const goodHandler = vi.fn();
    bus.subscribe(failingHandler);
    bus.subscribe(goodHandler);

    const event = makeEvent();
    // Should not throw
    bus.publish(event);

    expect(failingHandler).toHaveBeenCalledTimes(1);
    expect(goodHandler).toHaveBeenCalledTimes(1);
    expect(goodHandler).toHaveBeenCalledWith(event);
  });

  it('works with zero subscribers', () => {
    const bus = createSubscriberBus();
    // Should not throw
    expect(() => bus.publish(makeEvent())).not.toThrow();
  });

  it('ignores duplicate subscribe calls (Set semantics)', () => {
    const bus = createSubscriberBus();
    const handler = vi.fn();
    bus.subscribe(handler);
    bus.subscribe(handler);

    bus.publish(makeEvent());

    // Set deduplicates — handler called only once
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('unsubscribing a non-subscribed handler is a no-op', () => {
    const bus = createSubscriberBus();
    const handler = vi.fn();
    // Should not throw
    expect(() => bus.unsubscribe(handler)).not.toThrow();
  });
});
