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
