import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, feed } from './upstream.ts';
import { app } from './app.ts';
import { gameMode } from './macros.ts';
import { probe } from './status.ts';

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

test('button presses show in the feed as running, then with their result; GETs are left out', async (t) => {
  let finish!: (r: Response) => void;
  const fetchMock = t.mock.method(globalThis, 'fetch', () => new Promise<Response>((r) => (finish = r)));
  const up = { name: 'X', base: 'http://x' };

  const pending = call(up, '/action/lock_pc', { method: 'POST' });
  const entry = feed[0];
  assert.equal(entry.service, 'X');
  assert.equal(entry.what, 'lock_pc');
  assert.equal(entry.code, undefined); // still running
  finish(Response.json({ ok: false, error: 'busy', secret: 'payload' }, { status: 429 }));
  await pending;
  assert.equal(entry.code, 429);
  assert.deepEqual(entry.reply, { status: undefined, message: undefined, error: 'busy', warning: undefined });

  fetchMock.mock.mockImplementation(async () => Response.json({}));
  await call(up, '/nowplaying');
  assert.equal(feed[0], entry);
});

test('the feed keeps only the last 100 presses', async () => {
  for (let i = 0; i < 105; i++) await call({ name: 'Y' }, '/a', { method: 'POST' });
  assert.equal(feed.length, 100);
  assert.equal(feed[0].reply && (feed[0].reply as { error: string }).error, 'Y not configured');
});

test('health counts any HTTP reply as up and sends no key', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('no', { status: 401 }));
  assert.equal((await probe({ name: 'X', base: 'http://x', key: 'k' })).up, true);
  assert.equal((fetchMock.mock.calls[0].arguments[1] as RequestInit).headers, undefined);

  fetchMock.mock.mockImplementation(async () => {
    throw new TypeError('fetch failed');
  });
  assert.deepEqual(await probe({ name: 'X', base: 'http://x' }), { name: 'X', up: false, error: 'unreachable' });
  fetchMock.mock.mockImplementation(async () => {
    throw new DOMException('slow', 'TimeoutError');
  });
  assert.deepEqual(await probe({ name: 'X', base: 'http://x' }), { name: 'X', up: false, error: 'timed out' });
  assert.deepEqual(await probe({ name: 'X' }), { name: 'X', up: false, error: 'not configured' });
});

test('status endpoint returns the feed and Pi stats behind the guard', async () => {
  assert.equal((await app.request('/api/status', { headers: { host: '127.0.0.1:8080' } })).status, 403);
  const body = await (await app.request('/api/status', { headers: deck })).json();
  assert.ok(Array.isArray(body.feed));
  assert.equal(typeof body.pi.uptimeS, 'number');
});

test('game mode reports a Steam failure', async () => {
  const r = await gameMode(
    async () => ({ status: 200, body: { done: true } }),
    async () => ({ status: 429, body: { ok: false, error: 'another action is running' } }),
  );
  assert.deepEqual(r, { status: 429, body: { ok: false, error: 'Steam: another action is running', warning: undefined } });
});
