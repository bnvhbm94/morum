-- TEST-ONLY. The caller enforces a dedicated loopback cluster/database acknowledgement.
-- No production actors, admin grants, passwords, or application keys are created here.
DO $$ BEGIN
 IF current_database() !~ '^kb_core_test_[a-z0-9_]+$' THEN RAISE EXCEPTION 'Refusing non-test database';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN;END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN;END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN;END IF;
END $$;
