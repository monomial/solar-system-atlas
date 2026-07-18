"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { GALACTIC_REGIONS, NEARBY_GALAXIES } from "./cosmic";
import type { AtlasMode, GalacticRegion, NearbyGalaxy } from "./cosmic";
import { ARM_START, MILKY_WAY_SEED, MILKY_WAY_SPIN, galaxySkeleton, hexRgb, milkyWayMaps, paintAndromeda, paintGalaxyDisk } from "./galaxyPaint";
import { createGalaxyVolume } from "./galaxyVolume";
import { chooseGalaxyDetailQuality, createGalacticMarker, createGalaxyDetailSurface, loadGalaxyDetailTexture, loadGalaxyVolumeTexture } from "./galaxyDetail";
import { hasAuthoredLocalGroupTexture, loadLocalGroupTexture } from "./localGroupAssets";
import { installDeepOverlays, labelTexture } from "./deepOverlays";
import type { DeepLabel, DeepMarker } from "./deepOverlays";

type DeepMode = Extract<AtlasMode,"galaxy"|"local">;
type ViewMode = "tilted"|"top"|"edge";
type SceneApi = { focus:(id:string)=>void;view:(mode:ViewMode)=>void };

const DEEP_SOURCE_LINKS = [
  ["NASA · The Sun's galactic orbit","https://science.nasa.gov/sun/facts/"],
  ["NASA · The Milky Way's center","https://science.nasa.gov/asset/hubble/milky-way-center-in-multiple-wavelengths/"],
  ["NASA Hubble · Andromeda survey","https://science.nasa.gov/missions/hubble/nasas-hubble-traces-hidden-history-of-andromeda-galaxy/"],
  ["NASA · Local Group structure","https://science.nasa.gov/universe/galaxies/large-scale-structures/"],
  ["NASA Hubble · Local Group spirals","https://science.nasa.gov/asset/hubble/the-fate-of-the-milky-way-andromeda-and-triangulum-galaxies-annotated/"],
  ["NASA Hubble · Large Magellanic Cloud","https://science.nasa.gov/missions/hubble/large-magellanic-cloud/"],
];

function seeded(n:number){const x=Math.sin(n*999.91)*43758.5453;return x-Math.floor(x);}
// All galaxy painting lives in galaxyPaint.ts (Three-free, DOM-optional — the bake script and the
// tvOS pipeline reuse it). This module only wraps its canvases for the GPU.
function canvasTexture(canvas:HTMLCanvasElement){const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=16;return texture;}

// A soft round particle. Point clouds read as hard confetti squares by default; giving each point
// this radial-alpha sprite as its `map` lets overlapping points melt into a smooth glow instead.
function softDot(inner:string,outer:string){
  const canvas=document.createElement("canvas");canvas.width=canvas.height=64;const g=canvas.getContext("2d")!;
  const grd=g.createRadialGradient(32,32,0,32,32,32);grd.addColorStop(0,inner);grd.addColorStop(1,outer);g.fillStyle=grd;g.fillRect(0,0,64,64);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}

function starfield(scene:THREE.Scene,count:number,radius:number){
  const positions=new Float32Array(count*3),colors=new Float32Array(count*3),color=new THREE.Color();
  for(let index=0;index<count;index++){
    const r=radius*.55+seeded(index+4)*radius*.45,theta=seeded(index+19)*Math.PI*2,phi=Math.acos(2*seeded(index+47)-1);
    positions[index*3]=r*Math.sin(phi)*Math.cos(theta);positions[index*3+1]=r*Math.cos(phi);positions[index*3+2]=r*Math.sin(phi)*Math.sin(theta);
    color.set(index%19===0?"#8bb6ff":index%29===0?"#ffd1a6":"#ffffff");colors.set([color.r,color.g,color.b],index*3);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.BufferAttribute(positions,3));geometry.setAttribute("color",new THREE.BufferAttribute(colors,3));
  const points=new THREE.Points(geometry,new THREE.PointsMaterial({size:radius/560,map:softDot("rgba(255,255,255,.9)","rgba(255,255,255,0)"),transparent:true,opacity:.7,vertexColors:true,depthWrite:false,blending:THREE.AdditiveBlending}));scene.add(points);return points;
}

