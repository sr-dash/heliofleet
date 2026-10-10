import { loadManifest, ensure, info, jdFromDate, dateFromJD } from './ephem.js';
import { buildScene, needs } from './scene.js';
import { drawMap, drawInset, readTheme, mapGeometry } from './render.js';
import { createRibbon } from './ribbon.js';
import { composeSnapshot, downloadPNG, downloadPDF } from './export.js';
import { BODIES, SPACECRAFT, PLANETS, PRESET_GROUPS } from './catalog.js';

const $ = (id) => document.getElementById(id);
const jdOf = (iso) => Date.parse(iso) / 864e5 + 2440587.5;
const isoMinute = (jd) => dateFromJD(jd + 1 / 2880).toISOString().slice(0, 16);

const S = {
  jd: jdFromDate(new Date()),
  frame: 'hee',
  view: 'top',
  range: 1.15,
  cx: 0,
  cy: 0,
  trailDays: 45,
  planets: true,
  labels: true,
  spirals: false,
  wind: 400,
  hidden: new Set(),
};
let RANGE = [jdOf('2010-01-01T00:00Z'), jdOf('2029-12-31T00:00Z')];
let theme;
let scene = null;
let ribbon;

// ---------- URL state ----------
function readURL() {
  const q = new URLSearchParams(location.search);
  if (q.has('t')) {
    const t = Date.parse(q.get('t').replace(/Z?$/, 'Z'));
    if (!Number.isNaN(t)) S.jd = t / 864e5 + 2440587.5;
  }
  if (['hee', 'hae'].includes(q.get('frame'))) S.frame = q.get('frame');
  if (['top', 'side'].includes(q.get('view'))) S.view = q.get('view');
  const num = (k, lo, hi) => {
    const v = parseFloat(q.get(k));
    return Number.isFinite(v) && v >= lo && v <= hi ? v : null;
  };
  S.range = num('zoom', 0.01, 5) ?? S.range;
  S.trailDays = num('trail', 0, 365) ?? S.trailDays;
  S.wind = num('wind', 250, 800) ?? S.wind;
  if (q.has('planets')) S.planets = q.get('planets') !== '0';
  if (q.has('spirals')) S.spirals = q.get('spirals') === '1';
  if (q.has('hide')) q.get('hide').split(',').filter((k) => BODIES[k]).forEach((k) => S.hidden.add(k));
}

let urlTimer;
function writeURL() {
  clearTimeout(urlTimer);
  urlTimer = setTimeout(() => {
    const q = new URLSearchParams();
    q.set('t', `${isoMinute(S.jd)}Z`);
    if (S.frame !== 'hee') q.set('frame', S.frame);
    if (S.view !== 'top') q.set('view', S.view);
    if (S.range !== 1.15) q.set('zoom', +S.range.toFixed(3));
    if (S.trailDays !== 45) q.set('trail', S.trailDays);
    if (!S.planets) q.set('planets', '0');
    if (S.spirals) q.set('spirals', '1');
    if (S.wind !== 400) q.set('wind', S.wind);
    if (S.hidden.size) q.set('hide', [...S.hidden].join(','));
    history.replaceState(null, '', `?${q}`);
  }, 250);
}

