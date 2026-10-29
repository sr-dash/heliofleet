// Research tools: tabular export, time series, SunPy cross-check code,
// alignment search and solar-surface visibility. All geometry is shared with
// the map, so every number here matches what the page shows.

import { ensure, position, dateFromJD } from './ephem.js';
import {
  heliographic, footpointLon, angleBetween, surfaceNormal, viewAngle, norm,
} from './frames.js';
import { BODIES, SPACECRAFT, PLANETS } from './catalog.js';
import { dataKeys, helioPosition, spacecraftAt } from './scene.js';
import { tr } from './i18n.js';

const SITE = 'https://sr-dash.github.io/heliofleet/';
const iso = (jd) => dateFromJD(jd + 1 / 172800).toISOString().slice(0, 19) + 'Z';
const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
const r = (v, d) => (v === null || v === undefined ? '' : Number(v.toFixed(d)));

export const COLUMNS = [
  ['time_utc', 'UTC sample time'],
  ['body', 'body key'],
  ['name', 'body name'],
  ['x_au', 'heliocentric ecliptic J2000 x (au)'],
  ['y_au', 'heliocentric ecliptic J2000 y (au)'],
  ['z_au', 'heliocentric ecliptic J2000 z (au)'],
  ['r_au', 'distance from Sun centre (au)'],
  ['hgs_lon_deg', 'Stonyhurst heliographic longitude (deg, west positive)'],
  ['hgs_lat_deg', 'Stonyhurst heliographic latitude (deg)'],
  ['carrington_lon_deg', 'Carrington longitude as seen from Earth (deg)'],
  ['sep_from_earth_deg', 'Sun-centred angle between body and Earth (deg)'],
  ['dist_to_earth_au', 'distance from Earth (au)'],
  ['footpoint_hgs_lon_deg', 'Stonyhurst longitude of the Parker-spiral footpoint (deg)'],
  ['status', 'ok, lost (prediction after loss of contact) or approx (shown at Earth)'],
];

// One table row from a heliocentric position.
function row(key, p, earth, jd, wind, st = 'ok') {
  const g = heliographic(p, earth, jd);
  const isEarth = key === 'earth';
  const planet = BODIES[key].kind === 'planet' && !isEarth;
  return {
    time_utc: iso(jd),
    body: key,
    name: BODIES[key].name,
    x_au: r(p[0], 8), y_au: r(p[1], 8), z_au: r(p[2], 8),
    r_au: r(g.dist, 6),
    hgs_lon_deg: r(g.lon, 4),
    hgs_lat_deg: r(g.lat, 4),
    carrington_lon_deg: r(g.carr, 4),
    sep_from_earth_deg: isEarth ? 0 : r(angleBetween(p, earth), 4),
    dist_to_earth_au: isEarth ? 0 : r(norm([p[0] - earth[0], p[1] - earth[1], p[2] - earth[2]]), 6),
    footpoint_hgs_lon_deg: planet ? '' : r(footpointLon(g.lon, g.dist, wind), 3),
    status: st,
  };
}

export function sceneRows(scene, wind, hidden) {
  return scene.bodies
    .filter((b) => !hidden.has(b.key))
    .map((b) => row(b.key, b.p, scene.earth, scene.jd, wind, b.st));
}

function header(lines) {
  return lines.map((l) => `# ${l}`).join('\n') + '\n';
}

