// The sky seen from Earth or a spacecraft: instrument fields of view projected
// onto the chosen observer's plane of the sky, with ground-based coronagraphs
// and DKIST Cryo-NIRSP footprints traced from Earth the same way.

import { loadManifest, ensure, jdFromDate, dateFromJD, info } from './ephem.js';
import { buildScene, needs, helioPosition } from './scene.js';
import { readTheme, placeLabels } from './render.js';
import { BODIES } from './catalog.js';
import { INSTRUMENTS, INSTRUMENT, flyingAt, insColor, insLabel, insShort } from './instruments.js';
import { makeSky, fovGrid, fovFrame, inField, viewOf, hpcDirection, SKY_SHAPES, GROUND, SITES, sunAltitude, observingWindow } from './skyproj.js';
import { norm, angleBetween, R_SUN_AU } from './frames.js';
import { downloadPNG, downloadPDF } from './export.js';
import { LANGUAGES, detectLang, loadLang, lang, saveLang, tr, translatePage } from './i18n.js';

const $ = (id) => document.getElementById(id);
const jdOf = (iso) => Date.parse(iso) / 864e5 + 2440587.5;
const isoMinute = (jd) => dateFromJD(jd + 1 / 2880).toISOString().slice(0, 16);
const hhmm = (jd) => isoMinute(jd).slice(11);
const FONT = '"Instrument Sans", "Noto Sans Devanagari", system-ui, sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, monospace';
const DEFAULT_FOV = ['c2', 'c3', 'cor2a', 'hi1a', 'metis', 'solohi', 'wispri'];
// Observers offered in the "View from" list
const OBSERVERS = ['earth', 'solo', 'psp', 'bepi', 'sta', 'stb', 'maven'];
const MODES = {
  spectroscopy: 'Spectroscopy',
  spectropolarimetry: 'Spectropolarimetry',
  ci: 'Context imager',
  ci_pol_hei_1083: 'Context imager, He I polarimetry',
  ci_pol_fexiii_1074: 'Context imager, Fe XIII polarimetry',
};

const S = {
  jd: jdFromDate(new Date()),
  zoom: 32,
  cx: 0,
  cy: 0,
  fov: new Set(DEFAULT_FOV),
  ground: new Set(['kcor', 'ucomp', 'cryo']),
  hl: null,
  obs: 'earth',
  pt: null, // marked point on the plane of the sky, [x, y] in solar radii
};
const SCENE = { frame: 'hee', view: 'top', trailDays: 0, planets: false, labels: true, spirals: false, wind: 400, hidden: new Set(), cmes: false, fov: new Set() };
let theme;
let scene = null;
let cryo = [];
// What the last drawing showed, for the snapshot key
let drawn = { fov: [], ground: [], cryo: [], bodies: [] };
let RANGE = [jdOf('2010-01-01T00:00Z'), jdOf('2030-01-01T00:00Z')];

// ---------- URL ----------
function readURL() {
  const q = new URLSearchParams(location.search);
  const t = Date.parse((q.get('t') || '').replace(/Z?$/, 'Z'));
  if (!Number.isNaN(t)) S.jd = t / 864e5 + 2440587.5;
  const z = parseFloat(q.get('zoom'));
  if (z > 0.5 && z < 2000) S.zoom = z;
  if (q.has('fov')) { S.fov = new Set(q.get('fov').split(',').filter((k) => INSTRUMENT[k])); }
  if (q.has('ground')) S.ground = new Set(q.get('ground').split(',').filter(Boolean));
  if (q.has('hl')) S.hl = q.get('hl');
  // Bodies to leave out of the view, as on the map (hide=sta,bepi)
  if (q.has('hide')) q.get('hide').split(',').filter((k) => BODIES[k]).forEach((k) => SCENE.hidden.add(k));
  if (OBSERVERS.includes(q.get('obs'))) S.obs = q.get('obs');
  const pt = (q.get('pt') || '').split(',').map(Number);
  if (pt.length === 2 && pt.every(Number.isFinite)) S.pt = pt;
}
let urlTimer;
function writeURL() {
  clearTimeout(urlTimer);
  urlTimer = setTimeout(() => {
    const q = new URLSearchParams();
    q.set('t', `${isoMinute(S.jd)}Z`);
    if (S.zoom !== 32) q.set('zoom', S.zoom);
    q.set('fov', [...S.fov].join(','));
    if ([...S.ground].sort().join() !== 'cryo,kcor,ucomp') q.set('ground', [...S.ground].join(','));
    if (S.hl) q.set('hl', S.hl);
    if (SCENE.hidden.size) q.set('hide', [...SCENE.hidden].join(','));
    if (S.obs !== 'earth') q.set('obs', S.obs);
    if (S.pt) q.set('pt', S.pt.map((v) => v.toFixed(2)).join(','));
    const cur = new URLSearchParams(location.search);
    for (const k of ['lang', 'theme']) if (cur.has(k)) q.set(k, cur.get(k));
    history.replaceState(null, '', `?${q}`);
    // The map keeps its own layers; only the moment and language carry over
    const map = new URLSearchParams({ t: `${isoMinute(S.jd)}Z` });
    if (cur.has('lang')) map.set('lang', cur.get('lang'));
    $('map-back').href = `./?${map}`;
    $('map-link').href = `./?${map}`;
  }, 200);
}

