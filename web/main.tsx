import '@fontsource-variable/inter';
import { createContext, h, render } from 'preact';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { createMap, isClaude, modelName, type EkkoMap, type TraceEvent } from './ekko-map';
import {
  Activity, Brain, Clipboard, Gamepad2, HeadphoneOff, Joystick, LayoutGrid, Lock, MicOff, Minimize2, Monitor,
  Pause, Play, Power, PowerOff, ScreenShare, Scissors, Search, Send, Settings, SkipBack, SkipForward, Smile,
  Square, Volume1, Volume2, VolumeX, type IconNode,
} from 'lucide';

type Reply = { ok: boolean; data: any };
type Status = [text: string, kind: '' | 'ok' | 'warn' | 'err'];
type Btn = { label: string; path: string; icon: IconNode; accent?: boolean };

async function api(path: string, body?: unknown, method = 'POST'): Promise<Reply> {
  const headers: Record<string, string> = { 'X-Deck': '1' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  } catch {
    return { ok: false, data: {} };
  }
}

// tvremote's status field says how it went, whatever the HTTP code; other services only have the HTTP code.
const TV_KIND: Record<string, Status[1]> = {
  playing: 'ok', ok: 'ok', would_play: 'ok', ambiguous: 'warn', not_found: 'warn', not_playing: 'warn',
};

function describe(r: Reply, label?: string): Status {
  const msg = r.data.message ?? r.data.error ?? (r.ok ? 'done' : 'unavailable');
  const text = label ? `${label}: ${msg}` : msg;
  if (typeof r.data.status === 'string') return [text, TV_KIND[r.data.status] ?? 'err'];
  if (!r.ok) return [text, 'err'];
  if (r.data.warning) return [`${text} (${r.data.warning})`, 'warn'];
  return [text, 'ok'];
}

const Notify = createContext<(s: Status) => void>(() => {});

function Icon({ node, size = 28 }: { node: IconNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {node.map(([tag, attrs]) => h(tag, attrs))}
    </svg>
  );
}

function Tile({ b, round }: { b: Btn; round?: 'sm' | 'lg' }) {
  const notify = useContext(Notify);
  const [busy, setBusy] = useState(false);
  async function press() {
    if (busy) return; // a second tap while the first is still running would send it twice
    setBusy(true);
    notify([`${b.label}…`, '']);
    notify(describe(await api(b.path), b.label));
    setBusy(false);
  }
  const cls = [round ? `round ${round}` : 'tile', b.accent && 'accent', busy && 'busy'].filter(Boolean).join(' ');
  return (
    <button class={cls} onClick={press} aria-label={round ? b.label : undefined}>
      <Icon node={b.icon} size={round === 'lg' ? 40 : 28} />
      {!round && <span>{b.label}</span>}
    </button>
  );
}

const Grid = ({ items }: { items: Btn[] }) => (
  <div class="grid">
    {items.map((b) => (
      <Tile key={b.path} b={b} />
    ))}
  </div>
);

const pc = (id: string) => `/api/pc/action/${id}`;
const btn = (label: string, path: string, icon: IconNode, accent = false): Btn => ({ label, path, icon, accent });

const DISCORD = [btn('Mute mic', pc('discord_mute'), MicOff), btn('Deafen', pc('discord_deafen'), HeadphoneOff)];
const VOLUME = [
  btn('Vol −', pc('volume_down'), Volume1),
  btn('Mute', pc('volume_mute'), VolumeX),
  btn('Vol +', pc('volume_up'), Volume2),
];
const APPS = [btn('Steam', pc('steam'), Joystick), btn('RustDesk', pc('rustdesk'), ScreenShare)];
const GAME = [
  btn('Game Mode', '/api/macros/game-mode', Gamepad2, true),
  btn('Game Mode off', '/api/macros/game-mode-off', Brain),
];
const SYSTEM = [
  btn('Lock PC', pc('lock_pc'), Lock),
  btn('Task Manager', pc('task_manager'), Activity),
  btn('Snip', pc('snip'), Scissors),
  btn('Show desktop', pc('show_desktop'), Monitor),
  btn('Task view', pc('task_view'), LayoutGrid),
  btn('Clipboard', pc('clipboard'), Clipboard),
  btn('Emoji', pc('emoji'), Smile),
  btn('Settings', pc('windows_settings'), Settings),
  btn('Minimize all', pc('minimize_all'), Minimize2),
];
const PREV = btn('Previous', pc('previous_track'), SkipBack);
const PLAY_PAUSE = btn('Play / Pause', pc('play_pause'), Play, true);
const NEXT = btn('Next', pc('next_track'), SkipForward);
const TV_PLAYBACK = [btn('Pause', '/api/tv/pause', Pause), btn('Resume', '/api/tv/resume', Play), btn('Stop', '/api/tv/stop', Square)];
const TV_POWER = [btn('TV on', '/api/tv/launch', Power), btn('TV off', '/api/tv/off', PowerOff)];

