// Solar coverage: a map of the solar surface showing what each observer with
// a solar-disk imager can see at the current moment, over an HMI synoptic
// magnetogram, and summary numbers along the solar equator. A point at longitude phi on the equator faces an observer at
// heliographic longitude L, latitude B and distance r when
//   cos(B) cos(phi - L) > R_sun / r,
// and is well placed (mu > 0.5, within 60 deg of disk centre) when
//   cos(B) cos(phi - L) > 0.5   (for r >> R_sun).

import { BODIES } from './catalog.js';
import { R_SUN_AU } from './frames.js';
import { tr } from './i18n.js';

const D = Math.PI / 180;
const FONT_SANS = '"Instrument Sans", "Noto Sans Devanagari", system-ui, sans-serif';
const FONT_MONO = '"IBM Plex Mono", ui-monospace, monospace';
const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
const wrap360 = (a) => ((a % 360) + 360) % 360;

function halfWidth(cosLimit, B) {
  const c = cosLimit / Math.max(1e-6, Math.cos(B * D));
  return c >= 1 ? 0 : Math.acos(Math.max(-1, c)) / D;
}

// Observers: Earth with the near-Earth fleet as one row, then each
// deep-space spacecraft on the map.
export function coverageRows(scene, hidden) {
  const earth = scene.bodies.find((b) => b.key === 'earth');
  const near = scene.bodies.filter((b) => BODIES[b.key].near && !hidden.has(b.key));
  const rows = [{
    key: 'earth', label: near.length ? tr('Earth & near-Earth fleet') : BODIES.earth.short,
    lon: earth.lon, lat: earth.lat, dist: earth.dist, members: near.map((b) => b.key), imager: true,
  }];
  for (const b of scene.bodies) {
    const m = BODIES[b.key];
    // A spacecraft out of contact (STEREO-B after 2014) observes nothing
    if (m.kind !== 'sc' || m.near || hidden.has(b.key) || b.st === 'lost') continue;
    rows.push({ key: b.key, label: m.short, lon: b.lon, lat: b.lat, dist: b.dist, imager: !!m.imager });
  }
  for (const r of rows) {
    r.full = halfWidth(R_SUN_AU / r.dist, r.lat);
    r.core = halfWidth(0.5, r.lat);
  }
  return rows;
}

// Observer counts in 1-degree Stonyhurst bins, and the share of the
// equator seen at all and seen well. Only observers with a solar-disk imager
// count; the others are drawn for their geometry alone.
export function coverageSummary(allRows) {
  const rows = allRows.filter((r) => r.imager);
  const seen = new Array(360).fill(0);
  const well = new Array(360).fill(0);
  for (let i = 0; i < 360; i++) {
    const phi = i - 179.5;
    for (const r of rows) {
      const d = Math.abs(wrap180(phi - r.lon));
      if (d < r.full) seen[i]++;
      if (d < r.core) well[i]++;
    }
  }
  const pct = (a) => Math.round((100 * a.filter((n) => n > 0).length) / 360);
  // Largest unobserved arc, for the summary sentence
  let best = null;
  for (let i = 0; i < 360; i++) {
    if (seen[i] || seen[(i + 359) % 360] === 0) continue;
    let n = 0;
    while (n < 360 && seen[(i + n) % 360] === 0) n++;
    if (!best || n > best.n) best = { n, start: i - 179.5 };
  }
  return {
    seen, well, pctSeen: pct(seen), pctWell: pct(well),
    gap: best && best.n < 360 ? { width: best.n, centre: wrap180(best.start + best.n / 2) } : null,
  };
}

// ---------- solar surface map ----------
// An SDO/HMI synoptic magnetogram on its native grid (Carrington longitude
// and sine latitude, built by scripts/fetch_synoptic.py), with the limb of
// every observer that carries a solar-disk imager. Earth's limb is the dark
// curve; hovering shades the near or far side as seen from Earth.

