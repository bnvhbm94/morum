import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rootCircle,
  packChildren,
  placeOrbits,
  HOLE_KEY,
  ORBIT_INNER,
  ORBIT_OUTER,
  ROOT_RADIUS,
  FILL,
  PAD,
} from '../../src/components/universe/layout.ts';
import {bodyKind, starCircle} from '../../src/components/universe/celestial.ts';
import {estimateLabelWidth, resolveLabels} from '../../src/components/universe/labels.ts';
import {
  worldToScreen,
  screenToWorld,
  clampScale,
  zoomAt,
  panBy,
  fitCircle,
  easeInOutCubic,
  interpolate,
  inertiaStep,
  MIN_SCALE,
  MAX_SCALE,
} from '../../src/components/universe/camera.ts';
import {
  screenRadius,
  stageFor,
  stageScale,
  directionalNode,
  isVisible,
  itemsOpen,
  pickFetchTargets,
} from '../../src/components/universe/lod.ts';

test('layout: rootCircle', () => {
  const circle = rootCircle();
  assert.equal(circle.x, 0);
  assert.equal(circle.y, 0);
  assert.equal(circle.r, ROOT_RADIUS);
});

test('layout: packChildren deterministic', () => {
  const children = [
    {id: 'a', mass: 10},
    {id: 'b', mass: 5},
    {id: 'c', mass: 15},
  ];
  const parent = rootCircle();
  const seed = 42;

  const result1 = packChildren(parent, children, seed);
  const result2 = packChildren(parent, children, seed);

  assert.equal(result1.size, result2.size);
  for (const [id, circle1] of result1) {
    const circle2 = result2.get(id);
    assert(circle2);
    assert.equal(circle1.x, circle2.x);
    assert.equal(circle1.y, circle2.y);
    assert.equal(circle1.r, circle2.r);
  }
});

test('layout: packChildren empty', () => {
  const result = packChildren(rootCircle(), [], 0);
  assert.equal(result.size, 0);
});

test('layout: packChildren single child', () => {
  const parent = rootCircle();
  const result = packChildren(parent, [{id: 'a', mass: 5}], 0);

  assert.equal(result.size, 1);
  const child = result.get('a');
  assert(child);
  assert.equal(child.x, parent.x);
  assert.equal(child.y, parent.y);
  assert.equal(child.r, parent.r * FILL);
});

test('layout: packChildren 30 children no overlap', () => {
  const children = Array.from({length: 30}, (_, i) => ({
    id: String(i),
    mass: i + 1,
  }));
  const parent = rootCircle();
  const packed = packChildren(parent, children, 0);

  assert.equal(packed.size, 30);

  // Check no overlaps
  const circles = Array.from(packed.values());
  for (let i = 0; i < circles.length; i++) {
    for (let j = i + 1; j < circles.length; j++) {
      const c1 = circles[i];
      const c2 = circles[j];
      const dist = Math.hypot(c1.x - c2.x, c1.y - c2.y);
      const minDist = c1.r + c2.r;
      assert(dist >= minDist - 1e-9, `Circles ${i} and ${j} overlap`);
    }
  }

  // Check all inside parent
  for (const [id, circle] of packed) {
    const distFromParent = Math.hypot(
      circle.x - parent.x,
      circle.y - parent.y
    );
    const maxDist = parent.r * FILL;
    assert(
      distFromParent + circle.r <= maxDist + 1e-9,
      `Circle ${id} extends outside parent`
    );
  }
});

test('layout: packChildren larger mass -> larger radius', () => {
  const children = [
    {id: 'small', mass: 1},
    {id: 'large', mass: 100},
  ];
  const parent = rootCircle();
  const packed = packChildren(parent, children, 0);

  const smallCircle = packed.get('small');
  const largeCircle = packed.get('large');
  assert(smallCircle && largeCircle);
  assert(largeCircle.r >= smallCircle.r);
});

