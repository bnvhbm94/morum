import type {Camera, Viewport, Circle} from './types';

export const MIN_SCALE = 0.0005;
export const MAX_SCALE = 40;

export function worldToScreen(
  camera: Camera,
  viewport: Viewport,
  p: {x: number; y: number}
): {x: number; y: number} {
  return {
    x: (p.x - camera.x) * camera.scale + viewport.width / 2,
    y: (p.y - camera.y) * camera.scale + viewport.height / 2,
  };
}

export function screenToWorld(
  camera: Camera,
  viewport: Viewport,
  p: {x: number; y: number}
): {x: number; y: number} {
  return {
    x: (p.x - viewport.width / 2) / camera.scale + camera.x,
    y: (p.y - viewport.height / 2) / camera.scale + camera.y,
  };
}

export function clampScale(scale: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
}

export function zoomAt(
  camera: Camera,
  viewport: Viewport,
  screenPoint: {x: number; y: number},
  factor: number
): Camera {
  // World point under the screen point before zoom
  const worldBefore = screenToWorld(camera, viewport, screenPoint);

  // New scale
  const newScale = clampScale(camera.scale * factor);

  // Solve for new camera position so the world point stays under screen point
  const newCameraX = worldBefore.x - (screenPoint.x - viewport.width / 2) / newScale;
  const newCameraY = worldBefore.y - (screenPoint.y - viewport.height / 2) / newScale;

  return {
    x: newCameraX,
    y: newCameraY,
    scale: newScale,
  };
}

export function panBy(camera: Camera, dxScreen: number, dyScreen: number): Camera {
  return {
    x: camera.x - dxScreen / camera.scale,
    y: camera.y - dyScreen / camera.scale,
    scale: camera.scale,
  };
}

export function fitCircle(viewport: Viewport, circle: Circle, margin = 0.9): Camera {
  const scale = clampScale(
    Math.min(viewport.width, viewport.height) * margin / (2 * circle.r)
  );
  return {
    x: circle.x,
    y: circle.y,
    scale,
  };
}

export function easeInOutCubic(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped < 0.5) {
    return 4 * clamped * clamped * clamped;
  }
  const x = 2 * clamped - 2;
  return 0.5 * x * x * x + 1;
}

export function interpolate(from: Camera, to: Camera, t: number): Camera {
  const e = easeInOutCubic(t);
  return {
    x: from.x + (to.x - from.x) * e,
    y: from.y + (to.y - from.y) * e,
    scale: Math.exp((1 - e) * Math.log(from.scale) + e * Math.log(to.scale)),
  };
}

export function inertiaStep(
  velocity: {x: number; y: number},
  dtMs: number,
  friction = 0.92
): {velocity: {x: number; y: number}; delta: {x: number; y: number}} {
  const decay = Math.pow(friction, dtMs / 16);
  const delta = {
    x: velocity.x * (dtMs / 16),
    y: velocity.y * (dtMs / 16),
  };
  const newVelocity = {
    x: velocity.x * decay,
    y: velocity.y * decay,
  };

  // Zero out if both components are below threshold
  if (Math.abs(newVelocity.x) < 0.05 && Math.abs(newVelocity.y) < 0.05) {
    return {
      velocity: {x: 0, y: 0},
      delta,
    };
  }

  return {velocity: newVelocity, delta};
}
