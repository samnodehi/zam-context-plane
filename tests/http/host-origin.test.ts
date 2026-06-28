/**
 * HTTP local-network guard tests — Host/Origin hardening (docs/18 §4.1).
 *
 * Verifies the anti-DNS-rebinding (Host) and anti-cross-origin (Origin) checks
 * on the Fastify factory. Uses server.inject() — no real TCP socket. No
 * src/core/*.ts, schemas/, or fixtures/ files are involved.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildServer, isLoopbackBindHost } from '../../src/http/server.js';

describe('HTTP local-network guard (Host/Origin)', () => {
  // Start each test from a clean env so no auth/allow-list bleeds across tests.
  beforeEach(() => {
    delete process.env['ZAM_API_KEY'];
    delete process.env['ZAM_ALLOWED_HOSTS'];
    delete process.env['ZAM_ALLOWED_ORIGINS'];
  });

  afterAll(() => {
    delete process.env['ZAM_API_KEY'];
    delete process.env['ZAM_ALLOWED_HOSTS'];
    delete process.env['ZAM_ALLOWED_ORIGINS'];
  });

  async function fresh(): Promise<FastifyInstance> {
    const server = await buildServer({ logger: false });
    await server.ready();
    return server;
  }

  it('allows the default inject Host (localhost) with no Origin', async () => {
    const server = await fresh();
    const res = await server.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    await server.close();
  });

  it('allows explicit loopback Hosts (127.0.0.1, localhost, [::1]) with a port', async () => {
    const server = await fresh();
    for (const host of ['127.0.0.1:3000', 'localhost:3000', '[::1]:3000']) {
      const res = await server.inject({ method: 'GET', url: '/health', headers: { host } });
      expect(res.statusCode).toBe(200);
    }
    await server.close();
  });

  it('rejects a non-loopback Host (DNS-rebinding) with 403 FORBIDDEN', async () => {
    const server = await fresh();
    const res = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { host: 'attacker.example.com' },
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
    await server.close();
  });

  it('rejects a present cross-origin Origin with 403 FORBIDDEN', async () => {
    const server = await fresh();
    const res = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://evil.example' },
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
    await server.close();
  });

  it('ZAM_ALLOWED_HOSTS extends the Host allow-list', async () => {
    process.env['ZAM_ALLOWED_HOSTS'] = 'zam.internal';
    const server = await fresh();
    const ok = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { host: 'zam.internal:3000' },
    });
    expect(ok.statusCode).toBe(200);
    const blocked = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { host: 'other.host' },
    });
    expect(blocked.statusCode).toBe(403);
    await server.close();
  });

  it('ZAM_ALLOWED_ORIGINS allow-lists a specific Origin', async () => {
    process.env['ZAM_ALLOWED_ORIGINS'] = 'http://localhost:1420';
    const server = await fresh();
    const ok = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:1420' },
    });
    expect(ok.statusCode).toBe(200);
    const blocked = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:9999' },
    });
    expect(blocked.statusCode).toBe(403);
    await server.close();
  });

  it('guards POST /plan too (not just /health)', async () => {
    const server = await fresh();
    const res = await server.inject({
      method: 'POST',
      url: '/plan',
      headers: { host: 'attacker.example.com', 'content-type': 'application/json' },
      payload: { request: { text: 'hi' }, registry: [] },
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
    await server.close();
  });

  it('allow-lists Tauri webview origins via ZAM_ALLOWED_ORIGINS', async () => {
    // A desktop (Tauri/Electron) host that lets its webview call ZAM directly
    // opts in its webview origins; the public default still rejects all Origins.
    process.env['ZAM_ALLOWED_ORIGINS'] = 'tauri://localhost,https://tauri.localhost,null';
    const server = await fresh();
    for (const origin of ['tauri://localhost', 'https://tauri.localhost', 'null']) {
      const res = await server.inject({ method: 'GET', url: '/health', headers: { origin } });
      expect(res.statusCode).toBe(200);
    }
    const blocked = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example' },
    });
    expect(blocked.statusCode).toBe(403);
    await server.close();
  });
});

describe('isLoopbackBindHost (bind-interface guard)', () => {
  it('returns true for loopback bind hosts', () => {
    for (const h of ['127.0.0.1', 'localhost', '::1', '[::1]', '127.5.6.7', 'LOCALHOST']) {
      expect(isLoopbackBindHost(h)).toBe(true);
    }
  });

  it('returns false for non-loopback bind hosts', () => {
    for (const h of ['0.0.0.0', '::', '1.2.3.4', '10.0.0.5', 'example.com']) {
      expect(isLoopbackBindHost(h)).toBe(false);
    }
  });
});
