import { Hono } from 'hono';
import { call, send } from './upstream.ts';

export const brain = { name: 'Ekko', base: process.env.EKKO_URL, key: process.env.EKKO_KEY };

export const ekko = new Hono()
  .post('/message', async (c) => {
    const { text } = await c.req.json().catch(() => ({}));
    if (typeof text !== 'string' || !text.trim()) return c.json({ ok: false, error: 'empty message' }, 400);
    // Fixed conversationId so Ekko's follow-up questions ("which one?") are answered by the next message.
    const body = { text, channel: 'deck', conversationId: 'deck' };
    // Long timeout: Ekko may be waiting on tvremote waking the TV.
    return send(await call(brain, '/message', { method: 'POST', body, timeoutMs: 180_000, what: 'Message' }));
  })
  // Ekko's recent steps, for the live map; `after` is the last seq the page has.
  .get('/trace', async (c) => {
    const after = Number(c.req.query('after'));
    return send(await call(brain, `/trace?after=${Number.isSafeInteger(after) && after > 0 ? after : 0}`));
  })
  // Claude server-ops runs waiting for an OK.
  .get('/runs', async () => send(await call(brain, '/runs/waiting')))
  .post('/runs/:id/:verdict{approve|deny}', async (c) => {
    const { id, verdict } = c.req.param();
    if (!/^[a-f0-9]{12}$/.test(id)) return c.json({ ok: false, error: 'bad run id' }, 400);
    // Approving runs the held call and lets Claude carry on, so give it as long as a message.
    const what = verdict === 'approve' ? 'Approve run' : 'Deny run';
    return send(await call(brain, `/runs/${id}/${verdict}`, { method: 'POST', timeoutMs: 180_000, what }));
  });