function milkyWay(scene:THREE.Scene,authoredVolume?:THREE.Texture){
  // The crisp authored surface owns the visible spiral geometry. The volume receives a heavily
  // low-pass derivative of that exact image, while this procedural cloud is quiet enough to read
  // as resolved stars rather than a competing set of broad arms.
  // SPIN 4.6 winds the majors ~300° (a ~12° pitch — the NASA/JPL map's Scutum-Centaurus wraps the
  // whole disk), which is what makes the disk read as many nested strands instead of spokes. The
  // arms themselves are the named MILKY_WAY_ARMS table, one strand per arm on the annotated map.
  const SEED=MILKY_WAY_SEED,SPIN=MILKY_WAY_SPIN,R=56;
  // The disk is not flat. SDSS and Gaia show the Milky Way is CORRUGATED — concentric vertical
  // ripples that grow toward the rim (the Monoceros and TriAndromeda rings are crests of that
  // pattern) — and the outer disk carries an integral-sign warp, up on one side, down on the
  // other. One displacement function drives both the volume shader (ported to GLSL there) and the
  // star cloud, so the glowing gas and the stars undulate together.
  // The .55 damping matches the volume shader exactly — full amplitude makes oblique columns
  // through the glowing sheet read as wavy defocus bands from above (see galaxyVolume.ts).
  const ripple=(r:number,theta:number)=>{const f=r/R;return(Math.sin(r*.42+1.3)*(.1+f*f*1.1)+f*f*f*2.4*Math.sin(theta-1.1))*.55;};
  const maps=milkyWayMaps(2048);
  const emission=authoredVolume??canvasTexture(maps.emission);
  // The dust map is data, not color: keep it linear so the shader reads density unencoded.
  const dust=new THREE.CanvasTexture(maps.dust);dust.colorSpace=THREE.NoColorSpace;
  scene.add(createGalaxyVolume(emission,dust));
  const sk=galaxySkeleton(SEED,SPIN,true),rand=sk.rand,gauss=()=>(rand()+rand()+rand()+rand()-2)*.85;
  const armN=22000,fieldN=7000,bulgeN=4200,haloN=800,total=armN+fieldN+bulgeN+haloN;
  const positions=new Float32Array(total*3),colors=new Float32Array(total*3),color=new THREE.Color();
  let p=0;const put=(x:number,y:number,z:number,c:string,f:number)=>{positions[p*3]=x;positions[p*3+1]=y;positions[p*3+2]=z;color.set(c);colors[p*3]=color.r*f;colors[p*3+1]=color.g*f;colors[p*3+2]=color.b*f;p++;};
  for(let i=0;i<armN;i++){
    // The named arms differ hugely in length (Norma is a short inner arc, Scutum–Centaurus wraps
    // the disk), so rejection-weight by each arm's rho span — otherwise short arms end up several
    // times denser per unit length. Rejected slots stay zeroed: black points are invisible under
    // additive blending.
    const arm=sk.arms[(rand()*sk.arms.length)|0];if(rand()*.67>arm.tEnd*(1-ARM_START*arm.r1))continue;
    const t=Math.pow(rand(),.9)*arm.tEnd,{rho,a}=sk.polar(arm,t);
    const clump=.3+Math.pow(arm.n1(t*13),1.7)*1.5,w=(.05-.016*t)*(.72+arm.n2(t*8)*.6)*2*R*arm.wf,r=rho*R;
    const root=arm.soft?Math.min(1,.2+t/arm.tEnd*2.5):1;
    // young population: hugs the (corrugated) plane, flares slightly outward, pink where born
    put(Math.cos(a)*r+gauss()*w*.45,ripple(r,a)+gauss()*(.35+r/R*.55),Math.sin(a)*r+gauss()*w*.45,rand()<.03?"#ff9bb4":rand()<.12?"#cfe0ff":"#e8eeff",(.22+.45*rand())*clump*arm.s*root);
  }
  for(let i=0;i<fieldN;i++){
    // old disk population: no arm memory, warmer, twice the scale height
    const r=R*Math.pow(rand(),.72),an=rand()*Math.PI*2;
    put(Math.cos(an)*r,ripple(r,an)+gauss()*(.7+r/R*.9),Math.sin(an)*r,r<R*.3?"#ffe3b8":"#dbe4ff",.1+.26*rand());
  }
  const cb=Math.cos(sk.bar),sb=Math.sin(sk.bar);
  for(let i=0;i<bulgeN;i++){
    // triaxial bulge sharing the painted bar's orientation — the core reads as a glowing 3D lens
    const u=gauss()*8.5,v=gauss()*3.6,y=gauss()*3.1,d=Math.hypot(u/8.5,v/3.6,y/3.1);
    put(cb*u-sb*v,y,sb*u+cb*v,d<.5?"#fff2d8":"#ffd9a0",Math.max(.06,.42-.1*d)+rand()*.12);
  }
  for(let i=0;i<haloN;i++){
    const r=R*(.2+Math.pow(rand(),1.6)*.75),th=rand()*Math.PI*2,ph=Math.acos(2*rand()-1);
    put(r*Math.sin(ph)*Math.cos(th),r*Math.cos(ph)*.75,r*Math.sin(ph)*Math.sin(th),"#ffe8c8",.05+.09*rand());
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.BufferAttribute(positions,3));geometry.setAttribute("color",new THREE.BufferAttribute(colors,3));
  // Halo pass kept very quiet: the raymarched medium now carries ALL the milk; these blobs only
  // feather the stars so the pinpoint pass below doesn't read as confetti. Any louder and 22k
  // overlapping soft dots lay a lumpy veil over the crisp painted arms in the top view.
  const points=new THREE.Points(geometry,new THREE.PointsMaterial({size:.28,map:softDot("rgba(255,255,255,.85)","rgba(255,255,255,0)"),transparent:true,opacity:.025,vertexColors:true,depthWrite:false,blending:THREE.AdditiveBlending}));points.renderOrder=2;scene.add(points);
  // The same stars again as small bright cores (shared geometry, so it costs nothing): the soft
  // halo layer alone reads as fog — the pinpoint pass is what makes them read as stars.
  const cores=new THREE.Points(geometry,new THREE.PointsMaterial({size:.14,map:softDot("rgba(255,255,255,1)","rgba(255,255,255,0)"),transparent:true,opacity:.38,vertexColors:true,depthWrite:false,blending:THREE.AdditiveBlending}));cores.renderOrder=2;scene.add(cores);
  // (The nucleus sprite is gone: the volume's analytic nucleus term replaced it.)
  return points;
}

