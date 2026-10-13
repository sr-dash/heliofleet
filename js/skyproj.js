// Earth's plane of the sky: the plane through Sun centre perpendicular to the
// Sun-Earth line, with solar north up and west to the right, in solar radii.
// Each instrument's field of view is projected onto it by following its lines
// of sight from the spacecraft to where they cross the plane.

import { R_SUN_AU, earthSkyAxes, dot, norm } from './frames.js';

const D = Math.PI / 180;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => mul(a, 1 / norm(a));

// Two-dimensional fields of view in each spacecraft's sky. Elongation is the
// angle from Sun centre; 'side' is resolved as on the map. Shapes follow the
// instrument papers; HI and WISPR fields are approximated as squares or
// circles of the published size.
export const SKY_SHAPES = {
  c2: { type: 'annulus' }, c3: { type: 'annulus' }, cor2a: { type: 'annulus' },
  cor2b: { type: 'annulus' }, metis: { type: 'annulus' },
  hi1a: { type: 'square', centre: 14, half: 10 }, hi1b: { type: 'square', centre: 14, half: 10 },
  hi2a: { type: 'circle', centre: 53.7, radius: 35 }, hi2b: { type: 'circle', centre: 53.7, radius: 35 },
  solohi: { type: 'circle', centre: 25, radius: 20, cut: 5.4 },
  wispri: { type: 'square', centre: 33.5, half: 20, lat: -10 },
  wispro: { type: 'square', centre: 79, half: 29, lat: -10 },
};

// Ground-based coronagraphs, centred on the Sun in Earth's sky (solar radii)
export const GROUND = [
  { id: 'kcor', name: 'MLSO K-Cor', inner: 1.05, outer: 3.0, colorVar: '--c-earth' },
  { id: 'ucomp', name: 'MLSO UCoMP', inner: 1.05, outer: 2.0, colorVar: '--c-earth' },
];

export function makeSky(earth) {
  const ax = earthSkyAxes(earth);
  // Plane coordinates (west, north) in solar radii of a heliocentric point
  const toPlane = (X) => [dot(X, ax.west) / R_SUN_AU, dot(X, ax.north) / R_SUN_AU];
  // Where the ray P + t d crosses the plane X.e = 0, or null if it never does
  const hit = (P, d) => {
    const den = dot(d, ax.e);
    if (Math.abs(den) < 1e-9) return null;
    const t = -dot(P, ax.e) / den;
    if (t <= 0) return null;
    return toPlane(add(P, mul(d, t)));
  };
  return { ax, toPlane, hit };
}

// Sky basis at a spacecraft: u toward the Sun, w toward solar east in the
// ecliptic, v completing toward ecliptic north.
function skyBasis(P) {
  const u = unit(mul(P, -1));
  const w = unit(cross([0, 0, 1], u));
  return { u, w, v: cross(u, w) };
}

// Direction for elongation eps (deg) at angle psi (deg, from east toward north)
function dirAt(B, eps, psi) {
  const e = eps * D;
  const p = psi * D;
  return unit(add(mul(B.u, Math.cos(e)), mul(add(mul(B.w, Math.cos(p)), mul(B.v, Math.sin(p))), Math.sin(e))));
}

// Grid of sky directions covering one instrument's field: rows x cols of
// unit vectors, so neighbouring cells can be drawn as quadrilaterals.
export function fovGrid(ins, shape, P, sideSign, dist) {
  const B = skyBasis(P);
  const toDeg = (v) => (ins.unit === 'rs' ? Math.atan((v * R_SUN_AU) / dist) / D : v);
  if (shape.type === 'annulus') {
    const e0 = toDeg(ins.inner);
    const e1 = toDeg(ins.outer);
    return grid(10, 72, (i, j) => dirAt(B, e0 + ((e1 - e0) * i) / 10, (360 * j) / 72));
  }
  // Field centre, offset to the chosen side and in latitude
  const psi0 = sideSign > 0 ? 0 : 180;
  const c0 = dirAt(B, shape.centre, psi0);
  const c = shape.lat ? unit(add(mul(c0, Math.cos(shape.lat * D)), mul(B.v, Math.sin(shape.lat * D)))) : c0;
  const a = unit(sub(dirAt(B, shape.centre + 1, psi0), c)); // toward larger elongation
  const b = cross(c, a);
  const cut = (d) => (shape.cut && Math.acos(Math.min(1, dot(d, B.u))) / D < shape.cut ? null : d);
  if (shape.type === 'square') {
    const h = Math.tan(shape.half * D);
    return grid(24, 24, (i, j) => cut(unit(add(c, add(mul(a, h * (2 * i / 24 - 1)), mul(b, h * (2 * j / 24 - 1)))))));
  }
  const r = shape.radius * D;
  return grid(16, 48, (i, j) => {
    const al = (r * i) / 16;
    const be = (2 * Math.PI * j) / 48;
    return cut(unit(add(mul(c, Math.cos(al)), mul(add(mul(a, Math.cos(be)), mul(b, Math.sin(be))), Math.sin(al)))));
  });
}

function grid(n, m, f) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const row = [];
    for (let j = 0; j <= m; j++) row.push(f(i, j));
    out.push(row);
  }
  return out;
}

// --- Sun altitude at a ground site (low-precision solar position, ~0.01 deg)
export const SITES = [
  { id: 'dkist', name: 'DKIST (Haleakalā)', lat: 20.7067, lon: -156.2569 },
  { id: 'mlso', name: 'MLSO (Mauna Loa)', lat: 19.5362, lon: -155.5763 },
];

export function sunAltitude(jd, lat, lon) {
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) * D;
  const g = (357.528 + 0.9856003 * n) * D;
  const lam = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D;
  const eps = (23.439 - 0.0000004 * n) * D;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const gmst = ((18.697374558 + 24.06570982441908 * n) % 24) * 15 * D;
  const H = gmst + lon * D - ra;
  const phi = lat * D;
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)) / D;
}

// The daylight window (Sun above minAlt) containing jd, or the next one
export function observingWindow(jd, site, minAlt = 10) {
  const step = 5 / 1440;
  const up = (t) => sunAltitude(t, site.lat, site.lon) >= minAlt;
  let t = jd;
  if (!up(t)) {
    while (t < jd + 1.5 && !up(t)) t += step;
    if (!up(t)) return null;
  }
  let a = t;
  while (a > jd - 1 && up(a - step)) a -= step;
  let b = t;
  while (b < t + 1 && up(b + step)) b += step;
  return { start: a, end: b, now: up(jd) };
}
