// Solar coordinate geometry on ICRF-ecliptic (J2000) heliocentric vectors.
// Stonyhurst (HEEQ) and Carrington longitudes follow the IAU solar rotation
// model (pole RA 286.13°, Dec 63.87°, W = 84.176° + 14.1844° d), the same
// convention used by SunPy.

const D = Math.PI / 180;
const EPS = 23.4392911 * D; // obliquity of the J2000 ecliptic
const AU_KM = 149597870.7;
const C_KM_S = 299792.458;
export const R_SUN_AU = 695700 / AU_KM;
const OMEGA_SIDEREAL = (14.1844 * D) / 86400; // rad/s, matches the Carrington rate

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (a) => scale(a, 1 / norm(a));
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const eqToEcl = (v) => [
  v[0],
  v[1] * Math.cos(EPS) + v[2] * Math.sin(EPS),
  -v[1] * Math.sin(EPS) + v[2] * Math.cos(EPS),
];
const wrap360 = (a) => ((a % 360) + 360) % 360;
const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

const A0 = 286.13 * D;
const D0 = 63.87 * D;
const POLE = eqToEcl([Math.cos(D0) * Math.cos(A0), Math.cos(D0) * Math.sin(A0), Math.sin(D0)]);
const NODE = eqToEcl([Math.cos(A0 + Math.PI / 2), Math.sin(A0 + Math.PI / 2), 0]);
const NODE_Q = cross(POLE, NODE);

// Prime meridian direction of the Carrington frame at Julian date jd (UT).
function primeMeridian(jdUT) {
  const d = jdUT + 69.2 / 86400 - 2451545.0; // UT -> TT
  const w = (84.176 + 14.1844 * d) * D;
  const m = [0, 1, 2].map((i) => NODE[i] * Math.cos(w) + NODE_Q[i] * Math.sin(w));
  return [m, cross(POLE, m)];
}

// Heliographic coordinates of position r (au) at time jd, with Earth at e.
export function heliographic(r, e, jd) {
  const dist = norm(r);
  const ru = scale(r, 1 / dist);
  const x = unit(sub(e, scale(POLE, dot(e, POLE))));
  const y = cross(POLE, x);
  const lat = Math.asin(dot(ru, POLE)) / D;
  const lon = Math.atan2(dot(ru, y), dot(ru, x)) / D;
  // Carrington longitude as seen from Earth: the Sun is observed one
  // Sun-Earth light time in the past.
  const [m, my] = primeMeridian(jd - (norm(e) * AU_KM) / C_KM_S / 86400);
  const carr = wrap360(Math.atan2(dot(ru, my), dot(ru, m)) / D);
  return { dist, lat, lon: wrap180(lon), carr };
}

// Stonyhurst longitude of the Parker-spiral footpoint of a body at radius r
// (au) for solar-wind speed v (km/s).
export function footpointLon(lon, r, v) {
  return wrap180(lon + ((OMEGA_SIDEREAL * (r - R_SUN_AU) * AU_KM) / v) / D);
}

// Points along the Parker spiral through ecliptic position p (au), returned in
// the same ecliptic frame. Ignores latitude, as is customary for these plots.
export function parkerSpiral(p, v, n = 90) {
  const rb = Math.hypot(p[0], p[1]);
  const phb = Math.atan2(p[1], p[0]);
  const k = (OMEGA_SIDEREAL * AU_KM) / v; // rad per au
  const out = [];
  for (let i = 0; i <= n; i++) {
    const r = R_SUN_AU + ((rb - R_SUN_AU) * i) / n;
    const ph = phb + k * (rb - r);
    out.push([r * Math.cos(ph), r * Math.sin(ph), 0]);
  }
  return out;
}

export const angleBetween = (a, b) =>
  Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (norm(a) * norm(b))))) / D;

export const eclipticLon = (p) => Math.atan2(p[1], p[0]);

// Rotate an ecliptic vector into the display frame.
//   hee: Heliocentric Earth Ecliptic, +x toward Earth, z = ecliptic north
//   hae: inertial ecliptic J2000
export function toFrame(p, frame, earthLon) {
  if (frame !== 'hee') return p;
  const c = Math.cos(earthLon);
  const s = Math.sin(earthLon);
  return [c * p[0] + s * p[1], -s * p[0] + c * p[1], p[2]];
}

// Project a display-frame vector to 2D screen axes (right, up).
//   top view, hee: Earth at the bottom, its direction of motion to the right
//   side view: frame x to the right, ecliptic north up
export function project(p, frame, view) {
  if (view === 'side') return [p[0], p[2]];
  if (frame === 'hee') return [p[1], -p[0]];
  return [p[0], p[1]];
}

export { D as DEG, AU_KM };
