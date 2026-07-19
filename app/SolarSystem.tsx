"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ALL_BODIES, DWARFS, MOONS, ORBITING_BODIES, PLANETS, SMALL_BODIES } from "./bodies";
import type { BodyName, Planet, SmallBodyCategory } from "./bodies";
import { deg, heliocentricDistanceAU, heliocentricPosition, orbitPath } from "./orbits";
import type { AmbientApi, AmbientState } from "./useAmbient";

type ScaleMode = "readable" | "linear" | "true";

// Next rewrites its own asset URLs for basePath, but Three.js loads textures from raw
// strings, so these paths must carry the prefix themselves. See next.config.ts.
const ASSET_BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const TEXTURE_MAPS:Partial<Record<BodyName,{path:string;label:string}>>={
  Sun:{path:"/textures/sun.webp",label:"NASA-based solar reference texture"},
  Mercury:{path:"/textures/mercury.webp",label:"NASA-based global reference map"},
  Venus:{path:"/textures/venus.webp",label:"NASA-based cloud-layer reference map"},
  Earth:{path:"/textures/earth.webp",label:"NASA Blue Marble–based day map"},
  Moon:{path:"/textures/moon.webp",label:"NASA-based lunar global map"},
  Mars:{path:"/textures/mars.webp",label:"NASA-based global reference map"},
  Jupiter:{path:"/textures/jupiter.webp",label:"NASA-based atmospheric reference map"},
  Saturn:{path:"/textures/saturn.webp",label:"NASA-based atmosphere · Cassini-derived ring bands"},
  Uranus:{path:"/textures/uranus.webp",label:"NASA-based atmospheric reference map"},
  Neptune:{path:"/textures/neptune.webp",label:"NASA-based atmospheric reference map"},
  Ceres:{path:"/textures/ceres.webp",label:"Reference reconstruction · incomplete mapping"},
  Pluto:{path:"/textures/pluto.webp",label:"New Horizons global color mosaic"},
};

const TOUR: { body: BodyName; eyebrow: string; title: string; note: string }[] = [
  { body: "Sun", eyebrow: "Stop 1 · The anchor", title: "Begin at the star", note: "The Sun contains 99.86% of the solar system’s mass. Everything here is falling around it." },
  { body: "Mercury", eyebrow: "Stop 2 · Inner frontier", title: "A world of extremes", note: "Mercury races around the Sun faster than any other planet, but turns very slowly." },
  { body: "Venus", eyebrow: "Stop 3 · Earth’s strange twin", title: "The hottest planet", note: "Venus is not closest to the Sun, yet its thick atmosphere traps enough heat to melt lead." },
  { body: "Earth", eyebrow: "Stop 4 · One astronomical unit", title: "The pale blue reference point", note: "Astronomers use Earth’s average Sun-distance—149.6 million km—as a measuring stick: 1 AU." },
  { body: "Mars", eyebrow: "Stop 5 · The red world", title: "A planet-sized archive", note: "Mars preserves ancient river valleys and lake beds from a time when it was warmer and wetter." },
  { body: "Asteroid Belt", eyebrow: "Stop 6 · Between the worlds", title: "The asteroid belt", note: "Most asteroids orbit between Mars and Jupiter, spread across an enormous region. A spacecraft can usually cross it without coming close to one." },
  { body: "Jupiter", eyebrow: "Stop 7 · Giant country", title: "A miniature system", note: "Jupiter and its many moons behave almost like a small solar system inside our own." },
  { body: "Saturn", eyebrow: "Stop 8 · Rings in motion", title: "Billions of orbiting pieces", note: "Saturn’s rings are enormous across, but the main rings are typically only about 10 meters thick." },
  { body: "Uranus", eyebrow: "Stop 9 · The sideways world", title: "An ice giant tipped over", note: "Uranus rotates almost on its side. Each pole experiences about 42 Earth years of sunlight followed by 42 years of darkness." },
  { body: "Neptune", eyebrow: "Stop 10 · The blue edge", title: "Four light-hours from home", note: "At Neptune, sunlight is about 900 times dimmer than it is on Earth." },
  { body: "Kuiper Belt", eyebrow: "Stop 11 · Beyond the planets", title: "The Kuiper belt", note: "This broad ring of icy leftovers begins near Neptune and extends to roughly 50 AU. Pluto is one of its best-known residents." },
];

const SOURCE_LINKS = [
  ["JPL orbital elements", "https://ssd.jpl.nasa.gov/planets/approx_pos.html"],
  ["JPL Small-Body Database", "https://ssd-api.jpl.nasa.gov/doc/sbdb.html"],
  ["JPL satellite elements", "https://ssd.jpl.nasa.gov/sats/elem/"],
  ["JPL satellite physical data", "https://ssd.jpl.nasa.gov/sats/phys_par/"],
  ["Planet texture maps · CC BY 4.0", "https://www.solarsystemscope.com/textures/"],
  ["NASA Pluto global color map", "https://science.nasa.gov/resource/pluto-global-color-map/"],
  ["NASA Cassini ring science", "https://science.nasa.gov/mission/cassini/science/rings/"],
  ["NASA comet facts", "https://science.nasa.gov/solar-system/comets/"],
  ["NASA Arrokoth overview", "https://science.nasa.gov/solar-system/kuiper-belt/arrokoth-2014-mu69/"],
  ["NASA asteroid facts", "https://science.nasa.gov/solar-system/asteroids/"],
  ["NASA planet sizes & locations", "https://science.nasa.gov/solar-system/planets/planet-sizes-and-locations-in-our-solar-system/"],
  ["NASA solar system facts", "https://science.nasa.gov/solar-system/solar-system-facts/"],
];

// Orbital math lives in ./orbits, free of Three.js so it can be unit-tested. These two
// adapters are the only bridge: everything downstream works in THREE.Vector3.
function heliocentricVector(planet:Planet,date:Date){const {x,y,z}=heliocentricPosition(planet,date);return new THREE.Vector3(x,y,z);}
function orbitVectors(planet:Planet,date:Date,segments:number){return orbitPath(planet,date,segments).map(({x,y,z})=>new THREE.Vector3(x,y,z));}

function seeded(n: number) {
  const x = Math.sin(n * 999.91) * 43758.5453;
  return x - Math.floor(x);
}

function mixHex(a:string,b:string,t:number){
  const channels=(value:string)=>[1,3,5].map(index=>parseInt(value.slice(index,index+2),16));
  const [ar,ag,ab]=channels(a),[br,bg,bb]=channels(b);
  return `rgb(${Math.round(ar+(br-ar)*t)},${Math.round(ag+(bg-ag)*t)},${Math.round(ab+(bb-ab)*t)})`;
}

// Moon display spacing is deliberately compressed rather than physical (see CLAUDE.md), and
// it depends only on the catalog — so it is constant. Solve it once here: the playback loop
// used to recompute it about forty times a frame, allocating a family array on each call.
const COMPACT_MOON_RADII=new Map<BodyName,number>(MOONS.map(moon=>{
  const family=MOONS.filter(sibling=>sibling.moon!.parent===moon.moon!.parent);
  const parent=ALL_BODIES.find(body=>body.name===moon.moon!.parent)!;
  const largest=Math.max(...family.map(sibling=>sibling.radius));
  const inner=parent.radius+largest+.7,spacing=Math.max(.7,largest*1.45);
  return [moon.name,inner+family.findIndex(sibling=>sibling.name===moon.name)*spacing];
}));
function compactMoonOrbitRadius(moon:Planet){return COMPACT_MOON_RADII.get(moon.name)!;}

