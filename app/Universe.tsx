"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { UNIVERSE_LANDMARKS } from "./cosmic";
import { createGalacticMarker } from "./galaxyDetail";
import { createUniverseVolume } from "./universeVolume";
import { installDeepOverlays, labelTexture } from "./deepOverlays";
import type { DeepLabel, DeepMarker } from "./deepOverlays";
import type { UniverseField } from "./universeField";

type ViewMode="tilted"|"top"|"edge";
type SceneApi={focus:(id:string)=>void;view:(mode:ViewMode)=>void};
const ASSET_BASE=process.env.NEXT_PUBLIC_BASE_PATH??"";
const UNIVERSE_SOURCES=[
  ["NASA · Large-scale structures","https://science.nasa.gov/universe/galaxies/large-scale-structures/"],
  ["Nature · The Laniakea supercluster","https://www.nature.com/articles/nature13674"],
  ["NASA · WMAP 9-year ILC map","https://lambda.gsfc.nasa.gov/product/wmap/current/map_browse_ilc.php"],
  ["ESA · Planck CMB maps","https://www.cosmos.esa.int/web/planck/picture-gallery"],
];

async function loadUniverseField():Promise<UniverseField>{
  // This committed gzip is the deliberate WP1 choice over a Worker: it never generates 128³
  // voxels on the main thread, survives static export, and can be copied directly into tvOS later.
  const response=await fetch(`${ASSET_BASE}/textures/universe/cosmic-web-128.rgba.gz`);if(!response.ok||!response.body)throw new Error(`field asset returned ${response.status}`);
  const bytes=new Uint8Array(await new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()),size=128;if(bytes.length!==size**3*4)throw new Error(`field asset has ${bytes.length} bytes`);return{data:bytes,size};
}

function proceduralCmbTexture(){
  // Planck image reuse terms were not pinned in the approved design, so WP1 uses a clearly labeled,
  // deterministic CMB-statistics fallback rather than implying this is an ESA data product.
  const low=document.createElement("canvas");low.width=256;low.height=128;const context=low.getContext("2d")!,image=context.createImageData(low.width,low.height),hash=(x:number,y:number,n:number)=>{const v=Math.sin(x*12.9898+y*78.233+n*37.719)*43758.5453;return v-Math.floor(v);};
  for(let y=0;y<low.height;y++)for(let x=0;x<low.width;x++){let value=0,weight=0;for(let octave=0;octave<4;octave++){const cell=2**(5-octave),sx=x/cell,sy=y/cell,ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy,mix=(a:number,b:number,t:number)=>a+(b-a)*t,s=(t:number)=>t*t*(3-2*t),noise=mix(mix(hash(ix,iy,octave),hash(ix+1,iy,octave),s(fx)),mix(hash(ix,iy+1,octave),hash(ix+1,iy+1,octave),s(fx)),s(fy)),gain=1/(octave+1);value+=(noise-.5)*gain;weight+=gain;}value=value/weight+.5;const offset=(y*low.width+x)*4,cold=Math.max(0,.5-value),warm=Math.max(0,value-.5);image.data[offset]=Math.round(34+warm*360);image.data[offset+1]=Math.round(30+(.5-Math.abs(value-.5))*110);image.data[offset+2]=Math.round(50+cold*360);image.data[offset+3]=255;}
  context.putImageData(image,0,0);const canvas=document.createElement("canvas");canvas.width=1024;canvas.height=512;const output=canvas.getContext("2d")!;output.imageSmoothingEnabled=true;output.drawImage(low,0,0,canvas.width,canvas.height);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=THREE.RepeatWrapping;return texture;
}

