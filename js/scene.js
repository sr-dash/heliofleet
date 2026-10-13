// Turns a moment plus display settings into everything the renderer and the
// readout table need: projected positions, trails, spirals, status flags.

import { position, covers, info } from './ephem.js';
import {
  heliographic, footpointLon, parkerSpiral, angleBetween, eclipticLon,
  toFrame, project, norm, surfaceNormal, AU_KM,
} from './frames.js';
import { BODIES, SPACECRAFT, PLANETS, L1_FLEET } from './catalog.js';
import { activeCMEs } from './events.js';
import { tr } from './i18n.js';

const jdOf = (iso) => Date.parse(iso) / 864e5 + 2440587.5;
const L1_KM = 1.4915e6;

// Ephemeris series a body's heliocentric position is built from.
export function dataKeys(key) {
  const b = BODIES[key];
  return b?.derived ? [b.geoKey, 'earth'] : [key];
}

export function coversBody(key, t) {
  const b = BODIES[key];
  return covers(b?.derived ? b.geoKey : key, t);
}

// Heliocentric ecliptic position (au) of any body, or null.
export function helioPosition(key, t) {
  const b = BODIES[key];
  if (!b?.derived) return position(key, t);
  const g = position(b.geoKey, t);
  const e = position('earth', t);
  return g && e ? [e[0] + g[0] / AU_KM, e[1] + g[1] / AU_KM, e[2] + g[2] / AU_KM] : null;
}

// Ephemeris ranges a scene needs, so the caller can load them first.
export function needs(jd, s) {
  const out = [['earth', jd - Math.max(s.trailDays, 366), jd + s.trailDays]];
  for (const k of SPACECRAFT) for (const d of dataKeys(k)) out.push([d, jd - s.trailDays, jd + s.trailDays]);
  if (s.planets) for (const k of PLANETS) out.push([k, jd - BODIES[k].period - 2, jd]);
  out.push(['moon_geo', jd - 30, jd]);
  for (const k of L1_FLEET) out.push([BODIES[k].geoKey, jd - 200, jd]);
  return out;
}

export function status(key, jd, p) {
  const b = BODIES[key];
  if (b.launch && jd < jdOf(b.launch)) return 'prelaunch';
  if (b.ended && jd > jdOf(b.ended)) return 'ended';
  if (!p) return b.fallback ? 'approx' : 'nodata';
  if (b.lost && jd > jdOf(b.lost)) return 'lost';
  return 'ok';
}

// Position and status of a spacecraft at jd, applying the fallbacks the map
// uses (SDO at Earth past its ephemeris). Null when it is not on the map.
export function spacecraftAt(key, jd, earth) {
  const p = helioPosition(key, jd);
  const st = status(key, jd, p);
  if (st === 'prelaunch' || st === 'ended' || st === 'nodata') return { st, p: null };
  return { st, p: st === 'approx' ? earth : p };
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
    const { st, p } = spacecraftAt(key, jd, earth);
    if (!p) {
      missing.push({ key, st });
      continue;
    }
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
  // Near-Earth spacecraft would only retrace Earth's own path, so they skip.
  const trails = {};
  if (s.trailDays > 0) {
    for (const b of bodies) {
      const meta = BODIES[b.key];
      if (meta.kind !== 'sc' || meta.near || b.st === 'approx') continue;
      const h = Math.min(info(b.key).step, s.trailDays / 160);
      const past = [];
      const future = [];
      for (let t = jd - s.trailDays; t <= jd + s.trailDays + 1e-9; t += h) {
        if (!coversBody(b.key, t)) continue;
        const p = helioPosition(b.key, t);
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
      const meta = BODIES[b.key];
      if (meta.kind === 'planet' && b.key !== 'earth') continue;
      if (meta.near) continue;
      spirals[b.key] = parkerSpiral(b.p, s.wind).map((p) => xy(p));
    }
  }

  // A point on the Sun chosen in the visibility tool, as a direction.
  let spot = null;
  if (s.spot && s.spotOnMap) {
    const n = surfaceNormal(s.spot.lon, s.spot.lat, s.spot.sys, earth, jd);
    const sys = tr(s.spot.sys === 'carrington' ? 'Carrington' : 'Stonyhurst');
    const lat = `${s.spot.lat >= 0 ? '+' : '−'}${Math.abs(s.spot.lat)}°`;
    spot = { dir: xy(n), short: tr('Spot'), label: tr('Spot · {sys} {lon}°, {lat}', { sys, lon: s.spot.lon, lat }) };
  }

  // CME fronts from DONKI cone-model fits, moved out at constant speed and
  // drawn in the ecliptic plane across the cone's half-width.
  const cmes = [];
  if (s.cmes && s.view === 'top') {
    for (const c of activeCMEs(jd)) {
      const e21 = position('earth', c.jd21);
      if (!e21) continue;
      const n = surfaceNormal(c.lon, c.lat, 'stonyhurst', e21, c.jd21);
      const phi = Math.atan2(n[1], n[0]);
      const half = ((c.half ?? 30) * Math.PI) / 180;
      const arc = [];
      for (let i = 0; i <= 24; i++) {
        const a = phi - half + (2 * half * i) / 24;
        arc.push(xy([c.r * Math.cos(a), c.r * Math.sin(a), 0]));
      }
      cmes.push({
        id: c.id, arc, speed: c.speed,
        apex: xy([c.r * Math.cos(phi), c.r * Math.sin(phi), 0]),
        label: tr('CME {v} km/s', { v: c.speed.toLocaleString('en-US') }),
      });
    }
  }

  return {
    jd, earth, bodies, missing, trails, orbits, spirals, spot, cmes,
    inset: buildInset(jd, eLon, earthLonAt),
  };
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
  const fleet = [];
  for (const key of L1_FLEET) {
    const b = BODIES[key];
    if (jd < jdOf(b.launch)) continue;
    const g = position(b.geoKey, jd);
    if (!g) continue;
    const step = Math.max(info(b.geoKey)?.step ?? 0.5, 1 / 6);
    fleet.push({ key, pos: gse(g, eLon), path: path(b.geoKey, 180, step) });
  }
  return {
    l1: [0, L1_KM],
    moon: moon ? gse(moon, eLon) : null,
    moonPath: path('moon_geo', 27.3, 0.25),
    fleet,
    sdo: jd >= jdOf(BODIES.sdo.launch),
  };
}
