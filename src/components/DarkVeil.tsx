'use client';

import {useEffect, useRef} from 'react';
import {Mesh, Program, Renderer, Triangle, Vec2} from 'ogl';
import './dark-veil.css';

const vertex = `attribute vec2 position; void main(){ gl_Position = vec4(position, 0.0, 1.0); }`;
const fragment = `
precision lowp float;
uniform vec2 uResolution;
uniform float uTime;
uniform float uHueShift;
uniform float uNoise;
uniform float uScan;
uniform float uScanFreq;
uniform float uWarp;

float random(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 hueShift(vec3 color, float degrees){
  float angle = radians(degrees);
  mat3 toYiq = mat3(0.299,0.587,0.114, 0.596,-0.274,-0.322, 0.211,-0.523,0.312);
  mat3 toRgb = mat3(1.0,0.956,0.621, 1.0,-0.272,-0.647, 1.0,-1.106,1.703);
  vec3 yiq = toYiq * color;
  float c = cos(angle), s = sin(angle);
  return clamp(toRgb * vec3(yiq.x, yiq.y*c - yiq.z*s, yiq.y*s + yiq.z*c), 0.0, 1.0);
}
void main(){
  vec2 uv = gl_FragCoord.xy / uResolution.xy;
  vec2 centered = uv * 2.0 - 1.0;
  centered.x *= uResolution.x / max(uResolution.y, 1.0);
  centered += uWarp * vec2(sin(centered.y * 5.0 + uTime), cos(centered.x * 4.0 + uTime)) * 0.05;
  float wave = sin(centered.x * 2.4 + uTime * 0.32) * 0.18 + cos(centered.y * 3.2 - uTime * 0.22) * 0.16;
  float glow = smoothstep(1.5, 0.0, length(centered + vec2(wave * 0.18, -wave * 0.12)));
  vec3 color = vec3(0.008, 0.004, 0.018) + vec3(0.10, 0.035, 0.16) * glow;
  color = hueShift(color, uHueShift);
  color *= 1.0 - (sin(gl_FragCoord.y * uScanFreq) * 0.5 + 0.5) * uScan;
  color += (random(gl_FragCoord.xy + uTime) - 0.5) * uNoise;
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;

export default function DarkVeil({hueShift = 0, noiseIntensity = 0.025, scanlineIntensity = 0.08, speed = 0.5, scanlineFrequency = 0.035, warpAmount = 0.18, resolutionScale = 0.7}: {hueShift?: number; noiseIntensity?: number; scanlineIntensity?: number; speed?: number; scanlineFrequency?: number; warpAmount?: number; resolutionScale?: number}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const renderer = new Renderer({canvas, dpr: Math.min(window.devicePixelRatio, 2)});
    const geometry = new Triangle(renderer.gl);
    const program = new Program(renderer.gl, {vertex, fragment, uniforms: {
      uResolution: {value: new Vec2()}, uTime: {value: 0}, uHueShift: {value: hueShift},
      uNoise: {value: noiseIntensity}, uScan: {value: scanlineIntensity},
      uScanFreq: {value: scanlineFrequency}, uWarp: {value: warpAmount}
    }});
    const mesh = new Mesh(renderer.gl, {geometry, program});
    const resize = () => { const {clientWidth: w, clientHeight: h} = parent; renderer.setSize(w * resolutionScale, h * resolutionScale); program.uniforms.uResolution.value.set(w, h); };
    const start = performance.now(); let frame = 0;
    const loop = () => { program.uniforms.uTime.value = (performance.now() - start) / 1000 * speed; renderer.render({scene: mesh}); frame = requestAnimationFrame(loop); };
    window.addEventListener('resize', resize); resize(); loop();
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', resize); renderer.gl.getExtension('WEBGL_lose_context')?.loseContext(); };
  }, [hueShift, noiseIntensity, scanlineIntensity, speed, scanlineFrequency, warpAmount, resolutionScale]);
  return <canvas ref={ref} className="darkveil-canvas" aria-hidden="true" />;
}
