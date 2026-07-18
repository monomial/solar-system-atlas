import { createCanvas, loadImage } from "@napi-rs/canvas";
import { mkdir, writeFile } from "node:fs/promises";

const sourceUrl=new URL("../artwork/universe/wmap-ilc-9yr-mollweide.png",import.meta.url),outputUrl=new URL("../public/textures/universe/cmb-wmap-2048.webp",import.meta.url),width=2048,height=1024,root2=Math.SQRT2;
const source=await loadImage(sourceUrl.pathname),sourceCanvas=createCanvas(source.width,source.height),sourceContext=sourceCanvas.getContext("2d");sourceContext.drawImage(source,0,0);const input=sourceContext.getImageData(0,0,source.width,source.height).data;
const canvas=createCanvas(width,height),context=canvas.getContext("2d"),image=context.createImageData(width,height),output=image.data;
function mollweideTheta(latitude){let theta=latitude;for(let index=0;index<10;index++){const twice=2*theta,delta=(twice+Math.sin(twice)-Math.PI*Math.sin(latitude))/(2+2*Math.cos(twice));theta-=delta;}return theta;}
function sample(x,y,channel){const x0=Math.max(0,Math.min(source.width-1,Math.floor(x))),y0=Math.max(0,Math.min(source.height-1,Math.floor(y))),x1=Math.min(source.width-1,x0+1),y1=Math.min(source.height-1,y0+1),fx=x-x0,fy=y-y0,a=input[(y0*source.width+x0)*4+channel],b=input[(y0*source.width+x1)*4+channel],c=input[(y1*source.width+x0)*4+channel],d=input[(y1*source.width+x1)*4+channel];return Math.round((a+(b-a)*fx)*(1-fy)+(c+(d-c)*fx)*fy);}
// The raw ILC colormap is a saturated rainbow that shouts. On the boundary sphere it must read
// as a faint distant glow behind the web, so the bake quiets it: partial desaturation toward
// luminance, then darkened. The mottling — the actual data — survives untouched.
const quiet=(r,g,b,channel)=>{const luminance=r*.299+g*.587+b*.114,value=channel===0?r:channel===1?g:b;return Math.round((luminance+(value-luminance)*.55)*.52);};
for(let y=0;y<height;y++){const latitude=Math.PI/2-(y+.5)/height*Math.PI,theta=mollweideTheta(latitude),mollweideY=root2*Math.sin(theta),sourceY=(root2-mollweideY)/(2*root2)*(source.height-1);for(let x=0;x<width;x++){const longitude=(x+.5)/width*Math.PI*2-Math.PI,mollweideX=2*root2/Math.PI*longitude*Math.cos(theta),sourceX=(mollweideX+2*root2)/(4*root2)*(source.width-1),offset=(y*width+x)*4,r=sample(sourceX,sourceY,0),g=sample(sourceX,sourceY,1),b=sample(sourceX,sourceY,2);output[offset]=quiet(r,g,b,0);output[offset+1]=quiet(r,g,b,1);output[offset+2]=quiet(r,g,b,2);output[offset+3]=255;}}
context.putImageData(image,0,0);await mkdir(new URL(".",outputUrl),{recursive:true});const encoded=canvas.toBuffer("image/webp");await writeFile(outputUrl,encoded);console.log(`WMAP Mollweide → equirectangular CMB → public/textures/universe/cmb-wmap-2048.webp (${width}×${height}, ${encoded.length.toLocaleString()} bytes)`);
