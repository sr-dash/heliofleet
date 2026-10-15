// An observer's plane of the sky: the plane through Sun centre perpendicular
// to the Sun-observer line, with solar north up and west to the right as that
// observer sees it, in solar radii. Each instrument's field of view is
// projected onto it by following its lines of sight to where they cross the
// plane; bodies are placed where the observer sees them (true perspective).

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
  cor1a: { type: 'annulus' }, cor1b: { type: 'annulus' }, velc: { type: 'annulus' }, ccor1: { type: 'annulus' },
  ccor2: { type: 'annulus' }, aspiics: { type: 'annulus' }, nfi: { type: 'annulus' },
  // PUNCH's three WFI cameras together cover all position angles
  wfi: { type: 'annulus' },
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

export function makeSky(observer) {
  const ax = earthSkyAxes(observer); // the same construction works for any observer
  const r = norm(observer) / R_SUN_AU;
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
  // Where the observer sees point X, or null if X is behind the observer
  const seen = (X) => hit(observer, unit(sub(X, observer)));
  return {
    ax, toPlane, hit, seen,
    // The Sun's limb seen from this distance, as a radius on the plane
    limb: 1 / Math.sqrt(Math.max(1e-6, 1 - 1 / (r * r))),
  };
}

// Sky direction from an observer of a helioprojective point (Tx, Ty in
// arcsec): Tx is the longitude toward solar west, Ty the latitude toward
// solar north, both measured from Sun centre, as in SunPy.
export function hpcDirection(observer, tx, ty) {
  const ax = earthSkyAxes(observer);
  const a = (tx / 3600) * D;
  const b = (ty / 3600) * D;
  return add(mul(ax.e, -Math.cos(b) * Math.cos(a)), add(mul(ax.west, Math.cos(b) * Math.sin(a)), mul(ax.north, Math.sin(b))));
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

// The frame of one instrument's field: its sky basis and shape parameters.
// Annuli are elongation ranges; squares and circles are centred on c, with
// a (toward larger elongation) and b completing an orthonormal set.
export function fovFrame(ins, shape, P, sideSign, dist) {
  const B = skyBasis(P);
  const toDeg = (v) => (ins.unit === 'rs' ? Math.atan((v * R_SUN_AU) / dist) / D : v);
  if (shape.type === 'annulus') return { B, type: 'annulus', e0: toDeg(ins.inner), e1: toDeg(ins.outer) };
  // Field centre, offset to the chosen side and in latitude
  const psi0 = sideSign > 0 ? 0 : 180;
  const c0 = dirAt(B, shape.centre, psi0);
  const c = shape.lat ? unit(add(mul(c0, Math.cos(shape.lat * D)), mul(B.v, Math.sin(shape.lat * D)))) : c0;
  const a0 = sub(dirAt(B, shape.centre + 1, psi0), c);
  const a = unit(sub(a0, mul(c, dot(a0, c))));
  const b = cross(c, a);
  const f = { B, type: shape.type, c, a, b, cut: shape.cut ?? 0 };
  if (shape.type === 'square') f.h = Math.tan(shape.half * D);
  else f.r = shape.radius * D;
  return f;
}

// Whether the unit direction d lies in the field
export function inField(f, d) {
  const elong = Math.acos(Math.max(-1, Math.min(1, dot(d, f.B.u)))) / D;
  if (f.type === 'annulus') return elong >= f.e0 && elong <= f.e1;
  if (f.cut && elong < f.cut) return false;
  const dc = dot(d, f.c);
  if (f.type === 'square') return dc > 0 && Math.abs(dot(d, f.a) / dc) <= f.h && Math.abs(dot(d, f.b) / dc) <= f.h;
  return Math.acos(Math.max(-1, Math.min(1, dc))) <= f.r;
}

// Grid of sky directions covering one instrument's field: rows x cols of
// unit vectors, so neighbouring cells can be drawn as quadrilaterals.
export function fovGrid(ins, shape, P, sideSign, dist) {
  const f = fovFrame(ins, shape, P, sideSign, dist);
  const B = f.B;
  if (f.type === 'annulus') {
    return grid(10, 72, (i, j) => dirAt(B, f.e0 + ((f.e1 - f.e0) * i) / 10, (360 * j) / 72));
  }
  const { c, a, b } = f;
  const cut = (d) => (f.cut && Math.acos(Math.min(1, dot(d, B.u))) / D < f.cut ? null : d);
  if (f.type === 'square') {
    return grid(24, 24, (i, j) => cut(unit(add(c, add(mul(a, f.h * (2 * i / 24 - 1)), mul(b, f.h * (2 * j / 24 - 1)))))));
  }
  return grid(16, 48, (i, j) => {
    const al = (f.r * i) / 16;
    const be = (2 * Math.PI * j) / 48;
    return cut(unit(add(mul(c, Math.cos(al)), mul(add(mul(a, Math.cos(be)), mul(b, Math.sin(be))), Math.sin(al)))));
  });
}

// How an observer at P sees the heliocentric point X: elongation (deg) from
// Sun centre, position angle (deg, from solar north toward east) and
// whether the Sun hides it
export function viewOf(P, X) {
  const d = unit(sub(X, P));
  const ax = earthSkyAxes(P);
  const elong = Math.acos(Math.max(-1, Math.min(1, -dot(d, ax.e)))) / D;
  const pa = ((Math.atan2(-dot(d, ax.west), dot(d, ax.north)) / D) + 360) % 360;
  // Closest approach of the line of sight to Sun centre, before reaching X
  const t = -dot(P, d);
  const reach = norm(sub(X, P));
  const closest = norm(add(P, mul(d, t)));
  const hidden = norm(X) < R_SUN_AU || (t > 0 && t < reach && closest < R_SUN_AU);
  return { d, elong, pa, hidden };
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
