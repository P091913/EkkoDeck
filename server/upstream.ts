export type Upstream = { name: string; base?: string; key?: string };
export type Result = { status: number; body: any };
type Opts = { method?: string; body?: unknown; timeoutMs?: number; what?: string };

// A feed row stays "running" until `code` is set; `reply` keeps only the fields the deck shows, never the payload.
export type Entry = { id: number; at: number; service: string; what: string; ms?: number; code?: number; reply?: object };

// Every button press (any call that isn't a GET), newest first, for the Activity page.
// shortcut: kept in memory, so it starts empty after a restart; persist it if history across restarts ever matters.
export const feed: Entry[] = [];
let lastId = 0;

export async function call(up: Upstream, path: string, opts: Opts = {}): Promise<Result> {
  const method = opts.method ?? 'GET';
  if (method === 'GET') return request(up, path, method, opts); // polls (now playing) would flood the feed
  const entry: Entry = { id: ++lastId, at: Date.now(), service: up.name, what: opts.what ?? path.split('/').pop()! };
  feed.unshift(entry);
  feed.length = Math.min(feed.length, 100);
  const r = await request(up, path, method, opts);
  const { status, message, error, warning } = r.body ?? {};
  Object.assign(entry, { ms: Date.now() - entry.at, code: r.status, reply: { status, message, error, warning } });
  return r;
}

// Every failure comes back as JSON {ok:false, error} so a dead service only breaks its own widget.
async function request(up: Upstream, path: string, method: string, opts: Opts): Promise<Result> {
  if (!up.base) return { status: 503, body: { ok: false, error: `${up.name} not configured` } };
  const headers: Record<string, string> = {};
  if (up.key) headers['X-Api-Key'] = up.key;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const res = await fetch(up.base + path, {
      method,
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
