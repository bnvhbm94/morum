import {readFile,readdir} from 'node:fs/promises';import {fileURLToPath} from 'node:url';
import {testDatabaseConfig,assertTestDatabase,redactedDatabaseError} from './db-test-config.mjs';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
const started=new Date().toISOString();let client;
try{
 const config=testDatabaseConfig();if(!config)throw Error('TEST_DATABASE_URL is absent; no database was contacted.');
 const {Client}=await import('pg');client=new Client({connectionString:config.connectionString,connectionTimeoutMillis:5000});await client.connect();
 const version=await assertTestDatabase(client,config);
 const {rows:[exists]}=await client.query("select to_regnamespace('knowledge') is not null as present");
 if(exists.present)throw Error('knowledge already exists. No reset/drop/overwrite is allowed; use a fresh dedicated test database.');
 await client.query(await readFile('tests/db/bootstrap.sql','utf8'));
 const files=(await readdir('supabase/migrations')).filter(f=>/^20260920010[1-8]_.*\.sql$/.test(f)).sort();
 if(files.length!==8)throw Error('Expected exactly eight migrations, including the Stage05 deferred-trigger fix.');
 for(const file of files)await client.query(await readFile(`supabase/migrations/${file}`,'utf8'));
 console.log(JSON.stringify({status:'passed',scope:'disposable_local_postgres_only',started_at_utc:started,finished_at_utc:new Date().toISOString(),runtime:process.version,database_version_num:version.version,applied:files},null,2));
}catch(error){console.error(JSON.stringify(redactedDatabaseError(error)));process.exitCode=1;}finally{await client?.end();}
