// Timeline ribbon: one lane per spacecraft showing where ephemerides exist,
// eclipses above, space-weather events below, and a draggable cursor.

import { BODIES, SPACECRAFT, ECLIPSES, MILESTONES, SPACE_WEATHER } from './catalog.js';
import { info } from './ephem.js';

const NS = 'http://www.w3.org/2000/svg';
const jdOf = (iso) => Date.parse(iso) / 864e5 + 2440587.5;
const yearJD = (y) => Date.UTC(y, 0, 1) / 864e5 + 2440587.5;
const fmt = (iso) => iso.replace('T', ' ').replace('Z', ' UT');

function el(name, attrs = {}, parent) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
}

export function createRibbon(svg, tip, { start, end, onScrub, onPick }) {
  let W = 0;
  let cursor;
  let cursorLabel;
  let cursorBg;
  let current = start;
  const H = 168;
  let LEFT = 96;
  const RIGHT = 14;
  const ROW_ECL = 18;
  const LANE0 = 44;
  const LANE_DY = 14;
  const ROW_SW = LANE0 + LANE_DY * SPACECRAFT.length + 6;
  const AXIS = H - 16;

  const x = (jd) => LEFT + ((jd - start) / (end - start)) * (W - LEFT - RIGHT);
  const jdAt = (px) => start + ((px - LEFT) / (W - LEFT - RIGHT)) * (end - start);
  const clamp = (jd) => Math.min(end, Math.max(start, jd));

  function showTip(evt, html) {
    tip.innerHTML = html;
    tip.hidden = false;
    const box = svg.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const px = evt.clientX - box.left;
    tip.style.left = `${Math.min(Math.max(px - tw / 2, 0), box.width - tw)}px`;
    tip.style.top = `${evt.clientY - box.top > H / 2 ? 4 : H - tip.offsetHeight - 4}px`;
  }
  const hideTip = () => { tip.hidden = true; };

  function marker(g, iso, html) {
    g.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      onPick(jdOf(iso));
    });
    g.addEventListener('pointerenter', (e) => showTip(e, html));
    g.addEventListener('pointerleave', hideTip);
    g.style.cursor = 'pointer';
  }

  function draw() {
    W = svg.clientWidth;
    if (!W) return;
    const narrow = W < 640;
    LEFT = narrow ? 58 : 108;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.replaceChildren();
    const muted = 'var(--muted)';

    // Year grid and axis
    const today = Date.now() / 864e5 + 2440587.5;
    const y0 = new Date((start - 2440587.5) * 864e5).getUTCFullYear();
    const y1 = new Date((end - 2440587.5) * 864e5).getUTCFullYear();
    const every = W < 640 ? 5 : W < 1000 ? 2 : 1;
    for (let y = y0; y <= y1 + 1; y++) {
      const xx = x(yearJD(y));
      if (xx < LEFT - 1 || xx > W - RIGHT + 1) continue;
      el('line', { x1: xx, x2: xx, y1: 8, y2: AXIS, stroke: 'var(--grid)', 'stroke-width': 1 }, svg);
      if (y % every === 0 && xx < W - RIGHT - 10) {
        el('text', { x: xx + 3, y: AXIS + 11, fill: muted, 'font-size': 10.5 }, svg).textContent = y;
      }
    }
    el('line', { x1: LEFT, x2: W - RIGHT, y1: AXIS, y2: AXIS, stroke: 'var(--line)' }, svg);

    // Future shading: beyond today everything is a predicted trajectory
    if (today < end) {
      el('rect', {
        x: x(today), y: 8, width: x(end) - x(today), height: AXIS - 8,
        fill: 'var(--ink)', opacity: 0.035,
      }, svg);
      if (x(end) - x(today) > 74) {
        el('text', { x: x(today) + 4, y: AXIS - 4, fill: muted, 'font-size': 10 }, svg).textContent = 'predicted →';
      }
    }

    // Row labels
    const lbl = (text, yy, fill = muted) => {
      el('text', { x: LEFT - 10, y: yy + 3.5, 'text-anchor': 'end', fill, 'font-size': 12, style: 'font-family: "Instrument Sans", sans-serif; font-weight: 500' }, svg).textContent = text;
    };
    lbl(narrow ? 'Eclipses' : 'Total eclipses', ROW_ECL);
    lbl(narrow ? 'Events' : 'Space weather', ROW_SW);

    // Spacecraft lanes
    SPACECRAFT.forEach((key, i) => {
      const yy = LANE0 + i * LANE_DY;
      const b = BODIES[key];
      const m = info(key);
      const col = `var(--c-${key})`;
      lbl(narrow ? b.tag : b.short, yy, col);
      if (!m) return;
      const a = Math.max(start, jdOf(b.launch));
      let z = m.end;
      const segs = [];
      if (b.lost) {
        segs.push([a, jdOf(b.lost), false]);
        segs.push([jdOf(b.lost), Math.min(z, jdOf(b.ended)), true]);
      } else {
        segs.push([a, z, false]);
        if (b.fallback && z < end) segs.push([z, end, true]);
      }
      for (const [s0, s1, dashed] of segs) {
        if (s1 <= s0) continue;
        el('line', {
          x1: x(s0), x2: x(s1), y1: yy, y2: yy, stroke: col,
          'stroke-width': dashed ? 2 : 4, 'stroke-linecap': 'round',
          'stroke-dasharray': dashed ? '2 4' : 'none',
          opacity: dashed ? 0.7 : 0.9,
        }, svg);
      }
    });

    for (const mi of MILESTONES) {
      const yy = LANE0 + SPACECRAFT.indexOf(mi.body) * LANE_DY;
      const g = el('g', {}, svg);
      el('circle', { cx: x(jdOf(mi.t)), cy: yy, r: 4.5, fill: 'var(--plot-bg)', stroke: `var(--c-${mi.body})`, 'stroke-width': 2 }, g);
      el('circle', { cx: x(jdOf(mi.t)), cy: yy, r: 9, fill: 'transparent' }, g);
      marker(g, mi.t, `<b>${mi.label}</b><span>${fmt(mi.t)}</span>`);
    }

    for (const ec of ECLIPSES) {
      const g = el('g', {}, svg);
      const cx = x(jdOf(ec.t));
      el('circle', { cx, cy: ROW_ECL, r: narrow ? 5.5 : 7.5, fill: 'none', stroke: 'var(--sun)', 'stroke-width': 1.4, opacity: 0.55, 'stroke-dasharray': ec.hybrid ? '2 2' : 'none' }, g);
      el('circle', { cx, cy: ROW_ECL, r: narrow ? 3.5 : 5, fill: 'var(--plot-bg)', stroke: 'var(--sun)', 'stroke-width': 1.6 }, g);
      el('circle', { cx, cy: ROW_ECL, r: 11, fill: 'transparent' }, g);
      marker(g, ec.t, `<b>${ec.hybrid ? 'Hybrid' : 'Total'} eclipse · ${ec.label}</b><span>${fmt(ec.t)}</span><span>${ec.where}</span>`);
    }

    for (const ev of SPACE_WEATHER) {
      const g = el('g', {}, svg);
      const cx = x(jdOf(ev.t));
      el('path', { d: `M${cx} ${ROW_SW - 6} L${cx + 5} ${ROW_SW + 4} L${cx - 5} ${ROW_SW + 4} Z`, fill: 'var(--accent)' }, g);
      el('circle', { cx, cy: ROW_SW, r: 10, fill: 'transparent' }, g);
      marker(g, ev.t, `<b>${ev.label}</b><span>${fmt(ev.t)}</span><span>${ev.note}</span>`);
    }

    // Cursor
    cursor = el('g', { 'pointer-events': 'none' }, svg);
    el('line', { x1: 0, x2: 0, y1: 4, y2: AXIS + 2, stroke: 'var(--ink)', 'stroke-width': 1.5 }, cursor);
    el('path', { d: 'M-5 2 L5 2 L0 8 Z', fill: 'var(--ink)' }, cursor);
    cursorBg = el('rect', { x: -36, y: AXIS + 1, width: 72, height: 14, rx: 3, fill: 'var(--ink)' }, cursor);
    cursorLabel = el('text', { x: 0, y: AXIS + 11.5, fill: 'var(--bg)', 'font-size': 10.5, 'text-anchor': 'middle', 'font-weight': 500 }, cursor);
    set(current);
  }

  function set(jd) {
    current = jd;
    if (!cursor) return;
    const cx = x(jd);
    cursor.setAttribute('transform', `translate(${cx} 0)`);
    const d = new Date((jd - 2440587.5) * 864e5).toISOString().slice(0, 10);
    cursorLabel.textContent = d;
    const shift = cx < 40 ? 40 - cx : cx > W - 40 ? W - 40 - cx : 0;
    cursorLabel.setAttribute('x', shift);
    cursorBg.setAttribute('x', shift - 36);
    svg.setAttribute('aria-valuenow', (2000 + (jd - 2451544.5) / 365.25).toFixed(2));
    svg.setAttribute('aria-valuetext', d);
  }

  // Scrubbing
  let dragging = false;
  const fromEvent = (e) => {
    const box = svg.getBoundingClientRect();
    return clamp(jdAt(e.clientX - box.left));
  };
  svg.addEventListener('pointerdown', (e) => {
    dragging = true;
    svg.setPointerCapture(e.pointerId);
    hideTip();
    onScrub(fromEvent(e));
  });
  svg.addEventListener('pointermove', (e) => { if (dragging) onScrub(fromEvent(e)); });
  const stop = () => { dragging = false; };
  svg.addEventListener('pointerup', stop);
  svg.addEventListener('pointercancel', stop);
  svg.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, PageDown: -30, PageUp: 30 }[e.key];
    if (!step) return;
    e.preventDefault();
    onScrub(clamp(current + step * (e.shiftKey ? 30 : 1)));
  });

  new ResizeObserver(draw).observe(svg);
  return { set, draw };
}
