/** Pre-publication security invariants (Roadmap 1.10). SOURCE-ONLY checks, no database. */
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import nodePath from 'node:path';

const rootDir=fileURLToPath(new URL('../../',import.meta.url));
const path=(...p)=>nodePath.join(rootDir,...p);
const read=p=>readFileSync(path(p),'utf8');

function walk(dir,exts){
 const base=path(dir);
 if(!existsSync(base))return [];
 const out=[];
 const rec=d=>{
  for(const entry of readdirSync(d,{withFileTypes:true})){
   const full=nodePath.join(d,entry.name);
   if(entry.isDirectory())rec(full);
   else if(exts.some(e=>entry.name.endsWith(e)))out.push(full);
  }
 };
 rec(base);
 return out;
}

test('no Supabase secret patterns ship to the browser',()=>{
 const secretPatterns=[/SUPABASE_SECRET_KEY/,/SUPABASE_SERVICE_ROLE_KEY/,/sb_secret_/,/service_role/,/eyJ[A-Za-z0-9_-]{20,}/];
 const dirs=['src/app','src/components','src/lib','public'];
 const offenders=[];
 for(const dir of dirs){
  for(const file of walk(dir,['.ts','.tsx','.js','.jsx','.mjs','.json','.html'])){
   const text=readFileSync(file,'utf8');
   for(const pattern of secretPatterns){
    if(pattern.test(text))offenders.push(`${file}: matches ${pattern}`);
   }
  }
 }
 assert.deepEqual(offenders,[],`Potential secret material shipped to the browser: ${offenders.join('; ')}`);
});

test('src/lib and src/components never read process.env directly (not even NEXT_PUBLIC_ names)',()=>{
 const envPattern=/\bprocess\.env\.([A-Z0-9_]+)/g;
 const offenders=[];
 for(const dir of ['src/lib','src/components']){
  for(const file of walk(dir,['.ts','.tsx','.js','.jsx','.mjs'])){
   const text=readFileSync(file,'utf8');
   for(const match of text.matchAll(envPattern))if(match[1]!=='NODE_ENV')offenders.push(`${file}: process.env.${match[1]}`);
  }
 }
 assert.deepEqual(offenders,[],`src/lib or src/components read process.env directly: ${offenders.join('; ')}`);
});

test('any client-side env var reference elsewhere uses only the NEXT_PUBLIC_ prefix',()=>{
 const envPattern=/\bprocess\.env\.([A-Z0-9_]+)/g;
 const offenders=[];
 for(const file of walk('src/app',['.ts','.tsx','.js','.jsx','.mjs'])){
  const text=readFileSync(file,'utf8');
  if(/^['"]use client['"];?/m.test(text)){
   for(const match of text.matchAll(envPattern))if(!match[1].startsWith('NEXT_PUBLIC_'))offenders.push(`${file}: process.env.${match[1]}`);
  }
 }
 assert.deepEqual(offenders,[],`Client component reads a non-NEXT_PUBLIC_ env var: ${offenders.join('; ')}`);
});

test("Morum's browser never talks to Supabase directly (spatial-data.ts only calls the app's own API client)",()=>{
 const text=read('src/lib/spatial-data.ts');
 assert.doesNotMatch(text,/supabase/i,'src/lib/spatial-data.ts references Supabase directly');
 assert.match(text,/api-client/,'src/lib/spatial-data.ts does not route through the app API client');
});

test('src/server/db/client.ts is the sole owner of the Supabase secret key',()=>{
 const text=read('src/server/db/client.ts');
 assert.match(text,/^import 'server-only';/,'src/server/db/client.ts must start with import \'server-only\'');
 assert.match(text,/SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY/);
});

test("every src/server file that imports the DB client starts with import 'server-only'",()=>{
 const dbFiles=walk('src/server/db',['.ts']);
 const serviceFiles=walk('src/server/service',['.ts']);
 const importsDbClient=file=>{
  const text=readFileSync(file,'utf8');
  return /from ['"]\.\.\/db\/|from ['"]\.\/(?:client|index|knowledge-repository|cursor)\.js['"]|SupabaseRpcClient|KnowledgeRepository/.test(text);
 };
 const mustHaveServerOnly=[...dbFiles,...serviceFiles.filter(importsDbClient)];
 assert.ok(mustHaveServerOnly.length>0,'No src/server files importing the DB client were found');
 const offenders=[];
 for(const file of mustHaveServerOnly){
  const text=readFileSync(file,'utf8');
  if(!/^import 'server-only';/.test(text))offenders.push(file);
 }
 assert.deepEqual(offenders,[],`Files importing the DB client without a leading import 'server-only': ${offenders.join(', ')}`);
});

test('.env.example exists and contains no real-looking secret values',()=>{
 assert.ok(existsSync(path('.env.example')),'.env.example is missing');
 const text=read('.env.example');
 assert.doesNotMatch(text,/sb_secret_/,'.env.example contains a real-looking Supabase secret key prefix');
 assert.doesNotMatch(text,/eyJ[A-Za-z0-9_-]{20,}/,'.env.example contains a JWT-looking string');
});

test('.gitignore ignores local/private artifacts',()=>{
 const text=read('.gitignore');
 const lines=text.split('\n').map(l=>l.trim()).filter(Boolean).filter(l=>!l.startsWith('#'));
 // A line ignores a target if it names it exactly, or is a `.env*`-style prefix glob that covers it.
 const covers=target=>lines.some(line=>{
  if(line===target)return true;
  if(line.endsWith('*')&&!line.startsWith('!')){const prefix=line.slice(0,-1);if(target.startsWith(prefix))return true;}
  return false;
 });
 const required=['.env','.env.local','.vercel'];
 const missing=required.filter(entry=>!covers(entry));
 assert.deepEqual(missing,[],`.gitignore does not cover required entries: ${missing.join(', ')}`);
 // Reported, not fixed here: another session owns .gitignore edits for these entries.
 const optional=['MY THOUGHT/','.claude/','.DS_Store'];
 const missingOptional=optional.filter(entry=>!covers(entry));
 if(missingOptional.length)console.log(JSON.stringify({scope:'security_invariants_static',note:'.gitignore missing entries (not auto-fixed; owned by the planning session)',missing:missingOptional}));
});

test('no tracked file matches .env* except .env.example',()=>{
 const tracked=execFileSync('git',['ls-files'],{cwd:new URL('../../',import.meta.url),encoding:'utf8'}).split('\n').filter(Boolean);
 const offenders=tracked.filter(f=>/(^|\/)\.env[^/]*$/.test(f)&&!f.endsWith('.env.example'));
 assert.deepEqual(offenders,[],`Tracked env-like files other than .env.example: ${offenders.join(', ')}`);
});
