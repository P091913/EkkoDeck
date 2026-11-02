import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { pcAgent } from './pcAgent.ts';
import { tvremote } from './tvremote.ts';
import { ekko } from './ekko.ts';
import { macros } from './macros.ts';

export const app = new Hono()
  // Loopback alone doesn't stop another page open in a browser on the Pi from calling us (CSRF, DNS rebinding):
  // the custom header forces a CORS preflight we never approve, and the Host check rejects rebound names.
  .use('/api/*', async (c, next) => {
    const host = c.req.header('host') ?? '';
    if (c.req.header('x-deck') !== '1' || !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
      return c.json({ ok: false, error: 'forbidden' }, 403);
    }
    await next();
  })
  .route('/api/pc', pcAgent)
  .route('/api/tv', tvremote)
  .route('/api/ekko', ekko)
  .route('/api/macros', macros)
  .use('/*', serveStatic({ root: './web/dist' }));
