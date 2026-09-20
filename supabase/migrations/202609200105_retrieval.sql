-- Functional keyword + optional exact-vector retrieval and bounded graph context.
-- No extension install, paid provider call, or synthetic production data in this migration.
-- Exact array cosine is deliberately an initial-scale implementation, NOT an ANN index.
BEGIN;
-- A profile identifier alone does not prove vector-space compatibility.
CREATE FUNCTION knowledge.profile_compatible(profile text) RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM knowledge.embedding_profiles p WHERE p.id=$1 AND p.id='openai-te3s-1536-v1'
 AND p.provider='openai' AND p.model='text-embedding-3-small' AND p.dimensions=1536
 AND p.normalization='validate-finite-l2-cosine' AND p.query_transform='NFC; LF; trim; no prefix'
 AND p.document_transform='NFC; LF; trim; no prefix; raw unit only' AND p.status<>'retired')
$$;
CREATE FUNCTION knowledge.vector_valid(v double precision[]) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 SELECT pg_catalog.array_ndims(v)=1 AND pg_catalog.cardinality(v)=1536 AND pg_catalog.array_lower(v,1)=1
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.unnest(v) x WHERE x IS NULL OR NOT(x BETWEEN -1.000001 AND 1.000001))
 AND (SELECT sum(x*x) FROM pg_catalog.unnest(v) x) BETWEEN 0.999 AND 1.001
$$;
CREATE TABLE knowledge.embedding_vectors (
 unit_id uuid NOT NULL REFERENCES knowledge.search_units(id),profile_id text NOT NULL REFERENCES knowledge.embedding_profiles(id),
 input_sha256 text NOT NULL,embedding double precision[] NOT NULL CHECK(knowledge.vector_valid(embedding)),
 created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),PRIMARY KEY(unit_id,profile_id)
);
ALTER TABLE knowledge.embedding_vectors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON knowledge.embedding_vectors FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE knowledge.embedding_jobs ADD COLUMN lease_token uuid;
CREATE INDEX embedding_ready_profile ON knowledge.embedding_vectors(profile_id,unit_id,input_sha256);
CREATE INDEX rate_expiry ON knowledge.rate_buckets(expires_at);
-- Stage 02 already provides snapshots_expiry.
CREATE FUNCTION knowledge.cosine_dot(a double precision[],b double precision[]) RETURNS double precision LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 SELECT sum(a[i]*b[i]) FROM pg_catalog.generate_subscripts(a,1) i
$$;
CREATE FUNCTION knowledge.scope_versions(k text,i uuid,depth integer DEFAULT 0) RETURNS uuid[] LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE j jsonb;r jsonb;a uuid[];b uuid[];BEGIN
 IF depth>64 THEN RETURN '{}'::uuid[];END IF;j=knowledge.raw_object(k,i);
 CASE k
 WHEN 'version' THEN RETURN ARRAY[i];
 WHEN 'anchor' THEN RETURN ARRAY[(j->>'version_id')::uuid];
 WHEN 'annotation' THEN RETURN knowledge.scope_versions('anchor',(j->>'anchor_id')::uuid,depth+1);
 WHEN 'relation' THEN
  r=knowledge.row_ref(j,'from');a=knowledge.scope_versions(r->>'kind',(r->>'id')::uuid,depth+1);
  r=knowledge.row_ref(j,'to');b=knowledge.scope_versions(r->>'kind',(r->>'id')::uuid,depth+1);
  RETURN ARRAY(SELECT DISTINCT x FROM pg_catalog.unnest(a||b) x WHERE x IS NOT NULL ORDER BY x);
 WHEN 'review','evidence' THEN r=knowledge.row_ref(j,'target');RETURN knowledge.scope_versions(r->>'kind',(r->>'id')::uuid,depth+1);
 ELSE RETURN '{}'::uuid[];
 END CASE;
