import * as THREE from "three";
import type { UniverseField } from "./universeField";

export type UniverseVolumeMesh = THREE.Mesh<THREE.BoxGeometry,THREE.ShaderMaterial> & {updateCamera:(camera:THREE.Camera)=>void};

export function createUniverseVolume(field:UniverseField):UniverseVolumeMesh{
  const texture=new THREE.Data3DTexture(field.data,field.size,field.size,field.size);texture.format=THREE.RGBAFormat;texture.type=THREE.UnsignedByteType;texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.wrapS=texture.wrapT=texture.wrapR=THREE.ClampToEdgeWrapping;texture.unpackAlignment=1;texture.needsUpdate=true;
  const material=new THREE.ShaderMaterial({transparent:true,premultipliedAlpha:true,depthWrite:false,side:THREE.BackSide,toneMapped:true,uniforms:{uField:{value:texture},uCamera:{value:new THREE.Vector3()}},vertexShader:`
    varying vec3 vPosition;
    void main(){vPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}
  `,fragmentShader:`
    precision highp float;
    precision highp sampler3D;
    uniform sampler3D uField;
    uniform vec3 uCamera;
    varying vec3 vPosition;
    vec2 intersectBox(vec3 origin,vec3 direction){
      vec3 inverseDirection=1.0/direction;
      vec3 t0=(-60.0-origin)*inverseDirection,t1=(60.0-origin)*inverseDirection;
      vec3 lo=min(t0,t1),hi=max(t0,t1);
      return vec2(max(max(lo.x,lo.y),lo.z),min(min(hi.x,hi.y),hi.z));
    }
    float ign(vec2 pixel){return fract(52.9829189*fract(dot(pixel,vec2(.06711056,.00583715))));}
    void main(){
      vec3 direction=normalize(vPosition-uCamera);vec2 hit=intersectBox(uCamera,direction);
      float nearDistance=max(hit.x,0.0),segment=max(0.0,hit.y-nearDistance);if(segment<=0.0)discard;
      float steps=mix(32.0,56.0,clamp(segment/120.0,0.0,1.0)),stepLength=segment/steps;
      float distanceAlong=nearDistance+stepLength*ign(gl_FragCoord.xy);vec4 accumulated=vec4(0.0);
      for(int index=0;index<56;index++){
        if(float(index)>=steps||accumulated.a>.96)break;
        vec3 samplePosition=uCamera+direction*distanceAlong,uvw=samplePosition/120.0+.5;vec4 field=texture(uField,uvw);
        float absorption=mix(1.0,.52,smoothstep(.5,1.0,field.b)),density=smoothstep(.17,.78,field.r)*1.22*absorption,charted=field.a;
        vec3 cool=vec3(.055,.18,.48),warm=vec3(.96,.36,.13),anchorWarm=vec3(1.0,.58,.24),color=mix(cool,warm,clamp(field.g+charted*.1,0.0,1.0));color=mix(color,anchorWarm,charted*.24)*(.28+density*1.55+charted*.18);
        float alpha=clamp(density*stepLength*.018,0.0,.1);accumulated.rgb+=(1.0-accumulated.a)*color*alpha;accumulated.a+=(1.0-accumulated.a)*alpha;
        distanceAlong+=stepLength;
      }
      gl_FragColor=accumulated;
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `});
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(120,120,120),material) as UniverseVolumeMesh;mesh.renderOrder=1;mesh.updateCamera=(camera)=>material.uniforms.uCamera.value.copy(camera.position);return mesh;
}

// A soft round point sprite — same reason as DeepSpace's softDot: bare gl points read as confetti.
function galaxyDot(inner:string,outer:string){
  const canvas=document.createElement("canvas");canvas.width=canvas.height=64;const g=canvas.getContext("2d")!;
  const grd=g.createRadialGradient(32,32,0,32,32,32);grd.addColorStop(0,inner);grd.addColorStop(1,outer);g.fillStyle=grd;g.fillRect(0,0,64,64);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}

/** The deep-field layer: the volume is the milk, these are the resolved galaxies.
 *
 * The Hubble deep fields are the eye's reference for "universe scale" — mostly true black,
 * lit by tiny sharp varied points. The Milky Way scale learned the same lesson (volume for
 * glow, point cloud for sparkle); this transposes it up: every speck here is one bright
 * galaxy, importance-sampled (density², so filament cores glitter and voids stay black)
 * from the SAME committed field the raymarcher integrates, with anchor-masked structures
 * sparkling a touch brighter. Deterministic, so the sky is stable across visits. */
export function createUniverseGalaxies(field:UniverseField){
  let s=0x9e3779b9;const rand=()=>{s=s+0x6d2b79f5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
  const size=field.size,target=42000,positions=new Float32Array(target*3),colors=new Float32Array(target*3),color=new THREE.Color();
  let placed=0;
  for(let trial=0;trial<target*260&&placed<target;trial++){
    const x=rand()*size,y=rand()*size,z=rand()*size,offset=(((z|0)*size*size+(y|0)*size+(x|0)))*4;
    const density=field.data[offset]/255;
    if(rand()>=density*density*1.7)continue;
    positions[placed*3]=(x/size*2-1)*60;positions[placed*3+1]=(y/size*2-1)*60;positions[placed*3+2]=(z/size*2-1)*60;
    // Deep-field census, loosely: mostly pale spirals, a cool blue population, warm ellipticals,
    // and the rare reddened distant smudge.
    const roll=rand();color.set(roll<.48?"#dfe8ff":roll<.72?"#9db8ff":roll<.9?"#ffd9a8":roll<.97?"#f4f4f0":"#ff9d8a");
    const brightness=(.45+rand()*.55)*(field.data[offset+3]>0?1.3:1);
    colors[placed*3]=color.r*brightness;colors[placed*3+1]=color.g*brightness;colors[placed*3+2]=color.b*brightness;
    placed++;
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.BufferAttribute(positions.subarray(0,placed*3),3));
  geometry.setAttribute("color",new THREE.BufferAttribute(colors.subarray(0,placed*3),3));
  const group=new THREE.Group();group.renderOrder=2;
  // Two layers over shared geometry, as in the Milky Way: a faint halo so overlaps melt into
  // glow, and pinpoint cores that make them read as galaxies instead of fog.
  group.add(new THREE.Points(geometry,new THREE.PointsMaterial({size:1.15,map:galaxyDot("rgba(255,255,255,.85)","rgba(255,255,255,0)"),transparent:true,opacity:.14,vertexColors:true,depthWrite:false,blending:THREE.AdditiveBlending})));
  group.add(new THREE.Points(geometry,new THREE.PointsMaterial({size:.48,map:galaxyDot("rgba(255,255,255,1)","rgba(255,255,255,0)"),transparent:true,opacity:.8,vertexColors:true,depthWrite:false,blending:THREE.AdditiveBlending})));
  for(const child of group.children)child.renderOrder=2;
  return group;
}
