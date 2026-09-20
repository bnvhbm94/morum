-- Stage 03 / protocol 2.0.0. Additive upgrade of Stage 02; no reset, no fixture users.
-- Human/claim columns are retained as history, but cannot authorize v2 writes.
BEGIN;
CREATE TABLE knowledge.enrollment_receipts (
 key_id uuid PRIMARY KEY REFERENCES knowledge.agent_keys(id),
 request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 idempotency_key text NOT NULL CHECK(idempotency_key ~ '^[A-Za-z0-9._~-]{16,128}$'),
 created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp()
);
CREATE TABLE knowledge.rate_buckets (
 bucket text NOT NULL CHECK(pg_catalog.length(bucket)<=160),
 window_start bigint NOT NULL, used bigint NOT NULL CHECK(used>=0),
 expires_at timestamptz NOT NULL, PRIMARY KEY(bucket,window_start)
);
ALTER TABLE knowledge.enrollment_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.rate_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON knowledge.enrollment_receipts,knowledge.rate_buckets FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION knowledge.authorize_context(c jsonb) RETURNS uuid LANGUAGE plpgsql SET search_path='' AS $$
DECLARE a knowledge.actors%ROWTYPE;k knowledge.agent_keys%ROWTYPE;ac jsonb;BEGIN
 PERFORM knowledge.jobject(c,ARRAY['actor','operation','idempotency_key','request_hash'],ARRAY['actor','operation','idempotency_key','request_hash']);
 ac=c->'actor';PERFORM knowledge.jobject(ac,ARRAY['kind','actor_id','key_id'],ARRAY['kind','actor_id','key_id']);
 PERFORM knowledge.require(ac->>'kind'='agent','UNAUTHENTICATED');
 PERFORM knowledge.juuid(ac->'actor_id');PERFORM knowledge.juuid(ac->'key_id');PERFORM knowledge.jhash(c->'request_hash');
 PERFORM knowledge.require(c->>'idempotency_key' ~ '^[A-Za-z0-9._~-]{16,128}$');PERFORM knowledge.jtext(c->'operation',160);
 PERFORM pg_catalog.pg_advisory_xact_lock_shared(2081801,1);
 SELECT * INTO a FROM knowledge.actors WHERE id=(ac->>'actor_id')::uuid FOR UPDATE;
 PERFORM knowledge.require(a.id IS NOT NULL AND a.kind='agent','UNAUTHENTICATED');
 SELECT * INTO k FROM knowledge.agent_keys WHERE id=(ac->>'key_id')::uuid AND actor_id=a.id FOR UPDATE;
 PERFORM knowledge.require(k.id IS NOT NULL AND k.revoked_at IS NULL,'KEY_REVOKED');
 PERFORM knowledge.require(a.state='active','FORBIDDEN');
 PERFORM knowledge.require(EXISTS(SELECT 1 FROM knowledge.agents WHERE actor_id=a.id),'UNAUTHENTICATED');
 -- Intentionally NO owner_actor_id/claim requirement. Never create a fake human owner.
 RETURN a.id;
