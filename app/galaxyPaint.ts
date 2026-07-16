// The galaxy painting layer: everything that turns a seed into pixels, with no Three.js and no
// hard DOM dependency — the same discipline as orbits.ts, and for the same reason. The web scene
// wraps these canvases in THREE.CanvasTexture at runtime; scripts/bake-galaxy-maps.mjs runs this
// exact code under node (via --experimental-strip-types) with @napi-rs/canvas injected, so the
// PNGs bundled into the tvOS app are painted by the very same brush strokes the web uses. One
// painter, two renderers, zero drift.
//
// DOM access is confined to the default canvas factory: pass `create` and this module never
// touches `document`.

export type CanvasFactory = (width: number, height: number) => HTMLCanvasElement;
const domCanvas: CanvasFactory = (width, height) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

// Deterministic PRNG so a galaxy's texture is stable across mode switches (Math.random would
// redraw a different galaxy every time you leave and come back, which reads as flicker).
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = s + 0x6d2b79f5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function hexRgb(h: string) {
  const n = parseInt(h.slice(1), 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255] as const;
}

// The spiral skeleton, shared by the painted texture AND the web's 3D star cloud — both sample
// this one structure so the volumetric stars land exactly on the painted arms. Generic galaxies
// get two major arms leaving the bar's tips and two fainter minors halfway between (a0 is each
// arm's TRUE angle at its own start radius — the log term is measured from that radius, otherwise
// the minors inherit the phase accumulated over their start offset and swing around to hug the
// majors). Each arm gets its own pitch, length, wobble, and noise lanes. polar() returns the
// radius as a fraction of the disk edge, so each consumer scales into its own space: texture
// pixels or world units. Deterministic per seed.
export type Arm={name?:string;a0:number;s:number;sp:number;r1:number;tEnd:number;wf:number;soft:boolean;w1:number;w2:number;n1:(x:number)=>number;n2:(x:number)=>number;nd:(x:number)=>number};
const DEG=Math.PI/180;
export const ARM_START=.304;
// One Milky Way everywhere: the seed/spin pair the galaxy scale, the Local Group thumbnail, and
// the baked tvOS maps all share.
export const MILKY_WAY_SEED=7,MILKY_WAY_SPIN=4.6;
// `rich` is the Milky Way itself, arm by arm from the NASA/JPL annotated map (Hurt). One world
// unit is 1,000 light-years (tests/cosmic.test.mjs pins this): the Sun sits at azimuth 90°
// (screen bottom in the default view) at radius 26 units = the documented 26,000 ly, which is
// rho 26/56 ≈ .464 of the drawn disk. Galactic longitude 0° points up at the centre; the bar is
// tilted 28° past the Sun–centre line (near tip lower-left = the Long Bar, far tip upper-right).
// Scutum–Centaurus and Perseus are the two majors leaving the bar tips; Sagittarius and Norma
// root near the ends of the Near/Far 3kpc arms; the Outer Arm continues Norma's spiral around
// the rim beyond Perseus; the Orion Spur is the short, steeper bridge the Sun actually sits on
// (it passes exactly through rho .464 at 90°).
// Columns: name, a0° at start radius, start rho, end rho, strength, pitch factor, width, soft root
// (soft arms fade in — they emerge from the disk, not from the bar). Everything downstream (paint,
// dust, pink knots, grain, AND the web's 3D star cloud) iterates over `arms`, so each row lights
// up everywhere, and the labeled GALACTIC_REGIONS markers in cosmic.ts are placed on these curves.
export const MILKY_WAY_ARMS:[string,number,number,number,number,number,number,boolean][]=[
  ["Scutum–Centaurus",118,.304,.97,1,1,1,false],
  ["Perseus",298,.304,.92,1,1,1,false],
  ["Sagittarius",25,.32,.78,.75,1,.85,true],
  ["Norma",310,.25,.38,.7,1,.8,true],
  ["Outer",30,.6,.98,.6,1,.9,true],
  ["Orion Spur",60,.366,.52,.5,.48,.55,true],
];
export function galaxySkeleton(seed:number,spin:number,rich=false){
  const rand=rng(seed);
  const noise1=()=>{const v=Array.from({length:64},()=>rand());return(x:number)=>{const i=Math.floor(x),f=x-i,u=f*f*(3-2*f);return v[i&63]*(1-u)+v[(i+1)&63]*u;};};
  const start=ARM_START,lanes=()=>({w1:rand()*9,w2:rand()*9,n1:noise1(),n2:noise1(),nd:noise1()});
  const bar=rich?118*DEG:rand()*Math.PI;
  const arms:Arm[]=rich
    ?MILKY_WAY_ARMS.map(([name,a0,r0,r9,s,pf,wf,soft])=>({name,a0:a0*DEG,s,sp:spin*pf,r1:r0/start,tEnd:(r9-r0)/(1-r0),wf,soft,...lanes()}))
    :[0,1,2,3].map(i=>({a0:bar+Math.PI*(i<2?i:i-1.5)+(i<2?0:(rand()-.5)*.3),s:i<2?1:.55,sp:spin*(.96+rand()*.08),r1:i<2?1:1.3+rand()*.2,tEnd:.88+rand()*.14,wf:1,soft:false,...lanes()}));
  const polar=(arm:Arm,t:number)=>{const rho=start*arm.r1+(1-start*arm.r1)*t,a=arm.a0+arm.sp*Math.log(rho/(start*arm.r1))+Math.sin(t*5.3+arm.w1)*.05+Math.sin(t*9.1+arm.w2)*.028;return{rho,a};};
  return{rand,bar,arms,polar};
}