END $$;
CREATE FUNCTION knowledge.unit_target(u knowledge.search_units) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE WHEN u.version_id IS NOT NULL THEN pg_catalog.jsonb_build_object('kind','version','id',u.version_id) ELSE knowledge.row_ref(pg_catalog.to_jsonb(u),'object') END
$$;
CREATE FUNCTION knowledge.unit_eligible(u knowledge.search_units,q jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE t jsonb;ids uuid[];demo boolean;BEGIN
 IF NOT knowledge.unit_is_public(u.id) THEN RETURN false;END IF;
 t=knowledge.unit_target(u);ids=knowledge.scope_versions(t->>'kind',(t->>'id')::uuid);
 IF q->>'scope'='current' AND EXISTS(SELECT 1 FROM knowledge.versions v WHERE v.id=ANY(ids) AND v.id IS DISTINCT FROM knowledge.current_version(v.record_id)) THEN RETURN false;END IF;
 IF q#>>'{filters,record_id}' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM knowledge.versions v WHERE v.id=ANY(ids) AND v.record_id=(q#>>'{filters,record_id}')::uuid) THEN RETURN false;END IF;
 demo=coalesce((knowledge.raw_object(t->>'kind',(t->>'id')::uuid)->>'synthetic_demo')::boolean,false) OR EXISTS(SELECT 1 FROM knowledge.versions v WHERE v.id=ANY(ids) AND v.synthetic_demo);
 IF (q->'filters')?'synthetic_demo' AND demo<>(q#>>'{filters,synthetic_demo}')::boolean THEN RETURN false;END IF;
 RETURN true;
END $$;
CREATE FUNCTION knowledge.validate_search(q jsonb) RETURNS void LANGUAGE plpgsql STABLE SET search_path='' AS $$ BEGIN
 PERFORM knowledge.jobject(q,ARRAY['query','scope','limit','filters','_snapshot_id','_scan_index','_profile_id','_vector','_status'],ARRAY['query','scope','limit']);
 PERFORM knowledge.jtext(q->'query',1000);PERFORM knowledge.require(q->>'scope' IN ('current','all_versions'));PERFORM knowledge.jint(q->'limit',1,20);
 IF q?'filters' THEN
  PERFORM knowledge.jobject(q->'filters',ARRAY['synthetic_demo','record_id']);
  IF (q->'filters')?'synthetic_demo' THEN PERFORM knowledge.require(pg_catalog.jsonb_typeof(q#>'{filters,synthetic_demo}')='boolean');END IF;
  IF (q->'filters')?'record_id' THEN PERFORM knowledge.juuid(q#>'{filters,record_id}');END IF;
 END IF;
END $$;
CREATE FUNCTION knowledge.unit_candidate(unit uuid,lex_rank integer,sem_rank integer) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE u knowledge.search_units%ROWTYPE;t jsonb;ids uuid[];v knowledge.versions%ROWTYPE;loc jsonb;demo boolean;curr boolean;title text;BEGIN
 SELECT * INTO u FROM knowledge.search_units WHERE id=unit;t=knowledge.unit_target(u);ids=knowledge.scope_versions(t->>'kind',(t->>'id')::uuid);
 IF pg_catalog.cardinality(ids)=1 THEN SELECT * INTO v FROM knowledge.versions WHERE id=ids[1];END IF;
 curr=CASE WHEN pg_catalog.cardinality(ids)=0 THEN NULL ELSE NOT EXISTS(SELECT 1 FROM knowledge.versions ov WHERE ov.id=ANY(ids) AND ov.id IS DISTINCT FROM knowledge.current_version(ov.record_id)) END;
 demo=coalesce((knowledge.raw_object(t->>'kind',(t->>'id')::uuid)->>'synthetic_demo')::boolean,false) OR EXISTS(SELECT 1 FROM knowledge.versions ov WHERE ov.id=ANY(ids) AND ov.synthetic_demo);
 title=coalesce(v.title,knowledge.raw_object(t->>'kind',(t->>'id')::uuid)->>'title');
 loc=CASE u.unit_kind WHEN 'body' THEN pg_catalog.jsonb_build_object('kind','body','version_id',u.version_id,'start',u.start_cp,'end',u.end_cp,'body_sha256',v.body_sha256)
 WHEN 'field' THEN pg_catalog.jsonb_build_object('kind','field','version_id',u.version_id,'json_pointer',u.json_pointer)
 ELSE pg_catalog.jsonb_build_object('kind','object','target',t) END;
 RETURN pg_catalog.jsonb_build_object('unit_id',unit,'target',t,'record_id',v.record_id,'version_id',v.id,'locator',loc,'snippet',pg_catalog.left(u.raw_text,1200),'snippet_truncated',pg_catalog.length(u.raw_text)>1200,'title',title,'is_current',curr,'synthetic_demo',demo,'lexical_rank',lex_rank,'semantic_rank',sem_rank,'review_summary',knowledge.review_summary(t->>'kind',(t->>'id')::uuid));
END $$;
CREATE FUNCTION public.kb_search_state(p_query jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE eligible integer;indexed integer;BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock_shared(2081801,1);PERFORM knowledge.validate_search(p_query);
 SELECT count(*),count(e.unit_id) INTO eligible,indexed FROM knowledge.search_units u LEFT JOIN knowledge.embedding_vectors e ON e.unit_id=u.id AND e.profile_id=p_query->>'_profile_id' AND e.input_sha256=u.input_sha256 AND knowledge.profile_compatible(p_query->>'_profile_id') WHERE knowledge.unit_eligible(u,p_query);
 RETURN pg_catalog.jsonb_build_object('eligible_units',eligible,'indexed_units',indexed,'profile_compatible',knowledge.profile_compatible(p_query->>'_profile_id'));
END $$;
CREATE FUNCTION public.kb_search(p_query jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE snap knowledge.query_snapshots%ROWTYPE;qh text;norm text;tokens text[];vec double precision[];prof text;entries jsonb='[]';results jsonb='[]';candidate record;other jsonb;overlap boolean;pos integer=0;lim integer;entry jsonb;unit_row knowledge.search_units%ROWTYPE;eligible integer;indexed integer;status jsonb;truncated boolean=false;ranked_count integer=0;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock_shared(2081801,1);PERFORM knowledge.validate_search(p_query);lim=(p_query->>'limit')::integer;prof=p_query->>'_profile_id';
 -- Pin profile metadata while a snapshot is ranked or reused. No model mixing after config edits.
 PERFORM id FROM knowledge.embedding_profiles WHERE id=prof FOR SHARE;
 qh=knowledge.hash((p_query-ARRAY['limit','_snapshot_id','_scan_index','_vector','_status'])::text);
 IF p_query?'_snapshot_id' THEN
  PERFORM knowledge.juuid(p_query->'_snapshot_id');pos=knowledge.jint(p_query->'_scan_index',0,100);
  SELECT * INTO snap FROM knowledge.query_snapshots WHERE id=(p_query->>'_snapshot_id')::uuid;
  PERFORM knowledge.require(snap.id IS NOT NULL AND snap.scope='search-v2' AND snap.query_hash=qh,'CURSOR_INVALID');PERFORM knowledge.require(snap.expires_at>pg_catalog.clock_timestamp(),'CURSOR_EXPIRED');
  PERFORM knowledge.require(pos<=pg_catalog.jsonb_array_length(snap.ordered_entries),'CURSOR_INVALID');
  IF snap.status_snapshot#>>'{search_status,query_embedding}'='ready' THEN PERFORM knowledge.require(knowledge.profile_compatible(prof),'NOT_CONFIGURED');END IF;
 ELSE
  PERFORM knowledge.require(NOT p_query?'_scan_index','CURSOR_INVALID');
  norm=pg_catalog.lower(pg_catalog.normalize(knowledge.trim_text(p_query->>'query'),'NFKC'));
  tokens=ARRAY(SELECT DISTINCT x FROM pg_catalog.regexp_split_to_table(norm,'[[:space:]]+') x WHERE x<>'' LIMIT 32);
  IF p_query->'_vector' IS NOT NULL AND p_query->'_vector'<>'null'::jsonb THEN
   PERFORM knowledge.require(knowledge.profile_compatible(prof),'NOT_CONFIGURED');SELECT pg_catalog.array_agg(value::double precision ORDER BY ord) INTO vec FROM pg_catalog.jsonb_array_elements_text(p_query->'_vector') WITH ORDINALITY a(value,ord);
   PERFORM knowledge.require(knowledge.vector_valid(vec));
  END IF;
  SELECT count(*),count(e.unit_id) INTO eligible,indexed FROM knowledge.search_units u LEFT JOIN knowledge.embedding_vectors e ON e.unit_id=u.id AND e.profile_id=prof AND e.input_sha256=u.input_sha256 AND knowledge.profile_compatible(prof) WHERE knowledge.unit_eligible(u,p_query);
  FOR candidate IN
   WITH eligible_units AS MATERIALIZED(SELECT u.* FROM knowledge.search_units u WHERE knowledge.unit_eligible(u,p_query)),
   lexical AS MATERIALIZED(
    SELECT u.id,u.version_id,u.start_cp,u.end_cp,
      (CASE WHEN pg_catalog.strpos(u.lexical_text,norm)>0 THEN 4.0 ELSE 0 END +
       (SELECT count(*)::double precision/greatest(pg_catalog.cardinality(tokens),1) FROM pg_catalog.unnest(tokens) t WHERE pg_catalog.strpos(u.lexical_text,t)>0) +
       pg_catalog.ts_rank_cd(pg_catalog.to_tsvector('simple'::regconfig,u.lexical_text),pg_catalog.plainto_tsquery('simple'::regconfig,norm))) AS score
    FROM eligible_units u
    WHERE pg_catalog.strpos(u.lexical_text,norm)>0 OR EXISTS(SELECT 1 FROM pg_catalog.unnest(tokens) t WHERE pg_catalog.strpos(u.lexical_text,t)>0)
       OR pg_catalog.to_tsvector('simple'::regconfig,u.lexical_text) @@ pg_catalog.plainto_tsquery('simple'::regconfig,norm)
   ),lx AS(SELECT id,row_number() OVER(ORDER BY score DESC,id)::integer AS r FROM lexical ORDER BY score DESC,id LIMIT 50),
   sem AS(SELECT u.id,knowledge.cosine_dot(e.embedding,vec) AS score FROM eligible_units u JOIN knowledge.embedding_vectors e ON e.unit_id=u.id AND e.input_sha256=u.input_sha256 AND e.profile_id=prof WHERE vec IS NOT NULL),
   sx AS(SELECT id,row_number() OVER(ORDER BY score DESC,id)::integer AS r FROM sem ORDER BY score DESC,id LIMIT 50),
   joined AS(SELECT coalesce(lx.id,sx.id) AS id,lx.r AS lr,sx.r AS sr,coalesce(1.0/(60+lx.r),0)+coalesce(1.0/(60+sx.r),0) AS rrf FROM lx FULL JOIN sx ON sx.id=lx.id)
   SELECT j.*,u.unit_kind,u.version_id,u.start_cp,u.end_cp,(SELECT count(*) FROM lexical)>50 OR (SELECT count(*) FROM sem)>50 AS limited FROM joined j JOIN eligible_units u ON u.id=j.id ORDER BY j.rrf DESC,j.id
  LOOP
   ranked_count=ranked_count+1;truncated=truncated OR candidate.limited;overlap=false;
   IF candidate.unit_kind='body' THEN
    FOR other IN SELECT value FROM pg_catalog.jsonb_array_elements(entries) LOOP
     IF other->>'version_id'=candidate.version_id::text AND other->>'start' IS NOT NULL AND
      greatest(0,least((other->>'end')::integer,candidate.end_cp)-greatest((other->>'start')::integer,candidate.start_cp))::double precision/greatest(1,least((other->>'end')::integer-(other->>'start')::integer,candidate.end_cp-candidate.start_cp))>0.8 THEN overlap=true;EXIT;END IF;
    END LOOP;
   END IF;
   IF NOT overlap THEN entries=entries||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',candidate.id,'lr',candidate.lr,'sr',candidate.sr,'version_id',candidate.version_id,'start',candidate.start_cp,'end',candidate.end_cp));END IF;
  END LOOP;
  status=coalesce(p_query->'_status','{}'::jsonb)||pg_catalog.jsonb_build_object('eligible_units',eligible,'indexed_units',indexed,'quality_gate','not_evaluated','index_truncated',EXISTS(SELECT 1 FROM knowledge.search_units su WHERE su.lexical_truncated AND knowledge.unit_eligible(su,p_query)),'result_state',CASE WHEN pg_catalog.jsonb_array_length(entries)>0 THEN 'candidates' WHEN eligible=0 THEN 'no_match' WHEN prof IS NOT NULL AND (indexed<eligible OR vec IS NULL) THEN 'insufficient_index' ELSE 'no_match' END);
  IF vec IS NOT NULL THEN status=status||pg_catalog.jsonb_build_object('mode',CASE WHEN indexed<eligible THEN 'hybrid_partial' ELSE 'hybrid' END,'reason',CASE WHEN indexed<eligible THEN 'index_pending' ELSE NULL END);END IF;
  INSERT INTO knowledge.query_snapshots(query_hash,scope,ordered_entries,status_snapshot) VALUES(qh,'search-v2',entries,pg_catalog.jsonb_build_object('search_status',status,'truncated',truncated)) RETURNING * INTO snap;
 END IF;
 -- Advance by scanned positions even after moderation; never reuse stale raw text.
 FOR entry IN SELECT value FROM pg_catalog.jsonb_array_elements(snap.ordered_entries) WITH ORDINALITY a(value,ord) WHERE ord>pos AND ord<=pos+lim ORDER BY ord LOOP
  pos=pos+1;SELECT * INTO unit_row FROM knowledge.search_units WHERE id=(entry->>'id')::uuid;
  IF knowledge.unit_eligible(unit_row,p_query) THEN results=results||pg_catalog.jsonb_build_array(knowledge.unit_candidate(unit_row.id,(entry->>'lr')::integer,(entry->>'sr')::integer));END IF;
 END LOOP;
 status=snap.status_snapshot->'search_status';
 RETURN pg_catalog.jsonb_build_object('candidates',results,'snapshot_id',snap.id,'scan_index',pos,'has_more',pos<pg_catalog.jsonb_array_length(snap.ordered_entries),'snapshot_at',knowledge.utc(snap.created_at),'snapshot_expires_at',knowledge.utc(snap.expires_at),'truncated',snap.status_snapshot->'truncated','indexed_units',status->'indexed_units','eligible_units',status->'eligible_units','stored_status',status);
END $$;

-- Neighbors are references, not generated answers. Both ends and visibility are checked.
CREATE FUNCTION knowledge.context_neighbors(k text,i uuid) RETURNS TABLE(kind text,id uuid,reason text,priority integer) LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE j jsonb;t jsonb;vid uuid;link_row record;BEGIN
 j=knowledge.raw_object(k,i);vid=CASE WHEN k='version' THEN i WHEN k='anchor' THEN (j->>'version_id')::uuid ELSE NULL END;
 IF k IN ('version','anchor','source') THEN
  FOR link_row IN SELECT x.*,knowledge.row_ref(pg_catalog.to_jsonb(x),'from') AS f,knowledge.row_ref(pg_catalog.to_jsonb(x),'to') AS t FROM knowledge.relations x
   WHERE knowledge.is_public('relation',x.id) AND
   (knowledge.row_ref(pg_catalog.to_jsonb(x),'from')=pg_catalog.jsonb_build_object('kind',k,'id',i) OR knowledge.row_ref(pg_catalog.to_jsonb(x),'to')=pg_catalog.jsonb_build_object('kind',k,'id',i)
    OR (k='version' AND (x.from_anchor_id IN(SELECT a.id FROM knowledge.anchors a WHERE a.version_id=i) OR x.to_anchor_id IN(SELECT a.id FROM knowledge.anchors a WHERE a.version_id=i))))
   ORDER BY CASE x.predicate WHEN 'corrects' THEN 0 WHEN 'contradicts' THEN 1 WHEN 'depends_on' THEN 2 WHEN 'supports' THEN 3 WHEN 'defines' THEN 4 ELSE 6 END,x.id LIMIT 401
  LOOP
   priority=CASE link_row.predicate WHEN 'corrects' THEN 0 WHEN 'contradicts' THEN 1 WHEN 'depends_on' THEN 2 WHEN 'supports' THEN 3 WHEN 'defines' THEN 4 ELSE 6 END;
   reason=CASE link_row.predicate WHEN 'corrects' THEN 'correction' WHEN 'contradicts' THEN 'counterargument' WHEN 'depends_on' THEN 'premise' WHEN 'supports' THEN 'evidence' WHEN 'defines' THEN 'meaning' ELSE 'related' END;
   kind='relation';id=link_row.id;RETURN NEXT;kind=link_row.f->>'kind';id=(link_row.f->>'id')::uuid;RETURN NEXT;kind=link_row.t->>'kind';id=(link_row.t->>'id')::uuid;RETURN NEXT;
  END LOOP;
 END IF;
 IF k IN ('version','anchor') THEN
  RETURN QUERY SELECT 'annotation'::text,a.id,'meaning'::text,4 FROM knowledge.annotations a JOIN knowledge.anchors an ON an.id=a.anchor_id WHERE
    (a.anchor_id=i OR (k='version' AND an.version_id=i)) AND knowledge.is_public('annotation',a.id)
    AND NOT EXISTS(SELECT 1 FROM knowledge.annotations newer WHERE newer.supersedes_annotation_id=a.id AND knowledge.is_public('annotation',newer.id)) ORDER BY a.id LIMIT 401;
 END IF;
 IF k<>'evidence' THEN
  RETURN QUERY SELECT 'evidence'::text,e.id,'evidence'::text,3 FROM knowledge.evidence e WHERE knowledge.is_public('evidence',e.id) AND
   (knowledge.row_ref(pg_catalog.to_jsonb(e),'target')=pg_catalog.jsonb_build_object('kind',k,'id',i) OR (k='version' AND e.target_anchor_id IN(SELECT a.id FROM knowledge.anchors a WHERE a.version_id=i))) ORDER BY e.id LIMIT 401;
 END IF;
 RETURN QUERY SELECT 'review'::text,r.id,CASE r.stance WHEN 'disagree' THEN 'counterargument' ELSE 'related' END,CASE r.stance WHEN 'disagree' THEN 1 WHEN 'needs_review' THEN 2 ELSE 6 END
  FROM knowledge.review_heads h JOIN knowledge.reviews r ON r.id=h.review_id WHERE knowledge.is_public('review',r.id) AND
  ((h.target_kind=k AND h.target_id=i) OR (k='version' AND h.target_kind='anchor' AND h.target_id IN(SELECT a.id FROM knowledge.anchors a WHERE a.version_id=i))) ORDER BY CASE r.stance WHEN 'disagree' THEN 1 WHEN 'needs_review' THEN 2 ELSE 6 END,r.id LIMIT 401;
 CASE k
 WHEN 'version' THEN
  RETURN QUERY SELECT 'version'::text,v.id,'related'::text,7 FROM knowledge.versions v WHERE (v.parent_version_id=i OR v.id=(j->>'parent_version_id')::uuid) AND knowledge.is_public('version',v.id) ORDER BY v.version_no DESC LIMIT 401;
 WHEN 'anchor' THEN kind='version';id=vid;reason='surrounding_text';priority=5;RETURN NEXT;
 WHEN 'annotation' THEN
  kind='anchor';id=(j->>'anchor_id')::uuid;reason='meaning';priority=4;RETURN NEXT;
  IF j->>'concept_version_id' IS NOT NULL THEN kind='version';id=(j->>'concept_version_id')::uuid;RETURN NEXT;END IF;
 WHEN 'relation' THEN
  t=knowledge.row_ref(j,'from');kind=t->>'kind';id=(t->>'id')::uuid;reason='related';priority=6;RETURN NEXT;
  t=knowledge.row_ref(j,'to');kind=t->>'kind';id=(t->>'id')::uuid;RETURN NEXT;
 WHEN 'evidence' THEN
  IF j->>'source_id' IS NOT NULL THEN kind='source';id=(j->>'source_id')::uuid;reason='evidence';priority=3;RETURN NEXT;
  ELSIF j->>'source_version_id' IS NOT NULL THEN kind='version';id=(j->>'source_version_id')::uuid;reason='evidence';priority=3;RETURN NEXT;
  ELSIF j->>'source_anchor_id' IS NOT NULL THEN kind='anchor';id=(j->>'source_anchor_id')::uuid;reason='evidence';priority=3;RETURN NEXT;END IF;
 WHEN 'review' THEN t=knowledge.row_ref(j,'target');kind=t->>'kind';id=(t->>'id')::uuid;reason='related';priority=6;RETURN NEXT;
 ELSE NULL;
 END CASE;
END $$;
CREATE FUNCTION knowledge.context_item(k text,i uuid,why text) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE j jsonb;txt text;ids uuid[];current_state boolean;demo boolean;BEGIN
 j=knowledge.raw_object(k,i);ids=knowledge.scope_versions(k,i);current_state=CASE WHEN pg_catalog.cardinality(ids)=0 THEN NULL ELSE NOT EXISTS(SELECT 1 FROM knowledge.versions v WHERE v.id=ANY(ids) AND v.id IS DISTINCT FROM knowledge.current_version(v.record_id)) END;
 demo=coalesce((j->>'synthetic_demo')::boolean,false) OR EXISTS(SELECT 1 FROM knowledge.versions v WHERE v.id=ANY(ids) AND v.synthetic_demo);
 txt=CASE k WHEN 'version' THEN j->>'body_text' WHEN 'source' THEN coalesce(j->>'submitted_text',j->>'title',j->>'url') WHEN 'anchor' THEN (j->>'prefix')||(j->>'exact')||(j->>'suffix') WHEN 'annotation' THEN j->>'meaning' WHEN 'evidence' THEN coalesce(j->>'quote','')||E'\n'||(j->>'explanation') ELSE j->>'explanation' END;
 RETURN pg_catalog.jsonb_build_object('target',pg_catalog.jsonb_build_object('kind',k,'id',i),'reason',why,'text',pg_catalog.left(txt,1200),'is_current',current_state,'synthetic_demo',demo,'original_url',CASE WHEN k='source' THEN j->>'url' ELSE NULL END,'text_truncated',pg_catalog.length(txt)>1200);
END $$;
CREATE FUNCTION public.kb_context(p_query jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE snap knowledge.query_snapshots%ROWTYPE;qh text;seeds jsonb;entry jsonb;entries jsonb='[]';frontier jsonb;next_frontier jsonb;visited text[]='{}';n record;item jsonb;items jsonb='[]';rels jsonb='[]';rel jsonb;deep integer;level integer;pos integer=0;scanned integer=0;trunc boolean=false;chars integer=0;counted integer=0;key text;BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock_shared(2081801,1);
 PERFORM knowledge.jobject(p_query,ARRAY['seeds','depth','_snapshot_id','_scan_index'],ARRAY['seeds','depth']);
 seeds=p_query->'seeds';PERFORM knowledge.require(pg_catalog.jsonb_typeof(seeds)='array' AND pg_catalog.jsonb_array_length(seeds) BETWEEN 1 AND 5);deep=knowledge.jint(p_query->'depth',1,2);
 FOR entry IN SELECT value FROM pg_catalog.jsonb_array_elements(seeds) LOOP PERFORM knowledge.validate_ref(entry,ARRAY['version','anchor','source','relation','annotation','evidence','review']);PERFORM knowledge.require_ref(entry);END LOOP;
 qh=knowledge.hash((p_query-ARRAY['_snapshot_id','_scan_index'])::text);
 IF p_query?'_snapshot_id' THEN
  PERFORM knowledge.juuid(p_query->'_snapshot_id');pos=knowledge.jint(p_query->'_scan_index',0,200);
  SELECT * INTO snap FROM knowledge.query_snapshots WHERE id=(p_query->>'_snapshot_id')::uuid;
  PERFORM knowledge.require(snap.id IS NOT NULL AND snap.scope='context-v2' AND snap.query_hash=qh,'CURSOR_INVALID');PERFORM knowledge.require(snap.expires_at>pg_catalog.clock_timestamp(),'CURSOR_EXPIRED');
  PERFORM knowledge.require(pos<=pg_catalog.jsonb_array_length(snap.ordered_entries),'CURSOR_INVALID');
 ELSE
  PERFORM knowledge.require(NOT p_query?'_scan_index','CURSOR_INVALID');frontier=seeds;
  FOR entry IN SELECT value FROM pg_catalog.jsonb_array_elements(seeds) LOOP
   key=(entry->>'kind')||':'||(entry->>'id');IF key=ANY(visited) THEN CONTINUE;END IF;visited=visited||key;
   entries=entries||pg_catalog.jsonb_build_array(entry||'{"reason":"match","priority":-1,"level":0}'::jsonb);
  END LOOP;
  FOR level IN 1..deep LOOP
   next_frontier='[]';
   -- Sort this whole breadth layer so corrections outrank arbitrary neighbor order.
   FOR n IN SELECT DISTINCT x.kind,x.id,x.reason,x.priority FROM pg_catalog.jsonb_array_elements(frontier) f
    CROSS JOIN LATERAL knowledge.context_neighbors(f->>'kind',(f->>'id')::uuid) x
    ORDER BY x.priority,x.kind,x.id,x.reason LIMIT 401
   LOOP
    counted=counted+1;key=n.kind||':'||n.id::text;
    IF counted>400 OR pg_catalog.cardinality(visited)>=200 THEN trunc=true;EXIT;END IF;
    IF key=ANY(visited) OR NOT knowledge.is_public(n.kind,n.id) THEN CONTINUE;END IF;visited=visited||key;
    entry=pg_catalog.jsonb_build_object('kind',n.kind,'id',n.id,'reason',n.reason,'priority',n.priority,'level',level);entries=entries||pg_catalog.jsonb_build_array(entry);next_frontier=next_frontier||pg_catalog.jsonb_build_array(entry);
   END LOOP;
   frontier=next_frontier;EXIT WHEN pg_catalog.jsonb_array_length(frontier)=0 OR trunc;
  END LOOP;
  SELECT coalesce(pg_catalog.jsonb_agg(e ORDER BY (e->>'priority')::integer,(e->>'level')::integer,e->>'kind',e->>'id'),'[]') INTO entries FROM pg_catalog.jsonb_array_elements(entries) e;
  INSERT INTO knowledge.query_snapshots(query_hash,scope,ordered_entries,status_snapshot) VALUES(qh,'context-v2',entries,pg_catalog.jsonb_build_object('truncated',trunc)) RETURNING * INTO snap;
 END IF;
 trunc=(snap.status_snapshot->>'truncated')::boolean;
 WHILE pos<pg_catalog.jsonb_array_length(snap.ordered_entries) AND scanned<20 LOOP
  entry=snap.ordered_entries->pos;
  IF NOT knowledge.is_public(entry->>'kind',(entry->>'id')::uuid) THEN pos=pos+1;scanned=scanned+1;CONTINUE;END IF;
  item=knowledge.context_item(entry->>'kind',(entry->>'id')::uuid,entry->>'reason');
  IF chars+pg_catalog.length(item->>'text')>16000 THEN EXIT;END IF;
  rel=CASE WHEN entry->>'kind'='relation' THEN knowledge.dto('relation',(entry->>'id')::uuid) ELSE NULL END;
  IF pg_catalog.octet_length((items||pg_catalog.jsonb_build_array(item))::text)+pg_catalog.octet_length((rels||CASE WHEN rel IS NULL THEN '[]'::jsonb ELSE pg_catalog.jsonb_build_array(rel) END)::text)>210000 THEN EXIT;END IF;
  pos=pos+1;scanned=scanned+1;chars=chars+pg_catalog.length(item->>'text');trunc=trunc OR (item->>'text_truncated')::boolean;items=items||pg_catalog.jsonb_build_array(item);
  IF rel IS NOT NULL THEN rels=rels||pg_catalog.jsonb_build_array(rel);END IF;
 END LOOP;
 RETURN pg_catalog.jsonb_build_object('items',items,'relations',rels,'seeds',seeds,'truncated',trunc OR pos<pg_catalog.jsonb_array_length(snap.ordered_entries),'omitted_count',NULL,'snapshot_id',snap.id,'scan_index',pos,'has_more',pos<pg_catalog.jsonb_array_length(snap.ordered_entries),'snapshot_at',knowledge.utc(snap.created_at),'snapshot_expires_at',knowledge.utc(snap.expires_at));
END $$;

CREATE FUNCTION public.kb_embedding_claim(p_actor jsonb,p_query jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE aid uuid;lim integer;job record;claimed jsonb='[]';token uuid;BEGIN
 aid=knowledge.authorize_context(knowledge.identity_context(p_actor));PERFORM knowledge.require(EXISTS(SELECT 1 FROM knowledge.operators WHERE actor_id=aid),'FORBIDDEN');
 PERFORM knowledge.jobject(p_query,ARRAY['limit','profile_id'],ARRAY['limit','profile_id']);lim=knowledge.jint(p_query->'limit',1,3);PERFORM knowledge.require(p_query->>'profile_id'='openai-te3s-1536-v1');
 -- Profile before job locks in BOTH claim and finish, preventing a lock-order inversion.
 PERFORM id FROM knowledge.embedding_profiles WHERE id=p_query->>'profile_id' FOR UPDATE;
 PERFORM knowledge.require(knowledge.profile_compatible(p_query->>'profile_id'),'NOT_CONFIGURED');
 UPDATE knowledge.embedding_profiles SET status='enabled' WHERE id=p_query->>'profile_id';
 -- Exhausted crash/timeout leases must not remain leased forever.
 UPDATE knowledge.embedding_jobs SET state='dead',lease_token=NULL,lease_until=NULL,last_error_code='attempt_limit',updated_at=pg_catalog.clock_timestamp()
 WHERE profile_id=p_query->>'profile_id' AND attempts>=5 AND state='leased' AND lease_until<pg_catalog.clock_timestamp();
 FOR job IN SELECT j.id,j.unit_id,j.input_sha256,u.raw_text FROM knowledge.embedding_jobs j JOIN knowledge.search_units u ON u.id=j.unit_id
  WHERE j.profile_id=p_query->>'profile_id' AND j.input_sha256=u.input_sha256 AND j.attempts<5
  AND (j.state IN ('pending','blocked') OR (j.state='retry' AND j.next_attempt_at<=pg_catalog.clock_timestamp()) OR (j.state='leased' AND j.lease_until<pg_catalog.clock_timestamp()))
  AND knowledge.unit_is_public(j.unit_id) ORDER BY j.created_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT lim
 LOOP
  token=pg_catalog.gen_random_uuid();UPDATE knowledge.embedding_jobs SET state='leased',attempts=attempts+1,lease_until=pg_catalog.clock_timestamp()+interval '90 seconds',lease_token=token,updated_at=pg_catalog.clock_timestamp() WHERE id=job.id;
  claimed=claimed||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',job.id,'unit_id',job.unit_id,'input_sha256',job.input_sha256,'lease_token',token,'text',CASE WHEN pg_catalog.octet_length(job.raw_text)<=12000 THEN job.raw_text ELSE NULL END,'oversized',pg_catalog.octet_length(job.raw_text)>12000));
 END LOOP;
 RETURN claimed;
END $$;
CREATE FUNCTION public.kb_embedding_finish(p_actor jsonb,p_query jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE aid uuid;j knowledge.embedding_jobs%ROWTYPE;vec double precision[];err text;newstate text;BEGIN
 aid=knowledge.authorize_context(knowledge.identity_context(p_actor));PERFORM knowledge.require(EXISTS(SELECT 1 FROM knowledge.operators WHERE actor_id=aid),'FORBIDDEN');
 PERFORM knowledge.jobject(p_query,ARRAY['job_id','lease_token','vector','error'],ARRAY['job_id','lease_token','vector','error']);PERFORM knowledge.juuid(p_query->'job_id');PERFORM knowledge.juuid(p_query->'lease_token');
 PERFORM id FROM knowledge.embedding_profiles WHERE id='openai-te3s-1536-v1' FOR SHARE;
 IF NOT knowledge.profile_compatible('openai-te3s-1536-v1') OR NOT EXISTS(SELECT 1 FROM knowledge.embedding_profiles WHERE id='openai-te3s-1536-v1' AND status='enabled') THEN RETURN '{"accepted":false,"state":"profile_mismatch"}'::jsonb;END IF;
 SELECT * INTO j FROM knowledge.embedding_jobs WHERE id=(p_query->>'job_id')::uuid FOR UPDATE;
 IF j.id IS NULL OR j.profile_id<>'openai-te3s-1536-v1' OR j.state<>'leased' OR j.lease_token IS DISTINCT FROM (p_query->>'lease_token')::uuid OR j.lease_until<=pg_catalog.clock_timestamp() THEN RETURN '{"accepted":false,"state":"stale_lease"}'::jsonb;END IF;
 IF NOT knowledge.unit_is_public(j.unit_id) THEN newstate='blocked';err='not_public';
 ELSIF p_query->'vector'<>'null'::jsonb THEN
  PERFORM knowledge.require(p_query->'error'='null'::jsonb);SELECT pg_catalog.array_agg(value::double precision ORDER BY ord) INTO vec FROM pg_catalog.jsonb_array_elements_text(p_query->'vector') WITH ORDINALITY a(value,ord);
  PERFORM knowledge.require(knowledge.vector_valid(vec));PERFORM knowledge.require(EXISTS(SELECT 1 FROM knowledge.search_units WHERE id=j.unit_id AND input_sha256=j.input_sha256),'TEXT_MISMATCH');
  INSERT INTO knowledge.embedding_vectors(unit_id,profile_id,input_sha256,embedding) VALUES(j.unit_id,j.profile_id,j.input_sha256,vec)
  ON CONFLICT(unit_id,profile_id) DO UPDATE SET input_sha256=EXCLUDED.input_sha256,embedding=EXCLUDED.embedding,created_at=pg_catalog.transaction_timestamp();newstate='ready';err=NULL;
 ELSE
  err=p_query->>'error';PERFORM knowledge.require(err IN ('budget_exhausted','provider_timeout','provider_error','input_too_large','empty_input'));
  newstate=CASE WHEN err='budget_exhausted' THEN 'retry' WHEN j.attempts>=5 OR err IN ('input_too_large','empty_input') THEN 'dead' ELSE 'retry' END;
 END IF;
 -- A denied reservation made no provider call; do not consume a retry attempt.
 UPDATE knowledge.embedding_jobs SET state=newstate,lease_token=NULL,lease_until=NULL,
  attempts=CASE WHEN err IN ('budget_exhausted','not_public') THEN greatest(j.attempts-1,0) ELSE j.attempts END,
  next_attempt_at=CASE WHEN err='budget_exhausted' THEN pg_catalog.to_timestamp((pg_catalog.floor(extract(epoch FROM pg_catalog.clock_timestamp())/86400)+1)*86400) ELSE pg_catalog.clock_timestamp()+interval '60 seconds'*greatest(j.attempts,1) END,
  last_error_code=err,updated_at=pg_catalog.clock_timestamp() WHERE id=j.id;
 RETURN pg_catalog.jsonb_build_object('accepted',true,'state',newstate);
END $$;
CREATE FUNCTION public.kb_embedding_status(p_actor jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE aid uuid;n integer;BEGIN
 aid=knowledge.authorize_context(knowledge.identity_context(p_actor));PERFORM knowledge.require(EXISTS(SELECT 1 FROM knowledge.operators WHERE actor_id=aid),'FORBIDDEN');
 SELECT count(*) INTO n FROM knowledge.embedding_jobs WHERE profile_id='openai-te3s-1536-v1' AND state<>'ready' AND knowledge.unit_is_public(unit_id);
 RETURN pg_catalog.jsonb_build_object('remaining',n);
END $$;
CREATE FUNCTION public.kb_maintenance(p_actor jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE aid uuid;s integer;r integer;BEGIN
 aid=knowledge.authorize_context(knowledge.identity_context(p_actor));PERFORM knowledge.require(EXISTS(SELECT 1 FROM knowledge.operators WHERE actor_id=aid),'FORBIDDEN');
 DELETE FROM knowledge.query_snapshots WHERE id IN(SELECT id FROM knowledge.query_snapshots WHERE expires_at<pg_catalog.clock_timestamp() ORDER BY expires_at LIMIT 1000);GET DIAGNOSTICS s=ROW_COUNT;
 DELETE FROM knowledge.rate_buckets WHERE (bucket,window_start) IN(SELECT bucket,window_start FROM knowledge.rate_buckets WHERE expires_at<pg_catalog.clock_timestamp()-interval '1 day' ORDER BY expires_at LIMIT 1000);GET DIAGNOSTICS r=ROW_COUNT;
 RETURN pg_catalog.jsonb_build_object('expired_snapshots_removed',s,'expired_rate_buckets_removed',r);
END $$;
CREATE OR REPLACE FUNCTION knowledge.index_object(kind text,object_id uuid) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE j jsonb;n integer;s integer=0;e integer;ord integer=0;r record;total integer;t text;BEGIN
 j=knowledge.raw_object(kind,object_id);
 IF kind='version' THEN
  n=pg_catalog.length(j->>'body_text');WHILE s<n LOOP
   e=least(s+1000,n);PERFORM knowledge.add_unit(kind,object_id,'body',pg_catalog.substr(j->>'body_text',s+1,e-s),ord,s,e);ord=ord+1;
   EXIT WHEN e=n;s=s+880;
  END LOOP;
  IF j->>'title' IS NOT NULL THEN PERFORM knowledge.add_unit(kind,object_id,'field',j->>'title',0,NULL,NULL,'/title');END IF;
  SELECT count(*) INTO total FROM knowledge.attribute_leaves(j->'attributes');ord=0;
  FOR r IN SELECT * FROM knowledge.attribute_leaves(j->'attributes') ORDER BY pointer COLLATE "C" LIMIT 64 LOOP
   PERFORM knowledge.add_unit(kind,object_id,'field',r.raw,ord,NULL,NULL,r.pointer,total>64);ord=ord+1;
  END LOOP;
 ELSIF kind IN ('anchor','source','relation','annotation','evidence','review') THEN
  t=CASE kind WHEN 'anchor' THEN j->>'exact' WHEN 'source' THEN coalesce(j->>'title','')||E'\n'||coalesce(j->>'submitted_text','')||E'\n'||coalesce(j->>'url','')
  WHEN 'annotation' THEN j->>'meaning' WHEN 'evidence' THEN coalesce(j->>'quote','')||E'\n'||(j->>'explanation') ELSE j->>'explanation' END;
  n=pg_catalog.length(t);s=0;ord=0;
  WHILE s<n LOOP e=least(s+1000,n);PERFORM knowledge.add_unit(kind,object_id,'object',pg_catalog.substr(t,s+1,e-s),ord);ord=ord+1;EXIT WHEN e=n;s=s+880;END LOOP;
  IF j?'attributes' THEN
   SELECT count(*) INTO total FROM knowledge.attribute_leaves(j->'attributes');
   FOR r IN SELECT * FROM knowledge.attribute_leaves(j->'attributes') ORDER BY pointer COLLATE "C" LIMIT 64 LOOP
    PERFORM knowledge.add_unit(kind,object_id,'object',r.pointer||': '||r.raw,ord,NULL,NULL,NULL,total>64);ord=ord+1;
   END LOOP;
  END IF;
 END IF;
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA knowledge FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE n text;sig text;BEGIN
 FOREACH n IN ARRAY ARRAY['kb_search_state','kb_search','kb_context','kb_embedding_claim','kb_embedding_finish','kb_embedding_status','kb_maintenance'] LOOP
  SELECT pg_catalog.pg_get_function_identity_arguments(p.oid) INTO sig FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname=n;
  EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC,anon,authenticated',n,sig);
  EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role',n,sig);
 END LOOP;
END $$;
UPDATE knowledge.schema_info SET migration_tag='stage03-retrieval' WHERE singleton;
COMMIT;
