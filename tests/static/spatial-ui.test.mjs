import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../../src/components/spatial-explorer.tsx', import.meta.url), 'utf8');
const page = await readFile(new URL('../../src/app/page.tsx', import.meta.url), 'utf8');
const styles = await readFile(new URL('../../src/app/globals.css', import.meta.url), 'utf8');

test('home mounts the real-data spatial explorer without a mock document collection', () => {
  assert.match(page, /<SpatialExplorer\s*\/>/);
  assert.match(source, /loadSpatialHome/);
  assert.match(source, /loadSpatialSearch/);
  assert.doesNotMatch(source, /mockDocuments|demoDocuments|const\s+documents\s*=\s*\[/i);
});

test('spatial input guards drag clicks and stale or superseded requests', () => {
  assert.match(source, /DRAG_THRESHOLD/);
  assert.match(source, /suppressClickRef/);
  assert.match(source, /onPointerCancel/);
  assert.match(source, /setPointerCapture/);
  assert.match(source, /generation\s*!==\s*generationRef\.current/);
  assert.match(source, /pageRequestRef\.current\?\.abort/);
  assert.match(source, /event\.isComposing/);
});

test('camera uses one translated world and CSS includes mobile and reduced-motion readers', () => {
  assert.match(source, /worldRef\.current\.style\.transform = `translate3d/);
  assert.doesNotMatch(source, /setCamera/);
  assert.match(styles, /\.spatial-world[^}]*will-change:\s*transform/s);
  assert.match(styles, /@media \(max-width:\s*850px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)/);
});

test('reader keeps explicit relation semantics and full context routes available', () => {
  for (const label of ['지지', '정정', '의존', '파생', '반론', '같은 의미', '번역']) assert.match(source, new RegExp(label));
  assert.match(source, /고정 링크와 전체 맥락/);
  assert.match(source, /\/history/);
  assert.match(source, /slice\(0, 4\)/);
});
