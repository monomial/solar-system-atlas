import assert from "node:assert/strict";
import test from "node:test";

import { BRIDGE_BODIES, BRIDGE_SCENES, isBridgeBody, SPEAKER_VOICES } from "../app/bridgeScenes.ts";

test("every bridge body has at least two exchanges, so a repeat click shows something new", () => {
  for (const body of BRIDGE_BODIES) {
    assert.ok(BRIDGE_SCENES[body].length >= 2, `${body} needs >=2 scenes for repeat-click rotation`);
  }
});

test("every scene turn has real text and a speaker with a mapped voice", () => {
  for (const body of BRIDGE_BODIES) {
    for (const scene of BRIDGE_SCENES[body]) {
      assert.ok(scene.turns.length > 0, `${body} has an empty scene`);
      for (const turn of scene.turns) {
        assert.ok(turn.text.trim().length > 0, `${body} has a turn with no text`);
        assert.ok(SPEAKER_VOICES[turn.speaker], `${body} turn has an unmapped speaker "${turn.speaker}"`);
      }
    }
  }
});

test("every scene opens with Horizon's announcer beat", () => {
  for (const body of BRIDGE_BODIES) {
    for (const scene of BRIDGE_SCENES[body]) {
      assert.equal(scene.turns[0].speaker, "Horizon", `${body} scene doesn't open with Horizon`);
    }
  }
});

test("isBridgeBody only recognizes the three covered destinations", () => {
  assert.ok(isBridgeBody("Mars"));
  assert.ok(isBridgeBody("Saturn"));
  assert.ok(isBridgeBody("Pluto"));
  assert.ok(!isBridgeBody("Jupiter"));
  assert.ok(!isBridgeBody(null));
  assert.ok(!isBridgeBody(undefined));
});
