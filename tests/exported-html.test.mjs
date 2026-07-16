import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const out = (path) => fileURLToPath(new URL(`../out/${path}`, import.meta.url));

test("static export produces a page shell", async () => {
  const html = await readFile(out("index.html"), "utf8");
  assert.match(html, /<title>Helios[^<]*Solar System and Galactic Atlas<\/title>/i);
  // The atlas mounts client-side (ssr: false), so the prerendered HTML should carry
  // the shell and loading state rather than a rendered scene.
  assert.match(html, /class="[^"]*atlas-shell/);
});

test("textures are exported alongside the page", async () => {
  // Three.js loads these by raw URL, so a missing file fails silently at runtime
  // rather than at build time. Assert the export actually carries them.
  for (const texture of ["earth.webp", "saturn-ring.png", "pluto.webp"]) {
    const info = await stat(out(`textures/${texture}`));
    assert.ok(info.size > 0, `textures/${texture} should not be empty`);
  }
  for (const texture of ["milky-way-1024.webp", "andromeda-2048.webp", "triangulum-2048.webp"]) {
    const info = await stat(out(`textures/local-group/${texture}`));
    assert.ok(info.size > 0, `textures/local-group/${texture} should not be empty`);
  }
});
