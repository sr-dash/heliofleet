// Observation footprints over SDO/AIA and HMI images: archived cutouts for
// DKIST Cryo-NIRSP runs (data/ground/context/, built by scripts/fetch_context.py)
// and live Helioviewer cutouts around any other observation.

import { tr } from './i18n.js';

export const CHANNELS = { aia171: 'AIA 171 Å', aia193: 'AIA 193 Å', hmi: 'HMI magnetogram' };
const BASE = 'data/ground/context/';
const jdOf = (iso) => Date.parse(iso) / 864e5 + 2440587.5;
const hhmm = (iso) => iso.slice(11, 16);

let sets = null;
const images = new Map();

export async function loadContext() {
  if (sets) return sets;
  const idx = await fetch(`${BASE}index.json`, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  sets = (idx?.sets ?? []).filter((s) => Object.keys(s.img).length).map((s) => ({ ...s, jd: jdOf(s.t) }));
  return sets;
}

function image(file) {
  if (!images.has(file)) {
    images.set(file, new Promise((ok) => {
      const im = new Image();
      im.onload = () => ok(im);
      im.onerror = () => ok(null);
      im.src = file.startsWith('http') ? file : BASE + file;
    }));
  }
  return images.get(file);
}

// Runs whose datasets are among `inWin`, and the one to show first
export function contextRuns(inWin, jd, hl) {
  const ids = new Set(inWin.map((d) => d.id));
  const runs = (sets ?? []).filter((s) => s.ids.some((id) => ids.has(id)));
  const pick = runs.find((s) => hl && s.ids.includes(hl))
    ?? runs.slice().sort((a, b) => Math.abs(a.jd - jd) - Math.abs(b.jd - jd))[0];
  return { runs, pick };
}

// The page accent can be dark; the images need a bright highlight
const HL = '#35e0ff';
const niceStep = (span) => [50, 100, 200, 250, 500].find((s) => span / s <= 6) ?? 1000;

// One square view of the Sun in box {x, y, s}; `view` is {x0, y0, scale, size}
function panel(ctx, box, view, im, ds, jd, hl, opts) {
  const { x: bx, y: by, s: side } = box;
  const k = side / view.size;
  const px = (x) => bx + side / 2 + (x - view.x0) / view.scale * k;
  const py = (y) => by + side / 2 - (y - view.y0) / view.scale * k;
  const f = opts.f;
  ctx.save();
  ctx.beginPath(); ctx.rect(bx, by, side, side); ctx.clip();
  ctx.fillStyle = '#000';
  ctx.fillRect(bx, by, side, side);
  if (im) ctx.drawImage(im, bx, by, side, side);
  ctx.font = `${11 * f}px "IBM Plex Mono", ui-monospace, monospace`;
  ctx.lineWidth = 1;

  if (opts.grid) {
    const half = view.size * view.scale / 2;
    const step = niceStep(2 * half);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.textBaseline = 'top';
    for (let x = Math.ceil((view.x0 - half) / step) * step; x <= view.x0 + half; x += step) {
      ctx.beginPath(); ctx.moveTo(px(x), by); ctx.lineTo(px(x), by + side); ctx.stroke();
      ctx.textAlign = 'center';
      // Keep clear of the latitude labels down the left edge
      if (px(x) > bx + 44 * f) ctx.fillText(`${x}″`, px(x), by + side - 16 * f);
    }
    ctx.textBaseline = 'middle';
    for (let y = Math.ceil((view.y0 - half) / step) * step; y <= view.y0 + half; y += step) {
      ctx.beginPath(); ctx.moveTo(bx, py(y)); ctx.lineTo(bx + side, py(y)); ctx.stroke();
      ctx.textAlign = 'left';
      if (py(y) < by + side - 24 * f) ctx.fillText(`${y}″`, bx + 4, py(y));
    }
  }

  // Limb at the radius the run records
  const rsun = opts.rsun;
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.arc(px(0), py(0), rsun / view.scale * k, 0, 2 * Math.PI); ctx.stroke();
  ctx.setLineDash([]);

  // Footprints in their instrument's colour; the highlighted one in cyan and thicker,
  // fields hidden behind the limb from Earth dashed. IRIS slit-jaw fields are drawn faintly.
  const hits = [];
  const sorted = ds.slice().sort((a, b) => (a.id === hl) - (b.id === hl));
  for (const d of sorted) {
    if (d.sx && opts.labels) {
      ctx.strokeStyle = d.color;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      ctx.beginPath();
      d.sx.forEach((x, i) => (i ? ctx.lineTo(px(x), py(d.sy[i])) : ctx.moveTo(px(x), py(d.sy[i]))));
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    const on = d.id === hl;
    ctx.strokeStyle = on ? HL : (d.color ?? '#fff');
    ctx.lineWidth = (on ? 2.6 : 1.4) * (opts.labels ? 1 : 0.8);
    ctx.setLineDash(d.hidden ? [3, 3] : []);
    ctx.beginPath();
    d.x.forEach((x, i) => (i ? ctx.lineTo(px(x), py(d.y[i])) : ctx.moveTo(px(x), py(d.y[i]))));
    ctx.stroke();
    ctx.setLineDash([]);
    hits.push({ d, pts: d.x.map((x, i) => [px(x), py(d.y[i])]) });
  }
  if (opts.labels) {
    // One label per distinct footprint position, so repeated pointings stay legible
    const seen = [];
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const lh = 13 * f;
    for (const { d, pts } of hits.slice().reverse()) {
      const top = pts.reduce((a, p) => (p[1] < a[1] ? p : a));
      const text = d.label ?? d.id;
      const w = ctx.measureText(text).width;
      const x = Math.min(bx + side - w - 2, top[0] + 3);
      // Same pointing as a labelled footprint: leave it; otherwise step down until clear
      if (seen.some((r) => Math.hypot(r.ax - top[0], r.ay - top[1]) < 4)) continue;
      let y = top[1] - 2;
      for (let n = 0; n < 6 && seen.some((r) => x < r.x + r.w && r.x < x + w && Math.abs(r.y - y) < lh); n++) y += lh;
      seen.push({ x, y, w, ax: top[0], ay: top[1] });
      ctx.fillStyle = d.id === hl ? HL : (d.color ?? '#fff');
      ctx.fillText(text, x, y);
    }
  }
  if (opts.stamp) {
    ctx.font = `${12 * f}px "IBM Plex Mono", ui-monospace, monospace`;
    const sw = ctx.measureText(opts.stamp).width;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx + 6 * f, by + 6 * f, sw + 10 * f, 20 * f);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(opts.stamp, bx + 11 * f, by + 16 * f);
  }
  if (!im) {
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tr('No image for this channel'), bx + side / 2, by + side / 2);
  }
  ctx.restore();
  return { hits, px, py };
}

