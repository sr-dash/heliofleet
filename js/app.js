import { loadManifest, ensure, info, position, jdFromDate, dateFromJD } from './ephem.js';
import { heliographic } from './frames.js';
import {
  loadEvents, events, upcoming, parseLocation, flareFlux, G_LABEL, KIND_LABEL,
} from './events.js';
import { buildScene, needs } from './scene.js';
import { drawMap, drawInset, readTheme, mapGeometry } from './render.js';
import { createRibbon } from './ribbon.js';
import { composeSnapshot, downloadPNG, downloadPDF } from './export.js';
import {
  BODIES, SPACECRAFT, PLANETS, PRESET_GROUPS, SPACE_WEATHER, ECLIPSES, MILESTONES,
} from './catalog.js';
import { ALIGN_KINDS } from './tools.js';
import { initWorkbench } from './workbench.js';
import { initCards } from './cards.js';
import {
  coverageRows, coverageSummary, drawCoverage, coverageHeight, coverageNote,
} from './coverage.js';
import { INSTRUMENTS, INSTRUMENT } from './instruments.js';
import { hvUrl, defaultLayer } from './helioviewer.js';
import {
  LANGUAGES, detectLang, loadLang, lang, saveLang, tr, translatePage,
} from './i18n.js';

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
  spot: null,
  spotOnMap: true,
  cmes: true,
  covsys: 'stonyhurst',
  fov: new Set(),
};
let cards;
let covHighlight = null;
let covGeom = null;
let mapHits = [];
let insetHits = [];
const EMBED = document.documentElement.classList.contains('embed');
const THEMES = ['night', 'eclipse', 'halpha', 'plate'];
let RANGE = [jdOf('2010-01-01T00:00Z'), jdOf('2030-01-01T00:00Z')];
let STAMP = '';
const inRange = (iso) => jdOf(iso) >= RANGE[0] && jdOf(iso) <= RANGE[1] + 1;
let theme;
let scene = null;
let ribbon;
let bench;

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
  if (q.has('cme')) S.cmes = q.get('cme') !== '0';
  if (q.has('fov')) q.get('fov').split(',').filter((k) => INSTRUMENT[k]).forEach((k) => S.fov.add(k));
  if (q.has('hide')) q.get('hide').split(',').filter((k) => BODIES[k]).forEach((k) => S.hidden.add(k));
  // spot=c,LON,LAT (Carrington) or s,LON,LAT (Stonyhurst); a trailing ,0 hides it on the map
  const sp = (q.get('spot') || '').split(',');
  if (['c', 's'].includes(sp[0]) && sp.length >= 3) {
    const lon = parseFloat(sp[1]);
    const lat = parseFloat(sp[2]);
    if (Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90) {
      S.spot = { sys: sp[0] === 'c' ? 'carrington' : 'stonyhurst', lon, lat };
      S.spotOnMap = sp[3] !== '0';
    }
  }
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
    if (!S.cmes) q.set('cme', '0');
    if (S.fov.size) q.set('fov', [...S.fov].join(','));
    // Embed and theme come from whoever wrote the link; keep them as they are.
    const cur = new URLSearchParams(location.search);
    for (const k of ['theme', 'embed', 'lang']) if (cur.has(k)) q.set(k, cur.get(k));
    if (S.spot) q.set('spot', [S.spot.sys[0], S.spot.lon, S.spot.lat, ...(S.spotOnMap ? [] : [0])].join(','));
    history.replaceState(null, '', `?${q}`);
    // The sky view keeps its own layers; only the moment and language carry over
    const sky = new URLSearchParams({ t: q.get('t') });
    if (q.has('lang')) sky.set('lang', q.get('lang'));
    $('sky-link').href = `sky.html?${sky}`;
    if (EMBED) {
      const full = new URLSearchParams(q);
      full.delete('embed');
      $('embed-open').href = `${location.pathname}?${full}`;
    }
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
  mapHits = drawMap(ctx, w, h, scene, S, theme, S, { reserve: reserve(), avoid }) ?? [];
  const [ictx, iw, ih] = fit(inset);
  insetHits = drawInset(ictx, iw, ih, scene, S, theme) ?? [];
  paintCoverage();
}

// Screen positions of every drawn body, inset first because it sits on top.
function allHits() {
  const out = [];
  const add = (cv, list) => {
    const r = cv.getBoundingClientRect();
    if (!r.width) return;
    for (const h of list) out.push({ ...h, cx: r.left + h.x, cy: r.top + h.y });
  };
  add(inset, insetHits);
  add(map, mapHits);
  return out;
}

