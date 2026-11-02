import { Hono } from 'hono';
import { call, send } from './upstream.ts';

export const pc = { name: 'PC agent', base: process.env.PC_AGENT_URL, key: process.env.PC_AGENT_KEY };

// Only these ids get the key attached; anything else the page sends is refused here.
const ACTIONS = new Set([
  'discord_mute', 'discord_deafen', 'volume_up', 'volume_down', 'volume_mute', 'play_pause', 'next_track',
  'previous_track', 'lock_pc', 'task_manager', 'snip', 'show_desktop', 'task_view', 'clipboard', 'emoji',
  'windows_settings', 'minimize_all', 'steam', 'rustdesk',
]);

export const pcAction = (id: string) => call(pc, `/action/${id}`, { method: 'POST', timeoutMs: 30_000 });

export const pcAgent = new Hono()
  .post('/action/:id', async (c) => {
    const id = c.req.param('id');
    if (!ACTIONS.has(id)) return c.json({ ok: false, error: `unknown action ${id}` }, 400);
    return send(await pcAction(id));
  })
  .get('/nowplaying', async () => send(await call(pc, '/nowplaying')));