test('layout: packChildren different seed -> different positions', () => {
  const children = Array.from({length: 10}, (_, i) => ({
    id: String(i),
    mass: i + 1,
  }));
  const parent = rootCircle();

  const packed1 = packChildren(parent, children, 0);
  const packed2 = packChildren(parent, children, 42);

  let anyDifferent = false;
  for (const [id, c1] of packed1) {
    const c2 = packed2.get(id);
    if (
      c1.x !== c2?.x ||
      c1.y !== c2?.y
    ) {
      anyDifferent = true;
      break;
    }
  }
  assert(anyDifferent, 'Different seeds should produce different positions');
});

test('camera: worldToScreen and screenToWorld inverse', () => {
  const camera = {x: 100, y: 200, scale: 2};
  const viewport = {width: 800, height: 600};
  const point = {x: 150, y: 250};

  const screen = worldToScreen(camera, viewport, point);
  const worldAgain = screenToWorld(camera, viewport, screen);

  assert.equal(worldAgain.x, point.x);
  assert.equal(worldAgain.y, point.y);
});

test('camera: clampScale', () => {
  assert.equal(clampScale(0.00001), MIN_SCALE);
  assert.equal(clampScale(100), MAX_SCALE);
  assert.equal(clampScale(5), 5);
});

test('camera: zoomAt keeps point fixed', () => {
  const camera = {x: 0, y: 0, scale: 1};
  const viewport = {width: 800, height: 600};
  const screenPoint = {x: 400, y: 300};

  const worldBefore = screenToWorld(camera, viewport, screenPoint);
  const newCamera = zoomAt(camera, viewport, screenPoint, 2);
  const worldAfter = screenToWorld(newCamera, viewport, screenPoint);

  assert.equal(worldAfter.x, worldBefore.x);
  assert.equal(worldAfter.y, worldBefore.y);
});

test('camera: zoomAt clamps scale', () => {
  const camera = {x: 0, y: 0, scale: 1};
  const viewport = {width: 800, height: 600};
  const screenPoint = {x: 400, y: 300};

  const zoomed = zoomAt(camera, viewport, screenPoint, 1000);
  assert(zoomed.scale <= MAX_SCALE);
  assert(zoomed.scale > 1);
});

test('camera: panBy then panBy back', () => {
  const camera = {x: 100, y: 200, scale: 2};
  const panned1 = panBy(camera, 50, 60);
  const panned2 = panBy(panned1, -50, -60);

  assert.equal(panned2.x, camera.x);
  assert.equal(panned2.y, camera.y);
  assert.equal(panned2.scale, camera.scale);
});

test('camera: fitCircle', () => {
  const circle = {x: 100, y: 200, r: 100};
  const viewport = {width: 800, height: 600};

  const camera = fitCircle(viewport, circle, 0.9);
  assert.equal(camera.x, circle.x);
  assert.equal(camera.y, circle.y);

  // Screen diameter should be close to min(w, h) * margin
  const screenDiam = 2 * circle.r * camera.scale;
  const expected = Math.min(viewport.width, viewport.height) * 0.9;
  assert(Math.abs(screenDiam - expected) < 1e-6);
});

test('camera: easeInOutCubic clamping', () => {
  assert.equal(easeInOutCubic(-1), 0);
  assert.equal(easeInOutCubic(2), 1);
});

test('camera: interpolate endpoints', () => {
  const from = {x: 0, y: 0, scale: 1};
  const to = {x: 100, y: 200, scale: 10};

  const at0 = interpolate(from, to, 0);
  const at1 = interpolate(from, to, 1);

  assert.equal(at0.x, from.x);
  assert.equal(at0.y, from.y);
  assert.equal(at0.scale, from.scale);

  assert.equal(at1.x, to.x);
  assert.equal(at1.y, to.y);
  assert(Math.abs(at1.scale - to.scale) < 1e-9);
});

