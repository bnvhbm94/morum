import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, access} from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const text = path => readFile(new URL(path, root), 'utf8');

test('Stage05 exposes the required read-only page routes', async () => {
  for (const path of [
    'src/app/page.tsx',
    'src/app/universe/page.tsx',
    'src/app/search/page.tsx',
    'src/app/records/[recordId]/page.tsx',
    'src/app/records/[recordId]/history/page.tsx',
    'src/app/versions/[versionId]/page.tsx',
    'src/app/versions/[versionId]/raw/route.ts',
    'src/app/objects/[kind]/[id]/page.tsx',
    'src/app/sources/[sourceId]/page.tsx',
  ]) await access(new URL(path, root));
});

test('legacy record and search addresses redirect instead of rendering their own screen', async () => {
  const records = await text('src/app/records/[recordId]/page.tsx');
  const search = await text('src/app/search/page.tsx');
  const universe = await text('src/app/universe/page.tsx');
  assert.match(records, /redirect\(/);
  assert.doesNotMatch(records, /permanentRedirect\(/); // the current version changes over time: 307, not 308
  assert.match(search, /permanentRedirect\(/);
  assert.match(universe, /permanentRedirect\(/);
});

test('the universe and object reader treat stored bodies as text and offer no browser editor or login', async () => {
  const universeSource = await text('src/components/universe/universe.tsx');
  const objectReader = await text('src/components/object-reader.tsx');
  assert.doesNotMatch(universeSource + objectReader, /dangerouslySetInnerHTML|contentEditable|type="password"|로그인|가입/);
});

test('top controls are bounded to search and agent instructions and deactivate below top', async () => {
  const shell = await text('src/components/reading-shell.tsx');
  assert.match(shell, /window\.scrollY <= 24/);
  assert.match(shell, /disabled=\{!atTop\}/);
  assert.match(shell, />검색</);
  assert.match(shell, />에이전트 안내</);
  assert.doesNotMatch(shell, /fixed|sticky|progress/i);
});

test('third-party notices keep the ReactBits license', async () => {
  assert.match(await text('THIRD_PARTY_NOTICES.md'), /MIT \+ Commons Clause/);
});

test('reading styles use the universe background and a narrow, left-aligned responsive column', async () => {
  const css = await text('src/app/globals.css');
  assert.match(css, /html, body \{ background: #0c0910; \}/);
  assert.match(css, /width: min\(100% - 3rem, 45rem\)/);
  assert.match(css, /width: calc\(100% - 2\.5rem\)/);
  assert.doesNotMatch(css, /text-align:\s*justify|gradient|position:\s*sticky/);
});

test('the universe is the only chrome shown at / and at document permalinks; legacy readers stay plain', () => {
  const shellPromise = text('src/components/reading-shell.tsx');
  return shellPromise.then(shell => {
    assert.match(shell, /immersive = pathname === '\/' \|\| pathname === '\/universe' \|\| pathname\.startsWith\('\/versions\/'\)/);
    assert.doesNotMatch(shell, /ServiceIntroduction|service-introduction/);
  });
});

test('the three kept legacy reading pages link back into the universe instead of duplicating its chrome', async () => {
  const history = await text('src/app/records/[recordId]/history/page.tsx');
  const source = await text('src/app/sources/[sourceId]/page.tsx');
  const object = await text('src/app/objects/[kind]/[id]/page.tsx');
  for (const page of [history, source, object]) assert.match(page, /className="universe-back-link"/);
  assert.match(history, /doc=\$\{encodeURIComponent\(versionId\)\}/);
  assert.match(object, /doc=\$\{encodeURIComponent\(id\)\}/);
  const css = await text('src/app/globals.css');
  assert.match(css, /\.universe-back-link/);
});

test('legacy card styling has no border, shadow or arrow decoration', async () => {
  const css = await text('src/app/globals.css');
  assert.match(css, /\.content-item, \.content-item-featured \{ margin: 0; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; \}/);
  assert.match(css, /\.card-arrow, \.home-hero, \.section-heading \{ display: none; \}/);
});

test('the reader links basis and related documents to public reading routes, not raw API URLs', async () => {
  const reader = await text('src/components/universe/reader.tsx');
  assert.match(reader, /\/versions\/\$\{encodeURIComponent\(/);
  assert.match(reader, /\/sources\/\$\{encodeURIComponent\(/);
});
