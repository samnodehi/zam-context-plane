// ============================================================================
// ZAM Runtime — Subscriber Bus
// Canonical source: docs/24 §3.9
// Phase R5: Observable event bus for auxiliary subscribers.
// ============================================================================

import type {
  SubscriberBus,
  EventHandler,
  EventStreamEntry,
} from './types.js';

/**
 * Create a new SubscriberBus instance.
 *
 * Per docs/24 §3.9 invariants:
 * - Subscribers are read-only observers.
 * - Subscriber failures are isolated — a failing subscriber does not crash the loop.
 * - The bus is optional. If no subscribers are registered, the loop runs identically.
 */
export function createSubscriberBus(): SubscriberBus {
  return new DefaultSubscriberBus();
}

class DefaultSubscriberBus implements SubscriberBus {
  private readonly handlers: Set<EventHandler> = new Set();

  subscribe(handler: EventHandler): void {
    this.handlers.add(handler);
  }

  unsubscribe(handler: EventHandler): void {
    this.handlers.delete(handler);
  }

  /**
   * Publish an event to all registered subscribers.
   * Each subscriber is called in a try/catch — a failing subscriber
   * never crashes the loop or blocks other subscribers.
   */
  publish(event: EventStreamEntry): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch {
        // Per §3.9: Subscriber failures are isolated.
        // Silently swallow — the bus must never crash the loop.
      }
    }
  }
}
