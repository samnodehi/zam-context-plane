/**
 * Phase 3 — deterministic Request Router (classifier) unit tests.
 *
 * Tests the pure classifyRequest() function directly: family detection, the
 * safety bias (whole-string greeting; ambiguity → default), confidence values,
 * determinism, and that never-asserted families are never returned.
 *
 * Canonical: docs/33; src/core/request-router.ts.
 */

import { describe, it, expect } from 'vitest';
import { classifyRequest } from '../../src/core/request-router.js';

describe('classifyRequest — detectable families', () => {
  it('classifies a clear coding request as coding_build_debug', () => {
    for (const text of [
      'Please debug this stack trace.',
      'There is a null pointer exception when I compile.',
      'Refactor this typescript function.',
      'The npm build fails with a syntax error.',
    ]) {
      expect(classifyRequest(text).promptFamily).toBe('coding_build_debug');
    }
  });

  it('classifies a clear research request as research_investigation', () => {
    for (const text of [
      'Research and compare the available options.',
      'Investigate the root cause and summarize the sources.',
      'Look up and analyze the literature.',
    ]) {
      expect(classifyRequest(text).promptFamily).toBe('research_investigation');
    }
  });

  it('classifies a clear ops/security/risk request as ops_security_change_risk', () => {
    for (const text of [
      'Deploy this to production.',
      'Delete the table and rollback the migration.',
      'Rotate the API key and update the firewall permission.',
    ]) {
      expect(classifyRequest(text).promptFamily).toBe('ops_security_change_risk');
    }
  });

  it('classifies a clear history-referencing request as history_sensitive', () => {
    for (const text of [
      'As I said earlier, keep the same approach.',
      'As we discussed, proceed with option two.',
      'Last time you said it was fine.',
    ]) {
      expect(classifyRequest(text).promptFamily).toBe('history_sensitive');
    }
  });

  it('confident classifications carry confidence >= 0.7 (selectors use the family)', () => {
    const r = classifyRequest('Please debug this stack trace.');
    expect(r.familyConfidence).toBeGreaterThanOrEqual(0.7);
    expect(r.defaulted).toBe(false);
  });
});

describe('classifyRequest — simple_greeting (whole-string only; safety bias)', () => {
  it('classifies a pure greeting/ack as simple_greeting', () => {
    for (const text of ['hi', 'Hello!', 'hey', 'thanks', 'thank you', 'ok', 'good morning', '  yes  ']) {
      expect(classifyRequest(text).promptFamily).toBe('simple_greeting');
    }
  });

  it('does NOT classify a substantive request that merely starts with a greeting', () => {
    // The dangerous case: "hello" prefix on a real task must NOT omit context.
    const r = classifyRequest('Hello, can you debug this stack trace exception?');
    expect(r.promptFamily).toBe('coding_build_debug'); // not simple_greeting
    const r2 = classifyRequest('Hi there — please deploy to production.');
    expect(r2.promptFamily).toBe('ops_security_change_risk'); // not simple_greeting
  });
});

describe('classifyRequest — fail-open to general_default', () => {
  it('returns general_default (0.0, defaulted) for empty/whitespace', () => {
    for (const text of ['', '   ', '\n\t ']) {
      const r = classifyRequest(text);
      expect(r.promptFamily).toBe('general_default');
      expect(r.familyConfidence).toBe(0.0);
      expect(r.defaulted).toBe(true);
    }
  });

  it('returns general_default for a request with no strong family signal', () => {
    for (const text of ['Please take care of this for me.', 'What is the current system status?', 'Proceed.']) {
      const r = classifyRequest(text);
      expect(r.promptFamily).toBe('general_default');
      expect(r.defaulted).toBe(true);
    }
  });

  it('returns general_default on AMBIGUITY (>=2 families matched)', () => {
    // coding + ops
    const r = classifyRequest('Debug the deploy to production.');
    expect(r.promptFamily).toBe('general_default');
    expect(r.familyConfidence).toBe(0.0);
    expect(r.defaulted).toBe(true);
    // research + ops
    expect(classifyRequest('Research how to delete the production database.').promptFamily).toBe('general_default');
  });

  it('never asserts a family that is not text-detectable (heartbeat/group/lifecycle/tool_use)', () => {
    // These should fall through to general_default — the router must not guess them.
    for (const text of [
      'heartbeat proactive follow-up in the group chat',
      'run the tool to use the available capability',
      'internal lifecycle bootstrap',
    ]) {
      const fam = classifyRequest(text).promptFamily;
      expect(['general_default', 'simple_greeting', 'coding_build_debug', 'research_investigation',
        'ops_security_change_risk', 'history_sensitive']).toContain(fam);
      expect(['heartbeat_proactive', 'group_chat_behavior', 'lifecycle_internal', 'tool_use_required'])
        .not.toContain(fam);
    }
  });
});

describe('classifyRequest — determinism & robustness', () => {
  it('is deterministic: same input yields identical output across repeated calls', () => {
    for (const text of ['Please debug this.', 'Hello!', 'deploy to production', 'random neutral text']) {
      const first = JSON.stringify(classifyRequest(text));
      for (let i = 0; i < 5; i++) {
        expect(JSON.stringify(classifyRequest(text))).toBe(first);
      }
    }
  });

  it('is case-insensitive', () => {
    expect(classifyRequest('DEBUG THIS STACK TRACE').promptFamily).toBe('coding_build_debug');
    expect(classifyRequest('HELLO').promptFamily).toBe('simple_greeting');
  });

  it('always returns a schema-valid promptFamily enum value', () => {
    const valid = new Set([
      'general_default', 'simple_greeting', 'coding_build_debug', 'research_investigation',
      'ops_security_change_risk', 'lifecycle_internal', 'heartbeat_proactive',
      'group_chat_behavior', 'tool_use_required', 'history_sensitive',
    ]);
    for (const text of ['', 'hi', 'debug', 'deploy to prod', 'as i said', 'neutral', 'research and compare']) {
      expect(valid.has(classifyRequest(text).promptFamily)).toBe(true);
    }
  });

  it('confidence is always within [0, 1]', () => {
    for (const text of ['', 'hi', 'debug this', 'neutral request']) {
      const c = classifyRequest(text).familyConfidence;
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });
});
