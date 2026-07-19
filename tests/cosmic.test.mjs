import assert from "node:assert/strict";
import test from "node:test";

import { COSMIC_JOURNEY, GALACTIC_REGIONS, NEARBY_GALAXIES, UNIVERSE_LANDMARKS } from "../app/cosmic.ts";

test("cosmic atlas catalogs have stable unique identifiers", () => {
  for (const catalog of [GALACTIC_REGIONS, NEARBY_GALAXIES, UNIVERSE_LANDMARKS]) {
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

test("galactic locations use semantic locator symbols", () => {
  const byId = Object.fromEntries(GALACTIC_REGIONS.map((region) => [region.id, region]));
  assert.equal(byId.center.markerKind, "center");
  assert.equal(byId["solar-system"].markerKind, "home");
  assert.ok(GALACTIC_REGIONS.filter((region) => !["center", "solar-system"].includes(region.id)).every((region) => region.markerKind === "region"));
});

test("Local Group distances preserve the educational ordering", () => {
  const byId = Object.fromEntries(NEARBY_GALAXIES.map((galaxy) => [galaxy.id, galaxy]));
  assert.equal(byId["milky-way"].distanceMly, 0);
  assert.ok(byId.lmc.distanceMly < byId.smc.distanceMly);
  assert.ok(byId.smc.distanceMly < byId["ngc-6822"].distanceMly);
  assert.ok(byId.andromeda.distanceMly < byId.triangulum.distanceMly);
  assert.ok(NEARBY_GALAXIES.every((galaxy) => galaxy.distanceMly >= 0 && galaxy.visualSize > 0));
});

test("Local Group coordinates preserve distance scale and subgroup topology", () => {
  const byId = Object.fromEntries(NEARBY_GALAXIES.map((galaxy) => [galaxy.id, galaxy]));
  const separation = (a, b) => Math.hypot(...a.position.map((value, index) => value - b.position[index]));
  const home = byId["milky-way"];
  for (const galaxy of NEARBY_GALAXIES.filter((item) => item.id !== "milky-way")) {
    const mappedDistance = separation(home, galaxy) / 20;
    const relativeError = Math.abs(mappedDistance - galaxy.distanceMly) / galaxy.distanceMly;
    assert.ok(relativeError < .12, `${galaxy.name} coordinate distance differs by ${(relativeError * 100).toFixed(1)}%`);
  }
  assert.ok(separation(byId.andromeda, byId.triangulum) < separation(home, byId.triangulum), "M33 should sit in the Andromeda subgroup");
  assert.ok(separation(home, byId.lmc) < separation(byId.andromeda, byId.lmc), "LMC should sit in the Milky Way subgroup");
  assert.ok(separation(home, byId.smc) < separation(byId.andromeda, byId.smc), "SMC should sit in the Milky Way subgroup");
});

test("the universe catalog carries the eleven approved distinct anchors", () => {
  assert.deepEqual(UNIVERSE_LANDMARKS.map((item) => item.name), ["Our Local Group", "Virgo Cluster", "Laniakea", "Shapley Concentration", "Boötes Void", "Sloan Great Wall", "Coma Cluster", "Perseus–Pisces Supercluster", "3C 273", "JADES-GS-z14-0", "Cosmic Microwave Background"]);
  assert.equal(UNIVERSE_LANDMARKS.find((item) => item.id === "3c-273")?.schematic, true);
  assert.equal(UNIVERSE_LANDMARKS.find((item) => item.id === "jades-gs-z14-0")?.schematic, true);
});

test("the cosmic address journey crosses all four atlas layers", () => {
  assert.deepEqual(new Set(COSMIC_JOURNEY.map((stop) => stop.mode)), new Set(["solar", "galaxy", "local", "universe"]));
  for (const stop of COSMIC_JOURNEY) {
    assert.ok(stop.title && stop.note && stop.focus);
    if (stop.mode === "galaxy") assert.ok(GALACTIC_REGIONS.some((region) => region.id === stop.focus));
    if (stop.mode === "local") assert.ok(NEARBY_GALAXIES.some((galaxy) => galaxy.id === stop.focus));
    if (stop.mode === "universe") assert.ok(UNIVERSE_LANDMARKS.some((landmark) => landmark.id === stop.focus));
  }
  assert.equal(COSMIC_JOURNEY.at(-1)?.focus, "cmb");
});