// ---------- solar coverage ----------
const wrap360 = (a) => ((a % 360) + 360) % 360;
const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
function paintCoverage() {
  const cv = $('coverage');
  if (!scene || !cv?.clientWidth) return;
  const rows = coverageRows(scene, S.hidden);
  const sum = coverageSummary(rows);
  cv.style.height = `${coverageHeight(rows.length)}px`;
  const [ctx, w, h] = fit(cv);
  const L0 = scene.bodies[0].carr;
  let spotLon = null;
  if (S.spot) spotLon = S.spot.sys === 'carrington' ? wrap180(S.spot.lon - L0) : S.spot.lon;
  covGeom = { ...drawCoverage(ctx, w, h, rows, sum, theme, { sys: S.covsys, L0, spotLon, highlight: covHighlight }), L0 };
  $('coverage-note').innerHTML = coverageNote(sum, S.covsys, L0);
}
function focusCoverage(key, scroll = true) {
  covHighlight = key;
  paintCoverage();
  if (!key || !scroll) return;
  const panel = $('coverage-panel');
  panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  panel.classList.add('flash');
  setTimeout(() => panel.classList.remove('flash'), 1200);
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
  renderSpotChip();
  bench?.refresh();
  cards?.refresh();
}

// A marked point on the Sun is shown only when someone chose it; the chip
// says what it is and removes it.
function renderSpotChip() {
  const chip = $('spot-chip');
  chip.hidden = !(S.spot && S.spotOnMap && scene?.spot);
  if (!chip.hidden) $('spot-text').textContent = scene.spot.label;
}

// ---------- clock & context ----------
// Built on first use, after the catalogue has been translated
let presetCache = null;
const presetList = () => (presetCache ??= PRESET_GROUPS.flatMap((g) => g.items.map((it) => ({ ...it, group: g.id, jd: jdOf(it.t) }))));
const presetGroups = () => PRESET_GROUPS.map((g) => ({ ...g, items: g.items.filter((it) => inRange(it.t)) }));
function nearestPreset(jd = S.jd) {
  let best = null;
  for (const p of presetList()) {
    const d = Math.abs(p.jd - jd);
    if (d < 0.5 && (!best || d < best.d)) best = { ...p, d };
  }
  return best;
}
function contextLine(p) {
  if (!p) return '';
  if (p.group === 'eclipses') return `${tr(p.hybrid ? 'Hybrid solar eclipse' : 'Total solar eclipse')} · ${p.label}`;
  return p.label;
}
function renderClock() {
  const iso = isoMinute(S.jd);
  $('clock-date').textContent = iso.slice(0, 10);
  $('clock-time').textContent = `${iso.slice(11)} UTC`;
  const p = nearestPreset();
  $('clock-ctx').textContent = contextLine(p);
  if (EMBED) $('embed-date').textContent = `${iso.slice(0, 10)} ${iso.slice(11)} UTC`;
  const hv = defaultLayer(S.jd);
  if (hv) $('hv-link').href = hvUrl(S.jd, hv);
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
    const row = document.createElement('tr');
    const flag = b.st === 'lost' ? tr('contact lost · predicted') : b.st === 'approx' ? tr('GEO · shown at Earth') : '';
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
    row.innerHTML = cells.map((c) => `<td>${c}</td>`).join('');
    if (isEarth) row.title = `B0 = ${b.lat.toFixed(2)}°, L0 = ${b.carr.toFixed(2)}°`;
    body.appendChild(row);
  }
  $('absent').textContent = absentLine();
}
function absentLine() {
  const why = {
    prelaunch: (k) => tr('launches {date}', { date: BODIES[k].launch.slice(0, 10) }),
    ended: (k) => tr('mission ended {date}', { date: BODIES[k].ended.slice(0, 10) }),
    nodata: () => tr('outside the ephemeris'),
  };
  const absent = scene.missing.map((m) => `${BODIES[m.key].short} (${why[m.st](m.key)})`);
  return absent.length ? tr('Not on the map: {list}.', { list: absent.join(' · ') }) : '';
}

// ---------- data stamp ----------
function renderStamp(m) {
  const day = (jd) => isoMinute(jd).slice(0, 10);
  const utc = (iso) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
  const parts = [tr('Timeline <b>{from}</b> to <b>{to}</b>', { from: day(RANGE[0]), to: day(RANGE[1]) })];
  if (m.generated) parts.push(tr('Ephemerides updated <b>{time}</b>', { time: utc(m.generated) }));
  if (m.next_update) {
    const due = Date.parse(m.next_update) < Date.now();
    parts.push(due ? tr('Next scheduled update <b>due now</b>') : tr('Next scheduled update <b>{time}</b>', { time: utc(m.next_update) }));
  }
  $('data-stamp').innerHTML = parts.map((p) => `<span>${p}</span>`).join('');
  STAMP = m.generated ? m.generated.slice(0, 10) : '';
  const y0 = dateFromJD(RANGE[0]).getUTCFullYear();
  const y1 = dateFromJD(RANGE[1]).getUTCFullYear();
  $('tagline').textContent = tr('Where the Sun-watching spacecraft are, on any date from {y0} to {y1}.', { y0, y1 });
}

