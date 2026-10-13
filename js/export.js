// Snapshot export: composes the map, the near-Earth inset and a coordinate
// table on one canvas, then saves it as PNG or as a single-page PDF.

import { drawMap, drawInset } from './render.js';
import { BODIES } from './catalog.js';
import { tr } from './i18n.js';

const W = 1200;
const H = 820;
const SCALE = 2;
const MONO = '"IBM Plex Mono", monospace';
const SANS = '"Instrument Sans", "Noto Sans Devanagari", sans-serif';
const DISPLAY = '"Big Shoulders Display", sans-serif';

const deg = (v, signed = true) => `${signed && v >= 0 ? '+' : ''}${v.toFixed(1)}°`;

// Draw text wrapped to width; returns the y after the last line.
function wrapText(ctx, text, x, y, width, lh) {
  let line = '';
  for (const word of text.split(' ')) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > width && line) {
      ctx.fillText(line, x, y);
      line = word;
      y += lh;
    } else line = test;
  }
  if (line) { ctx.fillText(line, x, y); y += lh; }
  return y;
}

export async function composeSnapshot(scene, s, th, view, meta) {
  await document.fonts.ready;
  const cv = document.createElement('canvas');
  cv.width = W * SCALE;
  cv.height = H * SCALE;
  const ctx = cv.getContext('2d');
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = th.page;
  ctx.fillRect(0, 0, W, H);

  // Map: square on the left
  const M = H - 40;
  ctx.save();
  ctx.translate(20, 20);
  ctx.beginPath();
  ctx.roundRect(0, 0, M, M, 12);
  ctx.clip();
  drawMap(ctx, M, M, scene, s, th, view);
  ctx.restore();
  ctx.strokeStyle = th.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(20.5, 20.5, M - 1, M - 1, 12);
  ctx.stroke();

  // Right column
  const X = M + 48;
  const CW = W - X - 28;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = th.ink;
  ctx.font = `800 44px ${DISPLAY}`;
  ctx.fillText('HELIOFLEET', X, 66);
  ctx.font = `500 26px ${MONO}`;
  ctx.fillText(meta.date, X, 108);
  const dw = ctx.measureText(meta.date).width;
  ctx.fillStyle = th.accent;
  ctx.font = `400 18px ${MONO}`;
  ctx.fillText(meta.time, X + dw + 14, 108);
  ctx.fillStyle = th.muted;
  ctx.font = `500 14px ${SANS}`;
  let y = 132;
  if (meta.context) { ctx.fillText(meta.context, X, y); y += 20; }
  ctx.fillText(meta.frame, X, y);
  y += 26;

  // Inset
  const IW = 168;
  const IH = 210;
  ctx.save();
  ctx.translate(X + CW - IW, y);
  ctx.beginPath();
  ctx.roundRect(0, 0, IW, IH, 10);
  ctx.clip();
  drawInset(ctx, IW, IH, scene, s, th);
  ctx.restore();
  ctx.strokeStyle = th.line;
  ctx.beginPath();
  ctx.roundRect(X + CW - IW + 0.5, y + 0.5, IW - 1, IH - 1, 10);
  ctx.stroke();
  ctx.fillStyle = th.muted;
  ctx.font = `600 10px ${SANS}`;
  ctx.fillText(tr('NEAR EARTH · SUN UP'), X + CW - IW + 8, y + IH + 14);

  // Legend beside the inset: deep-space fleet one per line, the near-Earth
  // group as one entry (they share Earth's spot on the map)
  let ly = y + 8;
  const LW = CW - IW - 16;
  const visible = scene.bodies.filter((b) => !s.hidden.has(b.key) && !(BODIES[b.key].kind === 'planet' && b.key !== 'earth'));
  const near = visible.filter((b) => BODIES[b.key].near);
  const mark = (key, yy) => {
    ctx.fillStyle = th.color[key];
    ctx.save();
    ctx.translate(X + 6, yy);
    if (BODIES[key].kind === 'sc') { ctx.rotate(Math.PI / 4); ctx.fillRect(-4, -4, 8, 8); }
    else { ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, 2 * Math.PI); ctx.fill(); }
    ctx.restore();
  };
  ctx.font = `600 13px ${SANS}`;
  for (const b of visible) {
    if (BODIES[b.key].near) continue;
    mark(b.key, ly);
    ctx.fillStyle = th.ink;
    ctx.fillText(BODIES[b.key].name, X + 18, ly + 4.5, LW - 18);
    ly += 19;
    if (b.key === 'earth' && near.length) {
      ctx.font = `400 12px ${SANS}`;
      ctx.fillStyle = th.muted;
      ly = wrapText(ctx, tr('with {list}', { list: near.map((n) => BODIES[n.key].short).join(', ') }), X + 18, ly + 2, LW - 18, 15) + 4;
      ctx.font = `600 13px ${SANS}`;
    }
  }

  // Coordinate table
  y += IH + 40;
  const cols = [
    [tr('Body'), 0, 'left'],
    ['r au', 0.36, 'right'],
    [tr('HGS lon'), 0.52, 'right'],
    [tr('HGS lat'), 0.68, 'right'],
    [tr('Carr.'), 0.84, 'right'],
    [tr('∠ Earth'), 1, 'right'],
  ];
  ctx.font = `500 11px ${SANS}`;
  ctx.fillStyle = th.muted;
  // Headers that do not fit their column (longer in some languages) wrap
  // onto two lines, the first word above the rest.
  for (const [t, f, a] of cols) {
    ctx.textAlign = a;
    const sp = t.indexOf(' ');
    if (sp > 0 && ctx.measureText(t).width > 0.15 * CW) {
      ctx.fillText(t.slice(0, sp), X + f * CW, y - 12);
      ctx.fillText(t.slice(sp + 1), X + f * CW, y);
    } else {
      ctx.fillText(t, X + f * CW, y);
    }
  }
  y += 8;
  ctx.strokeStyle = th.line;
  ctx.beginPath(); ctx.moveTo(X, y); ctx.lineTo(X + CW, y); ctx.stroke();
  y += 18;
  for (const b of scene.bodies) {
    if (s.hidden.has(b.key) || BODIES[b.key].kind === 'planet' && b.key !== 'earth') continue;
    const row = [
      BODIES[b.key].short + (b.st === 'lost' ? '*' : ''),
      b.dist.toFixed(3),
      deg(b.lon),
      deg(b.lat),
      deg(b.carr, false),
      b.key === 'earth' ? '—' : deg(b.sep, false),
    ];
    row.forEach((v, i) => {
      const [, f, a] = cols[i];
      ctx.textAlign = a;
      ctx.font = i ? `400 12px ${MONO}` : `600 12.5px ${SANS}`;
      ctx.fillStyle = i ? th.ink : th.color[b.key];
      ctx.fillText(v, X + f * CW, y);
    });
    y += 18;
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = th.muted;
  ctx.font = `400 11px ${SANS}`;
  if (scene.bodies.some((b) => b.st === 'lost')) {
    ctx.fillText(`* ${tr('STEREO-B: contact lost 2014-10-01; position is a prediction.')}`, X, y + 2);
    y += 16;
  }
  if (meta.absent) wrapText(ctx, meta.absent, X, y + 2, CW, 14);

  ctx.fillText(`${tr('Ephemerides: JPL Horizons')}${meta.stamp ? ` (${tr('updated {date}', { date: meta.stamp })})` : ''} · ${tr('HGS/Carrington from Earth')}`, X, H - 38, CW);
  ctx.fillText('sr-dash.github.io/heliofleet', X, H - 22);
  return cv;
}