test('camera: inertiaStep decay to zero', () => {
  let velocity = {x: 100, y: 100};
  for (let i = 0; i < 100; i++) {
    const result = inertiaStep(velocity, 16);
    velocity = result.velocity;
    if (Math.abs(velocity.x) < 0.05 && Math.abs(velocity.y) < 0.05) {
      break;
    }
  }
  assert.equal(velocity.x, 0);
  assert.equal(velocity.y, 0);
});

test('lod: stageFor thresholds', () => {
  // Below 24 without items -> point
  assert.equal(stageFor(23, false), 'point');
  assert.equal(stageFor(23, true), 'point');

  // 24-159 -> nebula
  assert.equal(stageFor(24, false), 'nebula');
  assert.equal(stageFor(159, false), 'nebula');
  assert.equal(stageFor(159, true), 'nebula');

  // 160-599 -> open
  assert.equal(stageFor(160, false), 'open');
  assert.equal(stageFor(599, false), 'open');
  assert.equal(stageFor(599, true), 'open');

  // 600+ with items -> items, without -> open
  assert.equal(stageFor(600, true), 'items');
  assert.equal(stageFor(600, false), 'open');
});

test('lod: isVisible centred circle', () => {
  const circle = {x: 0, y: 0, r: 50};
  const camera = {x: 0, y: 0, scale: 1};
  const viewport = {width: 800, height: 600};

  assert(isVisible(circle, camera, viewport));
});

test('lod: isVisible far off-screen', () => {
  const circle = {x: 1000, y: 1000, r: 10};
  const camera = {x: 0, y: 0, scale: 1};
  const viewport = {width: 800, height: 600};

  assert(!isVisible(circle, camera, viewport));
});

test('lod: pickFetchTargets excludes invisible', () => {
  const candidates = [
    {
      id: 'visible',
      circle: {x: 0, y: 0, r: 50},
      childCount: 5,
      directCount: 0,
    },
    {
      id: 'invisible',
      circle: {x: 1000, y: 1000, r: 50},
      childCount: 5,
      directCount: 0,
    },
  ];
  const camera = {x: 0, y: 0, scale: 1};
  const viewport = {width: 800, height: 600};
  const loadedChildren = new Set();
  const loadedItems = new Set();

  const result = pickFetchTargets(candidates, camera, viewport, loadedChildren, loadedItems);
  assert(!result.children.includes('invisible'));
});

test('lod: pickFetchTargets excludes already loaded', () => {
  const candidates = [
    {
      id: 'a',
      circle: {x: 0, y: 0, r: 500},
      childCount: 5,
      directCount: 0,
    },
  ];
  const camera = {x: 0, y: 0, scale: 1};
  const viewport = {width: 800, height: 600};
  const loadedChildren = new Set(['a']);
  const loadedItems = new Set();

  const result = pickFetchTargets(candidates, camera, viewport, loadedChildren, loadedItems);
  assert(!result.children.includes('a'));
});

test('lod: pickFetchTargets sorts by screen radius', () => {
  const candidates = [
    {
      id: 'small',
      circle: {x: 0, y: 0, r: 50},
      childCount: 5,
      directCount: 0,
    },
    {
      id: 'large',
      circle: {x: 100, y: 100, r: 200},
      childCount: 5,
      directCount: 0,
    },
  ];
  const camera = {x: 0, y: 0, scale: 1};
  const viewport = {width: 800, height: 600};
  const loadedChildren = new Set();
  const loadedItems = new Set();

  const result = pickFetchTargets(candidates, camera, viewport, loadedChildren, loadedItems);
  // Large should come first due to larger screen radius
  assert.equal(result.children[0], 'large');
});

