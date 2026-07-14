// Emits tvos/HeliosTVTests/Resources/orbit-goldens.json.
//
// The Swift Kepler solver is a reimplementation, and a hand-rolled Kepler solver is
// precisely where the near-parabolic divergence bug gets reintroduced (see the comment in
// app/orbits.ts). So the Swift port is not checked against "looks about right" — it is
// pinned to values produced by the TypeScript implementation, which is itself pinned to a
// bracketed reference solver by tests/orbits.test.mjs.
//
// Chain of custody: bisection oracle → orbits.ts → these goldens → Orbits.swift.
//
// Run: npm run catalog

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { DWARFS, PLANETS, SMALL_BODIES } from "../app/bodies.ts";
import { heliocentricPosition, solveKepler } from "../app/orbits.ts";

const bodies = [...PLANETS.slice(1), ...DWARFS, ...SMALL_BODIES];

// Dates chosen to bracket the hard cases, not just the easy ones: the range endpoints, a
// few perihelion neighbourhoods, and a spread across the middle.
const dates = [
  "1800-01-01", "1850-06-15", "1900-03-01", "1950-11-20", "1997-04-01",
  "2000-01-01", "2020-07-03", "2024-02-29", "2026-07-14", "2035-09-09", "2050-12-31",
];

const positions = [];
for (const body of bodies)
  for (const day of dates) {
    const { x, y, z } = heliocentricPosition(body, new Date(`${day}T12:00:00Z`));
    positions.push({ name: body.name, date: day, x, y, z });
  }

// Solver values sampled straight across the eccentricity range, including e values past
// 0.99 where Newton-from-M silently converges on the wrong root.
// Sampling the mean anomaly uniformly is a trap. Newton-from-M diverges only in a narrow band
// just off perihelion — at M near 0 and near 2π, where E races away from M — and a coarse
// uniform sweep steps straight over it. A first cut of these goldens used 12 evenly spaced M
// values and the *buggy* solver passed against them: the test looked green while being blind
// to the one failure it exists to catch. So sample densely where the maths is stiff.
const anomalies = [];
for (let step = 0; step < 24; step++) anomalies.push((step / 24) * 2 * Math.PI);
for (const near of [1e-4, 1e-3, 3e-3, 0.01, 0.03, 0.06, 0.1, 0.15, 0.22, 0.3, 0.45, 0.6, 0.9]) {
  anomalies.push(near);                 // just after perihelion
  anomalies.push(2 * Math.PI - near);   // just before it
}

const solver = [];
for (const e of [0, 0.05, 0.25, 0.5, 0.8, 0.95, 0.99, 0.995, 0.999, 0.9992])
  for (const meanAnomaly of anomalies)
    solver.push({ e, meanAnomaly, eccentricAnomaly: solveKepler(e, meanAnomaly) });

await mkdir(new URL("../tvos/HeliosTVTests/Resources/", import.meta.url), { recursive: true });
await writeFile(
  fileURLToPath(new URL("../tvos/HeliosTVTests/Resources/orbit-goldens.json", import.meta.url)),
  `${JSON.stringify({ generated: "scripts/emit-orbit-goldens.mjs — do not edit by hand", positions, solver }, null, 2)}\n`,
);

console.log(`goldens → tvos/HeliosTVTests/Resources/orbit-goldens.json (${positions.length} positions, ${solver.length} solver samples)`);
