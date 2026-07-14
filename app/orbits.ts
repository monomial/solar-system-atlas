// Two-body orbital math. Deliberately free of Three.js and DOM so it can be unit-tested
// directly under `node --test` (see tests/orbits.test.mjs) — this is the one part of the
// atlas where a silent wrong answer is indistinguishable from a right one on screen.
//
// These remain two-body approximations: they ignore perturbations, so accuracy degrades
// away from each body's epoch. That is an accepted teaching-tool tradeoff. What is *not*
// acceptable is the solver failing to solve the ellipse we handed it, which is why
// solveKepler below is written the way it is.

export type KeplerianElements = {
  base: [number, number, number, number, number, number];
  rate: [number, number, number, number, number, number];
};
export type SmallBodyElements = { epochJD:number; a:number; e:number; i:number; node:number; peri:number; meanAnomaly:number; meanMotion:number };
export type OrbitingBody = { elements?: KeplerianElements; smallBody?: SmallBodyElements };
export type Vec3 = { x:number; y:number; z:number };

const J2000 = Date.UTC(2000, 0, 1, 12);
const JD_AT_UNIX_EPOCH = 2440587.5;

export function deg(v: number) { return v * Math.PI / 180; }
export function norm(v: number) { return ((v % 360) + 360) % 360; }

/** [a, e, inclination, meanAnomaly, node, argOfPerihelion] — a in AU, angles in degrees. */
export function orbitParamsAt(body: OrbitingBody, date = new Date()) {
  if (body.smallBody) {
    const jd = date.getTime() / 86400000 + JD_AT_UNIX_EPOCH, o = body.smallBody;
    return [o.a, o.e, o.i, norm(o.meanAnomaly + o.meanMotion * (jd - o.epochJD)), o.node, o.peri];
  }
  if (!body.elements) return [0, 0, 0, 0, 0, 0];
  const centuries = (date.getTime() - J2000) / 86400000 / 36525;
  const [a, e, inc, L, longPeri, node] = body.elements.base.map((v, i) => v + body.elements!.rate[i] * centuries);
  return [a, e, inc, norm(L - longPeri), node, longPeri - node];
}

// Solves Kepler's equation E - e*sin(E) = M for the eccentric anomaly.
//
// The obvious approach — Newton starting from E = M — diverges as e approaches 1, because
// the derivative (1 - e*cos E) collapses toward zero near perihelion and Newton overshoots
// onto a different root. It converges on the wrong answer rather than failing, which put
// NEOWISE (e=.9992) and Hale-Bopp (e=.9950) hundreds of AU off their true positions for
// roughly a fifth of the atlas's date range. Danby's starter keeps the first guess out of
// that singular region and Halley's cubic iteration closes fast from there; tests/orbits
// pins every body we carry to a bracketed reference solver across all of 1800-2050.
export function solveKepler(e: number, M: number) {
  let E = M + .85 * e * (Math.sign(Math.sin(M)) || 1);
  for (let i = 0; i < 60; i++) {
    const f = E - e * Math.sin(E) - M, f1 = 1 - e * Math.cos(E), f2 = e * Math.sin(E);
    const step = -f / (f1 - f * f2 / (2 * f1));
    if (!Number.isFinite(step)) break;
    E += step;
    if (Math.abs(step) < 1e-12) break;
  }
  return E;
}

function pointFrom(params: number[], E: number): Vec3 {
  const [a, e, inc, , node, peri] = params;
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const w = deg(peri), O = deg(node), I = deg(inc);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(I), sI = Math.sin(I);
  return {
    x: (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    y: sw * sI * xp + cw * sI * yp,
    z: (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
  };
}

export function orbitalPoint(body: OrbitingBody, E: number, date = new Date()): Vec3 {
  return pointFrom(orbitParamsAt(body, date), E);
}

export function heliocentricPosition(body: OrbitingBody, date = new Date()): Vec3 {
  if (!body.elements && !body.smallBody) return { x:0, y:0, z:0 };
  const params = orbitParamsAt(body, date);
  return pointFrom(params, solveKepler(params[1], deg(params[3])));
}

export function heliocentricDistanceAU(body: OrbitingBody, date = new Date()) {
  const { x, y, z } = heliocentricPosition(body, date);
  return Math.hypot(x, y, z);
}

/** One closed orbit as `segments`+1 points. Solves the elements once rather than per sample. */
export function orbitPath(body: OrbitingBody, date: Date, segments: number): Vec3[] {
  const params = orbitParamsAt(body, date), points: Vec3[] = [];
  for (let i = 0; i <= segments; i++) points.push(pointFrom(params, (i / segments) * Math.PI * 2));
  return points;
}
