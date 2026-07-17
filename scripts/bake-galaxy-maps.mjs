// Builds the Milky Way assets shared by the web atlas and the tvOS renderer.
//
// The authored source supplies photographic multi-scale structure. A deterministic native-8K
// finishing pass adds resolved-star grain importance-sampled from the art's own bright ridges,
// plus whisper filaments along the atlas arm skeleton gated to stretches the art actually lights.
// The browser ships only 4K/2K derivatives; the 8K master stays an art source.

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MILKY_WAY_SEED, MILKY_WAY_SPIN, galaxySkeleton, milkyWayMaps } from "../app/galaxyPaint.ts";

const MASTER_SIZE = 8192;
const MAP_SIZE = 2048;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(root, "artwork", "milky-way", "milky-way-authored-base.png");
const masterPath = join(root, "artwork", "milky-way", "milky-way-detail-master.webp");
const publicOut = join(root, "public", "textures", "galaxy");
const tvOut = join(root, "tvos", "HeliosTV", "Media");

// Where the authored art actually shows an arm, 0..1. The finishing pass is registration detail:
// it must land ON painted structure, never invent structure of its own. The skeleton only
// coincides with the art on the two majors — Norma, Sagittarius' inner tip, and the Orion Spur
// cross inter-arm gaps and the bulge, and ungated specks there chain into a naked dotted arc from
// the Sun to the galactic center. Plain luminance is not enough of a test: the bulge glow is
// bright but structureless, and a speck chain over it still reads as a drawn line. So support is
// the HIGH-PASS of the art's luminance — brightness above the local background — which is high on
// arm ridges, ~zero on the smooth bulge and in the gaps.
function armLight(sourceCanvas, sourceSize) {
  const N = 1024;
  const reduced = scaledCanvas(sourceCanvas, N);
  const data = reduced.getContext("2d").getImageData(0, 0, N, N).data;
  // Local background: a heavy low-pass whose window (~40px at 1024, ~320px at 8K) is wider than
  // an arm band, so band cores stand above it while the bulge tracks its own glow.
  const back = scaledCanvas(scaledCanvas(reduced, 26), N).getContext("2d").getImageData(0, 0, N, N).data;
  const scale = N / sourceSize;
  const lumAt = (buffer, i) => (buffer[i] * 0.299 + buffer[i + 1] * 0.587 + buffer[i + 2] * 0.114) / 255;
  return (x, y) => {
    const ix = Math.min(N - 1, Math.max(0, x * scale | 0)), iy = Math.min(N - 1, Math.max(0, y * scale | 0));
    const i = (iy * N + ix) * 4;
    if (lumAt(data, i) <= 0.05) return 0;
    const ridge = lumAt(data, i) - lumAt(back, i);
    return ridge <= 0.01 ? 0 : ridge >= 0.06 ? 1 : (ridge - 0.01) / 0.05;
  };
}

