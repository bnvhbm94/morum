/** These are SOURCE-ONLY checks, NOT a PostgreSQL parser or database evidence. */
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';
import {testDatabaseConfig} from '../../scripts/db-test-config.mjs';
const base=new URL('../../supabase/migrations/',import.meta.url);
const files=readdirSync(base).filter(x=>x.endsWith('.sql')).sort();
const sql=files.map(x=>readFileSync(new URL(x,base),'utf8')).join('\n');
const productFiles=files.filter(x=>x!=='20260919153000_setup_connectivity.sql');
const productSql=productFiles.map(x=>readFileSync(new URL(x,base),'utf8')).join('\n');
const client=readFileSync(new URL('../../src/server/db/client.ts',import.meta.url),'utf8');
const wrappers=[...sql.matchAll(/CREATE FUNCTION public\.(kb_\w+)\(([^)]*)\) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS/g)];
test('SOURCE ONLY: setup probe plus eight ordered product migrations, with no destructive product schema changes',()=>{
 assert.deepEqual(files,['20260919153000_setup_connectivity.sql','202609200101_core.sql','202609200102_core_rpc.sql','202609200103_core_indexes.sql','202609200104_agent_service.sql','202609200105_retrieval.sql','202609200106_read_bounds.sql','202609200107_open_contribution.sql','202609200108_deferred_trigger_security.sql']);
 assert.match(readFileSync(new URL('20260919153000_setup_connectivity.sql',base),'utf8'),/create extension if not exists vector with schema extensions;/i);
 assert.doesNotMatch(productSql,/^\s*(DROP\s+(?:SCHEMA|TABLE|DATABASE)|TRUNCATE|CREATE\s+EXTENSION|ALTER\s+ROLE)\b/im);
});
test('SOURCE ONLY: public wrapper names match the backend allowlist; execute grants require DB verification',()=>{
 const names=[...new Set([...client.matchAll(/'(kb_\w+)'/g)].map(x=>x[1]))].sort();
 const defined=[...new Set([...sql.matchAll(/CREATE(?: OR REPLACE)? FUNCTION public\.(kb_\w+)\(/g)].map(x=>x[1]))].sort();
 assert.equal(defined.length,39);assert.deepEqual(defined,names);
 assert.match(sql,/REVOKE EXECUTE ON FUNCTION public\.kb_create_work_request/);
 assert.match(sql,/REVOKE ALL ON ALL FUNCTIONS IN SCHEMA knowledge FROM PUBLIC,anon,authenticated,service_role/);
});
test('SOURCE ONLY: every private table explicitly enables RLS and schema access is revoked',()=>{
 const tables=[...sql.matchAll(/CREATE TABLE knowledge\.(\w+)/g)].map(x=>x[1]);assert.ok(tables.length>=20);
 for(const name of tables)assert.ok(sql.includes(`ALTER TABLE knowledge.${name} ENABLE ROW LEVEL SECURITY;`));
 assert.ok(sql.includes('REVOKE ALL ON ALL TABLES IN SCHEMA knowledge FROM PUBLIC,anon,authenticated,service_role;'));
});
test('SOURCE ONLY: immutable history and typed evidence/review cycle declarations retained',()=>{
 for(const name of ['versions','version_changes','anchors','sources','relations','annotations','evidence','reviews','work_events','work_resolution_links','mutation_receipts'])assert.ok(sql.includes(`CREATE TRIGGER ${name}_immutable BEFORE UPDATE OR DELETE`));
 assert.match(sql,/ALTER TABLE knowledge\.evidence ADD CONSTRAINT evidence_target_review_fk FOREIGN KEY\(target_review_id\) REFERENCES knowledge\.reviews\(id\) ON DELETE RESTRICT/);
 assert.match(sql,/target_evidence_id uuid REFERENCES knowledge\.evidence\(id\) ON DELETE RESTRICT/);
 assert.match(sql,/review_id uuid NOT NULL REFERENCES knowledge\.reviews\(id\)/);
});
test('SOURCE ONLY: disabled profile, blocked default, lock fence and source no network calls',()=>{
 assert.match(sql,/'openai-te3s-1536-v1','openai','text-embedding-3-small',1536/);assert.match(sql,/state text NOT NULL DEFAULT 'blocked'/);
 assert.match(sql,/pg_advisory_xact_lock_shared\(2081801,1\)/);assert.doesNotMatch(sql,/\b(?:net\.http|http_get\(|http_post\(|dblink\()/i);
});
test('test harness refuses any remote, ambiguous or unacknowledged database',()=>{
 assert.equal(testDatabaseConfig({}),null);
 const ack={ALLOW_TEST_DB_WRITES:'1',ACK_DISPOSABLE_POSTGRES:'1'};
 for(const url of ['postgresql://remote.example/kb_core_test_x','postgresql://localhost/postgres','postgresql://localhost/kb_core_test_x?host=remote','postgresql://localhost/kb_core_test_x#fragment'])assert.throws(()=>testDatabaseConfig({...ack,TEST_DATABASE_URL:url}));
 assert.throws(()=>testDatabaseConfig({TEST_DATABASE_URL:'postgresql://localhost/kb_core_test_x'}));
 assert.equal(testDatabaseConfig({...ack,TEST_DATABASE_URL:'postgresql://localhost/kb_core_test_x'}).database,'kb_core_test_x');
});
test('SOURCE ONLY: open revision keeps anonymous receipts separate and no shared review head',()=>{
 const latest=readFileSync(new URL('202609200107_open_contribution.sql',base),'utf8');
 assert.match(latest,/CREATE TABLE knowledge\.anonymous_mutation_receipts/);
 assert.match(latest,/CHECK\(actor_id IS NULL\)/);
 assert.match(latest,/IF actor IS NOT NULL THEN\s+IF prev IS NULL THEN INSERT INTO knowledge\.review_heads/);
 assert.match(latest,/'anonymous_reviews',a\.total/);
 assert.match(latest,/'body_format','plain_text'/);
 assert.doesNotMatch(latest,/INSERT INTO knowledge\.(?:actors|agents)\b/);
});
