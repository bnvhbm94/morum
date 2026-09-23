-- Stage07 / read surfaces. Additive only: no table/column drop, no truncate,
-- no extension install, no role alteration. Contract stays 2.1.0.
-- Adds URL canonicalization + quote-checking helpers, three read-only public
-- RPCs (kb_url_report, kb_dossier, kb_attention), self-declared unverified
-- provenance on mutations, and anonymous work_request.create.
-- Rollback: supabase/rollback/202609200110_read_surfaces_down.sql
BEGIN;

-- === 1a: URL canonicalization and quote checking =========================
CREATE FUNCTION knowledge.canonical_url(u text) RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 WITH m AS (
  SELECT pg_catalog.regexp_match(u,'^(https?)://([^/:?#]+)(?::([0-9]+))?([^?#]*)(?:\?([^#]*))?','i') g
 ), parts AS (
  SELECT pg_catalog.lower(g[1]) scheme,pg_catalog.lower(g[2]) host,g[3] port,
   CASE WHEN coalesce(g[4],'')='' THEN '/' ELSE g[4] END path,g[5] query
  FROM m WHERE g IS NOT NULL
 ), path_norm AS (
  SELECT scheme,host,port,
   CASE WHEN pg_catalog.length(path)>1 AND pg_catalog.right(path,1)='/' THEN pg_catalog.left(path,pg_catalog.length(path)-1) ELSE path END path,
   query
  FROM parts
 ), query_norm AS (
  SELECT path_norm.*,(
   SELECT pg_catalog.string_agg(kv,'&' ORDER BY ord) FROM (
    SELECT kv,ord FROM pg_catalog.unnest(pg_catalog.string_to_array(coalesce(query,''),'&')) WITH ORDINALITY t(kv,ord)
    WHERE kv<>'' AND NOT (pg_catalog.split_part(kv,'=',1) ~* '^utm_' OR pg_catalog.split_part(kv,'=',1) IN ('fbclid','gclid','ref','ref_src'))
   ) filtered
  ) q2
  FROM path_norm
 )
 SELECT scheme||'://'||host||
  CASE WHEN port IS NOT NULL AND NOT((scheme='http' AND port='80') OR (scheme='https' AND port='443')) THEN ':'||port ELSE '' END||
  path||
  CASE WHEN q2 IS NOT NULL AND q2<>'' THEN '?'||q2 ELSE '' END
 FROM query_norm
$$;
CREATE INDEX sources_canonical_url_idx ON knowledge.sources (knowledge.canonical_url(url)) WHERE url IS NOT NULL;

