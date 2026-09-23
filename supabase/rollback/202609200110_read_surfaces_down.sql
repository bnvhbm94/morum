-- Rollback for 202609200110_read_surfaces.sql.
-- Restores stage06 behavior: drops the three new public RPCs, the URL/quote
-- helpers and their index, and restores the 0107 bodies of
-- knowledge.mutate/knowledge.authorize_context verbatim.
-- The knowledge.provenance table and the relaxed NOT NULL constraints on
-- knowledge.work_requests.created_by / knowledge.work_events.actor_id are
-- LEFT IN PLACE: rows may already reference them, and removing a constraint
-- relaxation or a table that may hold data is not a safe additive-only
-- rollback. This file only undoes newly added behavior surface, not storage.
BEGIN;

DROP FUNCTION IF EXISTS public.kb_url_report(jsonb);
DROP FUNCTION IF EXISTS public.kb_dossier(jsonb);
DROP FUNCTION IF EXISTS public.kb_attention(jsonb);
DROP FUNCTION IF EXISTS knowledge.attention_candidates();
DROP INDEX IF EXISTS knowledge.sources_canonical_url_idx;
DROP FUNCTION IF EXISTS knowledge.evidence_quote_check(knowledge.evidence);
DROP FUNCTION IF EXISTS knowledge.quote_check(text,text);
DROP FUNCTION IF EXISTS knowledge.normalize_quote(text);
DROP FUNCTION IF EXISTS knowledge.canonical_url(text);

REVOKE EXECUTE ON FUNCTION public.kb_create_work_request(jsonb,jsonb),public.kb_update_work_request(jsonb,jsonb),public.kb_list_work_requests(jsonb) FROM service_role;

CREATE OR REPLACE FUNCTION knowledge.authorize_context(c jsonb) RETURNS uuid LANGUAGE plpgsql SET search_path='' AS $$
DECLARE a knowledge.actors%ROWTYPE;k knowledge.agent_keys%ROWTYPE;ac jsonb;BEGIN
 PERFORM knowledge.jobject(c,ARRAY['actor','operation','idempotency_key','request_hash'],ARRAY['actor','operation','idempotency_key','request_hash']);
 ac=c->'actor';
 IF ac->>'kind'='anonymous' THEN
  PERFORM knowledge.jobject(ac,ARRAY['kind'],ARRAY['kind']);
  PERFORM knowledge.jhash(c->'request_hash');PERFORM knowledge.jtext(c->'operation',160);
  PERFORM knowledge.require(c->>'idempotency_key' ~ '^[A-Za-z0-9._~-]{16,128}$');
  PERFORM knowledge.require(c->>'operation' IN ('record.create','anchor.create','source.create','annotation.create','relation.create','evidence.create','review.create')
   OR c->>'operation' ~ '^version[.]create:[0-9a-f-]{36}$','FORBIDDEN');
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(2081801,1);
  RETURN NULL; -- Anonymous is absence of identity, NOT a fabricated shared agent.
 END IF;
 PERFORM knowledge.jobject(ac,ARRAY['kind','actor_id','key_id'],ARRAY['kind','actor_id','key_id']);
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

