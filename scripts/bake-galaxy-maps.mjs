// Builds the Milky Way assets shared by the web atlas and the tvOS renderer.
//
// The authored source supplies photographic multi-scale structure. A deterministic native-8K
// finishing pass follows the atlas's exact arm skeleton so labeled regions still land on visible
// stellar structure. The browser ships only 4K/2K derivatives; the 8K master stays an art source.

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

function paintNativeDetail(context, size) {
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
      for (let step = 0; step <= 720; step++) {
        const t = arm.tEnd * step / 720;
        const { rho, a } = polar(arm, t);
        const r = rho * maxR;
        const spread = size * (0.0015 + 0.002 * arm.wf);
        const offset = (strand - 1.5) * spread + (arm.n2(t * 39 + strand * 3) - 0.5) * spread * 2.2;
        const x = mid + Math.cos(a) * r - Math.sin(a) * offset;
        const y = mid + Math.sin(a) * r + Math.cos(a) * offset;
        if (step === 0) context.moveTo(x, y); else context.lineTo(x, y);
      }
      // Only a registration whisper: visible arm structure comes from irregular clusters below.
      // Louder continuous strokes read as mathematically perfect rings at full-galaxy zoom.
      context.strokeStyle = strand === 1 ? "rgba(218,232,255,.025)" : "rgba(146,179,232,.012)";
      context.lineWidth = size * (strand === 1 ? 0.00028 : 0.00018);
      context.stroke();
    }
  }

  // Sub-pixel-to-few-pixel stars and compact H-II knots survive the 8K -> 4K reduction as actual
  // detail instead of enlarged source pixels.
  for (let index = 0; index < 76000; index++) {
    const arm = arms[(rand() * arms.length) | 0];
    if (rand() > Math.min(1, arm.s * 0.9)) continue;
    const t = Math.pow(rand(), 0.9) * arm.tEnd;
    const { rho, a } = polar(arm, t), r = rho * maxR;
    const width = size * (0.006 + 0.009 * arm.wf) * (0.5 + arm.n1(t * 17));
    const across = (rand() + rand() - 1) * width;
    const along = (rand() - 0.5) * width * 0.35;
    const x = mid + Math.cos(a) * (r + along) - Math.sin(a) * across;
    const y = mid + Math.sin(a) * (r + along) + Math.cos(a) * across;
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
paintNativeDetail(masterContext, MASTER_SIZE);

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
