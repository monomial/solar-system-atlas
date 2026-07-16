import assert from "node:assert/strict";
import test from "node:test";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { stat } from "node:fs/promises";
import { join } from "node:path";

import { ARM_START, MILKY_WAY_SEED, MILKY_WAY_SPIN, galaxySkeleton, milkyWayMaps, paintGalaxyDisk } from "../app/galaxyPaint.ts";

// The volumetric maps feed both the web raymarcher and the committed tvOS PNGs, and a painter
// regression here fails SILENTLY on screen (the galaxy just looks dimmer or emptier), so these
// tests pin the physics of the bake: energy lands where the named arms are, dust exists where
// dust was painted, and the whole thing is deterministic.

const SIZE = 512;
const factory = (w, h) => createCanvas(w, h);

function luminance(ctx, size, x, y) {
  const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
  // The emission canvas carries 'lighter'-accumulated alpha; rgb·a is the painted intensity the
  // renderers reconstruct (galaxyVolume.ts multiplies at sample time, the bake flattens onto black).
  return (d[0] + d[1] + d[2]) / (3 * 255) * (d[3] / 255);
}

// Sample a point along an arm in canvas pixels (mirrors along() in the painter).
function armPoint(arm, polar, t, size) {
  const { rho, a } = polar(arm, t);
  const mid = size / 2, maxR = size * 0.46;
  return { x: mid + Math.cos(a) * rho * maxR, y: mid + Math.sin(a) * rho * maxR };
}

test("emission map puts light on every named arm and in the bar", () => {
  const { emission } = milkyWayMaps(SIZE, factory);
  const ctx = emission.getContext("2d");
  const sk = galaxySkeleton(MILKY_WAY_SEED, MILKY_WAY_SPIN, true);

  // The bar core is the brightest thing painted.
  assert.ok(luminance(ctx, SIZE, SIZE / 2, SIZE / 2) > 0.5, "bar core should be bright");

  for (const arm of sk.arms) {
    // Average a stretch of mid-arm samples: single points ride the clump noise.
    let on = 0;
    const samples = 24;
    for (let i = 0; i < samples; i++) {
      const t = arm.tEnd * (0.25 + 0.5 * (i / (samples - 1)));
      const p = armPoint(arm, sk.polar, t, SIZE);
      on += luminance(ctx, SIZE, p.x, p.y);
    }
    on /= samples;
    assert.ok(on > 0.02, `${arm.name} should carry painted light (got ${on.toFixed(4)})`);
  }
});

test("the Sun's position sits on the Orion Spur's painted light", () => {
  const { emission } = milkyWayMaps(SIZE, factory);
  const ctx = emission.getContext("2d");
  // Sun: azimuth 90°, radius 26/56 of the disk edge (tests/cosmic.test.mjs pins the marker there).
  const mid = SIZE / 2, maxR = SIZE * 0.46, rho = 26 / 56;
  const lum = luminance(ctx, SIZE, mid, mid + rho * maxR);
  assert.ok(lum > 0.02, `expected spur light at the Sun's position (got ${lum.toFixed(4)})`);
});

test("dust map holds density and stays out of the far outer disk", () => {
  const { dust } = milkyWayMaps(SIZE, factory);
  const ctx = dust.getContext("2d");
  const img = ctx.getImageData(0, 0, SIZE, SIZE).data;
  let total = 0, rim = 0, rimCount = 0;
  const mid = SIZE / 2, edge = SIZE * 0.46;
  for (let y = 0; y < SIZE; y += 4) for (let x = 0; x < SIZE; x += 4) {
    const v = img[(y * SIZE + x) * 4];
    total += v;
    const r = Math.hypot(x - mid, y - mid);
    if (r > edge * 1.02) { rim += v; rimCount++; }
  }
  assert.ok(total > 0, "dust map should not be empty");
  assert.ok(rim / rimCount < 1, "no dust should be painted beyond the disk edge");
});

test("the bake is deterministic", () => {
  const a = milkyWayMaps(SIZE, factory).emission.toBuffer("image/png");
  const b = milkyWayMaps(SIZE, factory).emission.toBuffer("image/png");
  assert.ok(a.equals(b), "two bakes of the same seed must be byte-identical");
});

test("the volume emission map excludes pixel-star grain", () => {
  const actual = milkyWayMaps(SIZE, factory).emission.toBuffer("image/png");
  const dust = factory(SIZE, SIZE);
  const dustContext = dust.getContext("2d");
  dustContext.fillStyle = "#000";
  dustContext.fillRect(0, 0, SIZE, SIZE);
  dustContext.globalCompositeOperation = "lighter";
  const expected = paintGalaxyDisk({
    edge: "#a9c6ff",
    seed: MILKY_WAY_SEED,
    spin: MILKY_WAY_SPIN,
    rich: true,
    size: SIZE,
    create: factory,
    dustInto: dustContext,
    grain: false,
  }).toBuffer("image/png");

  assert.ok(actual.equals(expected), "resolved stars belong to the 3D point cloud, not the extruded emission map");
});

test("ARM_START matches the painter's bar-tip radius", () => {
  // The star cloud's rejection weighting in DeepSpace.tsx depends on this constant agreeing with
  // the skeleton's internal start radius; drift would silently rebalance arm star density.
  assert.equal(ARM_START, 0.304);
});

test("authored detail assets include 8K source and adaptive browser sizes", async () => {
  const assets = [
    ["artwork/milky-way/milky-way-detail-master.webp", 8192, 8_000_000],
    ["public/textures/galaxy/milky-way-detail-4096.webp", 4096, 8_000_000],
    ["public/textures/galaxy/milky-way-detail-2048.webp", 2048, 2_500_000],
    ["public/textures/galaxy/milky-way-volume-2048.webp", 2048, 2_500_000],
  ];
  for (const [relative, expectedSize, byteBudget] of assets) {
    const path = join(process.cwd(), relative);
    const [image, info] = await Promise.all([loadImage(path), stat(path)]);
    assert.equal(image.width, expectedSize, `${relative} width`);
    assert.equal(image.height, expectedSize, `${relative} height`);
    assert.ok(info.size < byteBudget, `${relative} exceeds its ${byteBudget}-byte delivery budget`);
  }
});

test("major Local Group galaxies have adaptive authored textures", async () => {
  const assets = ["milky-way", "andromeda", "triangulum"];
  for (const slug of assets) for (const size of [1024, 2048]) {
    const relative = `public/textures/local-group/${slug}-${size}.webp`;
    const path = join(process.cwd(), relative);
    const [image, info] = await Promise.all([loadImage(path), stat(path)]);
    assert.equal(image.width, size, `${relative} width`);
    assert.equal(image.height, size, `${relative} height`);
    assert.ok(info.size < 1_500_000, `${relative} exceeds its delivery budget`);
  }
});
