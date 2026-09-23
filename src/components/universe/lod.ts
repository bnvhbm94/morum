import type {Camera, Circle, Viewport} from './types';
import {worldToScreen} from './camera';

export type Stage = 'point' | 'nebula' | 'open' | 'items';

export const STAGE_PX = {nebula: 24, open: 160, items: 600} as const;

export function screenRadius(circle: Circle, camera: Camera): number {
  return circle.r * camera.scale;
}

/** Thresholds shrink on small screens so a category fitted to a phone still opens: 1 at >= 900px min side, never below 0.5. */
export function stageScale(viewport: Viewport): number {
  return Math.max(0.5, Math.min(1, Math.min(viewport.width, viewport.height) / 900));
}

/** A leaf category (no subcategories) shows its items as soon as it opens; otherwise items wait for STAGE_PX.items. */
export function stageFor(radiusPx: number, hasDirectItems: boolean, hasChildren = true, k = 1): Stage {
  if (radiusPx < STAGE_PX.nebula * k) {
    return 'point';
  }
  if (radiusPx < STAGE_PX.open * k) {
    return 'nebula';
  }
  if (hasDirectItems && (radiusPx >= STAGE_PX.items * k || !hasChildren)) {
    return 'items';
  }
  return 'open';
}

export function isVisible(circle: Circle, camera: Camera, viewport: Viewport): boolean {
  const screenPos = worldToScreen(camera, viewport, {x: circle.x, y: circle.y});
  const screenRad = screenRadius(circle, camera);

  // Check if the bounding box of the circle intersects the viewport
  return (
    screenPos.x + screenRad >= 0 &&
    screenPos.x - screenRad <= viewport.width &&
    screenPos.y + screenRad >= 0 &&
    screenPos.y - screenRad <= viewport.height
  );
}

export type FetchCandidate = {
  id: string;
  circle: Circle;
  childCount: number;
  directCount: number;
  /** The circle the category's own documents orbit; the category circle itself when absent. */
  starCircle?: Circle;
};

/** Documents of a category are fetched and shown once its star (the circle they orbit) opens on screen. */
export function itemsOpen(starRadiusPx: number, k = 1): boolean {
  return starRadiusPx >= STAGE_PX.open * k;
}

export function pickFetchTargets(
  candidates: FetchCandidate[],
  camera: Camera,
  viewport: Viewport,
  loadedChildren: Set<string>,
  loadedItems: Set<string>,
  max = 4
): {children: string[]; items: string[]} {
  const children: {id: string; radiusPx: number}[] = [];
  const items: {id: string; radiusPx: number}[] = [];

  for (const candidate of candidates) {
    // Must be visible
    if (!isVisible(candidate.circle, camera, viewport)) {
      continue;
    }

    const radiusPx = screenRadius(candidate.circle, camera);
    const k = stageScale(viewport);
    const stage = stageFor(radiusPx, candidate.directCount > 0, candidate.childCount > 0, k);

    // Collect children
    if ((stage === 'open' || stage === 'items') && candidate.childCount > 0) {
      if (!loadedChildren.has(candidate.id)) {
        children.push({id: candidate.id, radiusPx});
      }
    }

    // Collect items: a star's documents load when the star itself is open, whether or not it sits inside a galaxy.
    const starRadiusPx = screenRadius(candidate.starCircle ?? candidate.circle, camera);
    if (candidate.directCount > 0 && itemsOpen(starRadiusPx, k)) {
      if (!loadedItems.has(candidate.id)) {
        items.push({id: candidate.id, radiusPx: starRadiusPx});
      }
    }
  }

  // Sort by screen radius descending, ties by id ascending
  children.sort((a, b) => {
    if (b.radiusPx !== a.radiusPx) {
      return b.radiusPx - a.radiusPx;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  items.sort((a, b) => {
    if (b.radiusPx !== a.radiusPx) {
      return b.radiusPx - a.radiusPx;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return {
    children: children.slice(0, max).map(c => c.id),
    items: items.slice(0, max).map(i => i.id),
  };
}

/** The nearest node in an arrow key's direction, preferring nodes closest to the current row or column. */
export function directionalNode<T extends {key: string; x: number; y: number}>(nodes: T[], current: T, key: string): T | null {
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
  const candidates = nodes.filter(node => key === 'ArrowLeft' ? node.x < current.x : key === 'ArrowRight' ? node.x > current.x : key === 'ArrowUp' ? node.y < current.y : node.y > current.y);
  const axial = (node: T) => horizontal ? Math.abs(node.y - current.y) : Math.abs(node.x - current.x);
  const forward = (node: T) => horizontal ? Math.abs(node.x - current.x) : Math.abs(node.y - current.y);
  return candidates.sort((a, b) => axial(a) + forward(a) * 0.5 - (axial(b) + forward(b) * 0.5) || (a.key < b.key ? -1 : 1))[0] || null;
}
