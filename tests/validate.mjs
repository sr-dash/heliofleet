// Checks the page's own geometry code against reference values from JPL
// Horizons and SunPy (tests/reference.json, built by scripts/make_reference.py).
// Run with:  node tests/validate.mjs

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// The page loads data with fetch; serve it from the repository instead.
globalThis.fetch = async (url) => {
  const path = String(url).split('?')[0];
  try {
    const text = await readFile(ROOT + path, 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(text) };
  } catch {
    return { ok: false, status: 404, json: async () => null };
  }
};

const { loadManifest, ensure, position } = await import('../js/ephem.js');
const { heliographic, norm } = await import('../js/frames.js');
const { makeSky, hpcDirection } = await import('../js/skyproj.js');

const AU_KM = 149597870.7;
const ref = JSON.parse(await readFile(ROOT + 'tests/reference.json', 'utf8'));
await loadManifest();

// Tolerances
// Interpolation between stored samples, in km: about twice the error seen
// when these checks were set up. Fast passes need more: Parker near
// perihelion (3-hour samples), BepiColombo during planetary flybys and MAVEN
// circling Mars (daily samples). All are far below what the map can show.
const INTERP_KM = { default: 50, psp: 700, solo: 450, stb: 130, bepi: 2800, maven: 11000 };
const ANGLE_DEG = 0.005; // Stonyhurst and Carrington coordinates
const SKY_ARCSEC = 0.5; // sky-view directions

const at = async (key, jd) => {
  await ensure([key], jd - 1, jd + 1);
  return position(key, jd);
};
const wrap = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
let failed = 0;
const report = (name, worst, limit, unit, where) => {
  const ok = worst <= limit;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: worst ${worst.toPrecision(3)}${unit ? ` ${unit}` : ''} (limit ${limit}${unit ? ` ${unit}` : ''}; ${where})`);
};

// 1. Interpolation against Horizons at times between samples, as the share
// of each body's limit used (1 = at the limit)
let worst = 0;
let where = '';
for (const c of ref.interp) {
  const p = await at(c.key, c.jd);
  if (!p) { failed++; console.log(`FAIL no position for ${c.key} at JD ${c.jd}`); continue; }
  const k = c.units === 'au' ? AU_KM : 1;
  const err = norm([p[0] - c.p[0], p[1] - c.p[1], p[2] - c.p[2]]) * k;
  const limit = INTERP_KM[c.key] ?? INTERP_KM.default;
  if (err / limit > worst) { worst = err / limit; where = `${c.key} JD ${c.jd}: ${err.toFixed(1)} km`; }
}
report('interpolation vs Horizons, share of limit', worst, 1, '', where);

// 2. Stonyhurst and Carrington coordinates against SunPy
worst = 0;
for (const c of ref.helio) {
  const p = await at(c.key, c.jd);
  const e = await at('earth', c.jd);
  const g = heliographic(p, e, c.jd);
  for (const [name, d] of [['lon', wrap(g.lon - c.lon)], ['lat', g.lat - c.lat], ['carr', wrap(g.carr - c.carr)]]) {
    if (Math.abs(d) > worst) { worst = Math.abs(d); where = `${c.key} JD ${c.jd} ${name}`; }
  }
}
report('heliographic coordinates vs SunPy', worst, ANGLE_DEG, 'deg', where);

// 3. Sky view: helioprojective directions from each observer against SunPy
worst = 0;
for (const c of ref.hpc) {
  const o = await at(c.observer, c.jd);
  const d = hpcDirection(o, c.tx, c.ty);
  const v = [c.point[0] - o[0], c.point[1] - o[1], c.point[2] - o[2]];
  const cos = (d[0] * v[0] + d[1] * v[1] + d[2] * v[2]) / (norm(d) * norm(v));
  const err = (Math.acos(Math.min(1, cos)) * 180 / Math.PI) * 3600;
  if (err > worst) { worst = err; where = `${c.observer} JD ${c.jd}`; }
}
report('sky-view directions vs SunPy', worst, SKY_ARCSEC, 'arcsec', where);

// 4. Sky view: a point is placed where the ray toward it meets the plane
worst = 0;
for (const c of ref.hpc) {
  const o = await at(c.observer, c.jd);
  const sky = makeSky(o);
  const a = sky.seen(c.point);
  const b = sky.hit(o, hpcDirection(o, c.tx, c.ty));
  const err = Math.hypot(a[0] - b[0], a[1] - b[1]);
  if (err > worst) { worst = err; where = `${c.observer} JD ${c.jd}`; }
}
report('plane-of-sky placement', worst, 1e-4, 'solar radii', where);

// 5. The timeline's reserved height matches what js/ribbon.js draws, so the
// page does not jump when it appears
const { SPACECRAFT } = await import('../js/catalog.js');
const css = await readFile(ROOT + 'css/style.css', 'utf8');
const reserved = parseFloat(css.match(/#ribbon \{[^}]*height: ([\d.]+)px/)[1]);
const drawn = 42 + 11.5 * (SPACECRAFT.length - 1) + 20 + 16 + 16;
report('timeline height reserved in css/style.css', Math.abs(reserved - drawn), 0.5, 'px', `reserved ${reserved}, drawn ${drawn}`);

if (failed) {
  console.log(`${failed} check(s) failed`);
  process.exit(1);
}
console.log('all checks passed');
