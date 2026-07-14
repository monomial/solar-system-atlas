// Emits tvos/HeliosTV/Resources/bodies.json from app/bodies.ts.
//
// app/bodies.ts stays the single source of truth for physical data and JPL elements.
// The tvOS app consumes the generated JSON rather than carrying its own transcription of
// the same numbers, because two hand-maintained copies of an element table is exactly how
// the web and the TV quietly start disagreeing about where Pluto is.
//
// Run: npm run catalog  (and it runs as part of `npm run build`)

import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { DWARFS, MOONS, NARRATION, PLANETS, SMALL_BODIES } from "../app/bodies.ts";

const out = fileURLToPath(new URL("../tvos/HeliosTV/Resources/bodies.json", import.meta.url));

// The ambient scene renders the Sun, the planets, and the dwarfs. Moons and small bodies
// come along so the catalog stays complete and a later TV feature does not need a new
// generator — the scene just filters on what it draws.
const catalog = {
  generated: "app/bodies.ts via scripts/emit-catalog.mjs — do not edit by hand",
  planets: PLANETS,
  dwarfs: DWARFS,
  moons: MOONS,
  smallBodies: SMALL_BODIES,
  narration: NARRATION,
};

await mkdir(new URL("../tvos/HeliosTV/Resources/", import.meta.url), { recursive: true });
await writeFile(out, `${JSON.stringify(catalog, null, 2)}\n`);

// The textures are copied rather than duplicated in git for the same reason the elements are:
// public/textures/ is the one place they live, with the attribution that goes with them.
const textureDir = new URL("../public/textures/", import.meta.url);
const resourceDir = new URL("../tvos/HeliosTV/Resources/", import.meta.url);
const textures = (await readdir(textureDir)).filter((file) => /\.(webp|png)$/.test(file));
for (const file of textures)
  await copyFile(new URL(file, textureDir), new URL(file, resourceDir));

const count = PLANETS.length + DWARFS.length + MOONS.length + SMALL_BODIES.length;
const lines = Object.values(NARRATION).flat().length;
console.log(`catalog → tvos/HeliosTV/Resources/bodies.json (${count} bodies, ${lines} narration lines, ${textures.length} textures)`);