// ---------- hud ----------
function renderHud() {
  const f = tr(S.frame === 'hee' ? 'Earth-fixed (HEE)' : 'Inertial ecliptic J2000');
  const v = tr(S.view === 'top' ? 'from ecliptic north' : 'edge-on, north up');
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
  ['frame', 'view', 'range', 'covsys'].forEach(setSeg);
  $('trail').value = String(S.trailDays);
  $('planets').checked = S.planets;
  $('labels').checked = S.labels;
  $('spirals').checked = S.spirals;
  $('cmes').checked = S.cmes;
  $('wind').value = S.wind;
  $('wind-out').textContent = `${S.wind} km/s`;
  $('wind-field').hidden = !S.spirals;
  renderHud();
}

const fmtUT = (iso) => iso.replace('T', ' ').replace('Z', ' UT');
const GLYPH = {
  eclipse: (hybrid) => `<svg class="chip-glyph" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8.5" fill="none" stroke="var(--sun)" stroke-opacity=".5" ${hybrid ? 'stroke-dasharray="2 2"' : ''}/><circle cx="10" cy="10" r="5.5" fill="var(--plot-bg)" stroke="var(--sun)" stroke-width="1.6"/></svg>`,
  milestone: (body) => `<svg class="chip-glyph" viewBox="0 0 20 20"><circle cx="10" cy="10" r="5" fill="var(--plot-bg)" stroke="var(--c-${body})" stroke-width="2.2"/></svg>`,
  flare: '<svg class="chip-glyph" viewBox="0 0 20 20"><path d="M10 4 L16 15 L4 15 Z" fill="var(--accent)"/></svg>',
  cme: '<svg class="chip-glyph" viewBox="0 0 20 20"><circle cx="10" cy="10" r="5.5" fill="none" stroke="var(--c-psp)" stroke-width="2"/></svg>',
  storm: '<svg class="chip-glyph" viewBox="0 0 20 20"><path d="M10 3 L17 10 L10 17 L3 10 Z" fill="var(--c-earth)"/></svg>',
  perihelion: '<svg class="chip-glyph" viewBox="0 0 20 20"><circle cx="10" cy="10" r="3" fill="var(--sun)"/><path d="M3 15 Q10 1 17 15" fill="none" stroke="var(--muted)" stroke-width="1.6"/></svg>',
  alignment: '<svg class="chip-glyph" viewBox="0 0 20 20"><circle cx="4" cy="10" r="2.5" fill="var(--sun)"/><path d="M8 10 H17" stroke="var(--muted)" stroke-width="1.6" stroke-dasharray="2 2"/><path d="M12 7 L15 10 L12 13 L9 10 Z" fill="var(--ink)"/></svg>',
  quadrature: '<svg class="chip-glyph" viewBox="0 0 20 20"><path d="M4 16 V5 M4 16 H15" fill="none" stroke="var(--muted)" stroke-width="1.6"/><circle cx="4" cy="16" r="2.5" fill="var(--sun)"/></svg>',
  conjunction: '<svg class="chip-glyph" viewBox="0 0 20 20"><circle cx="10" cy="10" r="6" fill="var(--sun)" opacity=".8"/><path d="M1 10 H19" stroke="var(--ink)" stroke-width="1.4" stroke-dasharray="2 2"/></svg>',
};

function chip({ glyph, title, sub, date, future, t, onClick }) {
  const b = document.createElement('button');
  b.className = `chip${future ? ' future' : ''}`;
  if (t) b.dataset.t = t;
  b.innerHTML = `${glyph}<span class="chip-name">${title}${sub ? `<small>${sub}</small>` : ''}</span><span class="chip-date">${date}</span>`;
  b.addEventListener('click', onClick);
  return b;
}

const jump = (jd) => { stopPlay(); S.jd = jd; update(); };

// Jump to a flare's peak and mark its source region in Carrington longitude,
// so the marker rotates with the Sun as you step through time.
async function focusFlare(f) {
  stopPlay();
  const loc = parseLocation(f.loc);
  if (loc) {
    await ensure(['earth'], f.jd - 1, f.jd + 1);
    const e = position('earth', f.jd);
    const L0 = heliographic(e, e, f.jd).carr;
    S.spot = { sys: 'carrington', lon: +((((loc.lon + L0) % 360) + 360) % 360).toFixed(1), lat: loc.lat };
    S.spotOnMap = true;
    bench?.syncSpot();
    toast(tr('{cls} flare at {loc}: source region marked on the map', { cls: f.cls, loc: f.loc }));
  }
  S.jd = f.jd;
  update();
}

