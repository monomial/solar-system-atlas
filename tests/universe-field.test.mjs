import assert from "node:assert/strict";
import test from "node:test";

import { FIELD_ANCHORS, UNIVERSE_FIELD_SIZE, densityAt, fieldOffset, generateUniverseField } from "../app/universeField.ts";

test("the universe field is deterministic for a seed", () => {
  const first=generateUniverseField({size:32,seed:741}),second=generateUniverseField({size:32,seed:741}),other=generateUniverseField({size:32,seed:742});
  assert.deepEqual(first.data,second.data);
  assert.notDeepEqual(first.data,other.data);
});

test("the shipped field shape is 128 cubed RGBA", () => {
  const field=generateUniverseField();
  assert.equal(field.size,UNIVERSE_FIELD_SIZE);
  assert.equal(field.data.length,128**3*4);
  assert.ok(field.data.every((value) => value >= 0 && value <= 255));
});

test("catalog stamps raise structures and carve the Bootes void", () => {
  const field=generateUniverseField({size:48});
  assert.ok(densityAt(field,FIELD_ANCHORS.laniakea)>150);
  assert.ok(densityAt(field,FIELD_ANCHORS.shapley)>150);
  assert.ok(densityAt(field,FIELD_ANCHORS.sloan)>150);
  assert.ok(densityAt(field,FIELD_ANCHORS.bootes)<24);
});

test("anchor-mask alpha is binary and set only by catalog stamps", () => {
  const field=generateUniverseField({size:40}),alpha=[];
  for(let index=3;index<field.data.length;index+=4)alpha.push(field.data[index]);
  assert.ok(alpha.every((value) => value===0||value===255));
  assert.ok(alpha.includes(0)&&alpha.includes(255));
  for(const point of Object.values(FIELD_ANCHORS))assert.equal(field.data[fieldOffset(field.size,point)+3],255);
  assert.equal(field.data[fieldOffset(field.size,[-.9,-.9,-.9])+3],0);
});
