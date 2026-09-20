'use client';

import {Color, Mesh, Program, Renderer, Triangle} from 'ogl';
import {useEffect, useRef} from 'react';
import './aurora.css';

const VERT = `#version 300 es
in vec2 position;
void main(){gl_Position=vec4(position,0.0,1.0);}`;
const FRAG = `#version 300 es
precision highp float;
uniform float uTime,uAmplitude,uBlend,uLightMode;
uniform vec3 uColorStops[3];
uniform vec2 uResolution;
out vec4 fragColor;
vec3 permute(vec3 x){return mod(((x*34.0)+1.0)*x,289.0);}
float snoise(vec2 v){const vec4 C=vec4(.2113248654,.3660254038,-.5773502692,.0243902439);vec2 i=floor(v+dot(v,C.yy)),x0=v-i+dot(i,C.xx);vec2 i1=x0.x>x0.y?vec2(1.,0.):vec2(0.,1.);vec4 x12=x0.xyxy+C.xxzz;x12.xy-=i1;i=mod(i,289.);vec3 p=permute(permute(i.y+vec3(0.,i1.y,1.))+i.x+vec3(0.,i1.x,1.));vec3 m=max(.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.);m*=m;m*=m;vec3 x=2.*fract(p*C.www)-1.,h=abs(x)-.5,ox=floor(x+.5),a0=x-ox;m*=1.7928429-.8537347*(a0*a0+h*h);vec3 g;g.x=a0.x*x0.x+h.x*x0.y;g.yz=a0.yz*x12.xz+h.yz*x12.yw;return 130.*dot(m,g);}
void main(){vec2 uv=gl_FragCoord.xy/uResolution;vec3 ramp=mix(mix(uColorStops[0],uColorStops[1],smoothstep(0.,.5,uv.x)),uColorStops[2],smoothstep(.5,1.,uv.x));float height=exp(snoise(vec2(uv.x*2.+uTime*.1,uTime*.25))*.5*uAmplitude);float intensity=.6*(uv.y*2.-height+.2);float alpha=smoothstep(.2-uBlend*.5,.2+uBlend*.5,intensity);vec3 color=intensity*ramp;if(uLightMode>.5)color=mix(vec3(1.),ramp,alpha*.8);fragColor=vec4(color,alpha);}`;

type Props = {colorStops?: [string,string,string]; speed?: number; blend?: number; amplitude?: number; lightMode?: boolean};
export default function Aurora({colorStops=['#7C3AED','#B497CF','#5227FF'],speed=.5,blend=.5,amplitude=1,lightMode=false}: Props){
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{const ctn=ref.current;if(!ctn)return;const renderer=new Renderer({alpha:true,premultipliedAlpha:true,antialias:true});const gl=renderer.gl;gl.clearColor(0.047,0.035,0.07,1);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);const geometry=new Triangle(gl);const colors=()=>colorStops.map(hex=>{const c=new Color(hex);return [c.r,c.g,c.b]});const program=new Program(gl,{vertex:VERT,fragment:FRAG,uniforms:{uTime:{value:0},uAmplitude:{value:amplitude},uColorStops:{value:colors()},uResolution:{value:[ctn.offsetWidth,ctn.offsetHeight]},uBlend:{value:blend},uLightMode:{value:lightMode?1:0}}});const mesh=new Mesh(gl,{geometry,program});ctn.appendChild(gl.canvas);gl.clear(gl.COLOR_BUFFER_BIT);const resize=()=>{renderer.setSize(ctn.offsetWidth,ctn.offsetHeight);program.uniforms.uResolution.value=[ctn.offsetWidth,ctn.offsetHeight]};const start=performance.now();let frame=0;const update=()=>{program.uniforms.uTime.value=(performance.now()-start)/1000*speed;program.uniforms.uAmplitude.value=amplitude;program.uniforms.uBlend.value=blend;program.uniforms.uColorStops.value=colors();renderer.render({scene:mesh});ctn.classList.add('is-ready');frame=requestAnimationFrame(update)};window.addEventListener('resize',resize);resize();update();return()=>{cancelAnimationFrame(frame);window.removeEventListener('resize',resize);if(gl.canvas.parentNode===ctn)ctn.removeChild(gl.canvas);gl.getExtension('WEBGL_lose_context')?.loseContext()};},[amplitude,blend,colorStops,lightMode,speed]);
  return <div ref={ref} className="aurora-container" aria-hidden="true"/>;
}
