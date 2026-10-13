// Numbers for the information card of one body at the current moment:
// heliocentric speed, light time, the Sun's apparent size, the Sun-body-Earth
// angle, and the perihelia either side of the moment.

import { ensure, position, info } from './ephem.js';
import { AU_KM, R_SUN_AU, angleBetween, norm } from './frames.js';
import { BODIES } from './catalog.js';
import { dataKeys, helioPosition } from './scene.js';

const C_KM_S = 299792.458;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

const posFn = (key) => (BODIES[key].kind === 'planet' ? (t) => position(key, t) : (t) => helioPosition(key, t));

export function liveFacts(key, scene) {
  const b = scene.bodies.find((x) => x.key === key);
  if (!b) return null;
  const pos = posFn(key);
  const h = 1 / 144; // 10 minutes; the curved path makes wider spans read low
  const p1 = pos(scene.jd - h);
  const p2 = pos(scene.jd + h);
  const speed = p1 && p2 && b.st !== 'approx' ? ((norm(sub(p2, p1)) / (2 * h)) * AU_KM) / 86400 : null;
  const toEarth = sub(scene.earth, b.p);
  return {
    ...b,
    speed,
    distKm: b.dist * AU_KM,
    sunDiameter: (2 * Math.asin(Math.min(1, R_SUN_AU / b.dist)) * 180) / Math.PI,
    lightMin: key === 'earth' ? null : (b.dEarth * AU_KM) / C_KM_S / 60,
    // Angle at the body between the Sun and Earth (small: Earth is near the Sun in its sky)
    spe: key === 'earth' ? null : angleBetween(b.p.map((v) => -v), toEarth),
  };
}

// Perihelia within about one orbit either side of jd, from the body's own
// samples. Returns { prev, next }, each { jd, r } or null.
export async function perihelia(key, jd) {
  const meta = BODIES[key];
  if (meta.near || key === 'earth') return { prev: null, next: null };
  const span = key === 'maven' || key === 'mars' ? 720 : 420;
  await ensure([...dataKeys(key), 'earth'], jd - span, jd + span);
  const m = info(dataKeys(key)[0]);
  if (!m) return { prev: null, next: null };
  const pos = posFn(key);
  const step = Math.min(m.step, 0.5);
  const t0 = Math.max(m.start, jd - span);
  const t1 = Math.min(m.end, jd + span);
  const ts = [];
  const rs = [];
  for (let t = t0; t <= t1; t += step) {
    const p = pos(t);
    if (p) { ts.push(t); rs.push(norm(p)); }
  }
  const w = Math.max(1, Math.round(20 / step));
  const minima = [];
  for (let i = 1; i < rs.length - 1; i++) {
    let low = true;
    for (let j = Math.max(0, i - w); j <= Math.min(rs.length - 1, i + w); j++) {
      if (rs[j] < rs[i]) { low = false; break; }
    }
    if (!low || i - w < 0 || i + w > rs.length - 1) continue;
    const den = rs[i - 1] - 2 * rs[i] + rs[i + 1];
    const off = den ? (0.5 * (rs[i - 1] - rs[i + 1])) / den : 0;
    minima.push({ jd: ts[i] + off * step, r: rs[i] - 0.25 * (rs[i - 1] - rs[i + 1]) * off });
  }
  return {
    prev: [...minima].reverse().find((x) => x.jd <= jd) ?? null,
    next: minima.find((x) => x.jd > jd) ?? null,
  };
}
