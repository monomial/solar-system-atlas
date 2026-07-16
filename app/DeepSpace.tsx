"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { GALACTIC_REGIONS, NEARBY_GALAXIES } from "./cosmic";
import type { AtlasMode, GalacticRegion, NearbyGalaxy } from "./cosmic";

type DeepMode = Exclude<AtlasMode,"solar">;
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
// Deterministic PRNG so a galaxy's texture is stable across mode switches (Math.random would
// redraw a different galaxy every time you leave and come back, which reads as flicker).
function rng(seed:number){let s=seed>>>0;return()=>{s=s+0x6d2b79f5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function hexRgb(h:string){const n=parseInt(h.slice(1),16);return[n>>16&255,n>>8&255,n&255] as const;}

function labelTexture(name:string,color:string){
  const canvas=document.createElement("canvas");canvas.width=512;canvas.height=112;const context=canvas.getContext("2d")!;
  context.font="600 26px Arial";context.textAlign="center";context.fillStyle="rgba(3,6,14,.82)";context.roundRect(40,24,432,64,12);context.fill();
  context.strokeStyle=color;context.globalAlpha=.5;context.stroke();context.globalAlpha=1;context.fillStyle="#f2f0e9";context.fillText(name.toUpperCase(),256,64);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}

// A soft round particle. Point clouds read as hard confetti squares by default; giving each point
// this radial-alpha sprite as its `map` lets overlapping points melt into a smooth glow instead.
function softDot(inner:string,outer:string){
  const canvas=document.createElement("canvas");canvas.width=canvas.height=64;const g=canvas.getContext("2d")!;
  const grd=g.createRadialGradient(32,32,0,32,32,32);grd.addColorStop(0,inner);grd.addColorStop(1,outer);g.fillStyle=grd;g.fillRect(0,0,64,64);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}

// Paints a galaxy the way NASA's illustrators draw the Milky Way "simulated image" top view:
// a continuous milky disk whose arms are brighter overdensities *within* the glow (never streaks
// over blackness), broken dark dust lanes etched along each arm's inner edge, an elongated cream
// bar with a bright core, pink star-forming knots, and fine one-pixel star grain. Everything is
// stamped from soft brush sprites onto one canvas; because the plane renders additively, dark
// dust paint simply blocks glow — exactly what real dust does. Deterministic per seed.
// The spiral skeleton, shared by the painted texture AND the 3D star cloud — both sample this one
// structure so the volumetric stars land exactly on the painted arms. Two major arms leave the
// bar's tips, two fainter minors sit halfway between (a0 is each arm's TRUE angle at its own start
// radius — the log term is measured from that radius, otherwise the minors inherit the phase
// accumulated over their start offset and swing around to hug the majors, reading as two arms
// splitting rather than four). Each arm gets its own pitch, length, wobble, and noise lanes.
// polar() returns the radius as a fraction of the disk edge, so each consumer scales into its own
// space: texture pixels or world units. Deterministic per seed.
type Arm={a0:number;s:number;sp:number;r1:number;tEnd:number;w1:number;w2:number;n1:(x:number)=>number;n2:(x:number)=>number;nd:(x:number)=>number};
// `rich` is the Milky Way's own anatomy (per the NASA/JPL annotated map): brighter minors and a
// fifth strand — the Outer Arm — sweeping only the rim. Everything downstream (paint, dust, pink
// knots, grain, AND the 3D star cloud) iterates over `arms`, so one entry here lights up everywhere.
function galaxySkeleton(seed:number,spin:number,rich=false){
  const rand=rng(seed);
  const noise1=()=>{const v=Array.from({length:64},()=>rand());return(x:number)=>{const i=Math.floor(x),f=x-i,u=f*f*(3-2*f);return v[i&63]*(1-u)+v[(i+1)&63]*u;};};
  const bar=rand()*Math.PI,start=.304;
  const arms:Arm[]=[0,1,2,3].map(i=>({a0:bar+Math.PI*(i<2?i:i-1.5)+(i<2?0:(rand()-.5)*.3),s:i<2?1:rich?.8:.55,sp:spin*(.96+rand()*.08),r1:i<2?1:rich?1.1+rand()*.15:1.3+rand()*.2,tEnd:.88+rand()*.14,w1:rand()*9,w2:rand()*9,n1:noise1(),n2:noise1(),nd:noise1()}));
  if(rich)arms.push({a0:bar+Math.PI*.75+(rand()-.5)*.4,s:.55,sp:spin*(.96+rand()*.08),r1:2.3,tEnd:.95,w1:rand()*9,w2:rand()*9,n1:noise1(),n2:noise1(),nd:noise1()});
  const polar=(arm:Arm,t:number)=>{const rho=start*arm.r1+(1-start*arm.r1)*t,a=arm.a0+arm.sp*Math.log(rho/(start*arm.r1))+Math.sin(t*5.3+arm.w1)*.05+Math.sin(t*9.1+arm.w2)*.028;return{rho,a};};
  return{rand,bar,arms,polar};
}

// A soft round brush sprite, cached per colour — the unit every painter below stamps with.
function brush(r:number,gr:number,b:number){const c=document.createElement("canvas");c.width=c.height=128;const p=c.getContext("2d")!,grd=p.createRadialGradient(64,64,0,64,64,64);grd.addColorStop(0,`rgba(${r},${gr},${b},1)`);grd.addColorStop(.45,`rgba(${r},${gr},${b},.42)`);grd.addColorStop(1,`rgba(${r},${gr},${b},0)`);p.fillStyle=grd;p.fillRect(0,0,128,128);return c;}

function galaxyDiskTexture({edge,seed,spin=3.2,irregular=false,loose=false,dwarf=false,rich=false,size=1024}:{edge:string;seed:number;spin?:number;irregular?:boolean;loose?:boolean;dwarf?:boolean;rich?:boolean;size?:number}){
  const{rand,bar,arms,polar}=galaxySkeleton(seed,spin,rich);
  // "loose" is the M33 look: all arms comparable, open and flocculent, tiny nucleus, weak dust.
  if(loose)for(const arm of arms)arm.s=Math.max(arm.s,.75);
  const mid=size/2,maxR=size*.46;
  const canvas=document.createElement("canvas");canvas.width=canvas.height=size;const g=canvas.getContext("2d")!;
  const [er,eg,eb]=hexRgb(edge);
  const armPuff=brush(er,eg,eb),creamPuff=brush(255,230,190),dustPuff=brush(24,16,11),pinkPuff=brush(255,148,168);
  const stamp=(img:HTMLCanvasElement,x:number,y:number,s:number,a:number)=>{g.globalAlpha=a;g.drawImage(img,x-s/2,y-s/2,s,s);};
  const along=(arm:Arm,t:number)=>{const{rho,a}=polar(arm,t),r=rho*maxR;return{r,a,x:mid+Math.cos(a)*r,y:mid+Math.sin(a)*r};};
  g.globalCompositeOperation="lighter";
  const disk=g.createRadialGradient(mid,mid,0,mid,mid,maxR);
  disk.addColorStop(0,`rgba(${er},${eg},${eb},${irregular?.2:.15})`);disk.addColorStop(.45,`rgba(${er},${eg},${eb},.09)`);disk.addColorStop(.82,`rgba(${er},${eg},${eb},.04)`);disk.addColorStop(1,`rgba(${er},${eg},${eb},0)`);
  g.fillStyle=disk;g.fillRect(0,0,size,size);
  // Luminous arm bands: overlapping soft brushes whose brightness and width both ride the noise —
  // bright star-forming clumps, dim stretches, wavering edges — plus short "feather" spurs peeling
  // off at a drifting angle. Uniform tubes are the single biggest tell of a fake galaxy.
  if(!irregular)for(const arm of arms){
    // Narrow bands, densely stamped: with the arms wound ~300°, neighbouring wraps sit ~30% apart
    // in radius, so wide soft shoulders would bridge the gap and melt the strands back together.
    for(let t=0;t<=arm.tEnd;t+=1/340){
      const fade=Math.min(1,(arm.tEnd-t)*7),clump=(.3+Math.pow(arm.n1(t*13),1.7)*1.5)*fade;
      const w=size*(.042-.014*t)*(.72+arm.n2(t*8)*.6),{x,y}=along(arm,t);
      stamp(armPuff,x+(rand()-.5)*w*1.3,y+(rand()-.5)*w*1.3,w*2.1,.021*arm.s*clump);
      stamp(armPuff,x+(rand()-.5)*w*.5,y+(rand()-.5)*w*.5,w*1.05,.055*arm.s*clump);
      if(t<.45)stamp(creamPuff,x,y,w*1.8,.015*(1-t*2.2)*arm.s);
    }
    for(let i=0;i<6;i++){
      const t0=.12+rand()*.65,dir=rand()<.5?1:-1,len=.06+rand()*.08;
      for(let u=0;u<=1;u+=.1){const p=along(arm,t0+len*u),drift=dir*u*.16;stamp(armPuff,mid+Math.cos(p.a+drift)*p.r,mid+Math.sin(p.a+drift)*p.r,size*.028*(1-u*.5),.022*(1-u)*arm.s);}
    }
  }
  if(irregular)for(let i=0;i<(dwarf?5:10);i++){const rr=Math.pow(rand(),.7)*maxR*.62,an=rand()*Math.PI*2;stamp(armPuff,mid+Math.cos(an)*rr,mid+Math.sin(an)*rr,size*(.16+rand()*.22),dwarf?.06:.09);}
  if(rich){
    // The Near and Far 3kpc Arms: tight cream arcs hugging the bar's two ends…
    for(const tip of[0,Math.PI])for(let u=0;u<=1;u+=1/70){
      const a=bar+tip+u*1.6,r=maxR*.304*(1.04+u*.12);
      stamp(creamPuff,mid+Math.cos(a)*r,mid+Math.sin(a)*r,size*.02,.05*(1-u*.4));
    }
    // …and the Orion Spur, the short bridge between arms that our Sun actually lives on.
    const arm=arms[2];
    for(let u=0;u<=1;u+=.08){
      const p=along(arm,.4+.11*u),drift=.2*u;
      stamp(armPuff,mid+Math.cos(p.a+drift)*p.r,mid+Math.sin(p.a+drift)*p.r,size*.03*(1-u*.4),.05*(1-u*.5));
    }
  }
  // Dust: ragged strands hugging each arm's inner (concave) edge. Noise-gated *segments* — dust
  // appears in continuous stretches then breaks — never per-stamp coin flips, which produce the
  // evenly-beaded polka-dot chains that scream "drawn by a computer".
  g.globalCompositeOperation="source-over";
  if(!irregular)for(const arm of arms)for(let t=.06;t<=arm.tEnd;t+=1/620){
    const gate=arm.nd(t*24);if(gate<.42)continue;
    const{r,x,y}=along(arm,t),k=1-size*(.012+.008*arm.n2(t*15))/r,j=(arm.n1(t*33)-.5)*size*.007;
    // The last factor ties dust to the band's own clump noise (same n1 lane, same frequency as the
    // brightness pass): dust only shows where there is glow behind it to block, so a dimming arm
    // never leaves a bare dark scratch floating over the faint inter-arm disk.
    stamp(dustPuff,mid+(x-mid)*k+j,mid+(y-mid)*k+j,size*(.003+arm.n2(t*41)*.004),(.14-.07*t)*(loose?.5:1)*arm.s*(.3+gate*.7)*(.3+.7*arm.n1(t*13)));
  }
  // Cirrus mottling over the whole disk — faint dark wisps, then faint bright patches — so the
  // underlying gradients stop reading as smooth airbrush. Kept whisper-quiet: strong dark blobs
  // punch "holes" in the disk and read as blotches.
  for(let i=0;i<300;i++){const rr=maxR*(.15+Math.pow(rand(),.7)*.85),an=rand()*Math.PI*2;stamp(dustPuff,mid+Math.cos(an)*rr,mid+Math.sin(an)*rr,size*(.012+rand()*.022),.02+rand()*.03);}
  g.globalCompositeOperation="lighter";
  for(let i=0;i<240;i++){const rr=maxR*Math.pow(rand(),.6),an=rand()*Math.PI*2;stamp(armPuff,mid+Math.cos(an)*rr,mid+Math.sin(an)*rr,size*(.015+rand()*.03),.02+rand()*.025);}
  g.globalCompositeOperation="lighter";g.globalAlpha=1;// stamp() leaves globalAlpha at its last brush
  // The bar: an elongated cream gradient. Loose spirals get a small round nucleus instead, and
  // Magellanic-type irregulars get a stubby bar shoved off-centre — which is literally the LMC.
  const ox=irregular&&!dwarf?(rand()-.5)*size*.15:0,oy=irregular&&!dwarf?(rand()-.5)*size*.15:0;
  g.save();g.translate(mid+ox,mid+oy);g.rotate(bar);g.scale(1,irregular?(dwarf?.78:.6):loose?.72:.36);
  const bulge=g.createRadialGradient(0,0,0,0,0,size*(irregular?(dwarf?.17:.23):loose?.11:.2));
  bulge.addColorStop(0,"rgba(255,236,190,.78)");bulge.addColorStop(.45,"rgba(255,222,160,.45)");bulge.addColorStop(.75,"rgba(255,210,150,.16)");bulge.addColorStop(1,"rgba(255,205,150,0)");
  g.fillStyle=bulge;g.fillRect(-size,-size,size*2,size*2);g.restore();
  if(!irregular){
    const core=g.createRadialGradient(mid,mid,0,mid,mid,size*(loose?.022:.04));
    core.addColorStop(0,`rgba(255,248,228,${loose?.55:.7})`);core.addColorStop(1,"rgba(255,230,185,0)");
    g.fillStyle=core;g.fillRect(0,0,size,size);
  }
  // Pink star-forming complexes on the arms (scattered, for irregulars): each is a dim halo with
  // a few small bright cores, not one flat uniform dot. Magellanic irregulars also get one giant
  // complex — the LMC's Tarantula Nebula is bright enough to dominate photos of the whole galaxy.
  if(irregular&&!dwarf){
    const an=rand()*Math.PI*2,rr=maxR*(.35+rand()*.25),x=mid+Math.cos(an)*rr,y=mid+Math.sin(an)*rr;
    stamp(pinkPuff,x,y,size*.05,.3);for(let j=0;j<5;j++)stamp(pinkPuff,x+(rand()-.5)*size*.03,y+(rand()-.5)*size*.03,size*(.004+rand()*.005),.6);
  }
  for(let i=0;i<(irregular?(dwarf?2:7):26);i++){
    let x:number,y:number,s=1;
    if(irregular){const rr=Math.pow(rand(),.6)*maxR*.7,an=rand()*Math.PI*2;x=mid+Math.cos(an)*rr;y=mid+Math.sin(an)*rr;}
    else{const arm=arms[i%arms.length],p=along(arm,.15+rand()*.75);if(rand()>arm.s)continue;s=arm.s;x=p.x+(rand()-.5)*size*.014;y=p.y+(rand()-.5)*size*.014;}
    stamp(pinkPuff,x,y,size*(.008+rand()*.008),.22*s);
    for(let j=0;j<3;j++)stamp(pinkPuff,x+(rand()-.5)*size*.01,y+(rand()-.5)*size*.01,size*(.0025+rand()*.003),.55*s);
  }
  // Fine star grain: mostly clustered on the arms, the rest a thin disk-wide field. The second,
  // sparser pass is bright pixel "resolved stars" — without them everything is soft brushwork and
  // the whole disk reads as airbrushed fog.
  g.globalAlpha=1;
  const grains=size*(irregular?9:26);
  for(let i=0;i<grains;i++){
    let x:number,y:number,r:number;
    if(!irregular&&rand()<.6){const arm=arms[(rand()*arms.length)|0];if(rand()>arm.s)continue;const p=along(arm,Math.pow(rand(),.9)),w=size*.03;r=p.r;x=p.x+(rand()+rand()-1)*w;y=p.y+(rand()+rand()-1)*w;}
    else{r=Math.pow(rand(),.62)*maxR;if(rand()<Math.pow(r/maxR,1.6))continue;const an=rand()*Math.PI*2;x=mid+Math.cos(an)*r;y=mid+Math.sin(an)*r;}
    const spark=rand()<.08,a=(spark?.25+rand()*.4:.06+rand()*.13).toFixed(3);
    g.fillStyle=spark?`rgba(255,255,255,${a})`:1-r/(size*.2)>rand()?`rgba(255,228,190,${a})`:`rgba(214,224,255,${a})`;
    g.fillRect(x,y,spark?1.4:1+rand(),spark?1.4:1+rand());
  }
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=16;return texture;
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

function milkyWay(scene:THREE.Scene){
  // The luminous disk itself is a single additive plane carrying the drawn spiral; the point cloud
  // below only adds grain and a bit of vertical thickness so the edge-on view still reads as a band.
  // The galaxy has real volume, built from two systems that share one skeleton:
  // (1) the painted disk stacked as translucent slices through the disk's thickness — one plane is
  // a picture, a gaussian-weighted stack is a glowing slab whose layers parallax as you orbit;
  // (2) a 3D star cloud sampled from the SAME arm skeleton, so its stars clump exactly where the
  // painted arms are bright: a flared thin disk of arm stars, a thicker old-star field, a triaxial
  // bulge aligned with the painted bar, and a sparse spherical halo.
  // SPIN 4.6 winds the arms ~300° (a ~12° pitch — the NASA/JPL map's Scutum-Centaurus wraps the
  // whole disk), which is what makes the disk read as many nested strands instead of four spokes.
  const SEED=7,SPIN=4.6,R=56;
  // The disk is not flat. SDSS and Gaia show the Milky Way is CORRUGATED — concentric vertical
  // ripples that grow toward the rim (the Monoceros and TriAndromeda rings are crests of that
  // pattern) — and the outer disk carries an integral-sign warp, up on one side, down on the
  // other. One displacement function drives both the slice geometry and the star cloud, so the
  // painted glow and the stars undulate together instead of ending in a dead-flat plane.
  const ripple=(r:number,theta:number)=>{const f=r/R;return Math.sin(r*.42+1.3)*(.1+f*f*1.1)+f*f*f*2.4*Math.sin(theta-1.1);};
  const texture=galaxyDiskTexture({edge:"#a9c6ff",seed:SEED,spin:SPIN,rich:true,size:2048});
  // Kept tight (±1.4) with a dominant center slice: spreading the stack wider adds thickness but
  // smears the projected arm detail in tilted views — the outer slices should whisper, not talk.
  const sliceGeometry=new THREE.PlaneGeometry(122,122,96,96);
  {const pos=sliceGeometry.attributes.position;
  // plane local (x,y) lands at world (x,-y) after the -π/2 tilt, so the local-z displacement
  // becomes world height — the same frame the star cloud's ripple uses.
  for(let i=0;i<pos.count;i++){const x=pos.getX(i),y=pos.getY(i),r=Math.hypot(x,y);pos.setZ(i,ripple(r,Math.atan2(-y,x)));}}
  // Three slices, not five: every off-plane copy projects shifted in a tilted view, and stacking
  // five of them reads as motion blur. Two dim outriggers give the thickness; the center carries
  // the detail.
  for(const h of[-1.1,0,1.1]){
    const slice=new THREE.Mesh(sliceGeometry,new THREE.MeshBasicMaterial({map:texture,transparent:true,opacity:h===0?.5:.2,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}));
    slice.rotation.x=-Math.PI/2;slice.position.y=h;scene.add(slice);
  }
  const sk=galaxySkeleton(SEED,SPIN,true),rand=sk.rand,gauss=()=>(rand()+rand()+rand()+rand()-2)*.85;
  const armN=14000,fieldN=7000,bulgeN=4200,haloN=800,total=armN+fieldN+bulgeN+haloN;
  const positions=new Float32Array(total*3),colors=new Float32Array(total*3),color=new THREE.Color();
  let p=0;const put=(x:number,y:number,z:number,c:string,f:number)=>{positions[p*3]=x;positions[p*3+1]=y;positions[p*3+2]=z;color.set(c);colors[p*3]=color.r*f;colors[p*3+1]=color.g*f;colors[p*3+2]=color.b*f;p++;};
  for(let i=0;i<armN;i++){
    const arm=sk.arms[(rand()*sk.arms.length)|0],t=Math.pow(rand(),.9)*arm.tEnd,{rho,a}=sk.polar(arm,t);
    const clump=.3+Math.pow(arm.n1(t*13),1.7)*1.5,w=(.05-.016*t)*(.72+arm.n2(t*8)*.6)*2*R,r=rho*R;
    // young population: hugs the (corrugated) plane, flares slightly outward, pink where born
    put(Math.cos(a)*r+gauss()*w*.45,ripple(r,a)+gauss()*(.35+r/R*.55),Math.sin(a)*r+gauss()*w*.45,rand()<.03?"#ff9bb4":rand()<.12?"#cfe0ff":"#e8eeff",(.22+.45*rand())*clump*arm.s);
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
  const points=new THREE.Points(geometry,new THREE.PointsMaterial({size:.5,map:softDot("rgba(255,255,255,.85)","rgba(255,255,255,0)"),transparent:true,opacity:.36,vertexColors:true,depthWrite:false,blending:THREE.AdditiveBlending}));scene.add(points);
  // The same stars again as small bright cores (shared geometry, so it costs nothing): the soft
  // halo layer alone reads as fog — the pinpoint pass is what makes them read as stars.
  const cores=new THREE.Points(geometry,new THREE.PointsMaterial({size:.18,map:softDot("rgba(255,255,255,1)","rgba(255,255,255,0)"),transparent:true,opacity:.6,vertexColors:true,depthWrite:false,blending:THREE.AdditiveBlending}));scene.add(cores);
  // Small hot nucleus only — the bulge's body now comes from the 3D cloud, not a flat ball of light.
  const nucleus=new THREE.Sprite(new THREE.SpriteMaterial({map:softDot("rgba(255,242,210,.9)","rgba(255,200,130,0)"),transparent:true,opacity:.5,depthWrite:false,blending:THREE.AdditiveBlending}));nucleus.scale.set(7,7,1);scene.add(nucleus);
  return points;
}

// Andromeda gets its own painter, because M31's appearance is *known*, and it is not a generic
// open spiral: a huge soft warm bulge that dominates the light, dust lanes wound so tightly they
// read as nested rings, and a blue star-forming outer ring. Painted face-on — the heavy ~75°
// inclination that makes the photographs unmistakable comes from the plane's tilt in the scene.
function andromedaTexture(seed:number,size=1024){
  const rand=rng(seed),mid=size/2,maxR=size*.47;
  const canvas=document.createElement("canvas");canvas.width=canvas.height=size;const g=canvas.getContext("2d")!;
  const blue=brush(150,180,235),dust=brush(26,17,12),pink=brush(255,150,170);
  const stamp=(img:HTMLCanvasElement,x:number,y:number,s:number,a:number)=>{g.globalAlpha=a;g.drawImage(img,x-s/2,y-s/2,s,s);};
  const noise=()=>{const v=Array.from({length:64},()=>rand());return(x:number)=>{const i=Math.floor(x),f=x-i,u=f*f*(3-2*f);return v[i&63]*(1-u)+v[(i+1)&63]*u;};};
  g.globalCompositeOperation="lighter";
  let grad=g.createRadialGradient(mid,mid,0,mid,mid,maxR);
  grad.addColorStop(0,"rgba(255,226,180,.34)");grad.addColorStop(.45,"rgba(238,214,180,.16)");grad.addColorStop(.75,"rgba(170,185,225,.07)");grad.addColorStop(1,"rgba(150,170,220,0)");
  g.fillStyle=grad;g.fillRect(0,0,size,size);
  grad=g.createRadialGradient(mid,mid,0,mid,mid,size*.2);
  grad.addColorStop(0,"rgba(255,246,225,.95)");grad.addColorStop(.35,"rgba(255,228,178,.55)");grad.addColorStop(1,"rgba(255,214,160,0)");
  g.fillStyle=grad;g.fillRect(0,0,size,size);
  // nested dust bands — M31's lanes circle the disk rather than opening into arms. Each band is
  // stamps scattered radially across a width, so it reads as braided diffuse dust, not a drawn
  // contour line.
  g.globalCompositeOperation="source-over";
  for(const[rho,str]of[[.5,.9],[.68,1],[.85,.55]] as const){
    const n=noise(),n2=noise(),phase=rand()*9;
    for(let th=0;th<Math.PI*2;th+=Math.PI/420){
      const gate=n(th*3+phase);if(gate<.25)continue;
      const r=maxR*rho*(1+(n2(th*4)-.5)*.05)+(rand()+rand()-1)*size*.012;
      stamp(dust,mid+Math.cos(th)*r,mid+Math.sin(th)*r,size*(.008+rand()*.012),.09*str*(.3+gate*.7));
    }
  }
  g.globalCompositeOperation="lighter";
  // the blue outer star-forming ring, studded with pink knots
  {const n=noise(),phase=rand()*9;
  for(let th=0;th<Math.PI*2;th+=Math.PI/300){
    const r=maxR*.8*(1+(n(th*4+phase)-.5)*.05);
    stamp(blue,mid+Math.cos(th)*r,mid+Math.sin(th)*r,size*(.02+n(th*9)*.02),.05+.05*n(th*4+phase));
    if(rand()<.06)stamp(pink,mid+Math.cos(th)*r+(rand()-.5)*size*.01,mid+Math.sin(th)*r+(rand()-.5)*size*.01,size*(.003+rand()*.004),.5);
  }}
  // grain: warm toward the bulge, cool in the outskirts
  g.globalAlpha=1;
  for(let i=0;i<size*14;i++){
    const rr=Math.pow(rand(),.6);if(rand()<Math.pow(rr,2.2))continue;
    const r=rr*maxR,th=rand()*Math.PI*2,a=(.04+rand()*.09).toFixed(3);
    g.fillStyle=rr<.45?`rgba(255,225,185,${a})`:`rgba(200,212,245,${a})`;
    g.fillRect(mid+Math.cos(th)*r,mid+Math.sin(th)*r,1+rand(),1+rand());
  }
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=16;return texture;
}

// One Local Group galaxy, drawn as what it actually is: Andromeda by its dedicated painter, the
// Milky Way with the SAME seed as the galaxy-scale view (one object, one look at both scales),
// M33 as a loose flocculent spiral, the Magellanics and dwarfs as irregular smudges. Spirals get
// three thin texture layers for a hint of volume; each sits at its real published inclination.
function buildGalaxy(scene:THREE.Object3D,galaxy:NearbyGalaxy,position:THREE.Vector3){
  const [r,g,b]=hexRgb(galaxy.color),home=galaxy.distanceMly===0,v=galaxy.variant;
  const seed=Math.round(galaxy.angle*97+galaxy.visualSize*29)+3;
  const texture=v==="andromeda"?andromedaTexture(31,1024)
    :v==="milkyway"?galaxyDiskTexture({edge:"#a9c6ff",seed:7,spin:4.6,rich:true,size:1024})
    :v==="triangulum"?galaxyDiskTexture({edge:galaxy.color,seed,spin:2.1,loose:true,size:1024})
    :galaxyDiskTexture({edge:galaxy.color,seed,irregular:true,dwarf:v==="dwarf",size:512});
  const D=galaxy.visualSize*3.2,group=new THREE.Group();
  // Orient relative to the VIEW direction, not world axes: both the default camera and the fly-to
  // camera look along ~(0,.55,.83), so composing "face the viewer, spin to a position angle, then
  // incline by tilt" makes each galaxy show its real published inclination on screen — Andromeda
  // reads as the famous 75° ellipse instead of whatever the world-space euler happened to produce.
  const qa=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),new THREE.Vector3(0,.5547,.8321));
  const qpa=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),galaxy.angle*1.3);
  const qt=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),galaxy.tilt);
  group.position.copy(position);group.quaternion.copy(qa).multiply(qpa).multiply(qt);scene.add(group);
  const disk=new THREE.Mesh(new THREE.PlaneGeometry(D,D),new THREE.MeshBasicMaterial({map:texture,transparent:true,opacity:home?.95:.8,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}));
  group.add(disk);
  const glow=v==="andromeda"?"255,232,195":`${r},${g},${b}`;
  const core=new THREE.Sprite(new THREE.SpriteMaterial({map:softDot(`rgba(${glow},.55)`,`rgba(${glow},0)`),transparent:true,opacity:v==="andromeda"?.5:home?.5:.4,depthWrite:false,blending:THREE.AdditiveBlending}));
  core.position.copy(position);core.scale.setScalar(galaxy.visualSize*(v==="andromeda"?1.15:1.4));scene.add(core);
}

