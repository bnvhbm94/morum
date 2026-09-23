import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../../src/components/spatial-explorer.tsx', import.meta.url), 'utf8');
const data = await readFile(new URL('../../src/lib/spatial-data.ts', import.meta.url), 'utf8');
const page = await readFile(new URL('../../src/app/page.tsx', import.meta.url), 'utf8');
const styles = await readFile(new URL('../../src/app/globals.css', import.meta.url), 'utf8');

test('home mounts the real-data galaxy explorer without a mock document collection', () => {
  assert.match(page, /<SpatialExplorer\s*\/>/);
  assert.match(source, /loadSpatialHome/);
  assert.match(source, /loadSpatialSearch/);
  assert.doesNotMatch(source, /mockDocuments|demoDocuments|const\s+documents\s*=\s*\[/i);
  assert.match(source, /groupGalaxies\(/);
  assert.match(source, /placeGalaxy\(/);
  assert.match(source, /className="spatial-dock" data-hidden=/);
  assert.match(styles, /\.spatial-dock\[data-hidden="true"\]/);
  assert.doesNotMatch(styles, /\.spatial-search::before/);
  assert.match(styles, /@font-face[^}]*url\("\/fonts\/PretendardVariable\.woff2"\)/s);
});

test('galaxies come from the declared topic attribute and placement from declared relations only', () => {
  assert.match(data, /export function groupGalaxies\(/);
  assert.match(data, /'미분류'/);
  assert.match(data, /duplicate_of/);
  assert.match(data, /filter\(node => !node\.duplicateOf\)/);
  assert.match(data, /export function placeGalaxy\(/);
  assert.match(data, /layoutNodes\(members, edges, spiral\)/);
  assert.match(data, /layoutEdges\(relations, /);
  assert.match(source, /topic 없음/);
  assert.match(styles, /\.spatial-node\[data-dim="true"\]/);
  assert.match(styles, /\.spatial-node\[data-foreign="true"\]/);
  assert.doesNotMatch(source, /최근순|관련도순|관계 \d/);
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

test('camera uses one translated world and CSS includes mobile and reduced-motion rules', () => {
  assert.match(source, /worldRef\.current\.style\.transform = `translate3d/);
  assert.doesNotMatch(source, /setCamera/);
  assert.match(styles, /\.spatial-world[^}]*will-change:\s*transform/s);
  assert.match(styles, /@media \(max-width:\s*850px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)/);
});

test('the planet keeps explicit relation semantics, satellites and full context routes', () => {
  for (const label of ['지지', '정정', '의존', '파생', '반론', '같은 의미', '번역']) assert.match(source, new RegExp(label));
  assert.match(source, /고정 링크와 전체 맥락/);
  assert.match(source, /\/history/);
  assert.match(source, /loadSpatialHistory\(/);
  assert.match(source, /className="spatial-satellite"/);
  assert.match(source, /history\.pushState|history\.replaceState/);
  assert.match(source, /popstate/);
  assert.match(styles, /\.spatial-planet[^}]*user-select:\s*text/s);
  assert.match(styles, /\.spatial-planet[^}]*overflow-y:\s*auto/s);
  assert.match(data, /export async function loadSpatialCitations\(/);
  assert.match(data, /anchorMatches/);
  assert.match(source, /className="spatial-cite"/);
  assert.match(source, /인용문 없음/);
  assert.match(source, /문서 전체/);
});
