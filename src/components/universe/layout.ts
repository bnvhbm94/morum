import type {Circle} from './types';

export const ROOT_RADIUS = 1000;
/** Children occupy this fraction of the parent radius. */
export const FILL = 0.86;
/** Gap between siblings, as a fraction of the smaller radius. */
export const PAD = 0.12;

export function rootCircle(): Circle {
  return {x: 0, y: 0, r: ROOT_RADIUS};
}

export function packChildren(
  parent: Circle,
  children: {id: string; mass: number}[],
  seed: number
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

  if (sorted.length === 1) {
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