function localPosition(galaxy:NearbyGalaxy){
  // Galaxy sizes are enlarged for visibility, so true scaled distance would drop the Magellanic
  // satellites *inside* the Milky Way's drawn disk — keep everything outside it, or flying to the
  // LMC lands you in a wash of the Milky Way's own glow.
  const radius=galaxy.distanceMly===0?0:Math.max(galaxy.distanceMly*15,(5.4+galaxy.visualSize)*1.8);
  return new THREE.Vector3(Math.cos(galaxy.angle)*radius,galaxy.height,Math.sin(galaxy.angle)*radius);
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
    renderer.setSize(mount.clientWidth,mount.clientHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.65));renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.92;mount.appendChild(renderer.domElement);
    // Gentle bloom: a high threshold so only the very brightest cores glow, low strength so galaxies
    // keep their structure instead of melting into white discs.
    const composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));composer.addPass(new UnrealBloomPass(new THREE.Vector2(mount.clientWidth,mount.clientHeight),.45,.5,.88));
    const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.045;controls.enablePan=false;controls.minDistance=6;controls.maxDistance=mode==="galaxy"?170:190;controls.target.set(0,0,0);
    const stars=starfield(scene,4200,mode==="galaxy"?380:500),labels:THREE.Sprite[]=[];const targets:THREE.Object3D[]=[];const positions=new Map<string,THREE.Vector3>();
    if(mode==="galaxy"){
      milkyWay(scene);
      for(const region of GALACTIC_REGIONS){
        const position=new THREE.Vector3(...region.position);positions.set(region.id,position);
        const marker=new THREE.Mesh(new THREE.SphereGeometry(region.id==="solar-system"?.72:.48,20,20),new THREE.MeshBasicMaterial({color:region.color}));marker.position.copy(position);marker.userData.id=region.id;scene.add(marker);targets.push(marker);
        const ring=new THREE.Mesh(new THREE.RingGeometry(region.id==="solar-system"?1.05:.72,region.id==="solar-system"?1.18:.82,48),new THREE.MeshBasicMaterial({color:region.color,transparent:true,opacity:.8,side:THREE.DoubleSide,depthWrite:false}));ring.rotation.x=-Math.PI/2;marker.add(ring);
        const label=new THREE.Sprite(new THREE.SpriteMaterial({map:labelTexture(region.name,region.color),transparent:true,depthWrite:false}));label.position.copy(position).add(new THREE.Vector3(0,2.2,0));label.scale.set(12,2.6,1);scene.add(label);labels.push(label);
      }
    }else{
      for(const galaxy of NEARBY_GALAXIES){
        const position=localPosition(galaxy);positions.set(galaxy.id,position);buildGalaxy(scene,galaxy,position);
        const marker=new THREE.Mesh(new THREE.SphereGeometry(Math.max(1.2,galaxy.visualSize*.55),20,20),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));marker.position.copy(position);marker.userData.id=galaxy.id;scene.add(marker);targets.push(marker);
        const label=new THREE.Sprite(new THREE.SpriteMaterial({map:labelTexture(galaxy.name,galaxy.color),transparent:true,depthWrite:false}));label.position.copy(position).add(new THREE.Vector3(0,galaxy.visualSize+2,0));label.scale.set(13,2.8,1);scene.add(label);labels.push(label);
      }
      const radius=46;const boundary=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({length:180},(_,index)=>new THREE.Vector3(Math.cos(index/180*Math.PI*2)*radius,0,Math.sin(index/180*Math.PI*2)*radius))),new THREE.LineBasicMaterial({color:"#7485aa",transparent:true,opacity:.17}));scene.add(boundary);
    }
    let fly:{start:number;from:THREE.Vector3;to:THREE.Vector3;targetFrom:THREE.Vector3;targetTo:THREE.Vector3}|null=null;
    function focus(id:string){const target=positions.get(id);if(!target)return;setSelected(id);const vs=mode==="local"?NEARBY_GALAXIES.find(galaxy=>galaxy.id===id)?.visualSize??3:0;const offset=mode==="galaxy"?new THREE.Vector3(0,14,18):new THREE.Vector3(0,12,18).multiplyScalar(Math.min(2.1,Math.max(.85,vs/3)));fly={start:performance.now(),from:camera.position.clone(),to:target.clone().add(offset),targetFrom:controls.target.clone(),targetTo:target.clone()};}
    function changeView(next:ViewMode){setViewMode(next);const to=next==="top"?new THREE.Vector3(0,mode==="galaxy"?105:115,.01):next==="edge"?new THREE.Vector3(0,3,mode==="galaxy"?110:125):new THREE.Vector3(0,mode==="galaxy"?58:64,mode==="galaxy"?78:92);fly={start:performance.now(),from:camera.position.clone(),to,targetFrom:controls.target.clone(),targetTo:new THREE.Vector3()};}
    apiRef.current={focus,view:changeView};
    const down=new THREE.Vector2();let frame=0;const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
    function pointerDown(event:PointerEvent){down.set(event.clientX,event.clientY);}
    function pointerUp(event:PointerEvent){if(down.distanceTo(new THREE.Vector2(event.clientX,event.clientY))>7)return;const rect=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-((event.clientY-rect.top)/rect.height)*2+1);raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects(targets,false)[0];if(hit)focus(hit.object.userData.id);}
    renderer.domElement.addEventListener("pointerdown",pointerDown);renderer.domElement.addEventListener("pointerup",pointerUp);
    function animate(now:number){frame=requestAnimationFrame(animate);controls.update();stars.rotation.y+=.000018;if(fly){const t=Math.min(1,(now-fly.start)/1100),ease=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;camera.position.lerpVectors(fly.from,fly.to,ease);controls.target.lerpVectors(fly.targetFrom,fly.targetTo,ease);if(t>=1)fly=null;}for(const label of labels)label.quaternion.copy(camera.quaternion);composer.render();}
    animate(performance.now());const readyTimer=window.setTimeout(()=>setReady(true),80);
    function resize(){const width=renderer.domElement.parentElement?.clientWidth??1,height=renderer.domElement.parentElement?.clientHeight??1;camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setSize(width,height);composer.setSize(width,height);}
    const observer=new ResizeObserver(resize);observer.observe(mount);
    return()=>{window.clearTimeout(readyTimer);cancelAnimationFrame(frame);observer.disconnect();renderer.domElement.removeEventListener("pointerdown",pointerDown);renderer.domElement.removeEventListener("pointerup",pointerUp);controls.dispose();composer.dispose();scene.traverse(object=>{(object as THREE.Mesh).geometry?.dispose();const material=(object as THREE.Mesh).material;for(const entry of Array.isArray(material)?material:material?[material]:[]){for(const value of Object.values(entry))if(value instanceof THREE.Texture)value.dispose();entry.dispose();}});scene.clear();renderer.dispose();mount.replaceChildren();apiRef.current=null;};
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
