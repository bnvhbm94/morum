-- Stage08 / quote selectors. Additive only: no table/column drop, no truncate,
-- no extension install, no role alteration. Contract stays 2.1.0.
-- W3C TextQuoteSelector-style resolution: anchor.create and version.create
-- edits may omit start/end and supply exact (+ optional prefix/suffix)
-- instead; the server locates the unique occurrence in the version body.
-- Zero or multiple matches are errors (SELECTOR_NOT_FOUND / AMBIGUOUS_SELECTOR),
-- never a silent guess. Adds a read-only public.kb_locate so a caller can see
-- candidates before writing. Positional start/end selectors are unchanged.
-- Rollback: supabase/rollback/202609200112_quote_selectors_down.sql
BEGIN;

-- === locate/resolve helpers ================================================
-- Finds every occurrence of p_exact in p_body (code-point positions), filtered
-- by prefix/suffix when given. The empty-exact case (an insertion point) is
-- located by finding prefix||suffix and returning the point after prefix.
-- Scans at most p_max occurrences; candidates are capped at 10 and `truncated`
-- is set once an 11th occurrence is found.
CREATE FUNCTION knowledge.locate_quote(p_body text,p_exact text,p_prefix text,p_suffix text,p_max integer DEFAULT 11) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE plen integer=pg_catalog.length(coalesce(p_prefix,''));slen integer=pg_catalog.length(coalesce(p_suffix,''));
 elen integer=pg_catalog.length(coalesce(p_exact,''));cnt integer=0;candidates jsonb='[]'::jsonb;s integer=0;hit integer;st integer;en integer;BEGIN
 IF elen=0 THEN
  PERFORM knowledge.require(plen>0 AND slen>0);
  LOOP
   hit=pg_catalog.strpos(pg_catalog.substr(p_body,s+1),p_prefix||p_suffix);EXIT WHEN hit=0;
   st=s+hit-1+plen;
   cnt=cnt+1;
   IF cnt<=10 THEN
    candidates=candidates||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('start',st,'end',st,
     'prefix',pg_catalog.substr(p_body,greatest(0,st-32)+1,least(32,st)),'suffix',pg_catalog.substr(p_body,st+1,32)));
   END IF;
   EXIT WHEN cnt>=p_max;s=s+hit;
  END LOOP;
 ELSE
  LOOP
   hit=pg_catalog.strpos(pg_catalog.substr(p_body,s+1),p_exact);EXIT WHEN hit=0;
   st=s+hit-1;en=st+elen;
   IF (plen=0 OR pg_catalog.substr(p_body,st-plen+1,plen)=p_prefix) AND (slen=0 OR pg_catalog.substr(p_body,en+1,slen)=p_suffix) THEN
    cnt=cnt+1;
    IF cnt<=10 THEN
     candidates=candidates||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('start',st,'end',en,
      'prefix',pg_catalog.substr(p_body,greatest(0,st-32)+1,least(32,st)),'suffix',pg_catalog.substr(p_body,en+1,32)));
    END IF;
    EXIT WHEN cnt>=p_max;
   END IF;
   s=s+hit;
  END LOOP;
 END IF;
 RETURN pg_catalog.jsonb_build_object('state',CASE WHEN cnt=0 THEN 'not_found' WHEN cnt=1 THEN 'unique' ELSE 'ambiguous' END,
  'candidates',candidates,'truncated',cnt>10);
END $$;

