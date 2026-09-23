import type {Circle} from './types';

export const ROOT_RADIUS = 1000;
/** Children occupy this fraction of the parent radius. */
export const FILL = 0.86;
/** Gap between siblings, as a fraction of the smaller radius. */
export const PAD = 0.12;

/** Key under which packChildren reports the reserved centre circle (world units) when a hole was requested. */
export const HOLE_KEY = '\u0000hole';

export function rootCircle(): Circle {
  return {x: 0, y: 0, r: ROOT_RADIUS};
}

/** Pack children inside `parent` by mass. `centerId` puts one child in the middle; `hole` instead reserves an empty centre of that raw radius. */
export function packChildren(
  parent: Circle,
  children: {id: string; mass: number}[],
  seed: number,
  centerId?: string,
  hole = 0
): Map<string, Circle> {
  if (children.length === 0) {
    return new Map();
  }

  // Sort by mass descending, ties by id ascending
  const sorted = [...children].sort((a, b) => {
    if (b.mass !== a.mass) {
      return b.mass - a.mass;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  // The first placed child takes the centre; a named centre (the archive's own guide) goes first whatever its mass.
  const centerIndex = centerId === undefined ? -1 : sorted.findIndex(child => child.id === centerId);
  if (centerIndex > 0) sorted.unshift(...sorted.splice(centerIndex, 1));

  if (sorted.length === 1 && hole <= 0) {
    const child = sorted[0];
    return new Map([
      [
        child.id,
        {
          x: parent.x,
          y: parent.y,
          r: parent.r * FILL,
        },
      ],
    ]);
  }

  // Calculate raw radii
  const radii = new Map<string, number>();
  for (const child of sorted) {
    radii.set(child.id, Math.sqrt(Math.max(child.mass, 0.25)));
  }

  // Find smallest raw radius for step calculation
  const smallestRadius = Math.min(...Array.from(radii.values()));

  // Placement in local coordinates
  const localPositions = new Map<string, {x: number; y: number}>();
  // A reserved centre (raw radius `hole`) keeps the parent's name readable; children pack around it.
  if (hole > 0) { radii.set(HOLE_KEY, hole); localPositions.set(HOLE_KEY, {x: 0, y: 0}); }
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const seedAngle = (((seed % 360) + 360) % 360) * (Math.PI / 180);
  const step = 0.35 * smallestRadius;

  for (const child of sorted) {
    const ri = radii.get(child.id)!;
    let placed = false;

    for (let k = 0; k <= 200000; k++) {
      const angle = k * GOLDEN + seedAngle;
      const dist = step * Math.sqrt(k);
      const candidateX = dist * Math.cos(angle);
      const candidateY = dist * Math.sin(angle);

      // Check overlap with already placed circles
      let overlaps = false;
      for (const [placedId, placedPos] of localPositions.entries()) {
        const rj = radii.get(placedId)!;
        const dx = candidateX - placedPos.x;
        const dy = candidateY - placedPos.y;
        const distance = Math.hypot(dx, dy);
        const minDist = ri + rj + PAD * Math.min(ri, rj);
        if (distance < minDist) {
          overlaps = true;
          break;
        }
      }

      if (!overlaps) {
        localPositions.set(child.id, {x: candidateX, y: candidateY});
        placed = true;
        break;
      }
    }

    if (!placed) {
      // Safeguard: use k = 200000 point
      const k = 200000;
      const angle = k * GOLDEN + seedAngle;
      const dist = step * Math.sqrt(k);
      localPositions.set(child.id, {
        x: dist * Math.cos(angle),
        y: dist * Math.sin(angle),
      });
    }
  }

  // Calculate bounding radius B
  let B = 0;
  for (const [id, pos] of localPositions.entries()) {
    const ri = radii.get(id)!;
    const dist = Math.hypot(pos.x, pos.y) + ri;
    B = Math.max(B, dist);
  }
  if (B === 0) {
    B = 1;
  }

  // Scale and output
  const s = (parent.r * FILL) / B;
  const result = new Map<string, Circle>();
  if (hole > 0) result.set(HOLE_KEY, {x: parent.x, y: parent.y, r: hole * s});
  for (const child of sorted) {
    const pos = localPositions.get(child.id)!;
    const ri = radii.get(child.id)!;
    result.set(child.id, {
      x: parent.x + pos.x * s,
      y: parent.y + pos.y * s,
      r: ri * s,
    });
  }

  return result;
}

/** Innermost orbit as a fraction of the star's radius: the star's own name and light sit inside it. */
export const ORBIT_INNER = 0.34;
/** Outermost orbit as a fraction of the star's radius. */
export const ORBIT_OUTER = 0.9;

/**
 * Place planets on concentric orbits around a star. Rings fill from the inside; each ring holds as many
 * planets as its circumference allows at a spacing of `gap` planet diameters, so nothing overlaps and the
 * centre stays empty. Order is by id (deterministic); the seed rotates each ring so sibling stars differ.
 */
export function placeOrbits(star: Circle, ids: string[], seed: number, inner = ORBIT_INNER, outer = ORBIT_OUTER): Map<string, Circle> {
  const result = new Map<string, Circle>();
  const sorted = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const n = sorted.length;
  if (n === 0) return result;
  const seedAngle = (((seed % 360) + 360) % 360) * (Math.PI / 180);
  const band = star.r * (outer - inner);
  // Planet radius: shrink as planets grow in number, so a star with hundreds of planets still fits them.
  const ringsWanted = Math.max(1, Math.ceil(Math.sqrt(n / 6)));
  const spacing = band / ringsWanted;
  const planetR = Math.min(star.r * 0.045, spacing * 0.28);
  const minArc = planetR * 3.2;
  let placed = 0;
  let ring = 0;
  while (placed < n) {
    const ringRadius = star.r * inner + spacing * (ring + 0.5);
    const capacity = Math.max(1, Math.floor((2 * Math.PI * ringRadius) / minArc));
    const count = Math.min(capacity, n - placed);
    const offset = seedAngle + ring * 2.399963;
    for (let i = 0; i < count; i += 1) {
      const angle = offset + (i / count) * Math.PI * 2;
      result.set(sorted[placed + i], {x: star.x + Math.cos(angle) * ringRadius, y: star.y + Math.sin(angle) * ringRadius, r: planetR});
    }
    placed += count;
    ring += 1;
  }
  return result;
}
