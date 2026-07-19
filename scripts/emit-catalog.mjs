// Emits tvos/HeliosTV/Media/bodies.json from app/bodies.ts.
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
import { NEARBY_GALAXIES } from "../app/cosmic.ts";

const out = fileURLToPath(new URL("../tvos/HeliosTV/Media/bodies.json", import.meta.url));

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
  // The tvOS finale's Local Group beat draws these — same single-source rule as the elements.
  localGroup: NEARBY_GALAXIES,
};

await mkdir(new URL("../tvos/HeliosTV/Media/", import.meta.url), { recursive: true });
await writeFile(out, `${JSON.stringify(catalog, null, 2)}\n`);

// The textures are copied rather than duplicated in git for the same reason the elements are:
// public/textures/ is the one place they live, with the attribution that goes with them.
const textureDir = new URL("../public/textures/", import.meta.url);
const resourceDir = new URL("../tvos/HeliosTV/Media/", import.meta.url);
const textures = (await readdir(textureDir)).filter((file) => /\.(webp|png)$/.test(file));
for (const file of textures)
  await copyFile(new URL(file, textureDir), new URL(file, resourceDir));

// Authored Local Group galaxy portraits for the finale's last beat. 1K is plenty: on a TV these
// planes are small against the pull-back, and the 2K set exists for the web's close-up mode.
const localGroupDir = new URL("../public/textures/local-group/", import.meta.url);
const localGroupTextures = (await readdir(localGroupDir)).filter((file) => /-1024\.webp$/.test(file));
for (const file of localGroupTextures)
  await copyFile(new URL(file, localGroupDir), new URL(`local-group-${file}`, resourceDir));

// The universe beat's assets: the committed cosmic-web density field (the same bytes the web
// raymarches — designed from day one to ride in this bundle) and the quieted WMAP CMB wall.
const universeDir = new URL("../public/textures/universe/", import.meta.url);
for (const file of await readdir(universeDir))
  await copyFile(new URL(file, universeDir), new URL(file, resourceDir));

// Restore any rendered narration from the cache. The clips are real money, so a catalog rebuild
// must never silently drop them and force a re-render — see scripts/render-narration.mjs.
const cacheDir = new URL("../.narration-cache/", import.meta.url);
let clips = [];
try {
  clips = (await readdir(cacheDir)).filter((file) => file.endsWith(".m4a"));
  for (const file of clips) await copyFile(new URL(file, cacheDir), new URL(file, resourceDir));
} catch { /* nothing rendered yet — Narrator falls back to on-device synthesis */ }

const count = PLANETS.length + DWARFS.length + MOONS.length + SMALL_BODIES.length;
const lines = Object.values(NARRATION).flat().length;
console.log(`catalog → tvos/HeliosTV/Media/bodies.json (${count} bodies, ${lines} narration lines, ${textures.length} textures, ${clips.length} voice clips)`);
