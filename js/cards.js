// Hover tooltips and click-open information cards for bodies on the map and
// in the near-Earth inset. Positions come from the renderer (drawMap and
// drawInset return where they drew each body).

import { BODIES } from './catalog.js';
import { dateFromJD } from './ephem.js';
import { R_SUN_AU } from './frames.js';
import { tr } from './i18n.js';
import { liveFacts, perihelia } from './bodyinfo.js';
import { INSTRUMENTS } from './instruments.js';
import { layersAt, hvUrl } from './helioviewer.js';

const $ = (id) => document.getElementById(id);
const sgn = (v, d = 2) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}°`;
const minute = (jd) => dateFromJD(jd + 1 / 2880).toISOString().slice(0, 16).replace('T', ' ');
const fmtKm = (km) => (km >= 1e6 ? tr('{v} million km', { v: (km / 1e6).toFixed(km < 1e7 ? 2 : 1) }) : tr('{v} km', { v: Math.round(km).toLocaleString('en-US') }));

// ctx: { S, scene(), hits(), jump(jd), hide(key), coverage(key), bench, wrap }
export function initCards(ctx) {
  const tip = $('map-tip');
  const card = $('body-card');
  let openKey = null;
  const peri = new Map(); // key -> { jd, value } cache, refreshed when time moves far

  function hitAt(clientX, clientY) {
    let best = null;
    for (const h of ctx.hits()) {
      const d = Math.hypot(h.cx - clientX, h.cy - clientY);
      if (d <= h.r && (!best || d < best.d)) best = { ...h, d };
    }
    return best;
  }

  function nearFleet(sc) {
    return sc.bodies.filter((b) => BODIES[b.key].near && !ctx.S.hidden.has(b.key)).map((b) => b.key);
  }

  function hover(clientX, clientY) {
    const sc = ctx.scene();
    const h = sc && hitAt(clientX, clientY);
    $('map').classList.toggle('over-body', !!h);
    if (!h) { tip.hidden = true; return; }
    const b = sc.bodies.find((x) => x.key === h.key);
    if (!b) { tip.hidden = true; return; }
    const meta = BODIES[h.key];
    const near = h.key === 'earth' ? nearFleet(sc) : [];
    const line = h.key === 'earth'
      ? `r ${b.dist.toFixed(3)} au · B0 ${sgn(b.lat, 1)}`
      : `r ${b.dist.toFixed(3)} au · HGS ${sgn(b.lon, 1)} · ∠${BODIES.earth.short} ${b.sep.toFixed(1)}°`;
    tip.innerHTML = `<b>${meta.name}</b><span>${line}</span>${near.length ? `<span>+ ${near.map((k) => BODIES[k].tag).join(' · ')}</span>` : ''}<span>${tr('Click for details')}</span>`;
    tip.hidden = false;
    const box = ctx.wrap.getBoundingClientRect();
    const x = clientX - box.left;
    const y = clientY - box.top;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(8, x + 14), box.width - tw - 8)}px`;
    tip.style.top = `${Math.max(8, y - tip.offsetHeight - 12)}px`;
  }

  function leave() {
    tip.hidden = true;
    $('map').classList.remove('over-body');
  }

  function click(clientX, clientY) {
    const h = hitAt(clientX, clientY);
    if (!h) return false;
    open(h.key);
    return true;
  }

  async function loadPerihelia(key, jd) {
    const c = peri.get(key);
    if (c && Math.abs(c.jd - jd) < 60) return c.value;
    const value = await perihelia(key, jd);
    peri.set(key, { jd, value });
    return value;
  }

  function render() {
    const sc = ctx.scene();
    if (!openKey || !sc) return;
    const key = openKey;
    const meta = BODIES[key];
    const f = liveFacts(key, sc);
    if (!f) {
      card.innerHTML = `${head(meta)}<p class="card-flag">${tr('{name} is not on the map at this moment.', { name: meta.name })}</p>`;
      wire(key);
      return;
    }
    const earthSun = 2 * Math.asin(R_SUN_AU / sc.earth.reduce((a, v) => a + v * v, 0) ** 0.5) * 180 / Math.PI;
    const flag = f.st === 'lost' ? tr('Contact lost 2014-10-01; this position is a prediction.')
      : f.st === 'approx' ? tr('Past its ephemeris; shown at Earth, as SDO stays in geosynchronous orbit.')
        : meta.near ? tr('Near Earth: drawn with Earth on the map; see the near-Earth panel for its orbit.') : '';
    const rows = [
      [tr('Distance from the Sun'), `${f.dist.toFixed(4)} au · ${fmtKm(f.distKm)}`],
      [tr('HGS longitude, latitude'), `${sgn(f.lon)}, ${sgn(f.lat)}`],
      [tr('Carrington longitude'), `${f.carr.toFixed(2)}°`],
    ];
    if (key !== 'earth') {
      rows.push([tr('Angle from Earth (Sun-centred)'), `${f.sep.toFixed(2)}°`]);
      rows.push([tr('Distance to Earth'), `${f.dEarth.toFixed(4)} au · ${tr('{m} light-minutes', { m: f.lightMin.toFixed(1) })}`]);
      rows.push([tr('Sun–spacecraft–Earth angle'), `${f.spe.toFixed(2)}°`]);
    }
    if (f.speed !== null) rows.push([tr('Heliocentric speed'), tr('{v} km/s', { v: f.speed.toFixed(1) })]);
    rows.push([tr('Sun’s apparent diameter'), `${f.sunDiameter.toFixed(2)}° (${tr('{x}× as seen from Earth', { x: (f.sunDiameter / earthSun).toFixed(2) })})`]);
    rows.push([tr('Previous perihelion'), '<span id="peri-prev">…</span>']);
    rows.push([tr('Next perihelion'), '<span id="peri-next">…</span>']);
    if (meta.launch) rows.push([tr('Launched'), meta.launch.slice(0, 10)]);
    const hasPeri = !(meta.near || key === 'earth');
    const near = key === 'earth' ? nearFleet(sc) : [];
    card.innerHTML = `
      ${head(meta)}
      ${flag ? `<p class="card-flag">${flag}</p>` : ''}
      <dl class="card-facts">${rows.filter((r) => hasPeri || !r[1].includes('peri-')).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
      ${near.length ? `<div class="card-near"><span>${tr('Near Earth:')}</span>${near.map((k) => `<button data-open="${k}">${BODIES[k].short}</button>`).join('')}</div>` : ''}
      ${INSTRUMENTS.some((i) => i.sc === key) ? `<div class="card-fov"><span>${tr('Fields of view:')}</span>${INSTRUMENTS.filter((i) => i.sc === key).map((i) => `<button data-fov="${i.id}" aria-pressed="${ctx.S.fov.has(i.id)}">${i.name}</button>`).join('')}</div>` : ''}
      <div class="card-actions">
        <button data-act="coverage">${tr('Its view of the Sun')}</button>
        <button data-act="align">${tr('Find alignments')}</button>
        <button data-act="series">${tr('Export its positions')}</button>
        ${key !== 'earth' ? `<button data-act="hide">${tr('Hide on map')}</button>` : ''}
      </div>
      ${layersAt(key, sc.jd).length ? `<div class="card-links card-hv"><span>${tr('Images in Helioviewer:')}</span>${layersAt(key, sc.jd).map((l) => `<a href="${hvUrl(sc.jd, l)}" target="_blank" rel="noopener">${l.label}</a>`).join('')}</div>` : ''}
      ${meta.site ? `<div class="card-links"><a href="${meta.site}" target="_blank" rel="noopener">${tr('Mission page')}</a>${meta.data ? `<a href="${meta.data}" target="_blank" rel="noopener">${tr('Data archive')}</a>` : ''}</div>` : ''}`;
    wire(key);
    if (hasPeri) {
      const jd = sc.jd;
      loadPerihelia(key, jd).then((p) => {
        if (openKey !== key) return;
        const fill = (id, e) => {
          const el = $(id);
          if (!el) return;
          if (!e) { el.textContent = tr('outside the ephemeris'); return; }
          el.innerHTML = `<button class="peri-jump" data-jd="${e.jd}">${minute(e.jd)}</button> · ${e.r.toFixed(4)} au`;
        };
        fill('peri-prev', p.prev);
        fill('peri-next', p.next);
        card.querySelectorAll('.peri-jump').forEach((b) => b.addEventListener('click', () => ctx.jump(+b.dataset.jd)));
      });
    }
  }

  function head(meta) {
    const kind = meta.kind === 'planet' ? 'planet' : 'sc';
    return `<div class="card-head"><span class="lg-mark ${kind}" style="--c:var(--c-${openKey})"></span>
      <h3>${meta.name}<small>${meta.agency ?? tr('Planet')}</small></h3>
      <button class="card-close" id="card-close" aria-label="${tr('Close')}">✕</button></div>`;
  }

  function wire(key) {
    $('card-close').addEventListener('click', close);
    card.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => open(b.dataset.open)));
    card.querySelectorAll('[data-fov]').forEach((b) => b.addEventListener('click', () => ctx.toggleFov(b.dataset.fov)));
    card.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'coverage') ctx.coverage(key);
      if (act === 'align') ctx.bench.alignWith(key);
      if (act === 'series') ctx.bench.seriesFor(key);
      if (act === 'hide') { ctx.hide(key); close(); }
    }));
  }

  function open(key) {
    openKey = key;
    card.hidden = false;
    leave();
    render();
  }

  function close() {
    openKey = null;
    card.hidden = true;
    ctx.coverage(null, false);
  }

  return { hover, leave, click, refresh: render, close, isOpen: () => !!openKey, open };
}