// One Local Group galaxy, drawn as what it actually is: Andromeda by its dedicated painter, the
// Milky Way with the SAME seed as the galaxy-scale view (one object, one look at both scales),
// M33 as a loose flocculent spiral, the Magellanics and dwarfs as irregular smudges. Spirals get
// three thin texture layers for a hint of volume; each sits at its real published inclination.
function buildGalaxy(scene:THREE.Object3D,galaxy:NearbyGalaxy,position:THREE.Vector3,authoredTexture?:THREE.Texture){
  const [r,g,b]=hexRgb(galaxy.color),home=galaxy.distanceMly===0,v=galaxy.variant;
  const seed=Math.round(galaxy.angle*97+galaxy.visualSize*29)+3;
  const texture=authoredTexture??canvasTexture(v==="andromeda"?paintAndromeda(31,1024)
    :v==="milkyway"?paintGalaxyDisk({edge:"#a9c6ff",seed:MILKY_WAY_SEED,spin:MILKY_WAY_SPIN,rich:true,size:1024})
    :v==="triangulum"?paintGalaxyDisk({edge:galaxy.color,seed,spin:2.1,loose:true,size:1024})
    :paintGalaxyDisk({edge:galaxy.color,seed,irregular:true,dwarf:v==="dwarf",size:512}));
  const D=galaxy.visualSize*2,group=new THREE.Group();
  // Orient relative to the VIEW direction, not world axes: both the default camera and the fly-to
  // camera look along ~(0,.55,.83), so composing "face the viewer, spin to a position angle, then
  // incline by tilt" makes each galaxy show its real published inclination on screen — Andromeda
  // reads as the famous 75° ellipse instead of whatever the world-space euler happened to produce.
  const qa=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),new THREE.Vector3(0,.5547,.8321));
  const qpa=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),galaxy.angle*1.3);
  const qt=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),galaxy.tilt);
  group.position.copy(position);group.quaternion.copy(qa).multiply(qpa).multiply(qt);scene.add(group);
  const disk=new THREE.Mesh(new THREE.PlaneGeometry(D,D),new THREE.MeshBasicMaterial({map:texture,transparent:true,opacity:authoredTexture?.86:home?.95:.8,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}));
  group.add(disk);
  // Authored textures already contain calibrated cores. Procedural dwarfs still need a quiet
  // central lift, but adding a generic bloom over M31/M33 erases the morphology we just gained.
  if(!authoredTexture){
    const glow=v==="andromeda"?"255,232,195":`${r},${g},${b}`;
    const core=new THREE.Sprite(new THREE.SpriteMaterial({map:softDot(`rgba(${glow},.45)`,`rgba(${glow},0)`),transparent:true,opacity:.32,depthWrite:false,blending:THREE.AdditiveBlending}));
    core.position.copy(position);core.scale.setScalar(galaxy.visualSize*1.2);scene.add(core);
  }
}