const clock = (s?: number) => (s == null ? '' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);

// Polls only while its page is on screen.
function usePoll(path: string, ms: number, active: boolean) {
  const [reply, setReply] = useState<Reply | null>(null);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: number | undefined;
    // Chain timeouts instead of setInterval so a slow service never piles up requests.
    const tick = async () => {
      const r = await api(path, undefined, 'GET');
      if (stopped) return;
      setReply(r);
      timer = setTimeout(tick, ms);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [path, ms, active]);
  return reply;
}

function Music({ active }: { active: boolean }) {
  const np = usePoll('/api/pc/nowplaying', 2000, active);
  const d = np?.data ?? {};
  const live = !!np?.ok && d.active;
  const pct = live && d.durationSeconds ? Math.min(100, (100 * d.positionSeconds) / d.durationSeconds) : 0;
  const headline = !np ? 'Loading…' : live ? d.title || 'Unknown title' : np.ok ? 'Nothing playing' : (d.error ?? 'Unavailable');

  return (
    <div class="card np">
      <div class="np-app">{live ? `${d.app} · ${d.status}` : ''}</div>
      <div class="np-title">{headline}</div>
      <div class="np-artist">{live ? [d.artist, d.album].filter(Boolean).join(' — ') : ''}</div>
      <div class="bar">
        <div style={{ transform: `scaleX(${pct / 100})` }} />
      </div>
      <div class="times">
        <span>{live ? clock(d.positionSeconds) : ''}</span>
        <span>{live ? clock(d.durationSeconds) : ''}</span>
      </div>
      <div class="transport">
        <Tile round="sm" b={PREV} />
        <Tile round="lg" b={{ ...PLAY_PAUSE, icon: live && d.playing ? Pause : Play }} />
        <Tile round="sm" b={NEXT} />
      </div>
    </div>
  );
}

type Candidate = { id: string; name: string; type?: string; productionYear?: number };