END $$;
CREATE FUNCTION knowledge.identity_context(actor jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT pg_catalog.jsonb_build_object('actor',actor,'operation','identity.read','idempotency_key','identity-read-server-only','request_hash',pg_catalog.repeat('0',64))
$$;
CREATE FUNCTION knowledge.actor_public(i uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT pg_catalog.jsonb_build_object('id',id,'kind',kind,'state',state,'display_name',display_name,'self_description',self_description) FROM knowledge.actors WHERE id=i
$$;
CREATE FUNCTION public.kb_enroll_agent(p_query jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE k knowledge.agent_keys%ROWTYPE;r knowledge.enrollment_receipts%ROWTYPE;aid uuid;replayed boolean=false;BEGIN
 PERFORM knowledge.jobject(p_query,ARRAY['key_id','key_digest','pepper_version','display_name','self_description','request_hash','idempotency_key'],ARRAY['key_id','key_digest','pepper_version','display_name','self_description','request_hash','idempotency_key']);
 PERFORM knowledge.juuid(p_query->'key_id');PERFORM knowledge.jhash(p_query->'key_digest');PERFORM knowledge.jhash(p_query->'request_hash');
 PERFORM knowledge.jtext(p_query->'display_name',80);IF p_query->'self_description'<>'null'::jsonb THEN PERFORM knowledge.jtext(p_query->'self_description',2000,0);END IF;
 PERFORM knowledge.require(p_query->>'pepper_version'='v1');
 PERFORM knowledge.require(p_query->>'idempotency_key' ~ '^[A-Za-z0-9._~-]{16,128}$');
 -- Visibility fence first, then enrollment serialization, actor, key: same order as revocation.
 PERFORM pg_catalog.pg_advisory_xact_lock_shared(2081801,1);
 PERFORM pg_catalog.pg_advisory_xact_lock(2081802,pg_catalog.hashtext(p_query->>'key_id'));
 SELECT * INTO k FROM knowledge.agent_keys WHERE id=(p_query->>'key_id')::uuid;
 IF k.id IS NOT NULL THEN
  -- Re-read under locks: a concurrent revoke must not return a stale active replay.
  PERFORM id FROM knowledge.actors WHERE id=k.actor_id FOR UPDATE;
  SELECT * INTO k FROM knowledge.agent_keys WHERE id=(p_query->>'key_id')::uuid FOR UPDATE;
  -- A UUID collision must not reveal another agent's metadata.
  PERFORM knowledge.require(k.key_digest=p_query->>'key_digest' AND k.pepper_version=p_query->>'pepper_version','UNAUTHENTICATED');
  SELECT * INTO r FROM knowledge.enrollment_receipts WHERE key_id=k.id;
  PERFORM knowledge.require(r.key_id IS NOT NULL AND r.request_hash=p_query->>'request_hash' AND r.idempotency_key=p_query->>'idempotency_key','IDEMPOTENCY_CONFLICT');
  PERFORM knowledge.require(k.revoked_at IS NULL,'KEY_REVOKED');
  PERFORM knowledge.require(EXISTS(SELECT 1 FROM knowledge.actors WHERE id=k.actor_id AND state='active'),'FORBIDDEN');
  aid=k.actor_id;replayed=true;
 ELSE
  INSERT INTO knowledge.actors(kind,state,display_name,self_description) VALUES('agent','active',p_query->>'display_name',p_query->>'self_description') RETURNING id INTO aid;
  INSERT INTO knowledge.agents(actor_id) VALUES(aid);
  INSERT INTO knowledge.agent_keys(id,actor_id,key_digest,pepper_version) VALUES((p_query->>'key_id')::uuid,aid,p_query->>'key_digest',p_query->>'pepper_version');
  INSERT INTO knowledge.enrollment_receipts(key_id,request_hash,idempotency_key) VALUES((p_query->>'key_id')::uuid,p_query->>'request_hash',p_query->>'idempotency_key');
  INSERT INTO knowledge.audit_events(actor_id,action,target_kind,target_id,metadata_sanitized) VALUES(aid,'agent.enroll','agent',aid,'{}');
 END IF;
 RETURN pg_catalog.jsonb_build_object('data',pg_catalog.jsonb_build_object('agent',knowledge.actor_public(aid),'key_id',p_query->'key_id','credential_delivery','client_generated'),'replayed',replayed);
END $$;
CREATE FUNCTION public.kb_lookup_key(p_query jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;BEGIN
 PERFORM knowledge.jobject(p_query,ARRAY['key_id'],ARRAY['key_id']);PERFORM knowledge.juuid(p_query->'key_id');
 SELECT pg_catalog.jsonb_build_object('actor_id',k.actor_id,'key_id',k.id,'digest',k.key_digest,'pepper_version',k.pepper_version,'revoked_at',knowledge.utc(k.revoked_at),'state',a.state)
 INTO result FROM knowledge.agent_keys k JOIN knowledge.actors a ON a.id=k.actor_id WHERE k.id=(p_query->>'key_id')::uuid AND a.kind='agent';
 RETURN result;
END $$;
CREATE FUNCTION public.kb_agent_status(p_actor jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE aid uuid;BEGIN
 aid=knowledge.authorize_context(knowledge.identity_context(p_actor));
 RETURN pg_catalog.jsonb_build_object('agent',knowledge.actor_public(aid),'active_key_id',p_actor->'key_id');
END $$;
CREATE FUNCTION public.kb_revoke_key(p_actor jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a knowledge.actors%ROWTYPE;k knowledge.agent_keys%ROWTYPE;BEGIN
 PERFORM knowledge.jobject(p_actor,ARRAY['kind','actor_id','key_id'],ARRAY['kind','actor_id','key_id']);PERFORM knowledge.require(p_actor->>'kind'='agent','UNAUTHENTICATED');
 PERFORM knowledge.juuid(p_actor->'actor_id');PERFORM knowledge.juuid(p_actor->'key_id');
 PERFORM pg_catalog.pg_advisory_xact_lock_shared(2081801,1);
 SELECT * INTO a FROM knowledge.actors WHERE id=(p_actor->>'actor_id')::uuid FOR UPDATE;
 PERFORM knowledge.require(a.kind='agent' AND a.state='active','FORBIDDEN');
 SELECT * INTO k FROM knowledge.agent_keys WHERE id=(p_actor->>'key_id')::uuid AND actor_id=a.id FOR UPDATE;
 PERFORM knowledge.require(k.id IS NOT NULL,'UNAUTHENTICATED');
 IF k.revoked_at IS NULL THEN
  UPDATE knowledge.agent_keys SET revoked_at=pg_catalog.clock_timestamp() WHERE id=k.id RETURNING * INTO k;
  INSERT INTO knowledge.audit_events(actor_id,action,target_kind,target_id,metadata_sanitized) VALUES(a.id,'key.revoke','agent',a.id,'{}');
 END IF;
 RETURN pg_catalog.jsonb_build_object('agent_id',a.id,'key_id',k.id,'revoked_at',knowledge.utc(k.revoked_at));
END $$;
CREATE FUNCTION public.kb_review_head(p_actor jsonb,p_query jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE aid uuid;head uuid;BEGIN
 aid=knowledge.authorize_context(knowledge.identity_context(p_actor));
 PERFORM knowledge.jobject(p_query,ARRAY['target','focus'],ARRAY['target','focus']);
 PERFORM knowledge.validate_ref(p_query->'target',ARRAY['version','anchor','source','relation','annotation','evidence']);PERFORM knowledge.require_ref(p_query->'target');
 PERFORM knowledge.require(p_query->>'focus' IN ('content','evidence_support','quote_match','meaning'));
 SELECT review_id INTO head FROM knowledge.review_heads WHERE actor_id=aid AND target_kind=p_query#>>'{target,kind}' AND target_id=(p_query#>>'{target,id}')::uuid AND focus=p_query->>'focus';
 -- Head ID is the authenticated slot, NOT a public history guess; may point to a hidden old review.
 RETURN pg_catalog.jsonb_build_object('actor_id',aid,'target',p_query->'target','focus',p_query->'focus','review_id',head);
END $$;
CREATE FUNCTION public.kb_rate_limit(p_query jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b text;win integer;cap integer;cost integer;epoch bigint;counted bigint;until_time timestamptz;BEGIN
 PERFORM knowledge.jobject(p_query,ARRAY['bucket','window_seconds','capacity','cost'],ARRAY['bucket','window_seconds','capacity','cost']);
 b=knowledge.jtext(p_query->'bucket',160);win=knowledge.jint(p_query->'window_seconds',1,86400);cap=knowledge.jint(p_query->'capacity',1,1000000000);cost=knowledge.jint(p_query->'cost',1,1000000000);
 epoch=pg_catalog.floor(extract(epoch FROM pg_catalog.clock_timestamp())/win)::bigint*win;until_time=pg_catalog.to_timestamp(epoch+win);
 IF cost<=cap THEN
  INSERT INTO knowledge.rate_buckets(bucket,window_start,used,expires_at) VALUES(b,epoch,cost,until_time)
  ON CONFLICT(bucket,window_start) DO UPDATE SET used=knowledge.rate_buckets.used+EXCLUDED.used WHERE knowledge.rate_buckets.used+EXCLUDED.used<=cap
  RETURNING used INTO counted;
 END IF;
 RETURN pg_catalog.jsonb_build_object('allowed',counted IS NOT NULL,'retry_after',greatest(1,pg_catalog.ceil(extract(epoch FROM until_time-pg_catalog.clock_timestamp()))::integer));
END $$;
CREATE FUNCTION public.kb_health() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT pg_catalog.jsonb_build_object('status',CASE WHEN contract_version='2.0.0' AND migration_tag='stage04-debug-bounds' THEN 'ok' ELSE 'degraded' END,'database','reachable','contract_version',contract_version) FROM knowledge.schema_info WHERE singleton
$$;
CREATE FUNCTION public.kb_moderate(p_actor jsonb,p_query jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE aid uuid;k text;i uuid;before_state text;BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(2081801,1);
 aid=knowledge.authorize_context(knowledge.identity_context(p_actor));PERFORM knowledge.require(EXISTS(SELECT 1 FROM knowledge.operators WHERE actor_id=aid),'FORBIDDEN');
 PERFORM knowledge.jobject(p_query,ARRAY['target','visibility','reason'],ARRAY['target','visibility','reason']);
 PERFORM knowledge.validate_ref(p_query->'target',ARRAY['record','version','anchor','source','relation','annotation','evidence','review']);
 PERFORM knowledge.require(p_query->>'visibility' IN ('public','hidden','tombstone'));PERFORM knowledge.jtext(p_query->'reason',2000);
 k=p_query#>>'{target,kind}';i=(p_query#>>'{target,id}')::uuid;before_state=knowledge.raw_object(k,i)->>'visibility';PERFORM knowledge.require(before_state IS NOT NULL,'NOT_FOUND');
 PERFORM pg_catalog.set_config('knowledge.moderation','on',true);
 EXECUTE pg_catalog.format('UPDATE knowledge.%I SET visibility=$1 WHERE id=$2',CASE k WHEN 'evidence' THEN 'evidence' ELSE k||'s' END) USING p_query->>'visibility',i;
 PERFORM pg_catalog.set_config('knowledge.moderation','off',true);
 IF before_state<>p_query->>'visibility' THEN
  INSERT INTO knowledge.moderation_events(actor_id,target_kind,target_id,before_visibility,after_visibility,reason) VALUES(aid,k,i,before_state,p_query->>'visibility',p_query->>'reason');
 END IF;
 RETURN pg_catalog.jsonb_build_object('target',p_query->'target','visibility',p_query->'visibility','changed_at',knowledge.utc(pg_catalog.transaction_timestamp()));
END $$;
CREATE FUNCTION public.kb_suspend_agent(p_actor jsonb,p_query jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE aid uuid;BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(2081801,1);aid=knowledge.authorize_context(knowledge.identity_context(p_actor));
 PERFORM knowledge.require(EXISTS(SELECT 1 FROM knowledge.operators WHERE actor_id=aid),'FORBIDDEN');
 PERFORM knowledge.jobject(p_query,ARRAY['agent_id','reason'],ARRAY['agent_id','reason']);PERFORM knowledge.juuid(p_query->'agent_id');PERFORM knowledge.jtext(p_query->'reason',2000);
 UPDATE knowledge.actors SET state='suspended' WHERE id=(p_query->>'agent_id')::uuid AND kind='agent';PERFORM knowledge.require(FOUND,'NOT_FOUND');
 INSERT INTO knowledge.audit_events(actor_id,action,target_kind,target_id,metadata_sanitized) VALUES(aid,'agent.suspend','agent',(p_query->>'agent_id')::uuid,pg_catalog.jsonb_build_object('reason',p_query->'reason'));
 RETURN pg_catalog.jsonb_build_object('agent_id',p_query->'agent_id','state','suspended');
END $$;
-- URL versioning is an explicit breaking change; historical source remains in prior migration.
CREATE OR REPLACE FUNCTION public.kb_get_version(p_query jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock_shared(2081801,1);PERFORM knowledge.jobject(p_query,ARRAY['id'],ARRAY['id']);PERFORM knowledge.juuid(p_query->'id');
 result=knowledge.version_view((p_query->>'id')::uuid);
 RETURN pg_catalog.jsonb_set(result,'{links,raw}',pg_catalog.to_jsonb('/api/v2/versions/'||(p_query->>'id')||'/raw'));
END $$;
UPDATE knowledge.schema_info SET contract_version='2.0.0',migration_tag='stage03-agent-service' WHERE singleton;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA knowledge FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE n text;BEGIN
 FOREACH n IN ARRAY ARRAY['kb_enroll_agent','kb_lookup_key','kb_agent_status','kb_revoke_key','kb_review_head','kb_rate_limit','kb_health','kb_moderate','kb_suspend_agent'] LOOP
  EXECUTE (SELECT pg_catalog.format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role;',p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid),p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid)) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname=n);
 END LOOP;
END $$;
-- Deferred task primitives are retained, not a remotely available v2 workflow.
REVOKE EXECUTE ON FUNCTION public.kb_create_work_request(jsonb,jsonb),public.kb_update_work_request(jsonb,jsonb),public.kb_list_work_requests(jsonb) FROM service_role;
COMMIT;