function localPosition(galaxy:NearbyGalaxy){
  return new THREE.Vector3(...galaxy.position);
}

function localDisplayPosition(galaxy:NearbyGalaxy,truePosition:THREE.Vector3,home:THREE.Vector3){
  // The Clouds are genuinely close enough that enlarged glyphs would be swallowed by the Milky
  // Way glyph. Their diamonds stay at the true coordinates; only their illustrated callouts move.
  if(galaxy.id!=="lmc"&&galaxy.id!=="smc")return truePosition.clone();
  return home.clone().add(truePosition.clone().sub(home).normalize().multiplyScalar(galaxy.id==="lmc"?8:10));
}

function localGroupGuides(scene:THREE.Scene,truePositions:Map<string,THREE.Vector3>,displayPositions:Map<string,THREE.Vector3>){
  // A fitted, explicitly schematic envelope replaces the old arbitrary circle. It frames both
  // dominant subgroups without pretending the Local Group has a hard spherical edge.
  const points=Array.from({length:160},(_,index)=>{
    const a=index/160*Math.PI*2,x=Math.cos(a)*61,z=Math.sin(a)*47,rotation=-.22;
    return new THREE.Vector3(x*Math.cos(rotation)-z*Math.sin(rotation)-3,-2,x*Math.sin(rotation)+z*Math.cos(rotation)-9);
  });
  const envelope=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineDashedMaterial({color:"#7085ac",transparent:true,opacity:.18,dashSize:1.4,gapSize:1.8,depthWrite:false}));
  envelope.computeLineDistances();scene.add(envelope);

  const pairs:[[string,string],[string,string],[string,string],[string,string]]=[["milky-way","andromeda"],["andromeda","triangulum"],["milky-way","lmc"],["milky-way","smc"]];
  const relationshipPoints=pairs.flatMap(([from,to])=>[truePositions.get(from)!,truePositions.get(to)!]);
  const relationships=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(relationshipPoints),new THREE.LineDashedMaterial({color:"#8ba4cf",transparent:true,opacity:.13,dashSize:.65,gapSize:.85,depthWrite:false}));
  relationships.computeLineDistances();scene.add(relationships);

  const calloutPoints=["lmc","smc"].flatMap(id=>[truePositions.get(id)!,displayPositions.get(id)!]);
  const callouts=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(calloutPoints),new THREE.LineDashedMaterial({color:"#b2c7eb",transparent:true,opacity:.28,dashSize:.35,gapSize:.42,depthWrite:false}));
  callouts.computeLineDistances();scene.add(callouts);
}