// Every calendar date in this app is a UTC date. Positions are computed at UTC noon and
// the panels format with timeZone:"UTC", so deriving the date chip from local time (as
// this once did) made the chip and the SIMULATION DATE label disagree by a day for anyone
// far enough from Greenwich, and made pausing playback light up TODAY for no reason.
function dateValue(date:Date){return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}-${String(date.getUTCDate()).padStart(2,"0")}`;}
function dateFromValue(value:string){return new Date(`${value}T12:00:00Z`);}
function dateForMap(value:string){const now=new Date();return value===dateValue(now)?now:dateFromValue(clampDateValue(value));}

// The single source of truth for the supported range. The date input's min/max, the
// playback bounds, and the manual-entry clamp all derive from these — previously the
// input and the playback bounds were separate literals that had to be kept in sync, and
// nothing clamped manual entry at all: min/max on <input type="date"> only marks a typed
// value invalid, it still fires change, so a typed year like 1500 drove the scene far
// outside the range these elements are valid for.
const MIN_DATE_VALUE="1800-01-01",MAX_DATE_VALUE="2050-12-31";
function clampDateValue(value:string){return value<MIN_DATE_VALUE?MIN_DATE_VALUE:value>MAX_DATE_VALUE?MAX_DATE_VALUE:value;}
const MIN_SIM_TIME=dateFromValue(MIN_DATE_VALUE).getTime(),MAX_SIM_TIME=dateFromValue(MAX_DATE_VALUE).getTime();

const PLAYBACK_SPEEDS=[{days:1,label:"1 day / sec"},{days:7,label:"1 week / sec"},{days:30,label:"1 month / sec"},{days:365,label:"1 year / sec"},{days:3650,label:"10 years / sec"}];

function makePlanetTexture(planet: Planet) {
  const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const highlight=mixHex(planet.color,planet.accent,.28);
  const lowlight=mixHex(planet.color,"#101522",.7);
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, highlight); grad.addColorStop(.42, planet.color); grad.addColorStop(1, lowlight);
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 512, 256);
  if (["Jupiter", "Saturn", "Venus", "Uranus", "Neptune"].includes(planet.name)) {
    for (let y = 12; y < 250; y += planet.name === "Jupiter" ? 13 : 20) {
      const alpha = .07 + seeded(y) * .13;
      const band=planet.name === "Neptune" ? "150,180,238" : planet.name === "Uranus" ? "157,213,213" : "218,187,137";
      ctx.fillStyle = `rgba(${band},${alpha})`;
      ctx.fillRect(0, y, 512, 3 + seeded(y + 1) * 7);
    }
    if (planet.name === "Jupiter") { ctx.fillStyle = "rgba(153,51,31,.68)"; ctx.beginPath(); ctx.ellipse(355, 159, 34, 12, -.08, 0, Math.PI * 2); ctx.fill(); }
  } else {
    for (let i = 0; i < 260; i++) {
      const x = seeded(i * 3) * 512, y = seeded(i * 7 + 2) * 256, r = 1 + seeded(i * 11) * 9;
      ctx.fillStyle = planet.name === "Earth" ? (seeded(i) > .55 ? "rgba(54,112,59,.78)" : "rgba(220,235,240,.16)") : `rgba(30,20,18,${.04 + seeded(i + 8) * .22})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return texture;
}

