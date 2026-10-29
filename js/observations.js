// Observation footprints of high-resolution instruments (IRIS, Hinode/EIS,
// DKIST, Solar Orbiter), from data/obs/ (built by scripts/fetch_observations.py),
// carried into Earth's helioprojective frame for the SDO image panel.

const BASE = 'data/obs/';
const jdOf = (iso) => Date.parse(iso) / 864e5 + 2440587.5;
const RAD = Math.PI / 180;
const ARC = RAD / 3600;
const R_SUN_AU = 695700 / 149597870.7;

// name, colour on the SDO images, and where the pointing is measured from
export const OBS_INST = {
  cryonirsp: { name: 'DKIST Cryo-NIRSP', short: 'Cryo-NIRSP', color: '#ffffff' },
  vbi: { name: 'DKIST VBI', short: 'VBI', color: '#ffd166' },
  visp: { name: 'DKIST ViSP', short: 'ViSP', color: '#ff9f68' },
  dlnirsp: { name: 'DKIST DL-NIRSP', short: 'DL-NIRSP', color: '#c3a6ff' },
  vtf: { name: 'DKIST VTF', short: 'VTF', color: '#ff8fab' },
  iris: { name: 'IRIS', short: 'IRIS', color: '#4cc9f0' },
  eis: { name: 'Hinode EIS', short: 'EIS', color: '#80ed99' },
  euihri: { name: 'Solar Orbiter EUI-HRI EUV', short: 'EUI-HRI', color: '#ff6bd6' },
  euilya: { name: 'Solar Orbiter EUI-HRI Lyα', short: 'HRI Lyα', color: '#b388ff' },
  phihrt: { name: 'Solar Orbiter PHI-HRT', short: 'PHI-HRT', color: '#f4f1a6' },
  spice: { name: 'Solar Orbiter SPICE', short: 'SPICE', color: '#ff5d5d' },
};

let index;
const months = new Map();

async function loadIndex() {
  index ??= fetch(`${BASE}index.json`, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return index;
}

function loadMonth(key) {
  if (!months.has(key)) {
    months.set(key, fetch(`${BASE}${key}.json`).then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d) => d.rows.map((r) => {
        // Durations over a day come from faulty catalogue entries; cut them to a day
        const j0 = jdOf(r.t0);
        const j1 = Math.min(jdOf(r.t1) || j0, j0 + 1);
        // Older lists say "1 files"
        return { ...r, j0, j1, n: r.n?.replace(/\b1 files\b/, '1 file') };
      }).filter((r) => Number.isFinite(r.j0))).catch(() => []));
  }
  return months.get(key);
}

// Observations overlapping jd ± half (days), from the monthly files that hold them
export async function observationsNear(jd, half = 0.5) {
  const idx = await loadIndex();
  if (!idx) return null;
  const keys = new Set();
  for (const t of [jd - half - 1, jd, jd + half]) keys.add(new Date((t - 2440587.5) * 864e5).toISOString().slice(0, 7));
  const rows = (await Promise.all([...keys].filter((k) => idx.months[k]).map(loadMonth))).flat();
  return rows.filter((r) => r.j1 >= jd - half && r.j0 <= jd + half);
}

// Earth's heliographic latitude (B0, degrees) and distance from the Sun (au), after Meeus
function earthView(jd) {
  const T = (jd - 2451545) / 36525;
  const M = (357.52911 + 35999.05029 * T) * RAD;
  const lon = 280.46646 + 36000.76983 * T + (1.914602 - 0.004817 * T) * Math.sin(M) + 0.019993 * Math.sin(2 * M);
  const node = 73.6667 + 1.3958333 * (jd - 2396758) / 36525;
  const b0 = Math.asin(Math.sin((lon - node) * RAD) * Math.sin(7.25 * RAD)) / RAD;
  return { lon: 0, lat: b0, d: 1.000140 - 0.016708 * Math.cos(M) - 0.000139 * Math.cos(2 * M) };
}

