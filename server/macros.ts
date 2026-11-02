import { Hono } from 'hono';
import { isOk, send, type Result } from './upstream.ts';
import { pcAction } from './pcAgent.ts';
import { setQwen } from './ollama.ts';

const errorOf = (r: Result) => r.body?.error ?? `HTTP ${r.status}`;

// Unload first to free the GPU; Steam launches even if that fails, with a warning.
export async function gameMode(unload = () => setQwen(false), steam = () => pcAction('steam')): Promise<Result> {
  const u = await unload();
  const s = await steam();
  const warning = isOk(u) ? undefined : `Qwen not unloaded: ${errorOf(u)}`;
  if (isOk(s)) return { status: 200, body: { ok: true, warning } };
  return { status: s.status, body: { ok: false, error: `Steam: ${errorOf(s)}`, warning } };
}

export const macros = new Hono()
  .post('/game-mode', async () => send(await gameMode()))
  .post('/game-mode-off', async () => send(await setQwen(true)));
