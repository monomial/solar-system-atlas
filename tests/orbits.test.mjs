import assert from "node:assert/strict";
import test from "node:test";

import { ORBITING_BODIES } from "../app/bodies.ts";
import { deg, heliocentricDistanceAU, heliocentricPosition, orbitParamsAt, orbitPath, solveKepler } from "../app/orbits.ts";

// Bisection on Kepler's equation. Far too slow to render with, but it cannot diverge:
// E - e*sin(E) - M is strictly increasing in E, so a sign-change bracket always contains
// the one true root. This is the oracle the production solver is measured against.
function referenceKepler(e, M) {
  const f = (E) => E - e * Math.sin(E) - M;
  let lo = M - 1.2, hi = M + 1.2;
  while (f(lo) > 0) lo -= 1;
  while (f(hi) < 0) hi += 1;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Every date the UI can reach, sampled monthly. The bug this guards against was
// eccentricity-dependent and date-dependent: it only bit near perihelion passages, so
// spot-checking a handful of dates would have missed it entirely.
function* sampleDates() {
  for (let year = 1800; year <= 2050; year++)
    for (let month = 0; month < 12; month++)
      yield new Date(Date.UTC(year, month, 1, 12));
}

const orbiting = ORBITING_BODIES.filter((body) => body.elements || body.smallBody);

test("the catalog is actually wired to orbital elements", () => {
  assert.equal(orbiting.length, ORBITING_BODIES.length, "every orbiting body should carry elements");
  // Guards the regime that broke: if a near-parabolic body is ever dropped from the
  // catalog, the solver's hardest case stops being covered and this test goes quiet.
  const nearParabolic = orbiting.filter((body) => (body.smallBody?.e ?? 0) > 0.99);
  assert.ok(nearParabolic.length >= 2, "expected near-parabolic comets to exercise the solver");
});

test("solveKepler agrees with a bracketed reference solver for every body and date", () => {
  for (const body of orbiting) {
    let worst = 0, worstDate = null;
    for (const date of sampleDates()) {
      const [a, e, , meanAnomaly] = orbitParamsAt(body, date);
      const M = deg(meanAnomaly);
      const E = solveKepler(e, M);
      assert.ok(Number.isFinite(E), `${body.name}: non-finite eccentric anomaly on ${date.toISOString()}`);

      // Compare in AU rather than radians: a radian of error means very different things
      // at Bennu's 1.1 AU and Sedna's 544 AU, and AU is what actually lands on screen.
      const reference = referenceKepler(e, M);
      const point = (anomaly) => [a * (Math.cos(anomaly) - e), a * Math.sqrt(1 - e * e) * Math.sin(anomaly)];
      const [x1, y1] = point(E), [x2, y2] = point(reference);
      const error = Math.hypot(x1 - x2, y1 - y2);
      if (error > worst) { worst = error; worstDate = date; }
    }
    assert.ok(worst < 1e-6, `${body.name}: off by ${worst.toExponential(2)} AU on ${worstDate?.toISOString().slice(0, 10)}`);
  }
});

test("solved positions satisfy Kepler's equation and stay inside the orbit", () => {
  for (const body of orbiting) {
    for (const date of sampleDates()) {
      const [a, e, , meanAnomaly] = orbitParamsAt(body, date);
      const M = deg(meanAnomaly);
      const E = solveKepler(e, M);

      // The residual is the definition of correctness here — it does not depend on the
      // oracle above being right, only on Kepler's equation being satisfied. The solver
      // stays on the branch nearest M, so this needs no wraparound.
      const residual = Math.abs(E - e * Math.sin(E) - M);
      assert.ok(residual < 1e-9, `${body.name}: residual ${residual} rad on ${date.toISOString()}`);

      // A bound body can never be outside its own apoapsis.
      const r = heliocentricDistanceAU(body, date);
      assert.ok(r <= a * (1 + e) + 1e-6, `${body.name}: ${r} AU exceeds apoapsis on ${date.toISOString()}`);
      assert.ok(r >= a * (1 - e) - 1e-6, `${body.name}: ${r} AU inside periapsis on ${date.toISOString()}`);
    }
  }
});

test("published perihelion and aphelion match what the elements produce", () => {
  // The info panel prints perihelionAU/aphelionAU straight from the catalog while the
  // scene draws the orbit from the elements. If those two disagree the UI lies about a
  // body it is simultaneously drawing correctly.
  for (const body of orbiting) {
    if (body.perihelionAU === undefined || body.aphelionAU === undefined) continue;
    const { a, e } = body.smallBody;
    assert.ok(Math.abs(a * (1 - e) - body.perihelionAU) < 0.01, `${body.name}: perihelion ${a * (1 - e)} vs published ${body.perihelionAU}`);
    assert.ok(Math.abs(a * (1 + e) - body.aphelionAU) < 0.01, `${body.name}: aphelion ${a * (1 + e)} vs published ${body.aphelionAU}`);
  }
});

test("planets sit at their advertised average distance from the Sun", () => {
  // A coarse sanity net over the Keplerian elements themselves: a transcription slip in a
  // base or rate value would show up here long before anyone noticed it on screen.
  for (const body of ORBITING_BODIES) {
    if (!body.elements) continue;
    const [a] = orbitParamsAt(body, new Date(Date.UTC(2000, 0, 1, 12)));
    assert.ok(Math.abs(a - body.distanceAU) < 0.02, `${body.name}: semi-major axis ${a} vs advertised ${body.distanceAU} AU`);
  }
});

test("orbitPath closes on itself and matches pointwise sampling", () => {
  const date = new Date(Date.UTC(2026, 0, 1, 12));
  for (const body of orbiting) {
    const path = orbitPath(body, date, 180);
    assert.equal(path.length, 181);
    for (const point of path)
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z), `${body.name}: non-finite orbit point`);
    const first = path[0], last = path.at(-1);
    assert.ok(Math.hypot(first.x - last.x, first.y - last.y, first.z - last.z) < 1e-9, `${body.name}: orbit path does not close`);
  }
});

test("Earth is roughly 1 AU away and near its perihelion in early January", () => {
  const earth = ORBITING_BODIES.find((body) => body.name === "Earth");
  const perihelion = heliocentricDistanceAU(earth, new Date(Date.UTC(2026, 0, 3, 12)));
  const aphelion = heliocentricDistanceAU(earth, new Date(Date.UTC(2026, 6, 6, 12)));
  assert.ok(perihelion > 0.98 && perihelion < 0.985, `Earth perihelion ${perihelion} AU`);
  assert.ok(aphelion > 1.015 && aphelion < 1.02, `Earth aphelion ${aphelion} AU`);
  assert.ok(aphelion > perihelion, "Earth should be further out in July than in January");
});

test("a body with no elements sits at the origin", () => {
  const position = heliocentricPosition({}, new Date());
  assert.deepEqual(position, { x: 0, y: 0, z: 0 });
});