const CLIP = 20; // gauss; the colour range is fixed at +/-20 G
let SYN = null;
const maps = new Map(); // file -> Promise<{ vals, img }>

export async function loadSynopticIndex() {
  try {
    const r = await fetch('data/synoptic/index.json', { cache: 'no-cache' });
    SYN = r.ok ? await r.json() : null;
  } catch { SYN = null; }
  return SYN;
}

// The map covering jd: the Carrington rotation map, else the daily-updated
// frame for the rotation in progress, else null (future dates, data gaps).
export function synopticFor(jd) {
  if (!SYN) return null;
  const m = SYN.maps.find((x) => jd >= x.t0 && jd < x.t1);
  if (m) return m;
  const d = SYN.daily;
  return d && jd >= d.t0 && jd <= d.t1 ? { ...d, daily: true } : null;
}

// matplotlib 'bwr': blue (-20 G) through white (0) to red (+20 G)
function bwr(t) {
  return t < 0.5 ? [2 * t, 2 * t, 1] : [1, 2 * (1 - t), 2 * (1 - t)];
}

export function loadSynoptic(m) {
  if (!m) return Promise.resolve(null);
  if (!maps.has(m.file)) {
    const v = SYN?.generated ? `?v=${encodeURIComponent(SYN.generated)}` : '';
    maps.set(m.file, new Promise((resolve) => {
      const im = new Image();
      im.onload = () => {
        const c = document.createElement('canvas');
        c.width = im.width;
        c.height = im.height;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(im, 0, 0);
        const px = g.getImageData(0, 0, c.width, c.height);
        const vals = new Uint8Array(c.width * c.height);
        for (let i = 0; i < vals.length; i++) {
          const q = px.data[4 * i];
          vals[i] = q;
          if (!q) { px.data[4 * i + 3] = 0; continue; }
          const [r, gg, b] = bwr((q - 1) / 254);
          px.data[4 * i] = r * 255;
          px.data[4 * i + 1] = gg * 255;
          px.data[4 * i + 2] = b * 255;
          px.data[4 * i + 3] = 255;
        }
        g.putImageData(px, 0, 0);
        resolve({ vals, img: c, w: c.width, h: c.height });
      };
      im.onerror = () => resolve(null);
      im.src = `data/synoptic/${m.file}${v}`;
    }));
  }
  return maps.get(m.file);
}

// Field (G) at a Carrington longitude and latitude, or null; |B| = 20 means "at least"
export function fieldAt(map, carr, lat) {
  if (!map) return null;
  const i = Math.min(map.w - 1, Math.floor((wrap360(carr) / 360) * map.w));
  const j = Math.min(map.h - 1, Math.floor(((1 - Math.sin(lat * D)) / 2) * map.h));
  const q = map.vals[j * map.w + i];
  return q ? ((q - 1) / 254) * 2 * CLIP - CLIP : null;
}

// Cosine of the angle between a surface point and an observer's direction,
// and the cosine at that observer's limb
const cosToward = (carr, lat, o) => Math.sin(lat * D) * Math.sin(o.lat * D)
  + Math.cos(lat * D) * Math.cos(o.lat * D) * Math.cos((carr - o.carr) * D);
const limbCos = (o) => R_SUN_AU / o.dist;

// Observers drawn on the surface map: those with a solar-disk imager
export function surfaceObservers(rows, L0) {
  return rows.filter((r) => r.imager).map((r) => ({ ...r, carr: wrap360(r.lon + L0) }));
}

// Who sees a surface point: [{ key, label, mu }] with mu the cosine of the
// angle from that observer's disk centre
export function seenBy(obs, carr, lat) {
  return obs.map((o) => ({ ...o, mu: cosToward(carr, lat, o) })).filter((o) => o.mu > limbCos(o));
}

export const surfaceHeight = (W, k = 1) => Math.round((W - (46 + 74) * k) / 2.2 + (10 + 34) * k);

