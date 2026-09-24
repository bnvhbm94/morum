import test from 'node:test';
import assert from 'node:assert/strict';
import {placeStableLabels, stableAnchorBox, labelZoomBucket, labelBucketScale, LABEL_ZOOM_BUCKET_RATIO} from '../../src/components/universe/labels.ts';

// Item 8: a synthetic star with 30 planets, laid out the way universe.tsx does it (world positions, label
// sizes at the zoom bucket's scale). Panning never enters the inputs; zooming inside a bucket does not either.
const STAR = {x: 1000, y: -400, r: 100};
function planets() {
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  return Array.from({length: 30}, (_, i) => {
    const angle = rand() * Math.PI * 2, dist = 0.25 + rand() * 0.7;
    return {id: `star::p${i}`, dotId: `p${i}`, x: STAR.x + Math.cos(angle) * STAR.r * dist, y: STAR.y + Math.sin(angle) * STAR.r * dist, chars: 4 + (i % 9), titled: i % 3 !== 0};
  });
}
const PLANETS = planets();
const GAPS = {axisGap: 13, diagGap: 12, pad: 10, dotPx: 3};

function inputs(camera) {
  const scale = labelBucketScale(labelZoomBucket(camera.scale));
  const starPx = STAR.r * scale;
  const font = Math.max(11, Math.min(18, starPx * 0.04));
  const line = Math.round(font * 1.35);
  const stars = [{id: 'star', order: STAR.r,
    dots: PLANETS.map(p => ({id: p.dotId, x: p.x, y: p.y})),
    labels: PLANETS.map(p => ({id: p.id, dotId: p.dotId, x: p.x, y: p.y, width: Math.min(p.chars * font, 192), height: line, priority: p.titled ? 10 : 0}))}];
  return {stars, scale};
}
function place(camera, prev) {
  const {stars, scale} = inputs(camera);
  return placeStableLabels(stars, scale, {...GAPS, prev});
}

test('stable labels: panning the camera by 300px changes no anchor', () => {
  const camera = {x: STAR.x, y: STAR.y, scale: 6};
  const before = place(camera);
  assert.ok(before.size >= 10, `expected a populated field, got ${before.size}`);
  const panned = {...camera, x: camera.x + 300 / camera.scale, y: camera.y - 300 / camera.scale};
  assert.deepEqual([...place(panned, before)], [...before]);
  // Even without the sticky previous state, pan alone yields the same anchors.
  assert.deepEqual([...place(panned)], [...before]);
});

test('stable labels: zooming inside one bucket changes no anchor', () => {
  const bucket = labelZoomBucket(6);
  const low = labelBucketScale(bucket) * 1.01, high = labelBucketScale(bucket) * LABEL_ZOOM_BUCKET_RATIO * 0.99;
  assert.equal(labelZoomBucket(low), labelZoomBucket(high));
  const before = place({x: STAR.x, y: STAR.y, scale: low});
  assert.deepEqual([...place({x: STAR.x, y: STAR.y, scale: high}, before)], [...before]);
});

test('stable labels: zooming across a bucket moves only labels whose old spot now collides', () => {
  for (const factor of [1 / LABEL_ZOOM_BUCKET_RATIO, LABEL_ZOOM_BUCKET_RATIO]) {
    const from = {x: STAR.x, y: STAR.y, scale: 6};
    const to = {...from, scale: 6 * factor};
    assert.notEqual(labelZoomBucket(from.scale), labelZoomBucket(to.scale));
    const before = place(from);
    const after = place(to, before);
    const {stars, scale} = inputs(to);
    const labels = new Map(stars[0].labels.map(l => [l.id, l]));
    // Boxes of the labels that kept their anchor, in the new layout.
    const kept = [...after].filter(([id, a]) => before.get(id) === a).map(([id, a]) => ({id, ...stableAnchorBox(labels.get(id), a, scale, GAPS.axisGap, GAPS.diagGap)}));
    for (const [id, anchor] of before) {
      if (after.get(id) === anchor) continue;
      // It moved (or hid): its old spot must now overlap a kept label or cover another planet's dot.
      const old = stableAnchorBox(labels.get(id), anchor, scale, GAPS.axisGap, GAPS.diagGap);
      const hitsLabel = kept.some(k => k.id !== id && Math.abs(k.x - old.x) * 2 < k.width + old.width + GAPS.pad && Math.abs(k.y - old.y) * 2 < k.height + old.height + GAPS.pad);
      const hitsDot = stars[0].dots.some(d => d.id !== labels.get(id).dotId && Math.abs(d.x * scale - old.x) * 2 < old.width + GAPS.dotPx * 2 + 6 && Math.abs(d.y * scale - old.y) * 2 < old.height + GAPS.dotPx * 2 + 6);
      assert.ok(hitsLabel || hitsDot, `${id} moved from ${anchor} although its spot was still free`);
    }
  }
});

test('stable labels: a newly appearing label never displaces an existing one', () => {
  const camera = {x: STAR.x, y: STAR.y, scale: 6};
  const {stars, scale} = inputs(camera);
  const first = placeStableLabels([{...stars[0], labels: stars[0].labels.slice(0, 20)}], scale, GAPS);
  // The newcomers get the highest priority, yet everyone already placed keeps their anchor.
  const boosted = stars[0].labels.map((l, i) => (i >= 20 ? {...l, priority: 1e5} : l));
  const second = placeStableLabels([{...stars[0], labels: boosted}], scale, {...GAPS, prev: first});
  for (const [id, anchor] of first) assert.equal(second.get(id), anchor, id);
});
