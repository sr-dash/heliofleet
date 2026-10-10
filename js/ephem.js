// Ephemeris loader: lazily fetches per-year chunks written by
// scripts/fetch_ephemeris.py and interpolates them with a 4-point Lagrange
// polynomial on the uniform UT sample grid.

const JD_UNIX = 2440587.5;
let manifest = null;
const chunks = new Map(); // "key/year" -> chunk | null (missing) | Promise

export const jdFromDate = (d) => d.getTime() / 864e5 + JD_UNIX;
export const dateFromJD = (jd) => new Date((jd - JD_UNIX) * 864e5);
const yearOf = (jd) => dateFromJD(jd).getUTCFullYear();

export async function loadManifest() {
  const r = await fetch('data/manifest.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error(`Could not load data/manifest.json (${r.status})`);
  manifest = await r.json();
  return manifest;
}

export const info = (key) => manifest?.bodies[key] ?? null;

export function covers(key, jd) {
  const b = info(key);
  return !!b && jd >= b.start && jd <= b.end;
}

function loadChunk(key, year) {
  const id = `${key}/${year}`;
  if (chunks.has(id)) return chunks.get(id);
  const p = fetch(`data/${id}.json`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((c) => {
      chunks.set(id, c);
      return c;
    });
  chunks.set(id, p);
  return p;
}

// Make sure every chunk overlapping [jd0, jd1] is loaded for the given bodies.
export function ensure(keys, jd0, jd1) {
  const jobs = [];
  for (const key of keys) {
    const b = info(key);
    if (!b) continue;
    const a = Math.max(jd0 - 2 * b.step, b.start);
    const z = Math.min(jd1 + 2 * b.step, b.end);
    if (z < a) continue;
    for (let y = yearOf(a); y <= yearOf(z); y++) {
      if (b.years.includes(y)) jobs.push(loadChunk(key, y));
    }
  }
  return Promise.all(jobs);
}

// Sample at an exact grid time g, or null when it is not loaded / not covered.
function sample(key, g, step) {
  for (const y of [yearOf(g + 1e-6), yearOf(g + 1e-6) - 1, yearOf(g + 1e-6) + 1]) {
    const c = chunks.get(`${key}/${y}`);
    if (!c || c instanceof Promise) continue;
    const k = Math.round((g - c.t0) / step);
    if (k >= 0 && k < c.n) return [c.d[3 * k], c.d[3 * k + 1], c.d[3 * k + 2]];
  }
  return null;
}

// Interpolated position [x, y, z] (au or km, ICRF ecliptic) or null.
export function position(key, jd) {
  const b = info(key);
  if (!b || jd < b.start - 1e-9 || jd > b.end + 1e-9) return null;
  const c0 = chunks.get(`${key}/${yearOf(jd)}`);
  const anchor = c0 && !(c0 instanceof Promise) ? c0.t0 : b.start;
  const h = b.step;
  const i = Math.floor((jd - anchor) / h + 1e-9);
  const g0 = anchor + i * h;
  const u = (jd - g0) / h;
  const p0 = sample(key, g0, h);
  if (!p0) return null;
  if (u < 1e-9) return p0;
  const p1 = sample(key, g0 + h, h);
  if (!p1) return u < 0.5 ? p0 : null;
  const pm = sample(key, g0 - h, h);
  const p2 = sample(key, g0 + 2 * h, h);
  if (!pm || !p2) return p0.map((v, j) => v + (p1[j] - v) * u);
  const wm = (-u * (u - 1) * (u - 2)) / 6;
  const w0 = ((u + 1) * (u - 1) * (u - 2)) / 2;
  const w1 = (-(u + 1) * u * (u - 2)) / 2;
  const w2 = ((u + 1) * u * (u - 1)) / 6;
  return p0.map((_, j) => wm * pm[j] + w0 * p0[j] + w1 * p1[j] + w2 * p2[j]);
}
