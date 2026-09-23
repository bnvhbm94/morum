import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rootCircle,
  packChildren,
  ROOT_RADIUS,
  FILL,
  PAD,
} from '../../src/components/universe/layout.ts';
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
