import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call } from './upstream.ts';
import { app } from './app.ts';
import { gameMode } from './macros.ts';

// No service URLs are set in tests, so a request that passes every check ends at "not configured" (503).
const deck = { 'x-deck': '1', host: '127.0.0.1:8080' };

test('API refuses calls without the deck header or from a foreign Host', async () => {
  const post = (headers: Record<string, string>) => app.request('/api/pc/action/lock_pc', { method: 'POST', headers });
  assert.equal((await post(deck)).status, 503);
  assert.equal((await post({ host: '127.0.0.1:8080' })).status, 403);
  assert.equal((await post({ 'x-deck': '1', host: 'evil.example:8080' })).status, 403);
});

test('unknown PC action ids are refused, known ones pass through', async () => {
  const action = (id: string) => app.request(`/api/pc/action/${id}`, { method: 'POST', headers: deck });
  assert.equal((await action('format_disk')).status, 400);
  assert.equal((await action('steam')).status, 503);
});

test('upstream failures come back as JSON errors, with the key attached', async (t) => {
  t.mock.method(console, 'error', () => {});
  const up = { name: 'X', base: 'http://x', key: 'k' };

  assert.deepEqual(await call({ name: 'X' }, '/a'), { status: 503, body: { ok: false, error: 'X not configured' } });

  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    throw new DOMException('slow', 'TimeoutError');
  });
  assert.deepEqual(await call(up, '/a'), { status: 502, body: { ok: false, error: 'X timed out' } });
  const init = fetchMock.mock.calls[0].arguments[1] as { headers: Record<string, string> };
  assert.equal(init.headers['X-Api-Key'], 'k');

  fetchMock.mock.mockImplementation(async () => {
    throw new TypeError('fetch failed');
  });
  assert.deepEqual(await call(up, '/a'), { status: 502, body: { ok: false, error: 'X unavailable' } });

  fetchMock.mock.mockImplementation(async () => new Response('Bad Gateway', { status: 502 }));
  assert.deepEqual(await call(up, '/a'), { status: 502, body: { ok: false, error: 'Bad Gateway' } });
});

test('game mode unloads Qwen before Steam, and launches Steam with a warning if unload fails', async () => {
  const order: string[] = [];
  const unloadFails = async () => (order.push('unload'), { status: 502, body: { ok: false, error: 'Ollama unavailable' } });
  const steamOk = async () => (order.push('steam'), { status: 200, body: { ok: true } });

  const r = await gameMode(unloadFails, steamOk);
  assert.deepEqual(order, ['unload', 'steam']);
  assert.deepEqual(r, { status: 200, body: { ok: true, warning: 'Qwen not unloaded: Ollama unavailable' } });
});

test('game mode reports a Steam failure', async () => {
  const r = await gameMode(
    async () => ({ status: 200, body: { done: true } }),
    async () => ({ status: 429, body: { ok: false, error: 'another action is running' } }),
  );
  assert.deepEqual(r, { status: 429, body: { ok: false, error: 'Steam: another action is running', warning: undefined } });
});
