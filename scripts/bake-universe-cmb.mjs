// Bakes the CMB boundary sphere texture from the committed WMAP source (artwork/universe/).
//
// The raw ILC file uses NASA's own visualization colormap — a saturated rainbow, blue (cold) to
// red (hot) — which is data-honest but reads as loud, unrelated wallpaper next to the atlas's own
// palette. Recoloring it is legitimate: any false-color temperature map IS a colormap choice, not
// "what it looks like" (there is no visible light at these wavelengths). So this bake recovers the
// real per-pixel temperature from the source colormap's hue — verified empirically monotonic
// across this exact file, 0° (hot/red) to 259.09° (cold/blue-violet), see the measurement this
// constant is pinned to below — and re-renders it through the SAME cool/warm duotone the universe
// volume's own shader uses (app/universeVolume.ts), so the wall and the web read as one palette.
// The ripple PATTERN is untouched real data; only its color encoding changes.

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { mkdir, writeFile } from "node:fs/promises";

const sourceUrl = new URL("../artwork/universe/wmap-ilc-9yr-mollweide.png", import.meta.url);
const outputUrl = new URL("../public/textures/universe/cmb-wmap-2048.webp", import.meta.url);
const width = 2048, height = 1024, root2 = Math.SQRT2;

const source = await loadImage(sourceUrl.pathname);
const sourceCanvas = createCanvas(source.width, source.height), sourceContext = sourceCanvas.getContext("2d");
sourceContext.drawImage(source, 0, 0);
const input = sourceContext.getImageData(0, 0, source.width, source.height).data;

const canvas = createCanvas(width, height), context = canvas.getContext("2d"), image = context.createImageData(width, height), output = image.data;

function mollweideTheta(latitude) {
  let theta = latitude;
  for (let index = 0; index < 10; index++) {
    const twice = 2 * theta, delta = (twice + Math.sin(twice) - Math.PI * Math.sin(latitude)) / (2 + 2 * Math.cos(twice));
    theta -= delta;
  }
  return theta;
}

function sample(x, y, channel) {
  const x0 = Math.max(0, Math.min(source.width - 1, Math.floor(x))), y0 = Math.max(0, Math.min(source.height - 1, Math.floor(y)));
  const x1 = Math.min(source.width - 1, x0 + 1), y1 = Math.min(source.height - 1, y0 + 1), fx = x - x0, fy = y - y0;
  const a = input[(y0 * source.width + x0) * 4 + channel], b = input[(y0 * source.width + x1) * 4 + channel];
  const c = input[(y1 * source.width + x0) * 4 + channel], d = input[(y1 * source.width + x1) * 4 + channel];
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

// Empirically measured max hue of the ILC colormap's cold end (see the module comment) — the
// constant that makes hue → temperature exact for THIS file, not a generic rainbow-colormap guess.
const MAX_HUE = 259.0909;
function temperatureFromRgb(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  // Antialiased pixels at the Mollweide ellipse's edge fade toward black (low saturation/value);
  // hue is meaningless there, so they fall back to the cold end rather than an arbitrary hue.
  if (max < 8 || delta / max < 0.12) return 0;
  let hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue *= 60; if (hue < 0) hue += 360;
  return Math.min(1, Math.max(0, 1 - hue / MAX_HUE));
}

// The real signal is a ~zero-centered fluctuation (roughly half the sky reads above the mean,
// half below), so a LINEAR duotone across it paints half the boundary solid — a lava wall, not a
// faint distant glow. The fix is the same idea as any "highlight only the extremes" grade: bias
// toward a near-background baseline and let only the genuine tails of the distribution brighten,
// with a gamma curve (steeper than 1) that shrinks how much sky area reaches full color. BASE sits
// close to the scene's own near-black navy so an average patch of sky all but disappears; HOT is
// the CMB landmark's own gold (#f2cf77 in cosmic.ts) so a click-to-focus flight lands on a color
// the panel already used; DEEP is where the coldest extremes sink, barely above true black.
const BASE = [12, 20, 44], HOT = [242, 207, 119], DEEP = [4, 7, 16];
const HOT_GAMMA = 2.3, COLD_GAMMA = 1.7, HOT_CEILING = .92;
function duotone(t) {
  const center = t - .5, warm = Math.pow(Math.max(0, center / .5), HOT_GAMMA) * HOT_CEILING, cool = Math.pow(Math.max(0, -center / .5), COLD_GAMMA);
  return BASE.map((base, index) => {
    const towardHot = base + (HOT[index] - base) * warm;
    return Math.round(Math.max(0, Math.min(255, towardHot + (DEEP[index] - towardHot) * cool)));
  });
}

for (let y = 0; y < height; y++) {
  const latitude = Math.PI / 2 - (y + .5) / height * Math.PI, theta = mollweideTheta(latitude);
  const mollweideY = root2 * Math.sin(theta), sourceY = (root2 - mollweideY) / (2 * root2) * (source.height - 1);
  for (let x = 0; x < width; x++) {
    const longitude = (x + .5) / width * Math.PI * 2 - Math.PI;
    const mollweideX = 2 * root2 / Math.PI * longitude * Math.cos(theta), sourceX = (mollweideX + 2 * root2) / (4 * root2) * (source.width - 1);
    const offset = (y * width + x) * 4;
    const r = sample(sourceX, sourceY, 0), g = sample(sourceX, sourceY, 1), b = sample(sourceX, sourceY, 2);
    const [dr, dg, db] = duotone(temperatureFromRgb(r, g, b));
    output[offset] = dr; output[offset + 1] = dg; output[offset + 2] = db; output[offset + 3] = 255;
  }
}

context.putImageData(image, 0, 0);
await mkdir(new URL(".", outputUrl), { recursive: true });
const encoded = canvas.toBuffer("image/webp");
await writeFile(outputUrl, encoded);
console.log(`WMAP Mollweide → atlas-duotone equirectangular CMB → public/textures/universe/cmb-wmap-2048.webp (${width}×${height}, ${encoded.length.toLocaleString()} bytes)`);
