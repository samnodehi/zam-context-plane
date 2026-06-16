// ============================================================================
// ZAM Runtime — Session Manager
// Canonical source: docs/24 §3.2
// ============================================================================

import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventStream } from './event-stream.js';
import type { RuntimeConfig, Session } from './types.js';

/**
 * Create a new session with a unique ID and dedicated EventStream file.
 * Per docs/24 §3.2: each session has exactly one EventStream,
 * session IDs are unique (UUID v4), and session state is never shared.
 */
export function createSession(config: RuntimeConfig): Session {
  const sessionId = randomUUID();
  const eventStreamPath = join(config.eventStream.persistPath, sessionId, 'events.jsonl');
  const eventStream = new EventStream(eventStreamPath);

  return {
    sessionId,
    turnCounter: 0,
    startedAt: new Date().toISOString(),
    eventStream,
    config,
  };
}
