BEGIN;

-- Deferred constraint triggers run when the transaction commits, after the
-- SECURITY DEFINER RPC has returned. They must retain the migration owner's
-- narrowly scoped access to the private knowledge schema at that point.
ALTER FUNCTION knowledge.record_counter_guard() SECURITY DEFINER;
ALTER FUNCTION knowledge.work_event_guard() SECURITY DEFINER;
ALTER FUNCTION knowledge.work_resolution_guard() SECURITY DEFINER;

REVOKE ALL ON FUNCTION knowledge.record_counter_guard() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION knowledge.work_event_guard() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION knowledge.work_resolution_guard() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.kb_health() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT pg_catalog.jsonb_build_object('status',CASE WHEN contract_version='2.1.0' AND migration_tag='stage05-deferred-trigger-security' THEN 'ok' ELSE 'degraded' END,'database','reachable','contract_version',contract_version) FROM knowledge.schema_info WHERE singleton
$$;

UPDATE knowledge.schema_info
SET migration_tag='stage05-deferred-trigger-security'
WHERE singleton;

COMMIT;
