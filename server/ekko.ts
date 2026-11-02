import { Hono } from 'hono';
import { call, send } from './upstream.ts';

export const brain = { name: 'Ekko', base: process.env.EKKO_URL, key: process.env.EKKO_KEY };

export const ekko = new Hono().post('/message', async (c) => {
  const { text } = await c.req.json().catch(() => ({}));
  if (typeof text !== 'string' || !text.trim()) return c.json({ ok: false, error: 'empty message' }, 400);
  // Fixed conversationId so Ekko's follow-up questions ("which one?") are answered by the next message.
  const body = { text, channel: 'deck', conversationId: 'deck' };
  // Long timeout: Ekko may be waiting on tvremote waking the TV.
  return send(await call(brain, '/message', { method: 'POST', body, timeoutMs: 180_000, what: 'Message' }));
});