CREATE OR REPLACE FUNCTION knowledge.mutate(op text,c jsonb,j jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE actor uuid;operation text;receipt knowledge.mutation_receipts%ROWTYPE;d text;kind text;i uuid;meta jsonb='{}';
 v knowledge.versions%ROWTYPE;base knowledge.versions%ROWTYPE;r knowledge.records%ROWTYPE;current_id uuid;
 body_text text;attrs jsonb;title text;format text;m jsonb;key text;changed boolean;an knowledge.anchors%ROWTYPE;sel jsonb;s integer;e integer;
 prev uuid;wr knowledge.work_requests%ROWTYPE;ev uuid;is_operator boolean;action text;new_status text;assigned uuid;resolution uuid;ref jsonb;ord integer;
BEGIN
 PERFORM knowledge.validate_command(op,j);actor=knowledge.authorize_context(c);
 IF actor IS NULL THEN PERFORM knowledge.require(op NOT IN ('work_request.create','work_request.update'),'FORBIDDEN');END IF;
 operation=op||CASE WHEN op='version.create' THEN ':'||(j->>'record_id')::uuid::text WHEN op='work_request.update' THEN ':'||(j->>'work_request_id')::uuid::text ELSE '' END;
 PERFORM knowledge.require(c->>'operation'=operation);d=knowledge.hash(j::text);
 IF actor IS NULL THEN
  PERFORM pg_catalog.pg_advisory_xact_lock(2081804,pg_catalog.hashtext(operation||':'||(c->>'idempotency_key')));
  SELECT * INTO receipt FROM knowledge.anonymous_mutation_receipts ar WHERE ar.operation=c->>'operation' AND ar.idempotency_key=c->>'idempotency_key';
 ELSE
  SELECT * INTO receipt FROM knowledge.mutation_receipts mr WHERE mr.actor_id=actor AND mr.operation=c->>'operation' AND mr.idempotency_key=c->>'idempotency_key';
 END IF;
 IF receipt.result_id IS NOT NULL THEN
  PERFORM knowledge.require(receipt.request_hash=c->>'request_hash' AND receipt.sql_command_hash=d,'IDEMPOTENCY_CONFLICT');
  RETURN pg_catalog.jsonb_build_object('data',knowledge.mutation_result(receipt.result_kind,receipt.result_id,receipt.response_json),'replayed',true);
 END IF;
 CASE op
 WHEN 'record.create' THEN
  kind='version';INSERT INTO knowledge.records(created_by,version_counter) VALUES(actor,1) RETURNING * INTO r;
  INSERT INTO knowledge.versions(created_by,record_id,version_no,parent_version_id,title,body_text,body_format,body_sha256,attributes,synthetic_demo,reason)
  VALUES(actor,r.id,1,NULL,j->>'title',j->>'body_text',j->>'body_format',knowledge.hash(j->>'body_text'),j->'attributes',(j->>'synthetic_demo')::boolean,j->>'reason') RETURNING id INTO i;
  INSERT INTO knowledge.version_changes VALUES(i,'[]');
  meta=pg_catalog.jsonb_build_object('previous_current_version_id',NULL,'branched_from_noncurrent',false,'indexing',pg_catalog.jsonb_build_object('lexical','ready','semantic',CASE WHEN EXISTS(SELECT 1 FROM knowledge.embedding_profiles WHERE id='openai-te3s-1536-v1' AND status='enabled') THEN 'pending' ELSE 'disabled' END));
 WHEN 'version.create' THEN
  kind='version';PERFORM knowledge.require_public('record',(j->>'record_id')::uuid);
  SELECT * INTO r FROM knowledge.records WHERE id=(j->>'record_id')::uuid FOR UPDATE;
  PERFORM knowledge.require_public('version',(j->>'base_version_id')::uuid);
  SELECT * INTO base FROM knowledge.versions WHERE id=(j->>'base_version_id')::uuid;
  PERFORM knowledge.require(base.record_id=r.id);current_id=knowledge.current_version(r.id);
  m=coalesce(j->'metadata_update','{}'::jsonb);attrs=base.attributes||coalesce(m->'attributes_set','{}'::jsonb);
  FOR key IN SELECT value FROM pg_catalog.jsonb_array_elements_text(coalesce(m->'attributes_remove','[]'::jsonb)) LOOP attrs=attrs-key;END LOOP;
  PERFORM knowledge.attributes(attrs);title=CASE WHEN m?'title' THEN m->>'title' ELSE base.title END;format=coalesce(m->>'body_format',base.body_format);
  changed=title IS DISTINCT FROM base.title OR format<>base.body_format OR attrs<>base.attributes;
  body_text=knowledge.apply_edits(base.body_text,j->>'base_body_sha256',j->'edits',changed);
  PERFORM knowledge.require(pg_catalog.length(knowledge.trim_text(body_text))>0 OR attrs<>'{}'::jsonb);
  UPDATE knowledge.records SET version_counter=version_counter+1 WHERE id=r.id RETURNING * INTO r;
  INSERT INTO knowledge.versions(created_by,record_id,version_no,parent_version_id,title,body_text,body_format,body_sha256,attributes,synthetic_demo,reason)
  VALUES(actor,r.id,r.version_counter,base.id,title,body_text,format,knowledge.hash(body_text),attrs,base.synthetic_demo,j->>'reason') RETURNING id INTO i;
  INSERT INTO knowledge.version_changes VALUES(i,j->'edits');
  meta=pg_catalog.jsonb_build_object('previous_current_version_id',current_id,'branched_from_noncurrent',base.id IS DISTINCT FROM current_id,'indexing',pg_catalog.jsonb_build_object('lexical','ready','semantic',CASE WHEN EXISTS(SELECT 1 FROM knowledge.embedding_profiles WHERE id='openai-te3s-1536-v1' AND status='enabled') THEN 'pending' ELSE 'disabled' END));
 WHEN 'anchor.create' THEN
  kind='anchor';PERFORM knowledge.require_public('version',(j->>'version_id')::uuid);SELECT * INTO v FROM knowledge.versions WHERE id=(j->>'version_id')::uuid;
  PERFORM 1 FROM knowledge.records WHERE id=v.record_id FOR UPDATE;
  PERFORM knowledge.require(v.body_sha256=j->>'body_sha256','BASE_HASH_MISMATCH');sel=j->'selector';s=(sel->>'start')::integer;e=(sel->>'end')::integer;
  PERFORM knowledge.require(e<=pg_catalog.length(v.body_text));
  PERFORM knowledge.require(pg_catalog.substr(v.body_text,s+1,e-s)=sel->>'exact','TEXT_MISMATCH');
  PERFORM knowledge.require(pg_catalog.substr(v.body_text,s-pg_catalog.length(sel->>'prefix')+1,pg_catalog.length(sel->>'prefix'))=sel->>'prefix' AND pg_catalog.substr(v.body_text,e+1,pg_catalog.length(sel->>'suffix'))=sel->>'suffix','TEXT_MISMATCH');
  SELECT * INTO an FROM knowledge.anchors WHERE version_id=v.id AND start_cp=s AND end_cp=e;
  IF an.id IS NOT NULL THEN PERFORM knowledge.require_public('anchor',an.id);i=an.id;
  ELSE
   INSERT INTO knowledge.anchors(created_by,version_id,body_sha256,start_cp,end_cp,exact,prefix,suffix)
   VALUES(actor,v.id,v.body_sha256,s,e,sel->>'exact',pg_catalog.substr(v.body_text,greatest(0,s-32)+1,least(32,s)),pg_catalog.substr(v.body_text,e+1,32)) RETURNING id INTO i;
  END IF;
 WHEN 'source.create' THEN
  kind='source';INSERT INTO knowledge.sources(created_by,url,title,submitted_text,published_at,retrieved_at,rights_note,attributes,synthetic_demo)
  VALUES(actor,j->>'url',j->>'title',j->>'submitted_text',(j->>'published_at')::timestamptz,(j->>'retrieved_at')::timestamptz,j->>'rights_note',j->'attributes',(j->>'synthetic_demo')::boolean) RETURNING id INTO i;
 WHEN 'relation.create' THEN
  kind='relation';PERFORM knowledge.require_ref(j->'from');PERFORM knowledge.require_ref(j->'to');
  INSERT INTO knowledge.relations(created_by,from_version_id,from_anchor_id,from_source_id,to_version_id,to_anchor_id,to_source_id,predicate,explanation,attributes)
  VALUES(actor,knowledge.ref_id(j->'from','version'),knowledge.ref_id(j->'from','anchor'),knowledge.ref_id(j->'from','source'),knowledge.ref_id(j->'to','version'),knowledge.ref_id(j->'to','anchor'),knowledge.ref_id(j->'to','source'),j->>'predicate',j->>'explanation',j->'attributes') RETURNING id INTO i;
 WHEN 'annotation.create' THEN
  kind='annotation';PERFORM knowledge.require_public('anchor',(j->>'anchor_id')::uuid);
  IF j->>'concept_version_id' IS NOT NULL THEN PERFORM knowledge.require_public('version',(j->>'concept_version_id')::uuid);END IF;
  IF j->>'supersedes_annotation_id' IS NOT NULL THEN PERFORM knowledge.require_public('annotation',(j->>'supersedes_annotation_id')::uuid);END IF;
  INSERT INTO knowledge.annotations(created_by,anchor_id,meaning,concept_version_id,attributes,supersedes_annotation_id)
  VALUES(actor,(j->>'anchor_id')::uuid,j->>'meaning',(j->>'concept_version_id')::uuid,j->'attributes',(j->>'supersedes_annotation_id')::uuid) RETURNING id INTO i;
 WHEN 'evidence.create' THEN kind='evidence';i=knowledge.insert_evidence(j->'target',j->'basis',actor);
 WHEN 'review.create' THEN
  kind='review';PERFORM knowledge.require_ref(j->'target');
  IF actor IS NULL THEN
   PERFORM knowledge.require(j->'previous_review_id'='null'::jsonb);prev=NULL;
  ELSE
   SELECT review_id INTO prev FROM knowledge.review_heads WHERE actor_id=actor AND target_kind=j#>>'{target,kind}' AND target_id=(j#>>'{target,id}')::uuid AND focus=j->>'focus' FOR UPDATE;
   PERFORM knowledge.require(prev IS NOT DISTINCT FROM (j->>'previous_review_id')::uuid,'REVIEW_HEAD_CHANGED');
  END IF;
  INSERT INTO knowledge.reviews(created_by,target_version_id,target_anchor_id,target_source_id,target_relation_id,target_annotation_id,target_evidence_id,stance,focus,explanation,previous_review_id)
  VALUES(actor,knowledge.ref_id(j->'target','version'),knowledge.ref_id(j->'target','anchor'),knowledge.ref_id(j->'target','source'),knowledge.ref_id(j->'target','relation'),knowledge.ref_id(j->'target','annotation'),knowledge.ref_id(j->'target','evidence'),j->>'stance',j->>'focus',j->>'explanation',prev) RETURNING id INTO i;
  IF actor IS NOT NULL THEN
   IF prev IS NULL THEN INSERT INTO knowledge.review_heads VALUES(actor,j#>>'{target,kind}',(j#>>'{target,id}')::uuid,j->>'focus',i);
   ELSE UPDATE knowledge.review_heads SET review_id=i WHERE actor_id=actor AND target_kind=j#>>'{target,kind}' AND target_id=(j#>>'{target,id}')::uuid AND focus=j->>'focus';END IF;
  END IF;
 WHEN 'work_request.create' THEN
  kind='work_request';IF j->'target'<>'null'::jsonb THEN PERFORM knowledge.require_ref(j->'target');END IF;
  INSERT INTO knowledge.work_requests(created_by,title,description,target_version_id,target_anchor_id,target_source_id,suggested_query)
  VALUES(actor,j->>'title',j->>'description',knowledge.ref_id(j->'target','version'),knowledge.ref_id(j->'target','anchor'),knowledge.ref_id(j->'target','source'),j->>'suggested_query') RETURNING * INTO wr;i=wr.id;
  INSERT INTO knowledge.work_events(work_request_id,revision,action,reason,actor_id,resolution_refs,state_after,assigned_after,resolution_event_after)
  VALUES(i,1,'create','Created work request',actor,'[]','open',NULL,NULL) RETURNING id INTO ev;meta=pg_catalog.jsonb_build_object('event_id',ev);
 WHEN 'work_request.update' THEN
  kind='work_request';i=(j->>'work_request_id')::uuid;PERFORM knowledge.require_public(kind,i);
  SELECT * INTO wr FROM knowledge.work_requests WHERE id=i FOR UPDATE;
  PERFORM knowledge.require(wr.revision=(j->>'expected_revision')::integer,'TASK_REVISION_CONFLICT');
  is_operator=EXISTS(SELECT 1 FROM knowledge.operators WHERE actor_id=actor);action=j->>'action';new_status=wr.status;assigned=wr.assigned_to;resolution=wr.resolution_event_id;ev=pg_catalog.gen_random_uuid();
  CASE action
  WHEN 'claim' THEN PERFORM knowledge.require(wr.status='open' AND wr.assigned_to IS NULL,'TASK_REVISION_CONFLICT');new_status='in_progress';assigned=actor;
  WHEN 'release' THEN PERFORM knowledge.require(wr.status='in_progress','TASK_REVISION_CONFLICT');PERFORM knowledge.require(wr.assigned_to=actor OR is_operator,'FORBIDDEN');new_status='open';assigned=NULL;resolution=NULL;
  WHEN 'resolve' THEN PERFORM knowledge.require(wr.status IN ('open','in_progress'),'TASK_REVISION_CONFLICT');PERFORM knowledge.require(wr.assigned_to=actor OR wr.created_by=actor OR is_operator,'FORBIDDEN');new_status='resolved';resolution=ev;
  WHEN 'close' THEN PERFORM knowledge.require(wr.status<>'closed','TASK_REVISION_CONFLICT');PERFORM knowledge.require(wr.created_by=actor OR is_operator,'FORBIDDEN');new_status='closed';
  WHEN 'reopen' THEN PERFORM knowledge.require(wr.status IN ('closed','resolved'),'TASK_REVISION_CONFLICT');PERFORM knowledge.require(wr.created_by=actor OR is_operator,'FORBIDDEN');new_status='open';assigned=NULL;resolution=NULL;
  END CASE;
  FOR ref IN SELECT value FROM pg_catalog.jsonb_array_elements(j->'resolution_refs') LOOP PERFORM knowledge.require_ref(ref);END LOOP;
  INSERT INTO knowledge.work_events(id,work_request_id,revision,action,reason,actor_id,resolution_refs,state_after,assigned_after,resolution_event_after)
  VALUES(ev,i,wr.revision+1,action,j->>'reason',actor,
   (SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('kind',value->>'kind','id',(value->>'id')::uuid) ORDER BY n),'[]'::jsonb) FROM pg_catalog.jsonb_array_elements(j->'resolution_refs') WITH ORDINALITY refs(value,n)),new_status,assigned,resolution);
  ord=0;FOR ref IN SELECT value FROM pg_catalog.jsonb_array_elements(j->'resolution_refs') LOOP
   INSERT INTO knowledge.work_resolution_links(event_id,ordinal,target_version_id,target_anchor_id,target_source_id) VALUES(ev,ord,knowledge.ref_id(ref,'version'),knowledge.ref_id(ref,'anchor'),knowledge.ref_id(ref,'source'));ord=ord+1;
  END LOOP;
  UPDATE knowledge.work_requests SET status=new_status,assigned_to=assigned,resolution_event_id=resolution,revision=wr.revision+1,updated_at=pg_catalog.transaction_timestamp() WHERE id=i;
  meta=pg_catalog.jsonb_build_object('event_id',ev);
 END CASE;
 IF op IN ('record.create','version.create','relation.create','annotation.create','review.create') THEN PERFORM knowledge.add_bases(kind,i,j->'basis',actor);END IF;
 IF kind NOT IN ('work_request','evidence') AND NOT(op='anchor.create' AND an.id IS NOT NULL) THEN PERFORM knowledge.index_object(kind,i);END IF;
 INSERT INTO knowledge.audit_events(actor_id,action,target_kind,target_id,metadata_sanitized) VALUES(actor,operation,kind,i,'{}');
 IF actor IS NULL THEN
  INSERT INTO knowledge.anonymous_mutation_receipts(actor_id,operation,idempotency_key,request_hash,sql_command_hash,result_kind,result_id,response_json)
  VALUES(NULL,operation,c->>'idempotency_key',c->>'request_hash',d,kind,i,meta);
 ELSE
  INSERT INTO knowledge.mutation_receipts(actor_id,operation,idempotency_key,request_hash,sql_command_hash,result_kind,result_id,response_json)
  VALUES(actor,operation,c->>'idempotency_key',c->>'request_hash',d,kind,i,meta);
 END IF;
 RETURN pg_catalog.jsonb_build_object('data',knowledge.mutation_result(kind,i,meta),'replayed',false);
END $$;

CREATE OR REPLACE FUNCTION public.kb_health() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT pg_catalog.jsonb_build_object('status',CASE WHEN contract_version='2.1.0' AND migration_tag='stage06-context-anonymous-reviews' THEN 'ok' ELSE 'degraded' END,'database','reachable','contract_version',contract_version) FROM knowledge.schema_info WHERE singleton
$$;
UPDATE knowledge.schema_info SET migration_tag='stage06-context-anonymous-reviews' WHERE singleton;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA knowledge FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
