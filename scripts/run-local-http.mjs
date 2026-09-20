/** Foreground-only command launcher. Never launches a deployment or provider process. */
import {open} from 'node:fs/promises';import {constants} from 'node:fs';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {localHttpConfig} from '../tests/http/local-config.mjs';
import {testDatabaseConfig} from './db-test-config.mjs';
const app=fileURLToPath(new URL('../',import.meta.url)),component=process.argv[2],path=process.env.LOCAL_STACK_FILE;
try{
 if(!path||process.env.ACK_LOCAL_HTTP_STACK!=='1')throw Error('Set LOCAL_STACK_FILE and ACK_LOCAL_HTTP_STACK=1 locally.');
 const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));let config;
 try{const st=await file.stat();if(!st.isFile()||(process.platform!=='win32'&&(st.mode&0o077)!==0))throw Error('Private stack file required.');config=JSON.parse(await file.readFile('utf8'));}finally{await file.close();}
 if(config.scope!=='disposable-local-postgrest-only'||!Number.isFinite(Date.parse(config.expires_at_utc))||Date.parse(config.expires_at_utc)<=Date.now())throw Error('Local test configuration expired or invalid. Prepare another private configuration.');
 const env={...process.env,...config.env};if(!localHttpConfig(env)||env.EMBEDDING_PROVIDER!=='disabled'||env.OPENAI_API_KEY)throw Error('Only local provider-disabled tests are allowed.');
 const pg=testDatabaseConfig({...env,TEST_DATABASE_URL:env.PGRST_DB_URI});if(!pg||pg.database!==localHttpConfig(env).database.database||env.PGRST_SERVER_HOST!=='127.0.0.1'||env.NEXT_PUBLIC_SUPABASE_URL!==`http://127.0.0.1:${env.LOCAL_PREFIX_PORT}`)throw Error('Remote or mismatched test stack refused.');
 const commands={postgrest:['postgrest',[]],proxy:[process.execPath,['tests/http/postgrest-prefix-proxy.mjs']],build:['npm',['run','build']],next:['npm',['run','start','--','--hostname','127.0.0.1','--port',env.LOCAL_NEXT_PORT]],http:['npm',['run','test:http:required']],db:['npm',['run','test:db:required']],korean:['npm',['run','eval:korean']]};
 if(!commands[component])throw Error('Choose postgrest, proxy, build, next, http, db or korean.');
 const [command,args]=commands[component],child=spawn(command,args,{cwd:app,env,stdio:'inherit'});
 child.on('error',()=>{console.error('Required local executable unavailable. No alternate remote service was used.');process.exitCode=127;});
 child.on('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
}catch{console.error('Local launcher blocked. Check private configuration, expiry, component and explicit local acknowledgement; no secret is printed.');process.exitCode=1;}