function save(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export async function downloadPNG(cv, base) {
  const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
  save(blob, `${base}.png`);
}

export function downloadPDF(cv, base, title) {
  const { jsPDF } = window.jspdf ?? {};
  if (!jsPDF) throw new Error(tr('The PDF library did not load. Check your connection and try again.'));
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [W * 0.75, H * 0.75] });
  pdf.setProperties({ title, creator: 'HelioFleet' });
  pdf.addImage(cv.toDataURL('image/jpeg', 0.93), 'JPEG', 0, 0, W * 0.75, H * 0.75);
  pdf.save(`${base}.pdf`);
}

// One animation frame. Wide frames put the map on the left and the date,
// context and near-Earth inset beside it; square or tall frames overlay the
// date on the map. Text scales with the frame.
export function composeFrame(ctx, W, H, scene, s, th, meta) {
  const k = Math.min(W, H) / 720;
  ctx.fillStyle = th.page;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';
  if (W / H >= 1.3) {
    const M = H;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, M, M);
    ctx.clip();
    drawMap(ctx, M, M, scene, s, th, s, { k });
    ctx.restore();
    const X = M + 34 * k;
    const CW = W - X - 30 * k;
    let y = 74 * k;
    ctx.textAlign = 'left';
    ctx.fillStyle = th.ink;
    ctx.font = `800 ${46 * k}px ${DISPLAY}`;
    ctx.fillText('HELIOFLEET', X, y);
    y += 56 * k;
    ctx.font = `500 ${34 * k}px ${MONO}`;
    ctx.fillText(meta.date, X, y);
    y += 34 * k;
    ctx.fillStyle = th.accent;
    ctx.font = `400 ${22 * k}px ${MONO}`;
    ctx.fillText(meta.time, X, y);
    y += 32 * k;
    ctx.fillStyle = th.muted;
    ctx.font = `500 ${15 * k}px ${SANS}`;
    if (meta.context) y = wrapText(ctx, meta.context, X, y, CW, 20 * k) + 4 * k;
    y = wrapText(ctx, meta.frame, X, y, CW, 20 * k) + 14 * k;
    const IW = Math.min(CW, 230 * k);
    const IH = Math.min(IW * 1.25, H - y - 70 * k);
    if (IH > 120 * k) {
      ctx.save();
      ctx.translate(X, y);
      ctx.beginPath();
      ctx.roundRect(0, 0, IW, IH, 10 * k);
      ctx.clip();
      drawInset(ctx, IW, IH, scene, s, th, { k: Math.max(0.8, k) });
      ctx.restore();
      ctx.strokeStyle = th.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(X + 0.5, y + 0.5, IW - 1, IH - 1, 10 * k);
      ctx.stroke();
    }
    ctx.fillStyle = th.muted;
    ctx.font = `400 ${13 * k}px ${SANS}`;
    ctx.fillText(tr('Ephemerides: JPL Horizons'), X, H - 46 * k);
    ctx.fillText('sr-dash.github.io/heliofleet', X, H - 26 * k);
    return;
  }
  const IW = 170 * k;
  const IH = 212 * k;
  const ix = W - IW - 14 * k;
  const iy = 14 * k;
  drawMap(ctx, W, H, scene, s, th, s, { k, avoid: [{ x: ix - 6, y: iy - 6, w: IW + 12, h: IH + 12 }] });
  ctx.save();
  ctx.translate(ix, iy);
  ctx.beginPath();
  ctx.roundRect(0, 0, IW, IH, 10 * k);
  ctx.clip();
  drawInset(ctx, IW, IH, scene, s, th, { k: Math.max(0.8, k * 0.9) });
  ctx.restore();
  ctx.strokeStyle = th.line;
  ctx.beginPath();
  ctx.roundRect(ix + 0.5, iy + 0.5, IW - 1, IH - 1, 10 * k);
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.fillStyle = th.ink;
  ctx.font = `800 ${30 * k}px ${DISPLAY}`;
  ctx.fillText('HELIOFLEET', 20 * k, 44 * k);
  ctx.font = `500 ${24 * k}px ${MONO}`;
  ctx.fillText(meta.date, 20 * k, 76 * k);
  ctx.fillStyle = th.accent;
  ctx.font = `400 ${17 * k}px ${MONO}`;
  ctx.fillText(meta.time, 20 * k, 100 * k);
  if (meta.context) {
    ctx.fillStyle = th.muted;
    ctx.font = `500 ${14 * k}px ${SANS}`;
    ctx.fillText(meta.context, 20 * k, 122 * k);
  }
  ctx.fillStyle = th.muted;
  ctx.font = `400 ${12 * k}px ${SANS}`;
  ctx.textAlign = 'right';
  ctx.fillText('sr-dash.github.io/heliofleet · JPL Horizons', W - 16 * k, H - 16 * k);
}