function Tv() {
  const notify = useContext(Notify);
  const [title, setTitle] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState(false);

  async function play(body: object) {
    if (busy) return; // waking the TV takes minutes; a second Play would start another
    setBusy(true);
    setCandidates([]);
    notify(['Working… waking the TV can take up to 2 minutes', '']);
    const r = await api('/api/tv/play', body);
    setCandidates(r.data.data?.candidates ?? []);
    notify(describe(r));
    setBusy(false);
  }

  return (
    <>
      <form
        class="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) play({ title: title.trim() });
        }}
      >
        <Icon node={Search} size={24} />
        <input value={title} onInput={(e) => setTitle(e.currentTarget.value)} placeholder="Movie or show" />
        <button class="pill accent" disabled={busy}>
          Play
        </button>
      </form>
      {candidates.length > 0 && (
        <>
          <h2>Which one?</h2>
          <div class="cands">
            {candidates.map((c) => (
              <button key={c.id} class="cand" onClick={() => play({ itemId: c.id })}>
                <b>{c.name}</b>
                <span>{[c.productionYear, c.type].filter(Boolean).join(' · ')}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <h2>Playback</h2>
      <Grid items={TV_PLAYBACK} />
      <h2>Power</h2>
      <Grid items={TV_POWER} />
    </>
  );
}

function Chat() {
  const [log, setLog] = useState<[who: 'me' | 'ekko', text: string][]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function sendMessage(e: Event) {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setText('');
    setBusy(true);
    setLog((l) => [...l, ['me', t]]);
    const r = await api('/api/ekko/message', { text: t });
    setLog((l) => [...l, ['ekko', r.ok ? r.data.text : `(${r.data.error ?? 'Ekko unavailable'})`]]);
    setBusy(false);
  }

  return (
    <>
      {/* column-reverse keeps the newest message in view without scroll code; first child sits at the bottom */}
      <div class="log">
        {busy && (
          <p class="ekko typing" aria-label="Ekko is typing">
            <i />
            <i />
            <i />
          </p>
        )}
        {log
          .map(([who, t], i) => (
            <p key={i} class={who}>
              {t}
            </p>
          ))
          .reverse()}
        {log.length === 0 && !busy && <p class="hint">Ask Ekko anything.</p>}
      </div>
      <form class="composer" onSubmit={sendMessage}>
        <input value={text} onInput={(e) => setText(e.currentTarget.value)} placeholder="Message Ekko" />
        <button class="send accent" disabled={busy} aria-label="Send">
          <Icon node={Send} size={22} />
        </button>
      </form>
    </>
  );
}

type Entry = { id: number; at: number; service: string; what: string; ms?: number; code?: number; reply?: object };
type Service = { name: string; up: boolean; ms?: number; error?: string };

// The server names a call by its last path segment ("lock_pc", "pause"); show the matching button's label instead.
const LABEL: Record<string, string> = Object.fromEntries(
  [...DISCORD, ...VOLUME, ...APPS, ...SYSTEM, PREV, PLAY_PAUSE, NEXT, ...TV_PLAYBACK, ...TV_POWER].map((b) => [
    b.path.split('/').pop(),
    b.label,
  ]),
);

const ago = (ms: number) =>
  ms < 60_000 ? `${Math.floor(ms / 1000)}s ago` : ms < 3_600_000 ? `${Math.floor(ms / 60_000)}m ago` : `${Math.floor(ms / 3_600_000)}h ago`;
const took = (ms = 0) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);
const upFor = (s: number) =>
  s >= 86_400 ? `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3600)}h` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;

function Feed({ active }: { active: boolean }) {
  const status = usePoll('/api/status', 2000, active);
  const health = usePoll('/api/status/health', 10_000, active);
  const feed: Entry[] = status?.data.feed ?? [];
  const services: Service[] = health?.data.services ?? [];
  const pi = status?.data.pi;
  const now = Date.now(); // same clock as the server: both run on the Pi

  return (
    <>
      <div class="head">
        <h1>Activity</h1>
        {pi && (
          <span class="pi">
            {pi.tempC != null && (
              <span class={pi.tempC >= 80 ? 'err' : pi.tempC >= 70 ? 'warn' : ''}>{Math.round(pi.tempC)}°C · </span>
            )}
            load {pi.load.toFixed(2)} · RAM {pi.memPct}% · up {upFor(pi.uptimeS)}
          </span>
        )}
      </div>
      <div class="chips">
        {!health && <span class="chip">Checking services…</span>}
        {services.map((s) => (
          <span key={s.name} class={`chip ${s.up ? 'ok' : 'err'}`}>
            <i class="dot" />
            {s.name}
            <small>{s.up ? `${s.ms}ms` : s.error}</small>
          </span>
        ))}
      </div>
      <h2>Calls</h2>
      {status && !status.ok && <p class="empty">Activity unavailable</p>}
      {status?.ok && feed.length === 0 && <p class="empty">Nothing yet. Press a button and it shows up here.</p>}
      <ul class="feed">
        {feed.map((e) => {
          const running = e.code == null;
          // Same wording and colour as the toast that button showed.
          const [msg, kind] = running ? ['', 'run'] : describe({ ok: e.code! >= 200 && e.code! < 300, data: e.reply ?? {} });
          return (
            <li key={e.id} class={kind}>
              <i class="dot" />
              <span class="svc">{e.service}</span>
              <span class="what">
                {LABEL[e.what] ?? e.what}
                {msg && msg !== 'done' && <small>{msg}</small>}
              </span>
              <span class="when">
                {running ? `running ${clock((now - e.at) / 1000)}` : `${ago(now - e.at)} · ${took(e.ms)}`}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

type Run = { id: string; request: string; question?: string };
type Turn = { id: string; channel: string; at: Date; said?: string; path: string[]; reply?: string; ms?: number; state: 'run' | 'ok' | 'err' };

const hhmm = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const isToday = (ts: string) => new Date(ts).toDateString() === new Date().toDateString();

// One card per message: what was said, the way it went (fast path or which model, then which tool), and the answer.
function turnsOf(events: TraceEvent[]): Turn[] {
  const turns = new Map<string, Turn>();
  for (const e of events) {
    let t = turns.get(e.requestId);
    if (!t) turns.set(e.requestId, (t = { id: e.requestId, channel: e.channel, at: new Date(e.ts), path: [], state: 'run' }));
    const add = (s: string) => t.path.at(-1) !== s && t.path.push(s);
    if (e.step === 'request') t.said = e.text ?? undefined;
    else if (e.step === 'fast_path' && e.hit) add('fast path');
    else if (e.step.startsWith('llm:') && e.model) add(modelName(e.model));
    else if ((e.step === 'tool' || e.step === 'agent_tool') && e.tool) {
      add(e.tool.replace(/_/g, ' ') + (e.ok === false ? ' ✗' : ''));
      if (e.ok === false) t.state = 'err';
    } else if (e.step === 'error') {
      add('error');
      t.state = 'err';
    } else if (e.step === 'reply') {
      t.reply = e.text ?? undefined;
      t.ms = e.latencyMs ?? undefined;
      if (t.state === 'run') t.state = 'ok';
    }
  }
  // A turn with no reply after five minutes never got one (Ekko restarted mid-turn).
  for (const t of turns.values()) if (t.state === 'run' && Date.now() - t.at.getTime() > 300_000) t.state = 'err';
  return [...turns.values()].reverse();
}

function RunCard({ run }: { run: Run }) {
  const notify = useContext(Notify);
  const [busy, setBusy] = useState(false);
  async function decide(verdict: 'approve' | 'deny') {
    setBusy(true);
    notify([verdict === 'approve' ? 'Approving…' : 'Denying…', '']);
    const r = await api(`/api/ekko/runs/${run.id}/${verdict}`);
    notify(r.ok ? [r.data.text ?? 'done', 'ok'] : describe(r));
    setBusy(false);
  }
  return (
    <div class="run-card">
      <div>
        <b>Claude is waiting on you</b>
        <span>{run.question ?? run.request}</span>
      </div>
      <button class="pill accent" disabled={busy} onClick={() => decide('approve')}>
        Approve
      </button>
      <button class="pill" disabled={busy} onClick={() => decide('deny')}>
        Deny
      </button>
    </div>
  );
}

function Ekko({ active }: { active: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<EkkoMap | null>(null);
  const cursor = useRef({ boot: '', seq: 0 });
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [down, setDown] = useState('');
  const runs = usePoll('/api/ekko/runs', 3000, active);
  const waiting: Run[] = runs?.ok && Array.isArray(runs.data) ? runs.data : [];

  useEffect(() => {
    map.current = createMap(box.current!);
    return () => map.current!.destroy();
  }, []);
  useEffect(() => map.current!.setActive(active), [active]);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: number | undefined;
    // The first check after the page comes back on screen returns what happened while it was away: count it, don't play it.
    let caughtUp = false;
    const tick = async (): Promise<void> => {
      const c = cursor.current;
      const r = await api(`/api/ekko/trace?after=${c.seq}`, undefined, 'GET');
      if (stopped) return;
      if (!r.ok) setDown(r.data.error ?? 'Ekko unavailable');
      else if (c.boot && r.data.boot !== c.boot) {
        // Ekko restarted and its numbers began again: load everything afresh.
        Object.assign(c, { boot: '', seq: 0 });
        return tick();
      } else {
        setDown('');
        const list: TraceEvent[] = r.data.events ?? [];
        const m = map.current!;
        if (!c.boot) {
          m.reset();
          list.forEach((e) => m.add(e)); // counted, not played: these already happened
          setEvents(list);
        } else if (list.length) {
          list.forEach((e, i) => {
            m.add(e);
            if (caughtUp) m.play(e, i * 180); // a batch plays in order rather than all at once
          });
          setEvents((old) => [...old, ...list].slice(-1000));
        }
        c.boot = r.data.boot;
        if (list.length) c.seq = list[list.length - 1].seq;
        caughtUp = true;
      }
      timer = setTimeout(tick, 1000);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active]);

  const turns = useMemo(() => turnsOf(events).slice(0, 40), [events]);
  const today = events.filter((e) => isToday(e.ts));
  const messages = today.filter((e) => e.step === 'request').length;
  const claude = today.filter((e) => e.step.startsWith('llm:') && isClaude(e.model));
  const claudeTurns = new Set(claude.map((e) => e.requestId)).size;
  const tokens = claude.reduce((n, e) => n + (e.tokensIn ?? 0) + (e.tokensOut ?? 0), 0);

  return (
    <>
      <div class="head">
        <h1>Ekko</h1>
        <span class="pi">
          {down ||
            `${messages} message${messages === 1 ? '' : 's'} today` +
              (claudeTurns ? ` · ${claudeTurns} used Claude · ${(tokens / 1000).toFixed(1)}k tokens` : '')}
        </span>
      </div>
      {waiting.map((r) => (
        <RunCard key={r.id} run={r} />
      ))}
      <div class="ekko-view">
        <div class="map" ref={box} aria-label="Live map of what Ekko is doing" role="img" />
        <div class="turns">
          {turns.length === 0 && <p class="empty">{down ? 'Ekko unavailable' : 'No messages yet.'}</p>}
          {turns.map((t) => (
            <div key={t.id} class={`turn ${t.state}`}>
              <div class="said">
                <i class="dot" />
                <b>{t.said ?? '…'}</b>
                <time>{hhmm(t.at)}</time>
              </div>
              <div class="path">
                {[t.channel, ...t.path].join(' → ')}
                {t.state === 'run' ? ' · working…' : t.ms != null ? ` · ${took(t.ms)}` : ''}
              </div>
              {t.reply && <div class="ans">{t.reply}</div>}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

const PAGES = 7; // one dot per <section> below

function App() {
  const track = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [toast, setToast] = useState<Status>(['', '']);

  useEffect(() => {
    if (!toast[1]) return; // "working…" stays up until its result replaces it
    const t = setTimeout(() => setToast(['', '']), toast[1] === 'ok' ? 2500 : 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const go = (i: number) => {
    const t = track.current;
    if (t) t.scrollTo({ left: Math.max(0, Math.min(t.children.length - 1, i)) * t.clientWidth, behavior: 'smooth' });
  };

  // Our own swipe, for when the browser won't pan by itself (touch reported as a mouse, or a mouse over RustDesk).
  // When the browser does pan natively it sends pointercancel instead of pointerup, so the two never both fire.
  const swipe = useRef({ x: 0, y: 0, down: false, at: 0 });
  const onPointerDown = (e: PointerEvent) => Object.assign(swipe.current, { x: e.clientX, y: e.clientY, down: true });
  const onPointerUp = (e: PointerEvent) => {
    const s = swipe.current;
    if (!s.down) return;
    s.down = false;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) < 60 || Math.abs(dx) < 1.5 * Math.abs(e.clientY - s.y)) return;
    s.at = Date.now();
    go(page + (dx < 0 ? 1 : -1));
  };
  // A swipe that starts and ends on the same button must not also press it.
  const onClickCapture = (e: MouseEvent) => {
    if (Date.now() - swipe.current.at < 400) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  return (
    <Notify.Provider value={setToast}>
      {/* Pages sit side by side in a scroll-snap strip, so a native touch swipe scrolls and snaps to the next page. */}
      <div
        class="track"
        ref={track}
        // scrollend, not scroll: re-rendering (and starting Music's polling) mid-swipe causes a stutter on the Pi
        onScrollEnd={(e) => setPage(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (swipe.current.down = false)}
        onClickCapture={onClickCapture}
      >
        <section class="page" aria-label="Voice">
          <h1>Voice</h1>
          <div class="groups">
            <div>
              <h2>
                Discord <small>toggles</small>
              </h2>
              <Grid items={DISCORD} />
            </div>
            <div>
              <h2>Volume</h2>
              <Grid items={VOLUME} />
            </div>
            <div>
              <h2>Apps</h2>
              <Grid items={APPS} />
            </div>
            <div>
              <h2>Game Mode</h2>
              <Grid items={GAME} />
            </div>
          </div>
        </section>
        <section class="page" aria-label="System">
          <h1>System</h1>
          <Grid items={SYSTEM} />
        </section>
        <section class="page" aria-label="Music">
          <h1>Music</h1>
          <Music active={page === 2} />
        </section>
        <section class="page" aria-label="TV">
          <h1>TV</h1>
          <Tv />
        </section>
        <section class="page fill" aria-label="Chat">
          <h1>Chat</h1>
          <Chat />
        </section>
        <section class="page fill" aria-label="Ekko">
          <Ekko active={page === 5} />
        </section>
        <section class="page" aria-label="Activity">
          <Feed active={page === 6} />
        </section>
      </div>

      <div class="dots" aria-hidden="true">
        {Array.from({ length: PAGES }, (_, i) => (
          <i key={i} class={i === page ? 'on' : undefined} />
        ))}
      </div>

      <div class={`toast ${toast[1]}`} role="status" hidden={!toast[0]}>
        {toast[0]}
      </div>
    </Notify.Provider>
  );
}

render(<App />, document.getElementById('app')!);
