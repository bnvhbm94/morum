/** Opt-in local test configuration, not a deployment tool. Does not create/reset a database. */
import {mkdir,open} from 'node:fs/promises';import {resolve,join} from 'node:path';import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID,createHmac} from 'node:crypto';
import {testDatabaseConfig,assertTestDatabase} from './db-test-config.mjs';
import {latestMigrationTag} from './migrations.mjs';
const root=resolve(fileURLToPath(new URL('../../',import.meta.url)));
let db;
try{
 const cfg=testDatabaseConfig();
 if(!cfg||process.env.ACK_LOCAL_HTTP_STACK!=='1')throw Error('Acknowledge a disposable local database and local HTTP stack first. No database was contacted.');
 const dir=process.env.LOCAL_STACK_PRIVATE_DIR?resolve(process.env.LOCAL_STACK_PRIVATE_DIR):null;
 if(!dir||dir===root||dir.startsWith(root+'/'))throw Error('LOCAL_STACK_PRIVATE_DIR must be outside the handoff, with private permissions.');
 const ports=[Number(process.env.LOCAL_POSTGREST_PORT??55475),Number(process.env.LOCAL_PREFIX_PORT??55476),Number(process.env.LOCAL_NEXT_PORT??55477)];
 if(new Set(ports).size!==3||ports.some(p=>!Number.isSafeInteger(p)||p<1025||p>65535))throw Error('Use three distinct high-numbered loopback ports.');
 const {Client}=await import('pg');db=new Client({connectionString:cfg.connectionString,connectionTimeoutMillis:5000});await db.connect();await assertTestDatabase(db,cfg);
 const expectedTag=await latestMigrationTag();
 if((await db.query('select migration_tag from knowledge.schema_info where singleton')).rows[0]?.migration_tag!==expectedTag)throw Error('Apply all current migrations under supabase/migrations to this fresh local database first.');
 const suffix=randomUUID().replaceAll('-',''),role='nuanox_test_'+suffix.slice(0,16),password=randomBytes(32).toString('hex'),jwtSecret=randomBytes(48).toString('base64url');
 const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url'),iat=Math.floor(Date.now()/1000),head=b64({alg:'HS256',typ:'JWT'}),payload=b64({role:'service_role',iat,exp:iat+86400});
 const token=head+'.'+payload+'.'+createHmac('sha256',jwtSecret).update(head+'.'+payload).digest('base64url');
 const uri=new URL(cfg.connectionString);uri.username=role;uri.password=password;
 await db.query('begin');
 try{
  // Role/password are generated safe ASCII, never printed or accepted from request content.
  await db.query(`create role ${role} login noinherit nosuperuser nocreatedb nocreaterole password '${password}'`);
  await db.query(`grant anon,service_role to ${role}`);await db.query('grant usage on schema public to anon,service_role');
  await db.query('commit');
 }catch(error){await db.query('rollback');throw error;}
 const [postgrest,proxy,next]=ports;
 const env={TEST_DATABASE_URL:cfg.connectionString,ALLOW_TEST_DB_WRITES:'1',ACK_DISPOSABLE_POSTGRES:'1',ACK_LOCAL_HTTP_STACK:'1',TEST_BASE_URL:`http://127.0.0.1:${next}`,NEXT_PUBLIC_SUPABASE_URL:`http://127.0.0.1:${proxy}`,SUPABASE_KEY_MODE:'legacy',SUPABASE_SERVICE_ROLE_KEY:token,SUPABASE_SECRET_KEY:'',AGENT_KEY_PEPPER:process.env.LOCAL_INCLUDE_LEGACY_KEYED_TESTS==='1'?randomBytes(48).toString('base64url'):'',CURSOR_SIGNING_KEY:randomBytes(48).toString('base64url'),AGENT_REGISTRATION_ENABLED:process.env.LOCAL_INCLUDE_LEGACY_KEYED_TESTS==='1'?'true':'false',EMBEDDING_PROVIDER:'disabled',BUDGET_APPROVED:'false',EMBEDDING_DATA_SHARING_APPROVED:'false',EMBEDDING_DAILY_TOKEN_CAP:'0',EMBEDDING_REQUEST_TOKEN_CAP:'0',OPENAI_API_KEY:'',TRUSTED_CLIENT_IP_HEADER:'',TRUSTED_PROXY_CONFIRMED:'false',PGRST_DB_URI:uri.toString(),PGRST_DB_ANON_ROLE:'anon',PGRST_DB_SCHEMAS:'public',PGRST_DB_CONFIG:'false',PGRST_JWT_SECRET:jwtSecret,PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:String(postgrest),PGRST_LOG_LEVEL:'error',LOCAL_POSTGREST_PORT:String(postgrest),LOCAL_PREFIX_PORT:String(proxy),LOCAL_NEXT_PORT:String(next)};
 await mkdir(dir,{recursive:true,mode:0o700});const path=join(dir,`stack-${suffix}.json`),file=await open(path,'wx',0o600);
 try{await file.writeFile(JSON.stringify({created_at_utc:new Date().toISOString(),expires_at_utc:new Date((iat+86400)*1000).toISOString(),scope:'disposable-local-postgrest-only',env},null,2)+'\n');await file.sync();}finally{await file.close();}
 console.log(JSON.stringify({status:'local_configuration_prepared_not_started',file:path,expires_in_seconds:86400,provider:'disabled',note:'Private file contains local-only secrets. No hosted mapping, server execution or deployment has been verified.'}));
}catch(error){console.error(JSON.stringify({status:'not_prepared',code:typeof error?.code==='string'&&/^[A-Z0-9_]{1,32}$/.test(error.code)?error.code:'LOCAL_PREPARATION_BLOCKED',reason:!process.env.TEST_DATABASE_URL?'TEST_DATABASE_URL absent; zero DB connections attempted.':'Check the documented local acknowledgements, private path, all migrations under supabase/migrations and PostgreSQL role privileges. No secret or raw SQL error is printed.'}));process.exitCode=1;}
finally{await db?.end();}
