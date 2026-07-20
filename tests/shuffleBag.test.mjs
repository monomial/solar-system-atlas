import assert from "node:assert/strict";
import test from "node:test";

import { ShuffleBag } from "../app/shuffleBag.ts";

// ShuffleBag used to be private to useAmbient.ts and hardcoded to NARRATION's shape; it's now
// generic (keyed by string, counted explicitly) so Starbots Mode's scene-exchange rotation can
// reuse the exact "every option once before repeats" guarantee fact-rotation already relies on.
// This is genuinely existing, previously-untested behavior (REGRESSION RULE) as well as new.

test("count <= 1 always returns index 0", () => {
  const bag = new ShuffleBag();
  for (let i = 0; i < 5; i++) assert.equal(bag.next("solo", 1), 0);
  for (let i = 0; i < 5; i++) assert.equal(bag.next("empty", 0), 0);
});

test("every index appears once before any repeats, across many reshuffles", () => {
  const bag = new ShuffleBag();
  const count = 4;
  for (let cycle = 0; cycle < 50; cycle++) {
    const seen = new Set();
    for (let i = 0; i < count; i++) {
      const index = bag.next("mars", count);
      assert.ok(index >= 0 && index < count);
      assert.ok(!seen.has(index), `index ${index} repeated within cycle ${cycle}`);
      seen.add(index);
    }
    assert.equal(seen.size, count);
  }
});

test("a reshuffle never immediately repeats the index it just finished on", () => {
  const bag = new ShuffleBag();
  const count = 2; // the tight case Starbots Mode actually uses (2 exchanges per body)
  let previous = bag.next("saturn", count);
  for (let i = 0; i < 100; i++) {
    const next = bag.next("saturn", count);
    assert.notEqual(next, previous, "same index played twice in a row");
    previous = next;
  }
});

test("different keys keep independent bags", () => {
  const bag = new ShuffleBag();
  const marsFirst = bag.next("mars", 2);
  const plutoFirst = bag.next("pluto", 2);
  // Draining "mars" to exhaustion must not affect "pluto"'s own independent sequence.
  bag.next("mars", 2);
  const plutoSecond = bag.next("pluto", 2);
  assert.notEqual(plutoFirst, plutoSecond);
  assert.ok([0, 1].includes(marsFirst));
});