test('lod: pickFetchTargets respects max', () => {
  const candidates = Array.from({length: 10}, (_, i) => ({
    id: String(i),
    circle: {x: i * 100, y: 0, r: 50 + i * 10},
    childCount: 5,
    directCount: 0,
  }));
  const camera = {x: 500, y: 0, scale: 1};
  const viewport = {width: 1000, height: 600};
  const loadedChildren = new Set();
  const loadedItems = new Set();

  const result = pickFetchTargets(candidates, camera, viewport, loadedChildren, loadedItems, 3);
  assert(result.children.length <= 3);
});

test('a leaf category shows its items as soon as it opens', () => {
  assert.equal(stageFor(200, true, false), 'items');
  assert.equal(stageFor(200, true, true), 'open');
  assert.equal(stageFor(200, false, false), 'open');
  assert.equal(stageFor(100, true, false), 'nebula');
});

test('stage thresholds shrink on small screens but never below half', () => {
  assert.equal(stageScale({width: 1400, height: 900}), 1);
  assert.equal(stageScale({width: 375, height: 700}), 0.5);
  assert.equal(stageFor(118, true, false, stageScale({width: 294, height: 302})), 'items');
  assert.equal(stageFor(118, true, false, 1), 'nebula');
});

test('arrow keys pick the nearest node in that direction', () => {
  const nodes = [{key: 'c', x: 0, y: 0}, {key: 'r', x: 100, y: 10}, {key: 'far', x: 400, y: 0}, {key: 'd', x: 5, y: 120}];
  assert.equal(directionalNode(nodes, nodes[0], 'ArrowRight').key, 'r');
  assert.equal(directionalNode(nodes, nodes[0], 'ArrowDown').key, 'd');
  assert.equal(directionalNode(nodes, nodes[0], 'ArrowLeft'), null);
});

test('a named centre child takes the middle whatever its mass', () => {
  const parent = {x: 0, y: 0, r: 1000};
  const children = [{id: 'big', mass: 40}, {id: 'guide', mass: 6}, {id: 'mid', mass: 12}];
  const plain = packChildren(parent, children, 0);
  const centred = packChildren(parent, children, 0, 'guide');
  assert.deepEqual([plain.get('big').x, plain.get('big').y], [0, 0]);
  assert.deepEqual([centred.get('guide').x, centred.get('guide').y], [0, 0]);
  assert.equal(packChildren(parent, children, 0, 'missing').get('big').x, 0);
});

test('a reserved centre stays empty and children still fit inside', () => {
  const parent = {x: 0, y: 0, r: 1000};
  const children = Array.from({length: 9}, (_, i) => ({id: `d${i}`, mass: 1}));
  const placed = packChildren(parent, children, 7, undefined, 1.9);
  const one = placed.get('d0');
  const holeRadius = 1.9 * one.r; // raw radius 1 maps to one.r
  assert.ok(Math.abs(placed.get(HOLE_KEY).r - holeRadius) < 1e-6, 'the reserved centre is reported in world units');
  for (const [id, circle] of placed) {
    if (id === HOLE_KEY) continue;
    assert.ok(Math.hypot(circle.x, circle.y) >= holeRadius + circle.r - 1e-6, 'child overlaps the reserved centre');
    assert.ok(Math.hypot(circle.x, circle.y) + circle.r <= parent.r * FILL + 1e-6, 'child outside the parent');
  }
  const single = packChildren(parent, [{id: 'only', mass: 1}], 0, undefined, 1.9).get('only');
  assert.ok(Math.hypot(single.x, single.y) > 0, 'a single child moves off the centre when it is reserved');
});

