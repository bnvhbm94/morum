-- Stage11 / canonical URL identity. Additive only: no table/column drop,
-- no truncate, no extension install, no role alteration. Contract stays
-- 2.1.0.
-- Fixes knowledge.canonical_url(u text) (defined 202609200110, used by the
-- expression index knowledge.sources_canonical_url_idx and by
-- kb_url_report) treating equivalent URL variants as different keys.
-- CREATE OR REPLACE, same signature and IMMUTABLE STRICT, then
-- REINDEX INDEX knowledge.sources_canonical_url_idx (function-based index,
-- must be rebuilt after the function body it depends on changes). New rules
-- added to the existing ones (lowercase scheme/host, trailing-slash strip,
-- default-port strip, fragment drop, utm_/fbclid/gclid/ref/ref_src removal):
--  1. Scheme: http folds to https.
--  2. Host: strip a leading www./www2./etc.; Wikipedia mobile
--     (<lang>.m.wikipedia.org -> <lang>.wikipedia.org); export.arxiv.org ->
--     arxiv.org; dx.doi.org -> doi.org.
--  3. arXiv (host arxiv.org): /abs/<id>vN, /pdf/<id>, /pdf/<id>vN,
--     /pdf/<id>.pdf, /pdf/<id>vN.pdf all -> /abs/<id>; query dropped.
--  4. DOI (host doi.org): path lowercased (DOIs are case-insensitive);
--     query dropped.
--  5. Everything else unchanged.
-- Rollback: supabase/rollback/202609200115_canonical_url_identity_down.sql
BEGIN;

-- === 1a: canonical_url (copy of 202609200110's body, extended per header) =
CREATE OR REPLACE FUNCTION knowledge.canonical_url(u text) RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 WITH m AS (
  SELECT pg_catalog.regexp_match(u,'^(https?)://([^/:?#]+)(?::([0-9]+))?([^?#]*)(?:\?([^#]*))?','i') g
 ), parts AS (
  SELECT pg_catalog.lower(g[1]) scheme,pg_catalog.lower(g[2]) host,g[3] port,
   CASE WHEN coalesce(g[4],'')='' THEN '/' ELSE g[4] END path,g[5] query
  FROM m WHERE g IS NOT NULL
 ), scheme_host_norm AS (
  SELECT CASE WHEN scheme='http' THEN 'https' ELSE scheme END scheme,port,path,query,
   CASE
    WHEN pg_catalog.regexp_replace(host,'^www[0-9]*\.','') = 'export.arxiv.org' THEN 'arxiv.org'
    WHEN pg_catalog.regexp_replace(host,'^www[0-9]*\.','') = 'dx.doi.org' THEN 'doi.org'
    WHEN pg_catalog.regexp_replace(host,'^www[0-9]*\.','') ~ '^[a-z-]+\.m\.wikipedia\.org$'
     THEN pg_catalog.regexp_replace(pg_catalog.regexp_replace(host,'^www[0-9]*\.',''),'^([a-z-]+)\.m\.wikipedia\.org$','\1.wikipedia.org')
    ELSE pg_catalog.regexp_replace(host,'^www[0-9]*\.','')
   END host
  FROM parts
 ), path_norm AS (
  SELECT scheme,host,port,
   CASE WHEN pg_catalog.length(path)>1 AND pg_catalog.right(path,1)='/' THEN pg_catalog.left(path,pg_catalog.length(path)-1) ELSE path END path,
   query
  FROM scheme_host_norm
 ), special_norm AS (
  SELECT scheme,host,port,
   CASE
    WHEN host='arxiv.org' AND (pg_catalog.regexp_match(path,'^/(?:abs|pdf)/((?:\d{4}\.\d{4,5})|(?:[a-z-]+(?:\.[A-Z]{2})?/\d{7}))(?:v\d+)?(?:\.pdf)?$'))[1] IS NOT NULL
     THEN '/abs/'||(pg_catalog.regexp_match(path,'^/(?:abs|pdf)/((?:\d{4}\.\d{4,5})|(?:[a-z-]+(?:\.[A-Z]{2})?/\d{7}))(?:v\d+)?(?:\.pdf)?$'))[1]
    WHEN host='doi.org' THEN pg_catalog.lower(path)
    ELSE path
   END path,
   CASE WHEN host IN ('arxiv.org','doi.org') THEN NULL ELSE query END query
  FROM path_norm
 ), query_norm AS (
  SELECT special_norm.*,(
   SELECT pg_catalog.string_agg(kv,'&' ORDER BY ord) FROM (
    SELECT kv,ord FROM pg_catalog.unnest(pg_catalog.string_to_array(coalesce(query,''),'&')) WITH ORDINALITY t(kv,ord)
    WHERE kv<>'' AND NOT (pg_catalog.split_part(kv,'=',1) ~* '^utm_' OR pg_catalog.split_part(kv,'=',1) IN ('fbclid','gclid','ref','ref_src'))
   ) filtered
  ) q2
  FROM special_norm
 )
 SELECT scheme||'://'||host||
  CASE WHEN port IS NOT NULL AND port NOT IN ('80','443') THEN ':'||port ELSE '' END||
  path||
  CASE WHEN q2 IS NOT NULL AND q2<>'' THEN '?'||q2 ELSE '' END
 FROM query_norm
$$;

REINDEX INDEX knowledge.sources_canonical_url_idx;

CREATE OR REPLACE FUNCTION public.kb_health() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT pg_catalog.jsonb_build_object('status',CASE WHEN contract_version='2.1.0' AND migration_tag='stage11-canonical-url-identity' THEN 'ok' ELSE 'degraded' END,'database','reachable','contract_version',contract_version) FROM knowledge.schema_info WHERE singleton
$$;
UPDATE knowledge.schema_info SET migration_tag='stage11-canonical-url-identity' WHERE singleton;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA knowledge FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
