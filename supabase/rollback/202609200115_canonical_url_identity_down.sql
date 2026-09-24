-- Rollback for 202609200115_canonical_url_identity.sql.
-- Restores the 202609200110 body of knowledge.canonical_url verbatim (no
-- scheme folding, www/mobile/export/dx host rewrites, or arXiv/DOI path
-- normalization), then rebuilds the dependent expression index.
BEGIN;

CREATE OR REPLACE FUNCTION knowledge.canonical_url(u text) RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
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

REINDEX INDEX knowledge.sources_canonical_url_idx;

CREATE OR REPLACE FUNCTION public.kb_health() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT pg_catalog.jsonb_build_object('status',CASE WHEN contract_version='2.1.0' AND migration_tag='stage10-dossier-anchor-evidence' THEN 'ok' ELSE 'degraded' END,'database','reachable','contract_version',contract_version) FROM knowledge.schema_info WHERE singleton
$$;
UPDATE knowledge.schema_info SET migration_tag='stage10-dossier-anchor-evidence' WHERE singleton;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA knowledge FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