function weatherItems(kind, year) {
  const ev = events();
  const inYear = (t) => !year || t.startsWith(year);
  const rangeOK = (jd) => jd >= RANGE[0] && jd <= RANGE[1] + 1;
  if (kind === 'highlights') {
    return SPACE_WEATHER.filter((it) => inRange(it.t) && inYear(it.t)).map((it) => ({
      glyph: GLYPH.flare, title: it.label, sub: it.note, date: it.t.slice(0, 10), t: it.t, en: it.en,
      onClick: () => jump(jdOf(it.t)),
    }));
  }
  if (!ev) return null;
  if (kind === 'xflares' || kind === 'flares') {
    return ev.flares.filter((f) => (kind === 'flares' || f.cls[0] === 'X') && inYear(f.t) && rangeOK(f.jd)).reverse().map((f) => ({
      glyph: GLYPH.flare, title: tr('{cls} flare', { cls: f.cls }), date: f.t.slice(0, 10),
      sub: [f.loc, f.ar ? `AR ${f.ar}` : null].filter(Boolean).join(' · '),
      onClick: () => focusFlare(f),
    }));
  }
  if (kind === 'cmes') {
    return ev.cmes.filter((c) => inYear(c.t) && rangeOK(c.jd)).reverse().map((c) => ({
      glyph: GLYPH.cme, title: tr('CME, {v} km/s', { v: c.speed.toLocaleString('en-US') }), date: c.t.slice(0, 10),
      sub: [c.lon !== null ? tr('toward HGS {dir}', { dir: `${c.lon >= 0 ? 'W' : 'E'}${Math.abs(c.lon)}°` }) : tr('no direction fit'), c.src].filter(Boolean).join(' · '),
      onClick: () => jump((c.jd21 ?? c.jd) + 0.25),
    }));
  }
  return ev.storms.filter((g) => inYear(g.t) && rangeOK(g.jd)).reverse().map((g) => ({
    glyph: GLYPH.storm, title: tr('{g} geomagnetic storm', { g: G_LABEL[g.g] }), date: g.t.slice(0, 10),
    sub: `Kp ${g.kp.toFixed(2)}`, onClick: () => jump(g.jd),
  }));
}

function upcomingItems() {
  const up = upcoming();
  if (!up) return null;
  const now = jdFromDate(new Date()) - 0.5;
  return up.events.filter((e) => e.t >= now && e.t <= RANGE[1]).slice(0, 120).map((e) => {
    const { title, detail } = describeUpcoming(e);
    return {
      glyph: e.kind === 'eclipse' ? GLYPH.eclipse(e.v?.hybrid) : GLYPH[e.kind],
      title, sub: KIND_LABEL[e.kind], date: isoMinute(e.t).slice(0, 10), future: true,
      en: `${e.title} ${e.kind}`,
      onClick: () => { jump(e.t); toast(detail); },
    };
  });
}

function groupItems(id) {
  const today = jdFromDate(new Date());
  const g = presetGroups().find((x) => x.id === id);
  return g.items.map((it) => ({
    glyph: id === 'eclipses' ? GLYPH.eclipse(it.hybrid) : GLYPH.milestone(it.body),
    title: id === 'eclipses' ? `${it.label}${it.hybrid ? ` (${tr('hybrid')})` : ''}` : it.label,
    sub: it.where ?? it.note ?? '', date: it.t.slice(0, 10), t: it.t, future: jdOf(it.t) > today,
    en: it.en ?? it.label, onClick: () => jump(jdOf(it.t)),
  }));
}

// ---------- event search ----------
// One index over every preset source. Matching ignores case and accents and
// needs every word typed; English keywords work in every language.
const fold = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
let searchIndex = null;
function buildSearchIndex() {
  const out = [];
  const add = (items, cat, keywords) => {
    for (const it of items || []) {
      out.push({
        ...it,
        sub: [cat, it.sub].filter(Boolean).join(' · '),
        hay: fold([it.title, it.sub, it.date, cat, keywords, it.en ?? ''].join(' ')),
      });
    }
  };
  add(groupItems('eclipses'), tr('Total solar eclipse'), 'eclipse total solar hybrid');
  add(groupItems('milestones'), tr('Mission milestone'), 'mission milestone');
  add(weatherItems('highlights', ''), tr('Highlight'), 'space weather highlight');
  add(weatherItems('flares', ''), tr('Flare'), 'flare solar');
  add(weatherItems('cmes', ''), tr('CME'), 'cme coronal mass ejection');
  add(weatherItems('storms', ''), tr('Geomagnetic storm'), 'storm geomagnetic');
  add(upcomingItems(), tr('Upcoming'), 'upcoming calendar');
  // Nearest to today first, so a search finds the next or most recent case
  const now = Date.now();
  const gap = (it) => Math.abs(Date.parse(`${it.date}T00:00Z`) - now);
  return out.sort((a, b) => gap(a) - gap(b));
}
function searchEvents(q) {
  searchIndex ??= buildSearchIndex();
  const words = fold(q).split(/\s+/).filter(Boolean);
  return searchIndex.filter((it) => words.every((w) => it.hay.includes(w)));
}

