import * as THREE from "three";

export type DeepLabel = { id:string;sprite:THREE.Sprite;anchor:THREE.Vector3;worldRadius:number;markerPixelRadius:number };
export type DeepMarker = { id:string;sprite:THREE.Sprite;anchor:THREE.Vector3;pixelSize:number };

export function labelTexture(name:string,color:string){
  const canvas=document.createElement("canvas");canvas.width=512;canvas.height=112;const context=canvas.getContext("2d")!;
  context.font="600 26px Arial";context.textAlign="center";context.fillStyle="rgba(3,6,14,.82)";context.roundRect(40,24,432,64,12);context.fill();
  context.strokeStyle=color;context.globalAlpha=.5;context.stroke();context.globalAlpha=1;context.fillStyle="#f2f0e9";context.fillText(name.toUpperCase(),256,64);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}

export function installDeepOverlays({camera,renderer,coarsePointer,labels,markers,targets,activeId,focus}:{camera:THREE.PerspectiveCamera;renderer:THREE.WebGLRenderer;coarsePointer:boolean;labels:DeepLabel[];markers:DeepMarker[];targets:THREE.Object3D[];activeId:()=>string;focus:(id:string)=>void}){
  const down=new THREE.Vector2(),raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
  function pointerDown(event:PointerEvent){down.set(event.clientX,event.clientY);}
  function pointerUp(event:PointerEvent){if(down.distanceTo(new THREE.Vector2(event.clientX,event.clientY))>7)return;const rect=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-((event.clientY-rect.top)/rect.height)*2+1);raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects(targets,false)[0];if(hit)focus(hit.object.userData.id);}
  renderer.domElement.addEventListener("pointerdown",pointerDown);renderer.domElement.addEventListener("pointerup",pointerUp);
  const cameraScreenUp=new THREE.Vector3(),labelPosition=new THREE.Vector3(),projected=new THREE.Vector3();
  function update(now:number){
    const current=activeId(),viewportWidth=Math.max(1,renderer.domElement.clientWidth),viewportHeight=Math.max(1,renderer.domElement.clientHeight),pixelHeight=coarsePointer?32:38;
    const perspectiveFactor=2*Math.tan(THREE.MathUtils.degToRad(camera.fov*.5))/viewportHeight;
    cameraScreenUp.set(0,1,0).applyQuaternion(camera.quaternion).normalize();
    for(const marker of markers){
      const worldPerPixel=Math.max(1e-10,camera.position.distanceTo(marker.anchor)*perspectiveFactor),active=marker.id===current;
      const pulse=active?1.08+Math.sin(now*.004)*.05:1,size=worldPerPixel*marker.pixelSize*pulse;
      marker.sprite.position.copy(marker.anchor);marker.sprite.scale.set(size,size,1);(marker.sprite.material as THREE.SpriteMaterial).opacity=active?1:.72;
    }
    for(const {sprite,anchor,worldRadius,markerPixelRadius} of labels){
      const worldPerPixel=Math.max(1e-10,camera.position.distanceTo(anchor)*perspectiveFactor),height=worldPerPixel*pixelHeight;
      labelPosition.copy(anchor).addScaledVector(cameraScreenUp,worldRadius+worldPerPixel*(markerPixelRadius+5+pixelHeight*.5));
      sprite.position.copy(labelPosition);sprite.scale.set(height*4.57,height,1);
    }
    const priority=(id:string)=>id===current?0:id==="solar-system"||id==="milky-way"?1:id==="center"||id==="andromeda"?2:3;
    const occupied:{left:number;right:number;top:number;bottom:number}[]=[];
    for(const label of [...labels].sort((a,b)=>priority(a.id)-priority(b.id))){
      projected.copy(label.sprite.position).project(camera);
      const x=(projected.x*.5+.5)*viewportWidth,y=(-projected.y*.5+.5)*viewportHeight,width=pixelHeight*4.1,pad=7;
      const rect={left:x-width/2-pad,right:x+width/2+pad,top:y-pixelHeight/2-pad,bottom:y+pixelHeight/2+pad};
      const onScreen=projected.z>-1&&projected.z<1&&rect.right>0&&rect.left<viewportWidth&&rect.bottom>0&&rect.top<viewportHeight;
      const blocked=onScreen&&occupied.some(other=>rect.left<other.right&&rect.right>other.left&&rect.top<other.bottom&&rect.bottom>other.top);
      const targetOpacity=onScreen&&!blocked?1:0,material=label.sprite.material as THREE.SpriteMaterial;
      material.opacity=THREE.MathUtils.lerp(material.opacity,targetOpacity,.16);
      if(targetOpacity>0)occupied.push(rect);
    }
  }
  return {update,dispose(){renderer.domElement.removeEventListener("pointerdown",pointerDown);renderer.domElement.removeEventListener("pointerup",pointerUp);}};
}
