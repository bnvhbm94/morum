import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const page = await readFile(new URL('../../src/app/universe/page.tsx', import.meta.url), 'utf8');
const source = await readFile(new URL('../../src/components/universe/universe.tsx', import.meta.url), 'utf8');
const starfield = await readFile(new URL('../../src/components/universe/starfield.ts', import.meta.url), 'utf8');
const styles = await readFile(new URL('../../src/components/universe/universe.css', import.meta.url), 'utf8');

test('the /universe page renders the client explorer', () => {
  assert.match(page, /<Universe\s*\/>/);
  assert.match(source, /^'use client';/);
});

test('universe.tsx is wired to the provided geometry, LOD and data modules', () => {
  assert.match(source, /createTopicSource/);
  assert.match(source, /packChildren/);
  assert.match(source, /pickFetchTargets/);
  assert.match(source, /zoomAt/);
  assert.match(source, /interpolate/);
});

test('input robustness patterns copied from spatial-explorer are present', () => {
  assert.match(source, /isComposing/);
  assert.match(source, /setPointerCapture/);
  assert.match(source, /AbortController/);
  assert.match(source, /prefers-reduced-motion/);
  assert.match(source, /passive:\s*false/);
});

test('no WebGL or three.js: canvas 2D and DOM/CSS only', () => {
  for (const text of [source, starfield]) {
    assert.doesNotMatch(text, /\bthree\b/i);
    assert.doesNotMatch(text, /webgl/i);
    assert.doesNotMatch(text, /getContext\(\s*['"]webgl/i);
  }
});

test('universe.css draws nodes without borders or connecting lines', () => {
  const declarations = styles.match(/border\s*:[^;]+;/g) || [];
  for (const declaration of declarations) {
    assert.match(declaration, /^border:\s*0;$/, `unexpected border declaration: ${declaration}`);
  }
  assert.doesNotMatch(styles, /\bstroke\b/);
});

test('grouping comes only from the declared source, never invented similarity placement', () => {
  assert.doesNotMatch(source, /mockDocuments|demoDocuments|similarity|clusterBy/i);
});
