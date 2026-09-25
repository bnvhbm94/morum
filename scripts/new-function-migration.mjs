#!/usr/bin/env node
/** Generates a migration (and its paired rollback) that re-creates one
 * canonical function from supabase/functions/. This is the write half of
 * roadmap 1.7's "edit one place" workflow: a change edits the canonical
 * .sql file, then this script emits the migration + rollback pair instead
 * of a human re-copying the function body by hand.
 *
 * Usage:
 *   node scripts/new-function-migration.mjs <function-file> <slug>
 *
 * <function-file>  a filename (or path) under supabase/functions/, e.g.
 *                   kb_dossier.sql or supabase/functions/kb_dossier.sql
 * <slug>           short kebab-case description, becomes both the
 *                   migration filename suffix and the migration_tag suffix
 *                   (stage<N>-<slug>)
 *
 * What it does NOT do:
 *  - does not pin hashes (run `node scripts/pin-migrations.mjs` yourself)
 *  - does not apply the migration to any database
 *  - does not touch supabase/functions/kb_health.sql's placeholder file;
 *    it only substitutes {{MIGRATION_TAG}} in the COPY it writes into the
 *    generated migration/rollback text
 */
import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import nodePath from 'node:path';
import {fileURLToPath} from 'node:url';

const rootDir=fileURLToPath(new URL('..',import.meta.url));
const path=(...p)=>nodePath.join(rootDir,...p);
const FUNCTIONS_DIR='supabase/functions';
const MIGRATIONS_DIR='supabase/migrations';
const ROLLBACK_DIR='supabase/rollback';

function fail(msg){
 console.error(msg);
 process.exit(1);
}

const [,,functionArg,slugArg]=process.argv;
if(!functionArg||!slugArg){
 fail('Usage: node scripts/new-function-migration.mjs <function-file> <slug>');
}
if(!/^[a-z][a-z0-9-]*$/.test(slugArg)){
 fail(`slug "${slugArg}" must be kebab-case: lowercase letters, digits, hyphens, starting with a letter.`);
}

const functionFileName=nodePath.basename(functionArg);
const functionFilePath=path(FUNCTIONS_DIR,functionFileName);
if(!existsSync(functionFilePath)){
 fail(`${functionFilePath} does not exist. Create the canonical file first (see CONTRIBUTING.md "Changing a database function").`);
}

const canonicalText=readFileSync(functionFilePath,'utf8');
const headerMatch=canonicalText.match(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-zA-Z_][\w.]*)\s*\(/);
if(!headerMatch)fail(`${functionFilePath} does not start with a CREATE FUNCTION statement.`);
const qualifiedName=headerMatch[1].includes('.')?headerMatch[1]:`public.${headerMatch[1]}`;
const isPublicFn=qualifiedName.startsWith('public.');
const bareName=qualifiedName.split('.')[1];

// --- previous canonical version, from git HEAD -----------------------------
let previousText=null;
try{
 previousText=execFileSync('git',['show',`HEAD:${FUNCTIONS_DIR}/${functionFileName}`],{cwd:rootDir,encoding:'utf8'});
}catch(error){
 fail(`git show HEAD:${FUNCTIONS_DIR}/${functionFileName} failed -- the file must already be committed so the rollback has a previous version to restore. (${error.message})`);
}
if(previousText.trim()===canonicalText.trim()){
 fail(`${functionFileName} is unchanged from the committed HEAD version. Edit the canonical file before generating a migration -- there is nothing to record.`);
}

// --- next migration timestamp ----------------------------------------------
const migrationFiles=readdirSync(path(MIGRATIONS_DIR)).filter(f=>/^\d+_.*\.sql$/.test(f)).sort();
const lastFile=migrationFiles[migrationFiles.length-1];
const lastPrefix=lastFile.match(/^(\d+)_/)[1];
// This repo's recent prefixes are the fixed 12-digit form
// "202609200NNN" (see supabase/migrations/2026092001*). Increment the
// trailing counter by 1, keeping the same width.
const counterWidth=3;
const headWidth=lastPrefix.length-counterWidth;
const head=lastPrefix.slice(0,headWidth);
const counter=parseInt(lastPrefix.slice(headWidth),10);
const nextPrefix=head+String(counter+1).padStart(counterWidth,'0');

