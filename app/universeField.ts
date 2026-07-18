export type UniverseField = { data:Uint8Array;size:number };
export type FieldPoint = readonly [number,number,number];

export const UNIVERSE_FIELD_SIZE=128;
export const UNIVERSE_FIELD_SEED=0x48454c49;
export const FIELD_ANCHORS = {
  laniakea:[.18,.052,.047] as FieldPoint,
  shapley:[.55,.25,-.12] as FieldPoint,
  bootes:[-.42,.3,.08] as FieldPoint,
  sloan:[.05,-.35,.35] as FieldPoint,
};

function hash(x:number,y:number,z:number,seed:number){let h=(seed^Math.imul(x,374761393)^Math.imul(y,668265263)^Math.imul(z,2147483647))>>>0;h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296;}
function clamp(value:number,min=0,max=1){return Math.min(max,Math.max(min,value));}
function smooth(value:number){return value*value*(3-2*value);}
function valueNoise(x:number,y:number,z:number,seed:number){
  const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),fx=smooth(x-ix),fy=smooth(y-iy),fz=smooth(z-iz),mix=(a:number,b:number,t:number)=>a+(b-a)*t;
  const v=(dx:number,dy:number,dz:number)=>hash(ix+dx,iy+dy,iz+dz,seed);
  return mix(mix(mix(v(0,0,0),v(1,0,0),fx),mix(v(0,1,0),v(1,1,0),fx),fy),mix(mix(v(0,0,1),v(1,0,1),fx),mix(v(0,1,1),v(1,1,1),fx),fy),fz);
}
function worleyRidge(x:number,y:number,z:number,seed:number){
  const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);let first=99,second=99;
  for(let dz=-1;dz<=1;dz++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const cx=ix+dx,cy=iy+dy,cz=iz+dz,px=cx+hash(cx,cy,cz,seed),py=cy+hash(cx,cy,cz,seed+17),pz=cz+hash(cx,cy,cz,seed+37);
    const d=(x-px)**2+(y-py)**2+(z-pz)**2;if(d<first){second=first;first=d;}else if(d<second)second=d;
  }
  return 1-clamp((Math.sqrt(second)-Math.sqrt(first))*2.2);
}
function pointSegmentDistance(x:number,y:number,z:number,a:FieldPoint,b:FieldPoint){
  const abx=b[0]-a[0],aby=b[1]-a[1],abz=b[2]-a[2],t=clamp(((x-a[0])*abx+(y-a[1])*aby+(z-a[2])*abz)/(abx*abx+aby*aby+abz*abz));
  return Math.hypot(x-a[0]-abx*t,y-a[1]-aby*t,z-a[2]-abz*t);
}

/** Converts normalized field coordinates (-1...1) to the RGBA byte offset. */
export function fieldOffset(size:number,point:FieldPoint){const v=(n:number)=>Math.round(clamp(n*.5+.5)* (size-1));return(v(point[2])*size*size+v(point[1])*size+v(point[0]))*4;}
export function densityAt(field:UniverseField,point:FieldPoint){return field.data[fieldOffset(field.size,point)];}

/**
 * Builds the bakeable RGBA source field. R is emission density, G warm/cool balance, B the
 * dust/void term, and A is 255 (texture-space 1.0) only where a catalog-shaped stamp contributed.
 * The shipped app does not run this CPU-heavy loop: scripts/bake-universe-field.mjs commits a
 * deterministic gzip asset, avoiding main-thread generation while remaining portable to tvOS.
 */
export function generateUniverseField({size=UNIVERSE_FIELD_SIZE,seed=UNIVERSE_FIELD_SEED}:{size?:number;seed?:number}={}):UniverseField{
  if(!Number.isInteger(size)||size<16)throw new RangeError("universe field size must be an integer of at least 16");
  const data=new Uint8Array(size*size*size*4),write=(x:number,y:number,z:number,density:number,balance:number,voidTerm:number,anchor=false)=>{const offset=(z*size*size+y*size+x)*4;data[offset]=Math.round(clamp(density)*255);data[offset+1]=Math.round(clamp(balance)*255);data[offset+2]=Math.round(clamp(voidTerm)*255);if(anchor)data[offset+3]=255;};
  for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const nx=x/(size-1)*2-1,ny=y/(size-1)*2-1,nz=z/(size-1)*2-1,ridge=worleyRidge((nx+1)*4.2,(ny+1)*4.2,(nz+1)*4.2,seed),detail=valueNoise((nx+1)*11,(ny+1)*11,(nz+1)*11,seed+71),coarse=valueNoise((nx+1)*3.1,(ny+1)*3.1,(nz+1)*3.1,seed+113);
    const edge=clamp((1-Math.max(Math.abs(nx),Math.abs(ny),Math.abs(nz)))*5),density=Math.pow(clamp((ridge-.66)*2.7),1.45)*(.38+.62*detail)*(.68+.32*coarse)*edge;
    write(x,y,z,density,.28+.56*valueNoise((nx+1)*5.2,(ny+1)*5.2,(nz+1)*5.2,seed+191),1-density*.78);
  }
  const stamp=(test:(x:number,y:number,z:number)=>number,mode:"add"|"carve",balance:number)=>{for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){const nx=x/(size-1)*2-1,ny=y/(size-1)*2-1,nz=z/(size-1)*2-1,amount=clamp(test(nx,ny,nz));if(amount>0){const offset=(z*size*size+y*size+x)*4,current=data[offset]/255,density=mode==="add"?Math.max(current,amount):current*(1-amount*.96);data[offset]=Math.round(density*255);data[offset+1]=Math.round(clamp(data[offset+1]/255*(1-amount*.35)+balance*amount*.35)*255);data[offset+2]=Math.round(clamp(mode==="carve"?data[offset+2]/255+amount*.5:1-density*.72)*255);data[offset+3]=255;}}};
  const tube=(a:FieldPoint,b:FieldPoint,radius:number)=>(x:number,y:number,z:number)=>1-pointSegmentDistance(x,y,z,a,b)/radius;
  stamp(tube([-.12,-.13,-.08],[.42,.2,.15],.075),"add",.58);
  stamp(tube([-.02,.03,-.16],[.28,.13,.28],.055),"add",.66);
  stamp((x,y,z)=>1-Math.hypot((x-FIELD_ANCHORS.shapley[0])/.12,(y-FIELD_ANCHORS.shapley[1])/.09,(z-FIELD_ANCHORS.shapley[2])/.1),"add",.8);
  stamp((x,y,z)=>1-Math.hypot(x-FIELD_ANCHORS.bootes[0],y-FIELD_ANCHORS.bootes[1],z-FIELD_ANCHORS.bootes[2])/.2,"carve",.25);
  stamp((x,y,z)=>{const p=Math.abs((x-FIELD_ANCHORS.sloan[0])*.28+(y-FIELD_ANCHORS.sloan[1])*.88+(z-FIELD_ANCHORS.sloan[2])*.38);return(1-p/.035)*clamp(1-Math.hypot(x-.05,z-.35)/.66);},"add",.42);
  return {data,size};
}