// ---------- drawing ----------
const cv = $('sky');
function fit() {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [ctx, w, h];
}
const geom = (W, H) => {
  // Never negative, even while the canvas has no size yet
  const ppr = Math.max(1, Math.min(W, H) / 2 - 22) / S.zoom;
  return { ppr, ox: W / 2 - S.cx * ppr, oy: H / 2 + S.cy * ppr };
};

function sideSign(ins, b) {
  const p = b.p;
  const rp = Math.hypot(p[0], p[1]);
  const u = [-p[0] / rp, -p[1] / rp];
  const east = [-u[1], u[0]];
  if (ins.side === 'east') return 1;
  if (ins.side === 'ram') {
    const a = helioPosition(ins.sc, scene.jd - 1 / 24);
    const c = helioPosition(ins.sc, scene.jd + 1 / 24);
    return a && c && (c[0] - a[0]) * east[0] + (c[1] - a[1]) * east[1] < 0 ? -1 : 1;
  }
  if (ins.side === 'earth') {
    const e = scene.earth;
    return (e[0] - p[0]) * east[0] + (e[1] - p[1]) * east[1] > 0 ? 1 : -1;
  }
  return 1;
}

function cryoInWindow() {
  return cryo.filter((d) => d.j1 >= S.jd - 0.5 && d.j0 <= S.jd + 0.5);
}

// The observer actually used: the chosen one when it has a position, else Earth
function observer() {
  const b = S.obs !== 'earth' && scene?.bodies.find((x) => x.key === S.obs);
  return b ? { key: S.obs, p: b.p } : { key: 'earth', p: scene.earth };
}
const obsName = (key) => (key === 'earth' ? tr('Earth') : BODIES[key].short);

function paint() {
  const [ctx, W, H] = fit();
  // Nothing to draw into while the page is hidden or not laid out yet
  if (W < 50 || H < 50) return;
  draw(ctx, W, H);
}

// Fill and outline a projected grid of plane points; returns its label anchor
function drawMesh(ctx, map, pts, col, annulus, labelAt, [W, H]) {
  ctx.beginPath();
  for (let i = 0; i < pts.length - 1; i++) {
    for (let j = 0; j < pts[i].length - 1; j++) {
      const c = [pts[i][j], pts[i + 1][j], pts[i + 1][j + 1], pts[i][j + 1]];
      if (c.some((v) => !v)) continue;
      c.forEach((v, k) => { const [x, y] = map(v); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.closePath();
    }
  }
  ctx.fillStyle = col;
  ctx.globalAlpha = 0.1;
  ctx.fill('nonzero');
  ctx.globalAlpha = 0.75;
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.3;
  const edge = (list) => {
    let open = false;
    let prev = null;
    ctx.beginPath();
    for (const v of list) {
      if (!v || (prev && Math.hypot(v[0] - prev[0], v[1] - prev[1]) > S.zoom * 1.5)) { open = false; prev = v; continue; }
      const [x, y] = map(v);
      if (open) ctx.lineTo(x, y); else { ctx.moveTo(x, y); open = true; }
      prev = v;
    }
    ctx.stroke();
  };
  const n = pts.length - 1;
  const m = pts[0].length - 1;
  edge(pts[0]);
  edge(pts[n]);
  if (!annulus) { edge(pts.map((r) => r[0])); edge(pts.map((r) => r[m])); }
  ctx.globalAlpha = 1;
  if (annulus) return pts[n][Math.round(m * labelAt)];
  // The visible point nearest the middle of the field, so a field whose
  // centre is off-screen still gets a label
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      const v = pts[i][j];
      if (!v) continue;
      const [x, y] = map(v);
      if (x < 12 || x > W - 12 || y < 24 || y > H - 24) continue;
      const d = (i - n / 2) ** 2 + (j - m / 2) ** 2;
      if (d < bestD) { bestD = d; best = v; }
    }
  }
  return best;
}