export function toCSV(rows, meta, cols = COLUMNS) {
  const head = header([
    'HelioFleet export',
    `Source: ${SITE}`,
    'Ephemerides: JPL Horizons (https://ssd.jpl.nasa.gov/horizons/), interpolated',
    ...(cols === COLUMNS ? [`Parker-spiral footpoints for a solar-wind speed of ${meta.wind} km/s`] : []),
    `Generated: ${new Date().toISOString().slice(0, 19)}Z`,
    ...cols.map(([k, d]) => `${k}: ${d}`),
  ]);
  const keys = cols.map(([k]) => k);
  const esc = (v) => (typeof v === 'string' && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return head + keys.join(',') + '\n' + rows.map((o) => keys.map((k) => esc(o[k])).join(',')).join('\n') + '\n';
}

export function toJSON(rows, meta, cols = COLUMNS) {
  return JSON.stringify({
    source: SITE,
    ephemerides: 'JPL Horizons, interpolated',
    ...(cols === COLUMNS ? { solar_wind_km_s: meta.wind } : {}),
    generated: new Date().toISOString().slice(0, 19) + 'Z',
    columns: Object.fromEntries(cols),
    rows,
  }, null, 1);
}

// Time series for the given bodies, sampled every `step` days.
export async function timeSeries(keys, jd0, jd1, step, wind, limit = 250000) {
  const n = Math.floor((jd1 - jd0) / step) + 1;
  if (n * keys.length > limit) {
    throw new Error(tr('That is {n} rows; choose a shorter range or a coarser step (limit {limit}).', { n: (n * keys.length).toLocaleString('en-US'), limit: limit.toLocaleString('en-US') }));
  }
  const series = new Set(['earth']);
  for (const k of keys) for (const d of dataKeys(k)) series.add(d);
  await ensure([...series], jd0, jd1);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const t = jd0 + i * step;
    const earth = position('earth', t);
    if (!earth) continue;
    for (const k of keys) {
      if (k === 'earth') { rows.push(row(k, earth, earth, t, wind)); continue; }
      if (BODIES[k].kind === 'planet') {
        const p = position(k, t);
        if (p) rows.push(row(k, p, earth, t, wind));
        continue;
      }
      const { st, p } = spacecraftAt(k, t, earth);
      if (p) rows.push(row(k, p, earth, t, wind, st));
    }
  }
  return rows;
}

// Python that reproduces the table with SunPy, for an independent check.
export function sunpyCode(jd, keys) {
  const t = iso(jd).replace('Z', '');
  const sc = keys.filter((k) => BODIES[k].kind === 'sc');
  const width = Math.max(...sc.map((k) => BODIES[k].name.length), 5) + 2;
  const lines = sc.map((k) => `    ${JSON.stringify(BODIES[k].name).padEnd(width + 2)}: "${BODIES[k].hid}",`);
  return `# Reproduce the HelioFleet coordinate table with SunPy.
# Moment: ${t} UTC   (${SITE}?t=${t.slice(0, 16)}Z)
# pip install sunpy astroquery
import astropy.units as u
from astropy.time import Time
from sunpy.coordinates import frames, get_body_heliographic_stonyhurst, get_horizons_coord

t = Time("${t}", scale="utc")
horizons_ids = {
${lines.join('\n')}
}

def show(name, coord):
    hgs = coord.transform_to(frames.HeliographicStonyhurst(obstime=t))
    hgc = coord.transform_to(frames.HeliographicCarrington(obstime=t, observer="earth"))
    print(f"{name:${width}s} r={hgs.radius.to_value(u.AU):9.5f} au  "
          f"HGS lon={hgs.lon.to_value(u.deg):+9.3f}  lat={hgs.lat.to_value(u.deg):+8.3f}  "
          f"Carrington lon={hgc.lon.to_value(u.deg):8.3f}")

show("Earth", get_body_heliographic_stonyhurst("earth", t))
for name, hid in horizons_ids.items():
    show(name, get_horizons_coord(hid, t))
`;
}

// ---------- viewing geometry ----------
// What each observer needs to co-align and time-align its images with Earth's:
// light time, apparent solar radius, disk-centre B0 and L0, and image scale.

const C_KM_S = 299792.458;
const AU_KM = 149597870.7;
const R_SUN_KM = 695700;
const ARCSEC = Math.PI / 648000;

export const GEOMETRY_COLUMNS = [
  ['time_utc', 'UTC moment at the observer'],
  ['body', 'observer key'],
  ['name', 'observer name'],
  ['r_au', 'distance from Sun centre (au)'],
  ['light_time_s', 'light travel time from Sun centre to the observer (s)'],
  ['offset_vs_earth_s', 'light time minus Earth\'s (s); negative means it sees solar events earlier than Earth'],
  ['rsun_arcsec', 'apparent solar radius (arcsec), as RSUN_OBS'],
  ['b0_deg', 'heliographic latitude of the disk centre, B0, as HGLT_OBS (deg)'],
  ['hgs_lon_deg', 'Stonyhurst longitude of the disk centre, as HGLN_OBS (deg)'],
  ['l0_deg', 'Carrington longitude of the disk centre with the observer\'s own light time, as CRLN_OBS (deg)'],
  ['km_per_arcsec', 'size on the Sun of one arcsecond at disk centre (km)'],
  ['scale_vs_earth', 'how much larger a disk-centre feature looks than from Earth'],
  ['status', 'ok, lost (prediction after loss of contact) or approx (shown at Earth)'],
];

