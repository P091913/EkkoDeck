import { readFile } from 'node:fs/promises';
import os from 'node:os';
import { Hono } from 'hono';
import { feed, type Upstream } from './upstream.ts';
import { pc } from './pcAgent.ts';
import { tv } from './tvremote.ts';
import { brain } from './ekko.ts';
import { ollama } from './ollama.ts';

// Any HTTP reply, even 401 or 404, proves the service is reachable without relying on an endpoint
// its contract doesn't promise. No key is sent: reachability doesn't need one.
export async function probe(up: Upstream) {
  if (!up.base) return { name: up.name, up: false, error: 'not configured' };
  const t = Date.now();
  try {
    const res = await fetch(up.base, { signal: AbortSignal.timeout(3000) });
    res.body?.cancel().catch(() => {}); // free the connection for the next probe
    return { name: up.name, up: true, ms: Date.now() - t };
  } catch (e) {
    return { name: up.name, up: false, error: (e as Error).name === 'TimeoutError' ? 'timed out' : 'unreachable' };
  }
}

// The deck server runs on the Pi, so these are the Pi's own numbers (temperature is null off a Pi).
async function pi() {
  const temp = await readFile('/sys/class/thermal/thermal_zone0/temp', 'utf8').then((t) => Number(t) / 1000, () => null);
  return {
    tempC: temp,
    load: os.loadavg()[0],
    memPct: Math.round(100 * (1 - os.freemem() / os.totalmem())),
    uptimeS: os.uptime(),
  };
}

export const status = new Hono()
  .get('/', async (c) => c.json({ feed, pi: await pi() }))
  .get('/health', async (c) => c.json({ services: await Promise.all([pc, tv, brain, ollama].map(probe)) }));