CREATE FUNCTION knowledge.normalize_quote(t text) RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 SELECT pg_catalog.btrim(
  pg_catalog.regexp_replace(
   pg_catalog.regexp_replace(
    pg_catalog.regexp_replace(
     pg_catalog.regexp_replace(
      pg_catalog.regexp_replace(normalize(t,NFKC),
       '['||pg_catalog.chr(8203)||'-'||pg_catalog.chr(8205)||pg_catalog.chr(65279)||']','','g'),
      '['||pg_catalog.chr(8216)||pg_catalog.chr(8217)||']','''','g'),
     '['||pg_catalog.chr(8220)||pg_catalog.chr(8221)||']','"','g'),
    '['||pg_catalog.chr(8211)||pg_catalog.chr(8212)||pg_catalog.chr(8210)||']','-','g'),
   '[\s'||pg_catalog.chr(160)||']+',' ','g')
 )
$$;

CREATE FUNCTION knowledge.quote_check(quote text,submitted text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE nq text;ns text;frags text[];frag text;last_pos integer=0;pos integer;ok boolean=true;n integer;i integer;BEGIN
 IF quote IS NULL OR pg_catalog.length(knowledge.trim_text(quote))=0 THEN RETURN 'no_quote';END IF;
 IF submitted IS NULL OR pg_catalog.length(knowledge.trim_text(submitted))=0 THEN RETURN 'no_text';END IF;
 IF pg_catalog.strpos(submitted,quote)>0 THEN RETURN 'found_exact';END IF;
 nq=knowledge.normalize_quote(quote);ns=knowledge.normalize_quote(submitted);
 IF pg_catalog.strpos(ns,nq)>0 THEN RETURN 'found_normalized';END IF;
 frags=pg_catalog.regexp_split_to_array(nq,'('||pg_catalog.chr(8230)||'|[.][.][.])');
 n=coalesce(pg_catalog.array_length(frags,1),0);
 IF n>=2 THEN
  FOR i IN 1..n LOOP
   frag=pg_catalog.btrim(frags[i]);
   IF pg_catalog.length(frag)>=4 THEN
    pos=pg_catalog.strpos(pg_catalog.substr(ns,last_pos+1),frag);
    IF pos=0 THEN ok=false;EXIT;END IF;
    last_pos=last_pos+pos+pg_catalog.length(frag)-1;
   END IF;
  END LOOP;
  IF ok THEN RETURN 'found_fragments';END IF;
 END IF;
 RETURN 'not_found';
END $$;

CREATE FUNCTION knowledge.evidence_quote_check(e knowledge.evidence) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE WHEN e.kind='external' THEN
  pg_catalog.jsonb_build_object('state',knowledge.quote_check(e.quote,(SELECT s.submitted_text FROM knowledge.sources s WHERE s.id=e.source_id)),'source_id',e.source_id)
 ELSE pg_catalog.jsonb_build_object('state','not_applicable','source_id',NULL) END
$$;

-- === 1e: provenance table + relaxed anonymous work requests ==============
CREATE TABLE knowledge.provenance (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 result_kind text NOT NULL,
 result_id uuid NOT NULL,
 actor_id uuid NULL REFERENCES knowledge.actors(id) ON DELETE RESTRICT,
 declared jsonb NOT NULL CHECK(pg_catalog.jsonb_typeof(declared)='object'),
 created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp()
);
CREATE INDEX provenance_result_idx ON knowledge.provenance(result_kind,result_id);
ALTER TABLE knowledge.provenance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON knowledge.provenance FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER provenance_immutable BEFORE UPDATE OR DELETE ON knowledge.provenance
 FOR EACH ROW EXECUTE FUNCTION knowledge.immutable_row();

-- Anonymous authorship never populated created_by/actor_id here; now optional.
ALTER TABLE knowledge.work_requests ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE knowledge.work_events ALTER COLUMN actor_id DROP NOT NULL;

-- Copy of the 0107 authorize_context, plus an optional, self-declared,
-- unverified `agent` envelope field and anonymous work_request.create.
CREATE OR REPLACE FUNCTION knowledge.authorize_context(c jsonb) RETURNS uuid LANGUAGE plpgsql SET search_path='' AS $$
DECLARE a knowledge.actors%ROWTYPE;k knowledge.agent_keys%ROWTYPE;ac jsonb;BEGIN
 PERFORM knowledge.jobject(c,ARRAY['actor','operation','idempotency_key','request_hash','agent'],ARRAY['actor','operation','idempotency_key','request_hash']);
 IF c?'agent' THEN
  PERFORM knowledge.jobject(c->'agent',ARRAY['model','harness','operator'],ARRAY[]::text[]);
  IF (c->'agent')?'model' THEN PERFORM knowledge.jtext(c#>'{agent,model}',80);END IF;
  IF (c->'agent')?'harness' THEN PERFORM knowledge.jtext(c#>'{agent,harness}',80);END IF;
  IF (c->'agent')?'operator' THEN PERFORM knowledge.jtext(c#>'{agent,operator}',80);END IF;
 END IF;
 ac=c->'actor';
 IF ac->>'kind'='anonymous' THEN
  PERFORM knowledge.jobject(ac,ARRAY['kind'],ARRAY['kind']);
  PERFORM knowledge.jhash(c->'request_hash');PERFORM knowledge.jtext(c->'operation',160);
  PERFORM knowledge.require(c->>'idempotency_key' ~ '^[A-Za-z0-9._~-]{16,128}$');
  PERFORM knowledge.require(c->>'operation' IN ('record.create','anchor.create','source.create','annotation.create','relation.create','evidence.create','review.create','work_request.create')
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

-- Copy of the 0107 mutate, plus: only work_request.update is forbidden for
-- anonymous actors (work_request.create is now allowed), and a self-declared
-- unverified provenance row is recorded when the context carries `agent`.
CREATE OR REPLACE FUNCTION knowledge.mutate(op text,c jsonb,j jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE actor uuid;operation text;receipt knowledge.mutation_receipts%ROWTYPE;d text;kind text;i uuid;meta jsonb='{}';
 v knowledge.versions%ROWTYPE;base knowledge.versions%ROWTYPE;r knowledge.records%ROWTYPE;current_id uuid;
 body_text text;attrs jsonb;title text;format text;m jsonb;key text;changed boolean;an knowledge.anchors%ROWTYPE;sel jsonb;s integer;e integer;
 prev uuid;wr knowledge.work_requests%ROWTYPE;ev uuid;is_operator boolean;action text;new_status text;assigned uuid;resolution uuid;ref jsonb;ord integer;
BEGIN
 PERFORM knowledge.validate_command(op,j);actor=knowledge.authorize_context(c);
 IF actor IS NULL THEN PERFORM knowledge.require(op<>'work_request.update','FORBIDDEN');END IF;
 operation=op||CASE WHEN op='version.create' THEN ':'||(j->>'record_id')::uuid::text WHEN op='work_request.update' THEN ':'||(j->>'work_request_id')::uuid::text ELSE '' END;
 PERFORM knowledge.require(c->>'operation'=operation);d=knowledge.hash(j::text);
 IF actor IS NULL THEN
  -- Fence -> receipt -> record order. Same key serializes even across different HTTP clients.
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
  -- Also serialize duplicate anchors across DIFFERENT actors using the owning record.
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
   -- Anonymous reviews are append-only. Never invent a common author/head or erase an earlier vote.
   PERFORM knowledge.require(j->'previous_review_id'='null'::jsonb);prev=NULL;
  ELSE
   SELECT review_id INTO prev FROM knowledge.review_heads WHERE actor_id=actor AND target_kind=j#>>'{target,kind}' AND target_id=(j#>>'{target,id}')::uuid AND focus=j->>'focus' FOR UPDATE;
   PERFORM knowledge.require(prev IS NOT DISTINCT FROM (j->>'previous_review_id')::uuid,'REVIEW_HEAD_CHANGED');
  END IF;
  INSERT INTO knowledge.reviews(created_by,target_version_id,target_anchor_id,target_source_id,target_relation_id,target_annotation_id,target_evidence_id,stance,focus,explanation,previous_review_id)
  VALUES(actor,knowledge.ref_id(j->'target','version'),knowledge.ref_id(j->'target','anchor'),knowledge.ref_id(j->'target','source'),knowledge.ref_id(j->'target','relation'),knowledge.ref_id(j->'target','annotation'),knowledge.ref_id(j->'target','evidence'),j->>'stance',j->>'focus',j->>'explanation',prev) RETURNING id INTO i;
  -- Actor lock makes a missing slot safe; NO NULL head is ever inserted.
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
 -- Self-declared, unverified provenance. Never part of the idempotency hash:
 -- a retry with a different `agent` header still replays the same result.
 IF c ? 'agent' THEN INSERT INTO knowledge.provenance(result_kind,result_id,actor_id,declared) VALUES(kind,i,actor,c->'agent');END IF;
 RETURN pg_catalog.jsonb_build_object('data',knowledge.mutation_result(kind,i,meta),'replayed',false);
END $$;

-- === 1d support: candidate reasons the server never judges truth on ======
CREATE FUNCTION knowledge.attention_candidates() RETURNS TABLE(reason text,priority integer,target_kind text,target_id uuid,record_id uuid,version_id uuid,title text,snippet text,since timestamptz,detail jsonb)
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH cur AS (
  SELECT v.* FROM knowledge.versions v WHERE knowledge.is_public('version',v.id) AND v.id=knowledge.current_version(v.record_id) AND NOT v.synthetic_demo
 )
 SELECT 'quote_not_found',0,'evidence',e.id,NULL::uuid,NULL::uuid,NULL::text,pg_catalog.left(coalesce(e.explanation,''),200),e.created_at,
  pg_catalog.jsonb_build_object('quote_state','not_found')
 FROM knowledge.evidence e WHERE e.kind='external' AND knowledge.is_public('evidence',e.id) AND (knowledge.evidence_quote_check(e)->>'state')='not_found'
 UNION ALL
 SELECT 'contested',1,'version',v.id,v.record_id,v.id,v.title,pg_catalog.left(coalesce(v.body_text,''),200),v.created_at,
  pg_catalog.jsonb_build_object('disagree_count',(SELECT count(*) FROM knowledge.reviews rv WHERE rv.stance='disagree' AND knowledge.is_public('review',rv.id) AND (
    rv.id IN (SELECT h.review_id FROM knowledge.review_heads h WHERE (h.target_kind='version' AND h.target_id=v.id) OR (h.target_kind='anchor' AND h.target_id IN (SELECT a.id FROM knowledge.anchors a WHERE a.version_id=v.id)))
    OR (rv.created_by IS NULL AND (rv.target_version_id=v.id OR rv.target_anchor_id IN (SELECT a.id FROM knowledge.anchors a WHERE a.version_id=v.id))))))
 FROM cur v
 WHERE EXISTS(SELECT 1 FROM knowledge.reviews rv WHERE rv.stance='disagree' AND knowledge.is_public('review',rv.id) AND (
    rv.id IN (SELECT h.review_id FROM knowledge.review_heads h WHERE (h.target_kind='version' AND h.target_id=v.id) OR (h.target_kind='anchor' AND h.target_id IN (SELECT a.id FROM knowledge.anchors a WHERE a.version_id=v.id)))
    OR (rv.created_by IS NULL AND (rv.target_version_id=v.id OR rv.target_anchor_id IN (SELECT a.id FROM knowledge.anchors a WHERE a.version_id=v.id)))))
 AND NOT EXISTS(SELECT 1 FROM knowledge.relations rc WHERE rc.predicate='corrects' AND knowledge.is_public('relation',rc.id) AND rc.to_version_id=v.id)
 UNION ALL
 SELECT 'no_basis',2,'relation',r.id,NULL::uuid,NULL::uuid,NULL::text,pg_catalog.left(coalesce(r.explanation,''),200),r.created_at,'{}'::jsonb
 FROM knowledge.relations r WHERE knowledge.is_public('relation',r.id) AND NOT EXISTS(SELECT 1 FROM knowledge.evidence e WHERE e.target_relation_id=r.id AND knowledge.is_public('evidence',e.id))
 UNION ALL
 SELECT 'no_basis',2,'version',v.id,v.record_id,v.id,v.title,pg_catalog.left(coalesce(v.body_text,''),200),v.created_at,'{}'::jsonb
 FROM cur v WHERE v.version_no>1 AND NOT EXISTS(SELECT 1 FROM knowledge.evidence e WHERE e.target_version_id=v.id AND knowledge.is_public('evidence',e.id))
 UNION ALL
 SELECT 'requested',3,'work_request',wr.id,NULL::uuid,NULL::uuid,wr.title,pg_catalog.left(coalesce(wr.description,''),200),wr.created_at,pg_catalog.jsonb_build_object('status',wr.status)
 FROM knowledge.work_requests wr WHERE wr.status='open' AND wr.visibility='public'
 UNION ALL
 SELECT 'quote_unverifiable',4,'evidence',e.id,NULL::uuid,NULL::uuid,NULL::text,pg_catalog.left(coalesce(e.explanation,''),200),e.created_at,pg_catalog.jsonb_build_object('quote_state','no_text')
 FROM knowledge.evidence e WHERE e.kind='external' AND knowledge.is_public('evidence',e.id) AND (knowledge.evidence_quote_check(e)->>'state')='no_text'
 UNION ALL
 SELECT 'unreviewed',5,'version',v.id,v.record_id,v.id,v.title,pg_catalog.left(coalesce(v.body_text,''),200),v.created_at,'{}'::jsonb
 FROM cur v WHERE v.created_at<pg_catalog.clock_timestamp()-interval '1 hour'
  AND NOT EXISTS(SELECT 1 FROM knowledge.reviews rv WHERE knowledge.is_public('review',rv.id) AND (rv.target_version_id=v.id OR rv.target_anchor_id IN (SELECT a.id FROM knowledge.anchors a WHERE a.version_id=v.id)))
 UNION ALL
 SELECT 'uncategorized',6,'version',v.id,v.record_id,v.id,v.title,pg_catalog.left(coalesce(v.body_text,''),200),v.created_at,'{}'::jsonb
 FROM cur v WHERE NOT (v.attributes ? 'topic' AND pg_catalog.jsonb_typeof(v.attributes->'topic')='string')
$$;

-- === 1b: URL report =======================================================
CREATE FUNCTION public.kb_url_report(p_query jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u text;canon text;scount integer;ccount integer;corrcount integer;sources jsonb;citations jsonb;corrections jsonb;qstates jsonb;BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock_shared(2081801,1);
 PERFORM knowledge.jobject(p_query,ARRAY['url'],ARRAY['url']);
 u=knowledge.jtext(p_query->'url',2048);
 PERFORM knowledge.require(u ~* '^https?://[^[:space:]]+$','VALIDATION_FAILED');
 canon=knowledge.canonical_url(u);
 PERFORM knowledge.require(canon IS NOT NULL,'VALIDATION_FAILED');

 SELECT count(*) INTO scount FROM knowledge.sources s WHERE knowledge.is_public('source',s.id) AND knowledge.canonical_url(s.url)=canon;
 SELECT coalesce(pg_catalog.jsonb_agg(x ORDER BY ca DESC,sid),'[]'::jsonb) INTO sources FROM (
  SELECT pg_catalog.jsonb_build_object('id',s.id,'url',s.url,'title',s.title,'published_at',knowledge.utc(s.published_at),'retrieved_at',knowledge.utc(s.retrieved_at),
    'has_text',coalesce(pg_catalog.length(knowledge.trim_text(s.submitted_text))>0,false),'created_by',s.created_by,'created_at',knowledge.utc(s.created_at),
    'review_summary',knowledge.review_summary('source',s.id)) x,s.created_at ca,s.id sid
  FROM knowledge.sources s WHERE knowledge.is_public('source',s.id) AND knowledge.canonical_url(s.url)=canon
  ORDER BY s.created_at DESC,s.id LIMIT 20
 ) t;

 SELECT count(*) INTO ccount FROM knowledge.evidence e WHERE e.kind='external' AND knowledge.is_public('evidence',e.id)
  AND EXISTS(SELECT 1 FROM knowledge.sources s WHERE s.id=e.source_id AND knowledge.is_public('source',s.id) AND knowledge.canonical_url(s.url)=canon);

 SELECT coalesce(pg_catalog.jsonb_object_agg(state,cnt),'{}'::jsonb) INTO qstates FROM (
  SELECT knowledge.evidence_quote_check(e)->>'state' state,count(*) cnt
  FROM knowledge.evidence e WHERE e.kind='external' AND knowledge.is_public('evidence',e.id)
   AND EXISTS(SELECT 1 FROM knowledge.sources s WHERE s.id=e.source_id AND knowledge.is_public('source',s.id) AND knowledge.canonical_url(s.url)=canon)
  GROUP BY 1
 ) g;
 qstates=pg_catalog.jsonb_build_object('found_exact',coalesce((qstates->>'found_exact')::integer,0),'found_normalized',coalesce((qstates->>'found_normalized')::integer,0),
  'found_fragments',coalesce((qstates->>'found_fragments')::integer,0),'not_found',coalesce((qstates->>'not_found')::integer,0),
  'no_text',coalesce((qstates->>'no_text')::integer,0),'no_quote',coalesce((qstates->>'no_quote')::integer,0));

 SELECT coalesce(pg_catalog.jsonb_agg(x ORDER BY ca DESC),'[]'::jsonb) INTO citations FROM (
  SELECT pg_catalog.jsonb_build_object('evidence_id',e.id,'source_id',e.source_id,'target',knowledge.row_ref(pg_catalog.to_jsonb(e),'target'),
    'record_id',v.record_id,'version_id',v.id,'title',v.title,
    'is_current',CASE WHEN v.id IS NULL THEN NULL ELSE v.id=knowledge.current_version(v.record_id) END,
    'quote',e.quote,'explanation',e.explanation,'quote_check',knowledge.evidence_quote_check(e),'created_at',knowledge.utc(e.created_at)) x,e.created_at ca
  FROM knowledge.evidence e
  LEFT JOIN knowledge.versions v ON v.id=CASE WHEN e.target_version_id IS NOT NULL THEN e.target_version_id WHEN e.target_anchor_id IS NOT NULL THEN (SELECT a.version_id FROM knowledge.anchors a WHERE a.id=e.target_anchor_id) ELSE NULL END
  WHERE e.kind='external' AND knowledge.is_public('evidence',e.id)
   AND EXISTS(SELECT 1 FROM knowledge.sources s WHERE s.id=e.source_id AND knowledge.is_public('source',s.id) AND knowledge.canonical_url(s.url)=canon)
  ORDER BY e.created_at DESC LIMIT 50
 ) t;

 SELECT count(*) INTO corrcount FROM knowledge.relations r WHERE r.predicate='corrects' AND knowledge.is_public('relation',r.id) AND (
   r.to_version_id IN (SELECT CASE WHEN e2.target_version_id IS NOT NULL THEN e2.target_version_id WHEN e2.target_anchor_id IS NOT NULL THEN (SELECT a.version_id FROM knowledge.anchors a WHERE a.id=e2.target_anchor_id) ELSE NULL END
     FROM knowledge.evidence e2 WHERE e2.kind='external' AND knowledge.is_public('evidence',e2.id) AND EXISTS(SELECT 1 FROM knowledge.sources s WHERE s.id=e2.source_id AND knowledge.is_public('source',s.id) AND knowledge.canonical_url(s.url)=canon))
   OR r.to_anchor_id IN (SELECT a.id FROM knowledge.anchors a WHERE a.version_id IN (SELECT CASE WHEN e2.target_version_id IS NOT NULL THEN e2.target_version_id WHEN e2.target_anchor_id IS NOT NULL THEN (SELECT a2.version_id FROM knowledge.anchors a2 WHERE a2.id=e2.target_anchor_id) ELSE NULL END
     FROM knowledge.evidence e2 WHERE e2.kind='external' AND knowledge.is_public('evidence',e2.id) AND EXISTS(SELECT 1 FROM knowledge.sources s WHERE s.id=e2.source_id AND knowledge.is_public('source',s.id) AND knowledge.canonical_url(s.url)=canon)))
 );
 SELECT coalesce(pg_catalog.jsonb_agg(x ORDER BY ca DESC),'[]'::jsonb) INTO corrections FROM (
  SELECT pg_catalog.jsonb_build_object('relation_id',r.id,'correcting',knowledge.row_ref(pg_catalog.to_jsonb(r),'from'),'corrected',knowledge.row_ref(pg_catalog.to_jsonb(r),'to'),
    'explanation',r.explanation,'created_at',knowledge.utc(r.created_at)) x,r.created_at ca
  FROM knowledge.relations r WHERE r.predicate='corrects' AND knowledge.is_public('relation',r.id) AND (
    r.to_version_id IN (SELECT CASE WHEN e2.target_version_id IS NOT NULL THEN e2.target_version_id WHEN e2.target_anchor_id IS NOT NULL THEN (SELECT a.version_id FROM knowledge.anchors a WHERE a.id=e2.target_anchor_id) ELSE NULL END
      FROM knowledge.evidence e2 WHERE e2.kind='external' AND knowledge.is_public('evidence',e2.id) AND EXISTS(SELECT 1 FROM knowledge.sources s WHERE s.id=e2.source_id AND knowledge.is_public('source',s.id) AND knowledge.canonical_url(s.url)=canon))
    OR r.to_anchor_id IN (SELECT a.id FROM knowledge.anchors a WHERE a.version_id IN (SELECT CASE WHEN e2.target_version_id IS NOT NULL THEN e2.target_version_id WHEN e2.target_anchor_id IS NOT NULL THEN (SELECT a2.version_id FROM knowledge.anchors a2 WHERE a2.id=e2.target_anchor_id) ELSE NULL END
      FROM knowledge.evidence e2 WHERE e2.kind='external' AND knowledge.is_public('evidence',e2.id) AND EXISTS(SELECT 1 FROM knowledge.sources s WHERE s.id=e2.source_id AND knowledge.is_public('source',s.id) AND knowledge.canonical_url(s.url)=canon)))
  )
  ORDER BY r.created_at DESC LIMIT 20
 ) t;

 RETURN pg_catalog.jsonb_build_object('url',p_query->'url','canonical_url',canon,'sources',sources,'citations',citations,'corrections',corrections,
  'counts',pg_catalog.jsonb_build_object('sources',scount,'citations',ccount,'corrections',corrcount,'quote_states',qstates),
  'truncated',pg_catalog.jsonb_build_object('sources',scount>20,'citations',ccount>50,'corrections',corrcount>20),
  'generated_at',knowledge.utc(pg_catalog.clock_timestamp()));
END $$;

-- === 1c: dossier ==========================================================
CREATE FUNCTION public.kb_dossier(p_query jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target jsonb;vid uuid;v knowledge.versions%ROWTYPE;blind boolean;anchor_ids uuid[];
 corrections jsonb;corr_total integer;corr_cap integer=10;
 reviews jsonb;rev_total integer;review_cap integer=20;
 contradicts jsonb;contra_total integer;contra_cap integer=10;
 keyed_actors integer;anon_reviews integer;declared_families integer;agree_keyed integer;agree_anon integer;
 evidence jsonb;evidence_total integer;evidence_cap integer=10;
 premises jsonb;premises_total integer;premises_cap integer=10;
 meanings jsonb;meanings_total integer;meanings_cap integer=30;
 related jsonb;related_total integer;related_cap integer=10;
 omitted jsonb;ver_count integer;BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock_shared(2081801,1);
 PERFORM knowledge.jobject(p_query,ARRAY['target','blind'],ARRAY['target']);
 target=p_query->'target';PERFORM knowledge.validate_ref(target,ARRAY['version']);PERFORM knowledge.require_ref(target);
 vid=(target->>'id')::uuid;SELECT * INTO v FROM knowledge.versions WHERE id=vid;
 PERFORM knowledge.require(NOT(p_query?'blind') OR pg_catalog.jsonb_typeof(p_query->'blind')='boolean','VALIDATION_FAILED');
 blind=coalesce((p_query->>'blind')::boolean,false);

 SELECT coalesce(pg_catalog.array_agg(a.id),'{}'::uuid[]) INTO anchor_ids FROM knowledge.anchors a WHERE a.version_id=vid AND knowledge.is_public('anchor',a.id);

 SELECT count(*) INTO corr_total FROM knowledge.relations r WHERE r.predicate='corrects' AND knowledge.is_public('relation',r.id) AND (r.to_version_id=vid OR r.to_anchor_id=ANY(anchor_ids));
 SELECT coalesce(pg_catalog.jsonb_agg(x ORDER BY ca DESC),'[]'::jsonb) INTO corrections FROM (
  SELECT pg_catalog.jsonb_build_object('relation_id',r.id,'from',knowledge.row_ref(pg_catalog.to_jsonb(r),'from'),'version_id',r.fv,
    'title',(SELECT vv.title FROM knowledge.versions vv WHERE vv.id=r.fv),'explanation',r.explanation,'created_at',knowledge.utc(r.created_at)) x,r.created_at ca
  FROM (SELECT r2.*,CASE WHEN r2.from_version_id IS NOT NULL THEN r2.from_version_id WHEN r2.from_anchor_id IS NOT NULL THEN (SELECT a.version_id FROM knowledge.anchors a WHERE a.id=r2.from_anchor_id) ELSE NULL END fv
        FROM knowledge.relations r2 WHERE r2.predicate='corrects' AND knowledge.is_public('relation',r2.id) AND (r2.to_version_id=vid OR r2.to_anchor_id=ANY(anchor_ids))) r
  ORDER BY r.created_at DESC LIMIT corr_cap
 ) t;

 SELECT count(*) INTO rev_total FROM knowledge.reviews rv WHERE rv.stance IN ('disagree','needs_review') AND knowledge.is_public('review',rv.id) AND (
   rv.id IN (SELECT h.review_id FROM knowledge.review_heads h WHERE (h.target_kind='version' AND h.target_id=vid) OR (h.target_kind='anchor' AND h.target_id=ANY(anchor_ids)))
   OR (rv.created_by IS NULL AND (rv.target_version_id=vid OR rv.target_anchor_id=ANY(anchor_ids))));
 IF blind THEN reviews='[]'::jsonb;
 ELSE
  SELECT coalesce(pg_catalog.jsonb_agg(x ORDER BY pr,ca DESC),'[]'::jsonb) INTO reviews FROM (
   SELECT pg_catalog.jsonb_build_object('id',rv.id,'stance',rv.stance,'focus',rv.focus,'on',knowledge.row_ref(pg_catalog.to_jsonb(rv),'target'),
     'created_by',rv.created_by,'created_at',knowledge.utc(rv.created_at),
     'declared',(SELECT p.declared FROM knowledge.provenance p WHERE p.result_kind='review' AND p.result_id=rv.id ORDER BY p.created_at DESC LIMIT 1),
     'explanation',rv.explanation) x,CASE rv.stance WHEN 'disagree' THEN 0 ELSE 1 END pr,rv.created_at ca
   FROM knowledge.reviews rv WHERE rv.stance IN ('disagree','needs_review') AND knowledge.is_public('review',rv.id) AND (
     rv.id IN (SELECT h.review_id FROM knowledge.review_heads h WHERE (h.target_kind='version' AND h.target_id=vid) OR (h.target_kind='anchor' AND h.target_id=ANY(anchor_ids)))
     OR (rv.created_by IS NULL AND (rv.target_version_id=vid OR rv.target_anchor_id=ANY(anchor_ids))))
   ORDER BY CASE rv.stance WHEN 'disagree' THEN 0 ELSE 1 END,rv.created_at DESC LIMIT review_cap
  ) t;
 END IF;

 SELECT count(*) INTO contra_total FROM knowledge.relations r WHERE r.predicate='contradicts' AND knowledge.is_public('relation',r.id) AND (r.to_version_id=vid OR r.to_anchor_id=ANY(anchor_ids));
 SELECT coalesce(pg_catalog.jsonb_agg(x ORDER BY ca DESC),'[]'::jsonb) INTO contradicts FROM (
  SELECT pg_catalog.jsonb_build_object('relation_id',r.id,'from',knowledge.row_ref(pg_catalog.to_jsonb(r),'from'),'version_id',r.fv,
    'title',(SELECT vv.title FROM knowledge.versions vv WHERE vv.id=r.fv),'explanation',r.explanation,'created_at',knowledge.utc(r.created_at)) x,r.created_at ca
  FROM (SELECT r2.*,CASE WHEN r2.from_version_id IS NOT NULL THEN r2.from_version_id WHEN r2.from_anchor_id IS NOT NULL THEN (SELECT a.version_id FROM knowledge.anchors a WHERE a.id=r2.from_anchor_id) ELSE NULL END fv
        FROM knowledge.relations r2 WHERE r2.predicate='contradicts' AND knowledge.is_public('relation',r2.id) AND (r2.to_version_id=vid OR r2.to_anchor_id=ANY(anchor_ids))) r
  ORDER BY r.created_at DESC LIMIT contra_cap
 ) t;

 SELECT count(DISTINCT h.actor_id) INTO keyed_actors FROM knowledge.review_heads h JOIN knowledge.reviews rv ON rv.id=h.review_id
  WHERE rv.stance IN ('disagree','needs_review') AND knowledge.is_public('review',rv.id) AND ((h.target_kind='version' AND h.target_id=vid) OR (h.target_kind='anchor' AND h.target_id=ANY(anchor_ids)));
 SELECT count(*) INTO anon_reviews FROM knowledge.reviews rv WHERE rv.created_by IS NULL AND rv.stance IN ('disagree','needs_review') AND knowledge.is_public('review',rv.id) AND (rv.target_version_id=vid OR rv.target_anchor_id=ANY(anchor_ids));
 SELECT count(DISTINCT pg_catalog.lower(p.declared->>'model')) INTO declared_families FROM knowledge.provenance p JOIN knowledge.reviews rv ON rv.id=p.result_id AND p.result_kind='review'
  WHERE rv.stance IN ('disagree','needs_review') AND knowledge.is_public('review',rv.id) AND (rv.target_version_id=vid OR rv.target_anchor_id=ANY(anchor_ids)) AND p.declared->>'model' IS NOT NULL;
 declared_families=coalesce(declared_families,0);

 SELECT count(DISTINCT h.actor_id) INTO agree_keyed FROM knowledge.review_heads h JOIN knowledge.reviews rv ON rv.id=h.review_id
  WHERE rv.stance='agree' AND knowledge.is_public('review',rv.id) AND ((h.target_kind='version' AND h.target_id=vid) OR (h.target_kind='anchor' AND h.target_id=ANY(anchor_ids)));
 SELECT count(*) INTO agree_anon FROM knowledge.reviews rv WHERE rv.created_by IS NULL AND rv.stance='agree' AND knowledge.is_public('review',rv.id) AND (rv.target_version_id=vid OR rv.target_anchor_id=ANY(anchor_ids));

 SELECT count(*) INTO evidence_total FROM knowledge.evidence ev WHERE ev.target_version_id=vid AND knowledge.is_public('evidence',ev.id);
 SELECT coalesce(pg_catalog.jsonb_agg(x ORDER BY ca),'[]'::jsonb) INTO evidence FROM (
  SELECT knowledge.dto('evidence',ev.id)||pg_catalog.jsonb_build_object('quote_check',knowledge.evidence_quote_check(ev)) x,ev.created_at ca
  FROM knowledge.evidence ev WHERE ev.target_version_id=vid AND knowledge.is_public('evidence',ev.id)
  ORDER BY ev.created_at LIMIT evidence_cap
 ) t;

 SELECT count(*) INTO premises_total FROM (
  SELECT DISTINCT ON (pv) pv FROM (
   SELECT CASE WHEN r.to_version_id IS NOT NULL THEN r.to_version_id WHEN r.to_anchor_id IS NOT NULL THEN (SELECT a.version_id FROM knowledge.anchors a WHERE a.id=r.to_anchor_id) ELSE NULL END pv
   FROM knowledge.relations r WHERE r.predicate='depends_on' AND r.from_version_id=vid AND knowledge.is_public('relation',r.id)
   UNION ALL
   SELECT CASE WHEN ev.source_version_id IS NOT NULL THEN ev.source_version_id WHEN ev.source_anchor_id IS NOT NULL THEN (SELECT a.version_id FROM knowledge.anchors a WHERE a.id=ev.source_anchor_id) ELSE NULL END pv
   FROM knowledge.evidence ev WHERE ev.kind='internal' AND ev.target_version_id=vid AND knowledge.is_public('evidence',ev.id)
  ) raw WHERE pv IS NOT NULL
 ) d;
 SELECT coalesce(pg_catalog.jsonb_agg(x ORDER BY pv),'[]'::jsonb) INTO premises FROM (
  SELECT pg_catalog.jsonb_build_object('relation_id',d.relation_id,'evidence_id',d.evidence_id,'to',d.tgt,'version_id',d.pv,'title',vv.title,
    'is_current',(d.pv=knowledge.current_version(vv.record_id)),
    'status',pg_catalog.jsonb_build_object(
     'corrected',EXISTS(SELECT 1 FROM knowledge.relations rc WHERE rc.predicate='corrects' AND rc.to_version_id=d.pv AND knowledge.is_public('relation',rc.id)),
     'disputed',EXISTS(SELECT 1 FROM knowledge.reviews rv WHERE rv.stance='disagree' AND knowledge.is_public('review',rv.id) AND (
       rv.id IN (SELECT h.review_id FROM knowledge.review_heads h WHERE h.target_kind='version' AND h.target_id=d.pv)
       OR (rv.created_by IS NULL AND rv.target_version_id=d.pv))))) x,d.pv pv
  FROM (
   SELECT DISTINCT ON (pv) * FROM (
    SELECT r.id relation_id,NULL::uuid evidence_id,knowledge.row_ref(pg_catalog.to_jsonb(r),'to') tgt,
     CASE WHEN r.to_version_id IS NOT NULL THEN r.to_version_id WHEN r.to_anchor_id IS NOT NULL THEN (SELECT a.version_id FROM knowledge.anchors a WHERE a.id=r.to_anchor_id) ELSE NULL END pv
    FROM knowledge.relations r WHERE r.predicate='depends_on' AND r.from_version_id=vid AND knowledge.is_public('relation',r.id)
    UNION ALL
    SELECT NULL::uuid,ev.id,knowledge.row_ref(pg_catalog.to_jsonb(ev),'source') tgt,
     CASE WHEN ev.source_version_id IS NOT NULL THEN ev.source_version_id WHEN ev.source_anchor_id IS NOT NULL THEN (SELECT a.version_id FROM knowledge.anchors a WHERE a.id=ev.source_anchor_id) ELSE NULL END pv
    FROM knowledge.evidence ev WHERE ev.kind='internal' AND ev.target_version_id=vid AND knowledge.is_public('evidence',ev.id)
   ) raw WHERE pv IS NOT NULL ORDER BY pv
  ) d
  LEFT JOIN knowledge.versions vv ON vv.id=d.pv
  ORDER BY d.pv LIMIT premises_cap
 ) t;

 SELECT count(*) INTO meanings_total FROM knowledge.annotations an JOIN knowledge.anchors a ON a.id=an.anchor_id WHERE a.version_id=vid AND knowledge.is_public('annotation',an.id)
  AND NOT EXISTS(SELECT 1 FROM knowledge.annotations newer WHERE newer.supersedes_annotation_id=an.id AND knowledge.is_public('annotation',newer.id));
 SELECT coalesce(pg_catalog.jsonb_agg(x ORDER BY st),'[]'::jsonb) INTO meanings FROM (
  SELECT pg_catalog.jsonb_build_object('annotation_id',an.id,'anchor_id',an.anchor_id,'start',a.start_cp,'end',a.end_cp,'exact',a.exact,'meaning',an.meaning,
    'concept_version_id',an.concept_version_id,'created_at',knowledge.utc(an.created_at)) x,a.start_cp st
  FROM knowledge.annotations an JOIN knowledge.anchors a ON a.id=an.anchor_id
  WHERE a.version_id=vid AND knowledge.is_public('annotation',an.id)
   AND NOT EXISTS(SELECT 1 FROM knowledge.annotations newer WHERE newer.supersedes_annotation_id=an.id AND knowledge.is_public('annotation',newer.id))
  ORDER BY a.start_cp LIMIT meanings_cap
 ) t;

 SELECT count(*) INTO related_total FROM knowledge.relations r WHERE knowledge.is_public('relation',r.id) AND (
   r.from_version_id=vid OR r.to_version_id=vid OR r.from_anchor_id=ANY(anchor_ids) OR r.to_anchor_id=ANY(anchor_ids))
  AND NOT(r.predicate='corrects' AND (r.to_version_id=vid OR r.to_anchor_id=ANY(anchor_ids)))
  AND NOT(r.predicate='contradicts' AND (r.to_version_id=vid OR r.to_anchor_id=ANY(anchor_ids)))
  AND NOT(r.predicate='depends_on' AND r.from_version_id=vid);
 SELECT coalesce(pg_catalog.jsonb_agg(x ORDER BY ca DESC),'[]'::jsonb) INTO related FROM (
  SELECT pg_catalog.jsonb_build_object('relation_id',r.id,'predicate',r.predicate,
    'direction',CASE WHEN r.from_version_id=vid OR r.from_anchor_id=ANY(anchor_ids) THEN 'out' ELSE 'in' END,
    'other',CASE WHEN r.from_version_id=vid OR r.from_anchor_id=ANY(anchor_ids) THEN knowledge.row_ref(pg_catalog.to_jsonb(r),'to') ELSE knowledge.row_ref(pg_catalog.to_jsonb(r),'from') END,
    'title',NULL,'explanation',r.explanation,'created_at',knowledge.utc(r.created_at)) x,r.created_at ca
  FROM knowledge.relations r WHERE knowledge.is_public('relation',r.id) AND (
    r.from_version_id=vid OR r.to_version_id=vid OR r.from_anchor_id=ANY(anchor_ids) OR r.to_anchor_id=ANY(anchor_ids))
   AND NOT(r.predicate='corrects' AND (r.to_version_id=vid OR r.to_anchor_id=ANY(anchor_ids)))
   AND NOT(r.predicate='contradicts' AND (r.to_version_id=vid OR r.to_anchor_id=ANY(anchor_ids)))
   AND NOT(r.predicate='depends_on' AND r.from_version_id=vid)
  ORDER BY r.created_at DESC LIMIT related_cap
 ) t;

 SELECT count(*) INTO ver_count FROM knowledge.versions vv WHERE vv.record_id=v.record_id AND knowledge.is_public('version',vv.id);

 omitted=pg_catalog.jsonb_build_object('corrections',greatest(corr_total-corr_cap,0),'counterarguments',greatest(rev_total-review_cap,0),
  'contradicts',greatest(contra_total-contra_cap,0),'evidence',greatest(evidence_total-evidence_cap,0),'premises',greatest(premises_total-premises_cap,0),
  'meanings',greatest(meanings_total-meanings_cap,0),'related',greatest(related_total-related_cap,0));

 RETURN pg_catalog.jsonb_build_object(
  'version',pg_catalog.jsonb_build_object('id',v.id,'record_id',v.record_id,'version_no',v.version_no,'title',v.title,
   'is_current',v.id=knowledge.current_version(v.record_id),'current_version_id',knowledge.current_version(v.record_id),'version_count',ver_count,
   'parent_version_id',v.parent_version_id,'created_at',knowledge.utc(v.created_at),'created_by',v.created_by,'attributes',v.attributes,
   'synthetic_demo',v.synthetic_demo,'body_sha256',v.body_sha256,'body_text',v.body_text),
  'corrections',corrections,
  'counterarguments',pg_catalog.jsonb_build_object('reviews',reviews,'contradicts',contradicts,
   'groups',pg_catalog.jsonb_build_object('keyed_actors',keyed_actors,'anonymous_reviews',anon_reviews,'declared_model_families',declared_families)),
  'agreements',pg_catalog.jsonb_build_object('agree_keyed',agree_keyed,'agree_anonymous',agree_anon),
  'evidence',evidence,'premises',premises,'meanings',meanings,'related',related,'omitted',omitted,'blind',blind,
  'generated_at',knowledge.utc(pg_catalog.clock_timestamp()));
END $$;

-- === 1d: attention ========================================================
CREATE FUNCTION public.kb_attention(p_query jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE lim integer;reasons text[];seed text;items jsonb;counts jsonb;BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock_shared(2081801,1);
 PERFORM knowledge.jobject(p_query,ARRAY['limit','reasons','seed'],ARRAY[]::text[]);
 lim=CASE WHEN p_query?'limit' THEN knowledge.jint(p_query->'limit',1,50) ELSE 20 END;
 IF p_query?'reasons' THEN
  PERFORM knowledge.require(pg_catalog.jsonb_typeof(p_query->'reasons')='array');
  SELECT coalesce(pg_catalog.array_agg(value#>>'{}'),'{}'::text[]) INTO reasons FROM pg_catalog.jsonb_array_elements(p_query->'reasons');
  PERFORM knowledge.require(reasons <@ ARRAY['quote_not_found','contested','no_basis','requested','quote_unverifiable','unreviewed','uncategorized']::text[]);
 ELSE reasons=ARRAY['quote_not_found','contested','no_basis','requested','quote_unverifiable','unreviewed','uncategorized'];END IF;
 seed=CASE WHEN p_query?'seed' THEN knowledge.jtext(p_query->'seed',64,0) ELSE '' END;

 SELECT coalesce(pg_catalog.jsonb_object_agg(reason,cnt),'{}'::jsonb) INTO counts FROM (
  SELECT reason,count(*) cnt FROM knowledge.attention_candidates() WHERE reason=ANY(reasons) GROUP BY reason
 ) g;
 counts=pg_catalog.jsonb_build_object('quote_not_found',coalesce((counts->>'quote_not_found')::integer,0),'contested',coalesce((counts->>'contested')::integer,0),
  'no_basis',coalesce((counts->>'no_basis')::integer,0),'requested',coalesce((counts->>'requested')::integer,0),
  'quote_unverifiable',coalesce((counts->>'quote_unverifiable')::integer,0),'unreviewed',coalesce((counts->>'unreviewed')::integer,0),
  'uncategorized',coalesce((counts->>'uncategorized')::integer,0));

 SELECT coalesce(pg_catalog.jsonb_agg(x ORDER BY pri,rk),'[]'::jsonb) INTO items FROM (
  SELECT pg_catalog.jsonb_build_object('reason',c.reason,'priority',c.priority,'target',pg_catalog.jsonb_build_object('kind',c.target_kind,'id',c.target_id),
    'record_id',c.record_id,'version_id',c.version_id,'title',c.title,'snippet',c.snippet,'since',knowledge.utc(c.since),'detail',c.detail) x,
    c.priority pri,pg_catalog.md5(c.target_id::text||seed) rk
  FROM knowledge.attention_candidates() c WHERE c.reason=ANY(reasons)
  ORDER BY c.priority,pg_catalog.md5(c.target_id::text||seed) LIMIT lim
 ) t;
 RETURN pg_catalog.jsonb_build_object('items',items,'counts',counts,'generated_at',knowledge.utc(pg_catalog.clock_timestamp()));
END $$;

REVOKE ALL ON FUNCTION public.kb_url_report(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kb_url_report(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.kb_dossier(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kb_dossier(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.kb_attention(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kb_attention(jsonb) TO service_role;
-- Anonymous work_request.create/list now flow through the server; 0104 had revoked these.
GRANT EXECUTE ON FUNCTION public.kb_create_work_request(jsonb,jsonb),public.kb_update_work_request(jsonb,jsonb),public.kb_list_work_requests(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.kb_health() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT pg_catalog.jsonb_build_object('status',CASE WHEN contract_version='2.1.0' AND migration_tag='stage07-read-surfaces' THEN 'ok' ELSE 'degraded' END,'database','reachable','contract_version',contract_version) FROM knowledge.schema_info WHERE singleton
$$;
UPDATE knowledge.schema_info SET migration_tag='stage07-read-surfaces' WHERE singleton;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA knowledge FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