// A soft round brush sprite — the unit every painter below stamps with.
function brush(create:CanvasFactory,r:number,gr:number,b:number){const c=create(128,128);const p=c.getContext("2d")!,grd=p.createRadialGradient(64,64,0,64,64,64);grd.addColorStop(0,`rgba(${r},${gr},${b},1)`);grd.addColorStop(.45,`rgba(${r},${gr},${b},.42)`);grd.addColorStop(1,`rgba(${r},${gr},${b},0)`);p.fillStyle=grd;p.fillRect(0,0,128,128);return c;}

export type DiskOptions={edge:string;seed:number;spin?:number;irregular?:boolean;loose?:boolean;dwarf?:boolean;rich?:boolean;size?:number;create?:CanvasFactory;
  /** When set, dust strokes are painted here as WHITE density ('lighter' on black) instead of as
   * dark paint on the disk — this is how the volumetric Milky Way gets its separate dust map.
   * Same strokes, same noise gates, same rand stream: only the destination differs. */
  dustInto?:CanvasRenderingContext2D;
  /** The fine one-pixel star grain (default on). The volumetric maps turn it off: resolved stars
   * come from the 3D point cloud there, and grain baked into a density field only smears. Grain
   * is the painter's LAST pass, so skipping it cannot shift the rand stream of anything else. */
  grain?:boolean};

