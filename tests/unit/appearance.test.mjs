import test from 'node:test';
import assert from 'node:assert/strict';
import {HUES, TEXTURES, HUE_HEX, parseAppearance, hueHex} from '../../src/components/universe/appearance.ts';

// OKLCH → sRGB, just enough to check the fixed-lightness rule without pulling in a colour library.
function oklchLFromHex(hex) {
  const n = parseInt(hex.slice(1), 16);
  const srgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => c / 255);
  const linear = srgb.map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const [r, g, b] = linear;
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
}

test('every hue (default included) sits at the same fixed OKLCH lightness, ~0.90', () => {
  for (const hue of HUES) {
    const l = oklchLFromHex(HUE_HEX[hue]);
    assert.ok(Math.abs(l - 0.90) < 0.01, `${hue} (${HUE_HEX[hue]}) has L=${l.toFixed(3)}, expected ~0.90`);
  }
});

test('hueHex returns the palette table entry for each named hue', () => {
  assert.equal(hueHex('none'), '#dfdbea');
  assert.equal(hueHex('lilac'), '#e2d8fc');
  assert.equal(hueHex('rose'), '#f9d1e3');
  assert.equal(hueHex('sand'), '#f2daba');
  assert.equal(hueHex('teal'), '#b8e9e8');
  assert.equal(hueHex('sky'), '#c6e1ff');
});

test('parseAppearance reads a well-formed attributes.appearance', () => {
  assert.deepEqual(parseAppearance({appearance: {hue: 'teal', texture: 'grain'}}), {hue: 'teal', texture: 'grain', present: true});
  assert.deepEqual(parseAppearance({appearance: {hue: 'sand', texture: 'bands'}}), {hue: 'sand', texture: 'bands', present: true});
});

test('parseAppearance falls back to the default for anything outside the fixed vocabulary, without rejecting it', () => {
  // Unknown hue, known texture: only the bad field falls back, appearance still counts as present.
  assert.deepEqual(parseAppearance({appearance: {hue: 'crimson', texture: 'grain'}}), {hue: 'none', texture: 'grain', present: true});
  // hex instead of a name is rejected the same way (names only, never hex — B §5).
  assert.deepEqual(parseAppearance({appearance: {hue: '#ff0000', texture: 'smooth'}}), {hue: 'none', texture: 'smooth', present: true});
  // Wrong casing does not loosely match.
  assert.deepEqual(parseAppearance({appearance: {hue: 'Teal'}}), {hue: 'none', texture: 'smooth', present: true});
});

test('parseAppearance treats a missing or malformed appearance as absent, not merely default-valued', () => {
  assert.deepEqual(parseAppearance(null), {hue: 'none', texture: 'smooth', present: false});
  assert.deepEqual(parseAppearance(undefined), {hue: 'none', texture: 'smooth', present: false});
  assert.deepEqual(parseAppearance({}), {hue: 'none', texture: 'smooth', present: false});
  assert.deepEqual(parseAppearance({appearance: 'teal'}), {hue: 'none', texture: 'smooth', present: false});
  assert.deepEqual(parseAppearance({appearance: null}), {hue: 'none', texture: 'smooth', present: false});
  assert.deepEqual(parseAppearance({appearance: ['teal']}), {hue: 'none', texture: 'smooth', present: false});
});

test('the fixed vocabulary matches what skill.md documents', () => {
  assert.deepEqual([...HUES], ['none', 'lilac', 'rose', 'sand', 'teal', 'sky']);
  assert.deepEqual([...TEXTURES], ['smooth', 'grain', 'bands']);
});
