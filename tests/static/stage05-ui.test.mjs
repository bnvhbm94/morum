import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, access} from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const text = path => readFile(new URL(path, root), 'utf8');

test('Stage05 exposes the required read-only page routes', async () => {
  for (const path of [
    'src/app/search/page.tsx',
    'src/app/records/[recordId]/page.tsx',
    'src/app/records/[recordId]/history/page.tsx',
    'src/app/versions/[versionId]/page.tsx',
    'src/app/objects/[kind]/[id]/page.tsx',
    'src/app/sources/[sourceId]/page.tsx',
  ]) await access(new URL(path, root));
});

test('reader treats stored bodies as text and offers no browser editor or login', async () => {
  const reader = await text('src/components/version-reader.tsx');
  const shell = await text('src/components/reading-shell.tsx');
  assert.match(reader, /className="raw-text">\{version\.body_text\}/);
  assert.doesNotMatch(reader + shell, /dangerouslySetInnerHTML|contentEditable|type="password"|로그인|가입/);
});

test('top controls are bounded to search and agent instructions and deactivate below top', async () => {
  const shell = await text('src/components/reading-shell.tsx');
  assert.match(shell, /window\.scrollY <= 24/);
  assert.match(shell, /disabled=\{!atTop\}/);
  assert.match(shell, />검색</);
  assert.match(shell, />에이전트 안내</);
  assert.doesNotMatch(shell, /fixed|sticky|progress/i);
});

test('Magnet is source-attributed, clamped and respects pointer and motion preferences', async () => {
  const magnet = await text('src/components/magnet.tsx');
  const notices = await text('THIRD_PARTY_NOTICES.md');
  assert.match(magnet, /reactbits\.dev\/r\/Magnet-TS-CSS\.json/);
  assert.match(magnet, /maxTravel = 1\.6/);
  assert.match(magnet, /pointer: fine/);
  assert.match(magnet, /prefers-reduced-motion/);
  assert.match(notices, /MIT \+ Commons Clause/);
});

test('reading styles keep a black, narrow, left-aligned responsive column', async () => {
  const css = await text('src/app/globals.css');
  assert.match(css, /--paper: #000/);
  assert.match(css, /width: min\(100% - 3rem, 45rem\)/);
  assert.match(css, /width: calc\(100% - 2\.5rem\)/);
  assert.doesNotMatch(css, /text-align:\s*justify|gradient|position:\s*sticky/);
});

test('home has one visible Morum heading and Enter-first search without a submit button', async () => {
  const shell = await text('src/components/reading-shell.tsx');
  const page = await text('src/app/page.tsx');
  assert.match(shell, /<h1 className="brand">Morum<\/h1>/);
  assert.match(shell, /placeholder="Search knowledge"/);
  assert.doesNotMatch(page, /<h1|page-intro/);
  const homeForm = shell.match(/<form className="home-search"[\s\S]*?<\/form>/)?.[0] || '';
  assert.doesNotMatch(homeForm, /<button/);
});

test('search maps object hits to public reading routes rather than raw API URLs', async () => {
  const search = await text('src/components/search-results.tsx');
  assert.match(search, /function resultHref/);
  assert.match(search, /refHref\(hit\.locator\.target\)/);
  assert.doesNotMatch(search, /hit\.links\.source \|\| hit\.links\.part/);
});