function buildPresets() {
  const tabs = $('preset-tabs');
  const chips = $('preset-chips');
  const filters = $('preset-filters');
  const foot = $('preset-foot');
  const today = jdFromDate(new Date());
  let current = 'eclipses';
  const ev = events();
  if (ev) {
    const years = [...new Set(ev.flares.concat(ev.cmes, ev.storms).map((e) => e.t.slice(0, 4)))].sort().reverse();
    for (const y of years) $('sw-year').add(new Option(y, y));
  }
  const show = (id) => {
    current = id;
    tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', b.dataset.id === id ? 'true' : 'false'));
    filters.hidden = id !== 'weather';
    foot.hidden = id !== 'upcoming';
    chips.replaceChildren();
    let items;
    if (id === 'weather') items = weatherItems($('sw-kind').value, $('sw-year').value);
    else if (id === 'upcoming') items = upcomingItems();
    else items = groupItems(id);
    if (!items) {
      chips.innerHTML = `<p class="tool-help">${tr('The event list could not be loaded. Reload the page to try again.')}</p>`;
    } else if (!items.length) {
      chips.innerHTML = `<p class="tool-help">${tr('Nothing matches these filters.')}</p>`;
    } else {
      for (const it of items.slice(0, 400)) chips.appendChild(chip(it));
    }
    renderClock();
  };
  const groups = [...PRESET_GROUPS, { id: 'upcoming', title: tr('Upcoming') }];
  for (const g of groups) {
    const b = document.createElement('button');
    b.role = 'tab';
    b.dataset.id = g.id;
    b.textContent = g.title;
    b.addEventListener('click', () => show(g.id));
    tabs.appendChild(b);
  }
  // Search across every tab; clearing it (or Escape) brings the tabs back.
  const box = $('preset-search');
  const summary = $('preset-summary');
  const runSearch = () => {
    const q = box.value.trim();
    tabs.classList.toggle('searching', !!q);
    if (!q) { summary.hidden = true; show(current); return; }
    const hits = searchEvents(q);
    filters.hidden = true;
    foot.hidden = true;
    summary.hidden = false;
    chips.replaceChildren();
    if (!hits.length) {
      summary.textContent = tr('No events match “{q}”. Try a flare class (X9), a year (2017) or a name (Parker).', { q });
      return;
    }
    const shown = hits.slice(0, 200);
    summary.textContent = hits.length === 1 ? tr('1 event matches')
      : hits.length > shown.length ? tr('Showing the first {shown} of {n} matching events', { shown: shown.length, n: hits.length })
        : tr('{n} events match', { n: hits.length });
    for (const it of shown) chips.appendChild(chip(it));
    renderClock();
  };
  box.addEventListener('input', runSearch);
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { box.value = ''; runSearch(); }
  });
  tabs.addEventListener('click', () => { if (box.value) { box.value = ''; tabs.classList.remove('searching'); summary.hidden = true; } });
  $('sw-kind').addEventListener('change', () => show('weather'));
  $('sw-year').addEventListener('change', () => show('weather'));
  // webcal:// only works where the system has a calendar app registered for
  // it, so offer the common services directly and a copyable feed address.
  const feed = 'https://sr-dash.github.io/heliofleet/calendar.ics';
  const google = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(feed.replace('https://', 'webcal://'))}`;
  foot.innerHTML = `
    <span class="cal-title">${tr('Add these events to your calendar')}</span>
    <span class="cal-links">
      <a href="${google}" target="_blank" rel="noopener">Google Calendar</a>
      <a href="${feed.replace('https://', 'webcal://')}">${tr('Apple Calendar')}</a>
      <button type="button" id="cal-copy">${tr('Copy feed link')}</button>
      <a href="calendar.ics" download>${tr('Download .ics')}</a>
    </span>
    <span>${tr('For Outlook and other calendars, copy the feed link and paste it under “Subscribe from web” or “Add calendar from URL”.')}</span>
    <span>${tr('Perihelia, alignments, quadratures, solar conjunctions and eclipses, refreshed monthly.')}</span>`;
  $('cal-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(feed);
      toast(tr('Feed link copied: {url}', { url: feed }));
    } catch {
      toast(feed);
    }
  });
  show(current);
}

// Space-weather markers for the timeline: X flares, storms G4+, CMEs 2000 km/s+
function ribbonMarks() {
  const ev = events();
  if (!ev) return undefined;
  return () => [
    ...ev.flares.filter((f) => f.cls[0] === 'X').map((f) => ({
      jd: f.jd, kind: 'flare', size: Math.min(1, Math.log10(flareFlux(f.cls) / 1e-4)),
      html: `<b>${tr('{cls} flare', { cls: f.cls })}</b><span>${fmtUT(f.t)}</span><span>${[f.loc, f.ar ? `AR ${f.ar}` : null].filter(Boolean).join(' · ')}</span>`,
      pick: () => focusFlare(f),
    })),
    ...ev.cmes.filter((c) => c.speed >= 2000).map((c) => ({
      jd: c.jd, kind: 'cme', size: Math.min(1, (c.speed - 2000) / 1500),
      html: `<b>${tr('CME, {v} km/s', { v: c.speed.toLocaleString('en-US') })}</b><span>${fmtUT(c.t)}</span>${c.src ? `<span>${tr('Source {loc}', { loc: c.src })}</span>` : ''}`,
      pick: () => jump((c.jd21 ?? c.jd) + 0.25),
    })),
    ...ev.storms.filter((g) => g.g >= 4).map((g) => ({
      jd: g.jd, kind: 'storm', size: g.g === 5 ? 1 : 0.5,
      html: `<b>${tr('{g} geomagnetic storm', { g: G_LABEL[g.g] })}</b><span>${fmtUT(g.t)}</span><span>Kp ${g.kp.toFixed(2)}</span>`,
      pick: () => jump(g.jd),
    })),
  ];
}

// Field-of-view checkboxes, one row per spacecraft
function buildFovList() {
  const box = $('fov-list');
  const groups = [...new Set(INSTRUMENTS.map((i) => i.sc))];
  for (const sc of groups) {
    const row = document.createElement('div');
    row.className = 'fov-group';
    row.style.setProperty('--c', `var(--c-${sc})`);
    row.innerHTML = `<span class="fov-sc">${BODIES[sc].short}</span>${INSTRUMENTS.filter((i) => i.sc === sc).map((i) => `<label><input type="checkbox" value="${i.id}"${S.fov.has(i.id) ? ' checked' : ''}>${i.name}</label>`).join('')}`;
    box.appendChild(row);
  }
  box.addEventListener('change', (e) => {
    const id = e.target.value;
    if (e.target.checked) S.fov.add(id); else S.fov.delete(id);
    update();
  });
}
function toggleFov(id) {
  if (S.fov.has(id)) S.fov.delete(id); else S.fov.add(id);
  const cb = $('fov-list').querySelector(`input[value="${id}"]`);
  if (cb) cb.checked = S.fov.has(id);
  update();
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
  $('embed-play').setAttribute('aria-pressed', 'true');
  $('play').querySelector('.play-label').textContent = tr('Pause');
  last = performance.now();
  requestAnimationFrame(tick);
}
function stopPlay() {
  if (!playing) return;
  playing = false;
  $('play').setAttribute('aria-pressed', 'false');
  $('embed-play').setAttribute('aria-pressed', 'false');
  $('play').querySelector('.play-label').textContent = tr('Play');
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
  let down = null;
  map.addEventListener('pointerdown', (e) => {
    map.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    down = { x: e.clientX, y: e.clientY, moved: false };
    map.classList.add('dragging');
    cards?.leave();
  });
  map.addEventListener('pointerleave', () => cards?.leave());
  map.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) { if (e.pointerType === 'mouse') cards?.hover(e.clientX, e.clientY); return; }
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) down.moved = true;
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
    if (e.type === 'pointerup' && down && !down.moved && !ptrs.size) cards?.click(e.clientX, e.clientY);
    down = null;
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
    stamp: STAMP,
    frame: frameLine(),
  };
  const base = `heliofleet_${iso.replace(/[-:]/g, '').replace('T', '_')}UT`;
  try {
    const cv = await composeSnapshot(scene, S, theme, S, meta);
    if (kind === 'png') await downloadPNG(cv, base);
    else await downloadPDF(cv, base, `HelioFleet ${meta.date} ${meta.time}`);
    toast(tr('Saved {file}', { file: `${base}.${kind}` }));
  } catch (err) {
    toast(err.message);
  }
}

// ---------- language ----------
function frameLine() {
  return `${tr(S.frame === 'hee' ? 'Earth-fixed (HEE)' : 'Inertial ecliptic J2000')}, ${tr(S.view === 'top' ? 'from ecliptic north' : 'edge-on, north up')}`;
}

// Catalogue text shown on the page, translated in place once at load.
function localize() {
  if (lang() === 'en') return;
  for (const k of ['earth', ...PLANETS]) { BODIES[k].name = tr(BODIES[k].name); BODIES[k].short = tr(BODIES[k].short); }
  for (const e of ECLIPSES) { e.en = `${e.label} ${e.where}`; e.label = tr(e.label); e.where = tr(e.where); }
  for (const m of MILESTONES) { m.en = m.label; m.label = tr(m.label); }
  for (const w of SPACE_WEATHER) { w.en = `${w.label} ${w.note}`; w.label = tr(w.label); w.note = tr(w.note); }
  for (const g of PRESET_GROUPS) g.title = tr(g.title);
  for (const a of Object.values(ALIGN_KINDS)) { a.label = tr(a.label); a.help = tr(a.help); }
  for (const k of Object.keys(G_LABEL)) G_LABEL[k] = tr(G_LABEL[k]);
  for (const k of Object.keys(KIND_LABEL)) KIND_LABEL[k] = tr(KIND_LABEL[k]);
  // Search engines index each language at its own address
  const canon = document.querySelector('link[rel="canonical"]');
  if (canon) canon.href = `https://sr-dash.github.io/heliofleet/?lang=${lang()}`;
}

