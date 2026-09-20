/** Opt-in local HTTP tests; never target a hosted account or silently accept a port forward. */
import {testDatabaseConfig} from '../../scripts/db-test-config.mjs';
export function localHttpConfig(env=process.env){
 const database=testDatabaseConfig(env);
 if(!database||!env.TEST_BASE_URL||env.ACK_LOCAL_HTTP_STACK!=='1')return null;
 let url;try{url=new URL(env.TEST_BASE_URL);}catch{throw Error('Invalid local test origin (value redacted).');}
 if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw Error('HTTP acceptance requires a loopback-only origin.');
 return {database,origin:url.origin};
}
