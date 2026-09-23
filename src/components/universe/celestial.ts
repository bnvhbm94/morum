// What kind of body a category is. Decided by role, never by depth: a category with subcategories only is a
// galaxy, one that holds documents directly is a star, one with both is a galaxy with a star at its centre.
import type {Circle, UniverseCategory} from './types';

export type BodyKind = 'galaxy' | 'star' | 'galaxy-star' | 'empty';

export function bodyKind(category: Pick<UniverseCategory, 'childCount' | 'directCount'>): BodyKind {
  const hasChildren = category.childCount > 0;
  const hasItems = category.directCount > 0;
  if (hasChildren && hasItems) return 'galaxy-star';
  if (hasChildren) return 'galaxy';
  if (hasItems) return 'star';
  return 'empty';
}

/** Raw radius (in unit-mass items) reserved at a galaxy's centre; a star living there gets this much room. */
export const CENTER_HOLE = 1.9;

/**
 * The circle a category's own documents orbit. A pure star is its whole circle; a galaxy with a star keeps its
 * children around the reserved centre, so the star is the hole itself, scaled like the children were.
 */
export function starCircle(category: Pick<UniverseCategory, 'childCount' | 'directCount'>, circle: Circle, holeRadius: number): Circle {
  if (bodyKind(category) === 'galaxy-star') return {x: circle.x, y: circle.y, r: holeRadius};
  return circle;
}

export const BODY_LABEL: Record<BodyKind, string> = {galaxy: '은하', star: '항성', 'galaxy-star': '은하', empty: ''};
