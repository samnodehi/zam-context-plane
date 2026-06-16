// ============================================================================
// ZAM Runtime — EventStream (Append-only JSONL)
// Canonical source: docs/24 §4 — Immediate flush (R2-Q4)
// ============================================================================

import { appendFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { EventStreamEntry, EventType, EventContent } from './types.js';

/**
 * Append-only JSONL event stream with immediate flush.
 * Each entry is a single JSON line followed by a newline.
 */
export class EventStream {
  private readonly filePath: string;
  private initialized = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /**
   * Append a new entry to the event stream.
   * Assigns UUID v4 entryId and ISO 8601 timestamp automatically.
   * Uses fs.appendFileSync for immediate flush (R2-Q4 decision).
   */
  append(entry: {
    sessionId: string;
    turnIndex: number;
    type: EventType;
    content: EventContent;
  }): EventStreamEntry {
    this.ensureDirectory();

    const fullEntry: EventStreamEntry = {
      entryId: randomUUID(),
      sessionId: entry.sessionId,
      turnIndex: entry.turnIndex,
      type: entry.type,
      timestamp: new Date().toISOString(),
      content: entry.content,
    };

    const line = JSON.stringify(fullEntry) + '\n';
    appendFileSync(this.filePath, line, 'utf8');

    return fullEntry;
  }

  /**
   * Read all entries from the event stream file.
   * Returns an empty array if the file does not exist.
   */
  read(): EventStreamEntry[] {
    if (!existsSync(this.filePath)) {
      return [];
    }

    const raw = readFileSync(this.filePath, 'utf8');
    if (!raw.trim()) {
      return [];
    }

    return raw
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as EventStreamEntry);
  }

  /**
   * Return the last N entries from the event stream.
   * If n is omitted, returns all entries.
   */
  latestEntries(n?: number): EventStreamEntry[] {
    const all = this.read();
    if (n === undefined || n >= all.length) {
      return all;
    }
    return all.slice(-n);
  }

  /**
   * Get the file path of this event stream.
   */
  getFilePath(): string {
    return this.filePath;
  }

  /**
   * Ensure the parent directory exists. Called once on first append.
   */
  private ensureDirectory(): void {
    if (this.initialized) {
      return;
    }
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });
    this.initialized = true;
  }
}