export function geometryRows(scene, hidden) {
  const e = scene.earth;
  const dE = norm(e);
  return scene.bodies
    .filter((b) => !hidden.has(b.key) && (b.key === 'earth' || BODIES[b.key].kind === 'sc'))
    .map((b) => {
      const g = heliographic(b.p, e, scene.jd, norm(b.p));
      const km = g.dist * AU_KM;
      return {
        time_utc: iso(scene.jd),
        body: b.key,
        name: BODIES[b.key].name,
        r_au: r(g.dist, 6),
        light_time_s: r(km / C_KM_S, 2),
        offset_vs_earth_s: r((g.dist - dE) * AU_KM / C_KM_S, 2),
        rsun_arcsec: r(Math.asin(R_SUN_KM / km) / ARCSEC, 2),
        b0_deg: r(g.lat, 4),
        hgs_lon_deg: r(g.lon, 4),
        l0_deg: r(g.carr, 4),
        km_per_arcsec: r((km - R_SUN_KM) * Math.tan(ARCSEC), 2),
        scale_vs_earth: r((dE * AU_KM - R_SUN_KM) / (km - R_SUN_KM), 4),
        status: b.st ?? 'ok',
      };
    });
}

export function geometrySunpy(jd, keys) {
  const t = iso(jd).replace('Z', '');
  const sc = keys.filter((k) => BODIES[k].kind === 'sc');
  const width = Math.max(...sc.map((k) => BODIES[k].name.length), 5) + 2;
  const lines = sc.map((k) => `    ${JSON.stringify(BODIES[k].name).padEnd(width + 2)}: "${BODIES[k].hid}",`);
  return `# Reproduce the HelioFleet viewing-geometry table with SunPy.
# Moment: ${t} UTC   (${SITE}?t=${t.slice(0, 16)}Z)
# pip install sunpy astroquery
import numpy as np
import astropy.units as u
import astropy.constants as const
from astropy.time import Time
from sunpy.coordinates import frames, get_body_heliographic_stonyhurst, get_horizons_coord

t = Time("${t}", scale="utc")
horizons_ids = {
${lines.join('\n')}
}
earth = get_body_heliographic_stonyhurst("earth", t)

def show(name, coord):
    hgs = coord.transform_to(frames.HeliographicStonyhurst(obstime=t))
    # The observer's own disk-centre Carrington longitude (CRLN_OBS)
    hgc = hgs.transform_to(frames.HeliographicCarrington(obstime=t, observer=hgs))
    d = hgs.radius
    rsun = np.arcsin(const.R_sun / d).to(u.arcsec)
    lag = ((d - earth.radius) / const.c).to(u.s)
    print(f"{name:${width}s} r={d.to_value(u.AU):9.5f} au  light-time offset={lag.value:+8.1f} s  "
          f"RSUN={rsun.value:8.2f}\"  B0={hgs.lat.to_value(u.deg):+8.3f}  L0={hgc.lon.to_value(u.deg):8.3f}")

show("Earth", earth)
for name, hid in horizons_ids.items():
    show(name, get_horizons_coord(hid, t))
`;
}

// ---------- alignment search ----------

export const ALIGN_KINDS = {
  radial: {
    label: 'Radial alignment',
    help: 'Both bodies on nearly the same line from the Sun: the Sun-centred angle between them is within the tolerance. Good for tracking one solar-wind parcel or CME past two spacecraft.',
    needsB: true, tol: 5,
  },
  quadrature: {
    label: 'Quadrature with Earth',
    help: 'The spacecraft sits 90° from Earth as seen from the Sun, within the tolerance, so Earth-facing features appear on its limb. Good for stereoscopy and CME kinematics.',
    needsB: false, tol: 5,
  },
  connection: {
    label: 'Magnetic connection',
    help: 'The nominal Parker-spiral footpoints of both bodies lie within the tolerance in longitude, at the chosen solar-wind speed. Good for energetic-particle and in-situ comparisons.',
    needsB: true, tol: 10,
  },
};

