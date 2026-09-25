/** SOURCE-ONLY: reads source text, no build or DB required.
 * `supabase/functions/*.sql` holds ONE canonical current definition per
 * large plpgsql function (roadmap 1.7 "canonical function files"). This
 * test proves the canonical file is not just a copy that has drifted: for
 * each canonical file, it finds the LAST migration (by filename order,
 * which is timestamp order in this repo) that (re-)creates the same
 * qualified function name, and asserts the function body inside that
 * migration is byte-identical (after trimming trailing whitespace per
 * line) to the canonical file.
 *
 * "Edit one place": a future change edits the canonical file, then runs
 * `scripts/new-function-migration.mjs` to emit the next migration from it.
 * If this test fails, either the canonical file was hand-edited without a
 * new migration, or a migration was hand-edited without updating the
 * canonical file -- both are the duplication bug this file exists to catch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import nodePath from 'node:path';

const rootDir=fileURLToPath(new URL('../../',import.meta.url));
const path=(...p)=>nodePath.join(rootDir,...p);
const FUNCTIONS_DIR='supabase/functions';
const MIGRATIONS_DIR='supabase/migrations';

const trimLines=s=>s.split('\n').map(l=>l.replace(/[ \t]+$/,'')).join('\n').replace(/\s+$/,'');

// A canonical file may contain {{PLACEHOLDER}} tokens (currently only
// kb_health.sql's migration_tag) that a generated migration substitutes
// with a concrete value. Turn the canonical text into a RegExp that
// matches any migration's substituted body.
function canonicalToPattern(canonical){
 const escaped=canonical.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const withHoles=escaped.replace(/\\\{\\\{[A-Z_]+\\\}\\\}/g,'[^\'"]*');
 return new RegExp('^'+withHoles+'$');
}

/**
 * Extract every `CREATE (OR REPLACE)? FUNCTION <name>(...) ... $$ ... $$;`
 * (or `... AS $$ ... END $$;` for plpgsql bodies) statement from a SQL
 * file's text, keyed by qualified function name (schema.function, or
 * public.function if unqualified since every function here lives in
 * `public` or `knowledge`).
 */
function extractFunctions(sql){
 const out=[];
 const re=/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-zA-Z_][\w.]*)\s*\(/g;
 let m;
 while((m=re.exec(sql))){
  const name=m[1].includes('.')?m[1]:`public.${m[1]}`;
  const start=m.index;
  // Body ends at the first `$$;` (LANGUAGE sql) or `END $$;` (plpgsql) at
  // the start of a line, whichever appears first after `start`.
  const dollarEnd=sql.indexOf('$$;',sql.indexOf('AS $$',start));
  if(dollarEnd===-1)continue;
  // Walk back to include a leading `END ` if present, and forward past `$$;`.
  let end=dollarEnd+3;
  let bodyStart=start;
  const stmt=sql.slice(bodyStart,end);
  out.push({name,stmt});
 }
 return out;
}

const canonicalFiles=readdirSync(path(FUNCTIONS_DIR)).filter(f=>f.endsWith('.sql')).sort();
assert.ok(canonicalFiles.length>0,'supabase/functions/ has no canonical .sql files');

const migrationFiles=readdirSync(path(MIGRATIONS_DIR)).filter(f=>f.endsWith('.sql')).sort();

for(const file of canonicalFiles){
 test(`canonical supabase/functions/${file} matches the last migration that defines it`,()=>{
  const canonicalRaw=readFileSync(path(FUNCTIONS_DIR,file),'utf8');
  const canonical=trimLines(canonicalRaw);
  const headerMatch=canonical.match(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-zA-Z_][\w.]*)\s*\(/);
  assert.ok(headerMatch,`${file} does not start with a CREATE FUNCTION statement`);
  const qualifiedName=headerMatch[1].includes('.')?headerMatch[1]:`public.${headerMatch[1]}`;

  let lastMigrationFile=null;
  let lastStmt=null;
  for(const mf of migrationFiles){
   const sql=readFileSync(path(MIGRATIONS_DIR,mf),'utf8');
   const fns=extractFunctions(sql).filter(f=>f.name===qualifiedName);
   if(fns.length>0){
    lastMigrationFile=mf;
    lastStmt=fns[fns.length-1].stmt;
   }
  }
  assert.ok(lastMigrationFile,`no migration defines ${qualifiedName} (from ${file})`);

  const migrationBody=trimLines(lastStmt);
  const pattern=canonicalToPattern(canonical);
  assert.ok(
   pattern.test(migrationBody),
   `${file} (canonical) does not byte-match ${qualifiedName}'s body in the last migration that defines it (${lastMigrationFile}). `+
   'Either the canonical file drifted from the migrations, or a migration was hand-edited. '+
   'Re-copy the body verbatim, or regenerate via scripts/new-function-migration.mjs.'
  );
 });
}

test('every supabase/functions/*.sql file ends with a terminated dollar-quoted body ($$;)',()=>{
 for(const file of canonicalFiles){
  const text=readFileSync(path(FUNCTIONS_DIR,file),'utf8').trimEnd();
  assert.ok(text.endsWith('$$;'),`${file} does not end with $$;`);
 }
});