function paintNativeDetail(context, size, lit) {
  const skeleton = galaxySkeleton(MILKY_WAY_SEED, MILKY_WAY_SPIN, true);
  const { arms, polar, rand } = skeleton;
  const mid = size / 2, maxR = size * 0.46;
  context.save();
  context.globalCompositeOperation = "lighter";
  context.lineCap = "round";
  context.lineJoin = "round";

  // Fine continuous filaments lock the authored image to the atlas arm geometry at native 8K.
  for (const arm of arms) {
    for (let strand = 0; strand < 4; strand++) {
      context.beginPath();
      // Pen up over dark inter-arm art: a continuous stroke across a gap is a drawn line, not a
      // filament. The path breaks where the art goes dark and resumes on the next lit stretch.
      let pen = false;
      for (let step = 0; step <= 720; step++) {
        const t = arm.tEnd * step / 720;
        const { rho, a } = polar(arm, t);
        const r = rho * maxR;
        const spread = size * (0.0015 + 0.002 * arm.wf);
        const offset = (strand - 1.5) * spread + (arm.n2(t * 39 + strand * 3) - 0.5) * spread * 2.2;
        const x = mid + Math.cos(a) * r - Math.sin(a) * offset;
        const y = mid + Math.sin(a) * r + Math.cos(a) * offset;
        if (lit(x, y) < 0.5) { pen = false; continue; }
        if (pen) context.lineTo(x, y); else { context.moveTo(x, y); pen = true; }
      }
      // Only a registration whisper: visible arm structure comes from irregular clusters below.
      // Louder continuous strokes read as mathematically perfect rings at full-galaxy zoom.
      context.strokeStyle = strand === 1 ? "rgba(218,232,255,.025)" : "rgba(146,179,232,.012)";
      context.lineWidth = size * (strand === 1 ? 0.00028 : 0.00018);
      context.stroke();
    }
  }

  // Sub-pixel-to-few-pixel stars and compact H-II knots survive the 8K -> 4K reduction as actual
  // detail instead of enlarged source pixels. Positions are importance-sampled from the authored
  // art itself, NOT from the skeleton: a speck may only land where the painting already shows a
  // bright local ridge, so added detail reinforces the art's own arms and can never chain into a
  // curve the painting doesn't draw. (Scattering along the skeleton did exactly that wherever
  // skeleton and art disagree — the dotted arc from the Sun to the center.)
  let placed = 0;
  for (let trial = 0; trial < 2_000_000 && placed < 52000; trial++) {
    const x = rand() * size, y = rand() * size;
    const support = lit(x, y);
    if (support === 0 || rand() >= support) continue;
    placed++;
    const hot = rand() < 0.018, bright = rand() < 0.08;
    context.fillStyle = hot ? "rgba(255,157,181,.58)" : bright ? "rgba(240,246,255,.55)" : "rgba(190,211,247,.24)";
    const s = hot ? 3 + rand() * 5 : bright ? 1.7 + rand() * 2.2 : 0.7 + rand() * 1.4;
    context.fillRect(x, y, s, s);
  }
  context.restore();
}

function scaledCanvas(source, size) {
  const canvas = createCanvas(size, size), context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, size, size);
  return canvas;
}

mkdirSync(dirname(masterPath), { recursive: true });
mkdirSync(publicOut, { recursive: true });
mkdirSync(tvOut, { recursive: true });

const source = await loadImage(sourcePath);
const master = createCanvas(MASTER_SIZE, MASTER_SIZE), masterContext = master.getContext("2d");
masterContext.fillStyle = "#000";
masterContext.fillRect(0, 0, MASTER_SIZE, MASTER_SIZE);
masterContext.save();
masterContext.translate(MASTER_SIZE / 2, MASTER_SIZE / 2);
masterContext.rotate(-17 * Math.PI / 180);
const authoredSize = MASTER_SIZE * 0.985;
masterContext.drawImage(source, -authoredSize / 2, -authoredSize / 2, authoredSize, authoredSize);
masterContext.restore();
paintNativeDetail(masterContext, MASTER_SIZE, armLight(master, MASTER_SIZE));

const detail4k = scaledCanvas(master, 4096);
const detail2k = scaledCanvas(master, 2048);
// Deliberately remove fine structure before this image enters the volume. The warped surface owns
// crisp detail; this aligned low-frequency derivative supplies depth without inventing a second
// set of soft procedural spiral arms.
const volumeEmission = scaledCanvas(scaledCanvas(master, 384), 2048);
writeFileSync(masterPath, master.toBuffer("image/webp"));
writeFileSync(join(publicOut, "milky-way-detail-4096.webp"), detail4k.toBuffer("image/webp"));
writeFileSync(join(publicOut, "milky-way-detail-2048.webp"), detail2k.toBuffer("image/webp"));
writeFileSync(join(publicOut, "milky-way-volume-2048.webp"), volumeEmission.toBuffer("image/webp"));
writeFileSync(join(tvOut, "galaxy-detail.png"), detail4k.toBuffer("image/png"));

const { dust } = milkyWayMaps(MAP_SIZE, (width, height) => createCanvas(width, height));
writeFileSync(join(tvOut, "galaxy-emission.png"), volumeEmission.toBuffer("image/png"));
writeFileSync(join(tvOut, "galaxy-dust.png"), dust.toBuffer("image/png"));

console.log(`baked 8K master + 4K/2K detail maps and ${MAP_SIZE}x${MAP_SIZE} volume maps`);
