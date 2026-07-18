import { gzipSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { generateUniverseField } from "../app/universeField.ts";

const field=generateUniverseField(),output=new URL("../public/textures/universe/cosmic-web-128.rgba.gz",import.meta.url);
await mkdir(new URL(".",output),{recursive:true});
const compressed=gzipSync(field.data,{level:9,mtime:0});await writeFile(output,compressed);
console.log(`universe field → public/textures/universe/cosmic-web-128.rgba.gz (${field.data.length.toLocaleString()} bytes → ${compressed.length.toLocaleString()} gzip)`);