-- Fills start/end from a quote (exact/prefix/suffix) when absent. When
-- start/end are present it returns the input unchanged (aside from
-- defaulting absent prefix/suffix to '', mirroring the TS contract default);
-- the existing strict TEXT_MISMATCH checks in knowledge.mutate still run
-- afterwards either way.
CREATE FUNCTION knowledge.resolve_selector(p_body text,p_sel jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE sel jsonb;loc jsonb;c jsonb;BEGIN
 sel=p_sel||pg_catalog.jsonb_build_object('prefix',coalesce(p_sel->>'prefix',''),'suffix',coalesce(p_sel->>'suffix',''));
 IF sel?'start' THEN RETURN sel;END IF;
 loc=knowledge.locate_quote(p_body,sel->>'exact',sel->>'prefix',sel->>'suffix');
 PERFORM knowledge.require(loc->>'state'<>'not_found','SELECTOR_NOT_FOUND');
 PERFORM knowledge.require(loc->>'state'<>'ambiguous','AMBIGUOUS_SELECTOR');
 c=loc->'candidates'->0;
 RETURN sel||pg_catalog.jsonb_build_object('start',c->'start','end',c->'end');
END $$;

-- === knowledge.validate_command: start/end/prefix/suffix become optional on
-- anchor.create's selector and version.create's edits (copy of 202609200102's
-- body; only the anchor.create and version.create edit-loop branches change).
CREATE OR REPLACE FUNCTION knowledge.validate_command(op text,j jsonb) RETURNS void LANGUAGE plpgsql STABLE SET search_path='' AS $$ DECLARE fields text[]; x jsonb; t text; BEGIN
 CASE op
 WHEN 'record.create' THEN fields=ARRAY['title','body_text','body_format','attributes','synthetic_demo','reason','basis'];
 WHEN 'version.create' THEN fields=ARRAY['record_id','base_version_id','base_body_sha256','edits','reason','basis'];
 WHEN 'anchor.create' THEN fields=ARRAY['version_id','body_sha256','selector'];
 WHEN 'source.create' THEN fields=ARRAY['url','title','submitted_text','published_at','retrieved_at','rights_note','attributes','synthetic_demo'];
 WHEN 'relation.create' THEN fields=ARRAY['from','to','predicate','explanation','attributes','basis'];
 WHEN 'annotation.create' THEN fields=ARRAY['anchor_id','meaning','concept_version_id','attributes','supersedes_annotation_id','basis'];
 WHEN 'evidence.create' THEN fields=ARRAY['target','basis'];
 WHEN 'review.create' THEN fields=ARRAY['target','stance','focus','explanation','previous_review_id','basis'];
 WHEN 'work_request.create' THEN fields=ARRAY['title','description','target','suggested_query'];
 WHEN 'work_request.update' THEN fields=ARRAY['work_request_id','expected_revision','action','reason','resolution_refs'];
 ELSE PERFORM knowledge.require(false); END CASE;
 PERFORM knowledge.jobject(j,CASE WHEN op='version.create' THEN fields||ARRAY['metadata_update'] ELSE fields END,fields);
 PERFORM knowledge.require(pg_catalog.octet_length(knowledge.compact_json(j))<=1048576,'PAYLOAD_TOO_LARGE');
 CASE op
 WHEN 'record.create' THEN
  PERFORM knowledge.jtext(j->'title',240,1,true);t=knowledge.body(knowledge.jtext(j->'body_text',100000,0));
  PERFORM knowledge.require(j->>'body_format' IN ('plain_text','markdown'));PERFORM knowledge.attributes(j->'attributes');
  PERFORM knowledge.require(pg_catalog.jsonb_typeof(j->'synthetic_demo')='boolean');PERFORM knowledge.jtext(j->'reason',2000);PERFORM knowledge.validate_bases(j->'basis');
  PERFORM knowledge.require(pg_catalog.length(knowledge.trim_text(t))>0 OR j->'attributes'<>'{}'::jsonb);
 WHEN 'version.create' THEN
  PERFORM knowledge.juuid(j->'record_id');PERFORM knowledge.juuid(j->'base_version_id');PERFORM knowledge.jhash(j->'base_body_sha256');
  PERFORM knowledge.require(pg_catalog.jsonb_typeof(j->'edits')='array');PERFORM knowledge.require(pg_catalog.jsonb_array_length(j->'edits')<=20);
  FOR x IN SELECT value FROM pg_catalog.jsonb_array_elements(j->'edits') LOOP
   PERFORM knowledge.jobject(x,ARRAY['start','end','exact','replacement','prefix','suffix'],ARRAY['exact','replacement']);
   PERFORM knowledge.require((x?'start')=(x?'end'));
   IF x?'start' THEN PERFORM knowledge.jint(x->'start',0,100000);PERFORM knowledge.jint(x->'end',(x->>'start')::integer,100000);END IF;
   PERFORM knowledge.body(knowledge.jtext(x->'exact',100000,0));PERFORM knowledge.body(knowledge.jtext(x->'replacement',100000,0));
   PERFORM knowledge.jtext(coalesce(x->'prefix','""'::jsonb),32,0);PERFORM knowledge.jtext(coalesce(x->'suffix','""'::jsonb),32,0);
   IF NOT(x?'start') AND pg_catalog.length(x->>'exact')=0 THEN PERFORM knowledge.require(pg_catalog.length(coalesce(x->>'prefix',''))>0 AND pg_catalog.length(coalesce(x->>'suffix',''))>0);END IF;
  END LOOP;
  IF j?'metadata_update' THEN PERFORM knowledge.validate_metadata(j->'metadata_update');END IF;
  PERFORM knowledge.jtext(j->'reason',2000);PERFORM knowledge.validate_bases(j->'basis',1);
 WHEN 'anchor.create' THEN
  PERFORM knowledge.juuid(j->'version_id');PERFORM knowledge.jhash(j->'body_sha256');x=j->'selector';
  PERFORM knowledge.jobject(x,ARRAY['unit','start','end','exact','prefix','suffix'],ARRAY['unit','exact']);
  PERFORM knowledge.require(x->>'unit'='unicode_code_point');PERFORM knowledge.require((x?'start')=(x?'end'));
  IF x?'start' THEN PERFORM knowledge.jint(x->'start',0,99999);PERFORM knowledge.jint(x->'end',(x->>'start')::integer+1,100000);END IF;
  PERFORM knowledge.body(knowledge.jtext(x->'exact',100000,0));PERFORM knowledge.jtext(coalesce(x->'prefix','""'::jsonb),32,0);PERFORM knowledge.jtext(coalesce(x->'suffix','""'::jsonb),32,0);
  IF NOT(x?'start') AND pg_catalog.length(x->>'exact')=0 THEN PERFORM knowledge.require(pg_catalog.length(coalesce(x->>'prefix',''))>0 AND pg_catalog.length(coalesce(x->>'suffix',''))>0);END IF;
 WHEN 'source.create' THEN
  IF j->'url'<>'null'::jsonb THEN t=knowledge.jtext(j->'url',2048);PERFORM knowledge.require(t ~* '^https?://[^[:space:]/?#@]+([/?#]|$)' AND t !~ '[[:space:]]');END IF;
  PERFORM knowledge.jtext(j->'title',240,1,true);PERFORM knowledge.jtext(j->'submitted_text',100000,0,true);
  PERFORM knowledge.require(j->'url'<>'null'::jsonb OR pg_catalog.length(knowledge.trim_text(j->>'submitted_text'))>0);
  PERFORM knowledge.validate_date(j->'published_at');PERFORM knowledge.validate_date(j->'retrieved_at');PERFORM knowledge.jtext(j->'rights_note',8000,1,true);
  PERFORM knowledge.attributes(j->'attributes');PERFORM knowledge.require(pg_catalog.jsonb_typeof(j->'synthetic_demo')='boolean');
 WHEN 'relation.create' THEN
  PERFORM knowledge.validate_ref(j->'from',ARRAY['version','anchor','source']);PERFORM knowledge.validate_ref(j->'to',ARRAY['version','anchor','source']);
  PERFORM knowledge.require((j#>>'{from,kind}')<>(j#>>'{to,kind}') OR (j#>>'{from,id}')::uuid<>(j#>>'{to,id}')::uuid);
  PERFORM knowledge.jtext(j->'predicate',100);PERFORM knowledge.require(j->>'predicate' IN ('supports','contradicts','corrects','depends_on','defines','same_meaning_as','translation_of','derived_from','related_to') OR j->>'predicate' ~ '^x:[a-z][a-z0-9_.-]{0,31}:[a-z][a-z0-9_.-]{0,31}$');
  PERFORM knowledge.jtext(j->'explanation',8000);PERFORM knowledge.attributes(j->'attributes');PERFORM knowledge.validate_bases(j->'basis');
 WHEN 'annotation.create' THEN
  PERFORM knowledge.juuid(j->'anchor_id');PERFORM knowledge.jtext(j->'meaning',8000);PERFORM knowledge.juuid(j->'concept_version_id',true);PERFORM knowledge.juuid(j->'supersedes_annotation_id',true);PERFORM knowledge.attributes(j->'attributes');PERFORM knowledge.validate_bases(j->'basis');
 WHEN 'evidence.create' THEN PERFORM knowledge.validate_ref(j->'target',ARRAY['version','anchor','source','relation','annotation','review']);PERFORM knowledge.validate_basis(j->'basis');
 WHEN 'review.create' THEN
  PERFORM knowledge.validate_ref(j->'target',ARRAY['version','anchor','source','relation','annotation','evidence']);
  PERFORM knowledge.require(j->>'stance' IN ('agree','disagree','needs_review') AND j->>'focus' IN ('content','evidence_support','quote_match','meaning'));
  PERFORM knowledge.jtext(j->'explanation',8000);PERFORM knowledge.juuid(j->'previous_review_id',true);PERFORM knowledge.validate_bases(j->'basis');
 WHEN 'work_request.create' THEN
  PERFORM knowledge.jtext(j->'title',240);PERFORM knowledge.jtext(j->'description',8000);IF j->'target'<>'null'::jsonb THEN PERFORM knowledge.validate_ref(j->'target',ARRAY['version','anchor','source']);END IF;
  PERFORM knowledge.jtext(j->'suggested_query',500,1,true);
 WHEN 'work_request.update' THEN
  PERFORM knowledge.juuid(j->'work_request_id');PERFORM knowledge.jint(j->'expected_revision',1,2147483647);PERFORM knowledge.require(j->>'action' IN ('claim','release','resolve','close','reopen'));
  PERFORM knowledge.jtext(j->'reason',2000);PERFORM knowledge.require(pg_catalog.jsonb_typeof(j->'resolution_refs')='array');
  FOR x IN SELECT value FROM pg_catalog.jsonb_array_elements(j->'resolution_refs') LOOP PERFORM knowledge.validate_ref(x,ARRAY['version','anchor','source']);END LOOP;
  PERFORM knowledge.require(CASE WHEN j->>'action'='resolve' THEN pg_catalog.jsonb_array_length(j->'resolution_refs')>0 ELSE pg_catalog.jsonb_array_length(j->'resolution_refs')=0 END);
 END CASE;
END $$;

-- === knowledge.mutate: resolve quote-based selectors before the existing
-- strict checks (copy of 202609200110's body; only anchor.create's selector
-- line and version.create's edit-resolution/version_changes lines change).
CREATE OR REPLACE FUNCTION knowledge.mutate(op text,c jsonb,j jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE actor uuid;operation text;receipt knowledge.mutation_receipts%ROWTYPE;d text;kind text;i uuid;meta jsonb='{}';
 v knowledge.versions%ROWTYPE;base knowledge.versions%ROWTYPE;r knowledge.records%ROWTYPE;current_id uuid;
 body_text text;attrs jsonb;title text;format text;m jsonb;key text;changed boolean;an knowledge.anchors%ROWTYPE;sel jsonb;s integer;e integer;
 prev uuid;wr knowledge.work_requests%ROWTYPE;ev uuid;is_operator boolean;action text;new_status text;assigned uuid;resolution uuid;ref jsonb;ord integer;
 x jsonb;resolved_edits jsonb;
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
  resolved_edits='[]'::jsonb;
  FOR x IN SELECT value FROM pg_catalog.jsonb_array_elements(j->'edits') LOOP
   sel=knowledge.resolve_selector(base.body_text,x);
   resolved_edits=resolved_edits||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('start',(sel->>'start')::integer,'end',(sel->>'end')::integer,'exact',sel->>'exact','replacement',x->>'replacement'));
  END LOOP;
  body_text=knowledge.apply_edits(base.body_text,j->>'base_body_sha256',resolved_edits,changed);
  PERFORM knowledge.require(pg_catalog.length(knowledge.trim_text(body_text))>0 OR attrs<>'{}'::jsonb);
  UPDATE knowledge.records SET version_counter=version_counter+1 WHERE id=r.id RETURNING * INTO r;
  INSERT INTO knowledge.versions(created_by,record_id,version_no,parent_version_id,title,body_text,body_format,body_sha256,attributes,synthetic_demo,reason)
  VALUES(actor,r.id,r.version_counter,base.id,title,body_text,format,knowledge.hash(body_text),attrs,base.synthetic_demo,j->>'reason') RETURNING id INTO i;
  INSERT INTO knowledge.version_changes VALUES(i,resolved_edits);
  meta=pg_catalog.jsonb_build_object('previous_current_version_id',current_id,'branched_from_noncurrent',base.id IS DISTINCT FROM current_id,'indexing',pg_catalog.jsonb_build_object('lexical','ready','semantic',CASE WHEN EXISTS(SELECT 1 FROM knowledge.embedding_profiles WHERE id='openai-te3s-1536-v1' AND status='enabled') THEN 'pending' ELSE 'disabled' END));
 WHEN 'anchor.create' THEN
  kind='anchor';PERFORM knowledge.require_public('version',(j->>'version_id')::uuid);SELECT * INTO v FROM knowledge.versions WHERE id=(j->>'version_id')::uuid;
  -- Also serialize duplicate anchors across DIFFERENT actors using the owning record.
  PERFORM 1 FROM knowledge.records WHERE id=v.record_id FOR UPDATE;
  PERFORM knowledge.require(v.body_sha256=j->>'body_sha256','BASE_HASH_MISMATCH');
  sel=knowledge.resolve_selector(v.body_text,j->'selector');s=(sel->>'start')::integer;e=(sel->>'end')::integer;
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

-- === public.kb_locate: read-only quote lookup, service_role only ==========
CREATE FUNCTION public.kb_locate(p_query jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v knowledge.versions%ROWTYPE;prefix text;suffix text;loc jsonb;BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock_shared(2081801,1);
 PERFORM knowledge.jobject(p_query,ARRAY['version_id','exact','prefix','suffix'],ARRAY['version_id','exact']);
 PERFORM knowledge.juuid(p_query->'version_id');
 PERFORM knowledge.require_public('version',(p_query->>'version_id')::uuid);
 SELECT * INTO v FROM knowledge.versions WHERE id=(p_query->>'version_id')::uuid;
 PERFORM knowledge.body(knowledge.jtext(p_query->'exact',100000,0));
 prefix=knowledge.jtext(coalesce(p_query->'prefix','""'::jsonb),32,0);
 suffix=knowledge.jtext(coalesce(p_query->'suffix','""'::jsonb),32,0);
 loc=knowledge.locate_quote(v.body_text,p_query->>'exact',prefix,suffix);
 RETURN pg_catalog.jsonb_build_object('version_id',v.id,'body_sha256',v.body_sha256,'state',loc->'state','candidates',loc->'candidates','truncated',loc->'truncated');
END $$;

REVOKE ALL ON FUNCTION public.kb_locate(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kb_locate(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.kb_health() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT pg_catalog.jsonb_build_object('status',CASE WHEN contract_version='2.1.0' AND migration_tag='stage08-quote-selectors' THEN 'ok' ELSE 'degraded' END,'database','reachable','contract_version',contract_version) FROM knowledge.schema_info WHERE singleton
$$;
UPDATE knowledge.schema_info SET migration_tag='stage08-quote-selectors' WHERE singleton;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA knowledge FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