function universePosition(position:[number,number,number]){return new THREE.Vector3(...position).multiplyScalar(52);}
function lookbackRings(scene:THREE.Scene){for(const [radius,text] of [[85,"1 BILLION LY · BEFORE ANIMALS"],[125,"5 BILLION LY · BEFORE THE SUN"]] as const){const points=Array.from({length:160},(_,index)=>{const angle=index/160*Math.PI*2;return new THREE.Vector3(Math.cos(angle)*radius,-6,Math.sin(angle)*radius);}),ring=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineDashedMaterial({color:"#8fa8c8",transparent:true,opacity:.1,dashSize:1.5,gapSize:2.2,depthWrite:false}));ring.computeLineDistances();scene.add(ring);const label=new THREE.Sprite(new THREE.SpriteMaterial({map:labelTexture(text,"#8fa8c8"),transparent:true,opacity:.3,depthTest:false,depthWrite:false}));label.position.set(radius*.7,-4,-radius*.7);label.scale.set(21,4.6,1);label.renderOrder=3;scene.add(label);}}

export default function Universe({focusId}:{focusId?:string}){
  const mountRef=useRef<HTMLDivElement>(null),apiRef=useRef<SceneApi|null>(null);
  const [selected,setSelected]=useState("local-group"),[viewMode,setViewMode]=useState<ViewMode>("tilted"),[ready,setReady]=useState(false);
  const selectedItem=useMemo(()=>UNIVERSE_LANDMARKS.find(item=>item.id===selected)??UNIVERSE_LANDMARKS[0],[selected]);

  useEffect(()=>{if(!focusId)return;const timer=window.setTimeout(()=>apiRef.current?.focus(focusId),0);return()=>window.clearTimeout(timer);},[focusId]);
  useEffect(()=>{
    const mount=mountRef.current;if(!mount)return;const scene=new THREE.Scene();scene.background=new THREE.Color("#010208");
    const camera=new THREE.PerspectiveCamera(46,mount.clientWidth/mount.clientHeight,.05,700);camera.position.set(0,76,112);
    let renderer:THREE.WebGLRenderer;
    try{renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:"high-performance"});}
    catch{mount.classList.add("no-webgl");const timer=window.setTimeout(()=>setReady(true),0);apiRef.current={focus:setSelected,view:setViewMode};return()=>{window.clearTimeout(timer);apiRef.current=null;};}
    // Fill-bound 3D marching ships at 0.75 render scale by default: DPR 2 becomes 1.5 backing DPR.
    renderer.setSize(mount.clientWidth,mount.clientHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,2)*.75);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.9;mount.appendChild(renderer.domElement);
    const composer=new EffectComposer(renderer);composer.setPixelRatio(renderer.getPixelRatio());composer.setSize(mount.clientWidth,mount.clientHeight);composer.addPass(new RenderPass(scene,camera));composer.addPass(new UnrealBloomPass(new THREE.Vector2(mount.clientWidth*renderer.getPixelRatio(),mount.clientHeight*renderer.getPixelRatio()),.35,.45,.9));
    const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.045;controls.enablePan=false;controls.minDistance=8;controls.maxDistance=165;controls.autoRotate=true;controls.autoRotateSpeed=.08;
    // Opacity kept low on top of the bake-time quieting: the first light is the backdrop of this
