// Space-weather events from NASA's DONKI catalogue (data/events.json, built
// monthly by scripts/fetch_events.py) and the upcoming-geometry calendar
// (data/upcoming.json, built by scripts/build_calendar.py).

import { AU_KM, R_SUN_AU } from './frames.js';

const jdOf = (iso) => Date.parse(iso) / 864e5 + 2440587.5;
let EVENTS = null;
let UPCOMING = null;

async function getJSON(path) {
  try {
    const r = await fetch(path, { cache: 'no-cache' });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export async function loadEvents() {
  [EVENTS, UPCOMING] = await Promise.all([getJSON('data/events.json'), getJSON('data/upcoming.json')]);
  if (EVENTS) {
    for (const f of EVENTS.flares) f.jd = jdOf(f.t);
    for (const c of EVENTS.cmes) { c.jd = jdOf(c.t); c.jd21 = c.t21 ? jdOf(c.t21) : null; }
    for (const s of EVENTS.storms) s.jd = jdOf(s.t);
  }
  return { events: EVENTS, upcoming: UPCOMING };
}

export const events = () => EVENTS;
export const upcoming = () => UPCOMING;

// "S22W10" -> Stonyhurst { lat: -22, lon: 10 } (west positive)
export function parseLocation(loc) {
  const m = /^([NS])(\d+)([EW])(\d+)$/.exec(loc || '');
  if (!m) return null;
  return { lat: (m[1] === 'S' ? -1 : 1) * +m[2], lon: (m[3] === 'E' ? -1 : 1) * +m[4] };
}

// Flare class -> peak X-ray flux (W m^-2), for sizing markers
export function flareFlux(cls) {
  const m = /^([ABCMX])(\d+(?:\.\d+)?)/.exec(cls || '');
  const base = { A: 1e-8, B: 1e-7, C: 1e-6, M: 1e-5, X: 1e-4 };
  return m ? base[m[1]] * +m[2] : 0;
}

export const G_LABEL = { 3: 'G3 strong', 4: 'G4 severe', 5: 'G5 extreme' };

// CMEs whose leading edge is between 21.5 solar radii and `maxAU` at jd,
// assuming constant speed after the 21.5 Rs time (the cone-model inputs).
const R21 = 21.5 * R_SUN_AU;
export function activeCMEs(jd, maxAU = 2.2) {
  if (!EVENTS) return [];
  const out = [];
  for (const c of EVENTS.cmes) {
    if (c.jd21 === null || c.lon === null || c.lat === null || jd < c.jd21) continue;
    const r = R21 + (c.speed * (jd - c.jd21) * 86400) / AU_KM;
    if (r <= maxAU) out.push({ ...c, r });
  }
  return out;
}

export const KIND_LABEL = {
  perihelion: 'Perihelion',
  alignment: 'Alignment',
  quadrature: 'Quadrature',
  conjunction: 'Solar conjunction',
  eclipse: 'Eclipse',
};
