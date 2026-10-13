// Canvas renderer for the heliocentric map and the near-Earth inset. Both
// functions draw onto any 2D context at any size, so the on-screen canvas and
// the exported snapshot share one code path.

import { BODIES } from './catalog.js';
import { R_SUN_AU } from './frames.js';

const FONT_MONO = '"IBM Plex Mono", ui-monospace, monospace';
const FONT_SANS = '"Instrument Sans", system-ui, sans-serif';

export function readTheme(el = document.documentElement) {
  const cs = getComputedStyle(el);
  const v = (n) => cs.getPropertyValue(n).trim();
  const color = {};
  for (const k of Object.keys(BODIES)) color[k] = v(`--c-${k}`) || v('--ink');
  return {
    bg: v('--plot-bg'), page: v('--bg'), line: v('--line'), accent: v('--accent'),
    ink: v('--ink'), muted: v('--muted'), grid: v('--grid'),
    sun: v('--sun'), glow: v('--sun-glow'), sunStyle: v('--sun-style') || 'glow',
    spiral: v('--spiral'), moon: v('--c-moon'), cme: v('--cme') || v('--accent'), color,
  };
}

function niceStep(range) {
  for (const s of [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1]) if (range / s <= 6) return s;
  return 1;
}

function polyline(ctx, pts, map) {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const [x, y] = map(p);
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  });
}

function placeLabels(ctx, items, W, H, avoid = []) {
  const placed = [...avoid];
  const hit = (r) => placed.some((q) => r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y);
  const out = [];
  for (const it of items) {
    const w = ctx.measureText(it.text).width + 6;
    const h = it.size + 4;
    const d = it.r + 5;
    const cands = [
      [d, -h / 2], [-d - w, -h / 2], [-w / 2, -d - h], [-w / 2, d],
      [d, -h * 1.5], [d, h * 0.5], [-d - w, -h * 1.5], [-d - w, h * 0.5],
      [d, -h * 2.5], [d, h * 1.5], [-d - w, -h * 2.5], [-d - w, h * 1.5],
      [d, -h * 3.5], [d, h * 2.5], [-d - w, h * 2.5], [-d - w, -h * 3.5],
    ];
    let best = null;
    for (const [dx, dy] of cands) {
      const r = { x: it.x + dx, y: it.y + dy, w, h };
      if (r.x < 2 || r.y < 2 || r.x + w > W - 2 || r.y + h > H - 2) continue;
      if (!hit(r)) { best = r; break; }
      best ??= r;
    }
    if (!best) continue;
    placed.push(best);
    out.push({ ...it, rect: best });
  }
  return out;
}

function drawMarker(ctx, key, x, y, r, col, bg, st) {
  const kind = BODIES[key].kind;
  ctx.lineWidth = Math.max(1.2, r * 0.35);
  ctx.setLineDash(st === 'lost' ? [2, 2] : []);
  ctx.beginPath();
  if (kind === 'sc') {
    ctx.moveTo(x, y - r * 1.25); ctx.lineTo(x + r * 1.25, y);
    ctx.lineTo(x, y + r * 1.25); ctx.lineTo(x - r * 1.25, y); ctx.closePath();
  } else {
    ctx.arc(x, y, key === 'earth' ? r * 1.15 : r * 0.85, 0, 2 * Math.PI);
  }
  ctx.strokeStyle = bg;
  ctx.lineWidth = r * 0.9;
  ctx.stroke();
  ctx.lineWidth = Math.max(1.2, r * 0.35);
  if (st === 'lost') {
    ctx.strokeStyle = col; ctx.stroke();
  } else {
    ctx.fillStyle = col; ctx.fill();
  }
  ctx.setLineDash([]);
  if (key === 'earth') {
    ctx.beginPath();
    ctx.arc(x, y, r * 2.1, 0, 2 * Math.PI);
    ctx.strokeStyle = col; ctx.globalAlpha = 0.45; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;
  }
}

