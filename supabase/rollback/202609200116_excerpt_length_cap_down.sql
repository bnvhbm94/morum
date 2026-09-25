-- Rollback for 202609200116_excerpt_length_cap.sql.
-- Drops the excerpt-length CHECK constraint and restores the 202609200112
-- body of knowledge.validate_command verbatim (submitted_text limit back to
-- 100000).
BEGIN;

ALTER TABLE knowledge.sources DROP CONSTRAINT IF EXISTS sources_submitted_text_excerpt_cap;

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

CREATE OR REPLACE FUNCTION public.kb_health() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT pg_catalog.jsonb_build_object('status',CASE WHEN contract_version='2.1.0' AND migration_tag='stage11-canonical-url-identity' THEN 'ok' ELSE 'degraded' END,'database','reachable','contract_version',contract_version) FROM knowledge.schema_info WHERE singleton
$$;
UPDATE knowledge.schema_info SET migration_tag='stage11-canonical-url-identity' WHERE singleton;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA knowledge FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