test('planets are placed by meaning, not an even ring: stable, no overlap, distance ordered by score', () => {
  const star = {x: 100, y: -50, r: 400};
  const mkPlanets = n => Array.from({length: n}, (_, i) => ({id: `p${i}`, ageRank: i / Math.max(n - 1, 1), reviewRank: 0.5}));
  for (const n of [1, 3, 7, 24, 120]) {
    const planets = mkPlanets(n);
    const placed = placeOrbits(star, 'star-a', planets, 11);
    assert.equal(placed.size, n);
    const circles = [...placed.values()];
    for (let i = 0; i < circles.length; i++) for (let j = i + 1; j < circles.length; j++) {
      assert.ok(Math.hypot(circles[i].x - circles[j].x, circles[i].y - circles[j].y) >= circles[i].r + circles[j].r - 1e-6, `planets overlap (n=${n})`);
    }
    // Same input, same output (stability).
    const again = placeOrbits(star, 'star-a', [...planets].reverse(), 11);
    for (const [id, c] of placed) assert.deepEqual(again.get(id), c, 'order of planets must not change the layout');
  }
  const a = placeOrbits(star, 'star-a', mkPlanets(3), 1), b = placeOrbits(star, 'star-a', mkPlanets(3), 2);
  assert.notDeepEqual(a.get('p0'), b.get('p0'), 'the seed rotates the orbits');
});

test('distance from the star orders by score: higher age/review rank sits closer in', () => {
  const star = {x: 0, y: 0, r: 400};
  // ageRank 1 = oldest (closer); reviewRank 1 = most reviewed (closer). Same angle-affecting id text avoided by using distinct ids.
  const planets = [
    {id: 'old-reviewed', ageRank: 1, reviewRank: 1},
    {id: 'mid', ageRank: 0.5, reviewRank: 0.5},
    {id: 'new-unreviewed', ageRank: 0, reviewRank: 0},
  ];
  const placed = placeOrbits(star, 'star-b', planets, 3);
  const dist = id => Math.hypot(placed.get(id).x - star.x, placed.get(id).y - star.y);
  assert.ok(dist('old-reviewed') < dist('mid'), 'higher score sits closer to the star');
  assert.ok(dist('mid') < dist('new-unreviewed'), 'lower score sits farther from the star');
});

test('ellipse bounds: axis ratio in [0.72, 1.0] and rotation in [0, pi) come from the star id', () => {
  const star = {x: 0, y: 0, r: 400};
  // Sample the ellipse boundary with single, isolated planets (score 0 => r = outer, no collision to distort it)
  // at many ids, so their angles spread widely and the min/max distance approximates the ellipse's axes.
  for (const starId of ['alpha', 'beta', 'gamma', 'delta']) {
    const dists = [];
    for (let i = 0; i < 60; i += 1) {
      const placed = placeOrbits(star, starId, [{id: `sample-${starId}-${i}`, ageRank: 0, reviewRank: 0}], 5);
      const c = [...placed.values()][0];
      dists.push(Math.hypot(c.x - star.x, c.y - star.y) / star.r);
    }
    const max = Math.max(...dists), min = Math.min(...dists);
    assert.ok(min / max >= 0.72 - 0.05 && min / max <= 1.0 + 1e-6, `axis ratio out of bounds for ${starId}: ${min / max}`);
  }
  // Different star ids give different ellipses (rotation/axis ratio depend on starId).
  const p1 = placeOrbits(star, 'alpha', [{id: 'x', ageRank: 0, reviewRank: 0}], 5);
  const p2 = placeOrbits(star, 'beta', [{id: 'x', ageRank: 0, reviewRank: 0}], 5);
  assert.notDeepEqual(p1.get('x'), p2.get('x'), 'each star gets its own ellipse');
});

test('300-planet synthetic star: no two planets closer than one diameter', () => {
  const star = {x: 0, y: 0, r: 400};
  const planets = Array.from({length: 300}, (_, i) => ({id: `syn${String(i).padStart(3, '0')}`, ageRank: Math.random(), reviewRank: Math.random()}));
  // A generous ceiling stands in for an isolated star with room to grow (real callers pass the sibling gap).
  const placed = placeOrbits(star, 'dense-star', planets, 42, 6);
  const circles = [...placed.values()];
  for (let i = 0; i < circles.length; i++) for (let j = i + 1; j < circles.length; j++) {
    const d = Math.hypot(circles[i].x - circles[j].x, circles[i].y - circles[j].y);
    assert.ok(d >= circles[i].r + circles[j].r - 1e-6, `planets ${i},${j} closer than one diameter`);
  }
});

