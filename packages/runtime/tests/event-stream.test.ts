// ============================================================================
// Tests — EventStream
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventStream } from '../src/event-stream.js';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

function createTempDir(): string {
  const dir = join(tmpdir(), `zam-test-es-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('EventStream', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should create parent directories on first append', () => {
    const filePath = join(tempDir, 'nested', 'deep', 'events.jsonl');
    const es = new EventStream(filePath);

    es.append({
      sessionId: 'sess-1',
      turnIndex: 0,
      type: 'user_message',
      content: { text: 'hello' },
    });

    expect(existsSync(filePath)).toBe(true);
  });

  it('should assign UUID entryId and ISO timestamp', () => {
    const filePath = join(tempDir, 'events.jsonl');
    const es = new EventStream(filePath);

    const entry = es.append({
      sessionId: 'sess-1',
      turnIndex: 0,
      type: 'user_message',
      content: { text: 'hello' },
    });

    // UUID v4 format check
    expect(entry.entryId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    // ISO 8601 timestamp check
    expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
  });

  it('should write valid JSONL (one JSON object per line)', () => {
    const filePath = join(tempDir, 'events.jsonl');
    const es = new EventStream(filePath);

    es.append({ sessionId: 's', turnIndex: 0, type: 'user_message', content: { text: 'a' } });
    es.append({ sessionId: 's', turnIndex: 1, type: 'user_message', content: { text: 'b' } });

    const entries = es.read();
    expect(entries).toHaveLength(2);
    expect((entries[0].content as { text: string }).text).toBe('a');
    expect((entries[1].content as { text: string }).text).toBe('b');
  });

  it('should read empty array when file does not exist', () => {
    const filePath = join(tempDir, 'nonexistent.jsonl');
    const es = new EventStream(filePath);

    expect(es.read()).toEqual([]);
  });

  it('should flush immediately (data readable after each append)', () => {
    const filePath = join(tempDir, 'events.jsonl');
    const es = new EventStream(filePath);

    es.append({ sessionId: 's', turnIndex: 0, type: 'user_message', content: { text: 'first' } });

    // Create a separate reader to verify data is on disk
    const reader = new EventStream(filePath);
    const entries = reader.read();
    expect(entries).toHaveLength(1);
    expect((entries[0].content as { text: string }).text).toBe('first');
  });

  it('latestEntries should return last N entries', () => {
    const filePath = join(tempDir, 'events.jsonl');
    const es = new EventStream(filePath);

    for (let i = 0; i < 5; i++) {
      es.append({ sessionId: 's', turnIndex: i, type: 'user_message', content: { text: `msg-${i}` } });
    }

    const last2 = es.latestEntries(2);
    expect(last2).toHaveLength(2);
    expect((last2[0].content as { text: string }).text).toBe('msg-3');
    expect((last2[1].content as { text: string }).text).toBe('msg-4');
  });

  it('latestEntries without N returns all entries', () => {
    const filePath = join(tempDir, 'events.jsonl');
    const es = new EventStream(filePath);

    es.append({ sessionId: 's', turnIndex: 0, type: 'user_message', content: { text: 'a' } });
    es.append({ sessionId: 's', turnIndex: 1, type: 'user_message', content: { text: 'b' } });

    const all = es.latestEntries();
    expect(all).toHaveLength(2);
  });

  it('should preserve all entry fields through round-trip', () => {
    const filePath = join(tempDir, 'events.jsonl');
    const es = new EventStream(filePath);

    es.append({
      sessionId: 'test-session',
      turnIndex: 3,
      type: 'model_response',
      content: {
        type: 'text',
        text: 'Hello there',
        providerName: 'openrouter',
        model: 'gpt-4o',
      },
    });

    const entries = es.read();
    expect(entries[0].sessionId).toBe('test-session');
    expect(entries[0].turnIndex).toBe(3);
    expect(entries[0].type).toBe('model_response');
    expect(entries[0].content).toEqual({
      type: 'text',
      text: 'Hello there',
      providerName: 'openrouter',
      model: 'gpt-4o',
    });
  });
});
