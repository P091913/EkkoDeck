import '@fontsource-variable/inter';
import { createContext, h, render } from 'preact';
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
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

function Music({ active }: { active: boolean }) {
  const [np, setNp] = useState<Reply | null>(null);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: number | undefined;
    // Chain timeouts instead of setInterval so a slow agent never piles up requests.
    const tick = async () => {
      const r = await api('/api/pc/nowplaying', undefined, 'GET');
      if (stopped) return;
      setNp(r);
      timer = setTimeout(tick, 2000);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active]);

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
        <div style={{ width: `${pct}%` }} />
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

  async function play(body: object) {
    setCandidates([]);
    notify(['Working… waking the TV can take up to 2 minutes', '']);
    const r = await api('/api/tv/play', body);
    setCandidates(r.data.data?.candidates ?? []);
    notify(describe(r));
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
        <button class="pill accent">Play</button>
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
        onScroll={(e) => setPage(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
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
      </div>

      <div class={`toast ${toast[1]}`} role="status" hidden={!toast[0]}>
        {toast[0]}
      </div>
    </Notify.Provider>
  );
}

render(<App />, document.getElementById('app')!);