// Observer position (Stonyhurst, au) and its helioprojective axes
function axes({ lon, lat, d }) {
  const o = [d * Math.cos(lat * RAD) * Math.cos(lon * RAD), d * Math.cos(lat * RAD) * Math.sin(lon * RAD), d * Math.sin(lat * RAD)];
  const s = o.map((v) => -v / d); // towards Sun centre
  const zs = s[2];
  let n = [-zs * s[0], -zs * s[1], 1 - zs * s[2]];
  const nn = Math.hypot(...n);
  n = n.map((v) => v / nn); // solar north on the sky
  const w = [s[1] * n[2] - s[2] * n[1], s[2] * n[0] - s[0] * n[2], s[0] * n[1] - s[1] * n[0]]; // west
  return { o, s, n, w };
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// A point seen at (tx, ty) arcsec from `from`, as seen from `to`: on the Sun where the
// line of sight meets it, otherwise where it passes closest to Sun centre
function carry(tx, ty, from, to) {
  const a = tx * ARC;
  const b = ty * ARC;
  const dir = [0, 1, 2].map((k) => Math.cos(b) * Math.cos(a) * from.s[k] + Math.cos(b) * Math.sin(a) * from.w[k] + Math.sin(b) * from.n[k]);
  const od = dot(from.o, dir);
  const disc = od * od - (dot(from.o, from.o) - R_SUN_AU ** 2);
  const t = disc >= 0 ? -od - Math.sqrt(disc) : -od;
  const p = from.o.map((v, k) => v + t * dir[k]);
  const v = p.map((x, k) => x - to.o[k]);
  const r = Math.hypot(...v);
  const hidden = disc >= 0 && dot(p, p) > dot(p, to.o); // far side of the Sun from `to`
  return [Math.atan2(dot(v, to.w), dot(v, to.s)) / ARC, Math.asin(dot(v, to.n) / r) / ARC, hidden];
}

// Footprint in Earth's view: Earth-based and near-Earth fields as recorded,
// Solar Orbiter fields carried over through the solar surface (edges sampled)
const shapes = new WeakMap();
export function earthShape(r) {
  if (r.f !== 'S') return r;
  if (shapes.has(r)) return shapes.get(r);
  const from = axes({ lon: r.o[0], lat: r.o[1], d: r.o[2] });
  const to = axes(earthView((r.j0 + r.j1) / 2));
  const x = [];
  const y = [];
  let hid = 0;
  for (let i = 0; i < r.x.length - 1; i++) {
    for (let k = 0; k < 8; k++) {
      const u = k / 8;
      const [tx, ty, h] = carry(r.x[i] + (r.x[i + 1] - r.x[i]) * u, r.y[i] + (r.y[i + 1] - r.y[i]) * u, from, to);
      x.push(Math.round(tx * 10) / 10);
      y.push(Math.round(ty * 10) / 10);
      hid += h;
    }
  }
  x.push(x[0]);
  y.push(y[0]);
  const out = { ...r, x, y, hidden: hid > 0.5 * (x.length - 1) };
  shapes.set(r, out);
  return out;
}

// Earth's solar radius in arcsec at jd
export const earthRsun = (jd) => 959.63 / earthView(jd).d;

// A Helioviewer cutout loaded live (Helioviewer counts y0 downward)
const LAYERS = { aia171: '[SDO,AIA,AIA,171,1,100]', aia193: '[SDO,AIA,AIA,193,1,100]', hmi: '[SDO,HMI,HMI,magnetogram,1,100]' };
export function liveURL(ch, iso, x0, y0, scale, size) {
  const q = new URLSearchParams({
    date: iso, imageScale: scale, layers: LAYERS[ch], x0, y0: -y0, width: size, height: size, display: 'true', watermark: 'false',
  });
  return `https://api.helioviewer.org/v2/takeScreenshot/?${q}`;
}

// A run built around one observation, with live images
export function liveRun(r, jd) {
  const xs = r.x.slice(0, -1);
  const ys = r.y.slice(0, -1);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  const x0 = Math.round((Math.max(...xs) + Math.min(...xs)) / 2);
  const y0 = Math.round((Math.max(...ys) + Math.min(...ys)) / 2);
  const scale = Math.round(Math.max(0.6, Math.max(w, h, 330) * 1.25 / 720) * 1000) / 1000;
  const far = Math.max(...xs.map(Math.abs), ...ys.map(Math.abs));
  const dscale = Math.round(Math.max(2200, 2 * far + 150) / 512 * 1000) / 1000;
  const t = new Date(((r.j0 + r.j1) / 2 - 2440587.5) * 864e5).toISOString().slice(0, 19) + 'Z';
  const img = {};
  const disk = {};
  for (const ch of Object.keys(LAYERS)) {
    img[ch] = { url: liveURL(ch, t, x0, y0, scale, 720), date: null };
    disk[ch] = { url: liveURL(ch, t, 0, 0, dscale, 512), date: null };
  }
  return { key: `obs:${r.i}:${r.id}`, live: true, t, jd: jd ?? (r.j0 + r.j1) / 2, x0, y0, scale, size: 720, img, disk: { scale: dscale, size: 512, img: disk }, ids: [r.id] };
}
