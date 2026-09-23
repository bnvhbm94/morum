BEGIN;

-- Anonymous reviews (created_by IS NULL) never get a knowledge.review_heads row,
-- so context_neighbors, which only walked review_heads, silently dropped every
-- anonymous disagree/needs_review from /context while review_summary already
-- counted them. Read both populations: keyed head reviews plus all public
-- anonymous reviews aimed at the target (or, for a version, at its anchors).
-- Additive only: no table, column or contract change (contract stays 2.1.0).
-- Rollback: supabase/rollback/202609200109_context_anonymous_reviews_down.sql

CREATE OR REPLACE FUNCTION knowledge.context_neighbors(k text,i uuid) RETURNS TABLE(kind text,id uuid,reason text,priority integer) LANGUAGE plpgsql STABLE SET search_path='' AS $$
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
  FROM knowledge.reviews r WHERE knowledge.is_public('review',r.id) AND (
   -- keyed reviewers: the head (latest) review per actor, target and focus
   r.id IN (SELECT h.review_id FROM knowledge.review_heads h WHERE (h.target_kind=k AND h.target_id=i)
     OR (k='version' AND h.target_kind='anchor' AND h.target_id IN(SELECT a.id FROM knowledge.anchors a WHERE a.version_id=i)))
   -- anonymous reviewers: no head row exists, every appended review counts
   OR (r.created_by IS NULL AND (knowledge.row_ref(pg_catalog.to_jsonb(r),'target')=pg_catalog.jsonb_build_object('kind',k,'id',i)
     OR (k='version' AND r.target_anchor_id IN(SELECT a.id FROM knowledge.anchors a WHERE a.version_id=i)))))
  ORDER BY CASE r.stance WHEN 'disagree' THEN 1 WHEN 'needs_review' THEN 2 ELSE 6 END,r.id LIMIT 401;
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

CREATE OR REPLACE FUNCTION public.kb_health() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT pg_catalog.jsonb_build_object('status',CASE WHEN contract_version='2.1.0' AND migration_tag='stage06-context-anonymous-reviews' THEN 'ok' ELSE 'degraded' END,'database','reachable','contract_version',contract_version) FROM knowledge.schema_info WHERE singleton
$$;

UPDATE knowledge.schema_info
SET migration_tag='stage06-context-anonymous-reviews'
WHERE singleton;

COMMIT;
