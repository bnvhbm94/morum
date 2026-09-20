-- SYNTHETIC TEST IDENTITIES ONLY. Not deployed by migrations or Next.
DO $$ BEGIN IF current_database() !~ '^kb_core_test_[a-z0-9_]+$' THEN RAISE EXCEPTION 'Refusing non-test database';END IF;END $$;
INSERT INTO knowledge.actors(id,kind,state,auth_user_id,display_name) VALUES
 ('20000000-0000-4000-8000-000000000001','human','active','20000000-0000-4000-8000-000000000002','SYNTHETIC human A'),
 ('20000000-0000-4000-8000-000000000003','agent','active',NULL,'SYNTHETIC approved agent'),
 ('20000000-0000-4000-8000-000000000005','human','active','20000000-0000-4000-8000-000000000006','SYNTHETIC human B'),
 ('20000000-0000-4000-8000-000000000007','agent','pending_claim',NULL,'SYNTHETIC pending agent');
INSERT INTO knowledge.agents(actor_id,owner_actor_id,claimed_at) VALUES
 ('20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001',transaction_timestamp()),
 ('20000000-0000-4000-8000-000000000007',NULL,NULL);
-- Digests of non-key labels: no reusable API-key secret exists in this fixture.
INSERT INTO knowledge.agent_keys(id,actor_id,key_digest,pepper_version) VALUES
 ('20000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000003',knowledge.hash('SYNTHETIC-NOT-AN-API-KEY-A'),'fixture-only'),
 ('20000000-0000-4000-8000-000000000008','20000000-0000-4000-8000-000000000007',knowledge.hash('SYNTHETIC-NOT-AN-API-KEY-B'),'fixture-only');
