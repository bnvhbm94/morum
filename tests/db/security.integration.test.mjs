/** Pre-publication security invariants (Roadmap 1.10). Actual PostgreSQL only. No DB substitute. */
import test from 'node:test';import assert from 'node:assert/strict';
import {testDatabaseConfig} from '../../scripts/db-test-config.mjs';
const config=testDatabaseConfig();
if(!config)test('Pre-publication security invariants NOT RUN',{skip:'No acknowledged disposable local PostgreSQL database'},()=>{});
else {
 const {openHarness,record}=await import('./stage04-support.mjs');
 test('pre-publication security invariants on real PostgreSQL',async t=>{
  const h=await openHarness(config);t.after(()=>h.close());const {admin,a,mutate,rpc}=h,actor={kind:'anonymous'};

  await t.test('every knowledge table has row level security enabled',async()=>{
   const {rows}=await admin.query(
    `select c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='knowledge' and c.relkind='r' and c.relrowsecurity=false order by 1`);
   assert.deepEqual(rows.map(r=>r.name),[],`Tables without RLS enabled: ${rows.map(r=>r.name).join(', ')}`);
  });

  await t.test('no knowledge table grants anon/authenticated/service_role/PUBLIC any privilege',async()=>{
   const {rows}=await admin.query(
    `select table_name,grantee,privilege_type from information_schema.role_table_grants
     where table_schema='knowledge' and grantee in ('anon','authenticated','service_role','PUBLIC')`);
   const offenders=rows.map(r=>`${r.table_name}:${r.grantee}:${r.privilege_type}`);
   assert.deepEqual(offenders,[],`Unexpected knowledge table grants: ${offenders.join(', ')}`);
  });

  await t.test('no function in schema knowledge grants EXECUTE to PUBLIC/anon/authenticated/service_role',async()=>{
   const {rows:fns}=await admin.query(
    `select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='knowledge'`);
   const offenders=[];
   for(const {sig} of fns){
    const {rows:[g]}=await admin.query(
     `select has_function_privilege('public',$1,'EXECUTE') pub,
             has_function_privilege('anon',$1,'EXECUTE') anon,
             has_function_privilege('authenticated',$1,'EXECUTE') authenticated,
             has_function_privilege('service_role',$1,'EXECUTE') service_role`,[sig]);
    for(const role of ['pub','anon','authenticated','service_role'])if(g[role])offenders.push(`${sig}:${role}`);
   }
   assert.deepEqual(offenders,[],`knowledge functions with unexpected EXECUTE grants: ${offenders.join(', ')}`);
  });

  await t.test('every public.kb_* function is SECURITY DEFINER, locks search_path, and EXECUTE is service_role-only',async()=>{
   const {rows:fns}=await admin.query(
    `select p.proname name,p.oid::regprocedure::text sig,p.prosecdef secdef,p.proconfig config
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname like 'kb\\_%'`);
   assert.ok(fns.length>0,'No public.kb_* functions were found.');
   const offenders=[];
   for(const fn of fns){
    if(!fn.secdef)offenders.push(`${fn.sig}: not SECURITY DEFINER`);
    const config=fn.config||[];
    if(!config.some(c=>/^search_path=""?$/.test(c)))offenders.push(`${fn.sig}: proconfig missing search_path='' (${JSON.stringify(config)})`);
    const {rows:[g]}=await admin.query(
     `select has_function_privilege('public',$1,'EXECUTE') pub,
             has_function_privilege('anon',$1,'EXECUTE') anon,
             has_function_privilege('authenticated',$1,'EXECUTE') authenticated,
             has_function_privilege('service_role',$1,'EXECUTE') service_role`,[fn.sig]);
    if(g.pub)offenders.push(`${fn.sig}: EXECUTE granted to PUBLIC`);
    if(g.anon)offenders.push(`${fn.sig}: EXECUTE granted to anon`);
    if(g.authenticated)offenders.push(`${fn.sig}: EXECUTE granted to authenticated`);
    if(!g.service_role)offenders.push(`${fn.sig}: EXECUTE NOT granted to service_role`);
   }
   assert.deepEqual(offenders,[],`public.kb_* privilege problems: ${offenders.join('; ')}`);
  });

  await t.test('append-only tables reject UPDATE and DELETE via the immutable_row trigger',async()=>{
   await mutate(a,'record.create',record('SYNTHETIC security invariant append-only'),actor);
   const tables=['versions','evidence','reviews','relations','annotations','anchors','sources','provenance','anonymous_mutation_receipts','mutation_receipts'];
   const skipped=[];
   for(const table of tables){
    const {rows:[row]}=await admin.query(`select * from knowledge.${table} limit 1`);
    if(!row){skipped.push(table);continue;}
    const pkCols=(await admin.query(
     `select a.attname from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey)
      where i.indrelid=$1::regclass and i.indisprimary`,[`knowledge.${table}`])).rows.map(r=>r.attname);
    assert.ok(pkCols.length>0,`No primary key found for knowledge.${table}`);
    const where=pkCols.map((c,i)=>`${c}=$${i+1}`).join(' and ');
    const values=pkCols.map(c=>row[c]);
    await assert.rejects(admin.query(`update knowledge.${table} set ${pkCols[0]}=${pkCols[0]} where ${where}`,values),
     /immutable|permission denied|KB:FORBIDDEN/i,`Expected UPDATE on knowledge.${table} to be rejected by the immutable_row trigger`);
    await assert.rejects(admin.query(`delete from knowledge.${table} where ${where}`,values),
     /immutable|permission denied|KB:FORBIDDEN/i,`Expected DELETE on knowledge.${table} to be rejected by the immutable_row trigger`);
   }
   if(skipped.length)console.log(JSON.stringify({scope:'security_invariants',note:'append-only check skipped (no fixture row present)',tables:skipped}));
  });

  await t.test('kb_rate_limit exists, is service_role-only, and rejects once its configured capacity is spent',async()=>{
   const sig=(await admin.query(
    `select p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='kb_rate_limit'`)).rows[0]?.sig;
   assert.ok(sig,'public.kb_rate_limit does not exist');
   const {rows:[g]}=await admin.query(
    `select has_function_privilege('service_role',$1,'EXECUTE') server,
            has_function_privilege('anon',$1,'EXECUTE') anon,
            has_function_privilege('authenticated',$1,'EXECUTE') authenticated,
            has_function_privilege('public',$1,'EXECUTE') pub`,[sig]);
   assert.deepEqual(g,{server:true,anon:false,authenticated:false,pub:false});
   const bucket=`SYNTHETIC-security-invariant-${Date.now()}`;
   const first=await rpc(a,'kb_rate_limit',{p_query:{bucket,window_seconds:60,capacity:1,cost:1}});
   assert.equal(first.allowed,true,`First call within capacity should be allowed; got ${JSON.stringify(first)}`);
   const second=await rpc(a,'kb_rate_limit',{p_query:{bucket,window_seconds:60,capacity:1,cost:1}});
   assert.equal(second.allowed,false,`Call exceeding the configured capacity should be rejected; got ${JSON.stringify(second)}`);
   assert.ok(Number.isInteger(second.retry_after)&&second.retry_after>0);
  });
 });
}