// An offscreen canvas of w x h CSS pixels at the screen's density
function layer(w, h, dpr) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * dpr));
  c.height = Math.max(1, Math.round(h * dpr));
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [c, g];
}

const ease = (t) => 1 - (1 - t) ** 3;
const lerp = (a, b, t) => a + (b - a) * t;
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// What is on screen, so the next drawing knows how to arrive
const shown = { cv: null, key: null, ch: null, frame: null, anim: 0 };

function animate(ms, step) {
  const id = shown.anim;
  return new Promise((done) => {
    const t0 = performance.now();
    const tick = (now) => {
      if (id !== shown.anim) return done(false);
      const t = Math.min(1, (now - t0) / ms);
      step(ease(t));
      if (t < 1) requestAnimationFrame(tick); else done(true);
    };
    requestAnimationFrame(tick);
  });
}

// Resolves true once the canvas is on screen, false if a newer drawing starts first
function inView(cv, anim) {
  return new Promise((done) => {
    const finish = (v) => { clearInterval(poll); io.disconnect(); done(v); };
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) finish(anim === shown.anim);
    }, { threshold: 0.4 });
    const poll = setInterval(() => { if (anim !== shown.anim) finish(false); }, 400);
    io.observe(cv);
  });
}

// Full disk on the left with the footprints, and a zoomed inset at top right
// joined to the area it enlarges. A new run grows the inset out of its box on
// the disk; a new channel fades over the old one. Returns the hit areas.
export async function drawContext(cv, run, ch, ds, jd, hl, rsun) {
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth;
  const H = cv.clientHeight;
  if (W < 50 || H < 50) return [];
  const f = Math.min(1.3, Math.max(0.85, H / 560));
  const v = run.v ?? 1;
  const src = (im) => im.url ?? `${im.file}?v=${v}`;
  // The full-disk image is centred on the Sun
  const disk = { x0: 0, y0: 0, scale: 5.2, size: 512, img: {}, ...run.disk };
  const anim = ++shown.anim;
  const [imDisk, imZoom] = await Promise.all([
    disk.img[ch] ? image(src(disk.img[ch])) : null,
    run.img[ch] ? image(src(run.img[ch])) : null,
  ]);
  if (anim !== shown.anim) return null; // a newer drawing has started
  // The other channels of this run, ready for a quick switch
  for (const c of Object.keys(CHANNELS)) {
    if (disk.img[c]) image(src(disk.img[c]));
    if (run.img[c]) image(src(run.img[c]));
  }
  // Live cutouts are the image nearest the run's time, which Helioviewer does not report
  const when = (disk.img[ch] ?? run.img[ch])?.date;
  const stamp = when ? `${CHANNELS[ch]}  ${when.slice(0, 10)} ${when.slice(11, 19)} UT`
    : run.live ? `${CHANNELS[ch]}  ${tr('nearest to')} ${run.t.slice(0, 10)} ${run.t.slice(11, 16)} UT` : CHANNELS[ch];
  const zs = Math.min(0.64 * H, W - H - 24);
  const zBox = { x: W - zs, y: 0, s: zs };

  const [base, gb] = layer(W, H, dpr);
  const a = panel(gb, { x: 0, y: 0, s: H }, disk, imDisk, ds, jd, hl, { f, stamp, rsun });
  const [inset, gi] = layer(zs, zs, dpr);
  const b = panel(gi, { x: 0, y: 0, s: zs }, run, imZoom, ds, jd, hl, { f: f * 0.9, grid: true, labels: true, rsun });
  for (const h of b.hits) h.pts = h.pts.map(([x, y]) => [x + zBox.x, y]);
  const half = run.size * run.scale / 2;
  const r = [a.px(run.x0 - half), a.py(run.y0 + half), a.px(run.x0 + half), a.py(run.y0 - half)];

  // t = 0 has the inset sitting on its box on the disk, t = 1 in its place
  const compose = (g, t) => {
    g.clearRect(0, 0, W, H);
    g.drawImage(base, 0, 0, W, H);
    g.strokeStyle = HL;
    g.lineWidth = 1.2;
    g.strokeRect(r[0], r[1], r[2] - r[0], r[3] - r[1]);
    const x = lerp(r[0], zBox.x, t);
    const y = lerp(r[1], zBox.y, t);
    const s = lerp(r[2] - r[0], zs, t);
    if (t > 0) {
      g.globalAlpha = 0.7 * t;
      g.beginPath();
      g.moveTo(r[2], r[1]); g.lineTo(x, y);
      g.moveTo(r[2], r[3]); g.lineTo(x, y + s);
      g.stroke();
      g.globalAlpha = Math.min(1, 0.25 + t);
      g.drawImage(inset, x, y, s, s);
      g.globalAlpha = 1;
      g.lineWidth = 1.5;
      g.strokeRect(x + 0.75, y + 0.75, s - 1.5, s - 1.5);
    }
  };

  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const prev = shown.cv === cv && shown.frame;
  const newRun = shown.cv !== cv || shown.key !== run.key;
  const newCh = !newRun && shown.ch !== ch;
  Object.assign(shown, { cv, key: run.key, ch });
  const [frame, gf] = layer(W, H, dpr);
  compose(gf, 1);
  shown.frame = frame;
  if (still() || !(newRun || newCh)) {
    compose(ctx, 1);
  } else if (newRun) {
    compose(ctx, 0);
    // Grow the inset once the panel is in view, so the move is seen
    if (await inView(cv, anim)) await animate(520, (t) => compose(ctx, t));
  } else {
    if (prev) ctx.drawImage(prev, 0, 0, W, H);
    // Cross-fade from what was on screen to the new channel
    await animate(300, (t) => {
      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      if (prev) ctx.drawImage(prev, 0, 0, W, H);
      ctx.globalAlpha = t;
      ctx.drawImage(frame, 0, 0, W, H);
      ctx.globalAlpha = 1;
    });
  }
  // The inset lies on top, so it is searched first
  return [...a.hits, ...b.hits];
}