const migrationFileName=`${nextPrefix}_${slugArg}.sql`;
const migrationPath=path(MIGRATIONS_DIR,migrationFileName);
const rollbackFileName=`${nextPrefix}_${slugArg}_down.sql`;
const rollbackPath=path(ROLLBACK_DIR,rollbackFileName);
if(existsSync(migrationPath))fail(`${migrationPath} already exists.`);
if(existsSync(rollbackPath))fail(`${rollbackPath} already exists.`);

// --- next stage tag ----------------------------------------------------------
const tagNumbers=[];
for(const mf of migrationFiles){
 const sql=readFileSync(path(MIGRATIONS_DIR,mf),'utf8');
 for(const m of sql.matchAll(/migration_tag='stage(\d+)-/g))tagNumbers.push(parseInt(m[1],10));
}
const nextStageNum=(tagNumbers.length?Math.max(...tagNumbers):0)+1;
const migrationTag=`stage${String(nextStageNum).padStart(2,'0')}-${slugArg}`;
// Best-effort: find the tag the PREVIOUS migration set, for the rollback's
// kb_health restoration. Scan migrations for the most recent
// `UPDATE knowledge.schema_info SET migration_tag=` statement.
let previousTag=null;
for(const mf of migrationFiles){
 const sql=readFileSync(path(MIGRATIONS_DIR,mf),'utf8');
 const m=[...sql.matchAll(/UPDATE knowledge\.schema_info SET migration_tag='([a-z0-9-]+)'/g)];
 if(m.length)previousTag=m[m.length-1][1];
}
if(!previousTag)fail('Could not find any prior migration_tag in supabase/migrations/ -- cannot build the rollback kb_health body.');

const kbHealthCanonicalPath=path(FUNCTIONS_DIR,'kb_health.sql');
if(!existsSync(kbHealthCanonicalPath))fail(`${kbHealthCanonicalPath} is missing.`);
const kbHealthTemplate=readFileSync(kbHealthCanonicalPath,'utf8');
const kbHealthFor=tag=>kbHealthTemplate.replaceAll('{{MIGRATION_TAG}}',tag);

const grantBlock=isPublicFn
 ?`\nREVOKE ALL ON FUNCTION ${qualifiedName}(${signatureArgs(canonicalText)}) FROM PUBLIC,anon,authenticated,service_role;\nGRANT EXECUTE ON FUNCTION ${qualifiedName}(${signatureArgs(canonicalText)}) TO service_role;\n`
 :'';

function signatureArgs(sql){
 const m=sql.match(/FUNCTION\s+[a-zA-Z_][\w.]*\s*\(([^)]*)\)/);
 if(!m)return '';
 // Reduce "op text,c jsonb,j jsonb" -> "text,jsonb,jsonb" for the GRANT/REVOKE signature.
 return m[1].split(',').map(p=>p.trim()).filter(Boolean).map(p=>p.split(/\s+/).slice(1).join(' ')||p).join(',');
}

const forwardBody=`-- ${migrationTag}. Generated by scripts/new-function-migration.mjs from
-- ${FUNCTIONS_DIR}/${functionFileName}. Additive only: no table/column
-- drop, no truncate, no extension install, no role alteration. Contract
-- stays 2.1.0.
-- Re-creates ${qualifiedName} from the canonical definition in
-- ${FUNCTIONS_DIR}/${functionFileName}. Edit that file, not this one, for
-- the next change -- see CONTRIBUTING.md "Changing a database function".
-- Rollback: ${ROLLBACK_DIR}/${rollbackFileName}
BEGIN;

${canonicalText.trimEnd()}
${grantBlock}
${kbHealthFor(migrationTag).trimEnd()}
UPDATE knowledge.schema_info SET migration_tag='${migrationTag}' WHERE singleton;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA knowledge FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
`;

const rollbackBody=`-- Rollback for ${migrationFileName}.
-- Restores the previous canonical body of ${qualifiedName} (from git HEAD
-- at generation time, before this migration's edit to
-- ${FUNCTIONS_DIR}/${functionFileName}) and reverts kb_health's tag to
-- '${previousTag}'.
BEGIN;

${previousText.trimEnd()}
${grantBlock}
${kbHealthFor(previousTag).trimEnd()}
UPDATE knowledge.schema_info SET migration_tag='${previousTag}' WHERE singleton;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA knowledge FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
`;

writeFileSync(migrationPath,forwardBody);
writeFileSync(rollbackPath,rollbackBody);
console.log(migrationPath);
console.log(rollbackPath);
console.log('Next: review both files by hand (the grant/signature inference is best-effort), then run node scripts/pin-migrations.mjs.');
