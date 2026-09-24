import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const universePage = await readFile(new URL('../../src/app/universe/page.tsx', import.meta.url), 'utf8');
const homePage = await readFile(new URL('../../src/app/page.tsx', import.meta.url), 'utf8');
const versionPage = await readFile(new URL('../../src/app/versions/[versionId]/page.tsx', import.meta.url), 'utf8');
const source = await readFile(new URL('../../src/components/universe/universe.tsx', import.meta.url), 'utf8');
const starfield = await readFile(new URL('../../src/components/universe/starfield.ts', import.meta.url), 'utf8');
const styles = await readFile(new URL('../../src/components/universe/universe.css', import.meta.url), 'utf8');
const reader = await readFile(new URL('../../src/components/universe/reader.tsx', import.meta.url), 'utf8');

test('the universe renders at / and stays reachable at the legacy /universe and /versions/:id addresses', () => {
  assert.match(homePage, /<Universe\s*\/>/);
  assert.match(source, /^'use client';/);
  assert.match(universePage, /permanentRedirect\(/);
  assert.match(versionPage, /<Universe initialDoc=\{versionId\}\s*\/>/);
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
  for (const text of [source, starfield, reader]) {
    assert.doesNotMatch(text, /\bthree\b/i);
    assert.doesNotMatch(text, /webgl/i);
    assert.doesNotMatch(text, /getContext\(\s*['"]webgl/i);
  }
});

test('universe.css draws nodes without borders, connecting lines or wide dark scrims', () => {
  const declarations = styles.match(/border\s*:[^;]+;/g) || [];
  for (const declaration of declarations) {
    assert.match(declaration, /^border:\s*0;$/, `unexpected border declaration: ${declaration}`);
  }
  // The only stroke allowed is the label halo's text outline (item 4: replaces a 10-layer text-shadow).
  assert.doesNotMatch(styles.replace(/-webkit-text-stroke:\s*2px #0c0910;/g, '').replace(/paint-order:\s*stroke fill;/g, ''), /\bstroke\b/);
  assert.doesNotMatch(styles, /linear-gradient|radial-gradient/);
  assert.doesNotMatch(source, /ctx\.(lineTo|stroke)\(/);
});

test('bodies are told apart by role and a document opens in place, not on another page', () => {
  assert.match(source, /bodyKind/);
  assert.match(source, /placeOrbits/);
  assert.match(source, /resolveLabels/);
  assert.match(source, /<UniverseReader/);
  assert.doesNotMatch(source, /window\.location\.assign\(`\/\?/);
  assert.match(reader, /role: 'planet' \| 'star'/);
  assert.match(reader, /star-missing/);
  assert.match(reader, /아직 이 항성의 설명 문서가 없다/);
  assert.match(reader, /stepReadingParagraph\(/);
  assert.match(styles, /::highlight\(reading-paragraph\)/);
  assert.match(styles, /\.universe-item\[data-related\]/);
  assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)/);
});

test('grouping comes only from the declared source, never invented similarity placement', () => {
  assert.doesNotMatch(source, /mockDocuments|demoDocuments|similarity|clusterBy/i);
});

test('/search redirects into the universe with ?q=, and the universe fills and runs it on mount', () => {
  const searchPage = readFile(new URL('../../src/app/search/page.tsx', import.meta.url), 'utf8');
  return searchPage.then(text => {
    assert.match(text, /permanentRedirect\(/);
    assert.match(text, /\/\?q=\$\{encodeURIComponent\(query\)\}/);
  }).then(() => {
    assert.match(source, /initialQuery = params\.get\('q'\)/);
    assert.match(source, /void runSearch\(initialQuery\)/);
  });
});

test('/versions/:id folds the path id in as if it were ?doc=, so the universe opens the same document', () => {
  assert.match(source, /initialDoc\?:\s*string/);
  assert.match(source, /params\.set\('doc',\s*initialDoc\)/);
});

test('while the reader is open, Left/Right step to the adjacent planet instead of panning the field', () => {
  assert.match(source, /function stepReaderDoc\(/);
  assert.match(source, /event\.key === 'ArrowLeft' \|\| event\.key === 'ArrowRight'.*stepReaderDoc\(/);
  // The star's placement order is by id, the same order placeOrbits itself sorts planets by.
  assert.match(source, /a\.item\.id < b\.item\.id \? -1 : a\.item\.id > b\.item\.id \? 1 : 0/);
});

test('A1: while the camera is moving, data-moving is set on the root and CSS disables item/label/reticle transitions', () => {
  assert.match(source, /rootElRef\.current\?\.setAttribute\('data-moving'/);
  assert.match(source, /data-moving="false"/);
  assert.match(styles, /\.universe-root\[data-moving="true"\][^{]*\.universe-item-title[^{]*\{[^}]*transition:\s*none/s);
  assert.match(styles, /\.universe-root\[data-moving="true"\][^{]*\.universe-category-label/);
  assert.match(styles, /\.universe-root\[data-moving="true"\][^{]*\.universe-reticle/);
});

test('A1: label anchors/visibility are frozen during motion and only changed labels get the fade marker', () => {
  assert.match(source, /resolveMotionLabels\(movingRef\.current/);
  assert.match(source, /dataset\.labelChanged/);
  assert.match(styles, /data-label-changed="true"/);
  assert.match(styles, /universe-label-fade-in/);
});