export function contextNote(run, ch, ds, names) {
  const img = run.img[ch];
  const parts = [];
  if (run.live) parts.push(tr('{channel} images loaded live from Helioviewer, nearest to {time} UT; their pointing is as recorded and not checked.', { channel: CHANNELS[ch], time: hhmm(run.t) }));
  else if (img) parts.push(tr('{channel} image taken at {time} UT, from Helioviewer.', { channel: CHANNELS[ch], time: hhmm(img.date) }));
  const count = {};
  for (const d of ds) count[d.i] = (count[d.i] ?? 0) + 1;
  parts.push(tr('Footprints of {n} observations within an hour of this run: {list}.', { n: ds.length, list: Object.entries(count).map(([k, n]) => `${names[k]} ${n}`).join(', ') }));
  if (ds.some((d) => d.f === 'S')) parts.push(tr('Solar Orbiter fields are carried to Earth\'s view through the solar surface, dashed where that part lies beyond Earth\'s limb.'));
  parts.push(tr('Footprints use the pointing recorded with each observation. Click one to select it.'));
  return parts.join(' ');
}

// Footprint under a point on the canvas
export function hitTest(hits, x, y) {
  const inside = (pts) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  return hits.slice().reverse().find((h) => inside(h.pts))?.d ?? null;
}