function drawSun(ctx, x, y, r, th) {
  if (th.sunStyle === 'eclipse') {
    const g = ctx.createRadialGradient(x, y, r, x, y, r * 4.2);
    g.addColorStop(0, th.glow); g.addColorStop(0.25, th.glow + '88'); g.addColorStop(1, 'transparent');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 4.2, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = th.bg; ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = th.sun; ctx.lineWidth = 1.2; ctx.stroke();
    return;
  }
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3.6);
  g.addColorStop(0, th.glow); g.addColorStop(1, 'transparent');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 3.6, 0, 2 * Math.PI); ctx.fill();
  ctx.fillStyle = th.sun; ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill();
}

// Pixels per au and the Sun's pixel position. `reserve` is width kept free
// on the right for the inset when the map is wide enough to spare it.
export function mapGeometry(W, H, view, reserve = 0, k = 1) {
  const r = W - reserve >= H ? reserve : 0;
  const ppa = (Math.min(W - r, H) / 2 - 18 * k) / view.range;
  return { ppa, ox: (W - r) / 2 - view.cx * ppa, oy: H / 2 + view.cy * ppa };
}

// view = { range (au from centre to nearest edge), cx, cy (pan in au) }
export function drawMap(ctx, W, H, scene, s, th, view, opts = {}) {
  const k = opts.k ?? 1; // typographic scale for exports
  const { ppa, ox, oy } = mapGeometry(W, H, view, opts.reserve, k);
  const map = ([x, y]) => [ox + x * ppa, oy - y * ppa];

  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, W, H);
  if (!scene) return;

  // Distance rings, longitude spokes, ecliptic line
  const step = niceStep(view.range * 1.3);
  const rmax = Math.hypot(W, H) / ppa + Math.hypot(view.cx, view.cy);
  ctx.lineWidth = 1;
  ctx.strokeStyle = th.grid;
  ctx.font = `${10.5 * k}px ${FONT_MONO}`;
  ctx.fillStyle = th.muted;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let r = step; r < rmax && s.view === 'top'; r += step) {
    ctx.beginPath();
    ctx.arc(ox, oy, r * ppa, 0, 2 * Math.PI);
    ctx.stroke();
    const lx = ox - r * ppa * 0.82 + 4 * k;
    const ly = oy + r * ppa * 0.57;
    if (lx > 4 * k && lx < W - 40 * k && ly > 10 * k && ly < H - 10 * k) {
      ctx.fillText(`${+r.toFixed(2)} au`, lx, ly);
    }
  }
  if (s.view === 'top') {
    const R = view.range * 0.97 * ppa;
    ctx.textAlign = 'center';
    for (let a = 0; a < 360; a += 30) {
      // Screen angle of longitude a (HEE: 0° at Earth, bottom; HAE: 0° right)
      const t = s.frame === 'hee' ? ((a - 90) * Math.PI) / 180 : (a * Math.PI) / 180;
      const dx = Math.cos(t);
      const dy = -Math.sin(t);
      ctx.beginPath();
      ctx.moveTo(ox + dx * step * 0.5 * ppa, oy + dy * step * 0.5 * ppa);
      ctx.lineTo(ox + dx * rmax * ppa, oy + dy * rmax * ppa);
      ctx.globalAlpha = 0.55; ctx.stroke(); ctx.globalAlpha = 1;
      const tx = ox + dx * (R - 4 * k);
      const ty = oy + dy * (R - 4 * k);
      if (tx > 12 * k && tx < W - 12 * k && ty > 8 * k && ty < H - 8 * k) {
        const lbl = s.frame === 'hee' ? `${a > 180 ? a - 360 : a}°` : `${a}°`;
        ctx.fillStyle = th.bg;
        const w = ctx.measureText(lbl).width + 6 * k;
        ctx.fillRect(tx - w / 2, ty - 7 * k, w, 14 * k);
        ctx.fillStyle = th.muted;
        ctx.fillText(lbl, tx, ty);
      }
    }
  } else {
    // Edge-on: a Cartesian grid in au, labelled along the ecliptic
    const n = Math.ceil(rmax / step);
    ctx.textAlign = 'center';
    for (let i = -n; i <= n; i++) {
      if (!i) continue;
      const gx = ox + i * step * ppa;
      const gy = oy - i * step * ppa;
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
      if (gx > 20 * k && gx < W - 20 * k) ctx.fillText(`${+(i * step).toFixed(2)}`, gx, oy + 12 * k);
    }
    ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(W, oy);
    ctx.strokeStyle = th.muted; ctx.globalAlpha = 0.6; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
    ctx.fillText('ecliptic plane · au', 14 * k, H - 16 * k);
  }

  // Planet orbits
  for (const [key, pts] of Object.entries(scene.orbits)) {
    if (pts.length < 2) continue;
    polyline(ctx, pts, map);
    ctx.strokeStyle = th.color[key];
    ctx.globalAlpha = key === 'earth' ? 0.55 : 0.3;
    ctx.lineWidth = key === 'earth' ? 1.3 * k : 1 * k;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Parker spirals
  for (const [key, pts] of Object.entries(scene.spirals)) {
    if (s.hidden.has(key)) continue;
    polyline(ctx, pts, map);
    ctx.strokeStyle = th.color[key];
    ctx.globalAlpha = 0.5;
    ctx.setLineDash([5 * k, 4 * k]);
    ctx.lineWidth = 1.1 * k;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // CME fronts: faint wedge from the Sun, solid leading edge
  for (const c of scene.cmes ?? []) {
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    for (const p of c.arc) { const [x, y] = map(p); ctx.lineTo(x, y); }
    ctx.closePath();
    ctx.fillStyle = th.cme;
    ctx.globalAlpha = 0.09;
    ctx.fill();
    ctx.globalAlpha = 0.9;
    polyline(ctx, c.arc, map);
    ctx.strokeStyle = th.cme;
    ctx.lineWidth = 2.2 * k;
    ctx.stroke();
    ctx.globalAlpha = 1;
    const [ax, ay] = map(c.apex);
    if (ax > 0 && ax < W && ay > 0 && ay < H) {
      ctx.font = `600 ${11 * k}px ${FONT_SANS}`;
      ctx.fillStyle = th.cme;
      ctx.textAlign = ax >= ox ? 'left' : 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(c.label, ax + (ax >= ox ? 8 : -8) * k, ay - 8 * k);
    }
  }

  // Sun–Earth line
  const earth = scene.bodies[0];
  const [ex, ey] = map(earth.xy);
  ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ex, ey);
  ctx.strokeStyle = th.color.earth; ctx.globalAlpha = 0.35; ctx.lineWidth = 1 * k; ctx.stroke(); ctx.globalAlpha = 1;

  // Trails: past solid and fading, future dotted
  for (const [key, tr] of Object.entries(scene.trails)) {
    if (s.hidden.has(key)) continue;
    const col = th.color[key];
    const n = tr.past.length;
    ctx.lineWidth = 1.8 * k;
    ctx.strokeStyle = col;
    for (let i = 1; i < n; i++) {
      const [x0, y0] = map(tr.past[i - 1]);
      const [x1, y1] = map(tr.past[i]);
      ctx.globalAlpha = 0.1 + 0.75 * (i / n);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    ctx.globalAlpha = 0.6;
    ctx.setLineDash([1.5 * k, 4 * k]);
    ctx.lineCap = 'round';
    polyline(ctx, tr.future, map);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineCap = 'butt';
    ctx.globalAlpha = 1;
  }

  // Direction of a chosen point on the Sun (visibility tool)
  if (scene.spot) {
    const [dx, dy] = scene.spot.dir;
    const len = Math.hypot(dx, dy) || 1;
    const far = Math.hypot(W, H);
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + (dx / len) * far, oy - (dy / len) * far);
    ctx.strokeStyle = th.accent;
    ctx.lineWidth = 1.6 * k;
    ctx.setLineDash([7 * k, 5 * k]);
    ctx.globalAlpha = 0.85;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    const lr = Math.min(W, H) * 0.12;
    ctx.font = `600 ${11.5 * k}px ${FONT_SANS}`;
    ctx.fillStyle = th.accent;
    ctx.textAlign = dx >= 0 ? 'left' : 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(scene.spot.label, ox + (dx / len) * lr + (dx >= 0 ? 8 : -8) * k, oy - (dy / len) * lr - 10 * k);
  }

  // Sun, drawn at true size once zoomed in far enough
  drawSun(ctx, ox, oy, Math.max(R_SUN_AU * ppa, 6.5 * k), th);

  // Bodies, front to back so spacecraft sit over Earth
  const order = [...scene.bodies].reverse().filter((b) => !s.hidden.has(b.key));
  const labels = [];
  const near = order.filter((b) => BODIES[b.key].near).reverse();
  if (near.length && s.labels) {
    const [x, y] = map(scene.bodies[0].xy);
    labels.push({
      text: `+ ${near.map((b) => BODIES[b.key].tag).join(' · ')}`,
      x, y, r: 4.4 * k * 1.6, size: 11 * k, key: 'earth', group: true,
    });
  }
  for (const b of order) {
    if (BODIES[b.key].near) continue;
    const [x, y] = map(b.xy);
    const r = (BODIES[b.key].kind === 'planet' && b.key !== 'earth' ? 3.6 : 4.4) * k;
    drawMarker(ctx, b.key, x, y, r, th.color[b.key], th.bg, b.st);
    if (s.labels) {
      let text = BODIES[b.key].short;
      if (b.st === 'lost') text += ' (contact lost)';
      if (b.st === 'approx') text += ' (at Earth)';
      labels.push({ text, x, y, r: r * 1.6, size: 12 * k, key: b.key, planet: BODIES[b.key].kind === 'planet' && b.key !== 'earth' });
    }
  }
  if (labels.length) {
    // Spacecraft first so they win the best spots, then Earth, then planets.
    const rank = (l) => (l.planet ? 3 : l.group ? 2 : l.key === 'earth' ? 1 : 0);
    labels.sort((a, b) => rank(a) - rank(b));
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${12 * k}px ${FONT_SANS}`;
    for (const l of placeLabels(ctx, labels, W, H, opts.avoid)) {
      const { rect } = l;
      const cx = Math.max(rect.x, Math.min(l.x, rect.x + rect.w));
      const cy = Math.max(rect.y, Math.min(l.y, rect.y + rect.h));
      if (Math.hypot(cx - l.x, cy - l.y) > l.r + 4) {
        ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(cx, cy);
        ctx.strokeStyle = th.color[l.key]; ctx.globalAlpha = 0.6; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;
      }
      ctx.font = `${l.planet || l.group ? 400 : 600} ${l.size}px ${FONT_SANS}`;
      ctx.fillStyle = th.bg;
      ctx.globalAlpha = 0.75;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.globalAlpha = 1;
      ctx.fillStyle = l.planet || l.group ? th.muted : th.color[l.key];
      ctx.fillText(l.text, rect.x + 3, rect.y + rect.h / 2 + 0.5);
    }
  }
}

// Near-Earth inset in km, Sun straight up.
export function drawInset(ctx, W, H, scene, s, th, opts = {}) {
  const k = opts.k ?? 1;
  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, W, H);
  if (!scene) return;
  const ins = scene.inset;
  const spanX = 2.0e6;
  const spanY = 2.75e6;
  const ppk = Math.min((W - 16 * k) / spanX, (H - 40 * k) / spanY);
  const ox = W / 2;
  const oy = H - 22 * k - 0.62e6 * ppk;
  const map = ([x, y]) => [ox + x * ppk, oy - y * ppk];

  ctx.font = `${10 * k}px ${FONT_MONO}`;
  ctx.textBaseline = 'middle';

  // Sun–Earth axis
  ctx.strokeStyle = th.grid; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(ox, H); ctx.lineTo(ox, 0); ctx.stroke();
  ctx.fillStyle = th.sun;
  ctx.textAlign = 'center';
  ctx.fillText('▲ to Sun', ox, 10 * k);

  // Scale bar: 500 000 km
  const sb = 5e5 * ppk;
  ctx.strokeStyle = th.muted;
  ctx.beginPath();
  ctx.moveTo(8 * k, H - 9 * k); ctx.lineTo(8 * k + sb, H - 9 * k);
  ctx.moveTo(8 * k, H - 12 * k); ctx.lineTo(8 * k, H - 6 * k);
  ctx.moveTo(8 * k + sb, H - 12 * k); ctx.lineTo(8 * k + sb, H - 6 * k);
  ctx.stroke();
  ctx.fillStyle = th.muted;
  ctx.textAlign = 'left';
  ctx.fillText('500 000 km', 12 * k + sb, H - 9 * k);

  // L1
  const [lx, ly] = map(ins.l1);
  ctx.strokeStyle = th.muted;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(lx - 5 * k, ly - 5 * k); ctx.lineTo(lx + 5 * k, ly + 5 * k);
  ctx.moveTo(lx + 5 * k, ly - 5 * k); ctx.lineTo(lx - 5 * k, ly + 5 * k);
  ctx.stroke();
  ctx.fillText('L1', lx + 8 * k, ly);

  // Moon
  if (ins.moonPath.length > 1) {
    polyline(ctx, ins.moonPath, map);
    ctx.strokeStyle = th.moon; ctx.globalAlpha = 0.35; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;
  }
  if (ins.moon) {
    const [mx, my] = map(ins.moon);
    ctx.fillStyle = th.moon; ctx.beginPath(); ctx.arc(mx, my, 3 * k, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = th.muted; ctx.textAlign = mx > ox ? 'left' : 'right';
    ctx.fillText('Moon', mx + (mx > ox ? 6 : -6) * k, my);
  }

  // L1 fleet: fading 180-day tracks, then markers and labels
  const fleet = ins.fleet.filter((f) => !s.hidden.has(f.key));
  for (const f of fleet) {
    const n = f.path.length;
    ctx.strokeStyle = th.color[f.key];
    ctx.lineWidth = 1.2 * k;
    for (let i = 1; i < n; i++) {
      const [x0, y0] = map(f.path[i - 1]);
      const [x1, y1] = map(f.path[i]);
      ctx.globalAlpha = 0.05 + 0.55 * (i / n);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  const tags = [];
  for (const f of fleet) {
    const [ax, ay] = map(f.pos);
    if (ay < -10 || ay > H + 10 || ax < -10 || ax > W + 10) continue;
    drawMarker(ctx, f.key, ax, ay, 3.4 * k, th.color[f.key], th.bg, 'ok');
    tags.push({ text: BODIES[f.key].tag, x: ax, y: ay, r: 5 * k, size: 10.5 * k, key: f.key });
  }
  ctx.font = `600 ${10.5 * k}px ${FONT_SANS}`;
  ctx.textAlign = 'left';
  const reserved = [{ x: lx - 6 * k, y: ly - 7 * k, w: 30 * k, h: 14 * k }];
  for (const l of placeLabels(ctx, tags, W, H, reserved)) {
    ctx.fillStyle = th.color[l.key];
    ctx.fillText(l.text, l.rect.x + 3, l.rect.y + l.rect.h / 2 + 0.5);
  }

  // Earth (and SDO in geosynchronous orbit, far below this scale)
  drawMarker(ctx, 'earth', ox, oy, 4 * k, th.color.earth, th.bg, 'ok');
  ctx.font = `600 ${11 * k}px ${FONT_SANS}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = th.color.earth;
  ctx.fillText('Earth', ox + 12 * k, oy + 1);
  if (ins.sdo && !s.hidden.has('sdo')) {
    ctx.fillStyle = th.color.sdo;
    ctx.font = `${10 * k}px ${FONT_SANS}`;
    ctx.fillText(W < 170 * k ? '+ SDO' : '+ SDO in GEO', ox + 12 * k, oy + 14 * k);
  }
}
