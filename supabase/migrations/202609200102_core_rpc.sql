-- Stage 02 / service-only RPCs. All identifiers from clients are values, never SQL.
BEGIN;
CREATE FUNCTION knowledge.require(p_ok boolean,p_code text DEFAULT 'VALIDATION_FAILED') RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ BEGIN
 IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'KB:%',p_code USING ERRCODE='P0001'; END IF;
END $$;
CREATE FUNCTION knowledge.hash(p_text text) RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_text,'UTF8')),'hex')
$$;
CREATE FUNCTION knowledge.jobject(j jsonb,allowed text[],required text[] DEFAULT '{}') RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ DECLARE k text; BEGIN
 PERFORM knowledge.require(pg_catalog.jsonb_typeof(j)='object');
 FOR k IN SELECT pg_catalog.jsonb_object_keys(j) LOOP
  PERFORM knowledge.require(k=ANY(allowed) AND k<>ALL(ARRAY['__proto__','prototype','constructor'])); END LOOP;
 FOREACH k IN ARRAY required LOOP PERFORM knowledge.require(j?k); END LOOP;
END $$;
CREATE FUNCTION knowledge.trim_text(t text) RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 SELECT pg_catalog.btrim(t,E' \t\n\r\f'||pg_catalog.chr(11)||pg_catalog.chr(160)||pg_catalog.chr(5760)||pg_catalog.chr(8192)||pg_catalog.chr(8193)||pg_catalog.chr(8194)||pg_catalog.chr(8195)||pg_catalog.chr(8196)||pg_catalog.chr(8197)||pg_catalog.chr(8198)||pg_catalog.chr(8199)||pg_catalog.chr(8200)||pg_catalog.chr(8201)||pg_catalog.chr(8202)||pg_catalog.chr(8232)||pg_catalog.chr(8233)||pg_catalog.chr(8239)||pg_catalog.chr(8287)||pg_catalog.chr(12288)||pg_catalog.chr(65279))
$$;
CREATE FUNCTION knowledge.jtext(j jsonb,n integer,m integer DEFAULT 1,nullable boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ DECLARE v text; BEGIN
 IF j='null'::jsonb AND nullable THEN RETURN NULL; END IF;
 PERFORM knowledge.require(pg_catalog.jsonb_typeof(j)='string','INVALID_TEXT'); v=j#>>'{}';
 PERFORM knowledge.require(pg_catalog.length(v) BETWEEN m AND n AND (m=0 OR pg_catalog.length(knowledge.trim_text(v))>0)); RETURN v;
END $$;
CREATE FUNCTION knowledge.juuid(j jsonb,nullable boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ BEGIN
 IF j='null'::jsonb AND nullable THEN RETURN NULL; END IF;
 PERFORM knowledge.require(pg_catalog.jsonb_typeof(j)='string' AND (j#>>'{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'); RETURN (j#>>'{}')::uuid;
END $$;
CREATE FUNCTION knowledge.jint(j jsonb,lo integer,hi integer) RETURNS integer
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ DECLARE v numeric; BEGIN
 PERFORM knowledge.require(pg_catalog.jsonb_typeof(j)='number');v=(j#>>'{}')::numeric;
 PERFORM knowledge.require(v=pg_catalog.trunc(v) AND v BETWEEN lo AND hi);RETURN v::integer;
END $$;
CREATE FUNCTION knowledge.jhash(j jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ BEGIN
 PERFORM knowledge.require(pg_catalog.jsonb_typeof(j)='string' AND (j#>>'{}') ~ '^[0-9a-f]{64}$');RETURN j#>>'{}';
END $$;
CREATE FUNCTION knowledge.body(p_text text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ BEGIN
 PERFORM knowledge.require(p_text IS NOT NULL,'INVALID_TEXT');
 PERFORM knowledge.require(pg_catalog.strpos(p_text,pg_catalog.chr(13))=0,'INVALID_LINE_ENDINGS');
 PERFORM knowledge.require(pg_catalog.length(p_text)<=100000 AND pg_catalog.octet_length(p_text)<=1048576,'PAYLOAD_TOO_LARGE');RETURN p_text;
END $$;
CREATE FUNCTION knowledge.attributes_walk(j jsonb,depth integer DEFAULT 0) RETURNS integer
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ DECLARE n integer=0; x record; t text; BEGIN
 PERFORM knowledge.require(depth<=8);t=pg_catalog.jsonb_typeof(j);
 IF t='object' THEN
  FOR x IN SELECT key,value FROM pg_catalog.jsonb_each(j) LOOP
   PERFORM knowledge.jtext(pg_catalog.to_jsonb(x.key),128);
   PERFORM knowledge.require(x.key<>ALL(ARRAY['__proto__','prototype','constructor']));
   n=n+knowledge.attributes_walk(x.value,depth+1);PERFORM knowledge.require(n<=1024); END LOOP;
 ELSIF t='array' THEN
  FOR x IN SELECT value FROM pg_catalog.jsonb_array_elements(j) LOOP n=n+knowledge.attributes_walk(x.value,depth+1);PERFORM knowledge.require(n<=1024);END LOOP;
 ELSE
  PERFORM knowledge.require(t IN ('null','boolean','string','number'));
  IF t='number' THEN PERFORM knowledge.require(abs((j#>>'{}')::numeric)<=9007199254740991); END IF;n=1;
 END IF;RETURN n;
END $$;
CREATE FUNCTION knowledge.compact_json(j jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ DECLARE out_text text;t text=pg_catalog.jsonb_typeof(j);BEGIN
 IF t='array' THEN SELECT '['||coalesce(pg_catalog.string_agg(knowledge.compact_json(value),',' ORDER BY ord),'')||']' INTO out_text FROM pg_catalog.jsonb_array_elements(j) WITH ORDINALITY a(value,ord);
 ELSIF t='object' THEN SELECT '{'||coalesce(pg_catalog.string_agg(pg_catalog.to_jsonb(key)::text||':'||knowledge.compact_json(value),',' ORDER BY key COLLATE "C"),'')||'}' INTO out_text FROM pg_catalog.jsonb_each(j);
 ELSE out_text=j::text;END IF;RETURN out_text;
END $$;
CREATE FUNCTION knowledge.attributes(j jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ BEGIN
 PERFORM knowledge.require(pg_catalog.jsonb_typeof(j)='object');PERFORM knowledge.attributes_walk(j);
 PERFORM knowledge.require(pg_catalog.octet_length(knowledge.compact_json(j))<=65536,'PAYLOAD_TOO_LARGE');
END $$;
CREATE FUNCTION knowledge.validate_ref(j jsonb,kinds text[]) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ BEGIN
 PERFORM knowledge.jobject(j,ARRAY['kind','id'],ARRAY['kind','id']);PERFORM knowledge.require(j->>'kind'=ANY(kinds));PERFORM knowledge.juuid(j->'id');
END $$;
CREATE FUNCTION knowledge.validate_basis(j jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ BEGIN
 PERFORM knowledge.jtext(j->'explanation',8000);
 CASE j->>'kind'
 WHEN 'external' THEN
  PERFORM knowledge.jobject(j,ARRAY['kind','source_id','quote','explanation'],ARRAY['kind','source_id','quote','explanation']);
  PERFORM knowledge.juuid(j->'source_id');PERFORM knowledge.jtext(j->'quote',10000,1,true);
 WHEN 'internal' THEN
  PERFORM knowledge.jobject(j,ARRAY['kind','source','explanation'],ARRAY['kind','source','explanation']);PERFORM knowledge.validate_ref(j->'source',ARRAY['version','anchor']);
 WHEN 'reasoning' THEN PERFORM knowledge.jobject(j,ARRAY['kind','explanation'],ARRAY['kind','explanation']);
 ELSE PERFORM knowledge.require(false); END CASE;
END $$;
CREATE FUNCTION knowledge.validate_bases(j jsonb,min_count integer DEFAULT 0) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ DECLARE x jsonb; BEGIN
 PERFORM knowledge.require(pg_catalog.jsonb_typeof(j)='array');PERFORM knowledge.require(pg_catalog.jsonb_array_length(j)>=min_count);
 FOR x IN SELECT value FROM pg_catalog.jsonb_array_elements(j) LOOP PERFORM knowledge.validate_basis(x); END LOOP;
END $$;
CREATE FUNCTION knowledge.validate_metadata(j jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ DECLARE x jsonb; seen text[]='{}'; k text; BEGIN
 PERFORM knowledge.jobject(j,ARRAY['title','body_format','attributes_set','attributes_remove']);
 IF j?'title' THEN PERFORM knowledge.jtext(j->'title',240,1,true); END IF;
 IF j?'body_format' THEN PERFORM knowledge.require(j->>'body_format' IN ('plain_text','markdown')); END IF;
 IF j?'attributes_set' THEN PERFORM knowledge.attributes(j->'attributes_set');END IF;
 IF j?'attributes_remove' THEN
  PERFORM knowledge.require(pg_catalog.jsonb_typeof(j->'attributes_remove')='array');
  FOR x IN SELECT value FROM pg_catalog.jsonb_array_elements(j->'attributes_remove') LOOP
   k=knowledge.jtext(x,128);PERFORM knowledge.require(k<>ALL(ARRAY['__proto__','prototype','constructor']) AND k<>ALL(seen) AND NOT coalesce((j->'attributes_set')?k,false));seen=pg_catalog.array_append(seen,k);
  END LOOP;
 END IF;
END $$;
CREATE FUNCTION knowledge.validate_date(j jsonb) RETURNS void LANGUAGE plpgsql STABLE SET search_path='' AS $$ DECLARE v text; t timestamptz; BEGIN
 IF j='null'::jsonb THEN RETURN;END IF;v=knowledge.jtext(j,40);
 PERFORM knowledge.require(v ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$');
 PERFORM knowledge.require(pg_catalog.substr(v,1,4)::integer>=1 AND pg_catalog.substr(v,12,2)::integer<24 AND pg_catalog.substr(v,15,2)::integer<60 AND pg_catalog.substr(v,18,2)::integer<60);
 BEGIN t=v::timestamptz;EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN PERFORM knowledge.require(false);END;
END $$;
CREATE FUNCTION knowledge.validate_command(op text,j jsonb) RETURNS void LANGUAGE plpgsql STABLE SET search_path='' AS $$ DECLARE fields text[]; x jsonb; t text; BEGIN
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
   PERFORM knowledge.jobject(x,ARRAY['start','end','exact','replacement'],ARRAY['start','end','exact','replacement']);
   PERFORM knowledge.jint(x->'start',0,100000);PERFORM knowledge.jint(x->'end',(x->>'start')::integer,100000);
   PERFORM knowledge.body(knowledge.jtext(x->'exact',100000,0));PERFORM knowledge.body(knowledge.jtext(x->'replacement',100000,0));
  END LOOP;
  IF j?'metadata_update' THEN PERFORM knowledge.validate_metadata(j->'metadata_update');END IF;
  PERFORM knowledge.jtext(j->'reason',2000);PERFORM knowledge.validate_bases(j->'basis',1);
 WHEN 'anchor.create' THEN
  PERFORM knowledge.juuid(j->'version_id');PERFORM knowledge.jhash(j->'body_sha256');x=j->'selector';
  PERFORM knowledge.jobject(x,ARRAY['unit','start','end','exact','prefix','suffix'],ARRAY['unit','start','end','exact','prefix','suffix']);
  PERFORM knowledge.require(x->>'unit'='unicode_code_point');PERFORM knowledge.jint(x->'start',0,99999);PERFORM knowledge.jint(x->'end',(x->>'start')::integer+1,100000);
  PERFORM knowledge.body(knowledge.jtext(x->'exact',100000,0));PERFORM knowledge.jtext(x->'prefix',32,0);PERFORM knowledge.jtext(x->'suffix',32,0);
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

-- Code-point splice: PostgreSQL UTF8 length/substr count scalar characters, not bytes.
-- Re-read and verify against the stored body. No caller-calculated new body is accepted.
CREATE FUNCTION knowledge.apply_edits(p_body text,p_hash text,p_edits jsonb,p_metadata_changed boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE a jsonb; b jsonb; s integer;e integer;bs integer;be integer;i integer;k integer;n integer;out_text text=p_body;
BEGIN
 PERFORM knowledge.body(p_body);PERFORM knowledge.require(knowledge.hash(p_body)=p_hash,'BASE_HASH_MISMATCH');
 PERFORM knowledge.require(pg_catalog.jsonb_typeof(p_edits)='array');n=pg_catalog.jsonb_array_length(p_edits);PERFORM knowledge.require(n<=20);
 FOR i IN 0..n-1 LOOP
  a=p_edits->i;PERFORM knowledge.jobject(a,ARRAY['start','end','exact','replacement'],ARRAY['start','end','exact','replacement']);
  s=knowledge.jint(a->'start',0,pg_catalog.length(p_body));e=knowledge.jint(a->'end',s,pg_catalog.length(p_body));
  PERFORM knowledge.body(knowledge.jtext(a->'exact',100000,0));PERFORM knowledge.body(knowledge.jtext(a->'replacement',100000,0));
  PERFORM knowledge.require(pg_catalog.substr(p_body,s+1,e-s)=a->>'exact','TEXT_MISMATCH');
  FOR k IN 0..i-1 LOOP
   b=p_edits->k;bs=(b->>'start')::integer;be=(b->>'end')::integer;
   PERFORM knowledge.require(NOT(CASE WHEN s=e AND bs=be THEN s=bs WHEN s=e THEN s BETWEEN bs AND be WHEN bs=be THEN bs BETWEEN s AND e ELSE greatest(s,bs)<least(e,be) END),'OVERLAPPING_EDITS');
  END LOOP;
 END LOOP;
 FOR a IN SELECT value FROM pg_catalog.jsonb_array_elements(p_edits) ORDER BY (value->>'start')::integer DESC,(value->>'end')::integer DESC LOOP
  s=(a->>'start')::integer;e=(a->>'end')::integer;
  out_text=pg_catalog.substr(out_text,1,s)||(a->>'replacement')||pg_catalog.substr(out_text,e+1);
 END LOOP;
 PERFORM knowledge.body(out_text);PERFORM knowledge.require(out_text<>p_body OR p_metadata_changed,'NO_CHANGE');RETURN out_text;
END $$;
CREATE FUNCTION knowledge.project_anchor(p_body text,p_selector jsonb,p_edits jsonb,p_direct boolean) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ DECLARE a jsonb;s integer;e integer;d integer=0;st integer;en integer;out_text text; BEGIN
 IF NOT p_direct THEN RETURN '{"state":"not_projected","reason":"not_direct_parent"}'::jsonb; END IF;
 st=(p_selector->>'start')::integer;en=(p_selector->>'end')::integer;
 out_text=knowledge.apply_edits(p_body,knowledge.hash(p_body),p_edits,true);
 PERFORM knowledge.require(st>=0 AND st<en AND en<=pg_catalog.length(p_body) AND pg_catalog.substr(p_body,st+1,en-st)=p_selector->>'exact','TEXT_MISMATCH');
 FOR a IN SELECT value FROM pg_catalog.jsonb_array_elements(p_edits) LOOP
  s=(a->>'start')::integer;e=(a->>'end')::integer;
  IF (s=e AND s BETWEEN st AND en) OR(s<en AND e>st) THEN RETURN '{"state":"needs_reanchor","reason":"edited_or_boundary"}'::jsonb;END IF;
  IF e<=st THEN d=d+pg_catalog.length(a->>'replacement')-(e-s);END IF;
 END LOOP;st=st+d;en=en+d;
 RETURN pg_catalog.jsonb_build_object('state','candidate','requires_confirmation',true,'selector',pg_catalog.jsonb_build_object('unit','unicode_code_point','start',st,'end',en,'exact',pg_catalog.substr(out_text,st+1,en-st),'prefix',pg_catalog.substr(out_text,greatest(0,st-32)+1,least(32,st)),'suffix',pg_catalog.substr(out_text,en+1,32)));
END $$;

CREATE FUNCTION knowledge.codepoint_slice(p_text text,p_start integer,p_end integer) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ BEGIN
 PERFORM knowledge.body(p_text);PERFORM knowledge.require(p_start>=0 AND p_end>=p_start AND p_end<=pg_catalog.length(p_text));RETURN pg_catalog.substr(p_text,p_start+1,p_end-p_start);
END $$;
CREATE FUNCTION knowledge.utf16_to_codepoint(p_text text,p_offset integer) RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ DECLARE at integer=0;i integer=0;w integer;BEGIN
 PERFORM knowledge.body(p_text);PERFORM knowledge.require(p_offset>=0);
 WHILE i<pg_catalog.length(p_text) LOOP
  IF at=p_offset THEN RETURN i;END IF;w=CASE WHEN pg_catalog.ascii(pg_catalog.substr(p_text,i+1,1))>65535 THEN 2 ELSE 1 END;
  IF p_offset>at AND p_offset<at+w THEN PERFORM knowledge.require(false,'INVALID_TEXT');END IF;at=at+w;i=i+1;
 END LOOP;PERFORM knowledge.require(at=p_offset);RETURN i;
END $$;
CREATE FUNCTION knowledge.chunk_body(p_text text) RETURNS TABLE(start_cp integer,end_cp integer,raw_text text) LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ DECLARE s integer=0;e integer;n integer;BEGIN
 PERFORM knowledge.body(p_text);n=pg_catalog.length(p_text);
 WHILE s<n LOOP e=least(s+1000,n);RETURN QUERY SELECT s,e,pg_catalog.substr(p_text,s+1,e-s);EXIT WHEN e=n;s=s+880;END LOOP;
END $$;

-- Typed columns are the source of truth. JSON references are output DTOs only.
CREATE FUNCTION knowledge.row_ref(j jsonb,prefix text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ DECLARE k text; v text; BEGIN
 FOREACH k IN ARRAY ARRAY['version','anchor','source','relation','annotation','evidence','review'] LOOP
  v=j->>(prefix||'_'||k||'_id');IF v IS NOT NULL THEN RETURN pg_catalog.jsonb_build_object('kind',k,'id',v);END IF;
 END LOOP;RETURN 'null'::jsonb;
END $$;
CREATE FUNCTION knowledge.ref_id(j jsonb,kind text) RETURNS uuid LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN j->>'kind'=kind THEN (j->>'id')::uuid ELSE NULL END
$$;
CREATE FUNCTION knowledge.raw_object(kind text,object_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$ DECLARE j jsonb; BEGIN
 CASE kind
 WHEN 'record' THEN SELECT pg_catalog.to_jsonb(t) INTO j FROM knowledge.records t WHERE id=object_id;
 WHEN 'version' THEN SELECT pg_catalog.to_jsonb(t) INTO j FROM knowledge.versions t WHERE id=object_id;
 WHEN 'anchor' THEN SELECT pg_catalog.to_jsonb(t) INTO j FROM knowledge.anchors t WHERE id=object_id;
 WHEN 'source' THEN SELECT pg_catalog.to_jsonb(t) INTO j FROM knowledge.sources t WHERE id=object_id;
 WHEN 'relation' THEN SELECT pg_catalog.to_jsonb(t) INTO j FROM knowledge.relations t WHERE id=object_id;
 WHEN 'annotation' THEN SELECT pg_catalog.to_jsonb(t) INTO j FROM knowledge.annotations t WHERE id=object_id;
 WHEN 'evidence' THEN SELECT pg_catalog.to_jsonb(t) INTO j FROM knowledge.evidence t WHERE id=object_id;
 WHEN 'review' THEN SELECT pg_catalog.to_jsonb(t) INTO j FROM knowledge.reviews t WHERE id=object_id;
 WHEN 'work_request' THEN SELECT pg_catalog.to_jsonb(t) INTO j FROM knowledge.work_requests t WHERE id=object_id;
 ELSE PERFORM knowledge.require(false);END CASE;RETURN j;
END $$;
CREATE FUNCTION knowledge.is_public(kind text,object_id uuid,seen text[] DEFAULT '{}',ignore_self boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path='' AS $$ DECLARE j jsonb;r jsonb;k text;marker text=kind||':'||object_id::text; BEGIN
 IF object_id IS NULL OR marker=ANY(seen) OR pg_catalog.cardinality(seen)>128 THEN RETURN false;END IF;
 j=knowledge.raw_object(kind,object_id);IF j IS NULL OR (j->>'visibility'<>'public' AND NOT ignore_self) THEN RETURN false;END IF;seen=pg_catalog.array_append(seen,marker);
 CASE kind
 WHEN 'version' THEN RETURN knowledge.is_public('record',(j->>'record_id')::uuid,seen);
 WHEN 'anchor' THEN RETURN knowledge.is_public('version',(j->>'version_id')::uuid,seen);
 WHEN 'relation' THEN
  r=knowledge.row_ref(j,'from');IF NOT knowledge.is_public(r->>'kind',(r->>'id')::uuid,seen) THEN RETURN false;END IF;
  r=knowledge.row_ref(j,'to');RETURN knowledge.is_public(r->>'kind',(r->>'id')::uuid,seen);
 WHEN 'annotation' THEN RETURN knowledge.is_public('anchor',(j->>'anchor_id')::uuid,seen) AND ((j->>'concept_version_id') IS NULL OR knowledge.is_public('version',(j->>'concept_version_id')::uuid,seen));
 WHEN 'review' THEN r=knowledge.row_ref(j,'target');RETURN knowledge.is_public(r->>'kind',(r->>'id')::uuid,seen);
 WHEN 'evidence' THEN
  r=knowledge.row_ref(j,'target');IF NOT knowledge.is_public(r->>'kind',(r->>'id')::uuid,seen) THEN RETURN false;END IF;
  IF j->>'kind'='external' THEN RETURN knowledge.is_public('source',(j->>'source_id')::uuid,seen);
  ELSIF j->>'kind'='internal' THEN r=knowledge.row_ref(j,'source');RETURN knowledge.is_public(r->>'kind',(r->>'id')::uuid,seen);END IF;RETURN true;
 WHEN 'work_request' THEN
  r=knowledge.row_ref(j,'target');IF r<>'null'::jsonb AND NOT knowledge.is_public(r->>'kind',(r->>'id')::uuid,seen) THEN RETURN false;END IF;
  FOR r IN SELECT knowledge.row_ref(pg_catalog.to_jsonb(l),'target') FROM knowledge.work_resolution_links l WHERE l.event_id=(j->>'resolution_event_id')::uuid LOOP
   IF NOT knowledge.is_public(r->>'kind',(r->>'id')::uuid,seen) THEN RETURN false;END IF;
  END LOOP;RETURN true;
 ELSE RETURN true; END CASE;
END $$;
CREATE FUNCTION knowledge.require_public(kind text,object_id uuid) RETURNS void LANGUAGE plpgsql STABLE SET search_path='' AS $$ DECLARE j jsonb;parent_ok boolean=true; BEGIN
 IF knowledge.is_public(kind,object_id) THEN RETURN;END IF;j=knowledge.raw_object(kind,object_id);
 -- A dependent hidden object is always 404. Only a directly public-parent tombstone is 410.
 IF j->>'visibility'='tombstone' THEN
  parent_ok=knowledge.is_public(kind,object_id,'{}',true);
  IF parent_ok THEN PERFORM knowledge.require(false,'RESOURCE_GONE');END IF;
 END IF;PERFORM knowledge.require(false,'NOT_FOUND');
END $$;
CREATE FUNCTION knowledge.require_ref(j jsonb) RETURNS void LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT knowledge.require_public(j->>'kind',(j->>'id')::uuid)
$$;
CREATE FUNCTION knowledge.current_version(record uuid) RETURNS uuid LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT v.id FROM knowledge.versions v JOIN knowledge.records r ON v.record_id=r.id WHERE r.id=record AND r.visibility='public' AND v.visibility='public' ORDER BY v.version_no DESC LIMIT 1
$$;
CREATE FUNCTION knowledge.utc(t timestamptz) RETURNS text LANGUAGE sql STABLE STRICT SET search_path='' AS $$
 SELECT pg_catalog.to_char(t AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;
CREATE FUNCTION knowledge.dto(kind text,object_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE j jsonb;o jsonb;ref jsonb;k text;cols text[];BEGIN
 j=knowledge.raw_object(kind,object_id);PERFORM knowledge.require(j IS NOT NULL,'NOT_FOUND');
 o=j;
 FOREACH k IN ARRAY ARRAY['created_at','updated_at','published_at','retrieved_at'] LOOP
  IF j?k THEN o=pg_catalog.jsonb_set(o,ARRAY[k],coalesce(pg_catalog.to_jsonb(knowledge.utc((j->>k)::timestamptz)),'null'::jsonb));END IF;
 END LOOP;
 IF kind NOT IN ('source','version') THEN o=o-'visibility';END IF;
 CASE kind
 WHEN 'anchor' THEN o=o-ARRAY['start_cp','end_cp','exact','prefix','suffix'];
  o=o||pg_catalog.jsonb_build_object('selector',pg_catalog.jsonb_build_object('unit','unicode_code_point','start',(j->>'start_cp')::integer,'end',(j->>'end_cp')::integer,'exact',j->'exact','prefix',j->'prefix','suffix',j->'suffix'));
 WHEN 'relation' THEN o=o||pg_catalog.jsonb_build_object('from',knowledge.row_ref(j,'from'),'to',knowledge.row_ref(j,'to'));
 WHEN 'review' THEN o=o||pg_catalog.jsonb_build_object('target',knowledge.row_ref(j,'target'));
 WHEN 'evidence' THEN
  IF j->>'kind'='reasoning' THEN ref=pg_catalog.jsonb_build_object('kind','reasoning','explanation',j->'explanation');
  ELSIF j->>'kind'='external' THEN ref=pg_catalog.jsonb_build_object('kind','external','source_id',j->'source_id','quote',j->'quote','explanation',j->'explanation');
  ELSE ref=pg_catalog.jsonb_build_object('kind','internal','source',knowledge.row_ref(j,'source'),'explanation',j->'explanation');END IF;
  o=o-ARRAY['kind','explanation','source_id','source_version_id','source_anchor_id','quote'];o=o||pg_catalog.jsonb_build_object('target',knowledge.row_ref(j,'target'),'basis',ref);
 WHEN 'work_request' THEN
  SELECT coalesce(pg_catalog.jsonb_agg(knowledge.row_ref(pg_catalog.to_jsonb(l),'target') ORDER BY ordinal),'[]'::jsonb) INTO ref FROM knowledge.work_resolution_links l WHERE event_id=(j->>'resolution_event_id')::uuid;
  o=(o-'resolution_event_id')||pg_catalog.jsonb_build_object('target',knowledge.row_ref(j,'target'),'resolution_refs',ref);
 ELSE NULL;END CASE;
 SELECT coalesce(pg_catalog.array_agg(key),'{}'::text[]) INTO cols FROM pg_catalog.jsonb_object_keys(o) key WHERE key ~ '^(from|to|target)_(version|anchor|source|relation|annotation|evidence|review)_id$';
 RETURN o-cols;
END $$;
CREATE FUNCTION knowledge.review_summary(kind text,object_id uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT pg_catalog.jsonb_build_object('agree',count(*) FILTER(WHERE r.stance='agree'),'disagree',count(*) FILTER(WHERE r.stance='disagree'),'needs_review',count(*) FILTER(WHERE r.stance='needs_review'),'effective_reviewers',count(DISTINCT h.actor_id),'review_state',CASE WHEN count(*)=0 THEN 'unreviewed' ELSE 'reviewed' END,'approval_inherited',false)
 FROM knowledge.review_heads h JOIN knowledge.reviews r ON r.id=h.review_id WHERE h.target_kind=kind AND h.target_id=object_id AND knowledge.is_public('review',r.id)
$$;
CREATE FUNCTION knowledge.evidence_for(kind text,object_id uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(pg_catalog.jsonb_agg(knowledge.dto('evidence',id) ORDER BY created_at,id),'[]'::jsonb) FROM knowledge.evidence e WHERE knowledge.row_ref(pg_catalog.to_jsonb(e),'target')=pg_catalog.jsonb_build_object('kind',$1,'id',$2) AND knowledge.is_public('evidence',e.id)
$$;
CREATE FUNCTION knowledge.version_view(version uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE v knowledge.versions%ROWTYPE;a jsonb;c uuid;corrections jsonb;ac bigint;rc bigint;vc bigint; BEGIN
 PERFORM knowledge.require_public('version',version);SELECT * INTO v FROM knowledge.versions WHERE id=version;c=knowledge.current_version(v.record_id);
 SELECT pg_catalog.jsonb_build_object('id',id,'kind',kind,'display_name',display_name,'self_description',self_description,'state',state) INTO a FROM knowledge.actors WHERE id=v.created_by;
 SELECT coalesce(pg_catalog.jsonb_agg(knowledge.row_ref(pg_catalog.to_jsonb(r),'from') ORDER BY created_at,id),'[]'::jsonb) INTO corrections FROM knowledge.relations r
 WHERE predicate='corrects' AND (to_version_id=version OR to_anchor_id IN(SELECT id FROM knowledge.anchors WHERE version_id=version)) AND knowledge.is_public('relation',id);
 SELECT count(*) INTO ac FROM knowledge.annotations an JOIN knowledge.anchors aa ON an.anchor_id=aa.id WHERE aa.version_id=version AND knowledge.is_public('annotation',an.id);
 SELECT count(*) INTO rc FROM knowledge.relations r WHERE (r.from_version_id=version OR r.to_version_id=version OR r.from_anchor_id IN(SELECT id FROM knowledge.anchors WHERE version_id=version) OR r.to_anchor_id IN(SELECT id FROM knowledge.anchors WHERE version_id=version)) AND knowledge.is_public('relation',r.id);
 SELECT count(*) INTO vc FROM knowledge.reviews r WHERE target_version_id=version AND knowledge.is_public('review',id);
 RETURN pg_catalog.jsonb_build_object('version',knowledge.dto('version',version),'author',a,'is_current',c=version,'current_version_id',c,'basis',knowledge.evidence_for('version',version),'review_summary',knowledge.review_summary('version',version),'correction_refs',corrections,'related_counts',pg_catalog.jsonb_build_object('annotations',ac,'relations',rc,'reviews',vc),'links',pg_catalog.jsonb_build_object('record','/records/'||v.record_id,'version','/versions/'||v.id,'history','/records/'||v.record_id||'/history','raw','/api/v1/versions/'||v.id||'/raw'));
END $$;

-- Lexical units and the blocked outbox are created in the same mutation transaction.
CREATE FUNCTION knowledge.attribute_leaves(j jsonb,path text DEFAULT '/attributes') RETURNS TABLE(pointer text,raw text)
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ DECLARE r record;i integer=0;BEGIN
 IF pg_catalog.jsonb_typeof(j)='object' THEN
  FOR r IN SELECT key,value FROM pg_catalog.jsonb_each(j) ORDER BY key COLLATE "C" LOOP
   RETURN QUERY SELECT * FROM knowledge.attribute_leaves(r.value,path||'/'||pg_catalog.replace(pg_catalog.replace(r.key,'~','~0'),'/','~1'));
  END LOOP;
 ELSIF pg_catalog.jsonb_typeof(j)='array' THEN
  FOR r IN SELECT value FROM pg_catalog.jsonb_array_elements(j) LOOP RETURN QUERY SELECT * FROM knowledge.attribute_leaves(r.value,path||'/'||i::text);i=i+1;END LOOP;
 ELSE RETURN QUERY SELECT path,coalesce(j#>>'{}','null'); END IF;
END $$;
CREATE FUNCTION knowledge.add_unit(kind text,object_id uuid,unit_type text,raw_value text,ord integer,p_start integer DEFAULT NULL,p_end integer DEFAULT NULL,p_pointer text DEFAULT NULL,truncated boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$ DECLARE u uuid;v knowledge.versions%ROWTYPE;h text;BEGIN
 h=knowledge.hash(raw_value);IF kind='version' THEN SELECT * INTO v FROM knowledge.versions WHERE id=object_id;END IF;
 INSERT INTO knowledge.search_units(unit_kind,record_id,version_id,object_version_id,object_anchor_id,object_source_id,object_relation_id,object_annotation_id,object_evidence_id,object_review_id,start_cp,end_cp,json_pointer,ordinal,raw_text,input_sha256,lexical_text,lexical_truncated)
 VALUES(unit_type,v.record_id,v.id,NULL,
 CASE WHEN kind='anchor' THEN object_id END,CASE WHEN kind='source' THEN object_id END,CASE WHEN kind='relation' THEN object_id END,CASE WHEN kind='annotation' THEN object_id END,CASE WHEN kind='evidence' THEN object_id END,CASE WHEN kind='review' THEN object_id END,
 p_start,p_end,p_pointer,ord,raw_value,h,pg_catalog.lower(pg_catalog.normalize(raw_value,'NFKC')),truncated) RETURNING id INTO u;
 INSERT INTO knowledge.embedding_jobs(unit_id,profile_id,input_sha256,state)
 SELECT u,id,h,CASE WHEN status='enabled' THEN 'pending' ELSE 'blocked' END FROM knowledge.embedding_profiles WHERE id='openai-te3s-1536-v1';
END $$;
CREATE FUNCTION knowledge.index_object(kind text,object_id uuid) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
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
  PERFORM knowledge.add_unit(kind,object_id,'object',t,0);
  IF j?'attributes' THEN
   SELECT count(*) INTO total FROM knowledge.attribute_leaves(j->'attributes');ord=1;
   FOR r IN SELECT * FROM knowledge.attribute_leaves(j->'attributes') ORDER BY pointer COLLATE "C" LIMIT 64 LOOP
    PERFORM knowledge.add_unit(kind,object_id,'object',r.pointer||': '||r.raw,ord,NULL,NULL,NULL,total>64);ord=ord+1;
   END LOOP;
  END IF;
 END IF;
END $$;
CREATE FUNCTION knowledge.unit_is_public(unit uuid) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path='' AS $$ DECLARE j jsonb;r jsonb;BEGIN
 SELECT pg_catalog.to_jsonb(u) INTO j FROM knowledge.search_units u WHERE id=unit;IF j IS NULL THEN RETURN false;END IF;
 IF j->>'version_id' IS NOT NULL THEN RETURN knowledge.is_public('version',(j->>'version_id')::uuid);END IF;
 r=knowledge.row_ref(j,'object');RETURN knowledge.is_public(r->>'kind',(r->>'id')::uuid);
END $$;
CREATE FUNCTION knowledge.insert_evidence(target jsonb,basis jsonb,actor uuid) RETURNS uuid LANGUAGE plpgsql SET search_path='' AS $$ DECLARE i uuid;BEGIN
 PERFORM knowledge.validate_ref(target,ARRAY['version','anchor','source','relation','annotation','review']);PERFORM knowledge.validate_basis(basis);PERFORM knowledge.require_ref(target);
 IF basis->>'kind'='external' THEN PERFORM knowledge.require_public('source',(basis->>'source_id')::uuid);
 ELSIF basis->>'kind'='internal' THEN PERFORM knowledge.require_ref(basis->'source');END IF;
 INSERT INTO knowledge.evidence(created_by,target_version_id,target_anchor_id,target_source_id,target_relation_id,target_annotation_id,target_review_id,kind,source_id,source_version_id,source_anchor_id,quote,explanation)
 VALUES(actor,knowledge.ref_id(target,'version'),knowledge.ref_id(target,'anchor'),knowledge.ref_id(target,'source'),knowledge.ref_id(target,'relation'),knowledge.ref_id(target,'annotation'),knowledge.ref_id(target,'review'),basis->>'kind',
 (basis->>'source_id')::uuid,knowledge.ref_id(basis->'source','version'),knowledge.ref_id(basis->'source','anchor'),basis->>'quote',basis->>'explanation') RETURNING id INTO i;
 PERFORM knowledge.index_object('evidence',i);RETURN i;
END $$;
CREATE FUNCTION knowledge.add_bases(kind text,object_id uuid,bases jsonb,actor uuid) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$ DECLARE b jsonb;BEGIN
 FOR b IN SELECT value FROM pg_catalog.jsonb_array_elements(bases) LOOP PERFORM knowledge.insert_evidence(pg_catalog.jsonb_build_object('kind',kind,'id',object_id),b,actor);END LOOP;
END $$;
CREATE FUNCTION knowledge.authorize_context(c jsonb) RETURNS uuid LANGUAGE plpgsql SET search_path='' AS $$
DECLARE a knowledge.actors%ROWTYPE;k knowledge.agent_keys%ROWTYPE;ac jsonb;ag knowledge.agents%ROWTYPE;BEGIN
 PERFORM knowledge.jobject(c,ARRAY['actor','operation','idempotency_key','request_hash'],ARRAY['actor','operation','idempotency_key','request_hash']);
 ac=c->'actor';PERFORM knowledge.require(ac->>'kind' IN ('human','agent'),'UNAUTHENTICATED');
 PERFORM knowledge.jobject(ac,CASE WHEN ac->>'kind'='human' THEN ARRAY['kind','actor_id','auth_user_id'] ELSE ARRAY['kind','actor_id','key_id'] END,
 CASE WHEN ac->>'kind'='human' THEN ARRAY['kind','actor_id','auth_user_id'] ELSE ARRAY['kind','actor_id','key_id'] END);
 PERFORM knowledge.juuid(ac->'actor_id');PERFORM knowledge.jhash(c->'request_hash');
 PERFORM knowledge.require(c->>'idempotency_key' ~ '^[A-Za-z0-9._~-]{16,128}$');PERFORM knowledge.jtext(c->'operation',160);
 -- Global shared visibility fence -> actor -> key -> record/work/head.
 -- Stage 4 moderation MUST take the exclusive fence before actor/record locks.
 PERFORM pg_catalog.pg_advisory_xact_lock_shared(2081801,1);
 SELECT * INTO a FROM knowledge.actors WHERE id=(ac->>'actor_id')::uuid FOR UPDATE;
 PERFORM knowledge.require(a.id IS NOT NULL AND a.kind=ac->>'kind','UNAUTHENTICATED');
 IF a.kind='human' THEN
  PERFORM knowledge.juuid(ac->'auth_user_id');PERFORM knowledge.require(a.auth_user_id=(ac->>'auth_user_id')::uuid,'UNAUTHENTICATED');
  PERFORM knowledge.require(a.state='active','FORBIDDEN');
 ELSE
  PERFORM knowledge.juuid(ac->'key_id');
  SELECT * INTO k FROM knowledge.agent_keys WHERE id=(ac->>'key_id')::uuid AND actor_id=a.id FOR UPDATE;
  PERFORM knowledge.require(k.id IS NOT NULL AND k.revoked_at IS NULL,'KEY_REVOKED');
  SELECT * INTO ag FROM knowledge.agents WHERE actor_id=a.id;
  PERFORM knowledge.require(a.state='active' AND ag.owner_actor_id IS NOT NULL,'AGENT_NOT_APPROVED');
 END IF;RETURN a.id;
END $$;
CREATE FUNCTION knowledge.mutation_result(kind text,result_id uuid,meta jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$ DECLARE data jsonb;ev knowledge.work_events%ROWTYPE;refs jsonb;BEGIN
 PERFORM knowledge.require_public(kind,result_id);data=knowledge.dto(kind,result_id);
 IF kind='version' THEN
  data=pg_catalog.jsonb_build_object('version',data,'previous_current_version_id',meta->'previous_current_version_id','branched_from_noncurrent',meta->'branched_from_noncurrent','indexing',meta->'indexing');
 ELSIF kind='work_request' AND meta?'event_id' THEN
  SELECT * INTO ev FROM knowledge.work_events WHERE id=(meta->>'event_id')::uuid AND work_request_id=result_id;
  PERFORM knowledge.require(ev.id IS NOT NULL,'INTERNAL_ERROR');
  SELECT coalesce(pg_catalog.jsonb_agg(knowledge.row_ref(pg_catalog.to_jsonb(l),'target') ORDER BY ordinal),'[]'::jsonb) INTO refs FROM knowledge.work_resolution_links l WHERE l.event_id=ev.resolution_event_after;
  -- Reconstruct the original revision without duplicating title/description in a receipt.
  IF EXISTS(SELECT 1 FROM knowledge.work_resolution_links l WHERE l.event_id=ev.resolution_event_after AND NOT knowledge.is_public(knowledge.row_ref(pg_catalog.to_jsonb(l),'target')->>'kind',(knowledge.row_ref(pg_catalog.to_jsonb(l),'target')->>'id')::uuid)) THEN PERFORM knowledge.require(false,'NOT_FOUND');END IF;
  data=data||pg_catalog.jsonb_build_object('status',ev.state_after,'revision',ev.revision,'assigned_to',ev.assigned_after,'updated_at',knowledge.utc(ev.created_at),'resolution_refs',refs);
 END IF;RETURN data;
END $$;
CREATE FUNCTION knowledge.mutate(op text,c jsonb,j jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE actor uuid;operation text;receipt knowledge.mutation_receipts%ROWTYPE;d text;kind text;i uuid;meta jsonb='{}';
 v knowledge.versions%ROWTYPE;base knowledge.versions%ROWTYPE;r knowledge.records%ROWTYPE;current_id uuid;
 body_text text;attrs jsonb;title text;format text;m jsonb;key text;changed boolean;an knowledge.anchors%ROWTYPE;sel jsonb;s integer;e integer;
 prev uuid;wr knowledge.work_requests%ROWTYPE;ev uuid;is_operator boolean;action text;new_status text;assigned uuid;resolution uuid;ref jsonb;ord integer;
BEGIN
 PERFORM knowledge.validate_command(op,j);actor=knowledge.authorize_context(c);
 operation=op||CASE WHEN op='version.create' THEN ':'||(j->>'record_id')::uuid::text WHEN op='work_request.update' THEN ':'||(j->>'work_request_id')::uuid::text ELSE '' END;
 PERFORM knowledge.require(c->>'operation'=operation);d=knowledge.hash(j::text);
 SELECT * INTO receipt FROM knowledge.mutation_receipts WHERE actor_id=actor AND mutation_receipts.operation=c->>'operation' AND idempotency_key=c->>'idempotency_key';
 IF receipt.actor_id IS NOT NULL THEN
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
  SELECT review_id INTO prev FROM knowledge.review_heads WHERE actor_id=actor AND target_kind=j#>>'{target,kind}' AND target_id=(j#>>'{target,id}')::uuid AND focus=j->>'focus' FOR UPDATE;
  PERFORM knowledge.require(prev IS NOT DISTINCT FROM (j->>'previous_review_id')::uuid,'REVIEW_HEAD_CHANGED');
  INSERT INTO knowledge.reviews(created_by,target_version_id,target_anchor_id,target_source_id,target_relation_id,target_annotation_id,target_evidence_id,stance,focus,explanation,previous_review_id)
  VALUES(actor,knowledge.ref_id(j->'target','version'),knowledge.ref_id(j->'target','anchor'),knowledge.ref_id(j->'target','source'),knowledge.ref_id(j->'target','relation'),knowledge.ref_id(j->'target','annotation'),knowledge.ref_id(j->'target','evidence'),j->>'stance',j->>'focus',j->>'explanation',prev) RETURNING id INTO i;
  -- Actor lock makes a missing slot safe; NO NULL head is ever inserted.
  IF prev IS NULL THEN INSERT INTO knowledge.review_heads VALUES(actor,j#>>'{target,kind}',(j#>>'{target,id}')::uuid,j->>'focus',i);
  ELSE UPDATE knowledge.review_heads SET review_id=i WHERE actor_id=actor AND target_kind=j#>>'{target,kind}' AND target_id=(j#>>'{target,id}')::uuid AND focus=j->>'focus';END IF;
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
 INSERT INTO knowledge.mutation_receipts(actor_id,operation,idempotency_key,request_hash,sql_command_hash,result_kind,result_id,response_json)
 VALUES(actor,operation,c->>'idempotency_key',c->>'request_hash',d,kind,i,meta);
 RETURN pg_catalog.jsonb_build_object('data',knowledge.mutation_result(kind,i,meta),'replayed',false);
END $$;

-- Stable snapshot lists. Scanned positions, NOT returned-visible counts, advance pages.
-- Snapshots contain only object IDs and ordering metadata; never raw query/body/key data.
CREATE FUNCTION knowledge.list_candidates(scope_name text,q jsonb) RETURNS TABLE(object_kind text,object_id uuid,object_created_at timestamptz)
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE ref jsonb=pg_catalog.jsonb_build_object('kind',q->>'target_kind','id',(q->>'target_id')::uuid);vid uuid=(q->>'version_id')::uuid;BEGIN
 CASE scope_name
 WHEN 'records' THEN RETURN QUERY SELECT 'record'::text,r.id,r.created_at FROM knowledge.records r WHERE r.visibility='public' AND knowledge.current_version(r.id) IS NOT NULL;
 WHEN 'relations' THEN RETURN QUERY SELECT 'relation'::text,r.id,r.created_at FROM knowledge.relations r WHERE knowledge.is_public('relation',r.id) AND ((q->>'direction' IN ('both','out') AND knowledge.row_ref(pg_catalog.to_jsonb(r),'from')=ref) OR(q->>'direction' IN ('both','in') AND knowledge.row_ref(pg_catalog.to_jsonb(r),'to')=ref));
 WHEN 'annotations' THEN RETURN QUERY SELECT 'annotation'::text,a.id,a.created_at FROM knowledge.annotations a JOIN knowledge.anchors an ON an.id=a.anchor_id WHERE an.version_id=vid AND knowledge.is_public('annotation',a.id);
 WHEN 'evidence' THEN RETURN QUERY SELECT 'evidence'::text,e.id,e.created_at FROM knowledge.evidence e WHERE knowledge.row_ref(pg_catalog.to_jsonb(e),'target')=ref AND knowledge.is_public('evidence',e.id);
 WHEN 'reviews' THEN RETURN QUERY SELECT 'review'::text,r.id,r.created_at FROM knowledge.reviews r WHERE knowledge.row_ref(pg_catalog.to_jsonb(r),'target')=ref AND knowledge.is_public('review',r.id);
 WHEN 'work_requests' THEN RETURN QUERY SELECT 'work_request'::text,w.id,w.created_at FROM knowledge.work_requests w WHERE (NOT q?'status' OR w.status=q->>'status') AND knowledge.is_public('work_request',w.id);
 WHEN 'part' THEN
  RETURN QUERY SELECT 'annotation'::text,a.id,a.created_at FROM knowledge.annotations a JOIN knowledge.anchors an ON an.id=a.anchor_id
   WHERE an.version_id=vid AND an.start_cp<(q->>'end')::integer AND an.end_cp>(q->>'start')::integer AND knowledge.is_public('annotation',a.id);
  RETURN QUERY SELECT 'relation'::text,r.id,r.created_at FROM knowledge.relations r
   WHERE knowledge.is_public('relation',r.id) AND (r.from_version_id=vid OR r.to_version_id=vid OR r.from_anchor_id IN(SELECT an.id FROM knowledge.anchors an WHERE an.version_id=vid AND an.start_cp<(q->>'end')::integer AND an.end_cp>(q->>'start')::integer) OR r.to_anchor_id IN(SELECT an.id FROM knowledge.anchors an WHERE an.version_id=vid AND an.start_cp<(q->>'end')::integer AND an.end_cp>(q->>'start')::integer));
 ELSE PERFORM knowledge.require(false);END CASE;
END $$;
CREATE FUNCTION knowledge.record_summary(object_id uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT pg_catalog.jsonb_build_object('id',r.id,'created_at',knowledge.utc(r.created_at),'current',knowledge.dto('version',knowledge.current_version(r.id)),'review_summary',knowledge.review_summary('version',knowledge.current_version(r.id))) FROM knowledge.records r WHERE r.id=object_id
$$;
CREATE FUNCTION knowledge.snapshot_page(scope_name text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE snap knowledge.query_snapshots%ROWTYPE;qh text;entries jsonb;counted integer;pos integer;stop integer;lim integer;entry jsonb;items jsonb='[]';val jsonb;BEGIN
 lim=CASE WHEN q?'limit' THEN knowledge.jint(q->'limit',1,50) ELSE 20 END;
 qh=knowledge.hash(scope_name||':'||(q-ARRAY['_snapshot_id','_scan_index','limit'])::text);
 IF q?'_snapshot_id' THEN
  PERFORM knowledge.juuid(q->'_snapshot_id');pos=knowledge.jint(q->'_scan_index',0,500);
  SELECT * INTO snap FROM knowledge.query_snapshots WHERE id=(q->>'_snapshot_id')::uuid;
  PERFORM knowledge.require(snap.id IS NOT NULL,'CURSOR_INVALID');PERFORM knowledge.require(snap.expires_at>pg_catalog.clock_timestamp(),'CURSOR_EXPIRED');
  PERFORM knowledge.require(snap.scope=scope_name AND snap.query_hash=qh AND pos<=pg_catalog.jsonb_array_length(snap.ordered_entries),'CURSOR_INVALID');
 ELSE
  PERFORM knowledge.require(NOT q?'_scan_index','CURSOR_INVALID');pos=0;
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('kind',c.object_kind,'id',c.object_id) ORDER BY c.object_created_at DESC,c.object_id),'[]'::jsonb),count(*) INTO entries,counted
   FROM(SELECT * FROM knowledge.list_candidates(scope_name,q) ORDER BY object_created_at DESC,object_id LIMIT 501)c;
  IF counted>500 THEN entries=entries-500;END IF;
  INSERT INTO knowledge.query_snapshots(query_hash,scope,ordered_entries,status_snapshot) VALUES(qh,scope_name,entries,pg_catalog.jsonb_build_object('truncated',counted>500)) RETURNING * INTO snap;
 END IF;
 stop=least(pos+lim,pg_catalog.jsonb_array_length(snap.ordered_entries));
 WHILE pos<stop LOOP
  entry=snap.ordered_entries->pos;pos=pos+1;
  IF knowledge.is_public(entry->>'kind',(entry->>'id')::uuid) THEN
   IF entry->>'kind'='record' THEN
    IF knowledge.current_version((entry->>'id')::uuid) IS NULL THEN CONTINUE;END IF;
    val=knowledge.record_summary((entry->>'id')::uuid);
   ELSE val=knowledge.dto(entry->>'kind',(entry->>'id')::uuid);END IF;
   items=items||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('kind',entry->>'kind','value',val));
  END IF;
 END LOOP;
 RETURN pg_catalog.jsonb_build_object('items',items,'snapshot_id',snap.id,'scan_index',pos,'has_more',pos<pg_catalog.jsonb_array_length(snap.ordered_entries),'snapshot_at',knowledge.utc(snap.created_at),'snapshot_expires_at',knowledge.utc(snap.expires_at),'truncated',snap.status_snapshot->'truncated');
END $$;
CREATE FUNCTION knowledge.validate_list(scope_name text,q jsonb) RETURNS void LANGUAGE plpgsql STABLE SET search_path='' AS $$ DECLARE fields text[]=ARRAY['limit','_snapshot_id','_scan_index'];BEGIN
 CASE scope_name
 WHEN 'records' THEN NULL;
 WHEN 'relations' THEN fields=fields||ARRAY['target_kind','target_id','direction'];
 WHEN 'annotations' THEN fields=fields||ARRAY['version_id'];
 WHEN 'evidence' THEN fields=fields||ARRAY['target_kind','target_id'];
 WHEN 'reviews' THEN fields=fields||ARRAY['target_kind','target_id'];
 WHEN 'work_requests' THEN fields=fields||ARRAY['status'];
 ELSE PERFORM knowledge.require(false);END CASE;
 PERFORM knowledge.jobject(q,fields);
 IF q?'limit' THEN PERFORM knowledge.jint(q->'limit',1,50);END IF;
 IF scope_name='annotations' THEN PERFORM knowledge.juuid(q->'version_id');PERFORM knowledge.require_public('version',(q->>'version_id')::uuid); END IF;
 IF scope_name IN ('relations','evidence','reviews') THEN
  PERFORM knowledge.validate_ref(pg_catalog.jsonb_build_object('kind',q->'target_kind','id',q->'target_id'),CASE scope_name WHEN 'relations' THEN ARRAY['version','anchor','source'] WHEN 'evidence' THEN ARRAY['version','anchor','source','relation','annotation','review'] ELSE ARRAY['version','anchor','source','relation','annotation','evidence'] END);
  PERFORM knowledge.require_public(q->>'target_kind',(q->>'target_id')::uuid);
 END IF;
 IF scope_name='relations' THEN PERFORM knowledge.require(q->>'direction' IN ('in','out','both')); END IF;
 IF scope_name='work_requests' AND q?'status' THEN PERFORM knowledge.require(q->>'status' IN ('open','in_progress','resolved','closed'));END IF;
END $$;
CREATE FUNCTION knowledge.list_read(scope_name text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock_shared(2081801,1);PERFORM knowledge.validate_list(scope_name,q);RETURN knowledge.snapshot_page(scope_name,q);
END $$;
CREATE FUNCTION knowledge.version_history(q jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE rid uuid;upper_no integer;last_no integer;lim integer;items jsonb;n integer;last_item jsonb;snapshot_at text;BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock_shared(2081801,1);
 PERFORM knowledge.jobject(q,ARRAY['record_id','limit','upper_version_no','last_version_no','snapshot_at'],ARRAY['record_id']);
 rid=knowledge.juuid(q->'record_id');PERFORM knowledge.require_public('record',rid);
 lim=CASE WHEN q?'limit' THEN knowledge.jint(q->'limit',1,50) ELSE 20 END;
 IF q?'upper_version_no' THEN
  upper_no=knowledge.jint(q->'upper_version_no',0,2147483647);last_no=knowledge.jint(q->'last_version_no',1,2147483647);PERFORM knowledge.require(last_no<=upper_no,'CURSOR_INVALID');
  PERFORM knowledge.validate_date(q->'snapshot_at');snapshot_at=q->>'snapshot_at';
  PERFORM knowledge.require(snapshot_at IS NOT NULL AND snapshot_at::timestamptz<=pg_catalog.clock_timestamp(),'CURSOR_INVALID');
  PERFORM knowledge.require(snapshot_at::timestamptz+interval '10 minutes'>pg_catalog.clock_timestamp(),'CURSOR_EXPIRED');
 ELSE
  PERFORM knowledge.require(NOT q?'last_version_no' AND NOT q?'snapshot_at','CURSOR_INVALID');
  SELECT coalesce(max(version_no),0) INTO upper_no FROM knowledge.versions WHERE record_id=rid AND visibility='public';last_no=NULL;snapshot_at=knowledge.utc(pg_catalog.transaction_timestamp());
 END IF;
 SELECT coalesce(pg_catalog.jsonb_agg(knowledge.dto('version',v.id) ORDER BY v.version_no DESC),'[]'::jsonb),count(*) INTO items,n
 FROM(SELECT id,version_no FROM knowledge.versions WHERE record_id=rid AND visibility='public' AND version_no<=upper_no AND (last_no IS NULL OR version_no<last_no) ORDER BY version_no DESC LIMIT lim+1)v;
 IF n>lim THEN items=items-lim;END IF;last_item=items->(pg_catalog.jsonb_array_length(items)-1);
 RETURN pg_catalog.jsonb_build_object('items',items,'upper_version_no',upper_no,'last_version_no',last_item->'version_no','has_more',n>lim,'snapshot_at',snapshot_at,'truncated',false);
END $$;
CREATE FUNCTION knowledge.part_read(q jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v knowledge.versions%ROWTYPE;s integer;e integer;cb integer;ca integer;cs integer;ce integer;pg jsonb;anns jsonb;rels jsonb;anchor_id uuid;summary jsonb;BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock_shared(2081801,1);
 PERFORM knowledge.jobject(q,ARRAY['version_id','start','end','context_before','context_after','_snapshot_id','_scan_index'],ARRAY['version_id','start','end','context_before','context_after']);
 PERFORM knowledge.juuid(q->'version_id');PERFORM knowledge.require_public('version',(q->>'version_id')::uuid);SELECT * INTO v FROM knowledge.versions WHERE id=(q->>'version_id')::uuid;
 s=knowledge.jint(q->'start',0,pg_catalog.length(v.body_text));e=knowledge.jint(q->'end',s,pg_catalog.length(v.body_text));
 cb=knowledge.jint(q->'context_before',0,1000);ca=knowledge.jint(q->'context_after',0,1000);cs=greatest(0,s-cb);ce=least(pg_catalog.length(v.body_text),e+ca);
 pg=knowledge.snapshot_page('part',q||'{"limit":50}'::jsonb);
 SELECT coalesce(pg_catalog.jsonb_agg(value->'value'),'[]'::jsonb) INTO anns FROM pg_catalog.jsonb_array_elements(pg->'items') WHERE value->>'kind'='annotation';
 SELECT coalesce(pg_catalog.jsonb_agg(value->'value'),'[]'::jsonb) INTO rels FROM pg_catalog.jsonb_array_elements(pg->'items') WHERE value->>'kind'='relation';
 SELECT id INTO anchor_id FROM knowledge.anchors WHERE version_id=v.id AND start_cp=s AND end_cp=e AND visibility='public';
 summary=knowledge.review_summary('anchor',anchor_id);
 RETURN pg_catalog.jsonb_build_object('version_id',v.id,'body_sha256',v.body_sha256,'start',s,'end',e,'exact',pg_catalog.substr(v.body_text,s+1,e-s),'context_start',cs,'context_end',ce,'context_text',pg_catalog.substr(v.body_text,cs+1,ce-cs),'annotations',anns,'relations',rels,'review_summary',summary,'truncated',(pg->>'truncated')::boolean OR (pg->>'has_more')::boolean,'pagination',pg-'items');
END $$;
CREATE FUNCTION knowledge.owner_version(kind text,object_id uuid,depth integer DEFAULT 0) RETURNS uuid LANGUAGE plpgsql STABLE SET search_path='' AS $$ DECLARE j jsonb;r jsonb;out_id uuid;BEGIN
 IF depth>128 THEN RETURN NULL;END IF;j=knowledge.raw_object(kind,object_id);
 CASE kind WHEN 'version' THEN RETURN object_id;WHEN 'anchor' THEN RETURN (j->>'version_id')::uuid;
 WHEN 'annotation' THEN SELECT version_id INTO out_id FROM knowledge.anchors WHERE id=(j->>'anchor_id')::uuid;RETURN out_id;
 WHEN 'review' THEN r=knowledge.row_ref(j,'target');RETURN knowledge.owner_version(r->>'kind',(r->>'id')::uuid,depth+1);
 WHEN 'evidence' THEN r=knowledge.row_ref(j,'target');RETURN knowledge.owner_version(r->>'kind',(r->>'id')::uuid,depth+1);
 ELSE RETURN NULL;END CASE;
END $$;
CREATE FUNCTION knowledge.object_view(q jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$ DECLARE k text;i uuid;j jsonb;owner uuid;BEGIN
 PERFORM knowledge.jobject(q,ARRAY['kind','id'],ARRAY['kind','id']);PERFORM knowledge.validate_ref(q,ARRAY['version','anchor','source','relation','annotation','evidence','review']);
 k=q->>'kind';i=(q->>'id')::uuid;PERFORM knowledge.require_public(k,i);j=knowledge.raw_object(k,i);
 owner=knowledge.owner_version(k,i);
 RETURN pg_catalog.jsonb_build_object('target',pg_catalog.jsonb_build_object('kind',k,'id',i),'value',knowledge.dto(k,i),'owner_version_id',owner,'basis',CASE WHEN k='evidence' THEN '[]'::jsonb ELSE knowledge.evidence_for(k,i) END);
END $$;
-- SECURITY DEFINER facade. Only these exact signatures are executable by service_role.
-- Authentication to construct p_context is Stage 4, not supplied by browser JSON.
CREATE FUNCTION public.kb_create_record(p_context jsonb,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN knowledge.mutate('record.create',p_context,p_command);END $$;
CREATE FUNCTION public.kb_create_version(p_context jsonb,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN knowledge.mutate('version.create',p_context,p_command);END $$;
CREATE FUNCTION public.kb_create_anchor(p_context jsonb,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN knowledge.mutate('anchor.create',p_context,p_command);END $$;
CREATE FUNCTION public.kb_create_source(p_context jsonb,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN knowledge.mutate('source.create',p_context,p_command);END $$;
CREATE FUNCTION public.kb_create_relation(p_context jsonb,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN knowledge.mutate('relation.create',p_context,p_command);END $$;
CREATE FUNCTION public.kb_create_annotation(p_context jsonb,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN knowledge.mutate('annotation.create',p_context,p_command);END $$;
CREATE FUNCTION public.kb_create_evidence(p_context jsonb,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN knowledge.mutate('evidence.create',p_context,p_command);END $$;
CREATE FUNCTION public.kb_create_review(p_context jsonb,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN knowledge.mutate('review.create',p_context,p_command);END $$;
CREATE FUNCTION public.kb_create_work_request(p_context jsonb,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN knowledge.mutate('work_request.create',p_context,p_command);END $$;
CREATE FUNCTION public.kb_update_work_request(p_context jsonb,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN knowledge.mutate('work_request.update',p_context,p_command);END $$;
CREATE FUNCTION public.kb_get_record(p_query jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN PERFORM pg_catalog.pg_advisory_xact_lock_shared(2081801,1);PERFORM knowledge.jobject(p_query,ARRAY['id'],ARRAY['id']);PERFORM knowledge.juuid(p_query->'id');PERFORM knowledge.require_public('record',(p_query->>'id')::uuid);PERFORM knowledge.require(knowledge.current_version((p_query->>'id')::uuid) IS NOT NULL,'NOT_FOUND');RETURN knowledge.version_view(knowledge.current_version((p_query->>'id')::uuid));END $$;
CREATE FUNCTION public.kb_get_version(p_query jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN PERFORM pg_catalog.pg_advisory_xact_lock_shared(2081801,1);PERFORM knowledge.jobject(p_query,ARRAY['id'],ARRAY['id']);PERFORM knowledge.juuid(p_query->'id');RETURN knowledge.version_view((p_query->>'id')::uuid);END $$;
CREATE FUNCTION public.kb_get_source(p_query jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN PERFORM pg_catalog.pg_advisory_xact_lock_shared(2081801,1);PERFORM knowledge.jobject(p_query,ARRAY['id'],ARRAY['id']);PERFORM knowledge.juuid(p_query->'id');PERFORM knowledge.require_public('source',(p_query->>'id')::uuid);RETURN knowledge.dto('source',(p_query->>'id')::uuid);END $$;
CREATE FUNCTION public.kb_get_object(p_query jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN PERFORM pg_catalog.pg_advisory_xact_lock_shared(2081801,1);RETURN knowledge.object_view(p_query);END $$;
CREATE FUNCTION public.kb_get_part(p_query jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN PERFORM pg_catalog.pg_advisory_xact_lock_shared(2081801,1);RETURN knowledge.part_read(p_query);END $$;
CREATE FUNCTION public.kb_list_versions(p_query jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN PERFORM pg_catalog.pg_advisory_xact_lock_shared(2081801,1);RETURN knowledge.version_history(p_query);END $$;
CREATE FUNCTION public.kb_list_records(p_query jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN PERFORM pg_catalog.pg_advisory_xact_lock_shared(2081801,1);RETURN knowledge.list_read('records',p_query);END $$;
CREATE FUNCTION public.kb_list_relations(p_query jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN PERFORM pg_catalog.pg_advisory_xact_lock_shared(2081801,1);RETURN knowledge.list_read('relations',p_query);END $$;
CREATE FUNCTION public.kb_list_annotations(p_query jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN PERFORM pg_catalog.pg_advisory_xact_lock_shared(2081801,1);RETURN knowledge.list_read('annotations',p_query);END $$;
CREATE FUNCTION public.kb_list_evidence(p_query jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN PERFORM pg_catalog.pg_advisory_xact_lock_shared(2081801,1);RETURN knowledge.list_read('evidence',p_query);END $$;
CREATE FUNCTION public.kb_list_reviews(p_query jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN PERFORM pg_catalog.pg_advisory_xact_lock_shared(2081801,1);RETURN knowledge.list_read('reviews',p_query);END $$;
CREATE FUNCTION public.kb_list_work_requests(p_query jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN PERFORM pg_catalog.pg_advisory_xact_lock_shared(2081801,1);RETURN knowledge.list_read('work_requests',p_query);END $$;
REVOKE ALL ON FUNCTION public.kb_create_record(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kb_create_record(jsonb,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.kb_create_version(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kb_create_version(jsonb,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.kb_create_anchor(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kb_create_anchor(jsonb,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.kb_create_source(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kb_create_source(jsonb,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.kb_create_relation(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kb_create_relation(jsonb,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.kb_create_annotation(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kb_create_annotation(jsonb,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.kb_create_evidence(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kb_create_evidence(jsonb,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.kb_create_review(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kb_create_review(jsonb,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.kb_create_work_request(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kb_create_work_request(jsonb,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.kb_update_work_request(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kb_update_work_request(jsonb,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.kb_get_record(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kb_get_record(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.kb_get_version(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kb_get_version(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.kb_get_source(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kb_get_source(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.kb_get_object(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kb_get_object(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.kb_get_part(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kb_get_part(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.kb_list_versions(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kb_list_versions(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.kb_list_records(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kb_list_records(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.kb_list_relations(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kb_list_relations(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.kb_list_annotations(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kb_list_annotations(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.kb_list_evidence(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kb_list_evidence(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.kb_list_reviews(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kb_list_reviews(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.kb_list_work_requests(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kb_list_work_requests(jsonb) TO service_role;
CREATE FUNCTION public.kb_get_raw(p_query jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE t text;BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock_shared(2081801,1);PERFORM knowledge.jobject(p_query,ARRAY['id'],ARRAY['id']);PERFORM knowledge.juuid(p_query->'id');
 PERFORM knowledge.require_public('version',(p_query->>'id')::uuid);SELECT body_text INTO t FROM knowledge.versions WHERE id=(p_query->>'id')::uuid;RETURN pg_catalog.to_jsonb(t);
END $$;
REVOKE ALL ON FUNCTION public.kb_get_raw(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kb_get_raw(jsonb) TO service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA knowledge FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
