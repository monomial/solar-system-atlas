import { createCanvas, loadImage } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root=join(dirname(fileURLToPath(import.meta.url)),"..");
const out=join(root,"public/textures/local-group");
const sources={
  "milky-way":join(root,"artwork/milky-way/milky-way-detail-master.webp"),
  andromeda:join(root,"artwork/local-group/andromeda-authored-base.png"),
  triangulum:join(root,"artwork/local-group/triangulum-authored-base.png"),
};

function scaledCanvas(source,size){
  const canvas=createCanvas(size,size),context=canvas.getContext("2d");
  context.fillStyle="#000";context.fillRect(0,0,size,size);
  context.imageSmoothingEnabled=true;context.imageSmoothingQuality="high";
  context.drawImage(source,0,0,size,size);
  return canvas;
}

mkdirSync(out,{recursive:true});
for(const [slug,path] of Object.entries(sources)){
  const source=await loadImage(path);
  for(const size of [2048,1024])writeFileSync(join(out,`${slug}-${size}.webp`),scaledCanvas(source,size).toBuffer("image/webp"));
}
console.log("baked Local Group 2K/1K adaptive textures for Milky Way, Andromeda, and Triangulum");