// ---------- canvases ----------
const map = $('map');
const inset = $('inset');
function fit(cv) {
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

const reserve = () => (map.clientWidth > 700 ? inset.parentElement.offsetWidth + 24 : 0);
function paint() {
  const [ctx, w, h] = fit(map);
  const fig = inset.parentElement;
  const avoid = [{ x: fig.offsetLeft - 4, y: fig.offsetTop - 4, w: fig.offsetWidth + 8, h: fig.offsetHeight + 8 }];
  drawMap(ctx, w, h, scene, S, theme, S, { reserve: reserve(), avoid });
  const [ictx, iw, ih] = fit(inset);
  drawInset(ictx, iw, ih, scene, S, theme);
}

// ---------- update cycle ----------
let gen = 0;
async function update({ fromInput = false } = {}) {
  const my = ++gen;
  S.jd = Math.min(RANGE[1], Math.max(RANGE[0], S.jd));
  renderClock();
  ribbon?.set(S.jd);
  if (!fromInput) $('dt').value = isoMinute(S.jd);
  writeURL();
  await Promise.all(needs(S.jd, S).map(([k, a, b]) => ensure([k], a, b)));
  if (my !== gen && playing) return;
  scene = buildScene(S.jd, S);
  $('loading').hidden = !!scene;
  paint();
  renderTable();
}

// ---------- clock & context ----------
const PRESETS = PRESET_GROUPS.flatMap((g) => g.items.map((it) => ({ ...it, group: g.id, jd: jdOf(it.t) })));
function nearestPreset() {
  let best = null;
  for (const p of PRESETS) {
    const d = Math.abs(p.jd - S.jd);
    if (d < 0.5 && (!best || d < best.d)) best = { ...p, d };
  }
  return best;
}
function contextLine(p) {
  if (!p) return '';
  if (p.group === 'eclipses') return `${p.hybrid ? 'Hybrid' : 'Total'} solar eclipse · ${p.label}`;
  return p.label;
}
function renderClock() {
  const iso = isoMinute(S.jd);
  $('clock-date').textContent = iso.slice(0, 10);
  $('clock-time').textContent = `${iso.slice(11)} UTC`;
  const p = nearestPreset();
  $('clock-ctx').textContent = contextLine(p);
  document.querySelectorAll('.chip').forEach((c) => {
    c.setAttribute('aria-current', p && c.dataset.t === p.t ? 'true' : 'false');
  });
}

// ---------- coordinate table ----------
const sgn = (v, d = 2) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}°`;
function renderTable() {
  const body = $('table').querySelector('tbody');
  body.replaceChildren();
  if (!scene) return;
  for (const b of scene.bodies) {
    if (S.hidden.has(b.key)) continue;
    const meta = BODIES[b.key];
    const planet = meta.kind === 'planet' && b.key !== 'earth';
    const isEarth = b.key === 'earth';
    const tr = document.createElement('tr');
    const flag = b.st === 'lost' ? 'contact lost · predicted' : b.st === 'approx' ? 'GEO · shown at Earth' : '';
    const cells = [
      `<span class="dot${meta.kind === 'planet' ? ' planet' : ''}" style="--c:var(--c-${b.key})"></span>${meta.short}${flag ? `<span class="flag">${flag}</span>` : ''}`,
      b.dist.toFixed(b.dist < 0.2 ? 4 : 3),
      sgn(b.lon),
      sgn(b.lat),
      `${b.carr.toFixed(2)}°`,
      isEarth ? '—' : `${b.sep.toFixed(2)}°`,
      isEarth ? '—' : b.dEarth.toFixed(b.dEarth < 0.1 ? 4 : 3),
      planet ? '—' : sgn(b.foot, 1),
    ];
    tr.innerHTML = cells.map((c) => `<td>${c}</td>`).join('');
    if (isEarth) tr.title = `B0 = ${b.lat.toFixed(2)}°, L0 = ${b.carr.toFixed(2)}°`;
    body.appendChild(tr);
  }
  $('absent').textContent = absentLine();
}
function absentLine() {
  const why = {
    prelaunch: (k) => `launches ${BODIES[k].launch.slice(0, 10)}`,
    ended: (k) => `mission ended ${BODIES[k].ended.slice(0, 10)}`,
    nodata: () => 'outside the ephemeris',
  };
  const absent = scene.missing.map((m) => `${BODIES[m.key].short} (${why[m.st](m.key)})`);
  return absent.length ? `Not on the map: ${absent.join(' · ')}.` : '';
}

// ---------- hud ----------
function renderHud() {
  const f = S.frame === 'hee' ? 'Earth-fixed (HEE)' : 'Inertial ecliptic J2000';
  const v = S.view === 'top' ? 'from ecliptic north' : 'edge-on, north up';
  $('hud').textContent = `${f}\n${v}`;
}

// ---------- controls ----------
function setSeg(name) {
  document.querySelectorAll(`.seg[data-setting="${name}"] button`).forEach((b) => {
    const val = name === 'range' ? parseFloat(b.dataset.value) : b.dataset.value;
    const on = name === 'range' ? Math.abs(val - S.range) < 1e-6 && !S.cx && !S.cy : val === S[name];
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}
function syncControls() {
  ['frame', 'view', 'range'].forEach(setSeg);
  $('trail').value = String(S.trailDays);
  $('planets').checked = S.planets;
  $('labels').checked = S.labels;
  $('spirals').checked = S.spirals;
  $('wind').value = S.wind;
  $('wind-out').textContent = `${S.wind} km/s`;
  $('wind-field').hidden = !S.spirals;
  renderHud();
}

function buildPresets() {
  const tabs = $('preset-tabs');
  const chips = $('preset-chips');
  const today = jdFromDate(new Date());
  const show = (id) => {
    tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', b.dataset.id === id ? 'true' : 'false'));
    const g = PRESET_GROUPS.find((x) => x.id === id);
    chips.replaceChildren();
    for (const it of g.items) {
      const b = document.createElement('button');
      b.className = `chip${jdOf(it.t) > today ? ' future' : ''}`;
      b.dataset.t = it.t;
      const glyph = id === 'eclipses'
        ? `<svg class="chip-glyph" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8.5" fill="none" stroke="var(--sun)" stroke-opacity=".5" ${it.hybrid ? 'stroke-dasharray="2 2"' : ''}/><circle cx="10" cy="10" r="5.5" fill="var(--plot-bg)" stroke="var(--sun)" stroke-width="1.6"/></svg>`
        : id === 'milestones'
          ? `<svg class="chip-glyph" viewBox="0 0 20 20"><circle cx="10" cy="10" r="5" fill="var(--plot-bg)" stroke="var(--c-${it.body})" stroke-width="2.2"/></svg>`
          : '<svg class="chip-glyph" viewBox="0 0 20 20"><path d="M10 4 L16 15 L4 15 Z" fill="var(--accent)"/></svg>';
      const sub = it.where ?? it.note ?? '';
      const title = id === 'eclipses' ? `${it.label}${it.hybrid ? ' (hybrid)' : ''}` : it.label;
      b.innerHTML = `${glyph}<span class="chip-name">${title}${sub ? `<small>${sub}</small>` : ''}</span><span class="chip-date">${it.t.slice(0, 10)}</span>`;
      b.addEventListener('click', () => { stopPlay(); S.jd = jdOf(it.t); update(); });
      chips.appendChild(b);
    }
    renderClock();
  };
  for (const g of PRESET_GROUPS) {
    const b = document.createElement('button');
    b.role = 'tab';
    b.dataset.id = g.id;
    b.textContent = g.title;
    b.addEventListener('click', () => show(g.id));
    tabs.appendChild(b);
  }
  show('eclipses');
}

