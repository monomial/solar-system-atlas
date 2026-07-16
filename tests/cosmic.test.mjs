import assert from "node:assert/strict";
import test from "node:test";

import { COSMIC_JOURNEY, GALACTIC_REGIONS, NEARBY_GALAXIES } from "../app/cosmic.ts";

test("cosmic atlas catalogs have stable unique identifiers", () => {
  for (const catalog of [GALACTIC_REGIONS, NEARBY_GALAXIES]) {
    assert.equal(new Set(catalog.map((item) => item.id)).size, catalog.length);
    assert.ok(catalog.every((item) => item.name && item.description && item.fact && /^#[0-9a-f]{6}$/i.test(item.color)));
  }
});

test("the Sun marker is placed at the documented galactocentric radius", () => {
  const sun = GALACTIC_REGIONS.find((region) => region.id === "solar-system");
  assert.ok(sun);
  const radius = Math.hypot(...sun.position);
  assert.ok(radius > 25 && radius < 27, `${radius} thousand light-years is outside the intended range`);
});

test("Local Group distances preserve the educational ordering", () => {
  const byId = Object.fromEntries(NEARBY_GALAXIES.map((galaxy) => [galaxy.id, galaxy]));
  assert.equal(byId["milky-way"].distanceMly, 0);
  assert.ok(byId.lmc.distanceMly < byId.smc.distanceMly);
  assert.ok(byId.smc.distanceMly < byId["ngc-6822"].distanceMly);
  assert.ok(byId.andromeda.distanceMly < byId.triangulum.distanceMly);
  assert.ok(NEARBY_GALAXIES.every((galaxy) => galaxy.distanceMly >= 0 && galaxy.visualSize > 0));
});

test("the cosmic address journey crosses all three atlas layers", () => {
  assert.deepEqual(new Set(COSMIC_JOURNEY.map((stop) => stop.mode)), new Set(["solar", "galaxy", "local"]));
  for (const stop of COSMIC_JOURNEY) {
    assert.ok(stop.title && stop.note && stop.focus);
    if (stop.mode === "galaxy") assert.ok(GALACTIC_REGIONS.some((region) => region.id === stop.focus));
    if (stop.mode === "local") assert.ok(NEARBY_GALAXIES.some((galaxy) => galaxy.id === stop.focus));
  }
});