// opts: { sys: 'stonyhurst' | 'carrington', L0, map (from loadSynoptic) or null,
//         meta (from synopticFor) or null, spot { carr, lat } or null,
//         hover { carr, lat } or null, highlight (row key), k }
export function drawSurface(ctx, W, H, rows, th, opts) {
  const k = opts.k ?? 1;
  const LEFT = 46 * k;
  const RIGHT = 74 * k;
  const TOP = 10 * k;
  const pw = W - LEFT - RIGHT;
  const ph = Math.round(pw / 2.2);
  const carr = opts.sys === 'carrington';
  const L0 = opts.L0;
  // Plot position of a Carrington longitude (0..1) and of a latitude
  const fx = (c) => (carr ? wrap360(c) / 360 : (wrap180(c - L0) + 180) / 360);
  const X = (c) => LEFT + fx(c) * pw;
  const Y = (lat) => TOP + ((1 - Math.sin(lat * D)) / 2) * ph;
  // Carrington longitude at the left edge of the plot
  const c0 = carr ? 0 : wrap360(L0 - 180);
  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.beginPath();
  ctx.rect(LEFT, TOP, pw, ph);
  ctx.clip();
  // Draws a 360-wide Carrington image so it starts at the plot's left edge
  const shifted = (img) => {
    const off = (c0 / 360) * pw;
    ctx.drawImage(img, LEFT - off, TOP, pw, ph);
    ctx.drawImage(img, LEFT - off + pw, TOP, pw, ph);
  };
  if (opts.map) {
    ctx.imageSmoothingEnabled = false;
    shifted(opts.map.img);
    ctx.imageSmoothingEnabled = true;
  } else {
    ctx.fillStyle = th.grid;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(LEFT, TOP, pw, ph);
    ctx.globalAlpha = 1;
    ctx.fillStyle = th.muted;
    ctx.font = `500 ${12 * k}px ${FONT_SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tr(opts.future ? 'No magnetogram yet for this date' : 'No HMI synoptic map for this date'), LEFT + pw / 2, TOP + ph * 0.86);
  }

  const obs = surfaceObservers(rows, L0);
  const earth = obs.find((o) => o.key === 'earth');

  // Near or far side under the pointer, shaded
  if (opts.hover && earth) {
    const near = cosToward(opts.hover.carr, opts.hover.lat, earth) > limbCos(earth);
    const c = document.createElement('canvas');
    c.width = 180;
    c.height = 90;
    const g = c.getContext('2d');
    const im = g.createImageData(c.width, c.height);
    const shade = near ? [255, 214, 102] : [40, 48, 80];
    for (let j = 0; j < c.height; j++) {
      const lat = Math.asin(1 - (2 * (j + 0.5)) / c.height) / D;
      for (let i = 0; i < c.width; i++) {
        const cc = ((i + 0.5) / c.width) * 360;
        const isNear = cosToward(cc, lat, earth) > limbCos(earth);
        if (isNear !== near) continue;
        const p = 4 * (j * c.width + i);
        im.data[p] = shade[0]; im.data[p + 1] = shade[1]; im.data[p + 2] = shade[2]; im.data[p + 3] = near ? 46 : 64;
      }
    }
    g.putImageData(im, 0, 0);
    shifted(c);
  }

  // Grid: every 30 degrees of longitude, and latitudes 0, +/-30, +/-60
  ctx.strokeStyle = th.ink;
  ctx.globalAlpha = 0.18;
  ctx.lineWidth = 1;
  for (let a = 30; a < 360; a += 30) {
    const x = LEFT + (a / 360) * pw;
    ctx.beginPath(); ctx.moveTo(x, TOP); ctx.lineTo(x, TOP + ph); ctx.stroke();
  }
  for (const lat of [-60, -30, 0, 30, 60]) {
    ctx.beginPath(); ctx.moveTo(LEFT, Y(lat)); ctx.lineTo(LEFT + pw, Y(lat)); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Limb of each imaging observer: the circle at angle acos(R_sun / r) from
  // its disk centre, drawn as a polyline that breaks where it wraps round
  const limb = (o, color, width, dash) => {
    const rho = Math.acos(Math.min(1, limbCos(o)));
    const B = o.lat * D;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    let prev = null;
    for (let i = 0; i <= 240; i++) {
      const psi = (2 * Math.PI * i) / 240;
      const sl = Math.sin(B) * Math.cos(rho) + Math.cos(B) * Math.sin(rho) * Math.cos(psi);
      const lat = Math.asin(Math.max(-1, Math.min(1, sl)));
      const dl = Math.atan2(Math.sin(psi) * Math.sin(rho) * Math.cos(B), Math.cos(rho) - Math.sin(B) * sl);
      const f = fx(o.carr + dl / D);
      const x = LEFT + f * pw;
      const y = Y(lat / D);
      if (prev === null || Math.abs(f - prev) > 0.5) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      prev = f;
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };
  for (const o of obs) {
    if (o.key === 'earth') continue;
    const hl = opts.highlight === o.key;
    limb(o, th.color[o.key], (hl ? 2.6 : 1.6) * k, hl ? [] : [5 * k, 3 * k]);
  }
  if (earth) limb(earth, th.ink, (opts.highlight === 'earth' ? 3 : 2.2) * k, []);

  // Disk centres, labelled
  const labels = [];
  for (const o of obs) {
    const x = X(o.carr);
    const y = Y(o.lat);
    ctx.fillStyle = o.key === 'earth' ? th.ink : th.color[o.key];
    ctx.strokeStyle = th.bg;
    ctx.lineWidth = 1.5 * k;
    ctx.beginPath();
    ctx.arc(x, y, 4.5 * k, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    labels.push({ x, y, text: o.key === 'earth' ? BODIES.earth.short : o.label, color: o.key === 'earth' ? th.ink : th.color[o.key] });
  }
  ctx.font = `600 ${11 * k}px ${FONT_SANS}`;
  ctx.textBaseline = 'middle';
  labels.sort((a, b) => a.y - b.y);
  let lastY = -Infinity;
  for (const l of labels) {
    const y = Math.max(l.y - 12 * k, lastY + 14 * k);
    lastY = y;
    const w = ctx.measureText(l.text).width + 6 * k;
    const x = Math.min(l.x + 6 * k, LEFT + pw - w);
    ctx.fillStyle = th.bg;
    ctx.globalAlpha = 0.8;
    ctx.fillRect(x, y - 7 * k, w, 14 * k);
    ctx.globalAlpha = 1;
    ctx.fillStyle = l.color;
    ctx.textAlign = 'left';
    ctx.fillText(l.text, x + 3 * k, y);
  }

  // Marked spot
  if (opts.spot) {
    const x = X(opts.spot.carr);
    const y = Y(opts.spot.lat);
    ctx.strokeStyle = th.accent;
    ctx.lineWidth = 2 * k;
    ctx.beginPath();
    ctx.moveTo(x - 7 * k, y); ctx.lineTo(x + 7 * k, y);
    ctx.moveTo(x, y - 7 * k); ctx.lineTo(x, y + 7 * k);
    ctx.stroke();
  }

  // Map source, top left
  if (opts.meta) {
    const text = opts.meta.daily ? tr('HMI daily synoptic frame, rotation {cr}', { cr: opts.meta.cr }) : tr('HMI synoptic map, Carrington rotation {cr}', { cr: opts.meta.cr });
    ctx.font = `500 ${10.5 * k}px ${FONT_SANS}`;
    const w = ctx.measureText(text).width + 8 * k;
    ctx.fillStyle = th.bg;
    ctx.globalAlpha = 0.8;
    ctx.fillRect(LEFT + 4 * k, TOP + 4 * k, w, 15 * k);
    ctx.globalAlpha = 1;
    ctx.fillStyle = th.ink;
    ctx.textAlign = 'left';
    ctx.fillText(text, LEFT + 8 * k, TOP + 11.5 * k);
  }
  ctx.restore();

  // Frame and axes
  ctx.strokeStyle = th.line;
  ctx.lineWidth = 1;
  ctx.strokeRect(LEFT + 0.5, TOP + 0.5, pw - 1, ph - 1);
  ctx.fillStyle = th.muted;
  ctx.font = `${10 * k}px ${FONT_MONO}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  for (let a = 0; a <= 360; a += 60) {
    ctx.fillText(`${carr ? a : a - 180}°`, LEFT + (a / 360) * pw, TOP + ph + 4 * k);
  }
  ctx.font = `${10 * k}px ${FONT_SANS}`;
  ctx.fillText(tr(carr ? 'Carrington longitude' : 'Stonyhurst longitude (0° faces Earth)'), LEFT + pw / 2, TOP + ph + 18 * k);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = `${10 * k}px ${FONT_MONO}`;
  for (const lat of [-60, -30, 0, 30, 60]) ctx.fillText(`${lat > 0 ? '+' : ''}${lat}°`, LEFT - 5 * k, Y(lat));

  // Colour bar, fixed at +/-20 G
  const bx = LEFT + pw + 16 * k;
  const bw = 12 * k;
  for (let i = 0; i < ph; i++) {
    const [r, g, b] = bwr(1 - i / ph);
    ctx.fillStyle = `rgb(${r * 255},${g * 255},${b * 255})`;
    ctx.fillRect(bx, TOP + i, bw, 1.5);
  }
  ctx.strokeStyle = th.line;
  ctx.strokeRect(bx + 0.5, TOP + 0.5, bw - 1, ph - 1);
  ctx.fillStyle = th.muted;
  ctx.textAlign = 'left';
  ctx.font = `${10 * k}px ${FONT_MONO}`;
  ctx.fillText(`+${CLIP}`, bx + bw + 4 * k, TOP + 5 * k);
  ctx.fillText('0', bx + bw + 4 * k, TOP + ph / 2);
  ctx.fillText(`−${CLIP}`, bx + bw + 4 * k, TOP + ph - 5 * k);
  ctx.fillText('G', bx + bw + 4 * k, TOP + ph / 4);

  return {
    left: LEFT, right: LEFT + pw, top: TOP, bottom: TOP + ph, obs,
    // Carrington longitude and latitude under a canvas point, or null
    at: (px, py) => {
      if (px < LEFT || px > LEFT + pw || py < TOP || py > TOP + ph) return null;
      const c = wrap360(c0 + ((px - LEFT) / pw) * 360);
      const lat = Math.asin(Math.max(-1, Math.min(1, 1 - (2 * (py - TOP)) / ph))) / D;
      return { carr: c, lat };
    },
  };
}

// The sentence under the strip. sys: 'stonyhurst' | 'carrington'.
export function coverageNote(sum, sys, L0, withHint = true) {
  const name = tr(sys === 'carrington' ? 'Carrington' : 'Stonyhurst');
  const gapLon = sum.gap ? (sys === 'carrington' ? wrap360(sum.gap.centre + L0) : sum.gap.centre) : null;
  return [
    tr('Along the solar equator, solar imagers see <b>{seen}%</b> of the Sun, and <b>{well}%</b> within 60° of some observer’s disk centre.', { seen: sum.pctSeen, well: sum.pctWell }),
    sum.gap ? tr('The largest unseen stretch is <b>{width}°</b> wide, centred at {sys} {lon}°.', { width: sum.gap.width, sys: name, lon: gapLon.toFixed(0) }) : tr('No longitude on the equator is hidden from every observer.'),
    withHint ? tr('The background is the SDO/HMI synoptic radial magnetic field (blue negative, red positive, fixed at ±20 G). The dark curve is Earth’s limb and the dashed curves are the limbs of other spacecraft with a solar-disk imager. Hover to shade the near or far side and see who observes a point; click to mark it.') : '',
  ].filter(Boolean).join(' ');
}
