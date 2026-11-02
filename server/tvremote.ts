import { Hono } from 'hono';
import { call, send } from './upstream.ts';

const tv = { name: 'tvremote', base: process.env.TVREMOTE_URL, key: process.env.TVREMOTE_KEY };
const WAKE_MS = 120_000; // a command can wake the TV, which takes up to ~2 minutes

export const tvremote = new Hono()
  .post('/play', async (c) => {
    const { title, kind, season, episode, itemId } = await c.req.json().catch(() => ({}));
    const body = { title, kind, season, episode, itemId };
    return send(await call(tv, '/tv/play', { method: 'POST', body, timeoutMs: WAKE_MS }));
  })
  .post('/:cmd{pause|resume|stop|launch|off}', async (c) =>
    send(await call(tv, `/tv/${c.req.param('cmd')}`, { method: 'POST', timeoutMs: WAKE_MS })),
  );