// Paints a galaxy the way NASA's illustrators draw the Milky Way "simulated image" top view:
// a continuous milky disk whose arms are brighter overdensities *within* the glow (never streaks
// over blackness), broken dark dust lanes etched along each arm's inner edge, an elongated cream
// bar with a bright core, pink star-forming knots, and fine one-pixel star grain. Everything is
// stamped from soft brush sprites onto one canvas; because the plane renders additively, dark
// dust paint simply blocks glow — exactly what real dust does. Deterministic per seed.
export function paintGalaxyDisk({edge,seed,spin=3.2,irregular=false,loose=false,dwarf=false,rich=false,size=1024,create=domCanvas,dustInto,grain=true}:DiskOptions){
  const{rand,bar,arms,polar}=galaxySkeleton(seed,spin,rich);
  // "loose" is the M33 look: all arms comparable, open and flocculent, tiny nucleus, weak dust.
  if(loose)for(const arm of arms)arm.s=Math.max(arm.s,.75);
  const mid=size/2,maxR=size*.46;
  const canvas=create(size,size);const g=canvas.getContext("2d")!;
  const [er,eg,eb]=hexRgb(edge);
  const armPuff=brush(create,er,eg,eb),creamPuff=brush(create,255,230,190),darkPuff=brush(create,24,16,11),whitePuff=brush(create,255,255,255),pinkPuff=brush(create,255,148,168);
  const stamp=(img:HTMLCanvasElement,x:number,y:number,s:number,a:number)=>{g.globalAlpha=a;g.drawImage(img,x-s/2,y-s/2,s,s);};
  // One call site for every dust stroke, so the two destinations can never disagree on shape.
  const dustStamp=(x:number,y:number,s:number,a:number)=>{if(dustInto){dustInto.globalAlpha=a;dustInto.drawImage(whitePuff,x-s/2,y-s/2,s,s);}else stamp(darkPuff,x,y,s,a);};
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
      // soft-rooted arms (the minors, the Outer Arm, the Orion Spur) fade IN over their first
      // third — they emerge from the disk glow, not from the bar, and a hard bright root reads
      // as an amputated stump.
      const fade=Math.min(1,(arm.tEnd-t)*7)*(arm.soft?Math.min(1,.2+t/arm.tEnd*2.5):1),clump=(.3+Math.pow(arm.n1(t*13),1.7)*1.5)*fade;
      const w=size*(.042-.014*t)*(.72+arm.n2(t*8)*.6)*arm.wf,{x,y}=along(arm,t);
      stamp(armPuff,x+(rand()-.5)*w*1.3,y+(rand()-.5)*w*1.3,w*2.1,.021*arm.s*clump);
      stamp(armPuff,x+(rand()-.5)*w*.5,y+(rand()-.5)*w*.5,w*1.05,.055*arm.s*clump);
      if(t<.45&&!arm.soft)stamp(creamPuff,x,y,w*1.8,.015*(1-t*2.2)*arm.s);
    }
    for(let i=0,nf=Math.max(2,Math.round(6*arm.tEnd));i<nf;i++){
      const t0=arm.tEnd*(.12+rand()*.62),dir=rand()<.5?1:-1,len=(.06+rand()*.08)*Math.max(.4,arm.tEnd);
      for(let u=0;u<=1;u+=.1){const p=along(arm,t0+len*u),drift=dir*u*.16;stamp(armPuff,mid+Math.cos(p.a+drift)*p.r,mid+Math.sin(p.a+drift)*p.r,size*.028*arm.wf*(1-u*.5),.022*(1-u)*arm.s);}
    }
  }
  if(irregular)for(let i=0;i<(dwarf?5:10);i++){const rr=Math.pow(rand(),.7)*maxR*.62,an=rand()*Math.PI*2;stamp(armPuff,mid+Math.cos(an)*rr,mid+Math.sin(an)*rr,size*(.16+rand()*.22),dwarf?.06:.09);}
  if(rich){
    // The Near and Far 3kpc Arms: two cream gas arcs hugging the bar as half-ellipses, one
    // bulging toward the Sun, one away — tapered at the tips where they meet the bar's ends.
    for(const side of[1,-1])for(let u=0;u<=1;u+=1/90){
      const ph=u*Math.PI,ex=Math.cos(ph)*.3,ey=side*Math.sin(ph)*.21,taper=.25+.75*Math.sin(ph);
      stamp(creamPuff,mid+(Math.cos(bar)*ex-Math.sin(bar)*ey)*maxR,mid+(Math.sin(bar)*ex+Math.cos(bar)*ey)*maxR,size*.017,.05*taper);
    }
  }
  // Dust: ragged strands hugging each arm's inner (concave) edge. Noise-gated *segments* — dust
  // appears in continuous stretches then breaks — never per-stamp coin flips, which produce the
  // evenly-beaded polka-dot chains that scream "drawn by a computer".
  g.globalCompositeOperation="source-over";
  if(!irregular)for(const arm of arms)for(let t=arm.tEnd*.07;t<=arm.tEnd;t+=1/620){
    const gate=arm.nd(t*24);if(gate<.42)continue;
    const{r,x,y}=along(arm,t),k=1-size*(.012+.008*arm.n2(t*15))/r,j=(arm.n1(t*33)-.5)*size*.007;
    // The last factor ties dust to the band's own clump noise (same n1 lane, same frequency as the
    // brightness pass): dust only shows where there is glow behind it to block, so a dimming arm
    // never leaves a bare dark scratch floating over the faint inter-arm disk.
    dustStamp(mid+(x-mid)*k+j,mid+(y-mid)*k+j,size*(.003+arm.n2(t*41)*.004)*(.5+.5*arm.wf),(.14-.07*t)*(loose?.5:1)*arm.s*(.3+gate*.7)*(.3+.7*arm.n1(t*13)));
  }
  // Cirrus mottling over the whole disk — faint dark wisps, then faint bright patches — so the
  // underlying gradients stop reading as smooth airbrush. Kept whisper-quiet: strong dark blobs
  // punch "holes" in the disk and read as blotches.
  for(let i=0;i<300;i++){const rr=maxR*(.15+Math.pow(rand(),.7)*.85),an=rand()*Math.PI*2;dustStamp(mid+Math.cos(an)*rr,mid+Math.sin(an)*rr,size*(.012+rand()*.022),.02+rand()*.03);}
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
    else{const arm=arms[i%arms.length],p=along(arm,arm.tEnd*(.15+rand()*.75));if(rand()>arm.s)continue;s=arm.s;x=p.x+(rand()-.5)*size*.014;y=p.y+(rand()-.5)*size*.014;}
    stamp(pinkPuff,x,y,size*(.008+rand()*.008),.22*s);
    for(let j=0;j<3;j++)stamp(pinkPuff,x+(rand()-.5)*size*.01,y+(rand()-.5)*size*.01,size*(.0025+rand()*.003),.55*s);
  }
  // Fine star grain: mostly clustered on the arms, the rest a thin disk-wide field. The second,
  // sparser pass is bright pixel "resolved stars" — without them everything is soft brushwork and
  // the whole disk reads as airbrushed fog.
  g.globalAlpha=1;
  if(grain){
    const grains=size*(irregular?9:26);
    for(let i=0;i<grains;i++){
      let x:number,y:number,r:number;
      if(!irregular&&rand()<.6){const arm=arms[(rand()*arms.length)|0];if(rand()>arm.s)continue;const p=along(arm,Math.pow(rand(),.9)*arm.tEnd),w=size*.03;r=p.r;x=p.x+(rand()+rand()-1)*w;y=p.y+(rand()+rand()-1)*w;}
      else{r=Math.pow(rand(),.62)*maxR;if(rand()<Math.pow(r/maxR,1.6))continue;const an=rand()*Math.PI*2;x=mid+Math.cos(an)*r;y=mid+Math.sin(an)*r;}
      const spark=rand()<.08,a=(spark?.25+rand()*.4:.06+rand()*.13).toFixed(3);
      g.fillStyle=spark?`rgba(255,255,255,${a})`:1-r/(size*.2)>rand()?`rgba(255,228,190,${a})`:`rgba(214,224,255,${a})`;
      g.fillRect(x,y,spark?1.4:1+rand(),spark?1.4:1+rand());
    }
  }
  return canvas;
}