// "Start over" links (title and Moment panel) open a clean page: today's
// date and default settings, keeping only the reader's language.
function setHomeLinks() {
  const href = lang() === 'en' ? './' : `./?lang=${lang()}`;
  document.querySelectorAll('.home-link').forEach((a) => { a.href = href; });
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

// Upcoming-event text in the page language, from the values the calendar
// builder stores; English comes straight from the calendar feed.
function describeUpcoming(e) {
  if (lang() === 'en' || !e.v) return { title: e.title, detail: e.detail };
  const v = e.v;
  const n = (k) => BODIES[k]?.name ?? k;
  const [a, b] = e.bodies;
  switch (e.kind) {
    case 'perihelion':
      return { title: tr('{name} perihelion', { name: n(a) }),
        detail: tr('Closest approach to the Sun: {r} au ({rs} solar radii).', { r: v.r, rs: v.rs }) };
    case 'alignment':
      return b === 'earth'
        ? { title: tr('{name} on the Sun–Earth line', { name: n(a) }),
          detail: tr(v.inside ? '{name} lies between the Sun and Earth, {sep}° off the Sun–Earth line at {r} au.' : '{name} lies beyond Earth, {sep}° off the Sun–Earth line at {r} au.', { name: n(a), sep: v.sep, r: v.ra }) }
        : { title: tr('{a} and {b} radially aligned', { a: n(a), b: n(b) }),
          detail: tr('Sun-centred separation {sep}° at closest; {a} at {ra} au, {b} at {rb} au.', { sep: v.sep, a: n(a), b: n(b), ra: v.ra, rb: v.rb }) };
    case 'quadrature':
      return { title: tr('{name} in quadrature with Earth', { name: n(a) }),
        detail: tr(v.ahead ? '{name} is 90° from Earth as seen from the Sun (west, ahead of Earth), at {r} au.' : '{name} is 90° from Earth as seen from the Sun (east, trailing Earth), at {r} au.', { name: n(a), r: v.r }) };
    case 'conjunction':
      return { title: tr('Solar conjunction: {name} behind the Sun', { name: n(a) }),
        detail: tr('{name} is {sep}° from the Sun\'s centre as seen from Earth; communications are often limited near conjunction.', { name: n(a), sep: v.sep }) };
    case 'eclipse':
      return { title: `${tr(v.hybrid ? 'Hybrid solar eclipse' : 'Total solar eclipse')}: ${tr(v.label)}`,
        detail: tr('Greatest eclipse. Path: {where}.', { where: tr(v.where) }) };
    default:
      return { title: e.title, detail: e.detail };
  }
}

// ---------- boot ----------
async function main() {
  await loadLang(detectLang());
  localize();
  translatePage();
  buildLangSwitch();
  setHomeLinks();
  readURL();
  theme = readTheme();
  setTheme(document.documentElement.dataset.theme, false);
  const urlTheme = new URLSearchParams(location.search).get('theme');
  if (THEMES.includes(urlTheme)) setTheme(urlTheme, false);
  let manifest;
  const eventsReady = loadEvents();
  try {
    manifest = await loadManifest();
  } catch (err) {
    $('loading').textContent = `${err.message}. ${tr('Serve the site over http (for example: python3 -m http.server).')}`;
    return;
  }
  const e = info('earth');
  RANGE = manifest.timeline ? [manifest.timeline.start, manifest.timeline.end] : [e.start, e.end];
  renderStamp(manifest);
  $('dt').min = isoMinute(e.start);
  $('dt').max = isoMinute(e.end);

  await eventsReady;
  const syncPlanetLegend = buildLegend();
  syncPlanetLegend();
  buildPresets();
  buildFovList();
  syncControls();
  initMapGestures();

  ribbon = createRibbon($('ribbon'), $('ribbon-tip'), {
    start: RANGE[0],
    end: RANGE[1],
    onScrub: (jd) => { stopPlay(); S.jd = jd; update(); },
    onPick: (jd) => { stopPlay(); S.jd = jd; update(); },
    marks: ribbonMarks(),
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
  $('cmes').addEventListener('change', (ev) => { S.cmes = ev.target.checked; update(); });
  $('wind').addEventListener('input', (ev) => {
    S.wind = parseInt(ev.target.value, 10);
    $('wind-out').textContent = `${S.wind} km/s`;
    update();
  });
  document.querySelectorAll('[data-theme-pick]').forEach((b) => b.addEventListener('click', () => {
    setTheme(b.dataset.themePick);
    ribbon.draw();
    // A picked theme replaces one that came in on the link
    const q = new URLSearchParams(location.search);
    if (q.has('theme') && !EMBED) { q.delete('theme'); history.replaceState(null, '', `?${q}`); }
  }));
  $('dl-png').addEventListener('click', () => snapshot('png'));
  $('dl-pdf').addEventListener('click', () => snapshot('pdf'));
  $('copy-link').addEventListener('click', async () => {
    clearTimeout(urlTimer);
    writeURL();
    await new Promise((r) => setTimeout(r, 300));
    try {
      await navigator.clipboard.writeText(location.href);
      toast(tr('Link copied'));
    } catch {
      toast(tr('Copy the address bar to share this moment'));
    }
  });
  bench = initWorkbench({
    S,
    toast,
    scene: () => scene,
    range: () => RANGE,
    jump: (jd) => { stopPlay(); S.jd = jd; update(); },
    redraw: () => update(),
    theme: () => theme,
    frameMeta: (jd) => {
      const iso = isoMinute(jd);
      return {
        date: iso.slice(0, 10),
        time: `${iso.slice(11)} UTC`,
        context: contextLine(nearestPreset(jd)),
        frame: frameLine(),
      };
    },
  });
  cards = initCards({
    S,
    bench,
    wrap: $('map-wrap'),
    scene: () => scene,
    hits: allHits,
    jump: (jd) => { stopPlay(); S.jd = jd; update(); },
    hide: (key) => document.querySelector(`.legend button[data-key="${key}"]`)?.click(),
    coverage: (key, scroll = true) => focusCoverage(key, scroll),
    toggleFov,
  });
  inset.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') cards.hover(e.clientX, e.clientY); });
  inset.addEventListener('pointerleave', () => cards.leave());
  inset.addEventListener('click', (e) => cards.click(e.clientX, e.clientY));
  $('coverage').addEventListener('click', (e) => {
    if (!covGeom || !scene) return;
    const r = $('coverage').getBoundingClientRect();
    const px = e.clientX - r.left;
    if (px < covGeom.left || px > covGeom.right) return;
    const stony = covGeom.toStony(px);
    S.spot = { sys: 'carrington', lon: +wrap360(stony + covGeom.L0).toFixed(1), lat: 0 };
    S.spotOnMap = true;
    bench.syncSpot();
    update();
  });
  if (EMBED) {
    $('embed-play').addEventListener('click', () => (playing ? stopPlay() : startPlay()));
    $('speed').value = '7';
  }
  $('embed-code').addEventListener('click', () => {
    clearTimeout(urlTimer);
    const q = new URLSearchParams(location.search);
    q.set('t', `${isoMinute(S.jd)}Z`);
    q.set('embed', '1');
    q.delete('theme');
    const base = 'https://sr-dash.github.io/heliofleet/';
    const tag = (extra) => `<iframe src="${base}?${q}${extra}" title="HelioFleet: spacecraft positions around the Sun" width="100%" height="560" style="border:0;border-radius:12px" loading="lazy"></iframe>`;
    bench.openSheet(tr('Embed on your site'),
      tr('Paste this into a web page, wiki or course site to show the current map. Viewers can zoom, pan and step through time, and open the full HelioFleet in a new tab. Add {theme} (or {others}) to fix the colours, and {lang} or {es} for Hindi or Spanish.', {
        theme: '<code>&amp;theme=plate</code>',
        others: '<code>night</code>, <code>eclipse</code>, <code>halpha</code>',
        lang: '<code>&amp;lang=hi</code>',
        es: '<code>&amp;lang=es</code>',
      }),
      [
        { heading: tr('This moment'), text: tag(''), wrap: true },
        { heading: tr('Light theme'), text: tag('&theme=plate'), wrap: true },
      ]);
  });
  $('spot-edit').addEventListener('click', () => bench.showSpotTool());
  $('spot-clear').addEventListener('click', () => { bench.clearSpot(); update(); });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && cards.isOpen()) { cards.close(); return; }
    if (bench.isOpen() || ev.target.closest('input, select, textarea, #ribbon, [role="tab"]')) return;
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
