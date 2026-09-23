// Canvas 2D drawing helpers. Pure functions of (ctx, ...data) — no component state, no refs.
import type {Camera, Circle, Viewport} from './types';
import {worldToScreen} from './camera';

export type Star = {x: number; y: number; size: number; alpha: number};
export type Particle = {x: number; y: number; size: number};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function wrap(value: number, max: number): number {
  if (max <= 0) return 0;
  const m = value % max;
  return m < 0 ? m + max : m;
}

/** Decorative background starlight: fixed, deterministic, dimmer/cooler/smaller than any data particle, never interactive. */
export function makeStarfield(count = 220, seed = 1337): Star[] {
  const rand = mulberry32(seed);
  const stars: Star[] = [];
  for (let i = 0; i < count; i += 1) {
    stars.push({x: rand(), y: rand(), size: 0.5 + rand() * 0.7, alpha: 0.15 + rand() * 0.2});
  }
  return stars;
}

export function paintStarfield(ctx: CanvasRenderingContext2D, stars: Star[], camera: Camera, viewport: Viewport): void {
  if (viewport.width <= 0 || viewport.height <= 0) return;
  const offsetX = wrap(camera.x * camera.scale * 0.02, viewport.width);
  const offsetY = wrap(camera.y * camera.scale * 0.02, viewport.height);
  ctx.fillStyle = '#8a8796';
  for (const star of stars) {
    const x = wrap(star.x * viewport.width - offsetX, viewport.width);
    const y = wrap(star.y * viewport.height - offsetY, viewport.height);
    ctx.globalAlpha = star.alpha;
    ctx.beginPath();
    ctx.arc(x, y, star.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** One soft dot for a category too small to open (LOD 'point'). */
export function drawCategoryPoint(ctx: CanvasRenderingContext2D, screenPos: {x: number; y: number}, mass: number): void {
  const alpha = 0.35 + 0.65 * Math.min(1, Math.log2(1 + mass) / 6);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#f1ecff';
  ctx.beginPath();
  ctx.arc(screenPos.x, screenPos.y, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

export function categoryParticleCount(mass: number): number {
  return Math.round(Math.min(400, 30 + 60 * Math.log2(1 + mass)));
}

/** Deterministic particle field from the category's own layoutSeed, biased toward the centre (density falls toward the rim). World-space, so it only needs generating once per category. */
export function makeCategoryParticles(circle: Circle, seed: number, mass: number): Particle[] {
  const rand = mulberry32(seed);
  const count = categoryParticleCount(mass);
  const points: Particle[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = rand() * Math.PI * 2;
    const radius = circle.r * Math.pow(rand(), 1.6);
    points.push({x: circle.x + Math.cos(angle) * radius, y: circle.y + Math.sin(angle) * radius, size: 0.6 + rand() * 1.0});
  }
  return points;
}

/** Nebula/open/items particles: warm white, fading per `alpha` (1 for nebula; scaled down as the circle opens up). */
export function drawCategoryParticles(ctx: CanvasRenderingContext2D, points: Particle[], camera: Camera, viewport: Viewport, alpha: number): void {
  if (alpha <= 0) return;
  ctx.fillStyle = '#f1ecff';
  ctx.globalAlpha = alpha;
  for (const point of points) {
    const screen = worldToScreen(camera, viewport, point);
    if (screen.x < -20 || screen.x > viewport.width + 20 || screen.y < -20 || screen.y > viewport.height + 20) continue;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, point.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Very faint radial glow filling an 'open'/'items' circle, centre to rim. */
export function drawCategoryGlow(ctx: CanvasRenderingContext2D, screenPos: {x: number; y: number}, radiusPx: number): void {
  if (radiusPx <= 0) return;
  const gradient = ctx.createRadialGradient(screenPos.x, screenPos.y, 0, screenPos.x, screenPos.y, radiusPx);
  gradient.addColorStop(0, 'rgba(255,255,255,0.025)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(screenPos.x, screenPos.y, radiusPx, 0, Math.PI * 2);
  ctx.fill();
}
