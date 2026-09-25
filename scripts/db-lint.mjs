/** Roadmap 1.7: static-check plpgsql functions with the plpgsql_check
 * extension, over every function in schema `knowledge` and every
 * `public.kb_*` function. Connects to TEST_DATABASE_URL under the same
 * disposable-local-database gate as the other db scripts (see
 * scripts/db-test-config.mjs) -- it never touches production.
 *
 * If the extension is unavailable (e.g. a Homebrew Postgres 16 install
 * that does not package plpgsql_check), this prints a message and exits 0
 * rather than failing CI/local runs that don't have it installed. */
import {testDatabaseConfig,assertTestDatabase,redactedDatabaseError} from './db-test-config.mjs';

const started=new Date().toISOString();
let client;
try{
 const config=testDatabaseConfig();
 if(!config)throw Error('TEST_DATABASE_URL is absent; no database was contacted.');
 const {Client}=await import('pg');
 client=new Client({connectionString:config.connectionString,connectionTimeoutMillis:5000});
 await client.connect();
 await assertTestDatabase(client,config);

 try{
  await client.query('CREATE EXTENSION IF NOT EXISTS plpgsql_check');
 }catch(error){
  console.log('plpgsql_check not installed, skipped');
  process.exit(0);
 }

 const {rows:functions}=await client.query(`
  select p.oid::regprocedure::text as signature
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  join pg_catalog.pg_language l on l.oid=p.prolang
  where l.lanname='plpgsql'
    and (n.nspname='knowledge' or (n.nspname='public' and p.proname like 'kb\\_%'))
  order by p.oid
 `);

 if(functions.length===0){
  console.log(JSON.stringify({status:'no_functions_found',started_at_utc:started},null,2));
  process.exit(0);
 }

 const findings=[];
 for(const fn of functions){
  const {rows}=await client.query(
   `select (pgc).function_name,(pgc).lineno,(pgc).statement,(pgc).sqlstate,(pgc).message,(pgc).level
    from plpgsql_check_function_tb($1::regprocedure) as pgc`,
   [fn.signature]
  );
  for(const row of rows){
   if(row.level==='error'||row.level==='warning')findings.push({function:fn.signature,...row});
  }
 }

 console.log(JSON.stringify({status:findings.length?'findings':'clean',started_at_utc:started,checked:functions.length,findings},null,2));
 if(findings.some(f=>f.level==='error'))process.exitCode=1;
}catch(error){
 console.error(JSON.stringify(redactedDatabaseError(error)));
 process.exitCode=1;
}finally{
 await client?.end();
}