function buildLegend() {
  const ul = $('legend');
  for (const key of ['earth', ...SPACECRAFT, ...PLANETS]) {
    const m = BODIES[key];
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.dataset.key = key;
    b.setAttribute('aria-pressed', S.hidden.has(key) ? 'false' : 'true');
    b.innerHTML = `<span class="lg-mark ${m.kind}" style="--c:var(--c-${key})"></span><span class="lg-name">${m.short === 'Parker' ? 'Parker Solar Probe' : m.short}</span>${m.agency ? `<span class="lg-agency">${m.agency}</span>` : ''}`;
    if (key === 'earth') b.disabled = true;
    b.addEventListener('click', () => {
      if (S.hidden.has(key)) S.hidden.delete(key); else S.hidden.add(key);
      b.setAttribute('aria-pressed', S.hidden.has(key) ? 'false' : 'true');
      writeURL();
      paint();
      renderTable();
    });
    li.appendChild(b);
    ul.appendChild(li);
  }
  const planetItems = () => ul.querySelectorAll(PLANETS.map((k) => `[data-key="${k}"]`).join(','));
  return () => planetItems().forEach((b) => { b.parentElement.hidden = !S.planets; });
}

// ---------- playback ----------
let playing = false;
let last = 0;
function tick(t) {
  if (!playing) return;
  const dt = Math.min(0.1, (t - last) / 1000);
  last = t;
  S.jd += dt * parseFloat($('speed').value);
  if (S.jd >= RANGE[1]) { S.jd = RANGE[1]; stopPlay(); }
  update();
  requestAnimationFrame(tick);
}
function startPlay() {
  playing = true;
  $('play').setAttribute('aria-pressed', 'true');
  $('play').querySelector('.play-label').textContent = 'Pause';
  last = performance.now();
  requestAnimationFrame(tick);
}
function stopPlay() {
  if (!playing) return;
  playing = false;
  $('play').setAttribute('aria-pressed', 'false');
  $('play').querySelector('.play-label').textContent = 'Play';
  update();
}

