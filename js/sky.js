// Earth's view: instrument fields of view projected onto Earth's plane of the
// sky, with ground-based coronagraphs and DKIST Cryo-NIRSP footprints.

import { loadManifest, ensure, jdFromDate, dateFromJD, info } from './ephem.js';
import { buildScene, needs, helioPosition } from './scene.js';
import { readTheme, placeLabels } from './render.js';
import { BODIES } from './catalog.js';
import { INSTRUMENTS, INSTRUMENT } from './instruments.js';
import { makeSky, fovGrid, SKY_SHAPES, GROUND, SITES, sunAltitude, observingWindow } from './skyproj.js';
import { LANGUAGES, detectLang, loadLang, lang, saveLang, tr, translatePage } from './i18n.js';

const $ = (id) => document.getElementById(id);
const jdOf = (iso) => Date.parse(iso) / 864e5 + 2440587.5;
const isoMinute = (jd) => dateFromJD(jd + 1 / 2880).toISOString().slice(0, 16);
const hhmm = (jd) => isoMinute(jd).slice(11);
const FONT = '"Instrument Sans", "Noto Sans Devanagari", system-ui, sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, monospace';
const DEFAULT_FOV = ['c2', 'c3', 'cor2a', 'hi1a', 'metis', 'solohi', 'wispri'];
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
};
const SCENE = { frame: 'hee', view: 'top', trailDays: 0, planets: false, labels: true, spirals: false, wind: 400, hidden: new Set(), cmes: false, fov: new Set() };
let theme;
let scene = null;
let cryo = [];
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
    const cur = new URLSearchParams(location.search);
    for (const k of ['lang', 'theme']) if (cur.has(k)) q.set(k, cur.get(k));
    history.replaceState(null, '', `?${q}`);
    const map = new URLSearchParams({ t: `${isoMinute(S.jd)}Z` });
    if (S.fov.size) map.set('fov', [...S.fov].join(','));
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
  const ppr = (Math.min(W, H) / 2 - 22) / S.zoom;
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