// Andromeda gets its own painter, because M31's appearance is *known*, and it is not a generic
// open spiral: a huge soft warm bulge that dominates the light, dust lanes wound so tightly they
// read as nested rings, and a blue star-forming outer ring. Painted face-on — the heavy ~75°
// inclination that makes the photographs unmistakable comes from the plane's tilt in the scene.
export function paintAndromeda(seed:number,size=1024,create:CanvasFactory=domCanvas){
  const rand=rng(seed),mid=size/2,maxR=size*.47;
  const canvas=create(size,size);const g=canvas.getContext("2d")!;
  const blue=brush(create,150,180,235),dust=brush(create,26,17,12),pink=brush(create,255,150,170);
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
  return canvas;
}

// The volumetric Milky Way's two maps, one painter call: the emission canvas is the full painting
// minus dust (routed out) and fine star grain, while the dust canvas holds those same strokes as
// white density on black. Resolved stars come from DeepSpace's 3D point cloud; baking one-pixel
// stars into this map would extrude them into vertical columns through the analytic profile. The
// raymarcher — web GLSL and tvOS Metal alike — extrudes the smooth emission through that profile;
// see galaxyVolume.ts. The bulge paint stays in the emission map deliberately: the map
// carries the long bar's in-plane glow, while the shader's analytic bulge adds the vertical body
// a flat map cannot.
export function milkyWayMaps(size=2048,create:CanvasFactory=domCanvas){
  const dust=create(size,size);
  const dctx=dust.getContext("2d")!;
  dctx.fillStyle="#000";dctx.fillRect(0,0,size,size);
  dctx.globalCompositeOperation="lighter";
  const emission=paintGalaxyDisk({edge:"#a9c6ff",seed:MILKY_WAY_SEED,spin:MILKY_WAY_SPIN,rich:true,size,create,dustInto:dctx,grain:false});
  return{emission,dust};
}