function draw(ctx, W, H) {
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);
  if (!scene) return;
  const { ppr, ox, oy } = geom(W, H);
  const map = ([x, y]) => [ox + x * ppr, oy - y * ppr];
  const obs = observer();
  const sky = makeSky(obs.p);
  const earth = scene.earth;
  const labels = [];
  // Text grows with the canvas so labels stay readable on large screens and in snapshots
  const tk = Math.min(1.45, Math.max(1, Math.min(W, H) / 560));
  drawn = { fov: [], ground: [], cryo: [], bodies: [] };

  // Radial grid in solar radii, and the compass of a solar image
  ctx.strokeStyle = theme.grid;
  ctx.fillStyle = theme.muted;
  ctx.lineWidth = 1;
  ctx.font = `${10.5 * tk}px ${MONO}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  let lastLabel = -Infinity;
  for (const r of [1.5, 2, 3, 5, 10, 20, 30, 50, 100, 150, 215]) {
    if (r > S.zoom * 1.45 || r < S.zoom * 0.12) continue;
    ctx.beginPath(); ctx.arc(ox, oy, r * ppr, 0, 2 * Math.PI); ctx.stroke();
    // Label a ring only when it is clear of the last labelled one
    if (r * ppr - lastLabel < 24) continue;
    ctx.fillText(r === 215 ? '1 au' : `${r} R☉`, ox + r * ppr * 0.71 + 4, oy - r * ppr * 0.71);
    lastLabel = r * ppr;
  }
  ctx.font = `600 ${12 * tk}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = theme.muted;
  ctx.fillText(tr('N'), W / 2, 14);
  ctx.fillText(tr('S'), W / 2, H - 12);
  ctx.textAlign = 'left';
  ctx.fillText(tr('E'), 10, H / 2);
  ctx.textAlign = 'right';
  ctx.fillText(tr('W'), W - 10, H / 2);

  // Projected fields of view, traced from each instrument's spacecraft
  const far = S.zoom * 25;
  const trace = (P, grid) => grid.map((row) => row.map((d) => {
    const q = d && sky.hit(P, d);
    return q && Math.abs(q[0]) < far && Math.abs(q[1]) < far ? q : null;
  }));
  for (const id of S.fov) {
    const ins = INSTRUMENT[id];
    const b = scene.bodies.find((x) => x.key === ins.sc);
    if (!b || b.st === 'lost' || !flyingAt(ins, scene.jd)) continue;
    const pts = trace(b.p, fovGrid(ins, SKY_SHAPES[id], b.p, sideSign(ins, b), b.dist));
    const col = theme.color[insColor(ins)];
    const at = drawMesh(ctx, map, pts, col, SKY_SHAPES[id].type === 'annulus', 0.13, [W, H]);
    drawn.fov.push({ ins, b, col, shown: pts.some((r) => r.some(Boolean)) });
    if (at) { const [x, y] = map(at); labels.push({ text: insLabel(ins, BODIES[ins.sc].short), x, y, r: 2, size: 11 * tk, color: col }); }
  }

  // Ground-based coronagraphs (MLSO), traced from Earth
  for (const g of GROUND) {
    if (!S.ground.has(g.id)) continue;
    const grid = fovGrid({ unit: 'rs', inner: g.inner, outer: g.outer }, { type: 'annulus' }, earth, 1, norm(earth));
    const gp = trace(earth, grid);
    const at = drawMesh(ctx, map, gp, theme.color.earth, true, 0.375, [W, H]);
    drawn.ground.push({ g, shown: gp.some((r) => r.some(Boolean)) });
    if (at) { const [x, y] = map(at); labels.push({ text: g.name, x, y, r: 2, size: 11 * tk, color: theme.color.earth }); }
  }

  // Sun, at the size this observer sees it
  ctx.beginPath();
  ctx.arc(ox, oy, Math.max(ppr * sky.limb, 3), 0, 2 * Math.PI);
  ctx.fillStyle = theme.sunStyle === 'eclipse' ? theme.bg : theme.sun;
  ctx.fill();
  ctx.strokeStyle = theme.sun;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // DKIST Cryo-NIRSP footprints within half a day of the moment, traced from Earth
  if (S.ground.has('cryo')) {
    for (const d of cryoInWindow()) {
      const poly = d.x.map((x, i) => sky.hit(earth, hpcDirection(earth, x, d.y[i])));
      if (poly.some((v) => !v || Math.abs(v[0]) > far || Math.abs(v[1]) > far)) continue;
      const active = S.jd >= d.j0 && S.jd <= d.j1;
      const hl = S.hl === d.id;
      drawn.cryo.push({ d, active });
      ctx.beginPath();
      poly.forEach((v, i) => { const [px, py] = map(v); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
      ctx.closePath();
      ctx.fillStyle = theme.accent;
      ctx.globalAlpha = active || hl ? 0.45 : 0.15;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = hl ? 2.2 : 1.2;
      ctx.stroke();
      if (active || hl) {
        const [px, py] = map(poly[0]);
        // Datasets taken together on the same spot share one label
        const near = labels.find((l) => l.cryo && Math.hypot(l.x - px, l.y - py) < 12);
        if (near) near.text += `, ${d.id}`;
        else labels.push({ text: `Cryo-NIRSP ${d.id}`, x: px, y: py, r: 3, size: 11 * tk, color: theme.accent, cryo: true });
      }
    }
  }

  // Marked point
  if (S.pt) {
    const [px, py] = map(S.pt);
    ctx.strokeStyle = theme.bg;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(px - 8, py); ctx.lineTo(px + 8, py); ctx.moveTo(px, py - 8); ctx.lineTo(px, py + 8); ctx.stroke();
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px - 8, py); ctx.lineTo(px + 8, py); ctx.moveTo(px, py - 8); ctx.lineTo(px, py + 8); ctx.stroke();
  }

  // Earth and the spacecraft, where the observer sees them
  const O = obs.p;
  for (const b of scene.bodies) {
    const meta = BODIES[b.key];
    if (b.key === obs.key || SCENE.hidden.has(b.key) || (b.key !== 'earth' && (meta.kind !== 'sc' || meta.near))) continue;
    if (obs.key === 'earth' && b.key === 'earth') continue;
    const q = sky.seen(b.p);
    const behind = !q;
    // Bodies behind the observer get an edge marker in their direction
    const rel = [b.p[0] - O[0], b.p[1] - O[1], b.p[2] - O[2]];
    let [x, y] = q ? map(q) : [ox + (rel[0] * sky.ax.west[0] + rel[1] * sky.ax.west[1] + rel[2] * sky.ax.west[2]) * 1e6,
      oy - (rel[0] * sky.ax.north[0] + rel[1] * sky.ax.north[1] + rel[2] * sky.ax.north[2]) * 1e6];
    const inside = !behind && x > 8 && x < W - 8 && y > 8 && y < H - 8;
    const col = theme.color[b.key];
    if (!inside) {
      // Clamp to the edge along the line from the centre
      const dx = x - ox;
      const dy = y - oy;
      const s = Math.min((W / 2 - 14) / Math.abs(dx || 1e-9), (H / 2 - 14) / Math.abs(dy || 1e-9));
      x = ox + dx * s;
      y = oy + dy * s;
    }
    const name = b.key === 'earth' ? tr('Earth') : meta.short;
    ctx.fillStyle = col;
    ctx.globalAlpha = b.st === 'lost' ? 0.5 : 1;
    ctx.beginPath();
    if (b.key === 'earth') ctx.arc(x, y, 5, 0, 2 * Math.PI);
    else { ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y); ctx.closePath(); }
    ctx.fill();
    ctx.globalAlpha = 1;
    const text = behind ? tr('{name} (behind)', { name }) : inside ? name : `${name} →`;
    drawn.bodies.push({ b, name, col, where: behind ? 'behind' : inside ? 'in' : 'edge' });
    labels.push({ text, x, y, r: 7, size: 12 * tk, color: col, bold: true });
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${12 * tk}px ${FONT}`;
  for (const l of placeLabels(ctx, labels, W, H)) {
    ctx.font = `${l.bold ? 600 : 500} ${l.size}px ${FONT}`;
    ctx.fillStyle = theme.bg;
    ctx.globalAlpha = 0.75;
    ctx.fillRect(l.rect.x, l.rect.y, l.rect.w, l.rect.h);
    ctx.globalAlpha = 1;
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, l.rect.x + 3, l.rect.y + l.rect.h / 2 + 0.5);
  }
  $('sky-hud').textContent = hudText(obs);
}

function hudText(obs) {
  return `${tr('Plane of the sky seen from {name}', { name: obsName(obs.key) })} · ${(norm(obs.p)).toFixed(3)} au\n${tr('solar north up, west to the right')}`;
}

function viewTitle(key) {
  return key === 'earth' ? tr("Earth's view") : tr('View from {name}', { name: obsName(key) });
}

// ---------- snapshot ----------
const fmt = (v, d = 1) => String(Number(v.toFixed(d)));
// Coronagraphs by field shape; the rest are heliospheric imagers
const kindOf = (id) => (SKY_SHAPES[id].type === 'annulus' ? tr('coronagraph') : tr('heliospheric imager'));

function wrap(ctx, text, x, y, width, lh, dry) {
  let line = '';
  for (const word of text.split(' ')) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > width && line) {
      if (!dry) ctx.fillText(line, x, y);
      line = word;
      y += lh;
    } else line = test;
  }
  if (line) { if (!dry) ctx.fillText(line, x, y); y += lh; }
  return y;
}

// The key beside the snapshot: one entry per layer, saying what it is and
// where it is seen from. With dry set it only measures; returns the end y.
function snapshotKey(ctx, x, y, w, obs, dry) {
  const ob = scene.bodies.find((b) => b.key === obs.key);
  const head = (t) => {
    y += 10;
    ctx.font = `700 13px ${FONT}`;
    ctx.fillStyle = theme.ink;
    if (!dry) ctx.fillText(t.toUpperCase(), x, y);
    y += 8;
    if (!dry) { ctx.fillStyle = theme.line; ctx.fillRect(x, y - 2, w, 1); }
    y += 12;
  };
  const entry = (col, shape, title, detail) => {
    if (!dry && col) {
      ctx.fillStyle = col;
      ctx.strokeStyle = col;
      if (shape === 'field') {
        ctx.globalAlpha = 0.25; ctx.fillRect(x, y - 10, 16, 12); ctx.globalAlpha = 1;
        ctx.lineWidth = 1.3; ctx.strokeRect(x + 0.5, y - 9.5, 15, 11);
      } else if (shape === 'ring') {
        ctx.globalAlpha = 0.25; ctx.fillRect(x, y - 10, 16, 12); ctx.globalAlpha = 1;
        ctx.setLineDash([3, 2]); ctx.lineWidth = 1.3; ctx.strokeRect(x + 0.5, y - 9.5, 15, 11); ctx.setLineDash([]);
      } else if (shape === 'earth') {
        ctx.beginPath(); ctx.arc(x + 8, y - 4, 5, 0, 2 * Math.PI); ctx.fill();
      } else {
        ctx.beginPath(); ctx.moveTo(x + 8, y - 9); ctx.lineTo(x + 13, y - 4); ctx.lineTo(x + 8, y + 1); ctx.lineTo(x + 3, y - 4); ctx.closePath(); ctx.fill();
      }
    }
    const tx = col ? x + 24 : x;
    ctx.font = `600 12.5px ${FONT}`;
    ctx.fillStyle = col ?? theme.ink;
    y = wrap(ctx, title, tx, y, w - (tx - x), 16, dry);
    ctx.font = `400 11.5px ${FONT}`;
    ctx.fillStyle = theme.muted;
    y = wrap(ctx, detail, tx, y, w - (tx - x), 14.5, dry) + 5;
  };

  head(tr('Observer'));
  entry(null, null, obsName(obs.key), [
    tr('{d} au from the Sun', { d: fmt(norm(obs.p), 3) }),
    ob && obs.key !== 'earth' ? tr('Stonyhurst longitude {lon}°, latitude {lat}°', { lon: fmt(ob.lon), lat: fmt(ob.lat) }) : '',
    obs.key !== 'earth' ? tr('{a}° from Earth, seen from the Sun', { a: fmt(angleBetween(obs.p, scene.earth)) }) : '',
    tr('Solar north up, west to the right. The disc is the Sun as this observer sees it.'),
  ].filter(Boolean).join(' · '));

  if (drawn.fov.length) {
    head(tr('Fields of view'));
    for (const f of drawn.fov) {
      const range = f.ins.unit === 'rs' ? `${fmt(f.ins.inner, 2)}–${fmt(f.ins.outer, 2)} R☉` : `${fmt(f.ins.inner)}–${fmt(f.ins.outer)}° ${tr('elongation')}`;
      const own = f.ins.sc === obs.key;
      const where = own ? tr('on the observer itself, so it is centred on the Sun')
        : tr('seen from {sc}, {a}° from the observer around the Sun', { sc: BODIES[f.ins.sc].short, a: fmt(angleBetween(f.b.p, obs.p)) });
      entry(f.col, 'field', insLabel(f.ins, BODIES[f.ins.sc].short),
        `${kindOf(f.ins.id)} · ${range} · ${where}${f.shown ? '' : ` · ${tr('outside this view')}`}`);
    }
  }
  if (drawn.ground.length || drawn.cryo.length) {
    head(tr('Ground'));
    for (const { g, shown } of drawn.ground) {
      entry(theme.color.earth, 'ring', g.name, `${tr('coronagraph')} · ${fmt(g.inner, 2)}–${fmt(g.outer, 2)} R☉ · ${tr('traced from Earth')}${shown ? '' : ` · ${tr('outside this view')}`}`);
    }
    const list = drawn.cryo.slice(0, 6);
    for (const { d, active } of list) {
      entry(theme.accent, 'field', `DKIST Cryo-NIRSP · ${d.wave}`,
        `${tr(MODES[d.mode] ?? d.mode)} · ${hhmm(d.j0)}–${hhmm(d.j1)} UT · ${d.pid} · ${d.id}${active ? ` · ${tr('observing at this moment')}` : ''}`);
    }
    if (drawn.cryo.length > list.length) entry(null, null, '', tr('and {n} more Cryo-NIRSP datasets within 12 hours', { n: drawn.cryo.length - list.length }));
  }

  if (drawn.bodies.length) {
    head(tr('Bodies'));
    for (const { b, name, col, where } of drawn.bodies) {
      const state = where === 'behind' ? tr('behind the observer; the marker shows its direction')
        : where === 'edge' ? tr('outside the view; the arrow points toward it') : tr('where the observer sees it');
      entry(col, b.key === 'earth' ? 'earth' : 'sc', name, `${tr('{d} au from the Sun', { d: fmt(norm(b.p), 3) })} · ${state}`);
    }
  }

  const rp = pointReport();
  if (rp) {
    head(tr('Marked point'));
    const seen = rp.rows.filter((x) => x.status === 'in');
    entry(theme.accent, 'sc', tr('{r} R☉ from Sun centre', { r: rp.r.toFixed(2) }),
      seen.length ? tr('In the field of {list}', { list: seen.map((x) => `${x.name} (PA ${x.v.pa.toFixed(0)}°)`).join(', ') }) : tr('In no field of view'));
  }

  head(tr('How to read it'));
  ctx.font = `400 11.5px ${FONT}`;
  ctx.fillStyle = theme.muted;
  y = wrap(ctx, tr('Each field is filled where the instrument looks and outlined at its edges, in the colour of its spacecraft. Lines of sight are followed to where they cross the plane through Sun centre perpendicular to the line from the Sun to the observer, so fields from spacecraft far from the observer are stretched. Heliospheric imager outlines are approximate; see the README for sources.'), x, y, w, 14.5, dry);
  return y;
}

async function snapshot() {
  await document.fonts.ready;
  const SIZE = 1000;
  const TOP = 74;
  const PAD = 20;
  const KEY = 400;
  const obs = observer();
  const W = SIZE + KEY + 3 * PAD;
  const cv2 = document.createElement('canvas');
  const probe = cv2.getContext('2d');
  probe.textBaseline = 'alphabetic';
  paint(); // refresh what was drawn before measuring the key
  const keyEnd = snapshotKey(probe, 0, TOP, KEY, obs, true);
  const HT = Math.max(TOP + SIZE, keyEnd) + 54;
  cv2.width = W * 2;
  cv2.height = HT * 2;
  const ctx = cv2.getContext('2d');
  ctx.scale(2, 2);
  ctx.fillStyle = theme.page;
  ctx.fillRect(0, 0, W, HT);
  ctx.fillStyle = theme.ink;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = `700 26px "Big Shoulders Display", ${FONT}`;
  ctx.fillText(`HelioFleet · ${viewTitle(obs.key)}`, PAD, 38);
  ctx.font = `500 14px ${MONO}`;
  ctx.fillStyle = theme.muted;
  ctx.fillText(`${isoMinute(S.jd).replace('T', ' ')} UTC · ${hudText(obs).replace('\n', ' · ')}`, PAD, 60, W - 2 * PAD);
  ctx.save();
  ctx.translate(PAD, TOP);
  ctx.beginPath();
  ctx.roundRect(0, 0, SIZE, SIZE, 12);
  ctx.clip();
  draw(ctx, SIZE, SIZE);
  ctx.restore();
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(PAD + 0.5, TOP + 0.5, SIZE - 1, SIZE - 1, 12);
  ctx.stroke();
  snapshotKey(ctx, SIZE + 2 * PAD, TOP - 10, KEY, obs, false);
  ctx.fillStyle = theme.muted;
  ctx.font = `400 12px ${FONT}`;
  ctx.fillText(`${tr('Positions from JPL Horizons. Fields of view from the instrument papers.')}  sr-dash.github.io/heliofleet/sky.html`, PAD, HT - 22, W - 2 * PAD);
  paint(); // the HUD follows the on-screen view again
  return cv2;
}

async function saveSnapshot(kind) {
  try {
    const cv2 = await snapshot();
    const base = `heliofleet-sky-${observer().key}-${isoMinute(S.jd).replace(/[-:]/g, '').replace('T', '-')}`;
    if (kind === 'png') await downloadPNG(cv2, base);
    else await downloadPDF(cv2, base, `HelioFleet · ${viewTitle(observer().key)} · ${isoMinute(S.jd)} UTC`);
  } catch (err) {
    toast(err.message);
  }
}

// ---------- who sees this point ----------
// Every instrument whose field contains the marked point, taken on the
// observer's plane of the sky, with where it appears in that instrument's view.
function pointReport() {
  if (!scene || !S.pt) return null;
  const obs = observer();
  const sky = makeSky(obs.p);
  const X = [0, 1, 2].map((i) => (S.pt[0] * sky.ax.west[i] + S.pt[1] * sky.ax.north[i]) * R_SUN_AU);
  const rows = [];
  const place = (P, X) => {
    const v = viewOf(P, X);
    // Distance from Sun centre in that observer's sky, in solar radii at the Sun
    return { ...v, rs: (norm(P) * Math.tan(v.elong * Math.PI / 180)) / R_SUN_AU };
  };
  for (const ins of INSTRUMENTS) {
    const b = scene.bodies.find((x) => x.key === ins.sc);
    if (!b || b.st === 'lost' || b.st === 'approx' || !flyingAt(ins, scene.jd)) continue;
    const v = place(b.p, X);
    const f = fovFrame(ins, SKY_SHAPES[ins.id], b.p, sideSign(ins, b), b.dist);
    const status = v.hidden ? 'hidden' : inField(f, v.d) ? 'in' : 'out';
    rows.push({ name: insLabel(ins, BODIES[ins.sc].short), color: insColor(ins), status, v, range: ins.unit === 'rs' ? `${ins.inner}–${ins.outer} R☉` : `${ins.inner}–${ins.outer}°` });
  }
  const earth = scene.earth;
  const ve = place(earth, X);
  for (const g of GROUND) {
    const status = ve.hidden ? 'hidden' : ve.rs >= g.inner && ve.rs <= g.outer ? 'in' : 'out';
    rows.push({ name: g.name, color: 'earth', status, v: ve, range: `${g.inner}–${g.outer} R☉` });
  }
  // Cryo-NIRSP footprints observing at this moment, in helioprojective arcsec
  const ea = makeSky(earth).ax;
  const tx = (Math.atan2(ve.d[0] * ea.west[0] + ve.d[1] * ea.west[1] + ve.d[2] * ea.west[2], -(ve.d[0] * ea.e[0] + ve.d[1] * ea.e[1] + ve.d[2] * ea.e[2])) * 180 / Math.PI) * 3600;
  const ty = (Math.asin(ve.d[0] * ea.north[0] + ve.d[1] * ea.north[1] + ve.d[2] * ea.north[2]) * 180 / Math.PI) * 3600;
  const inPoly = (xs, ys) => {
    let inside = false;
    for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
      if ((ys[i] > ty) !== (ys[j] > ty) && tx < ((xs[j] - xs[i]) * (ty - ys[i])) / (ys[j] - ys[i]) + xs[i]) inside = !inside;
    }
    return inside;
  };
  for (const d of cryo.filter((c) => S.jd >= c.j0 && S.jd <= c.j1)) {
    rows.push({ name: `DKIST Cryo-NIRSP ${d.id}`, color: null, status: ve.hidden ? 'hidden' : inPoly(d.x, d.y) ? 'in' : 'out', v: ve, footprint: true });
  }
  return { rows, r: Math.hypot(S.pt[0], S.pt[1]), tx, ty };
}

function renderPoint() {
  const box = $('pt-list');
  const rep = pointReport();
  $('pt-clear').hidden = !S.pt;
  if (!rep) {
    $('pt-summary').textContent = tr('Click the plane of the sky to mark a point; every instrument whose field contains it is listed here.');
    box.replaceChildren();
    return;
  }
  const seen = rep.rows.filter((x) => x.status === 'in');
  $('pt-summary').textContent = tr('Point at {r} R☉ from Sun centre on this plane of the sky ({n} of {m} instruments see it).', { r: rep.r.toFixed(2), n: seen.length, m: rep.rows.length });
  const order = { in: 0, out: 1, hidden: 2 };
  const fmtRow = (x) => {
    const where = `${x.v.rs.toFixed(2)} R☉ · ${x.v.elong.toFixed(2)}° · PA ${x.v.pa.toFixed(0)}°`;
    const state = x.status === 'in' ? tr('in its field') : x.status === 'hidden' ? tr('behind the Sun as seen from it') : x.footprint ? tr('outside its footprint') : tr('outside its field ({range})', { range: x.range });
    return `<li class="pt-${x.status}"><span class="pt-sw" style="--c: ${x.color ? `var(--c-${x.color})` : 'var(--accent)'}"></span><b>${x.name}</b><span>${state}${x.status === 'hidden' ? '' : ` · ${where}`}</span></li>`;
  };
  box.innerHTML = rep.rows.sort((a, b) => order[a.status] - order[b.status]).map(fmtRow).join('');
}

// ---------- panels ----------
function buildLayers() {
  const box = $('sky-layers');
  const groups = [...new Set(INSTRUMENTS.map((i) => i.sc))];
  for (const sc of groups) {
    const row = document.createElement('div');
    row.className = 'fov-group';
    row.style.setProperty('--c', `var(--c-${sc})`);
    row.innerHTML = `<span class="fov-sc">${sc === 'earth' ? tr('Earth orbit') : BODIES[sc].short}</span>${INSTRUMENTS.filter((i) => i.sc === sc).map((i) => `<label><input type="checkbox" data-kind="fov" value="${i.id}"${S.fov.has(i.id) ? ' checked' : ''}>${insShort(i)}</label>`).join('')}`;
    box.appendChild(row);
  }
  const row = document.createElement('div');
  row.className = 'fov-group';
  row.style.setProperty('--c', 'var(--c-earth)');
  row.innerHTML = `<span class="fov-sc">${tr('Ground')}</span>${[...GROUND.map((g) => [g.id, g.name]), ['cryo', 'DKIST Cryo-NIRSP']].map(([id, name]) => `<label><input type="checkbox" data-kind="ground" value="${id}"${S.ground.has(id) ? ' checked' : ''}>${name}</label>`).join('')}`;
  box.appendChild(row);
  box.addEventListener('change', (e) => {
    const set = e.target.dataset.kind === 'fov' ? S.fov : S.ground;
    if (e.target.checked) set.add(e.target.value); else set.delete(e.target.value);
    writeURL();
    paint();
    renderCryo();
  });
}

function renderSites() {
  const out = [];
  for (const site of SITES) {
    const alt = sunAltitude(S.jd, site.lat, site.lon);
    const w = observingWindow(S.jd, site);
    const hst = (jd) => isoMinute(jd - 10 / 24).slice(11);
    const state = alt >= 10 ? `<span class="up">${tr('Sun {alt}° above the horizon', { alt: alt.toFixed(0) })}</span>`
      : alt > 0 ? `<span>${tr('Sun low, {alt}° up', { alt: alt.toFixed(0) })}</span>` : `<span>${tr('Night: Sun below the horizon')}</span>`;
    const win = w ? `<span>${tr(w.now ? 'Daylight window {a}–{b} UT ({ha}–{hb} HST)' : 'Next daylight window {a}–{b} UT ({ha}–{hb} HST)', { a: hhmm(w.start), b: hhmm(w.end), ha: hst(w.start), hb: hst(w.end) })}</span>` : '';
    out.push(`<div class="site-row"><b>${site.name}</b>${state}${win}</div>`);
  }
  $('sites').innerHTML = out.join('') + `<p class="tool-help">${tr('Daylight here means the Sun at least 10° above the horizon. Weather and schedules decide what is actually observed.')}</p>`;
}

function renderCryo() {
  const list = $('cryo-list');
  list.replaceChildren();
  const inWin = cryoInWindow();
  $('cryo-summary').textContent = !cryo.length ? tr('The Cryo-NIRSP list could not be loaded.')
    : inWin.length ? tr('{n} datasets within 12 hours of this moment. Click one to jump to it.', { n: inWin.length })
      : tr('No Cryo-NIRSP datasets within 12 hours. Use the buttons to find the nearest observations.');
  for (const d of inWin) {
    const b = document.createElement('div');
    b.className = `chip${S.jd >= d.j0 && S.jd <= d.j1 ? ' cryo-active' : ''}`;
    b.innerHTML = `<svg class="chip-glyph" viewBox="0 0 20 20"><rect x="5" y="6" width="10" height="8" fill="none" stroke="var(--accent)" stroke-width="2"/></svg>
      <span class="chip-name">${d.wave} · ${tr(MODES[d.mode] ?? d.mode)}<small>${hhmm(d.j0)}–${hhmm(d.j1)} UT · ${d.pid} · ${d.id}</small>
        <span class="chip-links"><a href="https://sr-dash.github.io/cryonirsp-viewer/?dataset=${d.id}" target="_blank" rel="noopener">${tr('Open in the Cryo-NIRSP viewer')} ↗</a></span></span>
      <span class="chip-date">${isoMinute(d.j0).slice(0, 10)}</span>`;
    b.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      S.hl = d.id;
      S.jd = (d.j0 + d.j1) / 2;
      if (S.zoom > 4) { S.zoom = 1.6; S.cx = 0; S.cy = 0; }
      update();
    });
    list.appendChild(b);
  }
  $('cryo-prev').disabled = !cryo.some((d) => d.j1 < S.jd - 0.5);
  $('cryo-next').disabled = !cryo.some((d) => d.j0 > S.jd + 0.5);
}

function renderObservers() {
  const sel = $('obs');
  sel.replaceChildren(...OBSERVERS.map((k) => {
    const o = document.createElement('option');
    o.value = k;
    o.textContent = obsName(k);
    o.disabled = k !== 'earth' && !scene?.bodies.some((b) => b.key === k);
    return o;
  }));
  sel.value = S.obs;
  const eff = scene ? observer().key : 'earth';
  $('sky-title').textContent = viewTitle(eff);
  $('obs-note').hidden = eff === S.obs;
  $('obs-note').textContent = eff === S.obs ? '' : tr('{name} has no position on this date, so the view is from Earth.', { name: obsName(S.obs) });
}

function renderClock() {
  const iso = isoMinute(S.jd);
  $('clock-date').textContent = iso.slice(0, 10);
  $('clock-time').textContent = `${iso.slice(11)} UTC`;
  $('dt').value = iso;
  document.querySelectorAll('.seg[data-setting="zoom"] button').forEach((b) => {
    b.setAttribute('aria-pressed', Math.abs(parseFloat(b.dataset.value) - S.zoom) < 1e-6 && !S.cx && !S.cy ? 'true' : 'false');
  });
}

async function update() {
  S.jd = Math.min(RANGE[1], Math.max(RANGE[0], S.jd));
  renderClock();
  writeURL();
  await Promise.all(needs(S.jd, SCENE).map(([k, a, b]) => ensure([k], a, b)));
  scene = buildScene(S.jd, SCENE);
  $('loading').hidden = !!scene;
  paint();
  renderObservers();
  renderSites();
  renderCryo();
  renderPoint();
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
}

function buildLangSwitch() {
  const box = $('lang-switch');
  for (const [code, name] of Object.entries(LANGUAGES)) {
    const b = document.createElement('button');
    b.textContent = name;
    b.lang = code;
    b.setAttribute('aria-pressed', code === lang() ? 'true' : 'false');
    b.addEventListener('click', () => {
      if (code === lang()) return;
      saveLang(code);
      const q = new URLSearchParams(location.search);
      if (code === 'en') q.delete('lang'); else q.set('lang', code);
      q.set('t', `${isoMinute(S.jd)}Z`);
      location.search = `?${q}`;
    });
    box.appendChild(b);
  }
}

function initGestures() {
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = cv.getBoundingClientRect();
    const { ppr, ox, oy } = geom(cv.clientWidth, cv.clientHeight);
    const ax = (e.clientX - r.left - ox) / ppr;
    const ay = -(e.clientY - r.top - oy) / ppr;
    const nz = Math.min(2000, Math.max(0.6, S.zoom * Math.exp(e.deltaY * 0.0015)));
    const k = nz / S.zoom;
    S.cx = ax - (ax - S.cx) * k;
    S.cy = ay - (ay - S.cy) * k;
    S.zoom = nz;
    renderClock();
    writeURL();
    paint();
  }, { passive: false });
  let drag = null;
  let down = null;
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); drag = [e.clientX, e.clientY]; down = [e.clientX, e.clientY]; });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const { ppr } = geom(cv.clientWidth, cv.clientHeight);
    S.cx -= (e.clientX - drag[0]) / ppr;
    S.cy += (e.clientY - drag[1]) / ppr;
    drag = [e.clientX, e.clientY];
    renderClock();
    paint();
  });
  // A press that barely moves is a click: it marks the point under it
  const up = (e) => {
    if (drag && down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 4) {
      const r = cv.getBoundingClientRect();
      const { ppr, ox, oy } = geom(cv.clientWidth, cv.clientHeight);
      S.pt = [(e.clientX - r.left - ox) / ppr, -(e.clientY - r.top - oy) / ppr];
      paint();
      renderPoint();
    }
    if (drag) writeURL();
    drag = null;
    down = null;
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('dblclick', () => { S.cx = 0; S.cy = 0; renderClock(); writeURL(); paint(); });
}

async function main() {
  await loadLang(detectLang());
  translatePage();
  buildLangSwitch();
  readURL();
  theme = readTheme();
  const [manifest, ground] = await Promise.all([
    loadManifest(),
    fetch('data/ground/cryonirsp.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  RANGE = manifest.timeline ? [manifest.timeline.start, manifest.timeline.end] : [info('earth').start, info('earth').end];
  cryo = (ground?.datasets ?? []).map((d) => ({ ...d, j0: jdOf(d.t0), j1: jdOf(d.t1) }));
  buildLayers();
  initGestures();
  $('dt').addEventListener('change', (e) => {
    const t = Date.parse(`${e.target.value}Z`);
    if (!Number.isNaN(t)) { S.jd = t / 864e5 + 2440587.5; update(); }
  });
  document.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => { S.jd += parseFloat(b.dataset.step); update(); }));
  $('now').addEventListener('click', () => { S.jd = jdFromDate(new Date()); update(); });
  document.querySelector('.seg[data-setting="zoom"]').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    S.zoom = parseFloat(b.dataset.value);
    S.cx = 0;
    S.cy = 0;
    renderClock();
    writeURL();
    paint();
  });
  $('cryo-prev').addEventListener('click', () => {
    const d = [...cryo].reverse().find((x) => x.j1 < S.jd - 0.5);
    if (d) { S.jd = (d.j0 + d.j1) / 2; S.hl = d.id; update(); toast(tr('Jumped to {date}', { date: isoMinute(d.j0).replace('T', ' ') })); }
  });
  $('cryo-next').addEventListener('click', () => {
    const d = cryo.find((x) => x.j0 > S.jd + 0.5);
    if (d) { S.jd = (d.j0 + d.j1) / 2; S.hl = d.id; update(); toast(tr('Jumped to {date}', { date: isoMinute(d.j0).replace('T', ' ') })); }
  });
  $('pt-clear').addEventListener('click', () => { S.pt = null; writeURL(); paint(); renderPoint(); });
  $('obs').addEventListener('change', (e) => { S.obs = e.target.value; S.cx = 0; S.cy = 0; update(); });
  $('dl-png').addEventListener('click', () => saveSnapshot('png'));
  $('dl-pdf').addEventListener('click', () => saveSnapshot('pdf'));
  new ResizeObserver(() => paint()).observe($('sky-wrap'));
  await update();
}

main();
