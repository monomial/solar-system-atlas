import * as THREE from "three";
import type { GalacticMarkerKind } from "./cosmic";

export type GalaxyDetailQuality = "high" | "standard";

const R = 56;
const MAP = 122;

function ripple(radius:number,theta:number){
  const f=radius/R;
  return(Math.sin(radius*.42+1.3)*(.1+f*f*1.1)+f*f*f*2.4*Math.sin(theta-1.1))*.55;
}

export function chooseGalaxyDetailQuality(renderer:THREE.WebGLRenderer,width:number,coarsePointer:boolean):GalaxyDetailQuality{
  const memory=(navigator as Navigator&{deviceMemory?:number}).deviceMemory??8;
  const backingWidth=width*Math.min(window.devicePixelRatio||1,2);
  return !coarsePointer&&renderer.capabilities.maxTextureSize>=4096&&memory>=8&&backingWidth>=2560?"high":"standard";
}

export async function loadGalaxyDetailTexture(renderer:THREE.WebGLRenderer,quality:GalaxyDetailQuality){
  const size=quality==="high"?4096:2048;
  const texture=await new THREE.TextureLoader().loadAsync(`/textures/galaxy/milky-way-detail-${size}.webp`);
  return configureGalaxyTexture(renderer,texture);
}

export async function loadGalaxyVolumeTexture(renderer:THREE.WebGLRenderer){
  const texture=await new THREE.TextureLoader().loadAsync("/textures/galaxy/milky-way-volume-2048.webp");
  return configureGalaxyTexture(renderer,texture);
}

function configureGalaxyTexture(renderer:THREE.WebGLRenderer,texture:THREE.Texture){
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.minFilter=THREE.LinearMipmapLinearFilter;
  texture.magFilter=THREE.LinearFilter;
  texture.anisotropy=Math.min(16,renderer.capabilities.getMaxAnisotropy());
  texture.generateMipmaps=true;
  texture.needsUpdate=true;
  return texture;
}

export function createGalaxyDetailSurface(texture:THREE.Texture){
  const geometry=new THREE.PlaneGeometry(MAP,MAP,192,192),positions=geometry.getAttribute("position") as THREE.BufferAttribute;
  for(let index=0;index<positions.count;index++){
    const x=positions.getX(index),z=-positions.getY(index),radius=Math.hypot(x,z);
    positions.setXYZ(index,x,ripple(radius,Math.atan2(z,x)),z);
  }
  positions.needsUpdate=true;
  geometry.computeBoundingSphere();
  const material=new THREE.MeshBasicMaterial({map:texture,transparent:true,opacity:.58,blending:THREE.AdditiveBlending,depthWrite:false,depthTest:false,side:THREE.DoubleSide,toneMapped:true});
  const surface=new THREE.Mesh(geometry,material);
  surface.renderOrder=1.5;
  surface.name="milky-way-detail";
  return surface;
}

function markerCanvas(kind:GalacticMarkerKind,color:string){
  const canvas=document.createElement("canvas");canvas.width=canvas.height=128;
  const context=canvas.getContext("2d")!,center=64;
  context.strokeStyle=color;context.fillStyle=color;context.lineWidth=5;context.lineCap="round";context.lineJoin="round";
  context.shadowColor=color;context.shadowBlur=13;
  if(kind==="center"){
    context.beginPath();context.moveTo(center,15);context.lineTo(73,53);context.lineTo(113,64);context.lineTo(73,75);context.lineTo(center,113);context.lineTo(55,75);context.lineTo(15,64);context.lineTo(55,53);context.closePath();context.stroke();
    context.beginPath();context.arc(center,center,9,0,Math.PI*2);context.fill();
  }else if(kind==="home"){
    for(let part=0;part<4;part++){context.beginPath();context.arc(center,center,34,part*Math.PI/2+.16,(part+1)*Math.PI/2-.16);context.stroke();}
    for(const[ax,ay,bx,by]of[[64,12,64,25],[64,103,64,116],[12,64,25,64],[103,64,116,64]]){context.beginPath();context.moveTo(ax,ay);context.lineTo(bx,by);context.stroke();}
    context.beginPath();context.arc(center,center,8,0,Math.PI*2);context.fill();
  }else{
    context.beginPath();context.moveTo(center,25);context.lineTo(103,64);context.lineTo(center,103);context.lineTo(25,64);context.closePath();context.stroke();
    context.beginPath();context.arc(center,center,7,0,Math.PI*2);context.fill();
  }
  return canvas;
}

export function createGalacticMarker(kind:GalacticMarkerKind,color:string){
  const texture=new THREE.CanvasTexture(markerCanvas(kind,color));texture.colorSpace=THREE.SRGBColorSpace;
  const material=new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:false,depthWrite:false,toneMapped:false});
  const sprite=new THREE.Sprite(material);sprite.renderOrder=4;
  return sprite;
}
