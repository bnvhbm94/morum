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

export function paintStarfield(ctx: CanvasRenderingContext2D, stars: Star[], camera: Camera, viewport: Viewport, dim = 1): void {
  if (viewport.width <= 0 || viewport.height <= 0) return;
  const offsetX = wrap(camera.x * camera.scale * 0.02, viewport.width);
  const offsetY = wrap(camera.y * camera.scale * 0.02, viewport.height);
  ctx.fillStyle = '#8a8796';
  for (const star of stars) {
    const x = wrap(star.x * viewport.width - offsetX, viewport.width);
    const y = wrap(star.y * viewport.height - offsetY, viewport.height);
    ctx.globalAlpha = star.alpha * dim;
    ctx.beginPath();
    ctx.arc(x, y, star.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** One soft dot for a category too small to open (LOD 'point'). */
export function drawCategoryPoint(ctx: CanvasRenderingContext2D, screenPos: {x: number; y: number}, mass: number, dim = 1): void {
  const alpha = (0.35 + 0.65 * Math.min(1, Math.log2(1 + mass) / 6)) * dim;
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
/** A galaxy's particles spread across its circle; a star's gather toward its light, so the two read differently from afar. */
export function makeCategoryParticles(circle: Circle, seed: number, mass: number, concentration = 1.6): Particle[] {
  const rand = mulberry32(seed);
  const count = categoryParticleCount(mass);
  const points: Particle[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = rand() * Math.PI * 2;
    const radius = circle.r * Math.pow(rand(), concentration);
    points.push({x: circle.x + Math.cos(angle) * radius, y: circle.y + Math.sin(angle) * radius, size: 0.6 + rand() * 1.0});
  }
  return points;
}

/** Nebula/open/items particles: warm white, fading per `alpha` (1 for nebula; scaled down as the circle opens up). */
/** Particles inside `quiet` are dimmed, not removed, down to this share of `alpha` at its centre. */
const QUIET_FLOOR = 0.12;

/**
 * `quiet`, when given, is a world-space circle where an opened category's name sits. Stars there fade toward
 * QUIET_FLOOR with a smooth falloff to the rim, the way sky charts dim stars under a constellation name.
 */
export function drawCategoryParticles(ctx: CanvasRenderingContext2D, points: Particle[], camera: Camera, viewport: Viewport, alpha: number, quiet?: Circle): void {
  if (alpha <= 0) return;
  ctx.fillStyle = '#f1ecff';
  for (const point of points) {
    let share = 1;
    if (quiet) {
      const t = Math.hypot(point.x - quiet.x, point.y - quiet.y) / quiet.r;
      if (t < 1) share = QUIET_FLOOR + (1 - QUIET_FLOOR) * t * t * (3 - 2 * t);
    }
    ctx.globalAlpha = alpha * share;
    const screen = worldToScreen(camera, viewport, point);
    if (screen.x < -20 || screen.x > viewport.width + 20 || screen.y < -20 || screen.y > viewport.height + 20) continue;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, point.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Item 5: a radial gradient per star per frame was one of the costs of panning. Each look is rendered once
// into a small sprite per radius bucket (device pixels) and drawn scaled with drawImage; the gradient stops are
// the same, with the overall alpha moved to globalAlpha, so the result reads identical to the eye.
const SPRITE_BUCKETS = [4, 8, 16, 24, 32, 48, 64, 128];
type SpriteKind = 'glow' | 'core';
const spriteCache = new Map<string, CanvasImageSource>();

function makeCanvas(size: number): (HTMLCanvasElement | OffscreenCanvas) | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(size, size);
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = size; c.height = size; return c; }
  return null;
}

function sprite(kind: SpriteKind, devicePx: number): CanvasImageSource | null {
  const bucket = SPRITE_BUCKETS.find(b => b >= devicePx) ?? SPRITE_BUCKETS[SPRITE_BUCKETS.length - 1];
  const key = `${kind}:${bucket}`;
  const cached = spriteCache.get(key);
  if (cached) return cached;
  const canvas = makeCanvas(bucket * 2);
  const ctx = canvas?.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
  if (!canvas || !ctx) return null;
  const g = ctx.createRadialGradient(bucket, bucket, 0, bucket, bucket, bucket);
  if (kind === 'glow') {
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
  } else {
    g.addColorStop(0, 'rgba(255,248,236,1)');
    g.addColorStop(0.35, `rgba(255,240,220,${(0.35 / 0.95).toFixed(4)})`);
    g.addColorStop(1, 'rgba(255,236,210,0)');
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(bucket, bucket, bucket, 0, Math.PI * 2);
  ctx.fill();
  spriteCache.set(key, canvas);
  return canvas;
}

function drawSprite(ctx: CanvasRenderingContext2D, kind: SpriteKind, screenPos: {x: number; y: number}, radius: number, alpha: number): void {
  if (radius <= 0 || alpha <= 0) return;
  const image = sprite(kind, radius * (ctx.getTransform().a || 1));
  if (!image) return;
  const previous = ctx.globalAlpha;
  ctx.globalAlpha = alpha;
  ctx.drawImage(image, screenPos.x - radius, screenPos.y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = previous;
}

/** Very faint radial glow filling an 'open'/'items' circle, centre to rim (2.5% white at the centre). */
export function drawCategoryGlow(ctx: CanvasRenderingContext2D, screenPos: {x: number; y: number}, radiusPx: number): void {
  drawSprite(ctx, 'glow', screenPos, radiusPx, 0.025);
}

/** The light of a star: a warm core that stays small on screen so planets and the name read over it. */
export function drawStarCore(ctx: CanvasRenderingContext2D, screenPos: {x: number; y: number}, starRadiusPx: number, alpha: number): void {
  const radius = Math.max(2.5, Math.min(48, starRadiusPx * 0.09));
  drawSprite(ctx, 'core', screenPos, radius, 0.95 * alpha);
}
