/** SOURCE-ONLY: reads source text, no build or DB required. Roadmap 1.6 (RFC 9727 API catalog). */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import nodePath from 'node:path';

const rootDir=fileURLToPath(new URL('../../',import.meta.url));
const path=(...p)=>nodePath.join(rootDir,...p);
const read=p=>readFileSync(path(p),'utf8');

const ROUTE_PATH='src/app/.well-known/api-catalog/route.ts';

test('the route file exists at the well-known api-catalog path',()=>{
 assert.ok(existsSync(path(ROUTE_PATH)),`${ROUTE_PATH} is missing`);
});

const route=read(ROUTE_PATH);

test('the route emits application/linkset+json and answers GET and HEAD',()=>{
 assert.match(route,/CONTENT_TYPE\s*=\s*'application\/linkset\+json'/);
 assert.match(route,/'content-type':CONTENT_TYPE/);
 assert.match(route,/export async function GET\(/);
 assert.match(route,/export async function HEAD\(/);
});

test('the route sets a public, one-hour cache-control header',()=>{
 assert.match(route,/CACHE_CONTROL\s*=\s*'public, max-age=3600'/);
});

test('every href in the catalog is built from the resolved origin, never a bare relative string',()=>{
 const hrefs=[...route.matchAll(/href:(`[^`]*`|'[^']*'|"[^"]*")/g)].map(m=>m[1]);
 assert.ok(hrefs.length>=5,`expected at least 5 href entries, found ${hrefs.length}`);
 for(const href of hrefs)assert.match(href,/^`\$\{origin\}\//,`href ${href} is not an absolute \${origin}-prefixed template literal`);
});

test('the catalog carries every required link relation and target of roadmap 1.6', () => {
 assert.match(route,/anchor:`\$\{origin\}\/api\/v2\/`/);
 assert.match(route,/'service-desc':\[/);
 assert.match(route,/\$\{origin\}\/agent\/api-routes\.json`,type:'application\/json'/);
 assert.match(route,/'service-doc':\[/);
 assert.match(route,/\$\{origin\}\/skill\.md`,type:'text\/markdown'/);
 assert.match(route,/\$\{origin\}\/llms\.txt`,type:'text\/plain'/);
 assert.match(route,/status:\[/);
 assert.match(route,/\$\{origin\}\/api\/v2\/health`/);
 assert.match(route,/'service-meta':\[/);
 assert.match(route,/\$\{origin\}\/api\/v2\/capabilities`/);
});

test('the route notes that openapi.json is added here once roadmap 1.6 OpenAPI (D10) lands',()=>{
 assert.match(route,/openapi\.json is added here once roadmap 1\.6/);
});

test('the route resolves origin with the shared *.vercel.app collapse, not its own copy',()=>{
 assert.match(route,/import\s*\{publicOrigin\}\s*from\s*'\.\.\/\.\.\/\.\.\/server\/service\/claimreview'/);
 assert.match(route,/publicOrigin\(new URL\(request\.url\)\.origin\)/);
 assert.doesNotMatch(route,/CANONICAL_ORIGIN/);
});

test('the route builds the catalog from fixed constants, never ROUTES or a request-time file read',()=>{
 assert.doesNotMatch(route,/from '\.\.\/\.\.\/\.\.\/server\/service\/routes'/);
 assert.doesNotMatch(route,/readFile/);
});

test('the capabilities handler links to the catalog with an RFC 9727 api-catalog Link header',()=>{
 const system=read('src/server/service/handlers/system.ts');
 assert.match(system,/Link',\s*'<\/\.well-known\/api-catalog>;\s*rel="api-catalog"'/);
});

test('llms.txt links the api-catalog under Agent entry',()=>{
 const llms=read('public/llms.txt');
 const agentSection=llms.slice(llms.indexOf('## Agent entry'),llms.indexOf('## Human entry'));
 assert.match(agentSection,/\[API catalog \(RFC 9727 linkset\)\]\(https:\/\/morum\.vercel\.app\/\.well-known\/api-catalog\)/);
});

test('skill.md names the api-catalog as a discovery point among the entry points',()=>{
 const skill=read('public/skill.md');
 assert.match(skill,/\/\.well-known\/api-catalog/);
 assert.match(skill,/RFC 9727/);
});