export default function DeepSpace({mode,focusId}:{mode:DeepMode;focusId?:string}){
  const mountRef=useRef<HTMLDivElement>(null),apiRef=useRef<SceneApi|null>(null);
  const catalog=mode==="galaxy"?GALACTIC_REGIONS:NEARBY_GALAXIES;
  const [selected,setSelected]=useState(mode==="galaxy"?"solar-system":"milky-way");
  const [viewMode,setViewMode]=useState<ViewMode>("tilted");
  const [ready,setReady]=useState(false);
  const selectedItem=useMemo(()=>catalog.find(item=>item.id===selected)??catalog[0],[catalog,selected]);

  useEffect(()=>{if(!focusId)return;const timer=window.setTimeout(()=>apiRef.current?.focus(focusId),0);return()=>window.clearTimeout(timer);},[focusId]);

  useEffect(()=>{
    const mount=mountRef.current;if(!mount)return;
    const scene=new THREE.Scene();scene.background=new THREE.Color("#01030a");scene.fog=new THREE.FogExp2("#01030a",mode==="galaxy"?.004:.0025);
    const camera=new THREE.PerspectiveCamera(44,mount.clientWidth/mount.clientHeight,.05,1200);camera.position.set(0,mode==="galaxy"?58:64,mode==="galaxy"?78:92);
    let renderer:THREE.WebGLRenderer;
    try{renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:"high-performance",logarithmicDepthBuffer:true});}
    catch{mount.classList.add("no-webgl");const timer=window.setTimeout(()=>setReady(true),0);apiRef.current={focus:setSelected,view:setViewMode};return()=>{window.clearTimeout(timer);apiRef.current=null;};}
    // Full retina: the 1.65 cap read as upscale blur on the pixel-star grain, which is precisely
    // what this scene sells. The raymarcher clips its march segment tightly, so dpr 2 is affordable.
    renderer.setSize(mount.clientWidth,mount.clientHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.92;mount.appendChild(renderer.domElement);
    // Gentle bloom: a high threshold so only the very brightest cores glow, low strength so galaxies
    // keep their structure instead of melting into white discs. The threshold sits above the
    // volume's self-absorption ceiling, or the whole edge-on band blooms into a white smear.
    const composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));composer.addPass(new UnrealBloomPass(new THREE.Vector2(mount.clientWidth,mount.clientHeight),.4,.5,.92));
    const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.045;controls.enablePan=false;controls.minDistance=6;controls.maxDistance=mode==="galaxy"?170:190;controls.target.set(0,0,0);
    const coarsePointer=matchMedia("(pointer: coarse)").matches;
    const stars=starfield(scene,4200,mode==="galaxy"?380:500);
    const labels:DeepLabel[]=[];
    const markers:DeepMarker[]=[];
    const targets:THREE.Object3D[]=[];const positions=new Map<string,THREE.Vector3>();
    let activeId=mode==="galaxy"?"solar-system":"milky-way",disposed=false;
    const asyncTextures:THREE.Texture[]=[];
    if(mode==="galaxy"){
      const quality=chooseGalaxyDetailQuality(renderer,mount.clientWidth,coarsePointer);
      Promise.all([loadGalaxyDetailTexture(renderer,quality),loadGalaxyVolumeTexture(renderer)]).then(([detail,volume])=>{
        if(disposed){detail.dispose();volume.dispose();return;}
        asyncTextures.push(detail,volume);
        milkyWay(scene,volume);
        scene.add(createGalaxyDetailSurface(detail));
      }).catch(error=>{
        console.warn("[galaxy-detail] continuing with procedural fallback",error);
        if(!disposed)milkyWay(scene);
      }).finally(()=>{if(!disposed)setReady(true);});
      for(const region of GALACTIC_REGIONS){
        const position=new THREE.Vector3(...region.position);positions.set(region.id,position);
        const target=new THREE.Mesh(new THREE.SphereGeometry(region.id==="solar-system"?1.2:.9,16,16),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));target.position.copy(position);target.userData.id=region.id;scene.add(target);targets.push(target);
        const marker=createGalacticMarker(region.markerKind,region.color);marker.position.copy(position);scene.add(marker);
        const markerSize=region.markerKind==="home"?30:region.markerKind==="center"?26:20;markers.push({id:region.id,sprite:marker,anchor:position.clone(),pixelSize:markerSize});
        const label=new THREE.Sprite(new THREE.SpriteMaterial({map:labelTexture(region.name,region.color),transparent:true,depthTest:false,depthWrite:false}));label.position.copy(position);label.renderOrder=3;scene.add(label);labels.push({id:region.id,sprite:label,anchor:position.clone(),worldRadius:0,markerPixelRadius:markerSize/2});
      }
    }else{
      const authored:NearbyGalaxy[]=[];
      const truePositions=new Map(NEARBY_GALAXIES.map(galaxy=>[galaxy.id,localPosition(galaxy)]));
      const home=truePositions.get("milky-way")!;
      for(const galaxy of NEARBY_GALAXIES){
        const coordinate=truePositions.get(galaxy.id)!,position=localDisplayPosition(galaxy,coordinate,home);positions.set(galaxy.id,position);
        if(hasAuthoredLocalGroupTexture(galaxy))authored.push(galaxy);else buildGalaxy(scene,galaxy,position);
        const marker=new THREE.Mesh(new THREE.SphereGeometry(Math.max(1.2,galaxy.visualSize*.55),20,20),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));marker.position.copy(position);marker.userData.id=galaxy.id;scene.add(marker);targets.push(marker);
        const locator=createGalacticMarker(galaxy.id==="milky-way"?"home":"region",galaxy.color);locator.position.copy(coordinate);scene.add(locator);
        const markerSize=galaxy.id==="milky-way"?27:18;markers.push({id:galaxy.id,sprite:locator,anchor:coordinate.clone(),pixelSize:markerSize});
        const label=new THREE.Sprite(new THREE.SpriteMaterial({map:labelTexture(galaxy.name,galaxy.color),transparent:true,depthTest:false,depthWrite:false}));label.position.copy(position).add(new THREE.Vector3(0,galaxy.visualSize+2,0));label.scale.set(13,2.8,1);label.renderOrder=3;scene.add(label);labels.push({id:galaxy.id,sprite:label,anchor:position.clone(),worldRadius:galaxy.visualSize*1.1,markerPixelRadius:0});
      }
      localGroupGuides(scene,truePositions,positions);
      const quality=chooseGalaxyDetailQuality(renderer,mount.clientWidth,coarsePointer);
      Promise.allSettled(authored.map(async galaxy=>({galaxy,texture:await loadLocalGroupTexture(renderer,galaxy,quality)}))).then(results=>{
        if(disposed){for(const result of results)if(result.status==="fulfilled")result.value.texture.dispose();return;}
        for(const [index,result] of results.entries()){
          const galaxy=authored[index],position=positions.get(galaxy.id)!;
          if(result.status==="fulfilled"){
            asyncTextures.push(result.value.texture);buildGalaxy(scene,galaxy,position,result.value.texture);
          }else{
            console.warn(`[local-group] procedural fallback for ${galaxy.id}`,result.reason);buildGalaxy(scene,galaxy,position);
          }
        }
      }).finally(()=>{if(!disposed)setReady(true);});
    }
    let fly:{start:number;from:THREE.Vector3;to:THREE.Vector3;targetFrom:THREE.Vector3;targetTo:THREE.Vector3}|null=null;
    function focus(id:string){const target=positions.get(id);if(!target)return;activeId=id;setSelected(id);const vs=mode==="local"?NEARBY_GALAXIES.find(galaxy=>galaxy.id===id)?.visualSize??3:0;const offset=mode==="galaxy"?new THREE.Vector3(0,14,18):new THREE.Vector3(0,12,18).multiplyScalar(Math.min(2.1,Math.max(.85,vs/3)));fly={start:performance.now(),from:camera.position.clone(),to:target.clone().add(offset),targetFrom:controls.target.clone(),targetTo:target.clone()};}
    function changeView(next:ViewMode){setViewMode(next);const to=next==="top"?new THREE.Vector3(0,mode==="galaxy"?105:115,.01):next==="edge"?new THREE.Vector3(0,3,mode==="galaxy"?110:125):new THREE.Vector3(0,mode==="galaxy"?58:64,mode==="galaxy"?78:92);fly={start:performance.now(),from:camera.position.clone(),to,targetFrom:controls.target.clone(),targetTo:new THREE.Vector3()};}
    apiRef.current={focus,view:changeView};
    const overlays=installDeepOverlays({camera,renderer,coarsePointer,labels,markers,targets,activeId:()=>activeId,focus});
    let frame=0;function animate(now:number){frame=requestAnimationFrame(animate);controls.update();stars.rotation.y+=.000018;if(fly){const t=Math.min(1,(now-fly.start)/1100),ease=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;camera.position.lerpVectors(fly.from,fly.to,ease);controls.target.lerpVectors(fly.targetFrom,fly.targetTo,ease);if(t>=1)fly=null;}overlays.update(now);composer.render();}
    animate(performance.now());
    function resize(){const width=renderer.domElement.parentElement?.clientWidth??1,height=renderer.domElement.parentElement?.clientHeight??1;camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setSize(width,height);composer.setSize(width,height);}
    const observer=new ResizeObserver(resize);observer.observe(mount);
    return()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();overlays.dispose();controls.dispose();composer.dispose();scene.traverse(object=>{(object as THREE.Mesh).geometry?.dispose();const material=(object as THREE.Mesh).material;for(const entry of Array.isArray(material)?material:material?[material]:[]){for(const value of Object.values(entry))if(value instanceof THREE.Texture)value.dispose();entry.dispose();}});for(const texture of asyncTextures)texture.dispose();scene.clear();renderer.dispose();mount.replaceChildren();apiRef.current=null;};
  },[mode]);

  function choose(id:string){setSelected(id);apiRef.current?.focus(id);}
  function changeView(mode:ViewMode){setViewMode(mode);apiRef.current?.view(mode);}
  const isGalaxy=mode==="galaxy",galaxy=selectedItem as NearbyGalaxy;

  return <main className={`deep-shell deep-${mode}`}>
    <div ref={mountRef} className="deep-stage" aria-label={isGalaxy?"Interactive 3D map of the Milky Way":"Interactive 3D map of the Local Group"}>
      <div className="deep-fallback"><div className="fallback-stars"/><div className={`fallback-cosmic fallback-${mode}`}>{Array.from({length:isGalaxy?4:7},(_,index)=><i key={index}/>)}</div><strong>{isGalaxy?"MILKY WAY":"LOCAL GROUP"}</strong><span>3D preview unavailable</span></div>
    </div>
    <div className={`loading-veil ${ready?"is-ready":""}`}><div className="loading-orbit"/><span>{isGalaxy?"Mapping the Milky Way":"Finding our neighboring galaxies"}</span></div>
    <header className="deep-topbar"><div className="brand"><span className="brand-mark"><i/><i/><b/></span><span><strong>HELIOS</strong><small>{isGalaxy?"Milky Way atlas":"Local Group atlas"}</small></span></div><div className="deep-scale"><span>{isGalaxy?"100,000":"10 million"}</span><small>LIGHT-YEAR VIEW</small></div></header>
    <aside className="deep-tools"><div className="eyebrow">NAVIGATE</div><p><span>Drag</span> to orbit<br/><span>Scroll</span> to travel<br/><span>Click</span> a labeled region</p><div className="deep-view-picker" aria-label="Choose viewing angle">{(["tilted","top","edge"] as ViewMode[]).map(value=><button key={value} className={viewMode===value?"active":""} onClick={()=>changeView(value)}>{value==="top"?"TOP":value==="edge"?"EDGE":"3D"}</button>)}</div><small className="deep-honesty">{isGalaxy?"Structure is a scientific visualization. We cannot photograph the Milky Way from outside it.":"Distances from the Milky Way are scaled; galaxy sizes are enlarged for visibility and directions are schematic."}</small></aside>
    <div className="deep-rail" aria-label={isGalaxy?"Choose a galactic region":"Choose a nearby galaxy"}>{catalog.map(item=><button key={item.id} className={selected===item.id?"selected":""} onClick={()=>choose(item.id)} style={{"--object":item.color} as React.CSSProperties}><i/><small>{item.name}</small></button>)}</div>
    <aside className="cosmic-info" aria-live="polite"><div className="panel-index">{isGalaxy?"MILKY WAY":"LOCAL GROUP"}</div><div className="eyebrow">{selectedItem.kind}</div><h1>{selectedItem.name}</h1><p className="lede">{selectedItem.description}</p><div className="cosmic-facts">{isGalaxy?<><div><span>LOCATION</span><strong>{(selectedItem as GalacticRegion).distance}</strong></div><div><span>REGION</span><strong>{(selectedItem as GalacticRegion).scale}</strong></div></>:<><div><span>DISTANCE FROM US</span><strong>{galaxy.distanceMly===0?"We are inside it":galaxy.distanceMly<1?`${Math.round(galaxy.distanceMly*1_000_000).toLocaleString()} light-years`:`${galaxy.distanceMly.toFixed(2)} million light-years`}</strong></div><div><span>DIAMETER</span><strong>{galaxy.diameter}</strong></div><div><span>STARS</span><strong>{galaxy.stars}</strong></div></>}</div><div className="wild-fact"><span>✦ WORTH KNOWING</span><p>{selectedItem.fact}</p></div></aside>
    <footer className="deep-footer"><span>{isGalaxy?"GALACTIC MAP":"LOCAL GROUP MAP"}</span>{isGalaxy?"Approximate structure assembled from observations made inside the Milky Way":"Distances are educational approximations; galaxy diameters are visually enlarged"}<details><summary>Sources</summary><div>{DEEP_SOURCE_LINKS.map(([label,url])=><a key={url} href={url} target="_blank" rel="noreferrer">{label} ↗</a>)}</div></details></footer>
  </main>;
}
