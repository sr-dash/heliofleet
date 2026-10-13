// Solar coverage: which longitudes along the solar equator each observer can
// see at the current moment, in Stonyhurst (Earth-centred) or Carrington
// longitude. A point at longitude phi on the equator faces an observer at
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
    lon: earth.lon, lat: earth.lat, dist: earth.dist, members: near.map((b) => b.key),
  }];
  for (const b of scene.bodies) {
    const m = BODIES[b.key];
    if (m.kind !== 'sc' || m.near || hidden.has(b.key)) continue;
    rows.push({ key: b.key, label: m.short, lon: b.lon, lat: b.lat, dist: b.dist, lost: b.st === 'lost' });
  }
  for (const r of rows) {
    r.full = halfWidth(R_SUN_AU / r.dist, r.lat);
    r.core = halfWidth(0.5, r.lat);
  }
  return rows;
}

// Observer counts in 1-degree Stonyhurst bins, and the share of the
// equator seen at all and seen well.
export function coverageSummary(rows) {
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

// opts: { sys: 'stonyhurst' | 'carrington', L0 (Earth's Carrington longitude),
//         spotLon (Stonyhurst, or null), highlight (row key), k }
export function drawCoverage(ctx, W, H, rows, sum, th, opts) {
  const k = opts.k ?? 1;
  const LEFT = Math.min(170 * k, W * 0.32);
  const RIGHT = 12 * k;
  const TOP = 6 * k;
  const ROW = 18 * k;
  const plotW = W - LEFT - RIGHT;
  const carr = opts.sys === 'carrington';
  // x position of a Stonyhurst longitude
  const x = (stony) => {
    const v = carr ? wrap360(stony + opts.L0) / 360 : (wrap180(stony) + 180) / 360;
    return LEFT + v * plotW;
  };
  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'middle';

  // Grid every 30 degrees and the axis labels
  const axisY = TOP + ROW * (rows.length + 1) + 8 * k;
  ctx.font = `${10 * k}px ${FONT_MONO}`;
  ctx.textAlign = 'center';
  for (let a = 0; a <= 360; a += 30) {
    const xx = LEFT + (a / 360) * plotW;
    ctx.strokeStyle = th.grid;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(xx, TOP); ctx.lineTo(xx, axisY - 4 * k); ctx.stroke();
    if (a % 60 === 0) {
      ctx.fillStyle = th.muted;
      ctx.fillText(`${carr ? a : a - 180}°`, xx, axisY + 4 * k);
    }
  }
  if (!carr) {
    ctx.fillStyle = th.muted;
    ctx.font = `${10 * k}px ${FONT_SANS}`;
    ctx.fillText(tr('Earth-facing'), x(0), axisY + 17 * k);
    ctx.textAlign = 'left';
    ctx.fillText(tr('far side'), LEFT + 2 * k, axisY + 17 * k);
    ctx.textAlign = 'right';
    ctx.fillText(tr('far side'), W - RIGHT - 2 * k, axisY + 17 * k);
  } else {
    ctx.fillStyle = th.muted;
    ctx.font = `${10 * k}px ${FONT_SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText(tr('Carrington longitude'), LEFT + plotW / 2, axisY + 17 * k);
  }

  // A band from lon-w to lon+w on the axis, drawn with its copies shifted by
  // 360 degrees and clipped, so ranges crossing the axis ends wrap round.
  const [lo, hi] = carr ? [0, 360] : [-180, 180];
  const axisVal = (stony) => (carr ? wrap360(stony + opts.L0) : wrap180(stony));
  const px = (v) => LEFT + ((v - lo) / 360) * plotW;
  const band = (lon, w, y, h) => {
    if (w <= 0) return;
    const c = axisVal(lon);
    for (const shift of [-360, 0, 360]) {
      const a0 = Math.max(lo, c - w + shift);
      const a1 = Math.min(hi, c + w + shift);
      if (a1 > a0) ctx.fillRect(px(a0), y, px(a1) - px(a0), h);
    }
  };

  rows.forEach((r, i) => {
    const y = TOP + i * ROW;
    const col = th.color[r.key];
    const hl = opts.highlight === r.key;
    if (hl) {
      ctx.fillStyle = th.accent;
      ctx.globalAlpha = 0.12;
      ctx.fillRect(0, y, W, ROW);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = r.lost ? th.muted : col;
    ctx.font = `${hl ? 700 : 600} ${11.5 * k}px ${FONT_SANS}`;
    ctx.textAlign = 'right';
    ctx.fillText(r.label, LEFT - 10 * k, y + ROW / 2, LEFT - 14 * k);
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.3;
    band(r.lon, r.full, y + 3 * k, ROW - 6 * k);
    ctx.globalAlpha = r.lost ? 0.45 : 0.85;
    band(r.lon, r.core, y + 3 * k, ROW - 6 * k);
    ctx.globalAlpha = 1;
    // Sub-observer point
    ctx.fillStyle = th.ink;
    ctx.fillRect(x(r.lon) - 1, y + 2 * k, 2, ROW - 4 * k);
  });

  // Combined row: how many observers see each degree; gaps in red
  const y = TOP + rows.length * ROW;
  ctx.fillStyle = th.ink;
  ctx.font = `600 ${11.5 * k}px ${FONT_SANS}`;
  ctx.textAlign = 'right';
  ctx.fillText(tr('Fleet coverage'), LEFT - 10 * k, y + ROW / 2, LEFT - 14 * k);
  const maxN = Math.max(1, ...sum.seen);
  // Walk the axis left to right in 1-degree steps and draw each run of equal
  // observer count as one block (no seams, and Carrington order wraps right).
  const countAt = (v) => sum.seen[Math.min(359, Math.max(0, Math.floor((carr ? wrap180(v - opts.L0) : v) + 180)))];
  let runStart = lo;
  let runN = countAt(lo + 0.5);
  for (let v = lo + 1; v <= hi; v++) {
    const n = v < hi ? countAt(v + 0.5) : -1;
    if (n === runN) continue;
    if (runN === 0) {
      ctx.fillStyle = '#E5484D';
      ctx.globalAlpha = 0.75;
    } else {
      ctx.fillStyle = th.accent;
      ctx.globalAlpha = 0.2 + 0.7 * (runN / maxN);
    }
    ctx.fillRect(px(runStart), y + 3 * k, px(v) - px(runStart), ROW - 6 * k);
    runStart = v;
    runN = n;
  }
  ctx.globalAlpha = 1;

  // Marked spot
  if (opts.spotLon !== null && opts.spotLon !== undefined) {
    const sx = x(opts.spotLon);
    ctx.strokeStyle = th.accent;
    ctx.lineWidth = 2;
    ctx.setLineDash([3 * k, 3 * k]);
    ctx.beginPath(); ctx.moveTo(sx, TOP); ctx.lineTo(sx, y + ROW); ctx.stroke();
    ctx.setLineDash([]);
  }
  return { left: LEFT, right: W - RIGHT, top: TOP, rowH: ROW, rows: rows.length, toStony: (px) => {
    const v = (px - LEFT) / plotW;
    return carr ? wrap180(v * 360 - opts.L0) : v * 360 - 180;
  } };
}

export const coverageHeight = (n, k = 1) => (6 + 18 * (n + 1) + 8 + 28) * k;
