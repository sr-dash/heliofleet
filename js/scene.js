// Turns a moment plus display settings into everything the renderer and the
// readout table need: projected positions, trails, spirals, status flags.

import { position, covers, info } from './ephem.js';
import {
  heliographic, footpointLon, parkerSpiral, angleBetween, eclipticLon,
  toFrame, project, norm,
} from './frames.js';
import { BODIES, SPACECRAFT, PLANETS } from './catalog.js';

const jdOf = (iso) => Date.parse(iso) / 864e5 + 2440587.5;
const L1_KM = 1.4915e6;

// Ephemeris ranges a scene needs, so the caller can load them first.
export function needs(jd, s) {
  const out = [['earth', jd - Math.max(s.trailDays, 366), jd + s.trailDays]];
  for (const k of SPACECRAFT) out.push([k, jd - s.trailDays, jd + s.trailDays]);
  if (s.planets) for (const k of PLANETS) out.push([k, jd - BODIES[k].period - 2, jd]);
  out.push(['moon_geo', jd - 30, jd], ['aditya_geo', jd - 200, jd]);
  return out;
}

function status(key, jd, p) {
  const b = BODIES[key];
  if (b.launch && jd < jdOf(b.launch)) return 'prelaunch';
  if (b.ended && jd > jdOf(b.ended)) return 'ended';
  if (!p) return b.fallback ? 'approx' : 'nodata';
  if (b.lost && jd > jdOf(b.lost)) return 'lost';
  return 'ok';
}

export function buildScene(jd, s) {
  const earth = position('earth', jd);
  if (!earth) return null;
  const eLon = eclipticLon(earth);
  const xy = (p, lon = eLon) => project(toFrame(p, s.frame, lon), s.frame, s.view);
  const earthLonAt = (t) => {
    const e = position('earth', t);
    return e ? eclipticLon(e) : null;
  };

  const bodies = [];
  const add = (key, p, st) => {
    const g = heliographic(p, earth, jd);
    bodies.push({
      key, p, st, xy: xy(p), ...g,
      sep: key === 'earth' ? 0 : angleBetween(p, earth),
      dEarth: norm([p[0] - earth[0], p[1] - earth[1], p[2] - earth[2]]),
      foot: footpointLon(g.lon, g.dist, s.wind),
    });
  };

  add('earth', earth, 'ok');
  const missing = [];
  for (const key of SPACECRAFT) {
    let p = position(key, jd);
    const st = status(key, jd, p);
    if (st === 'prelaunch' || st === 'ended' || st === 'nodata') {
      missing.push({ key, st });
      continue;
    }
    if (st === 'approx') p = earth;
    add(key, p, st);
  }
  if (s.planets) {
    for (const key of PLANETS) {
      const p = position(key, jd);
      if (p) add(key, p, 'ok');
    }
  }

  // Trails follow the true path in the chosen frame, so in the Earth-fixed
  // frame each sample is rotated by Earth's longitude at that sample time.
  const trails = {};
  if (s.trailDays > 0) {
    for (const b of bodies) {
      if (BODIES[b.key].kind !== 'sc' || b.st === 'approx') continue;
      const h = Math.min(info(b.key).step, s.trailDays / 160);
      const past = [];
      const future = [];
      for (let t = jd - s.trailDays; t <= jd + s.trailDays + 1e-9; t += h) {
        if (!covers(b.key, t)) continue;
        const p = position(b.key, t);
        const lon = s.frame === 'hee' ? earthLonAt(t) : eLon;
        if (!p || lon === null) continue;
        (t <= jd ? past : future).push(xy(p, lon));
      }
      past.push(b.xy);
      future.unshift(b.xy);
      trails[b.key] = { past, future };
    }
  }

  // Orbits of Earth and the planets: the inertial path over one period,
  // rotated as a rigid snapshot so it reads as an ellipse in either frame.
  const orbits = {};
  const orbitKeys = ['earth', ...(s.planets ? PLANETS : [])];
  for (const key of orbitKeys) {
    const period = BODIES[key].period ?? 365.25;
    const pts = [];
    for (let i = 0; i <= 240; i++) {
      const p = position(key, jd - (period * i) / 240);
      if (p) pts.push(xy(p));
    }
    orbits[key] = pts;
  }

  const spirals = {};
  if (s.spirals && s.view === 'top') {
    for (const b of bodies) {
      if (BODIES[b.key].kind === 'planet' && b.key !== 'earth') continue;
      if (b.key === 'sdo') continue;
      spirals[b.key] = parkerSpiral(b.p, s.wind).map((p) => xy(p));
    }
  }

  return { jd, earth, bodies, missing, trails, orbits, spirals, inset: buildInset(jd, eLon, earthLonAt) };
}

// Near-Earth view in a GSE-like frame: Sun straight up, Earth's direction of
// motion to the right (same handedness as the Earth-fixed main view).
function buildInset(jd, eLon, earthLonAt) {
  const gse = (g, lon) => project(toFrame(g, 'hee', lon), 'hee', 'top');
  const path = (key, days, step) => {
    const pts = [];
    for (let t = jd - days; t <= jd + 1e-9; t += step) {
      const g = position(key, t);
      const lon = earthLonAt(t);
      if (g && lon !== null) pts.push(gse(g, lon));
    }
    return pts;
  };
  const moon = position('moon_geo', jd);
  const adi = position('aditya_geo', jd);
  const adiOk = adi && jd >= jdOf(BODIES.aditya.launch);
  return {
    l1: [0, L1_KM],
    moon: moon ? gse(moon, eLon) : null,
    moonPath: path('moon_geo', 27.3, 0.25),
    aditya: adiOk ? gse(adi, eLon) : null,
    adityaPath: adiOk ? path('aditya_geo', 180, 1 / 6) : [],
    sdo: jd >= jdOf(BODIES.sdo.launch),
  };
}