// ---------- map interaction: wheel zoom, drag pan, pinch ----------
function zoomBy(f, px, py) {
  const { ppa, ox, oy } = mapGeometry(map.clientWidth, map.clientHeight, S, reserve());
  const ax = px === undefined ? 0 : (px - ox) / ppa;
  const ay = py === undefined ? 0 : -(py - oy) / ppa;
  const nr = Math.min(3, Math.max(0.02, S.range * f));
  const k = nr / S.range;
  if (px !== undefined) {
    S.cx = ax - (ax - S.cx) * k;
    S.cy = ay - (ay - S.cy) * k;
  }
  S.range = nr;
  setSeg('range');
  writeURL();
  paint();
}
function initMapGestures() {
  map.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = map.getBoundingClientRect();
    zoomBy(Math.exp(e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  const ptrs = new Map();
  let pinch = 0;
  map.addEventListener('pointerdown', (e) => {
    map.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    map.classList.add('dragging');
  });
  map.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const prev = ptrs.get(e.pointerId);
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) zoomBy(pinch / d);
      pinch = d;
      return;
    }
    const { ppa } = mapGeometry(map.clientWidth, map.clientHeight, S, reserve());
    S.cx -= (e.clientX - prev[0]) / ppa;
    S.cy += (e.clientY - prev[1]) / ppa;
    setSeg('range');
    paint();
  });
  const up = (e) => {
    ptrs.delete(e.pointerId);
    pinch = 0;
    if (!ptrs.size) map.classList.remove('dragging');
  };
  map.addEventListener('pointerup', up);
  map.addEventListener('pointercancel', up);
  map.addEventListener('dblclick', () => { S.cx = 0; S.cy = 0; S.range = 1.15; setSeg('range'); writeURL(); paint(); });
  $('zoom-in').addEventListener('click', () => zoomBy(1 / 1.4));
  $('zoom-out').addEventListener('click', () => zoomBy(1.4));
  $('zoom-reset').addEventListener('click', () => { S.cx = 0; S.cy = 0; S.range = 1.15; setSeg('range'); writeURL(); paint(); });
}

// ---------- toast ----------
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------- theme ----------
function setTheme(name, persist = true) {
  document.documentElement.dataset.theme = name;
  document.querySelectorAll('[data-theme-pick]').forEach((b) => b.setAttribute('aria-checked', b.dataset.themePick === name ? 'true' : 'false'));
  if (persist) { try { localStorage.setItem('heliofleet-theme', name); } catch (e) { /* storage unavailable */ } }
  theme = readTheme();
  paint();
}

// ---------- export ----------
async function snapshot(kind) {
  if (!scene) return;
  const iso = isoMinute(S.jd);
  const meta = {
    date: iso.slice(0, 10),
    time: `${iso.slice(11)} UTC`,
    context: contextLine(nearestPreset()),
    absent: absentLine(),
    frame: `${S.frame === 'hee' ? 'Earth-fixed (HEE)' : 'Inertial ecliptic J2000'}, ${S.view === 'top' ? 'viewed from ecliptic north' : 'edge-on'}`,
  };
  const base = `heliofleet_${iso.replace(/[-:]/g, '').replace('T', '_')}UT`;
  try {
    const cv = await composeSnapshot(scene, S, theme, S, meta);
    if (kind === 'png') await downloadPNG(cv, base);
    else downloadPDF(cv, base, `HelioFleet ${meta.date} ${meta.time}`);
    toast(`Saved ${base}.${kind}`);
  } catch (err) {
    toast(err.message);
  }
}

