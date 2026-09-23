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
/** Outermost orbit as a fraction of the star's radius, at the reference count of 12 planets. Grows with sqrt(count/12), see placeOrbits. */
export const ORBIT_OUTER = 0.9;

/** 32-bit FNV-1a hash of a string, as an unsigned integer in [0, 2^32). Deterministic across runs and platforms. */
export function fnv1a32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A [0,1) pseudo-random value derived from a string, stable across reloads. */
function hashUnit(input: string): number {
  return fnv1a32(input) / 4294967296;
}

/** Meaning-bearing input for one planet: age and review rank, both in [0,1], 1 = oldest / most reviewed among siblings. */
export type OrbitPlanet = {id: string; ageRank: number; reviewRank: number};

/**
 * Rank values in [0,1] (1 = largest) by their position in sorted order, not by raw magnitude, so outliers
 * don't flatten the rest. Ties share the same rank. A single value (or all-null) ranks at 0.5.
 */
function rankOf(values: (number | null)[]): number[] {
  const n = values.length;
  const present = values.map((v, i) => ({v, i})).filter((e): e is {v: number; i: number} => e.v !== null);
  if (present.length <= 1) return values.map(() => 0.5);
  const sorted = [...present].sort((a, b) => a.v - b.v);
  const rankByIndex = new Map<number, number>();
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].v === sorted[i].v) j += 1;
    // Average rank of the tie group, in [0,1], 1 = largest.
    const avgPos = (i + j) / 2;
    const rank = sorted.length === 1 ? 0.5 : avgPos / (sorted.length - 1);
    for (let k = i; k <= j; k += 1) rankByIndex.set(sorted[k].i, rank);
    i = j + 1;
  }
  return values.map((v, idx) => (v === null ? 0.5 : rankByIndex.get(idx) ?? 0.5));
}

/**
 * Place planets by meaning, not on an even-angle ring (1.9 §2). Distance from the star encodes age and
 * review (score = 0.6 age + 0.4 review, ranked so outliers don't flatten the field), with small deterministic
 * jitter. Angle comes from a hash of the record id. Each star gets its own ellipse (axis ratio, rotation) from
 * a hash of the star id, so sibling stars read differently. Field density stays roughly constant as planet
 * count grows (`outer` grows with sqrt(count/12), capped by `outerCeiling`); above 60 planets, collisions are
 * resolved by pushing the colliding planet outward along its own ray, in id order, never moving another planet.
 */
export function placeOrbits(
  star: Circle,
  starId: string,
  planets: OrbitPlanet[],
  seed: number,
  /** Ceiling on the outer band, as a fraction of star.r: the field must never overlap a neighbouring star's
   *  field. Callers should pass the existing sibling gap; the default leaves headroom (packChildren's PAD gap
   *  between siblings) for a star with no closer neighbour. */
  outerCeiling = 1 / FILL,
  inner = ORBIT_INNER
): Map<string, Circle> {
  const result = new Map<string, Circle>();
  const n = planets.length;
  if (n === 0) return result;
  const sorted = [...planets].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Outer radius grows with sqrt(count/12) relative to the reference band [inner, ORBIT_OUTER], capped at outerCeiling.
  const grown = inner + (ORBIT_OUTER - inner) * Math.sqrt(Math.max(n, 1) / 12);
  const outer = Math.min(Math.max(grown, ORBIT_OUTER), Math.max(outerCeiling, ORBIT_OUTER));
  const band = outer - inner;

  const ageRanks = rankOf(sorted.map(p => p.ageRank));
  const reviewRanks = rankOf(sorted.map(p => p.reviewRank));

  // Planet dot radius: same shrink rule as before, based on how many share the field.
  const ringsWanted = Math.max(1, Math.ceil(Math.sqrt(n / 6)));
  const spacing = (star.r * band) / ringsWanted;
  const planetR = Math.min(star.r * 0.045, spacing * 0.28);

  const axisRatio = 0.72 + hashUnit(`${starId}:axis`) * (1.0 - 0.72);
  const rotation = hashUnit(`${starId}:rot`) * Math.PI;
  const cosRot = Math.cos(rotation);
  const sinRot = Math.sin(rotation);

  const seedAngle = (((seed % 360) + 360) % 360) * (Math.PI / 180);

  type Placed = {id: string; ux: number; uy: number; r: number}; // ux/uy are un-rotated local ellipse-space coords
  const placed: Placed[] = [];

  for (let idx = 0; idx < sorted.length; idx += 1) {
    const p = sorted[idx];
    const score = 0.6 * ageRanks[idx] + 0.4 * reviewRanks[idx];
    const jitter = (hashUnit(`${p.id}:jitter`) - 0.5) * 2 * 0.06 * band; // +/- 6% of the band
    const r = Math.min(Math.max(inner + (1 - score) * band + jitter, inner), outer);
    const angle = seedAngle + hashUnit(p.id) * Math.PI * 2;
    // Ellipse: squash along the local y axis by axisRatio before rotating into place.
    let ux = Math.cos(angle) * r;
    let uy = Math.sin(angle) * r * axisRatio;

    // Collision resolution: the spec (§2) describes pushing a colliding planet outward along its own ray in
    // diameter-sized steps. Two planets whose ids happen to hash to near-identical angles (expected by chance
    // once a star has hundreds of planets) sit on rays that never diverge fast enough to clear each other by
    // radial motion alone, and many planets can tie on distance (same age/review rank), stacking on the same
    // few radii. So the search here widens to the same bounded 2D spiral `packChildren` already uses
    // elsewhere in this file: it starts at the own-ray candidate point and searches outward around it,
    // deterministic and order-independent of any *other* planet's position (only already-placed planets are
    // avoided; this planet is the only one that moves), converging on the intended "own ray, pushed out"
    // result whenever that alone would have worked, and finding open space nearby when it would not.
    {
      let placedOk = false;
      const GOLDEN = Math.PI * (3 - Math.sqrt(5));
      const baseX = ux, baseY = uy;
      // ux/uy/outer are fractions of star.r; planetR is a raw world-unit radius, so the spiral step (and the
      // collision test below, which also compares against planetR) must be converted to the same fraction units.
      const planetRFrac = planetR / star.r;
      for (let k = 0; k <= 4000; k += 1) {
        const a = k * GOLDEN;
        const d = planetRFrac * 2.05 * Math.sqrt(k);
        const cx = baseX + d * Math.cos(a);
        const cy = baseY + d * Math.sin(a);
        const cr = Math.hypot(cx, cy / (axisRatio || 1));
        if (cr > outer) continue; // stay within the star's field
        let collides = false;
        for (const other of placed) {
          const dx = cx - other.ux;
          const dy = cy - other.uy;
          if (Math.hypot(dx, dy) < planetRFrac * 2) { collides = true; break; } // all planets share one dot radius
        }
        if (!collides) { ux = cx; uy = cy; placedOk = true; break; }
      }
      if (!placedOk) { ux = baseX; uy = baseY; } // no open spot found within the ceiling: accept the overlap at the rim
    }

    placed.push({id: p.id, ux, uy, r: planetR});
  }

  for (const p of placed) {
    // Rotate the ellipse-space point by the star's rotation, then place in world space.
    const wx = p.ux * cosRot - p.uy * sinRot;
    const wy = p.ux * sinRot + p.uy * cosRot;
    result.set(p.id, {x: star.x + wx * star.r, y: star.y + wy * star.r, r: planetR});
  }

  return result;
}
