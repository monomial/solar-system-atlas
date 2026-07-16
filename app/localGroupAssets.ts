import * as THREE from "three";
import type { NearbyGalaxy } from "./cosmic";
import type { GalaxyDetailQuality } from "./galaxyDetail";

const AUTHORED_VARIANTS = new Set<NearbyGalaxy["variant"]>(["milkyway","andromeda","triangulum"]);

export function hasAuthoredLocalGroupTexture(galaxy:NearbyGalaxy){
  return AUTHORED_VARIANTS.has(galaxy.variant);
}

export async function loadLocalGroupTexture(renderer:THREE.WebGLRenderer,galaxy:NearbyGalaxy,quality:GalaxyDetailQuality){
  if(!hasAuthoredLocalGroupTexture(galaxy))throw new Error(`${galaxy.id} has no authored Local Group texture`);
  const size=quality==="high"?2048:1024;
  const slug=galaxy.variant==="milkyway"?"milky-way":galaxy.variant;
  const texture=await new THREE.TextureLoader().loadAsync(`/textures/local-group/${slug}-${size}.webp`);
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.minFilter=THREE.LinearMipmapLinearFilter;
  texture.magFilter=THREE.LinearFilter;
  texture.anisotropy=Math.min(16,renderer.capabilities.getMaxAnisotropy());
  texture.generateMipmaps=true;
  texture.needsUpdate=true;
  return texture;
}