// ---------- boot ----------
async function main() {
  readURL();
  theme = readTheme();
  setTheme(document.documentElement.dataset.theme, false);
  try {
    await loadManifest();
  } catch (err) {
    $('loading').textContent = `${err.message}. Serve the site over http (for example: python3 -m http.server).`;
    return;
  }
  const e = info('earth');
  RANGE = [e.start, e.end];
  $('dt').min = isoMinute(e.start);
  $('dt').max = isoMinute(e.end);

  const syncPlanetLegend = buildLegend();
  syncPlanetLegend();
  buildPresets();
  syncControls();
  initMapGestures();

  ribbon = createRibbon($('ribbon'), $('ribbon-tip'), {
    start: RANGE[0],
    end: RANGE[1],
    onScrub: (jd) => { stopPlay(); S.jd = jd; update(); },
    onPick: (jd) => { stopPlay(); S.jd = jd; update(); },
  });

  $('dt').addEventListener('change', (ev) => {
    const t = Date.parse(`${ev.target.value}Z`);
    if (Number.isNaN(t)) return;
    stopPlay();
    S.jd = t / 864e5 + 2440587.5;
    update({ fromInput: true });
  });
  document.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
    stopPlay();
    S.jd += parseFloat(b.dataset.step);
    update();
  }));
  $('now').addEventListener('click', () => { stopPlay(); S.jd = jdFromDate(new Date()); update(); });
  $('play').addEventListener('click', () => (playing ? stopPlay() : startPlay()));

  document.querySelectorAll('.seg').forEach((seg) => seg.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    const name = seg.dataset.setting;
    if (name === 'range') { S.range = parseFloat(b.dataset.value); S.cx = 0; S.cy = 0; }
    else S[name] = b.dataset.value;
    syncControls();
    update();
  }));
  $('trail').addEventListener('change', (ev) => { S.trailDays = parseInt(ev.target.value, 10); update(); });
  $('planets').addEventListener('change', (ev) => { S.planets = ev.target.checked; syncPlanetLegend(); update(); });
  $('labels').addEventListener('change', (ev) => { S.labels = ev.target.checked; paint(); });
  $('spirals').addEventListener('change', (ev) => { S.spirals = ev.target.checked; syncControls(); update(); });
  $('wind').addEventListener('input', (ev) => {
    S.wind = parseInt(ev.target.value, 10);
    $('wind-out').textContent = `${S.wind} km/s`;
    update();
  });
  document.querySelectorAll('[data-theme-pick]').forEach((b) => b.addEventListener('click', () => {
    setTheme(b.dataset.themePick);
    ribbon.draw();
  }));
  $('dl-png').addEventListener('click', () => snapshot('png'));
  $('dl-pdf').addEventListener('click', () => snapshot('pdf'));
  $('copy-link').addEventListener('click', async () => {
    clearTimeout(urlTimer);
    writeURL();
    await new Promise((r) => setTimeout(r, 300));
    try {
      await navigator.clipboard.writeText(location.href);
      toast('Link copied');
    } catch {
      toast('Copy the address bar to share this moment');
    }
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.target.closest('input, select, textarea, #ribbon')) return;
    if (ev.key === ' ') { ev.preventDefault(); playing ? stopPlay() : startPlay(); return; }
    const d = { ArrowLeft: -1, ArrowRight: 1 }[ev.key];
    if (!d) return;
    ev.preventDefault();
    stopPlay();
    S.jd += d * (ev.shiftKey ? 1 / 24 : 1);
    update();
  });
  new ResizeObserver(() => paint()).observe($('map-wrap'));
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { theme = readTheme(); paint(); });

  await update();
}

main();
