-- Stage09 / dossier agreements. Additive only: no table/column drop, no
-- truncate, no extension install, no role alteration. Contract stays 2.1.0.
-- Closes the two roadmap 2.9 (ClaimReview) data gaps noted in
-- src/server/service/claimreview.ts's header comment:
--  - kb_dossier now exposes individual public agreeing (stance=agree) review
--    rows under agreements.reviews, in the same element shape as
--    counterarguments.reviews (previously only the aggregate agree_keyed/
--    agree_anonymous counts existed); capped at 50, newest first, with an
--    agreements.truncated boolean. The existing agree_keyed/agree_anonymous
--    count fields are unchanged.
--  - Every `on` content-ref in both counterarguments.reviews and
--    agreements.reviews whose kind is 'anchor' now additionally carries the
--    anchor's exact/start/end (a version ref is unchanged), via the new
--    knowledge.review_on_ref(knowledge.reviews) helper below.
-- kb_dossier's blind=true behavior extends to agreements the same way it
-- already applied to counterarguments: agreements.reviews is suppressed to
-- [] while blind, but the aggregate counts (agree_keyed, agree_anonymous)
-- and the truncated flag (computed from the true total, independent of
-- blind -- matching how omitted.counterarguments already behaves under
-- blind) stay visible.
-- Rollback: supabase/rollback/202609200113_dossier_agreements_down.sql
BEGIN;

-- Builds the same {kind,id} shape as knowledge.row_ref for a review's
-- target, but additionally carries the anchor's resolved exact/start/end
-- when the target is an anchor. A version target is unchanged. Safe to
-- expose: by the time a review reaches kb_dossier's output,
-- knowledge.is_public('review',..) has already confirmed the target anchor
-- (and its parent chain) is public.
CREATE FUNCTION knowledge.review_on_ref(rv knowledge.reviews) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE WHEN rv.target_anchor_id IS NOT NULL THEN
   (SELECT pg_catalog.jsonb_build_object('kind','anchor','id',a.id,'exact',a.exact,'start',a.start_cp,'end',a.end_cp) FROM knowledge.anchors a WHERE a.id=rv.target_anchor_id)
  ELSE knowledge.row_ref(pg_catalog.to_jsonb(rv),'target') END
$$;

-- === 1c: dossier (copy of 202609200110's body; adds agreements.reviews/
-- truncated and routes both reviews listings' 'on' field through
-- knowledge.review_on_ref) ==================================================
CREATE OR REPLACE FUNCTION public.kb_dossier(p_query jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target jsonb;vid uuid;v knowledge.versions%ROWTYPE;blind boolean;anchor_ids uuid[];
 corrections jsonb;corr_total integer;corr_cap integer=10;
 reviews jsonb;rev_total integer;review_cap integer=20;
 contradicts jsonb;contra_total integer;contra_cap integer=10;
 keyed_actors integer;anon_reviews integer;declared_families integer;agree_keyed integer;agree_anon integer;
 agree_reviews jsonb;agree_total integer;agree_cap integer=50;
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
   SELECT pg_catalog.jsonb_build_object('id',rv.id,'stance',rv.stance,'focus',rv.focus,'on',knowledge.review_on_ref(rv),
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

 SELECT count(*) INTO agree_total FROM knowledge.reviews rv WHERE rv.stance='agree' AND knowledge.is_public('review',rv.id) AND (
   rv.id IN (SELECT h.review_id FROM knowledge.review_heads h WHERE (h.target_kind='version' AND h.target_id=vid) OR (h.target_kind='anchor' AND h.target_id=ANY(anchor_ids)))
   OR (rv.created_by IS NULL AND (rv.target_version_id=vid OR rv.target_anchor_id=ANY(anchor_ids))));
 IF blind THEN agree_reviews='[]'::jsonb;
 ELSE
  SELECT coalesce(pg_catalog.jsonb_agg(x ORDER BY ca DESC),'[]'::jsonb) INTO agree_reviews FROM (
   SELECT pg_catalog.jsonb_build_object('id',rv.id,'stance',rv.stance,'focus',rv.focus,'on',knowledge.review_on_ref(rv),
     'created_by',rv.created_by,'created_at',knowledge.utc(rv.created_at),
     'declared',(SELECT p.declared FROM knowledge.provenance p WHERE p.result_kind='review' AND p.result_id=rv.id ORDER BY p.created_at DESC LIMIT 1),
     'explanation',rv.explanation) x,rv.created_at ca
   FROM knowledge.reviews rv WHERE rv.stance='agree' AND knowledge.is_public('review',rv.id) AND (
     rv.id IN (SELECT h.review_id FROM knowledge.review_heads h WHERE (h.target_kind='version' AND h.target_id=vid) OR (h.target_kind='anchor' AND h.target_id=ANY(anchor_ids)))
     OR (rv.created_by IS NULL AND (rv.target_version_id=vid OR rv.target_anchor_id=ANY(anchor_ids))))
   ORDER BY rv.created_at DESC LIMIT agree_cap
  ) t;
 END IF;

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
  'agreements',pg_catalog.jsonb_build_object('agree_keyed',agree_keyed,'agree_anonymous',agree_anon,'reviews',agree_reviews,'truncated',agree_total>agree_cap),
  'evidence',evidence,'premises',premises,'meanings',meanings,'related',related,'omitted',omitted,'blind',blind,
  'generated_at',knowledge.utc(pg_catalog.clock_timestamp()));
END $$;

REVOKE ALL ON FUNCTION public.kb_dossier(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kb_dossier(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.kb_health() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT pg_catalog.jsonb_build_object('status',CASE WHEN contract_version='2.1.0' AND migration_tag='stage09-dossier-agreements' THEN 'ok' ELSE 'degraded' END,'database','reachable','contract_version',contract_version) FROM knowledge.schema_info WHERE singleton
$$;
UPDATE knowledge.schema_info SET migration_tag='stage09-dossier-agreements' WHERE singleton;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA knowledge FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
