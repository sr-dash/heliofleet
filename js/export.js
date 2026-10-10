// Snapshot export: composes the map, the near-Earth inset and a coordinate
// table on one canvas, then saves it as PNG or as a single-page PDF.

import { drawMap, drawInset } from './render.js';
import { BODIES } from './catalog.js';

const W = 1200;
const H = 760;
const SCALE = 2;
const MONO = '"IBM Plex Mono", monospace';
const SANS = '"Instrument Sans", sans-serif';
const DISPLAY = '"Big Shoulders Display", sans-serif';

const deg = (v, signed = true) => `${signed && v >= 0 ? '+' : ''}${v.toFixed(1)}°`;

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
  ctx.fillText('NEAR EARTH · SUN UP', X + CW - IW + 8, y + IH + 14);

  // Legend beside the inset
  let ly = y + 8;
  ctx.font = `600 13px ${SANS}`;
  for (const b of scene.bodies) {
    if (s.hidden.has(b.key)) continue;
    const kind = BODIES[b.key].kind;
    ctx.fillStyle = th.color[b.key];
    ctx.save();
    ctx.translate(X + 6, ly);
    if (kind === 'sc') { ctx.rotate(Math.PI / 4); ctx.fillRect(-4, -4, 8, 8); }
    else { ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, 2 * Math.PI); ctx.fill(); }
    ctx.restore();
    ctx.fillStyle = th.ink;
    ctx.fillText(BODIES[b.key].name, X + 18, ly + 4.5);
    ly += 20;
  }

  // Coordinate table
  y += IH + 40;
  const cols = [
    ['Body', 0, 'left'],
    ['r au', 0.36, 'right'],
    ['HGS lon', 0.52, 'right'],
    ['HGS lat', 0.68, 'right'],
    ['Carr.', 0.84, 'right'],
    ['∠ Earth', 1, 'right'],
  ];
  ctx.font = `500 11px ${SANS}`;
  ctx.fillStyle = th.muted;
  for (const [t, f, a] of cols) { ctx.textAlign = a; ctx.fillText(t, X + f * CW, y); }
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
      ctx.font = i ? `400 12.5px ${MONO}` : `600 13px ${SANS}`;
      ctx.fillStyle = i ? th.ink : th.color[b.key];
      ctx.fillText(v, X + f * CW, y);
    });
    y += 21;
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = th.muted;
  ctx.font = `400 11px ${SANS}`;
  if (scene.bodies.some((b) => b.st === 'lost')) {
    ctx.fillText('* STEREO-B: contact lost 2014-10-01; position is a prediction.', X, y + 2);
    y += 16;
  }
  if (meta.absent) ctx.fillText(meta.absent, X, y + 2, CW);

  ctx.fillText('Ephemerides: JPL Horizons · HGS/Carrington from Earth, IAU rotation model', X, H - 38);
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
  if (!jsPDF) throw new Error('The PDF library did not load. Check your connection and try again.');
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [W * 0.75, H * 0.75] });
  pdf.setProperties({ title, creator: 'HelioFleet' });
  pdf.addImage(cv.toDataURL('image/jpeg', 0.93), 'JPEG', 0, 0, W * 0.75, H * 0.75);
  pdf.save(`${base}.pdf`);
}