export async function findAlignments({ kind, a, b, tol, jd0, jd1, wind }) {
  const bodies = [a, ...(ALIGN_KINDS[kind].needsB ? [b] : [])];
  const series = new Set(['earth']);
  for (const k of bodies) if (k !== 'earth') for (const d of dataKeys(k)) series.add(d);
  await ensure([...series], jd0, jd1);
  // Parker moves several degrees an hour near perihelion.
  const step = bodies.includes('psp') ? 1 / 24 : 0.25;
  const at = (k, t, earth) => (k === 'earth' ? earth : spacecraftAt(k, t, earth).p);
  const metric = (t) => {
    const earth = position('earth', t);
    if (!earth) return null;
    const pa = at(a, t, earth);
    if (!pa) return null;
    if (kind === 'quadrature') return Math.abs(angleBetween(pa, earth) - 90);
    const pb = at(b, t, earth);
    if (!pb) return null;
    if (kind === 'radial') return angleBetween(pa, pb);
    const ga = heliographic(pa, earth, t);
    const gb = heliographic(pb, earth, t);
    return Math.abs(wrap180(footpointLon(ga.lon, ga.dist, wind) - footpointLon(gb.lon, gb.dist, wind)));
  };
  const windows = [];
  let cur = null;
  let samples = 0;
  for (let t = jd0; t <= jd1 + 1e-9; t += step) {
    const m = metric(t);
    if (m !== null) samples++;
    if (m !== null && m <= tol) {
      if (!cur) cur = { start: t, end: t, best: t, value: m };
      cur.end = t;
      if (m < cur.value) { cur.best = t; cur.value = m; }
    } else if (cur) {
      windows.push(cur);
      cur = null;
    }
  }
  if (cur) windows.push(cur);
  return { windows, samples, step };
}

export function windowsCSV(res, q) {
  const head = header([
    'HelioFleet alignment search',
    `Source: ${SITE}`,
    `Search: ${ALIGN_KINDS[q.kind].label}; ${BODIES[q.a].name}${ALIGN_KINDS[q.kind].needsB ? ` and ${BODIES[q.b].name}` : ''}; tolerance ${q.tol} deg${q.kind === 'connection' ? `; solar wind ${q.wind} km/s` : ''}`,
    `Range: ${iso(q.jd0)} to ${iso(q.jd1)}; sampled every ${(res.step * 24).toFixed(0)} h`,
    'best_value_deg: smallest separation (radial, connection) or offset from 90 deg (quadrature) in the window',
  ]);
  const body = res.windows.map((w) => [iso(w.start), iso(w.end), ((w.end - w.start)).toFixed(3), iso(w.best), w.value.toFixed(3)].join(','));
  return head + 'start_utc,end_utc,duration_days,best_time_utc,best_value_deg\n' + body.join('\n') + '\n';
}

// ---------- visibility of a point on the Sun ----------

export function visibility(scene, spot, hidden) {
  const n = surfaceNormal(spot.lon, spot.lat, spot.sys, scene.earth, scene.jd);
  const out = [];
  for (const b of scene.bodies) {
    if (hidden.has(b.key)) continue;
    const meta = BODIES[b.key];
    if (meta.kind === 'planet' && b.key !== 'earth') continue;
    const theta = viewAngle(n, b.p);
    out.push({
      key: b.key,
      theta,
      mu: Math.cos((theta * Math.PI) / 180),
      state: theta < 70 ? 'on disk' : theta < 90 ? 'near limb' : theta < 105 ? 'just behind limb' : 'far side',
    });
  }
  return { rows: out, normal: n };
}

// ---------- citation ----------

export const CITATION = {
  version: '1.1.0',
  year: 2026,
  title: 'HelioFleet: an interactive map of heliophysics spacecraft positions',
  // Zenodo concept DOI: resolves to the latest release.
  doi: '10.5281/zenodo.23328187',
  // DOI of this version alone
  versionDoi: '10.5281/zenodo.23330591',
};

export function citationText() {
  const c = CITATION;
  const doi = c.doi ? `https://doi.org/${c.doi}` : SITE;
  const apa = `Dash, S. (${c.year}). ${c.title} (Version ${c.version}) [Computer software]. ${c.doi ? 'Zenodo. ' : ''}${doi}`;
  const bib = `@software{dash_heliofleet_${c.year},
  author    = {Dash, Soumyaranjan},
  title     = {{${c.title}}},
  year      = {${c.year}},
  version   = {${c.version}},${c.doi ? `\n  publisher = {Zenodo},\n  doi       = {${c.doi}},` : ''}
  url       = {${SITE}},
  note      = {Ephemerides from JPL Horizons}
}`;
  return { apa, bib };
}

export const ALL_KEYS = ['earth', ...SPACECRAFT, ...PLANETS];
export { helioPosition };