function labelTexture(name: string, color: string) {
  const c = document.createElement("canvas"); c.width = 384; c.height = 96; const x = c.getContext("2d")!;
  x.font = "600 30px Arial"; x.textAlign = "center"; x.fillStyle = "rgba(5,8,18,.78)"; x.roundRect(62, 17, 260, 58, 29); x.fill();
  x.strokeStyle = color; x.globalAlpha = .5; x.stroke(); x.globalAlpha = 1; x.fillStyle = "#c3c9d4"; x.fillText(name.toUpperCase(), 192, 55);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

type SolarSystemProps = { apiRef:React.MutableRefObject<AmbientApi|null>;ambient:AmbientState };

export default function Home({apiRef,ambient}:SolarSystemProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<BodyName | null>("Earth");
  const [tourIndex, setTourIndex] = useState<number | null>(null);
  const [scaleMode, setScaleMode] = useState<ScaleMode>("readable");
  const [smallBodyCategory,setSmallBodyCategory]=useState<SmallBodyCategory>("off");
  const [distanceLabel, setDistanceLabel] = useState("30 AU span");
  const [ready, setReady] = useState(false);
  const today=dateValue(new Date());const [mapDate,setMapDate]=useState(today);
  const selectedDate=useMemo(()=>dateForMap(mapDate),[mapDate]);const isToday=mapDate===today;
  const [isPlaying,setIsPlaying]=useState(false);const [playbackRate,setPlaybackRate]=useState(30);const [playbackDirection,setPlaybackDirection]=useState<1|-1>(1);const simulationDateRef=useRef(selectedDate);
  const selectedBody = useMemo(() => ALL_BODIES.find(p => p.name === selected), [selected]);
  useEffect(() => {
    if (!mountRef.current) return;
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#02030a");
    scene.fog = new THREE.FogExp2("#02030a", .00135);
    const camera = new THREE.PerspectiveCamera(46, mount.clientWidth / mount.clientHeight, .000001, 12000);
    camera.position.set(0, 115, 165);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", logarithmicDepthBuffer:true });
    } catch {
      mount.classList.add("no-webgl");
      apiRef.current = { focus:(name)=>setSelected(name),scale:()=>setSelected(null),smallBodies:()=>undefined,date:()=>undefined,previewDate:()=>undefined,flyTo:(name,onArrive)=>{setSelected(name);onArrive();},setAmbient:()=>undefined };
      window.setTimeout(() => setReady(true), 0);
      return () => { apiRef.current = null; };
    }
    renderer.setSize(mount.clientWidth, mount.clientHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75)); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .98;
    mount.appendChild(renderer.domElement);
    const textureManager=new THREE.LoadingManager();
    const textureLoader=new THREE.TextureLoader(textureManager);
    const maxAnisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    function mappedTexture(body:Planet){
      const source=TEXTURE_MAPS[body.name];
      if(!source)return makePlanetTexture(body);
      const texture=textureLoader.load(`${ASSET_BASE}${source.path}`);
      texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=maxAnisotropy;texture.wrapS=THREE.RepeatWrapping;
      return texture;
    }
    const saturnRingTexture=textureLoader.load(`${ASSET_BASE}/textures/saturn-ring.png`);
    saturnRingTexture.colorSpace=THREE.SRGBColorSpace;saturnRingTexture.anisotropy=maxAnisotropy;saturnRingTexture.wrapS=THREE.ClampToEdgeWrapping;
    function radialRingGeometry(inner:number,outer:number){
      const geometry=new THREE.RingGeometry(inner,outer,256,1);const positions=geometry.attributes.position,uv=geometry.attributes.uv;
      for(let i=0;i<positions.count;i++){const radius=Math.hypot(positions.getX(i),positions.getY(i));uv.setXY(i,(radius-inner)/(outer-inner),.5);}
      return geometry;
    }
    const composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(mount.clientWidth, mount.clientHeight), 1.05, .85, .62));
    const coarsePointer=window.matchMedia("(pointer: coarse)").matches;
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = .045; controls.minDistance = 3; controls.maxDistance = 6500; controls.zoomSpeed = coarsePointer ? .9 : .7; controls.rotateSpeed = coarsePointer ? .32 : .4; controls.enablePan=!coarsePointer;
    controls.touches.ONE=THREE.TOUCH.ROTATE;controls.touches.TWO=THREE.TOUCH.DOLLY_ROTATE;
    controls.target.set(0, 0, 0);

    scene.add(new THREE.AmbientLight("#6a83be", .58));
    // Constant display-space strength keeps the lit side detailed in both readable and linear scale modes.
    const sunLight = new THREE.PointLight("#ffd7a1", 1.2, 0, 0); scene.add(sunLight);

    const starGeo = new THREE.BufferGeometry(); const starCount = 5200; const stars = new Float32Array(starCount * 3); const starColors = new Float32Array(starCount * 3);
    const col = new THREE.Color();
    for (let i = 0; i < starCount; i++) {
      const r = 180 + seeded(i) * 640, th = seeded(i + 8) * Math.PI * 2, ph = Math.acos(2 * seeded(i + 18) - 1);
      stars[i*3] = r * Math.sin(ph) * Math.cos(th); stars[i*3+1] = r * Math.cos(ph) * .7; stars[i*3+2] = r * Math.sin(ph) * Math.sin(th);
      col.set(i % 13 === 0 ? "#7aa2ff" : i % 17 === 0 ? "#ffd1aa" : "#ffffff"); starColors.set([col.r,col.g,col.b], i*3);
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(stars, 3)); starGeo.setAttribute("color", new THREE.BufferAttribute(starColors, 3));
    const starField = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: .72, transparent: true, opacity: .72, vertexColors: true, sizeAttenuation: true, depthWrite: false })); scene.add(starField);

    const bodies = new Map<BodyName, THREE.Mesh>(); const labels: THREE.Sprite[] = []; const orbitGroup = new THREE.Group(); scene.add(orbitGroup);
    // Keyed lookups: positionBodies runs every playback frame and used to linear-scan the
    // label array and orbitGroup.children once per body.
    const labelsByBody = new Map<BodyName, THREE.Sprite>(); const orbitLines = new Map<BodyName, THREE.LineLoop>();
    const planetGroup = new THREE.Group(); scene.add(planetGroup);
    const sunGeo = new THREE.SphereGeometry(7.2, 64, 64);
    const sunMat = new THREE.MeshBasicMaterial({ map:mappedTexture(PLANETS[0]),color:"#ffc66c" });
    const sun = new THREE.Mesh(sunGeo, sunMat); sun.userData.body = "Sun"; planetGroup.add(sun); bodies.set("Sun", sun);
    const glowMap = (() => { const c=document.createElement("canvas");c.width=128;c.height=128;const x=c.getContext("2d")!;const g=x.createRadialGradient(64,64,4,64,64,64);g.addColorStop(0,"rgba(255,244,190,1)");g.addColorStop(.22,"rgba(255,171,51,.8)");g.addColorStop(1,"rgba(255,102,0,0)");x.fillStyle=g;x.fillRect(0,0,128,128);return new THREE.CanvasTexture(c); })();
    const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({map:glowMap,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending})); sunGlow.scale.set(33,33,1); sun.add(sunGlow);

    const orbitMaterials: THREE.LineBasicMaterial[] = [];
    const KM_PER_AU=149_597_870.7,UNITS_PER_AU=5.5;
    const distanceScale = (au: number, mode: ScaleMode) => mode === "readable" ? Math.sqrt(au) * 29 : au * UNITS_PER_AU;
    function transformed(raw: THREE.Vector3, mode: ScaleMode) { const au=raw.length(); return au ? raw.clone().normalize().multiplyScalar(distanceScale(au, mode)) : raw.clone(); }
    function bodyDisplayScale(body:Planet,mode:ScaleMode){
      if(mode==="readable")return 1;
      if(mode==="linear")return body.name==="Sun"?.08:.36;
      return (body.radiusKm/KM_PER_AU*UNITS_PER_AU)/body.radius;
    }
    let activeDate=new Date();

    type BeltSeed = [angle: number, au: number, height: number];
    function beltSeeds(count: number, innerAU: number, outerAU: number, offset: number): BeltSeed[] {
      return Array.from({length:count},(_,i)=>[seeded(i+offset)*Math.PI*2,innerAU+seeded(i+offset+30)*(outerAU-innerAU),(seeded(i+offset+60)-.5)]);
    }
    function beltCloud(seeds: BeltSeed[], color: string, size: number) {
      const geometry=new THREE.BufferGeometry();
      const points=new THREE.Points(geometry,new THREE.PointsMaterial({color,size,transparent:true,opacity:.38,depthWrite:false}));
      scene.add(points); return points;
    }
    function setBeltPositions(points: THREE.Points, seeds: BeltSeed[], mode: ScaleMode, thickness: number) {
      const positions=new Float32Array(seeds.length*3);
      seeds.forEach(([angle,au,height],i)=>{const r=distanceScale(au,mode);positions[i*3]=Math.cos(angle)*r;positions[i*3+1]=height*thickness;positions[i*3+2]=Math.sin(angle)*r;});
      points.geometry.dispose(); points.geometry=new THREE.BufferGeometry(); points.geometry.setAttribute("position",new THREE.BufferAttribute(positions,3));
    }
    const asteroidSeeds=beltSeeds(1900,2.1,3.3,70); const kuiperSeeds=beltSeeds(2700,30,50,9000);
    const dustBelt=beltCloud(asteroidSeeds,"#8b7f78",.2); const kuiperBelt=beltCloud(kuiperSeeds,"#6587b8",.28);
    setBeltPositions(dustBelt,asteroidSeeds,"readable",3.4); setBeltPositions(kuiperBelt,kuiperSeeds,"readable",10);

    const regionTargets=new Map<BodyName,THREE.Object3D>();
    function regionTarget(name: BodyName, au: number) { const target=new THREE.Object3D();target.position.set(distanceScale(au,"readable"),0,0);scene.add(target);regionTargets.set(name,target);return target; }
    regionTarget("Asteroid Belt",2.7); regionTarget("Kuiper Belt",40);
    function regionClick(name: BodyName, innerAU: number, outerAU: number) {
      const inner=distanceScale(innerAU,"readable"),outer=distanceScale(outerAU,"readable");
      const mesh=new THREE.Mesh(new THREE.TorusGeometry((inner+outer)/2,(outer-inner)/2,8,180),new THREE.MeshBasicMaterial({transparent:true,opacity:.001,depthWrite:false,side:THREE.DoubleSide}));
      mesh.rotation.x=Math.PI/2;mesh.userData.body=name;scene.add(mesh);return mesh;
    }
    const asteroidClick=regionClick("Asteroid Belt",2.1,3.3); const kuiperClick=regionClick("Kuiper Belt",30,50); const regionClicks=[asteroidClick,kuiperClick];
    function updateRegions(mode: ScaleMode) {
      setBeltPositions(dustBelt,asteroidSeeds,mode,3.4);setBeltPositions(kuiperBelt,kuiperSeeds,mode,10);
      dustBelt.visible=mode!=="true";kuiperBelt.visible=mode!=="true";
      regionTargets.get("Asteroid Belt")!.position.x=distanceScale(2.7,mode);regionTargets.get("Kuiper Belt")!.position.x=distanceScale(40,mode);
      ([[asteroidClick,2.1,3.3],[kuiperClick,30,50]] as const).forEach(([mesh,innerAU,outerAU])=>{const inner=distanceScale(innerAU,mode),outer=distanceScale(outerAU,mode);mesh.geometry.dispose();mesh.geometry=new THREE.TorusGeometry((inner+outer)/2,(outer-inner)/2,8,180);});
    }

    let activeScaleMode:ScaleMode="readable";
    let activeSmallBodyCategory:SmallBodyCategory="off";
    const cometTails=new Map<BodyName,{ion:THREE.Line;dust:THREE.Line}>();
    // Each tail is two vertices, rewritten in place. Building fresh BufferGeometry for every
    // comet on every frame was the playback loop's biggest source of garbage.
    function makeTail(color:string,opacity:number){
      const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.BufferAttribute(new Float32Array(6),3));
      return new THREE.Line(geometry,new THREE.LineBasicMaterial({color,transparent:true,opacity,depthWrite:false,blending:THREE.AdditiveBlending}));
    }
    const tailIon=new THREE.Vector3(),tailDust=new THREE.Vector3(),tailTip=new THREE.Vector3();
    function setTailSegment(line:THREE.Line,from:THREE.Vector3,to:THREE.Vector3){
      const position=line.geometry.getAttribute("position") as THREE.BufferAttribute;
      position.setXYZ(0,from.x,from.y,from.z);position.setXYZ(1,to.x,to.y,to.z);position.needsUpdate=true;
      line.geometry.computeBoundingSphere();
    }
    // `au` is the comet's true heliocentric distance, passed in by the caller that already
    // solved for it — recomputing the Kepler solve here doubled the per-frame cost per comet.
    function updateCometTail(comet:Planet,pos:THREE.Vector3,au:number){
      const tail=cometTails.get(comet.name);if(!tail)return;
      const activity=THREE.MathUtils.clamp((4.2-au)/3.4,0,1);
      const length=(activeScaleMode==="readable"?2.4:1.35)*(0.2+activity*5.2);
      tailIon.copy(pos).normalize();tailDust.copy(tailIon);tailDust.y+=.09;tailDust.normalize();
      setTailSegment(tail.ion,pos,tailTip.copy(pos).addScaledVector(tailIon,length));
      setTailSegment(tail.dust,pos,tailTip.copy(pos).addScaledVector(tailDust,length*.72));
      (tail.ion.material as THREE.LineBasicMaterial).opacity=activity*.68;(tail.dust.material as THREE.LineBasicMaterial).opacity=activity*.34;
    }
    for (const planet of ORBITING_BODIES) {
      const raw = heliocentricVector(planet,activeDate); const pos = transformed(raw, "readable");
      const geometry = new THREE.SphereGeometry(planet.radius, 48, 32);
      if(planet.shape)geometry.scale(...planet.shape);
      const mat = new THREE.MeshStandardMaterial({ map:mappedTexture(planet), color:"#dedbd3", roughness: planet.name === "Earth" ? .9 : .97, metalness: 0, emissive: planet.color, emissiveIntensity: .025 });
      const mesh = new THREE.Mesh(geometry, mat); mesh.position.copy(pos); mesh.rotation.z = planet.name === "Uranus" ? deg(97.8) : planet.name === "Saturn" ? deg(26.7) : deg(planet.name === "Earth" ? 23.4 : 8); mesh.userData.body = planet.name;mesh.visible=!planet.category; planetGroup.add(mesh); bodies.set(planet.name, mesh);
      if (planet.name === "Saturn" || planet.name === "Uranus" || planet.name === "Chariklo") {
        const inner=planet.radius*(planet.name==="Chariklo"?2.42:1.35),outer=planet.radius*(planet.name === "Saturn" ? 2.3 : planet.name==="Chariklo"?2.64:1.72);
        const ringMaterial=planet.name==="Saturn"?new THREE.MeshBasicMaterial({map:saturnRingTexture,color:"#d8d0c2",side:THREE.DoubleSide,transparent:true,opacity:.92,alphaTest:.015,depthWrite:false}):new THREE.MeshBasicMaterial({color:"#80aeb5",side:THREE.DoubleSide,transparent:true,opacity:.22,depthWrite:false});
        const ring = new THREE.Mesh(planet.name==="Saturn"?radialRingGeometry(inner,outer):new THREE.RingGeometry(inner,outer,128),ringMaterial);
        ring.rotation.x = Math.PI/2; ring.userData.body = planet.name; mesh.add(ring);
      }
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map:labelTexture(planet.name,planet.accent),transparent:true,depthTest:false,depthWrite:false})); sprite.position.copy(pos).add(new THREE.Vector3(0,planet.radius+3.2,0)); sprite.scale.set(1,.25,1); sprite.renderOrder=8; sprite.userData.body=planet.name;sprite.visible=!planet.category; planetGroup.add(sprite); labels.push(sprite); labelsByBody.set(planet.name,sprite);
      const pts=orbitVectors(planet,activeDate,planet.category?300:180).map(point=>transformed(point,"readable"));
      const lineMat = new THREE.LineBasicMaterial({color:planet.accent,transparent:true,opacity:.19}); orbitMaterials.push(lineMat);
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), lineMat); line.userData.body=planet.name;line.visible=!planet.category; orbitGroup.add(line); orbitLines.set(planet.name,line);
      if(planet.category==="comet"){const ion=makeTail("#9fe5ff",.5),dust=makeTail("#f0d1a2",.25);ion.userData.body=planet.name;dust.userData.body=planet.name;ion.visible=false;dust.visible=false;scene.add(ion,dust);cometTails.set(planet.name,{ion,dust});updateCometTail(planet,pos,raw.length());}
    }

    const moonObjects=new Map<BodyName,{moon:Planet;mesh:THREE.Mesh;label:THREE.Sprite;orbit:THREE.LineLoop}>();
    const epoch2000=Date.UTC(2000,0,1,12);
    function moonOrbitRadius(moon:Planet,mode:ScaleMode){return mode==="true"?moon.moon!.orbitKm/KM_PER_AU*UNITS_PER_AU:compactMoonOrbitRadius(moon)*(mode==="linear"?.34:1);}
    function moonLocalPosition(moon:Planet,date:Date,mode:ScaleMode){
      const data=moon.moon!,turns=(date.getTime()-epoch2000)/86400000/data.periodDays;const angle=Math.PI*2*(data.phase+(data.retrograde?-turns:turns));const tilt=deg(data.inclination),r=moonOrbitRadius(moon,mode);
      return new THREE.Vector3(Math.cos(angle)*r,Math.sin(angle)*r*Math.sin(tilt),Math.sin(angle)*r*Math.cos(tilt));
    }
    for(const moon of MOONS){
      const parent=bodies.get(moon.moon!.parent)!;const geometry=new THREE.SphereGeometry(moon.radius,28,20);const material=new THREE.MeshStandardMaterial({map:mappedTexture(moon),color:"#d7d5cf",roughness:.98,metalness:0,emissive:moon.color,emissiveIntensity:.018});
      const mesh=new THREE.Mesh(geometry,material);mesh.position.copy(parent.position).add(moonLocalPosition(moon,activeDate,"readable"));mesh.userData.body=moon.name;mesh.visible=false;planetGroup.add(mesh);bodies.set(moon.name,mesh);
      const label=new THREE.Sprite(new THREE.SpriteMaterial({map:labelTexture(moon.name,moon.accent),transparent:true,depthTest:false,depthWrite:false}));label.position.copy(mesh.position).add(new THREE.Vector3(0,moon.radius+1.5,0));label.scale.set(1,.25,1);label.renderOrder=8;label.userData.body=moon.name;label.visible=false;planetGroup.add(label);labels.push(label);labelsByBody.set(moon.name,label);
      const r=compactMoonOrbitRadius(moon),tilt=deg(moon.moon!.inclination),points:Array<THREE.Vector3>=[];for(let i=0;i<100;i++){const angle=i/100*Math.PI*2;points.push(new THREE.Vector3(Math.cos(angle)*r,Math.sin(angle)*r*Math.sin(tilt),Math.sin(angle)*r*Math.cos(tilt)));}
      const orbit=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:moon.accent,transparent:true,opacity:.16}));orbit.position.copy(parent.position);orbit.visible=false;orbit.userData.body=moon.name;orbitGroup.add(orbit);moonObjects.set(moon.name,{moon,mesh,label,orbit});
    }
    function updateMoonPositions(date:Date,mode:ScaleMode){for(const {moon,mesh,label,orbit} of moonObjects.values()){const parent=bodies.get(moon.moon!.parent)!;mesh.position.copy(parent.position).add(moonLocalPosition(moon,date,mode));mesh.scale.setScalar(bodyDisplayScale(moon,mode));label.position.copy(mesh.position);orbit.position.copy(parent.position);orbit.scale.setScalar(moonOrbitRadius(moon,mode)/compactMoonOrbitRadius(moon));}}
    function showMoonFamily(name:BodyName|null){const selectedBody=ALL_BODIES.find(body=>body.name===name),parent=selectedBody?.moon?.parent??name;for(const {moon,mesh,label,orbit} of moonObjects.values()){const visible=moon.moon!.parent===parent;mesh.visible=visible;label.visible=visible;orbit.visible=visible;}}

    function markerTexture(color:string){const canvas=document.createElement("canvas");canvas.width=64;canvas.height=64;const ctx=canvas.getContext("2d")!;ctx.strokeStyle=color;ctx.lineWidth=5;ctx.beginPath();ctx.arc(32,32,18,0,Math.PI*2);ctx.stroke();ctx.fillStyle="#ffffff";ctx.beginPath();ctx.arc(32,32,3,0,Math.PI*2);ctx.fill();return new THREE.CanvasTexture(canvas);}
    const markers=new Map<BodyName,THREE.Sprite>();
    for(const definition of ALL_BODIES){const marker=new THREE.Sprite(new THREE.SpriteMaterial({map:markerTexture(definition.accent),transparent:true,depthTest:false,depthWrite:false,opacity:0}));marker.userData.body=definition.name;marker.renderOrder=9;marker.visible=false;planetGroup.add(marker);markers.set(definition.name,marker);}
    function setSmallBodies(category:SmallBodyCategory){
      activeSmallBodyCategory=category;
      for(const body of SMALL_BODIES){const visible=category!=="off"&&(category==="all"||body.category===category);bodies.get(body.name)!.visible=visible;const label=labelsByBody.get(body.name);if(label)label.visible=visible;const orbit=orbitLines.get(body.name);if(orbit)orbit.visible=visible;const tail=cometTails.get(body.name);if(tail){tail.ion.visible=visible;tail.dust.visible=visible;}}
    }

    const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2();
    const fly = { active:false, start:0, duration:1600, from:new THREE.Vector3(), to:new THREE.Vector3(), targetFrom:new THREE.Vector3(), targetTo:new THREE.Vector3() };
    let lastFocused:BodyName|null="Earth";let viewingFullSystem=false;
    // Ambient mode: the outward auto-tour drives the camera through flyTo and needs to know when
    // each flight lands, so it can speak on arrival. Kept inside the mount-once effect per CLAUDE.md.
    let ambientActive=false; let ambientArrival:(()=>void)|null=null;
    function focus(name: BodyName, close = true) {
      const body = bodies.get(name) ?? regionTargets.get(name); if (!body) return;
      lastFocused=name;viewingFullSystem=false;
      const isRegion=name==="Asteroid Belt"||name==="Kuiper Belt";
      showMoonFamily(isRegion?null:name);
      if(isRegion){setSelected(null);setTourIndex(TOUR.findIndex(stop=>stop.body===name));}else setSelected(name);
      const definition=ALL_BODIES.find(p=>p.name===name),isMoon=Boolean(definition?.moon);
      const displayScale=definition?bodyDisplayScale(definition,activeScaleMode):1;
      const world = new THREE.Vector3(); body.getWorldPosition(world); const radius = (definition?.radius ?? 4)*displayScale;
      fly.active=true; fly.start=performance.now(); fly.duration=ambientActive?4200:(close ? 1700 : 2200); fly.from.copy(camera.position); fly.targetFrom.copy(controls.target); fly.targetTo.copy(world);
      const viewDir = camera.position.clone().sub(controls.target).normalize(); if (viewDir.lengthSq()<.1) viewDir.set(.6,.35,1);
      const regionDistance=name==="Asteroid Belt"?48:name==="Kuiper Belt"?82:0;
      const closeMinimum=activeScaleMode==="true"
        ? (name==="Sun" ? .12 : (isMoon||Boolean(definition?.category) ? .00008 : .0003))
        : isMoon ? (activeScaleMode==="linear"?1.5:2.8) : name==="Sun" ? (activeScaleMode==="linear"?4.5:28) : (activeScaleMode==="linear"?3.2:9);
      const familyRadius=Math.max(0,...MOONS.filter(moon=>moon.moon!.parent===name).map(moon=>moonOrbitRadius(moon,activeScaleMode)));
      const dist = close ? Math.max(radius*(ambientActive?6:4.2),familyRadius*1.45,regionDistance || closeMinimum) : 74; fly.to.copy(world).add(viewDir.multiplyScalar(dist)).add(new THREE.Vector3(0,radius*(ambientActive?.85:.55),0));
      controls.enabled=false;
    }
    function rebuildScale(mode: ScaleMode) {
      activeScaleMode=mode;viewingFullSystem=true;
      sun.scale.setScalar(bodyDisplayScale(PLANETS[0],mode));
      for (const planet of ORBITING_BODIES) {
        const mesh=bodies.get(planet.name)!; const raw=heliocentricVector(planet,activeDate); const pos=transformed(raw,mode); mesh.position.copy(pos);mesh.scale.setScalar(bodyDisplayScale(planet,mode));
        labelsByBody.get(planet.name)?.position.copy(pos);
        const line=orbitLines.get(planet.name)!; const pts=orbitVectors(planet,activeDate,planet.category?300:180).map(point=>transformed(point,mode));
        line.geometry.dispose(); line.geometry=new THREE.BufferGeometry().setFromPoints(pts);
        if(planet.category==="comet")updateCometTail(planet,pos,raw.length());
      }
      updateMoonPositions(activeDate,mode);showMoonFamily(null);setSmallBodies(activeSmallBodyCategory);
      updateRegions(mode);
      controls.minDistance=mode==="true"?.00002:3;controls.maxDistance=mode==="readable"?900:6500;
      if(scene.fog instanceof THREE.FogExp2)scene.fog.density=mode==="true"?.00035:.00135;
      controls.target.set(0,0,0); camera.position.set(0, mode === "readable" ? 115 : 125, mode === "readable" ? 165 : 200); setSelected(null);
    }
    function positionBodies(date:Date,trackFocused=false){
      const tracked=trackFocused&&!viewingFullSystem&&lastFocused?bodies.get(lastFocused)?.position.clone():undefined;
      activeDate=date;
      for(const body of ORBITING_BODIES){
        const mesh=bodies.get(body.name)!;const raw=heliocentricVector(body,activeDate);const pos=transformed(raw,activeScaleMode);mesh.position.copy(pos);
        labelsByBody.get(body.name)?.position.copy(pos);if(body.category==="comet")updateCometTail(body,pos,raw.length());
      }
      updateMoonPositions(activeDate,activeScaleMode);
      if(tracked&&lastFocused){const next=bodies.get(lastFocused)?.position;if(next){const delta=next.clone().sub(tracked);camera.position.add(delta);controls.target.add(delta);if(fly.active){fly.to.add(delta);fly.targetTo.add(delta);}}}
    }
    function updateDate(date:Date){
      positionBodies(date);
      for(const body of ORBITING_BODIES){
        const line=orbitLines.get(body.name)!;const pts=orbitVectors(body,activeDate,body.category?300:180).map(point=>transformed(point,activeScaleMode));
        line.geometry.dispose();line.geometry=new THREE.BufferGeometry().setFromPoints(pts);
      }
      if(!viewingFullSystem&&lastFocused)focus(lastFocused,true);
    }
    apiRef.current={focus,scale:rebuildScale,smallBodies:setSmallBodies,date:updateDate,previewDate:date=>positionBodies(date,true),
      flyTo:(name,onArrive)=>{ambientArrival=onArrive;focus(name,true);},
      setAmbient:(on)=>{ambientActive=on;controls.enabled=!on;if(!on)ambientArrival=null;}};

    const tapStart={x:0,y:0,time:0,moved:false};
    function onPointerDown(e:PointerEvent){tapStart.x=e.clientX;tapStart.y=e.clientY;tapStart.time=performance.now();tapStart.moved=false;}
    function onPointer(e: PointerEvent) {
      if(tapStart.moved||performance.now()-tapStart.time>650)return;
      const rect=renderer.domElement.getBoundingClientRect(); pointer.x=((e.clientX-rect.left)/rect.width)*2-1; pointer.y=-((e.clientY-rect.top)/rect.height)*2+1; raycaster.setFromCamera(pointer,camera);
      const hit=raycaster.intersectObjects([...bodies.values(),...markers.values(),...regionClicks],true)[0]; if(hit){ let obj:THREE.Object3D|null=hit.object; while(obj&&!obj.userData.body)obj=obj.parent; if(obj?.userData.body) focus(obj.userData.body as BodyName); }
    }
    function onMove(e:PointerEvent){if(Math.hypot(e.clientX-tapStart.x,e.clientY-tapStart.y)>8)tapStart.moved=true;if(coarsePointer)return;const rect=renderer.domElement.getBoundingClientRect();pointer.x=((e.clientX-rect.left)/rect.width)*2-1;pointer.y=-((e.clientY-rect.top)/rect.height)*2+1;raycaster.setFromCamera(pointer,camera); renderer.domElement.style.cursor=raycaster.intersectObjects([...bodies.values(),...markers.values(),...regionClicks],true).length?"pointer":"grab"; }
    renderer.domElement.addEventListener("pointerdown",onPointerDown);renderer.domElement.addEventListener("pointerup",onPointer); renderer.domElement.addEventListener("pointermove",onMove);
    let frame=0,lastDistanceLabel="";
    const labelWorldPosition=new THREE.Vector3(),bodyWorldPosition=new THREE.Vector3(),bodyWorldScale=new THREE.Vector3(),cameraScreenUp=new THREE.Vector3();
    function placeLabelsInScreenSpace(){
      const viewportHeight=Math.max(1,renderer.domElement.clientHeight),pixelHeight=coarsePointer?20:22;
      const perspectiveFactor=2*Math.tan(THREE.MathUtils.degToRad(camera.fov*.5))/viewportHeight;
      cameraScreenUp.set(0,1,0).applyQuaternion(camera.quaternion).normalize();
      for(const label of labels){
        if(!label.visible)continue;
        const body=bodies.get(label.userData.body as BodyName);if(!body)continue;
        body.getWorldPosition(bodyWorldPosition);body.getWorldScale(bodyWorldScale);
        const worldPerPixel=Math.max(1e-10,camera.position.distanceTo(bodyWorldPosition)*perspectiveFactor),height=worldPerPixel*pixelHeight;
        if(!body.geometry.boundingSphere)body.geometry.computeBoundingSphere();
        const bodyRadius=(body.geometry.boundingSphere?.radius??0)*Math.max(bodyWorldScale.x,bodyWorldScale.y,bodyWorldScale.z);
        labelWorldPosition.copy(bodyWorldPosition).addScaledVector(cameraScreenUp,bodyRadius+worldPerPixel*(5+pixelHeight*.5));
        label.position.copy(labelWorldPosition);label.parent?.worldToLocal(label.position);label.scale.set(height*4,height,1);
      }
      for(const [name,marker] of markers){
        const body=bodies.get(name);if(activeScaleMode!=="true"||!body?.visible){marker.visible=false;continue;}
        body.getWorldPosition(bodyWorldPosition);body.getWorldScale(bodyWorldScale);if(!body.geometry.boundingSphere)body.geometry.computeBoundingSphere();
        const worldPerPixel=Math.max(1e-10,camera.position.distanceTo(bodyWorldPosition)*perspectiveFactor),bodyRadius=(body.geometry.boundingSphere?.radius??0)*Math.max(bodyWorldScale.x,bodyWorldScale.y,bodyWorldScale.z),pixelRadius=bodyRadius/worldPerPixel;
        const opacity=THREE.MathUtils.clamp((7-pixelRadius)/4,0,1);marker.visible=opacity>.01;(marker.material as THREE.SpriteMaterial).opacity=opacity;marker.position.copy(bodyWorldPosition);marker.parent?.worldToLocal(marker.position);const markerSize=worldPerPixel*14;marker.scale.set(markerSize,markerSize,1);
      }
    }
    function animate(now:number){ frame=requestAnimationFrame(animate); controls.update(); starField.rotation.y+=.000035; dustBelt.rotation.y-=.00018; kuiperBelt.rotation.y-=.000035; sun.rotation.y+=.0012; for(const p of ORBITING_BODIES){ const m=bodies.get(p.name)!; m.rotation.y+=p.name==="Jupiter"?.0022:.001; }for(const moon of MOONS)bodies.get(moon.name)!.rotation.y+=.0015;
      if(fly.active){ const t=Math.min(1,(now-fly.start)/fly.duration); const eased=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2; camera.position.lerpVectors(fly.from,fly.to,eased); controls.target.lerpVectors(fly.targetFrom,fly.targetTo,eased); if(t>=1){fly.active=false;controls.enabled=!ambientActive;const arrived=ambientArrival;ambientArrival=null;arrived?.();} }
      placeLabelsInScreenSpace();const span=camera.position.distanceTo(controls.target),nextDistanceLabel=span<16?"Planetary view":span<55?"Local neighborhood":span<140?"Inner system":span<260?"30 AU span":"Deep system";if(nextDistanceLabel!==lastDistanceLabel){lastDistanceLabel=nextDistanceLabel;setDistanceLabel(nextDistanceLabel);}composer.render(); }
    const loadFallback=window.setTimeout(()=>setReady(true),5000);
    textureManager.onLoad=()=>{window.clearTimeout(loadFallback);setReady(true);};
    animate(performance.now()); const bootstrap=window.setTimeout(() => { focus("Earth");updateDate(activeDate); }, 0);
    function resize(){ const w=mount.clientWidth,h=mount.clientHeight;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);composer.setSize(w,h); }
    const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(mount);window.addEventListener("resize",resize);
    // renderer.dispose() frees programs and render lists but not the buffers and textures
    // the scene owns, and this scene owns a lot of both (~50 canvas textures alone). In
    // production the effect mounts once so nothing noticed; in dev, React StrictMode remounts
    // and every reload leaked a whole scene's worth of GPU memory.
    function disposeScene(){
      scene.traverse(object=>{
        const withGeometry=object as Partial<THREE.Mesh>;
        withGeometry.geometry?.dispose();
        const material=(object as Partial<THREE.Mesh>).material;
        for(const entry of Array.isArray(material)?material:material?[material]:[]){
          for(const value of Object.values(entry))if(value instanceof THREE.Texture)value.dispose();
          entry.dispose();
        }
      });
      scene.clear();
    }
    return()=>{ window.clearTimeout(loadFallback);window.clearTimeout(bootstrap);cancelAnimationFrame(frame);resizeObserver.disconnect();window.removeEventListener("resize",resize);renderer.domElement.removeEventListener("pointerdown",onPointerDown);renderer.domElement.removeEventListener("pointerup",onPointer);renderer.domElement.removeEventListener("pointermove",onMove);controls.dispose();composer.dispose();disposeScene();renderer.dispose();mount.replaceChildren();apiRef.current=null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- must stay [] (mount-once scene, see CLAUDE.md); apiRef is a stable ref CosmicAtlas creates once, ESLint just can't prove that for a prop-supplied ref
  },[]);

  useEffect(()=>{
    if(!isPlaying)return;
    let frame=0,last=performance.now(),lastLabel=0,stopping=false;
    function tick(now:number){
      const elapsed=Math.min((now-last)/1000,.2);last=now;
      const nextTime=simulationDateRef.current.getTime()+elapsed*playbackRate*playbackDirection*86400000;
      const bounded=Math.max(MIN_SIM_TIME,Math.min(MAX_SIM_TIME,nextTime));const nextDate=new Date(bounded);
      simulationDateRef.current=nextDate;apiRef.current?.previewDate(nextDate);
      if(now-lastLabel>100){setMapDate(dateValue(nextDate));lastLabel=now;}
      if(bounded!==nextTime&&!stopping){stopping=true;finishPlayback(nextDate);return;}
      frame=requestAnimationFrame(tick);
    }
    frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- apiRef/finishPlayback are stable by construction; adding them would restart playback on every render
  },[isPlaying,playbackRate,playbackDirection]);

  function choose(name: BodyName) { setTourIndex(null); apiRef.current?.focus(name); }
  function beginTour() { if(isPlaying)finishPlayback();setTourIndex(0); apiRef.current?.focus(TOUR[0].body, false); }
  function changeTour(next:number){ const i=(next+TOUR.length)%TOUR.length;setTourIndex(i);apiRef.current?.focus(TOUR[i].body,true); }
  function toggleScale(){ const next:ScaleMode=scaleMode==="readable"?"linear":scaleMode==="linear"?"true":"readable";setScaleMode(next);apiRef.current?.scale(next); }
  function showSmallBodies(category:SmallBodyCategory){setSmallBodyCategory(category);apiRef.current?.smallBodies(category);if(selectedBody?.category&&(category==="off"||(category!=="all"&&category!==selectedBody.category)))setSelected(null);}
  function toggleSmallBodies(){showSmallBodies(smallBodyCategory==="off"?"all":"off");}
  function changeDate(value:string){
    if(!value)return;
    const bounded=clampDateValue(value);
    setIsPlaying(false);const date=dateForMap(bounded);simulationDateRef.current=date;setMapDate(bounded);apiRef.current?.date(date);
  }
  function resetToday(){changeDate(dateValue(new Date()));}
  function startPlayback(){setTourIndex(null);simulationDateRef.current=selectedDate;setIsPlaying(true);}
  function finishPlayback(date=simulationDateRef.current){
    setIsPlaying(false);const rounded=dateFromValue(dateValue(date));simulationDateRef.current=rounded;setMapDate(dateValue(rounded));apiRef.current?.date(rounded);
  }
  function togglePlayback(){if(isPlaying)finishPlayback();else startPlayback();}
  const selectedMoon=selectedBody?.moon;const moonParent=selectedMoon?PLANETS.find(body=>body.name===selectedMoon.parent):undefined;
  const distanceReference=moonParent??selectedBody;
  const currentDistance = distanceReference && distanceReference.name !== "Sun" ? heliocentricDistanceAU(distanceReference,selectedDate) : 0;
  const lightMinutes = currentDistance * 8.3167;
  const dwarfIndex=selectedBody?DWARFS.indexOf(selectedBody):-1;
  const smallBodyIndex=selectedBody?SMALL_BODIES.indexOf(selectedBody):-1;
  const moonIndex=selectedBody?MOONS.indexOf(selectedBody):-1;const familyMoons=selectedBody?MOONS.filter(moon=>moon.moon!.parent===(selectedMoon?.parent??selectedBody.name)):[];
  const mapDateLabel=selectedDate.toLocaleDateString("en-US",{timeZone:"UTC",month:"short",day:"numeric",year:"numeric"});
  const appearanceLabel=selectedBody?(TEXTURE_MAPS[selectedBody.name]?.label??(selectedMoon?"Procedural color reference · surface detail simplified":selectedBody.category==="comet"?"Nucleus shape simplified · tail is an activity and solar-direction overlay":selectedBody.category?"Measured size and approximate shape · surface detail unresolved":"Color and shape approximation · surface unresolved")):"";
  const visibleSmallBodies=SMALL_BODIES.filter(body=>smallBodyCategory==="all"||body.category===smallBodyCategory);

  return (
    <main className={`atlas-shell ${selectedBody&&tourIndex===null?"panel-open":""} ${tourIndex!==null?"tour-open":""} ${smallBodyCategory!=="off"?"small-bodies-open":""} ${ambient.phase!=="off"?"ambient-mode":""}`}>
      <div ref={mountRef} className="space-stage" aria-label="Interactive 3D model of the solar system">
        <div className="fallback-space" aria-hidden="true">
          <div className="fallback-stars"/>
          <div className="fallback-system">
            {[1,2,3,4,5,6,7,8].map(i=><i key={i} className={`fallback-orbit o${i}`}/>) }
            <b className="fallback-sun"/>
            {PLANETS.slice(1).map((p,i)=><span key={p.name} className={`fallback-planet fp${i+1}`} style={{"--p":p.color} as React.CSSProperties}/>) }
          </div>
          <div className="fallback-message"><span>3D preview unavailable here</span><small>The learning panels and tour remain fully interactive.</small></div>
        </div>
      </div>
      <div className={`loading-veil ${ready ? "is-ready" : ""}`}><div className="loading-orbit"/><span>Plotting the solar system</span></div>

      {ambient.phase==="gate" && <div className="ambient-gate">
        <div className="ambient-gate-inner">
          <strong>HELIOS</strong>
          <p>A quiet tour of the solar system, from the Sun to the far edge — where the planets really are, right now, read aloud.</p>
          <button onClick={ambient.begin}>Begin</button>
          <small>Press Esc to leave at any time.</small>
        </div>
      </div>}

      <header className="topbar">
        <button className="brand" onClick={()=>{setTourIndex(null);apiRef.current?.scale(scaleMode)}} aria-label="Return to full solar system">
          <span className="brand-mark"><i/><i/><b/></span><span><strong>HELIOS</strong><small>Solar system atlas</small></span>
        </button>
        <nav aria-label="Main controls">
          <button className={tourIndex===null?"active":""} onClick={()=>setTourIndex(null)}>Explore</button>
          <button className={tourIndex!==null?"active":""} onClick={beginTour}><span className="play">▶</span> Guided tour</button>
          <button onClick={ambient.enter}>Ambient</button>
        </nav>
        <div className="date-chip">
          <span className={`date-status ${isToday?"live":""} ${isPlaying?"playing":""}`}><i/>{isPlaying?"PLAYING":isToday?"LIVE":"DATE"}</span>
          <input type="date" min={MIN_DATE_VALUE} max={MAX_DATE_VALUE} value={mapDate} disabled={isPlaying} onChange={event=>changeDate(event.target.value)} aria-label="Solar system map date"/>
          {!isToday&&<button onClick={resetToday}>TODAY</button>}
        </div>
      </header>

      <aside className="left-tools">
        <div className="eyebrow">NAVIGATE</div>
        <p><span>Drag</span> to orbit<br/><span>Scroll</span> to travel<br/><span>Click</span> any world</p>
        <div className="zoom-meter"><span/><span/><span/><span/><span/></div>
        <strong>{distanceLabel}</strong>
        <button className="scale-button" onClick={toggleScale}><span>Scale</span><b>{scaleMode === "readable" ? "READABLE" : scaleMode==="linear"?"LINEAR DISTANCE":"TRUE PROPORTIONS"}</b><i>↔</i></button>
        <small className="scale-note">{scaleMode === "readable" ? "Distances are square-root compressed; orbital angles are real." : scaleMode==="linear"?"Distance from the Sun is linear; planet sizes are enlarged.":"Distances and body sizes share one physical scale. Markers and labels are navigation overlays."}</small>
        <button className={`layer-button ${smallBodyCategory!=="off"?"active":""}`} onClick={toggleSmallBodies}><span>Layer</span><b>SMALL BODIES</b><i>{smallBodyCategory==="off"?"OFF":"ON"}</i></button>
      </aside>

      <div className="planet-rail" aria-label="Choose a celestial body">
        {PLANETS.map((p,i)=><button key={p.name} className={selected===p.name?"selected":""} onClick={()=>choose(p.name)} style={{"--planet":p.color} as React.CSSProperties}><span className={`mini-world m${i}`}/><small>{p.name}</small></button>)}
      </div>

      {tourIndex===null&&smallBodyCategory==="off"&&<div className="dwarf-rail" aria-label="Choose a dwarf planet">
        <span>DWARF WORLDS</span>
        {DWARFS.map(p=><button key={p.name} className={selected===p.name?"selected":""} onClick={()=>choose(p.name)} style={{"--planet":p.color} as React.CSSProperties}><i/><small>{p.name}</small></button>)}
      </div>}

      {tourIndex===null&&smallBodyCategory!=="off"&&<div className="small-body-rail" aria-label="Explore comets, asteroids, and distant objects">
        <div className="small-body-filters" aria-label="Filter small bodies">
          {(["all","comet","asteroid","outer"] as const).map(category=><button key={category} className={smallBodyCategory===category?"active":""} onClick={()=>showSmallBodies(category)}>{category==="all"?"ALL":category==="asteroid"?"ROCKS":category.toUpperCase()}</button>)}
        </div>
        <div className="small-body-list">{visibleSmallBodies.map(body=><button key={body.name} className={selected===body.name?"selected":""} onClick={()=>choose(body.name)} style={{"--planet":body.color} as React.CSSProperties}><i/><small>{body.name}</small></button>)}</div>
      </div>}

      {tourIndex===null&&<section className={`playback-bar ${isPlaying?"is-playing":""}`} aria-label="Orbital playback controls">
        <button className="direction-button" onClick={()=>setPlaybackDirection(value=>value===1?-1:1)} aria-label={`Play ${playbackDirection===1?"backward":"forward"} through time`} title="Reverse time direction">{playbackDirection===1?"→":"←"}</button>
        <button className="playback-button" onClick={togglePlayback} aria-label={isPlaying?"Pause orbital playback":"Start orbital playback"}>{isPlaying?"Ⅱ":"▶"}</button>
        <div className="simulation-date"><span>SIMULATION DATE</span><strong>{mapDateLabel}</strong></div>
        <label className="speed-picker"><span>SPEED</span><select value={playbackRate} onChange={event=>setPlaybackRate(Number(event.target.value))} aria-label="Simulation speed">{PLAYBACK_SPEEDS.map(option=><option key={option.days} value={option.days}>{option.label}</option>)}</select></label>
        <button className="now-button" onClick={resetToday}>NOW</button>
      </section>}

      {selectedBody && tourIndex===null && <aside className="info-panel" aria-live="polite">
        <button className="close" onClick={()=>setSelected(null)} aria-label="Close information panel">×</button>
        <div className="panel-index">{moonIndex>=0?`MOON ${String(familyMoons.indexOf(selectedBody)+1).padStart(2,"0")}`:dwarfIndex>=0?`DWARF ${String(dwarfIndex+1).padStart(2,"0")}`:smallBodyIndex>=0?`${selectedBody.category?.toUpperCase()} ${String(smallBodyIndex+1).padStart(2,"0")}`:String(PLANETS.indexOf(selectedBody)).padStart(2,"0")} <span>/ {moonIndex>=0?String(familyMoons.length).padStart(2,"0"):dwarfIndex>=0?"05":smallBodyIndex>=0?String(SMALL_BODIES.length).padStart(2,"0"):"08"}</span></div>
        <div className="eyebrow">{selectedBody.kind}</div>
        <h1>{selectedBody.name}</h1>
        <p className="lede">{selectedBody.description}</p>
        <div className="fact-grid">
          <div><span>{selectedMoon?`DISTANCE FROM ${selectedMoon.parent.toUpperCase()}`:"DISTANCE FROM SUN"}</span><strong>{selectedMoon?`${selectedMoon.orbitKm.toLocaleString()} km`:selectedBody.name === "Sun" ? "The center" : `${currentDistance.toFixed(currentDistance<2?3:2)} AU ${isToday?"now":"on this date"}`}</strong><small>{selectedMoon?"average center-to-center distance":selectedBody.name === "Sun" ? "0 km" : selectedBody.perihelionAU&&selectedBody.aphelionAU?`orbit ${selectedBody.perihelionAU.toLocaleString()}–${selectedBody.aphelionAU.toLocaleString()} AU`:`average ${selectedBody.distanceAU.toLocaleString()} AU`}</small></div>
          <div><span>SUNLIGHT TRAVEL</span><strong>{selectedBody.name === "Sun" ? "Starts here" : lightMinutes < 60 ? `${lightMinutes.toFixed(1)} minutes` : `${(lightMinutes/60).toFixed(1)} hours`}</strong><small>at light speed</small></div>
          <div><span>{selectedMoon?"ONE ORBIT":"ONE YEAR"}</span><strong>{selectedBody.year}</strong></div>
          <div><span>{selectedMoon?"ROTATION":"ONE DAY"}</span><strong>{selectedBody.day}</strong></div>
        </div>
        <div className="wild-fact"><span>✦ WORTH KNOWING</span><p>{selectedBody.fact}</p></div>
        <div className="appearance-note"><span>VISUAL MAP</span><p>{appearanceLabel}</p></div>
        {familyMoons.length>0&&<div className="moon-family"><span>{selectedMoon?`${selectedMoon.parent.toUpperCase()} SYSTEM`:"MAJOR MOONS"} · LOCAL SPACING COMPACTED</span><div>{familyMoons.map(moon=><button key={moon.name} className={selected===moon.name?"selected":""} onClick={()=>choose(moon.name)}>{moon.name}</button>)}</div></div>}
        <div className="diameter"><span>{selectedBody.category?"APPROX. RADIUS":"RADIUS"}</span><b>{selectedBody.radiusKm.toLocaleString()} km</b></div>
      </aside>}

      {tourIndex!==null && <section className="tour-card" aria-live="polite">
        <div className="tour-progress">{TOUR.map((_,i)=><i key={i} className={i<=tourIndex?"done":""}/>)}</div>
        <button className="tour-close" onClick={()=>setTourIndex(null)} aria-label="Exit guided tour">×</button>
        <div className="eyebrow">{TOUR[tourIndex].eyebrow}</div>
        <h2>{TOUR[tourIndex].title}</h2>
        <p>{TOUR[tourIndex].note}</p>
        <div className="tour-actions"><button onClick={()=>changeTour(tourIndex-1)} aria-label="Previous tour stop">←</button><span>{tourIndex+1} / {TOUR.length}</span><button className="next" onClick={()=>changeTour(tourIndex+1)}>{tourIndex===TOUR.length-1?"RESTART":"NEXT"} →</button></div>
      </section>}

      <footer className="footer-note">
        <span>POSITIONS</span> Approximate heliocentric positions for {isToday?"today":mapDateLabel} · computed in-browser from JPL orbital and osculating elements
        <details><summary>Sources</summary><div>{SOURCE_LINKS.map(([label,url])=><a key={url} href={url} target="_blank" rel="noreferrer">{label} ↗</a>)}</div></details>
      </footer>
    </main>
  );
}