function paint() {
  const [ctx, W, H] = fit();
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);
  if (!scene) return;
  const { ppr, ox, oy } = geom(W, H);
  const map = ([x, y]) => [ox + x * ppr, oy - y * ppr];
  const sky = makeSky(scene.earth);
  const labels = [];

  // Radial grid in solar radii, and the compass of a solar image
  ctx.strokeStyle = theme.grid;
  ctx.fillStyle = theme.muted;
  ctx.lineWidth = 1;
  ctx.font = `10.5px ${MONO}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (const r of [1.5, 2, 3, 5, 10, 20, 30, 50, 100, 150, 215]) {
    if (r > S.zoom * 1.45 || r < S.zoom * 0.12) continue;
    ctx.beginPath(); ctx.arc(ox, oy, r * ppr, 0, 2 * Math.PI); ctx.stroke();
    ctx.fillText(r === 215 ? '1 au' : `${r} R☉`, ox + r * ppr * 0.71 + 4, oy - r * ppr * 0.71);
  }
  ctx.font = `600 12px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = theme.muted;
  ctx.fillText(tr('N'), W / 2, 14);
  ctx.fillText(tr('S'), W / 2, H - 12);
  ctx.textAlign = 'left';
  ctx.fillText(tr('E'), 10, H / 2);
  ctx.textAlign = 'right';
  ctx.fillText(tr('W'), W - 10, H / 2);

  // Projected fields of view
  const far = S.zoom * 25;
  for (const id of S.fov) {
    const ins = INSTRUMENT[id];
    const b = scene.bodies.find((x) => x.key === ins.sc);
    if (!b || b.st === 'lost') continue;
    const grid = fovGrid(ins, SKY_SHAPES[id], b.p, sideSign(ins, b), b.dist);
    const pts = grid.map((row) => row.map((d) => {
      const q = d && sky.hit(b.p, d);
      return q && Math.abs(q[0]) < far && Math.abs(q[1]) < far ? q : null;
    }));
    const col = theme.color[ins.sc];
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
    if (SKY_SHAPES[id].type !== 'annulus') { edge(pts.map((r) => r[0])); edge(pts.map((r) => r[m])); }
    ctx.globalAlpha = 1;
    const at = SKY_SHAPES[id].type === 'annulus' ? pts[n][Math.round(m * 0.13)] : pts[Math.round(n / 2)][Math.round(m / 2)];
    if (at) { const [x, y] = map(at); labels.push({ text: `${BODIES[ins.sc].short} ${ins.name}`, x, y, r: 2, size: 11, color: col }); }
  }

  // Ground-based coronagraphs (MLSO)
  for (const g of GROUND) {
    if (!S.ground.has(g.id)) continue;
    ctx.beginPath();
    ctx.arc(ox, oy, g.outer * ppr, 0, 2 * Math.PI);
    ctx.arc(ox, oy, g.inner * ppr, 0, 2 * Math.PI, true);
    ctx.fillStyle = theme.color.earth;
    ctx.globalAlpha = 0.12;
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = theme.color.earth;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.arc(ox, oy, g.outer * ppr, 0, 2 * Math.PI); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    labels.push({ text: g.name, x: ox - g.outer * ppr * 0.71, y: oy - g.outer * ppr * 0.71, r: 2, size: 11, color: theme.color.earth });
  }

  // Sun
  ctx.beginPath();
  ctx.arc(ox, oy, Math.max(ppr, 3), 0, 2 * Math.PI);
  ctx.fillStyle = theme.sunStyle === 'eclipse' ? theme.bg : theme.sun;
  ctx.fill();
  ctx.strokeStyle = theme.sun;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // DKIST Cryo-NIRSP footprints within half a day of the moment
  if (S.ground.has('cryo')) {
    for (const d of cryoInWindow()) {
      const active = S.jd >= d.j0 && S.jd <= d.j1;
      const hl = S.hl === d.id;
      ctx.beginPath();
      d.x.forEach((x, i) => { const [px, py] = map([x / d.rsun, d.y[i] / d.rsun]); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
      ctx.closePath();
      ctx.fillStyle = theme.accent;
      ctx.globalAlpha = active || hl ? 0.45 : 0.15;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = hl ? 2.2 : 1.2;
      ctx.stroke();
      if (active || hl) {
        const [px, py] = map([d.x[0] / d.rsun, d.y[0] / d.rsun]);
        labels.push({ text: `Cryo-NIRSP ${d.id}`, x: px, y: py, r: 3, size: 11, color: theme.accent });
      }
    }
  }

  // Spacecraft where Earth sees them
  for (const b of scene.bodies) {
    const meta = BODIES[b.key];
    if (meta.kind !== 'sc' || meta.near) continue;
    const q = sky.toPlane(b.p);
    let [x, y] = map(q);
    const inside = x > 8 && x < W - 8 && y > 8 && y < H - 8;
    const col = theme.color[b.key];
    if (!inside) {
      // Clamp to the edge along the line from the centre
      const dx = x - ox;
      const dy = y - oy;
      const s = Math.min((W / 2 - 14) / Math.abs(dx || 1e-9), (H / 2 - 14) / Math.abs(dy || 1e-9));
      x = ox + dx * s;
      y = oy + dy * s;
    }
    ctx.fillStyle = col;
    ctx.globalAlpha = b.st === 'lost' ? 0.5 : 1;
    ctx.beginPath();
    ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y); ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    labels.push({ text: inside ? meta.short : `${meta.short} →`, x, y, r: 7, size: 12, color: col, bold: true });
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `600 12px ${FONT}`;
  for (const l of placeLabels(ctx, labels, W, H)) {
    ctx.font = `${l.bold ? 600 : 500} ${l.size}px ${FONT}`;
    ctx.fillStyle = theme.bg;
    ctx.globalAlpha = 0.75;
    ctx.fillRect(l.rect.x, l.rect.y, l.rect.w, l.rect.h);
    ctx.globalAlpha = 1;
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, l.rect.x + 3, l.rect.y + l.rect.h / 2 + 0.5);
  }
  $('sky-hud').textContent = `${tr('Plane of the sky seen from Earth')}\n${tr('solar north up, west to the right')}`;
}

// ---------- panels ----------
function buildLayers() {
  const box = $('sky-layers');
  const groups = [...new Set(INSTRUMENTS.map((i) => i.sc))];
  for (const sc of groups) {
    const row = document.createElement('div');
    row.className = 'fov-group';
    row.style.setProperty('--c', `var(--c-${sc})`);
    row.innerHTML = `<span class="fov-sc">${BODIES[sc].short}</span>${INSTRUMENTS.filter((i) => i.sc === sc).map((i) => `<label><input type="checkbox" data-kind="fov" value="${i.id}"${S.fov.has(i.id) ? ' checked' : ''}>${i.name}</label>`).join('')}`;
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
  renderSites();
  renderCryo();
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
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); drag = [e.clientX, e.clientY]; });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const { ppr } = geom(cv.clientWidth, cv.clientHeight);
    S.cx -= (e.clientX - drag[0]) / ppr;
    S.cy += (e.clientY - drag[1]) / ppr;
    drag = [e.clientX, e.clientY];
    renderClock();
    paint();
  });
  const up = () => { if (drag) writeURL(); drag = null; };
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
  new ResizeObserver(() => paint()).observe($('sky-wrap'));
  await update();
}

main();