// scale, never its wallpaper — the web must stay the brightest thing on screen.
const cmbFallback=proceduralCmbTexture(),cmbMaterial=new THREE.MeshBasicMaterial({map:cmbFallback,side:THREE.BackSide,depthWrite:false,toneMapped:false,opacity:.34,transparent:true}),cmb=new THREE.Mesh(new THREE.SphereGeometry(172,64,32),cmbMaterial);cmb.rotation.y=.7;scene.add(cmb);lookbackRings(scene);
    const labels:DeepLabel[]=[],markers:DeepMarker[]=[],targets:THREE.Object3D[]=[],positions=new Map<string,THREE.Vector3>();let activeId="local-group",fly:{start:number;duration:number;from:THREE.Vector3;control:THREE.Vector3;to:THREE.Vector3;targetFrom:THREE.Vector3;targetTo:THREE.Vector3}|null=null,disposed=false,interacting=false,volume:ReturnType<typeof createUniverseVolume>|null=null;
    new THREE.TextureLoader().load(`${ASSET_BASE}/textures/universe/cmb-wmap-2048.webp`,texture=>{if(disposed){texture.dispose();return;}texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=THREE.RepeatWrapping;cmbMaterial.map=texture;cmbMaterial.needsUpdate=true;cmbFallback.dispose();},undefined,error=>console.warn("[universe-cmb] using procedural fallback",error));
    for(const landmark of UNIVERSE_LANDMARKS){const position=universePosition(landmark.position);positions.set(landmark.id,position);const target=new THREE.Mesh(new THREE.SphereGeometry(landmark.id==="local-group"?2.1:1.5,16,16),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));target.position.copy(position);target.userData.id=landmark.id;scene.add(target);targets.push(target);const marker=createGalacticMarker(landmark.id==="local-group"?"home":"region",landmark.color);scene.add(marker);const markerSize=landmark.id==="local-group"?30:18;markers.push({id:landmark.id,sprite:marker,anchor:position.clone(),pixelSize:markerSize});const label=new THREE.Sprite(new THREE.SpriteMaterial({map:labelTexture(landmark.name,landmark.color),transparent:true,depthTest:false,depthWrite:false}));label.renderOrder=4;scene.add(label);labels.push({id:landmark.id,sprite:label,anchor:position.clone(),worldRadius:1.4,markerPixelRadius:markerSize/2});}
    function focus(id:string){const target=positions.get(id);if(!target)return;activeId=id;setSelected(id);const radial=target.length(),direction=radial<1?new THREE.Vector3(0,0,1):target.clone().normalize(),to=id==="cmb"?direction.clone().multiplyScalar(138).add(new THREE.Vector3(0,10,0)):target.clone().add(radial<1?new THREE.Vector3(0,34,52):direction.clone().multiplyScalar(36).add(new THREE.Vector3(0,16,18))),inside=target.clone().multiplyScalar(.25),side=new THREE.Vector3().crossVectors(direction,new THREE.Vector3(0,1,0));if(side.lengthSq()<.01)side.set(1,0,0);inside.add(side.normalize().multiplyScalar(12));const distance=camera.position.distanceTo(to);fly={start:performance.now(),duration:Math.min(3400,1500+distance*10),from:camera.position.clone(),control:inside,to,targetFrom:controls.target.clone(),targetTo:target.clone()};}
    function changeView(next:ViewMode){setViewMode(next);const to=next==="top"?new THREE.Vector3(0,142,.01):next==="edge"?new THREE.Vector3(0,3,142):new THREE.Vector3(0,76,112);fly={start:performance.now(),duration:1200,from:camera.position.clone(),control:camera.position.clone().lerp(to,.5),to,targetFrom:controls.target.clone(),targetTo:new THREE.Vector3()};}
    apiRef.current={focus,view:changeView};const overlays=installDeepOverlays({camera,renderer,coarsePointer:matchMedia("(pointer: coarse)").matches,labels,markers,targets,activeId:()=>activeId,focus});
    controls.addEventListener("start",()=>{interacting=true;fly=null;});controls.addEventListener("end",()=>{interacting=false;});
    loadUniverseField().then(field=>{if(disposed)return;volume=createUniverseVolume(field);scene.add(volume);setReady(true);}).catch(error=>{console.warn("[universe-field] unable to load volume",error);if(!disposed){mount!.classList.add("no-webgl");setReady(true);}});
    let frame=0;function animate(now:number){frame=requestAnimationFrame(animate);controls.autoRotate=!fly&&!interacting;controls.update();cmb.rotation.y+=.000015;if(fly){const t=Math.min(1,(now-fly.start)/fly.duration),ease=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2,inverse=1-ease;camera.position.copy(fly.from).multiplyScalar(inverse*inverse).addScaledVector(fly.control,2*inverse*ease).addScaledVector(fly.to,ease*ease);controls.target.lerpVectors(fly.targetFrom,fly.targetTo,ease);if(t>=1)fly=null;}volume?.updateCamera(camera);overlays.update(now);composer.render();}animate(performance.now());
    function resize(){const width=mount!.clientWidth||1,height=mount!.clientHeight||1;camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setSize(width,height);composer.setSize(width,height);}const observer=new ResizeObserver(resize);observer.observe(mount);
    return()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();overlays.dispose();controls.dispose();composer.dispose();scene.traverse(object=>{(object as THREE.Mesh).geometry?.dispose();const material=(object as THREE.Mesh).material;for(const entry of Array.isArray(material)?material:material?[material]:[]){for(const value of Object.values(entry))if(value instanceof THREE.Texture)value.dispose();entry.dispose();}});scene.clear();renderer.dispose();mount.replaceChildren();apiRef.current=null;};
  },[]);

  function choose(id:string){setSelected(id);apiRef.current?.focus(id);}function changeView(mode:ViewMode){setViewMode(mode);apiRef.current?.view(mode);}
  return <main className="deep-shell deep-universe">
    <div ref={mountRef} className="deep-stage" aria-label="Interactive 3D map of the observable universe"><div className="deep-fallback"><div className="fallback-stars"/><div className="fallback-cosmic fallback-universe">{UNIVERSE_LANDMARKS.map(item=><i key={item.id}/>)}</div><strong>OBSERVABLE UNIVERSE</strong><span>3D volume unavailable · landmarks remain interactive</span></div></div>
    <div className={`loading-veil ${ready?"is-ready":""}`}><div className="loading-orbit"/><span>Reaching the edge of the observable universe</span></div>
    <header className="deep-topbar"><div className="brand"><span className="brand-mark"><i/><i/><b/></span><span><strong>HELIOS</strong><small>Observable Universe atlas</small></span></div><div className="deep-scale"><span>93 billion</span><small>LIGHT-YEAR VIEW</small></div></header>
    <aside className="deep-tools"><div className="eyebrow">NAVIGATE</div><p><span>Drag</span> to orbit<br/><span>Scroll</span> to travel<br/><span>Click</span> a labeled structure</p><div className="deep-view-picker" aria-label="Choose viewing angle">{(["tilted","top","edge"] as ViewMode[]).map(value=><button key={value} className={viewMode===value?"active":""} onClick={()=>changeView(value)}>{value==="top"?"TOP":value==="edge"?"EDGE":"3D"}</button>)}</div><small className="deep-honesty">Filament texture is a deterministic statistical illustration. Survey anchors use compressed schematic positions; objects beyond roughly one billion light-years are pointers.</small></aside>
    <div className="deep-rail" aria-label="Choose a universe landmark">{UNIVERSE_LANDMARKS.map(item=><button key={item.id} className={selected===item.id?"selected":""} onClick={()=>choose(item.id)} style={{"--object":item.color} as React.CSSProperties}><i/><small>{item.name}</small></button>)}</div>
    <aside className="cosmic-info" aria-live="polite"><div className="panel-index">OBSERVABLE UNIVERSE · DISTANCES COMPRESSED</div><div className="eyebrow">{selectedItem.kind}</div><h1>{selectedItem.name}</h1><p className="lede">{selectedItem.description}</p><div className="cosmic-facts"><div><span>DISTANCE / LOOKBACK</span><strong>{selectedItem.distance}</strong></div><div><span>MAP STATUS</span><strong>{selectedItem.schematic?"Schematic distant pointer":"Survey anchor · schematic placement"}</strong></div><div><span>STRUCTURE</span><strong>{selectedItem.scale}</strong></div></div><div className="wild-fact"><span>✦ WORTH KNOWING</span><p>{selectedItem.fact}</p></div><p className="universe-cmb-note">BOUNDARY · WMAP full-sky microwave map · NASA/WMAP Science Team</p></aside>
    <footer className="deep-footer"><span>OBSERVABLE UNIVERSE MAP</span>Filament texture is a statistical illustration; labeled structures are placed from surveys; distant anchors are schematic pointers<details><summary>Sources</summary><div>{UNIVERSE_SOURCES.map(([label,url])=><a key={url} href={url} target="_blank" rel="noreferrer">{label} ↗</a>)}</div></details></footer>
  </main>;
}
