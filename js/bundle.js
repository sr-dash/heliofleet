// Figure bundle: the positions behind the map as CSV files, with a Python
// script that draws the same picture without the page's annotations, a
// README and the snapshot as a preview, zipped. Positions, trails, orbits and
// spirals are recomputed here in the frame of the map (as 3D vectors, not
// screen points), so the script can redraw them in either view.

import { position, info } from './ephem.js';
import { coversBody, helioPosition } from './scene.js';
import { eclipticLon, toFrame, parkerSpiral } from './frames.js';
import { BODIES, PLANETS } from './catalog.js';
import { CITATION } from './tools.js';

const FFLATE = 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js';
const SCRIPT = 'plot_heliofleet.py';
const TEXTS = [SCRIPT, 'requirements.txt', 'README.txt'];

const f6 = (v) => v.toFixed(6);
const isoUTC = (jd) => new Date((jd - 2440587.5) * 864e5).toISOString().slice(0, 16) + 'Z';
const csvCell = (v) => (typeof v === 'string' && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function csv(title, cols, rows) {
  const head = [title, ...cols.map(([k, d]) => `${k}: ${d}`)].map((l) => `# ${l}`).join('\n');
  return `${head}\n${cols.map(([k]) => k).join(',')}\n${rows.map((r) => r.map(csvCell).join(',')).join('\n')}\n`;
}

const XYZ = [['x_au', 'frame x (au)'], ['y_au', 'frame y (au)'], ['z_au', 'frame z, ecliptic north (au)']];

// Everything the map shows of the fleet, in the map's frame
export function bundleData(scene, s, th) {
  const jd = scene.jd;
  const eLon = eclipticLon(scene.earth);
  const fr = (p, lon = eLon) => toFrame(p, s.frame, lon);
  const shown = scene.bodies.filter((b) => !s.hidden.has(b.key));
  const frameName = s.frame === 'hee'
    ? 'Heliocentric Earth Ecliptic (HEE): x toward Earth, z ecliptic north'
    : 'Heliocentric inertial ecliptic J2000: x toward the J2000 equinox, z ecliptic north';

  const positions = csv(`HelioFleet positions at ${isoUTC(jd)}; frame: ${frameName}`, [
    ['key', 'body identifier'], ['name', 'short name'], ['kind', 'sc (spacecraft) or planet'],
    ['status', 'ok; approx (no ephemeris, placed at Earth); lost (contact lost, last known path)'],
    ['near_earth', '1 for spacecraft around Earth or the Sun-Earth L1 point, drawn as a list next to Earth'],
    ...XYZ, ['dist_au', 'distance from the Sun (au)'],
    ['hgs_lon_deg', 'Stonyhurst heliographic longitude (deg)'], ['hgs_lat_deg', 'Stonyhurst heliographic latitude (deg)'],
    ['color', 'colour used on the page'],
  ], shown.map((b) => {
    const m = BODIES[b.key];
    const p = fr(b.p);
    return [b.key, m.short, m.kind, b.st, m.near ? 1 : 0, f6(p[0]), f6(p[1]), f6(p[2]), f6(b.dist), b.lon.toFixed(3), b.lat.toFixed(3), th.color[b.key]];
  }));

  // Trails: the same sampling as the map; in HEE each sample is rotated by
  // Earth's longitude at its own time, so the path is the co-rotating track.
  const trailRows = [];
  if (s.trailDays > 0) {
    for (const b of shown) {
      const m = BODIES[b.key];
      if (m.kind !== 'sc' || m.near || b.st === 'approx') continue;
      const h = Math.min(info(b.key).step, s.trailDays / 160);
      const past = [];
      const future = [];
      for (let t = jd - s.trailDays; t <= jd + s.trailDays + 1e-9; t += h) {
        if (!coversBody(b.key, t)) continue;
        const p = helioPosition(b.key, t);
        const e = position('earth', t);
        if (!p || !e) continue;
        const q = fr(p, s.frame === 'hee' ? eclipticLon(e) : eLon);
        (t <= jd ? past : future).push([b.key, isoUTC(t), t <= jd ? 'past' : 'future', f6(q[0]), f6(q[1]), f6(q[2])]);
      }
      // Both halves end at the spacecraft, as on the map
      const now = fr(b.p).map(f6);
      trailRows.push(...past, [b.key, isoUTC(jd), 'past', ...now], [b.key, isoUTC(jd), 'future', ...now], ...future);
    }
  }
  const trails = csv(`HelioFleet trails, ${s.trailDays} days either side of ${isoUTC(jd)}; frame: ${frameName}`, [
    ['key', 'body identifier'], ['time_utc', 'sample time'], ['segment', 'past or future of the chosen moment'], ...XYZ,
  ], trailRows);

  // Orbits: one period of each planet's inertial path, rotated rigidly
  const orbitRows = [];
  for (const key of ['earth', ...(s.planets ? PLANETS : [])]) {
    if (s.hidden.has(key) || !BODIES[key]) continue;
    const period = BODIES[key].period ?? 365.25;
    for (let i = 0; i <= 240; i++) {
      const p = position(key, jd - (period * i) / 240);
      if (p) { const q = fr(p); orbitRows.push([key, f6(q[0]), f6(q[1]), f6(q[2])]); }
    }
  }
  const orbits = csv(`HelioFleet planet orbits (one period ending ${isoUTC(jd)}); frame: ${frameName}`, [['key', 'body identifier'], ...XYZ], orbitRows);

  // Parker spirals at the chosen solar-wind speed (ecliptic plane)
  const spiralRows = [];
  for (const b of shown) {
    const m = BODIES[b.key];
    if ((m.kind === 'planet' && b.key !== 'earth') || m.near) continue;
    for (const p of parkerSpiral(b.p, s.wind)) { const q = fr(p); spiralRows.push([b.key, f6(q[0]), f6(q[1]), f6(q[2])]); }
  }
  const spirals = csv(`HelioFleet Parker spirals for ${s.wind} km/s solar wind at ${isoUTC(jd)}; frame: ${frameName}`, [['key', 'body identifier'], ...XYZ], spiralRows);

  const settings = {
    time_utc: isoUTC(jd), frame: s.frame, frame_description: frameName, view: s.view,
    range_au: +s.range.toFixed(4), center_au: [+s.cx.toFixed(4), +s.cy.toFixed(4)],
    trail_days: s.trailDays, show_trails: s.trailDays > 0, show_planets: s.planets, show_spirals: s.spirals, show_labels: s.labels,
    solar_wind_km_s: s.wind, hidden: [...s.hidden],
    colors: { background: th.bg, ink: th.ink, muted: th.muted, grid: th.grid, sun: th.sun, spiral: th.spiral, bodies: Object.fromEntries(shown.map((b) => [b.key, th.color[b.key]])) },
    page: location.href, heliofleet_version: CITATION.version, doi: CITATION.doi,
  };
  return { positions, trails, orbits, spirals, settings, counts: { bodies: shown.length, trail: trailRows.length } };
}

// The zip: data files, script, README and the snapshot as a preview
export async function figureBundle(scene, s, th, preview, base) {
  const d = bundleData(scene, s, th);
  const enc = new TextEncoder();
  const dir = new URL('../download/', import.meta.url);
  const texts = await Promise.all(TEXTS.map(async (f) => {
    const r = await fetch(new URL(f, dir), { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${f}: ${r.status}`);
    return r.text();
  }));
  const fill = (t, v) => t.replace(/\{\{(\w+)\}\}/g, (_, k) => v[k] ?? '');
  const readme = fill(texts[2], {
    TIME: d.settings.time_utc, FRAME: d.settings.frame_description,
    VIEW: s.view === 'top' ? 'from ecliptic north' : 'edge-on, ecliptic north up',
    BODIES: String(d.counts.bodies), TRAIL: s.trailDays > 0 ? `${s.trailDays} days either side` : 'off',
    WIND: String(s.wind), PAGE: location.href, VERSION: CITATION.version, DOI: CITATION.doi,
    CREATED: new Date().toISOString().slice(0, 19) + 'Z', BASE: base,
  });
  const files = {
    [`${base}/README.txt`]: enc.encode(readme),
    [`${base}/${SCRIPT}`]: enc.encode(texts[0]),
    [`${base}/requirements.txt`]: enc.encode(texts[1]),
    [`${base}/positions.csv`]: enc.encode(d.positions),
    [`${base}/trails.csv`]: enc.encode(d.trails),
    [`${base}/orbits.csv`]: enc.encode(d.orbits),
    [`${base}/spirals.csv`]: enc.encode(d.spirals),
    [`${base}/settings.json`]: enc.encode(JSON.stringify(d.settings, null, 1)),
  };
  if (preview) files[`${base}/${base}_preview.png`] = new Uint8Array(await (await new Promise((r) => preview.toBlob(r, 'image/png'))).arrayBuffer());
  const { zipSync } = await import(FFLATE);
  return new Blob([zipSync(files, { level: 6 })], { type: 'application/zip' });
}
