// The live map on the Ekko page: Ekko in the middle, a swirl for each channel, model and tool domain around it,
// and particles that fly between them as Ekko's trace arrives. A message plays as one loop:
// channel -> Ekko -> model -> Ekko -> domain -> Ekko -> channel. Nothing flies unless a real step just arrived;
// between steps the swirls only turn in place. Draws only while its page is on screen.

export type TraceEvent = {
  seq: number;
  ts: string;
  requestId: string;
  channel: string;
  step: string;
  domain: string | null;
  tool: string | null;
  model: string | null;
  ok: boolean | null;
  hit: boolean | null;
  latencyMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  text: string | null;
  error: string | null;
};

export type EkkoMap = {
  /** Counts the event toward today's swirl sizes. */
  add(e: TraceEvent): void;
  /** Plays the event on the map after `delay` ms. */
  play(e: TraceEvent, delay: number): void;
  /** Forget every swirl but Ekko's: the trace starts over. */
  reset(): void;
  setActive(on: boolean): void;
  destroy(): void;
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const isClaude = (model: string | null) => !!model?.startsWith('claude');
// "qwen3.5:9b" -> "Qwen3.5", "claude-haiku-5-5" -> "Claude haiku"
export const modelName = (m: string) => cap(isClaude(m) ? m.split('-').slice(0, 2).join(' ') : m.split(':')[0]);
export const domainName = (d: string) => (d === 'tv' ? 'TV' : cap(d.replace(/_/g, ' ')));

type Kind = 'center' | 'channel' | 'model' | 'claude' | 'domain';
const HUE: Record<Kind, number> = { center: 228, channel: 188, model: 262, claude: 24, domain: 145 };
const ORDER: Kind[] = ['channel', 'model', 'claude', 'domain'];

type Node = { key: string; kind: Kind; label: string; x: number; y: number; r: number; home: number; count: number; bad: number; hit: number };
type Flight = { x0: number; y0: number; cx: number; cy: number; to: Node; start: number; dur: number };
type Particle = {
  host: Node;
  a: number;
  rr: number;
  rMin: number;
  rMax: number;
  dir: number;
  aSpeed: number;
  rSpeed: number;
  size: number;
  hueOff: number;
  x: number;
  y: number;
  red?: boolean; // a failure, red until it lands
  fly?: Flight;
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const ease = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

export function createMap(box: HTMLElement): EkkoMap {
  // Two layers: particles on one that is only ever faded, never cleared, so each leaves a trail;
  // names and counts on a clear one above, redrawn only when they change, so text stays crisp and cheap.
  const swirl = document.createElement('canvas');
  const words = document.createElement('canvas');
  box.append(swirl, words);
  const ctx = swirl.getContext('2d')!;
  const top = words.getContext('2d')!;

  const node = (key: string, kind: Kind, label: string): Node => ({ key, kind, label, x: 0, y: 0, r: 0, home: 0, count: 0, bad: 0, hit: 0 });
  const center = node('ekko', 'center', 'Ekko');
  const nodes = new Map<string, Node>();
  const counted = new Map<Node, Map<string, boolean>>(); // request ids counted for a swirl -> whether that request failed there
  const toolDomain = new Map<string, string>(); // learned from the router, for older tool lines that name no domain
  let particles: Particle[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let W = 0;
  let H = 0;
  let base = 0;
  let raf = 0;
  let last = 0;
  let lastTidy = 0;
  let wordsDirty = true;

  function ensure(key: string, kind: Kind, label: string) {
    let n = nodes.get(key);
    if (!n) {
      n = node(key, kind, label);
      nodes.set(key, n);
      layout();
    }
    return n;
  }

  const homeOf = (n: Node) => (n === center ? 40 : 7 + Math.min(14, Math.round(2 * Math.sqrt(n.count))));
  const radiusOf = (n: Node) => (n === center ? Math.min(W, H) * 0.12 : base * Math.min(2, 1 + 0.2 * Math.sqrt(n.count)));

  function particle(host: Node): Particle {
    const inner = host === center ? 0.5 : 0.25;
    const rMin = rand(inner, 0.7);
    const rMax = rand(0.75, 1.05);
    return {
      host,
      a: rand(0, Math.PI * 2),
      rr: rand(rMin, rMax),
      rMin,
      rMax,
      dir: Math.random() < 0.5 ? -1 : 1,
      aSpeed: rand(0.35, 1.1) * (Math.random() < 0.5 ? -1 : 1),
      rSpeed: rand(0.04, 0.14),
      size: host === center ? rand(1.6, 2.8) : rand(1.2, 2.3),
      hueOff: rand(-14, 14),
      x: host.x,
      y: host.y,
    };
  }

  // Ekko in the middle; the rest on an oval around it, clockwise from lower left: channels, models, domains.
  function layout() {
    if (!W || !H) return;
    base = Math.min(W, H) * 0.05;
    const ring = [...nodes.values()].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.label.localeCompare(b.label));
    center.x = W / 2;
    center.y = H / 2;
    center.r = radiusOf(center);
    center.home = homeOf(center);
    const rx = W / 2 - base - 40; // room for half the widest name
    const ry = H / 2 - base - 24; // and for the name under the bottom swirl
    ring.forEach((n, i) => {
      const a = Math.PI * 0.75 + (i * 2 * Math.PI) / ring.length;
      n.x = center.x + Math.cos(a) * rx;
      n.y = center.y + Math.sin(a) * ry;
      n.r = radiusOf(n);
      n.home = homeOf(n);
    });
    // Every swirl gets the particles it is owed; extras fade away in tidy().
    for (const n of [center, ...nodes.values()]) {
      const have = particles.filter((p) => p.host === n).length;
      for (let i = have; i < n.home; i++) particles.push(particle(n));
    }
    wordsDirty = true;
  }

  function resize() {
    W = box.clientWidth;
    H = box.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    for (const c of [swirl, words]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    top.setTransform(dpr, 0, 0, dpr, 0, 0);
    layout();
  }

  // Some of one swirl's particles peel off the side facing the other, arc across, and join it.
  function send(from: Node, to: Node, n: number, ok: boolean) {
    if (from === to || !raf) return;
    const mine = particles.filter((p) => p.host === from && !p.fly);
    n = Math.min(n, mine.length - (from === center ? 12 : 3));
    if (n <= 0) return;
    mine.sort((a, b) => Math.hypot(a.x - to.x, a.y - to.y) - Math.hypot(b.x - to.x, b.y - to.y));
    const now = performance.now();
    for (let i = 0; i < n; i++) {
      const p = mine[i];
      const dx = to.x - p.x;
      const dy = to.y - p.y;
      const dist = Math.hypot(dx, dy) || 1;
      const bulge = dist * rand(0.12, 0.3) * (Math.random() < 0.5 ? -1 : 1);
      p.fly = {
        x0: p.x,
        y0: p.y,
        cx: (p.x + to.x) / 2 - (dy / dist) * bulge,
        cy: (p.y + to.y) / 2 + (dx / dist) * bulge,
        to,
        start: now + i * 40,
        dur: 700 + Math.min(600, dist) * 0.6 + rand(0, 200),
      };
      p.red = !ok;
    }
  }

  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  };

  // Where an event goes, if anywhere but Ekko itself.
  function targetOf(e: TraceEvent): Node | undefined {
    if (e.step.startsWith('llm:') && e.model) return ensure(`m:${e.model}`, isClaude(e.model) ? 'claude' : 'model', modelName(e.model));
    const agent = e.step === 'agent_tool' || e.step === 'agent_run';
    if (agent || e.step === 'tool' || (e.step === 'route' && e.domain)) {
      const d = agent ? 'server_ops' : (e.domain ?? toolDomain.get(e.tool ?? '') ?? 'tools');
      return ensure(`d:${d}`, 'domain', domainName(d));
    }
  }

  // shortcut: "today" is decided as each event arrives; a page left open past midnight keeps yesterday's sizes until Ekko restarts.
  function count(n: Node, e: TraceEvent) {
    if (new Date(e.ts).toDateString() !== new Date().toDateString()) return;
    let ids = counted.get(n);
    if (!ids) counted.set(n, (ids = new Map()));
    // The request's last try decides, so a model or tool that fails once and then works on retry isn't a failure.
    if (typeof e.ok === 'boolean' || !ids.has(e.requestId)) ids.set(e.requestId, e.ok === false);
    const bad = [...ids.values()].filter(Boolean).length;
    if (bad !== n.bad) (n.bad = bad), (wordsDirty = true);
    if (ids.size !== n.count) {
      n.count = ids.size;
      n.r = radiusOf(n);
      n.home = homeOf(n);
      layout();
    }
  }

  function animate(e: TraceEvent, ch: Node, target?: Node) {
    const now = performance.now();
    if (e.step === 'request') return send(ch, center, 6, true);
    if (e.step === 'reply') return send(center, ch, 6, true);
    if (e.step === 'route' && target) return send(center, target, 2, true);
    if (target && e.step !== 'agent_run') {
      // Out to the model or tool and back; it already finished, so the way back shows how it went.
      send(center, target, 4, true);
      return later(650, () => send(target, center, 4, e.ok !== false));
    }
    (target ?? center).hit = now; // the steps in between stir a swirl without moving anything
  }

  // Real steps leave swirls over or under their share. Settle that in place, without flying anything:
  // an extra particle fades out, a missing one appears. Only real steps ever send particles between swirls.
  function tidy(now: number) {
    if (now - lastTidy < 1400) return;
    lastTidy = now;
    for (const n of [center, ...nodes.values()]) {
      const mine = particles.filter((p) => p.host === n && !p.fly);
      if (mine.length > n.home + 2) particles.splice(particles.indexOf(mine[0]), 1);
      else if (mine.length < n.home) particles.push(particle(n));
    }
  }

  function step(p: Particle, now: number, dt: number) {
    const f = p.fly;
    if (f) {
      const t = Math.max(0, (now - f.start) / f.dur);
      if (t >= 1) {
        // Landed: join the swirl at its edge.
        p.host = f.to;
        p.a = Math.atan2(p.y - f.to.y, p.x - f.to.x);
        p.rr = p.rMax;
        p.dir = -1;
        p.fly = undefined;
        p.red = false;
        f.to.hit = now;
        return;
      }
      const q = ease(t);
      const u = 1 - q;
      const wobble = 3 * Math.sin(q * Math.PI);
      p.x = u * u * f.x0 + 2 * u * q * f.cx + q * q * f.to.x + Math.cos(now / 90 + p.a) * wobble;
      p.y = u * u * f.y0 + 2 * u * q * f.cy + q * q * f.to.y + Math.sin(now / 90 + p.a) * wobble;
      return;
    }
    const g = p.host;
    const energy = Math.max(0, 1 - (now - g.hit) / 900);
    p.a += p.aSpeed * (1 + energy * 2.5) * dt;
    p.rr += p.dir * p.rSpeed * (1 + energy) * dt;
    if (p.rr > p.rMax) (p.rr = p.rMax), (p.dir = -1);
    if (p.rr < p.rMin) (p.rr = p.rMin), (p.dir = 1);
    p.x = g.x + Math.cos(p.a) * p.rr * g.r;
    p.y = g.y + Math.sin(p.a) * p.rr * g.r;
  }

  function drawWords() {
    wordsDirty = false;
    top.clearRect(0, 0, W, H);
    top.textAlign = 'center';
    for (const n of nodes.values()) {
      top.textBaseline = 'middle';
      if (n.count > 0) {
        top.fillStyle = '#eef0f6';
        top.font = `600 ${Math.round(Math.max(11, n.r * 0.7))}px 'Inter Variable', system-ui, sans-serif`;
        top.fillText(String(n.count), n.x, n.y + 1);
      }
      top.textBaseline = 'top';
      top.fillStyle = n.bad > 0 && n.bad * 3 >= n.count ? '#ff6b6b' : '#8a90a2';
      top.font = `500 12px 'Inter Variable', system-ui, sans-serif`;
      top.fillText(n.label, n.x, n.y + n.r + 6);
    }
    top.textBaseline = 'middle';
    top.fillStyle = '#eef0f6';
    top.font = `700 ${Math.round(center.r * 0.42)}px 'Inter Variable', system-ui, sans-serif`;
    top.fillText('Ekko', center.x, center.y + 1);
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    if (box.clientWidth !== W || box.clientHeight !== H) resize();
    if (!W || !H) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    tidy(now);
    // The wash: the last frame fades toward transparent rather than vanishing, so particles trail and the page shows through.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    for (const p of particles) {
      step(p, now, dt);
      const g = p.fly ? p.fly.to : p.host;
      const energy = p.fly ? 1 : Math.max(0, 1 - (now - g.hit) / 900);
      const quiet = g.count === 0 && g !== center ? 0.55 : 1;
      const rim = p.fly ? 1 : (p.rr - p.rMin) / Math.max(0.01, p.rMax - p.rMin); // brighter at the rim
      ctx.globalAlpha = Math.min(1, (0.35 + 0.45 * rim) * quiet + energy * 0.2);
      ctx.fillStyle = p.red ? '#ff5a5a' : `hsl(${HUE[p.host.kind] + p.hueOff} 80% ${62 + energy * 12}%)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 + energy * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (wordsDirty) drawWords();
  }

  return {
    add(e) {
      if (e.step === 'extract' && e.tool && e.domain) toolDomain.set(e.tool, e.domain);
      const target = targetOf(e);
      if (e.step === 'request') count(ensure(`ch:${e.channel}`, 'channel', cap(e.channel)), e);
      if (target) count(target, e);
    },
    play(e, delay) {
      const ch = ensure(`ch:${e.channel}`, 'channel', cap(e.channel));
      const target = targetOf(e);
      later(delay, () => animate(e, ch, target));
    },
    reset() {
      nodes.clear();
      counted.clear();
      particles = particles.filter((p) => p.host === center && !p.fly);
      layout();
    },
    setActive(on) {
      if (on && !raf) {
        last = 0;
        raf = requestAnimationFrame(frame);
      } else if (!on && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    destroy() {
      cancelAnimationFrame(raf);
      raf = 0;
      timers.forEach(clearTimeout);
      swirl.remove();
      words.remove();
    },
  };
}