test('outer radius never exceeds the ceiling', () => {
  // n stays below the density where collision-push (>60 planets, spec §2) can carry a planet past the
  // ceiling to clear an overlap; that push takes priority over the ceiling for very dense fields.
  const star = {x: 0, y: 0, r: 400};
  for (const n of [1, 12, 50]) {
    const planets = Array.from({length: n}, (_, i) => ({id: `q${i}`, ageRank: 0, reviewRank: 0})); // score 0 => farthest
    const ceiling = 0.9;
    const placed = placeOrbits(star, 'ceil-star', planets, 7, ceiling);
    for (const c of placed.values()) {
      const d = Math.hypot(c.x - star.x, c.y - star.y) + c.r;
      assert.ok(d <= star.r * ceiling + star.r * 0.045 + 1e-6, `planet exceeds outer ceiling for n=${n}: ${d} > ${star.r * ceiling}`);
    }
  }
});

test('body kind follows role, not depth', () => {
  assert.equal(bodyKind({childCount: 3, directCount: 0}), 'galaxy');
  assert.equal(bodyKind({childCount: 0, directCount: 8}), 'star');
  assert.equal(bodyKind({childCount: 2, directCount: 5}), 'galaxy-star');
  assert.equal(bodyKind({childCount: 0, directCount: 0}), 'empty');
  const circle = {x: 0, y: 0, r: 500};
  assert.deepEqual(starCircle({childCount: 0, directCount: 8}, circle, 60), circle);
  assert.deepEqual(starCircle({childCount: 2, directCount: 5}, circle, 60), {x: 0, y: 0, r: 60});
});

test('items open once the star they orbit is open on screen, even inside a galaxy', () => {
  assert.equal(itemsOpen(159), false);
  assert.equal(itemsOpen(160), true);
  assert.equal(itemsOpen(90, 0.5), true);
  const camera = {x: 0, y: 0, scale: 1}, viewport = {width: 1400, height: 900};
  const galaxyStar = {id: 'g', circle: {x: 0, y: 0, r: 700}, starCircle: {x: 0, y: 0, r: 100}, childCount: 3, directCount: 4};
  assert.deepEqual(pickFetchTargets([galaxyStar], camera, viewport, new Set(), new Set()).items, [], 'the centre star is still too small');
  const closer = {...galaxyStar, starCircle: {x: 0, y: 0, r: 200}};
  assert.deepEqual(pickFetchTargets([closer], camera, viewport, new Set(), new Set()).items, ['g']);
  assert.deepEqual(pickFetchTargets([closer], camera, viewport, new Set(), new Set()).children, ['g']);
});

test('labels: overlapping boxes keep the higher priority, zooming apart shows both', () => {
  assert.ok(estimateLabelWidth('한글', 10) > estimateLabelWidth('ab', 10));
  const close = [
    {id: 'a', x: 0, y: 0, width: 100, height: 18, priority: 1},
    {id: 'b', x: 40, y: 4, width: 100, height: 18, priority: 5},
    {id: 'c', x: 300, y: 0, width: 60, height: 18, priority: 0},
  ];
  assert.deepEqual([...resolveLabels(close)].sort(), ['b', 'c']);
  const apart = close.map(box => ({...box, x: box.x * 4}));
  assert.deepEqual([...resolveLabels(apart)].sort(), ['a', 'b', 'c']);
  const tie = [{id: 'z', x: 0, y: 0, width: 50, height: 18, priority: 1}, {id: 'y', x: 10, y: 0, width: 50, height: 18, priority: 1}];
  assert.deepEqual([...resolveLabels(tie)], ['y'], 'ties resolve by id so the result is stable');
});
