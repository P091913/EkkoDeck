import { serve } from '@hono/node-server';
import { app } from './app.ts';

const port = Number(process.env.PORT ?? 8080);
// Loopback only: this process holds every key, so nothing on the network may reach it.
serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, () => console.log(`ekko-deck on http://127.0.0.1:${port}`));
