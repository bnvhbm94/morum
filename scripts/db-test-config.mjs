/** Test-only safety gate. Never used by production or deployment scripts. */
export function testDatabaseConfig(env=process.env){
 if(!env.TEST_DATABASE_URL)return null;
 if(env.ALLOW_TEST_DB_WRITES!=='1'||env.ACK_DISPOSABLE_POSTGRES!=='1')throw Error('Explicit disposable-local-database acknowledgements are required.');
 let url;try{url=new URL(env.TEST_DATABASE_URL);}catch{throw Error('Invalid local test database URL (value redacted).');}
 const name=decodeURIComponent(url.pathname.slice(1));
 if(!['postgres:','postgresql:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||!/^kb_core_test_[a-z0-9_]+$/.test(name)||url.search||url.hash)
  throw Error('Tests require a loopback, dedicated kb_core_test_* database without query overrides. Remote/Supabase production targets are refused.');
 return {connectionString:env.TEST_DATABASE_URL,database:name};
}
export async function assertTestDatabase(client,config){
 const {rows:[row]}=await client.query("select current_database() as name,current_setting('server_version_num')::int as version,current_setting('server_encoding') as encoding");
 if(row.name!==config.database||row.version<150000||row.encoding!=='UTF8')throw Error('A dedicated PostgreSQL 15+ UTF8 test database is required.');
 return row;
}
export function redactedDatabaseError(error){return {error:'database_check_failed',code:typeof error?.code==='string'?error.code:'UNKNOWN',position:typeof error?.position==='string'?error.position:null,domain_code:typeof error?.message==='string'&&/^KB:[A-Z_]+$/.test(error.message)?error.message:null};}
