export type Upstream = { name: string; base?: string; key?: string };
export type Result = { status: number; body: any };

// Every failure comes back as JSON {ok:false, error} so a dead service only breaks its own widget.
export async function call(
  up: Upstream,
  path: string,
  opts: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<Result> {
  if (!up.base) return { status: 503, body: { ok: false, error: `${up.name} not configured` } };
  const headers: Record<string, string> = {};
  if (up.key) headers['X-Api-Key'] = up.key;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const res = await fetch(up.base + path, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
    const text = await res.text();
    try {
      return { status: res.status, body: JSON.parse(text) };
    } catch {
      return { status: res.status, body: { ok: false, error: text.slice(0, 200) || `HTTP ${res.status}` } };
    }
  } catch (e) {
    console.error(`${up.name} ${path}:`, e);
    const timedOut = (e as Error).name === 'TimeoutError';
    return { status: 502, body: { ok: false, error: `${up.name} ${timedOut ? 'timed out' : 'unavailable'}` } };
  }
}

export const isOk = (r: Result) => r.status >= 200 && r.status < 300;
export const send = (r: Result) => Response.json(r.body, { status: r.status });
